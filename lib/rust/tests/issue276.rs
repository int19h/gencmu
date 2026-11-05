//! Diagnostic recipes and static notes that need library hooks.
mod common;
use common::{parse_json, repository, Value};
use gencmu::{InputToken, ParseErrorKind, ParseOptions};

fn fixture(name: &str) -> Value {
    parse_json(&std::fs::read_to_string(repository().join(format!("tests/engine/i276-{name}.json"))).unwrap()).unwrap()
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
    assert_eq!(result.warnings.iter().map(|w| w.code.as_str()).collect::<Vec<_>>(), ["early"]);
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
fn splice_dom_requires_a_nominal_target() {
    for target in [r#"{"param":"X","at":[1,1]}"#, r#"{"test":"=","value":{"string":"a"},"expr":{"ref":"piece"}}"#] {
        let dom = format!(
            r#"{{"format":45,"rules":[{{"name":"text","params":["X"],"op":"define","alternatives":[{{"guards":[],"expr":{{"splice":{target}}}}}],"conditions":[],"at":[1,1]}}],"directives":[],"constants":[],"classifiers":[],"implications":[]}}"#
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
