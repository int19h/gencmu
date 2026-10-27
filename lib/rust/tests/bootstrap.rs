//! The fixpoint of the bootstrap, and the preparsed DOMs (engine §8).

mod common;

use std::collections::BTreeMap;

use common::{find_places, parse_json, position_of, repository, same, substitute, Value};
use gencmu::tools::DOM_FORMAT;

fn grammars() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("grammars")
}

fn read(path: &str) -> String {
    std::fs::read_to_string(grammars().parent().unwrap().join(path)).unwrap_or_else(|error| panic!("{path}: {error}"))
}

/// Loading the notation's pipeline with the bootstrap, every document read
/// through the notation, reproduces the bootstrap's stages exactly: their
/// names and their runs of one document's items (engine §8).
#[test]
fn bootstrap_is_a_fixpoint() {
    let bootstrap = parse_json(&read("data/preparsed/gencmu.json")).expect("bootstrap.json");
    let started = std::time::Instant::now();
    let json = gencmu::tools::splice_bundled_pipeline("grammars/gencmu/jbogenbau/pipeline.md", false)
        .unwrap_or_else(|error| panic!("grammars/gencmu/jbogenbau/pipeline.md: {error}"));
    eprintln!("spliced the notation's pipeline through the notation in {:?}", started.elapsed());
    let spliced = parse_json(&json).expect("the spliced pipeline");
    assert_eq!(spliced.get("format"), bootstrap.get("format"));
    let stages = spliced.get("stages").expect("stages");
    let entries = bootstrap.get("documents").expect("documents");
    let expected_names: Vec<_> = entries
        .get("grammars/gencmu/jbogenbau/pipeline.md")
        .unwrap()
        .get("dom")
        .unwrap()
        .get("directives")
        .unwrap()
        .array()
        .iter()
        .filter(|d| d.get("name").and_then(Value::str) == Some("stage"))
        .map(|d| &d.get("args").unwrap().array()[0])
        .collect();
    assert_eq!(stages.array().iter().map(|s| s.get("name").unwrap()).collect::<Vec<_>>(), expected_names);
    for stage in stages.array() {
        for document in stage.get("documents").unwrap().array() {
            let path = document.get("path").unwrap().str().unwrap();
            same(entries.get(path).unwrap().get("dom").unwrap(), document.get("dom").unwrap(), path).unwrap();
        }
    }
    for (path, entry) in entries.object() {
        let fresh = gencmu::tools::read_grammar_document(&read(path), path).unwrap();
        same(entry.get("dom").unwrap(), &parse_json(&fresh).unwrap(), path).unwrap();
    }
    let documents: usize =
        stages.array().iter().map(|stage| stage.get("documents").expect("documents").array().len()).sum();
    assert_eq!(documents, 2);
}

/// Every bundled dialect splices to the same stages and features with the
/// preparsed DOMs of `data/preparsed/lojban.json` and without them.
#[test]
fn dialects_splice_the_same_with_and_without_the_cache() {
    let mut names = Vec::new();
    for family in ["gencmu", "lojban"] {
        let entries = parse_json(&read(&format!("data/preparsed/{family}.json"))).expect("the family entries");
        names.extend(
            entries.get("documents").unwrap().object().iter().filter_map(|(path, _)| {
                path.strip_prefix("grammars/")?.strip_suffix("/pipeline.md").map(str::to_owned)
            }),
        );
    }
    names.sort();
    assert!(names.len() >= 5, "{names:?}");
    // Each dialect on a thread of its own: reading the Lojban grammars
    // through the notation is slow.
    let threads: Vec<_> = names
        .into_iter()
        .map(|name| {
            std::thread::spawn(move || {
                let path = format!("grammars/{name}/pipeline.md");
                let cached = gencmu::tools::splice_bundled_pipeline(&path, true).expect("a cached splice");
                let fresh = gencmu::tools::splice_bundled_pipeline(&path, false).expect("a fresh splice");
                assert!(cached == fresh, "{path} splices differently without data/preparsed/lojban.json");
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
        "data/preparsed/lojban.json",
        "data/unicode/unicode.txt",
        "data/preparsed/gencmu.json",
        "grammars/gencmu/jbogenbau/lexical.md",
        "grammars/gencmu/jbogenbau/syntax.md",
        "grammars/gencmu/jbogenbau/pipeline.md",
    ] {
        let original = std::fs::read_to_string(repository().join(path)).expect("the repository's grammars");
        assert!(original == read(path), "lib/rust/grammars/{path} is out of date; run node tools/sync.js");
    }
}

/// `data/preparsed/lojban.json` agrees with a fresh reading of every document it lists.
#[test]
fn preparsed_doms_match_a_fresh_reading() {
    let preparsed = parse_json(&read("data/preparsed/lojban.json")).expect("data/preparsed/lojban.json");
    assert_eq!(preparsed.get("format"), Some(&Value::Number(DOM_FORMAT as f64)));
    assert_eq!(preparsed.get("bootstrap").and_then(Value::str), Some(gencmu::tools::bootstrap_hash().as_str()));
    assert_eq!(
        preparsed.get("unicode").and_then(Value::str),
        Some(gencmu::tools::fnv1a64(&read("data/unicode/unicode.txt")).as_str())
    );
    let documents = preparsed.get("documents").expect("documents").object().to_vec();
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
                let fresh =
                    parse_json(&gencmu::tools::read_grammar_document(&text, &path).expect("a DOM")).expect("JSON");
                same(entry.get("dom").expect("a DOM"), &fresh, &path)
                    .unwrap_or_else(|problem| panic!("{path} differs from its preparsed DOM: {problem}"));
            })
        })
        .collect();
    for thread in threads {
        thread.join().expect("a document matches");
    }
}

fn bundled_sources(cached: bool) -> BTreeMap<String, String> {
    let mut sources = BTreeMap::new();
    for path in [
        "data/unicode/unicode.txt",
        "data/unicode/unicode-properties.txt",
        "data/preparsed/gencmu.json",
        "grammars/gencmu/jbogenbau/lexical.md",
        "grammars/gencmu/jbogenbau/syntax.md",
        "grammars/gencmu/jbogenbau/pipeline.md",
    ] {
        sources.insert(path.to_string(), read(path));
    }
    if !cached {
        let hash = gencmu::tools::fnv1a64(&read("data/unicode/unicode.txt"));
        let text = sources.get_mut("data/preparsed/gencmu.json").unwrap();
        *text = text.replacen(&format!("\"unicode\":\"{hash}\""), "\"unicode\":\"0000000000000000\"", 1);
    }
    sources
}

/// Parsing works the same with the cache used and with it bypassed.
#[test]
fn parsing_with_and_without_the_cache() {
    let started = std::time::Instant::now();
    let cached = gencmu::load_dialect("gencmu/jbogenbau").expect("the notation dialect");
    let with_cache = started.elapsed();
    let started = std::time::Instant::now();
    let fresh = gencmu::load_dialect_sources(bundled_sources(false), "grammars/gencmu/jbogenbau/pipeline.md")
        .expect("a fresh load");
    let without_cache = started.elapsed();
    eprintln!("loading the notation dialect: {with_cache:?} with the cache, {without_cache:?} without");
    let also_cached = gencmu::load_dialect_sources(bundled_sources(true), "grammars/gencmu/jbogenbau/pipeline.md")
        .expect("a cached load");
    for (text, accepted) in [
        ("%rule text [{piece}] {... A / B} [+KU 🆓] %rule piece word | \"x\" :: Sound-x %emits $", true),
        ("%ambiguity-resolution greedy elision-only\n%rule a $x:b :: \"T\" ∪ ($x ⟹ $x.tags(c)) %conditions ¬$x.tokens-after-first.matches(d), $x", true),
        ("%rule broken", false),
    ] {
        let options = gencmu::ParseOptions::default();
        let result = cached.parse(text, &options).expect("a parse");
        assert_eq!(result.ok, accepted, "{text}: {:?}", result.error);
        let a = gencmu::to_json(&result);
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
%const $K A ∪ B
%redefine-const $K A ∪ B ∪ ∅
%classifier lex
  f? "mi" ∈ KOhA
  ¬g? "do" ∉ KOhA
%implies A ∩ B ⟹ C ∖ D
%rule text :: U ∪ ($x ∧ $x.source-text.classify(lex) ⊆ V ⟹ W)
  | f? h! $x:A $y:LE="la" [C | $z:D] {E} {E / [C]} [+KU 🆓] [+KEI (A | B)] (F & G) "a".."z" _General_Category_Letter Sound-a H UI<¬B> :: T ∪ $K
  | g? text-tail
  %conditions , ($x.source-text = "ok" ∨ $y.starts-input) ⟹ ¬$x.first-token.matches(text) ∧ $y, $x.tokens-after-first.begins(text), $y.source-text ∈ "a.b".split(".")
  %emits $x ($y) :: $x.tags, ε :: Y
%rule text-tail
  ε
  %erased
%rule chain
  {... A / B}
%redefine-rule text-tail
  🆓
%extend-rule text-tail
  "b"
%rule 🆓
  "c"
```
"#;

/// Loads a dialect whose one document is `document`, read with `bootstrap`
/// in place of the bundled one.
fn load_with_bootstrap(bootstrap: String, document: &str) -> Result<gencmu::Dialect, gencmu::Error> {
    let sources = [
        ("p.md", "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string()),
        ("g.md", document.to_string()),
        ("data/preparsed/gencmu.json", bootstrap),
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
    let bootstrap = read("data/preparsed/gencmu.json");
    if let Err(error) = load_with_bootstrap(bootstrap.clone(), EVERY_CONSTRUCT) {
        panic!("the bundled bootstrap reads the document: {error}");
    }
    // The syntax document is the bootstrap's last, and only its rules are
    // renamed.
    let start = bootstrap.find(r#""grammars/gencmu/jbogenbau/syntax.md":"#).expect("the syntax document");
    let syntax = parse_json(&bootstrap).expect("bootstrap.json");
    let names: Vec<String> = syntax
        .get("documents")
        .unwrap()
        .get("grammars/gencmu/jbogenbau/syntax.md")
        .unwrap()
        .get("dom")
        .unwrap()
        .get("rules")
        .unwrap()
        .array()
        .iter()
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
    let bundled = read("data/preparsed/gencmu.json");
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

#[test]
fn a_guard_after_an_empty_wrapper_reports_its_first_token() {
    fn field<'a>(value: &'a mut Value, name: &str) -> &'a mut Value {
        let Value::Object(fields) = value else { panic!("object") };
        &mut fields.iter_mut().find(|(key, _)| key == name).unwrap().1
    }
    let mut bootstrap = parse_json(&read("data/preparsed/gencmu.json")).unwrap();
    let Value::Object(documents) = field(&mut bootstrap, "documents") else { panic!("documents") };
    for (_, document) in documents {
        let Value::Array(rules) = field(field(document, "dom"), "rules") else { panic!("rules") };
        let mut padding = false;
        for rule in rules.iter_mut() {
            match rule.get("name").and_then(Value::str) {
                Some("feature-character") => {
                    let Value::Array(alternatives) = field(rule, "alternatives") else { panic!("alternatives") };
                    alternatives.push(parse_json(r#"{"guards":[],"expr":{"literal":{"string":"_"}}}"#).unwrap());
                }
                Some("guard")
                    if rule.get("alternatives").unwrap().array()[0]
                        .get("expr")
                        .unwrap()
                        .get("ref")
                        .and_then(Value::str)
                        == Some("Guard") =>
                {
                    let Value::Array(alternatives) = field(rule, "alternatives") else { panic!("alternatives") };
                    *field(&mut alternatives[0], "expr") =
                        parse_json(r#"{"seq":[{"ref":"padding"},{"ref":"Guard"}]}"#).unwrap();
                    padding = true;
                }
                _ => {}
            }
        }
        if padding {
            rules.push(parse_json(r#"{"name":"padding","op":"define","flags":[],"alternatives":[{"guards":[],"expr":{"empty":true}}],"conditions":[],"at":[1,1]}"#).unwrap());
        }
    }
    let error = load_with_bootstrap(
        bootstrap.to_text(),
        "```jbogenbau\n%ambiguity-resolution greedy\n%rule text bad_name? A\n```\n",
    )
    .unwrap_err();
    assert_eq!((error.line, error.column), (Some(3), Some(12)), "{error}");
}
