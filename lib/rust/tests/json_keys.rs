mod common;

use common::{parse_json, repository, Value};
use std::collections::BTreeMap;

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::str).expect(key)
}
fn flag(value: &Value, key: &str) -> bool {
    value.get(key) == Some(&Value::Bool(true))
}
fn mutate(source: &str, case: &Value) -> String {
    let find = text(case, "find");
    assert!(source.contains(find), "{}", text(case, "description"));
    source.replacen(find, text(case, "replace"), 1)
}

#[test]
fn shared_json_keys() {
    let fixtures = parse_json(&std::fs::read_to_string(repository().join("tests/json-keys.json")).unwrap()).unwrap();
    let bundled = std::fs::read_to_string(repository().join("grammars/notation/bootstrap.json")).unwrap();
    let sources = || {
        BTreeMap::from([
            ("p.md".to_string(), "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string()),
            ("g.md".to_string(), text(&fixtures, "grammar").to_string()),
        ])
    };
    for case in fixtures.get("values").unwrap().array() {
        assert_eq!(
            &parse_json(text(case, "json")).unwrap(),
            case.get("expect").unwrap(),
            "{}",
            text(case, "description")
        );
    }
    for case in fixtures.get("bootstrap").unwrap().array() {
        let mut sources = sources();
        sources.insert("notation/bootstrap.json".into(), mutate(&bundled, case));
        let outcome = gencmu::load_dialect_sources(sources, "p.md");
        if flag(case, "loads") {
            let dialect = outcome.unwrap_or_else(|e| panic!("{}: {e}", text(case, "description")));
            assert!(dialect.parse("a", &Default::default()).unwrap().ok, "{}", text(case, "description"));
        } else {
            let e = outcome.err().unwrap_or_else(|| panic!("{} loaded", text(case, "description")));
            assert_eq!(
                (e.kind, e.document.as_deref(), e.stage.as_deref(), e.line, e.column),
                (gencmu::ErrorKind::Grammar, Some("notation/bootstrap.json"), None, None, None),
                "{}: {e}",
                text(case, "description")
            );
            assert!(e.message.starts_with("notation/bootstrap.json:"));
        }
    }
    for case in fixtures.get("compiled").unwrap().array() {
        let cache = mutate(text(&fixtures, "cache"), case)
            .replace("@bootstrap@", &gencmu::tools::fnv1a64(&bundled))
            .replace("@source@", &gencmu::tools::fnv1a64(text(&fixtures, "grammar")));
        let mut sources = sources();
        sources.insert("compiled.json".into(), cache);
        let dialect = gencmu::load_dialect_sources(sources, "p.md")
            .unwrap_or_else(|e| panic!("{}: {e}", text(case, "description")));
        assert_eq!(
            dialect.parse("a", &Default::default()).unwrap().ok,
            !flag(case, "cached"),
            "{}",
            text(case, "description")
        );
        assert_eq!(
            dialect.parse("b", &Default::default()).unwrap().ok,
            flag(case, "cached"),
            "{}",
            text(case, "description")
        );
    }
}
