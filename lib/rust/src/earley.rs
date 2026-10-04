//! The recognizer (engine §4): an Earley parser whose items carry, for each
//! capture before the dot, the captured part's span and tag set; with the
//! evaluation of terms and conditions (§10) and nested parses.

use std::cell::Cell;
use std::sync::Arc;

use crate::eligible::Proofs;
use crate::fxhash::{FxMap, FxSet};

use crate::lower::{Characters, CmpOp, LCond, LTerm, Lowered, Span, Sym, SymbolTest, TestOp};
use crate::result::Attachment;
use crate::tags::{
    character_tag, difference, intersection, is_name, is_subset, union_all, SetId, TagId, TagList, Tags,
};
use crate::unicode::Unicode;
use crate::witness::{self, Fault};
use crate::work::{self, Work};

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
    /// How many tokens from this one on, in its sequence, have no sound, so
    /// that a sound test skips them at once. Zero where it is not known,
    /// which only makes the test step through them.
    pub quiet: u32,
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

/// Marks each token of a sequence with the run of tokens without sound that
/// it begins (`Tok::quiet`).
pub(crate) fn mark_quiet(tokens: &mut [Tok], unicode: &Unicode) {
    let mut run = 0u32;
    for token in tokens.iter_mut().rev() {
        run = if token.sound(unicode).is_empty() { run + 1 } else { 0 };
        token.quiet = run;
    }
}

/// Whether `tokens` sound like a string: their canonical sound is exactly
/// it (§4, §5). A token with no phonemes adds nothing, so an empty span
/// sounds like the empty string. Runs of such tokens are skipped whole, so
/// the test costs the length of the string, not of the span.
fn sounds_like(tokens: &[Tok], unicode: &Unicode, sound: &str) -> bool {
    let mut rest = sound;
    let mut at = 0;
    while let Some(token) = tokens.get(at) {
        work::count(Work::Sounded, 1);
        if token.quiet > 0 {
            at += token.quiet as usize;
            continue;
        }
        match rest.strip_prefix(token.sound(unicode)) {
            Some(after) => rest = after,
            None => return false,
        }
        at += 1;
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

/// One interned sequence of captured parts: the sequence it extends, how
/// many parts it holds, its last part, and `jump`, an earlier sequence that
/// a search for a part can skip to. That is the parent's jump's jump where
/// the two jumps skip the same number of parts, and the parent otherwise.
/// These are the jumps of a skew-binary list, so a search for any part
/// takes a number of steps that grows with the logarithm of the parts.
#[derive(Debug, Clone, Copy)]
struct CapEntry {
    parent: u32,
    jump: u32,
    depth: u32,
    cap: Cap,
}

/// The captured parts that a frame reads: all of them, in slot order, or
/// a sequence of a chart, whose parts are found when they are read.
#[derive(Clone, Copy)]
pub(crate) enum Caps<'c> {
    All(&'c [Cap]),
    Chart(&'c CapSearch<'c>),
}

impl Caps<'_> {
    /// The part in a slot.
    pub(crate) fn get(&self, slot: u32) -> Cap {
        match self {
            Caps::All(caps) => caps[slot as usize],
            Caps::Chart(search) => search.get(slot),
        }
    }
}

/// A chart's sequence of captured parts, read part by part: the last at
/// once, an earlier one by the jumps. Once the searches took half as many
/// steps as there are parts, every part comes from one walk, so a term
/// that reads them all walks them about twice at most.
pub(crate) struct CapSearch<'c> {
    chart: &'c Chart,
    id: u32,
    all: std::cell::OnceCell<Vec<Cap>>,
    searched: Cell<u32>,
}

impl<'c> CapSearch<'c> {
    pub(crate) fn new(chart: &'c Chart, id: u32) -> CapSearch<'c> {
        CapSearch { chart, id, all: std::cell::OnceCell::new(), searched: Cell::new(0) }
    }

    fn get(&self, slot: u32) -> Cap {
        if let Some(all) = self.all.get() {
            return all[slot as usize];
        }
        if self.searched.get() * 2 >= self.chart.caps[self.id as usize].depth {
            return self.all.get_or_init(|| self.chart.caps(self.id))[slot as usize];
        }
        let (cap, steps) = self.chart.cap_at(self.id, slot);
        self.searched.set(self.searched.get() + steps + 1);
        cap
    }
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
    /// makes it ordinary for good. Empty in any other parse, where no item
    /// is strict.
    strict: Vec<bool>,
    /// The items to process, in order. An item that an ordinary step
    /// reached after it was processed as strict is processed again (§7.4),
    /// and its entry then has the bit `AGAIN`, which only the
    /// reconstruction mode sets.
    queue: Vec<u32>,
    /// In the reconstruction mode, whether each item has been taken from
    /// the queue; empty in any other parse.
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

/// The bit of a queue entry that marks an item processed again (§7.4).
const AGAIN: u32 = 1 << 31;

impl ESet {
    pub(crate) fn find(&self, item: &Item) -> Option<u32> {
        self.index.get(item).copied()
    }

    /// Whether an item is strict, which only the reconstruction mode
    /// records.
    fn is_strict(&self, index: usize) -> bool {
        self.strict.get(index).copied().unwrap_or(false)
    }

    /// Queues a new item, and in the reconstruction mode records its
    /// strictness.
    fn enqueue(&mut self, index: u32, recon: bool, strict: bool) {
        if recon {
            self.strict.push(strict);
            self.processed.push(false);
        }
        self.queue.push(index);
    }
}

#[derive(Debug, Default)]
pub(crate) struct Chart {
    /// The sets the parse reached, and at most one empty set after them.
    pub sets: Vec<ESet>,
    /// The last position whose set holds an item, or 0: how far the parse
    /// reached.
    pub reached: usize,
    /// The captured parts of the items, each sequence once: an entry is the
    /// sequence before its last part and that part, so a sequence shares
    /// the one it extends, and an item's sequence is the number of its
    /// entry. Entry 0 is the empty sequence.
    caps: Vec<CapEntry>,
    caps_index: FxMap<(u32, Cap), u32>,
    /// The positions of the sets that hold each item, in order, made when a
    /// derivation is first rebuilt.
    positions: std::cell::OnceCell<FxMap<Item, Vec<u32>>>,
}

impl Chart {
    /// The origins `m`, in order, of the derivations of an item that reads
    /// its constituent of `rule` last, from `pred`, the item before that
    /// read, to `set`: the positions from `from` on whose set holds `pred`
    /// and where a constituent of `rule` that ends at `set` begins. It looks
    /// at the shorter of the two lists, so that rebuilding the derivations
    /// of a deep nesting, where every rule ends at one place, costs each
    /// item its own few origins, not every origin at that place.
    pub(crate) fn origins_between(&self, pred: &Item, rule: u32, from: u32, set: u32) -> Vec<u32> {
        let positions = self.positions.get_or_init(|| {
            let mut positions: FxMap<Item, Vec<u32>> = FxMap::default();
            for (at, eset) in self.sets.iter().enumerate() {
                work::count(Work::Walked, eset.items.len() as u64);
                for item in &eset.items {
                    positions.entry(*item).or_default().push(at as u32);
                }
            }
            positions
        });
        let held = positions.get(pred).map_or(&[][..], Vec::as_slice);
        let held = &held[held.partition_point(|&m| m < from)..held.partition_point(|&m| m <= set)];
        let eset = &self.sets[set as usize];
        let ending = eset.origins.get(&rule).map_or(&[][..], Vec::as_slice);
        work::count(Work::Walked, held.len().min(ending.len()) as u64 + 1);
        let mut found: Vec<u32> = if held.len() <= ending.len() {
            held.iter().copied().filter(|&m| eset.completed.contains_key(&(rule, m))).collect()
        } else {
            ending.iter().copied().filter(|&m| m >= from && held.binary_search(&m).is_ok()).collect()
        };
        found.sort_unstable();
        found.dedup();
        found
    }

    /// The captured parts of a sequence, in the order read, in one walk.
    /// Only a step that reads the parts by their slots needs them all.
    pub(crate) fn caps(&self, mut id: u32) -> Vec<Cap> {
        let mut out = Vec::new();
        while id != 0 {
            let entry = self.caps[id as usize];
            out.push(entry.cap);
            id = entry.parent;
        }
        work::count(Work::CaptureSteps, out.len() as u64);
        out.reverse();
        out
    }

    /// The part in one slot of a sequence, found from its last part by the
    /// jumps, and the number of steps that took.
    fn cap_at(&self, mut id: u32, slot: u32) -> (Cap, u32) {
        let mut steps = 0;
        while self.caps[id as usize].depth > slot + 1 {
            let entry = self.caps[id as usize];
            id = if self.caps[entry.jump as usize].depth > slot { entry.jump } else { entry.parent };
            steps += 1;
        }
        work::count(Work::CaptureSteps, u64::from(steps));
        (self.caps[id as usize].cap, steps)
    }

    /// The last captured part of a sequence that is not empty.
    pub(crate) fn last_cap(&self, id: u32) -> Cap {
        self.caps[id as usize].cap
    }

    /// The sequence before the last part of a sequence that is not empty.
    pub(crate) fn caps_parent(&self, id: u32) -> u32 {
        self.caps[id as usize].parent
    }

    /// The sequence that extends a sequence by one part, made once.
    fn extend_caps(&mut self, parent: u32, cap: Cap) -> u32 {
        if let Some(&id) = self.caps_index.get(&(parent, cap)) {
            return id;
        }
        let id = self.caps.len() as u32;
        let before = self.caps[parent as usize];
        let above = self.caps[before.jump as usize];
        let jump = if before.depth - above.depth == above.depth - self.caps[above.jump as usize].depth {
            above.jump
        } else {
            parent
        };
        self.caps.push(CapEntry { parent, jump, depth: before.depth + 1, cap });
        self.caps_index.insert((parent, cap), id);
        work::count(Work::Captures, 1);
        id
    }

    /// The sequence that extends a sequence by one part, if an item has it.
    pub(crate) fn lookup_caps(&self, parent: u32, cap: Cap) -> Option<u32> {
        self.caps_index.get(&(parent, cap)).copied()
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
    ranges: FxMap<(u32, u32), Arc<TagList>>,
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
    fn range(&mut self, first: u32, last: u32) -> Arc<TagList> {
        if let Some(list) = self.ranges.get(&(first, last)) {
            return list.clone();
        }
        let unicode = self.unicode;
        let mut list: TagList =
            (first..=last).filter_map(char::from_u32).map(|c| self.tags.tag(&character_tag(c, unicode))).collect();
        list.sort_unstable();
        // The list is made once, and each later evaluation shares it.
        work::count(Work::Listed, list.len() as u64);
        let list = Arc::new(list);
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
    /// Shared, so that a cached range or an interned set is read without a
    /// copy.
    Set(Arc<TagList>),
}

impl Value {
    fn set(list: TagList) -> Value {
        Value::Set(Arc::new(list))
    }
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
#[derive(Clone)]
pub(crate) struct Frame<'c> {
    pub caps: Caps<'c>,
    pub prod: u32,
    pub origin: u32,
    pub end: u32,
    /// The constituent's tags, when known; otherwise its production's tag
    /// term gives them when they are first read (§4), and they are kept
    /// here, so that one step evaluates the term at most once. That saves
    /// time only: how many times the term runs is not observable.
    pub tags: Cell<Option<SetId>>,
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
            let cap = frame.caps.get(*slot);
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
        chart.caps.push(CapEntry { parent: 0, jump: 0, depth: 0, cap: Cap { start: 0, end: 0, tags: 0 } });
        chart.sets.push(ESet::default());
        self.predict(&mut chart, tokens, base, start, 0, false)?;
        let mut e = 0;
        while e < chart.sets.len() && (e == 0 || !chart.sets[e].items.is_empty()) {
            chart.reached = e;
            let mut head = 0;
            while head < chart.sets[e].queue.len() {
                let entry = chart.sets[e].queue[head];
                head += 1;
                let (k, again) = ((entry & !AGAIN) as usize, entry & AGAIN != 0);
                if let Some(processed) = chart.sets[e].processed.get_mut(k) {
                    *processed = true;
                }
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
                            let strict = synthetic
                                && item.dot == 0
                                && rule.helper
                                && rule.elided.is_some()
                                && !witness::fault(Fault::Route3);
                            let cap = Cap { start: e as u32, end: e as u32 + 1, tags };
                            self.advance(&mut chart, tokens, base, item, cap, e + 1, strict)?;
                        }
                    }
                    Sym::N(rule) => {
                        if !again {
                            chart.sets[e].waiting.entry(rule).or_default().push(k as u32);
                        }
                        let strict = chart.sets[e].is_strict(k);
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
            if target.is_strict(index) && !strict {
                target.strict[index] = false;
                // A fault leaves it as it was processed (tests/README.md).
                if target.processed[index] && !witness::fault(Fault::Reprocess) {
                    target.queue.push(index as u32 | AGAIN);
                }
            }
            return Ok(());
        }
        if target.failed.contains(&item) {
            return Ok(());
        }
        // The constituent's tags, where a condition of this step read them.
        let mut known = u32::MAX;
        let conds = production.conds_at(item.dot as usize);
        work::count(Work::Conditions, 1 + conds.len() as u64);
        if !conds.is_empty() {
            let search = CapSearch::new(chart, item.caps);
            let (observed, project) = self.observed(tokens);
            let frame = Frame {
                caps: Caps::Chart(&search),
                prod: item.prod,
                origin: item.origin,
                end: set as u32,
                tags: Cell::new(None),
                project,
            };
            let mut failed = false;
            for (cond, _) in conds {
                if !self.condition(cond, &frame, observed, base)? {
                    failed = true;
                    break;
                }
            }
            if failed {
                chart.sets[set].failed.insert(item);
                return Ok(());
            }
            known = frame.tags.get().unwrap_or(u32::MAX);
        }
        let target = &mut chart.sets[set];
        work::count(Work::Items, 1);
        let index = target.items.len() as u32;
        target.index.insert(item, index);
        target.items.push(item);
        // The tags that the conditions read, which completion reuses.
        target.tagset.push(known);
        target.enqueue(index, self.recon.is_some(), strict);
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
            if let (Some(Sym::T(terminal)), false) = (lowered.syms.first(), !lowered.conds_at(0).is_empty()) {
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
            // A fault restores without the test (tests/README.md).
            if !test_holds(test, std::slice::from_ref(token), self.shared.unicode, tags, token.tags)
                && !witness::fault(Fault::Restore)
            {
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
        work::count(Work::Items, 1);
        let index = target.items.len() as u32;
        target.index.insert(item, index);
        target.items.push(item);
        target.tagset.push(u32::MAX);
        target.enqueue(index, true, false);
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
        // A strict step that completes, route 3's read of T with nothing
        // after it, makes a strict item at the end of its production. The
        // step drops it before it evaluates anything (§4, §7.4; JS
        // earley.js, the written routes).
        if strict && item.dot as usize + 1 == production.syms.len() {
            return Ok(());
        }
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
        let caps =
            if production.cap_at[item.dot as usize].is_some() { chart.extend_caps(item.caps, cap) } else { item.caps };
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
        let (observed, project) = self.observed(tokens);
        let known = chart.sets[e].tagset[k];
        let tags = if known != u32::MAX {
            known
        } else {
            let search = CapSearch::new(chart, item.caps);
            let frame = Frame {
                caps: Caps::Chart(&search),
                prod: item.prod,
                origin: item.origin,
                end: e as u32,
                tags: Cell::new(None),
                project,
            };
            self.constituent_tags(&frame, observed, base)?
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
            let strict = empty && chart.sets[origin].is_strict(waiter as usize);
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
                let frame = Frame { tags: Cell::new(Some(0)), ..*frame };
                let list = self.set_term(term, &frame, tokens, base)?;
                self.shared.tags.set_shared(list)
            }
            None if production.syms.len() == 1 => {
                frame.caps.get(production.cap_at[0].expect("an implicit capture")).tags
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
        let tags = &self.shared.tags;
        let list = union_all(
            witnesses
                .iter()
                .zip(&eligible)
                .filter(|(_, &eligible)| eligible)
                .map(|(&(set, index), _)| tags.list(chart.sets[set as usize].tagset[index as usize])),
        );
        let accepted = eligible.contains(&true);
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

    /// The canonical sound of the span (§5). Runs of tokens without sound
    /// are skipped whole, as in a sound test.
    fn phonemes(&self, tokens: &[Tok], start: usize, end: usize) -> String {
        let mut sound = String::new();
        let mut at = start;
        while at < end {
            let token = &tokens[at];
            if token.quiet > 0 {
                at += token.quiet as usize;
                continue;
            }
            sound.push_str(token.sound(self.shared.unicode));
            at += 1;
        }
        sound
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
    ) -> Result<Arc<TagList>, EngineError> {
        Ok(match bounds {
            (_, _, Whose::Cap(set)) => self.shared.tags.shared(set),
            (_, _, Whose::Whole) => {
                let set = match frame.tags.get() {
                    Some(set) => set,
                    None => {
                        let set = self.constituent_tags(frame, tokens, base)?;
                        frame.tags.set(Some(set));
                        set
                    }
                };
                self.shared.tags.shared(set)
            }
            (start, end, Whose::Tokens) => {
                Arc::new(union_all(tokens[start..end].iter().map(|token| self.shared.tags.list(token.tags))))
            }
        })
    }

    /// A set's value. The reader has made sure that the types agree
    /// (§10), so a string never stands where a set is needed.
    fn as_set(value: Value) -> Result<Arc<TagList>, EngineError> {
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

    fn set_term(
        &mut self,
        term: &LTerm,
        frame: &Frame,
        tokens: &[Tok],
        base: usize,
    ) -> Result<Arc<TagList>, EngineError> {
        let value = self.term(term, frame, tokens, base)?;
        Self::as_set(value)
    }

    fn term(&mut self, term: &LTerm, frame: &Frame, tokens: &[Tok], base: usize) -> Result<Value, EngineError> {
        Ok(match term {
            LTerm::Str(text) => Value::Str(text.clone()),
            LTerm::Tag(tag) => Value::set(vec![self.shared.tags.tag(tag)]),
            LTerm::Range(first, last) => Value::Set(self.shared.range(*first, *last)),
            LTerm::Empty => Value::set(TagList::new()),
            LTerm::Union(items) => {
                let mut parts = Vec::with_capacity(items.len());
                for item in items {
                    parts.push(self.set_term(item, frame, tokens, base)?);
                }
                Value::set(union_all(parts.iter().map(|part| &**part)))
            }
            LTerm::Inter(items) => {
                let mut list: Option<Arc<TagList>> = None;
                for item in items {
                    let set = self.set_term(item, frame, tokens, base)?;
                    list = Some(match list {
                        None => set,
                        Some(list) => Arc::new(intersection(&list, &set)),
                    });
                }
                list.map_or_else(|| Value::set(TagList::new()), Value::Set)
            }
            LTerm::Diff(left, right) => {
                let left = self.set_term(left, frame, tokens, base)?;
                let right = self.set_term(right, frame, tokens, base)?;
                Value::set(difference(&left, &right))
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
                Value::set(list)
            }
            LTerm::TagOf(name) => {
                let name = self.string_term(name, frame, tokens, base)?;
                if !is_name(&name) {
                    return Err(EngineError {
                        message: format!("tag({name:?}): the string is not a name"),
                        rule: None,
                    });
                }
                Value::set(vec![self.shared.tags.tag(&name)])
            }
            LTerm::Tags(span) => {
                let bounds = span_bounds(span, frame, tokens.len());
                Value::Set(self.span_tags(bounds, frame, tokens, base)?)
            }
            LTerm::TagsRule(span, rule) => {
                let (start, end, _) = span_bounds(span, frame, tokens.len());
                let (_, set) = self.nested(tokens, base, start, end, *rule)?;
                Value::Set(self.shared.tags.shared(set))
            }
            LTerm::Classes(span) => {
                let bounds = span_bounds(span, frame, tokens.len());
                let list = self.span_tags(bounds, frame, tokens, base)?;
                Value::set(
                    list.iter()
                        .copied()
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
                Value::set(list)
            }
            // `t` is evaluated only where the guard holds (§10).
            LTerm::If(cond, then) => {
                if self.condition(cond, frame, tokens, base)? {
                    Value::Set(self.set_term(then, frame, tokens, base)?)
                } else {
                    Value::set(TagList::new())
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
                        is_subset(&*Self::as_set(left)?, &*Self::as_set(right)?) == (*op == CmpOp::Subset)
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
        Ok(self.shared.tags.set_shared(list))
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use crate::earley::{mark_quiet, matchers, sounds_like, Caps, Frame, Recognizer, Shared, Tok};
    use crate::lower::{LTerm, Span, Sym};
    use crate::work::{assert_linear, budget, counted, reset, Work};

    /// A sound test of each suffix of a run of tokens without sound steps
    /// through as many tokens as the sound is long, not the suffix.
    #[test]
    fn sound_tests_skip_tokens_without_sound() {
        let unicode = crate::unicode::Unicode::parse(crate::loader::bundled("unicode.txt").expect("the table"))
            .expect("the bundled table");
        for n in [1000, 4000] {
            let mut tokens: Vec<Tok> = (0..n)
                .map(|index| Tok {
                    text: "x".to_string(),
                    tags: 0,
                    phonemes: (index + 1 == n).then(|| "a".to_string()),
                    source: (index, index + 1),
                    label: "x".to_string(),
                    sound: Default::default(),
                    quiet: 0,
                    before: Vec::new(),
                    after: Vec::new(),
                })
                .collect();
            mark_quiet(&mut tokens, &unicode);
            reset();
            budget(Work::Sounded, 8 * n as u64);
            for start in 0..n {
                assert!(sounds_like(&tokens[start..], &unicode, "a"));
                assert!(sounds_like(&tokens[start..n - 1], &unicode, ""));
                assert!(!sounds_like(&tokens[start..], &unicode, ""));
            }
            let steps = counted(Work::Sounded);
            assert!(steps <= 8 * n as u64, "{steps} steps for {n} tokens");
        }
    }

    /// A union of many tags, and the tags of a span of many tokens, each
    /// with a tag of its own, cost about what they hold, not the square.
    #[test]
    fn unions_of_many_parts_cost_their_size() {
        let sources = [
            ("main.md", "```jbogenbau\n%ambiguity-resolution greedy\n%rule text 'a'\n```\n".to_string()),
            ("p.md", "```jbogenbau\n%stage main\n%include \"main.md\"\n```\n".to_string()),
        ];
        let dialect = crate::load_dialect_sources(sources, "p.md").expect("the dialect");
        let g = dialect.lowered_stage(0);
        let chars: Vec<char> = Vec::new();
        // The tokens and the terms are made apart, so that only their
        // evaluation is counted.
        let mut made: Vec<_> = [10_000usize, 40_000]
            .into_iter()
            .map(|n| {
                let mut shared = Shared::new(&dialect.unicode, &chars);
                // Names that share their first byte, which the table's hash
                // must still spread (fxhash.rs).
                let names: Vec<String> = (0..n).map(|index| format!("t{index}")).collect();
                let tokens: Vec<Tok> = names
                    .iter()
                    .map(|name| Tok {
                        text: "x".to_string(),
                        tags: shared.tags.set_of([name.as_str()]),
                        phonemes: None,
                        source: (0, 0),
                        label: "x".to_string(),
                        sound: Default::default(),
                        quiet: 0,
                        before: Vec::new(),
                        after: Vec::new(),
                    })
                    .collect();
                let tail = LTerm::Tags(Span::Tail(Box::new(Span::Whole)));
                let union = LTerm::Union(names.iter().map(|name| LTerm::Tag(name.clone())).collect());
                (n, shared, tokens, [tail, union])
            })
            .collect();
        assert_linear(Work::Listed, 10_000, &mut |n| {
            let (_, shared, tokens, terms) = made.iter_mut().find(|made| made.0 == n).expect("made");
            let matchers = matchers(&g, &mut shared.tags);
            let mut recognizer = Recognizer { g: &g, matchers: &matchers, shared, recon: None };
            let frame =
                Frame { caps: Caps::All(&[]), prod: 0, origin: 0, end: n as u32, tags: Cell::new(None), project: None };
            for _ in 0..20 {
                for term in terms.iter() {
                    let list = recognizer.set_term(term, &frame, tokens, 0).expect("a set");
                    assert!(list.len() + 1 >= n, "{} tags of {n}", list.len());
                }
            }
        });
    }

    /// A production of n captures with a condition at each finds the
    /// conditions of each dot without a scan of all n, so a parse of it
    /// looks at about n conditions, not n².
    #[test]
    fn each_dot_finds_its_conditions_at_once() {
        for n in [200usize, 800] {
            let names: Vec<String> = (0..n).map(|index| format!("$c{index}('a')")).collect();
            let conditions: Vec<String> = (0..n).map(|index| format!("text($c{index}) = \"a\"")).collect();
            let grammar = format!(
                "```jbogenbau\n%ambiguity-resolution greedy\n%rule text {}\n%conditions {}\n```\n",
                names.join(" "),
                conditions.join(", ")
            );
            let sources =
                [("g.md", grammar), ("p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string())];
            let dialect = crate::load_dialect_sources(sources, "p.md").expect("the dialect");
            reset();
            budget(Work::Conditions, 4 * n as u64 + 8);
            let result = dialect.parse(&"a".repeat(n), &crate::ParseOptions::default()).expect("a result");
            assert!(result.ok, "{n} captures");
            let steps = counted(Work::Conditions);
            // The next dialect's grammar is read with no budget.
            reset();
            assert!(steps <= 4 * n as u64 + 8, "{steps} conditions looked at for {n} captures");
        }
    }

    /// A range term evaluated again shares the list it made the first
    /// time, so n evaluations of a range of n characters cost about n.
    #[test]
    fn a_range_term_is_shared_not_copied() {
        let sources = [
            ("main.md", "```jbogenbau\n%ambiguity-resolution greedy\n%rule text 'a'\n```\n".to_string()),
            ("p.md", "```jbogenbau\n%stage main\n%include \"main.md\"\n```\n".to_string()),
        ];
        let dialect = crate::load_dialect_sources(sources, "p.md").expect("the dialect");
        let g = dialect.lowered_stage(0);
        let chars: Vec<char> = Vec::new();
        assert_linear(Work::Listed, 20_000, &mut |n| {
            let mut shared = Shared::new(&dialect.unicode, &chars);
            let matchers = matchers(&g, &mut shared.tags);
            let mut recognizer = Recognizer { g: &g, matchers: &matchers, shared: &mut shared, recon: None };
            let frame =
                Frame { caps: Caps::All(&[]), prod: 0, origin: 0, end: 0, tags: Cell::new(None), project: None };
            let range = LTerm::Range(0x4E00, 0x4E00 + n as u32 - 1);
            let first = recognizer.set_term(&range, &frame, &[], 0).expect("a set");
            assert!(first.len() > n / 2, "{} tags in a range of {n}", first.len());
            for _ in 1..n {
                let list = recognizer.set_term(&range, &frame, &[], 0).expect("a set");
                assert_eq!(list.len(), first.len());
            }
        });
    }

    /// The completed items of the production of `t` with two symbols, over
    /// the whole input of `n` tokens `A`, in the chart of a recognition of
    /// `text`.
    fn whole_items(rules: &str, n: usize) -> usize {
        let sources = [
            ("main.md", format!("```jbogenbau\n%ambiguity-resolution greedy\n{rules}\n```\n")),
            ("p.md", "```jbogenbau\n%stage main\n%include \"main.md\"\n```\n".to_string()),
        ];
        let dialect = crate::load_dialect_sources(sources, "p.md").expect("the dialect");
        let g = dialect.lowered_stage(0);
        let t = g.rules.iter().position(|rule| rule.name == "t" && !rule.helper).expect("t") as u32;
        let pair = g.prods.iter().position(|prod| prod.rule == t && prod.syms.len() == 2).expect("t's pair") as u32;
        let chars: Vec<char> = vec![' '; n * 2];
        let mut shared = Shared::new(&dialect.unicode, &chars);
        let input: Vec<Tok> = (0..n)
            .map(|index| Tok {
                text: "a".to_string(),
                tags: shared.tags.set_of(["A"]),
                phonemes: None,
                source: (index * 2, index * 2 + 1),
                label: "a".to_string(),
                sound: Default::default(),
                quiet: 0,
                before: Vec::new(),
                after: Vec::new(),
            })
            .collect();
        let matchers = matchers(&g, &mut shared.tags);
        let chart = Recognizer { g: &g, matchers: &matchers, shared: &mut shared, recon: None }
            .recognize(&input, 0, g.start)
            .expect("a chart");
        assert!(matches!(g.prods[pair as usize].syms[..], [Sym::N(_), Sym::N(_)]));
        chart.sets[n].items.iter().filter(|item| item.prod == pair && item.origin == 0 && item.dot == 2).count()
    }

    /// A captured part's span is part of an item's identity, so a capture
    /// of a rule that can end in many places keeps one completed item for
    /// each place, and the same production without captures keeps one
    /// (engine §4).
    #[test]
    fn a_capture_of_a_rule_with_many_ends_keeps_an_item_for_each() {
        for n in 2..=6 {
            assert_eq!(whole_items("%rule text t\n%rule t t t | A", n), 1, "t t over {n}");
            assert_eq!(whole_items("%rule text t\n%rule t $l(t) $r(t) | A", n), n - 1, "$l(t) $r(t) over {n}");
        }
    }

    /// A dialect of one grammar document `g.md`, written in a single block.
    fn single(rules: &str) -> crate::Dialect {
        let sources = [
            ("g.md", format!("```jbogenbau\n%ambiguity-resolution greedy\n{rules}\n```\n")),
            ("p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string()),
        ];
        crate::load_dialect_sources(sources, "p.md").expect("the dialect")
    }

    /// One production of C captures over C tokens: each item shares the
    /// captured parts of the item it advanced, so the recognizer makes C
    /// sequences of captured parts, not C² entries (engine §4). The tags,
    /// the condition and the derivation read them in a bounded number of
    /// walks, not one walk for each part.
    #[test]
    fn captures_share_their_prefixes() {
        for count in [100usize, 200, 400] {
            let names: Vec<String> = (0..count).map(|index| format!("$c{index}('a')")).collect();
            // A tag term that reads every capture, the first last.
            let tags: Vec<String> = (0..count).map(|index| format!("tags($c{})", count - 1 - index)).collect();
            let dialect = single(&format!(
                "%rule text {}\n%tags ~x ∪ {}\n%conditions text($c0) = \"a\"",
                names.join(" "),
                tags.join(" ∪ ")
            ));
            let (items, steps) = (2 * count as u64 + 4, 4 * count as u64 + 8);
            reset();
            budget(Work::Items, items);
            budget(Work::CaptureSteps, steps);
            let result = dialect.parse(&"a".repeat(count), &crate::ParseOptions::default()).expect("a result");
            assert!(result.ok, "{count} captures");
            assert_eq!(counted(Work::Captures), count as u64, "{count} captures");
            assert!(counted(Work::Items) <= items, "{} items for {count} captures", counted(Work::Items));
            assert!(counted(Work::CaptureSteps) <= steps, "{} steps for {count} captures", counted(Work::CaptureSteps));
            // The next dialect's grammar is read with no budget.
            reset();
        }
    }

    /// A condition at each capture of a long production reads the part it
    /// names without a walk of every part before it. The capture just made
    /// is the last part, and the first capture is a search by the jumps,
    /// whose steps grow with the logarithm of the parts (engine §4).
    #[test]
    fn conditions_at_each_capture_search_for_their_parts() {
        let steps = |count: usize, far: &dyn Fn(usize) -> String, most: u64| {
            let names: Vec<String> = (0..count).map(|index| format!("$c{index}('a')")).collect();
            let conditions: Vec<String> =
                (0..count).map(|index| format!("text($c{index}) = text({})", far(index))).collect();
            let dialect = single(&format!("%rule text {}\n%conditions {}", names.join(" "), conditions.join(", ")));
            reset();
            budget(Work::CaptureSteps, most);
            let result = dialect.parse(&"a".repeat(count), &crate::ParseOptions::default()).expect("a result");
            assert!(result.ok, "{count} captures");
            let steps = counted(Work::CaptureSteps);
            // The next dialect's grammar is read with no budget.
            reset();
            steps
        };
        for count in [100usize, 200, 400] {
            // A walk of every part before each would take some C²/2 steps,
            // past either budget.
            let near = 4 * count as u64 + 8;
            let first = (count as f64 * (2.0 * (count as f64).log2() + 4.0)) as u64;
            let read = steps(count, &|index| format!("$c{index}"), near);
            assert!(read <= near, "{read} steps for {count} captures read where they are made");
            let read = steps(count, &|_| "$c0".to_string(), first);
            assert!(read <= first, "{read} steps for {count} captures that each read the first");
        }
    }
}
