//! From a chosen derivation to the result's tree and its warnings (engine
//! §12), and to the next stage's tokens (§11). Every walk here is
//! iterative.

use std::collections::BTreeSet;

use crate::earley::{Cap, EngineError, Frame, Recognizer, Tok};
use crate::fxhash::{FxMap, FxSet};
use crate::lower::{LEmit, LEmitItem, LTerm, Lowered};
use crate::rank::{DNode, Ranker};
use crate::result::{Attachment, Node, NodeKind, Warning};
use crate::tags::{phoneme_of, union, SetId, TagList, Tags};

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
    pub tag_map: &'a dyn Fn(SetId) -> BTreeSet<String>,
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

/// Where runs of tokens lie in the text. The source of a run is from the
/// least source start among its tokens to the greatest source end (§1).
/// Tokens usually lie in the order of their sources, and then that is the
/// first token's start and the last token's end. Otherwise a table of the
/// least start and the greatest end of every run of a power of two tokens
/// answers without a scan, so that the nested nodes of a long
/// left-recursive rule cost no more than its tokens.
pub(crate) struct Sources {
    /// Each token's source.
    pairs: Vec<(usize, usize)>,
    /// `lows[k][i]` is the least source start of tokens `i..i + 2^k`, and
    /// `highs[k][i]` the greatest end; both are empty when the tokens are
    /// in order.
    lows: Vec<Vec<usize>>,
    highs: Vec<Vec<usize>>,
}

impl Sources {
    pub(crate) fn new<'t>(tokens: impl IntoIterator<Item = &'t Tok>) -> Sources {
        let pairs: Vec<(usize, usize)> = tokens.into_iter().map(|token| token.source).collect();
        let mut sources = Sources { pairs, lows: Vec::new(), highs: Vec::new() };
        let pairs = &sources.pairs;
        if pairs.windows(2).all(|two| two[0].0 <= two[1].0 && two[0].1 <= two[1].1) {
            return sources;
        }
        let mut low: Vec<usize> = pairs.iter().map(|pair| pair.0).collect();
        let mut high: Vec<usize> = pairs.iter().map(|pair| pair.1).collect();
        let mut width = 1;
        while 2 * width <= pairs.len() {
            let count = pairs.len() - 2 * width + 1;
            let next_low = (0..count).map(|index| low[index].min(low[index + width])).collect();
            let next_high = (0..count).map(|index| high[index].max(high[index + width])).collect();
            sources.lows.push(std::mem::replace(&mut low, next_low));
            sources.highs.push(std::mem::replace(&mut high, next_high));
            width *= 2;
        }
        sources.lows.push(low);
        sources.highs.push(high);
        sources
    }

    /// The source of tokens `start..end`, which must not be empty.
    pub(crate) fn of(&self, start: usize, end: usize) -> (usize, usize) {
        if self.lows.is_empty() {
            return (self.pairs[start].0, self.pairs[end - 1].1);
        }
        // Two runs of a power of two tokens cover the span between them.
        let level = (usize::BITS - 1 - (end - start).leading_zeros()) as usize;
        let other = end - (1 << level);
        let (lows, highs) = (&self.lows[level], &self.highs[level]);
        (lows[start].min(lows[other]), highs[start].max(highs[other]))
    }

    /// Where an empty span at token index `at` lies: the source end of the
    /// token before it, or the source start of the first token (§12).
    pub(crate) fn empty(&self, at: usize) -> usize {
        if at > 0 {
            self.pairs[at - 1].1
        } else {
            self.pairs.first().map_or(0, |pair| pair.0)
        }
    }
}

/// The source range of a span of tokens: their source (§1), or, for an
/// empty span, empty where it lies (§12).
pub(crate) fn source_of(sources: &Sources, start: usize, end: usize) -> std::ops::Range<usize> {
    if start < end {
        let (from, to) = sources.of(start, end);
        from..to
    } else {
        let at = sources.empty(start);
        at..at
    }
}

/// Builds the result's tree (§12): helpers and the prefixes of trailing
/// repetitions spliced out, absent elidable optionals as elided nodes.
pub(crate) fn public_tree(tree: &ITree, context: &TreeContext) -> Node {
    let originals = Sources::new(context.original_tokens());
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
                    tags: BTreeSet::new(),
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
                            tags: BTreeSet::new(),
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
    let sources = Sources::new(tokens);
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
                    source: source_of(&sources, start as usize, end as usize),
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
    /// What it shows to people (§5).
    pub label: String,
    pub inserted_by: Option<String>,
    /// The tokens attached before it and after it (§11).
    pub before: Vec<Attachment>,
    pub after: Vec<Attachment>,
}

enum Work<'g> {
    Visit(u32),
    /// A token covering node `node`. Its tags are those of an item's term,
    /// evaluated in the frame of the constituent `owner` when the token is
    /// made (§10, §11), or else `tags`.
    Cover {
        node: u32,
        owner: u32,
        term: Option<&'g LTerm>,
        tags: SetId,
    },
    /// An inserted token with one tag, at a token index, in a node.
    Insert {
        tag: String,
        at: u32,
        node: u32,
    },
    /// Where an item's before-attachments begin in the output, or where its
    /// carrier stands.
    Mark,
    /// Moves the tokens since the item's two marks into its carrier's
    /// attachments (§11).
    Attach,
}

/// What forwarding needs across one emission (§11): whether any input
/// token has attachments, and the input tokens whose attachments a token of
/// this emission has inherited.
struct Forwarding {
    on: bool,
    inherited: FxSet<u32>,
}

fn span_of(tree: &ITree, index: u32) -> (u32, u32) {
    match tree.nodes[index as usize].kind {
        IKind::Read { tok, .. } => (tok, tok + 1),
        IKind::Close { start, end, .. } => (start, end),
    }
}

/// The phoneme of a token's phoneme tag, if it has one (§5). Two such
/// tags are an error of the grammar on any token.
fn phoneme_tag(recognizer: &Recognizer, tags: SetId) -> Result<Option<String>, EngineError> {
    let mut own: Option<&str> = None;
    for &id in recognizer.shared.tags.list(tags) {
        if let Some(phoneme) = phoneme_of(recognizer.shared.tags.name(id)) {
            if own.is_some() {
                return Err(EngineError { message: "a token carries two phoneme tags".to_string(), rule: None });
            }
            own = Some(phoneme);
        }
    }
    Ok(own.map(str::to_string))
}

/// The phonemes and the label of a phoneme tag `/p/` (§5): `p` and `p`,
/// but a space for the label of the pause.
fn sounded(phoneme: String) -> (String, String) {
    let label = if phoneme == "." { " ".to_string() } else { phoneme.clone() };
    (phoneme, label)
}

/// The source and the text of a foreign part (§11).
struct ForeignPart {
    source: (usize, usize),
    text: String,
}

/// Whether a production's constituent emits ε and so does not count (§11).
fn counts_for_nothing(g: &Lowered, prod: u32) -> bool {
    matches!(g.prods[prod as usize].emit, LEmit::Nothing)
}

/// The foreign parts of the chosen derivation, with their sources and
/// texts (§11): the constituents of `%foreign` productions inside no
/// constituent that emits ε and no other foreign part. The stage fixes them
/// before it emits anything, so that every token over a part holds the same
/// text.
fn foreign_parts(
    g: &Lowered,
    tree: &ITree,
    tokens: &[Tok],
    sources: &Sources,
    text: &[char],
) -> FxMap<u32, ForeignPart> {
    let mut parts: Vec<(u32, u32, u32)> = Vec::new();
    let mut stack = vec![0u32];
    while let Some(index) = stack.pop() {
        let node = &tree.nodes[index as usize];
        let IKind::Close { prod, start, end, .. } = node.kind else {
            continue;
        };
        if counts_for_nothing(g, prod) {
            continue;
        }
        if g.prods[prod as usize].foreign {
            parts.push((index, start, end));
            continue;
        }
        stack.extend(node.children.iter().rev());
    }
    // Text between two input tokens belongs to the part with a non-empty
    // span that ends there, before one that starts there.
    let ends: FxSet<u32> = parts.iter().filter(|(_, start, end)| start < end).map(|&(_, _, end)| end).collect();
    let mut result = FxMap::default();
    for (index, start, end) in parts {
        let source = if start == end {
            // An empty part takes in no text. Its source is that of an
            // empty node (§12).
            let at = sources.empty(start as usize);
            (at, at)
        } else {
            let before = if start > 0 { tokens[start as usize - 1].source.1 } else { 0 };
            // It always holds the source of its own tokens (§1), which the
            // tokens next to it can share, and takes in the text next to it
            // that no input token covers.
            let own = sources.of(start as usize, end as usize);
            let from = if ends.contains(&start) { own.0 } else { own.0.min(before) };
            let after = tokens.get(end as usize).map_or(text.len(), |token| token.source.0);
            (from, own.1.max(after))
        };
        result.insert(index, ForeignPart { source, text: text[source.0..source.1].iter().collect() });
    }
    result
}

/// A join of the phonemes or of the labels of a token's parts (§5): a part
/// with an empty string is left out, of each run of adjacent pause parts
/// only the first is kept, and a pause part at either end is left out.
/// Pauses are counted by part, so a part keeps its own periods and spaces.
#[derive(Default)]
struct Join {
    joined: String,
    /// Whether the last piece kept is a pause part, and where it starts.
    pause: Option<usize>,
}

impl Join {
    fn add(&mut self, piece: &str, pause: bool) {
        if piece.is_empty() || (pause && (self.joined.is_empty() || self.pause.is_some())) {
            return;
        }
        self.pause = pause.then_some(self.joined.len());
        self.joined.push_str(piece);
    }

    fn result(mut self) -> String {
        if let Some(at) = self.pause {
            self.joined.truncate(at);
        }
        self.joined
    }
}

/// What a node says and shows (§5, §11): the phonemes and the labels of its
/// parts, joined. A part is a read input token or a foreign part. Nothing
/// inside a constituent that emits ε is a part, the node's own included,
/// and the walk does not enter a foreign part.
fn spoken(g: &Lowered, tree: &ITree, tokens: &[Tok], foreign: &FxMap<u32, ForeignPart>, root: u32) -> (String, String) {
    let mut phonemes = Join::default();
    let mut label = Join::default();
    let mut stack = vec![root];
    while let Some(index) = stack.pop() {
        let node = &tree.nodes[index as usize];
        match node.kind {
            IKind::Read { tok, .. } => {
                let token = &tokens[tok as usize];
                let sound = token.phonemes.as_deref().unwrap_or("");
                phonemes.add(sound, sound == ".");
                label.add(&token.label, sound == ".");
            }
            IKind::Close { prod, .. } => {
                if counts_for_nothing(g, prod) {
                    continue;
                }
                if let Some(part) = foreign.get(&index) {
                    phonemes.add("?", false);
                    label.add(&part.text, false);
                    continue;
                }
                stack.extend(node.children.iter().rev());
            }
        }
    }
    (phonemes.result(), label.result())
}

/// The token that covers node `index` with the given tags (§5, §11).
#[allow(clippy::too_many_arguments)]
fn cover(
    recognizer: &Recognizer,
    tree: &ITree,
    tokens: &[Tok],
    sources: &Sources,
    foreign: &FxMap<u32, ForeignPart>,
    forwarding: &mut Forwarding,
    index: u32,
    tags: SetId,
) -> Result<Emitted, EngineError> {
    let (start, end) = span_of(tree, index);
    let span = (start as usize, end as usize);
    // Two phoneme tags are an error on any token (§5).
    let phoneme = phoneme_tag(recognizer, tags)?;
    // A token over a foreign part has the part's source (§11).
    let source = if let Some(part) = foreign.get(&index) {
        part.source
    } else if start < end {
        sources.of(span.0, span.1)
    } else {
        let at = sources.empty(span.0);
        (at, at)
    };
    // A phoneme tag decides the sound and the label, over `?` (§5).
    let (phonemes, label) = match phoneme {
        Some(phoneme) => sounded(phoneme),
        None => spoken(recognizer.g, tree, tokens, foreign, index),
    };
    let mut token = Emitted {
        span,
        source,
        tags,
        phonemes: Some(phonemes),
        label,
        inserted_by: None,
        before: Vec::new(),
        after: Vec::new(),
    };
    // The parts decide the attachments too, after the phoneme tags are
    // checked (§11).
    if forwarding.on {
        if let Some(from) = forwarded(recognizer.g, tree, tokens, foreign, index)? {
            // Attachments belong to one token: an input token that is the
            // one part of a second token is an error of the grammar.
            if !forwarding.inherited.insert(from) {
                return Err(EngineError {
                    message: "a token with attachments is the one part of two emitted tokens, and its attachments \
                              cannot belong to both"
                        .to_string(),
                    rule: None,
                });
            }
            token.before = tokens[from as usize].before.clone();
            token.after = tokens[from as usize].after.clone();
        }
    }
    Ok(token)
}

/// The one input token whose attachments a token over node `root` inherits,
/// or `None` (§11). The parts are those of the join (§5): a read input
/// token, or a foreign part as one piece, and nothing inside a constituent
/// that emits ε. A token with attachments among other parts, or a foreign
/// part that holds one, is an error of the grammar.
fn forwarded(
    g: &Lowered,
    tree: &ITree,
    tokens: &[Tok],
    foreign: &FxMap<u32, ForeignPart>,
    root: u32,
) -> Result<Option<u32>, EngineError> {
    let mut parts = 0usize;
    let mut found = None;
    let mut stack = vec![root];
    while let Some(index) = stack.pop() {
        let node = &tree.nodes[index as usize];
        match node.kind {
            IKind::Read { tok, .. } => {
                parts += 1;
                if tokens[tok as usize].has_attachments() {
                    found = Some(tok);
                }
            }
            IKind::Close { prod, .. } => {
                if counts_for_nothing(g, prod) {
                    continue;
                }
                if foreign.contains_key(&index) {
                    parts += 1;
                    if holds_attachments(g, tree, tokens, index) {
                        return Err(EngineError {
                            message: "a foreign part over a token with attachments, which a token over it cannot place"
                                .to_string(),
                            rule: Some(g.prods[prod as usize].owner),
                        });
                    }
                    continue;
                }
                stack.extend(node.children.iter().rev());
            }
        }
    }
    if found.is_some() && parts > 1 {
        return Err(EngineError {
            message: "a token over a token with attachments and another part cannot say which part each attachment \
                      belongs to"
                .to_string(),
            rule: None,
        });
    }
    Ok(found)
}

/// Whether a foreign part holds an input token with attachments: one that
/// it reads outside any constituent that emits ε (§11).
fn holds_attachments(g: &Lowered, tree: &ITree, tokens: &[Tok], root: u32) -> bool {
    let mut stack = vec![root];
    while let Some(index) = stack.pop() {
        let node = &tree.nodes[index as usize];
        match node.kind {
            IKind::Read { tok, .. } => {
                if tokens[tok as usize].has_attachments() {
                    return true;
                }
            }
            IKind::Close { prod, .. } => {
                if !counts_for_nothing(g, prod) {
                    stack.extend(node.children.iter().rev());
                }
            }
        }
    }
    false
}

/// An emitted token as an attachment: the same token without its span
/// (§11), with its tags and its text as the result has them.
fn attachment(recognizer: &Recognizer, token: Emitted) -> Attachment {
    Attachment {
        text: recognizer.shared.source_text(token.source.0, token.source.1),
        phonemes: token.phonemes,
        label: token.label,
        tags: recognizer.shared.tags.to_set(token.tags),
        source: token.source.0..token.source.1,
        inserted_by: token.inserted_by,
        before: token.before,
        after: token.after,
    }
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

/// A token's explicit tags with the tags of the stage's implications, added
/// until no tag changes (§11). An implication only adds tags, so the loop
/// ends, also over a cycle.
fn implied(tags: &mut Tags, set: SetId, implications: &[(TagList, TagList)]) -> SetId {
    if implications.is_empty() {
        return set;
    }
    let mut list = tags.list(set).clone();
    let mut grown = false;
    loop {
        let mut changed = false;
        for (antecedent, consequent) in implications {
            if antecedent.iter().any(|tag| list.binary_search(tag).is_ok()) {
                let more = union(&list, consequent);
                if more.len() != list.len() {
                    list = more;
                    changed = true;
                }
            }
        }
        if !changed {
            break;
        }
        grown = true;
    }
    if grown {
        tags.set(list)
    } else {
        set
    }
}

/// Walks the chosen tree from the left and emits the next stage's tokens
/// (§11).
pub(crate) fn emit(recognizer: &mut Recognizer, tree: &ITree, tokens: &[Tok]) -> Result<Vec<Emitted>, EngineError> {
    let g = recognizer.g;
    let sources = Sources::new(tokens);
    // The stage's implications, as tag sets of this parse (§11).
    let tags = &mut recognizer.shared.tags;
    let implications: Vec<(TagList, TagList)> = g
        .implications
        .iter()
        .map(|implication| {
            let mut side = |names: &BTreeSet<String>| {
                let mut list: TagList = names.iter().map(|name| tags.tag(name)).collect();
                list.sort_unstable();
                list
            };
            (side(&implication.antecedent), side(&implication.consequent))
        })
        .collect();
    let mut out: Vec<Emitted> = Vec::new();
    // The foreign parts and their texts, fixed before any token (§11).
    let foreign = foreign_parts(g, tree, tokens, &sources, recognizer.shared.text);
    let mut forwarding = Forwarding { on: tokens.iter().any(Tok::has_attachments), inherited: FxSet::default() };
    // The output positions of the marks of the items being emitted.
    let mut marks: Vec<usize> = Vec::new();
    let mut stack = vec![Work::Visit(0)];
    while let Some(work) = stack.pop() {
        match work {
            Work::Visit(index) => {
                let node = &tree.nodes[index as usize];
                let IKind::Close { prod, tags, caps, .. } = &node.kind else {
                    continue;
                };
                let production = &g.prods[*prod as usize];
                match &production.emit {
                    LEmit::Nothing => {}
                    LEmit::None => {
                        for &child in node.children.iter().rev() {
                            stack.push(Work::Visit(child));
                        }
                    }
                    LEmit::This(items) => {
                        // One token over the constituent per `$`, each with
                        // its term evaluated when it is made.
                        for term in items.iter().rev() {
                            stack.push(Work::Cover { node: index, owner: index, term: term.as_ref(), tags: *tags });
                        }
                    }
                    LEmit::Items(items) => {
                        // Exactly the items, in the order listed; nothing
                        // inside the constituent is walked but their
                        // attachments (§11).
                        let (_, end) = span_of(tree, index);
                        let child = |slot: u8| node.children[production.cap_pos[slot as usize] as usize];
                        let mut sequence = Vec::with_capacity(items.len());
                        for item in items {
                            match item {
                                LEmitItem::Cap(slot, term, before, after) => {
                                    let carrier = Work::Cover {
                                        node: child(*slot),
                                        owner: index,
                                        term: term.as_ref(),
                                        tags: caps[*slot as usize].tags,
                                    };
                                    if before.is_empty() && after.is_empty() {
                                        sequence.push(carrier);
                                        continue;
                                    }
                                    // Before-attachments, then the carrier
                                    // with its tag term, then
                                    // after-attachments: each the tokens
                                    // that its captured part emits in its
                                    // place (§11).
                                    sequence.push(Work::Mark);
                                    sequence.extend(before.iter().map(|&slot| Work::Visit(child(slot))));
                                    sequence.push(Work::Mark);
                                    sequence.push(carrier);
                                    sequence.extend(after.iter().map(|&slot| Work::Visit(child(slot))));
                                    sequence.push(Work::Attach);
                                }
                                LEmitItem::Insert(tag, anchor) => {
                                    // At the start of the first written part
                                    // of the capture item listed next, or at
                                    // the constituent's end.
                                    let at = anchor.map_or(end, |slot| span_of(tree, child(slot)).0);
                                    sequence.push(Work::Insert { tag: tag.clone(), at, node: index });
                                }
                            }
                        }
                        stack.extend(sequence.into_iter().rev());
                    }
                }
            }
            Work::Cover { node, owner, term, tags } => {
                let tags = match term {
                    Some(term) => {
                        let IKind::Close { prod, start, end, tags, caps } = &tree.nodes[owner as usize].kind else {
                            unreachable!("an emission's constituent")
                        };
                        let frame = Frame { caps, prod: *prod, origin: *start, end: *end, tags: Some(*tags) };
                        item_tags(recognizer, term, &frame, tokens)?
                    }
                    None => tags,
                };
                let tags = implied(&mut recognizer.shared.tags, tags, &implications);
                out.push(cover(recognizer, tree, tokens, &sources, &foreign, &mut forwarding, node, tags)?);
            }
            Work::Mark => marks.push(out.len()),
            Work::Attach => {
                // New attachments are outer to inherited ones (§11).
                let at = marks.pop().expect("a carrier's mark");
                let first = marks.pop().expect("an item's mark");
                let after: Vec<Emitted> = out.drain(at + 1..).collect();
                let mut carrier = out.pop().expect("a carrier");
                let before: Vec<Emitted> = out.drain(first..).collect();
                if !before.is_empty() {
                    let mut all: Vec<Attachment> =
                        before.into_iter().map(|token| attachment(recognizer, token)).collect();
                    all.append(&mut carrier.before);
                    carrier.before = all;
                }
                carrier.after.extend(after.into_iter().map(|token| attachment(recognizer, token)));
                out.push(carrier);
            }
            Work::Insert { tag, at, node } => {
                let (start, end) = span_of(tree, node);
                // At the source end of the token before, or at the start of
                // the constituent's source if `at` is its start.
                let source = if at > start {
                    tokens[at as usize - 1].source.1
                } else if start < end {
                    sources.of(start as usize, end as usize).0
                } else {
                    sources.empty(start as usize)
                };
                let IKind::Close { prod, .. } = &tree.nodes[node as usize].kind else { unreachable!("a close") };
                let owner = g.prods[*prod as usize].owner;
                let set = recognizer.shared.tags.set_of([tag.as_str()]);
                let set = implied(&mut recognizer.shared.tags, set, &implications);
                // Two phoneme tags are an error here too, where an
                // implication added one (§5). An inserted token has no
                // parts: a phoneme tag gives its phonemes and its label, or
                // both are empty.
                let (phonemes, label) = phoneme_tag(recognizer, set)?.map(sounded).unwrap_or_default();
                out.push(Emitted {
                    span: (at as usize, at as usize),
                    source: (source, source),
                    tags: set,
                    phonemes: Some(phonemes),
                    label,
                    inserted_by: Some(g.rules[owner as usize].name.clone()),
                    before: Vec::new(),
                    after: Vec::new(),
                });
            }
        }
    }
    Ok(out)
}
