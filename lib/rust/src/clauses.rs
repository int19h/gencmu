//! A rule's clauses against the captures of its alternatives (engine §3.6,
//! §9): simplifying a clause for a production, the captures a clause uses,
//! and the checks of a definition as a whole.

use std::collections::{HashMap, HashSet};

use crate::fxhash::{FxMap, FxSet};
use crate::work::{self, Mutant, Work};

use crate::dom::{constants_in_cond, constants_in_term, Arg, Cond, EmitItem, Expr, Mark, RuleDef, Term};

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
    work::count(Work::Walked, 1);
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
        Cond::Matches(..) | Cond::Begins(..) | Cond::Initial(_) => Simple::Cond(cond.clone()),
    }
}

/// Simplifies a term for a production (engine §3.6): `None` where it is
/// the empty set, written `∅` or left by a guard that does not hold. The
/// empty set is dropped from a union, makes an intersection empty, makes a
/// difference whose first part it is empty and one whose second part it is
/// its first part, and makes a guarded term empty.
pub(crate) fn simplify_term(term: &Term, has: &dyn Fn(&str) -> bool) -> Option<Term> {
    work::count(Work::Walked, 1);
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
        Term::Difference(left, right) => {
            let left = simplify_term(left, has)?;
            Some(match simplify_term(right, has) {
                None => left,
                Some(right) => Term::Difference(Box::new(left), Box::new(right)),
            })
        }
        _ => Some(term.clone()),
    }
}

/// A term simplified for a production, the empty set written out.
pub(crate) fn simplify_value(term: &Term, has: &dyn Fn(&str) -> bool) -> Term {
    simplify_term(term, has).unwrap_or(Term::EmptySet)
}

/// A part of a clause: a term or a condition.
#[derive(Clone, Copy)]
enum Part<'a> {
    Term(&'a Term),
    Cond(&'a Cond),
}

/// The captures that a clause uses as values or spans, presence tests
/// aside (`values`), or its presence tests, outside calls (`presences`), in
/// the order written. One walk, with an explicit stack: a clause is as deep
/// as its document nests until the check of its depth (§9).
fn walk_captures<'a>(start: Part<'a>, values: bool, presences: bool, out: &mut Vec<&'a str>) {
    let mut stack = vec![start];
    while let Some(part) = stack.pop() {
        work::count(Work::Walked, 1);
        match part {
            Part::Term(term) => match term {
                Term::Capture(name) => {
                    if values {
                        out.push(name);
                    }
                }
                Term::Union(items) | Term::Intersection(items) => stack.extend(items.iter().rev().map(Part::Term)),
                Term::Difference(left, right) => stack.extend([Part::Term(right), Part::Term(left)]),
                Term::Call(_, args) => {
                    if values {
                        stack.extend(args.iter().rev().filter_map(|arg| match arg {
                            Arg::Term(term) => Some(Part::Term(term)),
                            _ => None,
                        }));
                    }
                }
                Term::If(cond, then) => stack.extend([Part::Term(then), Part::Cond(cond)]),
                Term::Pattern(_) | Term::Str(_) | Term::Tag(_) | Term::Range(..) | Term::EmptySet | Term::Const(..) => {
                }
            },
            Part::Cond(cond) => match cond {
                Cond::Captured(name) => {
                    if presences {
                        out.push(name);
                    }
                }
                Cond::Compare(_, left, right) => stack.extend([Part::Term(right), Part::Term(left)]),
                Cond::Matches(span, _) | Cond::Begins(span, _) | Cond::Initial(span) => {
                    if values {
                        stack.push(Part::Term(span));
                    }
                }
                Cond::Not(inner) => stack.push(Part::Cond(inner)),
                Cond::Any(items) | Cond::All(items) => stack.extend(items.iter().rev().map(Part::Cond)),
                Cond::If(antecedent, consequent) => stack.extend([Part::Cond(consequent), Part::Cond(antecedent)]),
            },
        }
    }
}

fn term_captures<'a>(term: &'a Term, out: &mut Vec<&'a str>) {
    walk_captures(Part::Term(term), true, false, out);
}

fn cond_captures<'a>(cond: &'a Cond, out: &mut Vec<&'a str>) {
    walk_captures(Part::Cond(cond), true, false, out);
}

fn term_presences<'a>(term: &'a Term, out: &mut Vec<&'a str>) {
    walk_captures(Part::Term(term), false, true, out);
}

fn cond_presences<'a>(cond: &'a Cond, out: &mut Vec<&'a str>) {
    walk_captures(Part::Cond(cond), false, true, out);
}

/// What a clause gives for a production once simplified (§3.6), as far as
/// the checks of a definition need it: a condition true or false, or else
/// the first capture its simplified form uses that the production lacks,
/// if any; a term empty, or else that first capture. It walks the clause
/// once, with an explicit stack, and builds no simplified clause, so a
/// deep clause costs its size.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Outcome<'a> {
    True,
    False,
    Empty,
    Uses(Option<&'a str>),
}

fn simplified_outcome<'a>(start: Part<'a>, has: &dyn Fn(&str) -> bool) -> Outcome<'a> {
    Shaped::of(start, has).outcome(has)
}

/// What a clause gives once simplified, before the captures it uses are
/// asked about. Its shape is its outcome, with `Uses(None)` for any use.
/// Its uses are the captures of its simplified form, in the order written.
struct Shaped<'a> {
    shape: Outcome<'a>,
    uses: Vec<&'a str>,
}

impl<'a> Shaped<'a> {
    /// The shape of a clause for a production whose presence tests `has`
    /// answers. A part that reads no presence never asks it.
    fn of(start: Part<'a>, has: &dyn Fn(&str) -> bool) -> Shaped<'a> {
        // Each part is met twice: first to push its parts, then to combine
        // their outcomes, which stand on `done` in the order written. When
        // a part is combined, the captures of its leaves stand last in
        // `uses`. So a part that the simplified form drops removes them by
        // a truncation to where it started.
        let mut stack: Vec<(Part<'a>, Option<usize>)> = vec![(start, None)];
        let mut done: Vec<Outcome<'a>> = Vec::new();
        let mut uses: Vec<&'a str> = Vec::new();
        let used = Outcome::Uses(None);
        while let Some((part, combine)) = stack.pop() {
            work::count(Work::Walked, 1);
            let Some(from) = combine else {
                let children: Vec<Part<'a>> = match part {
                    Part::Term(Term::If(cond, then)) => vec![Part::Cond(cond), Part::Term(then)],
                    Part::Term(Term::Union(items) | Term::Intersection(items)) => {
                        items.iter().map(Part::Term).collect()
                    }
                    Part::Term(Term::Difference(left, right)) => vec![Part::Term(left), Part::Term(right)],
                    Part::Cond(Cond::Not(inner)) => vec![Part::Cond(inner)],
                    Part::Cond(Cond::Any(items) | Cond::All(items)) => items.iter().map(Part::Cond).collect(),
                    Part::Cond(Cond::If(antecedent, consequent)) => {
                        vec![Part::Cond(antecedent), Part::Cond(consequent)]
                    }
                    Part::Cond(Cond::Compare(_, left, right)) => vec![Part::Term(left), Part::Term(right)],
                    _ => Vec::new(),
                };
                stack.push((part, Some(uses.len())));
                stack.extend(children.into_iter().rev().map(|child| (child, None)));
                continue;
            };
            let outcome = match part {
                Part::Term(term) => match term {
                    Term::EmptySet => Outcome::Empty,
                    Term::If(..) => {
                        let then = done.pop().expect("the term");
                        match done.pop().expect("the condition") {
                            Outcome::False => Outcome::Empty,
                            Outcome::True => then,
                            Outcome::Uses(_) => match then {
                                Outcome::Empty => Outcome::Empty,
                                Outcome::Uses(_) => used,
                                _ => unreachable!("a term is empty or uses captures"),
                            },
                            Outcome::Empty => unreachable!("a condition is not empty"),
                        }
                    }
                    Term::Union(items) => {
                        let parts = done.split_off(done.len() - items.len());
                        if parts.iter().any(|outcome| matches!(outcome, Outcome::Uses(_))) {
                            used
                        } else {
                            Outcome::Empty
                        }
                    }
                    Term::Intersection(items) => {
                        let parts = done.split_off(done.len() - items.len());
                        if parts.iter().all(|outcome| matches!(outcome, Outcome::Uses(_))) {
                            used
                        } else {
                            Outcome::Empty
                        }
                    }
                    Term::Difference(..) => {
                        done.pop().expect("the second part");
                        match done.pop().expect("the first part") {
                            Outcome::Uses(_) => used,
                            _ => Outcome::Empty,
                        }
                    }
                    // A capture, a literal or a call, as written.
                    _ => {
                        walk_captures(part, true, false, &mut uses);
                        used
                    }
                },
                Part::Cond(cond) => match cond {
                    Cond::Captured(name) => {
                        if has(name) {
                            Outcome::True
                        } else {
                            Outcome::False
                        }
                    }
                    Cond::Not(_) => match done.pop().expect("the condition") {
                        Outcome::True => Outcome::False,
                        Outcome::False => Outcome::True,
                        other => other,
                    },
                    Cond::All(items) | Cond::Any(items) => {
                        let all = matches!(cond, Cond::All(_));
                        let parts = done.split_off(done.len() - items.len());
                        let (stop, skip) = if all { (Outcome::False, true) } else { (Outcome::True, false) };
                        let mut left = 0;
                        let mut stopped = false;
                        for outcome in parts {
                            match outcome {
                                Outcome::True if !all => stopped = true,
                                Outcome::False if all => stopped = true,
                                Outcome::True | Outcome::False => {}
                                Outcome::Uses(_) => left += 1,
                                Outcome::Empty => unreachable!("a condition is not empty"),
                            }
                        }
                        if stopped {
                            stop
                        } else if left == 0 {
                            if skip {
                                Outcome::True
                            } else {
                                Outcome::False
                            }
                        } else {
                            used
                        }
                    }
                    Cond::If(..) => {
                        let consequent = done.pop().expect("the consequent");
                        match done.pop().expect("the antecedent") {
                            Outcome::False => Outcome::True,
                            Outcome::True => consequent,
                            Outcome::Uses(_) => match consequent {
                                Outcome::True => Outcome::True,
                                Outcome::False | Outcome::Uses(_) => used,
                                Outcome::Empty => unreachable!("a condition is not empty"),
                            },
                            Outcome::Empty => unreachable!("a condition is not empty"),
                        }
                    }
                    // An empty side is written out as ∅, which uses nothing.
                    Cond::Compare(..) => {
                        done.truncate(done.len() - 2);
                        used
                    }
                    Cond::Matches(..) | Cond::Begins(..) | Cond::Initial(_) => {
                        walk_captures(part, true, false, &mut uses);
                        used
                    }
                },
            };
            // A part that is decided or empty uses nothing in the
            // simplified form, and neither do its parts.
            if !matches!(outcome, Outcome::Uses(_)) {
                uses.truncate(from);
            }
            done.push(outcome);
        }
        Shaped { shape: done.pop().expect("the outcome"), uses }
    }

    /// The outcome for a production that has the captures `has`: the
    /// first capture used that it lacks, or none.
    fn outcome(&self, has: &dyn Fn(&str) -> bool) -> Outcome<'a> {
        match self.shape {
            Outcome::Uses(_) => Outcome::Uses(self.uses.iter().copied().find(|name| !has(name))),
            shape => shape,
        }
    }
}

/// What simplification knows of one part of a clause before it meets a
/// production (§3.6).
enum Known<'a, T> {
    /// The part reads no presence, so its result is the same for every
    /// production.
    Fixed(T),
    /// The part is `$c ⟹ X`, and X reads no presence: the result of X
    /// where the production has c.
    Guarded(&'a str, T),
    /// The part reads no presence, and it uses captures. Its result counts
    /// only where the production has the capture named, since a production
    /// that lacks any capture the part uses drops it.
    Needs(String, T),
    /// The part has another shape, and each production simplifies it.
    Other,
}

/// The parts of a union, of a list of conditions, or of a `∧` or a `∨`,
/// split once for a rule (§3.6). A choice of n captures with one guarded
/// part each would otherwise cost n for each of its n productions. Here a
/// production costs its own captures and the parts it keeps.
struct Split<'a, P, T> {
    /// Each part, with its result where that is known before the
    /// productions.
    parts: Vec<(P, Option<T>)>,
    /// The fixed parts whose result counts, in the order written.
    fixed: Vec<usize>,
    /// The guarded parts whose result counts, under the name of their
    /// guard. A name whose parts all have a neutral result stays, with no
    /// parts, so that a `∨` can ask whether a production has every guard.
    guarded: FxMap<&'a str, Vec<usize>>,
    /// The parts that need a capture, under its name.
    needs: FxMap<String, Vec<usize>>,
    /// The parts of other shapes, in the order written.
    other: Vec<usize>,
    /// Whether a fixed part decides the whole for every production.
    absorbed: bool,
}

impl<'a, P: Copy, T> Split<'a, P, T> {
    /// Splits `parts`, finding what `know` can find of each before the
    /// productions. A part whose known result is `neutral` drops out of
    /// the whole, and one that is `absorbing` decides it.
    fn new(
        parts: impl IntoIterator<Item = P>,
        know: impl Fn(P) -> Known<'a, T>,
        neutral: impl Fn(&T) -> bool,
        absorbing: impl Fn(&T) -> bool,
    ) -> Split<'a, P, T> {
        let mut split = Split {
            parts: Vec::new(),
            fixed: Vec::new(),
            guarded: FxMap::default(),
            needs: FxMap::default(),
            other: Vec::new(),
            absorbed: false,
        };
        for part in parts {
            work::count(Work::Walked, 1);
            let index = split.parts.len();
            let result = match know(part) {
                Known::Fixed(result) => {
                    split.absorbed |= absorbing(&result);
                    if !neutral(&result) {
                        split.fixed.push(index);
                    }
                    Some(result)
                }
                Known::Guarded(name, result) => {
                    let parts = split.guarded.entry(name).or_default();
                    if !neutral(&result) {
                        parts.push(index);
                    }
                    Some(result)
                }
                Known::Needs(name, result) => {
                    split.needs.entry(name).or_default().push(index);
                    Some(result)
                }
                Known::Other => {
                    split.other.push(index);
                    None
                }
            };
            split.parts.push((part, result));
        }
        split
    }

    /// The parts that count for a production whose distinct captures are
    /// `own`, in the order written, and how many guard names it has. Each
    /// capture asked about and each part kept counts as it is met.
    fn select<'n>(&self, own: impl Iterator<Item = &'n str>) -> (Vec<usize>, usize) {
        let mut chosen: Vec<usize> = Vec::new();
        let mut present = 0;
        for name in own {
            work::count(Work::Walked, 1);
            if let Some(parts) = self.guarded.get(name) {
                present += 1;
                for &index in parts {
                    work::count(Work::Walked, 1);
                    chosen.push(index);
                }
            }
            for &index in self.needs.get(name).into_iter().flatten() {
                work::count(Work::Walked, 1);
                chosen.push(index);
            }
        }
        for &index in self.fixed.iter().chain(&self.other) {
            work::count(Work::Walked, 1);
            chosen.push(index);
        }
        chosen.sort_unstable();
        (chosen, present)
    }
}

/// Whether a term or a condition tests the presence of a capture outside
/// a call: those are the parts that simplification changes for each
/// production.
fn term_reads_presence(term: &Term) -> bool {
    let mut out = Vec::new();
    term_presences(term, &mut out);
    !out.is_empty()
}

fn cond_reads_presence(cond: &Cond) -> bool {
    let mut out = Vec::new();
    cond_presences(cond, &mut out);
    !out.is_empty()
}

/// The parts of a term as a union, or the term alone.
fn union_parts(term: &Term) -> &[Term] {
    match term {
        Term::Union(items) => items,
        term => std::slice::from_ref(term),
    }
}

/// What is known of a part of a union before the productions, given how
/// to find the result of a part that reads no presence.
fn know_term<'a, T>(term: &'a Term, fixed: &dyn Fn(&'a Term) -> T) -> Known<'a, T> {
    if !term_reads_presence(term) {
        return Known::Fixed(fixed(term));
    }
    match term {
        Term::If(cond, then) => match &**cond {
            Cond::Captured(name) if !name.is_empty() && !term_reads_presence(then) => Known::Guarded(name, fixed(then)),
            _ => Known::Other,
        },
        _ => Known::Other,
    }
}

/// What is known of a condition before the productions, as for a term.
fn know_cond<'a, T>(cond: &'a Cond, fixed: &dyn Fn(&'a Cond) -> T) -> Known<'a, T> {
    if !cond_reads_presence(cond) {
        return Known::Fixed(fixed(cond));
    }
    match cond {
        Cond::If(antecedent, consequent) => match &**antecedent {
            Cond::Captured(name) if !name.is_empty() && !cond_reads_presence(consequent) => {
                Known::Guarded(name, fixed(consequent))
            }
            _ => Known::Other,
        },
        _ => Known::Other,
    }
}

/// The first name in order of the captures, other than `$`, that a
/// simplified condition uses as values or spans.
fn first_capture(cond: &Cond) -> Option<String> {
    let mut out = Vec::new();
    cond_captures(cond, &mut out);
    out.into_iter().filter(|name| !name.is_empty()).min().map(str::to_string)
}

/// The presence tests of a part that reads none: never asked.
fn no_presence(_: &str) -> bool {
    unreachable!("a part that reads no presence asks about none")
}

/// A tag term split once for a rule, to simplify for each production in
/// what the production keeps (§3.6). The result is `simplify_term`'s.
pub(crate) struct TermSplit<'a>(Split<'a, &'a Term, Option<Term>>);

impl<'a> TermSplit<'a> {
    pub(crate) fn new(term: &'a Term) -> TermSplit<'a> {
        let fixed = |part: &'a Term| simplify_term(part, &no_presence);
        let unindexed = work::mutated(Mutant::FixedUnindexed);
        let know = |part| match know_term(part, &fixed) {
            // The check of a definition refuses a tag term that uses a
            // capture some production lacks. So in lowering a production
            // with the part's first name has them all, and one without it
            // never meets the part. The check itself cannot index so,
            // since it must find that capture.
            Known::Fixed(Some(term)) if !unindexed => {
                let mut out = Vec::new();
                term_captures(&term, &mut out);
                match out.into_iter().filter(|name| !name.is_empty()).min().map(str::to_string) {
                    Some(name) => Known::Needs(name, Some(term)),
                    None => Known::Fixed(Some(term)),
                }
            }
            known => known,
        };
        TermSplit(Split::new(union_parts(term), know, Option::is_none, |_| false))
    }

    /// The term simplified for a production whose distinct captures are
    /// `own` and whose presence tests `has` answers.
    pub(crate) fn simplify<'n>(&self, own: impl Iterator<Item = &'n str>, has: &dyn Fn(&str) -> bool) -> Option<Term> {
        let (chosen, _) = self.0.select(own);
        let mut left: Vec<Term> = Vec::with_capacity(chosen.len());
        for index in chosen {
            match &self.0.parts[index] {
                (_, Some(known)) => left.extend(known.clone()),
                (part, None) => left.extend(simplify_term(part, has)),
            }
        }
        match left.len() {
            0 => None,
            1 => left.pop(),
            _ => Some(Term::Union(left)),
        }
    }
}

/// How one condition of a list simplifies for each production: as a `∧`
/// or a `∨` split into its parts, or whole.
enum CondParts<'a> {
    All(Split<'a, &'a Cond, Simple>),
    Any(Split<'a, &'a Cond, Simple>),
    Whole(&'a Cond),
}

impl<'a> CondParts<'a> {
    fn new(cond: &'a Cond) -> CondParts<'a> {
        let fixed = |part: &'a Cond| simplify_cond(part, &no_presence);
        let know = |part| know_cond(part, &fixed);
        match cond {
            Cond::All(items) => CondParts::All(Split::new(
                items,
                know,
                |simple| *simple == Simple::True,
                |simple| *simple == Simple::False,
            )),
            Cond::Any(items) => CondParts::Any(Split::new(
                items,
                know,
                |simple| *simple == Simple::False,
                |simple| *simple == Simple::True,
            )),
            cond => CondParts::Whole(cond),
        }
    }

    /// The condition simplified for a production, as `simplify_cond`
    /// gives it.
    fn simplify<'n>(&self, own: impl Iterator<Item = &'n str>, has: &dyn Fn(&str) -> bool) -> Simple {
        let (split, all) = match self {
            CondParts::Whole(cond) => return simplify_cond(cond, has),
            CondParts::All(split) => (split, true),
            CondParts::Any(split) => (split, false),
        };
        // A `∧` stops at a false part and a `∨` at a true one. A `∨` is
        // also true where a guard of it is absent.
        let (stop, rest) = if all { (Simple::False, Simple::True) } else { (Simple::True, Simple::False) };
        if split.absorbed {
            return stop;
        }
        let (chosen, present) = split.select(own);
        if !all && present < split.guarded.len() {
            return Simple::True;
        }
        let mut left = Vec::with_capacity(chosen.len());
        for index in chosen {
            let simple = match &split.parts[index] {
                (_, Some(known)) => known.clone(),
                (part, None) => simplify_cond(part, has),
            };
            match simple {
                Simple::Cond(cond) => left.push(cond),
                simple if simple == stop => return stop,
                _ => {}
            }
        }
        match left.len() {
            0 => rest,
            1 => Simple::Cond(left.pop().expect("one condition")),
            _ if all => Simple::Cond(Cond::All(left)),
            _ => Simple::Cond(Cond::Any(left)),
        }
    }
}

/// A list of conditions split once for a rule, to simplify for each
/// production in what the production keeps (§3.6).
pub(crate) struct CondListSplit<'a> {
    split: Split<'a, &'a Cond, Simple>,
    /// For each condition of another shape, its own split.
    parts: FxMap<usize, CondParts<'a>>,
}

impl<'a> CondListSplit<'a> {
    pub(crate) fn new(conds: &'a [Cond]) -> CondListSplit<'a> {
        let fixed = |part: &'a Cond| simplify_cond(part, &no_presence);
        let unindexed = work::mutated(Mutant::FixedUnindexed);
        let know = |part| match know_cond(part, &fixed) {
            // Lowering drops a condition that uses a capture the production
            // lacks, so only a production with its first name keeps it.
            Known::Fixed(Simple::Cond(cond)) if !unindexed => match first_capture(&cond) {
                Some(name) => Known::Needs(name, Simple::Cond(cond)),
                None => Known::Fixed(Simple::Cond(cond)),
            },
            known => known,
        };
        let split = Split::new(conds, know, |simple| *simple == Simple::True, |simple| *simple == Simple::False);
        let parts = split.other.iter().map(|&index| (index, CondParts::new(split.parts[index].0))).collect();
        CondListSplit { split, parts }
    }

    /// The conditions that remain for a production, simplified in the
    /// order written, or `None` where one is false, which removes the
    /// production. A condition true for it is left out.
    pub(crate) fn simplify(&self, own: &[&str], has: &dyn Fn(&str) -> bool) -> Option<Vec<Cond>> {
        if self.split.absorbed {
            return None;
        }
        let (chosen, _) = self.split.select(own.iter().copied());
        let mut left = Vec::with_capacity(chosen.len());
        for index in chosen {
            let simple = match &self.split.parts[index] {
                (_, Some(known)) => known.clone(),
                _ => self.parts[&index].simplify(own.iter().copied(), has),
            };
            match simple {
                Simple::True => {}
                Simple::False => return None,
                Simple::Cond(cond) => left.push(cond),
            }
        }
        Some(left)
    }
}

/// A tag term split once for the check of a definition (§9). For each
/// production it finds the first capture of the simplified form that the
/// production lacks, as `simplified_outcome` finds it.
struct TermCheck<'a>(Split<'a, &'a Term, Shaped<'a>>);

impl<'a> TermCheck<'a> {
    fn new(term: &'a Term) -> TermCheck<'a> {
        let fixed = |part: &'a Term| Shaped::of(Part::Term(part), &no_presence);
        TermCheck(Split::new(
            union_parts(term),
            |part| know_term(part, &fixed),
            |shaped| shaped.shape == Outcome::Empty,
            |_| false,
        ))
    }

    fn missing<'n>(&self, own: impl Iterator<Item = &'n str>, has: &dyn Fn(&str) -> bool) -> Option<&'a str> {
        let (chosen, _) = self.0.select(own);
        for index in chosen {
            let outcome = match &self.0.parts[index] {
                (_, Some(shaped)) => shaped.outcome(has),
                (part, None) => simplified_outcome(Part::Term(part), has),
            };
            if let Outcome::Uses(Some(missing)) = outcome {
                return Some(missing);
            }
        }
        None
    }
}

/// The productions that a condition can apply to: none, every one, or
/// only those with the capture named.
enum Reach<'a> {
    Nothing,
    Every,
    Named(&'a str),
}

/// A condition split once for the check of a definition (§9), to find
/// its outcome for each production as `simplified_outcome` finds it.
enum CondCheck<'a> {
    Fixed(Shaped<'a>),
    Guarded(&'a str, Shaped<'a>),
    All(Split<'a, &'a Cond, Shaped<'a>>),
    Any(Split<'a, &'a Cond, Shaped<'a>>),
    Whole(&'a Cond),
}

impl<'a> CondCheck<'a> {
    fn new(cond: &'a Cond) -> CondCheck<'a> {
        let fixed = |part: &'a Cond| Shaped::of(Part::Cond(part), &no_presence);
        let know = |part| know_cond(part, &fixed);
        match know(cond) {
            Known::Fixed(shaped) => CondCheck::Fixed(shaped),
            Known::Guarded(name, shaped) => CondCheck::Guarded(name, shaped),
            Known::Needs(..) => unreachable!("a condition of the check needs no capture"),
            Known::Other => match cond {
                Cond::All(items) => CondCheck::All(Split::new(
                    items,
                    know,
                    |shaped| shaped.shape == Outcome::True,
                    |shaped| shaped.shape == Outcome::False,
                )),
                Cond::Any(items) => CondCheck::Any(Split::new(
                    items,
                    know,
                    |shaped| shaped.shape == Outcome::False,
                    |shaped| shaped.shape == Outcome::True,
                )),
                cond => CondCheck::Whole(cond),
            },
        }
    }

    /// The productions that the condition can apply to, as far as that is
    /// known before them. A production that lacks a capture that a fixed
    /// condition uses, or the guard of a guarded one, finds it unknown or
    /// true.
    fn reach(&self) -> Reach<'a> {
        match self {
            CondCheck::Fixed(shaped) => match shaped.shape {
                Outcome::True => Reach::Nothing,
                Outcome::Uses(_) => match shaped.uses.iter().copied().filter(|name| !name.is_empty()).min() {
                    Some(name) => Reach::Named(name),
                    None => Reach::Every,
                },
                _ => Reach::Every,
            },
            CondCheck::Guarded(name, _) => Reach::Named(name),
            _ => Reach::Every,
        }
    }

    fn outcome<'n>(&self, own: impl Iterator<Item = &'n str>, has: &dyn Fn(&str) -> bool) -> Outcome<'a> {
        let (split, all) = match self {
            CondCheck::Fixed(shaped) => return shaped.outcome(has),
            CondCheck::Guarded(name, shaped) => return if has(name) { shaped.outcome(has) } else { Outcome::True },
            CondCheck::Whole(cond) => return simplified_outcome(Part::Cond(cond), has),
            CondCheck::All(split) => (split, true),
            CondCheck::Any(split) => (split, false),
        };
        // A `∧` stops at a false part and a `∨` at a true one. A `∨` is
        // also true where a guard of it is absent.
        let (stop, rest) = if all { (Outcome::False, Outcome::True) } else { (Outcome::True, Outcome::False) };
        if split.absorbed {
            return stop;
        }
        let (chosen, present) = split.select(own);
        if !all && present < split.guarded.len() {
            return Outcome::True;
        }
        let (mut used, mut left) = (None, 0);
        for index in chosen {
            let outcome = match &split.parts[index] {
                (_, Some(shaped)) => shaped.outcome(has),
                (part, None) => simplified_outcome(Part::Cond(part), has),
            };
            match outcome {
                Outcome::Uses(part) => {
                    used = used.or(part);
                    left += 1;
                }
                outcome if outcome == stop => return stop,
                _ => {}
            }
        }
        if left == 0 {
            rest
        } else {
            Outcome::Uses(used)
        }
    }
}

/// The items of an emission indexed once for a rule (§9, §11). A
/// production keeps an inserted tag, an item of `$`, and an item whose
/// carrier it has. So it finds its items from its own captures, and the
/// items it might attach to from the names of their attachments.
pub(crate) struct EmitIndex<'a> {
    /// The items that every production keeps.
    always: Vec<usize>,
    /// The other items, under the name of their carrier.
    carriers: FxMap<&'a str, Vec<usize>>,
    /// The capture items under the name of each of their attachments.
    attached: FxMap<&'a str, Vec<usize>>,
    /// The capture items with an attachment of `$`, which every
    /// production has.
    attached_always: Vec<usize>,
}

impl<'a> EmitIndex<'a> {
    pub(crate) fn new(items: &'a [EmitItem]) -> EmitIndex<'a> {
        let mut index = EmitIndex {
            always: Vec::new(),
            carriers: FxMap::default(),
            attached: FxMap::default(),
            attached_always: Vec::new(),
        };
        for (at, item) in items.iter().enumerate() {
            work::count(Work::Walked, 1);
            let EmitItem::Capture(carrier, _, attachments) = item else {
                index.always.push(at);
                continue;
            };
            if carrier.is_empty() {
                index.always.push(at);
            } else {
                index.carriers.entry(carrier).or_default().push(at);
            }
            for name in attachments.names() {
                work::count(Work::Walked, 1);
                if name.is_empty() {
                    index.attached_always.push(at);
                } else {
                    index.attached.entry(name).or_default().push(at);
                }
            }
        }
        index
    }

    /// The items found under each of `own` in `map`, with `always`, in
    /// the order written and each once.
    fn gather<'n>(
        map: &FxMap<&'a str, Vec<usize>>,
        always: &[usize],
        own: impl Iterator<Item = &'n str>,
    ) -> Vec<usize> {
        let mut found: Vec<usize> = Vec::new();
        for name in own {
            work::count(Work::Walked, 1);
            for &at in map.get(name).into_iter().flatten() {
                work::count(Work::Walked, 1);
                found.push(at);
            }
        }
        for &at in always {
            work::count(Work::Walked, 1);
            found.push(at);
        }
        found.sort_unstable();
        found.dedup();
        found
    }

    /// The items that a production whose distinct captures are `own`
    /// keeps, in the order written.
    pub(crate) fn kept<'n>(&self, own: impl Iterator<Item = &'n str>) -> Vec<usize> {
        Self::gather(&self.carriers, &self.always, own)
    }

    /// The capture items that have an attachment among `own`, in the
    /// order written. Only these could attach a capture to a production
    /// that lacks their carrier.
    fn attaching<'n>(&self, own: impl Iterator<Item = &'n str>) -> Vec<usize> {
        Self::gather(&self.attached, &self.attached_always, own)
    }
}

/// The captures that some production of an expression reads after a
/// capture of the same name (engine §3.5, §9), found from the structure
/// alone: two captures are read by one production exactly when they stand
/// in different items of one sequence or one `&`, since each item is read in
/// any of its expansions. So no production is listed. A choice's branches
/// never meet, and braces and an elidable optional hold no capture. Each
/// capture is its index in the order written, and the list is increasing.
pub(crate) fn duplicate_captures(expr: &Expr) -> Vec<usize> {
    // Each part gives its captures, by name, each a list of indices, and
    // counts them. An item of a sequence or an `&` meets the items before
    // it: the side with fewer captures is looked up in the other, and the
    // two are then joined, the smaller into the larger, so that each
    // capture moves a number of times that grows with the logarithm of
    // their count, not with the depth of the expression.
    type Found<'e> = (HashMap<&'e str, Vec<usize>>, usize);
    let mut duplicate: Vec<bool> = Vec::new();
    let mut stack: Vec<(&Expr, bool)> = vec![(expr, false)];
    let mut done: Vec<Found> = Vec::new();
    let empty = || (HashMap::new(), 0);
    while let Some((expr, combine)) = stack.pop() {
        work::count(Work::Walked, 1);
        if !combine {
            match expr {
                Expr::Capture(name, _) => {
                    duplicate.push(false);
                    done.push((HashMap::from([(name.as_str(), vec![duplicate.len() - 1])]), 1));
                }
                Expr::Seq(items) | Expr::And(items) | Expr::Choice(items) => {
                    stack.push((expr, true));
                    stack.extend(items.iter().rev().map(|item| (item, false)));
                }
                Expr::Optional(inner, Mark::Plain) => {
                    stack.push((expr, true));
                    stack.push((inner, false));
                }
                Expr::Optional(..) | Expr::Repeat(..) | Expr::Tested(..) => {
                    // No production reads a capture here, but its index
                    // counts.
                    let mut inside = vec![expr];
                    while let Some(current) = inside.pop() {
                        work::count(Work::Walked, 1);
                        match current {
                            Expr::Capture(..) => duplicate.push(false),
                            Expr::Seq(items) | Expr::Choice(items) | Expr::And(items) => {
                                inside.extend(items.iter().rev())
                            }
                            Expr::Optional(inner, _) | Expr::Tested(_, _, inner) => inside.push(inner),
                            Expr::Repeat(item, separator, _) => {
                                inside.extend(separator.as_deref());
                                inside.push(item);
                            }
                            _ => {}
                        }
                    }
                    done.push(empty());
                }
                Expr::Ref(_) | Expr::Terminal(_) | Expr::Range(..) | Expr::Property(_) | Expr::Empty => {
                    done.push(empty())
                }
            }
            continue;
        }
        let count = match expr {
            Expr::Seq(items) | Expr::And(items) | Expr::Choice(items) => items.len(),
            _ => 1,
        };
        let parts = done.split_off(done.len() - count);
        let meets = matches!(expr, Expr::Seq(_) | Expr::And(_));
        let mut parts = parts.into_iter();
        let mut joined = parts.next().unwrap_or_else(empty);
        // A test-only switch looks up and moves the newer part, whatever
        // its size, as a join without the rule of the smaller would.
        let larger_last = work::mutated(Mutant::JoinIntoFirst);
        for mut part in parts {
            // Each name looked up, each capture marked and each capture
            // moved counts before its work. A name met again keeps its
            // place, but its later captures are taken from their list as
            // they are marked. So a capture is marked once, not again at
            // each level above it.
            if meets {
                if joined.1 <= part.1 && !larger_last {
                    for name in joined.0.keys() {
                        work::count(Work::Walked, 1);
                        if let Some(indices) = part.0.get_mut(name) {
                            mark(&mut duplicate, indices);
                        }
                    }
                } else {
                    for (name, indices) in &mut part.0 {
                        work::count(Work::Walked, 1);
                        if joined.0.contains_key(name) {
                            mark(&mut duplicate, indices);
                        }
                    }
                }
            }
            if joined.1 < part.1 && !larger_last {
                std::mem::swap(&mut joined, &mut part);
            }
            joined.1 += part.1;
            for (name, indices) in part.0 {
                let list = joined.0.entry(name).or_default();
                for index in indices {
                    work::count(Work::Walked, 1);
                    list.push(index);
                }
            }
        }
        done.push(joined);
    }
    (0..duplicate.len()).filter(|&index| duplicate[index]).collect()
}

/// Marks each capture of a list as repeated and empties the list, so that
/// no later meeting marks them again. A test-only switch marks them and
/// keeps them, as the search did before.
fn mark(duplicate: &mut [bool], indices: &mut Vec<usize>) {
    for &index in indices.iter() {
        work::count(Work::Walked, 1);
        duplicate[index] = true;
    }
    if !work::mutated(Mutant::MarkAgain) {
        indices.clear();
    }
}

/// The distinct sequences of captures that the productions of an
/// expression read, each in the order read (engine §3.2, §3.5): a choice
/// gives each branch's, an `&` each subsequence's, a plain optional none
/// or its content's, and braces and an elidable optional none. Productions
/// that read the same names in the same order are one sequence. Gates do
/// not matter, since they drop whole alternatives.
///
/// A capture is known by its index among the expression's captures in the
/// order written, which is the order a reader meets them.
pub(crate) struct CaptureSequences<'e> {
    /// The name of each capture, by index.
    pub names: Vec<&'e str>,
    /// Each distinct sequence, as indices.
    pub sequences: Vec<Vec<usize>>,
}

impl<'e> CaptureSequences<'e> {
    pub(crate) fn of(expr: &'e Expr) -> CaptureSequences<'e> {
        let mut found = CaptureSequences { names: Vec::new(), sequences: Vec::new() };
        found.sequences = found.visit(expr);
        found
    }

    /// Each production's capture names, in the order it reads them.
    pub(crate) fn named(&self) -> Vec<Vec<&'e str>> {
        self.sequences.iter().map(|sequence| sequence.iter().map(|&index| self.names[index]).collect()).collect()
    }

    fn distinct(&self, lists: Vec<Vec<usize>>) -> Vec<Vec<usize>> {
        // Each name of a key counts as it is read.
        let name = |&index: &usize| {
            work::count(Work::Checked, 1);
            self.names[index]
        };
        if work::mutated(Mutant::ScanDistinct) {
            return self.distinct_by_scans(lists);
        }
        let mut seen: HashSet<Vec<&str>> = HashSet::new();
        let mut out = Vec::new();
        for list in lists {
            let key: Vec<&str> = list.iter().map(name).collect();
            if seen.insert(key) {
                out.push(list);
            }
        }
        out
    }

    /// A mutation for the tests of work: the distinct sequences, each
    /// compared name by name with every one kept before it.
    fn distinct_by_scans(&self, lists: Vec<Vec<usize>>) -> Vec<Vec<usize>> {
        let mut out: Vec<Vec<usize>> = Vec::new();
        for list in lists {
            let same = |kept: &Vec<usize>| {
                kept.len() == list.len()
                    && kept.iter().zip(&list).all(|(&a, &b)| {
                        work::count(Work::Checked, 1);
                        self.names[a] == self.names[b]
                    })
            };
            if !out.iter().any(same) {
                out.push(list);
            }
        }
        out
    }

    fn product(&mut self, mut left: Vec<Vec<usize>>, right: &[Vec<usize>]) -> Vec<Vec<usize>> {
        // With one right sequence, the usual case, each left sequence grows
        // in place, so that a long sequence costs its length. Distinct
        // sequences with one suffix added stay distinct.
        // Each capture counts as it is copied.
        let copied = |&index: &usize| {
            work::count(Work::Checked, 1);
            index
        };
        if let [only] = right {
            for sequence in &mut left {
                if work::mutated(Mutant::CopySequences) {
                    *sequence = sequence.iter().chain(only).map(copied).collect();
                } else {
                    sequence.extend(only.iter().map(copied));
                }
            }
            return left;
        }
        let mut out = Vec::with_capacity(left.len() * right.len());
        for first in left {
            for second in right {
                out.push(first.iter().chain(second).map(copied).collect());
            }
        }
        self.distinct(out)
    }

    /// Counts the captures of a part no production reads, so that the
    /// indices stay those of the order written.
    fn skip(&mut self, expr: &'e Expr) {
        let mut stack = vec![expr];
        while let Some(current) = stack.pop() {
            work::count(Work::Walked, 1);
            match current {
                Expr::Capture(name, _) => self.names.push(name),
                Expr::Seq(items) | Expr::Choice(items) | Expr::And(items) => stack.extend(items.iter().rev()),
                Expr::Optional(inner, _) | Expr::Tested(_, _, inner) => stack.push(inner),
                Expr::Repeat(item, separator, _) => {
                    stack.extend(separator.as_deref());
                    stack.push(item);
                }
                Expr::Ref(_) | Expr::Terminal(_) | Expr::Range(..) | Expr::Property(_) | Expr::Empty => {}
            }
        }
    }

    /// The sequences of an expression, with an explicit stack: each part
    /// is met first to name its captures in the order written and to push
    /// its parts, and then to combine their sequences.
    fn visit(&mut self, expr: &'e Expr) -> Vec<Vec<usize>> {
        let mut stack: Vec<(&'e Expr, bool)> = vec![(expr, false)];
        let mut done: Vec<Vec<Vec<usize>>> = Vec::new();
        while let Some((expr, combine)) = stack.pop() {
            work::count(Work::Walked, 1);
            work::count(Work::Walked, 1);
            if !combine {
                match expr {
                    Expr::Capture(name, _) => {
                        self.names.push(name);
                        done.push(vec![vec![self.names.len() - 1]]);
                    }
                    Expr::Seq(items) | Expr::Choice(items) | Expr::And(items) => {
                        stack.push((expr, true));
                        stack.extend(items.iter().rev().map(|item| (item, false)));
                    }
                    Expr::Optional(inner, Mark::Plain) => {
                        stack.push((expr, true));
                        stack.push((inner, false));
                    }
                    Expr::Optional(..) | Expr::Repeat(..) => {
                        self.skip(expr);
                        done.push(vec![Vec::new()]);
                    }
                    Expr::Tested(..)
                    | Expr::Ref(_)
                    | Expr::Terminal(_)
                    | Expr::Range(..)
                    | Expr::Property(_)
                    | Expr::Empty => done.push(vec![Vec::new()]),
                }
                continue;
            }
            let combined = match expr {
                Expr::Seq(items) => {
                    let parts = done.split_off(done.len() - items.len());
                    let mut sequences = vec![Vec::new()];
                    for part in parts {
                        sequences = self.product(sequences, &part);
                    }
                    sequences
                }
                Expr::Choice(items) => {
                    let parts = done.split_off(done.len() - items.len());
                    let all = parts.into_iter().flatten().collect();
                    self.distinct(all)
                }
                Expr::And(items) => {
                    let parts = done.split_off(done.len() - items.len());
                    let mut all = Vec::new();
                    for mask in 1u64..(1u64 << parts.len().min(63)) {
                        let mut sequences = vec![Vec::new()];
                        for (bit, part) in parts.iter().enumerate() {
                            if mask & (1 << bit) != 0 {
                                sequences = self.product(sequences, part);
                            }
                        }
                        all.extend(sequences);
                    }
                    self.distinct(all)
                }
                _ => {
                    // A plain optional: none, or its content's.
                    let mut all = vec![Vec::new()];
                    all.extend(done.pop().expect("the content"));
                    self.distinct(all)
                }
            };
            done.push(combined);
        }
        done.pop().expect("the sequences")
    }
}

/// Whether a term holds a constant. A constant is its value in
/// simplification (§3.6), and the DOM holds no value, so the checks that
/// simplification decides wait for the loader, which substitutes the values
/// and checks the definition again (§9).
fn term_waits(term: &Term) -> bool {
    let mut out = Vec::new();
    constants_in_term(term, &mut out);
    !out.is_empty()
}

fn cond_waits(cond: &Cond) -> bool {
    let mut out = Vec::new();
    constants_in_cond(cond, &mut out);
    !out.is_empty()
}

/// Why a definition, a rule's alternatives with its own clauses, is an
/// error of the document (engine §9), or `None`. The checks that
/// simplification decides skip a clause that holds a constant.
pub(crate) fn definition_problem(rule: &RuleDef) -> Option<String> {
    // A definition with no clause has nothing to check about its captures,
    // and its productions, whose number can be exponential, are not listed.
    if rule.tags.is_none()
        && rule.conditions.is_empty()
        && rule.emit.is_none()
        && rule.alternatives.iter().all(|alternative| alternative.tags.is_none())
    {
        return None;
    }
    // Each production of each alternative, as the alternative and the
    // captures it reads in order (engine §3.5, §9); productions that read
    // the same captures in the same order are one.
    let productions: Vec<(usize, Vec<&str>)> = rule
        .alternatives
        .iter()
        .enumerate()
        .flat_map(|(index, alternative)| {
            CaptureSequences::of(&alternative.expr).named().into_iter().map(move |names| (index, names))
        })
        .collect();
    // Where each production reads each capture, first, and every capture
    // any production reads, so that a question about one is not a scan.
    let positions: Vec<FxMap<&str, usize>> = productions
        .iter()
        .map(|(_, captures)| {
            let mut at = FxMap::default();
            for (position, &name) in captures.iter().enumerate() {
                work::count(Work::Checked, 1);
                if work::mutated(Mutant::FirstByScan) {
                    // The first position of the name, by a scan from the
                    // start, each capture counted as it is compared.
                    let first = captures.iter().position(|&other| {
                        work::count(Work::Checked, 1);
                        other == name
                    });
                    at.insert(name, first.unwrap_or(position));
                    continue;
                }
                at.entry(name).or_insert(position);
            }
            at
        })
        .collect();
    let everywhere: FxSet<&str> = productions.iter().flat_map(|(_, captures)| captures.iter().copied()).collect();
    let captures_of = |index: usize| {
        let at = &positions[index];
        // Each question is one lookup, where a scan of the captures was
        // one step for each.
        move |name: &str| {
            work::count(Work::Checked, 1);
            name.is_empty() || at.contains_key(name)
        }
    };
    let any_has = |name: &str| {
        work::count(Work::Checked, 1);
        name.is_empty() || everywhere.contains(name)
    };
    let items: &[EmitItem] = rule.emit.as_deref().unwrap_or(&[]);
    // A constituent that does not count is never an opaque part (§9).
    if rule.opaque && rule.emit.is_some() && items.is_empty() {
        return Some(format!("{} is opaque and emits ε", rule.name));
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
            EmitItem::Capture(name, tags, attachments) => {
                // An item mentions its own capture and its attachments.
                mentioned.push(name);
                mentioned.extend(attachments.names());
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

    // A condition that applies to no production.
    let each_part = work::mutated(Mutant::CheckEachPart);
    let by_scan = each_part || work::mutated(Mutant::AppliesByScan);
    // The productions that have each capture. A condition that needs one
    // asks only those, and an inserted tag's anchor counts them.
    let mut holders: FxMap<&str, Vec<usize>> = FxMap::default();
    if !rule.conditions.is_empty() || items.iter().any(|item| matches!(item, EmitItem::Insert(_))) {
        for (index, at) in positions.iter().enumerate() {
            for &name in at.keys() {
                work::count(Work::Checked, 1);
                holders.entry(name).or_default().push(index);
            }
        }
    }
    for cond in rule.conditions.iter().filter(|cond| !cond_waits(cond)) {
        let check = CondCheck::new(cond);
        let applies_to = |index: usize| {
            let has = captures_of(index);
            let outcome = if each_part {
                // A mutation of the tests simplifies every part of the
                // condition for each production.
                simplified_outcome(Part::Cond(cond), &has)
            } else {
                check.outcome(positions[index].keys().copied(), &has)
            };
            match outcome {
                Outcome::True => false,
                Outcome::False => true,
                Outcome::Uses(missing) => missing.is_none(),
                Outcome::Empty => unreachable!("a condition is not empty"),
            }
        };
        let applies = match check.reach() {
            // A mutation of the tests asks every production.
            _ if by_scan => (0..productions.len()).any(applies_to),
            Reach::Nothing => false,
            Reach::Every => (0..productions.len()).any(applies_to),
            Reach::Named(name) => holders.get(name).into_iter().flatten().any(|&index| applies_to(index)),
        };
        if !applies {
            return Some(format!("a condition of {} applies to no production", rule.name));
        }
    }

    let unguarded = |name: &str| {
        format!("a tag term of {} uses ${name}, which a production lacks; guard it with ${name} ⟹", rule.name)
    };
    // Whether each clause waits for the loader, found once for the rule,
    // not again for each production.
    let rule_tags = rule.tags.as_ref().filter(|term| !term_waits(term));
    let alternative_tags: Vec<Option<&Term>> = rule
        .alternatives
        .iter()
        .map(|alternative| alternative.tags.as_ref().filter(|term| !term_waits(term)))
        .collect();
    let item_waits: Vec<bool> =
        items.iter().map(|item| matches!(item, EmitItem::Capture(_, Some(term), ..) if term_waits(term))).collect();
    // The items of the emission, indexed once by their carriers and their
    // attachments.
    let emit_index = EmitIndex::new(items);
    let items_by_scan = work::mutated(Mutant::CheckItemsByScan);
    // Each tag term split once, for the rule and for each alternative.
    let rule_check = rule_tags.map(TermCheck::new);
    let alternative_checks: Vec<Option<TermCheck>> =
        alternative_tags.iter().map(|term| term.map(TermCheck::new)).collect();
    for (index, (alternative, _)) in productions.iter().enumerate() {
        let has = captures_of(index);
        if each_part {
            // A mutation of the tests simplifies every part of each tag
            // term for each production.
            for term in [rule_tags, alternative_tags[*alternative]].into_iter().flatten() {
                if let Outcome::Uses(Some(missing)) = simplified_outcome(Part::Term(term), &has) {
                    return Some(unguarded(missing));
                }
            }
        }
        for check in [&rule_check, &alternative_checks[*alternative]].into_iter().flatten() {
            if let Some(missing) = check.missing(positions[index].keys().copied(), &has) {
                return Some(unguarded(missing));
            }
        }
        if rule.emit.is_none() {
            continue;
        }
        let present: Vec<(&EmitItem, bool)> = if items_by_scan {
            // A mutation of the tests scans every item for each production.
            items
                .iter()
                .zip(item_waits.iter().copied())
                .filter(|(item, _)| match item {
                    EmitItem::Capture(name, ..) => has(name),
                    EmitItem::Insert(_) => true,
                })
                .collect()
        } else {
            emit_index
                .kept(positions[index].keys().copied())
                .into_iter()
                .map(|at| (&items[at], item_waits[at]))
                .collect()
        };
        // Nothing left to emit is an error only where the rule lists items:
        // `%emits ε` lists none (§9).
        if present.is_empty() && !items.is_empty() {
            return Some(format!("%emits of {} leaves a production nothing to emit", rule.name));
        }
        // A production without an item's carrier lacks its attachments too
        // (§9).
        let attaching: Vec<&EmitItem> = if items_by_scan {
            items.iter().collect()
        } else {
            emit_index.attaching(positions[index].keys().copied()).into_iter().map(|at| &items[at]).collect()
        };
        for item in attaching {
            if let EmitItem::Capture(carrier, _, attachments) = item {
                if has(carrier) {
                    continue;
                }
                if let Some(stray) = attachments.names().find(|name| has(name)) {
                    return Some(format!(
                        "%emits of {} attaches ${stray} in a production without its carrier ${carrier}",
                        rule.name
                    ));
                }
            }
        }
        // The written order of the captures, attachments included, is the
        // order they stand in (§9).
        let order: Vec<usize> = present
            .iter()
            .flat_map(|(item, _)| match item {
                EmitItem::Capture(name, _, attachments) if !name.is_empty() => attachments
                    .before
                    .iter()
                    .chain(std::iter::once(name))
                    .chain(&attachments.after)
                    .map(String::as_str)
                    .collect(),
                _ => Vec::new(),
            })
            .filter_map(|name| {
                work::count(Work::Checked, 1);
                positions[index].get(name).copied()
            })
            .collect();
        if order.windows(2).any(|pair| pair[1] < pair[0]) {
            return Some(format!("%emits of {} lists captures out of the order they stand in", rule.name));
        }
        for &(item, waits) in &present {
            if let EmitItem::Capture(_, Some(term), ..) = item {
                if waits {
                    continue;
                }
                if let Outcome::Uses(Some(missing)) = simplified_outcome(Part::Term(term), &has) {
                    return Some(unguarded(missing));
                }
            }
        }
    }

    // An inserted tag whose anchor, the capture listed next after it, some
    // production lacks. One backward pass finds every anchor.
    let mut anchors: Vec<Option<&str>> = vec![None; items.len()];
    let mut next = None;
    for (index, item) in items.iter().enumerate().rev() {
        work::count(Work::Checked, 1);
        anchors[index] = next;
        if let EmitItem::Capture(name, ..) = item {
            next = Some(name.as_str());
        }
    }
    for (item, anchor) in items.iter().zip(anchors) {
        if !matches!(item, EmitItem::Insert(_)) {
            continue;
        }
        if let Some(anchor) = anchor {
            // Each production has a name once, so the anchor is in every
            // production when as many hold it.
            let everywhere = if work::mutated(Mutant::CheckItemsByScan) {
                (0..productions.len()).all(|production| captures_of(production)(anchor))
            } else {
                work::count(Work::Checked, 1);
                anchor.is_empty() || holders.get(anchor).map_or(0, Vec::len) == productions.len()
            };
            if !everywhere {
                return Some(format!(
                    "%emits of {} inserts a tag before ${anchor}, which a production lacks",
                    rule.name
                ));
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{definition_problem, duplicate_captures, CaptureSequences};
    use crate::dom::{Alternative, Arg, Attachments, EmitItem, Expr, Op, RuleDef, Term};
    use crate::work::{assert_linear, assert_mutant_stops, Mutant, Work};

    /// A rule of n captures whose tag term reads each and whose emission
    /// lists n inserted tags and then each capture: its checks and the
    /// walks of its clauses cost about n, not n².
    #[test]
    fn a_definition_of_many_captures_checks_in_linear_work() {
        let rules = [many_captures(8000), many_captures(32000)];
        let mut run = |n: usize| {
            let rule = &rules[usize::from(n != 8000)];
            assert_eq!(definition_problem(rule), None);
        };
        assert_linear(Work::Checked, 8000, &mut run);
        assert_linear(Work::Walked, 8000, &mut run);
    }

    /// A copy of each sequence with its suffix, and a scan for the first
    /// position of each capture, stop at the first count past the budget
    /// of `a_definition_of_many_captures_checks_in_linear_work`.
    #[test]
    fn quadratic_checks_of_a_definition_stop_at_the_budget() {
        let rules = [many_captures(8000), many_captures(32000)];
        for mutant in [Mutant::CopySequences, Mutant::FirstByScan] {
            assert_mutant_stops(Work::Checked, mutant, 8000, &mut |n| {
                definition_problem(&rules[usize::from(n != 8000)]);
            });
        }
    }

    /// A choice of n captures, each its own production, whose distinct
    /// sequences are found by one key each. A comparison of each sequence
    /// with every one kept before it stops at the first count past the
    /// budget.
    #[test]
    fn a_choice_of_many_captures_finds_distinct_sequences_in_linear_work() {
        let choice = |n: usize| {
            Expr::Choice(
                (0..n).map(|index| Expr::Capture(format!("c{index}"), Box::new(Expr::Terminal("A".into())))).collect(),
            )
        };
        let exprs = [choice(2000), choice(8000)];
        let mut run = |n: usize| {
            assert_eq!(CaptureSequences::of(&exprs[usize::from(n != 2000)]).sequences.len(), n);
        };
        assert_linear(Work::Checked, 2000, &mut run);
        assert_mutant_stops(Work::Checked, Mutant::ScanDistinct, 2000, &mut run);
    }

    /// A sequence of n captures nested to the right, each level a capture
    /// and the rest, in which every name is distinct.
    fn nested_captures(n: usize) -> Expr {
        (0..n).rev().fold(Expr::Empty, |rest, index| {
            Expr::Seq(vec![Expr::Capture(format!("c{index}"), Box::new(Expr::Terminal("A".into()))), rest])
        })
    }

    /// The search for duplicate captures in a deep sequence looks up and
    /// moves the part with fewer captures at each level, so its work grows
    /// about linearly. Looking up and moving the newer part, which here
    /// holds every capture below, stops at the first count past the budget.
    #[test]
    fn duplicate_captures_join_the_smaller_part() {
        let exprs = [nested_captures(2000), nested_captures(8000)];
        let mut run = |n: usize| assert!(duplicate_captures(&exprs[usize::from(n != 2000)]).is_empty());
        assert_linear(Work::Walked, 2000, &mut run);
        assert_mutant_stops(Work::Walked, Mutant::JoinIntoFirst, 2000, &mut run);
    }

    /// Braces around a sequence of n captures, whose captures no
    /// production reads but whose indices count.
    fn captures_in_braces(n: usize) -> Expr {
        let items = (0..n).map(|index| Expr::Capture(format!("c{index}"), Box::new(Expr::Terminal("A".into()))));
        Expr::Repeat(Box::new(Expr::Seq(items.collect())), None, None)
    }

    /// The captures inside braces are counted for their indices in one
    /// walk, by the search for duplicates and by the capture sequences.
    #[test]
    fn captures_in_braces_are_counted_in_linear_work() {
        let exprs = [captures_in_braces(2000), captures_in_braces(8000)];
        assert_linear(Work::Walked, 2000, &mut |n| {
            let expr = &exprs[usize::from(n != 2000)];
            assert!(duplicate_captures(expr).is_empty());
            assert_eq!(CaptureSequences::of(expr).names.len(), n);
        });
    }

    /// A sequence of n captures of one name nested to the right, each level
    /// a capture and the rest, as the notation growth case
    /// "repeated-capture-name" has it.
    fn nested_repeats(n: usize) -> Expr {
        (0..n).fold(Expr::Terminal("A".into()), |rest, _| {
            Expr::Seq(vec![Expr::Capture("x".into(), Box::new(Expr::Terminal("A".into()))), rest])
        })
    }

    /// Each repeated capture of a deep sequence is marked once, so the work
    /// grows about linearly. Marking it again at each level above it stops
    /// at the first count past the budget.
    #[test]
    fn duplicate_captures_mark_each_once() {
        let exprs = [nested_repeats(2000), nested_repeats(8000)];
        let mut run = |n: usize| assert_eq!(duplicate_captures(&exprs[usize::from(n != 2000)]).len(), n - 1);
        assert_linear(Work::Walked, 2000, &mut run);
        assert_mutant_stops(Work::Walked, Mutant::MarkAgain, 2000, &mut run);
    }

    /// A rule of n captures, as `a_definition_of_many_captures_checks_in_linear_work`
    /// describes it.
    fn many_captures(n: usize) -> RuleDef {
        {
            let names: Vec<String> = (0..n).map(|index| format!("c{index}")).collect();
            let expr = Expr::Seq(
                names.iter().map(|name| Expr::Capture(name.clone(), Box::new(Expr::Terminal("A".into())))).collect(),
            );
            let tags = Term::Union(
                names
                    .iter()
                    .map(|name| Term::Call("tags".into(), vec![Arg::Term(Term::Capture(name.clone()))]))
                    .collect(),
            );
            let emit = (0..n)
                .map(|_| EmitItem::Insert("X".into()))
                .chain(names.iter().map(|name| EmitItem::Capture(name.clone(), None, Attachments::default())))
                .collect();
            RuleDef {
                name: "r".into(),
                op: Op::Define,
                flags: Vec::new(),
                tags: Some(tags),
                alternatives: vec![Alternative { guards: Vec::new(), expr, tags: None }],
                emit: Some(emit),
                conditions: Vec::new(),
                opaque: false,
                at: (0, 0),
            }
        }
    }
}
