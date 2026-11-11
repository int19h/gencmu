//! Values and structure of the chosen check tree (engine §12.1).
use crate::earley::Tok;
use crate::fxhash::{FxMap, FxSet};
use crate::lower::{Element, Lowered, NodeWalk, Span, Sym};
use crate::patterns::Machine;
use crate::tags::{SetId, Tags};
use crate::tree::{IKind, ITree};
use std::cell::OnceCell;
use std::collections::BTreeSet;

#[derive(Clone)]
pub(crate) enum Kind {
    Rule(String),
    Leaf { terminal: String, elided: bool },
    Seal,
}
pub(crate) struct Node {
    pub derivation: u32,
    pub kind: Kind,
    pub children: Vec<u32>,
    pub parent: Option<u32>,
    pub index: usize,
    pub start: usize,
    pub end: usize,
    pub tags: SetId,
    pub structure: u32,
    pub identity: u32,
    pub candidate: bool,
    kept: bool,
}
#[derive(PartialEq, Eq, Hash)]
enum Identity {
    Rule(String, Vec<u32>),
    Leaf(String, String),
    Elided(String),
    Seal(Vec<String>),
}
#[derive(Clone, Copy)]
pub(crate) struct Value {
    pub start: usize,
    pub end: usize,
    pub target: Option<u32>,
    pub site: Option<crate::chart_readings::Site>,
}
pub(crate) struct Tree<'a> {
    grammar: &'a Lowered,
    derivation: &'a ITree,
    pub nodes: Vec<Node>,
    pub by_derivation: Vec<Option<u32>>,
    pub machine: Machine,
    parents: Vec<Option<(u32, usize)>>,
    preceding: Vec<OnceCell<Option<Value>>>,
    targets: Vec<Option<u32>>,
    first: FxMap<usize, FxSet<String>>,
    last: FxMap<usize, FxSet<String>>,
}
fn bounds(tree: &ITree, node: u32) -> (usize, usize) {
    match tree.nodes[node as usize].kind {
        IKind::Read { tok, .. } => (tok as usize, tok as usize + 1),
        IKind::Close { start, end, .. } => (start as usize, end as usize),
    }
}
impl<'a> Tree<'a> {
    pub(crate) fn new(
        g: &'a Lowered,
        derivation: &'a ITree,
        tokens: &[Tok],
        tags: &mut Tags,
        features: &BTreeSet<String>,
    ) -> Self {
        let mut patterns = Vec::new();
        let mut pending = Vec::new();
        for check in &g.checks {
            if check.definition.error.is_none() && !features.contains(&check.definition.name) {
                continue;
            }
            pending.push(crate::clauses::Part::Term(&check.definition.pattern));
            pending.extend(check.definition.conditions.iter().map(crate::clauses::Part::Cond));
        }
        let mut demanded = FxSet::default();
        while let Some(part) = pending.pop() {
            if let crate::clauses::Part::Cond(crate::dom::Cond::Boundary(_, _, names, _)) = part {
                demanded.extend(names.iter().cloned());
            }
            if let crate::clauses::Part::Term(crate::dom::Term::Pattern(pattern)) = part {
                patterns.push((**pattern).clone());
            }
            pending.extend(part.children());
        }
        let mut result = Self {
            grammar: g,
            derivation,
            nodes: Vec::new(),
            by_derivation: vec![None; derivation.nodes.len()],
            machine: Machine::new(&patterns),
            parents: vec![None; derivation.nodes.len()],
            preceding: (0..derivation.nodes.len()).map(|_| OnceCell::new()).collect(),
            targets: vec![None; derivation.nodes.len()],
            first: FxMap::default(),
            last: FxMap::default(),
        };
        for (index, node) in derivation.nodes.iter().enumerate() {
            for (position, &child) in node.children.iter().enumerate() {
                result.parents[child as usize] = Some((index as u32, position));
            }
            if demanded.is_empty() {
                continue;
            }
            let (start, end) = bounds(derivation, index as u32);
            let name = match node.kind {
                IKind::Read { terminal, .. } => Some(&g.terminals[terminal as usize]),
                IKind::Close { prod, .. } => {
                    let rule = &g.rules[g.prods[prod as usize].rule as usize];
                    (!rule.helper).then_some(&rule.name)
                }
            };
            if start != end {
                if let Some(name) = name.filter(|name| demanded.contains(name.as_str())) {
                    result.first.entry(start).or_default().insert(name.clone());
                    result.last.entry(end).or_default().insert(name.clone());
                }
            }
        }
        let mut pending = vec![(0u32, None)];
        while let Some((source, parent)) = pending.pop() {
            let part = &derivation.nodes[source as usize];
            let (start, end) = bounds(derivation, source);
            let (kind, set, candidate, erased) = match part.kind {
                IKind::Read { tok, terminal } => (
                    Kind::Leaf { terminal: g.terminals[terminal as usize].clone(), elided: false },
                    tokens[tok as usize].tags,
                    true,
                    false,
                ),
                IKind::Close { prod, tags: set, .. } => {
                    let p = &g.prods[prod as usize];
                    let rule = &g.rules[p.rule as usize];
                    if p.erased {
                        (if rule.helper { Kind::Seal } else { Kind::Rule(rule.name.clone()) }, set, false, true)
                    } else if part.children.is_empty() && rule.elided.is_some() {
                        let terminal = rule.elided.as_ref().unwrap().clone();
                        let tag = tags.tag(&terminal);
                        (Kind::Leaf { terminal, elided: true }, tags.set(vec![tag]), true, false)
                    } else if rule.helper {
                        pending.extend(part.children.iter().rev().map(|&child| (child, parent)));
                        continue;
                    } else {
                        (Kind::Rule(rule.name.clone()), set, true, false)
                    }
                }
            };
            let id = result.nodes.len() as u32;
            result.nodes.push(Node {
                derivation: source,
                kind,
                children: Vec::new(),
                parent: None,
                index: 0,
                start,
                end,
                tags: set,
                structure: 0,
                identity: 0,
                candidate,
                kept: false,
            });
            if let Some(parent) = parent {
                result.nodes[parent as usize].children.push(id);
            }
            if erased {
                if !matches!(result.nodes[id as usize].kind, Kind::Seal) {
                    let seal = result.nodes.len() as u32;
                    result.nodes.push(Node {
                        derivation: source,
                        kind: Kind::Seal,
                        children: Vec::new(),
                        parent: None,
                        index: 0,
                        start,
                        end,
                        tags: 0,
                        structure: 0,
                        identity: 0,
                        candidate: false,
                        kept: true,
                    });
                    result.nodes[id as usize].children.push(seal);
                }
            } else {
                pending.extend(part.children.iter().rev().map(|&child| (child, Some(id))));
            }
        }
        let mut identities = FxMap::default();
        for index in (0..result.nodes.len()).rev() {
            let children: Vec<_> = std::mem::take(&mut result.nodes[index].children)
                .into_iter()
                .filter(|&child| result.nodes[child as usize].kept)
                .collect();
            let node = &result.nodes[index];
            if matches!(node.kind, Kind::Rule(_)) && children.is_empty() && node.derivation != 0 {
                continue;
            }
            let values = || tokens[node.start..node.end].iter().map(|token| token.value.clone()).collect::<Vec<_>>();
            let key = match &node.kind {
                Kind::Rule(name) => Identity::Rule(
                    name.clone(),
                    children.iter().map(|&child| result.nodes[child as usize].identity).collect(),
                ),
                Kind::Seal => Identity::Seal(values()),
                Kind::Leaf { terminal, elided: true } => Identity::Elided(terminal.clone()),
                Kind::Leaf { terminal, elided: false } => {
                    Identity::Leaf(terminal.clone(), tokens[node.start].value.clone())
                }
            };
            let identity = identities.len() as u32;
            let identity = *identities.entry(key).or_insert(identity);
            let mut sequence = result.machine.empty;
            for &child in &children {
                sequence = result.machine.concat(sequence, result.nodes[child as usize].structure);
            }
            let names: Vec<_> = tags.list(node.tags).iter().map(|&id| tags.name(id).to_owned()).collect();
            let mut leaf_tags = names.clone();
            let structure = match &node.kind {
                Kind::Seal => result.machine.sealed(),
                Kind::Rule(name) => result.machine.node_with_value(
                    Some(name),
                    sequence,
                    None,
                    &names,
                    result.machine.node_values.then(values).map(|values| values.concat()).as_deref(),
                ),
                Kind::Leaf { terminal, elided } => {
                    if *elided {
                        leaf_tags.push("_Elided".into());
                    }
                    let value = if *elided { "" } else { tokens[node.start].value.as_str() };
                    result.machine.node_with_value(
                        None,
                        sequence,
                        Some((terminal, value, &leaf_tags)),
                        &leaf_tags,
                        Some(value),
                    )
                }
            };
            let node = &mut result.nodes[index];
            node.kept = true;
            node.children = children;
            node.identity = identity;
            node.structure = structure;
            if !matches!(node.kind, Kind::Seal) {
                result.by_derivation[node.derivation as usize] = Some(index as u32);
            }
        }
        for parent in 0..result.nodes.len() {
            let children = result.nodes[parent].children.clone();
            for (index, child) in children.into_iter().enumerate() {
                result.nodes[child as usize].parent = Some(parent as u32);
                result.nodes[child as usize].index = index;
            }
        }
        for node in 0..derivation.nodes.len() {
            if let IKind::Close { prod, .. } = derivation.nodes[node].kind {
                if derivation.nodes[node].children.is_empty()
                    && g.rules[g.prods[prod as usize].rule as usize].elided.is_some()
                {
                    result.targets[node] = g.helper_targets.get(&g.prods[prod as usize].rule).copied();
                    continue;
                }
            }
            result.targets[node] = match result.parents[node] {
                None => match derivation.nodes[node].kind {
                    IKind::Close { prod, .. } => Some(g.prods[prod as usize].rule),
                    _ => None,
                },
                Some((parent, position)) => Self::site(g, derivation, parent, position),
            };
        }
        result
    }
    fn site(g: &Lowered, tree: &ITree, parent: u32, position: usize) -> Option<u32> {
        let IKind::Close { prod, .. } = tree.nodes[parent as usize].kind else { unreachable!("a derivation parent") };
        let p = &g.prods[prod as usize];
        p.site_targets.get(position).copied().flatten().or_else(|| match p.syms[position] {
            Sym::N(rule) => {
                g.helper_targets.get(&rule).copied().or_else(|| (!g.rules[rule as usize].helper).then_some(rule))
            }
            Sym::T(_) => None,
        })
    }
    fn before(&self, g: &Lowered, tree: &ITree, mut parent: u32, mut at: usize) -> Option<Value> {
        loop {
            crate::work::count(crate::work::Work::Walked, 1);
            let IKind::Close { prod, .. } = tree.nodes[parent as usize].kind else {
                unreachable!("a derivation parent")
            };
            let p = &g.prods[prod as usize];
            let elements = p.elements.as_ref()?;
            let contains = |element: &Element| {
                let (start, end) = element.bounds();
                start <= at && at < end
            };
            let mut sequence = elements.as_slice();
            let mut index = sequence.iter().position(contains)?;
            let mut ancestors = Vec::new();
            while let Element::Optional { children, .. } = &sequence[index] {
                let Some(inner) = children.iter().position(contains) else { break };
                ancestors.push((sequence, index));
                sequence = children;
                index = inner;
            }
            while index == 0 {
                if let Some((outer, position)) = ancestors.pop() {
                    sequence = outer;
                    index = position;
                } else {
                    break;
                }
            }
            if index > 0 {
                let element = &sequence[index - 1];
                let (start, end) = element.bounds();
                let children = &tree.nodes[parent as usize].children;
                let low = children.get(start).map_or_else(|| bounds(tree, parent).1, |&child| bounds(tree, child).0);
                let high = if start == end { low } else { bounds(tree, children[end - 1]).1 };
                let target = match element {
                    Element::Symbol(position) => Self::site(g, tree, parent, *position),
                    Element::Optional { expression, .. } => g.optional_targets[*expression],
                };
                let site = match element {
                    Element::Symbol(position) => p.chart_sites.get(*position).copied(),
                    Element::Optional { .. } => None,
                };
                return Some(Value { start: low, end: high, target, site });
            }
            let rule = &g.rules[p.rule as usize];
            if !rule.helper || rule.splice_target.is_some() {
                return None;
            }
            (parent, at) = self.parents[parent as usize]?;
        }
    }
    fn preceding_value(&self, node: u32) -> Option<Value> {
        *self.preceding[node as usize].get_or_init(|| {
            let (parent, position) = self.parents[node as usize]?;
            self.before(self.grammar, self.derivation, parent, position)
        })
    }
    pub(crate) fn walk(&self, root: u32, path: &[NodeWalk]) -> Option<u32> {
        let mut id = root;
        for step in path {
            let node = &self.nodes[id as usize];
            id = match step {
                NodeWalk::Parent => node.parent?,
                NodeWalk::Preceding | NodeWalk::Following => {
                    let parent = &self.nodes[node.parent? as usize];
                    let index = if *step == NodeWalk::Preceding { node.index.checked_sub(1)? } else { node.index + 1 };
                    *parent.children.get(index)?
                }
            };
            if matches!(self.nodes[id as usize].kind, Kind::Seal) {
                return None;
            }
        }
        Some(id)
    }
    pub(crate) fn node(&self, root: u32, span: &Span) -> Option<u32> {
        if let Span::Node(path) = span {
            self.walk(root, path)
        } else {
            unreachable!("a check node")
        }
    }
    pub(crate) fn value(&self, root: u32, span: &Span) -> Option<(usize, usize, Option<SetId>)> {
        match span {
            Span::Node(path) => {
                let node = &self.nodes[self.walk(root, path)? as usize];
                Some((node.start, node.end, Some(node.tags)))
            }
            Span::Element(path) => {
                let node = &self.nodes[self.walk(root, path)? as usize];
                let value = self.preceding_value(node.derivation)?;
                Some((value.start, value.end, None))
            }
            _ => unreachable!("a check value"),
        }
    }
    pub(crate) fn target(&self, root: u32, span: &Span) -> Option<u32> {
        match span {
            Span::Node(path) => self.targets[self.nodes[self.walk(root, path)? as usize].derivation as usize],
            Span::Element(path) => self.preceding_value(self.nodes[self.walk(root, path)? as usize].derivation)?.target,
            Span::From(inner) => self.target(root, inner),
            _ => unreachable!("a local reading receiver"),
        }
    }
    pub(crate) fn chart_site(&self, root: u32, span: &Span) -> Option<crate::chart_readings::Site> {
        match span {
            Span::Node(path) => {
                let node = self.nodes[self.walk(root, path)? as usize].derivation;
                if let Some((parent, position)) = self.parents[node as usize] {
                    let IKind::Close { prod, .. } = self.derivation.nodes[parent as usize].kind else { unreachable!() };
                    self.grammar.prods[prod as usize].chart_sites.get(position).copied()
                } else {
                    let IKind::Close { prod, .. } = self.derivation.nodes[node as usize].kind else { return None };
                    self.grammar.chart_rules.get(self.grammar.prods[prod as usize].rule as usize).copied()
                }
            }
            Span::Element(path) => self.preceding_value(self.nodes[self.walk(root, path)? as usize].derivation)?.site,
            Span::From(inner) => self.chart_site(root, inner),
            _ => None,
        }
    }
    pub(crate) fn boundary(&self, forward: bool, at: usize, names: &[String]) -> bool {
        (if forward { &self.first } else { &self.last })
            .get(&at)
            .is_some_and(|found| names.iter().any(|name| found.contains(name)))
    }
}
