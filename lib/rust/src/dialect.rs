//! A loaded dialect and the pipeline that runs it (engine §7, §11, §13).

use std::collections::{BTreeMap, BTreeSet};

use std::sync::{Arc, Mutex, OnceLock};

use crate::dom::{FeatureKind, Guard};
use crate::earley::{matchers, Chart, EngineError, Recognizer, Shared, Tok};
use crate::error::Error;
use crate::grammar::{Change, ClassifierTables, Lean, StageGrammar};
use crate::lower::{lower, Lowered, Prod, Sym, SymbolTest, TestOp};
use crate::maximal::Maximal;
use crate::rank::{Act, Ranker, Ranking, Verdict as RankVerdict};
use crate::recent::Recent;
use crate::result::{
    Action, AmbiguityReason, Expected, Node, NodeKind, ParseError, ParseErrorKind, ParseResult, Stage, Tags, Token,
    Verdict, Warning,
};
use crate::tags::character_tag;
use crate::tree::{build, emit, public_tree, warnings_of, IKind, ITree, TreeContext};
use crate::unicode::Unicode;

/// The options of [`Dialect::parse`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseOptions {
    /// Features to turn on for every stage, besides those the pipeline's
    /// `%features` turns on.
    pub features: Vec<String>,
    /// Features to turn off for every stage, among them any that the
    /// pipeline turns on. A name also in `features` is a usage error.
    pub without_features: Vec<String>,
    /// Add `sa-su` only where the text needs it (engine §13), unless
    /// `without_features` names it. On by default; ignored for a dialect
    /// with no stage named `words`, or one where `sa-su` is not a gate.
    pub auto_features: bool,
    /// The name of the last stage to run; all of them when `None`.
    pub until: Option<String>,
    /// Switch the `elision-only` check (engine §7) on or off for every
    /// stage, overriding the grammars' own directives; `None` follows them.
    pub elision_only: Option<bool>,
}

impl Default for ParseOptions {
    fn default() -> ParseOptions {
        ParseOptions {
            features: Vec::new(),
            without_features: Vec::new(),
            auto_features: true,
            until: None,
            elision_only: None,
        }
    }
}

/// One of a dialect's features (engine §13), as [`Dialect::features`]
/// lists them.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Feature {
    /// The feature's name.
    pub name: String,
    /// Whether it is a gate or a warning.
    pub kind: FeatureKind,
    /// Whether the pipeline's `%features` turns it on.
    pub default: bool,
}

/// A token given directly to the first stage, instead of the text's
/// characters: for tests and tools, such as the shared engine cases.
///
/// The original text of such a parse is the tokens' texts joined with
/// single spaces, and each token's source is its text's place in it. Each
/// token's label is its text (engine §5). It has no attachments, since a
/// caller cannot supply them (engine §11).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct InputToken {
    /// The token's text.
    pub text: String,
    /// Its tags, each in its canonical spelling (engine §1).
    pub tags: Tags,
    /// What it sounds like, if anything (engine §5).
    pub phonemes: Option<String>,
}

type LoweredResult = Result<Arc<Lowered>, EngineError>;
type ClassifiersResult = Result<Arc<ClassifierTables>, EngineError>;
/// A lowered grammar, or its error, built once by the first parse that
/// needs it.
type LoweredCell = Arc<OnceLock<LoweredResult>>;
type ClassifiersCell = Arc<OnceLock<ClassifiersResult>>;

/// The most lowered grammars, and the most classifier tables, that a stage
/// keeps. Each set of the stage's gates that is on has its own, so a stage
/// with k gates can have 2^k of them. The least recently used goes first.
const MAX_LOWERED: usize = 16;

/// A stage's lowered grammars and classifiers, each built once for a set
/// of its gates that is on.
struct StageCache {
    /// The features that gate an alternative or an entry of a classifier,
    /// in code point order. Only these change a lowered grammar. A warning
    /// keeps its alternative (engine §3.1), and any other name matches no
    /// guard (engine §13).
    gates: Vec<String>,
    /// The features that gate an entry of a classifier, in code point
    /// order. Only these change the classifiers.
    classifier_gates: Vec<String>,
    /// The lowered grammars, keyed by the gates that are on and by whether
    /// elidable optionals are mandatory.
    lowered: Mutex<Recent<(Vec<String>, bool), LoweredCell>>,
    /// The classifiers, keyed by the classifier gates that are on (§2).
    classifiers: Mutex<Recent<Vec<String>, ClassifiersCell>>,
}

impl StageCache {
    fn new(stage: &StageGrammar) -> StageCache {
        let entries: Vec<&Guard> = stage
            .classifiers
            .iter()
            .flat_map(|(_, classifier)| &classifier.entries)
            .flat_map(|entry| &entry.guards)
            .collect();
        let alternatives = stage
            .rules
            .iter()
            .flat_map(|rule| &rule.alternatives)
            .flat_map(|alternative| &alternative.alternative.guards);
        StageCache {
            gates: gate_names(alternatives.chain(entries.iter().copied())),
            classifier_gates: gate_names(entries.iter().copied()),
            lowered: Mutex::new(Recent::new(MAX_LOWERED)),
            classifiers: Mutex::new(Recent::new(MAX_LOWERED)),
        }
    }
}

/// The names of the features that gate, in code point order, each once.
fn gate_names<'a>(guards: impl Iterator<Item = &'a Guard>) -> Vec<String> {
    let names: BTreeSet<&String> =
        guards.filter(|guard| guard.kind == FeatureKind::Gate).map(|guard| &guard.feature).collect();
    names.into_iter().cloned().collect()
}

/// The names among `names` that are on in `features`.
fn names_on(names: &[String], features: &BTreeSet<String>) -> Vec<String> {
    names.iter().filter(|name| features.contains(*name)).cloned().collect()
}

/// A loaded dialect: a pipeline of stages, each a stitched grammar.
///
/// A `Dialect` is `Send` and `Sync`: one may be shared between threads and
/// used for any number of parses at once. The grammars it lowers for a set
/// of features, and the classifiers it resolves for them, are kept behind
/// a mutex and shared by later parses. Only a new set of the gates that are
/// on makes a new one. It keeps a bounded number of them, and builds each
/// one once, outside the mutex.
pub struct Dialect {
    pub(crate) stages: Vec<StageGrammar>,
    /// The features the pipeline's `%features` turns on.
    pub(crate) declared: Vec<String>,
    pub(crate) features: Vec<Feature>,
    pub(crate) unicode: Arc<Unicode>,
    pub(crate) changes: Vec<Change>,
    /// Each stage's lowered grammars and classifiers.
    caches: Vec<StageCache>,
}

impl std::fmt::Debug for Dialect {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Dialect").field("stages", &self.stage_names()).field("features", &self.features).finish()
    }
}

/// The state of a run between stages.
struct Run {
    stages: Vec<Stage>,
    input: Vec<Tok>,
    public_input: Vec<Token>,
    tree: Option<Node>,
    error: Option<ParseError>,
    /// The warnings of the stages run so far, in stage order (§12).
    warnings: Vec<Warning>,
}

/// A dialect's features (engine §13): every name a guard of a stage's
/// stitched rules uses, every gate of its classifiers' entries, and every
/// name the pipeline's `%features` declares, in code point order. A name
/// that one guard uses as a gate and another as a warning is an error of
/// the dialect; one that only `%features` declares is a gate.
fn dialect_features(stages: &[StageGrammar], declared: &[String]) -> Result<Vec<Feature>, Error> {
    let mut kinds: BTreeMap<&str, FeatureKind> = BTreeMap::new();
    for stage in stages {
        let rules = stage
            .rules
            .iter()
            .flat_map(|rule| &rule.alternatives)
            .flat_map(|alternative| &alternative.alternative.guards);
        let entries = stage.classifiers.iter().flat_map(|(_, classifier)| &classifier.entries);
        for guard in rules.chain(entries.flat_map(|entry| &entry.guards)) {
            if *kinds.entry(&guard.feature).or_insert(guard.kind) != guard.kind {
                return Err(Error::grammar(format!(
                    "the feature {} is used both as a gate and as a warning",
                    guard.feature
                )));
            }
        }
    }
    for name in declared {
        kinds.entry(name).or_insert(FeatureKind::Gate);
    }
    Ok(kinds
        .into_iter()
        .map(|(name, kind)| Feature { name: name.to_string(), kind, default: declared.iter().any(|on| on == name) })
        .collect())
}

/// Line and column, from 1, of a code point offset (lines end at `\n`,
/// `\r\n` or `\r`).
pub(crate) fn line_column(text: &[char], offset: usize) -> (usize, usize) {
    let mut line = 1;
    let mut column = 1;
    let mut index = 0;
    while index < offset.min(text.len()) {
        match text[index] {
            '\n' => {
                line += 1;
                column = 1;
            }
            '\r' => {
                if text.get(index + 1) == Some(&'\n') && index + 1 < offset {
                    index += 1;
                }
                line += 1;
                column = 1;
            }
            _ => column += 1,
        }
        index += 1;
    }
    (line, column)
}

impl Dialect {
    /// A dialect of stitched stages, whose pipeline's `%features` turns
    /// on `declared`; a feature used both as a gate and as a warning is an
    /// error of the dialect (engine §13).
    pub(crate) fn new(
        stages: Vec<StageGrammar>,
        declared: Vec<String>,
        unicode: Arc<Unicode>,
    ) -> Result<Dialect, Error> {
        let features = dialect_features(&stages, &declared)?;
        let changes = stages.iter().flat_map(|stage| stage.changes.iter().cloned()).collect();
        let caches = stages.iter().map(StageCache::new).collect();
        Ok(Dialect { stages, declared, features, unicode, changes, caches })
    }

    /// The names of the pipeline's stages, in order.
    pub fn stage_names(&self) -> Vec<&str> {
        self.stages.iter().map(|stage| stage.name.as_str()).collect()
    }

    /// The dialect's features (engine §13), each with its kind and whether
    /// the pipeline turns it on for every parse, in code point order of
    /// their names. The gates of the classifiers' entries are among them.
    pub fn features(&self) -> &[Feature] {
        &self.features
    }

    /// Every rule a later document replaced or extended, stage by stage.
    pub fn changes(&self) -> &[Change] {
        &self.changes
    }

    /// The stage's grammar lowered for a set of features, or the error of
    /// the grammar that lowering found (engine §3.3), which a parse reports
    /// as it reports any found while parsing.
    ///
    /// Only the gates that are on change the productions. So two sets of
    /// features with the same gates on share one lowered grammar. The first
    /// parse that needs it lowers it, outside the lock, so it does not hold
    /// up the parses that need other ones.
    fn lowered(&self, stage: usize, features: &BTreeSet<String>, mandatory: bool) -> LoweredResult {
        let cache = &self.caches[stage];
        let on = names_on(&cache.gates, features);
        let cell = cache
            .lowered
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get_or_insert_with((on.clone(), mandatory), Default::default);
        cell.get_or_init(|| {
            let on: BTreeSet<String> = on.into_iter().collect();
            // The stage resolves its classifiers for the same features,
            // before it lowers its rules (§2, §3).
            let classifiers = self.classifiers(stage, &on)?;
            lower(&self.stages[stage], &on, mandatory, classifiers)
                .map(Arc::new)
                .map_err(|error| EngineError { message: error.message, rule: Some(error.rule) })
        })
        .clone()
    }

    /// The stage's classifiers resolved for a set of features, or the error
    /// of the grammar that an entry makes for them (§2). Each set of the
    /// classifier gates that is on is resolved once, outside the lock.
    fn classifiers(&self, stage: usize, features: &BTreeSet<String>) -> ClassifiersResult {
        let cache = &self.caches[stage];
        let on = names_on(&cache.classifier_gates, features);
        let cell = cache
            .classifiers
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get_or_insert_with(on.clone(), Default::default);
        cell.get_or_init(|| {
            let on: BTreeSet<String> = on.into_iter().collect();
            self.stages[stage]
                .resolve_classifiers(&on)
                .map(Arc::new)
                .map_err(|message| EngineError { message, rule: None })
        })
        .clone()
    }

    /// Parses a text.
    ///
    /// A text that does not parse is not an error but a result whose `ok`
    /// is false; the error is for a caller's mistake, such as an unknown
    /// stage name in `until`.
    pub fn parse(&self, text: &str, options: &ParseOptions) -> Result<ParseResult, Error> {
        self.parse_chars(text.chars().collect(), options)
    }

    pub(crate) fn parse_chars(&self, chars: Vec<char>, options: &ParseOptions) -> Result<ParseResult, Error> {
        let unicode = self.unicode.clone();
        self.run(chars, options, move |tags, chars| {
            let mut input = Vec::with_capacity(chars.len());
            let mut public = Vec::with_capacity(chars.len());
            for (index, &c) in chars.iter().enumerate() {
                // Its character tag and nothing else (§1).
                let text = c.to_string();
                let set = tags.set_of([character_tag(c, &unicode).as_str()]);
                // A character token's label is its text (§5).
                public.push(Token {
                    text: text.clone(),
                    phonemes: None,
                    label: text.clone(),
                    tags: tags.to_set(set),
                    span: index..index + 1,
                    source: index..index + 1,
                    inserted_by: None,
                    before: Vec::new(),
                    after: Vec::new(),
                });
                input.push(Tok {
                    label: text.clone(),
                    text,
                    tags: set,
                    phonemes: None,
                    source: (index, index + 1),
                    sound: Default::default(),
                    before: Vec::new(),
                    after: Vec::new(),
                });
            }
            (input, public)
        })
    }

    /// Parses a sequence of tokens given directly to the first stage, for
    /// tests and tools (see [`InputToken`]).
    pub fn parse_tokens(&self, tokens: &[InputToken], options: &ParseOptions) -> Result<ParseResult, Error> {
        let joined: Vec<&str> = tokens.iter().map(|token| token.text.as_str()).collect();
        let chars: Vec<char> = joined.join(" ").chars().collect();
        let tokens = tokens.to_vec();
        self.run(chars, options, move |tags, _| {
            let mut input = Vec::with_capacity(tokens.len());
            let mut public = Vec::with_capacity(tokens.len());
            let mut at = 0;
            for (index, token) in tokens.iter().enumerate() {
                let length = token.text.chars().count();
                let set = tags.set_of(token.tags.iter().map(String::as_str));
                // A token that a caller supplies has its text as its label
                // (§5).
                public.push(Token {
                    text: token.text.clone(),
                    phonemes: token.phonemes.clone(),
                    label: token.text.clone(),
                    tags: tags.to_set(set),
                    span: index..index + 1,
                    source: at..at + length,
                    inserted_by: None,
                    before: Vec::new(),
                    after: Vec::new(),
                });
                input.push(Tok {
                    text: token.text.clone(),
                    tags: set,
                    phonemes: token.phonemes.clone(),
                    source: (at, at + length),
                    label: token.text.clone(),
                    sound: Default::default(),
                    before: Vec::new(),
                    after: Vec::new(),
                });
                at += length + 1;
            }
            (input, public)
        })
    }

    fn run(
        &self,
        chars: Vec<char>,
        options: &ParseOptions,
        first: impl FnOnce(&mut crate::tags::Tags, &[char]) -> (Vec<Tok>, Vec<Token>),
    ) -> Result<ParseResult, Error> {
        // The features on are the pipeline's, with the caller's added and
        // those the caller turns off removed (engine §13).
        let off = &options.without_features;
        if let Some(both) = options.features.iter().find(|name| off.contains(name)) {
            return Err(Error::usage(format!("the feature {both} is named both to turn on and to turn off")));
        }
        let mut features: BTreeSet<String> =
            self.declared.iter().chain(&options.features).filter(|name| !off.contains(name)).cloned().collect();
        let last = match &options.until {
            None => self.stages.len() - 1,
            Some(name) => self
                .stages
                .iter()
                .position(|stage| &stage.name == name)
                .ok_or_else(|| Error::usage(format!("the dialect has no stage named {name}")))?,
        };
        let mut shared = Shared::new(&self.unicode, &chars);
        let (input, public_input) = first(&mut shared.tags, &chars);
        let fresh = Run { stages: Vec::new(), input, public_input, tree: None, error: None, warnings: Vec::new() };
        let words = self.stages.iter().position(|stage| stage.name == "words");
        // Auto features add `sa-su` only in a dialect where it is a gate,
        // and never once the caller has turned it off (engine §13).
        let gated = self.features.iter().any(|feature| feature.name == "sa-su" && feature.kind == FeatureKind::Gate);
        let probe = options.auto_features
            && gated
            && !features.contains("sa-su")
            && !off.iter().any(|name| name == "sa-su")
            && words.is_some_and(|words| words <= last);
        let run = if let (true, Some(words)) = (probe, words) {
            let checkpoint = (fresh.input.clone(), fresh.public_input.clone());
            let mut run = fresh;
            self.stages_between(&mut shared, &mut run, &features, 0, words, options.elision_only);
            let reached = run.stages.len() == words + 1;
            // Unless `words` accepted, for whatever reason, and read no
            // word of SA or SU, the parse is run again with `sa-su`.
            let needs = !reached || run.error.is_some() || run.tree.as_ref().is_some_and(has_sa_su);
            if needs {
                // From the first stage again, the first run's stages and
                // warnings discarded.
                features.insert("sa-su".to_string());
                let mut again = Run {
                    stages: Vec::new(),
                    input: checkpoint.0,
                    public_input: checkpoint.1,
                    tree: None,
                    error: None,
                    warnings: Vec::new(),
                };
                shared.next_stage();
                self.stages_between(&mut shared, &mut again, &features, 0, last, options.elision_only);
                again
            } else {
                if run.error.is_none() && words < last {
                    self.stages_between(&mut shared, &mut run, &features, words + 1, last, options.elision_only);
                }
                run
            }
        } else {
            let mut run = fresh;
            self.stages_between(&mut shared, &mut run, &features, 0, last, options.elision_only);
            run
        };
        let ok = run.error.is_none();
        Ok(ParseResult {
            ok,
            stages: run.stages,
            tree: if ok { run.tree } else { None },
            error: run.error,
            warnings: run.warnings,
        })
    }

    fn stages_between(
        &self,
        shared: &mut Shared,
        run: &mut Run,
        features: &BTreeSet<String>,
        from: usize,
        to: usize,
        elision: Option<bool>,
    ) {
        for index in from..=to {
            shared.next_stage();
            let outcome = self.stage(index, shared, run, features, elision);
            if let Err(error) = outcome {
                run.error = Some(*error);
                return;
            }
        }
    }

    /// A defect of a grammar found while parsing: its stage and a message,
    /// and no position (engine §13).
    fn grammar_error(&self, index: usize, error: EngineError) -> ParseError {
        let stage = &self.stages[index];
        let rule = error.rule.and_then(|rule| stage.rules.get(rule as usize));
        let message = match rule {
            Some(rule) => format!("{} (the rule {} of {})", error.message, rule.name, rule.document),
            None => error.message,
        };
        ParseError {
            kind: ParseErrorKind::Grammar,
            stage: Some(stage.name.clone()),
            reason: None,
            token: None,
            source: None,
            document: None,
            line: None,
            column: None,
            expected: Vec::new(),
            readings: Vec::new(),
            message,
        }
    }

    /// Runs one stage over `run.input`, recording it; an error ends the run.
    fn stage(
        &self,
        index: usize,
        shared: &mut Shared,
        run: &mut Run,
        features: &BTreeSet<String>,
        elision: Option<bool>,
    ) -> Result<(), Box<ParseError>> {
        let grammar = &self.stages[index];
        let input = std::mem::take(&mut run.input);
        let public_input = std::mem::take(&mut run.public_input);
        let mut stage =
            Stage { name: grammar.name.clone(), input: public_input, output: None, verdict: None, witness: None };
        let lowered = match self.lowered(index, features, false) {
            Ok(lowered) => lowered,
            Err(error) => {
                let error = self.grammar_error(index, error);
                run.stages.push(stage);
                return Err(Box::new(error));
            }
        };
        let matchers = matchers(&lowered, &mut shared.tags);
        let chart = {
            let mut recognizer = Recognizer { g: &lowered, matchers: &matchers, shared };
            recognizer.recognize(&input, 0, lowered.start)
        };
        let chart = match chart {
            Ok(chart) => chart,
            Err(error) => {
                let error = self.grammar_error(index, error);
                run.stages.push(stage);
                return Err(Box::new(error));
            }
        };
        let n = input.len();
        let accepted = chart.accepts(lowered.start, n);
        let lean = grammar.lean;
        let maximal = grammar.maximal.then(|| Maximal::new(&lowered, &chart, &input, shared.unicode, &shared.tags));
        let ranked = if accepted {
            let mut ranker = Ranker::new(&lowered, &chart, &input, shared, lean, maximal.as_ref());
            ranker.rank().map(|ranking| {
                let first = build(&ranker, ranking.first);
                let second = ranking.second.map(|second| build(&ranker, second));
                (ranking, first, second)
            })
        } else {
            None
        };
        let Some((ranking, chosen, second)) = ranked else {
            // A text that `maximal` leaves with no derivation is rejected at
            // the first terminator it forbids in the first reading of the
            // ranking without `maximal`, whatever its verdict (§4).
            let forbidden = match &maximal {
                Some(maximal) if accepted => {
                    let mut ranker = Ranker::new(&lowered, &chart, &input, shared, lean, None);
                    ranker
                        .rank()
                        .and_then(|ranking| forbidden_terminator(&build(&ranker, ranking.first), &lowered, maximal))
                }
                _ => None,
            };
            let (position, expected) = forbidden.unwrap_or_else(|| rejection_of(&lowered, &chart));
            let error = self.rejection(index, shared, &input, position, expected);
            run.stages.push(stage);
            return Err(Box::new(error));
        };
        let tag_set = |set: u32| shared.tags.to_set(set);
        let context = TreeContext { g: &lowered, tokens: &input, tag_map: &tag_set, synthetic: None };
        stage.verdict = Some(match ranking.verdict {
            RankVerdict::Unique => Verdict::Unique,
            RankVerdict::Resolved => Verdict::Resolved,
            RankVerdict::Tie => Verdict::Tie,
        });
        if let Some((first, second)) = ranking.witness {
            stage.witness = Some([action(&lowered, first), action(&lowered, second)]);
        }
        // A tie is an error that ends the stage at its ranking: it has no
        // chosen tree, no output and no warnings, and the error holds the
        // first and the second reading (§6).
        if ranking.verdict == RankVerdict::Tie {
            let second = second.expect("a tie has a second reading");
            let readings = vec![public_tree(&chosen, &context), public_tree(&second, &context)];
            let error = self.tie(index, readings);
            run.stages.push(stage);
            return Err(Box::new(error));
        }
        let tree = public_tree(&chosen, &context);
        // The chosen tree's warnings, which stand even if the emission or
        // the `elision-only` check then fails (§12).
        run.warnings.extend(warnings_of(&chosen, &lowered, &input, features, &grammar.name));
        let emitted = {
            let mut recognizer = Recognizer { g: &lowered, matchers: &matchers, shared };
            emit(&mut recognizer, &chosen, &input)
        };
        let emitted = match emitted {
            Ok(emitted) => emitted,
            Err(error) => {
                let error = self.grammar_error(index, error);
                run.stages.push(stage);
                return Err(Box::new(error));
            }
        };
        let mut next = Vec::with_capacity(emitted.len());
        let mut public = Vec::with_capacity(emitted.len());
        for token in emitted {
            let text = shared.source_text(token.source.0, token.source.1);
            public.push(Token {
                text: text.clone(),
                phonemes: token.phonemes.clone(),
                label: token.label.clone(),
                tags: shared.tags.to_set(token.tags),
                span: token.span.0..token.span.1,
                source: token.source.0..token.source.1,
                inserted_by: token.inserted_by,
                before: token.before.clone(),
                after: token.after.clone(),
            });
            next.push(Tok {
                text,
                tags: token.tags,
                phonemes: token.phonemes,
                source: token.source,
                label: token.label,
                sound: Default::default(),
                before: token.before,
                after: token.after,
            });
        }
        // The check of `elision-only` runs after the emission, and only for
        // a stage that chose one of several derivations (§7).
        let check = elision.unwrap_or(grammar.elision_only);
        let mut ambiguous = None;
        if check && ranking.verdict == RankVerdict::Resolved {
            match self.elision_check(index, shared, &input, &chosen, &lowered, features) {
                Ok(found) => ambiguous = found,
                Err(error) => {
                    // The stage keeps its verdict and warnings, but it has
                    // no output.
                    let error = self.grammar_error(index, error);
                    run.stages.push(stage);
                    return Err(Box::new(error));
                }
            }
        }
        stage.output = Some(public.clone());
        run.stages.push(stage);
        // A stage ambiguous under `elision-only` chose its derivation: it
        // keeps its output, and the run ends with the error (§7).
        if let Some(error) = ambiguous {
            return Err(Box::new(error));
        }
        run.input = next;
        run.public_input = public;
        run.tree = Some(tree);
        Ok(())
    }

    /// The error of a stage whose ranking has two or more best derivations,
    /// with its first and its second reading (§6).
    fn tie(&self, index: usize, readings: Vec<Node>) -> ParseError {
        let stage = &self.stages[index].name;
        ParseError {
            kind: ParseErrorKind::Ambiguous,
            stage: Some(stage.clone()),
            reason: Some(AmbiguityReason::Tie),
            token: None,
            source: None,
            document: None,
            line: None,
            column: None,
            expected: Vec::new(),
            readings,
            message: format!("stage {stage} has two best readings of its text, a tie"),
        }
    }

    /// The error of a stage that rejected its input at the token `position`,
    /// where it expected `expected` (§4).
    fn rejection(
        &self,
        index: usize,
        shared: &Shared,
        input: &[Tok],
        position: usize,
        expected: Vec<Expected>,
    ) -> ParseError {
        let source = source_at(input, position);
        let (line, column) = line_column(shared.text, source.start);
        let stage = &self.stages[index].name;
        let found = input.get(position).map_or("the end of the input".to_string(), |token| format!("{:?}", token.text));
        let wanted: Vec<&str> = expected.iter().map(|expected| expected.terminal.as_str()).collect();
        let message = if wanted.is_empty() {
            format!("stage {stage} cannot read {found}")
        } else {
            format!("stage {stage} cannot read {found}; it expected {}", wanted.join(", "))
        };
        ParseError {
            kind: ParseErrorKind::Rejected,
            stage: Some(stage.clone()),
            reason: None,
            token: Some(position),
            source: Some(source),
            document: None,
            line: Some(line),
            column: Some(column),
            expected,
            readings: Vec::new(),
            message,
        }
    }

    /// The `elision-only` check (engine §7): `Some` error when the text is
    /// still ambiguous with the chosen tree's elided terminators written.
    fn elision_check(
        &self,
        index: usize,
        shared: &mut Shared,
        input: &[Tok],
        chosen: &ITree,
        g: &Lowered,
        features: &BTreeSet<String>,
    ) -> Result<Option<ParseError>, EngineError> {
        // The chosen tree's elided terminators in the order of its leaves,
        // each with its position and the string of its `=` test, if it has
        // one.
        let mut elided: Vec<(usize, &str, Option<&str>)> = Vec::new();
        let mut stack = vec![0u32];
        while let Some(index) = stack.pop() {
            let node = &chosen.nodes[index as usize];
            if let IKind::Close { prod, start, .. } = node.kind {
                let production = &g.prods[prod as usize];
                let rule = &g.rules[production.rule as usize];
                if let (true, Some(terminal), true) = (rule.helper, &rule.elided, production.syms.is_empty()) {
                    // Only the string of an `=` test gives the restored
                    // token a sound (§7).
                    let test =
                        rule.elided_test.map(|test| &g.tests[test as usize]).filter(|test| test.op == TestOp::Is);
                    elided.push((start as usize, terminal, test.and_then(|test| test.sound.as_deref())));
                }
            }
            stack.extend(node.children.iter().rev());
        }
        let mut tokens = Vec::with_capacity(input.len() + elided.len());
        let mut synthetic = Vec::with_capacity(input.len() + elided.len());
        let mut next = elided.iter().peekable();
        for position in 0..=input.len() {
            while let Some((_, terminal, sound)) = next.next_if(|(at, _, _)| *at == position) {
                let at = if position > 0 {
                    input[position - 1].source.1
                } else {
                    input.first().map_or(0, |token| token.source.0)
                };
                // A restored terminator with an `=` test sounds like the
                // test's string, so that it matches its own terminator in the
                // stricter grammar (§7).
                tokens.push(Tok {
                    text: String::new(),
                    tags: shared.tags.set_of([*terminal]),
                    phonemes: sound.map(str::to_string),
                    source: (at, at),
                    label: String::new(),
                    sound: Default::default(),
                    before: Vec::new(),
                    after: Vec::new(),
                });
                synthetic.push(true);
            }
            if position < input.len() {
                tokens.push(input[position].clone());
                synthetic.push(false);
            }
        }
        let lowered = self.lowered(index, features, true)?;
        let matchers = matchers(&lowered, &mut shared.tags);
        shared.next_stage();
        let chart = {
            let mut recognizer = Recognizer { g: &lowered, matchers: &matchers, shared };
            recognizer.recognize(&tokens, 0, lowered.start)
        };
        shared.next_stage();
        let chart = chart?;
        if !chart.accepts(lowered.start, tokens.len()) {
            return Ok(None);
        }
        // `maximal` does not apply here: the check's parse has no elided
        // terminator (§4).
        let mut ranker = Ranker::new(&lowered, &chart, &tokens, shared, Lean::Neither, None);
        let Some(Ranking { verdict: RankVerdict::Tie, first, second: Some(second), .. }) = ranker.rank() else {
            return Ok(None);
        };
        let first = build(&ranker, first);
        let second = build(&ranker, second);
        let tag_set = |set: u32| shared.tags.to_set(set);
        let context = TreeContext { g: &lowered, tokens: &tokens, tag_map: &tag_set, synthetic: Some(&synthetic) };
        let readings = vec![public_tree(&first, &context), public_tree(&second, &context)];
        let stage = &self.stages[index].name;
        Ok(Some(ParseError {
            kind: ParseErrorKind::Ambiguous,
            stage: Some(stage.clone()),
            reason: Some(AmbiguityReason::ElisionOnly),
            token: None,
            source: None,
            document: None,
            line: None,
            column: None,
            expected: Vec::new(),
            readings,
            message: format!(
                "stage {stage} is ambiguous with every elided terminator written, so the ambiguity is not about terminators"
            ),
        }))
    }
}

/// Where a rejected input stopped (§4): the furthest position any item
/// reached, and the terminals the items there could have read next, each
/// with the rules those items belong to.
fn rejection_of(g: &Lowered, chart: &Chart) -> (usize, Vec<Expected>) {
    let furthest = chart.reached;
    let mut expected: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut expect = |production: &Prod, dot: usize| {
        if let Some(Sym::T(terminal)) = production.syms.get(dot) {
            // A tested terminal is written with its test, and sorts by that
            // text (docs/output.md).
            let test = production.test(dot).map(|test| &g.tests[test as usize]);
            expected
                .entry(written_symbol(&g.terminals[*terminal as usize], test))
                .or_default()
                .insert(g.rules[production.owner as usize].name.clone());
        }
    };
    for item in &chart.sets[furthest].items {
        expect(&g.prods[item.prod as usize], item.dot as usize);
    }
    // The predictions the recognizer did not add, since the next token
    // could not continue them. Those whose condition failed are not among
    // them, since their items do not exist.
    for &production in &chart.sets[furthest].skipped {
        expect(&g.prods[production as usize], 0);
    }
    let expected = expected
        .into_iter()
        .map(|(terminal, rules)| Expected { terminal, rules: rules.into_iter().collect() })
        .collect();
    (furthest, expected)
}

/// Of a derivation, the first elided terminator, in the order of the
/// tree's leaves, that `maximal` forbids: its position, and its terminal
/// with the rule its optional is written in as the one expected there (§4).
/// `None` if it forbids none.
fn forbidden_terminator(tree: &ITree, g: &Lowered, maximal: &Maximal) -> Option<(usize, Vec<Expected>)> {
    // Each node on the path from the root, with the index of its next
    // child to visit.
    let mut stack: Vec<(u32, usize)> = vec![(0, 0)];
    while let Some(&mut (index, ref mut next)) = stack.last_mut() {
        let node = &tree.nodes[index as usize];
        let Some(&child) = node.children.get(*next) else {
            stack.pop();
            continue;
        };
        let position = *next;
        *next += 1;
        let IKind::Close { prod, .. } = node.kind else { unreachable!("a read has no children") };
        if let IKind::Close { prod: inner, start, end, .. } = tree.nodes[child as usize].kind {
            let helper = &g.prods[inner as usize];
            // The terminator's constituent is the node before it: there is
            // none at the start of a production, after a read, or after the
            // first symbol of a production when that is its own rule, what
            // a repetition has read so far.
            let production = &g.prods[prod as usize];
            let own = position == 1 && production.syms[0] == Sym::N(production.rule);
            if maximal.elided(helper.rule, start, end) && position > 0 && !own {
                let before = &tree.nodes[node.children[position - 1] as usize];
                if let IKind::Close { prod: constituent, start: from, end: to, .. } = before.kind {
                    let test = g.test(prod, position - 1);
                    if maximal.forbids(g.prods[constituent as usize].rule, from, to, test) {
                        let elided = &g.rules[helper.rule as usize];
                        let terminal = elided.elided.as_deref().expect("an elidable terminator");
                        let terminal = written_symbol(terminal, elided.elided_test.map(|test| &g.tests[test as usize]));
                        let rule = g.rules[helper.owner as usize].name.clone();
                        return Some((start as usize, vec![Expected { terminal, rules: vec![rule] }]));
                    }
                }
            }
        }
        stack.push((child, 0));
    }
    None
}

/// A terminal as the diagnostics write it: its name, followed by its test
/// if it has one, such as LE="la" (docs/output.md).
fn written_symbol(name: &str, test: Option<&SymbolTest>) -> String {
    match test {
        None => name.to_string(),
        Some(test) => format!("{name}{}", test.written),
    }
}

/// The source range of the token at `index`, or an empty range at the end
/// of the one before it for an index past the input.
fn source_at(input: &[Tok], index: usize) -> std::ops::Range<usize> {
    match input.get(index) {
        Some(token) => token.source.0..token.source.1,
        None => {
            let at = input.last().map_or(0, |token| token.source.1);
            at..at
        }
    }
}

fn action(g: &Lowered, act: Act) -> Action {
    match act {
        Act::Read { tok, terminal, .. } => {
            Action::Read { token: tok as usize, terminal: g.terminals[terminal as usize].clone() }
        }
        Act::Close { prod, start, end, .. } => Action::Close {
            rule: g.rules[g.prods[prod as usize].owner as usize].name.clone(),
            production: prod as usize,
            span: start as usize..end as usize,
        },
    }
}

/// Whether a tree has a constituent of the rule `word` whose tag set has
/// `SA` or `SU` (engine §13).
fn has_sa_su(tree: &Node) -> bool {
    let mut stack = vec![tree];
    while let Some(node) = stack.pop() {
        if node.kind == NodeKind::Rule
            && node.rule.as_deref() == Some("word")
            && (node.tags.contains("SA") || node.tags.contains("SU"))
        {
            return true;
        }
        stack.extend(node.children.iter());
    }
    false
}

#[cfg(test)]
mod tests {
    use super::{Dialect, ParseOptions, MAX_LOWERED};

    fn dialect(rules: &str) -> Dialect {
        let grammar = format!("```jbogenbau\n%ambiguity-resolution greedy\n{rules}\n```\n");
        let pipeline = "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n".to_string();
        crate::load_dialect_sources([("p.md".to_string(), pipeline), ("g.md".to_string(), grammar)], "p.md").unwrap()
    }

    fn cached(dialect: &Dialect) -> (usize, usize) {
        let cache = &dialect.caches[0];
        (cache.lowered.lock().unwrap().len(), cache.classifiers.lock().unwrap().len())
    }

    #[test]
    fn unused_names_share_one_lowering() {
        let dialect = dialect("%rule text f? 'x' | 'y'");
        for index in 0..50 {
            let options = ParseOptions {
                features: vec![format!("unused-{index}")],
                auto_features: false,
                ..ParseOptions::default()
            };
            assert!(dialect.parse("y", &options).unwrap().ok);
        }
        assert_eq!(cached(&dialect), (1, 1));
    }

    #[test]
    fn classifier_tables_are_bounded() {
        // Every set of five classifier gates, twice: the second round
        // resolves again the tables that the first round dropped.
        let names = ["a", "b", "c", "d", "e"];
        let entries: Vec<String> =
            names.iter().map(|name| format!("\n  {name}? \"x\" ∈ {}", name.to_uppercase())).collect();
        let entries = entries.concat();
        let dialect =
            dialect(&format!("%classifier c\n  \"x\" ∈ X{entries}\n%rule text $w('x') <classify(text($w), c)>"));
        for _ in 0..2 {
            for set in 0..1usize << names.len() {
                let features: Vec<String> = names
                    .iter()
                    .enumerate()
                    .filter(|(index, _)| set & (1 << index) != 0)
                    .map(|(_, name)| name.to_string())
                    .collect();
                let mut want: Vec<String> = features.iter().map(|name| name.to_uppercase()).collect();
                want.push("X".to_string());
                want.sort();
                let options = ParseOptions { features, auto_features: false, ..ParseOptions::default() };
                let result = dialect.parse("x", &options).unwrap();
                let tags: Vec<String> = result.tree.as_ref().expect("a tree").tags.iter().cloned().collect();
                assert_eq!(tags, want);
            }
        }
        assert!(cached(&dialect).1 <= MAX_LOWERED);
    }

    #[test]
    fn lowered_grammars_are_bounded() {
        let names = ["a", "b", "c", "d", "e", "f", "g"];
        let alternatives: Vec<String> = names.iter().map(|name| format!("{name}? 'x'")).collect();
        let dialect = dialect(&format!("%rule text {} | 'y'", alternatives.join(" | ")));
        for set in 0..1usize << names.len() {
            let features: Vec<String> = names
                .iter()
                .enumerate()
                .filter(|(index, _)| set & (1 << index) != 0)
                .map(|(_, name)| name.to_string())
                .collect();
            // The stage accepts its input whenever a feature is on, and ties
            // when two are.
            let count = features.len();
            let options = ParseOptions { features, auto_features: false, ..ParseOptions::default() };
            let result = dialect.parse("x", &options).unwrap();
            assert_eq!(result.stages[0].verdict.is_some(), count > 0);
            assert_eq!(result.ok, count == 1);
        }
        let (lowered, classifiers) = cached(&dialect);
        assert!(lowered <= MAX_LOWERED && classifiers <= MAX_LOWERED, "{lowered} {classifiers}");
    }
}
