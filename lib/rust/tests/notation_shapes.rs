//! A bootstrap of another notation gives the reader a tree of another
//! shape (engine §9). Every library reads through a wrapper, and needs the
//! parts of each rule that it knows. `tests/notation-shapes.json` holds the
//! outcome that every library gives.

mod common;

use common::{parse_json, repository, Value};

fn read(path: &[&str]) -> String {
    let path = path.iter().fold(repository(), |path, part| path.join(part));
    std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

/// Loads the document with a bootstrap, and parses each input: its
/// brackets, or the kind of its error. A load that fails gives the kind of
/// its error.
fn outcome(shapes: &Value, bootstrap: String) -> Value {
    let document = shapes.get("document").and_then(Value::str).expect("a document").to_string();
    let sources = [
        ("p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string()),
        ("g.md", document),
        ("notation/bootstrap.json", bootstrap),
    ];
    let kind = |debug: String| Value::String(debug.to_lowercase());
    let dialect = match gencmu::load_dialect_sources(sources, "p.md") {
        Ok(dialect) => dialect,
        Err(error) => return kind(format!("{:?}", error.kind)),
    };
    let inputs = shapes.get("inputs").expect("inputs").array();
    Value::Array(
        inputs
            .iter()
            .map(|input| {
                let result = dialect.parse(input.str().expect("an input"), &Default::default()).expect("a parse");
                match &result.error {
                    None => Value::String(gencmu::to_brackets(&result, false)),
                    Some(error) => kind(format!("{:?}", error.kind)),
                }
            })
            .collect(),
    )
}

#[test]
fn notation_shapes() {
    let shapes = parse_json(&read(&["tests", "notation-shapes.json"])).expect("notation-shapes.json");
    let bootstrap = read(&["grammars", "notation", "bootstrap.json"]);
    let syntax_at = bootstrap.find(r#""path":"notation/syntax.md""#).expect("the syntax document");
    let names: Vec<String> = parse_json(&bootstrap)
        .expect("bootstrap.json")
        .get("stages")
        .expect("stages")
        .array()
        .iter()
        .flat_map(|stage| stage.get("documents").expect("documents").array().iter())
        .filter(|document| document.get("path").and_then(Value::str) == Some("notation/syntax.md"))
        .flat_map(|document| document.get("dom").expect("dom").get("rules").expect("rules").array().iter())
        .map(|rule| rule.get("name").and_then(Value::str).expect("a rule's name").to_string())
        .filter(|name| name != "text")
        .collect();
    let with_syntax = |change: &dyn Fn(String) -> String| {
        format!("{}{}", &bootstrap[..syntax_at], change(bootstrap[syntax_at..].to_string()))
    };
    let control = shapes.get("control").expect("control");
    assert_eq!(&outcome(&shapes, bootstrap.clone()), control, "the bundled bootstrap");
    // A wrapper around each rule of the notation changes nothing.
    let wrapped = with_syntax(&|mut syntax: String| {
        let mut wrappers = String::new();
        for (index, name) in names.iter().enumerate() {
            syntax = syntax.replace(&format!(r#"{{"ref":"{name}"}}"#), &format!(r#"{{"ref":"{name}-wrapper"}}"#));
            wrappers.push_str(&format!(
                r#"{{"name":"{name}-wrapper","op":"define","alternatives":[{{"guards":[],"expr":{{"ref":"{name}"}}}}],"conditions":[],"at":[{},1]}},"#,
                100_000 + index
            ));
        }
        syntax.replacen(r#""rules":["#, &format!(r#""rules":[{wrappers}"#), 1)
    });
    assert_eq!(&outcome(&shapes, wrapped), control, "a wrapper around each rule");
    // Each renamed rule gives the outcome of every library.
    let loads = shapes.get("loads").expect("loads");
    for name in &names {
        let renamed = with_syntax(&|syntax: String| {
            syntax
                .replace(&format!(r#""name":"{name}","op""#), &format!(r#""name":"{name}x","op""#))
                .replace(&format!(r#"{{"ref":"{name}"}}"#), &format!(r#"{{"ref":"{name}x"}}"#))
        });
        let expected = loads.get(name).cloned().unwrap_or_else(|| Value::String("grammar".to_string()));
        assert_eq!(outcome(&shapes, renamed), expected, "{name} renamed");
    }
    for (name, _) in loads.object() {
        assert!(names.contains(name), "{name} is no rule of the notation");
    }
}
