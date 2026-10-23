use super::*;
use crate::json::{self, Json};
use crate::parameters::{self as p, get, list, text};

// Bound tag sets use native tag terms when a typed DOM writes them.
fn expected(root: &Json) -> Json {
    if let Some(tags) = root.get("set") {
        let items = list(tags).iter().map(|tag| p::obj([("tag", tag.clone())])).collect::<Vec<_>>();
        return match items.len() {
            0 => p::obj([("emptySet", Json::Bool(true))]),
            1 => items.into_iter().next().unwrap(),
            _ => p::obj([("union", Json::Arr(items))]),
        };
    }
    match root {
        Json::Obj(fields) => Json::Obj(fields.iter().map(|(key, value)| (key.clone(), expected(value))).collect()),
        Json::Arr(items) => Json::Arr(items.iter().map(expected).collect()),
        value => value.clone(),
    }
}
#[test]
fn shared_layered_value_binding() {
    let fixture = json::parse(include_str!("../../../../tests/layered-pattern-values.json")).unwrap();
    let unicode = Unicode::parse(crate::loader::bundled("unicode.txt").unwrap()).unwrap();
    let mut constants = Constants {
        versions: vec![],
        latest: HashMap::new(),
        stage: "main",
        unicode: &unicode,
        values: HashMap::new(),
    };
    for (name, node) in get(&fixture, "constants").as_object().unwrap() {
        let (value, ty) = if let Some(pattern) = node.get("pattern") {
            (Value::Pattern(Pattern::from_layered_json(pattern).unwrap()), Type::Pattern)
        } else if let Some(tags) = node.get("set") {
            (Value::Set(list(tags).iter().map(|tag| tag.as_str().unwrap().to_string()).collect()), Type::Tags)
        } else {
            (Value::Str(text(get(node, "string")).into()), Type::String)
        };
        constants.values.insert(name.clone(), StageConstant { value, ty, document: Arc::from("values.md") });
    }
    for case in list(get(&fixture, "cases")) {
        let pattern = Pattern::from_layered_json(get(case, "pattern")).unwrap();
        let term = Term::Pattern(Box::new(pattern));
        let result = constants.evaluate_pattern_value(&term, "values.md", (1, 1));
        if let Some(error) = case.get("error") {
            let error_found = result.unwrap_err();
            let at = list(get(error, "at"));
            assert_eq!(
                (error_found.line, error_found.column),
                (Some(at[0].as_int().unwrap() as usize), Some(at[1].as_int().unwrap() as usize)),
                "{}",
                text(get(case, "description"))
            );
        } else {
            let Value::Pattern(pattern) = result.unwrap() else { panic!("a pattern value") };
            let mut out = String::new();
            pattern.write_layered(&mut out);
            let actual = json::parse(&out).unwrap();
            assert_eq!(
                p::identity(&actual),
                p::identity(&expected(get(case, "resolved"))),
                "{}",
                text(get(case, "description"))
            );
        }
    }
}
