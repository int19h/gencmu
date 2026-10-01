//! The library's API (docs/api.md): the three loaders, the options, the
//! errors, and inputs long enough that anything recursive would overflow.

use std::collections::BTreeMap;

use gencmu::{ErrorKind, Feature, FeatureKind, NodeKind, ParseErrorKind, ParseOptions, Verdict, Warning};

fn grammar(rules: &str) -> String {
    format!("# A grammar\n\n```jbogenbau\n{rules}\n```\n")
}

fn single(rules: &str) -> BTreeMap<String, String> {
    let mut sources = BTreeMap::new();
    sources.insert("p.md".to_string(), "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string());
    sources.insert("g.md".to_string(), grammar(rules));
    sources
}

/// A `compiled.json` of the current format whose entry for `g.md`, under
/// the hash of the document of `rules`, holds `dom`.
fn compiled(rules: &str, dom: &str) -> String {
    format!(
        "{{\"format\":{},\"bootstrap\":\"{}\",\"documents\":{{\"g.md\":{{\"hash\":\"{}\",\"dom\":{dom}}}}}}}",
        gencmu::tools::DOM_FORMAT,
        gencmu::tools::bootstrap_hash(),
        gencmu::tools::fnv1a64(&grammar(rules))
    )
}

/// The DOM that the reader gives for the document of `rules`, with the
/// node `from` in it replaced by `to`.
fn changed_dom(rules: &str, from: &str, to: &str) -> String {
    let dom = gencmu::tools::read_grammar_document(&grammar(rules)).expect("a DOM");
    assert!(dom.contains(from), "{from} is not in {dom}");
    dom.replacen(from, to, 1)
}

fn no_auto() -> ParseOptions {
    ParseOptions { auto_features: false, ..ParseOptions::default() }
}

#[test]
fn a_bundled_dialect_loads_by_name() {
    let dialect = gencmu::load_dialect("notation").expect("the notation dialect");
    assert_eq!(dialect.stage_names(), ["lexical", "syntax"]);
    let result = dialect.parse("%rule text A", &ParseOptions::default()).expect("a parse");
    assert!(result.ok);
    assert_eq!(result.stages.len(), 2);
    assert_eq!(result.tree.as_ref().and_then(|tree| tree.rule.as_deref()), Some("text"));
    let error = gencmu::load_dialect("nonesuch").expect_err("no such dialect");
    assert_eq!(error.kind, ErrorKind::Usage);
}

#[test]
fn a_dialect_loads_from_disk() {
    let bundled = gencmu::load_dialect("notation").expect("bundled");
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("grammars/dialects/notation.md");
    let from_disk = gencmu::load_dialect_file(path).expect("from disk");
    let text = "%rule a $x(B) <T> %conditions text($x) ≠ \"q\" %emits $";
    assert_eq!(
        gencmu::to_json(&bundled.parse(text, &ParseOptions::default()).unwrap()),
        gencmu::to_json(&from_disk.parse(text, &ParseOptions::default()).unwrap())
    );

    let directory = std::env::temp_dir().join(format!("gencmu-api-{}", std::process::id()));
    std::fs::create_dir_all(directory.join("dialects")).unwrap();
    std::fs::create_dir_all(directory.join("grammars")).unwrap();
    std::fs::write(
        directory.join("dialects/mine.md"),
        "```jbogenbau\n%stage only\n%include \"../grammars/g.md\"\n```\n",
    )
    .unwrap();
    std::fs::write(directory.join("grammars/g.md"), grammar("%ambiguity-resolution greedy\n%rule text 'a' ..."))
        .unwrap();
    let mine = gencmu::load_dialect_file(directory.join("dialects/mine.md")).expect("a dialect on disk");
    let result = mine.parse("aaa", &ParseOptions::default()).unwrap();
    assert!(result.ok);
    assert_eq!(gencmu::to_brackets(&result, false), "(a a a)");

    std::fs::write(
        directory.join("dialects/broken.md"),
        "```jbogenbau\n%stage only\n%include \"../grammars/gone.md\"\n```\n",
    )
    .unwrap();
    let error = gencmu::load_dialect_file(directory.join("dialects/broken.md")).expect_err("a missing document");
    assert_eq!(error.kind, ErrorKind::Grammar);
    assert!(error.message.contains("gone.md"), "{error}");
    std::fs::remove_dir_all(&directory).ok();
}

#[test]
fn load_errors_carry_the_document_and_position() {
    let error =
        gencmu::load_dialect_sources(single("%ambiguity-resolution greedy\n%rule text A\n  %rules b B"), "p.md")
            .expect_err("a syntax error");
    assert_eq!(error.kind, ErrorKind::Grammar);
    assert_eq!(error.document.as_deref(), Some("g.md"));
    assert_eq!((error.line, error.column), (Some(6), Some(3)));
    assert!(error.to_string().starts_with("g.md:6:3: "), "{error}");

    let error = gencmu::load_dialect_sources(single("%ambiguity-resolution greedy\n%rule text a"), "p.md")
        .expect_err("an undefined rule");
    assert_eq!(error.document.as_deref(), Some("g.md"));
    assert_eq!(error.line, Some(5));

    let mut sources = single("%ambiguity-resolution greedy\n%rule text A");
    sources.remove("g.md");
    let error = gencmu::load_dialect_sources(sources, "p.md").expect_err("a missing document");
    assert!(error.message.contains("g.md"), "{error}");

    let error = gencmu::load_dialect_sources(single("%rule text A"), "p.md").expect_err("no directive");
    assert_eq!(error.stage.as_deref(), Some("main"));

    let error = gencmu::load_dialect_sources(single("%ambiguity-resolution greedy\n%rule text A"), "nowhere.md")
        .expect_err("no pipeline");
    assert_eq!(error.kind, ErrorKind::Grammar);
    let _: &dyn std::error::Error = &error;
}

#[test]
fn sources_may_bring_their_own_tables() {
    let mut sources = single("%ambiguity-resolution greedy\n%rule text '\\p{L}'");
    // A character table that knows no letters, only the white space that
    // the notation reads between tokens.
    let table = "unicode 0.0.0\nwhite-space 0009 000D\nwhite-space 0020 0020\n";
    sources.insert("unicode.txt".to_string(), table.to_string());
    let dialect = gencmu::load_dialect_sources(sources, "p.md").unwrap();
    assert!(!dialect.parse("a", &no_auto()).unwrap().ok);
    let dialect =
        gencmu::load_dialect_sources(single("%ambiguity-resolution greedy\n%rule text '\\p{L}'"), "p.md").unwrap();
    assert!(dialect.parse("a", &no_auto()).unwrap().ok);
    // A scalar value that the caller's table omits is Cn (engine §1).
    let mut sources = single("%ambiguity-resolution greedy\n%rule text '\\p{Cn}'");
    sources.insert("unicode.txt".to_string(), table.to_string());
    let dialect = gencmu::load_dialect_sources(sources, "p.md").unwrap();
    assert!(dialect.parse("a", &no_auto()).unwrap().ok);
}

#[test]
fn until_features_and_elision_only() {
    let mut sources = BTreeMap::new();
    sources.insert(
        "p.md".to_string(),
        "```jbogenbau\n%features f\n%stage one\n%include \"g.md\"\n%stage two\n%include \"h.md\"\n```\n".to_string(),
    );
    sources.insert(
        "g.md".to_string(),
        grammar("%ambiguity-resolution greedy\n%rule text [w] ...\n%rule w 'x' <X> %emits $"),
    );
    sources.insert("h.md".to_string(), grammar("%ambiguity-resolution greedy\n%rule text f? g? X X | f? ¬g? X"));
    let dialect = gencmu::load_dialect_sources(sources, "p.md").unwrap();
    let gate = |name: &str, default| Feature { name: name.to_string(), kind: FeatureKind::Gate, default };
    assert_eq!(dialect.features(), [gate("f", true), gate("g", false)]);

    let result = dialect.parse("xx", &ParseOptions { until: Some("one".into()), ..no_auto() }).unwrap();
    assert!(result.ok);
    assert_eq!(result.stages.len(), 1);
    assert_eq!(result.stages[0].output.as_ref().map(Vec::len), Some(2));

    assert!(!dialect.parse("xx", &no_auto()).unwrap().ok);
    assert!(dialect.parse("x", &no_auto()).unwrap().ok);
    let with_g = ParseOptions { features: vec!["g".into()], ..no_auto() };
    assert!(dialect.parse("xx", &with_g).unwrap().ok);

    let error = dialect.parse("x", &ParseOptions { until: Some("three".into()), ..no_auto() }).expect_err("no stage");
    assert_eq!(error.kind, ErrorKind::Usage);
    // An empty name names no stage either (docs/api.md).
    let error = dialect.parse("x", &ParseOptions { until: Some(String::new()), ..no_auto() }).expect_err("no stage");
    assert_eq!(error.kind, ErrorKind::Usage);

    let ambiguous = gencmu::load_dialect_sources(
        single("%ambiguity-resolution greedy elision-only\n%rule text s | s 'b' %rule s 'a' ['b']"),
        "p.md",
    )
    .unwrap();
    let result = ambiguous.parse("ab", &no_auto()).unwrap();
    assert!(!result.ok);
    let error = result.error.as_ref().unwrap();
    assert_eq!(error.kind, ParseErrorKind::Ambiguous);
    assert_eq!(error.reason, Some(gencmu::AmbiguityReason::ElisionOnly));
    assert_eq!(error.readings.len(), 2);
    assert!(result.tree.is_none());
    let off = ambiguous.parse("ab", &ParseOptions { elision_only: Some(false), ..no_auto() }).unwrap();
    assert!(off.ok);
    assert_eq!(off.stages[0].verdict, Some(Verdict::Resolved));
    let on = gencmu::load_dialect_sources(
        single("%ambiguity-resolution greedy\n%rule text s | s 'b' %rule s 'a' ['b']"),
        "p.md",
    )
    .unwrap()
    .parse("ab", &ParseOptions { elision_only: Some(true), ..no_auto() })
    .unwrap();
    assert!(!on.ok);
}

/// A dialect with a `words` stage, where `sa` and `su` are words only
/// under the feature `sa-su`.
fn words_dialect() -> gencmu::Dialect {
    let mut sources = BTreeMap::new();
    sources.insert(
        "p.md".to_string(),
        "```jbogenbau\n%stage sounds\n%include \"s.md\"\n%stage words\n%include \"w.md\"\n```\n".to_string(),
    );
    sources.insert(
        "s.md".to_string(),
        grammar("%ambiguity-resolution greedy\n%rule text [c] ...\n%rule c 's' </s/> | 'a' </a/> | 'u' </u/> | 'm' </m/> | 'i' </i/> | '\\p{White_Space}' </./> %emits $"),
    );
    sources.insert(
        "w.md".to_string(),
        grammar(
            "%ambiguity-resolution lazy\n%rule text [piece] ...\n%rule piece word | /./\n%rule word /m/ /i/ | sa-su? /s/ /a/ | sa-su? /s/ /u/",
        ),
    );
    gencmu::load_dialect_sources(sources, "p.md").unwrap()
}

#[test]
fn auto_features_add_sa_su_only_where_needed() {
    let dialect = words_dialect();
    let plain = dialect.parse("mi mi", &ParseOptions::default()).unwrap();
    assert!(plain.ok);
    let needs = dialect.parse("mi sa", &ParseOptions::default()).unwrap();
    assert!(needs.ok, "{}", gencmu::to_json(&needs));
    let off = dialect.parse("mi sa", &no_auto()).unwrap();
    assert!(!off.ok);
    assert_eq!(off.error.as_ref().unwrap().kind, ParseErrorKind::Rejected);
    let explicit = dialect.parse("mi su", &ParseOptions { features: vec!["sa-su".into()], ..no_auto() }).unwrap();
    assert!(explicit.ok);
    // Auto features never add `sa-su` once the caller has turned it off.
    let without = ParseOptions { without_features: vec!["sa-su".into()], ..ParseOptions::default() };
    assert!(!dialect.parse("mi sa", &without).unwrap().ok);
    // `until` before `words` skips the probe.
    let early =
        dialect.parse("mi sa", &ParseOptions { until: Some("sounds".into()), ..ParseOptions::default() }).unwrap();
    assert!(early.ok);
    assert_eq!(early.stages.len(), 1);
}

#[test]
fn gates_turn_off_and_warnings_follow_the_chosen_tree() {
    let mut sources = BTreeMap::new();
    sources.insert("p.md".to_string(), "```jbogenbau\n%features f\n%stage main\n%include \"g.md\"\n```\n".to_string());
    sources.insert(
        "g.md".to_string(),
        grammar("%ambiguity-resolution greedy\n%rule text f? 'a' | ¬f? w! part ...\n%rule part w! 'b' | 'c'"),
    );
    let dialect = gencmu::load_dialect_sources(sources.clone(), "p.md").unwrap();
    assert_eq!(
        dialect.features(),
        [
            Feature { name: "f".to_string(), kind: FeatureKind::Gate, default: true },
            Feature { name: "w".to_string(), kind: FeatureKind::Warning, default: false },
        ]
    );
    assert!(!dialect.parse("bcb", &no_auto()).unwrap().ok);
    let off = ParseOptions { without_features: vec!["f".into()], ..no_auto() };
    let quiet = dialect.parse("bcb", &off).unwrap();
    assert!(quiet.ok);
    assert!(quiet.warnings.is_empty());
    assert!(!gencmu::to_json(&quiet).contains("\"warnings\""));
    // One warning for each node of the chosen tree built from a warned
    // alternative: the prefixes of `part ...`, which the tree splices out,
    // are not its nodes (engine §12).
    let warned = dialect.parse("bcb", &ParseOptions { features: vec!["w".into()], ..off }).unwrap();
    assert!(warned.ok);
    assert_eq!(gencmu::to_brackets(&warned, false), "(b c b)");
    let warning = |rule: &str, span: std::ops::Range<usize>| Warning {
        stage: "main".to_string(),
        feature: "w".to_string(),
        rule: rule.to_string(),
        span: span.clone(),
        source: span,
    };
    assert_eq!(warned.warnings, [warning("text", 0..3), warning("part", 0..1), warning("part", 2..3)]);
    assert!(gencmu::to_json(&warned).contains(
        ",\"error\":null,\"warnings\":[{\"stage\":\"main\",\"feature\":\"w\",\"rule\":\"text\",\"span\":[0,3],\"source\":[0,3]},"
    ));
    let both = ParseOptions { features: vec!["w".into()], without_features: vec!["w".into()], ..no_auto() };
    assert_eq!(dialect.parse("bcb", &both).expect_err("w both on and off").kind, ErrorKind::Usage);

    // A name is a gate or a warning across every stage of a dialect.
    sources.insert(
        "q.md".to_string(),
        "```jbogenbau\n%stage one\n%include \"g.md\"\n%stage two\n%include \"h.md\"\n```\n".to_string(),
    );
    sources.insert("h.md".to_string(), grammar("%ambiguity-resolution greedy\n%rule text w? X"));
    let error = gencmu::load_dialect_sources(sources, "q.md").expect_err("w a warning in one stage, a gate in another");
    assert_eq!((error.kind, error.document.as_deref()), (ErrorKind::Grammar, Some("q.md")), "{error}");
}

#[test]
fn parts_that_emit_epsilon_are_neither_emitted_nor_counted() {
    let mut sources = BTreeMap::new();
    sources.insert(
        "p.md".to_string(),
        "```jbogenbau\n%stage one\n%include \"f.md\"\n%stage two\n%include \"g.md\"\n%stage three\n%include \"h.md\"\n```\n"
            .to_string(),
    );
    sources.insert(
        "f.md".to_string(),
        grammar(
            "%ambiguity-resolution greedy\n%rule text [c] ...\n%rule c 'a' </a/> | 'b' </b/> | '\\p{White_Space}' </./> %emits $",
        ),
    );
    sources.insert(
        "g.md".to_string(),
        grammar(
            "%ambiguity-resolution greedy\n%rule text [unit] ...\n%rule unit pair <U> | /./ %emits $\n%rule pair erased $b(letter) %emits $b\n%rule erased letter %emits ε\n%rule letter /a/ | /b/",
        ),
    );
    sources.insert("h.md".to_string(), grammar("%ambiguity-resolution greedy\n%rule text [U | /./] ..."));
    let dialect = gencmu::load_dialect_sources(sources, "p.md").unwrap();
    let result = dialect.parse("ab ba", &no_auto()).unwrap();
    assert!(result.ok, "{}", gencmu::to_json(&result));
    let output = result.stages[1].output.as_ref().unwrap();
    let heard: Vec<_> = output.iter().map(|token| token.phonemes.as_deref().unwrap_or("?")).collect();
    // The erased first letter of each pair does not count, and the pause
    // is `.` (engine §5).
    assert_eq!(heard, ["b", ".", "a"]);
    // Each token's label joins the same parts, with the pause as a space.
    let shown: Vec<_> = output.iter().map(|token| token.label.as_str()).collect();
    assert_eq!(shown, ["b", " ", "a"]);
    assert_eq!(output[0].text, "ab");
}

#[test]
fn rejections_say_where_and_what() {
    let dialect =
        gencmu::load_dialect_sources(single("%ambiguity-resolution greedy\n%rule text 'a' 'b'"), "p.md").unwrap();
    let result = dialect.parse("a\nc", &no_auto()).unwrap();
    assert!(!result.ok);
    assert!(result.tree.is_none());
    let error = result.error.unwrap();
    assert_eq!(error.kind, ParseErrorKind::Rejected);
    assert_eq!(error.stage.as_deref(), Some("main"));
    assert_eq!(error.token, Some(1));
    assert_eq!(error.source, Some(1..2));
    assert_eq!((error.line, error.column), (Some(1), Some(2)));
    assert_eq!(error.expected.len(), 1);
    assert_eq!(error.expected[0].terminal, "'b'");
    assert_eq!(error.expected[0].rules, ["text"]);
    assert_eq!(result.stages[0].verdict, None);
    assert!(result.stages[0].output.is_none());
    assert!(!error.to_string().is_empty());
}

#[test]
fn references_are_checked_inside_a_tested_symbol() {
    // A tested reference to a rule that does not exist is an error of the
    // grammar, captured or not; one to a rule that does is not.
    for rules in ["%rule text ghost=\"a\"", "%rule text $g(ghost⊇~a) B"] {
        let error = gencmu::load_dialect_sources(single(&format!("%ambiguity-resolution greedy\n{rules}")), "p.md")
            .expect_err("a tested reference to no rule");
        assert_eq!(error.kind, ErrorKind::Grammar);
        assert!(error.message.contains("ghost"), "{error}");
    }
    let rules =
        "%ambiguity-resolution greedy\n%rule text $s(sumti=\"lonu\") [other∩~x=∅]\n%rule sumti A B\n%rule other C";
    assert!(gencmu::load_dialect_sources(single(rules), "p.md").is_ok());
}

#[test]
fn a_rejection_writes_a_tested_terminal_with_its_test() {
    // Characters to sounds, sounds to words, so that the words have
    // phonemes.
    let block = |text: &str| format!("```jbogenbau\n%ambiguity-resolution greedy\n{text}\n```\n");
    let mut sources = BTreeMap::new();
    sources.insert(
        "p.md".to_string(),
        "```jbogenbau\n%stage sounds\n%include \"s.md\"\n%stage words\n%include \"w.md\"\n%stage main\n%include \"g.md\"\n```\n"
            .to_string(),
    );
    sources.insert(
        "s.md".to_string(),
        block("%rule text [sound] ...\n%rule sound 'l' </l/> | 'a' </a/> | 'i' </i/> | 'd' </d/> | ' ' </./> %emits $"),
    );
    sources.insert(
        "w.md".to_string(),
        block("%rule text [word] ...\n%rule word le | d | /./\n%rule le /l/ /a/ [/i/] %emits $ <LE>\n%rule d /d/ %emits $ <D>"),
    );
    sources.insert("g.md".to_string(), block("%rule text LE=\"la\" D D | LE=\"lai\" C | LE⊇(D ∪ C) | LE∩~x≠∅"));
    let dialect = gencmu::load_dialect_sources(sources, "p.md").unwrap();
    let error = dialect.parse("lai d", &no_auto()).unwrap().error.expect("a rejection");
    let expected: Vec<(&str, Vec<String>)> =
        error.expected.iter().map(|expected| (expected.terminal.as_str(), expected.rules.clone())).collect();
    assert_eq!(expected, [("C", vec!["text".to_string()])]);
    let error = dialect.parse("d", &no_auto()).unwrap().error.expect("a rejection");
    let expected: Vec<&str> = error.expected.iter().map(|expected| expected.terminal.as_str()).collect();
    assert_eq!(expected, ["LE=\"la\"", "LE=\"lai\"", "LE∩x≠∅", "LE⊇(C ∪ D)"]);
    assert!(error.message.ends_with("it expected LE=\"la\", LE=\"lai\", LE∩x≠∅, LE⊇(C ∪ D)"), "{}", error.message);
}

#[test]
fn positions_are_code_points() {
    let dialect = gencmu::load_dialect_sources(
        single("%ambiguity-resolution greedy\n%rule text [c] ... %rule c '\\p{Any}' %emits $"),
        "p.md",
    )
    .unwrap();
    let result = dialect.parse("😀é\u{10348}", &no_auto()).unwrap();
    assert!(result.ok);
    let output = result.stages[0].output.as_ref().unwrap();
    let sources: Vec<_> = output.iter().map(|token| token.source.clone()).collect();
    assert_eq!(sources, [0..1, 1..2, 2..3]);
    assert_eq!(output[0].text, "😀");
}

#[test]
fn results_outlive_the_dialect_and_cross_threads() {
    let result = {
        let dialect = gencmu::load_dialect("notation").unwrap();
        let text = String::from("%rule x A");
        dialect.parse(&text, &ParseOptions::default()).unwrap()
    };
    let json = std::thread::spawn(move || gencmu::to_json(&result)).join().unwrap();
    assert!(json.starts_with("{\"format\":7,\"ok\":true"));

    let dialect = std::sync::Arc::new(gencmu::load_dialect("notation").unwrap());
    let threads: Vec<_> = (0..4)
        .map(|index| {
            let dialect = dialect.clone();
            std::thread::spawn(move || {
                dialect.parse(&format!("%rule r{index} A{index}"), &ParseOptions::default()).unwrap().ok
            })
        })
        .collect();
    assert!(threads.into_iter().all(|thread| thread.join().unwrap()));
}

/// Runs `body` on a thread with a small stack, so that recursion over a
/// long input would overflow.
fn small_stack(body: impl FnOnce() + Send + 'static) {
    std::thread::Builder::new().stack_size(256 * 1024).spawn(body).unwrap().join().expect("no overflow");
}

#[test]
fn deep_left_recursion_does_not_overflow() {
    small_stack(|| {
        let dialect =
            gencmu::load_dialect_sources(single("%ambiguity-resolution greedy\n%rule text text 'a' | 'a'"), "p.md")
                .unwrap();
        let text = "a".repeat(20_000);
        let started = std::time::Instant::now();
        let result = dialect.parse(&text, &no_auto()).unwrap();
        eprintln!("20000 characters through a left-recursive rule in {:?}", started.elapsed());
        assert!(result.ok);
        assert_eq!(result.stages[0].verdict, Some(Verdict::Unique));
        let tree = result.tree.as_ref().unwrap();
        let mut depth = 0;
        let mut node = tree;
        while let Some(first) = node.children.first() {
            depth += 1;
            node = first;
        }
        assert_eq!(depth, 20_000);
        assert_eq!(node.kind, NodeKind::Token);
        let copy = result.clone();
        assert!(copy == result);
        let json = gencmu::to_json(&result);
        assert!(json.len() > 20_000 * 50);
        let brackets = gencmu::to_brackets(&result, false);
        assert!(brackets.starts_with("([{([{") && brackets.ends_with(" a)"), "{}", &brackets[..40]);
        let _ = format!("{:?}", result.tree);
        drop(copy);
    });
}

#[test]
fn deep_tokens_and_ties_do_not_overflow() {
    small_stack(|| {
        let dialect = gencmu::load_dialect_sources(
            single("%ambiguity-resolution greedy\n%rule text text p | p\n%rule p A B <ONE> | A B <TWO>"),
            "p.md",
        )
        .unwrap();
        let tokens: Vec<gencmu::InputToken> = (0..6000)
            .map(|index| gencmu::InputToken {
                text: if index % 2 == 0 { "a".into() } else { "b".into() },
                tags: [if index % 2 == 0 { "A" } else { "B" }.to_string()].into_iter().collect(),
                phonemes: None,
            })
            .collect();
        let started = std::time::Instant::now();
        let result = dialect.parse_tokens(&tokens, &no_auto()).unwrap();
        eprintln!("6000 tokens with 3000 independent ties in {:?}", started.elapsed());
        assert!(result.ok);
        assert_eq!(result.stages[0].verdict, Some(Verdict::Tie));
        let _ = gencmu::to_json(&result);
    });
}

#[test]
fn deep_attachments_do_not_overflow() {
    small_stack(|| {
        // Each w carries the rest of the text as its after-attachment, so
        // the attachments nest as deep as the text is long.
        let mut sources = BTreeMap::new();
        sources.insert(
            "p.md".to_string(),
            "```jbogenbau\n%stage a\n%include \"a.md\"\n%stage b\n%include \"b.md\"\n```\n".to_string(),
        );
        sources.insert(
            "a.md".to_string(),
            grammar("%ambiguity-resolution greedy\n%rule text\n  | $w(word) | $w(word) $a(text)\n%emits\n  $w ($a)\n%rule word\n  'w' <W>"),
        );
        sources.insert("b.md".to_string(), grammar("%ambiguity-resolution greedy\n%rule text W"));
        let dialect = gencmu::load_dialect_sources(sources, "p.md").unwrap();
        let count = 1500;
        let result = dialect.parse(&"w".repeat(count), &no_auto()).unwrap();
        assert!(result.ok, "{:?}", result.error);
        let output = result.stages[0].output.as_ref().unwrap();
        assert_eq!(output.len(), 1);
        let mut depth = 0;
        let mut attachments = &output[0].after;
        while let Some(first) = attachments.first() {
            depth += 1;
            attachments = &first.after;
        }
        assert_eq!(depth, count - 1);
        let copy = result.clone();
        assert!(copy == result);
        let json = gencmu::to_json(&result);
        assert!(json.len() > count * 50);
        let brackets = gencmu::to_brackets(&result, false);
        assert!(
            brackets.starts_with("(w [w {w (w") && brackets.trim_end_matches([')', ']', '}']).ends_with("[w w"),
            "{}",
            &brackets[..40]
        );
        assert_eq!(brackets.matches('w').count(), count);
        let shown = format!("{:?}", output[0]);
        assert!(shown.len() > count * 50);
        drop(copy);
    });
}

#[test]
fn a_long_name_through_the_notation_does_not_overflow() {
    small_stack(|| {
        let dialect = gencmu::load_dialect("notation").unwrap();
        let name = "a".repeat(150);
        let started = std::time::Instant::now();
        let result = dialect.parse(&format!("%rule {name} B"), &ParseOptions::default()).unwrap();
        eprintln!("a 150-character name through the notation in {:?}", started.elapsed());
        assert!(result.ok);
        assert_eq!(result.stages[0].output.as_ref().unwrap()[1].text.len(), 150);
    });
}

#[test]
fn an_and_of_more_than_sixteen_items_is_an_error() {
    let items: Vec<String> = (0..17).map(|index| format!("A{index}")).collect();
    let rules = format!("%ambiguity-resolution greedy\n%rule text B {}", items.join(" & "));
    let error = gencmu::load_dialect_sources(single(&rules), "p.md").expect_err("an & of 17 items");
    assert_eq!(error.kind, ErrorKind::Grammar);
    assert_eq!((error.document.as_deref(), error.line, error.column), (Some("g.md"), Some(5), Some(12)), "{error}");
    let sixteen = format!("%ambiguity-resolution greedy\n%rule text {}", items[..16].join(" & "));
    assert!(gencmu::load_dialect_sources(single(&sixteen), "p.md").is_ok());

    // A DOM from the cache is checked too, rather than trusted. The cache
    // holds a DOM of this format for the document, with an & of 'B' in
    // place of 'A'. An & of 16 items is a DOM the reader could give, so the
    // cache is used, and the dialect takes "B".
    let text = "%ambiguity-resolution greedy\n%rule text 'A'";
    let and = |count: usize| {
        let items = vec![r#"{"terminal":"'B'"}"#; count];
        let dom = changed_dom(text, r#"{"terminal":"'A'"}"#, &format!(r#"{{"and":[{}]}}"#, items.join(",")));
        let mut sources = single(text);
        sources.insert("compiled.json".to_string(), compiled(text, &dom));
        gencmu::load_dialect_sources(sources, "p.md").expect("a dialect")
    };
    let dialect = and(16);
    assert!(dialect.parse("B", &no_auto()).unwrap().ok, "the cache is used");
    assert!(!dialect.parse("A", &no_auto()).unwrap().ok, "the cache is used");
    // An & of 17 items is not a DOM the reader could give, so it is a
    // cache miss, and the document itself is read.
    let dialect = and(17);
    assert!(dialect.parse("A", &no_auto()).unwrap().ok, "the document read instead");
}

#[test]
fn a_corrupt_cache_is_a_miss_not_an_abort() {
    small_stack(|| {
        let text = "%ambiguity-resolution greedy\n%rule text 'a'";
        let load = |cache: String| {
            let mut sources = single(text);
            sources.insert("compiled.json".to_string(), cache);
            gencmu::load_dialect_sources(sources, "p.md").expect("a dialect")
        };
        // Each corrupt DOM starts from a DOM of this format, so that it
        // reaches the check of the DOM. Unchanged but for 'b' in place of
        // 'a', the cache is used.
        let terminal = r#"{"terminal":"'a'"}"#;
        let dialect = load(compiled(text, &changed_dom(text, terminal, r#"{"terminal":"'b'"}"#)));
        assert!(dialect.parse("b", &no_auto()).unwrap().ok, "the cache is used");
        // Deeper than a DOM can nest (engine §9), and nearly as deep as the
        // JSON reader allows, but not so deep that the JSON does not parse,
        // as the first entry below is.
        let deep = format!("{}{{\"terminal\":\"'b'\"}}{}", "{\"optional\":".repeat(1000), "}".repeat(1000));
        let dom = gencmu::tools::read_grammar_document(&grammar(text)).expect("a DOM");
        let rules = &dom[dom.find("\"rules\":").expect("rules")..dom.find(",\"directives\":").expect("directives")];
        for cache in [
            format!("{}{}", "[".repeat(10_000), "]".repeat(10_000)),
            compiled(text, &changed_dom(text, terminal, &deep)),
            compiled(text, &dom.replacen(rules, "\"rules\":7", 1)),
            "not JSON".to_string(),
        ] {
            let dialect = load(cache);
            assert!(dialect.parse("a", &no_auto()).unwrap().ok, "read through the notation instead");
        }
    });
}

/// A dialect whose one production reads `count` terminals 'a' and then the
/// rest of `rules`, which starts with two 'a'. It comes from a cache DOM, so
/// that the notation does not read a rule that long.
fn long_production(rules: &str, count: usize) -> gencmu::Dialect {
    let text = format!("%ambiguity-resolution greedy\n{rules}");
    let two = r#"{"seq":[{"terminal":"'a'"},{"terminal":"'a'"}"#;
    let many = format!(r#"{{"seq":[{}"#, vec![r#"{"terminal":"'a'"}"#; count].join(","));
    let mut sources = single(&text);
    sources.insert("compiled.json".to_string(), compiled(&text, &changed_dom(&text, two, &many)));
    gencmu::load_dialect_sources(sources, "p.md").expect("a dialect")
}

#[test]
fn positions_past_u16_keep_conditions_in_place() {
    for count in [65_535, 65_536] {
        // A condition on `$` runs when the item is complete (§4), after
        // every symbol, not at prediction over an empty span.
        let input = "a".repeat(count);
        let empty = long_production("%rule text 'a' 'a' %conditions text($) = \"\"", count);
        assert!(!empty.parse(&input, &no_auto()).unwrap().ok, "{count} symbols: the whole text is not empty");
        let full = long_production("%rule text 'a' 'a' %conditions text($) ≠ \"\"", count);
        assert!(full.parse(&input, &no_auto()).unwrap().ok, "{count} symbols: the whole text is the input");
        // A capture after them stands at position `count`, and its
        // condition runs once the capture is read.
        let captured = long_production("%rule text 'a' 'a' $c('b') %conditions text($c) = \"b\"", count);
        let result = captured.parse(&format!("{input}b"), &no_auto()).unwrap();
        assert!(result.ok, "{count} symbols before the capture");
        let wrong = long_production("%rule text 'a' 'a' $c('b') %conditions text($c) = \"a\"", count);
        assert!(!wrong.parse(&format!("{input}b"), &no_auto()).unwrap().ok, "{count} symbols before the capture");
    }
}

#[test]
fn relative_paths_keep_their_leading_parents() {
    // From the crate's directory, up out of the checkout and down again into
    // it: the grammar links must resolve beside the pipeline.
    let crate_directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let checkout = crate_directory
        .parent()
        .and_then(|lib| lib.parent())
        .and_then(|repository| repository.file_name())
        .expect("a checkout directory");
    let relative = std::path::Path::new("../../..").join(checkout).join("lib/rust/grammars/dialects/notation.md");
    std::env::set_current_dir(crate_directory).unwrap();
    let dialect =
        gencmu::load_dialect_file(&relative).unwrap_or_else(|error| panic!("{}: {error}", relative.display()));
    assert!(dialect.parse("%rule a B", &ParseOptions::default()).unwrap().ok);
}

/// An input token has no source or span of its own. The library gives each
/// token its index as its span, and a source in the tokens' texts joined
/// with single spaces, so both always lie in order within the text
/// (docs/api.md).
#[test]
fn input_tokens_get_sources_within_the_text() {
    let dialect = gencmu::load_dialect_sources(single("%ambiguity-resolution greedy\n%rule text W W W"), "p.md")
        .expect("a dialect");
    let tokens: Vec<gencmu::InputToken> = ["mi", "", "dô"]
        .iter()
        .map(|text| gencmu::InputToken { text: text.to_string(), tags: ["W".to_string()].into(), phonemes: None })
        .collect();
    let result = dialect.parse_tokens(&tokens, &no_auto()).expect("a parse");
    assert!(result.ok);
    let input = &result.stages[0].input;
    let ranges: Vec<_> = input.iter().map(|token| (token.span.clone(), token.source.clone())).collect();
    assert_eq!(ranges, [(0..1, 0..2), (1..2, 3..3), (2..3, 4..6)]);
    assert_eq!(result.tree.expect("a tree").source, 0..6);
}

/// An entry that adds a membership that holds is an error of the grammar
/// for the features that turn it on, and its message names the entry's
/// document, line and column (engine §2).
#[test]
fn a_classifier_error_names_its_entry() {
    let rules = "%ambiguity-resolution greedy\n%classifier lex\n  \"mi\" ∈ KOhA\n  f? \"mi\" ∈ KOhA\n%rule text $w(W) <classify(phonemes($w), lex)>\n%emits\n  $";
    let dialect = gencmu::load_dialect_sources(single(rules), "p.md").expect("a dialect");
    let tokens = [gencmu::InputToken {
        text: "mi".to_string(),
        tags: ["W".to_string()].into(),
        phonemes: Some("mi".to_string()),
    }];
    assert!(dialect.parse_tokens(&tokens, &no_auto()).expect("a parse").ok);
    let on = ParseOptions { features: vec!["f".to_string()], ..no_auto() };
    let result = dialect.parse_tokens(&tokens, &on).expect("a parse");
    let error = result.error.expect("an error of the grammar");
    assert_eq!(error.kind, ParseErrorKind::Grammar);
    assert_eq!(error.stage.as_deref(), Some("main"));
    assert!(error.message.starts_with("g.md:7:3: the classifier lex: \"mi\" is already in KOhA"), "{}", error.message);
}

/// The loader checks an implication once the constants have their final
/// values: an undefined constant stands at its reference, and a side that
/// is not a tag set at its first constant (engine §2, §9).
#[test]
fn an_implication_error_stands_at_its_constant() {
    let error = |rules: &str| {
        let text = format!("%ambiguity-resolution greedy\n%rule text W\n{rules}");
        let error = gencmu::load_dialect_sources(single(&text), "p.md").expect_err("an error of the grammar");
        assert_eq!(error.kind, ErrorKind::Grammar);
        (error.document.clone().unwrap_or_default(), error.line, error.column)
    };
    assert_eq!(error("%implies A ∪ $X ⟹ ~m"), ("g.md".to_string(), Some(6), Some(14)));
    assert_eq!(error("%const $S \"s\"\n%implies A ⟹ ~m ∪ $S"), ("g.md".to_string(), Some(7), Some(19)));
}

/// The indicator stage attaches indicators and `ba'e` to their word, and
/// the syntax reads the word alone (engine §11, docs/output.md).
#[test]
fn attachments_follow_their_token_into_the_result_and_the_brackets() {
    let dialect = gencmu::load_dialect("cll-ebnf").expect("the CLL dialect");
    let options = ParseOptions::default();
    let brackets = |text: &str| {
        let result = dialect.parse(text, &options).expect("a result");
        assert!(result.ok, "{text}: {:?}", result.error);
        gencmu::to_brackets(&result, false)
    };
    assert_eq!(brackets("mi ui klama"), "([mi ui] klama)");
    assert_eq!(brackets("ba'e mi klama"), "([ba'e mi] klama)");
    assert_eq!(brackets("mi ui nai klama"), "([mi {ui nai}] klama)");
    let result = dialect.parse("mi ui nai klama", &options).expect("a result");
    let syntax = result.stages.last().expect("a stage");
    let mi = &syntax.input[0];
    assert_eq!((mi.label.as_str(), mi.before.len(), mi.after.len()), ("mi", 0, 1));
    let ui = &mi.after[0];
    assert_eq!((ui.label.as_str(), ui.source.clone()), ("ui", 3..5));
    assert_eq!(ui.after.iter().map(|nai| nai.label.as_str()).collect::<Vec<_>>(), ["nai"]);
    // An attached token has no span, and its lists are written only when
    // they are not empty (docs/output.md).
    let json = gencmu::to_json(&result);
    assert!(json.contains(r#""source":[0,2],"after":[{"text":"ui","phonemes":"ui","label":"ui","tags":["#), "{json}");
    assert!(json.contains(r#""source":[3,5],"after":[{"text":"nai""#), "{json}");
}

/// The output of the stage `name` of a parse of `text`, which must succeed.
fn stage_output(dialect: &gencmu::Dialect, text: &str, name: &str) -> Vec<gencmu::Token> {
    let result = dialect.parse(text, &ParseOptions::default()).expect("a result");
    assert!(result.ok, "{text}: {:?}", result.error);
    let stage = result.stages.into_iter().find(|stage| stage.name == name).expect("the stage");
    stage.output.expect("an output")
}

/// words/stream.md: the body of an empty zoi quote is an empty opaque part.
/// So it sounds `?`, and a letter word over the quote keeps the `?`, with no
/// pause after it, since the one pause between the delimiters comes first.
#[test]
fn an_empty_zoi_body_sounds_opaque_and_so_does_a_letter_word_over_it() {
    let dialect = gencmu::load_dialect("cll-ebnf").expect("the CLL dialect");
    let words = stage_output(&dialect, "zoi gy gy", "words");
    let body = words.iter().find(|token| token.tags.iter().any(|tag| tag == "quoted-text")).expect("a body");
    assert_eq!(body.phonemes.as_deref(), Some("?"));
    assert_eq!(body.inserted_by, None);
    let letter = &stage_output(&dialect, "zoi gy gy bu", "words")[0];
    assert_eq!(letter.phonemes.as_deref(), Some("zoi.gy.?gy.bu"));
}

/// phonemes/zbalermorna.md: the token of the vowel after the shorthand mark
/// covers the mark, so a word that begins with the shorthand begins at it.
#[test]
fn the_zbalermorna_shorthand_vowel_token_covers_its_mark() {
    let dialect = gencmu::load_dialect("bpfk").expect("the bpfk dialect");
    let text = "\u{ED8B}\u{EDA4}\u{EDA2}";
    let vowel = &stage_output(&dialect, text, "phonemes")[0];
    assert_eq!((vowel.text.as_str(), vowel.source.clone()), ("\u{ED8B}\u{EDA4}", 0..2));
    let word = &stage_output(&dialect, text, "forms")[0];
    assert_eq!((word.text.as_str(), word.source.clone()), (text, 0..3));
    assert_eq!(word.phonemes.as_deref(), Some("u'i"));
}

/// words/cll.md and words/forms.md: a Cy letter is never `continued`. So
/// the general join of `run-words`, a continued word before an onset, never
/// joins a Cy letter to the word after it, and only the Cy rule joins two.
#[test]
fn a_cy_letter_carries_cy_and_never_continued() {
    let dialect = gencmu::load_dialect("cll-ebnf").expect("the CLL dialect");
    let letters = stage_output(&dialect, "cyky", "forms");
    assert_eq!(letters.iter().map(|token| token.label.as_str()).collect::<Vec<_>>(), ["cy", "ky"]);
    for letter in &letters {
        let has = |tag: &str| letter.tags.iter().any(|each| each == tag);
        assert!(has("cy") && !has("continued"), "{}", letter.label);
    }
}

/// indicators/cll.md: the greedy ranking reads a `nai` after a leading
/// attitudinal into the leading run, with or without a `ba'e` before it, and
/// after a text opener as at the start of the text. No condition decides it,
/// so each of these texts has the verdict resolved in the indicator stage.
#[test]
fn the_ranking_reads_a_nai_after_a_leading_attitudinal_into_the_run() {
    let dialect = gencmu::load_dialect("cll-ebnf").expect("the CLL dialect");
    for (text, labels) in [
        ("ui nai mi klama", &["ui", "nai", "mi", "klama"][..]),
        ("ui ba'e nai mi klama", &["ui", "nai", "mi", "klama"][..]),
        ("lu ui nai mi li'u", &["lu", "ui", "nai", "mi", "li'u"][..]),
    ] {
        let result = dialect.parse(text, &ParseOptions::default()).expect("a result");
        assert!(result.ok, "{text}");
        let stage = result.stages.iter().find(|stage| stage.name == "indicators").expect("the stage");
        assert_eq!(stage.verdict, Some(Verdict::Resolved), "{text}");
        let output = stage.output.as_ref().expect("an output");
        assert_eq!(output.iter().map(|token| token.label.as_str()).collect::<Vec<_>>(), labels, "{text}");
    }
}

/// syntax/experimental.md: the grammar reads no LA, since no word of the
/// experimental lexicon has it. A probe document after the lexicon moves
/// `la` from LE to LA, and then no rule reads `la mlatu ku`.
#[test]
fn the_experimental_syntax_reads_no_la() {
    fn walk(root: &std::path::Path, directory: &std::path::Path, sources: &mut BTreeMap<String, String>) {
        for entry in std::fs::read_dir(directory).expect("a directory") {
            let path = entry.expect("an entry").path();
            if path.is_dir() {
                walk(root, &path, sources);
            } else if path.extension().is_some_and(|extension| extension == "md") {
                let relative = path.strip_prefix(root).unwrap().components();
                let relative: Vec<_> = relative.map(|part| part.as_os_str().to_string_lossy().into_owned()).collect();
                sources.insert(relative.join("/"), std::fs::read_to_string(&path).expect("a document"));
            }
        }
    }
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("grammars");
    let mut sources = BTreeMap::new();
    walk(&root, &root, &mut sources);
    let include = "%include \"../words/lexicon-experimental.md\"";
    let pipeline = sources.get_mut("dialects/experimental.md").expect("the pipeline");
    assert!(pipeline.contains(include));
    *pipeline = pipeline.replace(include, &format!("{include}\n  %include \"../words/la-probe.md\""));
    sources.insert(
        "words/la-probe.md".to_string(),
        "```jbogenbau\n%classifier lexicon\n  \"la\" ∉ LE\n  \"la\" ∈ LA\n```\n".to_string(),
    );
    let probe = gencmu::load_dialect_sources(sources, "dialects/experimental.md").expect("the probe dialect");
    let result = probe.parse("la mlatu ku cu klama", &ParseOptions::default()).expect("a result");
    let forms = result.stages.iter().find(|stage| stage.name == "forms").expect("the forms stage");
    let la = &forms.output.as_ref().expect("an output")[0];
    assert!(la.tags.iter().any(|tag| tag == "LA") && !la.tags.iter().any(|tag| tag == "LE"));
    assert!(!result.ok);
    assert_eq!(result.error.as_ref().and_then(|error| error.stage.as_deref()), Some("syntax"));
    assert!(probe.parse("lo mlatu ku cu klama", &ParseOptions::default()).expect("a result").ok);
}
