//! A loaded dialect and the pipeline that runs it (engine §7, §11, §13).

use std::collections::{BTreeMap, BTreeSet};

use crate::fxhash::FxMap;
use std::sync::{Arc, Mutex};

use crate::earley::{EngineError, Recognizer, Shared, Tok};
use crate::error::Error;
use crate::grammar::{Change, Lean, StageGrammar};
use crate::lower::{lower, Lowered, Sym};
use crate::rank::{Act, Ranker, Ranking, Verdict as RankVerdict};
use crate::result::{
    Action, Expected, Node, NodeKind, ParseError, ParseErrorKind, ParseResult, Stage, Tags, Token, Verdict,
};
use crate::tree::{build, emit, public_tree, TreeContext};
use crate::unicode::Unicode;

/// The options of [`Dialect::parse`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseOptions {
    /// Features to enable for every stage, besides those the pipeline's
    /// `<?features?>` enables.
    pub features: Vec<String>,
    /// Add `sa-su` only where the text needs it (engine §13). On by
    /// default; ignored for a dialect with no stage named `words`.
    pub auto_features: bool,
    /// The name of the last stage to run; all of them when `None`.
    pub until: Option<String>,
    /// Switch the `elision-only` check (engine §7) on or off for every
    /// stage, overriding the grammars' own directives; `None` follows them.
    pub elision_only: Option<bool>,
}

impl Default for ParseOptions {
    fn default() -> ParseOptions {
        ParseOptions { features: Vec::new(), auto_features: true, until: None, elision_only: None }
    }
}

/// A token given directly to the first stage, instead of the text's
/// characters: for tests and tools, such as the shared engine cases.
///
/// The original text of such a parse is the tokens' texts joined with
/// single spaces, and each token's source is its text's place in it.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct InputToken {
    /// The token's text.
    pub text: String,
    /// Its tags, `true` for strong.
    pub tags: Tags,
    /// What it sounds like, if anything (engine §5).
    pub phonemes: Option<String>,
}

type LoweredKey = (usize, Vec<String>, bool);

/// A loaded dialect: a pipeline of stages, each a stitched grammar.
///
/// A `Dialect` is `Send` and `Sync`: one may be shared between threads and
/// used for any number of parses at once. The grammars it lowers for a set
/// of features are kept behind a mutex and shared by later parses.
pub struct Dialect {
    pub(crate) stages: Vec<StageGrammar>,
    pub(crate) features: Vec<String>,
    pub(crate) unicode: Arc<Unicode>,
    pub(crate) changes: Vec<Change>,
    lowered: Mutex<FxMap<LoweredKey, Arc<Lowered>>>,
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
    pub(crate) fn new(stages: Vec<StageGrammar>, features: Vec<String>, unicode: Arc<Unicode>) -> Dialect {
        let changes = stages.iter().flat_map(|stage| stage.changes.iter().cloned()).collect();
        Dialect { stages, features, unicode, changes, lowered: Mutex::new(FxMap::default()) }
    }

    /// The names of the pipeline's stages, in order.
    pub fn stage_names(&self) -> Vec<&str> {
        self.stages.iter().map(|stage| stage.name.as_str()).collect()
    }

    /// The features the pipeline enables for every parse.
    pub fn features(&self) -> &[String] {
        &self.features
    }

    /// Every rule a later document replaced or extended, stage by stage.
    pub fn changes(&self) -> &[Change] {
        &self.changes
    }

    fn lowered(&self, stage: usize, features: &BTreeSet<String>, mandatory: bool) -> Arc<Lowered> {
        let key = (stage, features.iter().cloned().collect(), mandatory);
        let mut cache = self.lowered.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        cache.entry(key).or_insert_with(|| Arc::new(lower(&self.stages[stage], features, mandatory))).clone()
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
                let text = c.to_string();
                let class = unicode.class(c);
                let set = tags.set_of([(text.as_str(), true), (class, false)]);
                public.push(Token {
                    text: text.clone(),
                    phonemes: None,
                    tags: tags.to_map(set),
                    span: index..index + 1,
                    source: index..index + 1,
                    inserted_by: None,
                });
                input.push(Tok { text, tags: set, phonemes: None, source: (index, index + 1) });
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
                let set = tags.set_of(token.tags.iter().map(|(name, &strong)| (name.as_str(), strong)));
                public.push(Token {
                    text: token.text.clone(),
                    phonemes: token.phonemes.clone(),
                    tags: tags.to_map(set),
                    span: index..index + 1,
                    source: at..at + length,
                    inserted_by: None,
                });
                input.push(Tok {
                    text: token.text.clone(),
                    tags: set,
                    phonemes: token.phonemes.clone(),
                    source: (at, at + length),
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
        let last = match &options.until {
            None => self.stages.len() - 1,
            Some(name) => self
                .stages
                .iter()
                .position(|stage| &stage.name == name)
                .ok_or_else(|| Error::usage(format!("the dialect has no stage named {name}")))?,
        };
        let mut features: BTreeSet<String> = self.features.iter().cloned().collect();
        features.extend(options.features.iter().cloned());
        let mut shared = Shared::new(&self.unicode, &chars);
        let (input, public_input) = first(&mut shared.tags, &chars);
        let fresh = Run { stages: Vec::new(), input, public_input, tree: None, error: None };
        let words = self.stages.iter().position(|stage| stage.name == "words");
        let probe = options.auto_features && !features.contains("sa-su") && words.is_some_and(|words| words <= last);
        let run = if let (true, Some(words)) = (probe, words) {
            let checkpoint = (fresh.input.clone(), fresh.public_input.clone());
            let mut run = fresh;
            self.stages_between(&mut shared, &mut run, &features, 0, words, options.elision_only);
            let reached = run.stages.len() == words + 1;
            let rejected = run.error.as_ref().is_some_and(|error| error.kind == ParseErrorKind::Rejected);
            let needs = if reached {
                rejected || run.tree.as_ref().is_some_and(|tree| has_sa_su(tree, &run.stages[words].input))
            } else {
                false
            };
            if needs {
                features.insert("sa-su".to_string());
                let mut again = Run {
                    stages: Vec::new(),
                    input: checkpoint.0,
                    public_input: checkpoint.1,
                    tree: None,
                    error: None,
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
        Ok(ParseResult { ok, stages: run.stages, tree: if ok { run.tree } else { None }, error: run.error })
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

    fn grammar_error(&self, index: usize, shared: &Shared, input: &[Tok], error: EngineError) -> ParseError {
        let stage = &self.stages[index];
        let mut out = ParseError {
            kind: ParseErrorKind::Grammar,
            stage: Some(stage.name.clone()),
            token: error.token,
            source: error.token.map(|token| source_at(input, token)),
            document: None,
            line: None,
            column: None,
            expected: Vec::new(),
            readings: Vec::new(),
            message: error.message,
        };
        if let Some(rule) = error.rule {
            if let Some(stitched) = stage.rules.get(rule as usize) {
                out.document = Some(stitched.document.to_string());
                out.line = Some(stitched.at.0);
                out.column = Some(stitched.at.1);
            }
        } else if let Some(source) = &out.source {
            let (line, column) = line_column(shared.text, source.start);
            out.line = Some(line);
            out.column = Some(column);
        }
        out
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
        let lowered = self.lowered(index, features, false);
        let term_tags: Vec<u32> = lowered.terminals.iter().map(|name| shared.tags.tag(name)).collect();
        let input = std::mem::take(&mut run.input);
        let public_input = std::mem::take(&mut run.public_input);
        let mut stage = Stage {
            name: grammar.name.clone(),
            input: public_input,
            output: None,
            verdict: None,
            witness: None,
            tied: None,
        };
        let chart = {
            let mut recognizer = Recognizer { g: &lowered, term_tags: &term_tags, shared };
            recognizer.recognize(&input, 0, lowered.start)
        };
        let mut chart = match chart {
            Ok(chart) => chart,
            Err(error) => {
                let error = self.grammar_error(index, shared, &input, error);
                run.stages.push(stage);
                return Err(Box::new(error));
            }
        };
        let n = input.len();
        let accepted = chart.sets[n].completed.contains_key(&(lowered.start, 0));
        let lean = grammar.lean;
        let ranked = if accepted {
            let mut ranker = Ranker::new(&lowered, &mut chart, &input, &shared.tags, &term_tags, lean);
            ranker.rank().map(|ranking| {
                let chosen = build(&ranker, ranking.chosen);
                let tied = ranking.tied.map(|tied| build(&ranker, tied));
                (ranking, chosen, tied)
            })
        } else {
            None
        };
        let Some((ranking, chosen, tied)) = ranked else {
            let error = self.rejection(index, shared, &lowered, &chart, &input);
            run.stages.push(stage);
            return Err(Box::new(error));
        };
        let tag_map = |set: u32| shared.tags.to_map(set);
        let context = TreeContext { g: &lowered, tokens: &input, tag_map: &tag_map, synthetic: None };
        let tree = public_tree(&chosen, &context);
        stage.verdict = Some(match ranking.verdict {
            RankVerdict::Unique => Verdict::Unique,
            RankVerdict::Resolved => Verdict::Resolved,
            RankVerdict::Tie => Verdict::Tie,
        });
        if let Some(tied) = &tied {
            stage.tied = Some(public_tree(tied, &context));
        }
        if let Some((first, second)) = ranking.witness {
            stage.witness = Some([action(&lowered, first), action(&lowered, second)]);
        }
        let check = elision.unwrap_or(grammar.elision_only);
        if check && ranking.verdict != RankVerdict::Unique {
            match self.elision_check(index, shared, &input, &tree, features) {
                Ok(None) => {}
                Ok(Some(error)) => {
                    run.stages.push(stage);
                    return Err(Box::new(error));
                }
                Err(error) => {
                    let error = self.grammar_error(index, shared, &input, error);
                    run.stages.push(stage);
                    return Err(Box::new(error));
                }
            }
        }
        let emitted = {
            let mut recognizer = Recognizer { g: &lowered, term_tags: &term_tags, shared };
            emit(&mut recognizer, &chosen, &input)
        };
        let emitted = match emitted {
            Ok(emitted) => emitted,
            Err(error) => {
                let error = self.grammar_error(index, shared, &input, error);
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
                tags: shared.tags.to_map(token.tags),
                span: token.span.0..token.span.1,
                source: token.source.0..token.source.1,
                inserted_by: token.inserted_by,
            });
            next.push(Tok { text, tags: token.tags, phonemes: token.phonemes, source: token.source });
        }
        stage.output = Some(public.clone());
        run.stages.push(stage);
        run.input = next;
        run.public_input = public;
        run.tree = Some(tree);
        Ok(())
    }

    fn rejection(
        &self,
        index: usize,
        shared: &Shared,
        g: &Lowered,
        chart: &crate::earley::Chart,
        input: &[Tok],
    ) -> ParseError {
        let furthest = (0..chart.sets.len()).rev().find(|&e| !chart.sets[e].items.is_empty()).unwrap_or(0);
        let mut expected: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        let mut expect = |production: &crate::lower::Prod, dot: usize| {
            if let Some(Sym::T(terminal)) = production.syms.get(dot) {
                expected
                    .entry(g.terminals[*terminal as usize].clone())
                    .or_default()
                    .insert(g.rules[production.owner as usize].name.clone());
            }
        };
        for item in &chart.sets[furthest].items {
            expect(&g.prods[item.prod as usize], item.dot as usize);
        }
        // The predictions the recognizer did not add, since the next token
        // could not continue them.
        for &rule in &chart.sets[furthest].predicted {
            for &production in &g.rules[rule as usize].prods {
                expect(&g.prods[production as usize], 0);
            }
        }
        let source = source_at(input, furthest);
        let (line, column) = line_column(shared.text, source.start);
        let stage = &self.stages[index].name;
        let found = input.get(furthest).map_or("the end of the input".to_string(), |token| format!("{:?}", token.text));
        let wanted: Vec<&str> = expected.keys().map(String::as_str).collect();
        let message = if wanted.is_empty() {
            format!("stage {stage} cannot read {found}")
        } else {
            format!("stage {stage} cannot read {found}; it expected {}", wanted.join(", "))
        };
        ParseError {
            kind: ParseErrorKind::Rejected,
            stage: Some(stage.clone()),
            token: Some(furthest),
            source: Some(source),
            document: None,
            line: Some(line),
            column: Some(column),
            expected: expected
                .into_iter()
                .map(|(terminal, rules)| Expected { terminal, rules: rules.into_iter().collect() })
                .collect(),
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
        tree: &Node,
        features: &BTreeSet<String>,
    ) -> Result<Option<ParseError>, EngineError> {
        let mut elided: Vec<(usize, String)> = Vec::new();
        let mut stack = vec![tree];
        while let Some(node) = stack.pop() {
            if node.kind == NodeKind::Elided {
                elided.push((node.span.start, node.terminal.clone().unwrap_or_default()));
            }
            stack.extend(node.children.iter().rev());
        }
        let mut tokens = Vec::with_capacity(input.len() + elided.len());
        let mut synthetic = Vec::with_capacity(input.len() + elided.len());
        let mut next = elided.iter().peekable();
        for position in 0..=input.len() {
            while let Some((_, terminal)) = next.next_if(|(at, _)| *at == position) {
                let at = if position > 0 {
                    input[position - 1].source.1
                } else {
                    input.first().map_or(0, |token| token.source.0)
                };
                tokens.push(Tok {
                    text: String::new(),
                    tags: shared.tags.set_of([(terminal.as_str(), true)]),
                    phonemes: None,
                    source: (at, at),
                });
                synthetic.push(true);
            }
            if position < input.len() {
                tokens.push(input[position].clone());
                synthetic.push(false);
            }
        }
        let lowered = self.lowered(index, features, true);
        let term_tags: Vec<u32> = lowered.terminals.iter().map(|name| shared.tags.tag(name)).collect();
        shared.next_stage();
        let chart = {
            let mut recognizer = Recognizer { g: &lowered, term_tags: &term_tags, shared };
            recognizer.recognize(&tokens, 0, lowered.start)
        };
        shared.next_stage();
        let mut chart = chart?;
        if !chart.sets[tokens.len()].completed.contains_key(&(lowered.start, 0)) {
            return Ok(None);
        }
        let mut ranker = Ranker::new(&lowered, &mut chart, &tokens, &shared.tags, &term_tags, Lean::TagsOnly);
        let Some(Ranking { verdict: RankVerdict::Tie, chosen, tied: Some(tied), witness }) = ranker.rank() else {
            return Ok(None);
        };
        let chosen = build(&ranker, chosen);
        let tied = build(&ranker, tied);
        let tag_map = |set: u32| shared.tags.to_map(set);
        let context = TreeContext { g: &lowered, tokens: &tokens, tag_map: &tag_map, synthetic: Some(&synthetic) };
        let readings = vec![public_tree(&chosen, &context), public_tree(&tied, &context)];
        let at = match witness {
            Some((Act::Read { tok, .. }, _)) => tok as usize,
            Some((Act::Close { start, .. }, _)) => start as usize,
            None => 0,
        };
        let token = at - synthetic[..at].iter().filter(|&&flag| flag).count();
        let source = source_at(input, token);
        let (line, column) = line_column(shared.text, source.start);
        let stage = &self.stages[index].name;
        Ok(Some(ParseError {
            kind: ParseErrorKind::Ambiguous,
            stage: Some(stage.clone()),
            token: Some(token),
            source: Some(source),
            document: None,
            line: Some(line),
            column: Some(column),
            expected: Vec::new(),
            readings,
            message: format!(
                "stage {stage} is ambiguous with every elided terminator written, so the ambiguity is not about terminators"
            ),
        }))
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

/// Whether a tree has a constituent of the rule `word` whose phonemes are
/// `sa` or `su` (engine §13).
fn has_sa_su(tree: &Node, input: &[Token]) -> bool {
    let mut stack = vec![tree];
    while let Some(node) = stack.pop() {
        if node.kind == NodeKind::Rule && node.rule.as_deref() == Some("word") {
            let phonemes: String =
                input[node.span.clone()].iter().filter_map(|token| token.phonemes.as_deref()).collect();
            if phonemes == "sa" || phonemes == "su" {
                return true;
            }
        }
        stack.extend(node.children.iter());
    }
    false
}
