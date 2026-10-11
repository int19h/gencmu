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

/// Each prefix keeps one parent link and one event, never a flattened copy.
#[derive(Debug)]
struct Sequence<T> {
    nodes: Vec<Option<(u32, T)>>,
    index: FxMap<(u32, T), u32>,
    joins: FxMap<(u32, u32), u32>,
}
impl<T: Clone + Eq + std::hash::Hash> Sequence<T> {
    fn new() -> Self {
        Self { nodes: vec![None], index: FxMap::default(), joins: FxMap::default() }
    }
    fn append(&mut self, parent: u32, event: T) -> u32 {
        let key = (parent, event);
        if let Some(&id) = self.index.get(&key) {
            return id;
        }
        let id = self.nodes.len() as u32;
        self.nodes.push(Some(key.clone()));
        self.index.insert(key, id);
        id
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
        let mut parts = Vec::new();
        let mut at = right;
        while let Some((parent, event)) = &self.nodes[at as usize] {
            parts.push(event.clone());
            at = *parent;
        }
        let mut id = left;
        for event in parts.into_iter().rev() {
            id = self.append(id, event);
        }
        self.joins.insert((left, right), id);
        id
    }
    #[cfg(test)]
    fn values(&self, mut id: u32) -> Vec<&T> {
        let mut out = Vec::new();
        while let Some((parent, event)) = &self.nodes[id as usize] {
            out.push(event);
            id = *parent;
        }
        out.reverse();
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
    pub(crate) fn aligns(&self, candidate: u32, witness: u32, end: usize) -> bool {
        if candidate == INVALID || witness == INVALID {
            return false;
        }
        let bounded = |mut id: u32| {
            while let Some((parent, event)) = &self.aligned.nodes[id as usize] {
                let after = match event {
                    Aligned::Close(_, at) => *at > end,
                    Aligned::Block(block) if block.start > end || block.start == end && block.end > end => true,
                    Aligned::Block(block) if block.end > end => return None,
                    _ => false,
                };
                if !after {
                    break;
                }
                id = *parent;
            }
            Some(id)
        };
        match (bounded(self.normalized(candidate)), bounded(self.normalized(witness))) {
            (Some(a), Some(b)) => a == b,
            _ => false,
        }
    }
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
}
