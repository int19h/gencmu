use super::*;
use crate::result::{PreferenceConflict, PreferenceContest};
use std::collections::{BTreeMap, BTreeSet};
type Occurrences = BTreeMap<(String, u32, u32), Nat>;
type ElisionCounts = BTreeMap<u32, Nat>;
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct SignatureKey {
    profile: Profile,
    occurrences: Occurrences,
    elisions: ElisionCounts,
    actions: Vec<Act>,
}
#[derive(Clone)]
struct Signature {
    key: SignatureKey,
    entries: Vec<Entry>,
    count: u8,
    w: bool,
}
type SignatureSet = FxMap<SignatureKey, Signature>;
#[derive(Clone, Default)]
struct SignatureResult {
    all: SignatureSet,
    allowed: Option<SignatureSet>,
}
impl SignatureResult {
    fn allowed(&self) -> &SignatureSet {
        self.allowed.as_ref().unwrap_or(&self.all)
    }
}
#[derive(Clone)]
pub(crate) enum RankReason {
    Prefer(Vec<PreferenceContest>),
    Stage {
        directive: &'static str,
        boundary: Option<u32>,
        counts: Option<[String; 2]>,
        witness: Option<[Option<Act>; 2]>,
    },
}
#[derive(Clone)]
pub(crate) struct RankEdge {
    pub from: usize,
    pub to: usize,
    pub reason: RankReason,
}
fn sum_counts<K: Ord + Clone>(a: &BTreeMap<K, Nat>, b: &BTreeMap<K, Nat>) -> BTreeMap<K, Nat> {
    let mut result = a.clone();
    for (k, n) in b {
        let count = result.entry(k.clone()).or_insert(Nat::ZERO);
        *count = count.add(n);
    }
    result
}
fn compare_elision_counts(a: &ElisionCounts, b: &ElisionCounts) -> (Ordering, Option<u32>, Option<[String; 2]>) {
    for p in a.keys().chain(b.keys()).copied().collect::<BTreeSet<_>>() {
        let x = a.get(&p).unwrap_or(&Nat::ZERO);
        let y = b.get(&p).unwrap_or(&Nat::ZERO);
        if x != y {
            return (x.cmp(y), Some(p), Some([x.decimal(), y.decimal()]));
        }
    }
    (Ordering::Equal, None, None)
}
fn contests(prefs: &crate::preferences::Preferences, a: &Occurrences, b: &Occurrences) -> PreferenceConflict {
    let mut left = Vec::new();
    let mut right = Vec::new();
    for key in a.keys().chain(b.keys()).collect::<BTreeSet<_>>() {
        let x = a.get(key).unwrap_or(&Nat::ZERO);
        let y = b.get(key).unwrap_or(&Nat::ZERO);
        match x.cmp(y) {
            Ordering::Greater => left.push((key, x.sub(y))),
            Ordering::Less => right.push((key, y.sub(x))),
            Ordering::Equal => {}
        }
    }
    let mut forward = Vec::new();
    let mut reverse = Vec::new();
    let contest =
        |x: &(String, u32, u32), y: &(String, u32, u32), xn: &Nat, yn: &Nat, path: &Vec<String>| PreferenceContest {
            span: x.1 as usize..x.2 as usize,
            higher: x.0.clone(),
            lower: y.0.clone(),
            path: path.clone(),
            residual_counts: [xn.decimal(), yn.decimal()],
        };
    for (x, xn) in &left {
        for (y, yn) in &right {
            if x.1 != y.1 || x.2 != y.2 {
                continue;
            }
            if let Some(path) = prefs.paths.get(&x.0).and_then(|ps| ps.get(&y.0)) {
                forward.push(contest(x, y, xn, yn, path));
            }
            if let Some(path) = prefs.paths.get(&y.0).and_then(|ps| ps.get(&x.0)) {
                reverse.push(contest(y, x, yn, xn, path));
            }
        }
    }
    let order = |a: &PreferenceContest, b: &PreferenceContest| {
        (&a.span.start, &a.span.end, &a.higher, &a.lower).cmp(&(&b.span.start, &b.span.end, &b.higher, &b.lower))
    };
    forward.sort_by(order);
    reverse.sort_by(order);
    PreferenceConflict { forward, reverse }
}

impl Ranker<'_> {
    /// Describe the finalized reconstruction pair over original spans.
    pub(crate) fn reconstruction_conflict(&self, first: u32, second: u32) -> Option<PreferenceConflict> {
        let prefs = &self.dag.g.preferences;
        if prefs.paths.is_empty() {
            return None;
        }
        let occurrences = |root| {
            let mut out = Occurrences::new();
            let mut stack = vec![root];
            while let Some(id) = stack.pop() {
                match self.dag.arena[id as usize] {
                    DNode::Empty | DNode::Read { .. } => {}
                    DNode::Seq { left, right } => stack.extend([left, right]),
                    DNode::Close { body, set, item } => {
                        let item = self.item(set, item);
                        let prod = &self.dag.g.prods[item.prod as usize];
                        let rule = &self.dag.g.rules[prod.rule as usize];
                        let p = self.projected(item.origin);
                        let q = self.projected(set);
                        if !rule.helper && prefs.paths.contains_key(&rule.name) && p < q {
                            let n = out.entry((rule.name.clone(), p, q)).or_insert(Nat::ZERO);
                            *n = n.add(&Nat::ONE);
                        }
                        stack.push(body);
                    }
                }
            }
            out
        };
        let c = contests(prefs, &occurrences(first), &occurrences(second));
        (!c.forward.is_empty() && !c.reverse.is_empty()).then_some(c)
    }
}

fn preference_cycle(edges: &[BTreeMap<usize, RankReason>]) -> Option<Vec<usize>> {
    let mut done = BTreeSet::new();
    for start in 0..edges.len() {
        if done.contains(&start) {
            continue;
        }
        let mut stack = vec![(start, edges[start].keys().copied().collect::<Vec<_>>().into_iter())];
        let mut active = BTreeMap::from([(start, 0)]);
        while let Some((v, targets)) = stack.last_mut() {
            let vertex = *v;
            let Some(next) = targets.next() else {
                done.insert(vertex);
                active.remove(&vertex);
                stack.pop();
                continue;
            };
            if let Some(&at) = active.get(&next) {
                let mut cycle: Vec<_> = stack[at..].iter().map(|f| f.0).collect();
                let least = cycle.iter().enumerate().min_by_key(|(_, v)| *v).expect("a cycle").0;
                cycle.rotate_left(least);
                return Some(cycle);
            }
            if !done.contains(&next) {
                active.insert(next, stack.len());
                stack.push((next, edges[next].keys().copied().collect::<Vec<_>>().into_iter()));
            }
        }
    }
    None
}
impl<'c> Ranker<'c> {
    fn projected(&self, p: u32) -> u32 {
        self.dag.projection.map_or(p, |(_, project)| project[p as usize])
    }
    pub(super) fn possible_contest(&mut self, root: Key) -> bool {
        if self.dag.g.preferences.paths.is_empty() {
            return false;
        }
        let mut seen = BTreeSet::new();
        let mut visited = std::collections::HashSet::new();
        let mut inventory: BTreeMap<(u32, u32), BTreeSet<String>> = BTreeMap::new();
        let mut stack = vec![root];
        let mut possible = false;
        while let Some(key) = stack.pop() {
            if !visited.insert(key) {
                continue;
            }
            self.statistics.forest_items += 1;
            if let Node::Close { set, index } = key.0 {
                let item = self.item(set, index);
                let r = &self.dag.g.rules[self.dag.g.prods[item.prod as usize].rule as usize];
                let p = self.projected(item.origin);
                let q = self.projected(set);
                if !r.helper
                    && p < q
                    && self.dag.g.preferences.paths.contains_key(&r.name)
                    && seen.insert((r.name.clone(), p, q))
                {
                    let names = inventory.entry((p, q)).or_default();
                    for n in names.iter() {
                        if self.dag.g.preferences.paths[&r.name].contains_key(n)
                            || self.dag.g.preferences.paths[n].contains_key(&r.name)
                        {
                            possible = true;
                        }
                    }
                    names.insert(r.name.clone());
                }
            }
            let deps = self.deps(key);
            self.statistics.forest_edges += Self::keys(&deps).len();
            stack.extend(Self::keys(&deps).into_iter().map(|(node, _)| (node, 0)));
        }
        possible
    }
    fn signature_store(&mut self, set: &mut SignatureSet, s: Signature) {
        if let Some(previous) = set.get_mut(&s.key) {
            previous.count = previous.count.saturating_add(s.count).min(2);
            previous.w |= s.w;
            for entry in s.entries {
                self.dag.add_entry(&mut previous.entries, entry);
            }
        } else {
            set.insert(s.key.clone(), s);
        }
    }
    fn signature_leaf(&mut self, key: Key) -> SignatureResult {
        let result = self.compute(key, Deps::Leaf);
        let actions = if matches!(self.stage_lean, Lean::Lazy | Lean::Greedy) {
            match key.0 {
                Node::Read { tok, terminal } => vec![Act::Read { tok, terminal }],
                Node::Item { set, index } if self.item(set, index).origin != set => {
                    let i = self.item(set, index);
                    vec![Act::Read { tok: i.origin, terminal: restored_terminal(self.dag.g, i.prod) }]
                }
                _ => Vec::new(),
            }
        } else {
            Vec::new()
        };
        let s = Signature {
            key: SignatureKey { profile: Vec::new(), occurrences: BTreeMap::new(), elisions: BTreeMap::new(), actions },
            entries: result.entries,
            count: result.count,
            w: result.w,
        };
        let mut out = SignatureResult::default();
        if s.count > 0 {
            self.signature_store(&mut out.all, s);
        }
        out
    }
    fn signature_compute(&mut self, key: Key, deps: Deps, memo: &FxMap<Key, SignatureResult>) -> SignatureResult {
        match deps {
            Deps::Leaf => self.signature_leaf(key),
            Deps::Close(None) => SignatureResult::default(),
            Deps::Close(Some(inner)) => {
                let Node::Close { set, index } = key.0 else { unreachable!("a close") };
                let item = self.item(set, index);
                let prod = &self.dag.g.prods[item.prod as usize];
                let rule = &self.dag.g.rules[prod.rule as usize];
                let p = self.projected(item.origin);
                let q = self.projected(set);
                let flagged = !rule.helper && rule.leftmost_longest && p < q;
                let preferred = !rule.helper && self.dag.g.preferences.paths.contains_key(&rule.name) && p < q;
                let name = rule.name.clone();
                let elided = self.stage_lean == Lean::LateElision && prod.syms.is_empty() && rule.elided.is_some();
                let act = self.dag.close_act(set, index);
                let mut out = SignatureResult::default();
                for body in memo[&inner].all.values() {
                    let mut s = body.clone();
                    if flagged {
                        s.key.profile = sum_profiles(&s.key.profile, &[(p, q, Nat::ONE)]);
                    }
                    if preferred {
                        let n = s.key.occurrences.entry((name.clone(), p, q)).or_insert(Nat::ZERO);
                        *n = n.add(&Nat::ONE);
                    }
                    if elided {
                        let n = s.key.elisions.entry(item.origin).or_insert(Nat::ZERO);
                        *n = n.add(&Nat::ONE);
                    }
                    if matches!(self.stage_lean, Lean::Lazy | Lean::Greedy)
                        && matches!(act, Act::Close { visible: true, .. })
                    {
                        s.key.actions.push(act);
                    }
                    s.entries = s
                        .entries
                        .iter()
                        .map(|e| Entry {
                            x: self.dag.close(e.x, set, index),
                            comps: e
                                .comps
                                .iter()
                                .map(|c| Comp { d: self.dag.close(c.d, set, index), div: c.div.clone() })
                                .collect(),
                        })
                        .collect();
                    self.signature_store(&mut out.all, s);
                }
                out
            }
            Deps::Group(members) => {
                let mut out = SignatureResult::default();
                let alternatives = members.len();
                for (number, member) in (0..).zip(members) {
                    if self.skips(Fault::LostSelect, "group", number, alternatives) {
                        continue;
                    }
                    for s in memo[&member].all.values() {
                        let mut s = s.clone();
                        if self.skips(Fault::LostContext, "group", number, alternatives) {
                            s.count = 0;
                            s.w = false;
                        }
                        self.signature_store(&mut out.all, s);
                    }
                }
                out
            }
            Deps::Links(links) => {
                let Node::Item { set, index } = key.0 else { unreachable!("an item") };
                let (guarded, test) = self.guard(set, index);
                let mut out = SignatureResult { all: FxMap::default(), allowed: guarded.then(FxMap::default) };
                let alternatives = links.len();
                for (number, (pred, child)) in (0..).zip(links) {
                    if self.skips(Fault::LostSelect, "links", number, alternatives) {
                        continue;
                    }
                    let (elided, permitted) = self.eligibility(child.0, guarded, test);
                    let before = &memo[&pred];
                    let left = if elided { before.allowed() } else { &before.all };
                    for a in left.values() {
                        for b in memo[&child].all.values() {
                            let mut actions = a.key.actions.clone();
                            actions.extend_from_slice(&b.key.actions);
                            let key = SignatureKey {
                                profile: sum_profiles(&a.key.profile, &b.key.profile),
                                occurrences: sum_counts(&a.key.occurrences, &b.key.occurrences),
                                elisions: sum_counts(&a.key.elisions, &b.key.elisions),
                                actions,
                            };
                            let count = if self.skips(Fault::LostContext, "links", number, alternatives) {
                                0
                            } else {
                                a.count.saturating_mul(b.count).min(2)
                            };
                            let Node::Item { set: m, .. } = pred.0 else { unreachable!("a predecessor") };
                            let w = count > 0
                                && a.w
                                && b.w
                                && self.marks.is_some_and(|marks| marks.links.contains(&(set, index, m)));
                            let mut entries = Vec::new();
                            for x in &a.entries {
                                for y in &b.entries {
                                    let e = self.dag.product(x, y);
                                    self.dag.add_entry(&mut entries, e);
                                }
                            }
                            let s = Signature { key, entries, count, w };
                            if guarded && permitted {
                                self.signature_store(out.allowed.as_mut().expect("an allowed set"), s.clone());
                            }
                            self.signature_store(&mut out.all, s);
                        }
                    }
                }
                out
            }
        }
    }
    fn signatures(&mut self, root: Key) -> FxMap<Key, SignatureResult> {
        let mut memo = FxMap::default();
        let mut stack = vec![(root, None)];
        while let Some((key, deps)) = stack.last_mut() {
            let key = *key;
            if memo.contains_key(&key) {
                stack.pop();
                continue;
            }
            if deps.is_none() {
                let found = self.deps(key);
                let missing: Vec<_> = Self::keys(&found).into_iter().filter(|k| !memo.contains_key(k)).collect();
                *deps = Some(found);
                for dep in missing.into_iter().rev() {
                    stack.push((dep, None));
                }
                continue;
            }
            let (_, deps) = stack.pop().expect("a frame");
            let result = self.signature_compute(key, deps.expect("dependencies"), &memo);
            self.statistics.contexts += 1;
            self.statistics.signatures += result.all.len();
            self.statistics.largest_set =
                self.statistics.largest_set.max(result.all.len()).max(result.allowed.as_ref().map_or(0, |s| s.len()));
            memo.insert(key, result);
        }
        memo
    }
    fn signature_canonical(&self, s: &Signature) -> u32 {
        s.entries.iter().map(|e| e.x).min_by(|a, b| self.derivation_order(*a, *b)).expect("an entry")
    }
    fn derivation_order(&self, a: u32, b: u32) -> Ordering {
        if self.dag.before(a, b) {
            Ordering::Less
        } else if self.dag.before(b, a) {
            Ordering::Greater
        } else {
            Ordering::Equal
        }
    }
    fn signature_order(&self, a: &Signature, b: &Signature) -> Ordering {
        let e = if self.stage_lean == Lean::LateElision {
            compare_elision_counts(&a.key.elisions, &b.key.elisions).0
        } else {
            Ordering::Equal
        };
        e.then_with(|| self.derivation_order(self.signature_canonical(a), self.signature_canonical(b)))
    }
    fn signature_compare(&self, a: &Signature, b: &Signature) -> (Ordering, Option<RankReason>) {
        let c = contests(&self.dag.g.preferences, &a.key.occurrences, &b.key.occurrences);
        if !c.forward.is_empty() && !c.reverse.is_empty() {
            return (Ordering::Equal, None);
        }
        if !c.forward.is_empty() {
            return (Ordering::Less, Some(RankReason::Prefer(c.forward)));
        }
        if !c.reverse.is_empty() {
            return (Ordering::Greater, None);
        }
        if self.stage_lean == Lean::LateElision {
            let (order, boundary, counts) = compare_elision_counts(&a.key.elisions, &b.key.elisions);
            return (
                order,
                (order != Ordering::Equal).then_some(RankReason::Stage {
                    directive: "late-elision",
                    boundary,
                    counts,
                    witness: None,
                }),
            );
        }
        if let Diff::At { a: x, b: y, .. } =
            self.dag.first_difference(self.signature_canonical(a), self.signature_canonical(b), true)
        {
            let (first, tie) = self.dag.outcome(&x, &y);
            if !tie {
                return (
                    if first { Ordering::Less } else { Ordering::Greater },
                    Some(RankReason::Stage {
                        directive: if self.stage_lean == Lean::Lazy { "lazy" } else { "greedy" },
                        boundary: None,
                        counts: None,
                        witness: Some([Some(x), Some(y)]),
                    }),
                );
            }
        }
        (Ordering::Equal, None)
    }
    pub(super) fn rank_preferences(&mut self, root: Key) -> Option<Ranking> {
        // The signature pass never consults the old local profile filter.
        self.statistics.slow = true;
        let summaries = self.elisions.take();
        let memo = self.signatures(root);
        self.elisions = summaries;
        let all = &memo[&root].all;
        let total = all.values().fold(0u8, |n, s| n.saturating_add(s.count).min(2));
        if total == 0 || all.is_empty() {
            return None;
        }
        let witness_counted = self.marks.map(|_| all.values().any(|s| s.w));
        let profile =
            all.values().map(|s| &s.key.profile).min_by(|a, b| compare_profiles(a, b)).expect("a signature").clone();
        let mut best: Vec<_> =
            all.values().filter(|s| compare_profiles(&s.key.profile, &profile) == Ordering::Equal).collect();
        best.sort_by(|a, b| self.signature_order(a, b));
        let mut edges = vec![BTreeMap::new(); best.len()];
        let mut incoming = vec![false; best.len()];
        for i in 0..best.len() {
            for j in i + 1..best.len() {
                self.statistics.comparisons += 1;
                let (order, reason) = self.signature_compare(best[i], best[j]);
                let (from, to, reason) = match order {
                    Ordering::Equal => continue,
                    Ordering::Less => (i, j, reason),
                    Ordering::Greater => (j, i, self.signature_compare(best[j], best[i]).1),
                };
                incoming[to] = true;
                edges[from].insert(to, reason.expect("a strict edge"));
            }
        }
        if let Some(cycle) = preference_cycle(&edges) {
            let readings: Vec<_> = cycle.iter().map(|&i| self.signature_canonical(best[i])).collect();
            let cycle = cycle
                .iter()
                .enumerate()
                .map(|(i, &v)| RankEdge {
                    from: i,
                    to: (i + 1) % cycle.len(),
                    reason: edges[v][&cycle[(i + 1) % cycle.len()]].clone(),
                })
                .collect();
            return Some(Ranking {
                verdict: Verdict::Tie,
                first: readings[0],
                second: None,
                witness: None,
                witness_counted,
                profile,
                slow: true,
                readings,
                cycle,
                conflict: None,
            });
        }
        let survivors: Vec<_> = best.into_iter().enumerate().filter(|(i, _)| !incoming[*i]).map(|(_, s)| s).collect();
        let first = self.signature_canonical(survivors[0]);
        let mut candidates = Vec::new();
        for s in &survivors {
            for entry in &s.entries {
                if !matches!(self.dag.first_difference(first, entry.x, false), Diff::Equal) {
                    candidates.push((entry.x, *s));
                }
                for c in &entry.comps {
                    candidates.push((c.d, *s));
                }
            }
        }
        let div = |d| match self.dag.first_difference(first, d, true) {
            Diff::At { index, .. } => Div::At(index),
            Diff::APrefix { len } | Diff::BPrefix { len } => Div::At(len),
            Diff::Equal => Div::Last,
        };
        candidates.sort_by(|(a, sa), (b, sb)| {
            div(*a)
                .cmp(&div(*b))
                .then_with(|| {
                    if self.stage_lean == Lean::LateElision {
                        compare_elision_counts(&sa.key.elisions, &sb.key.elisions).0
                    } else {
                        Ordering::Equal
                    }
                })
                .then_with(|| self.derivation_order(*a, *b))
        });
        let second = candidates.first().map(|(d, _)| *d);
        let witness = second.map(|d| self.pair_witness(first, d));
        let conflict = candidates.first().and_then(|(_, s)| {
            let c = contests(&self.dag.g.preferences, &survivors[0].key.occurrences, &s.key.occurrences);
            (!c.forward.is_empty() && !c.reverse.is_empty()).then_some(c)
        });
        Some(Ranking {
            verdict: if second.is_some() {
                Verdict::Tie
            } else if total == 1 {
                Verdict::Unique
            } else {
                Verdict::Resolved
            },
            first,
            second,
            witness,
            witness_counted,
            profile,
            slow: true,
            readings: Vec::new(),
            cycle: Vec::new(),
            conflict,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_occurrence_cancellation_and_common_additions() {
        let prefs = crate::preferences::Preferences {
            paths: BTreeMap::from([
                ("a".into(), BTreeMap::from([("b".into(), vec!["a".into(), "b".into()])])),
                ("b".into(), BTreeMap::new()),
            ]),
            warnings: Vec::new(),
        };
        let large = (0..70).fold(Nat::ONE, |n, _| n.add(&n));
        let a = ("a".into(), 0, 1);
        let b = ("b".into(), 0, 1);
        let left = BTreeMap::from([(a.clone(), large.add(&Nat::ONE))]);
        let right = BTreeMap::from([(a.clone(), large.clone()), (b.clone(), Nat::ONE)]);
        assert_eq!(contests(&prefs, &left, &right).forward[0].residual_counts, ["1", "1"]);
        assert_eq!(large.add(&Nat::ONE).decimal(), "1180591620717411303425");
        let mut state = 131u64;
        for _ in 0..10000 {
            let mut next = || {
                state = state.wrapping_mul(1664525).wrapping_add(1013904223);
                Nat::from(state % 5)
            };
            let left = BTreeMap::from([(a.clone(), next()), (b.clone(), next())]);
            let right = BTreeMap::from([(a.clone(), next()), (b.clone(), next())]);
            let common = BTreeMap::from([(a.clone(), next()), (b.clone(), next())]);
            assert_eq!(
                contests(&prefs, &left, &right),
                contests(&prefs, &sum_counts(&left, &common), &sum_counts(&right, &common))
            );
        }
    }
}
