//! Exact structural observations for compared occurrences (engine §4.1).
use crate::fxhash::{FxMap, FxSet};
use crate::lower::{LCond, LTerm, Lowered, Span, Sym};
use std::collections::BTreeSet;

pub(crate) const CLOSE: u8 = 1;
pub(crate) const TREE: u8 = 2;
pub(crate) const ABSENT: u32 = u32::MAX;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) enum Node {
    Rule(String, u32),
    Written(String, String),
    Omitted(String),
    Seal(Vec<String>),
    EmptyProjection,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct Tree {
    pub prefix: u32,
    pub identity: u32,
    pub sequence: u32,
}

impl Default for Tree {
    fn default() -> Self {
        Self { prefix: 0, identity: ABSENT, sequence: 0 }
    }
}

#[derive(Debug)]
pub(crate) struct Arena {
    nodes: Vec<Node>,
    node_ids: FxMap<Node, u32>,
    sequences: Vec<(u32, u32)>,
    sequence_ids: FxMap<(u32, u32), u32>,
    concatenations: FxMap<(u32, u32), u32>,
    states: Vec<Tree>,
    state_ids: FxMap<Tree, u32>,
}

impl Arena {
    pub(crate) fn new() -> Self {
        Self {
            nodes: Vec::new(),
            node_ids: FxMap::default(),
            sequences: vec![(0, 0)],
            sequence_ids: FxMap::default(),
            concatenations: FxMap::default(),
            states: vec![Tree::default()],
            state_ids: FxMap::default(),
        }
    }

    pub(crate) fn node(&mut self, node: Node) -> u32 {
        if let Some(&id) = self.node_ids.get(&node) {
            return id;
        }
        let id = self.nodes.len() as u32;
        self.nodes.push(node.clone());
        self.node_ids.insert(node, id);
        id
    }

    pub(crate) fn append(&mut self, prefix: u32, node: u32) -> u32 {
        if node == ABSENT || matches!(self.nodes[node as usize], Node::EmptyProjection | Node::Rule(_, 0)) {
            return prefix;
        }
        if let Some(&id) = self.sequence_ids.get(&(prefix, node)) {
            return id;
        }
        let id = self.sequences.len() as u32;
        self.sequences.push((prefix, node));
        self.sequence_ids.insert((prefix, node), id);
        id
    }

    pub(crate) fn concat(&mut self, left: u32, right: u32) -> u32 {
        if left == 0 {
            return right;
        }
        if right == 0 {
            return left;
        }
        if let Some(&id) = self.concatenations.get(&(left, right)) {
            return id;
        }
        let mut pending = Vec::new();
        let mut at = right;
        while at != 0 {
            let (previous, node) = self.sequences[at as usize];
            pending.push(node);
            at = previous;
        }
        let mut result = left;
        while let Some(node) = pending.pop() {
            result = self.append(result, node);
        }
        self.concatenations.insert((left, right), result);
        result
    }

    pub(crate) fn state(&mut self, state: Tree) -> u32 {
        if let Some(&id) = self.state_ids.get(&state) {
            return id;
        }
        let id = self.states.len() as u32;
        self.states.push(state);
        self.state_ids.insert(state, id);
        id
    }

    pub(crate) fn get(&self, state: u32) -> Option<Tree> {
        (state != 0).then(|| self.states[state as usize])
    }

    pub(crate) fn singleton(&mut self, node: Node) -> u32 {
        let identity = self.node(node);
        let sequence = self.append(0, identity);
        self.state(Tree { prefix: 0, identity, sequence })
    }

    pub(crate) fn join(&mut self, left: u32, right: u32) -> u32 {
        let a = self.get(left).unwrap_or_default().sequence;
        let b = self.get(right).unwrap_or_default().sequence;
        let prefix = self.concat(a, b);
        if prefix == 0 {
            0
        } else {
            self.state(Tree { prefix, sequence: prefix, ..Tree::default() })
        }
    }
}

#[derive(Debug, Clone, Default)]
pub(crate) struct Demand {
    pub whole: bool,
    pub captures: FxSet<u32>,
    pub lexical: BTreeSet<String>,
}

pub(crate) fn comparisons<'a>(condition: &'a LCond, out: &mut Vec<(&'a Span, &'a Span)>) {
    match condition {
        LCond::SameTree(a, _, b) => out.push((a, b)),
        LCond::Not(c) => comparisons(c, out),
        LCond::Any(items) | LCond::All(items) => {
            for c in items {
                comparisons(c, out);
            }
        }
        LCond::If(a, b) => {
            comparisons(a, out);
            comparisons(b, out);
        }
        LCond::Cmp(_, a, b) => {
            term_comparisons(a, out);
            term_comparisons(b, out);
        }
        _ => (),
    }
}

pub(crate) fn term_comparisons<'a>(term: &'a LTerm, out: &mut Vec<(&'a Span, &'a Span)>) {
    match term {
        LTerm::If(c, t) => {
            comparisons(c, out);
            term_comparisons(t, out);
        }
        LTerm::Union(items) | LTerm::Inter(items) | LTerm::Concat(items) => {
            for t in items {
                term_comparisons(t, out);
            }
        }
        LTerm::Diff(a, b) | LTerm::Split(a, b) => {
            term_comparisons(a, out);
            term_comparisons(b, out);
        }
        LTerm::Ngrams(t, _) | LTerm::Classify(t, _) => term_comparisons(t, out),
        _ => (),
    }
}

pub(crate) fn demands(g: &Lowered) -> Vec<Demand> {
    let mut demands = vec![Demand::default(); g.prods.len()];
    for (id, p) in g.prods.iter().enumerate() {
        let mut reads = Vec::new();
        for (c, _) in &p.conds {
            comparisons(c, &mut reads);
        }
        if let Some(tags) = &p.tags {
            term_comparisons(tags, &mut reads);
        }
        for ((prod, ..), plan) in &g.ranked.plans {
            if *prod as usize != id {
                continue;
            }
            for (c, _) in plan.conditions.iter().flatten() {
                comparisons(c, &mut reads);
            }
            if let Some(tags) = &plan.whole_tags {
                term_comparisons(tags, &mut reads);
            }
        }
        for (a, b) in reads {
            for span in [a, b] {
                match span {
                    Span::Whole => demands[id].whole = true,
                    Span::Cap(slot) => {
                        demands[id].captures.insert(*slot);
                    }
                    Span::Lexical(name) => {
                        demands[id].lexical.insert(name.clone());
                    }
                    _ => unreachable!("a constituent comparison reads bare captures"),
                }
            }
        }
    }
    let mut outer = vec![BTreeSet::new(); g.rules.len()];
    let mut whole = vec![false; g.rules.len()];
    for (id, p) in g.prods.iter().enumerate().filter(|(_, p)| g.rules[p.rule as usize].helper) {
        outer[p.rule as usize].extend(demands[id].lexical.iter().cloned());
        whole[p.rule as usize] |= demands[id].whole;
    }
    let mut changed = true;
    while changed {
        changed = false;
        for p in g.prods.iter().filter(|p| g.rules[p.rule as usize].helper) {
            for symbol in &p.syms {
                let Sym::N(child) = *symbol else { continue };
                if whole[child as usize] && !whole[p.rule as usize] {
                    whole[p.rule as usize] = true;
                    changed = true;
                }
                let inherited = outer[child as usize].clone();
                for name in inherited {
                    if !p.names.contains_key(&name) {
                        changed |= outer[p.rule as usize].insert(name);
                    }
                }
            }
        }
    }
    for (id, p) in g.prods.iter().enumerate() {
        for (index, symbol) in p.syms.iter().enumerate() {
            let Sym::N(child) = *symbol else { continue };
            demands[id].whole |= whole[child as usize];
            for name in &outer[child as usize] {
                if let Some(&slot) = p.names.get(name).filter(|&&slot| p.cap_pos[slot as usize] < index) {
                    demands[id].captures.insert(slot);
                }
            }
        }
    }
    demands
}

pub(crate) fn terminal_demand(g: &Lowered, item: crate::earley::Item) -> bool {
    if g.tree_demands.is_empty() {
        return false;
    }
    let p = &g.prods[item.prod as usize];
    let d = &g.tree_demands[item.prod as usize];
    item.close_requested & TREE != 0
        || !g.rules[p.rule as usize].helper && d.whole
        || p.cap_at[item.dot as usize].is_some_and(|slot| d.captures.contains(&slot))
}

#[derive(Clone, Default, PartialEq, Eq, Hash)]
struct Context {
    rule: u32,
    declared: BTreeSet<String>,
    available: std::collections::BTreeMap<String, Sym>,
    known: BTreeSet<String>,
    prefix: Vec<u32>,
    sealed: bool,
}

fn enter(g: &Lowered, id: u32, context: &Context, queue: &mut Vec<Context>) {
    let p = &g.prods[id as usize];
    for (index, symbol) in p.syms.iter().enumerate() {
        let Sym::N(rule) = *symbol else { continue };
        if !g.ranked.contextual.contains(&rule) {
            continue;
        }
        let mut child = context.clone();
        child.rule = rule;
        if let Some((declared, known)) = g.ranked.bindings.get(&id) {
            child.declared.extend(declared.iter().cloned());
            child.known.extend(known.iter().cloned());
        }
        for (name, slot) in &p.names {
            let at = p.cap_pos[*slot as usize];
            if !name.is_empty() && at < index {
                child.available.insert(name.clone(), p.syms[at]);
            }
        }
        if !context.sealed {
            for symbol in &p.syms[..index] {
                if let Sym::N(rule) = *symbol {
                    if !g.ranked.slots.contains_key(&rule) && !child.prefix.contains(&rule) {
                        child.prefix.push(rule);
                    }
                }
            }
        }
        child.sealed |= g.ranked.slots.contains_key(&rule);
        queue.push(child);
    }
}

pub(crate) fn check_cycles(g: &Lowered, rows: &[(u32, Vec<Sym>)], stage: &str) -> Result<(), crate::lower::LowerError> {
    let mut nullable = vec![false; g.rules.len()];
    let mut changed = true;
    while changed {
        changed = false;
        for (rule, symbols) in rows {
            if !nullable[*rule as usize]
                && symbols.iter().all(|symbol| matches!(symbol,Sym::N(rule) if nullable[*rule as usize]))
            {
                nullable[*rule as usize] = true;
                changed = true;
            }
        }
    }
    let mut edges = vec![Vec::new(); g.rules.len()];
    for (rule, symbols) in rows {
        for (index, symbol) in symbols.iter().enumerate() {
            if let Sym::N(child) = *symbol {
                if !g.ranked.slots.contains_key(&child) {
                    let marked = symbols
                        .iter()
                        .enumerate()
                        .all(|(i, other)| i == index || matches!(other,Sym::N(rule) if nullable[*rule as usize]));
                    edges[*rule as usize].push((child, marked));
                }
            }
        }
    }
    let mut sites = Vec::new();
    let mut collect = |id: u32, reads: Vec<(&Span, &Span)>, context: &Context| {
        let p = &g.prods[id as usize];
        for (a, b) in reads {
            let mut roots = Vec::new();
            for span in [a, b] {
                match span {
                    Span::Whole => {
                        roots.extend(&context.prefix);
                        if !g.rules[p.rule as usize].helper {
                            roots.extend(p.syms.iter().filter_map(|symbol| match symbol {
                                Sym::N(rule) if !g.ranked.slots.contains_key(rule) => Some(*rule),
                                _ => None,
                            }));
                        }
                    }
                    Span::Cap(slot) => {
                        if let Sym::N(rule) = p.syms[p.cap_pos[*slot as usize]] {
                            roots.push(rule);
                        }
                    }
                    Span::Lexical(name) => {
                        if let Some(Sym::N(rule)) = context.available.get(name) {
                            roots.push(*rule);
                        }
                    }
                    _ => unreachable!("a constituent comparison reads bare captures"),
                }
            }
            sites.push((id, roots));
        }
    };
    let mut queue = Vec::new();
    for (id, p) in g.prods.iter().enumerate() {
        let mut reads = Vec::new();
        if let Some(tags) = &p.tags {
            term_comparisons(tags, &mut reads);
        }
        for (condition, _) in &p.conds {
            comparisons(condition, &mut reads);
        }
        collect(id as u32, reads, &Context::default());
        if !g.rules[p.rule as usize].helper {
            enter(g, id as u32, &Context::default(), &mut queue);
        }
    }
    let mut seen = FxSet::default();
    let mut at = 0;
    while let Some(context) = queue.get(at).cloned() {
        at += 1;
        if !seen.insert(context.clone()) {
            continue;
        }
        for &id in &g.rules[context.rule as usize].prods {
            let key = (
                id,
                context.declared.iter().cloned().collect(),
                context.available.keys().cloned().collect(),
                context.known.iter().cloned().collect(),
            );
            if let Some(plan) = g.ranked.plans.get(&key) {
                let mut reads = Vec::new();
                for (condition, _) in plan.conditions.iter().flatten() {
                    comparisons(condition, &mut reads);
                }
                if let Some(tags) = &plan.whole_tags {
                    term_comparisons(tags, &mut reads);
                }
                collect(id, reads, &context);
            }
            enter(g, id, &context, &mut queue);
        }
    }
    sites.sort_by_key(|(id, _)| *id);
    for (id, roots) in sites {
        let mut reachable = Vec::new();
        let mut known = FxSet::default();
        let mut pending: Vec<_> = roots.into_iter().rev().collect();
        while let Some(rule) = pending.pop() {
            if !known.insert(rule) {
                continue;
            }
            reachable.push(rule);
            pending.extend(edges[rule as usize].iter().rev().map(|(rule, _)| *rule));
        }
        let mut done = FxSet::default();
        let mut active = FxMap::default();
        let mut path = Vec::new();
        for root in reachable {
            if done.contains(&root) {
                continue;
            }
            let mut stack = vec![(root, 0)];
            while let Some((rule, next)) = stack.last_mut() {
                active.entry(*rule).or_insert_with(|| {
                    path.push(*rule);
                    path.len() - 1
                });
                let Some(&(child, marked)) = edges[*rule as usize].get(*next) else {
                    active.remove(rule);
                    done.insert(*rule);
                    path.pop();
                    stack.pop();
                    continue;
                };
                *next += 1;
                if !marked || done.contains(&child) {
                    continue;
                }
                if let Some(&begin) = active.get(&child) {
                    let mut cycle: Vec<_> = path[begin..]
                        .iter()
                        .chain(std::iter::once(&child))
                        .filter_map(|rule| {
                            (!g.rules[*rule as usize].helper).then(|| g.rules[*rule as usize].name.as_str())
                        })
                        .collect();
                    if cycle.is_empty() {
                        cycle.push(&g.rules[child as usize].name);
                    }
                    let p = &g.prods[id as usize];
                    return Err(crate::lower::LowerError::at(
                        stage,
                        p.document.as_deref().unwrap_or(""),
                        p.at,
                        format!(
                            "tree comparison demands a cycle {} that can repeat a demanded rule over one span",
                            cycle.join(" → ")
                        ),
                    ));
                }
                stack.push((child, 0));
            }
        }
    }
    Ok(())
}

pub(crate) struct EmissionScope {
    pub caps: Vec<crate::earley::Cap>,
    pub structure: u32,
}

fn emission_identity(
    g: &Lowered,
    tree: &crate::tree::ITree,
    tokens: &[crate::earley::Tok],
    root: u32,
    arena: &mut Arena,
    memo: &mut FxMap<u32, Tree>,
) -> Tree {
    use crate::tree::IKind;
    let mut pending = vec![(root, false)];
    while let Some((id, expanded)) = pending.pop() {
        if memo.contains_key(&id) {
            continue;
        }
        let node = &tree.nodes[id as usize];
        let prod = match node.kind {
            IKind::Read { tok, terminal } => {
                let identity = arena
                    .node(Node::Written(g.terminals[terminal as usize].clone(), tokens[tok as usize].value.clone()));
                let sequence = arena.append(0, identity);
                memo.insert(id, Tree { prefix: 0, identity, sequence });
                continue;
            }
            IKind::Close { prod, .. } => prod,
        };
        let production = &g.prods[prod as usize];
        if !expanded {
            pending.push((id, true));
            for (index, child) in node.children.iter().enumerate().rev() {
                if !matches!(production.syms[index],Sym::N(rule) if g.ranked.slots.contains_key(&rule)) {
                    pending.push((*child, false));
                }
            }
            continue;
        }
        let mut prefix = 0;
        for (index, &child) in node.children.iter().enumerate() {
            if matches!(production.syms[index],Sym::N(rule) if g.ranked.slots.contains_key(&rule)) {
                let (start, end) = match tree.nodes[child as usize].kind {
                    IKind::Read { tok, .. } => (tok, tok + 1),
                    IKind::Close { start, end, .. } => (start, end),
                };
                let values = tokens[start as usize..end as usize].iter().map(|t| t.value.clone()).collect();
                let seal = arena.node(Node::Seal(values));
                prefix = arena.append(prefix, seal);
            } else {
                prefix = arena.concat(prefix, memo[&child].sequence);
            }
        }
        let rule = &g.rules[production.rule as usize];
        let identity = if !rule.helper {
            arena.node(Node::Rule(rule.name.clone(), prefix))
        } else if production.syms.is_empty() && rule.elided.is_some() {
            arena.node(Node::Omitted(rule.elided.clone().unwrap()))
        } else {
            ABSENT
        };
        let sequence = if identity == ABSENT { prefix } else { arena.append(0, identity) };
        memo.insert(id, Tree { prefix, identity, sequence });
    }
    memo[&root]
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn emission_scope(
    g: &Lowered,
    tree: &crate::tree::ITree,
    owner: u32,
    term: &LTerm,
    tokens: &[crate::earley::Tok],
    machine: &mut Option<std::rc::Rc<std::cell::RefCell<crate::patterns::Machine>>>,
    memo: &mut FxMap<u32, Tree>,
) -> Option<EmissionScope> {
    let mut reads = Vec::new();
    term_comparisons(term, &mut reads);
    if reads.is_empty() {
        return None;
    }
    let record = &tree.nodes[owner as usize];
    let crate::tree::IKind::Close { prod, ref caps, .. } = record.kind else { unreachable!("an emission owner") };
    let mut scope = EmissionScope { caps: caps.clone(), structure: record.structure };
    let machine =
        machine.get_or_insert_with(|| std::rc::Rc::new(std::cell::RefCell::new(crate::patterns::Machine::new(&[]))));
    let mut m = machine.borrow_mut();
    m.trees.get_or_insert_with(Arena::new);
    for (a, b) in reads {
        for span in [a, b] {
            let node = match span {
                Span::Whole => owner,
                Span::Cap(slot) => record.children[g.prods[prod as usize].cap_pos[*slot as usize]],
                _ => unreachable!("an emission comparison reads local bare captures"),
            };
            let arena = m.trees.as_mut().unwrap();
            let observation = emission_identity(g, tree, tokens, node, arena, memo);
            let state = arena.state(observation);
            let original = match span {
                Span::Whole => scope.structure,
                Span::Cap(slot) => scope.caps[*slot as usize].structure,
                _ => unreachable!(),
            };
            let original = if original == u32::MAX { m.empty } else { original };
            let structure = m.with_tree(original, state);
            match span {
                Span::Whole => scope.structure = structure,
                Span::Cap(slot) => scope.caps[*slot as usize].structure = structure,
                _ => unreachable!(),
            }
        }
    }
    Some(scope)
}
