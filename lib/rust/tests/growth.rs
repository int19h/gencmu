//! The shared cases of `tests/growth.json` (tests/README.md): the work of
//! the bundled grammars on long texts. A condition that parses a whole
//! prefix again at each step makes a long text cost more than its length
//! says, so these tests count the items that the recognizer makes, in
//! parses and nested parses alike.

mod common;

use common::{parse_json, repository, Value};
use gencmu::tools::{recognizer_items, reset_recognizer_items};
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
