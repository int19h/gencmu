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
