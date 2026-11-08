//! Concrete tag terms and their complete-tree neighbor obligations.
use crate::dom::{Cond, Term};
use std::collections::BTreeSet;

pub(crate) fn guards(term: &Term) -> Vec<(&Cond, &Term)> {
    let mut pending = vec![term];
    let mut found = Vec::new();
    while let Some(term) = pending.pop() {
        match term {
            Term::If(condition, value) if !crate::boundary::dom_atoms(condition).is_empty() => {
                found.push((&**condition, &**value))
            }
            Term::If(_, value) => pending.push(value),
            Term::Union(items) | Term::Intersection(items) => pending.extend(items.iter().rev()),
            Term::Difference(a, b) => pending.extend([&**b, &**a]),
            _ => {}
        }
    }
    found
}
fn closed(term: &Term) -> bool {
    match term {
        Term::Tag(_)
        | Term::EmptySet
        | Term::Const(..)
        | Term::Source(crate::dom::source::SourceSymbol::Parameter(..)) => true,
        Term::Union(items) | Term::Intersection(items) => items.iter().all(closed),
        Term::Difference(a, b) => closed(a) && closed(b),
        _ => false,
    }
}
pub(crate) fn problem(term: &Term) -> Option<(&'static str, &Cond)> {
    for (condition, value) in guards(term) {
        let atom = if let Cond::Not(atom) = condition { &**atom } else { condition };
        if !matches!(atom, Cond::Boundary(_, Term::Capture(name), _, _) if name.is_empty()) {
            return Some(("a tag guard requires one optionally negated neighbour atom on $", atom));
        }
        if !closed(value) {
            return Some(("a neighbour tag guard requires a literal tag set", atom));
        }
    }
    None
}
fn literal(term: &Term) -> BTreeSet<String> {
    crate::work::count(crate::work::Work::Visits, 1);
    match term {
        Term::Tag(name) => BTreeSet::from([name.clone()]),
        Term::EmptySet => BTreeSet::new(),
        Term::Union(items) => items.iter().flat_map(literal).collect(),
        Term::Intersection(items) => {
            let mut result = items.first().map(literal).unwrap_or_default();
            for item in items.iter().skip(1) {
                let right = literal(item);
                result.retain(|name| right.contains(name));
            }
            result
        }
        Term::Difference(a, b) => {
            let remove = literal(b);
            literal(a).difference(&remove).cloned().collect()
        }
        _ => unreachable!("a bound literal tag set"),
    }
}
pub(crate) type Key = (bool, BTreeSet<String>);
fn atom(condition: &Cond) -> (&Cond, bool) {
    if let Cond::Not(inner) = condition {
        (&**inner, true)
    } else {
        (condition, false)
    }
}
fn key(condition: &Cond) -> Key {
    let Cond::Boundary(forward, _, targets, _) = condition else { unreachable!("a neighbour atom") };
    (*forward, targets.iter().cloned().collect())
}
pub(crate) fn variants(term: &Term) -> Result<Vec<(Term, Vec<Cond>)>, String> {
    if let Some((problem, _)) = problem(term) {
        return Err(problem.into());
    }
    let mut variables: Vec<(Key, Cond)> = Vec::new();
    for (condition, value) in guards(term) {
        if literal(value).is_empty() {
            continue;
        }
        let (condition, _) = atom(condition);
        let k = key(condition);
        if !variables.iter().any(|(other, _)| *other == k) {
            variables.push((k, condition.clone()));
        }
    }
    fn replace(term: &Term, variables: &[(Key, Cond)], values: &[bool]) -> Term {
        match term {
            Term::If(condition, value) if !crate::boundary::dom_atoms(condition).is_empty() => {
                if literal(value).is_empty() {
                    return Term::EmptySet;
                }
                let (condition, negated) = atom(condition);
                let index = variables.iter().position(|(k, _)| *k == key(condition)).unwrap();
                if values[index] != negated {
                    (**value).clone()
                } else {
                    Term::EmptySet
                }
            }
            Term::If(c, t) => Term::If(c.clone(), Box::new(replace(t, variables, values))),
            Term::Union(items) => Term::Union(items.iter().map(|t| replace(t, variables, values)).collect()),
            Term::Intersection(items) => {
                Term::Intersection(items.iter().map(|t| replace(t, variables, values)).collect())
            }
            Term::Difference(a, b) => {
                Term::Difference(Box::new(replace(a, variables, values)), Box::new(replace(b, variables, values)))
            }
            _ => term.clone(),
        }
    }
    fn visit(
        term: &Term,
        variables: &[(Key, Cond)],
        values: &mut Vec<bool>,
        result: &mut Vec<(Term, Vec<Cond>)>,
    ) -> Result<(), String> {
        for (index, yes) in values.iter().enumerate() {
            if !yes {
                continue;
            }
            let (direction, targets) = &variables[index].0;
            let negative: BTreeSet<_> = values
                .iter()
                .enumerate()
                .filter(|(i, truth)| !**truth && variables[*i].0 .0 == *direction)
                .flat_map(|(i, _)| variables[i].0 .1.iter().cloned())
                .collect();
            if targets.is_subset(&negative) {
                return Ok(());
            }
        }
        if values.len() == variables.len() {
            if result.len() == 16 {
                return Err("a production has more than 16 guarded tag variants".into());
            }
            let conditions = variables
                .iter()
                .zip(values.iter())
                .map(|((_, c), yes)| if *yes { c.clone() } else { Cond::Not(Box::new(c.clone())) })
                .collect();
            result.push((replace(term, variables, values), conditions));
        } else {
            for truth in [false, true] {
                values.push(truth);
                visit(term, variables, values, result)?;
                values.pop();
            }
        }
        Ok(())
    }
    let mut result = Vec::new();
    visit(term, &variables, &mut Vec::new(), &mut result)?;
    Ok(result)
}

pub(crate) fn assignment(condition: &Cond) -> (Key, bool) {
    let (condition, negated) = atom(condition);
    (key(condition), !negated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::work::{self, Work};

    #[test]
    fn nested_intersections_visit_each_operand_once() {
        let pair = || Term::Union(vec![Term::Tag("T".into()), Term::Tag("U".into())]);
        let depth = 24;
        let mut term = pair();
        for _ in 0..depth {
            term = Term::Intersection(vec![pair(), Term::Union(vec![pair(), term])]);
        }
        let visits = 8 * depth + 3;
        work::reset();
        work::budget(Work::Visits, visits);
        assert_eq!(literal(&term), BTreeSet::from(["T".into(), "U".into()]));
        assert_eq!(work::counted(Work::Visits), visits);
        work::reset();
    }
}
