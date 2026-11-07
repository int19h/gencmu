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
    for (tied, later) in [(false, false), (true, false), (true, true)] {
        let body = if later {
            "first gone pass | first gone fail"
        } else if tied {
            "first gone fail | first gone fail"
        } else {
            "first gone fail"
        };
        let source = format!("```jbogenbau\n%stage before\n%ambiguity-resolution greedy\n%rule text $a:A $b:older $c:C\n%emits $a, $b, $c\n%rule older B\n%error \"input fault\"\n%stage last\n%ambiguity-resolution greedy\n%rule text {body}\n%rule first A\n%warning \"kept\"\n%rule gone bad notice\n%erased\n%rule bad B\n%error \"erased error\"\n%rule notice ε\n%warning \"erased warning\"\n%rule fail C\n%warning \"stop\"\n%rule pass C\n%warning \"pass\"\n```\n");
        let pipeline = gencmu::load_pipeline_sources([("p.md", source)], "p.md").unwrap();
        let tokens: Vec<_> = [("a", "A"), ("b", "B"), ("c", "C")]
            .into_iter()
            .map(|(text, tag)| InputToken {
                text: text.into(),
                tags: [tag.into()].into_iter().collect(),
                ..Default::default()
            })
            .collect();
        let options = ParseOptions {
            features: vec!["first".into(), "notice".into(), "fail".into(), "pass".into()],
            ..Default::default()
        };
        let (result, calls) =
            gencmu::with_diagnostic_messages(Some("fail"), || pipeline.parse_tokens(&tokens, &options).unwrap());
        let expected = if later {
            vec!["older", "first", "bad", "notice", "pass", "first", "bad", "notice", "fail"]
        } else {
            vec!["older", "first", "bad", "notice", "fail"]
        };
        assert_eq!(calls, expected);
        let error = result.error.as_ref().unwrap();
        assert_eq!(error.kind, ParseErrorKind::Grammar);
        assert_eq!(codes(&error.errors), ["older"]);
        let warnings = if later { vec!["first", "pass", "first"] } else { vec!["first"] };
        assert_eq!(codes(&error.warnings), warnings);
        assert_eq!(codes(&result.warnings), warnings);
        assert!(result.tree.is_none());
        assert!(result.stages.last().unwrap().output.is_none());
        assert_eq!(
            result.stages.last().unwrap().verdict,
            Some(if tied { gencmu::Verdict::Tie } else { gencmu::Verdict::Unique })
        );
        assert!(!gencmu::to_json(&result).contains("erased error"));
    }
}

#[test]
fn result_only_warnings_stay_outside_reported_and_ambiguous_envelopes() {
    // Output §1: reported and ambiguous envelopes keep warnings only on the result.
    let cases = [
        (
            "%rule text bad good\n%rule bad A\n%error \"bad\"\n%rule good A\n%warning \"good\"",
            "AA",
            gencmu::ParseErrorKind::Reported,
            None,
        ),
        (
            "%rule text good a | good b\n%rule good ε\n%warning \"good\"\n%rule a A\n%rule b A",
            "A",
            gencmu::ParseErrorKind::Ambiguous,
            Some(gencmu::AmbiguityReason::Tie),
        ),
        (
            "%elision-only\n%rule text good s | good s B\n%rule good ε\n%warning \"good\"\n%rule s A [B]",
            "AB",
            gencmu::ParseErrorKind::Ambiguous,
            Some(gencmu::AmbiguityReason::ElisionOnly),
        ),
    ];
    for (body, input, kind, reason) in cases {
        let source = format!("```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n{body}\n```\n");
        let pipeline = gencmu::load_pipeline_sources([("p.md", source)], "p.md").unwrap();
        let tokens: Vec<_> = input
            .chars()
            .map(|tag| InputToken {
                text: tag.to_string(),
                tags: [tag.to_string()].into_iter().collect(),
                ..Default::default()
            })
            .collect();
        let result = pipeline
            .parse_tokens(&tokens, &ParseOptions { features: vec!["good".into()], ..Default::default() })
            .unwrap();
        let error = result.error.as_ref().unwrap();
        assert_eq!((error.kind, error.reason), (kind, reason), "{body}");
        assert!(error.warnings.is_empty(), "{body}");
        assert_eq!(codes(&result.warnings), ["good"], "{body}");
        let value = common::parse_json(&gencmu::to_json(&result)).unwrap();
        assert!(value.get("error").unwrap().get("warnings").is_none());
        assert_eq!(value.get("warnings").unwrap().array().len(), 1);
    }
}
