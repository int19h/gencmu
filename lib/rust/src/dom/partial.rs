use super::*;
use crate::parameters::{get, has, list, obj, position, string, text, SOURCE};
// Preserve known structure while unresolved leaves have unknown types.
fn partial(value: &Json, kind: &str) -> Json {
    match value {
        Json::Arr(xs) => Json::Arr(xs.iter().map(|x| partial(x, kind)).collect()),
        Json::Obj(fields) => {
            if has(value, "param") || has(value, "call") {
                return match kind {
                    "expr" => obj([("wildcard", Json::Bool(true))]),
                    "pattern" => obj([("constant", string("Unresolved")), ("at", position((1, 1)))]),
                    _ => obj([("const", string("Unresolved")), ("at", position((1, 1)))]),
                };
            }
            let method = text(get(value, "method"));
            Json::Obj(
                fields
                    .iter()
                    .filter(|(key, _)| key != SOURCE)
                    .map(|(key, child)| {
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
                                | "conditions"
                                | "receiver"
                                | "args"
                                | "requirements"
                        ) {
                            next = "term";
                        }
                        let converted = if key == "args"
                            && matches!(
                                method,
                                "tags"
                                    | "matches"
                                    | "begins"
                                    | "ends"
                                    | "followed-by"
                                    | "preceded-by"
                                    | "without-elision-except"
                            ) {
                            Json::Arr(
                                list(child)
                                    .iter()
                                    .map(|arg| {
                                        if has(arg, "param") || has(arg, "call") {
                                            obj([("rule", string("unresolved"))])
                                        } else {
                                            partial(arg, "term")
                                        }
                                    })
                                    .collect(),
                            )
                        } else if key == "receiver"
                            && matches!(method, "followed-by" | "preceded-by")
                            && (has(child, "param") || has(child, "call"))
                        {
                            obj([("capture", string(""))])
                        } else {
                            partial(child, next)
                        };
                        (key.clone(), converted)
                    })
                    .collect(),
            )
        }
        _ => value.clone(),
    }
}

pub(crate) fn rule(rule: &RuleDef) -> Result<RuleDef, String> {
    let mut text = String::new();
    write_rule(&mut text, rule);
    let raw = crate::json::parse(&text)?;
    let mut projected = partial(&raw, "declaration");
    crate::parameters::remove(&mut projected, "params");
    crate::parameters::remove(&mut projected, "args");
    rule_from_json(&projected)
}
