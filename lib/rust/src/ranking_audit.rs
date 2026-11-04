//! Static reports for node-pattern ranking steps (docs/design.md).
use crate::dom::{Expr, Mark, Term};
use crate::grammar::StageGrammar;
use crate::patterns::Pattern;
use std::collections::BTreeSet;

/// One key step and its static label.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RankingStepReport {
    /// The zero-based key step index.
    pub step: usize,
    /// The canonical pattern spelling.
    pub pattern: String,
    /// The label is impossible, or empty when the step has no label.
    pub status: String,
}
/// A counted rule that a later definition changes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CountedRuleChange {
    /// The zero-based key step index.
    pub step: usize,
    /// The definition change.
    pub change: crate::grammar::Change,
}
/// Static reports for the key steps of one stage.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RankingReport {
    /// The stage name.
    pub name: String,
    /// The static label of each key step.
    pub key_steps: Vec<RankingStepReport>,
    /// Redefinitions and extensions of counted rules.
    pub counted_changes: Vec<CountedRuleChange>,
}

fn walk_body(
    expr: &Expr,
    refs: &mut BTreeSet<String>,
    terms: &mut BTreeSet<String>,
    omitted: &mut BTreeSet<String>,
    g: &StageGrammar,
) {
    let mut pending = vec![expr];
    while let Some(e) = pending.pop() {
        match e {
            Expr::Ref(n) => {
                if g.index.contains_key(n) {
                    refs.insert(n.clone());
                } else {
                    terms.insert(n.clone());
                }
            }
            Expr::Terminal(t) => {
                terms.insert(t.clone());
            }
            Expr::Literal(Term::Str(s)) => {
                terms.insert(crate::tags::string_name(s, &g.unicode));
            }
            Expr::ScalarRange(Term::Str(a), Term::Str(b)) => {
                terms.insert(format!(
                    "{}..{}",
                    crate::tags::string_name(a, &g.unicode),
                    crate::tags::string_name(b, &g.unicode)
                ));
            }
            Expr::Range(a, b) => {
                terms.insert(format!(
                    "{}..{}",
                    crate::tags::string_name(&a.to_string(), &g.unicode),
                    crate::tags::string_name(&b.to_string(), &g.unicode)
                ));
            }
            Expr::Wildcard => {
                terms.insert("_".into());
            }
            Expr::Optional(e, mark, _) => {
                if *mark == Mark::Elidable {
                    let mut head = e.as_ref();
                    loop {
                        match head {
                            Expr::Capture(_, e) | Expr::Tested(_, _, e) => head = e,
                            Expr::Seq(es) => head = &es[0],
                            Expr::Ref(t) | Expr::Terminal(t) => {
                                omitted.insert(t.clone());
                                break;
                            }
                            _ => break,
                        }
                    }
                }
                pending.push(e);
            }
            Expr::Capture(_, e) | Expr::Tested(_, _, e) => pending.push(e),
            Expr::Seq(es) | Expr::Choice(es) | Expr::Ranked(es, _) | Expr::And(es) => pending.extend(es),
            Expr::Repeat(e, s, _) => {
                pending.push(e);
                pending.extend(s.as_deref());
            }
            _ => (),
        }
    }
}
fn dead(p: &Pattern, reachable: &BTreeSet<String>, terms: &BTreeSet<String>) -> bool {
    match p {
        Pattern::Name(n, _) => !reachable.contains(n),
        Pattern::Terminal(t, _) => {
            if t == "_" {
                terms.is_empty()
            } else {
                !terms.contains(t)
            }
        }
        Pattern::Node(p, _, _) | Pattern::Test(_, _, p, _) if !matches!(p.as_ref(), Pattern::Any) => {
            dead(p, reachable, terms)
        }
        Pattern::Union(ps) => ps.iter().all(|p| dead(p, reachable, terms)),
        Pattern::Intersection(ps) => ps.iter().any(|p| dead(p, reachable, terms)),
        Pattern::Difference(a, _) => dead(a, reachable, terms),
        _ => false,
    }
}

pub(crate) fn report(g: &StageGrammar) -> RankingReport {
    if g.steps.is_empty() {
        return RankingReport { name: g.name.clone(), key_steps: Vec::new(), counted_changes: Vec::new() };
    }
    let bodies: Vec<_> = g
        .rules
        .iter()
        .map(|rule| {
            let (mut refs, mut terms, mut omitted) = (BTreeSet::new(), BTreeSet::new(), BTreeSet::new());
            for alternative in &rule.alternatives {
                walk_body(&alternative.alternative.expr, &mut refs, &mut terms, &mut omitted, g);
            }
            (refs, terms, omitted)
        })
        .collect();
    let mut reachable = BTreeSet::new();
    let mut pending = vec!["text".to_owned()];
    while let Some(name) = pending.pop() {
        if reachable.insert(name.clone()) {
            if let Some(&i) = g.index.get(&name) {
                pending.extend(bodies[i].0.iter().cloned());
            }
        }
    }
    let mut terminals = BTreeSet::new();
    for name in &reachable {
        if let Some(&i) = g.index.get(name) {
            terminals.extend(bodies[i].1.iter().cloned());
            terminals.extend(bodies[i].2.iter().cloned());
        }
    }
    let mut out = RankingReport { name: g.name.clone(), key_steps: Vec::new(), counted_changes: Vec::new() };
    for (step, key) in g.steps.iter().enumerate() {
        let names: BTreeSet<_> = key
            .pattern
            .walk()
            .filter_map(|part| match part {
                crate::patterns::Part::Pattern(Pattern::Name(name, _)) => Some(name),
                _ => None,
            })
            .collect();
        for change in &g.changes {
            if names.contains(&change.rule) {
                out.counted_changes.push(CountedRuleChange { step, change: change.clone() });
            }
        }
        let mut text = String::new();
        key.pattern.write_layered(&mut text);
        let pattern = crate::parameters::print::canonical(
            &crate::parameters::obj([("pattern", crate::json::parse(&text).expect("a pattern DOM"))]),
            &g.unicode,
        );
        out.key_steps.push(RankingStepReport {
            step,
            pattern,
            status: if dead(&key.pattern, &reachable, &terminals) { "impossible" } else { "" }.into(),
        });
    }
    out
}

/// Format the static reports of a pipeline as text.
pub fn format_ranking_reports(reports: &[RankingReport]) -> String {
    let mut lines = Vec::new();
    for report in reports {
        lines.push(format!("{}:", report.name));
        for step in &report.key_steps {
            if !step.status.is_empty() {
                lines.push(format!("  ranking step {}: {}", step.step + 1, step.status));
            }
        }
        for change in &report.counted_changes {
            lines.push(format!(
                "  counted rule {}: {}, step {}",
                change.change.rule,
                if change.change.extension { "extended" } else { "replaced" },
                change.step + 1
            ));
        }
    }
    lines.join("\n")
}
