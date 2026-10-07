//! A property test of the ranking (engine §6): random small grammars and
//! inputs, every derivation enumerated by brute force, and the verdict,
//! first reading, second reading and witness computed straight from the
//! definitions, compared with the library's. The rule of the ranking is
//! `greedy`, `lazy` or `late-elision`.
//!
//! `GENCMU_PROPERTY_CASES` sets how many cases to run (default 3000) and
//! `GENCMU_PROPERTY_SEED` the first seed; a failing case prints its seed,
//! grammar and tokens.

mod common;

use std::collections::{BTreeMap, HashMap};
use std::rc::Rc;

use common::parse_json;
use gencmu::tools::DOM_FORMAT;

/// SplitMix64: small, and good enough to pick grammars.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }

    fn chance(&mut self, percent: usize) -> bool {
        self.below(100) < percent
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
enum Sym {
    T(usize),
    N(usize),
}

/// An item of an alternative as written: a symbol, `[s]`, `[+T]`, `{s}`,
/// `[{s}]` or `{s \ T}`, or a rule tested by its sound, `r="x"` or
/// `r≠"x"`.
#[derive(Debug, Clone, Copy)]
enum Item {
    Plain(Sym),
    /// A rule and whether its test is `="x"` (true) or `≠"x"` (false).
    Tested(usize, bool),
    Optional(Sym),
    /// `[+T]`, an elidable optional of the terminal (engine §3.8).
    Elidable(usize),
    Repeat(Sym),
    OptionalRepeat(Sym),
    /// `{s \ T}`, a list separated by a terminal.
    Separated(Sym, usize),
}

/// A rule written as a chain, `{... x \ s}` from the left or
/// `{x ... \ s}` from the right (engine §3.3).
#[derive(Debug, Clone, Copy)]
struct Chain {
    left: bool,
    item: Sym,
    separator: Sym,
}

const RULES: [&str; 4] = ["text", "a", "b", "c"];
const TERMINALS: [&str; 3] = ["A", "B", "C"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Lean {
    Greedy,
    Lazy,
    /// A derivation beats another when its elision vector is less.
    LateElision,
    /// No lean: any two derivations that differ are tied, as the
    /// `elision-only` check ranks (§7).
    Neither,
}

/// The grammar as written.
struct Source {
    rules: Vec<Vec<(Vec<Item>, Option<&'static str>)>>,
    /// The rules written as chains, whose alternatives are not used.
    chains: Vec<Option<Chain>>,
    greedy: Vec<bool>,
    lean: Lean,
    elision_only: bool,
    /// Whether every generated elidable optional uses `[++T]` (§4).
    maximal: bool,
}

/// A nonterminal of the lowered grammar: a rule, or a helper owned by one.
struct LRule {
    prods: Vec<usize>,
    helper: bool,
    owner: usize,
    /// For the helper of `[+T]`: `T`.
    elided: Option<usize>,
}

struct LProd {
    rule: usize,
    syms: Vec<Sym>,
    /// The test of each symbol: `Some(true)` for `="x"`, `Some(false)` for
    /// `≠"x"`.
    tests: Vec<Option<bool>>,
}

/// The grammar lowered as engine §3 says, independently of the library.
struct Grammar {
    rules: Vec<LRule>,
    prods: Vec<LProd>,
    lean: Lean,
    elision_only: bool,
    maximal: bool,
    /// The item of each pair of braces, which must not derive the empty
    /// sequence (engine §3.3).
    brace_items: Vec<Sym>,
}

fn symbol(rng: &mut Rng, rule: usize, rule_count: usize, terminal_count: usize, position: usize, length: usize) -> Sym {
    if position == 0 && length > 1 && rng.chance(20) {
        Sym::N(rule)
    } else if rng.chance(45) {
        Sym::N(rng.below(rule_count))
    } else {
        Sym::T(rng.below(terminal_count))
    }
}

/// A random input: each token's tags, and whether it sounds `x` (or `y`).
type Input = (Vec<Vec<usize>>, Vec<bool>);

fn generate(rng: &mut Rng) -> (Source, Input) {
    let rule_count = 1 + rng.below(4);
    let terminal_count = 1 + rng.below(3);
    let lean = match rng.below(10) {
        0..=3 => Lean::Greedy,
        4..=6 => Lean::Lazy,
        _ => Lean::LateElision,
    };
    let late = lean == Lean::LateElision;
    let elision_only = lean == Lean::Greedy && rng.chance(25);
    // Under late-elision, and now and then under another rule, a terminal
    // is elidable, and then now and then the stage declares maximal.
    let elidable = if !elision_only && (late || rng.chance(30)) { Some(rng.below(terminal_count)) } else { None };
    let maximal = elidable.is_some() && rng.chance(50);
    let sugar = elidable.is_some() || rng.chance(40);
    // A rule reference, now and then tested by its sound (§4).
    let reference = |rng: &mut Rng, rule: usize| match rng.below(20) {
        0..=2 => Item::Tested(rule, true),
        3..=4 => Item::Tested(rule, false),
        _ => Item::Plain(Sym::N(rule)),
    };
    let mut rules = Vec::new();
    for rule in 0..rule_count {
        let mut alternatives = Vec::new();
        for _ in 0..1 + rng.below(3) {
            let length = [0, 1, 1, 2, 2, 3][rng.below(6)];
            let mut items = Vec::new();
            for position in 0..length {
                let sym = symbol(rng, rule, rule_count, terminal_count, position, length);
                match (sugar, rng.below(10), elidable) {
                    (true, 0, _) => items.push(Item::Optional(sym)),
                    (true, 1, _) => items.push(Item::Repeat(sym)),
                    (true, 2, _) if rng.chance(60) => items.push(Item::OptionalRepeat(sym)),
                    (true, 2, _) => items.push(Item::Separated(sym, rng.below(terminal_count))),
                    // An elidable optional, often right after a rule, whose
                    // constituent maximal tests.
                    (true, 3 | 4, Some(t)) => {
                        // The rule before it is often tested, so that
                        // maximal's test of a longer constituent matters.
                        if rng.chance(70) {
                            let rule = rng.below(rule_count);
                            items.push(match rng.below(4) {
                                0 => Item::Tested(rule, true),
                                1 => Item::Tested(rule, false),
                                _ => Item::Plain(Sym::N(rule)),
                            });
                        }
                        items.push(Item::Elidable(t));
                    }
                    _ => items.push(match sym {
                        Sym::N(rule) => reference(rng, rule),
                        _ => Item::Plain(sym),
                    }),
                }
            }
            let tags = if rng.chance(15) { Some(if rng.chance(50) { "X" } else { "Y" }) } else { None };
            alternatives.push((items, tags));
        }
        rules.push(alternatives);
    }
    // Now and then a rule other than text is a chain, whose levels are its
    // own nodes (engine §3.3).
    let mut chains = vec![None];
    for _ in 1..rule_count {
        let item = |rng: &mut Rng| {
            if rng.chance(50) {
                Sym::T(rng.below(terminal_count))
            } else {
                Sym::N(rng.below(rule_count))
            }
        };
        chains.push(match rng.below(20) {
            0 => Some(Chain { left: true, item: item(rng), separator: item(rng) }),
            1 => Some(Chain { left: false, item: item(rng), separator: item(rng) }),
            _ => None,
        });
    }
    let greedy = (0..rule_count).map(|_| rng.chance(35)).collect();
    let source = Source { rules, chains, greedy, lean, elision_only, maximal };
    let grammar = lower(&source);
    // Most inputs are sentences of the grammar, so that most cases parse.
    // Now and then the input is empty.
    let mut sentence = Vec::new();
    if !rng.chance(20) && !sample(&grammar, rng, 0, 0, &mut sentence) {
        sentence.clear();
    }
    if sentence.is_empty() && rng.chance(50) {
        sentence = (0..rng.below(5)).map(|_| rng.below(terminal_count)).collect();
    }
    if rng.chance(8) {
        sentence.clear();
    }
    sentence.truncate(6);
    let tokens: Vec<Vec<usize>> = sentence
        .into_iter()
        .map(|terminal| {
            let mut tags = vec![terminal];
            if rng.chance(40) {
                let other = rng.below(terminal_count);
                if other != terminal {
                    tags.push(other);
                }
            }
            tags
        })
        .collect();
    let sounds = tokens.iter().map(|_| rng.chance(60)).collect();
    (source, (tokens, sounds))
}

/// A production waiting for its number: its rule, its symbols and their
/// tests.
type Pending = (usize, Vec<Sym>, Vec<Option<bool>>);

/// Lowers the grammar (engine §3): a helper per optional or flat braces,
/// `[{s}]` an optional around the helper of `{s}`, a chain recursion on
/// its own rule, and each alternative's own productions numbered before
/// its helpers, which follow in the order their places are written, those
/// inside a helper right after it.
fn lower(source: &Source) -> Grammar {
    let user = source.rules.len();
    let mut rules: Vec<LRule> =
        (0..user).map(|owner| LRule { prods: Vec::new(), helper: false, owner, elided: None }).collect();
    let mut helper_prods: Vec<Vec<Vec<Sym>>> = Vec::new();
    let mut pending: Vec<Pending> = Vec::new();
    let untested = |syms: &[Sym]| vec![None; syms.len()];
    // The helpers of the alternative being lowered, in written order.
    let mut places: Vec<usize> = Vec::new();
    fn helper(
        (rules, helper_prods): (&mut Vec<LRule>, &mut Vec<Vec<Vec<Sym>>>),
        owner: usize,
        prods: Vec<Vec<Sym>>,
        elided: Option<usize>,
    ) -> Sym {
        rules.push(LRule { prods: Vec::new(), helper: true, owner, elided });
        helper_prods.push(prods);
        Sym::N(rules.len() - 1)
    }
    let mut brace_items = Vec::new();
    for (rule, alternatives) in source.rules.iter().enumerate() {
        if let Some(chain) = source.chains[rule] {
            brace_items.push(chain.item);
            let none = |length| vec![None; length];
            pending.push((rule, vec![chain.item], none(1)));
            let recursive = if chain.left {
                vec![Sym::N(rule), chain.separator, chain.item]
            } else {
                vec![chain.item, chain.separator, Sym::N(rule)]
            };
            pending.push((rule, recursive, none(3)));
            continue;
        }
        for (items, _) in alternatives {
            let first_helper = rules.len();
            let mut syms = Vec::new();
            let mut tests = Vec::new();
            for item in items {
                tests.push(match *item {
                    Item::Tested(_, eq) => Some(eq),
                    _ => None,
                });
                let mut make = |prods, elided| helper((&mut rules, &mut helper_prods), rule, prods, elided);
                syms.push(match *item {
                    Item::Plain(sym) => sym,
                    Item::Tested(rule, _) => Sym::N(rule),
                    Item::Optional(sym) => make(vec![vec![], vec![sym]], None),
                    Item::Elidable(t) => make(vec![vec![], vec![Sym::T(t)]], Some(t)),
                    Item::Repeat(sym) => {
                        brace_items.push(sym);
                        let id = Sym::N(rules.len());
                        helper((&mut rules, &mut helper_prods), rule, vec![vec![sym], vec![id, sym]], None)
                    }
                    Item::Separated(sym, t) => {
                        brace_items.push(sym);
                        let id = Sym::N(rules.len());
                        helper((&mut rules, &mut helper_prods), rule, vec![vec![sym], vec![id, Sym::T(t), sym]], None)
                    }
                    Item::OptionalRepeat(sym) => {
                        // The optional's helper, then the helper of the
                        // braces inside it.
                        brace_items.push(sym);
                        let inner = Sym::N(rules.len() + 1);
                        let optional = helper((&mut rules, &mut helper_prods), rule, vec![vec![], vec![inner]], None);
                        helper((&mut rules, &mut helper_prods), rule, vec![vec![sym], vec![inner, sym]], None);
                        optional
                    }
                });
            }
            pending.push((rule, syms, tests));
            places.extend(first_helper..rules.len());
            for id in places.drain(..) {
                for syms in &helper_prods[id - user] {
                    pending.push((id, syms.clone(), untested(syms)));
                }
            }
        }
    }
    let mut prods: Vec<LProd> = Vec::new();
    for (rule, syms, tests) in pending {
        rules[rule].prods.push(prods.len());
        prods.push(LProd { rule, syms, tests });
    }
    Grammar { rules, prods, lean: source.lean, elision_only: source.elision_only, maximal: source.maximal, brace_items }
}

/// Appends a random sentence of `rule` to `out`; false if it grew too deep.
fn sample(grammar: &Grammar, rng: &mut Rng, rule: usize, depth: usize, out: &mut Vec<usize>) -> bool {
    if depth > 8 || out.len() > 8 {
        return false;
    }
    let alternatives = &grammar.rules[rule].prods;
    let prod = alternatives[rng.below(alternatives.len())];
    for sym in grammar.prods[prod].syms.clone() {
        match sym {
            Sym::T(terminal) => out.push(terminal),
            Sym::N(inner) => {
                if !sample(grammar, rng, inner, depth + 1, out) {
                    return false;
                }
            }
        }
    }
    true
}

fn item_text(item: &Item) -> String {
    let name = |sym: &Sym| match sym {
        Sym::T(t) => TERMINALS[*t].to_string(),
        Sym::N(n) => RULES[*n].to_string(),
    };
    match item {
        Item::Plain(sym) => name(sym),
        Item::Tested(rule, eq) => format!("{}{}\"x\"", RULES[*rule], if *eq { "=" } else { "≠" }),
        Item::Optional(sym) => format!("[{}]", name(sym)),
        Item::Elidable(t) => format!("[+{}]", TERMINALS[*t]),
        Item::Repeat(sym) => format!("{{{}}}", name(sym)),
        Item::OptionalRepeat(sym) => format!("[{{{}}}]", name(sym)),
        Item::Separated(sym, t) => format!("{{{} \\ {}}}", name(sym), TERMINALS[*t]),
    }
}

fn grammar_text(source: &Source) -> String {
    let mut text = String::new();
    text.push_str(match (source.lean, source.elision_only) {
        (Lean::Lazy, _) => "%ambiguity-resolution lazy",
        (Lean::LateElision, _) => "%ambiguity-resolution late-elision",
        (_, true) => "%ambiguity-resolution greedy elision-only",
        _ => "%ambiguity-resolution greedy",
    });
    text.push('\n');
    let name = |sym: &Sym| match sym {
        Sym::T(t) => TERMINALS[*t],
        Sym::N(n) => RULES[*n],
    };
    for (rule, alternatives) in source.rules.iter().enumerate() {
        let flag = if source.greedy[rule] { "(greedy)" } else { "" };
        if let Some(chain) = source.chains[rule] {
            let (item, separator) = (name(&chain.item), name(&chain.separator));
            let body = if chain.left {
                format!("{{... {item} \\ {separator}}}")
            } else {
                format!("{{{item} ... \\ {separator}}}")
            };
            text.push_str(&format!("%rule{flag} {} {body}\n", RULES[rule]));
            continue;
        }
        let bodies: Vec<String> = alternatives
            .iter()
            .map(|(items, tags)| {
                let mut body: Vec<String> = items
                    .iter()
                    .map(|item| {
                        let text = item_text(item);
                        if source.maximal {
                            text.replace("[+", "[++")
                        } else {
                            text
                        }
                    })
                    .collect();
                if body.is_empty() {
                    body.push("ε".to_string());
                }
                if let Some(tags) = tags {
                    body.push(format!("<{tags}>"));
                }
                body.join(" ")
            })
            .collect();
        text.push_str(&format!("%rule{flag} {} {}\n", RULES[rule], bodies.join(" | ")));
    }
    text
}

/// The grammar's DOM (docs/output.md), for a `compiled.json` that spares
/// each case reading its grammar through the notation.
fn grammar_dom(source: &Source) -> String {
    let reference = |sym: &Sym| match sym {
        Sym::T(t) => format!("{{\"ref\":\"{}\"}}", TERMINALS[*t]),
        Sym::N(n) => format!("{{\"ref\":\"{}\"}}", RULES[*n]),
    };
    let first_rule_line = 3;
    let mut rules = Vec::new();
    for (rule, alternatives) in source.rules.iter().enumerate() {
        let flags = if source.greedy[rule] { "[\"greedy\"]" } else { "[]" };
        if let Some(chain) = source.chains[rule] {
            let direction = if chain.left { "left" } else { "right" };
            rules.push(format!(
                "{{\"name\":\"{}\",\"op\":\"define\",\"flags\":{flags},\"alternatives\":[{{\"guards\":[],\"expr\":{{\"repeat\":{},\"separator\":{},\"chain\":\"{direction}\"}}}}],\"conditions\":[],\"at\":[{},1]}}",
                RULES[rule],
                reference(&chain.item),
                reference(&chain.separator),
                rule + first_rule_line
            ));
            continue;
        }
        let alternatives: Vec<String> = alternatives
            .iter()
            .map(|(items, tags)| {
                let parts: Vec<String> = items
                    .iter()
                    .map(|item| match item {
                        Item::Plain(sym) => reference(sym),
                        Item::Tested(rule, eq) => format!(
                            "{{\"test\":\"{}\",\"value\":{{\"string\":\"x\"}},\"expr\":{}}}",
                            if *eq { "=" } else { "≠" },
                            reference(&Sym::N(*rule))
                        ),
                        Item::Optional(sym) => format!("{{\"optional\":{}}}", reference(sym)),
                        Item::Elidable(t) => {
                            format!(
                                "{{\"optional\":{},\"elidable\":true{}}}",
                                reference(&Sym::T(*t)),
                                if source.maximal { ",\"maximal\":true" } else { "" }
                            )
                        }
                        Item::Repeat(sym) => format!("{{\"repeat\":{}}}", reference(sym)),
                        Item::OptionalRepeat(sym) => format!("{{\"optional\":{{\"repeat\":{}}}}}", reference(sym)),
                        Item::Separated(sym, t) => {
                            format!("{{\"repeat\":{},\"separator\":{}}}", reference(sym), reference(&Sym::T(*t)))
                        }
                    })
                    .collect();
                let expr = match parts.len() {
                    0 => "{\"empty\":true}".to_string(),
                    1 => parts[0].clone(),
                    _ => format!("{{\"seq\":[{}]}}", parts.join(",")),
                };
                let tags = tags.map_or(String::new(), |tags| format!(",\"tags\":{{\"tag\":\"{tags}\"}}"));
                format!("{{\"guards\":[],\"expr\":{expr}{tags}}}")
            })
            .collect();
        rules.push(format!(
            "{{\"name\":\"{}\",\"op\":\"define\",\"flags\":{flags},\"alternatives\":[{}],\"conditions\":[],\"at\":[{},1]}}",
            RULES[rule],
            alternatives.join(","),
            rule + first_rule_line
        ));
    }
    let args = match (source.lean, source.elision_only) {
        (Lean::Lazy, _) => "\"lazy\"",
        (Lean::LateElision, _) => "\"late-elision\"",
        (_, true) => "\"greedy\",\"elision-only\"",
        _ => "\"greedy\"",
    };
    let args = args.to_string();
    let directives = [format!("{{\"name\":\"ambiguity-resolution\",\"args\":[{args}],\"at\":[2,1]}}")];
    format!(
        "{{\"format\":{DOM_FORMAT},\"rules\":[{}],\"directives\":[{}],\"constants\":[],\"classifiers\":[],\"implications\":[]}}",
        rules.join(","),
        directives.join(",")
    )
}

// ---- derivations by brute force

enum Child {
    Read(usize, usize),
    Node(Rc<Derivation>),
}

struct Derivation {
    prod: usize,
    start: usize,
    end: usize,
    children: Vec<Child>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Act {
    Read { token: usize, terminal: usize },
    Close { prod: usize, start: usize, end: usize, visible: bool },
}

impl Act {
    fn visible(&self) -> bool {
        !matches!(self, Act::Close { visible: false, .. })
    }
}

struct TooMany;

type Derivations = Rc<Vec<Rc<Derivation>>>;

/// Enumerates the derivations that count (§4): no cyclic one, and under
/// `maximal` none with an elided terminator whose constituent could have
/// been longer.
struct Enumerator<'a> {
    grammar: &'a Grammar,
    tokens: &'a [Vec<usize>],
    /// Whether each token sounds `x`, or else `y`.
    sounds: &'a [bool],
    /// Whether `maximal` applies, with every derivation, cyclic or not,
    /// that says which constituents complete where.
    maximal: bool,
    memo: HashMap<(usize, usize, usize, Vec<usize>), Derivations>,
    completes: HashMap<(usize, usize, usize), bool>,
    budget: usize,
}

impl<'a> Enumerator<'a> {
    fn new(grammar: &'a Grammar, tokens: &'a [Vec<usize>], sounds: &'a [bool], maximal: bool) -> Enumerator<'a> {
        Enumerator { grammar, tokens, sounds, maximal, memo: HashMap::new(), completes: HashMap::new(), budget: 20_000 }
    }

    /// Whether a test holds of the span: its sound, the tokens' phonemes
    /// joined, is `x`, or it is not.
    fn holds(&self, test: Option<bool>, start: usize, end: usize) -> bool {
        let sound: String = self.sounds[start..end].iter().map(|&x| if x { 'x' } else { 'y' }).collect();
        test.map_or(true, |eq| (sound == "x") == eq)
    }

    /// Whether `rule` completes over the span, by any derivation. A cyclic
    /// derivation needs one that is not, so those alone are searched.
    fn completes(&mut self, rule: usize, start: usize, end: usize) -> Result<bool, TooMany> {
        if let Some(&found) = self.completes.get(&(rule, start, end)) {
            return Ok(found);
        }
        let mut plain = Enumerator::new(self.grammar, self.tokens, self.sounds, false);
        let found = !plain.rule(rule, start, end, &[])?.is_empty();
        self.budget = self.budget.checked_sub(20_000 - plain.budget).ok_or(TooMany)?;
        self.completes.insert((rule, start, end), found);
        Ok(found)
    }

    /// Under `maximal`, whether the terminator of the elidable optional at
    /// `index` of `prod`, elided at `at`, follows a constituent from
    /// `before` that could have been longer (§4). The constituent is the
    /// node just before it, unless that is a terminal, or the optional
    /// stands first, or the node is what a left-recursive production has
    /// read so far.
    fn forbidden(&mut self, prod: usize, index: usize, before: Option<usize>, at: usize) -> Result<bool, TooMany> {
        let production = &self.grammar.prods[prod];
        let Some(origin) = before.filter(|_| self.maximal && index > 0) else {
            return Ok(false);
        };
        let Sym::N(constituent) = production.syms[index - 1] else {
            return Ok(false);
        };
        if index == 1 && constituent == production.rule {
            return Ok(false);
        }
        let test = production.tests[index - 1];
        for later in at + 1..=self.tokens.len() {
            if self.holds(test, origin, later) && self.completes(constituent, origin, later)? {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn rule(&mut self, rule: usize, start: usize, end: usize, forbidden: &[usize]) -> Result<Derivations, TooMany> {
        if forbidden.contains(&rule) {
            return Ok(Rc::new(Vec::new()));
        }
        let key = (rule, start, end, forbidden.to_vec());
        if let Some(found) = self.memo.get(&key) {
            return Ok(found.clone());
        }
        let mut inner = forbidden.to_vec();
        inner.push(rule);
        inner.sort_unstable();
        let mut out = Vec::new();
        for &prod in &self.grammar.rules[rule].prods {
            for children in self.sequence(prod, 0, start, end, (start, end), &inner, None)? {
                self.budget = self.budget.checked_sub(1).ok_or(TooMany)?;
                out.push(Rc::new(Derivation { prod, start, end, children }));
            }
        }
        let out = Rc::new(out);
        self.memo.insert(key, out.clone());
        Ok(out)
    }

    /// The children of `prod` from its symbol `index` on, over the span;
    /// `before` is where the child before them starts.
    #[allow(clippy::too_many_arguments)]
    fn sequence(
        &mut self,
        prod: usize,
        index: usize,
        start: usize,
        end: usize,
        parent: (usize, usize),
        forbidden: &[usize],
        before: Option<usize>,
    ) -> Result<Vec<Vec<Child>>, TooMany> {
        let grammar = self.grammar;
        let syms = &grammar.prods[prod].syms;
        if index == syms.len() {
            return Ok(if start == end { vec![Vec::new()] } else { Vec::new() });
        }
        let mut out = Vec::new();
        match syms[index] {
            Sym::T(terminal) => {
                if start < end && self.tokens[start].contains(&terminal) {
                    for rest in self.sequence(prod, index + 1, start + 1, end, parent, forbidden, Some(start))? {
                        let mut children = vec![Child::Read(start, terminal)];
                        children.extend(rest);
                        out.push(children);
                        self.budget = self.budget.checked_sub(1).ok_or(TooMany)?;
                    }
                }
            }
            Sym::N(rule) => {
                for middle in start..=end {
                    // A tested symbol's constituent passes its test (§4).
                    if !self.holds(grammar.prods[prod].tests[index], start, middle) {
                        continue;
                    }
                    let elided = middle == start && grammar.rules[rule].elided.is_some();
                    if elided && self.forbidden(prod, index, before, start)? {
                        continue;
                    }
                    let same = (start, middle) == parent;
                    let firsts = self.rule(rule, start, middle, if same { forbidden } else { &[] })?;
                    if firsts.is_empty() {
                        continue;
                    }
                    let rests = self.sequence(prod, index + 1, middle, end, parent, forbidden, Some(start))?;
                    for first in firsts.iter() {
                        for rest in &rests {
                            let mut children = vec![Child::Node(first.clone())];
                            children.extend(rest.iter().map(|child| match child {
                                Child::Read(token, terminal) => Child::Read(*token, *terminal),
                                Child::Node(node) => Child::Node(node.clone()),
                            }));
                            out.push(children);
                            self.budget = self.budget.checked_sub(1).ok_or(TooMany)?;
                        }
                    }
                }
            }
        }
        Ok(out)
    }
}

fn actions(grammar: &Grammar, derivation: &Derivation, out: &mut Vec<Act>) {
    for child in &derivation.children {
        match child {
            Child::Read(token, terminal) => out.push(Act::Read { token: *token, terminal: *terminal }),
            Child::Node(node) => actions(grammar, node, out),
        }
    }
    out.push(Act::Close {
        prod: derivation.prod,
        start: derivation.start,
        end: derivation.end,
        visible: !grammar.rules[grammar.prods[derivation.prod].rule].helper
            && grammar.prods[derivation.prod].syms.len() != 1,
    });
}

// ---- the definitions of §6

/// Which of two differing visible actions wins: `(a_first, tie)`.
fn outcome(lean: Lean, a: &Act, b: &Act) -> (bool, bool) {
    match (a, b) {
        // Two reads of one token as different terminals are tied.
        (Act::Read { terminal: x, .. }, Act::Read { terminal: y, .. }) => (TERMINALS[*x] < TERMINALS[*y], true),
        (Act::Read { .. }, Act::Close { .. }) => match lean {
            Lean::Greedy => (true, false),
            Lean::Lazy => (false, false),
            Lean::Neither => (true, true),
            Lean::LateElision => unreachable!("late-elision compares actions with no lean"),
        },
        (Act::Close { .. }, Act::Read { .. }) => match lean {
            Lean::Greedy => (false, false),
            Lean::Lazy => (true, false),
            Lean::Neither => (false, true),
            Lean::LateElision => unreachable!("late-elision compares actions with no lean"),
        },
        (Act::Close { prod: p, start: s, end: e, .. }, Act::Close { prod: q, start: t, end: f, .. }) => {
            ((p, s, e) < (q, t, f), true)
        }
    }
}

fn canonical(a: &Act, b: &Act) -> bool {
    match (a, b) {
        (Act::Read { terminal: x, .. }, Act::Read { terminal: y, .. }) => TERMINALS[*x] < TERMINALS[*y],
        (Act::Read { .. }, Act::Close { .. }) => true,
        (Act::Close { .. }, Act::Read { .. }) => false,
        (Act::Close { prod: p, start: s, end: e, .. }, Act::Close { prod: q, start: t, end: f, .. }) => {
            (p, s, e) < (q, t, f)
        }
    }
}

fn same(a: &Act, b: &Act) -> bool {
    match (a, b) {
        (Act::Read { token: i, terminal: x, .. }, Act::Read { token: j, terminal: y, .. }) => i == j && x == y,
        (Act::Close { prod: p, start: s, end: e, .. }, Act::Close { prod: q, start: t, end: f, .. }) => {
            p == q && s == t && e == f
        }
        _ => false,
    }
}

fn first_difference<'x>(a: &'x [Act], b: &'x [Act]) -> Option<(usize, &'x Act, &'x Act)> {
    a.iter().zip(b).enumerate().find(|(_, (x, y))| !same(x, y)).map(|(index, (x, y))| (index, x, y))
}

struct Ranked {
    visible: Vec<Vec<Act>>,
    full: Vec<Vec<Act>>,
    /// Each derivation's elision vector, as a count for each boundary.
    vectors: Vec<Vec<usize>>,
    profiles: Vec<Vec<usize>>,
}

impl Ranked {
    /// T compares profiles first, then elision vectors or actions.
    fn before(&self, lean: Lean, a: usize, b: usize) -> bool {
        if self.profiles[a] != self.profiles[b] {
            return self.profiles[a] > self.profiles[b];
        }
        if lean == Lean::LateElision {
            return match self.vectors[a].cmp(&self.vectors[b]) {
                std::cmp::Ordering::Equal => self.before(Lean::Neither, a, b),
                order => order == std::cmp::Ordering::Less,
            };
        }
        match first_difference(&self.visible[a], &self.visible[b]) {
            Some((_, x, y)) => outcome(lean, x, y).0,
            // A visible prefix before its extensions.
            None if self.visible[a].len() != self.visible[b].len() => self.visible[a].len() < self.visible[b].len(),
            None => match first_difference(&self.full[a], &self.full[b]) {
                Some((_, x, y)) => canonical(x, y),
                None => self.full[a].len() < self.full[b].len(),
            },
        }
    }

    fn beats(&self, lean: Lean, a: usize, b: usize) -> bool {
        if self.profiles[a] != self.profiles[b] {
            return self.profiles[a] > self.profiles[b];
        }
        if lean == Lean::LateElision {
            return self.vectors[a] < self.vectors[b];
        }
        match first_difference(&self.visible[a], &self.visible[b]) {
            Some((_, x, y)) => {
                let (first, tie) = outcome(lean, x, y);
                first && !tie
            }
            None => false,
        }
    }

    fn tied(&self, lean: Lean, a: usize, b: usize) -> bool {
        if self.profiles[a] != self.profiles[b] {
            return false;
        }
        if lean == Lean::LateElision {
            return a != b && self.vectors[a] == self.vectors[b];
        }
        a != b
            && match first_difference(&self.visible[a], &self.visible[b]) {
                Some((_, x, y)) => outcome(lean, x, y).1,
                None => true,
            }
    }

    /// The fewest visible actions before the first visible difference; a
    /// derivation that differs only in transparent actions diverges last.
    fn divergence(&self, a: usize, b: usize) -> usize {
        match first_difference(&self.visible[a], &self.visible[b]) {
            Some((index, _, _)) => index,
            None if self.visible[a].len() != self.visible[b].len() => self.visible[a].len().min(self.visible[b].len()),
            None => usize::MAX,
        }
    }

    /// The least of `set` in T, if T has one there.
    fn least(&self, lean: Lean, set: &[usize]) -> Option<usize> {
        set.iter().copied().find(|&a| set.iter().all(|&b| a == b || self.before(lean, a, b)))
    }
}

struct Expected {
    count: usize,
    verdict: &'static str,
    chosen: usize,
    tied: Option<usize>,
    witness: Option<(Act, Act)>,
}

enum Outcome {
    Expected(Expected),
    NoLeast(&'static str),
}

fn expect(ranked: &Ranked, lean: Lean, findings: &mut BTreeMap<&'static str, usize>) -> Outcome {
    let all: Vec<usize> = (0..ranked.full.len()).collect();
    let Some(chosen) = ranked.least(lean, &all) else {
        if std::env::var("GENCMU_PROPERTY_VERBOSE").is_ok() {
            for &d in &all {
                eprintln!("{d}: V {:?}\n   F {:?}", ranked.visible[d], ranked.full[d]);
            }
            for &a in &all {
                for &b in &all {
                    if a < b {
                        eprintln!("{a} before {b}: {}", ranked.before(lean, a, b));
                    }
                }
            }
        }
        return Outcome::NoLeast("T has no least derivation");
    };
    let tied_with: Vec<usize> = all.iter().copied().filter(|&d| ranked.tied(lean, d, chosen)).collect();
    let tied = match tied_with.iter().map(|&d| ranked.divergence(d, chosen)).min() {
        None => None,
        Some(earliest) => {
            let group: Vec<usize> =
                tied_with.iter().copied().filter(|&d| ranked.divergence(d, chosen) == earliest).collect();
            match ranked.least(lean, &group) {
                Some(tied) => Some(tied),
                None => {
                    if std::env::var("GENCMU_PROPERTY_VERBOSE").is_ok() {
                        eprintln!("chosen: V {:?}\n        F {:?}", ranked.visible[chosen], ranked.full[chosen]);
                        for &d in &group {
                            eprintln!(
                                "{d}: div {} V {:?}\n   F {:?}",
                                ranked.divergence(d, chosen),
                                ranked.visible[d],
                                ranked.full[d]
                            );
                        }
                        for &a in &group {
                            for &b in &group {
                                if a < b {
                                    eprintln!("{a} before {b}: {}", ranked.before(lean, a, b));
                                }
                            }
                        }
                    }
                    return Outcome::NoLeast("T has no least among the earliest-diverging tied derivations");
                }
            }
        }
    };
    let verdict = if all.len() == 1 {
        "unique"
    } else if tied.is_some() {
        "tie"
    } else {
        "resolved"
    };
    // The verdict as §6 first defines it, from the winners.
    if all.len() > 1 {
        let winners: Vec<usize> =
            all.iter().copied().filter(|&d| !all.iter().any(|&e| ranked.beats(lean, e, d))).collect();
        let literal = if winners.len() == 1 && !all.iter().any(|&e| ranked.tied(lean, e, winners[0])) {
            "resolved"
        } else {
            "tie"
        };
        if literal != verdict {
            *findings.entry("the two definitions of the verdict disagree").or_default() += 1;
        }
    }
    if let Some(t) = tied {
        if all.iter().any(|&e| ranked.beats(lean, e, t)) {
            *findings.entry("the reported tied derivation is dominated").or_default() += 1;
        }
    }
    let witness = tied.map(|t| match first_difference(&ranked.visible[chosen], &ranked.visible[t]) {
        Some((_, x, y)) => (*x, *y),
        None => {
            let (_, x, y) = first_difference(&ranked.full[chosen], &ranked.full[t]).expect("different derivations");
            (*x, *y)
        }
    });
    Outcome::Expected(Expected { count: all.len(), verdict, chosen, tied, witness })
}

enum Shape {
    Rule(usize, usize, usize, Vec<Shape>),
    Token(usize, usize),
    Elided(usize, usize),
}

/// The tree of engine §12: helpers spliced out, a chain's levels as rule
/// nodes, absent elidable optionals as elided nodes.
fn fragments(grammar: &Grammar, derivation: &Derivation) -> Vec<Shape> {
    let production = &grammar.prods[derivation.prod];
    let rule = &grammar.rules[production.rule];
    let mut children = Vec::new();
    for child in &derivation.children {
        match child {
            Child::Read(token, terminal) => children.push(Shape::Token(*terminal, *token)),
            Child::Node(node) => children.append(&mut fragments(grammar, node)),
        }
    }
    if rule.helper {
        match (rule.elided, production.syms.is_empty()) {
            (Some(terminal), true) => vec![Shape::Elided(terminal, derivation.start)],
            _ => children,
        }
    } else {
        vec![Shape::Rule(rule.owner, derivation.start, derivation.end, children)]
    }
}

fn expected_json(node: &Shape) -> String {
    match node {
        Shape::Rule(rule, start, end, children) => format!(
            "{{\"kind\":\"rule\",\"rule\":\"{}\",\"span\":[{start},{end}],\"children\":[{}]}}",
            RULES[*rule],
            children.iter().map(expected_json).collect::<Vec<_>>().join(",")
        ),
        Shape::Token(terminal, token) => {
            format!("{{\"kind\":\"token\",\"terminal\":\"{}\",\"token\":{token}}}", TERMINALS[*terminal])
        }
        Shape::Elided(terminal, at) => {
            format!("{{\"kind\":\"elided\",\"terminal\":\"{}\",\"span\":[{at},{at}]}}", TERMINALS[*terminal])
        }
    }
}

fn tree_json(grammar: &Grammar, derivation: &Derivation) -> String {
    let made = fragments(grammar, derivation);
    assert_eq!(made.len(), 1, "the root is a rule node");
    expected_json(&made[0])
}

fn action_json(grammar: &Grammar, act: &Act) -> String {
    match act {
        Act::Read { token, terminal, .. } => {
            format!("{{\"read\":{{\"token\":{token},\"terminal\":\"{}\"}}}}", TERMINALS[*terminal])
        }
        Act::Close { prod, start, end, .. } => format!(
            "{{\"close\":{{\"rule\":\"{}\",\"production\":{prod},\"span\":[{start},{end}]}}}}",
            RULES[grammar.rules[grammar.prods[*prod].rule].owner]
        ),
    }
}

fn check(seed: u64, findings: &mut BTreeMap<&'static str, usize>) -> Result<bool, String> {
    let mut rng = Rng(seed);
    let (source, (tokens, sounds)) = generate(&mut rng);
    let grammar = lower(&source);
    let text = grammar_text(&source);
    // A grammar that repeats an item that can be empty is an error of
    // lowering (engine §3.3): the parse gives that error, and the round is
    // not counted.
    let mut nullable = vec![false; grammar.rules.len()];
    loop {
        let mut changed = false;
        for production in &grammar.prods {
            if !nullable[production.rule] && production.syms.iter().all(|sym| matches!(sym, Sym::N(n) if nullable[*n]))
            {
                nullable[production.rule] = true;
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    if grammar.brace_items.iter().any(|sym| matches!(sym, Sym::N(n) if nullable[*n])) {
        let document = format!("```jbogenbau\n{text}```\n");
        let sources = [
            ("main.md".to_string(), document),
            ("p.md".to_string(), "```jbogenbau\n%stage main\n%include \"main.md\"\n```\n".to_string()),
        ];
        let dialect = gencmu::load_dialect_sources(sources, "p.md").map_err(|error| format!("load: {error}"))?;
        let options = gencmu::ParseOptions { auto_features: false, ..Default::default() };
        let result = dialect.parse_tokens(&[], &options).map_err(|error| format!("parse: {error}"))?;
        return match result.error {
            Some(error) if error.kind == gencmu::ParseErrorKind::Grammar => Ok(false),
            _ => Err(format!("seed {seed}: an empty item of braces is no error of the grammar:\n{text}")),
        };
    }
    // The oracle reads the input itself, whatever the stage does with it.
    let mut enumerator = Enumerator::new(&grammar, &tokens, &sounds, grammar.maximal);
    let Ok(derivations) = enumerator.rule(0, 0, tokens.len(), &[]) else {
        return Ok(false);
    };
    let full: Vec<Vec<Act>> = derivations
        .iter()
        .map(|derivation| {
            let mut out = Vec::new();
            actions(&grammar, derivation, &mut out);
            out
        })
        .collect();
    let visible = full.iter().map(|acts| acts.iter().filter(|act| act.visible()).copied().collect()).collect();
    // The count of elided terminators at each boundary: a close of the
    // empty production of an elidable optional's helper (engine §6).
    let vectors = full
        .iter()
        .map(|acts| {
            let mut counts = vec![0; tokens.len() + 1];
            for act in acts {
                if let Act::Close { prod, start, .. } = act {
                    let production = &grammar.prods[*prod];
                    if production.syms.is_empty() && grammar.rules[production.rule].elided.is_some() {
                        counts[*start] += 1;
                    }
                }
            }
            counts
        })
        .collect();
    // Count spans directly from source flags, without library profile operations.
    let profiles = full
        .iter()
        .map(|acts| {
            let mut counts = vec![vec![0; tokens.len() + 1]; tokens.len() + 1];
            for act in acts {
                if let Act::Close { prod, start, end, .. } = act {
                    let rule = grammar.prods[*prod].rule;
                    if source.greedy.get(rule).copied().unwrap_or(false) && start < end {
                        counts[*start][*end] += 1;
                    }
                }
            }
            (0..tokens.len())
                .flat_map(|start| ((start + 1)..=tokens.len()).rev().map(|end| counts[start][end]).collect::<Vec<_>>())
                .collect()
        })
        .collect();
    let ranked = Ranked { visible, full, vectors, profiles };

    let document = format!("```jbogenbau\n{text}```\n");
    let dom = grammar_dom(&source);
    if seed % 50 == 0 {
        // The DOM given to the cache is the one the notation reads.
        let read = gencmu::tools::read_grammar_document(&document).map_err(|error| format!("read: {error}"))?;
        if parse_json(&read) != parse_json(&dom) {
            return Err(format!("seed {seed}: the generated DOM differs from the notation's:\n{dom}\n{read}"));
        }
    }
    let compiled = format!(
        "{{\"format\":{DOM_FORMAT},\"bootstrap\":\"{}\",\"documents\":{{\"main.md\":{{\"hash\":\"{}\",\"dom\":{dom}}}}}}}",
        gencmu::tools::bootstrap_hash(),
        gencmu::tools::fnv1a64(&document)
    );
    let sources = [
        ("main.md".to_string(), document),
        ("p.md".to_string(), "```jbogenbau\n%stage main\n%include \"main.md\"\n```\n".to_string()),
        ("compiled.json".to_string(), compiled),
    ];
    let dialect = gencmu::load_dialect_sources(sources, "p.md").map_err(|error| format!("load: {error}"))?;
    let input: Vec<gencmu::InputToken> = tokens
        .iter()
        .enumerate()
        .map(|(index, tags)| gencmu::InputToken {
            text: format!("t{index}"),
            tags: tags.iter().map(|&t| TERMINALS[t].to_string()).collect(),
            phonemes: Some(if sounds[index] { "x" } else { "y" }.to_string()),
        })
        .collect();
    let options = gencmu::ParseOptions { auto_features: false, ..Default::default() };
    let result = dialect.parse_tokens(&input, &options).map_err(|error| format!("parse: {error}"))?;
    let json = gencmu::to_json(&result);
    let actual = parse_json(&json).map_err(|error| format!("not JSON: {error}"))?;
    let broken = common::result_problems(&actual);
    if !broken.is_empty() {
        return Err(format!("seed {seed}: the result breaks an invariant: {broken:?}\nresult: {json}"));
    }
    let describe = |problem: String| {
        let tags: Vec<String> = tokens
            .iter()
            .zip(&sounds)
            .map(|(tags, &x)| {
                let tags = tags.iter().map(|&t| TERMINALS[t]).collect::<Vec<_>>().join(",");
                format!("{tags} {}", if x { "x" } else { "y" })
            })
            .collect();
        format!(
            "seed {seed}: {problem}\ngrammar:\n{text}tokens: {tags:?}\nderivations: {}\nresult: {json}",
            derivations.len()
        )
    };

    // The stage rejects its input exactly when no derivation counts (§4).
    let verdict = result.stages.first().and_then(|stage| stage.verdict);
    if derivations.is_empty() {
        *findings.entry("(stat) rejected").or_default() += 1;
        return match verdict {
            None if !result.ok => Ok(true),
            _ => Err(describe("a verdict where no derivation counts".to_string())),
        };
    }
    if verdict.is_none() {
        return Err(describe(format!("no verdict where {} derivations count", derivations.len())));
    }
    if tokens.is_empty() {
        *findings.entry("(stat) empty input").or_default() += 1;
    }
    if grammar.maximal {
        *findings.entry("(stat) maximal").or_default() += 1;
    }
    let expected = match expect(&ranked, grammar.lean, findings) {
        Outcome::Expected(expected) => expected,
        // T is a total order (§6), so this cannot happen.
        Outcome::NoLeast(finding) => return Err(describe(finding.to_string())),
    };
    // With elision-only and no elidable terminators, the check ranks the
    // same forest with no lean. It runs only for a resolved stage (§7).
    if grammar.elision_only && expected.verdict == "resolved" {
        if let Outcome::Expected(check) = expect(&ranked, Lean::Neither, findings) {
            if check.verdict == "tie" {
                let pattern = format!(
                    "{{\"ok\":false,\"error\":{{\"kind\":\"ambiguous\",\"reason\":\"elision-only\",\"readings\":[{},{}]}}}}",
                    tree_json(&grammar, &derivations[check.chosen]),
                    tree_json(&grammar, &derivations[check.tied.expect("a tie")])
                );
                let pattern = parse_json(&pattern).expect("a pattern");
                return common::matches(&pattern, &actual, "result").map(|_| true).map_err(describe);
            }
        } else {
            return Err(describe("T has no least derivation with no lean".to_string()));
        }
    }
    // A tie is an ambiguous error with the first and the second reading,
    // and its stage has no output (§6).
    let pattern = match (expected.tied, expected.witness) {
        (Some(tied), Some((a, b))) => format!(
            "{{\"ok\":false,\"stages\":[{{\"verdict\":\"tie\",\"witness\":[{},{}]}}],\"tree\":null,\
             \"error\":{{\"kind\":\"ambiguous\",\"reason\":\"tie\",\"readings\":[{},{}]}}}}",
            action_json(&grammar, &a),
            action_json(&grammar, &b),
            tree_json(&grammar, &derivations[expected.chosen]),
            tree_json(&grammar, &derivations[tied])
        ),
        _ => format!(
            "{{\"ok\":true,\"stages\":[{{\"verdict\":\"{}\"}}],\"tree\":{}}}",
            expected.verdict,
            tree_json(&grammar, &derivations[expected.chosen])
        ),
    };
    let pattern = parse_json(&pattern).expect("a pattern");
    common::matches(&pattern, &actual, "result").map_err(describe)?;
    let stage = &result.stages[0];
    if (stage.verdict == Some(gencmu::Verdict::Tie)) != stage.output.is_none() {
        return Err(describe("a stage has output exactly when it does not tie".to_string()));
    }
    *findings
        .entry(match (expected.verdict, expected.count) {
            ("unique", _) => "(stat) unique",
            ("resolved", _) => "(stat) resolved",
            (_, 2) => "(stat) tie of two",
            _ => "(stat) tie of more",
        })
        .or_default() += 1;
    if grammar.lean == Lean::LateElision {
        let stat = match expected.verdict {
            "unique" => "(stat) late-elision unique",
            "resolved" => "(stat) late-elision resolved",
            _ => "(stat) late-elision tie",
        };
        *findings.entry(stat).or_default() += 1;
    }
    Ok(true)
}

#[test]
fn ranking_matches_the_definitions() {
    let cases: u64 = std::env::var("GENCMU_PROPERTY_CASES").ok().and_then(|n| n.parse().ok()).unwrap_or(3000);
    let first: u64 = std::env::var("GENCMU_PROPERTY_SEED").ok().and_then(|n| n.parse().ok()).unwrap_or(1);
    let started = std::time::Instant::now();
    let mut findings = BTreeMap::new();
    let mut checked = 0;
    let mut failures = Vec::new();
    for seed in first..first + cases {
        match check(seed, &mut findings) {
            Ok(true) => checked += 1,
            Ok(false) => {}
            Err(failure) => failures.push(failure),
        }
        if failures.len() >= 5 {
            break;
        }
    }
    eprintln!("ranking: {checked} of {cases} cases checked in {:?}; {findings:?}", started.elapsed());
    let contradictions: Vec<_> = findings.keys().filter(|key| !key.starts_with("(stat)")).collect();
    assert!(contradictions.is_empty(), "the definitions of engine §6 contradict each other: {contradictions:?}");
    assert!(failures.is_empty(), "{} failures:\n\n{}", failures.len(), failures.join("\n\n"));
    // Every kind of round is checked often enough to count.
    let count = |key: &str| findings.get(key).copied().unwrap_or(0) as u64;
    assert!(
        count("(stat) rejected") > cases / 50
            && count("(stat) empty input") > cases / 100
            && count("(stat) maximal") > cases / 50,
        "too few rounds of a kind: {findings:?}"
    );
    assert!(checked > cases / 6, "only {checked} grammars were checked");
}
