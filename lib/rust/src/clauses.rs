//! A rule's clauses against the captures of its alternatives (engine §3.6,
//! §9): simplifying a clause for a production, the captures a clause uses,
//! and the checks of a definition as a whole.

use std::collections::{HashMap, HashSet};

use crate::earley::count_steps;
use crate::fxhash::{FxMap, FxSet};

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
        count_steps(1);
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
                Term::Str(_) | Term::Tag(_) | Term::Range(..) | Term::EmptySet | Term::Const(..) => {}
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
#[derive(Clone, Copy)]
enum Outcome<'a> {
    True,
    False,
    Empty,
    Uses(Option<&'a str>),
}

fn simplified_outcome<'a>(start: Part<'a>, has: &dyn Fn(&str) -> bool) -> Outcome<'a> {
    let first = |a: Option<&'a str>, b: Option<&'a str>| a.or(b);
    // Each part is met twice: first to push its parts, then to combine
    // their outcomes, which stand on `done` in the order written.
    let mut stack: Vec<(Part<'a>, bool)> = vec![(start, false)];
    let mut done: Vec<Outcome<'a>> = Vec::new();
    while let Some((part, combine)) = stack.pop() {
        count_steps(1);
        if !combine {
            let children: Vec<Part<'a>> = match part {
                Part::Term(Term::If(cond, then)) => vec![Part::Cond(cond), Part::Term(then)],
                Part::Term(Term::Union(items) | Term::Intersection(items)) => items.iter().map(Part::Term).collect(),
                Part::Term(Term::Difference(left, right)) => vec![Part::Term(left), Part::Term(right)],
                Part::Cond(Cond::Not(inner)) => vec![Part::Cond(inner)],
                Part::Cond(Cond::Any(items) | Cond::All(items)) => items.iter().map(Part::Cond).collect(),
                Part::Cond(Cond::If(antecedent, consequent)) => vec![Part::Cond(antecedent), Part::Cond(consequent)],
                Part::Cond(Cond::Compare(_, left, right)) => vec![Part::Term(left), Part::Term(right)],
                _ => Vec::new(),
            };
            stack.push((part, true));
            stack.extend(children.into_iter().rev().map(|child| (child, false)));
            continue;
        }
        let missing = |part: Part<'a>| {
            let mut out = Vec::new();
            walk_captures(part, true, false, &mut out);
            out.into_iter().find(|name| !has(name))
        };
        let outcome = match part {
            Part::Term(term) => match term {
                Term::EmptySet => Outcome::Empty,
                Term::If(..) => {
                    let then = done.pop().expect("the term");
                    match done.pop().expect("the condition") {
                        Outcome::False => Outcome::Empty,
                        Outcome::True => then,
                        Outcome::Uses(used) => match then {
                            Outcome::Empty => Outcome::Empty,
                            Outcome::Uses(then) => Outcome::Uses(first(used, then)),
                            _ => unreachable!("a term is empty or uses captures"),
                        },
                        Outcome::Empty => unreachable!("a condition is not empty"),
                    }
                }
                Term::Union(items) => {
                    let parts = done.split_off(done.len() - items.len());
                    let left: Vec<Option<&str>> = parts
                        .into_iter()
                        .filter_map(|outcome| match outcome {
                            Outcome::Uses(used) => Some(used),
                            _ => None,
                        })
                        .collect();
                    if left.is_empty() {
                        Outcome::Empty
                    } else {
                        Outcome::Uses(left.into_iter().flatten().next())
                    }
                }
                Term::Intersection(items) => {
                    let parts = done.split_off(done.len() - items.len());
                    let mut used = None;
                    let mut empty = false;
                    for outcome in parts {
                        match outcome {
                            Outcome::Uses(part) => used = first(used, part),
                            _ => empty = true,
                        }
                    }
                    if empty {
                        Outcome::Empty
                    } else {
                        Outcome::Uses(used)
                    }
                }
                Term::Difference(..) => {
                    let right = done.pop().expect("the second part");
                    match (done.pop().expect("the first part"), right) {
                        (Outcome::Uses(left), Outcome::Uses(right)) => Outcome::Uses(first(left, right)),
                        (Outcome::Uses(left), _) => Outcome::Uses(left),
                        _ => Outcome::Empty,
                    }
                }
                // A capture, a literal or a call, as written.
                _ => Outcome::Uses(missing(part)),
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
                    let mut used = None;
                    let mut left = 0;
                    let mut stopped = false;
                    for outcome in parts {
                        match outcome {
                            Outcome::True if !all => stopped = true,
                            Outcome::False if all => stopped = true,
                            Outcome::True | Outcome::False => {}
                            Outcome::Uses(part) => {
                                used = first(used, part);
                                left += 1;
                            }
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
                        Outcome::Uses(used)
                    }
                }
                Cond::If(..) => {
                    let consequent = done.pop().expect("the consequent");
                    match done.pop().expect("the antecedent") {
                        Outcome::False => Outcome::True,
                        Outcome::True => consequent,
                        Outcome::Uses(antecedent) => match consequent {
                            Outcome::True => Outcome::True,
                            Outcome::False => Outcome::Uses(antecedent),
                            Outcome::Uses(consequent) => Outcome::Uses(first(antecedent, consequent)),
                            Outcome::Empty => unreachable!("a condition is not empty"),
                        },
                        Outcome::Empty => unreachable!("a condition is not empty"),
                    }
                }
                Cond::Compare(..) => {
                    // An empty side is written out as ∅, which uses nothing.
                    let right = done.pop().expect("the right side");
                    let left = done.pop().expect("the left side");
                    let used = |outcome: Outcome<'a>| match outcome {
                        Outcome::Uses(used) => used,
                        _ => None,
                    };
                    Outcome::Uses(first(used(left), used(right)))
                }
                Cond::Matches(..) | Cond::Begins(..) | Cond::Initial(_) => Outcome::Uses(missing(part)),
            },
        };
        done.push(outcome);
    }
    done.pop().expect("the outcome")
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
        count_steps(1);
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
                        count_steps(1);
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
        for mut part in parts {
            if meets {
                if joined.1 <= part.1 {
                    for name in joined.0.keys() {
                        for &index in part.0.get(name).into_iter().flatten() {
                            duplicate[index] = true;
                        }
                    }
                } else {
                    for (name, indices) in &part.0 {
                        if joined.0.contains_key(name) {
                            for &index in indices {
                                duplicate[index] = true;
                            }
                        }
                    }
                }
            }
            if joined.1 < part.1 {
                std::mem::swap(&mut joined, &mut part);
            }
            joined.1 += part.1;
            for (name, mut indices) in part.0 {
                count_steps(indices.len() as u64);
                joined.0.entry(name).or_default().append(&mut indices);
            }
        }
        done.push(joined);
    }
    (0..duplicate.len()).filter(|&index| duplicate[index]).collect()
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
        let mut seen: HashSet<Vec<&str>> = HashSet::new();
        let mut out = Vec::new();
        for list in lists {
            let key: Vec<&str> = list.iter().map(|&index| self.names[index]).collect();
            if seen.insert(key) {
                out.push(list);
            }
        }
        out
    }

    fn product(&mut self, mut left: Vec<Vec<usize>>, right: &[Vec<usize>]) -> Vec<Vec<usize>> {
        // With one right sequence, the usual case, each left sequence grows
        // in place, so that a long sequence costs its length. Distinct
        // sequences with one suffix added stay distinct.
        if let [only] = right {
            for sequence in &mut left {
                sequence.extend_from_slice(only);
            }
            return left;
        }
        let mut out = Vec::with_capacity(left.len() * right.len());
        for first in left {
            for second in right {
                out.push(first.iter().chain(second).copied().collect());
            }
        }
        self.distinct(out)
    }

    /// Counts the captures of a part no production reads, so that the
    /// indices stay those of the order written.
    fn skip(&mut self, expr: &'e Expr) {
        let mut stack = vec![expr];
        while let Some(current) = stack.pop() {
            count_steps(1);
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
            count_steps(1);
            count_steps(1);
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
                at.entry(name).or_insert(position);
            }
            at
        })
        .collect();
    let everywhere: FxSet<&str> = productions.iter().flat_map(|(_, captures)| captures.iter().copied()).collect();
    let captures_of = |index: usize| {
        let at = &positions[index];
        move |name: &str| name.is_empty() || at.contains_key(name)
    };
    let any_has = |name: &str| name.is_empty() || everywhere.contains(name);
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
    for cond in rule.conditions.iter().filter(|cond| !cond_waits(cond)) {
        let applies = (0..productions.len()).any(|index| {
            let has = captures_of(index);
            match simplified_outcome(Part::Cond(cond), &has) {
                Outcome::True => false,
                Outcome::False => true,
                Outcome::Uses(missing) => missing.is_none(),
                Outcome::Empty => unreachable!("a condition is not empty"),
            }
        });
        if !applies {
            return Some(format!("a condition of {} applies to no production", rule.name));
        }
    }

    let unguarded = |name: &str| {
        format!("a tag term of {} uses ${name}, which a production lacks; guard it with ${name} ⟹", rule.name)
    };
    for (index, (alternative, _)) in productions.iter().enumerate() {
        let alternative = &rule.alternatives[*alternative];
        let has = captures_of(index);
        for term in
            [rule.tags.as_ref(), alternative.tags.as_ref()].into_iter().flatten().filter(|term| !term_waits(term))
        {
            if let Outcome::Uses(Some(missing)) = simplified_outcome(Part::Term(term), &has) {
                return Some(unguarded(missing));
            }
        }
        if rule.emit.is_none() {
            continue;
        }
        let present: Vec<&EmitItem> = items
            .iter()
            .filter(|item| match item {
                EmitItem::Capture(name, ..) => has(name),
                EmitItem::Insert(_) => true,
            })
            .collect();
        // Nothing left to emit is an error only where the rule lists items:
        // `%emits ε` lists none (§9).
        if present.is_empty() && !items.is_empty() {
            return Some(format!("%emits of {} leaves a production nothing to emit", rule.name));
        }
        // A production without an item's carrier lacks its attachments too
        // (§9).
        for item in items {
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
        let positions: Vec<usize> = present
            .iter()
            .flat_map(|item| match item {
                EmitItem::Capture(name, _, attachments) if !name.is_empty() => attachments
                    .before
                    .iter()
                    .chain(std::iter::once(name))
                    .chain(&attachments.after)
                    .map(String::as_str)
                    .collect(),
                _ => Vec::new(),
            })
            .filter_map(|name| positions[index].get(name).copied())
            .collect();
        if positions.windows(2).any(|pair| pair[1] < pair[0]) {
            return Some(format!("%emits of {} lists captures out of the order they stand in", rule.name));
        }
        for item in &present {
            if let EmitItem::Capture(_, Some(term), ..) = item {
                if term_waits(term) {
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
            if !(0..productions.len()).all(|production| captures_of(production)(anchor)) {
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
    use super::definition_problem;
    use crate::dom::{Alternative, Arg, Attachments, EmitItem, Expr, Op, RuleDef, Term};
    use crate::growth::assert_linear;

    /// A rule of n captures whose tag term reads each and whose emission
    /// lists n inserted tags and then each capture: its checks cost about
    /// n, not n².
    #[test]
    fn a_definition_of_many_captures_checks_in_linear_time() {
        let rule = |n: usize| {
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
                tags: Some(tags),
                alternatives: vec![Alternative { guards: Vec::new(), expr, tags: None }],
                emit: Some(emit),
                conditions: Vec::new(),
                opaque: false,
                at: (0, 0),
            }
        };
        let rules = [rule(8000), rule(32000)];
        assert_linear("definition checks", 8000, &mut |n| {
            let rule = &rules[usize::from(n != 8000)];
            assert_eq!(definition_problem(rule), None);
        });
    }
}
