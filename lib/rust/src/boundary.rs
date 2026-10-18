//! Finite complete-tree boundary records (engine §4.2).
use crate::fxhash::{FxMap, FxSet};
use crate::lower::{LCond, Lowered};
use std::collections::BTreeSet;

pub(crate) type Bits = BTreeSet<u32>;
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct Literal {
    pub forward: bool,
    pub targets: Vec<String>,
    pub positive: bool,
}
#[derive(Debug, Clone, PartialEq, Eq, Hash, Default)]
pub(crate) struct Record {
    pub nonempty: bool,
    pub start: Bits,
    pub first: BTreeSet<String>,
    pub end: Bits,
    pub last: BTreeSet<String>,
}
impl Record {
    pub fn dominates(&self, lower: &Self) -> bool {
        self.nonempty == lower.nonempty
            && self.first == lower.first
            && self.last == lower.last
            && self.start.is_subset(&lower.start)
            && self.end.is_subset(&lower.end)
    }
}
#[derive(Debug)]
pub(crate) struct Records {
    pub records: Vec<Record>,
    index: FxMap<Record, u32>,
    pub literals: Vec<Literal>,
    literal_index: FxMap<Literal, u32>,
    forward: FxSet<String>,
    backward: FxSet<String>,
}
pub(crate) fn atom(condition: &LCond) -> Option<&LCond> {
    let mut stack = vec![condition];
    while let Some(c) = stack.pop() {
        match c {
            LCond::Boundary(..) => return Some(c),
            LCond::Not(c) => stack.push(c),
            LCond::All(cs) | LCond::Any(cs) => stack.extend(cs.iter().rev()),
            LCond::If(a, b) => stack.extend([&**b, &**a]),
            LCond::Cmp(_, a, b) => {
                if let Some(atom) = lowered_term_atom(a).or_else(|| lowered_term_atom(b)) {
                    return Some(atom);
                }
            }
            _ => {}
        }
    }
    None
}
impl Records {
    pub fn new(g: &Lowered) -> Option<Self> {
        let mut out = Self {
            records: vec![],
            index: FxMap::default(),
            literals: vec![],
            literal_index: FxMap::default(),
            forward: FxSet::default(),
            backward: FxSet::default(),
        };
        for (c, _) in g
            .prods
            .iter()
            .flat_map(|p| &p.conds)
            .chain(g.ranked.plans.values().flat_map(|p| p.conditions.iter().flatten()))
        {
            if let Some(LCond::Boundary(forward, _, targets, _, _)) = atom(c) {
                let names = if *forward { &mut out.forward } else { &mut out.backward };
                names.extend(targets.iter().cloned());
            }
        }
        out.intern(Record::default());
        (!out.forward.is_empty() || !out.backward.is_empty()).then_some(out)
    }
    pub fn intern(&mut self, record: Record) -> u32 {
        if let Some(&id) = self.index.get(&record) {
            return id;
        }
        let id = self.records.len() as u32;
        self.records.push(record.clone());
        self.index.insert(record, id);
        id
    }
    pub fn literal(&mut self, forward: bool, targets: &[String], positive: bool) -> u32 {
        let mut targets = targets.to_vec();
        targets.sort();
        targets.dedup();
        let literal = Literal { forward, targets, positive };
        if let Some(&id) = self.literal_index.get(&literal) {
            return id;
        }
        let id = self.literals.len() as u32;
        self.literals.push(literal.clone());
        self.literal_index.insert(literal, id);
        id
    }
    pub fn leaf(&mut self, name: &str, empty: bool) -> u32 {
        if empty {
            return 0;
        }
        let mut r = Record { nonempty: true, ..Record::default() };
        if self.forward.contains(name) {
            r.first.insert(name.to_string());
        }
        if self.backward.contains(name) {
            r.last.insert(name.to_string());
        }
        self.intern(r)
    }
    fn meet(
        &self,
        literals: &Bits,
        offers: &BTreeSet<String>,
        forward: bool,
        final_: bool,
        failed: &mut Vec<u32>,
    ) -> Bits {
        literals
            .iter()
            .copied()
            .filter(|&id| {
                let l = &self.literals[id as usize];
                if l.forward != forward {
                    return true;
                }
                let hit = l.targets.iter().any(|n| offers.contains(n));
                if !hit && !final_ {
                    return true;
                }
                if hit != l.positive {
                    failed.push(id);
                }
                false
            })
            .collect()
    }
    pub fn advance(&mut self, prefix: u32, child: u32, failed: &mut Vec<u32>) -> u32 {
        let mut p = self.records[prefix as usize].clone();
        let c = self.records[child as usize].clone();
        if !c.nonempty {
            let end = if p.nonempty { self.meet(&c.end, &p.last, false, false, failed) } else { c.end };
            p.end.extend(end);
        } else if !p.nonempty {
            let mut pending = p.end;
            pending.extend(&c.start);
            p = Record {
                nonempty: true,
                start: self.meet(&pending, &c.first, true, false, failed),
                first: c.first,
                end: c.end,
                last: c.last,
            };
        } else {
            let mut middle = p.end;
            middle.extend(&c.start);
            self.meet(&middle, &c.first, true, true, failed);
            self.meet(&middle, &p.last, false, true, failed);
            p.end = c.end;
            p.last = c.last;
        }
        self.intern(p)
    }
    pub fn complete(
        &mut self,
        record: u32,
        name: Option<&str>,
        backward: &Bits,
        forward: &Bits,
        failed: &mut Vec<u32>,
    ) -> u32 {
        let mut r = self.records[record as usize].clone();
        if !r.nonempty {
            r.end.extend(backward);
            r.end.extend(forward);
            return self.intern(r);
        }
        if let Some(name) = name {
            if self.forward.contains(name) {
                r.first.insert(name.to_string());
            }
            if self.backward.contains(name) {
                r.last.insert(name.to_string());
            }
        }
        r.start = self.meet(&r.start, &r.first, true, false, failed);
        r.end = self.meet(&r.end, &r.last, false, false, failed);
        r.start.extend(backward);
        r.end.extend(forward);
        self.intern(r)
    }
    pub fn append(&mut self, record: u32, bits: &Bits) -> u32 {
        if bits.is_empty() {
            return record;
        }
        let mut r = self.records[record as usize].clone();
        r.end.extend(bits);
        self.intern(r)
    }
    pub fn accepts(&self, record: u32) -> bool {
        let r = &self.records[record as usize];
        r.start.iter().chain(&r.end).all(|&id| !self.literals[id as usize].positive)
    }
    pub fn open(&self, prefix: u32, child: u32) -> Record {
        let p = &self.records[prefix as usize];
        let c = &self.records[child as usize];
        if !c.nonempty {
            let end = if p.nonempty { self.meet(&c.end, &p.last, false, false, &mut vec![]) } else { c.end.clone() };
            Record { end, ..Record::default() }
        } else if !p.nonempty {
            c.clone()
        } else {
            Record { nonempty: true, end: c.end.clone(), last: c.last.clone(), ..Record::default() }
        }
    }
}

enum DomPart<'a> {
    Condition(&'a crate::dom::Cond),
    Term(&'a crate::dom::Term),
}

/// One worklist crosses guarded terms and comparisons without recursion.
fn atoms_in(start: DomPart<'_>) -> Vec<&crate::dom::Cond> {
    use crate::dom::{Arg, Cond, Term};
    let mut found = vec![];
    let mut stack = vec![start];
    while let Some(part) = stack.pop() {
        match part {
            DomPart::Condition(c) => match c {
                Cond::Boundary(..) => found.push(c),
                Cond::Not(c) => stack.push(DomPart::Condition(c)),
                Cond::All(cs) | Cond::Any(cs) => stack.extend(cs.iter().rev().map(DomPart::Condition)),
                Cond::If(a, b) => stack.extend([DomPart::Condition(b), DomPart::Condition(a)]),
                Cond::Compare(_, a, b) => stack.extend([DomPart::Term(b), DomPart::Term(a)]),
                _ => {}
            },
            DomPart::Term(t) => match t {
                Term::If(c, t) => stack.extend([DomPart::Term(t), DomPart::Condition(c)]),
                Term::Union(ts) | Term::Intersection(ts) => stack.extend(ts.iter().rev().map(DomPart::Term)),
                Term::Difference(a, b) => stack.extend([DomPart::Term(b), DomPart::Term(a)]),
                Term::Call(_, args) => stack.extend(args.iter().rev().filter_map(|a| match a {
                    Arg::Term(t) => Some(DomPart::Term(t)),
                    _ => None,
                })),
                _ => {}
            },
        }
    }
    found
}

/// Boundary atoms in written order, before presence simplification.
pub(crate) fn dom_atoms(condition: &crate::dom::Cond) -> Vec<&crate::dom::Cond> {
    atoms_in(DomPart::Condition(condition))
}

pub(crate) fn ownership(condition: &mut LCond, own: bool) {
    match condition {
        LCond::Boundary(_, crate::lower::Span::Whole, _, active, _) => *active = own,
        LCond::Not(c) => ownership(c, own),
        LCond::All(cs) | LCond::Any(cs) => {
            for c in cs {
                ownership(c, own)
            }
        }
        LCond::If(a, b) => {
            ownership(a, own);
            ownership(b, own);
        }
        LCond::Cmp(_, a, b) => {
            term_ownership(a, own);
            term_ownership(b, own);
        }
        _ => {}
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct Site {
    pub rule: u32,
    pub condition: usize,
}
pub(crate) fn condition_offsets(g: &crate::grammar::StageGrammar) -> FxMap<usize, usize> {
    let mut offsets = FxMap::default();
    for rule in &g.rules {
        let mut count = 0;
        for alt in &rule.alternatives {
            let key = std::sync::Arc::as_ptr(&alt.clauses) as usize;
            if let std::collections::hash_map::Entry::Vacant(e) = offsets.entry(key) {
                e.insert(count);
                count += alt.clauses.conditions.len();
            }
        }
    }
    offsets
}
/// Source graphs carry late annotation joins without splitting chart facts.
#[derive(Debug, Default)]
pub(crate) struct Sources {
    nodes: Vec<Source>,
}
#[derive(Debug, Default)]
struct Source {
    sites: BTreeSet<Site>,
    parents: BTreeSet<u32>,
}
#[derive(Debug, Clone, Default)]
pub(crate) struct Annotations {
    pub start: FxMap<u32, u32>,
    pub end: FxMap<u32, u32>,
}
#[derive(Debug)]
pub(crate) struct Failure {
    pub at: u32,
    pub end: u32,
    pub source: u32,
}
impl Sources {
    fn node(&mut self) -> u32 {
        let id = self.nodes.len() as u32;
        self.nodes.push(Source::default());
        id
    }
    pub fn join(&mut self, inputs: impl IntoIterator<Item = u32>) -> u32 {
        let id = self.node();
        self.nodes[id as usize].parents.extend(inputs);
        id
    }
    pub fn add(&mut self, map: &mut FxMap<u32, u32>, literal: u32, site: Option<Site>) {
        let id = *map.entry(literal).or_insert_with(|| self.node());
        if let Some(site) = site {
            self.nodes[id as usize].sites.insert(site);
        }
    }
    fn select(&mut self, bits: &Bits, inputs: &[&FxMap<u32, u32>]) -> FxMap<u32, u32> {
        bits.iter()
            .map(|&literal| {
                let id = self.join(inputs.iter().filter_map(|m| m.get(&literal).copied()));
                (literal, id)
            })
            .collect()
    }
    pub fn merge(&mut self, target: &mut Annotations, other: &Annotations) {
        for (a, b) in [(&mut target.start, &other.start), (&mut target.end, &other.end)] {
            for (&literal, &source) in b {
                let id = *a.entry(literal).or_insert_with(|| self.node());
                if id != source {
                    self.nodes[id as usize].parents.insert(source);
                }
            }
        }
    }
    pub fn retain(&mut self, a: &Annotations, r: &Record) -> Annotations {
        Annotations { start: self.select(&r.start, &[&a.start]), end: self.select(&r.end, &[&a.end]) }
    }
    pub fn meeting(&mut self, a: &Annotations, b: &Annotations, empty: bool, literal: u32) -> u32 {
        if empty {
            self.join(b.end.get(&literal).copied())
        } else {
            self.join(a.end.get(&literal).into_iter().chain(b.start.get(&literal)).copied())
        }
    }
    pub fn advance(&mut self, a: &Annotations, p: &Record, b: &Annotations, c: &Record, r: &Record) -> Annotations {
        if !c.nonempty {
            Annotations { start: self.select(&r.start, &[&a.start]), end: self.select(&r.end, &[&a.end, &b.end]) }
        } else if !p.nonempty {
            Annotations { start: self.select(&r.start, &[&a.end, &b.start]), end: self.select(&r.end, &[&b.end]) }
        } else {
            Annotations { start: self.select(&r.start, &[&a.start]), end: self.select(&r.end, &[&b.end]) }
        }
    }
    pub fn sites(&self, id: u32) -> BTreeSet<Site> {
        let mut sites = BTreeSet::new();
        let mut seen = FxSet::default();
        let mut stack = vec![id];
        while let Some(id) = stack.pop() {
            if !seen.insert(id) {
                continue;
            }
            let n = &self.nodes[id as usize];
            sites.extend(&n.sites);
            stack.extend(&n.parents);
        }
        sites
    }
}

fn term_atoms(term: &crate::dom::Term) -> Vec<&crate::dom::Cond> {
    atoms_in(DomPart::Term(term))
}
pub(crate) fn definition_problem(rule: &crate::dom::RuleDef) -> Option<(String, Option<(usize, usize)>)> {
    use crate::dom::{Cond, EmitItem, Term};
    let problem = |text: &str, atom: &Cond| {
        let at = if let Cond::Boundary(_, _, _, location) = atom { location.at } else { None };
        Some((text.to_string(), at))
    };
    for c in &rule.conditions {
        let atoms = dom_atoms(c);
        if atoms.len() > 1 {
            return problem("a condition item accepts only one boundary atom", atoms[1]);
        }
        if let Some(atom) = atoms.first() {
            let Cond::Boundary(_, Term::Capture(receiver), _, _) = atom else {
                return problem("a boundary method requires a bare capture", atom);
            };
            if !receiver.is_empty() {
                let mut reads = BTreeSet::new();
                crate::ranked::cond_reads(c, &mut reads);
                if reads.iter().any(|name| name != receiver) {
                    return problem("a boundary condition with a captured receiver reads only that capture", atom);
                }
            }
        }
    }
    let mut terms: Vec<_> =
        rule.tags.iter().chain(rule.strings.value.iter()).chain(rule.strings.image.iter()).collect();
    for alt in &rule.alternatives {
        terms.extend(alt.tags.iter().chain(alt.strings.value.iter()).chain(alt.strings.image.iter()));
        terms.extend(crate::dom::tests_in(&alt.expr).into_iter().map(|(_, t, _)| t));
    }
    for item in rule.emit.iter().flatten() {
        let strings = match item {
            EmitItem::Capture(_, _, a) => &a.strings,
            EmitItem::Insert(_, s) => s,
        };
        terms.extend(strings.value.iter().chain(strings.image.iter()));
    }
    for t in terms {
        if let Some(atom) = term_atoms(t).first() {
            return problem("a boundary atom stands only in conditions or emission tags", atom);
        }
    }
    None
}

/// Reach through body references, regardless of gates and conditions.
fn reach(g: &crate::grammar::StageGrammar, roots: Vec<String>) -> (FxSet<String>, FxSet<String>) {
    use crate::dom::Expr;
    let mut rules = FxSet::default();
    let mut terminals = FxSet::default();
    let mut pending = roots;
    while let Some(name) = pending.pop() {
        if crate::grammar::is_terminal_name(&name) {
            terminals.insert(name);
            continue;
        }
        if !rules.insert(name.clone()) {
            continue;
        }
        let Some(&index) = g.index.get(&name) else { continue };
        let mut stack: Vec<_> = g.rules[index].alternatives.iter().map(|a| &a.alternative.expr).collect();
        while let Some(e) = stack.pop() {
            match e {
                Expr::Ref(n) if g.index.contains_key(n) => pending.push(n.clone()),
                Expr::Ref(n) | Expr::Terminal(n) => {
                    terminals.insert(n.clone());
                }
                Expr::Seq(es) | Expr::Choice(es) | Expr::Ranked(es) | Expr::And(es) => stack.extend(es),
                Expr::Capture(_, e) | Expr::Optional(e, _) | Expr::Tested(_, _, e) => stack.push(e),
                Expr::Repeat(e, s, _) => {
                    stack.push(e);
                    stack.extend(s.as_deref());
                }
                _ => {}
            }
        }
    }
    (rules, terminals)
}
pub(crate) fn reachable(g: &crate::grammar::StageGrammar) -> Result<(), crate::error::Error> {
    use crate::dom::{Arg, Cond, EmitItem, Term};
    // Collect every nested-query root and atom from the stitched clauses.
    enum Part<'a> {
        C(&'a Cond),
        T(&'a Term),
    }
    let mut atoms = vec![];
    let mut roots = vec!["text".to_string()];
    let mut seen = FxSet::default();
    for rule in &g.rules {
        for alt in &rule.alternatives {
            let mut stack = vec![];
            stack.extend(alt.alternative.tags.iter().map(Part::T));
            if seen.insert(std::sync::Arc::as_ptr(&alt.clauses)) {
                stack.extend(alt.clauses.tags.iter().map(Part::T));
                stack.extend(alt.clauses.conditions.iter().map(Part::C));
                for item in alt.clauses.emit.iter().flatten() {
                    let (EmitItem::Capture(_, t, _) | EmitItem::Insert(t, _)) = item;
                    stack.extend(t.iter().map(Part::T));
                }
            }
            while let Some(part) = stack.pop() {
                match part {
                    Part::C(c) => match c {
                        Cond::Boundary(_, _, targets, location) => {
                            roots.extend(targets.iter().filter(|target| target.starts_with(|c: char| c.is_ascii_uppercase())).cloned());
                            atoms.push((alt, targets, location));
                        }
                        Cond::Matches(_, r) | Cond::Begins(_, r) => roots.extend(r.iter().cloned()),
                        Cond::Not(c) => stack.push(Part::C(c)),
                        Cond::All(cs) | Cond::Any(cs) => stack.extend(cs.iter().map(Part::C)),
                        Cond::If(a, b) => stack.extend([Part::C(a), Part::C(b)]),
                        Cond::Compare(_, a, b) => stack.extend([Part::T(a), Part::T(b)]),
                        _ => {}
                    },
                    Part::T(t) => match t {
                        Term::If(c, t) => stack.extend([Part::C(c), Part::T(t)]),
                        Term::Union(ts) | Term::Intersection(ts) => stack.extend(ts.iter().map(Part::T)),
                        Term::Difference(a, b) => stack.extend([Part::T(a), Part::T(b)]),
                        Term::Call(name, args) => {
                            if name == "tags" {
                                roots.extend(args.iter().filter_map(|arg| {
                                    if let Arg::Rule(n) = arg {
                                        Some(n.clone())
                                    } else {
                                        None
                                    }
                                }));
                            }
                            stack.extend(args.iter().filter_map(|arg| {
                                if let Arg::Term(t) = arg {
                                    Some(Part::T(t))
                                } else {
                                    None
                                }
                            }));
                        }
                        _ => {}
                    },
                }
            }
        }
    }
    if atoms.is_empty() {
        return Ok(());
    }
    let (rules, terminals) = reach(g, roots);
    // Restore source order: target diagnostics follow written atom order.
    atoms.sort_by_key(|(alt, _, location)| (alt.text_order, location.at));
    for (alt, targets, location) in atoms {
        for (index, target) in targets.iter().enumerate() {
            let found = if target.starts_with(|c: char| c.is_ascii_uppercase()) {
                terminals.contains(target)
            } else {
                rules.contains(target)
            };
            if !found {
                let mut error = crate::error::Error::grammar(format!("boundary target {target} is unreachable"))
                    .in_document(&alt.document);
                if let Some(&(line, column)) = location.targets.get(index) {
                    error = error.at(line, column);
                }
                return Err(error);
            }
        }
    }
    Ok(())
}

fn lowered_term_atom(term: &crate::lower::LTerm) -> Option<&LCond> {
    use crate::lower::LTerm;
    let mut stack = vec![term];
    while let Some(term) = stack.pop() {
        match term {
            LTerm::If(c, t) => {
                if let Some(found) = atom(c) {
                    return Some(found);
                }
                stack.push(t);
            }
            LTerm::Union(ts) | LTerm::Inter(ts) => stack.extend(ts.iter().rev()),
            LTerm::Diff(a, b) | LTerm::Split(a, b) => stack.extend([&**b, &**a]),
            LTerm::Classify(t, _) | LTerm::Ngrams(t, _) => stack.push(t),
            _ => {}
        }
    }
    None
}
fn term_ownership(term: &mut crate::lower::LTerm, own: bool) {
    use crate::lower::LTerm;
    match term {
        LTerm::If(c, t) => {
            ownership(c, own);
            term_ownership(t, own);
        }
        LTerm::Union(ts) | LTerm::Inter(ts) => {
            for t in ts {
                term_ownership(t, own)
            }
        }
        LTerm::Diff(a, b) | LTerm::Split(a, b) => {
            term_ownership(a, own);
            term_ownership(b, own);
        }
        LTerm::Classify(t, _) | LTerm::Ngrams(t, _) => term_ownership(t, own),
        _ => {}
    }
}
