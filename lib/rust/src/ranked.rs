//! Written ranked groups and their local loading rules.

use crate::clauses::{simplify_cond, Simple};
use crate::dom::{Arg, Cond, EmitItem, Expr, Term};
use crate::error::{Error, GroupSite};
use crate::fxhash::{FxMap, FxSet};
use crate::grammar::StageGrammar;
use crate::json::Json;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone)]
pub(crate) struct Group {
    pub id: usize,
    pub source: (usize, usize),
    pub path: String,
    pub expression: usize,
    pub at: Option<(usize, usize)>,
    pub final_position: bool,
    pub names: BTreeSet<String>,
}
#[derive(Debug, Clone, Default)]
pub(crate) struct RankedGroups {
    pub groups: Vec<Group>,
    pub expressions: FxMap<usize, usize>,
    pub owners: FxMap<usize, usize>,
    pub paths: FxMap<usize, String>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct Span {
    productive: bool,
    nonempty: bool,
}
impl Default for Span {
    fn default() -> Self {
        Self { productive: true, nonempty: false }
    }
}
impl Span {
    fn then(self, right: Self) -> Self {
        let productive = self.productive && right.productive;
        Self { productive, nonempty: productive && (self.nonempty || right.nonempty) }
    }
}
// Positions count relevant capture closes, independently of other symbols.
#[derive(Clone, Default, PartialEq, Eq, Hash)]
struct Route {
    length: usize,
    captures: BTreeMap<String, (Option<usize>, usize)>,
    ends: BTreeMap<usize, (usize, usize, Span)>,
    bindings: BTreeMap<String, usize>,
    span: Span,
}
struct ClauseAnalysis {
    conditions: Vec<BTreeSet<String>>,
    exports: BTreeSet<String>,
    projections: FxMap<BTreeSet<String>, Vec<Route>>,
}
fn join(mut left: Route, right: &Route) -> Route {
    let offset = left.length;
    for (name, &(owner, at)) in &right.captures {
        left.captures.insert(name.clone(), (owner, at + offset));
    }
    for (&group, &(at, option, prefix)) in &right.ends {
        left.ends.insert(group, (at + offset, option, left.span.then(prefix)));
    }
    left.bindings.extend(right.bindings.clone());
    left.span = left.span.then(right.span);
    left.length += right.length;
    left
}
fn unique(routes: impl IntoIterator<Item = Route>) -> Vec<Route> {
    let mut seen = FxSet::default();
    routes.into_iter().filter(|route| seen.insert(route.clone())).collect()
}
fn product(left: Vec<Route>, right: Vec<Route>) -> Vec<Route> {
    unique(left.into_iter().flat_map(|left| right.iter().map(move |right| join(left.clone(), right))))
}
fn routes(
    expr: &Expr,
    groups: &RankedGroups,
    needed: &BTreeSet<String>,
    spans: &SymbolSpans,
    grammar: &StageGrammar,
) -> Vec<Route> {
    let visit = |child: &Expr| routes(child, groups, needed, spans, grammar);
    match expr {
        Expr::Empty | Expr::Remainder => vec![Route::default()],
        Expr::Seq(items) => items.iter().fold(vec![Route::default()], |left, child| product(left, visit(child))),
        Expr::Choice(items) => unique(items.iter().flat_map(visit)),
        Expr::Ranked(items, _) => {
            let group = groups.expressions[&(expr as *const Expr as usize)];
            let names: Vec<_> = groups.groups[group].names.intersection(needed).collect();
            unique(items.iter().enumerate().flat_map(|(option, child)| {
                let names = &names;
                visit(child).into_iter().map(move |mut route| {
                    if !names.is_empty() {
                        for name in names {
                            route.bindings.entry((*name).clone()).or_insert(group);
                        }
                        route.ends.insert(group, (route.length, option, Span::default()));
                    }
                    route
                })
            }))
        }
        Expr::And(items) => {
            struct Selected {
                mask: usize,
                order: Vec<usize>,
                route: Route,
            }
            let mut states = vec![Selected { mask: 0, order: vec![], route: Route::default() }];
            for (bit, child) in items.iter().enumerate() {
                let parts = visit(child);
                let mut candidates = Vec::new();
                for state in &states {
                    for (index, part) in parts.iter().enumerate() {
                        let mut order = state.order.clone();
                        order.push(index);
                        candidates.push(Selected {
                            mask: state.mask | (1 << bit),
                            order,
                            route: join(state.route.clone(), part),
                        });
                    }
                }
                candidates.extend(states);
                candidates.sort_by(|a, b| a.mask.cmp(&b.mask).then(a.order.cmp(&b.order)));
                let mut seen = FxSet::default();
                states = candidates
                    .into_iter()
                    .filter(|state| seen.insert((state.mask != 0, state.route.clone())))
                    .collect();
            }
            unique(states.into_iter().filter(|state| state.mask != 0).map(|state| state.route))
        }
        Expr::Optional(inner, _, _) => unique(std::iter::once(Route::default()).chain(visit(inner))),
        Expr::Repeat(inner, separator, _) => {
            let items = visit(inner);
            if let Some(separator) = separator {
                unique(items.clone().into_iter().chain(product(items, visit(separator))))
            } else {
                items
            }
        }
        _ => {
            let mut route = Route { span: spans.atom(expr, grammar), ..Route::default() };
            if let Expr::Capture(name, _) = expr {
                if needed.contains(name) {
                    route.length = 1;
                    route
                        .captures
                        .insert(name.clone(), (groups.owners.get(&(expr as *const Expr as usize)).copied(), 1));
                }
            }
            vec![route]
        }
    }
}
enum ReadPart<'a> {
    Term(&'a Term),
    Condition(&'a Cond),
}

fn capture_reads(start: ReadPart<'_>, out: &mut BTreeSet<String>) {
    let mut stack = vec![start];
    while let Some(part) = stack.pop() {
        match part {
            ReadPart::Term(term) => match term {
                Term::Capture(name) => {
                    out.insert(name.clone());
                }
                Term::Union(items) | Term::Intersection(items) => stack.extend(items.iter().map(ReadPart::Term)),
                Term::Difference(a, b) => stack.extend([ReadPart::Term(a), ReadPart::Term(b)]),
                Term::Call(_, args) => stack.extend(args.iter().filter_map(|arg| match arg {
                    Arg::Term(t) => Some(ReadPart::Term(t)),
                    _ => None,
                })),
                Term::If(c, t) => stack.extend([ReadPart::Condition(c), ReadPart::Term(t)]),
                _ => {}
            },
            ReadPart::Condition(cond) => match cond {
                Cond::Forest(term) => stack.push(ReadPart::Term(term)),
                Cond::SourceQuery(..) => unreachable!("source queries expand before grammar checks"),
                Cond::Captured(name) => {
                    out.insert(name.clone());
                }
                Cond::Compare(_, a, b, _) => stack.extend([ReadPart::Term(a), ReadPart::Term(b)]),
                Cond::Matches(t, _)
                | Cond::Begins(t, _)
                | Cond::Ends(t, _)
                | Cond::Initial(t)
                | Cond::Final(t)
                | Cond::Boundary(_, t, _, _) => stack.push(ReadPart::Term(t)),
                Cond::Not(c) => stack.push(ReadPart::Condition(c)),
                Cond::All(items) | Cond::Any(items) => stack.extend(items.iter().map(ReadPart::Condition)),
                Cond::If(a, b) => stack.extend([ReadPart::Condition(a), ReadPart::Condition(b)]),
            },
        }
    }
}

fn term_reads(term: &Term, out: &mut BTreeSet<String>) {
    capture_reads(ReadPart::Term(term), out);
}

pub(crate) fn cond_reads(cond: &Cond, out: &mut BTreeSet<String>) {
    capture_reads(ReadPart::Condition(cond), out);
}
impl RankedGroups {
    pub fn new(grammar: &StageGrammar) -> Self {
        let mut out = Self::default();
        for (rule, definition) in grammar.rules.iter().enumerate() {
            for (alternative, source) in definition.alternatives.iter().enumerate() {
                out.visit(&source.alternative.expr, "", true, None, (rule, alternative));
            }
        }
        out
    }
    fn validate_clauses(
        &self,
        grammar: &StageGrammar,
        group: &Group,
        spans: &mut Option<SymbolSpans>,
        analyses: &mut FxMap<(usize, usize), ClauseAnalysis>,
    ) -> Result<(), Error> {
        let source = &grammar.rules[group.source.0].alternatives[group.source.1];
        let analysis = analyses.entry(group.source).or_insert_with(|| ClauseAnalysis {
            conditions: source
                .clauses
                .conditions
                .iter()
                .map(|condition| {
                    let mut names = BTreeSet::new();
                    cond_reads(condition, &mut names);
                    names
                })
                .collect(),
            exports: export_reads(source),
            projections: FxMap::default(),
        });
        let mut needed: BTreeSet<String> = analysis.exports.intersection(&group.names).cloned().collect();
        for names in &analysis.conditions {
            if !names.is_disjoint(&group.names) {
                needed.extend(names.iter().cloned());
            }
        }
        needed.remove("");
        if needed.is_empty() {
            return Ok(());
        }
        let paths = analysis.projections.entry(needed.clone()).or_insert_with(|| {
            routes(
                &source.alternative.expr,
                self,
                &needed,
                spans.get_or_insert_with(|| SymbolSpans::new(grammar)),
                grammar,
            )
        });
        for route in paths.iter() {
            let Some(&(end, option, prefix)) = route.ends.get(&group.id) else {
                continue;
            };
            let has = |name: &str| name.is_empty() || route.captures.contains_key(name);
            let private = |reads: &BTreeSet<String>| {
                reads.iter().any(|name| route.captures.get(name).is_some_and(|&(owner, _)| owner == Some(group.id)))
            };
            for (condition_index, condition) in source.clauses.conditions.iter().enumerate() {
                let mut original = BTreeSet::new();
                cond_reads(condition, &mut original);
                if !original.iter().any(|name| route.bindings.get(name) == Some(&group.id)) {
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
                if let Some(Cond::Boundary(false, Term::Capture(_), targets, _)) =
                    crate::boundary::dom_atoms(&effective)
                        .into_iter()
                        .find(|c| matches!(c,Cond::Boundary(false,Term::Capture(n),_,_) if n.is_empty()))
                {
                    if prefix.nonempty {
                        let test = format!("$.preceded-by({})", targets.join(" | "));
                        let message=format!("Condition {} of {} combines {test} with a private capture in option {}. That option can start after the rule starts. Move the condition into a rule that starts with the ranked group, or test the private capture itself.",condition_index+1,grammar.rules[group.source.0].name,option+1);
                        return Err(self.fail(grammar, group, "ranked-choice-boundary", &message).ranked_detail(
                            option,
                            self.written_clause(grammar, group, "conditions", Some(condition_index)),
                        ));
                    }
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
            for (term, clause) in source
                .alternative
                .strings
                .value
                .iter()
                .map(|t| (t, "alternative-value"))
                .chain(source.alternative.strings.image.iter().map(|t| (t, "alternative-image")))
                .chain(source.clauses.strings.value.iter().map(|t| (t, "value")))
                .chain(source.clauses.strings.image.iter().map(|t| (t, "image")))
            {
                let mut reads = BTreeSet::new();
                term_reads(term, &mut reads);
                if private(&reads) {
                    return Err(self
                        .fail(grammar, group, "ranked-choice-export", "A recipe cannot read a private ranked capture.")
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
                let (tags, strings) = match item {
                    EmitItem::Capture(_, tags, attachments) => (tags, &attachments.strings),
                    EmitItem::Insert(tags, strings) => (tags, strings),
                };
                if let Some(tags) = tags {
                    term_reads(tags, &mut reads);
                }
                for recipe in strings.value.iter().chain(&strings.image) {
                    term_reads(recipe, &mut reads);
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
        let value = if let Some(key) = key.strip_prefix("alternative-") {
            written.get("alternatives")?.as_array()?.get(source.written_alternative)?.get(key)?
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
        if let Expr::Ranked(items, at) = expr {
            let id = self.groups.len();
            self.groups.push(Group {
                id,
                source,
                path: path.into(),
                expression: pointer,
                at: *at,
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
            Expr::Optional(inner, _, _) => {
                self.visit(inner, &format!("{path}/optional"), final_position, owner, source)
            }
            Expr::Repeat(inner, separator, _) => {
                self.visit(inner, &format!("{path}/repeat"), false, owner, source);
                if let Some(separator) = separator {
                    self.visit(separator, &format!("{path}/separator"), false, owner, source);
                }
            }
            Expr::Capture(_, inner) | Expr::Splice(inner) | Expr::Tested(_, _, inner) => {
                self.visit(inner, &format!("{path}/expr"), final_position, owner, source)
            }
            _ => {}
        }
    }
    fn fail(&self, grammar: &StageGrammar, group: &Group, code: &str, message: &str) -> Error {
        let mut site = self.site(grammar, group.source, group.path.clone(), true);
        if group.at.is_some() {
            site.at = group.at;
        }
        let mut error = Error::grammar(format!("{code}: {message}")).coded(code);
        if let Some(document) = &site.document {
            error = error.in_document(document);
        }
        if let Some((line, column)) = site.at {
            error = error.at(line, column);
        }
        error.diagnostic.get_or_insert_with(Default::default).group = Some(site);
        error
    }
    fn tag_failure(
        &self,
        grammar: &StageGrammar,
        graph: &TagGraph,
        group: &Group,
        helper: usize,
        unsafe_tags: &[bool],
    ) -> Error {
        let mut error = self.fail(
            grammar,
            group,
            "ranked-choice-tags",
            "A ranked choice must discard its returned tags or return provably empty tags.",
        );
        error.diagnostic.get_or_insert_with(Default::default).expression = self.written_expression(grammar, group);
        let mut queue = vec![(helper, vec![error.group().cloned().unwrap()], None)];
        let mut seen = FxSet::default();
        seen.insert(helper);
        let mut at = 0;
        while at < queue.len() {
            let (node, steps, option) = queue[at].clone();
            at += 1;
            for route in &graph.nodes[node].routes {
                let option = option.or(route.option);
                let mut steps = steps.clone();
                if node != helper {
                    steps.push(self.site(
                        grammar,
                        route.source,
                        self.paths.get(&route.expression).cloned().unwrap_or_default(),
                        false,
                    ));
                }
                if route.unsafe_tags || !route.tagged && route.children.contains(&None) {
                    let diagnostic = error.diagnostic.get_or_insert_with(Default::default);
                    diagnostic.option = option;
                    diagnostic.inheritance = Some(steps);
                    return error;
                }
                if !route.tagged {
                    for &child in route.children.iter().flatten() {
                        if unsafe_tags[child] && seen.insert(child) {
                            queue.push((child, steps.clone(), option));
                        }
                    }
                }
            }
        }
        error
    }
    pub fn validate_tags(&self, grammar: &StageGrammar) -> Result<(), Error> {
        let graph = TagGraph::new(grammar, self);
        let mut unsafe_tags = vec![false; graph.nodes.len()];
        let mut users = vec![vec![]; graph.nodes.len()];
        for (index, node) in graph.nodes.iter().enumerate() {
            for route in &node.routes {
                if route.tagged {
                    unsafe_tags[index] |= route.unsafe_tags;
                } else {
                    for child in &route.children {
                        if let Some(child) = child {
                            users[*child].push(index);
                        } else {
                            unsafe_tags[index] = true;
                        }
                    }
                }
            }
        }
        let mut pending: Vec<_> =
            unsafe_tags.iter().enumerate().filter_map(|(i, &marked)| marked.then_some(i)).collect();
        let mut at = 0;
        while at < pending.len() {
            for &parent in &users[pending[at]] {
                if !unsafe_tags[parent] {
                    unsafe_tags[parent] = true;
                    pending.push(parent);
                }
            }
            at += 1;
        }
        let mut spans = None;
        let mut analyses = FxMap::default();
        for group in &self.groups {
            self.validate_clauses(grammar, group, &mut spans, &mut analyses)?;
            let helper = graph.groups[&group.id];
            if !unsafe_tags[helper] {
                continue;
            }
            let mut outward = vec![helper];
            let mut seen = FxSet::default();
            seen.insert(helper);
            let mut at = 0;
            while at < outward.len() {
                for &parent in &users[outward[at]] {
                    let node = &graph.nodes[parent];
                    if !node.helper && node.owner == group.source.0 {
                        return Err(self.tag_failure(grammar, &graph, group, helper, &unsafe_tags));
                    }
                    if node.helper && node.owner == group.source.0 && seen.insert(parent) {
                        outward.push(parent);
                    }
                }
                at += 1;
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
            Expr::Seq(items) | Expr::Choice(items) | Expr::Ranked(items, _) | Expr::And(items) => pending.extend(items),
            Expr::Optional(child, _, _) | Expr::Tested(_, _, child) => pending.push(child),
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
        if matches!(expr, Expr::Ranked(_, _)) {
            return true;
        }
        pending.extend(expression_children(expr).into_iter().map(|(child, _)| child));
    }
    false
}
fn expression_children(expr: &Expr) -> Vec<(&Expr, String)> {
    match expr {
        Expr::Seq(items) | Expr::Choice(items) | Expr::And(items) | Expr::Ranked(items, _) => {
            let key = match expr {
                Expr::Seq(_) => "seq",
                Expr::Choice(_) => "choice",
                Expr::And(_) => "and",
                _ => "ranked",
            };
            items.iter().enumerate().map(|(i, child)| (child, format!("/{key}/{i}"))).collect()
        }
        Expr::Optional(child, _, _) => vec![(child, "/optional".into())],
        Expr::Repeat(child, separator, _) => {
            let mut out = vec![(child.as_ref(), "/repeat".into())];
            if let Some(separator) = separator {
                out.push((separator.as_ref(), "/separator".into()));
            }
            out
        }
        Expr::Splice(child) => vec![(child, "/splice".into())],
        Expr::Capture(_, child) | Expr::Tested(_, _, child) => vec![(child, "/expr".into())],
        _ => vec![],
    }
}
pub(crate) fn restore_locations(dom: &mut crate::dom::Dom, source: &crate::dom::Dom) {
    crate::dom::source::restore_locations(dom, source);
}
pub(crate) fn syntax_failure(tokens: &[crate::result::Token], at: usize) -> bool {
    if tokens.get(at).is_some_and(|token| token.value == "≻")
        || at > 0 && tokens.get(at - 1).is_some_and(|token| token.value == "≻")
    {
        return true;
    }
    if !tokens.get(at).is_some_and(|token| token.value == "|") {
        return false;
    }
    let mut levels = vec![false];
    for token in tokens.iter().take(at) {
        match token.value.as_str() {
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
                if token.value.starts_with('%') {
                    if let Some(level) = levels.last_mut() {
                        *level = false;
                    }
                }
            }
        }
    }
    levels.last().copied().unwrap_or(false)
}

fn export_reads(source: &crate::grammar::StitchedAlternative) -> BTreeSet<String> {
    let mut reads = BTreeSet::new();
    for term in source
        .alternative
        .tags
        .iter()
        .chain(&source.clauses.tags)
        .chain(&source.alternative.strings.value)
        .chain(&source.alternative.strings.image)
        .chain(&source.clauses.strings.value)
        .chain(&source.clauses.strings.image)
    {
        term_reads(term, &mut reads);
    }
    for item in source.clauses.emit.iter().flatten() {
        let (tags, strings) = match item {
            EmitItem::Capture(name, tags, attachments) => {
                reads.insert(name.clone());
                reads.extend(attachments.before.iter().chain(&attachments.after).cloned());
                (tags, &attachments.strings)
            }
            EmitItem::Insert(tags, strings) => (tags, strings),
        };
        for term in tags.iter().chain(&strings.value).chain(&strings.image) {
            term_reads(term, &mut reads);
        }
    }
    reads
}

struct TagRoute {
    source: (usize, usize),
    expression: usize,
    option: Option<usize>,
    tagged: bool,
    unsafe_tags: bool,
    children: Vec<Option<usize>>,
}
struct TagNode {
    owner: usize,
    helper: bool,
    routes: Vec<TagRoute>,
}
struct TagGraph {
    nodes: Vec<TagNode>,
    groups: FxMap<usize, usize>,
}
#[derive(Clone, Default)]
struct Unary {
    zero: bool,
    children: Vec<Option<usize>>,
}
impl TagGraph {
    fn node(&mut self, owner: usize, helper: bool) -> usize {
        let id = self.nodes.len();
        self.nodes.push(TagNode { owner, helper, routes: vec![] });
        id
    }
    fn new(grammar: &StageGrammar, ranked: &RankedGroups) -> Self {
        let mut graph = Self { nodes: vec![], groups: FxMap::default() };
        for owner in 0..grammar.rules.len() {
            graph.node(owner, false);
        }
        let mut captured = FxMap::default();
        for (rule, definition) in grammar.rules.iter().enumerate() {
            for (alternative, source) in definition.alternatives.iter().enumerate() {
                let mut memo = FxMap::default();
                let expr = &source.alternative.expr;
                let body = if let Expr::Repeat(inner, separator, Some(_)) = expr {
                    let body = graph.describe(grammar, ranked, (rule, alternative), inner, &mut memo, &mut captured);
                    if let Some(separator) = separator {
                        graph.describe(grammar, ranked, (rule, alternative), separator, &mut memo, &mut captured);
                    }
                    body
                } else {
                    graph.describe(grammar, ranked, (rule, alternative), expr, &mut memo, &mut captured)
                };
                let terms: Vec<_> = source.alternative.tags.iter().chain(&source.clauses.tags).collect();
                graph.nodes[rule].routes.push(TagRoute {
                    source: (rule, alternative),
                    expression: expr as *const Expr as usize,
                    option: None,
                    tagged: !terms.is_empty(),
                    unsafe_tags: terms.iter().any(|t| !matches!(t, Term::EmptySet)),
                    children: body.children,
                });
            }
        }
        graph
    }
    fn describe(
        &mut self,
        grammar: &StageGrammar,
        ranked: &RankedGroups,
        source: (usize, usize),
        expr: &Expr,
        memo: &mut FxMap<usize, Unary>,
        captured: &mut FxMap<usize, bool>,
    ) -> Unary {
        let key = expr as *const Expr as usize;
        if let Some(known) = memo.get(&key) {
            return known.clone();
        }
        let result = match expr {
            Expr::Empty | Expr::Remainder => Unary { zero: true, children: vec![] },
            Expr::Seq(items) => {
                let parts: Vec<_> =
                    items.iter().map(|child| self.describe(grammar, ranked, source, child, memo, captured)).collect();
                let blocking = parts.iter().filter(|p| !p.zero).count();
                Unary {
                    zero: blocking == 0,
                    children: parts
                        .into_iter()
                        .filter(|p| blocking - usize::from(!p.zero) == 0)
                        .flat_map(|p| p.children)
                        .collect(),
                }
            }
            Expr::Choice(items) | Expr::And(items) => {
                let mut result = Unary::default();
                for child in items {
                    let part = self.describe(grammar, ranked, source, child, memo, captured);
                    result.zero |= part.zero;
                    result.children.extend(part.children);
                }
                result
            }
            Expr::Optional(inner, crate::dom::Mark::Plain, _) if common_capture(inner, captured) => {
                Unary { zero: false, children: self.describe(grammar, ranked, source, inner, memo, captured).children }
            }
            Expr::Ranked(..) | Expr::Optional(..) | Expr::Repeat(..) => {
                let helper = self.node(source.0, true);
                let result = Unary { zero: false, children: vec![Some(helper)] };
                memo.insert(key, result.clone());
                let mut route = |this: &mut Self, child: &Expr, option| {
                    let children = this.describe(grammar, ranked, source, child, memo, captured).children;
                    this.nodes[helper].routes.push(TagRoute {
                        source,
                        expression: key,
                        option,
                        tagged: false,
                        unsafe_tags: false,
                        children,
                    });
                };
                match expr {
                    Expr::Ranked(items, _) => {
                        self.groups.insert(ranked.expressions[&key], helper);
                        for (option, child) in items.iter().enumerate() {
                            route(self, child, Some(option));
                        }
                    }
                    Expr::Optional(inner, _, _) => route(self, inner, None),
                    Expr::Repeat(inner, separator, _) => {
                        route(self, inner, None);
                        // Recursive repetition only adds a self edge.
                        if let Some(separator) = separator {
                            self.describe(grammar, ranked, source, separator, memo, captured);
                        }
                    }
                    _ => unreachable!(),
                }
                result
            }
            Expr::Capture(_, inner) | Expr::Splice(inner) | Expr::Tested(_, _, inner) => {
                self.describe(grammar, ranked, source, inner, memo, captured)
            }
            Expr::Ref(name) => Unary { zero: false, children: vec![grammar.index.get(name).copied()] },
            _ => Unary { zero: false, children: vec![None] },
        };
        memo.insert(key, result.clone());
        result
    }
}
fn common_capture(expr: &Expr, memo: &mut FxMap<usize, bool>) -> bool {
    let key = expr as *const Expr as usize;
    if let Some(&known) = memo.get(&key) {
        return known;
    }
    let value = match expr {
        Expr::Ranked(..) => false,
        Expr::Capture(..) => true,
        Expr::Seq(items) | Expr::Choice(items) | Expr::And(items) => {
            items.iter().any(|child| common_capture(child, memo))
        }
        Expr::Splice(inner) | Expr::Optional(inner, _, _) | Expr::Tested(_, _, inner) => common_capture(inner, memo),
        Expr::Repeat(inner, separator, _) => {
            common_capture(inner, memo) || separator.as_deref().is_some_and(|s| common_capture(s, memo))
        }
        _ => false,
    };
    memo.insert(key, value);
    value
}

/// Each written branch and concatenation occurs once in the structural graph.
struct WrittenSpans {
    count: usize,
    branches: Vec<(usize, Vec<usize>)>,
    memo: FxMap<usize, usize>,
}
impl WrittenSpans {
    fn expression(&mut self, expr: &Expr, grammar: &StageGrammar) -> usize {
        let key = expr as *const Expr as usize;
        if let Some(&id) = self.memo.get(&key) {
            return id;
        }
        let id = match expr {
            Expr::Capture(_, inner) | Expr::Splice(inner) | Expr::Tested(_, _, inner) => {
                self.expression(inner, grammar)
            }
            Expr::Ref(name) => grammar.index.get(name).map_or(0, |i| i + 1),
            Expr::Terminal(_) | Expr::Literal(_) | Expr::ScalarRange(..) | Expr::Range(..) | Expr::Wildcard => 0,
            _ => {
                let id = self.count;
                self.count += 1;
                match expr {
                    Expr::Empty | Expr::Remainder => self.branches.push((id, vec![])),
                    Expr::Seq(items) => {
                        let rhs = items.iter().map(|child| self.expression(child, grammar)).collect();
                        self.branches.push((id, rhs));
                    }
                    Expr::Choice(items) | Expr::Ranked(items, _) | Expr::And(items) => {
                        for child in items {
                            let child = self.expression(child, grammar);
                            self.branches.push((id, vec![child]));
                        }
                    }
                    Expr::Optional(inner, _, _) => {
                        let child = self.expression(inner, grammar);
                        self.branches.extend([(id, vec![]), (id, vec![child])]);
                    }
                    Expr::Repeat(inner, separator, _) => {
                        let item = self.expression(inner, grammar);
                        self.branches.push((id, vec![item]));
                        if let Some(separator) = separator {
                            let separator = self.expression(separator, grammar);
                            self.branches.push((id, vec![item, separator, item]));
                        }
                    }
                    _ => unreachable!(),
                }
                id
            }
        };
        self.memo.insert(key, id);
        id
    }
}
struct SymbolSpans {
    productive: Vec<bool>,
    nonempty: Vec<bool>,
}
impl SymbolSpans {
    fn new(grammar: &StageGrammar) -> Self {
        let mut graph = WrittenSpans { count: grammar.rules.len() + 1, branches: vec![], memo: FxMap::default() };
        for (i, rule) in grammar.rules.iter().enumerate() {
            for source in &rule.alternatives {
                let rhs = graph.expression(&source.alternative.expr, grammar);
                graph.branches.push((i + 1, vec![rhs]));
            }
        }
        let mut users = vec![vec![]; graph.count];
        let mut remaining: Vec<_> = graph.branches.iter().map(|(_, rhs)| rhs.len()).collect();
        let mut productive = vec![false; graph.count];
        let mut nonempty = vec![false; graph.count];
        productive[0] = true;
        nonempty[0] = true;
        let mut pending = vec![0];
        for (i, (lhs, rhs)) in graph.branches.iter().enumerate() {
            if rhs.is_empty() && !productive[*lhs] {
                productive[*lhs] = true;
                pending.push(*lhs);
            }
            for &child in rhs {
                users[child].push(i);
            }
        }
        let mut at = 0;
        while at < pending.len() {
            for &i in &users[pending[at]] {
                remaining[i] -= 1;
                let lhs = graph.branches[i].0;
                if remaining[i] == 0 && !productive[lhs] {
                    productive[lhs] = true;
                    pending.push(lhs);
                }
            }
            at += 1;
        }
        pending = vec![0];
        for (i, (lhs, rhs)) in graph.branches.iter().enumerate() {
            if remaining[i] == 0 && rhs.iter().any(|&child| nonempty[child]) && !nonempty[*lhs] {
                nonempty[*lhs] = true;
                pending.push(*lhs);
            }
        }
        at = 0;
        while at < pending.len() {
            for &i in &users[pending[at]] {
                let lhs = graph.branches[i].0;
                if remaining[i] == 0 && !nonempty[lhs] {
                    nonempty[lhs] = true;
                    pending.push(lhs);
                }
            }
            at += 1;
        }
        Self {
            productive: productive[1..=grammar.rules.len()].to_vec(),
            nonempty: nonempty[1..=grammar.rules.len()].to_vec(),
        }
    }
    fn atom(&self, mut expr: &Expr, grammar: &StageGrammar) -> Span {
        while let Expr::Capture(_, inner) | Expr::Splice(inner) | Expr::Tested(_, _, inner) = expr {
            expr = inner;
        }
        if let Expr::Ref(name) = expr {
            if let Some(&id) = grammar.index.get(name) {
                return Span { productive: self.productive[id], nonempty: self.nonempty[id] };
            }
        }
        Span { productive: true, nonempty: true }
    }
}
