//! The canonical JSON of a result and the bracket rendering
//! (`docs/output.md`), written by hand and without recursion.

use std::ops::Range;

use crate::json::write_str;
use crate::result::{
    Action, AmbiguityReason, Attachment, Node, NodeKind, ParseError, ParseErrorKind, ParseResult, Stage, Tags, Token,
    Verdict, Warning,
};

fn write_range(out: &mut String, range: &Range<usize>) {
    out.push('[');
    out.push_str(&range.start.to_string());
    out.push(',');
    out.push_str(&range.end.to_string());
    out.push(']');
}

/// A tag set as the list of its tags, in code point order (docs/output.md).
fn write_tags(out: &mut String, tags: &Tags) {
    out.push('[');
    for (index, name) in tags.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        write_str(out, name);
    }
    out.push(']');
}

fn write_token(out: &mut String, token: &Token) {
    write_token_fields(
        out,
        &token.text,
        token.phonemes.as_deref(),
        &token.label,
        &token.tags,
        Some(&token.span),
        &token.source,
        token.inserted_by.as_deref(),
    );
    write_attachments(out, &token.before, &token.after);
    out.push('}');
}

/// A token's members up to `insertedBy`, without the closing brace. An
/// attached token has no span (docs/output.md).
#[allow(clippy::too_many_arguments)]
fn write_token_fields(
    out: &mut String,
    text: &str,
    phonemes: Option<&str>,
    label: &str,
    tags: &Tags,
    span: Option<&Range<usize>>,
    source: &Range<usize>,
    inserted_by: Option<&str>,
) {
    out.push_str("{\"text\":");
    write_str(out, text);
    out.push_str(",\"phonemes\":");
    write_str(out, phonemes.unwrap_or(""));
    out.push_str(",\"label\":");
    write_str(out, label);
    out.push_str(",\"tags\":");
    write_tags(out, tags);
    if let Some(span) = span {
        out.push_str(",\"span\":");
        write_range(out, span);
    }
    out.push_str(",\"source\":");
    write_range(out, source);
    if let Some(rule) = inserted_by {
        out.push_str(",\"insertedBy\":");
        write_str(out, rule);
    }
}

/// A token's `before` and `after`, each present only when it is not empty
/// (docs/output.md). Attachments nest as deep as a text is long, so the
/// writer keeps its own stack.
fn write_attachments(out: &mut String, before: &[Attachment], after: &[Attachment]) {
    enum Write<'a> {
        Lists(&'a [Attachment], &'a [Attachment]),
        Token(&'a Attachment),
        Text(&'static str),
    }
    let mut stack = vec![Write::Lists(before, after)];
    while let Some(work) = stack.pop() {
        match work {
            Write::Text(text) => out.push_str(text),
            Write::Token(attachment) => {
                write_token_fields(
                    out,
                    &attachment.text,
                    attachment.phonemes.as_deref(),
                    &attachment.label,
                    &attachment.tags,
                    None,
                    &attachment.source,
                    attachment.inserted_by.as_deref(),
                );
                stack.push(Write::Text("}"));
                stack.push(Write::Lists(&attachment.before, &attachment.after));
            }
            Write::Lists(before, after) => {
                // Pushed last first: `before` is written first.
                for (key, list) in [(",\"after\":[", after), (",\"before\":[", before)] {
                    if list.is_empty() {
                        continue;
                    }
                    stack.push(Write::Text("]"));
                    for (index, attachment) in list.iter().enumerate().rev() {
                        stack.push(Write::Token(attachment));
                        if index > 0 {
                            stack.push(Write::Text(","));
                        }
                    }
                    stack.push(Write::Text(key));
                }
            }
        }
    }
}

/// Writes an attachment as canonical JSON: a token without a span.
pub(crate) fn write_attachment(out: &mut String, attachment: &Attachment) {
    write_token_fields(
        out,
        &attachment.text,
        attachment.phonemes.as_deref(),
        &attachment.label,
        &attachment.tags,
        None,
        &attachment.source,
        attachment.inserted_by.as_deref(),
    );
    write_attachments(out, &attachment.before, &attachment.after);
    out.push('}');
}

enum Work<'a> {
    Node(&'a Node),
    Text(&'static str),
}

/// Writes a node as canonical JSON.
pub(crate) fn write_node(out: &mut String, root: &Node) {
    let mut stack = vec![Work::Node(root)];
    while let Some(work) = stack.pop() {
        let node = match work {
            Work::Text(text) => {
                out.push_str(text);
                continue;
            }
            Work::Node(node) => node,
        };
        match node.kind {
            NodeKind::Rule => {
                out.push_str("{\"kind\":\"rule\",\"rule\":");
                write_str(out, node.rule.as_deref().unwrap_or(""));
                out.push_str(",\"span\":");
                write_range(out, &node.span);
                out.push_str(",\"source\":");
                write_range(out, &node.source);
                out.push_str(",\"tags\":");
                write_tags(out, &node.tags);
                out.push_str(",\"children\":[");
                stack.push(Work::Text("]}"));
                for (index, child) in node.children.iter().enumerate().rev() {
                    stack.push(Work::Node(child));
                    if index > 0 {
                        stack.push(Work::Text(","));
                    }
                }
            }
            NodeKind::Token => {
                out.push_str("{\"kind\":\"token\",\"terminal\":");
                write_str(out, node.terminal.as_deref().unwrap_or(""));
                out.push_str(",\"token\":");
                out.push_str(&node.token.unwrap_or(0).to_string());
                out.push_str(",\"span\":");
                write_range(out, &node.span);
                out.push_str(",\"source\":");
                write_range(out, &node.source);
                out.push('}');
            }
            NodeKind::Elided => {
                out.push_str("{\"kind\":\"elided\",\"terminal\":");
                write_str(out, node.terminal.as_deref().unwrap_or(""));
                out.push_str(",\"span\":");
                write_range(out, &node.span);
                out.push_str(",\"source\":");
                write_range(out, &node.source);
                out.push('}');
            }
        }
    }
}

fn write_action(out: &mut String, action: &Action) {
    match action {
        Action::Read { token, terminal } => {
            out.push_str("{\"read\":{\"token\":");
            out.push_str(&token.to_string());
            out.push_str(",\"terminal\":");
            write_str(out, terminal);
            out.push_str("}}");
        }
        Action::Close { rule, production, span } => {
            out.push_str("{\"close\":{\"rule\":");
            write_str(out, rule);
            out.push_str(",\"production\":");
            out.push_str(&production.to_string());
            out.push_str(",\"span\":");
            write_range(out, span);
            out.push_str("}}");
        }
    }
}

fn write_stage(out: &mut String, stage: &Stage) {
    out.push_str("{\"name\":");
    write_str(out, &stage.name);
    out.push_str(",\"verdict\":");
    out.push_str(match stage.verdict {
        None => "null",
        Some(Verdict::Unique) => "\"unique\"",
        Some(Verdict::Resolved) => "\"resolved\"",
        Some(Verdict::Tie) => "\"tie\"",
    });
    if let Some([first, second]) = &stage.witness {
        out.push_str(",\"witness\":[");
        write_action(out, first);
        out.push(',');
        write_action(out, second);
        out.push(']');
    }
    if let Some(output) = &stage.output {
        out.push_str(",\"output\":[");
        for (index, token) in output.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            write_token(out, token);
        }
        out.push(']');
    }
    out.push('}');
}

fn write_error(out: &mut String, error: &ParseError) {
    out.push_str("{\"kind\":");
    out.push_str(match error.kind {
        ParseErrorKind::Rejected => "\"rejected\"",
        ParseErrorKind::Ambiguous => "\"ambiguous\"",
        ParseErrorKind::Grammar => "\"grammar\"",
    });
    if let Some(stage) = &error.stage {
        out.push_str(",\"stage\":");
        write_str(out, stage);
    }
    if let Some(reason) = error.reason {
        out.push_str(",\"reason\":");
        out.push_str(match reason {
            AmbiguityReason::Tie => "\"tie\"",
            AmbiguityReason::ElisionOnly => "\"elision-only\"",
        });
    }
    if let Some(token) = error.token {
        out.push_str(",\"token\":");
        out.push_str(&token.to_string());
    }
    if let Some(source) = &error.source {
        out.push_str(",\"source\":");
        write_range(out, source);
    }
    if let Some(document) = &error.document {
        out.push_str(",\"document\":");
        write_str(out, document);
    }
    if let Some(line) = error.line {
        out.push_str(",\"line\":");
        out.push_str(&line.to_string());
    }
    if let Some(column) = error.column {
        out.push_str(",\"column\":");
        out.push_str(&column.to_string());
    }
    match error.kind {
        ParseErrorKind::Rejected => {
            out.push_str(",\"expected\":[");
            for (index, expected) in error.expected.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                out.push_str("{\"terminal\":");
                write_str(out, &expected.terminal);
                out.push_str(",\"rules\":[");
                for (index, rule) in expected.rules.iter().enumerate() {
                    if index > 0 {
                        out.push(',');
                    }
                    write_str(out, rule);
                }
                out.push_str("]}");
            }
            out.push(']');
        }
        ParseErrorKind::Ambiguous => {
            out.push_str(",\"readings\":[");
            for (index, reading) in error.readings.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_node(out, reading);
            }
            out.push(']');
        }
        ParseErrorKind::Grammar => {}
    }
    out.push_str(",\"message\":");
    write_str(out, &error.message);
    out.push('}');
}

fn write_warning(out: &mut String, warning: &Warning) {
    out.push_str("{\"stage\":");
    write_str(out, &warning.stage);
    out.push_str(",\"feature\":");
    write_str(out, &warning.feature);
    out.push_str(",\"rule\":");
    write_str(out, &warning.rule);
    out.push_str(",\"span\":");
    write_range(out, &warning.span);
    out.push_str(",\"source\":");
    write_range(out, &warning.source);
    out.push('}');
}

/// Writes a result as the canonical JSON of `docs/output.md`: keys in the
/// documented order, no whitespace, non-ASCII characters as themselves.
pub fn to_json(result: &ParseResult) -> String {
    let mut out = String::new();
    out.push_str("{\"format\":7,\"ok\":");
    out.push_str(if result.ok { "true" } else { "false" });
    out.push_str(",\"stages\":[");
    for (index, stage) in result.stages.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        write_stage(&mut out, stage);
    }
    out.push_str("],\"tree\":");
    match &result.tree {
        Some(tree) => write_node(&mut out, tree),
        None => out.push_str("null"),
    }
    out.push_str(",\"error\":");
    match &result.error {
        Some(error) => write_error(&mut out, error),
        None => out.push_str("null"),
    }
    // Present only when there is at least one.
    if !result.warnings.is_empty() {
        out.push_str(",\"warnings\":[");
        for (index, warning) in result.warnings.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            write_warning(&mut out, warning);
        }
        out.push(']');
    }
    out.push('}');
    out
}

/// Writes a node as canonical JSON (`docs/output.md`, "Node").
pub fn node_to_json(node: &Node) -> String {
    let mut out = String::new();
    write_node(&mut out, node);
    out
}

/// A rendered node: empty, a label, or a group of rendered members.
enum Rendered {
    Empty,
    Leaf(String),
    Group(Vec<usize>),
}

/// Renders a tree as brackets (`docs/output.md`, "Brackets"), showing each
/// token node by the label of its token in `tokens`, the input of the
/// tree's stage.
pub(crate) fn brackets(tree: &Node, tokens: &[Token], show_elided: bool) -> String {
    // Bottom-up: render every node into an arena, collapsing as we go.
    let mut order: Vec<(&Node, Option<usize>)> = vec![(tree, None)];
    let mut index = 0;
    while index < order.len() {
        let node = order[index].0;
        for child in &node.children {
            order.push((child, Some(index)));
        }
        index += 1;
    }
    let mut arena: Vec<Rendered> = Vec::with_capacity(order.len());
    let mut members: Vec<Vec<usize>> = vec![Vec::new(); order.len()];
    for _ in 0..order.len() {
        arena.push(Rendered::Empty);
    }
    for index in (0..order.len()).rev() {
        let (node, parent) = order[index];
        let rendered = match node.kind {
            NodeKind::Token => {
                let token = node.token.and_then(|token| tokens.get(token));
                // Every rendering shows a token by its label
                // (docs/output.md).
                let label = token.map_or_else(String::new, |token| token.label.clone());
                // A token is never an empty node, even when its label is
                // empty, as an empty zoi quotation's is. A token with
                // attachments is a group of its before-attachments, its
                // label and its after-attachments.
                match token {
                    Some(token) if !token.before.is_empty() || !token.after.is_empty() => {
                        attached_group(&mut arena, &token.before, label, &token.after)
                    }
                    _ => Rendered::Leaf(label),
                }
            }
            NodeKind::Elided => {
                if show_elided {
                    Rendered::Leaf(format!("⟨{}⟩", node.terminal.as_deref().unwrap_or("").to_lowercase()))
                } else {
                    Rendered::Empty
                }
            }
            NodeKind::Rule => {
                let mut kept = std::mem::take(&mut members[index]);
                kept.reverse();
                match kept.len() {
                    0 => Rendered::Empty,
                    1 => {
                        let only = kept[0];
                        std::mem::replace(&mut arena[only], Rendered::Empty)
                    }
                    _ => Rendered::Group(kept),
                }
            }
        };
        let empty = matches!(rendered, Rendered::Empty);
        arena[index] = rendered;
        if let Some(parent) = parent {
            if !empty {
                members[parent].push(index);
            }
        }
    }
    // Top-down: write groups with brackets by depth.
    enum Write {
        Node(usize, usize),
        Text(&'static str),
    }
    let mut out = String::new();
    let mut stack = vec![Write::Node(0, 0)];
    while let Some(work) = stack.pop() {
        match work {
            Write::Text(text) => out.push_str(text),
            Write::Node(index, depth) => match &arena[index] {
                Rendered::Empty => {}
                Rendered::Leaf(label) => out.push_str(label),
                Rendered::Group(items) => {
                    let (open, close) = match depth % 3 {
                        0 => ("(", ")"),
                        1 => ("[", "]"),
                        _ => ("{", "}"),
                    };
                    out.push_str(open);
                    stack.push(Write::Text(close));
                    for (position, &item) in items.iter().enumerate().rev() {
                        stack.push(Write::Node(item, depth + 1));
                        if position > 0 {
                            stack.push(Write::Text(" "));
                        }
                    }
                }
            },
        }
    }
    out
}

/// A token with attachments as a bracket group (docs/output.md): its
/// before-attachments, its label and its after-attachments, each rendered
/// the same way. The members go at the end of the arena, so they are
/// never taken for nodes of the tree. Attachments nest as deep as a text
/// is long, so each group is made once its members are, from a stack.
fn attached_group(arena: &mut Vec<Rendered>, before: &[Attachment], label: String, after: &[Attachment]) -> Rendered {
    enum Step<'a> {
        Enter(&'a Attachment),
        Leave(&'a Attachment),
    }
    // A group of members: the attachments' renderings, which are the last
    // made, in order, with the label among them.
    let group = |arena: &mut Vec<Rendered>, done: &mut Vec<usize>, count: usize, at: usize, label: String| {
        let mut members = done.split_off(done.len() - count);
        arena.push(Rendered::Leaf(label));
        members.insert(at, arena.len() - 1);
        Rendered::Group(members)
    };
    let mut done: Vec<usize> = Vec::new();
    let mut steps: Vec<Step> = before.iter().chain(after).rev().map(Step::Enter).collect();
    while let Some(step) = steps.pop() {
        let rendered = match step {
            Step::Enter(attachment) if attachment.before.is_empty() && attachment.after.is_empty() => {
                Rendered::Leaf(attachment.label.clone())
            }
            Step::Enter(attachment) => {
                steps.push(Step::Leave(attachment));
                steps.extend(attachment.before.iter().chain(&attachment.after).rev().map(Step::Enter));
                continue;
            }
            Step::Leave(attachment) => {
                let count = attachment.before.len() + attachment.after.len();
                group(arena, &mut done, count, attachment.before.len(), attachment.label.clone())
            }
        };
        arena.push(rendered);
        done.push(arena.len() - 1);
    }
    let count = done.len();
    group(arena, &mut done, count, before.len(), label)
}

/// Renders a result's tree as brackets (`docs/output.md`), with elided
/// terminators shown as `⟨ku⟩` or hidden; empty when there is no tree.
pub fn to_brackets(result: &ParseResult, show_elided: bool) -> String {
    match (&result.tree, result.stages.last()) {
        (Some(tree), Some(stage)) => brackets(tree, &stage.input, show_elided),
        _ => String::new(),
    }
}
