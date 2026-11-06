//! Diagnostic ownership and stage endings (engine §11.5, §12.1, and §13).
mod common;
use gencmu::{InputToken, ParseErrorKind, ParseOptions, Warning};

fn codes(list: &[Warning]) -> Vec<&str> {
    list.iter().map(|diagnostic| diagnostic.code.as_str()).collect()
}
fn fixture(name: &str) -> (gencmu::Pipeline, Vec<InputToken>) {
    let raw =
        std::fs::read_to_string(common::repository().join("tests/engine").join(format!("deferred-report-{name}.json")))
            .unwrap();
    let case = common::parse_json(&raw).unwrap();
    let (documents, path) = common::case_documents(&case);
    let pipeline = gencmu::load_pipeline_sources(documents, &path).unwrap();
    let tokens = case
        .get("tokens")
        .unwrap()
        .array()
        .iter()
        .map(|token| InputToken {
            text: token.get("text").unwrap().str().unwrap().into(),
            tags: token.get("tags").unwrap().array().iter().map(|tag| tag.str().unwrap().to_string()).collect(),
            ..Default::default()
        })
        .collect();
    (pipeline, tokens)
}

#[test]
fn counted_and_pending_errors_bar_reconstruction() {
    // Engine §7: neither carried nor stage-level errors enter reconstruction.
    for name in ["pending-skips-elision", "carried-skips-elision"] {
        let (pipeline, tokens) = fixture(name);
        let (result, checks) =
            gencmu::tools::with_elision_checks(|| pipeline.parse_tokens(&tokens, &ParseOptions::default()).unwrap());
        assert_eq!(result.error.unwrap().kind, ParseErrorKind::Reported);
        assert!(checks.is_empty(), "{name}");
    }
}

#[test]
fn failed_messages_drop_erased_evaluations_and_keep_carried_facts() {
    // Engine §12.1: recipes run under erasure, but the grammar ending omits their diagnostics.
    for tied in [false, true] {
        let body = if tied { "first gone fail | first gone fail" } else { "first gone fail" };
        let source = format!("```jbogenbau\n%stage before\n%ambiguity-resolution greedy\n%rule text $a:A $b:older $c:C\n%emits $a, $b, $c\n%rule older B\n%error \"input fault\"\n%stage last\n%ambiguity-resolution greedy\n%rule text {body}\n%rule first A\n%warning \"kept\"\n%rule gone bad notice\n%erased\n%rule bad B\n%error \"erased error\"\n%rule notice ε\n%warning \"erased warning\"\n%rule fail C\n%warning \"stop\"\n```\n");
        let pipeline = gencmu::load_pipeline_sources([("p.md", source)], "p.md").unwrap();
        let tokens: Vec<_> = [("a", "A"), ("b", "B"), ("c", "C")]
            .into_iter()
            .map(|(text, tag)| InputToken {
                text: text.into(),
                tags: [tag.into()].into_iter().collect(),
                ..Default::default()
            })
            .collect();
        let options =
            ParseOptions { features: vec!["first".into(), "notice".into(), "fail".into()], ..Default::default() };
        let (result, calls) =
            gencmu::with_diagnostic_messages(Some("fail"), || pipeline.parse_tokens(&tokens, &options).unwrap());
        assert_eq!(calls, ["older", "first", "bad", "notice", "fail"]);
        let error = result.error.as_ref().unwrap();
        assert_eq!(error.kind, ParseErrorKind::Grammar);
        assert_eq!(codes(&error.errors), ["older"]);
        assert_eq!(codes(&error.warnings), ["first"]);
        assert_eq!(codes(&result.warnings), ["first"]);
        assert!(result.tree.is_none());
        assert!(result.stages.last().unwrap().output.is_none());
        assert_eq!(
            result.stages.last().unwrap().verdict,
            Some(if tied { gencmu::Verdict::Tie } else { gencmu::Verdict::Unique })
        );
        assert!(!gencmu::to_json(&result).contains("erased error"));
    }
}
