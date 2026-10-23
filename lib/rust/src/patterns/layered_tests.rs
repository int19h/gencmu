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
