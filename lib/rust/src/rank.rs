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

use crate::earley::{test_holds, Cap, Chart, Item, Shared, Tok};
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
        rule: u32,
        origin: u32,
        set: u32,
        tags: u32,
        test: u32,
        structure: u32,
        lexical: u32,
        option: usize,
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
    group: usize,
}
#[derive(Default)]
struct Counts {
    all: u8,
    allowed: u8,
    w: bool,
    allowed_w: bool,
}
type SlotMaxima = (std::collections::BTreeSet<String>, std::collections::BTreeSet<String>);
struct Admission {
    groups: Vec<Vec<SlotCandidate>>,
    at: FxMap<Node, Vec<SlotCandidate>>,
    counts: FxMap<Key, Counts>,
    masks: FxMap<Key, (Vec<bool>, Vec<bool>)>,
    maxima: FxMap<(usize, u32, Option<u32>), SlotMaxima>,
    stats: crate::slot_stats::SlotStatistics,
}
/// The packed chart keeps raw proofs together. Admission separates the
/// options at a slot edge while retaining every proof of each option.
fn slot_links(g: &Lowered, chart: &Chart, set: u32, item: Item) -> Vec<(Item, Cap, usize)> {
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
                if child.lexical == lexical
                    && child.structure == cap.structure
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
fn written_frame(g: &Lowered, chart: &Chart, item: Item, at: u32) -> String {
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
        .filter_map(|(name, cap)| name.as_ref().map(|name| (name, cap)))
        .collect();
    let lexical = chart.lexical_frame(item.lexical).map(|f| &f.key);
    let path = g.ranked.written.get(&p.rule);
    let index = chart.sets[at as usize].find(&item).expect("a written prefix");
    format!(
        "{:?}/{path:?}/{control:?}/{}/{}/{captures:?}/{lexical:?}/{}/{}",
        p.slot.as_ref().unwrap().source,
        item.dot,
        item.origin,
        item.prefix,
        chart.sets[at as usize].is_strict(index as usize)
    )
}
impl Admission {
    fn new(g: &Lowered, chart: &Chart, views: Option<&SlotViews>, nodes: &[Node]) -> Self {
        if !g.ranked.slots.is_empty() {
            return Self::new_ranked(g, chart, views, nodes);
        }
        let mut groups = Vec::<Vec<SlotCandidate>>::new();
        let mut group_ids = FxMap::<String, usize>::default();
        let mut at = FxMap::<Node, Vec<SlotCandidate>>::default();
        let mut stats = crate::slot_stats::SlotStatistics {
            chart_facts: chart.sets.iter().map(|s| s.items.len()).sum(),
            ..Default::default()
        };
        for &node in nodes {
            let (raw, scope) = views.map_or((node, 0), |views| views.unpack(node));
            let Node::Item { set: end, index } = raw else { continue };
            let item = &chart.sets[end as usize].items[index as usize];
            if g.rules[g.prods[item.prod as usize].rule as usize].helper && scope == 0 {
                continue;
            }
            let p = &g.prods[item.prod as usize];
            let Some(position) = (item.dot as usize).checked_sub(1) else { continue };
            let Sym::N(rule) = p.syms[position] else { continue };
            if g.rules[rule as usize].helper {
                continue;
            }
            let name = &g.rules[rule as usize].name;
            let Some(&component) = g.preferences.labels.get(name) else { continue };
            let v = &g.preferences.variants[name];
            for (edge, (previous, cap)) in chart.links.get(&(end, *item)).into_iter().flatten().enumerate() {
                let pp = &g.prods[previous.prod as usize];
                let prefix_symbols = pp.syms[..previous.dot as usize]
                    .iter()
                    .enumerate()
                    .map(|(i, s)| match s {
                        Sym::T(t) => {
                            format!("T{} {:?}", g.terminals[*t as usize], pp.test(i).map(|x| &g.tests[x as usize]))
                        }
                        Sym::N(r) => {
                            let role = if g.rules[*r as usize].helper {
                                g.prods[g.rules[*r as usize].prods[0] as usize]
                                    .slot
                                    .as_ref()
                                    .and_then(|s| s.path)
                                    .and_then(|id| v.paths.get(&id))
                                    .cloned()
                                    .unwrap_or_else(|| format!("helper{r}"))
                            } else {
                                g.rules[*r as usize].name.clone()
                            };
                            format!("N{role} {:?}", pp.test(i).map(|x| &g.tests[x as usize]))
                        }
                    })
                    .collect::<Vec<_>>();
                let captures = chart
                    .caps(previous.caps)
                    .iter()
                    .enumerate()
                    .map(|(i, c)| {
                        let name = pp.slot.as_ref().expect("a slot parent").names.get(i).and_then(|n| n.as_ref());
                        let role = name
                            .map(|n| v.roles.get(n).unwrap_or(n))
                            .cloned()
                            .unwrap_or_else(|| format!("implicit{}", pp.cap_pos[i]));
                        (role, *c)
                    })
                    .collect::<Vec<_>>();
                let previous_index = chart.sets[cap.start as usize].find(previous).expect("a predecessor");
                let role =
                    pp.slot.as_ref().and_then(|s| s.path).and_then(|id| v.paths.get(&id)).cloned().unwrap_or_default();
                let ancestry = views.map(|views| views.prefix_key(scope, v, g, chart));
                let key = format!(
                    "{component}/{ancestry:?}/{role}/{prefix_symbols:?}/{}/{}/{captures:?}/{}/{}/{}",
                    previous.origin,
                    previous.prefix,
                    chart.sets[cap.start as usize].is_strict(previous_index as usize),
                    cap.start,
                    cap.end
                );
                let group = *group_ids.entry(key).or_insert_with(|| {
                    groups.push(vec![]);
                    groups.len() - 1
                });
                let candidate = SlotCandidate { node, edge, label: name.clone(), group };
                groups[group].push(candidate.clone());
                at.entry(candidate.node).or_default().push(candidate);
                stats.candidate_edges += 1;
            }
        }
        stats.groups = groups.len();
        Self { groups, at, counts: FxMap::default(), masks: FxMap::default(), maxima: FxMap::default(), stats }
    }
    fn new_ranked(g: &Lowered, chart: &Chart, views: Option<&SlotViews>, nodes: &[Node]) -> Self {
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
            if g.rules[p.rule as usize].helper && scope == 0 {
                continue;
            }
            if item.dot == 0 {
                continue;
            }
            let Sym::N(rule) = p.syms[item.dot as usize - 1] else { continue };
            let Some(group_id) = g.ranked.slots.get(&rule) else { continue };
            let routed = views.is_some_and(|v| v.routes.contains_key(&node));
            let mut edge = 0;
            for (previous, cap, option) in slot_links(g, chart, end, item) {
                let pp = &g.prods[previous.prod as usize];
                let prefix = written_frame(g, chart, previous, cap.start);
                let ancestry = views.map(|v| v.ranked_prefix_key(scope, g, chart));
                let key = format!("{group_id}/{prefix}/{ancestry:?}/{}/{}", cap.start, cap.end);
                let group = *ids.entry(key).or_insert_with(|| {
                    groups.push(vec![]);
                    groups.len() - 1
                });
                let copies = if routed { 2 } else { 1 };
                for offset in 0..copies {
                    let candidate = SlotCandidate { node, edge: edge + offset, label: format!("{option:020}"), group };
                    groups[group].push(candidate.clone());
                    at.entry(node).or_default().push(candidate);
                    stats.candidate_edges += 1;
                }
                edge += copies;
                let _ = pp;
            }
        }
        stats.groups = groups.len();
        Self { groups, at, counts: FxMap::default(), masks: FxMap::default(), maxima: FxMap::default(), stats }
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
            if let Some(mask) = self.views.as_ref().and_then(|v| v.routes.get(&key.0)).cloned() {
                self.admission.as_mut().unwrap().masks.insert(key, mask);
            }
            return;
        };
        let Deps::Links(links) = deps else { unreachable!("a slot advance") };
        let mut masks = (vec![false; links.len()], vec![false; links.len()]);
        for choice in choices {
            let context = self.availability_key(key, choice.group);
            if !self.admission.as_ref().unwrap().maxima.contains_key(&context) {
                let mut all = std::collections::BTreeSet::new();
                let mut allowed = std::collections::BTreeSet::new();
                let candidates = self.admission.as_ref().unwrap().groups[choice.group].clone();
                for candidate in candidates {
                    let Deps::Links(found) = self.deps((candidate.node, key.1)) else { unreachable!() };
                    let Some(&(pred, child)) = found.get(candidate.edge) else { continue };
                    let Node::Item { set, index } = self.raw_node(candidate.node) else { unreachable!() };
                    let (guarded, test) = self.guard(set, index);
                    let (elided, permitted) = self.eligibility(child.0, guarded, test);
                    let a = self.admission.as_ref().unwrap();
                    let left = &a.counts[&pred];
                    let right = &a.counts[&child];
                    let ways = if elided { left.allowed } else { left.all };
                    if ways > 0 && right.all > 0 {
                        all.insert(candidate.label.clone());
                        if permitted {
                            allowed.insert(candidate.label);
                        }
                    }
                }
                let maximal = |labels: &std::collections::BTreeSet<String>| {
                    if !self.dag.g.ranked.slots.is_empty() {
                        return labels.iter().next().cloned().into_iter().collect();
                    }
                    labels
                        .iter()
                        .filter(|n| !labels.iter().any(|h| self.dag.g.preferences.paths[h].contains_key(*n)))
                        .cloned()
                        .collect()
                };
                let maxima = (maximal(&all), maximal(&allowed));
                self.admission.as_mut().unwrap().maxima.insert(context, maxima);
            }
            let (all, allowed) = &self.admission.as_ref().unwrap().maxima[&context];
            let routes = self.views.as_ref().and_then(|v| v.routes.get(&key.0));
            masks.0[choice.edge] = all.contains(&choice.label) && routes.map_or(true, |r| r.0[choice.edge]);
            masks.1[choice.edge] = allowed.contains(&choice.label) && routes.map_or(true, |r| r.1[choice.edge]);
        }
        let a = self.admission.as_mut().unwrap();
        a.stats.retained_edges += masks.0.iter().filter(|x| **x).count();
        a.masks.insert(key, masks);
    }
    fn count(&self, key: Key, deps: &Deps) -> Counts {
        let a = self.admission.as_ref().unwrap();
        let marks = self.marks;
        match deps {
            Deps::Leaf => {
                let valid = match self.raw_node(key.0) {
                    Node::Item { set, index } if self.item(set, index).origin != set => {
                        !witness::fault(Fault::RankRestoration)
                    }
                    _ => true,
                };
                let w = match self.raw_node(key.0) {
                    Node::Read { .. } => true,
                    Node::Item { set, index } => marks.is_some_and(|m| m.items.contains(&(set, index))),
                    _ => false,
                };
                Counts { all: u8::from(valid), allowed: u8::from(valid), w: valid && w, allowed_w: valid && w }
            }
            Deps::Close(None) => Counts::default(),
            Deps::Close(Some(k)) => {
                let body = &a.counts[k];
                Counts { all: body.all, allowed: body.all, w: body.w, allowed_w: body.w }
            }
            Deps::Group(members) => {
                let mut result = Counts::default();
                for (i, k) in members.iter().enumerate() {
                    if self.skips(Fault::LostContext, "group", i as u32, members.len()) {
                        continue;
                    }
                    let c = &a.counts[k];
                    result.all = result.all.saturating_add(c.all).min(2);
                    result.w |= c.all > 0 && c.w;
                }
                result.allowed = result.all;
                result.allowed_w = result.w;
                result
            }
            Deps::Links(links) => {
                let Node::Item { set, index } = self.raw_node(key.0) else { unreachable!() };
                let (guarded, test) = self.guard(set, index);
                let mut result = Counts::default();
                let mask = a.masks.get(&key);
                for (i, &(pred, child)) in links.iter().enumerate() {
                    if self.skips(Fault::LostContext, "links", i as u32, links.len()) {
                        continue;
                    }
                    let (elided, permitted) = self.eligibility(child.0, guarded, test);
                    let left = &a.counts[&pred];
                    let right = &a.counts[&child];
                    let ways = (if elided { left.allowed } else { left.all }).saturating_mul(right.all).min(2);
                    if mask.map_or(true, |m| m.0[i]) {
                        result.all = result.all.saturating_add(ways).min(2);
                        let Node::Item { set: m, .. } = self.raw_node(pred.0) else { unreachable!() };
                        result.w |= ways > 0
                            && (if elided { left.allowed_w } else { left.w })
                            && right.w
                            && marks.is_some_and(|marks| marks.links.contains(&(set, index, m)));
                    }
                    if permitted && mask.map_or(true, |m| m.1[i]) {
                        result.allowed = result.allowed.saturating_add(ways).min(2);
                        let Node::Item { set: m, .. } = self.raw_node(pred.0) else { unreachable!() };
                        result.allowed_w |= ways > 0
                            && (if elided { left.allowed_w } else { left.w })
                            && right.w
                            && marks.is_some_and(|marks| marks.links.contains(&(set, index, m)));
                    }
                }
                if !guarded {
                    result.allowed = result.all;
                    result.allowed_w = result.w;
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
    /// With the witness hook's marks, whether the count counted W(D): the
    /// root has the bit (tests/README.md).
    pub witness_counted: Option<bool>,
    pub profile: Profile,
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
    profile: Profile,
    least: u8,
    total: u8,
    kept: Vec<u32>,
}

impl Least {
    const NONE: Least = Least { vector: NO_ELISIONS, profile: Vec::new(), least: 0, total: 0, kept: Vec::new() };

    fn one(vector: u32) -> Least {
        Least { vector, profile: Vec::new(), least: 1, total: 1, kept: vec![0] }
    }

    /// Adds the derivations of the edge `index`. The total counts every
    /// edge, losing ones included; the least count and the kept edges
    /// count only those that attain the least vector.
    fn add(&mut self, vectors: &Vectors, index: u32, edge: &Least) {
        if edge.total == 0 {
            return;
        }
        self.total = self.total.saturating_add(edge.total).min(2);
        let order = if self.least == 0 {
            Ordering::Less
        } else {
            compare_profiles(&edge.profile, &self.profile).then_with(|| vectors.compare(edge.vector, self.vector))
        };
        match order {
            Ordering::Less => {
                self.vector = edge.vector;
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
    count_elisions: bool,
    vectors: Vectors,
    summaries: FxMap<Key, Summary>,
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
    /// The maximal terminators, if there are any (§4).
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
    admission: Option<Admission>,
    views: Option<SlotViews>,
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
            elisions: (late || g.rules.iter().any(|rule| rule.leftmost_longest)).then(|| Elisions {
                count_elisions: late,
                vectors: Vectors::new(),
                summaries: FxMap::default(),
            }),
            marks: None,
            check: false,
            admission: None,
            views: SlotViews::new(g),
        };
        ranker.fset_index.insert(Vec::new(), 0);
        if !g.preferences.paths.is_empty() || !g.ranked.slots.is_empty() {
            let nodes = ranker.prepare_views();
            ranker.admission = Some(Admission::new(g, chart, ranker.views.as_ref(), &nodes));
        }
        ranker
    }

    pub(crate) fn unfiltered(mut self) -> Self {
        self.admission = None;
        self.views = None;
        self
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

    fn raw_deps(&mut self, (node, fset): Key) -> Deps {
        match node {
            Node::Scoped(_) => unreachable!("a raw forest node"),
            Node::Read { .. } => Deps::Leaf,
            Node::Item { set, index } => {
                let item = self.item(set, index);
                if item.dot == 0 {
                    return Deps::Leaf;
                }
                if self.dag.chart.machine.is_some() {
                    let g = self.dag.g;
                    let p = &g.prods[item.prod as usize];
                    let position = item.dot as usize - 1;
                    let mut links = Vec::new();
                    for (before, cap, option) in slot_links(g, self.dag.chart, set, item) {
                        let m = cap.start;
                        let Some(index) = self.dag.chart.sets[m as usize].find(&before) else {
                            continue;
                        };
                        let pred = (Node::Item { set: m, index }, if m == set { fset } else { 0 });
                        let child = match p.syms[position] {
                            Sym::T(terminal) => (Node::Read { tok: m, terminal }, 0),
                            Sym::N(rule) => (
                                Node::Group {
                                    rule,
                                    origin: m,
                                    set,
                                    tags: cap.tags,
                                    test: p.test(position).unwrap_or(NO_TEST),
                                    structure: cap.structure,
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
                                let child = Node::Group {
                                    rule,
                                    origin: m,
                                    set,
                                    tags: cap.tags,
                                    test: NO_TEST,
                                    structure: cap.structure,
                                    lexical: 0,
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
                                    let child = Node::Group {
                                        rule,
                                        origin: m,
                                        set,
                                        tags: ANY,
                                        test: test_id,
                                        structure: ANY,
                                        lexical: 0,
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
                if self.fsets[fset as usize].binary_search(&rule).is_ok() {
                    return Deps::Close(None);
                }
                let inner = self.fset_with(fset, rule);
                Deps::Close(Some((Node::Item { set, index }, inner)))
            }
            Node::Group { rule, origin, set, tags, test, structure, lexical, option } => {
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
                            .filter(|&&index| {
                                (eset.items[index as usize].lexical == lexical)
                                    && (option == usize::MAX
                                        || self.dag.g.ranked.options.get(&eset.items[index as usize].prod)
                                            == Some(&option))
                                    && (tags == ANY || eset.tagset[index as usize] == tags)
                                    && (structure == ANY || eset.items[index as usize].structure == structure)
                            })
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
                Pass::Admission => {
                    self.admit(key, &deps);
                    let counts = self.count(key, &deps);
                    self.admission.as_mut().expect("admission").counts.insert(key, counts);
                }
                Pass::Summaries => {
                    let summary = self.summarize(key, &deps);
                    self.elisions.as_mut().expect("late-elision").summaries.insert(key, summary);
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
            Pass::Summaries => self.elisions.as_ref().is_some_and(|elisions| elisions.summaries.contains_key(key)),
            Pass::Entries => self.memo.contains_key(key),
        }
    }

    /// The nodes that `pass` needs before `key`: every dependency, except
    /// that under late-elision the entries need only those of the edges
    /// that attain a least vector.
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
        match (self.maximal, self.raw_node(child)) {
            (Some(maximal), Node::Group { rule, origin, set: end, lexical, .. }) => {
                (maximal.elided(rule, origin, end), !guarded || !maximal.forbids_in(rule, origin, end, test, lexical))
            }
            _ => (false, true),
        }
    }

    /// The summary of a node under late-elision, from those of its
    /// dependencies (§6).
    fn summarize(&mut self, key: Key, deps: &Deps) -> Summary {
        let node = self.raw_node(key.0);
        let masks = self.admission.as_ref().and_then(|a| a.masks.get(&key)).cloned();
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
                let vector = if elides && elisions.count_elisions {
                    let one = elisions.vectors.one(set);
                    elisions.vectors.join(vector, one)
                } else {
                    vector
                };
                let mut profile = body.profile.clone();
                if g.rules[production.rule as usize].leftmost_longest {
                    let origin = self.dag.chart.sets[set as usize].items[index as usize].origin;
                    let (p, q) = self
                        .dag
                        .projection
                        .map_or((origin, set), |(_, project)| (project[origin as usize], project[set as usize]));
                    if p < q {
                        profile = sum_profiles(&profile, &[(p, q, Nat::ONE)]);
                    }
                }
                plain(Least { vector, profile, least, total, kept: vec![0] })
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
                    let profile = sum_profiles(&left.profile, &right.profile);
                    let edge = Least { vector, profile, least, total, kept: Vec::new() };
                    if masks.as_ref().map_or(true, |m| m.0[index as usize]) {
                        all.add(&elisions.vectors, index, &edge);
                    }
                    if guarded && permitted && masks.as_ref().map_or(true, |m| m.1[index as usize]) {
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
        let masks = self.admission.as_ref().and_then(|a| a.masks.get(key));
        if let Some(summary) = self.elisions.as_ref().map(|e| &e.summaries[key]) {
            let all = summary.all.kept.iter().copied().filter(|i| masks.map_or(true, |m| m.0[*i as usize])).collect();
            let allowed = summary
                .allowed
                .as_ref()
                .map(|a| a.kept.iter().copied().filter(|i| masks.map_or(true, |m| m.1[*i as usize])).collect());
            Some((all, allowed))
        } else {
            masks.map(|m| {
                (
                    m.0.iter().enumerate().filter_map(|(i, yes)| yes.then_some(i as u32)).collect(),
                    Some(m.1.iter().enumerate().filter_map(|(i, yes)| yes.then_some(i as u32)).collect()),
                )
            })
        }
    }

    fn compute(&mut self, key: Key, deps: Deps) -> NodeResult {
        let node = self.raw_node(key.0);
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
                    let Node::Item { set: m, .. } = self.raw_node(pred.0) else { unreachable!("a predecessor item") };
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
                rule: self.dag.g.start,
                origin: 0,
                set: n,
                tags: ANY,
                test: NO_TEST,
                structure: ANY,
                lexical: 0,
                option: usize::MAX,
            },
            0,
        );
        if self.admission.is_some() {
            self.traverse(root, Pass::Admission);
        }
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
        let witness_counted = self.marks.map(|_| {
            if self.elisions.is_none() {
                return result.w;
            }
            // The witness hook counts recognition before profile filtering.
            let summaries = self.elisions.take();
            let memo = std::mem::take(&mut self.memo);
            let results = std::mem::take(&mut self.results);
            self.traverse(root, Pass::Entries);
            let counted = self.results[self.memo[&root] as usize].w;
            self.elisions = summaries;
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
        if let Some((_, least)) = counts.filter(|_| self.dag.lean == Lean::Neither) {
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
        let profile =
            self.elisions.as_ref().map_or_else(Vec::new, |summaries| summaries.summaries[&root].all.profile.clone());
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

/// Sparse span counts in increasing start and decreasing end order.
pub(crate) type Profile = Vec<(u32, u32, Nat)>;

fn span_order(a: &(u32, u32, Nat), b: &(u32, u32, Nat)) -> Ordering {
    a.0.cmp(&b.0).then_with(|| b.1.cmp(&a.1))
}

pub(crate) fn compare_profiles(left: &Profile, right: &Profile) -> Ordering {
    for (a, b) in left.iter().zip(right) {
        let order = span_order(a, b).then_with(|| b.2.cmp(&a.2));
        if order != Ordering::Equal {
            return order;
        }
    }
    right.len().cmp(&left.len())
}

fn sum_profiles(left: &[(u32, u32, Nat)], right: &[(u32, u32, Nat)]) -> Profile {
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

pub(crate) fn tree_profile(g: &Lowered, tree: &crate::tree::ITree) -> Profile {
    let mut profile = Vec::new();
    for node in &tree.nodes {
        if let crate::tree::IKind::Close { prod, start, end, .. } = node.kind {
            if start < end && g.rules[g.prods[prod as usize].rule as usize].leftmost_longest {
                profile = sum_profiles(&profile, &[(start, end, Nat::ONE)]);
            }
        }
    }
    profile
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

// Ranking views retain the written invocation through generated helpers.
// Raw chart items, completion tables and derivation actions remain unchanged.
#[derive(Clone, Default)]
struct SlotScope {
    frames: Vec<Node>,
    bounds: Vec<(Node, bool)>,
    blocked: bool,
}
struct SlotViews {
    wrapped: std::collections::BTreeSet<u32>,
    nodes: Vec<(Node, usize)>,
    index: FxMap<(Node, usize), Node>,
    scopes: Vec<SlotScope>,
    scope_index: FxMap<(Node, Node, usize, bool), usize>,
    routes: FxMap<Node, (Vec<bool>, Vec<bool>)>,
}
impl SlotViews {
    fn new(g: &Lowered) -> Option<Self> {
        if g.preferences.paths.is_empty() && g.ranked.slots.is_empty() {
            return None;
        }
        let mut users: FxMap<u32, Vec<u32>> = FxMap::default();
        for p in &g.prods {
            if g.rules[p.rule as usize].helper {
                for s in &p.syms {
                    if let Sym::N(r) = s {
                        users.entry(*r).or_default().push(p.rule);
                    }
                }
            }
        }
        let mut wrapped: std::collections::BTreeSet<u32> = g.ranked.slots.keys().copied().collect();
        let mut pending: Vec<u32> = g
            .rules
            .iter()
            .enumerate()
            .filter(|(_, r)| !r.helper && g.preferences.labels.contains_key(&r.name))
            .map(|(i, _)| i as u32)
            .collect();
        pending.extend(g.ranked.slots.keys().copied());
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
            routes: FxMap::default(),
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
    fn ranked_prefix_key(&self, scope: usize, g: &Lowered, chart: &Chart) -> String {
        let state = &self.scopes[scope];
        let frames: Vec<_> = state
            .frames
            .iter()
            .map(|node| {
                let Node::Item { set, index } = *node else { unreachable!() };
                written_frame(g, chart, chart.sets[set as usize].items[index as usize], set)
            })
            .collect();
        let bounds: Vec<_> = state
            .bounds
            .iter()
            .map(|(node, restricted)| {
                let Node::Group { rule, origin, set, .. } = *node else { unreachable!() };
                (g.ranked.written.get(&rule), origin, set, restricted)
            })
            .collect();
        format!("{frames:?}/{bounds:?}")
    }
    fn prefix_key(&self, scope: usize, v: &crate::preferences::Variant, g: &Lowered, chart: &Chart) -> String {
        let state = &self.scopes[scope];
        let frames: Vec<_> = state
            .frames
            .iter()
            .map(|node| {
                let Node::Item { set, index } = *node else { unreachable!() };
                let item = chart.sets[set as usize].items[index as usize];
                let p = &g.prods[item.prod as usize];
                let symbols: Vec<_> = p.syms[..item.dot as usize]
                    .iter()
                    .enumerate()
                    .map(|(i, s)| {
                        let role = match s {
                            Sym::T(t) => format!("T{}", g.terminals[*t as usize]),
                            Sym::N(r) => {
                                if g.rules[*r as usize].helper {
                                    g.prods[g.rules[*r as usize].prods[0] as usize]
                                        .slot
                                        .as_ref()
                                        .and_then(|s| s.path)
                                        .and_then(|path| v.paths.get(&path))
                                        .cloned()
                                        .unwrap_or_default()
                                } else {
                                    g.rules[*r as usize].name.clone()
                                }
                            }
                        };
                        (role, p.test(i).map(|t| &g.tests[t as usize]))
                    })
                    .collect();
                let caps: Vec<_> = chart
                    .caps(item.caps)
                    .into_iter()
                    .enumerate()
                    .map(|(i, cap)| {
                        let name = p.slot.as_ref().and_then(|s| s.names.get(i)).and_then(|n| n.as_ref());
                        (name.map(|n| v.roles.get(n).unwrap_or(n)).cloned(), cap)
                    })
                    .collect();
                let role = p.slot.as_ref().and_then(|s| s.path).and_then(|path| v.paths.get(&path));
                format!(
                    "{role:?}/{}/{}/{symbols:?}/{caps:?}/{}",
                    item.origin,
                    item.prefix,
                    chart.sets[set as usize].is_strict(index as usize)
                )
            })
            .collect();
        let bounds: Vec<_> = state
            .bounds
            .iter()
            .map(|(node, restricted)| {
                let Node::Group { rule, origin, set, .. } = *node else { unreachable!() };
                let role = g.prods[g.rules[rule as usize].prods[0] as usize]
                    .slot
                    .as_ref()
                    .and_then(|s| s.path)
                    .and_then(|path| v.paths.get(&path));
                (role, origin, set, restricted)
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
    fn helper_scope(
        &mut self,
        before: Node,
        carrier: Node,
        outer: usize,
        restricted: bool,
        guarded: bool,
        test: Option<u32>,
    ) -> usize {
        let Node::Item { set, index } = before else { unreachable!() };
        let Node::Group { rule, origin, set: end, lexical, .. } = carrier else { unreachable!() };
        let own = self.dag.g.prods[self.item(set, index).prod as usize].rule;
        if outer != 0 && own == rule {
            return outer;
        }
        let blocked =
            restricted && guarded && self.maximal.is_some_and(|mx| mx.forbids_in(rule, origin, end, test, lexical));
        let views = self.views.as_mut().unwrap();
        if let Some(&old) = views.scope_index.get(&(before, carrier, outer, restricted)) {
            return old;
        }
        let mut scope = views.scopes[outer].clone();
        scope.frames.push(before);
        scope.bounds.push((carrier, restricted));
        scope.blocked |= blocked;
        let id = views.scopes.len();
        views.scopes.push(scope);
        views.scope_index.insert((before, carrier, outer, restricted), id);
        id
    }
    fn deps(&mut self, key: Key) -> Deps {
        let Some(views) = &self.views else {
            return self.raw_deps(key);
        };
        let (raw, scope) = views.unpack(key.0);
        if views.scopes[scope].blocked {
            return Deps::Close(None);
        }
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
                let (guarded, test) = self.guard(set, index);
                let mut found = vec![];
                let mut masks = (vec![], vec![]);
                let mut routed = false;
                for ((previous, pf), (child, cf)) in links {
                    let carries = matches!(child, Node::Group {rule, ..} if self.views.as_ref().unwrap().wrapped.contains(&rule))
                        && (!self.dag.g.rules[own as usize].helper || scope != 0);
                    let pred = (self.views.as_mut().unwrap().view(previous, scope), pf);
                    if carries {
                        let inner = self.helper_scope(previous, child, scope, false, guarded, test);
                        found.push((pred, (self.views.as_mut().unwrap().view(child, inner), cf)));
                        masks.0.push(true);
                        masks.1.push(!guarded);
                        if guarded {
                            routed = true;
                            let inner = self.helper_scope(previous, child, scope, true, true, test);
                            found.push((pred, (self.views.as_mut().unwrap().view(child, inner), cf)));
                            masks.0.push(false);
                            masks.1.push(true);
                        }
                    } else {
                        found.push((pred, (child, cf)));
                        masks.0.push(true);
                        masks.1.push(true);
                    }
                }
                if routed {
                    self.views.as_mut().unwrap().routes.insert(key.0, masks);
                }
                Deps::Links(found)
            }
        }
    }
}
