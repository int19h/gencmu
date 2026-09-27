//! The one part of reading documents that is not a grammar: finding the
//! `jbogenbau` blocks of a grammar document (engine §8), and resolving the
//! paths of `%include`.

use crate::error::Error;

/// A document's grammar text: its `jbogenbau` blocks joined with a newline,
/// each character remembering its line and column in the document.
#[derive(Debug, Clone)]
pub(crate) struct GrammarText {
    pub chars: Vec<char>,
    positions: Vec<(usize, usize)>,
    end: (usize, usize),
}

impl GrammarText {
    /// The document position of the character at `index`, or of the end of
    /// the grammar text for an index past it.
    pub(crate) fn position(&self, index: usize) -> (usize, usize) {
        self.positions.get(index).copied().unwrap_or(self.end)
    }
}

/// One line of a document: its characters, its terminator, its number.
struct Line {
    chars: Vec<char>,
    terminator: Vec<char>,
    number: usize,
}

fn lines(text: &str) -> Vec<Line> {
    let mut lines = Vec::new();
    let mut chars = Vec::new();
    let mut iter = text.chars().peekable();
    let mut number = 1;
    while let Some(c) = iter.next() {
        match c {
            '\n' => {
                lines.push(Line { chars: std::mem::take(&mut chars), terminator: vec!['\n'], number });
                number += 1;
            }
            '\r' => {
                let terminator = if iter.peek() == Some(&'\n') {
                    iter.next();
                    vec!['\r', '\n']
                } else {
                    vec!['\r']
                };
                lines.push(Line { chars: std::mem::take(&mut chars), terminator, number });
                number += 1;
            }
            c => chars.push(c),
        }
    }
    if !chars.is_empty() {
        lines.push(Line { chars, terminator: Vec::new(), number });
    }
    lines
}

/// A fence line: its character, its length and its info string.
fn fence(line: &[char]) -> Option<(char, usize, String)> {
    let indent = line.iter().take_while(|&&c| c == ' ').count();
    if indent > 3 {
        return None;
    }
    let first = *line.get(indent)?;
    if first != '`' && first != '~' {
        return None;
    }
    let length = line[indent..].iter().take_while(|&&c| c == first).count();
    if length < 3 {
        return None;
    }
    let info: String = line[indent + length..].iter().collect();
    // A backtick fence's info string may not hold a backtick (CommonMark).
    if first == '`' && info.contains('`') {
        return None;
    }
    Some((first, length, info))
}

/// Extracts the grammar text of a Markdown document (engine §8). An
/// `jbogenbau` block that is never closed is an error at its opening fence.
pub(crate) fn grammar_text(document: &str) -> Result<GrammarText, Error> {
    let mut text = GrammarText { chars: Vec::new(), positions: Vec::new(), end: (1, 1) };
    let lines = lines(document);
    let mut cursor = (1, 1);
    let mut blocks = 0;
    let mut index = 0;
    while index < lines.len() {
        let Some((mark, length, info)) = fence(&lines[index].chars) else {
            index += 1;
            continue;
        };
        let grammar = info.trim() == "jbogenbau";
        let mut end = index + 1;
        while end < lines.len() {
            if let Some((closing, closing_length, rest)) = fence(&lines[end].chars) {
                if closing == mark && closing_length >= length && rest.trim().is_empty() {
                    break;
                }
            }
            end += 1;
        }
        if grammar && end == lines.len() {
            let indent = lines[index].chars.iter().take_while(|&&c| c == ' ').count();
            return Err(Error::grammar("a jbogenbau block that is never closed").at(lines[index].number, indent + 1));
        }
        if grammar {
            if blocks > 0 {
                text.chars.push('\n');
                text.positions.push(cursor);
            }
            blocks += 1;
            cursor = (lines[index].number + 1, 1);
            for (offset, line) in lines[index + 1..end].iter().enumerate() {
                for (column, &c) in line.chars.iter().enumerate() {
                    text.chars.push(c);
                    text.positions.push((line.number, column + 1));
                    cursor = (line.number, column + 2);
                }
                if index + 1 + offset + 1 < end {
                    for (extra, &c) in line.terminator.iter().enumerate() {
                        text.chars.push(c);
                        text.positions.push((line.number, line.chars.len() + 1 + extra));
                    }
                    cursor = (line.number + 1, 1);
                }
            }
        }
        index = end + 1;
    }
    text.end = cursor;
    Ok(text)
}

/// Resolves a `/`-separated path against the directory of `base`, with `.`
/// and `..` normalized; `None` if it climbs above the root.
pub(crate) fn resolve(base: &str, target: &str) -> Option<String> {
    let mut parts: Vec<&str> = base.split('/').collect();
    parts.pop();
    if target.starts_with('/') {
        parts.clear();
    }
    for part in target.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            part => parts.push(part),
        }
    }
    let parts: Vec<&str> = parts.into_iter().filter(|part| !part.is_empty() && *part != ".").collect();
    Some(parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_keep_positions() {
        let text = grammar_text("# x\n\n```jbogenbau\n%rule a\n```\n\n~~~ jbogenbau\nb\r\n c\n~~~\n").unwrap();
        let chars: String = text.chars.iter().collect();
        assert_eq!(chars, "%rule a\nb\r\n c");
        assert_eq!(text.position(0), (4, 1));
        assert_eq!(text.position(2), (4, 3));
        assert_eq!(text.position(7), (4, 8));
        assert_eq!(text.position(8), (8, 1));
        assert_eq!(text.position(11), (9, 1));
        assert_eq!(text.position(12), (9, 2));
        assert_eq!(text.position(13), (9, 3));
    }

    #[test]
    fn paths_resolve() {
        assert_eq!(resolve("dialects/cll-ebnf.md", "../phonemes/latin.md").as_deref(), Some("phonemes/latin.md"));
        assert_eq!(resolve("p.md", "g.md").as_deref(), Some("g.md"));
        assert_eq!(resolve("p.md", "../g.md"), None);
        assert_eq!(resolve("a/b/p.md", "./c/../g.md").as_deref(), Some("a/b/g.md"));
    }
}
