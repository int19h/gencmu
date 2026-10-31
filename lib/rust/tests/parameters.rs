//! Parameterized rules in the shared corpus and the native reader.
mod common;
use common::{parse_json, Value};

fn read(text: &str) -> Result<String, gencmu::Error> {
    gencmu::tools::read_grammar_document(&format!("```jbogenbau\n{text}\n```\n"), "")
}
#[test]
fn parameter_source_round_trips() {
    for text in [
        "%rule pair(@L,@R) @L @R\n%rule text = pair(\"a\",\"b\")",
        "%rule use(@X) @X\n%rule text use((\"a\" \"b\")) use(ε) use([\"a\"]) use({\"a\"})",
        "%rule tag(@R) A<@R>\n%rule text tag(<B ¬C>)",
        "%rule query(@R) A %conditions $.matches(@R)\n%rule text query(a | b)",
        "%rule tag(@T) [+@T]\n%rule text tag(KU)",
        "%rule atom(@X) @X %counts-as few\n%extend-rule atom(@Y) @Y\n%rule text atom(\"a\")",
    ] {
        let json = read(text).unwrap_or_else(|e| panic!("{text}: {e}"));
        assert_eq!(gencmu::tools::check_dom(&json).unwrap(), None, "{text}: {json}");
    }
}
#[test]
fn shared_parameter_sources_are_read() {
    let cases = parse_json(include_str!("../../../tests/parameters.json")).unwrap();
    assert!(!cases.array().is_empty(), "the parameter cases must be nonempty");
    for case in cases.array() {
        common::case::parameter(case).expect("valid parameter metadata");
    }
    let mut failures = Vec::new();
    let selected = common::require_cases(
        cases
            .array()
            .iter()
            .filter(|case| {
                case.get("expect").and_then(|x| x.get("error")).is_none()
                    && case.get("grammar").and_then(Value::str).is_some()
            })
            .collect(),
        "parameter sources",
    );
    for case in selected {
        if let Some(grammar) = case.get("grammar").and_then(Value::str) {
            if let Err(e) = read(grammar) {
                failures.push(format!("{}: {e}", case.get("name").and_then(Value::str).unwrap()))
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn shared_parameters() {
    let cases = parse_json(include_str!("../../../tests/parameters.json")).unwrap();
    let mut failures = Vec::new();
    for c in cases.array() {
        if let Err(e) = common::run_parameter_case(c) {
            failures.push(format!("{}: {e}", c.get("name").and_then(Value::str).unwrap()))
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn parameter_cases_require_names() {
    let cases = parse_json(include_str!("../../../tests/parameters.json")).unwrap();
    let change = parse_json(r#"{"path":["name"],"remove":true}"#).unwrap();
    let case = common::apply_mutant(&cases.array()[0], &change);
    assert!(common::run_parameter_case(&case).is_err(), "the parameter runner accepted an absent name");
}
