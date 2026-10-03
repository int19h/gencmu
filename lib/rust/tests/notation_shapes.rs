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

/// Loads the document of `shapes` with a bootstrap, and parses each of its
/// inputs: its brackets, or the kind of its error. A load that fails gives
/// the kind of its error.
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
    // A part that the reader does not read is ignored. Each item has its
    // own document and inputs.
    for item in shapes.get("extraParts").expect("extraParts").array() {
        let text = |key: &str| item.get(key).and_then(Value::str).unwrap_or_else(|| panic!("{key}")).to_string();
        let (find, replace) = (text("find"), text("replace"));
        assert_eq!(bootstrap[syntax_at..].matches(&find).count(), 1, "{}", text("description"));
        let changed = with_syntax(&|syntax: String| syntax.replacen(&find, &replace, 1));
        assert_eq!(&outcome(item, changed), item.get("expect").expect("expect"), "{}", text("description"));
    }
}

/// Each notation stage runs the check of `elision-only` where its own
/// directive declares it (engine §8). With `greedy` and `elision-only` on
/// the lexical stage, the check finds the ambiguity that `greedy` settled
/// in the pipeline document itself, and the document does not load.
#[test]
fn a_notation_stage_that_declares_elision_only_runs_the_check() {
    let bootstrap = read(&["grammars", "notation", "bootstrap.json"]);
    let directive = r#""name":"ambiguity-resolution","args":["greedy"]"#;
    let lexical = bootstrap.find(r#""path":"notation/lexical.md""#).expect("the lexical document");
    let syntax = bootstrap.find(r#""path":"notation/syntax.md""#).expect("the syntax document");
    let at = bootstrap.find(directive).expect("the directive");
    assert!(lexical < at && at < syntax, "the first directive is the lexical stage's");
    let elision = bootstrap.replacen(directive, r#""name":"ambiguity-resolution","args":["greedy","elision-only"]"#, 1);
    let sources = |bootstrap: String| {
        [
            ("p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string()),
            ("g.md", "```jbogenbau\n%ambiguity-resolution greedy\n%rule text A B\n```\n".to_string()),
            ("notation/bootstrap.json", bootstrap),
        ]
    };
    // The bundled bootstrap loads the same documents.
    gencmu::load_dialect_sources(sources(bootstrap), "p.md").expect("the bundled bootstrap");
    let error = gencmu::load_dialect_sources(sources(elision), "p.md").expect_err("the check of the lexical stage");
    assert_eq!(error.kind, gencmu::ErrorKind::Grammar, "{error}");
    assert!(error.to_string().contains("lexical stage of the notation"), "{error}");
    assert_eq!(error.line, None, "{error}");
}
