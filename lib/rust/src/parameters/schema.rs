//! Validate unresolved source nodes before instance discovery.
use super::*;
use crate::dom::schema::{parts_problem, Part};
use crate::tags::is_name;
use std::collections::BTreeSet;

fn only(n: &Json, keys: &[&str]) -> bool {
    n.as_object().is_some_and(|fs| {
        fs.iter().all(|(k, _)| k == SOURCE || keys.contains(&k.as_str())) && keys.iter().all(|k| has(n, k))
    })
}
fn allowed(n: &Json, keys: &[&str]) -> bool {
    n.as_object().is_some_and(|fs| fs.iter().all(|(k, _)| k == SOURCE || keys.contains(&k.as_str())))
}
fn array(n: &Json, k: &str, min: usize) -> bool {
    get(n, k).as_array().is_some_and(|xs| xs.len() >= min)
}
fn parameter(s: &str) -> bool {
    s.starts_with(|c: char| c.is_ascii_alphabetic())
        && s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}
fn named(n: &Json, uni: &Unicode) -> bool {
    n.as_str().is_some_and(|s| uni.is_emoji_name(s) || s.starts_with(|c: char| c.is_ascii_lowercase()) && is_name(s))
}
fn user_tag(n: &Json) -> bool {
    n.as_str().is_some_and(|s| s.starts_with(|c: char| c.is_ascii_uppercase()) && is_name(s))
}
fn closed(n: &Json) -> Option<&'static str> {
    if nodes(n).any(|n| has(n, "capture") || has(n, "captured") || text(get(n, "tag")).starts_with('_')) {
        Some("a closed declaration requires a closed term without engine-tag literals")
    } else {
        None
    }
}
fn introduced_tags(root: &Json) -> BTreeSet<String> {
    let mut pending = vec![(root, false)];
    let mut values: Vec<BTreeSet<String>> = Vec::new();
    while let Some((n, ready)) = pending.pop() {
        let operation = ["union", "intersection", "difference"].into_iter().find(|key| has(n, key));
        if let Some(operation) = operation {
            let items = list(get(n, operation));
            if !ready {
                pending.push((n, true));
                pending.extend(items.iter().rev().map(|item| (item, false)));
            } else {
                let mut parts = values.split_off(values.len() - items.len()).into_iter();
                let mut result = parts.next().unwrap_or_default();
                match operation {
                    "union" => {
                        for part in parts {
                            result.extend(part);
                        }
                    }
                    "intersection" => {
                        for part in parts {
                            result.retain(|tag| part.contains(tag));
                        }
                    }
                    _ => (),
                }
                values.push(result);
            }
        } else if has(n, "if") {
            pending.push((get(n, "then"), false));
        } else {
            let tag = text(get(n, "tag"));
            values.push(if crate::dom::schema::engine_tag(tag) {
                BTreeSet::from([tag.to_string()])
            } else {
                BTreeSet::new()
            });
        }
    }
    values.pop().unwrap_or_default()
}

fn tag_clause(n: &Json, own: bool) -> Option<&'static str> {
    if !introduced_tags(n).is_empty() {
        return Some("a tag clause introduces an engine tag");
    }
    let mut pending = vec![n];
    while let Some(n) = pending.pop() {
        match n {
            Json::Arr(xs) => pending.extend(xs),
            Json::Obj(fs) => {
                if has(n, "pattern") {
                    continue;
                }
                if own
                    && matches!(text(get(n, "method")), "tags" | "classes")
                    && get(get(n, "receiver"), "capture").as_str() == Some("")
                {
                    return Some("a constituent's tags cannot read its own tags");
                }
                pending.extend(fs.iter().filter(|(k, _)| k != "at" && k != SOURCE).map(|(_, v)| v));
            }
            _ => (),
        }
    }
    None
}
fn clauses(n: &Json, uni: &Unicode) -> Option<&'static str> {
    for k in ["tags", "value", "image"] {
        if let Some(v) = n.get(k) {
            if k == "tags" {
                if let Some(p) = tag_clause(v, !has(n, "capture") && !has(n, "insert")) {
                    return Some(p);
                }
            }
            if let Some(p) = node(v, if k == "tags" { "term" } else { "recipe" }, 0, false, false, uni) {
                return Some(p);
            }
        }
    }
    None
}
pub(super) fn problem(root: &Json, uni: &Unicode) -> Option<&'static str> {
    if nodes(root).any(|n| has(n, SOURCE)) {
        return Some("a private source annotation in a supplied DOM");
    }
    if get(root, "format").as_int() != Some(dom::DOM_FORMAT) {
        return Some("not a DOM of this format");
    }
    let mut positions = BTreeSet::new();
    let mut ordinary = root.clone();
    for kind in KINDS {
        let Some(items) = get(root, kind).as_array() else { return Some("missing declaration array") };
        let mut closed = Vec::new();
        for r in items {
            let Some(p) = at(r) else { return Some("a malformed declaration position") };
            if !positions.insert(p) {
                return Some("two items at one position");
            }
            if unresolved(r) {
                if let Some(p) = declaration(r, kind, uni) {
                    return Some(p);
                }
            } else {
                closed.push(r.clone())
            }
        }
        set(&mut ordinary, kind, Json::Arr(closed));
    }
    dom::schema::names_problem(root).or_else(|| dom::schema::problem(&ordinary, uni))
}
pub(crate) fn declaration(r: &Json, kind: &str, uni: &Unicode) -> Option<&'static str> {
    let mut scope = BTreeSet::new();
    if kind == "rules" {
        if !named(get(r, "name"), uni) || !matches!(text(get(r, "op")), "define" | "redefine" | "extend") {
            return Some("a malformed rule");
        }
        if let Some(params) = r.get("params") {
            let Some(ps) = params.as_array().filter(|ps| !ps.is_empty()) else {
                return Some("malformed template parameters");
            };
            if has(r, "args") {
                return Some("malformed template parameters");
            }
            for p in ps {
                let Some(s) = p.as_str().filter(|s| parameter(s)) else { return Some("malformed template parameters") };
                if !scope.insert(s) {
                    return Some("malformed template parameters");
                }
            }
        }
    }
    for n in nodes(r) {
        if let Some(p) = n.get("param") {
            if !allowed(n, &["param", "at", "exact", "children"]) || at(n).is_none() || !scope.contains(text(p)) {
                return Some("an undeclared or malformed parameter");
            }
        }
    }
    match kind {
        "rules" => {
            let Some(flags) = get(r, "flags").as_array() else { return Some("a malformed rule flag list") };
            if flags.len() > 1
                || flags.len() == 1
                    && (!matches!(text(&flags[0]), "fewest" | "leftmost-longest") || text(get(r, "op")) == "extend")
            {
                return Some("a malformed rule flag list");
            }
            if let Some(call) = r.get("instance") {
                if !only(r, &["name", "op", "flags", "instance", "conditions", "at"])
                    || text(get(r, "op")) == "extend"
                    || !flags.is_empty()
                    || !array(r, "conditions", 0)
                    || !list(get(r, "conditions")).is_empty()
                {
                    return Some("a malformed instance binding");
                }
                return node(call, "call", 0, false, false, uni);
            }
            if let Some(args) = r.get("args") {
                if text(get(r, "op")) == "define" {
                    return Some("an instance head requires an edit");
                }
                if let Some(p) = node(
                    &obj([("call", get(r, "name").clone()), ("args", args.clone()), ("at", get(r, "at").clone())]),
                    "call",
                    0,
                    false,
                    false,
                    uni,
                ) {
                    return Some(p);
                }
            }
            if !allowed(
                r,
                &[
                    "name",
                    "params",
                    "args",
                    "op",
                    "flags",
                    "tags",
                    "value",
                    "image",
                    "alternatives",
                    "emit",
                    "conditions",
                    "erased",
                    "at",
                ],
            ) || !array(r, "alternatives", 1)
                || !array(r, "conditions", 0)
            {
                return Some("a malformed rule");
            }
            if has(r, "erased")
                && (get(r, "erased") != &Json::Bool(true) || ["emit", "value", "image"].iter().any(|k| has(r, k)))
            {
                return Some("a malformed erased rule");
            }
            if let Some(p) = clauses(r, uni) {
                return Some(p);
            }
            for c in list(get(r, "conditions")) {
                if let Some(p) = node(c, "condition", 0, false, false, uni) {
                    return Some(p);
                }
            }
            for alt in list(get(r, "alternatives")) {
                if !allowed(alt, &["guards", "expr", "tags", "value", "image"]) || !array(alt, "guards", 0) {
                    return Some("a malformed alternative");
                }
                for g in list(get(alt, "guards")) {
                    let feature = text(get(g, "feature"));
                    if !only(g, &["feature", "kind", "negated"])
                        || !feature.starts_with(|c: char| c.is_ascii_alphabetic())
                        || !feature.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
                        || !matches!(get(g, "negated"), Json::Bool(_))
                        || !matches!(text(get(g, "kind")), "gate" | "warning")
                        || text(get(g, "kind")) == "warning" && get(g, "negated") != &Json::Bool(false)
                    {
                        return Some("a malformed guard");
                    }
                }
                if let Some(p) = node(get(alt, "expr"), "expr", 0, true, false, uni) {
                    return Some(p);
                }
                if !crate::clauses::duplicate_captures(&capture_shape(get(alt, "expr"))).is_empty() {
                    return Some("a capture name used twice in one production");
                }
                if get(r, "erased") == &Json::Bool(true) && (has(alt, "value") || has(alt, "image")) {
                    return Some("an erased rule has a recipe");
                }
                if let Some(p) = clauses(alt, uni) {
                    return Some(p);
                }
            }
            if let Some(emit) = r.get("emit") {
                if !only(emit, &["items"]) || !array(emit, "items", 1) {
                    return Some("a malformed emission");
                }
                let mut names = BTreeSet::new();
                for item in list(get(emit, "items")) {
                    if !allowed(item, &["capture", "insert", "tags", "value", "image", "before", "after"]) {
                        return Some("a malformed emission item");
                    }
                    if has(item, "insert") {
                        if get(item, "insert") != &Json::Bool(true)
                            || ["capture", "before", "after"].iter().any(|k| has(item, k))
                        {
                            return Some("a malformed insertion");
                        }
                    } else if !get(item, "capture").as_str().is_some_and(|s| s.is_empty() || dom::is_capture_name(s)) {
                        return Some("a malformed carrier");
                    }
                    for k in ["before", "after"] {
                        if has(item, k) {
                            if text(get(item, "capture")).is_empty() || !array(item, k, 1) {
                                return Some("a malformed attachment");
                            }
                            for name in list(get(item, k)) {
                                if !name.as_str().is_some_and(dom::is_capture_name) || !names.insert(text(name)) {
                                    return Some("an emission lists a capture twice");
                                }
                            }
                        }
                    }
                    if let Some(s) = get(item, "capture").as_str().filter(|s| !s.is_empty()) {
                        if !names.insert(s) {
                            return Some("an emission lists a capture twice");
                        }
                    }
                    if let Some(p) = clauses(item, uni) {
                        return Some(p);
                    }
                }
            }
        }
        "constants" => {
            if !only(r, &["name", "op", "value", "at"])
                || !get(r, "name").as_str().is_some_and(dom::is_constant_name)
                || !matches!(text(get(r, "op")), "define" | "redefine")
            {
                return Some("a malformed constant");
            }
            if let Some(p) = closed(get(r, "value")) {
                return Some(p);
            }
            return node(get(r, "value"), "term", 0, false, false, uni);
        }
        "implications" => {
            if !only(r, &["if", "then", "at"]) {
                return Some("a malformed implication");
            }
            for k in ["if", "then"] {
                if let Some(p) = closed(get(r, k)) {
                    return Some(p);
                }
                if let Some(p) = node(get(r, k), "term", 0, false, false, uni) {
                    return Some(p);
                }
            }
        }
        "directives" => {
            if !allowed(r, &["name", "args", "at", "conditions"])
                || text(get(r, "name")) != "features"
                || !array(r, "conditions", 1)
                || !array(r, "args", 1)
                || list(get(r, "args")).iter().any(|a| a.as_str().is_none())
            {
                return Some("malformed feature conditions");
            }
            for c in list(get(r, "conditions")) {
                if let Some(p) = node(c, "condition", 0, false, false, uni) {
                    return Some(p);
                }
            }
        }
        _ => return Some("an unexpected unresolved declaration"),
    }
    None
}
fn query(name: &str) -> bool {
    ["matches", "begins", "starts-input", "ends-input", "followed-by", "preceded-by"].contains(&name)
}
fn bare_capture(n: &Json) -> bool {
    only(n, &["capture"]) && get(n, "capture").as_str().is_some_and(|s| s.is_empty() || dom::is_capture_name(s))
}
fn recipe_atom(n: &Json) -> bool {
    if has(n, "string") || has(n, "const") || has(n, "param") {
        return true;
    }
    let name = text(get(n, "method"));
    if !["value", "image", "source-text", "decomposed-source-text", "verbatim-text"].contains(&name)
        || !array(n, "args", 0)
        || !list(get(n, "args")).is_empty()
    {
        return false;
    }
    let receiver = get(n, "receiver");
    bare_capture(receiver)
        || ["value", "image"].contains(&name)
            && text(get(receiver, "method")) == "emitted"
            && list(get(receiver, "args")).is_empty()
            && bare_capture(get(receiver, "receiver"))
}
fn method_problem(n: &Json, recipe: bool, uni: &Unicode) -> Option<&'static str> {
    let name = text(get(n, "method"));
    let args = list(get(n, "args"));
    let receiver = get(n, "receiver");
    if receiver.as_object().is_none() {
        return Some("a malformed method receiver");
    }
    let bare = bare_capture(receiver) || has(receiver, "param") || has(receiver, "call");
    let span = bare
        || [
            "first-token",
            "tokens-after-first",
            "last-token",
            "onward",
            "following-tokens",
            "without-elision",
            "without-elision-except",
        ]
        .contains(&text(get(receiver, "method")));
    let rule = |a: &Json| only(a, &["rule"]) && named(get(a, "rule"), uni) || has(a, "param") || has(a, "call");
    let target = |a: &Json| rule(a) || only(a, &["terminal"]) && user_tag(get(a, "terminal"));
    let valid = match name {
        "ngrams" => {
            matches!(args,[a] if only(a,&["integer"]) && get(a,"integer").as_str().is_some_and(dom::valid_integer))
        }
        "split" => {
            matches!(args,[a] if a.as_object().is_some() && get(a,"string").as_str()!=Some("") && !["rule","terminal","classifier","integer"].iter().any(|k| has(a,k)))
        }
        "classify" => {
            matches!(args,[a] if only(a,&["classifier"]) && get(a,"classifier").as_str().is_some_and(dom::is_classifier_name))
        }
        "tags" => span && (args.is_empty() || matches!(args,[a] if rule(a))),
        "matches" | "begins" => span && !args.is_empty() && args.iter().all(target),
        "followed-by" | "preceded-by" => bare && !args.is_empty() && args.iter().all(target),
        "without-elision-except" => bare && matches!(args,[a] if rule(a)),
        "without-elision" => bare && args.is_empty(),
        "verbatim-text" | "emitted" => recipe && bare && args.is_empty(),
        "value"
        | "image"
        | "source-text"
        | "decomposed-source-text"
        | "classes"
        | "first-token"
        | "last-token"
        | "tokens-after-first"
        | "onward"
        | "following-tokens"
        | "starts-input"
        | "ends-input" => {
            args.is_empty()
                && (span || recipe && text(get(receiver, "method")) == "emitted" && ["value", "image"].contains(&name))
        }
        _ => return Some("unknown method name"),
    };
    if valid {
        None
    } else {
        Some("a method has the wrong receiver or arguments")
    }
}

type NodeTask<'a> = (&'a Json, &'a str, usize, bool, bool);
fn schedule<'a>(
    pending: &std::cell::RefCell<Vec<NodeTask<'a>>>,
    n: &'a Json,
    kind: &'a str,
    depth: usize,
    whole: bool,
    sealed: bool,
    _uni: &Unicode,
) -> Option<&'static str> {
    pending.borrow_mut().push((n, kind, depth, whole, sealed));
    None
}
pub(super) fn node(
    n: &Json,
    kind: &str,
    depth: usize,
    whole: bool,
    sealed: bool,
    uni: &Unicode,
) -> Option<&'static str> {
    let pending = std::cell::RefCell::new(vec![(n, kind, depth, whole, sealed)]);
    loop {
        let task = pending.borrow_mut().pop();
        let (n, kind, depth, whole, sealed) = task?;
        if let Some(p) = node_step(&pending, n, kind, depth, whole, sealed, uni) {
            return Some(p);
        }
    }
}
fn node_step<'a>(
    pending: &std::cell::RefCell<Vec<NodeTask<'a>>>,
    n: &'a Json,
    mut kind: &'a str,
    depth: usize,
    whole: bool,
    sealed: bool,
    uni: &Unicode,
) -> Option<&'static str> {
    if depth > dom::DOM_MAX_DEPTH {
        return Some("nested too deeply");
    }
    if n.as_object().is_none() {
        return Some("a malformed source node");
    }
    let walk = |v, k| schedule(pending, v, k, depth + 1, false, sealed, uni);
    let items = |key, k, min| -> Option<&'static str> {
        let Some(xs) = get(n, key).as_array().filter(|xs| xs.len() >= min) else {
            return Some("a malformed source list");
        };
        for v in xs {
            if let Some(p) = walk(v, k) {
                return Some(p);
            }
        }
        None
    };
    // Capture closure applies to every constructor, including nested calls.
    if kind == "arg" && nodes(n).any(|n| has(n, "capture") || has(n, "captured")) {
        return Some("an argument cannot read or declare captures");
    }
    if kind == "pattern" {
        let name = |name: &str| named(&Json::Str(name.into()), uni) && !user_tag(&Json::Str(name.into()));
        let term = |name: &str| user_tag(&Json::Str(name.into())) || crate::dom::schema::engine_tag(name);
        let inspect = crate::patterns::shapes::Inspection {
            name: Some(&name),
            terminal: Some(&term),
            depth,
            ..Default::default()
        };
        if let Some(problem) = crate::patterns::shapes::problem(&clean(n), &inspect) {
            return Some(if problem == "nested too deeply" { "nested too deeply" } else { "a malformed pattern" });
        }
        return schedule(pending, n, "pattern-part", depth, false, sealed, uni);
    }
    if kind == "pattern-part" {
        if has(n, "call") {
            for part in nodes(get(n, "args")) {
                if user_tag(get(part, "rule")) {
                    return Some("a pattern argument rule reads back as a tag");
                }
            }
            if let Some(p) = items("args", "arg", 1) {
                return Some(p);
            }
        }
        if let Some(v) = n.get("literal") {
            schedule(pending, v, "string", depth, false, sealed, uni);
        }
        if let Some(ends) = n.get("range").and_then(Json::as_array) {
            for v in ends {
                schedule(pending, v, "string", depth, false, sealed, uni);
            }
        }
        if text(get(n, "test")) == "tags" {
            for r in list(get(n, "requirements")) {
                walk(get(r, "value"), "term");
            }
        } else if has(n, "test") {
            walk(get(n, "value"), "string");
        }
        for key in ["expr", "pattern"] {
            if let Some(v) = n.get(key) {
                walk(v, "pattern-part");
            }
        }
        for key in ["union", "intersection", "difference"] {
            for v in list(get(n, key)) {
                walk(v, "pattern-part");
            }
        }
        for v in list(get(n, "children")) {
            walk(v, "pattern-item");
        }
        return None;
    }
    if kind == "pattern-item" {
        if let Some(v) = n.get("child") {
            walk(v, "pattern-part");
        }
        for key in ["optional", "repeat", "separator"] {
            for v in list(get(n, key)) {
                walk(v, "pattern-item");
            }
        }
        for arm in list(get(n, "choice")) {
            for v in list(arm) {
                walk(v, "pattern-item");
            }
        }
        return None;
    }
    // Unresolved leaves still obey the category of their position.
    if has(n, "param") {
        if !matches!(kind, "expr" | "arg" | "term" | "tags" | "string" | "target" | "pattern" | "recipe-atom") {
            return Some("a parameter in the wrong source category");
        }
        return if only(n, &["param", "at"]) && parameter(text(get(n, "param"))) && at(n).is_some() {
            None
        } else {
            Some("an undeclared or malformed parameter")
        };
    }
    if has(n, "call") || kind == "call" {
        if kind == "string" {
            return Some("a string operand requires a literal or constant");
        }
        if !matches!(kind, "expr" | "arg" | "term" | "tags" | "target" | "pattern" | "call") {
            return Some("a call in the wrong source category");
        }
        if !only(n, &["call", "args", "at"]) || !named(get(n, "call"), uni) || at(n).is_none() {
            return Some("a malformed call");
        }
        return items("args", "arg", 1);
    }
    if kind == "arg" {
        if has(n, "body") {
            if !only(n, &["body"]) {
                return Some("a malformed body argument");
            }
            return schedule(pending, get(n, "body"), "expr", depth, true, false, uni);
        }
        if has(n, "targets") {
            if !only(n, &["targets"]) {
                return Some("a malformed target choice");
            }
            if !array(n, "targets", 2) {
                return Some("a malformed target choice");
            }
            for v in list(get(n, "targets")) {
                schedule(pending, v, "target", depth, false, sealed, uni);
            }
            return None;
        }
        if has(n, "requirements") && !has(n, "test") {
            if !only(n, &["requirements"]) {
                return Some("a malformed requirement list");
            }
            return requirements(pending, get(n, "requirements"), depth, uni);
        }
        if has(n, "rule") {
            return if only(n, &["rule"]) && named(get(n, "rule"), uni) {
                None
            } else {
                Some("a malformed nominal rule argument")
            };
        }
        kind = if ["test", "range", "wildcard"].iter().any(|k| has(n, k)) { "expr" } else { "term" };
    }
    if kind == "target" {
        return if only(n, &["rule"]) && named(get(n, "rule"), uni)
            || only(n, &["terminal"]) && user_tag(get(n, "terminal"))
        {
            None
        } else {
            Some("a malformed query target")
        };
    }
    if kind == "recipe" {
        if !only(n, &["concat"]) || !array(n, "concat", 1) {
            return Some("a malformed recipe");
        }
        return items("concat", "recipe-atom", 1);
    }
    if kind == "recipe-atom" {
        if !recipe_atom(n) {
            return Some("a malformed recipe atom");
        }
        kind = "recipe-term";
    }
    let forms: &[&str] = match kind {
        "expr" => &[
            "seq", "choice", "ranked", "and", "optional", "repeat", "capture", "test", "literal", "range", "ref",
            "wildcard", "empty",
        ],
        "condition" => &["op", "not", "any", "all", "if", "captured", "method"],
        "string" => &["string", "const"],
        "term" | "recipe-term" => &[
            "string",
            "tag",
            "const",
            "emptySet",
            "capture",
            "concat",
            "union",
            "intersection",
            "difference",
            "if",
            "pattern",
            "method",
        ],
        "pattern" => &[
            "test",
            "literal",
            "range",
            "terminal",
            "constant",
            "name",
            "wildcard",
            "children",
            "union",
            "intersection",
            "difference",
            "path",
        ],
        "children" => &["node", "sequence", "optional", "repeat", "siblings"],
        _ => return Some("an unknown source category"),
    };
    if !forms.iter().any(|k| has(n, k)) {
        return Some(if kind == "term" { "a malformed term" } else { "a malformed source category" });
    }
    if !unresolved(n) {
        let part = match kind {
            "expr" => Part::Expr { whole, sealed },
            "condition" => Part::Condition,
            "recipe" => Part::Recipe,
            "recipe-term" => Part::RecipeAtom,
            "string" => Part::String,
            "pattern" => Part::Pattern,
            "children" => Part::Children { repeated: false },
            _ => Part::Term,
        };
        return parts_problem(vec![(part, &clean(n), depth)], uni);
    }
    if kind == "expr" {
        for k in ["seq", "choice", "ranked", "and"] {
            if has(n, k) {
                if !only(n, &[k]) || k == "and" && list(get(n, k)).len() > 16 {
                    return Some("a malformed expression");
                }
                return items(k, "expr", 2);
            }
        }
        if has(n, "optional") {
            if !allowed(n, &["optional", "elidable"])
                || has(n, "elidable") && (get(n, "elidable") != &Json::Bool(true) || !elidable(get(n, "optional")))
            {
                return Some("a malformed optional");
            }
            return schedule(
                pending,
                get(n, "optional"),
                "expr",
                depth + 1,
                false,
                sealed || get(n, "elidable") == &Json::Bool(true),
                uni,
            );
        }
        if has(n, "repeat") {
            if !allowed(n, &["repeat", "separator", "chain"])
                || has(n, "chain") && (!whole || !matches!(text(get(n, "chain")), "left" | "right"))
            {
                return Some("a malformed repetition");
            }
            if let Some(p) = schedule(pending, get(n, "repeat"), "expr", depth + 1, false, true, uni) {
                return Some(p);
            }
            return n.get("separator").and_then(|s| schedule(pending, s, "expr", depth + 1, false, true, uni));
        }
        if has(n, "capture") {
            if sealed
                || !only(n, &["capture", "expr"])
                || !get(n, "capture").as_str().is_some_and(dom::is_capture_name)
                || !symbol(get(n, "expr"))
            {
                return Some("a malformed capture");
            }
            return walk(get(n, "expr"), "expr");
        }
    }
    if has(n, "test") {
        if kind == "expr" && !symbol(n) {
            return Some("a malformed test");
        }
        if kind == "pattern" && !pattern_test_target(n) {
            return Some("a malformed pattern test target or order");
        }
        if text(get(n, "test")) == "tags" {
            if !only(n, &["test", "expr", "requirements"]) {
                return Some("a malformed tag test");
            }
            if let Some(p) = requirements(pending, get(n, "requirements"), depth + 1, uni) {
                return Some(p);
            }
        } else {
            if !only(n, &["test", "expr", "value"]) || !matches!(text(get(n, "test")), "=" | "≠") {
                return Some("a malformed value test");
            }
            if let Some(p) = walk(get(n, "value"), "string") {
                return Some(p);
            }
        }
        return walk(get(n, "expr"), kind);
    }
    if has(n, "range") {
        let fields: &[&str] = if kind == "pattern" { &["range", "at"] } else { &["range"] };
        if !only(n, fields) || kind == "pattern" && at(n).is_none() || list(get(n, "range")).len() != 2 {
            return Some("a malformed range");
        }
        for v in list(get(n, "range")) {
            schedule(pending, v, "string", depth, false, sealed, uni);
        }
        return None;
    }
    if has(n, "literal") {
        let fields: &[&str] = if kind == "pattern" { &["literal", "at"] } else { &["literal"] };
        if !only(n, fields) || kind == "pattern" && at(n).is_none() {
            return Some("a malformed literal");
        }
        return schedule(pending, get(n, "literal"), "string", depth, false, sealed, uni);
    }
    if kind == "recipe" {
        if !only(n, &["concat"]) {
            return Some("a malformed recipe");
        }
        return items("concat", "recipe-atom", 1);
    }
    if kind == "children" {
        if has(n, "node") {
            if !only(n, &["node"]) {
                return Some("a malformed pattern");
            }
            return walk(get(n, "node"), "pattern");
        }
        if has(n, "sequence") {
            if !only(n, &["sequence"]) {
                return Some("a malformed pattern");
            }
            return items("sequence", "children", 2);
        }
        for k in ["optional", "repeat"] {
            if has(n, k) {
                if !allowed(n, &[k, "separator"]) {
                    return Some("a malformed pattern");
                }
                if let Some(p) = walk(get(n, k), "children") {
                    return Some(p);
                }
                return n.get("separator").and_then(|s| walk(s, "children"));
            }
        }
        return Some("a malformed pattern");
    }
    if kind == "pattern" {
        if has(n, "children") {
            if !only(n, &["children"]) {
                return Some("a malformed pattern");
            }
            return walk(get(n, "children"), "children");
        }
        for k in ["union", "intersection", "difference"] {
            if has(n, k) {
                if !only(n, &[k]) || k == "difference" && list(get(n, k)).len() != 2 {
                    return Some("a malformed pattern");
                }
                return items(k, "pattern", 2);
            }
        }
        if has(n, "path") {
            if !only(n, &["path", "pattern"]) || !matches!(text(get(n, "path")), "first" | "last" | "descendant") {
                return Some("a malformed pattern path");
            }
            return walk(get(n, "pattern"), "pattern");
        }
        return Some("a malformed pattern");
    }
    if has(n, "pattern") {
        if !only(n, &["pattern"]) {
            return Some("a malformed pattern term");
        }
        return walk(get(n, "pattern"), "pattern");
    }
    if has(n, "method") {
        let name = text(get(n, "method"));
        if !only(n, &["method", "receiver", "args"]) || !array(n, "args", 0) {
            return Some("a malformed method");
        }
        if query(name) != (kind == "condition") {
            return Some("a method in the wrong category");
        }
        if let Some(p) = method_problem(n, kind == "recipe-term", uni) {
            return Some(p);
        }
        if matches!(name, "classify" | "ngrams") && unresolved(get(n, "args")) {
            return Some("a parameter cannot replace a classifier name or integer argument");
        }
        if let Some(p) = walk(get(n, "receiver"), if kind == "recipe-term" { "recipe-term" } else { "term" }) {
            return Some(p);
        }
        for a in list(get(n, "args")) {
            if has(a, "rule") {
                if !only(a, &["rule"])
                    || !named(get(a, "rule"), uni)
                    || !["tags", "matches", "begins", "without-elision-except", "followed-by", "preceded-by"]
                        .contains(&name)
                {
                    return Some("a malformed rule argument");
                }
                continue;
            }
            if has(a, "terminal") {
                if !only(a, &["terminal"])
                    || !user_tag(get(a, "terminal"))
                    || !["matches", "begins", "followed-by", "preceded-by"].contains(&name)
                {
                    return Some("a malformed target argument");
                }
                continue;
            }
            if has(a, "classifier") || has(a, "integer") {
                continue;
            }
            if let Some(p) = walk(a, "term") {
                return Some(p);
            }
        }
        return None;
    }
    for k in ["concat", "union", "intersection", "difference", "any", "all"] {
        if has(n, k) {
            if !only(n, &[k]) || k == "difference" && list(get(n, k)).len() != 2 {
                return Some("a malformed compound node");
            }
            return items(k, if matches!(k, "any" | "all") { "condition" } else { "term" }, 2);
        }
    }
    if has(n, "not") {
        if !only(n, &["not"]) {
            return Some("a malformed negation");
        }
        return walk(get(n, "not"), "condition");
    }
    if has(n, "op") {
        if !only(n, &["op", "left", "right"]) || !["=", "≠", "∈", "∉", "⊆", "⊈", "≅", "≇"].contains(&text(get(n, "op")))
        {
            return Some("a malformed comparison");
        }
        if ["≅", "≇"].contains(&text(get(n, "op"))) && !bare_capture(get(n, "left")) {
            return Some("a tree comparison requires a bare capture");
        }
        return walk(get(n, "left"), "term").or_else(|| walk(get(n, "right"), "term"));
    }
    if has(n, "if") {
        if !only(n, &["if", "then"]) {
            return Some("a malformed implication");
        }
        return walk(get(n, "if"), "condition").or_else(|| walk(get(n, "then"), kind));
    }
    Some("a malformed source node")
}
fn requirements<'a>(
    pending: &std::cell::RefCell<Vec<NodeTask<'a>>>,
    n: &'a Json,
    depth: usize,
    uni: &Unicode,
) -> Option<&'static str> {
    let Some(items) = n.as_array() else { return Some("a malformed requirement list") };
    for r in items {
        let operand = get(r, "value");
        if !only(r, &["negated", "value"])
            || !matches!(get(r, "negated"), Json::Bool(_))
            || !["tag", "const", "param"].iter().any(|k| has(operand, k))
        {
            return Some("a malformed requirement");
        }
        if let Some(p) = schedule(pending, operand, "term", depth, false, false, uni) {
            return Some(p);
        }
    }
    None
}
fn symbol(n: &Json) -> bool {
    if has(n, "test") {
        let inner = get(n, "expr");
        return match text(get(n, "test")) {
            "tags" => !has(inner, "test") && symbol(inner),
            "=" | "≠" => (!has(inner, "test") || text(get(inner, "test")) == "tags") && symbol(inner),
            _ => false,
        };
    }
    ["param", "call", "ref", "literal", "range"].iter().any(|k| has(n, k)) || get(n, "wildcard") == &Json::Bool(true)
}
fn pattern_test_target(n: &Json) -> bool {
    let mut inner = get(n, "expr");
    if matches!(text(get(n, "test")), "=" | "≠") && text(get(inner, "test")) == "tags" {
        inner = get(inner, "expr");
    }
    !has(inner, "test")
        && (has(inner, "param")
            || ["terminal", "literal", "range", "wildcard", "constant"].iter().any(|k| has(inner, k)))
}
fn elidable(n: &Json) -> bool {
    let n = list(get(n, "seq")).first().unwrap_or(n);
    if !symbol(n) {
        return false;
    }
    let mut n = n;
    while has(n, "test") {
        n = get(n, "expr")
    }
    has(n, "param") || only(n, &["ref"]) && user_tag(get(n, "ref"))
}
fn capture_shape(n: &Json) -> dom::Expr {
    use dom::Expr;
    for k in ["seq", "choice", "ranked", "and"] {
        if has(n, k) {
            let xs = list(get(n, k)).iter().map(capture_shape).collect();
            return match k {
                "seq" => Expr::Seq(xs),
                "choice" => Expr::Choice(xs),
                "ranked" => Expr::Ranked(xs),
                _ => Expr::And(xs),
            };
        }
    }
    if has(n, "capture") {
        return Expr::Capture(text(get(n, "capture")).into(), Box::new(capture_shape(get(n, "expr"))));
    }
    if has(n, "optional") {
        return Expr::Optional(Box::new(capture_shape(get(n, "optional"))), dom::Mark::Plain);
    }
    if has(n, "repeat") {
        return Expr::Repeat(
            Box::new(capture_shape(get(n, "repeat"))),
            n.get("separator").map(|s| Box::new(capture_shape(s))),
            None,
        );
    }
    if has(n, "test") {
        return capture_shape(get(n, "expr"));
    }
    Expr::Empty
}
