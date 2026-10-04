//! The shared cases of `tests/growth.json` (tests/README.md): the work of
//! the bundled grammars on long texts. A condition that parses a whole
//! prefix again at each step makes a long text cost more than its length
//! says, so these tests count the items that the recognizer makes, in
//! parses and nested parses alike.

mod common;

use common::{parse_json, repository, Value};
use gencmu::tools::{
    capture_steps, read_grammar_document, recognizer_captures, recognizer_items, reset_recognizer_items, walk_steps,
};
use gencmu::ParseOptions;

/// A whole number field of a case.
fn count(case: &Value, name: &str) -> u64 {
    case.get(name).and_then(Value::number).unwrap_or_else(|| panic!("a number {name}")) as u64
}

#[test]
fn growth_cases() {
    let text = std::fs::read_to_string(repository().join("tests").join("growth.json")).expect("the cases");
    let cases = parse_json(&text).expect("the cases are JSON");
    assert!(!cases.array().is_empty(), "no cases");
    let mut failures = Vec::new();
    for case in cases.array() {
        let dialect_name = case.get("dialect").and_then(Value::str).expect("a dialect");
        let template = case.get("text").and_then(Value::str).expect("a text");
        let link = case.get("link").and_then(Value::str).expect("a link");
        let (small, large, most) = (count(case, "small"), count(case, "large"), count(case, "most"));
        let dialect = gencmu::load_dialect(dialect_name).expect("the bundled dialect");
        let items = |n: u64| {
            let text = template.replace("{links}", &vec![link; n as usize].join(" "));
            reset_recognizer_items();
            let result = dialect.parse(&text, &ParseOptions::default()).expect("a result");
            assert!(result.ok, "{text}");
            recognizer_items()
        };
        let (few, many) = (items(small), items(large));
        if many > most * few {
            failures.push(format!(
                "{dialect_name} with {link:?}: {few} items for {small} links, {many} for {large}, more than {most} times"
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

/// One production of C captures over C tokens: each item shares the
/// captured parts of the item it advanced, so the recognizer makes C
/// sequences of captured parts, not C² entries (engine §4). The tags, the
/// condition and the derivation read them in a bounded number of walks, not
/// one walk for each part.
#[test]
fn captures_share_their_prefixes() {
    for count in [100usize, 200, 400] {
        let names: Vec<String> = (0..count).map(|index| format!("$c{index}('a')")).collect();
        // A tag term that reads every capture, the first last.
        let tags: Vec<String> = (0..count).map(|index| format!("tags($c{})", count - 1 - index)).collect();
        let grammar = format!(
            "```jbogenbau\n%ambiguity-resolution greedy\n%rule text {}\n%tags ~x ∪ {}\n%conditions text($c0) = \"a\"\n```\n",
            names.join(" "),
            tags.join(" ∪ ")
        );
        let mut documents = std::collections::BTreeMap::new();
        documents.insert("g.md".to_string(), grammar);
        documents.insert("p.md".to_string(), "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string());
        let dialect = gencmu::load_dialect_sources(documents, "p.md").expect("the dialect");
        reset_recognizer_items();
        let result = dialect.parse(&"a".repeat(count), &ParseOptions::default()).expect("a result");
        assert!(result.ok, "{count} captures");
        assert_eq!(recognizer_captures(), count as u64, "{count} captures");
        assert!(recognizer_items() <= 2 * count as u64 + 4, "{} items for {count} captures", recognizer_items());
        assert!(capture_steps() <= 4 * count as u64 + 8, "{} steps for {count} captures", capture_steps());
    }
}

/// A condition at each capture of a long production reads the part it
/// names without a walk of every part before it. The capture just made is
/// the last part, and the first capture is a search by the jumps, whose
/// steps grow with the logarithm of the parts (engine §4).
#[test]
fn conditions_at_each_capture_search_for_their_parts() {
    let steps = |count: usize, far: &dyn Fn(usize) -> String| {
        let names: Vec<String> = (0..count).map(|index| format!("$c{index}('a')")).collect();
        let conditions: Vec<String> =
            (0..count).map(|index| format!("text($c{index}) = text({})", far(index))).collect();
        let grammar = format!(
            "```jbogenbau\n%ambiguity-resolution greedy\n%rule text {}\n%conditions {}\n```\n",
            names.join(" "),
            conditions.join(", ")
        );
        let mut documents = std::collections::BTreeMap::new();
        documents.insert("g.md".to_string(), grammar);
        documents.insert("p.md".to_string(), "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string());
        let dialect = gencmu::load_dialect_sources(documents, "p.md").expect("the dialect");
        reset_recognizer_items();
        let result = dialect.parse(&"a".repeat(count), &ParseOptions::default()).expect("a result");
        assert!(result.ok, "{count} captures");
        capture_steps()
    };
    for count in [100usize, 200, 400] {
        let near = steps(count, &|index| format!("$c{index}"));
        let first = steps(count, &|_| "$c0".to_string());
        assert!(near <= 4 * count as u64 + 8, "{near} steps for {count} captures read where they are made");
        let bound = count as f64 * (2.0 * (count as f64).log2() + 4.0);
        assert!((first as f64) <= bound, "{first} steps for {count} captures that each read the first");
    }
}

/// The shared cases of tests/notation-growth.json: reading a document whose
/// constructs nest deep costs work that grows with its length, not with its
/// square. The work is the recognizer's items and the steps of the reader,
/// its walks and the ranker, counted, not timed. The reading runs on a
/// thread with a fixed stack of 2 MiB, whatever the depth: no part of it
/// recurses deeper than the bound of 256 that the DOM is checked against.
#[test]
fn reading_deep_nesting_grows_linearly() {
    let text = std::fs::read_to_string(repository().join("tests/notation-growth.json")).expect("the cases");
    let cases = parse_json(&text).expect("JSON");
    assert!(cases.array().len() > 5);
    for case in cases.array() {
        let field = |name: &str| case.get(name).and_then(Value::str).expect("a field of the case").to_string();
        let name = field("name");
        let (prefix, open, middle, close, suffix) =
            (field("prefix"), field("open"), field("middle"), field("close"), field("suffix"));
        let work = move |n: usize| {
            let text = format!("```jbogenbau\n{prefix}{}{middle}{}{suffix}\n```\n", open.repeat(n), close.repeat(n));
            std::thread::Builder::new()
                .stack_size(2 << 20)
                .spawn(move || {
                    reset_recognizer_items();
                    // An error is an outcome too; its place is the notation
                    // cases' concern.
                    let _ = read_grammar_document(&text);
                    recognizer_items() + walk_steps()
                })
                .expect("a thread")
                .join()
                .expect("no overflow")
        };
        // Once first, so that loading the notation counts in neither.
        work(250);
        let (small, large) = (work(250), work(1000));
        assert!(large <= 5 * small, "{name}: {small} for 250 levels, {large} for 1000");
    }
}
