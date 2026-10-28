//! Shared DOM cases for structural patterns and elidable tests.
#[test]
fn constant_cycles_report_the_dependency_path() {
    let declarations = [
        ("%const $A $B\n%const $B $C\n%const $C $A", "$A → $B → $C → $A"),
        (
            "%const $A $B\n%const $B $A\n%redefine-const $A $A",
            "$A [p.md:3:1] → $B [p.md:4:1] → $A [p.md:5:1] → $A [p.md:3:1]",
        ),
    ];
    for (declarations, path) in declarations {
        let source = format!("```jbogenbau\n%stage main\n{declarations}\n%rule text A\n```\n");
        let error = gencmu::load_pipeline_sources([("p.md", source.as_str())], "p.md").expect_err("a cycle");
        assert!(error.message.contains(path), "{error}");
        assert_eq!(error.document.as_deref(), Some("p.md"));
        assert!(error.line.is_some() && error.column.is_some(), "{error}");
    }
}
