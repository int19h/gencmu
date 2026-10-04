//! The grammar DOM of `docs/output.md`: what reading a grammar document
//! produces, what `bootstrap.json` and `compiled.json` hold, and what
//! stitching and lowering read.

use crate::json::{write_str, Json};
use crate::tags::{character_code, is_name, is_tag};
use crate::unicode::{is_property_name, Unicode};

/// The DOM format version (`docs/output.md`), part of every cache key.
pub const DOM_FORMAT: i64 = 18;

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

/// An entry of a classifier (engine §2): its gates, its keys, each a
/// canonical sound, whether it adds (`∈`) or removes (`∉`) the class, and
/// the class, a name that begins with `A` to `Z`.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Entry {
    pub guards: Vec<Guard>,
    pub keys: Vec<String>,
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
    chars.next().is_some_and(|c| c.is_ascii_lowercase()) && chars.all(|c| c.is_ascii_alphanumeric() || c == '-')
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
    chars.next().is_some_and(|c| c.is_ascii_uppercase()) && chars.all(|c| c.is_ascii_alphanumeric() || c == '-')
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
    /// `%opaque`: each constituent of the rule is an opaque part, which
    /// sounds `?` and shows its text (engine §11).
    pub opaque: bool,
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
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Expr {
    Seq(Vec<Expr>),
    Choice(Vec<Expr>),
    And(Vec<Expr>),
    /// An optional `[x]`, or, with a marker, an elidable one, `[+T x]` or
    /// `[++T x]` (engine §3.8).
    Optional(Box<Expr>, Mark),
    /// Braces: the item, the separator after `\` if any, and a chain's
    /// direction, from its marker `...` (engine §3.2, §3.3).
    Repeat(Box<Expr>, Option<Box<Expr>>, Option<Chain>),
    Ref(String),
    Terminal(String),
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
/// optional, or `++` for one whose terminator is also maximal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Mark {
    Plain,
    Elidable,
    Maximal,
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
    /// A string, decoded.
    Str(String),
    /// A tag literal: the set of one tag, in its canonical spelling.
    Tag(String),
    /// A range `'a'..'z'`, the set of its character tags (engine §1).
    Range(String, String),
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

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Cond {
    Compare(String, Term, Term),
    Matches(Term, String),
    /// `begins(s, R)`: whether a prefix of the span, possibly empty, parses
    /// as `R`.
    Begins(Term, String),
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
/// constituent. An emission of no items is `%emits ε` (§11). A named
/// capture, the item's carrier, can name attachment captures before it and
/// after it (§11).
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum EmitItem {
    Capture(String, Option<Term>, Attachments),
    Insert(String),
}

/// An emission item's attachment captures (§11): the names, without `$`,
/// before its carrier and after it, in the order written.
#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct Attachments {
    pub before: Vec<String>,
    pub after: Vec<String>,
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
    if let Some(problem) = dom_problem(value, unicode) {
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
                            keys: array(entry, "keys")?
                                .iter()
                                .map(|key| key.as_str().map(str::to_string).ok_or_else(|| "a bad key".to_string()))
                                .collect::<R<Vec<_>>>()?,
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
    for rule in &rules {
        if let Some(problem) = crate::clauses::definition_problem(rule) {
            return Err(problem);
        }
    }
    Ok(Dom { rules, directives, constants, classifiers, implications })
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
        name: string(value, "name")?,
        op,
        tags: value.get("tags").map(term_from_json).transpose()?,
        alternatives: array(value, "alternatives")?
            .iter()
            .map(|alternative| {
                Ok(Alternative {
                    guards: array(alternative, "guards")?.iter().map(guard_from_json).collect::<R<Vec<_>>>()?,
                    expr: expr_from_json(field(alternative, "expr")?)?,
                    tags: alternative.get("tags").map(term_from_json).transpose()?,
                })
            })
            .collect::<R<Vec<_>>>()?,
        emit: value.get("emit").map(emit_from_json).transpose()?,
        conditions: array(value, "conditions")?.iter().map(cond_from_json).collect::<R<Vec<_>>>()?,
        opaque: is_true(value.get("opaque")),
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
            term_from_json(field(value, "value")?)?,
            Box::new(expr_from_json(field(value, "expr")?)?),
        ));
    }
    let list = |key: &str| -> R<Vec<Expr>> { array(value, key)?.iter().map(expr_from_json).collect() };
    Ok(match first_key(value)? {
        "seq" => Expr::Seq(list("seq")?),
        "choice" => Expr::Choice(list("choice")?),
        "and" => Expr::And(list("and")?),
        "optional" => {
            let mark = match (is_true(value.get("elidable")), is_true(value.get("maximal"))) {
                (false, _) => Mark::Plain,
                (true, false) => Mark::Elidable,
                (true, true) => Mark::Maximal,
            };
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
        "terminal" => Expr::Terminal(string(value, "terminal")?),
        "range" => {
            let (start, end) = range_from_json(value)?;
            Expr::Range(start, end)
        }
        "property" => Expr::Property(string(value, "property")?),
        "capture" => Expr::Capture(string(value, "capture")?, Box::new(expr_from_json(field(value, "expr")?)?)),
        "empty" => Expr::Empty,
        other => return Err(format!("an unknown expression {other:?}")),
    })
}

/// A range's two ends, from `{"range":[START,END]}`.
fn range_from_json(value: &Json) -> R<(String, String)> {
    match array(value, "range")? {
        [Json::Str(start), Json::Str(end)] => Ok((start.clone(), end.clone())),
        _ => Err("a malformed range".to_string()),
    }
}

fn term_from_json(value: &Json) -> R<Term> {
    let list = |key: &str| -> R<Vec<Term>> { array(value, key)?.iter().map(term_from_json).collect() };
    Ok(match first_key(value)? {
        "string" => Term::Str(string(value, "string")?),
        "tag" => Term::Tag(string(value, "tag")?),
        "range" => {
            let (start, end) = range_from_json(value)?;
            Term::Range(start, end)
        }
        "emptySet" => Term::EmptySet,
        "union" => Term::Union(list("union")?),
        "intersection" => Term::Intersection(list("intersection")?),
        "difference" => match &list("difference")?[..] {
            [left, right] => Term::Difference(Box::new(left.clone()), Box::new(right.clone())),
            _ => return Err("a difference of other than two terms".to_string()),
        },
        "capture" => Term::Capture(string(value, "capture")?),
        "const" => Term::Const(string(value, "const")?, position(value)?),
        "if" => {
            Term::If(Box::new(cond_from_json(field(value, "if")?)?), Box::new(term_from_json(field(value, "then")?)?))
        }
        "call" => Term::Call(
            string(value, "call")?,
            array(value, "args")?
                .iter()
                .map(|arg| match (arg.get("rule"), arg.get("classifier")) {
                    (Some(Json::Str(rule)), _) => Ok(Arg::Rule(rule.clone())),
                    (_, Some(Json::Str(classifier))) => Ok(Arg::Classifier(classifier.clone())),
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
        "begins" => Cond::Begins(term_from_json(field(value, "begins")?)?, string(value, "rule")?),
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
                let attachments = Attachments { before: names("before")?, after: names("after")? };
                Ok(EmitItem::Capture(name.clone(), tags, attachments))
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

/// The forms of an expression, each as its members (docs/output.md). The
/// first member names the form.
const EXPR_FORMS: [&[&str]; 12] = [
    &["seq"],
    &["choice"],
    &["and"],
    &["optional", "elidable?", "maximal?"],
    &["repeat", "separator?", "chain?"],
    &["ref"],
    &["terminal"],
    &["capture", "expr"],
    &["range"],
    &["property"],
    &["test", "value", "expr"],
    &["empty"],
];

/// The forms of a term, each as its members (docs/output.md). The first
/// member names the form.
const TERM_FORMS: [&[&str]; 11] = [
    &["union"],
    &["intersection"],
    &["difference"],
    &["if", "then"],
    &["call", "args"],
    &["string"],
    &["tag"],
    &["range"],
    &["emptySet"],
    &["capture"],
    &["const", "at"],
];

/// The forms of a condition, each as its members (docs/output.md). The
/// first member names the form.
const COND_FORMS: [&[&str]; 9] = [
    &["op", "left", "right"],
    &["matches", "rule"],
    &["begins", "rule"],
    &["initial"],
    &["not"],
    &["any"],
    &["all"],
    &["captured"],
    &["if", "then"],
];

/// Whether a node has exactly the members of one of its forms, and no
/// other. So a node that joins two forms, such as `{"tag":…,"string":…}`,
/// is refused before it is read, whatever the order of its members. A
/// member that ends in `?` may be absent.
fn has_one_form(value: &Json, forms: &[&[&str]]) -> bool {
    let Some(members) = value.as_object() else {
        return false;
    };
    let Some(form) = forms.iter().find(|form| has(value, form[0])) else {
        return false;
    };
    form.iter().all(|member| member.ends_with('?') || has(value, member))
        && members.iter().all(|(key, _)| form.iter().any(|member| member.trim_end_matches('?') == key))
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

/// A span: a capture, or `head`, `tail`, `last`, `from` or `after` of
/// something.
fn is_span_json(value: &Json) -> bool {
    is_object(value)
        && (is_str(value.get("capture"))
            || matches!(value.get("call").and_then(Json::as_str), Some("head" | "tail" | "last" | "from" | "after")))
}

/// Whether a JSON value is a tag in its canonical spelling (engine §1).
fn is_tag_json(value: Option<&Json>, unicode: &Unicode) -> bool {
    matches!(value, Some(Json::Str(tag)) if is_tag(tag, unicode))
}

/// A capture's name is all lower case (engine §9).
pub(crate) fn is_capture_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn is_rule_arg(value: &Json) -> bool {
    matches!(value.as_object(), Some([(key, Json::Str(_))]) if key == "rule")
}

/// The second argument of `classify`: a classifier's name, and no other
/// member (engine §9).
fn is_classifier_arg(value: &Json) -> bool {
    matches!(value.as_object(), Some([(key, Json::Str(name))]) if key == "classifier" && is_classifier_name(name))
}

/// An argument that stands for a value: neither a rule's name, nor a
/// classifier's, nor a span (engine §9).
fn is_value_arg(value: &Json) -> bool {
    !is_rule_arg(value) && !is_classifier_arg(value) && !is_span_json(value)
}

/// The comparators of a test in a body (engine §2): the two sound tests
/// and the four tag tests.
pub(crate) const TEST_OPS: [&str; 6] = ["=", "≠", "⊇", "⊉", "∩=∅", "∩≠∅"];

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

/// What is wrong with the string of a sound test (engine §9), or `None`:
/// one that no canonical sound can be, with a comma or a code point that
/// the lowercase mapping would change.
pub(crate) fn sound_problem(sound: &str, unicode: &Unicode) -> Option<&'static str> {
    if sound.contains(',') {
        Some("the string of a sound test holds a comma, which no canonical sound holds")
    } else if unicode.lowercase(sound) != sound {
        Some("the string of a sound test is not in lower case, which every canonical sound is")
    } else {
        None
    }
}

/// What is wrong with a range (engine §1, §9), or `None`: its ends must be
/// two character tags in their canonical spelling, the start not above the
/// end.
pub(crate) fn range_problem(start: &str, end: &str, unicode: &Unicode) -> Option<String> {
    match (character_code(start, unicode), character_code(end, unicode)) {
        (Some(first), Some(last)) if first > last => Some(format!("the range {start}..{end} starts above its end")),
        (Some(_), Some(_)) => None,
        _ => Some("a range's ends are two character tags".to_string()),
    }
}

/// What is wrong with a property's name (engine §1, §9), or `None`.
pub(crate) fn property_problem(name: &str) -> Option<String> {
    (!is_property_name(name)).then(|| {
        format!(
            "'\\p{{{name}}}' is not a property: a property is a General_Category value in its short form, \
             a one-letter group of them, White_Space or Any"
        )
    })
}

/// Whether a JSON value is `[START,END]`, a range the DOM allows.
fn is_range_json(value: Option<&Json>, unicode: &Unicode) -> bool {
    matches!(value.and_then(Json::as_array), Some([Json::Str(start), Json::Str(end)])
        if range_problem(start, end, unicode).is_none())
}

/// Whether an expression is a range or a property that the DOM allows, with
/// no other member.
fn is_character_class_json(value: &Json, unicode: &Unicode) -> bool {
    match value.as_object() {
        Some([(key, range)]) if key == "range" => is_range_json(Some(range), unicode),
        Some([(key, Json::Str(name))]) if key == "property" => property_problem(name).is_none(),
        _ => false,
    }
}

/// Whether a JSON expression is one a test may follow (engine §2): a
/// reference other than `#`, a terminal, a range or a property, with no
/// other member, so that no node is read one way here and another way when
/// it is built.
fn is_testable_json(value: &Json, unicode: &Unicode) -> bool {
    match value.as_object() {
        Some([(key, Json::Str(name))]) if key == "ref" => name != "#" && is_rule_name(name),
        Some([(key, Json::Str(tag))]) if key == "terminal" => is_tag(tag, unicode),
        _ => is_character_class_json(value, unicode),
    }
}

/// The terminal at the head of an elidable optional's expression, or
/// `None` where it has none (engine §3.8, §9): a `ref` whose name begins
/// with a capital, a `terminal` whose tag is a name, or an `=` test of one
/// of these, alone or first in a `seq`.
fn elidable_head_json(expr: &Json) -> Option<&Json> {
    let head = match expr.get("seq").and_then(Json::as_array) {
        Some(items) => items.first()?,
        None => expr,
    };
    let is_terminal = |node: &Json| match node.as_object() {
        Some([(key, Json::Str(name))]) if key == "ref" => is_rule_name(name) && crate::grammar::is_terminal_name(name),
        Some([(key, Json::Str(tag))]) if key == "terminal" => is_name(tag),
        _ => false,
    };
    if is_terminal(head) {
        return Some(head);
    }
    (head.get("test").and_then(Json::as_str) == Some("=") && head.get("expr").is_some_and(is_terminal)).then_some(head)
}

/// What is wrong with a test's value (engine §9), or `None`: it must be a
/// closed term, of type string for a sound test and tag set for a tag test,
/// and a string literal of a sound test must be a canonical sound. The
/// shape of the value must already be checked, and its nesting bounded.
fn test_value_problem(op: &str, value: &Json, unicode: &Unicode) -> Option<&'static str> {
    if !is_closed_json(value) {
        return Some("a test's operand is a closed term, and reads no capture or span");
    }
    let Ok(term) = term_from_json(value) else {
        return Some("a malformed term");
    };
    match term_type(&term) {
        Err(_) => return Some("a term or a condition whose types do not agree"),
        Ok(ty) if test_type_problem(op, ty).is_some() => return Some("a test's value is of the wrong type"),
        Ok(_) => {}
    }
    match &term {
        Term::Str(sound) if is_sound_test(op) => sound_problem(sound, unicode),
        _ => None,
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    /// An expression: `whole` where it is its alternative's whole
    /// expression, where a chain may stand, and `sealed` where it is inside
    /// braces or an elidable optional, where no capture stands (engine §9).
    Expr {
        whole: bool,
        sealed: bool,
    },
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
/// The strings of sound tests are checked against `unicode`'s lowercase
/// mapping, the one the match uses.
pub(crate) fn dom_problem(dom: &Json, unicode: &Unicode) -> Option<&'static str> {
    if !is_object(dom)
        || dom.get("format").and_then(Json::as_int) != Some(DOM_FORMAT)
        || dom.get("rules").and_then(Json::as_array).is_none()
        || dom.get("directives").and_then(Json::as_array).is_none()
        || dom.get("constants").and_then(Json::as_array).is_none()
        || dom.get("classifiers").and_then(Json::as_array).is_none()
        || dom.get("implications").and_then(Json::as_array).is_none()
    {
        return Some("not a DOM of this format");
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
        // The operands the notation's syntax allows these directives
        // (engine §9).
        let args: Vec<&str> = args.unwrap_or(&[]).iter().filter_map(Json::as_str).collect();
        let is_name = |arg: &&str| *arg != "#" && is_rule_name(arg);
        // The notation has four directives, and `%elidable` is none of them
        // (engine §9).
        let operands_ok = match directive.get("name").and_then(Json::as_str) {
            Some("stage") => args.len() == 1 && args.iter().all(is_name),
            Some("include") => args.len() == 1,
            Some("features") => !args.is_empty() && args.iter().all(is_name),
            Some("ambiguity-resolution") => true,
            _ => false,
        };
        // No directive has the member `maximal` (engine §9).
        if !operands_ok || has(directive, "maximal") {
            return Some("a malformed directive");
        }
    }
    let mut pending: Vec<(Kind, &Json, usize)> = Vec::new();
    // The tested symbols, whose values are checked once the nesting is
    // bounded.
    let mut tests: Vec<&Json> = Vec::new();
    // A constant's definition: its name, its op, its position and a value
    // that is a closed term (engine §2, §10).
    for constant in dom.get("constants").and_then(Json::as_array).unwrap_or(&[]) {
        let well_formed = constant.as_object().is_some_and(|members| members.len() == 4)
            && constant.get("name").and_then(Json::as_str).is_some_and(is_constant_name)
            && matches!(constant.get("op").and_then(Json::as_str), Some("define" | "redefine"))
            && is_position(constant.get("at"));
        let Some(value) = constant.get("value").filter(|_| well_formed) else {
            return Some("a malformed constant");
        };
        pending.push((Kind::Term, value, 0));
    }
    // A classifier: its name, and entries of gates, canonical keys, an
    // operator and a class (engine §2, §9).
    for classifier in dom.get("classifiers").and_then(Json::as_array).unwrap_or(&[]) {
        let entries = classifier.get("entries").and_then(Json::as_array);
        if !classifier.as_object().is_some_and(|members| members.len() == 3)
            || !classifier.get("name").and_then(Json::as_str).is_some_and(is_classifier_name)
            || !is_position(classifier.get("at"))
        {
            return Some("a malformed classifier");
        }
        let Some(entries) = entries else {
            return Some("a malformed classifier");
        };
        for entry in entries {
            let gates_ok = entry.get("guards").and_then(Json::as_array).is_some_and(|guards| {
                guards.iter().all(|guard| {
                    guard.as_object().is_some_and(|members| members.len() == 3)
                        && guard.get("feature").and_then(Json::as_str).is_some_and(is_name)
                        && guard.get("kind").and_then(Json::as_str) == Some("gate")
                        && matches!(guard.get("negated"), Some(Json::Bool(_)))
                })
            });
            let keys_ok = entry.get("keys").and_then(Json::as_array).is_some_and(|keys| {
                !keys.is_empty()
                    && keys.iter().all(|key| matches!(key, Json::Str(key) if sound_problem(key, unicode).is_none()))
            });
            if !entry.as_object().is_some_and(|members| members.len() == 5)
                || !is_position(entry.get("at"))
                || !matches!(entry.get("op").and_then(Json::as_str), Some("∈" | "∉"))
                || !entry.get("class").and_then(Json::as_str).is_some_and(is_constant_name)
                || !gates_ok
                || !keys_ok
            {
                return Some("a malformed entry of a classifier");
            }
        }
    }
    // An implication: two closed terms whose type is a tag set, checked
    // once the nesting is bounded (engine §2, §9).
    for implication in dom.get("implications").and_then(Json::as_array).unwrap_or(&[]) {
        let (Some(antecedent), Some(consequent)) = (implication.get("if"), implication.get("then")) else {
            return Some("a malformed implication");
        };
        if !implication.as_object().is_some_and(|members| members.len() == 3) || !is_position(implication.get("at")) {
            return Some("a malformed implication");
        }
        pending.push((Kind::Term, antecedent, 0));
        pending.push((Kind::Term, consequent, 0));
    }
    for rule in dom.get("rules").and_then(Json::as_array).unwrap_or(&[]) {
        let alternatives = rule.get("alternatives").and_then(Json::as_array);
        let conditions = rule.get("conditions").and_then(Json::as_array);
        if !is_object(rule)
            || !rule.get("name").and_then(Json::as_str).is_some_and(is_rule_name)
            || !matches!(rule.get("op").and_then(Json::as_str), Some("define" | "redefine" | "extend"))
            || !alternatives.is_some_and(|alternatives| !alternatives.is_empty())
            || conditions.is_none()
            || !is_position(rule.get("at"))
            // `opaque` is present only as true (docs/output.md).
            || !matches!(rule.get("opaque"), None | Some(Json::Bool(true)))
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
            // is, of a feature that is a name (§9), with no other member.
            let guards = alternative.get("guards").and_then(Json::as_array);
            let guards_ok = guards.is_some_and(|guards| {
                guards.iter().all(|guard| {
                    guard.as_object().is_some_and(|members| members.len() == 3)
                        && guard.get("feature").and_then(Json::as_str).is_some_and(is_name)
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
            // The alternative's whole expression, where a chain may stand
            // (engine §9).
            match alternative.get("expr") {
                Some(expr) => pending.push((Kind::Expr { whole: true, sealed: false }, expr, 0)),
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
                Kind::Expr { .. } => "a malformed expression",
                Kind::Term | Kind::TagTerm | Kind::Argument => "a malformed term",
                Kind::Condition | Kind::TagCondition => "a malformed condition",
                Kind::Emission => "a malformed emission",
            });
        }
        let next = depth + 1;
        match kind {
            Kind::Expr { whole, sealed } => {
                // An expression has exactly the members of one form
                // (docs/output.md).
                if !has_one_form(value, &EXPR_FORMS) {
                    return Some("a malformed expression");
                }
                let expr = |item, inside: bool| (Kind::Expr { whole: false, sealed: sealed || inside }, item, next);
                if has(value, "range") || has(value, "property") {
                    if !is_character_class_json(value, unicode) {
                        return Some("a malformed expression");
                    }
                } else if has(value, "choice") || has(value, "seq") {
                    let items = value.get("choice").or_else(|| value.get("seq"));
                    if !list(items, 2, usize::MAX) {
                        return Some("a malformed expression");
                    }
                    pending.extend(items.and_then(Json::as_array).unwrap_or(&[]).iter().map(|item| expr(item, false)));
                } else if has(value, "and") {
                    if !list(value.get("and"), 2, crate::grammar::MAX_AND) {
                        return Some("a malformed expression");
                    }
                    pending.extend(
                        value.get("and").and_then(Json::as_array).unwrap_or(&[]).iter().map(|item| expr(item, false)),
                    );
                } else if let Some(inner) = value.get("repeat") {
                    // A chain is the whole expression of its alternative,
                    // and its direction is left or right (engine §9). The
                    // separator counts on from the depth of its repeat, as
                    // the item does, and neither holds a capture.
                    if let Some(chain) = value.get("chain") {
                        if !whole || !matches!(chain.as_str(), Some("left" | "right")) {
                            return Some("a malformed expression");
                        }
                    }
                    pending.push(expr(inner, true));
                    if let Some(separator) = value.get("separator") {
                        pending.push(expr(separator, true));
                    }
                } else if let Some(inner) = value.get("optional") {
                    // An elidable optional is marked true, and maximal only
                    // with it; its expression begins with its terminal
                    // (engine §3.8, §9).
                    let elidable = value.get("elidable");
                    let maximal = value.get("maximal");
                    if elidable.is_some_and(|marked| *marked != Json::Bool(true))
                        || maximal.is_some_and(|marked| *marked != Json::Bool(true) || elidable.is_none())
                    {
                        return Some("a malformed expression");
                    }
                    if elidable.is_some() && elidable_head_json(inner).is_none() {
                        return Some("a malformed elidable optional");
                    }
                    pending.push(expr(inner, elidable.is_some()));
                } else if has(value, "capture") {
                    // A capture stands anywhere but in braces or an elidable
                    // optional, and wraps one symbol: a reference, a
                    // terminal, a range, a property or a tested one of these
                    // (engine §3.5, §9).
                    if sealed {
                        return Some("a capture inside braces or an elidable optional");
                    }
                    let inner = value.get("expr").filter(|inner| {
                        ["ref", "terminal", "range", "property", "test"].iter().any(|member| has(inner, member))
                    });
                    // `$` is the whole constituent and wraps nothing, and a
                    // name is all lower case.
                    let named = value.get("capture").and_then(Json::as_str).is_some_and(is_capture_name);
                    let Some(inner) = inner.filter(|_| named) else {
                        return Some("a malformed capture");
                    };
                    // A capture is a compound node, and its symbol below it
                    // is checked as any expression is.
                    pending.push(expr(inner, false));
                } else if let Some(op) = value.get("test") {
                    // A compound node (engine §9) over one symbol; its value
                    // counts on from its depth, and is checked once the
                    // nesting is bounded.
                    if !op.as_str().is_some_and(|op| TEST_OPS.contains(&op)) {
                        return Some("a malformed test");
                    }
                    let (Some(inner), Some(test_value)) = (value.get("expr"), value.get("value")) else {
                        return Some("a malformed expression");
                    };
                    if !is_testable_json(inner, unicode) {
                        return Some("a test follows only a reference other than # or a terminal");
                    }
                    pending.push(expr(inner, false));
                    pending.push((Kind::Term, test_value, next));
                    tests.push(value);
                } else if !(value.get("ref").and_then(Json::as_str).is_some_and(is_rule_name)
                    || is_tag_json(value.get("terminal"), unicode)
                    || is_true(value.get("empty")))
                {
                    // A reference is a name or `#` (§9).
                    return Some("a malformed expression");
                }
            }
            Kind::Emission => {
                // `$` only with `$`, a capture other than `$` listed once,
                // tags only on a capture, never `<∅>`, and no member but
                // those; no items is `ε` (§9). Attachments are lists of
                // named captures, present only when not empty, and only on
                // a named capture, and they count as listed.
                if !list(value.get("items"), 0, usize::MAX) || value.as_object().map_or(0, <[_]>::len) != 1 {
                    return Some("a malformed emission");
                }
                let items = value.get("items").and_then(Json::as_array).unwrap_or(&[]);
                let mut whole = 0;
                let mut captures: Vec<&str> = Vec::new();
                for item in items {
                    let known = item.as_object().is_some_and(|members| {
                        members
                            .iter()
                            .all(|(key, _)| matches!(key.as_str(), "capture" | "insert" | "tags" | "before" | "after"))
                    });
                    if !known {
                        return Some("a malformed emission");
                    }
                    if let Some(name) = item.get("capture").and_then(Json::as_str) {
                        if has(item, "insert") {
                            return Some("a malformed emission");
                        }
                        let sides = [item.get("before"), item.get("after")];
                        if name.is_empty() {
                            if sides.iter().any(Option::is_some) {
                                return Some("a malformed emission");
                            }
                            whole += 1;
                        }
                        let mut named = if name.is_empty() { Vec::new() } else { vec![name] };
                        for side in sides.into_iter().flatten() {
                            if !list(Some(side), 1, usize::MAX) {
                                return Some("a malformed emission");
                            }
                            for attachment in side.as_array().unwrap_or(&[]) {
                                match attachment.as_str() {
                                    Some(attachment) if is_capture_name(attachment) => named.push(attachment),
                                    _ => return Some("a malformed emission"),
                                }
                            }
                        }
                        for name in named {
                            if captures.contains(&name) {
                                return Some("a malformed emission");
                            }
                            captures.push(name);
                        }
                    } else if is_tag_json(item.get("insert"), unicode) {
                        if has(item, "tags") || has(item, "before") || has(item, "after") {
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
                // A condition has exactly the members of one form
                // (docs/output.md).
                if !has_one_form(value, &COND_FORMS) {
                    return Some("a malformed condition");
                }
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
                } else if let Some(span) = value.get("matches").or_else(|| value.get("begins")) {
                    let both = has(value, "matches") && has(value, "begins");
                    if !is_str(value.get("rule")) || !is_span_json(span) || both {
                        return Some("a malformed condition");
                    }
                    pending.push((Kind::Argument, span, next));
                } else if let Some(span) = value.get("initial") {
                    if value.as_object().map_or(0, <[_]>::len) != 1 || !is_span_json(span) {
                        return Some("a malformed condition");
                    }
                    pending.push((Kind::Argument, span, next));
                } else {
                    if !matches!(value.get("op").and_then(Json::as_str), Some("=" | "≠" | "∈" | "∉" | "⊆" | "⊈"))
                    {
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
                // A term has exactly the members of one form, so that no
                // node is read as one form here and another elsewhere.
                if !has_one_form(value, &TERM_FORMS) {
                    return Some("a malformed term");
                }
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
                } else if has(value, "union") || has(value, "intersection") || has(value, "difference") {
                    let items = value.get("union").or_else(|| value.get("intersection"));
                    let (items, most) = match items {
                        Some(items) => (Some(items), usize::MAX),
                        None => (value.get("difference"), 2),
                    };
                    if !list(items, 2, most) {
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
                        // Their arguments' types are checked with the others'.
                        Some("split") => {
                            matches!(args, [a, b] if [a, b].iter().all(|arg| is_value_arg(arg)))
                        }
                        Some("tag") => matches!(args, [string] if is_value_arg(string)),
                        Some("classify") => {
                            matches!(args, [string, classifier] if is_value_arg(string) && is_classifier_arg(classifier))
                        }
                        Some("phonemes" | "text" | "classes" | "head" | "tail" | "last" | "from" | "after") => {
                            matches!(args, [span] if is_span_json(span))
                        }
                        // `matches`, `begins` and `initial` are conditions,
                        // never terms.
                        _ => false,
                    };
                    let span_call = matches!(call, Some("head" | "tail" | "last" | "from" | "after"));
                    if !ok || (kind != Kind::Argument && span_call) {
                        return Some("a malformed term");
                    }
                    if own && matches!(call, Some("tags" | "classes")) && matches!(args, [span] if is_whole(span)) {
                        return Some("a tag term that reads the tags it defines");
                    }
                    if let Some(problem) = call.and_then(|call| literal_call_problem_json(call, args)) {
                        return Some(problem);
                    }
                    for arg in args {
                        if !is_rule_arg(arg) && !is_classifier_arg(arg) {
                            pending.push((Kind::Argument, arg, next));
                        }
                    }
                } else if !(is_str(value.get("string"))
                    || is_tag_json(value.get("tag"), unicode)
                    || is_range_json(value.get("range"), unicode)
                    || is_true(value.get("emptySet"))
                    || is_str(value.get("capture"))
                    || (value.get("const").and_then(Json::as_str).is_some_and(is_constant_name)
                        && is_position(value.get("at"))))
                {
                    return Some("a malformed term");
                }
            }
        }
    }
    // The walks below recurse, so they run only once the nesting is
    // bounded.
    for constant in dom.get("constants").and_then(Json::as_array).unwrap_or(&[]) {
        if !constant.get("value").is_some_and(is_closed_json) {
            return Some("a constant's value is not a closed term");
        }
    }
    for implication in dom.get("implications").and_then(Json::as_array).unwrap_or(&[]) {
        for side in [implication.get("if"), implication.get("then")].into_iter().flatten() {
            if !is_closed_json(side) {
                return Some("a side of an implication is not a closed term");
            }
            match term_from_json(side).map(|term| term_type(&term)) {
                Ok(Ok(ty)) if expected_problem(ty, Type::Tags).is_none() => {}
                Ok(Ok(_)) => return Some("a side of an implication is not a tag set"),
                Ok(Err(_)) => return Some("a term or a condition whose types do not agree"),
                Err(_) => return Some("a malformed implication"),
            }
        }
    }
    for test in tests {
        let op = test.get("test").and_then(Json::as_str).unwrap_or("");
        if let Some(problem) = test_value_problem(op, test.get("value").unwrap_or(&Json::Null), unicode) {
            return Some(problem);
        }
    }
    // Terms and conditions whose types do not agree (engine §10).
    for rule in dom.get("rules").and_then(Json::as_array).unwrap_or(&[]) {
        // A capture name stands at most once in each production (engine
        // §3.5).
        let twice = |rule: &RuleDef| {
            rule.alternatives
                .iter()
                .any(|alternative| !crate::clauses::duplicate_captures(&alternative.expr).is_empty())
        };
        match rule_from_json(rule) {
            Ok(rule) if twice(&rule) => return Some("a capture name used twice in one production"),
            Ok(rule) if rule_type_problem(&rule).is_none() => {}
            Ok(_) => return Some("a term or a condition whose types do not agree"),
            Err(_) => return Some("a malformed rule"),
        }
    }
    for constant in dom.get("constants").and_then(Json::as_array).unwrap_or(&[]) {
        let redefine = constant.get("op").and_then(Json::as_str) == Some("redefine");
        match constant.get("value").map(term_from_json) {
            Some(Ok(value)) if constant_value_type(&value, redefine, &|_| Type::Any).is_ok() => {}
            Some(Ok(_)) => return Some("a term or a condition whose types do not agree"),
            _ => return Some("a malformed constant"),
        }
    }
    // The order of a document's items is the order of their positions, so
    // no two items share one (engine §9).
    let mut positions = std::collections::HashSet::new();
    for kind in ["rules", "directives", "constants", "classifiers", "implications"] {
        for item in dom.get(kind).and_then(Json::as_array).unwrap_or(&[]) {
            if let Some([Json::Int(line), Json::Int(column)]) = item.get("at").and_then(Json::as_array) {
                if !positions.insert((*line, *column)) {
                    return Some("two items at one position");
                }
            }
        }
    }
    None
}

/// Whether a term's JSON is closed (engine §10): no capture, no guarded
/// term, and no call but `split` and `tag` of closed terms. The shape of
/// the term need not be checked.
fn is_closed_json(term: &Json) -> bool {
    if !is_object(term) {
        return true;
    }
    if has(term, "capture") || has(term, "if") {
        return false;
    }
    if let Some(call) = term.get("call") {
        return matches!(call.as_str(), Some("split" | "tag"))
            && term.get("args").and_then(Json::as_array).unwrap_or(&[]).iter().all(is_closed_json);
    }
    ["union", "intersection", "difference"]
        .iter()
        .all(|key| term.get(key).and_then(Json::as_array).unwrap_or(&[]).iter().all(is_closed_json))
}

/// What is wrong with a call of `split` or `tag` whose argument the reader
/// sees as a string literal (engine §9, §10), or `None`: an empty
/// delimiter, or a tag's string that is not a name.
pub(crate) fn literal_call_problem(call: &str, args: &[Arg]) -> Option<&'static str> {
    fn literal(arg: Option<&Arg>) -> Option<&str> {
        match arg {
            Some(Arg::Term(Term::Str(text))) => Some(text),
            _ => None,
        }
    }
    match call {
        "split" if literal(args.get(1)) == Some("") => Some("split has an empty delimiter"),
        "tag" if literal(args.first()).is_some_and(|name| !is_name(name)) => Some("the string of tag() is not a name"),
        _ => None,
    }
}

/// `literal_call_problem` over a DOM's JSON.
fn literal_call_problem_json(call: &str, args: &[Json]) -> Option<&'static str> {
    fn literal(arg: Option<&Json>) -> Option<&str> {
        match arg.and_then(Json::as_object) {
            Some([(key, Json::Str(text))]) if key == "string" => Some(text),
            _ => None,
        }
    }
    match call {
        "split" if literal(args.get(1)) == Some("") => Some("split has an empty delimiter"),
        "tag" if literal(args.first()).is_some_and(|name| !is_name(name)) => Some("the string of tag() is not a name"),
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
                write_str(&mut out, key);
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
            write_guard(out, guard);
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
                EmitItem::Capture(name, tags, attachments) => {
                    out.push_str("{\"capture\":");
                    write_str(out, name);
                    if let Some(tags) = tags {
                        out.push_str(",\"tags\":");
                        write_term(out, tags);
                    }
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
    out.push(']');
    if rule.opaque {
        out.push_str(",\"opaque\":true");
    }
    out.push_str(&format!(",\"at\":[{},{}]}}", rule.at.0, rule.at.1));
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

fn write_expr(out: &mut String, expr: &Expr) {
    match expr {
        Expr::Seq(items) => write_list(out, "seq", items, write_expr),
        Expr::Choice(items) => write_list(out, "choice", items, write_expr),
        Expr::And(items) => write_list(out, "and", items, write_expr),
        Expr::Optional(inner, mark) => {
            out.push_str("{\"optional\":");
            write_expr(out, inner);
            out.push_str(match mark {
                Mark::Plain => "}",
                Mark::Elidable => ",\"elidable\":true}",
                Mark::Maximal => ",\"elidable\":true,\"maximal\":true}",
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
        Expr::Range(start, end) => write_range(out, start, end),
        Expr::Property(name) => {
            out.push_str("{\"property\":");
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
        Expr::Tested(op, value, inner) => {
            out.push_str("{\"test\":");
            write_str(out, op);
            out.push_str(",\"value\":");
            write_term(out, value);
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

fn write_term(out: &mut String, term: &Term) {
    match term {
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
        Term::Range(start, end) => write_range(out, start, end),
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
                    Arg::Classifier(classifier) => {
                        out.push_str("{\"classifier\":");
                        write_str(out, classifier);
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
        Cond::Begins(span, rule) => {
            out.push_str("{\"begins\":");
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

// ---- types (engine §10)

/// A term's type: a string, a set of strings, a tag set, a span, a set
/// whose kind nothing has given yet, such as `∅`, or, for a constant whose
/// type the reader cannot know, any type but a span (engine §9).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Type {
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
    match term {
        Term::Const(name, at) => out.push((name, *at)),
        Term::Union(items) | Term::Intersection(items) => items.iter().for_each(|item| constants_in_term(item, out)),
        Term::Difference(left, right) => {
            constants_in_term(left, out);
            constants_in_term(right, out);
        }
        Term::If(cond, then) => {
            constants_in_cond(cond, out);
            constants_in_term(then, out);
        }
        Term::Call(_, args) => {
            for arg in args {
                if let Arg::Term(term) = arg {
                    constants_in_term(term, out);
                }
            }
        }
        Term::Str(_) | Term::Tag(_) | Term::Range(..) | Term::EmptySet | Term::Capture(_) => {}
    }
}

/// The references to constants in a condition, in the order written.
pub(crate) fn constants_in_cond<'t>(cond: &'t Cond, out: &mut Vec<(&'t str, (usize, usize))>) {
    match cond {
        Cond::Compare(_, left, right) => {
            constants_in_term(left, out);
            constants_in_term(right, out);
        }
        Cond::Not(inner) => constants_in_cond(inner, out),
        Cond::Any(items) | Cond::All(items) => items.iter().for_each(|item| constants_in_cond(item, out)),
        Cond::If(antecedent, consequent) => {
            constants_in_cond(antecedent, out);
            constants_in_cond(consequent, out);
        }
        Cond::Matches(span, _) | Cond::Begins(span, _) | Cond::Initial(span) => constants_in_term(span, out),
        Cond::Captured(_) => {}
    }
}

/// The tested symbols of an expression, in the order written: each
/// comparator, value and symbol.
pub(crate) fn tests_in(expr: &Expr) -> Vec<(&str, &Term, &Expr)> {
    let mut found = Vec::new();
    let mut stack = vec![expr];
    while let Some(current) = stack.pop() {
        match current {
            Expr::Seq(items) | Expr::Choice(items) | Expr::And(items) => stack.extend(items.iter().rev()),
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
            Expr::Ref(_) | Expr::Terminal(_) | Expr::Range(..) | Expr::Property(_) | Expr::Empty => {}
        }
    }
    found
}

/// The references to constants in a rule, in the order of its DOM: its
/// tags, its alternatives' tests and tags, its emission and its conditions.
pub(crate) fn constants_in_rule(rule: &RuleDef) -> Vec<(&str, (usize, usize))> {
    let mut out = Vec::new();
    rule.tags.iter().for_each(|term| constants_in_term(term, &mut out));
    for alternative in &rule.alternatives {
        for (_, value, _) in tests_in(&alternative.expr) {
            constants_in_term(value, &mut out);
        }
        alternative.tags.iter().for_each(|term| constants_in_term(term, &mut out));
    }
    for item in rule.emit.iter().flatten() {
        if let EmitItem::Capture(_, Some(term), ..) = item {
            constants_in_term(term, &mut out);
        }
    }
    rule.conditions.iter().for_each(|cond| constants_in_cond(cond, &mut out));
    out
}

fn first_constant_in_term(term: &Term) -> Option<(usize, usize)> {
    let mut out = Vec::new();
    constants_in_term(term, &mut out);
    out.first().map(|&(_, at)| at)
}

fn first_constant_in_cond(cond: &Cond) -> Option<(usize, usize)> {
    let mut out = Vec::new();
    constants_in_cond(cond, &mut out);
    out.first().map(|&(_, at)| at)
}

const SPAN_NOT_VALUE: &str = "a span is not a value: tags($x) is the tag set of $x";

/// The type of the value a function gives (engine §10).
fn call_type(call: &str) -> Type {
    match call {
        "phonemes" | "text" => Type::String,
        "split" => Type::Strings,
        "tags" | "classes" | "tag" | "classify" => Type::Tags,
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
    if ty == expected || ty == Type::Any || (ty == Type::Set && expected == Type::Tags) {
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
        Term::Str(_) => Ok(Type::String),
        Term::Tag(_) | Term::Range(..) => Ok(Type::Tags),
        Term::EmptySet => Ok(Type::Set),
        Term::Capture(_) => Ok(Type::Span),
        Term::Const(name, _) => Ok(constants(name)),
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
            for arg in args {
                if let Arg::Term(arg) = arg {
                    let ty = term_type_in(arg, constants)?;
                    if call == "split" || call == "tag" || call == "classify" {
                        if let Some(problem) = expected_problem(ty, Type::String) {
                            let signature = match call.as_str() {
                                "split" => "two strings",
                                "tag" => "one string",
                                _ => "a string and a classifier's name",
                            };
                            return Err(Fault::in_term(format!("{call} takes {signature}: {problem}"), term));
                        }
                    }
                }
            }
            Ok(call_type(call))
        }
    }
}

/// Why a condition's terms do not agree in type, or `None` (engine §10).
pub(crate) fn cond_type_problem(cond: &Cond) -> Option<String> {
    cond_type_fault(cond, &unknown).map(|fault| fault.problem)
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
        Cond::Matches(..) | Cond::Begins(..) | Cond::Initial(_) | Cond::Captured(_) => None,
    }
}

/// Why a term that must be a tag set, a constituent's or an item's, is
/// not one, or `None`.
pub(crate) fn tag_term_problem(term: &Term) -> Option<String> {
    tag_term_fault(term, &unknown).map(|fault| fault.problem)
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
        EmitItem::Capture(_, tags, ..) => tags.as_ref(),
        EmitItem::Insert(_) => None,
    });
    rule.tags
        .iter()
        .chain(rule.alternatives.iter().filter_map(|alternative| alternative.tags.as_ref()))
        .chain(items)
        .find_map(|term| tag_term_fault(term, constants))
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
}

/// The type of a constant's value, or why it cannot be one (engine §2,
/// §10): a string, a set of strings or a tag set. A redefinition keeps the
/// constant's type, which gives `∅` its kind, so its value can be of open
/// kind.
pub(crate) fn constant_value_type(value: &Term, redefine: bool, constants: ConstantTypes) -> Result<Type, Fault> {
    match term_type_in(value, constants)? {
        Type::Span => Err(Fault::in_term("a constant's value is a string or a set, never a span".to_string(), value)),
        Type::Set if !redefine => {
            Err(Fault::in_term("the kind of the set that the constant holds is not given".to_string(), value))
        }
        ty => Ok(ty),
    }
}
