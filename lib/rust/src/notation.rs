//! From the notation's document tree to a grammar DOM (engine §9).

use crate::dom::{
    call_type, comparison_problem, constant_type_problem, expected_problem, is_capture_name, is_classifier_name,
    joined_type, literal_call_problem, Alternative, Arg, Attachments, Chain, Channels, ClassifierDef, Cond, ConstDef,
    Directive, Dom, EmitItem, Entry, Expr, FeatureKind, Guard, ImplicationDef, Mark, Op, RuleDef, Term, Type,
};
use crate::error::Error;
use crate::fxhash::FxSet;
use crate::result::{Node, NodeKind, Token};
use crate::work::{self, Work};

pub(crate) struct Reader<'a> {
    pub unicode: &'a crate::unicode::Unicode,
    pub defer_emission: bool,
    pub feature_context: std::cell::Cell<bool>,
    pub tokens: &'a [Token],
    /// The captures of the alternative being read, in the order written,
    /// where an error about one is reported.
    pub captures: std::cell::RefCell<Vec<&'a Node>>,
    /// How many braces, and how many elidable optionals, the reader is
    /// inside, where no capture stands (engine §9).
    pub braces: std::cell::Cell<usize>,
    pub marked: std::cell::Cell<usize>,
    /// The document position of a grammar-text index.
    pub position: &'a dyn Fn(usize) -> (usize, usize),
    /// What the reader is reading as a closed term, a constant's value or a
    /// test's operand, if it is reading one (engine §9, §10).
    pub in_recipe: std::cell::Cell<bool>,
    pub closed_for: std::cell::Cell<Option<&'static str>>,
}

type R<T> = Result<T, Error>;

fn rule_name(node: &Node) -> &str {
    node.rule.as_deref().unwrap_or("")
}

impl<'a> Reader<'a> {
    fn source_text(&self, node: &Node) -> &str {
        node.token.and_then(|token| self.tokens.get(token)).map_or("", |token| token.text.as_str())
    }

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
        (self.position)(node.source.start)
    }

    /// The first token of a construct.
    fn first(&self, node: &Node) -> (usize, usize) {
        let mut pending = vec![node];
        while let Some(current) = pending.pop() {
            if current.kind == NodeKind::Token {
                return self.at(current);
            }
            pending.extend(current.children.iter().rev());
        }
        self.at(node)
    }

    fn error(&self, node: &Node, message: impl Into<String>) -> Error {
        let (line, column) = self.first(node);
        Error::grammar(message).at(line, column)
    }

    /// The parts of a node: its children, with each wrapper, a rule that
    /// the reader does not know, replaced by its own parts (engine §9).
    fn parts(node: &Node) -> Vec<&Node> {
        let mut parts = Vec::new();
        let mut stack: Vec<&Node> = node.children.iter().rev().collect();
        while let Some(child) = stack.pop() {
            work::count(Work::Walked, 1);
            if child.kind == NodeKind::Rule && !KNOWN.contains(&rule_name(child)) {
                stack.extend(child.children.iter().rev());
            } else {
                parts.push(child);
            }
        }
        parts
    }

    fn rules<'n>(node: &'n Node, name: &'n str) -> impl Iterator<Item = &'n Node> + 'n {
        Self::parts(node).into_iter().filter(move |child| child.kind == NodeKind::Rule && rule_name(child) == name)
    }

    /// The parts of a rule, at least `least` of them.
    fn some<'n>(&self, node: &'n Node, name: &'n str, least: usize) -> R<Vec<&'n Node>> {
        let found: Vec<&Node> = Self::rules(node, name).collect();
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
        {
            let error = self.error(node, format!("the notation's {} has no {what}", rule_name(node)));
            if rule_name(node) == "ranked-choice" {
                error.coded("ranked-choice-syntax")
            } else {
                error
            }
        }
    }

    /// The error of a child of a kind that the reader does not know.
    fn unknown(&self, node: &Node, child: &str) -> Error {
        self.error(node, format!("the notation's {} holds a {child}, which the reader does not know", rule_name(node)))
    }

    fn one<'n>(&self, node: &'n Node, name: &'n str) -> R<&'n Node> {
        Self::rules(node, name).next().ok_or_else(|| self.shape_error(node, name))
    }

    fn tokens_of(node: &Node) -> impl Iterator<Item = &Node> + '_ {
        Self::parts(node).into_iter().filter(|child| child.kind == NodeKind::Token)
    }

    /// The first token of a node.
    fn token<'n>(&self, node: &'n Node) -> R<&'n Node> {
        Self::tokens_of(node).next().ok_or_else(|| self.shape_error(node, "token"))
    }

    /// The one rule among a node's parts, which must be one of `kinds`.
    fn inner<'n>(&self, node: &'n Node, kinds: &[&str]) -> R<&'n Node> {
        match Self::parts(node).into_iter().filter(|child| child.kind == NodeKind::Rule).collect::<Vec<_>>()[..] {
            [found] if kinds.contains(&rule_name(found)) => Ok(found),
            _ => Err(self.shape_error(node, format!("single part of these: {}", kinds.join(", ")))),
        }
    }

    pub(crate) fn document(&self, root: &'a Node) -> R<Dom> {
        let mut dom = Dom::default();
        for node in Self::parts(root) {
            if node.kind != NodeKind::Rule {
                continue;
            }
            match rule_name(node) {
                "rule" => dom.rules.push(self.rule(node)?),
                "directive" => dom.directives.push(self.directive(node)?),

                "constant-definition" => dom.constants.push(self.constant(node)?),
                "classifier" => dom.classifiers.push(self.classifier(node)?),
                "implication-declaration" => dom.implications.push(self.implication_declaration(node)?),
                other => return Err(self.error(node, format!("the notation gives a {other} where an item stands"))),
            }
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
        for entry in Self::rules(node, "classifier-entry") {
            entries.push(self.entry(entry)?);
        }
        Ok(ClassifierDef { name, entries, at: self.first(node) })
    }

    /// An entry of a classifier: gates, canonical keys, `∈` or `∉`, and a
    /// class (engine §2, §9).
    fn entry(&self, node: &'a Node) -> R<Entry> {
        let guards = Self::rules(node, "guard").map(|guard| self.guard(guard, true)).collect::<R<_>>()?;
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
        let class = written.strip_prefix('~').unwrap_or(written);
        if !is_capital(class) || !class.ends_with(|c: char| c.is_ascii_uppercase()) {
            return Err(self.error(
                class_node,
                format!("{written} is not a class: a class is an identifier tag that begins with a capital"),
            ));
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
            if let Some(token) = self.first_engine_literal(side)? {
                return Err(self.error(token, "an implication cannot name an engine tag"));
            }
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
        let name = self.value(reference).trim_start_matches('$').to_string();
        if crate::dom::engine_scalar(&name).is_some() || !crate::dom::is_constant_name(&name) {
            return Err(self.error(reference, "an engine scalar cannot be declared"));
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
        if let Some(token) = self.first_engine_literal(value_node)? {
            return Err(self.error(token, "a constant cannot hold an engine-tag literal outside a pattern"));
        }
        if let Some(problem) = constant_type_problem(ty, redefine) {
            return Err(self.error(value_node, problem));
        }
        Ok(ConstDef { name, redefine, value, at: self.at(definer) })
    }

    fn directive(&self, node: &'a Node) -> R<Directive> {
        let token = self.token(node)?;
        let name = self.value(token).trim_start_matches('%');
        let parts: Vec<_> = Self::parts(node)
            .into_iter()
            .filter(|part| {
                matches!(rule_name(part), "argument-word" | "argument-string" | "argument-tag" | "argument-term")
            })
            .collect();
        let mut args = Vec::new();
        let feature = |name: &str| {
            name.starts_with(|c: char| c.is_ascii_alphabetic())
                && name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
        };
        for part in &parts {
            if name == "include" {
                if rule_name(part) != "argument-string" {
                    return Err(self.error(node, "%include takes one quoted path"));
                }
                let text = self.source_text(self.token(part)?);
                args.push(
                    text.strip_prefix('"')
                        .and_then(|s| s.strip_suffix('"'))
                        .ok_or_else(|| self.error(node, "include path requires double quotes"))?
                        .to_string(),
                );
            } else {
                if rule_name(part) != "argument-word" {
                    return Err(self.error(node, "directive requires name operands"));
                }
                args.push(self.value(self.token(part)?).into());
            }
        }
        let valid = match name {
            "include" => args.len() == 1,
            "stage" | "extend-stage" | "redefine-stage" => {
                matches!(&args[..], [name] if crate::dom::is_classifier_name(name))
            }
            "features" => !args.is_empty() && args.iter().all(|name| feature(name)),
            "ambiguity-resolution" => matches!(
                args.iter().map(String::as_str).collect::<Vec<_>>().as_slice(),
                ["greedy" | "lazy" | "late-elision"] | ["greedy" | "lazy" | "late-elision", "elision-only"]
            ),
            _ => false,
        };
        if !valid {
            return Err(self.error(node, "directive has the wrong operands"));
        }
        let conditions = match Self::rules(node, "conditions-clause").next() {
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
        Ok(Directive { name: name.into(), args, conditions, at: self.at(token) })
    }

    fn rule(&self, node: &'a Node) -> R<RuleDef> {
        let definer = self.token(self.one(node, "definer")?)?;
        let name_token = self.token(self.one(node, "rule-name")?)?;
        if !self.unicode.is_emoji_name(self.value(name_token))
            && !self.value(name_token).starts_with(|c: char| c.is_ascii_lowercase())
        {
            return Err(self.error(name_token, "a rule name starts with a lowercase letter or uses one eligible emoji"));
        }
        let op = match self.value(definer) {
            "%redefine-rule" => Op::Redefine,
            "%extend-rule" => Op::Extend,
            "%rule" => Op::Define,
            _ => return Err(self.error(definer, "unknown rule definer")),
        };
        let mut flags = Vec::new();
        if let Some(list) = Self::rules(node, "rule-flags").next() {
            if op == Op::Extend {
                return Err(self.error(list, "%extend-rule accepts no flags"));
            }
            for flag in self.some(list, "rule-flag", 1)? {
                let name = self.value(self.token(flag)?);
                if !matches!(name, "leftmost-longest" | "fewest") {
                    return Err(self.error(flag, format!("unknown rule flag {name}")));
                }
                if flags.iter().any(|known| known == name) {
                    return Err(self.error(flag, format!("duplicate rule flag {name}")));
                }
                if !flags.is_empty() {
                    return Err(self.error(flag, "a rule accepts only one flag"));
                }
                flags.push(name.to_string());
            }
        }
        // The parts of a definition are read in the order written: the
        // body, then its clauses in their fixed order, and the checks of the
        // whole definition last (§9).
        let tags = match Self::rules(node, "tags-clause").next() {
            Some(clause) => Some(self.constituent_tags(clause)?),
            None => None,
        };
        let strings = self.channels(node)?;
        let mut alternatives = Vec::new();
        let body = Self::rules(node, "body")
            .next()
            .or_else(|| Self::rules(node, "headed-body").next())
            .ok_or_else(|| self.shape_error(node, "body"))?;
        let alternatives_nodes = match Self::rules(body, "ranked-alternative").next() {
            Some(ranked) => vec![ranked],
            None => self.some(body, "alternative", 1)?,
        };
        for alternative in alternatives_nodes {
            alternatives.push(self.alternative(alternative)?);
        }
        // Each condition of the list is one condition (§9).
        let mut conditions = Vec::new();
        if let Some(clause) = Self::rules(node, "conditions-clause").next() {
            for implication in self.some(clause, "implication", 1)? {
                conditions.push(self.implication(implication)?);
            }
        }
        let emit = match Self::rules(node, "emits-clause").next() {
            Some(clause) => Some(self.emission(clause)?),
            None => None,
        };
        let mut rule = RuleDef {
            deferred_emission: None,
            name: self.value(name_token).to_string(),
            op,
            flags,
            tags,
            strings,
            alternatives,
            emit,
            conditions,
            erased: Self::rules(node, "erased-clause").next().is_some(),
            at: self.at(definer),
        };
        flatten_groups(&mut rule);
        if rule.erased
            && (rule.emit.is_some()
                || rule.strings.value.is_some()
                || rule.strings.image.is_some()
                || rule.alternatives.iter().any(|a| a.strings.value.is_some() || a.strings.image.is_some()))
        {
            return Err(self.error(definer, "an erased definition cannot have an emission or recipe"));
        }
        if let Some((message, at)) = crate::boundary::definition_problem(&rule) {
            let (line, column) = at.unwrap_or(rule.at);
            return Err(Error::grammar(message).at(line, column));
        }
        // The definition is checked as a whole once it is read (§9).
        if let Some(problem) = crate::clauses::definition_problem(&rule) {
            if self.defer_emission
                && crate::dom::deferred_emission_problem(&problem)
                && rule.alternatives.iter().any(|a| crate::ranked::contains_ranked(&a.expr))
            {
                rule.deferred_emission = Some(problem);
            } else {
                return Err(self.error(definer, problem));
            }
        }
        Ok(rule)
    }

    fn guard(&self, node: &'a Node, gates_only: bool) -> R<Guard> {
        let text = self.value(self.token(node)?);
        let (text, kind) = match text.strip_suffix('!') {
            Some(text) => (text, FeatureKind::Warning),
            None => (text.strip_suffix('?').ok_or_else(|| self.error(node, "invalid guard"))?, FeatureKind::Gate),
        };
        let (feature, negated) = match text.strip_prefix('¬') {
            Some(feature) => (feature, true),
            None => (text, false),
        };
        if kind == FeatureKind::Warning && (gates_only || negated) {
            return Err(self.error(node, "a warning cannot be negated or used on a classifier entry"));
        }
        if !feature.starts_with(|c: char| c.is_ascii_alphabetic())
            || !feature.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
        {
            return Err(self.error(node, "invalid feature name"));
        }
        Ok(Guard { feature: feature.into(), kind, negated })
    }

    fn alternative(&self, node: &'a Node) -> R<Alternative> {
        // A guard's token is its text: `f?` or `¬f?` for a gate, `f!`
        // for a warning (§9).
        let guards = Self::rules(node, "guard").map(|guard| self.guard(guard, false)).collect::<R<_>>()?;
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
        if let Some(&twice) = crate::clauses::duplicate_captures(&expr).first() {
            let capture = self.captures.borrow()[twice];
            let name = self.value(self.token(capture)?).trim_start_matches('$').to_string();
            return Err(
                self.error(capture, format!("the capture ${name} is read twice by one production of the alternative"))
            );
        }
        let tags = match Self::rules(node, "alternative-tags").next() {
            Some(tags) => Some(self.constituent_tags(tags)?),
            None => None,
        };
        Ok(Alternative { guards, expr, tags, strings: self.channels(node)?, ranked_locations: Default::default() })
    }

    /// A rule's or an alternative's tags, which say what the constituent's
    /// tags are and so cannot read them: `tags($)` and `classes($)` are
    /// errors anywhere in them, guards included (§9), reported at the
    /// clause.
    fn constituent_tags(&self, node: &'a Node) -> R<Term> {
        let source = self.one(node, "term")?;
        if self.own_tags_in(source)? {
            return Err(self.error(node, "a constituent cannot read the tags it defines"));
        }
        let term = self.tag_term(source)?;
        if reads_own_tags(&term) {
            return Err(self.error(node, "a constituent's tags cannot be made of its own tags, tags($) or classes($)"));
        }
        Ok(term)
    }

    fn first_engine_literal(&self, root: &'a Node) -> R<Option<&'a Node>> {
        let mut pending = vec![root];
        while let Some(node) = pending.pop() {
            if rule_name(node) == "pattern-literal" {
                continue;
            }
            if rule_name(node) == "tag" {
                let token = self.token(node)?;
                if crate::dom::is_engine_tag(self.value(token)) {
                    return Ok(Some(token));
                }
            }
            pending.extend(node.children.iter().rev());
        }
        Ok(None)
    }

    fn own_tags_in(&self, root: &'a Node) -> R<bool> {
        let mut pending = vec![root];
        while let Some(node) = pending.pop() {
            if rule_name(node) == "method" {
                let receiver = self.one(node, "method-receiver")?;
                let atom = self.one(receiver, "term-atom")?;
                let part = self.inner(atom, ATOMS)?;
                let selector = self.some(node, "method-selector", 1)?[0];
                let name = self.value(self.token(self.one(selector, "method-name")?)?);
                if rule_name(part) == "capture-reference"
                    && self.value(self.token(part)?) == "$"
                    && matches!(name, "tags" | "classes")
                    && Self::rules(selector, "arguments").next().is_none()
                {
                    return Ok(true);
                }
            }
            pending.extend(node.children.iter().rev());
        }
        Ok(false)
    }

    /// A whole term that must be a tag set: a constituent's or an item's
    /// tags (engine §10). A type error stands at the term.
    fn tag_term(&self, node: &'a Node) -> R<Term> {
        let (term, ty) = self.term(node, false)?;
        if let Some(problem) = expected_problem(ty, Type::Tags) {
            return Err(self.error(node, problem));
        }
        if let Some((_, index)) = crate::dom::engine_literals(&term).into_iter().min_by_key(|(_, index)| *index) {
            let mut literals = Vec::new();
            let mut pending = vec![node];
            while let Some(part) = pending.pop() {
                if matches!(rule_name(part), "pattern-literal" | "any-of") {
                    continue;
                }
                if rule_name(part) == "tag" {
                    let token = self.token(part)?;
                    if crate::dom::is_engine_tag(self.value(token)) {
                        literals.push(token);
                    }
                } else {
                    pending.extend(part.children.iter().rev());
                }
            }
            return Err(
                self.error(literals.get(index).copied().unwrap_or(node), "a tag clause cannot introduce an engine tag")
            );
        }
        Ok(term)
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
        let (mut term, ty) = self.typed(Frame::Term(TermFrame::new(node, argument)))?;
        flatten_term(&mut term);
        Ok((term, ty))
    }

    fn union(&self, node: &'a Node, argument: bool) -> R<(Term, Type)> {
        let (mut term, ty) = self.typed(Frame::Union(Joined::new(node, argument)))?;
        flatten_term(&mut term);
        Ok((term, ty))
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
            if let Some(ranked) = Self::rules(frame.node, "ranked-choice").next() {
                frame.node = ranked;
                frame.ranked = true;
            }
            frame.conjunctions = Some(self.some(frame.node, "conjunction", if frame.ranked { 2 } else { 1 })?);
        }
        if let Some(Val::Expr(expr)) = input {
            frame.parts.push(expr);
        }
        let conjunctions = frame.conjunctions.as_ref().expect("the conjunctions");
        match conjunctions.get(frame.parts.len()) {
            Some(&conjunction) => Ok(Step::Call(Frame::Conjunction(Conjunction::new(conjunction, false)))),
            None => Ok(Step::Done(Val::Expr(if frame.ranked {
                Expr::Ranked(std::mem::take(&mut frame.parts))
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
            return Ok(Step::Done(match (frame.capture.take(), value) {
                (Some(name), Val::Expr(expr)) => Val::Expr(Expr::Capture(name, Box::new(expr))),
                (_, value) => value,
            }));
        }
        let node = frame.node;
        let inner = self.inner(node, PRIMARIES)?;
        let token = || self.token(inner);
        Ok(match rule_name(inner) {
            "reference" | "tag" | "string-terminal" | "constant-reference" | "wildcard" | "range" => {
                Step::Done(Val::Expr(self.symbol(inner)?))
            }
            "tested" => Step::Call(Frame::Tested(Tested::new(inner))),
            "capture" => {
                // A capture stands anywhere but in braces or an elidable
                // optional (§3.5, §9), and its own form is checked before
                // what it wraps.
                if self.braces.get() > 0 {
                    return Err(self.error(
                        inner,
                        "a capture cannot stand inside braces, whose parts repeat: name the list as a rule, and capture that",
                    ));
                }
                if self.marked.get() > 0 {
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
                let name = self.value(capture).trim_start_matches('$').to_string();
                if !is_capture_name(&name) {
                    return Err(self.error(capture, "a capture's name is all lower case"));
                }
                let wrapped = self.inner(primary, PRIMARIES)?;
                if rule_name(wrapped) == "tested" {
                    let base = Self::rules(wrapped, "primary")
                        .next()
                        .map(|primary| self.inner(primary, PRIMARIES))
                        .transpose()?
                        .or_else(|| Self::parts(wrapped).into_iter().find(|part| PRIMARIES.contains(&rule_name(part))));
                    if base.is_some_and(|base| {
                        !matches!(
                            rule_name(base),
                            "reference" | "tag" | "string-terminal" | "constant-reference" | "wildcard" | "range"
                        )
                    }) {
                        return Err(self.error(capture, "a capture must wrap a single symbol"));
                    }
                }
                if !matches!(
                    rule_name(wrapped),
                    "reference" | "tag" | "string-terminal" | "constant-reference" | "wildcard" | "range" | "tested"
                ) {
                    return Err(self.error(capture, "a capture must wrap a single symbol"));
                }
                self.captures.borrow_mut().push(inner);
                frame.capture = Some(name);
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
    /// terminal itself, `=`-tested or not.
    fn resume_optional(&self, frame: &mut OptionalFrame<'a>, input: Option<Val>) -> R<Step<'a>> {
        if let Some(Val::Expr(expr)) = input {
            if frame.mark != Mark::Plain {
                self.marked.set(self.marked.get() - 1);
            }
            return Ok(Step::Done(Val::Expr(Expr::Optional(Box::new(expr), frame.mark))));
        }
        let node = frame.node;
        // Its required part first, then its markers (§9).
        let choice = self.one(node, "choice")?;
        let markers: Vec<&Node> = Self::tokens_of(node).filter(|token| self.value(token) == "+").collect();
        if let Some(second) = markers.get(1) {
            return Err(self.error(second, "an optional has one marker + at most"));
        }
        let Some(_) = markers.first() else {
            return Ok(Step::Call(Frame::Choice(Choice::new(choice))));
        };
        let form = || {
            self.error(
                node,
                "an elidable optional begins with its terminator, a name with a capital or ~name, written directly \
                 after the marker, and joins it to nothing with | or &",
            )
        };
        // One conjunction of one sequence, with no leading | or & either:
        // the terminator stands directly after the marker (§9).
        let conjunctions: Vec<&Node> = Self::rules(choice, "conjunction").collect();
        let leading = Self::tokens_of(choice).any(|token| self.value(token) == "|")
            || (conjunctions.len() == 1 && Self::tokens_of(conjunctions[0]).any(|token| self.value(token) == "&"));
        let sequences: Vec<&Node> = if conjunctions.len() == 1 && !leading {
            Self::rules(conjunctions[0], "sequence").collect()
        } else {
            Vec::new()
        };
        let primary = match sequences[..] {
            [sequence] => Self::rules(sequence, "primary").next(),
            _ => None,
        };
        let Some(primary) = primary else {
            return Err(form());
        };
        let head = self.inner(primary, PRIMARIES)?;
        let is_terminal = |symbol: &Node| {
            rule_name(symbol) == "tag"
                && Self::tokens_of(symbol).next().is_some_and(|token| is_capital(self.value(token)))
                || (rule_name(symbol) == "reference"
                    && Self::tokens_of(symbol).next().is_some_and(|token| is_capital(self.value(token))))
        };
        if rule_name(head) == "tested" {
            let base = Self::rules(head, "primary")
                .next()
                .map(|primary| self.inner(primary, PRIMARIES))
                .transpose()?
                .or_else(|| Self::parts(head).into_iter().find(|part| PRIMARIES.contains(&rule_name(part))));
            if !base.is_some_and(is_terminal) {
                return Err(form());
            }
        } else if !is_terminal(head) {
            return Err(form());
        }
        self.marked.set(self.marked.get() + 1);
        frame.mark = Mark::Elidable;
        Ok(Step::Call(Frame::Choice(Choice::new(choice))))
    }

    /// Braces: the item, its separator if a backslash has one, and a
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
            self.braces.set(self.braces.get() - 1);
            let item = frame.item.take().expect("the item");
            let separator = frame.separator.take().map(Box::new);
            return Ok(Step::Done(Val::Expr(Expr::Repeat(Box::new(item), separator, frame.chain))));
        }
        let node = frame.node;
        let found = Self::parts(node);
        let choices = self.some(node, "choice", 1)?;
        let place = |part: &Node| found.iter().position(|other| std::ptr::eq(*other, part)).unwrap_or(found.len());
        let markers: Vec<usize> = (0..found.len())
            .filter(|&index| found[index].kind == NodeKind::Token && self.value(found[index]) == "...")
            .collect();
        // Two markers are an error at the second, and a marker after the
        // separator is an error at that marker, whichever a reader meets
        // first.
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
        self.braces.set(self.braces.get() + 1);
        frame.chain = chain;
        let item = choices[0];
        frame.choices = choices;
        Ok(Step::Call(Frame::Choice(Choice::new(item))))
    }

    /// A reference other than `#` or a terminal, and one test on its own
    /// span (engine §2, §9). The syntax grammar reads a test after any
    /// primary, so that the reader can name the reason.
    fn resume_tested(&self, frame: &mut Tested<'a>, _: Option<Val>) -> R<Step<'a>> {
        let node = frame.node;
        let parts = Self::parts(node);
        let tests: Vec<_> =
            parts.iter().copied().filter(|part| matches!(rule_name(part), "tag-test" | "value-test")).collect();
        if tests.is_empty() {
            return Err(self.shape_error(node, "test"));
        }
        let base = if let Some(primary) = Self::rules(node, "primary").next() {
            self.inner(primary, PRIMARIES)?
        } else {
            parts
                .iter()
                .copied()
                .find(|part| PRIMARIES.contains(&rule_name(part)))
                .ok_or_else(|| self.shape_error(node, "primary"))?
        };
        let valid = matches!(
            rule_name(base),
            "reference" | "tag" | "string-terminal" | "constant-reference" | "wildcard" | "range"
        );
        let mut tags = false;
        let mut value = false;
        for test in &tests {
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
        let mut expr = self.symbol(base)?;
        for test in tests {
            let (op, operand) = if rule_name(test) == "tag-test" {
                let mut requirements = Vec::new();
                for requirement in Self::rules(test, "tag-requirement") {
                    let operand = self.one(requirement, "test-operand")?;
                    let part = self.inner(operand, ATOMS)?;
                    let value = match rule_name(part) {
                        "tag" => Term::Tag(self.tag_of(self.token(part)?)?),
                        "constant-reference" => {
                            let term = self.constant_reference(self.token(part)?)?;
                            if matches!(&term, Term::Const(name, _) if crate::dom::engine_scalar(name).is_some()) {
                                return Err(self.error(operand, "a tag test requires a tag-set constant"));
                            }
                            term
                        }
                        _ => return Err(self.error(operand, "a tag requirement requires a tag or tag-set constant")),
                    };
                    let negated = Self::tokens_of(requirement).any(|token| self.value(token) == "¬");
                    requirements.push(Arg::Term(if negated {
                        Term::Call("forbid".into(), vec![Arg::Term(value)])
                    } else {
                        value
                    }));
                }
                ("tags".into(), Term::Call("requirements".into(), requirements))
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
            let inner = self.inner(frame.node, &TERMS)?;
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
                Ok(Step::Call(match Self::rules(inner, "union").next() {
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
            let parts: Vec<&Node> = Self::rules(frame.node, "intersection").collect();
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
            if matches!(ty, Type::Span) && !self.feature_context.get() {
                return Err(self.error(frame.node, "set operators require sets or patterns"));
            }
        }
        let parts = frame.parts.as_ref().expect("the parts");
        if let Some(&part) = parts.get(frame.items.len()) {
            return Ok(Step::Call(Frame::Intersection(Joined::new(part, false))));
        }
        let mut operators: Vec<&str> = Self::tokens_of(frame.node)
            .map(|token| self.value(token))
            .filter(|text| matches!(*text, "∪" | "∖"))
            .collect();
        // A leading ∪ is a separator, not an operator.
        while operators.len() >= parts.len() {
            operators.remove(0);
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
            let atoms: Vec<&Node> = Self::rules(frame.node, "concatenation").collect();
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
            if matches!(ty, Type::Span) && !self.feature_context.get() {
                return Err(self.error(frame.node, "set operators require sets or patterns"));
            }
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
            let atoms: Vec<&Node> = Self::rules(frame.node, "term-atom").collect();
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
        let mut args = Vec::new();
        for mut term in std::mem::take(&mut frame.items) {
            if let Term::Call(name, nested) = &mut term {
                if name == "concat" {
                    args.append(nested);
                    continue;
                }
            }
            args.push(Arg::Term(term));
        }
        Ok(Step::Done(Val::Term(Term::Call("concat".into(), args), Type::String)))
    }

    fn resume_atom(&self, frame: &mut Atom<'a>, input: Option<Val>) -> R<Step<'a>> {
        if let Some(value) = input {
            // A call, which is no span where a value is due, or a term in
            // parentheses, which is its term.
            return Ok(Step::Done(value));
        }
        let node = frame.node;
        let inner = self.inner(node, ATOMS)?;
        let token = || self.token(inner);
        let typed = |term: Term, ty: Type| Ok(Step::Done(Val::Term(term, ty)));
        match rule_name(inner) {
            // A span may stand in parentheses where a span is due.
            "term" => Ok(Step::Call(Frame::Term(TermFrame::new(inner, frame.argument)))),
            "pattern-literal" => {
                let part = self.pattern_literal_part(inner)?;
                let c = self.pattern_children(part, 0)?;
                let p = as_pattern(c);
                if let Some(problem) = p.problem() {
                    return Err(self.error(inner, problem));
                }
                typed(Term::Pattern(Box::new(p)), Type::Pattern)
            }
            "string" => typed(self.string_term(token()?)?, Type::String),
            "tag" => {
                let token = token()?;
                let tag = self.tag_of(token)?;
                typed(Term::Tag(tag), Type::Tags)
            }
            "tag-run" | "string-run" => {
                if self.in_recipe.get() && inner.rule.as_deref() == Some("string-run") {
                    return Err(self.error(inner, "juxtaposed recipe strings require ++, use ++ between string atoms"));
                }
                let before = node.span.start.checked_sub(1).and_then(|i| self.tokens.get(i));
                let after = self.tokens.get(node.span.end);
                if before.into_iter().chain(after).any(|t| matches!(t.value.as_str(), "∩" | "∖")) {
                    return Err(self.error(inner, "a tag run beside intersection or difference requires parentheses"));
                }
                let mut items = Vec::new();
                let strings = inner.rule.as_deref() == Some("string-run");
                for tag in self.some(inner, if strings { "string" } else { "tag" }, 2)? {
                    items.push(if strings {
                        self.string_term(self.token(tag)?)?
                    } else {
                        Term::Tag(self.tag_of(self.token(tag)?)?)
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
                    return Err(
                        self.error(inner, format!("{name} names a rule, which is not a value; ~{name} is the tag"))
                    );
                }
                typed(Term::Tag(name.to_string()), Type::Tags)
            }
            "empty-set" => typed(Term::EmptySet, Type::Set),
            // The reader knows no constant's type (§9).
            "constant-reference" => {
                let term = self.constant_reference(token()?)?;
                let ty = if matches!(&term, Term::Const(name, _) if crate::dom::engine_scalar(name).is_some()) {
                    Type::String
                } else {
                    Type::Any
                };
                typed(term, ty)
            }
            "capture-reference" => {
                let name = self.value(token()?).trim_start_matches('$').to_string();
                if let Some(closed) = self.closed_for.get() {
                    return Err(self.error(inner, format!("{closed} is a closed term, and holds no capture")));
                }
                typed(Term::Capture(name), Type::Span)
            }
            "method" => Ok(Step::Call(Frame::Method(MethodFrame::new(inner, false)))),
            other => Err(self.unknown(node, other)),
        }
    }

    fn pattern_literal_part(&self, node: &'a Node) -> R<&'a Node> {
        Self::parts(node)
            .into_iter()
            .find(|part| matches!(rule_name(part), "pattern-union" | "pattern-atom"))
            .ok_or_else(|| self.shape_error(node, "pattern-union or pattern-atom"))
    }

    /// Constructor parts determine the base, independently of delimiters.
    fn pattern_atom_base(&self, node: &'a Node) -> R<&'a Node> {
        Self::parts(node)
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
                        | "pattern-literal"
                        | "pattern-union"
                ) || part.kind == NodeKind::Token
                    && (self.unicode.is_emoji_name(self.value(part))
                        || self.value(part).starts_with('_')
                        || self.value(part).as_bytes().first().is_some_and(u8::is_ascii_alphabetic))
            })
            .ok_or_else(|| self.shape_error(node, "pattern atom"))
    }

    fn pattern_path_token(&self, node: &'a Node) -> R<&'a Node> {
        Self::tokens_of(node)
            .find(|token| matches!(self.value(token), "⋮" | "⋰" | "⋱"))
            .ok_or_else(|| self.shape_error(node, "path token"))
    }

    fn pattern_children(&self, root: &'a Node, _depth: usize) -> R<crate::patterns::Children> {
        use crate::patterns::{Children as C, Pattern as P};
        let mut values: std::collections::HashMap<*const Node, C> = std::collections::HashMap::new();
        let mut pending = vec![(root, false)];
        while let Some((node, ready)) = pending.pop() {
            let kind = rule_name(node);
            if !ready && kind == "pattern-atom" {
                let base = self.pattern_atom_base(node)?;
                let name = if matches!(rule_name(base), "name" | "reference") {
                    Some(self.token(base)?)
                } else if base.kind == NodeKind::Token {
                    Some(base)
                } else {
                    None
                };
                let testable = matches!(
                    rule_name(base),
                    "tag" | "string" | "string-terminal" | "wildcard" | "range" | "constant-reference"
                ) || name
                    .is_some_and(|name| is_capital(self.value(name)) || self.value(name).starts_with('_'));
                self.pattern_test_nodes(node, testable)?;
            }
            let children: Vec<&Node> = match kind {
                "pattern-union" => {
                    let operands = self.some(node, "pattern-intersection", 1)?;
                    let operators =
                        Self::tokens_of(node).filter(|token| matches!(self.value(token), "∪" | "∖")).count();
                    if operators < operands.len() - 1 {
                        return Err(self.shape_error(node, "union operators"));
                    }
                    operands
                }
                "pattern-intersection" => self.some(node, "pattern-sequence", 1)?,
                "pattern-sequence" => self.some(node, "pattern-item", 1)?,
                "pattern-item" => Self::parts(node)
                    .into_iter()
                    .filter(|part| {
                        matches!(
                            rule_name(part),
                            "pattern-atom" | "pattern-brackets" | "pattern-repeat" | "pattern-path"
                        )
                    })
                    .take(1)
                    .collect(),
                "pattern-brackets" => vec![self.one(node, "pattern-union")?],
                "pattern-repeat" => self.some(node, "pattern-union", 1)?.into_iter().take(2).collect(),
                "pattern-path" => {
                    self.pattern_path_token(node)?;
                    vec![self.one(node, "pattern-atom")?]
                }
                "pattern-atom" => {
                    let base = self.pattern_atom_base(node)?;
                    match rule_name(base) {
                        "pattern-union" => vec![base],
                        "pattern-literal" => vec![self.pattern_literal_part(base)?],
                        _ => Vec::new(),
                    }
                }
                _ => return Err(self.unknown(node, kind)),
            };
            if !ready {
                pending.push((node, true));
                pending.extend(children.iter().rev().map(|&n| (n, false)));
                continue;
            }
            let mut parts = children
                .into_iter()
                .map(|n| values.remove(&(n as *const Node)).expect("finished pattern child"))
                .collect::<Vec<_>>();
            let result = match kind {
                "pattern-union" | "pattern-intersection" => {
                    if parts.len() == 1 {
                        parts.pop().unwrap()
                    } else {
                        let mut xs = parts.into_iter();
                        let mut p = as_pattern(xs.next().ok_or_else(|| self.shape_error(node, "pattern operand"))?);
                        let ops = Self::tokens_of(node)
                            .map(|t| self.value(t))
                            .filter(|op| matches!(*op, "∪" | "∖"))
                            .collect::<Vec<_>>();
                        for (i, x) in xs.enumerate() {
                            p = if kind == "pattern-intersection" {
                                P::Intersection(vec![p, as_pattern(x)])
                            } else if ops.get(i) == Some(&"∖") {
                                P::Difference(Box::new(p), Box::new(as_pattern(x)))
                            } else {
                                let mut operands = match p {
                                    P::Union(items) => items,
                                    p => vec![p],
                                };
                                match as_pattern(x) {
                                    P::Union(items) => operands.extend(items),
                                    p => operands.push(p),
                                }
                                P::Union(operands)
                            };
                        }
                        C::Node(Box::new(p))
                    }
                }
                "pattern-sequence" => {
                    let mut flat = Vec::new();
                    for c in parts {
                        match c {
                            C::Sequence(xs) => flat.extend(xs),
                            c => flat.push(c),
                        }
                    }
                    if flat.len() == 1 {
                        flat.pop().unwrap()
                    } else {
                        C::Sequence(flat)
                    }
                }
                "pattern-item" => {
                    if let Some(part) = parts.pop() {
                        part
                    } else if Self::tokens_of(node).any(|token| self.value(token) == "⋯") {
                        C::Siblings
                    } else {
                        return Err(self.shape_error(node, "pattern item or sibling ellipsis"));
                    }
                }
                "pattern-atom" => {
                    let first = self.pattern_atom_base(node)?;
                    if !parts.is_empty() {
                        let c = parts.pop().unwrap();
                        if rule_name(first) == "pattern-literal" {
                            C::Node(Box::new(as_pattern(c)))
                        } else {
                            c
                        }
                    } else {
                        let (pattern, tested) = match rule_name(first) {
                            "tag" => (P::Terminal(self.tag_of(self.token(first)?)?, self.first(first)), true),
                            "string" => (P::Literal(self.string_term(self.token(first)?)?, self.first(first)), true),
                            "string-terminal" => {
                                let symbol = self.symbol(first)?;
                                let Expr::Literal(term) = &symbol else { unreachable!() };
                                (P::Literal(term.clone(), self.first(first)), true)
                            }
                            "wildcard" => (P::Wildcard(self.first(first)), true),
                            "range" => {
                                let symbol = self.symbol(first)?;
                                let Expr::ScalarRange(a, b) = &symbol else { unreachable!() };
                                (P::Range(a.clone(), b.clone(), self.first(first)), true)
                            }
                            "constant-reference" => {
                                let token = self.token(first)?;
                                let term = self.constant_reference(token)?;
                                if self.value(token).starts_with("$_") {
                                    (P::Literal(term, self.at(token)), true)
                                } else {
                                    (P::Constant(self.value(token)[1..].into(), self.at(token)), true)
                                }
                            }
                            _ if first.kind == NodeKind::Token || matches!(rule_name(first), "name" | "reference") => {
                                let token = if first.kind == NodeKind::Token { first } else { self.token(first)? };
                                let name = self.value(token);
                                if is_capital(name) || crate::dom::is_engine_tag(name) {
                                    (P::Terminal(name.into(), self.at(token)), true)
                                } else {
                                    (P::Name(name.into(), self.at(token)), false)
                                }
                            }
                            _ => return Err(self.shape_error(node, "pattern atom")),
                        };
                        C::Node(Box::new(self.pattern_tests(node, pattern, tested)?))
                    }
                }
                "pattern-brackets" => C::Optional(Box::new(parts.pop().unwrap())),
                "pattern-repeat" => {
                    let mut xs = parts.into_iter();
                    let item = xs.next().ok_or_else(|| self.shape_error(node, "pattern repeat"))?;
                    C::Repeat(Box::new(item), xs.next().map(Box::new))
                }
                "pattern-path" => {
                    // The path token can precede or follow the atom. Ignore
                    // delimiter tokens that are not constructor parts.
                    let operator = self.value(self.pattern_path_token(node)?);
                    C::Node(Box::new(P::Path(
                        match operator {
                            "⋮" => "descendant",
                            "⋰" => "first",
                            _ => "last",
                        }
                        .to_owned(),
                        Box::new(as_pattern(parts.pop().unwrap())),
                    )))
                }
                _ => unreachable!(),
            };
            if let Some(problem) = as_pattern(result.clone()).problem() {
                return Err(self.error(node, problem));
            }
            values.insert(node as *const Node, result);
        }
        Ok(values.remove(&(root as *const Node)).expect("finished pattern"))
    }

    /// Inspect the target and complete test sequence before any base conversion.
    fn pattern_test_nodes(&self, node: &'a Node, testable: bool) -> R<Vec<&'a Node>> {
        let tests: Vec<_> =
            Self::parts(node).into_iter().filter(|part| matches!(rule_name(part), "tag-test" | "value-test")).collect();
        let mut tags = false;
        let mut value = false;
        for test in &tests {
            let tag = rule_name(test) == "tag-test";
            if !testable || value || tag && tags {
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
            let (op, operand) = if rule_name(test) == "tag-test" {
                let mut requirements = Vec::new();
                for requirement in Self::rules(test, "tag-requirement") {
                    let operand = self.one(requirement, "test-operand")?;
                    let part = self.inner(operand, ATOMS)?;
                    let term = match rule_name(part) {
                        "tag" => Term::Tag(self.tag_of(self.token(part)?)?),
                        "constant-reference" => {
                            let term = self.constant_reference(self.token(part)?)?;
                            if matches!(&term, Term::Const(name, _) if crate::dom::engine_scalar(name).is_some()) {
                                return Err(self.error(operand, "a tag test requires a tag-set constant"));
                            }
                            term
                        }
                        _ => return Err(self.error(operand, "invalid tag requirement")),
                    };
                    let negative = Self::tokens_of(requirement).any(|token| self.value(token) == "¬");
                    requirements.push(Arg::Term(if negative {
                        Term::Call("forbid".into(), vec![Arg::Term(term)])
                    } else {
                        term
                    }));
                }
                ("tags".into(), Term::Call("requirements".into(), requirements))
            } else {
                let op = self.operator(self.token(self.one(test, "test")?)?).into();
                let operand = self.one(test, "test-operand")?;
                (op, self.value_test_operand(operand)?)
            };
            pattern = crate::patterns::Pattern::Test(op, operand, Box::new(pattern));
        }
        Ok(pattern)
    }

    fn resume_method(&self, frame: &mut MethodFrame<'a>, input: Option<Val>) -> R<Step<'a>> {
        if frame.selectors.is_none() {
            let receiver = self.one(frame.node, "method-receiver")?;
            let atom = self.one(receiver, "term-atom")?;
            frame.selectors = Some(self.some(frame.node, "method-selector", 1)?);
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
        let selectors = frame.selectors.as_ref().unwrap();
        let selector = selectors[frame.index];
        let name = self.value(self.token(self.one(selector, "method-name")?)?);
        if frame.arguments.is_none() {
            frame.arguments = Some(match Self::rules(selector, "arguments").next() {
                Some(arguments) => self.some(arguments, "argument", 1)?,
                None => Vec::new(),
            });
        }
        if let Some(&argument) = frame.arguments.as_ref().unwrap().get(frame.args.len()) {
            return Ok(Step::Call(Frame::Argument(ArgumentFrame { node: argument })));
        }
        if let Some(arguments) = Self::rules(selector, "arguments").next() {
            let expected = if matches!(name, "matches" | "begins" | "followed-by" | "preceded-by") { "|" } else { "," };
            if Self::parts(arguments).iter().any(|part| part.kind == NodeKind::Token && self.value(part) != expected) {
                return Err(self.error(arguments, "invalid method argument separator"));
            }
        }
        let (receiver, ty) = frame.receiver.take().unwrap();
        let span = self.feature_context.get() || ty == Type::Span;
        let string = self.feature_context.get() || matches!(ty, Type::Span | Type::String | Type::Any);
        let bare = self.feature_context.get() || matches!(&receiver, Term::Capture(_));
        let arguments = &frame.args[..];
        let emitted_receiver = matches!(&receiver, Term::Call(name, _) if name == "emitted");
        let valid = if emitted_receiver {
            matches!((name, arguments), ("value" | "image", []))
        } else {
            match (name, arguments) {
                (
                    "value"
                    | "image"
                    | "source-text"
                    | "decomposed-source-text"
                    | "first-token"
                    | "tokens-after-first"
                    | "last-token"
                    | "onward"
                    | "following-tokens"
                    | "classes"
                    | "starts-input"
                    | "ends-input"
                    | "tags",
                    [],
                ) => span,
                ("without-elision" | "verbatim-text" | "emitted", []) => bare,
                ("tags", [Arg::Rule(_)]) => span,
                ("matches" | "begins", args) => {
                    span && !args.is_empty()
                        && args
                            .iter()
                            .all(|a| matches!(a, Arg::Rule(_)) || matches!(a,Arg::Term(Term::Tag(n)) if is_capital(n)))
                }
                ("ngrams", [Arg::Integer(n)]) => string && crate::dom::valid_integer(n),
                ("without-elision-except", [Arg::Rule(_)]) => bare,
                ("followed-by" | "preceded-by", args) => {
                    bare && !args.is_empty()
                        && args.iter().all(|arg| {
                            matches!(arg, Arg::Rule(_)) || matches!(arg, Arg::Term(Term::Tag(name)) if is_capital(name))
                        })
                }
                ("split", [Arg::Term(_)]) => {
                    string
                        && (self.feature_context.get()
                            || matches!(frame.types.first(), Some(Some(Type::String | Type::Span | Type::Any))))
                }
                ("classify", [Arg::Rule(classifier)]) => string && is_classifier_name(classifier),
                _ => false,
            }
        };
        if !valid {
            let hint = if name == "without-elision" {
                "; write $x.without-elision.onward for an extended restored query"
            } else if name == "without-elision-except" {
                "; write $x.without-elision-except(F).onward for an extended restored query"
            } else {
                ""
            };
            return Err(
                self.error(frame.node, format!(".{name} has an unknown name or invalid receiver or arguments{hint}"))
            );
        }
        if !self.in_recipe.get() && matches!(name, "verbatim-text" | "emitted") {
            return Err(self.error(frame.node, format!(".{name} is allowed only in a recipe")));
        }
        if let Some(closed) = self.closed_for.get().filter(|_| name != "split" && name != "ngrams") {
            return Err(self.error(frame.node, format!("{closed} cannot read .{name}")));
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
        let value =
            if matches!(name, "starts-input" | "ends-input" | "followed-by" | "preceded-by" | "matches" | "begins") {
                if !frame.condition || !last {
                    return Err(self.error(frame.node, "a predicate method cannot supply a value"));
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
                        },
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
                        } else {
                            Cond::Begins(receiver, targets)
                        }
                    }
                })
            } else {
                if last && frame.condition {
                    return Err(self.error(frame.node, "a condition requires a predicate method"));
                }
                let alias = crate::dom::method_alias(name);
                Val::Term(Term::Call(alias.into(), args), call_type(alias))
            };
        if last {
            return Ok(Step::Done(value));
        }
        let Val::Term(term, ty) = value else { unreachable!() };
        frame.receiver = Some((term, ty));
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
        if let Some(integer) = Self::rules(frame.node, "integer").next() {
            let digits = self.value(self.token(integer)?);
            if !crate::dom::valid_integer(digits) {
                return Err(self.error(integer, "an integer argument is positive without leading zeros"));
            }
            return Ok(Step::Done(Val::Arg(Arg::Integer(digits.into()), None)));
        }
        let union = first_of_rule(frame.node, "union").ok_or_else(|| self.shape_error(frame.node, "term"))?;
        if let Some(rule) = self.rule_name_in(union) {
            return Ok(Step::Done(Val::Arg(Arg::Rule(rule), None)));
        }
        Ok(Step::Call(Frame::Union(Joined::new(union, true))))
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
            if let Some(consequent) = Self::rules(frame.node, "implication").next() {
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
    /// rule is read (`flatten_groups`), in one walk, since folding it here
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
                    let capture = self.one(inner, "capture-reference")?;
                    let right = self.one(inner, "union")?;
                    if let Some(name) = first_of_rule(right, "name").or_else(|| first_of_rule(right, "tag")) {
                        if right.span.end - right.span.start == 1 {
                            let at = name;
                            let name = self.value(self.token(name)?);
                            return Err(self.error(
                                at,
                                format!("tree comparison requires a pattern; write #({name}), not {name}"),
                            ));
                        }
                    }
                    frame.op = self.operator(self.token(self.one(inner, "tree-comparator")?)?).to_owned();
                    frame.left = Some((
                        Term::Capture(self.value(self.token(capture)?).trim_start_matches('$').to_owned()),
                        Type::Span,
                    ));
                    Step::Call(Frame::Union(Joined::new(right, false)))
                }
                "comparison" => {
                    let operands = self.some(inner, "union", 2)?;
                    let comparator = self.one(inner, "comparator")?;
                    frame.op = self.operator(self.token(comparator)?).to_string();
                    frame.right = Some(operands[1]);
                    Step::Call(Frame::Union(Joined::new(operands[0], false)))
                }
                "negation" => Step::Call(Frame::Condition(ConditionFrame::new(self.one(inner, "condition")?))),
                "presence" => {
                    let token = self.token(inner)?;
                    Step::Done(Val::Cond(Cond::Captured(self.value(token).trim_start_matches('$').to_string())))
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
                if let Some(problem) =
                    comparison_problem(&frame.op, left_type, ty).filter(|_| !self.feature_context.get())
                {
                    return Err(self.error(inner, problem));
                }
                Ok(Step::Done(Val::Cond(Cond::Compare(std::mem::take(&mut frame.op), left, term))))
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
            "reference" => {
                let token = self.token(node)?;
                let name = self.value(token);
                if name.starts_with('_') {
                    self.tag_of(token)?;
                }
                Ok(Expr::Ref(name.into()))
            }
            "tag" => Ok(Expr::Ref(self.tag_of(self.token(node)?)?)),
            "constant-reference" => Ok(Expr::Literal(self.constant_reference(self.token(node)?)?)),
            "wildcard" => Ok(Expr::Property("Any".into())),
            "string-terminal" => {
                let parts = Self::parts(node);
                let part = parts
                    .iter()
                    .find(|p| matches!(rule_name(p), "string" | "constant-reference"))
                    .ok_or_else(|| self.shape_error(node, "string operand"))?;
                Ok(Expr::Literal(self.string_operand(part)?))
            }
            "range" => {
                let parts: Vec<_> = Self::parts(node)
                    .into_iter()
                    .filter(|p| matches!(rule_name(p), "string" | "constant-reference"))
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
                    Term::Const(n, _) => crate::dom::engine_scalar(n),
                    _ => None,
                };
                if matches!(&left, Term::Str(_)) && scalar(&left).is_none()
                    || matches!(&right, Term::Str(_)) && scalar(&right).is_none()
                {
                    return Err(self.error(node, "range endpoints must be single scalars"));
                }
                if let (Some(a), Some(b)) = (scalar(&left), scalar(&right)) {
                    if a > b {
                        return Err(self.error(node, "range starts above its end"));
                    }
                }
                Ok(Expr::ScalarRange(left, right))
            }
            _ => Err(self.unknown(node, rule_name(node))),
        }
    }

    fn value_test_operand(&self, operand: &'a Node) -> R<Term> {
        let part = self.inner(operand, ATOMS)?;
        if !matches!(rule_name(part), "string" | "constant-reference") {
            return Err(self.error(operand, "a value test requires a string literal or constant"));
        }
        self.string_operand(part)
    }

    fn string_operand(&self, node: &'a Node) -> R<Term> {
        let token = self.token(node)?;
        match rule_name(node) {
            "string" => self.string_term(token),
            "constant-reference" => self.constant_reference(token),
            _ => Err(self.error(node, "a string literal or constant is required")),
        }
    }

    fn constant_reference(&self, token: &'a Node) -> R<Term> {
        let name = self.value(token).strip_prefix('$').unwrap_or("");
        if !(crate::dom::is_constant_name(name) || crate::dom::engine_scalar(name).is_some()) {
            return Err(self.error(token, "invalid constant name or scalar"));
        }
        Ok(Term::Const(name.into(), self.at(token)))
    }

    fn string_term(&self, token: &'a Node) -> R<Term> {
        let text = self.value(token);
        let Some(body) = text.strip_prefix('"').and_then(|s| s.strip_suffix('"')) else {
            return Err(self.error(token, "a string requires double quotes"));
        };
        Ok(Term::Str(body.into()))
    }

    fn channels(&self, node: &'a Node) -> R<Channels> {
        let mut channels = Channels::default();
        for (name, target, at) in [
            ("value-clause", &mut channels.value, &mut channels.value_at),
            ("image-clause", &mut channels.image, &mut channels.image_at),
        ] {
            if let Some(clause) = Self::rules(node, name).next() {
                let recipe = self.one(clause, "recipe")?;
                *at = Some(self.first(recipe));
                let mut atoms = Vec::new();
                self.in_recipe.set(true);
                for atom in self.some(recipe, "recipe-atom", 1)? {
                    if !atoms.is_empty() {
                        return Err(
                            self.error(atom, "juxtaposed recipe strings require ++, use ++ between string atoms")
                        );
                    }
                    if self.tokens[atom.span.clone()]
                        .iter()
                        .any(|t| matches!(t.value.as_str(), "(" | ")" | "∪" | "∩" | "∖" | "⟹"))
                    {
                        return Err(self.error(atom, "a recipe atom has no grouping or arguments"));
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
                            Term::Str(_) | Term::Const(..) => true,
                            Term::Union(_) => {
                                return Err(self
                                    .error(atom, "juxtaposed recipe strings require ++, use ++ between string atoms"))
                            }
                            Term::Call(name, args)
                                if matches!(
                                    name.as_str(),
                                    "value" | "image" | "text" | "decomposed-source-text" | "verbatim-text"
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
                *target = Some(Term::Call("concat".into(), atoms));
            }
        }
        Ok(channels)
    }

    fn tag_of(&self, token: &'a Node) -> R<String> {
        let text = self.value(token);
        if text.starts_with('_') {
            if !crate::dom::is_engine_tag(text) {
                return Err(self.error(token, "unknown engine tag"));
            }
        } else if !text.starts_with(|c: char| c.is_ascii_uppercase()) || !crate::tags::is_name(text) {
            return Err(self.error(token, "a user tag starts with an uppercase ASCII letter"));
        }
        Ok(text.into())
    }

    fn emission(&self, node: &'a Node) -> R<Vec<EmitItem>> {
        let nodes: Vec<_> = Self::rules(node, "emit-item").collect();
        if nodes.is_empty() {
            let tags = Self::rules(node, "emit-tags")
                .next()
                .or_else(|| Self::rules(node, "tags-clause").next())
                .map(|clause| self.tag_term(self.one(clause, "term")?))
                .transpose()?;
            return Ok(vec![EmitItem::Capture(
                "".into(),
                tags,
                Attachments { strings: self.channels(node)?, ..Default::default() },
            )]);
        }
        let mut items = Vec::new();
        let mut named = FxSet::default();
        for item in nodes {
            let target = self.one(item, "emit-target")?;
            let token = Self::tokens_of(target)
                .next()
                .ok_or_else(|| self.error(target, "an emission requires a capture or epsilon target"))?;
            let text = self.value(token);
            if !text.starts_with('$') && text != "ε" {
                return Err(self.error(target, "an emission target is a capture or ε"));
            }
            let mut before = Vec::new();
            let mut after = Vec::new();
            for (name, list) in [("emit-before", &mut before), ("emit-after", &mut after)] {
                for side in Self::rules(item, name) {
                    for capture in self.some(side, "capture-reference", 1)? {
                        let token = self.token(capture)?;
                        let name = self.value(token).strip_prefix('$').unwrap_or("");
                        if name.is_empty() {
                            return Err(self.error(side, "an attachment requires a named capture"));
                        }
                        if !named.insert(name.to_string()) {
                            return Err(self.error(node, "a repeated emission capture"));
                        }
                        list.push(name.to_string());
                    }
                }
            }
            let capture = text.strip_prefix('$');
            if (!before.is_empty() || !after.is_empty()) && (capture.is_none() || capture == Some("")) {
                return Err(self.error(item, "attachments require a named carrier"));
            }
            if let Some(name) = capture.filter(|name| !name.is_empty()) {
                if !named.insert(name.to_string()) {
                    return Err(self.error(node, "a repeated emission capture"));
                }
            }
            let tags = Self::rules(item, "emit-tags")
                .next()
                .map(|clause| self.tag_term(self.one(clause, "term")?))
                .transpose()?;
            let strings = self.channels(item)?;
            items.push(match capture {
                Some(name) => EmitItem::Capture(name.into(), tags, Attachments { before, after, strings }),
                None => EmitItem::Insert(tags, strings),
            });
        }
        Ok(items)
    }

    /// The bare name without a capital that a union is alone, if it is one.
    fn rule_name_in(&self, union: &'a Node) -> Option<String> {
        let mut union = union;
        loop {
            let [intersection] = Self::rules(union, "intersection").collect::<Vec<_>>()[..] else { return None };
            let [concatenation] = Self::rules(intersection, "concatenation").collect::<Vec<_>>()[..] else {
                return None;
            };
            let [atom] = Self::rules(concatenation, "term-atom").collect::<Vec<_>>()[..] else { return None };
            let inner = self.inner(atom, ATOMS).ok()?;
            match rule_name(inner) {
                "name" => {
                    let name = self.value(Self::tokens_of(inner).next()?);
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
    capture: Option<String>,
}

impl<'a> PrimaryFrame<'a> {
    fn new(node: &'a Node, whole: bool) -> Self {
        PrimaryFrame { node, whole, capture: None }
    }
}

struct OptionalFrame<'a> {
    node: &'a Node,
    mark: Mark,
}

impl<'a> OptionalFrame<'a> {
    fn new(node: &'a Node) -> Self {
        OptionalFrame { node, mark: Mark::Plain }
    }
}

struct Repetition<'a> {
    node: &'a Node,
    whole: bool,
    choices: Vec<&'a Node>,
    chain: Option<Chain>,
    item: Option<Expr>,
    separator: Option<Expr>,
}

impl<'a> Repetition<'a> {
    fn new(node: &'a Node, whole: bool) -> Self {
        Repetition { node, whole, choices: Vec::new(), chain: None, item: None, separator: None }
    }
}

struct Tested<'a> {
    node: &'a Node,
}

impl<'a> Tested<'a> {
    fn new(node: &'a Node) -> Self {
        Tested { node }
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
}

impl<'a> Atom<'a> {
    fn new(node: &'a Node, argument: bool) -> Self {
        Atom { node, argument }
    }
}

struct ArgumentFrame<'a> {
    node: &'a Node,
}

struct MethodFrame<'a> {
    node: &'a Node,
    condition: bool,
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
    "headed-body",
    "string-terminal",
    "wildcard",
    "tag-test",
    "tag-requirement",
    "value-test",
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
    "pattern-literal",
    "pattern-union",
    "pattern-intersection",
    "pattern-sequence",
    "pattern-item",
    "pattern-atom",
    "pattern-brackets",
    "pattern-repeat",
    "pattern-path",
    "directive",
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
    "rule-flags",
    "rule-flag",
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
    "method",
    "tag-run",
    "string-run",
    "integer",
    "pattern-literal",
    "string",
    "tag",
    "range",
    "name",
    "empty-set",
    "term",
    "capture-reference",
    "constant-reference",
];

/// Whether a name begins with a capital, and so is a terminal and a tag
/// literal (engine §2).
fn is_capital(name: &str) -> bool {
    name.starts_with(|c: char| c.is_ascii_uppercase())
}

/// Whether a tag term, or a condition inside one, reads the tags of `$`,
/// the constituent whose tags it defines: `$` as a value, `tags($)` or
/// `classes($)` (§9). A span argument such as `value($)` reads tokens,
/// and `tags($, R)` parses them again.
pub(crate) fn reads_own_tags(term: &Term) -> bool {
    // The parts to look at, with an explicit stack: a term is as deep as
    // its document nests until the check of its depth (§9).
    let mut stack = vec![Part::Term(term)];
    while let Some(part) = stack.pop() {
        work::count(Work::Walked, 1);
        match part {
            Part::Term(term) => match term {
                Term::Capture(name) => {
                    if name.is_empty() {
                        return true;
                    }
                }
                Term::Call(name, args) => {
                    if matches!(name.as_str(), "tags" | "classes")
                        && matches!(&args[..], [Arg::Term(Term::Capture(name))] if name.is_empty())
                    {
                        return true;
                    }
                }
                Term::Union(items) | Term::Intersection(items) => stack.extend(items.iter().map(Part::Term)),
                Term::Difference(left, right) => stack.extend([Part::Term(left), Part::Term(right)]),
                Term::If(cond, then) => stack.extend([Part::Cond(cond), Part::Term(then)]),
                Term::Pattern(_) | Term::Str(_) | Term::Tag(_) | Term::EmptySet | Term::Const(..) => {}
            },
            Part::Cond(cond) => match cond {
                Cond::Compare(op, left, right) => {
                    if !matches!(op.as_str(), "≅" | "≇") {
                        stack.extend([Part::Term(left), Part::Term(right)]);
                    }
                }
                Cond::Not(inner) => stack.push(Part::Cond(inner)),
                Cond::Any(items) | Cond::All(items) => stack.extend(items.iter().map(Part::Cond)),
                Cond::If(antecedent, consequent) => stack.extend([Part::Cond(antecedent), Part::Cond(consequent)]),
                Cond::Matches(..)
                | Cond::Begins(..)
                | Cond::Initial(_)
                | Cond::Final(_)
                | Cond::Boundary(_, _, _, _)
                | Cond::Captured(_) => {}
            },
        }
    }
    false
}

/// A part of a clause: a term or a condition.
enum Part<'t> {
    Term(&'t Term),
    Cond(&'t Cond),
}

/// A part of a clause that a walk changes.
enum PartMut<'t> {
    Term(&'t mut Term),
    Cond(&'t mut Cond),
}

/// Folds each `any` that stands directly in an `any`, and each `all` in an
/// `all`, into the one around it: a group in parentheses of the same
/// connective is part of the one around it (§9). One walk, with an explicit
/// stack, that gathers each folded list once.
fn flatten_term(root: &mut Term) {
    let mut pending = vec![root];
    while let Some(term) = pending.pop() {
        match term {
            Term::Union(items) => {
                let mut stack: Vec<_> = std::mem::take(items).into_iter().rev().collect();
                while let Some(mut term) = stack.pop() {
                    match &mut term {
                        Term::Union(inner) => stack.extend(std::mem::take(inner).into_iter().rev()),
                        _ => items.push(term),
                    }
                }
                pending.extend(items.iter_mut());
            }
            Term::Intersection(items) => pending.extend(items.iter_mut()),
            Term::Difference(left, right) => {
                pending.push(right);
                pending.push(left);
            }
            Term::If(_, then) => pending.push(then),
            Term::Call(_, args) => {
                pending
                    .extend(args.iter_mut().filter_map(|arg| if let Arg::Term(term) = arg { Some(term) } else { None }))
            }
            _ => {}
        }
    }
}

fn flatten_groups(rule: &mut RuleDef) {
    let mut stack: Vec<PartMut> = Vec::new();
    stack.extend(rule.conditions.iter_mut().map(PartMut::Cond));
    stack.extend(rule.tags.iter_mut().map(PartMut::Term));
    stack.extend(rule.alternatives.iter_mut().filter_map(|alternative| alternative.tags.as_mut()).map(PartMut::Term));
    for item in rule.emit.iter_mut().flatten() {
        if let EmitItem::Capture(_, Some(tags), _) = item {
            stack.push(PartMut::Term(tags));
        }
    }
    while let Some(part) = stack.pop() {
        work::count(Work::Walked, 1);
        match part {
            PartMut::Term(term) => match term {
                Term::Union(items) | Term::Intersection(items) => stack.extend(items.iter_mut().map(PartMut::Term)),
                Term::Difference(left, right) => stack.extend([PartMut::Term(left), PartMut::Term(right)]),
                Term::If(cond, then) => stack.extend([PartMut::Cond(cond), PartMut::Term(then)]),
                Term::Call(_, args) => stack.extend(args.iter_mut().filter_map(|arg| match arg {
                    Arg::Term(term) => Some(PartMut::Term(term)),
                    _ => None,
                })),
                _ => {}
            },
            PartMut::Cond(cond) => match cond {
                Cond::Any(items) => {
                    fold(items, |cond| if let Cond::Any(inner) = cond { Some(std::mem::take(inner)) } else { None });
                    stack.extend(items.iter_mut().map(PartMut::Cond));
                }
                Cond::All(items) => {
                    fold(items, |cond| if let Cond::All(inner) = cond { Some(std::mem::take(inner)) } else { None });
                    stack.extend(items.iter_mut().map(PartMut::Cond));
                }
                Cond::Compare(_, left, right) => stack.extend([PartMut::Term(left), PartMut::Term(right)]),
                Cond::Not(inner) => stack.push(PartMut::Cond(inner)),
                Cond::If(antecedent, consequent) => {
                    stack.extend([PartMut::Cond(antecedent), PartMut::Cond(consequent)])
                }
                Cond::Matches(span, _)
                | Cond::Begins(span, _)
                | Cond::Initial(span)
                | Cond::Final(span)
                | Cond::Boundary(_, span, _, _) => stack.push(PartMut::Term(span)),
                Cond::Captured(_) => {}
            },
        }
    }
}

/// Replaces each item of a list that `inner` opens, a group of the list's
/// own connective, with that group's items, at any depth, in order.
fn fold(items: &mut Vec<Cond>, inner: impl Fn(&mut Cond) -> Option<Vec<Cond>>) {
    let mut joined = Vec::with_capacity(items.len());
    let mut pending: Vec<Cond> = std::mem::take(items);
    pending.reverse();
    while let Some(mut item) = pending.pop() {
        work::count(Work::Walked, 1);
        match inner(&mut item) {
            Some(mut parts) => {
                parts.reverse();
                pending.append(&mut parts);
            }
            None => joined.push(item),
        }
    }
    *items = joined;
}

/// Extract the pattern from one node, or retain its child expression.
fn as_pattern(c: crate::patterns::Children) -> crate::patterns::Pattern {
    match c {
        crate::patterns::Children::Node(p) => *p,
        _ => crate::patterns::Pattern::Children(c),
    }
}

/// Cached DOMs omit source annotations. Recover recipe positions only for a failed load.
pub(crate) fn restore_recipe_locations(
    dom: &mut Dom,
    tokens: &[crate::result::Token],
    position: &dyn Fn(usize) -> (usize, usize),
) {
    for rule in &mut dom.rules {
        let Some(start) = tokens.iter().position(|token| {
            matches!(token.value.as_str(), "%rule" | "%extend-rule" | "%redefine-rule")
                && position(token.source.start) == rule.at
        }) else {
            continue;
        };
        let mut values = Vec::new();
        let mut images = Vec::new();
        for index in start + 1..tokens.len() {
            let token = &tokens[index];
            if token.value.starts_with('%') {
                break;
            }
            if let Some(next) = tokens.get(index + 1) {
                match token.value.as_str() {
                    ":=" => values.push(position(next.source.start)),
                    ":-" => images.push(position(next.source.start)),
                    _ => {}
                }
            }
        }
        let mut values = values.into_iter();
        let mut images = images.into_iter();
        for channels in std::iter::once(&mut rule.strings).chain(rule.alternatives.iter_mut().map(|a| &mut a.strings)) {
            if channels.value.is_some() {
                channels.value_at = values.next();
            }
            if channels.image.is_some() {
                channels.image_at = images.next();
            }
        }
    }
}
