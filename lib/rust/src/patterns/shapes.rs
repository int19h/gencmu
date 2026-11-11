//! The layered pattern constructors and their canonical spelling.

use crate::dom;
use crate::json::Json;
use crate::tags;
use std::borrow::Cow;

type NameTest<'a> = Option<&'a dyn Fn(&str) -> bool>;
type TestProblem<'a> = Option<&'a dyn Fn(&Json) -> Option<String>>;
#[derive(Default)]
pub(crate) struct Inspection<'a> {
    pub name: NameTest<'a>,
    pub terminal: NameTest<'a>,
    pub test: TestProblem<'a>,
    pub depth: usize,
    pub defer_depth: bool,
}
fn has(n: &Json, key: &str) -> bool {
    n.get(key).is_some()
}
fn get<'a>(n: &'a Json, key: &str) -> &'a Json {
    {
        static ABSENT: Json = Json::Null;
        n.get(key).unwrap_or(&ABSENT)
    }
}
fn only(n: &Json, keys: &[&str]) -> bool {
    n.as_object().is_some_and(|fields| fields.len() == keys.len() && keys.iter().all(|k| has(n, k)))
}
fn position(n: &Json) -> bool {
    n.as_array().is_some_and(|a| {
        a.len() == 2 && a.iter().all(|v| v.as_int().is_some_and(|x| (1..=dom::DOM_MAX_POSITION).contains(&x)))
    })
}
fn string_term(n: &Json) -> bool {
    if only(n, &["string"]) {
        return get(n, "string").as_str().is_some();
    }
    for key in ["const", "param"] {
        if only(n, &[key, "at"]) {
            return position(get(n, "at"))
                && get(n, key).as_str().is_some_and(|s| {
                    if key == "const" {
                        dom::is_constant_name(s)
                    } else {
                        tags::is_name(s)
                    }
                });
        }
    }
    false
}
fn rule_name(s: &str) -> bool {
    s.chars().next().is_some_and(|c| c.is_ascii_lowercase()) && tags::is_name(s)
        || s.chars().count() == 1 && !s.is_ascii()
}
fn terminal_name(s: &str) -> bool {
    dom::is_constant_name(s) || s.starts_with('_')
}
fn terminal_atom(n: &Json) -> bool {
    n.as_object().is_some()
        && !has(n, "exact")
        && !has(n, "children")
        && ["terminal", "literal", "range", "wildcard", "constant", "param"].iter().any(|k| has(n, k))
}
fn set(n: &Json) -> Option<&'static str> {
    ["union", "intersection", "difference"].into_iter().find(|k| has(n, k))
}
#[derive(Clone, Copy)]
struct Frame<'a> {
    node: &'a Json,
    item: bool,
    repeated: bool,
    inner: bool,
    depth: usize,
}
impl<'a> Frame<'a> {
    fn child(self, node: &'a Json, item: bool, repeated: bool, inner: bool) -> Self {
        Self { node, item, repeated, inner, depth: self.depth + 1 }
    }
    fn items(self, array: &'a Json, repeated: bool, empty: bool, pending: &mut Vec<Self>) -> bool {
        let Some(items) = array.as_array() else { return false };
        if !empty && items.is_empty() {
            return false;
        }
        pending.extend(items.iter().map(|node| self.child(node, true, repeated, false)));
        true
    }
}
pub(crate) fn problem(root: &Json, inspect: &Inspection<'_>) -> Option<String> {
    inspect_shape(root, inspect).err()
}
fn inspect_shape(root: &Json, inspect: &Inspection<'_>) -> Result<(), String> {
    let name = inspect.name.unwrap_or(&rule_name);
    let terminal = inspect.terminal.unwrap_or(&terminal_name);
    let requirement_term = |n: &Json| {
        string_term(n) && !has(n, "string")
            || only(n, &["tag"]) && get(n, "tag").as_str().is_some_and(|name| name == "_Elided" || terminal(name))
    };
    let mut pending = vec![Frame { node: root, item: false, repeated: false, inner: false, depth: inspect.depth }];
    while let Some(t) = pending.pop() {
        if !inspect.defer_depth && t.depth > 256 {
            return Err("nested too deeply".into());
        }
        let n = t.node;
        if n.as_object().is_none() {
            return Err("a malformed pattern".into());
        }
        if t.item {
            if only(n, &["child"]) {
                pending.push(t.child(get(n, "child"), false, false, false));
            } else if only(n, &["siblings"]) {
                if get(n, "siblings").as_bool() != Some(true) {
                    return Err("a malformed sibling ellipsis".into());
                }
                if t.repeated {
                    return Err("a sibling ellipsis cannot be a repeat item or separator".into());
                }
            } else if only(n, &["optional"]) {
                if !t.items(get(n, "optional"), t.repeated, false, &mut pending) {
                    return Err("a malformed pattern optional".into());
                }
            } else if only(n, &["repeat"]) || only(n, &["repeat", "separator"]) {
                if !t.items(get(n, "repeat"), true, false, &mut pending)
                    || has(n, "separator") && !t.items(get(n, "separator"), true, false, &mut pending)
                {
                    return Err("a malformed pattern repeat".into());
                }
            } else if only(n, &["choice"]) {
                let arms = get(n, "choice").as_array().filter(|a| a.len() >= 2).ok_or("a malformed pattern choice")?;
                for arm in arms {
                    if !t.items(arm, t.repeated, false, &mut pending)
                        || arm.as_array().is_some_and(|a| a.len() == 1 && has(&a[0], "choice"))
                    {
                        return Err("a malformed pattern choice".into());
                    }
                }
            } else {
                return Err("a malformed pattern child item".into());
            }
            continue;
        }
        if has(n, "never") {
            if !(only(n, &["never"]) || only(n, &["never", "at"]) && position(get(n, "at")))
                || get(n, "never").as_bool() != Some(true)
                || t.inner
            {
                return Err("a malformed empty pattern".into());
            }
            continue;
        }
        if let Some(key) = set(n) {
            if !only(n, &[key]) {
                return Err("a malformed pattern".into());
            }
            let operands = get(n, key)
                .as_array()
                .filter(|a| a.len() >= 2 && (key != "difference" || a.len() == 2))
                .ok_or("a malformed pattern")?;
            if key != "difference" && operands.iter().any(|v| has(v, key)) {
                return Err("a nested pattern set must be flat".into());
            }
            pending.extend(operands.iter().map(|v| t.child(v, false, false, false)));
            continue;
        }
        if has(n, "path") {
            if !only(n, &["path", "pattern"])
                || !matches!(get(n, "path").as_str(), Some("descendant" | "first" | "last"))
            {
                return Err("a malformed pattern path".into());
            }
            pending.push(t.child(get(n, "pattern"), false, false, false));
            continue;
        }
        let forms = ["name", "call", "param", "terminal", "literal", "range", "wildcard", "constant", "test", "any"]
            .into_iter()
            .filter(|k| has(n, k))
            .collect::<Vec<_>>();
        if forms.len() != 1 {
            return Err("a malformed pattern node test".into());
        }
        let key = forms[0];
        let mut fields = vec![key];
        if has(n, "exact") {
            if get(n, "exact").as_bool() != Some(true) || t.inner {
                return Err("a malformed exact pattern prefix".into());
            }
            fields.push("exact");
        }
        if has(n, "children") {
            if t.inner || !matches!(key, "name" | "call" | "param" | "any") {
                return Err("a child list requires a rule test".into());
            }
            fields.push("children");
        }
        if key == "test" {
            if get(n, "test").as_str() == Some("tags") {
                fields.extend(["requirements", "expr"]);
                let Some(requirements) = get(n, "requirements").as_array().filter(|_| {
                    let e = get(n, "expr");
                    terminal_atom(e)
                        || ["name", "call", "param"].iter().any(|key| has(e, key))
                            && !has(e, "exact")
                            && !has(e, "children")
                }) else {
                    return Err("a pattern tag test requires a node atom".into());
                };
                for requirement in requirements {
                    if !only(requirement, &["value", "negated"])
                        || get(requirement, "negated").as_bool().is_none()
                        || !requirement_term(get(requirement, "value"))
                    {
                        return Err("a malformed pattern requirement".into());
                    }
                }
            } else {
                fields.extend(["value", "expr"]);
                let expr = get(n, "expr");
                let target =
                    if get(expr, "test").as_str() == Some("tags") && !has(expr, "exact") && !has(expr, "children") {
                        get(expr, "expr")
                    } else {
                        expr
                    };
                let rule_atom = ["name", "call", "param"].iter().any(|key| has(target, key))
                    && !has(target, "exact")
                    && !has(target, "children");
                if !matches!(get(n, "test").as_str(), Some("=" | "≠")) || !(terminal_atom(target) || rule_atom) {
                    return Err("a pattern value test requires an undecorated atom".into());
                }
                if !string_term(get(n, "value")) {
                    return Err("a malformed pattern value test".into());
                }
            }
            if let Some(problem) = inspect.test.and_then(|test| test(n)) {
                return Err(problem);
            }
            if let Some(expr) = n.get("expr") {
                pending.push(t.child(expr, false, false, true));
            }
        } else if key == "any" {
            if get(n, "any").as_bool() != Some(true) || !has(n, "children") {
                return Err("a malformed bare child list".into());
            }
        } else {
            fields.push("at");
            if !position(get(n, "at")) {
                return Err("a malformed pattern position".into());
            }
            let value = get(n, key);
            match key {
                "call" => {
                    fields.push("args");
                    if !value.as_str().is_some_and(name)
                        || !get(n, "args")
                            .as_array()
                            .is_some_and(|a| !a.is_empty() && a.iter().all(|v| v.as_object().is_some()))
                    {
                        return Err("a malformed pattern call".into());
                    }
                }
                "name" if !value.as_str().is_some_and(name) => return Err("a malformed pattern rule name".into()),
                "param" | "constant" => {
                    if !value.as_str().is_some_and(|s| {
                        if key == "param" {
                            tags::is_name(s)
                        } else {
                            dom::is_constant_name(s)
                        }
                    }) {
                        return Err("a malformed pattern reference".into());
                    }
                }
                "terminal" if !value.as_str().is_some_and(|name| name != "_Elided" && terminal(name)) => {
                    return Err("a malformed pattern terminal".into())
                }
                "wildcard" if value.as_bool() != Some(true) => return Err("a malformed pattern wildcard".into()),
                "literal" if !string_term(value) || !has(value, "string") => {
                    return Err("a malformed pattern literal".into())
                }
                "range" if !value.as_array().is_some_and(|a| a.len() == 2 && a.iter().all(string_term)) => {
                    return Err("a malformed pattern range".into())
                }
                _ => {}
            }
        }
        if !only(n, &fields) {
            return Err("a malformed pattern node test".into());
        }
        if has(n, "children") && !t.items(get(n, "children"), false, true, &mut pending) {
            return Err("a malformed pattern child list".into());
        }
    }
    Ok(())
}

enum Task<'a> {
    Text(&'a str),
    Pattern(&'a Json),
    Items(&'a [Json]),
    Item(&'a Json),
    Term(Cow<'a, Json>),
}
fn atom(n: &Json) -> bool {
    set(n).is_none() && !has(n, "path")
}
// Ordinary terms use the caller's printer and share its Unicode configuration.
pub(crate) fn text(root: &Json, term: &dyn Fn(&Json) -> String, literal: bool) -> String {
    let mut out = String::new();
    let mut pending = Vec::new();
    if literal {
        out.push('#');
        if !atom(root) {
            out.push('(');
            pending.push(Task::Text(")"));
        }
    }
    pending.push(Task::Pattern(root));
    while let Some(task) = pending.pop() {
        let mut tasks = Vec::new();
        match task {
            Task::Text(s) => out.push_str(s),
            Task::Term(n) => out.push_str(&term(&n)),
            Task::Items(items) => {
                for (i, item) in items.iter().enumerate() {
                    if i > 0 {
                        tasks.push(Task::Text(" "));
                    }
                    let grouped =
                        items.len() > 1 && (has(item, "choice") || item.get("child").is_some_and(|v| set(v).is_some()));
                    if grouped {
                        tasks.push(Task::Text("("));
                    }
                    tasks.push(Task::Item(item));
                    if grouped {
                        tasks.push(Task::Text(")"));
                    }
                }
            }
            Task::Item(n) => {
                if let Some(child) = n.get("child") {
                    tasks.push(Task::Pattern(child));
                } else if has(n, "siblings") {
                    out.push('⋯');
                } else if let Some(items) = n.get("optional") {
                    tasks.extend([Task::Text("["), Task::Items(items.as_array().unwrap()), Task::Text("]")]);
                } else if let Some(items) = n.get("repeat") {
                    tasks.extend([Task::Text("{"), Task::Items(items.as_array().unwrap())]);
                    if let Some(items) = n.get("separator") {
                        tasks.extend([Task::Text(" / "), Task::Items(items.as_array().unwrap())]);
                    }
                    tasks.push(Task::Text("}"));
                } else {
                    for (i, arm) in get(n, "choice").as_array().unwrap().iter().enumerate() {
                        if i > 0 {
                            tasks.push(Task::Text(" | "));
                        }
                        tasks.push(Task::Items(arm.as_array().unwrap()));
                    }
                }
            }
            Task::Pattern(n) => {
                if let Some(axis) = n.get("path").and_then(Json::as_str) {
                    if axis != "first" {
                        tasks.push(Task::Text(if axis == "last" { "⋱ " } else { "⋮ " }));
                    }
                    let operand = get(n, "pattern");
                    if !atom(operand) {
                        tasks.push(Task::Text("("));
                    }
                    tasks.push(Task::Pattern(operand));
                    if !atom(operand) {
                        tasks.push(Task::Text(")"));
                    }
                    if axis == "first" {
                        tasks.push(Task::Text(" ⋰"));
                    }
                } else if get(n, "never").as_bool() == Some(true) {
                    tasks.push(Task::Text("∅"));
                } else if let Some(key) = set(n) {
                    for (i, child) in get(n, key).as_array().unwrap().iter().enumerate() {
                        if i > 0 {
                            tasks.push(Task::Text(match key {
                                "union" => " ∪ ",
                                "intersection" => " ∩ ",
                                _ => " ∖ ",
                            }));
                        }
                        let grouped = key == "intersection" && (has(child, "union") || has(child, "difference"))
                            || key == "difference" && i == 1 && (has(child, "union") || has(child, "difference"))
                            || key == "union" && i > 0 && has(child, "difference");
                        if grouped {
                            tasks.push(Task::Text("("));
                        }
                        tasks.push(Task::Pattern(child));
                        if grouped {
                            tasks.push(Task::Text(")"));
                        }
                    }
                } else {
                    if get(n, "exact").as_bool() == Some(true) {
                        tasks.push(Task::Text("·"));
                    }
                    if let Some(test) = n.get("test").and_then(Json::as_str) {
                        if let Some(expr) = n.get("expr") {
                            tasks.push(Task::Pattern(expr));
                        }
                        if test == "tags" {
                            let requirements = Json::Obj(vec![("requirements".into(), get(n, "requirements").clone())]);
                            tasks.push(Task::Term(Cow::Owned(requirements)));
                        } else {
                            tasks.extend([Task::Text(test), Task::Term(Cow::Borrowed(get(n, "value")))]);
                        }
                    } else if let Some(value) = n.get("literal") {
                        tasks.push(Task::Term(Cow::Borrowed(value)));
                    } else if let Some(values) = n.get("range").and_then(Json::as_array) {
                        tasks.extend([
                            Task::Term(Cow::Borrowed(&values[0])),
                            Task::Text(".."),
                            Task::Term(Cow::Borrowed(&values[1])),
                        ]);
                    } else if has(n, "wildcard") {
                        tasks.push(Task::Text("_"));
                    } else if let Some(name) = n.get("constant").and_then(Json::as_str) {
                        tasks.extend([Task::Text("$"), Task::Text(name)]);
                    } else if !has(n, "any") {
                        tasks.push(Task::Term(Cow::Borrowed(n)));
                    }
                    if let Some(items) = n.get("children").and_then(Json::as_array) {
                        if items.is_empty() {
                            tasks.push(Task::Text("⁅⁆"));
                        } else {
                            tasks.extend([Task::Text("⁅ "), Task::Items(items), Task::Text(" ⁆")]);
                        }
                    }
                }
            }
        }
        pending.extend(tasks.into_iter().rev());
    }
    out
}
