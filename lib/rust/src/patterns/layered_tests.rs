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
