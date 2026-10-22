//! Canonical instance names. Pattern spelling follows the reference reader.
use super::*;
fn quoted(s: &str, u: &Unicode) -> String {
    use std::fmt::Write;
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '\"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\x08' => out.push_str("\\b"),
            '\t' => out.push_str("\\t"),
            '\n' => out.push_str("\\n"),
            '\x0c' => out.push_str("\\f"),
            '\r' => out.push_str("\\r"),
            c if (c as u32) < 32 || crate::tags::string_name(&c.to_string(), u).starts_with("$_") => {
                let mut buf = [0; 2];
                for unit in c.encode_utf16(&mut buf) {
                    write!(out, "\\u{unit:04x}").unwrap()
                }
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
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
    for k in ["rule", "tag", "terminal", "ref", "name"] {
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
        return format!("#({})", pattern(get(n, "pattern"), u));
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
            .map(|x| {
                let s = p(x);
                if ["concat", "union", "intersection", "difference"].iter().any(|k| has(x, k)) {
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
        let s = if ["concat", "union", "intersection", "difference"].iter().any(|k| has(r, k)) {
            format!("({s})")
        } else {
            s
        };
        return format!("{s}.{name}{args}");
    }
    if has(n, "capture") {
        return format!("${}", text(get(n, "capture")));
    }
    if has(n, "if") {
        return format!("({} ⟹ {})", p(get(n, "if")), p(get(n, "then")));
    }
    if has(n, "op") {
        return format!("{} {} {}", p(get(n, "left")), text(get(n, "op")), p(get(n, "right")));
    }
    if has(n, "not") {
        return format!("¬{}", p(get(n, "not")));
    }
    for (k, op) in [("any", " ∨ "), ("all", " ∧ ")] {
        if has(n, k) {
            return format!("({})", list(get(n, k)).iter().map(p).collect::<Vec<_>>().join(op));
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
fn pattern(n: &Json, u: &Unicode) -> String {
    let p = |n: &Json| pattern(n, u);
    if has(n, "node") || has(n, "children") {
        return p(n.get("node").unwrap_or_else(|| get(n, "children")));
    }
    if has(n, "sequence") {
        return list(get(n, "sequence")).iter().map(p).collect::<Vec<_>>().join(" ");
    }
    if has(n, "siblings") {
        return "⋯".into();
    }
    if has(n, "path") {
        let s = p(get(n, "pattern"));
        return match text(get(n, "path")) {
            "first" => format!("({s}) ⋰"),
            "last" => format!("⋱ ({s})"),
            _ => format!("⋮ ({s})"),
        };
    }
    if has(n, "optional") {
        return format!("[{}]", p(get(n, "optional")));
    }
    if has(n, "repeat") {
        return format!(
            "{{{}{}}}",
            p(get(n, "repeat")),
            n.get("separator").map_or(String::new(), |s| format!(" / {}", p(s)))
        );
    }
    for (k, op) in [("union", " ∪ "), ("intersection", " ∩ "), ("difference", " ∖ ")] {
        if has(n, k) {
            return list(get(n, k)).iter().map(|x| format!("({})", p(x))).collect::<Vec<_>>().join(op);
        }
    }
    canonical(n, u)
}
