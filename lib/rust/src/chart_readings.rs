//! Lowered, per-site qualification for answers from the main stage chart.
use crate::dom::Expr;
use crate::fxhash::FxSet;
use crate::grammar::StageGrammar;
use crate::lower::{LCond, LTerm, Lowered, Span, Sym};
use crate::query_dependencies::Node;

#[derive(Debug, Clone, Copy)]
pub(crate) struct Site {
    pub symbol: Sym,
    pub test: Option<u32>,
    pub qualified: bool,
    pub settles_entry: bool,
}

pub(crate) fn captured_helpers(grammar: &StageGrammar, helpers: impl Iterator<Item = (u32, usize)>) -> FxSet<u32> {
    if grammar.local_targets.is_empty() {
        return FxSet::default();
    }
    let mut captured = FxSet::default();
    for rule in &grammar.rules {
        for alternative in &rule.alternatives {
            let mut pending = vec![(&alternative.alternative.expr, false)];
            while let Some((expression, visited)) = pending.pop() {
                let children = crate::query_forms::expression_children(expression);
                if !visited {
                    pending.push((expression, true));
                    pending.extend(children.into_iter().map(|child| (child, false)));
                } else if matches!(expression, Expr::Capture(..))
                    || children.iter().any(|child| captured.contains(&(*child as *const Expr as usize)))
                {
                    captured.insert(expression as *const Expr as usize);
                }
            }
        }
    }
    helpers.filter_map(|(rule, expression)| captured.contains(&expression).then_some(rule)).collect()
}

#[derive(Clone, Copy, Default, PartialEq, Eq)]
struct Properties {
    outside: bool,
    entry: bool,
    boundary: bool,
}

fn walk<'a>(roots: impl IntoIterator<Item = Node<'a>>, mut visit: impl FnMut(Node<'a>)) {
    let mut pending: Vec<_> = roots.into_iter().collect();
    while let Some(node) = pending.pop() {
        visit(node);
        pending.extend(node.children());
    }
}

pub(crate) fn prepare(g: &mut Lowered, captured: &FxSet<u32>) {
    let mut local = false;
    for check in &g.checks {
        walk(check.conditions.iter().map(Node::Condition), |node| {
            let forest = match node {
                Node::Condition(LCond::Forest(forest)) | Node::Term(LTerm::ForestTags(forest)) => Some(forest),
                _ => None,
            };
            local |= forest.is_some_and(|forest| matches!(forest.target, crate::lower::QueryTarget::Local));
        });
    }
    if !local {
        return;
    }
    let plans = crate::restoration::plans_by_production(g);
    let mut props = vec![Properties::default(); g.rules.len()];
    props[g.start as usize].entry = true;
    let mut parents = vec![FxSet::default(); g.rules.len()];
    let mut helper_safe = vec![true; g.rules.len()];
    for (id, production) in g.prods.iter().enumerate() {
        let rule = production.rule as usize;
        let mut calls: FxSet<_> = production
            .syms
            .iter()
            .filter_map(|symbol| match symbol {
                Sym::N(rule) => Some(*rule),
                Sym::T(_) => None,
            })
            .collect();
        let mut roots: Vec<_> = production.conds.iter().map(|(condition, _)| Node::Condition(condition)).collect();
        roots.extend(production.tags.iter().map(Node::Term));
        for plan in &plans[id] {
            roots.extend(plan.conditions.iter().flatten().map(|(condition, _)| Node::Condition(condition)));
            roots.extend(plan.whole_tags.iter().map(Node::Term));
            roots.extend(plan.whole_tag_variants.iter().map(|(_, term)| Node::Term(term)));
        }
        walk(roots, |node| match node {
            Node::Span(Span::Before(_)) | Node::Condition(LCond::Initial(_)) => props[rule].outside = true,
            Node::Condition(LCond::Boundary(..)) => props[rule].boundary = true,
            Node::Query(_, target, _) => {
                calls.insert(target);
            }
            _ => {}
        });
        for target in calls {
            parents[target as usize].insert(rule);
        }
        if g.rules[rule].helper && !production.splice {
            helper_safe[rule] &= !captured.contains(&(rule as u32))
                && g.rules[rule].elided.is_none()
                && production.names.keys().all(|name| name.is_empty() || name.starts_with('\0'))
                && production.conds.is_empty()
                && plans[id].iter().all(|plan| plan.conditions.iter().all(Vec::is_empty));
        }
    }
    let mut pending: Vec<_> = (0..props.len()).collect();
    let mut queued = vec![true; props.len()];
    while let Some(child) = pending.pop() {
        queued[child] = false;
        for &parent in &parents[child] {
            let (a, b) = (props[parent], props[child]);
            let merged = Properties {
                outside: a.outside || b.outside,
                entry: a.entry || b.entry,
                boundary: a.boundary || b.boundary,
            };
            if a != merged {
                props[parent] = merged;
                if !queued[parent] {
                    pending.push(parent);
                    queued[parent] = true;
                }
            }
        }
    }
    g.chart_rules = props
        .iter()
        .enumerate()
        .map(|(rule, info)| Site {
            symbol: Sym::N(rule as u32),
            test: None,
            qualified: helper_safe[rule] && !info.outside,
            settles_entry: info.entry && info.boundary,
        })
        .collect();
    for production in &mut g.prods {
        production.chart_sites = production
            .syms
            .iter()
            .enumerate()
            .map(|(index, &symbol)| {
                let mut site = match symbol {
                    Sym::N(rule) => g.chart_rules[rule as usize],
                    Sym::T(_) => Site { symbol, test: None, qualified: true, settles_entry: false },
                };
                site.symbol = symbol;
                site.test = production.test(index);
                site
            })
            .collect();
    }
}
