//! The private test hook of the check of `elision-only` (tests/README.md,
//! engine §7.8, §7.9): whether a check kept W(D), the chosen derivation
//! mapped to the reconstructed input, as a counted derivation of its
//! forest; and two ways to lose that witness on purpose, after
//! recognition. Nothing here is part of the documented API, and a parse
//! that no test watches pays nothing for it.

use std::cell::RefCell;

use crate::earley::{test_holds, Cap, Chart, Item, Tok};
use crate::lower::{Lowered, Sym};
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
    /// Whether the check's forest holds W(D) as a counted derivation.
    pub keeps_witness: bool,
}

thread_local! {
    static RUNS: RefCell<Option<Vec<ElisionCheckRun>>> = const { RefCell::new(None) };
    static LOSS: RefCell<Option<Loss>> = const { RefCell::new(None) };
}

/// Runs `parse` on this thread and returns its value with the checks of
/// `elision-only` that ran in it and met no error of the grammar, each
/// with whether it kept its witness.
pub fn with_elision_checks<T>(parse: impl FnOnce() -> T) -> (T, Vec<ElisionCheckRun>) {
    let before = RUNS.with(|runs| runs.replace(Some(Vec::new())));
    let value = parse();
    let runs = RUNS.with(|runs| runs.replace(before)).unwrap_or_default();
    (value, runs)
}

/// Runs `parse` on this thread with every check of `elision-only` losing
/// its witness in the given way, after recognition.
pub fn losing_witness<T>(loss: Loss, parse: impl FnOnce() -> T) -> T {
    let before = LOSS.with(|current| current.replace(Some(loss)));
    let value = parse();
    LOSS.with(|current| current.replace(before));
    value
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

/// Whether a check's forest holds W(D) as a counted derivation (engine
/// §7.8): for each node of W(D), from the leaves up, a completed item of the
/// node's production over the node's span of R, reached from the item of its
/// production at its origin through items that read exactly the node's
/// children, as the ranking links them, tests included. A read is of the
/// original token that D reads, found by its provenance. An elided
/// terminator of D is the restoration of its helper over its own synthetic
/// token. W(D) is not cyclic, since D is not, so such items count.
pub(crate) fn keeps_witness(forest: &CheckForest, chosen: &ITree) -> bool {
    if !forest.rooted {
        return false;
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
                let Some(&at) = forest.record_at.get(records) else {
                    return false;
                };
                records += 1;
                Some(at == cursor && forest.synthetic[at as usize])
            }
            _ => None,
        };
        match leaf {
            Some(false) => return false,
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
        return false;
    }

    // For each rule node of W(D), the indices of the completed items that
    // derive it exactly, in the set at its end.
    let mut found: Vec<Vec<u32>> = vec![Vec::new(); count];
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
            found[index as usize] = at(end, Item { prod, dot: 0, origin: start, caps: 0 }).into_iter().collect();
            continue;
        }
        let production = &g.prods[prod as usize];
        let mut current: Vec<Item> = at(start, Item { prod, dot: 0, origin: start, caps: 0 })
            .map(|_| Item { prod, dot: 0, origin: start, caps: 0 })
            .into_iter()
            .collect();
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
                        let mut caps = forest.chart.caps(item.caps).to_vec();
                        caps.push(Cap { start: from, end: to, tags });
                        let Some(caps) = forest.chart.lookup_caps(&caps) else {
                            continue;
                        };
                        let advanced = Item { prod, dot: item.dot + 1, origin: start, caps };
                        if at(to, advanced).is_some() && !next.contains(&advanced) {
                            next.push(advanced);
                        }
                    }
                } else if !own.is_empty() {
                    let advanced = Item { prod, dot: item.dot + 1, origin: start, caps: item.caps };
                    if at(to, advanced).is_some() && !next.contains(&advanced) {
                        next.push(advanced);
                    }
                }
            }
            current = next;
        }
        found[index as usize] = current.into_iter().filter_map(|item| at(end, item)).collect();
    }
    let (start, end) = spans[0];
    let IKind::Close { prod, .. } = chosen.nodes[0].kind else {
        return false;
    };
    start == 0 && end as usize == forest.tokens.len() && g.prods[prod as usize].rule == g.start && !found[0].is_empty()
}
