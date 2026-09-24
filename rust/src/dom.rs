//! The grammar DOM of `docs/output.md`: what reading a grammar document
//! produces, what `bootstrap.json` and `compiled.json` hold, and what
//! stitching and lowering read.

use crate::json::{write_str, Json};

/// The DOM format version (`docs/output.md`).
pub(crate) const DOM_FORMAT: i64 = 1;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Dom {
    pub rules: Vec<RuleDef>,
    pub directives: Vec<Directive>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Op {
    Define,
    Extend,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RuleDef {
    pub name: String,
    pub op: Op,
    pub tags: Option<Term>,
    pub alternatives: Vec<Alternative>,
    pub emit: Option<Emit>,
    pub conditions: Vec<Cond>,
    pub at: (usize, usize),
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Guard {
    pub feature: String,
    pub negated: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Alternative {
    pub guards: Vec<Guard>,
    pub expr: Expr,
    pub tags: Option<Term>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Expr {
    Seq(Vec<Expr>),
    Choice(Vec<Expr>),
    And(Vec<Expr>),
    Optional(Box<Expr>),
    Repeat(Box<Expr>, u8),
    Ref(String),
    Terminal(String),
    Capture(String, Box<Expr>),
    Hash,
    Empty,
}

/// A term, or a span: `{"capture":"x"}` and the calls `head`, `tail` and
/// `last` are spans, and appear only where a span is expected.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Term {
    Literal(String),
    Weak(String),
    EmptySet,
    Set(Vec<Term>),
    Union(Vec<Term>),
    Intersection(Vec<Term>),
    Call(String, Vec<Arg>),
    Capture(String),
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Arg {
    Term(Term),
    Rule(String),
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Cond {
    Compare(String, Term, Term),
    Matches(Term, String),
    Not(Box<Cond>),
    Any(Vec<Cond>),
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Emit {
    Nothing,
    Items(Vec<EmitItem>),
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum EmitItem {
    This(Option<Term>),
    Capture(String, Option<Term>),
    Insert(String),
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Directive {
    pub name: String,
    pub args: Vec<String>,
    pub at: (usize, usize),
}

// ---- reading a DOM from JSON

type R<T> = Result<T, String>;

fn field<'a>(value: &'a Json, key: &str) -> R<&'a Json> {
    value.get(key).ok_or_else(|| format!("a DOM object without {key:?}"))
}

fn string(value: &Json, key: &str) -> R<String> {
    field(value, key)?.as_str().map(str::to_string).ok_or_else(|| format!("{key:?} is not a string"))
}

fn array<'a>(value: &'a Json, key: &str) -> R<&'a [Json]> {
    field(value, key)?.as_array().ok_or_else(|| format!("{key:?} is not an array"))
}

fn position(value: &Json) -> R<(usize, usize)> {
    let items = array(value, "at")?;
    match items {
        [line, column] => {
            Ok((line.as_int().ok_or("a bad position")? as usize, column.as_int().ok_or("a bad position")? as usize))
        }
        _ => Err("a bad position".to_string()),
    }
}

pub(crate) fn dom_from_json(value: &Json) -> R<Dom> {
    if let Some(problem) = dom_problem(value) {
        return Err(problem.to_string());
    }
    let rules = array(value, "rules")?.iter().map(rule_from_json).collect::<R<Vec<_>>>()?;
    let directives = array(value, "directives")?
        .iter()
        .map(|directive| {
            Ok(Directive {
                name: string(directive, "name")?,
                args: array(directive, "args")?
                    .iter()
                    .map(|arg| arg.as_str().map(str::to_string).ok_or_else(|| "a bad directive argument".to_string()))
                    .collect::<R<Vec<_>>>()?,
                at: position(directive)?,
            })
        })
        .collect::<R<Vec<_>>>()?;
    Ok(Dom { rules, directives })
}

fn rule_from_json(value: &Json) -> R<RuleDef> {
    let op = match string(value, "op")?.as_str() {
        "define" => Op::Define,
        "extend" => Op::Extend,
        other => return Err(format!("an unknown rule op {other:?}")),
    };
    Ok(RuleDef {
        name: string(value, "name")?,
        op,
        tags: value.get("tags").map(term_from_json).transpose()?,
        alternatives: array(value, "alternatives")?
            .iter()
            .map(|alternative| {
                Ok(Alternative {
                    guards: array(alternative, "guards")?
                        .iter()
                        .map(|guard| {
                            Ok(Guard {
                                feature: string(guard, "feature")?,
                                negated: field(guard, "negated")?.as_bool().ok_or("a bad guard")?,
                            })
                        })
                        .collect::<R<Vec<_>>>()?,
                    expr: expr_from_json(field(alternative, "expr")?)?,
                    tags: alternative.get("tags").map(term_from_json).transpose()?,
                })
            })
            .collect::<R<Vec<_>>>()?,
        emit: value.get("emit").map(emit_from_json).transpose()?,
        conditions: array(value, "conditions")?.iter().map(cond_from_json).collect::<R<Vec<_>>>()?,
        at: position(value)?,
    })
}

fn first_key(value: &Json) -> R<&str> {
    match value.as_object() {
        Some([(key, _), ..]) => Ok(key),
        _ => Err("an empty or non-object DOM node".to_string()),
    }
}

fn expr_from_json(value: &Json) -> R<Expr> {
    let list = |key: &str| -> R<Vec<Expr>> { array(value, key)?.iter().map(expr_from_json).collect() };
    Ok(match first_key(value)? {
        "seq" => Expr::Seq(list("seq")?),
        "choice" => Expr::Choice(list("choice")?),
        "and" => Expr::And(list("and")?),
        "optional" => Expr::Optional(Box::new(expr_from_json(field(value, "optional")?)?)),
        "repeat" => {
            let min = field(value, "min")?.as_int().ok_or("a bad repeat")?;
            Expr::Repeat(Box::new(expr_from_json(field(value, "repeat")?)?), if min == 0 { 0 } else { 1 })
        }
        "ref" => Expr::Ref(string(value, "ref")?),
        "terminal" => Expr::Terminal(string(value, "terminal")?),
        "capture" => Expr::Capture(string(value, "capture")?, Box::new(expr_from_json(field(value, "expr")?)?)),
        "hash" => Expr::Hash,
        "empty" => Expr::Empty,
        other => return Err(format!("an unknown expression {other:?}")),
    })
}

fn term_from_json(value: &Json) -> R<Term> {
    let list = |key: &str| -> R<Vec<Term>> { array(value, key)?.iter().map(term_from_json).collect() };
    Ok(match first_key(value)? {
        "literal" => Term::Literal(string(value, "literal")?),
        "weak" => Term::Weak(string(value, "weak")?),
        "emptySet" => Term::EmptySet,
        "set" => Term::Set(list("set")?),
        "union" => Term::Union(list("union")?),
        "intersection" => Term::Intersection(list("intersection")?),
        "capture" => Term::Capture(string(value, "capture")?),
        "call" => Term::Call(
            string(value, "call")?,
            array(value, "args")?
                .iter()
                .map(|arg| match arg.get("rule") {
                    Some(Json::Str(rule)) => Ok(Arg::Rule(rule.clone())),
                    _ => term_from_json(arg).map(Arg::Term),
                })
                .collect::<R<Vec<_>>>()?,
        ),
        other => return Err(format!("an unknown term {other:?}")),
    })
}

fn cond_from_json(value: &Json) -> R<Cond> {
    Ok(match first_key(value)? {
        "op" => Cond::Compare(
            string(value, "op")?,
            term_from_json(field(value, "left")?)?,
            term_from_json(field(value, "right")?)?,
        ),
        "matches" => Cond::Matches(term_from_json(field(value, "matches")?)?, string(value, "rule")?),
        "not" => Cond::Not(Box::new(cond_from_json(field(value, "not")?)?)),
        "any" => Cond::Any(array(value, "any")?.iter().map(cond_from_json).collect::<R<Vec<_>>>()?),
        other => return Err(format!("an unknown condition {other:?}")),
    })
}

fn emit_from_json(value: &Json) -> R<Emit> {
    if value.get("nothing").is_some() {
        return Ok(Emit::Nothing);
    }
    let items = array(value, "items")?
        .iter()
        .map(|item| {
            let tags = item.get("tags").map(term_from_json).transpose()?;
            if item.get("this").is_some() {
                Ok(EmitItem::This(tags))
            } else if let Some(Json::Str(name)) = item.get("capture") {
                Ok(EmitItem::Capture(name.clone(), tags))
            } else if let Some(Json::Str(tag)) = item.get("insert") {
                Ok(EmitItem::Insert(tag.clone()))
            } else {
                Err("an unknown emission item".to_string())
            }
        })
        .collect::<R<Vec<_>>>()?;
    Ok(Emit::Items(items))
}

// ---- holding a DOM to the reader's rules

/// How deeply an expression, a term or a condition may nest (engine §9).
pub(crate) const DOM_MAX_DEPTH: usize = 256;

fn is_object(value: &Json) -> bool {
    matches!(value, Json::Obj(_))
}

fn has(value: &Json, key: &str) -> bool {
    value.get(key).is_some()
}

fn is_str(value: Option<&Json>) -> bool {
    matches!(value, Some(Json::Str(_)))
}

fn is_true(value: Option<&Json>) -> bool {
    matches!(value, Some(Json::Bool(true)))
}

fn is_position(value: Option<&Json>) -> bool {
    matches!(value.and_then(Json::as_array), Some([Json::Int(_), Json::Int(_)]))
}

fn is_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic()) && chars.all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// A span: a capture, or `head`, `tail` or `last` of something.
fn is_span_json(value: &Json) -> bool {
    is_object(value)
        && (is_str(value.get("capture"))
            || matches!(value.get("call").and_then(Json::as_str), Some("head" | "tail" | "last")))
}

/// A string: a literal, or `phonemes`, `text` or `lowercase` of something.
fn is_string_json(value: &Json) -> bool {
    is_object(value)
        && (is_str(value.get("literal"))
            || matches!(value.get("call").and_then(Json::as_str), Some("phonemes" | "text" | "lowercase")))
}

fn is_rule_arg(value: &Json) -> bool {
    matches!(value.as_object(), Some([(key, Json::Str(_))]) if key == "rule")
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Expr,
    Term,
    /// A function's argument: a term where a span may stand.
    Argument,
    Condition,
    Emission,
}

/// Why a JSON value is not a DOM the reader could have produced (engine
/// §9, docs/output.md "A grammar DOM"), or `None` when it is one. A DOM
/// from the bootstrap or from `compiled.json` is held to every rule the
/// reader enforces, so that no cache entry can change a result.
pub(crate) fn dom_problem(dom: &Json) -> Option<&'static str> {
    if !is_object(dom)
        || dom.get("format").and_then(Json::as_int) != Some(DOM_FORMAT)
        || dom.get("rules").and_then(Json::as_array).is_none()
        || dom.get("directives").and_then(Json::as_array).is_none()
    {
        return Some("not a DOM of format 1");
    }
    for directive in dom.get("directives").and_then(Json::as_array).unwrap_or(&[]) {
        let args = directive.get("args").and_then(Json::as_array);
        if !is_object(directive)
            || !is_str(directive.get("name"))
            || !args.is_some_and(|args| args.iter().all(|arg| matches!(arg, Json::Str(_))))
            || !is_position(directive.get("at"))
        {
            return Some("a malformed directive");
        }
    }
    let mut pending: Vec<(Kind, &Json, usize)> = Vec::new();
    for rule in dom.get("rules").and_then(Json::as_array).unwrap_or(&[]) {
        let alternatives = rule.get("alternatives").and_then(Json::as_array);
        let conditions = rule.get("conditions").and_then(Json::as_array);
        if !is_object(rule)
            || !rule.get("name").and_then(Json::as_str).is_some_and(is_name)
            || !matches!(rule.get("op").and_then(Json::as_str), Some("define" | "extend"))
            || !alternatives.is_some_and(|alternatives| !alternatives.is_empty())
            || conditions.is_none()
            || !is_position(rule.get("at"))
        {
            return Some("a malformed rule");
        }
        if let Some(tags) = rule.get("tags") {
            pending.push((Kind::Term, tags, 0));
        }
        if let Some(emit) = rule.get("emit") {
            pending.push((Kind::Emission, emit, 0));
        }
        for condition in conditions.unwrap_or(&[]) {
            pending.push((Kind::Condition, condition, 0));
        }
        for alternative in alternatives.unwrap_or(&[]) {
            let guards = alternative.get("guards").and_then(Json::as_array);
            let guards_ok = guards.is_some_and(|guards| {
                guards.iter().all(|guard| {
                    is_object(guard)
                        && is_str(guard.get("feature"))
                        && matches!(guard.get("negated"), Some(Json::Bool(_)))
                })
            });
            if !is_object(alternative) || !guards_ok {
                return Some("a malformed alternative");
            }
            // A capture name once per alternative, as the reader requires.
            let mut names: Vec<&str> = Vec::new();
            let mut stack: Vec<&Json> = alternative.get("expr").into_iter().collect();
            while let Some(expr) = stack.pop() {
                if let Some(name) = expr.get("capture").and_then(Json::as_str) {
                    if names.contains(&name) {
                        return Some("a capture name used twice in one alternative");
                    }
                    names.push(name);
                }
                for key in ["seq", "choice", "and"] {
                    if let Some(items) = expr.get(key).and_then(Json::as_array) {
                        stack.extend(items.iter());
                    }
                }
                for key in ["optional", "repeat"] {
                    if let Some(inner) = expr.get(key) {
                        stack.push(inner);
                    }
                }
                if stack.len() > 100_000 {
                    return Some("nested too deeply");
                }
            }
            match alternative.get("expr") {
                Some(expr) => pending.push((Kind::Expr, expr, 0)),
                None => return Some("a malformed alternative"),
            }
            if let Some(tags) = alternative.get("tags") {
                pending.push((Kind::Term, tags, 0));
            }
        }
    }
    let list = |items: Option<&Json>, least: usize, most: usize| {
        items.and_then(Json::as_array).is_some_and(|items| items.len() >= least && items.len() <= most)
    };
    while let Some((kind, value, depth)) = pending.pop() {
        if depth > DOM_MAX_DEPTH {
            return Some("nested too deeply");
        }
        if !is_object(value) {
            return Some(match kind {
                Kind::Expr => "a malformed expression",
                Kind::Term | Kind::Argument => "a malformed term",
                Kind::Condition => "a malformed condition",
                Kind::Emission => "a malformed emission",
            });
        }
        let next = depth + 1;
        match kind {
            Kind::Expr => {
                if has(value, "choice") || has(value, "seq") {
                    let items = value.get("choice").or_else(|| value.get("seq"));
                    if !list(items, 2, usize::MAX) {
                        return Some("a malformed expression");
                    }
                    pending.extend(
                        items.and_then(Json::as_array).unwrap_or(&[]).iter().map(|item| (Kind::Expr, item, next)),
                    );
                } else if has(value, "and") {
                    if !list(value.get("and"), 2, crate::grammar::MAX_AND) {
                        return Some("a malformed expression");
                    }
                    pending.extend(
                        value
                            .get("and")
                            .and_then(Json::as_array)
                            .unwrap_or(&[])
                            .iter()
                            .map(|item| (Kind::Expr, item, next)),
                    );
                } else if let Some(inner) = value.get("repeat") {
                    if !matches!(value.get("min"), Some(Json::Int(0 | 1))) {
                        return Some("a malformed expression");
                    }
                    pending.push((Kind::Expr, inner, next));
                } else if let Some(inner) = value.get("optional") {
                    pending.push((Kind::Expr, inner, next));
                } else if has(value, "capture") {
                    let inner = value.get("expr");
                    let wraps_symbol = inner.is_some_and(|inner| {
                        is_object(inner) && (is_str(inner.get("ref")) || is_str(inner.get("terminal")))
                    });
                    if !is_str(value.get("capture")) || !wraps_symbol {
                        return Some("a malformed capture");
                    }
                } else if !(is_str(value.get("ref"))
                    || is_str(value.get("terminal"))
                    || is_true(value.get("hash"))
                    || is_true(value.get("empty")))
                {
                    return Some("a malformed expression");
                }
            }
            Kind::Emission => {
                // Nothing alone, this only with this, a capture listed
                // once, no tags on an inserted tag (§9).
                if is_true(value.get("nothing")) {
                    if value.as_object().map_or(0, <[_]>::len) != 1 {
                        return Some("a malformed emission");
                    }
                    continue;
                }
                if !list(value.get("items"), 1, usize::MAX) {
                    return Some("a malformed emission");
                }
                let items = value.get("items").and_then(Json::as_array).unwrap_or(&[]);
                let mut this = 0;
                let mut captures: Vec<&str> = Vec::new();
                for item in items {
                    if !is_object(item) {
                        return Some("a malformed emission");
                    }
                    if is_true(item.get("this")) {
                        this += 1;
                    } else if let Some(name) = item.get("capture").and_then(Json::as_str) {
                        if captures.contains(&name) {
                            return Some("a malformed emission");
                        }
                        captures.push(name);
                    } else if is_str(item.get("insert")) {
                        if has(item, "tags") {
                            return Some("a malformed emission");
                        }
                    } else {
                        return Some("a malformed emission");
                    }
                    if let Some(tags) = item.get("tags") {
                        pending.push((Kind::Term, tags, next));
                    }
                }
                if this > 0 && this < items.len() {
                    return Some("a malformed emission");
                }
            }
            Kind::Condition => {
                if has(value, "any") {
                    if !list(value.get("any"), 2, usize::MAX) {
                        return Some("a malformed condition");
                    }
                    pending.extend(
                        value
                            .get("any")
                            .and_then(Json::as_array)
                            .unwrap_or(&[])
                            .iter()
                            .map(|item| (Kind::Condition, item, next)),
                    );
                } else if let Some(inner) = value.get("not") {
                    pending.push((Kind::Condition, inner, next));
                } else if let Some(span) = value.get("matches") {
                    if !is_str(value.get("rule")) || !is_span_json(span) {
                        return Some("a malformed condition");
                    }
                    pending.push((Kind::Argument, span, next));
                } else {
                    if !matches!(value.get("op").and_then(Json::as_str), Some("=" | "≠" | "∈" | "∉" | "⊆")) {
                        return Some("a malformed condition");
                    }
                    match (value.get("left"), value.get("right")) {
                        (Some(left), Some(right)) => {
                            pending.push((Kind::Term, left, next));
                            pending.push((Kind::Term, right, next));
                        }
                        _ => return Some("a malformed condition"),
                    }
                }
            }
            Kind::Term | Kind::Argument => {
                if has(value, "set") || has(value, "union") || has(value, "intersection") {
                    let (items, least) = if has(value, "set") {
                        (value.get("set"), 0)
                    } else {
                        (value.get("union").or_else(|| value.get("intersection")), 2)
                    };
                    if !list(items, least, usize::MAX) {
                        return Some("a malformed term");
                    }
                    pending.extend(
                        items.and_then(Json::as_array).unwrap_or(&[]).iter().map(|item| (Kind::Term, item, next)),
                    );
                } else if has(value, "call") {
                    // The reader's signatures, with a span where one is due.
                    let args = value.get("args").and_then(Json::as_array).unwrap_or(&[]);
                    let call = value.get("call").and_then(Json::as_str);
                    let ok = match call {
                        Some("tags") => match args {
                            [span] => is_span_json(span),
                            [span, rule] => is_span_json(span) && is_rule_arg(rule),
                            _ => false,
                        },
                        Some("lowercase") => matches!(args, [string] if is_string_json(string)),
                        Some("phonemes" | "text" | "classes" | "words" | "head" | "tail" | "last") => {
                            matches!(args, [span] if is_span_json(span))
                        }
                        // `matches` is a condition, never a term.
                        _ => false,
                    };
                    let span_call = matches!(call, Some("head" | "tail" | "last"));
                    if !ok || (kind != Kind::Argument && span_call) {
                        return Some("a malformed term");
                    }
                    for arg in args {
                        if !is_rule_arg(arg) {
                            pending.push((Kind::Argument, arg, next));
                        }
                    }
                } else if !(is_str(value.get("literal"))
                    || is_str(value.get("weak"))
                    || is_true(value.get("emptySet"))
                    || is_str(value.get("capture")))
                {
                    return Some("a malformed term");
                }
            }
        }
    }
    None
}

// ---- writing a DOM as canonical JSON

pub(crate) fn dom_to_json(dom: &Dom) -> String {
    let mut out = String::new();
    out.push_str("{\"format\":");
    out.push_str(&DOM_FORMAT.to_string());
    out.push_str(",\"rules\":[");
    for (index, rule) in dom.rules.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        write_rule(&mut out, rule);
    }
    out.push_str("],\"directives\":[");
    for (index, directive) in dom.directives.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        out.push_str("{\"name\":");
        write_str(&mut out, &directive.name);
        out.push_str(",\"args\":[");
        for (index, arg) in directive.args.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            write_str(&mut out, arg);
        }
        out.push_str(&format!("],\"at\":[{},{}]}}", directive.at.0, directive.at.1));
    }
    out.push_str("]}");
    out
}

fn write_rule(out: &mut String, rule: &RuleDef) {
    out.push_str("{\"name\":");
    write_str(out, &rule.name);
    out.push_str(match rule.op {
        Op::Define => ",\"op\":\"define\"",
        Op::Extend => ",\"op\":\"extend\"",
    });
    if let Some(tags) = &rule.tags {
        out.push_str(",\"tags\":");
        write_term(out, tags);
    }
    out.push_str(",\"alternatives\":[");
    for (index, alternative) in rule.alternatives.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        out.push_str("{\"guards\":[");
        for (index, guard) in alternative.guards.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            out.push_str("{\"feature\":");
            write_str(out, &guard.feature);
            out.push_str(if guard.negated { ",\"negated\":true}" } else { ",\"negated\":false}" });
        }
        out.push_str("],\"expr\":");
        write_expr(out, &alternative.expr);
        if let Some(tags) = &alternative.tags {
            out.push_str(",\"tags\":");
            write_term(out, tags);
        }
        out.push('}');
    }
    out.push(']');
    if let Some(emit) = &rule.emit {
        out.push_str(",\"emit\":");
        match emit {
            Emit::Nothing => out.push_str("{\"nothing\":true}"),
            Emit::Items(items) => {
                out.push_str("{\"items\":[");
                for (index, item) in items.iter().enumerate() {
                    if index > 0 {
                        out.push(',');
                    }
                    let tags = match item {
                        EmitItem::This(tags) => {
                            out.push_str("{\"this\":true");
                            tags
                        }
                        EmitItem::Capture(name, tags) => {
                            out.push_str("{\"capture\":");
                            write_str(out, name);
                            tags
                        }
                        EmitItem::Insert(tag) => {
                            out.push_str("{\"insert\":");
                            write_str(out, tag);
                            &None
                        }
                    };
                    if let Some(tags) = tags {
                        out.push_str(",\"tags\":");
                        write_term(out, tags);
                    }
                    out.push('}');
                }
                out.push_str("]}");
            }
        }
    }
    out.push_str(",\"conditions\":[");
    for (index, cond) in rule.conditions.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        write_cond(out, cond);
    }
    out.push_str(&format!("],\"at\":[{},{}]}}", rule.at.0, rule.at.1));
}

fn write_list<T>(out: &mut String, key: &str, items: &[T], write: fn(&mut String, &T)) {
    out.push_str("{\"");
    out.push_str(key);
    out.push_str("\":[");
    for (index, item) in items.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        write(out, item);
    }
    out.push_str("]}");
}

fn write_expr(out: &mut String, expr: &Expr) {
    match expr {
        Expr::Seq(items) => write_list(out, "seq", items, write_expr),
        Expr::Choice(items) => write_list(out, "choice", items, write_expr),
        Expr::And(items) => write_list(out, "and", items, write_expr),
        Expr::Optional(inner) => {
            out.push_str("{\"optional\":");
            write_expr(out, inner);
            out.push('}');
        }
        Expr::Repeat(inner, min) => {
            out.push_str("{\"repeat\":");
            write_expr(out, inner);
            out.push_str(&format!(",\"min\":{min}}}"));
        }
        Expr::Ref(name) => {
            out.push_str("{\"ref\":");
            write_str(out, name);
            out.push('}');
        }
        Expr::Terminal(name) => {
            out.push_str("{\"terminal\":");
            write_str(out, name);
            out.push('}');
        }
        Expr::Capture(name, inner) => {
            out.push_str("{\"capture\":");
            write_str(out, name);
            out.push_str(",\"expr\":");
            write_expr(out, inner);
            out.push('}');
        }
        Expr::Hash => out.push_str("{\"hash\":true}"),
        Expr::Empty => out.push_str("{\"empty\":true}"),
    }
}

fn write_term(out: &mut String, term: &Term) {
    match term {
        Term::Literal(text) => {
            out.push_str("{\"literal\":");
            write_str(out, text);
            out.push('}');
        }
        Term::Weak(text) => {
            out.push_str("{\"weak\":");
            write_str(out, text);
            out.push('}');
        }
        Term::EmptySet => out.push_str("{\"emptySet\":true}"),
        Term::Set(items) => write_list(out, "set", items, write_term),
        Term::Union(items) => write_list(out, "union", items, write_term),
        Term::Intersection(items) => write_list(out, "intersection", items, write_term),
        Term::Capture(name) => {
            out.push_str("{\"capture\":");
            write_str(out, name);
            out.push('}');
        }
        Term::Call(name, args) => {
            out.push_str("{\"call\":");
            write_str(out, name);
            out.push_str(",\"args\":[");
            for (index, arg) in args.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                match arg {
                    Arg::Term(term) => write_term(out, term),
                    Arg::Rule(rule) => {
                        out.push_str("{\"rule\":");
                        write_str(out, rule);
                        out.push('}');
                    }
                }
            }
            out.push_str("]}");
        }
    }
}

fn write_cond(out: &mut String, cond: &Cond) {
    match cond {
        Cond::Compare(op, left, right) => {
            out.push_str("{\"op\":");
            write_str(out, op);
            out.push_str(",\"left\":");
            write_term(out, left);
            out.push_str(",\"right\":");
            write_term(out, right);
            out.push('}');
        }
        Cond::Matches(span, rule) => {
            out.push_str("{\"matches\":");
            write_term(out, span);
            out.push_str(",\"rule\":");
            write_str(out, rule);
            out.push('}');
        }
        Cond::Not(inner) => {
            out.push_str("{\"not\":");
            write_cond(out, inner);
            out.push('}');
        }
        Cond::Any(items) => write_list(out, "any", items, write_cond),
    }
}
