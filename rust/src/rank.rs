//! Choosing a parse (engine §6), computed over the packed forest without
//! enumerating derivations.
//!
//! Every node of the forest (an item, a completed item, or the constituents
//! of one rule over one span) gets a short list of *entries*. An entry is a
//! derivation `x` of the node that nothing beats in every context, with the
//! derivations of the node tied with `x` that diverge from it earliest (its
//! *companions*, each with the visible index where it first differs from
//! `x`). Two entries stay separate only while their visible sequences are a
//! prefix one of the other, since which comes first is then decided by what
//! follows them. Derivations are kept as a shared DAG, so comparing two of
//! them walks only where they differ.

use crate::fxhash::FxMap;
use std::cmp::Ordering;

use crate::earley::{Chart, Item, Tok};
use crate::grammar::Lean;
use crate::lower::{Lowered, Sym};
use crate::tags::Tags;

pub(crate) const EMPTY: u32 = 0;
const INF: u32 = u32::MAX;
const ANY: u32 = u32::MAX;

/// A node of a derivation.
#[derive(Debug, Clone, Copy)]
pub(crate) enum DNode {
    Empty,
    Read { tok: u32, terminal: u32, strong: bool },
    Seq { left: u32, right: u32 },
    Close { body: u32, set: u32, item: u32 },
}

/// An action of a derivation's sequence (§6).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Act {
    Read { tok: u32, terminal: u32, strong: bool },
    Close { prod: u32, start: u32, end: u32, visible: bool },
}

impl Act {
    fn same(&self, other: &Act) -> bool {
        match (self, other) {
            (Act::Read { tok: a, terminal: x, .. }, Act::Read { tok: b, terminal: y, .. }) => a == b && x == y,
            (Act::Close { prod: p, start: s, end: e, .. }, Act::Close { prod: q, start: t, end: f, .. }) => {
                p == q && s == t && e == f
            }
            _ => false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Verdict {
    Unique,
    Resolved,
    Tie,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Node {
    Read { tok: u32, terminal: u32 },
    Item { set: u32, index: u32 },
    Close { set: u32, index: u32 },
    Group { rule: u32, origin: u32, set: u32, tags: u32 },
}

type Key = (Node, u32);

#[derive(Debug, Clone)]
struct Comp {
    d: u32,
    div: u32,
}

#[derive(Debug, Clone)]
struct Entry {
    x: u32,
    comps: Vec<Comp>,
}

#[derive(Debug, Clone, Default)]
struct NodeResult {
    entries: Vec<Entry>,
    count: u8,
}

enum Deps {
    Leaf,
    Links(Vec<(Key, Key)>),
    Close(Option<Key>),
    Group(Vec<Key>),
}

enum Walk {
    Node(u32),
    Act(u32),
}

enum Diff {
    At { index: u32, a: Act, b: Act },
    APrefix { len: u32 },
    BPrefix { len: u32 },
    Equal,
}

/// How two derivations of one node relate: `p` is the visible index where
/// the first comes first, and `tie` whether that is a tie (§6).
enum Rel {
    AFirst { p: u32, tie: bool },
    BFirst { p: u32, tie: bool },
    AFirstFull,
    BFirstFull,
    Unresolved,
    Same,
}

/// The outcome of ranking a stage's forest.
pub(crate) struct Ranking {
    pub verdict: Verdict,
    pub chosen: u32,
    pub tied: Option<u32>,
    pub witness: Option<(Act, Act)>,
}

/// A derivation DAG, with what comparing its derivations needs.
pub(crate) struct Dag<'c> {
    g: &'c Lowered,
    chart: &'c mut Chart,
    tokens: &'c [Tok],
    tags: &'c Tags,
    term_tags: &'c [u32],
    lean: Lean,
    pub arena: Vec<DNode>,
    vlen: Vec<u32>,
    flen: Vec<u32>,
}

pub(crate) struct Ranker<'c> {
    pub dag: Dag<'c>,
    memo: FxMap<Key, u32>,
    results: Vec<NodeResult>,
    fsets: Vec<Vec<u32>>,
    fset_index: FxMap<Vec<u32>, u32>,
}

impl<'c> Dag<'c> {
    fn item(&self, set: u32, index: u32) -> Item {
        self.chart.sets[set as usize].items[index as usize]
    }

    fn push(&mut self, node: DNode, vlen: u32, flen: u32) -> u32 {
        self.arena.push(node);
        self.vlen.push(vlen);
        self.flen.push(flen);
        (self.arena.len() - 1) as u32
    }

    fn seq(&mut self, left: u32, right: u32) -> u32 {
        let vlen = self.vlen[left as usize] + self.vlen[right as usize];
        let flen = self.flen[left as usize] + self.flen[right as usize];
        self.push(DNode::Seq { left, right }, vlen, flen)
    }

    fn close(&mut self, body: u32, set: u32, item: u32) -> u32 {
        let visible = self.g.prods[self.chart.sets[set as usize].items[item as usize].prod as usize].visible;
        let vlen = self.vlen[body as usize] + u32::from(visible);
        let flen = self.flen[body as usize] + 1;
        self.push(DNode::Close { body, set, item }, vlen, flen)
    }

    fn close_act(&self, set: u32, item: u32) -> Act {
        let item = self.item(set, item);
        Act::Close { prod: item.prod, start: item.origin, end: set, visible: self.g.prods[item.prod as usize].visible }
    }

    fn product(&mut self, first: &Entry, second: &Entry) -> Entry {
        let x = self.seq(first.x, second.x);
        let mut comps = Vec::new();
        for comp in &first.comps {
            comps.push(Comp { d: self.seq(comp.d, second.x), div: comp.div });
        }
        let offset = self.vlen[first.x as usize];
        for comp in &second.comps {
            let div = if comp.div == INF { INF } else { offset + comp.div };
            comps.push(Comp { d: self.seq(first.x, comp.d), div });
        }
        self.prune(&mut comps);
        Entry { x, comps }
    }

    fn add_entry(&mut self, list: &mut Vec<Entry>, mut new: Entry) {
        let mut lost = false;
        let mut i = 0;
        while i < list.len() {
            match self.relate(new.x, list[i].x) {
                Rel::AFirst { p, tie } => {
                    let loser = list.remove(i);
                    debug_assert!(!lost, "an entry both beats and loses to entries that do not resolve");
                    self.absorb(&mut new, &loser, Some(p), tie);
                }
                Rel::AFirstFull => {
                    let loser = list.remove(i);
                    self.absorb(&mut new, &loser, None, true);
                }
                Rel::BFirst { p, tie } => {
                    let mut winner = list[i].clone();
                    self.absorb(&mut winner, &new, Some(p), tie);
                    list[i] = winner;
                    lost = true;
                    i += 1;
                }
                Rel::BFirstFull => {
                    let mut winner = list[i].clone();
                    self.absorb(&mut winner, &new, None, true);
                    list[i] = winner;
                    lost = true;
                    i += 1;
                }
                Rel::Same => {
                    let mut kept = list[i].clone();
                    kept.comps.extend(new.comps.iter().cloned());
                    self.prune(&mut kept.comps);
                    list[i] = kept;
                    lost = true;
                    i += 1;
                }
                Rel::Unresolved => i += 1,
            }
        }
        if !lost {
            list.push(new);
        }
    }

    /// The winner takes in what of the loser stays tied with it: the loser
    /// itself if their difference was a tie, and the loser's companions that
    /// diverged from it before that difference.
    fn absorb(&mut self, winner: &mut Entry, loser: &Entry, p: Option<u32>, tie: bool) {
        match p {
            Some(p) => {
                if tie {
                    winner.comps.push(Comp { d: loser.x, div: p });
                }
                for comp in &loser.comps {
                    if comp.div < p {
                        winner.comps.push(comp.clone());
                    } else if comp.div == p && !tie {
                        // Beaten at p, the loser's companion that diverged
                        // from it at p can still be tied with the winner
                        // there: under rule 1 alone, a close is tied with a
                        // weak read and with the strong read that beat it.
                        if let Diff::At { index, a, b } = self.first_difference(winner.x, comp.d, true) {
                            let (winner_first, tied) = self.outcome(&a, &b);
                            if tied && winner_first {
                                winner.comps.push(Comp { d: comp.d, div: index });
                            }
                        }
                    }
                }
            }
            None => {
                winner.comps.push(Comp { d: loser.x, div: INF });
                winner.comps.extend(loser.comps.iter().cloned());
            }
        }
        self.prune(&mut winner.comps);
    }

    /// Keeps the companions that diverge earliest, and of those the ones
    /// nothing precedes in every context.
    fn prune(&mut self, comps: &mut Vec<Comp>) {
        let Some(min) = comps.iter().map(|comp| comp.div).min() else {
            return;
        };
        let candidates: Vec<Comp> = comps.drain(..).filter(|comp| comp.div == min).collect();
        let mut kept: Vec<Comp> = Vec::new();
        for comp in candidates {
            let mut dominated = false;
            let mut j = 0;
            while j < kept.len() {
                match self.relate(comp.d, kept[j].d) {
                    Rel::AFirst { .. } | Rel::AFirstFull => {
                        kept.remove(j);
                    }
                    Rel::BFirst { .. } | Rel::BFirstFull | Rel::Same => {
                        dominated = true;
                        break;
                    }
                    Rel::Unresolved => j += 1,
                }
            }
            if !dominated {
                kept.push(comp);
            }
        }
        *comps = kept;
    }

    fn walk_len(&self, walk: &Walk, visible: bool) -> u32 {
        match walk {
            Walk::Node(id) => {
                if visible {
                    self.vlen[*id as usize]
                } else {
                    self.flen[*id as usize]
                }
            }
            Walk::Act(id) => {
                let DNode::Close { set, item, .. } = self.arena[*id as usize] else { unreachable!("a close") };
                match self.close_act(set, item) {
                    Act::Close { visible: false, .. } if visible => 0,
                    _ => 1,
                }
            }
        }
    }

    fn atomic(&self, walk: &Walk) -> Option<Act> {
        match walk {
            Walk::Node(id) => match self.arena[*id as usize] {
                DNode::Read { tok, terminal, strong } => Some(Act::Read { tok, terminal, strong }),
                _ => None,
            },
            Walk::Act(id) => {
                let DNode::Close { set, item, .. } = self.arena[*id as usize] else { unreachable!("a close") };
                Some(self.close_act(set, item))
            }
        }
    }

    fn expand(&self, stack: &mut Vec<Walk>) {
        let Some(Walk::Node(id)) = stack.pop() else { unreachable!("an expandable node") };
        match self.arena[id as usize] {
            DNode::Seq { left, right } => {
                stack.push(Walk::Node(right));
                stack.push(Walk::Node(left));
            }
            DNode::Close { body, .. } => {
                stack.push(Walk::Act(id));
                stack.push(Walk::Node(body));
            }
            _ => unreachable!("an expandable node"),
        }
    }

    /// The first index at which two derivations' sequences differ, visible
    /// actions only or all of them.
    fn first_difference(&self, a: u32, b: u32, visible: bool) -> Diff {
        let mut left = vec![Walk::Node(a)];
        let mut right = vec![Walk::Node(b)];
        let mut index = 0u32;
        loop {
            while left.last().is_some_and(|walk| self.walk_len(walk, visible) == 0) {
                left.pop();
            }
            while right.last().is_some_and(|walk| self.walk_len(walk, visible) == 0) {
                right.pop();
            }
            let (Some(x), Some(y)) = (left.last(), right.last()) else {
                return match (left.is_empty(), right.is_empty()) {
                    (true, true) => Diff::Equal,
                    (true, false) => Diff::APrefix { len: index },
                    _ => Diff::BPrefix { len: index },
                };
            };
            if let (Walk::Node(p), Walk::Node(q)) = (x, y) {
                if p == q {
                    index += self.walk_len(x, visible);
                    left.pop();
                    right.pop();
                    continue;
                }
            }
            let (ax, ay) = (self.atomic(x), self.atomic(y));
            match (ax, ay) {
                (Some(p), Some(q)) => {
                    if p.same(&q) {
                        index += 1;
                        left.pop();
                        right.pop();
                    } else {
                        return Diff::At { index, a: p, b: q };
                    }
                }
                (None, Some(_)) => self.expand(&mut left),
                (Some(_), None) => self.expand(&mut right),
                (None, None) => {
                    if self.walk_len(x, visible) >= self.walk_len(y, visible) {
                        self.expand(&mut left);
                    } else {
                        self.expand(&mut right);
                    }
                }
            }
        }
    }

    fn terminal_name(&self, terminal: u32) -> &str {
        &self.g.terminals[terminal as usize]
    }

    /// Which of two differing visible actions wins (rules 1 to 3), and
    /// whether that is a tie broken by the canonical order: `(a_first, tie)`.
    fn outcome(&self, a: &Act, b: &Act) -> (bool, bool) {
        match (a, b) {
            (Act::Read { terminal: x, strong: s, .. }, Act::Read { terminal: y, strong: t, .. }) => {
                if s != t {
                    (*s, false)
                } else {
                    (self.terminal_name(*x) < self.terminal_name(*y), true)
                }
            }
            (Act::Read { .. }, Act::Close { .. }) => match self.lean {
                Lean::Greedy => (true, false),
                Lean::Lazy => (false, false),
                Lean::TagsOnly => (true, true),
            },
            (Act::Close { .. }, Act::Read { .. }) => match self.lean {
                Lean::Greedy => (false, false),
                Lean::Lazy => (true, false),
                Lean::TagsOnly => (false, true),
            },
            (Act::Close { prod: p, start: s, end: e, .. }, Act::Close { prod: q, start: t, end: f, .. }) => {
                ((p, s, e) < (q, t, f), true)
            }
        }
    }

    /// The canonical order of two differing actions: is `a` first?
    fn canonical(&self, a: &Act, b: &Act) -> bool {
        match (a, b) {
            (Act::Read { terminal: x, .. }, Act::Read { terminal: y, .. }) => {
                self.terminal_name(*x) < self.terminal_name(*y)
            }
            (Act::Read { .. }, Act::Close { .. }) => true,
            (Act::Close { .. }, Act::Read { .. }) => false,
            (Act::Close { prod: p, start: s, end: e, .. }, Act::Close { prod: q, start: t, end: f, .. }) => {
                (p, s, e) < (q, t, f)
            }
        }
    }

    fn relate(&self, a: u32, b: u32) -> Rel {
        if a == b {
            return Rel::Same;
        }
        match self.first_difference(a, b, true) {
            Diff::At { index, a: x, b: y } => {
                let (a_first, tie) = self.outcome(&x, &y);
                if a_first {
                    Rel::AFirst { p: index, tie }
                } else {
                    Rel::BFirst { p: index, tie }
                }
            }
            Diff::APrefix { .. } | Diff::BPrefix { .. } => Rel::Unresolved,
            Diff::Equal => match self.first_difference(a, b, false) {
                Diff::At { a: x, b: y, .. } => {
                    if self.canonical(&x, &y) {
                        Rel::AFirstFull
                    } else {
                        Rel::BFirstFull
                    }
                }
                Diff::Equal => Rel::Same,
                _ => Rel::Unresolved,
            },
        }
    }

    /// The order *T* of whole derivations (§6): is `a` before `b`?
    fn before(&self, a: u32, b: u32) -> bool {
        match self.first_difference(a, b, true) {
            Diff::At { a: x, b: y, .. } => self.outcome(&x, &y).0,
            // A visible prefix comes before its extensions.
            Diff::APrefix { .. } => true,
            Diff::BPrefix { .. } => false,
            Diff::Equal => match self.first_difference(a, b, false) {
                Diff::At { a: x, b: y, .. } => self.canonical(&x, &y),
                Diff::APrefix { .. } => true,
                _ => false,
            },
        }
    }
}

impl<'c> Ranker<'c> {
    pub(crate) fn new(
        g: &'c Lowered,
        chart: &'c mut Chart,
        tokens: &'c [Tok],
        tags: &'c Tags,
        term_tags: &'c [u32],
        lean: Lean,
    ) -> Ranker<'c> {
        let mut dag =
            Dag { g, chart, tokens, tags, term_tags, lean, arena: Vec::new(), vlen: Vec::new(), flen: Vec::new() };
        dag.push(DNode::Empty, 0, 0);
        let mut ranker = Ranker {
            dag,
            memo: FxMap::default(),
            results: Vec::new(),
            fsets: vec![Vec::new()],
            fset_index: FxMap::default(),
        };
        ranker.fset_index.insert(Vec::new(), 0);
        ranker
    }

    pub(crate) fn chart(&self) -> &Chart {
        self.dag.chart
    }

    pub(crate) fn item(&self, set: u32, index: u32) -> Item {
        self.dag.chart.sets[set as usize].items[index as usize]
    }

    fn fset_with(&mut self, fset: u32, rule: u32) -> u32 {
        if !self.dag.g.cyclic[rule as usize] {
            return fset;
        }
        let mut list = self.fsets[fset as usize].clone();
        if let Err(at) = list.binary_search(&rule) {
            list.insert(at, rule);
        }
        if let Some(&id) = self.fset_index.get(&list) {
            return id;
        }
        let id = self.fsets.len() as u32;
        self.fsets.push(list.clone());
        self.fset_index.insert(list, id);
        id
    }

    fn deps(&mut self, (node, fset): Key) -> Deps {
        match node {
            Node::Read { .. } => Deps::Leaf,
            Node::Item { set, index } => {
                let item = self.item(set, index);
                if item.dot == 0 {
                    return Deps::Leaf;
                }
                let production = &self.dag.g.prods[item.prod as usize];
                let position = item.dot as usize - 1;
                let captured = production.cap_at[position].is_some();
                let caps = self.dag.chart.caps(item.caps).to_vec();
                let previous = if captured {
                    match self.dag.chart.lookup_caps(&caps[..caps.len() - 1]) {
                        Some(id) => id,
                        None => return Deps::Links(Vec::new()),
                    }
                } else {
                    item.caps
                };
                let pred = Item { prod: item.prod, dot: item.dot - 1, origin: item.origin, caps: previous };
                let mut links = Vec::new();
                let same = |m: u32, fset: u32| if m == set { fset } else { 0 };
                match production.syms[position] {
                    Sym::T(terminal) => {
                        let m = set - 1;
                        if let Some(p) = self.dag.chart.sets[m as usize].find(&pred) {
                            links.push(((Node::Item { set: m, index: p }, 0), (Node::Read { tok: m, terminal }, 0)));
                        }
                    }
                    Sym::N(rule) => {
                        if captured {
                            let cap = caps[caps.len() - 1];
                            let m = cap.start;
                            if let Some(p) = self.dag.chart.sets[m as usize].find(&pred) {
                                let child = Node::Group { rule, origin: m, set, tags: cap.tags };
                                let child_fset = if m == item.origin { fset } else { 0 };
                                links.push(((Node::Item { set: m, index: p }, same(m, fset)), (child, child_fset)));
                            }
                        } else {
                            let mut origins: Vec<u32> = self.dag.chart.sets[set as usize]
                                .origins
                                .get(&rule)
                                .map(|origins| origins.iter().copied().filter(|&m| m >= item.origin).collect())
                                .unwrap_or_default();
                            origins.sort_unstable();
                            for m in origins {
                                if let Some(p) = self.dag.chart.sets[m as usize].find(&pred) {
                                    let child = Node::Group { rule, origin: m, set, tags: ANY };
                                    let child_fset = if m == item.origin { fset } else { 0 };
                                    links.push(((Node::Item { set: m, index: p }, same(m, fset)), (child, child_fset)));
                                }
                            }
                        }
                    }
                }
                Deps::Links(links)
            }
            Node::Close { set, index } => {
                let item = self.item(set, index);
                let rule = self.dag.g.prods[item.prod as usize].rule;
                if self.fsets[fset as usize].binary_search(&rule).is_ok() {
                    return Deps::Close(None);
                }
                let inner = self.fset_with(fset, rule);
                Deps::Close(Some((Node::Item { set, index }, inner)))
            }
            Node::Group { rule, origin, set, tags } => {
                let eset = &self.dag.chart.sets[set as usize];
                let members = eset
                    .completed
                    .get(&(rule, origin))
                    .map(|items| {
                        items
                            .iter()
                            .filter(|&&index| tags == ANY || eset.tagset[index as usize] == tags)
                            .map(|&index| (Node::Close { set, index }, fset))
                            .collect()
                    })
                    .unwrap_or_default();
                Deps::Group(members)
            }
        }
    }

    fn keys(deps: &Deps) -> Vec<Key> {
        match deps {
            Deps::Leaf | Deps::Close(None) => Vec::new(),
            Deps::Links(links) => links.iter().flat_map(|&(a, b)| [a, b]).collect(),
            Deps::Close(Some(key)) => vec![*key],
            Deps::Group(keys) => keys.clone(),
        }
    }

    fn evaluate(&mut self, root: Key) -> NodeResult {
        let mut stack: Vec<(Key, Option<Deps>)> = vec![(root, None)];
        while let Some((key, deps)) = stack.last_mut() {
            let key = *key;
            if self.memo.contains_key(&key) {
                stack.pop();
                continue;
            }
            if deps.is_none() {
                let found = self.deps(key);
                let missing: Vec<Key> =
                    Self::keys(&found).into_iter().filter(|dep| !self.memo.contains_key(dep)).collect();
                *deps = Some(found);
                for dep in missing.into_iter().rev() {
                    stack.push((dep, None));
                }
                continue;
            }
            let (_, deps) = stack.pop().expect("a frame");
            let result = self.compute(key, deps.expect("dependencies"));
            self.results.push(result);
            self.memo.insert(key, (self.results.len() - 1) as u32);
        }
        self.results[self.memo[&root] as usize].clone()
    }

    fn compute(&mut self, (node, _): Key, deps: Deps) -> NodeResult {
        match deps {
            Deps::Leaf => match node {
                Node::Read { tok, terminal } => {
                    let tag = self.dag.term_tags[terminal as usize];
                    let list = self.dag.tags.list(self.dag.tokens[tok as usize].tags);
                    let strong = list.binary_search_by_key(&tag, |&(id, _)| id).map(|at| list[at].1).unwrap_or(false);
                    let x = self.dag.push(DNode::Read { tok, terminal, strong }, 1, 1);
                    NodeResult { entries: vec![Entry { x, comps: Vec::new() }], count: 1 }
                }
                _ => NodeResult { entries: vec![Entry { x: EMPTY, comps: Vec::new() }], count: 1 },
            },
            Deps::Links(links) => {
                let mut list = Vec::new();
                let mut count = 0u8;
                for (pred, child) in links {
                    let left = &self.results[self.memo[&pred] as usize];
                    let right = &self.results[self.memo[&child] as usize];
                    count = count.saturating_add(left.count.saturating_mul(right.count)).min(2);
                    for first in &left.entries {
                        for second in &right.entries {
                            let entry = self.dag.product(first, second);
                            self.dag.add_entry(&mut list, entry);
                        }
                    }
                }
                NodeResult { entries: list, count }
            }
            Deps::Close(None) => NodeResult::default(),
            Deps::Close(Some(inner)) => {
                let Node::Close { set, index } = node else { unreachable!("a close") };
                let body = &self.results[self.memo[&inner] as usize];
                let mut list = Vec::new();
                for entry in &body.entries {
                    let x = self.dag.close(entry.x, set, index);
                    let comps = entry
                        .comps
                        .iter()
                        .map(|comp| Comp { d: self.dag.close(comp.d, set, index), div: comp.div })
                        .collect();
                    self.dag.add_entry(&mut list, Entry { x, comps });
                }
                NodeResult { entries: list, count: body.count }
            }
            Deps::Group(members) => {
                let mut list = Vec::new();
                let mut count = 0u8;
                for member in members {
                    let result = &self.results[self.memo[&member] as usize];
                    count = count.saturating_add(result.count).min(2);
                    for entry in &result.entries {
                        self.dag.add_entry(&mut list, entry.clone());
                    }
                }
                NodeResult { entries: list, count }
            }
        }
    }

    /// Ranks the derivations of the start rule over the whole input; `None`
    /// if it has none (every one is cyclic).
    pub(crate) fn rank(&mut self) -> Option<Ranking> {
        let n = (self.dag.chart.sets.len() - 1) as u32;
        let root = (Node::Group { rule: self.dag.g.start, origin: 0, set: n, tags: ANY }, 0);
        let result = self.evaluate(root);
        if result.count == 0 || result.entries.is_empty() {
            return None;
        }
        let mut chosen = result.entries[0].x;
        for entry in &result.entries[1..] {
            if self.dag.before(entry.x, chosen) {
                chosen = entry.x;
            }
        }
        let mut candidates: Vec<u32> = Vec::new();
        for entry in &result.entries {
            if entry.x != chosen {
                candidates.push(entry.x);
            }
            candidates.extend(entry.comps.iter().map(|comp| comp.d));
        }
        // The derivation tied with the chosen one that diverges from it
        // earliest, and of those the first in T.
        let mut tied: Option<(u32, u32)> = None;
        for d in candidates {
            let div = match self.dag.first_difference(chosen, d, true) {
                Diff::At { index, a, b } => {
                    let (_, tie) = self.dag.outcome(&a, &b);
                    if !tie {
                        continue;
                    }
                    index
                }
                Diff::APrefix { len } | Diff::BPrefix { len } => len,
                Diff::Equal => match self.dag.first_difference(chosen, d, false) {
                    Diff::Equal => continue,
                    _ => INF,
                },
            };
            let better = match tied {
                None => true,
                Some((best, best_div)) => match div.cmp(&best_div) {
                    Ordering::Less => true,
                    Ordering::Greater => false,
                    Ordering::Equal => self.dag.before(d, best),
                },
            };
            if better {
                tied = Some((d, div));
            }
        }
        let verdict = if result.count == 1 {
            Verdict::Unique
        } else if tied.is_some() {
            Verdict::Tie
        } else {
            Verdict::Resolved
        };
        let witness = tied.map(|(t, _)| match self.dag.first_difference(chosen, t, true) {
            Diff::At { a, b, .. } => (a, b),
            _ => match self.dag.first_difference(chosen, t, false) {
                Diff::At { a, b, .. } => (a, b),
                _ => unreachable!("two different derivations differ"),
            },
        });
        Some(Ranking { verdict, chosen, tied: tied.map(|(t, _)| t), witness })
    }
}
