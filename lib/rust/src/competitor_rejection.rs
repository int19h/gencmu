//! Rejection evidence over non-error competitors (engine §12.1).
use crate::diagnostic_flow::DiagnosticFlow;
use crate::earley::{Cap, Chart, EngineError, Item, Recognizer, Tok};
use crate::fxhash::{FxMap, FxSet};
use crate::grammar::StageGrammar;
use crate::lower::{Lowered, Sym};
use crate::result::{Expected, RejectionEvidence};
use crate::tree::{IKind, ITree};
use crate::work::{self, Work};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

type Key = (u32, Item);
type Prediction = (u32, u32);
type Closed = (u32, u32, Cap);
#[derive(Default)]
struct Omissions {
    indexes: FxMap<u32, FxMap<Prediction, Vec<Item>>>,
    allowed: FxMap<Key, bool>,
}
impl Omissions {
    fn candidates(&mut self, chart: &Chart, g: &Lowered, at: u32, name: Prediction) -> Vec<Item> {
        work::count(Work::Walked, 1);
        let index = self.indexes.entry(at).or_insert_with(|| {
            let mut index = FxMap::<_, Vec<_>>::default();
            for &item in chart.sets.get(at as usize).into_iter().flat_map(|set| &set.skipped) {
                work::count(Work::Walked, 1);
                index.entry((g.prods[item.prod as usize].rule, item.lexical)).or_default().push(item);
            }
            index
        });
        index.get(&name).cloned().unwrap_or_default()
    }
    fn select(
        &mut self,
        chart: &Chart,
        rec: &mut Recognizer,
        tokens: &[Tok],
        at: u32,
        candidates: &[Item],
        accept: impl Fn(Item) -> bool,
    ) -> Result<Vec<Item>, EngineError> {
        let mut result = Vec::new();
        for &item in candidates {
            work::count(Work::Walked, 1);
            if !accept(item) {
                continue;
            }
            let allowed = match self.allowed.get(&(at, item)) {
                Some(&allowed) => allowed,
                None => {
                    let allowed = rec.omitted_allowed(chart, tokens, item)?;
                    self.allowed.insert((at, item), allowed);
                    allowed
                }
            };
            if allowed {
                result.push(item);
            }
        }
        Ok(result)
    }
}
fn expected(g: &Lowered, items: &[Item], omitted: &[Item]) -> Vec<Expected> {
    let mut found = BTreeMap::<String, BTreeSet<String>>::new();
    for item in items.iter().chain(omitted) {
        work::count(Work::Walked, 1);
        let p = &g.prods[item.prod as usize];
        if let Some(&Sym::T(terminal)) = p.syms.get(item.dot as usize) {
            let test = p.test(item.dot as usize).map(|id| &g.tests[id as usize]);
            let terminal = crate::pipeline::written_symbol(&g.terminals[terminal as usize], test);
            found.entry(terminal).or_default().insert(g.rules[p.owner as usize].name.clone());
        }
    }
    found.into_iter().map(|(terminal, rules)| Expected { terminal, rules: rules.into_iter().collect() }).collect()
}
pub(crate) fn rejection(
    chart: &Chart,
    rec: &mut Recognizer,
    tokens: &[Tok],
) -> Result<(usize, Vec<Expected>), EngineError> {
    let at = chart.reached;
    let set = &chart.sets[at];
    let omitted = Omissions::default().select(chart, rec, tokens, at as u32, &set.skipped, |_| true)?;
    Ok((at, expected(rec.g, &set.items, &omitted)))
}

#[derive(Default)]
struct Slice {
    queue: Vec<Key>,
    reached: FxSet<Key>,
    sets: FxMap<u32, Vec<Item>>,
    omitted: FxMap<u32, Vec<Item>>,
    omitted_seen: FxSet<Key>,
}
impl Slice {
    fn add(&mut self, g: &Lowered, key: Key) {
        work::count(Work::Walked, 1);
        let (at, item) = key;
        let p = &g.prods[item.prod as usize];
        if p.error.is_some() || !self.reached.insert(key) {
            return;
        }
        self.queue.push(key);
        let transparent = item.dot == 0
            && p.slot.as_ref().is_some_and(|slot| slot.ranked.is_some())
            && matches!(p.syms.as_slice(), [Sym::N(_)]);
        if !transparent {
            self.sets.entry(at).or_default().push(item);
        }
    }
    fn omit(&mut self, at: u32, item: Item) {
        work::count(Work::Walked, 1);
        if self.omitted_seen.insert((at, item)) {
            self.omitted.entry(at).or_default().push(item);
            self.sets.entry(at).or_default();
        }
    }
}
#[derive(Clone, Copy)]
struct Advance {
    next: Key,
    child: Option<Closed>,
}
#[allow(clippy::too_many_arguments)]
fn slice(
    grammar: &StageGrammar,
    rec: &mut Recognizer,
    chart: &Chart,
    tokens: &[Tok],
    start: u32,
    cap: u32,
    option: (u32, u32),
    omissions: &mut Omissions,
) -> Result<Option<RejectionEvidence>, EngineError> {
    let g = rec.g;
    let (production, lexical) = option;
    let slot = g.prods[production as usize].slot.as_ref().expect("a ranked option");
    let (group, chosen) = slot.ranked.unwrap();
    let source = grammar.ranked.groups[group].source;
    let clauses = &grammar.rules[source.0].alternatives[source.1].clauses;
    let competitor = |item: Item| {
        let p = &g.prods[item.prod as usize];
        let Some(slot) = &p.slot else { return false };
        if let Some((other, option)) = slot.ranked {
            if other == group {
                return option != chosen && item.lexical == lexical;
            }
        }
        !g.rules[p.rule as usize].helper
            && slot.source.0 == source.0
            && slot.source != source
            && Arc::ptr_eq(&grammar.rules[slot.source.0].alternatives[slot.source.1].clauses, clauses)
    };
    let mut slice = Slice::default();
    let mut entries = FxMap::<(u32, Prediction), Vec<Key>>::default();
    let mut groups_of = FxMap::<Key, Closed>::default();
    // One index of completed children avoids a scan per incoming advance.
    for (at, set) in chart.sets.iter().enumerate().skip(start as usize).take((cap - start + 1) as usize) {
        for (&(rule, origin), indexes) in &set.completed {
            for &index in indexes {
                work::count(Work::Walked, 1);
                let item = set.items[index as usize];
                let part = Cap {
                    route: g.route(item.prod),
                    proof_structure: None,
                    boundary: item.boundary,
                    close_requested: item.close_requested,
                    start: origin,
                    end: at as u32,
                    tags: set.tagset[index as usize],
                    structure: set.completed_structures[index as usize],
                };
                groups_of.insert((at as u32, item), (rule, item.lexical, part));
            }
        }
    }
    let mut advances = FxMap::<Key, Vec<Advance>>::default();
    let mut completions = FxMap::<Closed, Vec<(Key, Key)>>::default();
    for (at, set) in chart.sets.iter().enumerate().skip(start as usize).take((cap - start + 1) as usize) {
        for &item in &set.items {
            work::count(Work::Walked, 1);
            let p = &g.prods[item.prod as usize];
            if p.error.is_some() {
                continue;
            }
            let key = (at as u32, item);
            if item.dot == 0 {
                entries.entry((at as u32, (p.rule, item.lexical))).or_default().push(key);
                if item.origin == start && at as u32 == start && competitor(item) {
                    slice.add(g, key);
                }
                continue;
            }
            for &(before, part) in chart.links.get(&key).into_iter().flatten() {
                work::count(Work::Walked, 1);
                let previous = (part.start, before);
                match p.syms[item.dot as usize - 1] {
                    Sym::T(_) => advances.entry(previous).or_default().push(Advance { next: key, child: None }),
                    Sym::N(rule) => {
                        let lexical = chart.expected_lexical(before, part.start);
                        let child = (rule, lexical, part);
                        advances.entry(previous).or_default().push(Advance { next: key, child: Some(child) });
                        completions.entry(child).or_default().push((previous, key));
                    }
                }
            }
        }
    }
    let candidates = chart.sets.get(start as usize).map_or(&[][..], |set| set.skipped.as_slice());
    for item in omissions.select(chart, rec, tokens, start, candidates, |item| {
        g.prods[item.prod as usize].error.is_none() && competitor(item)
    })? {
        slice.omit(start, item);
    }
    let mut predictions = FxSet::default();
    let mut reached_groups = FxSet::default();
    let mut cursor = 0;
    while cursor < slice.queue.len() {
        let key @ (at, item) = slice.queue[cursor];
        work::count(Work::Walked, 1);
        if let Some(&Sym::N(rule)) = g.prods[item.prod as usize].syms.get(item.dot as usize) {
            let lexical = chart.expected_lexical(item, at);
            if predictions.insert((at, rule, lexical)) {
                work::count(Work::Walked, 1);
                for &entry in entries.get(&(at, (rule, lexical))).into_iter().flatten() {
                    work::count(Work::Walked, 1);
                    slice.add(g, entry);
                }
                let candidates = omissions.candidates(chart, g, at, (rule, lexical));
                for omitted in omissions.select(chart, rec, tokens, at, &candidates, |item| {
                    g.prods[item.prod as usize].error.is_none() && item.lexical == lexical
                })? {
                    slice.omit(at, omitted);
                }
            }
        }
        for advance in advances.get(&key).into_iter().flatten() {
            work::count(Work::Walked, 1);
            if advance.child.map_or(true, |child| reached_groups.contains(&child)) {
                slice.add(g, advance.next);
            }
        }
        if let Some(&group) = groups_of.get(&key) {
            if reached_groups.insert(group) {
                for &(previous, next) in completions.get(&group).into_iter().flatten() {
                    work::count(Work::Walked, 1);
                    if slice.reached.contains(&previous) {
                        slice.add(g, next);
                    }
                }
            }
        }
        cursor += 1;
    }
    let Some(&at) = slice.sets.keys().max() else { return Ok(None) };
    let source = tokens.get(at as usize).map(|token| token.source).unwrap_or_else(|| {
        let end = tokens.last().map_or(0, |token| token.source.1);
        (end, end)
    });
    let (line, column) = rec.shared.position(source.0);
    Ok(Some(RejectionEvidence {
        token: at as usize,
        source: source.0..source.1,
        line,
        column,
        expected: expected(g, &slice.sets[&at], slice.omitted.get(&at).map_or(&[], Vec::as_slice)),
    }))
}

pub(crate) fn reports(
    grammar: &StageGrammar,
    rec: &mut Recognizer,
    chart: &Chart,
    tokens: &[Tok],
    tree: &ITree,
    flow: &mut DiagnosticFlow,
) -> Result<(), EngineError> {
    let mut omissions = Omissions::default();
    let mut sites = Vec::new();
    for (index, event) in flow.evaluated().iter().enumerate() {
        work::count(Work::Walked, 1);
        if !event.error {
            continue;
        }
        let IKind::Close { prod, start, end, .. } = tree.nodes[event.node as usize].kind else { continue };
        if rec.g.prods[prod as usize].splice {
            continue;
        }
        let Some(parent) = flow.parent(event.node) else { continue };
        let parent = &tree.nodes[parent as usize];
        let IKind::Close { prod, .. } = parent.kind else { continue };
        if parent.children.as_slice() == [event.node]
            && rec.g.prods[prod as usize].slot.as_ref().is_some_and(|slot| slot.ranked.is_some())
        {
            sites.push((index, start, end, prod, parent.lexical));
        }
    }
    for (index, start, end, prod, lexical) in sites {
        if let Some(evidence) = slice(grammar, rec, chart, tokens, start, end, (prod, lexical), &mut omissions)? {
            flow.rejection(index, evidence);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::earley::{matchers, Shared};
    fn context(body: &str, tags: &[&str], run: impl FnOnce(&StageGrammar, &mut Recognizer, &Chart, &[Tok])) {
        let source = format!("```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n{body}\n```\n");
        let pipeline = crate::load_pipeline_sources([("p.md", source)], "p.md").unwrap();
        let g = pipeline.lowered_stage(0);
        let text: Vec<_> = tags.join(" ").to_lowercase().chars().collect();
        let mut shared = Shared::new(&g.unicode, &text);
        let tokens: Vec<_> = tags
            .iter()
            .enumerate()
            .map(|(index, tag)| Tok {
                text: tag.to_lowercase(),
                value: tag.to_lowercase(),
                image: tag.to_lowercase(),
                tags: shared.tags.set_of([*tag]),
                source: (2 * index, 2 * index + 1),
                sound: Default::default(),
                quiet: 0,
                before: Vec::new(),
                after: Vec::new(),
                errors: Vec::new(),
                warnings: Vec::new(),
            })
            .collect();
        let matchers = matchers(&g, &mut shared.tags);
        let mut rec = Recognizer { g: &g, matchers: &matchers, shared: &mut shared, recon: None };
        let chart = rec.recognize(&tokens, 0, g.start).unwrap();
        run(&pipeline.stages[0], &mut rec, &chart, &tokens);
    }
    fn option(g: &Lowered, chart: &Chart, label: usize) -> (u32, u32) {
        chart
            .sets
            .iter()
            .flat_map(|set| &set.items)
            .find_map(|item| {
                let p = &g.prods[item.prod as usize];
                (item.dot == 0
                    && g.rules[p.owner as usize].name == "text"
                    && p.slot.as_ref().is_some_and(|slot| slot.ranked.is_some_and(|(_, option)| option == label)))
                .then_some((item.prod, item.lexical))
            })
            .expect("a ranked text option")
    }
    #[test]
    fn deferred_competitor_keeps_the_recognizers_own_frames() {
        // Engine §12.1: a second recognition cannot replace a chart's frames.
        context(
            "%rule text :: ∅ | bad ≻ good\n%rule bad A\n%error \"bad\"\n%rule good inner B\n%rule inner :: ∅ | A ≻ C",
            &["A"],
            |grammar, rec, chart, tokens| {
                let other = rec.recognize(tokens, 0, rec.g.start).unwrap();
                for chart in [chart, &other] {
                    let evidence =
                        slice(grammar, rec, chart, tokens, 0, 1, option(rec.g, chart, 0), &mut Omissions::default())
                            .unwrap()
                            .unwrap();
                    assert_eq!(evidence.token, 1);
                    assert_eq!(evidence.expected, vec![Expected { terminal: "B".into(), rules: vec!["good".into()] }]);
                }
            },
        );
    }
    #[test]
    fn deferred_competitor_indexes_candidates_and_shared_completions() {
        // Engine §12.1: a packed completion group stays shared during reachability.
        for family in ["names", "skipped group", "entry group", "frames", "completion group"] {
            let mut counts = Vec::new();
            for n in [50, 200] {
                let mut alternatives = Vec::new();
                let mut rules = Vec::new();
                let mut expected = Vec::new();
                for index in 0..n {
                    let name = if family == "names" { format!("r{index}") } else { "r".into() };
                    alternatives.push(format!("A {name}"));
                    let owner =
                        if family == "names" || family == "skipped group" { name.clone() } else { format!("s{index}") };
                    rules.push(match family {
                        "names" => format!("%rule {name} B{index}"),
                        "skipped group" => format!("B{index}"),
                        "completion group" => format!("%rule s{index} ε"),
                        _ => format!("%rule s{index} B{index}"),
                    });
                    expected.push(Expected { terminal: format!("B{index}"), rules: vec![owner] });
                }
                let mut good = format!("%rule good {}", alternatives.join(" | "));
                let mut body = rules.join("\n");
                if family == "skipped group" {
                    body = format!("%rule r {}", rules.join(" | "));
                }
                if family == "entry group" || family == "completion group" {
                    let names = (0..n).map(|index| format!("s{index}")).collect::<Vec<_>>().join(" | ");
                    body = format!("%rule r {names}\n{body}");
                }
                if family == "completion group" {
                    good = format!("%rule good {}", std::iter::repeat("A r B").take(n).collect::<Vec<_>>().join(" | "));
                    expected = vec![Expected { terminal: "B".into(), rules: vec!["good".into()] }];
                }
                if family == "frames" {
                    good = "%rule good $x:choice {$i:inner} B\n%conditions $i.value ≠ \"x\"".into();
                    let choices = (0..n).map(|index| format!("A :: T{index}")).collect::<Vec<_>>().join(" | ");
                    body = format!("%rule choice {choices}\n%rule inner C");
                    expected = vec![Expected { terminal: "C".into(), rules: vec!["inner".into()] }];
                }
                expected.sort_by(|a, b| a.terminal.cmp(&b.terminal));
                let body = format!("%rule text :: ∅ | good ≻ bad\n%rule bad A\n%error \"bad\"\n{good}\n{body}");
                context(&body, &["A"], |grammar, rec, chart, tokens| {
                    let option = option(rec.g, chart, 1);
                    work::reset();
                    work::budget(Work::Walked, 100 * n as u64 + 100);
                    let evidence =
                        slice(grammar, rec, chart, tokens, 0, 1, option, &mut Omissions::default()).unwrap().unwrap();
                    let count = work::counted(Work::Walked);
                    work::reset();
                    assert_eq!(evidence.token, 1, "{family} n={n}");
                    assert_eq!(evidence.expected, expected, "{family} n={n}");
                    eprintln!("{family} n={n}: {count} slice steps");
                    counts.push(count);
                });
            }
            assert!(counts[1] <= 5 * counts[0], "{family}: {counts:?}");
        }
    }
    #[test]
    fn deferred_competitor_conditions_stay_scoped_and_cached() {
        // Engine §12.1: unrelated skipped predictions evaluate no conditions.
        let grammar = "%rule text :: ∅ | (good ≻ bad) C\n%extend-rule text unrelated\n%rule good A wanted\n%rule wanted K\n%conditions \"x\" = \"x\"\n%rule bad A B\n%error \"bad\"\n%rule unrelated A B unwanted\n%rule unwanted Z\n%conditions \"x\" = \"x\"";
        context(grammar, &["A", "B", "C"], |grammar, rec, chart, tokens| {
            assert!(chart.accepts(rec.g.start, 3));
            let option = option(rec.g, chart, 1);
            let mut omissions = Omissions::default();
            work::reset();
            let first = slice(grammar, rec, chart, tokens, 0, 2, option, &mut omissions).unwrap().unwrap();
            assert_eq!(first.expected, vec![Expected { terminal: "K".into(), rules: vec!["wanted".into()] }]);
            let visits = work::counted(Work::Visits);
            assert_eq!(visits, 0, "recognition already tested condition-bearing entries");
            slice(grammar, rec, chart, tokens, 0, 2, option, &mut omissions).unwrap();
            assert_eq!(work::counted(Work::Visits), visits, "a cached condition does not run again");
            work::reset();
        });
    }
    #[test]
    fn deferred_evidence_shares_one_source_line_index() {
        // Output §1: all diagnostic excerpts use original code point positions.
        let unicode = crate::load_pipeline("gencmu/jbogenbau").unwrap().unicode;
        let text: Vec<_> = "a\r\nb\rc\nd".chars().collect();
        let shared = Shared::new(&unicode, &text);
        for (offset, position) in [
            (0, (1, 1)),
            (1, (1, 2)),
            (2, (1, 3)),
            (3, (2, 1)),
            (4, (2, 2)),
            (5, (3, 1)),
            (6, (3, 2)),
            (7, (4, 1)),
            (8, (4, 2)),
            (99, (4, 2)),
        ] {
            assert_eq!(shared.position(offset), position);
        }
    }
}
