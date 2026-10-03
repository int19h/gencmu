//! A rule's clauses against the captures of its alternatives (engine §3.6,
//! §9): simplifying a clause for a production, the captures a clause uses,
//! and the checks of a definition as a whole.

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

fn term_captures<'a>(term: &'a Term, out: &mut Vec<&'a str>) {
    match term {
        Term::Capture(name) => out.push(name),
        Term::Union(items) | Term::Intersection(items) => items.iter().for_each(|item| term_captures(item, out)),
        Term::Difference(left, right) => {
            term_captures(left, out);
            term_captures(right, out);
        }
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
        Term::Str(_) | Term::Tag(_) | Term::Range(..) | Term::EmptySet | Term::Const(..) => {}
    }
}

fn cond_captures<'a>(cond: &'a Cond, out: &mut Vec<&'a str>) {
    match cond {
        Cond::Compare(_, left, right) => {
            term_captures(left, out);
            term_captures(right, out);
        }
        Cond::Matches(span, _) | Cond::Begins(span, _) | Cond::Initial(span) => term_captures(span, out),
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
        Term::Difference(left, right) => {
            term_presences(left, out);
            term_presences(right, out);
        }
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
        Cond::Matches(..) | Cond::Begins(..) | Cond::Initial(_) => {}
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
    /// The captures that some production reads after one of the same name,
    /// in increasing order.
    pub duplicates: Vec<usize>,
}

impl<'e> CaptureSequences<'e> {
    pub(crate) fn of(expr: &'e Expr) -> CaptureSequences<'e> {
        let mut found = CaptureSequences { names: Vec::new(), sequences: Vec::new(), duplicates: Vec::new() };
        found.sequences = found.visit(expr);
        found.duplicates.sort_unstable();
        found.duplicates.dedup();
        found
    }

    /// Each production's capture names, in the order it reads them.
    pub(crate) fn named(&self) -> Vec<Vec<&'e str>> {
        self.sequences.iter().map(|sequence| sequence.iter().map(|&index| self.names[index]).collect()).collect()
    }

    fn distinct(&self, lists: Vec<Vec<usize>>) -> Vec<Vec<usize>> {
        let mut seen: Vec<Vec<&str>> = Vec::new();
        let mut out = Vec::new();
        for list in lists {
            let key: Vec<&str> = list.iter().map(|&index| self.names[index]).collect();
            if !seen.contains(&key) {
                seen.push(key);
                out.push(list);
            }
        }
        out
    }

    fn product(&mut self, left: &[Vec<usize>], right: &[Vec<usize>]) -> Vec<Vec<usize>> {
        let mut out = Vec::with_capacity(left.len() * right.len());
        for first in left {
            for second in right {
                for &capture in second {
                    if first.iter().any(|&other| self.names[other] == self.names[capture]) {
                        self.duplicates.push(capture);
                    }
                }
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

    fn visit(&mut self, expr: &'e Expr) -> Vec<Vec<usize>> {
        match expr {
            Expr::Capture(name, _) => {
                self.names.push(name);
                vec![vec![self.names.len() - 1]]
            }
            Expr::Seq(items) => {
                let mut sequences = vec![Vec::new()];
                for item in items {
                    let part = self.visit(item);
                    sequences = self.product(&sequences, &part);
                }
                sequences
            }
            Expr::Choice(items) => {
                let mut all = Vec::new();
                for item in items {
                    all.extend(self.visit(item));
                }
                self.distinct(all)
            }
            Expr::And(items) => {
                let parts: Vec<Vec<Vec<usize>>> = items.iter().map(|item| self.visit(item)).collect();
                let mut all = Vec::new();
                for mask in 1u64..(1u64 << parts.len().min(63)) {
                    let mut sequences = vec![Vec::new()];
                    for (bit, part) in parts.iter().enumerate() {
                        if mask & (1 << bit) != 0 {
                            sequences = self.product(&sequences, part);
                        }
                    }
                    all.extend(sequences);
                }
                self.distinct(all)
            }
            Expr::Optional(inner, Mark::Plain) => {
                let mut all = vec![Vec::new()];
                all.extend(self.visit(inner));
                self.distinct(all)
            }
            Expr::Optional(..) | Expr::Repeat(..) => {
                self.skip(expr);
                vec![Vec::new()]
            }
            Expr::Tested(..) | Expr::Ref(_) | Expr::Terminal(_) | Expr::Range(..) | Expr::Property(_) | Expr::Empty => {
                vec![Vec::new()]
            }
        }
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
    let captures_of = |index: usize| {
        let captures = &productions[index].1;
        move |name: &str| name.is_empty() || captures.contains(&name)
    };
    let any_has = |name: &str| name.is_empty() || productions.iter().any(|(_, captures)| captures.contains(&name));
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
            match simplify_cond(cond, &has) {
                Simple::True => false,
                Simple::False => true,
                Simple::Cond(simple) => cond_uses(&simple).iter().all(|name| has(name)),
            }
        });
        if !applies {
            return Some(format!("a condition of {} applies to no production", rule.name));
        }
    }

    let unguarded = |name: &str| {
        format!("a tag term of {} uses ${name}, which a production lacks; guard it with ${name} ⟹", rule.name)
    };
    for (index, (alternative, captures)) in productions.iter().enumerate() {
        let alternative = &rule.alternatives[*alternative];
        let has = captures_of(index);
        for term in
            [rule.tags.as_ref(), alternative.tags.as_ref()].into_iter().flatten().filter(|term| !term_waits(term))
        {
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
            .filter_map(|name| captures.iter().position(|captured| *captured == name))
            .collect();
        if positions.windows(2).any(|pair| pair[1] < pair[0]) {
            return Some(format!("%emits of {} lists captures out of the order they stand in", rule.name));
        }
        for item in &present {
            if let EmitItem::Capture(_, Some(term), ..) = item {
                if term_waits(term) {
                    continue;
                }
                if let Some(simple) = simplify_term(term, &has) {
                    if let Some(missing) = term_uses(&simple).into_iter().find(|name| !has(name)) {
                        return Some(unguarded(missing));
                    }
                }
            }
        }
    }

    // An inserted tag whose anchor, the capture listed next after it, some
    // production lacks.
    for (index, item) in items.iter().enumerate() {
        if !matches!(item, EmitItem::Insert(_)) {
            continue;
        }
        let anchor = items[index + 1..].iter().find_map(|item| match item {
            EmitItem::Capture(name, ..) => Some(name.as_str()),
            EmitItem::Insert(_) => None,
        });
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
