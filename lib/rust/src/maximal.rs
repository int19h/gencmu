//! The resolution `maximal` (engine §4): an elided terminator is forbidden
//! where its constituent, the node before it, could have been longer.

use std::cell::OnceCell;

use crate::earley::{Chart, Item};
use crate::fxhash::FxMap;
use crate::lower::{Lowered, Sym};

/// What the ranking and the stage ask of `maximal`, over one stage's chart.
pub(crate) struct Maximal<'c> {
    g: &'c Lowered,
    chart: &'c Chart,
    /// The furthest set in which each symbol completes from each origin,
    /// found the first time it is asked for.
    furthest: OnceCell<FxMap<(u32, u32), u32>>,
}

impl<'c> Maximal<'c> {
    pub(crate) fn new(g: &'c Lowered, chart: &'c Chart) -> Maximal<'c> {
        Maximal { g, chart, furthest: OnceCell::new() }
    }

    /// Whether a constituent of `rule` from `origin` to `end` is an elided
    /// terminator: the empty production of an elidable optional's helper.
    /// The helper's other productions begin with its terminator, so over an
    /// empty span nothing else completes.
    pub(crate) fn elided(&self, rule: u32, origin: u32, end: u32) -> bool {
        origin == end && self.g.rules[rule as usize].elided.is_some()
    }

    /// Whether an item's next symbol is an elidable optional whose elision
    /// the node before it can forbid: not at the start of a production, and
    /// not after a production's first symbol when that is its own rule, what
    /// a repetition has read so far.
    pub(crate) fn guards(&self, item: &Item) -> bool {
        let production = &self.g.prods[item.prod as usize];
        match production.syms.get(item.dot as usize) {
            Some(&Sym::N(next)) if item.dot > 0 && self.g.rules[next as usize].elided.is_some() => {
                !(item.dot == 1 && production.syms[0] == Sym::N(production.rule))
            }
            _ => false,
        }
    }

    /// Whether an elided terminator may not follow a constituent of `rule`
    /// from `origin` to `end`: one of the same rule from the same origin
    /// completes in a later set.
    pub(crate) fn forbids(&self, rule: u32, origin: u32, end: u32) -> bool {
        self.furthest().get(&(rule, origin)).is_some_and(|&furthest| furthest > end)
    }

    // Whether a constituent could have been longer depends only on its
    // symbol, origin and end: the furthest set holding a completed item of
    // each symbol from each origin decides it.
    fn furthest(&self) -> &FxMap<(u32, u32), u32> {
        self.furthest.get_or_init(|| {
            let mut furthest = FxMap::default();
            // The sets in order, so that the last to insert a key is the
            // furthest.
            for (set, eset) in self.chart.sets.iter().enumerate() {
                for &key in eset.completed.keys() {
                    furthest.insert(key, set as u32);
                }
            }
            furthest
        })
    }
}
