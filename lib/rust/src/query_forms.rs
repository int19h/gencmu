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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
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

// Normalize native expressions for query identity. Source locations do not
// distinguish readings, and transparent sequences and choices flatten.
fn reading_expression(body: &Expr, binders: bool, identity: bool) -> Expr {
    use crate::dom::DefaultValue;
    work::count(Work::Walked, 1);
    let child = |e: &Expr| reading_expression(e, binders, identity);
    match body {
        Expr::Capture(_, inner) if binders => child(inner),
        Expr::Seq(items) | Expr::Choice(items) => {
            let sequence = matches!(body, Expr::Seq(_));
            let mut parts = Vec::new();
            for item in items {
                let mut item = child(item);
                match &mut item {
                    Expr::Seq(inner) if identity && sequence => parts.extend(std::mem::take(inner)),
                    Expr::Choice(inner) if identity && !sequence => parts.extend(std::mem::take(inner)),
                    _ => parts.push(item),
                }
            }
            if sequence {
                Expr::Seq(parts)
            } else {
                Expr::Choice(parts)
            }
        }
        Expr::Ranked(items, at) => Expr::Ranked(items.iter().map(child).collect(), if identity { None } else { *at }),
        Expr::And(items) => Expr::And(items.iter().map(child).collect()),
        Expr::Optional(inner, mark, default) => Expr::Optional(
            Box::new(child(inner)),
            *mark,
            default.as_ref().map(|d| DefaultValue {
                term: if identity { identity_term(&d.term) } else { d.term.clone() },
                at: if identity { None } else { d.at },
            }),
        ),
        Expr::Repeat(inner, sep, chain) => {
            Expr::Repeat(Box::new(child(inner)), sep.as_deref().map(|e| Box::new(child(e))), *chain)
        }
        Expr::Splice(inner) => Expr::Splice(Box::new(child(inner))),
        Expr::Capture(name, inner) => Expr::Capture(name.clone(), Box::new(child(inner))),
        Expr::Tested(op, term, inner) => {
            Expr::Tested(op.clone(), if identity { identity_term(term) } else { term.clone() }, Box::new(child(inner)))
        }
        Expr::Literal(term) if identity => Expr::Literal(identity_term(term)),
        Expr::ScalarRange(a, b) if identity => Expr::ScalarRange(identity_term(a), identity_term(b)),
        _ => body.clone(),
    }
}

fn identity_term(term: &Term) -> Term {
    use crate::dom::Arg;
    match term {
        Term::Body(body) => Term::Body(std::sync::Arc::new(reading_expression(body, false, true))),
        Term::Pattern(pattern) => Term::Pattern(Box::new(identity_pattern(pattern))),
        Term::Union(parts) => Term::Union(parts.iter().map(identity_term).collect()),
        Term::Intersection(parts) => Term::Intersection(parts.iter().map(identity_term).collect()),
        Term::Difference(a, b) => Term::Difference(Box::new(identity_term(a)), Box::new(identity_term(b))),
        Term::Call(name, args) => Term::Call(
            name.clone(),
            args.iter()
                .map(|arg| match arg {
                    Arg::Term(term) => Arg::Term(identity_term(term)),
                    _ => arg.clone(),
                })
                .collect(),
        ),
        Term::If(cond, term) => Term::If(Box::new(identity_cond(cond)), Box::new(identity_term(term))),
        Term::Const(name, _) => Term::Const(name.clone(), (0, 0)),
        _ => term.clone(),
    }
}

fn identity_cond(cond: &crate::dom::Cond) -> crate::dom::Cond {
    use crate::dom::{Arg, BoundaryLocation, Cond};
    match cond {
        Cond::Present(t) => Cond::Present(identity_term(t)),
        Cond::Forest(t) => Cond::Forest(identity_term(t)),
        Cond::Truthy(t) => Cond::Truthy(identity_term(t)),
        Cond::SourceQuery(name, args, _) => Cond::SourceQuery(
            name.clone(),
            args.iter()
                .map(|a| match a {
                    Arg::Term(t) => Arg::Term(identity_term(t)),
                    _ => a.clone(),
                })
                .collect(),
            BoundaryLocation::default(),
        ),
        Cond::Compare(op, a, b, _) => Cond::Compare(op.clone(), identity_term(a), identity_term(b), None),
        Cond::Initial(t) => Cond::Initial(identity_term(t)),
        Cond::Final(t) => Cond::Final(identity_term(t)),
        Cond::Boundary(dir, t, names, _) => Cond::Boundary(*dir, identity_term(t), names.clone(), Default::default()),
        Cond::Not(c) => Cond::Not(Box::new(identity_cond(c))),
        Cond::Any(parts) => Cond::Any(parts.iter().map(identity_cond).collect()),
        Cond::All(parts) => Cond::All(parts.iter().map(identity_cond).collect()),
        Cond::If(a, b) => Cond::If(Box::new(identity_cond(a)), Box::new(identity_cond(b))),
        Cond::Captured(_) => cond.clone(),
    }
}

fn identity_pattern(pattern: &crate::patterns::Pattern) -> crate::patterns::Pattern {
    use crate::patterns::Pattern as P;
    match pattern {
        P::Name(n, _) => P::Name(n.clone(), (0, 0)),
        P::Terminal(n, _) => P::Terminal(n.clone(), (0, 0)),
        P::Literal(t, _) => P::Literal(identity_term(t), (0, 0)),
        P::Range(a, b, _) => P::Range(identity_term(a), identity_term(b), (0, 0)),
        P::Wildcard(_) => P::Wildcard((0, 0)),
        P::Constant(n, _) => P::Constant(n.clone(), (0, 0)),
        P::Test(op, t, p, _) => P::Test(op.clone(), identity_term(t), Box::new(identity_pattern(p)), None),
        P::Node(p, exact, children) => {
            P::Node(Box::new(identity_pattern(p)), *exact, children.as_ref().map(identity_children))
        }
        P::Path(path, p) => P::Path(path.clone(), Box::new(identity_pattern(p))),
        P::Union(parts) => P::Union(parts.iter().map(identity_pattern).collect()),
        P::Intersection(parts) => P::Intersection(parts.iter().map(identity_pattern).collect()),
        P::Difference(a, b) => P::Difference(Box::new(identity_pattern(a)), Box::new(identity_pattern(b))),
        _ => pattern.clone(),
    }
}

fn identity_children(children: &crate::patterns::Children) -> crate::patterns::Children {
    use crate::patterns::Children as C;
    match children {
        C::Node(p) => C::Node(Box::new(identity_pattern(p))),
        C::Sequence(parts) => C::Sequence(parts.iter().map(identity_children).collect()),
        C::Choice(parts) => C::Choice(parts.iter().map(identity_children).collect()),
        C::Optional(c) => C::Optional(Box::new(identity_children(c))),
        C::Repeat(c, sep) => {
            C::Repeat(Box::new(identity_children(c)), sep.as_deref().map(|c| Box::new(identity_children(c))))
        }
        C::Siblings => C::Siblings,
    }
}

fn structural_key(body: &Expr) -> String {
    format!("{:?}", reading_expression(body, false, true))
}

fn without_binders(body: &Expr) -> Expr {
    reading_expression(body, true, false)
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
        // Only written sites reachable in the chosen tree need reading targets.
        // Erased alternatives contribute a seal and expose no child sites.
        // Stage validation reports a missing start rule.
        let mut rules: Vec<_> = grammar.index.get("text").copied().into_iter().collect();
        let mut seen = FxSet::default();
        while let Some(index) = rules.pop() {
            if !seen.insert(index) {
                continue;
            }
            for alternative in &grammar.rules[index].alternatives {
                if alternative.erased {
                    continue;
                }
                let mut pending = vec![(&alternative.alternative.expr, true)];
                while let Some((expr, site)) = pending.pop() {
                    if let Expr::Ref(name) = expr {
                        if let Some(&index) = grammar.index.get(name) {
                            rules.push(index);
                        }
                    }
                    if site
                        && !matches!(
                            expr,
                            Expr::Seq(_)
                                | Expr::Choice(_)
                                | Expr::And(_)
                                | Expr::Capture(..)
                                | Expr::Empty
                                | Expr::Remainder
                                | Expr::Repeat(_, _, Some(_))
                        )
                    {
                        let body = Arc::new(without_binders(expr));
                        let term = Term::Call(
                            "parse".into(),
                            vec![Arg::Term(Term::Capture(String::new())), Arg::Term(Term::Body(body.clone()))],
                        );
                        local_queries.push((expr as *const Expr as usize, alternative, body, term));
                    }
                    // Tests and splices replace the inner symbol's site.
                    // Their containers still expose their own child sites.
                    match expr {
                        Expr::Tested(_, _, inner) | Expr::Splice(inner) => pending.push((inner, false)),
                        _ => pending.extend(expression_children(expr).into_iter().map(|child| (child, true))),
                    }
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
                                            gates: Vec::new(),
                                            expr: core,
                                            tags: None,
                                            strings: Channels::default(),
                                            ranked_locations: Default::default(),
                                        },
                                        written: None,
                                        written_alternative: 0,
                                        text_order,
                                        clauses: Arc::new(RuleClauses {
                                            tags: None,
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
