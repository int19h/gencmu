//! Lowering a stitched grammar to the productions the parser runs, given
//! the enabled features (engine §3).

use std::collections::BTreeSet;

use crate::fxhash::{FxMap, FxSet};
use std::sync::Arc;

use crate::clauses::{simplify_cond, simplify_value, CondListSplit, EmitIndex, Simple, TermSplit};
use crate::dom::{Arg, Chain, Cond, EmitItem, Expr, FeatureKind, Mark, Term};
use crate::grammar::{is_terminal_name, ClassifierTables, Implication, StageGrammar, StitchedAlternative};
use crate::tags::{code_of_character_tag, property_name, range_name};
use crate::unicode::Property;
use crate::work::{self, Mutant, Work};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Sym {
    T(u32),
    N(u32),
}

/// The characters a range or a property matches (engine §4): a range's
/// first and last scalar values, or a property.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Characters {
    Range(u32, u32),
    Property(Property),
}

#[derive(Debug, Clone)]
pub(crate) enum Span {
    Cap(u32),
    /// `$`, the whole constituent: from the item's origin to its end.
    Whole,
    Head(Box<Span>),
    Tail(Box<Span>),
    Last(Box<Span>),
    /// From the start of the span to the end of the parse's input.
    From(Box<Span>),
    /// From the end of the span to the end of the parse's input.
    After(Box<Span>),
}

#[derive(Debug, Clone)]
pub(crate) enum LTerm {
    /// A string.
    Str(String),
    /// The tag set of one tag.
    Tag(String),
    /// The character tags of a range, by its first and last scalar values.
    Range(u32, u32),
    Empty,
    Union(Vec<LTerm>),
    Inter(Vec<LTerm>),
    /// The members of the first set that are not in the second.
    Diff(Box<LTerm>, Box<LTerm>),
    Phonemes(Span),
    Text(Span),
    /// `split(a, d)`: the set of the pieces of `a` between the occurrences
    /// of `d` (§10).
    Split(Box<LTerm>, Box<LTerm>),
    /// `tag(a)`: the identifier tag whose name is `a`.
    TagOf(Box<LTerm>),
    Tags(Span),
    TagsRule(Span, u32),
    Classes(Span),
    /// `classify(a, C)`: the classes that the classifier named `C` gives
    /// the string `a` (§10).
    Classify(Box<LTerm>, String),
    /// `A ⟹ t`: `t` where the condition holds, else the empty set.
    If(Box<LCond>, Box<LTerm>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CmpOp {
    Eq,
    Ne,
    In,
    NotIn,
    Subset,
    NotSubset,
}

#[derive(Debug, Clone)]
pub(crate) enum LCond {
    Tree(Span, bool, crate::patterns::Pattern),
    Cmp(CmpOp, LTerm, LTerm),
    Matches(Span, u32),
    /// `begins(s, R)`: whether a prefix of the span, possibly empty, parses
    /// as `R`.
    Begins(Span, u32),
    /// `initial(s)`: whether the span begins where the parse's input does.
    Initial(Span),
    Not(Box<LCond>),
    Any(Vec<LCond>),
    All(Vec<LCond>),
    /// `A ⟹ B`: `B` is evaluated only where `A` holds (§10).
    If(Box<LCond>, Box<LCond>),
}

#[derive(Debug, Clone)]
pub(crate) enum LEmitItem {
    /// A capture, emitted over its part with the item's tags or the part's,
    /// with the captures of its attachments before it and after it (§11).
    Cap(u32, Option<LTerm>, Box<[u32]>, Box<[u32]>),
    /// An inserted tag, anchored at the start of the first written part of
    /// the capture item listed next after it, or at the constituent's end
    /// if none is.
    Insert(String, Option<u32>),
}

#[derive(Debug, Clone)]
pub(crate) enum LEmit {
    /// No emission: the constituent is walked.
    None,
    /// `%emits ε`: the constituent emits nothing and does not count.
    Nothing,
    /// `%emits $`, once per item, with the item's tag term if it has one.
    This(Vec<Option<LTerm>>),
    /// Exactly these items, in the order listed.
    Items(Vec<LEmitItem>),
}

/// The comparator of a test in a body (engine §2, §4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum TestOp {
    /// `X="s"`: the canonical sound of the span is `s`.
    Is,
    /// `X≠"s"`.
    IsNot,
    /// `X⊇t`: the own tags include every tag of `t`.
    Superset,
    /// `X⊉t`.
    NotSuperset,
    /// `X∩t=∅`: the own tags include no tag of `t`.
    Disjoint,
    /// `X∩t≠∅`.
    Meets,
}

/// A test of a lowered symbol, with its value: a string for a sound test
/// and a tag set for a tag test, and the test as an expected list writes
/// it after its terminal (docs/output.md).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct SymbolTest {
    pub op: TestOp,
    /// The string of a sound test.
    pub sound: Option<String>,
    /// The tags of a tag test, in code point order.
    pub tags: Vec<String>,
    pub written: String,
}

/// The id of no test, in a production's `tests`.
pub(crate) const NO_TEST: u32 = u32::MAX;

impl SymbolTest {
    /// A test from its comparator and its value, which stitching has made a
    /// string, `∅`, a tag or a union of tags (engine §2).
    fn new(op: &str, value: &Term) -> SymbolTest {
        let op = match op {
            "=" => TestOp::Is,
            "≠" => TestOp::IsNot,
            "⊇" => TestOp::Superset,
            "⊉" => TestOp::NotSuperset,
            "∩=∅" => TestOp::Disjoint,
            _ => TestOp::Meets,
        };
        let (sound, tags) = match value {
            Term::Str(text) => (Some(text.clone()), Vec::new()),
            Term::Tag(tag) => (None, vec![tag.clone()]),
            Term::Union(items) => {
                let mut tags: Vec<String> = items
                    .iter()
                    .filter_map(|item| match item {
                        Term::Tag(tag) => Some(tag.clone()),
                        _ => None,
                    })
                    .collect();
                tags.sort();
                tags.dedup();
                (None, tags)
            }
            _ => (None, Vec::new()),
        };
        // The value in canonical form: a string between double quotes, a
        // backslash before each `\` and `"`; a tag set as `∅`, its one tag,
        // or its tags joined by ` ∪ ` in parentheses.
        let value = match &sound {
            Some(text) => {
                let mut written = String::from("\"");
                for c in text.chars() {
                    if c == '\\' || c == '"' {
                        written.push('\\');
                    }
                    written.push(c);
                }
                written.push('"');
                written
            }
            None => match &tags[..] {
                [] => "∅".to_string(),
                [tag] => tag.clone(),
                tags => format!("({})", tags.join(" ∪ ")),
            },
        };
        let written = match op {
            TestOp::Is => format!("={value}"),
            TestOp::IsNot => format!("≠{value}"),
            TestOp::Superset => format!("⊇{value}"),
            TestOp::NotSuperset => format!("⊉{value}"),
            TestOp::Disjoint => format!("∩{value}=∅"),
            TestOp::Meets => format!("∩{value}≠∅"),
        };
        SymbolTest { op, sound, tags, written }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct Prod {
    /// The nonterminal this production defines.
    pub rule: u32,
    /// The user rule it belongs to: its own rule, or for a helper the rule
    /// whose alternative introduced it.
    pub owner: u32,
    pub syms: Vec<Sym>,
    /// For each position, its capture slot.
    pub cap_at: Vec<Option<u32>>,
    /// For each position, the id of its symbol's test in the grammar's
    /// `tests`, or `NO_TEST` (engine §4); empty when no symbol of the
    /// production is tested.
    pub tests: Vec<u32>,
    /// For each capture slot, its position.
    pub cap_pos: Vec<usize>,
    pub tags: Option<LTerm>,
    pub emit: LEmit,
    /// `%opaque`: its constituent is an opaque part, which sounds `?` and
    /// shows its text (§11).
    pub opaque: bool,
    /// Conditions, each with the dot at which it is evaluated, in order of
    /// that dot and then in written order.
    pub conds: Vec<(LCond, usize)>,
    /// For each dot, where its conditions begin in `conds`, and one more
    /// for where they end.
    pub cond_at: Vec<u32>,
    pub visible: bool,
    /// The features of its alternative's warnings, in the order they are
    /// written (§12); none for a helper.
    pub warnings: Vec<String>,
    pub document: Option<Arc<str>>,
    pub at: (usize, usize),
    pub slot: Option<Box<SlotMetadata>>,
}

#[derive(Debug, Clone)]
pub(crate) struct SlotMetadata {
    pub source: (usize, usize),
    pub path: Option<usize>,
    pub names: Vec<Option<String>>,
    pub tags: Vec<Term>,
    pub tag_clauses: [Option<Term>; 2],
    pub conditions: Vec<(Cond, usize)>,
    pub emit: Option<Vec<EmitItem>>,
}

#[derive(Debug, Clone)]
pub(crate) struct LRule {
    /// The rule's name, or for a helper the name of the rule that owns it.
    pub name: String,
    pub helper: bool,
    pub leftmost_longest: bool,
    pub prods: Vec<u32>,
    /// For the helper of an elidable optional, `[+T …]` or `[++T …]`: its
    /// terminator `T` (§3.8, §12).
    pub elided: Option<String>,
    /// The id of that terminator's test, if it has one: an `=` test,
    /// whose string a restored token sounds like (engine §7).
    pub elided_test: Option<u32>,
    /// Whether that terminator is maximal: its optional is written
    /// `[++T …]` (engine §3.8, §4).
    pub maximal: bool,
}

impl Prod {
    /// The id of the test of the symbol at `dot`, if it has one.
    #[inline]
    pub(crate) fn test(&self, dot: usize) -> Option<u32> {
        self.tests.get(dot).copied().filter(|&test| test != NO_TEST)
    }

    /// The conditions evaluated at `dot`, in written order. The walk counts
    /// each condition it examines before it checks the condition's dot. A
    /// scan of every condition, which the tests switch on, then counts all
    /// it looks at, not the few it finds.
    #[inline]
    pub(crate) fn conds_at(&self, dot: usize) -> &[(LCond, usize)] {
        let (start, end) = (self.cond_at[dot] as usize, self.cond_at[dot + 1] as usize);
        let (from, to) = if work::mutated(Mutant::ScanConditions) { (0, self.conds.len()) } else { (start, end) };
        let (mut first, mut past) = (end, end);
        for (index, (_, at)) in self.conds.iter().enumerate().take(to).skip(from) {
            work::count(Work::Conditions, 1);
            if *at == dot {
                first = first.min(index);
                past = index + 1;
            }
        }
        &self.conds[first..past]
    }

    /// Whether any condition is evaluated at `dot`: one comparison of the
    /// bounds, which examines no condition.
    #[inline]
    pub(crate) fn has_conds_at(&self, dot: usize) -> bool {
        self.cond_at[dot] != self.cond_at[dot + 1]
    }
}

#[derive(Debug, Clone)]
pub(crate) struct Lowered {
    pub preferences: Arc<crate::preferences::Preferences>,
    pub rules: Vec<LRule>,
    pub prods: Vec<Prod>,
    pub terminals: Vec<String>,
    /// The tests of the grammar's symbols, by id (engine §4).
    pub tests: Vec<SymbolTest>,
    /// For each terminal, the characters it matches if it is a range or a
    /// property, whose name is then its written form (engine §4).
    pub characters: Vec<Option<Characters>>,
    pub start: u32,
    /// For each nonterminal that can occur twice on one chain of
    /// constituents over one span, its cycle: the strongly connected
    /// component of the grammar's unit graph that it lies on, if that
    /// component has a cycle. The edges of the graph lead from a rule to a
    /// symbol of one of its productions whose other symbols can all derive
    /// the empty text. Only the rules of one cycle can complete again below
    /// one another over one span.
    pub cycle: Vec<Option<u32>>,
    /// For each production, one more than the position of its last symbol
    /// that can read in the reconstruction mode of `elision-only`, or 0
    /// where none can (§7.4).
    pub reads_until: Vec<u32>,
    /// The stage's classifiers, resolved for the same features (§2).
    pub classifiers: Arc<ClassifierTables>,
    /// The stage's implications, which apply to each token it emits (§11).
    pub implications: Arc<[Implication]>,
    /// Whether a rule has an elidable optional's terminator, found once so
    /// that a nested query does not look at every rule.
    pub elides: bool,
}

impl Lowered {
    /// The test of the symbol at `dot` of a production, if it has one.
    #[inline]
    pub(crate) fn test(&self, prod: u32, dot: usize) -> Option<&SymbolTest> {
        self.prods[prod as usize].test(dot).map(|test| &self.tests[test as usize])
    }
}

/// A symbol, its capture name and the id of its test.
type Item = (Sym, Option<String>, Option<u32>);
type Sequence = Vec<Item>;

struct HelperDef {
    owner: u32,
    alternative: usize,
    expr: usize,
    prods: Vec<Sequence>,
    elided: Option<(String, Option<u32>)>,
    /// Whether the optional is written `[++T …]` (§3.8).
    maximal: bool,
    /// The helpers of the places written inside this one, in order.
    children: Vec<usize>,
}

struct Lowerer<'a> {
    grammar: &'a StageGrammar,
    terminals: Vec<String>,
    characters: Vec<Option<Characters>>,
    terminal_index: FxMap<String, u32>,
    tests: Vec<SymbolTest>,
    /// The id of each test, so that a test met again is found at once.
    test_index: FxMap<SymbolTest, u32>,
    helpers: Vec<HelperDef>,
    owner: u32,
    alternative: usize,
    /// For each place of sugar being expanded, and the alternative itself at
    /// the bottom, the helpers of the places written inside it so far.
    places: Vec<Vec<usize>>,
    /// Where the alternative being lowered was written: its definition's
    /// document and position (§3).
    written: (Arc<str>, (usize, usize)),
    /// The item of each pair of braces, in the order lowering meets the
    /// braces (§3.3).
    brace_items: Vec<BraceItem>,
}

/// The item of a pair of braces, as its expansions' symbols, with the
/// document and position of the definition that wrote its alternative,
/// and the rule that owns it.
struct BraceItem {
    expansions: Vec<Vec<Sym>>,
    document: Arc<str>,
    at: (usize, usize),
    owner: u32,
}

fn product(mut left: Vec<Sequence>, right: &[Sequence]) -> Vec<Sequence> {
    // With one right sequence, the usual case, each left sequence grows in
    // place, so that a long sequence expands in linear time.
    if let [only] = right {
        for sequence in &mut left {
            sequence.extend(only.iter().cloned());
        }
        return left;
    }
    let mut out = Vec::with_capacity(left.len() * right.len());
    for first in &left {
        for second in right {
            let mut sequence = first.clone();
            sequence.extend(second.iter().cloned());
            out.push(sequence);
        }
    }
    out
}

impl<'a> Lowerer<'a> {
    /// A terminal's id, by its name; `characters` for a range or a
    /// property, whose name is its written form, which no tag has.
    fn terminal(&mut self, name: &str, characters: Option<Characters>) -> u32 {
        if let Some(&id) = self.terminal_index.get(name) {
            return id;
        }
        let id = self.terminals.len() as u32;
        self.terminals.push(name.to_string());
        self.characters.push(characters);
        self.terminal_index.insert(name.to_string(), id);
        id
    }

    /// A test's id: one test for each comparator and value.
    fn test(&mut self, op: &str, value: &Term) -> u32 {
        let test = SymbolTest::new(op, value);
        // One lookup, where a scan of the tests was one step for each.
        work::count(Work::Lowered, 1);
        if let Some(&id) = self.test_index.get(&test) {
            return id;
        }
        let id = self.tests.len() as u32;
        self.test_index.insert(test.clone(), id);
        self.tests.push(test);
        id
    }

    /// The terminator of an elidable optional, the first item of its
    /// content, and the id of its `=` test, if it has one (§3.8). The
    /// reader, or the check of a DOM, has made sure that it is one.
    fn elided_terminal(&mut self, expr: &Expr) -> (String, Option<u32>) {
        let first = match expr {
            Expr::Seq(items) => &items[0],
            other => other,
        };
        match first {
            Expr::Ref(name) | Expr::Terminal(name) => (name.clone(), None),
            Expr::Tested(op, value, inner) => match inner.as_ref() {
                Expr::Ref(name) | Expr::Terminal(name) => (name.clone(), Some(self.test(op, value))),
                _ => unreachable!("an elidable optional begins with its terminator"),
            },
            _ => unreachable!("an elidable optional begins with its terminator"),
        }
    }

    /// Makes the helper of a place whose inside `enter` began.
    fn helper(
        &mut self,
        prods: Vec<Sequence>,
        elided: Option<(String, Option<u32>)>,
        maximal: bool,
        expr: &Expr,
    ) -> Sym {
        let id = (self.grammar.rules.len() + self.helpers.len()) as u32;
        let children = self.places.pop().expect("a place entered");
        self.places.last_mut().expect("an alternative").push(self.helpers.len());
        self.helpers.push(HelperDef {
            owner: self.owner,
            alternative: self.alternative,
            expr: expr as *const Expr as usize,
            prods,
            elided,
            maximal,
            children,
        });
        Sym::N(id)
    }

    fn enter(&mut self) {
        self.places.push(Vec::new());
    }

    fn symbol(&mut self, name: &str, reference: bool) -> Sym {
        if reference && !is_terminal_name(name) {
            Sym::N(self.grammar.index[name] as u32)
        } else {
            Sym::T(self.terminal(name, None))
        }
    }

    /// The expansions of a chain's recursion, or of flat braces' helper:
    /// its base sequences, one for each expansion of the item, then its
    /// recursive ones, one for each expansion of what the recursion adds,
    /// `s x` after `this` from the left, or `x s` before it from the right
    /// (§3.2, §3.3). The places inside the item come before those inside
    /// the separator.
    /// `this` is the chain's rule, or `None` for the helper of flat braces,
    /// whose id follows those of the helpers inside it.
    fn braces(&mut self, item: &Expr, separator: Option<&Expr>, this: Option<Sym>, chain: Chain) -> Vec<Sequence> {
        // The braces are met before the braces inside them.
        let met = self.brace_items.len();
        self.brace_items.push(BraceItem {
            expansions: Vec::new(),
            document: self.written.0.clone(),
            at: self.written.1,
            owner: self.owner,
        });
        let items = self.expand(item);
        self.brace_items[met].expansions =
            items.iter().map(|sequence| sequence.iter().map(|(sym, ..)| *sym).collect()).collect();
        let separators = match separator {
            Some(separator) => self.expand(separator),
            None => vec![Vec::new()],
        };
        let this = this.unwrap_or(Sym::N((self.grammar.rules.len() + self.helpers.len()) as u32));
        let this: Vec<Sequence> = vec![vec![(this, None, None)]];
        let recursive = match chain {
            Chain::Left => product(product(this, &separators), &items),
            Chain::Right => product(product(items.clone(), &separators), &this),
        };
        let mut prods = items;
        prods.extend(recursive);
        prods
    }

    fn expand(&mut self, expr: &Expr) -> Vec<Sequence> {
        match expr {
            Expr::Seq(items) => {
                let mut out = vec![Vec::new()];
                for item in items {
                    let expanded = self.expand(item);
                    out = product(out, &expanded);
                }
                out
            }
            Expr::Choice(items) => {
                let mut out = Vec::new();
                for item in items {
                    out.extend(self.expand(item));
                }
                out
            }
            Expr::And(items) => {
                let expanded: Vec<Vec<Sequence>> = items.iter().map(|item| self.expand(item)).collect();
                let mut out = Vec::new();
                // At most MAX_AND items (§3.2), which stitching checks.
                debug_assert!(items.len() <= crate::grammar::MAX_AND);
                for mask in 1u64..(1u64 << items.len().min(crate::grammar::MAX_AND)) {
                    let mut chosen = vec![Vec::new()];
                    for (bit, options) in expanded.iter().enumerate() {
                        if mask & (1 << bit) != 0 {
                            chosen = product(chosen, options);
                        }
                    }
                    out.extend(chosen);
                }
                out
            }
            // A plain optional that holds a capture expands in place, as
            // `(ε | x)` would: first the empty sequence, then each expansion
            // of `x` (§3.2).
            Expr::Optional(inner, Mark::Plain) if holds_capture(inner) => {
                let mut out = vec![Vec::new()];
                out.extend(self.expand(inner));
                out
            }
            Expr::Optional(inner, mark) => {
                self.enter();
                let body = self.expand(inner);
                // A marked optional is elidable, with the terminal that its
                // marker names, and `++` makes it maximal (§3.8).
                let elided = (*mark != Mark::Plain).then(|| self.elided_terminal(inner));
                let mut prods = vec![Vec::new()];
                prods.extend(body);
                let sym = self.helper(prods, elided, *mark == Mark::Maximal, expr);
                vec![vec![(sym, None, None)]]
            }
            // Flat braces are a helper, `h → x | h s x` (§3.2).
            Expr::Repeat(item, separator, _) => {
                self.enter();
                let prods = self.braces(item, separator.as_deref(), None, Chain::Left);
                let sym = self.helper(prods, None, false, expr);
                vec![vec![(sym, None, None)]]
            }
            Expr::Ref(name) => vec![vec![(self.symbol(name, true), None, None)]],
            Expr::Terminal(name) => vec![vec![(self.symbol(name, false), None, None)]],
            // A range or a property is a terminal whose name is its written
            // form, and which matches by its characters rather than by a
            // tag (engine §4).
            Expr::Range(start, end) => {
                let codes = code_of_character_tag(start).zip(code_of_character_tag(end));
                let (first, last) = codes.expect("a range of two character tags, which reading checks");
                let terminal = self.terminal(&range_name(start, end), Some(Characters::Range(first, last)));
                vec![vec![(Sym::T(terminal), None, None)]]
            }
            Expr::Property(name) => {
                let property = Property::of(name).expect("a property, which reading checks");
                let terminal = self.terminal(&property_name(name), Some(Characters::Property(property)));
                vec![vec![(Sym::T(terminal), None, None)]]
            }
            // A tested symbol lowers to its symbol with the test, and adds
            // no helper (§3).
            Expr::Tested(op, value, inner) => {
                let test = self.test(op, value);
                let mut out = self.expand(inner);
                for sequence in &mut out {
                    if let Some(item) = sequence.first_mut() {
                        item.2 = Some(test);
                    }
                }
                out
            }
            Expr::Capture(name, inner) => {
                let mut out = self.expand(inner);
                for sequence in &mut out {
                    if let Some(item) = sequence.first_mut() {
                        item.1 = Some(name.clone());
                    }
                }
                out
            }
            Expr::Empty => vec![Vec::new()],
        }
    }
}

/// Whether an expression holds a capture, at any depth (§3.5).
fn holds_capture(expr: &Expr) -> bool {
    match expr {
        Expr::Capture(..) => true,
        Expr::Seq(items) | Expr::Choice(items) | Expr::And(items) => items.iter().any(holds_capture),
        Expr::Optional(inner, _) | Expr::Tested(_, _, inner) => holds_capture(inner),
        Expr::Repeat(item, separator, _) => holds_capture(item) || separator.as_deref().is_some_and(holds_capture),
        Expr::Ref(_) | Expr::Terminal(_) | Expr::Range(..) | Expr::Property(_) | Expr::Empty => false,
    }
}

/// A term or condition that mentions a capture the production lacks.
struct Missing;

struct Scope<'a> {
    names: &'a FxMap<String, u32>,
    cap_pos: &'a [usize],
    rules: &'a std::collections::HashMap<String, usize>,
    /// The latest position of a capture mentioned so far.
    last: Option<usize>,
    /// Whether `$` has been mentioned so far.
    whole: bool,
}

impl<'a> Scope<'a> {
    fn span(&mut self, term: &Term) -> Result<Span, Missing> {
        match term {
            Term::Capture(name) if name.is_empty() => {
                self.whole = true;
                Ok(Span::Whole)
            }
            Term::Capture(name) => {
                let &slot = self.names.get(name).ok_or(Missing)?;
                let position = self.cap_pos[slot as usize];
                self.last = Some(self.last.map_or(position, |last| last.max(position)));
                Ok(Span::Cap(slot))
            }
            Term::Call(name, args) => {
                let [Arg::Term(inner)] = &args[..] else { return Err(Missing) };
                let inner = Box::new(self.span(inner)?);
                match name.as_str() {
                    "head" => Ok(Span::Head(inner)),
                    "tail" => Ok(Span::Tail(inner)),
                    "last" => Ok(Span::Last(inner)),
                    "from" => Ok(Span::From(inner)),
                    "after" => Ok(Span::After(inner)),
                    _ => Err(Missing),
                }
            }
            _ => Err(Missing),
        }
    }

    fn rule(&self, name: &str) -> Result<u32, Missing> {
        self.rules.get(name).map(|&index| index as u32).ok_or(Missing)
    }

    fn term(&mut self, term: &Term) -> Result<LTerm, Missing> {
        let list = |scope: &mut Scope, items: &[Term]| {
            items.iter().map(|item| scope.term(item)).collect::<Result<Vec<_>, _>>()
        };
        Ok(match term {
            Term::Str(text) => LTerm::Str(text.clone()),
            Term::Tag(tag) => LTerm::Tag(tag.clone()),
            Term::Range(start, end) => {
                let codes = code_of_character_tag(start).zip(code_of_character_tag(end));
                let (first, last) = codes.expect("a range of two character tags, which reading checks");
                LTerm::Range(first, last)
            }
            Term::EmptySet => LTerm::Empty,
            Term::Union(items) => LTerm::Union(list(self, items)?),
            Term::Intersection(items) => LTerm::Inter(list(self, items)?),
            Term::Difference(left, right) => LTerm::Diff(Box::new(self.term(left)?), Box::new(self.term(right)?)),
            // A span is never a value (§10); the reader refuses one. And
            // stitching gives every constant its value (§2).
            Term::Pattern(_) | Term::Capture(_) | Term::Const(..) => return Err(Missing),
            Term::If(cond, then) => LTerm::If(Box::new(self.cond(cond)?), Box::new(self.term(then)?)),
            Term::Call(name, args) => match (name.as_str(), &args[..]) {
                ("phonemes", [Arg::Term(span)]) => LTerm::Phonemes(self.span(span)?),
                ("text", [Arg::Term(span)]) => LTerm::Text(self.span(span)?),
                ("classes", [Arg::Term(span)]) => LTerm::Classes(self.span(span)?),
                ("tags", [Arg::Term(span)]) => LTerm::Tags(self.span(span)?),
                ("tags", [Arg::Term(span), Arg::Rule(rule)]) => LTerm::TagsRule(self.span(span)?, self.rule(rule)?),
                ("split", [Arg::Term(string), Arg::Term(delimiter)]) => {
                    LTerm::Split(Box::new(self.term(string)?), Box::new(self.term(delimiter)?))
                }
                ("tag", [Arg::Term(name)]) => LTerm::TagOf(Box::new(self.term(name)?)),
                ("classify", [Arg::Term(string), Arg::Classifier(classifier)]) => {
                    LTerm::Classify(Box::new(self.term(string)?), classifier.clone())
                }
                _ => return Err(Missing),
            },
        })
    }

    fn cond(&mut self, cond: &Cond) -> Result<LCond, Missing> {
        Ok(match cond {
            Cond::Compare(op, left, Term::Pattern(p)) if matches!(op.as_str(), "≅" | "≇") => {
                LCond::Tree(self.span(left)?, op == "≅", (**p).clone())
            }
            Cond::Compare(op, left, right) => {
                let op = match op.as_str() {
                    "=" => CmpOp::Eq,
                    "≠" => CmpOp::Ne,
                    "∈" => CmpOp::In,
                    "∉" => CmpOp::NotIn,
                    "⊆" => CmpOp::Subset,
                    "⊈" => CmpOp::NotSubset,
                    _ => return Err(Missing),
                };
                LCond::Cmp(op, self.term(left)?, self.term(right)?)
            }
            Cond::Matches(span, rule) => LCond::Matches(self.span(span)?, self.rule(rule)?),
            Cond::Begins(span, rule) => LCond::Begins(self.span(span)?, self.rule(rule)?),
            Cond::Initial(span) => LCond::Initial(self.span(span)?),
            Cond::Not(inner) => LCond::Not(Box::new(self.cond(inner)?)),
            Cond::Any(items) => LCond::Any(items.iter().map(|item| self.cond(item)).collect::<Result<Vec<_>, _>>()?),
            Cond::All(items) => LCond::All(items.iter().map(|item| self.cond(item)).collect::<Result<Vec<_>, _>>()?),
            Cond::If(antecedent, consequent) => {
                LCond::If(Box::new(self.cond(antecedent)?), Box::new(self.cond(consequent)?))
            }
            // Simplification has decided every presence test (§3.6).
            Cond::Captured(_) => return Err(Missing),
        })
    }
}

/// A production before numbering.
struct Pending {
    rule: u32,
    sequence: Sequence,
    source: Option<(usize, usize)>,
}

/// An error of the grammar found when it is lowered for a set of features
/// (§3): its message, which begins with the document, line and column of
/// the definition that wrote the alternative at fault.
#[derive(Debug, Clone)]
pub(crate) struct LowerError {
    pub message: String,
    pub document: String,
    pub line: usize,
    pub column: usize,
    pub stage: String,
}

impl LowerError {
    fn at(stage: &str, document: &str, (line, column): (usize, usize), message: String) -> LowerError {
        LowerError {
            message: format!("{document}:{line}:{column}: {message}"),
            document: document.to_string(),
            line,
            column,
            stage: stage.to_string(),
        }
    }
}

/// Lowers a stage grammar for a set of features. The check of
/// `elision-only` reads the same productions in a mode of its own (§3.8,
/// §7.4).
pub(crate) fn lower(
    grammar: &StageGrammar,
    features: &BTreeSet<String>,
    classifiers: Arc<ClassifierTables>,
) -> Result<Lowered, LowerError> {
    lower_mode(grammar, features, classifiers, false)
}
pub(crate) fn lower_for_slots(grammar: &StageGrammar) -> Result<Lowered, LowerError> {
    lower_mode(grammar, &BTreeSet::new(), Arc::new(ClassifierTables::default()), true)
}
fn lower_mode(
    grammar: &StageGrammar,
    features: &BTreeSet<String>,
    classifiers: Arc<ClassifierTables>,
    validation: bool,
) -> Result<Lowered, LowerError> {
    let mut lowerer = Lowerer {
        grammar,
        terminals: Vec::new(),
        characters: Vec::new(),
        terminal_index: FxMap::default(),
        tests: Vec::new(),
        test_index: FxMap::default(),
        helpers: Vec::new(),
        owner: 0,
        alternative: 0,
        places: Vec::new(),
        written: (Arc::from(""), (0, 0)),
        brace_items: Vec::new(),
    };
    // Each alternative's own productions, then its helpers in the order
    // their places are written, each followed at once by the helpers
    // inside it, depth first (§3, "Numbering"). Helper productions are
    // filled in once every helper exists.
    enum Slot {
        Own(Pending),
        Helper(usize),
    }
    let mut slots: Vec<Slot> = Vec::new();
    let mut alternatives: Vec<Vec<&StitchedAlternative>> = Vec::new();
    for (index, rule) in grammar.rules.iter().enumerate() {
        lowerer.owner = index as u32;
        // Only a gate drops an alternative; a warning keeps it (§3.1).
        let live: Vec<&StitchedAlternative> = rule
            .alternatives
            .iter()
            .filter(|alternative| {
                validation
                    || alternative.alternative.guards.iter().all(|guard| {
                        guard.kind == FeatureKind::Warning || features.contains(&guard.feature) != guard.negated
                    })
            })
            .collect();
        // A chain is the only alternative of its rule that the gates
        // leave (§3.3); a %extend-rule can add another. This is reported
        // before the rule's alternatives are lowered.
        let chain = live.iter().find(|alternative| matches!(alternative.alternative.expr, Expr::Repeat(_, _, Some(_))));
        if let Some(chain) = chain.filter(|_| !validation && live.len() > 1) {
            return Err(LowerError::at(
                &grammar.name,
                &chain.document,
                chain.at,
                format!(
                    "{} is a chain, which is the whole of its rule, but another alternative stands beside it",
                    rule.name
                ),
            ));
        }
        for (number, alternative) in live.iter().enumerate() {
            lowerer.alternative =
                rule.alternatives.iter().position(|a| std::ptr::eq(a, *alternative)).expect("a written alternative");
            lowerer.places = vec![Vec::new()];
            lowerer.written = (alternative.document.clone(), alternative.at);
            let own = |sequence| Slot::Own(Pending { rule: index as u32, sequence, source: Some((number, 0)) });
            let sequences = match &alternative.alternative.expr {
                // A chain is recursion on the rule itself, with no helper
                // (§3.3).
                Expr::Repeat(item, separator, Some(chain)) => {
                    lowerer.braces(item, separator.as_deref(), Some(Sym::N(index as u32)), *chain)
                }
                expr => lowerer.expand(expr),
            };
            for sequence in sequences {
                slots.push(own(sequence));
            }
            let roots = lowerer.places.pop().expect("the alternative's places");
            let mut stack: Vec<usize> = roots.into_iter().rev().collect();
            while let Some(helper) = stack.pop() {
                slots.push(Slot::Helper(helper));
                stack.extend(lowerer.helpers[helper].children.iter().rev());
            }
        }
        alternatives.push(live);
    }

    let user_count = grammar.rules.len();
    let mut rules: Vec<LRule> = grammar
        .rules
        .iter()
        .map(|rule| LRule {
            name: rule.name.clone(),
            helper: false,
            leftmost_longest: rule.flags.iter().any(|flag| flag == "leftmost-longest"),
            prods: Vec::new(),
            elided: None,
            elided_test: None,
            maximal: false,
        })
        .collect();
    for helper in &lowerer.helpers {
        rules.push(LRule {
            name: grammar.rules[helper.owner as usize].name.clone(),
            helper: true,
            leftmost_longest: false,
            prods: Vec::new(),
            elided: helper.elided.as_ref().map(|(name, _)| name.clone()),
            elided_test: helper.elided.as_ref().and_then(|(_, test)| *test),
            maximal: helper.maximal,
        });
    }
    let mut order: Vec<Pending> = Vec::new();
    for slot in slots {
        match slot {
            Slot::Own(pending) => order.push(pending),
            Slot::Helper(helper) => {
                for sequence in std::mem::take(&mut lowerer.helpers[helper].prods) {
                    order.push(Pending { rule: (user_count + helper) as u32, sequence, source: None });
                }
            }
        }
    }

    // An item of braces that can derive the empty sequence is an error
    // (§3.3), decided over the structural grammar: every production made
    // so far, helpers included, before a false condition removes any, with
    // tests ignored. Every remaining alternative counts, reachable or not.
    let sequences: Vec<(u32, Vec<Sym>)> =
        order.iter().map(|pending| (pending.rule, pending.sequence.iter().map(|(sym, ..)| *sym).collect())).collect();
    let nullable = nullable_rules(rules.len(), sequences.iter().map(|(rule, syms)| (*rule, syms.as_slice())));
    let empty = |nullable: &[bool], syms: &[Sym]| {
        syms.iter().all(|sym| matches!(sym, Sym::N(rule) if nullable[*rule as usize]))
    };
    for item in &lowerer.brace_items {
        if !validation && item.expansions.iter().any(|expansion| empty(&nullable, expansion)) {
            let name = &grammar.rules[item.owner as usize].name;
            return Err(LowerError::at(
                &grammar.name,
                &item.document,
                item.at,
                format!("an item of braces in {name} can match no tokens"),
            ));
        }
    }

    let terminals = std::mem::take(&mut lowerer.terminals);
    let characters = std::mem::take(&mut lowerer.characters);
    let mut prods = Vec::with_capacity(order.len());
    // The splits of the clauses, each made when a production first needs
    // it. They are found by the place of the clause, which every
    // production of its alternatives shares.
    let mut term_splits: FxMap<*const Term, TermSplit> = FxMap::default();
    let mut cond_splits: FxMap<*const Vec<Cond>, CondListSplit> = FxMap::default();
    let mut emit_indexes: FxMap<*const Vec<EmitItem>, EmitIndex> = FxMap::default();
    'productions: for pending in order {
        let syms: Vec<Sym> = pending.sequence.iter().map(|(sym, _, _)| *sym).collect();
        let tests: Vec<u32> = if pending.sequence.iter().any(|(_, _, test)| test.is_some()) {
            pending.sequence.iter().map(|(_, _, test)| test.unwrap_or(NO_TEST)).collect()
        } else {
            Vec::new()
        };
        let mut cap_at = vec![None; syms.len()];
        let mut cap_pos = Vec::new();
        let mut names = FxMap::default();
        for (position, (_, name, _)) in pending.sequence.iter().enumerate() {
            if let Some(name) = name {
                cap_at[position] = Some(cap_pos.len() as u32);
                names.insert(name.clone(), cap_pos.len() as u32);
                cap_pos.push(position);
            }
        }
        let helper = pending.rule as usize >= user_count;
        let owner = if helper { lowerer.helpers[pending.rule as usize - user_count].owner } else { pending.rule };
        let mut production = Prod {
            rule: pending.rule,
            owner,
            visible: !helper && syms.len() != 1,
            syms,
            cap_at,
            cap_pos,
            tests,
            tags: None,
            emit: LEmit::None,
            opaque: false,
            conds: Vec::new(),
            cond_at: Vec::new(),
            warnings: Vec::new(),
            document: None,
            at: (0, 0),
            slot: if grammar.preferences.paths.is_empty() {
                None
            } else {
                Some(Box::new(SlotMetadata {
                    source: if helper {
                        let h = &lowerer.helpers[pending.rule as usize - user_count];
                        (owner as usize, h.alternative)
                    } else {
                        pending
                            .source
                            .map(|(n, _)| {
                                (
                                    owner as usize,
                                    grammar.rules[owner as usize]
                                        .alternatives
                                        .iter()
                                        .position(|a| std::ptr::eq(a, alternatives[owner as usize][n]))
                                        .unwrap(),
                                )
                            })
                            .expect("a written production")
                    },
                    path: helper.then(|| lowerer.helpers[pending.rule as usize - user_count].expr),
                    names: pending
                        .sequence
                        .iter()
                        .filter_map(|(_, n, _)| n.as_ref().map(|n| Some(n.clone())))
                        .collect(),
                    tags: Vec::new(),
                    tag_clauses: [None, None],
                    conditions: Vec::new(),
                    emit: None,
                }))
            },
        };
        if helper {
            if let Some(slot) = &production.slot {
                let source = &grammar.rules[slot.source.0].alternatives[slot.source.1];
                production.document = Some(source.document.clone());
                production.at = source.at;
            }
        }
        if let Some((number, _)) = pending.source {
            let alternative = alternatives[pending.rule as usize][number];
            production.document = Some(alternative.document.clone());
            production.at = alternative.at;
            production.opaque = alternative.opaque;
            production.warnings = alternative
                .alternative
                .guards
                .iter()
                .filter(|guard| guard.kind == FeatureKind::Warning)
                .map(|guard| guard.feature.clone())
                .collect();
            let cap_pos = production.cap_pos.clone();
            let mut scope = Scope { names: &names, cap_pos: &cap_pos, rules: &grammar.index, last: None, whole: false };
            // Every clause is simplified for this production first (§3.6),
            // from its split, which is made once for each clause.
            let has = |name: &str| name.is_empty() || names.contains_key(name);
            let own: Vec<&str> = names.keys().map(String::as_str).collect();
            let each_part = work::mutated(Mutant::LowerEachPart);
            // The union of the alternative's own tags and its definition's
            // (§3.7); with neither written, the default below.
            let tag_clauses = [alternative.alternative.tags.as_ref(), alternative.clauses.tags.as_ref()].map(|term| {
                term.map(|term| {
                    if each_part {
                        // A mutation of the tests simplifies every part
                        // of the term for each production.
                        return simplify_value(term, &has);
                    }
                    let split = term_splits.entry(term as *const Term).or_insert_with(|| TermSplit::new(term));
                    split.simplify(own.iter().copied(), &has).unwrap_or(Term::EmptySet)
                })
            });
            if validation {
                let slot = production.slot.as_mut().expect("slot validation");
                slot.tag_clauses = tag_clauses.clone();
            }
            let written: Vec<Term> = tag_clauses.into_iter().flatten().collect();
            if validation {
                production.slot.as_mut().expect("slot validation").tags = written.clone();
            }
            let tags = match written.len() {
                0 => None,
                1 => written.into_iter().next(),
                _ => Some(Term::Union(written)),
            };
            // The reader has made sure a tag term uses only captures its
            // alternative has, and so every production of it has (§3.3).
            production.tags = tags
                .map(|term| scope.term(&term).unwrap_or_else(|_| unreachable!("a tag term uses a missing capture")));
            let conditions = if each_part {
                let mut left = Vec::new();
                for cond in &alternative.clauses.conditions {
                    match simplify_cond(cond, &has) {
                        Simple::True => {}
                        Simple::False => {
                            if validation {
                                left.push(cond.clone());
                            } else {
                                continue 'productions;
                            }
                        }
                        Simple::Cond(simple) => left.push(simple),
                    }
                }
                left
            } else {
                let conditions = &alternative.clauses.conditions;
                let split =
                    cond_splits.entry(conditions as *const Vec<Cond>).or_insert_with(|| CondListSplit::new(conditions));
                // A condition false for this production removes it.
                match split.simplify(&own, &has) {
                    Some(left) => left,
                    None if validation => alternative.clauses.conditions.clone(),
                    None => continue 'productions,
                }
            };
            for simple in conditions {
                scope.last = None;
                scope.whole = false;
                if let Ok(lowered) = scope.cond(&simple) {
                    // One that uses `$` waits for the item to be complete
                    // (§4).
                    let trigger =
                        if scope.whole { production.syms.len() } else { scope.last.map_or(0, |last| last + 1) };
                    if validation {
                        production.slot.as_mut().expect("slot validation").conditions.push((simple.clone(), trigger));
                    }
                    production.conds.push((lowered, trigger));
                }
            }
            production.emit = match &alternative.clauses.emit {
                None => LEmit::None,
                Some(items) => {
                    // An item whose carrier the production lacks is
                    // dropped, and so is each attachment capture it lacks
                    // (§3.6).
                    let items: Vec<&EmitItem> = if work::mutated(Mutant::LowerItemsByScan) {
                        // A mutation of the tests scans every item for each
                        // production, each counted as it is examined.
                        items
                            .iter()
                            .inspect(|_| work::count(Work::Walked, 1))
                            .filter(|item| match item {
                                EmitItem::Capture(name, ..) => has(name),
                                EmitItem::Insert(_) => true,
                            })
                            .collect()
                    } else {
                        let index =
                            emit_indexes.entry(items as *const Vec<EmitItem>).or_insert_with(|| EmitIndex::new(items));
                        index.kept(own.iter().copied()).into_iter().map(|at| &items[at]).collect()
                    };
                    if validation {
                        production.slot.as_mut().expect("slot validation").emit = Some(
                            items
                                .iter()
                                .map(|item| match item {
                                    EmitItem::Capture(n, t, a) => EmitItem::Capture(
                                        n.clone(),
                                        t.as_ref().map(|t| simplify_value(t, &has)),
                                        crate::dom::Attachments {
                                            before: a.before.iter().filter(|n| has(n)).cloned().collect(),
                                            after: a.after.iter().filter(|n| has(n)).cloned().collect(),
                                        },
                                    ),
                                    _ => (*item).clone(),
                                })
                                .collect(),
                        );
                    }
                    let mut item_tags = |term: &Option<Term>| {
                        term.as_ref().and_then(|term| scope.term(&simplify_value(term, &has)).ok())
                    };
                    let whole = |item: &&EmitItem| match item {
                        EmitItem::Capture(name, ..) => name.is_empty(),
                        EmitItem::Insert(_) => false,
                    };
                    if items.is_empty() {
                        LEmit::Nothing
                    } else if items.iter().all(whole) {
                        LEmit::This(
                            items
                                .iter()
                                .map(|item| match item {
                                    EmitItem::Capture(_, tags, ..) => item_tags(tags),
                                    _ => None,
                                })
                                .collect(),
                        )
                    } else {
                        let slot = |name: &str| names.get(name).copied();
                        // The anchor of an inserted tag is the first written
                        // part of the capture item listed next after it: its
                        // first before-attachment that the production has,
                        // or else its carrier (§11). One backward pass finds
                        // them all.
                        let mut anchors = vec![None; items.len()];
                        let mut next = None;
                        for (index, item) in items.iter().enumerate().rev() {
                            anchors[index] = next;
                            if let EmitItem::Capture(name, _, attachments) = item {
                                if let Some(anchor) =
                                    attachments.before.iter().find_map(|name| slot(name)).or_else(|| slot(name))
                                {
                                    next = Some(anchor);
                                }
                            }
                        }
                        let mut lowered = Vec::with_capacity(items.len());
                        for (index, item) in items.iter().enumerate() {
                            lowered.push(match item {
                                EmitItem::Capture(name, tags, attachments) => {
                                    let slots = |names: &[String]| names.iter().filter_map(|name| slot(name)).collect();
                                    LEmitItem::Cap(
                                        slot(name).expect("a capture the production has"),
                                        item_tags(tags),
                                        slots(&attachments.before),
                                        slots(&attachments.after),
                                    )
                                }
                                EmitItem::Insert(tag) => LEmitItem::Insert(tag.clone(), anchors[index]),
                            });
                        }
                        LEmit::Items(lowered)
                    }
                }
            };
        }
        // A production with one symbol and no tags has its symbol's tags:
        // the symbol is captured (§3.7).
        if production.tags.is_none() && production.syms.len() == 1 && production.cap_at[0].is_none() {
            production.cap_at[0] = Some(production.cap_pos.len() as u32);
            production.cap_pos.push(0);
            if let Some(slot) = &mut production.slot {
                slot.names.push(None);
            }
        }
        // An item finds the conditions of its dot without a scan of all.
        production.conds.sort_by_key(|&(_, trigger)| trigger);
        let mut cond_at = vec![0u32; production.syms.len() + 2];
        for &(_, trigger) in &production.conds {
            cond_at[trigger + 1] += 1;
        }
        for dot in 1..cond_at.len() {
            cond_at[dot] += cond_at[dot - 1];
        }
        production.cond_at = cond_at;
        let number = prods.len() as u32;
        rules[pending.rule as usize].prods.push(number);
        prods.push(production);
    }

    let cycle = cycles(&rules, &prods);
    let reads_until = reads_until(&rules, &prods);
    let tests = std::mem::take(&mut lowerer.tests);
    let elides = rules.iter().any(|rule| rule.elided.is_some());
    Ok(Lowered {
        preferences: grammar.preferences.clone(),
        start: grammar.index["text"] as u32,
        elides,
        rules,
        prods,
        terminals,
        tests,
        characters,
        cycle,
        reads_until,
        classifiers,
        implications: grammar.implications.clone(),
    })
}

/// Which productions can read in the reconstruction mode of the check of
/// `elision-only` (§7.4): for each production, one more than the position
/// of its last symbol that can read, or 0 where none can. A terminal can
/// read; so can a rule with a production that can, and the empty
/// production of an elidable helper, which is the restoration there. The
/// sets are the least that these rules give, so a rule that can read only
/// through itself cannot.
fn reads_until(rules: &[LRule], prods: &[Prod]) -> Vec<u32> {
    let mut reads = vec![false; rules.len()];
    let symbol_reads = |reads: &[bool], symbol: &Sym| match *symbol {
        Sym::T(_) => true,
        Sym::N(rule) => reads[rule as usize],
    };
    // A worklist: the rules that read at once, and then each rule with a
    // production that holds a rule found to read.
    let mut holding: Vec<Vec<u32>> = vec![Vec::new(); rules.len()];
    let mut queue = Vec::new();
    // Each symbol counts as it is examined, so a search that examines more
    // counts more.
    let is_terminal = |symbol: &Sym| {
        work::count(Work::Lowered, 1);
        matches!(symbol, Sym::T(_))
    };
    for production in prods {
        let rule = &rules[production.rule as usize];
        let restoration = production.syms.is_empty() && rule.helper && rule.elided.is_some();
        let mut terminal = false;
        for symbol in &production.syms {
            terminal = if work::mutated(Mutant::TerminalAtEach) {
                production.syms.iter().any(is_terminal)
            } else {
                is_terminal(symbol) || terminal
            };
            if let Sym::N(inner) = *symbol {
                holding[inner as usize].push(production.rule);
            }
        }
        if (restoration || terminal) && !reads[production.rule as usize] {
            reads[production.rule as usize] = true;
            queue.push(production.rule);
        }
    }
    if work::mutated(Mutant::ReadsByPasses) {
        reads_by_passes(prods, &mut reads);
    }
    while let Some(inner) = queue.pop() {
        for &outer in &holding[inner as usize] {
            work::count(Work::Lowered, 1);
            if !reads[outer as usize] {
                reads[outer as usize] = true;
                queue.push(outer);
            }
        }
    }
    let reads_at = |symbol: &Sym| {
        work::count(Work::Lowered, 1);
        symbol_reads(&reads, symbol)
    };
    prods
        .iter()
        .map(|production| {
            let syms = &production.syms;
            if work::mutated(Mutant::LastReadByScans) {
                // The first end after which no symbol reads.
                return (0..=syms.len()).find(|&end| !syms[end..].iter().any(reads_at)).unwrap_or(0) as u32;
            }
            syms.iter().rposition(reads_at).map_or(0, |at| at as u32 + 1)
        })
        .collect()
}

/// A mutation for the tests of work: the rules that read, found by passes
/// over every production until one settles nothing more. Each pass settles
/// at least one rule, so a chain of n rules takes n passes.
fn reads_by_passes(prods: &[Prod], reads: &mut [bool]) {
    loop {
        let mut settled = false;
        for production in prods {
            if reads[production.rule as usize] {
                continue;
            }
            let found = production.syms.iter().any(|symbol| {
                work::count(Work::Lowered, 1);
                match *symbol {
                    Sym::T(_) => true,
                    Sym::N(rule) => reads[rule as usize],
                }
            });
            if found {
                reads[production.rule as usize] = true;
                settled = true;
            }
        }
        if !settled {
            return;
        }
    }
}

/// Which rules derive the empty sequence, from productions given as their
/// rule and symbols. A worklist counts each production's symbols not yet
/// known to be nullable, so each symbol is looked at once or twice, not
/// once in each pass that settles one more rule.
fn nullable_rules<'s>(count: usize, prods: impl Iterator<Item = (u32, &'s [Sym])> + Clone) -> Vec<bool> {
    let mut nullable = vec![false; count];
    let mut owner = Vec::new();
    let mut waiting = Vec::new();
    let mut occurs: Vec<Vec<u32>> = vec![Vec::new(); count];
    let mut queue = Vec::new();
    for (index, (rule, syms)) in prods.clone().enumerate() {
        owner.push(rule);
        // Each occurrence of a rule is paid off once that rule is found
        // nullable. A terminal never is.
        let left = syms.len() as u32;
        for sym in syms {
            work::count(Work::Lowered, 1);
            if let Sym::N(inner) = *sym {
                occurs[inner as usize].push(index as u32);
            }
        }
        waiting.push(left);
        if left == 0 && !nullable[rule as usize] {
            nullable[rule as usize] = true;
            queue.push(rule);
        }
    }
    if work::mutated(Mutant::NullableByPasses) {
        nullable_by_passes(prods, &mut nullable);
    }
    while let Some(inner) = queue.pop() {
        for &index in &occurs[inner as usize] {
            work::count(Work::Lowered, 1);
            waiting[index as usize] -= 1;
            let rule = owner[index as usize];
            if waiting[index as usize] == 0 && !nullable[rule as usize] {
                nullable[rule as usize] = true;
                queue.push(rule);
            }
        }
    }
    nullable
}

/// A mutation for the tests of work: the nullable rules, found by passes
/// over every production until one settles nothing more.
fn nullable_by_passes<'s>(prods: impl Iterator<Item = (u32, &'s [Sym])> + Clone, nullable: &mut [bool]) {
    loop {
        let mut settled = false;
        for (rule, syms) in prods.clone() {
            if nullable[rule as usize] {
                continue;
            }
            let found = syms.iter().all(|symbol| {
                work::count(Work::Lowered, 1);
                matches!(symbol, Sym::N(inner) if nullable[*inner as usize])
            });
            if found {
                nullable[rule as usize] = true;
                settled = true;
            }
        }
        if !settled {
            return;
        }
    }
}

/// For each nonterminal, the cycle of the unit graph that it lies on, if
/// any: the number of its strongly connected component.
fn cycles(rules: &[LRule], prods: &[Prod]) -> Vec<Option<u32>> {
    let count = rules.len();
    let nullable = nullable_rules(count, prods.iter().map(|production| (production.rule, production.syms.as_slice())));
    let mut edges: Vec<Vec<u32>> = vec![Vec::new(); count];
    let mut seen: FxSet<(u32, u32)> = FxSet::default();
    for production in prods {
        // Each test of a symbol counts before it is made, so a search that
        // tests more symbols counts more.
        let syms = &production.syms;
        let stubborn_at = |position: usize| {
            work::count(Work::Lowered, 1);
            !matches!(syms[position], Sym::N(n) if nullable[n as usize])
        };
        // A symbol has an edge when every other symbol is nullable: every
        // symbol where none is not nullable, the one where one is not, and
        // none where two or more are not. One pass finds the first two
        // that are not, where a test of every other symbol at each was n².
        let positions: Vec<usize> = if work::mutated(Mutant::CheckEveryOther) {
            (0..syms.len()).filter(|&at| (0..syms.len()).all(|other| other == at || !stubborn_at(other))).collect()
        } else {
            let mut stubborn = (0..syms.len()).filter(|&at| stubborn_at(at));
            match (stubborn.next(), stubborn.next()) {
                (None, _) => (0..syms.len()).collect(),
                (Some(only), None) => vec![only],
                (Some(_), Some(_)) => Vec::new(),
            }
        };
        for position in positions {
            // Each edge counts as it is added.
            work::count(Work::Lowered, 1);
            if let Sym::N(target) = production.syms[position] {
                if seen.insert((production.rule, target)) {
                    edges[production.rule as usize].push(target);
                }
            }
        }
    }
    // Tarjan's strongly connected components, without recursion.
    let mut index = vec![u32::MAX; count];
    let mut low = vec![0u32; count];
    let mut on_stack = vec![false; count];
    let mut stack = Vec::new();
    let mut cycle = vec![None; count];
    let mut components = 0u32;
    let mut next = 0u32;
    // Each node counts as it is first reached, each edge as it is
    // followed, and each member as it leaves the stack.
    for root in 0..count {
        work::count(Work::Lowered, 1);
        if index[root] != u32::MAX {
            continue;
        }
        let mut work: Vec<(usize, usize)> = vec![(root, 0)];
        index[root] = next;
        low[root] = next;
        next += 1;
        stack.push(root);
        on_stack[root] = true;
        while let Some(&mut (node, ref mut edge)) = work.last_mut() {
            if *edge < edges[node].len() {
                work::count(Work::Lowered, 1);
                let target = edges[node][*edge] as usize;
                *edge += 1;
                if index[target] == u32::MAX {
                    index[target] = next;
                    low[target] = next;
                    next += 1;
                    stack.push(target);
                    on_stack[target] = true;
                    work.push((target, 0));
                } else if on_stack[target] {
                    low[node] = low[node].min(index[target]);
                }
            } else {
                work.pop();
                if let Some(&(parent, _)) = work.last() {
                    low[parent] = low[parent].min(low[node]);
                }
                if low[node] == index[node] {
                    let mut component = Vec::new();
                    if work::mutated(Mutant::ComponentByScan) {
                        // The node's place on the stack, by a scan from
                        // the bottom.
                        let at = stack
                            .iter()
                            .position(|&member| {
                                work::count(Work::Lowered, 1);
                                member == node
                            })
                            .expect("the node on the stack");
                        component = stack.split_off(at);
                        component.iter().for_each(|&member| on_stack[member] = false);
                    } else {
                        loop {
                            work::count(Work::Lowered, 1);
                            let member = stack.pop().expect("a member of the component");
                            on_stack[member] = false;
                            component.push(member);
                            if member == node {
                                break;
                            }
                        }
                    }
                    let is_cycle = component.len() > 1
                        || edges[node].iter().any(|&target| {
                            work::count(Work::Lowered, 1);
                            target == node as u32
                        });
                    if is_cycle {
                        for member in component {
                            cycle[member] = Some(components);
                        }
                        components += 1;
                    }
                }
            }
        }
    }
    cycle
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;
    use std::sync::Arc;

    use super::{lower, LEmit};
    use crate::clauses::definition_problem;
    use crate::dom::{Alternative, Arg, Attachments, Cond, Directive, Dom, EmitItem, Expr, Op, RuleDef, Term};
    use crate::grammar::stitch;
    use crate::unicode::Unicode;
    use crate::work::{assert_linear, assert_mutant_stops, assert_stops, Mutant, Work};

    /// A grammar of a chain of n rules, each nullable and reading only
    /// through the next, a chain of n rules nullable only through the
    /// next, a production of n nullable symbols, one of n symbols that
    /// cannot read and then one that can, and n tested alternatives
    /// lowers in about n. Its nullable rules, the rules that read and the
    /// unit edges are found by worklists, and tests by a map.
    #[test]
    fn lowering_a_long_chain_takes_linear_work() {
        let grammars = [long_chain(2000), long_chain(8000)];
        assert_linear(Work::Lowered, 2000, &mut |n| {
            let lowered = lower(&grammars[usize::from(n != 2000)], &BTreeSet::new(), Arc::default()).expect("lowered");
            assert_eq!(lowered.tests.len(), n);
        });
    }

    /// The grammar of `lowering_a_long_chain_takes_linear_work` for n.
    fn long_chain(n: usize) -> crate::grammar::StageGrammar {
        let unicode = Unicode::parse(crate::loader::bundled("unicode.txt").expect("the table")).expect("the table");
        {
            let rule = |name: String, alternatives: Vec<Expr>| RuleDef {
                deferred_emission: None,
                name,
                op: Op::Define,
                flags: Vec::new(),
                tags: None,
                alternatives: alternatives
                    .into_iter()
                    .map(|expr| Alternative { guards: Vec::new(), expr, tags: None })
                    .collect(),
                emit: None,
                conditions: Vec::new(),
                opaque: false,
                at: (0, 0),
            };
            let tested = (0..n).map(|index| {
                Expr::Tested("=".into(), Term::Str(format!("s{index}")), Box::new(Expr::Terminal("A".into())))
            });
            let wide = Expr::Seq((1..n).map(|index| Expr::Ref(format!("r{index}"))).collect());
            // A reading symbol after n that cannot read.
            let late = Expr::Seq(
                (1..n).map(|index| Expr::Ref(format!("e{index}"))).chain([Expr::Terminal("A".into())]).collect(),
            );
            let mut rules = vec![rule("text".into(), tested.chain([wide, late, Expr::Ref("e1".into())]).collect())];
            rules.extend((1..n).map(|index| {
                let next =
                    if index + 1 < n { Expr::Ref(format!("r{}", index + 1)) } else { Expr::Terminal("A".into()) };
                rule(format!("r{index}"), vec![next, Expr::Empty])
            }));
            // Each pass of a fixpoint over the rules in this order would
            // find only the last of these nullable.
            rules.extend((1..n).map(|index| {
                let next = if index + 1 < n { Expr::Ref(format!("e{}", index + 1)) } else { Expr::Empty };
                rule(format!("e{index}"), vec![next])
            }));
            let directive = Directive { name: "ambiguity-resolution".into(), args: vec!["greedy".into()], at: (0, 0) };
            let dom = Dom {
                rules,
                directives: vec![directive],
                constants: Vec::new(),
                classifiers: Vec::new(),
                implications: Vec::new(),
            };
            stitch("s", &[(Arc::<str>::from("d.md"), Arc::new(dom))], &unicode).expect("a grammar")
        }
    }

    /// Each quadratic version of a step of lowering stops at the first
    /// count past the budget that `lowering_a_long_chain_takes_linear_work`
    /// gives its larger grammar.
    #[test]
    fn quadratic_lowering_stops_at_the_budget() {
        let grammars = [long_chain(2000), long_chain(8000)];
        for mutant in [
            Mutant::TerminalAtEach,
            Mutant::ReadsByPasses,
            Mutant::LastReadByScans,
            Mutant::NullableByPasses,
            Mutant::CheckEveryOther,
            Mutant::ComponentByScan,
        ] {
            assert_mutant_stops(Work::Lowered, mutant, 2000, &mut |n| {
                lower(&grammars[usize::from(n != 2000)], &BTreeSet::new(), Arc::default()).expect("lowered");
            });
        }
    }

    /// A choice of n captures, each its own production, as the reader
    /// gives it. Its tag term is `($c0 ⟹ ~t0) ∪ … ∪ ($c(n−1) ⟹ ~t(n−1))`.
    /// Each production simplifies the term to its one tag, so the output
    /// of the check and of lowering grows with n.
    fn guarded_choice_rule(n: usize) -> RuleDef {
        let captures = (0..n).map(|index| Expr::Capture(format!("c{index}"), Box::new(Expr::Terminal("A".into()))));
        let guards = (0..n).map(|index| {
            Term::If(Box::new(Cond::Captured(format!("c{index}"))), Box::new(Term::Tag(format!("t{index}"))))
        });
        RuleDef {
            deferred_emission: None,
            name: "text".into(),
            op: Op::Define,
            flags: Vec::new(),
            tags: Some(Term::Union(guards.collect())),
            alternatives: vec![Alternative { guards: Vec::new(), expr: Expr::Choice(captures.collect()), tags: None }],
            emit: None,
            conditions: Vec::new(),
            opaque: false,
            at: (0, 0),
        }
    }

    /// Checks the definition of a rule of a choice and lowers it alone. It
    /// gives the productions of the rule, one for each branch.
    fn check_and_lower(rule: &RuleDef, unicode: &Unicode) -> Vec<super::Prod> {
        assert_eq!(definition_problem(rule), None);
        let directive = Directive { name: "ambiguity-resolution".into(), args: vec!["greedy".into()], at: (0, 0) };
        let dom = Dom {
            rules: vec![rule.clone()],
            directives: vec![directive],
            constants: Vec::new(),
            classifiers: Vec::new(),
            implications: Vec::new(),
        };
        let grammar = stitch("s", &[(Arc::<str>::from("d.md"), Arc::new(dom))], unicode).expect("a grammar");
        let lowered = lower(&grammar, &BTreeSet::new(), Arc::default()).expect("lowered");
        let prods: Vec<super::Prod> = lowered.prods.into_iter().filter(|prod| prod.rule == 0).collect();
        let Expr::Choice(choice) = &rule.alternatives[0].expr else { unreachable!("a choice") };
        assert_eq!(prods.len(), choice.len());
        prods
    }

    /// A choice of n captures, each its own production, with the n
    /// conditions `text($ci) = "a"`. Each production keeps the one
    /// condition on its own capture.
    fn conditions_choice_rule(n: usize) -> RuleDef {
        let mut rule = guarded_choice_rule(n);
        rule.tags = None;
        rule.conditions = (0..n)
            .map(|index| {
                let text = Term::Call("text".into(), vec![Arg::Term(Term::Capture(format!("c{index}")))]);
                Cond::Compare("=".into(), text, Term::Str("a".into()))
            })
            .collect();
        rule
    }

    /// A choice of n branches `$ci(A) $di(B)`, with the emission
    /// `$c0 ($d0), …, $c(n−1) ($d(n−1))`. Each production keeps the one
    /// item of its own carrier, and that item attaches its other capture.
    fn emission_choice_rule(n: usize) -> RuleDef {
        let mut rule = guarded_choice_rule(n);
        rule.tags = None;
        let capture = |name: String, terminal: &str| Expr::Capture(name, Box::new(Expr::Terminal(terminal.into())));
        rule.alternatives[0].expr = Expr::Choice(
            (0..n)
                .map(|index| Expr::Seq(vec![capture(format!("c{index}"), "A"), capture(format!("d{index}"), "B")]))
                .collect(),
        );
        rule.emit = Some(
            (0..n)
                .map(|index| {
                    let attachments = Attachments { before: Vec::new(), after: vec![format!("d{index}")] };
                    EmitItem::Capture(format!("c{index}"), None, attachments)
                })
                .collect(),
        );
        rule
    }

    /// The budget of the walks of a choice of n productions whose output
    /// is n: thirty times n and the size of the output. The checks of
    /// captures have eight times that.
    fn choice_budget(n: usize) -> (u64, u64) {
        let size = (n + n) as u64;
        (30 * size, 8 * size)
    }

    /// A rule of a choice, made for n.
    type Choice = fn(usize) -> RuleDef;

    /// A choice with its name and its mutants, each with its count.
    type ChoiceCase = (&'static str, Choice, [(Mutant, Work); 2]);

    /// The rules of the choices whose work grows with n and the output.
    /// Each has the mutants that keep an old scan of every part or item
    /// for each production, with the count that each stops at.
    fn choices() -> [ChoiceCase; 3] {
        [
            (
                "guarded tags",
                guarded_choice_rule,
                [(Mutant::CheckEachPart, Work::Walked), (Mutant::LowerEachPart, Work::Walked)],
            ),
            (
                "conditions",
                conditions_choice_rule,
                [(Mutant::FixedUnindexed, Work::Walked), (Mutant::AppliesByScan, Work::Checked)],
            ),
            (
                "emission",
                emission_choice_rule,
                [(Mutant::LowerItemsByScan, Work::Walked), (Mutant::CheckItemsByScan, Work::Checked)],
            ),
        ]
    }

    /// The check of a definition and lowering handle each choice in work
    /// that grows with n and the output. The runs at n and at 4n each work
    /// under their budget. At 100 and 400, the guarded tags count 3308 and
    /// 13208 walks. The conditions count 4204 and 16804 walks, with 500
    /// and 2000 checks. The emission counts 2304 and 9204 walks, with 1200
    /// and 4800 checks.
    #[test]
    fn choices_check_and_lower_in_their_output() {
        let unicode = Unicode::parse(crate::loader::bundled("unicode.txt").expect("the table")).expect("the table");
        for (name, make, _) in choices() {
            for n in [100, 400] {
                let rule = make(n);
                let (walked, checked) = choice_budget(n);
                crate::work::reset();
                crate::work::budget(Work::Walked, walked);
                crate::work::budget(Work::Checked, checked);
                let prods = check_and_lower(&rule, &unicode);
                crate::work::reset();
                // Each production keeps its one tag, condition or item.
                let kept = prods.iter().all(|prod| match name {
                    "guarded tags" => format!("{:?}", prod.tags).starts_with("Some(Tag("),
                    "conditions" => prod.conds.len() == 1,
                    _ => matches!(&prod.emit, LEmit::Items(items) if items.len() == 1),
                });
                assert!(kept, "{name} at {n}");
            }
        }
    }

    /// Each old scan of every part or item for each production stops at
    /// the first count past the budget of the larger run.
    #[test]
    fn scans_of_every_part_for_each_production_stop_at_the_budget() {
        let unicode = Unicode::parse(crate::loader::bundled("unicode.txt").expect("the table")).expect("the table");
        for (_, make, mutants) in choices() {
            let rule = make(400);
            let (walked, checked) = choice_budget(400);
            for (mutant, work) in mutants {
                let _mutation = crate::work::Mutation::on(mutant);
                let most = if matches!(work, Work::Walked) { walked } else { checked };
                assert_stops(work, most, || {
                    check_and_lower(&rule, &unicode);
                });
            }
        }
    }

    /// A grammar of one rule with random tag terms and conditions over four
    /// captures, which its alternatives have in some productions and not
    /// in others. The parts take every shape that the splits know, and
    /// shapes that they leave to each production.
    fn random_clauses(seed: u64) -> String {
        let mut state = seed;
        let mut below = |n: usize| {
            // SplitMix64.
            state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
            let mut z = state;
            z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
            ((z ^ (z >> 31)) % n as u64) as usize
        };
        const TAGS: [&str; 14] = [
            "($a ⟹ ~x)",
            "~y",
            "∅",
            "tags($a)",
            "($b ⟹ tags($b))",
            "(($a ∧ $b) ⟹ ~z)",
            "(¬$c ⟹ ~w)",
            "($c ⟹ ($d ⟹ ~v))",
            "($a ⟹ ∅)",
            "(~u ∩ ∅)",
            "($d ⟹ (tags($d) ∖ ∅))",
            "($b ⟹ (~x ∩ tags($c)))",
            "($c ⟹ ~y)",
            "(text($) ≠ \"\" ⟹ ~s)",
        ];
        const CONDS: [&str; 17] = [
            "$a",
            "¬$b",
            "($a ⟹ text($a) = \"a\")",
            "text($b) = \"b\"",
            "($c ⟹ $d)",
            "($d ⟹ text($d) ≠ \"\")",
            "text($) ≠ \"\"",
            "($a ⟹ ¬$a)",
            "($b ⟹ text($c) = \"c\")",
            "($c ⟹ text($) ≠ \"\")",
            "($a ⟹ ($b ⟹ text($b) = \"b\"))",
            "(¬$d ⟹ text($) ≠ \"q\")",
            "($d ⟹ ¬$d)",
            "($b ⟹ text($b) ≠ \"\")",
            "text($d) = \"d\"",
            "text($a) ≠ text($c)",
            "(∅ ∩ tags($b)) = ∅",
        ];
        const ALTERNATIVES: [&str; 6] =
            ["$a(A) [$b(B)]", "($c(C) | $d(D))", "$a(A) $c(C)", "[$d(D)] $b(B)", "$a(A) ($b(B) | $c(C)) [$d(D)]", "A"];
        let union = |below: &mut dyn FnMut(usize) -> usize| {
            let parts: Vec<&str> = (0..1 + below(5)).map(|_| TAGS[below(TAGS.len())]).collect();
            parts.join(" ∪ ")
        };
        // The first alternative mostly has every capture, so that few
        // grammars mention one that no alternative captures.
        let alternatives: Vec<String> = (0..1 + below(3))
            .map(|index| {
                let alternative =
                    if index == 0 && below(4) != 0 { ALTERNATIVES[4] } else { ALTERNATIVES[below(ALTERNATIVES.len())] };
                if below(3) == 0 {
                    format!("{alternative} <{}>", union(&mut below))
                } else {
                    alternative.to_string()
                }
            })
            .collect();
        let mut grammar = format!("%ambiguity-resolution greedy\n%rule text {}\n", alternatives.join(" | "));
        if below(4) != 0 {
            grammar.push_str(&format!("%tags {}\n", union(&mut below)));
        }
        let conditions: Vec<String> = (0..below(4))
            .map(|_| {
                let parts: Vec<&str> = (0..1 + below(4)).map(|_| CONDS[below(CONDS.len())]).collect();
                parts.join(if below(2) == 0 { " ∧ " } else { " ∨ " })
            })
            .collect();
        if !conditions.is_empty() {
            grammar.push_str(&format!("%conditions {}\n", conditions.join(", ")));
        }
        if below(4) != 0 {
            grammar.push_str(&format!("%emits {}\n", emission(&mut below)));
        }
        grammar
    }

    /// An emission over the four captures, each named at most once, mostly
    /// in the order the alternatives read them. An item can carry tags or
    /// attach the capture before it, and inserted tags stand among them.
    fn emission(below: &mut dyn FnMut(usize) -> usize) -> String {
        if below(10) == 0 {
            return "$ <~x>".to_string();
        }
        let mut names = vec!["a", "b", "c", "d"];
        if below(5) == 0 {
            names.swap(below(4), below(4));
        }
        let (mut items, mut before): (Vec<String>, Option<&str>) = (Vec::new(), None);
        for name in names {
            if below(5) == 0 {
                items.push("X".to_string());
            }
            match below(8) {
                0 | 1 => {}
                2 | 3 => before = Some(name),
                choice => {
                    let attached = before.take().map_or(String::new(), |before| format!("(${before}) "));
                    let tags = match choice {
                        5 => " <~x>",
                        6 => " <tags($b)>",
                        _ => "",
                    };
                    items.push(format!("{attached}${name}{tags}"));
                }
            }
        }
        if items.is_empty() {
            items.push("$a".to_string());
        }
        items.join(", ")
    }

    /// What loading a grammar gives: its error, or the lowered productions.
    fn loaded(grammar: &str) -> String {
        let sources = [
            ("p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string()),
            ("g.md", format!("```jbogenbau\n{grammar}```\n")),
        ];
        match crate::load_dialect_sources(sources, "p.md") {
            Err(error) => format!("error: {error:?}"),
            Ok(dialect) => format!("{:?}", dialect.lowered_stage(0).prods),
        }
    }

    /// The splits and indexes give what simplifying every part and
    /// scanning every item for each production gives. This holds in the
    /// check of a definition and in lowering. Both give each error, and
    /// each lowered production with its tags, conditions and emission.
    #[test]
    fn splits_simplify_as_every_part_does() {
        let (mut errors, mut lowered, mut emitting) = (0, 0, 0);
        for seed in 0..900 {
            let grammar = random_clauses(seed);
            let split = loaded(&grammar);
            // Lowering runs only where the check passes, so a mutant of
            // lowering cannot change an error of the check.
            let lowering = [Mutant::LowerEachPart, Mutant::FixedUnindexed, Mutant::LowerItemsByScan];
            let checking = [Mutant::CheckEachPart, Mutant::AppliesByScan, Mutant::CheckItemsByScan];
            let both = [checking, lowering].concat();
            let mutants = if split.starts_with("error") { &checking[..] } else { &both[..] };
            for &mutant in mutants {
                let _mutation = crate::work::Mutation::on(mutant);
                assert_eq!(loaded(&grammar), split, "{mutant:?}\n{grammar}");
            }
            if split.starts_with("error") {
                errors += 1;
            } else {
                lowered += 1;
                emitting += usize::from(split.contains("emit: Items("));
            }
        }
        eprintln!("{errors} errors, {lowered} lowered, {emitting} with emitted items");
        assert!(
            errors > 60 && lowered > 60 && emitting > 30,
            "{errors} errors, {lowered} lowered, {emitting} emitting"
        );
    }
}
