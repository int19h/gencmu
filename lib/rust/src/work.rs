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
    /// The entries of the chart that the searches for a blocking path look
    /// at: the index once, and then each completed item they read.
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
    /// the derivations of an item.
    Walked,
    /// The tokens that the sound tests step to (§5).
    Sounded,
    /// The conditions that the items added to the chart look at, with one
    /// more for each item.
    Conditions,
    /// The nodes of conditions and terms that evaluation visits, each
    /// counted before it is evaluated, also in an evaluation that halts.
    Visits,
    /// The tags that the evaluation of tag terms writes into the lists it
    /// makes: unions, the tags of spans, and ranges.
    Listed,
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
    use super::{bound, budget, counted, reset, Work};
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
        let cases = crate::json::parse(&text).expect("the cases are JSON");
        let cases = cases.as_array().expect("an array");
        assert!(!cases.is_empty(), "no cases");
        let string = |case: &Json, name: &str| case.get(name).and_then(Json::as_str).expect(name).to_string();
        let number = |case: &Json, name: &str| case.get(name).and_then(Json::as_int).expect(name) as u64;
        let mut failures = Vec::new();
        for case in cases {
            let (name, template, link) = (string(case, "dialect"), string(case, "text"), string(case, "link"));
            let (small, large, most) = (number(case, "small"), number(case, "large"), number(case, "most"));
            let dialect = crate::load_dialect(&name).expect("the bundled dialect");
            let items = |n: u64, most: Option<u64>| {
                let text = template.replace("{links}", &vec![link.as_str(); n as usize].join(" "));
                reset();
                if let Some(most) = most {
                    budget(Work::Items, most);
                }
                let result = dialect.parse(&text, &ParseOptions::default()).expect("a result");
                assert!(result.ok, "{text}");
                counted(Work::Items)
            };
            // The longer text's parse panics at the first item past its
            // budget.
            let few = items(small, None);
            let many = items(large, Some(most * few));
            if many > most * few {
                failures.push(format!(
                    "{name} with {link:?}: {few} items for {small} links, {many} for {large}, more than {most} times"
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
            // The index is one pass over the chart, and the searches read
            // each completed item of it at most once: at most twice the
            // items made so far. An index built again for each search would
            // read the chart once per search, and stops at once.
            bound(Work::Searched, Work::Items, 2);
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
}
