//! Strict inspection of the Unicode properties companion (engine §1).

use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;

use crate::error::Error;
use crate::json;
use crate::unicode::{ScalarProfile, Unicode};

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

struct Catalog {
    types: BTreeMap<String, String>,
    values: BTreeMap<String, BTreeSet<String>>,
    aliases: BTreeMap<String, String>,
    tags: BTreeMap<String, (String, String)>,
    core: BTreeSet<String>,
    combining: Vec<String>,
}

fn catalog() -> &'static Catalog {
    static DATA: OnceLock<Catalog> = OnceLock::new();
    DATA.get_or_init(|| {
        let data = json::parse(PROPERTY_CATALOG).expect("the generated property catalog is JSON");
        let strings = |key| {
            data.get(key)
                .unwrap()
                .as_object()
                .unwrap()
                .iter()
                .map(|(key, value)| (key.clone(), value.as_str().unwrap().to_string()))
                .collect()
        };
        let values = data
            .get("values")
            .unwrap()
            .as_object()
            .unwrap()
            .iter()
            .map(|(key, values)| {
                (
                    key.clone(),
                    values.as_array().unwrap().iter().map(|value| value.as_str().unwrap().to_string()).collect(),
                )
            })
            .collect();
        let tags = data
            .get("tags")
            .unwrap()
            .as_object()
            .unwrap()
            .iter()
            .map(|(key, values)| {
                let values = values.as_array().unwrap();
                (key.clone(), (values[0].as_str().unwrap().to_string(), values[1].as_str().unwrap().to_string()))
            })
            .collect();
        let core = data
            .get("core")
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .map(|name| name.as_str().unwrap().to_string())
            .collect();
        let mut combining = vec![String::new(); 255];
        for (class, value) in data.get("combining").unwrap().as_object().unwrap() {
            combining[class.parse::<usize>().unwrap()] = value.as_str().unwrap().to_string();
        }
        Catalog { types: strings("types"), values, aliases: strings("aliases"), tags, core, combining }
    })
}

fn error(line: Option<usize>) -> Error {
    let mut error = Error::grammar("the property record is invalid").in_document("data/unicode/unicode-properties.txt");
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
        let Some(expected) = inventory.types.get(name).map(String::as_str) else { return Err(error(Some(line))) };
        if inventory.core.contains(name) {
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
                || !inventory.values.get(fields[1]).is_some_and(|values| values.contains(fields[2]))
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
    let mut declaration_order: Vec<_> = properties.values_mut().collect();
    declaration_order.sort_by_key(|property| property.line);
    for property in declaration_order {
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
    catalog().aliases.get(spelling).map(String::as_str)
}

pub(crate) fn identity(name: &str) -> Option<(&'static str, &'static str)> {
    catalog().tags.get(name).map(|(property, value)| (property.as_str(), value.as_str()))
}

impl Unicode {
    pub(crate) fn canonical_tag(&self, spelling: &str) -> Option<&'static str> {
        let name = canonical(spelling)?;
        let (property, value) = identity(name)?;
        if catalog().core.contains(property) {
            return Some(name);
        }
        let data = self.properties.get(property)?;
        (data.kind == "binary" || data.values.contains(value)).then_some(name)
    }

    pub(crate) fn profile(&self, code: u32) -> ScalarProfile {
        if let Some(profile) = self.profiles.lock().unwrap().get(&code) {
            return profile.clone();
        }
        let profile = self.build_profile(code).into();
        let mut profiles = self.profiles.lock().unwrap();
        if profiles.len() >= 4096 {
            profiles.clear();
        }
        profiles.entry(code).or_insert(profile).clone()
    }

    fn build_profile(&self, code: u32) -> Vec<String> {
        let category = self.category(code);
        let mut tags = vec![
            canonical(&format!("_{category}")).unwrap().to_string(),
            canonical(&format!("_{}", &category[..1])).unwrap().to_string(),
            catalog().combining[self.combining_class(code) as usize].clone(),
        ];
        if self.is_white_space(code) {
            tags.push("_White_Space".into());
        }
        for (present, name) in [
            (self.is_emoji_presentation(code), "_Emoji_Presentation"),
            (self.is_emoji_component(code), "_Emoji_Component"),
        ] {
            if present {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn profiles_share_safely_and_keep_table_identity() {
        let upper = Unicode::parse("category Lu 0041 0041\n").unwrap();
        let absent = Unicode::parse("").unwrap();
        let profile = upper.profile(65);
        assert!(profile.iter().any(|tag| tag == "_General_Category_Uppercase_Letter"));
        assert_ne!(profile, absent.profile(65));
        std::thread::scope(|scope| {
            for _ in 0..4 {
                scope.spawn(|| assert!(Arc::ptr_eq(&profile, &upper.profile(65))));
            }
        });
        for code in 0..5000 {
            upper.profile(code);
        }
        assert!(upper.profiles.lock().unwrap().len() <= 4096);
        assert_eq!(profile, upper.profile(65));
    }
}
