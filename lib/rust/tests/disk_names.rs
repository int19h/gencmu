use gencmu::ErrorKind;
mod common;
use common::parse_json;

#[test]
fn selected_disk_names() {
    let cases = parse_json(include_str!("../../../tests/disk-names.json")).unwrap();
    let home = std::env::current_dir().unwrap();
    let root = std::env::temp_dir().join(format!("gencmu-disk-names-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    for case in cases.array() {
        for (path, text) in case.get("files").unwrap().object() {
            std::fs::write(root.join(path), text.str().unwrap()).unwrap();
        }
        std::env::set_current_dir(&root).unwrap();
        let result = gencmu::load_pipeline_file(root.join("p.md"));
        std::env::set_current_dir(&home).unwrap();
        let error = result.expect_err(case.get("description").unwrap().str().unwrap());
        assert_eq!(error.kind, ErrorKind::Grammar);
        assert_eq!(
            error.document.as_deref(),
            root.join(case.get("error").unwrap().get("document").unwrap().str().unwrap()).to_str()
        );
        assert_eq!(error.line, Some(case.get("error").unwrap().get("line").unwrap().number().unwrap() as usize));
        assert_eq!(error.column, Some(case.get("error").unwrap().get("column").unwrap().number().unwrap() as usize));
    }
    std::fs::remove_dir_all(root).unwrap();
}
