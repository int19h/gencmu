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
    if field(value, "format")?.as_int() != Some(DOM_FORMAT) {
        return Err("an unsupported DOM format".to_string());
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
