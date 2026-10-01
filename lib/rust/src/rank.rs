//! Choosing a parse (engine §6), computed over the packed forest without
//! enumerating derivations.
//!
//! Under `late-elision`, a first pass gives every node of the forest, in
//! each of its contexts, a *summary*: the least elision vector of its
//! derivations, how many derivations attain it, how many there are in all,
//! and which of its edges attain it. The entries below are then computed
//! with no lean over only those edges, the forest of the best derivations.
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

use crate::earley::{test_holds, Chart, Item, Shared, Tok};
use crate::grammar::Lean;
use crate::lower::{Lowered, Sym, SymbolTest, NO_TEST};
use crate::maximal::Maximal;
use crate::tags::{SetId, Tags};
use crate::unicode::Unicode;

pub(crate) const EMPTY: u32 = 0;
const INF: u32 = u32::MAX;
const ANY: u32 = u32::MAX;

/// A node of a derivation.
#[derive(Debug, Clone, Copy)]
pub(crate) enum DNode {
    Empty,
    Read { tok: u32, terminal: u32 },
    Seq { left: u32, right: u32 },
    Close { body: u32, set: u32, item: u32 },
}

/// An action of a derivation's sequence (§6).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Act {
    Read { tok: u32, terminal: u32 },
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
    Read {
        tok: u32,
        terminal: u32,
    },
    Item {
        set: u32,
        index: u32,
    },
    Close {
        set: u32,
        index: u32,
    },
    /// The completed items of `rule` from `origin` in `set`: those with the
    /// tag set `tags`, or any; and those that the test `test` holds of, or
    /// any where it is `NO_TEST`.
    Group {
        rule: u32,
        origin: u32,
        set: u32,
        tags: u32,
        test: u32,
    },
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
    /// Under `maximal` (§4, §6), for an item whose next symbol is an
    /// elidable optional: the entries and count of only its derivations an
    /// elided terminator may follow; `None` where those are all of them.
    allowed: Option<Box<NodeResult>>,
}

impl NodeResult {
    /// The entries and count of the derivations an elided terminator may
    /// follow.
    fn allowed(&self) -> &NodeResult {
        self.allowed.as_deref().unwrap_or(self)
    }
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

/// The outcome of ranking a stage's forest: the verdict, the first
/// reading `m`, which is the chosen derivation unless the verdict is a tie,
/// and for a tie the second reading `t` and the witness (§6).
pub(crate) struct Ranking {
    pub verdict: Verdict,
    pub first: u32,
    pub second: Option<u32>,
    pub witness: Option<(Act, Act)>,
}

/// Elision vectors (§6), each kept as the positions of its elided
/// terminators in text order. A vector is a node of a shared tree whose
/// leaves are positions, so the vector of an edge is the two of its
/// children joined, and vectors built on one part share it.
struct Vectors {
    nodes: Vec<VNode>,
    leaves: FxMap<u32, u32>,
}

#[derive(Debug, Clone, Copy)]
enum VNode {
    Empty,
    At(u32),
    Join { left: u32, right: u32, size: u32 },
}

/// The vector with no elided terminator.
const NO_ELISIONS: u32 = 0;

impl Vectors {
    fn new() -> Vectors {
        Vectors { nodes: vec![VNode::Empty], leaves: FxMap::default() }
    }

    fn size(&self, vector: u32) -> u32 {
        match self.nodes[vector as usize] {
            VNode::Empty => 0,
            VNode::At(_) => 1,
            VNode::Join { size, .. } => size,
        }
    }

    /// The vector of one terminator elided at `position`.
    fn one(&mut self, position: u32) -> u32 {
        if let Some(&found) = self.leaves.get(&position) {
            return found;
        }
        self.nodes.push(VNode::At(position));
        let id = (self.nodes.len() - 1) as u32;
        self.leaves.insert(position, id);
        id
    }

    /// The sum of two vectors, where every position of `left` comes before
    /// or at every position of `right`.
    fn join(&mut self, left: u32, right: u32) -> u32 {
        let size = self.size(left) + self.size(right);
        if self.size(left) == 0 {
            return right;
        }
        if self.size(right) == 0 {
            return left;
        }
        self.nodes.push(VNode::Join { left, right, size });
        (self.nodes.len() - 1) as u32
    }

    /// Compares two vectors from boundary 0 on: `Less` when `a` is less.
    /// At the first place where their positions differ, the one that
    /// elides at the earlier position has the greater count there, so the
    /// other is less. A vector whose positions end first has fewer elided
    /// terminators after the shared part, so it is less.
    fn compare(&self, a: u32, b: u32) -> Ordering {
        let mut left = vec![a];
        let mut right = vec![b];
        loop {
            while left.last().is_some_and(|&v| self.size(v) == 0) {
                left.pop();
            }
            while right.last().is_some_and(|&v| self.size(v) == 0) {
                right.pop();
            }
            let (x, y) = match (left.last(), right.last()) {
                (None, None) => return Ordering::Equal,
                (None, Some(_)) => return Ordering::Less,
                (Some(_), None) => return Ordering::Greater,
                (Some(&x), Some(&y)) => (x, y),
            };
            if x == y {
                left.pop();
                right.pop();
                continue;
            }
            match (self.nodes[x as usize], self.nodes[y as usize]) {
                (VNode::At(p), VNode::At(q)) => {
                    if p != q {
                        return q.cmp(&p);
                    }
                    left.pop();
                    right.pop();
                }
                (nx, ny) => {
                    // Opens the larger side first, so that a part both share
                    // meets itself at the front of both.
                    let (sx, sy) = (self.size(x), self.size(y));
                    if let VNode::Join { left: l, right: r, .. } = nx {
                        if !matches!(ny, VNode::Join { .. }) || sx >= sy {
                            left.pop();
                            left.push(r);
                            left.push(l);
                        }
                    }
                    if let VNode::Join { left: l, right: r, .. } = ny {
                        if !matches!(nx, VNode::Join { .. }) || sy >= sx {
                            right.pop();
                            right.push(r);
                            right.push(l);
                        }
                    }
                }
            }
        }
    }
}

/// Under `late-elision`, the derivations of a node in one context, one
/// eligibility: the least vector, the number of derivations that attain it
/// and the number of all of them, both capped at two, and the edges that
/// attain it (§6). A total of zero means no derivation.
#[derive(Debug, Clone)]
struct Least {
    vector: u32,
    least: u8,
    total: u8,
    kept: Vec<u32>,
}

impl Least {
    const NONE: Least = Least { vector: NO_ELISIONS, least: 0, total: 0, kept: Vec::new() };

    fn one(vector: u32) -> Least {
        Least { vector, least: 1, total: 1, kept: vec![0] }
    }

    /// Adds the derivations of the edge `index`. The total counts every
    /// edge, losing ones included; the least count and the kept edges
    /// count only those that attain the least vector.
    fn add(&mut self, vectors: &Vectors, index: u32, edge: &Least) {
        if edge.total == 0 {
            return;
        }
        self.total = self.total.saturating_add(edge.total).min(2);
        let order = if self.least == 0 { Ordering::Less } else { vectors.compare(edge.vector, self.vector) };
        match order {
            Ordering::Less => {
                self.vector = edge.vector;
                self.least = edge.least;
                self.kept = vec![index];
            }
            Ordering::Equal => {
                self.least = self.least.saturating_add(edge.least).min(2);
                self.kept.push(index);
            }
            Ordering::Greater => {}
        }
    }

    fn keeps(&self, index: u32) -> bool {
        self.kept.contains(&index)
    }
}

/// A node's summaries in one context: over all its derivations, and,
/// under `maximal`, for an item whose next symbol is an elidable optional,
/// over only those an elided terminator may follow.
#[derive(Debug, Clone)]
struct Summary {
    all: Least,
    allowed: Option<Least>,
}

impl Summary {
    fn allowed(&self) -> &Least {
        self.allowed.as_ref().unwrap_or(&self.all)
    }

    /// Whether the edge `index` leads to a best derivation in either
    /// eligibility.
    fn keeps(&self, index: u32) -> bool {
        self.all.keeps(index) || self.allowed.as_ref().is_some_and(|allowed| allowed.keeps(index))
    }
}

/// What `late-elision` keeps beside the entries.
struct Elisions {
    vectors: Vectors,
    summaries: FxMap<Key, Summary>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Pass {
    Summaries,
    Entries,
}

/// A derivation DAG, with what comparing its derivations needs.
pub(crate) struct Dag<'c> {
    g: &'c Lowered,
    chart: &'c Chart,
    tokens: &'c [Tok],
    /// The table of the canonical sound and the tag table that the tests of
    /// symbols read (§4, §5).
    unicode: &'c Unicode,
    tags: &'c Tags,
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
    /// The resolution's `maximal`, if it has it (§4).
    maximal: Option<&'c Maximal<'c>>,
    /// Under `late-elision`, the vectors and the summaries.
    elisions: Option<Elisions>,
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
                // A companion that diverged from the loser where the winner
                // beat it is beaten there too, since ties are transitive.
                for comp in &loser.comps {
                    if comp.div < p {
                        winner.comps.push(comp.clone());
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
                DNode::Read { tok, terminal } => Some(Act::Read { tok, terminal }),
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
            // Two reads of one token as different terminals are tied (§6).
            (Act::Read { terminal: x, .. }, Act::Read { terminal: y, .. }) => {
                (self.terminal_name(*x) < self.terminal_name(*y), true)
            }
            (Act::Read { .. }, Act::Close { .. }) => match self.lean {
                Lean::Greedy => (true, false),
                Lean::Lazy => (false, false),
                Lean::Neither => (true, true),
                Lean::LateElision => unreachable!("late-elision compares actions with no lean"),
            },
            (Act::Close { .. }, Act::Read { .. }) => match self.lean {
                Lean::Greedy => (false, false),
                Lean::Lazy => (true, false),
                Lean::Neither => (false, true),
                Lean::LateElision => unreachable!("late-elision compares actions with no lean"),
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
        chart: &'c Chart,
        tokens: &'c [Tok],
        shared: &'c Shared<'c>,
        lean: Lean,
        maximal: Option<&'c Maximal<'c>>,
    ) -> Ranker<'c> {
        // Under late-elision, the readings come from a ranking with no lean
        // over the forest of the best derivations (§6).
        let late = lean == Lean::LateElision;
        let lean = if late { Lean::Neither } else { lean };
        let mut dag = Dag {
            g,
            chart,
            tokens,
            unicode: shared.unicode,
            tags: &shared.tags,
            lean,
            arena: Vec::new(),
            vlen: Vec::new(),
            flen: Vec::new(),
        };
        dag.push(DNode::Empty, 0, 0);
        let mut ranker = Ranker {
            dag,
            memo: FxMap::default(),
            results: Vec::new(),
            fsets: vec![Vec::new()],
            fset_index: FxMap::default(),
            maximal,
            elisions: late.then(|| Elisions { vectors: Vectors::new(), summaries: FxMap::default() }),
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
                // The predecessors are rebuilt from completed spans, so a
                // tested symbol's test is applied again, to the candidate
                // constituent itself, with its own span and its own tags: a
                // derivation is made only of advances the test allowed (§4).
                let test_id = production.test(position).unwrap_or(NO_TEST);
                let test = self.dag.g.test(item.prod, position);
                let (tokens, unicode, tags) = (self.dag.tokens, self.dag.unicode, self.dag.tags);
                let holds = |m: u32, own: SetId| {
                    test.map_or(true, |test| test_holds(test, &tokens[m as usize..set as usize], unicode, tags, own))
                };
                match production.syms[position] {
                    Sym::T(terminal) => {
                        let m = set - 1;
                        let own = tokens[m as usize].tags;
                        if let Some(p) = self.dag.chart.sets[m as usize].find(&pred).filter(|_| holds(m, own)) {
                            links.push(((Node::Item { set: m, index: p }, 0), (Node::Read { tok: m, terminal }, 0)));
                        }
                    }
                    Sym::N(rule) => {
                        if captured {
                            let cap = caps[caps.len() - 1];
                            let m = cap.start;
                            if let Some(p) = self.dag.chart.sets[m as usize].find(&pred).filter(|_| holds(m, cap.tags))
                            {
                                let child = Node::Group { rule, origin: m, set, tags: cap.tags, test: NO_TEST };
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
                            let eset = &self.dag.chart.sets[set as usize];
                            for m in origins {
                                // Two completed items over one span can have
                                // different tag sets, and a tag test can hold
                                // of one of them alone.
                                let passes = test.is_none()
                                    || eset.completed.get(&(rule, m)).is_some_and(|items| {
                                        items.iter().any(|&index| holds(m, eset.tagset[index as usize]))
                                    });
                                if let Some(p) = self.dag.chart.sets[m as usize].find(&pred).filter(|_| passes) {
                                    let child = Node::Group { rule, origin: m, set, tags: ANY, test: test_id };
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
            Node::Group { rule, origin, set, tags, test } => {
                let eset = &self.dag.chart.sets[set as usize];
                let test = (test != NO_TEST).then(|| &self.dag.g.tests[test as usize]);
                let span = &self.dag.tokens[origin as usize..set as usize];
                let (unicode, tag_table) = (self.dag.unicode, self.dag.tags);
                let members = eset
                    .completed
                    .get(&(rule, origin))
                    .map(|items| {
                        items
                            .iter()
                            .filter(|&&index| tags == ANY || eset.tagset[index as usize] == tags)
                            .filter(|&&index| {
                                test.map_or(true, |test| {
                                    test_holds(test, span, unicode, tag_table, eset.tagset[index as usize])
                                })
                            })
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

    /// Computes what `pass` needs of `root` and of every node it depends
    /// on, each once.
    fn traverse(&mut self, root: Key, pass: Pass) {
        let mut stack: Vec<(Key, Option<Deps>)> = vec![(root, None)];
        while let Some((key, deps)) = stack.last_mut() {
            let key = *key;
            if self.done(pass, &key) {
                stack.pop();
                continue;
            }
            if deps.is_none() {
                let found = self.deps(key);
                let missing: Vec<Key> =
                    self.needed(pass, &key, &found).into_iter().filter(|dep| !self.done(pass, dep)).collect();
                *deps = Some(found);
                for dep in missing.into_iter().rev() {
                    stack.push((dep, None));
                }
                continue;
            }
            let (_, deps) = stack.pop().expect("a frame");
            let deps = deps.expect("dependencies");
            match pass {
                Pass::Summaries => {
                    let summary = self.summarize(key, &deps);
                    self.elisions.as_mut().expect("late-elision").summaries.insert(key, summary);
                }
                Pass::Entries => {
                    let result = self.compute(key, deps);
                    self.results.push(result);
                    self.memo.insert(key, (self.results.len() - 1) as u32);
                }
            }
        }
    }

    fn done(&self, pass: Pass, key: &Key) -> bool {
        match pass {
            Pass::Summaries => self.elisions.as_ref().is_some_and(|elisions| elisions.summaries.contains_key(key)),
            Pass::Entries => self.memo.contains_key(key),
        }
    }

    /// The nodes that `pass` needs before `key`: every dependency, except
    /// that under late-elision the entries need only those of the edges
    /// that attain a least vector.
    fn needed(&self, pass: Pass, key: &Key, deps: &Deps) -> Vec<Key> {
        let summary = match (pass, &self.elisions) {
            (Pass::Entries, Some(elisions)) => &elisions.summaries[key],
            _ => return Self::keys(deps),
        };
        match deps {
            Deps::Leaf | Deps::Close(None) => Vec::new(),
            Deps::Links(links) => {
                (0..).zip(links).filter(|&(index, _)| summary.keeps(index)).flat_map(|(_, &(a, b))| [a, b]).collect()
            }
            Deps::Close(Some(key)) => {
                if summary.all.total > 0 {
                    vec![*key]
                } else {
                    Vec::new()
                }
            }
            Deps::Group(keys) => (0..).zip(keys).filter(|&(index, _)| summary.keeps(index)).map(|(_, &k)| k).collect(),
        }
    }

    /// For an item, whether `maximal` guards it, and the test of the symbol
    /// whose constituent an elided terminator follows, if it is tested (§4).
    fn guard(&self, set: u32, index: u32) -> (bool, Option<&'c SymbolTest>) {
        let item = self.item(set, index);
        let guarded = self.maximal.is_some_and(|maximal| maximal.guards(&item));
        let g: &'c Lowered = self.dag.g;
        (guarded, if guarded { g.test(item.prod, item.dot as usize - 1) } else { None })
    }

    /// Of a link to `child`: whether the child is an elided terminator, and
    /// whether `maximal` lets an elided terminator follow it.
    fn eligibility(&self, child: Node, guarded: bool, test: Option<&SymbolTest>) -> (bool, bool) {
        match (self.maximal, child) {
            (Some(maximal), Node::Group { rule, origin, set: end, .. }) => {
                (maximal.elided(rule, origin, end), !guarded || !maximal.forbids(rule, origin, end, test))
            }
            _ => (false, true),
        }
    }

    /// The summary of a node under late-elision, from those of its
    /// dependencies (§6).
    fn summarize(&mut self, (node, _): Key, deps: &Deps) -> Summary {
        let plain = |all: Least| Summary { all, allowed: None };
        match deps {
            Deps::Leaf => plain(Least::one(NO_ELISIONS)),
            Deps::Close(None) => plain(Least::NONE),
            Deps::Close(Some(inner)) => {
                let Node::Close { set, index } = node else { unreachable!("a close") };
                let g = self.dag.g;
                let production = &g.prods[self.item(set, index).prod as usize];
                // The helper of an elidable optional that derives ε elides
                // its terminator where it is empty.
                let elides = production.syms.is_empty() && g.rules[production.rule as usize].elided.is_some();
                let elisions = self.elisions.as_mut().expect("late-elision");
                let body = &elisions.summaries[inner].all;
                if body.total == 0 {
                    return plain(Least::NONE);
                }
                let (least, total, vector) = (body.least, body.total, body.vector);
                let vector = if elides {
                    let one = elisions.vectors.one(set);
                    elisions.vectors.join(vector, one)
                } else {
                    vector
                };
                plain(Least { vector, least, total, kept: vec![0] })
            }
            Deps::Links(links) => {
                let Node::Item { set, index } = node else { unreachable!("an item") };
                let (guarded, test) = self.guard(set, index);
                let classes: Vec<(bool, bool)> =
                    links.iter().map(|&(_, child)| self.eligibility(child.0, guarded, test)).collect();
                let elisions = self.elisions.as_mut().expect("late-elision");
                let mut all = Least::NONE;
                let mut allowed = Least::NONE;
                for ((index, &(pred, child)), (elided, permitted)) in (0..).zip(links).zip(classes) {
                    let left = &elisions.summaries[&pred];
                    let left = if elided { left.allowed() } else { &left.all };
                    let right = &elisions.summaries[&child].all;
                    if left.total == 0 || right.total == 0 {
                        continue;
                    }
                    let (vector_left, vector_right) = (left.vector, right.vector);
                    let least = left.least.saturating_mul(right.least).min(2);
                    let total = left.total.saturating_mul(right.total).min(2);
                    let vector = elisions.vectors.join(vector_left, vector_right);
                    let edge = Least { vector, least, total, kept: Vec::new() };
                    all.add(&elisions.vectors, index, &edge);
                    if guarded && permitted {
                        allowed.add(&elisions.vectors, index, &edge);
                    }
                }
                Summary { all, allowed: guarded.then_some(allowed) }
            }
            Deps::Group(members) => {
                let elisions = self.elisions.as_ref().expect("late-elision");
                let mut all = Least::NONE;
                for (index, member) in (0..).zip(members) {
                    all.add(&elisions.vectors, index, &elisions.summaries[member].all);
                }
                plain(all)
            }
        }
    }

    /// Which edges of a node the entries take in, in each eligibility:
    /// under late-elision, those that attain the least vector (§6), and
    /// otherwise every edge.
    fn kept(&self, key: &Key) -> Option<(Vec<u32>, Option<Vec<u32>>)> {
        let summary = &self.elisions.as_ref()?.summaries[key];
        Some((summary.all.kept.clone(), summary.allowed.as_ref().map(|allowed| allowed.kept.clone())))
    }

    fn compute(&mut self, key: Key, deps: Deps) -> NodeResult {
        let (node, _) = key;
        let kept = self.kept(&key);
        let in_all = |index: u32| kept.as_ref().map_or(true, |(all, _)| all.contains(&index));
        let in_allowed =
            |index: u32| kept.as_ref().map_or(true, |(all, allowed)| allowed.as_ref().unwrap_or(all).contains(&index));
        match deps {
            Deps::Leaf => match node {
                Node::Read { tok, terminal } => {
                    let x = self.dag.push(DNode::Read { tok, terminal }, 1, 1);
                    NodeResult { entries: vec![Entry { x, comps: Vec::new() }], count: 1, allowed: None }
                }
                _ => NodeResult { entries: vec![Entry { x: EMPTY, comps: Vec::new() }], count: 1, allowed: None },
            },
            Deps::Links(links) => {
                // Under `maximal` (§4, §6), an item whose next symbol is an
                // elidable optional keeps its entries and count twice: over
                // all its links, and over only those whose last symbol's
                // node `maximal` does not forbid, which an elided terminator
                // may follow. A link over an elided terminator takes the
                // second of the item before it.
                let Node::Item { set, index } = node else { unreachable!("an item") };
                let (guarded, test) = self.guard(set, index);
                let mut all = NodeResult::default();
                let mut allowed = NodeResult::default();
                for (number, (pred, child)) in (0..).zip(links) {
                    let (to_all, to_allowed) = (in_all(number), in_allowed(number));
                    if !to_all && !to_allowed {
                        continue;
                    }
                    let (elided, permitted) = self.eligibility(child.0, guarded, test);
                    let left = &self.results[self.memo[&pred] as usize];
                    let left = if elided { left.allowed() } else { left };
                    let right = &self.results[self.memo[&child] as usize];
                    let ways = left.count.saturating_mul(right.count);
                    let kept = guarded && permitted && to_allowed;
                    if to_all {
                        all.count = all.count.saturating_add(ways).min(2);
                    }
                    if kept {
                        allowed.count = allowed.count.saturating_add(ways).min(2);
                    }
                    for first in &left.entries {
                        for second in &right.entries {
                            let entry = self.dag.product(first, second);
                            if kept {
                                self.dag.add_entry(&mut allowed.entries, entry.clone());
                            }
                            if to_all {
                                self.dag.add_entry(&mut all.entries, entry);
                            }
                        }
                    }
                }
                if guarded {
                    all.allowed = Some(Box::new(allowed));
                }
                all
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
                NodeResult { entries: list, count: body.count, allowed: None }
            }
            Deps::Group(members) => {
                let mut list = Vec::new();
                let mut count = 0u8;
                for (number, member) in (0..).zip(members) {
                    if !in_all(number) {
                        continue;
                    }
                    let result = &self.results[self.memo[&member] as usize];
                    count = count.saturating_add(result.count).min(2);
                    for entry in &result.entries {
                        self.dag.add_entry(&mut list, entry.clone());
                    }
                }
                NodeResult { entries: list, count, allowed: None }
            }
        }
    }

    /// Ranks the derivations of the start rule over the whole input; `None`
    /// if it has none (every one is cyclic).
    pub(crate) fn rank(&mut self) -> Option<Ranking> {
        let n = (self.dag.chart.sets.len() - 1) as u32;
        // Every completed item of the start rule over the whole input is an
        // edge of one root (§6).
        let root = (Node::Group { rule: self.dag.g.start, origin: 0, set: n, tags: ANY, test: NO_TEST }, 0);
        // Under late-elision, the total and the least count of the root,
        // before the forest is cut down to the best derivations.
        let counts = if self.elisions.is_some() {
            self.traverse(root, Pass::Summaries);
            let root = &self.elisions.as_ref().expect("late-elision").summaries[&root].all;
            Some((root.total, root.least))
        } else {
            None
        };
        self.traverse(root, Pass::Entries);
        let result = &self.results[self.memo[&root] as usize];
        let total = counts.map_or(result.count, |(total, _)| total);
        if total == 0 || result.entries.is_empty() {
            return None;
        }
        let result = result.clone();
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
        // Under late-elision, the forest of the best derivations holds a
        // second one exactly when the least count is two.
        if let Some((_, least)) = counts {
            debug_assert_eq!(least >= 2, tied.is_some(), "the least count disagrees with the forest of the best");
        }
        let verdict = if total == 1 {
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
        Some(Ranking { verdict, first: chosen, second: tied.map(|(t, _)| t), witness })
    }
}
