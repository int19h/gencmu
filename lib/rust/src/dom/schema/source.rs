//! Source-only forms in the ordinary DOM work list.
use super::*;

pub(super) fn leaf(value: &Json) -> bool {
    value.get("param").is_some() || value.get("call").is_some()
}

fn parameter(name: &str) -> bool {
    name.starts_with(|c: char| c.is_ascii_alphabetic())
        && name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

pub(super) fn head<'a>(item: &'a Json, pending: &mut Vec<(Part, &'a Json, usize)>) -> Option<&'static str> {
    let mut scope = FxSet::default();
    if let Some(params) = item.get("params") {
        let Some(params) = params.as_array().filter(|xs| !xs.is_empty()) else {
            return Some("malformed template parameters");
        };
        if item.get("args").is_some() {
            return Some("malformed template parameters");
        }
        for name in params {
            let Some(name) = name.as_str().filter(|s| parameter(s)) else {
                return Some("malformed template parameters");
            };
            if !scope.insert(name) {
                return Some("malformed template parameters");
            }
        }
    }
    for node in crate::parameters::nodes(item) {
        if let Some(name) = node.get("param") {
            if !name.as_str().is_some_and(|name| scope.contains(name)) {
                return Some("an undeclared or malformed parameter");
            }
        }
    }
    if let Some(args) = item.get("args") {
        if item.get("op").and_then(Json::as_str) == Some("define") {
            return Some("an instance head requires an edit");
        }
        let Some(args) = args.as_array().filter(|xs| !xs.is_empty()) else { return Some("a malformed call") };
        pending.extend(args.iter().map(|arg| (Part::Argument, arg, 1)));
    }
    if let Some(call) = item.get("instance") {
        if !exact(item, &["name", "op", "instance", "conditions", "at"], &[])
            || item.get("op").and_then(Json::as_str) == Some("extend")
            || item.get("conditions").and_then(Json::as_array) != Some(&[])
        {
            return Some("a malformed instance binding");
        }
        pending.push((Part::Call, call, 0));
    }
    None
}

pub(super) fn parameter_problem(value: &Json) -> Option<&'static str> {
    if exact(value, &["param", "at"], &[])
        && value.get("param").and_then(Json::as_str).is_some_and(parameter)
        && is_position(value.get("at"))
    {
        None
    } else {
        Some("an undeclared or malformed parameter")
    }
}

pub(super) fn call<'a>(
    value: &'a Json,
    depth: usize,
    pending: &mut Vec<(Part, &'a Json, usize)>,
    rule: &dyn Fn(&str) -> bool,
    pattern: bool,
) -> Option<&'static str> {
    if !exact(value, &["call", "args", "at"], if pattern { &["exact", "children"] } else { &[] })
        || !value.get("call").and_then(Json::as_str).is_some_and(rule)
        || !is_position(value.get("at"))
    {
        return Some("a malformed call");
    }
    let Some(args) = value.get("args").and_then(Json::as_array).filter(|xs| !xs.is_empty()) else {
        return Some("a malformed call");
    };
    pending.extend(args.iter().map(|arg| (Part::Argument, arg, depth + 1)));
    None
}

pub(super) fn argument<'a>(
    value: &'a Json,
    depth: usize,
    pending: &mut Vec<(Part, &'a Json, usize)>,
    rule: &dyn Fn(&str) -> bool,
) -> Option<&'static str> {
    if crate::parameters::nodes(value).any(|node| node.get("capture").is_some() || node.get("captured").is_some()) {
        return Some("an argument cannot read or declare captures");
    }
    if let Some(body) = value.get("body") {
        if !exact(value, &["body"], &[]) {
            return Some("a malformed body argument");
        }
        pending.push((Part::Expr { whole: true, flags: super::ExprFlags::default() }, body, depth));
    } else if let Some(targets) = value.get("targets") {
        if !exact(value, &["targets"], &[]) {
            return Some("a malformed target choice");
        }
        let Some(targets) = targets.as_array().filter(|xs| xs.len() >= 2) else {
            return Some("a malformed target choice");
        };
        pending.extend(targets.iter().map(|target| (Part::Target, target, depth)));
    } else if let Some(requirements) = value.get("requirements").filter(|_| value.get("test").is_none()) {
        if !exact(value, &["requirements"], &[]) {
            return Some("a malformed requirement list");
        }
        pending.push((Part::Requirements, requirements, depth));
    } else if value.get("rule").is_some() {
        if !exact(value, &["rule"], &[]) || !value.get("rule").and_then(Json::as_str).is_some_and(rule) {
            return Some("a malformed nominal rule argument");
        }
    } else {
        let kind = if ["test", "range", "wildcard"].iter().any(|key| value.get(key).is_some()) {
            Part::Expr { whole: false, flags: super::ExprFlags::default() }
        } else {
            Part::Term
        };
        pending.push((kind, value, depth));
    }
    None
}

pub(super) fn elidable(value: &Json) -> bool {
    let mut head = value.get("seq").and_then(Json::as_array).and_then(|xs| xs.first()).unwrap_or(value);
    while let Some(inner) = head.get("expr").filter(|_| head.get("test").is_some()) {
        head = inner;
    }
    head.get("param").is_some() || elidable_head_json(value).is_some()
}
