//! Schema validation for grammar DOMs. The work list bounds the complete DOM
//! before conversion constructs any recursively owned term or expression.
use super::*;

#[derive(Clone, Copy)]
enum Part {
    Expr { whole: bool, sealed: bool },
    Term,
    RecipeAtom,
    Condition,
    String,
    Recipe,
    Pattern,
    Children { repeated: bool },
}

fn exact(value: &Json, required: &[&str], optional: &[&str]) -> bool {
    value.as_object().is_some_and(|members| {
        required.iter().all(|name| value.get(name).is_some())
            && members.iter().all(|(name, _)| required.contains(&name.as_str()) || optional.contains(&name.as_str()))
    })
}

fn scalar_name(name: &str) -> bool {
    name.strip_prefix('_').is_some_and(|digits| {
        (4..=6).contains(&digits.len())
            && digits.bytes().all(|c| c.is_ascii_digit() || (b'A'..=b'F').contains(&c))
            && u32::from_str_radix(digits, 16).ok().and_then(char::from_u32).is_some()
    })
}

pub(super) fn engine_tag(name: &str) -> bool {
    name.strip_prefix('_').is_some_and(|name| name != "Any" && is_property_name(name))
}

fn tag(name: &str) -> bool {
    engine_tag(name) || name.starts_with(|c: char| c.is_ascii_uppercase()) && is_name(name)
}

fn rule(name: &str) -> bool {
    name == "#" || name.starts_with(|c: char| c.is_ascii_lowercase()) && is_name(name)
}

fn feature(name: &str) -> bool {
    name.starts_with(|c: char| c.is_ascii_alphabetic()) && name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
}

fn guards(value: Option<&Json>, gates: bool) -> bool {
    value.and_then(Json::as_array).is_some_and(|items| {
        items.iter().all(|item| {
            exact(item, &["feature", "kind", "negated"], &[])
                && item.get("feature").and_then(Json::as_str).is_some_and(feature)
                && match (item.get("kind").and_then(Json::as_str), item.get("negated")) {
                    (Some("gate"), Some(Json::Bool(_))) => true,
                    (Some("warning"), Some(Json::Bool(false))) => !gates,
                    _ => false,
                }
        })
    })
}

fn bare_capture(value: &Json) -> bool {
    exact(value, &["capture"], &[])
        && value.get("capture").and_then(Json::as_str).is_some_and(|name| name.is_empty() || is_capture_name(name))
}

fn span(value: &Json) -> bool {
    bare_capture(value)
        || matches!(
            value.get("method").and_then(Json::as_str),
            Some(
                "without-elision"
                    | "without-elision-except"
                    | "first-token"
                    | "last-token"
                    | "tokens-after-first"
                    | "onward"
                    | "following-tokens"
            )
        )
}

fn string_atom(value: &Json) -> bool {
    exact(value, &["string"], &[]) && is_str(value.get("string")) || exact(value, &["const", "at"], &[])
}

/// Literal endpoints must already form an ordered scalar interval.
fn literal_range(left: &Json, right: &Json) -> bool {
    let scalar = |value: &Json| {
        let text = value.get("string")?.as_str()?;
        let mut chars = text.chars();
        let first = chars.next()?;
        chars.next().is_none().then_some(first)
    };
    [left, right].iter().all(|v| v.get("string").is_none() || scalar(v).is_some())
        && match (scalar(left), scalar(right)) {
            (Some(a), Some(b)) => a <= b,
            _ => true,
        }
}

fn base(value: &Json, hash: bool) -> bool {
    exact(value, &["ref"], &[])
        && value
            .get("ref")
            .and_then(Json::as_str)
            .is_some_and(|name| (hash || name != "#") && (rule(name) || tag(name)))
        || exact(value, &["literal"], &[])
        || exact(value, &["range"], &[])
        || exact(value, &["wildcard"], &[]) && is_true(value.get("wildcard"))
}

fn tested_base(value: &Json, hash: bool) -> bool {
    base(value, hash)
        || value.get("test").and_then(Json::as_str).is_some_and(|op| match (op, value.get("expr")) {
            ("tags", Some(inner)) => base(inner, false),
            ("=" | "≠", Some(inner)) => {
                base(inner, false)
                    || inner.get("test").and_then(Json::as_str) == Some("tags")
                        && inner.get("expr").is_some_and(|inner| base(inner, false))
            }
            _ => false,
        })
}

fn recipe_atom(value: &Json) -> bool {
    if string_atom(value) {
        return true;
    }
    let Some(receiver) = value.get("receiver") else { return false };
    match value.get("method").and_then(Json::as_str) {
        Some("value" | "image") => {
            bare_capture(receiver)
                || receiver.get("method").and_then(Json::as_str) == Some("emitted")
                    && receiver.get("receiver").is_some_and(bare_capture)
        }
        Some("source-text" | "decomposed-source-text" | "verbatim-text") => bare_capture(receiver),
        _ => false,
    }
}

fn pattern_base(value: &Json) -> bool {
    exact(value, &["terminal", "at"], &[]) && value.get("terminal").and_then(Json::as_str).is_some_and(tag)
        || exact(value, &["constant", "at"], &[])
            && value.get("constant").and_then(Json::as_str).is_some_and(is_constant_name)
        || exact(value, &["literal", "at"], &[])
        || exact(value, &["range", "at"], &[])
        || exact(value, &["wildcard", "at"], &[]) && is_true(value.get("wildcard"))
}

pub(super) fn problem(dom: &Json, unicode: &Unicode) -> Option<&'static str> {
    if dom.get("format").and_then(Json::as_int) != Some(DOM_FORMAT) {
        return Some("not a DOM of this format");
    }
    let mut pending = Vec::new();
    let mut positions = FxSet::default();
    for name in ["rules", "directives", "constants", "classifiers", "implications"] {
        let Some(items) = dom.get(name).and_then(Json::as_array) else { return Some("missing declaration array") };
        for item in items {
            if !is_position(item.get("at")) {
                return Some("a malformed declaration position");
            }
            let at = position(item).ok()?;
            if !positions.insert(at) {
                return Some("two items at one position");
            }
            match name {
                "directives" => {
                    let Some(args) = item.get("args").and_then(Json::as_array) else {
                        return Some("a malformed directive");
                    };
                    let args: Option<Vec<_>> = args.iter().map(Json::as_str).collect();
                    let Some(args) = args else { return Some("a malformed directive") };
                    let valid = match item.get("name").and_then(Json::as_str) {
                        Some("stage" | "extend-stage" | "redefine-stage") => {
                            matches!(&args[..], [name] if *name != "#" && rule(name))
                        }
                        Some("include") => args.len() == 1,
                        Some("features") => !args.is_empty() && args.iter().all(|name| feature(name)),
                        Some("ambiguity-resolution") => matches!(
                            &args[..],
                            ["greedy" | "lazy" | "late-elision"] | ["greedy" | "lazy" | "late-elision", "elision-only"]
                        ),
                        _ => false,
                    };
                    if !valid {
                        return Some("a malformed directive");
                    }
                    if let Some(value) = item.get("conditions") {
                        let Some(conditions) = value.as_array().filter(|items| !items.is_empty()) else {
                            return Some("malformed feature conditions");
                        };
                        if item.get("name").and_then(Json::as_str) != Some("features") {
                            return Some("conditions on another directive");
                        }
                        pending.extend(conditions.iter().map(|value| (Part::Condition, value, 0)));
                    }
                }
                "rules" => {
                    if let Some(problem) = boundary_problem(item) {
                        return Some(problem);
                    }
                    if !exact(
                        item,
                        &["name", "op", "flags", "alternatives", "conditions", "at"],
                        &["tags", "value", "image", "emit", "erased"],
                    ) || !item.get("name").and_then(Json::as_str).is_some_and(rule)
                        || !matches!(item.get("op").and_then(Json::as_str), Some("define" | "extend" | "redefine"))
                    {
                        return Some("a malformed rule");
                    }
                    let flags = item.get("flags").and_then(Json::as_array);
                    if !flags.is_some_and(|flags| {
                        flags.is_empty()
                            || flags.len() == 1
                                && matches!(flags[0].as_str(), Some("leftmost-longest" | "fewest"))
                                && item.get("op").and_then(Json::as_str) != Some("extend")
                    }) {
                        return Some("a malformed rule flag");
                    }
                    if !matches!(item.get("erased"), None | Some(Json::Bool(true)))
                        || item.get("erased").is_some()
                            && ["emit", "value", "image"].iter().any(|name| item.get(name).is_some())
                    {
                        return Some("an erased rule with an emission or recipe");
                    }
                    for key in ["tags", "value", "image"] {
                        if let Some(value) = item.get(key) {
                            pending.push((if key == "tags" { Part::Term } else { Part::Recipe }, value, 0));
                        }
                    }
                    let Some(conditions) = item.get("conditions").and_then(Json::as_array) else {
                        return Some("a malformed condition list");
                    };
                    pending.extend(conditions.iter().map(|value| (Part::Condition, value, 0)));
                    let Some(alts) =
                        item.get("alternatives").and_then(Json::as_array).filter(|items| !items.is_empty())
                    else {
                        return Some("an empty alternative list");
                    };
                    for alt in alts {
                        if !exact(alt, &["guards", "expr"], &["tags", "value", "image"])
                            || !guards(alt.get("guards"), false)
                        {
                            return Some("a malformed alternative");
                        }
                        pending.push((Part::Expr { whole: true, sealed: false }, alt.get("expr").unwrap(), 0));
                        for key in ["tags", "value", "image"] {
                            if let Some(value) = alt.get(key) {
                                pending.push((if key == "tags" { Part::Term } else { Part::Recipe }, value, 0));
                            }
                        }
                    }
                    if let Some(emit) = item.get("emit") {
                        if !exact(emit, &["items"], &[]) {
                            return Some("a malformed emission");
                        }
                        let Some(items) = emit.get("items").and_then(Json::as_array).filter(|items| !items.is_empty())
                        else {
                            return Some("an empty emission list");
                        };
                        let mut names = FxSet::default();
                        for output in items {
                            let capture = output.get("capture").and_then(Json::as_str);
                            let insert = is_true(output.get("insert"));
                            if !(capture.is_some() ^ insert)
                                || !exact(
                                    output,
                                    if insert { &["insert"] } else { &["capture"] },
                                    &["tags", "value", "image", "before", "after"],
                                )
                            {
                                return Some("a malformed emission item");
                            }
                            if let Some(name) = capture.filter(|name| !name.is_empty()) {
                                if !is_capture_name(name) || !names.insert(name) {
                                    return Some("a malformed carrier");
                                }
                            }
                            for side in ["before", "after"] {
                                if let Some(list) = output.get(side) {
                                    let Some(list) = list.as_array().filter(|items| !items.is_empty()) else {
                                        return Some("a malformed attachment list");
                                    };
                                    if capture.is_none() || capture == Some("") {
                                        return Some("attachments require a named carrier");
                                    }
                                    for name in list {
                                        let Some(name) = name.as_str().filter(|name| is_capture_name(name)) else {
                                            return Some("a malformed attachment");
                                        };
                                        if !names.insert(name) {
                                            return Some("a repeated emission capture");
                                        }
                                    }
                                }
                            }
                            for key in ["tags", "value", "image"] {
                                if let Some(value) = output.get(key) {
                                    pending.push((if key == "tags" { Part::Term } else { Part::Recipe }, value, 0));
                                }
                            }
                        }
                    }
                }
                "constants" => {
                    if !exact(item, &["name", "op", "value", "at"], &[])
                        || !item.get("name").and_then(Json::as_str).is_some_and(is_constant_name)
                        || !matches!(item.get("op").and_then(Json::as_str), Some("define" | "redefine"))
                    {
                        return Some("a malformed constant");
                    }
                    pending.push((Part::Term, item.get("value").unwrap(), 0));
                }
                "classifiers" => {
                    if !exact(item, &["name", "entries", "at"], &[])
                        || !item.get("name").and_then(Json::as_str).is_some_and(is_classifier_name)
                    {
                        return Some("a malformed classifier");
                    }
                    let Some(entries) = item.get("entries").and_then(Json::as_array) else {
                        return Some("a malformed entry list");
                    };
                    for entry in entries {
                        let class = entry.get("class").and_then(Json::as_str);
                        if !exact(entry, &["guards", "keys", "op", "class", "at"], &[])
                            || !guards(entry.get("guards"), true)
                            || !matches!(entry.get("op").and_then(Json::as_str), Some("∈" | "∉"))
                            || !is_position(entry.get("at"))
                            || !class.is_some_and(|name| {
                                tag(name) && !engine_tag(name) && name.ends_with(|c: char| c.is_ascii_uppercase())
                            })
                        {
                            return Some("a malformed classifier entry");
                        }
                        let Some(keys) = entry.get("keys").and_then(Json::as_array).filter(|keys| !keys.is_empty())
                        else {
                            return Some("an empty classifier key list");
                        };
                        pending.extend(keys.iter().map(|key| (Part::String, key, 0)));
                    }
                }
                "implications" => {
                    if !exact(item, &["if", "then", "at"], &[]) {
                        return Some("a malformed implication");
                    }
                    pending.push((Part::Term, item.get("if").unwrap(), 0));
                    pending.push((Part::Term, item.get("then").unwrap(), 0));
                }
                _ => unreachable!(),
            }
        }
    }
    while let Some((kind, value, depth)) = pending.pop() {
        if depth > DOM_MAX_DEPTH {
            return Some("nested too deeply");
        }
        let next = depth + 1;
        match kind {
            Part::Expr { whole, sealed } => {
                let expression = |value, sealed| (Part::Expr { whole: false, sealed }, value, next);
                if base(value, true) {
                    if let Some(term) = value.get("literal") {
                        pending.push((Part::String, term, depth));
                    }
                    if let Some(range) = value.get("range") {
                        let Some([left, right]) = range.as_array() else { return Some("a malformed scalar range") };
                        if !literal_range(left, right) {
                            return Some("a malformed scalar range");
                        }
                        pending.push((Part::String, left, depth));
                        pending.push((Part::String, right, depth));
                    }
                } else if exact(value, &["empty"], &[]) && is_true(value.get("empty")) {
                } else if let Some(inner) = value.get("capture") {
                    if sealed
                        || !exact(value, &["capture", "expr"], &[])
                        || !inner.as_str().is_some_and(is_capture_name)
                        || !value.get("expr").is_some_and(|inner| tested_base(inner, true))
                    {
                        return Some("a malformed capture");
                    }
                    pending.push(expression(value.get("expr").unwrap(), sealed));
                } else if let Some(inner) = value.get("optional") {
                    if !exact(value, &["optional"], &["elidable"])
                        || !matches!(value.get("elidable"), None | Some(Json::Bool(true)))
                    {
                        return Some("a malformed optional");
                    }
                    if value.get("elidable").is_some() && elidable_head_json(inner).is_none() {
                        return Some("a malformed elidable optional");
                    }
                    pending.push(expression(inner, sealed || value.get("elidable").is_some()));
                } else if let Some(inner) = value.get("repeat") {
                    if !exact(value, &["repeat"], &["separator", "chain"])
                        || value
                            .get("chain")
                            .is_some_and(|chain| !whole || !matches!(chain.as_str(), Some("left" | "right")))
                    {
                        return Some("a malformed repeat");
                    }
                    pending.push(expression(inner, true));
                    if let Some(separator) = value.get("separator") {
                        pending.push(expression(separator, true));
                    }
                } else if value.get("test").is_some() {
                    if !tested_base(value, false) {
                        return Some("a malformed test target or order");
                    }
                    pending.push(expression(value.get("expr").unwrap(), sealed));
                    match value.get("test").and_then(Json::as_str) {
                        Some("=" | "≠") if exact(value, &["test", "value", "expr"], &[]) => {
                            pending.push((Part::String, value.get("value").unwrap(), next))
                        }
                        Some("tags") if exact(value, &["test", "requirements", "expr"], &[]) => {
                            let Some(items) = value.get("requirements").and_then(Json::as_array) else {
                                return Some("a malformed requirement list");
                            };
                            for item in items {
                                let Some(term) = item.get("value") else { return Some("a missing requirement value") };
                                if !exact(item, &["negated", "value"], &[])
                                    || !matches!(item.get("negated"), Some(Json::Bool(_)))
                                    || !(term.get("tag").is_some() || term.get("const").is_some())
                                {
                                    return Some("a malformed requirement");
                                }
                                pending.push((Part::Term, term, next));
                            }
                        }
                        _ => return Some("a malformed test"),
                    }
                } else {
                    let Some(key) = ["seq", "choice", "ranked", "and"].into_iter().find(|key| value.get(key).is_some())
                    else {
                        return Some("a malformed expression");
                    };
                    let Some(items) = value
                        .get(key)
                        .and_then(Json::as_array)
                        .filter(|items| items.len() >= 2 && (key != "and" || items.len() <= 16))
                    else {
                        return Some("a malformed expression list");
                    };
                    if !exact(value, &[key], &[]) {
                        return Some("a malformed expression");
                    }
                    pending.extend(items.iter().map(|item| expression(item, sealed)));
                }
            }
            Part::Recipe => {
                if !exact(value, &["concat"], &[]) {
                    return Some("a malformed recipe");
                }
                let Some(atoms) = value.get("concat").and_then(Json::as_array).filter(|atoms| !atoms.is_empty()) else {
                    return Some("an empty recipe");
                };
                for atom in atoms {
                    if !recipe_atom(atom) {
                        return Some("a recipe contains a non-string atom");
                    }
                    pending.push((Part::RecipeAtom, atom, next));
                }
            }
            Part::String => {
                if !string_atom(value) {
                    return Some("a string term is required");
                }
                pending.push((Part::Term, value, depth));
            }
            Part::Term | Part::RecipeAtom => {
                if exact(value, &["string"], &[]) && is_str(value.get("string"))
                    || exact(value, &["tag"], &[]) && value.get("tag").and_then(Json::as_str).is_some_and(tag)
                    || bare_capture(value)
                    || exact(value, &["emptySet"], &[]) && is_true(value.get("emptySet"))
                {
                } else if exact(value, &["const", "at"], &[]) {
                    if !is_position(value.get("at"))
                        || !value
                            .get("const")
                            .and_then(Json::as_str)
                            .is_some_and(|name| is_constant_name(name) || scalar_name(name))
                    {
                        return Some("a malformed constant reference");
                    }
                } else if exact(value, &["concat"], &[]) {
                    let Some(items) = value.get("concat").and_then(Json::as_array).filter(|items| items.len() >= 2)
                    else {
                        return Some("a malformed concatenation");
                    };
                    for item in items {
                        pending.push((Part::Term, item, next));
                    }
                } else if exact(value, &["pattern"], &[]) {
                    pending.push((Part::Pattern, value.get("pattern").unwrap(), next));
                } else if exact(value, &["if", "then"], &[]) {
                    pending.push((Part::Condition, value.get("if").unwrap(), next));
                    pending.push((Part::Term, value.get("then").unwrap(), next));
                } else if value.get("method").is_some() {
                    if !exact(value, &["method", "receiver", "args"], &[]) {
                        return Some("a malformed method");
                    }
                    let Some(args) = value.get("args").and_then(Json::as_array) else {
                        return Some("a malformed method argument list");
                    };
                    let receiver = value.get("receiver").unwrap();
                    let name = value.get("method").and_then(Json::as_str).unwrap_or("");
                    let valid = match (name, args) {
                        ("without-elision", []) => bare_capture(receiver),
                        ("without-elision-except", [arg]) => {
                            bare_capture(receiver)
                                && exact(arg, &["rule"], &[])
                                && arg.get("rule").and_then(Json::as_str).is_some_and(rule)
                        }
                        ("verbatim-text" | "emitted", []) => matches!(kind, Part::RecipeAtom) && bare_capture(receiver),
                        ("value" | "image", []) => {
                            span(receiver)
                                || matches!(kind, Part::RecipeAtom)
                                    && receiver.get("method").and_then(Json::as_str) == Some("emitted")
                        }
                        (
                            "source-text"
                            | "decomposed-source-text"
                            | "first-token"
                            | "last-token"
                            | "tokens-after-first"
                            | "onward"
                            | "following-tokens"
                            | "classes"
                            | "tags",
                            [],
                        ) => span(receiver),
                        ("tags", [arg]) => {
                            span(receiver)
                                && exact(arg, &["rule"], &[])
                                && arg.get("rule").and_then(Json::as_str).is_some_and(rule)
                        }
                        ("ngrams", [arg]) => {
                            exact(arg, &["integer"], &[])
                                && arg.get("integer").and_then(Json::as_str).is_some_and(crate::dom::valid_integer)
                        }
                        ("split", [arg]) => {
                            !is_rule_arg(arg) && !is_classifier_arg(arg) && arg.get("integer").is_none()
                        }
                        ("classify", [arg]) => {
                            exact(arg, &["classifier"], &[])
                                && arg.get("classifier").and_then(Json::as_str).is_some_and(is_classifier_name)
                        }
                        _ => false,
                    };
                    if !valid {
                        return Some("a method has the wrong receiver or arguments");
                    }
                    pending.push((kind, receiver, next));
                    for arg in args {
                        if arg.get("rule").is_none() && arg.get("classifier").is_none() && arg.get("integer").is_none()
                        {
                            pending.push((Part::Term, arg, next));
                        }
                    }
                } else {
                    let Some(key) =
                        ["union", "intersection", "difference"].into_iter().find(|key| value.get(key).is_some())
                    else {
                        return Some("a malformed term");
                    };
                    let Some(items) = value
                        .get(key)
                        .and_then(Json::as_array)
                        .filter(|items| items.len() >= 2 && (key != "difference" || items.len() == 2))
                    else {
                        return Some("a malformed set operation");
                    };
                    if !exact(value, &[key], &[]) {
                        return Some("a malformed term");
                    }
                    pending.extend(items.iter().map(|item| (Part::Term, item, next)));
                }
            }
            Part::Condition => {
                if exact(value, &["captured"], &[])
                    && value
                        .get("captured")
                        .and_then(Json::as_str)
                        .is_some_and(|name| name.is_empty() || is_capture_name(name))
                {
                } else if exact(value, &["not"], &[]) {
                    pending.push((Part::Condition, value.get("not").unwrap(), next));
                } else if exact(value, &["if", "then"], &[]) {
                    pending.push((Part::Condition, value.get("if").unwrap(), next));
                    pending.push((Part::Condition, value.get("then").unwrap(), next));
                } else if exact(value, &["op", "left", "right"], &[]) {
                    if !matches!(
                        value.get("op").and_then(Json::as_str),
                        Some("=" | "≠" | "∈" | "∉" | "⊆" | "⊈" | "≅" | "≇")
                    ) {
                        return Some("a malformed comparator");
                    }
                    pending.push((Part::Term, value.get("left").unwrap(), next));
                    pending.push((Part::Term, value.get("right").unwrap(), next));
                } else if exact(value, &["method", "receiver", "args"], &[]) {
                    let receiver = value.get("receiver").unwrap();
                    let args = value.get("args").and_then(Json::as_array);
                    if !span(receiver)
                        || !match (value.get("method").and_then(Json::as_str), args) {
                            (Some("starts-input" | "ends-input"), Some([])) => true,
                            (Some("followed-by" | "preceded-by"), Some(args)) => {
                                bare_capture(receiver)
                                    && !args.is_empty()
                                    && args.iter().all(|arg| {
                                        exact(arg, &["rule"], &[])
                                            && arg.get("rule").and_then(Json::as_str).is_some_and(rule)
                                            || exact(arg, &["terminal"], &[])
                                                && arg.get("terminal").and_then(Json::as_str).is_some_and(|s| {
                                                    s.starts_with(|c: char| c.is_ascii_uppercase()) && tag(s)
                                                })
                                    })
                            }
                            (Some("matches" | "begins"), Some(args)) => {
                                !args.is_empty()
                                    && args.iter().all(|arg| {
                                        exact(arg, &["rule"], &[])
                                            && arg.get("rule").and_then(Json::as_str).is_some_and(rule)
                                            || exact(arg, &["terminal"], &[])
                                                && arg.get("terminal").and_then(Json::as_str).is_some_and(|s| {
                                                    s.starts_with(|c: char| c.is_ascii_uppercase()) && tag(s)
                                                })
                                    })
                            }
                            _ => false,
                        }
                    {
                        return Some("a malformed query predicate");
                    }
                    pending.push((Part::Term, receiver, next));
                } else {
                    let Some(key) = ["any", "all"].into_iter().find(|key| value.get(key).is_some()) else {
                        return Some("a malformed condition");
                    };
                    let Some(items) = value.get(key).and_then(Json::as_array).filter(|items| items.len() >= 2) else {
                        return Some("a malformed condition list");
                    };
                    if !exact(value, &[key], &[]) {
                        return Some("a malformed condition");
                    }
                    pending.extend(items.iter().map(|item| (Part::Condition, item, next)));
                }
            }
            Part::Pattern => {
                if let Some(term) = value.get("literal") {
                    if !exact(value, &["literal", "at"], &[]) || !is_position(value.get("at")) {
                        return Some("a malformed pattern literal");
                    }
                    pending.push((Part::String, term, depth));
                } else if let Some(range) = value.get("range") {
                    if !exact(value, &["range", "at"], &[]) || !is_position(value.get("at")) {
                        return Some("a malformed pattern range");
                    }
                    let Some([left, right]) = range.as_array() else { return Some("a malformed pattern range") };
                    if !literal_range(left, right) {
                        return Some("a malformed pattern range");
                    }
                    pending.push((Part::String, left, depth));
                    pending.push((Part::String, right, depth));
                } else if value.get("test").is_some() {
                    let op = value.get("test").and_then(Json::as_str);
                    let Some(inner) = value.get("expr") else { return Some("a missing pattern test target") };
                    if !(pattern_base(inner)
                        || matches!(op, Some("=" | "≠"))
                            && inner.get("test").and_then(Json::as_str) == Some("tags")
                            && inner.get("expr").is_some_and(pattern_base))
                    {
                        return Some("a malformed pattern test target or order");
                    }
                    match op {
                        Some("=" | "≠") if exact(value, &["test", "value", "expr"], &[]) => {
                            pending.push((Part::String, value.get("value").unwrap(), next));
                        }
                        Some("tags") if exact(value, &["test", "requirements", "expr"], &[]) => {
                            let Some(items) = value.get("requirements").and_then(Json::as_array) else {
                                return Some("a malformed pattern requirement list");
                            };
                            for item in items {
                                let Some(term) = item.get("value") else { return Some("a missing requirement value") };
                                if !exact(item, &["negated", "value"], &[])
                                    || !matches!(item.get("negated"), Some(Json::Bool(_)))
                                    || !(term.get("tag").is_some() || term.get("const").is_some())
                                {
                                    return Some("a malformed pattern requirement");
                                }
                                pending.push((Part::Term, term, next));
                            }
                        }
                        _ => return Some("a malformed pattern test"),
                    }
                    pending.push((Part::Pattern, inner, next));
                } else if let Some(children) = value.get("children") {
                    if !exact(value, &["children"], &[]) {
                        return Some("a malformed pattern");
                    }
                    pending.push((Part::Children { repeated: false }, children, next));
                } else if value.get("path").is_some() {
                    if !exact(value, &["path", "pattern"], &[])
                        || !matches!(value.get("path").and_then(Json::as_str), Some("descendant" | "first" | "last"))
                    {
                        return Some("a malformed pattern path");
                    }
                    pending.push((Part::Pattern, value.get("pattern").unwrap(), next));
                } else if let Some(key) =
                    ["union", "intersection", "difference"].into_iter().find(|key| value.get(key).is_some())
                {
                    let Some(items) = value
                        .get(key)
                        .and_then(Json::as_array)
                        .filter(|items| items.len() >= 2 && (key != "difference" || items.len() == 2))
                    else {
                        return Some("a malformed pattern list");
                    };
                    if !exact(value, &[key], &[]) {
                        return Some("a malformed pattern");
                    }
                    pending.extend(items.iter().map(|item| (Part::Pattern, item, next)));
                } else if !(pattern_base(value)
                    || exact(value, &["name", "at"], &[]) && value.get("name").and_then(Json::as_str).is_some_and(rule))
                    || !is_position(value.get("at"))
                {
                    return Some("a malformed pattern atom");
                }
            }
            Part::Children { repeated } => {
                if exact(value, &["node"], &[]) {
                    pending.push((Part::Pattern, value.get("node").unwrap(), next));
                } else if exact(value, &["siblings"], &[]) && is_true(value.get("siblings")) && !repeated {
                } else if exact(value, &["optional"], &[]) {
                    pending.push((kind, value.get("optional").unwrap(), next));
                } else if exact(value, &["sequence"], &[]) {
                    let Some(items) = value.get("sequence").and_then(Json::as_array).filter(|items| items.len() >= 2)
                    else {
                        return Some("a malformed pattern child sequence");
                    };
                    pending.extend(items.iter().map(|item| (kind, item, next)));
                } else if exact(value, &["repeat"], &["separator"]) {
                    pending.push((Part::Children { repeated: true }, value.get("repeat").unwrap(), next));
                    if let Some(separator) = value.get("separator") {
                        pending.push((Part::Children { repeated: true }, separator, next));
                    }
                } else {
                    return Some("a malformed pattern child expression");
                }
            }
        }
    }
    for item in dom.get("rules").and_then(Json::as_array).unwrap() {
        let Ok(rule) = rule_from_json(item) else { return Some("a malformed rule") };
        if rule.alternatives.iter().any(|a| !crate::clauses::duplicate_captures(&a.expr).is_empty()) {
            return Some("a production captures a name twice");
        }
        if rule_type_problem(&rule).is_some() {
            return Some("a term or a condition whose types do not agree");
        }
        for term in rule.tags.iter().chain(rule.alternatives.iter().filter_map(|alt| alt.tags.as_ref())) {
            if crate::notation::reads_own_tags(term) {
                return Some("a tag clause reads its own tags");
            }
        }
        for term in rule.tags.iter().chain(rule.alternatives.iter().filter_map(|alt| alt.tags.as_ref())).chain(
            rule.emit.iter().flatten().filter_map(|item| match item {
                EmitItem::Capture(_, tags, _) | EmitItem::Insert(tags, _) => tags.as_ref(),
            }),
        ) {
            if !engine_literals(term).is_empty() {
                return Some("a tag clause introduces an engine tag");
            }
        }
    }
    for definition in dom.get("constants").and_then(Json::as_array).unwrap() {
        let Ok(term) = term_from_json(definition.get("value").unwrap()) else {
            return Some("a malformed constant value");
        };
        if !closed(&term)
            || any_engine_literal(&term)
            || constant_value_type(&term, definition.get("op").and_then(Json::as_str) == Some("redefine"), &|_| {
                Type::Any
            })
            .is_err()
        {
            return Some("an invalid closed constant value");
        }
    }
    for implication in dom.get("implications").and_then(Json::as_array).unwrap() {
        for key in ["if", "then"] {
            let Ok(term) = term_from_json(implication.get(key).unwrap()) else {
                return Some("a malformed implication side");
            };
            if !closed(&term)
                || any_engine_literal(&term)
                || term_type(&term).map_or(true, |ty| expected_problem(ty, Type::Tags).is_some())
            {
                return Some("an invalid implication side");
            }
        }
    }
    let _ = unicode;
    None
}

fn closed(root: &Term) -> bool {
    let mut pending = vec![root];
    while let Some(term) = pending.pop() {
        match term {
            Term::Capture(_) | Term::If(..) => return false,
            Term::Call(name, args) => {
                if !matches!(name.as_str(), "split" | "ngrams" | "concat") {
                    return false;
                }
                for arg in args {
                    if let Arg::Term(term) = arg {
                        pending.push(term);
                    } else if !matches!(arg, crate::dom::Arg::Integer(_)) {
                        return false;
                    }
                }
            }
            Term::Union(items) | Term::Intersection(items) => pending.extend(items),
            Term::Difference(a, b) => {
                pending.push(b);
                pending.push(a);
            }
            _ => {}
        }
    }
    true
}

fn any_engine_literal(root: &Term) -> bool {
    let mut pending = vec![root];
    while let Some(term) = pending.pop() {
        match term {
            Term::Tag(tag) if engine_tag(tag) => return true,
            Term::Union(items) | Term::Intersection(items) => pending.extend(items),
            Term::Difference(a, b) => {
                pending.push(b);
                pending.push(a);
            }
            Term::Call(_, args) => {
                pending.extend(args.iter().filter_map(|arg| if let Arg::Term(term) = arg { Some(term) } else { None }))
            }
            _ => {}
        }
    }
    false
}

fn json_parts(value: &Json) -> impl Iterator<Item = &Json> {
    value.as_array().unwrap_or(&[]).iter().chain(value.as_object().unwrap_or(&[]).iter().map(|(_, value)| value))
}
fn json_boundary_atoms(value: &Json) -> Vec<&Json> {
    let mut found = Vec::new();
    let mut pending = vec![value];
    while let Some(value) = pending.pop() {
        if matches!(value.get("method").and_then(Json::as_str), Some("followed-by" | "preceded-by")) {
            found.push(value);
        } else {
            pending.extend(json_parts(value));
        }
    }
    found
}
fn boundary_problem(rule: &Json) -> Option<&'static str> {
    let mut allowed = FxSet::default();
    for condition in rule.get("conditions").and_then(Json::as_array).unwrap_or(&[]) {
        let atoms = json_boundary_atoms(condition);
        if atoms.len() > 1 {
            return Some("a condition item accepts only one boundary atom");
        }
        for atom in atoms {
            allowed.insert(atom as *const Json);
            if let Some(receiver) = atom.get("receiver").and_then(|r| r.get("capture")).and_then(Json::as_str) {
                if !receiver.is_empty() {
                    let mut pending = vec![condition];
                    while let Some(part) = pending.pop() {
                        let capture = part.get("capture").or_else(|| part.get("captured")).and_then(Json::as_str);
                        if capture.is_some_and(|name| name != receiver) {
                            return Some("a boundary condition with a captured receiver reads only that capture");
                        }
                        pending.extend(json_parts(part));
                    }
                }
            }
        }
    }
    for item in rule.get("emit").and_then(|v| v.get("items")).and_then(Json::as_array).unwrap_or(&[]) {
        if let Some(tags) = item.get("tags") {
            allowed.extend(json_boundary_atoms(tags).iter().map(|v| *v as *const Json));
        }
    }
    if json_boundary_atoms(rule).iter().any(|v| !allowed.contains(&(*v as *const Json))) {
        return Some("a boundary atom stands only in conditions or emission tags");
    }
    None
}
