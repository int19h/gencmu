//! The faults of this library's own paths in the check of `elision-only`
//! (tests/README.md): with each one on, the shared engine cases that the
//! table names fail.

mod common;

use common::{case_files, has_caller_attachments, parse_json, run_engine_case};
use gencmu::tools::{with_fault, Fault};

const FAULTS: [Fault; 5] =
    [Fault::RankerTests, Fault::ReferenceSpan, Fault::Reprocess, Fault::Route3, Fault::RankRestoration];

/// Runs one engine case with a fault on, on this thread, and says whether
/// it fails.
fn fails(fault: Fault, file: &std::path::Path) -> bool {
    let text = std::fs::read_to_string(file).expect("a case");
    let case = parse_json(&text).expect("a case is JSON");
    std::panic::catch_unwind(|| with_fault(fault, || run_engine_case(&case))).map_or(true, |outcome| outcome.is_err())
}

/// Lists, for each fault, every engine case that catches it. Run it with
/// `cargo test --test faults -- --ignored --nocapture` to choose the cases of
/// the table.
#[test]
#[ignore]
fn list_catches() {
    for fault in FAULTS {
        let caught: Vec<String> = case_files("engine")
            .iter()
            .filter(|file| {
                let text = std::fs::read_to_string(file).expect("a case");
                !has_caller_attachments(&parse_json(&text).expect("a case is JSON"))
            })
            .filter(|file| fails(fault, file))
            .map(|file| file.file_name().expect("a name").to_string_lossy().into_owned())
            .collect();
        eprintln!("{fault:?}: {caught:?}");
    }
}

/// For each fault, shared engine cases that catch it.
const CATCHES: [(Fault, &[&str]); 5] = [
    (Fault::RankerTests, &["reparse-tested-rebuilt-derivations.json"]),
    (Fault::ReferenceSpan, &["reparse-original-rule-test.json"]),
    (Fault::Reprocess, &["reparse-strict-reclose-late.json"]),
    (Fault::Route3, &["reparse-strict-nested-route.json", "reparse-synthetic-suffix-empty.json"]),
    (Fault::RankRestoration, &["reparse-witness-hook-only.json", "elision-only-passes.json"]),
];

#[test]
fn the_shared_cases_catch_each_fault() {
    let directory = common::repository().join("tests").join("engine");
    let mut missed = Vec::new();
    for (fault, cases) in CATCHES {
        for case in cases {
            if !fails(fault, &directory.join(case)) {
                missed.push(format!("{case} does not catch {fault:?}"));
            }
        }
    }
    assert!(missed.is_empty(), "{missed:?}");
    // Every fault has a case.
    for fault in FAULTS {
        assert!(CATCHES.iter().any(|(named, cases)| *named == fault && !cases.is_empty()), "{fault:?}");
    }
}
