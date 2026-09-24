//! A DOM from `compiled.json` is used only when it is one the reader could
//! have produced (engine §9, docs/output.md "A grammar DOM"): one malformed
//! DOM per rule, each of which must be a cache miss, so that the document
//! is read instead and no cache entry can change a result.

const DOCUMENT: &str = "```ebnf\n%ambiguity-resolution greedy ;\ntext ≔ \"a\" ;\n```\n";

/// A DOM like the document's, but accepting "b" rather than "a", with
/// `rule` added and the text rule's alternative and emission as given.
fn dom(text_alternative: &str, text_extra: &str, rule: &str, format: u32, directive_args: &str) -> String {
    let mut rules = format!(
        r#"{{"name":"text","op":"define","alternatives":[{text_alternative}]{text_extra},"conditions":[],"at":[3,1]}}"#
    );
    if !rule.is_empty() {
        rules.push(',');
        rules.push_str(rule);
    }
    format!(
        r#"{{"format":{format},"rules":[{rules}],"directives":[{{"name":"ambiguity-resolution","args":[{directive_args}],"at":[2,1]}}]}}"#
    )
}

const B: &str = r#"{"guards":[],"expr":{"terminal":"b"}}"#;

fn with_rule(rule: &str) -> String {
    dom(B, "", rule, 1, r#""greedy""#)
}

fn with_alternative(alternative: &str) -> String {
    dom(alternative, "", "", 1, r#""greedy""#)
}

fn with_emission(emission: &str) -> String {
    let alternative = r#"{"guards":[],"expr":{"seq":[{"capture":"x","expr":{"terminal":"b"}},{"capture":"y","expr":{"terminal":"c"}}]}}"#;
    dom(alternative, &format!(r#","emit":{emission}"#), "", 1, r#""greedy""#)
}

fn with_condition(condition: &str) -> String {
    let rule = format!(
        r#"{{"name":"x","op":"define","alternatives":[{{"guards":[],"expr":{{"capture":"w","expr":{{"terminal":"b"}}}}}}],"conditions":[{condition}],"at":[4,1]}}"#
    );
    with_rule(&rule)
}

fn with_tags(term: &str) -> String {
    with_alternative(&format!(r#"{{"guards":[],"expr":{{"capture":"x","expr":{{"terminal":"b"}}}},"tags":{term}}}"#))
}

/// Parses "a" with a dialect whose `compiled.json` holds `dom` for the
/// document: true when the document itself was read.
fn document_was_read(dom: &str) -> bool {
    let compiled = format!(
        r#"{{"format":1,"bootstrap":"{}","documents":{{"g.md":{{"hash":"{}","dom":{dom}}}}}}}"#,
        gencmu::tools::bootstrap_hash(),
        gencmu::tools::fnv1a64(DOCUMENT)
    );
    let sources = [
        ("p.md", "## Main <?stage main?>\n\n- [g](g.md) <?grammar?>\n".to_string()),
        ("g.md", DOCUMENT.to_string()),
        ("compiled.json", compiled),
    ];
    // A load error means the entry was used, and refused too late.
    let Ok(dialect) = gencmu::load_dialect_sources(sources, "p.md") else {
        return false;
    };
    let options = gencmu::ParseOptions { auto_features: false, ..Default::default() };
    dialect.parse("a", &options).expect("a parse").ok
}

#[test]
fn a_well_formed_dom_is_used() {
    assert!(!document_was_read(&with_rule("")), "the cache entry should be used, and accept only b");
    let span_argument = with_tags(r#"{"call":"phonemes","args":[{"call":"head","args":[{"capture":"x"}]}]}"#);
    assert!(!document_was_read(&span_argument));
    let bare_capture = with_tags(r#"{"union":[{"capture":"x"},{"literal":"T"}]}"#);
    assert!(!document_was_read(&bare_capture));
    let this_twice = with_emission(r#"{"items":[{"this":true},{"this":true,"tags":{"literal":"T"}}]}"#);
    assert!(!document_was_read(&this_twice));
    // Four captures, and nodes below exactly 256 compound nodes, are allowed.
    let four = with_alternative(
        r#"{"guards":[],"expr":{"seq":[{"capture":"w","expr":{"terminal":"b"}},{"capture":"x","expr":{"terminal":"c"}},{"capture":"y","expr":{"terminal":"c"}},{"capture":"z","expr":{"terminal":"c"}}]}}"#,
    );
    assert!(!document_was_read(&four));
    let optionals = format!("{}{{\"terminal\":\"b\"}}{}", "{\"optional\":".repeat(256), "}".repeat(256));
    assert!(!document_was_read(&with_alternative(&format!(r#"{{"guards":[],"expr":{optionals}}}"#))));
    let sets = format!("{}{{\"literal\":\"T\"}}{}", "{\"set\":[".repeat(256), "]}".repeat(256));
    assert!(!document_was_read(&with_tags(&sets)));
    let deep_emission_tags = with_emission(&format!(r#"{{"items":[{{"capture":"x","tags":{sets}}}]}}"#));
    assert!(!document_was_read(&deep_emission_tags), "an emission is no node of its tags' term");
}

#[test]
fn every_malformed_dom_is_a_cache_miss() {
    let nested = format!("{}{{\"terminal\":\"b\"}}{}", "{\"optional\":".repeat(257), "}".repeat(257));
    let cases: Vec<(&str, String)> = vec![
        ("format 2", dom(B, "", "", 2, r#""greedy""#)),
        ("a directive argument that is not a string", dom(B, "", "", 1, "7")),
        (
            "a rule name that is not a name",
            with_rule(
                r#"{"name":"9x","op":"define","alternatives":[{"guards":[],"expr":{"terminal":"b"}}],"conditions":[],"at":[4,1]}"#,
            ),
        ),
        (
            "an unknown op",
            with_rule(
                r#"{"name":"x","op":"replace","alternatives":[{"guards":[],"expr":{"terminal":"b"}}],"conditions":[],"at":[4,1]}"#,
            ),
        ),
        ("no alternatives", with_rule(r#"{"name":"x","op":"define","alternatives":[],"conditions":[],"at":[4,1]}"#)),
        (
            "a malformed position",
            with_rule(
                r#"{"name":"x","op":"define","alternatives":[{"guards":[],"expr":{"terminal":"b"}}],"conditions":[],"at":[4]}"#,
            ),
        ),
        (
            "a guard's negated not a boolean",
            with_alternative(r#"{"guards":[{"feature":"f","negated":"no"}],"expr":{"terminal":"b"}}"#),
        ),
        ("a seq of one item", with_alternative(r#"{"guards":[],"expr":{"seq":[{"terminal":"b"}]}}"#)),
        ("a choice of one item", with_alternative(r#"{"guards":[],"expr":{"choice":[{"terminal":"b"}]}}"#)),
        (
            "an & of 17 items",
            with_alternative(&format!(
                r#"{{"guards":[],"expr":{{"and":[{}]}}}}"#,
                vec![r#"{"terminal":"b"}"#; 17].join(",")
            )),
        ),
        ("a repeat with min 2", with_alternative(r#"{"guards":[],"expr":{"repeat":{"terminal":"b"},"min":2}}"#)),
        (
            "a capture of a group",
            with_alternative(r#"{"guards":[],"expr":{"capture":"x","expr":{"optional":{"terminal":"b"}}}}"#),
        ),
        (
            "a capture name twice",
            with_alternative(
                r#"{"guards":[],"expr":{"seq":[{"capture":"x","expr":{"terminal":"b"}},{"capture":"x","expr":{"terminal":"c"}}]}}"#,
            ),
        ),
        ("an unknown expression", with_alternative(r#"{"guards":[],"expr":{"sequence":[]}}"#)),
        ("an expression nested more than 256 deep", with_alternative(&format!(r#"{{"guards":[],"expr":{nested}}}"#))),
        ("nothing with tags", with_emission(r#"{"nothing":true,"tags":{"literal":"T"}}"#)),
        ("no emission items", with_emission(r#"{"items":[]}"#)),
        ("this with an inserted tag", with_emission(r#"{"items":[{"this":true},{"insert":"X"}]}"#)),
        ("this with a capture", with_emission(r#"{"items":[{"this":true},{"capture":"x"}]}"#)),
        ("a capture listed twice", with_emission(r#"{"items":[{"capture":"x"},{"capture":"x"}]}"#)),
        (
            "tags on an inserted tag",
            with_emission(r#"{"items":[{"capture":"x"},{"insert":"X","tags":{"literal":"T"}}]}"#),
        ),
        ("an unknown emission item", with_emission(r#"{"items":[{"emit":"x"}]}"#)),
        (
            "any of one condition",
            with_condition(r#"{"any":[{"op":"=","left":{"literal":"a"},"right":{"literal":"b"}}]}"#),
        ),
        ("matches of a value", with_condition(r#"{"matches":{"literal":"b"},"rule":"text"}"#)),
        ("an unknown comparison", with_condition(r#"{"op":"<","left":{"literal":"a"},"right":{"literal":"b"}}"#)),
        ("an unknown function", with_tags(r#"{"call":"uppercase","args":[{"capture":"x"}]}"#)),
        ("matches as a term", with_tags(r#"{"call":"matches","args":[{"capture":"x"},{"rule":"text"}]}"#)),
        ("head as a value", with_tags(r#"{"call":"head","args":[{"capture":"x"}]}"#)),
        ("lowercase of a weak tag", with_tags(r#"{"call":"lowercase","args":[{"weak":"x"}]}"#)),
        ("lowercase of a span", with_tags(r#"{"call":"lowercase","args":[{"capture":"x"}]}"#)),
        ("phonemes of two spans", with_tags(r#"{"call":"phonemes","args":[{"capture":"x"},{"capture":"x"}]}"#)),
        ("phonemes of a value", with_tags(r#"{"call":"phonemes","args":[{"literal":"x"}]}"#)),
        ("tags with a value for a rule", with_tags(r#"{"call":"tags","args":[{"capture":"x"},{"literal":"text"}]}"#)),
        ("a union of one term", with_tags(r#"{"union":[{"literal":"T"}]}"#)),
        ("an unknown term", with_tags(r#"{"string":"T"}"#)),
        ("a term that is not an object", with_tags(r#""T""#)),
    ];
    let mut used = Vec::new();
    for (rule, dom) in &cases {
        if !document_was_read(dom) {
            used.push(*rule);
        }
    }
    assert!(used.is_empty(), "these malformed DOMs were used from the cache: {used:?}");
}

#[test]
fn a_malformed_bootstrap_is_an_error() {
    let bootstrap = format!(
        r#"{{"format":1,"stages":[{{"name":"lexical","documents":[{{"path":"notation/lexical.md","dom":{}}}]}}]}}"#,
        with_emission(r#"{"items":[{"this":true},{"insert":"X"}]}"#)
    );
    let sources = [
        ("p.md", "## Main <?stage main?>\n\n- [g](g.md) <?grammar?>\n".to_string()),
        ("g.md", DOCUMENT.to_string()),
        ("notation/bootstrap.json", bootstrap),
    ];
    let error = gencmu::load_dialect_sources(sources, "p.md").expect_err("a malformed bootstrap");
    assert_eq!(error.kind, gencmu::ErrorKind::Grammar);
}

#[test]
fn a_document_nested_too_deeply_is_an_error_at_its_rule() {
    let ok = format!("```ebnf\na ≔ {}B{} ;\n```\n", "[".repeat(256), "]".repeat(256));
    assert!(gencmu::tools::read_grammar_document(&ok).is_ok());
    let parentheses = format!("```ebnf\na ≔ {}B{} ;\n```\n", "(".repeat(1000), ")".repeat(1000));
    assert!(gencmu::tools::read_grammar_document(&parentheses).is_ok(), "parentheses do not nest the DOM");
    let deep = format!("```ebnf\na ≔ B ;\nc ≔ {}B{} ;\n```\n", "[".repeat(257), "]".repeat(257));
    let error = gencmu::tools::read_grammar_document(&deep).expect_err("nested more than 256 deep");
    assert_eq!((error.line, error.column), (Some(3), Some(1)), "{error}");
}
