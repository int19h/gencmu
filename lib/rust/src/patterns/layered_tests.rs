use super::*;

#[test]
fn layered_typed_dom_round_trips() {
    let input = crate::json::parse(r#"{"name":"a","exact":true,"children":[{"choice":[[{"child":{"terminal":"A","at":[1,2]}}],[{"siblings":true}]]}],"at":[1,1]}"#).unwrap();
    let pattern = Pattern::from_layered_json(&input).unwrap();
    let mut out = String::new();
    pattern.write_layered(&mut out);
    let output = crate::json::parse(&out).unwrap();
    assert_eq!(crate::parameters::canonical_source(&output), crate::parameters::canonical_source(&input));
}

#[test]
fn deep_source_reference_and_type_walks_use_explicit_stacks() {
    let mut pattern = Pattern::Constant("P".into(), (2, 7));
    for i in 0..60_000 {
        pattern = if i % 2 == 0 {
            Pattern::Path("descendant".into(), Box::new(pattern))
        } else {
            Pattern::Node(
                Box::new(Pattern::Any),
                false,
                Some(Children::Sequence(vec![Children::Node(Box::new(pattern))])),
            )
        };
    }
    let mut references = Vec::new();
    let term = dom::Term::Pattern(Box::new(pattern));
    dom::references_in_term(&term, &mut references);
    assert_eq!(references, vec![("P", (2, 7))]);
    let dom::Term::Pattern(pattern) = &term else { unreachable!() };
    assert!(pattern.type_fault(&|_| dom::Type::String).is_none());
    let fault = pattern.type_fault(&|_| dom::Type::Tags).unwrap();
    assert_eq!(fault.at, Some((2, 7)));
}
