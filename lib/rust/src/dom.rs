//! The grammar DOM of `docs/output.md`: what reading a grammar document
//! produces, what `bootstrap.json` and `compiled.json` hold, and what
//! stitching and lowering read.

use crate::json::{write_str, Json};

/// The DOM format version (`docs/output.md`).
pub(crate) const DOM_FORMAT: i64 = 5;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Dom {
    pub rules: Vec<RuleDef>,
    pub directives: Vec<Directive>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Op {
    Define,
    Redefine,
    Extend,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RuleDef {
    pub name: String,
    pub op: Op,
    pub tags: Option<Term>,
    pub alternatives: Vec<Alternative>,
    pub emit: Option<Vec<EmitItem>>,
    pub conditions: Vec<Cond>,
    pub at: (usize, usize),
}

/// What kind of feature a name is (engine §13), as each guard that uses it
/// says.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FeatureKind {
    /// A gate, `@f?` or `@¬f?`: its alternatives are kept only while the
    /// feature is on, or off.
    Gate,
    /// A warning, `@f!`: its alternatives are always kept, and while the
    /// feature is on, each node of a chosen tree built from one gives a
    /// warning (engine §12).
    Warning,
}

/// A guard; a warning is never negated.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Guard {
    pub feature: String,
    pub kind: FeatureKind,
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
    Empty,
}

/// A term, or a span: `{"capture":"x"}` and the calls `head`, `tail` and
/// `last` are spans, and appear only where a span is expected. The capture
/// named `""` is `$`, the whole constituent.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Term {
    Literal(String),
    Weak(String),
    EmptySet,
    Union(Vec<Term>),
    Intersection(Vec<Term>),
    Call(String, Vec<Arg>),
    Capture(String),
    /// `A ⟹ t`: `t` where the condition holds, else the empty set.
    If(Box<Cond>, Box<Term>),
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
    /// `initial(s)`: whether the span begins where the parse's input does.
    Initial(Term),
    Not(Box<Cond>),
    Any(Vec<Cond>),
    All(Vec<Cond>),
    /// `$x` standing as a condition: whether the production has the capture.
    Captured(String),
    /// `A ⟹ B`.
    If(Box<Cond>, Box<Cond>),
}

/// An item of an emission clause. A capture named `""` is `$`, the whole
/// constituent. An emission of no items is `%emits ε` (§11).
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum EmitItem {
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
    // A definition the reader would refuse (engine §9).
    for rule in &rules {
        if let Some(problem) = crate::clauses::definition_problem(rule) {
            return Err(problem);
        }
    }
    Ok(Dom { rules, directives })
}

fn rule_from_json(value: &Json) -> R<RuleDef> {
    let op = match string(value, "op")?.as_str() {
        "define" => Op::Define,
        "redefine" => Op::Redefine,
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
                                kind: match string(guard, "kind")?.as_str() {
                                    "gate" => FeatureKind::Gate,
                                    "warning" => FeatureKind::Warning,
                                    _ => return Err("a bad guard".to_string()),
                                },
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
        "union" => Term::Union(list("union")?),
        "intersection" => Term::Intersection(list("intersection")?),
        "capture" => Term::Capture(string(value, "capture")?),
        "if" => {
            Term::If(Box::new(cond_from_json(field(value, "if")?)?), Box::new(term_from_json(field(value, "then")?)?))
        }
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
        "initial" => Cond::Initial(term_from_json(field(value, "initial")?)?),
        "not" => Cond::Not(Box::new(cond_from_json(field(value, "not")?)?)),
        "any" => Cond::Any(array(value, "any")?.iter().map(cond_from_json).collect::<R<Vec<_>>>()?),
        "all" => Cond::All(array(value, "all")?.iter().map(cond_from_json).collect::<R<Vec<_>>>()?),
        "captured" => Cond::Captured(string(value, "captured")?),
        "if" => {
            Cond::If(Box::new(cond_from_json(field(value, "if")?)?), Box::new(cond_from_json(field(value, "then")?)?))
        }
        other => return Err(format!("an unknown condition {other:?}")),
    })
}

fn emit_from_json(value: &Json) -> R<Vec<EmitItem>> {
    array(value, "items")?
        .iter()
        .map(|item| {
            let tags = item.get("tags").map(term_from_json).transpose()?;
            if let Some(Json::Str(name)) = item.get("capture") {
                Ok(EmitItem::Capture(name.clone(), tags))
            } else if let Some(Json::Str(tag)) = item.get("insert") {
                Ok(EmitItem::Insert(tag.clone()))
            } else {
                Err("an unknown emission item".to_string())
            }
        })
        .collect()
}

// ---- holding a DOM to the reader's rules

/// How many compound nodes of an expression, a term or a condition may lie
/// above any node of it (engine §9): the depth a node is checked at is the
/// number of such ancestors, counted from the root at 0.
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

/// A rule's name: a name, or `#`, the free-modifier slot (engine §2).
fn is_rule_name(name: &str) -> bool {
    let mut chars = name.chars();
    name == "#"
        || chars.next().is_some_and(|c| c.is_ascii_alphabetic()) && chars.all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// `$`, the whole constituent, as a span or a term.
fn is_whole(value: &Json) -> bool {
    matches!(value.as_object(), Some([(key, Json::Str(name))]) if key == "capture" && name.is_empty())
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
    /// A rule's or an alternative's tag term, which may not read the tags
    /// it defines: `$`, `tags($)` or `classes($)` (engine §9).
    TagTerm,
    /// A function's argument: a term where a span may stand.
    Argument,
    Condition,
    /// A condition inside a tag term, a guard's, which may not read the
    /// tags the term defines either.
    TagCondition,
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
        return Some("not a DOM of format 5");
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
            || !rule.get("name").and_then(Json::as_str).is_some_and(is_rule_name)
            || !matches!(rule.get("op").and_then(Json::as_str), Some("define" | "redefine" | "extend"))
            || !alternatives.is_some_and(|alternatives| !alternatives.is_empty())
            || conditions.is_none()
            || !is_position(rule.get("at"))
        {
            return Some("a malformed rule");
        }
        if let Some(tags) = rule.get("tags") {
            pending.push((Kind::TagTerm, tags, 0));
        }
        if let Some(emit) = rule.get("emit") {
            pending.push((Kind::Emission, emit, 0));
        }
        for condition in conditions.unwrap_or(&[]) {
            pending.push((Kind::Condition, condition, 0));
        }
        for alternative in alternatives.unwrap_or(&[]) {
            // A guard is a gate, negated or not, or a warning, which never
            // is (§9).
            let guards = alternative.get("guards").and_then(Json::as_array);
            let guards_ok = guards.is_some_and(|guards| {
                guards.iter().all(|guard| {
                    is_object(guard)
                        && is_str(guard.get("feature"))
                        && match (guard.get("kind").and_then(Json::as_str), guard.get("negated")) {
                            (Some("gate"), Some(Json::Bool(_))) => true,
                            (Some("warning"), Some(Json::Bool(negated))) => !negated,
                            _ => false,
                        }
                })
            });
            if !is_object(alternative) || !guards_ok {
                return Some("a malformed alternative");
            }
            // A capture only at the top level, the expression itself or an
            // item of its top-level seq (§3.5), and a name once per
            // alternative, as the reader requires.
            let mut names: Vec<&str> = Vec::new();
            // 0: the alternative's expression; 1: an item of its top-level
            // seq; 2: anything deeper.
            let mut stack: Vec<(&Json, u8)> = alternative.get("expr").map(|expr| (expr, 0)).into_iter().collect();
            while let Some((expr, level)) = stack.pop() {
                if let Some(name) = expr.get("capture").and_then(Json::as_str) {
                    if level > 1 {
                        return Some("a capture inside [ ], ( ), ..., & or a choice");
                    }
                    if names.contains(&name) {
                        return Some("a capture name used twice in one alternative");
                    }
                    names.push(name);
                    if names.len() > 4 {
                        return Some("more than four captures in an alternative");
                    }
                }
                if let Some(items) = expr.get("seq").and_then(Json::as_array) {
                    stack.extend(items.iter().map(|item| (item, if level == 0 { 1 } else { 2 })));
                }
                for key in ["choice", "and"] {
                    if let Some(items) = expr.get(key).and_then(Json::as_array) {
                        stack.extend(items.iter().map(|item| (item, 2)));
                    }
                }
                for key in ["optional", "repeat"] {
                    if let Some(inner) = expr.get(key) {
                        stack.push((inner, 2));
                    }
                }
            }
            match alternative.get("expr") {
                Some(expr) => pending.push((Kind::Expr, expr, 0)),
                None => return Some("a malformed alternative"),
            }
            if let Some(tags) = alternative.get("tags") {
                pending.push((Kind::TagTerm, tags, 0));
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
                Kind::Term | Kind::TagTerm | Kind::Argument => "a malformed term",
                Kind::Condition | Kind::TagCondition => "a malformed condition",
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
                    // `$` is the whole constituent and wraps nothing.
                    let named = value.get("capture").and_then(Json::as_str).is_some_and(|name| !name.is_empty());
                    if !named || !wraps_symbol {
                        return Some("a malformed capture");
                    }
                } else if !(is_str(value.get("ref")) || is_str(value.get("terminal")) || is_true(value.get("empty"))) {
                    return Some("a malformed expression");
                }
            }
            Kind::Emission => {
                // `$` only with `$`, a capture other than `$` listed once,
                // tags only on a capture, never `<∅>`, and no member but
                // those; no items is `ε` (§9).
                if !list(value.get("items"), 0, usize::MAX) {
                    return Some("a malformed emission");
                }
                let items = value.get("items").and_then(Json::as_array).unwrap_or(&[]);
                let mut whole = 0;
                let mut captures: Vec<&str> = Vec::new();
                for item in items {
                    let known = item.as_object().is_some_and(|members| {
                        members.iter().all(|(key, _)| matches!(key.as_str(), "capture" | "insert" | "tags"))
                    });
                    if !known {
                        return Some("a malformed emission");
                    }
                    if let Some(name) = item.get("capture").and_then(Json::as_str) {
                        if has(item, "insert") {
                            return Some("a malformed emission");
                        }
                        if name.is_empty() {
                            whole += 1;
                        } else if captures.contains(&name) {
                            return Some("a malformed emission");
                        } else {
                            captures.push(name);
                        }
                    } else if is_str(item.get("insert")) {
                        if has(item, "tags") {
                            return Some("a malformed emission");
                        }
                    } else {
                        return Some("a malformed emission");
                    }
                    if let Some(tags) = item.get("tags") {
                        if is_true(tags.get("emptySet")) {
                            return Some("a malformed emission");
                        }
                        // The emission is no node of the term: its depth
                        // counts from the term's own root (§9).
                        pending.push((Kind::Term, tags, 0));
                    }
                }
                if whole > 0 && whole < items.len() {
                    return Some("a malformed emission");
                }
            }
            Kind::Condition | Kind::TagCondition => {
                // A guard's condition inside a tag term may not read the
                // term's own tags either (§9).
                let (conditions, terms) =
                    if kind == Kind::TagCondition { (kind, Kind::TagTerm) } else { (kind, Kind::Term) };
                if has(value, "any") || has(value, "all") {
                    let items = value.get("any").or_else(|| value.get("all"));
                    if !list(items, 2, usize::MAX) {
                        return Some("a malformed condition");
                    }
                    pending.extend(
                        items.and_then(Json::as_array).unwrap_or(&[]).iter().map(|item| (conditions, item, next)),
                    );
                } else if let Some(inner) = value.get("not") {
                    pending.push((conditions, inner, next));
                } else if let Some(name) = value.get("captured") {
                    if !matches!(name, Json::Str(_)) || value.as_object().map_or(0, <[_]>::len) != 1 {
                        return Some("a malformed condition");
                    }
                } else if let Some(inner) = value.get("if") {
                    let Some(then) = value.get("then").filter(|_| value.as_object().map_or(0, <[_]>::len) == 2) else {
                        return Some("a malformed condition");
                    };
                    pending.push((conditions, inner, next));
                    pending.push((conditions, then, next));
                } else if let Some(span) = value.get("matches") {
                    if !is_str(value.get("rule")) || !is_span_json(span) {
                        return Some("a malformed condition");
                    }
                    pending.push((Kind::Argument, span, next));
                } else if let Some(span) = value.get("initial") {
                    if value.as_object().map_or(0, <[_]>::len) != 1 || !is_span_json(span) {
                        return Some("a malformed condition");
                    }
                    pending.push((Kind::Argument, span, next));
                } else {
                    if !matches!(value.get("op").and_then(Json::as_str), Some("=" | "≠" | "∈" | "∉" | "⊆")) {
                        return Some("a malformed condition");
                    }
                    match (value.get("left"), value.get("right")) {
                        (Some(left), Some(right)) => {
                            pending.push((terms, left, next));
                            pending.push((terms, right, next));
                        }
                        _ => return Some("a malformed condition"),
                    }
                }
            }
            Kind::Term | Kind::TagTerm | Kind::Argument => {
                let own = kind == Kind::TagTerm;
                if own && is_whole(value) {
                    return Some("a tag term that reads the tags it defines");
                }
                let inner = if own { Kind::TagTerm } else { Kind::Term };
                if let Some(cond) = value.get("if") {
                    let Some(then) = value.get("then").filter(|_| value.as_object().map_or(0, <[_]>::len) == 2) else {
                        return Some("a malformed term");
                    };
                    pending.push((if own { Kind::TagCondition } else { Kind::Condition }, cond, next));
                    pending.push((inner, then, next));
                } else if has(value, "union") || has(value, "intersection") {
                    let items = value.get("union").or_else(|| value.get("intersection"));
                    if !list(items, 2, usize::MAX) {
                        return Some("a malformed term");
                    }
                    pending
                        .extend(items.and_then(Json::as_array).unwrap_or(&[]).iter().map(|item| (inner, item, next)));
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
                        // `matches` and `initial` are conditions, never terms.
                        _ => false,
                    };
                    let span_call = matches!(call, Some("head" | "tail" | "last"));
                    if !ok || (kind != Kind::Argument && span_call) {
                        return Some("a malformed term");
                    }
                    if own && matches!(call, Some("tags" | "classes")) && matches!(args, [span] if is_whole(span)) {
                        return Some("a tag term that reads the tags it defines");
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
        Op::Redefine => ",\"op\":\"redefine\"",
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
            out.push_str(match guard.kind {
                FeatureKind::Gate => ",\"kind\":\"gate\"",
                FeatureKind::Warning => ",\"kind\":\"warning\"",
            });
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
    if let Some(items) = &rule.emit {
        out.push_str(",\"emit\":{\"items\":[");
        for (index, item) in items.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            match item {
                EmitItem::Capture(name, tags) => {
                    out.push_str("{\"capture\":");
                    write_str(out, name);
                    if let Some(tags) = tags {
                        out.push_str(",\"tags\":");
                        write_term(out, tags);
                    }
                }
                EmitItem::Insert(tag) => {
                    out.push_str("{\"insert\":");
                    write_str(out, tag);
                }
            }
            out.push('}');
        }
        out.push_str("]}");
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
        Term::Union(items) => write_list(out, "union", items, write_term),
        Term::Intersection(items) => write_list(out, "intersection", items, write_term),
        Term::Capture(name) => {
            out.push_str("{\"capture\":");
            write_str(out, name);
            out.push('}');
        }
        Term::If(cond, then) => {
            out.push_str("{\"if\":");
            write_cond(out, cond);
            out.push_str(",\"then\":");
            write_term(out, then);
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
        Cond::Initial(span) => {
            out.push_str("{\"initial\":");
            write_term(out, span);
            out.push('}');
        }
        Cond::Not(inner) => {
            out.push_str("{\"not\":");
            write_cond(out, inner);
            out.push('}');
        }
        Cond::Any(items) => write_list(out, "any", items, write_cond),
        Cond::All(items) => write_list(out, "all", items, write_cond),
        Cond::Captured(name) => {
            out.push_str("{\"captured\":");
            write_str(out, name);
            out.push('}');
        }
        Cond::If(cond, then) => {
            out.push_str("{\"if\":");
            write_cond(out, cond);
            out.push_str(",\"then\":");
            write_cond(out, then);
            out.push('}');
        }
    }
}
