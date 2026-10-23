//! Raw reader probes share the candidate recognition grammar with JavaScript.
use super::*;
use crate::parameters::{self as p, get, list, text};
use crate::result::{Node, NodeKind};

fn candidate() -> Dialect {
    let recognition =
        json::parse(include_str!("../../../../tests/fixtures/layered-patterns/recognition.json")).unwrap();
    let mut bootstrap = json::parse(bundled("notation/bootstrap.json").unwrap()).unwrap();
    let Json::Arr(stages) = bootstrap_mut(&mut bootstrap, "stages") else { unreachable!() };
    for stage in stages {
        let name = text(get(stage, "name")).to_string();
        let Json::Arr(documents) = bootstrap_mut(stage, "documents") else { unreachable!() };
        for document in documents {
            let dom = bootstrap_mut(document, "dom");
            let Json::Arr(rules) = bootstrap_mut(dom, "rules") else { unreachable!() };
            if name == "lexical" {
                *rules.iter_mut().find(|rule| text(get(rule, "name")) == "symbol").unwrap() =
                    get(&recognition, "lexical").clone();
            } else if name == "syntax" {
                rules.retain(|rule| {
                    let name = text(get(rule, "name"));
                    !name.starts_with("pattern-") && !name.starts_with("child-")
                });
                rules.extend(list(get(&recognition, "syntax")).iter().cloned());
            }
        }
    }
    let unicode = Arc::new(Unicode::parse(bundled("unicode.txt").unwrap()).unwrap());
    build_notation_dialect(&bootstrap.to_json(), unicode).unwrap()
}
fn bootstrap_mut<'a>(value: &'a mut Json, key: &str) -> &'a mut Json {
    let Json::Obj(fields) = value else { panic!("expected an object") };
    &mut fields.iter_mut().find(|(name, _)| name == key).unwrap().1
}

#[derive(Debug)]
enum Read {
    Pattern(Json),
    Error(String, (usize, usize)),
}
fn read(notation: &Dialect, prefix: &str, pattern: &str) -> Read {
    let source = format!("```jbogenbau\n{prefix}{pattern}\n```");
    let grammar = grammar_text(&source).unwrap();
    let result = notation.parse_chars(grammar.chars.clone(), &ParseOptions::default()).unwrap();
    if let Some(error) = result.error {
        assert_eq!(error.kind, ParseErrorKind::Rejected, "{pattern}: {error:?}");
        return Read::Error(error.stage.unwrap(), grammar.position(error.source.unwrap().start));
    }
    let stage = result.stages.last().unwrap();
    let mut pending = vec![result.tree.as_ref().unwrap()];
    let mut literal: Option<&Node> = None;
    while let Some(node) = pending.pop() {
        if node.kind == NodeKind::Rule && node.rule.as_deref() == Some("pattern-literal") {
            literal = Some(node);
            break;
        }
        pending.extend(node.children.iter().rev());
    }
    let position = |index| grammar.position(index);
    let reader = Reader {
        parameter_state: Default::default(),
        unicode: &notation.unicode,
        defer_emission: false,
        feature_context: Default::default(),
        tokens: &stage.input,
        captures: Default::default(),
        braces: Default::default(),
        marked: Default::default(),
        position: &position,
        closed_for: Default::default(),
        in_recipe: Default::default(),
    };
    match reader.layered_term_for_test(literal.expect("a pattern literal in the recognition tree")) {
        Ok(term) => Read::Pattern(get(&term, "pattern").clone()),
        Err(error) => Read::Error("reader".into(), (error.line.unwrap(), error.column.unwrap())),
    }
}
fn term(node: &Json) -> String {
    for key in ["name", "terminal", "tag"] {
        if let Some(value) = node.get(key) {
            return value.as_str().unwrap().to_string();
        }
    }
    for (key, prefix) in [("param", "@"), ("const", "$")] {
        if let Some(value) = node.get(key) {
            return format!("{prefix}{}", value.as_str().unwrap());
        }
    }
    if let Some(value) = node.get("string") {
        return value.to_json();
    }
    if let Some(value) = node.get("pattern") {
        return crate::patterns::shapes::text(value, &term, true);
    }
    if let Some(value) = node.get("call") {
        return format!(
            "{}({})",
            value.as_str().unwrap(),
            list(get(node, "args")).iter().map(term).collect::<Vec<_>>().join(", ")
        );
    }
    if let Some(value) = node.get("requirements") {
        return format!(
            "<{}>",
            list(value)
                .iter()
                .map(|r| format!(
                    "{}{}",
                    if get(r, "negated").as_bool() == Some(true) { "¬" } else { "" },
                    term(get(r, "value"))
                ))
                .collect::<Vec<_>>()
                .join(" ")
        );
    }
    panic!("an unknown reader fixture term: {node:?}")
}
fn pattern<'a>(result: &'a Read, case: &Json) -> &'a Json {
    let Read::Pattern(value) = result else { panic!("{}: {result:?}", text(get(case, "description"))) };
    value
}
#[test]
fn shared_layered_reader() {
    let notation = candidate();
    let cases = json::parse(include_str!("../../../../tests/layered-pattern-reader.json")).unwrap();
    let names = list(get(&cases, "parameters"))
        .iter()
        .map(|name| format!("@{}", name.as_str().unwrap()))
        .collect::<Vec<_>>()
        .join(", ");
    let prefix = format!("%rule probe({names}) A\n%conditions $ ≅ ");
    let start = "%conditions $ ≅ ".chars().count() + 1;
    for case in list(get(&cases, "cases")) {
        let result = read(&notation, &prefix, text(get(case, "source")));
        if let Some(expected) = case.get("pattern") {
            let value = pattern(&result, case);
            assert_eq!(p::identity(value), p::identity(expected), "{}", text(get(case, "description")));
            let text = crate::patterns::shapes::text(value, &term, true);
            let again = read(&notation, &prefix, &text);
            assert_eq!(p::identity(pattern(&again, case)), p::identity(expected), "{text}");
        } else {
            let expected = get(case, "error");
            let Read::Error(phase, at) = result else { panic!("{}: accepted", text(get(case, "description"))) };
            assert_eq!(phase, text(get(expected, "phase")), "{}", text(get(case, "description")));
            assert_eq!(
                at,
                (3, start + get(expected, "offset").as_int().unwrap() as usize),
                "{}",
                text(get(case, "description"))
            );
        }
    }
    let printing = json::parse(include_str!("../../../../tests/layered-patterns.json")).unwrap();
    for case in list(get(&printing, "printing")) {
        let result = read(&notation, &prefix, text(get(case, "text")));
        let value = pattern(&result, case);
        assert_eq!(p::identity(value), p::identity(get(case, "pattern")), "{}", text(get(case, "description")));
        assert_eq!(crate::patterns::shapes::text(value, &term, true), text(get(case, "text")));
    }
    for kind in ["groups", "siblings"] {
        use crate::work::{budget, counted, reset, Work};
        let mut baseline = None;
        for size in [128, 256, 512] {
            let body = if kind == "groups" {
                format!("{}a{}", "(".repeat(size), ")".repeat(size))
            } else {
                vec!["a"; size].join(" ")
            };
            let source = format!("#« {body} »");
            reset();
            budget(Work::Walked, baseline.map_or(1000000, |count| count * 5));
            let result = read(&notation, &prefix, &source);
            let count = counted(Work::Walked);
            reset();
            let Read::Pattern(value) = result else { panic!("{kind} {size}: {result:?}") };
            assert_eq!(list(get(&value, "children")).len(), if kind == "groups" { 1 } else { size });
            baseline.get_or_insert(count);
        }
    }

    for (source, offset) in [("#·a« b »", 2), ("#·a", 2), ("#\"a\"", 1)] {
        let Read::Pattern(value) = read(&notation, &prefix, source) else { panic!("{source}: refused") };
        assert_eq!(p::at(&value), Some((3, start + offset)));
        if source == "#·a« b »" {
            assert_eq!(p::at(get(&list(get(&value, "children"))[0], "child")), Some((3, start + 5)));
        }
    }
}
