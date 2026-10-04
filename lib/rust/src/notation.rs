//! From the notation's document tree to a grammar DOM (engine §9).

use crate::dom::{
    call_type, comparison_problem, constant_type_problem, expected_problem, is_capture_name, is_classifier_name,
    is_sound_test, joined_type, literal_call_problem, property_problem, range_problem, sound_problem,
    test_type_problem, Alternative, Arg, Attachments, Chain, ClassifierDef, Cond, ConstDef, Directive, Dom, EmitItem,
    Entry, Expr, FeatureKind, Guard, ImplicationDef, Mark, Op, RuleDef, Term, Type,
};
use crate::error::Error;
use crate::fxhash::FxSet;
use crate::result::{Node, NodeKind, Token};
use crate::tags::character_tag;
use crate::unicode::Unicode;
use crate::work::{self, Work};

pub(crate) struct Reader<'a> {
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
    /// The lowercase mapping that the strings of sound tests are checked
    /// against (engine §5, §9).
    pub unicode: &'a Unicode,
    /// What the reader is reading as a closed term, a constant's value or a
    /// test's operand, if it is reading one (engine §9, §10).
    pub closed_for: std::cell::Cell<Option<&'static str>>,
}

const CONSTANT_IN_BODY: &str =
    "a constant cannot stand in a body: a body names a class of tokens with a rule, such as %rule digit '0'..'9'";

type R<T> = Result<T, Error>;

fn rule_name(node: &Node) -> &str {
    node.rule.as_deref().unwrap_or("")
}

impl<'a> Reader<'a> {
    fn text(&self, node: &Node) -> &str {
        node.token.and_then(|token| self.tokens.get(token)).map_or("", |token| token.text.as_str())
    }

    fn at(&self, node: &Node) -> (usize, usize) {
        (self.position)(node.source.start)
    }

    /// The first token of a construct.
    fn first(&self, node: &Node) -> (usize, usize) {
        let mut current = node;
        while current.kind == NodeKind::Rule {
            match current.children.first() {
                Some(child) => current = child,
                None => break,
            }
        }
        self.at(current)
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
        self.error(node, format!("the notation's {} has no {what}", rule_name(node)))
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

    /// The first part of a node: a token, a range or a property.
    fn symbol_part<'n>(&self, node: &'n Node) -> R<&'n Node> {
        match Self::parts(node).first() {
            Some(&first) if first.kind == NodeKind::Token || matches!(rule_name(first), "range" | "property") => {
                Ok(first)
            }
            _ => Err(self.shape_error(node, "token, range or property")),
        }
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
        let name = self.text(self.token(name_node)?).to_string();
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
        let mut guards = Vec::new();
        for guard in Self::rules(node, "guard") {
            let text = self.text(self.token(guard)?);
            if text.ends_with('!') {
                return Err(self.error(guard, "an entry of a classifier takes gates only, not a warning"));
            }
            let text = text.trim_end_matches('?');
            guards.push(match text.strip_prefix('¬') {
                Some(feature) => Guard { feature: feature.to_string(), kind: FeatureKind::Gate, negated: true },
                None => Guard { feature: text.to_string(), kind: FeatureKind::Gate, negated: false },
            });
        }
        let mut keys = Vec::new();
        for key_node in self.some(node, "classifier-key", 1)? {
            let key = self.decode(self.token(key_node)?)?;
            if let Some(problem) = sound_problem(&key, self.unicode) {
                return Err(self.error(key_node, format!("a key is a canonical sound: {problem}")));
            }
            keys.push(key);
        }
        let operator = self.one(node, "classifier-operator")?;
        let adds = self.text(self.token(operator)?) == "∈";
        let class_node = self.one(node, "classifier-class")?;
        let written = self.text(self.token(class_node)?);
        let class = written.strip_prefix('~').unwrap_or(written);
        if !is_capital(class) {
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
        let name = self.text(reference).trim_start_matches('$').to_string();
        let redefine = self.text(definer) == "%redefine-const";
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
        let name = self.text(token).trim_start_matches('%').to_string();
        let parts: Vec<&Node> = Self::parts(node)
            .into_iter()
            .filter(|child| {
                child.kind == NodeKind::Rule
                    && matches!(rule_name(child), "argument-word" | "argument-string" | "argument-tag")
            })
            .collect();
        let operands: Vec<(&Node, &Node)> = parts
            .into_iter()
            // A token, or the node of a range or a property.
            .map(|child| {
                let operand =
                    if rule_name(child) == "argument-tag" { self.symbol_part(child)? } else { self.token(child)? };
                Ok((child, operand))
            })
            .collect::<R<_>>()?;
        let kinds: Vec<Operand> = operands
            .iter()
            .map(|&(child, operand)| {
                let text = self.text(operand);
                match rule_name(child) {
                    "argument-string" => Operand::String,
                    "argument-word" if is_capital(text) => Operand::Class,
                    "argument-word" => Operand::Name,
                    _ if operand.kind == NodeKind::Rule && rule_name(operand) == "range" => Operand::Range,
                    _ if operand.kind == NodeKind::Rule => Operand::Property,
                    _ if text.starts_with('~') => Operand::Tag,
                    _ if text.starts_with('/') => Operand::Phoneme,
                    _ => Operand::Character,
                }
            })
            .collect();
        if let Some(problem) = operand_problem(&name, &kinds) {
            return Err(self.error(node, problem));
        }
        // A string operand is decoded, as a string of a rule is, and a tag
        // literal is its name. operand_problem has refused a range or a
        // property, which has no tag.
        let mut args = Vec::new();
        for &(child, operand) in &operands {
            args.push(match rule_name(child) {
                "argument-word" => self.text(operand).to_string(),
                "argument-string" => self.decode(operand)?,
                _ => self.tag_of(operand)?,
            });
        }
        Ok(Directive { name, args, at: self.at(token) })
    }

    fn rule(&self, node: &'a Node) -> R<RuleDef> {
        let name_token = self.token(self.one(node, "rule-name")?)?;
        let definer = self.token(self.one(node, "definer")?)?;
        let op = match self.text(definer) {
            "%redefine-rule" => Op::Redefine,
            "%extend-rule" => Op::Extend,
            _ => Op::Define,
        };
        // The parts of a definition are read in the order written: the
        // body, then its clauses in their fixed order, and the checks of the
        // whole definition last (§9).
        let mut alternatives = Vec::new();
        for alternative in self.some(self.one(node, "body")?, "alternative", 1)? {
            alternatives.push(self.alternative(alternative)?);
        }
        let tags = match Self::rules(node, "tags-clause").next() {
            Some(clause) => Some(self.constituent_tags(clause)?),
            None => None,
        };
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
            name: self.text(name_token).to_string(),
            op,
            tags,
            alternatives,
            emit,
            conditions,
            opaque: Self::rules(node, "opaque-clause").next().is_some(),
            at: self.at(definer),
        };
        flatten_groups(&mut rule);
        // The definition is checked as a whole once it is read (§9).
        if let Some(problem) = crate::clauses::definition_problem(&rule) {
            return Err(self.error(definer, problem));
        }
        Ok(rule)
    }

    fn alternative(&self, node: &'a Node) -> R<Alternative> {
        // A guard's token is its text: `f?` or `¬f?` for a gate, `f!`
        // for a warning (§9).
        let guards = Self::rules(node, "guard")
            .map(|guard| {
                let text = self.text(self.token(guard)?);
                let (text, kind) = match text.strip_suffix('!') {
                    Some(text) => (text, FeatureKind::Warning),
                    None => (text.trim_end_matches('?'), FeatureKind::Gate),
                };
                Ok(match text.strip_prefix('¬') {
                    Some(feature) => Guard { feature: feature.to_string(), kind, negated: true },
                    None => Guard { feature: text.to_string(), kind, negated: false },
                })
            })
            .collect::<R<_>>()?;
        self.captures.borrow_mut().clear();
        let expr = self.conjunction(self.one(node, "conjunction")?, true)?;
        // A name stands at most once in each production, gates aside: the
        // error stands at the second capture that such a production reads,
        // the first in the text where there are several (§3.5, §9).
        if let Some(&twice) = crate::clauses::duplicate_captures(&expr).first() {
            let capture = self.captures.borrow()[twice];
            let name = self.text(self.token(capture)?).trim_start_matches('$').to_string();
            return Err(
                self.error(capture, format!("the capture ${name} is read twice by one production of the alternative"))
            );
        }
        let tags = match Self::rules(node, "alternative-tags").next() {
            Some(tags) => Some(self.constituent_tags(tags)?),
            None => None,
        };
        Ok(Alternative { guards, expr, tags })
    }

    /// A rule's or an alternative's tags, which say what the constituent's
    /// tags are and so cannot read them: `tags($)` and `classes($)` are
    /// errors anywhere in them, guards included (§9), reported at the
    /// clause.
    fn constituent_tags(&self, node: &'a Node) -> R<Term> {
        let term = self.tag_term(self.one(node, "term")?)?;
        if reads_own_tags(&term) {
            return Err(self.error(node, "a constituent's tags cannot be made of its own tags, tags($) or classes($)"));
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
            Frame::Atom(atom) => self.resume_atom(atom, input),
            Frame::Call(call) => self.resume_call(call, input),
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
            frame.conjunctions = Some(self.some(frame.node, "conjunction", 1)?);
        }
        if let Some(Val::Expr(expr)) = input {
            frame.parts.push(expr);
        }
        let conjunctions = frame.conjunctions.as_ref().expect("the conjunctions");
        match conjunctions.get(frame.parts.len()) {
            Some(&conjunction) => Ok(Step::Call(Frame::Conjunction(Conjunction::new(conjunction, false)))),
            None => Ok(Step::Done(Val::Expr(single_or(std::mem::take(&mut frame.parts), Expr::Choice)))),
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
        let inner = self.inner(node, &PRIMARIES)?;
        let token = || self.token(inner);
        Ok(match rule_name(inner) {
            "reference" | "tag" | "character" | "phoneme" | "range" | "property" => {
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
                if self.text(capture) == "$" {
                    return Err(self.error(capture, "$ is the whole constituent and wraps nothing"));
                }
                let name = self.text(capture).trim_start_matches('$').to_string();
                if !is_capture_name(&name) {
                    return Err(self.error(capture, "a capture's name is all lower case"));
                }
                let wrapped = self.inner(primary, &PRIMARIES)?;
                if rule_name(wrapped) == "constant-reference" {
                    return Err(self.error(wrapped, CONSTANT_IN_BODY));
                }
                if !matches!(
                    rule_name(wrapped),
                    "reference" | "tag" | "character" | "phoneme" | "range" | "property" | "tested"
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
            "constant-reference" => return Err(self.error(inner, CONSTANT_IN_BODY)),
            other => return Err(self.unknown(node, other)),
        })
    }

    /// An optional, and with a marker `+` or `++` among its parts an
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
        let markers: Vec<&Node> =
            Self::tokens_of(node).filter(|token| matches!(self.text(token), "+" | "++")).collect();
        if let Some(second) = markers.get(1) {
            return Err(self.error(second, "an optional has one marker + or ++ at most"));
        }
        let Some(&marker) = markers.first() else {
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
        let leading = Self::tokens_of(choice).any(|token| self.text(token) == "|")
            || (conjunctions.len() == 1 && Self::tokens_of(conjunctions[0]).any(|token| self.text(token) == "&"));
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
        let head = self.inner(primary, &PRIMARIES)?;
        let is_terminal = |symbol: &Node| {
            rule_name(symbol) == "tag"
                || (rule_name(symbol) == "reference"
                    && Self::tokens_of(symbol).next().is_some_and(|token| is_capital(self.text(token))))
        };
        if rule_name(head) == "tested" {
            if !is_terminal(self.inner(self.one(head, "primary")?, &PRIMARIES)?) {
                return Err(form());
            }
            let test = self.one(head, "test")?;
            let comparator: String = Self::tokens_of(test).map(|token| self.text(token)).collect();
            if comparator != "=" {
                return Err(self.error(
                    test,
                    "the terminator of an elidable optional takes no test but =, since elision-only restores it with its sound",
                ));
            }
        } else if !is_terminal(head) {
            return Err(form());
        }
        self.marked.set(self.marked.get() + 1);
        frame.mark = if self.text(marker) == "++" { Mark::Maximal } else { Mark::Elidable };
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
            .filter(|&index| found[index].kind == NodeKind::Token && self.text(found[index]) == "...")
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
    fn resume_tested(&self, frame: &mut Tested<'a>, input: Option<Val>) -> R<Step<'a>> {
        if let Some(Val::Term(value, ty)) = input {
            self.closed_for.set(None);
            let operand = frame.operand.expect("the operand");
            if let Some(problem) = test_type_problem(&frame.op, ty) {
                return Err(self.error(operand, problem));
            }
            if let (true, Term::Str(sound)) = (is_sound_test(&frame.op), &value) {
                if let Some(problem) = sound_problem(sound, self.unicode) {
                    let at = first_of_rule(operand, "string").unwrap_or(operand);
                    return Err(self.error(at, problem.replacen("the string", &format!("the string {sound:?}"), 1)));
                }
            }
            let expr = frame.expr.take().expect("the symbol");
            return Ok(Step::Done(Val::Expr(Expr::Tested(std::mem::take(&mut frame.op), value, Box::new(expr)))));
        }
        let node = frame.node;
        // Its test first, then its primary and the primary's one known part
        // (§9).
        let test = self.one(node, "test")?;
        let symbol = self.inner(self.one(node, "primary")?, &PRIMARIES)?;
        let kind = rule_name(symbol);
        if kind == "constant-reference" {
            return Err(self.error(symbol, CONSTANT_IN_BODY));
        }
        let hash = kind == "reference" && Self::tokens_of(symbol).next().is_some_and(|token| self.text(token) == "#");
        if !matches!(kind, "reference" | "tag" | "character" | "phoneme" | "range" | "property") || hash {
            return Err(self.error(
                test,
                "a test follows only a reference other than # or a terminal, not a group, an optional, braces, a capture, ε, # or another test",
            ));
        }
        frame.expr = Some(self.symbol(symbol)?);
        // The comparator is the test's tokens: `=`, `≠`, `⊇` or `⊉`, or `∩`
        // and `=∅` or `≠∅` around the operand.
        frame.op = Self::tokens_of(test).map(|token| self.text(token)).collect();
        let operand = self.one(test, "test-operand")?;
        frame.operand = Some(operand);
        self.closed_for.set(Some("a test's operand"));
        Ok(Step::Call(Frame::Atom(Atom::new(operand, false))))
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
                if let Some(problem) = expected_problem(ty, Type::Tags) {
                    return Err(self.error(last, problem));
                }
                let mut guarded = term;
                while let Some(cond) = frame.conds.pop() {
                    guarded = Term::If(Box::new(cond), Box::new(guarded));
                }
                Ok(Step::Done(Val::Term(guarded, Type::Tags)))
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
        }
        let parts = frame.parts.as_ref().expect("the parts");
        if let Some(&part) = parts.get(frame.items.len()) {
            return Ok(Step::Call(Frame::Intersection(Joined::new(part, false))));
        }
        let mut operators: Vec<&str> = Self::tokens_of(frame.node)
            .map(|token| self.text(token))
            .filter(|text| matches!(*text, "∪" | "∖"))
            .collect();
        // A leading ∪ is a separator, not an operator.
        while operators.len() >= parts.len() {
            operators.remove(0);
        }
        let operator = if operators.contains(&"∖") { "∖" } else { "∪" };
        let ty = joined_type(&frame.types, operator).map_err(|problem| self.error(frame.node, problem))?;
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
        }
        let atoms = frame.parts.as_ref().expect("the atoms");
        if let Some(&atom) = atoms.get(frame.items.len()) {
            return Ok(Step::Call(Frame::Atom(Atom::new(atom, false))));
        }
        let ty = joined_type(&frame.types, "∩").map_err(|problem| self.error(frame.node, problem))?;
        Ok(Step::Done(Val::Term(Term::Intersection(std::mem::take(&mut frame.items)), ty)))
    }

    fn resume_atom(&self, frame: &mut Atom<'a>, input: Option<Val>) -> R<Step<'a>> {
        if let Some(value) = input {
            // A call, which is no span where a value is due, or a term in
            // parentheses, which is its term.
            if let (Some(inner), Val::Term(call @ Term::Call(..), _)) = (frame.call, &value) {
                if let Term::Call(name, _) = call {
                    if !frame.argument && is_span(call) {
                        return Err(self.error(inner, format!("{name}() gives a span, which is not a value")));
                    }
                }
            }
            return Ok(Step::Done(value));
        }
        let node = frame.node;
        let inner = self.inner(node, &ATOMS)?;
        let token = || self.token(inner);
        let typed = |term: Term, ty: Type| Ok(Step::Done(Val::Term(term, ty)));
        match rule_name(inner) {
            // A span may stand in parentheses where a span is due.
            "term" => Ok(Step::Call(Frame::Term(TermFrame::new(inner, frame.argument)))),
            "string" => typed(Term::Str(self.decode(token()?)?), Type::String),
            "tag" | "character" | "phoneme" => typed(Term::Tag(self.tag_of(token()?)?), Type::Tags),
            "range" => {
                let (start, end) = self.range(inner)?;
                typed(Term::Range(start, end), Type::Tags)
            }
            "property" => {
                Err(self.error(inner, "a property is not a tag set, and stands only as a terminal in a body"))
            }
            // A bare name is a tag literal if it begins with a capital, and
            // otherwise a rule, which only a function's argument names.
            "name" => {
                let name = self.text(token()?);
                if !is_capital(name) {
                    return Err(
                        self.error(inner, format!("{name} names a rule, which is not a value; ~{name} is the tag"))
                    );
                }
                typed(Term::Tag(name.to_string()), Type::Tags)
            }
            "empty-set" => typed(Term::EmptySet, Type::Set),
            // The reader knows no constant's type (§9).
            "constant-reference" => typed(
                Term::Const(self.text(token()?).trim_start_matches('$').to_string(), self.at(token()?)),
                Type::Any,
            ),
            "capture-reference" => {
                let name = self.text(token()?).trim_start_matches('$').to_string();
                if let Some(closed) = self.closed_for.get() {
                    return Err(self.error(inner, format!("{closed} is a closed term, and holds no capture")));
                }
                if !frame.argument {
                    return Err(
                        self.error(inner, format!("a span is not a value: tags(${name}) is the tag set of ${name}"))
                    );
                }
                typed(Term::Capture(name), Type::Span)
            }
            "call" => {
                frame.call = Some(inner);
                Ok(Step::Call(Frame::Call(CallFrame::new(inner, false))))
            }
            other => Err(self.unknown(node, other)),
        }
    }

    /// A call, with its arguments: in a term, of a function that gives a
    /// value or a span, and in a condition, of `matches`, `begins` or
    /// `initial`.
    fn resume_call(&self, frame: &mut CallFrame<'a>, input: Option<Val>) -> R<Step<'a>> {
        let node = frame.node;
        let name_token = match frame.name {
            Some(token) => token,
            None => *frame.name.insert(self.token(node)?),
        };
        if frame.arguments.is_none() {
            let name = self.text(name_token);
            if frame.condition {
                if !matches!(name, "matches" | "begins" | "initial") {
                    let message = if FUNCTIONS.contains(&name) {
                        format!("{name}() is not a condition; only matches(), begins() and initial() are")
                    } else {
                        format!("an unknown function {name}()")
                    };
                    return Err(self.error(name_token, message));
                }
            } else {
                if !FUNCTIONS.contains(&name) {
                    return Err(self.error(name_token, format!("an unknown function {name}()")));
                }
                if let Some(closed) = self.closed_for.get().filter(|_| name == "classify") {
                    return Err(self.error(
                        name_token,
                        format!("{closed} is a closed term, and classify depends on the features"),
                    ));
                }
                if let Some(closed) = self.closed_for.get().filter(|_| name != "split" && name != "tag") {
                    return Err(self.error(name_token, format!("{closed} is a closed term, and {name}() reads a span")));
                }
            }
            frame.arguments = Some(Self::rules(node, "argument").collect());
        }
        if let Some(Val::Arg(arg, ty)) = input {
            frame.args.push(arg);
            frame.types.push(ty);
        }
        let arguments = frame.arguments.as_ref().expect("the arguments");
        if let Some(&argument) = arguments.get(frame.args.len()) {
            return Ok(Step::Call(Frame::Argument(ArgumentFrame { node: argument })));
        }
        let name = self.text(name_token).to_string();
        let mut args = std::mem::take(&mut frame.args);
        if frame.condition {
            let mut args = args.into_iter();
            return Ok(Step::Done(Val::Cond(match (name.as_str(), args.next(), args.next(), args.next()) {
                ("initial", Some(Arg::Term(span)), None, None) if is_span(&span) => Cond::Initial(span),
                ("matches", Some(Arg::Term(span)), Some(Arg::Rule(rule)), None) if is_span(&span) => {
                    Cond::Matches(span, rule)
                }
                ("begins", Some(Arg::Term(span)), Some(Arg::Rule(rule)), None) if is_span(&span) => {
                    Cond::Begins(span, rule)
                }
                ("initial", ..) => return Err(self.error(name_token, "initial() takes one span")),
                _ => return Err(self.error(name_token, format!("{name}() takes a span and a rule"))),
            })));
        }
        let span = |arg: &Arg| matches!(arg, Arg::Term(term) if is_span(term));
        let rule = |arg: &Arg| matches!(arg, Arg::Rule(_));
        // A constant's type is known only when the loader stitches the
        // stage.
        let string_like = |index: usize| matches!(frame.types.get(index), Some(Some(Type::String | Type::Any)));
        let ok = match (name.as_str(), &args[..]) {
            ("tags", [first]) => span(first),
            ("tags" | "matches" | "begins", [first, second]) => span(first) && rule(second),
            ("split", [Arg::Term(_), Arg::Term(_)]) => string_like(0) && string_like(1),
            ("tag", [Arg::Term(_)]) => string_like(0),
            ("classify", [Arg::Term(_), Arg::Rule(_)]) => string_like(0),
            ("matches" | "begins" | "tags" | "split" | "tag" | "classify", _) => false,
            (_, [first]) => span(first),
            _ => false,
        };
        if !ok {
            return Err(self.error(name_token, format!("{name}() is called with the wrong arguments")));
        }
        if matches!(name.as_str(), "matches" | "begins" | "initial") {
            return Err(self.error(name_token, format!("{name}() is a condition, not a term")));
        }
        // An empty delimiter or a tag's name that the reader sees (§9).
        if let Some(problem) = literal_call_problem(&name, &args) {
            return Err(self.error(name_token, problem));
        }
        // The second argument of classify names a classifier, not a rule
        // (engine §9).
        if let (true, [_, Arg::Rule(classifier)]) = (name == "classify", &mut args[..]) {
            let classifier = std::mem::take(classifier);
            args[1] = Arg::Classifier(classifier);
        }
        let ty = call_type(&name);
        Ok(Step::Done(Val::Term(Term::Call(name, args), ty)))
    }

    /// A function's argument: a rule, where it is a bare name without a
    /// capital, alone and perhaps in parentheses, or else a term where a
    /// span may stand.
    fn resume_argument(&self, frame: &mut ArgumentFrame<'a>, input: Option<Val>) -> R<Step<'a>> {
        if let Some(Val::Term(term, ty)) = input {
            return Ok(Step::Done(Val::Arg(Arg::Term(term), Some(ty))));
        }
        let union = self.one(frame.node, "union")?;
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
            let inner = self.inner(frame.node, &CONDITIONS)?;
            frame.inner = Some(inner);
            return Ok(match rule_name(inner) {
                // Parentheses make no node of their own (§9).
                "implication" => Step::Call(Frame::Implication(Conditions::new(inner))),
                "comparison" => {
                    let operands = self.some(inner, "union", 2)?;
                    let comparator = self.one(inner, "comparator")?;
                    frame.op = self.text(self.token(comparator)?).to_string();
                    frame.right = Some(operands[1]);
                    Step::Call(Frame::Union(Joined::new(operands[0], false)))
                }
                "negation" => Step::Call(Frame::Condition(ConditionFrame::new(self.one(inner, "condition")?))),
                "presence" => {
                    let token = self.token(inner)?;
                    Step::Done(Val::Cond(Cond::Captured(self.text(token).trim_start_matches('$').to_string())))
                }
                "call" => Step::Call(Frame::Call(CallFrame::new(inner, true))),
                other => return Err(self.unknown(frame.node, other)),
            });
        };
        let value = input.expect("a part of the condition");
        match rule_name(inner) {
            "comparison" => {
                let Val::Term(term, ty) = value else { unreachable!("a side of a comparison is a term") };
                if let Some(right) = frame.right.take() {
                    frame.left = Some((term, ty));
                    return Ok(Step::Call(Frame::Union(Joined::new(right, false))));
                }
                let (left, left_type) = frame.left.take().expect("the left side");
                // The two sides fit the comparator (engine §10).
                if let Some(problem) = comparison_problem(&frame.op, left_type, ty) {
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

    /// A reference, or a terminal: a tag literal, a character tag, a
    /// phoneme tag, a range or a property.
    fn symbol(&self, node: &'a Node) -> R<Expr> {
        if rule_name(node) == "range" {
            let (start, end) = self.range(node)?;
            return Ok(Expr::Range(start, end));
        }
        let token = self.token(node)?;
        Ok(match rule_name(node) {
            "reference" => Expr::Ref(self.text(token).to_string()),
            "tag" | "character" | "phoneme" => Expr::Terminal(self.tag_of(token)?),
            "property" => Expr::Property(self.property(token)?),
            other => return Err(self.unknown(node, other)),
        })
    }

    /// A range's two ends, each a character tag in its canonical spelling;
    /// its start must not be above its end (engine §1, §9).
    fn range(&self, node: &'a Node) -> R<(String, String)> {
        let mut ends = Vec::new();
        for end in self.some(node, "character", 2)?.into_iter().take(2) {
            ends.push(self.tag_of(self.token(end)?)?);
        }
        let [start, end] = <[String; 2]>::try_from(ends).map_err(|_| self.shape_error(node, "pair of ends"))?;
        if let Some(problem) = range_problem(&start, &end, self.unicode) {
            return Err(self.error(node, problem));
        }
        Ok((start, end))
    }

    /// A property's name: its token is `'\p{Name}'`, with a name of engine
    /// §1.
    fn property(&self, token: &'a Node) -> R<String> {
        let text = self.text(token);
        let name =
            text.strip_prefix("'\\p{").and_then(|rest| rest.strip_suffix("}'")).filter(|name| !name.contains('}'));
        let Some(name) = name else {
            return Err(self.error(token, "a property is written '\\p{Name}'"));
        };
        if let Some(problem) = property_problem(name) {
            return Err(self.error(token, problem));
        }
        Ok(name.to_string())
    }

    /// Decodes a string or a character tag's token (engine §9). A string
    /// escapes its double quote, and a character tag its quote.
    fn decode(&self, token: &'a Node) -> R<String> {
        let text = self.text(token);
        let chars: Vec<char> = text.chars().collect();
        let bad = || self.error(token, format!("a bad escape in {text}"));
        // The token holds its two quotes, unless a notation of another
        // shape gives it some other text.
        let (Some(&quote), Some(body)) = (chars.first(), chars.get(1..chars.len().saturating_sub(1))) else {
            return Err(self.error(token, format!("{text:?} is not quoted")));
        };
        let mut out = String::new();
        let mut index = 0;
        while index < body.len() {
            // Each character or escape counts as it is read.
            work::count(Work::Walked, 1);
            let c = body[index];
            if c != '\\' {
                out.push(c);
                index += 1;
                continue;
            }
            match body.get(index + 1) {
                Some('\\') => out.push('\\'),
                Some(&c) if c == quote => out.push(c),
                Some('u') => {
                    if body.get(index + 2) != Some(&'{') {
                        return Err(bad());
                    }
                    let close = body[index + 3..].iter().position(|&c| c == '}').ok_or_else(bad)? + index + 3;
                    let digits: String = body[index + 3..close].iter().collect();
                    // One to six hexadecimal digits of a Unicode scalar value
                    // (engine §9); char::from_u32 refuses the rest.
                    if digits.is_empty() || digits.len() > 6 || !digits.chars().all(|c| c.is_ascii_hexdigit()) {
                        return Err(bad());
                    }
                    let code = u32::from_str_radix(&digits, 16).map_err(|_| bad())?;
                    out.push(char::from_u32(code).ok_or_else(bad)?);
                    index = close + 1;
                    continue;
                }
                _ => return Err(bad()),
            }
            index += 2;
        }
        Ok(out)
    }

    /// The tag of a tag literal `~name`, a phoneme tag or a character tag's
    /// token, a character tag in its canonical spelling (engine §1, §9).
    fn tag_of(&self, token: &'a Node) -> R<String> {
        let text = self.text(token);
        if let Some(name) = text.strip_prefix('~') {
            return Ok(name.to_string());
        }
        if text.starts_with('/') {
            return Ok(text.to_string());
        }
        let decoded = self.decode(token)?;
        let mut chars = decoded.chars();
        match (chars.next(), chars.next()) {
            (Some(c), None) => Ok(character_tag(c, self.unicode)),
            _ => Err(self.error(token, "a character tag holds exactly one character")),
        }
    }

    fn emission(&self, node: &'a Node) -> R<Vec<EmitItem>> {
        let arrow = self.token(node)?;
        let mut items = Vec::new();
        // `%emits ε` emits nothing, and the constituent does not count.
        let empty = Self::tokens_of(node).any(|token| self.text(token) == "ε");
        for item in if empty { Vec::new() } else { self.some(node, "emit-item", 1)? } {
            // An inserted item is one tag (engine §9).
            let target = self.symbol_part(self.one(item, "emit-target")?)?;
            if target.kind == NodeKind::Rule {
                return Err(self.error(item, "an inserted item is one tag, not a range or a property"));
            }
            let tags = Self::rules(item, "emit-tags").next();
            let text = self.text(target);
            let mut read = match target.terminal.as_deref().unwrap_or("") {
                "capture" => {
                    let name = text.trim_start_matches('$').to_string();
                    // `<term>`, the item's own tags.
                    let tags = match tags {
                        Some(tags) => {
                            let term = self.tag_term(self.one(tags, "term")?)?;
                            if term == Term::EmptySet {
                                return Err(
                                    self.error(item, "<∅> emits a token no terminal can read; %emits ε emits nothing")
                                );
                            }
                            Some(term)
                        }
                        None => None,
                    };
                    EmitItem::Capture(name, tags, Attachments::default())
                }
                terminal => {
                    // An inserted tag is one tag literal (engine §9).
                    let tag = match terminal {
                        "identifier" if is_capital(text) => text.to_string(),
                        "identifier" => {
                            return Err(self.error(
                                item,
                                format!("{text} names a rule; an inserted tag is a tag literal, such as ~{text}"),
                            ))
                        }
                        _ => self.tag_of(target)?,
                    };
                    if tags.is_some() {
                        return Err(self.error(target, "an inserted tag takes no tags of its own"));
                    }
                    EmitItem::Insert(tag)
                }
            };
            // Attachments: named captures in parentheses, before the item and
            // after it, carried only by a named capture (engine §9, §11).
            let before = Self::rules(item, "emit-before").map(|node| self.attachment(node)).collect::<R<Vec<_>>>()?;
            let after = Self::rules(item, "emit-after").map(|node| self.attachment(node)).collect::<R<Vec<_>>>()?;
            if !before.is_empty() || !after.is_empty() {
                match &mut read {
                    EmitItem::Insert(_) => return Err(self.error(item, "an inserted tag carries no attachments")),
                    EmitItem::Capture(name, ..) if name.is_empty() => {
                        return Err(self.error(item, "$ carries no attachments; name a capture"))
                    }
                    EmitItem::Capture(_, _, attachments) => *attachments = Attachments { before, after },
                }
            }
            items.push(read);
        }
        let whole = |item: &EmitItem| matches!(item, EmitItem::Capture(name, ..) if name.is_empty());
        let wholes = items.iter().filter(|item| whole(item)).count();
        if wholes > 0 && wholes < items.len() {
            return Err(self.error(arrow, "$ is used with a capture or an inserted tag"));
        }
        // A capture stands once in an emission, as an item or as an
        // attachment (engine §9).
        let mut named: FxSet<&str> = FxSet::default();
        for item in &items {
            if let EmitItem::Capture(name, _, attachments) = item {
                for name in std::iter::once(name.as_str()).filter(|name| !name.is_empty()).chain(attachments.names()) {
                    if !named.insert(name) {
                        return Err(self.error(arrow, "an emission lists the same capture twice"));
                    }
                }
            }
        }
        Ok(items)
    }

    /// An attachment's capture, by its name without `$`: never `$` itself
    /// (engine §9).
    fn attachment(&self, node: &'a Node) -> R<String> {
        let name = Self::tokens_of(node)
            .map(|token| self.text(token))
            .find(|text| text.starts_with('$'))
            .map_or("", |text| &text[1..]);
        if name.is_empty() {
            return Err(self.error(node, "an attachment holds a named capture, not $"));
        }
        Ok(name.to_string())
    }

    /// The bare name without a capital that a union is alone, if it is one.
    fn rule_name_in(&self, union: &'a Node) -> Option<String> {
        let mut union = union;
        loop {
            let [intersection] = Self::rules(union, "intersection").collect::<Vec<_>>()[..] else { return None };
            let [atom] = Self::rules(intersection, "term-atom").collect::<Vec<_>>()[..] else { return None };
            let inner = self.inner(atom, &ATOMS).ok()?;
            match rule_name(inner) {
                "name" => {
                    let name = self.text(Self::tokens_of(inner).next()?);
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
    Atom(Atom<'a>),
    Call(CallFrame<'a>),
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
    node: &'a Node,
    conjunctions: Option<Vec<&'a Node>>,
    parts: Vec<Expr>,
}

impl<'a> Choice<'a> {
    fn new(node: &'a Node) -> Self {
        Choice { node, conjunctions: None, parts: Vec::new() }
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
    op: String,
    operand: Option<&'a Node>,
    expr: Option<Expr>,
}

impl<'a> Tested<'a> {
    fn new(node: &'a Node) -> Self {
        Tested { node, op: String::new(), operand: None, expr: None }
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
    /// The call, if it asked for one.
    call: Option<&'a Node>,
}

impl<'a> Atom<'a> {
    fn new(node: &'a Node, argument: bool) -> Self {
        Atom { node, argument, call: None }
    }
}

struct CallFrame<'a> {
    node: &'a Node,
    /// Whether the call stands as a condition.
    condition: bool,
    /// The token of its name, found once, since finding it collects every
    /// part of the call.
    name: Option<&'a Node>,
    arguments: Option<Vec<&'a Node>>,
    args: Vec<Arg>,
    types: Vec<Option<Type>>,
}

impl<'a> CallFrame<'a> {
    fn new(node: &'a Node, condition: bool) -> Self {
        CallFrame { node, condition, name: None, arguments: None, args: Vec::new(), types: Vec::new() }
    }
}

struct ArgumentFrame<'a> {
    node: &'a Node,
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
const KNOWN: [&str; 67] = [
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
    "rule-name",
    "body",
    "alternative",
    "guard",
    "alternative-tags",
    "choice",
    "conjunction",
    "sequence",
    "primary",
    "repetition",
    "reference",
    "tag",
    "character",
    "phoneme",
    "range",
    "property",
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
    "opaque-clause",
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
    "call",
    "argument",
    "term",
    "guarded-term",
    "union",
    "intersection",
    "term-atom",
    "string",
    "name",
    "empty-set",
    "capture-reference",
];

/// What a primary, a condition, a term and a term atom hold: the one rule
/// among their parts is one of these (engine §9).
const PRIMARIES: [&str; 13] = [
    "reference",
    "tag",
    "character",
    "phoneme",
    "range",
    "property",
    "tested",
    "capture",
    "group",
    "optional",
    "repetition",
    "empty",
    "constant-reference",
];
const CONDITIONS: [&str; 5] = ["comparison", "call", "negation", "presence", "implication"];
const TERMS: [&str; 2] = ["union", "guarded-term"];
const ATOMS: [&str; 12] = [
    "string",
    "tag",
    "character",
    "phoneme",
    "range",
    "property",
    "name",
    "empty-set",
    "term",
    "call",
    "capture-reference",
    "constant-reference",
];

/// The functions of the notation (engine §9).
const FUNCTIONS: [&str; 15] = [
    "phonemes", "text", "split", "tag", "tags", "classes", "classify", "head", "tail", "last", "from", "after",
    "matches", "begins", "initial",
];

/// Whether a name begins with a capital, and so is a terminal and a tag
/// literal (engine §2).
fn is_capital(name: &str) -> bool {
    name.starts_with(|c: char| c.is_ascii_uppercase())
}

/// Whether a term is a span: a capture, or `head`, `tail`, `last`, `from`
/// or `after` of one.
fn is_span(term: &Term) -> bool {
    match term {
        Term::Capture(_) => true,
        Term::Call(name, _) => matches!(name.as_str(), "head" | "tail" | "last" | "from" | "after"),
        _ => false,
    }
}

/// Whether a tag term, or a condition inside one, reads the tags of `$`,
/// the constituent whose tags it defines: `$` as a value, `tags($)` or
/// `classes($)` (§9). A span argument such as `phonemes($)` reads tokens,
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
                Term::Str(_) | Term::Tag(_) | Term::Range(..) | Term::EmptySet | Term::Const(..) => {}
            },
            Part::Cond(cond) => match cond {
                Cond::Compare(_, left, right) => stack.extend([Part::Term(left), Part::Term(right)]),
                Cond::Not(inner) => stack.push(Part::Cond(inner)),
                Cond::Any(items) | Cond::All(items) => stack.extend(items.iter().map(Part::Cond)),
                Cond::If(antecedent, consequent) => stack.extend([Part::Cond(antecedent), Part::Cond(consequent)]),
                Cond::Matches(..) | Cond::Begins(..) | Cond::Initial(_) | Cond::Captured(_) => {}
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
                Cond::Matches(span, _) | Cond::Begins(span, _) | Cond::Initial(span) => stack.push(PartMut::Term(span)),
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

/// A directive's operand: a bare name, with a capital or not, a string, a
/// tag literal `~name`, a phoneme tag, a character tag, a range or a
/// property.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Operand {
    Name,
    Class,
    String,
    Tag,
    Phoneme,
    Character,
    Range,
    Property,
}

/// What is wrong with a directive's operands, or `None` (engine §9).
fn operand_problem(name: &str, kinds: &[Operand]) -> Option<String> {
    let names = kinds.iter().all(|kind| matches!(kind, Operand::Name | Operand::Class));
    let (ok, problem) = match name {
        "stage" => (kinds.len() == 1 && names, "%stage takes one name".to_string()),
        "include" => (kinds == [Operand::String], "%include takes one string".to_string()),
        "features" => (!kinds.is_empty() && names, "%features takes one or more names".to_string()),
        _ => (names, format!("%{name} takes names only")),
    };
    (!ok).then_some(problem)
}
