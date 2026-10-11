//! Shared observations of projected omitted leaves and ranked blocks (§4).

use crate::earley::Tok;
use crate::fxhash::FxMap;
use crate::result::Restoration;

pub(crate) const INVALID: u32 = u32::MAX;

/// The source mapping used by both restoration representations (§7.2).
pub(crate) fn record(terminal: String, at: usize, tokens: &[Tok], sound: Option<String>) -> Restoration {
    let source = if at > 0 { tokens[at - 1].source.1 } else { tokens.first().map_or(0, |t| t.source.0) };
    Restoration { terminal, at, source: source..source, sound }
}

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
    pub captures: Vec<(String, usize, usize, u32, u32, u32)>,
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
enum Aligned {
    Close(String, usize),
    Block(Block),
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
    leaves: FxMap<T, u32>,
    joins: FxMap<(u32, u32), u32>,
    buckets: FxMap<(u64, u64), Vec<u32>>,
}
impl<T: Clone + Eq + std::hash::Hash> Sequence<T> {
    fn new() -> Self {
        Self {
            nodes: vec![Node { event: None, left: 0, right: 0, length: 0, hash: 0, power: 1, height: 0 }],
            leaves: FxMap::default(),
            joins: FxMap::default(),
            buckets: FxMap::default(),
        }
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
            let mut hash = std::collections::hash_map::DefaultHasher::new();
            event.hash(&mut hash);
            let id = self.store(Node {
                event: Some(event.clone()),
                left: 0,
                right: 0,
                length: 1,
                hash: hash.finish(),
                power: 1099511628211,
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
        let (a, b) = (&self.nodes[left as usize], &self.nodes[right as usize]);
        // Length is a bounded fingerprint, never an equality decision.
        let node = Node {
            event: None,
            left,
            right,
            length: a.length.wrapping_add(b.length),
            hash: a.hash.wrapping_mul(b.power).wrapping_add(b.hash),
            power: a.power.wrapping_mul(b.power),
            height: a.height.max(b.height) + 1,
        };
        let id = self.store(node);
        self.joins.insert((left, right), id);
        id
    }
    #[cfg(test)]
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
    prefixes: FxMap<(u32, usize), Option<u32>>,
    events: Sequence<Event>,
    aligned: Sequence<Aligned>,
    controls: Sequence<String>,
    states: Vec<Observation>,
    index: FxMap<Observation, u32>,
    entries: Vec<Entry>,
    entry_index: FxMap<Entry, u32>,
    joins: FxMap<(u32, u32), u32>,
}
impl Observations {
    pub(crate) fn new() -> Self {
        let empty = Observation { events: 0, aligned: 0, footprint: Vec::new() };
        Self {
            bounds: vec![(usize::MAX, 0)],
            prefixes: FxMap::default(),
            events: Sequence::new(),
            aligned: Sequence::new(),
            controls: Sequence::new(),
            states: vec![empty.clone()],
            index: [(empty, 0)].into_iter().collect(),
            entries: Vec::new(),
            entry_index: FxMap::default(),
            joins: FxMap::default(),
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

/// Only reachable queries demand candidate and witness observations.
pub(crate) fn demanded(g: &crate::lower::Lowered) -> crate::fxhash::FxSet<u32> {
    use crate::fxhash::FxSet;
    use crate::lower::{LCond, LEmit, LEmitItem, LTerm, Prod, Span, Sym};
    fn uses(s: &Span) -> bool {
        match s {
            Span::WithoutElision(_) => true,
            Span::Head(s) | Span::Tail(s) | Span::Last(s) | Span::From(s) | Span::After(s) => uses(s),
            _ => false,
        }
    }
    fn span(s: &Span, p: &Prod, w: &mut FxSet<u32>) {
        match s {
            Span::WithoutElision(inner) => {
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
            Span::Head(s) | Span::Tail(s) | Span::Last(s) | Span::From(s) | Span::After(s) => span(s, p, w),
            _ => {}
        }
    }
    fn query(s: &Span, r: u32, p: &Prod, w: &mut FxSet<u32>, todo: &mut Vec<u32>) {
        todo.push(r);
        if uses(s) {
            w.insert(r);
        }
        span(s, p, w);
    }
    fn term(t: &LTerm, p: &Prod, w: &mut FxSet<u32>, todo: &mut Vec<u32>) {
        match t {
            LTerm::TagsRule(s, r) => query(s, *r, p, w, todo),
            LTerm::Text(s) | LTerm::Phonemes(s) | LTerm::Tags(s) | LTerm::Classes(s) => span(s, p, w),
            LTerm::If(c, t) => {
                cond(c, p, w, todo);
                term(t, p, w, todo);
            }
            LTerm::Union(ts) | LTerm::Inter(ts) => {
                for t in ts {
                    term(t, p, w, todo);
                }
            }
            LTerm::Diff(a, b) | LTerm::Split(a, b) => {
                term(a, p, w, todo);
                term(b, p, w, todo);
            }
            LTerm::TagOf(t) | LTerm::Classify(t, _) => term(t, p, w, todo),
            _ => {}
        }
    }
    fn cond(c: &LCond, p: &Prod, w: &mut FxSet<u32>, todo: &mut Vec<u32>) {
        match c {
            LCond::Matches(s, r) | LCond::Begins(s, r) => query(s, *r, p, w, todo),
            LCond::Initial(s) | LCond::Tree(s, _, _) => span(s, p, w),
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
    let mut w = FxSet::default();
    let mut seen = FxSet::default();
    let mut todo = vec![g.start];
    while let Some(rule) = todo.pop() {
        if !seen.insert(rule) {
            continue;
        }
        for &id in &g.rules[rule as usize].prods {
            let p = &g.prods[id as usize];
            let mut local = FxSet::default();
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
                        if let LEmitItem::Cap(_, Some(t), _, _) = e {
                            term(t, p, &mut local, &mut todo);
                        }
                    }
                }
                _ => {}
            }
            for ((production, _, _, _), plan) in &g.ranked.plans {
                if *production == id {
                    for (c, _) in plan.conditions.iter().flatten() {
                        cond(c, p, &mut local, &mut todo);
                    }
                    if let Some(t) = &plan.whole_tags {
                        term(t, p, &mut local, &mut todo);
                    }
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
                let close = observations.close(Restoration { terminal: "T".into(), at, source: at..at, sound: None });
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
                    observations.close(Restoration { terminal: "T".into(), at: at + 1, source: at..at, sound: None });
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
                    rules = rules.replace(
                        "matches(without-elision($x), empty)",
                        &format!("¬matches(without-elision($x), r{depth})"),
                    );
                }
                let source = format!("```jbogenbau\n%stage main\n{rules}\n```\n");
                let dialect = crate::load_dialect_sources([("p.md", source.as_str())], "p.md").unwrap();
                work::reset();
                work::budget(Work::CloseSequences, factor * (depth as u64 + 1) + slack);
                let result = dialect.parse_tokens(&[], &crate::ParseOptions::default()).unwrap();
                assert!(result.ok, "depth {depth}, witness {witness}: {:?}", result.error);
                eprintln!("depth {depth}, witness {witness}: {} close nodes", work::counted(Work::CloseSequences));
                work::reset();
            }
        }
        for file in growth.get("unusedCases").unwrap().as_array().unwrap() {
            let fixture =
                crate::json::parse(&std::fs::read_to_string(root.join("engine").join(file.as_str().unwrap())).unwrap())
                    .unwrap();
            let source=format!("```jbogenbau\n%stage main\n{}\n%rule unused $x(empty)\n%conditions matches(without-elision($x), empty)\n%rule empty ε\n```\n",fixture.get("grammar").unwrap().as_str().unwrap());
            let dialect = crate::load_dialect_sources([("p.md", source.as_str())], "p.md").unwrap();
            let tokens = fixture
                .get("tokens")
                .and_then(Json::as_array)
                .unwrap_or(&[])
                .iter()
                .map(|t| crate::InputToken {
                    text: t.get("text").and_then(Json::as_str).unwrap_or("").into(),
                    tags: t
                        .get("tags")
                        .and_then(Json::as_array)
                        .unwrap_or(&[])
                        .iter()
                        .map(|t| t.as_str().unwrap().into())
                        .collect(),
                    phonemes: t.get("phonemes").and_then(Json::as_str).map(str::to_owned),
                })
                .collect::<Vec<_>>();
            work::reset();
            work::budget(Work::CloseSequences, 0);
            let result = dialect.parse_tokens(&tokens, &crate::ParseOptions::default()).unwrap();
            assert!(result.ok, "{}: {:?}", file.as_str().unwrap(), result.error);
            assert_eq!(work::counted(Work::CloseSequences), 0);
            let lowered = dialect.lowered_stage(0);
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
                let grammar = if aligned { rules.clone() } else { rules.replace("without-elision($x)", "$x") };
                let source = format!("```jbogenbau\n%stage main\n{grammar}\n```\n");
                let dialect = crate::load_dialect_sources([("p.md", source.as_str())], "p.md").unwrap();
                work::reset();
                work::budget(Work::CloseSequences, budget);
                let result = dialect.parse_tokens(&[], &crate::ParseOptions::default()).unwrap();
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
    pub(crate) captures: crate::fxhash::FxSet<u32>,
    pub(crate) lexical: crate::fxhash::FxSet<String>,
    pub(crate) queries: crate::fxhash::FxMap<u32, Option<crate::fxhash::FxSet<u32>>>,
}

pub(crate) fn local_demands(g: &crate::lower::Lowered) -> Vec<LocalDemand> {
    use crate::lower::{LCond, LEmit, LEmitItem, LTerm, Span};
    fn span(s: &Span, out: &mut LocalDemand) {
        match s {
            Span::WithoutElision(inner) => match &**inner {
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
            Span::Head(s) | Span::Tail(s) | Span::Last(s) | Span::From(s) | Span::After(s) => span(s, out),
            _ => {}
        }
    }
    fn term(t: &LTerm, out: &mut LocalDemand) {
        match t {
            LTerm::TagsRule(s, _) | LTerm::Text(s) | LTerm::Phonemes(s) | LTerm::Tags(s) | LTerm::Classes(s) => {
                span(s, out)
            }
            LTerm::If(c, t) => {
                cond(c, out);
                term(t, out);
            }
            LTerm::Union(ts) | LTerm::Inter(ts) => {
                for t in ts {
                    term(t, out);
                }
            }
            LTerm::Diff(a, b) | LTerm::Split(a, b) => {
                term(a, out);
                term(b, out);
            }
            LTerm::TagOf(t) | LTerm::Classify(t, _) => term(t, out),
            _ => {}
        }
    }
    fn cond(c: &LCond, out: &mut LocalDemand) {
        match c {
            LCond::Matches(s, rule) | LCond::Begins(s, rule) => {
                let aligned = if let Span::From(inner) = s { &**inner } else { s };
                if let Span::WithoutElision(inner) = aligned {
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
            LCond::Initial(s) | LCond::Tree(s, _, _) => span(s, out),
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
    let mut out = vec![LocalDemand::default(); g.prods.len()];
    let mut sources: crate::fxhash::FxMap<(usize, usize), LocalDemand> = crate::fxhash::FxMap::default();
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
                    if let LEmitItem::Cap(_, Some(t), _, _) = e {
                        term(t, d);
                    }
                }
            }
            _ => {}
        }
        for ((production, _, _, _), plan) in &g.ranked.plans {
            if *production == i as u32 {
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
    }
    for (p, d) in g.prods.iter().zip(&mut out) {
        if let Some(shared) = p.slot.as_ref().and_then(|s| sources.get(&s.source)) {
            d.whole |= shared.whole;
            d.lexical.extend(shared.lexical.iter().cloned());
        }
    }
    out
}

#[derive(Default, Clone)]
pub(crate) struct QueryPrefix {
    pub(crate) nullable: bool,
    pub(crate) leading_close: bool,
    pub(crate) first: crate::fxhash::FxSet<u32>,
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
        let dialect = crate::load_dialect_sources([("p.md", source.as_str())], "p.md").unwrap();
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
            let result = dialect.parse(&format!("x{}", "a".repeat(length)), &crate::ParseOptions::default()).unwrap();
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
