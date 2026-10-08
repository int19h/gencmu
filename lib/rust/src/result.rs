//! The result of a parse (`docs/output.md`), as Rust data. A result owns
//! everything it holds, so it outlives the text and the dialect.

use std::collections::BTreeSet;
use std::fmt;
use std::ops::Range;

/// A tag set: each tag in its canonical spelling (engine §1), in code
/// point order.
pub type Tags = BTreeSet<String>;

/// A token that a stage read or emitted (engine §1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Token {
    /// The original text over [`source`](Token::source).
    pub text: String,
    /// What the token sounds like (engine §5), if anything.
    pub phonemes: Option<String>,
    /// What the token shows to people (engine §5): for a character token
    /// or one that a caller supplies, its text.
    pub label: String,
    /// The token's tags.
    pub tags: Tags,
    /// The range of the previous stage's tokens this token covers; for the
    /// first stage's input, the character's own position.
    pub span: Range<usize>,
    /// The range of the original text this token covers, in code points.
    pub source: Range<usize>,
    /// For a token an emission clause inserted, the rule whose clause it is.
    pub inserted_by: Option<String>,
    /// The tokens attached before this one (engine §11), which no later
    /// stage reads. Empty unless an emission gave the token attachments.
    pub before: Vec<Attachment>,
    /// The tokens attached after this one (engine §11).
    pub after: Vec<Attachment>,
}

/// A token attached to another (engine §11). It is a token without a span,
/// since its span would count the input of the stage that attached it.
///
/// Attachments can nest as deep as a text is long, so dropping, cloning,
/// comparing and showing one never recurse.
pub struct Attachment {
    /// The original text over [`source`](Attachment::source).
    pub text: String,
    /// What the token sounds like (engine §5), if anything.
    pub phonemes: Option<String>,
    /// What the token shows to people (engine §5).
    pub label: String,
    /// The token's tags.
    pub tags: Tags,
    /// The range of the original text this token covers, in code points.
    pub source: Range<usize>,
    /// For a token an emission clause inserted, the rule whose clause it is.
    pub inserted_by: Option<String>,
    /// The tokens attached before this one.
    pub before: Vec<Attachment>,
    /// The tokens attached after this one.
    pub after: Vec<Attachment>,
}

impl Attachment {
    fn shallow(&self) -> Attachment {
        Attachment {
            text: self.text.clone(),
            phonemes: self.phonemes.clone(),
            label: self.label.clone(),
            tags: self.tags.clone(),
            source: self.source.clone(),
            inserted_by: self.inserted_by.clone(),
            before: Vec::new(),
            after: Vec::new(),
        }
    }

    fn same_shallow(&self, other: &Attachment) -> bool {
        self.text == other.text
            && self.phonemes == other.phonemes
            && self.label == other.label
            && self.tags == other.tags
            && self.source == other.source
            && self.inserted_by == other.inserted_by
            && self.before.len() == other.before.len()
            && self.after.len() == other.after.len()
    }
}

impl Drop for Attachment {
    fn drop(&mut self) {
        let mut stack = std::mem::take(&mut self.before);
        stack.append(&mut self.after);
        while let Some(mut attachment) = stack.pop() {
            stack.append(&mut attachment.before);
            stack.append(&mut attachment.after);
        }
    }
}

impl Clone for Attachment {
    fn clone(&self) -> Attachment {
        // Copy each attachment once its own attachments are copied: a
        // copy's attachments are the last copies made, in order.
        enum Step<'a> {
            Enter(&'a Attachment),
            Leave(&'a Attachment),
        }
        let mut steps = vec![Step::Enter(self)];
        let mut copies: Vec<Attachment> = Vec::new();
        while let Some(step) = steps.pop() {
            match step {
                Step::Enter(attachment) => {
                    steps.push(Step::Leave(attachment));
                    steps.extend(attachment.before.iter().chain(&attachment.after).rev().map(Step::Enter));
                }
                Step::Leave(attachment) => {
                    let mut copy = attachment.shallow();
                    copy.after = copies.split_off(copies.len() - attachment.after.len());
                    copy.before = copies.split_off(copies.len() - attachment.before.len());
                    copies.push(copy);
                }
            }
        }
        copies.pop().expect("the copy")
    }
}

impl PartialEq for Attachment {
    fn eq(&self, other: &Attachment) -> bool {
        let mut stack = vec![(self, other)];
        while let Some((a, b)) = stack.pop() {
            if !a.same_shallow(b) {
                return false;
            }
            stack.extend(a.before.iter().zip(&b.before).chain(a.after.iter().zip(&b.after)));
        }
        true
    }
}

impl Eq for Attachment {}

impl fmt::Debug for Attachment {
    /// Writes the attachment as its canonical JSON, which needs no
    /// recursion.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut out = String::new();
        crate::output::write_attachment(&mut out, self);
        f.write_str(&out)
    }
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
    /// What kind of node this is.
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
    /// It has several, and exactly one of them is best.
    Resolved,
    /// Two or more derivations are best. A tie is an error: the stage has
    /// no chosen tree and no output (engine §6).
    Tie,
}

/// An action of a derivation, in a tie's witness (engine §6) or in that of
/// an error of `elision-only` (engine §7.10).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    /// A read of a token as a terminal.
    Read {
        /// The index of the stage-input token read.
        token: usize,
        /// The terminal it was read as.
        terminal: String,
    },
    /// A close of a production over a span.
    Close {
        /// The rule the production belongs to; for one lowering made up,
        /// the rule whose alternative it came from.
        rule: String,
        /// The production's number (engine §3), counting from 0.
        production: usize,
        /// The range of the stage's input tokens it covers.
        span: Range<usize>,
    },
    /// In the witness of an error of `elision-only`, a read of a terminator
    /// that the check wrote back (engine §7.10).
    Elided {
        /// The position in the stage's input where it was written back.
        at: usize,
        /// The terminal it was read as.
        terminal: String,
    },
}

/// One stage of a run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Stage {
    /// The stage's name in its pipeline.
    pub name: String,
    /// The tokens the stage read.
    pub input: Vec<Token>,
    /// The tokens it emitted, present when its verdict is unique or
    /// resolved and its emission did not fail. A tied stage emits nothing.
    pub output: Option<Vec<Token>>,
    /// How its ranking came out; `None` when it rejected its input.
    pub verdict: Option<Verdict>,
    /// For a tie, the pair of actions where the first and the second
    /// reading first differ, the first reading's action first. The readings
    /// themselves are in the result's error.
    pub witness: Option<[Action; 2]>,
}

/// Why a text did not parse.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ParseErrorKind {
    /// A stage's grammar does not accept its input.
    Rejected,
    /// A stage has two or more best readings, or the `elision-only` check
    /// failed; the error's `reason` says which (engine §6, §7).
    Ambiguous,
    /// A defect of a grammar found while parsing, such as a nested parse
    /// asked about its own span, or a classifier's entry that adds a class
    /// twice under the features of the parse.
    Grammar,
}

/// Why an error of kind `Ambiguous` is one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AmbiguityReason {
    /// The ranking of the stage has two or more best derivations (engine
    /// §6). The stage's verdict is a tie, and it has no output.
    Tie,
    /// The stage chose one derivation, but its text stays ambiguous with
    /// its elided terminators written back (engine §7). The stage keeps its
    /// output.
    ElisionOnly,
}

/// What a defect that the library found in itself is (engine §7.9). Only
/// an error of kind `Grammar` can have one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ErrorCode {
    /// The check of `elision-only` lost the chosen derivation: the text with
    /// its elided terminators written back had no reading at all. It is a
    /// defect of the library, not of the text or the grammar.
    ElisionWitnessLost,
}

/// A terminator that the check of `elision-only` wrote back (engine §7.2,
/// §7.9).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Restoration {
    /// The terminal.
    pub terminal: String,
    /// Its position in the stage's input.
    pub at: usize,
    /// The empty source of its elided node.
    pub source: Range<usize>,
    /// The string of the terminator's `=` test, its saved sound; `None`
    /// for a terminator with no such test.
    pub sound: Option<String>,
}

/// A terminal a rejected stage could have read next, with the rules whose
/// items could have read it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Expected {
    /// The terminal.
    pub terminal: String,
    /// The rules whose items could have read it, in code point order.
    pub rules: Vec<String>,
}

/// The error of a result whose `ok` is false.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    /// Why the text did not parse.
    pub kind: ParseErrorKind,
    /// The stage it concerns.
    pub stage: Option<String>,
    /// For a defect that the library found in itself, what it is (engine
    /// §7.9); `None` for every other error.
    pub code: Option<ErrorCode>,
    /// For an ambiguity, why it is one.
    pub reason: Option<AmbiguityReason>,
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
    /// The canonical readings of an ambiguity, including every cycle vertex.
    /// A reconstruction cycle also includes the chosen derivation at index zero.
    pub readings: Vec<Node>,
    /// For an error of `elision-only`, the pair of actions where its two
    /// readings first differ, over the stage's input (engine §7.10). A
    /// tie's witness is its stage's.
    pub witness: Option<[Action; 2]>,
    /// The human description.
    pub message: String,
    /// For `ErrorCode::ElisionWitnessLost`, the stage's chosen tree.
    pub chosen: Option<Node>,
    /// For `ErrorCode::ElisionWitnessLost`, the terminators that the check
    /// wrote back, in their order of insertion; empty for any other error.
    pub completion: Vec<Restoration>,
    /// The directed cycle of complete readings, if one exists.
    pub cycle: Vec<CycleEdge>,
    /// Opposed preference contests in an ordinary two-reading tie.
    pub conflict: Option<PreferenceConflict>,
    /// The chosen reading's index for a reconstructed cycle.
    pub chosen_reading: Option<usize>,
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

/// A warning (engine §12): a rule node of a stage's chosen tree, built from
/// an alternative with a warning `f!` while the feature `f` was on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Warning {
    /// The stage whose chosen tree has the node.
    pub stage: String,
    /// The warning's feature, the `f` of `f!`.
    pub feature: String,
    /// The node's rule.
    pub rule: String,
    /// The range of the stage's input tokens the node covers.
    pub span: Range<usize>,
    /// The range of the original text the node covers, in code points.
    pub source: Range<usize>,
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
    /// The warnings of every stage run, in stage order, whether or not the
    /// result is `ok`; empty when there are none.
    pub warnings: Vec<Warning>,
}

/// One same-span preference contest after cancellation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreferenceContest {
    /// The original input span.
    pub span: Range<usize>,
    /// The higher rule.
    pub higher: String,
    /// The lower rule.
    pub lower: String,
    /// The shortest preference path, with code point ties.
    pub path: Vec<String>,
    /// The exact positive residual occurrence counts.
    pub residual_counts: [String; 2],
}
/// Opposed preference contests between two complete readings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreferenceConflict {
    /// Contests that favor the first reading.
    pub forward: Vec<PreferenceContest>,
    /// Contests that favor the second reading.
    pub reverse: Vec<PreferenceContest>,
}
/// Why one complete reading defeats another on a cycle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PreferenceReason {
    /// Every preference contest favors the first reading.
    Prefer {
        /// The same-span contests.
        contests: Vec<PreferenceContest>,
    },
    /// The stage directive decides a pair without preference contests.
    Stage {
        /// The stage directive.
        directive: String,
        /// The first differing boundary under late elision.
        boundary: Option<usize>,
        /// The exact elision counts at that boundary.
        counts: Option<[String; 2]>,
        /// The first differing actions under lazy or greedy ranking.
        witness: Option<[Option<Action>; 2]>,
    },
}
/// One directed edge of a complete-reading cycle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CycleEdge {
    /// The winning reading's index.
    pub from: usize,
    /// The losing reading's index.
    pub to: usize,
    /// The reason for the edge.
    pub reason: PreferenceReason,
}
