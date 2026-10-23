//! Strict inspection of the Unicode properties companion (engine §1).

use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;

use crate::error::Error;
use crate::json::{self, Json};
use crate::unicode::Unicode;

include!("unicode_property_catalog.rs");

#[derive(Debug, Clone)]
pub(crate) struct PropertyRange {
    pub first: u32,
    pub last: u32,
    pub values: Vec<String>,
    line: usize,
}

#[derive(Debug, Clone)]
pub(crate) struct PropertyData {
    pub kind: String,
    pub values: BTreeSet<String>,
    pub defaults: Vec<String>,
    pub ranges: Vec<PropertyRange>,
    line: usize,
}

fn catalog() -> &'static Json {
    static DATA: OnceLock<Json> = OnceLock::new();
    DATA.get_or_init(|| json::parse(PROPERTY_CATALOG).expect("the generated property catalog is JSON"))
}

fn error(line: Option<usize>) -> Error {
    let mut error = Error::grammar("the property record is invalid").in_document("unicode-properties.txt");
    error.line = line;
    error
}

fn code(field: &str, line: usize) -> Result<u32, Error> {
    let digits = field.trim_start_matches('0');
    if field.is_empty() || !field.bytes().all(|c| c.is_ascii_hexdigit()) || digits.len() > 6 {
        return Err(error(Some(line)));
    }
    u32::from_str_radix(if digits.is_empty() { "0" } else { digits }, 16)
        .ok()
        .filter(|&code| code <= 0x10ffff)
        .ok_or_else(|| error(Some(line)))
}

pub(crate) fn read_properties(text: &str, core: &Unicode) -> Result<BTreeMap<String, PropertyData>, Error> {
    let inventory = catalog();
    let types = inventory.get("types").unwrap();
    let core_names = inventory.get("core").and_then(Json::as_array).unwrap();
    let domains = inventory.get("values").unwrap();
    let mut properties = BTreeMap::<String, PropertyData>::new();
    let mut pending = Vec::new();
    let mut header = false;
    for (index, raw) in text.split_inclusive('\n').enumerate() {
        let line = index + 1;
        let raw = raw.strip_suffix('\n').map_or(raw, |raw| raw.strip_suffix('\r').unwrap_or(raw));
        let fields: Vec<_> = raw.split([' ', '\t']).filter(|field| !field.is_empty()).collect();
        if fields.is_empty() {
            continue;
        }
        if !header {
            let parts = fields.get(1).map(|version| version.split('.').collect::<Vec<_>>()).unwrap_or_default();
            if fields.len() != 2
                || fields[0] != "unicode-properties"
                || parts.len() != 3
                || parts.iter().any(|part| part.is_empty() || !part.bytes().all(|c| c.is_ascii_digit()))
                || core.version_count != 1
                || core.version.as_deref() != fields.get(1).copied()
            {
                return Err(error(Some(line)));
            }
            header = true;
            continue;
        }
        let Some(&name) = fields.get(1) else { return Err(error(Some(line))) };
        let Some(expected) = types.get(name).and_then(Json::as_str) else { return Err(error(Some(line))) };
        if core_names.iter().any(|value| value.as_str() == Some(name)) {
            return Err(error(Some(line)));
        }
        match fields[0] {
            kind @ ("binary" | "enumerated" | "multiple") => {
                if kind != expected
                    || properties.contains_key(name)
                    || match kind {
                        "binary" => fields.len() != 2,
                        "enumerated" => fields.len() != 3,
                        _ => fields.len() < 3,
                    }
                {
                    return Err(error(Some(line)));
                }
                let mut defaults: Vec<_> = fields[2..].iter().map(|value| (*value).to_string()).collect();
                defaults.sort();
                if defaults.windows(2).any(|pair| pair[0] == pair[1]) {
                    return Err(error(Some(line)));
                }
                properties.insert(
                    name.into(),
                    PropertyData { kind: kind.into(), values: BTreeSet::new(), defaults, ranges: Vec::new(), line },
                );
            }
            "value" | "range" => pending.push((fields, line)),
            _ => return Err(error(Some(line))),
        }
    }
    if !header {
        return Err(error(None));
    }
    for (fields, line) in pending {
        let Some(property) = properties.get_mut(fields[1]) else { return Err(error(Some(line))) };
        if fields[0] == "value" {
            if fields.len() != 3
                || property.kind == "binary"
                || !domains
                    .get(fields[1])
                    .and_then(Json::as_array)
                    .is_some_and(|values| values.iter().any(|value| value.as_str() == Some(fields[2])))
                || !property.values.insert(fields[2].into())
            {
                return Err(error(Some(line)));
            }
        } else {
            if match property.kind.as_str() {
                "binary" => fields.len() != 4,
                "enumerated" => fields.len() != 5,
                _ => fields.len() < 5,
            } {
                return Err(error(Some(line)));
            }
            let (first, last) = (code(fields[2], line)?, code(fields[3], line)?);
            if first > last || first <= 0xdfff && last >= 0xd800 {
                return Err(error(Some(line)));
            }
            let mut values = if property.kind == "binary" {
                vec!["Yes".to_string()]
            } else {
                fields[4..].iter().map(|value| (*value).to_string()).collect()
            };
            values.sort();
            if values.windows(2).any(|pair| pair[0] == pair[1]) {
                return Err(error(Some(line)));
            }
            property.ranges.push(PropertyRange { first, last, values, line });
        }
    }
    for property in properties.values_mut() {
        if property.defaults.iter().any(|value| !property.values.contains(value)) {
            return Err(error(Some(property.line)));
        }
        property.ranges.sort_by_key(|range| (range.first, range.last, range.line));
        let mut merged = Vec::<PropertyRange>::new();
        for range in std::mem::take(&mut property.ranges) {
            if property.kind != "binary" && range.values.iter().any(|value| !property.values.contains(value)) {
                return Err(error(Some(range.line)));
            }
            if let Some(previous) = merged.last_mut() {
                let equal = previous.values == range.values;
                if range.first <= previous.last && !equal {
                    return Err(error(Some(range.line)));
                }
                if range.first <= previous.last + 1 && equal {
                    previous.last = previous.last.max(range.last);
                    continue;
                }
            }
            merged.push(range);
        }
        property.ranges = merged;
    }
    Ok(properties)
}

pub(crate) fn canonical(spelling: &str) -> Option<&'static str> {
    static ALIASES: OnceLock<BTreeMap<String, String>> = OnceLock::new();
    ALIASES
        .get_or_init(|| {
            catalog()
                .get("aliases")
                .unwrap()
                .as_object()
                .unwrap()
                .iter()
                .map(|(key, value)| (key.clone(), value.as_str().unwrap().to_string()))
                .collect()
        })
        .get(spelling)
        .map(String::as_str)
}

pub(crate) fn identity(name: &str) -> Option<(&'static str, &'static str)> {
    static TAGS: OnceLock<BTreeMap<String, (String, String)>> = OnceLock::new();
    TAGS.get_or_init(|| {
        catalog()
            .get("tags")
            .unwrap()
            .as_object()
            .unwrap()
            .iter()
            .map(|(key, value)| {
                let xs = value.as_array().unwrap();
                (key.clone(), (xs[0].as_str().unwrap().to_string(), xs[1].as_str().unwrap().to_string()))
            })
            .collect()
    })
    .get(name)
    .map(|(p, v)| (p.as_str(), v.as_str()))
}

impl Unicode {
    pub(crate) fn canonical_tag(&self, spelling: &str) -> Option<&'static str> {
        let name = canonical(spelling)?;
        let (property, value) = identity(name)?;
        if matches!(
            property,
            "General_Category" | "Canonical_Combining_Class" | "White_Space" | "Emoji_Presentation" | "Emoji_Component"
        ) {
            return Some(name);
        }
        let data = self.properties.get(property)?;
        (data.kind == "binary" || data.values.contains(value)).then_some(name)
    }

    pub(crate) fn profile(&self, code: u32) -> Vec<String> {
        let category = self.category(code);
        let mut tags = vec![
            canonical(&format!("_{category}")).unwrap().to_string(),
            canonical(&format!("_{}", &category[..1])).unwrap().to_string(),
            catalog()
                .get("combining")
                .unwrap()
                .get(&self.combining_class(code).to_string())
                .unwrap()
                .as_str()
                .unwrap()
                .to_string(),
        ];
        if self.is_white_space(code) {
            tags.push("_White_Space".into());
        }
        for (prop, name) in [
            (crate::unicode::Property::EmojiPresentation, "_Emoji_Presentation"),
            (crate::unicode::Property::EmojiComponent, "_Emoji_Component"),
        ] {
            if self.has(prop, code) {
                tags.push(name.into());
            }
        }
        for (name, data) in &self.properties {
            let i = data.ranges.partition_point(|range| range.first <= code);
            let values =
                if i > 0 && code <= data.ranges[i - 1].last { &data.ranges[i - 1].values } else { &data.defaults };
            if data.kind == "binary" {
                if !values.is_empty() {
                    tags.push(format!("_{name}"));
                }
            } else {
                for value in values {
                    tags.push(format!("_{name}_{value}"));
                }
            }
        }
        tags.sort();
        tags
    }
}
