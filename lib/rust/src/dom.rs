//! The grammar DOM of `docs/output.md`: what reading a grammar document
//! produces, what `data/preparsed/gencmu.json` and `data/preparsed/FAMILY.json` hold, and what
//! stitching and lowering read.

pub(crate) mod partial;
pub(crate) mod schema;
pub(crate) mod shape;
pub(crate) mod source;
pub(crate) mod writing;
use source::{SourceHead, SourceSymbol};
pub(crate) fn dom_problem(dom: &crate::json::Json, unicode: &crate::unicode::Unicode) -> Option<String> {
    dom_fault(dom, unicode).map(|fault| fault.problem)
}

/// The first fault of a supplied DOM, in the order of engine §9.3 step 5.
pub(crate) fn dom_fault(dom: &crate::json::Json, unicode: &crate::unicode::Unicode) -> Option<schema::DomFault> {
    let cleaned = known_dom_members(dom);
    let dom = cleaned.as_ref().unwrap_or(dom);
    schema::validate(dom, unicode, false, None)
}

/// The first fault of a DOM whose typed form is at hand, as when a reader
/// has just read it (engine §9.3 step 5).
pub(crate) fn validate_typed(
    dom: &crate::json::Json,
    typed: &mut Dom,
    unicode: &crate::unicode::Unicode,
) -> Option<schema::DomFault> {
    schema::validate(dom, unicode, false, Some(typed))
}

fn known_dom_members(dom: &Json) -> Option<Json> {
    // Unknown directive members carry no grammar nodes.
    if dom.get("directives").and_then(crate::json::Json::as_array).is_some_and(|items| {
        items.iter().any(|item| {
            item.as_object().is_some_and(|fields| {
                fields.iter().any(|(key, _)| !["name", "args", "steps", "conditions", "at"].contains(&key.as_str()))
            })
        })
    }) {
        let mut cleaned = dom.clone();
        if let crate::json::Json::Obj(fields) = &mut cleaned {
            for (key, value) in fields {
                if key == "directives" {
                    if let crate::json::Json::Arr(items) = value {
                        for item in items {
                            if let crate::json::Json::Obj(fields) = item {
                                fields.retain(|(key, _)| {
                                    ["name", "args", "steps", "conditions", "at"].contains(&key.as_str())
                                });
                            }
                        }
                    }
                }
            }
        }
        Some(cleaned)
    } else {
        None
    }
}

use crate::fxhash::FxSet;
use crate::json::{write_str, Json};
use crate::unicode::Unicode;

/// The DOM format version (`docs/output.md`), part of every cache key.
pub const DOM_FORMAT: i64 = 50;

#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct Dom {
    pub names_dependencies: Option<std::collections::BTreeMap<String, String>>,
    pub rules: Vec<RuleDef>,
    pub directives: Vec<Directive>,
    pub constants: Vec<ConstDef>,
    pub classifiers: Vec<ClassifierDef>,
    pub implications: Vec<ImplicationDef>,
    pub unresolved: bool,
}

/// A `%classifier NAME` item (engine §2): its name, which begins with `a`
/// to `z`, and its entries in the order written. Every item of one name in
/// a stage adds to one classifier.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ClassifierDef {
    pub name: String,
    /// Where the name stands, when a reader wrote it.
    pub name_at: Unseen<Option<(usize, usize)>>,
    pub entries: Vec<Entry>,
    pub at: (usize, usize),
}

/// A classifier entry holds gates, unresolved string keys, and a class.
/// It adds (`∈`) or removes (`∉`) that class (engine §2).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Entry {
    pub gates: Vec<Gate>,
    pub keys: Vec<Term>,
    pub adds: bool,
    pub class: String,
    /// Where the class stands, when a reader wrote it.
    pub class_at: Unseen<Option<(usize, usize)>>,
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
    if name.contains("--") {
        return false;
    }
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
    /// Where the name stands, when a reader wrote it.
    pub name_at: Unseen<Option<(usize, usize)>>,
    pub redefine: bool,
    pub value: Term,
    pub at: (usize, usize),
}

/// Whether a string is a constant's name without its `$`: a name that
/// begins with `A` to `Z` (engine §2).
pub(crate) fn is_constant_name(name: &str) -> bool {
    if name.contains("--") {
        return false;
    }
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
    pub source: SourceHead,
    pub deferred_emission: Option<crate::clauses::DefinitionIssue>,
    pub name: String,
    /// Where the name stands, when a reader wrote it.
    pub name_at: Unseen<Option<(usize, usize)>>,
    pub op: Op,
    pub tags: Option<Term>,
    /// Where the header tags clause and its term stand, when a reader
    /// wrote them.
    pub tags_at: Unseen<ClauseAt>,
    /// Where the other parts of the definition stand, when a reader wrote
    /// them.
    pub places: Unseen<RulePlaces>,
    pub strings: Channels,
    pub alternatives: Vec<Alternative>,
    pub emit: Option<Vec<EmitItem>>,
    pub conditions: Vec<Cond>,
    /// Per condition, its form as its template writes it, where it held
    /// a parameter (engine §3.6), for a rule that template expansion wrote.
    pub template_conditions: Vec<Option<Cond>>,
    /// `%erased` contributes no strings or emission parts (engine §11).
    pub erased: bool,
    pub error: Option<Term>,
    pub warning: Option<Term>,
    pub suppress_warnings: Vec<String>,
    pub at: (usize, usize),
}

/// What kind of feature a name is (engine §13), as each gate that uses it
/// says.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FeatureKind {
    /// A gate, `f?` or `¬f?`: its alternatives are kept only while the
    /// feature is on, or off.
    Gate,
    /// A warning code, named by its reporting rule (engine §12).
    Warning,
}

/// A feature gate, optionally negated.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Gate {
    pub feature: String,
    pub kind: FeatureKind,
    pub negated: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Alternative {
    pub gates: Vec<Gate>,
    pub expr: Expr,
    pub tags: Option<Term>,
    /// Where the alternative tags clause and its term stand, when a reader
    /// wrote them.
    pub tags_at: Unseen<ClauseAt>,
    pub strings: Channels,
    /// Where the alternative stands, when a reader wrote it.
    pub at: Unseen<Option<(usize, usize)>>,
}

/// A value that a reader knows and a DOM does not hold, which equality
/// ignores (engine §9.3).
#[derive(Clone, Copy, Default)]
pub(crate) struct Unseen<T>(pub T);

impl<T> PartialEq for Unseen<T> {
    fn eq(&self, _: &Unseen<T>) -> bool {
        true
    }
}

impl<T> std::fmt::Debug for Unseen<T> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("_")
    }
}

impl<T> std::ops::Deref for Unseen<T> {
    type Target = T;
    fn deref(&self) -> &T {
        &self.0
    }
}

/// Where a tag clause stands, and where its term does.
#[derive(Clone, Copy, Default)]
pub(crate) struct ClauseAt {
    pub clause: Option<(usize, usize)>,
    pub term: Option<(usize, usize)>,
}

/// Where the parts of a definition stand, as a reader knows them.
#[derive(Clone, Default)]
pub(crate) struct RulePlaces {
    /// The position of each template parameter of the head.
    pub param_ats: Vec<(usize, usize)>,
    /// Whether a binding was written with a head call.
    pub has_head: bool,
    /// The emission clause, and each of its items.
    pub emit_at: Option<(usize, usize)>,
    pub item_ats: Vec<(usize, usize)>,
    /// The tag term of each emission item that has one.
    pub item_tags_ats: Vec<Option<(usize, usize)>>,
    /// The `%error` and `%warning` clauses.
    pub error_at: Option<(usize, usize)>,
    pub warning_at: Option<(usize, usize)>,
}

/// The position of an expression node, when it is known, which its DOM
/// holds: a supplied DOM can omit it on any expression node but a call or
/// a parameter. A reader also knows whether parentheses group the node,
/// which the DOM does not hold and equality ignores (engine §9.3).
#[derive(Clone, Copy, Default)]
pub(crate) struct ExprAt {
    pub at: Option<(usize, usize)>,
    pub grouped: bool,
}

impl From<Option<(usize, usize)>> for ExprAt {
    fn from(at: Option<(usize, usize)>) -> ExprAt {
        ExprAt { at, grouped: false }
    }
}

impl PartialEq for ExprAt {
    fn eq(&self, other: &ExprAt) -> bool {
        self.at == other.at
    }
}

impl std::fmt::Debug for ExprAt {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.at.fmt(formatter)
    }
}

/// What a reader knows of a term or a condition and a DOM does not hold:
/// where it stands in its document, and whether parentheses group it
/// (engine §9.3). Two terms that differ only here are equal.
/// The position is held in two 32-bit halves, line 0 for none, so that
/// every term stays small.
#[derive(Clone, Copy, Default)]
pub(crate) struct Hidden {
    line: u32,
    column: u32,
    pub grouped: bool,
}

impl Hidden {
    pub(crate) const NONE: Hidden = Hidden { line: 0, column: 0, grouped: false };

    pub(crate) fn at(at: (usize, usize)) -> Hidden {
        let mut hidden = Hidden::NONE;
        hidden.set(Some(at));
        hidden
    }

    /// Where the node stands, when a reader knows it.
    pub(crate) fn position(&self) -> Option<(usize, usize)> {
        (self.line > 0).then_some((self.line as usize, self.column as usize))
    }

    /// Sets where the node stands. A position past what 32 bits hold is
    /// none.
    pub(crate) fn set(&mut self, at: Option<(usize, usize)>) {
        (self.line, self.column) = at
            .and_then(|(line, column)| Some((u32::try_from(line).ok()?, u32::try_from(column).ok()?)))
            .unwrap_or((0, 0));
    }
}

impl PartialEq for Hidden {
    fn eq(&self, _: &Hidden) -> bool {
        true
    }
}

impl std::fmt::Debug for Hidden {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("_")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Expr {
    Source(SourceSymbol, Hidden),
    Seq(Vec<Expr>, ExprAt),
    Choice(Vec<Expr>, ExprAt),
    Ranked(Vec<Expr>, ExprAt),
    And(Vec<Expr>, ExprAt),
    /// An optional `[x]`, or an elidable optional `[+T x]` (§3.8).
    Optional(Box<Expr>, Mark, Option<DefaultValue>, ExprAt),
    /// Braces: the item, the separator after `/` if any, and a chain's
    /// direction, from its marker `...` (engine §3.2, §3.3).
    Repeat(Box<Expr>, Option<Box<Expr>>, Option<Chain>, ExprAt),
    Splice(Box<Expr>, ExprAt),
    Ref(String, ExprAt),
    Terminal(String, ExprAt),
    Literal(Term, ExprAt),
    ScalarRange(Term, Term, ExprAt),
    /// A bound range's scalar endpoints, with the start not above the end.
    Range(char, char, ExprAt),
    /// The wildcard `_`, which reads any ordinary token.
    Wildcard(ExprAt),
    Capture(String, Box<Expr>, ExprAt),
    /// A symbol with `=`, `≠`, or signed `tags` requirements (§2, §4).
    /// The closed operand precedes the wrapped symbol in this representation.
    Tested(String, Term, Box<Expr>, ExprAt),
    Empty(ExprAt),
    Remainder(ExprAt),
}

impl Expr {
    pub(crate) fn at(&self) -> Option<(usize, usize)> {
        match self {
            Self::Source(symbol, ..) => Some(symbol.at()),
            expr => expr.place().and_then(|place| place.at),
        }
    }

    /// Whether parentheses group the expression (engine §9.3).
    pub(crate) fn grouped(&self) -> bool {
        match self {
            Self::Source(_, hidden) => hidden.grouped,
            expr => expr.place().is_some_and(|place| place.grouped),
        }
    }

    /// Marks the expression as grouped by parentheses.
    pub(crate) fn group(&mut self) {
        match self {
            Self::Source(_, hidden) => hidden.grouped = true,
            expr => {
                if let Some(place) = expr.place_mut() {
                    place.grouped = true;
                }
            }
        }
    }

    pub(crate) fn place(&self) -> Option<&ExprAt> {
        match self {
            Self::Source(..) => None,
            Self::Seq(_, at)
            | Self::Choice(_, at)
            | Self::Ranked(_, at)
            | Self::And(_, at)
            | Self::Optional(_, _, _, at)
            | Self::Repeat(_, _, _, at)
            | Self::Splice(_, at)
            | Self::Ref(_, at)
            | Self::Terminal(_, at)
            | Self::Literal(_, at)
            | Self::ScalarRange(_, _, at)
            | Self::Range(_, _, at)
            | Self::Wildcard(at)
            | Self::Capture(_, _, at)
            | Self::Tested(_, _, _, at)
            | Self::Empty(at)
            | Self::Remainder(at) => Some(at),
        }
    }

    pub(crate) fn place_mut(&mut self) -> Option<&mut ExprAt> {
        match self {
            Self::Source(..) => None,
            Self::Seq(_, at)
            | Self::Choice(_, at)
            | Self::Ranked(_, at)
            | Self::And(_, at)
            | Self::Optional(_, _, _, at)
            | Self::Repeat(_, _, _, at)
            | Self::Splice(_, at)
            | Self::Ref(_, at)
            | Self::Terminal(_, at)
            | Self::Literal(_, at)
            | Self::ScalarRange(_, _, at)
            | Self::Range(_, _, at)
            | Self::Wildcard(at)
            | Self::Capture(_, _, at)
            | Self::Tested(_, _, _, at)
            | Self::Empty(at)
            | Self::Remainder(at) => Some(at),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DefaultValue {
    pub term: Term,
    pub at: Option<(usize, usize)>,
}

/// The marker of an optional (engine §3.8): none, `+` for an elidable
/// optional.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Mark {
    Plain,
    Elidable,
}

/// The direction of a chain (engine §3.3): `{... x / s}` nests from the
/// left, `{x ... / s}` from the right.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Chain {
    Left,
    Right,
}

/// A term, including captures and span methods where a span is expected.
/// The capture named `""` is `$`, the whole constituent.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Term {
    Body(std::sync::Arc<Expr>),
    Source(SourceSymbol),
    Pattern(Box<crate::patterns::Pattern>, Hidden),
    /// A string, decoded.
    Str(String, Hidden),
    /// A tag literal: the set of one tag, in its canonical spelling.
    Tag(String, Hidden),
    /// The empty set, with no fixed element type.
    EmptySet(Hidden),
    Union(Vec<Term>, Hidden),
    Intersection(Vec<Term>, Hidden),
    /// `a ∖ b`: the members of the first set that are not in the second.
    Difference(Box<Term>, Box<Term>, Hidden),
    Call(String, Vec<Arg>, Hidden),
    Capture(String, Hidden),
    /// `A ⟹ t`: `t` where the condition holds, else the empty set.
    If(Box<Cond>, Box<Term>, Hidden),
    /// A reference to a constant, by its name without `$`, and where it
    /// stands. Stitching replaces it with the constant's value (engine §2).
    Const(String, (usize, usize), Hidden),
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Arg {
    Term(Term),
    Rule(String),
    /// The second argument of `classify`, a classifier's name (engine §9).
    Classifier(String),
    /// A positive decimal literal without a machine size limit.
    Integer(String, Hidden),
}

#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct BoundaryLocation {
    pub at: Option<(usize, usize)>,
    pub targets: Vec<(usize, usize)>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Cond {
    Forest(Term, Hidden),
    Truthy(Term, Hidden),
    SourceQuery(String, Vec<Arg>, BoundaryLocation),
    Compare(String, Term, Term, Option<(usize, usize)>),
    /// `initial(s)`: whether the span begins where the parse's input does.
    Initial(Term, Hidden),
    Final(Term, Hidden),
    /// A complete-tree neighbor, with its direction and target choice.
    /// Clones share the annotation's identity even without source locations.
    Boundary(bool, Term, Vec<String>, std::sync::Arc<BoundaryLocation>),
    Not(Box<Cond>, Hidden),
    Any(Vec<Cond>, Hidden),
    All(Vec<Cond>, Hidden),
    /// `$x` standing as a condition: whether the production has the capture.
    Captured(String, Hidden),
    /// `A ⟹ B`.
    If(Box<Cond>, Box<Cond>, Hidden),
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
    pub conditions: Option<Vec<Cond>>,
    pub name: String,
    /// The operands of every directive but `%ambiguity-resolution`.
    pub args: Vec<String>,
    /// The steps of `%ambiguity-resolution`, and None for every other
    /// directive (engine §9.3).
    pub steps: Option<Vec<Step>>,
    pub at: (usize, usize),
}

/// One step of `%ambiguity-resolution`: a key step with its pattern, or a
/// lean with none (engine §6).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Step {
    pub step: String,
    pub pattern: Option<Term>,
    pub operand_at: Option<(usize, usize)>,
}

/// The steps of `%ambiguity-resolution` that take a pattern (engine §6).
pub(crate) const KEY_STEPS: &[&str] = &["leftmost-longest", "fewest", "most", "late", "early"];
/// The steps of `%ambiguity-resolution` that compare actions (engine §6).
pub(crate) const LEANS: &[&str] = &["greedy", "lazy"];

/// Whether steps are a well-formed list: one or more, each a key step with
/// a pattern or a lean, with a lean only last (engine §9.3).
pub(crate) fn valid_steps(steps: &[Step]) -> bool {
    !steps.is_empty()
        && steps.iter().enumerate().all(|(index, step)| match &step.pattern {
            Some(_) => KEY_STEPS.contains(&step.step.as_str()),
            None => LEANS.contains(&step.step.as_str()) && index == steps.len() - 1,
        })
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
    let cleaned = known_dom_members(value);
    let value = cleaned.as_ref().unwrap_or(value);
    // The DOM the validator inspects is the one returned, which keeps
    // what its definition checks find (engine §9.3).
    match decode_nodes(value) {
        Ok(mut dom) => match schema::validate(value, unicode, false, Some(&mut dom)) {
            Some(fault) => Err(fault.problem),
            None => Ok(dom),
        },
        Err(problem) => Err(schema::validate(value, unicode, false, None).map_or(problem, |fault| fault.problem)),
    }
}

pub(crate) fn decode_nodes(value: &Json) -> R<Dom> {
    let rules = array(value, "rules")?.iter().map(rule_from_json).collect::<R<Vec<_>>>()?;
    let directives = array(value, "directives")?
        .iter()
        .map(|directive| {
            Ok(Directive {
                conditions: directive
                    .get("conditions")
                    .map(|_| array(directive, "conditions")?.iter().map(cond_from_json).collect::<R<Vec<_>>>())
                    .transpose()?,
                name: string(directive, "name")?,
                args: match directive.get("args") {
                    Some(_) => array(directive, "args")?
                        .iter()
                        .map(|arg| {
                            arg.as_str().map(str::to_string).ok_or_else(|| "a bad directive argument".to_string())
                        })
                        .collect::<R<Vec<_>>>()?,
                    None => Vec::new(),
                },
                steps: directive.get("steps").map(steps_from_json).transpose()?,
                at: position(directive)?,
            })
        })
        .collect::<R<Vec<_>>>()?;
    let constants = array(value, "constants")?
        .iter()
        .map(|constant| {
            Ok(ConstDef {
                name: string(constant, "name")?,
                name_at: crate::dom::Unseen(None),
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
                name_at: crate::dom::Unseen(None),
                entries: array(classifier, "entries")?
                    .iter()
                    .map(|entry| {
                        Ok(Entry {
                            gates: array(entry, "gates")?.iter().map(gate_from_json).collect::<R<Vec<_>>>()?,
                            keys: array(entry, "keys")?.iter().map(term_from_json).collect::<R<Vec<_>>>()?,
                            adds: string(entry, "op")? == "∈",
                            class: string(entry, "class")?,
                            class_at: crate::dom::Unseen(None),
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
    let unresolved = crate::parameters::unresolved(value);
    Ok(Dom { rules, directives, constants, classifiers, implications, unresolved, ..Dom::default() })
}

pub(crate) fn requirements_from_json(value: &Json) -> R<Term> {
    let items = array(value, "requirements")?
        .iter()
        .map(|requirement| {
            let value = term_from_json(field(requirement, "value")?)?;
            Ok(Arg::Term(if is_true(requirement.get("negated")) {
                Term::Call("forbid".into(), vec![Arg::Term(value)], crate::dom::Hidden::NONE)
            } else {
                value
            }))
        })
        .collect::<R<Vec<_>>>()?;
    Ok(Term::Call("requirements".into(), items, crate::dom::Hidden::NONE))
}

pub(crate) fn is_engine_tag(name: &str) -> bool {
    schema::engine_tag(name)
}

fn channels_from_json(value: &Json) -> R<Channels> {
    Ok(Channels {
        value: value.get("value").map(term_from_json).transpose()?,
        image: value.get("image").map(term_from_json).transpose()?,
        ..Channels::default()
    })
}

fn gate_from_json(gate: &Json) -> R<Gate> {
    Ok(Gate {
        feature: string(gate, "feature")?,
        kind: match string(gate, "kind")?.as_str() {
            "gate" => FeatureKind::Gate,
            _ => return Err("a bad guard".to_string()),
        },
        negated: field(gate, "negated")?.as_bool().ok_or("a bad guard")?,
    })
}

/// The steps of `%ambiguity-resolution`.
pub(crate) fn steps_from_json(value: &Json) -> R<Vec<Step>> {
    value
        .as_array()
        .ok_or("malformed ranking steps")?
        .iter()
        .map(|step| {
            if !step
                .as_object()
                .is_some_and(|fields| fields.iter().all(|(key, _)| matches!(key.as_str(), "step" | "pattern" | "\0at")))
            {
                return Err("a malformed ranking step".into());
            }
            Ok(Step {
                step: string(step, "step")?,
                pattern: step
                    .get("pattern")
                    .map(|operand| {
                        if operand.get("const").is_some() {
                            term_from_json(operand)
                        } else {
                            crate::patterns::Pattern::from_json(operand)
                                .map(|p| Term::Pattern(Box::new(p), crate::dom::Hidden::NONE))
                        }
                    })
                    .transpose()?,
                operand_at: None,
            })
        })
        .collect()
}

pub(crate) fn rule_from_json(value: &Json) -> R<RuleDef> {
    let op = match string(value, "op")?.as_str() {
        "define" => Op::Define,
        "redefine" => Op::Redefine,
        "extend" => Op::Extend,
        other => return Err(format!("an unknown rule op {other:?}")),
    };
    Ok(RuleDef {
        places: Default::default(),
        source: SourceHead::from_json(value)?,
        deferred_emission: None,
        name: string(value, "name")?,
        name_at: crate::dom::Unseen(None),
        op,
        tags: value.get("tags").map(term_from_json).transpose()?,
        tags_at: Default::default(),
        strings: channels_from_json(value)?,
        alternatives: if value.get("instance").is_some() { &[] } else { array(value, "alternatives")? }
            .iter()
            .map(|alternative| {
                Ok(Alternative {
                    at: Default::default(),
                    gates: array(alternative, "gates")?.iter().map(gate_from_json).collect::<R<Vec<_>>>()?,
                    expr: expr_from_json(field(alternative, "expr")?)?,
                    tags: alternative.get("tags").map(term_from_json).transpose()?,
                    tags_at: Default::default(),
                    strings: channels_from_json(alternative)?,
                })
            })
            .collect::<R<Vec<_>>>()?,
        emit: value.get("emit").map(emit_from_json).transpose()?,
        conditions: array(value, "conditions")?.iter().map(cond_from_json).collect::<R<Vec<_>>>()?,
        template_conditions: Vec::new(),
        error: value.get("error").map(term_from_json).transpose()?,
        warning: value.get("warning").map(term_from_json).transpose()?,
        suppress_warnings: value
            .get("suppressWarnings")
            .and_then(Json::as_array)
            .unwrap_or(&[])
            .iter()
            .map(|v| v.as_str().map(String::from).ok_or_else(|| "a malformed suppression code".into()))
            .collect::<R<_>>()?,
        erased: is_true(value.get("erased")),
        at: position(value)?,
    })
}

/// A position, from its JSON pair.
fn position_value(value: &Json) -> Option<(usize, usize)> {
    match value.as_array()? {
        [Json::Int(line), Json::Int(column)] if *line >= 1 && *column >= 1 => Some((*line as usize, *column as usize)),
        _ => None,
    }
}

fn first_key(value: &Json) -> R<&str> {
    const FORMS: &[&str] = &[
        "splice",
        "seq",
        "choice",
        "ranked",
        "and",
        "optional",
        "repeat",
        "ref",
        "literal",
        "wildcard",
        "range",
        "capture",
        "empty",
        "string",
        "tag",
        "const",
        "emptySet",
        "method",
        "union",
        "intersection",
        "difference",
        "if",
        "concat",
        "pattern",
        "op",
        "not",
        "any",
        "all",
        "captured",
        "param",
        "call",
    ];
    let members = value.as_object().ok_or("not a JSON object")?;
    members
        .iter()
        .find(|(k, _)| FORMS.contains(&k.as_str()))
        .or_else(|| members.first())
        .map(|(k, _)| k.as_str())
        .ok_or_else(|| "an empty JSON object".into())
}

pub(crate) fn json_at(value: &Json) -> Option<(usize, usize)> {
    match value.get("at") {
        Some(Json::Arr(pair)) => match pair.as_slice() {
            [Json::Int(line), Json::Int(column)] if *line >= 1 && *column >= 1 => {
                Some((*line as usize, *column as usize))
            }
            _ => None,
        },
        _ => None,
    }
}

fn expr_at(value: &Json) -> ExprAt {
    ExprAt { at: json_at(value), grouped: shape::hidden(value, "grouped") == Some(&Json::Bool(true)) }
}

fn expr_from_json(value: &Json) -> R<Expr> {
    enum Task<'a> {
        Read(&'a Json),
        List(&'a str, usize, ExprAt),
        Tested(String, Term, ExprAt),
        Optional(ExprAt, Mark, Option<DefaultValue>),
        Repeat(Option<Chain>, bool, ExprAt),
        Capture(String, ExprAt),
        Splice(ExprAt),
    }
    let mut pending = vec![Task::Read(value)];
    let mut values = Vec::new();
    while let Some(task) = pending.pop() {
        let expression = match task {
            Task::Read(value) => {
                // Tests take priority over the order of their object members.
                if value.get("test").is_some() {
                    let op = string(value, "test")?;
                    let term = if op == "tags" {
                        requirements_from_json(value)?
                    } else {
                        term_from_json(field(value, "value")?)?
                    };
                    pending.push(Task::Tested(op, term, expr_at(value)));
                    pending.push(Task::Read(field(value, "expr")?));
                    continue;
                }
                match first_key(value)? {
                    key @ ("seq" | "choice" | "ranked" | "and") => {
                        let items = array(value, key)?;
                        pending.push(Task::List(key, items.len(), expr_at(value)));
                        pending.extend(items.iter().rev().map(Task::Read));
                        continue;
                    }
                    "splice" => {
                        pending.push(Task::Splice(expr_at(value)));
                        pending.push(Task::Read(field(value, "splice")?));
                        continue;
                    }
                    "optional" => {
                        let mark = if is_true(value.get("elidable")) { Mark::Elidable } else { Mark::Plain };
                        pending.push(Task::Optional(
                            expr_at(value),
                            mark,
                            value
                                .get("default")
                                .map(|d| -> R<DefaultValue> {
                                    Ok(DefaultValue {
                                        term: term_from_json(d)?,
                                        at: crate::parameters::locations::source_at(d),
                                    })
                                })
                                .transpose()?,
                        ));
                        pending.push(Task::Read(field(value, "optional")?));
                        continue;
                    }
                    "repeat" => {
                        let separator = value.get("separator");
                        let chain = match value.get("chain").and_then(Json::as_str) {
                            None => None,
                            Some("left") => Some(Chain::Left),
                            Some("right") => Some(Chain::Right),
                            Some(_) => return Err("a bad chain".to_string()),
                        };
                        pending.push(Task::Repeat(chain, separator.is_some(), expr_at(value)));
                        pending.push(Task::Read(field(value, "repeat")?));
                        pending.extend(separator.map(Task::Read));
                        continue;
                    }
                    "ref" => Expr::Ref(string(value, "ref")?, expr_at(value)),
                    "literal" => Expr::Literal(term_from_json(field(value, "literal")?)?, expr_at(value)),
                    "wildcard" => Expr::Wildcard(expr_at(value)),
                    "remainder" => Expr::Remainder(expr_at(value)),
                    "range" => match array(value, "range")? {
                        [start, end] => Expr::ScalarRange(term_from_json(start)?, term_from_json(end)?, expr_at(value)),
                        _ => return Err("a range requires two string terms".into()),
                    },
                    "capture" => {
                        pending.push(Task::Capture(string(value, "capture")?, expr_at(value)));
                        pending.push(Task::Read(field(value, "expr")?));
                        continue;
                    }
                    "param" | "call" => Expr::Source(
                        SourceSymbol::from_json(value)?,
                        Hidden { grouped: shape::hidden(value, "grouped") == Some(&Json::Bool(true)), ..Hidden::NONE },
                    ),
                    "empty" => Expr::Empty(expr_at(value)),
                    other => return Err(format!("an unknown expression {other:?}")),
                }
            }
            Task::List(key, count, at) => {
                let items = values.split_off(values.len() - count);
                match key {
                    "seq" => Expr::Seq(items, at),
                    "choice" => Expr::Choice(items, at),
                    "ranked" => Expr::Ranked(items, at),
                    "and" => Expr::And(items, at),
                    _ => unreachable!(),
                }
            }
            Task::Tested(op, term, at) => Expr::Tested(op, term, Box::new(values.pop().unwrap()), at),
            Task::Optional(at, mark, default) => Expr::Optional(Box::new(values.pop().unwrap()), mark, default, at),
            Task::Repeat(chain, separated, at) => {
                let item = Box::new(values.pop().unwrap());
                let separator = separated.then(|| Box::new(values.pop().unwrap()));
                Expr::Repeat(item, separator, chain, at)
            }
            Task::Splice(at) => Expr::Splice(Box::new(values.pop().unwrap()), at),
            Task::Capture(name, at) => Expr::Capture(name, Box::new(values.pop().unwrap()), at),
        };
        values.push(expression);
    }
    Ok(values.pop().unwrap())
}

pub(crate) fn term_from_json(value: &Json) -> R<Term> {
    match read_value(value, false)? {
        ReadValue::Term(term) => Ok(term),
        _ => unreachable!(),
    }
}

pub(crate) fn cond_from_json(value: &Json) -> R<Cond> {
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
                "method" => {
                    children.push((field(value, "receiver")?, false));
                    if matches!(value.get("method").and_then(Json::as_str), Some("parse")) {
                        children.extend(array(value, "args")?.iter().map(|argument| (argument, false)));
                    } else if matches!(
                        value.get("method").and_then(Json::as_str),
                        Some("tags" | "classes" | "split" | "ngrams" | "classify")
                    ) {
                        children.extend(
                            array(value, "args")?
                                .iter()
                                .filter(|arg| {
                                    arg.get("rule").is_none()
                                        && arg.get("classifier").is_none()
                                        && arg.get("integer").is_none()
                                })
                                .map(|argument| (argument, false)),
                        );
                    }
                }
                "not" => children.push((field(value, "not")?, true)),
                "any" | "all" => children.extend(array(value, key)?.iter().map(|child| (child, true))),
                "if" => {
                    children.push((field(value, "if")?, true));
                    children.push((field(value, "then")?, true));
                }
                "captured" => {}
                "nonempty" => children.push((field(value, "nonempty")?, false)),
                _ => return Err(format!("an unknown condition {key:?}")),
            }
        } else {
            match key {
                "union" | "intersection" | "difference" | "concat" => {
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
                            .filter(|arg| {
                                arg.get("rule").is_none()
                                    && arg.get("classifier").is_none()
                                    && arg.get("integer").is_none()
                            })
                            .map(|arg| (arg, false)),
                    );
                }
                "body" | "pattern" | "string" | "tag" | "emptySet" | "capture" | "const" | "param" | "call" => {}
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
                    Default::default(),
                ),
                "method" => {
                    let receiver = operands.next().unwrap().term();
                    let name = string(value, "method")?;
                    if matches!(name.as_str(), "tags" | "classes" | "split" | "ngrams" | "classify") {
                        return Err("a malformed query predicate".into());
                    }
                    if matches!(name.as_str(), "parse" | "error-free") {
                        let args = std::iter::once(Arg::Term(receiver))
                            .chain(operands.map(|operand| Arg::Term(operand.term())))
                            .collect();
                        values.push(ReadValue::Cond(Cond::Forest(
                            Term::Call(name, args, crate::dom::Hidden::NONE),
                            crate::dom::Hidden::NONE,
                        )));
                        continue;
                    }
                    if array(value, "args")?.iter().any(|arg| arg.get("param").is_some() || arg.get("call").is_some()) {
                        let mut args = vec![Arg::Term(receiver)];
                        for arg in array(value, "args")? {
                            args.push(if arg.get("rule").is_some() {
                                Arg::Rule(string(arg, "rule")?)
                            } else if arg.get("terminal").is_some() {
                                Arg::Term(Term::Tag(string(arg, "terminal")?, crate::dom::Hidden::NONE))
                            } else {
                                Arg::Term(term_from_json(arg)?)
                            });
                        }
                        values.push(ReadValue::Cond(Cond::SourceQuery(name, args, BoundaryLocation::default())));
                        continue;
                    }
                    match (name.as_str(), array(value, "args")?) {
                        ("starts-input", []) => Cond::Initial(receiver, crate::dom::Hidden::NONE),
                        ("ends-input", []) => Cond::Final(receiver, crate::dom::Hidden::NONE),
                        ("followed-by" | "preceded-by", args) => Cond::Boundary(
                            name == "followed-by",
                            receiver,
                            args.iter()
                                .map(|arg| string(arg, if arg.get("rule").is_some() { "rule" } else { "terminal" }))
                                .collect::<R<Vec<_>>>()?,
                            BoundaryLocation::default().into(),
                        ),
                        _ => return Err("a malformed predicate method".into()),
                    }
                }
                "nonempty" => Cond::Truthy(operands.next().unwrap().term(), crate::dom::Hidden::NONE),
                "not" => Cond::Not(Box::new(operands.next().unwrap().cond()), crate::dom::Hidden::NONE),
                "any" => Cond::Any(operands.map(ReadValue::cond).collect(), crate::dom::Hidden::NONE),
                "all" => Cond::All(operands.map(ReadValue::cond).collect(), crate::dom::Hidden::NONE),
                "captured" => Cond::Captured(string(value, "captured")?, crate::dom::Hidden::NONE),
                "if" => Cond::If(
                    Box::new(operands.next().unwrap().cond()),
                    Box::new(operands.next().unwrap().cond()),
                    crate::dom::Hidden::NONE,
                ),
                _ => unreachable!(),
            })
        } else {
            ReadValue::Term(match key {
                "body" => Term::Body(std::sync::Arc::new(expr_from_json(field(value, "body")?)?)),
                "pattern" => Term::Pattern(
                    Box::new(crate::patterns::Pattern::from_json(field(value, "pattern")?)?),
                    crate::dom::Hidden::NONE,
                ),
                "string" => Term::Str(string(value, "string")?, crate::dom::Hidden::NONE),
                "tag" => Term::Tag(string(value, "tag")?, crate::dom::Hidden::NONE),
                "emptySet" => Term::EmptySet(crate::dom::Hidden::NONE),
                "capture" => Term::Capture(string(value, "capture")?, crate::dom::Hidden::NONE),
                "const" => Term::Const(string(value, "const")?, position(value)?, crate::dom::Hidden::NONE),
                "param" | "call" => Term::Source(SourceSymbol::from_json(value)?),
                "union" => Term::Union(operands.map(ReadValue::term).collect(), crate::dom::Hidden::NONE),
                "intersection" => Term::Intersection(operands.map(ReadValue::term).collect(), crate::dom::Hidden::NONE),
                "difference" => {
                    let left = operands.next().ok_or("a difference lacks its left operand")?.term();
                    let right = operands.next().ok_or("a difference lacks its right operand")?.term();
                    Term::Difference(Box::new(left), Box::new(right), crate::dom::Hidden::NONE)
                }
                "if" => Term::If(
                    Box::new(operands.next().unwrap().cond()),
                    Box::new(operands.next().unwrap().term()),
                    crate::dom::Hidden::NONE,
                ),
                "concat" => Term::Call(
                    key.into(),
                    operands.map(|value| Arg::Term(value.term())).collect(),
                    crate::dom::Hidden::NONE,
                ),
                "method" => {
                    let mut args = vec![Arg::Term(operands.next().unwrap().term())];
                    for arg in array(value, "args")? {
                        if let Some(Json::Str(digits)) = arg.get("integer") {
                            args.push(Arg::Integer(digits.clone(), {
                                let mut hidden = Hidden::NONE;
                                hidden.set(shape::hidden(arg, "at").and_then(position_value));
                                hidden
                            }));
                            continue;
                        }
                        args.push(match (arg.get("rule"), arg.get("classifier")) {
                            (Some(Json::Str(name)), _) => Arg::Rule(name.clone()),
                            (_, Some(Json::Str(name))) => Arg::Classifier(name.clone()),
                            _ => Arg::Term(operands.next().unwrap().term()),
                        });
                    }
                    Term::Call(string(value, "method")?, args, crate::dom::Hidden::NONE)
                }
                _ => unreachable!(),
            })
        };
        let mut built = built;
        // A located DOM keeps what a reader knows of each node.
        let hidden = match &mut built {
            ReadValue::Term(term) => term.hidden_mut(),
            ReadValue::Cond(cond) => cond.hidden_mut(),
        };
        if let Some(hidden) = hidden {
            hidden.set(shape::hidden(value, "at").and_then(position_value));
            hidden.grouped = shape::hidden(value, "grouped") == Some(&Json::Bool(true));
        }
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
pub(crate) const DOM_MAX_POSITION: i64 = 9007199254740991;

fn is_true(value: Option<&Json>) -> bool {
    matches!(value, Some(Json::Bool(true)))
}

fn is_position(value: Option<&Json>) -> bool {
    matches!(value.and_then(Json::as_array), Some([Json::Int(line), Json::Int(column)]) if (1..=DOM_MAX_POSITION).contains(line) && (1..=DOM_MAX_POSITION).contains(column))
}

/// A capture name starts with a lowercase ASCII letter and contains no capitals.
pub(crate) fn is_capture_name(name: &str) -> bool {
    if name.contains("--") {
        return false;
    }
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

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
        if let Some(steps) = &directive.steps {
            write_steps(&mut out, steps);
        } else {
            out.push_str(",\"args\":[");
            for (index, arg) in directive.args.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_str(&mut out, arg);
            }
            out.push(']');
        }
        out.push_str(&format!(",\"at\":[{},{}]", directive.at.0, directive.at.1));
        if let Some(conditions) = &directive.conditions {
            out.push_str(",\"conditions\":[");
            for (index, condition) in conditions.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_cond(&mut out, condition);
            }
            out.push(']');
        }
        out.push('}');
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
        out.push_str(&hidden_member("nameAt", *constant.name_at));
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
            out.push_str("{\"gates\":[");
            for (index, gate) in entry.gates.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_gate(&mut out, gate);
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
            out.push_str(&hidden_member("classAt", *entry.class_at));
            out.push_str(&format!(",\"at\":[{},{}]}}", entry.at.0, entry.at.1));
        }
        out.push(']');
        out.push_str(&hidden_member("nameAt", *classifier.name_at));
        out.push_str(&format!(",\"at\":[{},{}]}}", classifier.at.0, classifier.at.1));
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

/// The `steps` member of `%ambiguity-resolution`.
pub(crate) fn write_steps(out: &mut String, steps: &[Step]) {
    out.push_str(",\"steps\":[");
    for (index, step) in steps.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        out.push_str("{\"step\":");
        write_str(out, &step.step);
        if let Some(pattern) = &step.pattern {
            out.push_str(",\"pattern\":");
            if let Term::Pattern(p, ..) = pattern {
                p.write(out);
            } else {
                write_term(out, pattern);
            }
        }
        out.push_str(&hidden_member("at", step.operand_at));
        out.push('}');
    }
    out.push(']');
}

/// A member that only a located DOM holds, for the DOM validator (engine
/// §9.3): its name begins with NUL.
pub(crate) fn hidden_member(name: &str, at: Option<(usize, usize)>) -> String {
    match at {
        Some((line, column)) if writing::is_located() => format!(",\"\\u0000{name}\":[{line},{column}]"),
        _ => String::new(),
    }
}

/// A Boolean member that only a located DOM holds.
fn hidden_flag(name: &str, value: bool) -> String {
    if value && writing::is_located() {
        format!(",\"\\u0000{name}\":true")
    } else {
        String::new()
    }
}

/// The DOM as JSON with the members that only a reader knows, for the DOM
/// validator (engine §9.3).
pub(crate) fn dom_to_located_json(dom: &Dom) -> String {
    writing::located(|| dom_to_json(dom))
}

pub(crate) fn write_rule(out: &mut String, rule: &RuleDef) {
    out.push_str("{\"name\":");
    write_str(out, &rule.name);
    if let Some(params) = &rule.source.params {
        out.push_str(",\"params\":[");
        for (index, name) in params.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            write_str(out, name);
        }
        out.push(']');
    }
    if let Some(args) = &rule.source.args {
        out.push_str(",\"args\":");
        source::write_arguments(out, args);
    }
    out.push_str(match rule.op {
        Op::Define => ",\"op\":\"define\"",
        Op::Redefine => ",\"op\":\"redefine\"",
        Op::Extend => ",\"op\":\"extend\"",
    });
    if let Some(tags) = &rule.tags {
        out.push_str(",\"tags\":");
        write_term(out, tags);
    }
    write_channels(out, &rule.strings);
    out.push_str(&hidden_member("nameAt", *rule.name_at));
    if writing::is_located() && !rule.places.param_ats.is_empty() {
        out.push_str(",\"\\u0000paramAts\":[");
        for (index, (line, column)) in rule.places.param_ats.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            out.push_str(&format!("[{line},{column}]"));
        }
        out.push(']');
    }
    out.push_str(&hidden_member("errorAt", rule.places.error_at));
    out.push_str(&hidden_member("warningAt", rule.places.warning_at));
    if let Some(instance) = &rule.source.instance {
        out.push_str(&hidden_flag("hasHead", rule.places.has_head));
        out.push_str(",\"instance\":");
        instance.write(out);
        out.push_str(&format!(",\"conditions\":[],\"at\":[{},{}]}}", rule.at.0, rule.at.1));
        return;
    }
    out.push_str(",\"alternatives\":[");
    for (index, alternative) in rule.alternatives.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        out.push_str("{\"gates\":[");
        for (index, gate) in alternative.gates.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            write_gate(out, gate);
        }
        out.push_str("],\"expr\":");
        write_expr(out, &alternative.expr);
        if let Some(tags) = &alternative.tags {
            out.push_str(",\"tags\":");
            write_term(out, tags);
        }
        write_channels(out, &alternative.strings);
        out.push_str(&hidden_member("at", *alternative.at));
        out.push('}');
    }
    out.push(']');
    if let Some(items) = &rule.emit {
        out.push_str(",\"emit\":{\"items\":[");
        for (index, item) in items.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            let item_at = rule.places.item_ats.get(index).copied();
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
            out.push_str(&hidden_member("at", item_at));
            out.push('}');
        }
        out.push(']');
        out.push_str(&hidden_member("at", rule.places.emit_at));
        out.push('}');
    }
    out.push_str(",\"conditions\":[");
    for (index, cond) in rule.conditions.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        write_cond(out, cond);
    }
    out.push(']');
    for (key, term) in [("error", &rule.error), ("warning", &rule.warning)] {
        if let Some(term) = term {
            out.push_str(&format!(",\"{key}\":"));
            write_term(out, term);
        }
    }
    if !rule.suppress_warnings.is_empty() {
        out.push_str(",\"suppressWarnings\":[");
        for (index, code) in rule.suppress_warnings.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            write_str(out, code);
        }
        out.push(']');
    }
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

fn write_gate(out: &mut String, gate: &Gate) {
    out.push_str("{\"feature\":");
    write_str(out, &gate.feature);
    out.push_str(match gate.kind {
        FeatureKind::Gate => ",\"kind\":\"gate\"",
        FeatureKind::Warning => ",\"kind\":\"warning\"",
    });
    out.push_str(if gate.negated { ",\"negated\":true}" } else { ",\"negated\":false}" });
}

pub(crate) fn write_expr(out: &mut String, expr: &Expr) {
    writing::write(out, writing::Part::Expr(expr));
}

pub(crate) fn write_term(out: &mut String, term: &Term) {
    writing::write(out, writing::Part::Term(term));
}

pub(crate) fn write_cond(out: &mut String, cond: &Cond) {
    writing::write(out, writing::Part::Cond(cond));
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
    Forest,
    Body,
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
            Type::Forest => "a forest",
            Type::Body => "a parse body",
            Type::Set => "a set",
            Type::Any => "a value",
        }
    }
}

/// The type of each constant, where the loader knows it (engine §2). The
/// reader knows none, and gives every constant the type `Any`.
pub(crate) type ConstantTypes<'a> = &'a dyn Fn(&str) -> Type;

/// A disagreement of types (engine §10): the problem, where the first
/// constant of the smallest construct that holds it stands, if it holds
/// one, and where that construct itself stands, if a reader wrote it. The
/// loader reports the error at the constant, and the DOM validator at the
/// construct (engine §9.3).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Fault {
    pub problem: String,
    pub at: Option<(usize, usize)>,
    pub node_at: Option<(usize, usize)>,
}

impl Fault {
    pub(crate) fn in_term(problem: String, term: &Term) -> Fault {
        Fault { problem, at: first_constant_in_term(term), node_at: term.at() }
    }

    pub(crate) fn in_cond(problem: String, cond: &Cond) -> Fault {
        Fault { problem, at: first_constant_in_cond(cond), node_at: cond.at() }
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
            Nested::Source(symbol) => stack.extend(source_children(symbol).into_iter().rev()),
            Nested::Term(term) => match term {
                Term::Body(body) => stack.push(Nested::Expr(body)),
                Term::Source(symbol) => stack.push(Nested::Source(symbol)),
                Term::Pattern(p, ..) => stack.push(Nested::Pattern(p)),
                Term::Const(name, at, ..) if engine || !name.starts_with('_') => out.push((name, *at)),
                Term::Const(..) => {}
                Term::Union(items, ..) | Term::Intersection(items, ..) => {
                    stack.extend(items.iter().rev().map(Nested::Term))
                }
                Term::Difference(left, right, ..) => stack.extend([Nested::Term(right), Nested::Term(left)]),
                Term::If(cond, then, ..) => stack.extend([Nested::Term(then), Nested::Cond(cond)]),
                Term::Call(_, args, ..) => stack.extend(args.iter().rev().filter_map(|arg| match arg {
                    Arg::Term(term) => Some(Nested::Term(term)),
                    _ => None,
                })),
                Term::Str(..) | Term::Tag(..) | Term::EmptySet(..) | Term::Capture(..) => {}
            },
            Nested::Cond(cond) => match cond {
                Cond::Truthy(term, ..) => stack.push(Nested::Term(term)),
                Cond::Forest(term, ..) => stack.push(Nested::Term(term)),
                Cond::SourceQuery(_, args, _) => stack.extend(args.iter().rev().filter_map(|arg| match arg {
                    Arg::Term(term) => Some(Nested::Term(term)),
                    _ => None,
                })),
                Cond::Compare(_, left, right, _) => stack.extend([Nested::Term(right), Nested::Term(left)]),
                Cond::Not(inner, ..) => stack.push(Nested::Cond(inner)),
                Cond::Any(items, ..) | Cond::All(items, ..) => stack.extend(items.iter().rev().map(Nested::Cond)),
                Cond::If(antecedent, consequent, ..) => {
                    stack.extend([Nested::Cond(consequent), Nested::Cond(antecedent)])
                }
                Cond::Initial(span, ..) | Cond::Final(span, ..) | Cond::Boundary(_, span, _, _) => {
                    stack.push(Nested::Term(span))
                }
                Cond::Captured(..) => {}
            },
            Nested::Expr(expr) => match expr {
                Expr::Source(symbol, ..) => stack.push(Nested::Source(symbol)),
                Expr::Literal(term, _) => stack.push(Nested::Term(term)),
                Expr::ScalarRange(left, right, _) => stack.extend([Nested::Term(right), Nested::Term(left)]),
                Expr::Tested(_, value, inner, _) => stack.extend([Nested::Term(value), Nested::Expr(inner)]),
                Expr::Seq(items, _) | Expr::Choice(items, _) | Expr::Ranked(items, _) | Expr::And(items, _) => {
                    stack.extend(items.iter().rev().map(Nested::Expr))
                }
                Expr::Capture(_, inner, _) | Expr::Splice(inner, _) | Expr::Optional(inner, _, _, _) => {
                    stack.push(Nested::Expr(inner))
                }
                Expr::Repeat(item, separator, _, _) => {
                    stack.extend(separator.as_deref().map(Nested::Expr));
                    stack.push(Nested::Expr(item));
                }
                _ => {}
            },
            Nested::Pattern(pattern) => {
                if let crate::patterns::Pattern::Constant(name, at) = pattern {
                    out.push((name, *at));
                }
                crate::patterns::Part::Pattern(pattern).push_children(|part| stack.push(part.into()));
            }
            Nested::PatternItems(children) => {
                crate::patterns::Part::Children(children).push_children(|part| stack.push(part.into()));
            }
        }
    }
}

/// The most compound nodes that may stand above a node of an expression,
/// a term or a condition (engine §9).
const MAX_NESTING: usize = DOM_MAX_DEPTH;

/// A node of a DOM that the check of nesting walks.
#[derive(Clone, Copy)]
enum Nested<'d> {
    Source(&'d SourceSymbol),
    Expr(&'d Expr),
    Term(&'d Term),
    Cond(&'d Cond),
    Pattern(&'d crate::patterns::Pattern),
    PatternItems(&'d crate::patterns::Children),
}

impl<'a> From<crate::patterns::Part<'a>> for Nested<'a> {
    fn from(part: crate::patterns::Part<'a>) -> Self {
        match part {
            crate::patterns::Part::Pattern(pattern) => Self::Pattern(pattern),
            crate::patterns::Part::Children(children) => Self::PatternItems(children),
            crate::patterns::Part::Source(symbol) => Self::Source(symbol),
            crate::patterns::Part::Term(term, _) => Self::Term(term),
        }
    }
}

fn source_children(symbol: &SourceSymbol) -> Vec<Nested<'_>> {
    let SourceSymbol::Call(call) = symbol else { return Vec::new() };
    argument_children(&call.args)
}

fn argument_children(args: &[source::SourceArgument]) -> Vec<Nested<'_>> {
    args.iter()
        .flat_map(|arg| match arg {
            source::SourceArgument::Term(term) | source::SourceArgument::Requirements(term) => vec![Nested::Term(term)],
            source::SourceArgument::Body(expr) | source::SourceArgument::WrappedBody(expr) => vec![Nested::Expr(expr)],
            source::SourceArgument::Targets(targets) => targets
                .iter()
                .filter_map(|target| match target {
                    source::SourceTarget::Symbol(symbol) => Some(Nested::Source(symbol)),
                    _ => None,
                })
                .collect(),
        })
        .collect()
}

/// Whether any DOM node exceeds the depth bound of engine §9.
/// Literal and range wrappers keep their string terms at the same depth.
/// All compound constructors, including pattern constructors, add one.
fn too_deep<'d>(roots: Vec<Nested<'d>>) -> bool {
    let mut stack: Vec<(Nested<'d>, usize)> = roots.into_iter().map(|root| (root, 0)).collect();
    while let Some((node, depth)) = stack.pop() {
        crate::work::count(crate::work::Work::Walked, 1);
        if depth > MAX_NESTING && !matches!(node, Nested::PatternItems(crate::patterns::Children::Sequence(_))) {
            return true;
        }
        let below = depth + 1;
        match node {
            Nested::Source(symbol) => stack.extend(source_children(symbol).into_iter().map(|part| (part, below))),
            Nested::Expr(expr) => match expr {
                Expr::Source(symbol, ..) => stack.push((Nested::Source(symbol), depth)),
                Expr::Seq(items, _) | Expr::Choice(items, _) | Expr::Ranked(items, _) | Expr::And(items, _) => {
                    stack.extend(items.iter().map(|item| (Nested::Expr(item), below)))
                }
                Expr::Optional(inner, _, default, _) => {
                    stack.push((Nested::Expr(inner), below));
                    if let Some(default) = default {
                        stack.push((Nested::Term(&default.term), below));
                    }
                }
                Expr::Capture(_, inner, _) | Expr::Splice(inner, _) => stack.push((Nested::Expr(inner), below)),
                Expr::Repeat(item, separator, _, _) => {
                    stack.push((Nested::Expr(item), below));
                    stack.extend(separator.as_deref().map(|separator| (Nested::Expr(separator), below)));
                }
                Expr::Tested(_, value, inner, _) => {
                    stack.push((Nested::Term(value), below));
                    stack.push((Nested::Expr(inner), below));
                }
                Expr::Literal(term, _) => stack.push((Nested::Term(term), depth)),
                Expr::ScalarRange(a, b, _) => {
                    stack.push((Nested::Term(a), depth));
                    stack.push((Nested::Term(b), depth));
                }
                Expr::Ref(_, _)
                | Expr::Terminal(_, _)
                | Expr::Range(..)
                | Expr::Wildcard(_)
                | Expr::Empty(_)
                | Expr::Remainder(_) => {}
            },
            Nested::Term(term) => match term {
                // The parse argument wrapper is transparent (engine §9).
                Term::Body(body) => stack.push((Nested::Expr(body), depth)),
                Term::Source(symbol) => stack.push((Nested::Source(symbol), depth)),
                Term::Union(items, ..) | Term::Intersection(items, ..) => {
                    stack.extend(items.iter().map(|item| (Nested::Term(item), below)))
                }
                Term::Difference(left, right, ..) => {
                    stack.push((Nested::Term(left), below));
                    stack.push((Nested::Term(right), below));
                }
                Term::If(cond, then, ..) => {
                    stack.push((Nested::Cond(cond), below));
                    stack.push((Nested::Term(then), below));
                }
                // A rule or a classifier that a call names is no node of it.
                Term::Call(name, args, ..) => {
                    // Signed requirement records are metadata, not DOM constructors.
                    let child_depth = if matches!(name.as_str(), "requirements" | "forbid") { depth } else { below };
                    stack.extend(args.iter().filter_map(|arg| match arg {
                        Arg::Term(term) => Some((Nested::Term(term), child_depth)),
                        Arg::Rule(_) | Arg::Classifier(_) | Arg::Integer(..) => None,
                    }));
                }
                Term::Pattern(pattern, ..) => stack.push((Nested::Pattern(pattern), below)),
                Term::Str(..) | Term::Tag(..) | Term::EmptySet(..) | Term::Capture(..) | Term::Const(..) => {}
            },
            Nested::Pattern(pattern) => {
                use crate::patterns::Pattern;
                match pattern {
                    Pattern::Source(symbol) => stack.push((Nested::Source(symbol), depth)),
                    Pattern::Literal(term, _) => stack.push((Nested::Term(term), depth)),
                    Pattern::Range(a, b, _) => {
                        stack.push((Nested::Term(a), depth));
                        stack.push((Nested::Term(b), depth));
                    }
                    Pattern::Test(_, value, inner, _) => {
                        stack.push((Nested::Term(value), below));
                        stack.push((Nested::Pattern(inner), below));
                    }
                    Pattern::Node(node, _, children) => {
                        stack.push((Nested::Pattern(node), depth));
                        stack.extend(children.as_ref().map(|c| (Nested::PatternItems(c), below)));
                    }
                    Pattern::Any => {}
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
            Nested::PatternItems(children) => {
                use crate::patterns::Children;
                match children {
                    Children::Sequence(items) => {
                        stack.extend(items.iter().map(|item| (Nested::PatternItems(item), depth)))
                    }
                    Children::Node(node) => stack.push((Nested::Pattern(node), below)),
                    Children::Choice(arms) => stack.extend(arms.iter().map(|arm| (Nested::PatternItems(arm), below))),
                    Children::Optional(body) => stack.push((Nested::PatternItems(body), below)),
                    Children::Repeat(body, separator) => {
                        stack.push((Nested::PatternItems(body), below));
                        stack.extend(separator.as_deref().map(|separator| (Nested::PatternItems(separator), below)));
                    }
                    Children::Siblings => {}
                }
            }
            Nested::Cond(cond) => match cond {
                // The forest term is the condition itself, not a child.
                Cond::Truthy(term, ..) => stack.push((Nested::Term(term), depth)),
                Cond::Forest(term, ..) => stack.push((Nested::Term(term), depth)),
                Cond::SourceQuery(_, args, _) => stack.extend(args.iter().filter_map(|arg| match arg {
                    Arg::Term(term) => Some((Nested::Term(term), below)),
                    _ => None,
                })),
                Cond::Any(items, ..) | Cond::All(items, ..) => {
                    stack.extend(items.iter().map(|item| (Nested::Cond(item), below)))
                }
                Cond::Not(inner, ..) => stack.push((Nested::Cond(inner), below)),
                Cond::If(antecedent, consequent, ..) => {
                    stack.push((Nested::Cond(antecedent), below));
                    stack.push((Nested::Cond(consequent), below));
                }
                Cond::Initial(span, ..) | Cond::Final(span, ..) | Cond::Boundary(_, span, _, _) => {
                    stack.push((Nested::Term(span), below))
                }
                Cond::Compare(_, left, right, _) => {
                    stack.push((Nested::Term(left), below));
                    stack.push((Nested::Term(right), below));
                }
                Cond::Captured(..) => {}
            },
        }
    }
    false
}

/// Whether a rule holds a node below more than 256 compound nodes.
pub(crate) fn rule_too_deep(rule: &RuleDef) -> bool {
    let mut roots: Vec<Nested> = Vec::new();
    roots.extend(rule.source.args.iter().flat_map(|args| argument_children(args)));
    if let Some(call) = &rule.source.instance {
        roots.extend(argument_children(&call.args));
    }
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

/// Whether any condition holds a node below more than 256 compound nodes.
pub(crate) fn conditions_too_deep(conditions: &[Cond]) -> bool {
    too_deep(conditions.iter().map(Nested::Cond).collect())
}

/// Whether a term holds a node below more than 256 compound nodes.
pub(crate) fn term_too_deep(term: &Term) -> bool {
    too_deep(vec![Nested::Term(term)])
}

/// The tested symbols and default operands, in written order: each
/// comparator, value and symbol. A default requires a string like `=`.
pub(crate) fn tests_in(expr: &Expr) -> Vec<(&str, &Term, &Expr)> {
    let mut found = Vec::new();
    let mut stack = vec![expr];
    while let Some(current) = stack.pop() {
        match current {
            Expr::Seq(items, _) | Expr::Choice(items, _) | Expr::Ranked(items, _) | Expr::And(items, _) => {
                stack.extend(items.iter().rev())
            }
            Expr::Optional(inner, _, default, _) => {
                if let Some(default) = default {
                    found.push(("=", &default.term, inner.as_ref()));
                }
                stack.push(inner);
            }
            Expr::Capture(_, inner, _) | Expr::Splice(inner, _) => stack.push(inner),
            // The item before the separator.
            Expr::Repeat(item, separator, _, _) => {
                stack.extend(separator.as_deref());
                stack.push(item);
            }
            Expr::Tested(op, value, inner, _) => {
                found.push((op.as_str(), value, inner.as_ref()));
                stack.push(inner);
            }
            Expr::Source(..)
            | Expr::Ref(_, _)
            | Expr::Terminal(_, _)
            | Expr::Literal(_, _)
            | Expr::ScalarRange(..)
            | Expr::Range(..)
            | Expr::Wildcard(_)
            | Expr::Empty(_)
            | Expr::Remainder(_) => {}
        }
    }
    found
}

/// The references to constants in source clause order: header clauses,
/// alternatives, conditions, then emission items.
pub(crate) fn constants_in_rule(rule: &RuleDef) -> Vec<(&str, (usize, usize))> {
    let mut out = Vec::new();
    for term in rule
        .tags
        .iter()
        .chain(rule.strings.value.iter())
        .chain(&rule.strings.image)
        .chain(&rule.error)
        .chain(&rule.warning)
    {
        references_in_term(term, &mut out);
    }
    for alternative in &rule.alternatives {
        let mut pending = vec![&alternative.expr];
        while let Some(expr) = pending.pop() {
            match expr {
                Expr::Source(symbol, ..) => constants_in(Nested::Source(symbol), &mut out, true),
                Expr::Literal(term, _) => references_in_term(term, &mut out),
                Expr::ScalarRange(a, b, _) => {
                    references_in_term(a, &mut out);
                    references_in_term(b, &mut out);
                }
                Expr::Tested(_, value, inner, _) => {
                    references_in_term(value, &mut out);
                    pending.push(inner);
                }
                Expr::Seq(xs, _) | Expr::Choice(xs, _) | Expr::Ranked(xs, _) | Expr::And(xs, _) => {
                    pending.extend(xs.iter().rev())
                }
                Expr::Capture(_, x, _) | Expr::Splice(x, _) => pending.push(x),
                Expr::Optional(x, _, default, _) => {
                    if let Some(default) = default {
                        references_in_term(&default.term, &mut out);
                    }
                    pending.push(x);
                }
                Expr::Repeat(x, s, _, _) => {
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
    rule.conditions.iter().for_each(|cond| constants_in(Nested::Cond(cond), &mut out, true));
    for item in rule.emit.iter().flatten() {
        let (tags, strings) = match item {
            EmitItem::Capture(_, tags, a) => (tags, &a.strings),
            EmitItem::Insert(tags, s) => (tags, s),
        };
        for term in tags.iter().chain(&strings.value).chain(&strings.image) {
            references_in_term(term, &mut out);
        }
    }
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

const SPAN_NOT_VALUE: &str = "a span is not a value: $x.tags is the tag set of $x";

/// The type of the value a function gives (engine §10).
pub(crate) fn call_type(call: &str) -> Type {
    match call {
        "value" | "source-text" | "decomposed-source-text" | "image" | "verbatim-text" | "concat" => Type::String,
        "split" | "ngrams" => Type::Strings,
        "parse" | "error-free" => Type::Forest,
        "tags" | "classes" | "classify" | "requirements" | "forbid" => Type::Tags,
        _ => Type::Span,
    }
}

/// The kind of sets joined by `∪`, `∩` or `∖`, or why they cannot be
/// joined: each is a set, and all whose kind is known have one kind. A
/// constant whose type is not known yet fits any set.
pub(crate) fn joined_type(types: &[Type], operator: &str) -> Result<Type, String> {
    if types.iter().any(|ty| matches!(ty, Type::Forest | Type::Body)) {
        return Err(format!("{operator} requires sets, not a forest or parse body"));
    }
    if types.contains(&Type::Span) {
        return Err(SPAN_NOT_VALUE.to_string());
    }
    let types = types.iter().map(|t| if *t == Type::String { Type::Strings } else { *t }).collect::<Vec<_>>();
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
        } else if matches!(right, Type::Span | Type::Pattern | Type::Set | Type::Any) {
            None
        } else {
            Some("a tree comparison requires a pattern or a bare capture on its right".into())
        };
    }
    if !matches!(op, "∈" | "∉")
        && (left == Type::Span || right == Type::Span)
        && (matches!(left, Type::Strings | Type::Tags | Type::Set)
            || matches!(right, Type::Strings | Type::Tags | Type::Set))
        || matches!(op, "∈" | "∉") && right == Type::Span
    {
        return Some(SPAN_NOT_VALUE.into());
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
        if !matches!(right, Type::String | Type::Strings | Type::Set | Type::Any) {
            return Some(format!("{op} tests a string in a set of strings, not in {}", right.name()));
        }
        return None;
    }
    if matches!(op, "=" | "≠") {
        // `=` and `≠` compare two values of one type.
        if left == Type::Any || right == Type::Any {
            return None;
        }
        if left == Type::String && right == Type::String {
            return None;
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

/// The type of a term, or why its parts do not agree, at the smallest
/// construct that disagrees (engine §10). `constants` gives the type of
/// each constant.
pub(crate) fn term_type_in(term: &Term, constants: ConstantTypes) -> Result<Type, Fault> {
    let joined = |items: &mut dyn Iterator<Item = &Term>, operator: &str| {
        let types = items.map(|item| term_type_in(item, constants)).collect::<Result<Vec<_>, _>>()?;
        joined_type(&types, operator).map_err(|problem| Fault::in_term(problem, term))
    };
    match term {
        Term::Body(body) => crate::query_forms::body_problem(body)
            .map_or(Ok(Type::Body), |problem| Err(Fault::in_term(problem.into(), term))),
        Term::Pattern(p, ..) => match p.type_fault(constants) {
            Some(f) => Err(f),
            None => Ok(Type::Pattern),
        },
        Term::Str(..) => Ok(Type::String),
        Term::Tag(..) => Ok(Type::Tags),
        Term::EmptySet(..) => Ok(Type::Set),
        Term::Capture(..) => Ok(Type::Span),
        Term::Const(name, ..) => Ok(constants(name)),
        Term::Source(_) => Ok(Type::Any),
        Term::Union(items, ..) => joined(&mut items.iter(), "∪"),
        Term::Intersection(items, ..) => joined(&mut items.iter(), "∩"),
        Term::Difference(left, right, ..) => joined(&mut [left.as_ref(), right.as_ref()].into_iter(), "∖"),
        Term::If(cond, then, ..) => {
            if let Some(fault) = cond_type_fault(cond, constants) {
                return Err(fault);
            }
            let kind = joined_type(&[term_type_in(then, constants)?], "⟹").map_err(|p| Fault::in_term(p, term))?;
            if kind == Type::Pattern {
                Err(Fault::in_term("a guarded term requires a set".into(), term))
            } else {
                Ok(kind)
            }
        }
        Term::Call(call, args, ..) if !matches!(call.as_str(), "concat" | "requirements" | "forbid") => {
            let Some(Arg::Term(receiver)) = args.first() else {
                return Err(Fault::in_term("a malformed method".into(), term));
            };
            let receiver_type = term_type_in(receiver, constants)?;
            let mut types = Vec::new();
            for arg in &args[1..] {
                types.push(match arg {
                    Arg::Term(Term::Body(_)) => None,
                    Arg::Term(arg) => Some(term_type_in(arg, constants)?),
                    _ => None,
                });
            }
            let receiver_type =
                if receiver_type == Type::Any && term_has_source(receiver) { Type::Span } else { receiver_type };
            if let Some(problem) = method_problem(call, receiver, &args[1..], receiver_type, &types) {
                return Err(Fault::in_term(problem, term));
            }
            Ok(call_type(call))
        }
        Term::Call(call, args, ..) => {
            for arg in args {
                if let Arg::Term(arg) = arg {
                    let ty = term_type_in(arg, constants)?;
                    if call == "concat" && !matches!(ty, Type::String | Type::Any) {
                        return Err(Fault::in_term("++ requires string operands".into(), term));
                    }
                    if call != "concat" {
                        if let Some(problem) = expected_problem(ty, Type::Tags) {
                            return Err(Fault::in_term(problem, arg));
                        }
                    }
                }
            }
            Ok(call_type(call))
        }
    }
}

/// Whether a term holds a parameter or a call of a template.
fn term_has_source(term: &Term) -> bool {
    let mut pending = vec![term];
    while let Some(term) = pending.pop() {
        if partial::unresolved_leaf(term) {
            return true;
        }
        match term {
            Term::Call(_, args, ..) => pending.extend(args.iter().filter_map(|arg| match arg {
                Arg::Term(term) => Some(term),
                _ => None,
            })),
            Term::Union(items, ..) | Term::Intersection(items, ..) => pending.extend(items),
            Term::Difference(left, right, ..) => pending.extend([left.as_ref(), right.as_ref()]),
            Term::If(_, then, ..) => pending.push(then),
            _ => {}
        }
    }
    false
}

/// Why a method's receiver and arguments do not fit it, by their types
/// (engine §10).
fn method_problem(name: &str, receiver: &Term, args: &[Arg], ty: Type, types: &[Option<Type>]) -> Option<String> {
    const SIGNATURE: &str = "a method has the wrong receiver or arguments";
    if !shape::known_method(name) {
        return Some(format!("unknown method {name}"));
    }
    let span = ty == Type::Span;
    let string = matches!(ty, Type::String | Type::Any | Type::Span);
    let rule = |index: usize| match args.get(index) {
        Some(Arg::Rule(_)) => true,
        Some(Arg::Term(term)) => partial::unresolved_leaf(term),
        _ => false,
    };
    // A parameter or a call stands where a bare capture may (engine §3.6).
    let bare = matches!(receiver, Term::Capture(..)) || partial::unresolved_leaf(receiver);
    let problem = |wrong: bool| wrong.then(|| SIGNATURE.to_string());
    match name {
        "parse" => {
            let [Arg::Term(Term::Body(body))] = args else { return Some(SIGNATURE.into()) };
            if !span {
                return Some(SIGNATURE.into());
            }
            (restored_span(receiver) && crate::query_forms::suffix_body(body))
                .then(|| "suffix parse requires an ordinary span, not a restored span".into())
        }
        "error-free" => problem(ty != Type::Forest || !args.is_empty()),
        "without-elision" => (!args.is_empty() || !bare)
            .then(|| "without-elision requires a bare capture: write $x.without-elision.onward".into()),
        "without-elision-except" => {
            if !bare {
                return Some(
                    "without-elision-except requires a bare capture: write $x.without-elision-except(family).onward"
                        .into(),
                );
            }
            (args.len() != 1 || !rule(0)).then(|| "without-elision-except requires one rule name".into())
        }
        "first-token" | "tokens-after-first" | "last-token" | "onward" | "following-tokens" | "preceding-tokens"
        | "starts-input" | "ends-input" | "classes" => problem(!span || !args.is_empty()),
        "followed-by" | "preceded-by" => {
            if !matches!(receiver, Term::Capture(..)) {
                return Some(format!("{name} requires a bare capture"));
            }
            problem(
                args.is_empty()
                    || !args.iter().all(|arg| {
                        matches!(arg, Arg::Rule(_))
                            || matches!(arg, Arg::Term(Term::Tag(name, ..)) if is_constant_name(name))
                    }),
            )
        }
        "tags" => problem(if ty == Type::Forest { !args.is_empty() } else { !span || !args.is_empty() }),
        "ngrams" => problem(!string || !matches!(args, [Arg::Integer(digits, ..)] if valid_integer(digits))),
        "split" => {
            if !string || args.len() != 1 || !matches!(types.first(), Some(Some(Type::String | Type::Span | Type::Any)))
            {
                return Some(SIGNATURE.into());
            }
            matches!(&args[0], Arg::Term(Term::Str(text, ..)) if text.is_empty())
                .then(|| "split has an empty delimiter".into())
        }
        "classify" => problem(!string || !matches!(args, [Arg::Classifier(_)])),
        "emitted" => (!args.is_empty() || !matches!(receiver, Term::Capture(..)))
            .then(|| "emitted requires a bare capture in a recipe".into()),
        "verbatim-text" => (!span || !args.is_empty()).then(|| "verbatim-text requires a capture in a recipe".into()),
        _ => problem(!span || !args.is_empty()),
    }
}

/// Why a condition's terms do not agree in type, at the smallest construct
/// that disagrees, or `None` (engine §10).
pub(crate) fn cond_type_fault(cond: &Cond, constants: ConstantTypes) -> Option<Fault> {
    match cond {
        Cond::Truthy(term, ..) => term_type_in(term, constants).err().or_else(|| {
            (!matches!(term_type_in(term, constants).ok(), Some(Type::Tags | Type::Strings | Type::Set | Type::Any)))
                .then(|| {
                    // The fault stands at the condition (engine §10).
                    let mut fault =
                        Fault::in_term("a condition requires a set, a forest, or a query method".into(), term);
                    fault.node_at = cond.at().or(fault.node_at);
                    fault
                })
        }),
        Cond::Forest(term, ..) => term_type_in(term, constants).err().or_else(|| {
            (term_type_in(term, constants).ok() != Some(Type::Forest))
                .then(|| Fault::in_term("a condition requires a forest".into(), term))
        }),
        Cond::SourceQuery(_, args, _) => args.iter().find_map(|arg| match arg {
            Arg::Term(term) => term_type_in(term, constants).err(),
            _ => None,
        }),
        Cond::Any(items, ..) | Cond::All(items, ..) => items.iter().find_map(|item| cond_type_fault(item, constants)),
        Cond::Not(inner, ..) => cond_type_fault(inner, constants),
        Cond::If(antecedent, consequent, ..) => {
            cond_type_fault(antecedent, constants).or_else(|| cond_type_fault(consequent, constants))
        }
        Cond::Compare(op, left, right, compare_at) => {
            if matches!(op.as_str(), "≅" | "≇") && !matches!(left, Term::Capture(..)) {
                return Some(Fault::in_cond("a tree comparison requires a bare capture".into(), cond));
            }
            let left_type = match term_type_in(left, constants) {
                Ok(ty) => ty,
                Err(fault) => return Some(fault),
            };
            let right_type = match term_type_in(right, constants) {
                Ok(ty) => ty,
                Err(fault) => return Some(fault),
            };
            if matches!(op.as_str(), "≅" | "≇") {
                if matches!((left, right), (Term::Capture(a, ..), Term::Capture(b, ..)) if a == b) {
                    return Some(Fault::in_cond(
                        "a constituent comparison requires two different captures".into(),
                        cond,
                    ));
                }
                if right_type == Type::Span && !matches!(right, Term::Capture(..)) {
                    return Some(Fault::in_term(
                        "a tree comparison requires a pattern or a bare capture on its right".into(),
                        right,
                    ));
                }
                if let Some(problem) = comparison_problem(op, left_type, right_type) {
                    return Some(Fault::in_term(problem, right));
                }
                None
            } else {
                comparison_problem(op, left_type, right_type).map(|problem| Fault {
                    problem,
                    at: first_constant_in_cond(cond),
                    node_at: *compare_at,
                })
            }
        }
        Cond::Initial(span, ..) | Cond::Final(span, ..) | Cond::Boundary(_, span, _, _) => {
            match term_type_in(span, constants) {
                Err(fault) => Some(fault),
                Ok(ty) => expected_problem(ty, Type::Span).map(|problem| Fault::in_cond(problem, cond)),
            }
        }
        Cond::Captured(..) => None,
    }
}

/// A tag term of a rule: its clause root, the term, and where the clause
/// writes the term.
type TagUse<'a> = (usize, &'a Term, Option<(usize, usize)>);

/// Why a rule's terms and conditions do not agree in type, at the
/// smallest construct that disagrees, or `None` (engine §10). The faults
/// are found clause by clause, and the first stands before the next fault
/// whose construct holds a constant: the canonical clause order supplies
/// the positions that the DOM lacks.
pub(crate) fn rule_type_fault(rule: &RuleDef, constants: ConstantTypes) -> Option<Fault> {
    fn emit_parts(item: &EmitItem) -> (Option<&Term>, &Channels) {
        match item {
            EmitItem::Capture(_, tags, attachments) => (tags.as_ref(), &attachments.strings),
            EmitItem::Insert(tags, strings) => (tags.as_ref(), strings),
        }
    }
    // The clause roots in their canonical order: the header's tags, value
    // and image, each alternative's expression, tags, value and image, the
    // conditions, the diagnostic, and each emission item's tags, value and
    // image.
    let mut roots = 0;
    let mut root = || {
        roots += 1;
        roots - 1
    };
    let header = (root(), root(), root());
    let alternatives: Vec<(usize, usize, usize, usize)> =
        rule.alternatives.iter().map(|_| (root(), root(), root(), root())).collect();
    let conditions: Vec<usize> = rule.conditions.iter().map(|_| root()).collect();
    let diagnostics = (root(), root());
    let items: Vec<(usize, usize, usize)> = rule.emit.iter().flatten().map(|_| (root(), root(), root())).collect();
    let mut faults: Vec<(usize, Fault)> = Vec::new();
    // Recipes: each atom is a string, or a string method of a capture.
    let mut recipes: Vec<(usize, &Term)> = Vec::new();
    recipes.extend(rule.strings.value.iter().map(|recipe| (header.1, recipe)));
    recipes.extend(rule.strings.image.iter().map(|recipe| (header.2, recipe)));
    recipes.extend(rule.error.iter().map(|recipe| (diagnostics.0, recipe)));
    recipes.extend(rule.warning.iter().map(|recipe| (diagnostics.1, recipe)));
    for (alternative, roots) in rule.alternatives.iter().zip(&alternatives) {
        recipes.extend(alternative.strings.value.iter().map(|recipe| (roots.2, recipe)));
        recipes.extend(alternative.strings.image.iter().map(|recipe| (roots.3, recipe)));
    }
    for (item, roots) in rule.emit.iter().flatten().zip(&items) {
        let (_, strings) = emit_parts(item);
        recipes.extend(strings.value.iter().map(|recipe| (roots.1, recipe)));
        recipes.extend(strings.image.iter().map(|recipe| (roots.2, recipe)));
    }
    let typed = |faults: &mut Vec<(usize, Fault)>, index: usize, term: &Term, expected: Type| match term_type_in(
        term, constants,
    ) {
        Err(fault) => faults.push((index, fault)),
        Ok(ty) => {
            if let Some(problem) = expected_problem(ty, expected) {
                faults.push((index, Fault::in_term(problem, term)));
            }
        }
    };
    for (index, recipe) in recipes {
        let atoms: Vec<&Term> = match recipe {
            Term::Call(name, args, ..) if name == "concat" => args
                .iter()
                .filter_map(|arg| match arg {
                    Arg::Term(atom) => Some(atom),
                    _ => None,
                })
                .collect(),
            recipe => vec![recipe],
        };
        for atom in atoms {
            let call = matches!(atom, Term::Source(SourceSymbol::Call(..)))
                || matches!(atom, Term::Const(name, ..) if name == partial::UNRESOLVED_CALL);
            let string = matches!(atom, Term::Str(..) | Term::Const(..)) && !atom.grouped() && !call;
            if !string && !matches!(atom, Term::Source(SourceSymbol::Parameter(..))) {
                let Term::Call(name, args, ..) = atom else {
                    faults.push((index, Fault::in_term("a malformed recipe atom".into(), atom)));
                    continue;
                };
                if !matches!(
                    name.as_str(),
                    "value" | "image" | "source-text" | "decomposed-source-text" | "verbatim-text"
                ) || args.len() != 1
                {
                    faults.push((index, Fault::in_term("a malformed recipe atom".into(), atom)));
                    continue;
                }
                let receiver_valid = match &args[0] {
                    Arg::Term(Term::Capture(..)) => true,
                    Arg::Term(Term::Call(inner, inner_args, ..)) => {
                        matches!(name.as_str(), "value" | "image")
                            && inner == "emitted"
                            && matches!(&inner_args[..], [Arg::Term(Term::Capture(..))])
                    }
                    _ => false,
                };
                if !receiver_valid {
                    faults.push((index, Fault::in_term("a malformed recipe receiver".into(), atom)));
                    continue;
                }
            }
            typed(&mut faults, index, atom, Type::String);
        }
    }
    // Tag terms, each a tag set; the whole term's type stands at the term
    // as its clause writes it.
    let mut tags: Vec<TagUse<'_>> = Vec::new();
    tags.extend(rule.tags.iter().map(|term| (header.0, term, rule.tags_at.term)));
    for (alternative, roots) in rule.alternatives.iter().zip(&alternatives) {
        tags.extend(alternative.tags.iter().map(|term| (roots.1, term, alternative.tags_at.term)));
    }
    for (position, (item, roots)) in rule.emit.iter().flatten().zip(&items).enumerate() {
        let (term, _) = emit_parts(item);
        let term_at = rule.places.item_tags_ats.get(position).copied().flatten();
        tags.extend(term.map(|term| (roots.0, term, term_at)));
    }
    for (index, term, term_at) in tags {
        match term_type_in(term, constants) {
            Err(fault) => faults.push((index, fault)),
            Ok(ty) => {
                if let Some(problem) = expected_problem(ty, Type::Tags) {
                    let mut fault = Fault::in_term(problem, term);
                    fault.node_at = term_at.or(fault.node_at);
                    faults.push((index, fault));
                }
            }
        }
    }
    for (condition, index) in rule.conditions.iter().zip(&conditions) {
        if let Some(fault) = cond_type_fault(condition, constants) {
            faults.push((*index, fault));
        }
    }
    // Literal and range operands of the alternatives are strings.
    for (alternative, roots) in rule.alternatives.iter().zip(&alternatives) {
        let mut pending = vec![&alternative.expr];
        while let Some(expr) = pending.pop() {
            match expr {
                Expr::Literal(term, _) => typed(&mut faults, roots.0, term, Type::String),
                Expr::ScalarRange(a, b, _) => {
                    typed(&mut faults, roots.0, a, Type::String);
                    typed(&mut faults, roots.0, b, Type::String);
                }
                Expr::Seq(items, _) | Expr::Choice(items, _) | Expr::Ranked(items, _) | Expr::And(items, _) => {
                    pending.extend(items.iter().rev())
                }
                Expr::Optional(inner, _, _, _)
                | Expr::Capture(_, inner, _)
                | Expr::Splice(inner, _)
                | Expr::Tested(_, _, inner, _) => pending.push(inner),
                Expr::Repeat(item, separator, _, _) => {
                    pending.extend(separator.as_deref());
                    pending.push(item);
                }
                _ => {}
            }
        }
    }
    // A test's value is a string for a value test, and each requirement of
    // a tag test is a tag set (engine §9, §10).
    for (alternative, roots) in rule.alternatives.iter().zip(&alternatives) {
        for (op, value, _) in tests_in(&alternative.expr) {
            if op == "tags" {
                let Term::Call(_, requirements, ..) = value else { continue };
                for requirement in requirements {
                    let Arg::Term(term) = requirement else { continue };
                    let term = match term {
                        Term::Call(name, args, ..) if name == "forbid" => match args.first() {
                            Some(Arg::Term(term)) => term,
                            _ => continue,
                        },
                        term => term,
                    };
                    typed(&mut faults, roots.0, term, Type::Tags);
                }
            } else {
                typed(&mut faults, roots.0, value, Type::String);
            }
        }
    }
    faults.sort_by_key(|(index, _)| *index);
    let mut first = None;
    let mut next = (usize::MAX, usize::MAX);
    let mut position = (usize::MAX, usize::MAX, 2);
    for (_, fault) in faults.into_iter().rev() {
        if let Some(at) = fault.at {
            next = at;
        }
        let key = (next.0, next.1, if fault.at.is_some() { 1 } else { 0 });
        if key <= position {
            first = Some(fault);
            position = key;
        }
    }
    first
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
    Pattern(crate::patterns::Pattern),
    Children(crate::patterns::Children),
    Source(SourceSymbol),
    Expr(Expr),
    Term(Term),
    Cond(Cond),
}

impl Dropping {
    /// Moves the parts of a node out onto `stack`, leaving it shallow.
    fn take(&mut self, stack: &mut Vec<Dropping>) {
        match self {
            Dropping::Pattern(pattern) => pattern.take_parts(stack),
            Dropping::Children(children) => children.take_parts(stack),
            Dropping::Source(symbol) => symbol.take_parts(stack),
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

pub(crate) fn drop_pattern(pattern: crate::patterns::Pattern) {
    drop_parts(vec![Dropping::Pattern(pattern)]);
}

pub(crate) fn drop_pattern_children(children: crate::patterns::Children) {
    drop_parts(vec![Dropping::Children(children)]);
}

impl crate::patterns::Pattern {
    fn take_parts(&mut self, stack: &mut Vec<Dropping>) {
        use crate::patterns::Pattern as P;
        let take = |pattern: &mut P| Dropping::Pattern(std::mem::replace(pattern, P::Any));
        let term = |term: &mut Term| Dropping::Term(std::mem::replace(term, Term::EmptySet(crate::dom::Hidden::NONE)));
        match self {
            P::Source(symbol) => symbol.take_parts(stack),
            P::Literal(value, _) => stack.push(term(value)),
            P::Range(a, b, _) => stack.extend([term(a), term(b)]),
            P::Test(_, value, inner, _) => stack.extend([term(value), take(inner)]),
            P::Path(_, inner) => stack.push(take(inner)),
            P::Node(inner, _, children) => {
                stack.push(take(inner));
                stack.extend(children.take().map(Dropping::Children));
            }
            P::Union(items) | P::Intersection(items) => stack.extend(items.drain(..).map(Dropping::Pattern)),
            P::Difference(a, b) => stack.extend([take(a), take(b)]),
            _ => {}
        }
    }
}

impl crate::patterns::Children {
    fn take_parts(&mut self, stack: &mut Vec<Dropping>) {
        use crate::patterns::{Children as C, Pattern as P};
        let take = |children: &mut C| Dropping::Children(std::mem::replace(children, C::Siblings));
        match self {
            C::Node(pattern) => stack.push(Dropping::Pattern(std::mem::replace(&mut **pattern, P::Any))),
            C::Sequence(items) | C::Choice(items) => stack.extend(items.drain(..).map(Dropping::Children)),
            C::Optional(inner) => stack.push(take(inner)),
            C::Repeat(inner, separator) => {
                stack.push(take(inner));
                stack.extend(separator.take().map(|inner| Dropping::Children(*inner)));
            }
            C::Siblings => {}
        }
    }
}

impl SourceSymbol {
    fn take_parts(&mut self, stack: &mut Vec<Dropping>) {
        if let Self::Call(call) = self {
            for arg in call.args.drain(..) {
                match arg {
                    source::SourceArgument::Term(term) | source::SourceArgument::Requirements(term) => {
                        stack.push(Dropping::Term(term));
                    }
                    source::SourceArgument::Body(expr) | source::SourceArgument::WrappedBody(expr) => {
                        stack.push(Dropping::Expr(expr))
                    }
                    source::SourceArgument::Targets(targets) => {
                        stack.extend(targets.into_iter().filter_map(|target| match target {
                            source::SourceTarget::Symbol(symbol) => Some(Dropping::Source(symbol)),
                            _ => None,
                        }));
                    }
                }
            }
        }
    }
}

impl Drop for SourceSymbol {
    fn drop(&mut self) {
        let mut stack = Vec::new();
        self.take_parts(&mut stack);
        drop_parts(stack);
    }
}

impl Expr {
    fn take_parts(&mut self, stack: &mut Vec<Dropping>) {
        match self {
            Self::Source(symbol, ..) => symbol.take_parts(stack),
            Expr::Seq(items, _) | Expr::Choice(items, _) | Expr::Ranked(items, _) | Expr::And(items, _) => {
                stack.extend(items.drain(..).map(Dropping::Expr))
            }
            Expr::Optional(inner, _, default, _) => {
                if let Some(default) = default.take() {
                    stack.push(Dropping::Term(default.term));
                }
                stack
                    .push(Dropping::Expr(std::mem::replace(&mut **inner, Expr::Empty(crate::dom::ExprAt::from(None)))));
            }
            Expr::Capture(_, inner, _) | Expr::Splice(inner, _) => {
                stack.push(Dropping::Expr(std::mem::replace(&mut **inner, Expr::Empty(crate::dom::ExprAt::from(None)))))
            }
            Expr::Repeat(item, separator, _, _) => {
                stack.push(Dropping::Expr(std::mem::replace(&mut **item, Expr::Empty(crate::dom::ExprAt::from(None)))));
                if let Some(separator) = separator {
                    stack.push(Dropping::Expr(std::mem::replace(
                        &mut **separator,
                        Expr::Empty(crate::dom::ExprAt::from(None)),
                    )));
                }
            }
            Expr::Tested(_, value, symbol, _) => {
                stack.push(Dropping::Term(std::mem::replace(value, Term::EmptySet(crate::dom::Hidden::NONE))));
                stack.push(Dropping::Expr(std::mem::replace(
                    &mut **symbol,
                    Expr::Empty(crate::dom::ExprAt::from(None)),
                )));
            }
            Expr::Literal(value, _) => {
                stack.push(Dropping::Term(std::mem::replace(value, Term::EmptySet(crate::dom::Hidden::NONE))))
            }
            Expr::ScalarRange(a, b, _) => {
                stack.push(Dropping::Term(std::mem::replace(a, Term::EmptySet(crate::dom::Hidden::NONE))));
                stack.push(Dropping::Term(std::mem::replace(b, Term::EmptySet(crate::dom::Hidden::NONE))));
            }
            Expr::Ref(_, _)
            | Expr::Terminal(_, _)
            | Expr::Range(..)
            | Expr::Wildcard(_)
            | Expr::Empty(_)
            | Expr::Remainder(_) => {}
        }
    }
}

impl Term {
    /// What a reader knows of this term and its DOM does not hold.
    pub(crate) fn hidden(&self) -> Option<&Hidden> {
        match self {
            Term::Str(_, hidden)
            | Term::Tag(_, hidden)
            | Term::Union(_, hidden)
            | Term::Intersection(_, hidden)
            | Term::Difference(_, _, hidden)
            | Term::Call(_, _, hidden)
            | Term::Capture(_, hidden)
            | Term::If(_, _, hidden)
            | Term::EmptySet(hidden)
            | Term::Const(_, _, hidden)
            | Term::Pattern(_, hidden) => Some(hidden),
            Term::Body(_) | Term::Source(_) => None,
        }
    }

    pub(crate) fn hidden_mut(&mut self) -> Option<&mut Hidden> {
        match self {
            Term::Str(_, hidden)
            | Term::Tag(_, hidden)
            | Term::Union(_, hidden)
            | Term::Intersection(_, hidden)
            | Term::Difference(_, _, hidden)
            | Term::Call(_, _, hidden)
            | Term::Capture(_, hidden)
            | Term::If(_, _, hidden)
            | Term::EmptySet(hidden)
            | Term::Const(_, _, hidden)
            | Term::Pattern(_, hidden) => Some(hidden),
            Term::Body(_) | Term::Source(_) => None,
        }
    }

    /// Where the term stands, when it is known: its own position, which a
    /// constant reference or a source symbol holds in the DOM and a reader
    /// knows of every other term.
    pub(crate) fn at(&self) -> Option<(usize, usize)> {
        match self {
            // A reader can place a constant where its parentheses stand.
            Term::Const(_, at, hidden) => hidden.position().or(Some(*at)),
            Term::Source(symbol) => Some(symbol.at()),
            Term::Body(body) => body.at(),
            term => term.hidden().and_then(|hidden| hidden.position()),
        }
    }

    /// Whether parentheses group the term (engine §9.3).
    pub(crate) fn grouped(&self) -> bool {
        self.hidden().is_some_and(|hidden| hidden.grouped)
    }

    /// Gives the term the position `at` unless it has one. A constant
    /// reference has its own.
    pub(crate) fn locate(&mut self, at: (usize, usize)) {
        if matches!(self, Term::Const(..)) {
            return;
        }
        if let Some(hidden) = self.hidden_mut() {
            if hidden.position().is_none() {
                hidden.set(Some(at));
            }
        }
    }
}

impl Cond {
    pub(crate) fn hidden(&self) -> Option<&Hidden> {
        match self {
            Cond::Forest(_, hidden)
            | Cond::Truthy(_, hidden)
            | Cond::Initial(_, hidden)
            | Cond::Final(_, hidden)
            | Cond::Not(_, hidden)
            | Cond::Any(_, hidden)
            | Cond::All(_, hidden)
            | Cond::Captured(_, hidden)
            | Cond::If(_, _, hidden) => Some(hidden),
            Cond::SourceQuery(..) | Cond::Compare(..) | Cond::Boundary(..) => None,
        }
    }

    pub(crate) fn hidden_mut(&mut self) -> Option<&mut Hidden> {
        match self {
            Cond::Forest(_, hidden)
            | Cond::Truthy(_, hidden)
            | Cond::Initial(_, hidden)
            | Cond::Final(_, hidden)
            | Cond::Not(_, hidden)
            | Cond::Any(_, hidden)
            | Cond::All(_, hidden)
            | Cond::Captured(_, hidden)
            | Cond::If(_, _, hidden) => Some(hidden),
            Cond::SourceQuery(..) | Cond::Compare(..) | Cond::Boundary(..) => None,
        }
    }

    /// Where the condition stands, when it is known.
    pub(crate) fn at(&self) -> Option<(usize, usize)> {
        match self {
            Cond::Compare(_, _, _, at) => *at,
            Cond::SourceQuery(_, _, location) => location.at,
            Cond::Boundary(_, _, _, location) => location.at,
            cond => cond.hidden().and_then(|hidden| hidden.position()),
        }
    }

    /// Gives the condition the position `at` unless it has one.
    pub(crate) fn locate(&mut self, at: (usize, usize)) {
        if let Some(hidden) = self.hidden_mut() {
            if hidden.position().is_none() {
                hidden.set(Some(at));
            }
        }
    }
}

impl Term {
    fn take_parts(&mut self, stack: &mut Vec<Dropping>) {
        match self {
            Term::Body(body) => {
                let owned = std::mem::replace(body, std::sync::Arc::new(Expr::Empty(crate::dom::ExprAt::from(None))));
                if let Ok(expr) = std::sync::Arc::try_unwrap(owned) {
                    stack.push(Dropping::Expr(expr));
                }
            }
            Self::Source(symbol) => symbol.take_parts(stack),
            Term::Union(items, ..) | Term::Intersection(items, ..) => stack.extend(items.drain(..).map(Dropping::Term)),
            Term::Difference(left, right, ..) => {
                stack.push(Dropping::Term(std::mem::replace(&mut **left, Term::EmptySet(crate::dom::Hidden::NONE))));
                stack.push(Dropping::Term(std::mem::replace(&mut **right, Term::EmptySet(crate::dom::Hidden::NONE))));
            }
            Term::Call(_, args, ..) => {
                for arg in args.drain(..) {
                    if let Arg::Term(term) = arg {
                        stack.push(Dropping::Term(term));
                    }
                }
            }
            Term::If(cond, then, ..) => {
                stack.push(Dropping::Cond(std::mem::replace(
                    &mut **cond,
                    Cond::Captured(String::new(), crate::dom::Hidden::NONE),
                )));
                stack.push(Dropping::Term(std::mem::replace(&mut **then, Term::EmptySet(crate::dom::Hidden::NONE))));
            }
            Term::Pattern(pattern, ..) => {
                stack.push(Dropping::Pattern(std::mem::replace(&mut **pattern, crate::patterns::Pattern::Any)))
            }
            Term::Str(..) | Term::Tag(..) | Term::EmptySet(..) | Term::Capture(..) | Term::Const(..) => {}
        }
    }
}

impl Cond {
    fn take_parts(&mut self, stack: &mut Vec<Dropping>) {
        match self {
            Cond::Truthy(term, ..) => {
                stack.push(Dropping::Term(std::mem::replace(term, Term::EmptySet(crate::dom::Hidden::NONE))))
            }
            Cond::Forest(term, ..) => {
                stack.push(Dropping::Term(std::mem::replace(term, Term::EmptySet(crate::dom::Hidden::NONE))))
            }
            Cond::SourceQuery(_, args, _) => {
                stack.extend(args.drain(..).filter_map(|arg| match arg {
                    Arg::Term(term) => Some(Dropping::Term(term)),
                    _ => None,
                }));
            }
            Cond::Compare(_, left, right, _) => {
                stack.push(Dropping::Term(std::mem::replace(left, Term::EmptySet(crate::dom::Hidden::NONE))));
                stack.push(Dropping::Term(std::mem::replace(right, Term::EmptySet(crate::dom::Hidden::NONE))));
            }
            Cond::Initial(span, ..) | Cond::Final(span, ..) | Cond::Boundary(_, span, _, _) => {
                stack.push(Dropping::Term(std::mem::replace(span, Term::EmptySet(crate::dom::Hidden::NONE))))
            }
            Cond::Not(inner, ..) => stack.push(Dropping::Cond(std::mem::replace(
                &mut **inner,
                Cond::Captured(String::new(), crate::dom::Hidden::NONE),
            ))),
            Cond::Any(items, ..) | Cond::All(items, ..) => stack.extend(items.drain(..).map(Dropping::Cond)),
            Cond::If(antecedent, consequent, ..) => {
                stack.push(Dropping::Cond(std::mem::replace(
                    &mut **antecedent,
                    Cond::Captured(String::new(), crate::dom::Hidden::NONE),
                )));
                stack.push(Dropping::Cond(std::mem::replace(
                    &mut **consequent,
                    Cond::Captured(String::new(), crate::dom::Hidden::NONE),
                )));
            }
            Cond::Captured(..) => {}
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

pub(crate) fn valid_integer(s: &str) -> bool {
    let bytes = s.as_bytes();
    !bytes.is_empty() && (b'1'..=b'9').contains(&bytes[0]) && bytes[1..].iter().all(u8::is_ascii_digit)
}
pub(crate) fn ngrams(s: &str, digits: &str) -> Vec<String> {
    let points = s.chars().collect::<Vec<_>>();
    let n = digits.parse::<usize>().unwrap_or(usize::MAX);
    if n > points.len() {
        return Vec::new();
    }
    points.windows(n).map(|run| run.iter().collect()).collect()
}

/// Whether a span preserves a restoration constraint through onward.
pub(crate) fn restored_span(mut term: &Term) -> bool {
    for _ in 0..=256 {
        match term {
            Term::Call(name, ..) if matches!(name.as_str(), "without-elision" | "without-elision-except") => {
                return true
            }
            Term::Call(name, args, ..) if name == "onward" => {
                let [Arg::Term(inner)] = &args[..] else { return false };
                term = inner;
            }
            _ => return false,
        }
    }
    false
}
