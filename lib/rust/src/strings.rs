//! Selected string recipes and their dependencies (engine §11).
use crate::dom::{Arg, Channels, Term};
use crate::earley::{EngineError, Tok};
use crate::lower::Lowered;
use crate::tree::{IKind, ITree, Sources};

#[derive(Clone, Copy)]
enum Channel {
    Value = 0,
    Image = 1,
}

enum Task<'a> {
    Need(u32, Channel),
    Atom(u32, &'a Term),
    Join(usize),
    Save(u32, Channel),
}

struct GapClaim {
    span: (usize, usize),
    intervals: Vec<(usize, usize)>,
}

/// One evaluation context for the complete emission, attachments included.
pub(crate) struct Strings<'a> {
    grammar: &'a Lowered,
    tree: &'a ITree,
    tokens: &'a [Tok],
    sources: Sources,
    text: &'a [char],
    covered: Vec<bool>,
    claims: Vec<GapClaim>,
    saved: Vec<[Option<String>; 2]>,
    active: Vec<[bool; 2]>,
}

impl<'a> Strings<'a> {
    pub(crate) fn new(grammar: &'a Lowered, tree: &'a ITree, tokens: &'a [Tok], text: &'a [char]) -> Self {
        let mut covered = vec![false; text.len()];
        for token in tokens {
            covered[token.source.0..token.source.1].fill(true);
        }
        Self {
            grammar,
            tree,
            tokens,
            sources: Sources::new(tokens),
            text,
            covered,
            claims: Vec::new(),
            saved: vec![[None, None]; tree.nodes.len()],
            active: vec![[false; 2]; tree.nodes.len()],
        }
    }

    fn span(&self, node: u32) -> (usize, usize) {
        match self.tree.nodes[node as usize].kind {
            IKind::Read { tok, .. } => (tok as usize, tok as usize + 1),
            IKind::Close { start, end, .. } => (start as usize, end as usize),
        }
    }

    fn capture(&self, owner: u32, receiver: &Term) -> u32 {
        let Term::Capture(name) = receiver else { unreachable!("a recipe receiver is a bare capture") };
        if name.is_empty() {
            return owner;
        }
        let node = &self.tree.nodes[owner as usize];
        let IKind::Close { prod, .. } = node.kind else { unreachable!("a recipe belongs to a constituent") };
        let production = &self.grammar.prods[prod as usize];
        let slot = production.names[name] as usize;
        node.children[production.cap_pos[slot]]
    }

    fn failure(message: &str) -> EngineError {
        EngineError { message: message.into(), rule: None }
    }

    fn verbatim(&mut self, node: u32) -> Result<String, EngineError> {
        let span = self.span(node);
        if span.0 == span.1 {
            return Ok(String::new());
        }
        let (left, right) = self.sources.of(span.0, span.1);
        let previous = span.0.checked_sub(1).map_or(0, |i| self.tokens[i].source.1);
        let following = self.tokens.get(span.1).map_or(self.text.len(), |t| t.source.0);
        let mut start = left;
        let mut end = right;
        while start > previous && !self.covered[start - 1] {
            start -= 1;
        }
        while end < following && !self.covered[end] {
            end += 1;
        }
        let mut extensions = Vec::new();
        if start < left {
            extensions.push((start, left));
        }
        if right < end {
            extensions.push((right, end));
        }
        if !self.claims.iter().any(|claim| claim.span == span) {
            for claim in &self.claims {
                if extensions.iter().any(|a| claim.intervals.iter().any(|b| a.0 < b.1 && b.0 < a.1)) {
                    return Err(Self::failure("different verbatim spans claim the same uncovered source text"));
                }
            }
            self.claims.push(GapClaim { span, intervals: extensions });
        }
        Ok(self.text[start..end].iter().collect())
    }

    fn input(&self, node: u32, channel: Channel) -> String {
        let (start, end) = self.span(node);
        self.tokens[start..end]
            .iter()
            .map(|token| match channel {
                Channel::Value => token.value.as_str(),
                Channel::Image => token.image.as_str(),
            })
            .collect()
    }

    fn recipe(tasks: &mut Vec<Task<'a>>, owner: u32, term: &'a Term) {
        let Term::Call(name, atoms) = term else { unreachable!("a recipe is a concatenation") };
        debug_assert_eq!(name, "concat");
        tasks.push(Task::Join(atoms.len()));
        tasks.extend(atoms.iter().rev().map(|atom| {
            let Arg::Term(atom) = atom else { unreachable!("a recipe atom is a term") };
            Task::Atom(owner, atom)
        }));
    }

    fn evaluate(&mut self, task: Task<'a>) -> Result<String, EngineError> {
        let mut tasks = vec![task];
        let mut values: Vec<String> = Vec::new();
        while let Some(task) = tasks.pop() {
            match task {
                Task::Need(index, channel) => {
                    let slot = channel as usize;
                    if let Some(value) = &self.saved[index as usize][slot] {
                        values.push(value.clone());
                        continue;
                    }
                    if self.active[index as usize][slot] {
                        return Err(Self::failure("a selected string recipe has a dependency cycle"));
                    }
                    self.active[index as usize][slot] = true;
                    tasks.push(Task::Save(index, channel));
                    let node = &self.tree.nodes[index as usize];
                    match node.kind {
                        IKind::Read { tok, .. } => values.push(match channel {
                            Channel::Value => self.tokens[tok as usize].value.clone(),
                            Channel::Image => self.tokens[tok as usize].image.clone(),
                        }),
                        IKind::Close { prod, .. } => {
                            let production = &self.grammar.prods[prod as usize];
                            if production.erased {
                                values.push(String::new());
                                continue;
                            }
                            let recipe = match channel {
                                Channel::Value => &production.strings.value,
                                Channel::Image => &production.strings.image,
                            };
                            if let Some(recipe) = recipe {
                                Self::recipe(&mut tasks, index, recipe);
                            } else if matches!(channel, Channel::Image) && production.strings.value.is_some() {
                                tasks.push(Task::Need(index, Channel::Value));
                            } else {
                                // Flatten default concatenations before constructing strings.
                                // Only selected recipe boundaries need cached intermediate results.
                                let mut pending = node.children.iter().rev().copied().collect::<Vec<_>>();
                                let mut parts = Vec::new();
                                while let Some(child) = pending.pop() {
                                    let child_node = &self.tree.nodes[child as usize];
                                    if let IKind::Close { prod, .. } = child_node.kind {
                                        let p = &self.grammar.prods[prod as usize];
                                        if p.erased {
                                            continue;
                                        }
                                        let selected = match channel {
                                            Channel::Value => p.strings.value.is_some(),
                                            Channel::Image => p.strings.image.is_some() || p.strings.value.is_some(),
                                        };
                                        if !selected {
                                            pending.extend(child_node.children.iter().rev());
                                            continue;
                                        }
                                    }
                                    parts.push(child);
                                }
                                tasks.push(Task::Join(parts.len()));
                                tasks.extend(parts.into_iter().rev().map(|child| Task::Need(child, channel)));
                            }
                        }
                    }
                }
                Task::Atom(owner, term) => match term {
                    Term::Str(value) => values.push(value.clone()),
                    Term::Call(name, args) => {
                        let [Arg::Term(receiver)] = &args[..] else { unreachable!("a recipe string method") };
                        if let Term::Call(emitted, args) = receiver {
                            debug_assert_eq!(emitted, "emitted");
                            let [Arg::Term(receiver)] = &args[..] else { unreachable!() };
                            let target = self.capture(owner, receiver);
                            tasks.push(Task::Need(
                                target,
                                if name == "value" { Channel::Value } else { Channel::Image },
                            ));
                            continue;
                        }
                        let target = self.capture(owner, receiver);
                        values.push(match name.as_str() {
                            "value" => self.input(target, Channel::Value),
                            "image" => self.input(target, Channel::Image),
                            "text" => {
                                let (start, end) = self.span(target);
                                if start == end {
                                    String::new()
                                } else {
                                    let (start, end) = self.sources.of(start, end);
                                    self.text[start..end].iter().collect()
                                }
                            }
                            "verbatim-text" => self.verbatim(target)?,
                            _ => unreachable!("a checked recipe string method"),
                        });
                    }
                    _ => unreachable!("a bound recipe string atom"),
                },
                Task::Join(count) => {
                    let start = values.len() - count;
                    let joined = values.drain(start..).collect::<String>();
                    values.push(joined);
                }
                Task::Save(index, channel) => {
                    self.saved[index as usize][channel as usize] =
                        Some(values.last().expect("a string result").clone());
                    self.active[index as usize][channel as usize] = false;
                }
            }
        }
        Ok(values.pop().expect("the requested string"))
    }

    fn override_string(&mut self, owner: u32, recipe: &'a Term) -> Result<String, EngineError> {
        // A recipe task joins its atoms. This wrapper adds no dependency identity.
        let Term::Call(_, atoms) = recipe else { unreachable!() };
        let mut values = String::new();
        for atom in atoms {
            let Arg::Term(atom) = atom else { unreachable!() };
            values.push_str(&self.evaluate(Task::Atom(owner, atom))?);
        }
        Ok(values)
    }

    pub(crate) fn item(
        &mut self,
        owner: u32,
        carrier: Option<u32>,
        channels: &'a Channels,
    ) -> Result<(String, String), EngineError> {
        let value = match &channels.value {
            Some(recipe) => self.override_string(owner, recipe)?,
            None => match carrier {
                Some(node) => self.evaluate(Task::Need(node, Channel::Value))?,
                None => String::new(),
            },
        };
        let image = match &channels.image {
            Some(recipe) => self.override_string(owner, recipe)?,
            None if channels.value.is_some() => value.clone(),
            None => match carrier {
                Some(node) => self.evaluate(Task::Need(node, Channel::Image))?,
                None => String::new(),
            },
        };
        Ok((value, image))
    }
}
