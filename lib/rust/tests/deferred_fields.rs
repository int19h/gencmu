//! Diagnostic fields and canonical envelopes (output §1 and API caller tokens).
mod common;
use gencmu::{Expected, InputToken, ParseOptions, RejectionEvidence, Warning};
use std::collections::BTreeMap;

fn pipeline() -> gencmu::Pipeline {
    gencmu::load_pipeline_sources(
        BTreeMap::<String, String>::from([
            ("p.md".into(), "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".into()),
            ("g.md".into(), "```jbogenbau\n%ambiguity-resolution greedy\n%rule text A\n```\n".into()),
        ]),
        "p.md",
    )
    .unwrap()
}

#[test]
fn caller_diagnostics_allow_only_empty_lists() {
    // API caller tokens: a nonempty diagnostic list is a usage error.
    let pipeline = pipeline();
    let diagnostic = Warning::new("before".into(), "fault".into(), 0..1, 0..1, "fault".into());
    for error in [true, false] {
        let mut input =
            InputToken { text: "a".into(), tags: ["A".into()].into_iter().collect(), ..InputToken::default() };
        if error {
            input.errors.push(diagnostic.clone());
        } else {
            input.warnings.push(diagnostic.clone());
        }
        assert!(pipeline.parse_tokens(&[input], &ParseOptions::default()).is_err());
    }
    let result = pipeline
        .parse_tokens(
            &[InputToken { text: "a".into(), tags: ["A".into()].into_iter().collect(), ..InputToken::default() }],
            &ParseOptions::default(),
        )
        .unwrap();
    assert!(result.ok);
    assert!(!gencmu::to_json(&result).contains("\"errors\""));
}

#[test]
fn canonical_error_lists_alone_include_rejection_evidence() {
    // Output §1: diagnostic lists follow the envelope evidence and precede its message.
    let mut result = pipeline().parse("b", &ParseOptions::default()).unwrap();
    let mut diagnostic = Warning::new("main".into(), "fault".into(), 0..1, 0..1, "fault".into());
    diagnostic.rejection = Some(RejectionEvidence {
        token: 1,
        source: 1..1,
        line: 1,
        column: 2,
        expected: vec![Expected { terminal: "B".into(), rules: vec!["text".into()] }],
    });
    let error = result.error.as_mut().unwrap();
    error.errors.push(diagnostic.clone());
    error.warnings.push(diagnostic.clone());
    result.warnings.push(diagnostic);
    let raw = gencmu::to_json(&result);
    assert!(raw.starts_with("{\"format\":17,"));
    assert_eq!(raw.matches("\"rejection\"").count(), 1);
    assert!(raw.find("\"expected\"").unwrap() < raw.find("\"errors\"").unwrap());
    assert!(!raw.contains("\"document\""));
    let value = common::parse_json(&raw).unwrap();
    assert_eq!(value.get("error").unwrap().get("errors").unwrap().array().len(), 1);
}
