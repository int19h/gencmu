//! The shared cases of `tests/dom-malformed.json` (tests/README.md): each
//! directive alone in an otherwise empty DOM of the current format, which
//! the check of a precompiled DOM refuses exactly when the case says it is
//! malformed (engine §9).

mod common;

use common::{parse_json, repository, Value};
use gencmu::tools::{check_dom, check_dom_with_unicode, DOM_FORMAT};

#[test]
fn dom_malformed_cases() {
    let text = std::fs::read_to_string(repository().join("tests").join("dom-malformed.json")).expect("the cases");
    let cases = parse_json(&text).expect("the cases are JSON");
    assert!(!cases.array().is_empty(), "no cases");
    let mut failures = Vec::new();
    for case in cases.array() {
        let description = case.get("description").and_then(Value::str).unwrap_or("?");
        let malformed = case.get("malformed") == Some(&Value::Bool(true));
        let (rules, directives) = match case.get("rule") {
            Some(rule) => (format!("[{}]", rule.to_text()), "[]".to_string()),
            None => ("[]".to_string(), format!("[{}]", case.get("directive").expect("a directive").to_text())),
        };
        let dom = format!(
            r#"{{"format":{DOM_FORMAT},"rules":{rules},"directives":{directives},"constants":[],"classifiers":[],"implications":[]}}"#
        );
        let problem = match case.get("unicode").and_then(Value::str) {
            Some(table) => check_dom_with_unicode(&dom, table),
            None => check_dom(&dom),
        }
        .expect("the Unicode context");
        if problem.is_some() != malformed {
            failures.push(format!("{description}: malformed {malformed}, problem {problem:?}\n{dom}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
}
