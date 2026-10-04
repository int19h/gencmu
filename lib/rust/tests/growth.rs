//! The shared cases of `tests/growth.json` (tests/README.md): the work of
//! the bundled grammars on long texts. A condition that parses a whole
//! prefix again at each step makes a long text cost more than its length
//! says, so these tests count the items that the recognizer makes, in
//! parses and nested parses alike.

mod common;

use common::{parse_json, repository, Value};
use gencmu::tools::{capture_steps, recognizer_captures, recognizer_items, reset_recognizer_items};
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
