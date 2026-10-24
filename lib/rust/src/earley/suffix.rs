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
    pub(super) answers: FxMap<usize, bool>,
    pub(super) retained: Option<Retained>,
    pub(super) active: bool,
    pub(super) error_at: usize,
    pub(super) error: Option<EngineError>,
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
    enum Node<'a> {
        Cond(&'a LCond),
        Term(&'a LTerm),
        Span(&'a Span),
        Query(&'a Span, u32),
    }
    let mut pending = vec![(root, false)];
    let mut seen = FxSet::default();
    while let Some((rule, nested)) = pending.pop() {
        if !seen.insert((rule, nested)) {
            continue;
        }
        for &id in &g.rules[rule as usize].prods {
            let p = &g.prods[id as usize];
            for s in &p.syms {
                if let Sym::N(r) = s {
                    pending.push((*r, nested));
                }
            }
            let mut nodes: Vec<_> = p.conds.iter().map(|(c, _)| Node::Cond(c)).collect();
            nodes.extend(p.tags.iter().map(Node::Term));
            for (key, plan) in &g.ranked.plans {
                if key.0 == id {
                    nodes.extend(plan.conditions.iter().flatten().map(|(c, _)| Node::Cond(c)));
                    nodes.extend(plan.whole_tags.iter().map(Node::Term));
                }
            }
            while let Some(node) = nodes.pop() {
                match node {
                    Node::Query(s, r) => {
                        let mut receiver = s;
                        while let Span::From(inner) = receiver {
                            receiver = inner;
                        }
                        if matches!(receiver, Span::WithoutElision(..)) {
                            return true;
                        }
                        nodes.push(Node::Span(s));
                        pending.push((r, true));
                    }
                    Node::Span(s) => match s {
                        Span::From(_) | Span::After(_) if !nested => return true,
                        Span::WithoutElision(s, _)
                        | Span::Head(s)
                        | Span::Tail(s)
                        | Span::Last(s)
                        | Span::From(s)
                        | Span::After(s)
                        | Span::Before(s) => nodes.push(Node::Span(s)),
                        _ => {}
                    },
                    Node::Cond(c) => match c {
                        LCond::Final(_) | LCond::Boundary(true, ..) if !nested => return true,
                        LCond::Matches(s, r) | LCond::Begins(s, r) | LCond::Ends(s, r) => {
                            nodes.push(Node::Query(s, *r))
                        }
                        LCond::Initial(s) | LCond::Final(s) | LCond::Boundary(_, s, ..) | LCond::Tree(s, ..) => {
                            nodes.push(Node::Span(s))
                        }
                        LCond::Cmp(_, a, b) => nodes.extend([Node::Term(a), Node::Term(b)]),
                        LCond::Not(c) => nodes.push(Node::Cond(c)),
                        LCond::Any(cs) | LCond::All(cs) => nodes.extend(cs.iter().map(Node::Cond)),
                        LCond::If(a, b) => nodes.extend([Node::Cond(a), Node::Cond(b)]),
                    },
                    Node::Term(t) => match t {
                        LTerm::TagsRule(s, r) => nodes.push(Node::Query(s, *r)),
                        LTerm::Value(s)
                        | LTerm::Image(s)
                        | LTerm::Text(s)
                        | LTerm::DecomposedText(s)
                        | LTerm::Tags(s)
                        | LTerm::Classes(s) => nodes.push(Node::Span(s)),
                        LTerm::Union(ts) | LTerm::Inter(ts) | LTerm::Concat(ts) => {
                            nodes.extend(ts.iter().map(Node::Term))
                        }
                        LTerm::Diff(a, b) | LTerm::Split(a, b) => nodes.extend([Node::Term(a), Node::Term(b)]),
                        LTerm::Ngrams(t, _) | LTerm::Classify(t, _) => nodes.push(Node::Term(t)),
                        LTerm::If(c, t) => nodes.extend([Node::Cond(c), Node::Term(t)]),
                        _ => {}
                    },
                }
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
            state.active = true;
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
                !set.items[k as usize].close_requested
                    && run
                        .chart
                        .boundaries
                        .as_ref()
                        .map_or(true, |m| m.borrow().accepts(set.items[k as usize].boundary))
            })
            .map(|&k| (run.e as u32, k))
            .collect();
        let holds = self.proofs(&run.chart, &run.tokens[..run.e]).eligible(&witnesses).into_iter().any(|yes| yes);
        self.shared.suffixes[id].answers.insert(end, holds);
    }
}
