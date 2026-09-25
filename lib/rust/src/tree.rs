//! From a chosen derivation to the result's tree (engine §12) and to the
//! next stage's tokens (§11). Every walk here is iterative.

use std::collections::BTreeMap;

use crate::earley::{Cap, EngineError, Frame, Recognizer, Tok};
use crate::lower::{LEmit, LEmitItem, LTerm, Lowered};
use crate::rank::{DNode, Ranker};
use crate::result::{Node, NodeKind};
use crate::tags::{phoneme_of, SetId};

#[derive(Debug, Clone)]
pub(crate) enum IKind {
    Read { tok: u32, terminal: u32 },
    Close { prod: u32, start: u32, end: u32, tags: SetId, caps: Vec<Cap> },
}

#[derive(Debug, Clone)]
pub(crate) struct INode {
    pub kind: IKind,
    pub children: Vec<u32>,
}

/// A derivation as a plain tree: node 0 is the root, and every node's
/// children come after it.
pub(crate) struct ITree {
    pub nodes: Vec<INode>,
}

/// Builds the tree of a derivation.
pub(crate) fn build(ranker: &Ranker, root: u32) -> ITree {
    let mut nodes: Vec<INode> = Vec::new();
    let mut stack: Vec<(u32, Option<u32>)> = vec![(root, None)];
    while let Some((id, parent)) = stack.pop() {
        let index = nodes.len() as u32;
        match ranker.dag.arena[id as usize] {
            DNode::Read { tok, terminal, .. } => {
                nodes.push(INode { kind: IKind::Read { tok, terminal }, children: Vec::new() });
            }
            DNode::Close { body, set, item } => {
                let it = ranker.item(set, item);
                let tags = ranker.chart().sets[set as usize].tagset[item as usize];
                nodes.push(INode {
                    kind: IKind::Close {
                        prod: it.prod,
                        start: it.origin,
                        end: set,
                        tags,
                        caps: ranker.chart().caps(it.caps).to_vec(),
                    },
                    children: Vec::new(),
                });
                let mut kids = Vec::new();
                let mut current = body;
                while let DNode::Seq { left, right } = ranker.dag.arena[current as usize] {
                    kids.push(right);
                    current = left;
                }
                // `kids` is last child first; the stack pops the first first.
                for kid in kids {
                    stack.push((kid, Some(index)));
                }
            }
            DNode::Seq { .. } | DNode::Empty => unreachable!("a derivation's nodes are reads and closes"),
        }
        if let Some(parent) = parent {
            nodes[parent as usize].children.push(index);
        }
    }
    ITree { nodes }
}

/// What the public tree needs to know of a stage: its tokens and tag names.
pub(crate) struct TreeContext<'a> {
    pub g: &'a Lowered,
    pub tokens: &'a [Tok],
    pub tag_map: &'a dyn Fn(SetId) -> BTreeMap<String, bool>,
    /// For the `elision-only` check: which tokens are written-back
    /// terminators, to be shown as elided nodes over the original input.
    pub synthetic: Option<&'a [bool]>,
}

impl<'a> TreeContext<'a> {
    fn original(&self, index: u32) -> usize {
        match self.synthetic {
            None => index as usize,
            Some(flags) => index as usize - flags[..index as usize].iter().filter(|&&flag| flag).count(),
        }
    }

    fn original_tokens(&self) -> Vec<&'a Tok> {
        match self.synthetic {
            None => self.tokens.iter().collect(),
            Some(flags) => self.tokens.iter().zip(flags).filter(|(_, &flag)| !flag).map(|(token, _)| token).collect(),
        }
    }
}

/// The source range of a span of tokens: from the first's start to the
/// last's end, or, for an empty span, empty at the end of the token before.
pub(crate) fn source_of(tokens: &[&Tok], start: usize, end: usize) -> std::ops::Range<usize> {
    if start < end {
        tokens[start].source.0..tokens[end - 1].source.1
    } else {
        let at = if start > 0 { tokens[start - 1].source.1 } else { tokens.first().map_or(0, |token| token.source.0) };
        at..at
    }
}

/// Builds the result's tree (§12): helpers and the prefixes of trailing
/// repetitions spliced out, absent elidable optionals as elided nodes.
pub(crate) fn public_tree(tree: &ITree, context: &TreeContext) -> Node {
    let originals = context.original_tokens();
    let mut fragments: Vec<Vec<Node>> = (0..tree.nodes.len()).map(|_| Vec::new()).collect();
    for index in (0..tree.nodes.len()).rev() {
        let node = &tree.nodes[index];
        let made = match node.kind {
            IKind::Read { tok, terminal } => {
                let at = context.original(tok);
                let name = context.g.terminals[terminal as usize].clone();
                let synthetic = context.synthetic.is_some_and(|flags| flags[tok as usize]);
                let source = source_of(&originals, at, if synthetic { at } else { at + 1 });
                vec![Node {
                    kind: if synthetic { NodeKind::Elided } else { NodeKind::Token },
                    rule: None,
                    terminal: Some(name),
                    token: if synthetic { None } else { Some(at) },
                    span: at..if synthetic { at } else { at + 1 },
                    source,
                    tags: BTreeMap::new(),
                    children: Vec::new(),
                }]
            }
            IKind::Close { prod, start, end, tags, .. } => {
                let production = &context.g.prods[prod as usize];
                let rule = &context.g.rules[production.rule as usize];
                let mut children = Vec::new();
                for (position, &child) in node.children.iter().enumerate() {
                    let mut made = std::mem::take(&mut fragments[child as usize]);
                    if position == 0 && production.trailing_step && made.len() == 1 && made[0].kind == NodeKind::Rule {
                        // Take over the prefix's list rather than copy it, so
                        // that a long repetition costs linear time.
                        children = std::mem::take(&mut made[0].children);
                    } else {
                        children.append(&mut made);
                    }
                }
                let (start, end) = (context.original(start), context.original(end));
                if rule.helper {
                    match (&rule.elided, production.syms.is_empty()) {
                        (Some(terminal), true) => vec![Node {
                            kind: NodeKind::Elided,
                            rule: None,
                            terminal: Some(terminal.clone()),
                            token: None,
                            span: start..start,
                            source: source_of(&originals, start, start),
                            tags: BTreeMap::new(),
                            children: Vec::new(),
                        }],
                        _ => children,
                    }
                } else {
                    vec![Node {
                        kind: NodeKind::Rule,
                        rule: Some(rule.name.clone()),
                        terminal: None,
                        token: None,
                        span: start..end,
                        source: source_of(&originals, start, end),
                        tags: (context.tag_map)(tags),
                        children,
                    }]
                }
            }
        };
        fragments[index] = made;
    }
    let mut root = std::mem::take(&mut fragments[0]);
    root.pop().expect("the root is a rule node")
}

/// A token emitted for the next stage.
#[derive(Debug, Clone)]
pub(crate) struct Emitted {
    pub span: (usize, usize),
    pub source: (usize, usize),
    pub tags: SetId,
    pub phonemes: Option<String>,
    pub inserted_by: Option<String>,
}

enum Work {
    Visit(u32),
    /// A token covering node `node` with the given tags.
    Cover(u32, SetId),
    /// An inserted token with one tag, at a token index, in a node.
    Insert {
        tag: String,
        at: u32,
        node: u32,
    },
}

fn span_of(tree: &ITree, index: u32) -> (u32, u32) {
    match tree.nodes[index as usize].kind {
        IKind::Read { tok, .. } => (tok, tok + 1),
        IKind::Close { start, end, .. } => (start, end),
    }
}

/// The phonemes of a token emitted from a node (§5): its strong phoneme
/// tag, or the phonemes of the tokens below it, skipping every constituent
/// that emits ε, the node's own included, with each run of pauses made one
/// and a pause at either end removed.
fn phonemes(
    recognizer: &Recognizer,
    tree: &ITree,
    tokens: &[Tok],
    root: u32,
    tags: SetId,
) -> Result<Option<String>, EngineError> {
    let mut own: Option<&str> = None;
    for &(id, strong) in recognizer.shared.tags.list(tags) {
        if let (true, Some(phoneme)) = (strong, phoneme_of(recognizer.shared.tags.name(id))) {
            if own.is_some() {
                return Err(EngineError { message: "a token carries two strong phoneme tags".to_string(), rule: None });
            }
            own = Some(phoneme);
        }
    }
    if let Some(phoneme) = own {
        return Ok(Some(phoneme.to_string()));
    }
    let mut out = String::new();
    let mut stack = vec![root];
    while let Some(index) = stack.pop() {
        let node = &tree.nodes[index as usize];
        match node.kind {
            IKind::Read { tok, .. } => {
                if let Some(phonemes) = &tokens[tok as usize].phonemes {
                    out.push_str(phonemes);
                }
            }
            IKind::Close { prod, .. } => {
                // A constituent that emits ε does not count (§11).
                if !matches!(recognizer.g.prods[prod as usize].emit, LEmit::Nothing) {
                    stack.extend(node.children.iter().rev());
                }
            }
        }
    }
    // Each run of pauses is one, and none is left at either end.
    let mut collapsed = String::with_capacity(out.len());
    for c in out.chars() {
        if c != '.' || !(collapsed.is_empty() || collapsed.ends_with('.')) {
            collapsed.push(c);
        }
    }
    if collapsed.ends_with('.') {
        collapsed.pop();
    }
    Ok(Some(collapsed))
}

/// The tags an emission item's term gives a token (§11): a term that gives
/// none is an error of the grammar, since no terminal could read the token.
fn item_tags(recognizer: &mut Recognizer, term: &LTerm, frame: &Frame, tokens: &[Tok]) -> Result<SetId, EngineError> {
    let set = recognizer.tag_term(term, frame, tokens, 0)?;
    if recognizer.shared.tags.list(set).is_empty() {
        let owner = recognizer.g.prods[frame.prod as usize].owner;
        return Err(EngineError {
            message: "an emission gives a token no tags, which no terminal can read; %emits ε emits nothing"
                .to_string(),
            rule: Some(owner),
        });
    }
    Ok(set)
}

/// Walks the chosen tree from the left and emits the next stage's tokens
/// (§11).
pub(crate) fn emit(recognizer: &mut Recognizer, tree: &ITree, tokens: &[Tok]) -> Result<Vec<Emitted>, EngineError> {
    let g = recognizer.g;
    let mut out = Vec::new();
    let mut stack = vec![Work::Visit(0)];
    let empty_source = |at: u32| -> usize {
        if at > 0 {
            tokens[at as usize - 1].source.1
        } else {
            tokens.first().map_or(0, |token| token.source.0)
        }
    };
    while let Some(work) = stack.pop() {
        match work {
            Work::Visit(index) => {
                let node = &tree.nodes[index as usize];
                let IKind::Close { prod, start, end, tags, caps } = &node.kind else {
                    continue;
                };
                let (tags, caps) = (*tags, caps.clone());
                let frame = Frame { caps: &caps, prod: *prod, origin: *start, end: *end, tags: Some(tags) };
                let production = &g.prods[*prod as usize];
                match &production.emit {
                    LEmit::Nothing => {}
                    LEmit::None => {
                        for &child in node.children.iter().rev() {
                            stack.push(Work::Visit(child));
                        }
                    }
                    LEmit::This(items) => {
                        let mut covers = Vec::new();
                        for term in items {
                            let set = match term {
                                Some(term) => item_tags(recognizer, term, &frame, tokens)?,
                                None => tags,
                            };
                            covers.push(Work::Cover(index, set));
                        }
                        stack.extend(covers.into_iter().rev());
                    }
                    LEmit::Items(items) => {
                        // Exactly the items, in the order listed; nothing
                        // inside the constituent is walked (§11).
                        let (_, end) = span_of(tree, index);
                        let child = |slot: u8| node.children[production.cap_pos[slot as usize] as usize];
                        let mut sequence = Vec::with_capacity(items.len());
                        for item in items {
                            match item {
                                LEmitItem::Cap(slot, term) => {
                                    let set = match term {
                                        Some(term) => item_tags(recognizer, term, &frame, tokens)?,
                                        None => caps[*slot as usize].tags,
                                    };
                                    sequence.push(Work::Cover(child(*slot), set));
                                }
                                LEmitItem::Insert(tag, anchor) => {
                                    // At the start of the part of the capture
                                    // listed next, or at the constituent's end.
                                    let at = anchor.map_or(end, |slot| span_of(tree, child(slot)).0);
                                    sequence.push(Work::Insert { tag: tag.clone(), at, node: index });
                                }
                            }
                        }
                        stack.extend(sequence.into_iter().rev());
                    }
                }
            }
            Work::Cover(index, tags) => {
                let (start, end) = span_of(tree, index);
                let source = if start < end {
                    (tokens[start as usize].source.0, tokens[end as usize - 1].source.1)
                } else {
                    let at = empty_source(start);
                    (at, at)
                };
                let phonemes = phonemes(recognizer, tree, tokens, index, tags)?;
                out.push(Emitted { span: (start as usize, end as usize), source, tags, phonemes, inserted_by: None });
            }
            Work::Insert { tag, at, node } => {
                let (start, end) = span_of(tree, node);
                let source = if at > start {
                    tokens[at as usize - 1].source.1
                } else if start < end {
                    tokens[start as usize].source.0
                } else {
                    empty_source(start)
                };
                let IKind::Close { prod, .. } = &tree.nodes[node as usize].kind else { unreachable!("a close") };
                let owner = g.prods[*prod as usize].owner;
                let set = recognizer.shared.tags.set_of([(tag.as_str(), true)]);
                out.push(Emitted {
                    span: (at as usize, at as usize),
                    source: (source, source),
                    tags: set,
                    phonemes: Some(phoneme_of(&tag).unwrap_or("").to_string()),
                    inserted_by: Some(g.rules[owner as usize].name.clone()),
                });
            }
        }
    }
    Ok(out)
}
