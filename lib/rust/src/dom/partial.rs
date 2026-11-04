use super::*;
use crate::parameters::{get, has, list, obj, position, string, text, SOURCE};
// Preserve known structure while unresolved leaves have unknown types.
fn partial(value: &Json, kind: &str) -> Json {
    enum Task<'a> {
        Node(&'a Json, &'a str),
        Array(usize),
        Object(Vec<String>),
    }
    let mut pending = vec![Task::Node(value, kind)];
    let mut values = Vec::new();
    while let Some(task) = pending.pop() {
        match task {
            Task::Node(value, "targets") => {
                let items = list(value);
                pending.push(Task::Array(items.len()));
                pending.extend(items.iter().rev().map(|item| Task::Node(item, "target")));
            }
            Task::Node(value, kind) => match value {
                Json::Arr(items) => {
                    pending.push(Task::Array(items.len()));
                    pending.extend(items.iter().rev().map(|item| Task::Node(item, kind)));
                }
                Json::Obj(fields) => {
                    if has(value, "param") || has(value, "call") {
                        values.push(match kind {
                            "expr" => obj([("wildcard", Json::Bool(true))]),
                            "pattern" => obj([("constant", string("Unresolved")), ("at", position((1, 1)))]),
                            "target" => obj([("rule", string("unresolved"))]),
                            "boundary" => obj([("capture", string(""))]),
                            _ => obj([("const", string("Unresolved")), ("at", position((1, 1)))]),
                        });
                        continue;
                    }
                    let kind = if kind == "target" { "term" } else { kind };
                    let fields: Vec<_> = fields.iter().filter(|(key, _)| key != SOURCE).collect();
                    pending.push(Task::Object(fields.iter().map(|(key, _)| key.clone()).collect()));
                    let method = text(get(value, "method"));
                    for (key, child) in fields.into_iter().rev() {
                        let mut next = kind;
                        if matches!(
                            key.as_str(),
                            "expr" | "seq" | "choice" | "ranked" | "and" | "optional" | "repeat" | "separator"
                        ) && kind != "pattern"
                        {
                            next = "expr";
                        }
                        if key == "pattern" {
                            next = "pattern";
                        }
                        if matches!(
                            key.as_str(),
                            "literal"
                                | "range"
                                | "tags"
                                | "value"
                                | "image"
                                | "default"
                                | "conditions"
                                | "receiver"
                                | "args"
                                | "requirements"
                        ) {
                            next = "term";
                        }
                        if key == "args"
                            && matches!(
                                method,
                                "tags"
                                    | "matches"
                                    | "begins"
                                    | "ends"
                                    | "followed-by"
                                    | "preceded-by"
                                    | "without-elision-except"
                            )
                        {
                            next = "targets";
                        } else if key == "receiver"
                            && matches!(method, "followed-by" | "preceded-by")
                            && (has(child, "param") || has(child, "call"))
                        {
                            next = "boundary";
                        }
                        pending.push(Task::Node(child, next));
                    }
                }
                _ => values.push(value.clone()),
            },
            Task::Array(count) => {
                let items = values.split_off(values.len() - count);
                values.push(Json::Arr(items));
            }
            Task::Object(keys) => {
                let items = values.split_off(values.len() - keys.len());
                values.push(Json::Obj(keys.into_iter().zip(items).collect()));
            }
        }
    }
    values.pop().unwrap()
}

pub(crate) fn rule(rule: &RuleDef) -> Result<RuleDef, String> {
    let mut text = String::new();
    write_rule(&mut text, rule);
    let raw = crate::json::parse_unbounded(&text)?;
    let mut projected = partial(&raw, "declaration");
    crate::parameters::remove(&mut projected, "params");
    crate::parameters::remove(&mut projected, "args");
    let mut checked = rule_from_json(&projected)?;
    source::restore_rule_locations(&mut checked, rule);
    Ok(checked)
}
