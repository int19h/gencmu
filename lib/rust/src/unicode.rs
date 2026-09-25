//! The character table of `grammars/unicode.txt` (engine §1): the `mark`
//! and `alpha` ranges that give a character its class, and the simple
//! lowercase mappings `lowercase()` uses. Every library reads this table
//! rather than its platform's Unicode data, so that all agree.

use std::collections::HashMap;

#[derive(Debug)]
pub(crate) struct Unicode {
    marks: Vec<(u32, u32)>,
    alphas: Vec<(u32, u32)>,
    lower: HashMap<u32, u32>,
}

fn hex(field: Option<&str>, line: usize) -> Result<u32, String> {
    let field = field.ok_or_else(|| format!("unicode.txt line {line}: a missing field"))?;
    u32::from_str_radix(field, 16).map_err(|_| format!("unicode.txt line {line}: a bad code point {field:?}"))
}

impl Unicode {
    pub(crate) fn parse(text: &str) -> Result<Unicode, String> {
        let mut table = Unicode { marks: Vec::new(), alphas: Vec::new(), lower: HashMap::new() };
        for (index, line) in text.lines().enumerate() {
            let number = index + 1;
            let mut fields = line.split_whitespace();
            match fields.next() {
                None | Some("unicode") => {}
                Some("mark") => table.marks.push((hex(fields.next(), number)?, hex(fields.next(), number)?)),
                Some("alpha") => table.alphas.push((hex(fields.next(), number)?, hex(fields.next(), number)?)),
                Some("lower") => {
                    let from = hex(fields.next(), number)?;
                    let to = hex(fields.next(), number)?;
                    table.lower.insert(from, to);
                }
                Some(other) => return Err(format!("unicode.txt line {number}: an unknown entry {other:?}")),
            }
        }
        table.marks.sort_unstable();
        table.alphas.sort_unstable();
        Ok(table)
    }

    fn within(ranges: &[(u32, u32)], code: u32) -> bool {
        let index = ranges.partition_point(|&(first, _)| first <= code);
        index > 0 && ranges[index - 1].1 >= code
    }

    /// The weak class tag of a character (engine §1).
    pub(crate) fn class(&self, c: char) -> &'static str {
        let code = c as u32;
        let space = matches!(
            code,
            0x09..=0x0D | 0x20 | 0x85 | 0xA0 | 0x1680 | 0x2000..=0x200A | 0x2028 | 0x2029 | 0x202F | 0x205F | 0x3000
        );
        if space {
            "space"
        } else if (0x30..=0x39).contains(&code) {
            "digit"
        } else if Self::within(&self.marks, code) {
            "mark"
        } else if Self::within(&self.alphas, code) {
            "alpha"
        } else {
            "other"
        }
    }

    /// The simple lowercase mapping of a string, code point by code point.
    pub(crate) fn lowercase(&self, text: &str) -> String {
        text.chars().map(|c| self.lower.get(&(c as u32)).and_then(|&to| char::from_u32(to)).unwrap_or(c)).collect()
    }
}
