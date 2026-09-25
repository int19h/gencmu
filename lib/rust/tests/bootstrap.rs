//! The fixpoint of the bootstrap, and the precompiled DOMs (engine §8).

mod common;

use std::collections::BTreeMap;

use common::{parse_json, repository, Value};

fn grammars() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("grammars")
}

fn read(path: &str) -> String {
    std::fs::read_to_string(grammars().join(path)).unwrap_or_else(|error| panic!("{path}: {error}"))
}

/// Reading the notation's own documents with the bootstrap reproduces the
/// bootstrap exactly.
#[test]
fn bootstrap_is_a_fixpoint() {
    let bootstrap = parse_json(&read("notation/bootstrap.json")).expect("bootstrap.json");
    let mut documents = 0;
    for stage in bootstrap.get("stages").expect("stages").array() {
        for document in stage.get("documents").expect("documents").array() {
            let path = document.get("path").and_then(Value::str).expect("a path");
            let started = std::time::Instant::now();
            let json =
                gencmu::tools::read_grammar_document(&read(path)).unwrap_or_else(|error| panic!("{path}: {error}"));
            eprintln!("read {path} through the notation in {:?}", started.elapsed());
            let fresh = parse_json(&json).expect("a DOM");
            assert!(&fresh == document.get("dom").expect("a DOM"), "{path} does not reproduce the bootstrap:\n{json}");
            documents += 1;
        }
    }
    assert_eq!(documents, 2);
}

/// The crate's grammars are the repository's, as `tools/sync.js` copies them.
#[test]
fn the_grammar_copy_is_current() {
    for path in [
        "compiled.json",
        "unicode.txt",
        "notation/bootstrap.json",
        "notation/lexical.md",
        "notation/syntax.md",
        "dialects/notation.md",
    ] {
        let original =
            std::fs::read_to_string(repository().join("grammars").join(path)).expect("the repository's grammars");
        assert!(original == read(path), "lib/rust/grammars/{path} is out of date; run node tools/sync.js");
    }
}

/// `compiled.json` agrees with a fresh reading of every document it lists.
#[test]
fn compiled_doms_match_a_fresh_reading() {
    let compiled = parse_json(&read("compiled.json")).expect("compiled.json");
    assert_eq!(compiled.get("format"), Some(&Value::Number(5.0)));
    assert_eq!(compiled.get("bootstrap").and_then(Value::str), Some(gencmu::tools::bootstrap_hash().as_str()));
    let documents = compiled.get("documents").expect("documents").object().to_vec();
    assert!(!documents.is_empty());
    // Each document is read on a thread of its own: the Lojban grammars
    // are slow to read through the notation in a debug build.
    let threads: Vec<_> = documents
        .into_iter()
        .map(|(path, entry)| {
            std::thread::spawn(move || {
                let text = read(&path);
                assert_eq!(
                    entry.get("hash").and_then(Value::str),
                    Some(gencmu::tools::fnv1a64(&text).as_str()),
                    "{path}"
                );
                let fresh = parse_json(&gencmu::tools::read_grammar_document(&text).expect("a DOM")).expect("JSON");
                assert!(&fresh == entry.get("dom").expect("a DOM"), "{path} differs from its compiled DOM");
            })
        })
        .collect();
    for thread in threads {
        thread.join().expect("a document matches");
    }
}

fn bundled_sources(compiled: Option<&str>) -> BTreeMap<String, String> {
    let mut sources = BTreeMap::new();
    for path in
        ["unicode.txt", "notation/bootstrap.json", "notation/lexical.md", "notation/syntax.md", "dialects/notation.md"]
    {
        sources.insert(path.to_string(), read(path));
    }
    sources.insert("compiled.json".to_string(), compiled.map_or_else(|| read("compiled.json"), str::to_string));
    sources
}

/// Parsing works the same with the cache used and with it bypassed.
#[test]
fn parsing_with_and_without_the_cache() {
    let started = std::time::Instant::now();
    let cached = gencmu::load_dialect("notation").expect("the notation dialect");
    let with_cache = started.elapsed();
    let started = std::time::Instant::now();
    let empty = r#"{"format":5,"bootstrap":"0000000000000000","documents":{}}"#;
    let fresh =
        gencmu::load_dialect_sources(bundled_sources(Some(empty)), "dialects/notation.md").expect("a fresh load");
    let without_cache = started.elapsed();
    eprintln!("loading the notation dialect: {with_cache:?} with the cache, {without_cache:?} without");
    let also_cached =
        gencmu::load_dialect_sources(bundled_sources(None), "dialects/notation.md").expect("a cached load");
    for text in [
        "%rule text [piece] ... %rule piece word | \"x\" </x/> %emits $",
        "%ambiguity-resolution greedy elision-only\n%rule a $x(b) <\"T\" ∪ ($x ⟹ tags($x, c))> %conditions ¬matches(tail($x), d), $x",
        "%rule broken",
    ] {
        let options = gencmu::ParseOptions::default();
        let a = gencmu::to_json(&cached.parse(text, &options).expect("a parse"));
        let b = gencmu::to_json(&fresh.parse(text, &options).expect("a parse"));
        let c = gencmu::to_json(&also_cached.parse(text, &options).expect("a parse"));
        assert_eq!(a, b, "{text}");
        assert_eq!(a, c, "{text}");
    }
}
