//! A rule's clauses against the captures of its alternatives (engine §3.6,
//! §9): simplifying a clause for a production, the captures a clause uses,
//! and the checks of a definition as a whole.

use crate::dom::{Alternative, Arg, Cond, EmitItem, Expr, RuleDef, Term};

/// A condition simplified for a production: decided, or still to evaluate.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Simple {
    True,
    False,
    Cond(Cond),
}

/// Simplifies a condition for a production that has the captures `has`
/// (engine §3.6): each presence test becomes true or false, and `⟹`, `¬`,
/// `∧` and `∨` over a true or false part are reduced.
pub(crate) fn simplify_cond(cond: &Cond, has: &dyn Fn(&str) -> bool) -> Simple {
    match cond {
        Cond::Captured(name) => {
            if has(name) {
                Simple::True
            } else {
                Simple::False
            }
        }
        Cond::Not(inner) => match simplify_cond(inner, has) {
            Simple::True => Simple::False,
            Simple::False => Simple::True,
            Simple::Cond(inner) => Simple::Cond(Cond::Not(Box::new(inner))),
        },
        Cond::All(items) => {
            let mut left = Vec::new();
            for item in items {
                match simplify_cond(item, has) {
                    Simple::False => return Simple::False,
                    Simple::True => {}
                    Simple::Cond(item) => left.push(item),
                }
            }
            match left.len() {
                0 => Simple::True,
                1 => Simple::Cond(left.pop().expect("one condition")),
                _ => Simple::Cond(Cond::All(left)),
            }
        }
        Cond::Any(items) => {
            let mut left = Vec::new();
            for item in items {
                match simplify_cond(item, has) {
                    Simple::True => return Simple::True,
                    Simple::False => {}
                    Simple::Cond(item) => left.push(item),
                }
            }
            match left.len() {
                0 => Simple::False,
                1 => Simple::Cond(left.pop().expect("one condition")),
                _ => Simple::Cond(Cond::Any(left)),
            }
        }
        Cond::If(antecedent, consequent) => {
            let antecedent = match simplify_cond(antecedent, has) {
                Simple::False => return Simple::True,
                Simple::True => return simplify_cond(consequent, has),
                Simple::Cond(antecedent) => antecedent,
            };
            match simplify_cond(consequent, has) {
                Simple::True => Simple::True,
                Simple::False => Simple::Cond(Cond::Not(Box::new(antecedent))),
                Simple::Cond(consequent) => Simple::Cond(Cond::If(Box::new(antecedent), Box::new(consequent))),
            }
        }
        Cond::Compare(op, left, right) => {
            Simple::Cond(Cond::Compare(op.clone(), simplify_value(left, has), simplify_value(right, has)))
        }
        Cond::Matches(..) | Cond::Initial(_) => Simple::Cond(cond.clone()),
    }
}

/// Simplifies a term for a production (engine §3.6): `None` where it is
/// the empty set, written `∅` or left by a guard that does not hold. The
/// empty set is dropped from a union, makes an intersection empty, and
/// makes a guarded term empty.
pub(crate) fn simplify_term(term: &Term, has: &dyn Fn(&str) -> bool) -> Option<Term> {
    match term {
        Term::EmptySet => None,
        Term::If(cond, then) => match simplify_cond(cond, has) {
            Simple::False => None,
            Simple::True => simplify_term(then, has),
            Simple::Cond(cond) => Some(Term::If(Box::new(cond), Box::new(simplify_term(then, has)?))),
        },
        Term::Union(items) => {
            let mut left: Vec<Term> = items.iter().filter_map(|item| simplify_term(item, has)).collect();
            match left.len() {
                0 => None,
                1 => left.pop(),
                _ => Some(Term::Union(left)),
            }
        }
        Term::Intersection(items) => {
            let mut left = Vec::with_capacity(items.len());
            for item in items {
                left.push(simplify_term(item, has)?);
            }
            Some(Term::Intersection(left))
        }
        _ => Some(term.clone()),
    }
}

/// A term simplified for a production, the empty set written out.
pub(crate) fn simplify_value(term: &Term, has: &dyn Fn(&str) -> bool) -> Term {
    simplify_term(term, has).unwrap_or(Term::EmptySet)
}

fn term_captures<'a>(term: &'a Term, out: &mut Vec<&'a str>) {
    match term {
        Term::Capture(name) => out.push(name),
        Term::Union(items) | Term::Intersection(items) => items.iter().for_each(|item| term_captures(item, out)),
        Term::Call(_, args) => {
            for arg in args {
                if let Arg::Term(term) = arg {
                    term_captures(term, out);
                }
            }
        }
        Term::If(cond, then) => {
            cond_captures(cond, out);
            term_captures(then, out);
        }
        Term::Literal(_) | Term::Weak(_) | Term::EmptySet => {}
    }
}

fn cond_captures<'a>(cond: &'a Cond, out: &mut Vec<&'a str>) {
    match cond {
        Cond::Compare(_, left, right) => {
            term_captures(left, out);
            term_captures(right, out);
        }
        Cond::Matches(span, _) | Cond::Initial(span) => term_captures(span, out),
        Cond::Not(inner) => cond_captures(inner, out),
        Cond::Any(items) | Cond::All(items) => items.iter().for_each(|item| cond_captures(item, out)),
        Cond::If(antecedent, consequent) => {
            cond_captures(antecedent, out);
            cond_captures(consequent, out);
        }
        Cond::Captured(_) => {}
    }
}

/// The captures a term uses as values or spans, presence tests aside.
pub(crate) fn term_uses(term: &Term) -> Vec<&str> {
    let mut out = Vec::new();
    term_captures(term, &mut out);
    out
}

/// The captures a condition uses as values or spans, presence tests aside.
pub(crate) fn cond_uses(cond: &Cond) -> Vec<&str> {
    let mut out = Vec::new();
    cond_captures(cond, &mut out);
    out
}

fn term_presences<'a>(term: &'a Term, out: &mut Vec<&'a str>) {
    match term {
        Term::Union(items) | Term::Intersection(items) => items.iter().for_each(|item| term_presences(item, out)),
        Term::If(cond, then) => {
            cond_presences(cond, out);
            term_presences(then, out);
        }
        _ => {}
    }
}

fn cond_presences<'a>(cond: &'a Cond, out: &mut Vec<&'a str>) {
    match cond {
        Cond::Captured(name) => out.push(name),
        Cond::Compare(_, left, right) => {
            term_presences(left, out);
            term_presences(right, out);
        }
        Cond::Not(inner) => cond_presences(inner, out),
        Cond::Any(items) | Cond::All(items) => items.iter().for_each(|item| cond_presences(item, out)),
        Cond::If(antecedent, consequent) => {
            cond_presences(antecedent, out);
            cond_presences(consequent, out);
        }
        Cond::Matches(..) | Cond::Initial(_) => {}
    }
}

/// The captures of an alternative's top level, each with its position;
/// `$` is not among them.
pub(crate) fn alternative_captures(alternative: &Alternative) -> Vec<(&str, usize)> {
    let top: &[Expr] = match &alternative.expr {
        Expr::Seq(items) => items,
        other => std::slice::from_ref(other),
    };
    top.iter()
        .enumerate()
        .filter_map(|(position, item)| match item {
            Expr::Capture(name, _) => Some((name.as_str(), position)),
            _ => None,
        })
        .collect()
}

/// Why a definition, a rule's alternatives with its own clauses, is an
/// error of the document (engine §9), or `None`.
pub(crate) fn definition_problem(rule: &RuleDef) -> Option<String> {
    let alternatives: Vec<Vec<(&str, usize)>> = rule.alternatives.iter().map(alternative_captures).collect();
    let captures_of = |index: usize| {
        let captures = &alternatives[index];
        move |name: &str| name.is_empty() || captures.iter().any(|(captured, _)| *captured == name)
    };
    let any_has = |name: &str| name.is_empty() || alternatives.iter().flatten().any(|(captured, _)| *captured == name);
    let items: &[EmitItem] = rule.emit.as_deref().unwrap_or(&[]);
    // A constituent that does not count cannot sound like its text (§9).
    if rule.verbatim && rule.emit.is_some() && items.is_empty() {
        return Some(format!("{} is verbatim and emits ε", rule.name));
    }

    // A capture mentioned anywhere, presence tests included, that no
    // alternative captures.
    let mut mentioned: Vec<&str> = Vec::new();
    for term in rule.tags.iter().chain(rule.alternatives.iter().filter_map(|alternative| alternative.tags.as_ref())) {
        term_captures(term, &mut mentioned);
        term_presences(term, &mut mentioned);
    }
    for cond in &rule.conditions {
        cond_captures(cond, &mut mentioned);
        cond_presences(cond, &mut mentioned);
    }
    for item in items {
        match item {
            EmitItem::Capture(name, tags) => {
                mentioned.push(name);
                if let Some(term) = tags {
                    term_captures(term, &mut mentioned);
                    term_presences(term, &mut mentioned);
                }
            }
            EmitItem::Insert(_) => {}
        }
    }
    if let Some(name) = mentioned.iter().find(|name| !any_has(name)) {
        return Some(format!("${name} is captured by no alternative of {}", rule.name));
    }

    // A condition that applies to no alternative.
    for cond in &rule.conditions {
        let applies = (0..alternatives.len()).any(|index| {
            let has = captures_of(index);
            match simplify_cond(cond, &has) {
                Simple::True => false,
                Simple::False => true,
                Simple::Cond(simple) => cond_uses(&simple).iter().all(|name| has(name)),
            }
        });
        if !applies {
            return Some(format!("a condition of {} applies to no alternative", rule.name));
        }
    }

    let unguarded = |name: &str| {
        format!("a tag term of {} uses ${name}, which an alternative lacks; guard it with ${name} ⟹", rule.name)
    };
    for (index, alternative) in rule.alternatives.iter().enumerate() {
        let has = captures_of(index);
        for term in [rule.tags.as_ref(), alternative.tags.as_ref()].into_iter().flatten() {
            if let Some(simple) = simplify_term(term, &has) {
                if let Some(missing) = term_uses(&simple).into_iter().find(|name| !has(name)) {
                    return Some(unguarded(missing));
                }
            }
        }
        if rule.emit.is_none() {
            continue;
        }
        let present: Vec<&EmitItem> = items
            .iter()
            .filter(|item| match item {
                EmitItem::Capture(name, _) => has(name),
                EmitItem::Insert(_) => true,
            })
            .collect();
        // Nothing left to emit is an error only where the rule lists items:
        // `%emits ε` lists none (§9).
        if present.is_empty() && !items.is_empty() {
            return Some(format!("%emits of {} leaves an alternative nothing to emit", rule.name));
        }
        let positions: Vec<usize> = present
            .iter()
            .filter_map(|item| match item {
                EmitItem::Capture(name, _) if !name.is_empty() => {
                    alternatives[index].iter().find(|(captured, _)| captured == name).map(|(_, position)| *position)
                }
                _ => None,
            })
            .collect();
        if positions.windows(2).any(|pair| pair[1] < pair[0]) {
            return Some(format!("%emits of {} lists captures out of the order they stand in", rule.name));
        }
        for item in &present {
            if let EmitItem::Capture(_, Some(term)) = item {
                if let Some(simple) = simplify_term(term, &has) {
                    if let Some(missing) = term_uses(&simple).into_iter().find(|name| !has(name)) {
                        return Some(unguarded(missing));
                    }
                }
            }
        }
    }

    // An inserted tag whose anchor, the capture listed next after it, some
    // alternative lacks.
    for (index, item) in items.iter().enumerate() {
        if !matches!(item, EmitItem::Insert(_)) {
            continue;
        }
        let anchor = items[index + 1..].iter().find_map(|item| match item {
            EmitItem::Capture(name, _) => Some(name.as_str()),
            EmitItem::Insert(_) => None,
        });
        if let Some(anchor) = anchor {
            if !(0..alternatives.len()).all(|alternative| captures_of(alternative)(anchor)) {
                return Some(format!(
                    "%emits of {} inserts a tag before ${anchor}, which an alternative lacks",
                    rule.name
                ));
            }
        }
    }
    None
}
