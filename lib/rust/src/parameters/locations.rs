//! Private source annotations survive substitution but never enter keys or JSON.
use super::*;
use std::collections::BTreeMap;
pub(crate) fn source_at(n: &Json) -> Option<(usize, usize)> {
    let s = get(n, SOURCE);
    at(s)
        .or_else(|| match s.as_array() {
            Some([Json::Int(a), Json::Int(b)]) if *a > 0 && *b > 0 => Some((*a as usize, *b as usize)),
            _ => None,
        })
        .or_else(|| at(n))
}
fn ranked_at(n: &Json) -> Option<(usize, usize)> {
    at(&obj([("at", get(get(n, SOURCE), "ranked").clone())]))
}
fn record_rank(n: &mut Json, a: (usize, usize)) {
    let mut s = if get(n, SOURCE).as_object().is_some() {
        get(n, SOURCE).clone()
    } else {
        obj([("at", source_at(n).map_or(Json::Null, position))])
    };
    set(&mut s, "ranked", position(a));
    set(n, SOURCE, s);
}
fn visit(n: &mut Json, separators: &[(usize, usize)], index: &mut usize) {
    if has(n, "ranked") {
        let mut xs = list(get(n, "ranked")).to_vec();
        if let Some(first) = xs.first_mut() {
            visit(first, separators, index)
        }
        if let Some(a) = separators.get(*index) {
            record_rank(n, *a)
        }
        for x in xs.iter_mut().skip(1) {
            *index += 1;
            visit(x, separators, index)
        }
        set(n, "ranked", Json::Arr(xs));
        return;
    }
    if has(n, "alternatives") {
        if has(n, "args") {
            let mut args = get(n, "args").clone();
            visit(&mut args, separators, index);
            set(n, "args", args)
        }
        let mut alts = list(get(n, "alternatives")).to_vec();
        for (i, alt) in alts.iter_mut().enumerate() {
            for k in ["expr", "tags", "value", "image"] {
                if let Some(v) = alt.get(k) {
                    let mut v = v.clone();
                    visit(&mut v, separators, index);
                    set(alt, k, v)
                }
            }
            if i == 0 {
                for k in ["tags", "value", "image", "conditions", "emit"] {
                    if let Some(v) = n.get(k) {
                        let mut v = v.clone();
                        visit(&mut v, separators, index);
                        set(n, k, v)
                    }
                }
            }
        }
        set(n, "alternatives", Json::Arr(alts));
        return;
    }
    match n {
        Json::Arr(xs) => {
            for x in xs {
                visit(x, separators, index)
            }
        }
        Json::Obj(fs) => {
            for (k, v) in fs {
                if k != "at" && k != SOURCE {
                    visit(v, separators, index)
                }
            }
        }
        _ => (),
    }
}
pub(crate) fn recover(
    dom: &mut Dom,
    tokens: &[crate::result::Token],
    position_: &dyn Fn(usize) -> (usize, usize),
) -> bool {
    if dom.unresolved.is_empty() {
        return false;
    }
    let separators: Vec<_> = tokens.iter().filter(|t| t.value == "≻").map(|t| position_(t.source.start)).collect();
    let mut index = 0;
    let mut raw = crate::json::parse(&dom::dom_to_json(dom)).expect("a DOM writer produces JSON");
    for k in KINDS {
        let rs = list(get(&raw, k))
            .iter()
            .map(|r| dom.unresolved.get(&at(r).unwrap()).cloned().unwrap_or_else(|| r.clone()))
            .collect();
        set(&mut raw, k, Json::Arr(rs));
    }
    let mut declarations: Vec<_> =
        KINDS.into_iter().flat_map(|k| list(get(&raw, k)).iter().map(move |r| (k, r.clone()))).collect();
    declarations.sort_by_key(|(_, r)| at(r));
    for (kind, mut r) in declarations {
        visit(&mut r, &separators, &mut index);
        let a = at(&r).unwrap();
        if let Some(slot) = dom.unresolved.get_mut(&a) {
            *slot = r
        } else if kind == "rules" {
            if let Some(rule) = dom.rules.iter_mut().find(|rule| rule.at == a) {
                restore_rule(rule, &r)
            }
        }
    }
    true
}
fn expression(n: &Json, path: String, locations: &mut BTreeMap<String, (usize, usize)>) {
    if let Some(a) = ranked_at(n) {
        locations.insert(path.clone(), a);
    }
    for k in ["seq", "choice", "ranked", "and"] {
        for (i, v) in list(get(n, k)).iter().enumerate() {
            expression(v, format!("{path}/{k}/{i}"), locations)
        }
    }
    for k in ["optional", "repeat", "separator", "expr"] {
        if let Some(v) = n.get(k) {
            expression(v, format!("{path}/{k}"), locations)
        }
    }
}
fn channels(channels: &mut dom::Channels, n: &Json) {
    channels.value_at = n.get("value").and_then(source_at);
    channels.image_at = n.get("image").and_then(source_at);
}
fn term(t: &mut dom::Term, n: &Json) {
    use dom::{Arg, Term};
    match t {
        Term::Union(xs) | Term::Intersection(xs) => {
            let key = if has(n, "union") { "union" } else { "intersection" };
            for (t, n) in xs.iter_mut().zip(list(get(n, key))) {
                term(t, n)
            }
        }
        Term::Difference(a, b) => {
            let xs = list(get(n, "difference"));
            if xs.len() == 2 {
                term(a, &xs[0]);
                term(b, &xs[1])
            }
        }
        Term::If(c, t) => {
            cond(c, get(n, "if"));
            term(t, get(n, "then"))
        }
        Term::Call(_, args) => {
            if let Some(Arg::Term(receiver)) = args.first_mut() {
                term(receiver, get(n, "receiver"))
            }
            for (a, n) in args.iter_mut().skip(1).zip(list(get(n, "args"))) {
                if let Arg::Term(t) = a {
                    term(t, n)
                }
            }
        }
        _ => (),
    }
}
fn cond(c: &mut dom::Cond, n: &Json) {
    use dom::Cond;
    match c {
        Cond::Boundary(_, receiver, _, location) => {
            location.at = source_at(n);
            location.targets = list(get(n, "args")).iter().filter_map(source_at).collect();
            term(receiver, get(n, "receiver"))
        }
        Cond::Compare(_, a, b) => {
            term(a, get(n, "left"));
            term(b, get(n, "right"))
        }
        Cond::Matches(r, _) | Cond::Begins(r, _) | Cond::Initial(r) | Cond::Final(r) => term(r, get(n, "receiver")),
        Cond::If(a, b) => {
            cond(a, get(n, "if"));
            cond(b, get(n, "then"))
        }
        Cond::Not(c) => cond(c, get(n, "not")),
        Cond::Any(xs) | Cond::All(xs) => {
            let k = if has(n, "any") { "any" } else { "all" };
            for (c, n) in xs.iter_mut().zip(list(get(n, k))) {
                cond(c, n)
            }
        }
        _ => (),
    }
}
pub(crate) fn restore_rule(rule: &mut dom::RuleDef, n: &Json) {
    channels(&mut rule.strings, n);
    for (alt, n) in rule.alternatives.iter_mut().zip(list(get(n, "alternatives"))) {
        expression(get(n, "expr"), String::new(), &mut alt.ranked_locations);
        channels(&mut alt.strings, n);
        if let Some(t) = &mut alt.tags {
            term(t, get(n, "tags"))
        }
    }
    if let Some(t) = &mut rule.tags {
        term(t, get(n, "tags"))
    }
    for (c, n) in rule.conditions.iter_mut().zip(list(get(n, "conditions"))) {
        cond(c, n)
    }
}
