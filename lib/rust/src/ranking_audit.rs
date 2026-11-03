//! Static reports for node-pattern ranking steps (docs/design.md).
use crate::dom::{Arg, Cond, Expr, Mark, Term};
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
    /// The label: impossible, possible or unknown.
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
/// Tested tags that a rule carries without a literal, or drops through its tag clause.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RankingTagReport {
    /// The affected rule.
    pub rule: String,
    /// The zero-based key step index.
    pub step: usize,
    /// The known tags.
    pub tags: Vec<String>,
    /// Whether the inherited set is unknown.
    pub unknown: bool,
    /// The source document, when a tag clause drops tags.
    pub document: String,
    /// Its line, or zero when no clause applies.
    pub line: usize,
    /// Its column, or zero when no clause applies.
    pub column: usize,
}
/// A positive tag test outside the sources of its stage.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RankingVocabularyWarning {
    /// The stage name.
    pub stage: String,
    /// The zero-based key step index.
    pub step: usize,
    /// The tested tag.
    pub tag: String,
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
    /// Rules that can carry tested tags without their own literal.
    pub inherited_ranking_tags: Vec<RankingTagReport>,
    /// Inherited tags that a constituent tag clause drops.
    pub dropped_ranking_tags: Vec<RankingTagReport>,
    /// Tested tags outside the stage vocabulary.
    pub vocabulary_warnings: Vec<RankingVocabularyWarning>,
}

fn literals(term: &Term, out: &mut BTreeSet<String>) {
    match term {
        Term::Tag(tag) => {
            out.insert(tag.clone());
        }
        Term::Union(parts) | Term::Intersection(parts) => {
            for part in parts {
                literals(part, out)
            }
        }
        Term::Difference(a, b) => {
            literals(a, out);
            literals(b, out);
        }
        Term::If(condition, term) => {
            condition_literals(condition, out);
            literals(term, out);
        }
        Term::Pattern(pattern) => {
            for part in pattern.walk() {
                if let crate::patterns::Part::Term(term, _) = part {
                    literals(term, out)
                }
            }
        }
        Term::Call(_, args) => {
            for arg in args {
                if let Arg::Term(t) = arg {
                    literals(t, out)
                }
            }
        }
        _ => (),
    }
}
fn condition_literals(condition: &Cond, out: &mut BTreeSet<String>) {
    match condition {
        Cond::SourceQuery(_, args, _) => {
            for arg in args {
                if let Arg::Term(term) = arg {
                    literals(term, out)
                }
            }
        }
        Cond::Compare(_, a, b) => {
            literals(a, out);
            literals(b, out)
        }
        Cond::Matches(t, _)
        | Cond::Begins(t, _)
        | Cond::Ends(t, _)
        | Cond::Initial(t)
        | Cond::Final(t)
        | Cond::Boundary(_, t, _, _) => literals(t, out),
        Cond::Not(c) => condition_literals(c, out),
        Cond::Any(cs) | Cond::All(cs) => {
            for c in cs {
                condition_literals(c, out)
            }
        }
        Cond::If(a, b) => {
            condition_literals(a, out);
            condition_literals(b, out)
        }
        Cond::Captured(_) => (),
    }
}
fn known(term: &Term) -> Option<BTreeSet<String>> {
    match term {
        Term::Tag(tag) => Some(BTreeSet::from([tag.clone()])),
        Term::EmptySet => Some(BTreeSet::new()),
        Term::Union(parts) => {
            let mut out = BTreeSet::new();
            for part in parts {
                out.extend(known(part)?)
            }
            Some(out)
        }
        Term::Intersection(parts) => {
            let mut parts = parts.iter();
            let mut out = known(parts.next()?)?;
            for p in parts {
                let set = known(p)?;
                out.retain(|t| set.contains(t));
            }
            Some(out)
        }
        Term::Difference(a, b) => {
            let mut out = known(a)?;
            let b = known(b)?;
            out.retain(|t| !b.contains(t));
            Some(out)
        }
        _ => None,
    }
}
fn widths_together(a: u8, b: u8) -> u8 {
    let mut out = 0;
    for i in 0..3 {
        for j in 0..3 {
            if a & (1 << i) != 0 && b & (1 << j) != 0 {
                out |= 1 << 2.min(i + j);
            }
        }
    }
    out
}
fn widths(expr: &Expr) -> u8 {
    match expr {
        Expr::Empty => 1,
        Expr::Capture(_, e) | Expr::Tested(_, _, e) => widths(e),
        Expr::Seq(es) => es.iter().fold(1, |mask, e| widths_together(mask, widths(e))),
        Expr::Choice(es) | Expr::Ranked(es, _) => es.iter().fold(0, |mask, e| mask | widths(e)),
        Expr::And(_) => 7,
        _ => 2,
    }
}
fn sole(expr: &Expr) -> Option<&Expr> {
    if widths(expr) & 2 == 0 {
        return None;
    }
    match expr {
        Expr::Capture(_, e) | Expr::Tested(_, _, e) => sole(e),
        Expr::Seq(es) => {
            let parts: Vec<_> = es.iter().filter(|e| widths(e) != 1).collect();
            if parts.len() == 1 {
                sole(parts[0])
            } else {
                Some(expr)
            }
        }
        _ => Some(expr),
    }
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
fn tested(p: &Pattern, names: &mut BTreeSet<String>, tags: &mut BTreeSet<String>, positive: &mut BTreeSet<String>) {
    match p {
        Pattern::Name(n, _) => {
            names.insert(n.clone());
        }
        Pattern::Test(op, Term::Call(_, reqs), inner, _) if op == "tags" => {
            for req in reqs {
                if let Arg::Term(t) = req {
                    let mut set = BTreeSet::new();
                    literals(t, &mut set);
                    tags.extend(set.clone());
                    if !matches!(t,Term::Call(n,_) if n=="forbid") {
                        positive.extend(set)
                    }
                }
            }
            tested(inner, names, tags, positive)
        }
        Pattern::Node(inner, _, _) | Pattern::Test(_, _, inner, _) => tested(inner, names, tags, positive),
        Pattern::Union(ps) | Pattern::Intersection(ps) => {
            for p in ps {
                tested(p, names, tags, positive)
            }
        }
        Pattern::Difference(a, b) => {
            tested(a, names, tags, positive);
            tested(b, names, tags, positive)
        }
        _ => (),
    }
}
fn dead(p: &Pattern, reachable: &BTreeSet<String>, terms: &BTreeSet<String>) -> bool {
    match p {
        Pattern::Name(n, _) => !reachable.contains(n),
        Pattern::Terminal(t, _) => !terms.contains(t),
        Pattern::Node(p, _, _) | Pattern::Test(_, _, p, _) if !matches!(p.as_ref(), Pattern::Any) => {
            dead(p, reachable, terms)
        }
        Pattern::Union(ps) => ps.iter().all(|p| dead(p, reachable, terms)),
        Pattern::Intersection(ps) => ps.iter().any(|p| dead(p, reachable, terms)),
        Pattern::Difference(a, _) => dead(a, reachable, terms),
        _ => false,
    }
}

pub(crate) fn report(g: &StageGrammar, previous: &BTreeSet<String>) -> (RankingReport, BTreeSet<String>) {
    let mut vocabulary = previous.clone();
    vocabulary.insert("_Elided".into());
    let mut bodies = Vec::new();
    let mut own = Vec::new();
    let mut sets = Vec::new();
    for rule in &g.rules {
        let mut refs = BTreeSet::new();
        let mut terms = BTreeSet::new();
        let mut omitted = BTreeSet::new();
        let mut literal = BTreeSet::new();
        let mut tagsets = Vec::new();
        for alt in &rule.alternatives {
            walk_body(&alt.alternative.expr, &mut refs, &mut terms, &mut omitted, g);
            let ts: Vec<_> = alt.alternative.tags.iter().chain(alt.clauses.tags.iter()).collect();
            for t in &ts {
                literals(t, &mut literal)
            }
            let mut tags = Some(BTreeSet::new());
            for t in &ts {
                tags = tags.and_then(|mut out| {
                    out.extend(known(t)?);
                    Some(out)
                })
            }
            if ts.is_empty() && sole(&alt.alternative.expr).is_some() {
                tags = None;
            }
            tagsets.push(tags);
            for item in alt.clauses.emit.iter().flatten() {
                let t = match item {
                    crate::dom::EmitItem::Capture(_, t, _) | crate::dom::EmitItem::Insert(t, _) => t,
                };
                if let Some(t) = t {
                    literals(t, &mut vocabulary)
                }
            }
        }
        vocabulary.extend(literal.clone());
        vocabulary.extend(omitted.clone());
        bodies.push((refs, terms, omitted));
        own.push(literal);
        sets.push(tagsets);
    }
    for implication in g.implications.iter() {
        vocabulary.extend(implication.consequent.iter().cloned());
    }
    for (_, classifier) in &g.classifiers {
        for entry in &classifier.entries {
            vocabulary.insert(entry.class.clone());
        }
    }
    let mut reachable = BTreeSet::new();
    let mut pending = vec!["text".to_owned()];
    while let Some(n) = pending.pop() {
        if reachable.insert(n.clone()) {
            if let Some(&i) = g.index.get(&n) {
                pending.extend(bodies[i].0.iter().cloned())
            }
        }
    }
    let mut terminals = BTreeSet::new();
    let mut omitted = BTreeSet::new();
    for n in &reachable {
        if let Some(&i) = g.index.get(n) {
            terminals.extend(bodies[i].1.iter().cloned());
            omitted.extend(bodies[i].2.iter().cloned());
        }
    }
    let mut allterms = terminals.clone();
    allterms.extend(omitted.clone());
    let mut out = RankingReport {
        name: g.name.clone(),
        key_steps: Vec::new(),
        counted_changes: Vec::new(),
        inherited_ranking_tags: Vec::new(),
        dropped_ranking_tags: Vec::new(),
        vocabulary_warnings: Vec::new(),
    };
    for (step, key) in g.steps.iter().enumerate() {
        let mut names = BTreeSet::new();
        let mut tags = BTreeSet::new();
        let mut positive = BTreeSet::new();
        tested(&key.pattern, &mut names, &mut tags, &mut positive);
        let mut answers = Vec::new();
        let mut counted = BTreeSet::new();
        for (i, rule) in g.rules.iter().enumerate() {
            let unknown = sets[i].iter().any(Option::is_none);
            let carried: Vec<_> = tags
                .difference(&own[i])
                .filter(|tag| tag.as_str() != "_Elided")
                .filter(|tag| unknown || sets[i].iter().flatten().any(|s| s.contains(*tag)))
                .cloned()
                .collect();
            if !carried.is_empty() {
                out.inherited_ranking_tags.push(RankingTagReport {
                    rule: rule.name.clone(),
                    step,
                    tags: carried,
                    unknown,
                    document: String::new(),
                    line: 0,
                    column: 0,
                });
            }
            for alt in &rule.alternatives {
                let terms: Vec<_> = alt.alternative.tags.iter().chain(alt.clauses.tags.iter()).collect();
                let mut literals_here = BTreeSet::new();
                for t in &terms {
                    literals(t, &mut literals_here)
                }
                if literals_here.is_disjoint(&tags) {
                    continue;
                }
                if let Some(child) = sole(&alt.alternative.expr) {
                    let source = match child {
                        Expr::Ref(n) => g.index.get(n).copied(),
                        _ => None,
                    };
                    let explicit = terms.iter().try_fold(BTreeSet::new(), |mut set, t| {
                        set.extend(known(t)?);
                        Some(set)
                    });
                    let mut lost = BTreeSet::new();
                    if let (Some(j), Some(explicit)) = (source, explicit.as_ref()) {
                        for set in sets[j].iter().flatten() {
                            lost.extend(set.difference(explicit).cloned())
                        }
                    }
                    out.dropped_ranking_tags.push(RankingTagReport {
                        rule: rule.name.clone(),
                        step,
                        tags: lost.into_iter().collect(),
                        unknown: explicit.is_none() || source.map_or(true, |j| sets[j].iter().any(Option::is_none)),
                        document: alt.document.to_string(),
                        line: alt.at.0,
                        column: alt.at.1,
                    });
                }
            }
            if names.contains(&rule.name) || !own[i].is_disjoint(&tags) {
                counted.insert(rule.name.clone());
            }
            if reachable.contains(&rule.name) {
                for set in &sets[i] {
                    let values = set.as_ref().map(|s| s.iter().cloned().collect::<Vec<_>>());
                    answers.push(crate::ranking_patterns::possible(
                        &key.pattern,
                        Some(&rule.name),
                        None,
                        false,
                        values.as_deref(),
                    ));
                }
            }
        }
        out.counted_changes.extend(
            g.changes
                .iter()
                .filter(|c| counted.contains(&c.rule))
                .cloned()
                .map(|change| CountedRuleChange { step, change }),
        );
        for t in &terminals {
            answers.push(crate::ranking_patterns::possible(&key.pattern, None, Some(t), false, None));
        }
        for t in &omitted {
            answers.push(crate::ranking_patterns::possible(&key.pattern, None, Some(t), true, None));
        }
        let status = if dead(&key.pattern, &reachable, &allterms) {
            "impossible"
        } else if answers.contains(&None) {
            "unknown"
        } else if answers.contains(&Some(true)) {
            "possible"
        } else {
            "impossible"
        };
        out.key_steps.push(RankingStepReport {
            step,
            pattern: {
                let mut text = String::new();
                key.pattern.write_layered(&mut text);
                crate::parameters::print::canonical(
                    &crate::parameters::obj([("pattern", crate::json::parse(&text).expect("a pattern DOM"))]),
                    &g.unicode,
                )
            },
            status: status.into(),
        });
        out.vocabulary_warnings.extend(
            positive
                .difference(&vocabulary)
                .filter(|t| !t.starts_with('_') || g.unicode.canonical_tag(t) != Some(t.as_str()))
                .cloned()
                .map(|tag| RankingVocabularyWarning { stage: g.name.clone(), step, tag }),
        );
    }
    (out, vocabulary)
}

/// Format the static reports of a pipeline as text.
pub fn format_ranking_reports(reports: &[RankingReport]) -> String {
    let mut lines = Vec::new();
    for r in reports {
        lines.push(format!("{}:", r.name));
        for s in &r.key_steps {
            lines.push(format!("  ranking step {}: {}", s.step + 1, s.status))
        }
        for c in &r.counted_changes {
            lines.push(format!(
                "  counted rule {}: {}, step {}",
                c.change.rule,
                if c.change.extension { "extended" } else { "replaced" },
                c.step + 1
            ))
        }
        for (notes, label) in [
            (&r.inherited_ranking_tags, "ranking tags without a literal"),
            (&r.dropped_ranking_tags, "dropped inherited tags"),
        ] {
            for n in notes {
                lines.push(format!(
                    "  {label}: {}, step {}, {}{}",
                    n.rule,
                    n.step + 1,
                    n.tags.join(", "),
                    if n.unknown { " (unknown)" } else { "" }
                ))
            }
        }
        for w in &r.vocabulary_warnings {
            lines.push(format!("  warning: ranking step {} tests {}, outside the stage vocabulary", w.step + 1, w.tag))
        }
    }
    lines.join("\n")
}

pub(crate) fn custom_tag(pattern: &Pattern, unicode: &crate::unicode::Unicode) -> bool {
    let (mut names, mut tags, mut positive) = (BTreeSet::new(), BTreeSet::new(), BTreeSet::new());
    tested(pattern, &mut names, &mut tags, &mut positive);
    positive.iter().any(|t| t != "_Elided" && (!t.starts_with('_') || unicode.canonical_tag(t) != Some(t.as_str())))
}
