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
        Cond::Matches(r, _) | Cond::Begins(r, _) | Cond::Ends(r, _) | Cond::Initial(r) | Cond::Final(r) => {
            term(r, get(n, "receiver"))
        }
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
    if let Some(items) = &mut rule.emit {
        for (item, n) in items.iter_mut().zip(list(get(get(n, "emit"), "items"))) {
            let (tags, strings) = match item {
                dom::EmitItem::Capture(_, tags, a) => (tags, &mut a.strings),
                dom::EmitItem::Insert(tags, s) => (tags, s),
            };
            channels(strings, n);
            if let Some(t) = tags {
                term(t, get(n, "tags"))
            }
        }
    }
}

fn locate(n: &mut Json, a: Option<(usize, usize)>) {
    if let Some(a) = a {
        if !has(n, SOURCE) {
            set(n, SOURCE, position(a))
        }
    }
}
fn slot<'a>(n: &'a mut Json, key: &str) -> Option<&'a mut Json> {
    match n {
        Json::Obj(fs) => fs.iter_mut().find(|(k, _)| k == key).map(|(_, v)| v),
        Json::Arr(xs) => key.parse::<usize>().ok().and_then(|i| xs.get_mut(i)),
        _ => None,
    }
}
fn annotate_term(t: &dom::Term, n: &mut Json) {
    use dom::{Arg, Term};
    match t {
        Term::If(c, t) => {
            if let Some(v) = slot(n, "if") {
                annotate_condition(c, v)
            }
            if let Some(v) = slot(n, "then") {
                annotate_term(t, v)
            }
        }
        Term::Union(xs) | Term::Intersection(xs) => {
            let k = if has(n, "union") { "union" } else { "intersection" };
            if let Some(Json::Arr(values)) = slot(n, k) {
                for (t, n) in xs.iter().zip(values) {
                    annotate_term(t, n)
                }
            }
        }
        Term::Difference(a, b) => {
            if let Some(Json::Arr(xs)) = slot(n, "difference") {
                if xs.len() == 2 {
                    annotate_term(a, &mut xs[0]);
                    annotate_term(b, &mut xs[1])
                }
            }
        }
        Term::Call(name, args) => {
            if name == "concat" {
                if let Some(Json::Arr(xs)) = slot(n, "concat") {
                    for (a, n) in args.iter().zip(xs) {
                        if let Arg::Term(t) = a {
                            annotate_term(t, n)
                        }
                    }
                }
            } else {
                if let Some(Arg::Term(r)) = args.first() {
                    if let Some(n) = slot(n, "receiver") {
                        annotate_term(r, n)
                    }
                }
                if let Some(Json::Arr(xs)) = slot(n, "args") {
                    for (a, n) in args.iter().skip(1).zip(xs) {
                        if let Arg::Term(t) = a {
                            annotate_term(t, n)
                        }
                    }
                }
            }
        }
        _ => (),
    }
}
pub(crate) fn annotate_condition(c: &dom::Cond, n: &mut Json) {
    use dom::Cond;
    match c {
        Cond::Boundary(_, receiver, _, location) => {
            locate(n, location.at);
            if let Some(v) = slot(n, "receiver") {
                annotate_term(receiver, v)
            }
            if let Some(Json::Arr(xs)) = slot(n, "args") {
                for (n, a) in xs.iter_mut().zip(&location.targets) {
                    locate(n, Some(*a))
                }
            }
        }
        Cond::Compare(_, a, b) => {
            if let Some(n) = slot(n, "left") {
                annotate_term(a, n)
            }
            if let Some(n) = slot(n, "right") {
                annotate_term(b, n)
            }
        }
        Cond::Matches(r, _) | Cond::Begins(r, _) | Cond::Ends(r, _) | Cond::Initial(r) | Cond::Final(r) => {
            if let Some(n) = slot(n, "receiver") {
                annotate_term(r, n)
            }
        }
        Cond::If(a, b) => {
            if let Some(n) = slot(n, "if") {
                annotate_condition(a, n)
            }
            if let Some(n) = slot(n, "then") {
                annotate_condition(b, n)
            }
        }
        Cond::Not(c) => {
            if let Some(n) = slot(n, "not") {
                annotate_condition(c, n)
            }
        }
        Cond::Any(cs) | Cond::All(cs) => {
            let k = if has(n, "any") { "any" } else { "all" };
            if let Some(Json::Arr(xs)) = slot(n, k) {
                for (c, n) in cs.iter().zip(xs) {
                    annotate_condition(c, n)
                }
            }
        }
        _ => (),
    }
}
fn annotate_channels(c: &dom::Channels, n: &mut Json) {
    if let Some(v) = slot(n, "value") {
        locate(v, c.value_at)
    }
    if let Some(v) = slot(n, "image") {
        locate(v, c.image_at)
    }
}
fn annotate_rule(rule: &dom::RuleDef, n: &mut Json) {
    annotate_channels(&rule.strings, n);
    if let Some(t) = &rule.tags {
        if let Some(n) = slot(n, "tags") {
            annotate_term(t, n)
        }
    }
    if let Some(Json::Arr(alts)) = slot(n, "alternatives") {
        for (alt, n) in rule.alternatives.iter().zip(alts) {
            annotate_channels(&alt.strings, n);
            if let Some(t) = &alt.tags {
                if let Some(n) = slot(n, "tags") {
                    annotate_term(t, n)
                }
            }
            for (path, a) in &alt.ranked_locations {
                if let Some(n) = slot(n, "expr").and_then(|n| path_slot(n, path)) {
                    record_rank(n, *a)
                }
            }
        }
    }
    if let Some(Json::Arr(cs)) = slot(n, "conditions") {
        for (c, n) in rule.conditions.iter().zip(cs) {
            annotate_condition(c, n)
        }
    }
    if let (Some(items), Some(Json::Arr(xs))) = (&rule.emit, slot(n, "emit").and_then(|n| slot(n, "items"))) {
        for (item, n) in items.iter().zip(xs) {
            let (tags, strings) = match item {
                dom::EmitItem::Capture(_, tags, a) => (tags, &a.strings),
                dom::EmitItem::Insert(tags, s) => (tags, s),
            };
            annotate_channels(strings, n);
            if let (Some(t), Some(n)) = (tags, slot(n, "tags")) {
                annotate_term(t, n)
            }
        }
    }
}
pub(crate) fn annotate_document(raw: &mut Json, dom: &Dom) {
    if let Some(Json::Arr(rules)) = slot(raw, "rules") {
        for (rule, n) in dom.rules.iter().zip(rules) {
            if !dom.unresolved.contains_key(&rule.at) {
                annotate_rule(rule, n)
            }
        }
    }
    if let Some(Json::Arr(ds)) = slot(raw, "directives") {
        for (d, n) in dom.directives.iter().zip(ds) {
            if let (Some(cs), Some(Json::Arr(xs))) = (&d.conditions, slot(n, "conditions")) {
                for (c, n) in cs.iter().zip(xs) {
                    annotate_condition(c, n)
                }
            }
        }
    }
}

fn path_slot<'a>(mut n: &'a mut Json, path: &str) -> Option<&'a mut Json> {
    for key in path.split('/').filter(|s| !s.is_empty()) {
        n = slot(n, key)?
    }
    Some(n)
}

pub(crate) fn restore_document(dom: &mut Dom, raw: &Json) {
    for (r, n) in dom.rules.iter_mut().zip(list(get(raw, "rules"))) {
        restore_rule(r, n)
    }
    for (d, n) in dom.directives.iter_mut().zip(list(get(raw, "directives"))) {
        if let Some(cs) = &mut d.conditions {
            for (c, n) in cs.iter_mut().zip(list(get(n, "conditions"))) {
                cond(c, n)
            }
        }
    }
}
