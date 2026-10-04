//! The shared Lojban corpus (tests/README.md, "Corpus cases"): the core
//! sample of `tests/core.txt` by default, and every case with
//! `GENCMU_CORPUS=full`. Cases run on a pool of threads sharing one loaded
//! dialect each; `GENCMU_CORPUS_WORKERS` sets how many threads.

mod common;

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use common::{feature_names, parse_json, repository, Value};

fn all_cases() -> Vec<Value> {
    let directory = repository().join("tests/corpus");
    let mut files: Vec<_> = std::fs::read_dir(directory)
        .expect("tests/corpus")
        .map(|entry| entry.expect("an entry").path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "jsonl"))
        .collect();
    files.sort();
    let mut cases = Vec::new();
    for file in files {
        for line in std::fs::read_to_string(&file).expect("a corpus file").lines() {
            if !line.trim().is_empty() {
                cases.push(parse_json(line).unwrap_or_else(|error| panic!("{}: {error}", file.display())));
            }
        }
    }
    cases
}

fn string(value: &str) -> Value {
    Value::String(value.to_string())
}

/// Holds the canonical result of a case to the invariants of a tie, as the
/// engine-case runner does (tests/README.md).
fn invariants(json: &Value) -> Result<(), String> {
    let problems = common::result_problems(json);
    if problems.is_empty() {
        Ok(())
    } else {
        Err(format!("the result breaks an invariant: {}", problems.join("; ")))
    }
}

/// What gencmu makes of a case, in the case's own terms, or how its result
/// breaks an invariant.
fn outcome(dialect: &gencmu::Dialect, case: &Value) -> Result<BTreeMap<&'static str, Value>, String> {
    let text = case.get("text").and_then(Value::str).expect("a text");
    let options = gencmu::ParseOptions {
        features: feature_names(case.get("features")),
        without_features: feature_names(case.get("withoutFeatures")),
        ..gencmu::ParseOptions::default()
    };
    let (result, checks) = gencmu::tools::with_elision_checks(|| dialect.parse(text, &options).expect("a parse"));
    // No corpus case gives elision-witness-lost, and every check of
    // elision-only that ran keeps its witness, whatever the case expects
    // (tests/README.md).
    if let Some(problem) = common::witness_problem(&result, &checks) {
        return Err(problem);
    }
    invariants(&parse_json(&gencmu::to_json(&result)).expect("the canonical result is JSON"))?;
    let mut got = BTreeMap::new();
    got.insert("expect", string(if result.ok { "accept" } else { "reject" }));
    if result.ok {
        let verdict = match result.stages.last().and_then(|stage| stage.verdict) {
            Some(gencmu::Verdict::Unique) => string("unique"),
            Some(gencmu::Verdict::Resolved) => string("resolved"),
            Some(gencmu::Verdict::Tie) => string("tie"),
            None => Value::Null,
        };
        got.insert("verdict", verdict);
        got.insert("brackets", string(&gencmu::to_brackets(&result, false)));
    } else {
        got.insert("stage", result.error.as_ref().and_then(|error| error.stage.as_deref()).map_or(Value::Null, string));
        // A rejection pins where its stage stopped, as a position in the
        // text (tests/README.md).
        if let Some(source) = result.error.as_ref().and_then(|error| error.source.as_ref()) {
            got.insert("at", Value::Number(source.start as f64));
        }
    }
    // An ambiguous error pins its kind and reason, and no other error has
    // the field (tests/README.md).
    if let Some(error) = result.error.as_ref().filter(|error| error.kind == gencmu::ParseErrorKind::Ambiguous) {
        let reason = match error.reason {
            Some(gencmu::AmbiguityReason::Tie) => string("tie"),
            Some(gencmu::AmbiguityReason::ElisionOnly) => string("elision-only"),
            None => Value::Null,
        };
        got.insert(
            "error",
            Value::Object(vec![("kind".to_string(), string("ambiguous")), ("reason".to_string(), reason)]),
        );
    }
    let ties: Vec<Value> = result
        .stages
        .iter()
        .filter(|stage| stage.verdict == Some(gencmu::Verdict::Tie))
        .map(|stage| string(&stage.name))
        .collect();
    if !ties.is_empty() {
        got.insert("ties", Value::Array(ties));
    }
    if let Some(output) =
        result.stages.iter().find(|stage| stage.name == "words").and_then(|stage| stage.output.as_ref())
    {
        // Each word is written as its label (tests/README.md).
        let words = output.iter().map(|token| string(&token.label)).collect();
        got.insert("words", Value::Array(words));
    }
    Ok(got)
}

fn compare(case: &Value, got: &BTreeMap<&'static str, Value>) -> Option<String> {
    for key in ["expect", "verdict", "stage", "at", "error", "ties", "words", "brackets"] {
        let expected = case.get(key);
        let found = got.get(key);
        if expected.is_none() && found.is_none() {
            continue;
        }
        if expected != found {
            let show = |value: Option<&Value>| value.map_or("nothing".to_string(), |value| format!("{value:?}"));
            return Some(format!("{key} expected {}, got {}", show(expected), show(found)));
        }
    }
    None
}

#[test]
fn the_corpus() {
    let full = std::env::var("GENCMU_CORPUS").is_ok_and(|value| value == "full");
    let mut cases = all_cases();
    if !full {
        let core: HashSet<String> = std::fs::read_to_string(repository().join("tests/core.txt"))
            .expect("tests/core.txt")
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(str::to_string)
            .collect();
        cases.retain(|case| case.get("id").and_then(Value::str).is_some_and(|id| core.contains(id)));
        assert_eq!(cases.len(), core.len(), "every id of core.txt names a case");
    }
    // With no case selected, as for an empty tests/corpus/, the test would
    // pass without running one.
    assert!(!cases.is_empty(), "the corpus selects no case");
    // The longest texts first, so that the pool is not left waiting on one.
    cases.sort_by_key(|case| std::cmp::Reverse(case.get("text").and_then(Value::str).map_or(0, str::len)));
    // A count of workers from the environment is 1 or more. With none, no
    // case would run.
    let workers = std::env::var("GENCMU_CORPUS_WORKERS")
        .ok()
        .map(|n| {
            n.parse::<usize>()
                .ok()
                .filter(|&n| n > 0)
                .unwrap_or_else(|| panic!("GENCMU_CORPUS_WORKERS is {n:?}, not a count of 1 or more"))
        })
        .unwrap_or_else(|| std::thread::available_parallelism().map_or(1, |n| n.get().saturating_sub(1).max(1)))
        .min(cases.len());
    let started = std::time::Instant::now();
    let cases = Arc::new(cases);
    let next = Arc::new(AtomicUsize::new(0));
    let dialects: Arc<Mutex<HashMap<String, Arc<gencmu::Dialect>>>> = Arc::default();
    let failures: Arc<Mutex<Vec<String>>> = Arc::default();
    let threads: Vec<_> = (0..workers)
        .map(|_| {
            let (cases, next, dialects, failures) = (cases.clone(), next.clone(), dialects.clone(), failures.clone());
            std::thread::spawn(move || loop {
                let index = next.fetch_add(1, Ordering::Relaxed);
                let Some(case) = cases.get(index) else { break };
                let id = case.get("id").and_then(Value::str).unwrap_or("?");
                let name = case.get("dialect").and_then(Value::str).expect("a dialect");
                let dialect = {
                    let mut dialects = dialects.lock().unwrap();
                    dialects
                        .entry(name.to_string())
                        .or_insert_with(|| Arc::new(gencmu::load_dialect(name).expect("a bundled dialect")))
                        .clone()
                };
                let problem = match std::panic::catch_unwind(|| outcome(&dialect, case)) {
                    Ok(Ok(got)) => compare(case, &got),
                    Ok(Err(problem)) => Some(problem),
                    Err(panic) => Some(format!(
                        "crashed: {}",
                        panic
                            .downcast_ref::<String>()
                            .map(String::as_str)
                            .or(panic.downcast_ref::<&str>().copied())
                            .unwrap_or("?")
                    )),
                };
                if let Some(problem) = problem {
                    failures.lock().unwrap().push(format!("{id} ({name}): {problem}"));
                }
            })
        })
        .collect();
    for thread in threads {
        thread.join().expect("a worker");
    }
    let failures = failures.lock().unwrap();
    eprintln!(
        "corpus: {} cases on {workers} threads in {:?}, {} differ",
        cases.len(),
        started.elapsed(),
        failures.len()
    );
    let shown: Vec<&String> = failures.iter().take(40).collect();
    assert!(
        failures.is_empty(),
        "{} of {} cases differ:\n{}",
        failures.len(),
        cases.len(),
        shown.iter().map(|s| s.as_str()).collect::<Vec<_>>().join("\n")
    );
}

/// The corpus runner refuses the canonical result of a case once it breaks
/// any part of the invariants: each shared mutant (tests/README.md, "Result
/// mutants").
#[test]
fn the_corpus_runner_refuses_a_result_that_breaks_an_invariant() {
    for (mutant, case) in common::result_mutants() {
        let name = mutant.get("name").and_then(Value::str).unwrap_or("").to_string();
        let json = common::engine_case_result(&case);
        assert_eq!(invariants(&json), Ok(()), "{name}");
        assert!(invariants(&common::apply_mutant(&json, &mutant)).is_err(), "{name}");
    }
}

/// The corpus runner refuses the error elision-witness-lost, and a check
/// that loses its witness. The check of `le sutra tavla` runs in cll-ebnf,
/// since the ranking chooses the fragment (grammars/syntax/cll.md), and a
/// private switch loses its witness after recognition.
#[test]
fn the_corpus_runner_refuses_the_error_elision_witness_lost() {
    let dialect = gencmu::load_dialect("cll-ebnf").expect("cll-ebnf");
    let case = parse_json(r#"{"dialect": "cll-ebnf", "text": "le sutra tavla"}"#).unwrap();
    let clean = outcome(&dialect, &case).expect("a clean outcome");
    assert_eq!(clean.get("verdict"), Some(&string("resolved")));
    let (_, checks) = gencmu::tools::with_elision_checks(|| outcome(&dialect, &case));
    assert!(checks.is_empty(), "the outcome reads its own checks");
    for loss in [gencmu::tools::Loss::Roots, gencmu::tools::Loss::Count] {
        let lost = gencmu::tools::losing_witness(loss, || outcome(&dialect, &case));
        let problem = lost.expect_err("the runner refuses it");
        assert!(problem.contains("elision-witness-lost"), "{problem}");
    }
}
