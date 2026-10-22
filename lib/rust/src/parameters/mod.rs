//! Source nodes for parameterized rules (engine §2.3).
use crate::dom::{self, Dom};
use crate::json::Json;
use crate::unicode::Unicode;

mod audit;
pub(crate) mod expand;
pub(crate) mod locations;
mod print;
mod schema;
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
pub(crate) fn nodes(root: &Json) -> impl Iterator<Item = &Json> {
    struct Nodes<'a>(Vec<&'a Json>);
    impl<'a> Iterator for Nodes<'a> {
        type Item = &'a Json;
        fn next(&mut self) -> Option<Self::Item> {
            while let Some(n) = self.0.pop() {
                match n {
                    Json::Obj(fields) => {
                        self.0.extend(fields.iter().rev().filter(|(k, _)| k != "at" && k != SOURCE).map(|(_, v)| v));
                        return Some(n);
                    }
                    Json::Arr(items) => self.0.extend(items.iter().rev()),
                    _ => (),
                }
            }
            None
        }
    }
    Nodes(vec![root])
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
pub(crate) fn joined(key: &str, items: Vec<Json>) -> Json {
    let mut values = Vec::new();
    for mut item in items {
        if ["union", "concat", "any", "all"].contains(&key) && has(&item, key) {
            if let Json::Obj(ref mut fields) = item {
                let i = fields.iter().position(|(k, _)| k == key).unwrap();
                if let Json::Arr(xs) = &mut fields.remove(i).1 {
                    values.append(xs);
                }
            }
        } else {
            values.push(item)
        }
    }
    obj([(key, Json::Arr(values))])
}
pub(crate) fn normalize(root: &Json) -> Json {
    map_nodes(root, |mut value| {
        if let Some(body) = value.get("body") {
            return argument(body.clone());
        }
        for k in ["union", "concat", "any", "all"] {
            if let Some(xs) = value.get(k).and_then(Json::as_array) {
                let j = joined(k, xs.to_vec());
                set(&mut value, k, get(&j, k).clone());
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
            &["call", "args"]
        } else if has(&n, "method") {
            &["method", "receiver", "args"]
        } else if has(&n, "guards") {
            &["guards", "expr", "tags", "value", "image"]
        } else if has(&n, "test") {
            &["test", "expr", "value", "requirements"]
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
pub(crate) fn append(dom: &mut Dom, kind: &str, r: Json) -> Result<(), String> {
    let at = at(&r).ok_or("a declaration requires a position")?;
    match kind {
        "rules" | "rule" => dom.rules.push(dom::RuleDef {
            deferred_emission: None,
            name: text(get(&r, "name")).into(),
            op: match text(get(&r, "op")) {
                "extend" => dom::Op::Extend,
                "redefine" => dom::Op::Redefine,
                _ => dom::Op::Define,
            },
            flags: list(get(&r, "flags")).iter().map(|n| text(n).into()).collect(),
            tags: None,
            strings: Default::default(),
            alternatives: Vec::new(),
            emit: None,
            conditions: Vec::new(),
            erased: false,
            at,
        }),
        "constants" | "constant-definition" => dom.constants.push(dom::ConstDef {
            name: text(get(&r, "name")).into(),
            redefine: text(get(&r, "op")) == "redefine",
            value: dom::Term::EmptySet,
            at,
        }),
        "directives" | "directive" => dom.directives.push(dom::Directive {
            name: text(get(&r, "name")).into(),
            args: list(get(&r, "args"))
                .iter()
                .map(|s| s.as_str().map(str::to_owned).ok_or("a malformed directive".into()))
                .collect::<Result<_, String>>()?,
            conditions: if has(&r, "conditions") { Some(Vec::new()) } else { None },
            at,
        }),
        "implications" | "implication-declaration" => dom.implications.push(dom::ImplicationDef {
            antecedent: dom::Term::EmptySet,
            consequent: dom::Term::EmptySet,
            at,
        }),
        _ => return Err("an unexpected unresolved declaration".into()),
    }
    dom.unresolved.insert(at, r);
    Ok(())
}
pub(crate) fn decode(value: &Json, unicode: &Unicode, defer: bool) -> Result<Dom, String> {
    schema::problem(value, unicode).map_or(Ok(()), |s| Err(s.to_string()))?;
    let mut closed = value.clone();
    let mut out = Dom::default();
    for kind in KINDS {
        let mut ordinary = Vec::new();
        for r in list(get(value, kind)) {
            if unresolved(r) {
                append(&mut out, kind, r.clone())?
            } else {
                ordinary.push(r.clone())
            }
        }
        set(&mut closed, kind, Json::Arr(ordinary));
    }
    let d = dom::dom_from_json_mode(&closed, unicode, defer)?;
    out.rules.extend(d.rules);
    out.constants.extend(d.constants);
    out.directives.extend(d.directives);
    out.classifiers = d.classifiers;
    out.implications.extend(d.implications);
    out.rules.sort_by_key(|r| r.at);
    out.constants.sort_by_key(|r| r.at);
    out.directives.sort_by_key(|r| r.at);
    out.implications.sort_by_key(|r| r.at);
    Ok(out)
}
pub(crate) fn problem(value: &Json, unicode: &Unicode) -> Option<&'static str> {
    schema::problem(value, unicode)
}

pub(crate) use schema::declaration as declaration_problem;

pub(crate) fn source_depth_problem(n: &Json, kind: &str, unicode: &Unicode) -> bool {
    schema::node(n, kind, 0, true, false, unicode) == Some("nested too deeply")
}
