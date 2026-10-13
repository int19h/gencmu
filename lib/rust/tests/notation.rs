//! Every shared notation case, `tests/notation/*.json` (tests/README.md).

mod common;

use common::{case_files, matches, parse_json, Value};

fn run(case: &Value) -> Result<(), String> {
    let document = case.get("document").and_then(Value::str).ok_or("a case without a document")?;
    let expect = case.get("expect").ok_or("a case without expect")?;
    match (gencmu::tools::read_grammar_document(document), expect.get("dom"), expect.get("error")) {
        (Ok(json), Some(pattern), _) => {
            let dom = parse_json(&json).map_err(|error| format!("the DOM is not JSON: {error}"))?;
            matches(pattern, &dom, "dom").map_err(|problem| format!("{problem}\ndom: {json}"))
        }
        (Err(error), None, Some(position)) => {
            let line = position.get("line").and_then(Value::number).map(|n| n as usize);
            let column = position.get("column").and_then(Value::number).map(|n| n as usize);
            if (line.is_none() || error.line == line) && (column.is_none() || error.column == column) {
                Ok(())
            } else {
                Err(format!("the error is at {:?}:{:?}, not {line:?}:{column:?}: {error}", error.line, error.column))
            }
        }
        (Ok(json), None, _) => Err(format!("the document was read, but an error was expected: {json}")),
        (Err(error), _, _) => Err(format!("the document was not read: {error}")),
    }
}

include!(concat!(env!("OUT_DIR"), "/notation_cases.rs"));

#[test]
fn notation_cases_are_present() {
    let files = std::fs::read_dir(common::repository().join("tests/notation"))
        .expect("the shared cases")
        .map(|entry| entry.expect("a case entry").path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "json"))
        .count();
    assert!(files > 0, "no notation cases found");
    assert_eq!(files, SHARED_CASE_COUNT, "every fixture has a harness test");
    assert!(!case_files("notation").is_empty(), "no notation cases found");
}

fn run_shared_case(name: &str) {
    if std::env::var("GENCMU_CASE_FILTER").is_ok_and(|filter| !name.contains(&filter)) {
        return;
    }
    let file = common::repository().join("tests/notation").join(name);
    let text = std::fs::read_to_string(&file).expect("a case");
    let case = parse_json(&text).expect("a case is JSON");
    let outcome = run(&case);
    assert!(outcome.is_ok(), "{}:\n{}", file.display(), outcome.unwrap_err());
}

/// The reader reads every form of a test in a body, with spaces inside it
/// or not, and refuses a test after anything but a reference other than
/// `#` or a terminal, a second test, and an operand of the wrong type
/// (engine §9). Exact strings preserve case and punctuation.
#[test]
fn tests_in_a_body_are_read_and_refused() {
    let document = "```jbogenbau\n%const $C Tag-c\n%rule text $l:LE=\"la\" {UI=\"ui\" / A=\"a\"} [KU = \"ku\"] word≠\"\" A<B> word<¬$C> A<¬B ¬Tag-c> _L<B> _L<> B (C)\n```\n";
    let json = gencmu::tools::read_grammar_document(document).expect("a document with tests");
    let dom = parse_json(&json).expect("a DOM");
    let tests: Vec<String> = json
        .match_indices("\"test\":\"")
        .map(|(at, _)| json[at + 8..].split('"').next().unwrap_or("").to_string())
        .collect();
    assert_eq!(tests, ["=", "=", "=", "=", "≠", "tags", "tags", "tags", "tags", "tags"], "{json}");
    assert!(dom.get("rules").is_some());
    // The new value tests accept capitalization and tested capture targets.
    for accepted in ["%rule text A=\"A\"", "%rule text A=\"b,c\"", "%rule text $x:A=\"a\""] {
        assert!(gencmu::tools::read_grammar_document(&format!("```jbogenbau\n{accepted}\n```\n")).is_ok());
    }
    for refused in [
        "%rule text (A)=\"a\"",
        "%rule text A=\"a\"=\"b\"",
        "%rule text #=\"a\"",
        "%rule text A=\"a\"<B>",
        "%rule text A⊇\"a\"",
        "%rule text A=B",
        "%rule text [A]⊇B",
        "%rule text {A}=\"a\"",
        "%rule text ($x:A)=\"a\"",
        "%rule text ε=\"\"",
        "%rule text A⊇($x.tags)",
    ] {
        let error = gencmu::tools::read_grammar_document(&format!("```jbogenbau\n{refused}\n```\n"));
        assert!(error.is_err(), "{refused} was read");
    }
}

/// A tie in a stage of the notation is a grammar error that names the
/// document, with no line or column (engine §8).
#[test]
fn a_tie_in_the_notation_is_a_grammar_error_with_no_position() {
    use gencmu::tools::{fnv1a64, read_grammar_document, DOM_FORMAT};
    // A notation whose one stage reads the character a in two ways. The
    // grammar text of t.md is that one character, since the text of a
    // block ends without the line break of its last line.
    let notation = read_grammar_document(
        "```jbogenbau\n%ambiguity-resolution greedy\n%rule text p | q\n%rule p \"a\"\n%rule q \"a\"\n```\n",
    )
    .expect("the notation's document");
    let bootstrap = format!(
        r#"{{"format":{DOM_FORMAT},"stages":[{{"name":"syntax","documents":[{{"path":"n.md","dom":{notation}}}]}}]}}"#
    );
    // The pipeline comes from the cache, so that only t.md is read with
    // that notation.
    let pipeline = "```jbogenbau\n%stage main\n%include \"t.md\"\n```\n";
    let dom = read_grammar_document(pipeline).expect("the pipeline's document");
    let compiled = format!(
        r#"{{"format":{DOM_FORMAT},"bootstrap":"{}","documents":{{"p.md":{{"hash":"{}","dom":{dom}}}}}}}"#,
        fnv1a64(&bootstrap),
        fnv1a64(pipeline)
    );
    let sources = [
        ("notation/bootstrap.json", bootstrap.clone()),
        ("compiled.json", compiled),
        ("p.md", pipeline.to_string()),
        ("t.md", "```jbogenbau\na\n```\n".to_string()),
    ];
    let error = gencmu::load_dialect_sources(sources, "p.md").expect_err("a tie");
    assert_eq!(error.kind, gencmu::ErrorKind::Grammar, "{error}");
    assert_eq!((error.document.as_deref(), error.line, error.column), (Some("t.md"), None, None), "{error}");
    // The loader names the stage of the dialect that includes t.md, and
    // the message names the stage of the notation.
    assert_eq!(error.stage.as_deref(), Some("main"));
    assert_eq!(error.message, "the grammar text is ambiguous: the syntax stage of the notation reads it in two ways");
}

/// No directive names elidable terminators: `%elidable` is an unknown
/// keyword, a syntax error at the keyword. A marker makes an optional
/// elidable (engine §3.8, §9).
#[test]
fn an_optional_is_marked_elidable_in_place() {
    let read = |text: &str| gencmu::tools::read_grammar_document(&format!("```jbogenbau\n{text}\n```\n"));
    for text in ["%elidable KU", "%elidable maximal KU", "%elidable"] {
        let error = read(text).expect_err(text);
        assert_eq!((error.line, error.column), (Some(2), Some(1)), "{text}: {error}");
    }
    let expr = |text: &str| {
        let json = read(text).expect(text);
        let dom = parse_json(&json).expect("a DOM");
        dom.get("rules").unwrap().array()[0].get("alternatives").unwrap().array()[0].get("expr").unwrap().clone()
    };
    let expect = |json: &str| parse_json(json).unwrap();
    assert_eq!(
        expr("%rule text A [+KU #]"),
        expect(r##"{"seq":[{"ref":"A"},{"optional":{"seq":[{"ref":"KU"},{"ref":"#"}]},"elidable":true}]}"##)
    );
    assert_eq!(expr("%rule text [+TOI]"), expect(r#"{"optional":{"ref":"TOI"},"elidable":true}"#));
    assert_eq!(expr("%rule text [KU]"), expect(r#"{"optional":{"ref":"KU"}}"#));
}

/// Braces read as repeat, with a separator and a chain's direction, and
/// the reader refuses every misplaced form of them (engine §9).
#[test]
fn braces_are_read_and_their_misplaced_forms_refused() {
    let read = |text: &str| gencmu::tools::read_grammar_document(&format!("```jbogenbau\n{text}\n```\n"));
    let json = read(
        "%rule text $a:A {B} [{C / D | E}] {{F} / [G] {H}} {| I | J / | K}\n%rule l {... L / M}\n%rule r {N | O ...}",
    )
    .expect("braces");
    let dom = parse_json(&json).expect("a DOM");
    let expect = |json: &str| parse_json(json).unwrap();
    let rules = dom.get("rules").unwrap().array();
    let expr = |rule: usize| rules[rule].get("alternatives").unwrap().array()[0].get("expr").unwrap().clone();
    assert_eq!(expr(1), expect(r#"{"repeat":{"ref":"L"},"separator":{"ref":"M"},"chain":"left"}"#));
    assert_eq!(expr(2), expect(r#"{"repeat":{"choice":[{"ref":"N"},{"ref":"O"}]},"chain":"right"}"#));
    for refused in [
        "%rule text {}",
        "%rule text {A \\}",
        "%rule text {\\ A}",
        "%rule text {A / B / C}",
        "%rule text {... A ...}",
        "%rule text {A / ... B}",
        "%rule text A ...",
        "%rule text \"a\"...\"z\"",
        "%rule text (A / B)",
        "%rule text A {... B}",
        "%rule text [{... A}]",
        "%rule text {$a:A}",
        "%rule text $a:{A}",
        "%rule text {A}=\"a\"",
        "%rule text ({... A})",
        "%rule text (({A ...}))",
        "%rule text [+KU $c:A]",
        "%rule text [+(KU) #]",
        "%rule text [+KU | VAU]",
        "%rule text [$x:A] $x:B",
    ] {
        assert!(read(refused).is_err(), "{refused} was read");
    }
}

#[test]
fn pattern_test_order_precedes_invalid_bases() {
    for body in [
        r#"%rule text $c:A %conditions $c ≅ @(_Bogus<"bad"><A>)"#,
        r#"%rule text $c:A %conditions $c ≅ @($_D800<"bad"><A>)"#,
        r#"%rule text $c:A %conditions $c ≅ @("$(_D800)"=UI<A>)"#,
    ] {
        let error = gencmu::tools::read_grammar_document(&format!("```jbogenbau\n{body}\n```\n")).unwrap_err();
        assert_eq!((error.line, error.column), (Some(2), Some(49)), "{body}: {error}");
    }
}
