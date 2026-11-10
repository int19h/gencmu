//! Static notes for report rules and guarded tag terms.
use crate::clauses::Part;
use crate::dom::{Arg, Cond, EmitItem, Expr, RuleDef, Term};
use crate::fxhash::{FxMap, FxSet};
use crate::grammar::StageGrammar;
use crate::work::{self, Work};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// A static note about a query, suppression list, or tag expansion.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
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
    /// Whether the query filters carried errors.
    pub filtered: bool,
    /// The unused suppression code.
    pub code: Option<String>,
    /// The number of concrete tag variants.
    pub variants: Option<usize>,
    /// The captures of that tag expansion.
    pub captures: Vec<String>,
}
fn references(expr: &Expr, written: bool) -> Vec<String> {
    let mut refs = Vec::new();
    let mut seen = FxSet::default();
    let mut pending = vec![expr];
    while let Some(expr) = pending.pop() {
        work::count(Work::Walked, 1);
        match expr {
            Expr::Ref(name) => {
                if seen.insert(name.clone()) {
                    refs.push(name.clone());
                }
            }
            Expr::Splice(e) | Expr::Optional(e, _, _) | Expr::Capture(_, e) | Expr::Tested(_, _, e) => pending.push(e),
            Expr::Seq(xs) | Expr::Choice(xs) | Expr::And(xs) | Expr::Ranked(xs, _) => {
                if written {
                    pending.extend(xs.iter().rev());
                } else {
                    pending.extend(xs);
                }
            }
            Expr::Repeat(e, s, _) => {
                if written {
                    pending.extend(s.as_deref());
                    pending.push(e);
                } else {
                    pending.push(e);
                    pending.extend(s.as_deref());
                }
            }
            _ => {}
        }
    }
    refs
}
#[derive(Clone, Default)]
struct Targets {
    entries: Vec<(String, u8)>,
    indexes: FxMap<String, usize>,
}
impl Targets {
    fn new() -> Self {
        Self::default()
    }
    fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
    fn add(&mut self, name: String, bits: u8) -> u8 {
        let index = *self.indexes.entry(name.clone()).or_insert_with(|| {
            let index = self.entries.len();
            self.entries.push((name, 0));
            index
        });
        let previous = self.entries[index].1;
        self.entries[index].1 |= bits;
        previous
    }
    fn keys(&self) -> impl Iterator<Item = &String> {
        self.entries.iter().map(|(name, _)| name)
    }
}
impl FromIterator<(String, u8)> for Targets {
    fn from_iter<T: IntoIterator<Item = (String, u8)>>(iter: T) -> Self {
        let mut targets = Self::new();
        for (name, bits) in iter {
            targets.add(name, bits);
        }
        targets
    }
}
impl IntoIterator for Targets {
    type Item = (String, u8);
    type IntoIter = std::vec::IntoIter<Self::Item>;
    fn into_iter(self) -> Self::IntoIter {
        self.entries.into_iter()
    }
}
fn closure(edges: &BTreeMap<String, Vec<String>>, roots: Targets) -> Targets {
    let mut found = Targets::new();
    let mut pending: Vec<_> = roots.into_iter().collect();
    while let Some((name, bits)) = pending.pop() {
        work::count(Work::Walked, 1);
        let previous = found.add(name.clone(), bits);
        let added = bits & !previous;
        if added != 0 {
            for child in edges.get(&name).into_iter().flatten() {
                work::count(Work::Walked, 1);
                pending.push((child.clone(), added));
            }
        }
    }
    found
}
fn key(part: Part<'_>) -> (u8, usize) {
    match part {
        Part::Term(term) => (0, term as *const Term as usize),
        Part::Cond(condition) => (1, condition as *const Cond as usize),
    }
}
fn targets(root: Part<'_>, cache: &mut FxMap<(u8, usize), Arc<Targets>>) -> Arc<Targets> {
    if let Some(found) = cache.get(&key(root)) {
        return found.clone();
    }
    let mut names = Targets::new();
    let mut pending = vec![(root, false)];
    let mut seen = FxSet::default();
    while let Some((part, filtered)) = pending.pop() {
        work::count(Work::Walked, 1);
        if !seen.insert((key(part), filtered)) {
            continue;
        }
        let mut found = Vec::new();
        let mut filter = false;
        match part {
            Part::Term(Term::Call(method, args)) => {
                filter = method == "error-free";
                if method == "tags" {
                    found.extend(args.iter().filter_map(|arg| {
                        if let Arg::Rule(name) = arg {
                            Some(name.clone())
                        } else {
                            None
                        }
                    }));
                } else if method == "parse" {
                    if let Some(Arg::Term(Term::Body(body))) = args.get(1) {
                        found.extend(references(body, true));
                    }
                }
            }
            _ => {}
        }
        for name in found {
            names.add(name, if filtered { 2 } else { 1 });
        }
        pending.extend(part.children().into_iter().map(|child| (child, filtered || filter)));
    }
    let found = if names.is_empty() { cache.entry((2, 0)).or_default().clone() } else { Arc::new(names) };
    cache.insert(key(root), found.clone());
    found
}
fn merge(into: &mut Targets, from: &Targets) {
    for (name, bits) in &from.entries {
        work::count(Work::Walked, 1);
        into.add(name.clone(), *bits);
    }
}
pub(crate) fn notes(g: &StageGrammar) -> Vec<DiagnosticNote> {
    let mut refs = FxMap::<usize, Vec<String>>::default();
    let mut edges = BTreeMap::new();
    let mut warnings = BTreeSet::new();
    let mut errors = BTreeSet::new();
    for rule in &g.rules {
        let mut children = Vec::new();
        let mut seen_children = FxSet::default();
        for alt in &rule.alternatives {
            work::count(Work::Walked, 1);
            children.extend(
                refs.entry(&alt.alternative.expr as *const Expr as usize)
                    .or_insert_with(|| references(&alt.alternative.expr, false))
                    .iter()
                    .filter(|name| seen_children.insert((*name).clone()))
                    .cloned(),
            );
            if alt.clauses.warning.is_some() {
                warnings.insert(rule.name.clone());
            }
            if alt.clauses.error.is_some() {
                errors.insert(rule.name.clone());
            }
        }
        edges.insert(rule.name.clone(), children);
    }
    let mut roots_cache = FxMap::default();
    let mut definition_roots = FxMap::<usize, (Targets, Targets, Targets)>::default();
    let mut queries = FxMap::<(usize, usize), Vec<(String, u8)>>::default();
    let mut guarded = FxMap::<usize, bool>::default();
    let mut notes = Vec::new();
    for rule in g.rules.iter().filter(|rule| !rule.query) {
        for alt in &rule.alternatives {
            let where_ = DiagnosticNote {
                kind: String::new(),
                rule: rule.name.clone(),
                document: alt.document.to_string(),
                line: alt.at.0,
                column: alt.at.1,
                target: None,
                filtered: false,
                code: None,
                variants: None,
                captures: Vec::new(),
            };
            work::count(Work::Walked, 1);
            let definition = Arc::as_ptr(&alt.clauses) as usize;
            let own_roots = alt.alternative.tags.as_ref().map(|term| targets(Part::Term(term), &mut roots_cache));
            let own =
                own_roots.as_ref().filter(|roots| !roots.is_empty()).map_or(0, |roots| Arc::as_ptr(roots) as usize);
            let reached = queries.entry((definition, own)).or_insert_with(|| {
                let parts = definition_roots.entry(definition).or_insert_with(|| {
                    let mut emission = Targets::new();
                    if let Some(items) = &alt.clauses.emit {
                        for item in items.iter().rev() {
                            let (tags, strings) = match item {
                                EmitItem::Capture(_, tags, attachment) => (tags, &attachment.strings),
                                EmitItem::Insert(tags, strings) => (tags, strings),
                            };
                            for term in strings.image.iter().chain(&strings.value).chain(tags) {
                                merge(&mut emission, &targets(Part::Term(term), &mut roots_cache));
                            }
                        }
                    }
                    let mut tags = Targets::new();
                    if let Some(term) = &alt.clauses.tags {
                        merge(&mut tags, &targets(Part::Term(term), &mut roots_cache));
                    }
                    let mut conditions = Targets::new();
                    for condition in alt.clauses.conditions.iter().rev() {
                        merge(&mut conditions, &targets(Part::Cond(condition), &mut roots_cache));
                    }
                    (emission, tags, conditions)
                });
                let mut roots = parts.0.clone();
                if let Some(own) = &own_roots {
                    merge(&mut roots, own);
                }
                merge(&mut roots, &parts.1);
                merge(&mut roots, &parts.2);
                closure(&edges, roots)
                    .into_iter()
                    .filter(|(name, _)| {
                        work::count(Work::Walked, 1);
                        errors.contains(name)
                    })
                    .collect()
            });
            for (target, bits) in reached.iter() {
                for bit in [1, 2] {
                    if bits & bit == 0 {
                        continue;
                    }
                    let mut note = where_.clone();
                    note.kind = "query-error".into();
                    note.target = Some(target.clone());
                    note.filtered = bit == 2;
                    notes.push(note);
                }
            }
            if !alt.clauses.suppress_warnings.is_empty() {
                let roots = refs[&(&alt.alternative.expr as *const Expr as usize)]
                    .iter()
                    .map(|name| (name.clone(), 1))
                    .collect();
                let mut possible: BTreeSet<_> =
                    closure(&edges, roots).keys().filter(|name| warnings.contains(*name)).cloned().collect();
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
            }
            let has_guards = alt.alternative.tags.iter().chain(&alt.clauses.tags).any(|term| {
                *guarded.entry(term as *const Term as usize).or_insert_with(|| {
                    let mut pending = vec![Part::Term(term)];
                    while let Some(part) = pending.pop() {
                        work::count(Work::Walked, 1);
                        pending.extend(part.children());
                    }
                    !crate::guarded_tags::guards(term).is_empty()
                })
            });
            if !has_guards {
                continue;
            }
            let term = Term::Union(alt.alternative.tags.iter().chain(&alt.clauses.tags).cloned().collect());
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
                template_conditions: Vec::new(),
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
    let mut seen = FxSet::default();
    notes.into_iter().filter(|note| seen.insert(note.clone())).collect()
}

#[cfg(test)]
mod tests {
    use crate::work::{self, Work};
    #[test]
    fn deferred_audit_walks_shared_clauses_and_effects_once() {
        // Design, Diagnostics and debugging: audit work grows with input and output.
        for family in ["chain", "conditions", "emission", "query annotations"] {
            let mut counts = Vec::new();
            for n in [50, 200] {
                let grammar = if family == "query annotations" {
                    let alternatives = (0..n).map(|i| format!("$c{i}:A :: T{i}")).collect::<Vec<_>>().join(" | ");
                    let conditions = (0..n).map(|i| format!("$c{i}.parse(r0)")).collect::<Vec<_>>().join(", ");
                    let mut grammar =
                        format!("%rule text :: $.parse(r0).tags | {alternatives}\n%conditions {conditions}");
                    for i in 0..n {
                        grammar.push_str(&format!(
                            "\n%rule r{i} {}",
                            if i + 1 == n { "A".into() } else { format!("r{}", i + 1) }
                        ));
                    }
                    grammar.push_str("\n%error \"fault\"\n%erased");
                    grammar
                } else if family == "chain" {
                    let mut grammar = "%rule text gone\n%rule gone r0\n%erased".to_string();
                    for index in 0..n {
                        let target = if index + 1 == n { "A".into() } else { format!("r{}", index + 1) };
                        grammar.push_str(&format!("\n%rule r{index} {target}"));
                    }
                    grammar
                } else {
                    let alternatives = (0..n).map(|i| format!("$c{i}:A")).collect::<Vec<_>>().join(" | ");
                    let clauses = (0..n)
                        .map(|i| if family == "conditions" { format!("$c{i}.value=\"a\"") } else { format!("$c{i}") })
                        .collect::<Vec<_>>()
                        .join(", ");
                    format!(
                        "%rule text {alternatives}\n%{} {clauses}",
                        if family == "conditions" { "conditions" } else { "emits" }
                    )
                };
                let pipeline = crate::load_pipeline_sources(
                    [("p.md", format!("```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n{grammar}\n```\n"))],
                    "p.md",
                )
                .unwrap();
                work::reset();
                work::budget(Work::Walked, 80 * n + 100);
                let reports = pipeline.ranking_reports();
                let count = work::counted(Work::Walked);
                work::reset();
                if family == "chain" {
                    assert!(reports[0].erasures[0].effects.iter().any(|effect| effect == "counted-parts"));
                }
                if family == "query annotations" {
                    assert_eq!(reports[0].diagnostic_notes.len(), 1);
                    assert_eq!(reports[0].diagnostic_notes[0].target, Some(format!("r{}", n - 1)));
                }
                eprintln!("{family} n={n}: {count} audit steps");
                counts.push(count);
            }
            assert!(counts[1] <= 5 * counts[0], "{family}: {counts:?}");
        }
    }
}
