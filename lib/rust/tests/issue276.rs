//! Diagnostic recipes and static notes that need library hooks.
mod common;
use common::{parse_json, repository, Value};
use gencmu::{InputToken, ParseErrorKind, ParseOptions};

fn fixture(name: &str) -> Value {
    parse_json(&std::fs::read_to_string(repository().join(format!("tests/engine/i276-{name}.json"))).unwrap()).unwrap()
}

#[test]
fn guard_occurrence_sites_survive_preparsed_loading() {
    for (name, index) in
        [("guard-duplicate-alternatives", 1), ("guard-header-first", 0), ("guard-simplified-origin", 1)]
    {
        let case = fixture(name);
        let source = format!("```jbogenbau\n{}\n```\n", case.get("grammar").unwrap().str().unwrap());
        let dom = gencmu::tools::read_grammar_document(&source, "").unwrap();
        let cache = format!(
            r#"{{"format":{},"bootstrap":"{}","unicode":"{}","properties":"{}","documents":{{"grammars/test/g.md":{{"hash":"{}","dom":{dom}}}}}}}"#,
            gencmu::tools::DOM_FORMAT,
            gencmu::tools::bootstrap_hash(),
            gencmu::tools::fnv1a64(include_str!("../data/unicode/unicode.txt")),
            gencmu::tools::fnv1a64(include_str!("../data/unicode/unicode-properties.txt")),
            gencmu::tools::fnv1a64(&source),
        );
        let sources = std::collections::BTreeMap::from([
            ("grammars/test/p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string()),
            ("grammars/test/g.md", source),
        ]);
        let parse = |cache: Option<&str>| {
            let mut documents = sources.clone();
            if let Some(cache) = cache {
                documents.insert("data/preparsed/test.json", cache.to_string());
            }
            gencmu::load_pipeline_sources(documents, "grammars/test/p.md")
                .unwrap()
                .parse("bab", &ParseOptions::default())
                .unwrap()
        };
        let plain = parse(None);
        let cached = parse(Some(&cache));
        assert_eq!(plain.error.as_ref().unwrap().boundary.as_ref().unwrap().condition, index, "{name}");
        assert_eq!(cached.error.as_ref().unwrap().boundary.as_ref().unwrap().condition, index, "{name}");
        assert_eq!(gencmu::to_json(&cached), gencmu::to_json(&plain), "{name}");
        if name == "guard-duplicate-alternatives" {
            let changed = cache.replace(r#""string":"x""#, r#""string":"a""#);
            assert_ne!(changed, cache);
            assert_eq!(
                parse(Some(&changed)).error.unwrap().boundary.unwrap().condition,
                0,
                "the cache must use its DOM"
            );
        }
    }
}

#[test]
fn message_capture_reason_distinguishes_absent_from_unknown() {
    for name in ["message-optional-capture-reason", "message-captured-terminator-reason"] {
        let case = fixture(name);
        let (documents, path) = common::case_documents(&case);
        let error = gencmu::load_pipeline_sources(documents, &path).unwrap_err();
        assert!(error.message.contains("recipe"), "{error}");
        assert!(!error.message.contains("captured by no alternative"), "{error}");
    }
}
fn pipeline(case: &Value) -> gencmu::Pipeline {
    let (documents, path) = common::case_documents(case);
    gencmu::load_pipeline_sources(documents, &path).unwrap()
}
fn parse(p: &gencmu::Pipeline, case: &Value) -> gencmu::ParseResult {
    let tokens = case
        .get("tokens")
        .unwrap()
        .array()
        .iter()
        .map(|t| InputToken {
            text: t.get("text").unwrap().str().unwrap().into(),
            tags: t.get("tags").unwrap().array().iter().map(|v| v.str().unwrap().to_string()).collect(),
            ..Default::default()
        })
        .collect::<Vec<_>>();
    let options = case.get("options");
    let features = common::feature_names(options.and_then(|o| o.get("features")));
    p.parse_tokens(&tokens, &ParseOptions { features, ..Default::default() }).unwrap()
}
#[test]
fn failed_message_preserves_earlier_stages() {
    let case = fixture("message-guard");
    let p = pipeline(&case);
    let (result, calls) = gencmu::with_diagnostic_messages(Some("bad"), || parse(&p, &case));
    assert_eq!(calls, ["early", "late", "bad"]);
    assert_eq!(result.error.as_ref().unwrap().kind, ParseErrorKind::Grammar);
    assert!(result.tree.is_none());
    assert!(result.error.as_ref().unwrap().errors.is_empty());
    assert_eq!(result.stages[1].verdict, Some(gencmu::Verdict::Unique));
    assert!(result.stages[0].output.is_some());
    assert!(result.stages[1].output.is_none());
    assert_eq!(result.warnings.iter().map(|w| w.code.as_str()).collect::<Vec<_>>(), ["late", "early"]);
}
#[test]
fn suppressed_messages_do_not_run() {
    let case = fixture("warning-suppression-descendant");
    let p = pipeline(&case);
    let (result, calls) = gencmu::with_diagnostic_messages(Some("warn"), || parse(&p, &case));
    assert!(result.ok);
    assert!(calls.is_empty());
}
#[test]
fn one_guarded_occurrence_runs_one_message() {
    let case = fixture("tags-report-once");
    let p = pipeline(&case);
    let (result, calls) = gencmu::with_diagnostic_messages(None, || parse(&p, &case));
    assert!(result.ok);
    assert_eq!(calls, ["left"]);
}
#[test]
fn diagnostic_audit_notes_name_rules_and_variants() {
    let p = pipeline(&fixture("error-query-matches"));
    assert!(p.ranking_reports()[0]
        .diagnostic_notes
        .iter()
        .any(|n| n.kind == "query-error" && n.target.as_deref() == Some("bad")));
    let p = pipeline(&fixture("tags-variants-4"));
    assert!(p.ranking_reports()[0]
        .diagnostic_notes
        .iter()
        .any(|n| n.kind == "guarded-tag-variants" && n.variants == Some(16)));
    assert!(gencmu::format_ranking_reports(&p.ranking_reports()).contains("16 guarded tag variants"));
    let mut case = fixture("warning-suppression-descendant");
    if let Value::Object(fields) = &mut case {
        let (_, grammar) = fields.iter_mut().find(|(k, _)| k == "grammar").unwrap();
        *grammar = Value::String(grammar.str().unwrap().replace("%rule wrap *warn", "%rule wrap A"));
    }
    assert!(pipeline(&case).ranking_reports()[0]
        .diagnostic_notes
        .iter()
        .any(|n| n.kind == "unused-suppression" && n.code.as_deref() == Some("warn")));
}

#[test]
fn warning_checks_use_the_suppressed_alternative_reach_set() {
    let cases = [
        ("\"a\"", "#·outside", true, ""),
        ("\"a\"", "#(·outside ∩ ·_)", true, ""),
        ("\"a\"", "#(·outside ∖ ·_)", true, ""),
        ("\"a\"", "#(·outside ∪ ·_)", false, ""),
        ("\"a\"", "#·r", false, ""),
        ("child", "#·child", false, ""),
        ("\"a\"", "#·r⁅·outside⁆", false, ""),
        ("\"a\"", "#·outside", true, "%extend-rule r outside\n"),
        ("\"a\"", "#·_<_Elided>", false, ""),
    ];
    for (body, pattern, unused, extra) in cases {
        for code in ["never", "_"] {
            let source = format!("```jbogenbau\n%ambiguity-resolution greedy\n%rule text r | outside\n%rule r {body}\n%suppress-warnings {code}\n{extra}%rule outside \"b\"\n%rule child \"a\"\n%check never {pattern}\n%warning \"never\"\n```\n");
            let p = gencmu::load_pipeline_sources(
                std::collections::BTreeMap::from([
                    ("p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_owned()),
                    ("g.md", source),
                ]),
                "p.md",
            )
            .unwrap();
            let notes = &p.ranking_reports()[0].diagnostic_notes;
            let notes: Vec<_> = notes
                .iter()
                .filter(|n| n.kind == "unused-suppression")
                .map(|n| (n.rule.as_str(), n.code.as_deref()))
                .collect();
            let expected = if unused { vec![("r", Some(code))] } else { vec![] };
            assert_eq!(notes, expected, "{body} {pattern} {code} {extra}");
        }
    }
}

#[test]
fn splice_dom_requires_a_nominal_target() {
    for target in [r#"{"param":"X","at":[1,1]}"#, r#"{"test":"=","value":{"string":"a"},"expr":{"ref":"piece"}}"#] {
        let dom = format!(
            r#"{{"format":49,"rules":[{{"name":"text","params":["X"],"op":"define","alternatives":[{{"guards":[],"expr":{{"splice":{target}}}}}],"conditions":[],"at":[1,1]}}],"directives":[],"constants":[],"classifiers":[],"implications":[],"checks":[]}}"#
        );
        assert!(gencmu::tools::check_dom(&dom).unwrap().is_some(), "{target}");
    }
}

#[test]
fn guarded_tag_limit_is_a_load_error() {
    for name in ["tags-variants-5", "tags-same-result-limit"] {
        let case = fixture(name);
        let (documents, path) = common::case_documents(&case);
        let error = gencmu::load_pipeline_sources(documents, &path).expect_err("the variant limit is a load error");
        assert_eq!(error.kind, gencmu::ErrorKind::Grammar);
        assert!(error.message.contains("16"), "{error}");
    }
}

#[test]
fn splice_only_cycles_share_the_called_rule_key() {
    for entry in ["loop", "*loop"] {
        let source = format!(
            "```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%rule text {entry}\n%rule loop *loop | A\n```\n"
        );
        let p = gencmu::load_pipeline_sources([("p.md", source)], "p.md").unwrap();
        let result = p
            .parse_tokens(
                &[InputToken { text: "a".into(), tags: ["A".into()].into_iter().collect(), ..Default::default() }],
                &ParseOptions::default(),
            )
            .unwrap();
        assert!(result.ok, "{entry}: {result:?}");
        assert_eq!(result.stages[0].verdict, Some(gencmu::Verdict::Unique), "{entry}");
    }
}

#[test]
fn nested_literal_tag_sets_load() {
    let mut term = "T U".to_string();
    for _ in 0..24 {
        term = format!("(T U) ∩ ((T U) ∪ ({term}))");
    }
    let source = format!(
        "```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%rule text x B\n%rule x A :: ($.followed-by(B) ⟹ ({term}))\n```\n"
    );
    let pipeline = gencmu::load_pipeline_sources([("p.md", source)], "p.md").unwrap();
    let tokens = ["A", "B"].map(|tag| InputToken {
        text: tag.into(),
        tags: [tag.into()].into_iter().collect(),
        ..Default::default()
    });
    let result = pipeline.parse_tokens(&tokens, &ParseOptions::default()).unwrap();
    assert!(result.ok, "{result:?}");
    assert_eq!(
        result.tree.unwrap().children[0].tags,
        std::collections::BTreeSet::<String>::from(["T".into(), "U".into()])
    );
}
