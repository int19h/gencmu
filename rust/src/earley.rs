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
    predicted: FxSet<u32>,
}

impl ESet {
    pub(crate) fn find(&self, item: &Item) -> Option<u32> {
        self.index.get(item).copied()
    }
}

#[derive(Debug, Default)]
pub(crate) struct Chart {
    pub sets: Vec<ESet>,
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
}

/// A defect of the grammar found while parsing (engine §4, §5).
#[derive(Debug, Clone)]
pub(crate) struct EngineError {
    pub message: String,
    /// The token the defect concerns, in the stage's input.
    pub token: Option<usize>,
    pub rule: Option<u32>,
}

#[derive(Clone, PartialEq, Eq, Hash)]
struct NestedKey {
    rule: u32,
    text: String,
    tokens: Vec<(SetId, String, Option<String>)>,
}

/// What every parse of one stage shares: the tag tables, the original
/// text, and the memo of nested parses.
pub(crate) struct Shared<'a> {
    pub tags: Tags,
    pub unicode: &'a Unicode,
    pub text: &'a [char],
    memo: FxMap<NestedKey, (bool, SetId)>,
    running: FxSet<NestedKey>,
}

impl<'a> Shared<'a> {
    pub(crate) fn new(unicode: &'a Unicode, text: &'a [char]) -> Shared<'a> {
        Shared { tags: Tags::new(), unicode, text, memo: FxMap::default(), running: FxSet::default() }
    }

    /// Forgets the nested parses of the previous stage, whose rules differ.
    pub(crate) fn next_stage(&mut self) {
        self.memo.clear();
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
    List(Vec<String>),
}

pub(crate) struct Recognizer<'g, 's, 'a> {
    pub g: &'g Lowered,
    pub term_tags: &'g [TagId],
    pub shared: &'s mut Shared<'a>,
}

/// A span's bounds and, if it is a whole capture, the capture's slot.
type Bounds = (usize, usize, Option<u8>);

fn span_bounds(span: &Span, caps: &[Cap]) -> Bounds {
    match span {
        Span::Cap(slot) => {
            let cap = caps[*slot as usize];
            (cap.start as usize, cap.end as usize, Some(*slot))
        }
        Span::Head(inner) => {
            let (start, end, _) = span_bounds(inner, caps);
            (start, if start < end { start + 1 } else { start }, None)
        }
        Span::Tail(inner) => {
            let (start, end, _) = span_bounds(inner, caps);
            (if start < end { start + 1 } else { start }, end, None)
        }
        Span::Last(inner) => {
            let (start, end, _) = span_bounds(inner, caps);
            (if start < end { end - 1 } else { end }, end, None)
        }
    }
}

impl<'g, 's, 'a> Recognizer<'g, 's, 'a> {
    /// Recognizes `tokens` (which start at `base` in the stage's input) with
    /// `start` as the start rule.
    pub(crate) fn recognize(&mut self, tokens: &[Tok], base: usize, start: u32) -> Result<Chart, EngineError> {
        let n = tokens.len();
        let mut chart = Chart::default();
        chart.intern_caps(Vec::new());
        chart.sets = (0..=n).map(|_| ESet::default()).collect();
        self.predict(&mut chart, tokens, base, start, 0)?;
        for e in 0..=n {
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
        let target = &chart.sets[set];
        if target.index.contains_key(&item) || target.failed.contains(&item) {
            return Ok(());
        }
        let g = self.g;
        let production = &g.prods[item.prod as usize];
        for (cond, trigger) in &production.conds {
            if u32::from(*trigger) == item.dot {
                let caps = chart.caps(item.caps).to_vec();
                if !self.condition(cond, &caps, tokens, base)? {
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
        let tags = match &production.tags {
            Some(term) => {
                let value = self.term(term, &caps, tokens, base)?;
                let list = self.as_set(value);
                self.shared.tags.set(list)
            }
            None if production.syms.len() == 1 => {
                caps[production.cap_at[0].expect("an implicit capture") as usize].tags
            }
            None => 0,
        };
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

    // ---- nested parses

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
        let slice = &tokens[start..end];
        let text = match (slice.first(), slice.last()) {
            (Some(first), Some(last)) if first.source.0 <= last.source.1 => {
                self.shared.source_text(first.source.0, last.source.1)
            }
            _ => String::new(),
        };
        let key = NestedKey {
            rule,
            text,
            tokens: slice.iter().map(|token| (token.tags, token.text.clone(), token.phonemes.clone())).collect(),
        };
        if let Some(&answer) = self.shared.memo.get(&key) {
            return Ok(answer);
        }
        if self.shared.running.contains(&key) {
            return Err(EngineError {
                message: format!(
                    "the rule {} is defined by its own negation: a condition asks whether the span it is parsing matches it",
                    self.g.rules[rule as usize].name
                ),
                token: Some(base + start),
                rule: Some(rule),
            });
        }
        self.shared.running.insert(key.clone());
        let chart = self.recognize(slice, base + start, rule)?;
        let last = &chart.sets[slice.len()];
        let mut accepted = false;
        let mut list = TagList::new();
        if let Some(items) = last.completed.get(&(rule, 0)) {
            for &index in items {
                accepted = true;
                list = union(&list, self.shared.tags.list(last.tagset[index as usize]));
            }
        }
        let answer = (accepted, self.shared.tags.set(list));
        self.shared.running.remove(&key);
        self.shared.memo.insert(key, answer);
        Ok(answer)
    }

    // ---- terms and conditions

    fn phonemes(tokens: &[Tok], start: usize, end: usize) -> String {
        tokens[start..end].iter().filter_map(|token| token.phonemes.as_deref()).collect()
    }

    fn text(&self, tokens: &[Tok], start: usize, end: usize) -> String {
        if start < end && tokens[start].source.0 <= tokens[end - 1].source.1 {
            self.shared.source_text(tokens[start].source.0, tokens[end - 1].source.1)
        } else {
            String::new()
        }
    }

    fn span_tags(&self, bounds: Bounds, caps: &[Cap], tokens: &[Tok]) -> TagList {
        match bounds {
            (_, _, Some(slot)) => self.shared.tags.list(caps[slot as usize].tags).clone(),
            (start, end, None) => tokens[start..end]
                .iter()
                .fold(TagList::new(), |list, token| union(&list, self.shared.tags.list(token.tags))),
        }
    }

    fn as_set(&mut self, value: Value) -> TagList {
        match value {
            Value::Set(list) => list,
            Value::Str(text) => vec![(self.shared.tags.tag(&text), true)],
            Value::List(items) => {
                let mut list = TagList::new();
                for item in items {
                    list = union(&list, &vec![(self.shared.tags.tag(&item), true)]);
                }
                list
            }
        }
    }

    fn term(&mut self, term: &LTerm, caps: &[Cap], tokens: &[Tok], base: usize) -> Result<Value, EngineError> {
        Ok(match term {
            LTerm::Lit(text) => Value::Str(text.clone()),
            LTerm::Weak(text) => Value::Set(vec![(self.shared.tags.tag(text), false)]),
            LTerm::Empty => Value::Set(TagList::new()),
            LTerm::Set(items) | LTerm::Union(items) => {
                let mut list = TagList::new();
                for item in items {
                    let value = self.term(item, caps, tokens, base)?;
                    list = union(&list, &self.as_set(value));
                }
                Value::Set(list)
            }
            LTerm::Inter(items) => {
                let mut list: Option<TagList> = None;
                for item in items {
                    let value = self.term(item, caps, tokens, base)?;
                    let set = self.as_set(value);
                    list = Some(match list {
                        None => set,
                        Some(list) => intersection(&list, &set),
                    });
                }
                Value::Set(list.unwrap_or_default())
            }
            LTerm::Phonemes(span) => {
                let (start, end, _) = span_bounds(span, caps);
                Value::Str(Self::phonemes(tokens, start, end))
            }
            LTerm::Text(span) => {
                let (start, end, _) = span_bounds(span, caps);
                Value::Str(self.text(tokens, start, end))
            }
            LTerm::Lower(inner) => match self.term(inner, caps, tokens, base)? {
                Value::Str(text) => Value::Str(self.shared.unicode.lowercase(&text)),
                Value::List(items) => {
                    Value::List(items.iter().map(|item| self.shared.unicode.lowercase(item)).collect())
                }
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
                let bounds = span_bounds(span, caps);
                Value::Set(self.span_tags(bounds, caps, tokens))
            }
            LTerm::TagsRule(span, rule) => {
                let (start, end, _) = span_bounds(span, caps);
                let (_, set) = self.nested(tokens, base, start, end, *rule)?;
                Value::Set(self.shared.tags.list(set).clone())
            }
            LTerm::Classes(span) => {
                let bounds = span_bounds(span, caps);
                let list = self.span_tags(bounds, caps, tokens);
                Value::Set(
                    list.into_iter()
                        .filter(|&(id, _)| self.shared.tags.name(id).starts_with(|c: char| c.is_ascii_uppercase()))
                        .collect(),
                )
            }
            LTerm::Words(span) => {
                let (start, end, _) = span_bounds(span, caps);
                Value::List(
                    Self::phonemes(tokens, start, end)
                        .split(' ')
                        .filter(|word| !word.is_empty())
                        .map(str::to_string)
                        .collect(),
                )
            }
        })
    }

    fn names(&self, list: &TagList) -> Vec<TagId> {
        list.iter().map(|&(id, _)| id).collect()
    }

    fn condition(&mut self, cond: &LCond, caps: &[Cap], tokens: &[Tok], base: usize) -> Result<bool, EngineError> {
        Ok(match cond {
            LCond::Not(inner) => !self.condition(inner, caps, tokens, base)?,
            LCond::Any(items) => {
                for item in items {
                    if self.condition(item, caps, tokens, base)? {
                        return Ok(true);
                    }
                }
                false
            }
            LCond::Matches(span, rule) => {
                let (start, end, _) = span_bounds(span, caps);
                self.nested(tokens, base, start, end, *rule)?.0
            }
            LCond::Cmp(op, left, right) => {
                let left = self.term(left, caps, tokens, base)?;
                let right = self.term(right, caps, tokens, base)?;
                match op {
                    CmpOp::Eq | CmpOp::Ne => {
                        let equal = match (left, right) {
                            (Value::Str(a), Value::Str(b)) => a == b,
                            (Value::List(a), Value::List(b)) => a == b,
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
                            (Value::Str(a), Value::List(b)) => b.contains(&a),
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

    /// Evaluates a tag term over an item's captures, for emission (§11).
    pub(crate) fn tag_term(
        &mut self,
        term: &LTerm,
        caps: &[Cap],
        tokens: &[Tok],
        base: usize,
    ) -> Result<SetId, EngineError> {
        let value = self.term(term, caps, tokens, base)?;
        let list = self.as_set(value);
        Ok(self.shared.tags.set(list))
    }
}
