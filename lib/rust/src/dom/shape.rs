//! The structural pass of the DOM validator (engine §9.3 step 5): the own
//! shape of each declaration, then the shape of each of its parts, which
//! a work list visits in the order written. A located DOM, which a reader
//! wrote, also holds what the reader knows of each node under members
//! whose names begin with NUL, and a fault stands at the nearest node
//! that has a position.
use super::schema::DomFault;
use super::*;

pub(crate) type Position = (usize, usize);

/// What an absent member reads as: a part of no form.
static ABSENT: Json = Json::Null;

/// The member `name` that only a located DOM holds.
pub(crate) fn hidden<'a>(value: &'a Json, name: &str) -> Option<&'a Json> {
    value.as_object()?.iter().find(|(key, _)| key.strip_prefix('\0') == Some(name)).map(|(_, value)| value)
}

fn object(value: &Json) -> bool {
    value.as_object().is_some()
}

fn has(value: &Json, key: &str) -> bool {
    value.get(key).is_some()
}

fn str_of<'a>(value: &'a Json, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Json::as_str)
}

fn array_of<'a>(value: &'a Json, key: &str) -> Option<&'a [Json]> {
    value.get(key).and_then(Json::as_array)
}

/// The members a DOM holds, without the hidden ones.
fn keys(value: &Json) -> impl Iterator<Item = &str> {
    value.as_object().unwrap_or(&[]).iter().map(|(key, _)| key.as_str()).filter(|key| !key.starts_with('\0'))
}

fn position_of(value: &Json) -> Option<Position> {
    match value.as_array()? {
        [Json::Int(line), Json::Int(column)]
            if (1..=DOM_MAX_POSITION).contains(line) && (1..=DOM_MAX_POSITION).contains(column) =>
        {
            Some((*line as usize, *column as usize))
        }
        _ => None,
    }
}

fn is_position(value: Option<&Json>) -> bool {
    value.and_then(position_of).is_some()
}

/// Where a node stands: its `at`, or the one a reader knows.
pub(crate) fn node_at(value: &Json) -> Option<Position> {
    hidden(value, "at").and_then(position_of).or_else(|| value.get("at").and_then(position_of))
}

fn node_pos(value: &Json, fallback: Option<Position>) -> Option<Position> {
    node_at(value).or(fallback)
}

fn hidden_at(value: &Json, name: &str) -> Option<Position> {
    hidden(value, name).and_then(position_of)
}

fn grouped(value: &Json) -> bool {
    hidden(value, "grouped") == Some(&Json::Bool(true))
}

/// Whether a node has no member but `fields`.
fn exact(value: &Json, fields: &[&str]) -> bool {
    object(value) && keys(value).all(|key| fields.contains(&key))
}

fn expr_exact(value: &Json, fields: &[&str]) -> bool {
    exact(value, fields) && keys(value).all(|key| key != "at" || is_position(value.get("at")))
        || exact(value, &[fields, &["at"]].concat()) && (!has(value, "at") || is_position(value.get("at")))
}

fn expr_single(value: &Json, key: &str) -> bool {
    expr_exact(value, &[key]) && has(value, key)
}

fn is_true(value: Option<&Json>) -> bool {
    value == Some(&Json::Bool(true))
}

/// Whether a node has exactly the members of one of its forms. A member
/// that ends in `?` may be absent.
fn has_one_form(value: &Json, forms: &[&[&str]]) -> bool {
    let Some(form) = forms.iter().find(|form| has(value, form[0])) else { return false };
    let names: Vec<&str> = form.iter().map(|member| member.trim_end_matches('?')).collect();
    form.iter().all(|member| member.ends_with('?') || has(value, member)) && keys(value).all(|key| names.contains(&key))
}

fn string_atom(value: &Json) -> bool {
    object(value) && !grouped(value) && (has(value, "string") || has(value, "const"))
}

fn string_term(value: &Json) -> bool {
    !grouped(value) && (string_atom(value) || object(value) && has(value, "param"))
}

fn upper_name(name: &str) -> bool {
    is_constant_name(name)
}

fn feature_name(name: &str) -> bool {
    !name.contains("--")
        && name.starts_with(|c: char| c.is_ascii_alphabetic())
        && name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
}

fn class_name(name: &str) -> bool {
    upper_name(name) && name.ends_with(|c: char| c.is_ascii_uppercase())
}

fn parameter_name(name: &str) -> bool {
    crate::tags::is_name(name)
}

const DIRECTIVE_NAMES: &[&str] = &[
    "ambiguity-resolution",
    "elision-only",
    "stage",
    "extend-stage",
    "redefine-stage",
    "include",
    "names",
    "features",
];
const COMPARATORS: &[&str] = &["=", "≠", "∈", "∉", "⊆", "⊈", "≅", "≇"];
const SPAN_METHODS: &[&str] = &[
    "first-token",
    "tokens-after-first",
    "last-token",
    "onward",
    "following-tokens",
    "preceding-tokens",
    "without-elision",
    "without-elision-except",
];
const QUERY_METHODS: &[&str] = &["starts-input", "ends-input", "parse", "error-free", "followed-by", "preceded-by"];
const INPUT_STRINGS: &[&str] = &["value", "image", "source-text", "decomposed-source-text"];
const TARGET_METHODS: &[&str] = &["followed-by", "preceded-by"];
const OTHER_METHODS: &[&str] = &["tags", "classes", "split", "ngrams", "classify", "verbatim-text", "emitted"];

pub(crate) fn known_method(name: &str) -> bool {
    SPAN_METHODS.contains(&name)
        || QUERY_METHODS.contains(&name)
        || INPUT_STRINGS.contains(&name)
        || OTHER_METHODS.contains(&name)
}

/// Whether a node holds a parameter or a call of a template, or is a
/// template's definition or binding.
pub(crate) fn has_unresolved(root: &Json) -> bool {
    let mut pending = vec![root];
    while let Some(node) = pending.pop() {
        if has(node, "param")
            || has(node, "call")
            || has(node, "params")
            || has(node, "instance")
            || has(node, "args") && has(node, "name") && has(node, "op")
        {
            return true;
        }
        pending.extend(json_children(node));
    }
    false
}

fn json_children(node: &Json) -> Vec<&Json> {
    match node {
        Json::Arr(items) => items.iter().collect(),
        Json::Obj(fields) => fields.iter().filter(|(key, _)| !key.starts_with('\0')).map(|(_, value)| value).collect(),
        _ => Vec::new(),
    }
}

/// Whether a span is a restored one.
fn restored(receiver: &Json) -> bool {
    super::schema::restored_span(receiver)
}

/// The body of a parse argument without its outer remainders, and whether
/// it reads a suffix or a part (engine §3.10, §4).
fn query_body(body: &Json) -> Result<(Vec<&Json>, bool, &'static str), &'static str> {
    let Some(sequence) = array_of(body, "seq") else { return Ok((vec![body], false, "whole")) };
    let markers: Vec<usize> = sequence
        .iter()
        .enumerate()
        .filter(|(_, part)| is_true(part.get("remainder")))
        .map(|(index, _)| index)
        .collect();
    if markers.is_empty() {
        return Ok((vec![body], false, "whole"));
    }
    let parts: Vec<&Json> = sequence.iter().filter(|part| !is_true(part.get("remainder"))).collect();
    let only = |node: &Json, allowed: &[&str]| {
        keys(node).all(|key| allowed.contains(&key)) && (!has(node, "at") || is_position(node.get("at")))
    };
    let edges = markers.iter().all(|&index| index == 0 || index + 1 == sequence.len());
    if !only(body, &["seq", "at"])
        || markers.len() > 2
        || !edges
        || parts.is_empty()
        || markers.iter().any(|&index| !only(&sequence[index], &["remainder", "at"]))
    {
        return Err("a remainder stands at one outer edge of a parse argument");
    }
    let mode = if markers.len() == 2 {
        "part"
    } else if markers[0] == 0 {
        "suffix"
    } else {
        "prefix"
    };
    Ok((parts, true, mode))
}

fn expression_children(expr: &Json) -> Vec<&Json> {
    if let Some(inner) = expr.get("splice") {
        return vec![inner];
    }
    for key in ["seq", "choice", "ranked", "and"] {
        if let Some(items) = array_of(expr, key) {
            return items.iter().collect();
        }
    }
    if let Some(inner) = expr.get("optional") {
        return vec![inner];
    }
    if let Some(inner) = expr.get("repeat") {
        return std::iter::once(inner).chain(expr.get("separator")).collect();
    }
    if has(expr, "capture") || has(expr, "test") {
        return expr.get("expr").into_iter().collect();
    }
    Vec::new()
}

/// The first capture of a query body, in the order written.
fn query_capture(body: &Json) -> Option<&Json> {
    let mut pending = vec![body];
    while let Some(node) = pending.pop() {
        if str_of(node, "capture").is_some() {
            return Some(node);
        }
        pending.extend(expression_children(node).into_iter().rev());
    }
    None
}

/// Whether an elidable optional's expression has a head that elision
/// can restore (engine §3.8, §9): a terminal reference or a parameter,
/// perhaps tested, first in it. A grouped expression has none.
fn elidable_head(expr: &Json) -> bool {
    if !object(expr) || grouped(expr) {
        return false;
    }
    let head = if str_of(expr, "capture").is_some() {
        expr.get("expr")
    } else if let Some(items) = array_of(expr, "seq") {
        items.first()
    } else {
        Some(expr)
    };
    let Some(head) = head.filter(|head| object(head) && !grouped(head)) else { return false };
    let terminal = |node: &Json| {
        object(node)
            && !grouped(node)
            && (str_of(node, "param").is_some()
                || keys(node).all(|key| key == "ref" || key == "at") && str_of(node, "ref").is_some_and(upper_name))
    };
    if terminal(head) {
        return true;
    }
    let mut base = head;
    while object(base) && !grouped(base) && str_of(base, "test").is_some_and(|op| matches!(op, "=" | "≠" | "tags")) {
        match base.get("expr") {
            Some(inner) => base = inner,
            None => break,
        }
    }
    terminal(base)
}

/// Why a method's name, receiver and arguments do not fit it, by their
/// shapes alone (engine §9).
fn method_shape_problem(value: &Json, recipe: bool) -> Option<String> {
    const SIGNATURE: &str = "a method has the wrong receiver or arguments";
    let Some(name) = str_of(value, "method") else { return Some("unknown method name".into()) };
    if !known_method(name) {
        return Some(format!("unknown method {name}"));
    }
    let (Some(receiver), Some(args)) = (value.get("receiver").filter(|r| object(r)), array_of(value, "args")) else {
        return Some("a malformed method".into());
    };
    let bare = str_of(receiver, "capture").is_some() && keys(receiver).count() == 1
        || has(receiver, "param")
        || has(receiver, "call");
    let span = bare || str_of(receiver, "method").is_some_and(|method| SPAN_METHODS.contains(&method));
    let named = |arg: &Json, key: &str| object(arg) && keys(arg).count() == 1 && str_of(arg, key).is_some();
    let rule = |arg: &Json| named(arg, "rule") || object(arg) && (has(arg, "param") || has(arg, "call"));
    let term =
        |arg: &Json| object(arg) && !["rule", "classifier", "terminal", "integer"].iter().any(|key| has(arg, key));
    let receiver_method = str_of(receiver, "method");
    let unresolved = has_unresolved(receiver) || args.iter().any(has_unresolved);
    let valid = match name {
        "parse" => {
            let [argument] = args else { return Some(SIGNATURE.into()) };
            if !object(argument) || keys(argument).count() != 1 || !argument.get("body").is_some_and(object) {
                return Some(SIGNATURE.into());
            }
            if restored(receiver) {
                if let Ok((_, _, "suffix" | "part")) = query_body(argument.get("body").unwrap()) {
                    return Some("suffix parse requires an ordinary span, not a restored span".into());
                }
            }
            span
        }
        "error-free" => matches!(receiver_method, Some("parse" | "error-free")) && args.is_empty(),
        "ngrams" => {
            matches!(args, [arg] if named(arg, "integer") && str_of(arg, "integer").is_some_and(valid_integer))
        }
        "split" => {
            matches!(args, [arg] if term(arg))
                && !(unresolved && args[0].get("string").and_then(Json::as_str) == Some(""))
        }
        "classify" => matches!(args, [arg] if named(arg, "classifier")),
        "tags" => (span || matches!(receiver_method, Some("parse" | "error-free"))) && args.is_empty(),
        "followed-by" | "preceded-by" => {
            bare && !args.is_empty() && args.iter().all(|arg| rule(arg) || named(arg, "terminal"))
        }
        "without-elision-except" => {
            if !unresolved {
                if !bare {
                    return Some(
                        "without-elision-except requires a bare capture: write $x.without-elision-except(family).onward"
                            .into(),
                    );
                }
                if !matches!(args, [arg] if rule(arg)) {
                    return Some("without-elision-except requires one rule name".into());
                }
            }
            bare && matches!(args, [arg] if rule(arg))
        }
        "without-elision" => {
            if !unresolved && (!bare || !args.is_empty()) {
                return Some("without-elision requires a bare capture: write $x.without-elision.onward".into());
            }
            bare && args.is_empty()
        }
        "verbatim-text" | "emitted" => recipe && bare && args.is_empty(),
        _ => args.is_empty() && (span || receiver_method == Some("emitted") && matches!(name, "value" | "image")),
    };
    (!valid).then(|| SIGNATURE.into())
}

/// The engine-tag literal a tag term retains, if any: one that no
/// difference removes and that every operand of an intersection holds.
fn first_engine_literal(term: &Json) -> Option<&Json> {
    fn literals(term: &Json) -> Vec<&Json> {
        if !object(term) {
            return Vec::new();
        }
        if str_of(term, "tag").is_some_and(|tag| tag.starts_with('_')) {
            return vec![term];
        }
        if has(term, "if") {
            return term.get("then").map(literals).unwrap_or_default();
        }
        if let Some(items) = array_of(term, "difference") {
            return items.first().map(literals).unwrap_or_default();
        }
        if let Some(items) = array_of(term, "union") {
            return items.iter().flat_map(literals).collect();
        }
        if let Some(items) = array_of(term, "intersection") {
            let parts: Vec<Vec<&Json>> = items.iter().map(literals).collect();
            let names: Vec<FxSet<&str>> =
                parts.iter().map(|list| list.iter().filter_map(|value| str_of(value, "tag")).collect()).collect();
            return parts
                .into_iter()
                .flatten()
                .filter(|value| str_of(value, "tag").is_some_and(|tag| names.iter().all(|set| set.contains(tag))))
                .collect();
        }
        Vec::new()
    }
    literals(term).into_iter().next()
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Kind {
    ClassifierEntry,
    ClassifierClass,
    Alternative,
    Pattern,
    PatternPart,
    PatternItem,
    Arg,
    Target,
    TestOperands,
    MethodShape,
    Expr,
    Tags,
    Emission,
    Recipe,
    Condition,
    Term,
    Call,
}

impl Kind {
    fn name(self) -> &'static str {
        match self {
            Kind::ClassifierEntry => "classifier-entry",
            Kind::ClassifierClass => "classifier-class",
            Kind::Alternative => "alternative",
            Kind::Pattern => "pattern",
            Kind::PatternPart => "pattern-part",
            Kind::PatternItem => "pattern-item",
            Kind::Arg => "arg",
            Kind::Target => "target",
            Kind::TestOperands => "test-operands",
            Kind::MethodShape => "method-shape",
            Kind::Expr => "expr",
            Kind::Tags => "tags",
            Kind::Emission => "emission",
            Kind::Recipe => "recipe",
            Kind::Condition => "condition",
            Kind::Term => "term",
            Kind::Call => "call",
        }
    }
}

/// One part to visit, and what its context says of it.
#[derive(Clone, Copy)]
struct Task<'a> {
    kind: Kind,
    value: &'a Json,
    depth: usize,
    at: Option<Position>,
    feature_directive_at: Option<Position>,
    closed: bool,
    whole: bool,
    sealed: bool,
    captured_terminator: bool,
    chain: bool,
    item: bool,
    ranked: bool,
    recipe: bool,
    query: bool,
    message: bool,
    pattern_tag: bool,
    set_condition_at: Option<Position>,
}

impl<'a> Task<'a> {
    fn new(kind: Kind, value: &'a Json, depth: usize, at: Option<Position>) -> Self {
        Task {
            kind,
            value,
            depth,
            at,
            feature_directive_at: None,
            closed: false,
            whole: false,
            sealed: false,
            captured_terminator: false,
            chain: false,
            item: false,
            ranked: false,
            recipe: false,
            query: false,
            message: false,
            pattern_tag: false,
            set_condition_at: None,
        }
    }
}

/// The structural pass of one declaration.
pub(crate) struct Shapes<'a, 'u> {
    pub unicode: &'u Unicode,
    pub expanded: bool,
    pending: Vec<Task<'a>>,
    params: FxSet<&'a str>,
    /// The first declaration that nests too deeply.
    pub first_deep: Option<Position>,
}

impl<'a, 'u> Shapes<'a, 'u> {
    pub(crate) fn new(unicode: &'u Unicode, expanded: bool) -> Self {
        Shapes { unicode, expanded, pending: Vec::new(), params: FxSet::default(), first_deep: None }
    }

    fn rule_name(&self, name: &str) -> bool {
        is_classifier_name(name)
            || self.unicode.is_emoji_name(name)
            || self.expanded && name.contains('(') && name.ends_with(')')
    }

    fn tag(&self, name: &str) -> bool {
        upper_name(name) || name.starts_with('_') && name != "_" && self.unicode.canonical_tag(name) == Some(name)
    }

    fn push(&mut self, task: Task<'a>) {
        self.pending.push(task);
    }

    /// The structural fault of one declaration of kind `kind`, if any.
    pub(crate) fn declaration(&mut self, kind: &str, decl: &'a Json) -> Option<DomFault> {
        self.pending.clear();
        self.params.clear();
        let decl_at = node_at(decl).unwrap_or((1, 1));
        let header = self.header(kind, decl, decl_at);
        if header.is_some() {
            return header;
        }
        self.run(decl_at)
    }

    fn header(&mut self, kind: &str, decl: &'a Json, decl_at: Position) -> Option<DomFault> {
        let at = Some(decl_at);
        let fault = |problem: &str, value: Option<&Json>| Some(DomFault::new(problem, value.and_then(node_at).or(at)));
        let name_at = hidden_at(decl, "nameAt").or(at);
        match kind {
            "directive" => {
                let name = str_of(decl, "name");
                let args = decl.get("args");
                if !name.is_some_and(|name| DIRECTIVE_NAMES.contains(&name)) {
                    return fault("a malformed directive", Some(decl));
                }
                let name = name.unwrap();
                if has(decl, "conditions")
                    && (name != "features" || !array_of(decl, "conditions").is_some_and(|items| !items.is_empty()))
                {
                    return fault(
                        if name != "features" {
                            "only %features accepts conditions"
                        } else {
                            "malformed feature conditions"
                        },
                        Some(decl),
                    );
                }
                if name == "ambiguity-resolution" {
                    let valid = !has(decl, "args")
                        && decl
                            .get("steps")
                            .is_some_and(|steps| steps_from_json(steps).is_ok_and(|steps| valid_steps(&steps)));
                    if !valid {
                        return fault(
                            "%ambiguity-resolution requires a pattern for each key step and no operand on a final lean",
                            Some(decl),
                        );
                    }
                    for step in array_of(decl, "steps").unwrap().iter().rev() {
                        if let Some(pattern) = step.get("pattern") {
                            let step_at = node_at(step);
                            if has(pattern, "const") {
                                self.push(Task::new(Kind::Term, pattern, 0, step_at.or(at)));
                            } else {
                                self.push(Task::new(Kind::Pattern, pattern, 0, step_at.or(node_pos(pattern, at))));
                            }
                        }
                    }
                    return None;
                }
                let Some(args) =
                    args.and_then(Json::as_array).filter(|args| args.iter().all(|arg| arg.as_str().is_some()))
                else {
                    return fault("a malformed directive", Some(decl));
                };
                let args: Vec<&str> = args.iter().filter_map(Json::as_str).collect();
                if name == "elision-only" && !args.is_empty() {
                    return fault("a malformed directive", Some(decl));
                }
                if matches!(name, "stage" | "extend-stage" | "redefine-stage")
                    && !matches!(&args[..], [arg] if is_classifier_name(arg))
                {
                    return fault(&format!("%{name} takes one lowercase name"), Some(decl));
                }
                if matches!(name, "include" | "names") && args.len() != 1
                    || name == "features" && !(!args.is_empty() && args.iter().all(|arg| feature_name(arg)))
                {
                    return fault(
                        if name == "features" { "%features takes feature names" } else { "a malformed directive" },
                        Some(decl),
                    );
                }
                if let Some(conditions) = array_of(decl, "conditions") {
                    for condition in conditions.iter().rev() {
                        let mut task = Task::new(Kind::Condition, condition, 0, at);
                        task.feature_directive_at = at;
                        self.push(task);
                    }
                }
                None
            }
            "constant" => {
                let name = str_of(decl, "name");
                if !exact(decl, &["name", "op", "value", "at"])
                    || !name.is_some_and(is_constant_name)
                    || !matches!(str_of(decl, "op"), Some("define" | "redefine"))
                {
                    let problem = if name.is_some_and(|name| !is_constant_name(name)) {
                        "a constant requires a user name"
                    } else {
                        "a malformed constant"
                    };
                    return Some(DomFault::new(problem, name_at));
                }
                let value = decl.get("value").unwrap_or(&ABSENT);
                let mut task = Task::new(Kind::Term, value, 0, node_pos(value, at));
                task.closed = true;
                self.push(task);
                None
            }
            "classifier" => {
                let name = str_of(decl, "name");
                if !exact(decl, &["name", "entries", "at"])
                    || !name.is_some_and(is_classifier_name)
                    || array_of(decl, "entries").is_none()
                {
                    let problem = match name {
                        Some(name) if !is_classifier_name(name) => format!(
                            "{name} begins with a capital, so it is a tag; a classifier's name begins with a lower-case letter"
                        ),
                        _ => "a malformed classifier".into(),
                    };
                    return Some(DomFault::new(problem, name_at));
                }
                for entry in array_of(decl, "entries").unwrap().iter().rev() {
                    let entry_at = entry.get("at").and_then(position_of).or(at);
                    self.push(Task::new(Kind::ClassifierEntry, entry, 0, entry_at));
                }
                None
            }
            "implication" => {
                if !exact(decl, &["if", "then", "at"]) {
                    return fault("a malformed implication", Some(decl));
                }
                for side in ["then", "if"] {
                    let value = decl.get(side).unwrap_or(&ABSENT);
                    let mut task = Task::new(Kind::Term, value, 0, node_pos(value, at));
                    task.closed = true;
                    self.push(task);
                }
                None
            }
            _ => self.rule_header(decl, decl_at),
        }
    }

    fn rule_header(&mut self, rule: &'a Json, decl_at: Position) -> Option<DomFault> {
        let at = Some(decl_at);
        let name_at = hidden_at(rule, "nameAt").or(at);
        let name = str_of(rule, "name");
        let params = array_of(rule, "params");
        if let Some(params) = params {
            for param in params {
                if let Some(param) = param.as_str() {
                    self.params.insert(param);
                }
            }
        }
        if has(rule, "params") {
            let valid_names = params.is_some_and(|params| {
                !params.is_empty() && params.iter().all(|param| param.as_str().is_some_and(parameter_name))
            }) && !has(rule, "args");
            if !valid_names || self.params.len() != params.map_or(0, <[Json]>::len) {
                if valid_names {
                    let params = params.unwrap();
                    let duplicate = (0..params.len())
                        .find(|&index| params[..index].iter().any(|earlier| earlier == &params[index]));
                    if let Some(index) = duplicate {
                        let param_at = hidden(rule, "paramAts")
                            .and_then(Json::as_array)
                            .and_then(|ats| ats.get(index))
                            .and_then(position_of)
                            .or(at);
                        return Some(DomFault::new(
                            format!("duplicate parameter @{}", params[index].as_str().unwrap()),
                            param_at,
                        ));
                    }
                }
                return Some(DomFault::new("malformed template parameters", at));
            }
        }
        if let Some(instance) = rule.get("instance") {
            if is_true(hidden(rule, "hasHead")) {
                return Some(DomFault::new("a binding requires a plain rule name", at));
            }
            if !exact(rule, &["name", "op", "instance", "conditions", "at"])
                || !name.is_some_and(|name| self.rule_name(name))
                || !matches!(str_of(rule, "op"), Some("define" | "redefine"))
                || array_of(rule, "conditions") != Some(&[])
            {
                let problem = if name.is_some_and(|name| !self.rule_name(name)) {
                    "a rule name starts with a lowercase letter or uses one eligible emoji"
                } else {
                    "a malformed instance binding"
                };
                return Some(DomFault::new(problem, name_at));
            }
            self.push(Task::new(Kind::Call, instance, 0, node_pos(instance, at)));
            return None;
        }
        if let Some(args) = rule.get("args") {
            let Some(args) = args.as_array().filter(|args| !args.is_empty()) else {
                return Some(DomFault::new("a malformed call", name_at));
            };
            let mut stack: Vec<&Json> = args.iter().collect();
            while let Some(part) = stack.pop() {
                if has(part, "param") {
                    return Some(DomFault::new("a head cannot mix parameters and concrete arguments", name_at));
                }
                stack.extend(json_children(part));
            }
            if !matches!(str_of(rule, "op"), Some("redefine" | "extend")) {
                return Some(DomFault::new("an instance head requires an edit", name_at));
            }
        }
        if !exact(
            rule,
            &[
                "name",
                "params",
                "args",
                "op",
                "tags",
                "value",
                "image",
                "alternatives",
                "emit",
                "conditions",
                "erased",
                "error",
                "warning",
                "suppressWarnings",
                "at",
            ],
        ) || !name.is_some_and(|name| self.rule_name(name))
            || !matches!(str_of(rule, "op"), Some("define" | "redefine" | "extend"))
            || !array_of(rule, "alternatives").is_some_and(|items| !items.is_empty())
            || array_of(rule, "conditions").is_none()
        {
            let problem = if name.is_some_and(|name| !self.rule_name(name)) {
                "a rule name starts with a lowercase letter or uses one eligible emoji"
            } else {
                "a malformed rule"
            };
            return Some(DomFault::new(problem, name_at));
        }
        if has(rule, "erased") && !is_true(rule.get("erased")) {
            return Some(DomFault::new("a malformed erased rule", node_pos(rule, at)));
        }
        if has(rule, "error") && has(rule, "warning")
            || params.is_some() && (has(rule, "error") || has(rule, "warning"))
        {
            return Some(DomFault::new(
                "a definition accepts one diagnostic, and a template accepts none",
                node_pos(rule, at),
            ));
        }
        if let Some(codes) = rule.get("suppressWarnings") {
            let valid = codes.as_array().is_some_and(|codes| {
                !codes.is_empty()
                    && (codes.len() == 1 && codes[0].as_str() == Some("_")
                        || codes.iter().all(|code| code.as_str().is_some_and(feature_name)))
            });
            if !valid {
                return Some(DomFault::new("a malformed warning suppression", node_pos(rule, at)));
            }
        }
        // Pushed in reverse of the order written, so that the work list
        // visits the head, the tags, the value, the image, the
        // alternatives, the conditions, the diagnostic and the emission.
        if let Some(emit) = rule.get("emit") {
            self.push(Task::new(Kind::Emission, emit, 0, node_pos(emit, at)));
        }
        for (kind, clause) in [("warning", "warningAt"), ("error", "errorAt")] {
            if let Some(recipe) = rule.get(kind) {
                let mut task = Task::new(Kind::Recipe, recipe, 0, node_pos(recipe, at));
                task.message = true;
                task.set_condition_at = hidden_at(rule, clause);
                self.push(task);
            }
        }
        for condition in array_of(rule, "conditions").unwrap().iter().rev() {
            self.push(Task::new(Kind::Condition, condition, 0, node_pos(condition, at)));
        }
        for alternative in array_of(rule, "alternatives").unwrap().iter().rev() {
            self.push(Task::new(Kind::Alternative, alternative, 0, node_pos(alternative, at)));
        }
        for channel in ["image", "value"] {
            if let Some(recipe) = rule.get(channel) {
                self.push(Task::new(Kind::Recipe, recipe, 0, node_pos(recipe, at)));
            }
        }
        if let Some(tags) = rule.get("tags") {
            self.push(Task::new(Kind::Tags, tags, 0, node_pos(tags, at)));
        }
        if has(rule, "args") {
            // The head, as a call of the rule's name.
            self.push(Task::new(Kind::Call, rule, 0, name_at));
        }
        None
    }

    /// Runs the work list of one declaration to its first fault. A
    /// ranked-choice syntax fault stands before any other.
    fn run(&mut self, decl_at: Position) -> Option<DomFault> {
        let mut first = None;
        while let Some(task) = self.pending.pop() {
            if let Some(fault) = self.task(task, decl_at) {
                if fault.ranked {
                    return Some(fault);
                }
                first.get_or_insert(fault);
            }
        }
        first
    }

    fn task(&mut self, task: Task<'a>, decl_at: Position) -> Option<DomFault> {
        crate::work::count(crate::work::Work::Walked, 1);
        let value = task.value;
        let depth = task.depth;
        let enclosing = task.feature_directive_at.or_else(|| node_pos(value, task.at.or(Some(decl_at))));
        let feature = task.feature_directive_at.is_some();
        // A fault at `target`, or else at the part the task visits.
        let report_at = |problem: &str, target: Option<Position>| {
            Some(DomFault::new(problem, if feature { enclosing } else { target.or(enclosing) }))
        };
        let report_node = |problem: &str, target: &Json| report_at(problem, node_at(target));
        let report = |problem: &str| report_at(problem, None);
        if depth > DOM_MAX_DEPTH {
            self.first_deep.get_or_insert(decl_at);
        }
        if !object(value) && task.kind != Kind::Call {
            return report(&format!("a malformed {}", task.kind.name()));
        }
        let child = |kind: Kind, value: &'a Json| {
            let mut next = Task::new(kind, value, depth + 1, enclosing);
            next.closed = task.closed;
            next.feature_directive_at = task.feature_directive_at;
            next
        };
        let same = |kind: Kind, value: &'a Json, at: Option<Position>| {
            let mut next = Task::new(kind, value, depth, at);
            next.feature_directive_at = task.feature_directive_at;
            next
        };
        let gate_fault = |gates: Option<&'a Json>| -> Result<(), Option<&'a Json>> {
            let Some(gates) = gates.and_then(Json::as_array) else { return Err(None) };
            match gates.iter().find(|gate| {
                !exact(gate, &["feature", "kind", "negated"])
                    || keys(gate).count() != 3
                    || !str_of(gate, "feature").is_some_and(feature_name)
                    || !matches!(gate.get("negated"), Some(Json::Bool(_)))
                    || str_of(gate, "kind") != Some("gate")
            }) {
                Some(gate) => Err(Some(gate)),
                None => Ok(()),
            }
        };
        match task.kind {
            Kind::ClassifierEntry => {
                let bad = gate_fault(value.get("gates"));
                if !exact(value, &["gates", "keys", "op", "class", "at"])
                    || !is_position(value.get("at"))
                    || bad.is_err()
                    || !matches!(str_of(value, "op"), Some("∈" | "∉"))
                    || str_of(value, "class").is_none()
                    || !array_of(value, "keys").is_some_and(|keys| !keys.is_empty())
                {
                    return match bad {
                        Err(Some(gate)) => report_node("a malformed classifier entry", gate),
                        _ => report_node("a malformed classifier entry", value),
                    };
                }
                let keys = array_of(value, "keys").unwrap();
                for key in keys {
                    if !string_term(key) {
                        return report_node("a malformed classifier key", key);
                    }
                }
                let entry_at = node_at(value);
                self.push(same(Kind::ClassifierClass, value, hidden_at(value, "classAt").or(entry_at)));
                for key in keys.iter().rev() {
                    self.push(same(Kind::Term, key, node_pos(key, entry_at)));
                }
                None
            }
            Kind::ClassifierClass => {
                let class = str_of(value, "class").unwrap_or("");
                if !class_name(class) {
                    return report_at(
                        &format!("{class} is not a class: a class starts and ends with a capital"),
                        hidden_at(value, "classAt").or(node_at(value)),
                    );
                }
                None
            }
            Kind::Alternative => {
                let bad = gate_fault(value.get("gates"));
                if !exact(value, &["gates", "expr", "tags", "value", "image"]) || !has(value, "expr") || bad.is_err() {
                    return match bad {
                        Err(Some(gate)) => report_node("a malformed alternative", gate),
                        _ => report_node("a malformed alternative", value),
                    };
                }
                for channel in ["image", "value"] {
                    if let Some(recipe) = value.get(channel) {
                        self.push(same(Kind::Recipe, recipe, node_pos(recipe, enclosing)));
                    }
                }
                if let Some(tags) = value.get("tags") {
                    self.push(same(Kind::Tags, tags, node_pos(tags, enclosing)));
                }
                let expr = value.get("expr").unwrap();
                let mut next = same(Kind::Expr, expr, node_pos(expr, enclosing));
                next.whole = true;
                self.push(next);
                None
            }
            Kind::Pattern => {
                let rule_name = |name: &str| self.rule_name(name) && !self.tag(name);
                let terminal = |name: &str| name == "_Elided" || self.tag(name);
                let inspect = crate::patterns::shapes::Inspection {
                    name: Some(&rule_name),
                    terminal: Some(&terminal),
                    depth,
                    defer_depth: true,
                    ..Default::default()
                };
                if let Some(problem) = crate::patterns::shapes::problem(value, &inspect) {
                    return report_at(&problem, task.at);
                }
                let deep = crate::patterns::shapes::Inspection {
                    name: Some(&rule_name),
                    terminal: Some(&terminal),
                    depth,
                    ..Default::default()
                };
                if crate::patterns::shapes::problem(value, &deep).as_deref() == Some("nested too deeply") {
                    self.first_deep.get_or_insert(decl_at);
                }
                self.push(same(Kind::PatternPart, value, enclosing));
                None
            }
            Kind::PatternPart => self.pattern_part(task, enclosing, &report, &report_node),
            Kind::PatternItem => {
                if let Some(arms) = array_of(value, "choice") {
                    for arm in arms.iter().rev() {
                        for item in arm.as_array().unwrap_or(&[]).iter().rev() {
                            self.push(child(Kind::PatternItem, item));
                        }
                    }
                }
                for key in ["separator", "repeat", "optional"] {
                    if let Some(items) = array_of(value, key) {
                        for item in items.iter().rev() {
                            self.push(child(Kind::PatternItem, item));
                        }
                    }
                }
                if let Some(inner) = value.get("child") {
                    self.push(child(Kind::PatternPart, inner));
                }
                None
            }
            _ if has(value, "param") => {
                if !matches!(task.kind, Kind::Expr | Kind::Arg | Kind::Term | Kind::Tags | Kind::Target) {
                    return report(&format!("a malformed {}", task.kind.name()));
                }
                let name = str_of(value, "param");
                let shaped = exact(value, &["param", "at"]) && is_position(value.get("at"));
                if !shaped || !name.is_some_and(|name| self.params.contains(name)) {
                    return report(&match name {
                        Some(name) if shaped => format!("undeclared parameter @{name}"),
                        _ => "an undeclared or malformed parameter".into(),
                    });
                }
                None
            }
            _ if has(value, "call") || task.kind == Kind::Call => {
                if !matches!(task.kind, Kind::Expr | Kind::Arg | Kind::Term | Kind::Tags | Kind::Target | Kind::Call) {
                    return report(&format!("a malformed {}", task.kind.name()));
                }
                // A rule's head is a call of the rule's name.
                let (name, at_valid) = if task.kind == Kind::Call && !has(value, "call") {
                    (str_of(value, "name"), true)
                } else {
                    (str_of(value, "call"), exact(value, &["call", "args", "at"]) && is_position(value.get("at")))
                };
                let args = array_of(value, "args");
                if !at_valid
                    || !name.is_some_and(|name| self.rule_name(name))
                    || !args.is_some_and(|args| !args.is_empty())
                {
                    return report("a malformed call");
                }
                for arg in args.unwrap().iter().rev() {
                    let mut next = child(Kind::Arg, arg);
                    next.closed = false;
                    self.push(next);
                }
                None
            }
            Kind::Arg => {
                if has(value, "classifier") || has(value, "integer") {
                    return report("an argument cannot read or declare captures");
                }
                let here = same(Kind::Expr, value, enclosing);
                if let Some(body) = value.get("body") {
                    if !exact(value, &["body"]) {
                        return report("a malformed body argument");
                    }
                    let mut next = same(Kind::Expr, body, enclosing);
                    next.whole = true;
                    self.push(next);
                } else if let Some(targets) = value.get("targets") {
                    let Some(targets) =
                        targets.as_array().filter(|targets| exact(value, &["targets"]) && targets.len() >= 2)
                    else {
                        return report("a malformed target choice");
                    };
                    for target in targets.iter().rev() {
                        self.push(same(Kind::Target, target, enclosing));
                    }
                } else if has(value, "requirements") && !has(value, "test") {
                    let Some(entries) = array_of(value, "requirements").filter(|_| exact(value, &["requirements"]))
                    else {
                        return report("a malformed requirement list");
                    };
                    for entry in entries {
                        let term = entry.get("value");
                        if !exact(entry, &["negated", "value"])
                            || !matches!(entry.get("negated"), Some(Json::Bool(_)))
                            || !term.is_some_and(|term| {
                                object(term)
                                    && !grouped(term)
                                    && (str_of(term, "tag").is_some_and(|t| !t.is_empty())
                                        || str_of(term, "const").is_some_and(|t| !t.is_empty())
                                        || str_of(term, "param").is_some_and(|t| !t.is_empty()))
                            })
                        {
                            return report_node("a malformed requirement", term.unwrap_or(entry));
                        }
                    }
                    for entry in entries.iter().rev() {
                        self.push(same(Kind::Term, entry.get("value").unwrap(), enclosing));
                    }
                } else if let Some(rule) = value.get("rule").filter(|rule| rule.as_str().is_some_and(|r| !r.is_empty()))
                {
                    if !exact(value, &["rule"]) || !rule.as_str().is_some_and(|name| self.rule_name(name)) {
                        return report("a malformed nominal rule argument");
                    }
                } else if has(value, "splice") || has(value, "test") || has(value, "range") || has(value, "wildcard") {
                    self.push(here);
                } else {
                    self.push(same(Kind::Term, value, enclosing));
                }
                None
            }
            Kind::Target => {
                let valid = exact(value, &["rule"]) && str_of(value, "rule").is_some_and(|name| self.rule_name(name))
                    || exact(value, &["terminal"]) && str_of(value, "terminal").is_some_and(upper_name);
                if !valid {
                    return report("a malformed query target");
                }
                None
            }
            Kind::TestOperands => {
                if str_of(value, "test") == Some("tags") {
                    let requirements = array_of(value, "requirements").unwrap_or(&[]);
                    for requirement in requirements {
                        let term = requirement.get("value");
                        if !exact(requirement, &["negated", "value"])
                            || !matches!(requirement.get("negated"), Some(Json::Bool(_)))
                            || !term.is_some_and(|term| {
                                object(term)
                                    && !grouped(term)
                                    && (has(term, "tag") || has(term, "const") || has(term, "param"))
                            })
                        {
                            return report_node("a malformed requirement", term.unwrap_or(requirement));
                        }
                    }
                    for requirement in requirements.iter().rev() {
                        self.push(child(Kind::Term, requirement.get("value").unwrap()));
                    }
                } else {
                    let operand = value.get("value").unwrap_or(&ABSENT);
                    if !string_term(operand) {
                        return report_node("a malformed value test", operand);
                    }
                    self.push(child(Kind::Term, operand));
                }
                None
            }
            Kind::MethodShape => {
                // An unknown method in a recipe atom is a fault of type
                // inspection, which reports it after the clause's tag
                // terms (engine §9.3).
                let name = str_of(value, "method");
                let deferred = task.recipe && name.is_some_and(|name| !known_method(name));
                if !deferred {
                    if let Some(problem) = method_shape_problem(value, task.recipe) {
                        return report(&problem);
                    }
                }
                if task.query && name.is_some_and(|name| known_method(name) && !QUERY_METHODS.contains(&name)) {
                    return report("a condition requires a query method");
                }
                None
            }
            Kind::Expr => self.expr(task, enclosing, &report, &report_node, &report_at),
            Kind::Tags => {
                // A malformed tag term gets its structural fault from its
                // own task.
                if let Some(literal) = first_engine_literal(value) {
                    return report_node("a tag clause cannot introduce an engine tag", literal);
                }
                self.push(same(Kind::Term, value, enclosing));
                None
            }
            Kind::Emission => {
                let items = array_of(value, "items");
                if keys(value).count() != 1 || !items.is_some_and(|items| !items.is_empty()) {
                    return report("a malformed emission");
                }
                let items = items.unwrap();
                for item in items {
                    let capture = item.get("capture");
                    if !exact(item, &["capture", "insert", "tags", "value", "image", "before", "after"])
                        || has(item, "capture") == has(item, "insert")
                        || capture.is_some_and(|capture| capture.as_str().is_none())
                        || has(item, "insert") && !is_true(item.get("insert"))
                    {
                        return report_node("a malformed emission item", item);
                    }
                    if let Some(name) = capture.and_then(Json::as_str).filter(|name| !name.is_empty()) {
                        if !is_capture_name(name) {
                            return Some(DomFault::new("a malformed emission item", Some(decl_at)));
                        }
                    }
                    for side in ["before", "after"] {
                        if let Some(list) = item.get(side) {
                            let names = list.as_array().unwrap_or(&[]);
                            if !capture.and_then(Json::as_str).is_some_and(|name| !name.is_empty())
                                || names.is_empty()
                                || !names.iter().all(|name| name.as_str().is_some())
                            {
                                return report_node("a malformed attachment", item);
                            }
                            if !names.iter().all(|name| name.as_str().is_some_and(is_capture_name)) {
                                return Some(DomFault::new("a malformed attachment", Some(decl_at)));
                            }
                        }
                    }
                }
                for item in items.iter().rev() {
                    let item_at = node_pos(item, enclosing);
                    for channel in ["image", "value"] {
                        if let Some(recipe) = item.get(channel) {
                            self.push(same(Kind::Recipe, recipe, node_pos(recipe, item_at)));
                        }
                    }
                    if let Some(tags) = item.get("tags") {
                        self.push(same(Kind::Tags, tags, node_pos(tags, item_at)));
                    }
                }
                None
            }
            Kind::Recipe => {
                let atoms = array_of(value, "concat");
                if keys(value).count() != 1 || !atoms.is_some_and(|atoms| !atoms.is_empty()) {
                    return report("a malformed recipe");
                }
                if task.message {
                    let mut nodes = vec![value];
                    while let Some(node) = nodes.pop() {
                        if [node.get("capture"), node.get("captured")]
                            .into_iter()
                            .flatten()
                            .any(|name| name.as_str().is_none())
                        {
                            return report("a malformed message recipe");
                        }
                        if str_of(node, "method") == Some("emitted") {
                            return report_at("a message recipe cannot read .emitted", task.set_condition_at);
                        }
                        if !has(node, "pattern") {
                            nodes.extend(json_children(node));
                        }
                    }
                }
                let atoms = atoms.unwrap();
                for atom in atoms {
                    if !object(atom) {
                        return report_node("a malformed recipe atom", atom);
                    }
                }
                for atom in atoms.iter().rev() {
                    let mut next = child(Kind::Term, atom);
                    next.recipe = true;
                    self.push(next);
                }
                None
            }
            Kind::Condition => {
                let forms: &[&[&str]] = &[
                    &["method", "receiver", "args"],
                    &["op", "left", "right"],
                    &["not"],
                    &["any"],
                    &["all"],
                    &["captured"],
                    &["if", "then"],
                    &["nonempty"],
                ];
                if !has_one_form(value, forms) {
                    return report("a malformed condition");
                }
                if has(value, "method") {
                    if str_of(value, "method").is_none() {
                        return report("a condition requires a query method");
                    }
                    let mut next = same(Kind::Term, value, enclosing);
                    next.query = true;
                    self.push(next);
                } else if let Some(term) = value.get("nonempty") {
                    let set = ["union", "intersection", "difference"].iter().any(|key| has(term, key));
                    let mut next = Task::new(Kind::Term, term, depth + 1, enclosing);
                    next.feature_directive_at = task.feature_directive_at;
                    next.set_condition_at = if set { node_pos(term, enclosing) } else { None };
                    self.push(next);
                } else if let Some(op) = value.get("op") {
                    let tree = matches!(op.as_str(), Some("≅" | "≇"));
                    let left = value.get("left").unwrap();
                    if !op.as_str().is_some_and(|op| COMPARATORS.contains(&op))
                        || tree && !(str_of(left, "capture").is_some() && keys(left).count() == 1)
                    {
                        return report("a malformed comparison");
                    }
                    self.push(child(Kind::Term, value.get("right").unwrap()));
                    self.push(child(Kind::Term, left));
                } else if let Some(name) = value.get("captured") {
                    if !name.as_str().is_some_and(|name| name.is_empty() || is_capture_name(name)) {
                        return report("a malformed presence");
                    }
                } else if let Some(inner) = value.get("not") {
                    self.push(child(Kind::Condition, inner));
                } else if let Some(antecedent) = value.get("if") {
                    self.push(child(Kind::Condition, value.get("then").unwrap()));
                    self.push(child(Kind::Condition, antecedent));
                } else {
                    let values = value.get("any").or_else(|| value.get("all")).and_then(Json::as_array);
                    let Some(values) = values.filter(|values| values.len() >= 2) else {
                        return report("a malformed connective");
                    };
                    for condition in values.iter().rev() {
                        self.push(child(Kind::Condition, condition));
                    }
                }
                None
            }
            Kind::Term => self.term(task, enclosing, &report, &report_node, &report_at),
            Kind::Call => unreachable!("a call is visited above"),
        }
    }

    fn pattern_part(
        &mut self,
        task: Task<'a>,
        enclosing: Option<Position>,
        report: &dyn Fn(&str) -> Option<DomFault>,
        report_node: &dyn Fn(&str, &Json) -> Option<DomFault>,
    ) -> Option<DomFault> {
        let value = task.value;
        let depth = task.depth;
        let child = |kind: Kind, value: &'a Json| {
            let mut next = Task::new(kind, value, depth + 1, enclosing);
            next.feature_directive_at = task.feature_directive_at;
            next
        };
        if let Some(name) = str_of(value, "param") {
            if !self.params.contains(name) {
                return report(&format!("undeclared parameter @{name}"));
            }
        }
        if has(value, "call") {
            let mut nodes: Vec<&Json> = value.get("args").into_iter().collect();
            while let Some(node) = nodes.pop() {
                if str_of(node, "rule").is_some_and(|rule| self.tag(rule)) {
                    return report_node("a pattern argument rule reads back as a tag", node);
                }
                nodes.extend(json_children(node).into_iter().rev());
            }
            for arg in array_of(value, "args").unwrap_or(&[]).iter().rev() {
                self.push(child(Kind::Arg, arg));
            }
        }
        if let Some(children) = array_of(value, "children") {
            for item in children.iter().rev() {
                self.push(child(Kind::PatternItem, item));
            }
        }
        for key in ["union", "intersection", "difference"] {
            if let Some(operands) = array_of(value, key) {
                for operand in operands.iter().rev() {
                    self.push(child(Kind::PatternPart, operand));
                }
            }
        }
        if has(value, "path") {
            if let Some(pattern) = value.get("pattern") {
                self.push(child(Kind::PatternPart, pattern));
            }
        }
        if str_of(value, "test") == Some("tags") {
            let requirements = array_of(value, "requirements").unwrap_or(&[]);
            if !self.expanded && value.get("expr").is_some_and(|expr| has(expr, "name") || has(expr, "call")) {
                for requirement in requirements {
                    if requirement.get("negated") != Some(&Json::Bool(true))
                        && requirement.get("value").and_then(|v| str_of(v, "tag")) == Some("_Elided")
                    {
                        return report_node("a rule pattern cannot require _Elided", requirement.get("value").unwrap());
                    }
                }
            }
            for requirement in requirements.iter().rev() {
                if let Some(operand) = requirement.get("value") {
                    let mut next = child(Kind::Term, operand);
                    next.pattern_tag = true;
                    self.push(next);
                }
            }
        } else if has(value, "test") {
            if let Some(operand) = value.get("value") {
                self.push(child(Kind::Term, operand));
            }
        }
        if let Some(inner) = value.get("expr") {
            self.push(child(Kind::PatternPart, inner));
        }
        if let Some(range) = array_of(value, "range") {
            if let [left, right] = range {
                if let Some(problem) = super::schema::literal_range_problem(left, right) {
                    return report(problem);
                }
            }
            for endpoint in range.iter().rev() {
                let mut next = Task::new(Kind::Term, endpoint, depth, enclosing);
                next.feature_directive_at = task.feature_directive_at;
                self.push(next);
            }
        }
        if let Some(literal) = value.get("literal") {
            let mut next = Task::new(Kind::Term, literal, depth, enclosing);
            next.feature_directive_at = task.feature_directive_at;
            self.push(next);
        }
        None
    }

    fn base(&self, value: &Json) -> bool {
        object(value)
            && !grouped(value)
            && (has(value, "param")
                || has(value, "call")
                || has(value, "splice")
                || str_of(value, "ref").is_some()
                || has(value, "literal")
                || has(value, "range")
                || is_true(value.get("wildcard")))
    }

    fn target(&self, value: &Json) -> bool {
        self.base(value)
            || object(value) && str_of(value, "test") == Some("tags") && value.get("expr").is_some_and(|e| self.base(e))
    }

    fn expr(
        &mut self,
        task: Task<'a>,
        enclosing: Option<Position>,
        report: &dyn Fn(&str) -> Option<DomFault>,
        report_node: &dyn Fn(&str, &Json) -> Option<DomFault>,
        report_at: &dyn Fn(&str, Option<Position>) -> Option<DomFault>,
    ) -> Option<DomFault> {
        let value = task.value;
        let depth = task.depth;
        let child = |kind: Kind, value: &'a Json| {
            let mut next = Task::new(kind, value, depth + 1, enclosing);
            next.closed = task.closed;
            next.feature_directive_at = task.feature_directive_at;
            next
        };
        let inner_expr = |value: &'a Json| {
            let mut next = child(Kind::Expr, value);
            next.sealed = task.sealed;
            next.chain = task.chain;
            next.item = task.item;
            next.ranked = task.ranked;
            next
        };
        let same = |kind: Kind, value: &'a Json| {
            let mut next = Task::new(kind, value, depth, enclosing);
            next.feature_directive_at = task.feature_directive_at;
            next
        };
        if let Some(target) = value.get("splice") {
            let valid = expr_single(value, "splice")
                && object(target)
                && (str_of(target, "ref").is_some_and(|name| self.rule_name(name)) || has(target, "call"));
            if !valid {
                return report("a malformed splice");
            }
            self.push(inner_expr(target));
        } else if has(value, "test") && !matches!(value.get("test"), Some(Json::Null) | Some(Json::Bool(false))) {
            let op = str_of(value, "test");
            let tags = op == Some("tags");
            let inner = value.get("expr");
            if !op.is_some_and(|op| matches!(op, "=" | "≠" | "tags"))
                || !expr_exact(value, if tags { &["test", "requirements", "expr"] } else { &["test", "value", "expr"] })
                || !has(value, if tags { "requirements" } else { "value" })
                || !inner.is_some_and(|inner| if tags { self.base(inner) } else { self.target(inner) })
            {
                return report("a malformed test");
            }
            if tags && array_of(value, "requirements").is_none() {
                return report("a malformed tag test");
            }
            let mut operands = same(Kind::TestOperands, value);
            operands.closed = task.closed;
            self.push(operands);
            self.push(inner_expr(inner.unwrap()));
        } else if let Some(name) = value.get("capture") {
            let inner = value.get("expr");
            if !expr_exact(value, &["capture", "expr"]) || name.as_str().is_none() || !inner.is_some_and(object) {
                return report("a malformed capture");
            }
            if task.chain {
                return report(
                    "a capture cannot stand inside a chain, whose levels are constituents of its rule: a condition on $ serves each level",
                );
            }
            if task.item && task.ranked {
                return report(
                    "an item capture cannot stand inside a ranked group: name the ranked choice as a rule and capture that rule",
                );
            }
            if task.sealed && !task.captured_terminator {
                return report(
                    "a capture cannot stand inside an elidable optional, which elision restores as one unit",
                );
            }
            let name = name.as_str().unwrap();
            if name.is_empty() {
                return report("$ is the whole constituent and wraps nothing");
            }
            if !is_capture_name(name) {
                return report("a capture's name is all lower case");
            }
            let mut wrapped = inner.unwrap();
            while object(wrapped) && !grouped(wrapped) && str_of(wrapped, "test").is_some() {
                match wrapped.get("expr") {
                    Some(next) => wrapped = next,
                    None => break,
                }
            }
            if !self.base(wrapped) {
                return report("a capture wraps one symbol");
            }
            self.push(inner_expr(inner.unwrap()));
        } else if ["seq", "choice", "ranked", "and"].into_iter().any(|key| has(value, key)) {
            let non_at: Vec<&str> = keys(value).filter(|key| *key != "at").collect();
            if non_at.len() != 1 || !expr_exact(value, &non_at) {
                return report("a malformed expression");
            }
            let key = non_at[0];
            let items = array_of(value, key);
            if !items.is_some_and(|items| items.len() >= 2 && !(key == "and" && items.len() > crate::grammar::MAX_AND))
            {
                return if key == "ranked" {
                    report("ranked-choice-syntax: a ranked expression requires two options")
                } else if key == "and" && items.is_some_and(|items| items.len() > crate::grammar::MAX_AND) {
                    report("an & joins at most 16 items")
                } else {
                    report("a malformed expression")
                };
            }
            for item in items.unwrap().iter().rev() {
                let mut next = inner_expr(item);
                next.ranked = task.ranked || key == "ranked";
                self.push(next);
            }
        } else if let Some(inner) = value.get("optional") {
            let elidable = has(value, "elidable");
            if !expr_exact(value, &["optional", "elidable", "default"])
                || !object(inner)
                || elidable && (!is_true(value.get("elidable")) || !elidable_head(inner))
            {
                return report("a malformed optional");
            }
            if let Some(default) = value.get("default") {
                let default_at = hidden_at(value, "defaultAt");
                if !is_true(value.get("elidable")) || !string_term(default) {
                    return report_at("a malformed default", node_at(default).or(default_at));
                }
                if let Some(written) = str_of(default, "string") {
                    let mut head = if has(inner, "capture") {
                        inner.get("expr")
                    } else if let Some(items) = array_of(inner, "seq") {
                        items.first()
                    } else {
                        Some(inner)
                    };
                    while let Some(node) = head.filter(|node| object(node) && has(node, "test")) {
                        if str_of(node, "test") != Some("tags") {
                            if let Some(expected) = node.get("value").and_then(|operand| str_of(operand, "string")) {
                                if (written == expected) != (str_of(node, "test") == Some("=")) {
                                    return report_at(
                                        "a default fails its head test",
                                        default_at.or_else(|| node_at(default)),
                                    );
                                }
                            }
                        }
                        head = node.get("expr");
                    }
                }
                self.push(child(Kind::Term, default));
            }
            let mut next = inner_expr(inner);
            next.sealed = task.sealed || is_true(value.get("elidable"));
            next.captured_terminator =
                !task.sealed && is_true(value.get("elidable")) && str_of(inner, "capture").is_some();
            self.push(next);
        } else if let Some(item) = value.get("repeat") {
            if !expr_exact(value, &["repeat", "separator", "chain"])
                || has(value, "chain") && !matches!(str_of(value, "chain"), Some("left" | "right"))
            {
                return report("a malformed repetition");
            }
            if has(value, "chain") && (!task.whole || grouped(value)) {
                return report("a chain is the whole expression of its alternative: name it as a rule to use it here");
            }
            let chain = has(value, "chain");
            let inside = |value: &'a Json| {
                let mut next = child(Kind::Expr, value);
                next.sealed = task.sealed;
                next.chain = chain;
                next.item = !chain;
                next.ranked = false;
                next
            };
            if let Some(separator) = value.get("separator") {
                self.push(inside(separator));
            }
            self.push(inside(item));
        } else if let Some(literal) = value.get("literal") {
            if !expr_single(value, "literal") || !string_term(literal) {
                return report("a malformed literal");
            }
            self.push(same(Kind::Term, literal));
        } else if let Some(range) = value.get("range") {
            let ends = range.as_array().filter(|ends| ends.len() == 2 && ends.iter().all(string_term));
            let Some(ends) = ends.filter(|_| expr_single(value, "range")) else {
                return report("a malformed range");
            };
            if let Some(problem) = super::schema::literal_range_problem(&ends[0], &ends[1]) {
                return report(problem);
            }
            for end in ends.iter().rev() {
                self.push(same(Kind::Term, end));
            }
        } else if let Some(name) = value.get("ref") {
            if !expr_single(value, "ref") || !name.as_str().is_some_and(|name| self.rule_name(name) || self.tag(name)) {
                return report("a malformed reference");
            }
        } else if !(expr_single(value, "empty") && is_true(value.get("empty"))
            || expr_single(value, "wildcard") && is_true(value.get("wildcard")))
        {
            let _ = report_node;
            return report("a malformed expression");
        }
        None
    }

    fn term(
        &mut self,
        task: Task<'a>,
        enclosing: Option<Position>,
        report: &dyn Fn(&str) -> Option<DomFault>,
        report_node: &dyn Fn(&str, &Json) -> Option<DomFault>,
        report_at: &dyn Fn(&str, Option<Position>) -> Option<DomFault>,
    ) -> Option<DomFault> {
        let value = task.value;
        let depth = task.depth;
        let child = |kind: Kind, value: &'a Json| {
            let mut next = Task::new(kind, value, depth + 1, enclosing);
            next.closed = task.closed;
            next.feature_directive_at = task.feature_directive_at;
            next
        };
        let forms: &[&[&str]] = &[
            &["string"],
            &["concat"],
            &["tag"],
            &["const", "at"],
            &["emptySet"],
            &["capture"],
            &["method", "receiver", "args"],
            &["union"],
            &["intersection"],
            &["difference"],
            &["if", "then"],
            &["pattern"],
        ];
        if !has_one_form(value, forms) {
            return report("a malformed term");
        }
        if let Some(text) = value.get("string") {
            if text.as_str().is_none() {
                return report("a malformed scalar string");
            }
        } else if let Some(tag) = value.get("tag").filter(|tag| tag.as_str() != Some("")) {
            if !(task.pattern_tag && tag.as_str() == Some("_Elided")) && !tag.as_str().is_some_and(|tag| self.tag(tag))
            {
                return report("a malformed tag");
            }
        } else if let Some(name) = value.get("const").filter(|name| name.as_str() != Some("")) {
            if !name.as_str().is_some_and(is_constant_name) || !is_position(value.get("at")) {
                return report("a malformed constant reference");
            }
        } else if let Some(empty) = value.get("emptySet") {
            if empty != &Json::Bool(true) {
                return report("a malformed empty set");
            }
        } else if let Some(name) = value.get("capture") {
            if !name.as_str().is_some_and(|name| name.is_empty() || is_capture_name(name)) {
                return report("a malformed capture reference");
            }
        } else if has(value, "method") {
            let name = str_of(value, "method");
            let args = array_of(value, "args");
            if matches!(name, Some("classify" | "ngrams")) && args.is_some_and(|args| args.iter().any(has_unresolved)) {
                return report("a parameter cannot replace a classifier name or integer argument");
            }
            let receiver = value.get("receiver").filter(|receiver| object(receiver));
            let query = name.is_some_and(|name| QUERY_METHODS.contains(&name));
            if args.is_none()
                || receiver.is_none()
                || !task.query && query && !matches!(name, Some("parse" | "error-free"))
            {
                let problem = if !task.query && args.is_some() && receiver.is_some() && query {
                    "a query method is a condition, not a term"
                } else {
                    "a malformed method"
                };
                return report_at(problem, task.set_condition_at.or_else(|| node_at(value)));
            }
            let (args, receiver) = (args.unwrap(), receiver.unwrap());
            // The receiver and the arguments are visited before the
            // method's own signature.
            let known = name.is_some_and(known_method);
            if !task.closed || matches!(name, Some("split" | "ngrams")) || !known {
                let mut next = Task::new(Kind::MethodShape, value, depth, enclosing);
                next.recipe = task.recipe;
                next.query = task.query;
                next.feature_directive_at = task.feature_directive_at;
                self.push(next);
            }
            if known {
                let name = name.unwrap();
                for arg in args.iter().rev() {
                    if let Some(body) = arg.get("body").filter(|_| object(arg)) {
                        if name != "parse" || !exact(arg, &["body"]) {
                            return report_node("a malformed parse argument", arg);
                        }
                        let (parts, sequence, _) = match query_body(body) {
                            Ok(found) => found,
                            Err(problem) => return report_node(problem, body),
                        };
                        if let Some(capture) = parts.iter().find_map(|part| query_capture(part)) {
                            return report_node("a parse argument cannot declare captures", capture);
                        }
                        // A body of several parts is a sequence of them.
                        let extra = if sequence && parts.len() == 1 { 2 } else { 1 };
                        if parts.len() == 1 {
                            let mut next =
                                Task::new(Kind::Expr, parts[0], depth + extra, node_pos(parts[0], enclosing));
                            next.feature_directive_at = task.feature_directive_at;
                            self.push(next);
                        } else {
                            for part in parts.iter().rev() {
                                let mut next = Task::new(Kind::Expr, part, depth + 2, node_pos(body, enclosing));
                                next.feature_directive_at = task.feature_directive_at;
                                self.push(next);
                            }
                        }
                    } else if let Some(rule) = str_of(arg, "rule") {
                        if keys(arg).count() != 1
                            || !matches!(name, "without-elision-except" | "followed-by" | "preceded-by")
                            || !self.rule_name(rule)
                        {
                            return report("a malformed rule argument");
                        }
                    } else if let Some(terminal) = str_of(arg, "terminal") {
                        if keys(arg).count() != 1 || !TARGET_METHODS.contains(&name) || !upper_name(terminal) {
                            return report("a malformed boundary target");
                        }
                    } else if let Some(integer) = arg.get("integer").filter(|_| object(arg)) {
                        if keys(arg).count() != 1 || name != "ngrams" || integer.as_str().is_none() {
                            return report_node("a malformed integer argument", arg);
                        }
                        if !integer.as_str().is_some_and(valid_integer) {
                            return report_node("an integer argument is positive and has no leading zeros", arg);
                        }
                    } else if let Some(classifier) = str_of(arg, "classifier") {
                        if keys(arg).count() != 1 || name != "classify" || !is_classifier_name(classifier) {
                            return report("a malformed classifier argument");
                        }
                    } else {
                        self.push(child(Kind::Term, arg));
                    }
                }
            }
            let mut next = child(Kind::Term, receiver);
            next.recipe = task.recipe;
            self.push(next);
        } else if let Some(items) = value.get("concat") {
            let Some(items) = items.as_array().filter(|items| items.len() >= 2) else {
                return report("a malformed concatenation");
            };
            for item in items.iter().rev() {
                self.push(child(Kind::Term, item));
            }
        } else if let Some(pattern) = value.get("pattern") {
            let mut next = child(Kind::Pattern, pattern);
            next.closed = false;
            self.push(next);
        } else if let Some(antecedent) = value.get("if") {
            self.push(child(Kind::Term, value.get("then").unwrap()));
            self.push(child(Kind::Condition, antecedent));
        } else {
            let key = ["union", "intersection", "difference"].into_iter().find(|key| has(value, key)).unwrap();
            let items = array_of(value, key);
            let Some(items) = items.filter(|items| items.len() >= 2 && (key != "difference" || items.len() == 2))
            else {
                return report("a malformed set operation");
            };
            for item in items.iter().rev() {
                let mut next = child(Kind::Term, item);
                next.set_condition_at = task.set_condition_at;
                self.push(next);
            }
        }
        None
    }
}
