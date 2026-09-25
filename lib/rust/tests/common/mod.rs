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
            .insert("pipeline.md".to_string(), "## main <?stage main?>\n\n- [main](main.md) <?grammar?>\n".to_string());
        return (documents, "pipeline.md".to_string());
    }
    for (path, text) in case.get("documents").map(Value::object).unwrap_or(&[]) {
        documents.insert(path.clone(), text.str().expect("a document").to_string());
    }
    (documents, case.get("pipeline").and_then(Value::str).expect("a pipeline").to_string())
}

pub fn case_options(case: &Value) -> gencmu::ParseOptions {
    let options = case.get("options");
    let get = |key: &str| options.and_then(|options| options.get(key));
    gencmu::ParseOptions {
        features: get("features")
            .map(Value::array)
            .unwrap_or(&[])
            .iter()
            .map(|v| v.str().unwrap().to_string())
            .collect(),
        auto_features: matches!(get("autoFeatures"), Some(Value::Bool(true))),
        until: get("until").and_then(Value::str).map(str::to_string),
        elision_only: match get("elisionOnly") {
            Some(Value::Bool(value)) => Some(*value),
            _ => None,
        },
    }
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
                    .map(|tag| {
                        let tag = tag.str().expect("a tag");
                        match tag.strip_prefix('?') {
                            Some(weak) => (weak.to_string(), false),
                            None => (tag.to_string(), true),
                        }
                    })
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

/// Runs one engine case (tests/README.md); the error says what differs.
pub fn run_engine_case(case: &Value) -> Result<(), String> {
    let (documents, pipeline) = case_documents(case);
    let expect = case.get("expect").ok_or("a case without expect")?;
    let dialect = match gencmu::load_dialect_sources(documents, &pipeline) {
        Ok(dialect) => dialect,
        Err(error) => {
            return match (expect.get("error").and_then(Value::str), expect.get("result")) {
                (Some("grammar"), None) if error.kind == gencmu::ErrorKind::Grammar => Ok(()),
                _ => Err(format!("the dialect did not load: {error}")),
            };
        }
    };
    let options = case_options(case);
    let result = match case_tokens(case) {
        Some(tokens) => dialect.parse_tokens(&tokens, &options),
        None => dialect.parse(case.get("input").and_then(Value::str).unwrap_or(""), &options),
    }
    .map_err(|error| format!("the parse failed: {error}"))?;
    let json = gencmu::to_json(&result);
    let actual = parse_json(&json).map_err(|error| format!("the result is not JSON ({error}): {json}"))?;
    let mut problems = String::new();
    if let Some(pattern) = expect.get("result") {
        if let Err(problem) = matches(pattern, &actual, "result") {
            let _ = writeln!(problems, "{problem}");
        }
    }
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
