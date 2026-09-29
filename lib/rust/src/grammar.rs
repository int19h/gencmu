//! Stitching a stage's documents into one grammar (engine §2), with the
//! checks that need no features: directives, definitions, references,
//! captures and terms.

use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;

use crate::dom::{
    constant_value_type, constants_in_rule, constants_in_term, rule_type_fault, Alternative, Arg, Cond, ConstDef, Dom,
    EmitItem, Expr, Fault, Op, RuleDef, Term, Type,
};
use crate::error::Error;
use crate::tags::{character_tag, code_of_character_tag, is_name};
use crate::unicode::Unicode;

/// How a stage chooses among parses (engine §6): the lean of rule 2, or,
/// for the `elision-only` check (§7), no lean at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Lean {
    Greedy,
    Lazy,
    /// Neither: any two derivations that differ are tied, as the
    /// `elision-only` check ranks (§7).
    Neither,
}

/// An alternative after stitching, with the clauses of the rule that
/// contributed it.
#[derive(Debug, Clone)]
pub(crate) struct StitchedAlternative {
    pub alternative: Alternative,
    pub rule_tags: Option<Term>,
    pub emit: Option<Vec<EmitItem>>,
    pub conditions: Vec<Cond>,
    pub verbatim: bool,
    pub document: Arc<str>,
    pub at: (usize, usize),
}

#[derive(Debug, Clone)]
pub(crate) struct StitchedRule {
    pub name: String,
    pub alternatives: Vec<StitchedAlternative>,
    pub document: Arc<str>,
}

/// One replacement or extension the loader recorded (engine §2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Change {
    /// The stage whose grammar changed.
    pub stage: String,
    /// The rule that was replaced or extended.
    pub rule: String,
    /// True for an extension (`%extend-rule`), false for a replacement
    /// (`%redefine-rule`).
    pub extension: bool,
    /// The document that made the change.
    pub document: String,
}

#[derive(Debug, Clone)]
pub(crate) struct StageGrammar {
    pub name: String,
    pub rules: Vec<StitchedRule>,
    pub index: HashMap<String, usize>,
    pub lean: Lean,
    pub elision_only: bool,
    /// Whether an elided terminator is forbidden where its constituent
    /// could have been longer (engine §4).
    pub maximal: bool,
    pub elidable: Vec<String>,
    pub changes: Vec<Change>,
}

/// The most items an `&` may have (engine §3.2): its expansions are every
/// non-empty subsequence, so more would be too many to lower.
pub(crate) const MAX_AND: usize = 16;

pub(crate) fn is_terminal_name(name: &str) -> bool {
    name.chars().next().is_some_and(|c| c.is_ascii_uppercase())
}

fn located(message: String, document: &str, at: (usize, usize)) -> Error {
    Error::grammar(message).in_document(document).at(at.0, at.1)
}

/// Stitches the runs of items of one stage, in order: each a document's
/// path and a DOM of consecutive items of it. `unicode` gives the tags of a
/// range in a constant's value.
pub(crate) fn stitch(
    stage: &str,
    documents: &[(Arc<str>, Arc<Dom>)],
    unicode: &Unicode,
) -> Result<StageGrammar, Error> {
    let mut grammar = StageGrammar {
        name: stage.to_string(),
        rules: Vec::new(),
        index: HashMap::new(),
        lean: Lean::Greedy,
        elision_only: false,
        maximal: false,
        elidable: Vec::new(),
        changes: Vec::new(),
    };
    let mut resolution: Option<(Arc<str>, (usize, usize))> = None;
    let mut constants = Constants { stage, unicode, values: HashMap::new() };
    // The definitions of rules that use constants, which are checked once
    // the constants have their final values; a rule that a later one
    // replaces included.
    let mut users: Vec<(&Arc<str>, &RuleDef)> = Vec::new();
    for (document, dom) in documents {
        for rule in &dom.rules {
            if !constants_in_rule(rule).is_empty() {
                users.push((document, rule));
            }
            let alternatives: Vec<StitchedAlternative> = rule
                .alternatives
                .iter()
                .map(|alternative| StitchedAlternative {
                    alternative: alternative.clone(),
                    rule_tags: rule.tags.clone(),
                    emit: rule.emit.clone(),
                    conditions: rule.conditions.clone(),
                    verbatim: rule.verbatim,
                    document: document.clone(),
                    at: rule.at,
                })
                .collect();
            let error = |message: String| Err(located(message, document, rule.at));
            let stitched = || StitchedRule {
                name: rule.name.clone(),
                alternatives: alternatives.clone(),
                document: document.clone(),
            };
            match rule.op {
                Op::Define => {
                    if grammar.index.contains_key(&rule.name) {
                        return error(format!(
                            "%rule {} is already defined; %redefine-rule replaces a rule",
                            rule.name
                        ));
                    }
                    grammar.index.insert(rule.name.clone(), grammar.rules.len());
                    grammar.rules.push(stitched());
                }
                Op::Redefine => {
                    // Any earlier item of the stage, in this document or
                    // another, may have defined it (engine §2).
                    let Some(&index) = grammar.index.get(&rule.name) else {
                        return error(format!("%redefine-rule {} replaces no rule defined before it", rule.name));
                    };
                    // The replacement keeps the place of the rule it
                    // replaces (§3, "Numbering").
                    grammar.rules[index] = stitched();
                    grammar.changes.push(Change {
                        stage: stage.to_string(),
                        rule: rule.name.clone(),
                        extension: false,
                        document: document.to_string(),
                    });
                }
                Op::Extend => {
                    let Some(&index) = grammar.index.get(&rule.name) else {
                        return error(format!(
                            "%extend-rule {} extends a rule that is not defined before it",
                            rule.name
                        ));
                    };
                    grammar.rules[index].alternatives.extend(alternatives);
                    grammar.changes.push(Change {
                        stage: stage.to_string(),
                        rule: rule.name.clone(),
                        extension: true,
                        document: document.to_string(),
                    });
                }
            }
        }
        for directive in &dom.directives {
            let here = |message: String| located(message, document, directive.at);
            match directive.name.as_str() {
                "ambiguity-resolution" => {
                    if resolution.is_some() {
                        return Err(here(format!("stage {stage} has two %ambiguity-resolution directives")));
                    }
                    let refused = || {
                        here(
                            "%ambiguity-resolution takes greedy or lazy, then optionally elision-only, then optionally maximal"
                                .to_string(),
                        )
                    };
                    let mut args = directive.args.iter().map(String::as_str).peekable();
                    grammar.lean = match args.next() {
                        Some("greedy") => Lean::Greedy,
                        Some("lazy") => Lean::Lazy,
                        _ => return Err(refused()),
                    };
                    // Each optional word in its place, and nothing after
                    // them (engine §2).
                    grammar.elision_only = args.next_if_eq(&"elision-only").is_some();
                    grammar.maximal = args.next_if_eq(&"maximal").is_some();
                    if args.next().is_some() {
                        return Err(refused());
                    }
                    resolution = Some((document.clone(), directive.at));
                }
                "elidable" => {
                    for arg in &directive.args {
                        if !grammar.elidable.contains(arg) {
                            grammar.elidable.push(arg.clone());
                        }
                    }
                }
                other => return Err(here(format!("an unknown directive %{other}"))),
            }
        }
        for constant in &dom.constants {
            constants.add(document, constant)?;
        }
    }
    constants.resolve(&mut grammar, &users)?;
    if resolution.is_none() {
        return Err(Error::grammar(format!("stage {stage} has no %ambiguity-resolution directive")).in_stage(stage));
    }
    if !grammar.index.contains_key("text") {
        return Err(Error::grammar(format!("stage {stage} does not define its start rule text")).in_stage(stage));
    }
    for rule in &grammar.rules {
        for alternative in &rule.alternatives {
            check_alternative(&grammar, alternative).map_err(|message| {
                located(format!("in {}: {message}", rule.name), &alternative.document, alternative.at)
            })?;
        }
    }
    Ok(grammar)
}

/// A constant's value (engine §2, §10): a string, or a set of strings or
/// of tags.
#[derive(Debug, Clone, PartialEq)]
enum Value {
    Str(String),
    Set(BTreeSet<String>),
}

impl Value {
    fn set(self) -> BTreeSet<String> {
        match self {
            Value::Set(set) => set,
            Value::Str(_) => BTreeSet::new(),
        }
    }

    fn string(self) -> String {
        match self {
            Value::Str(text) => text,
            Value::Set(_) => String::new(),
        }
    }

    /// The term that stands for the value once the stage is stitched: a
    /// constant whose value is the empty set is the empty set (§3.6).
    fn term(&self) -> Term {
        match self {
            Value::Str(text) => Term::Str(text.clone()),
            Value::Set(set) => match set.len() {
                0 => Term::EmptySet,
                1 => Term::Tag(set.iter().next().expect("one member").clone()),
                _ => Term::Union(set.iter().map(|member| Term::Tag(member.clone())).collect()),
            },
        }
    }
}

/// A constant of a stage: its value and its type now, and the document of
/// its last definition.
struct StageConstant {
    value: Value,
    ty: Type,
    document: Arc<str>,
}

/// The constants of a stage as the loader stitches it (engine §2).
struct Constants<'a> {
    stage: &'a str,
    unicode: &'a Unicode,
    values: HashMap<String, StageConstant>,
}

impl Constants<'_> {
    fn ty(&self, name: &str) -> Type {
        self.values.get(name).map_or(Type::Any, |constant| constant.ty)
    }

    /// Defines or redefines a constant, with the value its term has at this
    /// point of the stage (engine §2).
    fn add(&mut self, document: &Arc<str>, constant: &ConstDef) -> Result<(), Error> {
        let ConstDef { name, redefine, value, at } = constant;
        let previous = self.values.get(name);
        match (previous, redefine) {
            (Some(previous), false) => {
                return Err(located(
                    format!(
                        "%const ${name} is already defined in stage {}, in {}; %redefine-const gives it a new value",
                        self.stage, previous.document
                    ),
                    document,
                    *at,
                ));
            }
            (None, true) => {
                return Err(located(
                    format!(
                        "%redefine-const ${name} gives a value to no constant defined before it in stage {}",
                        self.stage
                    ),
                    document,
                    *at,
                ));
            }
            _ => {}
        }
        // A reference sees the constants defined before this point.
        let mut references = Vec::new();
        constants_in_term(value, &mut references);
        for (reference, where_) in references {
            if !self.values.contains_key(reference) {
                return Err(located(
                    format!("${reference} is not defined before this point of stage {}", self.stage),
                    document,
                    where_,
                ));
            }
        }
        let mut ty = constant_value_type(value, *redefine, &|other| self.ty(other))
            .map_err(|fault| fault_error(fault, document, *at))?;
        if let Some(previous) = previous {
            // A redefinition keeps the type, which gives ∅ its kind.
            if ty == Type::Set && matches!(previous.ty, Type::Strings | Type::Tags) {
                ty = previous.ty;
            }
            if ty != previous.ty {
                return Err(located(
                    format!("%redefine-const ${name} keeps the type of the constant, and cannot make it {}", ty.name()),
                    document,
                    *at,
                ));
            }
        }
        let value = self.evaluate(value, document, *at)?;
        self.values.insert(name.clone(), StageConstant { value, ty, document: document.clone() });
        Ok(())
    }

    /// The value of a closed term, with the constants' values now (engine
    /// §2, §10). An empty delimiter or a tag's string that is not a name
    /// comes from a constant here, since the reader refuses a literal one,
    /// and the error stands at that constant.
    fn evaluate(&self, term: &Term, document: &str, item: (usize, usize)) -> Result<Value, Error> {
        let set = |part: &Term| self.evaluate(part, document, item).map(Value::set);
        let string = |part: &Term| self.evaluate(part, document, item).map(Value::string);
        Ok(match term {
            Term::Str(text) => Value::Str(text.clone()),
            Term::Tag(tag) => Value::Set(BTreeSet::from([tag.clone()])),
            Term::Range(start, end) => {
                let codes = code_of_character_tag(start).zip(code_of_character_tag(end));
                let (first, last) = codes.expect("a range of two character tags, which reading checks");
                Value::Set((first..=last).filter_map(char::from_u32).map(|c| character_tag(c, self.unicode)).collect())
            }
            Term::EmptySet => Value::Set(BTreeSet::new()),
            Term::Const(name, _) => self.values.get(name).expect("a constant defined before").value.clone(),
            Term::Union(items) => {
                let mut out = BTreeSet::new();
                for item in items {
                    out.extend(set(item)?);
                }
                Value::Set(out)
            }
            Term::Intersection(items) => {
                let mut out: Option<BTreeSet<String>> = None;
                for item in items {
                    let next = set(item)?;
                    out = Some(match out {
                        None => next,
                        Some(out) => out.intersection(&next).cloned().collect(),
                    });
                }
                Value::Set(out.unwrap_or_default())
            }
            Term::Difference(left, right) => {
                let right = set(right)?;
                Value::Set(set(left)?.into_iter().filter(|member| !right.contains(member)).collect())
            }
            Term::Call(call, args) => match (call.as_str(), &args[..]) {
                ("split", [Arg::Term(text), Arg::Term(delimiter)]) => {
                    let seen = string(delimiter)?;
                    if seen.is_empty() {
                        let fault = Fault { problem: "split has an empty delimiter".to_string(), at: None };
                        return Err(fault_error(fault, document, first_constant(delimiter).unwrap_or(item)));
                    }
                    Value::Set(
                        string(text)?
                            .split(seen.as_str())
                            .filter(|piece| !piece.is_empty())
                            .map(str::to_string)
                            .collect(),
                    )
                }
                ("tag", [Arg::Term(name)]) => {
                    let seen = string(name)?;
                    if !is_name(&seen) {
                        return Err(located(
                            format!("tag({seen:?}): the string is not a name"),
                            document,
                            first_constant(name).unwrap_or(item),
                        ));
                    }
                    Value::Set(BTreeSet::from([seen]))
                }
                _ => return Err(located("a constant's value is not a closed term".to_string(), document, item)),
            },
            Term::Capture(_) | Term::If(..) => {
                return Err(located("a constant's value is not a closed term".to_string(), document, item));
            }
        })
    }

    /// Gives every constant in a rule its final value, once the stage is
    /// stitched, and checks what the reader could not: that each is
    /// defined, that the types agree, and that a constant that `split` or
    /// `tag` reads directly is a delimiter that is not empty, or a name
    /// (engine §2, §9, §10).
    fn resolve(&self, grammar: &mut StageGrammar, users: &[(&Arc<str>, &RuleDef)]) -> Result<(), Error> {
        for &(document, rule) in users {
            for (name, at) in constants_in_rule(rule) {
                if !self.values.contains_key(name) {
                    return Err(located(format!("${name} is not defined in stage {}", self.stage), document, at));
                }
            }
            if let Some(fault) = rule_type_fault(rule, &|name| self.ty(name)) {
                return Err(fault_error(fault, document, rule.at));
            }
            let mut calls = Vec::new();
            calls_in_rule(rule, &mut calls);
            for (call, args) in calls {
                let argument = match (call, args) {
                    ("split", [_, Arg::Term(Term::Const(name, at))]) | ("tag", [Arg::Term(Term::Const(name, at))]) => {
                        (name, *at)
                    }
                    _ => continue,
                };
                let seen = match &self.values[argument.0].value {
                    Value::Str(text) => text.as_str(),
                    Value::Set(_) => "",
                };
                if call == "split" && seen.is_empty() {
                    return Err(located("split has an empty delimiter".to_string(), document, argument.1));
                }
                if call == "tag" && !is_name(seen) {
                    return Err(located(format!("tag({seen:?}): the string is not a name"), document, argument.1));
                }
            }
        }
        if users.is_empty() {
            return Ok(());
        }
        // Each reference holds the final value.
        for rule in &mut grammar.rules {
            for alternative in &mut rule.alternatives {
                let terms = alternative.alternative.tags.iter_mut().chain(alternative.rule_tags.iter_mut()).chain(
                    alternative.emit.iter_mut().flatten().filter_map(|item| match item {
                        EmitItem::Capture(_, tags) => tags.as_mut(),
                        EmitItem::Insert(_) => None,
                    }),
                );
                for term in terms {
                    self.substitute_term(term);
                }
                for cond in &mut alternative.conditions {
                    self.substitute_cond(cond);
                }
            }
        }
        Ok(())
    }

    fn substitute_term(&self, term: &mut Term) {
        match term {
            Term::Const(name, _) => *term = self.values[name.as_str()].value.term(),
            Term::Union(items) | Term::Intersection(items) => {
                items.iter_mut().for_each(|item| self.substitute_term(item));
            }
            Term::Difference(left, right) => {
                self.substitute_term(left);
                self.substitute_term(right);
            }
            Term::If(cond, then) => {
                self.substitute_cond(cond);
                self.substitute_term(then);
            }
            Term::Call(_, args) => {
                for arg in args {
                    if let Arg::Term(term) = arg {
                        self.substitute_term(term);
                    }
                }
            }
            Term::Str(_) | Term::Tag(_) | Term::Range(..) | Term::EmptySet | Term::Capture(_) => {}
        }
    }

    fn substitute_cond(&self, cond: &mut Cond) {
        match cond {
            Cond::Compare(_, left, right) => {
                self.substitute_term(left);
                self.substitute_term(right);
            }
            Cond::Not(inner) => self.substitute_cond(inner),
            Cond::Any(items) | Cond::All(items) => items.iter_mut().for_each(|item| self.substitute_cond(item)),
            Cond::If(antecedent, consequent) => {
                self.substitute_cond(antecedent);
                self.substitute_cond(consequent);
            }
            Cond::Matches(..) | Cond::Begins(..) | Cond::Initial(_) | Cond::Captured(_) => {}
        }
    }
}

/// The error for a construct whose types disagree: at its first constant,
/// which the loader alone could type, or else at the item (engine §9).
fn fault_error(fault: Fault, document: &str, item: (usize, usize)) -> Error {
    located(fault.problem, document, fault.at.unwrap_or(item))
}

fn first_constant(term: &Term) -> Option<(usize, usize)> {
    let mut out = Vec::new();
    constants_in_term(term, &mut out);
    out.first().map(|&(_, at)| at)
}

/// The calls of a rule's terms and conditions, each before the calls in
/// its arguments.
fn calls_in_rule<'r>(rule: &'r RuleDef, out: &mut Vec<(&'r str, &'r [Arg])>) {
    fn term<'r>(t: &'r Term, out: &mut Vec<(&'r str, &'r [Arg])>) {
        match t {
            Term::Call(name, args) => {
                out.push((name, args));
                for arg in args {
                    if let Arg::Term(inner) = arg {
                        term(inner, out);
                    }
                }
            }
            Term::Union(items) | Term::Intersection(items) => items.iter().for_each(|item| term(item, out)),
            Term::Difference(left, right) => {
                term(left, out);
                term(right, out);
            }
            Term::If(c, then) => {
                cond(c, out);
                term(then, out);
            }
            Term::Str(_) | Term::Tag(_) | Term::Range(..) | Term::EmptySet | Term::Capture(_) | Term::Const(..) => {}
        }
    }
    fn cond<'r>(c: &'r Cond, out: &mut Vec<(&'r str, &'r [Arg])>) {
        match c {
            Cond::Compare(_, left, right) => {
                term(left, out);
                term(right, out);
            }
            Cond::Not(inner) => cond(inner, out),
            Cond::Any(items) | Cond::All(items) => items.iter().for_each(|item| cond(item, out)),
            Cond::If(antecedent, consequent) => {
                cond(antecedent, out);
                cond(consequent, out);
            }
            Cond::Matches(..) | Cond::Begins(..) | Cond::Initial(_) | Cond::Captured(_) => {}
        }
    }
    rule.tags.iter().for_each(|t| term(t, out));
    for alternative in &rule.alternatives {
        alternative.tags.iter().for_each(|t| term(t, out));
    }
    for item in rule.emit.iter().flatten() {
        if let EmitItem::Capture(_, Some(t)) = item {
            term(t, out);
        }
    }
    rule.conditions.iter().for_each(|c| cond(c, out));
}

fn check_alternative(grammar: &StageGrammar, alternative: &StitchedAlternative) -> Result<(), String> {
    let expr = &alternative.alternative.expr;
    let top: &[Expr] = match expr {
        Expr::Seq(items) => items,
        other => std::slice::from_ref(other),
    };
    for item in top {
        check_expr(grammar, item, true)?;
    }
    let mut names: Vec<&str> = Vec::new();
    for item in top {
        if let Expr::Capture(name, _) = item {
            if names.contains(&name.as_str()) {
                return Err(format!("the capture ${name} is used twice"));
            }
            names.push(name);
        }
    }
    if names.len() > 4 {
        return Err("an alternative has at most four captures".to_string());
    }
    for term in alternative.alternative.tags.iter().chain(alternative.rule_tags.iter()) {
        check_term(grammar, term)?;
    }
    for cond in &alternative.conditions {
        check_cond(grammar, cond)?;
    }
    for item in alternative.emit.iter().flatten() {
        if let EmitItem::Capture(_, Some(term)) = item {
            check_term(grammar, term)?;
        }
    }
    Ok(())
}

fn check_rule(grammar: &StageGrammar, name: &str) -> Result<(), String> {
    if grammar.index.contains_key(name) {
        Ok(())
    } else {
        Err(format!("the rule {name} is not defined in stage {}", grammar.name))
    }
}

fn check_expr(grammar: &StageGrammar, expr: &Expr, top: bool) -> Result<(), String> {
    match expr {
        Expr::And(items) if items.len() > MAX_AND => {
            Err(format!("an & of {} items; at most {MAX_AND} are allowed", items.len()))
        }
        Expr::Seq(items) | Expr::Choice(items) | Expr::And(items) => {
            for item in items {
                check_expr(grammar, item, false)?;
            }
            Ok(())
        }
        Expr::Optional(inner) | Expr::Repeat(inner, _) | Expr::Spelled(_, inner) => check_expr(grammar, inner, false),
        Expr::Ref(name) => {
            if is_terminal_name(name) {
                Ok(())
            } else {
                check_rule(grammar, name)
            }
        }
        Expr::Terminal(_) | Expr::Range(..) | Expr::Property(_) | Expr::Empty => Ok(()),
        Expr::Capture(name, inner) => {
            if !top {
                return Err(format!("the capture ${name} is not at the top level of its alternative"));
            }
            match inner.as_ref() {
                Expr::Ref(_) | Expr::Terminal(_) | Expr::Range(..) | Expr::Property(_) | Expr::Spelled(..) => {
                    check_expr(grammar, inner, false)
                }
                _ => Err(format!("the capture ${name} does not wrap a single symbol")),
            }
        }
    }
}

fn check_span(term: &Term) -> Result<(), String> {
    match term {
        Term::Capture(_) => Ok(()),
        Term::Call(name, args) if matches!(name.as_str(), "head" | "tail" | "last" | "from" | "after") => {
            match &args[..] {
                [Arg::Term(inner)] => check_span(inner),
                _ => Err(format!("{name}() takes one span")),
            }
        }
        _ => Err("a span must be a capture, or head(), tail(), last(), from() or after() of one".to_string()),
    }
}

fn check_term(grammar: &StageGrammar, term: &Term) -> Result<(), String> {
    match term {
        // Stitching has checked every constant (engine §2).
        Term::Str(_) | Term::Tag(_) | Term::Range(..) | Term::EmptySet | Term::Const(..) => Ok(()),
        Term::Union(items) | Term::Intersection(items) => {
            for item in items {
                check_term(grammar, item)?;
            }
            Ok(())
        }
        Term::Difference(left, right) => {
            check_term(grammar, left)?;
            check_term(grammar, right)
        }
        Term::Capture(_) => Ok(()),
        Term::If(cond, then) => {
            check_cond(grammar, cond)?;
            check_term(grammar, then)
        }
        Term::Call(name, args) => match (name.as_str(), &args[..]) {
            ("phonemes" | "text" | "classes" | "tags", [Arg::Term(span)]) => check_span(span),
            ("tags", [Arg::Term(span), Arg::Rule(rule)]) => {
                check_span(span)?;
                check_rule(grammar, rule)
            }
            ("split", [Arg::Term(string), Arg::Term(delimiter)]) => {
                check_term(grammar, string)?;
                check_term(grammar, delimiter)
            }
            ("tag", [Arg::Term(inner)]) => check_term(grammar, inner),
            ("head" | "tail" | "last" | "from" | "after", _) => Err(format!("{name}() is a span, not a value")),
            ("phonemes" | "text" | "classes" | "tags" | "split" | "tag" | "matches" | "begins" | "initial", _) => {
                Err(format!("{name}() is called with the wrong arguments"))
            }
            _ => Err(format!("an unknown function {name}()")),
        },
    }
}

fn check_cond(grammar: &StageGrammar, cond: &Cond) -> Result<(), String> {
    match cond {
        Cond::Compare(op, left, right) => {
            if !matches!(op.as_str(), "=" | "≠" | "∈" | "∉" | "⊆" | "⊈") {
                return Err(format!("an unknown comparison {op}"));
            }
            check_term(grammar, left)?;
            check_term(grammar, right)
        }
        Cond::Matches(span, rule) | Cond::Begins(span, rule) => {
            check_span(span)?;
            check_rule(grammar, rule)
        }
        Cond::Initial(span) => check_span(span),
        Cond::Not(inner) => check_cond(grammar, inner),
        Cond::Captured(_) => Ok(()),
        Cond::If(antecedent, consequent) => {
            check_cond(grammar, antecedent)?;
            check_cond(grammar, consequent)
        }
        Cond::Any(items) | Cond::All(items) => {
            for item in items {
                check_cond(grammar, item)?;
            }
            Ok(())
        }
    }
}
