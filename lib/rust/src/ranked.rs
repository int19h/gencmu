//! Written ranked groups and their local loading rules.

use crate::clauses::{simplify_cond, simplify_value, Simple};
use crate::dom::{Arg, Cond, EmitItem, Expr, Term};
use crate::error::Error;
use crate::fxhash::{FxMap, FxSet};
use crate::grammar::StageGrammar;
use crate::lower::{Lowered, Sym};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone)]
pub(crate) struct Group {
    pub id: usize,
    pub source: (usize, usize),
    pub path: String,
    pub expression: usize,
    pub final_position: bool,
}
#[derive(Debug, Clone, Default)]
pub(crate) struct RankedGroups {
    pub groups: Vec<Group>,
    pub expressions: FxMap<usize, usize>,
    pub owners: FxMap<usize, usize>,
    pub paths: FxMap<usize, String>,
}
#[derive(Clone, Default)]
struct Route {
    length: usize,
    captures: BTreeMap<String, (usize, usize)>,
    ends: BTreeMap<usize, (usize, usize)>,
}
fn join(mut left: Route, right: &Route) -> Route {
    let offset = left.length;
    for (name, &(node, at)) in &right.captures {
        left.captures.insert(name.clone(), (node, at + offset));
    }
    for (&group, &(at, option)) in &right.ends {
        left.ends.insert(group, (at + offset, option));
    }
    left.length += right.length;
    left
}
fn product(left: Vec<Route>, right: Vec<Route>) -> Vec<Route> {
    left.into_iter().flat_map(|left| right.iter().map(move |right| join(left.clone(), right))).collect()
}
fn routes(expr: &Expr, groups: &RankedGroups) -> Vec<Route> {
    match expr {
        Expr::Empty => vec![Route::default()],
        Expr::Seq(items) => items.iter().fold(vec![Route::default()], |left, item| product(left, routes(item, groups))),
        Expr::Choice(items) => items.iter().flat_map(|item| routes(item, groups)).collect(),
        Expr::Ranked(items) => {
            let group = groups.expressions[&(expr as *const Expr as usize)];
            items
                .iter()
                .enumerate()
                .flat_map(|(option, item)| {
                    routes(item, groups).into_iter().map(move |mut route| {
                        route.ends.insert(group, (route.length, option));
                        route
                    })
                })
                .collect()
        }
        Expr::And(items) => {
            let mut out = Vec::new();
            for mask in 1usize..1usize << items.len() {
                let mut selected = vec![Route::default()];
                for (index, item) in items.iter().enumerate() {
                    if mask & (1usize << index) != 0 {
                        selected = product(selected, routes(item, groups));
                    }
                }
                out.extend(selected);
            }
            out
        }
        Expr::Optional(inner, _) => {
            let mut out = vec![Route::default()];
            out.extend(routes(inner, groups));
            out
        }
        Expr::Repeat(inner, separator, _) => match separator {
            Some(separator) => product(routes(inner, groups), routes(separator, groups)),
            None => routes(inner, groups),
        },
        _ => {
            let mut route = Route { length: 1, ..Route::default() };
            if let Expr::Capture(name, _) = expr {
                route.captures.insert(name.clone(), (expr as *const Expr as usize, 1));
            }
            vec![route]
        }
    }
}
fn term_reads(term: &Term, out: &mut BTreeSet<String>) {
    match term {
        Term::Capture(name) => {
            out.insert(name.clone());
        }
        Term::Union(items) | Term::Intersection(items) => {
            for item in items {
                term_reads(item, out);
            }
        }
        Term::Difference(left, right) => {
            term_reads(left, out);
            term_reads(right, out);
        }
        Term::Call(_, args) => {
            for arg in args {
                if let Arg::Term(term) = arg {
                    term_reads(term, out);
                }
            }
        }
        Term::If(cond, term) => {
            cond_reads(cond, out);
            term_reads(term, out);
        }
        _ => {}
    }
}
fn cond_reads(cond: &Cond, out: &mut BTreeSet<String>) {
    match cond {
        Cond::Captured(name) => {
            out.insert(name.clone());
        }
        Cond::Compare(_, left, right) => {
            term_reads(left, out);
            term_reads(right, out);
        }
        Cond::Matches(term, _) | Cond::Begins(term, _) | Cond::Initial(term) => term_reads(term, out),
        Cond::Not(cond) => cond_reads(cond, out),
        Cond::All(items) | Cond::Any(items) => {
            for item in items {
                cond_reads(item, out);
            }
        }
        Cond::If(left, right) => {
            cond_reads(left, out);
            cond_reads(right, out);
        }
    }
}
impl RankedGroups {
    pub fn new(grammar: &StageGrammar) -> Result<Self, Error> {
        let mut out = Self::default();
        for (rule, definition) in grammar.rules.iter().enumerate() {
            for (alternative, source) in definition.alternatives.iter().enumerate() {
                out.visit(&source.alternative.expr, "", true, None, (rule, alternative));
            }
        }
        for group in &out.groups {
            let source = &grammar.rules[group.source.0].alternatives[group.source.1];
            for route in routes(&source.alternative.expr, &out) {
                let Some(&(end, _option)) = route.ends.get(&group.id) else {
                    continue;
                };
                let has = |name: &str| name.is_empty() || route.captures.contains_key(name);
                let private = |reads: &BTreeSet<String>| {
                    reads.iter().any(|name| {
                        route.captures.get(name).is_some_and(|&(node, _)| out.owners.get(&node) == Some(&group.id))
                    })
                };
                for condition in &source.clauses.conditions {
                    let mut original = BTreeSet::new();
                    cond_reads(condition, &mut original);
                    if !private(&original) {
                        continue;
                    }
                    let effective = simplify_cond(condition, &has);
                    let Simple::Cond(effective) = effective else {
                        continue;
                    };
                    let mut reads = BTreeSet::new();
                    cond_reads(&effective, &mut reads);
                    if reads.iter().any(|name| !has(name)) {
                        continue;
                    }
                    if reads.iter().any(|name| {
                        if name.is_empty() {
                            !group.final_position
                        } else {
                            route.captures[name].1 > end
                        }
                    }) {
                        return Err(out.fail(
                            grammar,
                            group,
                            "ranked-choice-continuation",
                            "A private capture requires a condition ready when its ranked choice closes.",
                        ));
                    }
                }
                for term in source.alternative.tags.iter().chain(source.clauses.tags.iter()) {
                    let mut reads = BTreeSet::new();
                    term_reads(&simplify_value(term, &has), &mut reads);
                    if private(&reads) {
                        return Err(out.fail(
                            grammar,
                            group,
                            "ranked-choice-export",
                            "A tag term cannot read a private ranked capture.",
                        ));
                    }
                }
                let mut reads = BTreeSet::new();
                for item in source.clauses.emit.iter().flatten() {
                    if let EmitItem::Capture(name, term, attachments) = item {
                        reads.insert(name.clone());
                        reads.extend(attachments.before.iter().chain(&attachments.after).cloned());
                        if let Some(term) = term {
                            term_reads(term, &mut reads);
                        }
                    }
                }
                if private(&reads) {
                    return Err(out.fail(
                        grammar,
                        group,
                        "ranked-choice-export",
                        "An emission item cannot read a private ranked capture.",
                    ));
                }
            }
        }
        Ok(out)
    }
    fn visit(&mut self, expr: &Expr, path: &str, final_position: bool, owner: Option<usize>, source: (usize, usize)) {
        let pointer = expr as *const Expr as usize;
        self.paths.insert(pointer, path.to_string());
        if let Expr::Ranked(items) = expr {
            let id = self.groups.len();
            self.groups.push(Group { id, source, path: path.into(), expression: pointer, final_position });
            self.expressions.insert(pointer, id);
            for (index, child) in items.iter().enumerate() {
                self.visit(child, &format!("{path}/ranked/{index}"), final_position, Some(id), source);
            }
            return;
        }
        if matches!(expr, Expr::Capture(..)) {
            if let Some(owner) = owner {
                self.owners.insert(pointer, owner);
            }
        }
        match expr {
            Expr::Seq(items) | Expr::Choice(items) | Expr::And(items) => {
                let key = match expr {
                    Expr::Seq(_) => "seq",
                    Expr::Choice(_) => "choice",
                    _ => "and",
                };
                for (index, child) in items.iter().enumerate() {
                    self.visit(
                        child,
                        &format!("{path}/{key}/{index}"),
                        final_position && (matches!(expr, Expr::Choice(_)) || index + 1 == items.len()),
                        owner,
                        source,
                    );
                }
            }
            Expr::Optional(inner, _) => self.visit(inner, &format!("{path}/optional"), final_position, owner, source),
            Expr::Repeat(inner, separator, _) => {
                self.visit(inner, &format!("{path}/repeat"), false, owner, source);
                if let Some(separator) = separator {
                    self.visit(separator, &format!("{path}/separator"), false, owner, source);
                }
            }
            Expr::Capture(_, inner) | Expr::Tested(_, _, inner) => {
                self.visit(inner, &format!("{path}/expr"), final_position, owner, source)
            }
            _ => {}
        }
    }
    fn fail(&self, grammar: &StageGrammar, group: &Group, code: &str, message: &str) -> Error {
        let source = &grammar.rules[group.source.0].alternatives[group.source.1];
        Error::grammar(format!("{code}: {message}"))
            .in_document(&source.document)
            .at(source.at.0, source.at.1)
            .in_stage(&grammar.name)
    }
    pub fn validate_tags(&self, grammar: &StageGrammar, lowered: &Lowered) -> Result<(), Error> {
        let mut unsafe_tags = FxSet::default();
        let mut users: FxMap<u32, Vec<u32>> = FxMap::default();
        let mut helpers = FxMap::default();
        for production in &lowered.prods {
            let helper = lowered.rules[production.rule as usize].helper;
            let slot = production.slot.as_ref().expect("ranked validation metadata");
            if let Some(path) = slot.path {
                if let Some(group) = self.expressions.get(&path) {
                    helpers.insert(*group, production.rule);
                }
            }
            let terms: Vec<&Term> = if helper {
                slot.tags.iter().collect()
            } else {
                let source = &grammar.rules[slot.source.0].alternatives[slot.source.1];
                source.alternative.tags.iter().chain(source.clauses.tags.iter()).collect()
            };
            if !terms.is_empty() {
                if terms.iter().any(|term| !matches!(term, Term::EmptySet)) {
                    unsafe_tags.insert(production.rule);
                }
            } else if let [symbol] = production.syms.as_slice() {
                match symbol {
                    Sym::T(_) => {
                        unsafe_tags.insert(production.rule);
                    }
                    Sym::N(child) => users.entry(*child).or_default().push(production.rule),
                }
            }
        }
        let mut pending: Vec<_> = unsafe_tags.iter().copied().collect();
        let mut at = 0;
        while at < pending.len() {
            for parent in users.get(&pending[at]).into_iter().flatten() {
                if unsafe_tags.insert(*parent) {
                    pending.push(*parent);
                }
            }
            at += 1;
        }
        for group in &self.groups {
            let Some(&helper) = helpers.get(&group.id) else {
                continue;
            };
            if !unsafe_tags.contains(&helper) {
                continue;
            }
            let mut outward = vec![helper];
            let mut seen = FxSet::default();
            seen.insert(helper);
            let mut index = 0;
            while index < outward.len() {
                for &parent in users.get(&outward[index]).into_iter().flatten() {
                    if parent as usize == group.source.0 {
                        return Err(self.fail(
                            grammar,
                            group,
                            "ranked-choice-tags",
                            "A ranked choice must discard its returned tags or return provably empty tags.",
                        ));
                    }
                    if lowered.rules[parent as usize].helper
                        && lowered.prods[lowered.rules[parent as usize].prods[0] as usize].owner as usize
                            == group.source.0
                        && seen.insert(parent)
                    {
                        outward.push(parent);
                    }
                }
                index += 1;
            }
        }
        Ok(())
    }
}
