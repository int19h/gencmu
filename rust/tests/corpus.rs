//! The shared Lojban corpus (tests/README.md, "Corpus cases"): the core
//! sample of `tests/core.txt` by default, and every case with
//! `GENCMU_CORPUS=full`. Cases run on a pool of threads sharing one loaded
//! dialect each; `GENCMU_CORPUS_WORKERS` sets how many threads.

mod common;

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use common::{parse_json, repository, Value};

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

/// What gencmu makes of a case, in the case's own terms.
fn outcome(dialect: &gencmu::Dialect, case: &Value) -> BTreeMap<&'static str, Value> {
    let text = case.get("text").and_then(Value::str).expect("a text");
    let features =
        case.get("features").map(Value::array).unwrap_or(&[]).iter().map(|f| f.str().unwrap().to_string()).collect();
    let options = gencmu::ParseOptions { features, ..gencmu::ParseOptions::default() };
    let result = dialect.parse(text, &options).expect("a parse");
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
        let words = output
            .iter()
            .map(|token| match token.phonemes.as_deref() {
                Some(phonemes) if !phonemes.is_empty() => string(phonemes),
                _ => string(&token.text),
            })
            .collect();
        got.insert("words", Value::Array(words));
    }
    got
}

fn compare(case: &Value, got: &BTreeMap<&'static str, Value>) -> Option<String> {
    for key in ["expect", "verdict", "stage", "ties", "words", "brackets"] {
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
    // The longest texts first, so that the pool is not left waiting on one.
    cases.sort_by_key(|case| std::cmp::Reverse(case.get("text").and_then(Value::str).map_or(0, str::len)));
    let workers = std::env::var("GENCMU_CORPUS_WORKERS")
        .ok()
        .and_then(|n| n.parse().ok())
        .unwrap_or_else(|| std::thread::available_parallelism().map_or(1, |n| n.get().saturating_sub(1).max(1)))
        .min(cases.len().max(1));
    let started = std::time::Instant::now();
    let cases = Arc::new(cases);
    let next = Arc::new(AtomicUsize::new(0));
    let dialects: Arc<Mutex<HashMap<String, Arc<gencmu::Dialect>>>> = Arc::default();
    let failures: Arc<Mutex<Vec<String>>> = Arc::default();
    let threads: Vec<_> = (0..workers)
        .map(|_| {
            let (cases, next, dialects, failures) = (cases.clone(), next.clone(), dialects.clone(), failures.clone());
            std::thread::Builder::new()
                .stack_size(16 * 1024 * 1024)
                .spawn(move || loop {
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
                        Ok(got) => compare(case, &got),
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
                .expect("a worker")
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
