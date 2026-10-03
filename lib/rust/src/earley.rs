//! The recognizer (engine §4): an Earley parser whose items carry, for each
//! capture before the dot, the captured part's span and tag set; with the
//! evaluation of terms and conditions (§10) and nested parses.

use crate::eligible::Proofs;
use crate::fxhash::{FxMap, FxSet};

use crate::lower::{Characters, CmpOp, LCond, LTerm, Lowered, Span, Sym, SymbolTest, TestOp};
use crate::result::Attachment;
use crate::tags::{character_tag, difference, intersection, is_name, is_subset, union, SetId, TagId, TagList, Tags};
use crate::unicode::Unicode;

/// How a terminal matches a token (engine §4): by a tag the token carries,
/// or, for a range or a property, by one of its character tags.
#[derive(Debug, Clone, Copy)]
pub(crate) enum Matcher {
    Tag(TagId),
    Characters(Characters),
}

/// The matchers of a lowered grammar's terminals, by terminal id.
pub(crate) fn matchers(g: &Lowered, tags: &mut Tags) -> Vec<Matcher> {
    g.terminals
        .iter()
        .zip(&g.characters)
        .map(|(name, characters)| match characters {
            Some(characters) => Matcher::Characters(*characters),
            None => Matcher::Tag(tags.tag(name)),
        })
        .collect()
}

thread_local! {
    /// How many items the recognizer has made on this thread, in parses and
    /// nested parses alike: a measure of work that tests compare across
    /// input lengths.
    static ITEMS: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}

/// How many items the recognizer has made on this thread (`ITEMS`).
pub fn recognizer_items() -> u64 {
    ITEMS.with(|items| items.get())
}

/// Sets the count of the recognizer's items on this thread back to zero.
pub fn reset_recognizer_items() {
    ITEMS.with(|items| items.set(0));
}

/// A token of a stage's input.
#[derive(Debug, Clone)]
pub(crate) struct Tok {
    pub text: String,
    pub tags: SetId,
    pub phonemes: Option<String>,
    pub source: (usize, usize),
    /// What it shows to people (§5).
    pub label: String,
    /// Its phonemes in canonical form, for the sound tests of symbols and for
    /// `phonemes()`, computed when one first looks at the token (§4, §5).
    pub sound: std::cell::OnceCell<Box<str>>,
    /// The tokens attached before it and after it (§11), which no grammar
    /// operation sees: only emission forwards them.
    pub before: Vec<Attachment>,
    pub after: Vec<Attachment>,
}

impl Tok {
    /// Whether the token has attachments (§11).
    pub(crate) fn has_attachments(&self) -> bool {
        !self.before.is_empty() || !self.after.is_empty()
    }
}

impl Tok {
    /// The token's phonemes in canonical form, or nothing if it has none
    /// (§5). The lowercase mapping and the removal of commas act on each
    /// code point alone, so the canonical sound of a span is its tokens'
    /// joined.
    pub(crate) fn sound(&self, unicode: &Unicode) -> &str {
        self.sound.get_or_init(|| unicode.canonical(self.phonemes.as_deref().unwrap_or("")).into())
    }
}

/// Whether `tokens` sound like a string: their canonical sound is exactly
/// it (§4, §5). A token with no phonemes adds nothing, so an empty span
/// sounds like the empty string.
fn sounds_like(tokens: &[Tok], unicode: &Unicode, sound: &str) -> bool {
    let mut rest = sound;
    for token in tokens {
        match rest.strip_prefix(token.sound(unicode)) {
            Some(after) => rest = after,
            None => return false,
        }
    }
    rest.is_empty()
}

/// Whether a test holds of a symbol's own span, `tokens`, and its own tags,
/// `set`: a token's for a terminal, the completed item's for a reference
/// (§4). A tag the table has never seen is in no set.
pub(crate) fn test_holds(test: &SymbolTest, tokens: &[Tok], unicode: &Unicode, tags: &Tags, set: SetId) -> bool {
    let has = |tag: &String| tags.lookup(tag).is_some_and(|tag| tags.contains(set, tag));
    match test.op {
        TestOp::Is | TestOp::IsNot => {
            sounds_like(tokens, unicode, test.sound.as_deref().unwrap_or("")) == (test.op == TestOp::Is)
        }
        TestOp::Superset => test.tags.iter().all(has),
        TestOp::NotSuperset => !test.tags.iter().all(has),
        TestOp::Disjoint => !test.tags.iter().any(has),
        TestOp::Meets => test.tags.iter().any(has),
    }
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
    /// In the reconstruction mode of `elision-only` (§7.4), whether each
    /// item is strict: every step that made it was strict. An ordinary step
    /// makes it ordinary for good.
    strict: Vec<bool>,
    /// The items to process, in order, each with whether it is processed
    /// again, because an ordinary step reached it after it was processed
    /// as strict (§7.4).
    queue: Vec<(u32, bool)>,
    /// Whether each item has been taken from the queue.
    processed: Vec<bool>,
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
    /// The rules predicted here, each with whether every prediction of it
    /// was strict (§7.4).
    predicted: FxMap<u32, bool>,
    /// The productions that prediction skipped here because the next token
    /// lacked their first terminal. A production whose condition failed is
    /// not one of them.
    pub skipped: Vec<u32>,
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
type ObservedToken = (SetId, String, Option<String>, usize, usize);

/// What a nested parse's answer is remembered by (§4).
#[derive(Clone, PartialEq, Eq, Hash)]
enum NestedKey {
    /// A short span: its rule, the original text that holds its tokens'
    /// sources, and each token's tags, text, phonemes, and where its
    /// source begins and ends in that text, which
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
    /// The tag list of each range that a term holds, by its first and last
    /// scalar values, made once (§10).
    ranges: FxMap<(u32, u32), TagList>,
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
            ranges: FxMap::default(),
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

    /// Whether a terminal matches a token whose tags are `set` (§4). A
    /// range or a property matches once, however many of its tags qualify.
    #[inline]
    pub(crate) fn reads(&self, matcher: Matcher, set: SetId) -> bool {
        match matcher {
            Matcher::Tag(tag) => self.tags.contains(set, tag),
            Matcher::Characters(characters) => self.carries(characters, set),
        }
    }

    /// Whether a tag set holds a character tag of a range or a property.
    fn carries(&self, characters: Characters, set: SetId) -> bool {
        self.tags.list(set).iter().filter_map(|&tag| self.tags.code(tag)).any(|code| match characters {
            Characters::Range(first, last) => (first..=last).contains(&code),
            Characters::Property(property) => self.unicode.has(property, code),
        })
    }

    /// The character tags of a range, from its first to its last scalar
    /// value, the surrogates skipped (§1).
    fn range(&mut self, first: u32, last: u32) -> TagList {
        if let Some(list) = self.ranges.get(&(first, last)) {
            return list.clone();
        }
        let unicode = self.unicode;
        let mut list: TagList =
            (first..=last).filter_map(char::from_u32).map(|c| self.tags.tag(&character_tag(c, unicode))).collect();
        list.sort_unstable();
        self.ranges.insert((first, last), list.clone());
        list
    }

    pub(crate) fn source_text(&self, start: usize, end: usize) -> String {
        self.text[start..end].iter().collect()
    }
}

/// How the recognition of the reconstructed input R of `elision-only`
/// observes the stage's input O (engine §7.2, §7.3, §7.5).
pub(crate) struct Recon<'o> {
    /// O, the stage's input, which every observation reads.
    pub observed: &'o [Tok],
    /// π: for each position of R, the number of original tokens before it.
    pub project: Vec<u32>,
    /// For each token of R, whether it is synthetic, by its provenance.
    pub synthetic: Vec<bool>,
}

/// A term's value (§10).
#[derive(Debug, Clone)]
enum Value {
    Str(String),
    Set(TagList),
}

pub(crate) struct Recognizer<'g, 's, 'a> {
    pub g: &'g Lowered,
    /// How each terminal of the grammar matches a token, by terminal id.
    pub matchers: &'g [Matcher],
    pub shared: &'s mut Shared<'a>,
    /// In the check of `elision-only`, the reconstruction that the parse in
    /// progress reads in its mode (§7.4); `None` in the ordinary mode, and
    /// inside every nested query, which reads O in that mode (§7.6).
    pub recon: Option<&'g Recon<'g>>,
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
    /// In the check of `elision-only`, π, which takes the positions of the
    /// frame, which are of R, to those of O, where every observation reads
    /// (§7.3, §7.5); `None` elsewhere.
    pub project: Option<&'c [u32]>,
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
/// In the check of `elision-only`, the projection comes first, then the
/// function (§7.5): a capture and `$` are projected to O, and the functions
/// of a span work on the projected span.
fn span_bounds(span: &Span, frame: &Frame, input: usize) -> Bounds {
    let projected = |start: u32, end: u32| match frame.project {
        Some(project) => (project[start as usize] as usize, project[end as usize] as usize),
        None => (start as usize, end as usize),
    };
    match span {
        Span::Cap(slot) => {
            let cap = frame.caps[*slot as usize];
            let (start, end) = projected(cap.start, cap.end);
            (start, end, Whose::Cap(cap.tags))
        }
        Span::Whole => {
            let (start, end) = projected(frame.origin, frame.end);
            (start, end, Whose::Whole)
        }
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
        self.predict(&mut chart, tokens, base, start, 0, false)?;
        let mut e = 0;
        while e < chart.sets.len() && (e == 0 || !chart.sets[e].items.is_empty()) {
            chart.reached = e;
            let mut head = 0;
            while head < chart.sets[e].queue.len() {
                let (k, again) = chart.sets[e].queue[head];
                head += 1;
                let k = k as usize;
                chart.sets[e].processed[k] = true;
                let item = chart.sets[e].items[k];
                let g = self.g;
                let production = &g.prods[item.prod as usize];
                if item.dot as usize == production.syms.len() {
                    self.complete(&mut chart, tokens, base, e, k)?;
                    continue;
                }
                match production.syms[item.dot as usize] {
                    Sym::T(terminal) => {
                        if e < n && self.shared.reads(self.matchers[terminal as usize], tokens[e].tags) {
                            // A terminal that reads a synthetic token
                            // captures no tags (§7.5).
                            let synthetic = self.recon.is_some_and(|recon| recon.synthetic[e]);
                            let tags = if synthetic { self.shared.tags.set(TagList::new()) } else { tokens[e].tags };
                            // The written route of an elidable optional from
                            // a synthetic token: the rest of the optional
                            // must read, so the item after it is strict
                            // (§7.4).
                            let rule = &g.rules[production.rule as usize];
                            let strict = synthetic && item.dot == 0 && rule.helper && rule.elided.is_some();
                            let cap = Cap { start: e as u32, end: e as u32 + 1, tags };
                            self.advance(&mut chart, tokens, base, item, cap, e + 1, strict)?;
                        }
                    }
                    Sym::N(rule) => {
                        if !again {
                            chart.sets[e].waiting.entry(rule).or_default().push(k as u32);
                        }
                        let strict = chart.sets[e].strict[k];
                        // A strict item predicts its next symbol strictly
                        // where no symbol after it can read, and it advances
                        // over an empty constituent only where one can
                        // (§7.4).
                        let later = self.reads_later(item);
                        self.predict(&mut chart, tokens, base, rule, e, strict && !later)?;
                        if strict && !later {
                            continue;
                        }
                        let empties = chart.sets[e].empty.get(&rule).cloned().unwrap_or_default();
                        for tags in empties {
                            let cap = Cap { start: e as u32, end: e as u32, tags };
                            self.advance(&mut chart, tokens, base, item, cap, e, strict)?;
                        }
                    }
                }
            }
            e += 1;
        }
        Ok(chart)
    }

    /// Whether a symbol after an item's next symbol can read in the
    /// reconstruction mode (§7.4).
    fn reads_later(&self, item: Item) -> bool {
        self.g.reads_until[item.prod as usize] > item.dot + 1
    }

    /// Adds an item to a set, made by a step that is strict or not (§7.4).
    #[allow(clippy::too_many_arguments)]
    fn add(
        &mut self,
        chart: &mut Chart,
        tokens: &[Tok],
        base: usize,
        item: Item,
        set: usize,
        strict: bool,
    ) -> Result<(), EngineError> {
        let g = self.g;
        let production = &g.prods[item.prod as usize];
        // A strict item never completes.
        if strict && item.dot as usize == production.syms.len() {
            return Ok(());
        }
        if set >= chart.sets.len() {
            chart.sets.resize_with(set + 1, ESet::default);
        }
        let target = &mut chart.sets[set];
        if let Some(&index) = target.index.get(&item) {
            // One ordinary step makes an item ordinary. It is then processed
            // again, for what strictness held back, if it was processed.
            let index = index as usize;
            if target.strict[index] && !strict {
                target.strict[index] = false;
                if target.processed[index] {
                    target.queue.push((index as u32, true));
                }
            }
            return Ok(());
        }
        if target.failed.contains(&item) {
            return Ok(());
        }
        for (cond, trigger) in &production.conds {
            if *trigger == item.dot as usize {
                let caps = chart.caps(item.caps).to_vec();
                let (observed, project) = self.observed(tokens);
                let frame =
                    Frame { caps: &caps, prod: item.prod, origin: item.origin, end: set as u32, tags: None, project };
                if !self.condition(cond, &frame, observed, base)? {
                    chart.sets[set].failed.insert(item);
                    return Ok(());
                }
            }
        }
        let target = &mut chart.sets[set];
        ITEMS.with(|items| items.set(items.get() + 1));
        let index = target.items.len() as u32;
        target.index.insert(item, index);
        target.items.push(item);
        target.tagset.push(u32::MAX);
        target.strict.push(strict);
        target.processed.push(false);
        target.queue.push((index, false));
        Ok(())
    }

    /// The tokens that observations read, and the projection to them: O and
    /// π in the reconstruction mode (§7.5), else the parse's own tokens.
    fn observed<'t>(&self, tokens: &'t [Tok]) -> (&'t [Tok], Option<&'t [u32]>)
    where
        'g: 't,
    {
        match self.recon {
            Some(recon) => (recon.observed, Some(&recon.project)),
            None => (tokens, None),
        }
    }

    fn predict(
        &mut self,
        chart: &mut Chart,
        tokens: &[Tok],
        base: usize,
        rule: u32,
        e: usize,
        strict: bool,
    ) -> Result<(), EngineError> {
        // A rule's productions are the same at every prediction in one set.
        // A strict prediction leaves some out, so an ordinary one after it
        // adds them (§7.4).
        let before = chart.sets[e].predicted.get(&rule).copied();
        if before == Some(false) || (before == Some(true) && strict) {
            return Ok(());
        }
        chart.sets[e].predicted.insert(rule, strict);
        let g = self.g;
        let helper = &g.rules[rule as usize];
        for &production in &helper.prods {
            let lowered = &g.prods[production as usize];
            // In the reconstruction mode, the empty production of an
            // elidable optional is its restoration, and it never derives
            // the empty sequence (§7.4).
            if let (Some(recon), true, true, Some(terminal)) =
                (self.recon, lowered.syms.is_empty(), helper.helper, &helper.elided)
            {
                self.restore(chart, tokens, recon, production, terminal, helper.elided_test, e);
                continue;
            }
            // A strict prediction predicts only the productions that can
            // read.
            if strict && g.reads_until[production as usize] == 0 {
                continue;
            }
            // A production that must first read a terminal the next token
            // lacks gives a dead item, so prediction skips it. The set
            // records it, and the rejection report adds back the terminal
            // it expected.
            if let (Some(Sym::T(terminal)), false) =
                (lowered.syms.first(), lowered.conds.iter().any(|&(_, at)| at == 0))
            {
                let matcher = self.matchers[*terminal as usize];
                if e >= tokens.len() || !self.shared.reads(matcher, tokens[e].tags) {
                    if before.is_none() {
                        chart.sets[e].skipped.push(production);
                    }
                    continue;
                }
            }
            self.add(chart, tokens, base, Item { prod: production, dot: 0, origin: e as u32, caps: 0 }, e, strict)?;
        }
        Ok(())
    }

    /// The restoration of an elidable optional at `e` (§7.4): its empty
    /// production read over the one synthetic token there, where that token
    /// is compatible with the optional. It is an item of the empty
    /// production with its origin at `e`, in the set after `e`, which only
    /// a restoration makes; it evaluates nothing of the optional's content.
    #[allow(clippy::too_many_arguments)]
    fn restore(
        &mut self,
        chart: &mut Chart,
        tokens: &[Tok],
        recon: &Recon,
        production: u32,
        terminal: &str,
        test: Option<u32>,
        e: usize,
    ) {
        if e >= tokens.len() || !recon.synthetic[e] {
            return;
        }
        let token = &tokens[e];
        let tags = &self.shared.tags;
        if !tags.lookup(terminal).is_some_and(|tag| tags.contains(token.tags, tag)) {
            return;
        }
        if let Some(test) = test {
            let test = &self.g.tests[test as usize];
            if !test_holds(test, std::slice::from_ref(token), self.shared.unicode, tags, token.tags) {
                return;
            }
        }
        let item = Item { prod: production, dot: 0, origin: e as u32, caps: 0 };
        if e + 1 >= chart.sets.len() {
            chart.sets.resize_with(e + 2, ESet::default);
        }
        let target = &mut chart.sets[e + 1];
        if target.index.contains_key(&item) {
            return;
        }
        ITEMS.with(|items| items.set(items.get() + 1));
        let index = target.items.len() as u32;
        target.index.insert(item, index);
        target.items.push(item);
        target.tagset.push(u32::MAX);
        target.strict.push(false);
        target.processed.push(false);
        target.queue.push((index, false));
    }

    #[allow(clippy::too_many_arguments)]
    fn advance(
        &mut self,
        chart: &mut Chart,
        tokens: &[Tok],
        base: usize,
        item: Item,
        cap: Cap,
        into: usize,
        strict: bool,
    ) -> Result<(), EngineError> {
        let g = self.g;
        let production = &g.prods[item.prod as usize];
        // A tested symbol's test must hold of its own span and tags, which
        // is checked before any condition the advance makes ready (§4). A
        // test of a terminal reads the token with its recognition values; in
        // the check, a test of a reference reads its projected span and its
        // constituent's tags (§7.5).
        if let Some(test) = g.test(item.prod, item.dot as usize) {
            let (start, end) = (cap.start as usize, cap.end as usize);
            let holds = match (production.syms[item.dot as usize], self.recon) {
                (Sym::T(_), _) => {
                    test_holds(test, &tokens[start..end], self.shared.unicode, &self.shared.tags, tokens[start].tags)
                }
                (Sym::N(_), Some(recon)) => {
                    let span = &recon.observed[recon.project[start] as usize..recon.project[end] as usize];
                    test_holds(test, span, self.shared.unicode, &self.shared.tags, cap.tags)
                }
                (Sym::N(_), None) => {
                    test_holds(test, &tokens[start..end], self.shared.unicode, &self.shared.tags, cap.tags)
                }
            };
            if !holds {
                return Ok(());
            }
        }
        let caps = if production.cap_at[item.dot as usize].is_some() {
            let mut caps = chart.caps(item.caps).to_vec();
            caps.push(cap);
            chart.intern_caps(caps)
        } else {
            item.caps
        };
        let next = Item { prod: item.prod, dot: item.dot + 1, origin: item.origin, caps };
        self.add(chart, tokens, base, next, into, strict)
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
        let (observed, project) = self.observed(tokens);
        let frame = Frame { caps: &caps, prod: item.prod, origin: item.origin, end: e as u32, tags: None, project };
        let tags = self.constituent_tags(&frame, observed, base)?;
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
        let empty = origin == e;
        if empty {
            chart.sets[e].empty.entry(rule).or_default().push(tags);
        }
        let count = chart.sets[origin].waiting.get(&rule).map_or(0, Vec::len);
        for index in 0..count {
            let waiter = chart.sets[origin].waiting[&rule][index];
            let waiting = chart.sets[origin].items[waiter as usize];
            // A strict item advances over an empty constituent only where a
            // later symbol can read, and stays strict (§7.4).
            let strict = empty && chart.sets[origin].strict[waiter as usize];
            if strict && !self.reads_later(waiting) {
                continue;
            }
            let cap = Cap { start: item.origin, end: e as u32, tags };
            self.advance(chart, tokens, base, waiting, cap, e, strict)?;
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
                let list = self.set_term(term, &frame, tokens, base)?;
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
                (token.tags, token.text.clone(), token.phonemes.clone(), from - low, to - low)
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
        // span's end. Only the items with an eligible proof tree count.
        let set = (end - start) as u32;
        let witnesses: Vec<(u32, u32)> = chart
            .sets
            .get(set as usize)
            .and_then(|last| last.completed.get(&(rule, 0)))
            .into_iter()
            .flatten()
            .map(|&index| (set, index))
            .collect();
        let eligible = self.proofs(&chart, &tokens[start..end]).eligible(&witnesses);
        for (&(set, index), _) in witnesses.iter().zip(&eligible).filter(|(_, &eligible)| eligible) {
            accepted = true;
            list = union(&list, self.shared.tags.list(chart.sets[set as usize].tagset[index as usize]));
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
        // A completed item from the span's start, in any set, with an
        // eligible proof tree.
        let witnesses: Vec<(u32, u32)> = (0..chart.sets.len())
            .flat_map(|set| {
                chart.sets[set].completed.get(&(rule, 0)).into_iter().flatten().map(move |&index| (set as u32, index))
            })
            .collect();
        let answer = self.proofs(&chart, &tokens[start..end]).eligible(&witnesses).contains(&true);
        self.shared.begins.insert(key, answer);
        Ok(answer)
    }

    /// The proof trees of a nested parse's chart over `tokens`, its span.
    fn proofs<'c>(&'c self, chart: &'c Chart, tokens: &'c [Tok]) -> Proofs<'c> {
        Proofs::new(self.g, chart, tokens, self.shared.unicode, &self.shared.tags)
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
        // A nested query reads O in the ordinary mode (§7.6).
        let recon = self.recon.take();
        let chart = self.recognize(&tokens[start..end], base + start, rule);
        self.recon = recon;
        // Also when the parse failed, so that the place is free again.
        self.shared.running.remove(&place);
        chart
    }

    // ---- terms and conditions

    /// The canonical sound of the span (§5).
    fn phonemes(&self, tokens: &[Tok], start: usize, end: usize) -> String {
        tokens[start..end].iter().map(|token| token.sound(self.shared.unicode)).collect()
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

    /// A set's value. The reader has made sure that the types agree
    /// (§10), so a string never stands where a set is needed.
    fn as_set(value: Value) -> Result<TagList, EngineError> {
        match value {
            Value::Set(list) => Ok(list),
            Value::Str(_) => Err(EngineError { message: "a string where a set is needed".to_string(), rule: None }),
        }
    }

    /// A string's value. The reader has made sure that the types agree
    /// (§10), so a set never stands where a string is needed.
    fn string_term(&mut self, term: &LTerm, frame: &Frame, tokens: &[Tok], base: usize) -> Result<String, EngineError> {
        match self.term(term, frame, tokens, base)? {
            Value::Str(text) => Ok(text),
            Value::Set(_) => Err(EngineError { message: "a set where a string is needed".to_string(), rule: None }),
        }
    }

    fn set_term(&mut self, term: &LTerm, frame: &Frame, tokens: &[Tok], base: usize) -> Result<TagList, EngineError> {
        let value = self.term(term, frame, tokens, base)?;
        Self::as_set(value)
    }

    fn term(&mut self, term: &LTerm, frame: &Frame, tokens: &[Tok], base: usize) -> Result<Value, EngineError> {
        Ok(match term {
            LTerm::Str(text) => Value::Str(text.clone()),
            LTerm::Tag(tag) => Value::Set(vec![self.shared.tags.tag(tag)]),
            LTerm::Range(first, last) => Value::Set(self.shared.range(*first, *last)),
            LTerm::Empty => Value::Set(TagList::new()),
            LTerm::Union(items) => {
                let mut list = TagList::new();
                for item in items {
                    list = union(&list, &self.set_term(item, frame, tokens, base)?);
                }
                Value::Set(list)
            }
            LTerm::Inter(items) => {
                let mut list: Option<TagList> = None;
                for item in items {
                    let set = self.set_term(item, frame, tokens, base)?;
                    list = Some(match list {
                        None => set,
                        Some(list) => intersection(&list, &set),
                    });
                }
                Value::Set(list.unwrap_or_default())
            }
            LTerm::Diff(left, right) => {
                let left = self.set_term(left, frame, tokens, base)?;
                let right = self.set_term(right, frame, tokens, base)?;
                Value::Set(difference(&left, &right))
            }
            LTerm::Phonemes(span) => {
                let (start, end, _) = span_bounds(span, frame, tokens.len());
                Value::Str(self.phonemes(tokens, start, end))
            }
            LTerm::Text(span) => {
                let (start, end, _) = span_bounds(span, frame, tokens.len());
                Value::Str(self.text(tokens, start, end))
            }
            // A set of strings (§10); an empty delimiter that only a parse
            // sees is an error of the grammar.
            LTerm::Split(string, delimiter) => {
                let string = self.string_term(string, frame, tokens, base)?;
                let delimiter = self.string_term(delimiter, frame, tokens, base)?;
                if delimiter.is_empty() {
                    return Err(EngineError { message: "split has an empty delimiter".to_string(), rule: None });
                }
                let mut list: TagList = string
                    .split(delimiter.as_str())
                    .filter(|piece| !piece.is_empty())
                    .map(|piece| self.shared.tags.tag(piece))
                    .collect();
                list.sort_unstable();
                list.dedup();
                Value::Set(list)
            }
            LTerm::TagOf(name) => {
                let name = self.string_term(name, frame, tokens, base)?;
                if !is_name(&name) {
                    return Err(EngineError {
                        message: format!("tag({name:?}): the string is not a name"),
                        rule: None,
                    });
                }
                Value::Set(vec![self.shared.tags.tag(&name)])
            }
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
                        .filter(|&id| self.shared.tags.name(id).starts_with(|c: char| c.is_ascii_uppercase()))
                        .collect(),
                )
            }
            // The classes that the classifier gives the string, for the
            // features of the parse, or none for an unknown key (§10).
            LTerm::Classify(string, classifier) => {
                let key = self.string_term(string, frame, tokens, base)?;
                let g = self.g;
                let classes = g.classifiers.get(classifier).and_then(|table| table.get(&key));
                let mut list: TagList =
                    classes.into_iter().flatten().map(|class| self.shared.tags.tag(class)).collect();
                list.sort_unstable();
                Value::Set(list)
            }
            // `t` is evaluated only where the guard holds (§10).
            LTerm::If(cond, then) => {
                if self.condition(cond, frame, tokens, base)? {
                    Value::Set(self.set_term(then, frame, tokens, base)?)
                } else {
                    Value::Set(TagList::new())
                }
            }
        })
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
                    // Two strings, or two sets of one kind (§10).
                    CmpOp::Eq | CmpOp::Ne => {
                        let equal = match (left, right) {
                            (Value::Str(a), Value::Str(b)) => a == b,
                            (a, b) => Self::as_set(a)? == Self::as_set(b)?,
                        };
                        equal == (*op == CmpOp::Eq)
                    }
                    // A string in a set of strings.
                    CmpOp::In | CmpOp::NotIn => {
                        let Value::Str(needle) = left else {
                            return Err(EngineError {
                                message: "the left side of ∈ or ∉ is a string".to_string(),
                                rule: None,
                            });
                        };
                        let set = Self::as_set(right)?;
                        let inside = self.shared.tags.lookup(&needle).is_some_and(|id| set.binary_search(&id).is_ok());
                        inside == (*op == CmpOp::In)
                    }
                    CmpOp::Subset | CmpOp::NotSubset => {
                        is_subset(&Self::as_set(left)?, &Self::as_set(right)?) == (*op == CmpOp::Subset)
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
        let list = self.set_term(term, frame, tokens, base)?;
        Ok(self.shared.tags.set(list))
    }
}
