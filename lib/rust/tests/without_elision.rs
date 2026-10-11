//! Aligned queries preserve close groups under the shared span contract.
mod common;

#[test]
fn shared_aligned_queries() {
    let files: Vec<_> = common::case_files("engine")
        .into_iter()
        .filter(|p| p.file_name().unwrap().to_string_lossy().starts_with("without-elision-"))
        .collect();
    assert_eq!(files.len(), 96);
    let mut failures = Vec::new();
    for file in files {
        let text = std::fs::read_to_string(&file).unwrap();
        let case = common::parse_json(&text).unwrap();
        let outcome =
            std::panic::catch_unwind(|| common::run_engine_case(&case)).unwrap_or_else(|_| Err("case panicked".into()));
        if let Err(error) = outcome {
            failures.push(format!("{}: {error}", file.display()));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
}

#[test]
fn growing_queries_keep_all_closes() {
    for n in [128, 256, 512] {
        let grammar = "```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%rule text $x(candidate)\n%conditions matches(without-elision($x), rival)\n%rule candidate {piece}\n%rule rival {piece}\n%rule piece piece [+U] | X [+T]\n```\n";
        let dialect = gencmu::load_dialect_sources([("p.md", grammar)], "p.md").unwrap();
        let token = gencmu::InputToken { text: "x".into(), tags: ["X".into()].into_iter().collect(), phonemes: None };
        let started = std::time::Instant::now();
        let result = dialect.parse_tokens(&vec![token; n], &gencmu::ParseOptions::default()).unwrap();
        assert!(result.ok, "{n}: {:?}", result.error);
        eprintln!("{n} aligned pieces in {:?}", started.elapsed());
    }
}

#[test]
fn nullable_ranked_prefix() {
    let grammar = "```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%rule text $x(r)\n%conditions matches(without-elision($x), same)\n%rule r [+T] (r ≻ X)\n%rule same r\n```\n";
    let dialect = gencmu::load_dialect_sources([("p.md", grammar)], "p.md").unwrap();
    let token = gencmu::InputToken { text: "x".into(), tags: ["X".into()].into_iter().collect(), phonemes: None };
    let result = dialect.parse_tokens(&[token], &gencmu::ParseOptions::default()).unwrap();
    assert!(result.ok, "{:?}", result.error);
}

#[test]
fn a_prefix_can_end_before_a_ranked_group() {
    let grammar = "```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%rule text $x(candidate)\n%conditions begins(without-elision($x), rival)\n%rule candidate X choice\n%rule choice a ≻ b\n%rule a Y [+T]\n%rule b Y [+U]\n%rule rival X\n```\n";
    let dialect = gencmu::load_dialect_sources([("p.md", grammar)], "p.md").unwrap();
    let tokens: Vec<_> = ["X", "Y"]
        .into_iter()
        .map(|tag| gencmu::InputToken {
            text: tag.to_lowercase(),
            tags: [tag.into()].into_iter().collect(),
            phonemes: None,
        })
        .collect();
    let result = dialect.parse_tokens(&tokens, &gencmu::ParseOptions::default()).unwrap();
    assert!(result.ok, "{:?}", result.error);
}

#[test]
fn synthetic_reads_cannot_hide_a_named_cycle() {
    let grammar = "```jbogenbau\n%stage main\n%ambiguity-resolution late-elision elision-only\n%rule text a | b | c\n%rule a X [+T]\n%rule b X [+T] [+U]\n%rule c $x(r)\n%conditions matches(without-elision($x), rival)\n%rule r r T | X\n%rule rival X [+T]\n```\n";
    let dialect = gencmu::load_dialect_sources([("p.md", grammar)], "p.md").unwrap();
    let token = gencmu::InputToken { text: "x".into(), tags: ["X".into()].into_iter().collect(), phonemes: None };
    let (result, checks) = gencmu::tools::with_elision_checks(|| {
        dialect.parse_tokens(&[token], &gencmu::ParseOptions::default()).unwrap()
    });
    assert_eq!(checks.len(), 1);
    assert!(checks[0].keeps_witness);
    assert!(result.ok, "{:?}", result.error);
}

#[test]
fn ranked_seals_cannot_revive_a_cyclic_observation() {
    let grammar = "```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%rule text $x(X)\n%conditions ~recursive ⊆ tags($x, r), tags($x, q) = ∅\n%rule q $y(r)\n%conditions ¬matches(without-elision($y), rival)\n%rule r s <~recursive> | X <∅>\n%rule s (r [+U]) ≻ Y\n%tags ∅\n%rule rival X\n```\n";
    let dialect = gencmu::load_dialect_sources([("p.md", grammar)], "p.md").unwrap();
    let token = gencmu::InputToken { text: "x".into(), tags: ["X".into()].into_iter().collect(), phonemes: None };
    let result = dialect.parse_tokens(&[token], &gencmu::ParseOptions::default()).unwrap();
    assert!(result.ok, "{:?}", result.error);
}

#[test]
fn emission_queries_demand_close_observations() {
    let grammar = "```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%rule text $x(a)\n%emits $x <tags(without-elision($x), rival)>\n%rule a X [+T]\n%rule rival X [+T] <~aligned>\n```\n";
    let dialect = gencmu::load_dialect_sources([("p.md", grammar)], "p.md").unwrap();
    let token = gencmu::InputToken { text: "x".into(), tags: ["X".into()].into_iter().collect(), phonemes: None };
    let result = dialect.parse_tokens(&[token], &gencmu::ParseOptions::default()).unwrap();
    assert!(result.ok, "{:?}", result.error);
    assert!(result.stages[0].output.as_ref().unwrap()[0].tags.contains("aligned"));
}

#[test]
fn lexical_whole_guards_close_the_enclosing_named_occurrence() {
    let clauses = "%conditions ¬(~recursive ⊆ tags($)) ∨ ¬matches(without-elision($), rival)\n";
    for guarded in [true, false] {
        let grammar = format!(
            "```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%rule text $x(X)\n%conditions tags($x, r) = ∅\n%rule r ((r [+U]) ≻ Y) <~recursive> | X <∅>\n{}%rule rival X\n```\n",
            if guarded { clauses } else { "" }
        );
        let dialect = gencmu::load_dialect_sources([("p.md", grammar)], "p.md").unwrap();
        let token = gencmu::InputToken { text: "x".into(), tags: ["X".into()].into_iter().collect(), phonemes: None };
        let result = dialect.parse_tokens(&[token], &gencmu::ParseOptions::default()).unwrap();
        assert_eq!(result.ok, guarded, "guarded {guarded}: {:?}", result.error);
    }
}

#[test]
fn ranked_entry_keeps_the_common_control_route() {
    let grammar = "```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%rule text Q $x(choice)\n%conditions matches(without-elision($x), choice)\n%rule choice (a & b) (c ≻ d)\n%rule a X\n%conditions ¬initial($)\n%rule b X\n%conditions initial($)\n%rule c Y [+T]\n%rule d Y [+U]\n```\n";
    let dialect = gencmu::load_dialect_sources([("p.md", grammar)], "p.md").unwrap();
    let tokens: Vec<_> = ["Q", "X", "Y"]
        .into_iter()
        .map(|tag| gencmu::InputToken {
            text: tag.to_lowercase(),
            tags: [tag.into()].into_iter().collect(),
            phonemes: None,
        })
        .collect();
    let result = dialect.parse_tokens(&tokens, &gencmu::ParseOptions::default()).unwrap();
    assert!(!result.ok);
}

#[test]
fn ranked_entry_ignores_close_sound_in_common_captures() {
    let grammar = "```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%rule text Q $x(choice)\n%conditions matches(without-elision($x), choice)\n%rule choice $p(prefix) (a ≻ b)\n%rule prefix t | u\n%rule t X [+T=\"a\"]\n%conditions ¬initial($)\n%rule u X [+T=\"b\"]\n%conditions initial($)\n%rule a Y [+U]\n%rule b Y [+V]\n```\n";
    let dialect = gencmu::load_dialect_sources([("p.md", grammar)], "p.md").unwrap();
    let tokens: Vec<_> = ["Q", "X", "Y"]
        .into_iter()
        .map(|tag| gencmu::InputToken {
            text: tag.to_lowercase(),
            tags: [tag.into()].into_iter().collect(),
            phonemes: None,
        })
        .collect();
    let result = dialect.parse_tokens(&tokens, &gencmu::ParseOptions::default()).unwrap();
    assert!(result.ok, "{:?}", result.error);
}
