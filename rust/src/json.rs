//! A small JSON reader for the files the library ships (`bootstrap.json`,
//! `compiled.json`), and the string escaping its hand-written JSON uses.
//! The standard library has neither.

use std::fmt::Write as _;

/// A parsed JSON value. Objects keep their members in document order.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Json {
    Null,
    Bool(bool),
    Int(i64),
    Str(String),
    Arr(Vec<Json>),
    Obj(Vec<(String, Json)>),
}

impl Json {
    pub(crate) fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Obj(members) => members.iter().find(|(name, _)| name == key).map(|(_, value)| value),
            _ => None,
        }
    }

    pub(crate) fn as_str(&self) -> Option<&str> {
        match self {
            Json::Str(text) => Some(text),
            _ => None,
        }
    }

    pub(crate) fn as_array(&self) -> Option<&[Json]> {
        match self {
            Json::Arr(items) => Some(items),
            _ => None,
        }
    }

    pub(crate) fn as_object(&self) -> Option<&[(String, Json)]> {
        match self {
            Json::Obj(members) => Some(members),
            _ => None,
        }
    }

    pub(crate) fn as_int(&self) -> Option<i64> {
        match self {
            Json::Int(value) => Some(*value),
            _ => None,
        }
    }

    pub(crate) fn as_bool(&self) -> Option<bool> {
        match self {
            Json::Bool(value) => Some(*value),
            _ => None,
        }
    }
}

/// How deeply arrays and objects may nest: room for a DOM nested as deep
/// as engine §9 allows (two levels a node at most, and a few around it); a
/// deeper text, corrupt or malicious, is an error rather than a structure
/// whose conversion or drop would exhaust the stack.
pub(crate) const MAX_DEPTH: usize = 1024;

/// Parses a JSON text. Numbers must be integers, which is all the shipped
/// files hold. The error is a message with the byte offset.
pub(crate) fn parse(text: &str) -> Result<Json, String> {
    let mut reader = Reader { bytes: text.as_bytes(), text, at: 0 };
    reader.space();
    let value = reader.value()?;
    reader.space();
    if reader.at != reader.bytes.len() {
        return Err(reader.error("unexpected text after the value"));
    }
    Ok(value)
}

struct Reader<'a> {
    bytes: &'a [u8],
    text: &'a str,
    at: usize,
}

enum Frame {
    Arr(Vec<Json>),
    Obj(Vec<(String, Json)>, String),
}

impl<'a> Reader<'a> {
    fn error(&self, message: &str) -> String {
        format!("{message} at byte {}", self.at)
    }

    fn space(&mut self) {
        while let Some(&byte) = self.bytes.get(self.at) {
            if matches!(byte, b' ' | b'\t' | b'\n' | b'\r') {
                self.at += 1;
            } else {
                break;
            }
        }
    }

    fn expect(&mut self, byte: u8) -> Result<(), String> {
        if self.bytes.get(self.at) == Some(&byte) {
            self.at += 1;
            Ok(())
        } else {
            Err(self.error(&format!("expected '{}'", byte as char)))
        }
    }

    /// Reads one value without recursion, so that nesting depth costs heap,
    /// not stack.
    fn value(&mut self) -> Result<Json, String> {
        let mut stack: Vec<Frame> = Vec::new();
        loop {
            self.space();
            // Read the start of a value, or a complete scalar.
            let mut value = match self.bytes.get(self.at) {
                Some(b'{') => {
                    self.at += 1;
                    self.space();
                    if self.bytes.get(self.at) == Some(&b'}') {
                        self.at += 1;
                        Json::Obj(Vec::new())
                    } else {
                        let key = self.string()?;
                        self.space();
                        self.expect(b':')?;
                        if stack.len() >= MAX_DEPTH {
                            return Err(self.error("JSON nested too deeply"));
                        }
                        stack.push(Frame::Obj(Vec::new(), key));
                        continue;
                    }
                }
                Some(b'[') => {
                    self.at += 1;
                    self.space();
                    if self.bytes.get(self.at) == Some(&b']') {
                        self.at += 1;
                        Json::Arr(Vec::new())
                    } else {
                        if stack.len() >= MAX_DEPTH {
                            return Err(self.error("JSON nested too deeply"));
                        }
                        stack.push(Frame::Arr(Vec::new()));
                        continue;
                    }
                }
                Some(b'"') => Json::Str(self.string()?),
                Some(b't') => self.word("true", Json::Bool(true))?,
                Some(b'f') => self.word("false", Json::Bool(false))?,
                Some(b'n') => self.word("null", Json::Null)?,
                Some(b'-' | b'0'..=b'9') => self.number()?,
                _ => return Err(self.error("expected a value")),
            };
            // Hand the finished value to the containers that are waiting.
            loop {
                match stack.pop() {
                    None => return Ok(value),
                    Some(Frame::Arr(mut items)) => {
                        items.push(value);
                        self.space();
                        match self.bytes.get(self.at) {
                            Some(b',') => {
                                self.at += 1;
                                stack.push(Frame::Arr(items));
                                break;
                            }
                            Some(b']') => {
                                self.at += 1;
                                value = Json::Arr(items);
                            }
                            _ => return Err(self.error("expected ',' or ']'")),
                        }
                    }
                    Some(Frame::Obj(mut members, key)) => {
                        members.push((key, value));
                        self.space();
                        match self.bytes.get(self.at) {
                            Some(b',') => {
                                self.at += 1;
                                self.space();
                                let key = self.string()?;
                                self.space();
                                self.expect(b':')?;
                                stack.push(Frame::Obj(members, key));
                                break;
                            }
                            Some(b'}') => {
                                self.at += 1;
                                value = Json::Obj(members);
                            }
                            _ => return Err(self.error("expected ',' or '}'")),
                        }
                    }
                }
            }
        }
    }

    fn word(&mut self, word: &str, value: Json) -> Result<Json, String> {
        if self.bytes[self.at..].starts_with(word.as_bytes()) {
            self.at += word.len();
            Ok(value)
        } else {
            Err(self.error("expected a value"))
        }
    }

    fn number(&mut self) -> Result<Json, String> {
        let start = self.at;
        if self.bytes.get(self.at) == Some(&b'-') {
            self.at += 1;
        }
        let digits = self.at;
        while matches!(self.bytes.get(self.at), Some(b'0'..=b'9')) {
            self.at += 1;
        }
        if self.at == digits {
            return Err(self.error("expected digits"));
        }
        if matches!(self.bytes.get(self.at), Some(b'.' | b'e' | b'E')) {
            return Err(self.error("only integers are supported"));
        }
        self.text[start..self.at].parse::<i64>().map(Json::Int).map_err(|_| self.error("an integer out of range"))
    }

    fn hex4(&mut self) -> Result<u32, String> {
        let digits = self.text.get(self.at..self.at + 4).ok_or_else(|| self.error("a short \\u escape"))?;
        let value = u32::from_str_radix(digits, 16).map_err(|_| self.error("a bad \\u escape"))?;
        self.at += 4;
        Ok(value)
    }

    fn string(&mut self) -> Result<String, String> {
        self.expect(b'"')?;
        let mut out = String::new();
        loop {
            let start = self.at;
            while let Some(&byte) = self.bytes.get(self.at) {
                if byte == b'"' || byte == b'\\' || byte < 0x20 {
                    break;
                }
                self.at += 1;
            }
            out.push_str(&self.text[start..self.at]);
            match self.bytes.get(self.at) {
                Some(b'"') => {
                    self.at += 1;
                    return Ok(out);
                }
                Some(b'\\') => {
                    self.at += 1;
                    let escape = *self.bytes.get(self.at).ok_or_else(|| self.error("an unfinished escape"))?;
                    self.at += 1;
                    match escape {
                        b'"' => out.push('"'),
                        b'\\' => out.push('\\'),
                        b'/' => out.push('/'),
                        b'b' => out.push('\u{8}'),
                        b'f' => out.push('\u{c}'),
                        b'n' => out.push('\n'),
                        b'r' => out.push('\r'),
                        b't' => out.push('\t'),
                        b'u' => {
                            let high = self.hex4()?;
                            let code = if (0xD800..0xDC00).contains(&high) {
                                if self.bytes[self.at..].starts_with(b"\\u") {
                                    self.at += 2;
                                    let low = self.hex4()?;
                                    if !(0xDC00..0xE000).contains(&low) {
                                        return Err(self.error("an unpaired surrogate"));
                                    }
                                    0x10000 + ((high - 0xD800) << 10) + (low - 0xDC00)
                                } else {
                                    return Err(self.error("an unpaired surrogate"));
                                }
                            } else {
                                high
                            };
                            out.push(char::from_u32(code).ok_or_else(|| self.error("an invalid code point"))?);
                        }
                        _ => return Err(self.error("an unknown escape")),
                    }
                }
                _ => return Err(self.error("an unterminated string")),
            }
        }
    }
}

/// Appends `text` as a JSON string: quotes, backslashes and control
/// characters escaped, everything else as itself.
pub(crate) fn write_str(out: &mut String, text: &str) {
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

/// The 64-bit FNV-1a hash of a text's UTF-8 bytes, as 16 lower-case
/// hexadecimal digits (engine §8).
pub fn fnv1a64(text: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for &byte in text.as_bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nesting_is_bounded() {
        let deep = format!("{}{}", "[".repeat(10_000), "]".repeat(10_000));
        assert!(parse(&deep).unwrap_err().contains("too deeply"));
        let deep = format!("{}1{}", "{\"a\":".repeat(10_000), "}".repeat(10_000));
        assert!(parse(&deep).is_err());
        let fine = format!("{}{}", "[".repeat(MAX_DEPTH), "]".repeat(MAX_DEPTH));
        assert!(parse(&fine).is_ok());
    }
}
