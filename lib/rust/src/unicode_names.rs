//! Lazy Unicode names resources and pinned reference inspection (engine §1).

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};

use crate::error::Error;
use crate::json::{fnv1a64, Json};
use crate::unicode::{Unicode, PINNED_NAMES_HASH};

fn failure(path: &str, line: Option<usize>, message: &str) -> Error {
    let mut error = Error::grammar(message).in_document(path);
    error.line = line;
    error
}

fn scalar(field: &str, path: &str, line: usize) -> Result<u32, Error> {
    let digits = field.trim_start_matches('0');
    if field.is_empty() || !field.bytes().all(|c| c.is_ascii_hexdigit()) || digits.len() > 6 {
        return Err(failure(path, Some(line), "an invalid scalar"));
    }
    u32::from_str_radix(if digits.is_empty() { "0" } else { digits }, 16)
        .ok()
        .filter(|&code| char::from_u32(code).is_some())
        .ok_or_else(|| failure(path, Some(line), "an invalid scalar"))
}

fn spelling(name: &str) -> bool {
    !name.is_empty() && name.bytes().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == b' ' || c == b'-')
}

const HANGUL_L: [&str; 19] =
    ["G", "GG", "N", "D", "DD", "R", "M", "B", "BB", "S", "SS", "", "J", "JJ", "C", "K", "T", "P", "H"];
const HANGUL_V: [&str; 21] = [
    "A", "AE", "YA", "YAE", "EO", "E", "YEO", "YE", "O", "WA", "WAE", "OE", "YO", "U", "WEO", "WE", "WI", "YU", "EU",
    "YI", "I",
];
const HANGUL_T: [&str; 28] = [
    "", "G", "GG", "GS", "N", "NJ", "NH", "D", "L", "LG", "LM", "LB", "LS", "LT", "LP", "LH", "M", "B", "BS", "S",
    "SS", "NG", "J", "C", "K", "T", "P", "H",
];

struct Record {
    code: u32,
    name: String,
    kind: String,
    line: usize,
}

impl Record {
    fn alias_key(&self) -> (String, u32, String) {
        (self.kind.clone(), self.code, self.name.clone())
    }
}

struct Algorithm {
    kind: String,
    first: u32,
    last: u32,
    prefix: String,
    line: usize,
}

impl Algorithm {
    fn same_rule(&self, other: &Self) -> bool {
        self.kind == other.kind && self.first == other.first && self.last == other.last && self.prefix == other.prefix
    }

    fn lookup(&self, name: &str) -> Option<u32> {
        if self.kind == "hex" {
            let suffix = name.strip_prefix(&self.prefix)?;
            if !(4..=6).contains(&suffix.len())
                || !suffix.bytes().all(|c| c.is_ascii_digit() || (b'A'..=b'F').contains(&c))
            {
                return None;
            }
            let code = u32::from_str_radix(suffix, 16).ok()?;
            return (code >= self.first && code <= self.last && format!("{code:04X}") == suffix).then_some(code);
        }
        let suffix = name.strip_prefix("HANGUL SYLLABLE ")?;
        for (l, lead) in HANGUL_L.iter().enumerate() {
            for (v, vowel) in HANGUL_V.iter().enumerate() {
                if let Some(tail) = suffix.strip_prefix(lead).and_then(|rest| rest.strip_prefix(vowel)) {
                    if let Some(t) = HANGUL_T.iter().position(|&value| value == tail) {
                        return Some(0xac00 + ((l * 21 + v) * 28 + t) as u32);
                    }
                }
            }
        }
        None
    }
}

struct Names {
    path: String,
    records: Vec<Record>,
    names: BTreeMap<String, u32>,
    formal: BTreeMap<u32, String>,
    aliases: BTreeSet<(String, u32, String)>,
    scalars: BTreeSet<u32>,
    algorithms: Vec<Algorithm>,
}

impl Names {
    fn parse(text: &str, path: &str, version: &str) -> Result<Self, Error> {
        let mut names = Self {
            path: path.into(),
            records: Vec::new(),
            names: BTreeMap::new(),
            formal: BTreeMap::new(),
            aliases: BTreeSet::new(),
            scalars: BTreeSet::new(),
            algorithms: Vec::new(),
        };
        let mut header = false;
        for (index, raw) in text.split_inclusive('\n').enumerate() {
            let line = index + 1;
            let raw = raw.strip_suffix('\n').map_or(raw, |line| line.strip_suffix('\r').unwrap_or(line));
            let fields: Vec<&str> = raw.split([' ', '\t']).filter(|field| !field.is_empty()).collect();
            if fields.is_empty() {
                continue;
            }
            if !header {
                let valid = fields.len() == 2
                    && fields[0] == "unicode-names"
                    && fields[1] == version
                    && fields[1].split('.').count() == 3
                    && fields[1].split('.').all(|part| !part.is_empty() && part.bytes().all(|c| c.is_ascii_digit()));
                if !valid {
                    return Err(failure(path, Some(line), "the names header must match the core version"));
                }
                header = true;
                continue;
            }
            match fields[0] {
                "name" | "alias" => {
                    let alias = fields[0] == "alias";
                    let start = if alias { 3 } else { 2 };
                    let kind = if alias { fields.get(1).copied().unwrap_or("") } else { "name" };
                    if fields.len() <= start
                        || alias && !["correction", "control", "alternate", "figment", "abbreviation"].contains(&kind)
                    {
                        return Err(failure(path, Some(line), "an invalid name record"));
                    }
                    let code = scalar(fields[start - 1], path, line)?;
                    let name = fields[start..].join(" ");
                    if !spelling(&name) {
                        return Err(failure(path, Some(line), "an invalid name spelling"));
                    }
                    let record = Record { code, name: name.clone(), kind: kind.into(), line };
                    if alias {
                        if !names.aliases.insert(record.alias_key()) {
                            return Err(failure(path, Some(line), "a duplicate alias record"));
                        }
                    } else if names.formal.insert(code, name.clone()).is_some() {
                        return Err(failure(path, Some(line), "a scalar has more than one formal name"));
                    }
                    if names.names.insert(name, code).is_some_and(|previous| previous != code) {
                        return Err(failure(path, Some(line), "a name identifies different scalars"));
                    }
                    names.scalars.insert(code);
                    names.records.push(record);
                }
                "algorithm" => {
                    let kind = fields.get(1).copied().unwrap_or("");
                    if !(kind == "hex" && fields.len() >= 5 || kind == "hangul" && fields.len() == 4) {
                        return Err(failure(path, Some(line), "an invalid naming algorithm"));
                    }
                    let first = scalar(fields[2], path, line)?;
                    let last = scalar(fields[3], path, line)?;
                    let prefix = if kind == "hex" { fields[4..].join(" ") } else { "HANGUL SYLLABLE ".into() };
                    if first > last
                        || first <= 0xdfff && last >= 0xd800
                        || !spelling(&prefix)
                        || kind == "hangul" && (first, last) != (0xac00, 0xd7a3)
                    {
                        return Err(failure(path, Some(line), "an invalid naming algorithm"));
                    }
                    if names.algorithms.iter().any(|rule| {
                        rule.kind == kind && rule.prefix == prefix && first <= rule.last && last >= rule.first
                    }) {
                        return Err(failure(path, Some(line), "overlapping naming algorithms"));
                    }
                    names.algorithms.push(Algorithm { kind: kind.into(), first, last, prefix, line });
                }
                _ => return Err(failure(path, Some(line), "an unknown names record")),
            }
        }
        if !header {
            return Err(failure(path, None, "the names header is missing"));
        }
        for record in &names.records {
            for rule in &names.algorithms {
                if record.kind == "name" && record.code >= rule.first && record.code <= rule.last {
                    return Err(failure(path, Some(record.line), "an explicit name lies in an algorithmic range"));
                }
                if rule.lookup(&record.name).is_some_and(|code| code != record.code) {
                    return Err(failure(path, Some(record.line), "a name identifies different scalars"));
                }
            }
        }
        Ok(names)
    }

    fn lookup(&self, name: &str) -> Option<u32> {
        self.names.get(name).copied().or_else(|| self.algorithms.iter().find_map(|rule| rule.lookup(name)))
    }

    fn has_scalar(&self, code: u32) -> bool {
        self.scalars.contains(&code) || self.algorithms.iter().any(|rule| code >= rule.first && code <= rule.last)
    }

    fn inspect(&self, pinned: &Self, abbreviations: &BTreeMap<String, u32>, extra: bool) -> Result<(), Error> {
        for rule in &self.algorithms {
            if extra || !pinned.algorithms.iter().any(|known| rule.same_rule(known)) {
                return Err(failure(&self.path, Some(rule.line), "an algorithm must retain its pinned rule and range"));
            }
        }
        for record in &self.records {
            if record.kind != "name" {
                if extra || !pinned.aliases.contains(&record.alias_key()) {
                    return Err(failure(
                        &self.path,
                        Some(record.line),
                        "an alias must retain its pinned kind, spelling, and scalar",
                    ));
                }
            } else if !extra && pinned.formal.get(&record.code) == Some(&record.name) {
                continue;
            } else if pinned.has_scalar(record.code)
                || pinned.lookup(&record.name).is_some()
                || !record.name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
                || abbreviations.contains_key(&record.name)
            {
                return Err(failure(
                    &self.path,
                    Some(record.line),
                    "an added name must name an unnamed scalar without a reserved spelling",
                ));
            }
        }
        Ok(())
    }
}

type ReadNames<'a> = &'a dyn Fn(&str) -> Result<Option<String>, Error>;
type ResolveNames<'a> = &'a dyn Fn(&str, &str) -> Option<String>;

pub(crate) fn selected_names(
    path: &str,
    dom: &crate::dom::Dom,
    inherited: &[String],
    resolve: ResolveNames<'_>,
) -> Result<Vec<String>, Error> {
    let mut paths: BTreeSet<String> = inherited.iter().cloned().collect();
    for directive in &dom.directives {
        if directive.name == "names" {
            let target = &directive.args[0];
            let resolved = resolve(path, target).ok_or_else(|| {
                Error::grammar("the names path leaves the grammar resources")
                    .in_document(path)
                    .at(directive.at.0, directive.at.1)
            })?;
            paths.insert(resolved);
        }
    }
    Ok(paths.into_iter().collect())
}

pub(crate) fn names_registry(value: &Json) -> Option<BTreeMap<String, String>> {
    let Json::Obj(fields) = value else { return None };
    fields
        .iter()
        .map(|(path, value)| {
            let hash = value.as_str()?;
            if path.split('/').any(|part| part.is_empty() || part == "." || part == "..")
                || hash.len() != 16
                || !hash.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            {
                return None;
            }
            Some((path.clone(), hash.to_string()))
        })
        .collect()
}

pub(crate) struct NamesScope<'a> {
    read: ReadNames<'a>,
    unicode: &'a Unicode,
    overridden: &'a dyn Fn(&str) -> bool,
    extras: RefCell<BTreeSet<String>>,
    document: &'a str,
    resolve: ResolveNames<'a>,
    tables: RefCell<Option<Vec<Names>>>,
    pub dependencies: RefCell<Option<BTreeMap<String, String>>>,
}

impl<'a> NamesScope<'a> {
    pub fn new(read: ReadNames<'a>, unicode: &'a Unicode, extras: impl IntoIterator<Item = String>) -> Self {
        Self {
            read,
            unicode,
            overridden: &|_| true,
            extras: RefCell::new(extras.into_iter().collect()),
            document: "",
            resolve: &crate::markdown::resolve,
            tables: RefCell::new(None),
            dependencies: RefCell::new(None),
        }
    }

    pub fn with_overrides(mut self, overridden: &'a dyn Fn(&str) -> bool) -> Self {
        self.overridden = overridden;
        self
    }

    pub fn in_document(mut self, document: &'a str, resolve: ResolveNames<'a>) -> Self {
        self.document = document;
        self.resolve = resolve;
        self
    }

    pub fn for_dom(&self, dom: &crate::dom::Dom) -> Result<Self, Error> {
        let inherited: Vec<String> = self.extras.borrow().iter().cloned().collect();
        let paths = selected_names(self.document, dom, &inherited, self.resolve)?;
        Ok(Self::new(self.read, self.unicode, paths)
            .in_document(self.document, self.resolve)
            .with_overrides(self.overridden))
    }

    pub fn add_path(&self, path: &str) -> Result<(), Error> {
        let resolved = (self.resolve)(self.document, path)
            .ok_or_else(|| Error::grammar("the names path leaves the grammar resources").in_document(self.document))?;
        self.extras.borrow_mut().insert(resolved);
        Ok(())
    }

    fn need(&self, path: &str) -> Result<String, Error> {
        (self.read)(path)?.ok_or_else(|| failure(path, None, "the names resource is missing"))
    }

    fn load(&self) -> Result<(), Error> {
        if self.tables.borrow().is_some() {
            return Ok(());
        }
        if self.unicode.version_count != 1 || self.unicode.version.as_deref().unwrap_or("").is_empty() {
            return Err(failure("data/unicode/unicode.txt", None, "names require exactly one Unicode version"));
        }
        let version = self.unicode.version.as_deref().unwrap_or("");
        let text = self.need("data/unicode/unicode-names.txt")?;
        let hash = fnv1a64(&text);
        let base = Names::parse(&text, "data/unicode/unicode-names.txt", version)?;
        let reference = if hash == PINNED_NAMES_HASH { text } else { self.need("data/unicode/unicode-names-reference.txt")? };
        if fnv1a64(&reference) != PINNED_NAMES_HASH {
            return Err(failure(
                "data/unicode/unicode-names-reference.txt",
                None,
                "the reference fingerprint differs from the pinned data",
            ));
        }
        if version != "15.1.0" {
            return Err(failure(
                "data/unicode/unicode-names-reference.txt",
                None,
                "the reference version differs from the selected names version",
            ));
        }
        let pinned;
        let inspection = if hash == PINNED_NAMES_HASH {
            &base
        } else {
            pinned = Names::parse(&reference, "data/unicode/unicode-names-reference.txt", "15.1.0")?;
            &pinned
        };
        base.inspect(inspection, &self.unicode.abbreviations, false)?;
        let mut extras = Vec::new();
        let mut dependencies = BTreeMap::from([("data/unicode/unicode-names.txt".into(), hash)]);
        for path in self.extras.borrow().iter() {
            let text = self.need(path)?;
            let names = Names::parse(&text, path, version)?;
            names.inspect(inspection, &self.unicode.abbreviations, true)?;
            for record in &names.records {
                for earlier in std::iter::once(&base).chain(extras.iter()) {
                    if earlier.lookup(&record.name).is_some_and(|code| code != record.code)
                        || earlier.formal.get(&record.code).is_some_and(|name| name != &record.name)
                    {
                        return Err(failure(path, Some(record.line), "names resources conflict"));
                    }
                }
            }
            dependencies.insert(path.clone(), fnv1a64(&text));
            extras.push(names);
        }
        let mut tables = vec![base];
        tables.extend(extras);
        *self.tables.borrow_mut() = Some(tables);
        *self.dependencies.borrow_mut() = Some(dependencies);
        Ok(())
    }

    pub fn lookup(&self, name: &str, core_only: bool) -> Result<Option<char>, Error> {
        if let Some(&code) = self.unicode.abbreviations.get(name) {
            return Ok(char::from_u32(code));
        }
        if core_only {
            return Ok(None);
        }
        self.load()?;
        Ok(self
            .tables
            .borrow()
            .as_ref()
            .and_then(|tables| tables.iter().find_map(|table| table.lookup(name)))
            .and_then(char::from_u32))
    }

    pub fn matches(
        &self,
        dependencies: Option<&Json>,
        registry: Option<&BTreeMap<String, String>>,
    ) -> Result<bool, Error> {
        let Some(dependencies) = dependencies else {
            return Ok(true);
        };
        let Json::Obj(fields) = dependencies else {
            return Ok(false);
        };
        let mut paths = self.extras.borrow().clone();
        paths.insert("data/unicode/unicode-names.txt".into());
        if fields.len() != paths.len() {
            return Ok(false);
        }
        for (path, value) in fields {
            let Some(hash) = value.as_str() else {
                return Ok(false);
            };
            if !paths.contains(path)
                || hash.len() != 16
                || !hash.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            {
                return Ok(false);
            }
        }
        if let Some(registry) =
            registry.filter(|registry| paths.iter().all(|p| registry.contains_key(p) && !(self.overridden)(p)))
        {
            if self.unicode.version_count != 1 || self.unicode.version.as_deref() != Some("15.1.0") {
                return Err(failure("data/unicode/unicode.txt", None, "bundled names require Unicode version 15.1.0"));
            }
            let matching = fields.iter().all(|(path, value)| registry.get(path).map(String::as_str) == value.as_str());
            if matching {
                *self.dependencies.borrow_mut() =
                    Some(paths.iter().map(|p| (p.clone(), registry[p].clone())).collect());
            }
            return Ok(matching);
        }
        self.load()?;
        Ok(fields.iter().all(|(path, value)| {
            self.dependencies.borrow().as_ref().and_then(|set| set.get(path)).map(String::as_str) == value.as_str()
        }))
    }
}
