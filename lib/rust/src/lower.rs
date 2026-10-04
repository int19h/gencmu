//! Lowering a stitched grammar to the productions the parser runs, given
//! the enabled features (engine §3).

use std::collections::BTreeSet;

use crate::fxhash::FxMap;
use std::sync::Arc;

use crate::clauses::{simplify_cond, simplify_value, Simple};
use crate::dom::{Arg, Chain, Cond, EmitItem, Expr, FeatureKind, Mark, Term};
use crate::grammar::{is_terminal_name, ClassifierTables, Implication, StageGrammar, StitchedAlternative};
use crate::tags::{code_of_character_tag, property_name, range_name};
use crate::unicode::Property;

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
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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
#[derive(Debug, Clone, PartialEq, Eq)]
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
}

#[derive(Debug, Clone)]
pub(crate) struct LRule {
    /// The rule's name, or for a helper the name of the rule that owns it.
    pub name: String,
    pub helper: bool,
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

    /// The conditions evaluated at `dot`, in written order.
    #[inline]
    pub(crate) fn conds_at(&self, dot: usize) -> &[(LCond, usize)] {
        &self.conds[self.cond_at[dot] as usize..self.cond_at[dot + 1] as usize]
    }
}

#[derive(Debug, Clone)]
pub(crate) struct Lowered {
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
    helpers: Vec<HelperDef>,
    owner: u32,
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
        match self.tests.iter().position(|known| *known == test) {
            Some(id) => id as u32,
            None => {
                self.tests.push(test);
                (self.tests.len() - 1) as u32
            }
        }
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
    fn helper(&mut self, prods: Vec<Sequence>, elided: Option<(String, Option<u32>)>, maximal: bool) -> Sym {
        let id = (self.grammar.rules.len() + self.helpers.len()) as u32;
        let children = self.places.pop().expect("a place entered");
        self.places.last_mut().expect("an alternative").push(self.helpers.len());
        self.helpers.push(HelperDef { owner: self.owner, prods, elided, maximal, children });
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
                let sym = self.helper(prods, elided, *mark == Mark::Maximal);
                vec![vec![(sym, None, None)]]
            }
            // Flat braces are a helper, `h → x | h s x` (§3.2).
            Expr::Repeat(item, separator, _) => {
                self.enter();
                let prods = self.braces(item, separator.as_deref(), None, Chain::Left);
                let sym = self.helper(prods, None, false);
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
            Term::Capture(_) | Term::Const(..) => return Err(Missing),
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
}

impl LowerError {
    fn at(document: &str, (line, column): (usize, usize), message: String) -> LowerError {
        LowerError { message: format!("{document}:{line}:{column}: {message}") }
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
    let mut lowerer = Lowerer {
        grammar,
        terminals: Vec::new(),
        characters: Vec::new(),
        terminal_index: FxMap::default(),
        tests: Vec::new(),
        helpers: Vec::new(),
        owner: 0,
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
                alternative.alternative.guards.iter().all(|guard| {
                    guard.kind == FeatureKind::Warning || features.contains(&guard.feature) != guard.negated
                })
            })
            .collect();
        // A chain is the only alternative of its rule that the gates
        // leave (§3.3); a %extend-rule can add another. This is reported
        // before the rule's alternatives are lowered.
        let chain = live.iter().find(|alternative| matches!(alternative.alternative.expr, Expr::Repeat(_, _, Some(_))));
        if let Some(chain) = chain.filter(|_| live.len() > 1) {
            return Err(LowerError::at(
                &chain.document,
                chain.at,
                format!(
                    "{} is a chain, which is the whole of its rule, but another alternative stands beside it",
                    rule.name
                ),
            ));
        }
        for (number, alternative) in live.iter().enumerate() {
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
    let mut nullable = vec![false; rules.len()];
    let empty = |nullable: &[bool], syms: &[Sym]| {
        syms.iter().all(|sym| matches!(sym, Sym::N(rule) if nullable[*rule as usize]))
    };
    loop {
        let mut changed = false;
        for pending in &order {
            let syms: Vec<Sym> = pending.sequence.iter().map(|(sym, ..)| *sym).collect();
            if !nullable[pending.rule as usize] && empty(&nullable, &syms) {
                nullable[pending.rule as usize] = true;
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    for item in &lowerer.brace_items {
        if item.expansions.iter().any(|expansion| empty(&nullable, expansion)) {
            let name = &grammar.rules[item.owner as usize].name;
            return Err(LowerError::at(
                &item.document,
                item.at,
                format!("an item of braces in {name} can match no tokens"),
            ));
        }
    }

    let terminals = std::mem::take(&mut lowerer.terminals);
    let characters = std::mem::take(&mut lowerer.characters);
    let mut prods = Vec::with_capacity(order.len());
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
        };
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
            // Every clause is simplified for this production first (§3.6).
            let has = |name: &str| name.is_empty() || names.contains_key(name);
            // The union of the alternative's own tags and its definition's
            // (§3.7); with neither written, the default below.
            let written: Vec<Term> = [alternative.alternative.tags.as_ref(), alternative.rule_tags.as_ref()]
                .into_iter()
                .flatten()
                .map(|term| simplify_value(term, &has))
                .collect();
            let tags = match written.len() {
                0 => None,
                1 => written.into_iter().next(),
                _ => Some(Term::Union(written)),
            };
            // The reader has made sure a tag term uses only captures its
            // alternative has, and so every production of it has (§3.3).
            production.tags = tags
                .map(|term| scope.term(&term).unwrap_or_else(|_| unreachable!("a tag term uses a missing capture")));
            for cond in &alternative.conditions {
                let simple = match simplify_cond(cond, &has) {
                    Simple::True => continue,
                    // A condition false for this production removes it.
                    Simple::False => continue 'productions,
                    Simple::Cond(simple) => simple,
                };
                scope.last = None;
                scope.whole = false;
                if let Ok(lowered) = scope.cond(&simple) {
                    // One that uses `$` waits for the item to be complete
                    // (§4).
                    let trigger =
                        if scope.whole { production.syms.len() } else { scope.last.map_or(0, |last| last + 1) };
                    production.conds.push((lowered, trigger));
                }
            }
            production.emit = match &alternative.emit {
                None => LEmit::None,
                Some(items) => {
                    // An item whose carrier the production lacks is
                    // dropped, and so is each attachment capture it lacks
                    // (§3.6).
                    let items: Vec<&EmitItem> = items
                        .iter()
                        .filter(|item| match item {
                            EmitItem::Capture(name, ..) => has(name),
                            EmitItem::Insert(_) => true,
                        })
                        .collect();
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
                                EmitItem::Insert(tag) => {
                                    // The anchor is the first written part
                                    // of the capture item listed next after
                                    // the tag: its first before-attachment
                                    // that the production has, or else its
                                    // carrier (§11).
                                    let anchor = items[index + 1..].iter().find_map(|item| match item {
                                        EmitItem::Capture(name, _, attachments) => {
                                            attachments.before.iter().find_map(|name| slot(name)).or_else(|| slot(name))
                                        }
                                        EmitItem::Insert(_) => None,
                                    });
                                    LEmitItem::Insert(tag.clone(), anchor)
                                }
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
    loop {
        let mut changed = false;
        for production in prods {
            if reads[production.rule as usize] {
                continue;
            }
            let rule = &rules[production.rule as usize];
            let restoration = production.syms.is_empty() && rule.helper && rule.elided.is_some();
            if restoration || production.syms.iter().any(|symbol| symbol_reads(&reads, symbol)) {
                reads[production.rule as usize] = true;
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    prods
        .iter()
        .map(|production| {
            production.syms.iter().rposition(|symbol| symbol_reads(&reads, symbol)).map_or(0, |at| at as u32 + 1)
        })
        .collect()
}

/// For each nonterminal, the cycle of the unit graph that it lies on, if
/// any: the number of its strongly connected component.
fn cycles(rules: &[LRule], prods: &[Prod]) -> Vec<Option<u32>> {
    let count = rules.len();
    let mut nullable = vec![false; count];
    loop {
        let mut changed = false;
        for production in prods {
            if !nullable[production.rule as usize]
                && production.syms.iter().all(|sym| matches!(sym, Sym::N(n) if nullable[*n as usize]))
            {
                nullable[production.rule as usize] = true;
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    let mut edges: Vec<Vec<u32>> = vec![Vec::new(); count];
    for production in prods {
        for (position, sym) in production.syms.iter().enumerate() {
            if let Sym::N(target) = sym {
                let others_nullable = production
                    .syms
                    .iter()
                    .enumerate()
                    .all(|(other, sym)| other == position || matches!(sym, Sym::N(n) if nullable[*n as usize]));
                if others_nullable && !edges[production.rule as usize].contains(target) {
                    edges[production.rule as usize].push(*target);
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
    for root in 0..count {
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
                    loop {
                        let member = stack.pop().expect("a member of the component");
                        on_stack[member] = false;
                        component.push(member);
                        if member == node {
                            break;
                        }
                    }
                    let is_cycle = component.len() > 1 || edges[node].contains(&(node as u32));
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
