//! Tags and tag sets (engine §1): tags interned to numbers, and sets of
//! tags interned to numbers, so that items can compare them cheaply. A tag
//! is a string in its canonical spelling, and has no strength.

use std::collections::BTreeSet;

use crate::fxhash::FxMap;
use crate::unicode::Unicode;

pub(crate) type TagId = u32;
pub(crate) type SetId = u32;

/// A tag set, sorted by tag id.
pub(crate) type TagList = Vec<TagId>;

#[derive(Debug, Default)]
pub(crate) struct Tags {
    names: Vec<String>,
    /// For each tag, the scalar value of a character tag, or `u32::MAX`.
    codes: Vec<u32>,
    index: FxMap<String, TagId>,
    sets: Vec<TagList>,
    set_index: FxMap<TagList, SetId>,
}

impl Tags {
    pub(crate) fn new() -> Tags {
        let mut tags = Tags::default();
        tags.set(Vec::new());
        tags
    }

    pub(crate) fn tag(&mut self, name: &str) -> TagId {
        if let Some(&id) = self.index.get(name) {
            return id;
        }
        let id = self.names.len() as TagId;
        self.names.push(name.to_string());
        self.codes.push(code_of_character_tag(name).unwrap_or(u32::MAX));
        self.index.insert(name.to_string(), id);
        id
    }

    /// The scalar value of a character tag, or `None` for another tag.
    #[inline]
    pub(crate) fn code(&self, id: TagId) -> Option<u32> {
        Some(self.codes[id as usize]).filter(|&code| code != u32::MAX)
    }

    pub(crate) fn lookup(&self, name: &str) -> Option<TagId> {
        self.index.get(name).copied()
    }

    pub(crate) fn name(&self, id: TagId) -> &str {
        &self.names[id as usize]
    }

    /// Interns a set; the list must be sorted by tag id without repeats.
    pub(crate) fn set(&mut self, list: TagList) -> SetId {
        if let Some(&id) = self.set_index.get(&list) {
            return id;
        }
        let id = self.sets.len() as SetId;
        self.sets.push(list.clone());
        self.set_index.insert(list, id);
        id
    }

    pub(crate) fn list(&self, id: SetId) -> &TagList {
        &self.sets[id as usize]
    }

    pub(crate) fn contains(&self, set: SetId, tag: TagId) -> bool {
        self.sets[set as usize].binary_search(&tag).is_ok()
    }

    /// Builds a set from tags; a tag given twice is there once.
    pub(crate) fn set_of<'a>(&mut self, tags: impl IntoIterator<Item = &'a str>) -> SetId {
        let mut list: TagList = tags.into_iter().map(|name| self.tag(name)).collect();
        list.sort_unstable();
        list.dedup();
        self.set(list)
    }

    /// The set's tags, in code point order.
    pub(crate) fn to_set(&self, set: SetId) -> BTreeSet<String> {
        self.list(set).iter().map(|&id| self.name(id).to_string()).collect()
    }
}

/// The union of many lists, gathered into one: every tag of any. Sorting
/// once costs what the lists hold, where a fold of pairwise unions copies
/// the growing union at each list.
pub(crate) fn union_all<'l>(lists: impl IntoIterator<Item = &'l TagList>) -> TagList {
    let mut out = TagList::new();
    for list in lists {
        out.extend_from_slice(list);
    }
    out.sort_unstable();
    out.dedup();
    out
}

/// The union of two sorted lists: every tag of either.
pub(crate) fn union(left: &TagList, right: &TagList) -> TagList {
    let mut out = Vec::with_capacity(left.len() + right.len());
    let (mut i, mut j) = (0, 0);
    while i < left.len() && j < right.len() {
        match left[i].cmp(&right[j]) {
            std::cmp::Ordering::Less => {
                out.push(left[i]);
                i += 1;
            }
            std::cmp::Ordering::Greater => {
                out.push(right[j]);
                j += 1;
            }
            std::cmp::Ordering::Equal => {
                out.push(left[i]);
                i += 1;
                j += 1;
            }
        }
    }
    out.extend_from_slice(&left[i..]);
    out.extend_from_slice(&right[j..]);
    out
}

/// The intersection: the tags of both.
pub(crate) fn intersection(left: &TagList, right: &TagList) -> TagList {
    left.iter().filter(|id| right.binary_search(id).is_ok()).copied().collect()
}

/// The difference: the tags of the first that are not in the second.
pub(crate) fn difference(left: &TagList, right: &TagList) -> TagList {
    left.iter().filter(|id| right.binary_search(id).is_err()).copied().collect()
}

/// Whether every tag of the first is in the second.
pub(crate) fn is_subset(small: &TagList, large: &TagList) -> bool {
    small.iter().all(|id| large.binary_search(id).is_ok())
}

/// Whether a tag is a phoneme tag `/p/`, exactly three code points, and if
/// so its phoneme `p`; the pause, `/./`, is `.` (engine §5).
pub(crate) fn phoneme_of(tag: &str) -> Option<&str> {
    if tag.chars().count() == 3 && tag.starts_with('/') && tag.ends_with('/') {
        Some(&tag[1..tag.len() - 1])
    } else {
        None
    }
}

/// Whether a string is a name (engine §9), and so an identifier tag: an
/// ASCII letter followed by ASCII letters, digits and hyphens.
pub(crate) fn is_name(tag: &str) -> bool {
    let mut chars = tag.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic()) && chars.all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Whether a code point is written as `\u{h…}` in a character tag's
/// canonical spelling (engine §1): a control character, a nonspacing mark,
/// a private-use character, the quote or the backslash.
fn escaped_in_tag(code: u32, unicode: &Unicode) -> bool {
    matches!(code, 0..=0x1F | 0x7F..=0x9F | 0x27 | 0x5C | 0xE000..=0xF8FF | 0xF0000..=0xFFFFD | 0x10_0000..=0x10_FFFD)
        || unicode.is_mark(code)
}

/// The character tag of a character, in its canonical spelling (engine
/// §1): `'a'`, or `'\u{301}'` for a code point that is escaped.
pub(crate) fn character_tag(c: char, unicode: &Unicode) -> String {
    let code = c as u32;
    if escaped_in_tag(code, unicode) {
        format!("'\\u{{{code:X}}}'")
    } else {
        format!("'{c}'")
    }
}

/// The scalar value of a character tag, `'c'` or `'\u{h…}'`, or `None` for
/// any other tag. The tag is not checked to be in its canonical spelling:
/// every tag inside the engine is (engine §1).
pub(crate) fn code_of_character_tag(tag: &str) -> Option<u32> {
    let inner = tag.strip_prefix('\'').and_then(|rest| rest.strip_suffix('\''))?;
    if let Some(digits) = inner.strip_prefix("\\u{").and_then(|rest| rest.strip_suffix('}')) {
        return u32::from_str_radix(digits, 16).ok();
    }
    let mut chars = inner.chars();
    match (chars.next(), chars.next()) {
        (Some(c), None) => Some(c as u32),
        _ => None,
    }
}

/// The scalar value of a character tag in its canonical spelling, or
/// `None` for any other string.
pub(crate) fn character_code(tag: &str, unicode: &Unicode) -> Option<u32> {
    let inner = tag.strip_prefix('\'').and_then(|rest| rest.strip_suffix('\''))?;
    let code = match inner.strip_prefix("\\u{").and_then(|rest| rest.strip_suffix('}')) {
        Some(digits)
            if (1..=6).contains(&digits.len())
                && digits.chars().all(|c| c.is_ascii_digit() || ('A'..='F').contains(&c)) =>
        {
            u32::from_str_radix(digits, 16).ok()
        }
        _ => {
            let mut chars = inner.chars();
            match (chars.next(), chars.next()) {
                (Some(c), None) => Some(c as u32),
                _ => None,
            }
        }
    };
    code.and_then(char::from_u32).filter(|&c| character_tag(c, unicode) == tag).map(|c| c as u32)
}

/// Whether a string is a character tag in its canonical spelling.
fn is_character_tag(tag: &str, unicode: &Unicode) -> bool {
    character_code(tag, unicode).is_some()
}

/// The written form of a range, its identity as a terminal (engine §4): its
/// two ends, in their canonical spelling, joined by `..`.
pub(crate) fn range_name(start: &str, end: &str) -> String {
    format!("{start}..{end}")
}

/// The written form of a property, its identity as a terminal (engine §4).
pub(crate) fn property_name(name: &str) -> String {
    format!("'\\p{{{name}}}'")
}

/// Whether a string is a tag in its canonical spelling: a name, a phoneme
/// tag or a character tag (engine §1).
pub(crate) fn is_tag(tag: &str, unicode: &Unicode) -> bool {
    is_name(tag) || phoneme_of(tag).is_some() || is_character_tag(tag, unicode)
}
