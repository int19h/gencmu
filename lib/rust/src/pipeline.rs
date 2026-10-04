//! A pipeline: the items of a pipeline document, with each `%include`
//! replaced by the items of the document it names, split into stages at
//! each `%stage` (engine §13).

use std::sync::Arc;

use crate::dom::{ClassifierDef, ConstDef, Directive, Dom, ImplicationDef, RuleDef};
use crate::error::Error;
use crate::fxhash::{FxMap, FxSet};

/// An item of a document: a rule, a directive, a constant's definition, a
/// classifier or an implication.
#[derive(Clone, Copy)]
pub(crate) enum Item<'a> {
    Rule(&'a RuleDef),
    Directive(&'a Directive),
    Constant(&'a ConstDef),
    Classifier(&'a ClassifierDef),
    Implication(&'a ImplicationDef),
}

impl Item<'_> {
    pub(crate) fn at(&self) -> (usize, usize) {
        match self {
            Item::Rule(rule) => rule.at,
            Item::Directive(directive) => directive.at,
            Item::Constant(constant) => constant.at,
            Item::Classifier(classifier) => classifier.at,
            Item::Implication(implication) => implication.at,
        }
    }
}

/// A document's rules, directives, constants, classifiers and implications
/// in the order they were written, which is the order of their positions
/// (engine §9).
pub(crate) fn items_in_order(dom: &Dom) -> Vec<Item<'_>> {
    let mut items: Vec<Item> = dom
        .rules
        .iter()
        .map(Item::Rule)
        .chain(dom.directives.iter().map(Item::Directive))
        .chain(dom.constants.iter().map(Item::Constant))
        .chain(dom.classifiers.iter().map(Item::Classifier))
        .chain(dom.implications.iter().map(Item::Implication))
        .collect();
    items.sort_by_key(Item::at);
    items
}

/// One stage of a spliced pipeline: its name, where its `%stage` stands,
/// and its items as runs of consecutive items of one document, each with a
/// DOM that holds exactly those items.
#[derive(Debug, Clone)]
pub(crate) struct SplicedStage {
    pub name: String,
    pub document: Arc<str>,
    pub at: (usize, usize),
    pub documents: Vec<(Arc<str>, Dom)>,
}

/// A spliced pipeline: its stages, and the features its `%features`
/// directives turn on, in code point order.
#[derive(Debug, Clone)]
pub(crate) struct Spliced {
    pub stages: Vec<SplicedStage>,
    pub features: Vec<String>,
}

/// Where a splice finds its documents.
pub(crate) trait Documents {
    /// The DOM of the document at `path`, or `None` when it does not exist.
    fn dom(&mut self, path: &str) -> Result<Option<Arc<Dom>>, Error>;
    /// `target` resolved against the document `base`, or `None` when it
    /// leads out of the documents a loader may read.
    fn resolve(&self, base: &str, target: &str) -> Option<String>;
}

struct Splicer<'d> {
    documents: &'d mut dyn Documents,
    stages: Vec<SplicedStage>,
    features: Vec<String>,
    /// The documents on the chain of includes, the stages' names with
    /// where each is in `stages`, and the features listed, so that a
    /// check of one is not a scan.
    on_chain: FxSet<Arc<str>>,
    stage_index: FxMap<String, usize>,
    feature_set: FxSet<String>,
    /// Whether the last item placed went into the stage's last run: an
    /// include or a `%stage` ends a run.
    open_run: bool,
}

impl Splicer<'_> {
    fn splice(&mut self, path: &Arc<str>, dom: &Dom, chain: &mut Vec<Arc<str>>) -> Result<(), Error> {
        for item in items_in_order(dom) {
            let (line, column) = item.at();
            let here = |message: String| Error::grammar(message).in_document(path).at(line, column);
            // An error of a document read on the way belongs to the stage
            // being built, if any.
            let stage_name = self.stages.last().map(|stage| stage.name.clone());
            let in_stage = |error: Error| match &stage_name {
                Some(name) => error.in_stage(name),
                None => error,
            };
            match item {
                Item::Directive(directive) if directive.name == "include" => {
                    let target_text = directive.args.first().map_or("", String::as_str);
                    let Some(target) = self.documents.resolve(path, target_text) else {
                        return Err(in_stage(here(format!("the document path {target_text} leaves the grammars"))));
                    };
                    chain.push(path.clone());
                    self.on_chain.insert(path.clone());
                    let through = || {
                        let mut names: Vec<&str> = chain.iter().map(|name| &**name).collect();
                        names.push(&target);
                        names.join(" → ")
                    };
                    if self.on_chain.contains(target.as_str()) {
                        return Err(in_stage(here(format!("{target} includes itself ({})", through()))));
                    }
                    let Some(included) = self.documents.dom(&target).map_err(in_stage)? else {
                        return Err(in_stage(here(format!("{target} was not found ({})", through()))));
                    };
                    self.open_run = false;
                    self.splice(&Arc::from(target.as_str()), &included, chain)?;
                    chain.pop();
                    self.on_chain.remove(path);
                    self.open_run = false;
                }
                Item::Directive(directive) if directive.name == "features" => {
                    for name in &directive.args {
                        if self.feature_set.insert(name.clone()) {
                            self.features.push(name.clone());
                        }
                    }
                }
                Item::Directive(directive) if directive.name == "stage" => {
                    let name = directive.args.first().cloned().unwrap_or_default();
                    if let Some(earlier) = self.stage_index.get(&name).map(|&index| &self.stages[index]) {
                        return Err(here(format!(
                            "a second stage named {name}; the first is at {}:{}:{}",
                            earlier.document, earlier.at.0, earlier.at.1
                        )));
                    }
                    self.stage_index.insert(name.clone(), self.stages.len());
                    self.stages.push(SplicedStage {
                        name,
                        document: path.clone(),
                        at: (line, column),
                        documents: Vec::new(),
                    });
                    self.open_run = false;
                }
                _ => {
                    let Some(stage) = self.stages.last_mut() else {
                        let what = match item {
                            Item::Rule(rule) => format!("the rule {}", rule.name),
                            Item::Constant(constant) => format!("the constant ${}", constant.name),
                            Item::Classifier(classifier) => format!("the classifier {}", classifier.name),
                            Item::Implication(_) => "%implies".to_string(),
                            Item::Directive(directive) => format!("%{}", directive.name),
                        };
                        return Err(here(format!("{what} stands before the first %stage")));
                    };
                    let continues = self.open_run && stage.documents.last().is_some_and(|(run, _)| run == path);
                    if !continues {
                        stage.documents.push((path.clone(), Dom::default()));
                        self.open_run = true;
                    }
                    let (_, run) = stage.documents.last_mut().expect("a run");
                    match item {
                        Item::Rule(rule) => run.rules.push(rule.clone()),
                        Item::Constant(constant) => run.constants.push(constant.clone()),
                        Item::Classifier(classifier) => run.classifiers.push(classifier.clone()),
                        Item::Implication(implication) => run.implications.push(implication.clone()),
                        Item::Directive(directive) => run.directives.push(directive.clone()),
                    }
                }
            }
        }
        Ok(())
    }
}

/// Splices the pipeline document at `path` (engine §13).
pub(crate) fn splice(path: &str, documents: &mut dyn Documents) -> Result<Spliced, Error> {
    let Some(top) = documents.dom(path)? else {
        return Err(Error::grammar(format!("the pipeline document {path} was not found")).in_document(path));
    };
    let mut splicer = Splicer {
        documents,
        stages: Vec::new(),
        features: Vec::new(),
        on_chain: FxSet::default(),
        stage_index: FxMap::default(),
        feature_set: FxSet::default(),
        open_run: false,
    };
    splicer.splice(&Arc::from(path), &top, &mut Vec::new())?;
    let Splicer { stages, mut features, .. } = splicer;
    if stages.is_empty() {
        return Err(Error::grammar("a pipeline needs at least one %stage").in_document(path));
    }
    for stage in &stages {
        if stage.documents.iter().all(|(_, dom)| dom.rules.is_empty()) {
            return Err(Error::grammar(format!("stage {} has no rules", stage.name))
                .in_document(&stage.document)
                .at(stage.at.0, stage.at.1)
                .in_stage(&stage.name));
        }
    }
    features.sort();
    Ok(Spliced { stages, features })
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use super::{splice, Documents};
    use crate::dom::{Alternative, Directive, Dom, Expr, Op, RuleDef};
    use crate::error::Error;
    use crate::growth::assert_linear;

    /// Documents held in memory, each path its own name.
    struct Held(HashMap<String, Arc<Dom>>);

    impl Documents for Held {
        fn dom(&mut self, path: &str) -> Result<Option<Arc<Dom>>, Error> {
            Ok(self.0.get(path).cloned())
        }

        fn resolve(&self, _: &str, target: &str) -> Option<String> {
            Some(target.to_string())
        }
    }

    /// A chain of n documents, each including the next, the last with a
    /// stage that lists n features, splices in about n: the chain, the
    /// stages and the features are checked by sets, not scans.
    #[test]
    fn a_long_include_chain_splices_in_linear_time() {
        let directive = |name: &str, args: Vec<String>| Directive { name: name.into(), args, at: (1, 1) };
        let held = move |n: usize| {
            let mut documents: HashMap<String, Arc<Dom>> = (0..n - 1)
                .map(|index| {
                    let include = directive("include", vec![format!("d{}", index + 1)]);
                    (format!("d{index}"), Arc::new(Dom { directives: vec![include], ..Dom::default() }))
                })
                .collect();
            let rule = RuleDef {
                name: "text".into(),
                op: Op::Define,
                tags: None,
                alternatives: vec![Alternative { guards: Vec::new(), expr: Expr::Empty, tags: None }],
                emit: None,
                conditions: Vec::new(),
                opaque: false,
                at: (3, 1),
            };
            let features = directive("features", (0..n).map(|index| format!("f{index}")).collect());
            let stage = Directive { at: (2, 1), ..directive("stage", vec!["main".into()]) };
            let last = Dom { rules: vec![rule], directives: vec![features, stage], ..Dom::default() };
            documents.insert(format!("d{}", n - 1), Arc::new(last));
            Held(documents)
        };
        // Each include is a frame of the splice, so the chain needs room.
        std::thread::Builder::new()
            .stack_size(256 << 20)
            .spawn(move || {
                let mut helds = [held(1500), held(6000)];
                assert_linear("splicing", 1500, &mut |n| {
                    let spliced = splice("d0", &mut helds[usize::from(n != 1500)]).expect("spliced");
                    assert_eq!(spliced.features.len(), n);
                });
            })
            .expect("a thread")
            .join()
            .expect("the test");
    }
}
