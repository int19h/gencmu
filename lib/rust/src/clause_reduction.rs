//! The §3.6 simplifier, shared by lowering and capture validation.
//! Reduced clauses borrow leaves and share their rebuilt paths. Reading a
//! deep document therefore needs no recursive cloning before its depth check.

use super::{closed_set_value, walk_captures, Outcome, Part, Simple};
use crate::dom::{Cond, Term};
use crate::fxhash::FxSet;
use crate::work::{self, Work};
use std::rc::Rc;

#[derive(Clone, Copy)]
enum Source<'a> {
    Written(Part<'a>),
    Not,
}

#[derive(Clone)]
pub(super) struct Reduced<'a>(Rc<Node<'a>>);
struct Node<'a> {
    source: Source<'a>,
    shape: Outcome<'a>,
    guard: Option<&'a str>,
    children: Vec<Reduced<'a>>,
}

// The shared paths can be deeper than the document limit until validation.
impl Drop for Node<'_> {
    fn drop(&mut self) {
        let mut pending = std::mem::take(&mut self.children);
        while let Some(child) = pending.pop() {
            if let Ok(mut node) = Rc::try_unwrap(child.0) {
                pending.append(&mut node.children);
            }
        }
    }
}

impl<'a> Reduced<'a> {
    pub(super) fn of(root: Part<'a>, has: &dyn Fn(&str) -> Option<bool>) -> Self {
        let mut pending = vec![(root, false)];
        let mut done = Vec::new();
        while let Some((part, ready)) = pending.pop() {
            let children = part.reducing_children();
            if !ready {
                pending.push((part, true));
                pending.extend(children.into_iter().rev().map(|child| (child, false)));
            } else {
                let children = done.split_off(done.len() - children.len());
                done.push(Self::combine(part, children, has));
            }
        }
        done.pop().expect("a clause root")
    }

    pub(super) fn shape(&self) -> Outcome<'a> {
        self.0.shape
    }
    pub(super) fn guard(&self) -> Option<&'a str> {
        self.0.guard
    }

    /// One statement of the reduction rules, also used for partial
    /// assignments. Unknown presence tests remain in the reduced clause.
    pub(super) fn combine(part: Part<'a>, mut children: Vec<Self>, has: &dyn Fn(&str) -> Option<bool>) -> Self {
        work::count(Work::Walked, 1);
        let constant =
            |shape| Self(Rc::new(Node { source: Source::Written(part), shape, guard: None, children: Vec::new() }));
        let mut source = Source::Written(part);
        match part {
            Part::Cond(Cond::Captured(name)) => {
                return match has(name) {
                    Some(true) => constant(Outcome::True),
                    Some(false) => constant(Outcome::False),
                    None => Self(Rc::new(Node { source, shape: Outcome::Uses(None), guard: Some(name), children })),
                };
            }
            Part::Cond(Cond::Not(_)) => match children[0].shape() {
                Outcome::True => return constant(Outcome::False),
                Outcome::False => return constant(Outcome::True),
                _ => {}
            },
            Part::Cond(Cond::All(_) | Cond::Any(_)) => {
                let all = matches!(part, Part::Cond(Cond::All(_)));
                let (stop, rest) = if all { (Outcome::False, Outcome::True) } else { (Outcome::True, Outcome::False) };
                if children.iter().any(|child| child.shape() == stop) {
                    return constant(stop);
                }
                children.retain(|child| child.shape() != rest);
                match children.len() {
                    0 => return constant(rest),
                    1 => return children.pop().expect("one condition"),
                    _ => {}
                }
            }
            Part::Cond(Cond::If(_, _)) => match (children[0].shape(), children[1].shape()) {
                (Outcome::False, _) | (_, Outcome::True) => return constant(Outcome::True),
                (Outcome::True, _) => return children.pop().expect("the consequent"),
                (_, Outcome::False) => {
                    children.pop();
                    source = Source::Not;
                }
                _ => {}
            },
            Part::Term(Term::If(_, _)) => match (children[0].shape(), children[1].shape()) {
                (Outcome::False, _) | (_, Outcome::Empty) => return constant(Outcome::Empty),
                (Outcome::True, _) => return children.pop().expect("the consequent"),
                _ => {}
            },
            Part::Term(Term::EmptySet) => return constant(Outcome::Empty),
            Part::Term(Term::Union(_)) => {
                children.retain(|child| child.shape() != Outcome::Empty);
                match children.len() {
                    0 => return constant(Outcome::Empty),
                    1 => return children.pop().expect("one term"),
                    _ => {}
                }
            }
            Part::Term(Term::Intersection(_)) => {
                if children.iter().any(|child| child.shape() == Outcome::Empty) {
                    return constant(Outcome::Empty);
                }
            }
            Part::Term(Term::Difference(_, _)) => {
                if children[0].shape() == Outcome::Empty {
                    return constant(Outcome::Empty);
                }
                if children[1].shape() == Outcome::Empty {
                    children.pop();
                    return children.pop().expect("the first term");
                }
            }
            Part::Cond(Cond::Truthy(_)) => {
                // Test the simplified term, including guards already resolved.
                if children[0].shape() == Outcome::Empty {
                    return constant(Outcome::False);
                }
                if children[0].closed_set().is_some_and(|value| !value.is_empty()) {
                    return constant(Outcome::True);
                }
            }
            Part::Cond(Cond::SourceQuery(..)) => unreachable!("source queries expand before clause checks"),
            _ => {}
        }
        let guard = children.iter().find_map(Self::guard);
        Self(Rc::new(Node { source, shape: Outcome::Uses(None), guard, children }))
    }

    /// Closed-set evaluation reads the reduced term, without materializing it.
    fn closed_set(&self) -> Option<FxSet<String>> {
        let mut pending = vec![(self, false)];
        let mut done: Vec<Option<FxSet<String>>> = Vec::new();
        while let Some((value, ready)) = pending.pop() {
            if value.shape() == Outcome::Empty {
                done.push(Some(FxSet::default()));
                continue;
            }
            let compound = matches!(
                value.0.source,
                Source::Written(Part::Term(Term::Union(_) | Term::Intersection(_) | Term::Difference(_, _)))
            );
            if !compound {
                done.push(match value.0.source {
                    Source::Written(Part::Term(term)) => closed_set_value(term),
                    _ => None,
                });
            } else if !ready {
                pending.push((value, true));
                pending.extend(value.0.children.iter().rev().map(|child| (child, false)));
            } else {
                let parts = done.split_off(done.len() - value.0.children.len());
                let mut parts = parts.into_iter();
                let mut out = parts.next().flatten()?;
                for next in parts {
                    let next = next?;
                    match value.0.source {
                        Source::Written(Part::Term(Term::Union(_))) => out.extend(next),
                        Source::Written(Part::Term(Term::Intersection(_))) => out.retain(|name| next.contains(name)),
                        _ => out.retain(|name| !next.contains(name)),
                    }
                }
                done.push(Some(out));
            }
        }
        done.pop().flatten()
    }

    pub(super) fn captures(&self) -> Vec<&'a str> {
        let mut out = Vec::new();
        let mut pending = vec![self];
        while let Some(value) = pending.pop() {
            work::count(Work::Walked, 1);
            if !matches!(value.shape(), Outcome::Uses(_)) {
                continue;
            }
            if value.0.children.is_empty() {
                if let Source::Written(part) = value.0.source {
                    walk_captures(part, true, false, &mut out);
                }
            } else {
                pending.extend(value.0.children.iter().rev());
            }
        }
        out
    }

    // These conversions only materialize the reduced form. They apply no
    // reduction rules. Lowering calls them after document depth validation.
    pub(super) fn condition(&self) -> Simple {
        match self.shape() {
            Outcome::True => Simple::True,
            Outcome::False => Simple::False,
            _ => Simple::Cond(self.open_condition()),
        }
    }
    fn open_condition(&self) -> Cond {
        let cond = |i: usize| Box::new(self.0.children[i].open_condition());
        let term = |i: usize| self.0.children[i].term();
        match self.0.source {
            Source::Not | Source::Written(Part::Cond(Cond::Not(_))) => Cond::Not(cond(0)),
            Source::Written(Part::Cond(Cond::All(_))) => {
                Cond::All(self.0.children.iter().map(Self::open_condition).collect())
            }
            Source::Written(Part::Cond(Cond::Any(_))) => {
                Cond::Any(self.0.children.iter().map(Self::open_condition).collect())
            }
            Source::Written(Part::Cond(Cond::If(_, _))) => Cond::If(cond(0), cond(1)),
            Source::Written(Part::Cond(Cond::Compare(op, _, _, at))) => {
                Cond::Compare(op.clone(), term(0), term(1), *at)
            }
            Source::Written(Part::Cond(Cond::Truthy(_))) => Cond::Truthy(term(0)),
            Source::Written(Part::Cond(Cond::Forest(_))) => Cond::Forest(term(0)),
            Source::Written(Part::Cond(original)) => original.clone(),
            _ => unreachable!("an open condition"),
        }
    }
    pub(super) fn term(&self) -> Term {
        if self.shape() == Outcome::Empty {
            return Term::EmptySet;
        }
        let term = |i: usize| Box::new(self.0.children[i].term());
        match self.0.source {
            Source::Written(Part::Term(Term::If(_, _))) => {
                Term::If(Box::new(self.0.children[0].open_condition()), term(1))
            }
            Source::Written(Part::Term(Term::Union(_))) => {
                Term::Union(self.0.children.iter().map(Self::term).collect())
            }
            Source::Written(Part::Term(Term::Intersection(_))) => {
                Term::Intersection(self.0.children.iter().map(Self::term).collect())
            }
            Source::Written(Part::Term(Term::Difference(_, _))) => Term::Difference(term(0), term(1)),
            Source::Written(Part::Term(original)) => original.clone(),
            _ => unreachable!("a term"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_simplify_deep_open_conditions_before_the_depth_check() {
        let mut condition = Cond::Compare("=".into(), Term::Capture("c".into()), Term::Str("a".into()), None);
        for _ in 0..20_000 {
            condition = Cond::Not(Box::new(condition));
        }
        let result = super::super::Shaped::of(Part::Cond(&condition), &|_| true);
        assert_eq!(result.uses, vec!["c"]);
        assert_eq!(result.outcome(&|_| false), Outcome::Uses(Some("c")));
    }
}
