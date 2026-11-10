//! Validation of named reports and splice visibility.
use crate::clauses::Part;
use crate::dom::{Cond, Dom, EmitItem, Expr, RuleDef, Term};
use crate::error::Error;
use crate::fxhash::FxSet;
use crate::grammar::StageGrammar;
use std::sync::Arc;

pub(crate) fn definition_problem(rule: &RuleDef) -> Option<String> {
    if rule.error.is_some() && rule.warning.is_some() {
        return Some("a rule cannot report both an error and a warning".into());
    }
    if (rule.error.is_some() || rule.warning.is_some()) && rule.source.params.is_some() {
        return Some("an error or warning cannot stand on a template or call-head definition".into());
    }
    for recipe in rule.error.iter().chain(&rule.warning) {
        let mut pending = vec![Part::Term(recipe)];
        while let Some(part) = pending.pop() {
            if matches!(part,Part::Term(Term::Call(name,_)) if name=="emitted") {
                return Some("a message cannot read an emitted string".into());
            }
            pending.extend(part.children());
        }
    }
    None
}
fn pattern_names(
    pattern: &crate::patterns::Pattern,
    names: &mut FxSet<String>,
    erased: &FxSet<String>,
    resolved_checks: bool,
    document: &str,
    checks: &FxSet<String>,
) -> Result<(), Error> {
    use crate::patterns::{Children, Pattern};
    for part in pattern.walk() {
        if let crate::patterns::Part::Pattern(Pattern::Name(name, at)) = part {
            if checks.contains(name) {
                return Err(Error::grammar(format!("a pattern cannot name check {name}"))
                    .in_document(document)
                    .at(at.0, at.1));
            }
            names.insert(name.clone());
        }
        if let crate::patterns::Part::Pattern(Pattern::Node(atom, _, Some(children))) = part {
            if matches!(children,Children::Sequence(parts) if matches!(parts.as_slice(),[Children::Siblings]))
                || matches!(children, Children::Siblings)
            {
                continue;
            }
            let mut atom = &**atom;
            while let Pattern::Test(_, _, inner, _) = atom {
                atom = inner;
            }
            if let Pattern::Name(name, at) = atom {
                if !resolved_checks && erased.contains(name) {
                    return Err(Error::grammar(format!(
                        "a pattern of erased rule {name} permits only the child list « ⋯ »"
                    ))
                    .in_document(document)
                    .at(at.0, at.1));
                }
            }
        }
    }
    Ok(())
}
fn warning_name(name: &str) -> bool {
    name.starts_with(|c: char| c.is_ascii_alphabetic())
        && name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
        && !name.contains("--")
}
pub(crate) fn check(
    grammar: &StageGrammar,
    documents: &[(Arc<str>, Arc<Dom>)],
    checked_patterns: &[(crate::patterns::Pattern, String)],
    source_checks: Option<&[crate::parameters::expand::ErasurePatternCheck]>,
) -> Result<(), Error> {
    let erased: FxSet<String> = grammar
        .rules
        .iter()
        .filter(|rule| rule.alternatives.iter().all(|alt| alt.erased))
        .map(|rule| rule.name.clone())
        .collect();
    for check in source_checks.unwrap_or_default() {
        if !check.names.is_empty() && check.names.iter().all(|name| erased.contains(name)) {
            return Err(Error::grammar(format!(
                "a pattern of erased rule {} permits only the child list « ⋯ »",
                check.name
            ))
            .in_document(&check.document)
            .at(check.at.0, check.at.1));
        }
    }
    let check_names: FxSet<_> = grammar.checks.iter().map(|(_, check)| check.name.clone()).collect();
    // Resolved patterns include unused templates and replaced definitions (§9.3).
    let mut unused = FxSet::default();
    for (pattern, document) in checked_patterns {
        pattern_names(pattern, &mut unused, &erased, source_checks.is_some(), document, &check_names)?;
    }
    let mut prohibited = FxSet::default();
    let mut splices = Vec::new();
    let mut warnings = FxSet::default();
    for step in &grammar.steps {
        pattern_names(&step.pattern, &mut prohibited, &erased, source_checks.is_some(), "", &check_names)?;
    }
    let mut pending = Vec::new();
    for (document, dom) in documents {
        pending.extend(dom.constants.iter().map(|c| (Part::Term(&c.value), document.as_ref())));
    }
    for (document, check) in &grammar.checks {
        if check.warning.is_some() {
            warnings.insert(check.name.as_str());
            if !warning_name(&check.name) {
                return Err(Error::grammar("a warning code must be a feature name")
                    .in_document(document)
                    .at(check.at.0, check.at.1));
            }
        }
        pending.push((Part::Term(&check.pattern), document.as_ref()));
        pending.extend(check.conditions.iter().map(|condition| (Part::Cond(condition), document.as_ref())));
    }
    let mut expressions = FxSet::default();
    let mut parts = FxSet::default();
    for rule in &grammar.rules {
        for alt in &rule.alternatives {
            let fail = |message| Error::grammar(message).in_document(&alt.document).at(alt.at.0, alt.at.1);
            if alt.clauses.warning.is_some() {
                warnings.insert(rule.name.as_str());
                if !warning_name(&rule.name) {
                    return Err(fail("a warning code must be a feature name"));
                }
            }
            if alt.clauses.error.is_some()
                && !crate::dom::is_classifier_name(&rule.name)
                && !grammar.unicode.is_emoji_name(&rule.name)
            {
                return Err(fail("an error code must be a rule name"));
            }
            let mut body = vec![&alt.alternative.expr];
            while let Some(expr) = body.pop() {
                if !expressions.insert(expr as *const Expr) {
                    continue;
                }
                match expr {
                    Expr::Splice(inner) => {
                        let Expr::Ref(name) = &**inner else {
                            return Err(fail("a splice targets a rule"));
                        };
                        if !grammar.index.contains_key(name) {
                            return Err(fail("a splice targets a rule"));
                        }
                        splices.push((name, alt));
                    }
                    Expr::Seq(xs) | Expr::Choice(xs) | Expr::And(xs) | Expr::Ranked(xs, _) => body.extend(xs),
                    Expr::Optional(e, _, _) | Expr::Capture(_, e) | Expr::Tested(_, _, e) => body.push(e),
                    Expr::Repeat(e, s, _) => {
                        body.push(e);
                        body.extend(s.as_deref());
                    }
                    _ => {}
                }
            }
            pending.extend(
                alt.alternative.tags.iter().chain(&alt.clauses.tags).map(|t| (Part::Term(t), alt.document.as_ref())),
            );
            pending.extend(alt.clauses.conditions.iter().map(|c| (Part::Cond(c), alt.document.as_ref())));
            for item in alt.clauses.emit.iter().flatten() {
                let (tags, strings) = match item {
                    EmitItem::Capture(_, tags, a) => (tags, &a.strings),
                    EmitItem::Insert(tags, s) => (tags, s),
                };
                pending.extend(
                    tags.iter()
                        .chain(&strings.value)
                        .chain(&strings.image)
                        .map(|t| (Part::Term(t), alt.document.as_ref())),
                );
            }
        }
    }
    while let Some((part, document)) = pending.pop() {
        let id = match part {
            Part::Term(t) => (0, t as *const Term as usize),
            Part::Cond(c) => (1, c as *const Cond as usize),
        };
        if !parts.insert(id) {
            continue;
        }
        match part {
            Part::Term(Term::Pattern(pattern)) => {
                pattern_names(pattern, &mut prohibited, &erased, source_checks.is_some(), document, &check_names)?
            }
            Part::Cond(Cond::Boundary(_, _, targets, _)) => prohibited.extend(targets.iter().cloned()),
            _ => {}
        }
        pending.extend(part.children().into_iter().map(|p| (p, document)));
    }
    for rule in &grammar.rules {
        for alt in &rule.alternatives {
            for code in &alt.clauses.suppress_warnings {
                if code != "_" && !warnings.contains(code.as_str()) {
                    return Err(Error::grammar(format!(
                        "suppression code {code} is not a warning of stage {}",
                        grammar.name
                    ))
                    .in_document(&alt.document)
                    .at(alt.at.0, alt.at.1));
                }
            }
        }
    }
    for (name, alt) in splices {
        if prohibited.contains(name) {
            return Err(Error::grammar(format!("a splice of {name} conflicts with a pattern or neighbour target"))
                .in_document(&alt.document)
                .at(alt.at.0, alt.at.1));
        }
    }
    Ok(())
}

thread_local! {
    static MESSAGE_WATCH: std::cell::RefCell<Option<MessageWatch>> = const {std::cell::RefCell::new(None)};
}
struct MessageWatch {
    fail: Option<String>,
    calls: Vec<String>,
}
/// Runs a focused message test and records evaluated diagnostic codes.
#[doc(hidden)]
pub fn with_diagnostic_messages<T>(fail: Option<&str>, run: impl FnOnce() -> T) -> (T, Vec<String>) {
    struct Restore(Option<MessageWatch>);
    impl Drop for Restore {
        fn drop(&mut self) {
            MESSAGE_WATCH.with(|watch| watch.replace(self.0.take()));
        }
    }
    let old = MESSAGE_WATCH
        .with(|watch| watch.replace(Some(MessageWatch { fail: fail.map(String::from), calls: Vec::new() })));
    let restore = Restore(old);
    let result = run();
    let calls = MESSAGE_WATCH.with(|watch| watch.borrow_mut().take().unwrap().calls);
    drop(restore);
    (result, calls)
}
pub(crate) fn message(code: &str) -> Result<(), crate::earley::EngineError> {
    MESSAGE_WATCH.with(|watch| {
        if let Some(watch) = watch.borrow_mut().as_mut() {
            watch.calls.push(code.into());
            if watch.fail.as_deref() == Some(code) {
                return Err(crate::earley::EngineError { message: "injected message failure".into(), rule: None });
            }
        }
        Ok(())
    })
}
