//! Loading a dialect (docs/api.md): its pipeline document, the grammar
//! documents it names, read through the notation or taken from the DOM
//! cache, stitched stage by stage.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, OnceLock};

use crate::dialect::{Dialect, ParseOptions};
use crate::dom::{dom_from_json, dom_to_json, Dom, DOM_FORMAT};
use crate::error::{Error, ErrorKind};
use crate::grammar::stitch;
use crate::json::{self, fnv1a64, Json};
use crate::markdown::{grammar_text, pipeline, resolve};
use crate::notation::Reader;
use crate::result::ParseErrorKind;
use crate::unicode::Unicode;

mod bundled {
    include!(concat!(env!("OUT_DIR"), "/bundled.rs"));
}

pub(crate) fn bundled(path: &str) -> Option<&'static str> {
    bundled::BUNDLED.iter().find(|(name, _)| *name == path).map(|(_, text)| *text)
}

/// The precompiled DOMs of `compiled.json`, usable only when its format
/// and bootstrap hash match.
#[derive(Default)]
struct Compiled {
    by_path: HashMap<String, (String, Json)>,
    by_hash: HashMap<String, Json>,
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
        for (path, entry) in value.get("documents").and_then(Json::as_object).unwrap_or(&[]) {
            if let (Some(hash), Some(dom)) = (entry.get("hash").and_then(Json::as_str), entry.get("dom")) {
                compiled.by_path.insert(path.clone(), (hash.to_string(), dom.clone()));
                compiled.by_hash.insert(hash.to_string(), dom.clone());
            }
        }
        Ok(compiled)
    }

    fn lookup(&self, path: &str, hash: &str) -> Option<Dom> {
        let dom = match self.by_path.get(path) {
            Some((known, dom)) if known == hash => Some(dom),
            _ => self.by_hash.get(hash),
        }?;
        dom_from_json(dom).ok()
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
                    dom_from_json(dom).map_err(|message| grammar_error(format!("bootstrap.json: {message}")))
                })?;
            documents.push((path, Arc::new(dom)));
        }
        stages.push(stitch(&name, &documents)?);
    }
    if stages.is_empty() {
        return Err(grammar_error("bootstrap.json has no stages".to_string()));
    }
    Ok(Dialect::new(stages, Vec::new(), unicode))
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
        if let Some(dom) = self.compiled.lookup(path, &fnv1a64(text)) {
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
    let position = |index: usize| grammar.position(index);
    let reader = Reader { tokens: &stage.input, captures: Default::default(), position: &position };
    reader.document(tree)
}

/// Where a loader finds its documents.
trait Sources {
    fn read(&self, path: &str) -> Result<String, Error>;
    fn resolve(&self, base: &str, target: &str) -> Option<String>;
}

struct MapSources {
    map: HashMap<String, String>,
}

impl Sources for MapSources {
    fn read(&self, path: &str) -> Result<String, Error> {
        self.map
            .get(path)
            .cloned()
            .ok_or_else(|| Error::grammar(format!("the document {path} is missing")).in_document(path))
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
    fn read(&self, path: &str) -> Result<String, Error> {
        std::fs::read_to_string(path)
            .map_err(|error| Error::new(ErrorKind::Io, format!("cannot read {path}: {error}")).in_document(path))
    }

    fn resolve(&self, base: &str, target: &str) -> Option<String> {
        if target.contains("://") {
            return None;
        }
        let directory = Path::new(base).parent().unwrap_or_else(|| Path::new(""));
        Some(normalize(&directory.join(target)).to_string_lossy().into_owned())
    }
}

fn load(context: &Context, sources: &dyn Sources, pipeline_path: &str) -> Result<Dialect, Error> {
    let text = sources.read(pipeline_path)?;
    let pipeline = pipeline(&text).map_err(|error| error.in_document(pipeline_path))?;
    let mut stages = Vec::new();
    for stage in &pipeline.stages {
        let mut documents = Vec::new();
        for (target, line) in &stage.documents {
            let located =
                |message: String| Error::grammar(message).in_document(pipeline_path).at(*line, 1).in_stage(&stage.name);
            let path = sources
                .resolve(pipeline_path, target)
                .ok_or_else(|| located(format!("the document path {target} leaves the grammars")))?;
            let text = sources.read(&path).map_err(|error| located(error.message))?;
            let dom = context.document(&path, &text).map_err(|error| error.in_stage(&stage.name))?;
            documents.push((Arc::<str>::from(path.as_str()), Arc::new(dom)));
        }
        stages.push(stitch(&stage.name, &documents).map_err(|error| error.in_stage(&stage.name))?);
    }
    Ok(Dialect::new(stages, pipeline.features, context.unicode.clone()))
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

/// Loads a dialect from a pipeline document on disk. Its grammar documents
/// are found relative to it; the character table and the notation's
/// bootstrap come from the bundled grammars.
pub fn load_dialect_file(path: impl AsRef<Path>) -> Result<Dialect, Error> {
    let context = Context::bundled()?;
    load(&context, &DiskSources, &path.as_ref().to_string_lossy())
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

/// The FNV-1a hash of the bundled `notation/bootstrap.json` (engine §8).
pub fn bootstrap_hash() -> String {
    fnv1a64(bundled("notation/bootstrap.json").unwrap_or(""))
}

#[cfg(test)]
mod tests {
    use super::normalize;
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
}
