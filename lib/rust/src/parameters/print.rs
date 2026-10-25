//! Canonical instance names. Pattern spelling follows the reference reader.
use super::*;
fn quoted(s: &str, u: &Unicode) -> String {
    crate::tags::string_name(s, u)
}

fn term_group(n: &Json, parent: &str, index: usize) -> bool {
    if has(n, "if") {
        return true;
    }
    let Some(key) = ["concat", "union", "intersection", "difference"].into_iter().find(|k| has(n, k)) else {
        return false;
    };
    if key == "union"
        && (list(get(n, key)).iter().all(|x| has(x, "tag")) || list(get(n, key)).iter().all(|x| has(x, "string")))
    {
        return parent == "intersection" || parent == "difference";
    }
    let priority = |k| match k {
        "union" | "difference" => 1,
        "intersection" => 2,
        "concat" => 3,
        "method" => 4,
        _ => 0,
    };
    priority(key) < priority(parent)
        || priority(key) == priority(parent)
            && (parent == "intersection" || index > 0 && (parent == "union" || parent == "difference"))
}
fn boolean_group(n: &Json, parent: &str) -> bool {
    let Some(key) = ["if", "any", "all", "not"].into_iter().find(|k| has(n, k)) else {
        return false;
    };
    let priority = |k| match k {
        "if" => 1,
        "any" => 2,
        "all" => 3,
        "not" => 4,
        _ => 0,
    };
    priority(key) < priority(parent) || priority(key) == priority(parent) && parent != "not"
}
pub(crate) fn canonical(n: &Json, u: &Unicode) -> String {
    let p = |n: &Json| canonical(n, u);
    if has(n, "call") {
        return format!(
            "{}({})",
            text(get(n, "call")),
            list(get(n, "args")).iter().map(p).collect::<Vec<_>>().join(", ")
        );
    }
    if has(n, "param") {
        return format!("@{}", text(get(n, "param")));
    }
    for k in ["rule", "tag", "terminal", "ref", "name", "integer", "classifier"] {
        if has(n, k) {
            return text(get(n, k)).into();
        }
    }
    for k in ["const", "constant"] {
        if has(n, k) {
            return format!("${}", text(get(n, k)));
        }
    }
    if has(n, "string") {
        return quoted(text(get(n, "string")), u);
    }
    if has(n, "literal") {
        return p(get(n, "literal"));
    }
    if has(n, "range") {
        return list(get(n, "range")).iter().map(p).collect::<Vec<_>>().join("..");
    }
    for (k, s) in [("wildcard", "_"), ("empty", "ε"), ("emptySet", "∅")] {
        if has(n, k) {
            return s.into();
        }
    }
    if has(n, "requirements") && !has(n, "test") {
        return format!(
            "<{}>",
            list(get(n, "requirements"))
                .iter()
                .map(|r| format!(
                    "{}{}",
                    if get(r, "negated") == &Json::Bool(true) { "¬" } else { "" },
                    p(get(r, "value"))
                ))
                .collect::<Vec<_>>()
                .join(" ")
        );
    }
    if has(n, "targets") {
        return list(get(n, "targets")).iter().map(p).collect::<Vec<_>>().join(" | ");
    }
    if has(n, "body") {
        let b = get(n, "body");
        let s = body(b, u, "");
        return if ["empty", "optional", "repeat"].iter().any(|k| has(b, k)) { s } else { format!("({s})") };
    }
    if has(n, "test") {
        return format!(
            "{}{}",
            p(get(n, "expr")),
            if text(get(n, "test")) == "tags" {
                p(&obj([("requirements", get(n, "requirements").clone())]))
            } else {
                format!("{}{}", text(get(n, "test")), p(get(n, "value")))
            }
        );
    }
    if has(n, "pattern") {
        return crate::patterns::shapes::text(get(n, "pattern"), &|n| canonical(n, u), true);
    }
    for (k, op) in [("concat", " ++ "), ("union", " ∪ "), ("intersection", " ∩ "), ("difference", " ∖ ")] {
        if !has(n, k) {
            continue;
        }
        let xs = list(get(n, k));
        if k == "union" && (xs.iter().all(|x| has(x, "tag")) || xs.iter().all(|x| has(x, "string"))) {
            return xs.iter().map(p).collect::<Vec<_>>().join(" ");
        }
        return xs
            .iter()
            .enumerate()
            .map(|(i, x)| {
                let s = p(x);
                if term_group(x, k, i) {
                    format!("({s})")
                } else {
                    s
                }
            })
            .collect::<Vec<_>>()
            .join(op);
    }
    if has(n, "method") {
        let name = text(get(n, "method"));
        let sep =
            if ["matches", "begins", "ends", "followed-by", "preceded-by"].contains(&name) { " | " } else { ", " };
        let xs = list(get(n, "args"));
        let args =
            if xs.is_empty() { String::new() } else { format!("({})", xs.iter().map(p).collect::<Vec<_>>().join(sep)) };
        let r = get(n, "receiver");
        let s = p(r);
        let s = if term_group(r, "method", 0) { format!("({s})") } else { s };
        return format!("{s}.{name}{args}");
    }
    if has(n, "capture") {
        return format!("${}", text(get(n, "capture")));
    }
    if has(n, "if") {
        let c = get(n, "if");
        let s = p(c);
        let s = if boolean_group(c, "if") { format!("({s})") } else { s };
        return format!("{s} ⟹ {}", p(get(n, "then")));
    }
    if has(n, "op") {
        return [get(n, "left"), get(n, "right")]
            .iter()
            .map(|x| {
                let s = p(x);
                if has(x, "if") {
                    format!("({s})")
                } else {
                    s
                }
            })
            .collect::<Vec<_>>()
            .join(&format!(" {} ", text(get(n, "op"))));
    }
    if has(n, "not") {
        let x = get(n, "not");
        let s = p(x);
        return if boolean_group(x, "not") { format!("¬({s})") } else { format!("¬{s}") };
    }
    for (k, op) in [("any", " ∨ "), ("all", " ∧ ")] {
        if has(n, k) {
            return list(get(n, k))
                .iter()
                .map(|x| {
                    let s = p(x);
                    if boolean_group(x, k) {
                        format!("({s})")
                    } else {
                        s
                    }
                })
                .collect::<Vec<_>>()
                .join(op);
        }
    }
    if has(n, "captured") {
        return format!("${}", text(get(n, "captured")));
    }
    String::new()
}
fn body(n: &Json, u: &Unicode, parent: &str) -> String {
    let priority = |k| match k {
        "seq" => 3,
        "and" => 2,
        "choice" | "ranked" => 1,
        _ => 0,
    };
    for (k, op) in [("seq", " "), ("and", " & "), ("choice", " | "), ("ranked", " ≻ ")] {
        if has(n, k) {
            let s = list(get(n, k)).iter().map(|x| body(x, u, k)).collect::<Vec<_>>().join(op);
            return if !parent.is_empty() && priority(k) <= priority(parent) { format!("({s})") } else { s };
        }
    }
    if has(n, "optional") {
        return format!(
            "[{}{}]",
            if get(n, "elidable") == &Json::Bool(true) { "+" } else { "" },
            body(get(n, "optional"), u, "")
        );
    }
    if has(n, "repeat") {
        return format!(
            "{{{}{}{}{}}}",
            if text(get(n, "chain")) == "left" { "... " } else { "" },
            body(get(n, "repeat"), u, ""),
            if text(get(n, "chain")) == "right" { " ..." } else { "" },
            n.get("separator").map_or(String::new(), |s| format!(" / {}", body(s, u, "")))
        );
    }
    canonical(n, u)
}
