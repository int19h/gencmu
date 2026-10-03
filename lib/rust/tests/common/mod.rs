//! What the tests share: a small JSON reader (the crate has no
//! dependencies, not even for its tests), the pattern matching of
//! `tests/README.md`, and the runners of the shared cases.

#![allow(dead_code)]

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};

/// A JSON value. Objects keep their members in order.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

impl Value {
    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Object(members) => members.iter().find(|(name, _)| name == key).map(|(_, value)| value),
            _ => None,
        }
    }

    pub fn str(&self) -> Option<&str> {
        match self {
            Value::String(text) => Some(text),
            _ => None,
        }
    }

    pub fn array(&self) -> &[Value] {
        match self {
            Value::Array(items) => items,
            _ => &[],
        }
    }

    pub fn object(&self) -> &[(String, Value)] {
        match self {
            Value::Object(members) => members,
            _ => &[],
        }
    }

    pub fn number(&self) -> Option<f64> {
        match self {
            Value::Number(number) => Some(*number),
            _ => None,
        }
    }
}

pub fn parse_json(text: &str) -> Result<Value, String> {
    let chars: Vec<char> = text.chars().collect();
    let mut at = 0;
    let value = parse_value(&chars, &mut at)?;
    skip(&chars, &mut at);
    if at != chars.len() {
        return Err(format!("trailing text at {at}"));
    }
    Ok(value)
}

fn skip(chars: &[char], at: &mut usize) {
    while *at < chars.len() && chars[*at].is_whitespace() {
        *at += 1;
    }
}

fn parse_value(chars: &[char], at: &mut usize) -> Result<Value, String> {
    skip(chars, at);
    match chars.get(*at) {
        Some('{') => {
            *at += 1;
            let mut members = Vec::new();
            skip(chars, at);
            if chars.get(*at) == Some(&'}') {
                *at += 1;
                return Ok(Value::Object(members));
            }
            loop {
                skip(chars, at);
                let Value::String(key) = parse_value(chars, at)? else { return Err("a non-string key".into()) };
                skip(chars, at);
                if chars.get(*at) != Some(&':') {
                    return Err(format!("expected ':' at {at}"));
                }
                *at += 1;
                let value = parse_value(chars, at)?;
                members.push((key, value));
                skip(chars, at);
                match chars.get(*at) {
                    Some(',') => *at += 1,
                    Some('}') => {
                        *at += 1;
                        return Ok(Value::Object(members));
                    }
                    _ => return Err(format!("expected ',' or '}}' at {at}")),
                }
            }
        }
        Some('[') => {
            *at += 1;
            let mut items = Vec::new();
            skip(chars, at);
            if chars.get(*at) == Some(&']') {
                *at += 1;
                return Ok(Value::Array(items));
            }
            loop {
                items.push(parse_value(chars, at)?);
                skip(chars, at);
                match chars.get(*at) {
                    Some(',') => *at += 1,
                    Some(']') => {
                        *at += 1;
                        return Ok(Value::Array(items));
                    }
                    _ => return Err(format!("expected ',' or ']' at {at}")),
                }
            }
        }
        Some('"') => {
            *at += 1;
            let mut out = String::new();
            loop {
                let c = *chars.get(*at).ok_or("an unterminated string")?;
                *at += 1;
                match c {
                    '"' => return Ok(Value::String(out)),
                    '\\' => {
                        let escape = *chars.get(*at).ok_or("an unterminated escape")?;
                        *at += 1;
                        match escape {
                            'n' => out.push('\n'),
                            'r' => out.push('\r'),
                            't' => out.push('\t'),
                            'b' => out.push('\u{8}'),
                            'f' => out.push('\u{c}'),
                            'u' => {
                                let hex = |at: &mut usize| -> Result<u32, String> {
                                    let digits: String =
                                        chars.get(*at..*at + 4).ok_or("a short escape")?.iter().collect();
                                    *at += 4;
                                    u32::from_str_radix(&digits, 16).map_err(|e| e.to_string())
                                };
                                let mut code = hex(at)?;
                                if (0xD800..0xDC00).contains(&code) && chars.get(*at) == Some(&'\\') {
                                    *at += 2;
                                    let low = hex(at)?;
                                    code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
                                }
                                out.push(char::from_u32(code).ok_or("a bad code point")?);
                            }
                            other => out.push(other),
                        }
                    }
                    c => out.push(c),
                }
            }
        }
        Some('t') if chars[*at..].starts_with(&['t', 'r', 'u', 'e']) => {
            *at += 4;
            Ok(Value::Bool(true))
        }
        Some('f') if chars[*at..].starts_with(&['f', 'a', 'l', 's', 'e']) => {
            *at += 5;
            Ok(Value::Bool(false))
        }
        Some('n') if chars[*at..].starts_with(&['n', 'u', 'l', 'l']) => {
            *at += 4;
            Ok(Value::Null)
        }
        Some(c) if *c == '-' || c.is_ascii_digit() => {
            let start = *at;
            while *at < chars.len()
                && (chars[*at] == '-'
                    || chars[*at] == '+'
                    || chars[*at] == '.'
                    || chars[*at] == 'e'
                    || chars[*at] == 'E'
                    || chars[*at].is_ascii_digit())
            {
                *at += 1;
            }
            let text: String = chars[start..*at].iter().collect();
            text.parse().map(Value::Number).map_err(|_| format!("a bad number {text}"))
        }
        _ => Err(format!("expected a value at {at}")),
    }
}

/// Matches a value against a pattern (tests/README.md): an object matches
/// when every member of the pattern matches the member of the same name, an
/// array when it has the same length and each element matches, and
/// anything else when it is equal. The error names the path.
pub fn matches(pattern: &Value, actual: &Value, path: &str) -> Result<(), String> {
    match (pattern, actual) {
        (Value::Object(members), Value::Object(_)) => {
            for (name, expected) in members {
                let here = format!("{path}.{name}");
                match actual.get(name) {
                    Some(found) => matches(expected, found, &here)?,
                    None => return Err(format!("{here} is missing")),
                }
            }
            Ok(())
        }
        (Value::Array(expected), Value::Array(found)) => {
            if expected.len() != found.len() {
                return Err(format!("{path} has {} items, not {}", found.len(), expected.len()));
            }
            for (index, (expected, found)) in expected.iter().zip(found).enumerate() {
                matches(expected, found, &format!("{path}[{index}]"))?;
            }
            Ok(())
        }
        (expected, found) if expected == found => Ok(()),
        (expected, found) => Err(format!("{path} is {found:?}, not {expected:?}")),
    }
}

/// Compares a value with an expected one whole (tests/README.md): each
/// matches the other as a pattern, so neither has a member the other
/// lacks, whatever the order of their members.
pub fn same(expected: &Value, found: &Value, path: &str) -> Result<(), String> {
    matches(expected, found, path)?;
    matches(found, expected, path).map_err(|_| format!("{path} is {found:?}, not {expected:?}"))
}

pub fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

pub fn case_files(directory: &str) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(repository().join("tests").join(directory))
        .expect("the shared cases")
        .map(|entry| entry.expect("an entry").path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "json"))
        .collect();
    files.sort();
    files
}

/// The documents of an engine case and its pipeline's path.
pub fn case_documents(case: &Value) -> (BTreeMap<String, String>, String) {
    let mut documents = BTreeMap::new();
    if let Some(grammar) = case.get("grammar").and_then(Value::str) {
        let mut text = String::new();
        if !grammar.contains("%ambiguity-resolution") {
            text.push_str("%ambiguity-resolution greedy\n");
        }
        text.push_str(grammar);
        documents.insert("main.md".to_string(), format!("```jbogenbau\n{text}\n```\n"));
        documents
            .insert("pipeline.md".to_string(), "```jbogenbau\n%stage main\n%include \"main.md\"\n```\n".to_string());
        return (documents, "pipeline.md".to_string());
    }
    for (path, text) in case.get("documents").map(Value::object).unwrap_or(&[]) {
        documents.insert(path.clone(), text.str().expect("a document").to_string());
    }
    (documents, case.get("pipeline").and_then(Value::str).expect("a pipeline").to_string())
}

/// The names of a list of features, `features` or `withoutFeatures`, in an
/// engine case's options or a corpus case.
pub fn feature_names(list: Option<&Value>) -> Vec<String> {
    list.map(Value::array).unwrap_or(&[]).iter().map(|v| v.str().unwrap().to_string()).collect()
}

pub fn case_options(case: &Value) -> gencmu::ParseOptions {
    let options = case.get("options");
    let get = |key: &str| options.and_then(|options| options.get(key));
    gencmu::ParseOptions {
        features: feature_names(get("features")),
        without_features: feature_names(get("withoutFeatures")),
        auto_features: matches!(get("autoFeatures"), Some(Value::Bool(true))),
        until: get("until").and_then(Value::str).map(str::to_string),
        elision_only: match get("elisionOnly") {
            Some(Value::Bool(value)) => Some(*value),
            _ => None,
        },
    }
}

/// Whether a case's tokens have `before` or `after` members. A caller
/// cannot supply attachments, and `InputToken` has no such fields, so the
/// Rust library skips such a case (tests/README.md).
pub fn has_caller_attachments(case: &Value) -> bool {
    case.get("tokens").is_some_and(|tokens| {
        tokens.array().iter().any(|token| token.get("before").is_some() || token.get("after").is_some())
    })
}

pub fn case_tokens(case: &Value) -> Option<Vec<gencmu::InputToken>> {
    let tokens = case.get("tokens")?;
    Some(
        tokens
            .array()
            .iter()
            .map(|token| gencmu::InputToken {
                text: token.get("text").and_then(Value::str).unwrap_or("").to_string(),
                tags: token
                    .get("tags")
                    .map(Value::array)
                    .unwrap_or(&[])
                    .iter()
                    .map(|tag| tag.str().expect("a tag").to_string())
                    .collect(),
                phonemes: token.get("phonemes").and_then(Value::str).map(str::to_string),
            })
            .collect(),
    )
}

pub fn error_kind(kind: gencmu::ParseErrorKind) -> &'static str {
    match kind {
        gencmu::ParseErrorKind::Rejected => "rejected",
        gencmu::ParseErrorKind::Ambiguous => "ambiguous",
        gencmu::ParseErrorKind::Grammar => "grammar",
    }
}

/// A dialect's feature as a case lists it (tests/README.md).
pub fn feature_value(feature: &gencmu::Feature) -> Value {
    let kind = match feature.kind {
        gencmu::FeatureKind::Gate => "gate",
        gencmu::FeatureKind::Warning => "warning",
    };
    Value::Object(vec![
        ("name".to_string(), Value::String(feature.name.clone())),
        ("kind".to_string(), Value::String(kind.to_string())),
        ("default".to_string(), Value::Bool(feature.default)),
    ])
}

/// Compares where the error of a grammar that cannot be loaded stands with
/// the case's `expect.where`, if it has one (tests/README.md).
fn error_where(expect: &Value, error: &gencmu::Error) -> Result<(), String> {
    let Some(place) = expect.get("where") else {
        return Ok(());
    };
    let document = place.get("document").and_then(Value::str);
    let line = place.get("line").and_then(Value::number).map(|n| n as usize);
    let column = place.get("column").and_then(Value::number).map(|n| n as usize);
    if error.document.as_deref() == document && error.line == line && error.column == column {
        Ok(())
    } else {
        Err(format!(
            "the error is at {:?}:{:?}:{:?}, not {document:?}:{line:?}:{column:?}: {error}",
            error.document, error.line, error.column
        ))
    }
}

/// How long one shared case may run before the runner reports it as
/// hanging: `GENCMU_CASE_TIMEOUT` seconds, 120 by default.
pub fn case_timeout() -> std::time::Duration {
    let seconds = std::env::var("GENCMU_CASE_TIMEOUT").ok().and_then(|n| n.parse().ok()).unwrap_or(120);
    std::time::Duration::from_secs(seconds)
}

/// Runs `work` on a thread of its own, and gives up on it after `limit`.
/// A thread that hangs cannot be stopped, but the runner reports it and
/// goes on, and the process ends with the test.
pub fn within<T: Send + 'static>(limit: std::time::Duration, work: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    let (send, receive) = std::sync::mpsc::channel();
    std::thread::Builder::new()
        .stack_size(64 << 20)
        .spawn(move || {
            let _ = send.send(work());
        })
        .expect("a thread");
    receive.recv_timeout(limit).ok()
}

/// Runs one engine case (tests/README.md); the error says what differs.
/// A case with `parses` loads its dialect once and parses its input with
/// each item's options in order, each result held to the item's `expect`.
pub fn run_engine_case(case: &Value) -> Result<(), String> {
    let (documents, pipeline) = case_documents(case);
    if let Some(parses) = case.get("parses") {
        let dialect = gencmu::load_dialect_sources(documents, &pipeline)
            .map_err(|error| format!("the dialect did not load: {error}"))?;
        for (index, run) in parses.array().iter().enumerate() {
            let expect = run.get("expect").ok_or("a parse without expect")?;
            check_parse(&dialect, case, run, expect).map_err(|problem| format!("parse {index}: {problem}"))?;
        }
        return Ok(());
    }
    let expect = case.get("expect").ok_or("a case without expect")?;
    let dialect = match gencmu::load_dialect_sources(documents, &pipeline) {
        Ok(dialect) => dialect,
        Err(error) => return check_load_error(expect, &error),
    };
    check_parse(&dialect, case, case, expect)
}

/// The members of `expect` that only a loaded dialect can meet.
const AFTER_LOAD: [&str; 4] = ["result", "brackets", "warnings", "features"];

/// Holds the error of a dialect that did not load to `expect`. The error is
/// the whole outcome, so a case that expects anything that only a loaded
/// dialect gives fails (tests/README.md).
pub fn check_load_error(expect: &Value, error: &gencmu::Error) -> Result<(), String> {
    let kind = match error.kind {
        gencmu::ErrorKind::Grammar => "grammar",
        gencmu::ErrorKind::Usage => "usage",
        _ => "another kind",
    };
    if expect.get("error").and_then(Value::str) != Some(kind) {
        return Err(format!("unexpected load error: {error}"));
    }
    if AFTER_LOAD.iter().any(|name| expect.get(name).is_some()) {
        return Err(format!("the dialect did not load: {error}"));
    }
    // `where` is given only for a grammar error.
    if kind != "grammar" && expect.get("where").is_some() {
        return Err(format!("expect.where is only for a grammar error: {error}"));
    }
    error_where(expect, error)
}

/// Runs `work` on a thread with a deep stack. The canonical result nests
/// as deep as a text's attachments do, and this small JSON reader and its
/// values recurse, as the library does not. So the library runs on the
/// test's own thread, and only the reading of its JSON runs here.
fn with_deep_stack<T: Send>(work: impl FnOnce() -> T + Send) -> T {
    std::thread::scope(|scope| {
        std::thread::Builder::new()
            .stack_size(256 << 20)
            .spawn_scoped(scope, work)
            .expect("a thread")
            .join()
            .expect("the work")
    })
}

/// What a canonical result breaks of the invariants that every runner
/// checks on every result, whatever the case expects (tests/README.md): no
/// stage has a tied tree, and a stage whose verdict is `tie` has no output,
/// comes last, and has the result's ambiguous error with the reason `tie`
/// and two readings.
pub fn result_problems(json: &Value) -> Vec<String> {
    let mut problems = Vec::new();
    let stages = json.get("stages").map_or(&[][..], Value::array);
    for (index, stage) in stages.iter().enumerate() {
        let name = stage.get("name").and_then(Value::str).unwrap_or("?");
        if stage.get("tied").is_some() {
            problems.push(format!("stage {name} has a tied tree"));
        }
        if stage.get("verdict").and_then(Value::str) != Some("tie") {
            continue;
        }
        if stage.get("output").is_some() {
            problems.push(format!("the tied stage {name} has output"));
        }
        if index + 1 != stages.len() {
            problems.push(format!("a stage runs after the tied stage {name}"));
        }
        let error = json.get("error");
        let field = |key: &str| error.and_then(|error| error.get(key)).and_then(Value::str);
        let readings = error.and_then(|error| error.get("readings"));
        if json.get("ok") != Some(&Value::Bool(false))
            || json.get("tree") != Some(&Value::Null)
            || field("kind") != Some("ambiguous")
            || field("reason") != Some("tie")
            || field("stage") != Some(name)
            || !matches!(readings, Some(Value::Array(readings)) if readings.len() == 2)
        {
            problems
                .push(format!("the tied stage {name} lacks its error of kind ambiguous, reason tie and two readings"));
        }
    }
    // An error that loses the witness of elision-only is a grammar error of
    // the last stage, which is resolved and has no output, with its chosen
    // tree and completion, and nothing else (engine §7.9).
    if let Some(error) =
        json.get("error").filter(|error| error.get("code").and_then(Value::str) == Some("elision-witness-lost"))
    {
        if error.get("kind").and_then(Value::str) != Some("grammar")
            || error.get("stage").and_then(Value::str).is_none()
            || error.get("chosen").is_none()
            || !matches!(error.get("completion"), Some(Value::Array(_)))
        {
            problems.push("the elision-witness-lost error lacks its kind grammar, stage, chosen or completion".into());
        }
        for member in ["token", "source", "line", "column", "expected", "reason", "readings"] {
            if error.get(member).is_some() {
                problems.push(format!("the elision-witness-lost error has the member {member}"));
            }
        }
        let last = stages.last();
        if last.and_then(|stage| stage.get("name")) != error.get("stage")
            || last.and_then(|stage| stage.get("verdict")).and_then(Value::str) != Some("resolved")
            || last.is_some_and(|stage| stage.get("output").is_some())
        {
            problems
                .push("the stage of the elision-witness-lost error is not the last, resolved, with no output".into());
        }
    }
    // An ambiguous error has no position (docs/output.md).
    if let Some(error) = json.get("error").filter(|error| error.get("kind").and_then(Value::str) == Some("ambiguous")) {
        for member in ["token", "source"] {
            if error.get(member).is_some() {
                problems.push(format!("an ambiguous error has the member {member}"));
            }
        }
    }
    problems
}

/// Whether a result fails the invariants of the witness of elision-only,
/// whatever its case expects (tests/README.md): no result has the error
/// elision-witness-lost, which no grammar gives (engine §7.8), and every
/// check that ran and met no error of the grammar kept W(D) in its forest.
pub fn witness_problem(result: &gencmu::ParseResult, checks: &[gencmu::tools::ElisionCheckRun]) -> Option<String> {
    if result.error.as_ref().is_some_and(|error| error.code == Some(gencmu::ErrorCode::ElisionWitnessLost)) {
        return Some("the result is the error elision-witness-lost, which no grammar gives".to_string());
    }
    checks.iter().find(|check| !check.keeps_witness).map(|check| {
        format!("the check of elision-only in stage {} lost the witness of its chosen derivation", check.stage)
    })
}

/// Holds a canonical result to the invariants, and then to the case's
/// `expect.warnings` and `expect.result`: what differs, if anything. The
/// invariants come first, and a result that breaks them is an error and is
/// compared no further.
pub fn check_json(expect: &Value, actual: &Value) -> Result<String, String> {
    let mut problems = String::new();
    let broken = result_problems(actual);
    if !broken.is_empty() {
        return Err(format!("the result breaks an invariant: {}\n", broken.join("; ")));
    }
    if let Some(expected) = expect.get("warnings") {
        // The canonical result has no `warnings` when there are none.
        let none = Value::Array(Vec::new());
        if let Err(problem) = same(expected, actual.get("warnings").unwrap_or(&none), "warnings") {
            let _ = writeln!(problems, "{problem}");
        }
    }
    if let Some(pattern) = expect.get("result") {
        if let Err(problem) = matches(pattern, actual, "result") {
            let _ = writeln!(problems, "{problem}");
        }
    }
    Ok(problems)
}

/// Parses a case's input with the options of `run`, the case itself or one
/// item of its `parses`, and holds the result to `expect`.
fn check_parse(dialect: &gencmu::Dialect, case: &Value, run: &Value, expect: &Value) -> Result<(), String> {
    let mut problems = String::new();
    if let Some(expected) = expect.get("features") {
        let found = Value::Array(dialect.features().iter().map(feature_value).collect());
        if let Err(problem) = same(expected, &found, "features") {
            let _ = writeln!(problems, "{problem}");
        }
    }
    let options = case_options(run);
    // Every check of elision-only that runs must keep its witness
    // (tests/README.md).
    let (parsed, checks) = gencmu::tools::with_elision_checks(|| match case_tokens(case) {
        Some(tokens) => dialect.parse_tokens(&tokens, &options),
        None => dialect.parse(case.get("input").and_then(Value::str).unwrap_or(""), &options),
    });
    let result = match parsed {
        Ok(result) => result,
        // A mistake of the caller is an error, not a result (engine §13),
        // and there is nothing more to compare.
        Err(error) => {
            if error.kind != gencmu::ErrorKind::Usage || expect.get("error").and_then(Value::str) != Some("usage") {
                let _ = writeln!(problems, "the parse failed: {error}");
            }
            return if problems.is_empty() { Ok(()) } else { Err(problems) };
        }
    };
    let json = gencmu::to_json(&result);
    if let Some(problem) = witness_problem(&result, &checks) {
        return Err(format!("{problem}\nresult: {json}"));
    }
    problems.push_str(&with_deep_stack(|| {
        let actual = parse_json(&json).map_err(|error| format!("the result is not JSON ({error}): {json}"))?;
        check_json(expect, &actual).map_err(|problem| format!("{problem}result: {json}"))
    })?);
    if let Some(expected) = expect.get("brackets").and_then(Value::str) {
        let found = gencmu::to_brackets(&result, false);
        if found != expected {
            let _ = writeln!(problems, "brackets are {found:?}, not {expected:?}");
        }
    }
    // The error kind of the result, which for a grammar error found
    // while parsing, such as at lowering (engine §3.3), is the whole of
    // what the case expects.
    let found = result.error.as_ref().map(|error| error_kind(error.kind));
    match expect.get("error").and_then(Value::str) {
        Some(kind) if found != Some(kind) => {
            let _ = writeln!(problems, "the error is {found:?}, not {kind:?}");
        }
        None if found.is_some() => {
            let _ = writeln!(problems, "an unexpected error {found:?}");
        }
        _ => {}
    }
    if problems.is_empty() {
        Ok(())
    } else {
        Err(format!("{problems}result: {json}"))
    }
}

/// The changes to a canonical result that break an invariant
/// (tests/README.md, "Result mutants"), each with its engine case.
pub fn result_mutants() -> Vec<(Value, Value)> {
    let text =
        std::fs::read_to_string(repository().join("tests/result-mutants.json")).expect("tests/result-mutants.json");
    let file = parse_json(&text).expect("JSON");
    let mutants = file.get("mutants").expect("mutants").array();
    // An empty list would pass every runner with nothing refused.
    assert!(!mutants.is_empty(), "tests/result-mutants.json has no mutant");
    mutants
        .iter()
        .map(|mutant| {
            let name = mutant.get("case").and_then(Value::str).expect("the mutant's case");
            let path = repository().join("tests/engine").join(name);
            let case = parse_json(&std::fs::read_to_string(path).expect("the engine case")).expect("JSON");
            (mutant.clone(), case)
        })
        .collect()
}

/// The canonical result of an engine case that loads and parses.
pub fn engine_case_result(case: &Value) -> Value {
    let (documents, pipeline) = case_documents(case);
    let dialect = gencmu::load_dialect_sources(documents, &pipeline).expect("the dialect of the case");
    let options = case_options(case);
    let result = match case_tokens(case) {
        Some(tokens) => dialect.parse_tokens(&tokens, &options),
        None => dialect.parse(case.get("input").and_then(Value::str).unwrap_or(""), &options),
    }
    .expect("a result");
    parse_json(&gencmu::to_json(&result)).expect("JSON")
}

/// A copy of a canonical result with a mutant's change. A path step of -1
/// is the last element of a list.
pub fn apply_mutant(value: &Value, mutant: &Value) -> Value {
    fn index(items: &[Value], step: &Value) -> usize {
        let step = step.number().expect("an index");
        if step < 0.0 {
            items.len() - 1
        } else {
            step as usize
        }
    }
    fn follow<'a>(value: &'a Value, path: &[Value]) -> &'a Value {
        path.iter().fold(value, |target, step| match step {
            Value::String(key) => target.get(key).expect("a member"),
            _ => &target.array()[index(target.array(), step)],
        })
    }
    // The value with `change` applied at the end of `path`.
    fn change(value: &Value, path: &[Value], apply: &dyn Fn(Option<&Value>) -> Option<Value>) -> Value {
        let (step, rest) = path.split_first().expect("a path");
        match (value, step) {
            (Value::Object(members), Value::String(key)) => {
                let current = value.get(key);
                let next = if rest.is_empty() {
                    apply(current)
                } else {
                    Some(change(current.expect("a member"), rest, apply))
                };
                let mut members: Vec<(String, Value)> =
                    members.iter().filter(|(name, _)| name != key).cloned().collect();
                members.extend(next.map(|next| (key.clone(), next)));
                Value::Object(members)
            }
            (Value::Array(items), _) => {
                let at = index(items, step);
                let mut items = items.clone();
                items[at] = if rest.is_empty() {
                    apply(Some(&items[at])).expect("a value")
                } else {
                    change(&items[at], rest, apply)
                };
                Value::Array(items)
            }
            _ => panic!("a path step that does not fit"),
        }
    }
    let path = mutant.get("path").expect("a path").array();
    let new = if let Some(set) = mutant.get("set") {
        let set = set.clone();
        change(value, path, &move |_| Some(set.clone()))
    } else if let Some(from) = mutant.get("copy") {
        let copied = follow(value, from.array()).clone();
        change(value, path, &move |_| Some(copied.clone()))
    } else if let Some(keep) = mutant.get("keep") {
        let keep = keep.number().expect("a length") as usize;
        change(value, path, &move |current| Some(Value::Array(current.expect("a list").array()[..keep].to_vec())))
    } else if mutant.get("remove").is_some() {
        change(value, path, &|_| None)
    } else if let Some(item) = mutant.get("append") {
        let item = item.clone();
        change(value, path, &move |current| {
            let mut items = current.expect("a list").array().to_vec();
            items.push(item.clone());
            Some(Value::Array(items))
        })
    } else {
        panic!("a mutant that changes nothing: {mutant:?}")
    };
    new
}
