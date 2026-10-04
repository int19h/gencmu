//! The shared cases of `tests/dom-malformed.json` (tests/README.md): each
//! directive alone in an otherwise empty DOM of the current format, which
//! the check of a precompiled DOM refuses exactly when the case says it is
//! malformed (engine §9).

mod common;

use common::{parse_json, repository, Value};
use gencmu::tools::{check_dom, DOM_FORMAT};

#[test]
fn dom_malformed_cases() {
    let text = std::fs::read_to_string(repository().join("tests").join("dom-malformed.json")).expect("the cases");
    let cases = parse_json(&text).expect("the cases are JSON");
    assert!(!cases.array().is_empty(), "no cases");
    let mut failures = Vec::new();
    for case in cases.array() {
        let description = case.get("description").and_then(Value::str).unwrap_or("?");
        let malformed = case.get("malformed") == Some(&Value::Bool(true));
        let directive = case.get("directive").expect("a directive").to_text();
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
