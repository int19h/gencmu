//! The fixpoint of the bootstrap, and the precompiled DOMs (engine §8).

mod common;

use std::collections::BTreeMap;

use common::{find_places, parse_json, position_of, repository, substitute, Value};
use gencmu::tools::DOM_FORMAT;

fn grammars() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("grammars")
}

fn read(path: &str) -> String {
    std::fs::read_to_string(grammars().join(path)).unwrap_or_else(|error| panic!("{path}: {error}"))
}

/// Loading the notation's pipeline with the bootstrap, every document read
/// through the notation, reproduces the bootstrap's stages exactly: their
/// names and their runs of one document's items (engine §8).
#[test]
fn bootstrap_is_a_fixpoint() {
    let bootstrap = parse_json(&read("notation/bootstrap.json")).expect("bootstrap.json");
    let started = std::time::Instant::now();
    let json = gencmu::tools::splice_bundled_pipeline("dialects/notation.md", false)
        .unwrap_or_else(|error| panic!("dialects/notation.md: {error}"));
    eprintln!("spliced the notation's pipeline through the notation in {:?}", started.elapsed());
    let spliced = parse_json(&json).expect("the spliced pipeline");
    assert_eq!(spliced.get("format"), bootstrap.get("format"));
    let stages = spliced.get("stages").expect("stages");
    assert!(
        stages == bootstrap.get("stages").expect("stages"),
        "the notation does not reproduce the bootstrap:\n{json}"
    );
    let documents: usize =
        stages.array().iter().map(|stage| stage.get("documents").expect("documents").array().len()).sum();
    assert_eq!(documents, 2);
}

/// Every bundled dialect splices to the same stages and features with the
/// precompiled DOMs of `compiled.json` and without them.
#[test]
fn dialects_splice_the_same_with_and_without_the_cache() {
    let mut names: Vec<String> = std::fs::read_dir(grammars().join("dialects"))
        .expect("the bundled dialects")
        .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
        .filter_map(|name| name.strip_suffix(".md").map(str::to_string))
        .collect();
    names.sort();
    assert!(names.len() >= 5, "{names:?}");
    // Each dialect on a thread of its own: reading the Lojban grammars
    // through the notation is slow.
    let threads: Vec<_> = names
        .into_iter()
        .map(|name| {
            std::thread::spawn(move || {
                let path = format!("dialects/{name}.md");
                let cached = gencmu::tools::splice_bundled_pipeline(&path, true).expect("a cached splice");
                let fresh = gencmu::tools::splice_bundled_pipeline(&path, false).expect("a fresh splice");
                assert!(cached == fresh, "{path} splices differently without compiled.json");
                let spliced = parse_json(&cached).expect("JSON");
                assert!(!spliced.get("stages").expect("stages").array().is_empty(), "{path}");
            })
        })
        .collect();
    for thread in threads {
        thread.join().expect("a dialect splices the same");
    }
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
    assert_eq!(compiled.get("format"), Some(&Value::Number(DOM_FORMAT as f64)));
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
    let empty = r#"{"format":10,"bootstrap":"0000000000000000","documents":{}}"#;
    let fresh =
        gencmu::load_dialect_sources(bundled_sources(Some(empty)), "dialects/notation.md").expect("a fresh load");
    let without_cache = started.elapsed();
    eprintln!("loading the notation dialect: {with_cache:?} with the cache, {without_cache:?} without");
    let also_cached =
        gencmu::load_dialect_sources(bundled_sources(None), "dialects/notation.md").expect("a cached load");
    for text in [
        "%rule text [{piece}] {... A \\ B} [+KU #] %rule piece word | \"x\" </x/> %emits $",
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

/// A document that holds every construct of the notation, read with the
/// bootstrap of each test below.
const EVERY_CONSTRUCT: &str = r#"```jbogenbau
%ambiguity-resolution greedy
%features f g
%const $K ~A ∪ ~B
%redefine-const $K ~A ∪ ~B ∪ ∅
%classifier lex
  f? "mi" ∈ KOhA
  ¬g? "do" ∉ ~KOhA
%implies ~A ∩ ~B ⟹ ~C ∖ ~D
%rule text
  | f? h! $x(A) $y(LE="la") [C | $z(D)] {E} {E \ [C]} [+KU #] [++~KEI (A | B)] (F & G) 'a'..'z' '\p{L}' /a/ ~H UI∩(~B)=∅ <~T ∪ $K>
  | g? text-tail
  %tags ~U ∪ ($x ∧ classify(text($x), lex) ⊆ ~V ⟹ ~W)
  %conditions , (text($x) = "ok" ∨ initial($y)) ⟹ ¬matches(head($x), text) ∧ $y, begins(tail($x), text), text($y) ∈ split("a.b", ".")
  %emits $x <tags($x) ∩ tag(text($x))> ($y), ~Y
  %opaque
%rule text-tail
  ε
%rule chain
  {... A \ B}
%redefine-rule text-tail
  #
%extend-rule text-tail
  'b'
%rule #
  'c'
```
"#;

/// Loads a dialect whose one document is `document`, read with `bootstrap`
/// in place of the bundled one.
fn load_with_bootstrap(bootstrap: String, document: &str) -> Result<gencmu::Dialect, gencmu::Error> {
    let sources = [
        ("p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string()),
        ("g.md", document.to_string()),
        ("notation/bootstrap.json", bootstrap),
    ];
    gencmu::load_dialect_sources(sources, "p.md")
}

/// A caller can supply its own bootstrap (docs/api.md), whose notation can
/// give the reader a tree of another shape. Here each rule of the
/// notation's syntax has another name in turn, so that the tree lacks a
/// node the reader looks for, or holds one that it does not know. The
/// reader then gives an error of the grammar, and never panics.
#[test]
fn a_bootstrap_of_another_shape_is_an_error_and_never_a_panic() {
    let bootstrap = read("notation/bootstrap.json");
    if let Err(error) = load_with_bootstrap(bootstrap.clone(), EVERY_CONSTRUCT) {
        panic!("the bundled bootstrap reads the document: {error}");
    }
    // The syntax document is the bootstrap's last, and only its rules are
    // renamed.
    let start = bootstrap.find(r#""path":"notation/syntax.md""#).expect("the syntax document");
    let syntax = parse_json(&bootstrap).expect("bootstrap.json");
    let names: Vec<String> = syntax
        .get("stages")
        .expect("stages")
        .array()
        .iter()
        .flat_map(|stage| stage.get("documents").expect("documents").array().iter())
        .filter(|document| document.get("path").and_then(Value::str) == Some("notation/syntax.md"))
        .flat_map(|document| document.get("dom").expect("dom").get("rules").expect("rules").array().iter())
        .map(|rule| rule.get("name").and_then(Value::str).expect("a rule's name").to_string())
        .collect();
    assert!(names.iter().any(|name| name == "definer"), "{names:?}");
    let mut refused = Vec::new();
    for name in names.iter().filter(|name| *name != "text") {
        let (before, after) = bootstrap.split_at(start);
        let renamed = after
            .replace(&format!(r#""name":"{name}","op""#), &format!(r#""name":"{name}x","op""#))
            .replace(&format!(r#"{{"ref":"{name}"}}"#), &format!(r#"{{"ref":"{name}x"}}"#));
        match load_with_bootstrap(format!("{before}{renamed}"), EVERY_CONSTRUCT) {
            Ok(_) => {}
            Err(error) => {
                assert_eq!(error.kind, gencmu::ErrorKind::Grammar, "{name}: {error}");
                refused.push(name.as_str());
            }
        }
    }
    // A rule without its definer, among others.
    assert!(refused.contains(&"definer"), "{refused:?}");
}

/// Every library requires the bootstrap path on the shared construction errors.
#[test]
fn bootstrap_errors_name_the_bootstrap_document() {
    let text = std::fs::read_to_string(repository().join("tests/bootstrap-errors.json")).expect("the shared cases");
    let fixtures = parse_json(&text).expect("JSON");
    let bundled = read("notation/bootstrap.json");
    for item in fixtures.get("cases").expect("cases").array() {
        let description = item.get("description").and_then(Value::str).expect("description");
        let bootstrap = if let Some(text) = item.get("bootstrap").and_then(Value::str) {
            text.to_string()
        } else {
            let find = item.get("find").and_then(Value::str).expect("find");
            let replace = item.get("replace").and_then(Value::str).expect("replace");
            assert!(!find_places(&bundled, find).is_empty(), "{description}: the mutation is absent");
            substitute(&bundled, find, replace)
        };
        let error = match load_with_bootstrap(bootstrap, "%ambiguity-resolution greedy\n%rule text A\n") {
            Ok(_) => panic!("{description}: the malformed bootstrap loaded"),
            Err(error) => error,
        };
        assert_eq!(error.kind, gencmu::ErrorKind::Grammar, "{description}: {error}");
        assert_eq!(error.document.as_deref(), fixtures.get("document").and_then(Value::str), "{description}: {error}");
        let document = fixtures.get("document").and_then(Value::str).expect("document");
        assert!(error.message.starts_with(&format!("{document}:")), "{description}: {error}");
        assert_eq!(error.to_string(), error.message, "{description}");
        if let Some(context) = item.get("context").and_then(Value::str) {
            assert!(error.message.contains(context), "{description}: {error}");
        }
        if let Some(message) = item.get("message").and_then(Value::str) {
            assert!(error.message.contains(message), "{description}: {error}");
        }
        assert_eq!(error.stage.as_deref(), item.get("stage").and_then(Value::str), "{description}: {error}");
        // The place of the error, by the text that stands there in its
        // grammar document, or as the case gives it.
        let (line, column) = match item.get("at").and_then(Value::str) {
            Some(at) => {
                let context = item.get("context").and_then(Value::str).expect("context");
                let (line, column) = position_of(&read(context), at);
                (Some(line), Some(column))
            }
            None => (
                item.get("line").and_then(Value::number).map(|n| n as usize),
                item.get("column").and_then(Value::number).map(|n| n as usize),
            ),
        };
        assert_eq!(error.line, line, "{description}: {error}");
        assert_eq!(error.column, column, "{description}: {error}");
    }
}
