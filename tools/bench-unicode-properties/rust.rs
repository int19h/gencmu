//! Public API worker for the Unicode property performance gate.
use gencmu::{Dialect, GrammarValue as Json, ParseOptions};
use std::collections::BTreeMap;
use std::io::{self, BufRead, Write};
use std::time::Instant;

fn decode(value: &str) -> String {
    String::from_utf8(
        value
            .as_bytes()
            .chunks_exact(2)
            .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
            .collect(),
    )
    .unwrap()
}
fn rows(path: &str) -> Vec<Vec<String>> {
    std::fs::read_to_string(path)
        .unwrap()
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| line.split('\t').map(String::from).collect())
        .collect()
}
fn names(value: &str) -> Vec<String> {
    decode(value).lines().map(String::from).collect()
}
fn main() {
    let mut dialects = BTreeMap::<String, Dialect>::new();
    for line in io::stdin().lock().lines() {
        let line = line.unwrap();
        let fields: Vec<_> = line.split('\t').collect();
        match fields[0] {
            "load" => {
                let dialect = if fields[2] == "-" {
                    gencmu::load_dialect("lojban/cll").unwrap()
                } else {
                    let sources: BTreeMap<_, _> = rows(fields[2])
                        .iter()
                        .map(|row| (decode(&row[0]), decode(&row[1])))
                        .collect();
                    gencmu::load_dialect_sources(sources, "p.md").unwrap()
                };
                let features = dialect
                    .features()
                    .iter()
                    .map(|f| {
                        Json::Arr(vec![
                            Json::Str(f.name.clone()),
                            Json::Str(
                                match f.kind {
                                    gencmu::FeatureKind::Gate => "gate",
                                    gencmu::FeatureKind::Warning => "warning",
                                }
                                .into(),
                            ),
                            Json::Bool(f.default),
                        ])
                    })
                    .collect();
                println!(
                    "{}",
                    Json::Obj(vec![("features".into(), Json::Arr(features))]).to_json()
                );
                dialects.insert(fields[1].into(), dialect);
            }
            "batch" => {
                let count: usize = fields[2].parse().unwrap();
                let cases: Vec<_> = rows(fields[3])
                    .iter()
                    .map(|row| {
                        (
                            decode(&row[1]),
                            ParseOptions {
                                features: names(&row[2]),
                                without_features: names(&row[3]),
                                ..Default::default()
                            },
                        )
                    })
                    .collect();
                let dialect = &dialects[fields[1]];
                let mut results = Vec::new();
                let start = Instant::now();
                for _ in 0..count {
                    results = cases
                        .iter()
                        .map(|(text, options)| dialect.parse(text, options).unwrap())
                        .collect();
                }
                let seconds = start.elapsed().as_secs_f64();
                let start = Instant::now();
                let mut output = String::new();
                for result in &results {
                    output.push_str("{\"result\":");
                    output.push_str(&gencmu::to_json(result));
                    output.push_str(",\"brackets\":");
                    output.push_str(&Json::Str(gencmu::to_brackets(result, false)).to_json());
                    output.push_str("}\n");
                }
                let serialization = start.elapsed().as_secs_f64();
                if fields[4] != "-" {
                    std::fs::write(fields[4], output).unwrap();
                }
                println!("{{\"seconds\":{seconds},\"serialization\":{serialization}}}");
            }
            "concurrent" => {
                let tables: Vec<_> = rows(fields[2])
                    .iter()
                    .map(|row| {
                        let sources: BTreeMap<_, _> = rows(&row[1])
                            .iter()
                            .map(|entry| (decode(&entry[0]), decode(&entry[1])))
                            .collect();
                        (
                            row[0].clone(),
                            gencmu::load_dialect_sources(sources, "p.md").unwrap(),
                        )
                    })
                    .collect();
                let results = std::thread::scope(|scope| {
                    let handles: Vec<_> = (0..tables.len() * 4)
                        .map(|i| {
                            let (name, dialect) = &tables[i % tables.len()];
                            scope.spawn(move || {
                                let a = dialect.parse("a", &Default::default()).unwrap();
                                let b = dialect.parse("b", &Default::default()).unwrap();
                                Json::Obj(vec![
                                    ("name".into(), Json::Str(name.clone())),
                                    ("a".into(), Json::Bool(a.ok)),
                                    ("b".into(), Json::Bool(b.ok)),
                                    (
                                        "tags".into(),
                                        Json::Arr(
                                            b.tree
                                                .as_ref()
                                                .unwrap()
                                                .tags
                                                .iter()
                                                .cloned()
                                                .map(Json::Str)
                                                .collect(),
                                        ),
                                    ),
                                ])
                            })
                        })
                        .collect();
                    handles.into_iter().map(|h| h.join().unwrap()).collect()
                });
                println!("{}", Json::Arr(results).to_json());
            }
            _ => panic!("Unknown command"),
        }
        io::stdout().flush().unwrap();
    }
}
