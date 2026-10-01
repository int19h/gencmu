//! Every shared engine case, `tests/engine/*.json` (tests/README.md).

mod common;

use common::{case_files, has_caller_attachments, parse_json, run_engine_case};

#[test]
fn engine_cases() {
    let started = std::time::Instant::now();
    let files = case_files("engine");
    assert!(!files.is_empty(), "no engine cases found");
    let mut failures = Vec::new();
    let mut skipped = 0;
    for file in &files {
        let text = std::fs::read_to_string(file).expect("a case");
        let case = parse_json(&text).expect("a case is JSON");
        if has_caller_attachments(&case) {
            skipped += 1;
            continue;
        }
        // A case that hangs is a failure, and the others still run.
        let limit = common::case_timeout();
        let outcome = common::within(limit, move || {
            std::panic::catch_unwind(|| run_engine_case(&case)).unwrap_or_else(|_| Err("the case panicked".to_string()))
        });
        let outcome = outcome.unwrap_or_else(|| Err(format!("the case did not finish in {limit:?}")));
        if let Err(problem) = outcome {
            failures.push(format!("{}:\n{problem}", file.display()));
        }
    }
    eprintln!(
        "{} engine cases in {:?}, {skipped} skipped for caller tokens with attachments",
        files.len() - skipped,
        started.elapsed()
    );
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
    // A case that does not finish in time is a failure.
    assert!(common::within(std::time::Duration::from_millis(50), || std::thread::sleep(
        std::time::Duration::from_secs(5)
    ))
    .is_none());
    assert_eq!(common::within(std::time::Duration::from_secs(5), || 7), Some(7));
    let case = parse_json(r#"{"grammar": "%rule text X | Y", "tokens": [{"text": "w", "tags": ["X", "Y"]}], "expect": {"result": {"ok": true, "tree": {"children": [{"terminal": "Y"}]}}}}"#).unwrap();
    assert!(run_engine_case(&case).is_err());
    let case = parse_json(r#"{"grammar": "%rule text X | Y", "tokens": [{"text": "w", "tags": ["X", "Y"]}], "expect": {"result": {"ok": true, "tree": {"children": [{"terminal": "X"}]}}, "brackets": "v"}}"#).unwrap();
    assert!(run_engine_case(&case).is_err());
    // Warnings and features are compared whole, and a usage error is
    // expected exactly when there is one.
    let warned = |expect: &str| {
        let case = format!(
            r#"{{"grammar": "%rule text w! X", "tokens": [{{"text": "x", "tags": ["X"]}}], "options": {{"features": ["w"]}}, "expect": {expect}}}"#
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
    // Where a load error stands is compared when the case gives it.
    let placed = |place: &str| {
        let case = format!(
            r#"{{"grammar": "%rule text X\n%rule text Y", "tokens": [], "expect": {{"error": "grammar", "where": {place}}}}}"#
        );
        run_engine_case(&parse_json(&case).unwrap())
    };
    assert!(placed(r#"{"document": "main.md", "line": 4, "column": 1}"#).is_ok());
    assert!(placed(r#"{"document": "main.md", "line": 3, "column": 1}"#).is_err());
    assert!(placed(r#"{"document": "pipeline.md", "line": 4, "column": 1}"#).is_err());
    // A load error meets only an expectation of that kind of error, with
    // nothing that only a loaded dialect gives.
    let unloaded = |expect: &str| {
        let case = format!(r#"{{"grammar": "%rule text X\n%rule text Y", "tokens": [], "expect": {expect}}}"#);
        run_engine_case(&parse_json(&case).unwrap())
    };
    assert!(unloaded(r#"{"error": "grammar"}"#).is_ok());
    assert!(unloaded(r#"{"error": "usage"}"#).is_err());
    assert!(unloaded("{}").is_err());
    for member in ["result", "brackets", "warnings", "features"] {
        assert!(unloaded(&format!(r#"{{"error": "grammar", "{member}": []}}"#)).is_err(), "{member}");
    }
    // A Rust document is always valid, so no load here fails with a usage
    // error. A grammar error given the kind usage stands for one. It has
    // no line or column, so a case gives no `where` for it.
    let (documents, pipeline) = common::case_documents(
        &parse_json(
            r#"{"grammar": "%rule text X
%rule text Y"}"#,
        )
        .unwrap(),
    );
    let mut error = gencmu::load_dialect_sources(documents, &pipeline).expect_err("a load error");
    error.kind = gencmu::ErrorKind::Usage;
    (error.line, error.column) = (None, None);
    let usage = |expect: &str| common::check_load_error(&parse_json(expect).unwrap(), &error);
    assert!(usage(r#"{"error": "usage"}"#).is_ok());
    assert!(usage(r#"{"error": "grammar"}"#).is_err());
    assert!(usage(r#"{"error": "usage", "result": {}}"#).is_err());
    assert!(usage(r#"{"error": "usage", "where": {"document": "main.md"}}"#).is_err());
    // Each item of `parses` is held to its own expectation.
    let parses = |second: &str| {
        let case = format!(
            r#"{{"grammar": "%rule text f? X | ¬f? Y", "tokens": [{{"text": "x", "tags": ["X"]}}], "parses": [{{"options": {{}}, "expect": {{"error": "rejected"}}}}, {{"options": {{"features": ["f"]}}, "expect": {second}}}]}}"#
        );
        run_engine_case(&parse_json(&case).unwrap())
    };
    assert!(parses(r#"{"brackets": "x"}"#).is_ok());
    assert!(parses(r#"{"error": "rejected"}"#).is_err());
}

/// The shared cases compare only an error's kind. Of two errors of one
/// emission, the message shows which came first (engine §11).
#[test]
fn emission_errors_come_in_order() {
    let message = |name: &str| {
        let text =
            std::fs::read_to_string(common::repository().join("tests").join("engine").join(name)).expect("a case");
        let case = parse_json(&text).expect("a case is JSON");
        let (documents, pipeline) = common::case_documents(&case);
        let dialect = gencmu::load_dialect_sources(documents, &pipeline).expect("the dialect");
        let input = case.get("input").and_then(common::Value::str).expect("an input");
        let result = dialect.parse(input, &common::case_options(&case)).expect("a result");
        result.error.expect("an error").message
    };
    // A before-attachment comes before its carrier's tag term.
    let first = message("attach-error-order.json");
    assert!(first.contains("two phoneme tags"), "{first}");
    // An inserted token comes after the items before it and their
    // attachments.
    let second = message("attach-error-insert-order.json");
    assert!(second.contains(r#"tag("?")"#), "{second}");
}

/// The runner checks the invariants of a tie on every result, whatever the
/// case expects (tests/README.md), and refuses a result that breaks one.
#[test]
fn the_runner_refuses_a_result_that_breaks_an_invariant() {
    use common::{check_json, result_problems, Value};
    let case = parse_json(
        r#"{"grammar": "%rule text x | y\n%rule x A\n%rule y A", "tokens": [{"text": "a", "tags": ["A"]}]}"#,
    )
    .unwrap();
    let (documents, pipeline) = common::case_documents(&case);
    let dialect = gencmu::load_dialect_sources(documents, &pipeline).expect("the dialect");
    let tokens = common::case_tokens(&case).expect("tokens");
    let result = dialect.parse_tokens(&tokens, &common::case_options(&case)).expect("a result");
    let json = parse_json(&gencmu::to_json(&result)).expect("JSON");
    let expect = parse_json(r#"{"result": {"ok": false, "error": {"kind": "ambiguous"}}}"#).unwrap();
    assert_eq!(result_problems(&json), Vec::<String>::new());
    assert_eq!(check_json(&expect, &json), Ok(String::new()));

    // A copy of an object with one member set, or removed for `None`.
    fn with(object: &Value, key: &str, value: Option<Value>) -> Value {
        let mut members: Vec<(String, Value)> =
            object.object().iter().filter(|(name, _)| name != key).cloned().collect();
        members.extend(value.map(|value| (key.to_string(), value)));
        Value::Object(members)
    }
    let stage = &json.get("stages").unwrap().array()[0];
    let error = json.get("error").unwrap();
    let reading = error.get("readings").unwrap().array()[1].clone();
    let stages = |stages: Vec<Value>| with(&json, "stages", Some(Value::Array(stages)));
    let later = parse_json(r#"{"name": "later", "verdict": "unique"}"#).unwrap();
    let mutants = [
        stages(vec![with(stage, "output", Some(Value::Array(Vec::new())))]),
        stages(vec![with(stage, "tied", Some(reading))]),
        stages(vec![stage.clone(), later]),
        with(&json, "error", Some(with(error, "reason", None))),
    ];
    for mutant in &mutants {
        assert!(!result_problems(mutant).is_empty(), "{mutant:?}");
        assert!(check_json(&expect, mutant).is_err(), "{mutant:?}");
    }
}
