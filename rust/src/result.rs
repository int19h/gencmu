//! The result of a parse (`docs/output.md`), as Rust data. A result owns
//! everything it holds, so it outlives the text and the dialect.

use std::collections::BTreeMap;
use std::fmt;
use std::ops::Range;

/// A tag set: each tag with its strength, `true` for strong and `false`
/// for weak, in code point order.
pub type Tags = BTreeMap<String, bool>;

/// A token that a stage read or emitted (engine §1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Token {
    /// The original text over [`source`](Token::source).
    pub text: String,
    /// What the token sounds like (engine §5), if anything.
    pub phonemes: Option<String>,
    pub tags: Tags,
    /// The range of the previous stage's tokens this token covers; for the
    /// first stage's input, the character's own position.
    pub span: Range<usize>,
    /// The range of the original text this token covers, in code points.
    pub source: Range<usize>,
    /// For a token an emission clause inserted, the rule whose clause it is.
    pub inserted_by: Option<String>,
}

/// What kind of node a [`Node`] is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum NodeKind {
    /// A constituent of a rule the grammar's author wrote.
    Rule,
    /// A token read as a terminal.
    Token,
    /// A terminator elided at this point (engine §12).
    Elided,
}

/// A node of a parse tree (engine §12).
///
/// Trees can be as deep as a text is long, so dropping, cloning and
/// comparing a node never recurse.
pub struct Node {
    pub kind: NodeKind,
    /// For a rule node, the rule's name.
    pub rule: Option<String>,
    /// For a token or elided node, the terminal it read or stands for.
    pub terminal: Option<String>,
    /// For a token node, the index of the stage-input token it read.
    pub token: Option<usize>,
    /// The range of the stage's input tokens the node covers.
    pub span: Range<usize>,
    /// The range of the original text the node covers, in code points.
    pub source: Range<usize>,
    /// For a rule node, its constituent's tags; empty otherwise.
    pub tags: Tags,
    /// For a rule node, its children in text order; empty otherwise.
    pub children: Vec<Node>,
}

impl Node {
    fn shallow(&self) -> Node {
        Node {
            kind: self.kind,
            rule: self.rule.clone(),
            terminal: self.terminal.clone(),
            token: self.token,
            span: self.span.clone(),
            source: self.source.clone(),
            tags: self.tags.clone(),
            children: Vec::new(),
        }
    }

    fn same_shallow(&self, other: &Node) -> bool {
        self.kind == other.kind
            && self.rule == other.rule
            && self.terminal == other.terminal
            && self.token == other.token
            && self.span == other.span
            && self.source == other.source
            && self.tags == other.tags
            && self.children.len() == other.children.len()
    }
}

impl Drop for Node {
    fn drop(&mut self) {
        let mut stack = std::mem::take(&mut self.children);
        while let Some(mut node) = stack.pop() {
            stack.append(&mut node.children);
        }
    }
}

impl Clone for Node {
    fn clone(&self) -> Node {
        // Copy each node shallowly, then attach children bottom-up.
        let mut order: Vec<(&Node, Option<usize>)> = vec![(self, None)];
        let mut copies: Vec<(Node, Option<usize>)> = Vec::new();
        let mut index = 0;
        while index < order.len() {
            let (node, parent) = order[index];
            copies.push((node.shallow(), parent));
            for child in &node.children {
                order.push((child, Some(index)));
            }
            index += 1;
        }
        while copies.len() > 1 {
            let (node, parent) = copies.pop().expect("a copy");
            let parent = parent.expect("a parent");
            copies[parent].0.children.push(node);
        }
        let (mut root, _) = copies.pop().expect("the root");
        reverse_children(&mut root);
        root
    }
}

/// Children were attached last first; put every list back in order.
fn reverse_children(root: &mut Node) {
    let mut stack: Vec<&mut Node> = vec![root];
    while let Some(node) = stack.pop() {
        node.children.reverse();
        for child in node.children.iter_mut() {
            stack.push(child);
        }
    }
}

impl PartialEq for Node {
    fn eq(&self, other: &Node) -> bool {
        let mut stack = vec![(self, other)];
        while let Some((a, b)) = stack.pop() {
            if !a.same_shallow(b) {
                return false;
            }
            stack.extend(a.children.iter().zip(b.children.iter()));
        }
        true
    }
}

impl Eq for Node {}

impl fmt::Debug for Node {
    /// Writes the node as its canonical JSON, which needs no recursion.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut out = String::new();
        crate::output::write_node(&mut out, self);
        f.write_str(&out)
    }
}

/// How a stage's ranking came out (engine §6).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Verdict {
    /// The input has one derivation.
    Unique,
    /// It has several, and one wins over all.
    Resolved,
    /// Some derivation is tied with the chosen one.
    Tie,
}

/// An action of a derivation, in a tie's witness (engine §6).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    /// A read of the stage-input token `token` as `terminal`.
    Read { token: usize, terminal: String },
    /// A close of `production`, of `rule`, over `span`.
    Close { rule: String, production: usize, span: Range<usize> },
}

/// One stage of a run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Stage {
    pub name: String,
    /// The tokens the stage read.
    pub input: Vec<Token>,
    /// The tokens it emitted, present when it accepted its input.
    pub output: Option<Vec<Token>>,
    /// How its ranking came out; `None` when it rejected its input.
    pub verdict: Option<Verdict>,
    /// For a tie, the pair of actions where the chosen and the tied
    /// derivations first differ.
    pub witness: Option<[Action; 2]>,
    /// For a tie, the tree of the derivation tied with the chosen one that
    /// diverges from it earliest.
    pub tied: Option<Node>,
}

/// Why a text did not parse.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ParseErrorKind {
    /// A stage's grammar does not accept its input.
    Rejected,
    /// The `elision-only` check failed (engine §7).
    Ambiguous,
    /// A defect of a grammar found while parsing, such as a nested parse
    /// asked about its own span.
    Grammar,
}

/// A terminal a rejected stage could have read next, with the rules whose
/// items could have read it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Expected {
    pub terminal: String,
    pub rules: Vec<String>,
}

/// The error of a result whose `ok` is false.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    pub kind: ParseErrorKind,
    /// The stage it concerns.
    pub stage: Option<String>,
    /// The stage-input token it concerns.
    pub token: Option<usize>,
    /// That token's range of the original text.
    pub source: Option<Range<usize>>,
    /// For a grammar error, the grammar document it concerns.
    pub document: Option<String>,
    /// The line of the text, or for a grammar error of the document,
    /// counting from 1.
    pub line: Option<usize>,
    /// The column, in code points counting from 1.
    pub column: Option<usize>,
    /// For a rejection, what could have been read next.
    pub expected: Vec<Expected>,
    /// For an ambiguity, the two readings.
    pub readings: Vec<Node>,
    /// The human description.
    pub message: String,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(document) = &self.document {
            write!(f, "{document}:")?;
        }
        if let (Some(line), Some(column)) = (self.line, self.column) {
            write!(f, "{line}:{column}: ")?;
        }
        if let Some(stage) = &self.stage {
            write!(f, "stage {stage}: ")?;
        }
        write!(f, "{}", self.message)
    }
}

/// The result of parsing a text (`docs/output.md`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseResult {
    /// Whether every stage run accepted its input without an error.
    pub ok: bool,
    /// The stages run, in order.
    pub stages: Vec<Stage>,
    /// The last stage's chosen tree, when `ok`.
    pub tree: Option<Node>,
    /// Why the text did not parse, when not `ok`.
    pub error: Option<ParseError>,
}
