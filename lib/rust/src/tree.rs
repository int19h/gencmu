//! From a chosen derivation to the result's tree and its warnings (engine
//! §12), and to the next stage's tokens (§11). Every walk here is
//! iterative.

use std::collections::{BTreeMap, BTreeSet};

use crate::earley::{Cap, EngineError, Frame, Recognizer, Tok};
use crate::fxhash::FxSet;
use crate::lower::{LEmit, LEmitItem, LTerm, Lowered};
use crate::rank::{DNode, Ranker};
use crate::result::{Node, NodeKind, Warning};
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

/// The warnings of a stage's chosen tree (§12): each rule node gives one
/// for each warning of its production whose feature is on, in the order a
/// walk meets the nodes, parent before children and children left to
/// right. The walk passes through what the tree splices out, helpers and
/// the prefixes of trailing repetitions, without counting them as nodes,
/// and so meets the tree's nodes in the tree's own order.
pub(crate) fn warnings_of(
    tree: &ITree,
    g: &Lowered,
    tokens: &[Tok],
    features: &BTreeSet<String>,
    stage: &str,
) -> Vec<Warning> {
    let tokens: Vec<&Tok> = tokens.iter().collect();
    let mut warnings = Vec::new();
    // Each node with whether the tree splices it out as a prefix.
    let mut stack = vec![(0u32, false)];
    while let Some((index, prefix)) = stack.pop() {
        let node = &tree.nodes[index as usize];
        let IKind::Close { prod, start, end, .. } = node.kind else {
            continue;
        };
        let production = &g.prods[prod as usize];
        if !prefix {
            // A helper's productions have no warnings.
            for feature in production.warnings.iter().filter(|&feature| features.contains(feature)) {
                warnings.push(Warning {
                    stage: stage.to_string(),
                    feature: feature.clone(),
                    rule: g.rules[production.rule as usize].name.clone(),
                    span: start as usize..end as usize,
                    source: source_of(&tokens, start as usize, end as usize),
                });
            }
        }
        for (position, &child) in node.children.iter().enumerate().rev() {
            stack.push((child, position == 0 && production.trailing_step));
        }
    }
    warnings
}

/// A token emitted for the next stage.
#[derive(Debug, Clone)]
pub(crate) struct Emitted {
    pub span: (usize, usize),
    pub source: (usize, usize),
    pub tags: SetId,
    pub phonemes: Option<String>,
    /// Whether its phonemes are its text (§11).
    pub verbatim: bool,
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

/// The phoneme of a token's strong phoneme tag, if it has one (§5). Two
/// such tags are an error of the grammar on any token, verbatim or not.
fn phoneme_tag(recognizer: &Recognizer, tags: SetId) -> Result<Option<String>, EngineError> {
    let mut own: Option<&str> = None;
    for &(id, strong) in recognizer.shared.tags.list(tags) {
        if let (true, Some(phoneme)) = (strong, phoneme_of(recognizer.shared.tags.name(id))) {
            if own.is_some() {
                return Err(EngineError { message: "a token carries two strong phoneme tags".to_string(), rule: None });
            }
            own = Some(phoneme);
        }
    }
    Ok(own.map(str::to_string))
}

/// What a node says (§5): the phonemes of the tokens below it, skipping
/// every constituent that emits ε, the node's own included. It keeps only
/// the first of each run of pause tokens, and leaves out a pause token at
/// either end. It counts pauses by token, so a verbatim token keeps its
/// periods.
fn spoken(g: &Lowered, tree: &ITree, tokens: &[Tok], root: u32) -> String {
    let mut pieces: Vec<&str> = Vec::new();
    let mut stack = vec![root];
    while let Some(index) = stack.pop() {
        let node = &tree.nodes[index as usize];
        match node.kind {
            IKind::Read { tok, .. } => {
                let phonemes = tokens[tok as usize].phonemes.as_deref().unwrap_or("");
                let repeated = phonemes == "." && matches!(pieces.last(), None | Some(&"."));
                if !phonemes.is_empty() && !repeated {
                    pieces.push(phonemes);
                }
            }
            IKind::Close { prod, .. } => {
                // A constituent that emits ε does not count (§11).
                if !matches!(g.prods[prod as usize].emit, LEmit::Nothing) {
                    stack.extend(node.children.iter().rev());
                }
            }
        }
    }
    if pieces.last() == Some(&".") {
        pieces.pop();
    }
    pieces.concat()
}

/// The source position of an empty span at the token index `at`: the
/// source end of the token before it, or the source start of the first.
fn empty_source(tokens: &[Tok], at: u32) -> usize {
    if at > 0 {
        tokens[at as usize - 1].source.1
    } else {
        tokens.first().map_or(0, |token| token.source.0)
    }
}

/// The token that covers node `index` with the given tags (§5, §11).
/// `widened_ends` holds where the widened tokens emitted before it end.
fn cover(
    recognizer: &Recognizer,
    tree: &ITree,
    tokens: &[Tok],
    index: u32,
    tags: SetId,
    widened_ends: &mut FxSet<u32>,
) -> Result<Emitted, EngineError> {
    let (start, end) = span_of(tree, index);
    let span = (start as usize, end as usize);
    // Two phoneme tags are an error on any token, verbatim or not (§5).
    let phoneme = phoneme_tag(recognizer, tags)?;
    let text = recognizer.shared.text;
    if let IKind::Close { prod, .. } = tree.nodes[index as usize].kind {
        if recognizer.g.prods[prod as usize].verbatim {
            // A widened token takes in the text next to it that no input
            // token covers, but not text that a widened token before it
            // took. It sounds like its text.
            let before = if start > 0 { tokens[span.0 - 1].source.1 } else { 0 };
            let source = if start == end {
                (before, before)
            } else {
                // It always holds its own tokens' sources, which the tokens
                // next to it can share.
                let own = (tokens[span.0].source.0, tokens[span.1 - 1].source.1);
                let from = if widened_ends.contains(&start) { own.0 } else { own.0.min(before) };
                let after = tokens.get(span.1).map_or(text.len(), |token| token.source.0);
                widened_ends.insert(end);
                (from, own.1.max(after))
            };
            let phonemes = text[source.0..source.1].iter().collect();
            return Ok(Emitted { span, source, tags, phonemes: Some(phonemes), verbatim: true, inserted_by: None });
        }
    }
    if end - start == 1 && tokens[span.0].verbatim {
        // A token over one verbatim token is verbatim, with its source.
        let only = &tokens[span.0];
        let phonemes = Some(only.text.clone());
        return Ok(Emitted { span, source: only.source, tags, phonemes, verbatim: true, inserted_by: None });
    }
    let source = if start < end {
        (tokens[span.0].source.0, tokens[span.1 - 1].source.1)
    } else {
        let at = empty_source(tokens, start);
        (at, at)
    };
    let phonemes = phoneme.unwrap_or_else(|| spoken(recognizer.g, tree, tokens, index));
    Ok(Emitted { span, source, tags, phonemes: Some(phonemes), verbatim: false, inserted_by: None })
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
    // Where the widened tokens emitted so far end (§11).
    let mut widened_ends: FxSet<u32> = FxSet::default();
    let mut stack = vec![Work::Visit(0)];
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
                out.push(cover(recognizer, tree, tokens, index, tags, &mut widened_ends)?);
            }
            Work::Insert { tag, at, node } => {
                let (start, end) = span_of(tree, node);
                let source = if at > start {
                    tokens[at as usize - 1].source.1
                } else if start < end {
                    tokens[start as usize].source.0
                } else {
                    empty_source(tokens, start)
                };
                let IKind::Close { prod, .. } = &tree.nodes[node as usize].kind else { unreachable!("a close") };
                let owner = g.prods[*prod as usize].owner;
                let set = recognizer.shared.tags.set_of([(tag.as_str(), true)]);
                out.push(Emitted {
                    span: (at as usize, at as usize),
                    source: (source, source),
                    tags: set,
                    phonemes: Some(phoneme_of(&tag).unwrap_or("").to_string()),
                    verbatim: false,
                    inserted_by: Some(g.rules[owner as usize].name.clone()),
                });
            }
        }
    }
    Ok(out)
}
