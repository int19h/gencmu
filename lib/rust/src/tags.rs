//! Tags and tag sets (engine §1): names interned to numbers, and sets of
//! (tag, strength) interned to numbers, so that items can compare them
//! cheaply.

use std::collections::BTreeMap;

use crate::fxhash::FxMap;

pub(crate) type TagId = u32;
pub(crate) type SetId = u32;

/// A tag set, sorted by tag id; `true` is strong.
pub(crate) type TagList = Vec<(TagId, bool)>;

#[derive(Debug, Default)]
pub(crate) struct Tags {
    names: Vec<String>,
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
        self.index.insert(name.to_string(), id);
        id
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
        self.sets[set as usize].binary_search_by_key(&tag, |&(id, _)| id).is_ok()
    }

    /// Builds a set from names and strengths; a tag given twice is strong
    /// if either is.
    pub(crate) fn set_of<'a>(&mut self, tags: impl IntoIterator<Item = (&'a str, bool)>) -> SetId {
        let mut list: TagList = tags.into_iter().map(|(name, strong)| (self.tag(name), strong)).collect();
        list.sort_unstable();
        list.dedup_by(|later, earlier| {
            if later.0 == earlier.0 {
                earlier.1 |= later.1;
                true
            } else {
                false
            }
        });
        self.set(list)
    }

    /// The set as a map from name to strength, in code point order.
    pub(crate) fn to_map(&self, set: SetId) -> BTreeMap<String, bool> {
        self.list(set).iter().map(|&(id, strong)| (self.name(id).to_string(), strong)).collect()
    }
}

/// The union of two sorted lists: every tag of either, strong if strong in
/// either.
pub(crate) fn union(left: &TagList, right: &TagList) -> TagList {
    let mut out = Vec::with_capacity(left.len() + right.len());
    let (mut i, mut j) = (0, 0);
    while i < left.len() && j < right.len() {
        match left[i].0.cmp(&right[j].0) {
            std::cmp::Ordering::Less => {
                out.push(left[i]);
                i += 1;
            }
            std::cmp::Ordering::Greater => {
                out.push(right[j]);
                j += 1;
            }
            std::cmp::Ordering::Equal => {
                out.push((left[i].0, left[i].1 || right[j].1));
                i += 1;
                j += 1;
            }
        }
    }
    out.extend_from_slice(&left[i..]);
    out.extend_from_slice(&right[j..]);
    out
}

/// The intersection: the tags of the first that are in the second, with
/// the first's strength.
pub(crate) fn intersection(left: &TagList, right: &TagList) -> TagList {
    left.iter().filter(|&&(id, _)| right.binary_search_by_key(&id, |&(other, _)| other).is_ok()).copied().collect()
}

/// Whether a tag is a phoneme tag `/p/`, exactly three code points, and if
/// so its phoneme `p`, or a space for the pause, `/./` (engine §5).
pub(crate) fn phoneme_of(tag: &str) -> Option<&str> {
    if tag == "/./" {
        Some(" ")
    } else if tag.chars().count() == 3 && tag.starts_with('/') && tag.ends_with('/') {
        Some(&tag[1..tag.len() - 1])
    } else {
        None
    }
}
