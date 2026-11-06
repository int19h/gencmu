//! Structural loading checks (engine §3.6).
use std::collections::BTreeMap;

fn load(grammar: &str) -> Result<gencmu::Pipeline, gencmu::Error> {
    gencmu::load_pipeline_sources(
        BTreeMap::from([
            ("p.md".to_string(), "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string()),
            ("g.md".to_string(), format!("```jbogenbau\n%ambiguity-resolution greedy\n{grammar}\n```\n")),
        ]),
        "p.md",
    )
}

#[test]
fn error_nullability_uses_the_final_structural_grammar() {
    // Engine §3.6: gates, tests, and conditions cannot establish positive width.
    for grammar in [
        "%rule text bad\n%rule bad ε\n%error \"bad\"",
        "%rule text bad\n%rule bad [A]\n%conditions $.source-text = \"unreachable\"\n%error \"bad\"",
        "%rule text bad\n%rule bad gate? empty | A\n%error \"bad\"\n%rule empty ε",
        "%rule text bad\n%rule bad *empty\n%error \"bad\"\n%rule empty ε",
        "%rule text bad\n%rule bad empty\n%error \"bad\"\n%rule empty A\n%redefine-rule empty ε",
        "%rule text bad\n%rule bad empty\n%error \"bad\"\n%rule empty A\n%extend-rule empty ε",
    ] {
        let error = load(grammar).expect_err("a nullable error must fail loading");
        assert!(error.message.contains("can match no tokens"), "{error:?}");
        assert_eq!(error.stage.as_deref(), Some("main"));
    }
}

#[test]
fn warning_and_nonnullable_error_productions_still_load() {
    // Engine §3.6: warnings are exempt and cycles use the least fixed point.
    for grammar in [
        "%rule text A\n%rule note ε\n%warning \"note\"",
        "%rule text bad\n%rule bad A\n%error \"bad\"",
        "%rule text A\n%rule bad other\n%error \"bad\"\n%rule other bad",
        "%rule text bad\n%rule bad A [B]\n%error \"bad\"",
    ] {
        assert!(load(grammar).is_ok(), "{grammar}");
    }
}
