//! The grammar DOM of `docs/output.md`: what reading a grammar document
//! produces, what `bootstrap.json` and `compiled.json` hold, and what
//! stitching and lowering read.

mod schema;
pub(crate) fn dom_problem(dom: &crate::json::Json, unicode: &crate::unicode::Unicode) -> Option<&'static str> {
    schema::problem(dom, unicode)
}

use crate::fxhash::FxSet;
use crate::json::{write_str, Json};
use crate::tags::is_name;
use crate::unicode::{is_property_name, Unicode};

/// The DOM format version (`docs/output.md`), part of every cache key.
pub const DOM_FORMAT: i64 = 32;

#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct Dom {
    pub rules: Vec<RuleDef>,
    pub directives: Vec<Directive>,
    pub constants: Vec<ConstDef>,
    pub classifiers: Vec<ClassifierDef>,
    pub implications: Vec<ImplicationDef>,
}

/// A `%classifier NAME` item (engine §2): its name, which begins with `a`
/// to `z`, and its entries in the order written. Every item of one name in
/// a stage adds to one classifier.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ClassifierDef {
    pub name: String,
    pub entries: Vec<Entry>,
    pub at: (usize, usize),
}

/// A classifier entry holds gates, unresolved string keys, and a class.
/// It adds (`∈`) or removes (`∉`) that class (engine §2).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Entry {
    pub guards: Vec<Guard>,
    pub keys: Vec<Term>,
    pub adds: bool,
    pub class: String,
    pub at: (usize, usize),
}

/// An implication `%implies A ⟹ B` (engine §2, §11): two closed terms whose
/// type is a tag set.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ImplicationDef {
    pub antecedent: Term,
    pub consequent: Term,
    pub at: (usize, usize),
}

/// Whether a string is a classifier's name: a name that begins with `a` to
/// `z` (engine §2, §9).
pub(crate) fn is_classifier_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// A constant's definition (engine §2): `%const $NAME t`, or, when
/// `redefine`, `%redefine-const $NAME t`. The name has no `$`, and the
/// value is a closed term (§10) that holds references, never values.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ConstDef {
    pub name: String,
    pub redefine: bool,
    pub value: Term,
    pub at: (usize, usize),
}

/// Whether a string is a constant's name without its `$`: a name that
/// begins with `A` to `Z` (engine §2).
pub(crate) fn is_constant_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_uppercase())
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Op {
    Define,
    Redefine,
    Extend,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RuleDef {
    pub deferred_emission: Option<String>,
    pub name: String,
    pub op: Op,
    pub flags: Vec<String>,
    pub tags: Option<Term>,
    pub strings: Channels,
    pub alternatives: Vec<Alternative>,
    pub emit: Option<Vec<EmitItem>>,
    pub conditions: Vec<Cond>,
    /// `%erased` contributes no strings or emission parts (engine §11).
    pub erased: bool,
    pub at: (usize, usize),
}

/// What kind of feature a name is (engine §13), as each guard that uses it
/// says.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FeatureKind {
    /// A gate, `f?` or `¬f?`: its alternatives are kept only while the
    /// feature is on, or off.
    Gate,
    /// A warning, `f!`: its alternatives are always kept, and while the
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
    pub strings: Channels,
    pub ranked_locations: std::collections::BTreeMap<String, (usize, usize)>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Expr {
    Seq(Vec<Expr>),
    Choice(Vec<Expr>),
    Ranked(Vec<Expr>),
    And(Vec<Expr>),
    /// An optional `[x]`, or an elidable optional `[+T x]` (§3.8).
    Optional(Box<Expr>, Mark),
    /// Braces: the item, the separator after `\` if any, and a chain's
    /// direction, from its marker `...` (engine §3.2, §3.3).
    Repeat(Box<Expr>, Option<Box<Expr>>, Option<Chain>),
    Ref(String),
    Terminal(String),
    Literal(Term),
    ScalarRange(Term, Term),
    /// A range `'a'..'z'`: its two ends, character tags in their canonical
    /// spelling, the start not above the end (engine §1).
    Range(String, String),
    /// A property `'\p{Name}'`, by its name (engine §1).
    Property(String),
    Capture(String, Box<Expr>),
    /// A tested symbol, such as `X="s"`: its comparator, `=`, `≠`, `⊇`,
    /// `⊉`, `∩=∅` or `∩≠∅`, its value, a closed term, and its symbol, a
    /// `Ref` other than `#`, a `Terminal`, a `Range` or a `Property`
    /// (engine §2, §4).
    Tested(String, Term, Box<Expr>),
    Empty,
}

/// The marker of an optional (engine §3.8): none, `+` for an elidable
/// optional.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Mark {
    Plain,
    Elidable,
}

/// The direction of a chain (engine §3.3): `{... x \ s}` nests from the
/// left, `{x ... \ s}` from the right.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Chain {
    Left,
    Right,
}

/// A term, or a span: `{"capture":"x"}` and the calls `head`, `tail`,
/// `last`, `from` and `after` are spans, and appear only where a span is
/// expected. The capture named `""` is `$`, the whole constituent.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Term {
    Pattern(Box<crate::patterns::Pattern>),
    /// A string, decoded.
    Str(String),
    /// A tag literal: the set of one tag, in its canonical spelling.
    Tag(String),
    /// A range `'a'..'z'`, the set of its character tags (engine §1).
    EmptySet,
    Union(Vec<Term>),
    Intersection(Vec<Term>),
    /// `a ∖ b`: the members of the first set that are not in the second.
    Difference(Box<Term>, Box<Term>),
    Call(String, Vec<Arg>),
    Capture(String),
    /// `A ⟹ t`: `t` where the condition holds, else the empty set.
    If(Box<Cond>, Box<Term>),
    /// A reference to a constant, by its name without `$`, and where it
    /// stands. Stitching replaces it with the constant's value (engine §2).
    Const(String, (usize, usize)),
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Arg {
    Term(Term),
    Rule(String),
    /// The second argument of `classify`, a classifier's name (engine §9).
    Classifier(String),
}

#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct BoundaryLocation {
    pub at: Option<(usize, usize)>,
    pub targets: Vec<(usize, usize)>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Cond {
    Compare(String, Term, Term),
    Matches(Term, String),
    /// `begins(s, R)`: whether a prefix of the span, possibly empty, parses
    /// as `R`.
    Begins(Term, String),
    /// `initial(s)`: whether the span begins where the parse's input does.
    Initial(Term),
    Final(Term),
    /// A complete-tree neighbor, with its direction and target choice.
    Boundary(bool, Term, Vec<String>, BoundaryLocation),
    Not(Box<Cond>),
    Any(Vec<Cond>),
    All(Vec<Cond>),
    /// `$x` standing as a condition: whether the production has the capture.
    Captured(String),
    /// `A ⟹ B`.
    If(Box<Cond>, Box<Cond>),
}

/// An item of an emission clause. A capture named `""` is `$`, the whole
/// constituent. `%emits ε` inserts a token, and `%erased` erases (§11).
/// A named capture, the item's carrier, can name attachment captures
/// before it and after it (§11).
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum EmitItem {
    Capture(String, Option<Term>, Attachments),
    Insert(Option<Term>, Channels),
}

/// An emission item's attachment captures (§11): the names, without `$`,
/// before its carrier and after it, in the order written.
#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct Attachments {
    pub before: Vec<String>,
    pub after: Vec<String>,
    pub strings: Channels,
}

/// The two recipes written on one owner. Each recipe is a concat term.
#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct Channels {
    pub value: Option<Term>,
    pub image: Option<Term>,
    pub value_at: Option<(usize, usize)>,
    pub image_at: Option<(usize, usize)>,
}

impl Attachments {
    /// Every attachment capture, before ones first, in order.
    pub(crate) fn names(&self) -> impl Iterator<Item = &str> {
        self.before.iter().chain(&self.after).map(String::as_str)
    }
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

pub(crate) fn dom_from_json(value: &Json, unicode: &Unicode) -> R<Dom> {
    dom_from_json_mode(value, unicode, false)
}
pub(crate) fn dom_from_json_mode(value: &Json, unicode: &Unicode, defer: bool) -> R<Dom> {
    if let Some(problem) = dom_problem(value, unicode) {
        return Err(problem.to_string());
    }
    let mut rules = array(value, "rules")?.iter().map(rule_from_json).collect::<R<Vec<_>>>()?;
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
    let constants = array(value, "constants")?
        .iter()
        .map(|constant| {
            Ok(ConstDef {
                name: string(constant, "name")?,
                redefine: string(constant, "op")? == "redefine",
                value: term_from_json(field(constant, "value")?)?,
                at: position(constant)?,
            })
        })
        .collect::<R<Vec<_>>>()?;
    let classifiers = array(value, "classifiers")?
        .iter()
        .map(|classifier| {
            Ok(ClassifierDef {
                name: string(classifier, "name")?,
                entries: array(classifier, "entries")?
                    .iter()
                    .map(|entry| {
                        Ok(Entry {
                            guards: array(entry, "guards")?.iter().map(guard_from_json).collect::<R<Vec<_>>>()?,
                            keys: array(entry, "keys")?.iter().map(term_from_json).collect::<R<Vec<_>>>()?,
                            adds: string(entry, "op")? == "∈",
                            class: string(entry, "class")?,
                            at: position(entry)?,
                        })
                    })
                    .collect::<R<Vec<_>>>()?,
                at: position(classifier)?,
            })
        })
        .collect::<R<Vec<_>>>()?;
    let implications = array(value, "implications")?
        .iter()
        .map(|implication| {
            Ok(ImplicationDef {
                antecedent: term_from_json(field(implication, "if")?)?,
                consequent: term_from_json(field(implication, "then")?)?,
                at: position(implication)?,
            })
        })
        .collect::<R<Vec<_>>>()?;
    // A definition the reader would refuse (engine §9).
    for rule in &mut rules {
        if let Some((problem, _)) = crate::boundary::definition_problem(rule) {
            return Err(problem);
        }
        if let Some(problem) = crate::clauses::definition_problem(rule) {
            if defer
                && deferred_emission_problem(&problem)
                && rule.alternatives.iter().any(|a| crate::ranked::contains_ranked(&a.expr))
            {
                rule.deferred_emission = Some(problem);
            } else {
                return Err(problem);
            }
        }
    }
    Ok(Dom { rules, directives, constants, classifiers, implications })
}

pub(crate) fn requirements_from_json(value: &Json) -> R<Term> {
    let items = array(value, "requirements")?
        .iter()
        .map(|requirement| {
            let value = term_from_json(field(requirement, "value")?)?;
            Ok(Arg::Term(if is_true(requirement.get("negated")) {
                Term::Call("forbid".into(), vec![Arg::Term(value)])
            } else {
                value
            }))
        })
        .collect::<R<Vec<_>>>()?;
    Ok(Term::Call("requirements".into(), items))
}

pub(crate) fn is_engine_tag(name: &str) -> bool {
    schema::engine_tag(name)
}

/// Engine literals retained by the complete tag clause, with occurrence
/// indexes. A filter removes provenance as well as membership (engine §1).
pub(crate) fn engine_literals(term: &Term) -> Vec<(String, usize)> {
    let mut pending = vec![(term, false)];
    let mut values: Vec<Vec<(String, usize)>> = Vec::new();
    let mut occurrence = 0;
    while let Some((term, ready)) = pending.pop() {
        if !ready {
            match term {
                Term::Tag(name) if is_engine_tag(name) => {
                    values.push(vec![(name.clone(), occurrence)]);
                    occurrence += 1;
                }
                Term::Union(items) | Term::Intersection(items) => {
                    pending.push((term, true));
                    pending.extend(items.iter().rev().map(|item| (item, false)));
                }
                Term::Difference(left, right) => {
                    pending.push((term, true));
                    pending.push((right, false));
                    pending.push((left, false));
                }
                Term::If(_, then) => pending.push((then, false)),
                _ => values.push(Vec::new()),
            }
        } else {
            match term {
                Term::Union(items) => {
                    let parts = values.split_off(values.len() - items.len());
                    values.push(parts.into_iter().flatten().collect());
                }
                Term::Intersection(items) => {
                    let parts = values.split_off(values.len() - items.len());
                    let retained = parts
                        .first()
                        .into_iter()
                        .flatten()
                        .map(|(name, _)| name)
                        .filter(|name| parts.iter().all(|part| part.iter().any(|(other, _)| other == *name)))
                        .cloned()
                        .collect::<FxSet<_>>();
                    values.push(parts.into_iter().flatten().filter(|(name, _)| retained.contains(name)).collect());
                }
                Term::Difference(..) => {
                    values.pop();
                }
                _ => unreachable!(),
            }
        }
    }
    values.pop().unwrap_or_default()
}

pub(crate) fn engine_scalar(name: &str) -> Option<char> {
    let digits = name.strip_prefix('_')?;
    if !(4..=6).contains(&digits.len()) || !digits.bytes().all(|c| c.is_ascii_digit() || (b'A'..=b'F').contains(&c)) {
        return None;
    }
    u32::from_str_radix(digits, 16).ok().and_then(char::from_u32)
}

pub(crate) fn method_alias(name: &str) -> &str {
    match name {
        "value" => "value",
        "source-text" => "text",
        "first-token" => "head",
        "tokens-after-first" => "tail",
        "last-token" => "last",
        "onward" => "from",
        "following-tokens" => "after",
        "starts-input" => "initial",
        _ => name,
    }
}

fn method_spelling(name: &str) -> &str {
    match name {
        "value" => "value",
        "text" => "source-text",
        "head" => "first-token",
        "tail" => "tokens-after-first",
        "last" => "last-token",
        "from" => "onward",
        "after" => "following-tokens",
        "initial" => "starts-input",
        _ => name,
    }
}

fn channels_from_json(value: &Json) -> R<Channels> {
    Ok(Channels {
        value: value.get("value").map(term_from_json).transpose()?,
        image: value.get("image").map(term_from_json).transpose()?,
        ..Channels::default()
    })
}

fn guard_from_json(guard: &Json) -> R<Guard> {
    Ok(Guard {
        feature: string(guard, "feature")?,
        kind: match string(guard, "kind")?.as_str() {
            "gate" => FeatureKind::Gate,
            "warning" => FeatureKind::Warning,
            _ => return Err("a bad guard".to_string()),
        },
        negated: field(guard, "negated")?.as_bool().ok_or("a bad guard")?,
    })
}

fn rule_from_json(value: &Json) -> R<RuleDef> {
    let op = match string(value, "op")?.as_str() {
        "define" => Op::Define,
        "redefine" => Op::Redefine,
        "extend" => Op::Extend,
        other => return Err(format!("an unknown rule op {other:?}")),
    };
    Ok(RuleDef {
        deferred_emission: None,
        name: string(value, "name")?,
        op,
        flags: array(value, "flags")?
            .iter()
            .map(|flag| flag.as_str().map(str::to_string).ok_or_else(|| "a malformed rule flag".to_string()))
            .collect::<R<Vec<_>>>()?,
        tags: value.get("tags").map(term_from_json).transpose()?,
        strings: channels_from_json(value)?,
        alternatives: array(value, "alternatives")?
            .iter()
            .map(|alternative| {
                Ok(Alternative {
                    guards: array(alternative, "guards")?.iter().map(guard_from_json).collect::<R<Vec<_>>>()?,
                    expr: expr_from_json(field(alternative, "expr")?)?,
                    tags: alternative.get("tags").map(term_from_json).transpose()?,
                    strings: channels_from_json(alternative)?,
                    ranked_locations: Default::default(),
                })
            })
            .collect::<R<Vec<_>>>()?,
        emit: value.get("emit").map(emit_from_json).transpose()?,
        conditions: array(value, "conditions")?.iter().map(cond_from_json).collect::<R<Vec<_>>>()?,
        erased: is_true(value.get("erased")),
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
    // A tested symbol is known by its comparator, whatever the order of its
    // members.
    if value.get("test").is_some() {
        return Ok(Expr::Tested(
            string(value, "test")?,
            if string(value, "test")? == "tags" {
                requirements_from_json(value)?
            } else {
                term_from_json(field(value, "value")?)?
            },
            Box::new(expr_from_json(field(value, "expr")?)?),
        ));
    }
    let list = |key: &str| -> R<Vec<Expr>> { array(value, key)?.iter().map(expr_from_json).collect() };
    Ok(match first_key(value)? {
        "seq" => Expr::Seq(list("seq")?),
        "choice" => Expr::Choice(list("choice")?),
        "ranked" => Expr::Ranked(list("ranked")?),
        "and" => Expr::And(list("and")?),
        "optional" => {
            let mark = if is_true(value.get("elidable")) { Mark::Elidable } else { Mark::Plain };
            Expr::Optional(Box::new(expr_from_json(field(value, "optional")?)?), mark)
        }
        "repeat" => {
            let separator = value.get("separator").map(expr_from_json).transpose()?.map(Box::new);
            let chain = match value.get("chain").and_then(Json::as_str) {
                None => None,
                Some("left") => Some(Chain::Left),
                Some("right") => Some(Chain::Right),
                Some(_) => return Err("a bad chain".to_string()),
            };
            Expr::Repeat(Box::new(expr_from_json(field(value, "repeat")?)?), separator, chain)
        }
        "ref" => Expr::Ref(string(value, "ref")?),
        "literal" => Expr::Literal(term_from_json(field(value, "literal")?)?),
        "wildcard" => Expr::Property("Any".into()),
        "range" => match array(value, "range")? {
            [start, end] => Expr::ScalarRange(term_from_json(start)?, term_from_json(end)?),
            _ => return Err("a range requires two string terms".into()),
        },
        "capture" => Expr::Capture(string(value, "capture")?, Box::new(expr_from_json(field(value, "expr")?)?)),
        "empty" => Expr::Empty,
        other => return Err(format!("an unknown expression {other:?}")),
    })
}

/// A range's two ends, from `{"range":[START,END]}`.
pub(crate) fn term_from_json(value: &Json) -> R<Term> {
    match read_value(value, false)? {
        ReadValue::Term(term) => Ok(term),
        _ => unreachable!(),
    }
}

fn cond_from_json(value: &Json) -> R<Cond> {
    match read_value(value, true)? {
        ReadValue::Cond(cond) => Ok(cond),
        _ => unreachable!(),
    }
}

enum ReadValue {
    Term(Term),
    Cond(Cond),
}
impl ReadValue {
    fn term(self) -> Term {
        match self {
            Self::Term(term) => term,
            _ => unreachable!(),
        }
    }
    fn cond(self) -> Cond {
        match self {
            Self::Cond(cond) => cond,
            _ => unreachable!(),
        }
    }
}

/// Conversion moves finished operands once. Deep legal DOMs need no deep stack.
fn read_value(root: &Json, condition: bool) -> R<ReadValue> {
    let mut pending = vec![(root, condition, false)];
    let mut values: Vec<ReadValue> = Vec::new();
    while let Some((value, condition, ready)) = pending.pop() {
        let key = first_key(value)?;
        let mut children = Vec::new();
        if condition {
            match key {
                "op" => {
                    children.push((field(value, "left")?, false));
                    children.push((field(value, "right")?, false));
                }
                "method" => children.push((field(value, "receiver")?, false)),
                "not" => children.push((field(value, "not")?, true)),
                "any" | "all" => children.extend(array(value, key)?.iter().map(|child| (child, true))),
                "if" => {
                    children.push((field(value, "if")?, true));
                    children.push((field(value, "then")?, true));
                }
                "captured" => {}
                _ => return Err(format!("an unknown condition {key:?}")),
            }
        } else {
            match key {
                "union" | "intersection" | "difference" | "interpolate" | "concat" => {
                    children.extend(array(value, key)?.iter().map(|child| (child, false)))
                }
                "if" => {
                    children.push((field(value, "if")?, true));
                    children.push((field(value, "then")?, false));
                }
                "method" => {
                    children.push((field(value, "receiver")?, false));
                    children.extend(
                        array(value, "args")?
                            .iter()
                            .filter(|arg| arg.get("rule").is_none() && arg.get("classifier").is_none())
                            .map(|arg| (arg, false)),
                    );
                }
                "pattern" | "string" | "tag" | "emptySet" | "capture" | "const" => {}
                _ => return Err(format!("an unknown term {key:?}")),
            }
        }
        if !ready {
            pending.push((value, condition, true));
            pending.extend(children.iter().rev().map(|&(child, condition)| (child, condition, false)));
            continue;
        }
        let mut operands = values.split_off(values.len() - children.len()).into_iter();
        let built = if condition {
            ReadValue::Cond(match key {
                "op" => Cond::Compare(
                    string(value, "op")?,
                    operands.next().unwrap().term(),
                    operands.next().unwrap().term(),
                ),
                "method" => {
                    let receiver = operands.next().unwrap().term();
                    let name = string(value, "method")?;
                    match (name.as_str(), array(value, "args")?) {
                        ("starts-input", []) => Cond::Initial(receiver),
                        ("ends-input", []) => Cond::Final(receiver),
                        ("followed-by" | "preceded-by", args) => Cond::Boundary(
                            name == "followed-by",
                            receiver,
                            args.iter()
                                .map(|arg| string(arg, if arg.get("rule").is_some() { "rule" } else { "terminal" }))
                                .collect::<R<Vec<_>>>()?,
                            BoundaryLocation::default(),
                        ),
                        ("matches", [arg]) => Cond::Matches(receiver, string(arg, "rule")?),
                        ("begins", [arg]) => Cond::Begins(receiver, string(arg, "rule")?),
                        _ => return Err("a malformed predicate method".into()),
                    }
                }
                "not" => Cond::Not(Box::new(operands.next().unwrap().cond())),
                "any" => Cond::Any(operands.map(ReadValue::cond).collect()),
                "all" => Cond::All(operands.map(ReadValue::cond).collect()),
                "captured" => Cond::Captured(string(value, "captured")?),
                "if" => Cond::If(Box::new(operands.next().unwrap().cond()), Box::new(operands.next().unwrap().cond())),
                _ => unreachable!(),
            })
        } else {
            ReadValue::Term(match key {
                "pattern" => Term::Pattern(Box::new(crate::patterns::Pattern::from_json(field(value, "pattern")?)?)),
                "string" => Term::Str(string(value, "string")?),
                "tag" => Term::Tag(string(value, "tag")?),
                "emptySet" => Term::EmptySet,
                "capture" => Term::Capture(string(value, "capture")?),
                "const" => Term::Const(string(value, "const")?, position(value)?),
                "union" => Term::Union(operands.map(ReadValue::term).collect()),
                "intersection" => Term::Intersection(operands.map(ReadValue::term).collect()),
                "difference" => {
                    let left = operands.next().ok_or("a difference lacks its left operand")?.term();
                    let right = operands.next().ok_or("a difference lacks its right operand")?.term();
                    Term::Difference(Box::new(left), Box::new(right))
                }
                "if" => Term::If(Box::new(operands.next().unwrap().cond()), Box::new(operands.next().unwrap().term())),
                "interpolate" | "concat" => {
                    Term::Call(key.into(), operands.map(|value| Arg::Term(value.term())).collect())
                }
                "method" => {
                    let mut args = vec![Arg::Term(operands.next().unwrap().term())];
                    for arg in array(value, "args")? {
                        args.push(match (arg.get("rule"), arg.get("classifier")) {
                            (Some(Json::Str(name)), _) => Arg::Rule(name.clone()),
                            (_, Some(Json::Str(name))) => Arg::Classifier(name.clone()),
                            _ => Arg::Term(operands.next().unwrap().term()),
                        });
                    }
                    Term::Call(method_alias(&string(value, "method")?).into(), args)
                }
                _ => unreachable!(),
            })
        };
        values.push(built);
    }
    Ok(values.pop().expect("the root value"))
}

fn emit_from_json(value: &Json) -> R<Vec<EmitItem>> {
    array(value, "items")?
        .iter()
        .map(|item| {
            let tags = item.get("tags").map(term_from_json).transpose()?;
            if let Some(Json::Str(name)) = item.get("capture") {
                let names = |key: &str| -> R<Vec<String>> {
                    match item.get(key) {
                        None => Ok(Vec::new()),
                        Some(list) => list
                            .as_array()
                            .ok_or_else(|| "a malformed attachment".to_string())?
                            .iter()
                            .map(|name| {
                                name.as_str().map(str::to_string).ok_or_else(|| "a malformed attachment".to_string())
                            })
                            .collect(),
                    }
                };
                let attachments = Attachments {
                    before: names("before")?,
                    after: names("after")?,
                    strings: channels_from_json(item)?,
                };
                Ok(EmitItem::Capture(name.clone(), tags, attachments))
            } else if is_true(item.get("insert")) {
                Ok(EmitItem::Insert(tags, channels_from_json(item)?))
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

fn is_str(value: Option<&Json>) -> bool {
    matches!(value, Some(Json::Str(_)))
}

fn is_true(value: Option<&Json>) -> bool {
    matches!(value, Some(Json::Bool(true)))
}

fn is_position(value: Option<&Json>) -> bool {
    matches!(value.and_then(Json::as_array), Some([Json::Int(line), Json::Int(column)]) if *line > 0 && *column > 0)
}

/// A rule's name: a name, or `#`, the free-modifier slot (engine §2).
pub(crate) fn is_capture_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

fn is_rule_arg(value: &Json) -> bool {
    matches!(value.as_object(), Some([(key, Json::Str(_))]) if key == "rule")
}

/// The second argument of `classify`: a classifier's name, and no other
/// member (engine §9).
fn is_classifier_arg(value: &Json) -> bool {
    matches!(value.as_object(), Some([(key, Json::Str(name))]) if key == "classifier" && is_classifier_name(name))
}

/// The comparators of a test in a body (engine §2): the two sound tests
/// and the four tag tests.
pub(crate) const TEST_OPS: [&str; 3] = ["=", "≠", "tags"];

/// Whether a test's comparator is a sound test, whose value is a string,
/// rather than a tag test, whose value is a tag set (engine §2).
pub(crate) fn is_sound_test(op: &str) -> bool {
    op == "=" || op == "≠"
}

/// The type of a test's value: a string for a sound test, and a tag set
/// for a tag test (engine §2).
pub(crate) fn test_value_type(op: &str) -> Type {
    if is_sound_test(op) {
        Type::String
    } else {
        Type::Tags
    }
}

/// Why a term of type `ty` cannot be the value of a test with the
/// comparator `op`, or `None` (engine §9, §10).
pub(crate) fn test_type_problem(op: &str, ty: Type) -> Option<String> {
    let expected = test_value_type(op);
    expected_problem(ty, expected).map(|problem| format!("{op} tests {}: {problem}", expected.name()))
}

fn elidable_head_json(expr: &Json) -> Option<&Json> {
    let head = match expr.get("seq").and_then(Json::as_array) {
        Some([head, ..]) => head,
        _ => expr,
    };
    let mut base = head;
    while base.get("test").and_then(Json::as_str).is_some_and(|op| TEST_OPS.contains(&op)) {
        base = base.get("expr")?;
    }
    match base.get("ref").and_then(Json::as_str) {
        Some(tag) if tag.starts_with(|c: char| c.is_ascii_uppercase()) => Some(head),
        _ => None,
    }
}

/// A literal empty split delimiter is a document error (engine §9).
pub(crate) fn literal_call_problem(call: &str, args: &[Arg]) -> Option<&'static str> {
    fn literal(arg: Option<&Arg>) -> Option<&str> {
        match arg {
            Some(Arg::Term(Term::Str(text))) => Some(text),
            _ => None,
        }
    }
    match call {
        "split" if literal(args.get(1)) == Some("") => Some("split has an empty delimiter"),
        _ => None,
    }
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
        out.push(']');
        out.push_str(&format!(",\"at\":[{},{}]}}", directive.at.0, directive.at.1));
    }
    out.push_str("],\"constants\":[");
    for (index, constant) in dom.constants.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        out.push_str("{\"name\":");
        write_str(&mut out, &constant.name);
        out.push_str(if constant.redefine { ",\"op\":\"redefine\"" } else { ",\"op\":\"define\"" });
        out.push_str(",\"value\":");
        write_term(&mut out, &constant.value);
        out.push_str(&format!(",\"at\":[{},{}]}}", constant.at.0, constant.at.1));
    }
    out.push_str("],\"classifiers\":[");
    for (index, classifier) in dom.classifiers.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        out.push_str("{\"name\":");
        write_str(&mut out, &classifier.name);
        out.push_str(",\"entries\":[");
        for (index, entry) in classifier.entries.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            out.push_str("{\"guards\":[");
            for (index, guard) in entry.guards.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_guard(&mut out, guard);
            }
            out.push_str("],\"keys\":[");
            for (index, key) in entry.keys.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_term(&mut out, key);
            }
            out.push_str(if entry.adds { "],\"op\":\"∈\",\"class\":" } else { "],\"op\":\"∉\",\"class\":" });
            write_str(&mut out, &entry.class);
            out.push_str(&format!(",\"at\":[{},{}]}}", entry.at.0, entry.at.1));
        }
        out.push_str(&format!("],\"at\":[{},{}]}}", classifier.at.0, classifier.at.1));
    }
    out.push_str("],\"implications\":[");
    for (index, implication) in dom.implications.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        out.push_str("{\"if\":");
        write_term(&mut out, &implication.antecedent);
        out.push_str(",\"then\":");
        write_term(&mut out, &implication.consequent);
        out.push_str(&format!(",\"at\":[{},{}]}}", implication.at.0, implication.at.1));
    }
    out.push_str("]}");
    out
}

pub(crate) fn write_rule(out: &mut String, rule: &RuleDef) {
    out.push_str("{\"name\":");
    write_str(out, &rule.name);
    out.push_str(match rule.op {
        Op::Define => ",\"op\":\"define\"",
        Op::Redefine => ",\"op\":\"redefine\"",
        Op::Extend => ",\"op\":\"extend\"",
    });
    out.push_str(",\"flags\":[");
    for (index, flag) in rule.flags.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        write_str(out, flag);
    }
    out.push(']');
    if let Some(tags) = &rule.tags {
        out.push_str(",\"tags\":");
        write_term(out, tags);
    }
    write_channels(out, &rule.strings);
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
            write_guard(out, guard);
        }
        out.push_str("],\"expr\":");
        write_expr(out, &alternative.expr);
        if let Some(tags) = &alternative.tags {
            out.push_str(",\"tags\":");
            write_term(out, tags);
        }
        write_channels(out, &alternative.strings);
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
                EmitItem::Capture(name, tags, attachments) => {
                    out.push_str("{\"capture\":");
                    write_str(out, name);
                    if let Some(tags) = tags {
                        out.push_str(",\"tags\":");
                        write_term(out, tags);
                    }
                    write_channels(out, &attachments.strings);
                    for (key, names) in [("before", &attachments.before), ("after", &attachments.after)] {
                        if !names.is_empty() {
                            out.push_str(&format!(",\"{key}\":["));
                            for (index, name) in names.iter().enumerate() {
                                if index > 0 {
                                    out.push(',');
                                }
                                write_str(out, name);
                            }
                            out.push(']');
                        }
                    }
                }
                EmitItem::Insert(tags, strings) => {
                    out.push_str("{\"insert\":true");
                    if let Some(tags) = tags {
                        out.push_str(",\"tags\":");
                        write_term(out, tags);
                    }
                    write_channels(out, strings);
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
    out.push(']');
    if rule.erased {
        out.push_str(",\"erased\":true");
    }
    out.push_str(&format!(",\"at\":[{},{}]}}", rule.at.0, rule.at.1));
}

fn write_channels(out: &mut String, channels: &Channels) {
    for (name, recipe) in [("value", &channels.value), ("image", &channels.image)] {
        if let Some(recipe) = recipe {
            out.push_str(&format!(",\"{name}\":"));
            write_term(out, recipe);
        }
    }
}

fn write_guard(out: &mut String, guard: &Guard) {
    out.push_str("{\"feature\":");
    write_str(out, &guard.feature);
    out.push_str(match guard.kind {
        FeatureKind::Gate => ",\"kind\":\"gate\"",
        FeatureKind::Warning => ",\"kind\":\"warning\"",
    });
    out.push_str(if guard.negated { ",\"negated\":true}" } else { ",\"negated\":false}" });
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

pub(crate) fn write_expr(out: &mut String, expr: &Expr) {
    match expr {
        Expr::Seq(items) => write_list(out, "seq", items, write_expr),
        Expr::Choice(items) => write_list(out, "choice", items, write_expr),
        Expr::Ranked(items) => write_list(out, "ranked", items, write_expr),
        Expr::And(items) => write_list(out, "and", items, write_expr),
        Expr::Optional(inner, mark) => {
            out.push_str("{\"optional\":");
            write_expr(out, inner);
            out.push_str(match mark {
                Mark::Plain => "}",
                Mark::Elidable => ",\"elidable\":true}",
            });
        }
        Expr::Repeat(item, separator, chain) => {
            out.push_str("{\"repeat\":");
            write_expr(out, item);
            if let Some(separator) = separator {
                out.push_str(",\"separator\":");
                write_expr(out, separator);
            }
            out.push_str(match chain {
                None => "}",
                Some(Chain::Left) => ",\"chain\":\"left\"}",
                Some(Chain::Right) => ",\"chain\":\"right\"}",
            });
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
        Expr::Literal(term) => {
            out.push_str("{\"literal\":");
            write_term(out, term);
            out.push('}');
        }
        Expr::ScalarRange(start, end) => {
            out.push_str("{\"range\":[");
            write_term(out, start);
            out.push(',');
            write_term(out, end);
            out.push_str("]}");
        }
        Expr::Range(start, end) => write_range(out, start, end),
        Expr::Property(_) => out.push_str("{\"wildcard\":true}"),
        Expr::Capture(name, inner) => {
            out.push_str("{\"capture\":");
            write_str(out, name);
            out.push_str(",\"expr\":");
            write_expr(out, inner);
            out.push('}');
        }
        Expr::Tested(op, value, inner) => {
            out.push_str("{\"test\":");
            write_str(out, op);
            if op == "tags" {
                out.push_str(",\"requirements\":");
                write_requirements(out, value);
            } else {
                out.push_str(",\"value\":");
                write_term(out, value);
            }
            out.push_str(",\"expr\":");
            write_expr(out, inner);
            out.push('}');
        }
        Expr::Empty => out.push_str("{\"empty\":true}"),
    }
}

fn write_range(out: &mut String, start: &str, end: &str) {
    out.push_str("{\"range\":[");
    write_str(out, start);
    out.push(',');
    write_str(out, end);
    out.push_str("]}");
}

pub(crate) fn write_term(out: &mut String, term: &Term) {
    match term {
        Term::Pattern(p) => {
            out.push_str("{\"pattern\":");
            p.write(out);
            out.push('}');
        }
        Term::Str(text) => {
            out.push_str("{\"string\":");
            write_str(out, text);
            out.push('}');
        }
        Term::Tag(tag) => {
            out.push_str("{\"tag\":");
            write_str(out, tag);
            out.push('}');
        }
        Term::EmptySet => out.push_str("{\"emptySet\":true}"),
        Term::Union(items) => write_list(out, "union", items, write_term),
        Term::Intersection(items) => write_list(out, "intersection", items, write_term),
        Term::Difference(left, right) => {
            out.push_str("{\"difference\":[");
            write_term(out, left);
            out.push(',');
            write_term(out, right);
            out.push_str("]}");
        }
        Term::Capture(name) => {
            out.push_str("{\"capture\":");
            write_str(out, name);
            out.push('}');
        }
        Term::Const(name, at) => {
            out.push_str("{\"const\":");
            write_str(out, name);
            out.push_str(&format!(",\"at\":[{},{}]}}", at.0, at.1));
        }
        Term::If(cond, then) => {
            out.push_str("{\"if\":");
            write_cond(out, cond);
            out.push_str(",\"then\":");
            write_term(out, then);
            out.push('}');
        }
        Term::Call(name, args) => {
            if matches!(name.as_str(), "concat" | "interpolate") {
                write_list(out, name, args, write_argument);
            } else {
                out.push_str("{\"method\":");
                write_str(out, method_spelling(name));
                out.push_str(",\"receiver\":");
                write_argument(out, &args[0]);
                out.push_str(",\"args\":[");
                for (index, arg) in args[1..].iter().enumerate() {
                    if index > 0 {
                        out.push(',');
                    }
                    write_argument(out, arg);
                }
                out.push_str("]}");
            }
        }
    }
}

fn write_argument(out: &mut String, arg: &Arg) {
    match arg {
        Arg::Term(term) => write_term(out, term),
        Arg::Rule(name) | Arg::Classifier(name) => {
            out.push_str(if matches!(arg, Arg::Rule(_)) { "{\"rule\":" } else { "{\"classifier\":" });
            write_str(out, name);
            out.push('}');
        }
    }
}

pub(crate) fn write_requirements(out: &mut String, term: &Term) {
    let Term::Call(_, args) = term else { unreachable!("a signed requirement list") };
    out.push('[');
    for (index, arg) in args.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        let Arg::Term(term) = arg else { unreachable!() };
        let (negative, value) = match term {
            Term::Call(name, args) if name == "forbid" => {
                let Arg::Term(value) = &args[0] else { unreachable!() };
                (true, value)
            }
            _ => (false, term),
        };
        out.push_str(if negative { "{\"negated\":true,\"value\":" } else { "{\"negated\":false,\"value\":" });
        write_term(out, value);
        out.push('}');
    }
    out.push(']');
}

pub(crate) fn write_cond(out: &mut String, cond: &Cond) {
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
        Cond::Matches(span, rule) | Cond::Begins(span, rule) => {
            let name = if matches!(cond, Cond::Matches(..)) { "matches" } else { "begins" };
            write_term(out, &Term::Call(name.into(), vec![Arg::Term(span.clone()), Arg::Rule(rule.clone())]));
        }
        Cond::Initial(span) => write_term(out, &Term::Call("initial".into(), vec![Arg::Term(span.clone())])),
        Cond::Final(span) => write_term(out, &Term::Call("ends-input".into(), vec![Arg::Term(span.clone())])),
        Cond::Boundary(forward, receiver, targets, _) => {
            out.push_str("{\"method\":");
            write_str(out, if *forward { "followed-by" } else { "preceded-by" });
            out.push_str(",\"receiver\":");
            write_term(out, receiver);
            out.push_str(",\"args\":[");
            for (index, target) in targets.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                out.push_str(if target.starts_with(|c: char| c.is_ascii_uppercase()) {
                    "{\"terminal\":"
                } else {
                    "{\"rule\":"
                });
                write_str(out, target);
                out.push('}');
            }
            out.push_str("]}");
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

// ---- types (engine §10)

/// A term's type: a string, a set of strings, a tag set, a span, a set
/// whose kind nothing has given yet, such as `∅`, or, for a constant whose
/// type the reader cannot know, any type but a span (engine §9).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Type {
    Pattern,
    String,
    Strings,
    Tags,
    Span,
    Set,
    Any,
}

impl Type {
    pub(crate) fn name(self) -> &'static str {
        match self {
            Type::Pattern => "a pattern",
            Type::String => "a string",
            Type::Strings => "a set of strings",
            Type::Tags => "a tag set",
            Type::Span => "a span",
            Type::Set => "a set",
            Type::Any => "a value",
        }
    }
}

/// The type of each constant, where the loader knows it (engine §2). The
/// reader knows none, and gives every constant the type `Any`.
pub(crate) type ConstantTypes<'a> = &'a dyn Fn(&str) -> Type;

/// A disagreement of types (engine §10): the problem, and where the first
/// constant of the smallest construct that holds it stands, if it holds
/// one. The loader reports the error there (engine §9).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Fault {
    pub problem: String,
    pub at: Option<(usize, usize)>,
}

impl Fault {
    fn in_term(problem: String, term: &Term) -> Fault {
        Fault { problem, at: first_constant_in_term(term) }
    }

    fn in_cond(problem: String, cond: &Cond) -> Fault {
        Fault { problem, at: first_constant_in_cond(cond) }
    }
}

/// The references to constants in a term, in the order written.
pub(crate) fn constants_in_term<'t>(term: &'t Term, out: &mut Vec<(&'t str, (usize, usize))>) {
    constants_in(Nested::Term(term), out, false);
}

/// The references to constants in a condition, in the order written.
pub(crate) fn constants_in_cond<'t>(cond: &'t Cond, out: &mut Vec<(&'t str, (usize, usize))>) {
    constants_in(Nested::Cond(cond), out, false);
}

/// The references to constants of a part, in the order written, with an
/// explicit stack.
fn constants_in<'t>(start: Nested<'t>, out: &mut Vec<(&'t str, (usize, usize))>, engine: bool) {
    let mut stack = vec![start];
    while let Some(part) = stack.pop() {
        crate::work::count(crate::work::Work::Walked, 1);
        match part {
            Nested::Term(term) => match term {
                Term::Pattern(p) => {
                    if engine {
                        p.references(out)
                    } else {
                        p.constants(out)
                    }
                }
                Term::Const(name, at) if engine || !name.starts_with('_') => out.push((name, *at)),
                Term::Const(..) => {}
                Term::Union(items) | Term::Intersection(items) => stack.extend(items.iter().rev().map(Nested::Term)),
                Term::Difference(left, right) => stack.extend([Nested::Term(right), Nested::Term(left)]),
                Term::If(cond, then) => stack.extend([Nested::Term(then), Nested::Cond(cond)]),
                Term::Call(_, args) => stack.extend(args.iter().rev().filter_map(|arg| match arg {
                    Arg::Term(term) => Some(Nested::Term(term)),
                    _ => None,
                })),
                Term::Str(_) | Term::Tag(_) | Term::EmptySet | Term::Capture(_) => {}
            },
            Nested::Cond(cond) => match cond {
                Cond::Compare(_, left, right) => stack.extend([Nested::Term(right), Nested::Term(left)]),
                Cond::Not(inner) => stack.push(Nested::Cond(inner)),
                Cond::Any(items) | Cond::All(items) => stack.extend(items.iter().rev().map(Nested::Cond)),
                Cond::If(antecedent, consequent) => stack.extend([Nested::Cond(consequent), Nested::Cond(antecedent)]),
                Cond::Matches(span, _)
                | Cond::Begins(span, _)
                | Cond::Initial(span)
                | Cond::Final(span)
                | Cond::Boundary(_, span, _, _) => stack.push(Nested::Term(span)),
                Cond::Captured(_) => {}
            },
            // Pattern references are handled through Term::Pattern above.
            Nested::Expr(_) | Nested::Pattern(_) | Nested::Children(_) => {}
        }
    }
}

/// The most compound nodes that may stand above a node of an expression,
/// a term or a condition (engine §9).
const MAX_NESTING: usize = DOM_MAX_DEPTH;

/// A node of a DOM that the check of nesting walks.
enum Nested<'d> {
    Expr(&'d Expr),
    Term(&'d Term),
    Cond(&'d Cond),
    Pattern(&'d crate::patterns::Pattern),
    Children(&'d crate::patterns::Children),
}

/// Whether any DOM node exceeds the depth bound of engine §9.
/// Literal and range wrappers keep their string terms at the same depth.
/// All compound constructors, including pattern constructors, add one.
fn too_deep<'d>(roots: Vec<Nested<'d>>) -> bool {
    let mut stack: Vec<(Nested<'d>, usize)> = roots.into_iter().map(|root| (root, 0)).collect();
    while let Some((node, depth)) = stack.pop() {
        crate::work::count(crate::work::Work::Walked, 1);
        if depth > MAX_NESTING {
            return true;
        }
        let below = depth + 1;
        match node {
            Nested::Expr(expr) => match expr {
                Expr::Seq(items) | Expr::Choice(items) | Expr::Ranked(items) | Expr::And(items) => {
                    stack.extend(items.iter().map(|item| (Nested::Expr(item), below)))
                }
                Expr::Optional(inner, _) | Expr::Capture(_, inner) => stack.push((Nested::Expr(inner), below)),
                Expr::Repeat(item, separator, _) => {
                    stack.push((Nested::Expr(item), below));
                    stack.extend(separator.as_deref().map(|separator| (Nested::Expr(separator), below)));
                }
                Expr::Tested(_, value, inner) => {
                    stack.push((Nested::Term(value), below));
                    stack.push((Nested::Expr(inner), below));
                }
                Expr::Literal(term) => stack.push((Nested::Term(term), depth)),
                Expr::ScalarRange(a, b) => {
                    stack.push((Nested::Term(a), depth));
                    stack.push((Nested::Term(b), depth));
                }
                Expr::Ref(_) | Expr::Terminal(_) | Expr::Range(..) | Expr::Property(_) | Expr::Empty => {}
            },
            Nested::Term(term) => match term {
                Term::Union(items) | Term::Intersection(items) => {
                    stack.extend(items.iter().map(|item| (Nested::Term(item), below)))
                }
                Term::Difference(left, right) => {
                    stack.push((Nested::Term(left), below));
                    stack.push((Nested::Term(right), below));
                }
                Term::If(cond, then) => {
                    stack.push((Nested::Cond(cond), below));
                    stack.push((Nested::Term(then), below));
                }
                // A rule or a classifier that a call names is no node of it.
                Term::Call(name, args) => {
                    // Signed requirement records are metadata, not DOM constructors.
                    let child_depth = if matches!(name.as_str(), "requirements" | "forbid") { depth } else { below };
                    stack.extend(args.iter().filter_map(|arg| match arg {
                        Arg::Term(term) => Some((Nested::Term(term), child_depth)),
                        Arg::Rule(_) | Arg::Classifier(_) => None,
                    }));
                }
                Term::Pattern(pattern) => stack.push((Nested::Pattern(pattern), below)),
                Term::Str(_) | Term::Tag(_) | Term::EmptySet | Term::Capture(_) | Term::Const(..) => {}
            },
            Nested::Pattern(pattern) => {
                use crate::patterns::Pattern;
                match pattern {
                    Pattern::Literal(term, _) => stack.push((Nested::Term(term), depth)),
                    Pattern::Range(a, b, _) => {
                        stack.push((Nested::Term(a), depth));
                        stack.push((Nested::Term(b), depth));
                    }
                    Pattern::Test(_, value, inner) => {
                        stack.push((Nested::Term(value), below));
                        stack.push((Nested::Pattern(inner), below));
                    }
                    Pattern::Children(children) => stack.push((Nested::Children(children), below)),
                    Pattern::Path(_, inner) => stack.push((Nested::Pattern(inner), below)),
                    Pattern::Union(items) | Pattern::Intersection(items) => {
                        stack.extend(items.iter().map(|item| (Nested::Pattern(item), below)));
                    }
                    Pattern::Difference(a, b) => {
                        stack.push((Nested::Pattern(a), below));
                        stack.push((Nested::Pattern(b), below));
                    }
                    Pattern::Name(..) | Pattern::Terminal(..) | Pattern::Wildcard(..) | Pattern::Constant(..) => {}
                }
            }
            Nested::Children(children) => {
                use crate::patterns::Children;
                match children {
                    Children::Node(pattern) => stack.push((Nested::Pattern(pattern), below)),
                    Children::Sequence(items) => stack.extend(items.iter().map(|item| (Nested::Children(item), below))),
                    Children::Optional(inner) => stack.push((Nested::Children(inner), below)),
                    Children::Repeat(inner, separator) => {
                        stack.push((Nested::Children(inner), below));
                        stack.extend(separator.as_deref().map(|separator| (Nested::Children(separator), below)));
                    }
                    Children::Siblings => {}
                }
            }
            Nested::Cond(cond) => match cond {
                Cond::Any(items) | Cond::All(items) => {
                    stack.extend(items.iter().map(|item| (Nested::Cond(item), below)))
                }
                Cond::Not(inner) => stack.push((Nested::Cond(inner), below)),
                Cond::If(antecedent, consequent) => {
                    stack.push((Nested::Cond(antecedent), below));
                    stack.push((Nested::Cond(consequent), below));
                }
                Cond::Matches(span, _)
                | Cond::Begins(span, _)
                | Cond::Initial(span)
                | Cond::Final(span)
                | Cond::Boundary(_, span, _, _) => stack.push((Nested::Term(span), below)),
                Cond::Compare(_, left, right) => {
                    stack.push((Nested::Term(left), below));
                    stack.push((Nested::Term(right), below));
                }
                Cond::Captured(_) => {}
            },
        }
    }
    false
}

/// Whether a rule holds a node below more than 256 compound nodes.
pub(crate) fn rule_too_deep(rule: &RuleDef) -> bool {
    let mut roots: Vec<Nested> = Vec::new();
    roots.extend(rule.tags.iter().map(Nested::Term));
    roots.extend(rule.strings.value.iter().chain(&rule.strings.image).map(Nested::Term));
    for alternative in &rule.alternatives {
        roots.push(Nested::Expr(&alternative.expr));
        roots.extend(alternative.tags.iter().map(Nested::Term));
        roots.extend(alternative.strings.value.iter().chain(&alternative.strings.image).map(Nested::Term));
    }
    for item in rule.emit.iter().flatten() {
        let (tags, strings) = match item {
            EmitItem::Capture(_, tags, attachments) => (tags, &attachments.strings),
            EmitItem::Insert(tags, strings) => (tags, strings),
        };
        roots.extend(tags.iter().map(Nested::Term));
        roots.extend(strings.value.iter().chain(&strings.image).map(Nested::Term));
    }
    roots.extend(rule.conditions.iter().map(Nested::Cond));
    too_deep(roots)
}

/// Whether a term holds a node below more than 256 compound nodes.
pub(crate) fn term_too_deep(term: &Term) -> bool {
    too_deep(vec![Nested::Term(term)])
}

/// The tested symbols of an expression, in the order written: each
/// comparator, value and symbol.
pub(crate) fn tests_in(expr: &Expr) -> Vec<(&str, &Term, &Expr)> {
    let mut found = Vec::new();
    let mut stack = vec![expr];
    while let Some(current) = stack.pop() {
        match current {
            Expr::Seq(items) | Expr::Choice(items) | Expr::Ranked(items) | Expr::And(items) => {
                stack.extend(items.iter().rev())
            }
            Expr::Optional(inner, _) | Expr::Capture(_, inner) => stack.push(inner),
            // The item before the separator.
            Expr::Repeat(item, separator, _) => {
                stack.extend(separator.as_deref());
                stack.push(item);
            }
            Expr::Tested(op, value, inner) => {
                found.push((op.as_str(), value, inner.as_ref()));
                stack.push(inner);
            }
            Expr::Ref(_)
            | Expr::Terminal(_)
            | Expr::Literal(_)
            | Expr::ScalarRange(..)
            | Expr::Range(..)
            | Expr::Property(_)
            | Expr::Empty => {}
        }
    }
    found
}

/// The references to constants in a rule, in the order of its DOM: its
/// tags, its alternatives' tests and tags, its emission and its conditions.
pub(crate) fn constants_in_rule(rule: &RuleDef) -> Vec<(&str, (usize, usize))> {
    let mut out = Vec::new();
    for term in rule.tags.iter().chain(rule.strings.value.iter()).chain(&rule.strings.image) {
        references_in_term(term, &mut out);
    }
    for alternative in &rule.alternatives {
        let mut pending = vec![&alternative.expr];
        while let Some(expr) = pending.pop() {
            match expr {
                Expr::Literal(term) => references_in_term(term, &mut out),
                Expr::ScalarRange(a, b) => {
                    references_in_term(a, &mut out);
                    references_in_term(b, &mut out);
                }
                Expr::Tested(_, value, inner) => {
                    references_in_term(value, &mut out);
                    pending.push(inner);
                }
                Expr::Seq(xs) | Expr::Choice(xs) | Expr::Ranked(xs) | Expr::And(xs) => pending.extend(xs.iter().rev()),
                Expr::Capture(_, x) | Expr::Optional(x, _) => pending.push(x),
                Expr::Repeat(x, s, _) => {
                    pending.extend(s.as_deref());
                    pending.push(x);
                }
                _ => {}
            }
        }
        for term in alternative.tags.iter().chain(&alternative.strings.value).chain(&alternative.strings.image) {
            references_in_term(term, &mut out);
        }
    }
    for item in rule.emit.iter().flatten() {
        let (tags, strings) = match item {
            EmitItem::Capture(_, tags, a) => (tags, &a.strings),
            EmitItem::Insert(tags, s) => (tags, s),
        };
        for term in tags.iter().chain(&strings.value).chain(&strings.image) {
            references_in_term(term, &mut out);
        }
    }
    rule.conditions.iter().for_each(|cond| constants_in(Nested::Cond(cond), &mut out, true));
    out
}

pub(crate) fn references_in_term<'a>(root: &'a Term, out: &mut Vec<(&'a str, (usize, usize))>) {
    constants_in(Nested::Term(root), out, true);
    out.sort_by_key(|reference| reference.1);
}

pub(crate) fn first_constant_in_term(term: &Term) -> Option<(usize, usize)> {
    let mut out = Vec::new();
    references_in_term(term, &mut out);
    out.first().map(|&(_, at)| at)
}

fn first_constant_in_cond(cond: &Cond) -> Option<(usize, usize)> {
    let mut out = Vec::new();
    constants_in_cond(cond, &mut out);
    out.first().map(|&(_, at)| at)
}

const SPAN_NOT_VALUE: &str = "a span is not a value: tags($x) is the tag set of $x";

/// The type of the value a function gives (engine §10).
pub(crate) fn call_type(call: &str) -> Type {
    match call {
        "value" | "text" | "decomposed-source-text" | "image" | "verbatim-text" | "concat" | "interpolate" => {
            Type::String
        }
        "split" => Type::Strings,
        "tags" | "classes" | "classify" | "requirements" | "forbid" => Type::Tags,
        _ => Type::Span,
    }
}

/// The kind of sets joined by `∪`, `∩` or `∖`, or why they cannot be
/// joined: each is a set, and all whose kind is known have one kind. A
/// constant whose type is not known yet fits any set.
pub(crate) fn joined_type(types: &[Type], operator: &str) -> Result<Type, String> {
    if types.contains(&Type::Span) {
        return Err(SPAN_NOT_VALUE.to_string());
    }
    if let Some(bad) = types.iter().find(|&&ty| ty == Type::String) {
        return Err(format!("{operator} joins sets, not {}", bad.name()));
    }
    let patterns = types.contains(&Type::Pattern);
    if patterns {
        if types.iter().any(|t| !matches!(t, Type::Pattern | Type::Set | Type::Any)) {
            return Err(format!("{operator} joins sets of one kind, not patterns and another set"));
        }
        return Ok(Type::Pattern);
    }
    let strings = types.contains(&Type::Strings);
    let tags = types.contains(&Type::Tags);
    match (strings, tags) {
        (true, true) => Err(format!("{operator} joins two sets of one kind, not a set of strings and a tag set")),
        (true, false) => Ok(Type::Strings),
        (false, true) => Ok(Type::Tags),
        (false, false) if types.contains(&Type::Any) => Ok(Type::Any),
        (false, false) => Ok(Type::Set),
    }
}

/// Why a comparison's two sides do not fit its comparator, or `None`. A
/// side of type `Any` fits, and the loader checks it again (engine §9).
pub(crate) fn comparison_problem(op: &str, left: Type, right: Type) -> Option<String> {
    if matches!(op, "≅" | "≇") {
        return if left != Type::Span {
            Some("a tree comparison reads one bare capture".into())
        } else {
            expected_problem(right, Type::Pattern)
        };
    }
    if left == Type::Pattern || right == Type::Pattern {
        return Some("patterns use ≅ or ≇ for tree comparisons".into());
    }
    let left = if matches!(op, "=" | "≠" | "∈" | "∉") && left == Type::Span { Type::String } else { left };
    let right = if matches!(op, "=" | "≠") && right == Type::Span { Type::String } else { right };
    if left == Type::Span || right == Type::Span {
        return Some(SPAN_NOT_VALUE.to_string());
    }
    if matches!(op, "∈" | "∉") {
        if left != Type::String && left != Type::Any {
            return Some(format!(
                "{op} tests a string, not {}, in a set of strings; ⊆ and ⊈ compare two sets",
                left.name()
            ));
        }
        if !matches!(right, Type::Strings | Type::Set | Type::Any) {
            return Some(format!("{op} tests a string in a set of strings, not in {}", right.name()));
        }
        return None;
    }
    if matches!(op, "=" | "≠") {
        // `=` and `≠` compare two values of one type.
        if left == Type::Any || right == Type::Any {
            return None;
        }
        if left == Type::String || right == Type::String {
            return (left != right)
                .then(|| format!("{op} compares two values of one type, not {} and {}", left.name(), right.name()));
        }
    }
    // `⊆` and `⊈` compare two sets, as `=` and `≠` do.
    match joined_type(&[left, right], op) {
        Err(problem) => Some(problem),
        Ok(Type::Set) => Some(format!("the kind of the sets that {op} compares is not given")),
        Ok(_) => None,
    }
}

/// Why a term of type `ty` cannot stand where `expected`, a string or a
/// tag set, is needed, or `None`. A set of open kind takes the kind it is
/// given, and a constant of unknown type fits.
pub(crate) fn expected_problem(ty: Type, expected: Type) -> Option<String> {
    if ty == expected
        || ty == Type::Span && expected == Type::String
        || ty == Type::Any
        || (ty == Type::Set && matches!(expected, Type::Tags | Type::Pattern | Type::Strings))
    {
        None
    } else if ty == Type::Span {
        Some(SPAN_NOT_VALUE.to_string())
    } else {
        Some(format!("{} is needed here, not {}", expected.name(), ty.name()))
    }
}

/// The reader's view of constants: each is of any type but a span.
fn unknown(_: &str) -> Type {
    Type::Any
}

/// The type of a term, or why its parts do not agree (engine §10), with
/// the constants' types as the reader knows them.
pub(crate) fn term_type(term: &Term) -> Result<Type, String> {
    term_type_in(term, &unknown).map_err(|fault| fault.problem)
}

/// The type of a term, or why its parts do not agree, at the smallest
/// construct that disagrees (engine §10). `constants` gives the type of
/// each constant.
pub(crate) fn term_type_in(term: &Term, constants: ConstantTypes) -> Result<Type, Fault> {
    let joined = |items: &mut dyn Iterator<Item = &Term>, operator: &str| {
        let types = items.map(|item| term_type_in(item, constants)).collect::<Result<Vec<_>, _>>()?;
        joined_type(&types, operator).map_err(|problem| Fault::in_term(problem, term))
    };
    match term {
        Term::Pattern(p) => match p.type_fault(constants) {
            Some(f) => Err(f),
            None => Ok(Type::Pattern),
        },
        Term::Str(_) => Ok(Type::String),
        Term::Tag(_) => Ok(Type::Tags),
        Term::EmptySet => Ok(Type::Set),
        Term::Capture(_) => Ok(Type::Span),
        Term::Const(name, _) => Ok(if engine_scalar(name).is_some() { Type::String } else { constants(name) }),
        Term::Union(items) => joined(&mut items.iter(), "∪"),
        Term::Intersection(items) => joined(&mut items.iter(), "∩"),
        Term::Difference(left, right) => joined(&mut [left.as_ref(), right.as_ref()].into_iter(), "∖"),
        Term::If(cond, then) => {
            if let Some(fault) = cond_type_fault(cond, constants) {
                return Err(fault);
            }
            match expected_problem(term_type_in(then, constants)?, Type::Tags) {
                Some(problem) => Err(Fault::in_term(problem, term)),
                None => Ok(Type::Tags),
            }
        }
        Term::Call(call, args) => {
            for (index, arg) in args.iter().enumerate() {
                if let Arg::Term(arg) = arg {
                    let ty = term_type_in(arg, constants)?;
                    let expected = match call.as_str() {
                        "split" | "classify" | "concat" | "interpolate" => Type::String,
                        "requirements" | "forbid" => Type::Tags,
                        _ if index == 0 => Type::Span,
                        _ => continue,
                    };
                    if let Some(problem) = expected_problem(ty, expected) {
                        return Err(Fault::in_term(format!(".{}: {problem}", method_spelling(call)), term));
                    }
                }
            }
            if let Some(problem) = literal_call_problem(call, args) {
                return Err(Fault::in_term(problem.into(), term));
            }
            Ok(call_type(call))
        }
    }
}

/// Why a condition's terms do not agree in type, at the smallest construct
/// that disagrees, or `None` (engine §10).
pub(crate) fn cond_type_fault(cond: &Cond, constants: ConstantTypes) -> Option<Fault> {
    match cond {
        Cond::Any(items) | Cond::All(items) => items.iter().find_map(|item| cond_type_fault(item, constants)),
        Cond::Not(inner) => cond_type_fault(inner, constants),
        Cond::If(antecedent, consequent) => {
            cond_type_fault(antecedent, constants).or_else(|| cond_type_fault(consequent, constants))
        }
        Cond::Compare(op, left, right) => {
            if matches!(op.as_str(), "≅" | "≇") && !matches!(left, Term::Capture(_)) {
                return Some(Fault::in_cond("a tree comparison requires a bare capture".into(), cond));
            }
            let left = match term_type_in(left, constants) {
                Ok(ty) => ty,
                Err(fault) => return Some(fault),
            };
            let right = match term_type_in(right, constants) {
                Ok(ty) => ty,
                Err(fault) => return Some(fault),
            };
            comparison_problem(op, left, right).map(|problem| Fault::in_cond(problem, cond))
        }
        Cond::Matches(span, _)
        | Cond::Begins(span, _)
        | Cond::Initial(span)
        | Cond::Final(span)
        | Cond::Boundary(_, span, _, _) => match term_type_in(span, constants) {
            Err(fault) => Some(fault),
            Ok(ty) => expected_problem(ty, Type::Span).map(|problem| Fault::in_cond(problem, cond)),
        },
        Cond::Captured(_) => None,
    }
}

fn tag_term_fault(term: &Term, constants: ConstantTypes) -> Option<Fault> {
    match term_type_in(term, constants) {
        Err(fault) => Some(fault),
        Ok(ty) => expected_problem(ty, Type::Tags).map(|problem| Fault::in_term(problem, term)),
    }
}

/// Why a rule's terms and conditions do not agree in type, or `None`.
pub(crate) fn rule_type_problem(rule: &RuleDef) -> Option<String> {
    rule_type_fault(rule, &unknown).map(|fault| fault.problem)
}

/// Why a rule's terms and conditions do not agree in type, at the
/// smallest construct that disagrees, or `None`.
pub(crate) fn rule_type_fault(rule: &RuleDef, constants: ConstantTypes) -> Option<Fault> {
    let items = rule.emit.iter().flatten().filter_map(|item| match item {
        EmitItem::Capture(_, tags, ..) | EmitItem::Insert(tags, _) => tags.as_ref(),
    });
    rule.tags
        .iter()
        .chain(rule.alternatives.iter().filter_map(|alternative| alternative.tags.as_ref()))
        .chain(items)
        .find_map(|term| tag_term_fault(term, constants))
        .or_else(|| {
            rule.strings
                .value
                .iter()
                .chain(&rule.strings.image)
                .chain(rule.alternatives.iter().flat_map(|a| a.strings.value.iter().chain(&a.strings.image)))
                .chain(rule.emit.iter().flatten().flat_map(|item| {
                    let strings = match item {
                        EmitItem::Capture(_, _, a) => &a.strings,
                        EmitItem::Insert(_, s) => s,
                    };
                    strings.value.iter().chain(&strings.image)
                }))
                .find_map(|term| match term_type_in(term, constants) {
                    Err(fault) => Some(fault),
                    Ok(ty) => expected_problem(ty, Type::String).map(|problem| Fault::in_term(problem, term)),
                })
        })
        .or_else(|| rule.conditions.iter().find_map(|cond| cond_type_fault(cond, constants)))
        .or_else(|| {
            // A test's value is a string for a sound test and a tag set for
            // a tag test (engine §9, §10).
            rule.alternatives.iter().flat_map(|alternative| tests_in(&alternative.expr)).find_map(|(op, value, _)| {
                match term_type_in(value, constants) {
                    Err(fault) => Some(fault),
                    Ok(ty) => test_type_problem(op, ty).map(|problem| Fault::in_term(problem, value)),
                }
            })
        })
        .or_else(|| {
            let mut pending: Vec<_> = rule.alternatives.iter().map(|a| &a.expr).collect();
            while let Some(expr) = pending.pop() {
                let terms: [Option<&Term>; 2] = match expr {
                    Expr::Literal(t) => [Some(t), None],
                    Expr::ScalarRange(a, b) => [Some(a), Some(b)],
                    Expr::Seq(items) | Expr::Choice(items) | Expr::Ranked(items) | Expr::And(items) => {
                        pending.extend(items);
                        continue;
                    }
                    Expr::Optional(inner, _) | Expr::Capture(_, inner) | Expr::Tested(_, _, inner) => {
                        pending.push(inner);
                        continue;
                    }
                    Expr::Repeat(item, separator, _) => {
                        pending.push(item);
                        pending.extend(separator.as_deref());
                        continue;
                    }
                    _ => continue,
                };
                for term in terms.into_iter().flatten() {
                    match term_type_in(term, constants) {
                        Err(fault) => return Some(fault),
                        Ok(ty) => {
                            if let Some(problem) = expected_problem(ty, Type::String) {
                                return Some(Fault::in_term(problem, term));
                            }
                        }
                    }
                }
                if let Expr::ScalarRange(Term::Str(a), Term::Str(b)) = expr {
                    let mut a_chars = a.chars();
                    let mut b_chars = b.chars();
                    let endpoints = (a_chars.next(), b_chars.next());
                    if !matches!(endpoints, (Some(a), Some(b)) if a <= b)
                        || a_chars.next().is_some()
                        || b_chars.next().is_some()
                    {
                        return Some(Fault {
                            problem: "a scalar range requires ordered single-scalar endpoints".into(),
                            at: None,
                        });
                    }
                }
            }
            None
        })
}

/// The type of a constant's value, or why it cannot be one (engine §2,
/// §10): a string, a set of strings or a tag set. A redefinition keeps the
/// constant's type, which gives `∅` its kind, so its value can be of open
/// kind.
pub(crate) fn constant_value_type(value: &Term, redefine: bool, constants: ConstantTypes) -> Result<Type, Fault> {
    let ty = term_type_in(value, constants)?;
    match constant_type_problem(ty, redefine) {
        Some(problem) => Err(Fault::in_term(problem, value)),
        None => Ok(ty),
    }
}

/// Why a constant's value of type `ty` cannot be one, or `None`: a string
/// or a set, of a kind that a definition gives (engine §2, §10).
pub(crate) fn constant_type_problem(ty: Type, redefine: bool) -> Option<String> {
    match ty {
        Type::Span => Some("a constant's value is a string or a set, never a span".to_string()),
        Type::Set if !redefine => Some("the kind of the set that the constant holds is not given".to_string()),
        _ => None,
    }
}

/// A part of a DOM being dropped.
enum Dropping {
    Expr(Expr),
    Term(Term),
    Cond(Cond),
}

impl Dropping {
    /// Moves the parts of a node out onto `stack`, leaving it shallow.
    fn take(&mut self, stack: &mut Vec<Dropping>) {
        match self {
            Dropping::Expr(expr) => expr.take_parts(stack),
            Dropping::Term(term) => term.take_parts(stack),
            Dropping::Cond(cond) => cond.take_parts(stack),
        }
    }
}

/// Drops the parts that `take` moved out, with an explicit stack: a DOM
/// that a reader reads is as deep as its document nests until the check of
/// its depth (engine §9), so a recursive drop could exhaust the call stack.
fn drop_parts(mut stack: Vec<Dropping>) {
    while let Some(mut part) = stack.pop() {
        part.take(&mut stack);
    }
}

impl Expr {
    fn take_parts(&mut self, stack: &mut Vec<Dropping>) {
        match self {
            Expr::Seq(items) | Expr::Choice(items) | Expr::Ranked(items) | Expr::And(items) => {
                stack.extend(items.drain(..).map(Dropping::Expr))
            }
            Expr::Optional(inner, _) | Expr::Capture(_, inner) => {
                stack.push(Dropping::Expr(std::mem::replace(&mut **inner, Expr::Empty)))
            }
            Expr::Repeat(item, separator, _) => {
                stack.push(Dropping::Expr(std::mem::replace(&mut **item, Expr::Empty)));
                if let Some(separator) = separator {
                    stack.push(Dropping::Expr(std::mem::replace(&mut **separator, Expr::Empty)));
                }
            }
            Expr::Tested(_, value, symbol) => {
                stack.push(Dropping::Term(std::mem::replace(value, Term::EmptySet)));
                stack.push(Dropping::Expr(std::mem::replace(&mut **symbol, Expr::Empty)));
            }
            Expr::Ref(_)
            | Expr::Terminal(_)
            | Expr::Literal(_)
            | Expr::ScalarRange(..)
            | Expr::Range(..)
            | Expr::Property(_)
            | Expr::Empty => {}
        }
    }
}

impl Term {
    fn take_parts(&mut self, stack: &mut Vec<Dropping>) {
        match self {
            Term::Union(items) | Term::Intersection(items) => stack.extend(items.drain(..).map(Dropping::Term)),
            Term::Difference(left, right) => {
                stack.push(Dropping::Term(std::mem::replace(&mut **left, Term::EmptySet)));
                stack.push(Dropping::Term(std::mem::replace(&mut **right, Term::EmptySet)));
            }
            Term::Call(_, args) => {
                for arg in args.drain(..) {
                    if let Arg::Term(term) = arg {
                        stack.push(Dropping::Term(term));
                    }
                }
            }
            Term::If(cond, then) => {
                stack.push(Dropping::Cond(std::mem::replace(&mut **cond, Cond::Captured(String::new()))));
                stack.push(Dropping::Term(std::mem::replace(&mut **then, Term::EmptySet)));
            }
            Term::Pattern(_) | Term::Str(_) | Term::Tag(_) | Term::EmptySet | Term::Capture(_) | Term::Const(..) => {}
        }
    }
}

impl Cond {
    fn take_parts(&mut self, stack: &mut Vec<Dropping>) {
        match self {
            Cond::Compare(_, left, right) => {
                stack.push(Dropping::Term(std::mem::replace(left, Term::EmptySet)));
                stack.push(Dropping::Term(std::mem::replace(right, Term::EmptySet)));
            }
            Cond::Matches(span, _)
            | Cond::Begins(span, _)
            | Cond::Initial(span)
            | Cond::Final(span)
            | Cond::Boundary(_, span, _, _) => stack.push(Dropping::Term(std::mem::replace(span, Term::EmptySet))),
            Cond::Not(inner) => {
                stack.push(Dropping::Cond(std::mem::replace(&mut **inner, Cond::Captured(String::new()))))
            }
            Cond::Any(items) | Cond::All(items) => stack.extend(items.drain(..).map(Dropping::Cond)),
            Cond::If(antecedent, consequent) => {
                stack.push(Dropping::Cond(std::mem::replace(&mut **antecedent, Cond::Captured(String::new()))));
                stack.push(Dropping::Cond(std::mem::replace(&mut **consequent, Cond::Captured(String::new()))));
            }
            Cond::Captured(_) => {}
        }
    }
}

impl Drop for Expr {
    fn drop(&mut self) {
        let mut stack = Vec::new();
        self.take_parts(&mut stack);
        drop_parts(stack);
    }
}

impl Drop for Term {
    fn drop(&mut self) {
        let mut stack = Vec::new();
        self.take_parts(&mut stack);
        drop_parts(stack);
    }
}

impl Drop for Cond {
    fn drop(&mut self) {
        let mut stack = Vec::new();
        self.take_parts(&mut stack);
        drop_parts(stack);
    }
}

pub(crate) fn deferred_emission_problem(s: &str) -> bool {
    s.starts_with("%emits of ")
        || s.starts_with("a selected recipe of ")
        || s.starts_with("an item recipe of ")
        || s.starts_with("a tag term of ")
        || s.starts_with("a condition of ") && s.ends_with("applies to no production")
}
