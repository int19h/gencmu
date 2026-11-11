//! A bootstrap of another notation gives the reader a tree of another
//! shape (engine §9). Every library reads through a wrapper, and needs the
//! parts of each rule that it knows. `tests/notation-shapes.json` holds the
//! outcome that every library gives.

mod common;

use common::{find_places, parse_json, repository, substitute, Value};

fn read(path: &[&str]) -> String {
    let path = path.iter().fold(repository(), |path, part| path.join(part));
    std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

#[test]
fn a_captured_tested_target_requires_its_primary_before_its_tests() {
    let bootstrap = read(&["data", "preparsed", "gencmu.json"]).replace(
        r#"{"seq":[{"ref":"untested-primary"},{"repeat":{"ref":"symbol-test"}}]}"#,
        r#"{"literal":{"string":"+"}}"#,
    );
    let sources = [
        ("p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string()),
        ("g.md", "```jbogenbau\n%rule text $x:+\n```\n".to_string()),
        ("data/preparsed/gencmu.json", bootstrap),
    ];
    let error = gencmu::load_pipeline_sources(sources, "p.md").expect_err("the missing primary");
    assert_eq!(error.message, "the notation's tested-primary has no primary");
}

#[test]
fn a_supplied_ranked_choice_error_has_no_syntax_code() {
    let bootstrap = read(&["data", "preparsed", "gencmu.json"]).replace(
        r#"{"seq":[{"ref":"some-of"},{"literal":{"string":"≻"}},{"repeat":{"ref":"some-of"},"separator":{"literal":{"string":"≻"}}}]}"#,
        r#"{"literal":{"string":"."}}"#,
    );
    let sources = [
        ("p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string()),
        ("g.md", "```jbogenbau\n%rule text .\n```\n".to_string()),
        ("data/preparsed/gencmu.json", bootstrap),
    ];
    let error = gencmu::load_pipeline_sources(sources, "p.md").expect_err("the missing conjunctions");
    assert_eq!(error.code(), None);
}

fn load_kind(kind: gencmu::ErrorKind) -> Value {
    Value::String(
        match kind {
            gencmu::ErrorKind::Grammar => "grammar",
            gencmu::ErrorKind::Usage => "usage",
            _ => panic!("the notation runner must name every load error kind"),
        }
        .into(),
    )
}

fn parse_kind(kind: gencmu::ParseErrorKind) -> Value {
    Value::String(common::error_kind(kind).into())
}

#[test]
fn error_kinds_use_shared_names() {
    assert_eq!(parse_kind(gencmu::ParseErrorKind::FeatureConflict), Value::String("feature-conflict".into()));
}

fn outcome(shapes: &Value, bootstrap: String) -> Value {
    let place = shapes.get("where");
    let document = shapes.get("document").and_then(Value::str).expect("a document").to_string();
    let sources = [
        ("p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string()),
        ("g.md", document),
        ("data/preparsed/gencmu.json", bootstrap),
    ];
    let pipeline = match gencmu::load_pipeline_sources(sources, "p.md") {
        Ok(pipeline) => pipeline,
        Err(error) => {
            if let Some(place) = place {
                let expected = (
                    place.get("document").and_then(Value::str),
                    place.get("line").and_then(Value::number).map(|line| line as usize),
                    place.get("column").and_then(Value::number).map(|column| column as usize),
                );
                assert_eq!((error.document.as_deref(), error.line, error.column), expected, "{error}");
            }
            return load_kind(error.kind);
        }
    };
    assert!(place.is_none(), "the document loaded, but the item gives where its error stands");
    let inputs = shapes.get("inputs").expect("inputs").array();
    Value::Array(
        inputs
            .iter()
            .map(|input| {
                let result = pipeline.parse(input.str().expect("an input"), &Default::default()).expect("a parse");
                match &result.error {
                    None => Value::String(gencmu::to_brackets(&result, false)),
                    Some(error) => parse_kind(error.kind),
                }
            })
            .collect(),
    )
}

#[test]
fn notation_shapes() {
    let shapes = parse_json(&read(&["tests", "notation-shapes.json"])).expect("notation-shapes.json");
    let bootstrap = read(&["data", "preparsed", "gencmu.json"]);
    let syntax_at = bootstrap.find(r#""grammars/gencmu/jbogenbau/syntax.md":"#).expect("the syntax document");
    let names: Vec<String> = parse_json(&bootstrap)
        .expect("data/preparsed/gencmu.json")
        .get("documents")
        .unwrap()
        .get("grammars/gencmu/jbogenbau/syntax.md")
        .unwrap()
        .get("dom")
        .unwrap()
        .get("rules")
        .unwrap()
        .array()
        .iter()
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
            for field in ["ref", "rule"] {
                syntax = syntax.replace(&format!(r#""{field}":"{name}""#), &format!(r#""{field}":"{name}-wrapper""#));
            }
            wrappers.push_str(&format!(
                r#"{{"name":"{name}-wrapper","op":"define","alternatives":[{{"gates":[],"expr":{{"ref":"{name}"}}}}],"conditions":[],"at":[{},1]}},"#,
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
            let mut syntax = syntax.replace(&format!(r#""name":"{name}","op""#), &format!(r#""name":"{name}x","op""#));
            for field in ["ref", "rule"] {
                syntax = syntax.replace(&format!(r#""{field}":"{name}""#), &format!(r#""{field}":"{name}x""#));
            }
            syntax
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
        // `find` and `replace` are strings, or arrays of the same length
        // whose pairs apply in order (tests/README.md).
        let texts = |key: &str| match item.get(key).unwrap_or_else(|| panic!("{key}")) {
            Value::Array(items) => items.iter().map(|value| value.str().expect(key).to_string()).collect(),
            _ => vec![text(key)],
        };
        let (finds, replaces): (Vec<String>, Vec<String>) = (texts("find"), texts("replace"));
        assert_eq!(finds.len(), replaces.len(), "{}", text("description"));
        let mut changed = bootstrap.clone();
        for (find, replace) in finds.iter().zip(&replaces) {
            assert_eq!(find_places(&changed, find).len(), 1, "{}", text("description"));
            changed = substitute(&changed, find, replace);
        }
        assert_eq!(&outcome(item, changed), item.get("expect").expect("expect"), "{}", text("description"));
    }
}

#[test]
fn a_notation_stage_that_declares_elision_only_runs_the_check() {
    let bootstrap = read(&["data", "preparsed", "gencmu.json"]);
    let bootstrap = bootstrap.replacen(
        r#""name":"punctuation","op":"define","alternatives":["#,
        r#""name":"punctuation","op":"define","alternatives":[{"gates":[],"expr":{"literal":{"string":"."}}},"#,
        1,
    );
    let directive = r#""name":"ambiguity-resolution","steps":[{"step":"greedy"}]"#;
    let lexical = bootstrap.find(r#""grammars/gencmu/jbogenbau/lexical.md":"#).expect("the lexical document");
    let syntax = bootstrap.find(r#""grammars/gencmu/jbogenbau/syntax.md":"#).expect("the syntax document");
    let at = bootstrap.find(directive).expect("the directive");
    assert!(lexical < at && at < syntax, "the first directive is the lexical stage's");
    // A second directive of the lexical stage, at a column of its own.
    let elision = bootstrap.replacen(
        &format!("{{{directive}"),
        &format!(r#"{{"name":"elision-only","args":[],"at":[20,41]}},{{{directive}"#),
        1,
    );
    let sources = |bootstrap: String| {
        [
            ("p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string()),
            ("g.md", "```jbogenbau\n%ambiguity-resolution greedy\n%rule text {...B}\n```\n".to_string()),
            ("data/preparsed/gencmu.json", bootstrap),
        ]
    };
    // The bundled bootstrap loads the same documents.
    gencmu::load_pipeline_sources(sources(bootstrap), "p.md").expect("the bundled bootstrap");
    let error = gencmu::load_pipeline_sources(sources(elision), "p.md").expect_err("the check of the lexical stage");
    assert_eq!(error.kind, gencmu::ErrorKind::Grammar, "{error}");
    assert!(error.to_string().contains("lexical stage of the notation"), "{error}");
    assert_eq!(error.line, None, "{error}");
}

fn pattern_bootstrap_expr(bootstrap: &Value, name: &str, alternative: usize, tail: &str, expression: &str) -> Value {
    for (rule, contents) in bootstrap
        .get("documents")
        .unwrap()
        .get("grammars/gencmu/jbogenbau/syntax.md")
        .unwrap()
        .get("dom")
        .unwrap()
        .get("rules")
        .unwrap()
        .array()
        .iter()
        .enumerate()
    {
        if contents.get("name").and_then(Value::str) != Some(name) {
            continue;
        }
        let mut path = parse_json(&format!(
            r#"["documents","grammars/gencmu/jbogenbau/syntax.md","dom","rules",{rule},"alternatives",{alternative},"expr"]"#
        ))
        .unwrap()
        .array()
        .to_vec();
        path.extend(parse_json(tail).unwrap().array().iter().cloned());
        return common::apply_mutant(
            bootstrap,
            &Value::Object(vec![("path".into(), Value::Array(path)), ("set".into(), parse_json(expression).unwrap())]),
        );
    }
    panic!("no syntax rule {name}");
}

fn load_pattern_probe(rules: &str, bootstrap: &Value) -> Result<gencmu::Pipeline, gencmu::Error> {
    gencmu::load_pipeline_sources(
        [
            ("p.md", "```jbogenbau\n%stage main\n%include \"main.md\"\n```\n".to_string()),
            ("main.md", format!("```jbogenbau\n%ambiguity-resolution greedy\n{rules}\n```\n")),
            ("data/preparsed/gencmu.json", bootstrap.to_text()),
        ],
        "p.md",
    )
}

fn pattern_probe(rules: &str, bootstrap: &Value, tokens: &[&str]) -> String {
    let pipeline = load_pattern_probe(rules, bootstrap).unwrap_or_else(|error| panic!("{rules}: {error}"));
    let tokens = tokens
        .iter()
        .map(|text| gencmu::InputToken {
            text: (*text).into(),
            tags: [text.to_uppercase()].into_iter().collect(),
            ..Default::default()
        })
        .collect::<Vec<_>>();
    let result = pipeline.parse_tokens(&tokens, &Default::default()).expect("a parse");
    assert!(result.ok, "{rules}: {:?}", result.error);
    gencmu::to_json(&result)
}

#[test]
fn pattern_string_terminal_constructors_and_tests() {
    let bundled = parse_json(&read(&["data", "preparsed", "gencmu.json"])).unwrap();
    let changed =
        pattern_bootstrap_expr(&bundled, "pattern-atom", 0, r#"["seq",0,"choice",2]"#, r#"{"ref":"string-terminal"}"#);
    for rules in [
        "%const $P #\"a\"\n%rule text \"a\"\n%conditions $ ≅ $P",
        "%const $P #(\"a\"=\"a\")\n%rule text \"a\"\n%conditions $ ≅ $P",
        "%const $P #(\"a\"<A>=\"a\")\n%rule text \"a\"\n%conditions $ ≅ $P",
    ] {
        assert_eq!(pattern_probe(rules, &changed, &["a"]), pattern_probe(rules, &bundled, &["a"]));
    }
    // The constructor's constant branch replaces the separate constant
    // alternative here, so the notation still has one reading.
    let constants = pattern_bootstrap_expr(
        &changed,
        "pattern-atom",
        0,
        r#"["seq",0]"#,
        r#"{"choice":[{"ref":"pattern-rule"},{"ref":"tag"},{"ref":"string-terminal"},{"ref":"range"},{"ref":"wildcard"}]}"#,
    );
    let rules = "%const $S \"a\"\n%const $P #($S=\"a\")\n%rule text \"a\"\n%conditions $ ≅ $P";
    assert_eq!(pattern_probe(rules, &constants, &["a"]), pattern_probe(rules, &bundled, &["a"]));
    for pattern in ["\"a\"=\"a\"<A>", "\"a\"<A><B>", "\"a\"=\"a\"=\"a\"", "\"‹U+0061›\"=\"a\"<A>"] {
        let rules = format!("%const $P #⁅ {pattern} ⁆\n%rule text A");
        let ordinary = load_pattern_probe(&rules, &bundled).unwrap_err();
        let bootstrap = if pattern.starts_with('$') { &constants } else { &changed };
        let alternate = load_pattern_probe(&rules, bootstrap).unwrap_err();
        assert_eq!(ordinary, alternate, "{pattern}");
        assert_eq!(alternate.kind, gencmu::ErrorKind::Grammar);
        assert!(alternate.message.contains("pattern test target or order"), "{alternate}");
    }
}

#[test]
fn pattern_names_use_named_parts_or_tokens() {
    let bundled = parse_json(&read(&["data", "preparsed", "gencmu.json"])).unwrap();
    for name in ["rule-or-classifier-name", "rule-reference"] {
        let changed = pattern_bootstrap_expr(&bundled, "pattern-rule", 0, "[]", &format!(r#"{{"ref":"{name}"}}"#));
        let rules = "%const $P #child\n%rule text child\n%conditions $ ≅ $P\n%rule child A";
        assert_eq!(pattern_probe(rules, &changed, &["A"]), pattern_probe(rules, &bundled, &["A"]), "{name}");
        let rules = "%const $P #(child=\"‹U+D800›\")\n%rule text A";
        assert_eq!(load_pattern_probe(rules, &changed).unwrap_err(), load_pattern_probe(rules, &bundled).unwrap_err());
    }
}
