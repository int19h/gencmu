//! Written-terminator priority for nested queries (engine §4): which
//! completed items of a queried rule have an eligible proof tree.
//!
//! A proof tree of an item is made of the advances that the recognizer can
//! make, rebuilt from the chart as the ranking rebuilds them (§6): the item
//! before an advance, and the token or the completed item that it reads. An
//! omission is an advance over the empty helper of an elidable optional. It
//! is forbidden where the prefix that the tree holds fixed can go on and
//! read the whole optional as written. A tree is eligible when none of its
//! omissions is forbidden.
//!
//! Each item has two states, computed together to their least fixpoint: E,
//! it has an eligible proof tree, and P, it has an eligible proof tree whose
//! fixed prefix permits the optional after it to be empty.

use crate::earley::{test_holds, Cap, Chart, Item, Tok};
use crate::fxhash::FxMap;
use crate::lower::{Lowered, Sym};
use crate::tags::Tags;
use crate::unicode::Unicode;

/// A place in the chart: the set and the index of an item there.
type Place = (u32, u32);

/// One advance as the places of the items it reads: the item before it,
/// none for a predicted item, and the completed item, none for a token.
type RawEdge = (Option<Place>, Option<Place>);

/// One way the recognizer makes an item, by the dense numbers of the items
/// it reads.
#[derive(Debug, Clone, Copy)]
enum Edge {
    /// The item is predicted, with its dot at the start.
    Seed,
    /// An advance over a token.
    Scan { before: usize },
    /// An advance over a completed item; `omission` when that item is the
    /// empty helper of an elidable optional.
    Complete { before: usize, child: usize, omission: bool },
}

/// What may come after an item: an elidable optional with a constituent,
/// one without, or anything else (§4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Next {
    Other,
    Alone,
    Constituent,
}

/// The chart of one nested parse, with what reading it needs.
pub(crate) struct Proofs<'a> {
    pub g: &'a Lowered,
    pub chart: &'a Chart,
    /// The tokens of the nested parse's span alone.
    pub tokens: &'a [Tok],
    pub unicode: &'a Unicode,
    pub tags: &'a Tags,
}

impl Proofs<'_> {
    fn item(&self, (set, index): Place) -> Item {
        self.chart.sets[set as usize].items[index as usize]
    }

    /// The item made from `item` in `set` by an advance over the
    /// constituent `cap`, if the chart holds it: the advance that the
    /// recognizer made, with its test and its conditions passed.
    fn advanced(&self, item: Item, cap: Cap) -> Option<Place> {
        let production = &self.g.prods[item.prod as usize];
        let dot = item.dot as usize;
        if let Some(test) = self.g.test(item.prod, dot) {
            let span = &self.tokens[cap.start as usize..cap.end as usize];
            if !test_holds(test, span, self.unicode, self.tags, cap.tags) {
                return None;
            }
        }
        let caps = if production.cap_at[dot].is_some() {
            let mut caps = self.chart.caps(item.caps).to_vec();
            caps.push(cap);
            self.chart.lookup_caps(&caps)?
        } else {
            item.caps
        };
        let next = Item { prod: item.prod, dot: item.dot + 1, origin: item.origin, caps };
        let set = cap.end;
        self.chart.sets.get(set as usize)?.find(&next).map(|index| (set, index))
    }

    /// The completed items of `rule` from `origin`, each with its place.
    fn completed(&self, rule: u32, origin: u32) -> impl Iterator<Item = Place> + '_ {
        (origin as usize..self.chart.sets.len()).flat_map(move |set| {
            self.chart.sets[set]
                .completed
                .get(&(rule, origin))
                .into_iter()
                .flatten()
                .map(move |&index| (set as u32, index))
        })
    }

    /// The constituent of a completed item at `place`.
    fn cap(&self, place: Place) -> Cap {
        let item = self.item(place);
        Cap { start: item.origin, end: place.0, tags: self.chart.sets[place.0 as usize].tagset[place.1 as usize] }
    }

    /// Whether the elidable optional that comes next after the item at
    /// `place` is read as written there: the chart advances the item over a
    /// completed nonempty alternative of the optional.
    fn reads_written(&self, place: Place) -> bool {
        let item = self.item(place);
        let Some(&Sym::N(helper)) = self.g.prods[item.prod as usize].syms.get(item.dot as usize) else {
            return false;
        };
        self.completed(helper, place.0).any(|child| {
            !self.g.prods[self.item(child).prod as usize].syms.is_empty()
                && self.advanced(item, self.cap(child)).is_some()
        })
    }

    /// For the item at `place`, before a constituent `Y`: the furthest end
    /// of an advance over a completed `Y` after which the chart reads the
    /// elidable optional as written. An omission at `p` with this item as
    /// its fixed prefix is forbidden when that end is `p` or later.
    fn blocked_until(&self, place: Place) -> Option<u32> {
        let item = self.item(place);
        let Some(&Sym::N(constituent)) = self.g.prods[item.prod as usize].syms.get(item.dot as usize) else {
            return None;
        };
        self.completed(constituent, place.0)
            .filter_map(|child| self.advanced(item, self.cap(child)))
            .filter(|&after| self.reads_written(after))
            .map(|(set, _)| set)
            .max()
    }

    /// What comes after the item: an elidable optional with a constituent,
    /// one without, or anything else (§4). The optional has no constituent
    /// when it stands first, when it follows a terminal, or when it follows
    /// the first symbol of a production whose first symbol is its own rule.
    fn next(&self, item: Item) -> Next {
        let production = &self.g.prods[item.prod as usize];
        let dot = item.dot as usize;
        match production.syms.get(dot) {
            Some(&Sym::N(helper)) if self.g.rules[helper as usize].elided.is_some() => {
                match (dot, production.syms.get(dot.wrapping_sub(1))) {
                    (0, _) | (_, Some(Sym::T(_))) => Next::Alone,
                    (1, Some(&Sym::N(first))) if first == production.rule => Next::Alone,
                    _ => Next::Constituent,
                }
            }
            _ => Next::Other,
        }
    }

    /// The advances that make the item at `place`, each with the places of
    /// the items it reads, rebuilt from completed spans.
    fn edges(&self, place: Place) -> Vec<RawEdge> {
        let (set, _) = place;
        let item = self.item(place);
        if item.dot == 0 {
            return vec![(None, None)];
        }
        let production = &self.g.prods[item.prod as usize];
        let position = item.dot as usize - 1;
        let caps = self.chart.caps(item.caps);
        let captured = production.cap_at[position].is_some();
        let before_caps = if captured {
            match self.chart.lookup_caps(&caps[..caps.len() - 1]) {
                Some(id) => id,
                None => return Vec::new(),
            }
        } else {
            item.caps
        };
        let before = Item { prod: item.prod, dot: item.dot - 1, origin: item.origin, caps: before_caps };
        let find = |at: u32| self.chart.sets[at as usize].find(&before).map(|index| (at, index));
        match production.syms[position] {
            Sym::T(_) => find(set - 1).map(|before| (Some(before), None)).into_iter().collect(),
            Sym::N(rule) => {
                let origins: Vec<u32> = if captured {
                    vec![caps[caps.len() - 1].start]
                } else {
                    self.chart.sets[set as usize]
                        .origins
                        .get(&rule)
                        .map(|origins| origins.iter().copied().filter(|&m| m >= item.origin).collect())
                        .unwrap_or_default()
                };
                let mut edges = Vec::new();
                for m in origins {
                    let Some(before) = find(m) else { continue };
                    for &index in self.chart.sets[set as usize].completed.get(&(rule, m)).into_iter().flatten() {
                        let child = (set, index);
                        // The advance over this very constituent makes the
                        // item, with its test and its captures.
                        if self.advanced(self.item(before), self.cap(child)) == Some(place) {
                            edges.push((Some(before), Some(child)));
                        }
                    }
                }
                edges
            }
        }
    }

    /// Which of `witnesses`, completed items of the queried rule, have an
    /// eligible proof tree (§4).
    pub(crate) fn eligible(&self, witnesses: &[Place]) -> Vec<bool> {
        let everything = vec![true; witnesses.len()];
        if witnesses.is_empty() || !self.g.rules.iter().any(|rule| rule.elided.is_some()) {
            return everything;
        }
        // The items that the witnesses rest on, children before the items
        // made from them where the edges allow, so that one sweep settles
        // most of them.
        let mut number: FxMap<Place, usize> = FxMap::default();
        let mut order: Vec<Place> = Vec::new();
        let mut edges: Vec<Vec<Edge>> = Vec::new();
        let mut raw: FxMap<Place, Vec<RawEdge>> = FxMap::default();
        let mut omits = false;
        for &witness in witnesses {
            if raw.contains_key(&witness) {
                continue;
            }
            let found = self.edges(witness);
            let below = Self::below(&found);
            raw.insert(witness, found);
            let mut stack: Vec<(Place, Vec<Place>, usize)> = vec![(witness, below, 0)];
            while let Some((place, below, next)) = stack.last_mut() {
                if let Some(&target) = below.get(*next) {
                    *next += 1;
                    if let std::collections::hash_map::Entry::Vacant(entry) = raw.entry(target) {
                        let found = self.edges(target);
                        let below = Self::below(&found);
                        entry.insert(found);
                        stack.push((target, below, 0));
                    }
                    continue;
                }
                let place = *place;
                stack.pop();
                number.insert(place, order.len());
                order.push(place);
            }
        }
        for &place in &order {
            let list = raw[&place]
                .iter()
                .map(|&(before, child)| match (before, child) {
                    (None, _) => Edge::Seed,
                    (Some(before), None) => Edge::Scan { before: number[&before] },
                    (Some(before), Some(child)) => {
                        let omission = self.is_omission(child);
                        omits |= omission;
                        Edge::Complete { before: number[&before], child: number[&child], omission }
                    }
                })
                .collect();
            edges.push(list);
        }
        // With no omission, every item has a finite proof tree, made from
        // predicted items in the order in which the recognizer made it.
        if !omits {
            return everything;
        }
        let next: Vec<Next> = order.iter().map(|&place| self.next(self.item(place))).collect();
        let mut written: FxMap<Place, bool> = FxMap::default();
        let mut blocked: FxMap<Place, Option<u32>> = FxMap::default();
        let mut e = vec![false; order.len()];
        let mut p = vec![false; order.len()];
        let mut changed = true;
        while changed {
            changed = false;
            for x in 0..order.len() {
                if e[x] && (p[x] || next[x] == Next::Other) {
                    continue;
                }
                let place = order[x];
                let (mut has_e, mut has_p) = (false, false);
                for edge in &edges[x] {
                    let through = match *edge {
                        Edge::Seed => true,
                        Edge::Scan { before } => e[before],
                        Edge::Complete { before, child, omission } => {
                            (if omission { p[before] } else { e[before] }) && e[child]
                        }
                    };
                    if !through {
                        continue;
                    }
                    has_e = true;
                    match (next[x], *edge) {
                        (Next::Alone, _) if !has_p => {
                            has_p = !*written.entry(place).or_insert_with(|| self.reads_written(place));
                        }
                        // The fixed prefix is the item before the advance
                        // over the constituent.
                        (Next::Constituent, Edge::Complete { before, .. }) if !has_p => {
                            let prefix = order[before];
                            let until = *blocked.entry(prefix).or_insert_with(|| self.blocked_until(prefix));
                            has_p = until.map_or(true, |until| until < place.0);
                        }
                        _ => {}
                    }
                }
                if has_e && !e[x] {
                    e[x] = true;
                    changed = true;
                }
                if has_p && !p[x] {
                    p[x] = true;
                    changed = true;
                }
            }
        }
        witnesses.iter().map(|witness| e[number[witness]]).collect()
    }

    /// The items that the advances of one item read.
    fn below(edges: &[RawEdge]) -> Vec<Place> {
        edges.iter().flat_map(|&(before, child)| before.into_iter().chain(child)).collect()
    }

    /// Whether a completed item is the empty helper of an elidable optional,
    /// so that an advance over it is an omission.
    fn is_omission(&self, place: Place) -> bool {
        let production = &self.g.prods[self.item(place).prod as usize];
        production.syms.is_empty() && self.g.rules[production.rule as usize].elided.is_some()
    }
}
