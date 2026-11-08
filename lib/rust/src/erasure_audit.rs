//! Effects of lifting one written erasure (design, Diagnostics and debugging).
use crate::dom::{EmitItem, Expr};
use crate::fxhash::FxMap;
use crate::grammar::StageGrammar;
use crate::work::{self, Work};
use std::collections::BTreeSet;
use std::sync::Arc;

/// The effects of removing one alternative's erasure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ErasureReport {
    /// The owner rule.
    pub rule: String,
    /// The source document.
    pub document: String,
    /// The source line, from one.
    pub line: usize,
    /// The source column, from one.
    pub column: usize,
    /// The zero-based alternative index.
    pub alternative: usize,
    /// The classification, `semantic` or `inert`.
    pub kind: String,
    /// The possible changes when this erasure is absent.
    pub effects: Vec<String>,
}
/// A rule whose written erasures are all inert.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdleErasure {
    /// The owner rule.
    pub rule: String,
    /// The source document.
    pub document: String,
}
const READ: u8 = 1;
const EMIT: u8 = 2;
const DIAGNOSTIC: u8 = 4;
const CHOICE: u8 = 8;
const ALL: u8 = READ | EMIT | DIAGNOSTIC | CHOICE;
struct Observation {
    bits: u8,
    mask: u8,
    references: BTreeSet<String>,
}
#[derive(Default)]
struct Emission {
    fixed: bool,
    captures: BTreeSet<String>,
}
fn add(effects: &mut FxMap<String, u8>, pending: &mut Vec<String>, name: &str, bits: u8) {
    let old = effects.entry(name.into()).or_default();
    if *old | bits != *old {
        *old |= bits;
        pending.push(name.into());
    }
}
pub(crate) fn notes(g: &StageGrammar) -> (Vec<ErasureReport>, Vec<IdleErasure>) {
    let mut alternatives = FxMap::default();
    let mut emissions = FxMap::<usize, Emission>::default();
    let mut effects = FxMap::default();
    let mut dependents = FxMap::<String, Vec<(&str, u8)>>::default();
    let mut pending = Vec::new();
    for rule in &g.rules {
        if rule.alternatives.len() > 1 {
            add(&mut effects, &mut pending, &rule.name, CHOICE);
        }
        for alt in &rule.alternatives {
            work::count(Work::Walked, 1);
            let mut bits = if alt.clauses.error.is_some() || alt.clauses.warning.is_some() { DIAGNOSTIC } else { 0 };
            let mut captures = BTreeSet::new();
            let mut references = BTreeSet::new();
            let mut nodes = vec![&alt.alternative.expr];
            while let Some(node) = nodes.pop() {
                work::count(Work::Walked, 1);
                match node {
                    Expr::Ref(name) if g.index.contains_key(name) => {
                        references.insert(name.clone());
                    }
                    Expr::Ref(_)
                    | Expr::Terminal(_)
                    | Expr::Literal(_)
                    | Expr::Range(..)
                    | Expr::ScalarRange(..)
                    | Expr::Wildcard => bits |= READ | DIAGNOSTIC,
                    Expr::Optional(..) | Expr::Repeat(..) | Expr::Choice(_) | Expr::Ranked(..) | Expr::And(_) => {
                        bits |= CHOICE
                    }
                    Expr::Capture(name, _) => {
                        captures.insert(name.clone());
                    }
                    _ => {}
                }
                match node {
                    Expr::Seq(xs) | Expr::Choice(xs) | Expr::And(xs) | Expr::Ranked(xs, _) => nodes.extend(xs),
                    Expr::Optional(inner, ..)
                    | Expr::Capture(_, inner)
                    | Expr::Splice(inner)
                    | Expr::Tested(_, _, inner) => nodes.push(inner),
                    Expr::Repeat(inner, separator, _) => {
                        nodes.push(inner);
                        nodes.extend(separator.as_deref());
                    }
                    _ => {}
                }
            }
            if let Some(items) = &alt.clauses.emit {
                let emission = emissions.entry(Arc::as_ptr(&alt.clauses) as usize).or_insert_with(|| {
                    let mut emission = Emission::default();
                    for item in items {
                        work::count(Work::Walked, 1);
                        match item {
                            EmitItem::Insert(..) => emission.fixed = true,
                            EmitItem::Capture(name, ..) if name.is_empty() => emission.fixed = true,
                            EmitItem::Capture(name, ..) => {
                                emission.captures.insert(name.clone());
                            }
                        }
                    }
                    emission
                });
                if emission.fixed
                    || captures.iter().any(|name| {
                        work::count(Work::Walked, 1);
                        emission.captures.contains(name)
                    })
                {
                    bits |= EMIT;
                }
            }
            let mask = if alt.clauses.emit.is_some() { ALL & !EMIT } else { ALL };
            if !alt.erased {
                add(&mut effects, &mut pending, &rule.name, bits);
                for name in &references {
                    dependents.entry(name.clone()).or_default().push((&rule.name, mask));
                }
            }
            alternatives.insert(alt as *const _ as usize, Observation { bits, mask, references });
        }
    }
    let mut cursor = 0;
    while cursor < pending.len() {
        let name = &pending[cursor];
        let bits = effects[name];
        for &(user, mask) in dependents.get(name).into_iter().flatten() {
            work::count(Work::Walked, 1);
            add(&mut effects, &mut pending, user, bits & mask);
        }
        cursor += 1;
    }
    let mut result = Vec::new();
    let mut definitions = Vec::<(usize, bool)>::new();
    let mut definition_indexes = FxMap::default();
    for rule in &g.rules {
        for (alternative, alt) in rule.alternatives.iter().enumerate().filter(|(_, alt)| alt.erased) {
            let own = &alternatives[&(alt as *const _ as usize)];
            let mut bits = own.bits | if rule.alternatives.len() > 1 { CHOICE } else { 0 };
            for name in &own.references {
                work::count(Work::Walked, 1);
                bits |= effects.get(name).copied().unwrap_or(0) & own.mask;
            }
            let next = definitions.len();
            let definition = *definition_indexes.entry(Arc::as_ptr(&alt.clauses) as usize).or_insert(next);
            if definition == next {
                definitions.push((result.len(), true));
            }
            definitions[definition].1 &= bits == 0;
            result.push(ErasureReport {
                rule: rule.name.clone(),
                document: alt.document.to_string(),
                line: alt.at.0,
                column: alt.at.1,
                alternative,
                kind: if bits == 0 { "inert" } else { "semantic" }.into(),
                effects: [
                    (READ, "counted-parts"),
                    (EMIT, "emission"),
                    (DIAGNOSTIC, "diagnostics"),
                    (CHOICE, "derivation-choice"),
                ]
                .into_iter()
                .filter(|(bit, _)| bits & bit != 0)
                .map(|(_, name)| name.into())
                .collect(),
            });
        }
    }
    let idle = definitions
        .into_iter()
        .filter(|(_, inert)| *inert)
        .map(|(first, _)| IdleErasure { rule: result[first].rule.clone(), document: result[first].document.clone() })
        .collect();
    (result, idle)
}
