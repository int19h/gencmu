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
            if error.line == line && error.column == column {
                Ok(())
            } else {
                Err(format!("the error is at {:?}:{:?}, not {line:?}:{column:?}: {error}", error.line, error.column))
            }
        }
        (Ok(json), None, _) => Err(format!("the document was read, but an error was expected: {json}")),
        (Err(error), _, _) => Err(format!("the document was not read: {error}")),
    }
}

#[test]
fn notation_cases() {
    let started = std::time::Instant::now();
    let files = case_files("notation");
    assert!(!files.is_empty(), "no notation cases found");
    let mut failures = Vec::new();
    for file in &files {
        let text = std::fs::read_to_string(file).expect("a case");
        let case = parse_json(&text).expect("a case is JSON");
        if let Err(problem) = run(&case) {
            failures.push(format!("{}:\n{problem}", file.display()));
        }
    }
    eprintln!("{} notation cases in {:?}", files.len(), started.elapsed());
    assert!(
        failures.is_empty(),
        "{} of {} notation cases failed:\n\n{}",
        failures.len(),
        files.len(),
        failures.join("\n\n")
    );
}

/// The reader reads every form of a test in a body, with spaces inside it
/// or not, and refuses a test after anything but a reference other than
/// `#` or a terminal, a second test, a string that is not a canonical
/// sound, and an operand of the wrong type (engine §9).
#[test]
fn tests_in_a_body_are_read_and_refused() {
    let document = "```jbogenbau\n%const $C ~c\n%rule text $l(LE=\"la\") UI=\"ui\" ... [KU = \"ku\"] w≠\"\" A⊇B w⊉$C A∩(B ∪ ~c)=∅ A ∩ 'a'..'z' ≠ ∅ '\\p{L}'⊇∅ B (C)\n```\n";
    let json = gencmu::tools::read_grammar_document(document).expect("a document with tests");
    let dom = parse_json(&json).expect("a DOM");
    let tests: Vec<String> = json
        .match_indices("\"test\":\"")
        .map(|(at, _)| json[at + 8..].split('"').next().unwrap_or("").to_string())
        .collect();
    assert_eq!(tests, ["=", "=", "=", "≠", "⊇", "⊉", "∩=∅", "∩≠∅", "⊇"], "{json}");
    assert!(dom.get("rules").is_some());
    for refused in [
        "%rule text (A)=\"a\"",
        "%rule text A=\"a\"=\"b\"",
        "%rule text #=\"a\"",
        "%rule text A=\"A\"",
        "%rule text A⊇\"a\"",
        "%rule text A=B",
        "%rule text [A]⊇B",
        "%rule text $x(A)=\"a\"",
        "%rule text ε=\"\"",
        "%rule text A⊇(tags($x))",
    ] {
        let error = gencmu::tools::read_grammar_document(&format!("```jbogenbau\n{refused}\n```\n"));
        assert!(error.is_err(), "{refused} was read");
    }
}
