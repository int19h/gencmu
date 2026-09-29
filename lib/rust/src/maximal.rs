//! The resolution `maximal` (engine §4): an elided terminator is forbidden
//! where its constituent, the node before it, could have been longer.

use std::cell::OnceCell;

use crate::earley::{test_holds, Chart, Item, Tok};
use crate::fxhash::FxMap;
use crate::lower::{Lowered, Sym, SymbolTest};
use crate::tags::{SetId, Tags};
use crate::unicode::Unicode;

/// Every completed item of each symbol from each origin, by (symbol,
/// origin), as its set and its tag set, in order.
type Completed = FxMap<(u32, u32), Vec<(u32, SetId)>>;

/// What the ranking and the stage ask of `maximal`, over one stage's chart.
pub(crate) struct Maximal<'c> {
    g: &'c Lowered,
    chart: &'c Chart,
    /// The tokens the chart was made over, the table of their canonical
    /// sound and the tag table, for the tests of symbols (§4, §5).
    tokens: &'c [Tok],
    unicode: &'c Unicode,
    tags: &'c Tags,
    /// The furthest set in which each symbol completes from each origin,
    /// found the first time it is asked for.
    furthest: OnceCell<FxMap<(u32, u32), u32>>,
    /// Every completed item of each symbol from each origin, as its set and
    /// its tag set, in order, found the first time a tested symbol asks for
    /// it.
    completed: OnceCell<Completed>,
}

impl<'c> Maximal<'c> {
    pub(crate) fn new(
        g: &'c Lowered,
        chart: &'c Chart,
        tokens: &'c [Tok],
        unicode: &'c Unicode,
        tags: &'c Tags,
    ) -> Maximal<'c> {
        Maximal { g, chart, tokens, unicode, tags, furthest: OnceCell::new(), completed: OnceCell::new() }
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
    /// from `origin` to `end`, which stands for a symbol with the given test,
    /// if it has one: one of the same rule from the same origin completes in
    /// a later set, and the test also holds of it, with its own span and its
    /// own tags.
    pub(crate) fn forbids(&self, rule: u32, origin: u32, end: u32, test: Option<&SymbolTest>) -> bool {
        match test {
            None => self.furthest().get(&(rule, origin)).is_some_and(|&furthest| furthest > end),
            Some(test) => self.completed().get(&(rule, origin)).is_some_and(|completed| {
                completed.iter().any(|&(later, tags)| {
                    later > end
                        && test_holds(
                            test,
                            &self.tokens[origin as usize..later as usize],
                            self.unicode,
                            self.tags,
                            tags,
                        )
                })
            }),
        }
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
