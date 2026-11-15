//! From the notation's document tree to a grammar DOM (engine §9).

use crate::dom::{
    call_type, joined_type, Alternative, Arg, Attachments, Chain, Channels, ClassifierDef, Cond, ConstDef, Directive,
    Dom, EmitItem, Entry, Expr, FeatureKind, Gate, Hidden, ImplicationDef, Mark, Op, RuleDef, Term, Type,
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
    pub feature_context: std::cell::Cell<bool>,
    pub tokens: &'a [Token],
    pub strings: &'a crate::string_escapes::DocumentStrings<'a>,
    /// The document position of a grammar-text index.
    pub position: &'a dyn Fn(usize) -> (usize, usize),
    /// The source identity of the current elidable head.
    pub default_head: std::cell::Cell<usize>,
    pub head_defaults: std::cell::RefCell<FxMap<usize, crate::dom::DefaultValue>>,
    pub in_recipe: std::cell::Cell<bool>,
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
        for node in self.parts(root) {
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
        let mut entries = Vec::new();
        for entry in self.rules(node, "classifier-entry") {
            entries.push(self.entry(entry)?);
        }
        Ok(ClassifierDef {
            name,
            name_at: crate::dom::Unseen(Some(self.first(name_node))),
            entries,
            at: self.first(node),
        })
    }

    /// An entry of a classifier: gates, canonical keys, `∈` or `∉`, and a
    /// class (engine §2, §9).
    fn entry(&self, node: &'a Node) -> R<Entry> {
        let gates = self.rules(node, "feature-gate").map(|gate| self.gate(gate, true)).collect::<R<_>>()?;
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
        let class = self.value(self.token(class_node)?);
        Ok(Entry {
            gates,
            keys,
            adds,
            class: class.to_string(),
            class_at: crate::dom::Unseen(Some(self.first(class_node))),
            at: self.first(node),
        })
    }

    /// An implication, `%implies A ⟹ B`: two closed terms whose type is a
    /// tag set (engine §2, §9).
    fn implication_declaration(&self, node: &'a Node) -> R<ImplicationDef> {
        let mut sides = Vec::new();
        for side in self.some(node, "union", 2)?.into_iter().take(2) {
            // A side stands where it is written, parentheses included.
            let (mut term, _) = self.union(side, false)?;
            if !matches!(term, Term::Const(..) | Term::Source(_)) {
                if let Some(hidden) = term.hidden_mut() {
                    hidden.set(Some(self.first(side)));
                }
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
        let definer = self.token(self.one(node, "constant-keyword")?)?;
        let reference = self.token(self.one(node, "constant-name")?)?;
        let name = self.value(reference).strip_prefix('$').unwrap_or("").to_string();
        let _ = reference;
        let redefine = match self.value(definer) {
            "%const" => false,
            "%redefine-const" => true,
            _ => return Err(self.error(definer, "unknown constant definer")),
        };
        let value_node = self.one(node, "term")?;
        let (value, _) = self.term(value_node, false)?;
        Ok(ConstDef {
            name,
            name_at: crate::dom::Unseen(Some(self.first(reference))),
            redefine,
            value,
            at: self.at(definer),
        })
    }

    fn directive(&self, node: &'a Node) -> R<Directive> {
        let token = self.token(node)?;
        let name = self.value(token).strip_prefix('%').unwrap_or("");
        let parts: Vec<_> = self
            .parts(node)
            .into_iter()
            .filter(|part| {
                matches!(
                    rule_name(part),
                    "directive-identifier" | "directive-string" | "directive-terminal" | "directive-term"
                )
            })
            .collect();
        // The operands' kinds are a fault of conversion (engine §9.3 step 4).
        let kinds: Vec<&str> = parts
            .iter()
            .map(|part| match rule_name(part) {
                "directive-string" => "string",
                "directive-identifier" if self.tokens_of(part).next().is_some_and(|t| is_capital(self.value(t))) => {
                    "class"
                }
                "directive-identifier" => "name",
                _ => "tag",
            })
            .collect();
        if let Some(problem) = operand_problem(name, &kinds) {
            return Err(self.error(node, problem));
        }
        let mut args = Vec::new();
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
        let conditions = match self.rules(node, "conditions-clause").next() {
            Some(clause) => {
                self.feature_context.set(true);
                let conditions = (|| {
                    self.some(clause, "condition", 1)?
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
            let operand = parts.iter().any(|part| matches!(rule_name(part), "pattern-literal" | "constant-reference"));
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
        Ok(Directive {
            name: "ambiguity-resolution".into(),
            args: Vec::new(),
            steps: Some(steps),
            conditions: None,
            at: self.at(token),
        })
    }

    fn rule(&self, node: &'a Node) -> R<RuleDef> {
        let definer = self.token(self.one(node, "rule-keyword")?)?;
        let mut source = crate::dom::source::SourceHead::default();
        let mut places = crate::dom::RulePlaces::default();
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
                    | SourceArgument::Body(Expr::Source(SourceSymbol::Parameter(name, _), ..)) => Some(name.clone()),
                    _ => None,
                })
                .collect();
            if let Some(params) = params {
                for argument in &call.args {
                    if let SourceArgument::Term(Term::Source(SourceSymbol::Parameter(_, at)))
                    | SourceArgument::Body(Expr::Source(SourceSymbol::Parameter(_, at), ..)) = argument
                    {
                        places.param_ats.push(*at);
                    }
                    let (SourceArgument::Term(Term::Source(SourceSymbol::Parameter(name, _)))
                    | SourceArgument::Body(Expr::Source(SourceSymbol::Parameter(name, _), ..))) = argument
                    else {
                        unreachable!("a parameter-only head")
                    };
                    self.parameters.borrow_mut().insert(name.clone());
                }
                source.params = Some(params);
            } else {
                source.args = Some(call.args);
            }
            (call.name, self.token(head)?)
        };
        let head_written = self.rules(node, "rule-name").next().is_none();
        let op = match self.value(definer) {
            "%redefine-rule" => Op::Redefine,
            "%extend-rule" => Op::Extend,
            "%rule" => Op::Define,
            _ => return Err(self.error(definer, "unknown rule definer")),
        };
        if self.tokens_of(node).any(|token| self.value(token) == "=") {
            source.instance = Some(self.source_call(self.one(node, "call")?)?);
            places.has_head = head_written;
            return Ok(RuleDef {
                places: crate::dom::Unseen(places),
                error: None,
                warning: None,
                suppress_warnings: Vec::new(),
                source,
                deferred_emission: None,
                name,
                name_at: crate::dom::Unseen(Some(self.first(name_token))),
                op,
                tags: None,
                tags_at: Default::default(),
                strings: Default::default(),
                alternatives: Vec::new(),
                conditions: Vec::new(),
                template_conditions: Vec::new(),
                emit: None,
                erased: false,
                at: self.at(definer),
            });
        }
        // The parts of a definition are read in the order written: the
        // body, then its clauses in their fixed order, and the checks of the
        // whole definition last (§9).
        let (tags, tags_at) = match self.rules(node, "header-tags").next() {
            Some(clause) => (Some(self.constituent_tags(clause)?), self.clause_at(clause)?),
            None => (None, Default::default()),
        };
        let strings = self.channels(node)?;
        let mut alternatives = Vec::new();
        let body = self
            .rules(node, "body")
            .next()
            .or_else(|| self.rules(node, "headed-body").next())
            .ok_or_else(|| self.shape_error(node, "body"))?;
        let alternatives_nodes = match self.rules(body, "ranked-body").next() {
            Some(ranked) => vec![ranked],
            None => self.some(body, "alternative", 1)?,
        };
        for alternative in alternatives_nodes {
            alternatives.push(self.alternative(alternative)?);
        }
        // Each condition of the list is one condition (§9).
        let mut conditions = Vec::new();
        if let Some(clause) = self.rules(node, "conditions-clause").next() {
            for implication in self.some(clause, "condition", 1)? {
                conditions.push(self.implication(implication)?);
            }
        }
        let error = self.rules(node, "error-clause").next().map(|clause| self.recipe(clause)).transpose()?;
        let warning = self.rules(node, "warning-clause").next().map(|clause| self.recipe(clause)).transpose()?;
        places.error_at = self.rules(node, "error-clause").next().map(|clause| self.first(clause));
        places.warning_at = self.rules(node, "warning-clause").next().map(|clause| self.first(clause));
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
            Some(clause) => {
                // The clause, each item, and each item's tag term stand
                // where they are written (engine §9.3).
                places.emit_at = Some(self.first(clause));
                let items: Vec<&Node> = self.rules(clause, "emit-item").collect();
                let items = if items.is_empty() { vec![clause] } else { items };
                for item in items {
                    places.item_ats.push(self.first(item));
                    let tags = self.rules(item, "emit-tags").next();
                    places.item_tags_ats.push(match tags {
                        Some(tags) => Some(self.first(self.one(tags, "term")?)),
                        None => None,
                    });
                }
                Some(self.emission(clause)?)
            }
            None => None,
        };
        let rule = RuleDef {
            places: crate::dom::Unseen(places),
            error,
            warning,
            suppress_warnings,
            source,
            deferred_emission: None,
            name,
            name_at: crate::dom::Unseen(Some(self.first(name_token))),
            op,
            tags,
            tags_at: crate::dom::Unseen(tags_at),
            strings,
            alternatives,
            emit,
            conditions,
            template_conditions: Vec::new(),
            erased: self.rules(node, "erased-clause").next().is_some(),
            at: self.at(definer),
        };
        Ok(rule)
    }

    fn gate(&self, node: &'a Node, _gates_only: bool) -> R<Gate> {
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
        Ok(Gate { feature: feature.into(), kind, negated })
    }

    fn alternative(&self, node: &'a Node) -> R<Alternative> {
        // A gate token is `f?` or `¬f?` (§9).
        let gates = self.rules(node, "feature-gate").map(|gate| self.gate(gate, false)).collect::<R<_>>()?;
        let expr = if rule_name(node) == "ranked-body" {
            match self.run(Frame::Choice(Choice::new(self.one(node, "ranked-choice")?)))? {
                Val::Expr(expr) => expr,
                _ => unreachable!("an expression reads an expression"),
            }
        } else {
            self.conjunction(self.one(node, "some-of")?, true)?
        };
        let at = self.first(node);
        let (tags, tags_at) = match self.rules(node, "alternative-tags").next() {
            Some(tags) => (Some(self.constituent_tags(tags)?), self.clause_at(tags)?),
            None => (None, Default::default()),
        };
        Ok(Alternative {
            gates,
            expr,
            tags,
            tags_at: crate::dom::Unseen(tags_at),
            strings: self.channels(node)?,
            at: crate::dom::Unseen(Some(at)),
        })
    }

    /// Where a tag clause and its term stand.
    fn clause_at(&self, clause: &'a Node) -> R<crate::dom::ClauseAt> {
        Ok(crate::dom::ClauseAt { clause: Some(self.first(clause)), term: Some(self.first(self.one(clause, "term")?)) })
    }

    /// A rule's or an alternative's tags, which say what the constituent's
    /// tags are and so cannot read them: `$.tags` and `$.classes` are
    /// errors anywhere in them, gates included (§9), reported at the
    /// clause.
    fn constituent_tags(&self, node: &'a Node) -> R<Term> {
        let source = self.one(node, "term")?;
        self.tag_term(source)
    }

    /// A whole term that must be a tag set: a constituent's or an item's
    /// tags (engine §10). A type error stands at the term.
    fn tag_term(&self, node: &'a Node) -> R<Term> {
        Ok(self.term(node, false)?.0)
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
                Step::Done(mut value) => {
                    let done = stack.pop().expect("a frame");
                    // A term or a condition stands where the construct
                    // that reads it does, unless a part of it says more
                    // (engine §9.3).
                    if let Some(node) = done.located() {
                        let at = self.first(node);
                        match &mut value {
                            Val::Term(term, _) | Val::Arg(Arg::Term(term), _) => term.locate(at),
                            Val::Cond(cond) => cond.locate(at),
                            _ => {}
                        }
                    }
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
            Frame::AllOf(conditions) => self.resume_connective(conditions, input, "condition-primary"),
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
                    return Ok(Step::Call(Frame::Primary(PrimaryFrame::new(primary))));
                }
                let sequence = frame.sequences.as_ref().expect("the sequences")[frame.parts.len()];
                let at = Some(self.first(sequence));
                frame.parts.push(single_or(std::mem::take(&mut frame.items), |items| {
                    Expr::Seq(items, crate::dom::ExprAt::from(at))
                }));
                frame.primaries = None;
            }
            let sequences = frame.sequences.as_ref().expect("the sequences");
            let Some(&sequence) = sequences.get(frame.parts.len()) else {
                let at = Some(self.first(frame.node));
                return Ok(Step::Done(Val::Expr(single_or(std::mem::take(&mut frame.parts), |items| {
                    Expr::And(items, crate::dom::ExprAt::from(at))
                }))));
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
            frame.conjunctions = Some(self.some(frame.node, "some-of", if frame.ranked { 2 } else { 1 })?);
        }
        if let Some(Val::Expr(expr)) = input {
            frame.parts.push(expr);
        }
        let conjunctions = frame.conjunctions.as_ref().expect("the conjunctions");
        match conjunctions.get(frame.parts.len()) {
            Some(&conjunction) => Ok(Step::Call(Frame::Conjunction(Conjunction::new(conjunction, false)))),
            None => Ok(Step::Done(Val::Expr(if frame.ranked {
                let separator =
                    self.tokens_of(frame.node).find(|token| self.value(token) == "≻").map(|token| self.first(token));
                Expr::Ranked(std::mem::take(&mut frame.parts), crate::dom::ExprAt::from(separator))
            } else {
                let at = Some(self.first(frame.node));
                single_or(std::mem::take(&mut frame.parts), |items| Expr::Choice(items, crate::dom::ExprAt::from(at)))
            }))),
        }
    }

    /// `whole` is whether a chain may stand here (§9).
    fn resume_primary(&self, frame: &mut PrimaryFrame<'a>, input: Option<Val>) -> R<Step<'a>> {
        if let Some(value) = input {
            // The construct it holds, read: a capture wraps it, and a group,
            // an optional, braces and a tested symbol are it.
            let mut value = match value {
                Val::SourceCall(call) => Val::Expr(Expr::Source(SourceSymbol::Call(call), crate::dom::Hidden::NONE)),
                value => value,
            };
            if frame.group {
                if let Val::Expr(expr) = &mut value {
                    expr.group();
                }
            }
            let value = if frame.spliced {
                if let Val::Expr(expr) = value {
                    Val::Expr(Expr::Splice(Box::new(expr), crate::dom::ExprAt::from(Some(self.first(frame.node)))))
                } else {
                    value
                }
            } else {
                value
            };
            return Ok(Step::Done(match (frame.capture.take(), value) {
                (Some((name, node)), Val::Expr(expr)) => {
                    let target = Box::new(expr);
                    Val::Expr(Expr::Capture(name, target, crate::dom::ExprAt::from(Some(self.first(node)))))
                }
                (_, value) => value,
            }));
        }
        let node = frame.node;
        let inner = if PRIMARIES.contains(&rule_name(node)) { node } else { self.inner(node, PRIMARIES)? };
        let token = || self.token(inner);
        Ok(match rule_name(inner) {
            "rule-reference" | "tag" | "string-terminal" | "constant-reference" | "wildcard" | "range" => {
                Step::Done(Val::Expr(self.symbol(inner)?))
            }
            "splice" => {
                let target = self.inner(inner, &["rule-reference", "call"])?;
                let marker = self.token(inner)?;
                if self.tokens[marker.token.unwrap()].source.end != self.tokens[target.span.start].source.start {
                    return Err(self.error(inner, "a splice marker stands directly before its target"));
                }
                frame.spliced = true;
                Step::Call(Frame::Primary(PrimaryFrame::new(target)))
            }
            "parameter" => Step::Done(Val::Expr(Expr::Source(self.source_parameter(inner)?, crate::dom::Hidden::NONE))),
            "call" => Step::Call(Frame::SourceCall(CallFrame::new(inner))),
            "tested-primary" => Step::Call(Frame::Tested(Tested::new(inner))),
            "capture" | "captured-terminator" => {
                let capture = token()?;
                let primary = self.one(inner, "primary")?;
                let name = self.value(capture).strip_prefix('$').unwrap_or("").to_string();
                frame.capture = Some((name, inner));
                Step::Call(Frame::Primary(PrimaryFrame::new(primary)))
            }
            "group" => {
                frame.group = true;
                Step::Call(Frame::Choice(Choice::new(self.one(inner, "choice")?)))
            }
            "optional" => Step::Call(Frame::Optional(OptionalFrame::new(inner))),
            "repetition" => Step::Call(Frame::Repetition(Repetition::new(inner))),
            "empty" => Step::Done(Val::Expr(Expr::Empty(crate::dom::ExprAt::from(Some(self.first(inner)))))),
            other => return Err(self.unknown(node, other)),
        })
    }

    /// An optional, and with a marker `+` among its parts an
    /// elidable one (§3.8, §9). Its form is checked on the tree, where a
    /// group is still a node: one sequence, whose first primary is the
    /// terminal itself, with or without symbol tests.
    fn resume_optional(&self, frame: &mut OptionalFrame<'a>, input: Option<Val>) -> R<Step<'a>> {
        if let Some(Val::Expr(expr)) = input {
            let captured = frame.captured;
            let default = self.head_defaults.borrow_mut().remove(&frame.head);
            if frame.mark != Mark::Plain {
                self.default_head.set(frame.previous_head);
            }
            let mut expr = expr;
            if frame.mark != Mark::Plain && !captured && (frame.leading || matches!(expr, Expr::Capture(..))) {
                expr.group();
            }
            return Ok(Step::Done(Val::Expr(Expr::Optional(
                Box::new(expr),
                frame.mark,
                default,
                crate::dom::ExprAt::from(Some(self.first(frame.node))),
            ))));
        }
        let node = frame.node;
        if let Some(capture) = self.rules(node, "captured-terminator").next() {
            let markers: Vec<_> =
                self.tokens_of(node).chain(self.tokens_of(capture)).filter(|t| self.value(t) == "+").collect();
            if markers.len() > 1 {
                return Err(self.error(markers[1], "an optional has one marker + at most"));
            }
            if markers.is_empty() || self.rules(node, "choice").next().is_some() {
                return Err(self.error(node, "a captured elidable optional holds only its terminator"));
            }
            // Whether the head is a terminal is a fault of the DOM validator
            // (engine §9.3 step 5).
            let head = self.inner(self.one(capture, "primary")?, PRIMARIES)?;
            frame.head = head as *const Node as usize;
            frame.previous_head = self.default_head.replace(frame.head);
            frame.mark = Mark::Elidable;
            frame.captured = true;
            return Ok(Step::Call(Frame::Primary(PrimaryFrame::new(capture))));
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
        // A leading | or & groups what the optional holds, which has then
        // no elidable head: the DOM validator refuses it (engine §9.3).
        let conjunctions: Vec<&Node> = self.rules(choice, "some-of").collect();
        let leading = self.tokens_of(choice).any(|token| self.value(token) == "|")
            || (conjunctions.len() == 1 && self.tokens_of(conjunctions[0]).any(|token| self.value(token) == "&"));
        frame.leading = leading;
        // The head stands directly after the marker: find it for its defaults.
        let sequences: Vec<&Node> = if conjunctions.len() == 1 && !leading {
            self.rules(conjunctions[0], "sequence").collect()
        } else {
            Vec::new()
        };
        if let [sequence] = &sequences[..] {
            if let Some(primary) = self.rules(sequence, "primary").next() {
                if let Ok(head) = self.inner(primary, PRIMARIES) {
                    frame.head = head as *const Node as usize;
                }
            }
        }
        frame.previous_head = self.default_head.replace(frame.head);
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
                frame.item = Some(Box::new(expr));
                if let Some(&separator) = frame.choices.get(1) {
                    return Ok(Step::Call(Frame::Choice(Choice::new(separator))));
                }
            } else {
                frame.separator = Some(Box::new(expr));
            }
            let item = frame.item.take().expect("the item");
            let separator = frame.separator.take();
            return Ok(Step::Done(Val::Expr(Expr::Repeat(
                item,
                separator,
                frame.chain,
                crate::dom::ExprAt::from(Some(self.first(frame.node))),
            ))));
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
            .find(|part| rule_name(part) != "tested-primary" && PRIMARIES.contains(&rule_name(part))))
    }

    /// A reference, terminal, range or property, and one test on its own
    /// span (engine §2, §9). The syntax grammar reads a test after any
    /// primary, so that the reader can name the reason.
    fn resume_tested(&self, frame: &mut Tested<'a>, input: Option<Val>) -> R<Step<'a>> {
        let node = frame.node;
        match input {
            Some(Val::Expr(expr)) if frame.expr.is_none() => frame.expr = Some(Box::new(expr)),
            Some(Val::SourceCall(call)) if frame.expr.is_none() => {
                frame.expr = Some(Box::new(Expr::Source(SourceSymbol::Call(call), Hidden::NONE)))
            }
            Some(Val::Term(mut term, _)) => {
                // A test operand in parentheses is grouped, and stands at its
                // parenthesis (engine §9.3).
                let operand = frame.operand.take().expect("a test operand");
                let inner = self.inner(operand, ATOMS)?;
                if matches!(rule_name(inner), "term" | "term-atom") {
                    if let Some(hidden) = term.hidden_mut() {
                        hidden.grouped = true;
                        hidden.set(Some(self.first(operand)));
                    }
                }
                frame.operands.push(term);
            }
            Some(_) => unreachable!("a tested symbol reads its base and its operands"),
            None => {
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
                frame.tests = Some(tests);
                // The base is converted before the test operands (engine
                // §9.3).
                if rule_name(base) == "call" {
                    return Ok(Step::Call(Frame::SourceCall(CallFrame::new(base))));
                }
                if matches!(
                    rule_name(base),
                    "rule-reference"
                        | "tag"
                        | "string-terminal"
                        | "constant-reference"
                        | "wildcard"
                        | "range"
                        | "parameter"
                ) {
                    frame.expr = Some(Box::new(self.symbol(base)?));
                } else {
                    return Ok(Step::Call(Frame::Primary(PrimaryFrame::new(base))));
                }
            }
        }
        let tests = frame.tests.clone().expect("the tests");
        while let Some(&test) = tests.get(frame.index) {
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
                frame.index += 1;
                continue;
            }
            // The operands of the test, each read as a term.
            let operands: Vec<&'a Node> = if rule_name(test) == "tag-test" {
                self.rules(test, "tag-requirement")
                    .map(|requirement| self.one(requirement, "test-operand"))
                    .collect::<R<_>>()?
            } else {
                vec![self.one(test, "test-operand")?]
            };
            if let Some(&operand) = operands.get(frame.operands.len()) {
                frame.operand = Some(operand);
                return Ok(Step::Call(Frame::Atom(Atom::new(operand, false))));
            }
            let mut values = std::mem::take(&mut frame.operands).into_iter();
            let (op, operand) = if rule_name(test) == "tag-test" {
                let args = self
                    .rules(test, "tag-requirement")
                    .zip(&mut values)
                    .map(|(requirement, value)| {
                        let negated = self.tokens_of(requirement).any(|token| self.value(token) == "¬");
                        Arg::Term(if negated {
                            Term::Call("forbid".into(), vec![Arg::Term(value)], Hidden::NONE)
                        } else {
                            value
                        })
                    })
                    .collect();
                ("tags".to_string(), Term::Call("requirements".into(), args, Hidden::NONE))
            } else {
                let comparator = self.operator(self.token(self.one(test, "value-comparator")?)?).to_string();
                (comparator, values.next().expect("the operand"))
            };
            let expr = frame.expr.take().expect("the tested base");
            frame.expr =
                Some(Box::new(Expr::Tested(op, operand, expr, crate::dom::ExprAt::from(Some(self.first(test))))));
            frame.index += 1;
        }
        Ok(Step::Done(Val::Expr(*frame.expr.take().expect("the tested symbol"))))
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
                // Whether the guarded term is a set is a fault of type
                // inspection (engine §9.3 step 5).
                let kind = crate::dom::joined_type(&[ty], "⟹").unwrap_or(Type::Any);
                // Each guard's term stands at its guard (engine §9.3).
                let mut guarded = term;
                while let Some(cond) = frame.conds.pop() {
                    let guard = guards[frame.conds.len()];
                    guarded = Term::If(Box::new(cond), Box::new(guarded), Hidden::at(self.first(guard)));
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
            joined_type(&frame.types, operator).unwrap_or(Type::Any)
        };
        let mut items = std::mem::take(&mut frame.items).into_iter();
        let Some(mut result) = items.next() else {
            return Err(self.shape_error(frame.node, "part"));
        };
        let mut open = false;
        for (operator, next) in operators.into_iter().zip(items) {
            if operator == "∖" {
                result = Term::Difference(Box::new(result), Box::new(next), Hidden::at(self.first(frame.node)));
                open = false;
            } else if let (true, Term::Union(parts, ..)) = (open, &mut result) {
                parts.push(next);
            } else {
                result = Term::Union(vec![result, next], Hidden::at(self.first(frame.node)));
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
        let ty =
            if self.feature_context.get() { Type::Any } else { joined_type(&frame.types, "∩").unwrap_or(Type::Any) };
        Ok(Step::Done(Val::Term(Term::Intersection(std::mem::take(&mut frame.items), Hidden::NONE), ty)))
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
        }
        let atoms = frame.parts.as_ref().expect("the atoms");
        if let Some(&atom) = atoms.get(frame.items.len()) {
            return Ok(Step::Call(Frame::Atom(Atom::new(atom, false))));
        }
        let args = std::mem::take(&mut frame.items).into_iter().map(Arg::Term).collect();
        Ok(Step::Done(Val::Term(Term::Call("concat".into(), args, Hidden::NONE), Type::String)))
    }

    fn resume_atom(&self, frame: &mut Atom<'a>, input: Option<Val>) -> R<Step<'a>> {
        if let Some(value) = input {
            // A call, which is no span where a value is due, or a term in
            // parentheses, which is its term.
            return Ok(Step::Done(match value {
                Val::Pattern(value) => {
                    let mut pattern = value.pattern(self, frame.node)?;
                    if let Some(problem) = patterns::source_pattern_problem(&pattern) {
                        pattern.clear();
                        return Err(self.error(frame.node, problem));
                    }
                    Val::Term(Term::Pattern(Box::new(pattern), Hidden::NONE), Type::Pattern)
                }
                Val::SourceCall(call) => Val::Term(Term::Source(SourceSymbol::Call(call)), Type::Any),
                value => value,
            }));
        }
        let node = frame.node;
        let inner = if ATOMS.contains(&rule_name(node))
            && !matches!(rule_name(node), "term" | "guarded-term" | "union" | "term-atom" | "plain-term-atom")
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
            "term-atom" | "plain-term-atom" => Ok(Step::Call(Frame::Atom(Atom::new(inner, frame.argument)))),
            "parameter" => typed(Term::Source(self.source_parameter(inner)?), Type::Any),
            "call" => Ok(Step::Call(Frame::SourceCall(CallFrame::new(inner)))),
            "string" => typed(self.string_term(token()?)?, Type::String),
            "tag" => {
                let token = token()?;
                let tag = self.term_tag(token)?;
                typed(Term::Tag(tag, Hidden::NONE), Type::Tags)
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
                        Term::Tag(self.term_tag(self.token(tag)?)?, Hidden::at(self.first(tag)))
                    })
                }
                typed(Term::Union(items, Hidden::NONE), if strings { Type::Strings } else { Type::Tags })
            }
            "range" => Err(self.error(inner, "a range is a terminal, not a value term")),
            // A bare name is a tag literal if it begins with a capital, and
            // otherwise a rule, which only a function's argument names.
            "rule-or-classifier-name" => {
                let name = self.value(token()?);
                if !is_capital(name) {
                    return Err(self.error(inner, format!("{name} names a rule, which is not a value")));
                }
                typed(Term::Tag(name.to_string(), Hidden::NONE), Type::Tags)
            }
            "empty-set" => typed(Term::EmptySet(Hidden::NONE), Type::Set),
            // The reader knows no constant's type (§9).
            "constant-reference" => {
                let term = self.constant_reference(token()?)?;
                let ty = Type::Any;
                typed(term, ty)
            }
            "capture-reference" => {
                let name = self.value(token()?).strip_prefix('$').unwrap_or("").to_string();
                typed(Term::Capture(name, Hidden::NONE), Type::Span)
            }
            "method-chain" => Ok(Step::Call(Frame::Method(MethodFrame::new(inner, false)))),
            "pattern-literal" => {
                Ok(Step::Call(Frame::Pattern(self.pattern_frame(self.one(inner, "pattern-primary")?))))
            }
            other => Err(self.unknown(node, other)),
        }
    }

    fn pattern_rule_name(node: &Node) -> bool {
        matches!(rule_name(node), "rule-or-classifier-name" | "rule-reference")
            || node.kind == NodeKind::Token && matches!(node.terminal.as_deref(), Some("Emoji-Name" | "Lowercase-Name"))
    }

    /// Constructor parts determine the base, independently of delimiters.
    fn pattern_atom_base(&self, node: &'a Node) -> R<&'a Node> {
        self.parts(node)
            .into_iter()
            .find(|part| {
                matches!(
                    rule_name(part),
                    "rule-or-classifier-name"
                        | "rule-reference"
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
                let Expr::Literal(term, _) = &symbol else { unreachable!() };
                let pattern = match term {
                    Term::Const(name, ..) => P::Constant(name.clone(), self.first(first)),
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
                let Expr::ScalarRange(a, b, _) = &symbol else { unreachable!() };
                (P::Range(a.clone(), b.clone(), self.first(first)), true)
            }
            "constant-reference" => {
                let token = self.token(first)?;
                self.constant_reference(token)?;
                (P::Constant(self.value(token)[1..].into(), self.at(token)), true)
            }
            _ if first.kind == NodeKind::Token
                || matches!(rule_name(first), "rule-or-classifier-name" | "rule-reference") =>
            {
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
                let op = self.operator(self.token(self.one(test, "value-comparator")?)?).into();
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
            let atom = self.one(receiver, "plain-term-atom")?;
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
                Val::Expr(mut body) if frame.reading_body => {
                    frame.reading_body = false;
                    let argument = frame.parse_argument.expect("a parse argument");
                    {
                        let mut sequence: Vec<Expr> = Vec::new();
                        for part in self.parts(argument) {
                            if part.kind == NodeKind::Token && self.value(part) == "…" {
                                sequence.push(Expr::Remainder(crate::dom::ExprAt::from(None)));
                            } else if rule_name(part) == "choice" {
                                sequence.push(body.clone());
                            }
                        }
                        if sequence.len() > 1 {
                            body = Expr::Seq(sequence, crate::dom::ExprAt::from(Some(self.first(argument))));
                        } else if sequence.len() == 1 && matches!(sequence[0], Expr::Remainder(_)) {
                            body = Expr::Seq(
                                vec![Expr::Remainder(crate::dom::ExprAt::from(None)), body.clone()],
                                crate::dom::ExprAt::from(Some(self.first(argument))),
                            );
                        }
                    }
                    frame.args = vec![Arg::Term(Term::Body(std::sync::Arc::new(body)))];
                    frame.types = vec![Some(Type::Body)];
                }
                _ => unreachable!("a method reads a receiver or an argument"),
            }
        }
        if frame.selectors.is_none() {
            frame.selectors = Some(self.some(frame.node, "method-selector", 1)?);
        }
        let selectors = frame.selectors.as_ref().unwrap();
        let selector = selectors[frame.index];
        let parsed = self.rules(selector, "parse-selector").next();
        let name = if parsed.is_some() { "parse" } else { self.value(self.token(self.one(selector, "method-name")?)?) };
        let unknown_method = !crate::dom::shape::known_method(name);
        if frame.arguments.is_none() {
            if let Some(parsed) = parsed {
                let argument = self.one(parsed, "parse-argument")?;
                frame.parse_argument = Some(argument);
                frame.dependent |= self.source_unresolved(argument);
                frame.arguments = Some(Vec::new());
                frame.reading_body = true;
                let choice = Choice::new(self.one(argument, "choice")?);
                return Ok(Step::Call(Frame::Choice(choice)));
            }
            frame.arguments = Some(match self.rules(selector, "method-arguments").next() {
                Some(arguments) => self.some(arguments, "method-argument", 1)?,
                None => Vec::new(),
            });
        }
        if let Some(&argument) = frame.arguments.as_ref().unwrap().get(frame.args.len()) {
            return Ok(Step::Call(Frame::Argument(ArgumentFrame { node: argument })));
        }
        if let Some(arguments) = self.rules(selector, "method-arguments").next() {
            let expected = if matches!(name, "followed-by" | "preceded-by") { "|" } else { "," };
            if self.parts(arguments).iter().any(|part| part.kind == NodeKind::Token && self.value(part) != expected) {
                return Err(self.error(arguments, "invalid method argument separator"));
            }
        }
        // The method's name, receiver and arguments are the DOM
        // validator's to check (engine §9.3 step 5).
        let (receiver, _) = frame.receiver.take().unwrap();
        let mut args = vec![Arg::Term(receiver)];
        args.append(&mut frame.args);
        if let ("classify", [_, Arg::Rule(name)]) = (name, &mut args[..]) {
            let name = std::mem::take(name);
            args[1] = Arg::Classifier(name);
        }
        let last = frame.index + 1 == selectors.len();
        let query = matches!(name, "starts-input" | "ends-input" | "followed-by" | "preceded-by");
        let forest = matches!(name, "parse" | "error-free");
        // Each link of a method chain stands where the chain does
        // (engine §9.3).
        let link = Hidden::at(self.first(frame.node));
        let condition = last && frame.condition;
        let targets = || frame.arguments.as_ref().unwrap().iter().map(|n| self.first(n)).collect();
        let value = if forest {
            let term = Term::Call(name.into(), args, link);
            if condition {
                Val::Cond(Cond::Forest(term, link))
            } else {
                Val::Term(term, Type::Forest)
            }
        } else if query && condition {
            let location = crate::dom::BoundaryLocation { at: Some(self.first(frame.node)), targets: targets() };
            let boundary = matches!(name, "followed-by" | "preceded-by");
            let named = |arg: &Arg| match arg {
                Arg::Rule(name) => Some(name.clone()),
                Arg::Term(Term::Tag(name, ..)) if is_capital(name) => Some(name.clone()),
                _ => None,
            };
            if args.iter().any(|arg| matches!(arg, Arg::Term(Term::Source(_)))) {
                return Ok(Step::Done(Val::Cond(Cond::SourceQuery(name.into(), args, location))));
            }
            let shaped = if boundary {
                args.len() > 1 && args[1..].iter().all(|arg| named(arg).is_some())
            } else {
                args.len() == 1
            };
            if !shaped {
                // A query whose arguments do not fit it stands as written,
                // for the DOM validator to refuse.
                Val::Cond(Cond::Forest(Term::Call(name.into(), args, link), link))
            } else {
                let mut args = args.into_iter();
                let Some(Arg::Term(receiver)) = args.next() else { unreachable!() };
                Val::Cond(match name {
                    "starts-input" => Cond::Initial(receiver, link),
                    "ends-input" => Cond::Final(receiver, link),
                    _ => Cond::Boundary(
                        name == "followed-by",
                        receiver,
                        args.map(|arg| named(&arg).expect("a target")).collect(),
                        location.into(),
                    ),
                })
            }
        } else if condition {
            // A set-valued method stands as a set condition, and any other
            // as written (engine §9.2).
            let term = Term::Call(name.into(), args, link);
            if !unknown_method && matches!(call_type(name), Type::Tags | Type::Strings) {
                Val::Cond(Cond::Truthy(term, link))
            } else {
                Val::Cond(Cond::Forest(term, link))
            }
        } else {
            Val::Term(Term::Call(name.into(), args, link), call_type(name))
        };
        if last {
            return Ok(Step::Done(value));
        }
        let Val::Term(term, ty) = value else { unreachable!() };
        frame.receiver = Some((term, ty));
        frame.receiver_query = query || forest;
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
            return Ok(Step::Done(Val::Arg(Arg::Integer(digits.into(), Hidden::at(self.first(integer))), None)));
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
            if let Some(consequent) = self.rules(frame.node, "condition").next() {
                return Ok(Step::Call(Frame::Implication(Conditions::new(consequent))));
            }
        }
        let mut result = frame.items.pop().expect("an any-of");
        while let Some(antecedent) = frame.items.pop() {
            let at = antecedent.at().unwrap_or_else(|| self.first(frame.node));
            result = Cond::If(Box::new(antecedent), Box::new(result), Hidden::at(at));
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
        let hidden = Hidden::at(self.first(frame.node));
        Ok(Step::Done(Val::Cond(if part == "all-of" {
            single_or(items, |items| Cond::Any(items, hidden))
        } else {
            single_or(items, |items| Cond::All(items, hidden))
        })))
    }

    fn resume_condition(&self, frame: &mut ConditionFrame<'a>, input: Option<Val>) -> R<Step<'a>> {
        let Some(inner) = frame.inner else {
            let inner = self.inner(frame.node, CONDITIONS)?;
            frame.inner = Some(inner);
            return Ok(match rule_name(inner) {
                // Parentheses make no node of their own (§9).
                "condition" => Step::Call(Frame::Implication(Conditions::new(inner))),
                "tree-comparison" => {
                    let capture = self
                        .value(self.token(self.one(inner, "capture-reference")?)?)
                        .strip_prefix('$')
                        .unwrap_or("")
                        .to_owned();
                    frame.op = self.operator(self.token(self.one(inner, "tree-comparator")?)?).to_owned();
                    let right = self.one(inner, "union")?;
                    if let Some(name) =
                        first_of_rule(right, "rule-or-classifier-name").or_else(|| first_of_rule(right, "tag"))
                    {
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
                    let reference = self.one(inner, "capture-reference")?;
                    frame.left = Some((Term::Capture(capture, Hidden::at(self.first(reference))), Type::Span));
                    Step::Call(Frame::Union(Joined::new(right, false)))
                }
                "comparison" => {
                    let comparator = self.one(inner, "comparator")?;
                    frame.op = self.operator(self.token(comparator)?).to_string();
                    let operands = self.some(inner, "union", 2)?;
                    frame.right = Some(operands[1]);
                    Step::Call(Frame::Union(Joined::new(operands[0], false)))
                }
                "negation" => Step::Call(Frame::Condition(ConditionFrame::new(self.one(inner, "condition-primary")?))),
                "presence" => {
                    let token = self.token(inner)?;
                    Step::Done(Val::Cond(Cond::Captured(
                        self.value(token).strip_prefix('$').unwrap_or("").to_string(),
                        Hidden::NONE,
                    )))
                }
                "method-chain" => Step::Call(Frame::Method(MethodFrame::new(inner, true))),
                "set-condition" => {
                    let operation = self.inner(inner, &["union-operation", "intersection-operation", "set-atom"])?;
                    match rule_name(operation) {
                        "union-operation" => Step::Call(Frame::Union(Joined::new(operation, false))),
                        "intersection-operation" => Step::Call(Frame::Intersection(Joined::new(operation, false))),
                        _ => {
                            let atom = self
                                .parts(operation)
                                .into_iter()
                                .find(|child| child.kind == NodeKind::Rule)
                                .ok_or_else(|| self.shape_error(operation, "set atom"))?;
                            Step::Call(Frame::Atom(Atom::new(atom, false)))
                        }
                    }
                }
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
                // Whether the two sides fit the comparator is a fault of
                // type inspection (engine §9.3 step 5).
                let (left, _) = frame.left.take().expect("the left side");
                let at = Some(self.first(inner));
                Ok(Step::Done(Val::Cond(Cond::Compare(std::mem::take(&mut frame.op), left, term, at))))
            }
            "negation" => {
                let Val::Cond(cond) = value else { unreachable!("a negation holds a condition") };
                Ok(Step::Done(Val::Cond(Cond::Not(Box::new(cond), Hidden::NONE))))
            }
            "set-condition" => {
                // Whether the term is a set is a fault of type inspection
                // (engine §9.3 step 5).
                let Val::Term(term, _) = value else { unreachable!("a set term is a term") };
                Ok(Step::Done(Val::Cond(Cond::Truthy(term, Hidden::NONE))))
            }
            _ => Ok(Step::Done(value)),
        }
    }

    /// A reference, literal string, scalar range, wildcard, or engine tag.
    fn symbol(&self, node: &'a Node) -> R<Expr> {
        match rule_name(node) {
            "parameter" => Ok(Expr::Source(self.source_parameter(node)?, crate::dom::Hidden::NONE)),
            "rule-reference" => {
                let token = self.token(node)?;
                let name = self.value(token);
                Ok(Expr::Ref(name.into(), crate::dom::ExprAt::from(Some(self.first(node)))))
            }
            "tag" => Ok(Expr::Ref(self.tag_of(self.token(node)?)?, crate::dom::ExprAt::from(Some(self.first(node))))),
            "constant-reference" => Ok(Expr::Literal(
                self.constant_reference(self.token(node)?)?,
                crate::dom::ExprAt::from(Some(self.first(node))),
            )),
            "wildcard" => {
                self.token(node)?;
                Ok(Expr::Wildcard(crate::dom::ExprAt::from(Some(self.first(node)))))
            }
            "string-terminal" => {
                let part = self.inner(node, &["string", "constant-reference"])?;
                Ok(Expr::Literal(self.string_operand(part)?, crate::dom::ExprAt::from(Some(self.first(node)))))
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
                Ok(Expr::ScalarRange(left, right, crate::dom::ExprAt::from(Some(self.first(node)))))
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
        Ok(Term::Const(name.into(), self.at(token), crate::dom::Hidden::NONE))
    }

    fn string_term(&self, token: &'a Node) -> R<Term> {
        let text = self.value(token);
        if text.strip_prefix('"').and_then(|s| s.strip_suffix('"')).is_none() {
            return Err(self.error(token, "a string requires double quotes"));
        }
        let at = self.at(token);
        let token = token
            .token
            .and_then(|index| self.tokens.get(index))
            .ok_or_else(|| self.shape_error(token, "string token"))?;
        Ok(Term::Str(self.strings.decode(token, false)?, Hidden::at(at)))
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
        for atom in self.some(recipe, "recipe-term", 1)? {
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
            let terms = if let Term::Call(name, args, ..) = &mut term {
                if name == "concat" {
                    std::mem::take(args)
                } else {
                    vec![Arg::Term(term)]
                }
            } else {
                vec![Arg::Term(term)]
            };
            // Whether each atom is a string is a fault of type inspection
            // (engine §9.3 step 5).
            for arg in terms {
                let Arg::Term(term) = arg else { unreachable!("string operand") };
                if matches!(term, Term::Union(..)) {
                    return Err(self.error(atom, "juxtaposed recipe strings require ++, use ++ between string atoms"));
                }
                atoms.push(Arg::Term(term));
            }
        }
        self.in_recipe.set(false);
        Ok(Term::Call("concat".into(), atoms, Hidden::at(self.first(recipe))))
    }

    fn term_tag(&self, token: &'a Node) -> R<String> {
        self.tag_of(token)
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
                .or_else(|| self.rules(node, "header-tags").next())
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
            for (name, list) in [("attachment-before", &mut before), ("attachment-after", &mut after)] {
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
            let mut inner = self.inner(atom, ATOMS).ok()?;
            while rule_name(inner) == "plain-term-atom" {
                inner = self.inner(inner, ATOMS).ok()?;
            }
            match rule_name(inner) {
                "rule-or-classifier-name" => {
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

impl<'a> Frame<'a> {
    /// The node of a frame that reads a term or a condition.
    fn located(&self) -> Option<&'a Node> {
        match self {
            Frame::Term(TermFrame { node, .. })
            | Frame::Union(Joined { node, .. })
            | Frame::Intersection(Joined { node, .. })
            | Frame::Concatenation(Joined { node, .. })
            | Frame::Atom(Atom { node, .. })
            | Frame::Method(MethodFrame { node, .. })
            | Frame::Argument(ArgumentFrame { node })
            | Frame::Implication(Conditions { node, .. })
            | Frame::AnyOf(Conditions { node, .. })
            | Frame::AllOf(Conditions { node, .. })
            | Frame::Condition(ConditionFrame { node, .. }) => Some(node),
            _ => None,
        }
    }
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
    /// The name of the capture that wraps what it asked for, if it is one.
    capture: Option<(String, &'a Node)>,
    spliced: bool,
    /// Whether it is a group, whose parentheses group what it holds.
    group: bool,
}

impl<'a> PrimaryFrame<'a> {
    fn new(node: &'a Node) -> Self {
        PrimaryFrame { node, capture: None, spliced: false, group: false }
    }
}

struct OptionalFrame<'a> {
    node: &'a Node,
    mark: Mark,
    head: usize,
    previous_head: usize,
    /// Whether it is a captured elidable optional, `[$x:+T]`.
    captured: bool,
    /// Whether a leading `|` or `&` groups what the optional holds.
    leading: bool,
}

impl<'a> OptionalFrame<'a> {
    fn new(node: &'a Node) -> Self {
        OptionalFrame { node, mark: Mark::Plain, head: 0, previous_head: 0, captured: false, leading: false }
    }
}

/// The names of the captures of an expression in the order written, braces
/// included, which is the order the reader meets them.
struct Repetition<'a> {
    node: &'a Node,
    choices: Vec<&'a Node>,
    chain: Option<Chain>,
    item: Option<Box<Expr>>,
    separator: Option<Box<Expr>>,
}

impl<'a> Repetition<'a> {
    fn new(node: &'a Node) -> Self {
        Repetition { node, choices: Vec::new(), chain: None, item: None, separator: None }
    }
}

struct Tested<'a> {
    node: &'a Node,
    tests: Option<Vec<&'a Node>>,
    /// The symbol, and the tests on it so far.
    expr: Option<Box<Expr>>,
    /// The next test, and the operands of it read so far.
    index: usize,
    operands: Vec<Term>,
    operand: Option<&'a Node>,
}

impl<'a> Tested<'a> {
    fn new(node: &'a Node) -> Self {
        Tested { node, tests: None, expr: None, index: 0, operands: Vec::new(), operand: None }
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
    parse_argument: Option<&'a Node>,
    reading_body: bool,
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
            parse_argument: None,
            reading_body: false,
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
    "recipe-term",
    "method-chain",
    "method-receiver",
    "method-selector",
    "parse-selector",
    "parse-argument",
    "method-name",
    "method-arguments",
    "tag-run",
    "string-run",
    "integer",
    "directive-term",
    "tree-comparison",
    "tree-comparator",
    "pattern-primary",
    "pattern-node",
    "bare-child-list",
    "child-list",
    "child-choice",
    "child-alternative",
    "child-set-operation",
    "child-intersection",
    "child-sequence",
    "child-item",
    "child-path",
    "child-primary",
    "pattern-literal",
    "pattern-union",
    "pattern-intersection",
    "pattern-atom",
    "child-optional",
    "child-repetition",
    "pattern-path",
    "directive",
    "ranking-directive",
    "ranking-step",
    "directive-identifier",
    "directive-string",
    "directive-terminal",
    "classifier",
    "classifier-name",
    "classifier-entry",
    "classifier-key",
    "classifier-operator",
    "classifier-class",
    "implication-declaration",
    "constant-definition",
    "constant-keyword",
    "constant-name",
    "constant-reference",
    "rule",
    "rule-keyword",
    "rule-name",
    "body",
    "alternative",
    "ranked-body",
    "ranked-choice",
    "feature-gate",
    "alternative-tags",
    "choice",
    "some-of",
    "sequence",
    "primary",
    "repetition",
    "rule-reference",
    "tag",
    "range",
    "tested-primary",
    "value-comparator",
    "test-operand",
    "capture",
    "captured-terminator",
    "group",
    "optional",
    "empty",
    "header-tags",
    "conditions-clause",
    "emits-clause",
    "emit-item",
    "emit-target",
    "emit-tags",
    "attachment-before",
    "attachment-after",
    "condition",
    "any-of",
    "all-of",
    "condition-primary",
    "comparison",
    "comparator",
    "negation",
    "presence",
    "set-condition",
    "union-operation",
    "intersection-operation",
    "set-atom",
    "method-argument",
    "term",
    "guarded-term",
    "union",
    "intersection",
    "concatenation",
    "term-atom",
    "plain-term-atom",
    "string",
    "rule-or-classifier-name",
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
    "rule-reference",
    "tag",
    "range",
    "tested-primary",
    "capture",
    "captured-terminator",
    "group",
    "optional",
    "repetition",
    "empty",
    "constant-reference",
];
const CONDITIONS: &[&str] =
    &["tree-comparison", "comparison", "method-chain", "negation", "presence", "condition", "set-condition"];
const TERMS: [&str; 2] = ["union", "guarded-term"];
const ATOMS: &[&str] = &[
    "call",
    "parameter",
    "method-chain",
    "tag-run",
    "string-run",
    "pattern-literal",
    "string",
    "tag",
    "range",
    "rule-or-classifier-name",
    "empty-set",
    "term",
    "guarded-term",
    "union",
    "term-atom",
    "plain-term-atom",
    "capture-reference",
    "constant-reference",
];

/// Whether a name begins with a capital, and so is a terminal and a tag
/// literal (engine §2).
/// Why a directive's operands, by their kinds, do not fit it, or `None`.
fn operand_problem(name: &str, kinds: &[&str]) -> Option<String> {
    let names = kinds.iter().all(|kind| matches!(*kind, "name" | "class"));
    match name {
        "stage" | "extend-stage" | "redefine-stage" => {
            (kinds.len() != 1 || !names).then(|| format!("%{name} takes one name"))
        }
        "include" | "names" => (kinds != ["string"]).then(|| format!("%{name} takes one string")),
        "features" => (kinds.is_empty() || !names).then(|| "%features takes one or more names".to_string()),
        "elision-only" => (!kinds.is_empty()).then(|| "%elision-only takes no operand".to_string()),
        _ => (!names).then(|| format!("%{name} takes names only")),
    }
}

fn is_capital(name: &str) -> bool {
    name.starts_with(|c: char| c.is_ascii_uppercase())
}

/// Whether a tag term, or a condition inside one, reads `$.tags` or
/// `$.classes` (§9). Bare `$` reads the input value, and a parse over
/// `$` parses the input again.
pub(crate) fn reads_own_tags(term: &Term) -> bool {
    // The parts to look at, with an explicit stack: a term is as deep as
    // its document nests until the check of its depth (§9).
    let mut stack = vec![Part::Term(term)];
    while let Some(part) = stack.pop() {
        work::count(Work::Walked, 1);
        match part {
            Part::Term(term) => match term {
                Term::Body(body) => stack.extend(crate::query_forms::body_terms(body).into_iter().map(Part::Term)),
                Term::Call(name, args, ..) => {
                    if matches!(name.as_str(), "tags" | "classes")
                        && matches!(&args[..], [Arg::Term(Term::Capture(name, ..))] if name.is_empty())
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
                Term::Union(items, ..) | Term::Intersection(items, ..) => stack.extend(items.iter().map(Part::Term)),
                Term::Difference(left, right, ..) => stack.extend([Part::Term(left), Part::Term(right)]),
                Term::If(cond, then, ..) => stack.extend([Part::Cond(cond), Part::Term(then)]),
                Term::Source(symbol) => stack.push(Part::Symbol(symbol)),
                Term::Pattern(..)
                | Term::Str(..)
                | Term::Tag(..)
                | Term::EmptySet(..)
                | Term::Const(..)
                | Term::Capture(..) => {}
            },
            Part::Cond(cond) => match cond {
                Cond::Truthy(term, ..) => stack.push(Part::Term(term)),
                Cond::Forest(term, ..) => stack.push(Part::Term(term)),
                Cond::SourceQuery(_, args, _) => stack.extend(args.iter().filter_map(|arg| match arg {
                    Arg::Term(term) => Some(Part::Term(term)),
                    _ => None,
                })),
                Cond::Compare(op, left, right, _) => {
                    if matches!(op.as_str(), "≅" | "≇")
                        && matches!(left,Term::Capture(name, ..) if name.is_empty())
                        && matches!(right,Term::Pattern(p, ..) if crate::patterns::reads_node_tags(p))
                    {
                        return true;
                    }
                    if !matches!(op.as_str(), "≅" | "≇") {
                        stack.extend([Part::Term(left), Part::Term(right)]);
                    }
                }
                Cond::Not(inner, ..) => stack.push(Part::Cond(inner)),
                Cond::Any(items, ..) | Cond::All(items, ..) => stack.extend(items.iter().map(Part::Cond)),
                Cond::If(antecedent, consequent, ..) => stack.extend([Part::Cond(antecedent), Part::Cond(consequent)]),
                Cond::Initial(..) | Cond::Final(..) | Cond::Boundary(_, _, _, _) | Cond::Captured(..) => {}
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
                Expr::Seq(items, _) | Expr::Choice(items, _) | Expr::Ranked(items, _) | Expr::And(items, _) => {
                    stack.extend(items.iter().map(Part::Expression))
                }
                Expr::Optional(inner, _, _, _) | Expr::Capture(_, inner, _) | Expr::Splice(inner, _) => {
                    stack.push(Part::Expression(inner))
                }
                Expr::Repeat(item, separator, _, _) => {
                    stack.push(Part::Expression(item));
                    stack.extend(separator.as_deref().map(Part::Expression));
                }
                Expr::Tested(_, value, inner, _) => {
                    stack.push(Part::Term(value));
                    stack.push(Part::Expression(inner));
                }
                Expr::Literal(term, _) => stack.push(Part::Term(term)),
                Expr::ScalarRange(a, b, _) => stack.extend([Part::Term(a), Part::Term(b)]),
                Expr::Source(symbol, ..) => stack.push(Part::Symbol(symbol)),
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
    let read = Term::Call("tags".into(), vec![Arg::Term(Term::Capture(String::new(), Hidden::NONE))], Hidden::NONE);
    let outer = Term::Call("wrapper".into(), vec![Arg::Term(read.clone())], Hidden::NONE);
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
        feature_context: Default::default(),
        tokens: &tokens,
        strings: &strings,
        position: &position,
        in_recipe: Default::default(),
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
    atom.rule = Some("recipe-term".into());
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
    condition.rule = Some("condition-primary".into());
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
    // A %names directive without its string is a fault of conversion, as
    // the reader finds it (engine §9.3 step 4).
    let names_error = reader.document(&document).expect_err("the names declaration fails");
    assert_eq!(names_error.message, "%names takes one string");
    assert_eq!(empty_position, (1, 2));
}
