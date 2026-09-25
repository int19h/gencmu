//! A property test of the ranking (engine §6): random small grammars and
//! inputs, every derivation enumerated by brute force, and the verdict,
//! chosen derivation, tied derivation and witness computed straight from
//! the definitions, compared with the library's.
//!
//! `GENCMU_PROPERTY_CASES` sets how many cases to run (default 600) and
//! `GENCMU_PROPERTY_SEED` the first seed; a failing case prints its seed,
//! grammar and tokens.

mod common;

use std::collections::{BTreeMap, HashMap};
use std::rc::Rc;

use common::{parse_json, Value};

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

/// An item of an alternative as written: a symbol, `[s]`, `s ...` or
/// `[s] ...`.
#[derive(Debug, Clone, Copy)]
enum Item {
    Plain(Sym),
    Optional(Sym),
    Repeat(Sym),
    OptionalRepeat(Sym),
}

const RULES: [&str; 4] = ["text", "a", "b", "c"];
const TERMINALS: [&str; 3] = ["A", "B", "C"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Lean {
    Greedy,
    Lazy,
    TagsOnly,
}

/// The grammar as written.
struct Source {
    rules: Vec<Vec<(Vec<Item>, Option<&'static str>)>>,
    lean: Lean,
    elision_only: bool,
    elidable: Option<usize>,
}

/// A nonterminal of the lowered grammar: a rule, or a helper owned by one.
struct LRule {
    prods: Vec<usize>,
    helper: bool,
    owner: usize,
    /// For the helper of `[T]` with `T` elidable: `T`.
    elided: Option<usize>,
}

struct LProd {
    rule: usize,
    syms: Vec<Sym>,
    trailing_step: bool,
}

/// The grammar lowered as engine §3 says, independently of the library.
struct Grammar {
    rules: Vec<LRule>,
    prods: Vec<LProd>,
    lean: Lean,
    elision_only: bool,
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

fn generate(rng: &mut Rng) -> (Source, Vec<Vec<(usize, bool)>>) {
    let rule_count = 1 + rng.below(4);
    let terminal_count = 1 + rng.below(3);
    let sugar = rng.chance(40);
    let mut rules = Vec::new();
    for rule in 0..rule_count {
        let mut alternatives = Vec::new();
        for _ in 0..1 + rng.below(3) {
            let length = [0, 1, 1, 2, 2, 3][rng.below(6)];
            let mut items = Vec::new();
            for position in 0..length {
                let sym = symbol(rng, rule, rule_count, terminal_count, position, length);
                items.push(match (sugar, rng.below(10)) {
                    (true, 0) => Item::Optional(sym),
                    (true, 1) => Item::Repeat(sym),
                    (true, 2) => Item::OptionalRepeat(sym),
                    _ => Item::Plain(sym),
                });
            }
            let tags = if rng.chance(15) { Some(if rng.chance(50) { "X" } else { "Y" }) } else { None };
            alternatives.push((items, tags));
        }
        rules.push(alternatives);
    }
    let lean = if rng.chance(50) { Lean::Greedy } else { Lean::Lazy };
    let elision_only = lean == Lean::Greedy && rng.chance(25);
    let elidable = if sugar && !elision_only && rng.chance(50) { Some(rng.below(terminal_count)) } else { None };
    let source = Source { rules, lean, elision_only, elidable };
    let grammar = lower(&source);
    // Most inputs are sentences of the grammar, so that most cases parse.
    let mut sentence = Vec::new();
    if !rng.chance(20) && !sample(&grammar, rng, 0, 0, &mut sentence) {
        sentence.clear();
    }
    if sentence.is_empty() && rng.chance(50) {
        sentence = (0..rng.below(5)).map(|_| rng.below(terminal_count)).collect();
    }
    sentence.truncate(6);
    let tokens = sentence
        .into_iter()
        .map(|terminal| {
            let mut tags = vec![(terminal, rng.chance(80))];
            if rng.chance(40) {
                let other = rng.below(terminal_count);
                if other != terminal {
                    tags.push((other, rng.chance(60)));
                }
            }
            tags
        })
        .collect();
    (source, tokens)
}

/// Lowers the grammar (engine §3): a helper per optional or repetition, a
/// rule whose only alternative ends in a repetition made left-recursive,
/// and each alternative's own productions numbered before its helpers,
/// which follow in the order their places are written.
fn lower(source: &Source) -> Grammar {
    let user = source.rules.len();
    let mut rules: Vec<LRule> =
        (0..user).map(|owner| LRule { prods: Vec::new(), helper: false, owner, elided: None }).collect();
    let mut helper_prods: Vec<Vec<Vec<Sym>>> = Vec::new();
    let mut pending: Vec<(usize, Vec<Sym>, bool)> = Vec::new();
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
    for (rule, alternatives) in source.rules.iter().enumerate() {
        let trailing = alternatives.len() == 1
            && matches!(alternatives[0].0.last(), Some(Item::Repeat(_) | Item::OptionalRepeat(_)));
        for (items, _) in alternatives {
            let first_helper = rules.len();
            let mut syms = Vec::new();
            let lowered_items = if trailing { &items[..items.len() - 1] } else { &items[..] };
            for item in lowered_items {
                syms.push(match *item {
                    Item::Plain(sym) => sym,
                    Item::Optional(sym) => {
                        let elided = match sym {
                            Sym::T(t) if source.elidable == Some(t) => Some(t),
                            _ => None,
                        };
                        helper((&mut rules, &mut helper_prods), rule, vec![vec![], vec![sym]], elided)
                    }
                    Item::Repeat(sym) => {
                        let id = rules.len();
                        helper((&mut rules, &mut helper_prods), rule, vec![vec![sym], vec![Sym::N(id), sym]], None)
                    }
                    Item::OptionalRepeat(sym) => {
                        let id = rules.len();
                        helper((&mut rules, &mut helper_prods), rule, vec![vec![], vec![Sym::N(id), sym]], None)
                    }
                });
            }
            if trailing {
                match items.last() {
                    Some(Item::Repeat(sym)) => {
                        let mut base = syms.clone();
                        base.push(*sym);
                        pending.push((rule, base, false));
                        pending.push((rule, vec![Sym::N(rule), *sym], true));
                    }
                    Some(Item::OptionalRepeat(sym)) => {
                        pending.push((rule, syms, false));
                        pending.push((rule, vec![Sym::N(rule), *sym], true));
                    }
                    _ => unreachable!(),
                }
            } else {
                pending.push((rule, syms, false));
            }
            places.extend(first_helper..rules.len());
            for id in places.drain(..) {
                for syms in &helper_prods[id - user] {
                    pending.push((id, syms.clone(), false));
                }
            }
        }
    }
    let mut prods: Vec<LProd> = Vec::new();
    for (rule, syms, trailing_step) in pending {
        rules[rule].prods.push(prods.len());
        prods.push(LProd { rule, syms, trailing_step });
    }
    Grammar { rules, prods, lean: source.lean, elision_only: source.elision_only }
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
        Item::Optional(sym) => format!("[{}]", name(sym)),
        Item::Repeat(sym) => format!("{} ...", name(sym)),
        Item::OptionalRepeat(sym) => format!("[{}] ...", name(sym)),
    }
}

fn grammar_text(source: &Source) -> String {
    let mut text = String::new();
    text.push_str(match (source.lean, source.elision_only) {
        (Lean::Lazy, _) => "%ambiguity-resolution lazy\n",
        (_, true) => "%ambiguity-resolution greedy elision-only\n",
        _ => "%ambiguity-resolution greedy\n",
    });
    if let Some(t) = source.elidable {
        text.push_str(&format!("%elidable {}\n", TERMINALS[t]));
    }
    for (rule, alternatives) in source.rules.iter().enumerate() {
        let bodies: Vec<String> = alternatives
            .iter()
            .map(|(items, tags)| {
                let mut body: Vec<String> = items.iter().map(item_text).collect();
                if body.is_empty() {
                    body.push("ε".to_string());
                }
                if let Some(tags) = tags {
                    body.push(format!("<\"{tags}\">"));
                }
                body.join(" ")
            })
            .collect();
        text.push_str(&format!("%rule {} {}\n", RULES[rule], bodies.join(" | ")));
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
    let first_rule_line = if source.elidable.is_some() { 4 } else { 3 };
    let mut rules = Vec::new();
    for (rule, alternatives) in source.rules.iter().enumerate() {
        let alternatives: Vec<String> = alternatives
            .iter()
            .map(|(items, tags)| {
                let parts: Vec<String> = items
                    .iter()
                    .map(|item| match item {
                        Item::Plain(sym) => reference(sym),
                        Item::Optional(sym) => format!("{{\"optional\":{}}}", reference(sym)),
                        Item::Repeat(sym) => format!("{{\"repeat\":{},\"min\":1}}", reference(sym)),
                        Item::OptionalRepeat(sym) => format!("{{\"repeat\":{},\"min\":0}}", reference(sym)),
                    })
                    .collect();
                let expr = match parts.len() {
                    0 => "{\"empty\":true}".to_string(),
                    1 => parts[0].clone(),
                    _ => format!("{{\"seq\":[{}]}}", parts.join(",")),
                };
                let tags = tags.map_or(String::new(), |tags| format!(",\"tags\":{{\"literal\":\"{tags}\"}}"));
                format!("{{\"guards\":[],\"expr\":{expr}{tags}}}")
            })
            .collect();
        rules.push(format!(
            "{{\"name\":\"{}\",\"op\":\"define\",\"alternatives\":[{}],\"conditions\":[],\"at\":[{},1]}}",
            RULES[rule],
            alternatives.join(","),
            rule + first_rule_line
        ));
    }
    let args = match (source.lean, source.elision_only) {
        (Lean::Lazy, _) => "\"lazy\"",
        (_, true) => "\"greedy\",\"elision-only\"",
        _ => "\"greedy\"",
    };
    let mut directives = vec![format!("{{\"name\":\"ambiguity-resolution\",\"args\":[{args}],\"at\":[2,1]}}")];
    if let Some(t) = source.elidable {
        directives.push(format!("{{\"name\":\"elidable\",\"args\":[\"{}\"],\"at\":[3,1]}}", TERMINALS[t]));
    }
    format!("{{\"format\":5,\"rules\":[{}],\"directives\":[{}]}}", rules.join(","), directives.join(","))
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
    Read { token: usize, terminal: usize, strong: bool },
    Close { prod: usize, start: usize, end: usize, visible: bool },
}

impl Act {
    fn visible(&self) -> bool {
        !matches!(self, Act::Close { visible: false, .. })
    }
}

struct TooMany;

type Derivations = Rc<Vec<Rc<Derivation>>>;

struct Enumerator<'a> {
    grammar: &'a Grammar,
    tokens: &'a [Vec<(usize, bool)>],
    memo: HashMap<(usize, usize, usize, Vec<usize>), Derivations>,
    budget: usize,
}

impl<'a> Enumerator<'a> {
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
            let syms = self.grammar.prods[prod].syms.clone();
            for children in self.sequence(&syms, 0, start, end, (start, end), &inner)? {
                self.budget = self.budget.checked_sub(1).ok_or(TooMany)?;
                out.push(Rc::new(Derivation { prod, start, end, children }));
            }
        }
        let out = Rc::new(out);
        self.memo.insert(key, out.clone());
        Ok(out)
    }

    fn sequence(
        &mut self,
        syms: &[Sym],
        index: usize,
        start: usize,
        end: usize,
        parent: (usize, usize),
        forbidden: &[usize],
    ) -> Result<Vec<Vec<Child>>, TooMany> {
        if index == syms.len() {
            return Ok(if start == end { vec![Vec::new()] } else { Vec::new() });
        }
        let mut out = Vec::new();
        match syms[index] {
            Sym::T(terminal) => {
                if start < end && self.tokens[start].iter().any(|&(t, _)| t == terminal) {
                    for rest in self.sequence(syms, index + 1, start + 1, end, parent, forbidden)? {
                        let mut children = vec![Child::Read(start, terminal)];
                        children.extend(rest);
                        out.push(children);
                        self.budget = self.budget.checked_sub(1).ok_or(TooMany)?;
                    }
                }
            }
            Sym::N(rule) => {
                for middle in start..=end {
                    let same = (start, middle) == parent;
                    let firsts = self.rule(rule, start, middle, if same { forbidden } else { &[] })?;
                    if firsts.is_empty() {
                        continue;
                    }
                    let rests = self.sequence(syms, index + 1, middle, end, parent, forbidden)?;
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

fn actions(grammar: &Grammar, tokens: &[Vec<(usize, bool)>], derivation: &Derivation, out: &mut Vec<Act>) {
    for child in &derivation.children {
        match child {
            Child::Read(token, terminal) => {
                let strong = tokens[*token].iter().find(|&&(t, _)| t == *terminal).map(|&(_, s)| s).unwrap_or(false);
                out.push(Act::Read { token: *token, terminal: *terminal, strong });
            }
            Child::Node(node) => actions(grammar, tokens, node, out),
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
        (Act::Read { terminal: x, strong: s, .. }, Act::Read { terminal: y, strong: t, .. }) => {
            if s != t {
                (*s, false)
            } else {
                (TERMINALS[*x] < TERMINALS[*y], true)
            }
        }
        (Act::Read { .. }, Act::Close { .. }) => match lean {
            Lean::Greedy => (true, false),
            Lean::Lazy => (false, false),
            Lean::TagsOnly => (true, true),
        },
        (Act::Close { .. }, Act::Read { .. }) => match lean {
            Lean::Greedy => (false, false),
            Lean::Lazy => (true, false),
            Lean::TagsOnly => (false, true),
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
}

impl Ranked {
    /// The order T: is `a` before `b`?
    fn before(&self, lean: Lean, a: usize, b: usize) -> bool {
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
        match first_difference(&self.visible[a], &self.visible[b]) {
            Some((_, x, y)) => {
                let (first, tie) = outcome(lean, x, y);
                first && !tie
            }
            None => false,
        }
    }

    fn tied(&self, lean: Lean, a: usize, b: usize) -> bool {
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

/// The tree of engine §12: helpers and the prefixes of trailing
/// repetitions spliced out, absent elidable optionals as elided nodes.
fn fragments(grammar: &Grammar, derivation: &Derivation) -> Vec<Shape> {
    let production = &grammar.prods[derivation.prod];
    let rule = &grammar.rules[production.rule];
    let mut children = Vec::new();
    for (position, child) in derivation.children.iter().enumerate() {
        match child {
            Child::Read(token, terminal) => children.push(Shape::Token(*terminal, *token)),
            Child::Node(node) => {
                let mut made = fragments(grammar, node);
                if position == 0 && production.trailing_step {
                    if let [Shape::Rule(_, _, _, inner)] = &mut made[..] {
                        children.append(inner);
                        continue;
                    }
                }
                children.append(&mut made);
            }
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
    let (source, tokens) = generate(&mut rng);
    let grammar = lower(&source);
    let text = grammar_text(&source);
    let mut enumerator = Enumerator { grammar: &grammar, tokens: &tokens, memo: HashMap::new(), budget: 20_000 };
    let Ok(derivations) = enumerator.rule(0, 0, tokens.len(), &[]) else {
        return Ok(false);
    };
    let full: Vec<Vec<Act>> = derivations
        .iter()
        .map(|derivation| {
            let mut out = Vec::new();
            actions(&grammar, &tokens, derivation, &mut out);
            out
        })
        .collect();
    let visible = full.iter().map(|acts| acts.iter().filter(|act| act.visible()).copied().collect()).collect();
    let ranked = Ranked { visible, full };

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
        "{{\"format\":5,\"bootstrap\":\"{}\",\"documents\":{{\"main.md\":{{\"hash\":\"{}\",\"dom\":{dom}}}}}}}",
        gencmu::tools::bootstrap_hash(),
        gencmu::tools::fnv1a64(&document)
    );
    let sources = [
        ("main.md".to_string(), document),
        ("p.md".to_string(), "## main <?stage main?>\n\n- [main](main.md) <?grammar?>\n".to_string()),
        ("compiled.json".to_string(), compiled),
    ];
    let dialect = gencmu::load_dialect_sources(sources, "p.md").map_err(|error| format!("load: {error}"))?;
    let input: Vec<gencmu::InputToken> = tokens
        .iter()
        .enumerate()
        .map(|(index, tags)| gencmu::InputToken {
            text: format!("t{index}"),
            tags: tags.iter().map(|&(t, strong)| (TERMINALS[t].to_string(), strong)).collect(),
            phonemes: None,
        })
        .collect();
    let options = gencmu::ParseOptions { auto_features: false, ..Default::default() };
    let result = dialect.parse_tokens(&input, &options).map_err(|error| format!("parse: {error}"))?;
    let json = gencmu::to_json(&result);
    let actual = parse_json(&json).map_err(|error| format!("not JSON: {error}"))?;
    let describe = |problem: String| {
        let tags: Vec<String> = tokens
            .iter()
            .map(|tags| {
                tags.iter()
                    .map(|&(t, s)| format!("{}{}", if s { "" } else { "?" }, TERMINALS[t]))
                    .collect::<Vec<_>>()
                    .join(",")
            })
            .collect();
        format!(
            "seed {seed}: {problem}\ngrammar:\n{text}tokens: {tags:?}\nderivations: {}\nresult: {json}",
            derivations.len()
        )
    };

    if derivations.is_empty() {
        return if result.ok { Err(describe("accepted a text with no derivation".to_string())) } else { Ok(true) };
    }
    let expected = match expect(&ranked, grammar.lean, findings) {
        Outcome::Expected(expected) => expected,
        // T is a total order (§6), so this cannot happen.
        Outcome::NoLeast(finding) => return Err(describe(finding.to_string())),
    };
    // With elision-only and no elidable terminators, the check ranks the
    // same forest by rule 1 alone.
    if grammar.elision_only && expected.verdict != "unique" {
        if let Outcome::Expected(check) = expect(&ranked, Lean::TagsOnly, findings) {
            if check.verdict == "tie" {
                let pattern = format!(
                    "{{\"ok\":false,\"error\":{{\"kind\":\"ambiguous\",\"readings\":[{},{}]}}}}",
                    tree_json(&grammar, &derivations[check.chosen]),
                    tree_json(&grammar, &derivations[check.tied.expect("a tie")])
                );
                let pattern = parse_json(&pattern).expect("a pattern");
                return common::matches(&pattern, &actual, "result").map(|_| true).map_err(describe);
            }
        } else {
            return Err(describe("T has no least derivation under rule 1 alone".to_string()));
        }
    }
    let mut pattern = format!("{{\"ok\":true,\"stages\":[{{\"verdict\":\"{}\"", expected.verdict);
    if let (Some(tied), Some((a, b))) = (expected.tied, expected.witness) {
        pattern.push_str(&format!(
            ",\"witness\":[{},{}],\"tied\":{}",
            action_json(&grammar, &a),
            action_json(&grammar, &b),
            tree_json(&grammar, &derivations[tied])
        ));
    }
    pattern.push_str(&format!("}}],\"tree\":{}}}", tree_json(&grammar, &derivations[expected.chosen])));
    let pattern = parse_json(&pattern).expect("a pattern");
    common::matches(&pattern, &actual, "result").map_err(describe)?;
    if expected.verdict != "tie"
        && actual.get("stages").map(Value::array).and_then(|s| s.first()).and_then(|s| s.get("tied")).is_some()
    {
        return Err(describe("a tied tree without a tie".to_string()));
    }
    *findings
        .entry(match (expected.verdict, expected.count) {
            ("unique", _) => "(stat) unique",
            ("resolved", _) => "(stat) resolved",
            (_, 2) => "(stat) tie of two",
            _ => "(stat) tie of more",
        })
        .or_default() += 1;
    Ok(true)
}

#[test]
fn ranking_matches_the_definitions() {
    let cases: u64 = std::env::var("GENCMU_PROPERTY_CASES").ok().and_then(|n| n.parse().ok()).unwrap_or(600);
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
}
