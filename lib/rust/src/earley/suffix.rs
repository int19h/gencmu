//! Retained suffix recognition and its window dependencies.
use super::*;

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub(super) struct SuffixKey {
    pub(super) grammar: usize,
    pub(super) rule: u32,
    pub(super) start: usize,
    pub(super) end: Option<usize>,
}

#[derive(Default)]
pub(super) struct SuffixState {
    pub(super) answers: FxMap<usize, (bool, bool)>,
    pub(super) tags: FxMap<usize, SetId>,
    pub(super) clean_tags: FxMap<usize, SetId>,
    pub(super) retained: Option<Retained>,
    pub(super) transient: bool,
}

pub(super) struct Retained {
    pub(super) chart: Chart,
    pub(super) e: usize,
    pub(super) head: usize,
    pub(super) entered: bool,
    pub(super) scans: Vec<(Item, u32)>,
    pub(super) scan_index: usize,
}

/// Ordinary nested targets own their context ends. Restored queries at any
/// depth depend on the outer end, including through ordinary nested targets.
fn reads_end(g: &Lowered, root: u32) -> bool {
    use crate::query_dependencies::Node;
    let plans = crate::restoration::plans_by_production(g);
    let mut pending = vec![(root, false)];
    let mut seen = FxSet::default();
    while let Some((rule, nested)) = pending.pop() {
        if !seen.insert((rule, nested)) {
            continue;
        }
        let mut clauses = FxSet::default();
        let mut dependent = false;
        for &id in &g.rules[rule as usize].prods {
            let production = &g.prods[id as usize];
            for symbol in &production.syms {
                if let Sym::N(rule) = symbol {
                    pending.push((*rule, nested));
                }
            }
            crate::query_dependencies::walk(production, &plans[id as usize], &mut clauses, |node| match node {
                Node::Query(span, rule, _) => {
                    let mut receiver = span;
                    while let Span::From(inner) = receiver {
                        receiver = inner;
                    }
                    dependent |= matches!(receiver, Span::WithoutElision(..));
                    pending.push((rule, true));
                }
                Node::Span(Span::From(_) | Span::After(_)) if !nested => dependent = true,
                Node::Condition(LCond::Final(_) | LCond::Boundary(true, ..)) if !nested => dependent = true,
                _ => {}
            });
            if dependent {
                return true;
            }
        }
    }
    false
}

impl<'g, 's, 'a> Recognizer<'g, 's, 'a> {
    pub(super) fn suffix_state(&mut self, rule: u32, start: usize, end: usize) -> usize {
        let grammar = self.g as *const Lowered as usize;
        let dependent = *self.shared.suffix_deps.entry((grammar, rule)).or_insert_with(|| reads_end(self.g, rule));
        let key = SuffixKey { grammar, rule, start, end: dependent.then_some(end) };
        *self.shared.suffix_keys.entry(key).or_insert_with(|| {
            let id = self.shared.suffixes.len();
            self.shared.suffixes.push(SuffixState::default());
            id
        })
    }

    pub(super) fn answering<'t>(&mut self, request: Request<'t>) -> Run<'t, 'g> {
        let retained = request.suffix.and_then(|id| {
            let state = &mut self.shared.suffixes[id];
            state.retained.take()
        });
        if let Some(Retained { chart, e, head, entered, scans, scan_index }) = retained {
            return Run {
                tokens: &request.tokens[request.start..request.end],
                base: request.base + request.start,
                recon: None,
                chart,
                e,
                head,
                entered,
                step: Step::Next,
                evals: Evals::default(),
                request: Some(request),
                scans,
                scan_index,
            };
        }
        let first = self.shared.fresh_set();
        let mut run = Run::answering(request, first);
        run.chart.machine = self.shared.machine.clone();
        run.chart.boundaries = self.shared.boundaries.clone();
        run
    }

    pub(super) fn retain_suffix(&mut self, run: &Run) {
        let id = run.request.as_ref().unwrap().suffix.unwrap();
        let end = run.base + run.e;
        if self.shared.suffixes[id].answers.contains_key(&end) {
            return;
        }
        let rule = run.request.as_ref().unwrap().rule;
        let set = &run.chart.sets[run.e];
        let witnesses: Vec<_> = set
            .completed
            .iter()
            .filter(|((r, _), _)| *r == rule)
            .flat_map(|(_, items)| items)
            .filter(|&&k| {
                set.items[k as usize].close_requested == 0
                    && run
                        .chart
                        .boundaries
                        .as_ref()
                        .map_or(true, |m| m.borrow().accepts(set.items[k as usize].boundary))
            })
            .map(|&k| (run.e as u32, k))
            .collect();
        let flags = self.proofs(&run.chart).flags(
            &witnesses,
            run.tokens,
            self.shared.carried_errors(run.base, run.tokens.len()),
        );
        let holds = (flags.iter().any(|yes| *yes != 0), flags.iter().any(|yes| yes & 1 != 0));
        let tags = &self.shared.tags;
        let list = union_all(
            witnesses.iter().zip(&flags).filter(|(_, yes)| **yes != 0).map(|((_, k), _)| tags.list(set.tagset[*k as usize])),
        );
        let clean_list = union_all(
            witnesses
                .iter()
                .zip(&flags)
                .filter(|(_, yes)| *yes & 1 != 0)
                .map(|((_, k), _)| tags.list(set.tagset[*k as usize])),
        );
        let (tags, clean_tags) = (self.shared.tags.set(list), self.shared.tags.set(clean_list));
        self.shared.suffixes[id].answers.insert(end, holds);
        self.shared.suffixes[id].tags.insert(end, tags);
        self.shared.suffixes[id].clean_tags.insert(end, clean_tags);
    }
}
