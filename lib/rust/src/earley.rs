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
use crate::work::{self, Mutant, Work};

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

    /// A search that goes on from what an earlier one had found.
    fn resume(chart: &'c Chart, id: u32, found: Option<Vec<Cap>>, searched: u32) -> CapSearch<'c> {
        let all = std::cell::OnceCell::new();
        if let Some(found) = found {
            let _ = all.set(found);
        }
        CapSearch { chart, id, all, searched: Cell::new(searched) }
    }

    /// What the search had found, which `resume` takes.
    fn into_parts(self) -> (Option<Vec<Cap>>, u32) {
        (self.all.into_inner(), self.searched.get())
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
    /// The place of an item in the set, by one lookup of its index.
    pub(crate) fn find(&self, item: &Item) -> Option<u32> {
        work::count(Work::Found, 1);
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
    /// The positions of the sets that hold each item, in order. Each item
    /// counts as it is examined.
    fn item_positions(&self) -> FxMap<Item, Vec<u32>> {
        let mut positions: FxMap<Item, Vec<u32>> = FxMap::default();
        for (at, eset) in self.sets.iter().enumerate() {
            for item in &eset.items {
                work::count(Work::Walked, 1);
                positions.entry(*item).or_default().push(at as u32);
            }
        }
        positions
    }

    /// The origins `m`, in order, of the derivations of an item that reads
    /// its constituent of `rule` last, from `pred`, the item before that
    /// read, to `set`: the positions from `from` on whose set holds `pred`
    /// and where a constituent of `rule` that ends at `set` begins. It looks
    /// at the shorter of the two lists, so that rebuilding the derivations
    /// of a deep nesting, where every rule ends at one place, costs each
    /// item its own few origins, not every origin at that place.
    pub(crate) fn origins_between(&self, pred: &Item, rule: u32, from: u32, set: u32) -> Vec<u32> {
        // A mutation of the tests builds the positions again at each call.
        let rebuilt;
        let positions = if work::mutated(Mutant::PositionsPerCall) {
            rebuilt = self.item_positions();
            &rebuilt
        } else {
            self.positions.get_or_init(|| self.item_positions())
        };
        let held = positions.get(pred).map_or(&[][..], Vec::as_slice);
        let held = &held[held.partition_point(|&m| m < from)..held.partition_point(|&m| m <= set)];
        let eset = &self.sets[set as usize];
        let ending = eset.origins.get(&rule).map_or(&[][..], Vec::as_slice);
        // The call counts once, and each origin counts as it is examined.
        work::count(Work::Walked, 1);
        let examined = |m: &u32| {
            work::count(Work::Walked, 1);
            *m
        };
        let shorter = held.len() <= ending.len() && !work::mutated(Mutant::WalkEnding);
        let mut found: Vec<u32> = if shorter {
            held.iter().map(examined).filter(|&m| eset.completed.contains_key(&(rule, m))).collect()
        } else {
            ending.iter().map(examined).filter(|&m| m >= from && held.binary_search(&m).is_ok()).collect()
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
            // Each step counts as it is taken, so that a budget stops a
            // long walk at once.
            work::count(Work::CaptureSteps, 1);
            let entry = self.caps[id as usize];
            out.push(entry.cap);
            id = entry.parent;
        }
        out.reverse();
        out
    }

    /// The part in one slot of a sequence, found from its last part by the
    /// jumps, and the number of steps that took.
    fn cap_at(&self, mut id: u32, slot: u32) -> (Cap, u32) {
        let mut steps = 0;
        while self.caps[id as usize].depth > slot + 1 {
            work::count(Work::CaptureSteps, 1);
            let entry = self.caps[id as usize];
            id = if self.caps[entry.jump as usize].depth > slot { entry.jump } else { entry.parent };
            steps += 1;
        }
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
        // A mutation of the tests stores the prefix again, where the
        // recognizer shares it.
        #[cfg(test)]
        let stored = if tests::COPY_PREFIXES.with(Cell::get) { self.copy_caps(parent) } else { parent };
        #[cfg(not(test))]
        let stored = parent;
        let id = self.push_caps(stored, cap);
        self.caps_index.insert((parent, cap), id);
        id
    }

    /// A mutation for the tests of storage: a copy of a sequence, each of
    /// its parts stored again, where the recognizer shares it.
    #[cfg(test)]
    fn copy_caps(&mut self, id: u32) -> u32 {
        let mut parts = Vec::new();
        let mut at = id;
        while at != 0 {
            parts.push(self.caps[at as usize].cap);
            at = self.caps[at as usize].parent;
        }
        parts.into_iter().rev().fold(0, |copy, cap| self.push_caps(copy, cap))
    }

    /// Stores the sequence that extends `parent` by one part. Each entry
    /// counts as it is stored, so that a budget of storage stops at once.
    fn push_caps(&mut self, parent: u32, cap: Cap) -> u32 {
        work::count(Work::Captures, 1);
        let id = self.caps.len() as u32;
        let before = self.caps[parent as usize];
        let above = self.caps[before.jump as usize];
        let jump = if before.depth - above.depth == above.depth - self.caps[above.jump as usize].depth {
            above.jump
        } else {
            parent
        };
        self.caps.push(CapEntry { parent, jump, depth: before.depth + 1, cap });
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
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
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
        // The list is made once, and each later evaluation shares it. Each
        // tag counts as it is made.
        let mut list: TagList = (first..=last)
            .filter_map(char::from_u32)
            .map(|c| {
                work::count(Work::Listed, 1);
                self.tags.tag(&character_tag(c, unicode))
            })
            .collect();
        list.sort_unstable();
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

/// Why an evaluation stopped short: an error of the grammar, or a nested
/// parse whose answer is not yet known. The recognizer then parses that
/// span on a stack of its own, so that a chain of nested parses costs heap
/// and not the call stack. The evaluation keeps its frames, and goes on
/// from where it halted once the answer is known (`Eval`).
#[derive(Debug)]
pub(crate) enum Halt<'t> {
    Error(EngineError),
    Pending(Request<'t>),
}

impl From<EngineError> for Halt<'_> {
    fn from(error: EngineError) -> Self {
        Halt::Error(error)
    }
}

/// A nested parse that an evaluation needs: `tokens[start..end]` as `rule`,
/// for `matches` and `tags` or for `begins`, with the key its answer is
/// remembered by.
#[derive(Debug)]
pub(crate) struct Request<'t> {
    tokens: &'t [Tok],
    base: usize,
    start: usize,
    end: usize,
    rule: u32,
    key: NestedKey,
    begins: bool,
}

impl Request<'_> {
    fn place(&self) -> Place {
        (self.rule, self.base + self.start, self.base + self.end)
    }
}

/// A nested query's answer: whether its span parses as its rule, and the
/// union of the tags of its derivations.
type Answer = (bool, SetId);

/// What a node of a condition or a term gives, or a whole evaluation of a
/// production's tag term for its constituent.
enum Out {
    Bool(bool),
    Value(Value),
    Tags(SetId),
}

impl Out {
    fn holds(self) -> bool {
        match self {
            Out::Bool(holds) => holds,
            _ => unreachable!("a condition gives a truth value"),
        }
    }

    fn value(self) -> Value {
        match self {
            Out::Value(value) => value,
            _ => unreachable!("a term gives a value"),
        }
    }

    fn constituent(self) -> SetId {
        match self {
            Out::Tags(set) => set,
            _ => unreachable!("a tag term gives a constituent's tags"),
        }
    }
}

/// Takes the value of the part that was evaluated last.
fn took(last: &mut Option<Out>) -> Out {
    last.take().expect("the value of a part")
}

/// The kind of a nested query, which says what its answer gives.
#[derive(Debug, Clone, Copy)]
enum Query {
    Matches,
    Begins,
    TagsRule,
}

impl Query {
    fn out(self, (holds, set): Answer, tags: &Tags) -> Out {
        match self {
            Query::Matches | Query::Begins => Out::Bool(holds),
            Query::TagsRule => Out::Value(Value::Set(tags.shared(set))),
        }
    }
}

/// What the tags of `$` are found for: a `tags` term, a `classes` term,
/// or the step that completes the constituent.
#[derive(Debug, Clone, Copy)]
enum Wanted {
    Tags,
    Classes,
    Step,
}

/// One frame of an evaluation: a node to visit, or a compound node that
/// waits for the value of its part, with what it has so far.
enum Task<'n> {
    Cond(&'n LCond),
    Term(&'n LTerm),
    /// The conditions of a step, which all must hold, from `next` on.
    Conds(&'n [(LCond, usize)], usize),
    Not,
    /// The parts of `∨` from `next` on.
    Any(&'n [LCond], usize),
    /// The parts of `∧` from `next` on.
    All(&'n [LCond], usize),
    /// The consequent of `⟹`, which its antecedent's value decides on.
    Implies(&'n LCond),
    /// A comparison that has its left side to evaluate next.
    Left(CmpOp, &'n LTerm),
    /// A comparison with its left side's value.
    Right(CmpOp, Value),
    /// A union with the sets of its parts so far.
    Union(&'n [LTerm], Vec<Arc<TagList>>),
    /// An intersection from `next` on, with the intersection so far.
    Inter(&'n [LTerm], usize, Option<Arc<TagList>>),
    DiffLeft(&'n LTerm),
    DiffRight(Arc<TagList>),
    /// `split` with its delimiter to evaluate next.
    Split(&'n LTerm),
    /// `split` with the string's value.
    SplitBy(String),
    TagOf,
    Classify(&'n str),
    /// The term of `⟹` in a term, which its guard's value decides on.
    Guarded(&'n LTerm),
    /// A term whose value must be a set.
    AsSet,
    /// The tag term of `$`'s production, evaluated for `$`'s tags.
    Whole(Wanted),
    /// A query that halted the evaluation, which its answer resumes.
    Await(Query),
}

/// An evaluation of a step's conditions or of a tag term, as a stack of
/// frames, so that a query whose answer is not yet known can halt it and
/// its answer can resume it where it halted (§4). Nothing it evaluated is
/// evaluated again.
struct Eval<'n> {
    tasks: Vec<Task<'n>>,
    /// Whether the tag term of `$`'s own production is being evaluated,
    /// which reads `$`'s tags as empty (§9).
    hidden: bool,
    /// The answer to the query that halted the evaluation.
    answer: Option<Answer>,
}

impl<'n> Eval<'n> {
    /// The evaluation of a step's conditions, which are not empty, on
    /// `tasks`, an empty stack whose room it reuses.
    fn conditions(conds: &'n [(LCond, usize)], mut tasks: Vec<Task<'n>>) -> Eval<'n> {
        tasks.push(Task::Conds(conds, 1));
        tasks.push(Task::Cond(&conds[0].0));
        Eval { tasks, hidden: false, answer: None }
    }

    /// The evaluation of a production's tag term, for its constituent's
    /// tags, on `tasks`, an empty stack whose room it reuses.
    fn constituent(term: &'n LTerm, mut tasks: Vec<Task<'n>>) -> Eval<'n> {
        tasks.push(Task::Whole(Wanted::Step));
        tasks.push(Task::Term(term));
        Eval { tasks, hidden: true, answer: None }
    }

    /// The evaluation of a term whose value must be a set.
    fn term(term: &'n LTerm) -> Eval<'n> {
        Eval { tasks: vec![Task::AsSet, Task::Term(term)], hidden: false, answer: None }
    }

    /// Pushes a frame that waits for a part, then the part's.
    fn push(&mut self, then: Task<'n>, part: Task<'n>) {
        self.tasks.push(then);
        self.tasks.push(part);
    }
}

/// The evaluations of a run's steps: the one that halted, if one did, and
/// an empty stack of frames whose room the next evaluation reuses.
#[derive(Default)]
struct Evals<'g> {
    held: Option<Held<'g>>,
    spare: Vec<Task<'g>>,
}

/// A step's evaluation that halted, kept by the run while the query's
/// parse runs: the item the evaluation is of, the set it is evaluated in,
/// whether the step is strict, and what its frame had found. The frame
/// reads the chart, which the run owns, so it is made again from these.
struct Held<'g> {
    eval: Eval<'g>,
    item: Item,
    end: u32,
    strict: bool,
    /// The constituent's tags, if the evaluation found them.
    tags: Option<SetId>,
    /// The parts that the frame's search of the captured parts read in
    /// one walk, and the steps its searches took (`CapSearch`).
    found: Option<Vec<Cap>>,
    searched: u32,
}

impl<'g> Held<'g> {
    /// An evaluation over `item` in the set `end`, which has found nothing yet.
    fn new(eval: Eval<'g>, item: Item, end: usize, strict: bool) -> Held<'g> {
        Held { eval, item, end: end as u32, strict, tags: None, found: None, searched: 0 }
    }

    /// The frame of the evaluation, over the captured parts of `search`.
    fn frame<'c>(&self, search: &'c CapSearch<'c>, project: Option<&'c [u32]>) -> Frame<'c> {
        Frame {
            caps: Caps::Chart(search),
            prod: self.item.prod,
            origin: self.item.origin,
            end: self.end,
            tags: Cell::new(self.tags),
            project,
        }
    }

    /// Keeps what the frame had found when the evaluation halted.
    fn keep(&mut self, tags: Option<SetId>, search: CapSearch) {
        self.tags = tags;
        (self.found, self.searched) = search.into_parts();
    }
}

/// What a recognition does next. A step that halts for a nested parse
/// keeps its place here, and its evaluation in the run's `evals`. When the
/// answer is known, the step goes on with that evaluation, where it halted.
enum Step {
    /// Take the next entry of the queue.
    Next,
    /// Predict `rule` in set `e`, from the production `next` on.
    Predict { rule: u32, e: usize, strict: bool, before: Option<bool>, next: usize, then: Then },
    /// Advance `item` over the empty constituents found in set `e`, from
    /// the one at `next` on.
    Empties { item: Item, e: usize, strict: bool, empties: Vec<SetId>, next: usize },
    /// Advance `item` over a token.
    Terminal { item: Item, cap: Cap, into: usize, strict: bool },
    /// Complete the item `k` of set `e`.
    Complete { e: usize, k: usize },
    /// Advance the items that wait at `origin` for a constituent of `rule`
    /// that ends at `e`, from the waiter at `next` on.
    Waiters { e: usize, origin: usize, rule: u32, tags: SetId, empty: bool, count: usize, next: usize },
}

/// What follows a prediction: the queue, or for an item before a rule,
/// its advance over the rule's empty constituents unless `skip`.
#[derive(Clone, Copy)]
enum Then {
    Queue,
    Empties { item: Item, rule: u32, strict: bool, skip: bool },
}

/// One recognition in progress: its tokens, its chart so far, where its
/// queue stands, and the nested parse it answers, if it is one.
struct Run<'t, 'g> {
    tokens: &'t [Tok],
    base: usize,
    recon: Option<&'g Recon<'g>>,
    chart: Chart,
    e: usize,
    head: usize,
    /// Whether the set `e` has been entered, and the chart reaches it.
    entered: bool,
    step: Step,
    /// The evaluation of the step that halted, which the answer resumes,
    /// and the room that evaluations reuse.
    evals: Evals<'g>,
    request: Option<Request<'t>>,
}

impl<'t, 'g> Run<'t, 'g> {
    fn new(tokens: &'t [Tok], base: usize, start: u32, recon: Option<&'g Recon<'g>>) -> Run<'t, 'g> {
        let mut chart = Chart::default();
        chart.caps.push(CapEntry { parent: 0, jump: 0, depth: 0, cap: Cap { start: 0, end: 0, tags: 0 } });
        chart.sets.push(ESet::default());
        // The first step predicts the start rule in a set that holds
        // nothing yet, as `begin_predict` would begin it.
        chart.sets[0].predicted.insert(start, false);
        let step = Step::Predict { rule: start, e: 0, strict: false, before: None, next: 0, then: Then::Queue };
        Run { tokens, base, recon, chart, e: 0, head: 0, entered: false, step, evals: Evals::default(), request: None }
    }

    /// The recognition that answers `request`: its span alone, with its
    /// rule as the start rule, in the ordinary mode (§7.6).
    fn answering(request: Request<'t>) -> Run<'t, 'g> {
        let tokens = &request.tokens[request.start..request.end];
        let mut run = Run::new(tokens, request.base + request.start, request.rule, None);
        run.request = Some(request);
        run
    }
}

impl<'g, 's, 'a> Recognizer<'g, 's, 'a> {
    /// Recognizes `tokens` (which start at `base` in the stage's input) with
    /// `start` as the start rule. A set is made when an item first reaches
    /// it, and once one is empty every later one is: the chart stops there,
    /// so a nested parse over the rest of a long text makes only the sets it
    /// reaches.
    pub(crate) fn recognize(&mut self, tokens: &[Tok], base: usize, start: u32) -> Result<Chart, EngineError> {
        Ok(self.drive(Run::new(tokens, base, start, self.recon))?.0)
    }

    /// Runs a recognition and the nested parses it needs, each on a stack
    /// of runs, not of calls. A run that halts for a nested parse waits
    /// below the run that answers it, and then goes on with the answer.
    /// The root's chart comes back, with its answer if it answers a query.
    fn drive<'t>(&mut self, root: Run<'t, 'g>) -> Result<(Chart, Option<Answer>), EngineError>
    where
        'g: 't,
    {
        let recon = self.recon;
        let mut runs = vec![root];
        let outcome = loop {
            let run = runs.last_mut().expect("a run");
            self.recon = run.recon;
            match self.resume(run) {
                Ok(()) => {
                    let Run { request, chart, .. } = runs.pop().expect("a run");
                    let answer = request.map(|request| {
                        self.shared.running.remove(&request.place());
                        self.settle(request, &chart)
                    });
                    match runs.last_mut() {
                        None => break Ok((chart, answer)),
                        Some(waiting) => {
                            let held = waiting.evals.held.as_mut().expect("the evaluation that asked");
                            held.eval.answer = answer;
                        }
                    }
                }
                Err(Halt::Error(error)) => break Err(error),
                Err(Halt::Pending(request)) => match self.start_query(&request) {
                    Ok(()) => runs.push(Run::answering(request)),
                    Err(error) => break Err(error),
                },
            }
        };
        // A parse that failed frees its place, as one that finished does.
        for run in &runs {
            if let Some(request) = &run.request {
                self.shared.running.remove(&request.place());
            }
        }
        self.recon = recon;
        outcome
    }

    /// Marks the place of a nested parse as running. A parse that is
    /// running is known by its place, whatever the kind of query that
    /// started it, so that alternating `matches`, `begins` and `tags`
    /// cannot hide a query about a span from inside its own parse (§4).
    fn start_query(&mut self, request: &Request) -> Result<(), EngineError> {
        if self.shared.running.insert(request.place()) {
            return Ok(());
        }
        let text = self.text(request.tokens, request.start, request.end);
        let name = &self.g.rules[request.rule as usize].name;
        Err(EngineError {
            message: format!(
                "a condition asks whether {text:?} parses as {name} from inside the parse of that span as {name}: \
                 the grammar defines {name} in terms of itself over the same text"
            ),
            rule: Some(request.rule),
        })
    }

    /// Answers a nested parse outside any recognition, as emission needs.
    fn answer(&mut self, request: Request) -> Result<Answer, EngineError> {
        self.start_query(&request)?;
        Ok(self.drive(Run::answering(request))?.1.expect("an answer"))
    }

    /// Remembers the answer of a nested parse from its chart. The chart
    /// stops at its first empty set, which may lie before the span's end.
    /// Only the items with an eligible proof tree count.
    fn settle(&mut self, request: Request, chart: &Chart) -> Answer {
        let rule = request.rule;
        let tokens = &request.tokens[request.start..request.end];
        if request.begins {
            // A completed item from the span's start, in any set, with an
            // eligible proof tree (§4).
            let witnesses: Vec<(u32, u32)> = (0..chart.sets.len())
                .flat_map(|set| {
                    chart.sets[set]
                        .completed
                        .get(&(rule, 0))
                        .into_iter()
                        .flatten()
                        .map(move |&index| (set as u32, index))
                })
                .collect();
            let answer = self.proofs(chart, tokens).eligible(&witnesses).contains(&true);
            self.shared.begins.insert(request.key, answer);
            return (answer, 0);
        }
        let set = tokens.len() as u32;
        let witnesses: Vec<(u32, u32)> = chart
            .sets
            .get(set as usize)
            .and_then(|last| last.completed.get(&(rule, 0)))
            .into_iter()
            .flatten()
            .map(|&index| (set, index))
            .collect();
        let eligible = self.proofs(chart, tokens).eligible(&witnesses);
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
        self.shared.memo.insert(request.key, answer);
        answer
    }

    /// Goes on with a run until it finishes or halts. A step that halts
    /// keeps its place in `run.step`, and its evaluation in `run.evals`.
    fn resume<'t>(&mut self, run: &mut Run<'t, 'g>) -> Result<(), Halt<'t>>
    where
        'g: 't,
    {
        let (tokens, base) = (run.tokens, run.base);
        loop {
            match &mut run.step {
                Step::Next => {
                    if !self.next_entry(run) {
                        return Ok(());
                    }
                }
                Step::Predict { rule, e, strict, before, next, then } => {
                    let (rule, e, then) = (*rule, *e, *then);
                    self.predict_from(&mut run.chart, &mut run.evals, tokens, base, rule, e, *strict, *before, next)?;
                    run.step = match then {
                        Then::Queue | Then::Empties { skip: true, .. } => Step::Next,
                        Then::Empties { item, rule, strict, skip: false } => {
                            let empties = run.chart.sets[e].empty.get(&rule).cloned().unwrap_or_default();
                            Step::Empties { item, e, strict, empties, next: 0 }
                        }
                    };
                }
                Step::Empties { item, e, strict, empties, next } => {
                    while let Some(&tags) = empties.get(*next) {
                        let cap = Cap { start: *e as u32, end: *e as u32, tags };
                        self.advance(&mut run.chart, &mut run.evals, tokens, base, *item, cap, *e, *strict)?;
                        *next += 1;
                    }
                    run.step = Step::Next;
                }
                Step::Terminal { item, cap, into, strict } => {
                    self.advance(&mut run.chart, &mut run.evals, tokens, base, *item, *cap, *into, *strict)?;
                    run.step = Step::Next;
                }
                Step::Complete { e, k } => {
                    let (e, k) = (*e, *k);
                    let tags = self.complete_tags(&run.chart, &mut run.evals, tokens, base, e, k)?;
                    run.step = self.complete(&mut run.chart, e, k, tags);
                }
                Step::Waiters { e, origin, rule, tags, empty, count, next } => {
                    while *next < *count {
                        let chart = &run.chart;
                        let waiter = chart.sets[*origin].waiting[&*rule][*next];
                        let waiting = chart.sets[*origin].items[waiter as usize];
                        // A strict item advances over an empty constituent
                        // only where a later symbol can read, and stays
                        // strict (§7.4).
                        let strict = *empty && chart.sets[*origin].is_strict(waiter as usize);
                        if !strict || self.reads_later(waiting) {
                            let cap = Cap { start: *origin as u32, end: *e as u32, tags: *tags };
                            self.advance(&mut run.chart, &mut run.evals, tokens, base, waiting, cap, *e, strict)?;
                        }
                        *next += 1;
                    }
                    run.step = Step::Next;
                }
            }
        }
    }

    /// Takes the next entry of the queue, from the next set once one is
    /// done, and makes its step: false when the recognition is over.
    fn next_entry(&mut self, run: &mut Run) -> bool {
        let chart = &mut run.chart;
        loop {
            let e = run.e;
            if !run.entered {
                if e >= chart.sets.len() || (e != 0 && chart.sets[e].items.is_empty()) {
                    return false;
                }
                chart.reached = e;
                run.entered = true;
            }
            if run.head == chart.sets[e].queue.len() {
                run.e += 1;
                run.head = 0;
                run.entered = false;
                continue;
            }
            let entry = chart.sets[e].queue[run.head];
            run.head += 1;
            let (k, again) = ((entry & !AGAIN) as usize, entry & AGAIN != 0);
            if let Some(processed) = chart.sets[e].processed.get_mut(k) {
                *processed = true;
            }
            let item = chart.sets[e].items[k];
            let g = self.g;
            let production = &g.prods[item.prod as usize];
            if item.dot as usize == production.syms.len() {
                run.step = Step::Complete { e, k };
                return true;
            }
            match production.syms[item.dot as usize] {
                Sym::T(terminal) => {
                    let tokens = run.tokens;
                    if e < tokens.len() && self.shared.reads(self.matchers[terminal as usize], tokens[e].tags) {
                        // A terminal that reads a synthetic token captures
                        // no tags (§7.5).
                        let synthetic = self.recon.is_some_and(|recon| recon.synthetic[e]);
                        let tags = if synthetic { self.shared.tags.set(TagList::new()) } else { tokens[e].tags };
                        // The written route of an elidable optional from a
                        // synthetic token: the rest of the optional must
                        // read, so the item after it is strict (§7.4).
                        let rule = &g.rules[production.rule as usize];
                        let strict = synthetic
                            && item.dot == 0
                            && rule.helper
                            && rule.elided.is_some()
                            && !witness::fault(Fault::Route3);
                        let cap = Cap { start: e as u32, end: e as u32 + 1, tags };
                        run.step = Step::Terminal { item, cap, into: e + 1, strict };
                        return true;
                    }
                }
                Sym::N(rule) => {
                    if !again {
                        chart.sets[e].waiting.entry(rule).or_default().push(k as u32);
                    }
                    let strict = chart.sets[e].is_strict(k);
                    // A strict item predicts its next symbol strictly where
                    // no symbol after it can read, and it advances over an
                    // empty constituent only where one can (§7.4).
                    let later = self.reads_later(item);
                    let only = strict && !later;
                    let then = Then::Empties { item, rule, strict, skip: only };
                    run.step = match Self::begin_predict(chart, rule, e, only) {
                        Some(before) => Step::Predict { rule, e, strict: only, before, next: 0, then },
                        None if only => Step::Next,
                        None => {
                            let empties = chart.sets[e].empty.get(&rule).cloned().unwrap_or_default();
                            Step::Empties { item, e, strict, empties, next: 0 }
                        }
                    };
                    return true;
                }
            }
        }
    }

    /// Whether a symbol after an item's next symbol can read in the
    /// reconstruction mode (§7.4).
    fn reads_later(&self, item: Item) -> bool {
        self.g.reads_until[item.prod as usize] > item.dot + 1
    }

    /// Adds an item to a set, made by a step that is strict or not (§7.4).
    #[allow(clippy::too_many_arguments)]
    fn add<'t>(
        &mut self,
        chart: &mut Chart,
        evals: &mut Evals<'g>,
        tokens: &'t [Tok],
        base: usize,
        item: Item,
        set: usize,
        strict: bool,
    ) -> Result<(), Halt<'t>>
    where
        'g: 't,
    {
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
        work::count(Work::Found, 1);
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
        // The item counts once, and its selection counts each condition it
        // examines.
        work::count(Work::Conditions, 1);
        let conds = production.conds_at(item.dot as usize);
        if conds.is_empty() {
            Self::insert(chart, item, set, strict, u32::MAX, self.recon.is_some());
            return Ok(());
        }
        let state = Held::new(Eval::conditions(conds, std::mem::take(&mut evals.spare)), item, set, strict);
        self.conditions(chart, evals, tokens, base, state)
    }

    /// Evaluates the conditions of an item, from where `state` halted, and
    /// adds the item if they hold. A query whose answer is not yet known
    /// halts them again, and `held` keeps them.
    fn conditions<'t>(
        &mut self,
        chart: &mut Chart,
        evals: &mut Evals<'g>,
        tokens: &'t [Tok],
        base: usize,
        mut state: Held<'g>,
    ) -> Result<(), Halt<'t>>
    where
        'g: 't,
    {
        let (observed, project) = self.observed(tokens);
        let search = CapSearch::resume(chart, state.item.caps, state.found.take(), state.searched);
        let frame = state.frame(&search, project);
        let outcome = self.evaluate(&mut state.eval, &frame, observed, base);
        let (item, set) = (state.item, state.end as usize);
        let holds = match outcome {
            Ok(out) => out.holds(),
            Err(halt) => {
                if matches!(halt, Halt::Pending(_)) {
                    state.keep(frame.tags.get(), search);
                    evals.held = Some(state);
                }
                return Err(halt);
            }
        };
        evals.spare = state.eval.tasks;
        if !holds {
            chart.sets[set].failed.insert(item);
            return Ok(());
        }
        // The constituent's tags, where a condition of this step read them.
        let known = frame.tags.get().unwrap_or(u32::MAX);
        Self::insert(chart, item, set, state.strict, known, self.recon.is_some());
        Ok(())
    }

    /// Puts a new item into a set, with the tags of its constituent if the
    /// conditions read them, which completion reuses.
    fn insert(chart: &mut Chart, item: Item, set: usize, strict: bool, known: SetId, recon: bool) {
        let target = &mut chart.sets[set];
        work::count(Work::Items, 1);
        let index = target.items.len() as u32;
        target.index.insert(item, index);
        target.items.push(item);
        target.tagset.push(known);
        target.enqueue(index, recon, strict);
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

    /// Begins the prediction of `rule` in set `e`: what the set held of it
    /// before, or `None` when the prediction adds nothing. A rule's
    /// productions are the same at every prediction in one set. A strict
    /// prediction leaves some out, so an ordinary one after it adds them
    /// (§7.4).
    fn begin_predict(chart: &mut Chart, rule: u32, e: usize, strict: bool) -> Option<Option<bool>> {
        let before = chart.sets[e].predicted.get(&rule).copied();
        if before == Some(false) || (before == Some(true) && strict) {
            return None;
        }
        chart.sets[e].predicted.insert(rule, strict);
        Some(before)
    }

    /// Predicts the productions of `rule` from the one at `next` on, which
    /// stays at the production whose item halted.
    #[allow(clippy::too_many_arguments)]
    fn predict_from<'t>(
        &mut self,
        chart: &mut Chart,
        evals: &mut Evals<'g>,
        tokens: &'t [Tok],
        base: usize,
        rule: u32,
        e: usize,
        strict: bool,
        before: Option<bool>,
        next: &mut usize,
    ) -> Result<(), Halt<'t>>
    where
        'g: 't,
    {
        let g = self.g;
        let helper = &g.rules[rule as usize];
        while let Some(&production) = helper.prods.get(*next) {
            // Each production counts as the prediction looks at it, also one
            // that it skips.
            work::count(Work::Found, 1);
            self.predict_one(chart, evals, tokens, base, rule, production, e, strict, before)?;
            *next += 1;
        }
        Ok(())
    }

    /// Predicts one production of `rule` in set `e`, or goes on with the
    /// conditions of its item where they halted.
    #[allow(clippy::too_many_arguments)]
    fn predict_one<'t>(
        &mut self,
        chart: &mut Chart,
        evals: &mut Evals<'g>,
        tokens: &'t [Tok],
        base: usize,
        rule: u32,
        production: u32,
        e: usize,
        strict: bool,
        before: Option<bool>,
    ) -> Result<(), Halt<'t>>
    where
        'g: 't,
    {
        if let Some(state) = evals.held.take() {
            return self.conditions(chart, evals, tokens, base, state);
        }
        let g = self.g;
        let helper = &g.rules[rule as usize];
        let lowered = &g.prods[production as usize];
        // In the reconstruction mode, the empty production of an elidable
        // optional is its restoration, and it never derives the empty
        // sequence (§7.4).
        if let (Some(recon), true, true, Some(terminal)) =
            (self.recon, lowered.syms.is_empty(), helper.helper, &helper.elided)
        {
            self.restore(chart, tokens, recon, production, terminal, helper.elided_test, e);
            return Ok(());
        }
        // A strict prediction predicts only the productions that can read.
        if strict && g.reads_until[production as usize] == 0 {
            return Ok(());
        }
        // A production that must first read a terminal the next token lacks
        // gives a dead item, so prediction skips it. The set records it, and
        // the rejection report adds back the terminal it expected.
        if let (Some(Sym::T(terminal)), false) = (lowered.syms.first(), lowered.has_conds_at(0)) {
            let matcher = self.matchers[*terminal as usize];
            if e >= tokens.len() || !self.shared.reads(matcher, tokens[e].tags) {
                if before.is_none() {
                    chart.sets[e].skipped.push(production);
                }
                return Ok(());
            }
        }
        self.add(chart, evals, tokens, base, Item { prod: production, dot: 0, origin: e as u32, caps: 0 }, e, strict)
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
        work::count(Work::Found, 1);
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

    /// Advances an item over a constituent or a token, or goes on with the
    /// conditions of the advanced item where they halted.
    #[allow(clippy::too_many_arguments)]
    fn advance<'t>(
        &mut self,
        chart: &mut Chart,
        evals: &mut Evals<'g>,
        tokens: &'t [Tok],
        base: usize,
        item: Item,
        cap: Cap,
        into: usize,
        strict: bool,
    ) -> Result<(), Halt<'t>>
    where
        'g: 't,
    {
        if let Some(state) = evals.held.take() {
            return self.conditions(chart, evals, tokens, base, state);
        }
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
        self.add(chart, evals, tokens, base, next, into, strict)
    }

    /// The tags of the completed item `k` of set `e`: those its conditions
    /// read, or its constituent's (§4), from where their evaluation halted
    /// if it did.
    fn complete_tags<'t>(
        &mut self,
        chart: &Chart,
        evals: &mut Evals<'g>,
        tokens: &'t [Tok],
        base: usize,
        e: usize,
        k: usize,
    ) -> Result<SetId, Halt<'t>>
    where
        'g: 't,
    {
        let mut state = match evals.held.take() {
            Some(state) => state,
            None => {
                let known = chart.sets[e].tagset[k];
                if known != u32::MAX {
                    return Ok(known);
                }
                let item = chart.sets[e].items[k];
                let g = self.g;
                let Some(term) = &g.prods[item.prod as usize].tags else {
                    let search = CapSearch::new(chart, item.caps);
                    return Ok(self.plain_tags(&Caps::Chart(&search), item.prod));
                };
                Held::new(Eval::constituent(term, std::mem::take(&mut evals.spare)), item, e, false)
            }
        };
        let (observed, project) = self.observed(tokens);
        let search = CapSearch::resume(chart, state.item.caps, state.found.take(), state.searched);
        let frame = state.frame(&search, project);
        match self.evaluate(&mut state.eval, &frame, observed, base) {
            Ok(out) => {
                evals.spare = state.eval.tasks;
                Ok(out.constituent())
            }
            Err(halt) => {
                if matches!(halt, Halt::Pending(_)) {
                    state.keep(frame.tags.get(), search);
                    evals.held = Some(state);
                }
                Err(halt)
            }
        }
    }

    /// Records the completed item `k` of set `e`, whose constituent has
    /// `tags`, and gives the step that advances the items waiting for it,
    /// if a constituent of its rule, origin and tags is new here.
    fn complete(&self, chart: &mut Chart, e: usize, k: usize, tags: SetId) -> Step {
        let item = chart.sets[e].items[k];
        let rule = self.g.prods[item.prod as usize].rule;
        chart.sets[e].tagset[k] = tags;
        let completed = chart.sets[e].completed.entry((rule, item.origin)).or_default();
        if completed.is_empty() {
            chart.sets[e].origins.entry(rule).or_default().push(item.origin);
            chart.sets[e].completed.get_mut(&(rule, item.origin)).expect("just made").push(k as u32);
        } else {
            completed.push(k as u32);
        }
        if !chart.sets[e].done.insert((rule, item.origin, tags)) {
            return Step::Next;
        }
        let origin = item.origin as usize;
        let empty = origin == e;
        if empty {
            chart.sets[e].empty.entry(rule).or_default().push(tags);
        }
        let count = chart.sets[origin].waiting.get(&rule).map_or(0, Vec::len);
        Step::Waiters { e, origin, rule, tags, empty, count, next: 0 }
    }

    /// A constituent's tags where its production has no tag term (§3.7):
    /// its one symbol's tags, or none.
    fn plain_tags(&self, caps: &Caps, prod: u32) -> SetId {
        let production = &self.g.prods[prod as usize];
        if production.syms.len() == 1 {
            caps.get(production.cap_at[0].expect("an implicit capture")).tags
        } else {
            0
        }
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

    /// The proof trees of a nested parse's chart over `tokens`, its span.
    fn proofs<'c>(&'c self, chart: &'c Chart, tokens: &'c [Tok]) -> Proofs<'c> {
        Proofs::new(self.g, chart, tokens, self.shared.unicode, &self.shared.tags)
    }

    // ---- terms and conditions

    /// The canonical sound of the span (§5). Runs of tokens without sound
    /// are skipped whole, as in a sound test.
    fn phonemes(&self, tokens: &[Tok], start: usize, end: usize) -> String {
        let mut sound = String::new();
        let mut at = start;
        while at < end {
            work::count(Work::Spanned, 1);
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
        let mut bounds: Option<(usize, usize)> = None;
        for token in &tokens[start..end] {
            work::count(Work::Spanned, 1);
            let (from, to) = token.source;
            bounds = Some(bounds.map_or((from, to), |(low, high)| (low.min(from), high.max(to))));
        }
        bounds.map_or_else(String::new, |(low, high)| self.shared.source_text(low, high))
    }

    /// The tags of the tokens of a span, unioned.
    fn token_tags(&self, tokens: &[Tok], start: usize, end: usize) -> Arc<TagList> {
        Arc::new(union_all(tokens[start..end].iter().map(|token| self.shared.tags.list(token.tags))))
    }

    /// The tags of `$`'s constituent, if they are known or need no term
    /// (§4). Otherwise the evaluation goes on with its production's tag
    /// term, and `Task::Whole` gives them for `wanted`.
    fn whole<'n>(&self, eval: &mut Eval<'n>, frame: &Frame, wanted: Wanted) -> Option<SetId>
    where
        'g: 'n,
    {
        // The term of `$`'s own tags cannot read them, which it defines (§9).
        if eval.hidden {
            return Some(0);
        }
        if let Some(set) = frame.tags.get() {
            return Some(set);
        }
        let g = self.g;
        match &g.prods[frame.prod as usize].tags {
            Some(term) => {
                eval.hidden = true;
                eval.push(Task::Whole(wanted), Task::Term(term));
                None
            }
            None => {
                let set = self.plain_tags(&frame.caps, frame.prod);
                frame.tags.set(Some(set));
                Some(set)
            }
        }
    }

    /// The class tags of a list, those whose names begin with a capital.
    fn classes(&self, list: &TagList) -> Value {
        let tags = &self.shared.tags;
        // Each tag read counts.
        let class = |&id: &TagId| {
            work::count(Work::Listed, 1);
            tags.name(id).starts_with(|c: char| c.is_ascii_uppercase())
        };
        Value::set(list.iter().copied().filter(class).collect())
    }

    /// A query's answer from the memo. One not yet known halts the
    /// evaluation, which waits for it in `Task::Await`.
    #[allow(clippy::too_many_arguments)]
    fn query<'n, 't>(
        &mut self,
        eval: &mut Eval<'n>,
        span: &Span,
        rule: u32,
        query: Query,
        frame: &Frame,
        tokens: &'t [Tok],
        base: usize,
    ) -> Result<Out, Halt<'t>> {
        let (start, end, _) = span_bounds(span, frame, tokens.len());
        let key = self.nested_key(tokens, base, start, end, rule);
        let begins = matches!(query, Query::Begins);
        let known = if begins {
            self.shared.begins.get(&key).map(|&holds| (holds, 0))
        } else {
            self.shared.memo.get(&key).copied()
        };
        match known {
            Some(answer) => Ok(query.out(answer, &self.shared.tags)),
            None => {
                eval.tasks.push(Task::Await(query));
                Err(Halt::Pending(Request { tokens, base, start, end, rule, key, begins }))
            }
        }
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
    fn as_string(value: Value) -> Result<String, EngineError> {
        match value {
            Value::Str(text) => Ok(text),
            Value::Set(_) => Err(EngineError { message: "a set where a string is needed".to_string(), rule: None }),
        }
    }

    /// A comparison of two values (§10).
    fn compare(&self, op: CmpOp, left: Value, right: Value) -> Result<bool, EngineError> {
        Ok(match op {
            // Two strings, or two sets of one kind (§10).
            CmpOp::Eq | CmpOp::Ne => {
                let equal = match (left, right) {
                    (Value::Str(a), Value::Str(b)) => a == b,
                    (a, b) => Self::as_set(a)? == Self::as_set(b)?,
                };
                equal == (op == CmpOp::Eq)
            }
            // A string in a set of strings.
            CmpOp::In | CmpOp::NotIn => {
                let Value::Str(needle) = left else {
                    return Err(EngineError {
                        message: "the left side of ∈ or ∉ is a string".to_string(), rule: None
                    });
                };
                let set = Self::as_set(right)?;
                let inside = self.shared.tags.lookup(&needle).is_some_and(|id| set.binary_search(&id).is_ok());
                inside == (op == CmpOp::In)
            }
            CmpOp::Subset | CmpOp::NotSubset => {
                is_subset(&*Self::as_set(left)?, &*Self::as_set(right)?) == (op == CmpOp::Subset)
            }
        })
    }

    /// Goes on with an evaluation until it gives its value or halts for a
    /// query. Each node is visited once. A compound node keeps its frame on
    /// `eval` while its parts are evaluated, with the values of the parts
    /// done, so a halt loses nothing and the answer resumes it in place.
    fn evaluate<'n, 't>(
        &mut self,
        eval: &mut Eval<'n>,
        frame: &Frame,
        tokens: &'t [Tok],
        base: usize,
    ) -> Result<Out, Halt<'t>>
    where
        'g: 'n,
    {
        // The value of the node evaluated last, which the frame below it
        // takes.
        let mut last: Option<Out> = None;
        while let Some(task) = eval.tasks.pop() {
            let out = match task {
                Task::Cond(cond) => {
                    work::count(Work::Visits, 1);
                    match cond {
                        LCond::Not(inner) => {
                            eval.push(Task::Not, Task::Cond(inner));
                            continue;
                        }
                        LCond::Any(items) => match items.first() {
                            Some(first) => {
                                eval.push(Task::Any(items, 1), Task::Cond(first));
                                continue;
                            }
                            None => Out::Bool(false),
                        },
                        LCond::All(items) => match items.first() {
                            Some(first) => {
                                eval.push(Task::All(items, 1), Task::Cond(first));
                                continue;
                            }
                            None => Out::Bool(true),
                        },
                        // The consequent is evaluated only where the
                        // antecedent holds.
                        LCond::If(antecedent, consequent) => {
                            eval.push(Task::Implies(consequent), Task::Cond(antecedent));
                            continue;
                        }
                        LCond::Matches(span, rule) => {
                            self.query(eval, span, *rule, Query::Matches, frame, tokens, base)?
                        }
                        LCond::Begins(span, rule) => {
                            self.query(eval, span, *rule, Query::Begins, frame, tokens, base)?
                        }
                        // Where the input of the parse that reads the
                        // condition begins (§10). Positions count from the
                        // start of the tokens that parse reads, a nested
                        // parse's own span included, so that is 0.
                        LCond::Initial(span) => Out::Bool(span_bounds(span, frame, tokens.len()).0 == 0),
                        LCond::Cmp(op, left, right) => {
                            eval.push(Task::Left(*op, right), Task::Term(left));
                            continue;
                        }
                    }
                }
                Task::Term(term) => {
                    work::count(Work::Visits, 1);
                    Out::Value(match term {
                        LTerm::Str(text) => Value::Str(text.clone()),
                        LTerm::Tag(tag) => Value::set(vec![self.shared.tags.tag(tag)]),
                        LTerm::Range(first, last) => Value::Set(self.shared.range(*first, *last)),
                        LTerm::Empty => Value::set(TagList::new()),
                        LTerm::Union(items) => match items.first() {
                            Some(first) => {
                                eval.push(Task::Union(items, Vec::with_capacity(items.len())), Task::Term(first));
                                continue;
                            }
                            None => Value::set(TagList::new()),
                        },
                        LTerm::Inter(items) => match items.first() {
                            Some(first) => {
                                eval.push(Task::Inter(items, 1, None), Task::Term(first));
                                continue;
                            }
                            None => Value::set(TagList::new()),
                        },
                        LTerm::Diff(left, right) => {
                            eval.push(Task::DiffLeft(right), Task::Term(left));
                            continue;
                        }
                        LTerm::Phonemes(span) => {
                            let (start, end, _) = span_bounds(span, frame, tokens.len());
                            Value::Str(self.phonemes(tokens, start, end))
                        }
                        LTerm::Text(span) => {
                            let (start, end, _) = span_bounds(span, frame, tokens.len());
                            Value::Str(self.text(tokens, start, end))
                        }
                        LTerm::Split(string, delimiter) => {
                            eval.push(Task::Split(delimiter), Task::Term(string));
                            continue;
                        }
                        LTerm::TagOf(name) => {
                            eval.push(Task::TagOf, Task::Term(name));
                            continue;
                        }
                        LTerm::Tags(span) => match span_bounds(span, frame, tokens.len()) {
                            (_, _, Whose::Cap(set)) => Value::Set(self.shared.tags.shared(set)),
                            (_, _, Whose::Whole) => match self.whole(eval, frame, Wanted::Tags) {
                                Some(set) => Value::Set(self.shared.tags.shared(set)),
                                None => continue,
                            },
                            (start, end, Whose::Tokens) => Value::Set(self.token_tags(tokens, start, end)),
                        },
                        LTerm::TagsRule(span, rule) => {
                            match self.query(eval, span, *rule, Query::TagsRule, frame, tokens, base)? {
                                Out::Value(value) => value,
                                _ => unreachable!("a set of tags"),
                            }
                        }
                        LTerm::Classes(span) => match span_bounds(span, frame, tokens.len()) {
                            (_, _, Whose::Cap(set)) => self.classes(&self.shared.tags.shared(set)),
                            (_, _, Whose::Whole) => match self.whole(eval, frame, Wanted::Classes) {
                                Some(set) => self.classes(&self.shared.tags.shared(set)),
                                None => continue,
                            },
                            (start, end, Whose::Tokens) => self.classes(&self.token_tags(tokens, start, end)),
                        },
                        LTerm::Classify(string, classifier) => {
                            eval.push(Task::Classify(classifier), Task::Term(string));
                            continue;
                        }
                        // `t` is evaluated only where the guard holds (§10).
                        LTerm::If(cond, then) => {
                            eval.push(Task::Guarded(then), Task::Cond(cond));
                            continue;
                        }
                    })
                }
                Task::Await(query) => query.out(eval.answer.take().expect("the answer"), &self.shared.tags),
                Task::Conds(conds, next) => {
                    if !took(&mut last).holds() {
                        Out::Bool(false)
                    } else if let Some((cond, _)) = conds.get(next) {
                        eval.push(Task::Conds(conds, next + 1), Task::Cond(cond));
                        continue;
                    } else {
                        Out::Bool(true)
                    }
                }
                Task::Not => Out::Bool(!took(&mut last).holds()),
                Task::Any(items, next) => {
                    if took(&mut last).holds() {
                        Out::Bool(true)
                    } else if let Some(item) = items.get(next) {
                        eval.push(Task::Any(items, next + 1), Task::Cond(item));
                        continue;
                    } else {
                        Out::Bool(false)
                    }
                }
                Task::All(items, next) => {
                    if !took(&mut last).holds() {
                        Out::Bool(false)
                    } else if let Some(item) = items.get(next) {
                        eval.push(Task::All(items, next + 1), Task::Cond(item));
                        continue;
                    } else {
                        Out::Bool(true)
                    }
                }
                Task::Implies(consequent) => {
                    if !took(&mut last).holds() {
                        Out::Bool(true)
                    } else {
                        eval.tasks.push(Task::Cond(consequent));
                        continue;
                    }
                }
                Task::Left(op, right) => {
                    let left = took(&mut last).value();
                    eval.push(Task::Right(op, left), Task::Term(right));
                    continue;
                }
                Task::Right(op, left) => Out::Bool(self.compare(op, left, took(&mut last).value())?),
                Task::Union(items, mut parts) => {
                    parts.push(Self::as_set(took(&mut last).value())?);
                    match items.get(parts.len()) {
                        Some(item) => {
                            eval.push(Task::Union(items, parts), Task::Term(item));
                            continue;
                        }
                        None => Out::Value(Value::set(union_all(parts.iter().map(|part| &**part)))),
                    }
                }
                Task::Inter(items, next, list) => {
                    let set = Self::as_set(took(&mut last).value())?;
                    let list = match list {
                        None => set,
                        Some(list) => Arc::new(intersection(&list, &set)),
                    };
                    match items.get(next) {
                        Some(item) => {
                            eval.push(Task::Inter(items, next + 1, Some(list)), Task::Term(item));
                            continue;
                        }
                        None => Out::Value(Value::Set(list)),
                    }
                }
                Task::DiffLeft(right) => {
                    let left = Self::as_set(took(&mut last).value())?;
                    eval.push(Task::DiffRight(left), Task::Term(right));
                    continue;
                }
                Task::DiffRight(left) => {
                    let right = Self::as_set(took(&mut last).value())?;
                    Out::Value(Value::set(difference(&left, &right)))
                }
                Task::Split(delimiter) => {
                    let string = Self::as_string(took(&mut last).value())?;
                    eval.push(Task::SplitBy(string), Task::Term(delimiter));
                    continue;
                }
                // A set of strings (§10); an empty delimiter that only a
                // parse sees is an error of the grammar.
                Task::SplitBy(string) => {
                    let delimiter = Self::as_string(took(&mut last).value())?;
                    if delimiter.is_empty() {
                        return Err(
                            EngineError { message: "split has an empty delimiter".to_string(), rule: None }.into()
                        );
                    }
                    let mut list: TagList = string
                        .split(delimiter.as_str())
                        .filter(|piece| !piece.is_empty())
                        .map(|piece| {
                            work::count(Work::Listed, 1);
                            self.shared.tags.tag(piece)
                        })
                        .collect();
                    list.sort_unstable();
                    list.dedup();
                    Out::Value(Value::set(list))
                }
                Task::TagOf => {
                    let name = Self::as_string(took(&mut last).value())?;
                    if !is_name(&name) {
                        return Err(EngineError {
                            message: format!("tag({name:?}): the string is not a name"),
                            rule: None,
                        }
                        .into());
                    }
                    Out::Value(Value::set(vec![self.shared.tags.tag(&name)]))
                }
                // The classes that the classifier gives the string, for the
                // features of the parse, or none for an unknown key (§10).
                Task::Classify(classifier) => {
                    let key = Self::as_string(took(&mut last).value())?;
                    let g = self.g;
                    let classes = g.classifiers.get(classifier).and_then(|table| table.get(&key));
                    let mut list: TagList =
                        classes.into_iter().flatten().map(|class| self.shared.tags.tag(class)).collect();
                    list.sort_unstable();
                    Out::Value(Value::set(list))
                }
                Task::Guarded(then) => {
                    if took(&mut last).holds() {
                        eval.push(Task::AsSet, Task::Term(then));
                        continue;
                    }
                    Out::Value(Value::set(TagList::new()))
                }
                Task::AsSet => Out::Value(Value::Set(Self::as_set(took(&mut last).value())?)),
                Task::Whole(wanted) => {
                    let list = Self::as_set(took(&mut last).value())?;
                    eval.hidden = false;
                    let set = self.shared.tags.set_shared(list);
                    match wanted {
                        Wanted::Step => Out::Tags(set),
                        Wanted::Tags => {
                            frame.tags.set(Some(set));
                            Out::Value(Value::Set(self.shared.tags.shared(set)))
                        }
                        Wanted::Classes => {
                            frame.tags.set(Some(set));
                            Out::Value(self.classes(&self.shared.tags.shared(set)))
                        }
                    }
                }
            };
            last = Some(out);
        }
        Ok(last.expect("a value"))
    }

    /// Evaluates a tag term over a constituent, for emission (§11). A
    /// nested parse it needs runs at once, and the evaluation goes on from
    /// where it halted.
    pub(crate) fn tag_term(
        &mut self,
        term: &LTerm,
        frame: &Frame,
        tokens: &[Tok],
        base: usize,
    ) -> Result<SetId, EngineError> {
        let list = self.tag_list(term, frame, tokens, base)?;
        Ok(self.shared.tags.set_shared(list))
    }

    /// The list of tags of a tag term over a constituent.
    fn tag_list(
        &mut self,
        term: &LTerm,
        frame: &Frame,
        tokens: &[Tok],
        base: usize,
    ) -> Result<Arc<TagList>, EngineError> {
        let mut eval = Eval::term(term);
        loop {
            match self.evaluate(&mut eval, frame, tokens, base) {
                Ok(out) => return Self::as_set(out.value()),
                Err(Halt::Error(error)) => return Err(error),
                Err(Halt::Pending(request)) => eval.answer = Some(self.answer(request)?),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use crate::earley::{
        mark_quiet, matchers, sounds_like, Cap, CapEntry, Caps, Chart, Frame, Recognizer, Shared, Tok,
    };
    use crate::lower::{LTerm, Span, Sym};
    use crate::work::{assert_linear, assert_stops, budget, counted, reset, Mutant, Mutation, Work};

    thread_local! {
        /// Whether `Chart::extend_caps` stores each prefix again, a
        /// mutation that the tests of storage must stop at once.
        pub(super) static COPY_PREFIXES: Cell<bool> = const { Cell::new(false) };
    }

    /// The mutation of `COPY_PREFIXES`, on until this is dropped, also when
    /// a budget's panic unwinds.
    struct Copying;

    impl Copying {
        fn on() -> Copying {
            COPY_PREFIXES.with(|copying| copying.set(true));
            Copying
        }
    }

    impl Drop for Copying {
        fn drop(&mut self) {
            COPY_PREFIXES.with(|copying| copying.set(false));
        }
    }

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
                    let list = recognizer.tag_list(term, &frame, tokens, 0).expect("a set");
                    assert!(list.len() + 1 >= n, "{} tags of {n}", list.len());
                }
            }
        });
    }

    /// A dialect of one production of n captures with a condition at each.
    fn condition_at_each_capture(n: usize) -> crate::Dialect {
        let names: Vec<String> = (0..n).map(|index| format!("$c{index}('a')")).collect();
        let conditions: Vec<String> = (0..n).map(|index| format!("text($c{index}) = \"a\"")).collect();
        let grammar = format!(
            "```jbogenbau\n%ambiguity-resolution greedy\n%rule text {}\n%conditions {}\n```\n",
            names.join(" "),
            conditions.join(", ")
        );
        let sources = [("g.md", grammar), ("p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string())];
        crate::load_dialect_sources(sources, "p.md").expect("the dialect")
    }

    /// A production of n captures with a condition at each finds the
    /// conditions of each dot without a scan of all n, so a parse of it
    /// looks at about n conditions, not n².
    #[test]
    fn each_dot_finds_its_conditions_at_once() {
        for n in [200usize, 800] {
            let dialect = condition_at_each_capture(n);
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

    /// A selection that scans every condition of the production at each
    /// dot examines some n² conditions. It stops at the first past the
    /// budget of `each_dot_finds_its_conditions_at_once`.
    #[test]
    fn scanning_every_condition_stops_at_the_budget() {
        let n = 800;
        let dialect = condition_at_each_capture(n);
        let text = "a".repeat(n);
        let _mutation = Mutation::on(Mutant::ScanConditions);
        assert_stops(Work::Conditions, 4 * n as u64 + 8, || {
            let _ = dialect.parse(&text, &crate::ParseOptions::default());
        });
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
            let first = recognizer.tag_list(&range, &frame, &[], 0).expect("a set");
            assert!(first.len() > n / 2, "{} tags in a range of {n}", first.len());
            for _ in 1..n {
                let list = recognizer.tag_list(&range, &frame, &[], 0).expect("a set");
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
        single_document(&format!("%ambiguity-resolution greedy\n{rules}"))
    }

    /// The shared cases of `tests/query-depth.json` (tests/README.md):
    /// nested queries nest as deep as the text makes them (engine §4). The
    /// parse runs on the test's own thread, whose stack has the default
    /// size, so a recognizer that nests on the call stack overflows here.
    #[test]
    fn query_depth_cases() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/query-depth.json");
        let text = std::fs::read_to_string(path).expect("the cases");
        let cases = crate::json::parse_cases(&text).expect("the cases are JSON");
        let cases = cases.as_array().expect("an array");
        assert!(!cases.is_empty(), "no cases");
        for case in cases {
            let string = |name: &str| case.get(name).and_then(crate::json::Json::as_str).expect(name).to_string();
            let count = case.get("count").and_then(crate::json::Json::as_int).expect("count") as usize;
            let (name, grammar) = (string("name"), string("grammar"));
            let dialect = single_document(&grammar);
            let text = format!("{}{}", string("link").repeat(count), string("suffix"));
            let options = crate::ParseOptions { auto_features: false, ..crate::ParseOptions::default() };
            let result = dialect.parse(&text, &options).expect("a result");
            assert!(result.ok, "{name}: {:?}", result.error);
        }
    }

    /// The shared cases of `tests/query-work.json` (tests/README.md): a
    /// step or a term that starts many queries visits each node of its
    /// conditions and terms a bounded number of times. The budget holds
    /// while the parse runs, so an evaluation that starts again from its
    /// first condition after each query stops at the first visit past it.
    #[test]
    fn query_work_cases() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/query-work.json");
        let text = std::fs::read_to_string(path).expect("the cases");
        let cases = crate::json::parse_cases(&text).expect("the cases are JSON");
        let cases = cases.as_array().expect("an array");
        assert!(!cases.is_empty(), "no cases");
        for case in cases {
            let string = |name: &str| case.get(name).and_then(crate::json::Json::as_str).expect(name).to_string();
            let number = |name: &str| case.get(name).and_then(crate::json::Json::as_int).expect(name) as u64;
            let (count, most) = (number("count"), number("most"));
            let each = |name: &str| (0..count).map(|i| string(name).replace("{i}", &i.to_string())).collect::<Vec<_>>();
            let grammar = format!(
                "{}{}{}{}",
                string("head"),
                each("item").join(&string("joiner")),
                string("tail"),
                each("rule").concat()
            );
            let dialect = single_document(&grammar);
            let options = crate::ParseOptions { auto_features: false, ..crate::ParseOptions::default() };
            reset();
            budget(Work::Visits, most * count);
            let result = dialect.parse(&string("text"), &options).expect("a result");
            let visits = counted(Work::Visits);
            // The next dialect's grammar is read with no budget.
            reset();
            assert!(result.ok, "{}: {:?}", string("name"), result.error);
            assert!(visits > 0, "{}: no visits counted", string("name"));
        }
    }

    /// A dialect of one grammar document `g.md` whose block holds `rules`
    /// as they are, its directives included.
    fn single_document(rules: &str) -> crate::Dialect {
        let sources = [
            ("g.md", format!("```jbogenbau\n{rules}\n```\n")),
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
            // An entry past the bound stops the parse as it is stored.
            budget(Work::Captures, count as u64);
            let result = dialect.parse(&"a".repeat(count), &crate::ParseOptions::default()).expect("a result");
            assert!(result.ok, "{count} captures");
            assert_eq!(counted(Work::Captures), count as u64, "{count} captures");
            assert!(counted(Work::Items) <= items, "{} items for {count} captures", counted(Work::Items));
            assert!(counted(Work::CaptureSteps) <= steps, "{} steps for {count} captures", counted(Work::CaptureSteps));
            // The next dialect's grammar is read with no budget.
            reset();
        }
    }

    /// A recognizer that stores each prefix of the captured parts again,
    /// some C²/2 entries, stops at the first entry past the bound of C that
    /// `captures_share_their_prefixes` holds the parse to, while it runs.
    #[test]
    fn storing_each_prefix_again_stops_at_the_bound() {
        let count = 100usize;
        let names: Vec<String> = (0..count).map(|index| format!("$c{index}('a')")).collect();
        let dialect = single(&format!("%rule text {}", names.join(" ")));
        let text = "a".repeat(count);
        let _copying = Copying::on();
        assert_stops(Work::Captures, count as u64, || {
            let _ = dialect.parse(&text, &crate::ParseOptions::default());
        });
    }

    /// A chart that holds one sequence of `n` captured parts, and its id.
    fn chain(n: u32) -> (Chart, u32) {
        let mut chart = Chart::default();
        chart.caps.push(CapEntry { parent: 0, jump: 0, depth: 0, cap: Cap { start: 0, end: 0, tags: 0 } });
        let id = (0..n).fold(0, |id, at| chart.extend_caps(id, Cap { start: at, end: at + 1, tags: 0 }));
        (chart, id)
    }

    /// The walk and the search of the captured parts count each step as
    /// they take it, so a budget stops a long walk at its first step past
    /// it, not once the walk is over.
    #[test]
    fn capture_steps_count_as_they_are_taken() {
        let (chart, id) = chain(1000);
        assert_stops(Work::CaptureSteps, 500, || {
            chart.caps(id);
        });
        // The search for the first part takes some 2 log₂ 1000 steps.
        assert_stops(Work::CaptureSteps, 3, || {
            chart.cap_at(id, 0);
        });
    }

    /// The terms count each tag of the lists they make and each token of
    /// the spans they read, as they go. A budget then stops a term over a
    /// long span or a long list at its first count past it.
    #[test]
    fn terms_count_their_lists_and_spans_as_they_go() {
        let n = 1000usize;
        let sources = [
            ("main.md", "```jbogenbau\n%ambiguity-resolution greedy\n%rule text 'a'\n```\n".to_string()),
            ("p.md", "```jbogenbau\n%stage main\n%include \"main.md\"\n```\n".to_string()),
        ];
        let dialect = crate::load_dialect_sources(sources, "p.md").expect("the dialect");
        let g = dialect.lowered_stage(0);
        let chars: Vec<char> = vec!['a'; n];
        let mut shared = Shared::new(&dialect.unicode, &chars);
        let tokens: Vec<Tok> = (0..n)
            .map(|index| Tok {
                text: "a".to_string(),
                tags: shared.tags.set_of(["A"]),
                phonemes: Some("a".to_string()),
                source: (index, index + 1),
                label: "a".to_string(),
                sound: Default::default(),
                quiet: 0,
                before: Vec::new(),
                after: Vec::new(),
            })
            .collect();
        let names: Vec<String> = (0..n).map(|index| format!("C{index}")).collect();
        let classes = shared.tags.set_of(names.iter().map(String::as_str));
        let matchers = matchers(&g, &mut shared.tags);
        let mut recognizer = Recognizer { g: &g, matchers: &matchers, shared: &mut shared, recon: None };
        let caps = [Cap { start: 0, end: n as u32, tags: classes }];
        let frame =
            Frame { caps: Caps::All(&caps), prod: 0, origin: 0, end: n as u32, tags: Cell::new(None), project: None };
        let split = |string: LTerm| LTerm::Split(Box::new(string), Box::new(LTerm::Str(" ".to_string())));
        let mut stops = |work: Work, term: LTerm| {
            assert_stops(work, n as u64 / 2, || {
                let _ = recognizer.tag_list(&term, &frame, &tokens, 0);
            });
        };
        stops(Work::Spanned, split(LTerm::Text(Span::Whole)));
        stops(Work::Spanned, split(LTerm::Phonemes(Span::Whole)));
        stops(Work::Listed, split(LTerm::Str(vec!["x"; n].join(" "))));
        stops(Work::Listed, LTerm::Classes(Span::Cap(0)));
        stops(Work::Listed, LTerm::Range(0x4E00, 0x4E00 + n as u32 - 1));
    }

    /// The phonemes of each suffix of a run of tokens without sound, and
    /// the text of the whole run, cost about what they read: the run is
    /// skipped whole, and the text's bounds are found in one walk.
    #[test]
    fn spans_cost_what_they_read() {
        let sources = [
            ("main.md", "```jbogenbau\n%ambiguity-resolution greedy\n%rule text 'a'\n```\n".to_string()),
            ("p.md", "```jbogenbau\n%stage main\n%include \"main.md\"\n```\n".to_string()),
        ];
        let dialect = crate::load_dialect_sources(sources, "p.md").expect("the dialect");
        let g = dialect.lowered_stage(0);
        let chars: Vec<char> = vec!['a'; 4000];
        let mut shared = Shared::new(&dialect.unicode, &chars);
        let matchers = matchers(&g, &mut shared.tags);
        let recognizer = Recognizer { g: &g, matchers: &matchers, shared: &mut shared, recon: None };
        assert_linear(Work::Spanned, 1000, &mut |n| {
            let mut tokens: Vec<Tok> = (0..n)
                .map(|index| Tok {
                    text: "a".to_string(),
                    tags: 0,
                    phonemes: (index + 1 == n).then(|| "a".to_string()),
                    source: (index, index + 1),
                    label: "a".to_string(),
                    sound: Default::default(),
                    quiet: 0,
                    before: Vec::new(),
                    after: Vec::new(),
                })
                .collect();
            mark_quiet(&mut tokens, &dialect.unicode);
            for start in 0..n {
                assert_eq!(recognizer.phonemes(&tokens, start, n), "a");
            }
            assert_eq!(recognizer.text(&tokens, 0, n).len(), n);
        });
    }

    /// The classes of a capture's n tags, and the split of a string of n
    /// pieces, cost about n: each list is made once, not copied as it
    /// grows.
    #[test]
    fn classes_and_splits_grow_linearly() {
        let sources = [
            ("main.md", "```jbogenbau\n%ambiguity-resolution greedy\n%rule text 'a'\n```\n".to_string()),
            ("p.md", "```jbogenbau\n%stage main\n%include \"main.md\"\n```\n".to_string()),
        ];
        let dialect = crate::load_dialect_sources(sources, "p.md").expect("the dialect");
        let g = dialect.lowered_stage(0);
        let chars: Vec<char> = Vec::new();
        let mut shared = Shared::new(&dialect.unicode, &chars);
        // The tags, the strings and the terms are made apart, so that only
        // their evaluation is counted.
        let made: Vec<_> = [1000usize, 4000]
            .into_iter()
            .map(|n| {
                let names: Vec<String> = (0..n).map(|index| format!("C{index}")).collect();
                let classes = shared.tags.set_of(names.iter().map(String::as_str));
                let split = LTerm::Split(Box::new(LTerm::Str(names.join(" "))), Box::new(LTerm::Str(" ".to_string())));
                (n, classes, split)
            })
            .collect();
        let matchers = matchers(&g, &mut shared.tags);
        let mut recognizer = Recognizer { g: &g, matchers: &matchers, shared: &mut shared, recon: None };
        assert_linear(Work::Listed, 1000, &mut |n| {
            let (_, classes, split) = made.iter().find(|made| made.0 == n).expect("made");
            let caps = [Cap { start: 0, end: 0, tags: *classes }];
            let frame =
                Frame { caps: Caps::All(&caps), prod: 0, origin: 0, end: 0, tags: Cell::new(None), project: None };
            for term in [&LTerm::Classes(Span::Cap(0)), split] {
                assert_eq!(recognizer.tag_list(term, &frame, &[], 0).expect("a set").len(), n);
            }
        });
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
