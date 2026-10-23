use super::*;

fn text(j: &Json, key: &str) -> String {
    j.get(key).unwrap().as_str().unwrap().to_owned()
}
fn items(m: &mut Machine, array: &Json) -> Vec<PatternItem> {
    array
        .as_array()
        .unwrap()
        .iter()
        .map(|j| {
            if let Some(p) = j.get("child") {
                PatternItem::Child(pattern(m, p))
            } else if j.get("siblings").is_some() {
                PatternItem::Siblings
            } else if let Some(body) = j.get("optional") {
                PatternItem::Choice(vec![items(m, body), vec![]])
            } else if let Some(body) = j.get("repeat") {
                PatternItem::Repeat(items(m, body), j.get("separator").map(|s| items(m, s)))
            } else {
                PatternItem::Choice(
                    j.get("choice").unwrap().as_array().unwrap().iter().map(|arm| items(m, arm)).collect(),
                )
            }
        })
        .collect()
}
fn pattern(m: &mut Machine, j: &Json) -> usize {
    let key = format!("layered:{}", j.to_json());
    if let Some(&id) = m.ids.get(&key) {
        return id;
    }
    let p = if let Some(path) = j.get("path") {
        Predicate::Path(path.as_str().unwrap().to_owned(), pattern(m, j.get("pattern").unwrap()))
    } else if let Some(key) = ["union", "intersection", "difference"].iter().find(|k| j.get(k).is_some()) {
        let mut parts = j.get(key).unwrap().as_array().unwrap().iter().map(|p| pattern(m, p)).collect::<Vec<_>>();
        match *key {
            "union" => Predicate::Union(parts),
            "intersection" => Predicate::Intersection(parts),
            _ => {
                let b = parts.pop().unwrap();
                Predicate::Difference(parts.pop().unwrap(), b)
            }
        }
    } else {
        let test = if j.get("name").is_some() {
            NodeTest::Name(text(j, "name"))
        } else if j.get("terminal").is_some() {
            NodeTest::Terminal(text(j, "terminal"))
        } else if j.get("test").is_some() {
            let mut tests = Vec::new();
            let mut base = j;
            while base.get("test").is_some() {
                let op = text(base, "test");
                let value = if op == "tags" {
                    let requirements = base
                        .get("requirements")
                        .unwrap()
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|r| {
                            let tags = r.get("value").unwrap().get("set").unwrap().as_array().unwrap();
                            let value =
                                Term::Union(tags.iter().map(|t| Term::Tag(t.as_str().unwrap().to_owned())).collect());
                            Arg::Term(if r.get("negated").unwrap().as_bool() == Some(true) {
                                Term::Call("forbid".into(), vec![Arg::Term(value)])
                            } else {
                                value
                            })
                        })
                        .collect();
                    Term::Call("requirements".into(), requirements)
                } else {
                    Term::Str(text(base.get("value").unwrap(), "string"))
                };
                tests.push((op, value));
                base = base.get("expr").unwrap();
            }
            NodeTest::Test(tests, text(base, "terminal"))
        } else {
            NodeTest::Any
        };
        let children = j.get("children").map(|list| {
            let list = items(m, list);
            m.sequence(&list)
        });
        Predicate::Node { test, exact: j.get("exact").and_then(Json::as_bool) == Some(true), children }
    };
    let id = m.predicates.len();
    m.predicates.push(p);
    m.ids.insert(key, id);
    id
}
fn observe(m: &mut Machine, tree: &Json) -> u32 {
    if tree.get("seal").is_some() {
        return m.sealed();
    }
    if tree.get("terminal").is_some() {
        let terminal = text(tree, "terminal");
        let value = text(tree, "value");
        let tags = tree
            .get("tags")
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t.as_str().unwrap().to_owned())
            .collect::<Vec<_>>();
        return m.node(None, m.empty, Some((&terminal, &value, &tags)));
    }
    let mut children = m.empty;
    for child in tree.get("children").unwrap().as_array().unwrap() {
        let child = observe(m, child);
        children = m.concat(children, child);
    }
    m.node(Some(&text(tree, "name")), children, None)
}
#[test]
fn shared_layered_matching() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/layered-patterns.json");
    let cases = crate::json::parse(&std::fs::read_to_string(path).unwrap()).unwrap();
    for case in cases.get("matching").unwrap().as_array().unwrap() {
        let mut id = 0;
        let mut m = Machine::build(|m| id = pattern(m, case.get("pattern").unwrap()));
        let state = observe(&mut m, case.get("tree").unwrap());
        let got = m.states[state as usize].bits.as_ref().is_some_and(|b| bit(b, id));
        assert_eq!(got, case.get("expected").unwrap().as_bool().unwrap(), "{}", text(case, "description"));
    }
}
#[test]
fn a_layered_repeat_retains_finite_states() {
    let pattern =
        crate::json::parse(r#"{"any":true,"children":[{"repeat":[{"child":{"terminal":"A","at":[1,1]}}]}]}"#).unwrap();
    let mut id = 0;
    let mut m = Machine::build(|m| id = super::layered_tests::pattern(m, &pattern));
    let a = m.node(None, m.empty, Some(("A", "a", &["A".into()])));
    let mut prefix = m.empty;
    for _ in 0..1000 {
        prefix = m.concat(prefix, a);
        let state = m.node(Some("list"), prefix, None);
        assert!(m.states[state as usize].bits.as_ref().is_some_and(|b| bit(b, id)));
    }
    assert!(m.states.len() < 10, "{} structural states", m.states.len());
}

fn fixture_term(n: &Json) -> String {
    for key in ["name", "terminal", "tag"] {
        if n.get(key).is_some() {
            return text(n, key);
        }
    }
    for (key, prefix) in [("param", "@"), ("const", "$")] {
        if n.get(key).is_some() {
            return format!("{prefix}{}", text(n, key));
        }
    }
    if n.get("call").is_some() {
        return format!(
            "{}({})",
            text(n, "call"),
            n.get("args").unwrap().as_array().unwrap().iter().map(fixture_term).collect::<Vec<_>>().join(", ")
        );
    }
    if let Some(p) = n.get("pattern") {
        return shapes::text(p, &fixture_term, true);
    }
    if let Some(s) = n.get("string") {
        return s.to_json();
    }
    if let Some(rs) = n.get("requirements").and_then(Json::as_array) {
        return format!(
            "<{}>",
            rs.iter()
                .map(|r| format!(
                    "{}{}",
                    if r.get("negated").and_then(Json::as_bool) == Some(true) { "¬" } else { "" },
                    fixture_term(r.get("value").unwrap())
                ))
                .collect::<Vec<_>>()
                .join(" ")
        );
    }
    panic!("unhandled fixture term {n:?}");
}
#[test]
fn shared_layered_shapes_and_printing() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/layered-patterns.json");
    let cases = crate::json::parse(&std::fs::read_to_string(path).unwrap()).unwrap();
    for case in cases.get("shapes").unwrap().as_array().unwrap() {
        let depth = case.get("depth").and_then(Json::as_int).unwrap_or(0) as usize;
        let problem =
            shapes::problem(case.get("pattern").unwrap(), &shapes::Inspection { depth, ..Default::default() });
        if let Some(expected) = case.get("problem").and_then(Json::as_str) {
            assert_eq!(problem.as_deref(), Some(expected), "{}", text(case, "description"));
        }
        assert_eq!(
            problem.is_none(),
            case.get("valid").unwrap().as_bool().unwrap(),
            "{}: {problem:?}",
            text(case, "description")
        );
    }
    for case in cases.get("printing").unwrap().as_array().unwrap() {
        assert_eq!(
            shapes::text(case.get("pattern").unwrap(), &fixture_term, true),
            text(case, "text"),
            "{}",
            text(case, "description")
        );
    }
}
#[test]
fn layered_depth_and_width() {
    fn object(fields: Vec<(&str, Json)>) -> Json {
        Json::Obj(fields.into_iter().map(|(k, v)| (k.into(), v)).collect())
    }
    let leaf = crate::json::parse(r#"{"name":"a","at":[1,1]}"#).unwrap();
    let mut p = leaf.clone();
    for _ in 0..256 {
        p = object(vec![("path", Json::Str("descendant".into())), ("pattern", p)]);
    }
    assert_eq!(shapes::problem(&p, &shapes::Inspection::default()), None);
    assert_eq!(shapes::text(&p, &fixture_term, true), format!("#({}⋮ a{}", "⋮ (".repeat(255), ")".repeat(256)));
    p = object(vec![("path", Json::Str("descendant".into())), ("pattern", p)]);
    assert_eq!(shapes::problem(&p, &shapes::Inspection::default()).as_deref(), Some("nested too deeply"));
    for (item, depth) in [(object(vec![("child", leaf)]), 254), (object(vec![("siblings", Json::Bool(true))]), 255)] {
        let p = object(vec![("any", Json::Bool(true)), ("children", Json::Arr(vec![item; 1000]))]);
        assert_eq!(shapes::problem(&p, &shapes::Inspection { depth, ..Default::default() }), None);
        assert_eq!(
            shapes::problem(&p, &shapes::Inspection { depth: depth + 1, ..Default::default() }).as_deref(),
            Some("nested too deeply")
        );
    }
    let child = crate::json::parse(r#"{"child":{"param":"X","at":[1,1]}}"#).unwrap();
    let items = object(vec![("optional", Json::Arr(vec![child; 150000]))]);
    let repeat = object(vec![("repeat", Json::Arr(vec![items]))]);
    let p = object(vec![("any", Json::Bool(true)), ("children", Json::Arr(vec![repeat]))]);
    assert_eq!(shapes::problem(&p, &shapes::Inspection::default()), None);
}

#[test]
fn layered_typed_dom_round_trips() {
    let cases = crate::json::parse(include_str!("../../../../tests/layered-patterns.json")).unwrap();
    for case in cases.get("printing").unwrap().as_array().unwrap() {
        let input = case.get("pattern").unwrap();
        if crate::parameters::unresolved(input) {
            continue;
        }
        let pattern = Pattern::from_layered_json(input).unwrap();
        let mut out = String::new();
        pattern.write_layered(&mut out);
        let output = crate::json::parse(&out).unwrap();
        assert_eq!(
            crate::parameters::canonical_source(&output),
            crate::parameters::canonical_source(input),
            "{}",
            text(case, "description")
        );
        assert!(pattern.problem().is_none(), "{}", text(case, "description"));
    }
    for case in cases.get("shapes").unwrap().as_array().unwrap() {
        let valid = case.get("valid").unwrap().as_bool().unwrap();
        let mut input = case.get("pattern").unwrap().clone();
        if valid && crate::parameters::unresolved(&input) {
            continue;
        }
        for _ in 0..case.get("depth").and_then(Json::as_int).unwrap_or(0) {
            input = crate::parameters::obj([("path", Json::Str("descendant".into())), ("pattern", input)]);
        }
        let result = Pattern::from_layered_json(&input);
        assert_eq!(result.is_ok(), valid, "{}: {result:?}", text(case, "description"));
    }
    let mut pattern = crate::json::parse(r#"{"any":true,"exact":true,"children":[]}"#).unwrap();
    for _ in 0..256 {
        pattern = crate::parameters::obj([("path", Json::Str("descendant".into())), ("pattern", pattern)]);
    }

    let mut term_pattern = crate::json::parse(r#"{"any":true,"exact":true,"children":[]}"#).unwrap();
    for _ in 0..255 {
        term_pattern = crate::parameters::obj([("path", Json::Str("descendant".into())), ("pattern", term_pattern)]);
    }
    let term = Term::Pattern(Box::new(Pattern::from_layered_json(&term_pattern).unwrap()));
    assert!(!crate::dom::term_too_deep(&term));
    let beyond = Term::Pattern(Box::new(Pattern::from_layered_json(&pattern).unwrap()));
    assert!(crate::dom::term_too_deep(&beyond));
    let typed = Pattern::from_layered_json(&pattern).unwrap();
    assert!(typed.problem().is_none());
    let deeper = crate::parameters::obj([("path", Json::Str("descendant".into())), ("pattern", pattern)]);
    assert_eq!(Pattern::from_layered_json(&deeper).unwrap_err(), "nested too deeply");
}

fn public_matching_fixture(node: &Json) -> Json {
    match node {
        Json::Arr(items) => Json::Arr(items.iter().map(public_matching_fixture).collect()),
        Json::Obj(fields) => Json::Obj(
            fields
                .iter()
                .map(|(key, value)| {
                    let result = if key == "requirements" {
                        Json::Arr(
                            value
                                .as_array()
                                .unwrap()
                                .iter()
                                .flat_map(|requirement| {
                                    let negative = requirement.get("negated").unwrap().clone();
                                    requirement
                                        .get("value")
                                        .unwrap()
                                        .get("set")
                                        .unwrap()
                                        .as_array()
                                        .unwrap()
                                        .iter()
                                        .map(move |tag| {
                                            crate::parameters::obj([
                                                ("negated", negative.clone()),
                                                ("value", crate::parameters::obj([("tag", tag.clone())])),
                                            ])
                                        })
                                })
                                .collect(),
                        )
                    } else {
                        public_matching_fixture(value)
                    };
                    (key.clone(), result)
                })
                .collect(),
        ),
        value => value.clone(),
    }
}
#[test]
fn typed_layered_dom_matches_the_shared_trees() {
    let cases = crate::json::parse(include_str!("../../../../tests/layered-patterns.json")).unwrap();
    for case in cases.get("matching").unwrap().as_array().unwrap() {
        let input = public_matching_fixture(case.get("pattern").unwrap());
        let pattern = Pattern::from_layered_json(&input).unwrap();
        let mut machine = Machine::new(std::slice::from_ref(&pattern));
        let state = observe(&mut machine, case.get("tree").unwrap());
        assert_eq!(
            machine.matches(state, &pattern),
            case.get("expected").unwrap().as_bool().unwrap(),
            "{}",
            text(case, "description")
        );
    }
}
