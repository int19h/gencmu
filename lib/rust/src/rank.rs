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
use crate::lower::{Lowered, Sym, NO_TEST};
use crate::maximal::Maximal;
use crate::nat::Nat;
use crate::tags::{SetId, Tags};
use crate::unicode::Unicode;
use crate::witness::{self, Fault, Marks, WitnessAct};
use crate::work::{self, Work};

pub(crate) const EMPTY: u32 = 0;
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

/// Where a companion first differs from its entry: at a place of the
/// visible sequence, or only in transparent actions, which is after every
/// place. A place can pass any fixed width, so it is exact.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Div {
    At(Nat),
    Last,
}

#[derive(Debug, Clone)]
struct Comp {
    d: u32,
    div: Div,
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
    /// With the witness hook's marks, whether `count` includes a derivation
    /// made of marked links only (tests/README.md). The same loop decides
    /// both, so any choice that drops W(D) from the count drops it here.
    w: bool,
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
    At { index: Nat, a: Act, b: Act },
    APrefix { len: Nat },
    BPrefix { len: Nat },
    Equal,
}

/// How two derivations of one node relate: `p` is the visible index where
/// the first comes first, and `tie` whether that is a tie (§6).
enum Rel {
    AFirst { p: Nat, tie: bool },
    BFirst { p: Nat, tie: bool },
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
    /// With the witness hook's marks, whether the count counted W(D): the
    /// root has the bit (tests/README.md).
    pub witness_counted: Option<bool>,
}

/// Elision vectors (§6), each kept as the positions of its elided
/// terminators in text order. A vector is a node of a shared tree whose
/// leaves are runs, a position with the number of terminators elided there,
/// so the vector of an edge is the two of its children joined, and vectors
/// built on one part share it. A count at one boundary can be exponential
/// in the size of the grammar, so it is an exact `Nat`.
struct Vectors {
    nodes: Vec<VNode>,
    leaves: FxMap<u32, u32>,
}

#[derive(Debug, Clone)]
enum VNode {
    Empty,
    /// `count` terminators elided at `at`.
    Run {
        at: u32,
        count: Nat,
    },
    /// Two vectors, where every position of `left` comes before or at every
    /// position of `right`, and the two span more than one position. `hint`
    /// is the number of elided terminators, saturated, which only guides
    /// the comparison.
    Join {
        left: u32,
        right: u32,
        hint: u64,
    },
}

/// The vector with no elided terminator.
const NO_ELISIONS: u32 = 0;

impl Vectors {
    fn new() -> Vectors {
        Vectors { nodes: vec![VNode::Empty], leaves: FxMap::default() }
    }

    fn hint(&self, vector: u32) -> u64 {
        match &self.nodes[vector as usize] {
            VNode::Empty => 0,
            VNode::Run { count, .. } => count.saturated(),
            VNode::Join { hint, .. } => *hint,
        }
    }

    fn push(&mut self, node: VNode) -> u32 {
        self.nodes.push(node);
        (self.nodes.len() - 1) as u32
    }

    /// The vector of one terminator elided at `position`.
    fn one(&mut self, position: u32) -> u32 {
        if let Some(&found) = self.leaves.get(&position) {
            return found;
        }
        let id = self.push(VNode::Run { at: position, count: Nat::ONE });
        self.leaves.insert(position, id);
        id
    }

    /// The sum of two vectors, where every position of `left` comes before
    /// or at every position of `right`. Two runs at one position make one
    /// run, so every vector of a single position is a run.
    fn join(&mut self, left: u32, right: u32) -> u32 {
        match (&self.nodes[left as usize], &self.nodes[right as usize]) {
            (VNode::Empty, _) => right,
            (_, VNode::Empty) => left,
            (VNode::Run { at: p, count: a }, VNode::Run { at: q, count: b }) if p == q => {
                let run = VNode::Run { at: *p, count: a.add(b) };
                self.push(run)
            }
            _ => {
                let hint = self.hint(left).saturating_add(self.hint(right));
                self.push(VNode::Join { left, right, hint })
            }
        }
    }

    /// The next run of a walk, opening joins.
    fn next_run(&self, stack: &mut Vec<u32>) -> Option<(u32, Nat)> {
        while let Some(top) = stack.pop() {
            match &self.nodes[top as usize] {
                VNode::Empty => {}
                VNode::Run { at, count } => return Some((*at, count.clone())),
                VNode::Join { left, right, .. } => {
                    stack.push(*right);
                    stack.push(*left);
                }
            }
        }
        None
    }

    /// Compares two vectors from boundary 0 on: `Less` when `a` is less.
    /// The walk takes the runs of both in text order. Where two runs have
    /// one position, the smaller count is used up first, and the rest of
    /// the other stays. At the first place where their positions differ,
    /// the one that elides at the earlier position has the greater count
    /// there, so the other is less. A vector whose runs end first has fewer
    /// elided terminators after the shared part, so it is less.
    fn compare(&self, a: u32, b: u32) -> Ordering {
        let mut left = vec![a];
        let mut right = vec![b];
        // The rest of a run that the other side has used up in part.
        let mut rest_left: Option<(u32, Nat)> = None;
        let mut rest_right: Option<(u32, Nat)> = None;
        loop {
            if rest_left.is_none() && rest_right.is_none() {
                while left.last().is_some_and(|&v| matches!(self.nodes[v as usize], VNode::Empty)) {
                    left.pop();
                }
                while right.last().is_some_and(|&v| matches!(self.nodes[v as usize], VNode::Empty)) {
                    right.pop();
                }
                match (left.last(), right.last()) {
                    (None, None) => return Ordering::Equal,
                    (None, Some(_)) => return Ordering::Less,
                    (Some(_), None) => return Ordering::Greater,
                    (Some(&x), Some(&y)) => {
                        // A part both share counts the same on both sides.
                        if x == y {
                            left.pop();
                            right.pop();
                            continue;
                        }
                        // Opens the larger side first, so that a part both
                        // share meets itself at the front of both.
                        let (nx, ny) = (&self.nodes[x as usize], &self.nodes[y as usize]);
                        let (hx, hy) = (self.hint(x), self.hint(y));
                        let (jx, jy) = (matches!(nx, VNode::Join { .. }), matches!(ny, VNode::Join { .. }));
                        if jx || jy {
                            if let VNode::Join { left: l, right: r, .. } = *nx {
                                if !jy || hx >= hy {
                                    left.pop();
                                    left.push(r);
                                    left.push(l);
                                }
                            }
                            if let VNode::Join { left: l, right: r, .. } = *ny {
                                if !jx || hy >= hx {
                                    right.pop();
                                    right.push(r);
                                    right.push(l);
                                }
                            }
                            continue;
                        }
                    }
                }
            }
            let x = match rest_left.take() {
                Some(run) => Some(run),
                None => self.next_run(&mut left),
            };
            let y = match rest_right.take() {
                Some(run) => Some(run),
                None => self.next_run(&mut right),
            };
            let ((p, count_x), (q, count_y)) = match (x, y) {
                (None, None) => return Ordering::Equal,
                (None, Some(_)) => return Ordering::Less,
                (Some(_), None) => return Ordering::Greater,
                (Some(x), Some(y)) => (x, y),
            };
            if p != q {
                return q.cmp(&p);
            }
            match count_x.cmp(&count_y) {
                Ordering::Equal => {}
                Ordering::Less => rest_right = Some((q, count_y.sub(&count_x))),
                Ordering::Greater => rest_left = Some((p, count_x.sub(&count_y))),
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

    /// Whether the edge `index` is kept. The edges are added in order, so
    /// the kept ones are sorted.
    fn keeps(&self, index: u32) -> bool {
        holds(&self.kept, index)
    }
}

/// Whether a sorted list of kept edges holds `index`, by a binary search
/// whose comparisons are counted: a scan would compare with every edge.
fn holds(kept: &[u32], index: u32) -> bool {
    kept.binary_search_by(|edge| {
        work::count(Work::Kept, 1);
        edge.cmp(&index)
    })
    .is_ok()
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
    /// In the check of `elision-only`, O and π: a test of a reference reads
    /// its projected span (§7.5); `None` elsewhere.
    projection: Option<(&'c [Tok], &'c [u32])>,
    lean: Lean,
    pub arena: Vec<DNode>,
    /// The number of visible actions and of all actions of each node,
    /// exact, since a derivation can be exponentially long.
    vlen: Vec<Nat>,
    flen: Vec<Nat>,
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
    /// The witness hook's marks of W(D) (tests/README.md). With them, each
    /// count also says whether it includes a derivation made of marked links
    /// only. A parse that no test watches has none.
    marks: Option<&'c Marks>,
    /// Whether this is the ranker of the check of `elision-only`, which only
    /// its faults read.
    check: bool,
}

impl<'c> Dag<'c> {
    fn item(&self, set: u32, index: u32) -> Item {
        self.chart.sets[set as usize].items[index as usize]
    }

    fn push(&mut self, node: DNode, vlen: Nat, flen: Nat) -> u32 {
        self.arena.push(node);
        self.vlen.push(vlen);
        self.flen.push(flen);
        (self.arena.len() - 1) as u32
    }

    fn seq(&mut self, left: u32, right: u32) -> u32 {
        let vlen = self.vlen[left as usize].add(&self.vlen[right as usize]);
        let flen = self.flen[left as usize].add(&self.flen[right as usize]);
        self.push(DNode::Seq { left, right }, vlen, flen)
    }

    fn close(&mut self, body: u32, set: u32, item: u32) -> u32 {
        let visible = self.g.prods[self.chart.sets[set as usize].items[item as usize].prod as usize].visible;
        let vlen = if visible { self.vlen[body as usize].add(&Nat::ONE) } else { self.vlen[body as usize].clone() };
        let flen = self.flen[body as usize].add(&Nat::ONE);
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
            comps.push(Comp { d: self.seq(comp.d, second.x), div: comp.div.clone() });
        }
        let offset = self.vlen[first.x as usize].clone();
        for comp in &second.comps {
            let div = match &comp.div {
                Div::At(place) => Div::At(offset.add(place)),
                Div::Last => Div::Last,
            };
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
    fn absorb(&mut self, winner: &mut Entry, loser: &Entry, p: Option<Nat>, tie: bool) {
        match p {
            Some(p) => {
                let p = Div::At(p);
                if tie {
                    winner.comps.push(Comp { d: loser.x, div: p.clone() });
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
                winner.comps.push(Comp { d: loser.x, div: Div::Last });
                winner.comps.extend(loser.comps.iter().cloned());
            }
        }
        self.prune(&mut winner.comps);
    }

    /// Keeps the companions that diverge earliest, and of those the ones
    /// nothing precedes in every context.
    fn prune(&mut self, comps: &mut Vec<Comp>) {
        let Some(min) = comps.iter().map(|comp| &comp.div).min().cloned() else {
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

    fn walk_len(&self, walk: &Walk, visible: bool) -> Nat {
        match walk {
            Walk::Node(id) => {
                if visible {
                    self.vlen[*id as usize].clone()
                } else {
                    self.flen[*id as usize].clone()
                }
            }
            Walk::Act(id) => {
                let DNode::Close { set, item, .. } = self.arena[*id as usize] else { unreachable!("a close") };
                match self.close_act(set, item) {
                    Act::Close { visible: false, .. } if visible => Nat::ZERO,
                    _ => Nat::ONE,
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
        let mut index = Nat::ZERO;
        loop {
            while left.last().is_some_and(|walk| self.walk_len(walk, visible).is_zero()) {
                left.pop();
            }
            while right.last().is_some_and(|walk| self.walk_len(walk, visible).is_zero()) {
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
                    index = index.add(&self.walk_len(x, visible));
                    left.pop();
                    right.pop();
                    continue;
                }
            }
            let (ax, ay) = (self.atomic(x), self.atomic(y));
            match (ax, ay) {
                (Some(p), Some(q)) => {
                    if p.same(&q) {
                        index = index.add(&Nat::ONE);
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
            projection: None,
            lean,
            arena: Vec::new(),
            vlen: Vec::new(),
            flen: Vec::new(),
        };
        dag.push(DNode::Empty, Nat::ZERO, Nat::ZERO);
        let mut ranker = Ranker {
            dag,
            memo: FxMap::default(),
            results: Vec::new(),
            fsets: vec![Vec::new()],
            fset_index: FxMap::default(),
            maximal,
            elisions: late.then(|| Elisions { vectors: Vectors::new(), summaries: FxMap::default() }),
            marks: None,
            check: false,
        };
        ranker.fset_index.insert(Vec::new(), 0);
        ranker
    }

    /// Ranks the derivations of the reconstructed input of `elision-only`,
    /// whose tests of references read the projected span in O (§7.5).
    pub(crate) fn observing(mut self, observed: &'c [Tok], project: &'c [u32]) -> Ranker<'c> {
        self.dag.projection = Some((observed, project));
        self
    }

    /// Ranks for the check of `elision-only`, with the witness hook's marks
    /// of W(D) where a test watches it (tests/README.md).
    pub(crate) fn checking(mut self, marks: Option<&'c Marks>) -> Ranker<'c> {
        self.check = true;
        self.marks = marks;
        self
    }

    /// Whether a fault skips this alternative of a node of the check: the
    /// last of two or more links of an item, or members of a group
    /// (tests/README.md).
    fn skips(&self, fault: Fault, site: &'static str, number: u32, count: usize) -> bool {
        self.check && count > 1 && number as usize == count - 1 && witness::fault_at(fault, site)
    }

    /// W(D)'s actions as a derivation of the ranking's own, to compare with
    /// its readings in the order T.
    pub(crate) fn derivation(&mut self, sequence: &[WitnessAct]) -> u32 {
        let mut x = EMPTY;
        for act in sequence {
            x = match *act {
                WitnessAct::Read { tok, terminal } => {
                    let read = self.dag.push(DNode::Read { tok, terminal }, Nat::ONE, Nat::ONE);
                    self.dag.seq(x, read)
                }
                WitnessAct::Close { set, index } => self.dag.close(x, set, index),
            };
        }
        x
    }

    /// Whether `a` comes before `b` in the order T.
    pub(crate) fn before(&self, a: u32, b: u32) -> bool {
        self.dag.before(a, b)
    }

    /// Whether `a` comes before `b` as the second reading after `first`
    /// (§6): it diverges from `first` earlier, or at the same point and
    /// before `b` in the order T. As `rank` measures it.
    pub(crate) fn second_before(&self, first: u32, a: u32, b: u32) -> bool {
        let div = |d: u32| match self.dag.first_difference(first, d, true) {
            Diff::At { index, .. } => Div::At(index),
            Diff::APrefix { len } | Diff::BPrefix { len } => Div::At(len),
            Diff::Equal => Div::Last,
        };
        match div(a).cmp(&div(b)) {
            Ordering::Less => true,
            Ordering::Greater => false,
            Ordering::Equal => self.dag.before(a, b),
        }
    }

    /// The tokens that a test of a reference over `start..end` reads: those
    /// of the projected span in the check, else the span's own (§7.5).
    fn reference_span(&self, start: u32, end: u32) -> &'c [Tok] {
        match self.dag.projection {
            Some(_) if witness::fault_at(Fault::ReferenceSpan, "group") => {
                &self.dag.tokens[start as usize..end as usize]
            }
            Some((observed, project)) => &observed[project[start as usize] as usize..project[end as usize] as usize],
            None => &self.dag.tokens[start as usize..end as usize],
        }
    }

    pub(crate) fn chart(&self) -> &Chart {
        self.dag.chart
    }

    pub(crate) fn item(&self, set: u32, index: u32) -> Item {
        self.dag.chart.sets[set as usize].items[index as usize]
    }

    /// The cycle context below a constituent of `rule` whose own context is
    /// `fset` (§6): the rules above it over its span that can complete
    /// again below it, which are those of its own cycle, and `rule` itself.
    /// A rule on no cycle has an empty context below it, since no rule
    /// above it can complete again below it over the same span.
    fn fset_with(&mut self, fset: u32, rule: u32) -> u32 {
        let cycles = &self.dag.g.cycle;
        let Some(cycle) = cycles[rule as usize] else {
            return 0;
        };
        let mut list: Vec<u32> =
            self.fsets[fset as usize].iter().copied().filter(|&above| cycles[above as usize] == Some(cycle)).collect();
        if let Err(at) = list.binary_search(&rule) {
            list.insert(at, rule);
        }
        if let Some(&id) = self.fset_index.get(&list) {
            return id;
        }
        let id = self.fsets.len() as u32;
        work::count(Work::Contexts, 1);
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
                let previous = if captured {
                    if item.caps == 0 {
                        return Deps::Links(Vec::new());
                    }
                    self.dag.chart.caps_parent(item.caps)
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
                // A test of a terminal reads its token with its recognition
                // values, and one of a reference its projected span (§7.5).
                let terminal_test = matches!(production.syms[position], Sym::T(_));
                let mut projection = self.dag.projection;
                // Faults of the check (tests/README.md): no test at all, or
                // a test of a reference over its span of R.
                let checking = projection.is_some();
                let no_tests = checking && witness::fault_at(Fault::RankerTests, "links");
                if checking && witness::fault_at(Fault::ReferenceSpan, "links") {
                    projection = None;
                }
                let holds = |m: u32, own: SetId| {
                    no_tests
                        || test.map_or(true, |test| {
                            let span = match projection {
                                Some((observed, project)) if !terminal_test => {
                                    &observed[project[m as usize] as usize..project[set as usize] as usize]
                                }
                                _ => &tokens[m as usize..set as usize],
                            };
                            test_holds(test, span, unicode, tags, own)
                        })
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
                            let cap = self.dag.chart.last_cap(item.caps);
                            let m = cap.start;
                            if let Some(p) = self.dag.chart.sets[m as usize].find(&pred).filter(|_| holds(m, cap.tags))
                            {
                                let child = Node::Group { rule, origin: m, set, tags: cap.tags, test: NO_TEST };
                                let child_fset = if m == item.origin { fset } else { 0 };
                                links.push(((Node::Item { set: m, index: p }, same(m, fset)), (child, child_fset)));
                            }
                        } else {
                            let origins = self.dag.chart.origins_between(&pred, rule, item.origin, set);
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
                // A fault applies no test in the check (tests/README.md).
                let no_tests = self.dag.projection.is_some() && witness::fault_at(Fault::RankerTests, "group");
                let test = (test != NO_TEST && !no_tests).then(|| &self.dag.g.tests[test as usize]);
                let span = self.reference_span(origin, set);
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
    fn guard(&self, set: u32, index: u32) -> (bool, Option<u32>) {
        let item = self.item(set, index);
        let guarded = self.maximal.is_some_and(|maximal| maximal.guards(&item));
        let production = &self.dag.g.prods[item.prod as usize];
        (guarded, if guarded { production.test(item.dot as usize - 1) } else { None })
    }

    /// Of a link to `child`: whether the child is an elided terminator, and
    /// whether `maximal` lets an elided terminator follow it.
    fn eligibility(&self, child: Node, guarded: bool, test: Option<u32>) -> (bool, bool) {
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
        // Whether an item is marked, as a leaf or as the end of a marked
        // link (tests/README.md).
        let marks = self.marks;
        let marked = |set: u32, index: u32| marks.is_some_and(|marks| marks.items.contains(&(set, index)));
        // The kept edges are sorted (`Least::keeps`).
        let in_all = |index: u32| kept.as_ref().map_or(true, |(all, _)| holds(all, index));
        let in_allowed =
            |index: u32| kept.as_ref().map_or(true, |(all, allowed)| holds(allowed.as_ref().unwrap_or(all), index));
        match deps {
            Deps::Leaf => match node {
                Node::Read { tok, terminal } => {
                    let x = self.dag.push(DNode::Read { tok, terminal }, Nat::ONE, Nat::ONE);
                    NodeResult { entries: vec![Entry { x, comps: Vec::new() }], count: 1, allowed: None, w: true }
                }
                // A restoration of the check of `elision-only` reads its
                // synthetic token, and its own close follows (§7.4, §7.7).
                // Only a restoration has its first item after its origin.
                Node::Item { set, index } if self.item(set, index).origin != set => {
                    // A fault gives it no derivation (tests/README.md).
                    if witness::fault(Fault::RankRestoration) {
                        return NodeResult::default();
                    }
                    let item = self.item(set, index);
                    let terminal = restored_terminal(self.dag.g, item.prod);
                    let x = self.dag.push(DNode::Read { tok: item.origin, terminal }, Nat::ONE, Nat::ONE);
                    NodeResult {
                        entries: vec![Entry { x, comps: Vec::new() }],
                        count: 1,
                        allowed: None,
                        w: marked(set, index),
                    }
                }
                _ => {
                    let w = matches!(node, Node::Item { set, index } if marked(set, index));
                    NodeResult { entries: vec![Entry { x: EMPTY, comps: Vec::new() }], count: 1, allowed: None, w }
                }
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
                let alternatives = links.len();
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
                    // The link is W(D)'s where it is marked, and its
                    // predecessor and child are W(D)'s.
                    let Node::Item { set: m, .. } = pred.0 else { unreachable!("a predecessor item") };
                    let w = ways > 0
                        && left.w
                        && right.w
                        && marks.is_some_and(|marks| marks.links.contains(&(set, index, m)));
                    // Faults of the check skip the last of two or more links,
                    // in the count or in the entries (tests/README.md).
                    let counted = !self.skips(Fault::LostContext, "links", number, alternatives);
                    let selected = !self.skips(Fault::LostSelect, "links", number, alternatives);
                    if to_all && counted {
                        all.count = all.count.saturating_add(ways).min(2);
                        all.w |= w;
                    }
                    if kept && counted {
                        allowed.count = allowed.count.saturating_add(ways).min(2);
                        allowed.w |= w;
                    }
                    if !selected {
                        continue;
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
                        .map(|comp| Comp { d: self.dag.close(comp.d, set, index), div: comp.div.clone() })
                        .collect();
                    self.dag.add_entry(&mut list, Entry { x, comps });
                }
                NodeResult { entries: list, count: body.count, allowed: None, w: body.w }
            }
            Deps::Group(members) => {
                let mut list = Vec::new();
                let mut count = 0u8;
                let mut w = false;
                let alternatives = members.len();
                for (number, member) in (0..).zip(members) {
                    if !in_all(number) {
                        continue;
                    }
                    let result = &self.results[self.memo[&member] as usize];
                    // Faults of the check skip the last of two or more
                    // members, in the count or in the entries.
                    if !self.skips(Fault::LostContext, "group", number, alternatives) {
                        count = count.saturating_add(result.count).min(2);
                        w |= result.count > 0 && result.w;
                    }
                    if self.skips(Fault::LostSelect, "group", number, alternatives) {
                        continue;
                    }
                    for entry in &result.entries {
                        self.dag.add_entry(&mut list, entry.clone());
                    }
                }
                NodeResult { entries: list, count, allowed: None, w }
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
        let witness_counted = self.marks.map(|_| result.w);
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
        let mut tied: Option<(u32, Div)> = None;
        for d in candidates {
            let div = match self.dag.first_difference(chosen, d, true) {
                Diff::At { index, a, b } => {
                    let (_, tie) = self.dag.outcome(&a, &b);
                    if !tie {
                        continue;
                    }
                    Div::At(index)
                }
                Diff::APrefix { len } | Diff::BPrefix { len } => Div::At(len),
                Diff::Equal => match self.dag.first_difference(chosen, d, false) {
                    Diff::Equal => continue,
                    _ => Div::Last,
                },
            };
            let better = match &tied {
                None => true,
                Some((best, best_div)) => match div.cmp(best_div) {
                    Ordering::Less => true,
                    Ordering::Greater => false,
                    Ordering::Equal => self.dag.before(d, *best),
                },
            };
            if better {
                tied = Some((d, div));
            }
        }
        // Under late-elision, the forest of the best derivations holds a
        // second one exactly when the least count is two. A disagreement is
        // a defect of the library, and like its other broken invariants it
        // panics, in release builds too, rather than pick a verdict.
        if let Some((_, least)) = counts {
            assert_eq!(
                least >= 2,
                tied.is_some(),
                "the least count of late-elision disagrees with the forest of the best derivations"
            );
        }
        let verdict = if total == 1 {
            Verdict::Unique
        } else if tied.is_some() {
            Verdict::Tie
        } else {
            Verdict::Resolved
        };
        let second = tied.map(|(t, _)| t);
        let witness = second.map(|t| match self.dag.first_difference(chosen, t, true) {
            Diff::At { a, b, .. } => (a, b),
            _ => match self.dag.first_difference(chosen, t, false) {
                Diff::At { a, b, .. } => (a, b),
                _ => unreachable!("two different derivations differ"),
            },
        });
        Some(Ranking { verdict, first: chosen, second, witness, witness_counted })
    }
}

/// The terminal of the elidable optional whose empty production is `prod`:
/// the first symbol of the helper's other productions (§3.8).
pub(crate) fn restored_terminal(g: &Lowered, prod: u32) -> u32 {
    let rule = &g.rules[g.prods[prod as usize].rule as usize];
    rule.prods
        .iter()
        .find_map(|&other| match g.prods[other as usize].syms.first() {
            Some(&Sym::T(terminal)) => Some(terminal),
            _ => None,
        })
        .expect("an elidable optional begins with its terminal")
}

#[cfg(test)]
mod tests {
    use super::{Least, Nat, Ordering, VNode, Vectors, NO_ELISIONS};
    use crate::work::{assert_linear, Work};

    /// A node whose many edges all attain the least vector keeps them all,
    /// and asking of each edge whether it is kept costs about one step, not
    /// one for each kept edge.
    #[test]
    fn kept_edges_are_found_without_a_scan() {
        let vectors = Vectors::new();
        assert_linear(Work::Kept, 40_000, &mut |n| {
            let mut least = Least::NONE;
            for index in 0..n as u32 {
                least.add(&vectors, index, &Least::one(NO_ELISIONS));
            }
            assert!((0..n as u32).all(|index| least.keeps(index)));
            assert!(!least.keeps(n as u32));
        });
    }

    /// 2^k, by doubling from one.
    fn power(k: u32) -> Nat {
        (0..k).fold(Nat::ONE, |n, _| n.add(&n))
    }

    /// A run of `count` terminators elided at `at`, made by joining
    /// smaller runs, as the ranking makes it.
    fn run(vectors: &mut Vectors, at: u32, doublings: u32) -> u32 {
        let mut vector = vectors.one(at);
        for _ in 0..doublings {
            vector = vectors.join(vector, vector);
        }
        vector
    }

    /// Runs of 2^32, 2^53, 2^60 and 2^100 elided terminators compare
    /// exactly with runs built apart and with runs that differ by one, past
    /// the widths of 32-bit and 64-bit integers and of a double.
    #[test]
    fn runs_that_differ_by_one_compare_exactly() {
        let mut vectors = Vectors::new();
        for k in [32, 53, 60, 100] {
            let power = run(&mut vectors, 0, k);
            let apart = run(&mut vectors, 0, k);
            assert_ne!(power, apart, "built apart");
            assert_eq!(vectors.compare(power, apart), Ordering::Equal, "2^{k}");
            let one = vectors.one(0);
            let above = vectors.join(power, one);
            // 2^k - 1, as the sum of every smaller power of two.
            let mut below = super::NO_ELISIONS;
            for i in 0..k {
                let part = run(&mut vectors, 0, i);
                below = vectors.join(below, part);
            }
            assert_eq!(vectors.compare(power, above), Ordering::Less, "2^{k} + 1");
            assert_eq!(vectors.compare(above, power), Ordering::Greater, "2^{k} + 1");
            assert_eq!(vectors.compare(below, power), Ordering::Less, "2^{k} - 1");
            assert_eq!(vectors.compare(power, below), Ordering::Greater, "2^{k} - 1");
            let restored = vectors.join(below, one);
            assert_eq!(vectors.compare(restored, power), Ordering::Equal, "2^{k} - 1 + 1");
            // The same counts at a later boundary, after an equal prefix.
            let first = vectors.one(0);
            let at_three = run(&mut vectors, 3, k);
            let late = vectors.join(first, at_three);
            let at_three_more = vectors.join(at_three, vectors.leaves[&3]);
            let later = vectors.join(first, at_three_more);
            assert_eq!(vectors.compare(late, later), Ordering::Less, "2^{k} at 3");
        }
    }

    /// The comparison of elision vectors stays exact where a count at one
    /// boundary passes any fixed width, and where one run is split across
    /// joins.
    #[test]
    fn vectors_compare_exactly_past_any_fixed_width() {
        let mut vectors = Vectors::new();
        let empty = super::NO_ELISIONS;
        let big = run(&mut vectors, 0, 100);
        assert!(matches!(&vectors.nodes[big as usize], VNode::Run { at: 0, count } if *count == power(100)));
        let one = vectors.one(0);
        let bigger = vectors.join(big, one);
        assert_eq!(vectors.compare(empty, big), Ordering::Less);
        assert_eq!(vectors.compare(big, empty), Ordering::Greater);
        assert_eq!(vectors.compare(big, bigger), Ordering::Less);
        assert_eq!(vectors.compare(bigger, big), Ordering::Greater);
        assert_eq!(vectors.compare(bigger, bigger), Ordering::Equal);
        // 2^32 at boundary 0, which a 32-bit count would wrap to nothing.
        let wraps = run(&mut vectors, 0, 32);
        assert_eq!(vectors.compare(wraps, empty), Ordering::Greater);
        // Equal counts at 0; then the one that elides at 2 is greater than
        // the one that elides at 3.
        let at_two = vectors.one(2);
        let at_three = vectors.one(3);
        let a = vectors.join(big, at_three);
        let b = vectors.join(big, at_two);
        assert_eq!(vectors.compare(a, b), Ordering::Less);
        assert_eq!(vectors.compare(b, a), Ordering::Greater);
        // One run at 1 split across two joins counts as their sum.
        let first = vectors.one(0);
        let middle = run(&mut vectors, 1, 70);
        let split = vectors.join(first, middle);
        let rest = run(&mut vectors, 1, 70);
        let split = vectors.join(split, rest);
        let whole = run(&mut vectors, 1, 71);
        let whole = vectors.join(first, whole);
        assert_eq!(vectors.compare(split, whole), Ordering::Equal);
        assert_eq!(vectors.compare(whole, split), Ordering::Equal);
        let more = vectors.join(whole, at_two);
        assert_eq!(vectors.compare(split, more), Ordering::Less);
        let fewer = run(&mut vectors, 1, 69);
        let fewer = vectors.join(first, fewer);
        assert_eq!(vectors.compare(fewer, split), Ordering::Less);
    }
}
