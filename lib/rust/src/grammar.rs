//! Stitching a stage's documents into one grammar (engine §2), with the
//! checks that need no features: directives, definitions, references,
//! captures and terms.

use std::collections::HashMap;
use std::sync::Arc;

use crate::dom::{Alternative, Arg, Cond, Dom, EmitItem, Expr, Op, Term};
use crate::error::Error;

/// How a stage chooses among parses (engine §6): the lean of rule 2, or,
/// for the `elision-only` check (§7), rule 1 alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Lean {
    Greedy,
    Lazy,
    TagsOnly,
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

/// Stitches the documents of one stage, in order.
pub(crate) fn stitch(stage: &str, documents: &[(Arc<str>, Arc<Dom>)]) -> Result<StageGrammar, Error> {
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
    for (document, dom) in documents {
        // The rules this document defined or redefined (engine §2).
        let mut defined_here: HashMap<&str, ()> = HashMap::new();
        for rule in &dom.rules {
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
                            "%rule {} is already defined; %redefine-rule replaces a rule an earlier document defined",
                            rule.name
                        ));
                    }
                    defined_here.insert(&rule.name, ());
                    grammar.index.insert(rule.name.clone(), grammar.rules.len());
                    grammar.rules.push(stitched());
                }
                Op::Redefine => {
                    let index = match grammar.index.get(&rule.name) {
                        Some(&index) if !defined_here.contains_key(rule.name.as_str()) => index,
                        _ => {
                            return error(format!(
                                "%redefine-rule {} replaces no rule of an earlier document",
                                rule.name
                            ))
                        }
                    };
                    defined_here.insert(&rule.name, ());
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
    }
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
        Expr::Optional(inner) | Expr::Repeat(inner, _) => check_expr(grammar, inner, false),
        Expr::Ref(name) => {
            if is_terminal_name(name) {
                Ok(())
            } else {
                check_rule(grammar, name)
            }
        }
        Expr::Terminal(_) | Expr::Empty => Ok(()),
        Expr::Capture(name, inner) => {
            if !top {
                return Err(format!("the capture ${name} is not at the top level of its alternative"));
            }
            match inner.as_ref() {
                Expr::Ref(_) | Expr::Terminal(_) => check_expr(grammar, inner, false),
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
        Term::Literal(_) | Term::Weak(_) | Term::EmptySet => Ok(()),
        Term::Union(items) | Term::Intersection(items) => {
            for item in items {
                check_term(grammar, item)?;
            }
            Ok(())
        }
        Term::Capture(_) => Ok(()),
        Term::If(cond, then) => {
            check_cond(grammar, cond)?;
            check_term(grammar, then)
        }
        Term::Call(name, args) => match (name.as_str(), &args[..]) {
            ("phonemes" | "text" | "classes" | "words" | "tags", [Arg::Term(span)]) => check_span(span),
            ("tags", [Arg::Term(span), Arg::Rule(rule)]) => {
                check_span(span)?;
                check_rule(grammar, rule)
            }
            ("lowercase", [Arg::Term(inner)]) => check_term(grammar, inner),
            ("head" | "tail" | "last" | "from" | "after", _) => Err(format!("{name}() is a span, not a value")),
            (
                "phonemes" | "text" | "classes" | "words" | "tags" | "lowercase" | "matches" | "begins" | "initial",
                _,
            ) => Err(format!("{name}() is called with the wrong arguments")),
            _ => Err(format!("an unknown function {name}()")),
        },
    }
}

fn check_cond(grammar: &StageGrammar, cond: &Cond) -> Result<(), String> {
    match cond {
        Cond::Compare(op, left, right) => {
            if !matches!(op.as_str(), "=" | "≠" | "∈" | "∉" | "⊆") {
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
