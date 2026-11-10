//! Choosing a parse (engine §6), computed over the packed forest without
//! enumerating derivations.
//!
//! When a key step of `%ambiguity-resolution` counts anything, a first pass
//! gives every node of the forest, in each of its contexts, a *summary*:
//! the greatest profile of its derivations, how many derivations attain it,
//! how many attain its least measure, and which edges attain it. The entries
//! below are then computed over only those edges, the forest of the best
//! derivations.
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
use std::rc::Rc;

use crate::earley::{test_holds, Cap, Chart, Item, RestorationView, Shared, Tok};
use crate::grammar::{KeyStep, Lean, StepKind};
use crate::lower::{Lowered, Sym, NO_TEST};
use crate::measures::{Measure, Measures};
use crate::nat::Nat;
use crate::tags::{SetId, Tags};
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
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
    Absent,
    Scoped(u32),
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
        requested: u8,
        route: u8,
        rule: u32,
        origin: u32,
        set: u32,
        tags: u32,
        test: u32,
        structure: u32,
        boundary: u32,
        lexical: u32,
        option: usize,
    },
}

#[derive(Clone, PartialEq, Eq, Hash)]
struct ErasedState {
    rule: u32,
    origin: u32,
    end: u32,
    tags: u32,
    structure: (u32, u32),
    boundary: u32,
    requested: u8,
    lexical: u32,
    strict: bool,
    restores: bool,
    scope: usize,
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
    /// With the runtime witness marks, whether `count` includes a derivation
    /// made of marked links only (tests/README.md). The same loop decides
    /// both, so any choice that drops W(D) from the count drops it here.
    w: bool,
}

#[derive(Clone)]
enum Deps {
    Leaf,
    Links(Vec<(Key, Key)>),
    Close(Option<Key>),
    Group(Vec<Key>),
}

#[derive(Clone)]
struct SlotCandidate {
    node: Node,
    edge: usize,
    label: String,
    option: usize,
    open: Option<crate::boundary::Record>,
    group: usize,
    start: u32,
    end: u32,
    entry: String,
    measure: Measure,
}
#[derive(Clone)]
struct Counts {
    measure: Measure,
    all: u8,
}
impl Default for Counts {
    fn default() -> Self {
        Self { all: 0, measure: Measure::ZERO }
    }
}
impl Counts {
    fn offer(&mut self, measure: Measure, ways: u8) {
        if ways == 0 {
            return;
        }
        if self.all == 0 || measure.compare(&self.measure).is_lt() {
            self.measure = measure;
            self.all = ways.min(2);
        } else if measure == self.measure {
            self.all = self.all.saturating_add(ways).min(2);
        }
    }
}
type SlotMaxima = std::collections::BTreeSet<String>;
#[derive(Clone)]
struct Admission {
    groups: Vec<Vec<SlotCandidate>>,
    at: FxMap<Node, Vec<SlotCandidate>>,
    counts: FxMap<Key, Counts>,
    masks: FxMap<Key, Vec<bool>>,
    maxima: FxMap<(usize, u32, Option<u32>), SlotMaxima>,
    stats: crate::slot_stats::SlotStatistics,
    reported_splits: Vec<bool>,
}
/// The packed chart keeps raw proofs together. Admission separates the
/// options at a slot edge while retaining every proof of each option.
fn raw_slot_links(g: &Lowered, chart: &Chart, set: u32, item: Item) -> Vec<(Item, Cap, usize)> {
    let mut out = vec![];
    let rule = match g.prods[item.prod as usize].syms[item.dot as usize - 1] {
        Sym::N(r) => Some(r),
        _ => None,
    };
    let ranked = rule.is_some_and(|r| g.ranked.slots.contains_key(&r));
    for &(before, cap) in chart.links.get(&(set, item)).into_iter().flatten() {
        if ranked {
            let lexical = chart.expected_lexical(before, cap.start);
            let mut options = std::collections::BTreeSet::new();
            for &index in chart.sets[set as usize].completed.get(&(rule.unwrap(), cap.start)).into_iter().flatten() {
                let child = chart.sets[set as usize].items[index as usize];
                if child.close_requested == cap.close_requested
                    && child.lexical == lexical
                    && chart.sets[set as usize].completed_structures[index as usize] == cap.structure
                    && child.boundary == cap.boundary
                    && chart.sets[set as usize].tagset[index as usize] == cap.tags
                {
                    options.insert(g.ranked.options[&child.prod]);
                }
            }
            out.extend(options.into_iter().map(|option| (before, cap, option)));
        } else {
            out.push((before, cap, usize::MAX));
        }
    }
    out
}
fn slot_links(
    g: &Lowered,
    chart: &Chart,
    set: u32,
    item: Item,
    view: Option<&RestorationView>,
) -> Vec<(Item, Cap, usize)> {
    let Some(view) = view else { return raw_slot_links(g, chart, set, item) };
    let index = chart.sets[set as usize].find(&item).expect("a ranked item");
    let mut seen = crate::fxhash::FxSet::default();
    let mut links = Vec::new();
    for &raw in &view.members[&(set, view.aliases[set as usize][index as usize])] {
        for (before, cap, option) in raw_slot_links(g, chart, set, chart.sets[set as usize].items[raw as usize]) {
            work::count(Work::Walked, 1);
            let previous = chart.sets[cap.start as usize].find(&before).expect("a ranked predecessor");
            let mut observed = view.cap(cap);
            observed.structure = observed.proof_structure.unwrap_or(observed.structure);
            observed.proof_structure = None;
            observed.route = 0;
            let key = (
                cap.start,
                view.aliases[cap.start as usize][previous as usize],
                observed,
                view.frame(chart.expected_lexical(before, cap.start)),
                option,
            );
            if seen.insert(key) {
                links.push((before, cap, option));
            }
        }
    }
    links
}
impl RestorationView {
    fn node(&self, node: Node) -> Node {
        match node {
            Node::Item { set, index } => Node::Item { set, index: self.aliases[set as usize][index as usize] },
            Node::Close { set, index } => Node::Close { set, index: self.aliases[set as usize][index as usize] },
            Node::Group { requested, route, rule, origin, set, tags, test, structure, boundary, lexical, option } => {
                Node::Group {
                    requested,
                    route,
                    rule,
                    origin,
                    set,
                    tags,
                    test,
                    structure: self.state(structure),
                    boundary,
                    lexical: self.frame(lexical),
                    option,
                }
            }
            _ => node,
        }
    }
}
fn written_frame(g: &Lowered, chart: &Chart, item: Item, at: u32, projection: Option<&RestorationView>) -> String {
    let p = &g.prods[item.prod as usize];
    let control: Vec<_> = p
        .syms
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let role = match s {
                Sym::T(t) => format!("T{t}"),
                Sym::N(r) => g.ranked.written.get(r).cloned().unwrap_or_else(|| format!("N{r}")),
            };
            (role, p.test(i).map(|id| &g.tests[id as usize]))
        })
        .collect();
    let captures: Vec<_> = p
        .slot
        .as_ref()
        .expect("a written parent")
        .names
        .iter()
        .zip(chart.caps(item.caps))
        .filter_map(|(name, cap)| name.as_ref().map(|name| (name, projection.map_or(cap, |v| v.cap(cap)))))
        .collect();
    let lexical = projection.map_or(item.lexical, |v| v.frame(item.lexical));
    let path = g.ranked.written.get(&p.rule);
    let index = chart.sets[at as usize].find(&item).expect("a written prefix");
    format!(
        "{:?}/{path:?}/{control:?}/{}/{}/{captures:?}/{lexical:?}/{}/{}/{}",
        p.slot.as_ref().unwrap().source,
        item.dot,
        item.origin,
        projection.map_or(item.prefix, |v| v.state(item.prefix)),
        item.boundary,
        chart.sets[at as usize].is_strict(index as usize)
    )
}
impl Admission {
    fn new(
        g: &Lowered,
        chart: &Chart,
        views: Option<&SlotViews>,
        nodes: &[Node],
        projection: Option<&RestorationView>,
    ) -> Self {
        let mut groups = Vec::<Vec<SlotCandidate>>::new();
        let mut ids = FxMap::<String, usize>::default();
        let mut at = FxMap::<Node, Vec<SlotCandidate>>::default();
        let mut stats = crate::slot_stats::SlotStatistics {
            chart_facts: chart.sets.iter().map(|s| s.items.len()).sum(),
            ..Default::default()
        };
        for &node in nodes {
            let (raw, scope) = views.map_or((node, 0), |v| v.unpack(node));
            let Node::Item { set: end, index } = raw else { continue };
            let item = chart.sets[end as usize].items[index as usize];
            let p = &g.prods[item.prod as usize];
            if !p.tree_root && scope == 0 {
                continue;
            }
            if item.dot == 0 {
                continue;
            }
            let Sym::N(rule) = p.syms[item.dot as usize - 1] else { continue };
            let Some(group_id) = g.ranked.slots.get(&rule) else { continue };
            for (edge, (previous, cap, option)) in slot_links(g, chart, end, item, projection).into_iter().enumerate() {
                let prefix = written_frame(g, chart, previous, cap.start, projection);
                let ancestry = views.map(|v| v.ranked_prefix_key(scope, g, chart, projection));
                let key = format!("{group_id}/{prefix}/{ancestry:?}/{}/{}", cap.start, cap.end);
                let group = *ids.entry(key.clone()).or_insert_with(|| {
                    groups.push(vec![]);
                    groups.len() - 1
                });
                let open = chart.boundaries.as_ref().map(|m| m.borrow().open(previous.boundary, cap.boundary));
                let label = format!("{option:020}/{open:?}");
                let candidate = SlotCandidate {
                    measure: Measure::ZERO,
                    node,
                    edge,
                    label,
                    option,
                    open,
                    group,
                    start: cap.start,
                    end: cap.end,
                    entry: key,
                };
                groups[group].push(candidate.clone());
                at.entry(node).or_default().push(candidate);
                stats.candidate_edges += 1;
            }
        }
        stats.groups = groups.len();
        let reported_splits = vec![false; groups.len()];
        Self {
            groups,
            at,
            reported_splits,
            counts: FxMap::default(),
            masks: FxMap::default(),
            maxima: FxMap::default(),
            stats,
        }
    }
}
impl Ranker<'_> {
    fn availability_key(&self, key: Key, group: usize) -> (usize, u32, Option<u32>) {
        let parent = match self.raw_node(key.0) {
            Node::Item { set, index } => {
                let item = self.item(set, index);
                let p = &self.dag.g.prods[item.prod as usize];
                (item.dot as usize == p.syms.len()).then(|| {
                    self.views
                        .as_ref()
                        .and_then(|v| v.written_parent(key.0, self.dag.g, self.dag.chart))
                        .unwrap_or(p.rule)
                })
            }
            _ => None,
        };
        (group, key.1, parent)
    }
    fn slot_candidates(&self, key: Key) -> Vec<SlotCandidate> {
        let Some(a) = &self.admission else { return vec![] };
        let Some(choices) = a.at.get(&key.0) else { return vec![] };
        let groups = choices.iter().map(|c| c.group).collect::<std::collections::BTreeSet<_>>();
        groups
            .into_iter()
            .filter(|g| !a.maxima.contains_key(&self.availability_key(key, *g)))
            .flat_map(|g| a.groups[g].clone())
            .collect()
    }
    fn admit(&mut self, key: Key, deps: &Deps) {
        let choices = self.admission.as_ref().and_then(|a| a.at.get(&key.0)).cloned();
        let Some(choices) = choices else {
            return;
        };
        let Deps::Links(links) = deps else { unreachable!("a slot advance") };
        let mut masks = vec![false; links.len()];
        for choice in choices {
            let context = self.availability_key(key, choice.group);
            if !self.admission.as_ref().unwrap().maxima.contains_key(&context) {
                let mut viable = Vec::new();
                let candidates = self.admission.as_ref().unwrap().groups[choice.group].clone();
                for candidate in candidates {
                    let Deps::Links(found) = self.deps((candidate.node, key.1)) else { unreachable!() };
                    let Some(&(pred, child)) = found.get(candidate.edge) else { continue };
                    let a = self.admission.as_ref().unwrap();
                    let left = &a.counts[&pred];
                    let right = &a.counts[&child];
                    let ways = left.all;
                    if ways > 0 && right.all > 0 {
                        let mut candidate = candidate;
                        candidate.measure = left.measure.add(&right.measure);
                        viable.push(candidate);
                    }
                }
                let retained: Vec<_> = viable
                    .iter()
                    .filter(|proof| {
                        !viable.iter().any(|higher| {
                            higher.option < proof.option
                                && !higher.measure.compare(&proof.measure).is_gt()
                                && match (&higher.open, &proof.open) {
                                    (Some(h), Some(l)) => h.dominates(l),
                                    (None, None) => true,
                                    _ => false,
                                }
                        })
                    })
                    .collect();
                if retained.iter().any(|proof| viable.iter().any(|higher| higher.option < proof.option)) {
                    let a = self.admission.as_mut().unwrap();
                    if !a.reported_splits[choice.group] {
                        a.reported_splits[choice.group] = true;
                        a.stats.boundary_splits.push(crate::slot_stats::BoundarySplit {
                            group: choice.group,
                            start: choice.start,
                            end: choice.end,
                            entry: choice.entry.clone(),
                        });
                    }
                }
                let maxima = retained.iter().map(|c| c.label.clone()).collect();
                self.admission.as_mut().unwrap().maxima.insert(context, maxima);
            }
            let all = &self.admission.as_ref().unwrap().maxima[&context];
            masks[choice.edge] = all.contains(&choice.label);
        }
        let a = self.admission.as_mut().unwrap();
        a.stats.retained_edges += masks.iter().filter(|x| **x).count();
        a.masks.insert(key, masks);
    }
    fn count(&self, key: Key, deps: &Deps) -> Counts {
        let a = self.admission.as_ref().unwrap();
        match deps {
            Deps::Leaf => {
                let valid = match self.raw_node(key.0) {
                    Node::Item { set, index } if self.item(set, index).origin != set => {
                        !witness::fault(Fault::RankRestoration)
                    }
                    _ => true,
                };
                Counts {
                    all: u8::from(valid),
                    measure: match self.raw_node(key.0) {
                        Node::Read { tok, .. } => self.dag.carried_measure(tok),
                        _ => Measure::ZERO,
                    },
                }
            }
            Deps::Close(None) => Counts::default(),
            Deps::Close(Some(k)) => {
                let body = &a.counts[k];
                let measure = match self.raw_node(key.0) {
                    Node::Close { set, index } => {
                        let item = self.item(set, index);
                        let production = &self.dag.g.prods[item.prod as usize];
                        if production.erased {
                            Measure::ZERO
                        } else if production.error.is_some() {
                            body.measure.add(&self.dag.own_measure(item.origin, set))
                        } else {
                            body.measure.clone()
                        }
                    }
                    _ => body.measure.clone(),
                };
                Counts { all: body.all, measure }
            }
            Deps::Group(members) => {
                let mut result = Counts::default();
                for (erased, group) in self.erased_groups(members) {
                    for &index in &group {
                        if self.skips(Fault::LostContext, "group", index as u32, members.len()) {
                            continue;
                        }
                        let counts = &a.counts[&members[index]];
                        if counts.all == 0 {
                            continue;
                        }
                        result.offer(counts.measure.clone(), if erased { 1 } else { counts.all });
                        if erased {
                            break;
                        }
                    }
                }
                result
            }
            Deps::Links(links) => {
                let mut result = Counts::default();
                let mask = a.masks.get(&key);
                for (i, &(pred, child)) in links.iter().enumerate() {
                    if self.skips(Fault::LostContext, "links", i as u32, links.len()) {
                        continue;
                    }
                    let left = &a.counts[&pred];
                    let right = &a.counts[&child];
                    let ways = (left.all).saturating_mul(right.all).min(2);
                    if mask.map_or(true, |m| m[i]) {
                        result.offer(left.measure.add(&right.measure), ways);
                    }
                }
                result
            }
        }
    }
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
/// and for a tie the second reading and witness (§6).
pub(crate) struct Ranking {
    pub verdict: Verdict,
    pub first: u32,
    pub second: Option<u32>,
    pub witness: Option<(Act, Act)>,
    /// With the runtime witness marks, whether the count counted W(D): the
    /// root has the bit (tests/README.md).
    pub witness_counted: Option<bool>,
    pub profile: Profile,
}

/// The sequences of `late(c)` and `early(c)` (§6), each kept as the
/// starting positions of the occurrences of `c` in text order. The elision
/// vector of `late #·<_Elided>` is one such sequence. A vector is a node of a shared tree whose
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

/// When profiles decide, the derivations of a node in one context, one
/// eligibility: the greatest profile, the number of derivations that attain
/// it and the number of all of them, both capped at two, and the edges that
/// attain it (§6). A total of zero means no derivation.
#[derive(Debug, Clone)]
struct Least {
    profile: Profile,
    least: u8,
    total: u8,
    kept: Vec<u32>,
}

impl Least {
    const NONE: Least = Least { profile: Profile::ZERO, least: 0, total: 0, kept: Vec::new() };

    fn one(profile: Profile) -> Least {
        Least { profile, least: 1, total: 1, kept: vec![0] }
    }

    /// Adds an edge and counts only derivations at the least measure.
    /// The least count and kept edges also apply the written key steps.
    fn add(&mut self, profiles: &Profiles, index: u32, edge: &Least) {
        if edge.total == 0 {
            return;
        }
        let error_order = if self.total == 0 {
            Ordering::Less
        } else {
            Profiles::measure(&edge.profile).compare(&Profiles::measure(&self.profile))
        };
        self.total = match error_order {
            Ordering::Less => edge.total.min(2),
            Ordering::Equal => self.total.saturating_add(edge.total).min(2),
            Ordering::Greater => self.total,
        };
        let order = if self.least == 0 { Ordering::Less } else { profiles.compare(&edge.profile, &self.profile) };
        match order {
            Ordering::Less => {
                self.profile = edge.profile.clone();
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

/// A node's summary in one cycle and admission context.
#[derive(Debug, Clone)]
struct Summary {
    all: Least,
}
impl Summary {
    fn keeps(&self, index: u32) -> bool {
        self.all.keeps(index)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Pass {
    Admission,
    Summaries,
    Entries,
}

/// A derivation DAG, with what comparing its derivations needs.
pub(crate) struct Dag<'c> {
    g: &'c Lowered,
    chart: &'c Chart,
    tokens: &'c [Tok],
    measures: Measures,
    /// The stored tag sets used by symbol tests (§4, §5).
    tags: &'c Tags,
    /// In the check of `elision-only`, O and π: a test of a reference reads
    /// its projected span (§7.5); `None` elsewhere.
    projection: Option<(&'c [Tok], &'c [u32])>,
    lean: Lean,
    canonical_companions: bool,
    pub arena: Vec<DNode>,
    /// The number of visible actions and of all actions of each node,
    /// exact, since a derivation can be exponentially long.
    vlen: Vec<Nat>,
    flen: Vec<Nat>,
}

pub(crate) struct Ranker<'c> {
    shared: &'c Shared<'c>,
    restoration: Option<Rc<RestorationView>>,
    projected_marks: Option<Rc<Marks>>,
    canonical_only: bool,
    witness_only: bool,
    raw_membership: bool,
    witness_shown: Option<u32>,
    canonical_channel: Option<Box<Ranker<'c>>>,
    canonical_imports: FxMap<u32, u32>,
    pub dag: Dag<'c>,
    memo: FxMap<Key, u32>,
    results: Vec<NodeResult>,
    fsets: Vec<Vec<u32>>,
    fset_index: FxMap<Vec<u32>, u32>,
    /// How the key steps count, add and compare profiles (§6).
    profiles: Profiles,
    /// When the profiles decide, the summaries of the nodes (§6).
    summaries: Option<FxMap<Key, Summary>>,
    /// The runtime witness marks of W(D) (tests/README.md). With them, each
    /// count also says whether it includes a derivation made of marked links
    /// only. Every elision-only check supplies these marks, including without a test hook.
    marks: Option<&'c Marks>,
    /// Reconstruction selects canonical companions and enables its fault tests.
    check: bool,
    admission: Option<Admission>,
    views: Option<SlotViews>,
}

impl<'c> Dag<'c> {
    fn item(&self, set: u32, index: u32) -> Item {
        self.chart.sets[set as usize].items[index as usize]
    }

    fn own_measure(&self, start: u32, end: u32) -> Measure {
        match self.projection {
            Some((_, project)) => self.measures.projected_own(project, start as usize, end as usize),
            None => self.measures.own(start as usize, end as usize),
        }
    }
    fn carried_measure(&self, tok: u32) -> Measure {
        let at = match self.projection {
            Some((_, project)) => {
                if project[tok as usize] == project[tok as usize + 1] {
                    return Measure::ZERO;
                }
                project[tok as usize]
            }
            None => tok,
        };
        self.measures.carried[at as usize].clone()
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
        Act::Close {
            prod: self.g.prods[item.prod as usize].source,
            start: item.origin,
            end: set,
            visible: self.g.prods[item.prod as usize].visible,
        }
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
                    if self.canonical_companions || comp.div < p {
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

    /// Reconstruction keeps canonical companions.
    /// Ordinary ranking first selects the earliest divergence.
    fn prune(&mut self, comps: &mut Vec<Comp>) {
        let Some(min) = comps.iter().map(|comp| &comp.div).min().cloned() else {
            return;
        };
        let candidates: Vec<Comp> =
            comps.drain(..).filter(|comp| self.canonical_companions || comp.div == min).collect();
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
            },
            (Act::Close { .. }, Act::Read { .. }) => match self.lean {
                Lean::Greedy => (false, false),
                Lean::Lazy => (true, false),
                Lean::Neither => (false, true),
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
        steps: &[KeyStep],
        lean: Lean,
    ) -> Ranker<'c> {
        let mut ranker = Self::new_unfiltered(g, chart, tokens, shared, steps, lean);
        ranker.restoration = chart.restoration_view(g);
        if !g.ranked.slots.is_empty() {
            ranker.views = SlotViews::new(g);
            let nodes = ranker.prepare_views();
            ranker.admission =
                Some(Admission::new(g, chart, ranker.views.as_ref(), &nodes, ranker.restoration.as_deref()));
        }
        ranker
    }

    pub(crate) fn new_unfiltered(
        g: &'c Lowered,
        chart: &'c Chart,
        tokens: &'c [Tok],
        shared: &'c Shared<'c>,
        steps: &[KeyStep],
        lean: Lean,
    ) -> Ranker<'c> {
        // The profiles decide when a step counts elided terminators or a
        // rule can match a step. The readings then
        // come from the forest of the best derivations (§6).
        let profiles = Profiles::new(steps);
        let measures = Measures::new(tokens);
        let decide = crate::ranking_patterns::can_count(g, steps)
            || measures.carried.iter().any(|measure| *measure != Measure::ZERO);
        let mut dag = Dag {
            g,
            chart,
            tokens,
            measures,
            tags: &shared.tags,
            projection: None,
            lean,
            canonical_companions: false,
            arena: Vec::new(),
            vlen: Vec::new(),
            flen: Vec::new(),
        };
        dag.push(DNode::Empty, Nat::ZERO, Nat::ZERO);
        let mut ranker = Ranker {
            shared,
            restoration: None,
            projected_marks: None,
            canonical_only: false,
            witness_only: false,
            raw_membership: false,
            witness_shown: None,
            canonical_channel: None,
            canonical_imports: FxMap::default(),
            dag,
            memo: FxMap::default(),
            results: Vec::new(),
            fsets: vec![Vec::new()],
            fset_index: FxMap::default(),
            summaries: decide.then(FxMap::default),
            profiles,
            marks: None,
            check: false,
            admission: None,
            views: None,
        };
        ranker.fset_index.insert(Vec::new(), 0);
        ranker
    }

    fn erased_state(&self, key: Key) -> Option<ErasedState> {
        let (node, scope) = self.views.as_ref().map_or((key.0, 0), |views| views.unpack(key.0));
        let Node::Close { set, index } = node else { return None };
        let item = self.item(set, index);
        let production = &self.dag.g.prods[item.prod as usize];
        if !production.erased {
            return None;
        }
        Some(ErasedState {
            rule: production.rule,
            origin: item.origin,
            end: set,
            tags: self.dag.chart.sets[set as usize].tagset[index as usize],
            structure: {
                let state = self.dag.chart.sets[set as usize].completed_structures[index as usize];
                self.dag.chart.machine.as_ref().map_or((state, 0), |m| m.borrow_mut().restoration_key(state))
            },
            boundary: item.boundary,
            requested: item.close_requested,
            lexical: self.restoration.as_ref().map_or(item.lexical, |v| v.frame(item.lexical)),
            strict: self.dag.chart.sets[set as usize].is_strict(index as usize),
            restores: production.syms.is_empty() && item.origin != set,
            scope,
        })
    }

    fn erased_groups(&self, members: &[Key]) -> Vec<(bool, Vec<usize>)> {
        if self.raw_membership {
            return (0..members.len())
                .inspect(|_| work::count(Work::Walked, 1))
                .map(|index| (false, vec![index]))
                .collect();
        }
        let mut found: FxMap<ErasedState, usize> = FxMap::default();
        let mut groups: Vec<(bool, Vec<usize>)> = Vec::new();
        for (index, &member) in members.iter().enumerate() {
            work::count(Work::Walked, 1);
            if let Some(state) = self.erased_state(member) {
                if let Some(&group) = found.get(&state) {
                    groups[group].1.push(index);
                } else {
                    found.insert(state, groups.len());
                    groups.push((true, vec![index]));
                }
            } else {
                groups.push((false, vec![index]));
            }
        }
        groups
    }

    fn action_channel(&self) -> Ranker<'c> {
        let mut ranker =
            Self::new_unfiltered(self.dag.g, self.dag.chart, self.dag.tokens, self.shared, &[], Lean::Neither);
        if let Some((observed, project)) = self.dag.projection {
            ranker = ranker.observing(observed, project);
        }
        ranker.summaries = Some(FxMap::default());
        ranker.canonical_only = true;
        ranker.admission = self.admission.clone();
        ranker.views = self.views.clone();
        ranker.restoration = self.restoration.clone();
        ranker.projected_marks = self.projected_marks.clone();
        ranker.check = self.check;
        ranker.marks = self.marks;
        ranker.fsets = self.fsets.clone();
        ranker.fset_index = self.fset_index.clone();
        ranker
    }

    /// A separate measure-only summary retains its ordinary action frontier (§6).
    fn canonical_erased(&mut self, members: &[Key]) -> Option<u32> {
        if self.canonical_only {
            return self.choose_erased(members);
        }
        let mut channel = self.canonical_channel.take().unwrap_or_else(|| Box::new(self.action_channel()));
        let keys: Vec<_> = members
            .iter()
            .map(|&(node, context)| {
                let values = &self.fsets[context as usize];
                let next = channel.fsets.len() as u32;
                let context = *channel.fset_index.entry(values.clone()).or_insert_with(|| {
                    channel.fsets.push(values.clone());
                    next
                });
                (node, context)
            })
            .collect();
        let result = channel.choose_erased(&keys);
        let result = result.map(|root| self.import_canonical(&channel, root));
        self.canonical_channel = Some(channel);
        result
    }

    fn choose_erased(&mut self, members: &[Key]) -> Option<u32> {
        let mut measure = None;
        let mut selected = None;
        for &member in members {
            let Node::Close { set, index } = self.raw_node(member.0) else { unreachable!("an erased completion") };
            let Deps::Close(Some(inner)) = self.deps(member) else { continue };
            self.traverse(inner, Pass::Summaries);
            self.traverse(inner, Pass::Entries);
            let summary = &self.summaries.as_ref().unwrap()[&inner].all;
            if summary.total == 0 {
                continue;
            }
            let item = self.item(set, index);
            let production = &self.dag.g.prods[item.prod as usize];
            let mut current = Profiles::measure(&summary.profile);
            if production.error.is_some() {
                current = current.add(&self.dag.own_measure(item.origin, set));
            }
            let order = measure.as_ref().map_or(Ordering::Less, |best| current.compare(best));
            if order.is_gt() {
                continue;
            }
            if order.is_lt() {
                measure = Some(current);
                selected = None;
            }
            let entries = self.results[self.memo[&inner] as usize].entries.clone();
            for entry in entries {
                let candidate = self.dag.close(entry.x, set, index);
                if selected.map_or(true, |before| self.dag.before(candidate, before)) {
                    selected = Some(candidate);
                }
            }
        }
        selected
    }

    fn import_canonical(&mut self, channel: &Ranker<'c>, root: u32) -> u32 {
        self.canonical_imports.entry(0).or_insert(0);
        let mut pending = vec![(root, false)];
        while let Some((node, ready)) = pending.pop() {
            if self.canonical_imports.contains_key(&node) {
                continue;
            }
            let source = channel.dag.arena[node as usize];
            if !ready {
                pending.push((node, true));
                match source {
                    DNode::Seq { left, right } => pending.extend([(right, false), (left, false)]),
                    DNode::Close { body, .. } => pending.push((body, false)),
                    _ => {}
                }
                continue;
            }
            work::count(Work::Walked, 1);
            let copied = match source {
                DNode::Empty => EMPTY,
                DNode::Read { tok, terminal } => self.dag.push(DNode::Read { tok, terminal }, Nat::ONE, Nat::ONE),
                DNode::Seq { left, right } => {
                    self.dag.seq(self.canonical_imports[&left], self.canonical_imports[&right])
                }
                DNode::Close { body, set, item } => self.dag.close(self.canonical_imports[&body], set, item),
            };
            self.canonical_imports.insert(node, copied);
        }
        self.canonical_imports[&root]
    }

    pub(crate) fn raw_membership(mut self) -> Self {
        self.raw_membership = true;
        self.summaries = None;
        self
    }

    pub(crate) fn witness_representative(&mut self) -> Option<u32> {
        if self.witness_shown.is_some() {
            return self.witness_shown;
        }
        self.marks?;
        let mut ranker = self.action_channel();
        ranker.canonical_only = false;
        ranker.witness_only = true;
        let ranking = ranker.rank_inner()?;
        let imports = std::mem::take(&mut self.canonical_imports);
        let root = self.import_canonical(&ranker, ranking.first);
        self.canonical_imports = imports;
        self.witness_shown = Some(root);
        Some(root)
    }

    /// The profile of a chosen tree in this ranking's profiles (§7).
    pub(crate) fn tree_profile(&mut self, tree: &crate::tree::ITree, input: &[Tok]) -> Profile {
        if self.summaries.is_none() {
            return Profile::ZERO;
        }
        self.profiles.tree_profile(self.dag.g, tree, input, self.dag.tags)
    }

    /// Compares two profiles of this ranking: `Less` when the left one is
    /// the greater (§6).
    pub(crate) fn compare_profiles(&self, left: &Profile, right: &Profile) -> Ordering {
        self.profiles.compare(left, right)
    }

    /// Ranks the derivations of the reconstructed input of `elision-only`,
    /// whose tests of references read the projected span in O (§7.5).
    pub(crate) fn observing(mut self, observed: &'c [Tok], project: &'c [u32]) -> Ranker<'c> {
        self.dag.projection = Some((observed, project));
        self.dag.measures = Measures::new(observed);
        // Every projected omission has an empty span, so these steps count nothing.
        if !self.dag.g.has_errors
            && self.dag.measures.carried.iter().all(|measure| *measure == Measure::ZERO)
            && self.profiles.patterns.iter().all(crate::patterns::requires_elided)
        {
            self.summaries = None;
        }
        self
    }

    /// Ranks for the check of `elision-only` with runtime marks of W(D).
    /// Tests can observe this ranking (tests/README.md).
    pub(crate) fn checking(mut self, marks: Option<&'c Marks>) -> Ranker<'c> {
        self.check = true;
        self.dag.canonical_companions = true;
        self.marks = marks;
        if let (Some(view), Some(marks)) = (&self.restoration, marks) {
            self.projected_marks = Some(Rc::new(Marks {
                items: marks
                    .items
                    .iter()
                    .map(|&(set, index)| (set, view.aliases[set as usize][index as usize]))
                    .collect(),
                links: marks
                    .links
                    .iter()
                    .map(|&(set, index, start)| (set, view.aliases[set as usize][index as usize], start))
                    .collect(),
            }));
        }
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
        if let Some(shown) = self.witness_shown {
            return shown;
        }
        let mut stack = Vec::new();
        for act in sequence {
            match *act {
                WitnessAct::Read { tok, terminal } => {
                    stack.push(self.dag.push(DNode::Read { tok, terminal }, Nat::ONE, Nat::ONE));
                }
                WitnessAct::Close { set, index } => {
                    let item = self.item(set, index);
                    let arity = self.dag.g.prods[item.prod as usize].syms.len();
                    let arity = if arity == 0 && item.origin != set { 1 } else { arity };
                    let children = stack.split_off(stack.len() - arity);
                    let mut body = EMPTY;
                    for child in children {
                        body = self.dag.seq(body, child);
                    }
                    stack.push(self.dag.close(body, set, index));
                }
            }
        }
        assert_eq!(stack.len(), 1, "a restored witness has one root");
        stack[0]
    }

    pub(crate) fn pair_witness(&self, a: u32, b: u32) -> (Act, Act) {
        match self.dag.first_difference(a, b, true) {
            Diff::At { a, b, .. } => (a, b),
            _ => match self.dag.first_difference(a, b, false) {
                Diff::At { a, b, .. } => (a, b),
                _ => unreachable!("two different derivations differ"),
            },
        }
    }

    pub(crate) fn same_derivation(&self, a: u32, b: u32) -> bool {
        matches!(self.dag.first_difference(a, b, false), Diff::Equal)
    }

    /// Whether `a` comes before `b` in the order T.
    pub(crate) fn before(&self, a: u32, b: u32) -> bool {
        self.dag.before(a, b)
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
        let rule = self.dag.g.rules[rule as usize].splice_target.unwrap_or(rule);
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

    fn raw_deps(&mut self, key: Key) -> Deps {
        let deps = self.unprojected_deps(key);
        let Some(view) = &self.restoration else { return deps };
        let map = |(node, context)| {
            work::count(Work::Walked, 1);
            (view.node(node), context)
        };
        match deps {
            Deps::Close(child) => Deps::Close(child.map(map)),
            Deps::Group(nodes) => {
                let mut seen = crate::fxhash::FxSet::default();
                Deps::Group(nodes.into_iter().map(map).filter(|n| seen.insert(*n)).collect())
            }
            Deps::Links(links) => {
                let mut seen = crate::fxhash::FxSet::default();
                Deps::Links(links.into_iter().map(|(a, b)| (map(a), map(b))).filter(|n| seen.insert(*n)).collect())
            }
            _ => deps,
        }
    }
    fn unprojected_deps(&mut self, (node, fset): Key) -> Deps {
        let node = self.restoration.as_ref().map_or(node, |v| v.node(node));
        match node {
            Node::Absent => Deps::Close(None),
            Node::Scoped(_) => unreachable!("a raw forest node"),
            Node::Read { .. } => Deps::Leaf,
            Node::Item { set, index } => {
                let item = self.item(set, index);
                if item.dot == 0 {
                    return Deps::Leaf;
                }
                if self.dag.chart.machine.is_some() || self.dag.chart.boundaries.is_some() {
                    let g = self.dag.g;
                    let p = &g.prods[item.prod as usize];
                    let position = item.dot as usize - 1;
                    let mut links = Vec::new();
                    for (before, cap, option) in slot_links(g, self.dag.chart, set, item, self.restoration.as_deref()) {
                        let m = cap.start;
                        let Some(index) = self.dag.chart.sets[m as usize].find(&before) else {
                            continue;
                        };
                        let pred = (Node::Item { set: m, index }, if m == set { fset } else { 0 });
                        let child = match p.syms[position] {
                            Sym::T(terminal) => (Node::Read { tok: m, terminal }, 0),
                            Sym::N(rule) => (
                                Node::Group {
                                    route: p.routes.get(&position).copied().unwrap_or(0),
                                    requested: cap.close_requested,
                                    rule,
                                    origin: m,
                                    set,
                                    tags: cap.tags,
                                    test: p.test(position).unwrap_or(NO_TEST),
                                    structure: cap.proof_structure.unwrap_or(cap.structure),
                                    boundary: cap.boundary,
                                    lexical: self.dag.chart.expected_lexical(before, m),
                                    option,
                                },
                                if m == item.origin { fset } else { 0 },
                            ),
                        };
                        links.push((pred, child));
                    }
                    return Deps::Links(links);
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
                let pred = Item {
                    boundary: 0,
                    close_requested: item.close_requested,
                    lexical: item.lexical,
                    prod: item.prod,
                    dot: item.dot - 1,
                    origin: item.origin,
                    caps: previous,
                    prefix: 0,
                    structure: u32::MAX,
                };
                let mut links = Vec::new();
                let same = |m: u32, fset: u32| if m == set { fset } else { 0 };
                // The predecessors are rebuilt from completed spans, so a
                // tested symbol's test is applied again, to the candidate
                // constituent itself, with its own span and its own tags: a
                // derivation is made only of advances the test allowed (§4).
                let test_id = production.test(position).unwrap_or(NO_TEST);
                let test = self.dag.g.test(item.prod, position);
                let (tokens, tags) = (self.dag.tokens, self.dag.tags);
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
                            test_holds(test, span, tags, own)
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
                                // A contextual helper's items carry the frame
                                // the predecessor entered them in (§4).
                                let before = self.dag.chart.sets[m as usize].items[p as usize];
                                let child = Node::Group {
                                    route: production.routes.get(&position).copied().unwrap_or(0),
                                    requested: cap.close_requested,
                                    rule,
                                    origin: m,
                                    set,
                                    tags: cap.tags,
                                    test: NO_TEST,
                                    structure: cap.proof_structure.unwrap_or(cap.structure),
                                    boundary: cap.boundary,
                                    lexical: self.dag.chart.expected_lexical(before, m),
                                    option: usize::MAX,
                                };
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
                                    let before = self.dag.chart.sets[m as usize].items[p as usize];
                                    let child = Node::Group {
                                        route: production.routes.get(&position).copied().unwrap_or(0),
                                        requested: 0,
                                        rule,
                                        origin: m,
                                        set,
                                        tags: ANY,
                                        test: test_id,
                                        structure: ANY,
                                        boundary: ANY,
                                        lexical: self.dag.chart.expected_lexical(before, m),
                                        option: usize::MAX,
                                    };
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
                let rule = self.dag.g.rules[rule as usize].splice_target.unwrap_or(rule);
                if self.fsets[fset as usize].binary_search(&rule).is_ok() {
                    return Deps::Close(None);
                }
                let inner = self.fset_with(fset, rule);
                Deps::Close(Some((Node::Item { set, index }, inner)))
            }
            Node::Group { requested, route, rule, origin, set, tags, test, structure, boundary, lexical, option } => {
                let eset = &self.dag.chart.sets[set as usize];
                // A fault applies no test in the check (tests/README.md).
                let no_tests = self.dag.projection.is_some() && witness::fault_at(Fault::RankerTests, "group");
                let test = (test != NO_TEST && !no_tests).then(|| &self.dag.g.tests[test as usize]);
                let span = self.reference_span(origin, set);
                let tag_table = self.dag.tags;
                let members = eset
                    .completed
                    .get(&(rule, origin))
                    .map(|items| {
                        items
                            .iter()
                            .filter(|&&index| {
                                (route == 0 || self.dag.g.route(eset.items[index as usize].prod) == route)
                                    && (self.restoration.as_ref().map_or(eset.items[index as usize].lexical, |v| {
                                        v.frame(eset.items[index as usize].lexical)
                                    }) == lexical)
                                    && eset.items[index as usize].close_requested == requested
                                    && (option == usize::MAX
                                        || self.dag.g.ranked.options.get(&eset.items[index as usize].prod)
                                            == Some(&option))
                                    && (tags == ANY || eset.tagset[index as usize] == tags)
                                    && (structure == ANY
                                        || self
                                            .restoration
                                            .as_ref()
                                            .map_or(eset.completed_structures[index as usize], |v| {
                                                v.state(eset.completed_structures[index as usize])
                                            })
                                            == structure)
                                    && (boundary == ANY || eset.items[index as usize].boundary == boundary)
                            })
                            .filter(|&&index| {
                                test.map_or(true, |test| test_holds(test, span, tag_table, eset.tagset[index as usize]))
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
                Pass::Admission => {
                    self.admit(key, &deps);
                    let counts = self.count(key, &deps);
                    self.admission.as_mut().expect("admission").counts.insert(key, counts);
                }
                Pass::Summaries => {
                    let summary = self.summarize(key, &deps);
                    self.summaries.as_mut().expect("profiles").insert(key, summary);
                }
                Pass::Entries => {
                    let result = self.compute(key, deps);
                    work::count(Work::SummaryContexts, 1);
                    self.results.push(result);
                    self.memo.insert(key, (self.results.len() - 1) as u32);
                }
            }
        }
    }

    fn done(&self, pass: Pass, key: &Key) -> bool {
        match pass {
            Pass::Admission => self.admission.as_ref().is_some_and(|a| a.counts.contains_key(key)),
            Pass::Summaries => self.summaries.as_ref().is_some_and(|summaries| summaries.contains_key(key)),
            Pass::Entries => self.memo.contains_key(key),
        }
    }

    /// The nodes that `pass` needs before `key`: every dependency, except
    /// that under profiles the entries need only those of the edges that
    /// attain the greatest profile.
    fn needed(&mut self, pass: Pass, key: &Key, deps: &Deps) -> Vec<Key> {
        if pass == Pass::Admission {
            let mut keys = Self::keys(deps);
            for candidate in self.slot_candidates(*key) {
                let found = self.deps((candidate.node, key.1));
                if let Deps::Links(links) = found {
                    if let Some(&(a, b)) = links.get(candidate.edge) {
                        keys.extend([a, b]);
                    }
                }
            }
            return keys;
        }
        let summary = match (pass, &self.summaries) {
            (Pass::Entries, Some(summaries)) => &summaries[key],
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

    /// The summary of a node under profiles, from those of its
    /// dependencies (§6).
    fn summarize(&mut self, key: Key, deps: &Deps) -> Summary {
        let node = self.raw_node(key.0);
        let masks = self.admission.as_ref().and_then(|a| a.masks.get(&key)).cloned();
        let plain = |all: Least| Summary { all };
        match deps {
            Deps::Leaf => {
                let mut profile = Profile::ZERO;
                if let Node::Read { tok, terminal } = node {
                    let (p, q) = self
                        .dag
                        .projection
                        .map_or((tok, tok + 1), |(_, project)| (project[tok as usize], project[tok as usize + 1]));
                    if p < q {
                        let token = &self.dag.tokens[tok as usize];
                        profile = self.profiles.occurrence(
                            None,
                            Some(&self.dag.g.terminals[terminal as usize]),
                            &token.value,
                            token.tags,
                            self.dag.tags,
                            false,
                            p,
                            q,
                        );
                    }
                }
                if let Node::Read { tok, .. } = node {
                    let charge = self.profiles.measure_profile(&self.dag.carried_measure(tok));
                    profile = self.profiles.sum(&profile, &charge);
                }
                plain(Least::one(profile))
            }
            Deps::Close(None) => plain(Least::NONE),
            Deps::Close(Some(inner)) => {
                let Node::Close { set, index } = node else { unreachable!("a close") };
                let g = self.dag.g;
                let production = &g.prods[self.item(set, index).prod as usize];
                let rule = &g.rules[production.rule as usize];
                // The helper of an elidable optional that derives ε elides
                // its terminator where it is empty: an occurrence of
                // the omitted leaf with the empty span.
                let elides = production.syms.is_empty() && rule.elided.is_some();
                let origin = self.dag.chart.sets[set as usize].items[index as usize].origin;
                let (p, q) = self
                    .dag
                    .projection
                    .map_or((origin, set), |(_, project)| (project[origin as usize], project[set as usize]));
                let body = &self.summaries.as_ref().expect("profiles")[inner].all;
                if body.total == 0 {
                    return plain(Least::NONE);
                }
                let (least, total) = (body.least, body.total);
                let mut profile = body.profile.clone();
                let profiles = &mut self.profiles;
                if production.erased {
                    profile = Profile::ZERO;
                } else if production.error.is_some() {
                    let charge = profiles.measure_profile(&self.dag.own_measure(origin, set));
                    profile = profiles.sum(&profile, &charge);
                }
                if elides && self.dag.projection.is_none() {
                    let occurrence =
                        profiles.occurrence(None, rule.elided.as_deref(), "", 0, self.dag.tags, true, p, p);
                    profile = profiles.sum(&profile, &occurrence);
                }
                if p < q && !rule.helper {
                    let tags = self.dag.chart.sets[set as usize].tagset[index as usize];
                    let tokens = self.dag.projection.map_or(self.dag.tokens, |(observed, _)| observed);
                    let value = profiles.node_value(tokens, p, q);
                    let occurrence = profiles.occurrence(
                        Some(&rule.name),
                        None,
                        value.as_deref().unwrap_or(""),
                        tags,
                        self.dag.tags,
                        false,
                        p,
                        q,
                    );
                    profile = profiles.sum(&occurrence, &profile);
                }
                plain(Least { profile, least, total, kept: vec![0] })
            }
            Deps::Links(links) => {
                let summaries = self.summaries.as_ref().expect("profiles");
                let profiles = &mut self.profiles;
                let mut all = Least::NONE;
                for (index, &(pred, child)) in (0..).zip(links) {
                    let left = &summaries[&pred].all;
                    let right = &summaries[&child].all;
                    if left.total == 0 || right.total == 0 {
                        continue;
                    }
                    let least = left.least.saturating_mul(right.least).min(2);
                    let total = left.total.saturating_mul(right.total).min(2);
                    let profile = profiles.sum(&left.profile, &right.profile);
                    let edge = Least { profile, least, total, kept: Vec::new() };
                    if masks.as_ref().map_or(true, |m| m[index as usize]) {
                        all.add(profiles, index, &edge);
                    }
                }
                Summary { all }
            }
            Deps::Group(members) => {
                let summaries = self.summaries.as_ref().expect("profiles");
                let groups = self.erased_groups(members);
                let mut all = Least::NONE;
                for (erased, indices) in &groups {
                    let first = indices[0] as u32;
                    if *erased {
                        if let Some(summary) = indices
                            .iter()
                            .map(|&index| &summaries[&members[index]].all)
                            .find(|summary| summary.total > 0)
                        {
                            let class =
                                Least { profile: summary.profile.clone(), least: 1, total: 1, kept: Vec::new() };
                            all.add(&self.profiles, first, &class);
                        }
                    } else {
                        all.add(&self.profiles, first, &summaries[&members[indices[0]]].all);
                    }
                }
                let retained: crate::fxhash::FxSet<_> = all.kept.drain(..).collect();
                let mut mask = vec![false; members.len()];
                for (_, indices) in groups {
                    if retained.contains(&(indices[0] as u32)) {
                        for index in indices {
                            mask[index] = true;
                        }
                    }
                }
                all.kept =
                    mask.into_iter().enumerate().filter_map(|(index, keep)| keep.then_some(index as u32)).collect();
                plain(all)
            }
        }
    }

    /// Which edges of a node the entries take in, in each eligibility:
    /// under profiles, those that attain the greatest profile (§6), and
    /// otherwise every edge.
    fn kept(&self, key: &Key) -> Option<Vec<u32>> {
        let masks = self.admission.as_ref().and_then(|a| a.masks.get(key));
        if let Some(summary) = self.summaries.as_ref().map(|summaries| &summaries[key]) {
            Some(summary.all.kept.iter().copied().filter(|i| masks.map_or(true, |m| m[*i as usize])).collect())
        } else {
            masks.map(|m| m.iter().enumerate().filter_map(|(i, yes)| yes.then_some(i as u32)).collect())
        }
    }

    fn compute(&mut self, key: Key, deps: Deps) -> NodeResult {
        if self.summaries.as_ref().is_some_and(|summaries| summaries[&key].all.total == 0) {
            return NodeResult::default();
        }
        let node = self.raw_node(key.0);
        let kept = self.kept(&key);
        // Whether an item is marked, as a leaf or as the end of a marked
        // link (tests/README.md).
        let projected_marks = self.projected_marks.clone();
        let marks = projected_marks.as_deref().or(self.marks);
        let marked = |set: u32, index: u32| marks.is_some_and(|marks| marks.items.contains(&(set, index)));
        // The kept edges are sorted (`Least::keeps`).
        let in_all = |index: u32| kept.as_ref().map_or(true, |all| holds(all, index));
        match deps {
            Deps::Leaf => match node {
                Node::Read { tok, terminal } => {
                    let x = self.dag.push(DNode::Read { tok, terminal }, Nat::ONE, Nat::ONE);
                    NodeResult { entries: vec![Entry { x, comps: Vec::new() }], count: 1, w: true }
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
                    NodeResult { entries: vec![Entry { x, comps: Vec::new() }], count: 1, w: marked(set, index) }
                }
                _ => {
                    let w = matches!(node, Node::Item { set, index } if marked(set, index));
                    NodeResult { entries: vec![Entry { x: EMPTY, comps: Vec::new() }], count: 1, w }
                }
            },
            Deps::Links(links) => {
                let Node::Item { set, index } = node else { unreachable!("an item") };
                let mut all = NodeResult::default();
                let alternatives = links.len();
                for (number, (pred, child)) in (0..).zip(links) {
                    let to_all = in_all(number);
                    if !to_all {
                        continue;
                    }
                    let left = &self.results[self.memo[&pred] as usize];
                    let right = &self.results[self.memo[&child] as usize];
                    let ways = left.count.saturating_mul(right.count);
                    // The link is W(D)'s where it is marked, and its
                    // predecessor and child are W(D)'s.
                    let Node::Item { set: m, .. } = self.raw_node(pred.0) else { unreachable!("a predecessor item") };
                    let w = ways > 0
                        && left.w
                        && right.w
                        && marks.is_some_and(|marks| marks.links.contains(&(set, index, m)));
                    // Faults of the check skip the last of two or more links,
                    // in the count or in the entries (tests/README.md).
                    let counted = !self.skips(Fault::LostContext, "links", number, alternatives);
                    let selected = !self.skips(Fault::LostSelect, "links", number, alternatives);
                    if counted {
                        all.count = all.count.saturating_add(ways).min(2);
                        all.w |= w;
                    }
                    if !selected {
                        continue;
                    }
                    for first in &left.entries {
                        for second in &right.entries {
                            let entry = self.dag.product(first, second);
                            self.dag.add_entry(&mut all.entries, entry);
                        }
                    }
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
                NodeResult { entries: list, count: body.count, w: body.w }
            }
            Deps::Group(members) => {
                let mut list = Vec::new();
                let mut count = 0u8;
                let mut w = false;
                for (erased, indices) in self.erased_groups(&members) {
                    let mut present = Vec::new();
                    let mut counted = false;
                    let mut member = false;
                    for index in indices {
                        if !in_all(index as u32) {
                            continue;
                        }
                        let result = &self.results[self.memo[&members[index]] as usize];
                        if !self.skips(Fault::LostContext, "group", index as u32, members.len()) {
                            if erased {
                                counted |= result.count > 0;
                                member |= result.count > 0 && result.w;
                            } else {
                                count = count.saturating_add(result.count).min(2);
                                w |= result.count > 0 && result.w;
                            }
                        }
                        if self.skips(Fault::LostSelect, "group", index as u32, members.len()) {
                            continue;
                        }
                        if erased {
                            if result.count > 0 || self.witness_only {
                                present.push(members[index]);
                            }
                        } else {
                            for entry in &result.entries {
                                self.dag.add_entry(&mut list, entry.clone());
                            }
                        }
                    }
                    if erased {
                        if counted {
                            count = count.saturating_add(1).min(2);
                            w |= member;
                        }
                        if let Some(chosen) = self.canonical_erased(&present) {
                            self.dag.add_entry(&mut list, Entry { x: chosen, comps: Vec::new() });
                        }
                    }
                }
                NodeResult { entries: list, count, w }
            }
        }
    }

    /// Ranks the derivations of the start rule over the whole input; `None`
    /// if it has none (every one is cyclic).
    pub(crate) fn rank(&mut self) -> Option<Ranking> {
        let ranked = self.rank_inner();
        if let Some(a) = &self.admission {
            crate::slot_stats::record(&a.stats);
        }
        ranked
    }

    fn rank_inner(&mut self) -> Option<Ranking> {
        let n = (self.dag.chart.sets.len() - 1) as u32;
        // Every completed item of the start rule over the whole input is an
        // edge of one root (§6).
        let root = (
            Node::Group {
                route: 0,
                requested: self.dag.chart.close_requested,
                rule: self.dag.g.start,
                origin: 0,
                set: n,
                tags: ANY,
                test: NO_TEST,
                structure: ANY,
                boundary: ANY,
                lexical: 0,
                option: usize::MAX,
            },
            0,
        );
        if self.admission.is_some() {
            self.traverse(root, Pass::Admission);
        }
        // Under profiles, the total and the best count of the root,
        // before the forest is cut down to the best derivations.
        let counts = if self.summaries.is_some() {
            self.traverse(root, Pass::Summaries);
            let root = &self.summaries.as_ref().expect("profiles")[&root].all;
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
        let witness_counted = self.marks.map(|_| {
            if self.summaries.is_none() {
                return result.w;
            }
            // The witness hook counts recognition before profile filtering.
            let summaries = self.summaries.take();
            let memo = std::mem::take(&mut self.memo);
            let results = std::mem::take(&mut self.results);
            self.traverse(root, Pass::Entries);
            let counted = self.results[self.memo[&root] as usize].w;
            self.summaries = summaries;
            self.memo = memo;
            self.results = results;
            counted
        });
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
                Some((best, _)) if self.check => self.dag.before(d, *best),
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
        // Without a lean, the forest of the best derivations holds a second
        // one exactly when the best count is two. A disagreement is
        // a defect of the library, and like its other broken invariants it
        // panics, in release builds too, rather than pick a verdict.
        if let Some((_, least)) = counts.filter(|_| self.dag.lean == Lean::Neither) {
            assert_eq!(least >= 2, tied.is_some(), "the best count disagrees with the forest of the best derivations");
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
        let profile = self.summaries.as_ref().map_or(Profile::ZERO, |summaries| summaries[&root].all.profile.clone());
        Some(Ranking { verdict, first: chosen, second, witness, witness_counted, profile })
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

/// One component of a profile: the counts of one key step's pattern over
/// the nonempty spans, in increasing start and decreasing end order, the
/// sum of the counts, or the sequence of the starting positions (§6).
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Component {
    Spans(Vec<(u32, u32, Nat)>),
    Count(Nat),
    Sequence(u32),
}

/// A derivation's counts of every pattern that a key step tests, one
/// three measure components, then one per written key step (§6).
/// The profile with no component counts nothing.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Profile(Vec<Component>);

impl Profile {
    pub const ZERO: Self = Self(Vec::new());
    pub(crate) fn error_free(&self) -> bool {
        Profiles::measure(self).0[2] == Nat::ZERO
    }
}

/// The profiles of one ranking: how the key steps of its directive count
/// occurrences, add profiles and compare them (§6).
#[derive(Hash, PartialEq, Eq)]
struct RankingNodeKey {
    step: usize,
    name: Option<String>,
    terminal: Option<String>,
    value: Option<String>,
    set: u32,
    omitted: bool,
}

pub(crate) struct Profiles {
    steps: Vec<StepKind>,
    patterns: Vec<crate::patterns::Pattern>,
    answers: FxMap<RankingNodeKey, bool>,
    values: Vec<bool>,
    node_values: bool,
    span_values: FxMap<(u32, u32), std::rc::Rc<str>>,
    vectors: Vectors,
}

impl Profiles {
    pub(crate) fn new(steps: &[KeyStep]) -> Profiles {
        Profiles {
            steps: [StepKind::Fewest,StepKind::Fewest,StepKind::Most].into_iter().chain(steps.iter().map(|step| step.kind)).collect(),
            patterns: steps.iter().map(|step|step.pattern.clone()).collect(),
            answers: FxMap::default(),
            values: steps.iter().map(|step|step.pattern.walk().any(|part| matches!(part,crate::patterns::Part::Pattern(crate::patterns::Pattern::Test(op,_,_, _)) if op != "tags"))).collect(),
            node_values: steps.iter().any(|step| crate::patterns::reads_node_values(&step.pattern)),
            span_values: FxMap::default(),
            vectors: Vectors::new(),
        }
    }

    fn measure(profile: &Profile) -> Measure {
        Measure(std::array::from_fn(|index| match profile.0.get(index) {
            Some(Component::Count(value)) => value.clone(),
            _ => Nat::ZERO,
        }))
    }
    fn measure_profile(&self, measure: &Measure) -> Profile {
        if *measure == Measure::ZERO {
            return Profile::ZERO;
        }
        let mut components: Vec<_> = (0..self.steps.len()).map(|index| self.zero(index)).collect();
        for (index, value) in measure.0.iter().enumerate() {
            components[index] = Component::Count(value.clone());
        }
        Profile(components)
    }

    fn node_value(&mut self, tokens: &[Tok], start: u32, end: u32) -> Option<std::rc::Rc<str>> {
        if !self.node_values {
            return None;
        }
        if let Some(value) = self.span_values.get(&(start, end)) {
            return Some(value.clone());
        }
        let mut sound = String::new();
        let mut at = start as usize;
        while at < end as usize {
            work::count(Work::Spanned, 1);
            let token = &tokens[at];
            if token.quiet > 0 {
                at += token.quiet as usize;
                continue;
            }
            sound.push_str(token.sound());
            at += 1;
        }
        let value: std::rc::Rc<str> = sound.into();
        self.span_values.insert((start, end), value.clone());
        Some(value)
    }

    /// The component of a step that counts nothing.
    fn zero(&self, index: usize) -> Component {
        match self.steps[index] {
            StepKind::LeftmostLongest => Component::Spans(Vec::new()),
            StepKind::Fewest | StepKind::Most => Component::Count(Nat::ZERO),
            StepKind::Late | StepKind::Early => Component::Sequence(NO_ELISIONS),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn occurrence(
        &mut self,
        name: Option<&str>,
        terminal: Option<&str>,
        value: &str,
        set: u32,
        tags: &Tags,
        omitted: bool,
        p: u32,
        q: u32,
    ) -> Profile {
        let mut components: Option<Vec<Component>> = None;
        for index in 3..self.steps.len() {
            let key = RankingNodeKey {
                step: index,
                name: name.map(str::to_owned),
                terminal: terminal.map(str::to_owned),
                value: self.values[index - 3].then(|| value.to_owned()),
                set,
                omitted,
            };
            let matches = *self.answers.entry(key).or_insert_with(|| {
                let names: Vec<String> = if omitted {
                    vec![terminal.expect("omitted terminal").to_owned(), "_Elided".into()]
                } else {
                    tags.list(set).iter().map(|&id| tags.name(id).to_owned()).collect()
                };
                crate::patterns::local_matches_with_value(
                    &self.patterns[index - 3],
                    name,
                    terminal.map(|t| (t, value, names.as_slice())),
                    &names,
                    name.map(|_| value),
                )
            });
            if !matches {
                continue;
            }
            let components = components.get_or_insert_with(|| (0..self.steps.len()).map(|i| self.zero(i)).collect());
            components[index] = match self.steps[index] {
                StepKind::LeftmostLongest if p < q => Component::Spans(vec![(p, q, Nat::ONE)]),
                StepKind::LeftmostLongest => Component::Spans(Vec::new()),
                StepKind::Fewest | StepKind::Most => Component::Count(Nat::ONE),
                StepKind::Late | StepKind::Early => Component::Sequence(self.vectors.one(p)),
            };
        }
        components.map_or(Profile::ZERO, Profile)
    }

    /// Adds profiles component by component. The positions of `left`
    /// precede those of `right`.
    pub(crate) fn sum(&mut self, left: &Profile, right: &Profile) -> Profile {
        if left.0.is_empty() {
            return right.clone();
        }
        if right.0.is_empty() {
            return left.clone();
        }
        Profile(
            left.0
                .iter()
                .zip(&right.0)
                .map(|pair| match pair {
                    (Component::Spans(a), Component::Spans(b)) => Component::Spans(sum_spans(a, b)),
                    (Component::Count(a), Component::Count(b)) => Component::Count(a.add(b)),
                    (Component::Sequence(a), Component::Sequence(b)) => Component::Sequence(self.vectors.join(*a, *b)),
                    _ => unreachable!("the components of one step have one kind"),
                })
                .collect(),
        )
    }

    /// Compares two profiles step by step: `Less` when the left one is the
    /// greater, so that the left derivation wins (§6).
    pub(crate) fn compare(&self, left: &Profile, right: &Profile) -> Ordering {
        if left.0.is_empty() && right.0.is_empty() {
            return Ordering::Equal;
        }
        for (index, kind) in self.steps.iter().enumerate() {
            let zero = self.zero(index);
            let a = left.0.get(index).unwrap_or(&zero);
            let b = right.0.get(index).unwrap_or(&zero);
            let order = match (kind, a, b) {
                (_, Component::Spans(a), Component::Spans(b)) => compare_spans(a, b),
                (StepKind::Fewest, Component::Count(a), Component::Count(b)) => a.cmp(b),
                (_, Component::Count(a), Component::Count(b)) => b.cmp(a),
                (StepKind::Late, Component::Sequence(a), Component::Sequence(b)) => self.vectors.compare(*a, *b),
                (_, Component::Sequence(a), Component::Sequence(b)) => self.vectors.compare(*b, *a),
                _ => unreachable!("the components of one step have one kind"),
            };
            if order != Ordering::Equal {
                return order;
            }
        }
        Ordering::Equal
    }

    /// Counts every completed nonempty occurrence in a chosen tree, and no
    /// elision (§7). The occurrences are added in the order of their
    /// starting positions, as the sequences of `late` and `early` need.
    pub(crate) fn tree_profile(
        &mut self,
        g: &Lowered,
        tree: &crate::tree::ITree,
        tokens: &[Tok],
        tags: &Tags,
    ) -> Profile {
        let measures = Measures::new(tokens);
        let mut error_profile = Profile::ZERO;
        let mut occurrences = Vec::new();
        let mut pending = vec![0usize];
        while let Some(index) = pending.pop() {
            work::count(Work::Walked, 1);
            let node = &tree.nodes[index];
            let mut erased = false;
            match node.kind {
                crate::tree::IKind::Close { prod, start, end, tags, .. } => {
                    let production = &g.prods[prod as usize];
                    let rule = &g.rules[production.rule as usize];
                    erased = production.erased;
                    if !erased && production.error.is_some() {
                        let charge = self.measure_profile(&measures.own(start as usize, end as usize));
                        error_profile = self.sum(&error_profile, &charge);
                    }
                    if start < end && !rule.helper {
                        occurrences.push((start, end, Some(rule.name.as_str()), None, "", tags));
                    }
                }
                crate::tree::IKind::Read { tok, terminal } => {
                    let token = &tokens[tok as usize];
                    let charge = self.measure_profile(&measures.carried[tok as usize]);
                    error_profile = self.sum(&error_profile, &charge);
                    occurrences.push((
                        tok,
                        tok + 1,
                        None,
                        Some(g.terminals[terminal as usize].as_str()),
                        token.value.as_str(),
                        token.tags,
                    ));
                }
            }
            if !erased {
                pending.extend(node.children.iter().rev().map(|index| *index as usize));
            }
        }
        occurrences.sort_by_key(|&(start, _, _, _, _, _)| start);
        let mut profile = Profile::ZERO;
        for (p, q, name, terminal, value, set) in occurrences {
            let node_value = if name.is_some() { self.node_value(tokens, p, q) } else { None };
            let value = node_value.as_deref().unwrap_or(value);
            let occurrence = self.occurrence(name, terminal, value, set, tags, false, p, q);
            profile = self.sum(&profile, &occurrence);
        }
        self.sum(&profile, &error_profile)
    }
}

fn span_order(a: &(u32, u32, Nat), b: &(u32, u32, Nat)) -> Ordering {
    a.0.cmp(&b.0).then_with(|| b.1.cmp(&a.1))
}

/// Compares sparse span counts in start order and reverse end order:
/// `Less` when the left side wins.
fn compare_spans(left: &[(u32, u32, Nat)], right: &[(u32, u32, Nat)]) -> Ordering {
    for (a, b) in left.iter().zip(right) {
        let order = span_order(a, b).then_with(|| b.2.cmp(&a.2));
        if order != Ordering::Equal {
            return order;
        }
    }
    right.len().cmp(&left.len())
}

fn sum_spans(left: &[(u32, u32, Nat)], right: &[(u32, u32, Nat)]) -> Vec<(u32, u32, Nat)> {
    let mut result = Vec::with_capacity(left.len() + right.len());
    let (mut i, mut j) = (0, 0);
    while i < left.len() || j < right.len() {
        let order = match (left.get(i), right.get(j)) {
            (Some(a), Some(b)) => span_order(a, b),
            (Some(_), None) => Ordering::Less,
            _ => Ordering::Greater,
        };
        match order {
            Ordering::Less => {
                result.push(left[i].clone());
                i += 1;
            }
            Ordering::Greater => {
                result.push(right[j].clone());
                j += 1;
            }
            Ordering::Equal => {
                result.push((left[i].0, left[i].1, left[i].2.add(&right[j].2)));
                i += 1;
                j += 1;
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::{Least, Nat, Ordering, Profile, Profiles, VNode, Vectors};
    use crate::work::{assert_linear, Work};

    #[test]
    fn deferred_ranking_uses_all_three_measure_components() {
        // Engine §6: these shared cases require source fields that InputToken cannot hold.
        for name in [
            "shorter-blame",
            "finer-errors",
            "overlap-adds",
            "source-gaps",
            "sourceless-before-source",
            "sourceless-clean",
            "empty-tokens-nonempty-envelope",
            "ranked-blame",
            "ranked-finer-errors",
            "verdict-before-keys",
        ] {
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join(format!("../../tests/engine/deferred-measure-{name}.json"));
            let case = crate::json::parse(&std::fs::read_to_string(path).unwrap()).unwrap();
            let grammar = case.get("grammar").unwrap().as_str().unwrap();
            let resolution =
                if grammar.contains("%ambiguity-resolution") { "" } else { "%ambiguity-resolution greedy\n" };
            let document = format!("```jbogenbau\n%stage main\n{resolution}{grammar}\n```\n");
            let pipeline = crate::load_pipeline_sources([("p.md", document)], "p.md").unwrap();
            let grammar = pipeline.lowered_stage(0);
            let chars: Vec<_> = case.get("input").unwrap().as_str().unwrap().chars().collect();
            let mut shared = crate::earley::Shared::new(&pipeline.unicode, &chars);
            let index = |value: &crate::json::Json| match value {
                crate::json::Json::Int(value) => *value as usize,
                _ => panic!("an index"),
            };
            let tokens: Vec<_> = case
                .get("tokens")
                .unwrap()
                .as_array()
                .unwrap()
                .iter()
                .map(|token| {
                    let text = token.get("text").unwrap().as_str().unwrap();
                    let source = token.get("source").unwrap().as_array().unwrap();
                    crate::earley::Tok {
                        text: text.into(),
                        value: text.into(),
                        image: text.into(),
                        source: (index(&source[0]), index(&source[1])),
                        tags: shared.tags.set_of(
                            token.get("tags").unwrap().as_array().unwrap().iter().map(|tag| tag.as_str().unwrap()),
                        ),
                        sound: Default::default(),
                        quiet: 0,
                        before: Vec::new(),
                        after: Vec::new(),
                        errors: Vec::new(),
                        warnings: Vec::new(),
                    }
                })
                .collect();
            let matchers = crate::earley::matchers(&grammar, &mut shared.tags);
            let chart =
                crate::earley::Recognizer { g: &grammar, matchers: &matchers, shared: &mut shared, recon: None }
                    .recognize(&tokens, 0, grammar.start)
                    .unwrap();
            let mut ranker = super::Ranker::new(
                &grammar,
                &chart,
                &tokens,
                &shared,
                &pipeline.stages[0].steps,
                pipeline.stages[0].lean,
            );
            let ranking = ranker.rank().unwrap();
            let expected = case.get("expect").unwrap().get("result").unwrap();
            let verdict = match ranking.verdict {
                super::Verdict::Unique => "unique",
                super::Verdict::Resolved => "resolved",
                super::Verdict::Tie => "tie",
            };
            assert_eq!(
                verdict,
                expected.get("stages").unwrap().as_array().unwrap()[0].get("verdict").unwrap().as_str().unwrap(),
                "{name}"
            );
            let tree = crate::tree::build(&ranker, ranking.first);
            let codes: Vec<_> = tree
                .nodes
                .iter()
                .filter_map(|node| match node.kind {
                    crate::tree::IKind::Close { prod, .. } if grammar.prods[prod as usize].error.is_some() => {
                        Some(grammar.rules[grammar.prods[prod as usize].rule as usize].name.as_str())
                    }
                    _ => None,
                })
                .collect();
            let expected_codes: Vec<_> = expected
                .get("error")
                .and_then(|error| error.get("errors"))
                .and_then(crate::json::Json::as_array)
                .into_iter()
                .flatten()
                .map(|error| error.get("code").unwrap().as_str().unwrap())
                .collect();
            assert_eq!(codes, expected_codes, "{name}");
        }
    }

    #[test]
    fn deferred_ranking_preserves_fixed_carried_charges() {
        // Engine §6: public coordinates do not replace a carried diagnostic's charge.
        let source="```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%rule text left | right\n%rule left erased A\n%rule right A erased\n%rule erased A\n%erased\n```\n";
        let pipeline = crate::load_pipeline_sources([("p.md", source)], "p.md").unwrap();
        let grammar = pipeline.lowered_stage(0);
        let text = ['a', 'a'];
        let mut shared = crate::earley::Shared::new(&pipeline.unicode, &text);
        let tokens: Vec<_> = [10, 1]
            .into_iter()
            .enumerate()
            .map(|(index, charge)| {
                let mut error =
                    crate::result::Warning::new("before".into(), "fault".into(), 0..100, 0..100, "fault".into());
                error.record = Some(std::sync::Arc::new(crate::measures::DiagnosticRecord {
                    identity: std::sync::Arc::new(crate::measures::DiagnosticIdentity {
                        stage_order: 0,
                        ordinal: index,
                        ..Default::default()
                    }),
                    measure: crate::measures::Measure([Nat::Small(charge), Nat::ZERO, Nat::ONE]),
                }));
                crate::earley::Tok {
                    text: "a".into(),
                    value: "a".into(),
                    image: "a".into(),
                    tags: shared.tags.set_of(["A"]),
                    source: (index, index + 1),
                    sound: Default::default(),
                    quiet: 0,
                    before: Vec::new(),
                    after: Vec::new(),
                    errors: vec![error],
                    warnings: Vec::new(),
                }
            })
            .collect();
        let matchers = crate::earley::matchers(&grammar, &mut shared.tags);
        let chart = crate::earley::Recognizer { g: &grammar, matchers: &matchers, shared: &mut shared, recon: None }
            .recognize(&tokens, 0, grammar.start)
            .unwrap();
        let mut ranker = super::Ranker::new(&grammar, &chart, &tokens, &shared, &[], crate::grammar::Lean::Neither);
        let result = ranker.rank().unwrap();
        assert_eq!(result.verdict, super::Verdict::Unique);
        assert_eq!(Profiles::measure(&result.profile), crate::measures::Measure([Nat::ONE, Nat::ZERO, Nat::ONE]));
        let tree = crate::tree::build(&ranker, result.first);
        assert!(tree.nodes.iter().any(|node|matches!(node.kind,crate::tree::IKind::Close{prod,..} if grammar.rules[grammar.prods[prod as usize].rule as usize].name=="left")));
    }

    #[test]
    fn deferred_reconstruction_projects_own_and_carried_charges() {
        // Engine §7.7: a synthetic anchor adds no source and carries no original charge.
        let source = "```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%rule text A\n```\n";
        let pipeline = crate::load_pipeline_sources([("p.md", source)], "p.md").unwrap();
        let grammar = pipeline.lowered_stage(0);
        let shared = crate::earley::Shared::new(&pipeline.unicode, &[]);
        let token = |source| crate::earley::Tok {
            text: "a".into(),
            value: "a".into(),
            image: "a".into(),
            tags: 0,
            source,
            sound: Default::default(),
            quiet: 0,
            before: Vec::new(),
            after: Vec::new(),
            errors: Vec::new(),
            warnings: Vec::new(),
        };
        let mut original = vec![token((10, 11)), token((0, 1))];
        let mut error = crate::result::Warning::new("before".into(), "fault".into(), 0..1, 0..1, "fault".into());
        error.record = Some(std::sync::Arc::new(crate::measures::DiagnosticRecord {
            identity: std::sync::Arc::new(crate::measures::DiagnosticIdentity {
                stage_order: 0,
                ordinal: 0,
                ..Default::default()
            }),
            measure: crate::measures::Measure([Nat::Small(7), Nat::ZERO, Nat::ONE]),
        }));
        original[1].errors.push(error);
        let reconstruction = vec![original[0].clone(), token((500, 500)), original[1].clone()];
        let chart = crate::earley::Chart::default();
        let project = [0, 1, 1, 2];
        let ranker = super::Ranker::new_unfiltered(
            &grammar,
            &chart,
            &reconstruction,
            &shared,
            &[],
            crate::grammar::Lean::Neither,
        )
        .observing(&original, &project);
        assert_eq!(ranker.dag.own_measure(1, 3), crate::measures::Measure([Nat::ONE, Nat::ZERO, Nat::ONE]));
        assert_eq!(ranker.dag.own_measure(1, 2), crate::measures::Measure([Nat::ZERO, Nat::ONE, Nat::ONE]));
        assert_eq!(ranker.dag.carried_measure(1), crate::measures::Measure::ZERO);
        assert_eq!(ranker.dag.carried_measure(2), crate::measures::Measure([Nat::Small(7), Nat::ZERO, Nat::ONE]));
    }

    #[test]
    fn deferred_erased_action_summaries_cost_linear_work() {
        // Engine §6: two shared summary channels do not enumerate erased derivations.
        let mut counts = Vec::new();
        for n in [2, 8, 32] {
            crate::work::reset();
            let mut rules = String::from("%rule text gone\n%rule gone r0\n%erased\n");
            for index in 0..n {
                rules.push_str(&format!("%rule r{index} r{0} | r{0}\n", index + 1));
            }
            rules.push_str(&format!("%rule r{n} A\n"));
            let source = format!("```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n{rules}```\n");
            let pipeline = crate::load_pipeline_sources([("p.md", source)], "p.md").unwrap();
            pipeline.lowered_stage(0);
            crate::work::reset();
            crate::work::budget(Work::SummaryContexts, 100 * n + 100);
            crate::work::budget(Work::Walked, 500 * n + 500);
            let token =
                crate::InputToken { text: "a".into(), tags: ["A".into()].into_iter().collect(), ..Default::default() };
            let result = pipeline.parse_tokens(&[token], &Default::default()).unwrap();
            assert!(result.ok);
            assert_eq!(result.stages[0].verdict, Some(crate::Verdict::Unique));
            let contexts = crate::work::counted(Work::SummaryContexts);
            eprintln!("erased contexts n={n}: {contexts}");
            counts.push(contexts);
        }
        crate::work::reset();
        assert!(counts[2] <= 5 * counts[1]);
    }

    /// A node whose many edges all attain the least vector keeps them all,
    /// and asking of each edge whether it is kept costs about one step, not
    /// one for each kept edge.
    #[test]
    fn kept_edges_are_found_without_a_scan() {
        let profiles = Profiles::new(&[]);
        assert_linear(Work::Kept, 40_000, &mut |n| {
            let mut least = Least::NONE;
            for index in 0..n as u32 {
                least.add(&profiles, index, &Least::one(Profile::ZERO));
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

// Ranking views retain the written invocation through generated helpers.
// Raw chart items, completion tables and derivation actions remain unchanged.
#[derive(Clone, Default)]
struct SlotScope {
    frames: Vec<Node>,
    bounds: Vec<Node>,
}
#[derive(Clone)]
struct SlotViews {
    wrapped: std::collections::BTreeSet<u32>,
    nodes: Vec<(Node, usize)>,
    index: FxMap<(Node, usize), Node>,
    scopes: Vec<SlotScope>,
    scope_index: FxMap<(Node, Node, usize), usize>,
}
impl SlotViews {
    fn new(g: &Lowered) -> Option<Self> {
        if g.ranked.slots.is_empty() {
            return None;
        }
        let mut users: FxMap<u32, Vec<u32>> = FxMap::default();
        for p in &g.prods {
            if !p.tree_root {
                for s in &p.syms {
                    if let Sym::N(r) = s {
                        users.entry(*r).or_default().push(p.rule);
                    }
                }
            }
        }
        let mut wrapped: std::collections::BTreeSet<u32> = g.ranked.slots.keys().copied().collect();
        let mut pending: Vec<u32> = g.ranked.slots.keys().copied().collect();
        let mut at = 0;
        while at < pending.len() {
            for &parent in users.get(&pending[at]).into_iter().flatten() {
                if wrapped.insert(parent) {
                    pending.push(parent);
                }
            }
            at += 1;
        }
        if wrapped.is_empty() {
            return None;
        }
        Some(Self {
            wrapped,
            nodes: vec![],
            index: FxMap::default(),
            scopes: vec![SlotScope::default()],
            scope_index: FxMap::default(),
        })
    }
    fn unpack(&self, node: Node) -> (Node, usize) {
        match node {
            Node::Scoped(id) => self.nodes[id as usize],
            _ => (node, 0),
        }
    }
    fn view(&mut self, node: Node, scope: usize) -> Node {
        if scope == 0 || matches!(node, Node::Read { .. }) {
            return node;
        }
        if let Some(&old) = self.index.get(&(node, scope)) {
            return old;
        }
        let found = Node::Scoped(self.nodes.len() as u32);
        self.nodes.push((node, scope));
        self.index.insert((node, scope), found);
        found
    }
    fn written_parent(&self, node: Node, g: &Lowered, chart: &Chart) -> Option<u32> {
        let (_, scope) = self.unpack(node);
        let Node::Item { set, index } = *self.scopes[scope].frames.first()? else {
            return None;
        };
        Some(g.prods[chart.sets[set as usize].items[index as usize].prod as usize].rule)
    }
    fn ranked_prefix_key(
        &self,
        scope: usize,
        g: &Lowered,
        chart: &Chart,
        projection: Option<&RestorationView>,
    ) -> String {
        let state = &self.scopes[scope];
        let frames: Vec<_> = state
            .frames
            .iter()
            .map(|node| {
                let Node::Item { set, index } = *node else { unreachable!() };
                written_frame(g, chart, chart.sets[set as usize].items[index as usize], set, projection)
            })
            .collect();
        let bounds: Vec<_> = state
            .bounds
            .iter()
            .map(|node| {
                let Node::Group { rule, origin, set, .. } = *node else { unreachable!() };
                (g.ranked.written.get(&rule), origin, set)
            })
            .collect();
        format!("{frames:?}/{bounds:?}")
    }
}
impl Ranker<'_> {
    fn raw_node(&self, node: Node) -> Node {
        self.views.as_ref().map_or(node, |v| v.unpack(node).0)
    }
    fn prepare_views(&mut self) -> Vec<Node> {
        let mut nodes = vec![];
        for (set, items) in self.dag.chart.sets.iter().enumerate() {
            for index in 0..items.items.len() {
                nodes.push(Node::Item { set: set as u32, index: index as u32 });
            }
        }
        if self.views.is_none() {
            return nodes;
        }
        let mut seen: crate::fxhash::FxSet<Node> = nodes.iter().copied().collect();
        let mut at = 0;
        while at < nodes.len() {
            let deps = self.deps((nodes[at], 0));
            for (node, _) in Self::keys(&deps) {
                if seen.insert(node) {
                    nodes.push(node);
                }
            }
            at += 1;
        }
        nodes
    }
    fn helper_scope(&mut self, before: Node, carrier: Node, outer: usize) -> usize {
        let Node::Item { set, index } = before else { unreachable!() };
        let Node::Group { rule, .. } = carrier else { unreachable!() };
        let own = self.dag.g.prods[self.item(set, index).prod as usize].rule;
        if outer != 0 && own == rule {
            return outer;
        }
        let views = self.views.as_mut().unwrap();
        if let Some(&old) = views.scope_index.get(&(before, carrier, outer)) {
            return old;
        }
        let mut scope = views.scopes[outer].clone();
        scope.frames.push(before);
        scope.bounds.push(carrier);
        let id = views.scopes.len();
        views.scopes.push(scope);
        views.scope_index.insert((before, carrier, outer), id);
        id
    }
    fn deps(&mut self, key: Key) -> Deps {
        let deps = self.contextual_deps(key);
        if !self.witness_only {
            return deps;
        }
        let projected_marks = self.projected_marks.clone();
        let marks = projected_marks.as_deref().or(self.marks).expect("a displayed witness has marks");
        let marked = |key: Key| matches!(self.raw_node(key.0),Node::Item{set,index}|Node::Close{set,index} if marks.items.contains(&(set,index)));
        match deps {
            Deps::Group(members) => {
                let mut keep = vec![false; members.len()];
                for (erased, indices) in self.erased_groups(&members) {
                    if erased {
                        if indices.iter().any(|&index| marked(members[index])) {
                            for index in indices {
                                keep[index] = true;
                            }
                        }
                    } else {
                        let index = indices[0];
                        keep[index] = marked(members[index]);
                    }
                }
                Deps::Group(
                    members
                        .into_iter()
                        .enumerate()
                        .map(|(index, key)| if keep[index] { key } else { (Node::Absent, 0) })
                        .collect(),
                )
            }
            Deps::Links(links) => {
                let Node::Item { set, index } = self.raw_node(key.0) else { unreachable!() };
                Deps::Links(
                    links
                        .into_iter()
                        .map(|(before, child)| {
                            let Node::Item { set: start, .. } = self.raw_node(before.0) else { unreachable!() };
                            if marked(before) && marks.links.contains(&(set, index, start)) {
                                (before, child)
                            } else {
                                (before, (Node::Absent, 0))
                            }
                        })
                        .collect(),
                )
            }
            Deps::Leaf if matches!(self.raw_node(key.0), Node::Item { .. }) && !marked(key) => Deps::Close(None),
            _ => deps,
        }
    }

    fn contextual_deps(&mut self, key: Key) -> Deps {
        let Some(views) = &self.views else {
            return self.raw_deps(key);
        };
        let (raw, scope) = views.unpack(key.0);
        let deps = self.raw_deps((raw, key.1));
        match deps {
            Deps::Leaf | Deps::Close(None) => deps,
            Deps::Close(Some((node, context))) => {
                let context = if scope == 0 { context } else { key.1 };
                Deps::Close(Some((self.views.as_mut().unwrap().view(node, scope), context)))
            }
            Deps::Group(nodes) => Deps::Group(
                nodes
                    .into_iter()
                    .map(|(node, context)| (self.views.as_mut().unwrap().view(node, scope), context))
                    .collect(),
            ),
            Deps::Links(links) => {
                let Node::Item { set, index } = raw else { unreachable!() };
                let own = self.dag.g.prods[self.item(set, index).prod as usize].rule;
                let mut found = vec![];
                for ((previous, pf), (child, cf)) in links {
                    let carries = matches!(child, Node::Group {rule, ..} if self.views.as_ref().unwrap().wrapped.contains(&rule))
                        && (self.dag.g.rules[own as usize].splice_target.is_some()
                            || !self.dag.g.rules[own as usize].helper
                            || scope != 0);
                    let pred = (self.views.as_mut().unwrap().view(previous, scope), pf);
                    if carries {
                        let inner = self.helper_scope(previous, child, scope);
                        found.push((pred, (self.views.as_mut().unwrap().view(child, inner), cf)));
                    } else {
                        found.push((pred, (child, cf)));
                    }
                }
                Deps::Links(found)
            }
        }
    }
}
