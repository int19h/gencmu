use super::*;
use std::sync::Arc;
fn j(s: &str) -> Json {
    crate::json::parse(s).unwrap()
}
fn unicode() -> Unicode {
    Unicode::parse(crate::loader::bundled("unicode.txt").unwrap()).unwrap()
}
fn read(s: &str) -> Dom {
    let json = crate::tools::read_grammar_document(&format!("```jbogenbau\n{s}\n```\n")).unwrap();
    dom::dom_from_json(&crate::json::parse(&json).unwrap(), &unicode()).unwrap()
}
fn grammar(s: &str) -> crate::grammar::StageGrammar {
    let d = read(&format!("%ambiguity-resolution greedy\n{s}"));
    crate::grammar::stitch("main", &[(Arc::from("test.md"), Arc::new(d))], &unicode()).unwrap()
}
fn names(g: &crate::grammar::StageGrammar) -> Vec<String> {
    g.rules.iter().map(|r| r.name.clone()).collect()
}
fn audit(g: &crate::grammar::StageGrammar) -> Json {
    g.parameters.audit(&names(g))
}
fn expression(r: &Json) -> &Json {
    get(&list(get(r, "alternatives"))[0], "expr")
}
fn replace_expression(r: &mut Json, expr: Json) {
    let mut alts = list(get(r, "alternatives")).to_vec();
    set(&mut alts[0], "expr", expr);
    set(r, "alternatives", Json::Arr(alts));
}
#[test]
fn rule_order_and_rebinding() {
    let g=grammar("%rule atom(@X) @X\n%rule text atom(\"a\") named\n%rule named = atom(\"b\")\n%redefine-rule named = atom(\"c\")");
    assert_eq!(names(&g), ["text", "named", "atom(\"a\")", "atom(\"b\")"]);
    assert_eq!(
        list(get(&audit(&g), "instances")).iter().map(|n| text(get(n, "name"))).collect::<Vec<_>>(),
        ["named", "atom(\"a\")", "atom(\"b\")"]
    );
}
#[test]
fn closed_inner_calls() {
    let g = grammar("%rule atom(@X) @X\n%rule outer(@X) atom(@X) @X\n%rule text outer(atom(\"a\")) atom(\"b\")");
    assert_eq!(names(&g), ["text", "atom(\"a\")", "outer(atom(\"a\"))", "atom(\"b\")", "atom(atom(\"a\"))"]);
}
#[test]
fn pinned_public_edits() {
    let g=grammar("%rule atom(@X) @X\n%rule text item atom(\"a\")\n%rule item = atom(\"a\")\n%extend-rule item \"b\"\n%redefine-rule item = atom(\"c\")\n%extend-rule item \"d\"");
    for (name, want) in [("atom(\"a\")", vec!["a", "b"]), ("item", vec!["c", "d"])] {
        let values: Vec<_> = g.rules[g.index[name]]
            .alternatives
            .iter()
            .map(|a| match &a.alternative.expr {
                dom::Expr::Literal(dom::Term::Str(s)) => s.clone(),
                dom::Expr::Terminal(s) => crate::tags::string_value(s).unwrap(),
                e => panic!("literal expected: {e:?}"),
            })
            .collect();
        assert_eq!(values, want);
    }
}
#[test]
fn template_flags() {
    let g=grammar("%rule(fewest) atom(@X) @X\n%rule text atom(\"a\") atom(\"b\")\n%redefine-rule atom(\"a\") \"c\"\n%extend-rule atom(@Y) \"d\"");
    assert!(g.rules[g.index["atom(\"a\")"]].flags.is_empty());
    assert_eq!(g.rules[g.index["atom(\"b\")"]].flags, ["fewest"]);
    let a = audit(&g);
    let events = list(get(&list(get(&a, "instances"))[0], "events"));
    assert_eq!(events.len(), 3);
    assert_eq!(events.iter().map(|e| text(get(e, "scope"))).collect::<Vec<_>>(), ["template", "instance", "template"]);
    assert!(list(get(&events[2], "flagsAfter")).is_empty());
}
#[test]
fn nominal_constants_and_group_normalization() {
    let g = grammar("%const $A \"a\"\n%rule atom(@X) @X\n%rule text atom(\"a\") atom((\"a\")) atom($A)");
    assert_eq!(names(&g), ["text", "atom(\"a\")", "atom($A)"]);
}
#[test]
fn named_instances_have_no_wrapper() {
    let case=crate::test_common::parse_json(r#"{"grammar":"%rule atom(@X) @X\n%rule text atom(\"a\")\n%rule named = atom(\"a\")","input":"a","expect":{"result":{"ok":true,"tree":{"rule":"text","children":[{"rule":"named","children":[{"kind":"token"}]}]}}}}"#).unwrap();
    crate::test_common::run_engine_case(&case).unwrap();
}
#[test]
fn audit_notes() {
    let g=grammar("%rule atom(@X) @X\n%rule unused(@A,@B) @A\n%rule outer(@X) @X\n%rule text outer(named) outer(atom(\"a\"))\n%rule named = atom(\"a\")");
    let a = audit(&g);
    assert_eq!(
        get(&list(get(&a, "templates"))[1], "notes"),
        &Json::Arr(vec![
            obj([("kind", string("unused-parameter")), ("parameter", string("B"))]),
            obj([("kind", string("uncalled-template"))])
        ])
    );
    for i in list(get(&a, "instances")).iter().filter(|i| text(get(i, "template")) == "outer") {
        assert_eq!(text(get(&list(get(i, "notes"))[0], "kind")), "argument-alias-twin")
    }
}
#[test]
fn canonical_arguments() {
    let n = j(r#"{"call":"f","args":[{"string":"a\n\t\u0301"},{"concat":[{"string":"a"},{"string":""}]}],"at":[1,1]}"#);
    assert_eq!(print::canonical(&n, &unicode()), "f(\"a\\n\\t\\u0301\", \"a\" ++ \"\")");
    let n = j(r#"{"body":{"seq":[{"ref":"a"},{"seq":[{"ref":"b"},{"ref":"c"}]}]}}"#);
    assert_eq!(print::canonical(&n, &unicode()), "(a (b c))");
}
#[test]
fn supplied_dom_closure_and_scope() {
    let d = read("%rule atom(@X) @X\n%rule text atom(\"a\")");
    let raw = crate::json::parse(&dom::dom_to_json(&d)).unwrap();
    for bad in [
        obj([("param", string("X"))]),
        obj([("param", string("Y")), ("at", position((1, 1)))]),
        obj([("param", string("X")), ("at", position((0, 1)))]),
    ] {
        let mut m = raw.clone();
        let mut rs = list(get(&m, "rules")).to_vec();
        replace_expression(&mut rs[0], bad);
        set(&mut m, "rules", Json::Arr(rs));
        assert!(dom::dom_from_json(&m, &unicode()).is_err());
    }
    for bad in [
        j(r#"{"capture":"x"}"#),
        j(r#"{"method":"value","receiver":{"capture":""},"args":[]}"#),
        j(r#"{"body":{"capture":"x","expr":{"ref":"A"}}}"#),
    ] {
        let mut m = raw.clone();
        let mut rs = list(get(&m, "rules")).to_vec();
        let mut expr = expression(&rs[1]).clone();
        set(&mut expr, "args", Json::Arr(vec![bad]));
        replace_expression(&mut rs[1], expr);
        set(&mut m, "rules", Json::Arr(rs));
        assert!(dom::dom_from_json(&m, &unicode()).is_err());
    }
}
#[test]
fn supplied_body_normalizes() {
    let mut d = read("%rule atom(@X) @X\n%rule text atom(\"a\") atom(\"a\")");
    let r = d.unresolved.get_mut(&(3, 1)).unwrap();
    let mut expr = expression(r).clone();
    let mut seq = list(get(&expr, "seq")).to_vec();
    set(&mut seq[1], "args", j(r#"[{"body":{"literal":{"string":"a"}}}]"#));
    set(&mut expr, "seq", Json::Arr(seq));
    replace_expression(r, expr);
    let x = expand(&[(Arc::from("test.md"), Arc::new(d))], &unicode()).unwrap().unwrap();
    assert_eq!(x.records.instances.len(), 1);
}
#[test]
fn ordinary_documents_keep_identity() {
    let docs = vec![(Arc::from("plain.md"), Arc::new(read("%rule text \"a\"\n%extend-rule text \"b\"")))];
    assert!(expand(&docs, &unicode()).unwrap().is_none());
}
#[test]
fn ordinary_edit_history() {
    let g = grammar("%rule atom(@X) @X\n%rule text \"a\"\n%extend-rule text \"b\"\n%redefine-rule text \"c\"");
    assert_eq!(g.changes.iter().map(|c| c.extension).collect::<Vec<_>>(), [true, false]);
}
#[test]
fn deep_bodies() {
    for supplied in [false, true] {
        let mut d = read("%rule atom(@X) @X\n%rule text atom(\"a\")");
        let mut expr = if supplied {
            obj([("literal", obj([("string", string("a"))]))])
        } else {
            obj([("param", string("X")), ("at", position((2, 16)))])
        };
        for _ in 0..250 {
            expr = obj([("seq", Json::Arr(vec![expr, obj([("empty", Json::Bool(true))])]))])
        }
        if supplied {
            let r = d.unresolved.get_mut(&(3, 1)).unwrap();
            let mut call = expression(r).clone();
            set(&mut call, "args", Json::Arr(vec![obj([("body", expr)])]));
            replace_expression(r, call)
        } else {
            replace_expression(d.unresolved.get_mut(&(2, 1)).unwrap(), expr)
        }
        let raw = crate::json::parse(&dom::dom_to_json(&d)).unwrap();
        assert!(dom::dom_problem(&raw, &unicode()).is_none());
        let x = expand(&[(Arc::from("deep.md"), Arc::new(d))], &unicode()).unwrap().unwrap();
        assert_eq!(x.records.instances.len(), 1);
    }
}
#[test]
fn elidable_owner() {
    let g = grammar("%rule tail(@T) \"a\" [+@T]\n%rule text tail(KU)");
    let l = crate::lower::lower(&g, &Default::default(), Arc::default()).unwrap();
    let rules: Vec<_> = l.rules.iter().filter(|r| r.elided.as_deref() == Some("KU")).collect();
    assert!(!rules.is_empty());
    assert!(rules.iter().all(|r| r.name == "tail(KU)"));
}
#[test]
fn uncalled_source_validation() {
    for (source, message) in [
        ("%rule unused(@X) $x:A $x:@X", "capture name used twice"),
        ("%rule unused(@X) $x:(A @X)", "malformed capture"),
        ("%rule unused(@X) @X %emits $x :: @X, $x", "lists a capture twice"),
        ("%rule unused(@X) @X %emits ($y) $x ($y) :: @X", "lists a capture twice"),
        ("%rule unused(@X) @X :: _L ∪ @X", "engine tag"),
        ("%rule unused(@X) @X :: $.tags ∪ @X", "own tags"),
        ("%rule unused(@X) @X := @X %erased", "erased"),
        ("%rule unused(@X) [+| @X]", "one sequence"),
    ] {
        let error = crate::tools::read_grammar_document(&format!("```jbogenbau\n{source}\n%rule text \"a\"\n```\n"))
            .unwrap_err();
        assert!(error.message.contains(message), "{source}: {error}")
    }
    for source in ["%rule unused(@X) $x:A | $x:@X", "%rule unused(@X) $x:@X %emits $x :: @X", "%rule unused(@X) [+@X]"]
    {
        grammar(&format!("{source}\n%rule text \"a\""));
    }
}
#[test]
fn pattern_test_operands() {
    for grammar in [
        "%rule use(@V) $x:_ %conditions $x ≅ #(_=@V)\n%rule text = use(\"a\")",
        "%rule use(@T) $x:_ %conditions $x ≅ #(_<@T>)\n%rule text = use(_L)",
        "%rule use(@X) @X<_L>\n%rule text = use(_)",
    ] {
        let c = format!(
            "{{\"grammar\":{},\"input\":\"a\",\"expect\":{{\"result\":{{\"ok\":true}}}}}}",
            string(grammar).to_json()
        );
        crate::test_common::run_engine_case(&crate::test_common::parse_json(&c).unwrap()).unwrap();
    }
    let source = "%rule atom(@X) @X\n%rule unused(@X) @X %conditions $ ≅ #(atom(\"a\")=\"a\")\n%rule text \"a\"";
    assert!(crate::tools::read_grammar_document(&format!("```jbogenbau\n{source}\n```\n")).is_err());
}
#[test]
fn ranked_locations_do_not_change_dom() {
    let mut d = read("%rule pair(@X,@Y) @X @Y\n%rule text pair(\"a\",\"b\") (\"c\" ≻ \"d\") :: ∅");
    let before = dom::dom_to_json(&d);
    let token = crate::result::Token {
        text: String::new(),
        value: "≻".into(),
        image: String::new(),
        tags: Default::default(),
        span: 0..1,
        source: 0..1,
        inserted_by: None,
        before: Vec::new(),
        after: Vec::new(),
    };
    crate::ranked::restore_locations(&mut d, &[token], &|_| (3, 42));
    assert_eq!(dom::dom_to_json(&d), before);
    let x = expand(&[(Arc::from("locations.md"), Arc::new(d))], &unicode()).unwrap().unwrap();
    let r = x.documents.iter().flat_map(|(_, d)| &d.rules).find(|r| r.name == "text").unwrap();
    assert_eq!(r.alternatives[0].ranked_locations["/seq/1"], (3, 42));
}
#[test]
fn ranked_argument_location() {
    let mut d = read("%rule choice(@X) @X :: ∅\n%rule text choice((\"a\" ≻ \"b\"))");
    let token = crate::result::Token {
        text: String::new(),
        value: "≻".into(),
        image: String::new(),
        tags: Default::default(),
        span: 0..1,
        source: 0..1,
        inserted_by: None,
        before: Vec::new(),
        after: Vec::new(),
    };
    crate::ranked::restore_locations(&mut d, &[token], &|_| (3, 29));
    let x = expand(&[(Arc::from("locations.md"), Arc::new(d))], &unicode()).unwrap().unwrap();
    let r = x.documents.iter().flat_map(|(_, d)| &d.rules).find(|r| r.name == "choice((\"a\" ≻ \"b\"))").unwrap();
    assert_eq!(r.alternatives[0].ranked_locations[""], (3, 29));
}

#[test]
fn deep_source_groups_need_no_recursive_conversion() {
    std::thread::Builder::new()
        .stack_size(2 * 1024 * 1024)
        .spawn(|| {
            let source = format!(
                "```jbogenbau\n%rule atom(@X) {}@X{}\n%rule text = atom(\"a\")\n```\n",
                "(".repeat(4000),
                ")".repeat(4000)
            );
            crate::tools::read_grammar_document(&source).unwrap();
        })
        .unwrap()
        .join()
        .unwrap();
}
#[test]
fn deep_source_constructors_report_the_dom_limit() {
    std::thread::Builder::new()
        .stack_size(2 * 1024 * 1024)
        .spawn(|| {
            let cases = [
                format!("%rule atom(@X) {}@X{}", "[".repeat(2000), "]".repeat(2000)),
                format!("%rule atom(@X) @X\n%rule text {}\"a\"{}", "atom(".repeat(2000), ")".repeat(2000)),
            ];
            for text in cases {
                let source = format!("```jbogenbau\n{text}\n```\n");
                let error = crate::tools::read_grammar_document(&source).unwrap_err();
                assert_eq!(error.message, "an expression, term or condition is nested more than 256 deep");
            }
        })
        .unwrap()
        .join()
        .unwrap();
}
#[test]
fn ordinary_ranked_locations_survive_template_expansion() {
    let mut d = read("%rule unused(@X) @X\n%rule text (\"a\" ≻ \"b\") :: ∅");
    let token = crate::result::Token {
        text: String::new(),
        value: "≻".into(),
        image: String::new(),
        tags: Default::default(),
        span: 0..1,
        source: 0..1,
        inserted_by: None,
        before: Vec::new(),
        after: Vec::new(),
    };
    crate::ranked::restore_locations(&mut d, &[token], &|_| (3, 21));
    let x = expand(&[(Arc::from("locations.md"), Arc::new(d))], &unicode()).unwrap().unwrap();
    let r = x.documents.iter().flat_map(|(_, d)| &d.rules).find(|r| r.name == "text").unwrap();
    assert_eq!(r.alternatives[0].ranked_locations[""], (3, 21));
}

#[test]
fn nested_alias_twins_follow_expanded_order() {
    for source in ["%rule atom(@X) @X\n%rule outer(@X) @X\n%rule public \"a\"\n%rule text outer((named named)) outer((atom(\"a\") atom(\"a\"))) outer((named atom(\"a\"))) outer((atom(\"a\") named))\n%rule named = atom(\"a\")\n%redefine-rule public = outer((atom(\"a\") named))","%rule atom(@X) @X\n%rule outer(@P) $x:named %conditions $x ≅ @P\n%rule text outer(#named) outer(#(atom(\"a\")))\n%rule named = atom(\"a\")"] {
  let a=audit(&grammar(source));let instances:Vec<_>=list(get(&a,"instances")).iter().filter(|i|text(get(i,"template"))=="outer").collect();
  assert_eq!(instances.len(),if source.contains("public"){4}else{2});
  for (index,instance) in instances.iter().enumerate() {
   let names:Vec<_>=instances.iter().enumerate().filter(|(other,_)|*other!=index).map(|(_,i)|get(i,"name").clone()).collect();
   assert_eq!(get(instance,"notes"),&Json::Arr(vec![obj([("kind",string("argument-alias-twin")),("instances",Json::Arr(names))])]));
  }
 }
}

#[test]
fn unresolved_writer_ignores_object_member_order() {
    let mut d = read("%rule tag(@R) A<@R> %emits $ :: $.tags\n%rule text tag(<B ¬C>)");
    let expected = dom::dom_to_json(&d);
    for raw in d.unresolved.values_mut() {
        *raw = map_nodes(raw, |mut n| {
            if let Json::Obj(fields) = &mut n {
                fields.reverse();
            }
            n
        });
    }
    assert_eq!(dom::dom_to_json(&d), expected);
}

#[test]
fn shared_parameter_structure() {
    let cases = j(include_str!("../../../../tests/parameter-structure.json"));
    let uni = unicode();
    for case in list(&cases) {
        let name = text(get(case, "name"));
        let raw = if let Some(dom) = case.get("dom") {
            dom.clone()
        } else {
            j(&dom::dom_to_json(&read(text(get(case, "grammar")))))
        };
        let d = dom::dom_from_json(&raw, &uni).unwrap_or_else(|e| panic!("{name}: {e}"));
        if let Some(arg) = case.get("argument") {
            let rules = list(get(&raw, "rules"));
            assert_eq!(&list(get(expression(rules.last().unwrap()), "args"))[0], arg, "{name}");
        }
        let x =
            expand(&[(Arc::from("review.md"), Arc::new(d))], &uni).unwrap_or_else(|e| panic!("{name}: {e:?}")).unwrap();
        if let Some(order) = case.get("order") {
            assert_eq!(x.order, list(order).iter().map(|n| text(n).to_string()).collect::<Vec<_>>(), "{name}");
        }
        if let Some(count) = case.get("instances") {
            assert_eq!(x.records.instances.len(), count.as_int().unwrap() as usize, "{name}");
        }
        if let Some(flags) = case.get("flags").and_then(Json::as_object) {
            let g = grammar(text(get(case, "grammar")));
            for (name, flags) in flags {
                assert_eq!(
                    g.rules[g.index[name]].flags,
                    list(flags).iter().map(|n| text(n).to_string()).collect::<Vec<_>>()
                );
            }
        }
    }
}

#[test]
fn supplied_dom_depth_does_not_use_the_call_stack() {
    std::thread::Builder::new()
        .stack_size(2 * 1024 * 1024)
        .spawn(|| {
            let uni = unicode();
            let mut raw = j(&dom::dom_to_json(&read("%rule use(@X) @X")));
            let mut expr = obj([("param", string("X")), ("at", position((1, 1)))]);
            for _ in 0..20_000 {
                expr = obj([("optional", expr)]);
            }
            let Json::Obj(ref mut fields) = raw else { unreachable!() };
            let Json::Arr(rules) = &mut fields.iter_mut().find(|(k, _)| k == "rules").unwrap().1 else {
                unreachable!()
            };
            let Json::Obj(ref mut fields) = rules[0] else { unreachable!() };
            let Json::Arr(alts) = &mut fields.iter_mut().find(|(k, _)| k == "alternatives").unwrap().1 else {
                unreachable!()
            };
            set(&mut alts[0], "expr", expr);
            assert_eq!(dom::dom_problem(&raw, &uni), Some("nested too deeply"));
        })
        .unwrap()
        .join()
        .unwrap();
}
