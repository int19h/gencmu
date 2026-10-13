//! From a chosen derivation to the result's tree and its warnings (engine
//! §12), and to the next stage's tokens (§11). Every walk here is
//! iterative.

use std::cell::Cell;
use std::collections::BTreeSet;

use crate::earley::{Cap, Caps, EngineError, Frame, Recognizer, Tok};
use crate::fxhash::{FxMap, FxSet};
use crate::grammar::Implication;
use crate::lower::{LEmit, LEmitItem, LTerm, Lowered};
use crate::rank::{DNode, Ranker};
use crate::result::{Attachment, Node, NodeKind, Restoration, Warning};
use crate::tags::{SetId, TagId, TagList, Tags};
use crate::work::{self, Mutant, Work as Counted};

#[derive(Debug, Clone)]
pub(crate) enum IKind {
    Read { tok: u32, terminal: u32 },
    Close { prod: u32, start: u32, end: u32, tags: SetId, caps: Vec<Cap> },
}

#[derive(Debug, Clone)]
pub(crate) struct INode {
    pub structure: u32,
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
                nodes.push(INode { structure: u32::MAX, kind: IKind::Read { tok, terminal }, children: Vec::new() });
            }
            DNode::Close { body, set, item } => {
                let it = ranker.item(set, item);
                let tags = ranker.chart().sets[set as usize].tagset[item as usize];
                nodes.push(INode {
                    structure: it.structure,
                    kind: IKind::Close {
                        prod: it.prod,
                        start: it.origin,
                        end: set,
                        tags,
                        caps: ranker.chart().caps(it.caps),
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
    /// The stage's input.
    pub tokens: &'a [Tok],
    pub tag_map: &'a dyn Fn(SetId) -> BTreeSet<String>,
    /// For a reading of the check of `elision-only`, how the reconstructed
    /// input maps to the stage's input (§7.10).
    pub reading: Option<&'a ReadingMap<'a>>,
}

/// How a reading of the reconstructed input R of `elision-only` maps to
/// the stage's input O (§7.10).
pub(crate) struct ReadingMap<'a> {
    /// π: for each position of R, the number of original tokens before it.
    pub project: &'a [u32],
    /// For each token of R, the index of its restoration record if it is
    /// synthetic.
    pub record_of: &'a [Option<u32>],
    /// The restoration records, in their order of insertion.
    pub records: &'a [Restoration],
}

impl<'a> TreeContext<'a> {
    /// A position of the derivation's input as one of the stage's input.
    fn original(&self, index: u32) -> usize {
        match self.reading {
            None => index as usize,
            Some(map) => map.project[index as usize] as usize,
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

/// Builds the result's tree (§12): helpers spliced out, a chain's levels
/// as nested rule nodes, absent elidable optionals as elided nodes.
pub(crate) fn public_tree(tree: &ITree, context: &TreeContext) -> Node {
    let originals = Sources::new(context.tokens);
    let mut fragments: Vec<Vec<Node>> = (0..tree.nodes.len()).map(|_| Vec::new()).collect();
    for index in (0..tree.nodes.len()).rev() {
        let node = &tree.nodes[index];
        let made = match node.kind {
            IKind::Read { tok, terminal } => {
                let at = context.original(tok);
                // A read of a synthetic token is an elided node of its
                // record's terminal, at the record's position, with the
                // record's source (§7.10).
                let record = context
                    .reading
                    .and_then(|map| map.record_of[tok as usize].map(|index| &map.records[index as usize]));
                vec![match record {
                    Some(record) => Node {
                        kind: NodeKind::Elided,
                        rule: None,
                        terminal: Some(record.terminal.clone()),
                        token: None,
                        span: at..at,
                        source: record.source.clone(),
                        tags: BTreeSet::new(),
                        value: record.value.clone(),
                        children: Vec::new(),
                    },
                    None => Node {
                        kind: NodeKind::Token,
                        rule: None,
                        terminal: Some(context.g.terminals[terminal as usize].clone()),
                        token: Some(at),
                        span: at..at + 1,
                        source: source_of(&originals, at, at + 1),
                        tags: BTreeSet::new(),
                        value: None,
                        children: Vec::new(),
                    },
                }]
            }
            IKind::Close { prod, start, end, tags, .. } => {
                let production = &context.g.prods[prod as usize];
                let rule = &context.g.rules[production.rule as usize];
                let mut children = Vec::new();
                for &child in &node.children {
                    let mut made = std::mem::take(&mut fragments[child as usize]);
                    if children.is_empty() {
                        // Take over a spliced helper's list rather than copy
                        // it, so that a long list costs linear time.
                        children = made;
                    } else {
                        children.append(&mut made);
                    }
                }
                let (start, end) = (context.original(start), context.original(end));
                if rule.helper {
                    match (&rule.elided, production.syms.is_empty()) {
                        // A restoration of the check gives exactly the
                        // elided node of the synthetic token it read
                        // (§7.10).
                        (Some(_), true) if !children.is_empty() => children,
                        (Some(terminal), true) => vec![Node {
                            kind: NodeKind::Elided,
                            rule: None,
                            terminal: Some(terminal.clone()),
                            token: None,
                            span: start..start,
                            source: source_of(&originals, start, start),
                            tags: BTreeSet::new(),
                            value: rule.elided_test.and_then(|id| {
                                let test = &context.g.tests[id as usize];
                                (test.op == crate::lower::TestOp::Is).then(|| test.sound.clone()).flatten()
                            }),
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
                        value: None,
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
/// right. The walk passes through the helpers that the tree splices out,
/// without counting them as nodes, and so meets the tree's nodes in the
/// tree's own order.
pub(crate) fn warnings_of(
    tree: &ITree,
    g: &Lowered,
    tokens: &[Tok],
    features: &BTreeSet<String>,
    stage: &str,
) -> Vec<Warning> {
    let sources = Sources::new(tokens);
    let mut warnings = Vec::new();
    let mut stack = vec![0u32];
    while let Some(index) = stack.pop() {
        let node = &tree.nodes[index as usize];
        let IKind::Close { prod, start, end, .. } = node.kind else {
            continue;
        };
        let production = &g.prods[prod as usize];
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
        stack.extend(node.children.iter().rev());
    }
    warnings
}

/// A token emitted for the next stage.
#[derive(Debug, Clone)]
pub(crate) struct Emitted {
    pub span: (usize, usize),
    pub source: (usize, usize),
    pub tags: SetId,
    pub value: String,
    /// What it shows to people (§5).
    pub image: String,
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
        strings: &'g crate::dom::Channels,
    },
    /// An inserted token with one tag, at a token index, in a node.
    Insert {
        tag: Option<&'g LTerm>,
        at: u32,
        node: u32,
        anchor: Option<u32>,
        strings: &'g crate::dom::Channels,
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

/// Whether a production's constituent emits ε and so does not count (§11).
fn counts_for_nothing(g: &Lowered, prod: u32) -> bool {
    g.prods[prod as usize].erased
}

/// The token that covers node `index` with the given tags (§5, §11).
#[allow(clippy::too_many_arguments)]
fn cover(
    recognizer: &Recognizer,
    tree: &ITree,
    tokens: &[Tok],
    sources: &Sources,
    forwarding: &mut Forwarding,
    index: u32,
    tags: SetId,
) -> Result<Emitted, EngineError> {
    let (start, end) = span_of(tree, index);
    let span = (start as usize, end as usize);
    let source = if start < end {
        sources.of(span.0, span.1)
    } else {
        let at = sources.empty(span.0);
        (at, at)
    };
    let (value, image) = (String::new(), String::new());
    let mut token =
        Emitted { span, source, tags, value, image, inserted_by: None, before: Vec::new(), after: Vec::new() };
    // The parts decide the attachments too, after the phoneme tags are
    // checked (§11).
    if forwarding.on {
        if let Some(from) = forwarded(recognizer.g, tree, tokens, index)? {
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
/// token, or an erased part as one piece, and nothing inside a constituent
/// that emits ε. A token with attachments among other parts, or an erased
/// part that holds one, is an error of the grammar.
fn forwarded(g: &Lowered, tree: &ITree, tokens: &[Tok], root: u32) -> Result<Option<u32>, EngineError> {
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

/// An emitted token as an attachment: the same token without its span
/// (§11), with its tags and its text as the result has them.
fn attachment(recognizer: &Recognizer, token: Emitted) -> Attachment {
    Attachment {
        text: recognizer.shared.source_text(token.source.0, token.source.1),
        value: token.value,
        image: token.image,
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
    recognizer.tag_term(term, frame, tokens, 0)
}

/// A stage's implications, as tag sets of one parse (§11), indexed by
/// each tag of their antecedents, with the closures already found.
struct Implications {
    /// Each implication's consequent.
    consequents: Vec<TagList>,
    /// The implications whose antecedent holds a tag.
    by_tag: FxMap<TagId, Vec<u32>>,
    /// The closure of each set asked about so far.
    closures: FxMap<SetId, SetId>,
}

impl Implications {
    fn new(tags: &mut Tags, implications: &[Implication]) -> Implications {
        let mut side = |names: &BTreeSet<String>| {
            let mut list: TagList = names.iter().map(|name| tags.tag(name)).collect();
            list.sort_unstable();
            list
        };
        let mut consequents = Vec::with_capacity(implications.len());
        let mut by_tag: FxMap<TagId, Vec<u32>> = FxMap::default();
        for (index, implication) in (0..).zip(implications) {
            for tag in side(&implication.antecedent) {
                by_tag.entry(tag).or_default().push(index);
            }
            consequents.push(side(&implication.consequent));
        }
        Implications { consequents, by_tag, closures: FxMap::default() }
    }

    /// A token's explicit tags with the tags of the implications, added
    /// until no tag changes (§11). Each implication fires at most once,
    /// when a tag of its antecedent first arrives, so a chain of them
    /// costs its length, not one pass of every implication for each link.
    fn implied(&mut self, tags: &mut Tags, set: SetId) -> SetId {
        if self.by_tag.is_empty() {
            return set;
        }
        if let Some(&closure) = self.closures.get(&set) {
            return closure;
        }
        let start = tags.list(set);
        let mut have: FxSet<TagId> = start.iter().copied().collect();
        let mut queue: Vec<TagId> = start.clone();
        let mut fired: FxSet<u32> = FxSet::default();
        let mut added: TagList = Vec::new();
        while let Some(tag) = queue.pop() {
            // Each tag looks only at the implications it is an antecedent
            // of, and each implication fires once. Each tag, implication
            // and consequent counts as it is examined.
            work::count(Counted::Implied, 1);
            let scanned: Vec<u32>;
            let indices = if work::mutated(Mutant::ScanImplications) {
                // Every implication, each looked at for the tag.
                scanned = (0..self.consequents.len() as u32)
                    .filter(|index| {
                        work::count(Counted::Implied, 1);
                        self.by_tag.get(&tag).is_some_and(|list| list.contains(index))
                    })
                    .collect();
                &scanned[..]
            } else {
                self.by_tag.get(&tag).map_or(&[][..], Vec::as_slice)
            };
            for &index in indices {
                work::count(Counted::Implied, 1);
                if !fired.insert(index) {
                    continue;
                }
                for &consequent in &self.consequents[index as usize] {
                    work::count(Counted::Implied, 1);
                    if have.insert(consequent) {
                        queue.push(consequent);
                        added.push(consequent);
                    }
                }
            }
        }
        let closure = if added.is_empty() {
            set
        } else {
            let mut list = start.clone();
            list.append(&mut added);
            list.sort_unstable();
            tags.set(list)
        };
        self.closures.insert(set, closure);
        closure
    }
}

/// Walks the chosen tree from the left and emits the next stage's tokens
/// (§11).
pub(crate) fn emit(recognizer: &mut Recognizer, tree: &ITree, tokens: &[Tok]) -> Result<Vec<Emitted>, EngineError> {
    let g = recognizer.g;
    let sources = Sources::new(tokens);
    // The stage's implications, as tag sets of this parse (§11).
    let mut implications = Implications::new(&mut recognizer.shared.tags, &g.implications);
    let mut out: Vec<Emitted> = Vec::new();
    let mut strings = crate::strings::Strings::new(g, tree, tokens, recognizer.shared.text);
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
                        for (item, term) in items.iter().enumerate().rev() {
                            stack.push(Work::Cover {
                                node: index,
                                owner: index,
                                term: term.as_ref(),
                                tags: *tags,
                                strings: &production.item_strings[item],
                            });
                        }
                    }
                    LEmit::Items(items) => {
                        // Exactly the items, in the order listed; nothing
                        // inside the constituent is walked but their
                        // attachments (§11).
                        let (_, end) = span_of(tree, index);
                        let child = |slot: u32| {
                            if slot == u32::MAX {
                                index
                            } else {
                                node.children[production.cap_pos[slot as usize]]
                            }
                        };
                        let mut sequence = Vec::with_capacity(items.len());
                        for (item_index, item) in items.iter().enumerate() {
                            match item {
                                LEmitItem::Cap(slot, term, before, after) => {
                                    let carrier = Work::Cover {
                                        node: child(*slot),
                                        owner: index,
                                        term: term.as_ref(),
                                        tags: if *slot == u32::MAX { *tags } else { caps[*slot as usize].tags },
                                        strings: &production.item_strings[item_index],
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
                                    sequence.push(Work::Insert {
                                        tag: tag.as_ref(),
                                        at,
                                        node: index,
                                        anchor: anchor.map(child),
                                        strings: &production.item_strings[item_index],
                                    });
                                }
                            }
                        }
                        stack.extend(sequence.into_iter().rev());
                    }
                }
            }
            Work::Cover { node, owner, term, tags, strings: channels } => {
                let tags = match term {
                    Some(term) => {
                        let IKind::Close { prod, start, end, tags, caps } = &tree.nodes[owner as usize].kind else {
                            unreachable!("an emission's constituent")
                        };
                        let frame = Frame {
                            lexical: None,
                            parent_structure: u32::MAX,
                            parent_tags: Cell::new(None),
                            structure: tree.nodes[owner as usize].structure,
                            caps: Caps::All(caps),
                            prod: *prod,
                            origin: *start,
                            end: *end,
                            tags: Cell::new(Some(*tags)),
                            project: None,
                        };
                        item_tags(recognizer, term, &frame, tokens)?
                    }
                    None => tags,
                };
                let tags = implications.implied(&mut recognizer.shared.tags, tags);
                let mut token = cover(recognizer, tree, tokens, &sources, &mut forwarding, node, tags)?;
                (token.value, token.image) = strings.item(owner, Some(node), channels)?;
                out.push(token);
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
            Work::Insert { tag, at, node, anchor, strings: channels } => {
                let (start, end) = span_of(tree, node);
                // At the source end of the token before, or at the start of
                // the constituent's source if `at` is its start.
                let source = if let Some(anchor) = anchor {
                    let (a, b) = span_of(tree, anchor);
                    if a < b {
                        sources.of(a as usize, b as usize).0
                    } else {
                        sources.empty(a as usize)
                    }
                } else if at > start {
                    tokens[at as usize - 1].source.1
                } else if start < end {
                    sources.of(start as usize, end as usize).0
                } else {
                    sources.empty(start as usize)
                };
                let IKind::Close { prod, .. } = &tree.nodes[node as usize].kind else { unreachable!("a close") };
                let owner = g.prods[*prod as usize].owner;
                let IKind::Close { prod, start, end, tags, caps } = &tree.nodes[node as usize].kind else {
                    unreachable!()
                };
                let frame = Frame {
                    lexical: None,
                    parent_structure: u32::MAX,
                    parent_tags: Cell::new(None),
                    structure: tree.nodes[node as usize].structure,
                    caps: Caps::All(caps),
                    prod: *prod,
                    origin: *start,
                    end: *end,
                    tags: Cell::new(Some(*tags)),
                    project: None,
                };
                let set = match tag {
                    Some(term) => item_tags(recognizer, term, &frame, tokens)?,
                    None => 0,
                };
                let set = implications.implied(&mut recognizer.shared.tags, set);
                // Two phoneme tags are an error here too, where an
                // implication added one (§5). An inserted token has no
                // parts: a phoneme tag gives its value and its image, or
                // both are empty.
                let (value, image) = strings.item(node, None, channels)?;
                out.push(Emitted {
                    span: (at as usize, at as usize),
                    source: (source, source),
                    tags: set,
                    value,
                    image,
                    inserted_by: Some(g.rules[owner as usize].name.clone()),
                    before: Vec::new(),
                    after: Vec::new(),
                });
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::Implications;
    use crate::grammar::Implication;
    use crate::tags::Tags;
    use crate::work::{assert_linear, assert_mutant_stops, Mutant, Work};

    /// A chain of implications, written last link first, closes a token's
    /// tags in work that grows with its length, where a pass over every
    /// implication would settle only one link each time.
    #[test]
    fn a_chain_of_implications_closes_in_one_sweep() {
        let names = |index: usize| BTreeSet::from([format!("{index}a")]);
        let mut run = |n: usize| {
            let chain: Vec<Implication> = (0..n)
                .rev()
                .map(|index| Implication { antecedent: names(index), consequent: names(index + 1) })
                .collect();
            let mut tags = Tags::new();
            let mut implications = Implications::new(&mut tags, &chain);
            let start = tags.set_of(["0a"]);
            let closure = implications.implied(&mut tags, start);
            assert_eq!(tags.list(closure).len(), n + 1);
        };
        assert_linear(Work::Implied, 100, &mut run);
        // A scan of every implication for each tag stops at the first
        // count past the budget.
        assert_mutant_stops(Work::Implied, Mutant::ScanImplications, 100, &mut run);
    }
}
