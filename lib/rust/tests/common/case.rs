//! The metadata contract of shared engine, notation, and memo cases.

use super::Value;

type R = Result<(), String>;

#[derive(Clone, Copy)]
enum Kind {
    Any,
    Text,
    Bool,
    Array,
    Object,
}
use Kind::*;

fn fields(value: &Value, path: &str, members: &[(&str, Kind)]) -> R {
    let Value::Object(values) = value else { return Err(format!("{path} must be an object")) };
    for (name, value) in values {
        let Some((_, kind)) = members.iter().find(|(allowed, _)| *allowed == name) else {
            return Err(format!("{path}.{name} is unknown"));
        };
        let valid = matches!(
            (kind, value),
            (Any, _)
                | (Text, Value::String(_))
                | (Bool, Value::Bool(_))
                | (Array, Value::Array(_))
                | (Object, Value::Object(_))
        );
        if !valid {
            return Err(format!("{path}.{name} has the wrong type"));
        }
    }
    Ok(())
}

fn required<'a>(value: &'a Value, name: &str, path: &str) -> Result<&'a Value, String> {
    value.get(name).ok_or_else(|| format!("{path}.{name} is required"))
}

fn strings(value: &Value, path: &str) -> R {
    if matches!(value, Value::Array(items) if items.iter().all(|item| matches!(item,Value::String(_)))) {
        Ok(())
    } else {
        Err(format!("{path} must be an array of strings"))
    }
}

pub fn options(value: &Value) -> R {
    fields(
        value,
        "options",
        &[("features", Array), ("withoutFeatures", Array), ("until", Text), ("elisionOnly", Bool)],
    )?;
    if value.get("until").and_then(Value::str) == Some("") {
        return Err("options.until must be nonempty".into());
    }
    for name in ["features", "withoutFeatures"] {
        if let Some(list) = value.get(name) {
            strings(list, &format!("options.{name}"))?;
        }
    }
    Ok(())
}

/// A result pattern cannot pin library-specific error wording.
pub fn result_pattern(value: &Value) -> R {
    let mut pending = vec![(value, false)];
    while let Some((value, error)) = pending.pop() {
        match value {
            Value::Object(members) => {
                if error && value.get("message").is_some() {
                    return Err("a result pattern cannot assert an error message".into());
                }
                pending.extend(members.iter().map(|(name, part)| (part, name == "error")));
            }
            Value::Array(items) => pending.extend(items.iter().map(|part| (part, error))),
            _ => {}
        }
    }
    Ok(())
}

fn position(value: &Value, path: &str, document: bool) -> R {
    let mut allowed = vec![("line", Any), ("column", Any)];
    if document {
        allowed.push(("document", Text));
    } else {
        allowed.push(("message", Text));
    }
    fields(value, path, &allowed)?;
    for name in ["line", "column"] {
        if let Some(number) = value.get(name) {
            if !matches!(number, Value::Number(n) if n.is_finite() && *n >= 0.0 && n.fract() == 0.0) {
                return Err(format!("{path}.{name} must be a nonnegative integer"));
            }
        }
    }
    Ok(())
}

pub fn expect(value: &Value) -> R {
    fields(
        value,
        "expect",
        &[
            ("result", Any),
            ("brackets", Text),
            ("warnings", Array),
            ("features", Array),
            ("enabledFeatures", Array),
            ("bundledPipelines", Array),
            ("loadWarnings", Array),
            ("error", Text),
            ("message", Text),
            ("diagnostic", Text),
            ("where", Object),
        ],
    )?;
    if let Some(pattern) = value.get("result") {
        result_pattern(pattern)?;
    }
    if let Some(error) = value.get("error").and_then(Value::str) {
        if !matches!(error, "grammar" | "usage" | "rejected" | "ambiguous" | "feature-conflict") {
            return Err(format!("expect.error has an unknown kind {error:?}"));
        }
    }
    for name in ["where", "diagnostic", "message"] {
        if value.get(name).is_some() && value.get("error").and_then(Value::str) != Some("grammar") {
            return Err(format!("expect.{name} requires a grammar error"));
        }
    }
    if let Some(place) = value.get("where") {
        position(place, "expect.where", true)?;
    }
    for name in ["enabledFeatures", "bundledPipelines"] {
        if let Some(list) = value.get(name) {
            strings(list, &format!("expect.{name}"))?;
        }
    }
    if let Some(warnings) = value.get("loadWarnings") {
        for warning in warnings.array() {
            fields(warning, "expect.loadWarnings[]", &[("stage", Text), ("step", Any), ("tag", Text)])?;
            if !warning
                .get("step")
                .and_then(Value::number)
                .is_some_and(|n| n >= 0.0 && n.fract() == 0.0 && n.is_finite())
            {
                return Err("a loading warning needs a natural step index".into());
            }
        }
    }
    if let Some(features) = value.get("features") {
        for feature in features.array() {
            fields(feature, "expect.features[]", &[("name", Text), ("kind", Text), ("default", Bool)])?;
        }
    }
    if let Some(warnings) = value.get("warnings") {
        for warning in warnings.array() {
            fields(
                warning,
                "expect.warnings[]",
                &[("stage", Text), ("feature", Text), ("rule", Text), ("span", Array), ("source", Array)],
            )?;
            for name in ["span", "source"] {
                if let Some(range) = warning.get(name) {
                    if range.array().len() != 2
                        || !range
                            .array()
                            .iter()
                            .all(|part| matches!(part,Value::Number(n) if n.is_finite() && *n >= 0.0 && n.fract()==0.0))
                    {
                        return Err(format!("expect.warnings[].{name} must be an integer pair"));
                    }
                }
            }
        }
    }
    Ok(())
}

// Token payload values can deliberately be invalid in usage cases. Member
// names still belong to the fixture contract, even inside attachments.
fn token_list(value: &Value, usage: bool) -> R {
    let Value::Array(tokens) = value else {
        return Err("tokens must be an array of objects".into());
    };
    let mut pending: Vec<_> = tokens.iter().collect();
    while let Some(token) = pending.pop() {
        fields(
            token,
            "token",
            &[
                ("text", Any),
                ("tags", Any),
                ("value", Any),
                ("image", Any),
                ("source", Any),
                ("span", Any),
                ("before", Any),
                ("after", Any),
            ],
        )?;
        if !usage {
            required(token, "text", "token")?;
            strings(required(token, "tags", "token")?, "token.tags")?;
            for name in ["text", "value", "image"] {
                if token.get(name).is_some_and(|value| !matches!(value, Value::String(_))) {
                    return Err(format!("token.{name} must be a string"));
                }
            }
            for name in ["source", "span"] {
                if let Some(value) = token.get(name) {
                    if !matches!(value, Value::Array(pair) if pair.len() == 2 && pair.iter().all(
                        |n| matches!(n, Value::Number(n) if n.is_finite() && *n >= 0.0 && n.fract() == 0.0)
                    )) {
                        return Err(format!("token.{name} must contain two nonnegative integers"));
                    }
                }
            }
        }
        for name in ["before", "after"] {
            if let Some(value) = token.get(name) {
                if let Value::Array(children) = value {
                    pending.extend(children);
                } else if !usage {
                    return Err(format!("token.{name} must be an array"));
                }
            }
        }
    }
    Ok(())
}

pub fn engine(value: &Value) -> R {
    engine_case(value, false)
}

pub fn parameter(value: &Value) -> R {
    engine_case(value, true)
}

fn engine_case(value: &Value, parameter_case: bool) -> R {
    let mut members = vec![
        ("description", Text),
        ("grammar", Text),
        ("pipeline", Text),
        ("documents", Object),
        ("pipelineDocument", Text),
        ("input", Text),
        // Invalid caller-token fields belong to usage cases. Rust's
        // typed API records its unsupported fields separately.
        ("tokens", Any),
        ("options", Object),
        ("expect", Object),
        ("parses", Array),
        ("treeRendering", Object),
    ];
    if parameter_case {
        members.push(("name", Text));
    }
    fields(value, "case", &members)?;
    if parameter_case {
        required(value, "name", "parameter case")?;
    }
    if let Some(tokens) = value.get("tokens") {
        let usage = value.get("expect").and_then(|e| e.get("error")).and_then(Value::str) == Some("usage")
            || value.get("parses").is_some_and(|runs| {
                !runs.array().is_empty()
                    && runs
                        .array()
                        .iter()
                        .all(|run| run.get("expect").and_then(|e| e.get("error")).and_then(Value::str) == Some("usage"))
            });
        token_list(tokens, usage)?;
    }
    let sources = ["grammar", "pipeline", "documents"].iter().filter(|name| value.get(name).is_some()).count();
    if sources != 1 {
        return Err("a case requires exactly one grammar, pipeline, or documents source".into());
    }
    if value.get("documents").is_some() != value.get("pipelineDocument").is_some() {
        return Err("documents and pipelineDocument are required together".into());
    }
    if let Some(documents) = value.get("documents") {
        if documents.object().iter().any(|(_, text)| !matches!(text, Value::String(_))) {
            return Err("each document must be a string".into());
        }
    }
    if let Some(rendering) = value.get("treeRendering") {
        fields(rendering, "treeRendering", &[("aliases", Array), ("text", Text), ("decodedError", Text)])?;
        if let Some(aliases) = rendering.get("aliases") {
            strings(aliases, "treeRendering.aliases")?;
        }
    }
    if let Some(parses) = value.get("parses") {
        if parses.array().is_empty() {
            return Err("parses must be nonempty".into());
        }
        if value.get("expect").is_some() || value.get("options").is_some() {
            return Err("parses replaces the case's expect and options".into());
        }
        for run in parses.array() {
            fields(run, "parses[]", &[("options", Object), ("expect", Object)])?;
            if let Some(configuration) = run.get("options") {
                options(configuration)?;
            }
            expect(required(run, "expect", "parses[]")?)?;
        }
    } else {
        if let Some(configuration) = value.get("options") {
            options(configuration)?;
        }
        expect(required(value, "expect", "case")?)?;
    }
    Ok(())
}

pub fn notation(value: &Value) -> R {
    fields(
        value,
        "notation case",
        &[("description", Text), ("document", Text), ("cacheMisses", Bool), ("expect", Object)],
    )?;
    required(value, "document", "notation case")?;
    let expectation = required(value, "expect", "notation case")?;
    fields(expectation, "expect", &[("dom", Any), ("error", Object)])?;
    if expectation.get("dom").is_some() == expectation.get("error").is_some() {
        return Err("a notation case requires exactly one dom or error expectation".into());
    }
    if let Some(error) = expectation.get("error") {
        position(error, "expect.error", false)?;
        for name in ["line", "column"] {
            if !matches!(required(error, name, "expect.error")?, Value::Number(n) if n.is_finite() && *n >= 1.0 && n.fract() == 0.0)
            {
                return Err(format!("expect.error.{name} must be a positive integer"));
            }
        }
    }
    Ok(())
}

/// Supplied notation has its own error-message field, outside the position.
pub fn notation_value(value: &Value) -> R {
    fields(
        value,
        "supplied notation case",
        &[("id", Text), ("description", Text), ("document", Text), ("aliases", Array), ("expect", Object)],
    )?;
    required(value, "id", "supplied notation case")?;
    required(value, "document", "supplied notation case")?;
    for alias in required(value, "aliases", "supplied notation case")?.array() {
        fields(alias, "alias", &[("spelling", Text), ("value", Text), ("tags", Array)])?;
        required(alias, "spelling", "alias")?;
        required(alias, "value", "alias")?;
        strings(required(alias, "tags", "alias")?, "alias.tags")?;
    }
    let expectation = required(value, "expect", "supplied notation case")?;
    fields(expectation, "expect", &[("dom", Object), ("error", Object), ("message", Text)])?;
    if expectation.get("dom").is_some() == expectation.get("error").is_some() {
        return Err("a supplied notation case requires exactly one dom or error expectation".into());
    }
    if let Some(error) = expectation.get("error") {
        fields(error, "expect.error", &[("line", Any), ("column", Any)])?;
        for name in ["line", "column"] {
            if !matches!(required(error, name, "expect.error")?, Value::Number(n) if n.is_finite() && *n >= 1.0 && n.fract() == 0.0)
            {
                return Err(format!("expect.error.{name} must be a positive integer"));
            }
        }
    } else if expectation.get("message").is_some() {
        return Err("expect.message requires an error expectation".into());
    }
    Ok(())
}

pub fn notation_values_file(value: &Value) -> R {
    fields(value, "supplied notation file", &[("description", Text), ("cases", Array)])?;
    let cases = required(value, "cases", "supplied notation file")?;
    if cases.array().is_empty() {
        return Err("supplied notation cases must be nonempty".into());
    }
    for case in cases.array() {
        notation_value(case)?;
    }
    Ok(())
}

pub fn memo(value: &Value) -> R {
    fields(
        value,
        "memo run",
        &[("grammar", Text), ("pipeline", Text), ("texts", Array), ("inputs", Array), ("options", Array)],
    )?;
    if value.get("grammar").is_some() == value.get("pipeline").is_some() {
        return Err("a memo run requires exactly one grammar or pipeline".into());
    }
    if value.get("texts").is_some() == value.get("inputs").is_some() {
        return Err("a memo run requires exactly one texts or inputs".into());
    }
    if let Some(texts) = value.get("texts") {
        strings(texts, "texts")?;
        if texts.array().is_empty() {
            return Err("texts must be nonempty".into());
        }
    }
    if let Some(inputs) = value.get("inputs") {
        if inputs.array().is_empty() || inputs.array().iter().any(|input| !matches!(input, Value::Array(_))) {
            return Err("inputs must be a nonempty array of token arrays".into());
        }
        for input in inputs.array() {
            token_list(input, false)?;
        }
    }
    let configurations = required(value, "options", "memo run")?;
    if configurations.array().is_empty() {
        return Err("options must be nonempty".into());
    }
    for configuration in configurations.array() {
        options(configuration)?;
    }
    Ok(())
}

/// The memo file must contain runs rather than an absent or mistyped list.
pub fn memo_file(value: &Value) -> R {
    fields(value, "memo file", &[("description", Text), ("runs", Array)])?;
    let runs = required(value, "runs", "memo file")?;
    if runs.array().is_empty() {
        return Err("memo runs must be nonempty".into());
    }
    for run in runs.array() {
        memo(run)?;
    }
    Ok(())
}
