//! The character table of `grammars/unicode.txt` (engine §1): the
//! category, whitespace, decomposition and combining-class properties. Every library reads this
//! table rather than its platform's Unicode data.

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
    EmojiPresentation,
    EmojiComponent,
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
            "Emoji_Presentation" => Some(Property::EmojiPresentation),
            "Emoji_Component" => Some(Property::EmojiComponent),
            "L" | "M" | "N" | "P" | "S" | "Z" | "C" => Some(Property::Group(name.as_bytes()[0])),
            _ => CATEGORIES.iter().find(|&&category| category == name).map(|&category| Property::Category(category)),
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct Unicode {
    /// The category ranges, sorted by their first code point: first, last
    /// and the category's short form.
    categories: Vec<(u32, u32, &'static str)>,
    white_space: Vec<(u32, u32)>,
    emoji_presentation: Vec<(u32, u32)>,
    emoji_component: Vec<(u32, u32)>,
    decompositions: Vec<(u32, Vec<char>)>,
    combining: Vec<(u32, u32, u8)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Decomposed {
    pub character: char,
    pub origin: usize,
    klass: u8,
}

fn hex(field: Option<&str>, line: usize) -> Result<u32, String> {
    let field = field.ok_or_else(|| format!("unicode.txt line {line}: a missing field"))?;
    u32::from_str_radix(field, 16).map_err(|_| format!("unicode.txt line {line}: a bad code point {field:?}"))
}

impl Unicode {
    pub(crate) fn parse(text: &str) -> Result<Unicode, String> {
        let mut table = Unicode {
            categories: Vec::new(),
            white_space: Vec::new(),
            emoji_presentation: Vec::new(),
            emoji_component: Vec::new(),
            decompositions: Vec::new(),
            combining: Vec::new(),
        };
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
                Some("emoji-presentation") => {
                    table.emoji_presentation.push((hex(fields.next(), number)?, hex(fields.next(), number)?))
                }
                Some("emoji-component") => {
                    table.emoji_component.push((hex(fields.next(), number)?, hex(fields.next(), number)?))
                }
                Some("decompose") => {
                    let code = hex(fields.next(), number)?;
                    let scalars = fields
                        .map(|field| {
                            let code = hex(Some(field), number)?;
                            char::from_u32(code).ok_or_else(|| format!("unicode.txt line {number}: an invalid scalar"))
                        })
                        .collect::<Result<Vec<_>, String>>()?;
                    table.decompositions.push((code, scalars));
                }
                Some("combining") => {
                    let klass = fields
                        .next()
                        .unwrap_or("")
                        .parse::<u8>()
                        .map_err(|_| format!("unicode.txt line {number}: a bad combining class"))?;
                    table.combining.push((hex(fields.next(), number)?, hex(fields.next(), number)?, klass));
                }
                Some(other) => return Err(format!("unicode.txt line {number}: an unknown entry {other:?}")),
            }
        }
        table.categories.sort_unstable();
        table.white_space.sort_unstable();
        table.emoji_presentation.sort_unstable();
        table.emoji_component.sort_unstable();
        table.decompositions.sort_unstable_by_key(|entry| entry.0);
        table.combining.sort_unstable();
        Ok(table)
    }

    pub(crate) fn combining_class(&self, code: u32) -> u8 {
        let index = self.combining.partition_point(|&(first, _, _)| first <= code);
        if index > 0 && self.combining[index - 1].1 >= code {
            self.combining[index - 1].2
        } else {
            0
        }
    }

    /// Whether writing this scalar literally can change a grammar string.
    pub(crate) fn changes_in_document(&self, code: u32) -> bool {
        (0xAC00..=0xD7A3).contains(&code)
            || self.decompositions.binary_search_by_key(&code, |entry| entry.0).is_ok()
            || self.combining_class(code) != 0
    }

    /// Canonical decomposition, with original scalar indices kept through
    /// stable ordering of each run of nonzero combining classes.
    pub(crate) fn decompose_with_origins(&self, text: &[char]) -> Vec<Decomposed> {
        crate::work::count(crate::work::Work::Decompositions, 1);
        let mut result = Vec::with_capacity(text.len());
        for (origin, &character) in text.iter().enumerate() {
            let code = character as u32;
            let mut push = |character| {
                result.push(Decomposed { character, origin, klass: self.combining_class(character as u32) })
            };
            if (0xAC00..=0xD7A3).contains(&code) {
                let syllable = code - 0xAC00;
                push(char::from_u32(0x1100 + syllable / 588).unwrap());
                push(char::from_u32(0x1161 + (syllable % 588) / 28).unwrap());
                if syllable % 28 != 0 {
                    push(char::from_u32(0x11A7 + syllable % 28).unwrap());
                }
            } else if let Ok(index) = self.decompositions.binary_search_by_key(&code, |entry| entry.0) {
                for &scalar in &self.decompositions[index].1 {
                    push(scalar);
                }
            } else {
                push(character);
            }
        }
        let mut start = 0;
        while start < result.len() {
            if result[start].klass == 0 {
                start += 1;
                continue;
            }
            let end = start + result[start..].iter().take_while(|scalar| scalar.klass != 0).count();
            result[start..end].sort_by_key(|scalar| scalar.klass);
            start = end;
        }
        result
    }

    pub(crate) fn decompose(&self, text: &[char]) -> String {
        self.decompose_with_origins(text).iter().map(|scalar| scalar.character).collect()
    }

    /// The General_Category of a code point, in its short form, found by a
    /// binary search of the category ranges (engine §1). A surrogate, which
    /// a table does not list, is `Cs`. Any other code point that the table
    /// omits is `Cn`.
    pub(crate) fn category(&self, code: u32) -> &'static str {
        if (0xD800..=0xDFFF).contains(&code) {
            return "Cs";
        }
        let index = self.categories.partition_point(|&(first, _, _)| first <= code);
        if index > 0 && self.categories[index - 1].1 >= code {
            self.categories[index - 1].2
        } else {
            "Cn"
        }
    }

    fn in_ranges(ranges: &[(u32, u32)], code: u32) -> bool {
        let index = ranges.partition_point(|&(first, _)| first <= code);
        index > 0 && ranges[index - 1].1 >= code
    }

    pub(crate) fn is_emoji_name(&self, name: &str) -> bool {
        let mut chars = name.chars();
        chars.next().is_some_and(|c| {
            chars.next().is_none()
                && self.has(Property::EmojiPresentation, c as u32)
                && !self.has(Property::EmojiComponent, c as u32)
        })
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
            Property::EmojiPresentation => Self::in_ranges(&self.emoji_presentation, code),
            Property::EmojiComponent => Self::in_ranges(&self.emoji_component, code),
            Property::Group(letter) => self.category(code).as_bytes()[0] == letter,
            Property::Category(category) => self.category(code) == category,
        }
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

    /// Every code point next to a boundary of a record, where an unsorted
    /// search goes wrong first.
    fn boundaries(text: &str) -> Vec<u32> {
        let mut points: Vec<u32> = text
            .lines()
            .flat_map(|line| line.split_whitespace().skip(1))
            .filter_map(|field| u32::from_str_radix(field, 16).ok())
            .flat_map(|value| [value.wrapping_sub(1), value, value + 1])
            .filter(|&point| point <= 0x10FFFF)
            .collect();
        points.sort_unstable();
        points.dedup();
        points
    }

    #[test]
    fn records_in_any_order_give_the_same_answers() {
        let text = crate::loader::bundled("unicode.txt").expect("unicode.txt");
        let bundled = table();
        let reversed_text: Vec<&str> = text.lines().rev().collect();
        let reversed = Unicode::parse(&reversed_text.join("\n")).expect("the reversed table");
        for code in boundaries(text) {
            assert_eq!(reversed.category(code), bundled.category(code), "U+{code:04X}");
            assert_eq!(reversed.is_white_space(code), bundled.is_white_space(code), "U+{code:04X}");
            assert_eq!(reversed.combining_class(code), bundled.combining_class(code));
            assert_eq!(reversed.changes_in_document(code), bundled.changes_in_document(code));
            if let Some(c) = char::from_u32(code) {
                assert_eq!(reversed.decompose_with_origins(&[c]), bundled.decompose_with_origins(&[c]));
            }
            assert_eq!(reversed.is_mark(code), bundled.is_mark(code), "U+{code:04X}");
        }
        assert_eq!(reversed.category('a' as u32), "Ll");
        assert_eq!(reversed.category('A' as u32), "Lu");
    }

    #[test]
    fn an_omitted_scalar_value_is_cn_without_white_space_or_lowercase() {
        let table = Unicode::parse("unicode 0.0.0\ncategory Lu 0041 005A\n").expect("a partial table");
        let has = |name: &str, code: u32| table.has(Property::of(name).expect("a property"), code);
        assert_eq!(table.category('A' as u32), "Lu");
        assert_eq!(table.category('a' as u32), "Cn");
        assert_eq!(table.category(0x10FFFF), "Cn");
        assert_eq!(table.category(0), "Cn");
        assert_eq!(table.category(0xD800), "Cs");
        assert!(has("Cn", 'a' as u32) && has("C", 'a' as u32));
        assert!(!has("L", 'a' as u32) && !has("Cs", 'a' as u32));
        assert!(!table.is_white_space(0x20) && !table.is_white_space(0x9) && !has("White_Space", 0x20));
        // The engine no longer accepts a comparison normalization table (engine §1).
        assert!(Unicode::parse("unicode 0.0.0\nlower 0041 0061\n").is_err());
        assert!(!table.is_mark(0x301));
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
    #[test]
    fn normalization_conformance() {
        let unicode = table();
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/unicode/NormalizationTest.txt");
        let text = std::fs::read_to_string(path).expect("NormalizationTest.txt");
        let mut listed = std::collections::HashSet::new();
        let mut part = "";
        let mut count = 0;
        for line in text.lines() {
            let data = line.split('#').next().unwrap().trim();
            if data.starts_with('@') {
                part = data.split_whitespace().next().unwrap();
                continue;
            }
            if data.is_empty() {
                continue;
            }
            let columns: Vec<Vec<char>> = data
                .split(';')
                .take(5)
                .map(|column| {
                    column
                        .split_whitespace()
                        .map(|hex| char::from_u32(u32::from_str_radix(hex, 16).unwrap()).unwrap())
                        .collect()
                })
                .collect();
            for index in 0..5 {
                let expected: String = columns[if index < 3 { 2 } else { 4 }].iter().collect();
                assert_eq!(unicode.decompose(&columns[index]), expected, "row {}, column {}", count + 1, index + 1);
            }
            if part == "@Part1" {
                listed.insert(columns[0][0]);
            }
            count += 1;
        }
        assert_eq!(count, 19074);
        for code in 0..=0x10FFFF {
            if let Some(c) = char::from_u32(code).filter(|c| !listed.contains(c)) {
                assert_eq!(unicode.decompose(&[c]), c.to_string(), "unlisted U+{code:04X}");
            }
        }
    }

    #[test]
    fn decomposition_origins_and_partial_tables() {
        let unicode = table();
        let text: Vec<char> = "á\u{323}\u{300}\u{301}한".chars().collect();
        let decomposed = unicode.decompose_with_origins(&text);
        assert_eq!(decomposed.iter().map(|s| s.character).collect::<String>(), "a\u{323}\u{301}\u{300}\u{301}한");
        assert_eq!(decomposed.iter().map(|s| s.origin).collect::<Vec<_>>(), [0, 1, 0, 2, 3, 4, 4, 4]);
        let mappings = Unicode::parse("decompose 00E1 0061 0301\n").unwrap();
        assert_eq!(mappings.decompose(&['á', '\u{323}']), "a\u{301}\u{323}");
        assert_eq!(mappings.decompose(&['한']), "한");
        let classes = Unicode::parse("combining 230 0301 0301\ncombining 220 0323 0323\n").unwrap();
        assert_eq!(classes.decompose(&['á', '\u{323}']), "á\u{323}");
        assert_eq!(classes.decompose(&['a', '\u{301}', '\u{323}']), "a\u{323}\u{301}");
    }
}
