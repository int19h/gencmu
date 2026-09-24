//! Lowering a stitched grammar to the productions the parser runs, given
//! the enabled features (engine §3).

use std::collections::BTreeSet;

use crate::fxhash::FxMap;
use std::sync::Arc;

use crate::dom::{Arg, Cond, EmitItem, Expr, Term};
use crate::grammar::{is_terminal_name, StageGrammar, StitchedAlternative};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Sym {
    T(u32),
    N(u32),
}

#[derive(Debug, Clone)]
pub(crate) enum Span {
    Cap(u8),
    /// `$`, the whole constituent: from the item's origin to its end.
    Whole,
    Head(Box<Span>),
    Tail(Box<Span>),
    Last(Box<Span>),
}

#[derive(Debug, Clone)]
pub(crate) enum LTerm {
    Lit(String),
    Weak(String),
    Empty,
    Union(Vec<LTerm>),
    Inter(Vec<LTerm>),
    Phonemes(Span),
    Text(Span),
    Lower(Box<LTerm>),
    Tags(Span),
    TagsRule(Span, u32),
    Classes(Span),
    Words(Span),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CmpOp {
    Eq,
    Ne,
    In,
    NotIn,
    Subset,
}

#[derive(Debug, Clone)]
pub(crate) enum LCond {
    Cmp(CmpOp, LTerm, LTerm),
    Matches(Span, u32),
    Not(Box<LCond>),
    Any(Vec<LCond>),
    All(Vec<LCond>),
}

#[derive(Debug, Clone)]
pub(crate) enum LEmitItem {
    Cap(u8, Option<LTerm>),
    /// A capture named with `<>`: neither emitted nor walked (§11).
    Erase(u8),
    Insert(String),
}

#[derive(Debug, Clone)]
pub(crate) enum LEmit {
    None,
    /// `⇒ $ <>`: the constituent is erased.
    Erased,
    /// `⇒ $`, once per item, with the item's tag term if it has one.
    This(Vec<Option<LTerm>>),
    Items(Vec<LEmitItem>),
}

impl LEmit {
    /// Whether the child at `position` of a constituent of `production` is
    /// erased by its emission (§5, §11).
    pub(crate) fn erases(&self, production: &Prod, position: usize) -> bool {
        match self {
            LEmit::Erased => true,
            LEmit::Items(items) => production.cap_at[position].is_some_and(|slot| {
                items.iter().any(|item| matches!(item, LEmitItem::Erase(erased) if *erased == slot))
            }),
            LEmit::None | LEmit::This(_) => false,
        }
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
    pub cap_at: Vec<Option<u8>>,
    /// For each capture slot, its position.
    pub cap_pos: Vec<u16>,
    pub tags: Option<LTerm>,
    pub emit: LEmit,
    /// Conditions, each with the dot at which it is evaluated.
    pub conds: Vec<(LCond, u16)>,
    pub visible: bool,
    /// `r ≔ r x`, the step of a trailing repetition (§3.3).
    pub trailing_step: bool,
    pub document: Option<Arc<str>>,
    pub at: (usize, usize),
}

#[derive(Debug, Clone)]
pub(crate) struct LRule {
    /// The rule's name, or for a helper the name of the rule that owns it.
    pub name: String,
    pub helper: bool,
    pub prods: Vec<u32>,
    /// For the helper of an optional that begins with an elidable
    /// terminator: that terminator (§12).
    pub elided: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct Lowered {
    pub rules: Vec<LRule>,
    pub prods: Vec<Prod>,
    pub terminals: Vec<String>,
    pub start: u32,
    /// Nonterminals that can occur twice on one chain of constituents over
    /// one span: those in a cycle of the grammar's unit graph, whose edges
    /// lead from a rule to a symbol of one of its productions whose other
    /// symbols can all derive the empty text.
    pub cyclic: Vec<bool>,
}

type Item = (Sym, Option<String>);
type Sequence = Vec<Item>;

struct HelperDef {
    owner: u32,
    prods: Vec<Sequence>,
    elided: Option<String>,
    /// The helpers of the places written inside this one, in order.
    children: Vec<usize>,
}

struct Lowerer<'a> {
    grammar: &'a StageGrammar,
    mandatory: bool,
    terminals: Vec<String>,
    terminal_index: FxMap<String, u32>,
    helpers: Vec<HelperDef>,
    owner: u32,
    /// For each place of sugar being expanded, and the alternative itself at
    /// the bottom, the helpers of the places written inside it so far.
    places: Vec<Vec<usize>>,
}

fn product(left: Vec<Sequence>, right: &[Sequence]) -> Vec<Sequence> {
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
    fn terminal(&mut self, name: &str) -> u32 {
        if let Some(&id) = self.terminal_index.get(name) {
            return id;
        }
        let id = self.terminals.len() as u32;
        self.terminals.push(name.to_string());
        self.terminal_index.insert(name.to_string(), id);
        id
    }

    /// Makes the helper of a place whose inside `enter` began.
    fn helper(&mut self, prods: Vec<Sequence>, elided: Option<String>) -> Sym {
        let id = (self.grammar.rules.len() + self.helpers.len()) as u32;
        let children = self.places.pop().expect("a place entered");
        self.places.last_mut().expect("an alternative").push(self.helpers.len());
        self.helpers.push(HelperDef { owner: self.owner, prods, elided, children });
        Sym::N(id)
    }

    fn enter(&mut self) {
        self.places.push(Vec::new());
    }

    fn symbol(&mut self, name: &str, reference: bool) -> Sym {
        if reference && !is_terminal_name(name) {
            Sym::N(self.grammar.index[name] as u32)
        } else {
            Sym::T(self.terminal(name))
        }
    }

    fn repeat(&mut self, inner: &Expr, min: u8) -> Sym {
        self.enter();
        let body = self.expand(inner);
        let id = (self.grammar.rules.len() + self.helpers.len()) as u32;
        let mut prods = Vec::new();
        if min == 0 {
            prods.push(Vec::new());
        } else {
            prods.extend(body.iter().cloned());
        }
        for sequence in &body {
            let mut step = vec![(Sym::N(id), None)];
            step.extend(sequence.iter().cloned());
            prods.push(step);
        }
        self.helper(prods, None)
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
            Expr::Optional(inner) => {
                self.enter();
                let body = self.expand(inner);
                // An optional of a symbol, or of a sequence that begins with
                // one, is elidable when that symbol is an elidable
                // terminal; one of a choice or an `&` never is (§3.8).
                let elided = elidable_terminal(inner).filter(|name| self.grammar.elidable.contains(name));
                let mut prods = Vec::new();
                if !(self.mandatory && elided.is_some()) {
                    prods.push(Vec::new());
                }
                prods.extend(body);
                let sym = self.helper(prods, elided);
                vec![vec![(sym, None)]]
            }
            Expr::Repeat(inner, min) => vec![vec![(self.repeat(inner, *min), None)]],
            Expr::Ref(name) => vec![vec![(self.symbol(name, true), None)]],
            Expr::Terminal(name) => vec![vec![(self.symbol(name, false), None)]],
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

/// The terminal an optional's content begins with, if it is a symbol or a
/// sequence that begins, recursively, with one.
fn elidable_terminal(expr: &Expr) -> Option<String> {
    match expr {
        Expr::Ref(name) if is_terminal_name(name) => Some(name.clone()),
        Expr::Terminal(name) => Some(name.clone()),
        Expr::Seq(items) => items.first().and_then(elidable_terminal),
        _ => None,
    }
}

/// A term or condition that mentions a capture the production lacks.
struct Missing;

struct Scope<'a> {
    names: &'a FxMap<String, u8>,
    cap_pos: &'a [u16],
    rules: &'a std::collections::HashMap<String, usize>,
    /// The latest position of a capture mentioned so far.
    last: Option<u16>,
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
            Term::Literal(text) => LTerm::Lit(text.clone()),
            Term::Weak(text) => LTerm::Weak(text.clone()),
            Term::EmptySet => LTerm::Empty,
            Term::Union(items) => LTerm::Union(list(self, items)?),
            Term::Intersection(items) => LTerm::Inter(list(self, items)?),
            // A bare capture where a value is needed is its tags (§10).
            Term::Capture(_) => LTerm::Tags(self.span(term)?),
            Term::Call(name, args) => match (name.as_str(), &args[..]) {
                ("phonemes", [Arg::Term(span)]) => LTerm::Phonemes(self.span(span)?),
                ("text", [Arg::Term(span)]) => LTerm::Text(self.span(span)?),
                ("classes", [Arg::Term(span)]) => LTerm::Classes(self.span(span)?),
                ("words", [Arg::Term(span)]) => LTerm::Words(self.span(span)?),
                ("tags", [Arg::Term(span)]) => LTerm::Tags(self.span(span)?),
                ("tags", [Arg::Term(span), Arg::Rule(rule)]) => LTerm::TagsRule(self.span(span)?, self.rule(rule)?),
                ("lowercase", [Arg::Term(inner)]) => LTerm::Lower(Box::new(self.term(inner)?)),
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
                    _ => return Err(Missing),
                };
                LCond::Cmp(op, self.term(left)?, self.term(right)?)
            }
            Cond::Matches(span, rule) => LCond::Matches(self.span(span)?, self.rule(rule)?),
            Cond::Not(inner) => LCond::Not(Box::new(self.cond(inner)?)),
            Cond::Any(items) => LCond::Any(items.iter().map(|item| self.cond(item)).collect::<Result<Vec<_>, _>>()?),
            Cond::All(items) => LCond::All(items.iter().map(|item| self.cond(item)).collect::<Result<Vec<_>, _>>()?),
        })
    }
}

/// A production before numbering.
struct Pending {
    rule: u32,
    sequence: Sequence,
    source: Option<(usize, usize)>,
    trailing_step: bool,
}

fn ends_in_repeat(expr: &Expr) -> Option<(Vec<Expr>, &Expr, u8)> {
    match expr {
        Expr::Repeat(inner, min) => Some((Vec::new(), inner, *min)),
        Expr::Seq(items) => match items.last() {
            Some(Expr::Repeat(inner, min)) => Some((items[..items.len() - 1].to_vec(), inner, *min)),
            _ => None,
        },
        _ => None,
    }
}

/// Lowers a stage grammar for a set of features; `mandatory` makes every
/// optional that begins with an elidable terminator mandatory (§3.8).
pub(crate) fn lower(grammar: &StageGrammar, features: &BTreeSet<String>, mandatory: bool) -> Lowered {
    let mut lowerer = Lowerer {
        grammar,
        mandatory,
        terminals: Vec::new(),
        terminal_index: FxMap::default(),
        helpers: Vec::new(),
        owner: 0,
        places: Vec::new(),
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
        let live: Vec<&StitchedAlternative> = rule
            .alternatives
            .iter()
            .filter(|alternative| {
                alternative.alternative.guards.iter().all(|guard| features.contains(&guard.feature) != guard.negated)
            })
            .collect();
        let trailing = if live.len() == 1 { ends_in_repeat(&live[0].alternative.expr) } else { None };
        for (number, alternative) in live.iter().enumerate() {
            lowerer.places = vec![Vec::new()];
            let own = |sequence, trailing_step| {
                Slot::Own(Pending { rule: index as u32, sequence, source: Some((number, 0)), trailing_step })
            };
            if let Some((prefix, repeated, min)) = &trailing {
                let base = lowerer.expand(&Expr::Seq(prefix.clone()));
                let body = lowerer.expand(repeated);
                let bases = if *min == 0 { base } else { product(base, &body) };
                for sequence in bases {
                    slots.push(own(sequence, false));
                }
                for sequence in body {
                    let mut step = vec![(Sym::N(index as u32), None)];
                    step.extend(sequence);
                    slots.push(own(step, true));
                }
            } else {
                for sequence in lowerer.expand(&alternative.alternative.expr) {
                    slots.push(own(sequence, false));
                }
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
        .map(|rule| LRule { name: rule.name.clone(), helper: false, prods: Vec::new(), elided: None })
        .collect();
    for helper in &lowerer.helpers {
        rules.push(LRule {
            name: grammar.rules[helper.owner as usize].name.clone(),
            helper: true,
            prods: Vec::new(),
            elided: helper.elided.clone(),
        });
    }
    let mut order: Vec<Pending> = Vec::new();
    for slot in slots {
        match slot {
            Slot::Own(pending) => order.push(pending),
            Slot::Helper(helper) => {
                for sequence in std::mem::take(&mut lowerer.helpers[helper].prods) {
                    order.push(Pending {
                        rule: (user_count + helper) as u32,
                        sequence,
                        source: None,
                        trailing_step: false,
                    });
                }
            }
        }
    }

    let terminals = std::mem::take(&mut lowerer.terminals);
    let mut prods = Vec::with_capacity(order.len());
    for pending in order {
        let number = prods.len() as u32;
        rules[pending.rule as usize].prods.push(number);
        let syms: Vec<Sym> = pending.sequence.iter().map(|(sym, _)| *sym).collect();
        let mut cap_at = vec![None; syms.len()];
        let mut cap_pos = Vec::new();
        let mut names = FxMap::default();
        for (position, (_, name)) in pending.sequence.iter().enumerate() {
            if let Some(name) = name {
                cap_at[position] = Some(cap_pos.len() as u8);
                names.insert(name.clone(), cap_pos.len() as u8);
                cap_pos.push(position as u16);
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
            tags: None,
            emit: LEmit::None,
            conds: Vec::new(),
            trailing_step: pending.trailing_step,
            document: None,
            at: (0, 0),
        };
        if let Some((number, _)) = pending.source {
            let alternative = alternatives[pending.rule as usize][number];
            production.document = Some(alternative.document.clone());
            production.at = alternative.at;
            let cap_pos = production.cap_pos.clone();
            let mut scope = Scope { names: &names, cap_pos: &cap_pos, rules: &grammar.index, last: None, whole: false };
            if let Some(term) = alternative.alternative.tags.as_ref().or(alternative.rule_tags.as_ref()) {
                production.tags = scope.term(term).ok();
            }
            for cond in &alternative.conditions {
                scope.last = None;
                scope.whole = false;
                if let Ok(lowered) = scope.cond(cond) {
                    // One that mentions `$` waits for the item to be
                    // complete (§4).
                    let trigger =
                        if scope.whole { production.syms.len() as u16 } else { scope.last.map_or(0, |last| last + 1) };
                    production.conds.push((lowered, trigger));
                }
            }
            let whole =
                |item: &EmitItem| matches!(item, EmitItem::Capture(name, _) | EmitItem::Erase(name) if name.is_empty());
            production.emit = match &alternative.emit {
                None => LEmit::None,
                Some(items) if matches!(&items[..], [EmitItem::Erase(name)] if name.is_empty()) => LEmit::Erased,
                Some(items) if !items.is_empty() && items.iter().all(whole) => LEmit::This(
                    items
                        .iter()
                        .map(|item| match item {
                            EmitItem::Capture(_, Some(term)) => scope.term(term).ok(),
                            _ => None,
                        })
                        .collect(),
                ),
                Some(items) => LEmit::Items(
                    items
                        .iter()
                        .filter_map(|item| match item {
                            EmitItem::Capture(name, tags) => names.get(name).map(|&slot| {
                                LEmitItem::Cap(slot, tags.as_ref().and_then(|term| scope.term(term).ok()))
                            }),
                            EmitItem::Erase(name) => names.get(name).map(|&slot| LEmitItem::Erase(slot)),
                            EmitItem::Insert(tag) => Some(LEmitItem::Insert(tag.clone())),
                        })
                        .collect(),
                ),
            };
        }
        // A production with one symbol and no tags has its symbol's tags:
        // the symbol is captured (§3.7).
        if production.tags.is_none() && production.syms.len() == 1 && production.cap_at[0].is_none() {
            production.cap_at[0] = Some(production.cap_pos.len() as u8);
            production.cap_pos.push(0);
        }
        prods.push(production);
    }

    let cyclic = cyclic_rules(&rules, &prods);
    Lowered { start: grammar.index["text"] as u32, rules, prods, terminals, cyclic }
}

/// The nonterminals that lie on a cycle of the unit graph.
fn cyclic_rules(rules: &[LRule], prods: &[Prod]) -> Vec<bool> {
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
    let mut cyclic = vec![false; count];
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
                            cyclic[member] = true;
                        }
                    }
                }
            }
        }
    }
    cyclic
}
