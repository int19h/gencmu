//! A DOM from `compiled.json` is used only when it is one the reader could
//! have produced (engine §9, docs/output.md "A grammar DOM"): one malformed
//! DOM per rule, each of which must be a cache miss, so that the document
//! is read instead and no cache entry can change a result.

const DOCUMENT: &str = "```jbogenbau\n%ambiguity-resolution greedy\n%rule text 'a'\n```\n";

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
    dom(B, "", rule, 9, r#""greedy""#)
}

fn with_alternative(alternative: &str) -> String {
    dom(alternative, "", "", 9, r#""greedy""#)
}

/// A DOM like the document's, but accepting "b", with `directive` added
/// after its `%ambiguity-resolution`.
fn with_directive(directive: &str) -> String {
    let rule = r#"{"name":"text","op":"define","alternatives":[{"guards":[],"expr":{"terminal":"b"}}],"conditions":[],"at":[3,1]}"#;
    format!(
        r#"{{"format":9,"rules":[{rule}],"directives":[{{"name":"ambiguity-resolution","args":["greedy"],"at":[2,1]}},{directive}]}}"#
    )
}

fn with_emission(emission: &str) -> String {
    let alternative = r#"{"guards":[],"expr":{"seq":[{"capture":"x","expr":{"terminal":"b"}},{"capture":"y","expr":{"terminal":"c"}}]}}"#;
    dom(alternative, &format!(r#","emit":{emission}"#), "", 9, r#""greedy""#)
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
    document_was_read_from(9, dom)
}

/// The same, with a `compiled.json` of the given format.
fn document_was_read_from(format: u32, dom: &str) -> bool {
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
    // `%emits ε` is no items (§9).
    assert!(!document_was_read(&with_emission(r#"{"items":[]}"#)));
    // `verbatim` marks a rule with `%verbatim` (docs/output.md).
    assert!(!document_was_read(&with_emission(r#"{"items":[{"capture":"x"}]},"verbatim":true"#)));
    // A guard is a gate, negated or not, or a warning (§9).
    let gate_and_warning = with_alternative(
        r#"{"guards":[{"feature":"f","kind":"gate","negated":true},{"feature":"w","kind":"warning","negated":false}],"expr":{"terminal":"b"}}"#,
    );
    assert!(!document_was_read(&gate_and_warning));
    // `#` is a rule's name, and `$` may be read by a condition, and by a
    // tag term through another rule.
    let hash = with_rule(
        r##"{"name":"#","op":"define","alternatives":[{"guards":[],"expr":{"empty":true}}],"conditions":[],"at":[4,1]}"##,
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
    let some = r#"{"name":"x","op":"define","alternatives":[{"guards":[],"expr":{"capture":"w","expr":{"terminal":"b"}}},{"guards":[],"expr":{"terminal":"c"}}],"emit":{"items":[{"capture":"w"},{"capture":""}]},"conditions":[{"op":"=","left":{"call":"text","args":[{"capture":"w"}]},"right":{"string":"b"}}],"at":[4,1]}"#;
    assert!(document_was_read(&with_rule(some)), "$ with a capture is malformed");
    let some = r#"{"name":"x","op":"define","alternatives":[{"guards":[],"expr":{"seq":[{"capture":"w","expr":{"terminal":"b"}},{"terminal":"c"}]}},{"guards":[],"expr":{"terminal":"c"}}],"emit":{"items":[{"capture":"w"},{"insert":"T"}]},"conditions":[{"op":"=","left":{"call":"text","args":[{"capture":"w"}]},"right":{"string":"b"}}],"at":[4,1]}"#;
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
    let member = r#"{"op":"∉","left":{"string":"b"},"right":{"call":"runs","args":[{"capture":"w"}]}}"#;
    assert!(!document_was_read(&with_condition(member)));
    let empty = r#"{"op":"=","left":{"emptySet":true},"right":{"call":"runs","args":[{"capture":"w"}]}}"#;
    assert!(!document_was_read(&with_condition(empty)));
    assert!(!document_was_read(&with_directive(r#"{"name":"elidable","args":["KU","ku"],"at":[2,30]}"#)));
    // A spelled reference or terminal, captured or not, and a
    // spelled symbol below 255 compound nodes, itself a compound node (§9).
    let spelled = |expr: &str| with_alternative(&format!(r#"{{"guards":[],"expr":{expr}}}"#));
    assert!(!document_was_read(&spelled(r#"{"spelling":"b","expr":{"terminal":"b"}}"#)));
    assert!(!document_was_read(&spelled(r#"{"capture":"x","expr":{"spelling":"b'i.","expr":{"terminal":"b"}}}"#)));
    let optionals = format!(
        "{}{{\"spelling\":\"b\",\"expr\":{{\"terminal\":\"b\"}}}}{}",
        "{\"optional\":".repeat(255),
        "}".repeat(255)
    );
    assert!(!document_was_read(&spelled(&optionals)));
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
    assert!(!document_was_read_from(9, &with_rule("")));
    assert!(document_was_read_from(8, &with_rule("")), "a format-8 cache is never used");
    assert!(document_was_read_from(7, &with_rule("")), "a format-7 cache is never used");
    assert!(document_was_read_from(6, &with_rule("")), "a format-6 cache is never used");
    assert!(document_was_read_from(5, &with_rule("")), "a format-5 cache is never used");
    assert!(document_was_read_from(4, &with_rule("")), "a format-4 cache is never used");
    assert!(document_was_read_from(3, &with_rule("")), "a format-3 cache is never used");
    assert!(document_was_read_from(2, &with_rule("")), "a format-2 cache is never used");
    assert!(document_was_read_from(1, &with_rule("")), "a format-1 cache is never used");
}

#[test]
fn every_malformed_dom_is_a_cache_miss() {
    let nested = format!("{}{{\"terminal\":\"b\"}}{}", "{\"optional\":".repeat(257), "}".repeat(257));
    let spelled = |expr: &str| with_alternative(&format!(r#"{{"guards":[],"expr":{expr}}}"#));
    let spelled_nested = format!(
        "{}{{\"spelling\":\"b\",\"expr\":{{\"terminal\":\"b\"}}}}{}",
        "{\"optional\":".repeat(256),
        "}".repeat(256)
    );
    let cases: Vec<(&str, String)> = vec![
        ("format 5", dom(B, "", "", 5, r#""greedy""#)),
        ("an empty spelling", spelled(r#"{"spelling":"","expr":{"terminal":"b"}}"#)),
        ("a spelling that is not a string", spelled(r#"{"spelling":7,"expr":{"terminal":"b"}}"#)),
        ("a spelling in upper case", spelled(r#"{"spelling":"B","expr":{"terminal":"b"}}"#)),
        (
            "a captured spelling in upper case",
            spelled(r#"{"capture":"x","expr":{"spelling":"Б","expr":{"terminal":"b"}}}"#),
        ),
        ("a spelling of #", spelled(r##"{"spelling":"b","expr":{"ref":"#"}}"##)),
        ("a spelling of an optional", spelled(r#"{"spelling":"b","expr":{"optional":{"terminal":"b"}}}"#)),
        (
            "a spelling of a spelled symbol",
            spelled(r#"{"spelling":"b","expr":{"spelling":"b","expr":{"terminal":"b"}}}"#),
        ),
        ("a spelling of a capture", spelled(r#"{"spelling":"b","expr":{"capture":"x","expr":{"terminal":"b"}}}"#)),
        ("a spelling with no expression", spelled(r#"{"spelling":"b"}"#)),
        ("a spelling with a backtick", spelled(r#"{"spelling":"b`c","expr":{"terminal":"b"}}"#)),
        ("a spelling of an empty terminal", spelled(r#"{"spelling":"b","expr":{"empty":true,"terminal":"b"}}"#)),
        ("a spelling of a reference and a terminal", spelled(r#"{"spelling":"b","expr":{"ref":"B","terminal":"b"}}"#)),
        ("a spelled symbol that is also empty", spelled(r#"{"spelling":"b","expr":{"terminal":"b"},"empty":true}"#)),
        (
            "a spelled symbol that is also a capture",
            spelled(r#"{"capture":"x","spelling":"B","expr":{"terminal":"b"}}"#),
        ),
        (
            "a top-level sequence that is also a spelled symbol",
            spelled(r#"{"seq":[{"terminal":"b"},{"terminal":"b"}],"spelling":"b","expr":{"terminal":"b"}}"#),
        ),
        (
            "a spelled symbol that is also an optional",
            spelled(r##"{"optional":{"terminal":"b"},"spelling":"b","expr":{"ref":"#"}}"##),
        ),
        ("a spelled symbol nested too deeply", spelled(&spelled_nested)),
        ("a directive argument that is not a string", dom(B, "", "", 9, "7")),
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
        ("a hash expression", with_alternative(r#"{"guards":[],"expr":{"hash":true}}"#)),
        ("$ wrapping a symbol", with_alternative(r#"{"guards":[],"expr":{"capture":"","expr":{"terminal":"b"}}}"#)),
        (
            "a rule name of two hashes",
            with_rule(
                r###"{"name":"##","op":"define","alternatives":[{"guards":[],"expr":{"terminal":"b"}}],"conditions":[],"at":[4,1]}"###,
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
            "lowercase of a tag set",
            with_condition(r#"{"op":"=","left":{"call":"lowercase","args":[{"tag":"x"}]},"right":{"string":"x"}}"#),
        ),
        ("lowercase of a span", with_tags(r#"{"call":"lowercase","args":[{"capture":"x"}]}"#)),
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
        ("%elidable with a character tag", with_directive(r#"{"name":"elidable","args":["'k'"],"at":[4,1]}"#)),
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
                r#"{"op":"=","left":{"emptySet":true},"right":{"union":[{"call":"runs","args":[{"capture":"w"}]},{"tag":"T"}]}}"#,
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
                r#"{"name":"x","op":"define","alternatives":[{"guards":[],"expr":{"capture":"w","expr":{"terminal":"b"}}},{"guards":[],"expr":{"capture":"v","expr":{"terminal":"c"}}}],"conditions":[{"all":[{"op":"=","left":{"call":"text","args":[{"capture":"w"}]},"right":{"string":"b"}},{"op":"=","left":{"call":"text","args":[{"capture":"v"}]},"right":{"string":"c"}}]}],"at":[4,1]}"#,
            ),
        ),
        (
            "an unguarded tag term",
            with_rule(
                r#"{"name":"x","op":"define","tags":{"call":"tags","args":[{"capture":"w"}]},"alternatives":[{"guards":[],"expr":{"capture":"w","expr":{"terminal":"b"}}},{"guards":[],"expr":{"terminal":"c"}}],"conditions":[],"at":[4,1]}"#,
            ),
        ),
        (
            "an inserted tag whose anchor an alternative lacks",
            with_rule(
                r#"{"name":"x","op":"define","alternatives":[{"guards":[],"expr":{"seq":[{"capture":"w","expr":{"terminal":"b"}},{"capture":"v","expr":{"terminal":"c"}}]}},{"guards":[],"expr":{"capture":"w","expr":{"terminal":"b"}}}],"emit":{"items":[{"capture":"w"},{"insert":"T"},{"capture":"v"}]},"conditions":[],"at":[4,1]}"#,
            ),
        ),
        (
            "an alternative left nothing to emit",
            with_rule(
                r#"{"name":"x","op":"define","alternatives":[{"guards":[],"expr":{"capture":"w","expr":{"terminal":"b"}}},{"guards":[],"expr":{"terminal":"c"}}],"emit":{"items":[{"capture":"w"}]},"conditions":[],"at":[4,1]}"#,
            ),
        ),
        ("captures listed out of order", with_emission(r#"{"items":[{"capture":"y"},{"capture":"x"}]}"#)),
        ("verbatim false", with_emission(r#"{"items":[{"capture":"x"}]},"verbatim":false"#)),
        ("verbatim that is not a boolean", with_emission(r#"{"items":[{"capture":"x"}]},"verbatim":1"#)),
        ("verbatim with %emits ε", with_emission(r#"{"items":[]},"verbatim":true"#)),
        (
            "an emission naming a capture no alternative has",
            with_emission(r#"{"items":[{"capture":"x"},{"capture":"z","tags":{"tag":"T"}}]}"#),
        ),
        (
            "an item's tags using a capture no alternative has",
            with_emission(r#"{"items":[{"capture":"x","tags":{"call":"tags","args":[{"capture":"z"}]}}]}"#),
        ),
        ("a term that is not an object", with_tags(r#""T""#)),
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
        ("a directive at a rule's position", with_directive(r#"{"name":"elidable","args":["X"],"at":[3,1]}"#)),
        ("two directives at one position", with_directive(r#"{"name":"elidable","args":["X"],"at":[2,1]}"#)),
        (
            "two rules at one position",
            with_rule(
                r#"{"name":"x","op":"define","alternatives":[{"guards":[],"expr":{"terminal":"b"}}],"conditions":[],"at":[3,1]}"#,
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
        r#"{{"format":9,"stages":[{{"name":"lexical","documents":[{{"path":"notation/lexical.md","dom":{}}}]}}]}}"#,
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

/// A spelling in the bootstrap that the reader would refuse is an error of
/// the grammar, not a failure inside lowering.
#[test]
fn a_refused_bootstrap_spelling_is_an_error() {
    let refusal = |expr: &str| {
        let alternative = format!(r#"{{"guards":[],"expr":{expr}}}"#);
        let bootstrap = format!(
            r#"{{"format":9,"stages":[{{"name":"lexical","documents":[{{"path":"notation/lexical.md","dom":{}}}]}}]}}"#,
            with_alternative(&alternative)
        );
        let sources = [
            ("p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string()),
            ("g.md", DOCUMENT.to_string()),
            ("notation/bootstrap.json", bootstrap),
        ];
        let error = gencmu::load_dialect_sources(sources, "p.md").expect_err("a notation that cannot read g.md");
        assert_eq!(error.kind, gencmu::ErrorKind::Grammar);
        error.message.strip_prefix("bootstrap.json: ").map(str::to_string)
    };
    // A bootstrap that is read, whose notation then fails on g.md.
    assert_eq!(refusal(r#"{"spelling":"b","expr":{"terminal":"b"}}"#), None);
    assert_eq!(
        refusal(r#"{"spelling":"b`c","expr":{"terminal":"b"}}"#).as_deref(),
        Some("a spelling holds a backtick")
    );
    assert_eq!(
        refusal(r#"{"spelling":"b","expr":{"empty":true,"terminal":"b"}}"#).as_deref(),
        Some("a spelling follows only a reference other than # or a terminal")
    );
    assert_eq!(
        refusal(r#"{"spelling":"b","expr":{"terminal":"b"},"empty":true}"#).as_deref(),
        Some("a malformed expression")
    );
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
