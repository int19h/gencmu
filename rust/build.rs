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
}
