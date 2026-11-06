//! Structural targets and forest queries (engine §3.10 and §4.3).
use gencmu::{InputToken, ParseOptions};

fn parse(grammar: &str, input: &[(&str, &str)]) -> gencmu::ParseResult {
    let source = format!("```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n{grammar}\n```\n");
    let pipeline = gencmu::load_pipeline_sources([("p.md", source)], "p.md").unwrap();
    let tokens: Vec<_> = input
        .iter()
        .map(|(text, tag)| InputToken {
            text: (*text).into(),
            tags: [(*tag).into()].into_iter().collect(),
            ..Default::default()
        })
        .collect();
    pipeline.parse_tokens(&tokens, &ParseOptions::default()).unwrap()
}

#[test]
fn body_queries_preserve_tests_and_outer_modes() {
    // Engine §4.3: an anonymous target keeps every test and the sole remainder.
    for (body, accepts) in [
        ("A B", true),
        ("A=\"a\" B", true),
        ("A=\"x\" B", false),
        ("\"a\" B", true),
        ("A …", true),
        ("… B", true),
        ("… A", false),
        ("[A] B", true),
        ("A ≻ B", false),
        ("_ B", true),
    ] {
        let grammar = format!("%rule text {{_}}\n%conditions $.parse({body})");
        let result = parse(&grammar, &[("a", "A"), ("b", "B")]);
        assert_eq!(result.ok, accepts, "{body}: {:?}", result.error);
    }
}

#[test]
fn parse_only_tag_has_a_helper() {
    // Engine §3.10: a user tag needs a helper even without an old query form.
    assert!(parse("%rule text A\n%conditions $.parse(A)", &[("a", "A")]).ok);
    assert!(!parse("%rule text A\n%conditions $.parse(B)", &[("a", "A")]).ok);
}

#[test]
fn old_and_new_queries_share_the_active_target() {
    // Engine §4.3: equivalent query spellings cannot escape recursive-query rejection.
    let result = parse("%rule text A\n%conditions $.matches(a)\n%rule a A\n%conditions $.parse(a …)", &[("a", "A")]);
    assert_eq!(result.error.unwrap().kind, gencmu::ParseErrorKind::Grammar);
}
