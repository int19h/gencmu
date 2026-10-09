//! Written ranked groups and their local loading rules.

use crate::clauses::{simplify_cond, Simple};
use crate::dom::{Arg, Cond, EmitItem, Expr, Term};
use crate::error::{Error, GroupSite};
use crate::fxhash::{FxMap, FxSet};
use crate::grammar::StageGrammar;
use crate::json::Json;
use crate::lower::{Lowered, Sym};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone)]
pub(crate) struct Group {
    pub id: usize,
    pub source: (usize, usize),
    pub path: String,
    pub expression: usize,
    pub final_position: bool,
    pub names: BTreeSet<String>,
}
#[derive(Debug, Clone, Default)]
pub(crate) struct RankedGroups {
    pub groups: Vec<Group>,
    pub expressions: FxMap<usize, usize>,
    pub owners: FxMap<usize, usize>,
    pub paths: FxMap<usize, String>,
    clause_errors: FxMap<usize, Error>,
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
pub(crate) fn cond_reads(cond: &Cond, out: &mut BTreeSet<String>) {
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
        for group in out.groups.clone() {
            if let Err(error) = out.validate_clauses(grammar, &group) {
                out.clause_errors.insert(group.id, error);
            }
        }
        Ok(out)
    }
    fn validate_clauses(&self, grammar: &StageGrammar, group: &Group) -> Result<(), Error> {
        let source = &grammar.rules[group.source.0].alternatives[group.source.1];
        for route in routes(&source.alternative.expr, self) {
            let Some(&(end, option)) = route.ends.get(&group.id) else {
                continue;
            };
            let has = |name: &str| name.is_empty() || route.captures.contains_key(name);
            let private = |reads: &BTreeSet<String>| {
                reads.iter().any(|name| {
                    route.captures.get(name).is_some_and(|&(node, _)| self.owners.get(&node) == Some(&group.id))
                })
            };
            for (condition_index, condition) in source.clauses.conditions.iter().enumerate() {
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
                if reads.iter().any(
                    |name| {
                        if name.is_empty() {
                            !group.final_position
                        } else {
                            route.captures[name].1 > end
                        }
                    },
                ) {
                    return Err(self
                        .fail(
                            grammar,
                            group,
                            "ranked-choice-continuation",
                            "A private capture requires a condition ready when its ranked choice closes.",
                        )
                        .ranked_detail(
                            option,
                            self.written_clause(grammar, group, "conditions", Some(condition_index)),
                        ));
                }
            }
            for (term, clause) in source
                .alternative
                .tags
                .iter()
                .map(|term| (term, "alternative-tags"))
                .chain(source.clauses.tags.iter().map(|term| (term, "tags")))
            {
                let mut reads = BTreeSet::new();
                term_reads(term, &mut reads);
                if private(&reads) {
                    return Err(self
                        .fail(
                            grammar,
                            group,
                            "ranked-choice-export",
                            "A tag term cannot read a private ranked capture.",
                        )
                        .ranked_detail(option, self.written_clause(grammar, group, clause, None)));
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
                return Err(self
                    .fail(
                        grammar,
                        group,
                        "ranked-choice-export",
                        "An emission item cannot read a private ranked capture.",
                    )
                    .ranked_detail(option, self.written_clause(grammar, group, "emit", None)));
            }
        }
        Ok(())
    }
    fn written_clause(&self, grammar: &StageGrammar, group: &Group, key: &str, index: Option<usize>) -> Option<Json> {
        let source = &grammar.rules[group.source.0].alternatives[group.source.1];
        let written = source.written.as_ref()?;
        let value = if key == "alternative-tags" {
            written.get("alternatives")?.as_array()?.get(source.written_alternative)?.get("tags")?
        } else {
            written.get(key)?
        };
        Some(if let Some(index) = index { value.as_array()?.get(index)?.clone() } else { value.clone() })
    }
    fn site(&self, grammar: &StageGrammar, source: (usize, usize), path: String, ranked: bool) -> GroupSite {
        let alternative = &grammar.rules[source.0].alternatives[source.1];
        let at =
            if ranked { alternative.alternative.ranked_locations.get(&path).copied() } else { Some(alternative.at) };
        GroupSite {
            document: Some(alternative.document.to_string()),
            at,
            rule: grammar.rules[source.0].name.clone(),
            alternative: source.1,
            path,
        }
    }
    fn written_expression(&self, grammar: &StageGrammar, group: &Group) -> Option<Json> {
        let source = &grammar.rules[group.source.0].alternatives[group.source.1];
        let mut value =
            source.written.as_ref()?.get("alternatives")?.as_array()?.get(source.written_alternative)?.get("expr")?;
        for part in group.path.split('/').skip(1) {
            value = if let Some(items) = value.as_array() {
                items.get(part.parse::<usize>().ok()?)?
            } else {
                value.get(part)?
            };
        }
        Some(value.clone())
    }
    fn visit(&mut self, expr: &Expr, path: &str, final_position: bool, owner: Option<usize>, source: (usize, usize)) {
        let pointer = expr as *const Expr as usize;
        self.paths.insert(pointer, path.to_string());
        if let Expr::Ranked(items) = expr {
            let id = self.groups.len();
            self.groups.push(Group {
                id,
                source,
                path: path.into(),
                expression: pointer,
                final_position,
                names: capture_names(expr),
            });
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
        let site = self.site(grammar, group.source, group.path.clone(), true);
        let mut error = Error::grammar(format!("{code}: {message}")).coded(code);
        if let Some(document) = &site.document {
            error = error.in_document(document);
        }
        if let Some((line, column)) = site.at {
            error = error.at(line, column);
        }
        error.group = Some(site);
        error
    }
    fn tag_failure(
        &self,
        grammar: &StageGrammar,
        lowered: &Lowered,
        group: &Group,
        helper: u32,
        unsafe_tags: &FxSet<u32>,
    ) -> Error {
        let mut error = self.fail(
            grammar,
            group,
            "ranked-choice-tags",
            "A ranked choice must discard its returned tags or return provably empty tags.",
        );
        error.expression = self.written_expression(grammar, group);
        let mut queue = vec![(helper, vec![error.group.clone().unwrap()], None)];
        let mut seen = FxSet::default();
        seen.insert(helper);
        let mut at = 0;
        while at < queue.len() {
            let (rule, steps, option) = queue[at].clone();
            at += 1;
            for &id in &lowered.rules[rule as usize].prods {
                let production = &lowered.prods[id as usize];
                let slot = production.slot.as_ref().unwrap();
                let option = option.or(slot.ranked.map(|(_, option)| option));
                let mut steps = steps.clone();
                if rule != helper {
                    steps.push(self.site(
                        grammar,
                        slot.source,
                        slot.path.and_then(|p| self.paths.get(&p)).cloned().unwrap_or_default(),
                        false,
                    ));
                }
                let terms: Vec<_> = if lowered.rules[rule as usize].helper {
                    slot.tags.iter().collect()
                } else {
                    let source = &grammar.rules[slot.source.0].alternatives[slot.source.1];
                    source.alternative.tags.iter().chain(source.clauses.tags.iter()).collect()
                };
                if terms.iter().any(|term| !matches!(term, Term::EmptySet))
                    || terms.is_empty() && matches!(production.syms.as_slice(), [Sym::T(_)])
                {
                    error.option = option;
                    error.inheritance = Some(steps);
                    return error;
                }
                if terms.is_empty() {
                    if let [Sym::N(child)] = production.syms.as_slice() {
                        if unsafe_tags.contains(child) && seen.insert(*child) {
                            queue.push((*child, steps, option));
                        }
                    }
                }
            }
        }
        error
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
            if let Some(error) = self.clause_errors.get(&group.id) {
                return Err(error.clone());
            }
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
                        return Err(self.tag_failure(grammar, lowered, group, helper, &unsafe_tags));
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

pub(crate) fn capture_names(expr: &Expr) -> BTreeSet<String> {
    let mut names = BTreeSet::new();
    let mut pending = vec![expr];
    while let Some(expr) = pending.pop() {
        match expr {
            Expr::Capture(name, child) => {
                names.insert(name.clone());
                pending.push(child);
            }
            Expr::Seq(items) | Expr::Choice(items) | Expr::Ranked(items) | Expr::And(items) => pending.extend(items),
            Expr::Optional(child, _) | Expr::Tested(_, _, child) => pending.push(child),
            Expr::Repeat(child, separator, _) => {
                pending.push(child);
                if let Some(s) = separator {
                    pending.push(s);
                }
            }
            _ => {}
        }
    }
    names
}

pub(crate) fn contains_ranked(expr: &Expr) -> bool {
    let mut pending = vec![expr];
    while let Some(expr) = pending.pop() {
        if matches!(expr, Expr::Ranked(_)) {
            return true;
        }
        pending.extend(expression_children(expr).into_iter().map(|(child, _)| child));
    }
    false
}
fn expression_children(expr: &Expr) -> Vec<(&Expr, String)> {
    match expr {
        Expr::Seq(items) | Expr::Choice(items) | Expr::And(items) | Expr::Ranked(items) => {
            let key = match expr {
                Expr::Seq(_) => "seq",
                Expr::Choice(_) => "choice",
                Expr::And(_) => "and",
                _ => "ranked",
            };
            items.iter().enumerate().map(|(i, child)| (child, format!("/{key}/{i}"))).collect()
        }
        Expr::Optional(child, _) => vec![(child, "/optional".into())],
        Expr::Repeat(child, separator, _) => {
            let mut out = vec![(child.as_ref(), "/repeat".into())];
            if let Some(separator) = separator {
                out.push((separator.as_ref(), "/separator".into()));
            }
            out
        }
        Expr::Capture(_, child) | Expr::Tested(_, _, child) => vec![(child, "/expr".into())],
        _ => vec![],
    }
}
pub(crate) fn restore_locations(
    dom: &mut crate::dom::Dom,
    tokens: &[crate::result::Token],
    position: &dyn Fn(usize) -> (usize, usize),
) {
    let separators: Vec<_> =
        tokens.iter().filter(|token| token.text == "≻").map(|token| position(token.source.start)).collect();
    let mut index = 0;
    for rule in &mut dom.rules {
        for alternative in &mut rule.alternatives {
            let locations = &mut alternative.ranked_locations;
            let mut pending = vec![(&alternative.expr, String::new(), 0)];
            while let Some((expr, path, action)) = pending.pop() {
                if action == 1 {
                    if let Some(at) = separators.get(index) {
                        locations.insert(path, *at);
                    }
                } else if action == 2 {
                    index += 1;
                } else if let Expr::Ranked(options) = expr {
                    for (i, option) in options.iter().enumerate().skip(1).rev() {
                        pending.push((option, format!("{path}/ranked/{i}"), 0));
                        pending.push((expr, String::new(), 2));
                    }
                    pending.push((expr, path.clone(), 1));
                    if let Some(option) = options.first() {
                        pending.push((option, format!("{path}/ranked/0"), 0));
                    }
                } else {
                    for (child, component) in expression_children(expr).into_iter().rev() {
                        pending.push((child, format!("{path}{component}"), 0));
                    }
                }
            }
        }
    }
    if index != separators.len() {
        for rule in &mut dom.rules {
            for alternative in &mut rule.alternatives {
                alternative.ranked_locations.clear();
            }
        }
    }
}
pub(crate) fn syntax_failure(tokens: &[crate::result::Token], at: usize) -> bool {
    if tokens.get(at).is_some_and(|token| token.text == "≻")
        || at > 0 && tokens.get(at - 1).is_some_and(|token| token.text == "≻")
    {
        return true;
    }
    if !tokens.get(at).is_some_and(|token| token.text == "|") {
        return false;
    }
    let mut levels = vec![false];
    for token in tokens.iter().take(at) {
        match token.text.as_str() {
            "(" | "[" | "{" => levels.push(false),
            ")" | "]" | "}" => {
                levels.pop();
            }
            "≻" => {
                if let Some(level) = levels.last_mut() {
                    *level = true;
                }
            }
            _ => {
                if token.text.starts_with('%') {
                    if let Some(level) = levels.last_mut() {
                        *level = false;
                    }
                }
            }
        }
    }
    levels.last().copied().unwrap_or(false)
}
