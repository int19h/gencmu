//! Counters of work, for the tests that the work grows with the input as it
//! should: the items that the recognizer makes, the entries of the chart
//! that the searches for a blocking path and the checks of maximality look
//! at (§4), and the cycle contexts that the rankings make (§6), on this
//! thread. They exist only in the crate's own tests: elsewhere `count`
//! compiles to nothing.

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
}

#[cfg(test)]
thread_local! {
    static COUNTS: [std::cell::Cell<u64>; 4] = const {
        [std::cell::Cell::new(0), std::cell::Cell::new(0), std::cell::Cell::new(0), std::cell::Cell::new(0)]
    };
}

/// Adds `n` to the counter of `work`, in tests only.
#[inline(always)]
pub(crate) fn count(work: Work, n: u64) {
    #[cfg(test)]
    COUNTS.with(|counts| {
        let counter = &counts[work as usize];
        counter.set(counter.get() + n);
    });
    #[cfg(not(test))]
    let _ = (work, n);
}

/// Sets every counter on this thread back to zero.
#[cfg(test)]
pub(crate) fn reset() {
    COUNTS.with(|counts| counts.iter().for_each(|counter| counter.set(0)));
}

/// The count of `work` on this thread since the last `reset`.
#[cfg(test)]
pub(crate) fn counted(work: Work) -> u64 {
    COUNTS.with(|counts| counts[work as usize].get())
}

#[cfg(test)]
mod tests {
    use super::{counted, reset, Work};
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
            let items = |n: u64| {
                let text = template.replace("{links}", &vec![link.as_str(); n as usize].join(" "));
                reset();
                let result = dialect.parse(&text, &ParseOptions::default()).expect("a result");
                assert!(result.ok, "{text}");
                counted(Work::Items)
            };
            let (few, many) = (items(small), items(large));
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
        let mut grammar =
            format!("%ambiguity-resolution late-elision\n%elidable T\n%rule text ε | r{depth}\n%rule r0 [T]\n");
        for i in 1..=depth {
            let below = i - 1;
            grammar
                .push_str(&format!("%rule r{i} a{i} b{i}\n%rule a{i} r{below} | a{i}\n%rule b{i} r{below} | b{i}\n"));
        }
        let dialect = crate::load_dialect_sources(single(&grammar), "p.md").unwrap();
        reset();
        let result = dialect.parse_tokens(&[], &no_auto()).unwrap();
        let contexts = counted(Work::Contexts);
        assert!(result.ok);
        assert_eq!(result.stages[0].verdict, Some(Verdict::Resolved));
        // A context of one wrapper each, not one of each set of wrappers.
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
        let grammar = "%ambiguity-resolution greedy\n%elidable T\n%rule text body B\n%conditions matches($, r)\n\
                       %rule body A ...\n%rule r parts B\n%rule parts part ...\n%rule part A [T]";
        let dialect = crate::load_dialect_sources(single(grammar), "p.md").unwrap();
        let work = |n: usize| {
            let token = |tag: &str| InputToken {
                text: tag.to_lowercase(),
                tags: [tag.to_string()].into_iter().collect(),
                phonemes: None,
            };
            let tokens: Vec<_> = (0..n).map(|_| token("A")).chain([token("B")]).collect();
            reset();
            let result = dialect.parse_tokens(&tokens, &no_auto()).unwrap();
            assert!(result.ok, "{n}");
            (counted(Work::Items), counted(Work::Searched))
        };
        let (short, long) = (work(2000), work(8000));
        assert!(short.1 > 0, "the searches ran");
        // Linear work gives about four times as much; quadratic, sixteen.
        assert!(long.0 <= 5 * short.0 && long.1 <= 5 * short.1, "2000 tokens: {short:?}; 8000: {long:?}");
    }
}
