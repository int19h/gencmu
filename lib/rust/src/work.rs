//! Counters of work, for the tests that the work grows with the input as it
//! should, on this thread. Each kind below says what it counts and where.
//! They exist only in the crate's own tests: elsewhere `count` compiles to
//! nothing. A test can give a counter a budget, which the count past it
//! panics at, so that a regression to quadratic work stops at once and does
//! not run on.

#[cfg(test)]
use std::cell::RefCell;

/// What a counter counts.
#[derive(Debug, Clone, Copy)]
pub(crate) enum Work {
    /// The items that the recognizer makes, in parses and nested parses.
    Items,
    /// The lookups of an item in the index of its set, which the recognizer
    /// makes as it adds items and the searches of its chart make as they
    /// read it, and the productions that the recognizer's predictions look
    /// at. Each counts once, before it is made.
    Found,
    /// The entries of the chart that the searches for a blocking path look
    /// at: each completed item that their index is built from, and then
    /// each that they read from it.
    Searched,
    /// The completed items that the checks of maximality look at: those
    /// that their tables are found from, as each table is found, and each
    /// completion that a tested symbol's test is evaluated on.
    Looked,
    /// The cycle contexts that the rankings make.
    Contexts,
    /// The sequences of captured parts that the recognizer makes, each one
    /// part added to a sequence it shares (§4).
    Captures,
    /// The steps through sequences of captured parts, from a part to the
    /// one before it or along a jump, that reading them takes.
    CaptureSteps,
    /// The steps of the notation's readers, of the walks of what they read,
    /// of the checks of a rule's clauses, and of the ranker's search for
    /// the derivations of an item. Also the steps of the simplification of
    /// clauses for productions, and of the splits that it reads.
    Walked,
    /// The tokens that the sound tests step to (§5).
    Sounded,
    /// The conditions that the selection for each item added to the chart
    /// examines, each counted before its dot is checked, with one more for
    /// each item.
    Conditions,
    /// The nodes of conditions and terms that evaluation visits, each
    /// counted before it is evaluated, also in an evaluation that halts.
    Visits,
    /// The tags that the evaluation of tag terms writes into the lists it
    /// makes, or reads to make them: unions, the tags of spans, ranges,
    /// intersections, differences, classes and the pieces of a split. Each
    /// is counted as it is written or read.
    Listed,
    /// The tokens of spans that `text` and `phonemes` terms read, each
    /// counted as it is read.
    Spanned,
    /// The implications, and their consequents, that the closure of a
    /// token's tags looks at (§11).
    Implied,
    /// The kept edges of a ranking node that the question whether an edge
    /// is kept compares with.
    Kept,
    /// The captures and emitted items that the check of a definition looks
    /// at (§9).
    Checked,
    /// The symbols, rules and tests that lowering's fixpoints and its table
    /// of tests look at.
    Lowered,
    /// The documents of the chain, the stages and the features that a
    /// splice compares with as it checks each new one.
    Spliced,
    /// The clauses that stitching substitutes constants in and checks.
    Stitched,
    /// The classes of a key that resolving a classifier compares with.
    Classified,
}

/// The mutations that the tests of work switch on, one at a time, to check
/// that a budget stops a quadratic version of some code at its first count
/// past it. Each names the version that the code takes while it is on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Mutant {
    /// Condition selection scans every condition of the production for
    /// those of the dot.
    ScanConditions,
    /// The search for the origins of a derivation builds the positions of
    /// the chart's items again at each call.
    PositionsPerCall,
    /// The search for the origins of a derivation walks the origins of the
    /// rule's constituents that end at the set, even when the other list
    /// is shorter.
    WalkEnding,
    /// The searches for a blocking path build their index of the chart
    /// again for each search.
    IndexPerSearch,
    /// The checks of maximality find their tables of the chart again for
    /// each check.
    TablePerCheck,
    /// The check of an optional that stands alone asks again at each edge
    /// of an item whether the chart reads the optional as written there.
    AskWrittenAgain,
    /// The search for duplicate captures looks up and moves the newer
    /// part of a sequence, not the one with fewer captures.
    JoinIntoFirst,
    /// The search for duplicate captures keeps each capture it marks in
    /// its list, so that each level above marks it again.
    MarkAgain,
    /// The product of capture sequences copies each sequence with its
    /// suffix, not growing it in place.
    CopySequences,
    /// The distinct capture sequences are found by comparing each with
    /// every one kept before it, not by a set of keys.
    ScanDistinct,
    /// The search for cycles finds each component's members by a scan of
    /// its stack from the bottom.
    ComponentByScan,
    /// The check of a definition finds the first position of each capture
    /// by a scan from the start of its production.
    FirstByScan,
    /// Stitching copies a rule's clauses for each alternative.
    ClausesPerAlternative,
    /// The closure of a token's tags scans every implication for each tag.
    ScanImplications,
    /// A union of many lists is a fold of pairwise unions.
    FoldUnions,
    /// An intersection, a difference or a test of a subset scans the other
    /// list for each tag, not searching it.
    ScanOther,
    /// The search of lowering for the rules that read tests every symbol
    /// of a production for a terminal at each of its symbols.
    TerminalAtEach,
    /// Lowering finds the rules that read by passes over every production,
    /// not by a worklist.
    ReadsByPasses,
    /// Lowering finds the last symbol of a production that reads by a scan
    /// of the rest from each position, not one walk back from the end.
    LastReadByScans,
    /// Lowering finds the nullable rules by passes over every production,
    /// not by a worklist.
    NullableByPasses,
    /// Unit-edge discovery tests every other symbol of a production at
    /// each symbol.
    CheckEveryOther,
    /// The check of a definition simplifies every part of each rule-level
    /// tag term and condition for each production, not from its split.
    CheckEachPart,
    /// Lowering simplifies every part of each tag term and condition for
    /// each production, not from its split.
    LowerEachPart,
}

/// Whether the tests have switched `mutant` on, on this thread. Outside the
/// crate's own tests it is always false, so the branch it guards is gone.
#[inline(always)]
pub(crate) fn mutated(mutant: Mutant) -> bool {
    #[cfg(test)]
    {
        MUTANT.with(|on| on.get() == Some(mutant))
    }
    #[cfg(not(test))]
    {
        let _ = mutant;
        false
    }
}

/// A mutation switched on until this is dropped, also when a budget's
/// panic unwinds.
#[cfg(test)]
pub(crate) struct Mutation;

#[cfg(test)]
impl Mutation {
    pub(crate) fn on(mutant: Mutant) -> Mutation {
        MUTANT.with(|on| on.set(Some(mutant)));
        Mutation
    }
}

#[cfg(test)]
impl Drop for Mutation {
    fn drop(&mut self) {
        MUTANT.with(|on| on.set(None));
    }
}

/// How many kinds of work there are.
#[cfg(test)]
const KINDS: usize = Work::Classified as usize + 1;

#[cfg(test)]
thread_local! {
    static COUNTS: RefCell<[u64; KINDS]> = const { RefCell::new([0; KINDS]) };
    static BUDGETS: RefCell<[u64; KINDS]> = const { RefCell::new([u64::MAX; KINDS]) };
    /// For each kind, another kind and a factor: the count may not pass
    /// the factor times the other's count so far.
    static BOUNDS: RefCell<[Option<(Work, u64)>; KINDS]> = const { RefCell::new([None; KINDS]) };
    /// The mutation switched on, if any.
    static MUTANT: std::cell::Cell<Option<Mutant>> = const { std::cell::Cell::new(None) };
}

/// Adds `n` to the counter of `work`, in tests only, and panics if that
/// takes it past its budget.
#[inline(always)]
pub(crate) fn count(work: Work, n: u64) {
    #[cfg(test)]
    {
        let counted = COUNTS.with(|counts| {
            let counter = &mut counts.borrow_mut()[work as usize];
            *counter += n;
            *counter
        });
        let most = BUDGETS.with(|budgets| budgets.borrow()[work as usize]);
        assert!(counted <= most, "{counted} {work:?}, past the budget of {most}");
        if let Some((by, factor)) = BOUNDS.with(|bounds| bounds.borrow()[work as usize]) {
            let most = factor * COUNTS.with(|counts| counts.borrow()[by as usize]);
            assert!(counted <= most, "{counted} {work:?}, past {factor} times the {by:?} so far, {most}");
        }
    }
    #[cfg(not(test))]
    let _ = (work, n);
}

/// Sets every counter on this thread back to zero, with no budget.
#[cfg(test)]
pub(crate) fn reset() {
    COUNTS.with(|counts| *counts.borrow_mut() = [0; KINDS]);
    BUDGETS.with(|budgets| *budgets.borrow_mut() = [u64::MAX; KINDS]);
    BOUNDS.with(|bounds| *bounds.borrow_mut() = [None; KINDS]);
}

/// Holds the counter of `work` on this thread, until the next `reset`, to
/// `factor` times the count of `by` so far: the count past that panics.
/// A test can then bound one count by another while the work runs, where
/// the other is not known before it.
#[cfg(test)]
pub(crate) fn bound(work: Work, by: Work, factor: u64) {
    BOUNDS.with(|bounds| bounds.borrow_mut()[work as usize] = Some((by, factor)));
}

/// Gives the counter of `work` on this thread a budget until the next
/// `reset`: the count past it panics.
#[cfg(test)]
pub(crate) fn budget(work: Work, most: u64) {
    BUDGETS.with(|budgets| budgets.borrow_mut()[work as usize] = most);
}

/// The count of `work` on this thread since the last `reset`.
#[cfg(test)]
pub(crate) fn counted(work: Work) -> u64 {
    COUNTS.with(|counts| counts.borrow()[work as usize])
}

/// Runs `run` with a budget of `most` for `work`, and asserts that it
/// stops at the first count past the budget. A mutation that does too much
/// work must stop there, not when the work is over.
#[cfg(test)]
pub(crate) fn assert_stops(work: Work, most: u64, run: impl FnOnce()) {
    reset();
    budget(work, most);
    let caught = std::panic::catch_unwind(std::panic::AssertUnwindSafe(run));
    let total = counted(work);
    reset();
    let Err(payload) = caught else { panic!("{work:?}: {total} counted, and the budget of {most} never stopped it") };
    eprintln!("{work:?} stopped at {}", most + 1);
    let message = payload.downcast_ref::<String>().cloned().unwrap_or_default();
    assert_eq!(message, format!("{} {work:?}, past the budget of {most}", most + 1));
}

/// Runs `run` at n as it is, and then at 4n with `mutant` on and the
/// budget that `assert_linear` gives the larger run: five times the count
/// at n. The mutation must stop at the first count past that budget, so
/// the test of linear work would catch it.
#[cfg(test)]
pub(crate) fn assert_mutant_stops(work: Work, mutant: Mutant, n: usize, run: &mut dyn FnMut(usize)) {
    reset();
    run(n);
    let small = counted(work);
    assert!(small > 0, "no {work:?} counted at {n}");
    let _mutation = Mutation::on(mutant);
    assert_stops(work, 5 * small, || run(4 * n));
}

/// Asserts that `run` at 4n counts at most five times the `work` that it
/// counts at n. Linear work counts four times as much, and quadratic work
/// sixteen, so the larger run has a budget and panics as soon as it passes
/// it. The smaller run must count some work, or the test would prove
/// nothing.
#[cfg(test)]
pub(crate) fn assert_linear(work: Work, n: usize, run: &mut dyn FnMut(usize)) {
    reset();
    run(n);
    let small = counted(work);
    assert!(small > 0, "no {work:?} counted at {n}");
    reset();
    budget(work, 5 * small);
    run(4 * n);
    let large = counted(work);
    reset();
    assert!(large <= 5 * small, "{work:?}: {small} at {n}, {large} at {}", 4 * n);
}

#[cfg(test)]
mod tests {
    use super::{assert_linear, bound, budget, counted, reset, Work};
    use crate::json::Json;
    use crate::{InputToken, ParseOptions, Verdict};
    use std::collections::BTreeMap;
    use std::path::Path;

    fn single(rules: &str) -> BTreeMap<String, String> {
        let mut sources = BTreeMap::new();
        sources.insert("p.md".to_string(), "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string());
        sources.insert("g.md".to_string(), format!("# A grammar\n\n```jbogenbau\n{rules}\n```\n"));
        sources
    }

    fn no_auto() -> ParseOptions {
        ParseOptions { auto_features: false, ..ParseOptions::default() }
    }

    /// The shared cases of `tests/growth.json` (tests/README.md): the work
    /// of the bundled grammars on long texts. A condition that parses a
    /// whole prefix again at each step makes a long text cost more than its
    /// length says, so these tests count the items that the recognizer
    /// makes, in parses and nested parses alike.
    #[test]
    fn growth_cases() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/growth.json");
        let text = std::fs::read_to_string(path).expect("the cases");
        let cases = crate::json::parse_cases(&text).expect("the cases are JSON");
        let cases = cases.as_array().expect("an array");
        assert!(!cases.is_empty(), "no cases");
        let string = |case: &Json, name: &str| case.get(name).and_then(Json::as_str).expect(name).to_string();
        let number = |case: &Json, name: &str| case.get(name).and_then(Json::as_int).expect(name) as u64;
        let mut failures = Vec::new();
        for case in cases {
            let (name, template, link) = (string(case, "dialect"), string(case, "text"), string(case, "link"));
            let (small, large, most) = (number(case, "small"), number(case, "large"), number(case, "most"));
            let dialect = crate::load_dialect(&name).expect("the bundled dialect");
            let work = |n: u64, most: Option<(u64, u64)>| {
                let text = template.replace("{links}", &vec![link.as_str(); n as usize].join(" "));
                reset();
                if let Some((items, found)) = most {
                    budget(Work::Items, items);
                    budget(Work::Found, found);
                }
                let result = dialect.parse(&text, &ParseOptions::default()).expect("a result");
                assert!(result.ok, "{text}");
                (counted(Work::Items), counted(Work::Found))
            };
            // The longer text's parse panics at the first item or lookup
            // past its budget.
            let few = work(small, None);
            let many = work(large, Some((most * few.0, most * few.1)));
            if many.0 > most * few.0 || many.1 > most * few.1 {
                failures.push(format!(
                    "{name} with {link:?}: {few:?} items and lookups for {small} links, {many:?} for {large}, more than {most} times"
                ));
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    /// A cycle context keeps only the rules of the cycle that the item lies
    /// on (engine §6). Here each wrapper of each level is a cycle of its
    /// own, so keeping every cyclic rule above would make 2^N contexts. At
    /// 15 levels that is some 65000, made in about a second, so the count
    /// fails where a deeper grammar would hang.
    #[test]
    fn cycle_contexts_keep_only_the_rules_of_their_cycle() {
        let depth = 15;
        let mut grammar = format!("%ambiguity-resolution late-elision\n%rule text ε | r{depth}\n%rule r0 [+T]\n");
        for i in 1..=depth {
            let below = i - 1;
            grammar
                .push_str(&format!("%rule r{i} a{i} b{i}\n%rule a{i} r{below} | a{i}\n%rule b{i} r{below} | b{i}\n"));
        }
        let dialect = crate::load_dialect_sources(single(&grammar), "p.md").unwrap();
        reset();
        // A context of one wrapper each, not one of each set of wrappers:
        // the context past that panics.
        budget(Work::Contexts, 4 * depth as u64);
        let result = dialect.parse_tokens(&[], &no_auto()).unwrap();
        let contexts = counted(Work::Contexts);
        assert!(result.ok);
        assert_eq!(result.stages[0].verdict, Some(Verdict::Resolved));
        assert!(contexts <= 4 * depth as u64, "{contexts} cycle contexts for {depth} levels");
    }

    /// Written-terminator priority (engine §4): a nested query over a long
    /// text with many omissions and no written terminator takes work in
    /// proportion to the text, through a whole parse. The searches for a
    /// blocking path once looked at every later set of the chart for each
    /// omission, which took quadratic work: some 100 million entries at
    /// 8000 tokens, under a second, where the count fails.
    #[test]
    fn nested_queries_with_many_omissions_take_linear_work() {
        let grammar = "%ambiguity-resolution greedy\n%rule text body B\n%conditions matches($, r)\n\
                       %rule body {A}\n%rule r parts B\n%rule parts {part}\n%rule part A [+T]";
        let dialect = crate::load_dialect_sources(single(grammar), "p.md").unwrap();
        let work = |n: usize, most: Option<(u64, u64)>| {
            let token = |tag: &str| InputToken {
                text: tag.to_lowercase(),
                tags: [tag.to_string()].into_iter().collect(),
                phonemes: None,
            };
            let tokens: Vec<_> = (0..n).map(|_| token("A")).chain([token("B")]).collect();
            reset();
            // The index is one pass over the chart, the searches read each
            // completed item of it at most once, and two sweeps settle the
            // items they rest on: at most four times the items made so
            // far. An index built again for each search would read the
            // chart once per search, and stops at once.
            bound(Work::Searched, Work::Items, 4);
            if let Some((items, searched)) = most {
                budget(Work::Items, items);
                budget(Work::Searched, searched);
            }
            let result = dialect.parse_tokens(&tokens, &no_auto()).unwrap();
            assert!(result.ok, "{n}");
            (counted(Work::Items), counted(Work::Searched))
        };
        let short = work(2000, None);
        assert!(short.1 > 0, "the searches ran");
        // The longer text's parse panics at the first count past its budget.
        let long = work(8000, Some((5 * short.0, 5 * short.1)));
        // Linear work gives about four times as much; quadratic, sixteen.
        assert!(long.0 <= 5 * short.0 && long.1 <= 5 * short.1, "2000 tokens: {short:?}; 8000: {long:?}");
    }

    /// The check of `elision-only` restores each elidable optional at a
    /// synthetic token (engine §7.4). Here each of n rules predicts its own
    /// optional there, so the set after the token gains n restored items.
    /// Each restoration looks its item up once, so the lookups grow with n,
    /// where a scan of the set would grow with n².
    #[test]
    fn restorations_look_up_their_items_once() {
        let dialects: Vec<_> = [250usize, 1000]
            .into_iter()
            .map(|n| {
                let names: Vec<String> = (0..n).map(|index| format!("r{index}")).collect();
                let rules: Vec<String> = (0..n).map(|index| format!("%rule r{index} A [+KU] [+KU] B{index}")).collect();
                let grammar = format!(
                    "%ambiguity-resolution late-elision elision-only\n%rule text {}\n{}",
                    names.join(" | "),
                    rules.join("\n")
                );
                crate::load_dialect_sources(single(&grammar), "p.md").unwrap()
            })
            .collect();
        let token = |tag: &str| InputToken {
            text: tag.to_lowercase(),
            tags: [tag.to_string()].into_iter().collect(),
            phonemes: None,
        };
        // One KU can stand in either place, so the stage chooses one
        // derivation, and the check restores the elided one.
        let tokens = [token("A"), token("KU"), token("B0")];
        assert_linear(Work::Found, 250, &mut |n| {
            let result = dialects[usize::from(n != 250)].parse_tokens(&tokens, &no_auto()).unwrap();
            assert!(result.ok, "{n} rules");
            assert_eq!(result.stages[0].verdict, Some(Verdict::Resolved));
        });
    }

    /// A rule is predicted once in each set, however many items wait for
    /// it there. Here n rules wait for one rule of n productions, so a
    /// prediction for each waiting item would look at n² productions.
    #[test]
    fn predictions_look_at_each_production_once() {
        let dialects: Vec<_> = [250usize, 1000]
            .into_iter()
            .map(|n| {
                let names: Vec<String> = (0..n).map(|index| format!("r{index}")).collect();
                let rules: Vec<String> = (0..n).map(|index| format!("%rule r{index} x B{index}")).collect();
                let starts: Vec<String> = (0..n).map(|index| format!("A{index}")).collect();
                let grammar = format!(
                    "%ambiguity-resolution greedy\n%rule text {}\n{}\n%rule x {}",
                    names.join(" | "),
                    rules.join("\n"),
                    starts.join(" | ")
                );
                crate::load_dialect_sources(single(&grammar), "p.md").unwrap()
            })
            .collect();
        let token = |tag: &str| InputToken {
            text: tag.to_lowercase(),
            tags: [tag.to_string()].into_iter().collect(),
            phonemes: None,
        };
        let tokens = [token("A0"), token("B0")];
        assert_linear(Work::Found, 250, &mut |n| {
            let result = dialects[usize::from(n != 250)].parse_tokens(&tokens, &no_auto()).unwrap();
            assert!(result.ok, "{n} rules");
        });
    }
}
