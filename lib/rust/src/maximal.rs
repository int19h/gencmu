//! Maximality (engine §4): an elided terminator is forbidden where its
//! constituent, the node before it, could have been longer. Stage-wide
//! `maximal` restricts every elidable terminator of the main parse, and a
//! maximal terminator, of an optional written `[++T …]`, restricts that
//! optional's elided terminators in the main parse and in nested queries.

use std::cell::{OnceCell, RefCell};

use crate::earley::{test_holds, Chart, Item, Tok};
use crate::fxhash::FxMap;
use crate::lower::{Lowered, Sym, SymbolTest};
use crate::tags::{SetId, Tags};
use crate::unicode::Unicode;
use crate::work::{self, Work};

/// Every completed item of each symbol from each origin, by (symbol,
/// origin), as its set and its tag set, in order.
type Completed = FxMap<(u32, u32), Vec<(u32, SetId)>>;

/// What the ranking, the stage and the nested queries ask of maximality,
/// over one chart.
pub(crate) struct Maximal<'c> {
    g: &'c Lowered,
    chart: &'c Chart,
    /// The tokens the chart was made over, the table of their canonical
    /// sound and the tag table, for the tests of symbols (§4, §5).
    tokens: &'c [Tok],
    unicode: &'c Unicode,
    tags: &'c Tags,
    /// Whether stage-wide `maximal` restricts every elidable terminator,
    /// or only the maximal terminators do.
    stage_wide: bool,
    /// The furthest set in which each symbol completes from each origin,
    /// found the first time it is asked for.
    furthest: OnceCell<FxMap<(u32, u32), u32>>,
    /// Every completed item of each symbol from each origin, as its set and
    /// its tag set, in order, found the first time a tested symbol asks for
    /// it.
    completed: OnceCell<Completed>,
    /// For a tested symbol, the furthest set in which it completes from an
    /// origin with its test holding, by (symbol, origin, test), found once
    /// for each.
    passing: RefCell<FxMap<(u32, u32, u32), Option<u32>>>,
}

impl<'c> Maximal<'c> {
    pub(crate) fn new(
        g: &'c Lowered,
        chart: &'c Chart,
        tokens: &'c [Tok],
        unicode: &'c Unicode,
        tags: &'c Tags,
        stage_wide: bool,
    ) -> Maximal<'c> {
        Maximal {
            g,
            chart,
            tokens,
            unicode,
            tags,
            stage_wide,
            furthest: OnceCell::new(),
            completed: OnceCell::new(),
            passing: RefCell::default(),
        }
    }

    /// Whether maximality restricts the elided terminators of the helper
    /// `rule`: it is an elidable optional's helper, and stage-wide
    /// `maximal` is on or its terminator is maximal.
    pub(crate) fn restricts(&self, rule: u32) -> bool {
        let rule = &self.g.rules[rule as usize];
        rule.elided.is_some() && (self.stage_wide || rule.maximal)
    }

    /// Whether a constituent of `rule` from `origin` to `end` is an elided
    /// terminator that maximality restricts: the empty production of such
    /// a helper. The helper's other productions begin with its terminator,
    /// so over an empty span nothing else completes.
    pub(crate) fn elided(&self, rule: u32, origin: u32, end: u32) -> bool {
        origin == end && self.restricts(rule)
    }

    /// Whether an item's next symbol is an elidable optional whose elision
    /// the node before it can forbid: not at the start of a production, and
    /// not after a production's first symbol when that is its own rule, what
    /// a repetition has read so far.
    pub(crate) fn guards(&self, item: &Item) -> bool {
        let production = &self.g.prods[item.prod as usize];
        match production.syms.get(item.dot as usize) {
            Some(&Sym::N(next)) if item.dot > 0 && self.restricts(next) => {
                !(item.dot == 1 && production.syms[0] == Sym::N(production.rule))
            }
            _ => false,
        }
    }

    /// Whether an elided terminator may not follow a constituent of `rule`
    /// from `origin` to `end`, which stands for a symbol with the test of
    /// the given id, if it has one: one of the same rule from the same
    /// origin completes in a later set, and the test also holds of it, with
    /// its own span and its own tags. Each check reads the furthest such
    /// set, which is found once for each symbol, origin and test.
    pub(crate) fn forbids(&self, rule: u32, origin: u32, end: u32, test: Option<u32>) -> bool {
        let furthest = match test {
            None => self.furthest().get(&(rule, origin)).copied(),
            Some(test) => *self
                .passing
                .borrow_mut()
                .entry((rule, origin, test))
                .or_insert_with(|| self.furthest_passing(rule, origin, &self.g.tests[test as usize])),
        };
        furthest.is_some_and(|furthest| furthest > end)
    }

    /// The furthest set in which `rule` completes from `origin` with `test`
    /// holding of the completed item.
    fn furthest_passing(&self, rule: u32, origin: u32, test: &SymbolTest) -> Option<u32> {
        let completed = self.completed().get(&(rule, origin))?;
        completed.iter().rev().find_map(|&(later, tags)| {
            work::count(Work::Looked, 1);
            test_holds(test, &self.tokens[origin as usize..later as usize], self.unicode, self.tags, tags)
                .then_some(later)
        })
    }

    // Whether a constituent could have been longer depends only on its
    // symbol, its test, its origin and its end: without a test, the
    // furthest set holding a completed item of each symbol from each origin
    // decides it.
    fn furthest(&self) -> &FxMap<(u32, u32), u32> {
        self.furthest.get_or_init(|| {
            let mut furthest = FxMap::default();
            // The sets in order, so that the last to insert a key is the
            // furthest.
            for (set, eset) in self.chart.sets.iter().enumerate() {
                work::count(Work::Looked, eset.completed.len() as u64);
                for &key in eset.completed.keys() {
                    furthest.insert(key, set as u32);
                }
            }
            furthest
        })
    }

    fn completed(&self) -> &Completed {
        self.completed.get_or_init(|| {
            let mut completed = Completed::default();
            for (set, eset) in self.chart.sets.iter().enumerate() {
                for (&key, items) in &eset.completed {
                    work::count(Work::Looked, items.len() as u64);
                    let list = completed.entry(key).or_default();
                    for &index in items {
                        list.push((set as u32, eset.tagset[index as usize]));
                    }
                }
            }
            completed
        })
    }
}
