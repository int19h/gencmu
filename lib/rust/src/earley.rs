//! The recognizer (engine §4): an Earley parser whose items carry, for each
//! capture before the dot, the captured part's span and tag set; with the
//! evaluation of terms and conditions (§10) and nested parses.

use crate::fxhash::{FxMap, FxSet};

use crate::lower::{CmpOp, LCond, LTerm, Lowered, Span, Sym};
use crate::tags::{intersection, union, SetId, TagId, TagList, Tags};
use crate::unicode::Unicode;

/// A token of a stage's input.
#[derive(Debug, Clone)]
pub(crate) struct Tok {
    pub text: String,
    pub tags: SetId,
    pub phonemes: Option<String>,
    pub source: (usize, usize),
    /// Whether its phonemes are its text (§11).
    pub verbatim: bool,
}

/// A captured part: its span, relative to the parse's tokens, and its tag set.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct Cap {
    pub start: u32,
    pub end: u32,
    pub tags: SetId,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct Item {
    pub prod: u32,
    pub dot: u32,
    pub origin: u32,
    pub caps: u32,
}

#[derive(Debug, Default)]
pub(crate) struct ESet {
    pub items: Vec<Item>,
    /// For a completed item, its constituent's tag set; else `u32::MAX`.
    pub tagset: Vec<SetId>,
    index: FxMap<Item, u32>,
    failed: FxSet<Item>,
    waiting: FxMap<u32, Vec<u32>>,
    /// Completed items by (rule, origin).
    pub completed: FxMap<(u32, u32), Vec<u32>>,
    /// The origins of each rule's completed items, in order of completion.
    pub origins: FxMap<u32, Vec<u32>>,
    done: FxSet<(u32, u32, SetId)>,
    empty: FxMap<u32, Vec<SetId>>,
    /// The rules predicted here.
    pub predicted: FxSet<u32>,
}

impl ESet {
    pub(crate) fn find(&self, item: &Item) -> Option<u32> {
        self.index.get(item).copied()
    }
}

#[derive(Debug, Default)]
pub(crate) struct Chart {
    /// The sets the parse reached, and at most one empty set after them.
    pub sets: Vec<ESet>,
    /// The last position whose set holds an item, or 0: how far the parse
    /// reached.
    pub reached: usize,
    caps: Vec<Vec<Cap>>,
    caps_index: FxMap<Vec<Cap>, u32>,
}

impl Chart {
    pub(crate) fn caps(&self, id: u32) -> &[Cap] {
        &self.caps[id as usize]
    }

    fn intern_caps(&mut self, caps: Vec<Cap>) -> u32 {
        if let Some(&id) = self.caps_index.get(&caps) {
            return id;
        }
        let id = self.caps.len() as u32;
        self.caps.push(caps.clone());
        self.caps_index.insert(caps, id);
        id
    }

    pub(crate) fn lookup_caps(&self, caps: &[Cap]) -> Option<u32> {
        self.caps_index.get(caps).copied()
    }

    /// Whether a completed item of `rule` spans the tokens to `end`. The
    /// chart stops at its first empty set, so the set there may not exist.
    pub(crate) fn accepts(&self, rule: u32, end: usize) -> bool {
        self.sets.get(end).is_some_and(|set| set.completed.contains_key(&(rule, 0)))
    }
}

/// A defect of the grammar found while parsing (engine §4, §5).
#[derive(Debug, Clone)]
pub(crate) struct EngineError {
    pub message: String,
    pub rule: Option<u32>,
}

/// A nested parse by its rule and its span's bounds in the stage's input.
/// Within one parse the tokens do not change, so the place is everything
/// they can tell a nested parse (§4).
type Place = (u32, usize, usize);

/// The longest span whose nested answers are remembered by content, so that
/// a word repeated at many places is parsed once; a longer span is
/// remembered by its place, since a key of content costs as much as the
/// span is long, and the span of `from` or `after` runs to the end of the
/// input (§4).
const CONTENT_KEY_LIMIT: usize = 64;

/// What a nested parse can observe of one token of its span.
type ObservedToken = (SetId, String, Option<String>, bool, usize, usize);

/// What a nested parse's answer is remembered by (§4).
#[derive(Clone, PartialEq, Eq, Hash)]
enum NestedKey {
    /// A short span: its rule, the original text that holds its tokens'
    /// sources, and each token's tags, text, phonemes, whether it is
    /// verbatim, and where its source begins and ends in that text, which
    /// `text` of a part of the span reads: everything its parse can observe.
    Content(u32, String, Vec<ObservedToken>),
    /// A long span: its place.
    Place(Place),
}

/// What every parse of one stage shares: the tag tables, the original
/// text, and the memo of nested parses, which `next_stage` clears before a
/// parse over other tokens or with other rules.
pub(crate) struct Shared<'a> {
    pub tags: Tags,
    pub unicode: &'a Unicode,
    pub text: &'a [char],
    /// Whether a span parses as a rule, and its tags as it: what `matches`
    /// and `tags` read of one nested parse.
    memo: FxMap<NestedKey, (bool, SetId)>,
    /// What `begins` reads, apart, since it can hold where `matches` does
    /// not.
    begins: FxMap<NestedKey, bool>,
    /// The nested parses running, by place, whatever the kind of query that
    /// started each.
    running: FxSet<Place>,
}

impl<'a> Shared<'a> {
    pub(crate) fn new(unicode: &'a Unicode, text: &'a [char]) -> Shared<'a> {
        Shared {
            tags: Tags::new(),
            unicode,
            text,
            memo: FxMap::default(),
            begins: FxMap::default(),
            running: FxSet::default(),
        }
    }

    /// Forgets the nested parses of the previous parse, whose rules and
    /// tokens may differ.
    pub(crate) fn next_stage(&mut self) {
        self.memo.clear();
        self.begins.clear();
        self.running.clear();
    }

    pub(crate) fn source_text(&self, start: usize, end: usize) -> String {
        self.text[start..end].iter().collect()
    }
}

/// A term's value (§10).
#[derive(Debug, Clone)]
enum Value {
    Str(String),
    Set(TagList),
}

pub(crate) struct Recognizer<'g, 's, 'a> {
    pub g: &'g Lowered,
    pub term_tags: &'g [TagId],
    pub shared: &'s mut Shared<'a>,
}

/// What terms and conditions are evaluated over (§10): an item's captured
/// parts, and `$`, the whole constituent, from the item's origin to `end`.
#[derive(Clone, Copy)]
pub(crate) struct Frame<'c> {
    pub caps: &'c [Cap],
    pub prod: u32,
    pub origin: u32,
    pub end: u32,
    /// The constituent's tags, when known; otherwise its production's tag
    /// term gives them when they are read (§4).
    pub tags: Option<SetId>,
}

/// Whose tags a span has: a captured part's, the whole constituent's, or
/// those of its tokens.
#[derive(Clone, Copy)]
enum Whose {
    Cap(SetId),
    Whole,
    Tokens,
}

/// A span's bounds, and whose tags it has.
type Bounds = (usize, usize, Whose);

/// A span's bounds; `input` is where the input of the parse that evaluates
/// it ends, which `from` and `after` run to (§10).
fn span_bounds(span: &Span, frame: &Frame, input: usize) -> Bounds {
    match span {
        Span::Cap(slot) => {
            let cap = frame.caps[*slot as usize];
            (cap.start as usize, cap.end as usize, Whose::Cap(cap.tags))
        }
        Span::Whole => (frame.origin as usize, frame.end as usize, Whose::Whole),
        Span::Head(inner) => {
            let (start, end, _) = span_bounds(inner, frame, input);
            (start, if start < end { start + 1 } else { start }, Whose::Tokens)
        }
        Span::Tail(inner) => {
            let (start, end, _) = span_bounds(inner, frame, input);
            (if start < end { start + 1 } else { start }, end, Whose::Tokens)
        }
        Span::Last(inner) => {
            let (start, end, _) = span_bounds(inner, frame, input);
            (if start < end { end - 1 } else { end }, end, Whose::Tokens)
        }
        Span::From(inner) => (span_bounds(inner, frame, input).0, input, Whose::Tokens),
        Span::After(inner) => (span_bounds(inner, frame, input).1, input, Whose::Tokens),
    }
}

impl<'g, 's, 'a> Recognizer<'g, 's, 'a> {
    /// Recognizes `tokens` (which start at `base` in the stage's input) with
    /// `start` as the start rule. A set is made when an item first reaches
    /// it, and once one is empty every later one is: the chart stops there,
    /// so a nested parse over the rest of a long text makes only the sets it
    /// reaches.
    pub(crate) fn recognize(&mut self, tokens: &[Tok], base: usize, start: u32) -> Result<Chart, EngineError> {
        let n = tokens.len();
        let mut chart = Chart::default();
        chart.intern_caps(Vec::new());
        chart.sets.push(ESet::default());
        self.predict(&mut chart, tokens, base, start, 0)?;
        let mut e = 0;
        while e < chart.sets.len() && (e == 0 || !chart.sets[e].items.is_empty()) {
            chart.reached = e;
            let mut k = 0;
            while k < chart.sets[e].items.len() {
                let item = chart.sets[e].items[k];
                let g = self.g;
                let production = &g.prods[item.prod as usize];
                if item.dot as usize == production.syms.len() {
                    self.complete(&mut chart, tokens, base, e, k)?;
                } else {
                    match production.syms[item.dot as usize] {
                        Sym::T(terminal) => {
                            if e < n && self.shared.tags.contains(tokens[e].tags, self.term_tags[terminal as usize]) {
                                let cap = Cap { start: e as u32, end: e as u32 + 1, tags: tokens[e].tags };
                                self.advance(&mut chart, tokens, base, item, cap, e + 1)?;
                            }
                        }
                        Sym::N(rule) => {
                            chart.sets[e].waiting.entry(rule).or_default().push(k as u32);
                            self.predict(&mut chart, tokens, base, rule, e)?;
                            let empties = chart.sets[e].empty.get(&rule).cloned().unwrap_or_default();
                            for tags in empties {
                                let cap = Cap { start: e as u32, end: e as u32, tags };
                                self.advance(&mut chart, tokens, base, item, cap, e)?;
                            }
                        }
                    }
                }
                k += 1;
            }
            e += 1;
        }
        Ok(chart)
    }

    fn add(
        &mut self,
        chart: &mut Chart,
        tokens: &[Tok],
        base: usize,
        item: Item,
        set: usize,
    ) -> Result<(), EngineError> {
        if set >= chart.sets.len() {
            chart.sets.resize_with(set + 1, ESet::default);
        }
        let target = &chart.sets[set];
        if target.index.contains_key(&item) || target.failed.contains(&item) {
            return Ok(());
        }
        let g = self.g;
        let production = &g.prods[item.prod as usize];
        for (cond, trigger) in &production.conds {
            if u32::from(*trigger) == item.dot {
                let caps = chart.caps(item.caps).to_vec();
                let frame = Frame { caps: &caps, prod: item.prod, origin: item.origin, end: set as u32, tags: None };
                if !self.condition(cond, &frame, tokens, base)? {
                    chart.sets[set].failed.insert(item);
                    return Ok(());
                }
            }
        }
        let target = &mut chart.sets[set];
        target.index.insert(item, target.items.len() as u32);
        target.items.push(item);
        target.tagset.push(u32::MAX);
        Ok(())
    }

    fn predict(
        &mut self,
        chart: &mut Chart,
        tokens: &[Tok],
        base: usize,
        rule: u32,
        e: usize,
    ) -> Result<(), EngineError> {
        if !chart.sets[e].predicted.insert(rule) {
            return Ok(());
        }
        let g = self.g;
        for &production in &g.rules[rule as usize].prods {
            // A production that must first read a terminal the next token
            // lacks would add a dead item; the rejection report adds back
            // the terminals such items expected.
            let lowered = &g.prods[production as usize];
            if let (Some(Sym::T(terminal)), false) =
                (lowered.syms.first(), lowered.conds.iter().any(|&(_, at)| at == 0))
            {
                let tag = self.term_tags[*terminal as usize];
                if e >= tokens.len() || !self.shared.tags.contains(tokens[e].tags, tag) {
                    continue;
                }
            }
            self.add(chart, tokens, base, Item { prod: production, dot: 0, origin: e as u32, caps: 0 }, e)?;
        }
        Ok(())
    }

    fn advance(
        &mut self,
        chart: &mut Chart,
        tokens: &[Tok],
        base: usize,
        item: Item,
        cap: Cap,
        into: usize,
    ) -> Result<(), EngineError> {
        let g = self.g;
        let production = &g.prods[item.prod as usize];
        let caps = if production.cap_at[item.dot as usize].is_some() {
            let mut caps = chart.caps(item.caps).to_vec();
            caps.push(cap);
            chart.intern_caps(caps)
        } else {
            item.caps
        };
        let next = Item { prod: item.prod, dot: item.dot + 1, origin: item.origin, caps };
        self.add(chart, tokens, base, next, into)
    }

    fn complete(
        &mut self,
        chart: &mut Chart,
        tokens: &[Tok],
        base: usize,
        e: usize,
        k: usize,
    ) -> Result<(), EngineError> {
        let item = chart.sets[e].items[k];
        let g = self.g;
        let production = &g.prods[item.prod as usize];
        let caps = chart.caps(item.caps).to_vec();
        let frame = Frame { caps: &caps, prod: item.prod, origin: item.origin, end: e as u32, tags: None };
        let tags = self.constituent_tags(&frame, tokens, base)?;
        let rule = production.rule;
        chart.sets[e].tagset[k] = tags;
        let completed = chart.sets[e].completed.entry((rule, item.origin)).or_default();
        if completed.is_empty() {
            chart.sets[e].origins.entry(rule).or_default().push(item.origin);
            chart.sets[e].completed.get_mut(&(rule, item.origin)).expect("just made").push(k as u32);
        } else {
            completed.push(k as u32);
        }
        if !chart.sets[e].done.insert((rule, item.origin, tags)) {
            return Ok(());
        }
        let origin = item.origin as usize;
        if origin == e {
            chart.sets[e].empty.entry(rule).or_default().push(tags);
        }
        let count = chart.sets[origin].waiting.get(&rule).map_or(0, Vec::len);
        for index in 0..count {
            let waiter = chart.sets[origin].waiting[&rule][index];
            let waiting = chart.sets[origin].items[waiter as usize];
            let cap = Cap { start: item.origin, end: e as u32, tags };
            self.advance(chart, tokens, base, waiting, cap, e)?;
        }
        Ok(())
    }

    /// A constituent's tags (§4): its production's tag term, or, with none,
    /// its one symbol's tags or none (§3.7).
    fn constituent_tags(&mut self, frame: &Frame, tokens: &[Tok], base: usize) -> Result<SetId, EngineError> {
        let g = self.g;
        let production = &g.prods[frame.prod as usize];
        Ok(match &production.tags {
            Some(term) => {
                // The term cannot read `$`'s tags, which it defines (§9).
                let frame = Frame { tags: Some(0), ..*frame };
                let value = self.term(term, &frame, tokens, base)?;
                let list = self.as_set(value);
                self.shared.tags.set(list)
            }
            None if production.syms.len() == 1 => {
                frame.caps[production.cap_at[0].expect("an implicit capture") as usize].tags
            }
            None => 0,
        })
    }

    // ---- nested parses

    /// The key a nested parse of `tokens[start..end]` as `rule` is
    /// remembered by: its content if the span is short, else its place.
    fn nested_key(&self, tokens: &[Tok], base: usize, start: usize, end: usize, rule: u32) -> NestedKey {
        if end - start > CONTENT_KEY_LIMIT {
            return NestedKey::Place((rule, base + start, base + end));
        }
        // The text over the source of the span's tokens (§1).
        let span = &tokens[start..end];
        let low = span.iter().map(|token| token.source.0).min().unwrap_or(0);
        let high = span.iter().map(|token| token.source.1).max().unwrap_or(0);
        let observed = span
            .iter()
            .map(|token| {
                let (from, to) = token.source;
                (token.tags, token.text.clone(), token.phonemes.clone(), token.verbatim, from - low, to - low)
            })
            .collect();
        NestedKey::Content(rule, self.shared.source_text(low, high), observed)
    }

    /// Parses `tokens[start..end]` alone as `rule`: whether it is accepted,
    /// and the union of the tags of its derivations.
    fn nested(
        &mut self,
        tokens: &[Tok],
        base: usize,
        start: usize,
        end: usize,
        rule: u32,
    ) -> Result<(bool, SetId), EngineError> {
        let key = self.nested_key(tokens, base, start, end, rule);
        if let Some(&answer) = self.shared.memo.get(&key) {
            return Ok(answer);
        }
        let chart = self.parse_span(tokens, base, start, end, rule)?;
        let mut accepted = false;
        let mut list = TagList::new();
        // The chart stops at its first empty set, which may lie before the
        // span's end.
        if let Some(last) = chart.sets.get(end - start) {
            for &index in last.completed.get(&(rule, 0)).into_iter().flatten() {
                accepted = true;
                list = union(&list, self.shared.tags.list(last.tagset[index as usize]));
            }
        }
        let answer = (accepted, self.shared.tags.set(list));
        self.shared.memo.insert(key, answer);
        Ok(answer)
    }

    /// Whether a prefix of `tokens[start..end]`, possibly empty, parses as
    /// `rule`: whether a completed item of it begins at the span's start, in
    /// any set (§4).
    fn begins(
        &mut self,
        tokens: &[Tok],
        base: usize,
        start: usize,
        end: usize,
        rule: u32,
    ) -> Result<bool, EngineError> {
        let key = self.nested_key(tokens, base, start, end, rule);
        if let Some(&answer) = self.shared.begins.get(&key) {
            return Ok(answer);
        }
        let chart = self.parse_span(tokens, base, start, end, rule)?;
        let answer = chart.sets.iter().any(|set| set.completed.contains_key(&(rule, 0)));
        self.shared.begins.insert(key, answer);
        Ok(answer)
    }

    /// Runs the recognizer over `tokens[start..end]` alone, with `rule` as
    /// the start rule. A parse that is running is known by its place,
    /// whatever the kind of query that started it, so that alternating
    /// `matches`, `begins` and `tags` cannot hide a query about a span from
    /// inside its own parse (§4).
    fn parse_span(
        &mut self,
        tokens: &[Tok],
        base: usize,
        start: usize,
        end: usize,
        rule: u32,
    ) -> Result<Chart, EngineError> {
        let place = (rule, base + start, base + end);
        if !self.shared.running.insert(place) {
            let text = self.text(tokens, start, end);
            let name = &self.g.rules[rule as usize].name;
            return Err(EngineError {
                message: format!(
                    "a condition asks whether {text:?} parses as {name} from inside the parse of that span as {name}: \
                     the grammar defines {name} in terms of itself over the same text"
                ),
                rule: Some(rule),
            });
        }
        let chart = self.recognize(&tokens[start..end], base + start, rule);
        // Also when the parse failed, so that the place is free again.
        self.shared.running.remove(&place);
        chart
    }

    // ---- terms and conditions

    fn phonemes(tokens: &[Tok], start: usize, end: usize) -> String {
        tokens[start..end].iter().filter_map(|token| token.phonemes.as_deref()).collect()
    }

    /// The text over the source of the span's tokens (§1). The scan costs
    /// no more than the copy of the text.
    fn text(&self, tokens: &[Tok], start: usize, end: usize) -> String {
        let span = &tokens[start..end];
        match (span.iter().map(|token| token.source.0).min(), span.iter().map(|token| token.source.1).max()) {
            (Some(low), Some(high)) => self.shared.source_text(low, high),
            _ => String::new(),
        }
    }

    fn span_tags(
        &mut self,
        bounds: Bounds,
        frame: &Frame,
        tokens: &[Tok],
        base: usize,
    ) -> Result<TagList, EngineError> {
        Ok(match bounds {
            (_, _, Whose::Cap(set)) => self.shared.tags.list(set).clone(),
            (_, _, Whose::Whole) => {
                let set = match frame.tags {
                    Some(set) => set,
                    None => self.constituent_tags(frame, tokens, base)?,
                };
                self.shared.tags.list(set).clone()
            }
            (start, end, Whose::Tokens) => tokens[start..end]
                .iter()
                .fold(TagList::new(), |list, token| union(&list, self.shared.tags.list(token.tags))),
        })
    }

    fn as_set(&mut self, value: Value) -> TagList {
        match value {
            Value::Set(list) => list,
            Value::Str(text) => vec![(self.shared.tags.tag(&text), true)],
        }
    }

    fn term(&mut self, term: &LTerm, frame: &Frame, tokens: &[Tok], base: usize) -> Result<Value, EngineError> {
        Ok(match term {
            LTerm::Lit(text) => Value::Str(text.clone()),
            LTerm::Weak(text) => Value::Set(vec![(self.shared.tags.tag(text), false)]),
            LTerm::Empty => Value::Set(TagList::new()),
            LTerm::Union(items) => {
                let mut list = TagList::new();
                for item in items {
                    let value = self.term(item, frame, tokens, base)?;
                    list = union(&list, &self.as_set(value));
                }
                Value::Set(list)
            }
            LTerm::Inter(items) => {
                let mut list: Option<TagList> = None;
                for item in items {
                    let value = self.term(item, frame, tokens, base)?;
                    let set = self.as_set(value);
                    list = Some(match list {
                        None => set,
                        Some(list) => intersection(&list, &set),
                    });
                }
                Value::Set(list.unwrap_or_default())
            }
            LTerm::Phonemes(span) => {
                let (start, end, _) = span_bounds(span, frame, tokens.len());
                Value::Str(Self::phonemes(tokens, start, end))
            }
            LTerm::Text(span) => {
                let (start, end, _) = span_bounds(span, frame, tokens.len());
                Value::Str(self.text(tokens, start, end))
            }
            LTerm::Lower(inner) => match self.term(inner, frame, tokens, base)? {
                Value::Str(text) => Value::Str(self.shared.unicode.lowercase(&text)),
                Value::Set(list) => {
                    let names: Vec<(String, bool)> = list
                        .iter()
                        .map(|&(id, strong)| (self.shared.unicode.lowercase(self.shared.tags.name(id)), strong))
                        .collect();
                    let id = self.shared.tags.set_of(names.iter().map(|(name, strong)| (name.as_str(), *strong)));
                    Value::Set(self.shared.tags.list(id).clone())
                }
            },
            LTerm::Tags(span) => {
                let bounds = span_bounds(span, frame, tokens.len());
                Value::Set(self.span_tags(bounds, frame, tokens, base)?)
            }
            LTerm::TagsRule(span, rule) => {
                let (start, end, _) = span_bounds(span, frame, tokens.len());
                let (_, set) = self.nested(tokens, base, start, end, *rule)?;
                Value::Set(self.shared.tags.list(set).clone())
            }
            LTerm::Classes(span) => {
                let bounds = span_bounds(span, frame, tokens.len());
                let list = self.span_tags(bounds, frame, tokens, base)?;
                Value::Set(
                    list.into_iter()
                        .filter(|&(id, _)| self.shared.tags.name(id).starts_with(|c: char| c.is_ascii_uppercase()))
                        .collect(),
                )
            }
            // `t` is evaluated only where the guard holds (§10).
            LTerm::If(cond, then) => {
                if self.condition(cond, frame, tokens, base)? {
                    let value = self.term(then, frame, tokens, base)?;
                    Value::Set(self.as_set(value))
                } else {
                    Value::Set(TagList::new())
                }
            }
            // The words between pauses, each a strong tag, never the empty
            // string (§5).
            LTerm::Words(span) => {
                let (start, end, _) = span_bounds(span, frame, tokens.len());
                let phonemes = Self::phonemes(tokens, start, end);
                let mut list: TagList = phonemes
                    .split('.')
                    .filter(|word| !word.is_empty())
                    .map(|word| (self.shared.tags.tag(word), true))
                    .collect();
                list.sort_unstable();
                list.dedup();
                Value::Set(list)
            }
        })
    }

    fn names(&self, list: &TagList) -> Vec<TagId> {
        list.iter().map(|&(id, _)| id).collect()
    }

    fn condition(&mut self, cond: &LCond, frame: &Frame, tokens: &[Tok], base: usize) -> Result<bool, EngineError> {
        Ok(match cond {
            LCond::Not(inner) => !self.condition(inner, frame, tokens, base)?,
            LCond::Any(items) => {
                for item in items {
                    if self.condition(item, frame, tokens, base)? {
                        return Ok(true);
                    }
                }
                false
            }
            LCond::All(items) => {
                for item in items {
                    if !self.condition(item, frame, tokens, base)? {
                        return Ok(false);
                    }
                }
                true
            }
            // The consequent is evaluated only where the antecedent holds.
            LCond::If(antecedent, consequent) => {
                !self.condition(antecedent, frame, tokens, base)? || self.condition(consequent, frame, tokens, base)?
            }
            LCond::Matches(span, rule) => {
                let (start, end, _) = span_bounds(span, frame, tokens.len());
                self.nested(tokens, base, start, end, *rule)?.0
            }
            LCond::Begins(span, rule) => {
                let (start, end, _) = span_bounds(span, frame, tokens.len());
                self.begins(tokens, base, start, end, *rule)?
            }
            // Where the input of the parse that reads the condition begins
            // (§10). Positions count from the start of the tokens that parse
            // reads, a nested parse's own span included, so that is 0.
            LCond::Initial(span) => span_bounds(span, frame, tokens.len()).0 == 0,
            LCond::Cmp(op, left, right) => {
                let left = self.term(left, frame, tokens, base)?;
                let right = self.term(right, frame, tokens, base)?;
                match op {
                    CmpOp::Eq | CmpOp::Ne => {
                        let equal = match (left, right) {
                            (Value::Str(a), Value::Str(b)) => a == b,
                            (a, b) => {
                                let a = self.as_set(a);
                                let b = self.as_set(b);
                                self.names(&a) == self.names(&b)
                            }
                        };
                        equal == (*op == CmpOp::Eq)
                    }
                    CmpOp::In | CmpOp::NotIn => {
                        let inside = match (left, right) {
                            (Value::Str(a), Value::Str(b)) => a == b,
                            (Value::Str(a), Value::Set(b)) => {
                                self.shared.tags.lookup(&a).is_some_and(|id| b.iter().any(|&(tag, _)| tag == id))
                            }
                            (a, b) => {
                                let a = self.as_set(a);
                                let b = self.as_set(b);
                                a.iter().all(|&(id, _)| b.iter().any(|&(tag, _)| tag == id))
                            }
                        };
                        inside == (*op == CmpOp::In)
                    }
                    CmpOp::Subset => {
                        let a = self.as_set(left);
                        let b = self.as_set(right);
                        a.iter().all(|&(id, _)| b.iter().any(|&(tag, _)| tag == id))
                    }
                }
            }
        })
    }

    /// Evaluates a tag term over a constituent, for emission (§11).
    pub(crate) fn tag_term(
        &mut self,
        term: &LTerm,
        frame: &Frame,
        tokens: &[Tok],
        base: usize,
    ) -> Result<SetId, EngineError> {
        let value = self.term(term, frame, tokens, base)?;
        let list = self.as_set(value);
        Ok(self.shared.tags.set(list))
    }
}
