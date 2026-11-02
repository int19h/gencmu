//! Source nodes for parameterized rules (engine §2.3).
use crate::dom::{self, Dom};
use crate::json::Json;
use crate::unicode::Unicode;

pub(crate) mod expand;
pub(crate) mod locations;
mod print;
#[cfg(test)]
mod tests;
pub(crate) use expand::expand;
pub(crate) const SOURCE: &str = "\0source";
pub(crate) const KINDS: [&str; 5] = ["rules", "constants", "directives", "classifiers", "implications"];
pub(crate) fn obj<const N: usize>(fields: [(&str, Json); N]) -> Json {
    Json::Obj(fields.into_iter().map(|(k, v)| (k.into(), v)).collect())
}
pub(crate) fn string(s: impl Into<String>) -> Json {
    Json::Str(s.into())
}
pub(crate) fn get<'a>(n: &'a Json, k: &str) -> &'a Json {
    {
        static NULL: Json = Json::Null;
        n.get(k).unwrap_or(&NULL)
    }
}
pub(crate) fn text(n: &Json) -> &str {
    n.as_str().unwrap_or("")
}
pub(crate) fn list(n: &Json) -> &[Json] {
    n.as_array().unwrap_or(&[])
}
pub(crate) fn has(n: &Json, k: &str) -> bool {
    n.get(k).is_some()
}
pub(crate) fn set(n: &mut Json, key: &str, value: Json) {
    if let Json::Obj(fields) = n {
        if let Some((_, slot)) = fields.iter_mut().find(|(k, _)| k == key) {
            *slot = value;
        } else {
            fields.push((key.into(), value));
        }
    }
}
pub(crate) fn remove(n: &mut Json, key: &str) {
    if let Json::Obj(fields) = n {
        fields.retain(|(k, _)| k != key);
    }
}
pub(crate) fn position(at: (usize, usize)) -> Json {
    Json::Arr(vec![Json::Int(at.0 as i64), Json::Int(at.1 as i64)])
}
pub(crate) fn at(n: &Json) -> Option<(usize, usize)> {
    match get(n, "at").as_array()? {
        [Json::Int(a), Json::Int(b)] if *a > 0 && *b > 0 => Some((*a as usize, *b as usize)),
        _ => None,
    }
}
pub(crate) fn source_fields(root: &Json) -> Vec<(&str, &Json)> {
    let prefix: &[&str] = if has(root, "name") && has(root, "op") {
        &["instance", "args", "tags", "value", "image", "alternatives", "conditions", "emit"]
    } else if has(root, "expr") && !has(root, "test") {
        &["expr", "tags", "value", "image"]
    } else if has(root, "capture") || has(root, "insert") {
        &["tags", "value", "image"]
    } else {
        &[]
    };
    const ORDER: &[&str] = &[
        "if",
        "then",
        "left",
        "right",
        "not",
        "any",
        "all",
        "receiver",
        "args",
        "expr",
        "body",
        "targets",
        "requirements",
        "negated",
        "tags",
        "value",
        "image",
        "pattern",
        "child",
        "children",
        "repeat",
        "separator",
        "optional",
        "seq",
        "choice",
        "ranked",
        "and",
        "union",
        "intersection",
        "difference",
        "concat",
        "items",
        "before",
        "after",
    ];
    let mut fields: Vec<_> = root
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(key, _)| key != "at" && key != SOURCE)
        .map(|(key, value)| (key.as_str(), value))
        .collect();
    fields.sort_by_key(|&(key, _)| {
        let rank = prefix
            .iter()
            .position(|name| *name == key)
            .unwrap_or_else(|| prefix.len() + ORDER.iter().position(|name| *name == key).unwrap_or(ORDER.len()));
        (rank, key)
    });
    fields
}
pub(crate) fn nodes(root: &Json) -> impl Iterator<Item = &Json> {
    walk_nodes(root, false)
}
pub(crate) fn source_nodes(root: &Json) -> impl Iterator<Item = &Json> {
    walk_nodes(root, true)
}
fn walk_nodes(root: &Json, source: bool) -> impl Iterator<Item = &Json> {
    struct Nodes<'a> {
        pending: Vec<&'a Json>,
        source: bool,
    }
    impl<'a> Iterator for Nodes<'a> {
        type Item = &'a Json;
        fn next(&mut self) -> Option<Self::Item> {
            while let Some(n) = self.pending.pop() {
                match n {
                    Json::Obj(fields) => {
                        if self.source {
                            self.pending.extend(source_fields(n).into_iter().rev().map(|(_, value)| value));
                        } else {
                            self.pending.extend(
                                fields
                                    .iter()
                                    .rev()
                                    .filter(|(key, _)| key != "at" && key != SOURCE)
                                    .map(|(_, value)| value),
                            );
                        }
                        return Some(n);
                    }
                    Json::Arr(items) => self.pending.extend(items.iter().rev()),
                    _ => (),
                }
            }
            None
        }
    }
    Nodes { pending: vec![root], source }
}
pub(crate) fn unresolved(root: &Json) -> bool {
    nodes(root).any(|n| {
        ["param", "call", "params", "instance"].iter().any(|k| has(n, k))
            || has(n, "args") && has(n, "name") && has(n, "op")
    })
}
fn map_nodes(root: &Json, transform: impl Fn(Json) -> Json) -> Json {
    enum Task<'a> {
        Node(&'a Json),
        Array(usize),
        Object(Vec<String>),
    }
    let mut pending = vec![Task::Node(root)];
    let mut values = Vec::new();
    while let Some(task) = pending.pop() {
        match task {
            Task::Node(n) => match n {
                Json::Obj(fs) => {
                    pending.push(Task::Object(fs.iter().map(|(k, _)| k.clone()).collect()));
                    pending.extend(fs.iter().rev().map(|(_, v)| Task::Node(v)))
                }
                Json::Arr(xs) => {
                    pending.push(Task::Array(xs.len()));
                    pending.extend(xs.iter().rev().map(Task::Node))
                }
                _ => values.push(n.clone()),
            },
            Task::Array(count) => {
                let xs = values.split_off(values.len() - count);
                values.push(transform(Json::Arr(xs)))
            }
            Task::Object(keys) => {
                let xs = values.split_off(values.len() - keys.len());
                values.push(transform(Json::Obj(keys.into_iter().zip(xs).collect())))
            }
        }
    }
    values.pop().unwrap()
}
pub(crate) fn identity(root: &Json) -> Json {
    map_nodes(root, |mut n| {
        if let Json::Obj(fs) = &mut n {
            fs.retain(|(k, _)| k != "at" && k != SOURCE);
            fs.sort_by(|a, b| a.0.cmp(&b.0));
        }
        n
    })
}
pub(crate) fn argument(expr: Json) -> Json {
    if let Some(name) = expr.get("ref") {
        let s = text(name);
        return obj([(
            if s.starts_with(|c: char| c.is_ascii_uppercase() || c == '_') { "tag" } else { "rule" },
            name.clone(),
        )]);
    }
    if let Some(value) = expr.get("literal") {
        return value.clone();
    }
    if ["param", "call", "test", "range", "wildcard"].iter().any(|k| has(&expr, k)) {
        return expr;
    }
    obj([("body", expr)])
}
pub(crate) fn normalize_patterns(root: &Json, patterns: &std::collections::BTreeSet<String>) -> Json {
    map_nodes(root, |mut value| {
        if let Some(body) = value.get("body") {
            return argument(body.clone());
        }
        for k in ["union", "concat", "intersection"] {
            if k == "intersection" && !pattern_term(&value, patterns) {
                continue;
            }
            if let Some(xs) = value.get(k).and_then(Json::as_array) {
                let flat = xs
                    .iter()
                    .flat_map(|n| n.get(k).and_then(Json::as_array).unwrap_or(std::slice::from_ref(n)))
                    .cloned()
                    .collect();
                set(&mut value, k, Json::Arr(flat));
            }
        }
        value
    })
}
pub(crate) fn clean(root: &Json) -> Json {
    map_nodes(root, |mut n| {
        remove(&mut n, SOURCE);
        n
    })
}
#[cfg(test)]
pub(crate) fn canonical_source(root: &Json) -> Json {
    map_nodes(root, |mut n| {
        remove(&mut n, SOURCE);
        let order: &[&str] = if has(&n, "name") && has(&n, "flags") {
            &[
                "name",
                "params",
                "args",
                "op",
                "flags",
                "instance",
                "tags",
                "value",
                "image",
                "alternatives",
                "emit",
                "conditions",
                "erased",
            ]
        } else if has(&n, "name") && has(&n, "op") {
            &["name", "op", "term"]
        } else if has(&n, "directive") {
            &["directive", "args", "conditions"]
        } else if has(&n, "call") {
            &["call", "args", "exact", "children"]
        } else if has(&n, "method") {
            &["method", "receiver", "args"]
        } else if has(&n, "guards") {
            &["guards", "expr", "tags", "value", "image"]
        } else if has(&n, "test") {
            &["test", "requirements", "value", "expr"]
        } else if has(&n, "capture") && has(&n, "expr") {
            &["capture", "expr"]
        } else if has(&n, "capture") || has(&n, "insert") {
            &["capture", "insert", "before", "after", "tags", "value", "image"]
        } else if has(&n, "repeat") {
            &["repeat", "separator", "chain"]
        } else if has(&n, "optional") {
            &["optional", "elidable"]
        } else if has(&n, "if") {
            &["if", "then"]
        } else if has(&n, "op") {
            &["op", "left", "right"]
        } else if has(&n, "negated") {
            &["negated", "value"]
        } else if has(&n, "name") {
            &["name", "exact", "children"]
        } else if ["terminal", "literal", "range", "wildcard", "constant", "any", "param"].iter().any(|k| has(&n, k)) {
            &["terminal", "literal", "range", "wildcard", "constant", "any", "param", "exact", "children"]
        } else if has(&n, "path") {
            &["path", "pattern"]
        } else {
            &[]
        };
        if let Json::Obj(fields) = &mut n {
            fields.sort_by(|(a, _), (b, _)| {
                let rank = |k: &str| {
                    if k == "at" {
                        order.len() + 1
                    } else {
                        order.iter().position(|x| *x == k).unwrap_or(order.len())
                    }
                };
                rank(a).cmp(&rank(b)).then_with(|| a.cmp(b))
            });
        }
        n
    })
}

pub(crate) fn pattern_term(root: &Json, patterns: &std::collections::BTreeSet<String>) -> bool {
    let mut pending = vec![root];
    while let Some(n) = pending.pop() {
        if has(n, "pattern") || patterns.contains(text(get(n, "const"))) {
            return true;
        }
        for k in ["union", "intersection", "difference"] {
            pending.extend(list(get(n, k)));
        }
    }
    false
}
pub(crate) fn pattern_constant_names<'a>(
    definitions: impl Iterator<Item = &'a Json>,
) -> std::collections::BTreeSet<String> {
    use std::collections::{BTreeMap, BTreeSet};
    let mut patterns = BTreeSet::new();
    let mut users: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for definition in definitions {
        let name = text(get(definition, "name"));
        let mut pending = vec![get(definition, "value")];
        while let Some(n) = pending.pop() {
            if has(n, "pattern") {
                patterns.insert(name.to_string());
            }
            if has(n, "const") {
                users.entry(text(get(n, "const")).into()).or_default().push(name.into());
            }
            for k in ["union", "intersection", "difference"] {
                pending.extend(list(get(n, k)));
            }
        }
    }
    let mut queue: Vec<_> = patterns.iter().cloned().collect();
    let mut i = 0;
    while i < queue.len() {
        for user in users.get(&queue[i]).into_iter().flatten() {
            if patterns.insert(user.clone()) {
                queue.push(user.clone());
            }
        }
        i += 1;
    }
    patterns
}
