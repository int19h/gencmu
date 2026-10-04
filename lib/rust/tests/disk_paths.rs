//! A dialect loaded from disk knows each document by its absolute path, so
//! an error names the file the same way from any working directory, and in
//! every library. The test changes the working directory of its process, so
//! it is the only test of its binary.

use std::path::{Path, PathBuf};

fn temporary(name: &str) -> PathBuf {
    let directory = std::env::temp_dir().join(format!("gencmu-paths-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).expect("a temporary directory");
    directory
}

fn write(root: &Path, files: &[(&str, &str)]) {
    for (name, text) in files {
        let file = root.join(name);
        std::fs::create_dir_all(file.parent().expect("a directory")).expect("the directory");
        std::fs::write(file, text).expect("the document");
    }
}

/// `to` relative to `from`, both absolute.
fn relative(from: &Path, to: &Path) -> PathBuf {
    let from: Vec<_> = from.components().collect();
    let to: Vec<_> = to.components().collect();
    let common = from.iter().zip(&to).take_while(|(a, b)| a == b).count();
    let mut path = PathBuf::new();
    for _ in common..from.len() {
        path.push("..");
    }
    for part in &to[common..] {
        path.push(part.as_os_str());
    }
    path
}

#[test]
fn errors_name_the_absolute_path_from_another_working_directory() {
    let included = temporary("included");
    let pipeline = temporary("pipeline");
    let elsewhere = temporary("elsewhere");
    write(
        &included,
        &[
            ("p.md", "```jbogenbau\n%stage main\n%include \"sub/g.md\"\n```\n"),
            ("sub/g.md", "```jbogenbau\n%ambiguity-resolution greedy\n%rule text (\n```\n"),
        ],
    );
    write(&pipeline, &[("p.md", "```jbogenbau\n%stage main\n%rule text (\n```\n")]);
    let home = std::env::current_dir().expect("the working directory");
    std::env::set_current_dir(&elsewhere).expect("another working directory");
    let mut failures = Vec::new();
    for (root, bad) in [(&included, "sub/g.md"), (&pipeline, "p.md")] {
        let expected = root.join(bad).to_string_lossy().into_owned();
        for given in [root.join("p.md"), relative(&elsewhere, &root.join("p.md"))] {
            match gencmu::load_dialect_file(&given) {
                Ok(_) => failures.push(format!("{}: loaded", given.display())),
                Err(error) => {
                    if error.document.as_deref() != Some(expected.as_str())
                        || !error.to_string().starts_with(&format!("{expected}:"))
                    {
                        failures.push(format!("{}: {:?} is not {expected}: {error}", given.display(), error.document));
                    }
                }
            }
        }
    }
    std::env::set_current_dir(home).expect("the working directory again");
    for directory in [included, pipeline, elsewhere] {
        let _ = std::fs::remove_dir_all(directory);
    }
    assert!(failures.is_empty(), "{failures:#?}");
}
