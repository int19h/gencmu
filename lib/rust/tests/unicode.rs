//! Unicode boundaries that combine normalization with the Rust API.

mod common;

use std::collections::BTreeMap;

fn sources(rules: &str) -> BTreeMap<String, String> {
    [
        ("p.md".into(), "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".into()),
        ("g.md".into(), format!("```jbogenbau\n%ambiguity-resolution greedy\n{rules}\n```\n")),
    ]
    .into()
}

#[test]
fn a_partial_cluster_decomposes_its_whole_original_source() {
    let dialect = gencmu::load_dialect_sources(
        sources(
            "%rule text \"e\" $mark:\"‹U+0301›\"\n\
             %conditions $mark.source-text = \"‹U+00E9›\", $mark.decomposed-source-text = \"é\"\n\
             %emits $mark := $mark.decomposed-source-text :- $mark.source-text",
        ),
        "p.md",
    )
    .unwrap();
    let result = dialect.parse("é", &Default::default()).unwrap();
    assert!(result.ok, "{:?}", result.error);
    let token = &result.stages[0].output.as_ref().unwrap()[0];
    assert_eq!(token.span, 1..2);
    assert_eq!(token.source, 0..1);
    assert_eq!(token.text, "é");
    assert_eq!(token.value, "e\u{301}");
    assert_eq!(token.image, "é");
}

#[test]
fn decomposed_source_text_uses_only_the_callers_table() {
    let base = "unicode 0.0.0\nwhite-space 0009 000D\nwhite-space 0020 0020\n";
    for (records, expected) in [
        ("", "é\u{323}"),
        ("decompose 00E9 0065 0301\n", "e\u{301}\u{323}"),
        ("decompose 00E9 0065 0301\ncombining 230 0301 0301\ncombining 220 0323 0323\n", "e\u{323}\u{301}"),
    ] {
        let mut sources = sources("%rule text [{_}]\n%emits $ := $.decomposed-source-text :- $.source-text");
        sources.insert("data/unicode/unicode.txt".into(), format!("{base}{records}"));
        let dialect = gencmu::load_dialect_sources(sources, "p.md").unwrap();
        let result = dialect.parse("é\u{323}", &Default::default()).unwrap();
        assert!(result.ok, "{:?}", result.error);
        let token = &result.stages[0].output.as_ref().unwrap()[0];
        assert_eq!(token.value, expected);
        assert_eq!(token.image, "é\u{323}");
        assert_eq!(token.text, token.image);
    }
}

#[test]
fn constant_errors_keep_original_columns_with_concatenation_and_plain_dollars() {
    let sources = sources("%const $S \"$$(Ignored)é\" ++ \"‹U+0061›\" ++ \"한\" ++ $Absent\n%rule text $S");
    let expected = common::position_of(&sources["g.md"], "$Absent");
    let error = gencmu::load_dialect_sources(sources, "p.md").unwrap_err();
    assert_eq!(error.document.as_deref(), Some("g.md"));
    assert_eq!((error.line, error.column), (Some(expected.0), Some(expected.1)));
    assert!(error.message.contains("Absent"), "{error}");
}

#[test]
fn escaped_diagnostics_read_back_as_exact_scalars() {
    // These escapes include decomposition, Hangul, and non-Mn combining classes.
    let documents = sources("%rule text \"‹U+00E9›\" | \"‹U+AC00›\" | \"‹U+302E›\" | \"‹U+1B44›\"");
    let dialect = gencmu::load_dialect_sources(documents, "p.md").unwrap();
    let result = dialect.parse("?", &Default::default()).unwrap();
    let error = result.error.unwrap();
    assert_eq!(error.expected.len(), 4);
    for expected in error.expected {
        let terminal = expected.terminal;
        assert!(terminal.starts_with("\"‹U+"), "{terminal}");
        let dialect = gencmu::load_dialect_sources(sources(&format!("%rule text {terminal}")), "p.md").unwrap();
        // A caller token keeps the exact scalar named by the diagnostic.
        let digits = terminal.strip_prefix("\"‹U+").unwrap().strip_suffix("›\"").unwrap();
        let code = u32::from_str_radix(digits, 16).unwrap();
        let text = char::from_u32(code).unwrap().to_string();
        let token = gencmu::InputToken { text, ..Default::default() };
        assert!(dialect.parse_tokens(&[token], &Default::default()).unwrap().ok, "{terminal}");
    }
}
