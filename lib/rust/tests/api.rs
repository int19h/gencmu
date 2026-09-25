//! The library's API (docs/api.md): the three loaders, the options, the
//! errors, and inputs long enough that anything recursive would overflow.

use std::collections::BTreeMap;

use gencmu::{ErrorKind, NodeKind, ParseErrorKind, ParseOptions, Verdict};

fn grammar(rules: &str) -> String {
    format!("# A grammar\n\n```jbogenbau\n{rules}\n```\n")
}

fn single(rules: &str) -> BTreeMap<String, String> {
    let mut sources = BTreeMap::new();
    sources.insert("p.md".to_string(), "## Main <?stage main?>\n\n- [g](g.md) <?grammar?>\n".to_string());
    sources.insert("g.md".to_string(), grammar(rules));
    sources
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
    let text = "%rule a $x(B) <\"T\"> %conditions text($x) ≠ \"q\" %emits $";
    assert_eq!(
        gencmu::to_json(&bundled.parse(text, &ParseOptions::default()).unwrap()),
        gencmu::to_json(&from_disk.parse(text, &ParseOptions::default()).unwrap())
    );

    let directory = std::env::temp_dir().join(format!("gencmu-api-{}", std::process::id()));
    std::fs::create_dir_all(directory.join("dialects")).unwrap();
    std::fs::create_dir_all(directory.join("grammars")).unwrap();
    std::fs::write(
        directory.join("dialects/mine.md"),
        "# Mine\n\n## Only <?stage only?>\n\n- [the grammar](../grammars/g.md) <?grammar?>\n",
    )
    .unwrap();
    std::fs::write(directory.join("grammars/g.md"), grammar("%ambiguity-resolution greedy\n%rule text \"a\" ..."))
        .unwrap();
    let mine = gencmu::load_dialect_file(directory.join("dialects/mine.md")).expect("a dialect on disk");
    let result = mine.parse("aaa", &ParseOptions::default()).unwrap();
    assert!(result.ok);
    assert_eq!(gencmu::to_brackets(&result, false), "(a a a)");

    std::fs::write(
        directory.join("dialects/broken.md"),
        "## Only <?stage only?>\n\n- [gone](../grammars/gone.md) <?grammar?>\n",
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
    let mut sources = single("%ambiguity-resolution greedy\n%rule text \"alpha\"");
    // A character table that knows no letters: every one is "other".
    sources.insert("unicode.txt".to_string(), "unicode 0.0.0\n".to_string());
    let dialect = gencmu::load_dialect_sources(sources, "p.md").unwrap();
    assert!(!dialect.parse("a", &no_auto()).unwrap().ok);
    let dialect =
        gencmu::load_dialect_sources(single("%ambiguity-resolution greedy\n%rule text \"alpha\""), "p.md").unwrap();
    assert!(dialect.parse("a", &no_auto()).unwrap().ok);
}

#[test]
fn until_features_and_elision_only() {
    let mut sources = BTreeMap::new();
    sources.insert(
        "p.md".to_string(),
        "# D <?features f?>\n\n## One <?stage one?>\n\n- [g](g.md) <?grammar?>\n\n## Two <?stage two?>\n\n- [h](h.md) <?grammar?>\n"
            .to_string(),
    );
    sources.insert(
        "g.md".to_string(),
        grammar("%ambiguity-resolution greedy\n%rule text [w] ...\n%rule w \"x\" <\"X\"> %emits $"),
    );
    sources.insert("h.md".to_string(), grammar("%ambiguity-resolution greedy\n%rule text @f @g X X | @f @¬g X"));
    let dialect = gencmu::load_dialect_sources(sources, "p.md").unwrap();
    assert_eq!(dialect.features(), ["f"]);

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

    let ambiguous = gencmu::load_dialect_sources(
        single("%ambiguity-resolution greedy elision-only\n%rule text s | s \"b\" %rule s \"a\" [\"b\"]"),
        "p.md",
    )
    .unwrap();
    let result = ambiguous.parse("ab", &no_auto()).unwrap();
    assert!(!result.ok);
    let error = result.error.as_ref().unwrap();
    assert_eq!(error.kind, ParseErrorKind::Ambiguous);
    assert_eq!(error.readings.len(), 2);
    assert!(result.tree.is_none());
    let off = ambiguous.parse("ab", &ParseOptions { elision_only: Some(false), ..no_auto() }).unwrap();
    assert!(off.ok);
    assert_eq!(off.stages[0].verdict, Some(Verdict::Resolved));
    let on = gencmu::load_dialect_sources(
        single("%ambiguity-resolution greedy\n%rule text s | s \"b\" %rule s \"a\" [\"b\"]"),
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
        "## Sounds <?stage sounds?>\n\n- [s](s.md) <?grammar?>\n\n## Words <?stage words?>\n\n- [w](w.md) <?grammar?>\n".to_string(),
    );
    sources.insert(
        "s.md".to_string(),
        grammar("%ambiguity-resolution greedy\n%rule text [c] ...\n%rule c \"s\" </s/> | \"a\" </a/> | \"u\" </u/> | \"m\" </m/> | \"i\" </i/> | \"space\" </./> %emits $"),
    );
    sources.insert(
        "w.md".to_string(),
        grammar(
            "%ambiguity-resolution lazy\n%rule text [piece] ...\n%rule piece word | /./\n%rule word /m/ /i/ | @sa-su /s/ /a/ | @sa-su /s/ /u/",
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
    // `until` before `words` skips the probe.
    let early =
        dialect.parse("mi sa", &ParseOptions { until: Some("sounds".into()), ..ParseOptions::default() }).unwrap();
    assert!(early.ok);
    assert_eq!(early.stages.len(), 1);
}

#[test]
fn silent_parts_are_neither_emitted_nor_heard() {
    let mut sources = BTreeMap::new();
    sources.insert(
        "p.md".to_string(),
        "## One <?stage one?>\n\n- [f](f.md) <?grammar?>\n\n## Two <?stage two?>\n\n- [g](g.md) <?grammar?>\n\n## Three <?stage three?>\n\n- [h](h.md) <?grammar?>\n"
            .to_string(),
    );
    sources.insert(
        "f.md".to_string(),
        grammar(
            "%ambiguity-resolution greedy\n%rule text [c] ...\n%rule c \"a\" </a/> | \"b\" </b/> | \"space\" </./> %emits $",
        ),
    );
    sources.insert(
        "g.md".to_string(),
        grammar(
            "%ambiguity-resolution greedy\n%rule text [unit] ...\n%rule unit pair <\"U\"> | /./ %emits $\n%rule pair $a(letter) $b(letter) %emits $a <>, $b\n%rule letter /a/ | /b/",
        ),
    );
    sources.insert("h.md".to_string(), grammar("%ambiguity-resolution greedy\n%rule text [U | /./] ..."));
    let dialect = gencmu::load_dialect_sources(sources, "p.md").unwrap();
    let result = dialect.parse("ab ba", &no_auto()).unwrap();
    assert!(result.ok, "{}", gencmu::to_json(&result));
    let output = result.stages[1].output.as_ref().unwrap();
    let heard: Vec<_> = output.iter().map(|token| token.phonemes.as_deref().unwrap_or("?")).collect();
    // The silent first letter of each pair is not heard, and the pause
    // sounds as a space (engine §5).
    assert_eq!(heard, ["b", " ", "a"]);
    assert_eq!(output[0].text, "ab");
}

#[test]
fn rejections_say_where_and_what() {
    let dialect =
        gencmu::load_dialect_sources(single("%ambiguity-resolution greedy\n%rule text \"a\" \"b\""), "p.md").unwrap();
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
    assert_eq!(error.expected[0].terminal, "b");
    assert_eq!(error.expected[0].rules, ["text"]);
    assert_eq!(result.stages[0].verdict, None);
    assert!(result.stages[0].output.is_none());
    assert!(!error.to_string().is_empty());
}

#[test]
fn positions_are_code_points() {
    let dialect = gencmu::load_dialect_sources(
        single("%ambiguity-resolution greedy\n%rule text [c] ... %rule c \"other\" | \"alpha\" %emits $"),
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
    assert!(json.starts_with("{\"format\":1,\"ok\":true"));

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
            gencmu::load_dialect_sources(single("%ambiguity-resolution greedy\n%rule text text \"a\" | \"a\""), "p.md")
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
            single("%ambiguity-resolution greedy\n%rule text text p | p\n%rule p A B <\"ONE\"> | A B <\"TWO\">"),
            "p.md",
        )
        .unwrap();
        let tokens: Vec<gencmu::InputToken> = (0..6000)
            .map(|index| gencmu::InputToken {
                text: if index % 2 == 0 { "a".into() } else { "b".into() },
                tags: [(if index % 2 == 0 { "A" } else { "B" }.to_string(), true)].into_iter().collect(),
                phonemes: None,
            })
            .collect();
        let started = std::time::Instant::now();
        let result = dialect.parse_tokens(&tokens, &no_auto()).unwrap();
        eprintln!("6000 tokens with 3000 independent ties in {:?}", started.elapsed());
        assert!(result.ok);
        assert_eq!(result.stages[0].verdict, Some(Verdict::Tie));
        assert!(result.stages[0].tied.is_some());
        let _ = gencmu::to_json(&result);
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

    // A DOM from the cache is checked too, rather than trusted.
    let mut sources = single("%ambiguity-resolution greedy\n%rule text A");
    let refs: Vec<String> = (0..64).map(|index| format!("{{\"ref\":\"A{index}\"}}")).collect();
    let dom = format!(
        "{{\"format\":3,\"rules\":[{{\"name\":\"text\",\"op\":\"define\",\"alternatives\":[{{\"guards\":[],\"expr\":{{\"and\":[{}]}}}}],\"conditions\":[],\"at\":[4,1]}}],\"directives\":[{{\"name\":\"ambiguity-resolution\",\"args\":[\"greedy\"],\"at\":[3,1]}}]}}",
        refs.join(",")
    );
    let compiled = format!(
        "{{\"format\":3,\"bootstrap\":\"{}\",\"documents\":{{\"g.md\":{{\"hash\":\"{}\",\"dom\":{dom}}}}}}}",
        gencmu::tools::bootstrap_hash(),
        gencmu::tools::fnv1a64(&sources["g.md"])
    );
    sources.insert("compiled.json".to_string(), compiled);
    // It is not a DOM the reader could give, so it is a cache miss, and
    // the document itself is read.
    let dialect = gencmu::load_dialect_sources(sources, "p.md").expect("the document read instead");
    assert!(dialect.parse("A", &no_auto()).unwrap().ok);
}

#[test]
fn a_corrupt_cache_is_a_miss_not_an_abort() {
    small_stack(|| {
        let text = "%ambiguity-resolution greedy\n%rule text \"a\"";
        let hash = gencmu::tools::fnv1a64(&grammar(text));
        let deep_dom = format!("{}{{\"empty\":true}}{}", "{\"optional\":".repeat(10_000), "}".repeat(10_000));
        for compiled in [
            format!("{}{}", "[".repeat(10_000), "]".repeat(10_000)),
            format!(
                "{{\"format\":3,\"bootstrap\":\"{}\",\"documents\":{{\"g.md\":{{\"hash\":\"{hash}\",\"dom\":{deep_dom}}}}}}}",
                gencmu::tools::bootstrap_hash()
            ),
            format!(
                "{{\"format\":3,\"bootstrap\":\"{}\",\"documents\":{{\"g.md\":{{\"hash\":\"{hash}\",\"dom\":{{\"rules\":7}}}}}}}}",
                gencmu::tools::bootstrap_hash()
            ),
            "not JSON".to_string(),
        ] {
            let mut sources = single(text);
            sources.insert("compiled.json".to_string(), compiled);
            let dialect = gencmu::load_dialect_sources(sources, "p.md").expect("read through the notation instead");
            assert!(dialect.parse("a", &no_auto()).unwrap().ok);
        }
    });
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
