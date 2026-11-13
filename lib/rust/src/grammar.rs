//! Stitching a stage's documents into one grammar (engine §2), with the
//! checks that need no features: directives, definitions, references,
//! captures and terms.

use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;

use crate::clauses::check_definition;
use crate::dom::{
    constant_value_type, constants_in_rule, constants_in_term, expected_problem, rule_type_fault, term_type_in,
    Alternative, Arg, Channels, ClassifierDef, Cond, ConstDef, Directive, Dom, EmitItem, Expr, Fault, FeatureKind,
    ImplicationDef, Op, RuleDef, Term, Type,
};
use crate::error::Error;
use crate::fxhash::{FxMap, FxSet};
use crate::patterns::Pattern;
use crate::unicode::Unicode;
use crate::work::{self, Mutant, Work};

/// The last step of a stage's `%ambiguity-resolution`, which compares the
/// actions of the derivations with the greatest profile (engine §6).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Lean {
    Greedy,
    Lazy,
    /// Neither: any two derivations with the greatest profile are tied, as
    /// a directive with no lean and the `elision-only` check rank (§6, §7).
    Neither,
}

/// How a key step of `%ambiguity-resolution` compares its pattern's
/// occurrences (engine §6).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum StepKind {
    /// Counts per nonempty span, by increasing start, then decreasing end,
    /// then the greater count.
    LeftmostLongest,
    /// The total count, the smaller winning.
    Fewest,
    /// The total count, the greater winning.
    Most,
    /// Counts per start boundary, fewer winning at the first that differs.
    Late,
    /// Counts per start boundary, more winning at the first that differs.
    Early,
}

/// A key step of `%ambiguity-resolution`: how it compares, and the
/// pattern whose occurrences it counts (engine §6).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct KeyStep {
    pub kind: StepKind,
    pub pattern: crate::patterns::Pattern,
}

/// The clauses of a rule, which each of its alternatives shares, so that
/// they are stored, substituted and checked once for the rule.
#[derive(Debug, Clone)]
pub(crate) struct RuleClauses {
    pub tags: Option<Term>,
    pub strings: Channels,
    pub emit: Option<Vec<EmitItem>>,
    pub conditions: Vec<Cond>,
    pub error: Option<Term>,
    pub warning: Option<Term>,
    pub suppress_warnings: Vec<String>,
}

/// An alternative after stitching, with the clauses of the rule that
/// contributed it.
#[derive(Debug, Clone)]
pub(crate) struct StitchedAlternative {
    pub alternative: Alternative,
    pub written: Option<Arc<crate::json::Json>>,
    pub written_alternative: usize,
    /// Source order of the surviving alternative, independent of rule numbering.
    pub text_order: usize,
    pub clauses: Arc<RuleClauses>,
    pub erased: bool,
    pub document: Arc<str>,
    pub at: (usize, usize),
}

#[derive(Debug, Clone)]
pub(crate) struct StitchedRule {
    pub query: bool,
    pub name: String,
    pub alternatives: Vec<StitchedAlternative>,
    pub document: Arc<str>,
}

/// One replacement or extension the loader recorded (engine §2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Change {
    /// The stage whose grammar changed.
    pub stage: String,
    /// The rule that was replaced or extended.
    pub rule: String,
    /// True for an extension (`%extend-rule`), false for a replacement
    /// (`%redefine-rule`).
    pub extension: bool,
    /// The document that made the change.
    pub document: String,
}

#[derive(Debug, Clone)]
pub(crate) struct StageGrammar {
    pub query_targets: FxMap<usize, String>,
    pub tree_comparisons: bool,
    pub tree_expressions: bool,
    pub features: Vec<(Arc<str>, crate::dom::Directive)>,
    pub unicode: Arc<Unicode>,
    pub name: String,
    pub rules: Vec<StitchedRule>,
    pub index: HashMap<String, usize>,
    /// The key steps of `%ambiguity-resolution`, in order (engine §6).
    pub steps: Vec<KeyStep>,
    pub lean: Lean,
    pub elision_only: bool,
    pub ranked: Arc<crate::ranked::RankedGroups>,
    pub close_families: Arc<Vec<FxSet<u32>>>,
    /// The rule replacements and extensions recorded during stitching.
    pub changes: Vec<Change>,
    /// The stage's `%classifier` items in stitching order, each with its
    /// document (engine §2).
    pub classifiers: Vec<(Arc<str>, ClassifierDef)>,
    /// The stage's implications, each side with its value (engine §2,
    /// §11).
    pub implications: Arc<[Implication]>,
}

/// An implication of a stage with its two sides' values: the tags of the
/// antecedent and those that it brings (engine §2, §11).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Implication {
    pub antecedent: BTreeSet<String>,
    pub consequent: BTreeSet<String>,
}

/// Each classifier of a stage resolved for one set of features, by name:
/// each key with its classes (engine §2).
pub(crate) type ClassifierTables = FxMap<String, FxMap<String, Vec<String>>>;

impl StageGrammar {
    /// Each classifier of the stage for one set of features: each key's
    /// classes after every entry whose gates hold, in stitching order
    /// (engine §2). An entry that adds a membership that holds, or removes
    /// one that does not, is an error of the grammar for these features,
    /// whose message names the entry's document, line and column.
    pub(crate) fn resolve_classifiers(&self, features: &BTreeSet<String>) -> Result<ClassifierTables, Error> {
        // Each key's classes as slots in the order added, a removed one
        // emptied, with where each class held stands, so that an entry
        // finds its class without a scan of the key's classes.
        #[derive(Default)]
        struct Classes {
            slots: Vec<Option<String>>,
            at: FxMap<String, usize>,
        }
        let mut building: FxMap<String, FxMap<String, Classes>> = FxMap::default();
        for (document, classifier) in &self.classifiers {
            let table = building.entry(classifier.name.clone()).or_default();
            for entry in &classifier.entries {
                let on = entry
                    .gates
                    .iter()
                    .all(|guard| guard.kind == FeatureKind::Gate && features.contains(&guard.feature) != guard.negated);
                if !on {
                    continue;
                }
                for key in &entry.keys {
                    let Term::Str(key) = key else { unreachable!("a bound classifier key is a string") };
                    let classes = table.entry(key.clone()).or_default();
                    // One lookup, where a scan of the key's classes was one
                    // step for each.
                    work::count(Work::Classified, 1);
                    let held = classes.at.get(&entry.class).copied();
                    match (entry.adds, held) {
                        (true, None) => {
                            classes.at.insert(entry.class.clone(), classes.slots.len());
                            classes.slots.push(Some(entry.class.clone()));
                        }
                        (false, Some(index)) => {
                            classes.at.remove(&entry.class);
                            classes.slots[index] = None;
                        }
                        (adds, _) => {
                            let problem = if adds {
                                format!(
                                    "{} is already in {}",
                                    crate::tags::string_name(key, &self.unicode),
                                    entry.class
                                )
                            } else {
                                format!(
                                    "{} is not in {}, so ∉ has nothing to remove",
                                    crate::tags::string_name(key, &self.unicode),
                                    entry.class
                                )
                            };
                            let (line, column) = entry.at;
                            return Err(Error::grammar(format!(
                                "{document}:{line}:{column}: the classifier {}: {problem}",
                                classifier.name
                            ))
                            .in_document(document)
                            .at(line, column)
                            .in_stage(&self.name));
                        }
                    }
                }
            }
        }
        Ok(building
            .into_iter()
            .map(|(name, keys)| {
                let keys = keys
                    .into_iter()
                    .map(|(key, classes)| (key, classes.slots.into_iter().flatten().collect()))
                    .collect();
                (name, keys)
            })
            .collect())
    }
}

/// The most items an `&` may have (engine §3.2): its expansions are every
/// non-empty subsequence, so more would be too many to lower.
pub(crate) const MAX_AND: usize = 16;

pub(crate) fn is_terminal_name(name: &str) -> bool {
    name.starts_with('_') || name.chars().next().is_some_and(|c| c.is_ascii_uppercase())
}

fn located(message: String, document: &str, at: (usize, usize)) -> Error {
    Error::grammar(message).in_document(document).at(at.0, at.1)
}

/// Stitches the runs of items of one stage, in order: each a document's
/// path and a DOM of consecutive items of it. `unicode` gives the tags of a
/// range in a constant's value.
pub(crate) fn stitch(
    stage: &str,
    documents: &[(Arc<str>, Arc<Dom>)],
    unicode: &Unicode,
) -> Result<StageGrammar, Error> {
    stitch_stage(stage, documents, unicode).map_err(|error| error.in_stage(stage))
}

fn stitch_stage(stage: &str, documents: &[(Arc<str>, Arc<Dom>)], unicode: &Unicode) -> Result<StageGrammar, Error> {
    let mut pending_templates = Vec::new();
    let expansion = crate::parameters::expand(documents, unicode)?;
    let documents = expansion.as_ref().map_or(documents, |x| x.documents.as_slice());
    let mut arguments_by_site: HashMap<_, Vec<_>> = HashMap::new();
    if let Some(expanded) = &expansion {
        for argument in &expanded.arguments {
            arguments_by_site
                .entry((argument.inspection_run, argument.path.clone(), argument.at))
                .or_default()
                .push(argument);
        }
    }
    let mut grammar = StageGrammar {
        query_targets: Default::default(),
        tree_comparisons: false,
        tree_expressions: false,
        unicode: Arc::new(unicode.clone()),
        name: stage.to_string(),
        rules: Vec::new(),
        index: HashMap::new(),
        steps: Vec::new(),
        lean: Lean::Greedy,
        elision_only: false,
        ranked: Arc::new(crate::ranked::RankedGroups::default()),
        close_families: Arc::default(),
        changes: Vec::new(),
        classifiers: Vec::new(),
        features: Vec::new(),
        implications: Arc::from(Vec::new()),
    };
    enum Check<'a> {
        Rule(&'a Arc<str>, &'a RuleDef),
        Arguments(&'a crate::parameters::expand::ArgumentUse),
        Feature(usize),
        Ranking(&'a Arc<str>, &'a Directive),
        Classifier(usize),
        Implication(&'a Arc<str>, &'a ImplicationDef),
    }
    let mut checks = Vec::new();
    let mut resolution: Option<(Arc<str>, (usize, usize))> = None;
    let mut elision_only = false;
    let mut constants = Constants {
        stage,
        unicode,
        patterns: Default::default(),
        values: HashMap::new(),
        versions: Vec::new(),
        latest: HashMap::new(),
    };
    let mut deferred = Vec::new();
    let mut text_order = 0;
    for (index, (document, dom)) in documents.iter().enumerate() {
        let run = expansion.as_ref().map_or(index, |expanded| expanded.inspection_runs[index]);
        enum Declaration<'a> {
            Rule(&'a RuleDef),
            Directive(&'a Directive),
            Constant(&'a ConstDef),
            Classifier(&'a ClassifierDef),
            Implication(&'a ImplicationDef),
        }
        let mut declarations = Vec::new();
        declarations.extend(dom.rules.iter().map(Declaration::Rule));
        declarations.extend(dom.directives.iter().map(Declaration::Directive));
        declarations.extend(dom.constants.iter().map(Declaration::Constant));
        declarations.extend(dom.classifiers.iter().map(Declaration::Classifier));
        declarations.extend(dom.implications.iter().map(Declaration::Implication));
        declarations.sort_by_key(|item| match item {
            Declaration::Rule(x) => x.at,
            Declaration::Directive(x) => x.at,
            Declaration::Constant(x) => x.at,
            Declaration::Classifier(x) => x.at,
            Declaration::Implication(x) => x.at,
        });
        for declaration in declarations {
            match declaration {
                Declaration::Rule(rule) => {
                    if let Some(problem) = &rule.deferred_emission {
                        deferred.push(located(problem.message.clone(), document, rule.at));
                    }
                    if !constants_in_rule(rule).is_empty()
                        || value_parts(ValuePart::Rule(rule))
                            .any(|part| matches!(part, ValuePart::Pattern(_) | ValuePart::Term(Term::Pattern(_))))
                        || arguments_by_site.contains_key(&(run, document.clone(), rule.at))
                    {
                        checks.push((run, rule.at, 0, Check::Rule(document, rule)));
                    }
                    // The clauses are copied once for the rule, not for each
                    // alternative. Each condition counts as it is copied.
                    let copy_clauses = || {
                        Arc::new(RuleClauses {
                            error: rule.error.clone(),
                            warning: rule.warning.clone(),
                            suppress_warnings: rule.suppress_warnings.clone(),
                            tags: rule.tags.clone(),
                            strings: rule.strings.clone(),
                            emit: rule.emit.clone(),
                            conditions: rule
                                .conditions
                                .iter()
                                .inspect(|_| work::count(Work::Stitched, 1))
                                .cloned()
                                .collect(),
                        })
                    };
                    let written = if rule.alternatives.iter().any(|a| crate::ranked::contains_ranked(&a.expr)) {
                        let mut text = String::new();
                        crate::dom::write_rule(&mut text, rule);
                        Some(Arc::new(crate::json::parse(&text).expect("the written rule DOM")))
                    } else {
                        None
                    };
                    let clauses = copy_clauses();
                    let alternatives: Vec<StitchedAlternative> = rule
                        .alternatives
                        .iter()
                        .enumerate()
                        .map(|(written_alternative, alternative)| StitchedAlternative {
                            alternative: alternative.clone(),
                            written: written.clone(),
                            written_alternative,
                            text_order: text_order + written_alternative,
                            clauses: if work::mutated(Mutant::ClausesPerAlternative) {
                                copy_clauses()
                            } else {
                                clauses.clone()
                            },
                            erased: rule.erased,
                            document: document.clone(),
                            at: rule.at,
                        })
                        .collect();
                    text_order += rule.alternatives.len();
                    let error = |message: String| Err(located(message, document, rule.at));
                    let stitched = || StitchedRule {
                        query: false,
                        name: rule.name.clone(),
                        alternatives: alternatives.clone(),
                        document: document.clone(),
                    };
                    match rule.op {
                        Op::Define => {
                            if grammar.index.contains_key(&rule.name) {
                                return error(format!(
                                    "%rule {} is already defined, in {}; %redefine-rule replaces a rule",
                                    rule.name, grammar.rules[grammar.index[&rule.name]].document
                                ));
                            }
                            grammar.index.insert(rule.name.clone(), grammar.rules.len());
                            grammar.rules.push(stitched());
                        }
                        Op::Redefine => {
                            // Any earlier item of the stage, in this document or
                            // another, may have defined it (engine §2).
                            let Some(&index) = grammar.index.get(&rule.name) else {
                                return error(format!(
                                    "%redefine-rule {} replaces no rule defined before it",
                                    rule.name
                                ));
                            };
                            // The replacement keeps the place of the rule it
                            // replaces (§3, "Numbering").
                            grammar.rules[index] = stitched();
                            grammar.changes.push(Change {
                                stage: stage.to_string(),
                                rule: rule.name.clone(),
                                extension: false,
                                document: document.to_string(),
                            });
                        }
                        Op::Extend => {
                            let Some(&index) = grammar.index.get(&rule.name) else {
                                return error(format!(
                                    "%extend-rule {} extends a rule that is not defined before it",
                                    rule.name
                                ));
                            };
                            grammar.rules[index].alternatives.extend(alternatives);
                            grammar.changes.push(Change {
                                stage: stage.to_string(),
                                rule: rule.name.clone(),
                                extension: true,
                                document: document.to_string(),
                            });
                        }
                    }
                }
                Declaration::Directive(directive) => {
                    let here = |message: String| located(message, document, directive.at);
                    match directive.name.as_str() {
                        "features" => {
                            checks.push((run, directive.at, 1, Check::Feature(grammar.features.len())));
                            grammar.features.push((document.clone(), directive.clone()));
                        }
                        "ambiguity-resolution" => {
                            if resolution.is_some() {
                                return Err(here("has a second %ambiguity-resolution".into()));
                            }
                            let refused = || {
                                here(
                                    "%ambiguity-resolution requires a pattern for each key step and no operand on a final lean"
                                        .to_string(),
                                )
                            };
                            let steps = directive.steps.as_deref().unwrap_or_default();
                            if !crate::dom::valid_steps(steps) {
                                return Err(refused());
                            }
                            checks.push((run, directive.at, 1, Check::Ranking(document, directive)));
                            resolution = Some((document.clone(), directive.at));
                        }
                        "elision-only" => {
                            if elision_only {
                                return Err(here("has a second %elision-only".into()));
                            }
                            elision_only = true;
                            grammar.elision_only = true;
                        }
                        other => return Err(here(format!("an unknown directive %{other}"))),
                    }
                }
                Declaration::Constant(constant) => constants.add(document, constant)?,
                Declaration::Classifier(classifier) => {
                    checks.push((run, classifier.at, 3, Check::Classifier(grammar.classifiers.len())));
                    grammar.classifiers.push((document.clone(), classifier.clone()));
                }
                Declaration::Implication(implication) => {
                    checks.push((run, implication.at, 4, Check::Implication(document, implication)))
                }
            }
        }
    }
    constants.bind()?;
    if let Some(expanded) = &expansion {
        for (run, path, dom) in &expanded.validation {
            checks.extend(dom.rules.iter().map(|rule| (*run, rule.at, 0, Check::Rule(path, rule))));
        }
        let positions: HashMap<_, _> = expanded.order.iter().enumerate().map(|(i, n)| (n.as_str(), i)).collect();
        grammar.rules.sort_by_key(|r| positions.get(r.name.as_str()).copied().unwrap_or(usize::MAX));
        grammar.index = grammar.rules.iter().enumerate().map(|(i, r)| (r.name.clone(), i)).collect();
    }
    let mut implications = Vec::new();
    if let Some(expanded) = &expansion {
        for argument in &expanded.arguments {
            checks.push((argument.inspection_run, argument.at, argument.kind, Check::Arguments(argument)));
        }
    }
    checks.sort_by_key(|(run, at, kind, _)| (*run, *at, *kind));
    for (run, _, _, check) in checks {
        match check {
            Check::Rule(document, rule) => {
                let arguments = arguments_by_site.remove(&(run, document.clone(), rule.at)).unwrap_or_default();
                let errors = if rule.source.params.is_some() { &mut pending_templates } else { &mut deferred };
                constants.check_rule(document, rule, &arguments, errors)?;
            }
            Check::Arguments(argument) => {
                if let Some(arguments) =
                    arguments_by_site.remove(&(argument.inspection_run, argument.path.clone(), argument.at))
                {
                    constants.check_arguments(&arguments, None)?;
                }
            }
            Check::Ranking(document, directive) => {
                grammar.lean = Lean::Neither;
                for step in directive.steps.as_deref().unwrap_or_default() {
                    let kind = match step.step.as_str() {
                        "greedy" => {
                            grammar.lean = Lean::Greedy;
                            continue;
                        }
                        "lazy" => {
                            grammar.lean = Lean::Lazy;
                            continue;
                        }
                        "leftmost-longest" => StepKind::LeftmostLongest,
                        "fewest" => StepKind::Fewest,
                        "most" => StepKind::Most,
                        "late" => StepKind::Late,
                        "early" => StepKind::Early,
                        _ => unreachable!("validated step"),
                    };
                    let operand = step.pattern.as_ref().expect("key operand");
                    let at = step.operand_at.or_else(|| first_constant(operand)).unwrap_or(directive.at);
                    let pattern = constants.evaluate_pattern(operand, document, at)?;
                    if let Some(problem) = crate::patterns::ranking_problem(&pattern) {
                        return Err(located(problem.into(), document, at));
                    }
                    if kind == StepKind::LeftmostLongest && crate::patterns::requires_elided(&pattern) {
                        return Err(located("leftmost-longest cannot require _Elided".into(), document, at));
                    }
                    for part in pattern.walk() {
                        if let crate::patterns::Part::Pattern(Pattern::Name(name, at)) = part {
                            if !grammar.index.contains_key(name) {
                                return Err(located(format!("{name} is not defined in stage {stage}"), document, *at));
                            }
                        }
                    }
                    grammar.steps.push(KeyStep { kind, pattern });
                }
            }
            Check::Feature(index) => {
                let (document, directive) = &mut grammar.features[index];
                let arguments =
                    arguments_by_site.get(&(run, document.clone(), directive.at)).map_or(&[][..], Vec::as_slice);
                constants.resolve_feature(document, directive, arguments)?;
            }
            Check::Classifier(index) => {
                let (document, classifier) = &mut grammar.classifiers[index];
                constants.resolve_classifier(document, classifier)?;
            }
            Check::Implication(document, implication) => {
                implications.push(constants.implication(document, implication)?)
            }
        }
    }
    constants.substitute_rules(&mut grammar);
    crate::query_forms::prepare(&mut grammar)?;
    constants.evaluate_tests(&mut grammar)?;
    grammar.implications = implications.into();
    if resolution.is_none() {
        return Err(Error::grammar("has no %ambiguity-resolution").in_stage(stage));
    }
    if !grammar.index.contains_key("text") {
        return Err(Error::grammar("has no rule text").in_stage(stage));
    }
    crate::diagnostics::check(
        &grammar,
        documents,
        &constants.patterns.borrow(),
        expansion.as_ref().map(|x| x.erasure_checks.as_slice()),
    )?;
    crate::boundary::reachable(&grammar)?;
    // Shared clauses are checked once, with the first alternative that
    // holds them.
    let mut checked: FxSet<*const RuleClauses> = FxSet::default();
    let mut tree_comparisons = false;
    let mut tree_expressions = false;
    for rule in &grammar.rules {
        for alternative in &rule.alternatives {
            let first = checked.insert(Arc::as_ptr(&alternative.clauses));
            let (recognition, expressions) = check_alternative(&grammar, alternative, first)
                .map_err(|message| located(message, &alternative.document, alternative.at))?;
            tree_comparisons |= recognition;
            tree_expressions |= expressions;
        }
    }
    grammar.close_families = Arc::new(close_families(&grammar));
    grammar.ranked = Arc::new(crate::ranked::RankedGroups::new(&grammar));
    if !grammar.ranked.groups.is_empty() {
        grammar.ranked.validate_tags(&grammar)?;
    }
    if let Some(error) = deferred.into_iter().next() {
        return Err(error);
    }
    if let Some(error) = pending_templates.into_iter().next() {
        return Err(error);
    }
    let mut alternatives: Vec<_> = grammar.rules.iter().flat_map(|rule| &rule.alternatives).collect();
    alternatives.sort_by_key(|alternative| alternative.text_order);
    for alternative in alternatives {
        recipe_cycles(alternative)?;
    }
    emission_overlap(&grammar)?;
    crate::nullable_errors::check(&grammar)?;
    grammar.tree_comparisons = tree_comparisons;
    grammar.tree_expressions = tree_expressions;
    Ok(grammar)
}

/// Membership reads only written reference paths, before gates or lowering.
fn close_families(grammar: &StageGrammar) -> Vec<FxSet<u32>> {
    enum Part<'a> {
        Term(&'a Term),
        Cond(&'a Cond),
    }
    let mut pending = Vec::new();
    let mut seen = FxSet::default();
    for rule in &grammar.rules {
        for alternative in &rule.alternatives {
            pending.extend(alternative.alternative.tags.iter().map(Part::Term));
            if seen.insert(Arc::as_ptr(&alternative.clauses)) {
                let clauses = &alternative.clauses;
                pending.extend(clauses.tags.iter().map(Part::Term));
                pending.extend(clauses.conditions.iter().map(Part::Cond));
                for item in clauses.emit.iter().flatten() {
                    let (EmitItem::Capture(_, term, _) | EmitItem::Insert(term, _)) = item;
                    pending.extend(term.iter().map(Part::Term));
                }
            }
        }
    }
    let mut roots = FxSet::default();
    while let Some(part) = pending.pop() {
        match part {
            Part::Term(term) => match term {
                Term::Call(name, args) => {
                    if let ("without-elision-except", [Arg::Term(_), Arg::Rule(root)]) =
                        (name.as_str(), args.as_slice())
                    {
                        roots.insert(grammar.index[root] as u32);
                    }
                    pending.extend(args.iter().filter_map(|arg| match arg {
                        Arg::Term(term) => Some(Part::Term(term)),
                        _ => None,
                    }));
                }
                Term::Union(items) | Term::Intersection(items) => pending.extend(items.iter().map(Part::Term)),
                Term::Difference(a, b) => pending.extend([Part::Term(a), Part::Term(b)]),
                Term::If(c, t) => pending.extend([Part::Cond(c), Part::Term(t)]),
                _ => {}
            },
            Part::Cond(condition) => match condition {
                Cond::Truthy(term) => pending.push(Part::Term(term)),
                Cond::Forest(term) => pending.push(Part::Term(term)),
                Cond::Compare(_, a, b, _) => pending.extend([Part::Term(a), Part::Term(b)]),
                Cond::Initial(t) | Cond::Final(t) | Cond::Boundary(_, t, _, _) => pending.push(Part::Term(t)),
                Cond::Not(c) => pending.push(Part::Cond(c)),
                Cond::Any(items) | Cond::All(items) => pending.extend(items.iter().map(Part::Cond)),
                Cond::If(a, b) => pending.extend([Part::Cond(a), Part::Cond(b)]),
                Cond::Captured(_) => {}
                Cond::SourceQuery(..) => unreachable!("source predicates expand before grammar checks"),
            },
        }
    }
    if roots.is_empty() {
        return vec![FxSet::default(); grammar.rules.len()];
    }
    fn edges(expr: &Expr, grammar: &StageGrammar, out: &mut Vec<u32>) {
        match expr {
            Expr::Ref(name) => {
                if let Some(&rule) = grammar.index.get(name) {
                    out.push(rule as u32);
                }
            }
            Expr::Capture(_, inner) | Expr::Splice(inner) | Expr::Tested(_, _, inner) => edges(inner, grammar, out),
            Expr::Choice(branches) => {
                for branch in branches {
                    edges(branch, grammar, out);
                }
            }
            _ => {}
        }
    }
    let links: Vec<_> = grammar
        .rules
        .iter()
        .map(|rule| {
            let mut out = Vec::new();
            for alternative in &rule.alternatives {
                edges(&alternative.alternative.expr, grammar, &mut out);
            }
            out
        })
        .collect();
    (0..grammar.rules.len())
        .map(|root| {
            let mut members = FxSet::default();
            if !roots.contains(&(root as u32)) {
                return members;
            }
            let mut pending = vec![root as u32];
            while let Some(rule) = pending.pop() {
                if members.insert(rule) {
                    pending.extend(&links[rule as usize]);
                }
            }
            members
        })
        .collect()
}

/// Potential input consumption ignores gates, tests, and productivity.
fn consuming(expr: &Expr, rules: &FxSet<String>) -> bool {
    let mut pending = vec![expr];
    while let Some(expr) = pending.pop() {
        match expr {
            Expr::Ref(name) if is_terminal_name(name) || rules.contains(name) => return true,
            Expr::Terminal(_) | Expr::Literal(_) | Expr::ScalarRange(..) | Expr::Range(..) | Expr::Wildcard => {
                return true
            }
            Expr::Seq(items) | Expr::Choice(items) | Expr::Ranked(items, _) | Expr::And(items) => pending.extend(items),
            Expr::Capture(_, inner) | Expr::Splice(inner) | Expr::Optional(inner, _, _) | Expr::Tested(_, _, inner) => {
                pending.push(inner)
            }
            Expr::Repeat(item, separator, _) => {
                pending.push(item);
                pending.extend(separator.as_deref());
            }
            _ => {}
        }
    }
    false
}

fn emission_overlap(grammar: &StageGrammar) -> Result<(), Error> {
    let mut reads = FxSet::default();
    loop {
        let mut changed = false;
        for rule in &grammar.rules {
            if !reads.contains(&rule.name) && rule.alternatives.iter().any(|a| consuming(&a.alternative.expr, &reads)) {
                reads.insert(rule.name.clone());
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    for rule in &grammar.rules {
        for alternative in &rule.alternatives {
            let Some(items) = &alternative.clauses.emit else { continue };
            if items.len() < 2
                || !items.iter().any(|item| matches!(item, EmitItem::Capture(name, ..) if name.is_empty()))
            {
                continue;
            }
            let mut captures = FxMap::<String, bool>::default();
            let mut pending = vec![&alternative.alternative.expr];
            while let Some(expr) = pending.pop() {
                match expr {
                    Expr::Capture(name, inner) => {
                        *captures.entry(name.clone()).or_default() |= consuming(inner, &reads);
                        pending.push(inner);
                    }
                    Expr::Seq(items) | Expr::Choice(items) | Expr::Ranked(items, _) | Expr::And(items) => {
                        pending.extend(items)
                    }
                    Expr::Splice(inner) | Expr::Optional(inner, _, _) | Expr::Tested(_, _, inner) => {
                        pending.push(inner)
                    }
                    Expr::Repeat(item, separator, _) => {
                        pending.push(item);
                        pending.extend(separator.as_deref());
                    }
                    _ => {}
                }
            }
            for (first, item) in items.iter().enumerate() {
                for other in &items[first + 1..] {
                    let (EmitItem::Capture(left, ..), EmitItem::Capture(right, ..)) = (item, other) else { continue };
                    if !left.is_empty() && !right.is_empty() {
                        continue;
                    }
                    let other = if left.is_empty() { other } else { item };
                    let overlap = match other {
                        EmitItem::Capture(name, _, _) if name.is_empty() => {
                            consuming(&alternative.alternative.expr, &reads)
                        }
                        EmitItem::Capture(name, _, attachments) => attachments
                            .before
                            .iter()
                            .chain(std::iter::once(name))
                            .chain(&attachments.after)
                            .any(|name| captures.get(name).copied().unwrap_or(false)),
                        EmitItem::Insert(..) => false,
                    };
                    if overlap {
                        return Err(located(
                            "emission carriers can overlap input positions".into(),
                            &alternative.document,
                            alternative.at,
                        ));
                    }
                }
            }
        }
    }
    Ok(())
}

/// Only whole-occurrence emitted reads can return to their own channel.
/// Follow recipe atoms in written order, value before image (§11.3).
fn recipe_cycles(alternative: &StitchedAlternative) -> Result<(), Error> {
    let a = &alternative.alternative.strings;
    let d = &alternative.clauses.strings;
    let selected = |value: bool| {
        let (term, at) = if value {
            if a.value.is_some() {
                (&a.value, a.value_at)
            } else {
                (&d.value, d.value_at)
            }
        } else if a.image.is_some() {
            (&a.image, a.image_at)
        } else {
            (&d.image, d.image_at)
        };
        term.as_ref().map(|term| (term, at))
    };
    let recipes = [selected(true), selected(false)];
    // An implied image selects the same expression as value. It is one
    // evaluation identity, rather than a synthetic dependency on value.
    let channel = |image: bool| usize::from(image && recipes[1].is_some());
    let dependencies = recipes.map(|recipe| {
        let mut dependencies = Vec::new();
        let Some((Term::Call(_, atoms), _)) = recipe else { return dependencies };
        for atom in atoms {
            if let Arg::Term(Term::Call(method, args)) = atom {
                if let [Arg::Term(Term::Call(emitted, args))] = &args[..] {
                    if emitted == "emitted" && matches!(&args[..], [Arg::Term(Term::Capture(name))] if name.is_empty())
                    {
                        dependencies.push(channel(method == "image"));
                    }
                }
            }
        }
        dependencies
    });
    let mut finished = [false; 2];
    let names = ["value", "image"];
    for root in [0, channel(true)] {
        if finished[root] {
            continue;
        }
        let mut active = [false; 2];
        active[root] = true;
        let mut path = vec![(root, 0)];
        while let Some((owner, next)) = path.last_mut() {
            let owner = *owner;
            if let Some(&dependency) = dependencies[owner].get(*next) {
                *next += 1;
                if active[dependency] {
                    // The recipe that reads the active channel closes the
                    // cycle. Its first atom supplies the diagnostic position.
                    let at = recipes[owner].expect("a recipe with a dependency").1;
                    let mut steps: Vec<_> = path.iter().map(|&(channel, _)| names[channel]).collect();
                    steps.push(names[dependency]);
                    let mut error = Error::grammar(format!("a constituent recipe cycles: {}", steps.join(" -> ")))
                        .in_document(&alternative.document)
                        .recover_location(crate::error::LocationRecovery::Recipe);
                    if let Some((line, column)) = at {
                        error = error.at(line, column);
                    }
                    return Err(error);
                }
                if !finished[dependency] {
                    active[dependency] = true;
                    path.push((dependency, 0));
                }
            } else {
                active[owner] = false;
                finished[owner] = true;
                path.pop();
            }
        }
    }
    Ok(())
}

/// A constant's value (engine §2, §10): a string, or a set of strings or
/// of tags.
#[derive(Debug, Clone, PartialEq)]
enum Value {
    Pattern(Pattern),
    Str(String),
    Set(BTreeSet<String>),
}

impl Value {
    fn set(self) -> BTreeSet<String> {
        match self {
            Value::Set(set) => set,
            Value::Str(s) => BTreeSet::from([s]),
            Value::Pattern(_) => BTreeSet::new(),
        }
    }

    fn string(self) -> String {
        match self {
            Value::Str(text) => text,
            Value::Set(_) | Value::Pattern(_) => String::new(),
        }
    }

    /// The term that stands for the value once the stage is stitched: a
    /// constant whose value is the empty set is the empty set (§3.6).
    fn term(&self) -> Term {
        match self {
            Value::Pattern(p) => Term::Pattern(Box::new(p.clone())),
            Value::Str(text) => Term::Str(text.clone()),
            Value::Set(set) => match set.len() {
                0 => Term::EmptySet,
                1 => Term::Tag(set.iter().next().expect("one member").clone()),
                _ => Term::Union(set.iter().map(|member| Term::Tag(member.clone())).collect()),
            },
        }
    }
}

/// A constant of a stage: its value and its type now, and the document of
/// its last definition.
#[derive(Clone)]
struct StageConstant {
    value: Value,
    ty: Type,
    document: Arc<str>,
}

/// The constants of a stage as the loader stitches it (engine §2).
struct Version {
    definition: ConstDef,
    document: Arc<str>,
    previous: Option<usize>,
}
struct Constants<'a> {
    patterns: std::cell::RefCell<Vec<(Pattern, String)>>,
    versions: Vec<Version>,
    latest: HashMap<String, usize>,
    stage: &'a str,
    unicode: &'a Unicode,
    values: HashMap<String, StageConstant>,
}

impl Constants<'_> {
    fn ty(&self, name: &str) -> Type {
        self.values.get(name).map_or(Type::Any, |constant| constant.ty)
    }

    /// Records an immutable constant version. Final bindings select the
    /// dependency graph before evaluation (engine §2).
    fn add(&mut self, document: &Arc<str>, constant: &ConstDef) -> Result<(), Error> {
        let ConstDef { name, redefine, at, .. } = constant;
        let previous = self.values.get(name);
        match (previous, redefine) {
            (Some(previous), false) => {
                return Err(located(
                    format!(
                        "%const ${name} is already defined in stage {}, in {}; %redefine-const gives it a new value",
                        self.stage, previous.document
                    ),
                    document,
                    *at,
                ));
            }
            (None, true) => {
                return Err(located(
                    format!(
                        "%redefine-const ${name} gives a value to no constant defined before it in stage {}",
                        self.stage
                    ),
                    document,
                    *at,
                ));
            }
            _ => {}
        }
        let id = self.versions.len();
        self.versions.push(Version {
            definition: constant.clone(),
            document: document.clone(),
            previous: self.latest.get(name).copied(),
        });
        self.latest.insert(name.clone(), id);
        self.values.insert(
            name.clone(),
            StageConstant { value: Value::Set(BTreeSet::new()), ty: Type::Any, document: document.clone() },
        );
        Ok(())
    }

    fn bind(&mut self) -> Result<(), Error> {
        let mut edges = Vec::new();
        for version in &self.versions {
            let mut refs = Vec::new();
            constants_in_term(&version.definition.value, &mut refs);
            let mut next = Vec::new();
            for (name, at) in refs {
                let target = if name == version.definition.name && version.definition.redefine {
                    version.previous
                } else {
                    self.latest.get(name).copied()
                };
                let target = target.ok_or_else(|| {
                    located(
                        format!(
                            "${name} is not defined in stage {}; dependency ${} → ${name}",
                            self.stage, version.definition.name
                        ),
                        &version.document,
                        at,
                    )
                })?;
                next.push((target, at));
            }
            edges.push(next);
        }
        let mut colors = vec![0; self.versions.len()];
        let mut order = Vec::new();
        for root in 0..self.versions.len() {
            if colors[root] != 0 {
                continue;
            }
            colors[root] = 1;
            let mut stack = vec![(root, 0)];
            while let Some((id, next)) = stack.last_mut() {
                if *next == edges[*id].len() {
                    let id = *id;
                    colors[id] = 2;
                    order.push(id);
                    stack.pop();
                    continue;
                }
                let (child, at) = edges[*id][*next];
                *next += 1;
                if colors[child] == 1 {
                    let closing = *id;
                    let start = stack.iter().position(|(id, _)| *id == child).expect("an active dependency");
                    let cycle: Vec<_> =
                        stack[start..].iter().map(|(id, _)| *id).chain(std::iter::once(child)).collect();
                    let ambiguous = cycle.iter().any(|id| {
                        self.versions.iter().filter(|v| v.definition.name == self.versions[*id].definition.name).count()
                            > 1
                    });
                    let path = cycle
                        .iter()
                        .map(|id| {
                            let version = &self.versions[*id];
                            let name = &version.definition.name;
                            if ambiguous {
                                let (line, column) = version.definition.at;
                                format!("${name} [{}:{line}:{column}]", version.document)
                            } else {
                                format!("${name}")
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(" → ");
                    return Err(located(
                        format!("constant dependency cycle: {path}"),
                        &self.versions[closing].document,
                        at,
                    ));
                }
                if colors[child] == 0 {
                    colors[child] = 1;
                    stack.push((child, 0));
                }
            }
        }
        let mut kinds: HashMap<String, Type> = HashMap::new();
        let mut users: HashMap<String, Vec<usize>> = HashMap::new();
        for (id, version) in self.versions.iter().enumerate() {
            users.entry(version.definition.name.clone()).or_default().push(id);
            for &(child, _) in &edges[id] {
                users.entry(self.versions[child].definition.name.clone()).or_default().push(id);
            }
        }
        let mut queue: std::collections::VecDeque<usize> = (0..self.versions.len()).collect();
        let mut queued = vec![true; self.versions.len()];
        while let Some(id) = queue.pop_front() {
            queued[id] = false;
            let v = &self.versions[id];
            let ty = constant_value_type(&v.definition.value, v.definition.redefine, &|n| {
                kinds.get(n).copied().unwrap_or(Type::Any)
            })
            .map_err(|f| fault_error(f, &v.document, v.definition.at))?;
            if matches!(ty, Type::Any | Type::Set) {
                continue;
            }
            if let Some(old) = kinds.get(&v.definition.name) {
                if *old != ty {
                    return Err(located(
                        format!(
                            "%redefine-const ${} keeps the type of the constant, and cannot make it {}",
                            v.definition.name,
                            ty.name()
                        ),
                        &v.document,
                        v.definition.at,
                    ));
                }
            } else {
                kinds.insert(v.definition.name.clone(), ty);
                for &user in &users[&v.definition.name] {
                    if !queued[user] {
                        queue.push_back(user);
                        queued[user] = true;
                    }
                }
            }
        }
        let mut values: Vec<Option<Value>> = vec![None; self.versions.len()];
        for id in order {
            let v = &self.versions[id];
            let kind = *kinds.get(&v.definition.name).ok_or_else(|| {
                located("the kind of the set that the constant holds is not given".into(), &v.document, v.definition.at)
            })?;
            let mut refs = Vec::new();
            constants_in_term(&v.definition.value, &mut refs);
            self.values = refs
                .into_iter()
                .zip(edges[id].iter())
                .map(|((name, _), (child, _))| {
                    (
                        name.to_owned(),
                        StageConstant {
                            value: values[*child].clone().unwrap(),
                            ty: kinds[name],
                            document: self.versions[*child].document.clone(),
                        },
                    )
                })
                .collect();
            let value = if kind == Type::Pattern
                && term_type_in(&v.definition.value, &|n| kinds[n])
                    .map_err(|f| fault_error(f, &v.document, v.definition.at))?
                    == Type::Set
            {
                Value::Pattern(Pattern::empty())
            } else {
                self.evaluate(&v.definition.value, &v.document, v.definition.at)?
            };
            values[id] = Some(value);
        }
        self.values = self
            .latest
            .iter()
            .map(|(name, &id)| {
                (
                    name.clone(),
                    StageConstant {
                        value: values[id].clone().unwrap(),
                        ty: kinds[name],
                        document: self.versions[id].document.clone(),
                    },
                )
            })
            .collect();
        Ok(())
    }

    /// The value of a closed term, with the constants' values now (engine
    /// §2, §10). A joined empty delimiter errors at the definition.
    /// A direct constant delimiter errors at its reference.
    fn evaluate(&self, term: &Term, document: &str, item: (usize, usize)) -> Result<Value, Error> {
        if self.is_pattern(term) {
            return self.evaluate_pattern_value(term, document, item);
        }
        self.evaluate_plain(term, document, item)
    }
    fn is_pattern(&self, term: &Term) -> bool {
        let mut todo = vec![term];
        while let Some(t) = todo.pop() {
            match t {
                Term::Pattern(_) => return true,
                Term::Const(n, _) if self.ty(n) == Type::Pattern => return true,
                Term::Union(xs) | Term::Intersection(xs) => todo.extend(xs),
                Term::Difference(a, b) => {
                    todo.push(a);
                    todo.push(b);
                }
                _ => {}
            }
        }
        false
    }
    fn evaluate_test(&self, value: &Term, op: &str, document: &str, at: (usize, usize)) -> Result<Term, Error> {
        if op == "tags" {
            let Term::Call(name, requirements) = value else { unreachable!("a signed requirement list") };
            let mut bound = Vec::new();
            for requirement in requirements {
                let Arg::Term(requirement) = requirement else { unreachable!() };
                let (negative, term) = match requirement {
                    Term::Call(name, args) if name == "forbid" => {
                        let [Arg::Term(term)] = &args[..] else { unreachable!() };
                        (true, term)
                    }
                    term => (false, term),
                };
                let term = self.evaluate(term, document, at)?.term();
                bound.push(Arg::Term(if negative { Term::Call("forbid".into(), vec![Arg::Term(term)]) } else { term }));
            }
            return Ok(Term::Call(name.clone(), bound));
        }
        Ok(self.evaluate(value, document, at)?.term())
    }

    /// Follow shared substitutions before cloning or compiling their values.
    fn check_pattern_depth(&self, term: &Term, document: &str, item: (usize, usize)) -> Result<(), Error> {
        use crate::patterns::Children;
        #[derive(Clone, Copy)]
        enum Part<'a> {
            Term(&'a Term),
            Pattern(&'a Pattern),
            Children(&'a Children),
        }
        let empty = Pattern::empty();
        let mut pending = vec![(Part::Term(term), 1usize, 0u8, None)];
        let mut seen = HashMap::new();
        while let Some((part, depth, parent, reference)) = pending.pop() {
            let (kind, identity, operation) = match part {
                Part::Term(t) => (
                    0u8,
                    t as *const Term as usize,
                    match t {
                        Term::Union(_) => 1,
                        Term::Intersection(_) => 2,
                        Term::Difference(..) => 3,
                        _ => 0,
                    },
                ),
                Part::Pattern(p) => (
                    1,
                    p as *const Pattern as usize,
                    match p {
                        Pattern::Union(_) => 1,
                        Pattern::Intersection(_) => 2,
                        Pattern::Difference(..) => 3,
                        _ => 0,
                    },
                ),
                Part::Children(c) => (2, c as *const Children as usize, 0),
            };
            let constant = match part {
                Part::Term(Term::Const(name, at)) | Part::Pattern(Pattern::Constant(name, at)) => Some((name, at)),
                _ => None,
            };
            if let Some((name, at)) = constant {
                if let Value::Pattern(pattern) = &self.values[name].value {
                    pending.push((Part::Pattern(pattern), depth, parent, reference.or(Some(*at))));
                    continue;
                }
                if matches!(part, Part::Term(_))
                    && matches!(&self.values[name].value, Value::Set(set) if set.is_empty())
                {
                    pending.push((Part::Pattern(&empty), depth, parent, reference.or(Some(*at))));
                    continue;
                }
            }
            if matches!(part, Part::Term(Term::EmptySet)) {
                pending.push((Part::Pattern(&empty), depth, parent, reference));
                continue;
            }
            // Term wrappers, node decorations, and sequence arrays are transparent.
            let transparent = match part {
                Part::Term(Term::Pattern(pattern)) => Some(Part::Pattern(pattern)),
                Part::Pattern(Pattern::Node(pattern, _, _)) => Some(Part::Pattern(pattern)),
                _ => None,
            };
            if let Some(inner) = transparent {
                if let Part::Pattern(Pattern::Node(_, _, Some(children))) = part {
                    pending.push((Part::Children(children), depth + 1, 0, reference));
                }
                pending.push((inner, depth, parent, reference));
                continue;
            }
            let flat = operation != 0 && operation != 3 && operation == parent;
            let sequence = matches!(part, Part::Children(Children::Sequence(_)));
            if !flat && !sequence && depth > 256 {
                return Err(located(
                    "a resolved pattern is nested more than 256 deep".into(),
                    document,
                    reference.unwrap_or(item),
                ));
            }
            let key = (kind, identity, parent);
            if seen.get(&key).is_some_and(|&previous| previous >= depth) {
                continue;
            }
            seen.insert(key, depth);
            let child_depth = depth + usize::from(!flat && !sequence);
            let child_parent = if sequence { parent } else { operation };
            let mut push = |child| pending.push((child, child_depth, child_parent, reference));
            match part {
                Part::Term(Term::Union(items) | Term::Intersection(items)) => {
                    for child in items.iter().rev() {
                        push(Part::Term(child));
                    }
                }
                Part::Term(Term::Difference(a, b)) => {
                    push(Part::Term(b));
                    push(Part::Term(a));
                }
                Part::Pattern(Pattern::Union(items) | Pattern::Intersection(items)) => {
                    for child in items.iter().rev() {
                        push(Part::Pattern(child));
                    }
                }
                Part::Pattern(Pattern::Difference(a, b)) => {
                    push(Part::Pattern(b));
                    push(Part::Pattern(a));
                }
                Part::Pattern(Pattern::Path(_, inner) | Pattern::Test(_, _, inner, _)) => push(Part::Pattern(inner)),
                Part::Children(Children::Node(inner)) => push(Part::Pattern(inner)),
                Part::Children(Children::Sequence(items) | Children::Choice(items)) => {
                    for child in items.iter().rev() {
                        push(Part::Children(child));
                    }
                }
                Part::Children(Children::Optional(inner)) => push(Part::Children(inner)),
                Part::Children(Children::Repeat(inner, separator)) => {
                    if let Some(separator) = separator {
                        push(Part::Children(separator));
                    }
                    push(Part::Children(inner));
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn evaluate_pattern_value(&self, term: &Term, document: &str, item: (usize, usize)) -> Result<Value, Error> {
        if let Term::Pattern(root) = term {
            if let Some(fault) = root.type_fault(&|name| self.ty(name)) {
                return Err(located(fault.problem, document, fault.at.unwrap_or(item)));
            }
            self.check_pattern_depth(term, document, item)?;
            let ranges: Vec<_> = root
                .walk()
                .filter_map(|part| match part {
                    crate::patterns::Part::Pattern(Pattern::Range(a, b, at)) => Some((a, b, *at)),
                    _ => None,
                })
                .collect();
            for (a, b, at) in ranges {
                self.scalar_endpoints(a, b, document, at)?;
            }
        } else {
            self.check_pattern_depth(term, document, item)?;
        }
        let pattern = match term {
            Term::Pattern(p) => p.map_values(
                &|n, at| match &self.values[n].value {
                    Value::Pattern(p) => Ok(p.clone()),
                    Value::Str(s) => Ok(Pattern::Terminal(crate::tags::string_name(s, self.unicode), at)),
                    _ => Err(located("a pattern or string is needed here".into(), document, at)),
                },
                &|v, op| {
                    if op == "tags" {
                        return self.evaluate_test(v, op, document, item);
                    }
                    let result = self.evaluate(v, document, item)?;
                    if matches!(op, "literal" | "endpoint") {
                        let Value::Str(value) = result else {
                            return Err(located(
                                "a string literal is required".into(),
                                document,
                                first_constant(v).unwrap_or(item),
                            ));
                        };
                        if op == "endpoint" && value.chars().count() != 1 {
                            return Err(located(
                                "a range endpoint is one scalar".into(),
                                document,
                                first_constant(v).unwrap_or(item),
                            ));
                        }
                        return Ok(Term::Tag(crate::tags::string_name(&value, self.unicode)));
                    }
                    Ok(result.term())
                },
            )?,
            Term::Const(n, _) => match &self.values[n].value {
                Value::Pattern(p) => p.clone(),
                _ => unreachable!(),
            },
            Term::Union(xs) | Term::Intersection(xs) => {
                let ps = xs.iter().map(|x| self.evaluate_pattern(x, document, item)).collect::<Result<Vec<_>, _>>()?;
                if matches!(term, Term::Union(_)) {
                    Pattern::Union(
                        ps.into_iter().flat_map(|p| if let Pattern::Union(xs) = p { xs } else { vec![p] }).collect(),
                    )
                } else {
                    Pattern::Intersection(
                        ps.into_iter()
                            .flat_map(|p| if let Pattern::Intersection(xs) = p { xs } else { vec![p] })
                            .collect(),
                    )
                }
            }
            Term::Difference(a, b) => Pattern::Difference(
                Box::new(self.evaluate_pattern(a, document, item)?),
                Box::new(self.evaluate_pattern(b, document, item)?),
            ),
            _ => unreachable!(),
        };
        for part in pattern.walk() {
            if let crate::patterns::Part::Pattern(test @ Pattern::Test(op, _, inner, mark_at)) = part {
                if op == "tags" && matches!(inner.as_ref(), Pattern::Name(..)) && crate::patterns::requires_elided(test)
                {
                    return Err(located(
                        "a rule pattern cannot require _Elided".into(),
                        document,
                        mark_at.unwrap_or(item),
                    ));
                }
            }
        }
        if matches!(term, Term::Pattern(_)) {
            self.patterns.borrow_mut().push((pattern.clone(), document.to_owned()));
        }
        Ok(Value::Pattern(pattern))
    }
    fn evaluate_plain(&self, root: &Term, document: &str, item: (usize, usize)) -> Result<Value, Error> {
        let mut pending = vec![(root, false)];
        let mut values: Vec<Value> = Vec::new();
        while let Some((term, ready)) = pending.pop() {
            let children: Vec<&Term> = match term {
                Term::Union(items) | Term::Intersection(items) => items.iter().collect(),
                Term::Difference(a, b) => vec![a, b],
                Term::Call(_, args) => {
                    args.iter().filter_map(|arg| if let Arg::Term(term) = arg { Some(term) } else { None }).collect()
                }
                _ => Vec::new(),
            };
            if !ready {
                pending.push((term, true));
                pending.extend(children.iter().rev().map(|&term| (term, false)));
                continue;
            }
            let mut operands = values.split_off(values.len() - children.len()).into_iter();
            let value = match term {
                Term::Source(_) => unreachable!("source symbols expand before constant binding"),
                Term::Body(_) => return Err(Error::grammar("a parse body cannot be a constant").in_document(document)),
                Term::Str(text) => Value::Str(text.clone()),
                Term::Tag(tag) => Value::Set(BTreeSet::from([tag.clone()])),
                Term::EmptySet => Value::Set(BTreeSet::new()),
                Term::Const(name, at) => self
                    .values
                    .get(name)
                    .ok_or_else(|| located(format!("${name} is not defined in stage {}", self.stage), document, *at))?
                    .value
                    .clone(),
                Term::Union(_) => Value::Set(operands.flat_map(|value| value.set()).collect()),
                Term::Intersection(_) => {
                    let mut sets = operands.map(Value::set);
                    let mut common = sets.next().unwrap_or_default();
                    for next in sets {
                        common.retain(|tag| next.contains(tag));
                    }
                    Value::Set(common)
                }
                Term::Difference(..) => {
                    let mut left = operands.next().unwrap().set();
                    let right = operands.next().unwrap().set();
                    left.retain(|tag| !right.contains(tag));
                    Value::Set(left)
                }
                Term::Call(name, args) => match (name.as_str(), &args[..]) {
                    ("concat", _) => Value::Str(operands.map(Value::string).collect()),
                    ("ngrams", [_, Arg::Integer(n)]) => {
                        Value::Set(crate::dom::ngrams(&operands.next().unwrap().string(), n).into_iter().collect())
                    }
                    ("split", [_, Arg::Term(delimiter)]) => {
                        let text = operands.next().unwrap().string();
                        let delimiter_value = operands.next().unwrap().string();
                        if delimiter_value.is_empty() {
                            return Err(located(
                                "split has an empty delimiter".into(),
                                document,
                                if matches!(delimiter, Term::Call(name, _) if name == "concat") {
                                    item
                                } else {
                                    first_constant(delimiter).unwrap_or(item)
                                },
                            ));
                        }
                        Value::Set(
                            text.split(&delimiter_value).filter(|piece| !piece.is_empty()).map(str::to_owned).collect(),
                        )
                    }
                    _ => return Err(located("a constant's value is not a closed term".into(), document, item)),
                },
                Term::Pattern(_) => unreachable!("pattern values use their own evaluation"),
                Term::Capture(_) | Term::If(..) => {
                    return Err(located("a constant's value is not a closed term".into(), document, item))
                }
            };
            values.push(value);
        }
        Ok(values.pop().expect("the requested constant value"))
    }

    fn evaluate_pattern(&self, t: &Term, document: &str, at: (usize, usize)) -> Result<Pattern, Error> {
        match self.evaluate(t, document, at)? {
            Value::Pattern(p) => Ok(p),
            Value::Set(s) if s.is_empty() => Ok(Pattern::empty()),
            _ => Err(located("a pattern is needed here".into(), document, at)),
        }
    }

    /// An implication's two sides, with the constants' final values: closed
    /// terms whose type is a tag set (engine §2, §9). An undefined constant
    /// stands at its reference, and a side of another type at its first
    /// constant.
    fn implication(&self, document: &Arc<str>, implication: &ImplicationDef) -> Result<Implication, Error> {
        let mut sides = Vec::new();
        for side in [&implication.antecedent, &implication.consequent] {
            let mut references = Vec::new();
            constants_in_term(side, &mut references);
            for (name, at) in references {
                if !self.values.contains_key(name) {
                    return Err(located(format!("${name} is not defined in stage {}", self.stage), document, at));
                }
            }
            let fault = match term_type_in(side, &|name| self.ty(name)) {
                Err(fault) => Some(fault),
                Ok(ty) => expected_problem(ty, Type::Tags).map(|problem| Fault { problem, at: first_constant(side) }),
            };
            if let Some(Fault { problem, at }) = fault {
                let fault = Fault { problem: format!("a side of an implication is a tag set: {problem}"), at };
                return Err(fault_error(fault, document, implication.at));
            }
            sides.push(self.evaluate(side, document, implication.at)?.set());
        }
        let [antecedent, consequent] = <[BTreeSet<String>; 2]>::try_from(sides).expect("two sides");
        Ok(Implication { antecedent, consequent })
    }

    fn check_arguments(
        &self,
        arguments: &[&crate::parameters::expand::ArgumentUse],
        owner: Option<(&Arc<str>, &RuleDef)>,
    ) -> Result<(), Error> {
        use crate::parameters::expand::RetainedPart;
        struct Inspection<'a> {
            path: &'a str,
            root: ValuePart<'a>,
            at: (usize, usize),
            position: (usize, usize),
            tags: bool,
            fragment: bool,
        }
        let mut records = Vec::new();
        if let Some((path, rule)) = owner {
            records.push(Inspection {
                path,
                root: ValuePart::Rule(rule),
                at: rule.at,
                position: rule.at,
                tags: false,
                fragment: false,
            });
        }
        for argument in arguments {
            let (root, fragment) = match &argument.part {
                RetainedPart::Term(term) => (ValuePart::Term(term), false),
                RetainedPart::Fragment(rule) => (ValuePart::Rule(rule), true),
            };
            records.push(Inspection {
                path: &argument.path,
                root,
                at: argument.at,
                position: argument.position,
                tags: argument.tags,
                fragment,
            });
        }
        let mut references = Vec::new();
        for record in &records {
            let mut found = Vec::new();
            match record.root {
                ValuePart::Rule(rule) => found = constants_in_rule(rule),
                ValuePart::Term(term) => crate::dom::references_in_term(term, &mut found),
                _ => unreachable!(),
            }
            references.extend(found.into_iter().map(|(name, at)| (name, at, record.path)));
        }
        references.sort_by_key(|(_, at, _)| *at);
        for (name, at, path) in references {
            if !self.values.contains_key(name) {
                return Err(located(format!("${name} is not defined in stage {}", self.stage), path, at));
            }
        }
        for phase in 0..2 {
            let mut faults = Vec::new();
            for record in &records {
                let result = (|| {
                    if phase == 0 {
                        let fault = match record.root {
                            ValuePart::Rule(rule) => rule_type_fault(rule, &|name| self.ty(name)),
                            ValuePart::Term(term) => match term_type_in(term, &|name| self.ty(name)) {
                                Err(fault) => Some(fault),
                                Ok(ty) => {
                                    if record.tags {
                                        expected_problem(ty, Type::Tags)
                                            .map(|problem| Fault { problem, at: first_constant(term) })
                                    } else {
                                        None
                                    }
                                }
                            },
                            _ => unreachable!(),
                        };
                        if let Some(fault) = fault {
                            return Err(fault_error(fault, record.path, record.at));
                        }
                    } else {
                        self.check_value_uses(record.root, record.path, record.at, false)?;
                        if record.fragment {
                            let ValuePart::Rule(rule) = record.root else { unreachable!() };
                            let mut resolved = self.substitute_rule(rule);
                            if rule.source.params.is_some() {
                                resolved = crate::dom::partial::rule(&resolved)
                                    .map_err(|message| located(message, record.path, record.at))?;
                            }
                            if let Some(issue) = check_definition(&resolved, true).problem {
                                return Err(located(issue.message, record.path, record.at));
                            }
                        }
                    }
                    Ok(())
                })();
                if let Err(error) = result {
                    let at = (error.line.unwrap_or(record.at.0), error.column.unwrap_or(record.at.1));
                    faults.push((if at == record.at { record.position } else { at }, error));
                }
            }
            if let Some((_, error)) = faults.into_iter().min_by_key(|(position, _)| *position) {
                return Err(error);
            }
        }
        Ok(())
    }

    /// Checks one definition at its declaration slot after constant binding.
    fn check_rule(
        &self,
        document: &Arc<str>,
        rule: &RuleDef,
        arguments: &[&crate::parameters::expand::ArgumentUse],
        deferred: &mut Vec<Error>,
    ) -> Result<(), Error> {
        if arguments.is_empty() {
            for (name, at) in constants_in_rule(rule) {
                if !self.values.contains_key(name) {
                    return Err(located(format!("${name} is not defined in stage {}", self.stage), document, at));
                }
            }
            if let Some(fault) = rule_type_fault(rule, &|name| self.ty(name)) {
                return Err(fault_error(fault, document, rule.at));
            }
            self.check_value_uses(ValuePart::Rule(rule), document, rule.at, false)?;
        } else {
            self.check_arguments(arguments, Some((document, rule)))?;
        }
        // A bare empty set in a Boolean position is an error, read as
        // written, before any constant is substituted (engine §10).
        if rule.conditions.iter().any(crate::clauses::has_bare_empty_set) {
            return Err(located(format!("a condition of {} is the empty set", rule.name), document, rule.at));
        }
        // The checks that simplification decides, which the reader left
        // to the loader, now with the constants' values (§9).
        let resolved = self.substitute_rule(rule);
        for term in resolved.tags.iter().chain(resolved.alternatives.iter().filter_map(|a| a.tags.as_ref())) {
            if crate::notation::reads_own_tags(term) {
                return Err(located("a constituent reads its own tags".into(), document, rule.at));
            }
        }
        let projected;
        let checked = if rule.source.params.is_some() {
            projected = crate::dom::partial::rule(&resolved).map_err(|message| located(message, document, rule.at))?;
            &projected
        } else {
            &resolved
        };
        let result = check_definition(checked, true);
        if let Some(issue) = result.problem {
            return Err(located(issue.message, document, rule.at));
        }
        if let Some(issue) = result.deferred {
            deferred.push(located(issue.message, document, rule.at));
        }
        Ok(())
    }

    fn check_value_uses(
        &self,
        root: ValuePart<'_>,
        document: &str,
        at: (usize, usize),
        computed: bool,
    ) -> Result<(), Error> {
        for part in value_parts(root) {
            match part {
                ValuePart::Pattern(term) => {
                    self.check_pattern_uses(term, document, at)?;
                }
                ValuePart::Expr(expr @ Expr::Optional(_, _, Some(_))) => {
                    self.check_body_strings(expr, document, at)?;
                }
                ValuePart::Expr(Expr::ScalarRange(a, b)) => {
                    self.check_scalar_uses(a, b, document, at)?;
                }
                ValuePart::Term(term @ Term::Pattern(_)) => {
                    self.check_pattern_uses(term, document, at)?;
                }
                ValuePart::Term(Term::Call(name, args)) if name == "split" => {
                    if let [_, Arg::Term(delimiter)] = &args[..] {
                        if ((computed && closed_string(delimiter))
                            || matches!(delimiter, Term::Str(_) | Term::Const(..)))
                            && self.evaluate(delimiter, document, at)?.string().is_empty()
                        {
                            return Err(located(
                                "split has an empty delimiter".into(),
                                document,
                                if computed { at } else { first_constant(delimiter).unwrap_or(at) },
                            ));
                        }
                    }
                }
                _ => (),
            }
        }
        Ok(())
    }

    fn check_scalar_uses(&self, a: &Term, b: &Term, document: &str, at: (usize, usize)) -> Result<(), Error> {
        if !value_has_source(a) && !value_has_source(b) {
            self.scalar_endpoints(a, b, document, at)?;
        } else {
            for term in [a, b] {
                if !value_has_source(term) {
                    self.scalar_endpoints(term, term, document, at)?;
                }
            }
        }
        Ok(())
    }

    fn check_pattern_uses(&self, root: &Term, document: &str, at: (usize, usize)) -> Result<(), Error> {
        if !value_has_source(root) {
            self.evaluate_pattern(root, document, at)?;
            return Ok(());
        }
        self.check_pattern_depth(root, document, at)?;
        let mut pending = vec![root];
        while let Some(term) = pending.pop() {
            match term {
                Term::Pattern(p) => {
                    for part in p.walk() {
                        match part {
                            crate::patterns::Part::Pattern(Pattern::Range(a, b, position)) => {
                                self.check_scalar_uses(a, b, document, *position)?
                            }
                            crate::patterns::Part::Term(term, _) => {
                                self.check_value_uses(ValuePart::Term(term), document, at, false)?
                            }
                            crate::patterns::Part::Pattern(Pattern::Source(symbol)) => {
                                self.check_value_uses(ValuePart::Source(symbol), document, at, false)?
                            }
                            _ => (),
                        }
                    }
                }
                Term::Union(xs) | Term::Intersection(xs) => pending.extend(xs.iter().rev()),
                Term::Difference(a, b) => pending.extend([b.as_ref(), a.as_ref()]),
                Term::Source(symbol) => self.check_value_uses(ValuePart::Source(symbol), document, at, false)?,
                _ => {
                    self.evaluate_pattern(term, document, at)?;
                }
            }
        }
        Ok(())
    }

    fn resolve_feature(
        &self,
        document: &str,
        directive: &mut Directive,
        arguments: &[&crate::parameters::expand::ArgumentUse],
    ) -> Result<(), Error> {
        if let Some(conditions) = &mut directive.conditions {
            let mut references = Vec::new();
            for condition in conditions.iter() {
                crate::dom::constants_in_cond(condition, &mut references);
            }
            for argument in arguments {
                use crate::parameters::expand::RetainedPart;
                match &argument.part {
                    RetainedPart::Term(term) => crate::dom::references_in_term(term, &mut references),
                    RetainedPart::Fragment(rule) => references.extend(constants_in_rule(rule)),
                }
            }
            if !arguments.is_empty() {
                references.sort_by_key(|(_, at)| *at);
            }
            for (name, _) in references {
                if !self.values.contains_key(name) {
                    return Err(located(
                        format!("${name} is not defined in stage {}", self.stage),
                        document,
                        directive.at,
                    ));
                }
            }
            // A bare empty set in a Boolean position is an error (§10).
            if conditions.iter().any(crate::clauses::has_bare_empty_set) {
                return Err(located("a condition of %features is the empty set".to_string(), document, directive.at));
            }
            input_conditions_problem(conditions).map_err(|message| located(message, document, directive.at))?;
            for condition in conditions.iter() {
                if let Some(fault) = crate::dom::cond_type_fault(condition, &|name| self.ty(name)) {
                    return Err(located(fault.problem, document, directive.at));
                }
            }
            for condition in conditions.iter() {
                self.check_value_uses(ValuePart::Cond(condition), document, directive.at, true)?;
            }
            for condition in conditions.iter_mut() {
                self.substitute_cond(condition);
            }
        }
        Ok(())
    }

    fn resolve_classifier(&self, document: &str, classifier: &mut ClassifierDef) -> Result<(), Error> {
        for entry in &mut classifier.entries {
            for key in &mut entry.keys {
                let mut references = Vec::new();
                constants_in_term(key, &mut references);
                for (name, at) in references {
                    if !self.values.contains_key(name) {
                        return Err(located(format!("${name} is not defined in stage {}", self.stage), document, at));
                    }
                }
                let ty = term_type_in(key, &|name| self.ty(name)).map_err(|f| fault_error(f, document, entry.at))?;
                if let Some(problem) = expected_problem(ty, Type::String) {
                    return Err(located(problem, document, first_constant(key).unwrap_or(entry.at)));
                }
                *key = self.evaluate(key, document, entry.at)?.term();
            }
        }
        Ok(())
    }

    fn substitute_rules(&self, grammar: &mut StageGrammar) {
        // Each reference holds the final value. Shared clauses are
        // substituted once, and the alternatives that share them share the
        // result.
        // The map keeps each original alive, so that no address is reused.
        let mut substituted: FxMap<*const RuleClauses, (Arc<RuleClauses>, Arc<RuleClauses>)> = FxMap::default();
        for rule in &mut grammar.rules {
            for alternative in &mut rule.alternatives {
                if let Some(tags) = alternative.alternative.tags.as_mut() {
                    self.substitute_term(tags);
                }
                for recipe in
                    alternative.alternative.strings.value.iter_mut().chain(&mut alternative.alternative.strings.image)
                {
                    self.substitute_term(recipe);
                }
                let clauses = substituted
                    .entry(Arc::as_ptr(&alternative.clauses))
                    .or_insert_with(|| {
                        let mut clauses = RuleClauses::clone(&alternative.clauses);
                        let terms = clauses.tags.iter_mut().chain(clauses.emit.iter_mut().flatten().filter_map(
                            |item| match item {
                                EmitItem::Capture(_, tags, ..) => tags.as_mut(),
                                EmitItem::Insert(tags, _) => tags.as_mut(),
                            },
                        ));
                        for term in terms {
                            self.substitute_term(term);
                        }
                        for recipe in clauses
                            .strings
                            .value
                            .iter_mut()
                            .chain(&mut clauses.strings.image)
                            .chain(&mut clauses.error)
                            .chain(&mut clauses.warning)
                        {
                            self.substitute_term(recipe);
                        }
                        for item in clauses.emit.iter_mut().flatten() {
                            let strings = match item {
                                EmitItem::Capture(_, _, a) => &mut a.strings,
                                EmitItem::Insert(_, s) => s,
                            };
                            for recipe in strings.value.iter_mut().chain(&mut strings.image) {
                                self.substitute_term(recipe);
                            }
                        }
                        for cond in &mut clauses.conditions {
                            self.substitute_cond(cond);
                        }
                        (alternative.clauses.clone(), Arc::new(clauses))
                    })
                    .1
                    .clone();
                alternative.clauses = clauses;
            }
        }
    }

    fn scalar_endpoints(
        &self,
        left: &Term,
        right: &Term,
        document: &str,
        at: (usize, usize),
    ) -> Result<(char, char), Error> {
        let scalar = |term: &Term| -> Result<char, Error> {
            let value = self.evaluate(term, document, at)?.string();
            let mut chars = value.chars();
            match (chars.next(), chars.next()) {
                (Some(c), None) => Ok(c),
                _ => {
                    Err(located("a range endpoint is one scalar".into(), document, first_constant(term).unwrap_or(at)))
                }
            }
        };
        let a = scalar(left)?;
        let b = scalar(right)?;
        if a > b {
            return Err(located(
                "a range starts above its end".into(),
                document,
                first_constant(left).or_else(|| first_constant(right)).unwrap_or(at),
            ));
        }
        Ok((a, b))
    }

    fn check_body_strings(&self, root: &Expr, document: &str, at: (usize, usize)) -> Result<(), Error> {
        let mut pending = vec![root];
        while let Some(expr) = pending.pop() {
            match expr {
                Expr::ScalarRange(a, b) => {
                    self.scalar_endpoints(a, b, document, at)?;
                }
                Expr::Seq(items) | Expr::Choice(items) | Expr::Ranked(items, _) | Expr::And(items) => {
                    pending.extend(items.iter().rev())
                }
                Expr::Optional(inner, _, default) => {
                    if let Some(default) = default {
                        if matches!(default.term, Term::Source(_)) {
                            pending.push(inner);
                            continue;
                        }
                        let value = self.evaluate(&default.term, document, default.at.unwrap_or(at))?;
                        let Value::Str(value) = value else {
                            return Err(located(
                                "a default requires one string".into(),
                                document,
                                default.at.unwrap_or(at),
                            ));
                        };
                        let head = if let Expr::Seq(xs) = inner.as_ref() { &xs[0] } else { inner.as_ref() };
                        let mut base = head;
                        while let Expr::Tested(_, _, next) = base {
                            base = next;
                        }
                        let (Expr::Ref(name) | Expr::Terminal(name)) = base else {
                            pending.push(inner);
                            continue;
                        };
                        let mut tested = head;
                        while let Expr::Tested(op, operand, next) = tested {
                            let operand = self.evaluate_test(operand, op, document, at)?;
                            let test = crate::lower::SymbolTest::new(op, &operand, self.unicode);
                            if test.tags.iter().any(|t| t != name)
                                || test.negative.contains(name)
                                || test
                                    .sound
                                    .as_ref()
                                    .is_some_and(|s| (s == &value) != (test.op == crate::lower::TestOp::Is))
                            {
                                return Err(located(
                                    "a default fails its head test".into(),
                                    document,
                                    default.at.unwrap_or(at),
                                ));
                            }
                            tested = next;
                        }
                    }
                    pending.push(inner)
                }
                Expr::Capture(_, inner) | Expr::Splice(inner) | Expr::Tested(_, _, inner) => pending.push(inner),
                Expr::Repeat(item, separator, _) => {
                    pending.extend(separator.as_deref());
                    pending.push(item);
                }
                _ => {}
            }
        }
        Ok(())
    }

    /// Gives every test of a body its value, a string or a tag set, from
    /// the constants' final values (§2, §4). Each value is then a string,
    /// `∅`, a tag or a union of tags, in code point order.
    fn evaluate_tests(&self, grammar: &mut StageGrammar) -> Result<(), Error> {
        for rule in &mut grammar.rules {
            for alternative in &mut rule.alternatives {
                let mut stack = vec![&mut alternative.alternative.expr];
                while let Some(expr) = stack.pop() {
                    if matches!(expr, Expr::Optional(_, _, Some(_))) {
                        self.check_body_strings(expr, &alternative.document, alternative.at)?;
                    }
                    match expr {
                        Expr::Seq(items) | Expr::Choice(items) | Expr::Ranked(items, _) | Expr::And(items) => {
                            stack.extend(items.iter_mut())
                        }
                        Expr::Optional(inner, _, default) => {
                            if let Some(value) = default {
                                *value = crate::dom::DefaultValue {
                                    term: self.evaluate_test(
                                        &value.term,
                                        "=",
                                        &alternative.document,
                                        value.at.unwrap_or(alternative.at),
                                    )?,
                                    at: value.at,
                                };
                            }
                            stack.push(inner);
                        }
                        Expr::Capture(_, inner) | Expr::Splice(inner) => stack.push(inner),
                        Expr::Repeat(item, separator, _) => {
                            stack.push(item);
                            stack.extend(separator.as_deref_mut());
                        }
                        Expr::Tested(op, value, inner) => {
                            *value = self.evaluate_test(value, op, &alternative.document, alternative.at)?;
                            stack.push(inner);
                        }
                        Expr::Literal(value) => {
                            let value = self.evaluate(value, &alternative.document, alternative.at)?.string();
                            *expr = Expr::Terminal(crate::tags::string_name(&value, self.unicode));
                        }
                        Expr::ScalarRange(left, right) => {
                            let (a, b) = self.scalar_endpoints(left, right, &alternative.document, alternative.at)?;
                            *expr = Expr::Range(a, b);
                        }
                        Expr::Source(_)
                        | Expr::Ref(_)
                        | Expr::Terminal(_)
                        | Expr::Range(..)
                        | Expr::Wildcard
                        | Expr::Empty
                        | Expr::Remainder => {}
                    }
                }
            }
        }
        Ok(())
    }

    /// A copy of a rule definition in which each constant is its value.
    fn substitute_rule(&self, rule: &RuleDef) -> RuleDef {
        let mut rule = rule.clone();
        let terms = rule
            .error
            .iter_mut()
            .chain(&mut rule.warning)
            .chain(rule.tags.iter_mut())
            .chain(rule.alternatives.iter_mut().filter_map(|a| a.tags.as_mut()))
            .chain(rule.emit.iter_mut().flatten().filter_map(|item| match item {
                EmitItem::Capture(_, tags, ..) | EmitItem::Insert(tags, _) => tags.as_mut(),
            }));
        for term in terms {
            self.substitute_term(term);
        }
        for cond in &mut rule.conditions {
            self.substitute_cond(cond);
        }
        // The template forms are asked with their constants resolved,
        // as the rule's conditions are (engine §3.6).
        for cond in rule.template_conditions.iter_mut().flatten() {
            self.substitute_cond(cond);
        }
        rule
    }

    fn substitute_term(&self, term: &mut Term) {
        if self.is_pattern(term) {
            if value_has_source(term) {
                return;
            }
            *term = Term::Pattern(Box::new(self.evaluate_pattern(term, "", (0, 0)).expect("checked pattern")));
            return;
        }
        match term {
            Term::Body(body) => self.substitute_body(Arc::make_mut(body)),
            Term::Source(_) => (),
            Term::Const(name, _) => *term = self.values[name.as_str()].value.term(),
            Term::Union(items) | Term::Intersection(items) => {
                items.iter_mut().for_each(|item| self.substitute_term(item));
            }
            Term::Difference(left, right) => {
                self.substitute_term(left);
                self.substitute_term(right);
            }
            Term::If(cond, then) => {
                self.substitute_cond(cond);
                self.substitute_term(then);
            }
            Term::Call(_, args) => {
                for arg in args.iter_mut() {
                    if let Arg::Term(term) = arg {
                        self.substitute_term(term);
                    }
                }
            }
            Term::Pattern(_) | Term::Str(_) | Term::Tag(_) | Term::EmptySet | Term::Capture(_) => {}
        }
    }

    fn substitute_body(&self, body: &mut Expr) {
        let mut pending = vec![body];
        while let Some(expression) = pending.pop() {
            work::count(Work::Stitched, 1);
            match expression {
                Expr::Literal(term) => self.substitute_term(term),
                Expr::ScalarRange(left, right) => {
                    self.substitute_term(left);
                    self.substitute_term(right);
                }
                Expr::Tested(_, term, inner) => {
                    self.substitute_term(term);
                    pending.push(inner);
                }
                Expr::Optional(inner, _, default) => {
                    if let Some(default) = default {
                        self.substitute_term(&mut default.term);
                    }
                    pending.push(inner);
                }
                Expr::Seq(items) | Expr::Choice(items) | Expr::Ranked(items, _) | Expr::And(items) => {
                    pending.extend(items.iter_mut())
                }
                Expr::Capture(_, inner) | Expr::Splice(inner) => pending.push(inner),
                Expr::Repeat(inner, separator, _) => {
                    pending.push(inner);
                    pending.extend(separator.as_deref_mut());
                }
                _ => {}
            }
        }
    }

    fn substitute_cond(&self, cond: &mut Cond) {
        work::count(Work::Stitched, 1);
        match cond {
            Cond::Truthy(term) => self.substitute_term(term),
            Cond::Forest(term) => self.substitute_term(term),
            Cond::SourceQuery(_, args, _) => {
                for arg in args {
                    if let Arg::Term(term) = arg {
                        self.substitute_term(term);
                    }
                }
            }
            Cond::Compare(op, left, right, _) => {
                if matches!(op.as_str(), "≅" | "≇") && !matches!(right, Term::Capture(_)) {
                    if value_has_source(right) {
                        return;
                    }
                    *right =
                        Term::Pattern(Box::new(self.evaluate_pattern(right, "", (0, 0)).expect("checked pattern")));
                    return;
                }
                self.substitute_term(left);
                self.substitute_term(right);
            }
            Cond::Not(inner) => self.substitute_cond(inner),
            Cond::Any(items) | Cond::All(items) => items.iter_mut().for_each(|item| self.substitute_cond(item)),
            Cond::If(antecedent, consequent) => {
                self.substitute_cond(antecedent);
                self.substitute_cond(consequent);
            }
            Cond::Initial(_) | Cond::Final(_) | Cond::Boundary(_, _, _, _) | Cond::Captured(_) => {}
        }
    }
}

/// The error for a construct whose types disagree: at its first constant,
/// which the loader alone could type, or else at the item (engine §9).
fn fault_error(fault: Fault, document: &str, item: (usize, usize)) -> Error {
    located(fault.problem, document, fault.at.unwrap_or(item))
}

fn first_constant(term: &Term) -> Option<(usize, usize)> {
    let mut out = Vec::new();
    constants_in_term(term, &mut out);
    out.first().map(|&(_, at)| at)
}

/// Whether a value still needs a template argument before evaluation.
fn value_has_source(term: &Term) -> bool {
    let mut pending = vec![term];
    while let Some(root) = pending.pop() {
        for part in value_parts(ValuePart::Term(root)) {
            match part {
                ValuePart::Term(Term::Source(_)) | ValuePart::Cond(Cond::SourceQuery(..)) => return true,
                ValuePart::Term(Term::Pattern(p)) => {
                    for part in p.walk() {
                        match part {
                            crate::patterns::Part::Pattern(Pattern::Source(_)) => return true,
                            crate::patterns::Part::Term(term, _) => pending.push(term),
                            _ => (),
                        }
                    }
                }
                ValuePart::Pattern(term) => pending.push(term),
                _ => (),
            }
        }
    }
    false
}

/// Whether a string term reads only literals and constants.
fn closed_string(term: &Term) -> bool {
    let mut pending = vec![term];
    while let Some(term) = pending.pop() {
        match term {
            Term::Source(_) => unreachable!("source symbols expand before grammar checks"),
            Term::Str(_) | Term::Const(..) => {}
            Term::Call(name, args) if name == "concat" => {
                for arg in args {
                    let Arg::Term(term) = arg else { return false };
                    pending.push(term);
                }
            }
            _ => return false,
        }
    }
    true
}

#[derive(Clone, Copy)]
enum ValuePart<'a> {
    Source(&'a crate::dom::source::SourceSymbol),
    Rule(&'a RuleDef),
    Alternative(&'a Alternative),
    Expr(&'a Expr),
    Term(&'a Term),
    Cond(&'a Cond),
    Item(&'a EmitItem),
    Pattern(&'a Term),
}

struct ValueParts<'a> {
    pending: Vec<ValuePart<'a>>,
}

fn value_parts(root: ValuePart<'_>) -> ValueParts<'_> {
    ValueParts { pending: vec![root] }
}

fn value_channels<'a>(parts: &mut Vec<ValuePart<'a>>, channels: &'a Channels) {
    parts.extend(channels.value.iter().chain(channels.image.iter()).map(ValuePart::Term));
}

impl<'a> Iterator for ValueParts<'a> {
    type Item = ValuePart<'a>;
    fn next(&mut self) -> Option<Self::Item> {
        let part = self.pending.pop()?;
        let mut children = Vec::new();
        match part {
            ValuePart::Source(crate::dom::source::SourceSymbol::Call(call)) => {
                use crate::dom::source::{SourceArgument, SourceTarget};
                for arg in &call.args {
                    match arg {
                        SourceArgument::Term(t) | SourceArgument::Requirements(t) => children.push(ValuePart::Term(t)),
                        SourceArgument::Body(e) | SourceArgument::WrappedBody(e) => children.push(ValuePart::Expr(e)),
                        SourceArgument::Targets(ts) => children.extend(ts.iter().filter_map(|t| {
                            if let SourceTarget::Symbol(s) = t {
                                Some(ValuePart::Source(s))
                            } else {
                                None
                            }
                        })),
                    }
                }
            }
            ValuePart::Source(_) => (),
            ValuePart::Rule(rule) => {
                children.extend(rule.error.iter().chain(&rule.warning).chain(&rule.tags).map(ValuePart::Term));
                value_channels(&mut children, &rule.strings);
                children.extend(rule.alternatives.iter().map(ValuePart::Alternative));
                children.extend(rule.conditions.iter().map(ValuePart::Cond));
                children.extend(rule.emit.iter().flatten().map(ValuePart::Item));
            }
            ValuePart::Alternative(alt) => {
                children.push(ValuePart::Expr(&alt.expr));
                children.extend(alt.tags.iter().map(ValuePart::Term));
                value_channels(&mut children, &alt.strings);
            }
            ValuePart::Item(item) => {
                let (tags, strings) = match item {
                    EmitItem::Capture(_, tags, attachments) => (tags, &attachments.strings),
                    EmitItem::Insert(tags, strings) => (tags, strings),
                };
                children.extend(tags.iter().map(ValuePart::Term));
                value_channels(&mut children, strings);
            }
            ValuePart::Expr(expr) => match expr {
                Expr::Source(s) => children.push(ValuePart::Source(s)),
                Expr::Seq(xs) | Expr::Choice(xs) | Expr::Ranked(xs, _) | Expr::And(xs) => {
                    children.extend(xs.iter().map(ValuePart::Expr))
                }
                Expr::Optional(e, _, default) => {
                    children.push(ValuePart::Expr(e));
                    if let Some(default) = default {
                        children.push(ValuePart::Term(&default.term));
                    }
                }
                Expr::Capture(_, e) | Expr::Splice(e) => children.push(ValuePart::Expr(e)),
                Expr::Repeat(e, separator, _) => {
                    children.push(ValuePart::Expr(e));
                    children.extend(separator.iter().map(|e| ValuePart::Expr(e)));
                }
                Expr::Tested(_, value, inner) => {
                    children.push(ValuePart::Expr(inner));
                    children.push(ValuePart::Term(value));
                }
                Expr::Literal(value) => children.push(ValuePart::Term(value)),
                Expr::ScalarRange(a, b) => children.extend([ValuePart::Term(a), ValuePart::Term(b)]),
                _ => (),
            },
            ValuePart::Term(term) => match term {
                Term::Source(s) => children.push(ValuePart::Source(s)),
                Term::Union(xs) | Term::Intersection(xs) => children.extend(xs.iter().map(ValuePart::Term)),
                Term::Difference(a, b) => children.extend([ValuePart::Term(a), ValuePart::Term(b)]),
                Term::If(c, t) => children.extend([ValuePart::Cond(c), ValuePart::Term(t)]),
                Term::Call(_, args) => children.extend(args.iter().filter_map(|a| {
                    if let Arg::Term(t) = a {
                        Some(ValuePart::Term(t))
                    } else {
                        None
                    }
                })),
                _ => (),
            },
            ValuePart::Cond(cond) => match cond {
                Cond::SourceQuery(_, args, _) => children.extend(args.iter().filter_map(|a| {
                    if let Arg::Term(t) = a {
                        Some(ValuePart::Term(t))
                    } else {
                        None
                    }
                })),
                Cond::Compare(op, a, b, _) => {
                    children.push(ValuePart::Term(a));
                    children.push(if matches!(op.as_str(), "≅" | "≇") && !matches!(b, Term::Capture(_)) {
                        ValuePart::Pattern(b)
                    } else {
                        ValuePart::Term(b)
                    });
                }
                Cond::Truthy(t) => children.push(ValuePart::Term(t)),
                Cond::All(xs) | Cond::Any(xs) => children.extend(xs.iter().map(ValuePart::Cond)),
                Cond::If(a, b) => children.extend([ValuePart::Cond(a), ValuePart::Cond(b)]),
                Cond::Not(c) => children.push(ValuePart::Cond(c)),
                Cond::Initial(t) | Cond::Final(t) | Cond::Boundary(_, t, _, _) => children.push(ValuePart::Term(t)),
                _ => (),
            },
            ValuePart::Pattern(_) => (),
        }
        self.pending.extend(children.into_iter().rev());
        Some(part)
    }
}

/// Checks an alternative, and its rule's clauses where `clauses` says that
/// no alternative before it shared them.
fn check_alternative(
    grammar: &StageGrammar,
    alternative: &StitchedAlternative,
    clauses: bool,
) -> Result<(bool, bool), String> {
    let mut compared = false;
    check_expr(grammar, &alternative.alternative.expr)?;
    for term in alternative.alternative.tags.iter() {
        check_term(grammar, term, &mut compared)?;
    }
    if !clauses {
        return Ok((compared, compared));
    }
    let clauses = &alternative.clauses;
    for term in clauses.tags.iter() {
        check_term(grammar, term, &mut compared)?;
    }
    for cond in &clauses.conditions {
        check_cond(grammar, cond, &mut compared)?;
    }
    let recognition = compared;
    for item in clauses.emit.iter().flatten() {
        if let EmitItem::Capture(_, Some(term), ..) | EmitItem::Insert(Some(term), _) = item {
            check_term(grammar, term, &mut compared)?;
        }
    }
    Ok((recognition, compared))
}

fn check_rule(grammar: &StageGrammar, name: &str) -> Result<(), String> {
    if grammar.index.contains_key(name) {
        Ok(())
    } else {
        Err(format!("{name} is not a rule of stage {}", grammar.name))
    }
}

fn check_expr(grammar: &StageGrammar, expr: &Expr) -> Result<(), String> {
    match expr {
        Expr::Source(_) => unreachable!("source symbols expand before grammar checks"),
        Expr::Seq(items) | Expr::Choice(items) | Expr::Ranked(items, _) | Expr::And(items) => {
            for item in items {
                check_expr(grammar, item)?;
            }
            Ok(())
        }
        Expr::Repeat(item, separator, _) => {
            check_expr(grammar, item)?;
            separator.as_deref().map_or(Ok(()), |separator| check_expr(grammar, separator))
        }
        Expr::Splice(inner) | Expr::Optional(inner, _, _) | Expr::Tested(_, _, inner) => check_expr(grammar, inner),
        Expr::Ref(name) => {
            if is_terminal_name(name) {
                Ok(())
            } else {
                check_rule(grammar, name)
            }
        }
        Expr::Terminal(_)
        | Expr::Literal(_)
        | Expr::ScalarRange(..)
        | Expr::Range(..)
        | Expr::Wildcard
        | Expr::Empty
        | Expr::Remainder => Ok(()),
        // The reader, or the check of a DOM, has made sure that a capture
        // wraps one symbol (§9).
        Expr::Capture(_, inner) => check_expr(grammar, inner),
    }
}

// Admission checks span shapes and method arities before stitching.
// Only references to rules of this stage remain to be checked.
fn check_span_references(grammar: &StageGrammar, term: &Term) -> Result<(), String> {
    match term {
        Term::Capture(_) => Ok(()),
        Term::Call(_, args) => {
            for arg in args {
                match arg {
                    // A parse body in a span method is checked as a term
                    // of its own, so its references name rules (§2).
                    Arg::Term(Term::Body(body)) => {
                        if let Some(problem) = crate::query_forms::body_problem(body) {
                            return Err(problem.into());
                        }
                        check_expr(grammar, body)?;
                    }
                    Arg::Term(inner) => check_span_references(grammar, inner)?,
                    Arg::Rule(rule) => check_rule(grammar, rule)?,
                    _ => unreachable!("span method arguments were checked before stitching"),
                }
            }
            Ok(())
        }
        _ => unreachable!("span shapes were checked before stitching"),
    }
}

fn check_term(grammar: &StageGrammar, term: &Term, compared: &mut bool) -> Result<(), String> {
    match term {
        Term::Body(body) => {
            if let Some(problem) = crate::query_forms::body_problem(body) {
                return Err(problem.into());
            }
            check_expr(grammar, body)
        }
        Term::Source(_) => unreachable!("source symbols expand before grammar checks"),
        // Stitching has checked every constant (engine §2).
        Term::Pattern(_) | Term::Str(_) | Term::Tag(_) | Term::EmptySet | Term::Const(..) => Ok(()),
        Term::Union(items) | Term::Intersection(items) => {
            for item in items {
                check_term(grammar, item, compared)?;
            }
            Ok(())
        }
        Term::Difference(left, right) => {
            check_term(grammar, left, compared)?;
            check_term(grammar, right, compared)
        }
        Term::Capture(_) => Ok(()),
        Term::If(cond, then) => {
            check_cond(grammar, cond, compared)?;
            check_term(grammar, then, compared)
        }
        Term::Call(name, args) => match (name.as_str(), &args[..]) {
            ("parse", [Arg::Term(receiver), Arg::Term(Term::Body(body))]) => {
                if crate::query_forms::suffix_body(body) && crate::dom::restored_span(receiver) {
                    return Err("suffix parse requires an ordinary span, not a restored span".into());
                }
                check_span_references(grammar, receiver)?;
                check_term(grammar, &Term::Body(body.clone()), compared)
            }
            ("error-free", [Arg::Term(receiver)]) => check_term(grammar, receiver, compared),
            ("value" | "image", [Arg::Term(Term::Call(method, args))]) if method == "emitted" => {
                if let [Arg::Term(Term::Capture(_))] = &args[..] {
                    Ok(())
                } else {
                    Err("emitted requires a bare capture".into())
                }
            }
            ("value" | "image" | "source-text" | "decomposed-source-text" | "classes" | "tags", [Arg::Term(span)]) => {
                check_span_references(grammar, span)
            }
            ("ngrams", [Arg::Term(string), Arg::Integer(n)]) if crate::dom::valid_integer(n) => {
                check_term(grammar, string, compared)
            }
            ("split", [Arg::Term(string), Arg::Term(delimiter)]) => {
                check_term(grammar, string, compared)?;
                check_term(grammar, delimiter, compared)
            }
            ("concat", args) => {
                for arg in args {
                    if let Arg::Term(term) = arg {
                        check_term(grammar, term, compared)?;
                    }
                }
                Ok(())
            }
            ("verbatim-text" | "emitted", [Arg::Term(span)]) => check_span_references(grammar, span),
            // A classifier that classify names belongs to the stage (§2).
            ("classify", [Arg::Term(string), Arg::Classifier(classifier)]) => {
                check_term(grammar, string, compared)?;
                if grammar.classifiers.iter().any(|(_, item)| item.name == *classifier) {
                    Ok(())
                } else {
                    Err(format!("{classifier} is not a classifier of stage {}", grammar.name))
                }
            }
            (
                "first-token"
                | "tokens-after-first"
                | "last-token"
                | "onward"
                | "following-tokens"
                | "preceding-tokens"
                | "without-elision"
                | "without-elision-except",
                _,
            ) => check_span_references(grammar, term),
            (
                "value"
                | "source-text"
                | "decomposed-source-text"
                | "classes"
                | "tags"
                | "split"
                | "ngrams"
                | "classify"
                | "starts-input",
                _,
            ) => Err(format!("{name}() is called with the wrong arguments")),
            _ => Err(format!("an unknown function {name}()")),
        },
    }
}

fn check_cond(grammar: &StageGrammar, cond: &Cond, compared: &mut bool) -> Result<(), String> {
    work::count(Work::Stitched, 1);
    match cond {
        Cond::Truthy(term) => check_term(grammar, term, compared),
        Cond::Forest(term) => check_term(grammar, term, compared),
        Cond::SourceQuery(..) => unreachable!("source queries expand before grammar checks"),
        Cond::Compare(op, left, right, _) => {
            *compared |= matches!(op.as_str(), "≅" | "≇") && matches!(right, Term::Capture(_));
            if !matches!(op.as_str(), "=" | "≠" | "∈" | "∉" | "⊆" | "⊈" | "≅" | "≇") {
                return Err(format!("an unknown comparison {op}"));
            }
            check_term(grammar, left, compared)?;
            check_term(grammar, right, compared)
        }
        Cond::Initial(span) | Cond::Final(span) | Cond::Boundary(_, span, _, _) => check_span_references(grammar, span),
        Cond::Not(inner) => check_cond(grammar, inner, compared),
        Cond::Captured(_) => Ok(()),
        Cond::If(antecedent, consequent) => {
            check_cond(grammar, antecedent, compared)?;
            check_cond(grammar, consequent, compared)
        }
        Cond::Any(items) | Cond::All(items) => {
            for item in items {
                check_cond(grammar, item, compared)?;
            }
            Ok(())
        }
    }
}

/// Validate the token-only scope before checking resolved constant types (§13).
fn input_conditions_problem(conditions: &[Cond]) -> Result<(), String> {
    fn term(value: &Term) -> Result<(), String> {
        match value {
            Term::Capture(name) if !name.is_empty() => Err("feature conditions can read only $".into()),
            Term::Call(name, args) => {
                if !matches!(
                    name.as_str(),
                    "tags"
                        | "classes"
                        | "value"
                        | "image"
                        | "source-text"
                        | "decomposed-source-text"
                        | "first-token"
                        | "tokens-after-first"
                        | "last-token"
                        | "split"
                        | "ngrams"
                        | "concat"
                ) || name == "tags" && args.len() != 1
                {
                    return Err("feature conditions can read only tokens".into());
                }
                for arg in args {
                    if let Arg::Term(value) = arg {
                        term(value)?;
                    }
                }
                Ok(())
            }
            Term::Union(items) | Term::Intersection(items) => {
                for value in items {
                    term(value)?;
                }
                Ok(())
            }
            Term::Difference(left, right) => {
                term(left)?;
                term(right)
            }
            Term::If(condition, value) => {
                cond(condition)?;
                term(value)
            }
            _ => Ok(()),
        }
    }
    fn cond(value: &Cond) -> Result<(), String> {
        match value {
            Cond::Truthy(inner) => term(inner),
            Cond::Compare(op, left, right, _) if !matches!(op.as_str(), "≅" | "≇") => {
                term(left)?;
                term(right)
            }
            Cond::Not(inner) => cond(inner),
            Cond::Any(items) | Cond::All(items) => {
                for value in items {
                    cond(value)?;
                }
                Ok(())
            }
            Cond::If(left, right) => {
                cond(left)?;
                cond(right)
            }
            Cond::Captured(name) if name.is_empty() => Ok(()),
            _ => Err("feature conditions can read only tokens".into()),
        }
    }
    for condition in conditions {
        cond(condition)?;
        if let Some(fault) = crate::dom::cond_type_fault(condition, &|_| Type::Any) {
            return Err(fault.problem);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeSet, HashMap};
    use std::sync::Arc;

    use super::{stitch, Lean, StageGrammar};
    use crate::dom::{Alternative, ClassifierDef, Cond, ConstDef, Directive, Dom, Entry, Expr, Op, RuleDef, Term};
    use crate::unicode::Unicode;
    use crate::work::{assert_linear, assert_mutant_stops, Mutant, Work};

    /// A rule of n alternatives with n conditions, each of which reads a
    /// constant, stitches in about n: its alternatives share its clauses,
    /// they are checked once, and the constants are found in one walk.
    #[test]
    fn alternatives_share_their_rules_clauses() {
        let unicode =
            Unicode::parse(crate::loader::bundled("data/unicode/unicode.txt").expect("the table")).expect("the table");
        let dom = |n: usize| {
            let same = || {
                Cond::Compare("=".into(), Term::Const("k".into(), (1, 1)), Term::Str("a".into()), Default::default())
            };
            let rule = RuleDef {
                template_conditions: Vec::new(),
                error: None,
                warning: None,
                suppress_warnings: Vec::new(),
                source: Default::default(),
                strings: Default::default(),
                deferred_emission: None,
                name: "text".into(),
                op: Op::Define,
                tags: None,
                alternatives: (0..n)
                    .map(|_| Alternative {
                        strings: Default::default(),
                        gates: Vec::new(),
                        expr: Expr::Terminal("A".into()),
                        tags: None,
                        ranked_locations: Default::default(),
                    })
                    .collect(),
                emit: None,
                conditions: (0..n).map(|_| same()).collect(),
                erased: false,
                at: (0, 0),
            };
            let directive = Directive {
                conditions: None,
                name: "ambiguity-resolution".into(),
                args: Vec::new(),
                steps: Some(vec![crate::dom::Step { step: "greedy".into(), pattern: None, operand_at: None }]),
                at: (0, 0),
            };
            let dom = Dom {
                rules: vec![rule],
                directives: vec![directive],
                constants: vec![ConstDef {
                    name: "k".into(),
                    redefine: false,
                    value: Term::Str("a".into()),
                    at: (1, 1),
                }],
                classifiers: Vec::new(),
                implications: Vec::new(),
                ..Dom::default()
            };
            vec![(Arc::<str>::from("d.md"), Arc::new(dom))]
        };
        let doms = [dom(1000), dom(4000)];
        let mut run = |n: usize| {
            let grammar = stitch("s", &doms[usize::from(n != 1000)], &unicode).expect("a grammar");
            assert_eq!(grammar.rules[0].alternatives.len(), n);
        };
        assert_linear(Work::Stitched, 1000, &mut run);
        assert_linear(Work::Walked, 1000, &mut run);
        // A copy of the clauses for each alternative stops at the first
        // count past the budget.
        assert_mutant_stops(Work::Stitched, Mutant::ClausesPerAlternative, 1000, &mut run);
    }

    /// A key that a classifier puts in n classes and then takes out of
    /// them, first first, resolves in about n.
    #[test]
    fn a_key_of_many_classes_resolves_in_linear_work() {
        let grammar = |n: usize| {
            let entry = |index: usize, adds: bool| Entry {
                gates: Vec::new(),
                keys: vec![Term::Str("k".into())],
                adds,
                class: format!("C{index}"),
                at: (0, 0),
            };
            let entries =
                (0..n).map(|index| entry(index, true)).chain((0..n).map(|index| entry(index, false))).collect();
            StageGrammar {
                query_targets: Default::default(),
                tree_comparisons: false,
                tree_expressions: false,
                features: Vec::new(),
                unicode: std::sync::Arc::new(
                    crate::unicode::Unicode::parse(crate::loader::bundled("data/unicode/unicode.txt").unwrap())
                        .unwrap(),
                ),
                name: "s".into(),
                rules: Vec::new(),
                index: HashMap::new(),
                steps: Vec::new(),
                lean: Lean::Greedy,
                elision_only: false,
                ranked: Arc::new(crate::ranked::RankedGroups::default()),
                close_families: Arc::default(),
                changes: Vec::new(),
                classifiers: vec![(Arc::from("d.md"), ClassifierDef { name: "c".into(), entries, at: (0, 0) })],
                implications: Arc::from(Vec::new()),
            }
        };
        let grammars = [grammar(20_000), grammar(80_000)];
        assert_linear(Work::Classified, 20_000, &mut |n| {
            let tables = grammars[usize::from(n != 20_000)].resolve_classifiers(&BTreeSet::new()).expect("tables");
            assert!(tables["c"]["k"].is_empty());
        });
    }
}
