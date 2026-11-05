//! Static notes for report rules and guarded tag terms.
use crate::clauses::Part;
use crate::dom::{Arg, Cond, EmitItem, Expr, RuleDef, Term};
use crate::grammar::StageGrammar;
use std::collections::{BTreeMap, BTreeSet};

/// A static note about a query, suppression list, or tag expansion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiagnosticNote {
    /// The note category.
    pub kind: String,
    /// The owner rule.
    pub rule: String,
    /// The source document.
    pub document: String,
    /// The source line, from one.
    pub line: usize,
    /// The source column, from one.
    pub column: usize,
    /// The reachable error rule, for a query note.
    pub target: Option<String>,
    /// The unused suppression code.
    pub code: Option<String>,
    /// The number of concrete tag variants.
    pub variants: Option<usize>,
    /// The captures of that tag expansion.
    pub captures: Vec<String>,
}
fn references(expr: &Expr) -> BTreeSet<String> {
    let mut refs = BTreeSet::new();
    let mut pending = vec![expr];
    while let Some(expr) = pending.pop() {
        match expr {
            Expr::Ref(name) => {
                refs.insert(name.clone());
            }
            Expr::Splice(e) | Expr::Optional(e, _, _) | Expr::Capture(_, e) | Expr::Tested(_, _, e) => pending.push(e),
            Expr::Seq(xs) | Expr::Choice(xs) | Expr::And(xs) | Expr::Ranked(xs, _) => pending.extend(xs),
            Expr::Repeat(e, s, _) => {
                pending.push(e);
                pending.extend(s.as_deref());
            }
            _ => {}
        }
    }
    refs
}
fn closure(edges: &BTreeMap<String, BTreeSet<String>>, roots: BTreeSet<String>) -> BTreeSet<String> {
    let mut found = BTreeSet::new();
    let mut pending: Vec<_> = roots.into_iter().collect();
    while let Some(name) = pending.pop() {
        if found.insert(name.clone()) {
            pending.extend(edges.get(&name).into_iter().flatten().cloned());
        }
    }
    found
}
pub(crate) fn notes(g: &StageGrammar) -> Vec<DiagnosticNote> {
    let edges = g
        .rules
        .iter()
        .map(|r| (r.name.clone(), r.alternatives.iter().flat_map(|a| references(&a.alternative.expr)).collect()))
        .collect();
    let warnings: BTreeSet<_> = g
        .rules
        .iter()
        .filter(|r| r.alternatives.iter().any(|a| a.clauses.warning.is_some()))
        .map(|r| r.name.clone())
        .collect();
    let errors: BTreeSet<_> = g
        .rules
        .iter()
        .filter(|r| r.alternatives.iter().any(|a| a.clauses.error.is_some()))
        .map(|r| r.name.clone())
        .collect();
    let mut notes = Vec::new();
    for rule in &g.rules {
        for alt in &rule.alternatives {
            let where_ = DiagnosticNote {
                kind: String::new(),
                rule: rule.name.clone(),
                document: alt.document.to_string(),
                line: alt.at.0,
                column: alt.at.1,
                target: None,
                code: None,
                variants: None,
                captures: Vec::new(),
            };
            let mut pending: Vec<_> = alt.clauses.conditions.iter().map(Part::Cond).collect();
            pending.extend(alt.alternative.tags.iter().chain(&alt.clauses.tags).map(Part::Term));
            for item in alt.clauses.emit.iter().flatten() {
                let tags = match item {
                    EmitItem::Capture(_, tags, _) | EmitItem::Insert(tags, _) => tags,
                };
                pending.extend(tags.iter().map(Part::Term));
            }
            let mut roots = BTreeSet::new();
            while let Some(part) = pending.pop() {
                match part {
                    Part::Cond(Cond::Matches(_, names) | Cond::Begins(_, names) | Cond::Ends(_, names)) => {
                        roots.extend(names.iter().cloned())
                    }
                    Part::Term(Term::Call(name, args)) if name == "tags" => roots.extend(args.iter().filter_map(|a| {
                        if let Arg::Rule(name) = a {
                            Some(name.clone())
                        } else {
                            None
                        }
                    })),
                    _ => {}
                }
                pending.extend(part.children());
            }
            let reached = closure(&edges, roots);
            for target in &g.rules {
                if reached.contains(&target.name) && errors.contains(&target.name) {
                    let mut note = where_.clone();
                    note.kind = "query-error".into();
                    note.target = Some(target.name.clone());
                    notes.push(note);
                }
            }
            let mut possible: BTreeSet<_> =
                closure(&edges, references(&alt.alternative.expr)).intersection(&warnings).cloned().collect();
            if alt.clauses.warning.is_some() {
                possible.insert(rule.name.clone());
            }
            for code in &alt.clauses.suppress_warnings {
                if (code == "_" && possible.is_empty()) || code != "_" && !possible.contains(code) {
                    let mut note = where_.clone();
                    note.kind = "unused-suppression".into();
                    note.code = Some(code.clone());
                    notes.push(note);
                }
            }
            let term = Term::Union(alt.alternative.tags.iter().chain(&alt.clauses.tags).cloned().collect());
            if crate::guarded_tags::guards(&term).is_empty() {
                continue;
            }
            let owner = RuleDef {
                source: Default::default(),
                deferred_emission: None,
                name: rule.name.clone(),
                op: crate::dom::Op::Define,
                tags: alt.clauses.tags.clone(),
                strings: alt.clauses.strings.clone(),
                alternatives: vec![alt.alternative.clone()],
                emit: alt.clauses.emit.clone(),
                conditions: alt.clauses.conditions.clone(),
                erased: alt.erased,
                at: alt.at,
                error: alt.clauses.error.clone(),
                warning: alt.clauses.warning.clone(),
                suppress_warnings: alt.clauses.suppress_warnings.clone(),
            };
            for captures in crate::clauses::validation_captures(&owner, 0) {
                let simplified = crate::clauses::simplify_value(&term, &|n| n.is_empty() || captures.contains(&n));
                if let Ok(variants) = crate::guarded_tags::variants(&simplified) {
                    if variants.len() > 8 {
                        let mut note = where_.clone();
                        note.kind = "guarded-tag-variants".into();
                        note.variants = Some(variants.len());
                        note.captures = captures.iter().filter(|n| !n.is_empty()).map(|n| n.to_string()).collect();
                        notes.push(note);
                    }
                }
            }
        }
    }
    let mut unique = Vec::new();
    for note in notes {
        if !unique.contains(&note) {
            unique.push(note);
        }
    }
    unique
}
