//! Every shared engine case, `tests/engine/*.json` (tests/README.md).

mod common;

use common::{case_files, parse_json, run_engine_case};

#[test]
fn engine_cases() {
    let started = std::time::Instant::now();
    let files = case_files("engine");
    assert!(!files.is_empty(), "no engine cases found");
    let mut failures = Vec::new();
    for file in &files {
        let text = std::fs::read_to_string(file).expect("a case");
        let case = parse_json(&text).expect("a case is JSON");
        if let Err(problem) = run_engine_case(&case) {
            failures.push(format!("{}:\n{problem}", file.display()));
        }
    }
    eprintln!("{} engine cases in {:?}", files.len(), started.elapsed());
    assert!(
        failures.is_empty(),
        "{} of {} engine cases failed:\n\n{}",
        failures.len(),
        files.len(),
        failures.join("\n\n")
    );
}

#[test]
fn harness_detects_a_wrong_expectation() {
    let case = parse_json(r#"{"grammar": "%rule text X | Y", "tokens": [{"text": "w", "tags": ["X", "Y"]}], "expect": {"result": {"ok": true, "stages": [{"verdict": "unique"}]}}}"#).unwrap();
    assert!(run_engine_case(&case).is_err());
    let case = parse_json(r#"{"grammar": "%rule text X | Y", "tokens": [{"text": "w", "tags": ["X", "Y"]}], "expect": {"result": {"ok": true, "tree": {"children": [{"terminal": "Y"}]}}}}"#).unwrap();
    assert!(run_engine_case(&case).is_err());
    let case = parse_json(r#"{"grammar": "%rule text X | Y", "tokens": [{"text": "w", "tags": ["X", "Y"]}], "expect": {"result": {"ok": true, "tree": {"children": [{"terminal": "X"}]}}, "brackets": "v"}}"#).unwrap();
    assert!(run_engine_case(&case).is_err());
    // Warnings and features are compared whole, and a usage error is
    // expected exactly when there is one.
    let warned = |expect: &str| {
        let case = format!(
            r#"{{"grammar": "%rule text @w! X", "tokens": [{{"text": "x", "tags": ["X"]}}], "options": {{"features": ["w"]}}, "expect": {expect}}}"#
        );
        run_engine_case(&parse_json(&case).unwrap())
    };
    let warning = r#"{"stage": "main", "feature": "w", "rule": "text", "span": [0, 1], "source": [0, 1]}"#;
    assert!(warned(&format!(r#"{{"warnings": [{warning}]}}"#)).is_ok());
    assert!(warned(r#"{"warnings": []}"#).is_err());
    assert!(warned(r#"{"features": [{"name": "w", "kind": "warning", "default": false}]}"#).is_ok());
    assert!(warned(r#"{"features": [{"name": "w", "kind": "gate", "default": false}]}"#).is_err());
    assert!(warned(r#"{"features": [{"name": "w", "kind": "warning", "default": false, "on": true}]}"#).is_err());
    let usage = |options: &str, expect: &str| {
        let case = format!(
            r#"{{"grammar": "%rule text X", "tokens": [{{"text": "x", "tags": ["X"]}}], "options": {options}, "expect": {expect}}}"#
        );
        run_engine_case(&parse_json(&case).unwrap())
    };
    let both = r#"{"features": ["f"], "withoutFeatures": ["f"]}"#;
    assert!(usage(both, r#"{"error": "usage"}"#).is_ok());
    assert!(usage(both, "{}").is_err());
    assert!(usage("{}", r#"{"error": "usage"}"#).is_err());
}
