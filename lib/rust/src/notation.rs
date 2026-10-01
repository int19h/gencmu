//! From the notation's document tree to a grammar DOM (engine §9).

use crate::dom::{
    comparison_problem, cond_type_problem, constant_value_type, expected_problem, is_capture_name, is_classifier_name,
    is_sound_test, joined_type, literal_call_problem, property_problem, range_problem, sound_problem, tag_term_problem,
    term_type, test_type_problem, Alternative, Arg, Attachments, ClassifierDef, Cond, ConstDef, Directive, Dom,
    EmitItem, Entry, Expr, FeatureKind, Guard, ImplicationDef, Op, RuleDef, Term, Type,
};
use crate::error::Error;
use crate::result::{Node, NodeKind, Token};
use crate::tags::character_tag;
use crate::unicode::Unicode;

/// How deeply constructs may nest before the reader gives up, so that a
/// pathological document cannot exhaust the stack of the thread that reads
/// it (see `loader::read_document`). A construct costs a few levels, and
/// parentheses nest without nesting the DOM, so this is well above the 256
/// of engine §9, which the DOM is checked against afterwards.
const MAX_DEPTH: usize = 12_000;

pub(crate) struct Reader<'a> {
    pub tokens: &'a [Token],
    /// The capture names of the alternative being read.
    pub captures: std::cell::RefCell<Vec<String>>,
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

    fn deeper(&self, node: &'a Node, depth: usize) -> R<usize> {
        if depth > MAX_DEPTH {
            Err(self.error(node, "constructs nest too deeply"))
        } else {
            Ok(depth + 1)
        }
    }

    fn rules<'n>(node: &'n Node, name: &'n str) -> impl Iterator<Item = &'n Node> + 'n {
        node.children.iter().filter(move |child| child.kind == NodeKind::Rule && rule_name(child) == name)
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

    fn one<'n>(&self, node: &'n Node, name: &str) -> R<&'n Node> {
        node.children
            .iter()
            .find(|child| child.kind == NodeKind::Rule && rule_name(child) == name)
            .ok_or_else(|| self.shape_error(node, name))
    }

    fn tokens_of(node: &Node) -> impl Iterator<Item = &Node> + '_ {
        node.children.iter().filter(|child| child.kind == NodeKind::Token)
    }

    /// The first token of a node.
    fn token<'n>(&self, node: &'n Node) -> R<&'n Node> {
        Self::tokens_of(node).next().ok_or_else(|| self.shape_error(node, "token"))
    }

    /// The only rule child of a transparent node.
    fn inner<'n>(&self, node: &'n Node) -> R<&'n Node> {
        node.children.iter().find(|child| child.kind == NodeKind::Rule).ok_or_else(|| self.shape_error(node, "content"))
    }

    pub(crate) fn document(&self, root: &'a Node) -> R<Dom> {
        let mut dom = Dom::default();
        let mut stack: Vec<&Node> = root.children.iter().rev().collect();
        while let Some(node) = stack.pop() {
            if node.kind != NodeKind::Rule {
                continue;
            }
            match rule_name(node) {
                "rule" => dom.rules.push(self.rule(node)?),
                "directive" => dom.directives.push(self.directive(node)?),
                "constant-definition" => dom.constants.push(self.constant(node)?),
                "classifier" => dom.classifiers.push(self.classifier(node)?),
                "implication-declaration" => dom.implications.push(self.implication_declaration(node)?),
                _ => stack.extend(node.children.iter().rev()),
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
        for key_node in Self::rules(node, "classifier-key") {
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
        for side in Self::rules(node, "union") {
            self.closed_for.set(Some("a side of an implication"));
            let term = self.union(side, 0, false);
            self.closed_for.set(None);
            let term = term?;
            let problem = match term_type(&term) {
                Err(problem) => Some(problem),
                Ok(ty) => expected_problem(ty, Type::Tags),
            };
            if let Some(problem) = problem {
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
        let value = self.term(value_node, 0, false);
        self.closed_for.set(None);
        let value = value?;
        if let Err(fault) = constant_value_type(&value, redefine, &|_| Type::Any) {
            return Err(self.error(value_node, fault.problem));
        }
        Ok(ConstDef { name, redefine, value, at: self.at(definer) })
    }

    fn directive(&self, node: &'a Node) -> R<Directive> {
        let keyword = Self::rules(node, "directive-name").next().unwrap_or(node);
        let token = self.token(keyword)?;
        let name = self.text(token).trim_start_matches('%').to_string();
        let operands: Vec<(&Node, &Node)> = node
            .children
            .iter()
            .filter(|child| {
                child.kind == NodeKind::Rule
                    && matches!(rule_name(child), "argument-word" | "argument-string" | "argument-tag")
            })
            // A token, or the node of a range or a property.
            .map(|child| {
                child.children.first().map(|operand| (child, operand)).ok_or_else(|| self.shape_error(child, "operand"))
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
        let tags = match Self::rules(node, "tags-clause").next() {
            Some(clause) => Some(self.constituent_tags(clause)?),
            None => None,
        };
        let mut alternatives = Vec::new();
        for alternative in Self::rules(self.one(node, "body")?, "alternative") {
            alternatives.push(self.alternative(alternative)?);
        }
        let emit = match Self::rules(node, "emits-clause").next() {
            Some(clause) => Some(self.emission(clause)?),
            None => None,
        };
        // Each condition of the list is one condition (§9).
        let mut conditions = Vec::new();
        if let Some(clause) = Self::rules(node, "conditions-clause").next() {
            for implication in Self::rules(clause, "implication") {
                conditions.push(self.implication(implication, 0)?);
            }
        }
        let rule = RuleDef {
            name: self.text(name_token).to_string(),
            op,
            tags,
            alternatives,
            emit,
            conditions,
            opaque: Self::rules(node, "opaque-clause").next().is_some(),
            at: self.at(definer),
        };
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
        let expr = self.conjunction(self.one(node, "conjunction")?, 0, true)?;
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
        let term = self.term(node, 0, false)?;
        if let Some(problem) = tag_term_problem(&term) {
            return Err(self.error(node, problem));
        }
        Ok(term)
    }

    /// `top` is whether this is an alternative's own expression, whose
    /// sequence's items may be captures (engine §3.5), unless it is an `&`.
    fn conjunction(&self, node: &'a Node, depth: usize, top: bool) -> R<Expr> {
        let depth = self.deeper(node, depth)?;
        let top = top && Self::rules(node, "sequence").count() == 1;
        let mut parts = Vec::new();
        for sequence in Self::rules(node, "sequence") {
            let mut elements = Vec::new();
            for element in Self::rules(sequence, "element") {
                elements.push(self.element(element, depth, top)?);
            }
            parts.push(single_or(elements, Expr::Seq));
        }
        if parts.len() > crate::grammar::MAX_AND {
            return Err(self.error(
                node,
                format!("an & of {} items; at most {} are allowed", parts.len(), crate::grammar::MAX_AND),
            ));
        }
        Ok(single_or(parts, Expr::And))
    }

    fn choice(&self, node: &'a Node, depth: usize) -> R<Expr> {
        let depth = self.deeper(node, depth)?;
        let mut parts = Vec::new();
        for conjunction in Self::rules(node, "conjunction") {
            parts.push(self.conjunction(conjunction, depth, false)?);
        }
        Ok(single_or(parts, Expr::Choice))
    }

    fn element(&self, node: &'a Node, depth: usize, top: bool) -> R<Expr> {
        let repeated = Self::tokens_of(node).any(|token| self.text(token) == "...");
        let primary = self.primary(self.one(node, "primary")?, depth, top && !repeated)?;
        Ok(match (repeated, primary) {
            (false, primary) => primary,
            (true, Expr::Optional(inner)) => Expr::Repeat(inner, 0),
            (true, primary) => Expr::Repeat(Box::new(primary), 1),
        })
    }

    /// `top` is whether a capture may stand here (engine §3.5).
    fn primary(&self, node: &'a Node, depth: usize, top: bool) -> R<Expr> {
        let depth = self.deeper(node, depth)?;
        let inner = self.inner(node)?;
        let token = || self.token(inner);
        Ok(match rule_name(inner) {
            "reference" | "tag" | "character" | "phoneme" | "range" | "property" => self.symbol(inner)?,
            "tested" => self.tested(inner, depth)?,
            "capture" => {
                let capture = token()?;
                if self.text(capture) == "$" {
                    return Err(self.error(capture, "$ is the whole constituent and wraps nothing"));
                }
                let name = self.text(capture).trim_start_matches('$').to_string();
                if !is_capture_name(&name) {
                    return Err(self.error(capture, "a capture's name is all lower case"));
                }
                let primary = self.one(inner, "primary")?;
                let wrapped = self.inner(primary)?;
                if rule_name(wrapped) == "constant-reference" {
                    return Err(self.error(wrapped, CONSTANT_IN_BODY));
                }
                if !matches!(
                    rule_name(wrapped),
                    "reference" | "tag" | "character" | "phoneme" | "range" | "property" | "tested"
                ) {
                    return Err(self.error(capture, "a capture must wrap a single symbol"));
                }
                if !top {
                    return Err(self.error(
                        capture,
                        "a capture stands at the top level of an alternative, not inside [ ], ( ), ..., & or a choice",
                    ));
                }
                if self.captures.borrow().contains(&name) {
                    return Err(self.error(capture, format!("the capture ${name} is used twice in one alternative")));
                }
                self.captures.borrow_mut().push(name.clone());
                if self.captures.borrow().len() > 4 {
                    return Err(self.error(capture, "an alternative has at most four captures"));
                }
                Expr::Capture(name, Box::new(self.primary(primary, depth, false)?))
            }
            "group" => self.choice(self.one(inner, "choice")?, depth)?,
            "optional" => Expr::Optional(Box::new(self.choice(self.one(inner, "choice")?, depth)?)),
            "empty" => Expr::Empty,
            "constant-reference" => return Err(self.error(inner, CONSTANT_IN_BODY)),
            other => return Err(self.unknown(node, other)),
        })
    }

    /// A reference other than `#` or a terminal, and one test on its own
    /// span (engine §2, §9). The syntax grammar reads a test after any
    /// primary, so that the reader can name the reason.
    fn tested(&self, node: &'a Node, depth: usize) -> R<Expr> {
        let symbol = self.inner(self.one(node, "primary")?)?;
        let test = self.one(node, "test")?;
        let kind = rule_name(symbol);
        if kind == "constant-reference" {
            return Err(self.error(symbol, CONSTANT_IN_BODY));
        }
        let hash = kind == "reference" && Self::tokens_of(symbol).next().is_some_and(|token| self.text(token) == "#");
        if !matches!(kind, "reference" | "tag" | "character" | "phoneme" | "range" | "property") || hash {
            return Err(self.error(
                test,
                "a test follows only a reference other than # or a terminal, not a group, an optional, a capture, ε, # or another test",
            ));
        }
        let expr = self.symbol(symbol)?;
        // The comparator is the test's tokens: `=`, `≠`, `⊇` or `⊉`, or `∩`
        // and `=∅` or `≠∅` around the operand.
        let mut op = String::new();
        let mut stack = vec![test];
        while let Some(current) = stack.pop() {
            if current.kind == NodeKind::Token {
                op.push_str(self.text(current));
            } else if rule_name(current) != "test-operand" {
                stack.extend(current.children.iter().rev());
            }
        }
        let operand = self.one(test, "test-operand")?;
        self.closed_for.set(Some("a test's operand"));
        let value = self.atom(operand, depth, false);
        self.closed_for.set(None);
        let value = value?;
        let problem = match term_type(&value) {
            Err(problem) => Some(problem),
            Ok(ty) => test_type_problem(&op, ty),
        };
        if let Some(problem) = problem {
            return Err(self.error(operand, problem));
        }
        if let (true, Term::Str(sound)) = (is_sound_test(&op), &value) {
            if let Some(problem) = sound_problem(sound, self.unicode) {
                let at = first_of_rule(operand, "string").unwrap_or(operand);
                return Err(self.error(at, problem.replacen("the string", &format!("the string {sound:?}"), 1)));
            }
        }
        Ok(Expr::Tested(op, value, Box::new(expr)))
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
        for end in Self::rules(node, "character") {
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
        for item in Self::rules(node, "emit-item") {
            // An inserted item is one tag (engine §9).
            let target = self.one(item, "emit-target")?;
            let target = target.children.first().ok_or_else(|| self.shape_error(target, "content"))?;
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
        let mut named: Vec<&str> = Vec::new();
        for item in &items {
            if let EmitItem::Capture(name, _, attachments) = item {
                for name in std::iter::once(name.as_str()).filter(|name| !name.is_empty()).chain(attachments.names()) {
                    if named.contains(&name) {
                        return Err(self.error(arrow, "an emission lists the same capture twice"));
                    }
                    named.push(name);
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

    /// `A ⟹ B`, grouping to the right: `if` of its `any-of` and the
    /// implication after `⟹`, or the one `any-of` itself.
    fn implication(&self, node: &'a Node, depth: usize) -> R<Cond> {
        let depth = self.deeper(node, depth)?;
        let antecedent = self.any_of(self.one(node, "any-of")?, depth)?;
        Ok(match Self::rules(node, "implication").next() {
            Some(consequent) => Cond::If(Box::new(antecedent), Box::new(self.implication(consequent, depth)?)),
            None => antecedent,
        })
    }

    /// Conditions joined by `∨`: `any` of its `all-of`s, or the one itself.
    fn any_of(&self, node: &'a Node, depth: usize) -> R<Cond> {
        let depth = self.deeper(node, depth)?;
        let mut parts = Vec::new();
        for all_of in Self::rules(node, "all-of") {
            // A parenthesized group of the same connective makes no node
            // of its own: its conditions take its place (§9).
            match self.all_of(all_of, depth)? {
                Cond::Any(items) => parts.extend(items),
                other => parts.push(other),
            }
        }
        Ok(single_or(parts, Cond::Any))
    }

    /// Conditions joined by `∧`: `all` of them, or the one itself.
    fn all_of(&self, node: &'a Node, depth: usize) -> R<Cond> {
        let depth = self.deeper(node, depth)?;
        let mut parts = Vec::new();
        for condition in Self::rules(node, "condition") {
            // A parenthesized group of the same connective makes no node
            // of its own: its conditions take its place (§9).
            match self.condition(condition, depth)? {
                Cond::All(items) => parts.extend(items),
                other => parts.push(other),
            }
        }
        Ok(single_or(parts, Cond::All))
    }

    fn condition(&self, node: &'a Node, depth: usize) -> R<Cond> {
        let depth = self.deeper(node, depth)?;
        let inner = self.inner(node)?;
        match rule_name(inner) {
            // Parentheses make no node of their own (§9).
            "implication" => self.implication(inner, depth),
            "comparison" => {
                let operands: Vec<&Node> = Self::rules(inner, "union").collect();
                let comparator = self.one(inner, "comparator")?;
                let op = self.text(self.token(comparator)?).to_string();
                let [left, right] = operands[..] else {
                    return Err(self.shape_error(inner, "pair of operands"));
                };
                let left = self.union(left, depth, false)?;
                let right = self.union(right, depth, false)?;
                // The two sides fit the comparator (engine §10).
                let problem = match (term_type(&left), term_type(&right)) {
                    (Err(problem), _) | (_, Err(problem)) => Some(problem),
                    (Ok(left), Ok(right)) => comparison_problem(&op, left, right),
                };
                if let Some(problem) = problem {
                    return Err(self.error(inner, problem));
                }
                Ok(Cond::Compare(op, left, right))
            }
            "negation" => Ok(Cond::Not(Box::new(self.condition(self.one(inner, "condition")?, depth)?))),
            "presence" => {
                let token = self.token(inner)?;
                Ok(Cond::Captured(self.text(token).trim_start_matches('$').to_string()))
            }
            "call" => {
                let name_token = self.token(inner)?;
                let name = self.text(name_token);
                if !matches!(name, "matches" | "begins" | "initial") {
                    let message = if FUNCTIONS.contains(&name) {
                        format!("{name}() is not a condition; only matches(), begins() and initial() are")
                    } else {
                        format!("an unknown function {name}()")
                    };
                    return Err(self.error(name_token, message));
                }
                let mut args = Vec::new();
                for argument in Self::rules(inner, "argument") {
                    args.push(self.argument(argument, depth)?);
                }
                match (name, &mut args[..]) {
                    ("initial", [Arg::Term(span)]) if is_span(span) => Ok(Cond::Initial(span.clone())),
                    ("matches", [Arg::Term(span), Arg::Rule(rule)]) if is_span(span) => {
                        Ok(Cond::Matches(span.clone(), std::mem::take(rule)))
                    }
                    ("begins", [Arg::Term(span), Arg::Rule(rule)]) if is_span(span) => {
                        Ok(Cond::Begins(span.clone(), std::mem::take(rule)))
                    }
                    ("initial", _) => Err(self.error(name_token, "initial() takes one span")),
                    _ => Err(self.error(name_token, format!("{name}() takes a span and a rule"))),
                }
            }
            other => Err(self.unknown(node, other)),
        }
    }

    /// A function's argument: a rule, where it is a bare name without a
    /// capital, alone and perhaps in parentheses, or else a term where a
    /// span may stand.
    fn argument(&self, node: &'a Node, depth: usize) -> R<Arg> {
        let union = self.one(node, "union")?;
        if let Some(rule) = self.rule_name_in(union) {
            return Ok(Arg::Rule(rule));
        }
        Ok(Arg::Term(self.union(union, depth, true)?))
    }

    /// The bare name without a capital that a union is alone, if it is one.
    fn rule_name_in(&self, union: &'a Node) -> Option<String> {
        let mut union = union;
        loop {
            let [intersection] = Self::rules(union, "intersection").collect::<Vec<_>>()[..] else { return None };
            let [atom] = Self::rules(intersection, "term-atom").collect::<Vec<_>>()[..] else { return None };
            let inner = atom.children.iter().find(|child| child.kind == NodeKind::Rule)?;
            match rule_name(inner) {
                "name" => {
                    let name = self.text(Self::tokens_of(inner).next()?);
                    return (!is_capital(name)).then(|| name.to_string());
                }
                "term" => {
                    let inner = self.inner(inner).ok()?;
                    if rule_name(inner) != "union" {
                        return None;
                    }
                    union = inner;
                }
                _ => return None,
            }
        }
    }

    /// A `term`: its union, or its guarded term, `if` of its condition and
    /// its term (§9). `argument` is whether a span may stand here.
    fn term(&self, node: &'a Node, depth: usize, argument: bool) -> R<Term> {
        let depth = self.deeper(node, depth)?;
        let inner = self.inner(node)?;
        match rule_name(inner) {
            "guarded-term" => {
                if let Some(closed) = self.closed_for.get() {
                    return Err(self.error(inner, format!("{closed} is a closed term, and holds no guarded term")));
                }
                let depth = self.deeper(inner, depth)?;
                let cond = self.any_of(self.one(inner, "any-of")?, depth)?;
                if let Some(problem) = cond_type_problem(&cond) {
                    return Err(self.error(inner, problem));
                }
                let then = self.term(self.one(inner, "term")?, depth, false)?;
                let guarded = Term::If(Box::new(cond), Box::new(then));
                if let Err(problem) = term_type(&guarded) {
                    return Err(self.error(inner, problem));
                }
                Ok(guarded)
            }
            _ => self.union(inner, depth, argument),
        }
    }

    /// Parts joined by `∪` and `∖`, which group from the left: a run joined
    /// by `∪` is one union, and each `∖` takes what stands before it (§9).
    fn union(&self, node: &'a Node, depth: usize, argument: bool) -> R<Term> {
        let depth = self.deeper(node, depth)?;
        let parts: Vec<&Node> = Self::rules(node, "intersection").collect();
        match parts[..] {
            [] => return Err(self.shape_error(node, "intersection")),
            [part] => return self.intersection(part, depth, argument),
            _ => {}
        }
        let mut operators: Vec<&str> =
            Self::tokens_of(node).map(|token| self.text(token)).filter(|text| matches!(*text, "∪" | "∖")).collect();
        // A leading ∪ is a separator, not an operator.
        while operators.len() >= parts.len() {
            operators.remove(0);
        }
        let mut items = Vec::new();
        for part in &parts {
            items.push(self.intersection(part, depth, false)?);
        }
        let types = items.iter().map(term_type).collect::<Result<Vec<_>, _>>().map_err(|p| self.error(node, p))?;
        let operator = if operators.contains(&"∖") { "∖" } else { "∪" };
        joined_type(&types, operator).map_err(|problem| self.error(node, problem))?;
        let mut items = items.into_iter();
        let Some(mut result) = items.next() else {
            return Err(self.shape_error(node, "part"));
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
        Ok(result)
    }

    fn intersection(&self, node: &'a Node, depth: usize, argument: bool) -> R<Term> {
        let depth = self.deeper(node, depth)?;
        let atoms: Vec<&Node> = Self::rules(node, "term-atom").collect();
        match atoms[..] {
            [] => return Err(self.shape_error(node, "term-atom")),
            [atom] => return self.atom(atom, depth, argument),
            _ => {}
        }
        let mut items = Vec::new();
        for atom in atoms {
            items.push(self.atom(atom, depth, false)?);
        }
        let types = items.iter().map(term_type).collect::<Result<Vec<_>, _>>().map_err(|p| self.error(node, p))?;
        joined_type(&types, "∩").map_err(|problem| self.error(node, problem))?;
        Ok(Term::Intersection(items))
    }

    fn atom(&self, node: &'a Node, depth: usize, argument: bool) -> R<Term> {
        let depth = self.deeper(node, depth)?;
        let inner = self.inner(node)?;
        let token = || self.token(inner);
        Ok(match rule_name(inner) {
            // A span may stand in parentheses where a span is due.
            "term" => self.term(inner, depth, argument)?,
            "string" => Term::Str(self.decode(token()?)?),
            "tag" | "character" | "phoneme" => Term::Tag(self.tag_of(token()?)?),
            "range" => {
                let (start, end) = self.range(inner)?;
                Term::Range(start, end)
            }
            "property" => {
                return Err(self.error(inner, "a property is not a tag set, and stands only as a terminal in a body"))
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
                Term::Tag(name.to_string())
            }
            "empty-set" => Term::EmptySet,
            "constant-reference" => {
                Term::Const(self.text(token()?).trim_start_matches('$').to_string(), self.at(token()?))
            }
            "capture-reference" => {
                let name = self.text(token()?).trim_start_matches('$').to_string();
                if let Some(closed) = self.closed_for.get() {
                    return Err(self.error(inner, format!("{closed} is a closed term, and holds no capture")));
                }
                if !argument {
                    return Err(
                        self.error(inner, format!("a span is not a value: tags(${name}) is the tag set of ${name}"))
                    );
                }
                Term::Capture(name)
            }
            "call" => {
                let call = self.call(inner, depth)?;
                if let Term::Call(name, _) = &call {
                    if !argument && is_span(&call) {
                        return Err(self.error(inner, format!("{name}() gives a span, which is not a value")));
                    }
                }
                call
            }
            other => return Err(self.unknown(node, other)),
        })
    }

    fn call(&self, node: &'a Node, depth: usize) -> R<Term> {
        let name_token = self.token(node)?;
        let name = self.text(name_token).to_string();
        if !FUNCTIONS.contains(&name.as_str()) {
            return Err(self.error(name_token, format!("an unknown function {name}()")));
        }
        if let Some(closed) = self.closed_for.get().filter(|_| name == "classify") {
            return Err(
                self.error(name_token, format!("{closed} is a closed term, and classify depends on the features"))
            );
        }
        if let Some(closed) = self.closed_for.get().filter(|_| name != "split" && name != "tag") {
            return Err(self.error(name_token, format!("{closed} is a closed term, and {name}() reads a span")));
        }
        let mut args = Vec::new();
        for argument in Self::rules(node, "argument") {
            args.push(self.argument(argument, depth)?);
        }
        let span = |arg: &Arg| matches!(arg, Arg::Term(term) if is_span(term));
        let rule = |arg: &Arg| matches!(arg, Arg::Rule(_));
        let ok = match (name.as_str(), &args[..]) {
            ("tags", [first]) => span(first),
            ("tags" | "matches" | "begins", [first, second]) => span(first) && rule(second),
            // A constant's type is known only when the loader stitches the
            // stage.
            ("split", [Arg::Term(a), Arg::Term(d)]) => [a, d].iter().all(|term| string_like(term)),
            ("tag", [Arg::Term(term)]) => string_like(term),
            ("classify", [Arg::Term(term), Arg::Rule(_)]) => string_like(term),
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
        Ok(Term::Call(name, args))
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
    if node.kind == NodeKind::Rule && rule_name(node) == name {
        return Some(node);
    }
    node.children.iter().find_map(|child| first_of_rule(child, name))
}

/// The functions of the notation (engine §9).
const FUNCTIONS: [&str; 15] = [
    "phonemes", "text", "split", "tag", "tags", "classes", "classify", "head", "tail", "last", "from", "after",
    "matches", "begins", "initial",
];

/// Whether a term is a string, or a constant that may be one (engine §9).
fn string_like(term: &Term) -> bool {
    matches!(term_type(term), Ok(Type::String | Type::Any))
}

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
    match term {
        Term::Capture(name) => name.is_empty(),
        Term::Call(name, args) => {
            matches!(name.as_str(), "tags" | "classes")
                && matches!(&args[..], [Arg::Term(Term::Capture(name))] if name.is_empty())
        }
        Term::Union(items) | Term::Intersection(items) => items.iter().any(reads_own_tags),
        Term::Difference(left, right) => reads_own_tags(left) || reads_own_tags(right),
        Term::If(cond, then) => cond_reads_own_tags(cond) || reads_own_tags(then),
        Term::Str(_) | Term::Tag(_) | Term::Range(..) | Term::EmptySet | Term::Const(..) => false,
    }
}

fn cond_reads_own_tags(cond: &Cond) -> bool {
    match cond {
        Cond::Compare(_, left, right) => reads_own_tags(left) || reads_own_tags(right),
        Cond::Not(inner) => cond_reads_own_tags(inner),
        Cond::Any(items) | Cond::All(items) => items.iter().any(cond_reads_own_tags),
        Cond::If(antecedent, consequent) => cond_reads_own_tags(antecedent) || cond_reads_own_tags(consequent),
        Cond::Matches(..) | Cond::Begins(..) | Cond::Initial(_) | Cond::Captured(_) => false,
    }
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
        // Identifier tags: a name with a capital, or `~name`.
        "elidable" => (
            kinds.iter().all(|kind| matches!(kind, Operand::Class | Operand::Tag)),
            "%elidable takes identifier tags: names with a capital, or ~name".to_string(),
        ),
        _ => (names, format!("%{name} takes names only")),
    };
    (!ok).then_some(problem)
}
