//! Shared DOM depth boundaries from engine §9 and tests/dom-depth.json.
mod common;
use common::{parse_json, repository};
use gencmu::tools::{check_dom, DOM_FORMAT};

#[test]
fn shared_depth_boundaries() {
    let text = std::fs::read_to_string(repository().join("tests/dom-depth.json")).expect("shared cases");
    let cases = parse_json(&text).expect("case JSON");
    assert!(!cases.array().is_empty());
    for case in cases.array() {
        let description = case.get("description").unwrap().str().unwrap();
        let template = case.get("dom").unwrap().to_text();
        let wrapper = case.get("wrapper").unwrap().to_text();
        let count = case.get("atLimit").unwrap().number().unwrap() as usize;
        assert_eq!(template.matches(r#""$inner""#).count(), 1);
        assert_eq!(wrapper.matches(r#""$inner""#).count(), 1);
        for extra in [0, 1] {
            let mut node = case.get("leaf").unwrap().to_text();
            for _ in 0..count + extra {
                node = wrapper.replacen(r#""$inner""#, &node, 1);
            }
            let body = template.replacen(r#""$inner""#, &node, 1);
            let dom = format!(r#"{{"format":{DOM_FORMAT},{}"#, &body[1..]);
            let problem = check_dom(&dom).expect("the bundled context");
            if extra == 0 {
                assert!(problem.is_none(), "{description}, at the limit: {problem:?}");
            } else {
                assert!(
                    problem.as_deref().is_some_and(|p| p.contains("nested")),
                    "{description}, past the limit: {problem:?}"
                );
            }
        }
    }
}

#[test]
fn shared_source_depth_boundaries() {
    let text = std::fs::read_to_string(repository().join("tests/dom-depth-source.json")).expect("source cases");
    let cases = parse_json(&text).expect("case JSON");
    assert!(!cases.array().is_empty());
    for case in cases.array() {
        let field = |key| case.get(key).unwrap().str().unwrap();
        let count = case.get("atLimit").unwrap().number().unwrap() as usize;
        for extra in [0, 1] {
            let n = count + extra;
            let source = format!(
                "```jbogenbau\n{}{}{}{}{}\n```\n",
                field("head"),
                field("prefix").repeat(n),
                field("leaf"),
                field("suffix").repeat(n),
                field("tail")
            );
            let result = gencmu::tools::read_grammar_document(&source);
            if extra == 0 {
                assert!(result.is_ok(), "{}, at the limit: {result:?}", field("description"));
            } else {
                assert!(
                    result.is_err_and(|e| e.message.contains("nested")),
                    "{}, past the limit",
                    field("description")
                );
            }
        }
    }
}
