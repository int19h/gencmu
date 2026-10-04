//! The faults of this library's own paths in the check of `elision-only`
//! (tests/README.md): with each one on, the shared engine cases that the
//! table names fail, in the way that the table says, through the result or
//! through the witness hook alone.

mod common;

use common::{case_files, has_caller_attachments, parse_json, run_engine_case, without_hook};
use gencmu::tools::{fault_hits, with_fault, Fault};

/// How a case catches a fault.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Catch {
    /// The result alone fails the case.
    Result,
    /// Only the witness hook fails it: with the hook off, it passes.
    Hook,
}

/// How a case catches a fault, if it does: it runs once with the hook and
/// once without.
fn catch(fault: Fault, file: &std::path::Path) -> Option<Catch> {
    let text = std::fs::read_to_string(file).expect("a case");
    let case = parse_json(&text).expect("a case is JSON");
    let fails = |hook: bool| {
        std::panic::catch_unwind(|| {
            with_fault(fault, || if hook { run_engine_case(&case) } else { without_hook(|| run_engine_case(&case)) })
        })
        .map_or(true, |outcome| outcome.is_err())
    };
    if fails(false) {
        Some(Catch::Result)
    } else if fails(true) {
        Some(Catch::Hook)
    } else {
        None
    }
}

/// Lists, for each fault, every engine case that catches it, and how. Run
/// it with `cargo test --test faults -- --ignored --nocapture` to choose the
/// cases of the table.
#[test]
#[ignore]
fn list_catches() {
    for fault in Fault::ALL {
        let caught: Vec<String> = case_files("engine")
            .iter()
            .filter(|file| {
                let text = std::fs::read_to_string(file).expect("a case");
                !has_caller_attachments(&parse_json(&text).expect("a case is JSON"))
            })
            .filter_map(|file| {
                catch(fault, file).map(|how| format!("{} {how:?}", file.file_name().expect("a name").to_string_lossy()))
            })
            .collect();
        eprintln!("{fault:?}: {caught:?}");
    }
}

/// For each fault, shared engine cases that catch it, and how.
const CATCHES: [(Fault, &[(&str, Catch)]); 8] = [
    (Fault::RankerTests, &[("reparse-tested-rebuilt-derivations.json", Catch::Result)]),
    (Fault::ReferenceSpan, &[("reparse-original-rule-test.json", Catch::Result)]),
    (Fault::Reprocess, &[("reparse-strict-reclose-late.json", Catch::Result)]),
    (
        Fault::Route3,
        &[("reparse-strict-nested-route.json", Catch::Result), ("reparse-synthetic-suffix-empty.json", Catch::Result)],
    ),
    (
        Fault::RankRestoration,
        &[
            ("reparse-witness-hook-only.json", Catch::Result),
            ("elision-only-passes.json", Catch::Result),
            ("reparse-witness-sibling-last.json", Catch::Hook),
        ],
    ),
    (
        Fault::LostContext,
        &[
            ("reparse-witness-sibling-first.json", Catch::Hook),
            ("reparse-witness-sibling-last.json", Catch::Hook),
            ("reparse-strict-later-reading-symbol.json", Catch::Result),
        ],
    ),
    (
        Fault::LostSelect,
        &[
            ("reparse-witness-sibling-first.json", Catch::Result),
            ("reparse-strict-later-reading-symbol.json", Catch::Result),
        ],
    ),
    (Fault::Restore, &[("reparse-incompatible-optional-sound.json", Catch::Result)]),
];

#[test]
fn the_shared_cases_catch_each_fault() {
    let directory = common::repository().join("tests").join("engine");
    let mut missed = Vec::new();
    for (fault, cases) in CATCHES {
        fault_hits();
        for &(case, how) in cases {
            let found = catch(fault, &directory.join(case));
            if found != Some(how) {
                missed.push(format!("{case} catches {fault:?} as {found:?}, not {how:?}"));
            }
        }
        // The named cases enter every site of the fault, and no other.
        let mut entered: Vec<&str> = fault_hits().into_iter().map(|(_, site)| site).collect();
        entered.sort_unstable();
        let mut declared = fault.sites().to_vec();
        declared.sort_unstable();
        if entered != declared {
            missed.push(format!("{fault:?} enters the sites {entered:?}, not {declared:?}"));
        }
    }
    assert!(missed.is_empty(), "{missed:?}");
    // Every fault has a case, and some fault only the hook catches.
    for fault in Fault::ALL {
        assert!(CATCHES.iter().any(|(named, cases)| *named == fault && !cases.is_empty()), "{fault:?}");
    }
    assert!(
        CATCHES.iter().any(|(_, cases)| cases.iter().any(|&(_, how)| how == Catch::Hook)),
        "no fault that only the hook catches"
    );
}
