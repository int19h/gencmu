//! Semantic erasures and filtered query notes (design, Diagnostics and debugging).
use gencmu::{ErasureReport, RankingReport};
fn report(grammar: &str) -> RankingReport {
    let pipeline = gencmu::load_pipeline_sources(
        [("p.md", format!("```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n{grammar}\n```\n"))],
        "p.md",
    )
    .unwrap();
    pipeline.ranking_reports().remove(0)
}
fn effect(entries: &[ErasureReport], rule: &str, effect: &str) -> bool {
    entries.iter().any(|entry| entry.rule == rule && entry.effects.iter().any(|name| name == effect))
}
#[test]
fn semantic_erasure_lifts_only_its_own_alternative() {
    // Design, Diagnostics and debugging: counted leaves and diagnostics make erasure semantic.
    let report = report("%rule text gone empty choice warning inserted\n%rule gone A\n%erased\n%rule empty ε\n%erased\n%rule choice (ε | ε)\n%erased\n%rule warning ε\n%warning \"note\"\n%erased\n%rule inserted producer\n%erased\n%rule producer ε\n%emits ε :: X");
    assert_eq!(report.idle_erasures.iter().map(|entry| entry.rule.as_str()).collect::<Vec<_>>(), ["empty"]);
    for (rule, name) in [
        ("gone", "counted-parts"),
        ("gone", "diagnostics"),
        ("choice", "derivation-choice"),
        ("warning", "diagnostics"),
        ("inserted", "emission"),
    ] {
        assert!(effect(&report.erasures, rule, name), "{rule}: {name}");
    }
    let text = gencmu::format_ranking_reports(&[report]);
    assert!(text.contains("semantic erasure: gone"));
    assert!(text.contains("inert erasure: empty"));
}
#[test]
fn erasure_effects_keep_inner_erasures_and_explicit_emissions() {
    // Design, Diagnostics and debugging: another erasure keeps its effects during classification.
    let report = report("%rule text outer multi closed\n%rule outer inner\n%erased\n%rule inner A\n%erased\n%rule multi ε | A\n%erased\n%rule closed producer\n%erased\n%rule producer child\n%emits\n%rule child ε\n%emits ε :: X");
    assert_eq!(report.erasures.iter().filter(|entry| entry.rule == "multi").count(), 2);
    assert!(report.erasures.iter().any(|entry| entry.rule == "outer" && entry.kind == "inert"));
    assert!(report.erasures.iter().any(|entry| entry.rule == "closed" && entry.kind == "semantic"));
    assert!(!report.idle_erasures.iter().any(|entry| entry.rule == "multi"));
}
#[test]
fn query_notes_keep_structural_and_filtered_witnesses_separate() {
    // Engine §4.3: an erased own error can supply either kind of witness.
    let report = report("%rule text $a:A\n%conditions $a.parse(target), $a.parse(target …).error-free\n%rule target hidden\n%rule hidden A\n%error \"fault\"\n%erased");
    let notes: Vec<_> = report.diagnostic_notes.iter().filter(|note| note.kind == "query-error").collect();
    assert_eq!(notes.len(), 2);
    assert!(notes.iter().all(|note| note.target.as_deref() == Some("hidden")));
    assert!(notes.iter().any(|note| note.filtered));
    assert!(notes.iter().any(|note| !note.filtered));
    let text = gencmu::format_ranking_reports(&[report]);
    assert!(text.contains("allow carried errors"));
    assert!(text.contains("carried errors outside erased parts"));
    assert!(!text.contains("cannot supply"));
}

#[test]
fn extensions_keep_their_possible_derivation_choice() {
    // Design, Diagnostics and debugging: an extension adds a possible derivation choice.
    let report = report("%rule text gone\n%rule gone ε\n%erased\n%extend-rule gone A\n%erased");
    assert_eq!(report.erasures.iter().map(|entry| entry.kind.as_str()).collect::<Vec<_>>(), ["semantic", "semantic"]);
    assert!(report.idle_erasures.is_empty());
}

#[test]
fn cached_queries_keep_alternative_targets_and_extension_locations() {
    // Engine §2: each definition retains its own clauses and annotation locations.
    let mut grammar = "%rule text :: $.parse(common).tags | A :: $.parse(first).tags | A :: $.parse(second).tags\n%conditions $.parse(target), $.parse(target).error-free\n%extend-rule text A :: $.parse(first).tags\n%conditions $.parse(other).error-free\n".to_string();
    for name in ["common", "first", "second", "target", "other"] {
        grammar.push_str(&format!("%rule {name} A\n%error \"fault\"\n%erased\n"));
    }
    let report = report(&grammar);
    let mut got: Vec<_> = report
        .diagnostic_notes
        .iter()
        .filter(|note| note.kind == "query-error")
        .map(|note| (note.line, note.target.as_deref().unwrap(), note.filtered))
        .collect();
    let mut expected = vec![
        (4, "common", false),
        (4, "first", false),
        (4, "second", false),
        (4, "target", false),
        (4, "target", true),
        (6, "first", false),
        (6, "other", true),
    ];
    got.sort();
    expected.sort();
    assert_eq!(got, expected);
}

#[test]
fn query_notes_follow_clause_discovery_instead_of_rule_order() {
    // Design, Diagnostics and debugging: query notes retain the clause walk's order.
    let report = report("%rule text (r3 ≻ r2) :: ∅ | W\n%rule r2 X\n%error \"r2\"\n%rule r3 $x:W [*r4]\n%conditions $x.parse(text …)\n%rule r4 W X W\n%error \"r4\"");
    let targets: Vec<_> = report
        .diagnostic_notes
        .iter()
        .filter(|note| note.kind == "query-error" && note.rule == "r3")
        .map(|note| note.target.as_deref().unwrap())
        .collect();
    assert_eq!(targets, ["r4", "r2"]);
}
