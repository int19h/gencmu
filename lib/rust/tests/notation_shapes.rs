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

/// Loads the document of `shapes` with a bootstrap, and parses each of its
/// inputs: its brackets, or the kind of its error. A load that fails gives
/// the kind of its error, and where `shapes` gives `where`, the load must
/// fail at that document, line and column (tests/README.md).
fn outcome(shapes: &Value, bootstrap: String) -> Value {
    let place = shapes.get("where");
    let document = shapes.get("document").and_then(Value::str).expect("a document").to_string();
    let sources = [
        ("p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string()),
        ("g.md", document),
        ("notation/bootstrap.json", bootstrap),
    ];
    let kind = |debug: String| Value::String(debug.to_lowercase());
    let dialect = match gencmu::load_dialect_sources(sources, "p.md") {
        Ok(dialect) => dialect,
        Err(error) => {
            if let Some(place) = place {
                let expected = (
                    place.get("document").and_then(Value::str),
                    place.get("line").and_then(Value::number).map(|line| line as usize),
                    place.get("column").and_then(Value::number).map(|column| column as usize),
                );
                assert_eq!((error.document.as_deref(), error.line, error.column), expected, "{error}");
            }
            return kind(format!("{:?}", error.kind));
        }
    };
    assert!(place.is_none(), "the document loaded, but the item gives where its error stands");
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
                r#"{{"name":"{name}-wrapper","op":"define","flags":[],"alternatives":[{{"guards":[],"expr":{{"ref":"{name}"}}}}],"conditions":[],"at":[{},1]}},"#,
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
        assert_eq!(find_places(&bootstrap, &find).len(), 1, "{}", text("description"));
        let changed = substitute(&bootstrap, &find, &replace);
        assert_eq!(&outcome(item, changed), item.get("expect").expect("expect"), "{}", text("description"));
    }
}

/// Each notation stage runs the check of `elision-only` where its own
/// directive declares it (engine §8). With `greedy` and `elision-only` on
/// the lexical stage, the check finds the ambiguity that `greedy` settled
/// in `...`, which is also `..` and `.`, and the document does not load.
#[test]
fn a_notation_stage_that_declares_elision_only_runs_the_check() {
    let bootstrap = read(&["grammars", "notation", "bootstrap.json"]);
    let bootstrap = bootstrap.replacen(
        r#""name":"symbol","op":"define","flags":[],"alternatives":["#,
        r#""name":"symbol","op":"define","flags":[],"alternatives":[{"guards":[],"expr":{"literal":{"string":"."}}},"#,
        1,
    );
    let directive = r#""name":"ambiguity-resolution","args":["greedy"]"#;
    let lexical = bootstrap.find(r#""path":"notation/lexical.md""#).expect("the lexical document");
    let syntax = bootstrap.find(r#""path":"notation/syntax.md""#).expect("the syntax document");
    let at = bootstrap.find(directive).expect("the directive");
    assert!(lexical < at && at < syntax, "the first directive is the lexical stage's");
    let elision = bootstrap.replacen(directive, r#""name":"ambiguity-resolution","args":["greedy","elision-only"]"#, 1);
    let sources = |bootstrap: String| {
        [
            ("p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string()),
            ("g.md", "```jbogenbau\n%ambiguity-resolution greedy\n%rule text {...B}\n```\n".to_string()),
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

/// Changes one syntax constructor in a caller-supplied bootstrap. Paths
/// refer to its expression, so declaration order does not select the rule.
fn pattern_bootstrap_expr(bootstrap: &Value, name: &str, alternative: usize, tail: &str, expression: &str) -> Value {
    for (stage, contents) in bootstrap.get("stages").unwrap().array().iter().enumerate() {
        for (document, contents) in contents.get("documents").unwrap().array().iter().enumerate() {
            if contents.get("path").and_then(Value::str) != Some("notation/syntax.md") {
                continue;
            }
            for (rule, contents) in contents.get("dom").unwrap().get("rules").unwrap().array().iter().enumerate() {
                if contents.get("name").and_then(Value::str) != Some(name) {
                    continue;
                }
                let mut path = parse_json(&format!(
                    r#"["stages",{stage},"documents",{document},"dom","rules",{rule},"alternatives",{alternative},"expr"]"#
                ))
                .unwrap()
                .array()
                .to_vec();
                path.extend(parse_json(tail).unwrap().array().iter().cloned());
                return common::apply_mutant(
                    bootstrap,
                    &Value::Object(vec![
                        ("path".into(), Value::Array(path)),
                        ("set".into(), parse_json(expression).unwrap()),
                    ]),
                );
            }
        }
    }
    panic!("no syntax rule {name}");
}

fn load_pattern_probe(rules: &str, bootstrap: &Value) -> Result<gencmu::Dialect, gencmu::Error> {
    gencmu::load_dialect_sources(
        [
            ("p.md", "```jbogenbau\n%stage main\n%include \"main.md\"\n```\n".to_string()),
            ("main.md", format!("```jbogenbau\n%ambiguity-resolution greedy\n{rules}\n```\n")),
            ("notation/bootstrap.json", bootstrap.to_text()),
        ],
        "p.md",
    )
}

fn pattern_probe(rules: &str, bootstrap: &Value, tokens: &[&str]) -> String {
    let dialect = load_pattern_probe(rules, bootstrap).unwrap_or_else(|error| panic!("{rules}: {error}"));
    let tokens = tokens
        .iter()
        .map(|text| gencmu::InputToken {
            text: (*text).into(),
            tags: [text.to_uppercase()].into_iter().collect(),
            ..Default::default()
        })
        .collect::<Vec<_>>();
    let result = dialect.parse_tokens(&tokens, &Default::default()).expect("a parse");
    assert!(result.ok, "{rules}: {:?}", result.error);
    gencmu::to_json(&result)
}

/// The atom's grouped-union part requires no delimiter tokens (§9.3).
#[test]
fn a_pattern_atom_reads_a_grouped_union_without_delimiters() {
    let bundled = parse_json(&read(&["grammars", "notation", "bootstrap.json"])).unwrap();
    let changed = pattern_bootstrap_expr(&bundled, "pattern-literal", 0, r#"["seq",2]"#, r#"{"ref":"pattern-atom"}"#);
    let changed = pattern_bootstrap_expr(&changed, "pattern-atom", 2, "[]", r#"{"ref":"pattern-union"}"#);
    let rules = "%const $P @(A B)\n%rule text A B\n%conditions $ ≅ $P";
    assert_eq!(pattern_probe(rules, &changed, &["A", "B"]), pattern_probe(rules, &bundled, &["A", "B"]));
}

/// String-terminal delegates to its string or constant part. Its tests
/// retain ordinary terminal target and order rules before base conversion.
#[test]
fn pattern_string_terminal_constructors_and_tests() {
    let bundled = parse_json(&read(&["grammars", "notation", "bootstrap.json"])).unwrap();
    let changed =
        pattern_bootstrap_expr(&bundled, "pattern-atom", 0, r#"["seq",0,"choice",2]"#, r#"{"ref":"string-terminal"}"#);
    for rules in [
        "%const $P @(\"a\")\n%rule text \"a\"\n%conditions $ ≅ $P",
        "%const $P @(\"a\"=\"a\")\n%rule text \"a\"\n%conditions $ ≅ $P",
        "%const $P @(\"a\"<A>=\"a\")\n%rule text \"a\"\n%conditions $ ≅ $P",
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
        r#"{"choice":[{"ref":"pattern-name"},{"ref":"tag"},{"ref":"string-terminal"},{"ref":"range"},{"ref":"wildcard"}]}"#,
    );
    let rules = "%const $S \"a\"\n%const $P @($S=\"a\")\n%rule text \"a\"\n%conditions $ ≅ $P";
    assert_eq!(pattern_probe(rules, &constants, &["a"]), pattern_probe(rules, &bundled, &["a"]));
    for pattern in ["\"a\"=\"a\"<A>", "\"a\"<A><B>", "\"a\"=\"a\"=\"a\"", "$_D800=\"a\"<A>"] {
        let rules = format!("%const $P @({pattern})\n%rule text A");
        let ordinary = load_pattern_probe(&rules, &bundled).unwrap_err();
        let bootstrap = if pattern.starts_with('$') { &constants } else { &changed };
        let alternate = load_pattern_probe(&rules, bootstrap).unwrap_err();
        assert_eq!(ordinary, alternate, "{pattern}");
        assert_eq!(alternate.kind, gencmu::ErrorKind::Grammar);
        assert!(alternate.message.contains("pattern test target or order"), "{alternate}");
    }
}

/// Unread delimiters and constructor parts do not select pattern forms.
#[test]
fn pattern_constructors_read_their_declared_parts() {
    let bundled = parse_json(&read(&["grammars", "notation", "bootstrap.json"])).unwrap();
    for (name, alternative, tail, expression, pattern, control, body, tokens) in [
        (
            "pattern-atom",
            0,
            "[]",
            r#"{"seq":[{"ref":"empty-set"},{"choice":[{"ref":"pattern-name"},{"ref":"tag"},{"ref":"string"},{"ref":"range"},{"ref":"wildcard"},{"ref":"constant-reference"}]},{"optional":{"repeat":{"ref":"symbol-test"}}}]}"#,
            "@(∅ A)",
            "@A",
            "%rule text A",
            vec!["A"],
        ),
        (
            "pattern-item",
            0,
            "[]",
            r#"{"seq":[{"ref":"empty-set"},{"ref":"pattern-atom"}]}"#,
            "@(∅ A)",
            "@A",
            "%rule text A",
            vec!["A"],
        ),
        (
            "pattern-union",
            0,
            "[]",
            r#"{"seq":[{"literal":{"string":"("}},{"repeat":{"ref":"pattern-intersection"},"separator":{"choice":[{"literal":{"string":"∪"}},{"literal":{"string":"∖"}}]}},{"literal":{"string":")"}}]}"#,
            "@((A ∖ B))",
            "@(A ∖ B)",
            "%rule text B",
            vec!["B"],
        ),
        (
            "pattern-path",
            0,
            "[]",
            r#"{"seq":[{"literal":{"string":"("}},{"literal":{"string":"⋮"}},{"ref":"pattern-atom"},{"literal":{"string":")"}}]}"#,
            "@((⋮A))",
            "@(⋮A)",
            "%rule text child B\n%rule child A",
            vec!["A", "B"],
        ),
        (
            "pattern-path",
            1,
            "[]",
            r#"{"seq":[{"literal":{"string":"("}},{"ref":"pattern-atom"},{"literal":{"string":"⋰"}},{"literal":{"string":")"}}]}"#,
            "@((child⋰))",
            "@(child⋰)",
            "%rule text child B\n%rule child A",
            vec!["A", "B"],
        ),
        (
            "pattern-repeat",
            0,
            "[]",
            r#"{"seq":[{"literal":{"string":"{"}},{"ref":"pattern-union"},{"literal":{"string":"/"}},{"ref":"pattern-union"},{"literal":{"string":"/"}},{"ref":"pattern-union"},{"literal":{"string":"}"}}]}"#,
            "@({A / S / $_D800})",
            "@({A / S})",
            "%rule text A S A",
            vec!["A", "S", "A"],
        ),
    ] {
        let changed = pattern_bootstrap_expr(&bundled, name, alternative, tail, expression);
        let comparator = if name == "pattern-union" { "≇" } else { "≅" };
        let rules = format!("%const $P {pattern}\n{body}\n%conditions $ {comparator} $P");
        let control = format!("%const $P {control}\n{body}\n%conditions $ {comparator} $P");
        assert_eq!(pattern_probe(&rules, &changed, &tokens), pattern_probe(&control, &bundled, &tokens), "{name}");
    }
    // A name outside §9.3 is a wrapper, including an older separator
    // name. Its operator token remains a part of the union.
    let wrapped =
        pattern_bootstrap_expr(&bundled, "pattern-union", 0, r#"["separator"]"#, r#"{"ref":"pattern-separator"}"#);
    let wrapped = pattern_bootstrap_expr(&wrapped, "pattern-name", 0, "[]", r#"{"literal":{"string":"∖"}}"#);
    let wrapped =
        pattern_bootstrap_expr(&wrapped, "pattern-atom", 0, r#"["seq",0,"choice",0]"#, r#"{"ref":"Lowercase-Name"}"#);
    let text = wrapped.to_text();
    assert_eq!(text.matches(r#""name":"pattern-name""#).count(), 1);
    let wrapped = parse_json(&text.replace(r#""name":"pattern-name""#, r#""name":"pattern-separator""#)).unwrap();
    let rules = "%const $P @(A ∖ B)\n%rule text B\n%conditions $ ≇ $P";
    assert_eq!(pattern_probe(rules, &wrapped, &["B"]), pattern_probe(rules, &bundled, &["B"]));
}

/// A named constructor and a wrapper that exposes its token name the
/// same rule. A test on that rule still fails before operand conversion.
#[test]
fn pattern_names_use_named_parts_or_tokens() {
    let bundled = parse_json(&read(&["grammars", "notation", "bootstrap.json"])).unwrap();
    for name in ["name", "reference"] {
        let changed = pattern_bootstrap_expr(&bundled, "pattern-name", 0, "[]", &format!(r#"{{"ref":"{name}"}}"#));
        let rules = "%const $P @child\n%rule text child\n%conditions $ ≅ $P\n%rule child A";
        assert_eq!(pattern_probe(rules, &changed, &["A"]), pattern_probe(rules, &bundled, &["A"]), "{name}");
        let rules = "%const $P @(child=$_D800)\n%rule text A";
        assert_eq!(load_pattern_probe(rules, &changed).unwrap_err(), load_pattern_probe(rules, &bundled).unwrap_err());
    }
}

/// Missing required parts produce a grammar error at their constructor.
#[test]
fn missing_pattern_parts_are_grammar_errors() {
    let bundled = parse_json(&read(&["grammars", "notation", "bootstrap.json"])).unwrap();
    for (name, alternative, expression, pattern, missing) in [
        (
            "pattern-union",
            0,
            r#"{"seq":[{"ref":"pattern-intersection"},{"literal":{"string":"/"}},{"ref":"pattern-intersection"}]}"#,
            "@(A / B)",
            "union operators",
        ),
        ("pattern-union", 0, r#"{"ref":"empty-set"}"#, "@(∅)", "pattern-intersection"),
        ("pattern-intersection", 0, r#"{"ref":"empty-set"}"#, "@(∅)", "pattern-sequence"),
        ("pattern-sequence", 0, r#"{"ref":"empty-set"}"#, "@(∅)", "pattern-item"),
        ("pattern-item", 4, r#"{"ref":"empty-set"}"#, "@(∅)", "pattern item or sibling ellipsis"),
        (
            "pattern-brackets",
            0,
            r#"{"seq":[{"literal":{"string":"["}},{"literal":{"string":"]"}}]}"#,
            "@([])",
            "pattern-union",
        ),
        (
            "pattern-repeat",
            0,
            r#"{"seq":[{"literal":{"string":"{"}},{"literal":{"string":"}"}}]}"#,
            "@({})",
            "pattern-union",
        ),
        ("pattern-path", 0, r#"{"seq":[{"literal":{"string":"."}},{"ref":"pattern-atom"}]}"#, "@(.A)", "path token"),
    ] {
        let changed = pattern_bootstrap_expr(&bundled, name, alternative, "[]", expression);
        let error = load_pattern_probe(&format!("%const $P {pattern}\n%rule text A"), &changed).unwrap_err();
        assert_eq!(error.kind, gencmu::ErrorKind::Grammar, "{name}: {error}");
        assert!(error.message.contains(&format!("{name} has no {missing}")), "{error}");
        assert_eq!(error.document.as_deref(), Some("main.md"));
        assert_eq!(error.line, Some(3));
    }
}

/// Supplied trees can test nonterminal groups and nested literals. Their
/// target error precedes an invalid scalar constant inside the base.
#[test]
fn grouped_pattern_tests_fail_before_base_conversion() {
    let bundled = parse_json(&read(&["grammars", "notation", "bootstrap.json"])).unwrap();
    for (alternative, expression, pattern) in [
        (
            2,
            r#"{"seq":[{"literal":{"string":"("}},{"ref":"pattern-union"},{"literal":{"string":")"}},{"optional":{"repeat":{"ref":"symbol-test"}}}]}"#,
            "(($_D800 A)<A>)",
        ),
        (1, r#"{"seq":[{"ref":"pattern-literal"},{"optional":{"repeat":{"ref":"symbol-test"}}}]}"#, "(@($_D800)<A>)"),
    ] {
        let changed = pattern_bootstrap_expr(&bundled, "pattern-atom", alternative, "[]", expression);
        let rules = format!("%const $P @{pattern}\n%rule text A");
        let error = load_pattern_probe(&rules, &changed).unwrap_err();
        let source = format!("```jbogenbau\n%ambiguity-resolution greedy\n{rules}\n```\n");
        let (line, column) = common::position_of(&source, "<A>");
        assert_eq!((error.line, error.column), (Some(line), Some(column)), "{error}");
        assert!(error.message.contains("pattern test target or order"), "{error}");
    }
}
