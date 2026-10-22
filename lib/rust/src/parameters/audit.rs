//! Template and instance records for the grammar audit (design §8).
use super::expand::{Instance, Records};
use super::*;
use std::collections::{BTreeMap, BTreeSet};
fn site(path: &str, a: (usize, usize)) -> Json {
    obj([("document", string(path)), ("line", Json::Int(a.0 as i64)), ("column", Json::Int(a.1 as i64))])
}
fn aliases(a: &Json, b: &Json, names: &BTreeMap<&str, &Instance>) -> bool {
    if let Some(i) = names.get(text(get(a, "rule"))).filter(|_| has(b, "call")) {
        return i.key == identity(&normalize(b)).to_json();
    }
    if let Some(i) = names.get(text(get(b, "rule"))).filter(|_| has(a, "call")) {
        return i.key == identity(&normalize(a)).to_json();
    }
    match (a, b) {
        (Json::Obj(a), Json::Obj(b)) => {
            let a: BTreeMap<_, _> = a.iter().filter(|(k, _)| k != "at" && k != SOURCE).map(|(k, v)| (k, v)).collect();
            let b: BTreeMap<_, _> = b.iter().filter(|(k, _)| k != "at" && k != SOURCE).map(|(k, v)| (k, v)).collect();
            a.len() == b.len() && a.iter().all(|(k, v)| b.get(k).is_some_and(|other| aliases(v, other, names)))
        }
        (Json::Arr(a), Json::Arr(b)) => a.len() == b.len() && a.iter().zip(b).all(|(a, b)| aliases(a, b, names)),
        _ => a == b,
    }
}
impl Records {
    #[allow(dead_code)] // Native audit consumers use the same records as the JavaScript audit.
    pub(crate) fn audit(&self, order: &[String]) -> Json {
        let mut instances: Vec<_> = self.instances.iter().collect();
        instances.sort_by_key(|i| order.iter().position(|n| n == i.effective()));
        let names: BTreeMap<_, _> =
            instances.iter().filter_map(|i| i.name.as_ref().map(|n| (n.as_str(), *i))).collect();
        let templates = self
            .templates
            .iter()
            .map(|t| {
                let start = t.events.iter().rposition(|e| text(get(&e.rule, "op")) != "extend").unwrap_or(0);
                let mut used = BTreeSet::new();
                for e in &t.events[start..] {
                    let ps = list(get(&e.rule, "params"));
                    for n in nodes(&e.rule) {
                        if let Some(i) = ps.iter().position(|p| p == get(n, "param")) {
                            used.insert(i);
                        }
                    }
                }
                let parameters = list(get(&t.events[0].rule, "params"));
                let mut notes: Vec<_> = parameters
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| !used.contains(i))
                    .map(|(_, p)| obj([("kind", string("unused-parameter")), ("parameter", p.clone())]))
                    .collect();
                if !instances.iter().any(|i| text(get(&i.call, "call")) == t.name) {
                    notes.push(obj([("kind", string("uncalled-template"))]))
                }
                let mut r = site(&t.path, t.at);
                set(&mut r, "template", string(&t.name));
                set(&mut r, "parameters", Json::Arr(parameters.to_vec()));
                set(&mut r, "notes", Json::Arr(notes));
                r
            })
            .collect();
        let instances = instances
            .iter()
            .map(|i| {
                let t = self.templates.iter().find(|t| t.name == text(get(&i.call, "call"))).unwrap();
                let indices: BTreeSet<_> = t.events.iter().map(|e| e.index).collect();
                let mut flags = Json::Arr(Vec::new());
                let events = i
                    .definitions
                    .iter()
                    .map(|e| {
                        let before = flags.clone();
                        if text(get(&e.rule, "op")) != "extend" {
                            flags = get(&e.rule, "flags").clone()
                        }
                        let mut r = site(&e.path, at(&e.rule).unwrap());
                        set(&mut r, "scope", string(if indices.contains(&e.index) { "template" } else { "instance" }));
                        set(&mut r, "op", get(&e.rule, "op").clone());
                        set(&mut r, "flagsBefore", before);
                        set(&mut r, "flagsAfter", flags.clone());
                        r
                    })
                    .collect();
                let twins: Vec<_> = self
                    .instances
                    .iter()
                    .filter(|other| {
                        other.key != i.key
                            && get(&other.call, "call") == get(&i.call, "call")
                            && aliases(get(&other.call, "args"), get(&i.call, "args"), &names)
                    })
                    .map(|i| string(i.effective()))
                    .collect();
                let notes = if twins.is_empty() {
                    Vec::new()
                } else {
                    vec![obj([("kind", string("argument-alias-twin")), ("instances", Json::Arr(twins))])]
                };
                obj([
                    ("template", get(&i.call, "call").clone()),
                    ("arguments", identity(get(&i.call, "args"))),
                    ("name", string(i.effective())),
                    ("binding", i.binding.clone()),
                    ("firstCall", site(text(get(&i.origin, "document")), at(&i.origin).unwrap())),
                    ("flags", flags),
                    ("events", Json::Arr(events)),
                    ("notes", Json::Arr(notes)),
                ])
            })
            .collect();
        obj([("templates", Json::Arr(templates)), ("instances", Json::Arr(instances))])
    }
}
