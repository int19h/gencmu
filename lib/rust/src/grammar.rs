//! Stitching a stage's documents into one grammar (engine §2), with the
//! checks that need no features: directives, definitions, references,
//! captures and terms.

use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;

use crate::clauses::definition_problem;
use crate::dom::{
    constant_value_type, constants_in_rule, constants_in_term, expected_problem, rule_type_fault, term_type_in,
    tests_in, Alternative, Arg, Channels, ClassifierDef, Cond, ConstDef, Dom, EmitItem, Expr, Fault, FeatureKind,
    ImplicationDef, Op, RuleDef, Term, Type,
};
use crate::error::Error;
use crate::fxhash::{FxMap, FxSet};
use crate::patterns::Pattern;
use crate::tags::character_tag;
use crate::unicode::Unicode;
use crate::work::{self, Mutant, Work};

/// The rule by which a stage ranks its derivations (engine §6): the lean
/// of rule 2, the counts of elided terminators, or, for the `elision-only`
/// check (§7), no lean at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Lean {
    Greedy,
    Lazy,
    /// A derivation beats another when its elision vector is less.
    LateElision,
    /// Neither: any two derivations that differ are tied, as the
    /// `elision-only` check ranks (§7). A directive cannot name it.
    Neither,
}

/// The clauses of a rule, which each of its alternatives shares, so that
/// they are stored, substituted and checked once for the rule.
#[derive(Debug, Clone)]
pub(crate) struct RuleClauses {
    pub tags: Option<Term>,
    pub strings: Channels,
    pub emit: Option<Vec<EmitItem>>,
    pub conditions: Vec<Cond>,
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
    pub flags: Vec<String>,
    pub name: String,
    pub alternatives: Vec<StitchedAlternative>,
    pub document: Arc<str>,
}

/// The flags before and after a replacement that changes them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FlagChange {
    /// The replaced rule's flags.
    pub from: Vec<String>,
    /// The replacement rule's flags.
    pub to: Vec<String>,
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
    /// The flags before and after the replacement, only if they differ.
    pub flag_change: Option<FlagChange>,
}

#[derive(Debug, Clone)]
pub(crate) struct StageGrammar {
    #[allow(dead_code)] // Retained for native audit consumers.
    pub parameters: crate::parameters::expand::Records,
    pub features: Vec<(Arc<str>, crate::dom::Directive)>,
    pub unicode: Arc<Unicode>,
    pub name: String,
    pub rules: Vec<StitchedRule>,
    pub index: HashMap<String, usize>,
    pub lean: Lean,
    pub elision_only: bool,
    pub ranked: Arc<crate::ranked::RankedGroups>,
    /// Whether an elided terminator is forbidden where its constituent
    /// could have been longer (engine §4).
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
                    .guards
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
                                format!("{key:?} is already in {}", entry.class)
                            } else {
                                format!("{key:?} is not in {}, so ∉ has nothing to remove", entry.class)
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
    let expansion = crate::parameters::expand(documents, unicode)?;
    let documents = expansion.as_ref().map_or(documents, |x| x.documents.as_slice());
    let mut grammar = StageGrammar {
        unicode: Arc::new(unicode.clone()),
        name: stage.to_string(),
        rules: Vec::new(),
        index: HashMap::new(),
        lean: Lean::Greedy,
        elision_only: false,
        ranked: Arc::new(crate::ranked::RankedGroups::default()),
        changes: Vec::new(),
        classifiers: Vec::new(),
        features: Vec::new(),
        implications: Arc::from(Vec::new()),
        parameters: expansion.as_ref().map_or_else(Default::default, |x| x.records.clone()),
    };
    let mut implications: Vec<(&Arc<str>, &ImplicationDef)> = Vec::new();
    let mut resolution: Option<(Arc<str>, (usize, usize))> = None;
    let mut constants =
        Constants { stage, unicode, values: HashMap::new(), versions: Vec::new(), latest: HashMap::new() };
    // The definitions of rules that use constants, which are checked once
    // the constants have their final values; a rule that a later one
    // replaces included.
    let mut users: Vec<(&Arc<str>, &RuleDef)> = Vec::new();
    let mut deferred = Vec::new();
    let mut text_order = 0;
    for (document, dom) in documents {
        for rule in &dom.rules {
            if let Some(problem) = &rule.deferred_emission {
                deferred.push(located(problem.clone(), document, rule.at));
            }
            if !constants_in_rule(rule).is_empty() {
                users.push((document, rule));
            }
            // The clauses are copied once for the rule, not for each
            // alternative. Each condition counts as it is copied.
            let copy_clauses = || {
                Arc::new(RuleClauses {
                    tags: rule.tags.clone(),
                    strings: rule.strings.clone(),
                    emit: rule.emit.clone(),
                    conditions: rule.conditions.iter().inspect(|_| work::count(Work::Stitched, 1)).cloned().collect(),
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
                flags: rule.flags.clone(),
                name: rule.name.clone(),
                alternatives: alternatives.clone(),
                document: document.clone(),
            };
            match rule.op {
                Op::Define => {
                    if grammar.index.contains_key(&rule.name) {
                        return error(format!(
                            "%rule {} is already defined; %redefine-rule replaces a rule",
                            rule.name
                        ));
                    }
                    grammar.index.insert(rule.name.clone(), grammar.rules.len());
                    grammar.rules.push(stitched());
                }
                Op::Redefine => {
                    // Any earlier item of the stage, in this document or
                    // another, may have defined it (engine §2).
                    let Some(&index) = grammar.index.get(&rule.name) else {
                        return error(format!("%redefine-rule {} replaces no rule defined before it", rule.name));
                    };
                    // The replacement keeps the place of the rule it
                    // replaces (§3, "Numbering").
                    let previous_flags = &grammar.rules[index].flags;
                    let flag_change = (previous_flags != &rule.flags)
                        .then(|| FlagChange { from: previous_flags.clone(), to: rule.flags.clone() });
                    grammar.rules[index] = stitched();
                    grammar.changes.push(Change {
                        stage: stage.to_string(),
                        rule: rule.name.clone(),
                        extension: false,
                        document: document.to_string(),
                        flag_change,
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
                        flag_change: None,
                    });
                }
            }
        }
        for directive in &dom.directives {
            let here = |message: String| located(message, document, directive.at);
            match directive.name.as_str() {
                "features" => grammar.features.push((document.clone(), directive.clone())),
                "ambiguity-resolution" => {
                    if resolution.is_some() {
                        return Err(here(format!("stage {stage} has two %ambiguity-resolution directives")));
                    }
                    let refused = || {
                        here(
                            "%ambiguity-resolution takes greedy, lazy or late-elision, then optionally elision-only"
                                .to_string(),
                        )
                    };
                    let mut args = directive.args.iter().map(String::as_str).peekable();
                    grammar.lean = match args.next() {
                        Some("greedy") => Lean::Greedy,
                        Some("lazy") => Lean::Lazy,
                        Some("late-elision") => Lean::LateElision,
                        _ => return Err(refused()),
                    };
                    // Each optional word in its place, and nothing after
                    // them (engine §2).
                    grammar.elision_only = args.next_if_eq(&"elision-only").is_some();
                    if args.next().is_some() {
                        return Err(refused());
                    }
                    resolution = Some((document.clone(), directive.at));
                }
                other => return Err(here(format!("an unknown directive %{other}"))),
            }
        }
        for constant in &dom.constants {
            constants.add(document, constant)?;
        }
        grammar.classifiers.extend(dom.classifiers.iter().map(|classifier| (document.clone(), classifier.clone())));
        implications.extend(dom.implications.iter().map(|implication| (document, implication)));
    }
    constants.bind()?;
    for (document, directive) in &mut grammar.features {
        if let Some(conditions) = &mut directive.conditions {
            crate::features::problem(conditions).map_err(|message| located(message, document, directive.at))?;
            for condition in conditions.iter_mut() {
                let mut references = Vec::new();
                crate::dom::constants_in_cond(condition, &mut references);
                for (name, _) in references {
                    if !constants.values.contains_key(name) {
                        return Err(located(
                            format!("${name} is not defined in stage {stage}"),
                            document,
                            directive.at,
                        ));
                    }
                }
                if let Some(fault) = crate::dom::cond_type_fault(condition, &|name| constants.ty(name)) {
                    return Err(located(fault.problem, document, directive.at));
                }
                let mut calls = Vec::new();
                calls_in_condition(condition, &mut calls);
                for (call, args) in calls {
                    if let ("split", [_, Arg::Term(delimiter)]) = (call, args) {
                        if closed_string(delimiter)
                            && constants.evaluate(delimiter, document, directive.at)?.string().is_empty()
                        {
                            return Err(located("split has an empty delimiter".into(), document, directive.at));
                        }
                    }
                }
                constants.substitute_cond(condition);
                if let Some(fault) = crate::dom::cond_type_fault(condition, &|_| Type::Any) {
                    return Err(located(fault.problem, document, directive.at));
                }
            }
        }
    }
    if let Some(expanded) = &expansion {
        for (path, rule) in &expanded.validation {
            users.push((path, rule));
        }
        let positions: HashMap<_, _> = expanded.order.iter().enumerate().map(|(i, n)| (n.as_str(), i)).collect();
        grammar.rules.sort_by_key(|r| positions.get(r.name.as_str()).copied().unwrap_or(usize::MAX));
        grammar.index = grammar.rules.iter().enumerate().map(|(i, r)| (r.name.clone(), i)).collect();
    }
    constants.resolve(&mut grammar, &users, &mut deferred)?;
    constants.evaluate_tests(&mut grammar)?;
    grammar.implications = implications
        .into_iter()
        .map(|(document, implication)| constants.implication(document, implication))
        .collect::<Result<Vec<_>, _>>()?
        .into();
    if resolution.is_none() {
        return Err(Error::grammar(format!("stage {stage} has no %ambiguity-resolution directive")).in_stage(stage));
    }
    if !grammar.index.contains_key("text") {
        return Err(Error::grammar(format!("stage {stage} does not define its start rule text")).in_stage(stage));
    }
    // Shared clauses are checked once, with the first alternative that
    // holds them.
    let mut checked: FxSet<*const RuleClauses> = FxSet::default();
    for rule in &grammar.rules {
        for alternative in &rule.alternatives {
            let first = checked.insert(Arc::as_ptr(&alternative.clauses));
            check_alternative(&grammar, alternative, first).map_err(|message| {
                located(format!("in {}: {message}", rule.name), &alternative.document, alternative.at)
            })?;
        }
    }
    crate::boundary::reachable(&grammar)?;
    grammar.ranked = Arc::new(crate::ranked::RankedGroups::new(&grammar)?);
    if !grammar.ranked.groups.is_empty() {
        let lowered =
            crate::lower::lower_for_slots(&grammar).map_err(|e| located(e.message, &e.document, (e.line, e.column)))?;
        grammar.ranked.validate_tags(&grammar, &lowered)?;
    }
    if let Some(error) = deferred.into_iter().next() {
        return Err(error);
    }
    let mut alternatives: Vec<_> = grammar.rules.iter().flat_map(|rule| &rule.alternatives).collect();
    alternatives.sort_by_key(|alternative| alternative.text_order);
    for alternative in alternatives {
        recipe_cycles(alternative)?;
    }
    emission_overlap(&grammar)?;
    Ok(grammar)
}

/// Potential input consumption ignores gates, tests, and productivity.
fn consuming(expr: &Expr, rules: &FxSet<String>) -> bool {
    let mut pending = vec![expr];
    while let Some(expr) = pending.pop() {
        match expr {
            Expr::Ref(name) if is_terminal_name(name) || rules.contains(name) => return true,
            Expr::Terminal(_) | Expr::Literal(_) | Expr::ScalarRange(..) | Expr::Range(..) | Expr::Property(_) => {
                return true
            }
            Expr::Seq(items) | Expr::Choice(items) | Expr::Ranked(items) | Expr::And(items) => pending.extend(items),
            Expr::Capture(_, inner) | Expr::Optional(inner, _) | Expr::Tested(_, _, inner) => pending.push(inner),
            Expr::Repeat(item, separator, _) => {
                pending.push(item);
                pending.extend(separator.as_deref());
            }
            _ => {}
        }
    }
    false
}

#[derive(Clone, Default)]
struct OwnershipShape {
    consuming: bool,
    captures: FxMap<String, bool>,
}
fn ownership_shapes(expr: &Expr, rules: &FxSet<String>) -> Vec<OwnershipShape> {
    let join = |left: Vec<OwnershipShape>, right: &[OwnershipShape]| {
        let mut out = Vec::new();
        for first in left {
            for second in right {
                let mut combined = first.clone();
                combined.consuming |= second.consuming;
                combined.captures.extend(second.captures.clone());
                out.push(combined);
            }
        }
        out
    };
    match expr {
        Expr::Seq(items) => {
            let mut shapes = vec![OwnershipShape::default()];
            for item in items {
                shapes = join(shapes, &ownership_shapes(item, rules));
            }
            shapes
        }
        Expr::Choice(items) | Expr::Ranked(items) => {
            items.iter().flat_map(|item| ownership_shapes(item, rules)).collect()
        }
        Expr::Optional(inner, crate::dom::Mark::Plain) => {
            let mut shapes = vec![OwnershipShape::default()];
            shapes.extend(ownership_shapes(inner, rules));
            shapes
        }
        Expr::And(items) => {
            let expanded: Vec<_> = items.iter().map(|item| ownership_shapes(item, rules)).collect();
            let mut shapes = Vec::new();
            for first in 0..items.len() {
                let mut selected = expanded[first].clone();
                for next in &expanded[first + 1..] {
                    let mut optional = vec![OwnershipShape::default()];
                    optional.extend(next.clone());
                    selected = join(selected, &optional);
                }
                shapes.extend(selected);
            }
            shapes
        }
        Expr::Capture(name, symbol) => vec![OwnershipShape {
            consuming: consuming(symbol, rules),
            captures: FxMap::from_iter([(name.clone(), consuming(symbol, rules))]),
        }],
        _ => vec![OwnershipShape { consuming: consuming(expr, rules), captures: FxMap::default() }],
    }
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
            for shape in ownership_shapes(&alternative.alternative.expr, &reads) {
                let retained: Vec<_> = items
                    .iter()
                    .filter(|item| match item {
                        EmitItem::Capture(name, ..) => name.is_empty() || shape.captures.contains_key(name),
                        EmitItem::Insert(..) => true,
                    })
                    .collect();
                for (first, item) in retained.iter().enumerate() {
                    for other in &retained[first + 1..] {
                        let parts = |item: &EmitItem| -> Vec<(bool, bool)> {
                            match item {
                                EmitItem::Capture(name, _, _) if name.is_empty() => vec![(true, shape.consuming)],
                                EmitItem::Capture(name, _, attachments) => attachments
                                    .before
                                    .iter()
                                    .chain(std::iter::once(name))
                                    .chain(&attachments.after)
                                    .filter_map(|name| shape.captures.get(name).map(|&reads| (false, reads)))
                                    .collect(),
                                EmitItem::Insert(..) => Vec::new(),
                            }
                        };
                        if parts(item).iter().any(|a| parts(other).iter().any(|b| (a.0 && b.1) || (b.0 && a.1))) {
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
        term.as_ref().map(|term| (term, at.unwrap_or(alternative.at)))
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
                    return Err(located(
                        format!("a constituent recipe cycles: {}", steps.join(" -> ")),
                        &alternative.document,
                        at,
                    ));
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

    /// Defines or redefines a constant, with the value its term has at this
    /// point of the stage (engine §2).
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
                    located(format!("${name} is not defined in stage {}", self.stage), &version.document, at)
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
                let p = Pattern::Terminal("EMPTY".into(), (0, 0));
                Value::Pattern(Pattern::Difference(Box::new(p.clone()), Box::new(p)))
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

    fn evaluate_pattern_value(&self, term: &Term, document: &str, item: (usize, usize)) -> Result<Value, Error> {
        if let Term::Pattern(root) = term {
            if let Some(fault) = root.type_fault(&|name| self.ty(name)) {
                return Err(located(fault.problem, document, fault.at.unwrap_or(item)));
            }
            enum Part<'a> {
                Pattern(&'a Pattern),
                Children(&'a crate::patterns::Children),
            }
            use crate::patterns::Children;
            let mut pending = vec![Part::Pattern(root)];
            while let Some(part) = pending.pop() {
                match part {
                    Part::Pattern(pattern) => match pattern {
                        Pattern::Range(a, b, at) => {
                            self.scalar_endpoints(a, b, document, *at)?;
                        }
                        Pattern::Union(items) | Pattern::Intersection(items) => {
                            pending.extend(items.iter().map(Part::Pattern))
                        }
                        Pattern::Difference(a, b) => {
                            pending.push(Part::Pattern(a));
                            pending.push(Part::Pattern(b));
                        }
                        Pattern::Test(_, _, inner) | Pattern::Path(_, inner) => pending.push(Part::Pattern(inner)),
                        Pattern::Node(node, _, children) => {
                            pending.push(Part::Pattern(node));
                            pending.extend(children.as_ref().map(Part::Children));
                        }
                        _ => {}
                    },
                    Part::Children(children) => match children {
                        Children::Node(pattern) => pending.push(Part::Pattern(pattern)),
                        Children::Sequence(items) | Children::Choice(items) => {
                            pending.extend(items.iter().map(Part::Children))
                        }
                        Children::Optional(inner) => pending.push(Part::Children(inner)),
                        Children::Repeat(item, separator) => {
                            pending.push(Part::Children(item));
                            pending.extend(separator.as_deref().map(Part::Children));
                        }
                        Children::Siblings => {}
                    },
                }
            }
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
                                "a range endpoint must be one scalar".into(),
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
            Value::Set(s) if s.is_empty() => {
                let p = Pattern::Terminal("EMPTY".into(), (0, 0));
                Ok(Pattern::Difference(Box::new(p.clone()), Box::new(p)))
            }
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

    /// Gives every constant in a rule its final value, once the stage is
    /// stitched, and checks what the reader could not: that each is
    /// defined, that the types agree, and that a constant that `split` or
    /// `tag` reads directly is a delimiter that is not empty, or a name
    /// (engine §2, §9, §10).
    fn resolve(
        &self,
        grammar: &mut StageGrammar,
        users: &[(&Arc<str>, &RuleDef)],
        deferred: &mut Vec<Error>,
    ) -> Result<(), Error> {
        for &(document, rule) in users {
            for (name, at) in constants_in_rule(rule) {
                if !self.values.contains_key(name) {
                    return Err(located(format!("${name} is not defined in stage {}", self.stage), document, at));
                }
            }
            if let Some(fault) = rule_type_fault(rule, &|name| self.ty(name)) {
                return Err(fault_error(fault, document, rule.at));
            }
            for alternative in &rule.alternatives {
                self.check_body_strings(&alternative.expr, document, rule.at)?;
            }
            enum Part<'a> {
                Term(&'a Term),
                Cond(&'a Cond),
            }
            let mut todo: Vec<Part> = rule.conditions.iter().map(Part::Cond).collect();
            todo.extend(rule.tags.iter().map(Part::Term));
            todo.extend(rule.alternatives.iter().filter_map(|a| a.tags.as_ref()).map(Part::Term));
            for item in rule.emit.iter().flatten() {
                if let EmitItem::Capture(_, Some(t), ..) | EmitItem::Insert(Some(t), _) = item {
                    todo.push(Part::Term(t));
                }
            }
            while let Some(part) = todo.pop() {
                match part {
                    Part::Term(t) => match t {
                        Term::Pattern(_) => {
                            self.evaluate_pattern(t, document, rule.at)?;
                        }
                        Term::Union(xs) | Term::Intersection(xs) => todo.extend(xs.iter().map(Part::Term)),
                        Term::Difference(a, b) => {
                            todo.push(Part::Term(a));
                            todo.push(Part::Term(b));
                        }
                        Term::If(c, t) => {
                            todo.push(Part::Cond(c));
                            todo.push(Part::Term(t));
                        }
                        Term::Call(_, xs) => todo.extend(xs.iter().filter_map(|x| {
                            if let Arg::Term(t) = x {
                                Some(Part::Term(t))
                            } else {
                                None
                            }
                        })),
                        _ => {}
                    },
                    Part::Cond(c) => match c {
                        Cond::Compare(op, a, b) => {
                            if matches!(op.as_str(), "≅" | "≇") {
                                self.evaluate_pattern(b, document, rule.at)?;
                            }
                            todo.push(Part::Term(a));
                            todo.push(Part::Term(b));
                        }
                        Cond::Any(xs) | Cond::All(xs) => todo.extend(xs.iter().map(Part::Cond)),
                        Cond::Not(c) => todo.push(Part::Cond(c)),
                        Cond::If(a, b) => {
                            todo.push(Part::Cond(a));
                            todo.push(Part::Cond(b));
                        }
                        _ => {}
                    },
                }
            }
            // The checks that simplification decides, which the reader left
            // to the loader, now with the constants' values (§9).
            if let Some(problem) = definition_problem(&self.substitute_rule(rule)) {
                if crate::dom::deferred_emission_problem(&problem)
                    && rule.alternatives.iter().any(|a| crate::ranked::contains_ranked(&a.expr))
                {
                    deferred.push(located(problem, document, rule.at));
                } else {
                    return Err(located(problem, document, rule.at));
                }
            }
            let mut calls = Vec::new();
            calls_in_rule(rule, &mut calls);
            for (call, args) in calls {
                if let ("split", [_, Arg::Term(delimiter)]) = (call, args) {
                    if matches!(delimiter, Term::Str(_) | Term::Const(..))
                        && self.evaluate(delimiter, document, rule.at)?.string().is_empty()
                    {
                        return Err(located(
                            "split has an empty delimiter".into(),
                            document,
                            first_constant(delimiter).unwrap_or(rule.at),
                        ));
                    }
                }
            }
        }
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
                        for recipe in clauses.strings.value.iter_mut().chain(&mut clauses.strings.image) {
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
        for (document, classifier) in &mut grammar.classifiers {
            for entry in &mut classifier.entries {
                for key in &mut entry.keys {
                    let mut references = Vec::new();
                    constants_in_term(key, &mut references);
                    for (name, at) in references {
                        if !self.values.contains_key(name) {
                            return Err(located(
                                format!("${name} is not defined in stage {}", self.stage),
                                document,
                                at,
                            ));
                        }
                    }
                    let ty =
                        term_type_in(key, &|name| self.ty(name)).map_err(|f| fault_error(f, document, entry.at))?;
                    if let Some(problem) = expected_problem(ty, Type::String) {
                        return Err(located(problem, document, first_constant(key).unwrap_or(entry.at)));
                    }
                    *key = self.evaluate(key, document, entry.at)?.term();
                }
            }
        }
        Ok(())
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
                _ => Err(located(
                    "a range endpoint must be one scalar".into(),
                    document,
                    first_constant(term).unwrap_or(at),
                )),
            }
        };
        let a = scalar(left)?;
        let b = scalar(right)?;
        if a > b {
            return Err(located(
                "range starts above its end".into(),
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
                Expr::Seq(items) | Expr::Choice(items) | Expr::Ranked(items) | Expr::And(items) => {
                    pending.extend(items.iter().rev())
                }
                Expr::Optional(inner, _) | Expr::Capture(_, inner) | Expr::Tested(_, _, inner) => pending.push(inner),
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
                    match expr {
                        Expr::Seq(items) | Expr::Choice(items) | Expr::Ranked(items) | Expr::And(items) => {
                            stack.extend(items.iter_mut())
                        }
                        Expr::Optional(inner, _) | Expr::Capture(_, inner) => stack.push(inner),
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
                            *expr = Expr::Range(character_tag(a, self.unicode), character_tag(b, self.unicode));
                        }
                        Expr::Ref(_) | Expr::Terminal(_) | Expr::Range(..) | Expr::Property(_) | Expr::Empty => {}
                    }
                }
            }
        }
        Ok(())
    }

    /// A copy of a rule definition in which each constant is its value.
    fn substitute_rule(&self, rule: &RuleDef) -> RuleDef {
        let mut rule = rule.clone();
        let terms = rule.tags.iter_mut().chain(rule.alternatives.iter_mut().filter_map(|a| a.tags.as_mut())).chain(
            rule.emit.iter_mut().flatten().filter_map(|item| match item {
                EmitItem::Capture(_, tags, ..) | EmitItem::Insert(tags, _) => tags.as_mut(),
            }),
        );
        for term in terms {
            self.substitute_term(term);
        }
        for cond in &mut rule.conditions {
            self.substitute_cond(cond);
        }
        rule
    }

    fn substitute_term(&self, term: &mut Term) {
        if self.is_pattern(term) {
            *term = Term::Pattern(Box::new(self.evaluate_pattern(term, "", (0, 0)).expect("checked pattern")));
            return;
        }
        match term {
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

    fn substitute_cond(&self, cond: &mut Cond) {
        work::count(Work::Stitched, 1);
        match cond {
            Cond::Compare(op, left, right) => {
                if matches!(op.as_str(), "≅" | "≇") {
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
            Cond::Matches(..)
            | Cond::Begins(..)
            | Cond::Ends(..)
            | Cond::Initial(_)
            | Cond::Final(_)
            | Cond::Boundary(_, _, _, _)
            | Cond::Captured(_) => {}
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

/// Whether a string term reads only literals and constants.
fn closed_string(term: &Term) -> bool {
    let mut pending = vec![term];
    while let Some(term) = pending.pop() {
        match term {
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

fn calls_in_term<'r>(term: &'r Term, out: &mut Vec<(&'r str, &'r [Arg])>) {
    match term {
        Term::Call(name, args) => {
            out.push((name, args));
            for arg in args {
                if let Arg::Term(inner) = arg {
                    calls_in_term(inner, out);
                }
            }
        }
        Term::Union(items) | Term::Intersection(items) => items.iter().for_each(|item| calls_in_term(item, out)),
        Term::Difference(left, right) => {
            calls_in_term(left, out);
            calls_in_term(right, out);
        }
        Term::If(condition, then) => {
            calls_in_condition(condition, out);
            calls_in_term(then, out);
        }
        Term::Pattern(_) | Term::Str(_) | Term::Tag(_) | Term::EmptySet | Term::Capture(_) | Term::Const(..) => {}
    }
}

fn calls_in_condition<'r>(condition: &'r Cond, out: &mut Vec<(&'r str, &'r [Arg])>) {
    match condition {
        Cond::Compare(_, left, right) => {
            calls_in_term(left, out);
            calls_in_term(right, out);
        }
        Cond::Not(inner) => calls_in_condition(inner, out),
        Cond::Any(items) | Cond::All(items) => items.iter().for_each(|item| calls_in_condition(item, out)),
        Cond::If(antecedent, consequent) => {
            calls_in_condition(antecedent, out);
            calls_in_condition(consequent, out);
        }
        Cond::Matches(..)
        | Cond::Begins(..)
        | Cond::Ends(..)
        | Cond::Initial(_)
        | Cond::Final(_)
        | Cond::Boundary(_, _, _, _)
        | Cond::Captured(_) => {}
    }
}

/// The calls of a rule's terms and conditions, each before its argument calls.
fn calls_in_rule<'r>(rule: &'r RuleDef, out: &mut Vec<(&'r str, &'r [Arg])>) {
    rule.tags.iter().for_each(|term| calls_in_term(term, out));
    for alternative in &rule.alternatives {
        tests_in(&alternative.expr).into_iter().for_each(|(_, term, _)| calls_in_term(term, out));
        alternative.tags.iter().for_each(|term| calls_in_term(term, out));
    }
    for item in rule.emit.iter().flatten() {
        if let EmitItem::Capture(_, Some(term), ..) | EmitItem::Insert(Some(term), _) = item {
            calls_in_term(term, out);
        }
    }
    rule.conditions.iter().for_each(|condition| calls_in_condition(condition, out));
}

/// Checks an alternative, and its rule's clauses where `clauses` says that
/// no alternative before it shared them.
fn check_alternative(grammar: &StageGrammar, alternative: &StitchedAlternative, clauses: bool) -> Result<(), String> {
    check_expr(grammar, &alternative.alternative.expr)?;
    for term in alternative.alternative.tags.iter() {
        check_term(grammar, term)?;
    }
    if !clauses {
        return Ok(());
    }
    let clauses = &alternative.clauses;
    for term in clauses.tags.iter() {
        check_term(grammar, term)?;
    }
    for cond in &clauses.conditions {
        check_cond(grammar, cond)?;
    }
    for item in clauses.emit.iter().flatten() {
        if let EmitItem::Capture(_, Some(term), ..) | EmitItem::Insert(Some(term), _) = item {
            check_term(grammar, term)?;
        }
    }
    Ok(())
}

fn check_rule(grammar: &StageGrammar, name: &str) -> Result<(), String> {
    if grammar.index.contains_key(name) {
        Ok(())
    } else {
        Err(format!("the rule {name} is not defined in stage {}", grammar.name))
    }
}

fn check_expr(grammar: &StageGrammar, expr: &Expr) -> Result<(), String> {
    match expr {
        Expr::And(items) if items.len() > MAX_AND => {
            Err(format!("an & of {} items; at most {MAX_AND} are allowed", items.len()))
        }
        Expr::Seq(items) | Expr::Choice(items) | Expr::Ranked(items) | Expr::And(items) => {
            for item in items {
                check_expr(grammar, item)?;
            }
            Ok(())
        }
        Expr::Repeat(item, separator, _) => {
            check_expr(grammar, item)?;
            separator.as_deref().map_or(Ok(()), |separator| check_expr(grammar, separator))
        }
        Expr::Optional(inner, _) | Expr::Tested(_, _, inner) => check_expr(grammar, inner),
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
        | Expr::Property(_)
        | Expr::Empty => Ok(()),
        // The reader, or the check of a DOM, has made sure that a capture
        // wraps one symbol (§9).
        Expr::Capture(_, inner) => check_expr(grammar, inner),
    }
}

fn check_span(grammar: &StageGrammar, term: &Term) -> Result<(), String> {
    match term {
        Term::Capture(_) => Ok(()),
        Term::Call(name, args) if name == "without-elision-except" => match &args[..] {
            [Arg::Term(Term::Capture(_)), Arg::Rule(rule)] => check_rule(grammar, rule),
            _ => Err(".without-elision-except takes a bare capture and one rule name".to_string()),
        },
        Term::Call(name, args)
            if matches!(
                name.as_str(),
                "head" | "tail" | "last" | "from" | "after" | "preceding-tokens" | "without-elision"
            ) =>
        {
            match &args[..] {
                [Arg::Term(Term::Capture(_))] if name == "without-elision" => Ok(()),
                _ if name == "without-elision" => {
                    Err("without-elision() takes one bare capture: use from(without-elision($x)) for an extended query"
                        .to_string())
                }
                [Arg::Term(inner)] => check_span(grammar, inner),
                _ => Err(format!("{name}() takes one span")),
            }
        }
        _ => Err("a span must be a capture, or head(), tail(), last(), from() or after() of one".to_string()),
    }
}

fn check_term(grammar: &StageGrammar, term: &Term) -> Result<(), String> {
    match term {
        // Stitching has checked every constant (engine §2).
        Term::Pattern(_) | Term::Str(_) | Term::Tag(_) | Term::EmptySet | Term::Const(..) => Ok(()),
        Term::Union(items) | Term::Intersection(items) => {
            for item in items {
                check_term(grammar, item)?;
            }
            Ok(())
        }
        Term::Difference(left, right) => {
            check_term(grammar, left)?;
            check_term(grammar, right)
        }
        Term::Capture(_) => Ok(()),
        Term::If(cond, then) => {
            check_cond(grammar, cond)?;
            check_term(grammar, then)
        }
        Term::Call(name, args) => match (name.as_str(), &args[..]) {
            ("value" | "image" | "text" | "decomposed-source-text" | "classes" | "tags", [Arg::Term(span)]) => {
                check_span(grammar, span)
            }
            ("tags", [Arg::Term(span), Arg::Rule(rule)]) => {
                check_span(grammar, span)?;
                check_rule(grammar, rule)
            }
            ("ngrams", [Arg::Term(string), Arg::Integer(n)]) if crate::dom::valid_integer(n) => {
                check_term(grammar, string)
            }
            ("split", [Arg::Term(string), Arg::Term(delimiter)]) => {
                check_term(grammar, string)?;
                check_term(grammar, delimiter)
            }
            ("concat", args) => {
                for arg in args {
                    if let Arg::Term(term) = arg {
                        check_term(grammar, term)?;
                    }
                }
                Ok(())
            }
            ("verbatim-text" | "emitted", [Arg::Term(span)]) => check_span(grammar, span),
            // A classifier that classify names belongs to the stage (§2).
            ("classify", [Arg::Term(string), Arg::Classifier(classifier)]) => {
                check_term(grammar, string)?;
                if grammar.classifiers.iter().any(|(_, item)| item.name == *classifier) {
                    Ok(())
                } else {
                    Err(format!("classify names {classifier}, which no %classifier of stage {} names", grammar.name))
                }
            }
            (
                "head"
                | "tail"
                | "last"
                | "from"
                | "after"
                | "preceding-tokens"
                | "without-elision"
                | "without-elision-except",
                _,
            ) => check_span(grammar, term),
            (
                "value"
                | "text"
                | "decomposed-source-text"
                | "classes"
                | "tags"
                | "split"
                | "ngrams"
                | "classify"
                | "matches"
                | "begins"
                | "ends"
                | "initial",
                _,
            ) => Err(format!("{name}() is called with the wrong arguments")),
            _ => Err(format!("an unknown function {name}()")),
        },
    }
}

fn check_cond(grammar: &StageGrammar, cond: &Cond) -> Result<(), String> {
    work::count(Work::Stitched, 1);
    match cond {
        Cond::Compare(op, left, right) => {
            if !matches!(op.as_str(), "=" | "≠" | "∈" | "∉" | "⊆" | "⊈" | "≅" | "≇") {
                return Err(format!("an unknown comparison {op}"));
            }
            check_term(grammar, left)?;
            check_term(grammar, right)
        }
        Cond::Matches(span, rule) | Cond::Begins(span, rule) | Cond::Ends(span, rule) => {
            if matches!(cond, Cond::Ends(..)) && crate::dom::restored_span(span) {
                return Err(".ends cannot read a restored span".into());
            }
            check_span(grammar, span)?;
            for target in rule {
                if !is_terminal_name(target) {
                    check_rule(grammar, target)?
                }
            }
            Ok(())
        }
        Cond::Initial(span) | Cond::Final(span) | Cond::Boundary(_, span, _, _) => check_span(grammar, span),
        Cond::Not(inner) => check_cond(grammar, inner),
        Cond::Captured(_) => Ok(()),
        Cond::If(antecedent, consequent) => {
            check_cond(grammar, antecedent)?;
            check_cond(grammar, consequent)
        }
        Cond::Any(items) | Cond::All(items) => {
            for item in items {
                check_cond(grammar, item)?;
            }
            Ok(())
        }
    }
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
        let unicode = Unicode::parse(crate::loader::bundled("data/unicode/unicode.txt").expect("the table")).expect("the table");
        let dom = |n: usize| {
            let same = || Cond::Compare("=".into(), Term::Const("k".into(), (1, 1)), Term::Str("a".into()));
            let rule = RuleDef {
                strings: Default::default(),
                deferred_emission: None,
                name: "text".into(),
                op: Op::Define,
                flags: Vec::new(),
                tags: None,
                alternatives: (0..n)
                    .map(|_| Alternative {
                        strings: Default::default(),
                        guards: Vec::new(),
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
                args: vec!["greedy".into()],
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
                guards: Vec::new(),
                keys: vec![Term::Str("k".into())],
                adds,
                class: format!("C{index}"),
                at: (0, 0),
            };
            let entries =
                (0..n).map(|index| entry(index, true)).chain((0..n).map(|index| entry(index, false))).collect();
            StageGrammar {
                features: Vec::new(),
                unicode: std::sync::Arc::new(
                    crate::unicode::Unicode::parse(crate::loader::bundled("data/unicode/unicode.txt").unwrap()).unwrap(),
                ),
                name: "s".into(),
                rules: Vec::new(),
                index: HashMap::new(),
                lean: Lean::Greedy,
                elision_only: false,
                ranked: Arc::new(crate::ranked::RankedGroups::default()),
                changes: Vec::new(),
                classifiers: vec![(Arc::from("d.md"), ClassifierDef { name: "c".into(), entries, at: (0, 0) })],
                implications: Arc::from(Vec::new()),
                parameters: Default::default(),
            }
        };
        let grammars = [grammar(20_000), grammar(80_000)];
        assert_linear(Work::Classified, 20_000, &mut |n| {
            let tables = grammars[usize::from(n != 20_000)].resolve_classifiers(&BTreeSet::new()).expect("tables");
            assert!(tables["c"]["k"].is_empty());
        });
    }
}
