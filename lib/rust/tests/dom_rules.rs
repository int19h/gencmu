//! A DOM from `compiled.json` is used only when it is one the reader could
//! have produced (engine §9, docs/output.md "A grammar DOM"): one malformed
//! DOM per rule, each of which must be a cache miss, so that the document
//! is read instead and no cache entry can change a result.

use gencmu::tools::DOM_FORMAT;

const DOCUMENT: &str = "```jbogenbau\n%ambiguity-resolution greedy\n%rule text 'a'\n```\n";

/// A DOM like the document's, but accepting "b" rather than "a", with
/// `rule` added and the text rule's alternative and emission as given.
fn dom(text_alternative: &str, text_extra: &str, rule: &str, format: i64, directive_args: &str) -> String {
    let mut rules = format!(
        r#"{{"name":"text","op":"define","flags":[],"alternatives":[{text_alternative}]{text_extra},"conditions":[],"at":[3,1]}}"#
    );
    if !rule.is_empty() {
        rules.push(',');
        rules.push_str(rule);
    }
    format!(
        r#"{{"format":{format},"rules":[{rules}],"directives":[{{"name":"ambiguity-resolution","args":[{directive_args}],"at":[2,1]}}],"constants":[],"classifiers":[],"implications":[]}}"#
    )
}

const B: &str = r#"{"guards":[],"expr":{"terminal":"b"}}"#;

fn with_rule(rule: &str) -> String {
    dom(B, "", rule, DOM_FORMAT, r#""greedy""#)
}

fn with_alternative(alternative: &str) -> String {
    dom(alternative, "", "", DOM_FORMAT, r#""greedy""#)
}

/// A DOM like the document's, but accepting "b", with `directive` added
/// after its `%ambiguity-resolution`.
fn with_directive(directive: &str) -> String {
    let rule = r#"{"name":"text","op":"define","flags":[],"alternatives":[{"guards":[],"expr":{"terminal":"b"}}],"conditions":[],"at":[3,1]}"#;
    format!(
        r#"{{"format":{DOM_FORMAT},"rules":[{rule}],"directives":[{{"name":"ambiguity-resolution","args":["greedy"],"at":[2,1]}},{directive}],"constants":[],"classifiers":[],"implications":[]}}"#
    )
}

fn with_emission(emission: &str) -> String {
    let alternative = r#"{"guards":[],"expr":{"seq":[{"capture":"x","expr":{"terminal":"b"}},{"capture":"y","expr":{"terminal":"c"}}]}}"#;
    dom(alternative, &format!(r#","emit":{emission}"#), "", DOM_FORMAT, r#""greedy""#)
}

fn with_condition(condition: &str) -> String {
    let rule = format!(
        r#"{{"name":"x","op":"define","flags":[],"alternatives":[{{"guards":[],"expr":{{"capture":"w","expr":{{"terminal":"b"}}}}}}],"conditions":[{condition}],"at":[4,1]}}"#
    );
    with_rule(&rule)
}

fn with_tags(term: &str) -> String {
    with_alternative(&format!(r#"{{"guards":[],"expr":{{"capture":"x","expr":{{"terminal":"b"}}}},"tags":{term}}}"#))
}

/// Parses "a" with a dialect whose `compiled.json` holds `dom` for the
/// document: true when the document itself was read.
fn document_was_read(dom: &str) -> bool {
    document_was_read_from(DOM_FORMAT, dom)
}

/// The same, with a `compiled.json` of the given format.
fn document_was_read_from(format: i64, dom: &str) -> bool {
    let compiled = format!(
        r#"{{"format":{format},"bootstrap":"{}","documents":{{"g.md":{{"hash":"{}","dom":{dom}}}}}}}"#,
        gencmu::tools::bootstrap_hash(),
        gencmu::tools::fnv1a64(DOCUMENT)
    );
    let sources = [
        ("p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string()),
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
    let span_argument = with_condition(
        r#"{"op":"=","left":{"call":"phonemes","args":[{"call":"head","args":[{"capture":"w"}]}]},"right":{"string":"b"}}"#,
    );
    assert!(!document_was_read(&span_argument));
    let whole_twice = with_emission(r#"{"items":[{"capture":""},{"capture":"","tags":{"tag":"T"}}]}"#);
    assert!(!document_was_read(&whole_twice));
    // Attachments before and after a named capture (§11).
    assert!(!document_was_read(&with_emission(r#"{"items":[{"capture":"y","before":["x"]}]}"#)));
    assert!(!document_was_read(&with_emission(r#"{"items":[{"capture":"x","after":["y"]}]}"#)));
    // `%emits ε` is no items (§9).
    assert!(!document_was_read(&with_emission(r#"{"items":[]}"#)));
    // `opaque` marks a rule with `%opaque` (docs/output.md).
    assert!(!document_was_read(&with_emission(r#"{"items":[{"capture":"x"}]},"opaque":true"#)));
    // A guard is a gate, negated or not, or a warning (§9).
    let gate_and_warning = with_alternative(
        r#"{"guards":[{"feature":"f","kind":"gate","negated":true},{"feature":"w","kind":"warning","negated":false}],"expr":{"terminal":"b"}}"#,
    );
    assert!(!document_was_read(&gate_and_warning));
    // `#` is a rule's name, and `$` may be read by a condition, and by a
    // tag term through another rule.
    let hash = with_rule(
        r##"{"name":"#","op":"define","flags":[],"alternatives":[{"guards":[],"expr":{"empty":true}}],"conditions":[],"at":[4,1]}"##,
    );
    assert!(!document_was_read(&hash));
    // The pipeline directives with their operands (§9).
    assert!(!document_was_read(&with_directive(r#"{"name":"features","args":["f","g-2"],"at":[2,30]}"#)));
    let whole = r#"{"op":"⊆","left":{"tag":"T"},"right":{"call":"tags","args":[{"capture":""}]}}"#;
    let both = format!(r#"{{"all":[{whole},{{"not":{whole}}}]}}"#);
    assert!(!document_was_read(&with_condition(whole)));
    assert!(!document_was_read(&with_condition(&both)));
    assert!(!document_was_read(&with_tags(r#"{"call":"tags","args":[{"capture":""},{"rule":"text"}]}"#)));
    let text = r#"{"op":"≠","left":{"call":"text","args":[{"capture":""}]},"right":{"string":"b"}}"#;
    assert!(!document_was_read(&with_tags(&format!(r#"{{"if":{text},"then":{{"tag":"T"}}}}"#))));
    // A guarded tag term, a presence test and an implication (§10).
    let guarded =
        with_tags(r#"{"union":[{"tag":"T"},{"if":{"captured":"x"},"then":{"call":"tags","args":[{"capture":"x"}]}}]}"#);
    assert!(!document_was_read(&guarded));
    let implication = r#"{"if":{"captured":"w"},"then":{"op":"=","left":{"call":"text","args":[{"capture":"w"}]},"right":{"string":"b"}}}"#;
    assert!(!document_was_read(&with_condition(implication)));
    // `initial` of a span, and of `$` in a guard inside a tag term (§9).
    assert!(!document_was_read(&with_condition(r#"{"initial":{"call":"tail","args":[{"capture":"w"}]}}"#)));
    assert!(!document_was_read(&with_tags(r#"{"if":{"initial":{"capture":""}},"then":{"tag":"T"}}"#)));
    // `begins` of `from` and `after` of a span, and those spans as a
    // term's argument (§9).
    let begins = r#"{"begins":{"call":"after","args":[{"capture":"w"}]},"rule":"text"}"#;
    assert!(!document_was_read(&with_condition(begins)));
    let not_begins =
        r#"{"not":{"begins":{"call":"from","args":[{"call":"tail","args":[{"capture":"w"}]}]},"rule":"x"}}"#;
    assert!(!document_was_read(&with_condition(not_begins)));
    assert!(!document_was_read(&with_tags(r#"{"call":"tags","args":[{"call":"from","args":[{"capture":"x"}]}]}"#)));
    // A condition and an emission that serve some alternatives only.
    let some = r#"{"name":"x","op":"define","flags":[],"alternatives":[{"guards":[],"expr":{"capture":"w","expr":{"terminal":"b"}}},{"guards":[],"expr":{"terminal":"c"}}],"emit":{"items":[{"capture":"w"},{"capture":""}]},"conditions":[{"op":"=","left":{"call":"text","args":[{"capture":"w"}]},"right":{"string":"b"}}],"at":[4,1]}"#;
    assert!(document_was_read(&with_rule(some)), "$ with a capture is malformed");
    let some = r#"{"name":"x","op":"define","flags":[],"alternatives":[{"guards":[],"expr":{"seq":[{"capture":"w","expr":{"terminal":"b"}},{"terminal":"c"}]}},{"guards":[],"expr":{"terminal":"c"}}],"emit":{"items":[{"capture":"w"},{"insert":"T"}]},"conditions":[{"op":"=","left":{"call":"text","args":[{"capture":"w"}]},"right":{"string":"b"}}],"at":[4,1]}"#;
    assert!(!document_was_read(&with_rule(some)));
    // Tags of the three kinds, set difference, ⊈ and ∈ in a set of strings
    // (engine §1, §10).
    assert!(!document_was_read(&with_alternative(r#"{"guards":[],"expr":{"terminal":"'b'"}}"#)));
    assert!(!document_was_read(&with_alternative(r#"{"guards":[],"expr":{"terminal":"'\\u{301}'"}}"#)));
    assert!(!document_was_read(&with_alternative(r#"{"guards":[],"expr":{"terminal":"/b/"}}"#)));
    let difference =
        r#"{"difference":[{"call":"tags","args":[{"capture":"x"}]},{"union":[{"tag":"T"},{"tag":"'t'"}]}]}"#;
    assert!(!document_was_read(&with_tags(difference)));
    let not_subset = r#"{"op":"⊈","left":{"tag":"T"},"right":{"call":"tags","args":[{"capture":"w"}]}}"#;
    assert!(!document_was_read(&with_condition(not_subset)));
    let runs = r#"{"call":"split","args":[{"call":"phonemes","args":[{"capture":"w"}]},{"string":"."}]}"#;
    let member = format!(r#"{{"op":"∉","left":{{"string":"b"}},"right":{runs}}}"#);
    assert!(!document_was_read(&with_condition(&member)));
    let empty = format!(r#"{{"op":"=","left":{{"emptySet":true}},"right":{runs}}}"#);
    assert!(!document_was_read(&with_condition(&empty)));
    // tag of a string, as a tag term and in a condition (engine §10).
    assert!(!document_was_read(&with_tags(r#"{"call":"tag","args":[{"call":"text","args":[{"capture":"x"}]}]}"#)));
    let named = r#"{"op":"=","left":{"call":"tag","args":[{"string":"T"}]},"right":{"tag":"T"}}"#;
    assert!(!document_was_read(&with_condition(named)));
    // A capture in a plain optional, a choice or an `&`, and six captures
    // in one production (engine §3.5, §9).
    let optional =
        r#"{"guards":[],"expr":{"seq":[{"terminal":"b"},{"optional":{"capture":"x","expr":{"terminal":"c"}}}]}}"#;
    assert!(!document_was_read(&with_alternative(optional)));
    let six: Vec<String> = ["a", "b", "c", "d", "e", "f"]
        .iter()
        .map(|name| format!(r#"{{"capture":"{name}","expr":{{"terminal":"b"}}}}"#))
        .collect();
    let six = format!(r#"{{"guards":[],"expr":{{"choice":[{{"seq":[{}]}},{{"terminal":"b"}}]}}}}"#, six.join(","));
    assert!(!document_was_read(&with_alternative(&six)));
    // A tested reference or terminal, captured or not, each test, and a
    // tested symbol below 255 compound nodes, itself a compound node whose
    // value counts on from its depth (§9).
    let tested = |expr: &str| with_alternative(&format!(r#"{{"guards":[],"expr":{expr}}}"#));
    assert!(!document_was_read(&tested(r#"{"test":"=","value":{"string":"b"},"expr":{"terminal":"b"}}"#)));
    assert!(!document_was_read(&tested(r#"{"test":"≠","value":{"string":""},"expr":{"ref":"B"}}"#)));
    assert!(!document_was_read(&tested(
        r#"{"capture":"x","expr":{"test":"=","value":{"string":"b'i."},"expr":{"terminal":"b"}}}"#
    )));
    for (op, value) in [
        ("⊇", r#"{"tag":"B"}"#),
        ("⊉", r#"{"emptySet":true}"#),
        ("∩=∅", r#"{"union":[{"tag":"B"},{"range":["'a'","'c'"]}]}"#),
        ("∩≠∅", r#"{"const":"A","at":[9,9]}"#),
    ] {
        let expr = format!(r#"{{"test":"{op}","value":{value},"expr":{{"range":["'b'","'z'"]}}}}"#);
        assert!(!document_was_read(&tested(&expr)), "a well-formed test was not used: {expr}");
    }
    let optionals = format!(
        "{}{{\"test\":\"=\",\"value\":{{\"string\":\"b\"}},\"expr\":{{\"terminal\":\"b\"}}}}{}",
        "{\"optional\":".repeat(255),
        "}".repeat(255)
    );
    assert!(!document_was_read(&tested(&optionals)));
    let deep_value = format!(
        "{}{{\"test\":\"⊇\",\"value\":{{\"union\":[{{\"tag\":\"A\"}},{{\"tag\":\"B\"}}]}},\"expr\":{{\"terminal\":\"b\"}}}}{}",
        "{\"optional\":".repeat(254),
        "}".repeat(254)
    );
    assert!(!document_was_read(&tested(&deep_value)));
    // Four captures, and nodes below exactly 256 compound nodes, are allowed.
    let four = with_alternative(
        r#"{"guards":[],"expr":{"seq":[{"capture":"w","expr":{"terminal":"b"}},{"capture":"x","expr":{"terminal":"c"}},{"capture":"y","expr":{"terminal":"c"}},{"capture":"z","expr":{"terminal":"c"}}]}}"#,
    );
    assert!(!document_was_read(&four));
    let optionals = format!("{}{{\"terminal\":\"b\"}}{}", "{\"optional\":".repeat(256), "}".repeat(256));
    assert!(!document_was_read(&with_alternative(&format!(r#"{{"guards":[],"expr":{optionals}}}"#))));
    let sets = format!("{}{{\"tag\":\"T\"}}{}", "{\"union\":[".repeat(256), ",{\"tag\":\"U\"}]}".repeat(256));
    assert!(!document_was_read(&with_tags(&sets)));
    let deep_emission_tags = with_emission(&format!(r#"{{"items":[{{"capture":"x","tags":{sets}}}]}}"#));
    assert!(!document_was_read(&deep_emission_tags), "an emission is no node of its tags' term");
}

#[test]
fn a_cache_of_another_format_is_a_miss() {
    assert!(!document_was_read_from(DOM_FORMAT, &with_rule("")));
    assert!(document_was_read_from(13, &with_rule("")), "a format-13 cache is never used");
    assert!(document_was_read_from(11, &with_rule("")), "a format-11 cache is never used");
    assert!(document_was_read_from(10, &with_rule("")), "a format-10 cache is never used");
    assert!(document_was_read_from(9, &with_rule("")), "a format-9 cache is never used");
    assert!(document_was_read_from(8, &with_rule("")), "a format-8 cache is never used");
    assert!(document_was_read_from(7, &with_rule("")), "a format-7 cache is never used");
    assert!(document_was_read_from(6, &with_rule("")), "a format-6 cache is never used");
    assert!(document_was_read_from(5, &with_rule("")), "a format-5 cache is never used");
    assert!(document_was_read_from(4, &with_rule("")), "a format-4 cache is never used");
    assert!(document_was_read_from(3, &with_rule("")), "a format-3 cache is never used");
    assert!(document_was_read_from(2, &with_rule("")), "a format-2 cache is never used");
    assert!(document_was_read_from(1, &with_rule("")), "a format-1 cache is never used");
}

/// A range or a property from the cache is held to what the reader checks
/// (engine §1, §9).
#[test]
fn a_precompiled_range_or_property_is_checked() {
    let expr = |expr: &str| with_alternative(&format!(r#"{{"guards":[],"expr":{expr}}}"#));
    // Well formed, and none reads "a": each entry is used.
    for dom in [
        expr(r#"{"range":["'b'","'z'"]}"#),
        expr(r#"{"property":"White_Space"}"#),
        // A range or a property is a terminal, and takes a test (§2).
        expr(r#"{"test":"=","value":{"string":"b"},"expr":{"range":["'b'","'z'"]}}"#),
        expr(r#"{"test":"∩≠∅","value":{"tag":"'b'"},"expr":{"property":"L"}}"#),
        expr(
            r#"{"seq":[{"capture":"c","expr":{"range":["'\\u{300}'","'\\u{36F}'"]}},{"capture":"d","expr":{"property":"Cs"}}]}"#,
        ),
        with_tags(r#"{"union":[{"range":["'a'","'c'"]},{"tag":"'x'"}]}"#),
    ] {
        assert!(!document_was_read(&dom), "a well-formed entry was not used: {dom}");
    }
    for dom in [
        expr(r#"{"range":["'z'","'a'"]}"#),
        expr(r#"{"range":["'a'"]}"#),
        expr(r#"{"range":["'\\u{61}'","'z'"]}"#),
        expr(r#"{"range":["A","'z'"]}"#),
        expr(r#"{"range":["'a'","'z'"],"terminal":"A"}"#),
        expr(r#"{"property":"Letter"}"#),
        expr(r#"{"property":"lu"}"#),
        expr(r#"{"property":"L","range":["'a'","'z'"]}"#),
        expr(r#"{"test":"⊇","value":{"tag":"'a'"},"expr":{"range":["'z'","'a'"]}}"#),
        expr(r#"{"test":"=","value":{"string":"a"},"expr":{"property":"Letter"}}"#),
        expr(r#"{"capture":"c","expr":{"property":"Foo"}}"#),
        with_tags(r#"{"property":"L"}"#),
        with_tags(r#"{"range":["'z'","'a'"]}"#),
        with_emission(r#"{"items":[{"insert":"'a'..'z'"}]}"#),
    ] {
        assert!(document_was_read(&dom), "a malformed entry was used: {dom}");
    }
    // A range or a property beside a sequence is checked before the
    // sequence is split, so no member of the node goes unread.
    for beside in MALFORMED_BESIDE_A_SEQUENCE {
        let dom = expr(&format!(r#"{{"seq":[{{"range":["'b'","'z'"]}},{{"property":"L"}}],{beside}}}"#));
        assert!(document_was_read(&dom), "a malformed entry was used: {dom}");
    }
    assert!(document_was_read(&expr(r#"{"seq":[{"range":["'b'","'z'"]},{"property":"Bogus"}]}"#)));
}

/// Members that make a sequence node malformed: a range or a property has no
/// member but its own (engine §9).
const MALFORMED_BESIDE_A_SEQUENCE: [&str; 4] =
    [r#""range":["'z'","'a'"]"#, r#""range":["'a'","'z'"]"#, r#""property":"Bogus""#, r#""property":"L""#];

/// A malformed range or property in the bootstrap is an error of the
/// grammar, where there is no document to read instead (engine §9).
#[test]
fn a_bootstrap_with_a_malformed_range_or_property_is_an_error() {
    let refusal = |dom: String| {
        let bootstrap = format!(
            r#"{{"format":{DOM_FORMAT},"stages":[{{"name":"lexical","documents":[{{"path":"notation/lexical.md","dom":{dom}}}]}}]}}"#
        );
        let sources = [
            ("p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string()),
            ("g.md", DOCUMENT.to_string()),
            ("notation/bootstrap.json", bootstrap),
        ];
        let error = gencmu::load_dialect_sources(sources, "p.md").expect_err("a notation that cannot read g.md");
        assert_eq!(error.kind, gencmu::ErrorKind::Grammar);
        error.message.strip_prefix("notation/bootstrap.json: ").map(str::to_string)
    };
    let expr = |expr: &str| with_alternative(&format!(r#"{{"guards":[],"expr":{expr}}}"#));
    // A bootstrap that is read, whose notation then fails on g.md.
    assert_eq!(refusal(expr(r#"{"seq":[{"range":["'a'","'z'"]},{"property":"L"}]}"#)), None);
    let mut refused = vec![
        expr(r#"{"seq":[{"range":["'z'","'a'"]},{"property":"L"}]}"#),
        expr(r#"{"seq":[{"range":["'\\u{61}'","'z'"]},{"property":"L"}]}"#),
        expr(r#"{"seq":[{"range":["'a'","'z'"]},{"property":"Bogus"}]}"#),
        with_tags(r#"{"property":"L"}"#),
    ];
    for beside in MALFORMED_BESIDE_A_SEQUENCE {
        refused.push(expr(&format!(r#"{{"seq":[{{"range":["'a'","'z'"]}},{{"property":"L"}}],{beside}}}"#)));
    }
    for dom in refused {
        assert!(refusal(dom.clone()).is_some(), "a malformed bootstrap was used: {dom}");
    }
}

#[test]
fn every_malformed_dom_is_a_cache_miss() {
    let nested = format!("{}{{\"terminal\":\"b\"}}{}", "{\"optional\":".repeat(257), "}".repeat(257));
    let tested = |expr: &str| with_alternative(&format!(r#"{{"guards":[],"expr":{expr}}}"#));
    let test =
        |op: &str, value: &str, expr: &str| tested(&format!(r#"{{"test":"{op}","value":{value},"expr":{expr}}}"#));
    let b = r#"{"terminal":"b"}"#;
    let sound = r#"{"string":"b"}"#;
    let tested_nested = format!(
        "{}{{\"test\":\"=\",\"value\":{{\"string\":\"b\"}},\"expr\":{{\"terminal\":\"b\"}}}}{}",
        "{\"optional\":".repeat(256),
        "}".repeat(256)
    );
    let deep_value = format!(
        "{}{{\"test\":\"⊇\",\"value\":{{\"union\":[{{\"tag\":\"A\"}},{{\"tag\":\"B\"}}]}},\"expr\":{{\"terminal\":\"b\"}}}}{}",
        "{\"optional\":".repeat(255),
        "}".repeat(255)
    );
    let cases: Vec<(&str, String)> = vec![
        ("format 5", dom(B, "", "", 5, r#""greedy""#)),
        ("an unknown comparator", test("==", sound, b)),
        ("a comparator that is not a string", test("7", sound, b).replace(r#""test":"7""#, r#""test":7"#)),
        ("a string in upper case", test("=", r#"{"string":"B"}"#, b)),
        ("a string with a comma", test("=", r#"{"string":"b,c"}"#, b)),
        (
            "a captured string in upper case",
            tested(&format!(r#"{{"capture":"x","expr":{{"test":"=","value":{{"string":"Б"}},"expr":{b}}}}}"#)),
        ),
        ("a tag set in a sound test", test("=", r#"{"tag":"B"}"#, b)),
        ("a string in a tag test", test("⊇", sound, b)),
        ("an operand that reads a span", test("⊇", r#"{"call":"tags","args":[{"capture":""}]}"#, b)),
        ("an operand that is a capture", test("=", r#"{"capture":"x"}"#, b)),
        ("a guarded operand", test("⊇", r#"{"if":{"captured":"x"},"then":{"tag":"B"}}"#, b)),
        ("a malformed operand", test("⊇", r#"{"tag":"B","string":"b"}"#, b)),
        ("a test of #", test("=", sound, r##"{"ref":"#"}"##)),
        ("a test of an optional", test("=", sound, r#"{"optional":{"terminal":"b"}}"#)),
        ("a test of a tested symbol", test("=", sound, &format!(r#"{{"test":"=","value":{sound},"expr":{b}}}"#))),
        ("a test of a capture", test("=", sound, r#"{"capture":"x","expr":{"terminal":"b"}}"#)),
        ("a test of ε", test("=", sound, r#"{"empty":true}"#)),
        ("a test of a malformed range", test("=", sound, r#"{"range":["'z'","'a'"]}"#)),
        ("a test with no expression", tested(r#"{"test":"=","value":{"string":"b"}}"#)),
        ("a test with no value", tested(r#"{"test":"=","expr":{"terminal":"b"}}"#)),
        ("a test of an empty terminal", test("=", sound, r#"{"empty":true,"terminal":"b"}"#)),
        ("a test of a reference and a terminal", test("=", sound, r#"{"ref":"B","terminal":"b"}"#)),
        (
            "a tested symbol that is also empty",
            tested(r#"{"test":"=","value":{"string":"b"},"expr":{"terminal":"b"},"empty":true}"#),
        ),
        (
            "a tested symbol that is also a capture",
            tested(r#"{"capture":"x","test":"=","value":{"string":"b"},"expr":{"terminal":"b"}}"#),
        ),
        (
            "a top-level sequence that is also a tested symbol",
            tested(
                r#"{"seq":[{"terminal":"b"},{"terminal":"b"}],"test":"=","value":{"string":"b"},"expr":{"terminal":"b"}}"#,
            ),
        ),
        (
            "a tested symbol that is also an optional",
            tested(r##"{"optional":{"terminal":"b"},"test":"=","value":{"string":"b"},"expr":{"ref":"#"}}"##),
        ),
        ("a tested symbol nested too deeply", tested(&tested_nested)),
        ("a test's value nested too deeply", tested(&deep_value)),
        ("a directive argument that is not a string", dom(B, "", "", DOM_FORMAT, "7")),
        (
            "a rule name that is not a name",
            with_rule(
                r#"{"name":"9x","op":"define","flags":[],"alternatives":[{"guards":[],"expr":{"terminal":"b"}}],"conditions":[],"at":[4,1]}"#,
            ),
        ),
        (
            "an unknown op",
            with_rule(
                r#"{"name":"x","op":"replace","alternatives":[{"guards":[],"expr":{"terminal":"b"}}],"conditions":[],"at":[4,1]}"#,
            ),
        ),
        (
            "no alternatives",
            with_rule(r#"{"name":"x","op":"define","flags":[],"alternatives":[],"conditions":[],"at":[4,1]}"#),
        ),
        (
            "a malformed position",
            with_rule(
                r#"{"name":"x","op":"define","flags":[],"alternatives":[{"guards":[],"expr":{"terminal":"b"}}],"conditions":[],"at":[4]}"#,
            ),
        ),
        (
            "a guard's negated not a boolean",
            with_alternative(r#"{"guards":[{"feature":"f","kind":"gate","negated":"no"}],"expr":{"terminal":"b"}}"#),
        ),
        (
            "a guard without a kind",
            with_alternative(r#"{"guards":[{"feature":"f","negated":false}],"expr":{"terminal":"b"}}"#),
        ),
        (
            "a guard of an unknown kind",
            with_alternative(r#"{"guards":[{"feature":"f","kind":"hint","negated":false}],"expr":{"terminal":"b"}}"#),
        ),
        (
            "a negated warning",
            with_alternative(r#"{"guards":[{"feature":"f","kind":"warning","negated":true}],"expr":{"terminal":"b"}}"#),
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
        (
            "a repeat with the min of format 17",
            with_alternative(r#"{"guards":[],"expr":{"repeat":{"terminal":"b"},"min":1}}"#),
        ),
        (
            "a chain in a sequence",
            with_alternative(
                r#"{"guards":[],"expr":{"seq":[{"terminal":"b"},{"repeat":{"terminal":"b"},"chain":"left"}]}}"#,
            ),
        ),
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
        ("a hash expression", with_alternative(r#"{"guards":[],"expr":{"hash":true}}"#)),
        ("$ wrapping a symbol", with_alternative(r#"{"guards":[],"expr":{"capture":"","expr":{"terminal":"b"}}}"#)),
        (
            "a rule name of two hashes",
            with_rule(
                r###"{"name":"##","op":"define","flags":[],"alternatives":[{"guards":[],"expr":{"terminal":"b"}}],"conditions":[],"at":[4,1]}"###,
            ),
        ),
        ("$ with an inserted tag", with_emission(r#"{"items":[{"capture":""},{"insert":"X"}]}"#)),
        ("$ with a capture", with_emission(r#"{"items":[{"capture":""},{"capture":"x"}]}"#)),
        ("a capture listed twice", with_emission(r#"{"items":[{"capture":"x"},{"capture":"x"}]}"#)),
        ("tags on an inserted tag", with_emission(r#"{"items":[{"capture":"x"},{"insert":"X","tags":{"tag":"T"}}]}"#)),
        ("a capture and an insert in one item", with_emission(r#"{"items":[{"capture":"x","insert":"X"}]}"#)),
        ("an unknown member of an item", with_emission(r#"{"items":[{"capture":"x","at":[1,1]}]}"#)),
        ("<∅>", with_emission(r#"{"items":[{"capture":"x","tags":{"emptySet":true}}]}"#)),
        ("an unknown emission item", with_emission(r#"{"items":[{"emit":"x"}]}"#)),
        // Attachments are lists of named captures, present only when not
        // empty, only on a named capture, and each capture once in the
        // emission (§9, §11).
        ("an empty list of attachments", with_emission(r#"{"items":[{"capture":"y","before":[]}]}"#)),
        ("an attachment of no name", with_emission(r#"{"items":[{"capture":"x","after":["y",""]}]}"#)),
        ("an attachment that is no capture name", with_emission(r#"{"items":[{"capture":"x","after":["Y"]}]}"#)),
        ("attachments that are not a list", with_emission(r#"{"items":[{"capture":"x","after":"y"}]}"#)),
        ("attachments on $", with_emission(r#"{"items":[{"capture":"","after":["y"]}]}"#)),
        (
            "attachments on an inserted tag",
            with_emission(r#"{"items":[{"insert":"X","before":["x"]},{"capture":"y"}]}"#),
        ),
        (
            "an attachment that is also an item",
            with_emission(r#"{"items":[{"capture":"x","after":["y"]},{"capture":"y"}]}"#),
        ),
        ("an attachment listed twice", with_emission(r#"{"items":[{"capture":"y","before":["x","x"]}]}"#)),
        ("an attachment out of order", with_emission(r#"{"items":[{"capture":"x","before":["y"]}]}"#)),
        ("an attachment no alternative has", with_emission(r#"{"items":[{"capture":"x","after":["z"]}]}"#)),
        (
            "any of one condition",
            with_condition(r#"{"any":[{"op":"=","left":{"string":"a"},"right":{"string":"b"}}]}"#),
        ),
        (
            "all of one condition",
            with_condition(r#"{"all":[{"op":"=","left":{"string":"a"},"right":{"string":"b"}}]}"#),
        ),
        ("matches of a value", with_condition(r#"{"matches":{"string":"b"},"rule":"text"}"#)),
        ("initial of a value", with_condition(r#"{"initial":{"string":"b"}}"#)),
        ("initial with a rule", with_condition(r#"{"initial":{"capture":"w"},"rule":"text"}"#)),
        ("begins of a value", with_condition(r#"{"begins":{"string":"b"},"rule":"text"}"#)),
        ("begins without a rule", with_condition(r#"{"begins":{"capture":"w"}}"#)),
        (
            "matches and begins in one condition",
            with_condition(r#"{"matches":{"capture":"w"},"begins":{"capture":"w"},"rule":"text"}"#),
        ),
        ("an unknown comparison", with_condition(r#"{"op":"<","left":{"string":"a"},"right":{"string":"b"}}"#)),
        ("an unknown function", with_tags(r#"{"call":"uppercase","args":[{"capture":"x"}]}"#)),
        ("matches as a term", with_tags(r#"{"call":"matches","args":[{"capture":"x"},{"rule":"text"}]}"#)),
        ("initial as a term", with_tags(r#"{"call":"initial","args":[{"capture":"x"}]}"#)),
        ("begins as a term", with_tags(r#"{"call":"begins","args":[{"capture":"x"},{"rule":"text"}]}"#)),
        ("head as a value", with_tags(r#"{"call":"head","args":[{"capture":"x"}]}"#)),
        ("after as a value", with_tags(r#"{"call":"after","args":[{"capture":"x"}]}"#)),
        ("from of a value", with_tags(r#"{"call":"text","args":[{"call":"from","args":[{"string":"x"}]}]}"#)),
        (
            "lowercase, which is no function",
            with_condition(r#"{"op":"=","left":{"call":"lowercase","args":[{"string":"x"}]},"right":{"string":"x"}}"#),
        ),
        (
            "runs, which is no function",
            with_condition(r#"{"op":"∈","left":{"string":"x"},"right":{"call":"runs","args":[{"capture":"w"}]}}"#),
        ),
        ("tag of a tag set", with_tags(r#"{"call":"tag","args":[{"tag":"x"}]}"#)),
        ("tag of a span", with_tags(r#"{"call":"tag","args":[{"capture":"x"}]}"#)),
        ("tag of a string that is not a name", with_tags(r#"{"call":"tag","args":[{"string":"x y"}]}"#)),
        (
            "split of one string",
            with_condition(r#"{"op":"∈","left":{"string":"x"},"right":{"call":"split","args":[{"string":"x"}]}}"#),
        ),
        (
            "split of a span",
            with_condition(
                r#"{"op":"∈","left":{"string":"x"},"right":{"call":"split","args":[{"capture":"w"},{"string":"."}]}}"#,
            ),
        ),
        (
            "split with an empty delimiter",
            with_condition(
                r#"{"op":"∈","left":{"string":"x"},"right":{"call":"split","args":[{"string":"x"},{"string":""}]}}"#,
            ),
        ),
        ("a capture on the left of ∈", with_condition(r#"{"op":"∈","left":{"capture":"w"},"right":{"capture":"w"}}"#)),
        (
            "tags on the left of ∉",
            with_condition(r#"{"op":"∉","left":{"call":"tags","args":[{"capture":"w"}]},"right":{"string":"b"}}"#),
        ),
        ("phonemes of two spans", with_tags(r#"{"call":"phonemes","args":[{"capture":"x"},{"capture":"x"}]}"#)),
        ("phonemes of a value", with_tags(r#"{"call":"phonemes","args":[{"string":"x"}]}"#)),
        ("tags with a value for a rule", with_tags(r#"{"call":"tags","args":[{"capture":"x"},{"string":"text"}]}"#)),
        ("a union of one term", with_tags(r#"{"union":[{"tag":"T"}]}"#)),
        ("a set", with_tags(r#"{"set":[{"tag":"T"}]}"#)),
        ("tags of no arguments", with_tags(r#"{"call":"tags","args":null}"#)),
        ("a tag term of $", with_tags(r#"{"capture":""}"#)),
        ("a tag term of tags($)", with_tags(r#"{"call":"tags","args":[{"capture":""}]}"#)),
        ("a tag term of classes($)", with_tags(r#"{"call":"classes","args":[{"capture":""}]}"#)),
        (
            "a tag term with $ inside",
            with_tags(r#"{"union":[{"tag":"T"},{"intersection":[{"capture":""},{"tag":"U"}]}]}"#),
        ),
        ("an unknown term", with_tags(r#"{"literal":"T"}"#)),
        ("a weak tag", with_tags(r#"{"weak":"T"}"#)),
        // Tags in their canonical spelling (engine §1).
        ("a terminal that is not a tag", with_alternative(r#"{"guards":[],"expr":{"terminal":"b c"}}"#)),
        ("a character tag of two characters", with_alternative(r#"{"guards":[],"expr":{"terminal":"'bc'"}}"#)),
        ("a character tag escaped needlessly", with_alternative(r#"{"guards":[],"expr":{"terminal":"'\\u{62}'"}}"#)),
        ("a mark unescaped", with_alternative("{\"guards\":[],\"expr\":{\"terminal\":\"'\u{301}'\"}}")),
        ("an escape with a leading zero", with_alternative(r#"{"guards":[],"expr":{"terminal":"'\\u{0301}'"}}"#)),
        ("an escape in lower case", with_alternative(r#"{"guards":[],"expr":{"terminal":"'\\u{e000}'"}}"#)),
        ("a string as a terminal", with_alternative(r#"{"guards":[],"expr":{"terminal":"\"b\""}}"#)),
        ("a tag literal that is not a tag", with_tags(r#"{"tag":"~T"}"#)),
        ("an inserted item that is not a tag", with_emission(r#"{"items":[{"capture":"x"},{"insert":"x y"}]}"#)),
        (
            "a captured terminal that is not a tag",
            with_alternative(r#"{"guards":[],"expr":{"capture":"x","expr":{"terminal":"''"}}}"#),
        ),
        (
            "a capture name with a capital",
            with_alternative(r#"{"guards":[],"expr":{"capture":"X","expr":{"terminal":"b"}}}"#),
        ),
        ("a directive named elidable", with_directive(r#"{"name":"elidable","args":["KU"],"at":[4,1]}"#)),
        (
            "a maximal member on a directive",
            with_directive(r#"{"name":"features","args":["f"],"maximal":true,"at":[4,1]}"#),
        ),
        // Terms and conditions whose types do not agree (engine §10).
        ("a string as a constituent's tags", with_tags(r#"{"string":"T"}"#)),
        ("a span in a union", with_tags(r#"{"union":[{"capture":"x"},{"tag":"T"}]}"#)),
        ("a difference of three sets", with_tags(r#"{"difference":[{"tag":"T"},{"tag":"U"},{"tag":"V"}]}"#)),
        ("a difference of one set", with_tags(r#"{"difference":[{"tag":"T"}]}"#)),
        ("a string in a tag set", with_condition(r#"{"op":"∈","left":{"string":"b"},"right":{"tag":"T"}}"#)),
        ("a string equal to a tag set", with_condition(r#"{"op":"=","left":{"string":"b"},"right":{"tag":"T"}}"#)),
        ("a string in ⊆", with_condition(r#"{"op":"⊆","left":{"string":"b"},"right":{"tag":"T"}}"#)),
        ("∅ = ∅", with_condition(r#"{"op":"=","left":{"emptySet":true},"right":{"emptySet":true}}"#)),
        (
            "a union of a set of strings and a tag set",
            with_condition(
                r#"{"op":"=","left":{"emptySet":true},"right":{"union":[{"call":"split","args":[{"call":"phonemes","args":[{"capture":"w"}]},{"string":"."}]},{"tag":"T"}]}}"#,
            ),
        ),
        ("a guarded string", with_tags(r#"{"if":{"captured":"x"},"then":{"string":"T"}}"#)),
        ("a presence test of a capture no alternative has", with_condition(r#"{"captured":"v"}"#)),
        ("a presence test that is not a string", with_condition(r#"{"captured":7}"#)),
        ("a presence test with another key", with_condition(r#"{"captured":"w","not":{"captured":"w"}}"#)),
        ("an implication without a consequent", with_condition(r#"{"if":{"captured":"w"}}"#)),
        ("a guarded term with an else", with_tags(r#"{"if":{"captured":"x"},"then":{"tag":"T"},"else":{"tag":"U"}}"#)),
        ("a guarded term without a term", with_tags(r#"{"if":{"captured":"x"}}"#)),
        (
            "a guard that reads the tags its term defines",
            with_tags(
                r#"{"if":{"op":"⊆","left":{"tag":"T"},"right":{"call":"tags","args":[{"capture":""}]}},"then":{"tag":"T"}}"#,
            ),
        ),
        (
            "a redefinition with an unknown op",
            with_rule(
                r#"{"name":"x","op":"replace","alternatives":[{"guards":[],"expr":{"terminal":"b"}}],"conditions":[],"at":[4,1]}"#,
            ),
        ),
        (
            "a condition that applies to no alternative",
            with_rule(
                r#"{"name":"x","op":"define","flags":[],"alternatives":[{"guards":[],"expr":{"capture":"w","expr":{"terminal":"b"}}},{"guards":[],"expr":{"capture":"v","expr":{"terminal":"c"}}}],"conditions":[{"all":[{"op":"=","left":{"call":"text","args":[{"capture":"w"}]},"right":{"string":"b"}},{"op":"=","left":{"call":"text","args":[{"capture":"v"}]},"right":{"string":"c"}}]}],"at":[4,1]}"#,
            ),
        ),
        (
            "an unguarded tag term",
            with_rule(
                r#"{"name":"x","op":"define","flags":[],"tags":{"call":"tags","args":[{"capture":"w"}]},"alternatives":[{"guards":[],"expr":{"capture":"w","expr":{"terminal":"b"}}},{"guards":[],"expr":{"terminal":"c"}}],"conditions":[],"at":[4,1]}"#,
            ),
        ),
        (
            "an inserted tag whose anchor an alternative lacks",
            with_rule(
                r#"{"name":"x","op":"define","flags":[],"alternatives":[{"guards":[],"expr":{"seq":[{"capture":"w","expr":{"terminal":"b"}},{"capture":"v","expr":{"terminal":"c"}}]}},{"guards":[],"expr":{"capture":"w","expr":{"terminal":"b"}}}],"emit":{"items":[{"capture":"w"},{"insert":"T"},{"capture":"v"}]},"conditions":[],"at":[4,1]}"#,
            ),
        ),
        (
            "an alternative left nothing to emit",
            with_rule(
                r#"{"name":"x","op":"define","flags":[],"alternatives":[{"guards":[],"expr":{"capture":"w","expr":{"terminal":"b"}}},{"guards":[],"expr":{"terminal":"c"}}],"emit":{"items":[{"capture":"w"}]},"conditions":[],"at":[4,1]}"#,
            ),
        ),
        ("captures listed out of order", with_emission(r#"{"items":[{"capture":"y"},{"capture":"x"}]}"#)),
        ("opaque false", with_emission(r#"{"items":[{"capture":"x"}]},"opaque":false"#)),
        ("opaque that is not a boolean", with_emission(r#"{"items":[{"capture":"x"}]},"opaque":1"#)),
        ("opaque with %emits ε", with_emission(r#"{"items":[]},"opaque":true"#)),
        (
            "an emission naming a capture no alternative has",
            with_emission(r#"{"items":[{"capture":"x"},{"capture":"z","tags":{"tag":"T"}}]}"#),
        ),
        (
            "an item's tags using a capture no alternative has",
            with_emission(r#"{"items":[{"capture":"x","tags":{"call":"tags","args":[{"capture":"z"}]}}]}"#),
        ),
        ("a term that is not an object", with_tags(r#""T""#)),
        // A term has exactly the members of one form, in either order.
        ("a tag that is also a string", with_tags(r#"{"tag":"T","string":"b"}"#)),
        ("a string that is also a tag", with_tags(r#"{"string":"b","tag":"T"}"#)),
        ("a tag of ! that is also a string", with_tags(r#"{"tag":"!","string":"x"}"#)),
        ("a string that is also a tag of !", with_tags(r#"{"string":"x","tag":"!"}"#)),
        (
            "a compared tag that is also a string",
            with_condition(
                r#"{"op":"=","left":{"call":"text","args":[{"capture":"w"}]},"right":{"tag":"Bad","string":"b"}}"#,
            ),
        ),
        (
            "a compared string that is also a tag",
            with_condition(
                r#"{"op":"=","left":{"call":"text","args":[{"capture":"w"}]},"right":{"string":"b","tag":"Bad"}}"#,
            ),
        ),
        (
            "a difference that is also a union",
            with_tags(r#"{"difference":[{"tag":"T"},{"tag":"U"}],"union":[{"tag":"T"},{"tag":"U"}]}"#),
        ),
        (
            "a union that is also a difference",
            with_tags(r#"{"union":[{"tag":"T"},{"tag":"U"}],"difference":[{"tag":"T"},{"tag":"U"}]}"#),
        ),
        (
            "a difference that is also an intersection",
            with_tags(r#"{"difference":[{"tag":"T"},{"tag":"U"}],"intersection":[{"tag":"T"},{"tag":"U"}]}"#),
        ),
        ("a difference that is also a tag", with_tags(r#"{"difference":[{"tag":"T"},{"tag":"U"}],"tag":"T"}"#)),
        ("a tag that is also a difference", with_tags(r#"{"tag":"T","difference":[{"tag":"T"},{"tag":"U"}]}"#)),
        ("a difference of one part", with_tags(r#"{"difference":[{"tag":"T"}]}"#)),
        ("a difference of three parts", with_tags(r#"{"difference":[{"tag":"T"},{"tag":"U"},{"tag":"V"}]}"#)),
        ("a span that is also a tag", with_tags(r#"{"call":"tags","args":[{"capture":"x","tag":"T"}]}"#)),
        ("%stage without a name", with_directive(r#"{"name":"stage","args":[],"at":[4,1]}"#)),
        ("%stage with two names", with_directive(r#"{"name":"stage","args":["a","b"],"at":[4,1]}"#)),
        ("%stage with a name that is not a name", with_directive(r#"{"name":"stage","args":["9a"],"at":[4,1]}"#)),
        ("%include without a path", with_directive(r#"{"name":"include","args":[],"at":[4,1]}"#)),
        ("%include with two paths", with_directive(r#"{"name":"include","args":["a.md","b.md"],"at":[4,1]}"#)),
        ("%features without a name", with_directive(r#"{"name":"features","args":[],"at":[4,1]}"#)),
        (
            "%features with a name that is not a name",
            with_directive(r#"{"name":"features","args":["f g"],"at":[4,1]}"#),
        ),
        ("a directive at a rule's position", with_directive(r#"{"name":"features","args":["x"],"at":[3,1]}"#)),
        ("two directives at one position", with_directive(r#"{"name":"features","args":["x"],"at":[2,1]}"#)),
        (
            "two rules at one position",
            with_rule(
                r#"{"name":"x","op":"define","flags":[],"alternatives":[{"guards":[],"expr":{"terminal":"b"}}],"conditions":[],"at":[3,1]}"#,
            ),
        ),
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
        r#"{{"format":{DOM_FORMAT},"stages":[{{"name":"lexical","documents":[{{"path":"notation/lexical.md","dom":{}}}]}}]}}"#,
        with_emission(r#"{"items":[{"capture":""},{"insert":"X"}]}"#)
    );
    let sources = [
        ("p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string()),
        ("g.md", DOCUMENT.to_string()),
        ("notation/bootstrap.json", bootstrap),
    ];
    let error = gencmu::load_dialect_sources(sources, "p.md").expect_err("a malformed bootstrap");
    assert_eq!(error.kind, gencmu::ErrorKind::Grammar);
}

/// A test in the bootstrap that the reader would refuse is an error of the
/// grammar, not a failure inside lowering.
#[test]
fn a_refused_bootstrap_test_is_an_error() {
    let refusal = |expr: &str| {
        let alternative = format!(r#"{{"guards":[],"expr":{expr}}}"#);
        let bootstrap = format!(
            r#"{{"format":{DOM_FORMAT},"stages":[{{"name":"lexical","documents":[{{"path":"notation/lexical.md","dom":{}}}]}}]}}"#,
            with_alternative(&alternative)
        );
        let sources = [
            ("p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string()),
            ("g.md", DOCUMENT.to_string()),
            ("notation/bootstrap.json", bootstrap),
        ];
        let error = gencmu::load_dialect_sources(sources, "p.md").expect_err("a notation that cannot read g.md");
        assert_eq!(error.kind, gencmu::ErrorKind::Grammar);
        error.message.strip_prefix("notation/bootstrap.json: ").map(str::to_string)
    };
    // A bootstrap that is read, whose notation then fails on g.md.
    assert_eq!(refusal(r#"{"test":"=","value":{"string":"b"},"expr":{"terminal":"b"}}"#), None);
    assert_eq!(
        refusal(r#"{"test":"=","value":{"string":"b,c"},"expr":{"terminal":"b"}}"#).as_deref(),
        Some("the string of a sound test holds a comma, which no canonical sound holds")
    );
    assert_eq!(
        refusal(r#"{"test":"=","value":{"string":"b"},"expr":{"empty":true,"terminal":"b"}}"#).as_deref(),
        Some("a test follows only a reference other than # or a terminal")
    );
    assert_eq!(
        refusal(r#"{"test":"=","value":{"string":"b"},"expr":{"terminal":"b"},"empty":true}"#).as_deref(),
        Some("a malformed expression")
    );
}

/// A term in the bootstrap that joins the members of two forms, or a
/// malformed difference, is an error of the grammar.
#[test]
fn a_bootstrap_term_of_two_forms_is_an_error() {
    let refusal = |term: &str| {
        let bootstrap = format!(
            r#"{{"format":{DOM_FORMAT},"stages":[{{"name":"lexical","documents":[{{"path":"notation/lexical.md","dom":{}}}]}}]}}"#,
            with_tags(term)
        );
        let sources = [
            ("p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string()),
            ("g.md", DOCUMENT.to_string()),
            ("notation/bootstrap.json", bootstrap),
        ];
        let error = gencmu::load_dialect_sources(sources, "p.md").expect_err("a notation that cannot read g.md");
        assert_eq!(error.kind, gencmu::ErrorKind::Grammar);
        error.message.strip_prefix("notation/bootstrap.json: ").map(str::to_string)
    };
    // A bootstrap that is read, whose notation then fails on g.md.
    assert_eq!(refusal(r#"{"tag":"T"}"#), None);
    assert_eq!(refusal(r#"{"difference":[{"tag":"T"},{"tag":"U"}]}"#), None);
    for term in [
        r#"{"tag":"!","string":"x"}"#,
        r#"{"string":"x","tag":"!"}"#,
        r#"{"tag":"T","string":"b"}"#,
        r#"{"string":"b","tag":"T"}"#,
        r#"{"difference":[{"tag":"T"},{"tag":"U"}],"union":[{"tag":"T"},{"tag":"U"}]}"#,
        r#"{"union":[{"tag":"T"},{"tag":"U"}],"difference":[{"tag":"T"},{"tag":"U"}]}"#,
        r#"{"difference":[{"tag":"T"},{"tag":"U"}],"tag":"T"}"#,
        r#"{"difference":[{"tag":"T"}]}"#,
    ] {
        assert_eq!(refusal(term).as_deref(), Some("a malformed term"), "{term}");
    }
}

#[test]
fn a_document_nested_too_deeply_is_an_error_at_its_rule() {
    let ok = format!("```jbogenbau\n%rule a {}B{}\n```\n", "[".repeat(256), "]".repeat(256));
    assert!(gencmu::tools::read_grammar_document(&ok).is_ok());
    let parentheses = format!("```jbogenbau\n%rule a {}B{}\n```\n", "(".repeat(1000), ")".repeat(1000));
    assert!(gencmu::tools::read_grammar_document(&parentheses).is_ok(), "parentheses do not nest the DOM");
    let deep = format!("```jbogenbau\n%rule a B\n%rule c {}B{}\n```\n", "[".repeat(257), "]".repeat(257));
    let error = gencmu::tools::read_grammar_document(&deep).expect_err("nested more than 256 deep");
    assert_eq!((error.line, error.column), (Some(3), Some(1)), "{error}");
}

/// A DOM like the document's, accepting "b", with the constants given and
/// a condition on the text rule, which captures its token as `x`.
fn with_constants(constants: &str, condition: &str) -> String {
    let conditions = if condition.is_empty() { String::new() } else { condition.to_string() };
    let rule = format!(
        r#"{{"name":"text","op":"define","flags":[],"alternatives":[{{"guards":[],"expr":{{"capture":"x","expr":{{"terminal":"b"}}}}}}],"conditions":[{conditions}],"at":[3,1]}}"#
    );
    format!(
        r#"{{"format":{DOM_FORMAT},"rules":[{rule}],"directives":[{{"name":"ambiguity-resolution","args":["greedy"],"at":[2,1]}}],"constants":[{constants}],"classifiers":[],"implications":[]}}"#
    )
}

/// A constant's definition at line `line`, with its value.
fn constant(name: &str, op: &str, value: &str, line: usize) -> String {
    format!(r#"{{"name":"{name}","op":"{op}","value":{value},"at":[{line},1]}}"#)
}

/// A precompiled constant, and a reference to one, are checked as the
/// reader checks them (engine §2, §9).
#[test]
fn a_precompiled_constant_is_checked() {
    let k = constant("K", "define", r#"{"tag":"a"}"#, 5);
    let used = [
        with_constants(&k, ""),
        with_constants(&k, r#"{"op":"⊆","left":{"tag":"a"},"right":{"const":"K","at":[3,20]}}"#),
        with_constants(
            &format!(
                "{},{}",
                constant("S", "define", r#"{"string":"."}"#, 5),
                constant("T", "define", r#"{"call":"split","args":[{"string":"a.b"},{"const":"S","at":[6,20]}]}"#, 6)
            ),
            r#"{"op":"∈","left":{"string":"a"},"right":{"const":"T","at":[3,20]}}"#,
        ),
        with_constants(
            &format!("{k},{}", constant("K", "redefine", r#"{"emptySet":true}"#, 6)),
            r#"{"op":"=","left":{"emptySet":true},"right":{"const":"K","at":[3,20]}}"#,
        ),
    ];
    for dom in &used {
        assert!(!document_was_read(dom), "the cache entry should be used: {dom}");
    }
    let refused = [
        ("no constants", dom(B, "", "", DOM_FORMAT, r#""greedy""#).replace(r#","constants":[]"#, "")),
        ("a name without a capital", with_constants(&constant("k", "define", r#"{"tag":"a"}"#, 5), "")),
        ("an unknown op", with_constants(&constant("K", "extend", r#"{"tag":"a"}"#, 5), "")),
        (
            "a constant without a position",
            with_constants(r#"{"name":"K","op":"define","value":{"tag":"a"},"at":null}"#, ""),
        ),
        (
            "a constant with another member",
            with_constants(r#"{"name":"K","op":"define","value":{"tag":"a"},"at":[5,1],"extra":true}"#, ""),
        ),
        ("a capture in a value", with_constants(&constant("K", "define", r#"{"capture":"x"}"#, 5), "")),
        (
            "phonemes in a value",
            with_constants(&constant("K", "define", r#"{"call":"phonemes","args":[{"capture":"x"}]}"#, 5), ""),
        ),
        (
            "a guarded term in a value",
            with_constants(&constant("K", "define", r#"{"if":{"captured":"x"},"then":{"tag":"a"}}"#, 5), ""),
        ),
        ("∅ as a defined value", with_constants(&constant("K", "define", r#"{"emptySet":true}"#, 5), "")),
        (
            "a union of a string and a tag set",
            with_constants(&constant("K", "define", r#"{"union":[{"string":"a"},{"tag":"b"}]}"#, 5), ""),
        ),
        (
            "an empty delimiter in a value",
            with_constants(
                &constant("K", "define", r#"{"call":"split","args":[{"string":"a"},{"string":""}]}"#, 5),
                "",
            ),
        ),
        (
            "a reference whose name has no capital",
            with_constants(&k, r#"{"op":"⊆","left":{"tag":"a"},"right":{"const":"k","at":[3,20]}}"#),
        ),
        (
            "a reference without a position",
            with_constants(&k, r#"{"op":"⊆","left":{"tag":"a"},"right":{"const":"K"}}"#),
        ),
        (
            "a reference that holds a value",
            with_constants(&k, r#"{"op":"⊆","left":{"tag":"a"},"right":{"const":"K","at":[3,20],"value":{"set":[]}}}"#),
        ),
        (
            "a tag set in ∈, whatever the constant",
            with_constants(&k, r#"{"op":"∈","left":{"tag":"a"},"right":{"const":"K","at":[3,20]}}"#),
        ),
        ("a constant at a rule's position", with_constants(&constant("K", "define", r#"{"tag":"a"}"#, 3), "")),
    ];
    let mut used = Vec::new();
    for (name, dom) in &refused {
        if !document_was_read(dom) {
            used.push(*name);
        }
    }
    assert!(used.is_empty(), "these malformed DOMs were used from the cache: {used:?}");
}

/// A cached DOM holds a constant as the document writes it, and the loader
/// gives it its value when it stitches the stage (engine §2, §8).
#[test]
fn a_precompiled_constant_serves_the_parse() {
    let document = "```jbogenbau\n%ambiguity-resolution greedy\n%const $K ~a ∪ B\n%rule text 'a' <$K>\n```\n";
    let read = gencmu::tools::read_grammar_document(document).expect("the document");
    assert!(
        read.contains(
            r#""constants":[{"name":"K","op":"define","value":{"union":[{"tag":"a"},{"tag":"B"}]},"at":[3,1]}]"#
        ),
        "{read}"
    );
    // The tags of the parse's tree, with the cache entry given.
    let tags = |entry: Option<&str>| {
        let mut sources = vec![
            ("p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string()),
            ("g.md", document.to_string()),
        ];
        if let Some(entry) = entry {
            let compiled = format!(
                r#"{{"format":{DOM_FORMAT},"bootstrap":"{}","documents":{{"g.md":{{"hash":"{}","dom":{entry}}}}}}}"#,
                gencmu::tools::bootstrap_hash(),
                gencmu::tools::fnv1a64(document)
            );
            sources.push(("compiled.json", compiled));
        }
        let dialect = gencmu::load_dialect_sources(sources, "p.md").expect("a dialect");
        let options = gencmu::ParseOptions { auto_features: false, ..Default::default() };
        let result = dialect.parse("a", &options).expect("a parse");
        let tree = result.tree.expect("a tree");
        tree.tags.iter().cloned().collect::<Vec<String>>()
    };
    assert_eq!(tags(None), ["B", "a"]);
    assert_eq!(tags(Some(&read)), ["B", "a"]);
    // A hit: the entry's constant, changed, is the one the parse sees.
    assert_eq!(tags(Some(&read.replace(r#"{"tag":"a"}"#, r#"{"tag":"c"}"#))), ["B", "c"]);
    // A miss: an entry whose reference holds a value, or whose constant is
    // malformed, is refused, and the document is read instead.
    let changed = read.replace(r#"{"const":"K","at":[4,17]}"#, r#"{"const":"K","at":[4,17],"value":{"tag":"c"}}"#);
    assert_ne!(changed, read);
    assert_eq!(tags(Some(&changed.replace(r#"{"tag":"a"}"#, r#"{"tag":"c"}"#))), ["B", "a"]);
    let open = read.replace(r#""value":{"union":[{"tag":"a"},{"tag":"B"}]}"#, r#""value":{"capture":"x"}"#);
    assert_ne!(open, read);
    assert_eq!(tags(Some(&open)), ["B", "a"]);
}

/// A malformed constant in the bootstrap is an error of the grammar.
#[test]
fn a_bootstrap_with_a_malformed_constant_is_an_error() {
    let refusal = |constants: &str| {
        let bootstrap = format!(
            r#"{{"format":{DOM_FORMAT},"stages":[{{"name":"lexical","documents":[{{"path":"notation/lexical.md","dom":{}}}]}}]}}"#,
            with_constants(constants, "")
        );
        let sources = [
            ("p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string()),
            ("g.md", DOCUMENT.to_string()),
            ("notation/bootstrap.json", bootstrap),
        ];
        let error = gencmu::load_dialect_sources(sources, "p.md").expect_err("a notation that cannot read g.md");
        assert_eq!(error.kind, gencmu::ErrorKind::Grammar);
        error.message.strip_prefix("notation/bootstrap.json: ").map(str::to_string)
    };
    // A bootstrap that is read, whose notation then fails on g.md.
    assert_eq!(refusal(&constant("K", "define", r#"{"tag":"a"}"#, 5)), None);
    assert_eq!(refusal(&constant("k", "define", r#"{"tag":"a"}"#, 5)).as_deref(), Some("a malformed constant"));
}

/// A constant's value nested `depth` unions deep.
fn deep_value(depth: usize) -> String {
    format!(r#"{}{{"tag":"a"}}{}"#, r#"{"union":["#.repeat(depth), r#",{"tag":"B"}]}"#.repeat(depth))
}

/// A cached constant nested too deeply is a miss, found before any walk
/// that recurses (engine §9).
#[test]
fn a_precompiled_constant_nested_too_deeply_is_a_miss() {
    assert!(!document_was_read(&with_constants(&constant("K", "define", &deep_value(256), 5), "")));
    assert!(document_was_read(&with_constants(&constant("K", "define", &deep_value(257), 5), "")));
    // As deep as compiled.json can hold.
    assert!(document_was_read(&with_constants(&constant("K", "define", &deep_value(500), 5), "")));
}

/// A bootstrap constant nested too deeply is an error of the grammar,
/// found before any walk that recurses (engine §9).
#[test]
fn a_bootstrap_constant_nested_too_deeply_is_an_error() {
    let bootstrap = format!(
        r#"{{"format":{DOM_FORMAT},"stages":[{{"name":"lexical","documents":[{{"path":"notation/lexical.md","dom":{}}}]}}]}}"#,
        with_constants(&constant("K", "define", &deep_value(500), 5), "")
    );
    let sources = [
        ("p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string()),
        ("g.md", DOCUMENT.to_string()),
        ("notation/bootstrap.json", bootstrap),
    ];
    let error = gencmu::load_dialect_sources(sources, "p.md").expect_err("a bootstrap nested too deeply");
    assert_eq!(error.kind, gencmu::ErrorKind::Grammar);
    assert!(error.message.contains("nested too deeply"), "{}", error.message);
}

/// A cached DOM whose capture checks wait for a constant's value is used,
/// and the loader makes the checks once the constants have their values
/// (engine §3.6, §9).
#[test]
fn a_precompiled_clause_with_a_constant_waits_for_its_value() {
    // The first alternative has no capture and reads only "b", so the
    // text "a" has one derivation.
    let document = |first: &str, last: &str| {
        format!(
            "```jbogenbau\n%ambiguity-resolution greedy\n%const $E {first}\n%rule text 'b' | $x('a')\n%tags Y ∪ ($E ∩ tags($x))\n%redefine-const $E {last}\n```\n"
        )
    };
    // The tags of the parse's tree, or the load error's position, with the
    // cache entry given.
    let outcome = |document: &str, entry: Option<&str>| -> Result<Vec<String>, (usize, usize)> {
        let mut sources = vec![
            ("p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string()),
            ("g.md", document.to_string()),
        ];
        if let Some(entry) = entry {
            let compiled = format!(
                r#"{{"format":{DOM_FORMAT},"bootstrap":"{}","documents":{{"g.md":{{"hash":"{}","dom":{entry}}}}}}}"#,
                gencmu::tools::bootstrap_hash(),
                gencmu::tools::fnv1a64(document)
            );
            sources.push(("compiled.json", compiled));
        }
        let dialect = gencmu::load_dialect_sources(sources, "p.md")
            .map_err(|error| (error.line.unwrap_or(0), error.column.unwrap_or(0)))?;
        let options = gencmu::ParseOptions { auto_features: false, ..Default::default() };
        let result = dialect.parse("a", &options).expect("a parse");
        Ok(result.tree.expect("a tree").tags.iter().cloned().collect())
    };
    let empty = document("B", "$E ∖ B");
    let read = gencmu::tools::read_grammar_document(&empty).expect("the document");
    assert_eq!(outcome(&empty, None), Ok(vec!["Y".to_string()]));
    assert_eq!(outcome(&empty, Some(&read)), Ok(vec!["Y".to_string()]));
    // A hit: the entry, changed, is the one the parse sees.
    assert_eq!(outcome(&empty, Some(&read.replace(r#"{"tag":"Y"}"#, r#"{"tag":"Z"}"#))), Ok(vec!["Z".to_string()]));
    let full = document("B ∖ B", "B");
    let read = gencmu::tools::read_grammar_document(&full).expect("the document");
    assert_eq!(outcome(&full, None), Err((4, 1)));
    assert_eq!(outcome(&full, Some(&read)), Err((4, 1)));
}

/// A DOM like the document's, but accepting "b", with the text rule's tags
/// as given, and these classifiers and implications (docs/output.md).
fn with_classifiers(tags: &str, classifiers: &str, implications: &str) -> String {
    let tags = if tags.is_empty() { String::new() } else { format!(r#","tags":{tags}"#) };
    let rule = format!(
        r#"{{"name":"text","op":"define","flags":[],"alternatives":[{{"guards":[],"expr":{{"capture":"x","expr":{{"terminal":"b"}}}}{tags}}}],"conditions":[],"at":[3,1]}}"#
    );
    format!(
        r#"{{"format":{DOM_FORMAT},"rules":[{rule}],"directives":[{{"name":"ambiguity-resolution","args":["greedy"],"at":[2,1]}}],"constants":[],"classifiers":[{classifiers}],"implications":[{implications}]}}"#
    )
}

/// A cached classifier, implication or call of classify is checked as the
/// reader checks it (engine §9).
#[test]
fn a_precompiled_classifier_and_implication_are_checked() {
    let entry = |extra: &str| {
        let mut fields = [
            ("guards", "[]".to_string()),
            ("keys", r#"["mi"]"#.to_string()),
            ("op", r#""∈""#.to_string()),
            ("class", r#""KOhA""#.to_string()),
            ("at", "[6,3]".to_string()),
        ];
        let mut added = String::new();
        for part in extra.split(';').filter(|part| !part.is_empty()) {
            let (key, value) = part.split_once('=').expect("key=value");
            match fields.iter_mut().find(|(name, _)| *name == key) {
                Some(field) => field.1 = value.to_string(),
                None => added.push_str(&format!(r#","{key}":{value}"#)),
            }
        }
        let body: Vec<String> = fields.iter().map(|(key, value)| format!(r#""{key}":{value}"#)).collect();
        format!("{{{}{added}}}", body.join(","))
    };
    let classifier = |entries: &str| format!(r#"{{"name":"lex","entries":[{entries}],"at":[5,1]}}"#);
    let implication = r#"{"if":{"tag":"UI"},"then":{"tag":"indicator"},"at":[7,1]}"#;
    let classify = r#"{"call":"classify","args":[{"call":"phonemes","args":[{"capture":"x"}]},{"classifier":"lex"}]}"#;
    // Well formed: gates, a removal, no entries, an implication and a call.
    let gated = entry(r#"guards=[{"feature":"f","kind":"gate","negated":true}];op="∉";at=[6,9]"#);
    let good = with_classifiers(classify, &classifier(&format!("{},{gated}", entry(""))), implication);
    assert!(!document_was_read(&good), "the cache entry should be used");
    assert!(!document_was_read(&with_classifiers("", &classifier(""), "")));
    let refused = [
        with_classifiers("", r#"{"name":"Lex","entries":[],"at":[5,1]}"#, ""),
        with_classifiers("", r#"{"name":"lex","entries":[],"at":null}"#, ""),
        with_classifiers("", r#"{"name":"lex","entries":[],"at":[5,1],"extra":true}"#, ""),
        with_classifiers("", r#"{"name":"lex","at":[5,1]}"#, ""),
        with_classifiers("", &classifier(&entry(r#"guards=[{"feature":"f","kind":"warning","negated":false}]"#)), ""),
        with_classifiers("", &classifier(&entry("keys=[]")), ""),
        with_classifiers("", &classifier(&entry(r#"keys=["Mi"]"#)), ""),
        with_classifiers("", &classifier(&entry(r#"keys=["m,i"]"#)), ""),
        with_classifiers("", &classifier(&entry("keys=[1]")), ""),
        with_classifiers("", &classifier(&entry(r#"op="=""#)), ""),
        with_classifiers("", &classifier(&entry(r#"class="koha""#)), ""),
        with_classifiers("", &classifier(&entry(r#"class="/a/""#)), ""),
        with_classifiers("", &classifier(&entry("extra=true")), ""),
        with_classifiers("", "", r#"{"if":{"tag":"UI"},"then":{"tag":"indicator"},"at":null}"#),
        with_classifiers("", "", r#"{"if":{"tag":"UI"},"then":{"tag":"indicator"},"at":[7,1],"extra":true}"#),
        with_classifiers("", "", r#"{"if":{"tag":"UI"},"at":[7,1]}"#),
        with_classifiers("", "", r#"{"if":{"tag":"UI"},"then":{"capture":"x"},"at":[7,1]}"#),
        with_classifiers("", "", r#"{"if":{"tag":"UI"},"then":{"string":"a"},"at":[7,1]}"#),
        with_classifiers(
            "",
            &classifier(&entry("")),
            r#"{"if":{"call":"classify","args":[{"string":"mi"},{"classifier":"lex"}]},"then":{"tag":"m"},"at":[7,1]}"#,
        ),
        // classify names a classifier, in lower case, after a string.
        with_classifiers(&classify.replace("classifier", "rule"), &classifier(&entry("")), ""),
        with_classifiers(&classify.replace("\"lex\"", "\"Lex\""), &classifier(&entry("")), ""),
        with_classifiers(
            r#"{"call":"classify","args":[{"capture":"x"},{"classifier":"lex"}]}"#,
            &classifier(&entry("")),
            "",
        ),
        // Two items at one position.
        with_classifiers("", r#"{"name":"lex","entries":[],"at":[7,1]}"#, implication),
    ];
    for dom in refused {
        assert!(document_was_read(&dom), "a malformed DOM was used: {dom}");
    }
}

/// A malformed classifier in the bootstrap is an error of the grammar.
#[test]
fn a_bootstrap_with_a_malformed_classifier_is_an_error() {
    let bad = r#"{"name":"lex","entries":[{"guards":[],"keys":["Mi"],"op":"∈","class":"KOhA","at":[6,3]}],"at":[5,1]}"#;
    let bootstrap = format!(
        r#"{{"format":{DOM_FORMAT},"stages":[{{"name":"lexical","documents":[{{"path":"notation/lexical.md","dom":{}}}]}}]}}"#,
        with_classifiers("", bad, "")
    );
    let sources = [
        ("p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string()),
        ("g.md", DOCUMENT.to_string()),
        ("notation/bootstrap.json", bootstrap),
    ];
    let error = gencmu::load_dialect_sources(sources, "p.md").expect_err("a malformed bootstrap");
    assert_eq!(error.kind, gencmu::ErrorKind::Grammar);
    assert!(error.message.contains("a malformed entry of a classifier"), "{}", error.message);
}

/// The problem that makes a bootstrap of the one document `dom` an error of
/// the grammar, or `None` when the bootstrap is read.
fn bootstrap_refusal(dom: &str) -> Option<String> {
    let bootstrap = format!(
        r#"{{"format":{DOM_FORMAT},"stages":[{{"name":"lexical","documents":[{{"path":"notation/lexical.md","dom":{dom}}}]}}]}}"#
    );
    let sources = [
        ("p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string()),
        ("g.md", DOCUMENT.to_string()),
        ("notation/bootstrap.json", bootstrap),
    ];
    let error = gencmu::load_dialect_sources(sources, "p.md").expect_err("a notation that cannot read g.md");
    assert_eq!(error.kind, gencmu::ErrorKind::Grammar);
    error.message.strip_prefix("notation/bootstrap.json: ").map(str::to_string)
}

/// `well_formed` is used from the cache and read from the bootstrap. Each
/// of `refused` is a cache miss and an error of a bootstrap, for `problem`.
fn assert_refused(well_formed: &str, refused: &[String], problem: &str) {
    assert!(!document_was_read(well_formed), "the cache entry should be used: {well_formed}");
    assert_eq!(bootstrap_refusal(well_formed), None, "the bootstrap should be read: {well_formed}");
    for dom in refused {
        assert!(document_was_read(dom), "a malformed DOM was used: {dom}");
        let refusal = bootstrap_refusal(dom).unwrap_or_default();
        assert!(refusal.contains(problem), "{refusal}: {dom}");
    }
}

/// A classifier's name stands only as the second argument of `classify`
/// (engine §9), and not as an argument of `tag` or of `split`.
#[test]
fn a_classifier_name_stands_only_in_classify() {
    let split = |a: &str, b: &str| {
        with_condition(&format!(r#"{{"op":"∈","left":{{"string":"a"}},"right":{{"call":"split","args":[{a},{b}]}}}}"#))
    };
    let classifier = r#"{"classifier":"lex"}"#;
    let refused = [
        with_condition(&format!(r#"{{"op":"⊆","left":{{"call":"tag","args":[{classifier}]}},"right":{{"tag":"a"}}}}"#)),
        split(classifier, r#"{"string":"."}"#),
        split(r#"{"string":"a.b"}"#, classifier),
    ];
    assert_refused(&split(r#"{"string":"a.b"}"#, r#"{"string":"."}"#), &refused, "a malformed term");
}

/// A gate of a classifier's entry follows the notation's name syntax
/// (engine §9). A cached entry with another feature is a miss, so it never
/// changes the dialect's features.
#[test]
fn a_gate_of_an_entry_names_a_feature() {
    let gated = |feature: &str| {
        let entry = format!(
            r#"{{"guards":[{{"feature":"{feature}","kind":"gate","negated":false}}],"keys":["mi"],"op":"∈","class":"KOhA","at":[5,3]}}"#
        );
        with_classifiers("", &format!(r#"{{"name":"lex","entries":[{entry}],"at":[5,1]}}"#), "")
    };
    let refused = ["", "!", "bad name"].map(gated);
    assert_refused(&gated("f"), &refused, "a malformed entry of a classifier");
    // The control's gate is a feature of the dialect, and no refused one is.
    assert_eq!(cached_features(&gated("f")), [("f".to_string(), gencmu::FeatureKind::Gate)]);
    for dom in &refused {
        assert!(cached_features(dom).is_empty(), "{dom}");
    }
}

/// The features of a dialect whose `compiled.json` holds `dom` for the
/// document, each with its kind.
fn cached_features(dom: &str) -> Vec<(String, gencmu::FeatureKind)> {
    let compiled = format!(
        r#"{{"format":{DOM_FORMAT},"bootstrap":"{}","documents":{{"g.md":{{"hash":"{}","dom":{dom}}}}}}}"#,
        gencmu::tools::bootstrap_hash(),
        gencmu::tools::fnv1a64(DOCUMENT)
    );
    let sources = [
        ("p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string()),
        ("g.md", DOCUMENT.to_string()),
        ("compiled.json", compiled),
    ];
    let dialect = gencmu::load_dialect_sources(sources, "p.md").expect("a dialect");
    dialect.features().iter().map(|feature| (feature.name.clone(), feature.kind)).collect()
}

/// A guard of a rule's alternative, a gate or a warning, follows the
/// notation's name syntax (engine §9). A cached entry with another feature
/// is a miss, so it never changes the dialect's features.
#[test]
fn a_guard_of_an_alternative_names_a_feature() {
    for (kind, feature_kind) in [("gate", gencmu::FeatureKind::Gate), ("warning", gencmu::FeatureKind::Warning)] {
        let guarded = |feature: &str| {
            with_alternative(&format!(
                r#"{{"guards":[{{"feature":"{feature}","kind":"{kind}","negated":false}}],"expr":{{"terminal":"b"}}}}"#
            ))
        };
        let refused = ["", "!", "bad name"].map(guarded);
        assert_refused(&guarded("f"), &refused, "a malformed alternative");
        assert_eq!(cached_features(&guarded("f")), [("f".to_string(), feature_kind)]);
        for dom in &refused {
            assert!(cached_features(dom).is_empty(), "{dom}");
        }
    }
}

/// A DOM like the document's, with a rule `x` of `expr` and `condition`
/// added.
fn with_mixed(expr: &str, condition: &str) -> String {
    with_mixed_emission(expr, condition, "")
}

/// The same, with the members of `emission` after the rule's
/// alternatives.
fn with_mixed_emission(expr: &str, condition: &str, emission: &str) -> String {
    with_rule(&format!(
        r#"{{"name":"x","op":"define","flags":[],"alternatives":[{{"guards":[],"expr":{expr}}}]{emission},"conditions":[{condition}],"at":[4,1]}}"#
    ))
}

/// An expression or a condition has exactly the members of one form, and a
/// reference is a name or `#` (docs/output.md, engine §9). A node that
/// breaks this is a cache miss and an error of a bootstrap, whatever the
/// order of its members.
#[test]
fn a_node_of_two_forms_is_refused() {
    let b = r#"{"terminal":"b"}"#;
    let c = r#"{"terminal":"c"}"#;
    let captured = r#"{"capture":"w","expr":{"terminal":"b"}}"#;
    let seq = |first: &str, second: &str| format!(r#"{{"seq":[{first},{second}]}}"#);
    let compared = r#""op":"=","left":{"call":"text","args":[{"capture":"w"}]},"right":{"string":"b"}"#;
    let condition = format!("{{{compared}}}");
    let second = |node: &str| with_mixed(&seq(captured, node), &condition);
    let wrapped = |node: &str| with_mixed(&seq(&format!(r#"{{"capture":"w","expr":{node}}}"#), c), &condition);
    let refused = [
        second(r#"{"empty":true,"terminal":"b"}"#),
        second(r#"{"terminal":"b","empty":true}"#),
        second(&format!(r#"{{"choice":[{b},{c}],"seq":[{c},{c}]}}"#)),
        second(&format!(r#"{{"seq":[{c},{c}],"choice":[{b},{c}]}}"#)),
        second(&format!(r#"{{"choice":[{b},{c}],"seq":[{{"ref":5}},{c}]}}"#)),
        second(&format!(r#"{{"repeat":{b},"optional":{c}}}"#)),
        second(&format!(r#"{{"optional":{c},"repeat":{b}}}"#)),
        second(&format!(r#"{{"repeat":{b},"optional":{{"ref":["x"]}}}}"#)),
        second(&format!(r#"{{"repeat":{b},"min":1}}"#)),
        second(&format!(r#"{{"repeat":{b},"separator":{c},"min":0}}"#)),
        second(&format!(r#"{{"repeat":{b},"separator":{{"ref":"x y"}}}}"#)),
        second(&format!(r#"{{"repeat":{b},"chain":"left"}}"#)),
        second(&format!(r#"{{"optional":{{"repeat":{b},"separator":{c},"chain":"right"}}}}"#)),
        second(&format!(r#"{{"repeat":{b},"separator":{{"repeat":{c},"chain":"left"}}}}"#)),
        second(r#"{"ref":"x y"}"#),
        with_mixed(&format!(r#"{{"seq":[{captured},{c}],"choice":[{b},{c}]}}"#), &condition),
        wrapped(r#"{"terminal":"'ab'"}"#),
        wrapped(r#"{"ref":"A","terminal":"b"}"#),
        wrapped(r#"{"terminal":"b","ref":"A"}"#),
        wrapped(r#"{"ref":"x y"}"#),
        with_mixed(&seq(r#"{"capture":"w","expr":{"terminal":"b"},"ref":"B"}"#, c), &condition),
        with_mixed(&seq(captured, c), &format!(r#"{{{compared},"not":{{"captured":"w"}}}}"#)),
        with_mixed(&seq(captured, c), &format!(r#"{{"not":{{"captured":"w"}},{compared}}}"#)),
        with_mixed(&seq(captured, c), &format!(r#"{{"captured":"w",{compared}}}"#)),
        with_mixed(&seq(captured, c), &format!(r#"{{{compared},"matches":{{"capture":"w"}}}}"#)),
        with_mixed(&seq(captured, c), r#"{"matches":{"capture":"w"},"rule":"text","initial":{"capture":"w"}}"#),
        with_mixed_emission(&seq(captured, c), &condition, r#","emit":{"items":[{"capture":"w"}],"extra":true}"#),
        with_mixed_emission(&seq(captured, c), &condition, r#","emit":{"extra":true,"items":[{"capture":"w"}]}"#),
    ];
    assert_refused(&with_mixed(&seq(captured, c), &condition), &refused, "a malformed");
}

/// A guard of a rule's alternative has no member but its feature, its kind
/// and whether it is negated, as a gate of an entry has (docs/output.md).
#[test]
fn a_guard_of_an_alternative_has_three_members() {
    let guarded = |guard: &str| with_alternative(&format!(r#"{{"guards":[{guard}],"expr":{{"terminal":"b"}}}}"#));
    let refused = [
        guarded(r#"{"feature":"f","kind":"gate","negated":false,"extra":true}"#),
        guarded(r#"{"note":"x","feature":"f","kind":"gate","negated":false}"#),
    ];
    assert_refused(&guarded(r#"{"feature":"f","kind":"gate","negated":false}"#), &refused, "a malformed alternative");
}

/// The DOM of the check of a precompiled DOM, with one rule `text` whose
/// one alternative's expression is `expr`.
fn expression_problem(expr: &str) -> Option<String> {
    let dom = format!(
        r#"{{"format":{DOM_FORMAT},"rules":[{{"name":"text","op":"define","flags":[],"alternatives":[{{"guards":[],"expr":{expr}}}],"conditions":[],"at":[1,1]}}],"directives":[],"constants":[],"classifiers":[],"implications":[]}}"#
    );
    gencmu::tools::check_dom(&dom).expect("the bundled tables")
}

/// A repeat has an item, an optional separator and, as an alternative's
/// whole expression, a chain of left or right (docs/output.md, engine §9).
#[test]
fn a_repeat_has_a_separator_and_a_chain_only_where_allowed() {
    for expr in [
        r#"{"repeat":{"ref":"A"}}"#,
        r#"{"repeat":{"ref":"A"},"separator":{"ref":"B"}}"#,
        r#"{"optional":{"repeat":{"ref":"A"}}}"#,
        r#"{"repeat":{"ref":"A"},"chain":"left"}"#,
        r#"{"repeat":{"ref":"A"},"separator":{"ref":"B"},"chain":"right"}"#,
        r#"{"seq":[{"capture":"a","expr":{"ref":"A"}},{"repeat":{"ref":"B"}}]}"#,
    ] {
        assert_eq!(expression_problem(expr), None, "{expr}");
    }
    for expr in [
        r#"{"repeat":{"ref":"A"},"min":1}"#,
        r#"{"repeat":{"ref":"A"},"chain":"both"}"#,
        r#"{"repeat":{"ref":"A"},"chain":true}"#,
        r#"{"seq":[{"ref":"A"},{"repeat":{"ref":"B"},"chain":"left"}]}"#,
        r#"{"choice":[{"repeat":{"ref":"B"},"chain":"left"},{"ref":"A"}]}"#,
        r#"{"optional":{"repeat":{"ref":"A"},"chain":"right"}}"#,
        r#"{"repeat":{"repeat":{"ref":"A"},"chain":"left"}}"#,
    ] {
        assert_eq!(expression_problem(expr).as_deref(), Some("a malformed expression"), "{expr}");
    }
    assert_eq!(
        expression_problem(r#"{"repeat":{"ref":"A"},"separator":{"capture":"s","expr":{"ref":"S"}}}"#).as_deref(),
        Some("a capture inside braces or an elidable optional")
    );
    // The separator counts on from the depth of its repeat.
    let deep = |depth: usize| format!("{}{{\"ref\":\"S\"}}{}", "{\"optional\":".repeat(depth), "}".repeat(depth));
    assert_eq!(
        expression_problem(&format!(r#"{{"repeat":{{"ref":"A"}},"separator":{}}}"#, deep(256))).as_deref(),
        Some("nested too deeply")
    );
    assert_eq!(expression_problem(&format!(r#"{{"repeat":{{"ref":"A"}},"separator":{}}}"#, deep(255))), None);
}

/// An elidable optional is marked true, maximal only with it, and begins
/// with its terminal; a capture stands anywhere but in it and in braces,
/// and a name once in each production (docs/output.md, engine §3.5, §9).
#[test]
fn an_elidable_optional_and_captures_are_checked_where_they_stand() {
    let marked = |expr: &str, extra: &str| format!(r#"{{"optional":{expr},"elidable":true{extra}}}"#);
    let ku = r#"{"ref":"KU"}"#;
    let well_formed = [
        marked(ku, ""),
        marked(ku, r#","maximal":true"#),
        marked(r#"{"terminal":"KU"}"#, ""),
        marked(&format!(r##"{{"seq":[{ku},{{"ref":"#"}}]}}"##), ""),
        marked(&format!(r#"{{"test":"=","value":{{"string":"ku"}},"expr":{ku}}}"#), ""),
        marked(&format!(r#"{{"seq":[{ku},{{"choice":[{{"ref":"A"}},{{"ref":"B"}}]}}]}}"#), ""),
        r#"{"optional":{"capture":"x","expr":{"ref":"A"}}}"#.to_string(),
        r#"{"choice":[{"capture":"x","expr":{"ref":"A"}},{"ref":"B"}]}"#.to_string(),
        r#"{"and":[{"capture":"x","expr":{"ref":"A"}},{"ref":"B"}]}"#.to_string(),
        r#"{"seq":[{"ref":"A"},{"optional":{"seq":[{"ref":"B"},{"optional":{"capture":"c","expr":{"ref":"C"}}}]}}]}"#
            .to_string(),
        r#"{"choice":[{"capture":"x","expr":{"ref":"A"}},{"capture":"x","expr":{"ref":"B"}}]}"#.to_string(),
    ];
    for expr in &well_formed {
        assert_eq!(expression_problem(expr), None, "{expr}");
    }
    let malformed = [
        format!(r#"{{"optional":{ku},"elidable":false}}"#),
        format!(r#"{{"optional":{ku},"elidable":"true"}}"#),
        format!(r#"{{"optional":{ku},"elidable":null}}"#),
        format!(r#"{{"optional":{ku},"maximal":true}}"#),
        marked(ku, r#","maximal":false"#),
    ];
    for expr in &malformed {
        assert_eq!(expression_problem(expr).as_deref(), Some("a malformed expression"), "{expr}");
    }
    let heads = [
        format!(r#"{{"choice":[{ku},{{"ref":"VAU"}}]}}"#),
        format!(r#"{{"and":[{ku},{{"ref":"A"}}]}}"#),
        r#"{"ref":"ku"}"#.to_string(),
        r##"{"ref":"#"}"##.to_string(),
        r#"{"terminal":"/a/"}"#.to_string(),
        r#"{"terminal":"'a'"}"#.to_string(),
        r#"{"range":["'a'","'z'"]}"#.to_string(),
        format!(r##"{{"seq":[{{"seq":[{ku},{{"ref":"#"}}]}},{{"ref":"A"}}]}}"##),
        format!(r#"{{"optional":{ku}}}"#),
        r#"{"empty":true}"#.to_string(),
    ];
    for head in &heads {
        assert_eq!(expression_problem(&marked(head, "")).as_deref(), Some("a malformed elidable optional"), "{head}");
    }
    let sealed = Some("a capture inside braces or an elidable optional");
    let capture = r#"{"capture":"x","expr":{"ref":"A"}}"#;
    assert_eq!(expression_problem(&marked(&format!(r#"{{"seq":[{ku},{capture}]}}"#), "")).as_deref(), sealed);
    assert_eq!(
        expression_problem(&marked(&format!(r#"{{"seq":[{ku},{{"optional":{capture}}}]}}"#), "")).as_deref(),
        sealed
    );
    assert_eq!(expression_problem(&format!(r#"{{"repeat":{capture}}}"#)).as_deref(), sealed);
    assert_eq!(
        expression_problem(r#"{"capture":"x","expr":{"optional":{"ref":"A"}}}"#).as_deref(),
        Some("a malformed capture")
    );
    let twice = Some("a capture name used twice in one production");
    for expr in [
        r#"{"seq":[{"capture":"x","expr":{"ref":"A"}},{"capture":"x","expr":{"ref":"B"}}]}"#,
        r#"{"seq":[{"optional":{"capture":"x","expr":{"ref":"A"}}},{"capture":"x","expr":{"ref":"B"}}]}"#,
        r#"{"seq":[{"choice":[{"capture":"x","expr":{"ref":"A"}},{"ref":"B"}]},{"choice":[{"capture":"x","expr":{"ref":"C"}},{"ref":"D"}]}]}"#,
        r#"{"and":[{"capture":"x","expr":{"ref":"A"}},{"capture":"x","expr":{"ref":"B"}}]}"#,
    ] {
        assert_eq!(expression_problem(expr).as_deref(), twice, "{expr}");
    }
}
