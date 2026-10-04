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

use std::cell::OnceCell;

use crate::earley::{test_holds, Cap, Chart, Item, Tok};
use crate::fxhash::FxMap;
use crate::lower::{Lowered, Sym};
use crate::maximal::Maximal;
use crate::tags::Tags;
use crate::unicode::Unicode;
use crate::work::{self, Mutant, Work};

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

/// The completed items of the chart by rule and origin, each with its
/// place, in the order of their sets.
type CompletedIndex = FxMap<(u32, u32), Vec<Place>>;

/// The chart of one nested parse, with what reading it needs.
pub(crate) struct Proofs<'a> {
    g: &'a Lowered,
    chart: &'a Chart,
    /// The tokens of the nested parse's span alone.
    tokens: &'a [Tok],
    unicode: &'a Unicode,
    tags: &'a Tags,
    /// The completed items of the whole chart by rule and origin, built
    /// once, when the first search for a blocking path needs it.
    index: OnceCell<CompletedIndex>,
    /// The furthest completions of the query's chart, for the maximal
    /// terminators, found once for the query when the first check needs
    /// them (§4).
    maximal: OnceCell<Maximal<'a>>,
}

impl<'a> Proofs<'a> {
    pub(crate) fn new(
        g: &'a Lowered,
        chart: &'a Chart,
        tokens: &'a [Tok],
        unicode: &'a Unicode,
        tags: &'a Tags,
    ) -> Proofs<'a> {
        Proofs { g, chart, tokens, unicode, tags, index: OnceCell::new(), maximal: OnceCell::new() }
    }

    /// Counts one entry of the chart or the index that a search examines,
    /// before it is read.
    fn count(&self) {
        work::count(Work::Searched, 1);
    }

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
        let caps = if production.cap_at[dot].is_some() { self.chart.lookup_caps(item.caps, cap)? } else { item.caps };
        let next = Item { prod: item.prod, dot: item.dot + 1, origin: item.origin, caps };
        let set = cap.end;
        self.chart.sets.get(set as usize)?.find(&next).map(|index| (set, index))
    }

    /// The completed items of `rule` from `origin`, each with its place,
    /// from an index of the whole chart, which one pass over the chart
    /// builds for the whole query.
    fn completed(&self, rule: u32, origin: u32) -> impl Iterator<Item = Place> + '_ {
        let index: &CompletedIndex = if work::mutated(Mutant::IndexPerSearch) {
            // A mutation of the tests builds the index again for each
            // search, and keeps each one until the test ends.
            Box::leak(Box::new(self.completed_index()))
        } else {
            self.index.get_or_init(|| self.completed_index())
        };
        let found = index.get(&(rule, origin)).map_or(&[][..], Vec::as_slice);
        // Each completed item counts as the search reads it.
        found.iter().copied().inspect(|_| work::count(Work::Searched, 1))
    }

    /// The index of the completed items of the whole chart, in one pass
    /// that counts each item as it is examined.
    fn completed_index(&self) -> CompletedIndex {
        let mut index = CompletedIndex::default();
        for (set, entries) in self.chart.sets.iter().enumerate() {
            for (&key, list) in &entries.completed {
                let places = index.entry(key).or_default();
                for &at in list {
                    self.count();
                    places.push((set as u32, at));
                }
            }
        }
        index
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
        let captured = production.cap_at[position].is_some();
        let before_caps = if captured {
            if item.caps == 0 {
                return Vec::new();
            }
            self.chart.caps_parent(item.caps)
        } else {
            item.caps
        };
        let before = Item { prod: item.prod, dot: item.dot - 1, origin: item.origin, caps: before_caps };
        let find = |at: u32| self.chart.sets[at as usize].find(&before).map(|index| (at, index));
        match production.syms[position] {
            Sym::T(_) => find(set - 1).map(|before| (Some(before), None)).into_iter().collect(),
            Sym::N(rule) => {
                let origins: Vec<u32> = if captured {
                    vec![self.chart.last_cap(item.caps).start]
                } else {
                    self.chart.origins_between(&before, rule, item.origin, set)
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
        if witnesses.is_empty() || !self.g.elides {
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
                // Each item of each sweep counts, so that sweeps that each
                // settle only a few items show their cost.
                self.count();
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
                            has_p = !if work::mutated(Mutant::AskWrittenAgain) {
                                // A mutation of the tests asks again at each
                                // edge, with no memo.
                                self.reads_written(place)
                            } else {
                                *written.entry(place).or_insert_with(|| self.reads_written(place))
                            };
                        }
                        // The fixed prefix is the item before the advance
                        // over the constituent.
                        (Next::Constituent, Edge::Complete { before, child, .. }) if !has_p => {
                            let prefix = order[before];
                            let until = *blocked.entry(prefix).or_insert_with(|| self.blocked_until(prefix));
                            // Where the optional's terminator is maximal,
                            // the constituent of this advance must also be
                            // the longest possible (§4).
                            has_p = until.map_or(true, |until| until < place.0) && self.longest(place, order[child]);
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

    /// Whether the completed constituent at `child`, which the item at
    /// `place` has just read, permits the omission of a maximal terminator
    /// after it: no completed item of its symbol from its origin ends later
    /// in the query's chart with the symbol's test holding (§4). An
    /// optional whose terminator is not maximal permits it always.
    fn longest(&self, place: Place, child: Place) -> bool {
        let item = self.item(place);
        let production = &self.g.prods[item.prod as usize];
        let Some(&Sym::N(helper)) = production.syms.get(item.dot as usize) else { return true };
        if !self.g.rules[helper as usize].maximal {
            return true;
        }
        let maximal =
            self.maximal.get_or_init(|| Maximal::new(self.g, self.chart, self.tokens, self.unicode, self.tags, false));
        let constituent = self.item(child);
        let rule = self.g.prods[constituent.prod as usize].rule;
        !maximal.forbids(rule, constituent.origin, child.0, production.test(item.dot as usize - 1))
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

/// Checks written-terminator priority (§4) against a search for eligible
/// proof trees, found one by one, on small random grammars with chained
/// elidable optionals. The search reads a chart that it builds itself
/// from the lowered grammar, with none of the recognizer's tables, and it
/// reads whether an omission is forbidden straight from the words of the
/// specification.
#[cfg(test)]
mod tests {
    use std::collections::{HashMap, HashSet};

    use super::Proofs;
    use crate::earley::{matchers, Recognizer, Shared, Tok};
    use crate::lower::{Lowered, Sym};
    use crate::work::{assert_linear, assert_mutant_stops, assert_stops, Mutant, Mutation, Work};

    /// SplitMix64.
    struct Rng(u64);

    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
            let mut z = self.0;
            z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
            z ^ (z >> 31)
        }

        fn below(&mut self, n: usize) -> usize {
            (self.next() % n as u64) as usize
        }
    }

    const RULES: [&str; 4] = ["r", "t", "u", "v"];
    const TERMINALS: [&str; 4] = ["A", "B", "T", "U"];

    /// An item of the oracle's chart: production, dot, origin, end, and
    /// the tags of its captured part. Only a production of one symbol
    /// captures, and only that symbol (engine §3.7), so the tags are those
    /// of a token, `1 + t` for terminal `t`, or none, `0`.
    type OItem = (u32, u32, u32, u32, u8);

    struct TooMany;

    struct Oracle<'a> {
        g: &'a Lowered,
        /// The maximal terminators, as the grammar names them.
        maximal: Vec<&'static str>,
        chart: HashSet<OItem>,
        last: u32,
        budget: usize,
    }

    impl Oracle<'_> {
        /// The chart of a recognition of `start` over the tokens, each
        /// named by its one terminal: every item that prediction reaches
        /// and whose symbols before the dot read the tokens it spans.
        fn new<'a>(g: &'a Lowered, tokens: &[&str], start: u32) -> Oracle<'a> {
            let n = tokens.len() as u32;
            let mut oracle = Oracle { g, maximal: Vec::new(), chart: HashSet::new(), last: n, budget: 200_000 };
            let mut predicted: HashSet<(u32, u32)> = HashSet::from([(start, 0)]);
            loop {
                let before = (oracle.chart.len(), predicted.len());
                for &(rule, at) in &predicted.clone() {
                    for &prod in &g.rules[rule as usize].prods {
                        oracle.chart.insert((prod, 0, at, at, 0));
                    }
                }
                for item in oracle.chart.clone() {
                    let (prod, dot, _, end, _) = item;
                    match oracle.syms(prod).get(dot as usize) {
                        None => {}
                        Some(&Sym::T(terminal)) => {
                            if end < n && g.terminals[terminal as usize] == tokens[end as usize] {
                                let made = oracle.advance(item, end + 1, 1 + terminal as u8);
                                oracle.chart.insert(made);
                            }
                        }
                        Some(&Sym::N(rule)) => {
                            predicted.insert((rule, end));
                            for k in end..=n {
                                for child in oracle.completed(rule, end, k) {
                                    let made = oracle.advance(item, k, oracle.tags(child));
                                    oracle.chart.insert(made);
                                }
                            }
                        }
                    }
                }
                if (oracle.chart.len(), predicted.len()) == before {
                    break;
                }
            }
            oracle
        }

        fn syms(&self, prod: u32) -> &[Sym] {
            &self.g.prods[prod as usize].syms
        }

        fn elidable(&self, rule: u32) -> bool {
            self.g.rules[rule as usize].elided.is_some()
        }

        /// The item made from `item` by an advance to `end` over a part
        /// whose tags are `tags`.
        fn advance(&self, (prod, dot, origin, _, kept): OItem, end: u32, tags: u8) -> OItem {
            let captured = self.syms(prod).len() == 1;
            (prod, dot + 1, origin, end, if captured { tags } else { kept })
        }

        /// The tags of a completed item's constituent.
        fn tags(&self, (prod, _, _, _, captured): OItem) -> u8 {
            if self.syms(prod).len() == 1 {
                captured
            } else {
                0
            }
        }

        /// The completed items of `rule` from `origin` to `end`.
        fn completed(&self, rule: u32, origin: u32, end: u32) -> Vec<OItem> {
            let mut found = Vec::new();
            for &prod in &self.g.rules[rule as usize].prods {
                let length = self.syms(prod).len() as u32;
                for tags in 0..=self.g.terminals.len() as u8 {
                    let item = (prod, length, origin, end, tags);
                    if self.chart.contains(&item) {
                        found.push(item);
                    }
                }
            }
            found
        }

        /// Whether the chart advances `item` over a completed nonempty
        /// alternative of the elidable optional that comes next.
        fn reads_written(&self, item: OItem) -> bool {
            let (prod, dot, _, end, _) = item;
            let Some(&Sym::N(helper)) = self.syms(prod).get(dot as usize) else { return false };
            (end..=self.last).any(|k| {
                self.completed(helper, end, k).into_iter().any(|child| {
                    !self.syms(child.0).is_empty() && self.chart.contains(&self.advance(item, k, self.tags(child)))
                })
            })
        }

        /// Whether the chart advances `before` over a completed `Y` that
        /// ends at some p' ≥ p, and the item made then reads the optional
        /// as written.
        fn forbidden_after(&self, before: OItem, p: u32) -> bool {
            let (prod, dot, _, end, _) = before;
            let Some(&Sym::N(y)) = self.syms(prod).get(dot as usize) else { return false };
            (p.max(end)..=self.last).any(|k| {
                self.completed(y, end, k).into_iter().any(|child| {
                    let made = self.advance(before, k, self.tags(child));
                    self.chart.contains(&made) && self.reads_written(made)
                })
            })
        }

        /// Whether the optional that comes next after the item has a
        /// maximal terminator.
        fn maximal_after(&self, (prod, dot, ..): OItem) -> bool {
            let Some(&Sym::N(helper)) = self.syms(prod).get(dot as usize) else { return false };
            self.g.rules[helper as usize].elided.as_deref().is_some_and(|name| self.maximal.contains(&name))
        }

        /// Whether the chart has a completed item of the same symbol as a
        /// completed item, from its origin, that ends later.
        fn longer(&self, (prod, _, origin, end, _): OItem) -> bool {
            let rule = self.g.prods[prod as usize].rule;
            (end + 1..=self.last).any(|k| !self.completed(rule, origin, k).is_empty())
        }

        /// Where an elidable optional comes next after the item: with a
        /// constituent, alone, or not at all.
        fn next_optional(&self, (prod, dot, ..): OItem) -> Option<bool> {
            let syms = self.syms(prod);
            let Some(&Sym::N(helper)) = syms.get(dot as usize) else { return None };
            if !self.elidable(helper) {
                return None;
            }
            let alone = dot == 0
                || matches!(syms[dot as usize - 1], Sym::T(_))
                || (dot == 1 && syms[0] == Sym::N(self.g.prods[prod as usize].rule));
            Some(!alone)
        }

        /// The advances that make an item: the item before and the
        /// completed item read, none for a token or a predicted item.
        fn edges(&self, item: OItem) -> Vec<Option<(OItem, Option<OItem>)>> {
            let (prod, dot, origin, end, _) = item;
            if dot == 0 {
                return vec![None];
            }
            let mut edges = Vec::new();
            for m in origin..=end {
                for kept in 0..=self.g.terminals.len() as u8 {
                    let before = (prod, dot - 1, origin, m, kept);
                    if !self.chart.contains(&before) {
                        continue;
                    }
                    match self.syms(prod)[dot as usize - 1] {
                        Sym::T(terminal) => {
                            if m + 1 == end && self.advance(before, end, 1 + terminal as u8) == item {
                                edges.push(Some((before, None)));
                            }
                        }
                        Sym::N(rule) => {
                            for child in self.completed(rule, m, end) {
                                if self.advance(before, end, self.tags(child)) == item {
                                    edges.push(Some((before, Some(child))));
                                }
                            }
                        }
                    }
                }
            }
            edges
        }

        /// Whether `item` has an eligible proof tree, and with `permit`
        /// one whose own advance permits the optional after it to be
        /// empty. A path never repeats an item in one state.
        fn search(&mut self, item: OItem, permit: bool, path: &mut HashSet<(OItem, bool)>) -> Result<bool, TooMany> {
            self.budget = self.budget.checked_sub(1).ok_or(TooMany)?;
            if !path.insert((item, permit)) {
                return Ok(false);
            }
            let found = self.search_on(item, permit, path);
            path.remove(&(item, permit));
            found
        }

        fn search_on(
            &mut self,
            item: OItem,
            permit: bool,
            inner: &mut HashSet<(OItem, bool)>,
        ) -> Result<bool, TooMany> {
            let kind = if permit { self.next_optional(item) } else { None };
            if kind == Some(false) && self.reads_written(item) {
                return Ok(false);
            }
            for edge in self.edges(item) {
                match edge {
                    None => {
                        if kind != Some(true) {
                            return Ok(true);
                        }
                    }
                    Some((before, None)) => {
                        if kind != Some(true) && self.search(before, false, inner)? {
                            return Ok(true);
                        }
                    }
                    Some((before, Some(child))) => {
                        if kind == Some(true) && self.forbidden_after(before, item.3) {
                            continue;
                        }
                        // After a maximal terminator's constituent, the
                        // constituent must be the longest in the chart.
                        if kind == Some(true) && self.maximal_after(item) && self.longer(child) {
                            continue;
                        }
                        let child_rule = self.g.prods[child.0 as usize].rule;
                        let omission = self.syms(child.0).is_empty() && self.elidable(child_rule);
                        if self.search(before, omission, inner)? && self.search(child, false, inner)? {
                            return Ok(true);
                        }
                    }
                }
            }
            Ok(false)
        }
    }

    /// A random alternative, as text and as its DOM's expression. `marks`
    /// are the markers of the optionals of `T` and of `U`, `+` or `++`.
    fn body(rng: &mut Rng, marks: [&str; 2]) -> (String, String) {
        let symbol = |rng: &mut Rng| {
            if rng.below(2) == 0 {
                TERMINALS[rng.below(4)]
            } else {
                RULES[rng.below(4)]
            }
        };
        let reference = |name: &str| format!(r#"{{"ref":"{name}"}}"#);
        let marked = |mark: &str, expr: String| {
            let maximal = if mark == "++" { r#","maximal":true"# } else { "" };
            format!(r#"{{"optional":{expr},"elidable":true{maximal}}}"#)
        };
        let (mut text, mut dom) = (Vec::new(), Vec::new());
        for _ in 0..rng.below(4) {
            match rng.below(50) {
                0..=9 => {
                    text.push(format!("[{}T]", marks[0]));
                    dom.push(marked(marks[0], reference("T")));
                }
                10..=14 => {
                    text.push(format!("[{}U]", marks[1]));
                    dom.push(marked(marks[1], reference("U")));
                }
                15..=18 => {
                    let after = symbol(rng);
                    text.push(format!("[{}T {after}]", marks[0]));
                    dom.push(marked(marks[0], format!(r#"{{"seq":[{},{}]}}"#, reference("T"), reference(after))));
                }
                _ => {
                    let name = symbol(rng);
                    text.push(name.to_string());
                    dom.push(reference(name));
                }
            }
        }
        match dom.len() {
            0 => ("ε".to_string(), r#"{"empty":true}"#.to_string()),
            1 => (text.join(" "), dom.remove(0)),
            _ => (text.join(" "), format!(r#"{{"seq":[{}]}}"#, dom.join(","))),
        }
    }

    /// The pipeline and its DOM, which every round shares.
    const PIPELINE: &str = "```jbogenbau\n%stage main\n%include \"main.md\"\n```\n";

    /// A random grammar as its document and its DOM, which the cache gives
    /// the loader so that a round does not read the document through the
    /// notation.
    fn grammar(rng: &mut Rng) -> (String, String, Vec<&'static str>) {
        // Now and then T or U is maximal: every optional of it is marked
        // `++` (engine §3.8).
        let (marks, maximal): ([&str; 2], Vec<&str>) = match rng.below(4) {
            0 => (["++", "+"], vec!["T"]),
            1 => (["++", "++"], vec!["T", "U"]),
            _ => (["+", "+"], Vec::new()),
        };
        let text_line = 3;
        let mut lines = Vec::new();
        let mut rules = vec![format!(
            r#"{{"name":"text","op":"define","alternatives":[{{"guards":[],"expr":{{"ref":"A"}}}}],"conditions":[],"at":[{text_line},1]}}"#
        )];
        for (line, rule) in RULES.iter().enumerate() {
            let (first, second) = (body(rng, marks), body(rng, marks));
            lines.push(format!("%rule {rule} {} | {}", first.0, second.0));
            let alternatives = [first.1, second.1].map(|expr| format!(r#"{{"guards":[],"expr":{expr}}}"#)).join(",");
            rules.push(format!(
                r#"{{"name":"{rule}","op":"define","alternatives":[{alternatives}],"conditions":[],"at":[{},1]}}"#,
                line + text_line + 1
            ));
        }
        let document = format!("```jbogenbau\n%ambiguity-resolution greedy\n%rule text A\n{}\n```\n", lines.join("\n"));
        let dom = format!(
            r#"{{"format":{},"rules":[{}],"directives":[{{"name":"ambiguity-resolution","args":["greedy"],"at":[2,1]}}],"constants":[],"classifiers":[],"implications":[]}}"#,
            crate::dom::DOM_FORMAT,
            rules.join(",")
        );
        (document, dom, maximal)
    }

    /// The eligible witnesses of `begins` as the library finds them and as
    /// the oracle does, for one random grammar and input; `None` when the
    /// round checks nothing.
    fn round(rng: &mut Rng, pipeline: &str, check_dom: bool) -> Option<(Vec<bool>, Vec<bool>, String)> {
        let (document, dom, maximal) = grammar(rng);
        if check_dom {
            // The DOM given to the cache is the one the notation reads.
            let read = crate::tools::read_grammar_document(&document).expect("the document");
            assert_eq!(crate::json::parse(&read).ok(), crate::json::parse(&dom).ok(), "{dom}\n{read}");
        }
        let compiled = format!(
            r#"{{"format":{},"bootstrap":"{}","documents":{{"main.md":{{"hash":"{}","dom":{dom}}},"p.md":{{"hash":"{}","dom":{pipeline}}}}}}}"#,
            crate::dom::DOM_FORMAT,
            crate::tools::bootstrap_hash(),
            crate::json::fnv1a64(&document),
            crate::json::fnv1a64(PIPELINE)
        );
        let tokens: Vec<&str> = (0..rng.below(5)).map(|_| TERMINALS[rng.below(4)]).collect();
        let sources = [("main.md", document.clone()), ("p.md", PIPELINE.to_string()), ("compiled.json", compiled)];
        let dialect = crate::load_dialect_sources(sources, "p.md").ok()?;
        let g = dialect.lowered_stage(0);
        let start = g.rules.iter().position(|rule| rule.name == "r" && !rule.helper)? as u32;
        let chars: Vec<char> = vec![' '; tokens.len() * 2];
        let mut shared = Shared::new(&dialect.unicode, &chars);
        let input: Vec<Tok> = tokens
            .iter()
            .enumerate()
            .map(|(index, &terminal)| Tok {
                text: "x".to_string(),
                tags: shared.tags.set_of([terminal]),
                phonemes: None,
                source: (index * 2, index * 2 + 1),
                label: "x".to_string(),
                sound: Default::default(),
                quiet: 0,
                before: Vec::new(),
                after: Vec::new(),
            })
            .collect();
        let matchers = matchers(&g, &mut shared.tags);
        let chart = Recognizer { g: &g, matchers: &matchers, shared: &mut shared, recon: None }
            .recognize(&input, 0, start)
            .ok()?;
        // The witnesses of begins: completed items of r from the start, in
        // any set.
        let witnesses: Vec<(u32, u32)> = (0..chart.sets.len())
            .flat_map(|set| {
                chart.sets[set].completed.get(&(start, 0)).into_iter().flatten().map(move |&index| (set as u32, index))
            })
            .collect();
        if witnesses.is_empty() {
            return None;
        }
        let proofs = Proofs::new(&g, &chart, &input, &dialect.unicode, &shared.tags);
        let got = proofs.eligible(&witnesses);
        let mut oracle = Oracle::new(&g, &tokens, start);
        oracle.maximal = maximal;
        let mut truth = Vec::new();
        for &(set, index) in &witnesses {
            let item = chart.sets[set as usize].items[index as usize];
            // The tags of the captured part, as the oracle names them.
            let captured = chart.caps(item.caps).first().map_or(0, |cap| {
                let names = shared.tags.to_set(cap.tags);
                names.iter().next().map_or(0, |name| 1 + g.terminals.iter().position(|t| t == name).unwrap() as u8)
            });
            truth.push(oracle.search((item.prod, item.dot, 0, set, captured), false, &mut HashSet::new()).ok()?);
        }
        Some((got, truth, format!("{document}tokens {tokens:?}")))
    }

    /// The searches for a blocking path read an index of the chart that
    /// one pass builds, not every later set of the chart for each
    /// omission. So with no written terminator in the text, the number of
    /// entries that they look at grows linearly with the text.
    #[test]
    fn the_searches_for_blocking_paths_look_at_each_set_once() {
        let grammar = "%ambiguity-resolution greedy\n%rule text body B\n%conditions matches($, r)\n\
                       %rule body {A}\n%rule r parts B\n%rule parts {part}\n%rule part A [+T]\n";
        let operations = |n: usize, most: &dyn Fn(u64) -> u64| {
            let (eligible, operations, items) = query_work(grammar, n, 0, false, most);
            assert!(eligible.iter().all(|&eligible| eligible));
            (operations, items)
        };
        let (small, items) = operations(500, &|items| 4 * items);
        assert!(small > 0, "the searches ran");
        // The index is one pass over the chart, the searches read each
        // completed item of it at most once, and two sweeps settle the
        // items they rest on: at most four times the chart's items. An
        // index built again for each search would read the chart once per
        // search, so this stops the shorter text at the first operation
        // past that, before the longer one costs much.
        assert!(small <= 4 * items, "{small} operations for 500 tokens, over a chart of {items} items");
        // Four times the text costs about four times as much, not sixteen,
        // and the longer text's run stops at the first entry past that.
        let (large, _) = operations(2000, &|_| 6 * small);
        assert!(large < small * 6, "{small} operations for 500 tokens, {large} for 2000");
    }

    /// The checks of a maximal terminator in a query read the furthest end
    /// of each symbol from each origin, and for a tested symbol the
    /// furthest end where its test holds, each found once. So the work
    /// grows linearly with the text, where every omission of a maximal `T`
    /// meets a longer `y`, with and without a test on `y`. Each grammar asks
    /// for one table again and again: the furthest ends, the furthest end
    /// where the test holds from the start, and, where `matches` makes a
    /// tested `y` from every position, the completions from many origins.
    #[test]
    fn the_checks_of_maximal_terminators_grow_linearly() {
        for (grammar, begins, c) in maximal_grammars() {
            let (eligible, small, items) = query_work(grammar, 1000, c * 1000, begins, &|items| 6 * items);
            // The searches read the index once and each completed item
            // once, two sweeps settle the items they rest on, and the
            // checks find each table once, in a pass over the chart, and
            // test each completion at most once: at most six times the
            // chart's items. A table found again for each check
            // would read the chart once per check, so this stops the
            // shorter text at the first operation past that.
            assert!(small <= 6 * items, "{small} operations for 1000 tokens, over a chart of {items} items\n{grammar}");
            // Only the longest y permits the omission, or with the C's, the
            // longest where the test holds.
            assert_eq!(eligible.iter().filter(|&&eligible| eligible).count(), 1, "{grammar}");
            // The longer text's run stops at the first entry past its
            // budget.
            let (_, large, _) = query_work(grammar, 4000, c * 4000, begins, &|_| 6 * small);
            assert!(large < small * 6, "{small} operations for 1000 tokens, {large} for 4000\n{grammar}");
        }
    }

    /// An index of the chart built again for each search, or a table of
    /// maximality found again for each check, stops at the first count past
    /// the budget that `the_checks_of_maximal_terminators_grow_linearly`
    /// gives the longer text. The second and fourth grammars find their
    /// one table of passing ends once, so only the others repeat a table.
    #[test]
    fn indexes_found_again_stop_at_the_budget() {
        for (at, (grammar, begins, c)) in maximal_grammars().into_iter().enumerate() {
            let (_, small, _) = query_work(grammar, 1000, c * 1000, begins, &|_| u64::MAX);
            let mutants = [(Mutant::IndexPerSearch, Work::Searched), (Mutant::TablePerCheck, Work::Looked)];
            for (mutant, work) in mutants.into_iter().take(if at % 2 == 0 { 2 } else { 1 }) {
                let _mutation = Mutation::on(mutant);
                assert_stops(work, 6 * small, || {
                    query_work(grammar, 4000, c * 4000, begins, &|_| 6 * small);
                });
            }
        }
    }

    /// A query over a text where one item before an optional that stands
    /// alone has many completion edges, one for each way its first
    /// constituent completes. Each edge asks whether the chart reads the
    /// optional as written there. Asked once per item, the searches grow
    /// with n. Asked again at each edge, they grow with n².
    fn written_question_work(n: usize) {
        let starts: Vec<String> = (0..n).map(|index| format!("A{index}")).collect();
        let tagged: Vec<String> = (0..n).map(|index| format!("A{index} <~z>")).collect();
        let bs = vec!["b"; n].join(" ");
        let grammar = format!(
            "%ambiguity-resolution greedy\n%rule text $q(body) C\n%conditions text($) ≠ \"\" ∧ matches($q,r)\n\
             %rule body a KU tail\n%rule a {}\n%rule tail {{... B}}\n%rule r $prev(r) [+KU tail] | {}\n\
             %conditions $prev ⟹ text($) = \"a ku {bs}\"\n",
            starts.join(" | "),
            tagged.join(" | ")
        );
        let sources = [("main.md", format!("```jbogenbau\n{grammar}```\n")), ("p.md", PIPELINE.to_string())];
        let dialect = crate::load_dialect_sources(sources, "p.md").expect("the dialect");
        let token = |text: &str, tags: Vec<String>| crate::InputToken {
            text: text.to_string(),
            tags: tags.into_iter().collect(),
            phonemes: None,
        };
        let tokens: Vec<_> = [token("a", starts.clone()), token("ku", vec!["KU".to_string()])]
            .into_iter()
            .chain((0..n).map(|_| token("b", vec!["B".to_string()])))
            .chain([token("c", vec!["C".to_string()])])
            .collect();
        let options = crate::ParseOptions { auto_features: false, ..crate::ParseOptions::default() };
        // The token a reads as any of the n starts, so the stage ends in a
        // tie. The query runs before that, which is the work counted here.
        let result = dialect.parse_tokens(&tokens, &options).expect("a result");
        assert_eq!(result.stages[0].verdict, Some(crate::Verdict::Tie), "{n}");
    }

    /// The question whether an optional is read as written, asked once for
    /// each item, keeps the searches linear in n: 266 entries at 20 and 986
    /// at 80. Asked again at each edge, they take 1085 and 13865, so the
    /// larger run stops at the first entry past five times 266.
    #[test]
    fn the_question_of_a_written_optional_is_asked_once_per_item() {
        assert_linear(Work::Searched, 20, &mut written_question_work);
        assert_mutant_stops(Work::Searched, Mutant::AskWrittenAgain, 20, &mut written_question_work);
    }

    /// The grammars of the tests of maximality's work, each with whether
    /// its query is `begins`, and how many C's follow each A.
    fn maximal_grammars() -> [(&'static str, bool, usize); 4] {
        let plain = "%ambiguity-resolution greedy\n%rule text body B\n\
                     %conditions begins(from($), r)\n%rule body {A}\n%rule r y [++T]\n%rule y {A}\n";
        let tested = "%ambiguity-resolution greedy\n%rule text body B\n\
                      %conditions begins(from($), r)\n%rule body {A}\n%rule r y⊇~p [++T]\n%rule y {A} <~p>\n";
        let many = "%ambiguity-resolution greedy\n%rule text body B\n\
                    %conditions matches($, r)\n%rule body {A}\n%rule r parts B\n%rule parts {part}\n\
                    %rule part y⊇~p [++T]\n%rule y A <~p>\n";
        // After the A's come as many C's, so y completes from the start at
        // every end, and the test holds only of those that end before the
        // C's: the furthest end where it holds lies far before the furthest
        // completion.
        let far = "%ambiguity-resolution greedy\n%rule text body B\n\
                   %conditions begins(from($), r)\n%rule body {A} {C}\n%rule r y⊇~p [++T]\n\
                   %rule y {A} <~p> | {A} {C}\n";
        [(plain, true, 0), (tested, true, 0), (many, false, 0), (far, true, 1)]
    }

    /// Recognizes `n` tokens `A`, `c` tokens `C` and then a `B` as the rule `r` of the
    /// grammar, alone, as a query does. Gives which witnesses have an
    /// eligible proof tree, those of `begins` or of `matches`, how many
    /// entries of the chart the searches and the checks looked at, and how
    /// many items the chart holds. With a budget, the searches and the
    /// checks each panic at the first entry past it.
    fn query_work(grammar: &str, n: usize, c: usize, begins: bool, most: &dyn Fn(u64) -> u64) -> (Vec<bool>, u64, u64) {
        let sources = [("main.md", format!("```jbogenbau\n{grammar}```\n")), ("p.md", PIPELINE.to_string())];
        let dialect = crate::load_dialect_sources(sources, "p.md").expect("the dialect");
        let g = dialect.lowered_stage(0);
        let start = g.rules.iter().position(|rule| rule.name == "r" && !rule.helper).expect("r") as u32;
        let chars: Vec<char> = vec![' '; (n + c + 1) * 2];
        let mut shared = Shared::new(&dialect.unicode, &chars);
        let input: Vec<Tok> = (0..=n + c)
            .map(|index| Tok {
                text: "x".to_string(),
                tags: shared.tags.set_of([if index < n {
                    "A"
                } else if index < n + c {
                    "C"
                } else {
                    "B"
                }]),
                phonemes: None,
                source: (index * 2, index * 2 + 1),
                label: "x".to_string(),
                sound: Default::default(),
                quiet: 0,
                before: Vec::new(),
                after: Vec::new(),
            })
            .collect();
        let matchers = matchers(&g, &mut shared.tags);
        let chart = Recognizer { g: &g, matchers: &matchers, shared: &mut shared, recon: None }
            .recognize(&input, 0, start)
            .expect("a chart");
        let end = n + c + 1;
        let sets = if begins { 0..chart.sets.len() } else { end..end + 1 };
        let witnesses: Vec<(u32, u32)> = sets
            .flat_map(|set| {
                chart.sets[set].completed.get(&(start, 0)).into_iter().flatten().map(move |&index| (set as u32, index))
            })
            .collect();
        assert!(!witnesses.is_empty(), "r completes");
        let proofs = Proofs::new(&g, &chart, &input, &dialect.unicode, &shared.tags);
        // The chart is made before the searches, so the budget of the
        // searches can depend on its items.
        let items = chart.sets.iter().map(|set| set.items.len() as u64).sum();
        crate::work::reset();
        crate::work::budget(crate::work::Work::Searched, most(items));
        crate::work::budget(crate::work::Work::Looked, most(items));
        let eligible = proofs.eligible(&witnesses);
        (
            eligible,
            crate::work::counted(crate::work::Work::Searched) + crate::work::counted(crate::work::Work::Looked),
            items,
        )
    }

    #[test]
    fn written_terminator_priority_agrees_with_a_search_for_proof_trees() {
        let cases: u64 = std::env::var("GENCMU_PROPERTY_CASES").ok().and_then(|n| n.parse().ok()).unwrap_or(2000);
        let seed: u64 = std::env::var("GENCMU_PROPERTY_SEED").ok().and_then(|n| n.parse().ok()).unwrap_or(20261001);
        let mut rng = Rng(seed);
        let pipeline = crate::tools::read_grammar_document(PIPELINE).expect("the pipeline");
        let (mut checked, mut filtered) = (0, 0);
        let mut failures: HashMap<String, (Vec<bool>, Vec<bool>)> = HashMap::new();
        for case in 0..cases {
            let Some((got, truth, case)) = round(&mut rng, &pipeline, case % 50 == 0) else { continue };
            checked += 1;
            if truth.contains(&false) {
                filtered += 1;
            }
            if got != truth && failures.len() < 5 {
                failures.insert(case, (got, truth));
            }
        }
        eprintln!("eligibility: {checked} grammars checked, {filtered} with a witness filtered out");
        assert!(failures.is_empty(), "{} disagreements, as (library, oracle):\n{failures:#?}", failures.len());
        assert!(
            checked > cases / 4 && filtered > cases / 50,
            "{checked} grammars checked, {filtered} with a witness filtered out"
        );
    }
}
