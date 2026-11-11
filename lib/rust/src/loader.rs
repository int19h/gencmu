//! Loading a pipeline (docs/api.md): its pipeline document and the documents
//! it includes, read through the notation or taken from the DOM cache,
//! spliced into stages and stitched stage by stage.

use std::collections::{BTreeMap, HashMap};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, OnceLock};

use crate::dom::{dom_from_json, dom_problem, dom_to_json, Dom, DOM_FORMAT};
use crate::error::{Error, ErrorKind, SpliceProblem};
use crate::grammar::stitch;
use crate::json::{self, fnv1a64, Json};
use crate::markdown::{grammar_text, resolve};
use crate::notation::Reader;
use crate::pipeline::{ParseOptions, Pipeline};
use crate::result::ParseErrorKind;
use crate::splice::{splice, Documents, Spliced};
use crate::string_escapes::DocumentStrings;
use crate::unicode::Unicode;
use crate::unicode_names::{names_registry, NamesScope};

mod bundled {
    include!(concat!(env!("OUT_DIR"), "/bundled.rs"));
}

pub(crate) fn bundled(path: &str) -> Option<&'static str> {
    static RESOURCES: OnceLock<HashMap<&'static str, &'static str>> = OnceLock::new();
    RESOURCES.get_or_init(|| bundled::BUNDLED.iter().copied().collect()).get(path).copied()
}

const BOOTSTRAP_PATH: &str = "data/preparsed/gencmu.json";
const NOTATION_PATH: &str = "grammars/gencmu/jbogenbau/pipeline.md";

fn preparsed_path(document: &str) -> Option<String> {
    let rest = document.strip_prefix("grammars/")?;
    let (family, child) = rest.split_once('/')?;
    if child.is_empty() {
        return None;
    }
    let valid = !family.is_empty()
        && family.as_bytes()[0].is_ascii_alphanumeric()
        && family.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-');
    valid.then(|| format!("data/preparsed/{family}.json"))
}

/// Preparsed DOMs keyed by document path and text hash, with matching resource fingerprints.
/// Each DOM uses shared storage to avoid recursion before its depth check.
#[derive(Default)]
struct Preparsed {
    by_path: HashMap<String, (String, PreparsedEntry)>,
    bundled_names: Option<BTreeMap<String, String>>,
}

#[derive(Clone)]
struct PreparsedEntry {
    dom: Arc<Json>,
    names: Option<Arc<Json>>,
}

/// The members of an object, taken out of it, or none for another value.
fn members(mut value: Json) -> Vec<(String, Json)> {
    match &mut value {
        Json::Obj(members) => std::mem::take(members),
        _ => Vec::new(),
    }
}

/// The value of an object's member of the exact name `key`, taken out of it.
fn take(value: Json, key: &str) -> Option<Json> {
    members(value).into_iter().find(|(name, _)| name == key).map(|(_, value)| value)
}

impl Preparsed {
    #[cfg(test)]
    fn parse(
        text: &str,
        bootstrap_hash: &str,
        unicode_hash: &str,
        properties_hash: Option<&str>,
    ) -> Result<Preparsed, Error> {
        Self::parse_implicit(text, bootstrap_hash, unicode_hash, properties_hash, false)
    }

    fn parse_implicit(
        text: &str,
        bootstrap_hash: &str,
        unicode_hash: &str,
        properties_hash: Option<&str>,
        implicit: bool,
    ) -> Result<Preparsed, Error> {
        // A cache that does not parse, corrupt or malicious, is no cache:
        // every document is read through the notation instead.
        let Ok(value) = json::parse(text) else {
            return Ok(Preparsed::default());
        };
        let mut preparsed = Preparsed::default();
        let usable = value.get("format").and_then(Json::as_int) == Some(DOM_FORMAT)
            && (implicit || value.get("bootstrap").and_then(Json::as_str) == Some(bootstrap_hash))
            && value.get("unicode").and_then(Json::as_str) == Some(unicode_hash)
            && match (value.get("properties"), properties_hash) {
                (Some(Json::Null), None) => true,
                (Some(Json::Str(hash)), Some(expected)) => hash == expected,
                _ => false,
            };
        if !usable {
            return Ok(preparsed);
        }
        preparsed.bundled_names = value.get("bundledNames").and_then(names_registry);
        for (path, entry) in take(value, "documents").map(members).unwrap_or_default() {
            let (mut hash, mut dom, mut names) = (None, None, None);
            for (key, value) in members(entry) {
                match key.as_str() {
                    "hash" => hash = value.as_str().map(str::to_string),
                    "dom" => dom = Some(Arc::new(value)),
                    "names" => names = Some(Arc::new(value)),
                    _ => {}
                }
            }
            if let (Some(hash), Some(dom)) = (hash, dom) {
                let entry = PreparsedEntry { dom, names };
                preparsed.by_path.insert(path, (hash, entry));
            }
        }
        Ok(preparsed)
    }

    // This cache belongs to one immutable context. Its format, bootstrap
    // and Unicode identity gate all entries before document-hash lookup.
    fn lookup(&self, path: &str, hash: &str, unicode: &Unicode, names: &NamesScope<'_>) -> Result<Option<Dom>, Error> {
        let entry = match self.by_path.get(path) {
            Some((known, entry)) if known == hash => Some(entry),
            _ => None,
        };
        let Some(entry) = entry else {
            return Ok(None);
        };
        let Ok(mut dom) = dom_from_json(&entry.dom, unicode) else {
            return Ok(None);
        };
        let candidate = names.for_dom(&dom)?;
        if !candidate.matches(entry.names.as_deref(), self.bundled_names.as_ref())? {
            return Ok(None);
        }
        dom.names_dependencies = candidate.dependencies.borrow().clone();
        Ok(Some(dom))
    }
}

/// What reading grammar documents needs: the character table, the
/// notation pipeline built from the bootstrap, and the DOM cache.
struct Context {
    unicode: Arc<Unicode>,
    notation: Arc<Pipeline>,
    preparsed: Preparsed,
    bootstrap_hash: String,
    unicode_hash: String,
    allow_families: bool,
}

fn grammar_error(message: String) -> Error {
    let ranked_syntax = message.starts_with("ranked-choice-syntax:");
    let error = Error::new(ErrorKind::Grammar, message);
    if ranked_syntax {
        error.coded("ranked-choice-syntax")
    } else {
        error
    }
}

fn notation_pipeline(bootstrap: &str, unicode: Arc<Unicode>) -> Result<Pipeline, Error> {
    build_notation_pipeline(bootstrap, unicode).map_err(|mut error| {
        if let Some(embedded) = &error.document {
            if embedded != "data/preparsed/gencmu.json" {
                error.message.push_str(&format!(" (embedded document: {embedded})"));
            }
        }
        error.document = Some("data/preparsed/gencmu.json".to_string());
        error
    })
}

fn build_notation_pipeline(bootstrap: &str, unicode: Arc<Unicode>) -> Result<Pipeline, Error> {
    let value = json::parse(bootstrap).map_err(grammar_error)?;
    if value.get("format").and_then(Json::as_int) != Some(DOM_FORMAT) {
        return Err(grammar_error("an unsupported bootstrap format".to_string()));
    }
    let entries = value
        .get("documents")
        .filter(|v| matches!(v, Json::Obj(_)))
        .ok_or_else(|| grammar_error("the bootstrap requires a document map".into()))?;
    struct BootstrapDocuments<'a> {
        entries: &'a Json,
        unicode: &'a Unicode,
    }
    impl Documents for BootstrapDocuments<'_> {
        fn dom(&mut self, path: &str) -> Result<Option<Arc<Dom>>, Error> {
            let Some(entry) = self.entries.get(path) else { return Ok(None) };
            if entry.get("hash").and_then(Json::as_str).is_none() {
                return Err(grammar_error(format!("the bootstrap entry of {path} requires a hash")));
            }
            let dom = entry
                .get("dom")
                .ok_or_else(|| grammar_error(format!("the bootstrap entry of {path} requires a DOM")))?;
            dom_from_json(dom, self.unicode).map(|dom| Some(Arc::new(dom))).map_err(|e| {
                let mut error = grammar_error(e);
                error.message = format!("the bootstrap's DOM of {path} is malformed: {}", error.message);
                error
            })
        }
        fn resolve(&self, base: &str, target: &str) -> Option<String> {
            crate::markdown::resolve(base, target)
        }
    }
    let spliced =
        splice(NOTATION_PATH, &mut BootstrapDocuments { entries, unicode: &unicode }).map_err(|mut error| {
            if let Some(stage) = error.stage.take() {
                if error.splice_problem == Some(SpliceProblem::EmptyStage) {
                    error.message = format!("stage {stage}: {}", error.message);
                }
            }
            error
        })?;
    let mut stages = Vec::new();
    for stage in spliced.stages {
        let documents: Vec<_> = stage.documents.into_iter().map(|(path, dom)| (path, Arc::new(dom))).collect();
        stages.push(stitch(&stage.name, &documents, &unicode).map_err(|error| error.in_stage(&stage.name))?);
    }
    let pipeline = Pipeline::new(stages, spliced.features, unicode)?;
    pipeline.prepare_bootstrap()?;
    Ok(pipeline)
}

impl Context {
    #[cfg(test)]
    fn new(unicode: &str, bootstrap: &str) -> Result<Context, Error> {
        let mut context = Self::with_properties(unicode, None, bootstrap)?;
        context.allow_families = false;
        Ok(context)
    }

    fn with_properties(unicode: &str, properties: Option<&str>, bootstrap: &str) -> Result<Context, Error> {
        let unicode_hash = fnv1a64(unicode);
        let mut unicode = Unicode::parse(unicode)?;
        if let Some(properties) = properties {
            unicode.properties = crate::unicode_properties::read_properties(properties, &unicode)?;
            unicode.properties_fingerprint = Some(fnv1a64(properties));
        }
        let unicode = Arc::new(unicode);
        let notation = Arc::new(notation_pipeline(bootstrap, unicode.clone())?);
        Ok(Context {
            unicode,
            notation,
            preparsed: Preparsed::default(),
            bootstrap_hash: fnv1a64(bootstrap),
            unicode_hash,
            allow_families: true,
        })
    }

    fn bundled() -> Result<Arc<Context>, Error> {
        static CONTEXT: OnceLock<Result<Arc<Context>, Error>> = OnceLock::new();
        CONTEXT
            .get_or_init(|| {
                let file = |path: &str| {
                    bundled(path)
                        .ok_or_else(|| grammar_error(format!("the bundled {path} is missing")).in_document(path))
                };
                Context::with_properties(
                    file("data/unicode/unicode.txt")?,
                    Some(file("data/unicode/unicode-properties.txt")?),
                    file("data/preparsed/gencmu.json")?,
                )
                .map(Arc::new)
            })
            .clone()
    }

    #[cfg(test)]
    fn document(&self, path: &str, text: &str, diagnostic: bool) -> Result<Dom, Error> {
        let names = NamesScope::new(&bundled_names, &self.unicode, []).in_document(path, &crate::markdown::resolve);
        self.document_named(path, text, diagnostic, &names)
    }

    #[cfg(test)]
    fn document_named(&self, path: &str, text: &str, diagnostic: bool, names: &NamesScope<'_>) -> Result<Dom, Error> {
        self.document_from(path, text, diagnostic, names, &self.preparsed)
    }

    fn document_from(
        &self,
        path: &str,
        text: &str,
        diagnostic: bool,
        names: &NamesScope<'_>,
        preparsed: &Preparsed,
    ) -> Result<Dom, Error> {
        let mut dom = if let Some(dom) = preparsed.lookup(path, &fnv1a64(text), &self.unicode, names)? {
            dom
        } else {
            return read_document_named(&self.notation, text, true, names).map_err(|error| error.in_document(path));
        };
        if diagnostic {
            #[cfg(test)]
            LOCATION_RECOVERIES.with(|count| count.set(count.get() + 1));
            if let Ok(source) = read_document_named(&self.notation, text, true, names) {
                crate::ranked::restore_locations(&mut dom, &source);
            }
        }
        Ok(dom)
    }
}

/// Reads a grammar document through the notation pipeline (engine §8, §9).
pub(crate) fn read_document(notation: &Pipeline, text: &str, path: &str) -> Result<Dom, Error> {
    let names = NamesScope::new(&bundled_names, &notation.unicode, []).in_document(path, &crate::markdown::resolve);
    read_document_named(notation, text, false, &names).map_err(|error| error.in_document(path))
}

fn bundled_names(path: &str) -> Result<Option<String>, Error> {
    let path = if path == "data/unicode/unicode-names-reference.txt" { "data/unicode/unicode-names.txt" } else { path };
    Ok(bundled(path).map(str::to_string))
}

fn read_document_named(notation: &Pipeline, text: &str, defer: bool, names: &NamesScope<'_>) -> Result<Dom, Error> {
    let grammar = grammar_text(text, &notation.unicode)?;
    let position = |index: usize| grammar.position(index);
    let strings =
        DocumentStrings { unicode: &notation.unicode, names, position: &position, names_paths: Default::default() };
    let options = ParseOptions::default();
    let result = notation.parse_chars_inspected(grammar.chars.clone(), &options, |tokens| strings.inspect(tokens))?;
    let syntax_input = result.stages.iter().find(|stage| stage.name == "syntax").map(|stage| stage.input.as_slice());
    if let Some(error) = &result.error {
        // A tie has no single position, so the error names the document
        // alone (engine §8).
        if error.kind == ParseErrorKind::Ambiguous {
            let stage = error.stage.as_deref().unwrap_or("?");
            return Err(Error::grammar(format!(
                "the grammar text is ambiguous: the {stage} stage of the notation reads it in two ways"
            )));
        }
        let mut at = error.source.as_ref().map_or(0, |source| source.start);
        if error.stage.as_deref() == Some("lexical") && at > 0 && grammar.chars.get(at - 1) == Some(&'@') {
            at -= 1;
        }
        let (line, column) = grammar.position(at);
        let message = if error.stage.as_deref() == Some("lexical") && grammar.chars.get(at) == Some(&'@') {
            "a parameter requires @ followed directly by an ASCII letter".to_string()
        } else {
            match error.kind {
                ParseErrorKind::Rejected => match error.stage.as_deref() {
                    Some("lexical") => "a character that cannot continue the grammar text".to_string(),
                    _ => "a syntax error: this cannot continue the grammar text".to_string(),
                },
                _ => error.message.clone(),
            }
        };
        let mut failure = Error::grammar(message).at(line, column);
        if error.kind == ParseErrorKind::Rejected && error.stage.as_deref() == Some("syntax") {
            if let Some(tokens) = syntax_input {
                let at = error.token.unwrap_or(0);
                if crate::ranked::syntax_failure(tokens, at) {
                    failure = failure.coded("ranked-choice-syntax");
                }
            }
        }
        return Err(failure);
    }
    let (Some(tree), Some(stage)) = (&result.tree, result.stages.last()) else {
        return Err(Error::grammar("the notation produced no tree"));
    };
    // The reader, its checks and the drop of what it reads walk the tree
    // and the DOM with explicit stacks, so a document of any depth reads
    // on the caller's thread (engine §9).
    let reader = Reader {
        unresolved_nodes: Default::default(),
        parts_cache: Default::default(),
        parameters: Default::default(),
        reading_head: Default::default(),
        unresolved: Default::default(),
        unicode: &notation.unicode,
        defer_emission: defer,
        feature_context: Default::default(),
        tokens: &stage.input,
        strings: &strings,
        captures: Default::default(),
        chain: Default::default(),
        item: Default::default(),
        ranked: Default::default(),
        marked: Default::default(),
        allowed_marked: Default::default(),
        position: &position,
        closed_for: Default::default(),
        in_recipe: Default::default(),
        head_defaults: Default::default(),
        default_head: Default::default(),
    };
    let mut dom = reader.document(tree)?;
    check_read(&dom, &notation.unicode)?;
    dom.names_dependencies = names.dependencies.borrow().clone();
    Ok(dom)
}

/// Holds a DOM just read to the rules a preparsed one is held to, the
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
        .chain(
            dom.directives
                .iter()
                .filter(|directive| directive.conditions.as_deref().is_some_and(crate::dom::conditions_too_deep))
                .map(|directive| directive.at),
        )
        .chain(
            dom.classifiers
                .iter()
                .filter(|classifier| {
                    classifier.entries.iter().any(|entry| entry.keys.iter().any(crate::dom::term_too_deep))
                })
                .map(|classifier| classifier.at),
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
                    problem
                }
            }),
            Err(message) if message.contains("nested too deeply") => Some(TOO_DEEP.to_string()),
            Err(message) => Some(format!("the DOM: {message}")),
        }
    };
    let Some(problem) = problem_of(dom) else {
        return Ok(());
    };
    // Each declaration alone, including feature directives and
    // classifiers, in the order of the document.
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
        .chain(
            dom.directives
                .iter()
                .map(|directive| (Dom { directives: vec![directive.clone()], ..Dom::default() }, directive.at)),
        )
        .chain(
            dom.classifiers
                .iter()
                .map(|classifier| (Dom { classifiers: vec![classifier.clone()], ..Dom::default() }, classifier.at)),
        )
        .collect();
    singles.sort_by_key(|(_, at)| *at);
    for (single, at) in singles {
        if let Some(problem) = problem_of(&single) {
            return Err(grammar_error(problem).at(at.0, at.1));
        }
    }
    Err(grammar_error(problem))
}

/// Where a loader finds its documents.
trait Sources: Send + Sync + std::panic::RefUnwindSafe + std::panic::UnwindSafe {
    fn owned(&self) -> Arc<dyn Sources>;
    /// The text of the document at `path`, or `None` when there is none.
    fn read(&self, path: &str) -> Result<Option<String>, Error>;
    fn resolve(&self, base: &str, target: &str) -> Option<String>;
    fn names_override(&self, _path: &str) -> bool {
        true
    }
    fn names(&self, path: &str) -> Result<Option<String>, Error> {
        match self.read(path)? {
            Some(text) => Ok(Some(text)),
            None => bundled_names(path),
        }
    }
}

#[derive(Clone)]
struct MapSources {
    map: HashMap<String, String>,
}

impl Sources for MapSources {
    fn owned(&self) -> Arc<dyn Sources> {
        Arc::new(self.clone())
    }
    fn names_override(&self, path: &str) -> bool {
        self.map.contains_key(path)
    }
    fn read(&self, path: &str) -> Result<Option<String>, Error> {
        Ok(self.map.get(path).cloned())
    }

    fn resolve(&self, base: &str, target: &str) -> Option<String> {
        resolve(base, target)
    }
}

struct BundledSources;
impl Sources for BundledSources {
    fn owned(&self) -> Arc<dyn Sources> {
        Arc::new(Self)
    }
    fn read(&self, path: &str) -> Result<Option<String>, Error> {
        Ok(bundled(path).map(str::to_string))
    }
    fn resolve(&self, base: &str, target: &str) -> Option<String> {
        resolve(base, target)
    }
    fn names_override(&self, _path: &str) -> bool {
        false
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
    fn owned(&self) -> Arc<dyn Sources> {
        Arc::new(Self)
    }
    fn names_override(&self, path: &str) -> bool {
        !matches!(path, "data/unicode/unicode-names.txt" | "data/unicode/unicode-names-reference.txt")
            && !matches!(std::fs::metadata(path), Err(error) if error.kind() == std::io::ErrorKind::NotFound)
    }
    fn names(&self, path: &str) -> Result<Option<String>, Error> {
        if matches!(path, "data/unicode/unicode-names.txt" | "data/unicode/unicode-names-reference.txt") {
            return bundled_names(path);
        }
        match self.read(path)? {
            Some(text) => Ok(Some(text)),
            None => bundled_names(path),
        }
    }
    /// A document's bytes as strict UTF-8, which keeps a byte order mark as
    /// the character U+FEFF. Bytes that do not decode are a grammar error of
    /// the document, found before anything hashes it or looks it up in
    /// `data/preparsed/FAMILY.json` (engine §1).
    fn read(&self, path: &str) -> Result<Option<String>, Error> {
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                let mut error = Error::grammar(format!("the document could not be read: {error}")).in_document(path);
                error.splice_problem = Some(SpliceProblem::UnreadableDocument);
                return Err(error);
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
        resolve(base, target)
    }
}

/// The documents of a splice: each read once, through the context.
struct Reading<'a> {
    context: &'a Context,
    sources: &'a dyn Sources,
    read: HashMap<(String, Vec<String>), Arc<Dom>>,
    diagnostic_document: Option<&'a str>,
    texts: HashMap<String, String>,
    families: HashMap<String, Preparsed>,
}

impl Documents for Reading<'_> {
    fn dom(&mut self, path: &str) -> Result<Option<Arc<Dom>>, Error> {
        self.dom_with_names(path, &[])
    }

    fn dom_with_names(&mut self, path: &str, inherited: &[String]) -> Result<Option<Arc<Dom>>, Error> {
        let key = (path.to_string(), inherited.to_vec());
        if let Some(dom) = self.read.get(&key) {
            return Ok(Some(dom.clone()));
        }
        let Some(text) = self.sources.read(path)? else {
            return Ok(None);
        };
        let read_names = |name: &str| self.sources.names(name);
        let names_override = |name: &str| self.sources.names_override(name);
        let resolve = |base: &str, target: &str| self.sources.resolve(base, target);
        let names = NamesScope::new(&read_names, &self.context.unicode, inherited.iter().cloned())
            .in_document(path, &resolve)
            .with_overrides(&names_override);
        let family = if self.context.allow_families { preparsed_path(path) } else { None };
        let preparsed = if let Some(file) = family {
            if !self.families.contains_key(&file) {
                let supplied = match self.sources.read(&file) {
                    Ok(value) => value.or_else(|| bundled(&file).map(str::to_string)),
                    Err(_) => Some(String::new()),
                };
                let resource = supplied.as_deref().unwrap_or("");
                let mut index = Preparsed::parse_implicit(
                    resource,
                    &self.context.bootstrap_hash,
                    &self.context.unicode_hash,
                    self.context.unicode.properties_fingerprint.as_deref(),
                    file == BOOTSTRAP_PATH,
                )?;
                index.by_path.retain(|path, _| preparsed_path(path).as_deref() == Some(file.as_str()));
                self.families.insert(file.clone(), index);
            }
            self.families.get(&file).unwrap()
        } else {
            &self.context.preparsed
        };
        let dom = Arc::new(self.context.document_from(
            path,
            &text,
            self.diagnostic_document == Some(path),
            &names,
            preparsed,
        )?);
        self.texts.insert(path.to_string(), text);
        self.read.insert(key, dom.clone());
        Ok(Some(dom))
    }

    fn resolve(&self, base: &str, target: &str) -> Option<String> {
        self.sources.resolve(base, target)
    }
}

/// Splices the pipeline document at `path` (engine §13).
fn splice_pipeline(context: &Context, sources: &dyn Sources, path: &str) -> Result<Spliced, Error> {
    splice(
        path,
        &mut Reading {
            context,
            sources,
            read: HashMap::new(),
            texts: HashMap::new(),
            diagnostic_document: None,
            families: HashMap::new(),
        },
    )
}

fn load(context: &Context, sources: &dyn Sources, pipeline_path: &str) -> Result<Pipeline, Error> {
    match load_mode(context, sources, pipeline_path, None) {
        Err(error)
            if error.code().is_some_and(|code| code.starts_with("ranked-choice-"))
                && error.group().is_some_and(|group| group.at.is_none() && group.document.is_some()) =>
        {
            // Retry only a failed load, with locations for its diagnostic document.
            let document = error.group().and_then(|group| group.document.as_deref());
            load_mode(context, sources, pipeline_path, document)
        }
        Err(error)
            if error.message.starts_with("boundary target ") && error.line.is_none() && error.document.is_some() =>
        {
            load_mode(context, sources, pipeline_path, error.document.as_deref())
        }
        Err(error) if error.message.starts_with("a default fails its head test") && error.document.is_some() => {
            load_mode(context, sources, pipeline_path, error.document.as_deref())
        }
        Err(error) if error.location_recovery.is_some() && error.line.is_none() && error.document.is_some() => {
            load_mode(context, sources, pipeline_path, error.document.as_deref())
        }
        result => result,
    }
}

fn load_mode(
    context: &Context,
    sources: &dyn Sources,
    pipeline_path: &str,
    diagnostic_document: Option<&str>,
) -> Result<Pipeline, Error> {
    let mut reading = Reading {
        context,
        sources,
        read: HashMap::new(),
        texts: HashMap::new(),
        diagnostic_document,
        families: HashMap::new(),
    };
    let spliced = splice(pipeline_path, &mut reading)?;
    let texts = Arc::new(reading.texts);
    let mut owned_sources = None;
    let mut recoveries = BTreeMap::new();
    let mut stages = Vec::new();
    for (index, stage) in spliced.stages.into_iter().enumerate() {
        let documents: Vec<(Arc<str>, Arc<Dom>)> =
            stage.documents.into_iter().map(|(path, dom)| (path, Arc::new(dom))).collect();
        let grammar = stitch(&stage.name, &documents, &context.unicode).map_err(|error| error.in_stage(&stage.name))?;
        if grammar.tree_comparisons {
            let sources = owned_sources.get_or_insert_with(|| sources.owned()).clone();
            let texts = texts.clone();
            let notation = context.notation.clone();
            let unicode = context.unicode.clone();
            let recovery: Arc<crate::pipeline::TreeLocationRecovery> =
                Arc::new(move |document, features, classifiers| {
                    if notation.stages.is_empty() {
                        return None;
                    }
                    let mut documents = documents.clone();
                    let mut located = false;
                    for (path, dom) in &mut documents {
                        if path.as_ref() != document {
                            continue;
                        }
                        let Some(text) = texts.get(path.as_ref()) else { continue };
                        let read_names = |name: &str| sources.names(name);
                        let names_override = |name: &str| sources.names_override(name);
                        let resolve = |base: &str, target: &str| sources.resolve(base, target);
                        let inherited = dom.names_dependencies.iter().flat_map(|deps| deps.keys().cloned());
                        let names = NamesScope::new(&read_names, &unicode, inherited)
                            .in_document(path, &resolve)
                            .with_overrides(&names_override);
                        if let Ok(source) = read_document_named(&notation, text, true, &names) {
                            crate::ranked::restore_locations(Arc::make_mut(dom), &source);
                            located = true;
                        }
                    }
                    if !located {
                        return None;
                    }
                    let grammar = stitch(&stage.name, &documents, &unicode).ok()?;
                    crate::lower::lower(&grammar, features, classifiers).err().filter(|error| !error.recover_location)
                });
            recoveries.insert(index, recovery);
        }
        stages.push(grammar);
    }
    let mut pipeline = Pipeline::new(stages, spliced.features, context.unicode.clone())
        .map_err(|error| error.in_document(pipeline_path))?;
    pipeline.tree_recovery = recoveries;
    Ok(pipeline)
}

/// Loads a bundled pipeline by name: the pipeline document
/// `grammars/NAME/pipeline.md` of the grammars embedded in the crate.
pub fn load_pipeline(name: &str) -> Result<Pipeline, Error> {
    let path = format!("grammars/{name}/pipeline.md");
    if !valid_pipeline_name(name) || bundled(&path).is_none() {
        return Err(Error::usage(format!("there is no bundled pipeline named {name:?}")));
    }
    let context = Context::bundled()?;
    load(&context, &BundledSources, &path)
}

fn valid_pipeline_name(name: &str) -> bool {
    let mut count = 0;
    for segment in name.split('/') {
        if segment.is_empty()
            || !segment.as_bytes()[0].is_ascii_alphanumeric()
            || !segment.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        {
            return false;
        }
        count += 1;
    }
    count >= 2
}

/// Lists valid bundled pipeline names in code-point order.
pub fn bundled_pipelines() -> Vec<String> {
    let mut names: Vec<_> = bundled::BUNDLED
        .iter()
        .filter_map(|(path, _)| {
            let name = path.strip_prefix("grammars/")?.strip_suffix("/pipeline.md")?;
            valid_pipeline_name(name).then(|| name.to_string())
        })
        .collect();
    names.sort();
    names
}

/// Loads a pipeline from a pipeline document on disk. Each document it
/// includes is found relative to the document that includes it; the
/// character table and the notation's bootstrap come from the bundled
/// grammars. Each document is known by its absolute path, so an error
/// names the file wherever the process runs.
pub fn load_pipeline_file(path: impl AsRef<Path>) -> Result<Pipeline, Error> {
    let path = path.as_ref();
    let spelling = path.to_str().ok_or_else(|| Error::usage("the pipeline path is not valid UTF-8"))?;
    let context = Context::bundled()?;
    let absolute = if path.is_absolute() {
        normalize(path)
    } else {
        let directory = std::env::current_dir().map_err(|error| {
            Error::grammar(format!("cannot find the working directory: {error}")).in_document(spelling)
        })?;
        normalize(&directory.join(path))
    };
    let absolute = absolute.to_str().ok_or_else(|| Error::usage("the pipeline path is not valid UTF-8"))?;
    load(&context, &DiskSources, &absolute.replace(std::path::MAIN_SEPARATOR, "/"))
}

/// Loads a pipeline from documents held in memory: a map from
/// `/`-separated path to text, and the path of the pipeline document in it.
/// The map may supply its own `data/unicode/unicode.txt`, `data/preparsed/gencmu.json` and
/// `data/preparsed/FAMILY.json`; any it lacks come from the bundled resources.
pub fn load_pipeline_sources<I, K, V>(sources: I, pipeline: &str) -> Result<Pipeline, Error>
where
    I: IntoIterator<Item = (K, V)>,
    K: Into<String>,
    V: Into<String>,
{
    let map: HashMap<String, String> = sources.into_iter().map(|(path, text)| (path.into(), text.into())).collect();
    let own = |path: &str| map.get(path).map(String::as_str);
    let context = if own("data/unicode/unicode.txt").is_none()
        && own("data/unicode/unicode-properties.txt").is_none()
        && own("data/preparsed/gencmu.json").is_none()
    {
        Context::bundled()?
    } else {
        let pick = |path: &str| -> Result<String, Error> {
            own(path)
                .or_else(|| bundled(path))
                .map(str::to_string)
                .ok_or_else(|| grammar_error(format!("the bundled {path} is missing")).in_document(path))
        };
        let properties = if own("data/unicode/unicode.txt").is_some() {
            own("data/unicode/unicode-properties.txt").map(str::to_string)
        } else {
            Some(pick("data/unicode/unicode-properties.txt")?)
        };
        Arc::new(Context::with_properties(
            &pick("data/unicode/unicode.txt")?,
            properties.as_deref(),
            &pick("data/preparsed/gencmu.json")?,
        )?)
    };
    load(&context, &MapSources { map }, pipeline)
}

/// Reads a grammar document through the bundled notation, bypassing the
/// DOM cache, and returns its DOM as canonical JSON (`docs/output.md`,
/// "A grammar DOM"). The path supplies the base for relative names resources.
/// An empty path selects the resource root. For tests and tools.
pub fn read_grammar_document(text: &str, path: &str) -> Result<String, Error> {
    read_grammar_dom(text, path).map(|dom| dom_to_json(&dom))
}

pub(crate) fn read_grammar_dom(text: &str, path: &str) -> Result<Dom, Error> {
    let context = Context::bundled()?;
    read_document(&context.notation, text, path)
}

/// Why a DOM, given as JSON, is malformed (engine §9), or `None` when it is
/// a DOM the reader could have produced. The check is the one that a
/// preparsed DOM meets, with the bundled table of Unicode. For tests and
/// tools.
pub fn check_dom(json: &str) -> Result<Option<String>, Error> {
    let context = Context::bundled()?;
    let value = crate::json::parse(json).map_err(grammar_error)?;
    Ok(crate::dom::dom_problem(&value, &context.unicode))
}

/// Why a supplied DOM is malformed with a caller's Unicode table.
/// This uses the same validation as the preparsed cache. For tests and tools.
pub fn check_dom_with_unicode(json: &str, table: &str) -> Result<Option<String>, Error> {
    let unicode = Unicode::parse(table)?;
    let value = crate::json::parse(json).map_err(grammar_error)?;
    Ok(crate::dom::dom_problem(&value, &unicode))
}

/// Splices a bundled pipeline document (engine §13) and returns the result
/// as JSON, `{"format":43,"stages":[{"name":...,"documents":[{"path":...,
/// "dom":...}]}],"features":[...]}`: each stage's runs of one document's
/// items, as spliced stage records, and the features. With `cached`
/// false, every document is read through the notation, bypassing
/// `data/preparsed/FAMILY.json`. For tests and tools.
pub fn splice_bundled_pipeline(path: &str, cached: bool) -> Result<String, Error> {
    let bundled_context = Context::bundled()?;
    let uncached;
    let context = if cached {
        &*bundled_context
    } else {
        uncached = Context {
            unicode: bundled_context.unicode.clone(),
            notation: bundled_context.notation.clone(),
            preparsed: Preparsed::default(),
            bootstrap_hash: bundled_context.bootstrap_hash.clone(),
            unicode_hash: bundled_context.unicode_hash.clone(),
            allow_families: false,
        };
        &uncached
    };
    let spliced = splice_pipeline(context, &BundledSources, path)?;
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

/// The FNV-1a hash of the bundled `data/preparsed/gencmu.json` (engine §8).
pub fn bootstrap_hash() -> String {
    fnv1a64(bundled("data/preparsed/gencmu.json").unwrap_or(""))
}

#[cfg(test)]
mod tests {
    use super::{normalize, read_grammar_document};
    use crate::json::Json;
    use crate::work::{assert_linear, assert_mutant_stops, budget, counted, reset, Mutant, Work};
    use std::path::Path;

    #[test]
    fn leading_parents_are_kept() {
        let normal = |path: &str| normalize(Path::new(path)).to_string_lossy().replace('\\', "/");
        assert_eq!(
            normal("../../w/rust/grammars/gencmu/jbogenbau/../jbogenbau/lexical.md"),
            "../../w/rust/grammars/gencmu/jbogenbau/lexical.md"
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
        let _ = read_grammar_document(text, "");
        let counts = kinds.map(counted);
        // What reads next does so with no budget.
        reset();
        counts
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

    #[test]
    fn nested_method_arguments_read_in_linear_work() {
        let text = |n: usize| {
            format!(
                "```jbogenbau\n%features f %conditions {}\"a\"{} = \"a\"\n```\n",
                "\"a\".split(".repeat(n),
                ")".repeat(n)
            )
        };
        let small = reading(&text(250), None);
        let large = reading(&text(1000), Some(five_times(small)));
        assert!(
            large.iter().zip(five_times(small)).all(|(&large, most)| large <= most),
            "{small:?} at 250, {large:?} at 1000"
        );
    }

    /// A call of many arguments reads in work that grows with its
    /// arguments, not with their square: the reader finds the call's parts
    /// once, not at each argument, before the arity error.
    #[test]
    fn a_call_of_many_arguments_reads_in_linear_work() {
        let text = |n: usize| {
            let arguments = vec!["$"; n].join(", ");
            format!(
                "```jbogenbau\n%ambiguity-resolution greedy\n%rule text :: $.parse({arguments}).tags | \"a\"\n```\n"
            )
        };
        assert!(read_grammar_document(&text(500), "").is_err(), "tags() of 500 arguments");
        let small = reading(&text(500), None);
        let large = reading(&text(2000), Some(five_times(small)));
        assert!(
            large.iter().zip(five_times(small)).all(|(&large, most)| large <= most),
            "{small:?} for 500 arguments, {large:?} for 2000"
        );
    }

    /// Constructs of many items side by side read in work that grows with
    /// their items, not with their square: a sequence, alternatives, a
    /// choice, a union, an intersection, a list of conditions and a
    /// disjunction.
    /// The shared cases nest their constructs, so each holds few items.
    #[test]
    fn wide_constructs_read_in_linear_work() {
        let wide = |n: usize, item: &str, joiner: &str| vec![item; n].join(joiner);
        let cases: [(&str, &dyn Fn(usize) -> String); 7] = [
            ("sequence", &|n| format!("%rule text {}", wide(n, "A", " "))),
            ("alternatives", &|n| format!("%rule text {}", wide(n, "A", " | "))),
            ("choice", &|n| format!("%rule text ({})", wide(n, "A", " | "))),
            ("union", &|n| format!("%rule text A :: {}", wide(n, "Tag-a", " ∪ "))),
            ("intersection", &|n| format!("%rule text A :: {}", wide(n, "Tag-a", " ∩ "))),
            ("conditions", &|n| format!("%rule text $x:A %conditions {}", wide(n, "$x.source-text = \"a\"", ", "))),
            ("disjunction", &|n| format!("%rule text $x:A %conditions {}", wide(n, "$x.source-text = \"a\"", " ∨ "))),
        ];
        for (name, text) in cases {
            let text = move |n: usize| format!("```jbogenbau\n%ambiguity-resolution greedy\n{}\n```\n", text(n));
            // Once first, so that loading the notation counts in neither.
            assert!(read_grammar_document(&text(250), "").is_ok(), "{name}");
            let small = reading(&text(250), None);
            let large = reading(&text(1000), Some(five_times(small)));
            assert!(
                large.iter().zip(five_times(small)).all(|(&large, most)| large <= most),
                "{name}: {small:?} for 250 items, {large:?} for 1000"
            );
        }
    }

    /// Tree construction over a right-recursive rule must stop quadratic
    /// searches for origins at the linear budget.
    #[test]
    fn quadratic_searches_for_origins_stop_at_the_budget() {
        for mutant in [Mutant::PositionsPerCall, Mutant::WalkEnding] {
            std::thread::Builder::new()
                .stack_size(2 << 20)
                .spawn(move || {
                    let pipeline = crate::load_pipeline_sources(
                        [("p.md", "```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%rule text \"a\" text | \"b\"\n```\n")],
                        "p.md",
                    ).expect("the recursive grammar");
                    let mut parse = |n| {
                        let text = format!("{}b", "a".repeat(n));
                        let result = pipeline.parse(&text, &crate::ParseOptions::default()).expect("a parse");
                        assert!(result.ok);
                    };
                    assert_linear(Work::Walked, 250, &mut parse);
                    assert_mutant_stops(Work::Walked, mutant, 250, &mut parse);
                })
                .expect("a thread")
                .join()
                .expect("a stop at the budget");
        }
    }
}

#[cfg(test)]
thread_local! {
    static LOCATION_RECOVERIES: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
mod ranked_location_tests {
    use super::*;

    #[test]
    fn bundled_cached_grammars_never_read_source() {
        let bundled = Context::bundled().unwrap();
        let notation = Arc::new(Pipeline::new(vec![], vec![], bundled.unicode.clone()).unwrap());
        // Every bundled family's cache, so that each bundled pipeline finds
        // its documents there.
        let mut preparsed = Preparsed::default();
        for (path, text) in bundled::BUNDLED.iter() {
            if !path.starts_with("data/preparsed/") || *path == BOOTSTRAP_PATH {
                continue;
            }
            let family = Preparsed::parse(
                text,
                &bootstrap_hash(),
                &fnv1a64(super::bundled("data/unicode/unicode.txt").unwrap()),
                bundled.unicode.properties_fingerprint.as_deref(),
            )
            .unwrap();
            preparsed.by_path.extend(family.by_path);
        }
        let notation_entries = Preparsed::parse_implicit(
            super::bundled(BOOTSTRAP_PATH).unwrap(),
            &bootstrap_hash(),
            &bundled.unicode_hash,
            bundled.unicode.properties_fingerprint.as_deref(),
            true,
        )
        .unwrap();
        preparsed.by_path.extend(notation_entries.by_path);
        let context = Context {
            unicode: bundled.unicode.clone(),
            notation,
            preparsed,
            bootstrap_hash: bundled.bootstrap_hash.clone(),
            unicode_hash: bundled.unicode_hash.clone(),
            allow_families: false,
        };
        let sources = MapSources {
            map: bundled::BUNDLED.iter().map(|(path, text)| (path.to_string(), text.to_string())).collect(),
        };
        for path in sources.map.keys().filter(|path| path.starts_with("grammars/") && path.ends_with("/pipeline.md")) {
            load(&context, &sources, path).expect("the preparsed grammar cache loads without notation stages");
        }
    }

    #[test]
    fn located_recipe_cycles_never_recover_locations() {
        let context = Context::bundled().unwrap();
        let sources = MapSources { map: [("p.md".into(),
            "```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%rule text \"a\" := $.emitted.image :- $.emitted.value\n```\n".into())].into() };
        LOCATION_RECOVERIES.with(|count| count.set(0));
        let error = load(&context, &sources, "p.md").unwrap_err();
        assert!(error.message.contains("recipe cycles"), "{error}");
        assert_eq!(error.line, Some(4));
        LOCATION_RECOVERIES.with(|count| assert_eq!(count.get(), 0));
    }

    #[test]
    fn valid_cached_ranked_grammar_never_recovers_locations() {
        let bundled = Context::bundled().unwrap();
        let pipeline = "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n";
        let grammar =
            "```jbogenbau\n%ambiguity-resolution late #·_<_Elided>\n%rule text Q (a ≻ b) Z\n%rule a X Y\n%rule b X Y\n```\n";
        let sources = MapSources { map: [("p.md".into(), pipeline.into()), ("g.md".into(), grammar.into())].into() };
        let mut preparsed = Preparsed::default();
        for (path, text) in &sources.map {
            let dom = read_document(&bundled.notation, text, "").unwrap();
            let cached = dom_from_json(&json::parse(&dom_to_json(&dom)).unwrap(), &bundled.unicode).unwrap();
            assert!(cached
                .rules
                .iter()
                .all(|rule| rule.alternatives.iter().all(|alt| alt.ranked_locations.is_empty())));
            preparsed.by_path.insert(
                path.clone(),
                (
                    fnv1a64(text),
                    PreparsedEntry { dom: Arc::new(json::parse(&dom_to_json(&dom)).unwrap()), names: None },
                ),
            );
        }
        // No notation stages can parse a document if the preparsed cache is bypassed.
        let notation = Arc::new(Pipeline::new(vec![], vec![], bundled.unicode.clone()).unwrap());
        let context = Context {
            unicode: bundled.unicode.clone(),
            notation,
            preparsed,
            bootstrap_hash: bundled.bootstrap_hash.clone(),
            unicode_hash: bundled.unicode_hash.clone(),
            allow_families: false,
        };
        LOCATION_RECOVERIES.with(|count| count.set(0));
        for _ in 0..2 {
            load(&context, &sources, "p.md").unwrap();
        }
        LOCATION_RECOVERIES.with(|count| assert_eq!(count.get(), 0, "source-location recovery ran"));
    }
}

#[cfg(test)]
mod notation_cache_tests {
    use super::*;
    use crate::test_common::{matches, parse_json};

    fn assert_pattern(case: &Json, actual: &str, path: &str) {
        let pattern = case.get("expect").unwrap().get("dom").unwrap();
        matches(&parse_json(&pattern.to_json()).unwrap(), &parse_json(actual).unwrap(), "dom")
            .unwrap_or_else(|error| panic!("{path}: {error}\n{actual}"));
    }

    fn cache_paths(base: &Context, bootstrap_hash: &str, path: &str, text: &str, expected: &str) {
        let cold = Context {
            unicode: base.unicode.clone(),
            notation: base.notation.clone(),
            preparsed: Preparsed::default(),
            bootstrap_hash: base.bootstrap_hash.clone(),
            unicode_hash: base.unicode_hash.clone(),
            allow_families: false,
        };
        for read in 0..2 {
            assert_eq!(dom_to_json(&cold.document(path, text, false).unwrap()), expected, "{path}: cold read {read}");
        }
        let mut poisoned = dom_from_json(&json::parse(expected).unwrap(), &base.unicode).unwrap();
        poisoned.rules[0].name = "cache-poison".into();
        let poisoned = dom_to_json(&poisoned);
        assert_eq!(dom_problem(&json::parse(&poisoned).unwrap(), &base.unicode), None, "{path}");
        let unicode_hash = fnv1a64(super::bundled("data/unicode/unicode.txt").unwrap());
        let document_hash = fnv1a64(text);
        let stale_bootstrap = fnv1a64("another bootstrap");
        let stale_unicode = fnv1a64("another unicode");
        let stale_document = fnv1a64("another document");
        for mismatch in [None, Some("document"), Some("bootstrap"), Some("unicode"), Some("format")] {
            let bootstrap = if mismatch == Some("bootstrap") { &stale_bootstrap } else { bootstrap_hash };
            let unicode = if mismatch == Some("unicode") { &stale_unicode } else { &unicode_hash };
            let hash = if mismatch == Some("document") { &stale_document } else { &document_hash };
            let format = if mismatch == Some("format") { DOM_FORMAT - 1 } else { DOM_FORMAT };
            let dom = if mismatch.is_some() { &poisoned } else { expected };
            let properties = base
                .unicode
                .properties_fingerprint
                .as_ref()
                .map(|hash| format!("\"{hash}\""))
                .unwrap_or_else(|| "null".to_string());
            let envelope = format!(
                r#"{{"format":{format},"bootstrap":"{bootstrap}","unicode":"{unicode}","properties":{properties},"documents":{{"{path}":{{"hash":"{hash}","dom":{dom}}}}}}}"#
            );
            let preparsed = Preparsed::parse(
                &envelope,
                bootstrap_hash,
                &unicode_hash,
                base.unicode.properties_fingerprint.as_deref(),
            )
            .unwrap();
            if mismatch.is_none() {
                assert_eq!(preparsed.by_path.len(), 1, "{path}: matching entry is admitted");
            }
            // A matching entry must work even without a notation reader.
            let notation = if mismatch.is_none() {
                Arc::new(Pipeline::new(vec![], vec![], base.unicode.clone()).unwrap())
            } else {
                base.notation.clone()
            };
            let context = Context {
                unicode: base.unicode.clone(),
                notation,
                preparsed,
                bootstrap_hash: base.bootstrap_hash.clone(),
                unicode_hash: base.unicode_hash.clone(),
                allow_families: false,
            };
            for read in 0..2 {
                let actual = context.document(path, text, false).unwrap();
                assert_eq!(dom_to_json(&actual), expected, "{path}: {mismatch:?}, read {read}");
            }
        }
    }

    #[test]
    fn shared_notation_cache_misses_cover_every_identity_field() {
        let bundled = Context::bundled().unwrap();
        let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/notation");
        let mut files: Vec<_> = std::fs::read_dir(directory)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.extension().is_some_and(|extension| extension == "json"))
            .collect();
        files.sort();
        let mut cases = 0;
        for file in files {
            let case = json::parse(&std::fs::read_to_string(&file).unwrap()).unwrap();
            if case.get("cacheMisses") != Some(&Json::Bool(true)) {
                continue;
            }
            cases += 1;
            let path = file.file_name().unwrap().to_str().unwrap();
            let text = case.get("document").and_then(Json::as_str).unwrap();
            let expected = dom_to_json(&read_document(&bundled.notation, text, "").unwrap());
            assert_pattern(&case, &expected, path);
            cache_paths(&bundled, &bootstrap_hash(), path, text, &expected);
            eprintln!("notation cache paths: {path}");
        }
        assert!(cases > 0, "no shared notation cache cases ran");
    }

    fn field<'a>(value: &'a mut Json, name: &str) -> &'a mut Json {
        let Json::Obj(members) = value else { panic!("expected an object") };
        &mut members.iter_mut().find(|(key, _)| key == name).unwrap().1
    }

    fn array(value: &mut Json) -> &mut Vec<Json> {
        let Json::Arr(items) = value else { panic!("expected an array") };
        items
    }

    fn object<const N: usize>(members: [(&str, Json); N]) -> Json {
        Json::Obj(members.into_iter().map(|(key, value)| (key.to_string(), value)).collect())
    }

    /// Adds the lexical aliases exactly as tests/README.md specifies.
    fn value_notation(aliases: &[Json]) -> String {
        let mut bootstrap = json::parse(super::bundled("data/preparsed/gencmu.json").unwrap()).unwrap();
        let document = field(field(&mut bootstrap, "documents"), "grammars/gencmu/jbogenbau/lexical.md");
        // The aliases count as `alias`, which a first step prefers.
        let directive = array(field(field(document, "dom"), "directives"))
            .iter_mut()
            .find(|directive| directive.get("name").and_then(Json::as_str) == Some("ambiguity-resolution"))
            .unwrap();
        let mut atoms: Vec<Json> = (0..aliases.len())
            .map(|index| {
                object([
                    ("name", Json::Str(format!("value-alias-{index}"))),
                    ("exact", Json::Bool(true)),
                    ("at", Json::Arr(vec![Json::Int(1), Json::Int(1)])),
                ])
            })
            .collect();
        if !atoms.is_empty() {
            let pattern = if atoms.len() == 1 { atoms.remove(0) } else { object([("union", Json::Arr(atoms))]) };
            array(field(directive, "steps"))
                .insert(0, object([("step", Json::Str("leftmost-longest".into())), ("pattern", pattern)]));
        }
        let rules = array(field(field(document, "dom"), "rules"));
        for (index, alias) in aliases.iter().enumerate() {
            let name = format!("value-alias-{index}");
            let tags: Vec<_> = alias
                .get("tags")
                .and_then(Json::as_array)
                .unwrap()
                .iter()
                .map(|tag| object([("tag", tag.clone())]))
                .collect();
            let tag_term = if tags.len() == 1 { tags[0].clone() } else { object([("union", Json::Arr(tags))]) };
            let expression = object([(
                "seq",
                Json::Arr(
                    alias
                        .get("spelling")
                        .and_then(Json::as_str)
                        .unwrap()
                        .chars()
                        .map(|scalar| object([("literal", object([("string", Json::Str(scalar.to_string()))]))]))
                        .collect(),
                ),
            )]);
            let piece = rules.iter_mut().find(|rule| rule.get("name").and_then(Json::as_str) == Some("piece")).unwrap();
            array(field(piece, "alternatives"))
                .push(object([("gates", Json::Arr(vec![])), ("expr", object([("ref", Json::Str(name.clone()))]))]));
            let emitted = object([
                ("capture", Json::Str(String::new())),
                ("tags", tag_term),
                (
                    "value",
                    object([("concat", Json::Arr(vec![object([("string", alias.get("value").unwrap().clone())])]))]),
                ),
            ]);
            rules.push(object([
                ("name", Json::Str(name)),
                ("op", Json::Str("define".into())),
                ("at", Json::Arr(vec![Json::Int(100000 + index as i64), Json::Int(1)])),
                ("conditions", Json::Arr(vec![])),
                ("alternatives", Json::Arr(vec![object([("gates", Json::Arr(vec![])), ("expr", expression)])])),
                ("emit", object([("items", Json::Arr(vec![emitted]))])),
            ]));
        }
        bootstrap.to_json()
    }

    fn run_supplied_notation_value(case: &Json) {
        crate::test_common::case::notation_value(&parse_json(&case.to_json()).unwrap())
            .unwrap_or_else(|problem| panic!("invalid supplied notation case: {problem}"));
        let id = case.get("id").and_then(Json::as_str).unwrap();
        let bootstrap = value_notation(case.get("aliases").and_then(Json::as_array).unwrap());
        let context = Context::new(super::bundled("data/unicode/unicode.txt").unwrap(), &bootstrap).unwrap();
        let text = case.get("document").and_then(Json::as_str).unwrap();
        if let Some(expected) = case.get("expect").and_then(|value| value.get("error")) {
            let error = read_document(&context.notation, text, "").expect_err("a bad name must fail");
            assert_eq!(error.line, expected.get("line").and_then(Json::as_int).map(|n| n as usize), "{id}: {error}");
            assert_eq!(
                error.column,
                expected.get("column").and_then(Json::as_int).map(|n| n as usize),
                "{id}: {error}"
            );
            if let Some(message) = case.get("expect").and_then(|value| value.get("message")) {
                assert_eq!(error.message, message.as_str().unwrap(), "{id}: the reader reason differs");
            }
            return;
        }
        let expected =
            dom_to_json(&read_document(&context.notation, text, "").unwrap_or_else(|error| panic!("{id}: {error}")));
        assert_pattern(case, &expected, id);
        cache_paths(&context, &fnv1a64(&bootstrap), &format!("{id}.md"), text, &expected);
        eprintln!("supplied notation values and cache paths: {id}");
    }

    #[test]
    fn shared_supplied_notation_values_cover_names_and_cache_paths() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/notation-values.json");
        let fixture = json::parse(&std::fs::read_to_string(path).unwrap()).unwrap();
        crate::test_common::case::notation_values_file(&parse_json(&fixture.to_json()).unwrap())
            .unwrap_or_else(|problem| panic!("invalid supplied notation file: {problem}"));
        let cases = fixture.get("cases").and_then(Json::as_array).unwrap();
        assert!(!cases.is_empty(), "no supplied notation cases ran");
        let mut ids = std::collections::HashSet::new();
        for case in cases {
            let id = case.get("id").and_then(Json::as_str).unwrap();
            assert!(ids.insert(id), "duplicate case ID: {id}");
            run_supplied_notation_value(case);
        }
    }

    #[test]
    fn supplied_notation_refuses_ignored_expectations() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/notation-values.json");
        let fixture = json::parse(&std::fs::read_to_string(path).unwrap()).unwrap();
        let base = fixture
            .get("cases")
            .and_then(Json::as_array)
            .unwrap()
            .iter()
            .find(|case| case.get("expect").unwrap().get("error").is_some())
            .unwrap();
        let mut accepted = Vec::new();
        for (name, nested) in [("message", true), ("message", false), ("unknown", false)] {
            let mut case = base.clone();
            let expectation = field(&mut case, "expect");
            let target = if nested { field(expectation, "error") } else { expectation };
            let Json::Obj(members) = target else { unreachable!() };
            members.push((name.into(), Json::Str("not the reader reason".into())));
            if std::panic::catch_unwind(|| run_supplied_notation_value(&case)).is_ok() {
                accepted.push(format!("accepted {name}, nested={nested}"));
            }
        }
        assert!(accepted.is_empty(), "{}", accepted.join("\n"));
    }

    #[test]
    fn supplied_notation_compares_the_reader_reason() {
        let mut case = json::parse(
            r#"{"id":"reader-reason","aliases":[],"document":"```jbogenbau\n%rule\n```","expect":{"error":{}}}"#,
        )
        .unwrap();
        let context = Context::bundled().unwrap();
        let document = case.get("document").and_then(Json::as_str).unwrap();
        let error = read_document(&context.notation, document, "").unwrap_err();
        *field(&mut case, "expect") = object([
            (
                "error",
                object([
                    ("line", Json::Int(error.line.unwrap() as i64)),
                    ("column", Json::Int(error.column.unwrap() as i64)),
                ]),
            ),
            ("message", Json::Str(error.message)),
        ]);
        run_supplied_notation_value(&case);
        *field(field(&mut case, "expect"), "message") = Json::Str(String::new());
        assert!(
            std::panic::catch_unwind(|| run_supplied_notation_value(&case)).is_err(),
            "ignored an empty expected reason"
        );
    }

    #[test]
    fn supplied_notation_refuses_invalid_metadata_before_reading() {
        let base =
            parse_json(r#"{"id":"metadata","aliases":[],"document":"","expect":{"error":{"line":1,"column":1}}}"#)
                .unwrap();
        for change in [
            r#"{"path":["expect","error","message"],"set":"nested"}"#,
            r#"{"path":["expect","unknown"],"set":true}"#,
            r#"{"path":["expect","error","line"],"set":true}"#,
            r#"{"path":["expect","error","line"],"set":0}"#,
            r#"{"path":["expect","error","column"],"remove":true}"#,
            r#"{"path":["expect"],"set":{"dom":false}}"#,
            r#"{"path":["expect","message"],"set":false}"#,
            r#"{"path":["expect"],"set":{"dom":{},"message":"requires an error"}}"#,
            r#"{"path":["expect","dom"],"set":{}}"#,
            r#"{"path":["unknown"],"set":true}"#,
            r#"{"path":["document"],"set":false}"#,
            r#"{"path":["aliases"],"set":[{"spelling":"x","value":"y","tags":[],"unknown":true}]}"#,
            r#"{"path":["aliases"],"set":[{"spelling":"x","value":"y","tags":[false]}]}"#,
            r#"{"path":["aliases"],"set":[{"spelling":"x","tags":[]}]}"#,
        ] {
            let case = crate::test_common::apply_mutant(&base, &parse_json(change).unwrap());
            assert!(crate::test_common::case::notation_value(&case).is_err(), "accepted invalid metadata: {change}");
        }
        let ordinary =
            parse_json(r#"{"document":"","expect":{"error":{"line":1,"column":1,"message":"ordinary reason"}}}"#)
                .unwrap();
        assert!(
            crate::test_common::case::notation(&ordinary).is_ok(),
            "ordinary notation retains its nested message field"
        );
    }
}

#[cfg(test)]
mod classifier_constant_errors {
    use super::*;

    #[test]
    fn undefined_classifier_key_constants_report_their_positions() {
        let context = Context::bundled().unwrap();
        for key in ["$NOPE", "$MISSING"] {
            let body = format!("%classifier c {key} ∈ K");
            let column = body.find(key).unwrap() + 1;
            let grammar = format!("```jbogenbau\n%ambiguity-resolution greedy\n{body}\n%rule text ε\n```\n");
            let sources = MapSources {
                map: [
                    ("p.md".into(), "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".into()),
                    ("g.md".into(), grammar),
                ]
                .into(),
            };
            let Err(error) = load(&context, &sources, "p.md") else {
                panic!("an undefined classifier key must fail");
            };
            assert!(error.message.contains(&format!("{key} is not defined")), "{error}");
            assert_eq!((error.line, error.column), (Some(3), Some(column)));
        }
    }
}

#[cfg(test)]
mod parameter_cache_tests {
    use super::*;
    #[test]
    fn parameter_cache_validates_source_and_accepts_normalized_arguments() {
        use crate::parameters::{get, list, obj, position, set, string};
        let base = Context::bundled().unwrap();
        let text = "```jbogenbau\n%ambiguity-resolution greedy\n%rule atom(@X) @X\n%rule text = atom(\"a\")\n```\n";
        let source = read_document(&base.notation, text, "").unwrap();
        let original = dom_to_json(&source);
        for valid in [true, false] {
            let mut raw = json::parse(&original).unwrap();
            let mut rules = list(get(&raw, "rules")).to_vec();
            if valid {
                let mut call = get(&rules[1], "instance").clone();
                set(&mut call, "args", json::parse(r#"[{"body":{"literal":{"string":"a"}}}]"#).unwrap());
                set(&mut rules[1], "instance", call);
            } else {
                let mut alts = list(get(&rules[0], "alternatives")).to_vec();
                set(&mut alts[0], "expr", obj([("param", string("Other")), ("at", position((3, 16)))]));
                set(&mut rules[0], "alternatives", Json::Arr(alts));
            }
            set(&mut raw, "rules", Json::Arr(rules));
            let mut preparsed = Preparsed::default();
            preparsed
                .by_path
                .insert("g.md".into(), (fnv1a64(text), PreparsedEntry { dom: Arc::new(raw.clone()), names: None }));
            let notation = if valid {
                Arc::new(Pipeline::new(vec![], vec![], base.unicode.clone()).unwrap())
            } else {
                base.notation.clone()
            };
            let context = Context {
                unicode: base.unicode.clone(),
                notation,
                preparsed,
                bootstrap_hash: base.bootstrap_hash.clone(),
                unicode_hash: base.unicode_hash.clone(),
                allow_families: false,
            };
            let d = context.document("g.md", text, false).unwrap();
            assert_eq!(dom_to_json(&d), if valid { raw.to_json() } else { original.clone() });
        }
    }
}

#[cfg(test)]
mod parameter_query_locations {
    use super::*;
    #[test]
    fn exact_call_targets_keep_their_written_positions() {
        let base = Context::bundled().unwrap();
        let line = "%rule text $x:atom(\"a\") %conditions $x.followed-by(atom(\"b\"))";
        let source = format!("```jbogenbau\n%rule atom(@X) @X\n{line}\n```\n");
        let dom = read_document(&base.notation, &source, "").unwrap();
        let x = crate::parameters::expand(&[(Arc::from("query.md"), Arc::new(dom))], &base.unicode).unwrap().unwrap();
        let r = x.documents.iter().flat_map(|(_, d)| &d.rules).find(|r| r.name == "text").unwrap();
        let crate::dom::Cond::Boundary(_, _, _, location) = &r.conditions[0] else { panic!("a boundary condition") };
        let method = line.find("$x.followed-by").unwrap() + 1;
        let target = line.find("atom(\"b\")").unwrap() + 1;
        assert_eq!(location.at, Some((3, method)));
        assert_eq!(location.targets, [(3, target)]);
    }
}
