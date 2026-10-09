//! The places of the shared fixtures (`tests/README.md`, "Places in
//! fixtures"): the helpers of every library's runner agree with
//! `tests/places.json`.

mod common;

use common::{find_places, parse_json, repository, try_position_of, try_substitute, Value};

#[test]
fn places_agree_with_the_shared_cases() {
    let text = std::fs::read_to_string(repository().join("tests/places.json")).expect("the shared cases");
    let places = parse_json(&text).expect("JSON");
    for item in places.get("positions").expect("positions").array() {
        let text = item.get("text").and_then(Value::str).expect("text");
        let needle = item.get("needle").and_then(Value::str).expect("needle");
        let expected = match (item.get("line").and_then(Value::number), item.get("column").and_then(Value::number)) {
            (Some(line), Some(column)) => Some((line as usize, column as usize)),
            _ => None,
        };
        assert_eq!(try_position_of(text, needle).ok(), expected, "{needle:?} in {text:?}");
    }
    for item in places.get("substitutions").expect("substitutions").array() {
        let field = |key: &str| item.get(key).and_then(Value::str);
        let (text, find, replace) =
            (field("text").expect("text"), field("find").expect("find"), field("replace").expect("replace"));
        let count = item.get("places").and_then(Value::number).expect("places") as usize;
        assert_eq!(find_places(text, find).len(), count, "{find:?} in {text:?}");
        assert_eq!(try_substitute(text, find, replace).ok().as_deref(), field("expect"), "{find:?} in {text:?}");
    }
}
