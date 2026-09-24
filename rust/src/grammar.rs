//! Stitching a stage's documents into one grammar (engine §2), with the
//! checks that need no features: directives, definitions, references,
//! captures and terms.

use std::collections::HashMap;
use std::sync::Arc;

use crate::dom::{Alternative, Arg, Cond, Dom, Emit, EmitItem, Expr, Op, Term};
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
    pub emit: Option<Emit>,
    pub conditions: Vec<Cond>,
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
    /// True for an extension (`|≔`), false for a replacement (`≔`).
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
    pub elidable: Vec<String>,
    pub free: Option<String>,
    pub changes: Vec<Change>,
}

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
        elidable: Vec::new(),
        free: None,
        changes: Vec::new(),
    };
    let mut resolution: Option<(Arc<str>, (usize, usize))> = None;
    let mut free_at: Option<(Arc<str>, (usize, usize))> = None;
    for (document, dom) in documents {
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
                    document: document.clone(),
                    at: rule.at,
                })
                .collect();
            match rule.op {
                Op::Define => {
                    if defined_here.insert(&rule.name, ()).is_some() {
                        return Err(located(format!("{} is defined twice with ≔", rule.name), document, rule.at));
                    }
                    let stitched = StitchedRule { name: rule.name.clone(), alternatives, document: document.clone() };
                    if let Some(&index) = grammar.index.get(&rule.name) {
                        grammar.rules[index] = stitched;
                        grammar.changes.push(Change {
                            stage: stage.to_string(),
                            rule: rule.name.clone(),
                            extension: false,
                            document: document.to_string(),
                        });
                    } else {
                        grammar.index.insert(rule.name.clone(), grammar.rules.len());
                        grammar.rules.push(stitched);
                    }
                }
                Op::Extend => {
                    let Some(&index) = grammar.index.get(&rule.name) else {
                        return Err(located(
                            format!("{} is extended with |≔ but not defined before", rule.name),
                            document,
                            rule.at,
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
                    grammar.lean = match directive.args.first().map(String::as_str) {
                        Some("greedy") => Lean::Greedy,
                        Some("lazy") => Lean::Lazy,
                        _ => return Err(here("%ambiguity-resolution takes greedy or lazy".to_string())),
                    };
                    grammar.elision_only = match directive.args.get(1).map(String::as_str) {
                        None => false,
                        Some("elision-only") => true,
                        Some(other) => return Err(here(format!("%ambiguity-resolution does not take {other:?}"))),
                    };
                    if directive.args.len() > 2 {
                        return Err(here("%ambiguity-resolution takes at most two arguments".to_string()));
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
                "free-modifiers" => {
                    if free_at.is_some() {
                        return Err(here(format!("stage {stage} has two %free-modifiers directives")));
                    }
                    let [rule] = &directive.args[..] else {
                        return Err(here("%free-modifiers takes one rule".to_string()));
                    };
                    grammar.free = Some(rule.clone());
                    free_at = Some((document.clone(), directive.at));
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
    if let (Some(free), Some((document, at))) = (&grammar.free, &free_at) {
        if !grammar.index.contains_key(free) {
            return Err(located(format!("the free-modifier rule {free} is not defined"), document, *at));
        }
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
    if let Some(Emit::Items(items)) = &alternative.emit {
        for item in items {
            match item {
                EmitItem::This(Some(term)) | EmitItem::Capture(_, Some(term)) => check_term(grammar, term)?,
                _ => {}
            }
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
        Expr::Hash => match &grammar.free {
            Some(_) => Ok(()),
            None => Err("# is used without a %free-modifiers directive".to_string()),
        },
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
        Term::Call(name, args) if matches!(name.as_str(), "head" | "tail" | "last") => match &args[..] {
            [Arg::Term(inner)] => check_span(inner),
            _ => Err(format!("{name}() takes one span")),
        },
        _ => Err("a span must be a capture, or head(), tail() or last() of one".to_string()),
    }
}

fn check_term(grammar: &StageGrammar, term: &Term) -> Result<(), String> {
    match term {
        Term::Literal(_) | Term::Weak(_) | Term::EmptySet => Ok(()),
        Term::Set(items) | Term::Union(items) | Term::Intersection(items) => {
            for item in items {
                check_term(grammar, item)?;
            }
            Ok(())
        }
        Term::Capture(_) => Ok(()),
        Term::Call(name, args) => match (name.as_str(), &args[..]) {
            ("phonemes" | "text" | "classes" | "words" | "tags", [Arg::Term(span)]) => check_span(span),
            ("tags", [Arg::Term(span), Arg::Rule(rule)]) => {
                check_span(span)?;
                check_rule(grammar, rule)
            }
            ("lowercase", [Arg::Term(inner)]) => check_term(grammar, inner),
            ("head" | "tail" | "last", _) => Err(format!("{name}() is a span, not a value")),
            ("phonemes" | "text" | "classes" | "words" | "tags" | "lowercase" | "matches", _) => {
                Err(format!("{name}() is called with the wrong arguments"))
            }
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
        Cond::Matches(span, rule) => {
            check_span(span)?;
            check_rule(grammar, rule)
        }
        Cond::Not(inner) => check_cond(grammar, inner),
        Cond::Any(items) => {
            for item in items {
                check_cond(grammar, item)?;
            }
            Ok(())
        }
    }
}
