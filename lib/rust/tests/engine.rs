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
        if std::env::var_os("GENCMU_CASE_TRACE").is_some() {
            eprintln!("case {}", file.display());
        }
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

/// The runner's JSON reader and its comparisons walk with explicit stacks,
/// so a value nested far deeper than any call stack holds is read, copied,
/// compared, written and dropped on the test's ordinary thread.
#[test]
fn deep_json_needs_no_deep_stack() {
    const DEPTH: usize = 50_000;
    let nested = |leaf: &str| format!("{}{leaf}{}", "[{\"a\":".repeat(DEPTH), "}]".repeat(DEPTH));
    let text = nested("1");
    let value = parse_json(&text).expect("deep JSON");
    assert_eq!(value.to_text(), text);
    let copy = value.clone();
    assert!(copy == value);
    assert!(common::same(&value, &copy, "value").is_ok());
    let other = parse_json(&nested("2")).expect("deep JSON");
    assert!(other != value);
    let problem = common::matches(&value, &other, "value").expect_err("a difference at the bottom");
    assert!(problem.ends_with(".a is 2, not 1"), "{}", &problem[problem.len().saturating_sub(40)..]);
    // A mutant's change at the end of a path as deep as the value.
    let path = format!("[{}]", vec!["0, \"a\""; DEPTH].join(", "));
    let mutant = parse_json(&format!(r#"{{"path": {path}, "set": 2}}"#)).expect("a mutant");
    assert!(common::apply_mutant(&value, &mutant) == other, "the mutant changes the bottom value");
}

/// A whole engine case whose canonical result nests 20,000 deep runs on
/// the test's ordinary thread, the library and the runner alike.
#[test]
fn a_deep_result_runs_on_an_ordinary_stack() {
    let input = "a".repeat(20_000);
    let case = format!(
        r#"{{"grammar": "%rule text text 'a' | 'a'", "input": "{input}", "expect": {{"result": {{"ok": true, "stages": [{{"verdict": "unique"}}]}}}}}}"#
    );
    run_engine_case(&parse_json(&case).unwrap()).expect("the case passes");
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

/// The runner checks the invariants on every result, whatever the case
/// expects, and refuses each shared mutant (tests/README.md, "Result
/// mutants").
#[test]
fn the_runner_refuses_a_result_that_breaks_an_invariant() {
    use common::{apply_mutant, check_json, engine_case_result, result_mutants, result_problems, Value};
    let expect = parse_json(r#"{"result": {"ok": false, "error": {"kind": "ambiguous"}}}"#).unwrap();
    for (mutant, case) in result_mutants() {
        let name = mutant.get("name").and_then(Value::str).unwrap_or("").to_string();
        let json = engine_case_result(&case);
        assert_eq!(result_problems(&json), Vec::<String>::new(), "{name}");
        assert_eq!(check_json(&expect, &json), Ok(String::new()), "{name}");
        let changed = apply_mutant(&json, &mutant);
        assert!(!result_problems(&changed).is_empty(), "{name}");
        assert!(check_json(&expect, &changed).is_err(), "{name}");
    }
}

/// The error elision-witness-lost (engine §7.9). No grammar gives it while
/// the witness of engine §7.8 holds, so these tests lose the witness through
/// the library's private switches, after recognition: no completed item of
/// `text` over the reconstructed input, or such items with no counted
/// derivation. They call the engine directly, not through the runner.
#[test]
fn a_check_that_loses_its_witness_is_the_grammar_error_elision_witness_lost() {
    use common::{result_problems, witness_problem, Value};
    use gencmu::tools::{losing_witness, with_elision_checks, Loss};
    let case = parse_json(
        r#"{"documents": {"p.md": "```jbogenbau\n%stage main\n%ambiguity-resolution late-elision elision-only\n%rule text a | b\n%rule a w! A [+T=\"ta\"] [+U] %emits $ <~x>\n%rule b A [+T=\"ta\"] [+U] [+U]\n%stage later\n%ambiguity-resolution greedy\n%rule text ~x\n```\n"},
            "pipeline": "p.md", "tokens": [{"text": "a", "tags": ["A"]}], "options": {"features": ["w"]}}"#,
    )
    .unwrap();
    let (documents, pipeline) = common::case_documents(&case);
    let dialect = gencmu::load_dialect_sources(documents, &pipeline).expect("the dialect");
    let tokens = common::case_tokens(&case).expect("tokens");
    let options = common::case_options(&case);
    let (clean, checks) = with_elision_checks(|| dialect.parse_tokens(&tokens, &options).unwrap());
    assert!(clean.ok, "{:?}", clean.error);
    assert_eq!(checks.len(), 1);
    assert!(checks[0].keeps_witness);
    assert_eq!(witness_problem(&clean, &checks), None);
    // The chosen tree is that of the main stage, as a run that ends there
    // shows it.
    let until = gencmu::ParseOptions { until: Some("main".to_string()), elision_only: Some(false), ..options.clone() };
    let main = dialect.parse_tokens(&tokens, &until).unwrap();
    for loss in [Loss::Roots, Loss::Count] {
        let (result, checks) =
            with_elision_checks(|| losing_witness(loss, || dialect.parse_tokens(&tokens, &options).unwrap()));
        let json = parse_json(&gencmu::to_json(&result)).unwrap();
        assert_eq!(result_problems(&json), Vec::<String>::new(), "{loss:?}");
        // The runner fails it, whatever a case expects (tests/README.md).
        assert!(witness_problem(&result, &[]).is_some_and(|problem| problem.contains("elision-witness-lost")));
        assert!(checks.iter().all(|check| !check.keeps_witness), "{loss:?}");
        assert!(!result.ok);
        assert!(result.tree.is_none());
        let error = json.get("error").unwrap();
        let keys: Vec<&str> = error.object().iter().map(|(key, _)| key.as_str()).collect();
        assert_eq!(keys, ["kind", "stage", "code", "message", "chosen", "completion"], "{loss:?}");
        assert_eq!(error.get("kind").and_then(Value::str), Some("grammar"));
        assert_eq!(error.get("stage").and_then(Value::str), Some("main"));
        assert_eq!(error.get("code").and_then(Value::str), Some("elision-witness-lost"));
        assert_eq!(
            error.get("message").and_then(Value::str),
            Some("the main stage could not reconstruct its chosen derivation for elision-only")
        );
        let error = result.error.as_ref().unwrap();
        assert_eq!(error.chosen, main.tree);
        // The records in their order of insertion, with the sound only for
        // the tested terminator.
        let completion = parse_json(r#"[{"terminal": "T", "at": 1, "source": [1, 1], "sound": "ta"}, {"terminal": "U", "at": 1, "source": [1, 1]}]"#).unwrap();
        assert_eq!(json.get("error").unwrap().get("completion"), Some(&completion));
        // The stage keeps its verdict and warnings, has no output, and no
        // later stage runs.
        assert_eq!(result.stages.len(), 1);
        assert_eq!(result.stages[0].verdict, Some(gencmu::Verdict::Resolved));
        assert!(result.stages[0].output.is_none());
        let warnings: Vec<_> = clean.warnings.iter().filter(|warning| warning.stage == "main").cloned().collect();
        assert_eq!(warnings.len(), 1);
        assert_eq!(result.warnings, warnings);
    }
}

/// An ordinary error of the grammar in the check keeps its own message, and
/// has no code, chosen tree or completion (tests/README.md).
#[test]
fn an_ordinary_grammar_error_in_the_check_has_no_code() {
    let file = common::repository().join("tests/engine/reparse-competing-evaluation-error.json");
    let case = parse_json(&std::fs::read_to_string(file).expect("the case")).expect("JSON");
    let (documents, pipeline) = common::case_documents(&case);
    let dialect = gencmu::load_dialect_sources(documents, &pipeline).expect("the dialect");
    let options = common::case_options(&case);
    let result = match common::case_tokens(&case) {
        Some(tokens) => dialect.parse_tokens(&tokens, &options),
        None => dialect.parse(case.get("input").and_then(common::Value::str).unwrap_or(""), &options),
    }
    .expect("a result");
    let error = result.error.expect("an error");
    assert_eq!(error.kind, gencmu::ParseErrorKind::Grammar);
    assert_eq!(error.code, None);
    assert_eq!(error.chosen, None);
    assert!(error.completion.is_empty());
    assert_ne!(error.message, "the main stage could not reconstruct its chosen derivation for elision-only");
    let json = gencmu::to_json(&gencmu::ParseResult {
        ok: false,
        stages: Vec::new(),
        tree: None,
        error: Some(error),
        warnings: Vec::new(),
    });
    assert!(!json.contains("\"code\"") && !json.contains("\"chosen\"") && !json.contains("\"completion\""));
}

/// The runner refuses a result whose check of elision-only lost its
/// witness, even where the result itself passes (tests/README.md).
#[test]
fn the_runner_refuses_a_check_that_lost_its_witness() {
    let result = gencmu::ParseResult { ok: true, stages: Vec::new(), tree: None, error: None, warnings: Vec::new() };
    let kept = gencmu::tools::ElisionCheckRun { stage: "main".to_string(), keeps_witness: true };
    let lost = gencmu::tools::ElisionCheckRun { stage: "main".to_string(), keeps_witness: false };
    assert_eq!(common::witness_problem(&result, std::slice::from_ref(&kept)), None);
    assert!(common::witness_problem(&result, &[kept, lost]).is_some());
}

/// Parses one token `A` with a dialect loaded from `sources`, and gives
/// the message of the result's error, which must be of kind grammar with
/// no position, from a stage that has no verdict.
fn lowering_error(sources: &[(&str, &str)], features: &[&str]) -> String {
    let dialect =
        gencmu::load_dialect_sources(sources.iter().map(|(path, text)| (path.to_string(), text.to_string())), "p.md")
            .expect("an error of lowering is no load error");
    let token = gencmu::InputToken { text: "a".into(), tags: ["A".to_string()].into_iter().collect(), phonemes: None };
    let options = gencmu::ParseOptions {
        features: features.iter().map(|feature| feature.to_string()).collect(),
        auto_features: false,
        ..Default::default()
    };
    let result = dialect.parse_tokens(&[token], &options).expect("a result");
    let error = result.error.expect("an error");
    assert_eq!(error.kind, gencmu::ParseErrorKind::Grammar);
    assert_eq!((error.token, error.line, error.column), (None, None, None));
    assert_eq!(result.stages[0].verdict, None);
    assert!(result.tree.is_none());
    error.message
}

/// An error of lowering is a result of the parse, and the dialect loads.
/// Its message begins with the document, line and column of the
/// definition that wrote the alternative at fault, not of the braces and
/// not of a definition that made their item empty (engine §3).
#[test]
fn an_error_of_lowering_names_the_definition_at_fault() {
    let sources = [
        ("p.md", "```jbogenbau\n%stage main\n%include \"a.md\"\n%include \"b.md\"\n```\n"),
        ("a.md", "```jbogenbau\n%ambiguity-resolution greedy\n%rule text {r} | c\n%rule c {... A} | f? B\n```\n"),
        ("b.md", "```jbogenbau\n%rule r A\n%extend-rule r\n  ε\n```\n"),
    ];
    // The empty item of text's braces, made so by b.md, is reported at the
    // definition of text in a.md, line 3, column 1.
    let empty = lowering_error(&sources, &[]);
    assert!(empty.starts_with("a.md:3:1: "), "{empty}");
    // With f on, c's chain stands beside B, which comes before the empty
    // item of an earlier rule.
    let both = lowering_error(&sources, &["f"]);
    assert!(both.starts_with("a.md:4:1: c is a chain"), "{both}");
}

/// In one rule, a chain beside another alternative is reported before an
/// empty item of its braces (engine §3).
#[test]
fn a_chain_beside_an_alternative_comes_before_an_empty_item() {
    let sources = [
        ("p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n"),
        ("g.md", "```jbogenbau\n%ambiguity-resolution greedy\n%rule text r\n%rule r {... [A]} | B\n```\n"),
    ];
    let message = lowering_error(&sources, &[]);
    assert!(message.starts_with("g.md:4:1: r is a chain"), "{message}");
    // Without the other alternative, the empty item is the error.
    let sources =
        [sources[0], ("g.md", "```jbogenbau\n%ambiguity-resolution greedy\n%rule text r\n%rule r {... [A]}\n```\n")];
    let message = lowering_error(&sources, &[]);
    assert!(message.starts_with("g.md:4:1: an item of braces in r"), "{message}");
}
