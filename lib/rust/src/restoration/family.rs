//! Boundary summaries for the deletion test of engine §4.1.

use super::{Aligned, Observations, Sequence, INVALID};
use crate::fxhash::FxMap;
#[cfg(test)]
use crate::fxhash::FxSet;
use crate::work::{count, Work};
use std::collections::BTreeMap;

thread_local! {
    static CONFORMANCE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static COMPARISONS: std::cell::Cell<(u64,u64)> = const { std::cell::Cell::new((0,0)) };
}

/// Enable the independent family test on this thread, including nested parses.
/// This hook belongs to conformance tests, outside the documented API.
pub fn with_family_conformance<T>(run: impl FnOnce() -> T) -> (T, (u64, u64)) {
    struct Guard(bool, (u64, u64));
    impl Drop for Guard {
        fn drop(&mut self) {
            CONFORMANCE.with(|c| c.set(self.0));
            COMPARISONS.with(|c| c.set(self.1));
        }
    }
    let guard = Guard(CONFORMANCE.with(|c| c.replace(true)), COMPARISONS.with(|c| c.replace((0, 0))));
    let result = run();
    let counts = COMPARISONS.with(std::cell::Cell::get);
    drop(guard);
    (result, counts)
}

type Set = Vec<bool>;
type Relation = Vec<Set>;

#[derive(Debug)]
struct Context {
    start: usize,
    end: usize,
    groups: BTreeMap<usize, Vec<Aligned>>,
}
impl Context {
    fn group(&self, at: usize) -> &[Aligned] {
        self.groups.get(&at).map_or(&[], Vec::as_slice)
    }
    fn size(&self, at: usize) -> usize {
        if at > self.end {
            1
        } else {
            2 * (self.group(at).len() + 1)
        }
    }
    fn initial(&self, at: usize) -> Set {
        let mut set = vec![false; self.size(at)];
        set[0] = true;
        set
    }
    fn accepting(&self, at: usize, final_group: bool) -> Set {
        if at > self.end {
            return vec![true];
        }
        let group = self.group(at);
        let n = if final_group || at == self.end {
            group.iter().position(|r| matches!(r, Aligned::Block(b) if b.end > at)).unwrap_or(group.len())
        } else {
            group.len()
        };
        let mut set = vec![false; self.size(at)];
        set[2 * n] = true;
        if !final_group && at < self.end {
            set[2 * n + 1] = true;
        }
        set
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum Ends {
    Dead,
    /// None is the identity of an empty item without records.
    Empty(Option<Relation>),
    /// Start states that reach acceptance, and end states reached from (0,0).
    Span {
        first: Set,
        last: Set,
    },
}
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct Summary {
    context: u32,
    start: usize,
    end: usize,
    ends: Ends,
}

#[derive(Debug, Default)]
pub(crate) struct Families {
    oracle: Option<Sequence<(Aligned, bool)>>,
    contexts: Vec<Context>,
    context_ids: FxMap<(u32, usize, usize, u32), u32>,
    summaries: Vec<Summary>,
    ids: FxMap<Summary, u32>,
    #[cfg(test)]
    taken: FxSet<(u32, Ends)>,
    joins: FxMap<(u32, u32), u32>,
    records: FxMap<(u32, Aligned, bool), u32>,
    tokens: FxMap<(u32, usize, usize), u32>,
}
impl Families {
    pub(crate) fn enable_oracle(&mut self) {
        if CONFORMANCE.with(std::cell::Cell::get) || std::env::var_os("GENCMU_FAMILY_CONFORMANCE").is_some() {
            self.oracle = Some(Sequence::new());
        }
    }
    pub(crate) fn oracle_record(&mut self, record: Aligned, permitted: bool) -> u32 {
        self.oracle.as_mut().map_or(0, |o| o.append(0, (record, permitted)))
    }
    pub(crate) fn oracle_join(&mut self, left: u32, right: u32) -> u32 {
        self.oracle.as_mut().map_or(0, |o| o.join(left, right))
    }
    pub(crate) fn compare_oracle(&self, context: u32, oracle: u32, end: usize, actual: bool) {
        let Some(records) = &self.oracle else {
            return;
        };
        let c = &self.contexts[context as usize];
        let h = end.min(c.end);
        let mut groups: BTreeMap<usize, Vec<(Aligned, bool)>> = BTreeMap::new();
        let mut valid = true;
        for (record, permitted) in records.values(oracle) {
            let at = match record {
                Aligned::Close(_, at) => *at,
                Aligned::Block(b) => {
                    if b.start < c.end && b.end > c.end {
                        valid = false;
                    }
                    if b.start == h && b.end > h {
                        continue;
                    }
                    b.start
                }
            };
            if at <= h {
                groups.entry(at).or_default().push((record.clone(), *permitted));
            }
        }
        if valid {
            for &at in c.groups.keys().chain(groups.keys()) {
                if at > h {
                    continue;
                }
                let candidate: Vec<_> = c
                    .group(at)
                    .iter()
                    .filter(|r| !matches!(r,Aligned::Block(b) if at == h && b.end > h))
                    .cloned()
                    .collect();
                let witness = groups.get(&at).map_or(&[][..], Vec::as_slice);
                if !deletion_test(&candidate, witness, at > c.start, at < h) {
                    valid = false;
                    break;
                }
            }
        }
        COMPARISONS.with(|counts| {
            let (yes, no) = counts.get();
            counts.set((yes + u64::from(valid), no + u64::from(!valid)));
        });
        assert_eq!(actual, valid, "family summaries disagree with the whole-observation deletion test");
    }

    pub(crate) fn context(
        &mut self,
        observations: &Observations,
        candidate: u32,
        start: usize,
        end: usize,
        family: u32,
    ) -> u32 {
        let aligned = observations.normalized(candidate);
        let key = (aligned, start, end, family);
        if let Some(&id) = self.context_ids.get(&key) {
            return id;
        }
        let mut groups: BTreeMap<usize, Vec<Aligned>> = BTreeMap::new();
        if candidate != INVALID {
            for record in observations.aligned.values(aligned) {
                let at = match record {
                    Aligned::Close(_, at) => *at,
                    Aligned::Block(b) => b.start,
                };
                groups.entry(at).or_default().push(record.clone());
            }
        }
        let id = self.contexts.len() as u32;
        self.contexts.push(Context { start, end, groups });
        self.context_ids.insert(key, id);
        id
    }
    fn intern(&mut self, s: Summary) -> u32 {
        if let Some(&id) = self.ids.get(&s) {
            return id;
        }
        let id = self.summaries.len() as u32 + 1;
        self.summaries.push(s.clone());
        self.ids.insert(s, id);
        id
    }
    fn get(&self, id: u32) -> &Summary {
        &self.summaries[id as usize - 1]
    }
    pub(crate) fn invalid(&mut self, id: u32) -> u32 {
        self.dead(self.get(id).context)
    }
    pub(crate) fn dead(&mut self, context: u32) -> u32 {
        self.intern(Summary { context, start: 0, end: 0, ends: Ends::Dead })
    }
    pub(crate) fn take(&mut self, id: u32, context: u32) {
        #[cfg(test)]
        {
            let ends = if id == 0 { Ends::Empty(None) } else { self.get(id).ends.clone() };
            if self.taken.insert((context, ends)) {
                count(Work::FamilySummaries, 1);
            }
        }
        #[cfg(not(test))]
        let _ = (id, context, Work::FamilySummaries);
    }
    pub(crate) fn token(&mut self, context: u32, start: usize, end: usize) -> u32 {
        let key = (context, start, end);
        if let Some(&id) = self.tokens.get(&key) {
            return id;
        }
        let c = &self.contexts[context as usize];
        let ends = Ends::Span { first: c.accepting(start, false), last: c.initial(end) };
        let id = self.intern(Summary { context, start, end, ends });
        self.tokens.insert(key, id);
        id
    }
    pub(crate) fn record(&mut self, context: u32, record: Aligned, permitted: bool) -> u32 {
        let key = (context, record.clone(), permitted);
        if let Some(&id) = self.records.get(&key) {
            return id;
        }
        let at = match &record {
            Aligned::Close(_, at) => *at,
            Aligned::Block(b) => b.start,
        };
        let c = &self.contexts[context as usize];
        if let Aligned::Block(b) = &record {
            if b.start < c.end && b.end > c.end {
                return self.dead(context);
            }
        }
        // Blocks extending beyond the comparison at b are outside its group.
        if at > c.end || matches!(&record,Aligned::Block(b) if at == c.end && b.end > at) {
            return 0;
        }
        let group = c.group(at);
        let size = c.size(at);
        count(Work::FamilySteps, size as u64);
        let mut rows = vec![vec![false; size]; size];
        for (state, row) in rows.iter_mut().enumerate() {
            let i = state / 2;
            if group.get(i) == Some(&record) {
                row[2 * (i + 1)] = true;
            }
            if permitted && matches!(record, Aligned::Close(..)) && (i > 0 || at > c.start) {
                row[2 * i + 1] = true;
            }
        }
        let id = self.intern(Summary { context, start: at, end: at, ends: Ends::Empty(Some(rows)) });
        self.records.insert(key, id);
        id
    }
    pub(crate) fn block(&mut self, context: u32, block: super::Block) -> u32 {
        let (start, end) = (block.start, block.end);
        let record = self.record(context, Aligned::Block(block), false);
        if start == end {
            record
        } else {
            let span = self.token(context, start, end);
            self.join(record, span)
        }
    }
    pub(crate) fn join(&mut self, left: u32, right: u32) -> u32 {
        if left == 0 {
            return right;
        }
        if right == 0 {
            return left;
        }
        if let Some(&id) = self.joins.get(&(left, right)) {
            return id;
        }
        let a = self.get(left).clone();
        let b = self.get(right).clone();
        assert_eq!(a.context, b.context, "families do not pass into nested queries");
        let ends = match (&a.ends, &b.ends) {
            (Ends::Dead, _) | (_, Ends::Dead) => Ends::Dead,
            (Ends::Empty(first), Ends::Empty(second)) => Ends::Empty(compose(first, second)),
            (Ends::Empty(rows), Ends::Span { first, last }) => {
                Ends::Span { first: preimage(rows, first), last: last.clone() }
            }
            (Ends::Span { first, last }, Ends::Empty(rows)) => {
                Ends::Span { first: first.clone(), last: image(last, rows) }
            }
            (Ends::Span { first, last }, Ends::Span { first: next, last: end }) => {
                if intersects(last, next) {
                    Ends::Span { first: first.clone(), last: end.clone() }
                } else {
                    Ends::Dead
                }
            }
        };
        let id = if ends == Ends::Dead {
            self.dead(a.context)
        } else {
            self.intern(Summary { context: a.context, start: a.start, end: b.end, ends })
        };
        self.joins.insert((left, right), id);
        id
    }
    pub(crate) fn accepts(&self, context: u32, id: u32, end: usize) -> bool {
        let c = &self.contexts[context as usize];
        if id == 0 {
            return c.accepting(end, true)[0];
        }
        let s = self.get(id);
        match &s.ends {
            Ends::Dead => false,
            Ends::Empty(rows) => intersects(&image(&c.initial(end), rows), &c.accepting(end, true)),
            Ends::Span { first, last } => first[0] && intersects(last, &c.accepting(end, true)),
        }
    }
}
fn intersects(a: &Set, b: &Set) -> bool {
    a.iter().zip(b).any(|(a, b)| *a && *b)
}
fn image(set: &Set, rows: &Option<Relation>) -> Set {
    let Some(rows) = rows else {
        return set.clone();
    };
    count(Work::FamilySteps, rows.len() as u64);
    let mut out = vec![false; rows.len()];
    for (included, row) in set.iter().zip(rows) {
        if *included {
            for (out, r) in out.iter_mut().zip(row) {
                *out |= r;
            }
        }
    }
    out
}
fn preimage(rows: &Option<Relation>, set: &Set) -> Set {
    let Some(rows) = rows else {
        return set.clone();
    };
    count(Work::FamilySteps, rows.len() as u64);
    rows.iter().map(|row| intersects(row, set)).collect()
}
fn compose(a: &Option<Relation>, b: &Option<Relation>) -> Option<Relation> {
    match (a, b) {
        (None, _) => b.clone(),
        (_, None) => a.clone(),
        (Some(a), _) => Some(a.iter().map(|row| image(row, b)).collect()),
    }
}

/// Enumerate kept subsequences, then inspect each deleted record and its anchors.
/// This test does not use the boundary automaton or its summaries.
fn deletion_test(candidate: &[Aligned], witness: &[(Aligned, bool)], before: bool, after: bool) -> bool {
    fn visit(
        candidate: &[Aligned],
        witness: &[(Aligned, bool)],
        at: usize,
        kept: &mut Vec<usize>,
        before: bool,
        after: bool,
    ) -> bool {
        if kept.len() == candidate.len() {
            for (i, (record, permitted)) in witness.iter().enumerate() {
                if kept.contains(&i) {
                    continue;
                }
                if !permitted
                    || !matches!(record, Aligned::Close(..))
                    || !(before || kept.iter().any(|&k| k < i))
                    || !(after || kept.iter().any(|&k| k > i))
                {
                    return false;
                }
            }
            return true;
        }
        for i in at..witness.len() {
            if witness[i].0 == candidate[kept.len()] {
                kept.push(i);
                if visit(candidate, witness, i + 1, kept, before, after) {
                    return true;
                }
                kept.pop();
            }
        }
        false
    }
    visit(candidate, witness, 0, &mut Vec::new(), before, after)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::json::Json;
    use crate::work;

    fn number(value: &Json, name: &str) -> u64 {
        value.get(name).and_then(Json::as_int).unwrap_or(0) as u64
    }
    fn counts() -> [u64; 7] {
        [
            Work::Items,
            Work::PackedEdges,
            Work::CloseStates,
            Work::CloseSequences,
            Work::SummaryContexts,
            Work::FamilySummaries,
            Work::FamilySteps,
        ]
        .map(work::counted)
    }
    fn growth_run(
        root: &std::path::Path,
        shared: &Json,
        case: &str,
        size: usize,
        bounds: Option<[u64; 7]>,
    ) -> [u64; 7] {
        let fixture = crate::json::parse(&std::fs::read_to_string(root.join(case)).unwrap()).unwrap();
        let mut rules = fixture.get("grammar").unwrap().as_str().unwrap().to_owned();
        let depth = shared.get("depths").is_some();
        if depth {
            let ranked = case.contains("ranked-sibling");
            let limit = if ranked { 7 } else { 5 };
            let deepest = if ranked { "r10" } else { "r16" };
            rules = rules.lines().take(limit).collect::<Vec<_>>().join("\n").replace(deepest, &format!("r{size}"));
            for i in 1..=size {
                rules += &format!("\n%rule r{i} r{} r{}{}", i - 1, i - 1, if ranked { " | [+V]" } else { "" });
            }
            rules += if ranked { "\n%rule fam a | b | r0" } else { "\n%rule fam r0" };
            if !ranked {
                // Observe the doubled rule as an aligned witness, as the shared contract requires.
                rules = rules.replace(".matches(empty)", &format!(".matches(r{size})"));
            }
        }
        let source = format!("```jbogenbau\n%stage main\n{rules}\n```\n");
        let dialect = crate::load_dialect_sources([("p.md", source.as_str())], "p.md").unwrap();
        work::reset();
        if let Some(b) = bounds {
            for (kind, bound) in [
                Work::Items,
                Work::PackedEdges,
                Work::CloseStates,
                Work::CloseSequences,
                Work::SummaryContexts,
                Work::FamilySummaries,
                Work::FamilySteps,
            ]
            .into_iter()
            .zip(b)
            {
                work::budget(kind, bound);
            }
        }
        let started = std::time::Instant::now();
        let result = if depth {
            dialect.parse("", &crate::ParseOptions::default()).unwrap()
        } else if let Some(tokens) = fixture.get("tokens").and_then(Json::as_array) {
            let repeated = &tokens[0];
            let all = std::iter::repeat(repeated).take(size).chain(tokens.iter().skip_while(|t| *t == repeated));
            let input: Vec<_> = all
                .map(|t| crate::InputToken {
                    text: t.get("text").unwrap().as_str().unwrap().into(),
                    tags: t
                        .get("tags")
                        .unwrap()
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|t| t.as_str().unwrap().to_owned())
                        .collect(),
                    ..Default::default()
                })
                .collect();
            dialect.parse_tokens(&input, &crate::ParseOptions::default()).unwrap()
        } else {
            dialect.parse(&format!("x{}", "a".repeat(size)), &crate::ParseOptions::default()).unwrap()
        };
        let outcome = if depth && !case.contains("ranked-sibling") {
            false
        } else {
            fixture.get("expect").unwrap().get("result").unwrap().get("ok").unwrap() == &Json::Bool(true)
        };
        assert_eq!(result.ok, outcome, "{case} at {size}: {:?}", result.error);
        let out = counts();
        eprintln!("{case} {size}: items={} edges={} closeStates={} closeSequences={} cycleContexts={} familySummaries={} familySteps={} elapsed={:?}",out[0],out[1],out[2],out[3],out[4],out[5],out[6],started.elapsed());
        work::reset();
        out
    }
    #[test]
    fn summaries_equal_deletion_for_every_small_group_and_split() {
        let close =
            |name: &str, at| crate::result::Restoration { terminal: name.into(), at, source: at..at, value: None };
        for (start, end, at) in [(0, 2, 0), (0, 2, 1), (0, 2, 2), (0, 0, 0)] {
            for candidate_len in 0..=3 {
                let mut observations = Observations::new();
                let mut candidate = 0;
                for _ in 0..candidate_len {
                    let record = observations.close(close("T", at));
                    candidate = observations.join(candidate, record);
                }
                let mut families = Families::default();
                let context = families.context(&observations, candidate, start, end, 0);
                let candidate: Vec<_> = (0..candidate_len).map(|_| Aligned::Close("T".into(), at)).collect();
                for length in 0..=4 {
                    for code in 0..4usize.pow(length) {
                        let witness: Vec<_> = (0..length)
                            .map(|i| {
                                let value = (code / 4usize.pow(i)) % 4;
                                (Aligned::Close(if value < 2 { "T" } else { "U" }.into(), at), value % 2 == 1)
                            })
                            .collect();
                        let expected = deletion_test(&candidate, &witness, at > start, at < end);
                        let records: Vec<_> =
                            witness.iter().map(|(r, p)| families.record(context, r.clone(), *p)).collect();
                        for split in 0..=records.len() {
                            let left = records[..split].iter().fold(0, |a, &b| families.join(a, b));
                            let right = records[split..].iter().rev().fold(0, |b, &a| families.join(a, b));
                            let mut summary = families.join(left, right);
                            if at > start {
                                let token = families.token(context, start, at);
                                summary = families.join(token, summary);
                            }
                            if at < end {
                                let token = families.token(context, at, end);
                                summary = families.join(summary, token);
                            }
                            assert_eq!(
                                families.accepts(context, summary, end),
                                expected,
                                "{start}..{end}, group at {at}, {candidate:?}, {witness:?}, split {split}"
                            );
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn shared_family_growth_bounds() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests");
        let growth =
            crate::json::parse(&std::fs::read_to_string(root.join("without-elision-growth.json")).unwrap()).unwrap();
        let Json::Obj(ref entries) = growth else { panic!("growth object") };
        for (name, shared) in entries.iter().filter(|(_, v)| v.get("strictCase").is_some()) {
            let sizes = shared.get("lengths").or_else(|| shared.get("depths")).unwrap().as_array().unwrap();
            for size in sizes {
                let size = size.as_int().unwrap() as usize;
                let mut absolute = [u64::MAX; 7];
                if shared.get("itemsPerUnit").is_some() {
                    absolute[0] = number(shared, "itemsPerUnit") * size as u64 + number(shared, "slack");
                }
                if shared.get("nodesPerDepth").is_some() {
                    absolute[3] = number(shared, "nodesPerDepth") * (size as u64 + 1) + number(shared, "slack");
                }
                if shared.get("maxCloseStates").is_some() {
                    absolute[2] = number(shared, "maxCloseStates");
                }
                if shared.get("maxCloseNodes").is_some() {
                    absolute[3] = number(shared, "maxCloseNodes");
                }
                let mut strict_limits = absolute;
                if let Some(b) = shared.get("strictBound") {
                    strict_limits[2] = number(b, "closeStatesPerUnit") * size as u64 + number(b, "closeStatesSlack");
                }
                let strict = growth_run(
                    &root,
                    shared,
                    shared.get("strictCase").unwrap().as_str().unwrap(),
                    size,
                    Some(strict_limits),
                );
                let mut limits = absolute;
                if let Some(b) = shared.get("overStrict") {
                    limits[0] = limits[0].min(
                        strict[0] * (number(b, "itemsPercent") + number(b, "itemsPercentPerUnit") * size as u64) / 100
                            + number(b, "itemsSlack"),
                    );
                    limits[2] = limits[2].min(strict[2] + number(b, "closeStatesPerUnit") * size as u64);
                }
                for (field, slot, power) in [("summaries", 5, 2), ("steps", 6, 3)] {
                    if let Some(b) = shared.get(field) {
                        limits[slot] = number(b, if power == 2 { "perSquare" } else { "perCube" })
                            * (size as u64).pow(power)
                            + number(b, "slack");
                    }
                }
                let equal = shared.get("equalsStrict") == Some(&Json::Bool(true));
                let at_most = shared.get("atMostStrict") == Some(&Json::Bool(true));
                if equal || at_most {
                    limits[0] = limits[0].min(strict[0]);
                    limits[2] = limits[2].min(strict[2]);
                }
                let family =
                    growth_run(&root, shared, shared.get("case").unwrap().as_str().unwrap(), size, Some(limits));
                if equal {
                    assert_eq!((family[0], family[2]), (strict[0], strict[2]), "{name} {size}");
                }
            }
        }
    }
}
