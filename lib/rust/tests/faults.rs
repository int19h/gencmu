//! The faults of this library's own paths in the check of `elision-only`
//! (tests/README.md): with each one on, the shared engine cases that the
//! table names fail, in the way that the table says, through the result or
//! through the witness hook alone.

mod common;

use common::{case_files, checking, has_caller_attachments, parse_json, run_engine_case, Checks};
use gencmu::tools::{fault_hits, with_fault, Fault};

/// How a case catches a fault: through the result, through the witness
/// hook, or through both, each checked on its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Catch {
    /// The result fails the case, and the hook does not.
    Result,
    /// Only the witness hook fails it.
    Hook,
    /// Both fail it, each on its own.
    Both,
}

/// How a case catches a fault, if it does: it runs once checking only the
/// result and once checking only the hook.
fn catch(fault: Fault, file: &std::path::Path) -> Option<Catch> {
    let text = std::fs::read_to_string(file).expect("a case");
    let case = parse_json(&text).expect("a case is JSON");
    let fails = |checks: Checks| {
        std::panic::catch_unwind(|| with_fault(fault, || checking(checks, || run_engine_case(&case))))
            .map_or(true, |outcome| outcome.is_err())
    };
    match (fails(Checks::Result), fails(Checks::Hook)) {
        (true, true) => Some(Catch::Both),
        (true, false) => Some(Catch::Result),
        (false, true) => Some(Catch::Hook),
        (false, false) => None,
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
const CATCHES: [(Fault, &[(&str, Catch)]); 9] = [
    (Fault::Omission, &[("elidable-table-unequal-empty.json", Catch::Both)]),
    (Fault::RankerTests, &[("reparse-tested-rebuilt-derivations.json", Catch::Result)]),
    (Fault::ReferenceSpan, &[("reparse-original-rule-test.json", Catch::Both)]),
    (Fault::Reprocess, &[("reparse-strict-reclose-late.json", Catch::Result)]),
    (
        Fault::Route3,
        &[("reparse-strict-nested-route.json", Catch::Result), ("reparse-synthetic-suffix-empty.json", Catch::Result)],
    ),
    (
        Fault::RankRestoration,
        &[
            ("reparse-witness-hook-only.json", Catch::Both),
            ("elision-only-passes.json", Catch::Both),
            ("reparse-witness-sibling-last.json", Catch::Both),
        ],
    ),
    (
        Fault::LostContext,
        &[
            ("reparse-witness-sibling-first.json", Catch::Both),
            ("reparse-witness-sibling-last.json", Catch::Both),
            ("reparse-strict-later-reading-symbol.json", Catch::Result),
        ],
    ),
    (
        Fault::LostSelect,
        &[
            ("reparse-witness-sibling-first.json", Catch::Hook),
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
