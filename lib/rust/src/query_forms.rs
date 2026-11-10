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
            if markers.len() > 2
                || markers.iter().any(|&index| index != 0 && index + 1 != items.len())
                || items.iter().filter(|item| !matches!(item, Expr::Remainder)).count() < 1
            {
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

/// The old and new spellings share a target and therefore a recursion key (§4.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Mode {
    Whole,
    Prefix,
    Suffix,
    Part,
}

pub(crate) fn body_mode(body: &Expr) -> Mode {
    match body {
        Expr::Seq(items)
            if matches!(items.first(), Some(Expr::Remainder)) && matches!(items.last(), Some(Expr::Remainder)) =>
        {
            Mode::Part
        }
        Expr::Seq(items) if matches!(items.first(), Some(Expr::Remainder)) => Mode::Suffix,
        Expr::Seq(items) if matches!(items.last(), Some(Expr::Remainder)) => Mode::Prefix,
        _ => Mode::Whole,
    }
}

pub(crate) fn body_core(body: &Expr) -> (Expr, Mode) {
    if let Expr::Seq(items) = body {
        if matches!(items.first(), Some(Expr::Remainder)) || matches!(items.last(), Some(Expr::Remainder)) {
            let mode =
                if matches!(items.first(), Some(Expr::Remainder)) && matches!(items.last(), Some(Expr::Remainder)) {
                    Mode::Part
                } else if matches!(items.first(), Some(Expr::Remainder)) {
                    Mode::Suffix
                } else {
                    Mode::Prefix
                };
            let mut parts: Vec<_> = items.iter().filter(|part| !matches!(part, Expr::Remainder)).cloned().collect();
            return (if parts.len() == 1 { parts.pop().unwrap() } else { Expr::Seq(parts) }, mode);
        }
    }
    (body.clone(), Mode::Whole)
}

fn structural_key(body: &Expr) -> String {
    let mut raw = String::new();
    crate::dom::write_expr(&mut raw, body);
    let raw = crate::json::parse_unbounded(&raw).expect("a query body DOM");
    crate::parameters::map_nodes(&raw, |mut node| {
        work::count(Work::Walked, 1);
        if let crate::json::Json::Obj(fields) = &mut node {
            fields.retain(|(key, _)| key != "at" && key != crate::parameters::SOURCE);
            for (key, value) in fields.iter_mut() {
                if matches!(key.as_str(), "seq" | "choice") {
                    if let crate::json::Json::Arr(items) = value {
                        let flat = std::mem::take(items)
                            .into_iter()
                            .flat_map(|item| {
                                item.get(key)
                                    .and_then(crate::json::Json::as_array)
                                    .map_or_else(|| vec![item.clone()], |items| items.to_vec())
                            })
                            .collect();
                        *items = flat;
                    }
                }
            }
            fields.sort_by(|a, b| a.0.cmp(&b.0));
        }
        node
    })
    .to_json()
}

fn without_binders(body: &Expr) -> Expr {
    let mut raw = String::new();
    crate::dom::write_expr(&mut raw, body);
    let raw = crate::json::parse_unbounded(&raw).expect("a reading expression DOM");
    let raw = crate::parameters::map_nodes(&raw, |node| {
        if node.get("capture").is_some() && node.get("expr").is_some() {
            node.get("expr").unwrap().clone()
        } else {
            node
        }
    });
    crate::dom::expr_from_json(&raw).expect("a reading expression without binders")
}

pub(crate) fn prepare(grammar: &mut crate::grammar::StageGrammar) -> Result<(), crate::error::Error> {
    use crate::clauses::Part;
    use crate::dom::{Alternative, Arg, Channels};
    use crate::fxhash::{FxMap, FxSet};
    use crate::grammar::{RuleClauses, StitchedAlternative, StitchedRule};
    use std::sync::Arc;
    let local = grammar.checks.iter().any(|(_, check)| {
        let mut pending: Vec<_> = check.conditions.iter().map(Part::Cond).collect();
        while let Some(part) = pending.pop() {
            if matches!(part, Part::Term(Term::Call(name, _)) if name == "local-readings") {
                return true;
            }
            pending.extend(part.children());
        }
        false
    });
    grammar.has_elements = grammar.checks.iter().any(|(_, check)| {
        let mut pending: Vec<_> = check.conditions.iter().map(Part::Cond).collect();
        while let Some(part) = pending.pop() {
            if matches!(part, Part::Term(Term::Call(name, _)) if name == "preceding-element") {
                return true;
            }
            pending.extend(part.children());
        }
        false
    });
    let mut local_queries = Vec::new();
    if local {
        for rule in &grammar.rules {
            for alternative in &rule.alternatives {
                let mut pending = vec![&alternative.alternative.expr];
                while let Some(expr) = pending.pop() {
                    if !matches!(
                        expr,
                        Expr::Seq(_)
                            | Expr::Choice(_)
                            | Expr::And(_)
                            | Expr::Capture(..)
                            | Expr::Empty
                            | Expr::Remainder
                            | Expr::Repeat(_, _, Some(_))
                    ) {
                        let body = Arc::new(without_binders(expr));
                        let term = Term::Call(
                            "parse".into(),
                            vec![Arg::Term(Term::Capture(String::new())), Arg::Term(Term::Body(body.clone()))],
                        );
                        local_queries.push((expr as *const Expr as usize, alternative, body, term));
                    }
                    pending.extend(expression_children(expr));
                }
            }
        }
    }
    let mut identities = FxMap::default();
    let mut seen = FxSet::default();
    let mut pending_rules = Vec::new();
    let mut targets = FxMap::default();
    let mut contexts = Vec::new();
    for rule in &grammar.rules {
        for alternative in &rule.alternatives {
            let clauses = &alternative.clauses;
            let mut pending: Vec<_> = alternative
                .alternative
                .tags
                .iter()
                .chain(&clauses.tags)
                .chain(&clauses.error)
                .chain(&clauses.warning)
                .chain(&clauses.strings.value)
                .chain(&clauses.strings.image)
                .chain(&alternative.alternative.strings.value)
                .chain(&alternative.alternative.strings.image)
                .map(Part::Term)
                .collect();
            pending.extend(clauses.conditions.iter().map(Part::Cond));
            for item in clauses.emit.iter().flatten() {
                let (tags, strings) = match item {
                    crate::dom::EmitItem::Capture(_, tags, a) => (tags, &a.strings),
                    crate::dom::EmitItem::Insert(tags, s) => (tags, s),
                };
                pending.extend(tags.iter().chain(&strings.value).chain(&strings.image).map(Part::Term));
            }
            contexts.push((alternative.document.clone(), alternative.at, alternative.text_order, pending));
        }
    }
    for (document, check) in &grammar.checks {
        contexts.push((document.clone(), check.at, 0, check.conditions.iter().map(Part::Cond).collect()));
    }
    for (_, alternative, _, query) in &local_queries {
        contexts.push((alternative.document.clone(), alternative.at, alternative.text_order, vec![Part::Term(query)]));
    }
    for (document, at, text_order, mut pending) in contexts {
        while let Some(part) = pending.pop() {
            let identity = match part {
                Part::Term(term) => (false, term as *const Term as usize),
                Part::Cond(condition) => (true, condition as *const crate::dom::Cond as usize),
            };
            if !seen.insert(identity) {
                continue;
            }
            work::count(Work::Walked, 1);
            if let Part::Term(Term::Call(name, args)) = part {
                if let ("parse", [Arg::Term(_), Arg::Term(Term::Body(body))]) = (name.as_str(), args.as_slice()) {
                    let pointer = Arc::as_ptr(body) as usize;
                    if let std::collections::hash_map::Entry::Vacant(entry) = targets.entry(pointer) {
                        let (core, _) = body_core(body);
                        let key = structural_key(&core);
                        let target = identities
                            .entry(key)
                            .or_insert_with(|| {
                                if let Expr::Ref(name) = &core {
                                    if !name.starts_with('_') {
                                        return name.clone();
                                    }
                                }
                                let name = format!("\0parse:{}", pending_rules.len());
                                pending_rules.push(StitchedRule {
                                    name: name.clone(),
                                    query: true,
                                    document: document.clone(),
                                    alternatives: vec![StitchedAlternative {
                                        alternative: Alternative {
                                            guards: Vec::new(),
                                            expr: core,
                                            tags: None,
                                            strings: Channels::default(),
                                            ranked_locations: Default::default(),
                                        },
                                        written: None,
                                        written_alternative: 0,
                                        text_order,
                                        clauses: Arc::new(RuleClauses {
                                            tags: Some(Term::EmptySet),
                                            strings: Channels::default(),
                                            emit: None,
                                            conditions: Vec::new(),
                                            error: None,
                                            warning: None,
                                            suppress_warnings: Vec::new(),
                                        }),
                                        erased: false,
                                        document: document.clone(),
                                        at,
                                    }],
                                });
                                name
                            })
                            .clone();
                        entry.insert(target);
                    }
                }
            }
            pending.extend(part.children());
        }
    }
    for (expression, _, body, _) in &local_queries {
        let pointer = Arc::as_ptr(body) as usize;
        grammar.local_targets.insert(*expression, targets.remove(&pointer).expect("a prepared reading target"));
    }
    grammar.query_targets = targets;
    for rule in pending_rules {
        grammar.index.insert(rule.name.clone(), grammar.rules.len());
        grammar.rules.push(rule);
    }
    Ok(())
}
