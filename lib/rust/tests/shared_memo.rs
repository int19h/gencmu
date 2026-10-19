//! The runs of `tests/shared-memo.json` (tests/README.md). The Rust library
//! keeps no shared memo (engine §4.3), so the runs check that parses on one
//! dialect, in every order and from several threads, give the results of
//! parses on fresh dialects.

mod common;

use common::{case_tokens, parse_json, repository, Value};

/// A fresh dialect of a run.
fn dialect(run: &Value) -> gencmu::Dialect {
    match run.get("dialect").and_then(Value::str) {
        Some(name) => gencmu::load_dialect(name).expect("the dialect"),
        None => {
            let rules = run.get("grammar").and_then(Value::str).expect("a grammar");
            let header = if rules.contains("%ambiguity-resolution") { "" } else { "%ambiguity-resolution greedy\n" };
            let grammar = format!("```jbogenbau\n{header}{rules}\n```\n");
            let pipeline = "```jbogenbau\n%stage main\n%include \"main.md\"\n```\n".to_string();
            gencmu::load_dialect_sources([("p.md".to_string(), pipeline), ("main.md".to_string(), grammar)], "p.md")
                .expect("the grammar")
        }
    }
}

fn names(list: Option<&Value>) -> Vec<String> {
    list.map(Value::array).unwrap_or(&[]).iter().map(|v| v.str().expect("a name").to_string()).collect()
}

/// One parse of a run: a text or tokens, under one option set.
struct Parse {
    text: Option<String>,
    tokens: Option<Vec<gencmu::InputToken>>,
    options: gencmu::ParseOptions,
}

fn parses(run: &Value) -> Vec<Parse> {
    let mut out = Vec::new();
    let inputs: Vec<(Option<String>, Option<Vec<gencmu::InputToken>>)> = match run.get("texts") {
        Some(texts) => texts.array().iter().map(|text| (Some(text.str().expect("a text").to_string()), None)).collect(),
        None => run
            .get("inputs")
            .map(Value::array)
            .expect("inputs")
            .iter()
            .map(|tokens| {
                let case = Value::Object(vec![("tokens".to_string(), tokens.clone())]);
                (None, case_tokens(&case))
            })
            .collect(),
    };
    for (text, tokens) in inputs {
        for set in run.get("options").map(Value::array).expect("options") {
            let options = gencmu::ParseOptions {
                features: names(set.get("features")),
                without_features: names(set.get("withoutFeatures")),
                until: set.get("until").and_then(Value::str).map(str::to_string),
                elision_only: match set.get("elisionOnly") {
                    Some(Value::Bool(value)) => Some(*value),
                    _ => None,
                },
            };
            out.push(Parse { text: text.clone(), tokens: tokens.clone(), options });
        }
    }
    out
}

fn parse(dialect: &gencmu::Dialect, parse: &Parse) -> String {
    let result = match (&parse.text, &parse.tokens) {
        (Some(text), _) => dialect.parse(text, &parse.options),
        (None, Some(tokens)) => dialect.parse_tokens(tokens, &parse.options),
        (None, None) => unreachable!("a parse has an input"),
    };
    match result {
        Ok(result) => gencmu::to_json(&result),
        Err(error) => format!("error {}", error.to_json()),
    }
}

#[test]
fn shared_memo_runs() {
    let path = repository().join("tests/shared-memo.json");
    let file = parse_json(&std::fs::read_to_string(path).expect("the runs")).expect("the runs are JSON");
    for run in file.get("runs").map(Value::array).expect("runs") {
        let parses = parses(run);
        // Each reference parse has a dialect of its own.
        let reference: Vec<String> = parses.iter().map(|p| parse(&dialect(run), p)).collect();
        let shared = dialect(run);
        let forward: Vec<usize> = (0..parses.len()).collect();
        let backward: Vec<usize> = forward.iter().rev().copied().collect();
        for order in [&forward, &backward, &forward] {
            for &i in order {
                assert_eq!(parse(&shared, &parses[i]), reference[i], "parse {i}");
            }
        }
        let threaded = dialect(run);
        std::thread::scope(|scope| {
            for worker in 0..4 {
                let (threaded, parses, reference) = (&threaded, &parses, &reference);
                scope.spawn(move || {
                    // Every parse of the run, from a starting place of the
                    // thread's own.
                    let mut visited = vec![false; parses.len()];
                    for step in 0..parses.len() {
                        let i = (step + worker * parses.len() / 4) % parses.len();
                        visited[i] = true;
                        assert_eq!(parse(threaded, &parses[i]), reference[i], "parse {i} on a thread");
                    }
                    assert!(visited.iter().all(|&seen| seen), "thread {worker} left a parse out");
                });
            }
        });
    }
}
