//! Shared clause walks for query dependencies (engine §4.3).
use crate::fxhash::{FxMap, FxSet};
use crate::lower::{LCond, LEmit, LEmitItem, LTerm, Lowered, Prod, RankedPlan, Span, Sym};
use crate::work::{self, Work};

#[derive(Clone, Copy)]
pub(crate) enum Node<'a> {
    Condition(&'a LCond),
    Term(&'a LTerm),
    Span(&'a Span),
    Query(&'a Span, u32, bool),
}
impl Node<'_> {
    fn identity(self) -> (u8, usize) {
        match self {
            Self::Condition(value) => (0, value as *const _ as usize),
            Self::Term(value) => (1, value as *const _ as usize),
            Self::Span(value) => (2, value as *const _ as usize),
            Self::Query(value, _, _) => (3, value as *const _ as usize),
        }
    }
    fn forest(forest: &crate::lower::LForest) -> Vec<Node<'_>> {
        let mut children = vec![Node::Query(&forest.span, forest.rule, forest.clean)];
        children.extend(forest.after.iter().map(Node::Span));
        children
    }
    fn children(self) -> Vec<Self> {
        match self {
            Self::Condition(condition) => match condition {
                LCond::Matches(span, rule) | LCond::Begins(span, rule) | LCond::Ends(span, rule) => {
                    vec![Self::Query(span, *rule, false)]
                }
                LCond::Forest(forest) => Self::forest(forest),
                LCond::Present(span)
                | LCond::Tree(span, ..)
                | LCond::Initial(span)
                | LCond::Final(span)
                | LCond::Boundary(_, span, ..) => {
                    vec![Self::Span(span)]
                }
                LCond::SameTree(left, _, right, _) => vec![Self::Span(left), Self::Span(right)],
                LCond::Cmp(_, left, right) => vec![Self::Term(left), Self::Term(right)],
                LCond::Not(inner) => vec![Self::Condition(inner)],
                LCond::All(items) | LCond::Any(items) => items.iter().map(Self::Condition).collect(),
                LCond::If(left, right) => vec![Self::Condition(left), Self::Condition(right)],
            },
            Self::Term(term) => match term {
                LTerm::TagsRule(span, rule) => vec![Self::Query(span, *rule, false)],
                LTerm::ForestTags(forest) => Self::forest(forest),
                LTerm::Value(span)
                | LTerm::Image(span)
                | LTerm::Text(span)
                | LTerm::DecomposedText(span)
                | LTerm::Tags(span)
                | LTerm::Classes(span) => vec![Self::Span(span)],
                LTerm::Concat(items) | LTerm::Union(items) | LTerm::Inter(items) => {
                    items.iter().map(Self::Term).collect()
                }
                LTerm::Diff(left, right) | LTerm::Split(left, right) => vec![Self::Term(left), Self::Term(right)],
                LTerm::Ngrams(inner, _) | LTerm::Classify(inner, _) => vec![Self::Term(inner)],
                LTerm::If(condition, term) => vec![Self::Condition(condition), Self::Term(term)],
                _ => Vec::new(),
            },
            Self::Span(span) => match span {
                Span::Head(inner)
                | Span::Tail(inner)
                | Span::Last(inner)
                | Span::From(inner)
                | Span::After(inner)
                | Span::Before(inner)
                | Span::WithoutElision(inner, _) => vec![Self::Span(inner)],
                _ => Vec::new(),
            },
            Self::Query(span, _, _) => vec![Self::Span(span)],
        }
    }
}

/// Every runtime clause, including item conditions in a lexical plan.
pub(crate) fn walk<'a>(
    production: &'a Prod,
    plans: &[&'a RankedPlan],
    seen: &mut FxSet<(u8, usize)>,
    mut visit: impl FnMut(Node<'a>),
) {
    let mut pending: Vec<_> = production.conds.iter().map(|(condition, _)| Node::Condition(condition)).collect();
    pending.extend(production.tags.iter().map(Node::Term));
    for plan in plans {
        pending.extend(plan.conditions.iter().flatten().map(|(condition, _)| Node::Condition(condition)));
        pending.extend(plan.whole_tags.iter().map(Node::Term));
    }
    match &production.emit {
        LEmit::This(items) => pending.extend(items.iter().flatten().map(Node::Term)),
        LEmit::Items(items) => {
            for item in items {
                let term = match item {
                    LEmitItem::Cap(_, term, ..) | LEmitItem::Insert(term, _) => term,
                };
                pending.extend(term.iter().map(Node::Term));
            }
        }
        _ => {}
    }
    while let Some(node) = pending.pop() {
        if !seen.insert(node.identity()) {
            continue;
        }
        work::count(Work::Walked, 1);
        visit(node);
        pending.extend(node.children());
    }
}

pub(crate) fn carried(g: &Lowered) -> Vec<bool> {
    let plans = crate::restoration::plans_by_production(g);
    let mut users: FxMap<u32, Vec<usize>> = FxMap::default();
    let mut dependent = vec![false; g.rules.len()];
    let mut ready = Vec::new();
    for (id, rule) in g.rules.iter().enumerate() {
        let mut targets = FxSet::default();
        let mut seen = FxSet::default();
        for &number in &rule.prods {
            work::count(Work::Lowered, 1);
            let production = &g.prods[number as usize];
            for symbol in &production.syms {
                if let Sym::N(target) = symbol {
                    targets.insert(*target);
                }
            }
            walk(production, &plans[number as usize], &mut seen, |node| {
                if let Node::Query(_, target, filtered) = node {
                    targets.insert(target);
                    dependent[id] |= filtered;
                }
            });
        }
        for target in targets {
            users.entry(target).or_default().push(id);
        }
        if dependent[id] {
            ready.push(id);
        }
    }
    let mut cursor = 0;
    while cursor < ready.len() {
        for &user in users.get(&(ready[cursor] as u32)).into_iter().flatten() {
            work::count(Work::Lowered, 1);
            if !dependent[user] {
                dependent[user] = true;
                ready.push(user);
            }
        }
        cursor += 1;
    }
    dependent
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deferred_query_dependency_closure_costs_linear_work() {
        // Engine §4.3: one closure serves all targets of a lowered grammar.
        let mut counts = Vec::new();
        for n in [50, 200] {
            work::reset();
            let mut rules = String::from("%rule text r0\n");
            for id in 0..n {
                rules.push_str(&format!("%rule r{id} r{}\n", id + 1));
            }
            rules.push_str(&format!("%rule r{n} A\n%conditions $.parse(A).error-free"));
            let source = format!("```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n{rules}\n```\n");
            let pipeline = crate::load_pipeline_sources([("p.md", source)], "p.md").unwrap();
            let grammar = pipeline.lowered_stage(0);
            work::reset();
            work::budget(Work::Lowered, 10 * n);
            work::budget(Work::Walked, 10 * n);
            let dependencies = carried(&grammar);
            assert!(dependencies[grammar.start as usize]);
            let count = work::counted(Work::Lowered) + work::counted(Work::Walked);
            eprintln!("query dependencies n={n}: {count}");
            counts.push(count);
        }
        assert!(counts[1] <= 4 * counts[0] + 20);
    }
}
