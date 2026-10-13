//! Embeds the crate's copy of the grammars, `grammars/`, which
//! `tools/sync.js` generates from the repository's `grammars/`: every file
//! under it becomes one entry of `BUNDLED`, keyed by its `/`-separated path.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn collect(root: &Path, directory: &Path, files: &mut Vec<String>) {
    let mut entries: Vec<PathBuf> = fs::read_dir(directory)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", directory.display()))
        .map(|entry| entry.expect("a directory entry").path())
        // Hidden files, such as a desktop's .DS_Store, are not grammars.
        .filter(|path| !path.file_name().is_some_and(|name| name.to_string_lossy().starts_with('.')))
        .collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            collect(root, &path, files);
        } else {
            let relative = path.strip_prefix(root).expect("a path under the grammars");
            let parts: Vec<String> =
                relative.components().map(|part| part.as_os_str().to_string_lossy().into_owned()).collect();
            files.push(parts.join("/"));
        }
    }
}

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let root = manifest.join("grammars");
    println!("cargo:rerun-if-changed=grammars");
    let mut files = Vec::new();
    collect(&root, &root, &mut files);
    let mut code = String::from("/// Every bundled grammar file, by path relative to `grammars/`.\n");
    code.push_str("pub(crate) static BUNDLED: &[(&str, &str)] = &[\n");
    for file in &files {
        println!("cargo:rerun-if-changed=grammars/{file}");
        let absolute = root.join(file);
        code.push_str(&format!("    ({file:?}, include_str!({:?})),\n", absolute.to_string_lossy()));
    }
    code.push_str("];\n");
    let out = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR")).join("bundled.rs");
    fs::write(out, code).expect("write bundled.rs");
    shared_tests(&manifest, "engine");
    shared_tests(&manifest, "notation");
}

// Give each fixture a test in the standard harness. Published crates do
// not include repository fixtures or integration tests.
fn shared_tests(manifest: &Path, kind: &str) {
    let integration_test = manifest.join("tests").join(format!("{kind}.rs"));
    println!("cargo:rerun-if-changed={}", integration_test.display());
    if !integration_test.is_file() {
        return;
    }
    let root = manifest.join("../../tests").join(kind);
    println!("cargo:rerun-if-changed={}", root.display());
    let mut code = String::new();
    let mut names = std::collections::BTreeSet::new();
    if root.is_dir() {
        let mut files: Vec<_> = fs::read_dir(&root)
            .expect("shared cases")
            .map(|entry| entry.expect("a case entry").path())
            .filter(|path| path.extension().is_some_and(|extension| extension == "json"))
            .collect();
        files.sort();
        for file in files {
            let file_name = file.file_name().unwrap().to_str().expect("a UTF-8 case name");
            let name = file.file_stem().unwrap().to_str().unwrap().replace('-', "_").to_ascii_lowercase();
            assert!(names.insert(name.clone()), "duplicate test name: {name}");
            code.push_str(&format!("#[test]\nfn {kind}_case_{name}() {{ run_shared_case({file_name:?}); }}\n"));
        }
        code.push_str(&format!("const SHARED_CASE_COUNT: usize = {};\n", names.len()));
    }
    let out = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR")).join(format!("{kind}_cases.rs"));
    fs::write(out, code).expect("write shared tests");
}
