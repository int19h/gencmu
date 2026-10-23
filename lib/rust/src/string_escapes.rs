//! Escape inspection and exact source string decoding (engine §9.1).

use crate::error::Error;
use crate::result::Token;
use crate::unicode::Unicode;
use crate::unicode_names::NamesScope;

pub(crate) struct DocumentStrings<'a> {
    pub unicode: &'a Unicode,
    pub names: &'a NamesScope<'a>,
    pub position: &'a dyn Fn(usize) -> (usize, usize),
}

impl DocumentStrings<'_> {
    pub fn inspect(&self, tokens: &[Token]) -> Result<(), Error> {
        for token in tokens {
            let path = token.tags.contains("Include-Path");
            if path || token.tags.contains("String") {
                self.decode(token, path)?;
            }
        }
        Ok(())
    }

    pub fn decode(&self, token: &Token, path: bool) -> Result<String, Error> {
        let source: Vec<char> = token.text.chars().collect();
        let mut result = String::new();
        let mut literal = Vec::new();
        let flush = |result: &mut String, literal: &mut Vec<char>| {
            if path {
                result.extend(literal.iter().copied());
            } else {
                result.push_str(&self.unicode.decompose(literal));
            }
            literal.clear();
        };
        let mut index = 1;
        while index + 1 < source.len() {
            if source[index] != '‹' {
                literal.push(source[index]);
                index += 1;
                continue;
            }
            flush(&mut result, &mut literal);
            let opening = index;
            let fail = || {
                let (line, column) = (self.position)(token.source.start + opening);
                Error::grammar("an invalid or unknown string escape").at(line, column)
            };
            index += 1;
            let start = index;
            while index + 1 < source.len() && source[index] != '›' {
                if matches!(source[index], '"' | '\n' | '\r') {
                    return Err(fail());
                }
                index += 1;
            }
            if index + 1 >= source.len() || source[index] != '›' || index == start {
                return Err(fail());
            }
            let name: String = source[start..index].iter().collect();
            let value = if let Some(suffix) = name.strip_prefix("U+") {
                if !(4..=6).contains(&suffix.len()) || !suffix.bytes().all(|c| c.is_ascii_hexdigit()) {
                    return Err(fail());
                }
                u32::from_str_radix(suffix, 16).ok().and_then(char::from_u32)
            } else {
                self.names.lookup(&name, false)?
            };
            result.push(value.ok_or_else(fail)?);
            index += 1;
        }
        flush(&mut result, &mut literal);
        Ok(result)
    }
}
