//! Loading a dialect (docs/api.md): its pipeline document and the documents
//! it includes, read through the notation or taken from the DOM cache,
//! spliced into stages and stitched stage by stage.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, OnceLock};

use crate::dialect::{Dialect, ParseOptions};
use crate::dom::{dom_from_json, dom_problem, dom_to_json, Dom, DOM_FORMAT};
use crate::error::{Error, ErrorKind};
use crate::grammar::stitch;
use crate::json::{self, fnv1a64, Json};
use crate::markdown::{grammar_text, resolve};
use crate::notation::Reader;
use crate::pipeline::{splice, Documents, Spliced};
use crate::result::ParseErrorKind;
use crate::unicode::Unicode;

mod bundled {
    include!(concat!(env!("OUT_DIR"), "/bundled.rs"));
}

pub(crate) fn bundled(path: &str) -> Option<&'static str> {
    bundled::BUNDLED.iter().find(|(name, _)| *name == path).map(|(_, text)| *text)
}

/// The precompiled DOMs of `compiled.json`, usable only when its format
/// and bootstrap hash match. Each DOM is shared by its two keys, not
/// copied: a copy would recurse over the JSON before `dom_from_json` checks
/// its depth.
#[derive(Default)]
struct Compiled {
    by_path: HashMap<String, (String, Arc<Json>)>,
    by_hash: HashMap<String, Arc<Json>>,
}

/// The members of an object, taken out of it, or none for another value.
fn members(mut value: Json) -> Vec<(String, Json)> {
    match &mut value {
        Json::Obj(members) => std::mem::take(members),
        _ => Vec::new(),
    }
}

/// The value of an object's first member of the name `key`, taken out of it.
fn take(value: Json, key: &str) -> Option<Json> {
    members(value).into_iter().find(|(name, _)| name == key).map(|(_, value)| value)
}

impl Compiled {
    fn parse(text: &str, bootstrap_hash: &str) -> Result<Compiled, Error> {
        // A cache that does not parse, corrupt or malicious, is no cache:
        // every document is read through the notation instead.
        let Ok(value) = json::parse(text) else {
            return Ok(Compiled::default());
        };
        let mut compiled = Compiled::default();
        let usable = value.get("format").and_then(Json::as_int) == Some(DOM_FORMAT)
            && value.get("bootstrap").and_then(Json::as_str) == Some(bootstrap_hash);
        if !usable {
            return Ok(compiled);
        }
        for (path, entry) in take(value, "documents").map(members).unwrap_or_default() {
            let hash = entry.get("hash").and_then(Json::as_str).map(str::to_string);
            if let (Some(hash), Some(dom)) = (hash, take(entry, "dom")) {
                let dom = Arc::new(dom);
                compiled.by_path.insert(path, (hash.clone(), dom.clone()));
                compiled.by_hash.insert(hash, dom);
            }
        }
        Ok(compiled)
    }

    fn lookup(&self, path: &str, hash: &str, unicode: &Unicode) -> Option<Dom> {
        let dom = match self.by_path.get(path) {
            Some((known, dom)) if known == hash => Some(dom),
            _ => self.by_hash.get(hash),
        }?;
        dom_from_json(dom, unicode).ok()
    }
}

/// What reading grammar documents needs: the character table, the
/// notation dialect built from the bootstrap, and the DOM cache.
struct Context {
    unicode: Arc<Unicode>,
    notation: Arc<Dialect>,
    compiled: Compiled,
}

fn grammar_error(message: String) -> Error {
    Error::new(ErrorKind::Grammar, message)
}

fn notation_dialect(bootstrap: &str, unicode: Arc<Unicode>) -> Result<Dialect, Error> {
    let value = json::parse(bootstrap).map_err(|message| grammar_error(format!("bootstrap.json: {message}")))?;
    if value.get("format").and_then(Json::as_int) != Some(DOM_FORMAT) {
        return Err(grammar_error("bootstrap.json: an unsupported format".to_string()));
    }
    let mut stages = Vec::new();
    for stage in value.get("stages").and_then(Json::as_array).unwrap_or(&[]) {
        let name = stage.get("name").and_then(Json::as_str).unwrap_or("").to_string();
        let mut documents = Vec::new();
        for document in stage.get("documents").and_then(Json::as_array).unwrap_or(&[]) {
            let path: Arc<str> = document.get("path").and_then(Json::as_str).unwrap_or("").into();
            let dom = document
                .get("dom")
                .ok_or_else(|| grammar_error("bootstrap.json: a document without a DOM".to_string()))
                .and_then(|dom| {
                    dom_from_json(dom, &unicode).map_err(|message| grammar_error(format!("bootstrap.json: {message}")))
                })?;
            documents.push((path, Arc::new(dom)));
        }
        stages.push(stitch(&name, &documents, &unicode)?);
    }
    if stages.is_empty() {
        return Err(grammar_error("bootstrap.json has no stages".to_string()));
    }
    Dialect::new(stages, Vec::new(), unicode)
        .map_err(|error| grammar_error(format!("bootstrap.json: {}", error.message)))
}

impl Context {
    fn new(unicode: &str, bootstrap: &str, compiled: &str) -> Result<Context, Error> {
        let unicode = Arc::new(Unicode::parse(unicode).map_err(grammar_error)?);
        let notation = Arc::new(notation_dialect(bootstrap, unicode.clone())?);
        let compiled = Compiled::parse(compiled, &fnv1a64(bootstrap))?;
        Ok(Context { unicode, notation, compiled })
    }

    fn bundled() -> Result<Arc<Context>, Error> {
        static CONTEXT: OnceLock<Result<Arc<Context>, Error>> = OnceLock::new();
        CONTEXT
            .get_or_init(|| {
                let file =
                    |path: &str| bundled(path).ok_or_else(|| grammar_error(format!("the bundled {path} is missing")));
                Context::new(file("unicode.txt")?, file("notation/bootstrap.json")?, file("compiled.json")?)
                    .map(Arc::new)
            })
            .clone()
    }

    fn document(&self, path: &str, text: &str) -> Result<Dom, Error> {
        if let Some(dom) = self.compiled.lookup(path, &fnv1a64(text), &self.unicode) {
            return Ok(dom);
        }
        read_document(&self.notation, text).map_err(|error| error.in_document(path))
    }
}

/// Reads a grammar document through the notation dialect (engine §8, §9).
pub(crate) fn read_document(notation: &Dialect, text: &str) -> Result<Dom, Error> {
    let grammar = grammar_text(text)?;
    let options = ParseOptions { auto_features: false, ..ParseOptions::default() };
    let result = notation.parse_chars(grammar.chars.clone(), &options)?;
    if let Some(error) = &result.error {
        // A tie has no single position, so the error names the document
        // alone (engine §8).
        if error.kind == ParseErrorKind::Ambiguous {
            let stage = error.stage.as_deref().unwrap_or("?");
            return Err(Error::grammar(format!(
                "the grammar text is ambiguous: the {stage} stage of the notation reads it in two ways"
            )));
        }
        let at = error.source.as_ref().map_or(0, |source| source.start);
        let (line, column) = grammar.position(at);
        let message = match error.kind {
            ParseErrorKind::Rejected => match error.stage.as_deref() {
                Some("lexical") => "a character that cannot continue the grammar text".to_string(),
                _ => "a syntax error: this cannot continue the grammar text".to_string(),
            },
            _ => error.message.clone(),
        };
        return Err(Error::grammar(message).at(line, column));
    }
    let (Some(tree), Some(stage)) = (&result.tree, result.stages.last()) else {
        return Err(Error::grammar("the notation produced no tree"));
    };
    // The reader, its checks and the drop of what it reads walk the tree
    // and the DOM with explicit stacks, so a document of any depth reads
    // on the caller's thread (engine §9).
    let position = |index: usize| grammar.position(index);
    let reader = Reader {
        tokens: &stage.input,
        captures: Default::default(),
        braces: Default::default(),
        marked: Default::default(),
        position: &position,
        unicode: &notation.unicode,
        closed_for: Default::default(),
    };
    let dom = reader.document(tree)?;
    check_read(&dom, &notation.unicode)?;
    Ok(dom)
}

/// Holds a DOM just read to the rules a precompiled one is held to, the
/// bound on nesting among them (engine §9), reported at the first item
/// that breaks one.
fn check_read(dom: &Dom, unicode: &Unicode) -> Result<(), Error> {
    const TOO_DEEP: &str = "an expression, term or condition is nested more than 256 deep";
    // The bound on nesting first, on the DOM itself and with an explicit
    // stack, at the first item in the order of the document that breaks
    // it: a DOM just read is as deep as its document nests, and the checks
    // below walk it by recursion.
    let mut deep: Vec<(usize, usize)> = dom
        .rules
        .iter()
        .filter(|rule| crate::dom::rule_too_deep(rule))
        .map(|rule| rule.at)
        .chain(
            dom.constants
                .iter()
                .filter(|constant| crate::dom::term_too_deep(&constant.value))
                .map(|constant| constant.at),
        )
        .chain(
            dom.implications
                .iter()
                .filter(|implication| {
                    crate::dom::term_too_deep(&implication.antecedent)
                        || crate::dom::term_too_deep(&implication.consequent)
                })
                .map(|implication| implication.at),
        )
        .collect();
    deep.sort();
    if let Some(&(line, column)) = deep.first() {
        return Err(Error::grammar(TOO_DEEP).at(line, column));
    }
    // The problem of a DOM, through its JSON. JSON nested deeper than the
    // parser follows holds a node below far more than 256 compound nodes.
    let problem_of = |dom: &Dom| -> Option<String> {
        match json::parse(&dom_to_json(dom)) {
            Ok(json) => dom_problem(&json, unicode).map(|problem| {
                if problem == "nested too deeply" {
                    TOO_DEEP.to_string()
                } else {
                    problem.to_string()
                }
            }),
            Err(message) if message.contains("nested too deeply") => Some(TOO_DEEP.to_string()),
            Err(message) => Some(format!("the DOM: {message}")),
        }
    };
    let Some(problem) = problem_of(dom) else {
        return Ok(());
    };
    // Each item alone, a rule, a constant's definition or an implication,
    // in the order of the document.
    let mut singles: Vec<(Dom, (usize, usize))> = dom
        .rules
        .iter()
        .map(|rule| (Dom { rules: vec![rule.clone()], ..Dom::default() }, rule.at))
        .chain(
            dom.constants
                .iter()
                .map(|constant| (Dom { constants: vec![constant.clone()], ..Dom::default() }, constant.at)),
        )
        .chain(
            dom.implications
                .iter()
                .map(|implication| (Dom { implications: vec![implication.clone()], ..Dom::default() }, implication.at)),
        )
        .collect();
    singles.sort_by_key(|(_, at)| *at);
    for (single, at) in singles {
        if let Some(problem) = problem_of(&single) {
            return Err(Error::grammar(problem).at(at.0, at.1));
        }
    }
    Err(Error::grammar(problem))
}

/// Where a loader finds its documents.
trait Sources {
    /// The text of the document at `path`, or `None` when there is none.
    fn read(&self, path: &str) -> Result<Option<String>, Error>;
    fn resolve(&self, base: &str, target: &str) -> Option<String>;
}

struct MapSources {
    map: HashMap<String, String>,
}

impl Sources for MapSources {
    fn read(&self, path: &str) -> Result<Option<String>, Error> {
        Ok(self.map.get(path).cloned())
    }

    fn resolve(&self, base: &str, target: &str) -> Option<String> {
        resolve(base, target)
    }
}

struct DiskSources;

/// Normalizes `.` and `..` lexically, keeping the `..` that lead out of a
/// relative path's start: `../../a/b/../c` is `../../a/c`.
fn normalize(path: &Path) -> PathBuf {
    let mut parts: Vec<Component> = Vec::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => match parts.last() {
                Some(Component::Normal(_)) => {
                    parts.pop();
                }
                // Above the root is the root.
                Some(Component::RootDir | Component::Prefix(_)) => {}
                _ => parts.push(Component::ParentDir),
            },
            other => parts.push(other),
        }
    }
    let mut out = PathBuf::new();
    for part in parts {
        out.push(part.as_os_str());
    }
    out
}

impl Sources for DiskSources {
    /// A document's bytes as strict UTF-8, which keeps a byte order mark as
    /// the character U+FEFF. Bytes that do not decode are a grammar error of
    /// the document, found before anything hashes it or looks it up in
    /// `compiled.json` (engine §1).
    fn read(&self, path: &str) -> Result<Option<String>, Error> {
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(Error::new(ErrorKind::Io, format!("cannot read {path}: {error}")).in_document(path));
            }
        };
        match String::from_utf8(bytes) {
            Ok(text) => Ok(Some(text)),
            Err(error) => Err(Error::grammar(format!(
                "the document is not valid UTF-8: an invalid byte sequence at byte {}",
                error.utf8_error().valid_up_to()
            ))
            .in_document(path)),
        }
    }

    fn resolve(&self, base: &str, target: &str) -> Option<String> {
        if target.contains("://") {
            return None;
        }
        let directory = Path::new(base).parent().unwrap_or_else(|| Path::new(""));
        Some(normalize(&directory.join(target)).to_string_lossy().into_owned())
    }
}

/// The documents of a splice: each read once, through the context.
struct Reading<'a> {
    context: &'a Context,
    sources: &'a dyn Sources,
    read: HashMap<String, Arc<Dom>>,
}

impl Documents for Reading<'_> {
    fn dom(&mut self, path: &str) -> Result<Option<Arc<Dom>>, Error> {
        if let Some(dom) = self.read.get(path) {
            return Ok(Some(dom.clone()));
        }
        let Some(text) = self.sources.read(path)? else {
            return Ok(None);
        };
        let dom = Arc::new(self.context.document(path, &text)?);
        self.read.insert(path.to_string(), dom.clone());
        Ok(Some(dom))
    }

    fn resolve(&self, base: &str, target: &str) -> Option<String> {
        self.sources.resolve(base, target)
    }
}

/// Splices the pipeline document at `path` (engine §13).
fn splice_pipeline(context: &Context, sources: &dyn Sources, path: &str) -> Result<Spliced, Error> {
    splice(path, &mut Reading { context, sources, read: HashMap::new() })
}

fn load(context: &Context, sources: &dyn Sources, pipeline_path: &str) -> Result<Dialect, Error> {
    let pipeline = splice_pipeline(context, sources, pipeline_path)?;
    let mut stages = Vec::new();
    for stage in pipeline.stages {
        let documents: Vec<(Arc<str>, Arc<Dom>)> =
            stage.documents.into_iter().map(|(path, dom)| (path, Arc::new(dom))).collect();
        stages.push(stitch(&stage.name, &documents, &context.unicode).map_err(|error| error.in_stage(&stage.name))?);
    }
    // A name used both as a gate and as a warning, in any of the stages, is
    // an error of the dialect as a whole (engine §13).
    Dialect::new(stages, pipeline.features, context.unicode.clone()).map_err(|error| error.in_document(pipeline_path))
}

/// Loads a bundled dialect by name: the pipeline document
/// `grammars/dialects/NAME.md` of the grammars embedded in the crate.
pub fn load_dialect(name: &str) -> Result<Dialect, Error> {
    let context = Context::bundled()?;
    let pipeline = format!("dialects/{name}.md");
    if bundled(&pipeline).is_none() {
        return Err(Error::usage(format!("there is no bundled dialect named {name}")));
    }
    let map = bundled::BUNDLED.iter().map(|(path, text)| (path.to_string(), text.to_string())).collect();
    load(&context, &MapSources { map }, &pipeline)
}

/// Loads a dialect from a pipeline document on disk. Each document it
/// includes is found relative to the document that includes it; the
/// character table and the notation's bootstrap come from the bundled
/// grammars. Each document is known by its absolute path, so an error
/// names the file wherever the process runs.
pub fn load_dialect_file(path: impl AsRef<Path>) -> Result<Dialect, Error> {
    let context = Context::bundled()?;
    let path = path.as_ref();
    let absolute = if path.is_absolute() {
        normalize(path)
    } else {
        let directory = std::env::current_dir().map_err(|error| {
            Error::new(ErrorKind::Io, format!("cannot find the working directory: {error}"))
                .in_document(&path.to_string_lossy())
        })?;
        normalize(&directory.join(path))
    };
    load(&context, &DiskSources, &absolute.to_string_lossy())
}

/// Loads a dialect from documents held in memory: a map from
/// `/`-separated path to text, and the path of the pipeline document in it.
/// The map may supply its own `unicode.txt`, `notation/bootstrap.json` and
/// `compiled.json`; any it lacks come from the bundled grammars.
pub fn load_dialect_sources<I, K, V>(sources: I, pipeline: &str) -> Result<Dialect, Error>
where
    I: IntoIterator<Item = (K, V)>,
    K: Into<String>,
    V: Into<String>,
{
    let map: HashMap<String, String> = sources.into_iter().map(|(path, text)| (path.into(), text.into())).collect();
    let own = |path: &str| map.get(path).map(String::as_str);
    let context =
        if own("unicode.txt").is_none() && own("notation/bootstrap.json").is_none() && own("compiled.json").is_none() {
            Context::bundled()?
        } else {
            let pick = |path: &str| -> Result<String, Error> {
                own(path)
                    .or_else(|| bundled(path))
                    .map(str::to_string)
                    .ok_or_else(|| grammar_error(format!("the bundled {path} is missing")))
            };
            Arc::new(Context::new(&pick("unicode.txt")?, &pick("notation/bootstrap.json")?, &pick("compiled.json")?)?)
        };
    load(&context, &MapSources { map }, pipeline)
}

/// Reads a grammar document through the bundled notation, bypassing the
/// DOM cache, and returns its DOM as canonical JSON (`docs/output.md`,
/// "A grammar DOM"). For tests and tools.
pub fn read_grammar_document(text: &str) -> Result<String, Error> {
    let context = Context::bundled()?;
    read_document(&context.notation, text).map(|dom| dom_to_json(&dom))
}

/// Why a DOM, given as JSON, is malformed (engine §9), or `None` when it is
/// a DOM the reader could have produced. The check is the one that a
/// precompiled DOM meets, with the bundled table of Unicode. For tests and
/// tools.
pub fn check_dom(json: &str) -> Result<Option<String>, Error> {
    let context = Context::bundled()?;
    let value = crate::json::parse(json).map_err(grammar_error)?;
    Ok(crate::dom::dom_problem(&value, &context.unicode).map(str::to_string))
}

/// Splices a bundled pipeline document (engine §13) and returns the result
/// as JSON, `{"format":8,"stages":[{"name":...,"documents":[{"path":...,
/// "dom":...}]}],"features":[...]}`: each stage's runs of one document's
/// items, in the shape of `bootstrap.json`, and the features. With `cached`
/// false, every document is read through the notation, bypassing
/// `compiled.json`. For tests and tools.
pub fn splice_bundled_pipeline(path: &str, cached: bool) -> Result<String, Error> {
    let bundled_context = Context::bundled()?;
    let uncached;
    let context = if cached {
        &*bundled_context
    } else {
        uncached = Context {
            unicode: bundled_context.unicode.clone(),
            notation: bundled_context.notation.clone(),
            compiled: Compiled::default(),
        };
        &uncached
    };
    let map = bundled::BUNDLED.iter().map(|(path, text)| (path.to_string(), text.to_string())).collect();
    let spliced = splice_pipeline(context, &MapSources { map }, path)?;
    let mut out = format!("{{\"format\":{DOM_FORMAT},\"stages\":[");
    for (index, stage) in spliced.stages.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        out.push_str("{\"name\":");
        json::write_str(&mut out, &stage.name);
        out.push_str(",\"documents\":[");
        for (index, (path, dom)) in stage.documents.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            out.push_str("{\"path\":");
            json::write_str(&mut out, path);
            out.push_str(",\"dom\":");
            out.push_str(&dom_to_json(dom));
            out.push('}');
        }
        out.push_str("]}");
    }
    out.push_str("],\"features\":[");
    for (index, feature) in spliced.features.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        json::write_str(&mut out, feature);
    }
    out.push_str("]}");
    Ok(out)
}

/// The FNV-1a hash of the bundled `notation/bootstrap.json` (engine §8).
pub fn bootstrap_hash() -> String {
    fnv1a64(bundled("notation/bootstrap.json").unwrap_or(""))
}

#[cfg(test)]
mod tests {
    use super::{normalize, read_grammar_document};
    use crate::json::Json;
    use crate::work::{assert_mutant_stops, budget, counted, reset, Mutant, Work};
    use std::path::Path;

    #[test]
    fn leading_parents_are_kept() {
        let normal = |path: &str| normalize(Path::new(path)).to_string_lossy().replace('\\', "/");
        assert_eq!(
            normal("../../w/rust/grammars/dialects/../notation/lexical.md"),
            "../../w/rust/grammars/notation/lexical.md"
        );
        assert_eq!(normal("a/../../b"), "../b");
        assert_eq!(normal("./a/./b/.."), "a");
        assert_eq!(normal("/../a"), "/a");
    }
    /// The work of reading a document: the recognizer's items and its
    /// lookups of items, and the steps of the reader, its walks and the
    /// ranker. Each has its own budget, so that the count past any panics
    /// at once.
    fn reading(text: &str, most: Option<[u64; 3]>) -> [u64; 3] {
        let kinds = [Work::Items, Work::Found, Work::Walked];
        reset();
        if let Some(most) = most {
            for (work, most) in kinds.into_iter().zip(most) {
                budget(work, most);
            }
        }
        // An error is an outcome too. Its place is the notation cases'
        // concern.
        let _ = read_grammar_document(text);
        kinds.map(counted)
    }

    /// Five times each count, the budget of a run four times as long.
    fn five_times(counts: [u64; 3]) -> [u64; 3] {
        counts.map(|count| 5 * count)
    }

    /// The shared cases of tests/notation-growth.json: reading a document
    /// whose constructs nest deep costs work that grows with its length,
    /// not with its square. The reading runs on a thread with a fixed
    /// stack of 2 MiB, whatever the depth: no part of it recurses deeper
    /// than the bound of 256 that the DOM is checked against.
    #[test]
    fn reading_deep_nesting_grows_linearly() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/notation-growth.json");
        let text = std::fs::read_to_string(path).expect("the cases");
        let cases = crate::json::parse_cases(&text).expect("the cases are JSON");
        let cases = cases.as_array().expect("an array");
        assert!(cases.len() > 5);
        for case in cases {
            let field = |name: &str| case.get(name).and_then(Json::as_str).expect("a field of the case").to_string();
            let name = field("name");
            let (prefix, open, middle, close, suffix) =
                (field("prefix"), field("open"), field("middle"), field("close"), field("suffix"));
            let work = |n: usize, most: Option<[u64; 3]>| {
                let text =
                    format!("```jbogenbau\n{prefix}{}{middle}{}{suffix}\n```\n", open.repeat(n), close.repeat(n));
                // The counters belong to the thread that reads.
                std::thread::Builder::new()
                    .stack_size(2 << 20)
                    .spawn(move || reading(&text, most))
                    .expect("a thread")
                    .join()
                    .expect("no overflow, and no count past the budget")
            };
            // Once first, so that loading the notation counts in neither.
            work(250, None);
            let small = work(250, None);
            let large = work(1000, Some(five_times(small)));
            assert!(
                large.iter().zip(five_times(small)).all(|(&large, most)| large <= most),
                "{name}: {small:?} for 250 levels, {large:?} for 1000"
            );
        }
    }

    /// A call of many arguments reads in work that grows with its
    /// arguments, not with their square: the reader finds the call's parts
    /// once, not at each argument, before the arity error.
    #[test]
    fn a_call_of_many_arguments_reads_in_linear_work() {
        let text = |n: usize| {
            let arguments = vec!["$"; n].join(", ");
            format!("```jbogenbau\n%ambiguity-resolution greedy\n%rule text 'a'\n%tags tags({arguments})\n```\n")
        };
        assert!(read_grammar_document(&text(500)).is_err(), "tags() of 500 arguments");
        let small = reading(&text(500), None);
        let large = reading(&text(2000), Some(five_times(small)));
        assert!(
            large.iter().zip(five_times(small)).all(|(&large, most)| large <= most),
            "{small:?} for 500 arguments, {large:?} for 2000"
        );
    }

    /// The search for the origins of a derivation, in a version that
    /// builds the positions of the chart's items at each call or that walks
    /// the longer list of origins, stops at the first count past the budget
    /// of `reading_deep_nesting_grows_linearly`. Negations nest each
    /// constituent at one end, where the longer list holds every origin.
    #[test]
    fn quadratic_searches_for_origins_stop_at_the_budget() {
        for mutant in [Mutant::PositionsPerCall, Mutant::WalkEnding] {
            std::thread::Builder::new()
                .stack_size(2 << 20)
                .spawn(move || {
                    let text =
                        |n: usize| format!("```jbogenbau\n%rule text $x(A) %conditions {}$x\n```\n", "¬".repeat(n));
                    // Once first, so that loading the notation counts in
                    // neither.
                    let _ = read_grammar_document(&text(1));
                    assert_mutant_stops(Work::Walked, mutant, 250, &mut |n| {
                        let _ = read_grammar_document(&text(n));
                    });
                })
                .expect("a thread")
                .join()
                .expect("a stop at the budget");
        }
    }
}
