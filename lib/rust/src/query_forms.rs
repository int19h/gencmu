//! Structural bodies for parse queries (engine §3.10 and §4.3).
use crate::dom::{Expr, Term};
use crate::work::{self, Work};

pub(crate) fn expression_children(expression: &Expr) -> Vec<&Expr> {
    match expression {
        Expr::Seq(items) | Expr::Choice(items) | Expr::Ranked(items, _) | Expr::And(items) => items.iter().collect(),
        Expr::Optional(inner, _, _) | Expr::Splice(inner) | Expr::Capture(_, inner) | Expr::Tested(_, _, inner) => {
            vec![inner]
        }
        Expr::Repeat(inner, separator, _) => std::iter::once(inner.as_ref()).chain(separator.as_deref()).collect(),
        _ => Vec::new(),
    }
}

pub(crate) fn body_problem(body: &Expr) -> Option<&'static str> {
    let marker = "a remainder stands at one outer edge of a parse argument";
    let mut pending = vec![body];
    if let Expr::Seq(items) = body {
        let markers: Vec<_> = items
            .iter()
            .enumerate()
            .filter_map(|(index, item)| matches!(item, Expr::Remainder).then_some(index))
            .collect();
        if !markers.is_empty() {
            if markers.len() != 1 || items.len() < 2 || markers[0] != 0 && markers[0] + 1 != items.len() {
                return Some(marker);
            }
            pending = items.iter().filter(|item| !matches!(item, Expr::Remainder)).collect();
        }
    }
    while let Some(expression) = pending.pop() {
        work::count(Work::Walked, 1);
        match expression {
            Expr::Capture(..) => return Some("a parse argument cannot declare captures"),
            Expr::Remainder => return Some(marker),
            _ => pending.extend(expression_children(expression)),
        }
    }
    None
}

pub(crate) fn body_terms(body: &Expr) -> Vec<&Term> {
    let mut result = Vec::new();
    let mut pending = vec![body];
    while let Some(expression) = pending.pop() {
        work::count(Work::Walked, 1);
        match expression {
            Expr::Literal(value) | Expr::Tested(_, value, _) => result.push(value),
            Expr::ScalarRange(left, right) => result.extend([left, right]),
            Expr::Optional(_, _, Some(default)) => result.push(&default.term),
            _ => {}
        }
        pending.extend(expression_children(expression));
    }
    result
}

pub(crate) fn suffix_body(body: &Expr) -> bool {
    matches!(body,Expr::Seq(items) if matches!(items.first(),Some(Expr::Remainder)))
}
