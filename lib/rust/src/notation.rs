//! From the notation's document tree to a grammar DOM (engine §9).

use crate::dom::{
    call_type, comparison_problem, constant_type_problem, expected_problem, is_capture_name, is_classifier_name,
    joined_type, literal_call_problem, Alternative, Arg, Attachments, Chain, Channels, ClassifierDef, Cond, ConstDef,
    Directive, Dom, EmitItem, Entry, Expr, FeatureKind, Guard, ImplicationDef, Mark, Op, RuleDef, Term, Type,
};
use crate::error::Error;
use crate::fxhash::{FxMap, FxSet};
use crate::result::{Node, NodeKind, Token};
use crate::work::{self, Work};
mod calls;
use crate::dom::source::{SourceArgument, SourceCall, SourceSymbol};
use calls::{CallFrame, SourceArgumentFrame};
mod normalize;
mod patterns;

pub(crate) struct Reader<'a> {
    pub unresolved_nodes: std::cell::RefCell<FxMap<usize, bool>>,
    pub parts_cache: std::cell::RefCell<FxMap<usize, Vec<&'a Node>>>,
    pub parameters: std::cell::RefCell<FxSet<String>>,
    pub reading_head: std::cell::Cell<bool>,
    pub unresolved: std::cell::Cell<bool>,
    pub unicode: &'a crate::unicode::Unicode,
    pub defer_emission: bool,
    pub feature_context: std::cell::Cell<bool>,
    pub tokens: &'a [Token],
    pub strings: &'a crate::string_escapes::DocumentStrings<'a>,
    /// Each capture's boxed target identifies its source node.
    pub captures: std::cell::RefCell<FxMap<usize, &'a Node>>,
    /// Whether the innermost braces around the construct being read are a
    /// chain, where no capture stands, or flat braces, where a capture is an
    /// item capture, and how many ranked groups stand between those braces
    /// and the construct, where no item capture stands. `marked` is how many
    /// elidable optionals the reader is inside, where no capture stands
    /// either (engine §3.5, §9).
    pub chain: std::cell::Cell<bool>,
    pub item: std::cell::Cell<bool>,
    pub ranked: std::cell::Cell<usize>,
    pub marked: std::cell::Cell<usize>,
    pub allowed_marked: std::cell::RefCell<FxSet<usize>>,
    /// The document position of a grammar-text index.
    pub position: &'a dyn Fn(usize) -> (usize, usize),
    /// The source identity of the current elidable head.
    pub default_head: std::cell::Cell<usize>,
    pub head_defaults: std::cell::RefCell<FxMap<usize, crate::dom::DefaultValue>>,
    pub in_recipe: std::cell::Cell<bool>,
    /// The closed operand that the reader currently reads (engine §9, §10).
    pub closed_for: std::cell::Cell<Option<&'static str>>,
}

type R<T> = Result<T, Error>;

fn rule_name(node: &Node) -> &str {
    node.rule.as_deref().unwrap_or("")
}

impl<'a> Reader<'a> {
    fn value(&self, node: &Node) -> &str {
        node.token.and_then(|token| self.tokens.get(token)).map_or("", |token| token.value.as_str())
    }

    fn operator(&self, node: &Node) -> &str {
        match self.value(node) {
            "=\u{338}" => "≠",
            "∈\u{338}" => "∉",
            "⊆\u{338}" => "⊈",
            "≅\u{338}" => "≇",
            value => value,
        }
    }

    fn at(&self, node: &Node) -> (usize, usize) {
        let index = if node.kind == NodeKind::Token { node.token.unwrap_or(node.span.start) } else { node.span.start };
        let source = self
            .tokens
            .get(index)
            .map(|t| t.source.start)
            .unwrap_or_else(|| self.tokens.last().map_or(0, |t| t.source.end));
        (self.position)(source)
    }

    /// The first token of a construct.
    fn first(&self, node: &Node) -> (usize, usize) {
        let mut pending = vec![node];
        while let Some(current) = pending.pop() {
            if current.kind == NodeKind::Token {
                return self.at(current);
            }
            if current.kind != NodeKind::Elided {
                pending.extend(current.children.iter().rev());
            }
        }
        self.at(node)
    }

    fn error(&self, node: &Node, message: impl Into<String>) -> Error {
        let (line, column) = self.first(node);
        Error::grammar(message).at(line, column)
    }

    /// The parts of a node: its children, with each wrapper, a rule that
    /// the reader does not know, replaced by its own parts (engine §9).
    fn parts(&self, node: &'a Node) -> Vec<&'a Node> {
        let key = node as *const Node as usize;
        if let Some(parts) = self.parts_cache.borrow().get(&key) {
            return parts.clone();
        }
        let mut parts = Vec::new();
        let mut stack: Vec<&Node> = node.children.iter().rev().collect();
        while let Some(child) = stack.pop() {
            work::count(Work::Walked, 1);
            if child.kind == NodeKind::Elided {
                continue;
            }
            if child.kind == NodeKind::Rule && !KNOWN.contains(&rule_name(child)) {
                stack.extend(child.children.iter().rev());
            } else {
                parts.push(child);
            }
        }
        self.parts_cache.borrow_mut().insert(key, parts.clone());
        parts
    }

    fn rules<'n>(&self, node: &'a Node, name: &'n str) -> impl Iterator<Item = &'a Node> + 'n
    where
        'a: 'n,
    {
        self.parts(node).into_iter().filter(move |child| child.kind == NodeKind::Rule && rule_name(child) == name)
    }

    /// The parts of a rule, at least `least` of them.
    fn some(&self, node: &'a Node, name: &str, least: usize) -> R<Vec<&'a Node>> {
        let found: Vec<&Node> = self.rules(node, name).collect();
        if found.len() < least {
            let what = if least == 1 { name.to_string() } else { format!("{least} of {name}") };
            return Err(self.shape_error(node, what));
        }
        Ok(found)
    }

    /// An error of a tree whose shape the reader does not know. A caller
    /// can supply its own bootstrap (docs/api.md), and its notation can
    /// give such a tree. The reader then gives this error, and never
    /// assumes a shape that the tree lacks.
    fn shape_error(&self, node: &Node, what: impl std::fmt::Display) -> Error {
        self.error(node, format!("the notation's {} has no {what}", rule_name(node)))
    }

    /// The error of a child of a kind that the reader does not know.
    fn unknown(&self, node: &Node, child: &str) -> Error {
        self.error(node, format!("the notation's {} holds a {child}, which the reader does not know", rule_name(node)))
    }

    fn one(&self, node: &'a Node, name: &str) -> R<&'a Node> {
        self.rules(node, name).next().ok_or_else(|| self.shape_error(node, name))
    }

    fn tokens_of(&self, node: &'a Node) -> impl Iterator<Item = &'a Node> + 'a {
        self.parts(node).into_iter().filter(|child| child.kind == NodeKind::Token)
    }

    /// The first token of a node.
    fn token(&self, node: &'a Node) -> R<&'a Node> {
        self.tokens_of(node).next().ok_or_else(|| self.shape_error(node, "token"))
    }

    /// The one rule among a node's parts, which must be one of `kinds`.
    fn inner(&self, node: &'a Node, kinds: &[&str]) -> R<&'a Node> {
        match self.parts(node).into_iter().filter(|child| child.kind == NodeKind::Rule).collect::<Vec<_>>()[..] {
            [found] if kinds.contains(&rule_name(found)) => Ok(found),
            _ => Err(self.shape_error(node, format!("single part of these: {}", kinds.join(", ")))),
        }
    }

    pub(crate) fn document(&self, root: &'a Node) -> R<Dom> {
        let mut dom = Dom::default();
        let mut statement_seen = false;
        for node in self.parts(root) {
            let names = rule_name(node) == "directive" && self.value(self.token(node)?) == "%names";
            if names && statement_seen {
                return Err(self.error(node, "%names must precede every other statement"));
            }
            statement_seen |= !names;
            if node.kind != NodeKind::Rule {
                continue;
            }
            self.unresolved.set(false);
            self.parameters.borrow_mut().clear();
            let mut item = Dom::default();
            match rule_name(node) {
                "rule" => item.rules.push(self.rule(node)?),
                "directive" => item.directives.push(self.directive(node)?),
                "ranking-directive" => item.directives.push(self.ranking_directive(node)?),

                "constant-definition" => item.constants.push(self.constant(node)?),
                "classifier" => item.classifiers.push(self.classifier(node)?),
                "implication-declaration" => item.implications.push(self.implication_declaration(node)?),
                other => return Err(self.error(node, format!("the notation gives a {other} where an item stands"))),
            }
            // Normalize each declaration once before a partial view decodes it.
            normalize::document(&mut item);
            for rule in &mut item.rules {
                self.check_rule(rule)?;
            }
            dom.unresolved |= self.unresolved.get();
            dom.rules.extend(item.rules);
            dom.directives.extend(item.directives);
            dom.constants.extend(item.constants);
            dom.classifiers.extend(item.classifiers);
            dom.implications.extend(item.implications);
        }
        Ok(dom)
    }

    /// A `%classifier` item: its name, which begins with a lower-case
    /// letter, and its entries (engine §2, §9).
    fn classifier(&self, node: &'a Node) -> R<ClassifierDef> {
        let name_node = self.one(node, "classifier-name")?;
        let name = self.value(self.token(name_node)?).to_string();
        if !is_classifier_name(&name) {
            return Err(self.error(
                name_node,
                format!(
                    "{name} begins with a capital, so it is a tag; a classifier's name begins with a lower-case letter"
                ),
            ));
        }
        let mut entries = Vec::new();
        for entry in self.rules(node, "classifier-entry") {
            entries.push(self.entry(entry)?);
        }
        Ok(ClassifierDef { name, entries, at: self.first(node) })
    }

    /// An entry of a classifier: gates, canonical keys, `∈` or `∉`, and a
    /// class (engine §2, §9).
    fn entry(&self, node: &'a Node) -> R<Entry> {
        let guards = self.rules(node, "guard").map(|guard| self.guard(guard, true)).collect::<R<_>>()?;
        let mut keys = Vec::new();
        for key_node in self.some(node, "classifier-key", 1)? {
            let key = self.string_operand(self.inner(key_node, &["string", "constant-reference"])?)?;
            keys.push(key);
        }
        let operator = self.one(node, "classifier-operator")?;
        let adds = match self.operator(self.token(operator)?) {
            "∈" => true,
            "∉" => false,
            _ => return Err(self.error(operator, "invalid classifier operator")),
        };
        let class_node = self.one(node, "classifier-class")?;
        let written = self.value(self.token(class_node)?);
        let class = written;
        if !crate::tags::is_name(class) || !is_capital(class) || !class.ends_with(|c: char| c.is_ascii_uppercase()) {
            return Err(
                self.error(class_node, format!("{written} is not a class: a class starts and ends with a capital"))
            );
        }
        Ok(Entry { guards, keys, adds, class: class.to_string(), at: self.first(node) })
    }

    /// An implication, `%implies A ⟹ B`: two closed terms whose type is a
    /// tag set (engine §2, §9).
    fn implication_declaration(&self, node: &'a Node) -> R<ImplicationDef> {
        let mut sides = Vec::new();
        for side in self.some(node, "union", 2)?.into_iter().take(2) {
            self.closed_for.set(Some("a side of an implication"));
            let term = self.union(side, false);
            self.closed_for.set(None);
            let (term, ty) = term?;
            if let Some(problem) = expected_problem(ty, Type::Tags) {
                return Err(self.error(side, format!("a side of an implication is a tag set: {problem}")));
            }
            sides.push(term);
        }
        let [antecedent, consequent] =
            <[Term; 2]>::try_from(sides).map_err(|_| self.shape_error(node, "pair of sides"))?;
        Ok(ImplicationDef { antecedent, consequent, at: self.first(node) })
    }

    /// A constant's definition: its name without `$`, and its value, a
    /// closed term of a type that a constant can have (engine §2, §9, §10).
    fn constant(&self, node: &'a Node) -> R<ConstDef> {
        let definer = self.token(self.one(node, "constant-definer")?)?;
        let reference = self.token(self.one(node, "constant-reference")?)?;
        let name = self.value(reference).strip_prefix('$').unwrap_or("").to_string();
        if !crate::dom::is_constant_name(&name) {
            return Err(self.error(reference, "a constant requires a user name"));
        }
        let redefine = match self.value(definer) {
            "%const" => false,
            "%redefine-const" => true,
            _ => return Err(self.error(definer, "unknown constant definer")),
        };
        let value_node = self.one(node, "term")?;
        self.closed_for.set(Some("a constant's value"));
        let value = self.term(value_node, false);
        self.closed_for.set(None);
        let (value, ty) = value?;
        if let Some(problem) = constant_type_problem(ty, redefine) {
            return Err(self.error(value_node, problem));
        }
        Ok(ConstDef { name, redefine, value, at: self.at(definer) })
    }

    fn directive(&self, node: &'a Node) -> R<Directive> {
        let token = self.token(node)?;
        let name = self.value(token).strip_prefix('%').unwrap_or("");
        let parts: Vec<_> = self
            .parts(node)
            .into_iter()
            .filter(|part| {
                matches!(rule_name(part), "argument-word" | "argument-string" | "argument-tag" | "argument-term")
            })
            .collect();
        let names = parts.iter().all(|part| rule_name(part) == "argument-word");
        let operand_problem = match name {
            "include" | "names" if parts.len() != 1 || rule_name(parts[0]) != "argument-string" => {
                Some(format!("%{name} takes one string"))
            }
            "stage" | "extend-stage" | "redefine-stage" if parts.len() != 1 || !names => {
                Some(format!("%{name} takes one name"))
            }
            "features" if parts.is_empty() || !names => Some("%features takes one or more names".into()),
            "ambiguity-resolution" if !(1..=2).contains(&parts.len()) => {
                Some("%ambiguity-resolution takes one or two names".into())
            }
            "include" | "names" => None,
            _ if !names => Some(format!("%{name} takes names only")),
            _ => None,
        };
        if let Some(problem) = operand_problem {
            return Err(self.error(node, problem));
        }
        let mut args = Vec::new();
        let feature = |name: &str| {
            name.starts_with(|c: char| c.is_ascii_alphabetic())
                && name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
        };
        for part in &parts {
            if name == "include" || name == "names" {
                let token = self.token(part)?;
                let token = token
                    .token
                    .and_then(|index| self.tokens.get(index))
                    .ok_or_else(|| self.shape_error(node, "path token"))?;
                args.push(self.strings.decode(token, true)?);
            } else {
                args.push(self.value(self.token(part)?).into());
            }
        }
        let valid = match name {
            "include" | "names" => args.len() == 1,
            "stage" | "extend-stage" | "redefine-stage" => {
                matches!(&args[..], [name] if crate::dom::is_classifier_name(name))
            }
            "features" => !args.is_empty() && args.iter().all(|name| feature(name)),
            "elision-only" => args.is_empty(),
            _ => false,
        };
        if !valid {
            let problem = match name {
                "stage" | "extend-stage" | "redefine-stage" => format!("%{name} takes one lowercase name"),
                "features" => "%features takes feature names".into(),
                "ambiguity-resolution" => {
                    "%ambiguity-resolution takes a ranking name and optionally elision-only".into()
                }
                _ => "directive has the wrong operands".into(),
            };
            return Err(self.error(node, problem));
        }
        let conditions = match self.rules(node, "conditions-clause").next() {
            Some(clause) => {
                if name != "features" {
                    return Err(self.error(node, "only %features accepts conditions"));
                }
                self.feature_context.set(true);
                let conditions = (|| {
                    self.some(clause, "implication", 1)?
                        .into_iter()
                        .map(|item| self.implication(item))
                        .collect::<R<Vec<_>>>()
                })();
                self.feature_context.set(false);
                let (line, column) = self.first(node);
                Some(conditions.map_err(|mut error| {
                    error.line = Some(line);
                    error.column = Some(column);
                    error
                })?)
            }
            None => None,
        };
        Ok(Directive { name: name.into(), args, steps: None, conditions, at: self.at(token) })
    }

    /// `%ambiguity-resolution`: its steps, each a key step with a category
    /// or a lean, with a lean only last (engine §9.3).
    fn ranking_directive(&self, node: &'a Node) -> R<Directive> {
        let token = self.token(node)?;
        let mut steps = Vec::new();
        let nodes: Vec<_> = self.rules(node, "ranking-step").collect();
        for (index, step) in nodes.iter().enumerate() {
            let parts = self.parts(step);
            let name = self.value(parts[0]).to_string();
            let operand = parts.len() > 1;
            if if operand {
                !crate::dom::KEY_STEPS.contains(&name.as_str())
            } else {
                !crate::dom::LEANS.contains(&name.as_str()) || index + 1 != nodes.len()
            } {
                return Err(self.error(
                    node,
                    "%ambiguity-resolution requires a pattern for each key step and no operand on a final lean",
                ));
            }
            let pattern = parts
                .get(1)
                .map(|operand| self.typed(Frame::Atom(Atom::new(operand, false))).map(|(term, _)| term))
                .transpose()?;
            steps.push(crate::dom::Step { step: name, pattern, operand_at: parts.get(1).map(|n| self.at(n)) });
        }
        if !crate::dom::valid_steps(&steps) {
            return Err(self.error(
                node,
                "%ambiguity-resolution requires a pattern for each key step and no operand on a final lean",
            ));
        }
        Ok(Directive {
            name: "ambiguity-resolution".into(),
            args: Vec::new(),
            steps: Some(steps),
            conditions: None,
            at: self.at(token),
        })
    }

    fn rule(&self, node: &'a Node) -> R<RuleDef> {
        let definer = self.token(self.one(node, "definer")?)?;
        let mut source = crate::dom::source::SourceHead::default();
        let (name, name_token) = if let Some(name) = self.rules(node, "rule-name").next() {
            let token = self.token(name)?;
            (self.value(token).to_string(), token)
        } else {
            let head = self.one(node, "call")?;
            self.reading_head.set(true);
            let call = self.source_call(head);
            self.reading_head.set(false);
            let call = call?;
            let params: Option<Vec<_>> = call
                .args
                .iter()
                .map(|arg| match arg {
                    SourceArgument::Term(Term::Source(SourceSymbol::Parameter(name, _)))
                    | SourceArgument::Body(Expr::Source(SourceSymbol::Parameter(name, _))) => Some(name.clone()),
                    _ => None,
                })
                .collect();
            if let Some(params) = params {
                for argument in &call.args {
                    let (SourceArgument::Term(Term::Source(SourceSymbol::Parameter(name, at)))
                    | SourceArgument::Body(Expr::Source(SourceSymbol::Parameter(name, at)))) = argument
                    else {
                        unreachable!("a parameter-only head")
                    };
                    if !self.parameters.borrow_mut().insert(name.clone()) {
                        return Err(Error::grammar(format!("duplicate parameter @{name}")).at(at.0, at.1));
                    }
                }
                source.params = Some(params);
            } else {
                let mut pending = vec![head];
                while let Some(part) = pending.pop() {
                    if rule_name(part) == "parameter" {
                        return Err(self.error(head, "a head cannot mix parameters and concrete arguments"));
                    }
                    pending.extend(self.parts(part));
                }
                if self.value(definer) == "%rule" {
                    return Err(self.error(head, "an instance head requires an edit"));
                }
                source.args = Some(call.args);
            }
            (call.name, self.token(head)?)
        };
        if !self.unicode.is_emoji_name(&name) && !is_classifier_name(&name) {
            return Err(self.error(name_token, "a rule name starts with a lowercase letter or uses one eligible emoji"));
        }
        let op = match self.value(definer) {
            "%redefine-rule" => Op::Redefine,
            "%extend-rule" => Op::Extend,
            "%rule" => Op::Define,
            _ => return Err(self.error(definer, "unknown rule definer")),
        };
        if self.tokens_of(node).any(|token| self.value(token) == "=") {
            if source.params.is_some() || source.args.is_some() {
                return Err(self.error(node, "a binding requires a plain rule name"));
            }
            source.instance = Some(self.source_call(self.one(node, "call")?)?);
            return Ok(RuleDef {
                error: None,
                warning: None,
                suppress_warnings: Vec::new(),
                source,
                deferred_emission: None,
                name,
                op,
                tags: None,
                strings: Default::default(),
                alternatives: Vec::new(),
                conditions: Vec::new(),
                emit: None,
                erased: false,
                at: self.at(definer),
            });
        }
        // The parts of a definition are read in the order written: the
        // body, then its clauses in their fixed order, and the checks of the
        // whole definition last (§9).
        let tags = match self.rules(node, "tags-clause").next() {
            Some(clause) => Some(self.constituent_tags(clause)?),
            None => None,
        };
        let strings = self.channels(node)?;
        let mut alternatives = Vec::new();
        let body = self
            .rules(node, "body")
            .next()
            .or_else(|| self.rules(node, "headed-body").next())
            .ok_or_else(|| self.shape_error(node, "body"))?;
        let alternatives_nodes = match self.rules(body, "ranked-alternative").next() {
            Some(ranked) => vec![ranked],
            None => self.some(body, "alternative", 1)?,
        };
        for alternative in alternatives_nodes {
            alternatives.push(self.alternative(alternative)?);
        }
        // Each condition of the list is one condition (§9).
        let mut conditions = Vec::new();
        if let Some(clause) = self.rules(node, "conditions-clause").next() {
            for implication in self.some(clause, "implication", 1)? {
                conditions.push(self.implication(implication)?);
            }
        }
        let error = self.rules(node, "error-clause").next().map(|clause| self.recipe(clause)).transpose()?;
        let warning = self.rules(node, "warning-clause").next().map(|clause| self.recipe(clause)).transpose()?;
        let mut suppress_warnings = Vec::new();
        if let Some(clause) = self.rules(node, "suppress-warnings-clause").next() {
            for part in self.parts(clause) {
                if rule_name(part) == "suppression-code" {
                    suppress_warnings.push(self.value(self.token(part)?).to_string());
                } else if part.kind == NodeKind::Token && self.value(part) == "_" {
                    suppress_warnings.push("_".into());
                }
            }
            if suppress_warnings.is_empty() {
                return Err(self.error(clause, "a suppression list requires codes or _"));
            }
        }
        let emit = match self.rules(node, "emits-clause").next() {
            Some(clause) => Some(self.emission(clause)?),
            None => None,
        };
        let rule = RuleDef {
            error,
            warning,
            suppress_warnings,
            source,
            deferred_emission: None,
            name,
            op,
            tags,
            strings,
            alternatives,
            emit,
            conditions,
            erased: self.rules(node, "erased-clause").next().is_some(),
            at: self.at(definer),
        };
        Ok(rule)
    }

    fn check_rule(&self, rule: &mut RuleDef) -> R<()> {
        if rule.source.instance.is_some() {
            return Ok(());
        }
        let (line, column) = rule.at;
        if let Some(problem) = crate::diagnostics::definition_problem(rule) {
            return Err(Error::grammar(problem).at(line, column));
        }
        let projected;
        let checked = if self.unresolved.get() {
            projected = crate::dom::partial::rule(rule).map_err(|problem| Error::grammar(problem).at(line, column))?;
            &projected
        } else {
            &*rule
        };
        if let Some((message, at)) = crate::boundary::definition_problem(checked) {
            let (line, column) = at.unwrap_or(rule.at);
            return Err(Error::grammar(message).at(line, column));
        }
        // The definition is checked as a whole once it is read (§9).
        let result = crate::clauses::check_definition(checked, self.defer_emission);
        if let Some(issue) = result.problem {
            return Err(Error::grammar(issue.message).at(line, column));
        }
        rule.deferred_emission = result.deferred;
        Ok(())
    }

    fn guard(&self, node: &'a Node, _gates_only: bool) -> R<Guard> {
        let text = self.value(self.token(node)?);
        let text = text.strip_suffix('?').ok_or_else(|| self.error(node, "a guard ends with ?"))?;
        let kind = FeatureKind::Gate;
        let (feature, negated) = match text.strip_prefix('¬') {
            Some(feature) => (feature, true),
            None => (text, false),
        };
        if feature.contains("--")
            || !feature.starts_with(|c: char| c.is_ascii_alphabetic())
            || !feature.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
        {
            return Err(self.error(node, "invalid feature name"));
        }
        Ok(Guard { feature: feature.into(), kind, negated })
    }

    fn alternative(&self, node: &'a Node) -> R<Alternative> {
        // A guard token is `f?` or `¬f?` (§9).
        let guards = self.rules(node, "guard").map(|guard| self.guard(guard, false)).collect::<R<_>>()?;
        self.captures.borrow_mut().clear();
        let expr = if rule_name(node) == "ranked-alternative" {
            match self.run(Frame::Choice(Choice::new(self.one(node, "ranked-choice")?)))? {
                Val::Expr(expr) => expr,
                _ => unreachable!("an expression reads an expression"),
            }
        } else {
            self.conjunction(self.one(node, "conjunction")?, true)?
        };
        // A name stands at most once in each production, gates aside: the
        // error stands at the second capture that such a production reads,
        // the first in the text where there are several (§3.5, §9).
        if let Some(Expr::Capture(_, target)) = crate::clauses::duplicate_captures(&expr).first() {
            let capture = self.captures.borrow()[&(target.as_ref() as *const Expr as usize)];
            let name = self.value(self.token(capture)?).strip_prefix('$').unwrap_or("").to_string();
            return Err(
                self.error(capture, format!("the capture ${name} is read twice by one production of the alternative"))
            );
        }
        // The name of an item capture stands nowhere else in the
        // alternative (§3.5, §9): the error stands at the later capture in
        // the text.
        let items = crate::clauses::item_capture_names(&expr);
        if !items.is_empty() {
            let captures = self.captures.borrow();
            let mut seen: FxMap<&str, &Node> = FxMap::default();
            let mut capture_targets = Vec::new();
            let mut pending = vec![&expr];
            while let Some(node) = pending.pop() {
                if let Expr::Capture(_, target) = node {
                    capture_targets.push(target.as_ref());
                }
                match node {
                    Expr::Seq(items) | Expr::Choice(items) | Expr::Ranked(items, _) | Expr::And(items) => {
                        pending.extend(items.iter().rev())
                    }
                    Expr::Capture(_, inner)
                    | Expr::Splice(inner)
                    | Expr::Optional(inner, _, _)
                    | Expr::Tested(_, _, inner) => pending.push(inner),
                    Expr::Repeat(inner, sep, _) => {
                        pending.extend(sep.as_deref());
                        pending.push(inner);
                    }
                    _ => {}
                }
            }
            for (index, name) in capture_names(&expr).into_iter().enumerate() {
                let at = captures[&(capture_targets[index] as *const Expr as usize)];
                if let Some(&earlier) = seen.get(name) {
                    if items.contains(&name) {
                        let later = if self.first(earlier) < self.first(at) { at } else { earlier };
                        return Err(self.error(
                            later,
                            format!(
                                "the item capture ${name} is read again: the name of an item capture stands once in \
                                 its alternative"
                            ),
                        ));
                    }
                } else {
                    seen.insert(name, at);
                }
            }
        }
        let tags = match self.rules(node, "alternative-tags").next() {
            Some(tags) => Some(self.constituent_tags(tags)?),
            None => None,
        };
        Ok(Alternative { guards, expr, tags, strings: self.channels(node)?, ranked_locations: Default::default() })
    }

    /// A rule's or an alternative's tags, which say what the constituent's
    /// tags are and so cannot read them: `$.tags` and `$.classes` are
    /// errors anywhere in them, guards included (§9), reported at the
    /// clause.
    fn constituent_tags(&self, node: &'a Node) -> R<Term> {
        let source = self.one(node, "term")?;
        let term = self.tag_term(source)?;
        if reads_own_tags(&term) {
            return Err(self.error(node, "a constituent's tags cannot be made of its own: $.tags or $.classes"));
        }
        Ok(term)
    }

    /// A whole term that must be a tag set: a constituent's or an item's
    /// tags (engine §10). A type error stands at the term.
    fn tag_term(&self, node: &'a Node) -> R<Term> {
        let (term, ty) = self.term(node, false)?;
        if let Some(problem) = expected_problem(ty, Type::Tags) {
            return Err(self.error(node, problem));
        }
        if let Some((_, index)) = crate::dom::engine_literals(&term).into_iter().min_by_key(|(_, index)| *index) {
            return Err(self.engine_literal_error(node, index)?);
        }
        Ok(term)
    }

    fn engine_literal_error(&self, node: &'a Node, index: usize) -> R<Error> {
        let mut literals = Vec::new();
        let mut pending = vec![node];
        while let Some(part) = pending.pop() {
            if matches!(rule_name(part), "pattern-literal" | "any-of" | "method" | "call") {
                continue;
            }
            if rule_name(part) == "tag" {
                let token = self.token(part)?;
                if self.value(token).starts_with('_') {
                    literals.push(token);
                }
            } else {
                pending.extend(part.children.iter().rev());
            }
        }
        Ok(self.error(literals.get(index).copied().unwrap_or(node), "a tag clause cannot introduce an engine tag"))
    }

    /// `whole` is whether this is its alternative's whole expression, where
    /// a chain may stand (§9).
    fn conjunction(&self, node: &'a Node, whole: bool) -> R<Expr> {
        match self.run(Frame::Conjunction(Conjunction::new(node, whole)))? {
            Val::Expr(expr) => Ok(expr),
            _ => unreachable!("a conjunction reads an expression"),
        }
    }

    /// A `term`, with its type, which the reader finds as it reads it: the
    /// type of a part is found once, when the part is read (§10).
    /// `argument` is whether a span may stand here.
    fn term(&self, node: &'a Node, argument: bool) -> R<(Term, Type)> {
        self.typed(Frame::Term(TermFrame::new(node, argument)))
    }

    fn union(&self, node: &'a Node, argument: bool) -> R<(Term, Type)> {
        self.typed(Frame::Union(Joined::new(node, argument)))
    }

    fn typed(&self, frame: Frame<'a>) -> R<(Term, Type)> {
        match self.run(frame)? {
            Val::Term(term, ty) => Ok((term, ty)),
            _ => unreachable!("a term reads a term"),
        }
    }

    /// `A ⟹ B`, grouping to the right.
    fn implication(&self, node: &'a Node) -> R<Cond> {
        match self.run(Frame::Implication(Conditions::new(node)))? {
            Val::Cond(cond) => Ok(cond),
            _ => unreachable!("an implication reads a condition"),
        }
    }

    /// Runs the reading of a construct to its value. Each construct is a
    /// frame that asks for the constructs it holds, one at a time, and the
    /// frames stand in an explicit stack, not on the call stack: a document
    /// can nest as deeply as its length allows (engine §9).
    fn run(&self, first: Frame<'a>) -> R<Val> {
        let mut stack = vec![first];
        let mut input: Option<Val> = None;
        loop {
            work::count(Work::Walked, 1);
            let top = stack.last_mut().expect("a frame");
            match self.resume(top, input.take())? {
                Step::Call(frame) => stack.push(frame),
                Step::Again => {}
                Step::Done(value) => {
                    stack.pop();
                    if stack.is_empty() {
                        return Ok(value);
                    }
                    input = Some(value);
                }
            }
        }
    }

    /// Takes a frame on, with the value of the construct it asked for last,
    /// if it asked for one, to its next request or its value.
    fn resume(&self, frame: &mut Frame<'a>, input: Option<Val>) -> R<Step<'a>> {
        match frame {
            Frame::Pattern(pattern) => self.resume_pattern(pattern, input),
            Frame::PatternAtom(node) => self.resume_pattern_atom(node, input),
            Frame::SourceCall(call) => self.resume_source_call(call, input),
            Frame::SourceArgument(argument) => self.resume_source_argument(argument, input),
            Frame::Conjunction(conjunction) => self.resume_conjunction(conjunction, input),
            Frame::Choice(choice) => self.resume_choice(choice, input),
            Frame::Primary(primary) => self.resume_primary(primary, input),
            Frame::Optional(optional) => self.resume_optional(optional, input),
            Frame::Repetition(repetition) => self.resume_repetition(repetition, input),
            Frame::Tested(tested) => self.resume_tested(tested, input),
            Frame::Term(term) => self.resume_term(term, input),
            Frame::Union(joined) => self.resume_union(joined, input),
            Frame::Intersection(joined) => self.resume_intersection(joined, input),
            Frame::Concatenation(joined) => self.resume_concatenation(joined, input),
            Frame::Atom(atom) => self.resume_atom(atom, input),
            Frame::Method(method) => self.resume_method(method, input),
            Frame::Argument(argument) => self.resume_argument(argument, input),
            Frame::Implication(conditions) => self.resume_implication(conditions, input),
            Frame::AnyOf(conditions) => self.resume_connective(conditions, input, "all-of"),
            Frame::AllOf(conditions) => self.resume_connective(conditions, input, "condition"),
            Frame::Condition(condition) => self.resume_condition(condition, input),
        }
    }

    fn resume_conjunction(&self, frame: &mut Conjunction<'a>, input: Option<Val>) -> R<Step<'a>> {
        if frame.sequences.is_none() {
            let sequences = self.some(frame.node, "sequence", 1)?;
            // The bound of an & is its own form, so it comes before its
            // items (§9).
            if sequences.len() > crate::grammar::MAX_AND {
                return Err(self.error(
                    frame.node,
                    format!("an & of {} items; at most {} are allowed", sequences.len(), crate::grammar::MAX_AND),
                ));
            }
            frame.whole = frame.whole && sequences.len() == 1;
            frame.sequences = Some(sequences);
        }
        if let Some(Val::Expr(expr)) = input {
            frame.items.push(expr);
        }
        loop {
            if let Some(primaries) = &frame.primaries {
                if let Some(&primary) = primaries.get(frame.items.len()) {
                    return Ok(Step::Call(Frame::Primary(PrimaryFrame::new(primary, frame.sequence_whole))));
                }
                frame.parts.push(single_or(std::mem::take(&mut frame.items), Expr::Seq));
                frame.primaries = None;
            }
            let sequences = frame.sequences.as_ref().expect("the sequences");
            let Some(&sequence) = sequences.get(frame.parts.len()) else {
                return Ok(Step::Done(Val::Expr(single_or(std::mem::take(&mut frame.parts), Expr::And))));
            };
            let primaries = self.some(sequence, "primary", 1)?;
            frame.sequence_whole = frame.whole && primaries.len() == 1;
            frame.primaries = Some(primaries);
        }
    }

    fn resume_choice(&self, frame: &mut Choice<'a>, input: Option<Val>) -> R<Step<'a>> {
        if frame.conjunctions.is_none() {
            if let Some(ranked) = self.rules(frame.node, "ranked-choice").next() {
                frame.node = ranked;
                frame.ranked = true;
            }
            frame.conjunctions = Some(self.some(frame.node, "conjunction", if frame.ranked { 2 } else { 1 })?);
            if frame.ranked {
                // No item capture stands inside a ranked group (§3.5, §9).
                self.ranked.set(self.ranked.get() + 1);
            }
        }
        if let Some(Val::Expr(expr)) = input {
            frame.parts.push(expr);
        }
        let conjunctions = frame.conjunctions.as_ref().expect("the conjunctions");
        match conjunctions.get(frame.parts.len()) {
            Some(&conjunction) => Ok(Step::Call(Frame::Conjunction(Conjunction::new(conjunction, false)))),
            None => Ok(Step::Done(Val::Expr(if frame.ranked {
                self.ranked.set(self.ranked.get() - 1);
                let separator =
                    self.tokens_of(frame.node).find(|token| self.value(token) == "≻").map(|token| self.first(token));
                Expr::Ranked(std::mem::take(&mut frame.parts), separator)
            } else {
                single_or(std::mem::take(&mut frame.parts), Expr::Choice)
            }))),
        }
    }

    /// `whole` is whether a chain may stand here (§9).
    fn resume_primary(&self, frame: &mut PrimaryFrame<'a>, input: Option<Val>) -> R<Step<'a>> {
        if let Some(value) = input {
            // The construct it holds, read: a capture wraps it, and a group,
            // an optional, braces and a tested symbol are it.
            let value = match value {
                Val::SourceCall(call) => Val::Expr(Expr::Source(SourceSymbol::Call(call))),
                value => value,
            };
            let value = if frame.spliced {
                if let Val::Expr(expr) = value {
                    Val::Expr(Expr::Splice(Box::new(expr)))
                } else {
                    value
                }
            } else {
                value
            };
            return Ok(Step::Done(match (frame.capture.take(), value) {
                (Some((name, node)), Val::Expr(expr)) => {
                    let target = Box::new(expr);
                    self.captures.borrow_mut().insert(target.as_ref() as *const Expr as usize, node);
                    Val::Expr(Expr::Capture(name, target))
                }
                (_, value) => value,
            }));
        }
        let node = frame.node;
        let inner = if PRIMARIES.contains(&rule_name(node)) { node } else { self.inner(node, PRIMARIES)? };
        let token = || self.token(inner);
        Ok(match rule_name(inner) {
            "reference" | "tag" | "string-terminal" | "constant-reference" | "wildcard" | "range" => {
                Step::Done(Val::Expr(self.symbol(inner)?))
            }
            "splice" => {
                let target = self.inner(inner, &["reference", "call"])?;
                let marker = self.token(inner)?;
                if self.tokens[marker.token.unwrap()].source.end != self.tokens[target.span.start].source.start {
                    return Err(self.error(inner, "a splice marker stands directly before its target"));
                }
                frame.spliced = true;
                Step::Call(Frame::Primary(PrimaryFrame::new(target, false)))
            }
            "parameter" => Step::Done(Val::Expr(Expr::Source(self.source_parameter(inner)?))),
            "call" => Step::Call(Frame::SourceCall(CallFrame::new(inner))),
            "tested" => Step::Call(Frame::Tested(Tested::new(inner))),
            "capture" => {
                // A capture stands anywhere but in a chain or an elidable
                // optional (§3.5, §9), and its own form is checked before
                // what it wraps. Inside flat braces it is an item capture.
                if self.chain.get() {
                    return Err(self.error(
                        inner,
                        "a capture cannot stand inside a chain, whose levels are constituents of its rule: a condition \
                         on $ serves each level",
                    ));
                }
                if self.item.get() && self.ranked.get() > 0 {
                    return Err(self.error(
                        inner,
                        "an item capture cannot stand inside a ranked group: name the ranked choice as a rule and \
                         capture that rule",
                    ));
                }
                if self.marked.get() > 0 && !self.allowed_marked.borrow().contains(&(inner as *const Node as usize)) {
                    return Err(self.error(
                        inner,
                        "a capture cannot stand inside an elidable optional, which elision restores as one unit",
                    ));
                }
                // Its token and its primary, then the checks of `$` and of
                // the name, then the one known part of the primary (§9).
                let capture = token()?;
                let primary = self.one(inner, "primary")?;
                if self.value(capture) == "$" {
                    return Err(self.error(capture, "$ is the whole constituent and wraps nothing"));
                }
                let name = self.value(capture).strip_prefix('$').unwrap_or("").to_string();
                if !is_capture_name(&name) {
                    return Err(self.error(capture, "a capture's name is all lower case"));
                }
                let wrapped = self.inner(primary, PRIMARIES)?;
                if rule_name(wrapped) == "tested" {
                    let base = self.test_base(wrapped)?.ok_or_else(|| self.shape_error(wrapped, "primary"))?;
                    if !matches!(
                        rule_name(base),
                        "reference"
                            | "tag"
                            | "string-terminal"
                            | "constant-reference"
                            | "wildcard"
                            | "range"
                            | "call"
                            | "parameter"
                            | "splice"
                    ) {
                        return Err(self.error(capture, "a capture wraps one symbol"));
                    }
                }
                if !matches!(
                    rule_name(wrapped),
                    "reference"
                        | "tag"
                        | "string-terminal"
                        | "constant-reference"
                        | "wildcard"
                        | "range"
                        | "call"
                        | "parameter"
                        | "tested"
                        | "splice"
                ) {
                    return Err(self.error(capture, "a capture wraps one symbol"));
                }
                frame.capture = Some((name, inner));
                Step::Call(Frame::Primary(PrimaryFrame::new(primary, false)))
            }
            "group" => Step::Call(Frame::Choice(Choice::new(self.one(inner, "choice")?))),
            "optional" => Step::Call(Frame::Optional(OptionalFrame::new(inner))),
            "repetition" => Step::Call(Frame::Repetition(Repetition::new(inner, frame.whole))),
            "empty" => Step::Done(Val::Expr(Expr::Empty)),
            other => return Err(self.unknown(node, other)),
        })
    }

    /// An optional, and with a marker `+` among its parts an
    /// elidable one (§3.8, §9). Its form is checked on the tree, where a
    /// group is still a node: one sequence, whose first primary is the
    /// terminal itself, with or without symbol tests.
    fn resume_optional(&self, frame: &mut OptionalFrame<'a>, input: Option<Val>) -> R<Step<'a>> {
        if let Some(Val::Expr(expr)) = input {
            if frame.mark != Mark::Plain {
                self.marked.set(self.marked.get() - 1);
            }
            if let Some(node) = frame.captured_node.take() {
                self.allowed_marked.borrow_mut().remove(&node);
            }
            let default = self.head_defaults.borrow_mut().remove(&frame.head);
            if frame.mark != Mark::Plain {
                self.default_head.set(frame.previous_head);
            }
            if let Some(crate::dom::DefaultValue { term: Term::Str(value), at }) = &default {
                let mut head = if let Expr::Seq(items) = &expr { &items[0] } else { &expr };
                if let Expr::Capture(_, inner) = head {
                    head = inner;
                }
                while let Expr::Tested(op, operand, inner) = head {
                    if let Term::Str(expected) = operand {
                        if (value == expected) != (op == "=") {
                            let (line, column) = at.unwrap();
                            return Err(Error::grammar("a default fails its head test").at(line, column));
                        }
                    }
                    head = inner;
                }
            }
            return Ok(Step::Done(Val::Expr(Expr::Optional(Box::new(expr), frame.mark, default))));
        }
        let node = frame.node;
        if let Some(capture) = self.rules(node, "capture").next() {
            let markers: Vec<_> =
                self.tokens_of(node).chain(self.tokens_of(capture)).filter(|t| self.value(t) == "+").collect();
            if markers.len() > 1 {
                return Err(self.error(markers[1], "an optional has one marker + at most"));
            }
            if markers.is_empty() || self.rules(node, "choice").next().is_some() {
                return Err(self.error(node, "a captured elidable optional holds only its terminator"));
            }
            let head = self.inner(self.one(capture, "primary")?, PRIMARIES)?;
            let base = if rule_name(head) == "tested" {
                self.test_base(head)?
                    .ok_or_else(|| self.error(node, "a captured elidable optional holds only its terminator"))?
            } else {
                head
            };
            if rule_name(base) != "parameter"
                && !(matches!(rule_name(base), "tag" | "reference")
                    && self.tokens_of(base).next().is_some_and(|t| is_capital(self.value(t))))
            {
                return Err(self.error(node, "a captured elidable optional holds only its terminator"));
            }
            frame.head = head as *const Node as usize;
            frame.previous_head = self.default_head.replace(frame.head);
            frame.mark = Mark::Elidable;
            let key = capture as *const Node as usize;
            frame.captured_node = Some(key);
            self.allowed_marked.borrow_mut().insert(key);
            self.marked.set(self.marked.get() + 1);
            return Ok(Step::Call(Frame::Primary(PrimaryFrame::new(capture, false))));
        }
        // Its required part first, then its markers (§9).
        let choice = self.one(node, "choice")?;
        let markers: Vec<&Node> = self.tokens_of(node).filter(|token| self.value(token) == "+").collect();
        if let Some(second) = markers.get(1) {
            return Err(self.error(second, "an optional has one marker + at most"));
        }
        let Some(_) = markers.first() else {
            return Ok(Step::Call(Frame::Choice(Choice::new(choice))));
        };
        let form = || {
            self.error(
                node,
                "an elidable optional begins with a user tag or parameter directly after +, without | or &",
            )
        };
        // One conjunction of one sequence, with no leading | or & either:
        // the terminator stands directly after the marker (§9).
        let conjunctions: Vec<&Node> = self.rules(choice, "conjunction").collect();
        let leading = self.tokens_of(choice).any(|token| self.value(token) == "|")
            || (conjunctions.len() == 1 && self.tokens_of(conjunctions[0]).any(|token| self.value(token) == "&"));
        let sequences: Vec<&Node> = if conjunctions.len() == 1 && !leading {
            self.rules(conjunctions[0], "sequence").collect()
        } else {
            Vec::new()
        };
        let primary = match sequences[..] {
            [sequence] => self.rules(sequence, "primary").next(),
            _ => None,
        };
        let Some(primary) = primary else {
            return Err(form());
        };
        let head = self.inner(primary, PRIMARIES)?;
        let is_terminal = |symbol: &'a Node| {
            rule_name(symbol) == "parameter"
                || rule_name(symbol) == "tag"
                    && self.tokens_of(symbol).next().is_some_and(|token| is_capital(self.value(token)))
                || (rule_name(symbol) == "reference"
                    && self.tokens_of(symbol).next().is_some_and(|token| is_capital(self.value(token))))
        };
        if rule_name(head) == "tested" {
            let base = self.test_base(head)?;
            if !base.is_some_and(is_terminal) {
                return Err(form());
            }
        } else if !is_terminal(head) {
            return Err(form());
        }
        frame.head = head as *const Node as usize;
        frame.previous_head = self.default_head.replace(frame.head);
        self.marked.set(self.marked.get() + 1);
        frame.mark = Mark::Elidable;
        Ok(Step::Call(Frame::Choice(Choice::new(choice))))
    }

    /// Braces: the item, its separator if a `/` has one, and a
    /// chain's direction from its marker, a `...` among the parts (§9).
    /// `whole` is whether the braces are their alternative's whole
    /// expression.
    fn resume_repetition(&self, frame: &mut Repetition<'a>, input: Option<Val>) -> R<Step<'a>> {
        if let Some(Val::Expr(expr)) = input {
            if frame.item.is_none() {
                frame.item = Some(expr);
                if let Some(&separator) = frame.choices.get(1) {
                    return Ok(Step::Call(Frame::Choice(Choice::new(separator))));
                }
            } else {
                frame.separator = Some(expr);
            }
            let (chain, item, ranked) = frame.outer;
            self.chain.set(chain);
            self.item.set(item);
            self.ranked.set(ranked);
            let item = frame.item.take().expect("the item");
            let separator = frame.separator.take().map(Box::new);
            return Ok(Step::Done(Val::Expr(Expr::Repeat(Box::new(item), separator, frame.chain))));
        }
        let node = frame.node;
        let found = self.parts(node);
        let choices = self.some(node, "choice", 1)?;
        let place = |part: &Node| found.iter().position(|other| std::ptr::eq(*other, part)).unwrap_or(found.len());
        let markers: Vec<usize> = (0..found.len())
            .filter(|&index| found[index].kind == NodeKind::Token && self.value(found[index]) == "...")
            .collect();
        // Repeated markers fail before separator placement is inspected.
        // A sole marker after the separator fails at that marker (engine §9).
        if let Some(&second) = markers.get(1) {
            return Err(self.error(found[second], "braces have one chain marker ... at most"));
        }
        let separator_at = choices.get(1).map_or(found.len(), |separator| place(separator));
        if let Some(&marker) = markers.first().filter(|&&marker| marker > separator_at) {
            return Err(
                self.error(found[marker], "a separator has no chain marker: ... stands after { or after the item")
            );
        }
        let chain = markers.first().map(|&marker| if marker < place(choices[0]) { Chain::Left } else { Chain::Right });
        // A chain is the whole expression of its alternative, as the
        // lowering of its levels needs (§3.3, §9).
        if chain.is_some() && !frame.whole {
            return Err(self
                .error(node, "a chain is the whole expression of its alternative: name it as a rule to use it here"));
        }
        // The innermost braces decide whether a capture can stand inside
        // them (§3.5, §9).
        frame.outer = (self.chain.replace(chain.is_some()), self.item.replace(chain.is_none()), self.ranked.replace(0));
        frame.chain = chain;
        let item = choices[0];
        frame.choices = choices;
        Ok(Step::Call(Frame::Choice(Choice::new(item))))
    }

    /// The primary wrapper or first unwrapped base, excluding tested nodes.
    fn test_base(&self, node: &'a Node) -> R<Option<&'a Node>> {
        if let Some(primary) = self.rules(node, "primary").next() {
            return self.inner(primary, PRIMARIES).map(Some);
        }
        Ok(self
            .parts(node)
            .into_iter()
            .find(|part| rule_name(part) != "tested" && PRIMARIES.contains(&rule_name(part))))
    }

    /// A reference, terminal, range or property, and one test on its own
    /// span (engine §2, §9). The syntax grammar reads a test after any
    /// primary, so that the reader can name the reason.
    fn resume_tested(&self, frame: &mut Tested<'a>, input: Option<Val>) -> R<Step<'a>> {
        let node = frame.node;
        let (mut expr, tests) = if let Some(Val::Expr(expr)) = input {
            (expr, frame.tests.take().unwrap())
        } else if let Some(Val::SourceCall(call)) = input {
            (Expr::Source(SourceSymbol::Call(call)), frame.tests.take().unwrap())
        } else {
            let parts = self.parts(node);
            let tests: Vec<_> = parts
                .iter()
                .copied()
                .filter(|part| matches!(rule_name(part), "tag-test" | "value-test" | "default-value"))
                .collect();
            if tests.is_empty() {
                return Err(self.shape_error(node, "test"));
            }
            let base = self.test_base(node)?.ok_or_else(|| self.shape_error(node, "primary"))?;
            let valid = matches!(
                rule_name(base),
                "reference"
                    | "tag"
                    | "string-terminal"
                    | "constant-reference"
                    | "wildcard"
                    | "range"
                    | "call"
                    | "parameter"
                    | "splice"
            );
            let mut tags = false;
            let mut value = false;
            for test in &tests {
                if rule_name(test) == "default-value" {
                    continue;
                }
                let tag = rule_name(test) == "tag-test";
                if !valid || value || tag && tags {
                    return Err(self.error(test, "invalid test target or order"));
                }
                if tag {
                    tags = true;
                } else {
                    value = true;
                }
            }
            if rule_name(base) == "call" {
                frame.tests = Some(tests);
                return Ok(Step::Call(Frame::SourceCall(CallFrame::new(base))));
            }
            if rule_name(base) == "splice" {
                frame.tests = Some(tests);
                return Ok(Step::Call(Frame::Primary(PrimaryFrame::new(base, false))));
            }
            (self.symbol(base)?, tests)
        };
        for test in tests {
            if rule_name(test) == "default-value" {
                let key = node as *const Node as usize;
                if key != self.default_head.get() {
                    return Err(self.error(test, "a default stands only on an elidable optional head"));
                }
                if self.head_defaults.borrow().contains_key(&key) {
                    return Err(self.error(test, "an elidable head has one default at most"));
                }
                let operand = self.one(test, "test-operand")?;
                let term = self.value_test_operand(operand)?;
                self.head_defaults
                    .borrow_mut()
                    .insert(key, crate::dom::DefaultValue { term, at: Some(self.first(test)) });
                continue;
            }
            let (op, operand) = if rule_name(test) == "tag-test" {
                ("tags".into(), self.source_requirements(test, "a tag requirement requires a tag or tag-set constant")?)
            } else {
                let comparator = self.operator(self.token(self.one(test, "test")?)?).to_string();
                let operand = self.one(test, "test-operand")?;
                (comparator, self.value_test_operand(operand)?)
            };
            expr = Expr::Tested(op, operand, Box::new(expr));
        }
        Ok(Step::Done(Val::Expr(expr)))
    }

    /// A `term`: its union, or its guarded term: `if` of each of its
    /// any-ofs, in turn, around its union, or around the term of a notation
    /// that writes one after `⟹` (§9). `argument` is whether a span may
    /// stand here.
    fn resume_term(&self, frame: &mut TermFrame<'a>, input: Option<Val>) -> R<Step<'a>> {
        if frame.guards.is_none() {
            let inner =
                if TERMS.contains(&rule_name(frame.node)) { frame.node } else { self.inner(frame.node, &TERMS)? };
            if rule_name(inner) != "guarded-term" {
                frame.guards = Some(Vec::new());
                frame.pass = true;
                return Ok(Step::Call(Frame::Union(Joined::new(inner, frame.argument))));
            }
            if let Some(closed) = self.closed_for.get() {
                return Err(self.error(inner, format!("{closed} is a closed term, and holds no guarded term")));
            }
            let guards = self.some(inner, "any-of", 1)?;
            let first = guards[0];
            frame.inner = Some(inner);
            frame.guards = Some(guards);
            return Ok(Step::Call(Frame::AnyOf(Conditions::new(first))));
        }
        if frame.pass {
            return Ok(Step::Done(input.expect("the union")));
        }
        let guards = frame.guards.as_ref().expect("the guards");
        let count = guards.len();
        let last = guards[count - 1];
        match input {
            Some(Val::Cond(cond)) => {
                let next = guards.get(count.min(frame.conds.len() + 1)).copied();
                frame.conds.push(cond);
                if let Some(guard) = next {
                    return Ok(Step::Call(Frame::AnyOf(Conditions::new(guard))));
                }
                let inner = frame.inner.expect("the guarded term");
                // The term guarded last: a union, or a term of a notation
                // that writes one.
                Ok(Step::Call(match self.rules(inner, "union").next() {
                    Some(union) => Frame::Union(Joined::new(union, false)),
                    None => Frame::Term(TermFrame::new(self.one(inner, "term")?, false)),
                }))
            }
            Some(Val::Term(term, ty)) => {
                // The reader has checked each comparison of a condition, so
                // a condition's terms agree; the term guarded last must be a
                // tag set, an error at its guard.
                let kind = if self.feature_context.get() {
                    Type::Any
                } else {
                    let kind = crate::dom::joined_type(&[ty], "⟹").map_err(|p| self.error(last, p))?;
                    if kind == Type::Pattern {
                        return Err(self.error(last, "a guarded term requires a set"));
                    }
                    kind
                };
                let mut guarded = term;
                while let Some(cond) = frame.conds.pop() {
                    guarded = Term::If(Box::new(cond), Box::new(guarded));
                }
                Ok(Step::Done(Val::Term(guarded, kind)))
            }
            _ => unreachable!("a guarded term reads conditions and a term"),
        }
    }

    /// Parts joined by `∪` and `∖`, which group from the left: a run joined
    /// by `∪` is one union, and each `∖` takes what stands before it (§9).
    fn resume_union(&self, frame: &mut Joined<'a>, input: Option<Val>) -> R<Step<'a>> {
        if frame.parts.is_none() {
            let parts: Vec<&Node> = self.rules(frame.node, "intersection").collect();
            match parts[..] {
                [] => return Err(self.shape_error(frame.node, "intersection")),
                [part] => {
                    frame.parts = Some(Vec::new());
                    frame.pass = true;
                    return Ok(Step::Call(Frame::Intersection(Joined::new(part, frame.argument))));
                }
                _ => {}
            }
            frame.parts = Some(parts);
        }
        if frame.pass {
            return Ok(Step::Done(input.expect("the intersection")));
        }
        if let Some(Val::Term(term, ty)) = input {
            frame.items.push(term);
            frame.types.push(ty);
        }
        let parts = frame.parts.as_ref().expect("the parts");
        if let Some(&part) = parts.get(frame.items.len()) {
            return Ok(Step::Call(Frame::Intersection(Joined::new(part, false))));
        }
        let mut operators: Vec<&str> = self
            .tokens_of(frame.node)
            .map(|token| self.value(token))
            .filter(|text| matches!(*text, "∪" | "∖"))
            .collect();
        // A leading ∪ is a separator, not an operator.
        operators.drain(..operators.len().saturating_sub(parts.len() - 1));
        if operators.len() < parts.len() - 1 {
            return Err(self.shape_error(frame.node, "operator"));
        }
        let operator = if operators.contains(&"∖") { "∖" } else { "∪" };
        let ty = if self.feature_context.get() {
            Type::Any
        } else {
            joined_type(&frame.types, operator).map_err(|problem| self.error(frame.node, problem))?
        };
        let mut items = std::mem::take(&mut frame.items).into_iter();
        let Some(mut result) = items.next() else {
            return Err(self.shape_error(frame.node, "part"));
        };
        let mut open = false;
        for (operator, next) in operators.into_iter().zip(items) {
            if operator == "∖" {
                result = Term::Difference(Box::new(result), Box::new(next));
                open = false;
            } else if let (true, Term::Union(parts)) = (open, &mut result) {
                parts.push(next);
            } else {
                result = Term::Union(vec![result, next]);
                open = true;
            }
        }
        Ok(Step::Done(Val::Term(result, ty)))
    }

    fn resume_intersection(&self, frame: &mut Joined<'a>, input: Option<Val>) -> R<Step<'a>> {
        if frame.parts.is_none() {
            let atoms: Vec<&Node> = self.rules(frame.node, "concatenation").collect();
            match atoms[..] {
                [] => return Err(self.shape_error(frame.node, "concatenation")),
                [atom] => {
                    frame.parts = Some(Vec::new());
                    frame.pass = true;
                    return Ok(Step::Call(Frame::Concatenation(Joined::new(atom, frame.argument))));
                }
                _ => {}
            }
            frame.parts = Some(atoms);
        }
        if frame.pass {
            return Ok(Step::Done(input.expect("the atom")));
        }
        if let Some(Val::Term(term, ty)) = input {
            frame.items.push(term);
            frame.types.push(ty);
        }
        let atoms = frame.parts.as_ref().expect("the atoms");
        if let Some(&atom) = atoms.get(frame.items.len()) {
            return Ok(Step::Call(Frame::Concatenation(Joined::new(atom, false))));
        }
        let ty = if self.feature_context.get() {
            Type::Any
        } else {
            joined_type(&frame.types, "∩").map_err(|problem| self.error(frame.node, problem))?
        };
        Ok(Step::Done(Val::Term(Term::Intersection(std::mem::take(&mut frame.items)), ty)))
    }

    fn resume_concatenation(&self, frame: &mut Joined<'a>, input: Option<Val>) -> R<Step<'a>> {
        if frame.parts.is_none() {
            let atoms: Vec<&Node> = self.rules(frame.node, "term-atom").collect();
            match atoms[..] {
                [] => return Err(self.shape_error(frame.node, "term-atom")),
                [atom] => {
                    frame.parts = Some(Vec::new());
                    frame.pass = true;
                    return Ok(Step::Call(Frame::Atom(Atom::new(atom, frame.argument))));
                }
                _ => {}
            }
            frame.parts = Some(atoms);
        }
        if frame.pass {
            return Ok(Step::Done(input.expect("the atom")));
        }
        if let Some(Val::Term(term, ty)) = input {
            frame.items.push(term);
            frame.types.push(ty);
            if !matches!(ty, Type::String | Type::Any) && !self.feature_context.get() {
                return Err(self.error(frame.node, "++ requires string operands"));
            }
        }
        let atoms = frame.parts.as_ref().expect("the atoms");
        if let Some(&atom) = atoms.get(frame.items.len()) {
            return Ok(Step::Call(Frame::Atom(Atom::new(atom, false))));
        }
        let args = std::mem::take(&mut frame.items).into_iter().map(Arg::Term).collect();
        Ok(Step::Done(Val::Term(Term::Call("concat".into(), args), Type::String)))
    }

    fn resume_atom(&self, frame: &mut Atom<'a>, input: Option<Val>) -> R<Step<'a>> {
        if let Some(value) = input {
            // A call, which is no span where a value is due, or a term in
            // parentheses, which is its term.
            return Ok(Step::Done(match value {
                Val::Pattern(value) => {
                    self.closed_for.set(frame.pattern_closed.take().unwrap());
                    let mut pattern = value.pattern(self, frame.node)?;
                    if let Some(problem) = patterns::source_pattern_problem(&pattern) {
                        pattern.clear();
                        return Err(self.error(frame.node, problem));
                    }
                    Val::Term(Term::Pattern(Box::new(pattern)), Type::Pattern)
                }
                Val::SourceCall(call) => Val::Term(Term::Source(SourceSymbol::Call(call)), Type::Any),
                value => value,
            }));
        }
        let node = frame.node;
        let inner = if ATOMS.contains(&rule_name(node))
            && !matches!(rule_name(node), "term" | "guarded-term" | "union" | "term-atom")
        {
            node
        } else {
            self.inner(node, ATOMS)?
        };
        let token = || self.token(inner);
        let typed = |term: Term, ty: Type| Ok(Step::Done(Val::Term(term, ty)));
        match rule_name(inner) {
            // A span may stand in parentheses where a span is due.
            "term" | "guarded-term" => Ok(Step::Call(Frame::Term(TermFrame::new(inner, frame.argument)))),
            "union" => Ok(Step::Call(Frame::Union(Joined::new(inner, frame.argument)))),
            "term-atom" => Ok(Step::Call(Frame::Atom(Atom::new(inner, frame.argument)))),
            "parameter" => typed(Term::Source(self.source_parameter(inner)?), Type::Any),
            "call" => Ok(Step::Call(Frame::SourceCall(CallFrame::new(inner)))),
            "string" => typed(self.string_term(token()?)?, Type::String),
            "tag" => {
                let token = token()?;
                let tag = self.term_tag(token)?;
                typed(Term::Tag(tag), Type::Tags)
            }
            "tag-run" | "string-run" => {
                if self.in_recipe.get() && inner.rule.as_deref() == Some("string-run") {
                    return Err(self.error(inner, "juxtaposed recipe strings require ++, use ++ between string atoms"));
                }
                let before = node.span.start.checked_sub(1).and_then(|i| self.tokens.get(i));
                let after = self.tokens.get(node.span.end);
                if before.into_iter().chain(after).any(|t| matches!(t.value.as_str(), "∩" | "∖")) {
                    let kind = if rule_name(inner) == "string-run" { "string" } else { "tag" };
                    return Err(self
                        .error(inner, format!("a {kind} run beside intersection or difference requires parentheses")));
                }
                let mut items = Vec::new();
                let strings = inner.rule.as_deref() == Some("string-run");
                for tag in self.some(inner, if strings { "string" } else { "tag" }, 2)? {
                    items.push(if strings {
                        self.string_term(self.token(tag)?)?
                    } else {
                        Term::Tag(self.term_tag(self.token(tag)?)?)
                    })
                }
                typed(Term::Union(items), if strings { Type::Strings } else { Type::Tags })
            }
            "range" => Err(self.error(inner, "a range is a terminal, not a value term")),
            // A bare name is a tag literal if it begins with a capital, and
            // otherwise a rule, which only a function's argument names.
            "name" => {
                let name = self.value(token()?);
                if !is_capital(name) {
                    return Err(self.error(inner, format!("{name} names a rule, which is not a value")));
                }
                typed(Term::Tag(name.to_string()), Type::Tags)
            }
            "empty-set" => typed(Term::EmptySet, Type::Set),
            // The reader knows no constant's type (§9).
            "constant-reference" => {
                let term = self.constant_reference(token()?)?;
                let ty = Type::Any;
                typed(term, ty)
            }
            "capture-reference" => {
                let name = self.value(token()?).strip_prefix('$').unwrap_or("").to_string();
                if let Some(closed) = self.closed_for.get() {
                    return Err(self.error(inner, format!("{closed} is a closed term, and holds no capture")));
                }
                typed(Term::Capture(name), Type::Span)
            }
            "method" => Ok(Step::Call(Frame::Method(MethodFrame::new(inner, false)))),
            "pattern-literal" => {
                frame.pattern_closed = Some(self.closed_for.replace(None));
                Ok(Step::Call(Frame::Pattern(self.pattern_frame(self.one(inner, "pattern-primary")?))))
            }
            other => Err(self.unknown(node, other)),
        }
    }

    fn pattern_rule_name(node: &Node) -> bool {
        matches!(rule_name(node), "name" | "reference")
            || node.kind == NodeKind::Token && matches!(node.terminal.as_deref(), Some("Emoji-Name" | "Lowercase-Name"))
    }

    /// Constructor parts determine the base, independently of delimiters.
    fn pattern_atom_base(&self, node: &'a Node) -> R<&'a Node> {
        self.parts(node)
            .into_iter()
            .find(|part| {
                matches!(
                    rule_name(part),
                    "name"
                        | "reference"
                        | "tag"
                        | "string"
                        | "string-terminal"
                        | "wildcard"
                        | "range"
                        | "constant-reference"
                        | "parameter"
                        | "call"
                        | "tag-test"
                ) || part.kind == NodeKind::Token
                    && (matches!(part.terminal.as_deref(), Some("Emoji-Name" | "Lowercase-Name"))
                        || self.unicode.is_emoji_name(self.value(part))
                        || self.value(part).starts_with('_')
                        || self.value(part).as_bytes().first().is_some_and(u8::is_ascii_alphabetic))
            })
            .ok_or_else(|| self.shape_error(node, "pattern atom"))
    }

    fn pattern_atom(&self, node: &'a Node, call: Option<SourceCall>) -> R<crate::patterns::Pattern> {
        use crate::patterns::Pattern as P;
        let first = self.pattern_atom_base(node)?;
        self.pattern_test_nodes(node, true)?;
        let (pattern, tested) = match rule_name(first) {
            "parameter" => (P::Source(self.source_parameter(first)?), true),
            "call" => (P::Source(SourceSymbol::Call(call.expect("a pattern call reads its arguments first"))), true),
            "tag-test" => return Err(self.error(first, "a pattern requires an atom before its tag test")),
            "tag" => (P::Terminal(self.tag_of(self.token(first)?)?, self.first(first)), true),
            "string" => (P::Literal(self.string_term(self.token(first)?)?, self.first(first)), true),
            "string-terminal" => {
                let symbol = self.symbol(first)?;
                let Expr::Literal(term) = &symbol else { unreachable!() };
                let pattern = match term {
                    Term::Const(name, _) => P::Constant(name.clone(), self.first(first)),
                    _ => P::Literal(term.clone(), self.first(first)),
                };
                (pattern, true)
            }
            "wildcard" => {
                self.token(first)?;
                (P::Wildcard(self.first(first)), true)
            }
            "range" => {
                let symbol = self.symbol(first)?;
                let Expr::ScalarRange(a, b) = &symbol else { unreachable!() };
                (P::Range(a.clone(), b.clone(), self.first(first)), true)
            }
            "constant-reference" => {
                let token = self.token(first)?;
                self.constant_reference(token)?;
                (P::Constant(self.value(token)[1..].into(), self.at(token)), true)
            }
            _ if first.kind == NodeKind::Token || matches!(rule_name(first), "name" | "reference") => {
                let token = if first.kind == NodeKind::Token { first } else { self.token(first)? };
                let name = self.value(token);
                if !Self::pattern_rule_name(first) && (is_capital(name) || name.starts_with('_')) {
                    (P::Terminal(self.tag_of(token)?, self.at(token)), true)
                } else {
                    if !(self.unicode.is_emoji_name(name)
                        || name.starts_with(|c: char| c.is_ascii_lowercase()) && crate::tags::is_name(name))
                    {
                        return Err(self.error(token, "a malformed pattern rule name"));
                    }
                    (P::Name(name.into(), self.at(token)), true)
                }
            }
            _ => return Err(self.shape_error(node, "pattern atom")),
        };
        self.pattern_tests(node, pattern, tested)
    }

    /// Inspect the target and complete test sequence before any base conversion.
    fn pattern_test_nodes(&self, node: &'a Node, testable: bool) -> R<Vec<&'a Node>> {
        if let Some(default) = self.parts(node).into_iter().find(|p| rule_name(p) == "default-value") {
            return Err(self.error(default, "a default stands only on an elidable optional head"));
        }
        let tests: Vec<_> =
            self.parts(node).into_iter().filter(|part| matches!(rule_name(part), "tag-test" | "value-test")).collect();
        let mut tags = false;
        let mut value = false;
        for test in &tests {
            let tag = rule_name(test) == "tag-test";
            if (!testable && !tag) || value || tag && tags {
                return Err(self.error(test, "invalid pattern test target or order"));
            }
            if tag {
                tags = true;
            } else {
                value = true;
            }
        }
        Ok(tests)
    }

    fn pattern_tests(
        &self,
        node: &'a Node,
        mut pattern: crate::patterns::Pattern,
        testable: bool,
    ) -> R<crate::patterns::Pattern> {
        let tests = self.pattern_test_nodes(node, testable)?;
        for test in tests {
            if matches!(
                &pattern,
                crate::patterns::Pattern::Name(..) | crate::patterns::Pattern::Source(SourceSymbol::Call(_))
            ) && rule_name(test) == "tag-test"
            {
                for requirement in self.rules(test, "tag-requirement") {
                    let part = self.inner(self.one(requirement, "test-operand")?, ATOMS)?;
                    if rule_name(part) == "tag"
                        && self.value(self.token(part)?) == "_Elided"
                        && !self.tokens_of(requirement).any(|t| self.value(t) == "¬")
                    {
                        return Err(self.error(self.token(part)?, "a rule pattern cannot require _Elided"));
                    }
                }
            }
            let (op, operand) = if rule_name(test) == "tag-test" {
                ("tags".into(), self.pattern_requirements(test)?)
            } else {
                let op = self.operator(self.token(self.one(test, "test")?)?).into();
                let operand = self.one(test, "test-operand")?;
                (op, self.value_test_operand(operand)?)
            };
            let mark_at = if rule_name(test) == "tag-test" {
                self.rules(test, "tag-requirement").find_map(|requirement| {
                    let part = self.inner(self.one(requirement, "test-operand").ok()?, ATOMS).ok()?;
                    (rule_name(part) == "tag"
                        && self.value(self.token(part).ok()?) == "_Elided"
                        && !self.tokens_of(requirement).any(|t| self.value(t) == "¬"))
                    .then(|| self.at(part))
                })
            } else {
                None
            };
            pattern = crate::patterns::Pattern::Test(op, operand, Box::new(pattern), mark_at);
        }
        Ok(pattern)
    }

    fn source_unresolved(&self, root: &'a Node) -> bool {
        let mut pending = vec![(root, false)];
        while let Some((node, complete)) = pending.pop() {
            let key = node as *const Node as usize;
            if self.unresolved_nodes.borrow().contains_key(&key) {
                continue;
            }
            if complete {
                let dependent = self
                    .parts(node)
                    .iter()
                    .any(|child| self.unresolved_nodes.borrow()[&(*child as *const Node as usize)]);
                self.unresolved_nodes.borrow_mut().insert(key, dependent);
            } else {
                work::count(Work::Walked, 1);
                if matches!(rule_name(node), "parameter" | "call") {
                    self.unresolved_nodes.borrow_mut().insert(key, true);
                    continue;
                }
                pending.push((node, true));
                pending.extend(
                    self.parts(node)
                        .into_iter()
                        .filter(|child| !self.unresolved_nodes.borrow().contains_key(&(*child as *const Node as usize)))
                        .map(|child| (child, false)),
                );
            }
        }
        self.unresolved_nodes.borrow()[&(root as *const Node as usize)]
    }

    fn resume_method(&self, frame: &mut MethodFrame<'a>, input: Option<Val>) -> R<Step<'a>> {
        if frame.receiver.is_none() && input.is_none() {
            let receiver = self.one(frame.node, "method-receiver")?;
            let atom = self.one(receiver, "term-atom")?;
            frame.dependent = self.source_unresolved(atom);
            return Ok(Step::Call(Frame::Atom(Atom::new(atom, true))));
        }
        if let Some(value) = input {
            match value {
                Val::Term(term, ty) => frame.receiver = Some((term, ty)),
                Val::Arg(arg, ty) => {
                    frame.args.push(arg);
                    frame.types.push(ty);
                }
                _ => unreachable!("a method reads a receiver or an argument"),
            }
        }
        if frame.selectors.is_none() {
            frame.selectors = Some(self.some(frame.node, "method-selector", 1)?);
        }
        let selectors = frame.selectors.as_ref().unwrap();
        let selector = selectors[frame.index];
        let name = self.value(self.token(self.one(selector, "method-name")?)?);
        let method = known_method(name).ok_or_else(|| self.error(frame.node, format!("unknown method {name}")))?;
        if frame.arguments.is_none() {
            if let Some(closed) = self.closed_for.get().filter(|_| name != "split" && name != "ngrams") {
                return Err(self.error(frame.node, format!("{closed} cannot read an input method")));
            }
            frame.arguments = Some(match self.rules(selector, "arguments").next() {
                Some(arguments) => self.some(arguments, "argument", 1)?,
                None => Vec::new(),
            });
        }
        if let Some(&argument) = frame.arguments.as_ref().unwrap().get(frame.args.len()) {
            return Ok(Step::Call(Frame::Argument(ArgumentFrame { node: argument })));
        }
        if let Some(arguments) = self.rules(selector, "arguments").next() {
            let expected =
                if matches!(name, "matches" | "begins" | "ends" | "followed-by" | "preceded-by") { "|" } else { "," };
            if self.parts(arguments).iter().any(|part| part.kind == NodeKind::Token && self.value(part) != expected) {
                return Err(self.error(arguments, "invalid method argument separator"));
            }
        }
        let argument_unresolved = frame.arguments.as_ref().unwrap().iter().any(|node| self.source_unresolved(node));
        if matches!(name, "classify" | "ngrams") && argument_unresolved {
            return Err(self.error(frame.node, "a parameter cannot replace a classifier name or integer argument"));
        }
        frame.dependent |= argument_unresolved;
        let (receiver, ty) = frame.receiver.take().unwrap();
        let unresolved = matches!(&receiver, Term::Source(_));
        let span = self.feature_context.get() || !frame.receiver_query && (unresolved || ty == Type::Span);
        let string =
            self.feature_context.get() || !frame.receiver_query && matches!(ty, Type::Span | Type::String | Type::Any);
        let bare = self.feature_context.get() || matches!(&receiver, Term::Capture(_) | Term::Source(_));
        let arguments = &frame.args[..];
        let emitted_receiver = matches!(&receiver, Term::Call(name, _) if name == "emitted");
        let valid = if emitted_receiver {
            matches!((name, arguments), ("value" | "image", []))
        } else {
            match (method, arguments) {
                (MethodKind::Span | MethodKind::Tags, []) => span,
                (MethodKind::Restored, []) if name == "without-elision" => bare,
                (MethodKind::Recipe, []) => bare,
                (MethodKind::Tags, [Arg::Rule(_) | Arg::Term(Term::Source(_))]) => span,
                (MethodKind::Query, args) => {
                    span && (name != "ends" || !crate::dom::restored_span(&receiver))
                        && !args.is_empty()
                        && args.iter().all(|a| {
                            matches!(a, Arg::Rule(_) | Arg::Term(Term::Source(_)))
                                || matches!(a,Arg::Term(Term::Tag(n)) if is_capital(n))
                        })
                }
                (MethodKind::Ngrams, [Arg::Integer(n)]) => string && crate::dom::valid_integer(n),
                (MethodKind::Restored, [Arg::Rule(_) | Arg::Term(Term::Source(_))])
                    if name == "without-elision-except" =>
                {
                    bare
                }
                (MethodKind::Boundary, args) => {
                    bare && !args.is_empty()
                        && args.iter().all(|arg| {
                            matches!(arg, Arg::Rule(_) | Arg::Term(Term::Source(_)))
                                || matches!(arg, Arg::Term(Term::Tag(name)) if is_capital(name))
                        })
                }
                (MethodKind::Split, [Arg::Term(_)]) => {
                    string
                        && (self.feature_context.get()
                            || matches!(frame.types.first(), Some(Some(Type::String | Type::Span | Type::Any))))
                }
                (MethodKind::Classify, [Arg::Rule(classifier)]) => string && is_classifier_name(classifier),
                _ => false,
            }
        };
        if name == "ends" && crate::dom::restored_span(&receiver) {
            return Err(self.error(frame.node, "ends requires an ordinary span, not a restored span"));
        }
        if !valid {
            let problem = match name {
                _ if self.feature_context.get() || frame.dependent => "a method has the wrong receiver or arguments",
                "without-elision" => "without-elision requires a bare capture: write $x.without-elision.onward",
                "without-elision-except" if !bare => {
                    "without-elision-except requires a bare capture: write $x.without-elision-except(family).onward"
                }
                "without-elision-except" => "without-elision-except requires one rule name",
                _ => "a method has the wrong receiver or arguments",
            };
            return Err(self.error(frame.node, problem));
        }
        if !self.in_recipe.get() && matches!(name, "verbatim-text" | "emitted") {
            return Err(self.error(frame.node, "a method has the wrong receiver or arguments"));
        }
        let mut args = vec![Arg::Term(receiver)];
        args.append(&mut frame.args);
        if let ("classify", [_, Arg::Rule(name)]) = (name, &mut args[..]) {
            let name = std::mem::take(name);
            args[1] = Arg::Classifier(name);
        }
        if let Some(problem) = literal_call_problem(name, &args).filter(|_| !self.feature_context.get()) {
            return Err(self.error(frame.node, problem));
        }
        let last = frame.index + 1 == selectors.len();
        let query = matches!(
            name,
            "starts-input" | "ends-input" | "followed-by" | "preceded-by" | "matches" | "begins" | "ends"
        );
        let value = if query && !last {
            Val::Term(Term::Call(name.into(), args), Type::Any)
        } else if query {
            if !frame.condition {
                return Err(self.error(frame.node, "a query method is a condition, not a term"));
            }
            if args.iter().any(|arg| matches!(arg, Arg::Term(Term::Source(_)))) {
                return Ok(Step::Done(Val::Cond(Cond::SourceQuery(
                    name.into(),
                    args,
                    crate::dom::BoundaryLocation {
                        at: Some(self.first(frame.node)),
                        targets: frame.arguments.as_ref().unwrap().iter().map(|n| self.first(n)).collect(),
                    },
                ))));
            }
            let mut args = args.into_iter();
            let Some(Arg::Term(receiver)) = args.next() else { unreachable!() };
            Val::Cond(match name {
                "starts-input" => Cond::Initial(receiver),
                "ends-input" => Cond::Final(receiver),
                "followed-by" | "preceded-by" => Cond::Boundary(
                    name == "followed-by",
                    receiver,
                    args.map(|arg| match &arg {
                        Arg::Rule(name) | Arg::Term(Term::Tag(name)) => name.clone(),
                        _ => unreachable!(),
                    })
                    .collect(),
                    crate::dom::BoundaryLocation {
                        at: Some(self.first(frame.node)),
                        targets: frame.arguments.as_ref().unwrap().iter().map(|n| self.first(n)).collect(),
                    }
                    .into(),
                ),
                _ => {
                    let targets = args
                        .map(|a| match &a {
                            Arg::Rule(n) | Arg::Term(Term::Tag(n)) => n.clone(),
                            _ => unreachable!(),
                        })
                        .collect();
                    if name == "matches" {
                        Cond::Matches(receiver, targets)
                    } else if name == "ends" {
                        Cond::Ends(receiver, targets)
                    } else {
                        Cond::Begins(receiver, targets)
                    }
                }
            })
        } else {
            if last && frame.condition {
                return Err(self.error(frame.node, "a condition requires a query method"));
            }
            Val::Term(Term::Call(name.into(), args), call_type(name))
        };
        if last {
            return Ok(Step::Done(value));
        }
        let Val::Term(term, ty) = value else { unreachable!() };
        frame.receiver = Some((term, ty));
        frame.receiver_query = query;
        frame.index += 1;
        frame.arguments = None;
        frame.types.clear();
        Ok(Step::Again)
    }

    /// A function's argument: a rule, where it is a bare name without a
    /// capital, alone and perhaps in parentheses, or else a term where a
    /// span may stand.
    fn resume_argument(&self, frame: &mut ArgumentFrame<'a>, input: Option<Val>) -> R<Step<'a>> {
        if let Some(Val::Term(term, ty)) = input {
            return Ok(Step::Done(Val::Arg(Arg::Term(term), Some(ty))));
        }
        if let Some(integer) = self.rules(frame.node, "integer").next() {
            let digits = self.value(self.token(integer)?);
            if !crate::dom::valid_integer(digits) {
                return Err(self.error(integer, "an integer argument is positive and has no leading zeros"));
            }
            return Ok(Step::Done(Val::Arg(Arg::Integer(digits.into()), None)));
        }
        let term = self.one(frame.node, "term")?;
        if let Some(union) = self.rules(term, "union").next() {
            if let Some(rule) = self.rule_name_in(union) {
                return Ok(Step::Done(Val::Arg(Arg::Rule(rule), None)));
            }
        }
        Ok(Step::Call(Frame::Term(TermFrame::new(term, true))))
    }

    /// `A ⟹ B ⟹ C`: its any-ofs in order, and after them the implication
    /// of a notation that writes one after `⟹`, grouped to the right: `if`
    /// of each, in turn, around the rest (§9).
    fn resume_implication(&self, frame: &mut Conditions<'a>, input: Option<Val>) -> R<Step<'a>> {
        if frame.parts.is_none() {
            frame.parts = Some(self.some(frame.node, "any-of", 1)?);
        }
        if let Some(Val::Cond(cond)) = input {
            frame.items.push(cond);
        }
        let parts = frame.parts.as_ref().expect("the any-ofs");
        if let Some(&any_of) = parts.get(frame.items.len()) {
            return Ok(Step::Call(Frame::AnyOf(Conditions::new(any_of))));
        }
        if frame.items.len() == parts.len() {
            if let Some(consequent) = self.rules(frame.node, "implication").next() {
                return Ok(Step::Call(Frame::Implication(Conditions::new(consequent))));
            }
        }
        let mut result = frame.items.pop().expect("an any-of");
        while let Some(antecedent) = frame.items.pop() {
            result = Cond::If(Box::new(antecedent), Box::new(result));
        }
        Ok(Step::Done(Val::Cond(result)))
    }

    /// Conditions joined by `∨`, of its all-ofs, or by `∧`, of its
    /// conditions: `any` or `all` of them, or the one itself. A group in
    /// parentheses of the same connective is folded into this one once the
    /// document is read (`normalize::document`), in one walk, since folding it here
    /// would move a list at each depth (§9).
    fn resume_connective(&self, frame: &mut Conditions<'a>, input: Option<Val>, part: &'static str) -> R<Step<'a>> {
        if frame.parts.is_none() {
            frame.parts = Some(self.some(frame.node, part, 1)?);
        }
        if let Some(Val::Cond(cond)) = input {
            frame.items.push(cond);
        }
        let parts = frame.parts.as_ref().expect("the parts");
        if let Some(&next) = parts.get(frame.items.len()) {
            return Ok(Step::Call(if part == "all-of" {
                Frame::AllOf(Conditions::new(next))
            } else {
                Frame::Condition(ConditionFrame::new(next))
            }));
        }
        let items = std::mem::take(&mut frame.items);
        Ok(Step::Done(Val::Cond(if part == "all-of" {
            single_or(items, Cond::Any)
        } else {
            single_or(items, Cond::All)
        })))
    }

    fn resume_condition(&self, frame: &mut ConditionFrame<'a>, input: Option<Val>) -> R<Step<'a>> {
        let Some(inner) = frame.inner else {
            let inner = self.inner(frame.node, CONDITIONS)?;
            frame.inner = Some(inner);
            return Ok(match rule_name(inner) {
                // Parentheses make no node of their own (§9).
                "implication" => Step::Call(Frame::Implication(Conditions::new(inner))),
                "tree-comparison" => {
                    let capture = self
                        .value(self.token(self.one(inner, "capture-reference")?)?)
                        .strip_prefix('$')
                        .unwrap_or("")
                        .to_owned();
                    frame.op = self.operator(self.token(self.one(inner, "tree-comparator")?)?).to_owned();
                    let right = self.one(inner, "union")?;
                    if let Some(name) = first_of_rule(right, "name").or_else(|| first_of_rule(right, "tag")) {
                        if right
                            .span
                            .end
                            .checked_sub(right.span.start)
                            .ok_or_else(|| self.shape_error(right, "valid token span"))?
                            == 1
                        {
                            let at = name;
                            let name = self.value(self.token(name)?);
                            return Err(self
                                .error(at, format!("tree comparison requires a pattern; write #{name}, not {name}")));
                        }
                    }
                    frame.left = Some((Term::Capture(capture), Type::Span));
                    Step::Call(Frame::Union(Joined::new(right, false)))
                }
                "comparison" => {
                    let comparator = self.one(inner, "comparator")?;
                    frame.op = self.operator(self.token(comparator)?).to_string();
                    let operands = self.some(inner, "union", 2)?;
                    frame.right = Some(operands[1]);
                    Step::Call(Frame::Union(Joined::new(operands[0], false)))
                }
                "negation" => Step::Call(Frame::Condition(ConditionFrame::new(self.one(inner, "condition")?))),
                "presence" => {
                    let token = self.token(inner)?;
                    Step::Done(Val::Cond(Cond::Captured(self.value(token).strip_prefix('$').unwrap_or("").to_string())))
                }
                "method" => Step::Call(Frame::Method(MethodFrame::new(inner, true))),
                other => return Err(self.unknown(frame.node, other)),
            });
        };
        let value = input.expect("a part of the condition");
        match rule_name(inner) {
            "tree-comparison" | "comparison" => {
                let Val::Term(term, ty) = value else { unreachable!("a side of a comparison is a term") };
                if let Some(right) = frame.right.take() {
                    frame.left = Some((term, ty));
                    return Ok(Step::Call(Frame::Union(Joined::new(right, false))));
                }
                let (left, left_type) = frame.left.take().expect("the left side");
                // The two sides fit the comparator (engine §10).
                if !self.feature_context.get() {
                    let tree = matches!(frame.op.as_str(), "≅" | "≇");
                    if tree && matches!((&left, &term), (Term::Capture(a), Term::Capture(b)) if a == b) {
                        return Err(self.error(inner, "a constituent comparison requires two different captures"));
                    }
                    if tree && ty == Type::Span && !matches!(term, Term::Capture(_)) {
                        return Err(self.error(
                            self.one(inner, "union")?,
                            "a tree comparison requires a pattern or a bare capture on its right",
                        ));
                    }
                    if let Some(problem) = comparison_problem(&frame.op, left_type, ty) {
                        let at = if tree && left_type == Type::Span { self.one(inner, "union")? } else { inner };
                        return Err(self.error(at, problem));
                    }
                }
                let at = (matches!(frame.op.as_str(), "≅" | "≇")
                    && matches!(&term, Term::Capture(_) | Term::Source(_)))
                .then(|| self.first(inner));
                Ok(Step::Done(Val::Cond(Cond::Compare(std::mem::take(&mut frame.op), left, term, at))))
            }
            "negation" => {
                let Val::Cond(cond) = value else { unreachable!("a negation holds a condition") };
                Ok(Step::Done(Val::Cond(Cond::Not(Box::new(cond)))))
            }
            _ => Ok(Step::Done(value)),
        }
    }

    /// A reference, literal string, scalar range, wildcard, or engine tag.
    fn symbol(&self, node: &'a Node) -> R<Expr> {
        match rule_name(node) {
            "parameter" => Ok(Expr::Source(self.source_parameter(node)?)),
            "reference" => {
                let token = self.token(node)?;
                let name = self.value(token);
                Ok(Expr::Ref(name.into()))
            }
            "tag" => Ok(Expr::Ref(self.tag_of(self.token(node)?)?)),
            "constant-reference" => Ok(Expr::Literal(self.constant_reference(self.token(node)?)?)),
            "wildcard" => {
                self.token(node)?;
                Ok(Expr::Wildcard)
            }
            "string-terminal" => {
                let part = self.inner(node, &["string", "constant-reference"])?;
                Ok(Expr::Literal(self.string_operand(part)?))
            }
            "range" => {
                let parts: Vec<_> = self
                    .parts(node)
                    .into_iter()
                    .filter(|p| matches!(rule_name(p), "string" | "constant-reference" | "parameter"))
                    .collect();
                if parts.len() < 2 {
                    return Err(self.shape_error(node, "two string operands"));
                }
                let left = self.string_operand(parts[0])?;
                let right = self.string_operand(parts[1])?;
                let scalar = |term: &Term| match term {
                    Term::Str(s) => {
                        let mut cs = s.chars();
                        let c = cs.next()?;
                        cs.next().is_none().then_some(c)
                    }
                    Term::Const(_, _) => None,
                    _ => None,
                };
                if matches!(&left, Term::Str(_)) && scalar(&left).is_none()
                    || matches!(&right, Term::Str(_)) && scalar(&right).is_none()
                {
                    return Err(self.error(node, "a range endpoint is one scalar"));
                }
                if let (Some(a), Some(b)) = (scalar(&left), scalar(&right)) {
                    if a > b {
                        return Err(self.error(node, "a range starts above its end"));
                    }
                }
                Ok(Expr::ScalarRange(left, right))
            }
            _ => Err(self.unknown(node, rule_name(node))),
        }
    }

    fn value_test_operand(&self, operand: &'a Node) -> R<Term> {
        let part = self.inner(operand, ATOMS)?;
        if !matches!(rule_name(part), "string" | "constant-reference" | "parameter") {
            return Err(self.error(operand, "a value test requires a string literal or constant"));
        }
        self.string_operand(part)
    }

    fn string_operand(&self, node: &'a Node) -> R<Term> {
        let token = self.token(node)?;
        match rule_name(node) {
            "string" => self.string_term(token),
            "constant-reference" => self.constant_reference(token),
            "parameter" => Ok(Term::Source(self.source_parameter(node)?)),
            _ => Err(self.error(node, "a string literal or constant is required")),
        }
    }

    fn constant_reference(&self, token: &'a Node) -> R<Term> {
        let name = self.value(token).strip_prefix('$').unwrap_or("");
        if !crate::dom::is_constant_name(name) {
            return Err(self.error(token, "invalid constant name or scalar"));
        }
        Ok(Term::Const(name.into(), self.at(token)))
    }

    fn string_term(&self, token: &'a Node) -> R<Term> {
        let text = self.value(token);
        if text.strip_prefix('"').and_then(|s| s.strip_suffix('"')).is_none() {
            return Err(self.error(token, "a string requires double quotes"));
        }
        let token = token
            .token
            .and_then(|index| self.tokens.get(index))
            .ok_or_else(|| self.shape_error(token, "string token"))?;
        Ok(Term::Str(self.strings.decode(token, false)?))
    }

    fn channels(&self, node: &'a Node) -> R<Channels> {
        let mut channels = Channels::default();
        for (name, target, at) in [
            ("value-clause", &mut channels.value, &mut channels.value_at),
            ("image-clause", &mut channels.image, &mut channels.image_at),
        ] {
            if let Some(clause) = self.rules(node, name).next() {
                let recipe = self.one(clause, "recipe")?;
                *at = Some(self.first(recipe));
                *target = Some(self.recipe(clause)?);
            }
        }
        Ok(channels)
    }

    fn recipe(&self, clause: &'a Node) -> R<Term> {
        let recipe = self.one(clause, "recipe")?;
        let mut atoms = Vec::new();
        self.in_recipe.set(true);
        for atom in self.some(recipe, "recipe-atom", 1)? {
            if !atoms.is_empty() {
                return Err(self.error(atom, "juxtaposed recipe strings require ++, use ++ between string atoms"));
            }
            let written =
                self.tokens.get(atom.span.clone()).ok_or_else(|| self.shape_error(atom, "valid token span"))?;
            if written.iter().any(|t| matches!(t.value.as_str(), "(" | ")")) {
                return Err(self.error(atom, "a recipe atom has no grouping or arguments"));
            }
            if written.iter().any(|t| matches!(t.value.as_str(), "∪" | "∩" | "∖" | "⟹")) {
                return Err(self.error(atom, "a recipe atom has no set operator"));
            }
            let (mut term, _) = self.term(self.one(atom, "term")?, true)?;
            let terms = if let Term::Call(name, args) = &mut term {
                if name == "concat" {
                    std::mem::take(args)
                } else {
                    vec![Arg::Term(term)]
                }
            } else {
                vec![Arg::Term(term)]
            };
            for arg in terms {
                let Arg::Term(term) = arg else { unreachable!("string operand") };
                let valid = match &term {
                    Term::Str(_) | Term::Const(..) | Term::Source(SourceSymbol::Parameter(..)) => true,
                    Term::Union(_) => {
                        return Err(
                            self.error(atom, "juxtaposed recipe strings require ++, use ++ between string atoms")
                        )
                    }
                    Term::Call(name, args)
                        if matches!(
                            name.as_str(),
                            "value" | "image" | "source-text" | "decomposed-source-text" | "verbatim-text"
                        ) =>
                    {
                        matches!(&args[..], [Arg::Term(Term::Capture(_))])
                            || matches!(name.as_str(), "value" | "image")
                                && matches!(&args[..], [Arg::Term(Term::Call(name,args))] if name == "emitted" && matches!(&args[..], [Arg::Term(Term::Capture(_))]))
                    }
                    _ => false,
                };
                if !valid {
                    return Err(self.error(atom, "a recipe atom must be a string or a captured string method"));
                }
                atoms.push(Arg::Term(term));
            }
        }
        self.in_recipe.set(false);
        Ok(Term::Call("concat".into(), atoms))
    }

    fn term_tag(&self, token: &'a Node) -> R<String> {
        let tag = self.tag_of(token)?;
        if let Some(closed) = self.closed_for.get().filter(|_| tag.starts_with('_')) {
            return Err(self.error(token, format!("{closed} cannot contain an engine-tag literal")));
        }
        Ok(tag)
    }

    fn tag_of(&self, token: &'a Node) -> R<String> {
        let text = self.value(token);
        if text.starts_with('_') {
            return self
                .unicode
                .canonical_tag(text)
                .map(str::to_string)
                .ok_or_else(|| self.error(token, "unknown or unavailable engine tag"));
        } else if !text.starts_with(|c: char| c.is_ascii_uppercase()) || !crate::tags::is_name(text) {
            return Err(self.error(token, "a user tag starts with an uppercase ASCII letter"));
        }
        Ok(text.into())
    }

    fn emission(&self, node: &'a Node) -> R<Vec<EmitItem>> {
        let nodes: Vec<_> = self.rules(node, "emit-item").collect();
        if nodes.is_empty() {
            let tags = self
                .rules(node, "emit-tags")
                .next()
                .or_else(|| self.rules(node, "tags-clause").next())
                .map(|clause| self.tag_term(self.one(clause, "term")?))
                .transpose()?;
            return Ok(vec![EmitItem::Capture(
                "".into(),
                tags,
                Attachments { strings: self.channels(node)?, ..Default::default() },
            )]);
        }
        let mut items = Vec::new();
        for item in nodes {
            let target = self.one(item, "emit-target")?;
            let token = self
                .tokens_of(target)
                .next()
                .ok_or_else(|| self.error(target, "an emission requires a capture or epsilon target"))?;
            let text = self.value(token);
            if !text.starts_with('$') && text != "ε" {
                return Err(self.error(target, "an emission target is a capture or ε"));
            }
            let mut before = Vec::new();
            let mut after = Vec::new();
            for (name, list) in [("emit-before", &mut before), ("emit-after", &mut after)] {
                for side in self.rules(item, name) {
                    for capture in self.some(side, "capture-reference", 1)? {
                        let token = self.token(capture)?;
                        let name = self.value(token).strip_prefix('$').unwrap_or("");
                        if name.is_empty() {
                            return Err(self.error(side, "an attachment requires a named capture"));
                        }
                        list.push(name.to_string());
                    }
                }
            }
            let capture = text.strip_prefix('$');
            if (!before.is_empty() || !after.is_empty()) && (capture.is_none() || capture == Some("")) {
                return Err(self.error(item, "attachments require a named carrier"));
            }
            let tags = self
                .rules(item, "emit-tags")
                .next()
                .map(|clause| self.tag_term(self.one(clause, "term")?))
                .transpose()?;
            let strings = self.channels(item)?;
            items.push(match capture {
                Some(name) => EmitItem::Capture(name.into(), tags, Attachments { before, after, strings }),
                None => EmitItem::Insert(tags, strings),
            });
        }
        let mut named = FxSet::default();
        for item in &items {
            if let EmitItem::Capture(name, _, attachments) = item {
                for name in attachments.before.iter().chain(std::iter::once(name)).chain(&attachments.after) {
                    if !name.is_empty() && !named.insert(name) {
                        return Err(self.error(node, "a repeated emission capture"));
                    }
                }
            }
        }
        Ok(items)
    }

    /// The bare name without a capital that a union is alone, if it is one.
    fn rule_name_in(&self, union: &'a Node) -> Option<String> {
        let mut union = union;
        loop {
            let [intersection] = self.rules(union, "intersection").collect::<Vec<_>>()[..] else { return None };
            let [concatenation] = self.rules(intersection, "concatenation").collect::<Vec<_>>()[..] else {
                return None;
            };
            let [atom] = self.rules(concatenation, "term-atom").collect::<Vec<_>>()[..] else { return None };
            let inner = self.inner(atom, ATOMS).ok()?;
            match rule_name(inner) {
                "name" => {
                    let name = self.value(self.tokens_of(inner).next()?);
                    return (!is_capital(name)).then(|| name.to_string());
                }
                "term" => {
                    let inner = self.inner(inner, &TERMS).ok()?;
                    if rule_name(inner) != "union" {
                        return None;
                    }
                    union = inner;
                }
                _ => return None,
            }
        }
    }
}

/// A value that the reading of a construct gives: an expression, a term
/// with its type, a condition, or a function's argument with its type if it
/// is a term.
enum Val {
    Pattern(patterns::Value),
    SourceCall(SourceCall),
    SourceArgument(SourceArgument),
    Expr(Expr),
    Term(Term, Type),
    Cond(Cond),
    Arg(Arg, Option<Type>),
}

/// What a frame does next: ask for a construct it holds, or give its value.
enum Step<'a> {
    Again,
    Call(Frame<'a>),
    Done(Val),
}

/// The reading of one construct, with what it has read so far.
enum Frame<'a> {
    Pattern(patterns::PatternFrame<'a>),
    PatternAtom(&'a Node),
    SourceCall(CallFrame<'a>),
    SourceArgument(SourceArgumentFrame<'a>),
    Conjunction(Conjunction<'a>),
    Choice(Choice<'a>),
    Primary(PrimaryFrame<'a>),
    Optional(OptionalFrame<'a>),
    Repetition(Repetition<'a>),
    Tested(Tested<'a>),
    Term(TermFrame<'a>),
    Union(Joined<'a>),
    Intersection(Joined<'a>),
    Concatenation(Joined<'a>),
    Atom(Atom<'a>),
    Method(MethodFrame<'a>),
    Argument(ArgumentFrame<'a>),
    Implication(Conditions<'a>),
    AnyOf(Conditions<'a>),
    AllOf(Conditions<'a>),
    Condition(ConditionFrame<'a>),
}

struct Conjunction<'a> {
    node: &'a Node,
    whole: bool,
    sequences: Option<Vec<&'a Node>>,
    primaries: Option<Vec<&'a Node>>,
    sequence_whole: bool,
    items: Vec<Expr>,
    parts: Vec<Expr>,
}

impl<'a> Conjunction<'a> {
    fn new(node: &'a Node, whole: bool) -> Self {
        Conjunction {
            node,
            whole,
            sequences: None,
            primaries: None,
            sequence_whole: false,
            items: Vec::new(),
            parts: Vec::new(),
        }
    }
}

struct Choice<'a> {
    ranked: bool,
    node: &'a Node,
    conjunctions: Option<Vec<&'a Node>>,
    parts: Vec<Expr>,
}

impl<'a> Choice<'a> {
    fn new(node: &'a Node) -> Self {
        Choice { ranked: rule_name(node) == "ranked-choice", node, conjunctions: None, parts: Vec::new() }
    }
}

struct PrimaryFrame<'a> {
    node: &'a Node,
    whole: bool,
    /// The name of the capture that wraps what it asked for, if it is one.
    capture: Option<(String, &'a Node)>,
    spliced: bool,
}

impl<'a> PrimaryFrame<'a> {
    fn new(node: &'a Node, whole: bool) -> Self {
        PrimaryFrame { node, whole, capture: None, spliced: false }
    }
}

struct OptionalFrame<'a> {
    node: &'a Node,
    mark: Mark,
    head: usize,
    previous_head: usize,
    captured_node: Option<usize>,
}

impl<'a> OptionalFrame<'a> {
    fn new(node: &'a Node) -> Self {
        OptionalFrame { node, mark: Mark::Plain, head: 0, previous_head: 0, captured_node: None }
    }
}

/// The names of the captures of an expression in the order written, braces
/// included, which is the order the reader meets them.
fn capture_names(expr: &Expr) -> Vec<&str> {
    let mut names = Vec::new();
    let mut stack = vec![expr];
    while let Some(current) = stack.pop() {
        work::count(Work::Walked, 1);
        match current {
            Expr::Capture(name, inner) => {
                names.push(name.as_str());
                stack.push(inner);
            }
            Expr::Seq(items) | Expr::Choice(items) | Expr::Ranked(items, _) | Expr::And(items) => {
                stack.extend(items.iter().rev());
            }
            Expr::Splice(inner) | Expr::Optional(inner, _, _) | Expr::Tested(_, _, inner) => stack.push(inner),
            Expr::Repeat(item, separator, _) => {
                stack.extend(separator.as_deref());
                stack.push(item);
            }
            Expr::Ref(_)
            | Expr::Terminal(_)
            | Expr::Literal(_)
            | Expr::ScalarRange(..)
            | Expr::Range(..)
            | Expr::Source(_)
            | Expr::Wildcard
            | Expr::Empty => {}
        }
    }
    names
}

struct Repetition<'a> {
    node: &'a Node,
    whole: bool,
    choices: Vec<&'a Node>,
    chain: Option<Chain>,
    /// The reader's `chain`, `item` and `ranked` before these braces,
    /// restored after them.
    outer: (bool, bool, usize),
    item: Option<Expr>,
    separator: Option<Expr>,
}

impl<'a> Repetition<'a> {
    fn new(node: &'a Node, whole: bool) -> Self {
        Repetition {
            node,
            whole,
            choices: Vec::new(),
            chain: None,
            outer: (false, false, 0),
            item: None,
            separator: None,
        }
    }
}

struct Tested<'a> {
    node: &'a Node,
    tests: Option<Vec<&'a Node>>,
}

impl<'a> Tested<'a> {
    fn new(node: &'a Node) -> Self {
        Tested { node, tests: None }
    }
}

struct TermFrame<'a> {
    node: &'a Node,
    argument: bool,
    /// The guarded term, if it is one.
    inner: Option<&'a Node>,
    /// Its guards, the any-ofs of a guarded term, once it has looked at it:
    /// none where it is a union, which it passes on.
    guards: Option<Vec<&'a Node>>,
    pass: bool,
    conds: Vec<Cond>,
}

impl<'a> TermFrame<'a> {
    fn new(node: &'a Node, argument: bool) -> Self {
        TermFrame { node, argument, inner: None, guards: None, pass: false, conds: Vec::new() }
    }
}

/// A union or an intersection: its parts, and those read, with their types.
/// One that has one part is that part, which it passes on.
struct Joined<'a> {
    node: &'a Node,
    argument: bool,
    parts: Option<Vec<&'a Node>>,
    pass: bool,
    items: Vec<Term>,
    types: Vec<Type>,
}

impl<'a> Joined<'a> {
    fn new(node: &'a Node, argument: bool) -> Self {
        Joined { node, argument, parts: None, pass: false, items: Vec::new(), types: Vec::new() }
    }
}

struct Atom<'a> {
    node: &'a Node,
    argument: bool,
    pattern_closed: Option<Option<&'static str>>,
}

impl<'a> Atom<'a> {
    fn new(node: &'a Node, argument: bool) -> Self {
        Atom { node, argument, pattern_closed: None }
    }
}

struct ArgumentFrame<'a> {
    node: &'a Node,
}

struct MethodFrame<'a> {
    node: &'a Node,
    condition: bool,
    dependent: bool,
    receiver_query: bool,
    receiver: Option<(Term, Type)>,
    selectors: Option<Vec<&'a Node>>,
    index: usize,
    arguments: Option<Vec<&'a Node>>,
    args: Vec<Arg>,
    types: Vec<Option<Type>>,
}

impl<'a> MethodFrame<'a> {
    fn new(node: &'a Node, condition: bool) -> Self {
        Self {
            node,
            condition,
            dependent: false,
            receiver_query: false,
            receiver: None,
            selectors: None,
            index: 0,
            arguments: None,
            args: Vec::new(),
            types: Vec::new(),
        }
    }
}

/// An implication, an any-of or an all-of: its parts, and the conditions
/// read.
struct Conditions<'a> {
    node: &'a Node,
    parts: Option<Vec<&'a Node>>,
    items: Vec<Cond>,
}

impl<'a> Conditions<'a> {
    fn new(node: &'a Node) -> Self {
        Conditions { node, parts: None, items: Vec::new() }
    }
}

struct ConditionFrame<'a> {
    node: &'a Node,
    inner: Option<&'a Node>,
    op: String,
    left: Option<(Term, Type)>,
    right: Option<&'a Node>,
}

impl<'a> ConditionFrame<'a> {
    fn new(node: &'a Node) -> Self {
        ConditionFrame { node, inner: None, op: String::new(), left: None, right: None }
    }
}

/// The one item of a list, or the node that `many` makes of its items.
fn single_or<T>(mut items: Vec<T>, many: impl FnOnce(Vec<T>) -> T) -> T {
    match items.pop() {
        Some(item) if items.is_empty() => item,
        item => {
            items.extend(item);
            many(items)
        }
    }
}

/// The first node of a rule at or below a node, in the order written.
fn first_of_rule<'n>(node: &'n Node, name: &str) -> Option<&'n Node> {
    // In the order written, with an explicit stack.
    let mut stack = vec![node];
    while let Some(node) = stack.pop() {
        work::count(Work::Walked, 1);
        if node.kind == NodeKind::Rule && rule_name(node) == name {
            return Some(node);
        }
        stack.extend(node.children.iter().rev());
    }
    None
}

/// The rules of the notation's syntax grammar that the reader knows (engine
/// §9). Every other rule is a wrapper, and the reader reads its parts in
/// its place.
const KNOWN: &[&str] = &[
    "call",
    "parameter",
    "call-argument",
    "requirement-argument",
    "target-argument",
    "body-argument",
    "symbol-argument",
    "headed-body",
    "string-terminal",
    "wildcard",
    "tag-test",
    "tag-requirement",
    "value-test",
    "default-value",
    "error-clause",
    "warning-clause",
    "suppress-warnings-clause",
    "suppression-code",
    "splice",
    "value-clause",
    "image-clause",
    "erased-clause",
    "recipe",
    "recipe-atom",
    "method",
    "method-receiver",
    "method-selector",
    "method-name",
    "arguments",
    "tag-run",
    "string-run",
    "integer",
    "argument-term",
    "tree-comparison",
    "tree-comparator",
    "pattern-primary",
    "pattern-node",
    "pattern-bare",
    "pattern-children",
    "child-choice",
    "child-alternative",
    "child-set",
    "child-intersection",
    "child-sequence",
    "child-item",
    "child-path",
    "child-primary",
    "pattern-literal",
    "pattern-union",
    "pattern-intersection",
    "pattern-atom",
    "pattern-brackets",
    "pattern-repeat",
    "pattern-path",
    "directive",
    "ranking-directive",
    "ranking-step",
    "argument-word",
    "argument-string",
    "argument-tag",
    "classifier",
    "classifier-name",
    "classifier-entry",
    "classifier-key",
    "classifier-operator",
    "classifier-class",
    "implication-declaration",
    "constant-definition",
    "constant-definer",
    "constant-reference",
    "rule",
    "definer",
    "rule-name",
    "body",
    "alternative",
    "ranked-alternative",
    "ranked-choice",
    "guard",
    "alternative-tags",
    "choice",
    "conjunction",
    "sequence",
    "primary",
    "repetition",
    "reference",
    "tag",
    "range",
    "tested",
    "test",
    "test-operand",
    "capture",
    "group",
    "optional",
    "empty",
    "tags-clause",
    "conditions-clause",
    "emits-clause",
    "emit-item",
    "emit-target",
    "emit-tags",
    "emit-before",
    "emit-after",
    "implication",
    "any-of",
    "all-of",
    "condition",
    "comparison",
    "comparator",
    "negation",
    "presence",
    "argument",
    "term",
    "guarded-term",
    "union",
    "intersection",
    "concatenation",
    "term-atom",
    "string",
    "name",
    "empty-set",
    "capture-reference",
];

/// What a primary, a condition, a term and a term atom hold: the one rule
/// among their parts is one of these (engine §9).
const PRIMARIES: &[&str] = &[
    "splice",
    "call",
    "parameter",
    "string-terminal",
    "wildcard",
    "reference",
    "tag",
    "range",
    "tested",
    "capture",
    "group",
    "optional",
    "repetition",
    "empty",
    "constant-reference",
];
const CONDITIONS: &[&str] = &["tree-comparison", "comparison", "method", "negation", "presence", "implication"];
const TERMS: [&str; 2] = ["union", "guarded-term"];
const ATOMS: &[&str] = &[
    "call",
    "parameter",
    "method",
    "tag-run",
    "string-run",
    "pattern-literal",
    "string",
    "tag",
    "range",
    "name",
    "empty-set",
    "term",
    "guarded-term",
    "union",
    "term-atom",
    "capture-reference",
    "constant-reference",
];

enum MethodKind {
    Span,
    Restored,
    Recipe,
    Tags,
    Boundary,
    Query,
    Ngrams,
    Split,
    Classify,
}

/// The signature family of a supported method.
fn known_method(name: &str) -> Option<MethodKind> {
    Some(match name {
        "value"
        | "image"
        | "source-text"
        | "decomposed-source-text"
        | "classes"
        | "onward"
        | "following-tokens"
        | "preceding-tokens"
        | "first-token"
        | "last-token"
        | "tokens-after-first"
        | "starts-input"
        | "ends-input" => MethodKind::Span,
        "without-elision" | "without-elision-except" => MethodKind::Restored,
        "verbatim-text" | "emitted" => MethodKind::Recipe,
        "tags" => MethodKind::Tags,
        "followed-by" | "preceded-by" => MethodKind::Boundary,
        "matches" | "begins" | "ends" => MethodKind::Query,
        "ngrams" => MethodKind::Ngrams,
        "split" => MethodKind::Split,
        "classify" => MethodKind::Classify,
        _ => return None,
    })
}

/// Whether a name begins with a capital, and so is a terminal and a tag
/// literal (engine §2).
fn is_capital(name: &str) -> bool {
    name.starts_with(|c: char| c.is_ascii_uppercase())
}

/// Whether a tag term, or a condition inside one, reads `$.tags` or
/// `$.classes` (§9). Bare `$` reads the input value, and `$.tags(R)`
/// parses the input again.
pub(crate) fn reads_own_tags(term: &Term) -> bool {
    // The parts to look at, with an explicit stack: a term is as deep as
    // its document nests until the check of its depth (§9).
    let mut stack = vec![Part::Term(term)];
    while let Some(part) = stack.pop() {
        work::count(Work::Walked, 1);
        match part {
            Part::Term(term) => match term {
                Term::Call(name, args) => {
                    if matches!(name.as_str(), "tags" | "classes")
                        && matches!(&args[..], [Arg::Term(Term::Capture(name))] if name.is_empty())
                    {
                        return true;
                    }
                    stack.extend(args.iter().filter_map(|arg| {
                        if let Arg::Term(term) = arg {
                            Some(Part::Term(term))
                        } else {
                            None
                        }
                    }));
                }
                Term::Union(items) | Term::Intersection(items) => stack.extend(items.iter().map(Part::Term)),
                Term::Difference(left, right) => stack.extend([Part::Term(left), Part::Term(right)]),
                Term::If(cond, then) => stack.extend([Part::Cond(cond), Part::Term(then)]),
                Term::Source(symbol) => stack.push(Part::Symbol(symbol)),
                Term::Pattern(_)
                | Term::Str(_)
                | Term::Tag(_)
                | Term::EmptySet
                | Term::Const(..)
                | Term::Capture(_) => {}
            },
            Part::Cond(cond) => match cond {
                Cond::SourceQuery(_, args, _) => stack.extend(args.iter().filter_map(|arg| match arg {
                    Arg::Term(term) => Some(Part::Term(term)),
                    _ => None,
                })),
                Cond::Compare(op, left, right, _) => {
                    if matches!(op.as_str(), "≅" | "≇")
                        && matches!(left,Term::Capture(name) if name.is_empty())
                        && matches!(right,Term::Pattern(p) if crate::patterns::reads_node_tags(p))
                    {
                        return true;
                    }
                    if !matches!(op.as_str(), "≅" | "≇") {
                        stack.extend([Part::Term(left), Part::Term(right)]);
                    }
                }
                Cond::Not(inner) => stack.push(Part::Cond(inner)),
                Cond::Any(items) | Cond::All(items) => stack.extend(items.iter().map(Part::Cond)),
                Cond::If(antecedent, consequent) => stack.extend([Part::Cond(antecedent), Part::Cond(consequent)]),
                Cond::Matches(..)
                | Cond::Begins(..)
                | Cond::Ends(..)
                | Cond::Initial(_)
                | Cond::Final(_)
                | Cond::Boundary(_, _, _, _)
                | Cond::Captured(_) => {}
            },
            Part::Symbol(symbol) => {
                if let SourceSymbol::Call(call) = symbol {
                    stack.extend(call.args.iter().map(Part::Argument));
                }
            }
            Part::Argument(argument) => match argument {
                SourceArgument::Term(term) | SourceArgument::Requirements(term) => stack.push(Part::Term(term)),
                SourceArgument::Body(expr) | SourceArgument::WrappedBody(expr) => stack.push(Part::Expression(expr)),
                SourceArgument::Targets(targets) => {
                    for target in targets {
                        if let crate::dom::source::SourceTarget::Symbol(symbol) = target {
                            stack.push(Part::Symbol(symbol));
                        }
                    }
                }
            },
            Part::Expression(expr) => match expr {
                Expr::Seq(items) | Expr::Choice(items) | Expr::Ranked(items, _) | Expr::And(items) => {
                    stack.extend(items.iter().map(Part::Expression))
                }
                Expr::Optional(inner, _, _) | Expr::Capture(_, inner) | Expr::Splice(inner) => {
                    stack.push(Part::Expression(inner))
                }
                Expr::Repeat(item, separator, _) => {
                    stack.push(Part::Expression(item));
                    stack.extend(separator.as_deref().map(Part::Expression));
                }
                Expr::Tested(_, value, inner) => {
                    stack.push(Part::Term(value));
                    stack.push(Part::Expression(inner));
                }
                Expr::Literal(term) => stack.push(Part::Term(term)),
                Expr::ScalarRange(a, b) => stack.extend([Part::Term(a), Part::Term(b)]),
                Expr::Source(symbol) => stack.push(Part::Symbol(symbol)),
                _ => {}
            },
        }
    }
    false
}

/// A part of a clause: a term or a condition.
enum Part<'t> {
    Term(&'t Term),
    Cond(&'t Cond),
    Symbol(&'t SourceSymbol),
    Argument(&'t SourceArgument),
    Expression(&'t Expr),
}

#[cfg(test)]
#[test]
fn own_tags_are_found_inside_call_arguments() {
    let read = Term::Call("tags".into(), vec![Arg::Term(Term::Capture(String::new()))]);
    let outer = Term::Call("wrapper".into(), vec![Arg::Term(read.clone())]);
    assert!(reads_own_tags(&outer));
    let source = Term::Source(SourceSymbol::Call(SourceCall {
        name: "wrapper".into(),
        args: vec![SourceArgument::Term(read)],
        at: (1, 1),
    }));
    assert!(reads_own_tags(&source));
}

/// Folds each `any` that stands directly in an `any`, and each `all` in an
/// `all`, into the one around it: a group in parentheses of the same
/// connective is part of the one around it (§9). One walk, with an explicit
/// stack, that gathers each folded list once.
#[cfg(test)]
#[test]
fn call_name_lookup_precedes_argument_lookup() {
    let unicode = crate::unicode::Unicode::parse("").unwrap();
    let names = crate::unicode_names::NamesScope::new(&|_| Ok(None), &unicode, []);
    let position = |index| (1, index + 1);
    let strings = crate::string_escapes::DocumentStrings {
        unicode: &unicode,
        names: &names,
        position: &position,
        names_paths: Default::default(),
    };
    let tokens: Vec<_> = ["$x", "≅", "A", "%names"]
        .into_iter()
        .enumerate()
        .map(|(index, value)| Token {
            errors: Vec::new(),
            warnings: Vec::new(),
            text: value.into(),
            value: value.into(),
            image: value.into(),
            tags: Default::default(),
            span: index..index + 1,
            source: index..index + 1,
            inserted_by: None,
            before: Vec::new(),
            after: Vec::new(),
        })
        .collect();
    let reader = Reader {
        head_defaults: Default::default(),
        default_head: Default::default(),
        unresolved_nodes: Default::default(),
        parts_cache: Default::default(),
        parameters: Default::default(),
        reading_head: Default::default(),
        unresolved: Default::default(),
        unicode: &unicode,
        defer_emission: false,
        feature_context: Default::default(),
        tokens: &tokens,
        strings: &strings,
        captures: Default::default(),
        chain: Default::default(),
        item: Default::default(),
        ranked: Default::default(),
        marked: Default::default(),
        allowed_marked: Default::default(),
        position: &position,
        in_recipe: Default::default(),
        closed_for: Default::default(),
    };
    let argument = Node {
        kind: NodeKind::Rule,
        rule: Some("call-argument".into()),
        terminal: None,
        token: None,
        span: 0..0,
        source: 1..1,
        tags: Default::default(),
        value: None,
        children: Vec::new(),
    };
    let mut call = argument.clone();
    call.rule = Some("call".into());
    call.source = 0..0;
    call.children.push(argument);
    let error = reader.source_call(&call).unwrap_err();
    assert_eq!(error.message, "the notation's call has no token");
    let mut wildcard = call.clone();
    wildcard.rule = Some("wildcard".into());
    wildcard.children.clear();
    let wildcard_error = reader.symbol(&wildcard).is_err();
    let mut atom = wildcard.clone();
    atom.rule = Some("recipe-atom".into());
    atom.span = 999..1000;
    let mut recipe = wildcard.clone();
    recipe.rule = Some("recipe".into());
    recipe.children.push(atom);
    let mut clause = wildcard.clone();
    clause.rule = Some("value-clause".into());
    clause.children.push(recipe);
    let mut rule = wildcard.clone();
    rule.rule = Some("rule".into());
    rule.children.push(clause);
    let recipe_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| reader.channels(&rule)));
    let mut token = wildcard.clone();
    token.kind = NodeKind::Token;
    token.rule = None;
    token.token = Some(2);
    let mut tag = wildcard.clone();
    tag.rule = Some("tag".into());
    tag.children.push(token);
    let mut right = wildcard.clone();
    right.rule = Some("union".into());
    right.span.start = 1;
    right.span.end = 0;
    right.children.push(tag);
    let mut comparison = wildcard.clone();
    comparison.rule = Some("tree-comparison".into());
    for (name, index) in [("capture-reference", 0), ("tree-comparator", 1)] {
        let mut part = wildcard.clone();
        part.rule = Some(name.into());
        let mut token = wildcard.clone();
        token.kind = NodeKind::Token;
        token.rule = None;
        token.token = Some(index);
        part.children.push(token);
        comparison.children.push(part);
    }
    comparison.children.push(right);
    let mut condition = wildcard.clone();
    condition.rule = Some("condition".into());
    condition.children.push(comparison);
    let span_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        reader.run(Frame::Condition(ConditionFrame::new(&condition)))
    }));
    assert!(recipe_result.is_ok(), "a recipe span caused a panic");
    assert!(recipe_result.unwrap().is_err(), "an invalid recipe span was accepted");
    assert!(span_result.is_ok(), "an inverted comparison span caused a panic");
    assert!(span_result.unwrap().is_err(), "an inverted comparison span was accepted");
    assert!(wildcard_error, "a tokenless wildcard was accepted");
    let mut empty = wildcard.clone();
    empty.span = 1..1;
    let empty_position = reader.first(&empty);
    let mut prefix = wildcard.clone();
    prefix.kind = NodeKind::Token;
    prefix.rule = None;
    prefix.token = Some(0);
    let mut names_token = prefix.clone();
    names_token.token = Some(3);
    let mut directive = wildcard.clone();
    directive.rule = Some("directive".into());
    directive.children.push(names_token);
    let mut document = wildcard.clone();
    document.rule = Some("text".into());
    document.children = vec![prefix, directive];
    let names_error = reader.document(&document).expect_err("the names declaration fails");
    assert_eq!(names_error.message, "%names must precede every other statement");
    assert_eq!(empty_position, (1, 2));
}
