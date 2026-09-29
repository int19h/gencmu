//! A grammar document read from disk is strict UTF-8 (engine §1): bytes
//! that do not decode are a grammar error of that document, with no line or
//! column, found before any hash or compiled DOM.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use gencmu::{ErrorKind, ParseOptions};

const PIPELINE: &str = "# A dialect\n\n```jbogenbau\n%stage main\n%include \"g.md\"\n```\n";

fn grammar(rule: &str) -> String {
    format!("# A grammar\n\n```jbogenbau\n%ambiguity-resolution greedy\n{rule}\n```\n")
}

/// A document's text with bytes spliced in at the marker `@`.
fn with_bytes(text: &str, bytes: &[u8]) -> Vec<u8> {
    let (head, tail) = text.split_once('@').expect("a marker");
    [head.as_bytes(), bytes, tail.as_bytes()].concat()
}

/// A directory holding the documents, removed when it is dropped.
struct Directory(PathBuf);

impl Directory {
    fn new(files: &[(&str, Vec<u8>)]) -> Directory {
        static COUNT: AtomicUsize = AtomicUsize::new(0);
        let number = COUNT.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!("gencmu-utf8-{}-{number}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        for (name, bytes) in files {
            std::fs::write(root.join(name), bytes).unwrap();
        }
        Directory(root)
    }

    fn pipeline(&self) -> PathBuf {
        self.0.join("p.md")
    }
}

impl Drop for Directory {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).ok();
    }
}

fn no_auto() -> ParseOptions {
    ParseOptions { auto_features: false, ..ParseOptions::default() }
}

/// Invalid bytes: a stray continuation, a truncated sequence, an overlong
/// form, an encoded surrogate and a value above U+10FFFF.
const INVALID: [&[u8]; 6] = [b"\x80", b"\xe2\x82", b"\xc0\xaf", b"\xed\xa0\x80", b"\xf4\x90\x80\x80", b"\xff"];

#[test]
fn invalid_bytes_are_a_grammar_error_of_the_document() {
    let good = grammar("%rule text 'a'").into_bytes();
    type Files = Box<dyn Fn(&[u8]) -> Vec<(&'static str, Vec<u8>)>>;
    let places: Vec<(&str, Files, &str)> = vec![
        (
            "the pipeline's prose",
            Box::new({
                let good = good.clone();
                move |b| vec![("p.md", with_bytes(&format!("# A dialect @\n\n{PIPELINE}"), b)), ("g.md", good.clone())]
            }),
            "p.md",
        ),
        (
            "a comment of the pipeline",
            Box::new({
                let good = good.clone();
                move |b| {
                    let text = PIPELINE.replace("%stage main", "%stage main (* @ *)");
                    vec![("p.md", with_bytes(&text, b)), ("g.md", good.clone())]
                }
            }),
            "p.md",
        ),
        (
            "an included document's prose",
            Box::new(|b| {
                let text = format!("# A grammar @\n\n{}", grammar("%rule text 'a'"));
                vec![("p.md", PIPELINE.as_bytes().to_vec()), ("g.md", with_bytes(&text, b))]
            }),
            "g.md",
        ),
        (
            "a comment of an included document",
            Box::new(|b| {
                vec![
                    ("p.md", PIPELINE.as_bytes().to_vec()),
                    ("g.md", with_bytes(&grammar("%rule text 'a' (* @ *)"), b)),
                ]
            }),
            "g.md",
        ),
    ];
    for (place, files, bad) in &places {
        for bytes in INVALID {
            let directory = Directory::new(&files(bytes));
            let error = gencmu::load_dialect_file(directory.pipeline()).expect_err(place);
            assert_eq!(error.kind, ErrorKind::Grammar, "{place}: {error}");
            let document = error.document.as_deref().expect("a document");
            assert!(Path::new(document).ends_with(bad), "{place}: {document}");
            assert!(error.message.contains("not valid UTF-8"), "{place}: {error}");
            assert_eq!((error.line, error.column), (None, None), "{place}");
        }
    }
}

#[test]
fn fffd_supplementary_characters_and_a_byte_order_mark_decode_as_themselves() {
    let directory = Directory::new(&[
        ("p.md", format!("# A dialect \u{FFFD} \u{1F600}\n\n{PIPELINE}").into_bytes()),
        ("g.md", grammar("%rule text '\u{FFFD}' '\u{1F600}' '\u{10FFFD}' (* \u{FFFD} \u{1F600} *)").into_bytes()),
    ]);
    let dialect = gencmu::load_dialect_file(directory.pipeline()).expect("a dialect");
    assert!(dialect.parse("\u{FFFD}\u{1F600}\u{10FFFD}", &no_auto()).unwrap().ok);
    assert!(!dialect.parse("\u{FFFD}\u{1F600}", &no_auto()).unwrap().ok);
    // A byte order mark stays U+FEFF, so a fence after it opens no block.
    let fence = &PIPELINE[PIPELINE.find("```").unwrap()..];
    let marked = Directory::new(&[
        ("p.md", format!("\u{FEFF}{fence}").into_bytes()),
        ("g.md", grammar("%rule text 'a'").into_bytes()),
    ]);
    let error = gencmu::load_dialect_file(marked.pipeline()).expect_err("no block");
    assert!(error.message.contains("at least one %stage"), "{error}");
    let prose = Directory::new(&[
        ("p.md", format!("\u{FEFF}{PIPELINE}").into_bytes()),
        ("g.md", grammar("%rule text '\u{FEFF}'").into_bytes()),
    ]);
    assert!(gencmu::load_dialect_file(prose.pipeline()).unwrap().parse("\u{FEFF}", &no_auto()).unwrap().ok);
}
