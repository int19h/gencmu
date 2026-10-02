//! The shared cases of `tests/dom-malformed.json` (tests/README.md): each
//! directive alone in an otherwise empty DOM of the current format, which
//! the check of a precompiled DOM refuses exactly when the case says it is
//! malformed (engine §9).

mod common;

use common::{parse_json, repository, Value};
use gencmu::tools::{check_dom, DOM_FORMAT};

/// Writes a JSON value back as text.
fn write(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => number.to_string(),
        Value::String(text) => {
            let mut out = String::from("\"");
            for c in text.chars() {
                match c {
                    '"' => out.push_str("\\\""),
                    '\\' => out.push_str("\\\\"),
                    c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
                    c => out.push(c),
                }
            }
            out.push('"');
            out
        }
        Value::Array(items) => format!("[{}]", items.iter().map(write).collect::<Vec<_>>().join(",")),
        Value::Object(members) => format!(
            "{{{}}}",
            members
                .iter()
                .map(|(name, value)| format!("{}:{}", write(&Value::String(name.clone())), write(value)))
                .collect::<Vec<_>>()
                .join(",")
        ),
    }
}

#[test]
fn dom_malformed_cases() {
    let text = std::fs::read_to_string(repository().join("tests").join("dom-malformed.json")).expect("the cases");
    let cases = parse_json(&text).expect("the cases are JSON");
    assert!(!cases.array().is_empty(), "no cases");
    let mut failures = Vec::new();
    for case in cases.array() {
        let description = case.get("description").and_then(Value::str).unwrap_or("?");
        let malformed = case.get("malformed") == Some(&Value::Bool(true));
        let directive = write(case.get("directive").expect("a directive"));
        let dom = format!(
            r#"{{"format":{DOM_FORMAT},"rules":[],"directives":[{directive}],"constants":[],"classifiers":[],"implications":[]}}"#
        );
        let problem = check_dom(&dom).expect("the bundled context");
        if problem.is_some() != malformed {
            failures.push(format!("{description}: malformed {malformed}, problem {problem:?}\n{dom}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
}
