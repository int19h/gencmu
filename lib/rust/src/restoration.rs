//! Shared observations of projected omitted leaves and ranked blocks (§4).

pub(crate) mod family;

use crate::earley::Tok;
use crate::hash::FastMap;
use crate::result::Restoration;

pub(crate) const INVALID: u32 = u32::MAX;

/// The source mapping used by both restoration representations (§7.2).
pub(crate) fn record(terminal: String, at: usize, tokens: &[Tok], value: Option<String>) -> Restoration {
    let source = if at > 0 { tokens[at - 1].source.1 } else { tokens.first().map_or(0, |t| t.source.0) };
    Restoration { terminal, at, source: source..source, value }
}

type CapturedEntry = (String, usize, usize, u32, u32, u32);

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct Entry {
    pub parent: Option<u32>,
    pub written: String,
    pub origin: usize,
    pub at: usize,
    pub dot: u32,
    pub control: u32,
    pub prefix: u32,
    pub structure: u32,
    pub captures: Vec<CapturedEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct Block {
    pub group: usize,
    pub start: usize,
    pub end: usize,
    pub entry: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum Event {
    Close(Restoration),
    Block(Block),
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) enum Aligned {
    Close(String, usize),
    Block(Block),
}

// Sequence fingerprints are polynomials modulo a prime chosen once per process
// from the process seed, with a base chosen from the same seed. Because both
// the modulus and the base are secret per process, an attacker cannot know the
// period of any base.
const MIN_MODULUS: u64 = 1u64 << 60;
const MAX_MODULUS: u64 = 1u64 << 61;
const MILLER_RABIN_BASES: [u64; 12] = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37];

#[inline]
fn mul_mod(a: u64, b: u64, modulus: u64) -> u64 {
    ((u128::from(a) * u128::from(b)) % u128::from(modulus)) as u64
}

#[inline]
fn add_mod(a: u64, b: u64, modulus: u64) -> u64 {
    ((u128::from(a) + u128::from(b)) % u128::from(modulus)) as u64
}

fn pow_mod(mut base: u64, mut exp: u64, modulus: u64) -> u64 {
    let mut result = 1u64;
    base %= modulus;
    while exp > 0 {
        if exp & 1 != 0 {
            result = mul_mod(result, base, modulus);
        }
        base = mul_mod(base, base, modulus);
        exp >>= 1;
    }
    result
}

fn is_prime(n: u64) -> bool {
    if n < 2 {
        return false;
    }
    for p in MILLER_RABIN_BASES {
        if n == p {
            return true;
        }
        if n % p == 0 {
            return false;
        }
    }
    let s = (n - 1).trailing_zeros();
    let d = (n - 1) >> s;
    for a in MILLER_RABIN_BASES {
        let mut x = pow_mod(a, d, n);
        if x == 1 || x == n - 1 {
            continue;
        }
        let mut composite = true;
        for _ in 1..s {
            x = mul_mod(x, x, n);
            if x == n - 1 {
                composite = false;
                break;
            }
        }
        if composite {
            return false;
        }
    }
    true
}

fn prime_from(seed: u64) -> u64 {
    let span = MAX_MODULUS - MIN_MODULUS;
    let mut offset = (seed % span) | 1;
    loop {
        let candidate = MIN_MODULUS + offset;
        if is_prime(candidate) {
            return candidate;
        }
        offset = ((offset + 2) % span) | 1;
    }
}

#[inline]
fn sequence_parameters() -> (u64, u64) {
    static PARAMETERS: std::sync::OnceLock<(u64, u64)> = std::sync::OnceLock::new();
    *PARAMETERS.get_or_init(|| {
        let (first, second, _) = crate::hash::process_seed();
        let modulus = prime_from(first);
        let base = (second ^ first.rotate_left(31)) % (modulus - 3) + 2;
        (modulus, base)
    })
}

// Leaves and concatenations preserve chart sharing. Fingerprints select
// possible equal sequences, and exact comparisons settle equality.
#[derive(Debug)]
struct Node<T> {
    event: Option<T>,
    left: u32,
    right: u32,
    length: u64,
    hash: u64,
    power: u64,
    height: usize,
}
#[derive(Debug)]
struct Sequence<T> {
    nodes: Vec<Node<T>>,
    leaves: FastMap<T, u32>,
    joins: FastMap<(u32, u32), u32>,
    buckets: FastMap<(u64, u64), Vec<u32>>,
    #[cfg(test)]
    parameters: Option<(u64, u64)>,
}
impl<T: Clone + Eq + std::hash::Hash> Sequence<T> {
    fn new() -> Self {
        Self {
            nodes: vec![Node { event: None, left: 0, right: 0, length: 0, hash: 0, power: 1, height: 0 }],
            leaves: FastMap::default(),
            joins: FastMap::default(),
            buckets: FastMap::default(),
            #[cfg(test)]
            parameters: None,
        }
    }
    #[cfg(test)]
    fn with_parameters(modulus: u64, base: u64) -> Self {
        Self { parameters: Some((modulus, base)), ..Self::new() }
    }
    #[inline]
    fn parameters(&self) -> (u64, u64) {
        #[cfg(test)]
        if let Some(parameters) = self.parameters {
            return parameters;
        }
        sequence_parameters()
    }
    #[inline]
    fn leaf_hasher(&self) -> crate::hash::FastHasher {
        #[cfg(test)]
        if self.parameters.is_some() {
            return crate::hash::FastHasher::with_seed(
                0xbf58_476d_1ce4_e5b9,
                0x9e37_79b9_7f4a_7c15,
                0x94d0_49bb_1331_11eb,
            );
        }
        crate::hash::FastHasher::default()
    }
    fn same(&self, a: u32, b: u32) -> bool {
        let (mut left, mut right) = (vec![a], vec![b]);
        while !left.is_empty() && !right.is_empty() {
            let (a, b) = (left.pop().unwrap(), right.pop().unwrap());
            if a == b {
                continue;
            }
            let (aid, bid) = (a, b);
            let (a, b) = (&self.nodes[a as usize], &self.nodes[b as usize]);
            match (&a.event, &b.event) {
                (Some(a), Some(b)) => {
                    if a != b {
                        return false;
                    }
                }
                (None, _) if b.event.is_some() || a.height >= b.height => {
                    left.extend([a.right, a.left]);
                    right.push(bid);
                }
                _ => {
                    left.push(aid);
                    right.extend([b.right, b.left]);
                }
            }
        }
        left.is_empty() && right.is_empty()
    }
    fn store(&mut self, node: Node<T>) -> u32 {
        crate::work::count(crate::work::Work::CloseSequences, 1);
        let key = (node.length, node.hash);
        let id = self.nodes.len() as u32;
        self.nodes.push(node);
        if let Some(bucket) = self.buckets.get(&key) {
            for &old in bucket {
                if self.same(id, old) {
                    self.nodes.pop();
                    return old;
                }
            }
        }
        self.buckets.entry(key).or_default().push(id);
        id
    }
    fn append(&mut self, parent: u32, event: T) -> u32 {
        let leaf = if let Some(&id) = self.leaves.get(&event) {
            id
        } else {
            use std::hash::Hasher;
            let (modulus, base) = self.parameters();
            let mut hash = self.leaf_hasher();
            event.hash(&mut hash);
            let id = self.store(Node {
                event: Some(event.clone()),
                left: 0,
                right: 0,
                length: 1,
                hash: hash.finish() % modulus,
                power: base,
                height: 1,
            });
            self.leaves.insert(event, id);
            id
        };
        self.join(parent, leaf)
    }
    fn join(&mut self, left: u32, right: u32) -> u32 {
        if left == 0 {
            return right;
        }
        if right == 0 {
            return left;
        }
        if let Some(&id) = self.joins.get(&(left, right)) {
            return id;
        }
        let (modulus, _) = self.parameters();
        let (a, b) = (&self.nodes[left as usize], &self.nodes[right as usize]);
        // Length is a bounded fingerprint, never an equality decision.
        let node = Node {
            event: None,
            left,
            right,
            length: a.length.wrapping_add(b.length),
            hash: add_mod(mul_mod(a.hash, b.power, modulus), b.hash, modulus),
            power: mul_mod(a.power, b.power, modulus),
            height: a.height.max(b.height) + 1,
        };
        let id = self.store(node);
        self.joins.insert((left, right), id);
        id
    }
    fn values(&self, id: u32) -> Vec<&T> {
        let mut stack = vec![id];
        let mut out = vec![];
        while let Some(id) = stack.pop() {
            if id == 0 {
                continue;
            }
            let node = &self.nodes[id as usize];
            if let Some(event) = &node.event {
                out.push(event);
            } else {
                stack.extend([node.right, node.left]);
            }
        }
        out
    }
}

/// At completion only occurrences over that whole span remain relevant.
type Occurrence = (u32, usize, usize);
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct Observation {
    events: u32,
    aligned: u32,
    footprint: Vec<Occurrence>,
}
#[derive(Debug)]
pub(crate) struct Observations {
    bounds: Vec<(usize, usize)>,
    prefixes: FastMap<(u32, usize), Option<u32>>,
    events: Sequence<Event>,
    aligned: Sequence<Aligned>,
    controls: Sequence<String>,
    states: Vec<Observation>,
    index: FastMap<Observation, u32>,
    entries: Vec<Entry>,
    entry_index: FastMap<Entry, u32>,
    joins: FastMap<(u32, u32), u32>,
}
impl Observations {
    pub(crate) fn new() -> Self {
        let empty = Observation { events: 0, aligned: 0, footprint: Vec::new() };
        Self {
            bounds: vec![(usize::MAX, 0)],
            prefixes: FastMap::default(),
            events: Sequence::new(),
            aligned: Sequence::new(),
            controls: Sequence::new(),
            states: vec![empty.clone()],
            index: [(empty, 0)].into_iter().collect(),
            entries: Vec::new(),
            entry_index: FastMap::default(),
            joins: FastMap::default(),
        }
    }
    fn intern(&mut self, state: Observation) -> u32 {
        if let Some(&id) = self.index.get(&state) {
            return id;
        }
        let id = self.states.len() as u32;
        self.states.push(state.clone());
        self.index.insert(state, id);
        crate::work::count(crate::work::Work::CloseStates, 1);
        id
    }
    pub(crate) fn normalized(&self, id: u32) -> u32 {
        if id == INVALID {
            INVALID
        } else {
            self.states[id as usize].aligned
        }
    }
    pub(crate) fn close(&mut self, record: Restoration) -> u32 {
        let aligned = self.aligned.append(0, Aligned::Close(record.terminal.clone(), record.at));
        let events = self.events.append(0, Event::Close(record));
        self.intern(Observation { events, aligned, footprint: Vec::new() })
    }
    pub(crate) fn block(&mut self, block: Block, child: u32) -> u32 {
        if child == INVALID {
            return INVALID;
        }
        let footprint = self.states[child as usize].footprint.clone();
        let aligned = self.aligned.append(0, Aligned::Block(block.clone()));
        let events = self.events.append(0, Event::Block(block));
        self.intern(Observation { events, aligned, footprint })
    }
    pub(crate) fn entry(&mut self, entry: Entry) -> u32 {
        if let Some(&id) = self.entry_index.get(&entry) {
            return id;
        }
        let id = self.entries.len() as u32;
        self.entries.push(entry.clone());
        self.entry_index.insert(entry, id);
        id
    }
    pub(crate) fn control(&mut self, symbols: &[String]) -> u32 {
        symbols.iter().fold(0, |prefix, symbol| self.controls.append(prefix, symbol.clone()))
    }
    pub(crate) fn join(&mut self, left: u32, right: u32) -> u32 {
        if left == INVALID || right == INVALID {
            return INVALID;
        }
        if left == 0 {
            return right;
        }
        if right == 0 {
            return left;
        }
        if let Some(&id) = self.joins.get(&(left, right)) {
            return id;
        }
        let a = &self.states[left as usize];
        let b = &self.states[right as usize];
        let mut footprint = a.footprint.clone();
        footprint.extend_from_slice(&b.footprint);
        footprint.sort_unstable();
        footprint.dedup();
        let events = self.events.join(a.events, b.events);
        let aligned = self.aligned.join(a.aligned, b.aligned);
        let id = self.intern(Observation { events, aligned, footprint });
        self.joins.insert((left, right), id);
        id
    }
    pub(crate) fn complete(&mut self, id: u32, rule: Option<u32>, start: usize, end: usize) -> u32 {
        if id == INVALID {
            return INVALID;
        }
        let mut state = self.states[id as usize].clone();
        state.footprint.retain(|&(_, a, b)| a == start && b == end);
        if let Some(rule) = rule {
            match state.footprint.binary_search(&(rule, start, end)) {
                Ok(_) => return INVALID,
                Err(at) => state.footprint.insert(at, (rule, start, end)),
            }
        }
        self.intern(state)
    }
    fn through(&mut self, id: u32, end: usize) -> Option<u32> {
        while self.bounds.len() < self.aligned.nodes.len() {
            let node = &self.aligned.nodes[self.bounds.len()];
            let bound = match &node.event {
                Some(Aligned::Close(_, at)) => (*at, *at),
                Some(Aligned::Block(block)) => (block.start, block.end),
                None => {
                    let a = self.bounds[node.left as usize];
                    let b = self.bounds[node.right as usize];
                    (a.0.min(b.0), a.1.max(b.1))
                }
            };
            self.bounds.push(bound);
        }
        let mut stack = vec![id];
        while let Some(&at) = stack.last() {
            let key = (at, end);
            if self.prefixes.contains_key(&key) {
                stack.pop();
                continue;
            }
            let bound = self.bounds[at as usize];
            let node = &self.aligned.nodes[at as usize];
            let value = if at == 0 || bound.0 > end {
                Some(Some(0))
            } else if bound.1 <= end {
                Some(Some(at))
            } else if node.event.is_some() {
                Some(if bound.0 < end { None } else { Some(0) })
            } else {
                let (left, right) = (node.left, node.right);
                if !self.prefixes.contains_key(&(left, end)) {
                    stack.push(left);
                    None
                } else if !self.prefixes.contains_key(&(right, end)) {
                    stack.push(right);
                    None
                } else {
                    Some(match (self.prefixes[&(left, end)], self.prefixes[&(right, end)]) {
                        (Some(a), Some(b)) => Some(self.aligned.join(a, b)),
                        _ => None,
                    })
                }
            };
            if let Some(value) = value {
                self.prefixes.insert(key, value);
            }
        }
        self.prefixes[&(id, end)]
    }
    pub(crate) fn aligns(&mut self, candidate: u32, witness: u32, end: usize) -> bool {
        if candidate == INVALID || witness == INVALID {
            return false;
        }
        match (self.through(self.normalized(candidate), end), self.through(self.normalized(witness), end)) {
            (Some(a), Some(b)) => a == b,
            _ => false,
        }
    }
}

pub(crate) fn plans_by_production(g: &crate::lower::Lowered) -> Vec<Vec<&crate::lower::RankedPlan>> {
    let mut plans = vec![Vec::new(); g.prods.len()];
    for ((production, ..), plan) in &g.ranked.plans {
        plans[*production as usize].push(plan);
    }
    plans
}

/// Only reachable queries demand candidate and witness observations.
pub(crate) fn demanded(g: &crate::lower::Lowered) -> crate::hash::FastSet<u32> {
    use crate::hash::FastSet;
    use crate::lower::{LCond, LEmit, LEmitItem, LTerm, Prod, Span, Sym};
    fn uses(s: &Span) -> bool {
        match s {
            Span::WithoutElision(_, _) => true,
            Span::Head(s) | Span::Tail(s) | Span::Last(s) | Span::From(s) | Span::After(s) | Span::Before(s) => uses(s),
            _ => false,
        }
    }
    fn span(s: &Span, p: &Prod, w: &mut FastSet<u32>) {
        match s {
            Span::WithoutElision(inner, _) => {
                let symbol = match **inner {
                    Span::Cap(c) => p.cap_pos.get(c as usize).and_then(|&at| p.syms.get(at)),
                    _ => None,
                };
                if let Some(Sym::N(rule)) = symbol {
                    w.insert(*rule);
                }
                if symbol.is_none() || p.slot.as_ref().is_some_and(|slot| slot.ranked.is_some()) {
                    w.insert(p.owner);
                    w.insert(p.rule);
                }
            }
            Span::Head(s) | Span::Tail(s) | Span::Last(s) | Span::From(s) | Span::After(s) | Span::Before(s) => {
                span(s, p, w)
            }
            _ => {}
        }
    }
    fn query(s: &Span, r: u32, p: &Prod, w: &mut FastSet<u32>, todo: &mut Vec<u32>) {
        todo.push(r);
        if uses(s) {
            w.insert(r);
        }
        span(s, p, w);
    }
    fn term(t: &LTerm, p: &Prod, w: &mut FastSet<u32>, todo: &mut Vec<u32>) {
        match t {
            LTerm::ForestTags(s, r, ..) => query(s, *r, p, w, todo),
            LTerm::Text(s)
            | LTerm::DecomposedText(s)
            | LTerm::Value(s)
            | LTerm::Image(s)
            | LTerm::Tags(s)
            | LTerm::Classes(s) => span(s, p, w),
            LTerm::If(c, t) => {
                cond(c, p, w, todo);
                term(t, p, w, todo);
            }
            LTerm::Union(ts) | LTerm::Inter(ts) | LTerm::Concat(ts) => {
                for t in ts {
                    term(t, p, w, todo);
                }
            }
            LTerm::Diff(a, b) | LTerm::Split(a, b) => {
                term(a, p, w, todo);
                term(b, p, w, todo);
            }
            LTerm::Classify(t, _) | LTerm::Ngrams(t, _) => term(t, p, w, todo),
            _ => {}
        }
    }
    fn cond(c: &LCond, p: &Prod, w: &mut FastSet<u32>, todo: &mut Vec<u32>) {
        match c {
            LCond::SameTree(..) => (),
            LCond::Matches(s, r)
            | LCond::Begins(s, r)
            | LCond::Ends(s, r)
            | LCond::Contains(s, r)
            | LCond::ErrorFree(s, r, _) => query(s, *r, p, w, todo),
            LCond::Initial(s) | LCond::Final(s) | LCond::Boundary(_, s, _, _, _) | LCond::Tree(s, _, _) => {
                span(s, p, w)
            }
            LCond::Cmp(_, a, b) => {
                term(a, p, w, todo);
                term(b, p, w, todo);
            }
            LCond::Not(c) => cond(c, p, w, todo),
            LCond::Any(cs) | LCond::All(cs) => {
                for c in cs {
                    cond(c, p, w, todo);
                }
            }
            LCond::If(a, b) => {
                cond(a, p, w, todo);
                cond(b, p, w, todo);
            }
        }
    }
    let plans = plans_by_production(g);
    let mut w = FastSet::default();
    let mut seen = FastSet::default();
    let mut todo = vec![g.start];
    while let Some(rule) = todo.pop() {
        if !seen.insert(rule) {
            continue;
        }
        for &id in &g.rules[rule as usize].prods {
            let p = &g.prods[id as usize];
            let mut local = FastSet::default();
            for s in &p.syms {
                if let Sym::N(r) = s {
                    todo.push(*r);
                }
            }
            for (c, _) in &p.conds {
                cond(c, p, &mut local, &mut todo);
            }
            if let Some(t) = &p.tags {
                term(t, p, &mut local, &mut todo);
            }
            match &p.emit {
                LEmit::This(ts) => {
                    for t in ts.iter().flatten() {
                        term(t, p, &mut local, &mut todo);
                    }
                }
                LEmit::Items(es) => {
                    for e in es {
                        if let LEmitItem::Cap(_, Some(t), _, _) | LEmitItem::Insert(Some(t), _) = e {
                            term(t, p, &mut local, &mut todo);
                        }
                    }
                }
                _ => {}
            }
            for plan in &plans[id as usize] {
                for (c, _) in plan.conditions.iter().flatten() {
                    cond(c, p, &mut local, &mut todo);
                }
                if let Some(t) = &plan.whole_tags {
                    term(t, p, &mut local, &mut todo);
                }
            }
            if !local.is_empty() && p.syms.iter().any(|s| matches!(s,Sym::N(r) if g.ranked.slots.contains_key(r))) {
                local.insert(p.owner);
                local.insert(p.rule);
            }
            w.extend(local);
        }
    }
    let mut todo: Vec<_> = w.iter().copied().collect();
    while let Some(rule) = todo.pop() {
        for &id in &g.rules[rule as usize].prods {
            for s in &g.prods[id as usize].syms {
                if let Sym::N(r) = s {
                    if w.insert(*r) {
                        todo.push(*r);
                    }
                }
            }
        }
    }
    w
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn growing_prefixes_store_one_link_per_event() {
        for n in [128, 256, 512] {
            let mut observations = Observations::new();
            let mut prefix = 0;
            for at in 0..n {
                let close = observations.close(Restoration { terminal: "T".into(), at, source: at..at, value: None });
                prefix = observations.join(prefix, close);
            }
            assert_eq!(observations.aligned.values(observations.normalized(prefix)).len(), n);
            assert!(observations.events.nodes.len() <= 2 * n + 1);
            assert!(observations.aligned.nodes.len() <= 2 * n + 1);
            assert!(observations.states.len() <= 2 * n + 1);
        }
    }

    #[test]
    fn a_seal_preserves_named_cycles_and_invalidity() {
        let mut observations = Observations::new();
        let child = observations.complete(0, Some(7), 0, 1);
        let block = Block { group: 0, start: 0, end: 1, entry: 0 };
        let sealed = observations.block(block.clone(), child);
        assert_eq!(observations.complete(sealed, Some(7), 0, 1), INVALID);
        assert_eq!(observations.block(block, INVALID), INVALID);
    }

    #[test]
    fn a_prefix_before_a_nonempty_seal_excludes_that_seal() {
        let mut observations = Observations::new();
        let positive = observations.block(Block { group: 0, start: 1, end: 2, entry: 0 }, 0);
        assert!(observations.aligns(positive, 0, 1));
        assert!(!observations.aligns(positive, 0, 2));
        let empty = observations.block(Block { group: 0, start: 1, end: 1, entry: 0 }, 0);
        assert!(!observations.aligns(empty, 0, 1));
    }

    #[test]
    fn partial_prefixes_drop_smaller_cycle_occurrences() {
        for n in [128, 256, 512] {
            let mut observations = Observations::new();
            let mut prefix = 0;
            for at in 0..n {
                let child =
                    observations.close(Restoration { terminal: "T".into(), at: at + 1, source: at..at, value: None });
                let child = observations.complete(child, Some(7), at, at + 1);
                prefix = observations.join(prefix, child);
                prefix = observations.complete(prefix, None, 0, at + 1);
            }
            assert!(observations.states.iter().map(|state| state.footprint.len()).sum::<usize>() <= 3 * n + 3);
            assert!(observations.states.iter().all(|state| state.footprint.len() <= 2));
        }
    }

    #[test]
    fn shared_doubling_obeys_the_fixture_bound() {
        use crate::json::Json;
        use crate::work::{self, Work};
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests");
        let growth =
            crate::json::parse(&std::fs::read_to_string(root.join("without-elision-growth.json")).unwrap()).unwrap();
        let fixture = crate::json::parse(
            &std::fs::read_to_string(root.join(growth.get("case").unwrap().as_str().unwrap())).unwrap(),
        )
        .unwrap();
        let template = fixture.get("grammar").unwrap().as_str().unwrap();
        let factor = growth.get("nodesPerDepth").unwrap().as_int().unwrap() as u64;
        let slack = growth.get("slack").unwrap().as_int().unwrap() as u64;
        for depth in growth.get("depths").unwrap().as_array().unwrap() {
            let depth = depth.as_int().unwrap() as usize;
            for witness in [false, true] {
                let mut rules =
                    template.lines().take(5).collect::<Vec<_>>().join("\n").replace("r16", &format!("r{depth}"));
                for i in 1..=depth {
                    rules += &format!("\n%rule r{i} r{} r{}", i - 1, i - 1);
                }
                if witness {
                    rules = rules
                        .replace("$x.without-elision.parse(empty)", &format!("¬$x.without-elision.parse(r{depth})"));
                }
                let source = format!("```jbogenbau\n%stage main\n{rules}\n```\n");
                let pipeline = crate::load_pipeline_sources([("p.md", source.as_str())], "p.md").unwrap();
                work::reset();
                work::budget(Work::CloseSequences, factor * (depth as u64 + 1) + slack);
                let result = pipeline.parse_tokens(&[], &crate::ParseOptions::default()).unwrap();
                assert!(result.ok, "depth {depth}, witness {witness}: {:?}", result.error);
                eprintln!("depth {depth}, witness {witness}: {} close nodes", work::counted(Work::CloseSequences));
                work::reset();
            }
        }
        for file in growth.get("unusedCases").unwrap().as_array().unwrap() {
            let fixture =
                crate::json::parse(&std::fs::read_to_string(root.join("engine").join(file.as_str().unwrap())).unwrap())
                    .unwrap();
            let source=format!("```jbogenbau\n%stage main\n{}\n%rule unused $x:empty\n%conditions $x.without-elision.parse(empty)\n%rule empty ε\n```\n",fixture.get("grammar").unwrap().as_str().unwrap());
            let pipeline = crate::load_pipeline_sources([("p.md", source.as_str())], "p.md").unwrap();
            let tokens = fixture
                .get("tokens")
                .and_then(Json::as_array)
                .unwrap_or(&[])
                .iter()
                .map(|t| crate::InputToken {
                    errors: Vec::new(),
                    warnings: Vec::new(),
                    image: None,
                    text: t.get("text").and_then(Json::as_str).unwrap_or("").into(),
                    tags: t
                        .get("tags")
                        .and_then(Json::as_array)
                        .unwrap_or(&[])
                        .iter()
                        .map(|t| t.as_str().unwrap().into())
                        .collect(),
                    value: t.get("value").and_then(Json::as_str).map(str::to_owned),
                })
                .collect::<Vec<_>>();
            work::reset();
            work::budget(Work::CloseSequences, 0);
            let result = pipeline.parse_tokens(&tokens, &crate::ParseOptions::default()).unwrap();
            assert!(result.ok, "{}: {:?}", file.as_str().unwrap(), result.error);
            assert_eq!(work::counted(Work::CloseSequences), 0);
            let lowered = pipeline.lowered_stage(0);
            assert!(demanded(&lowered).is_empty());
            work::reset();
        }
    }

    #[test]
    fn an_unrelated_ranked_sibling_creates_no_close_nodes() {
        use crate::work::{self, Work};
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests");
        let growth =
            crate::json::parse(&std::fs::read_to_string(root.join("without-elision-growth.json")).unwrap()).unwrap();
        let shared = growth.get("rankedSibling").unwrap();
        let fixture = crate::json::parse(
            &std::fs::read_to_string(root.join(shared.get("case").unwrap().as_str().unwrap())).unwrap(),
        )
        .unwrap();
        let template = fixture.get("grammar").unwrap().as_str().unwrap();
        let budget = shared.get("maxCloseNodes").unwrap().as_int().unwrap() as u64;
        for depth in shared.get("depths").unwrap().as_array().unwrap() {
            let depth = depth.as_int().unwrap() as usize;
            let mut rules =
                template.lines().take(7).collect::<Vec<_>>().join("\n").replace("r10", &format!("r{depth}"));
            for i in 1..=depth {
                rules += &format!("\n%rule r{i} r{} r{} | [+V]", i - 1, i - 1);
            }
            let mut results = Vec::new();
            let mut items = Vec::new();
            for aligned in [false, true] {
                let grammar = if aligned { rules.clone() } else { rules.replace("$x.without-elision", "$x") };
                let source = format!("```jbogenbau\n%stage main\n{grammar}\n```\n");
                let pipeline = crate::load_pipeline_sources([("p.md", source.as_str())], "p.md").unwrap();
                work::reset();
                work::budget(Work::CloseSequences, budget);
                let result = pipeline.parse_tokens(&[], &crate::ParseOptions::default()).unwrap();
                assert!(result.ok, "depth {depth}, aligned {aligned}: {:?}", result.error);
                assert_eq!(work::counted(Work::CloseSequences), budget);
                results.push(crate::to_json(&result));
                items.push(work::counted(Work::Items));
                work::reset();
            }
            assert_eq!(results[0], results[1], "depth {depth}");
            assert_eq!(items[0], items[1], "depth {depth}");
            eprintln!("ranked sibling depth {depth}: {} items, 0 close nodes", items[1]);
        }
    }

    #[test]
    fn rope_comparison_is_exact_with_colliding_fingerprints() {
        #[derive(Clone, PartialEq, Eq)]
        struct Collision(u8);
        impl std::hash::Hash for Collision {
            fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
                state.write_u8(0);
            }
        }
        let mut rope = Sequence::new();
        let a = rope.append(0, Collision(1));
        let b = rope.append(0, Collision(2));
        let ab = rope.join(a, b);
        let ba = rope.join(b, a);
        assert_ne!(ab, ba);
        let left = rope.join(ab, a);
        let right = rope.join(a, ba);
        assert_eq!(left, right);
        let mut large = a;
        for _ in 0..100 {
            large = rope.join(large, large);
        }
        assert_ne!(large, rope.join(large, large));
        assert!(rope.nodes.len() < 120);
    }
}

#[derive(Debug, Default, Clone)]
pub(crate) struct LocalDemand {
    pub(crate) whole: bool,
    pub(crate) captures: crate::hash::FastSet<u32>,
    pub(crate) lexical: crate::hash::FastSet<String>,
    pub(crate) queries: crate::hash::FastMap<u32, Option<crate::hash::FastSet<u32>>>,
}

pub(crate) fn local_demands(g: &crate::lower::Lowered) -> Vec<LocalDemand> {
    use crate::lower::{LCond, LEmit, LEmitItem, LTerm, Span};
    fn span(s: &Span, out: &mut LocalDemand) {
        match s {
            Span::WithoutElision(inner, _) => match &**inner {
                Span::Cap(c) => {
                    out.captures.insert(*c);
                    out.queries.insert(*c, None);
                }
                Span::Whole => out.whole = true,
                Span::Lexical(name) if name.is_empty() => out.whole = true,
                Span::Lexical(name) => {
                    out.lexical.insert(name.clone());
                }
                _ => {}
            },
            Span::Head(s) | Span::Tail(s) | Span::Last(s) | Span::From(s) | Span::After(s) | Span::Before(s) => {
                span(s, out)
            }
            _ => {}
        }
    }
    fn term(t: &LTerm, out: &mut LocalDemand) {
        match t {
            LTerm::ForestTags(s, rule, ..) => {
                let aligned = if let Span::From(inner) = s { &**inner } else { s };
                if let Span::WithoutElision(inner, _) = aligned {
                    if let Span::Cap(c) = &**inner {
                        out.captures.insert(*c);
                        if let Some(rules) = out.queries.entry(*c).or_insert_with(|| Some(Default::default())) {
                            rules.insert(*rule);
                        }
                        return;
                    }
                }
                span(s, out);
            }
            LTerm::Text(s)
            | LTerm::DecomposedText(s)
            | LTerm::Value(s)
            | LTerm::Image(s)
            | LTerm::Tags(s)
            | LTerm::Classes(s) => span(s, out),
            LTerm::If(c, t) => {
                cond(c, out);
                term(t, out);
            }
            LTerm::Union(ts) | LTerm::Inter(ts) | LTerm::Concat(ts) => {
                for t in ts {
                    term(t, out);
                }
            }
            LTerm::Diff(a, b) | LTerm::Split(a, b) => {
                term(a, out);
                term(b, out);
            }
            LTerm::Classify(t, _) | LTerm::Ngrams(t, _) => term(t, out),
            _ => {}
        }
    }
    fn cond(c: &LCond, out: &mut LocalDemand) {
        match c {
            LCond::SameTree(..) => (),
            LCond::Matches(s, rule)
            | LCond::Begins(s, rule)
            | LCond::Ends(s, rule)
            | LCond::Contains(s, rule)
            | LCond::ErrorFree(s, rule, _) => {
                let aligned = if let Span::From(inner) = s { &**inner } else { s };
                if let Span::WithoutElision(inner, _) = aligned {
                    if let Span::Cap(c) = &**inner {
                        out.captures.insert(*c);
                        if let Some(rules) = out.queries.entry(*c).or_insert_with(|| Some(Default::default())) {
                            rules.insert(*rule);
                        }
                        return;
                    }
                }
                span(s, out);
            }
            LCond::Initial(s) | LCond::Final(s) | LCond::Boundary(_, s, _, _, _) | LCond::Tree(s, _, _) => span(s, out),
            LCond::Cmp(_, a, b) => {
                term(a, out);
                term(b, out);
            }
            LCond::Not(c) => cond(c, out),
            LCond::Any(cs) | LCond::All(cs) => {
                for c in cs {
                    cond(c, out);
                }
            }
            LCond::If(a, b) => {
                cond(a, out);
                cond(b, out);
            }
        }
    }
    let plans = plans_by_production(g);
    let mut out = vec![LocalDemand::default(); g.prods.len()];
    let mut sources: crate::hash::FastMap<(usize, usize), LocalDemand> = crate::hash::FastMap::default();
    for (i, p) in g.prods.iter().enumerate() {
        let d = &mut out[i];
        for (c, _) in &p.conds {
            cond(c, d);
        }
        if let Some(t) = &p.tags {
            term(t, d);
        }
        match &p.emit {
            LEmit::This(ts) => {
                for t in ts.iter().flatten() {
                    term(t, d);
                }
            }
            LEmit::Items(es) => {
                for e in es {
                    if let LEmitItem::Cap(_, Some(t), _, _) | LEmitItem::Insert(Some(t), _) = e {
                        term(t, d);
                    }
                }
            }
            _ => {}
        }
        for plan in &plans[i] {
            for (c, _) in plan.conditions.iter().flatten() {
                cond(c, d);
            }
            if let Some(t) = &plan.whole_tags {
                term(t, d);
            }
            if let Some(slot) = &p.slot {
                let shared = sources.entry(slot.source).or_default();
                shared.whole |= d.whole;
                shared.lexical.extend(d.lexical.iter().cloned());
            }
        }
    }
    for (p, d) in g.prods.iter().zip(&mut out) {
        if let Some(shared) = p.slot.as_ref().and_then(|s| sources.get(&s.source)) {
            d.whole |= shared.whole;
            d.lexical.extend(shared.lexical.iter().cloned());
        }
    }
    out
}

#[derive(Debug, Default, Clone)]
pub(crate) struct QueryPrefix {
    pub(crate) nullable: bool,
    pub(crate) leading_close: bool,
    pub(crate) first: crate::hash::FastSet<u32>,
}

// Conditions only reduce these prefixes. A leading omission or an empty
// capture prevents this shortcut from discarding observations.
pub(crate) fn query_prefixes(g: &crate::lower::Lowered) -> Vec<QueryPrefix> {
    use crate::lower::Sym;
    let mut table = vec![QueryPrefix::default(); g.rules.len()];
    let mut dependents = vec![Vec::new(); g.rules.len()];
    for (number, p) in g.prods.iter().enumerate() {
        for s in &p.syms {
            if let Sym::N(rule) = s {
                dependents[*rule as usize].push(number);
            }
        }
    }
    let mut pending: Vec<_> = (0..g.prods.len()).collect();
    let mut queued = vec![true; g.prods.len()];
    while let Some(number) = pending.pop() {
        queued[number] = false;
        let p = &g.prods[number];
        let mut here = table[p.rule as usize].clone();
        let before = (here.nullable, here.leading_close, here.first.len());
        if p.syms.is_empty() && g.rules[p.rule as usize].elided.is_some() {
            here.leading_close = true;
        }
        let mut empty = true;
        for s in &p.syms {
            match s {
                Sym::T(t) => {
                    here.first.insert(*t);
                    empty = false;
                    break;
                }
                Sym::N(n) => {
                    let child = &table[*n as usize];
                    here.first.extend(&child.first);
                    here.leading_close |= child.leading_close;
                    if !child.nullable {
                        empty = false;
                        break;
                    }
                }
            }
        }
        here.nullable |= empty;
        let changed = before != (here.nullable, here.leading_close, here.first.len());
        table[p.rule as usize] = here;
        if changed {
            for &dependent in &dependents[p.rule as usize] {
                if !queued[dependent] {
                    queued[dependent] = true;
                    pending.push(dependent);
                }
            }
        }
    }
    table
}

#[cfg(test)]
#[test]
fn caller_scope_leaves_other_uses_shared() {
    use crate::work::{self, Work};
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests");
    let growth =
        crate::json::parse(&std::fs::read_to_string(root.join("without-elision-growth.json")).unwrap()).unwrap();
    for name in ["callerScope", "impossiblePrefix"] {
        let shared = growth.get(name).unwrap();
        let fixture = crate::json::parse(
            &std::fs::read_to_string(root.join(shared.get("case").unwrap().as_str().unwrap())).unwrap(),
        )
        .unwrap();
        let rules = fixture.get("grammar").unwrap().as_str().unwrap();
        let source = format!("```jbogenbau\n%stage main\n{rules}\n```\n");
        let pipeline = crate::load_pipeline_sources([("p.md", source.as_str())], "p.md").unwrap();
        for length in shared.get("lengths").unwrap().as_array().unwrap() {
            let length = length.as_int().unwrap() as usize;
            work::reset();
            work::budget(Work::CloseSequences, shared.get("maxCloseNodes").unwrap().as_int().unwrap() as u64);
            work::budget(Work::CloseStates, shared.get("maxCloseStates").unwrap().as_int().unwrap() as u64);
            work::budget(
                Work::Items,
                (shared.get("itemsPerUnit").unwrap().as_int().unwrap() * length as i64
                    + shared.get("slack").unwrap().as_int().unwrap()) as u64,
            );
            let result = pipeline.parse(&format!("x{}", "a".repeat(length)), &crate::ParseOptions::default()).unwrap();
            assert!(!result.ok);
            assert_eq!(result.error.as_ref().unwrap().kind, crate::result::ParseErrorKind::Ambiguous);
            if shared.get("maxCloseNodes").unwrap().as_int().unwrap() > 0 {
                assert!(work::counted(Work::CloseStates) > 0);
            }
            assert!(work::counted(Work::Items) > 0);
            eprintln!(
                "caller scope {length}: {} items, {} states, {} sequences",
                work::counted(Work::Items),
                work::counted(Work::CloseStates),
                work::counted(Work::CloseSequences)
            );
            work::reset();
        }
    }
}

#[cfg(test)]
#[test]
fn miller_rabin_classifies_primes_composites_and_pseudoprimes() {
    let primes = [
        2u64,
        3,
        5,
        7,
        11,
        13,
        17,
        19,
        23,
        29,
        31,
        37,
        41,
        97,
        65_537,
        (1u64 << 31) - 1,
        (1u64 << 61) - 1,
        1_152_921_504_606_847_009,
        2_305_843_009_213_693_921,
        18_446_744_073_709_551_557,
    ];
    for p in primes {
        assert!(is_prime(p), "expected prime: {p}");
    }

    let composites = [
        0u64,
        1,
        4,
        6,
        8,
        9,
        15,
        21,
        25,
        27,
        33,
        35,
        49,
        121,
        169,
        561,
        1_105,
        1_729,
        (1u64 << 60) + 1,
        1_152_921_504_606_846_989,
        (1u64 << 61) - 3,
        u64::MAX,
    ];
    for n in composites {
        assert!(!is_prime(n), "expected composite: {n}");
    }

    // Smallest strong pseudoprimes to the first k prime bases.
    let strong_pseudoprimes = [
        2_047u64,
        1_373_653,
        25_326_001,
        3_215_031_751,
        2_152_302_898_747,
        3_474_749_660_383,
        341_550_071_728_321,
        3_825_123_056_546_413_051,
    ];
    for n in strong_pseudoprimes {
        assert!(!is_prime(n), "expected strong pseudoprime to be rejected: {n}");
    }
}

#[cfg(test)]
#[test]
fn sequence_modulus_and_base_are_in_range_and_prime() {
    let (modulus, base) = sequence_parameters();
    assert!(modulus > MIN_MODULUS && modulus < MAX_MODULUS);
    assert!(is_prime(modulus));
    assert!((2..=modulus - 2).contains(&base));

    for seed in [0u64, 1, 2, 42, u64::MAX, 0x9e37_79b9_7f4a_7c15] {
        let q = prime_from(seed);
        assert!(q > MIN_MODULUS && q < MAX_MODULUS);
        assert!(is_prime(q));
    }
}

#[cfg(test)]
#[test]
fn sequence_join_is_associative_and_separates_thue_morse() {
    let mut random_seq = Sequence::<u32>::new();
    let a = random_seq.append(0, 10);
    let b = random_seq.append(0, 20);
    let c = random_seq.append(0, 30);
    let d = random_seq.append(b, 40);
    let ab = random_seq.join(a, b);
    let bc = random_seq.join(b, c);
    assert_eq!(random_seq.join(ab, c), random_seq.join(a, bc));
    let ad = random_seq.join(a, d);
    let dc = random_seq.join(d, c);
    assert_eq!(random_seq.join(ad, c), random_seq.join(a, dc));

    // Fixed prime in (2^60, 2^61) and fixed base 3 of multiplicative order 36_028_797_018_963_969.
    let mut seq = Sequence::<u32>::with_parameters(1_152_921_504_606_847_009, 3);
    let mut zero = seq.append(0, 0);
    let mut one = seq.append(0, 1);
    assert_ne!(seq.nodes[zero as usize].hash, seq.nodes[one as usize].hash);
    for _ in 0..10 {
        let (next_zero, next_one) = (seq.join(zero, one), seq.join(one, zero));
        zero = next_zero;
        one = next_one;
    }
    assert_eq!(seq.nodes[zero as usize].length, 1024);
    assert_eq!(seq.nodes[one as usize].length, 1024);
    assert_ne!(seq.nodes[zero as usize].hash, seq.nodes[one as usize].hash);
    assert_ne!(zero, one);

    let mut left_zero = 0;
    let mut left_one = 0;
    for i in 0..1024u32 {
        let bit = i.count_ones() & 1;
        left_zero = seq.append(left_zero, bit);
        left_one = seq.append(left_one, 1 - bit);
    }
    assert_eq!(left_zero, zero);
    assert_eq!(left_one, one);
}

#[cfg(test)]
#[test]
fn sequence_doubling_at_mersenne_period_keeps_distinct_keys() {
    let mut seq = Sequence::<u32>::with_parameters(1_152_921_504_606_847_009, 3);
    let mut pow0 = seq.append(0, 0);
    let mut pow1 = seq.append(0, 1);
    assert_ne!(seq.nodes[pow0 as usize].hash, seq.nodes[pow1 as usize].hash);
    let mut acc0 = 0;
    let mut acc1 = 0;
    // Build two sequences of length (2^61 - 1) - 1 = 2^61 - 2 by repeated doubling.
    for _ in 1..=60 {
        pow0 = seq.join(pow0, pow0);
        pow1 = seq.join(pow1, pow1);
        acc0 = seq.join(acc0, pow0);
        acc1 = seq.join(acc1, pow1);
    }
    let old_period = (1u64 << 61) - 2;
    let key0 = (seq.nodes[acc0 as usize].length, seq.nodes[acc0 as usize].hash);
    let key1 = (seq.nodes[acc1 as usize].length, seq.nodes[acc1 as usize].hash);
    assert_eq!(key0.0, old_period);
    assert_eq!(key1.0, old_period);
    assert_ne!(key0, key1);
    assert_eq!(seq.buckets[&key0].len(), 1);
    assert_eq!(seq.buckets[&key1].len(), 1);

    let pair0 = seq.join(acc0, acc0);
    let pair1 = seq.join(acc0, acc1);
    let pair_key0 = (seq.nodes[pair0 as usize].length, seq.nodes[pair0 as usize].hash);
    let pair_key1 = (seq.nodes[pair1 as usize].length, seq.nodes[pair1 as usize].hash);
    assert_ne!(pair_key0, pair_key1);
}

#[cfg(test)]
#[test]
fn sequence_exact_comparison_settles_parameter_collisions() {
    // Collision case 1: modulus q = 2^61 - 1 and base 2, where period q - 1 = 2^61 - 2 yields hash 0.
    let mut mersenne_seq = Sequence::<u32>::with_parameters((1u64 << 61) - 1, 2);
    let mut pow0 = mersenne_seq.append(0, 0);
    let mut pow1 = mersenne_seq.append(0, 1);
    let mut acc0 = 0;
    let mut acc1 = 0;
    for _ in 1..=60 {
        pow0 = mersenne_seq.join(pow0, pow0);
        pow1 = mersenne_seq.join(pow1, pow1);
        acc0 = mersenne_seq.join(acc0, pow0);
        acc1 = mersenne_seq.join(acc1, pow1);
    }
    let period = (1u64 << 61) - 2;
    let key0 = (mersenne_seq.nodes[acc0 as usize].length, mersenne_seq.nodes[acc0 as usize].hash);
    let key1 = (mersenne_seq.nodes[acc1 as usize].length, mersenne_seq.nodes[acc1 as usize].hash);
    assert_eq!(key0, (period, 0));
    assert_eq!(key1, (period, 0));
    assert_ne!(acc0, acc1);
    assert_eq!(mersenne_seq.buckets[&key0], vec![acc0, acc1]);

    // Collision case 2: modulus q = 1_152_921_504_606_847_009 and order-4 base 988_526_914_893_689_627.
    let mut order4_seq = Sequence::<u32>::with_parameters(1_152_921_504_606_847_009, 988_526_914_893_689_627);
    let mut zero = order4_seq.append(0, 0);
    let mut one = order4_seq.append(0, 1);
    for _ in 0..10 {
        let (next_zero, next_one) = (order4_seq.join(zero, one), order4_seq.join(one, zero));
        zero = next_zero;
        one = next_one;
    }
    let tm_key0 = (order4_seq.nodes[zero as usize].length, order4_seq.nodes[zero as usize].hash);
    let tm_key1 = (order4_seq.nodes[one as usize].length, order4_seq.nodes[one as usize].hash);
    assert_eq!(tm_key0, (1024, 0));
    assert_eq!(tm_key1, (1024, 0));
    assert_ne!(zero, one);
    assert_eq!(order4_seq.buckets[&(1024, 0)], vec![zero, one]);

    let mut left_zero = 0;
    let mut left_one = 0;
    for i in 0..1024u32 {
        let bit = i.count_ones() & 1;
        left_zero = order4_seq.append(left_zero, bit);
        left_one = order4_seq.append(left_one, 1 - bit);
    }
    assert_eq!(left_zero, zero);
    assert_eq!(left_one, one);
}
