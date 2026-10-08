//! Shared DOM cases for structural patterns and elidable tests.
mod common;
use common::{parse_json, repository};
#[test]
fn pattern_dom_cases() {
    let text = std::fs::read_to_string(repository().join("tests/pattern-dom.json")).unwrap();
    let cases = parse_json(&text).unwrap();
    for case in cases.array() {
        let constants = case.get("pattern").map_or("[]".to_owned(), |p| {
            format!(r#"[{{"name":"P","op":"define","value":{{"pattern":{}}},"at":[1,1]}}]"#, p.to_text())
        });
        let rules = if let Some(expr) = case.get("expr") {
            format!(
                r#"[{{"name":"text","op":"define","flags":[],"alternatives":[{{"guards":[],"expr":{}}}],"conditions":[],"at":[1,1]}}]"#,
                expr.to_text()
            )
        } else if let Some(c) = case.get("condition") {
            format!(
                r#"[{{"name":"text","op":"define","flags":[],"alternatives":[{{"guards":[],"expr":{{"capture":"x","expr":{{"ref":"A"}}}}}}],"conditions":[{}],"at":[1,1]}}]"#,
                c.to_text()
            )
        } else {
            "[]".into()
        };
        let dom = format!(
            r#"{{"format":{},"rules":{rules},"constants":{constants},"directives":[],"classifiers":[],"implications":[]}}"#,
            gencmu::tools::DOM_FORMAT
        );
        let problem = gencmu::tools::check_dom(&dom).unwrap();
        assert_eq!(
            problem.is_some(),
            matches!(case.get("malformed"), Some(common::Value::Bool(true))),
            "{}: {problem:?}",
            case.get("description").unwrap().to_text()
        );
    }
}

#[test]
fn pattern_paths_use_the_dom_depth_limit() {
    let document = |n| format!("```jbogenbau\n%const $P @({}A{})\n```\n", "⋮ (".repeat(n), ")".repeat(n));
    assert!(gencmu::tools::read_grammar_document(&document(250)).is_ok());
    assert!(gencmu::tools::read_grammar_document(&document(3000)).is_err());
}
