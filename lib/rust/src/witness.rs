//! The private test hook of the check of `elision-only` (tests/README.md,
//! engine §7.8, §7.9): whether a check kept W(D), the chosen derivation
//! mapped to the reconstructed input, as a derivation of its forest that
//! its own ranking counts; and two ways to lose that witness on purpose, after
//! recognition. Nothing here is part of the documented API, and a parse
//! that no test watches pays nothing for it.

use std::cell::RefCell;

use crate::earley::{test_holds, Cap, Chart, Item, Tok};
use crate::fxhash::FxSet;
use crate::lower::{Lowered, Sym};
use crate::rank::restored_terminal;
use crate::tags::{SetId, Tags};
use crate::tree::{IKind, ITree};
use crate::unicode::Unicode;

/// A way to lose the witness of a check after recognition (engine §7.9).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Loss {
    /// The check finds no completed item of `text` over the reconstructed
    /// input.
    Roots,
    /// The check finds such items, but no counted derivation of them.
    Count,
}

/// A check of `elision-only` that ran and met no error of the grammar.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ElisionCheckRun {
    /// The stage whose check it was.
    pub stage: String,
    /// Whether the check's chart holds W(D), and its own ranking counts it.
    pub keeps_witness: bool,
}

/// A fault of this library's own paths in the check of `elision-only`,
/// which a test turns on to show that the shared cases catch it
/// (tests/README.md). The omission fault also affects the original recognition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Fault {
    /// The recognizer admits an omission without its restoration predicate.
    Omission,
    /// The ranker, which rebuilds the links of the check's derivations from
    /// completed spans, applies no symbol test to them.
    RankerTests,
    /// The ranker reads a test of a reference over its span of R, not over
    /// the projected span in O (§7.5).
    ReferenceSpan,
    /// An item that an ordinary step reaches after it was processed as
    /// strict is not processed again (§7.4).
    Reprocess,
    /// The item after the `T` of the written route from a synthetic token
    /// is ordinary, not strict (§7.4).
    Route3,
    /// The ranker gives a restoration no derivation, so the ranking does not
    /// count W(D) though the chart holds it.
    RankRestoration,
    /// The check's count skips the last of two or more alternatives of a
    /// node, a link of an item or a member of a group. Only the witness
    /// hook sees it where the readings stay.
    LostContext,
    /// The check's entries, which give its readings, skip that alternative.
    LostSelect,
    /// A restoration is made without the test of its terminal (§7.4).
    Restore,
}

impl Fault {
    /// Every fault, for the tests that run each one.
    pub const ALL: [Fault; 9] = [
        Fault::Omission,
        Fault::RankerTests,
        Fault::ReferenceSpan,
        Fault::Reprocess,
        Fault::Route3,
        Fault::RankRestoration,
        Fault::LostContext,
        Fault::LostSelect,
        Fault::Restore,
    ];

    /// The sites of a fault: the places in the code where it is checked,
    /// each of which the named cases must enter while it is on.
    pub fn sites(self) -> &'static [&'static str] {
        match self {
            Fault::RankerTests | Fault::ReferenceSpan | Fault::LostContext | Fault::LostSelect => &["links", "group"],
            Fault::Omission | Fault::Reprocess | Fault::Route3 | Fault::RankRestoration | Fault::Restore => &[""],
        }
    }
}

thread_local! {
    static RUNS: RefCell<Option<Vec<ElisionCheckRun>>> = const { RefCell::new(None) };
    static LOSS: RefCell<Option<Loss>> = const { RefCell::new(None) };
    static FAULT: RefCell<Option<Fault>> = const { RefCell::new(None) };
    static HITS: RefCell<Vec<(Fault, &'static str)>> = const { RefCell::new(Vec::new()) };
}

/// The sites of faults that this thread entered while they were on, each
/// once, since the last call, which clears them.
pub fn fault_hits() -> Vec<(Fault, &'static str)> {
    HITS.with(|hits| std::mem::take(&mut *hits.borrow_mut()))
}

/// Runs `parse` on this thread with a fault of the check turned on.
pub fn with_fault<T>(fault: Fault, parse: impl FnOnce() -> T) -> T {
    // Puts back the fault before, also where `parse` panics.
    struct Restore(Option<Fault>);
    impl Drop for Restore {
        fn drop(&mut self) {
            FAULT.with(|current| current.replace(self.0));
        }
    }
    let _restore = Restore(FAULT.with(|current| current.replace(Some(fault))));
    parse()
}

/// Whether a test turned on this fault on this thread, at its one site.
pub(crate) fn fault(fault: Fault) -> bool {
    fault_at(fault, "")
}

/// Whether a test turned on this fault on this thread, at one of its
/// sites, which a fault that is on records as entered.
pub(crate) fn fault_at(fault: Fault, site: &'static str) -> bool {
    let on = FAULT.with(|current| *current.borrow() == Some(fault));
    if on {
        HITS.with(|hits| {
            let mut hits = hits.borrow_mut();
            if !hits.contains(&(fault, site)) {
                hits.push((fault, site));
            }
        });
    }
    on
}

/// Runs `parse` on this thread and returns its value with the checks of
/// `elision-only` that ran in it and met no error of the grammar, each
/// with whether it kept its witness.
pub fn with_elision_checks<T>(parse: impl FnOnce() -> T) -> (T, Vec<ElisionCheckRun>) {
    // Puts back what was watched before, also where `parse` panics.
    struct Restore(Option<Option<Vec<ElisionCheckRun>>>);
    impl Drop for Restore {
        fn drop(&mut self) {
            if let Some(before) = self.0.take() {
                RUNS.with(|runs| runs.replace(before));
            }
        }
    }
    let mut restore = Restore(Some(RUNS.with(|runs| runs.replace(Some(Vec::new())))));
    let value = parse();
    let before = restore.0.take().expect("not yet restored");
    let runs = RUNS.with(|runs| runs.replace(before)).unwrap_or_default();
    (value, runs)
}

/// Runs `parse` on this thread with every check of `elision-only` losing
/// its witness in the given way, after recognition.
pub fn losing_witness<T>(loss: Loss, parse: impl FnOnce() -> T) -> T {
    // Puts back the loss before, also where `parse` panics.
    struct Restore(Option<Loss>);
    impl Drop for Restore {
        fn drop(&mut self) {
            LOSS.with(|current| current.replace(self.0));
        }
    }
    let _restore = Restore(LOSS.with(|current| current.replace(Some(loss))));
    parse()
}

/// The loss that a test asks for on this thread, if any.
pub(crate) fn loss() -> Option<Loss> {
    LOSS.with(|current| *current.borrow())
}

/// Whether a test watches the checks on this thread.
pub(crate) fn watched() -> bool {
    RUNS.with(|runs| runs.borrow().is_some())
}

/// Records a check that a test watches.
pub(crate) fn record(stage: &str, keeps_witness: bool) {
    RUNS.with(|runs| {
        if let Some(runs) = runs.borrow_mut().as_mut() {
            runs.push(ElisionCheckRun { stage: stage.to_string(), keeps_witness });
        }
    });
}

/// What the witness walk reads of one check.
pub(crate) struct CheckForest<'a> {
    pub g: &'a Lowered,
    pub chart: &'a Chart,
    /// Whether the chart has completed items of `text` over R that count
    /// as its roots.
    pub rooted: bool,
    /// R, the reconstructed input, and O, the stage's input.
    pub tokens: &'a [Tok],
    pub observed: &'a [Tok],
    pub project: &'a [u32],
    pub synthetic: &'a [bool],
    /// For each token of O, its index in R.
    pub original_at: &'a [u32],
    /// For each restoration record, the index of its synthetic token in R.
    pub record_at: &'a [u32],
    pub unicode: &'a Unicode,
    pub tags: &'a Tags,
    /// The empty tag set, which a terminal that reads a synthetic token
    /// captures.
    pub empty: SetId,
}

/// The marks of W(D) that the check's ranker takes (tests/README.md): the
/// items of W(D), each by its set and its index there, and the links that
/// W(D) uses, each as the ranker rebuilds it, by its item and the set where
/// its predecessor stands, which is where its child begins.
#[derive(Debug, Default)]
pub(crate) struct Marks {
    pub items: FxSet<(u32, u32)>,
    pub links: FxSet<(u32, u32, u32)>,
}

/// One action of W(D), as the ranking writes a derivation: a read of a
/// token of R as a terminal, or the close of an item by its set and index.
#[derive(Debug, Clone, Copy)]
pub(crate) enum WitnessAct {
    Read { tok: u32, terminal: u32 },
    Close { set: u32, index: u32 },
}

/// W(D) as the walk finds it: its marks, and its actions in order.
#[derive(Debug)]
pub(crate) struct Walk {
    pub marks: Marks,
    pub sequence: Vec<WitnessAct>,
}

/// The walk: W(D) in the chart of a check, before the check ranks (engine
/// §7.8), or `None` where the chart does not hold it. For each node of W(D),
/// from the leaves up, a completed item of the node's production over the
/// node's span of R, reached from the item of its production at its origin
/// through items that read exactly the node's children, as the ranking links
/// them, tests included. A read is of the original token that D reads, found
/// by its provenance. An elided terminator of D is the restoration of its
/// helper over its own synthetic token. The walk marks the items and links
/// that it uses, and writes W(D)'s actions in post-order, so that the hook
/// ranks nothing itself. It pins the shape of W(D), not its tags.
pub(crate) fn walk(forest: &CheckForest, chosen: &ITree) -> Option<Walk> {
    if !forest.rooted {
        return None;
    }
    let g = forest.g;
    let elided = |node: &IKind| match node {
        IKind::Close { prod, .. } => {
            let production = &g.prods[*prod as usize];
            let rule = &g.rules[production.rule as usize];
            rule.helper && rule.elided.is_some() && production.syms.is_empty()
        }
        IKind::Read { .. } => false,
    };
    // The nodes of D in post-order, each with its span in R. A cursor walks
    // the leaves of D left to right: a read takes its original token, an
    // elided terminator its record's synthetic token, in order.
    let count = chosen.nodes.len();
    let mut spans = vec![(0u32, 0u32); count];
    let mut order: Vec<u32> = Vec::with_capacity(count);
    let mut cursor = 0u32;
    let mut records = 0usize;
    let mut stack: Vec<(u32, usize, u32)> = vec![(0, 0, 0)];
    while let Some(&mut (index, ref mut next, ref mut start)) = stack.last_mut() {
        let node = &chosen.nodes[index as usize];
        if *next == 0 {
            *start = cursor;
        }
        let leaf = match node.kind {
            IKind::Read { tok, .. } => {
                let at = forest.original_at[tok as usize];
                Some(at == cursor && !forest.synthetic[at as usize])
            }
            ref kind if elided(kind) => {
                let &at = forest.record_at.get(records)?;
                records += 1;
                Some(at == cursor && forest.synthetic[at as usize])
            }
            _ => None,
        };
        match leaf {
            Some(false) => return None,
            Some(true) => {
                spans[index as usize] = (cursor, cursor + 1);
                cursor += 1;
                order.push(index);
                stack.pop();
            }
            None if *next < node.children.len() => {
                let child = node.children[*next];
                *next += 1;
                stack.push((child, 0, cursor));
            }
            None => {
                spans[index as usize] = (*start, cursor);
                order.push(index);
                stack.pop();
            }
        }
    }
    if records != forest.record_at.len() || cursor as usize != forest.synthetic.len() {
        return None;
    }

    // For each rule node of W(D), the indices of the completed items that
    // derive it exactly, in the set at its end; and every item that the walk
    // reaches, by set and index.
    let mut found: Vec<Vec<u32>> = vec![Vec::new(); count];
    let mut marks = Marks::default();
    for &index in &order {
        let node = &chosen.nodes[index as usize];
        let IKind::Close { prod, .. } = node.kind else {
            continue;
        };
        let (start, end) = spans[index as usize];
        let at = |set: u32, item: Item| forest.chart.sets.get(set as usize).and_then(|set| set.find(&item));
        if elided(&node.kind) {
            // The restoration: the empty production's item from `start`,
            // in the set after it.
            found[index as usize] = if forest.chart.machine.is_some() {
                forest.chart.sets[end as usize]
                    .items
                    .iter()
                    .enumerate()
                    .filter(|(_, item)| item.prod == prod && item.dot == 0 && item.origin == start && item.caps == 0)
                    .map(|(i, _)| i as u32)
                    .collect()
            } else {
                at(end, Item { prod, dot: 0, origin: start, caps: 0, prefix: 0, structure: u32::MAX })
                    .into_iter()
                    .collect()
            };
            marks.items.extend(found[index as usize].iter().map(|&item| (end, item)));
            continue;
        }
        let production = &g.prods[prod as usize];
        if forest.chart.machine.is_some() {
            let mut current: Vec<Item> = forest.chart.sets[start as usize]
                .items
                .iter()
                .filter(|item| item.prod == prod && item.dot == 0 && item.origin == start && item.caps == 0)
                .copied()
                .collect();
            for &item in &current {
                if let Some(i) = at(start, item) {
                    marks.items.insert((start, i));
                }
            }
            for (position, &child) in node.children.iter().enumerate() {
                let (from, to) = spans[child as usize];
                let mut next = Vec::new();
                for &item in &current {
                    let mut caps = Vec::new();
                    match (&chosen.nodes[child as usize].kind, production.syms[position]) {
                        (IKind::Read { tok, terminal }, Sym::T(symbol)) if *terminal == symbol => {
                            let rule = &g.rules[production.rule as usize];
                            let omitted = forest.synthetic[from as usize]
                                && position == 0
                                && rule.helper
                                && rule.elided.is_some();
                            if let Some(&structure) = forest.chart.terminal_states.get(&(from, symbol, omitted)) {
                                let token = &forest.tokens[forest.original_at[*tok as usize] as usize];
                                let tags = if forest.synthetic[from as usize] { forest.empty } else { token.tags };
                                caps.push(Cap { start: from, end: to, tags, structure });
                            }
                        }
                        (IKind::Close { .. }, Sym::N(_)) => {
                            for &i in &found[child as usize] {
                                let set = &forest.chart.sets[to as usize];
                                caps.push(Cap {
                                    start: from,
                                    end: to,
                                    tags: set.tagset[i as usize],
                                    structure: set.items[i as usize].structure,
                                });
                            }
                        }
                        _ => {}
                    }
                    for cap in caps {
                        if let Some(&advanced) = forest.chart.advances.get(&(item, cap)) {
                            if let Some(i) = at(to, advanced) {
                                if !next.contains(&advanced) {
                                    next.push(advanced);
                                }
                                marks.items.insert((to, i));
                                marks.links.insert((to, i, from));
                            }
                        }
                    }
                }
                current = next;
            }
            found[index as usize] = current.into_iter().filter_map(|item| at(end, item)).collect();
            continue;
        }
        let mut current: Vec<Item> =
            at(start, Item { prod, dot: 0, origin: start, caps: 0, prefix: 0, structure: u32::MAX })
                .map(|_| Item { prod, dot: 0, origin: start, caps: 0, prefix: 0, structure: u32::MAX })
                .into_iter()
                .collect();
        marks.items.extend(
            at(start, Item { prod, dot: 0, origin: start, caps: 0, prefix: 0, structure: u32::MAX })
                .map(|item| (start, item)),
        );
        for (position, &child) in node.children.iter().enumerate() {
            let (from, to) = spans[child as usize];
            let test = g.test(prod, position);
            // The tag sets that the child can have here: a read's token's,
            // or none for a synthetic one; the derived items' own for a
            // rule. Each must pass the symbol's test.
            let own: Vec<SetId> = match (chosen.nodes[child as usize].kind.clone(), production.syms[position]) {
                (IKind::Read { tok, terminal }, Sym::T(symbol)) if terminal == symbol => {
                    let token = &forest.tokens[forest.original_at[tok as usize] as usize];
                    let passes = test.map_or(true, |test| {
                        test_holds(test, std::slice::from_ref(token), forest.unicode, forest.tags, token.tags)
                    });
                    if passes {
                        vec![token.tags]
                    } else {
                        Vec::new()
                    }
                }
                (IKind::Close { .. }, Sym::N(_)) => {
                    let set = &forest.chart.sets[to as usize];
                    let span =
                        &forest.observed[forest.project[from as usize] as usize..forest.project[to as usize] as usize];
                    let mut sets: Vec<SetId> = found[child as usize]
                        .iter()
                        .map(|&item| set.tagset[item as usize])
                        .filter(|&tags| {
                            test.map_or(true, |test| test_holds(test, span, forest.unicode, forest.tags, tags))
                        })
                        .collect();
                    sets.sort_unstable();
                    sets.dedup();
                    sets
                }
                _ => Vec::new(),
            };
            let mut next: Vec<Item> = Vec::new();
            for item in &current {
                if production.cap_at[position].is_some() {
                    for &tags in &own {
                        let tags = match production.syms[position] {
                            Sym::T(_) if forest.synthetic[from as usize] => forest.empty,
                            _ => tags,
                        };
                        let Some(caps) = forest
                            .chart
                            .lookup_caps(item.caps, Cap { start: from, end: to, tags, structure: u32::MAX })
                        else {
                            continue;
                        };
                        let advanced =
                            Item { prod, dot: item.dot + 1, origin: start, caps, prefix: 0, structure: u32::MAX };
                        if at(to, advanced).is_some() && !next.contains(&advanced) {
                            next.push(advanced);
                        }
                    }
                } else if !own.is_empty() {
                    let advanced = Item {
                        prod,
                        dot: item.dot + 1,
                        origin: start,
                        caps: item.caps,
                        prefix: 0,
                        structure: u32::MAX,
                    };
                    if at(to, advanced).is_some() && !next.contains(&advanced) {
                        next.push(advanced);
                    }
                }
            }
            for &item in &next {
                if let Some(index) = at(to, item) {
                    marks.items.insert((to, index));
                    marks.links.insert((to, index, from));
                }
            }
            current = next;
        }
        found[index as usize] = current.into_iter().filter_map(|item| at(end, item)).collect();
    }
    let (start, end) = spans[0];
    let IKind::Close { prod, .. } = chosen.nodes[0].kind else {
        return None;
    };
    let whole = start == 0 && end as usize == forest.tokens.len() && g.prods[prod as usize].rule == g.start;
    if !whole || found[0].is_empty() {
        return None;
    }
    // W(D)'s actions, in post-order, over the tokens of R and the items
    // found. A restoration reads its synthetic token, and then closes.
    let mut sequence = Vec::with_capacity(order.len() * 2);
    for &index in &order {
        let node = &chosen.nodes[index as usize];
        let (start, end) = spans[index as usize];
        match node.kind {
            IKind::Read { terminal, .. } => sequence.push(WitnessAct::Read { tok: start, terminal }),
            IKind::Close { prod, .. } => {
                if elided(&node.kind) {
                    sequence.push(WitnessAct::Read { tok: start, terminal: restored_terminal(g, prod) });
                }
                let &item = found[index as usize].first()?;
                sequence.push(WitnessAct::Close { set: end, index: item });
            }
        }
    }
    Some(Walk { marks, sequence })
}
