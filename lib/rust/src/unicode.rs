//! The character table of `grammars/unicode.txt` (engine §1): the
//! General_Category of every scalar value, the White_Space property, and the
//! simple lowercase mappings `lowercase()` uses. Every library reads this
//! table rather than its platform's Unicode data, so that all agree.

use std::collections::HashMap;

/// The General_Category values in their short form (engine §1).
pub(crate) const CATEGORIES: [&str; 30] = [
    "Lu", "Ll", "Lt", "Lm", "Lo", "Mn", "Mc", "Me", "Nd", "Nl", "No", "Pc", "Pd", "Ps", "Pe", "Pi", "Pf", "Po", "Sm",
    "Sc", "Sk", "So", "Zs", "Zl", "Zp", "Cc", "Cf", "Cs", "Co", "Cn",
];

/// Whether a name is a property (engine §1): a General_Category value in its
/// short form, one of their one-letter groups, `White_Space` or `Any`.
pub(crate) fn is_property_name(name: &str) -> bool {
    Property::of(name).is_some()
}

/// A property (engine §1), resolved from its name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Property {
    Any,
    WhiteSpace,
    /// A one-letter group of General_Category values, by its letter.
    Group(u8),
    /// One General_Category value, in its short form.
    Category(&'static str),
}

impl Property {
    /// The property of a name, or `None` for a name that is not one.
    pub(crate) fn of(name: &str) -> Option<Property> {
        match name {
            "Any" => Some(Property::Any),
            "White_Space" => Some(Property::WhiteSpace),
            "L" | "M" | "N" | "P" | "S" | "Z" | "C" => Some(Property::Group(name.as_bytes()[0])),
            _ => CATEGORIES.iter().find(|&&category| category == name).map(|&category| Property::Category(category)),
        }
    }
}

#[derive(Debug)]
pub(crate) struct Unicode {
    /// The category ranges, sorted by their first code point: first, last
    /// and the category's short form.
    categories: Vec<(u32, u32, &'static str)>,
    white_space: Vec<(u32, u32)>,
    lower: HashMap<u32, u32>,
}

fn hex(field: Option<&str>, line: usize) -> Result<u32, String> {
    let field = field.ok_or_else(|| format!("unicode.txt line {line}: a missing field"))?;
    u32::from_str_radix(field, 16).map_err(|_| format!("unicode.txt line {line}: a bad code point {field:?}"))
}

impl Unicode {
    pub(crate) fn parse(text: &str) -> Result<Unicode, String> {
        let mut table = Unicode { categories: Vec::new(), white_space: Vec::new(), lower: HashMap::new() };
        for (index, line) in text.lines().enumerate() {
            let number = index + 1;
            let mut fields = line.split_whitespace();
            match fields.next() {
                None | Some("unicode") => {}
                Some("category") => {
                    let name = fields.next().unwrap_or("");
                    let Some(&category) = CATEGORIES.iter().find(|&&known| known == name) else {
                        return Err(format!("unicode.txt line {number}: an unknown category {name:?}"));
                    };
                    let first = hex(fields.next(), number)?;
                    let last = hex(fields.next(), number)?;
                    table.categories.push((first, last, category));
                }
                Some("white-space") => {
                    table.white_space.push((hex(fields.next(), number)?, hex(fields.next(), number)?))
                }
                Some("lower") => {
                    let from = hex(fields.next(), number)?;
                    let to = hex(fields.next(), number)?;
                    table.lower.insert(from, to);
                }
                Some(other) => return Err(format!("unicode.txt line {number}: an unknown entry {other:?}")),
            }
        }
        table.categories.sort_unstable();
        table.white_space.sort_unstable();
        Ok(table)
    }

    /// The General_Category of a scalar value, in its short form, found by a
    /// binary search of the category ranges. A code point that the file does
    /// not list, a surrogate, is `Cs`.
    pub(crate) fn category(&self, code: u32) -> &'static str {
        let index = self.categories.partition_point(|&(first, _, _)| first <= code);
        if index > 0 && self.categories[index - 1].1 >= code {
            self.categories[index - 1].2
        } else {
            "Cs"
        }
    }

    /// Whether a code point is a nonspacing mark, of General_Category `Mn`,
    /// which a character tag writes escaped (engine §1).
    pub(crate) fn is_mark(&self, code: u32) -> bool {
        self.category(code) == "Mn"
    }

    /// Whether a code point has the White_Space property.
    pub(crate) fn is_white_space(&self, code: u32) -> bool {
        let index = self.white_space.partition_point(|&(first, _)| first <= code);
        index > 0 && self.white_space[index - 1].1 >= code
    }

    /// Whether a scalar value has a property (engine §1).
    pub(crate) fn has(&self, property: Property, code: u32) -> bool {
        match property {
            Property::Any => true,
            Property::WhiteSpace => self.is_white_space(code),
            Property::Group(letter) => self.category(code).as_bytes()[0] == letter,
            Property::Category(category) => self.category(code) == category,
        }
    }

    /// The simple lowercase mapping of a string, code point by code point.
    pub(crate) fn lowercase(&self, text: &str) -> String {
        text.chars().map(|c| self.lower.get(&(c as u32)).and_then(|&to| char::from_u32(to)).unwrap_or(c)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table() -> Unicode {
        let text = crate::loader::bundled("unicode.txt").expect("unicode.txt");
        Unicode::parse(text).expect("the bundled table")
    }

    #[test]
    fn categories() {
        let unicode = table();
        assert_eq!(unicode.category('a' as u32), "Ll");
        assert_eq!(unicode.category('A' as u32), "Lu");
        assert_eq!(unicode.category('0' as u32), "Nd");
        assert_eq!(unicode.category(0x301), "Mn");
        assert_eq!(unicode.category(0x0), "Cc");
        assert_eq!(unicode.category(0xD800), "Cs");
        assert_eq!(unicode.category(0xE000), "Co");
        assert_eq!(unicode.category(0x10FFFF), "Cn");
        assert!(unicode.is_mark(0x301));
        assert!(!unicode.is_mark('a' as u32));
    }

    #[test]
    fn properties() {
        let unicode = table();
        let has = |name: &str, code: u32| unicode.has(Property::of(name).expect("a property"), code);
        assert!(has("L", 'a' as u32));
        assert!(has("Ll", 'a' as u32));
        assert!(!has("Lu", 'a' as u32));
        assert!(has("White_Space", 0x3000));
        assert!(!has("White_Space", 0x200B));
        assert!(has("Any", 0x10FFFF));
        assert!(is_property_name("Nd") && is_property_name("Z") && !is_property_name("lu"));
        assert!(!is_property_name("Letter") && !is_property_name("L&"));
    }
}
