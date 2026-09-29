//! From the notation's document tree to a grammar DOM (engine §9).

use crate::dom::{
    comparison_problem, cond_type_problem, is_capture_name, joined_type, spelling_problem, tag_term_problem, term_type,
    Alternative, Arg, Cond, Directive, Dom, EmitItem, Expr, FeatureKind, Guard, Op, RuleDef, Term, Type,
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
    /// The lowercase mapping that spellings are checked against (engine
    /// §9, §10).
    pub unicode: &'a Unicode,
}

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
    fn first(&self, node: &'a Node) -> (usize, usize) {
        let mut current = node;
        while current.kind == NodeKind::Rule {
            match current.children.first() {
                Some(child) => current = child,
                None => break,
            }
        }
        self.at(current)
    }

    fn error(&self, node: &'a Node, message: impl Into<String>) -> Error {
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

    fn one<'n>(&self, node: &'n Node, name: &str) -> &'n Node {
        node.children
            .iter()
            .find(|child| child.kind == NodeKind::Rule && rule_name(child) == name)
            .unwrap_or_else(|| panic!("the notation's {} has no {name}", rule_name(node)))
    }

    fn tokens_of(node: &Node) -> impl Iterator<Item = &Node> + '_ {
        node.children.iter().filter(|child| child.kind == NodeKind::Token)
    }

    /// The only rule child of a transparent node.
    fn inner(node: &Node) -> &Node {
        node.children
            .iter()
            .find(|child| child.kind == NodeKind::Rule)
            .unwrap_or_else(|| panic!("the notation's {} has no content", rule_name(node)))
    }

    pub(crate) fn document(&self, root: &'a Node) -> R<Dom> {
        let mut dom = Dom { rules: Vec::new(), directives: Vec::new() };
        let mut stack: Vec<&Node> = root.children.iter().rev().collect();
        while let Some(node) = stack.pop() {
            if node.kind != NodeKind::Rule {
                continue;
            }
            match rule_name(node) {
                "rule" => dom.rules.push(self.rule(node)?),
                "directive" => dom.directives.push(self.directive(node)?),
                _ => stack.extend(node.children.iter().rev()),
            }
        }
        Ok(dom)
    }

    fn directive(&self, node: &'a Node) -> R<Directive> {
        let keyword = Self::rules(node, "directive-name").next().unwrap_or(node);
        let token = Self::tokens_of(keyword).next().expect("a directive keyword");
        let name = self.text(token).trim_start_matches('%').to_string();
        let operands: Vec<(&Node, &Node)> = node
            .children
            .iter()
            .filter(|child| {
                child.kind == NodeKind::Rule
                    && matches!(rule_name(child), "argument-word" | "argument-string" | "argument-tag")
            })
            .map(|child| (child, Self::tokens_of(child).next().expect("an argument")))
            .collect();
        let kinds: Vec<Operand> = operands
            .iter()
            .map(|&(child, operand)| {
                let text = self.text(operand);
                match rule_name(child) {
                    "argument-string" => Operand::String,
                    "argument-word" if is_capital(text) => Operand::Class,
                    "argument-word" => Operand::Name,
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
        // literal is its name.
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
        let name_token = Self::tokens_of(self.one(node, "rule-name")).next().expect("a rule name");
        let definer = Self::tokens_of(self.one(node, "definer")).next().expect("a definer");
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
        for alternative in Self::rules(self.one(node, "body"), "alternative") {
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
            verbatim: Self::rules(node, "verbatim-clause").next().is_some(),
            at: self.at(definer),
        };
        // The definition is checked as a whole once it is read (§9).
        if let Some(problem) = crate::clauses::definition_problem(&rule) {
            return Err(self.error(definer, problem));
        }
        Ok(rule)
    }

    fn alternative(&self, node: &'a Node) -> R<Alternative> {
        // A guard's token is its spelling: `f?` or `¬f?` for a gate, `f!`
        // for a warning (§9).
        let guards = Self::rules(node, "guard")
            .map(|guard| {
                let text = self.text(Self::tokens_of(guard).next().expect("a guard token"));
                let (text, kind) = match text.strip_suffix('!') {
                    Some(text) => (text, FeatureKind::Warning),
                    None => (text.trim_end_matches('?'), FeatureKind::Gate),
                };
                match text.strip_prefix('¬') {
                    Some(feature) => Guard { feature: feature.to_string(), kind, negated: true },
                    None => Guard { feature: text.to_string(), kind, negated: false },
                }
            })
            .collect();
        self.captures.borrow_mut().clear();
        let expr = self.conjunction(self.one(node, "conjunction"), 0, true)?;
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
        let term = self.tag_term(self.one(node, "term"))?;
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
            parts.push(if elements.len() == 1 { elements.pop().expect("an element") } else { Expr::Seq(elements) });
        }
        if parts.len() > crate::grammar::MAX_AND {
            return Err(self.error(
                node,
                format!("an & of {} items; at most {} are allowed", parts.len(), crate::grammar::MAX_AND),
            ));
        }
        Ok(if parts.len() == 1 { parts.pop().expect("a sequence") } else { Expr::And(parts) })
    }

    fn choice(&self, node: &'a Node, depth: usize) -> R<Expr> {
        let depth = self.deeper(node, depth)?;
        let mut parts = Vec::new();
        for conjunction in Self::rules(node, "conjunction") {
            parts.push(self.conjunction(conjunction, depth, false)?);
        }
        Ok(if parts.len() == 1 { parts.pop().expect("a conjunction") } else { Expr::Choice(parts) })
    }

    fn element(&self, node: &'a Node, depth: usize, top: bool) -> R<Expr> {
        let repeated = Self::tokens_of(node).any(|token| self.text(token) == "...");
        let primary = self.primary(self.one(node, "primary"), depth, top && !repeated)?;
        Ok(match (repeated, primary) {
            (false, primary) => primary,
            (true, Expr::Optional(inner)) => Expr::Repeat(inner, 0),
            (true, primary) => Expr::Repeat(Box::new(primary), 1),
        })
    }

    /// `top` is whether a capture may stand here (engine §3.5).
    fn primary(&self, node: &'a Node, depth: usize, top: bool) -> R<Expr> {
        let depth = self.deeper(node, depth)?;
        let inner = Self::inner(node);
        let token = || Self::tokens_of(inner).next().expect("a token");
        Ok(match rule_name(inner) {
            "reference" | "tag" | "character" | "phoneme" => self.symbol(inner)?,
            "spelled" => {
                // A reference or a terminal and its spelling, which the
                // syntax grammar gives nothing else (engine §9).
                let expr = self.symbol(Self::inner(inner))?;
                let spelling_token = token();
                let text: Vec<char> = self.text(spelling_token).chars().collect();
                let spelling: String = text[1.min(text.len())..text.len().saturating_sub(1).max(1)].iter().collect();
                let spellable = matches!(&expr, Expr::Ref(name) if name != "#") || matches!(expr, Expr::Terminal(_));
                if let Some(problem) = spelling_problem(&spelling, spellable, self.unicode) {
                    let message = if problem == "a spelling is not in lower case" {
                        format!("the spelling {spelling} is not in lower case")
                    } else {
                        problem.to_string()
                    };
                    return Err(self.error(spelling_token, message));
                }
                Expr::Spelled(spelling, Box::new(expr))
            }
            "capture" => {
                let capture = token();
                if self.text(capture) == "$" {
                    return Err(self.error(capture, "$ is the whole constituent and wraps nothing"));
                }
                let name = self.text(capture).trim_start_matches('$').to_string();
                if !is_capture_name(&name) {
                    return Err(self.error(capture, "a capture's name is all lower case"));
                }
                let primary = self.one(inner, "primary");
                let wrapped = Self::inner(primary);
                if !matches!(rule_name(wrapped), "reference" | "tag" | "character" | "phoneme" | "spelled") {
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
                Expr::Capture(name, Box::new(self.primary(primary, depth, false)?))
            }
            "group" => self.choice(self.one(inner, "choice"), depth)?,
            "optional" => Expr::Optional(Box::new(self.choice(self.one(inner, "choice"), depth)?)),
            "empty" => Expr::Empty,
            other => panic!("an unknown primary {other}"),
        })
    }

    /// A reference, or a terminal: a tag literal, a character tag or a
    /// phoneme tag.
    fn symbol(&self, node: &'a Node) -> R<Expr> {
        let token = Self::tokens_of(node).next().expect("a token");
        Ok(match rule_name(node) {
            "reference" => Expr::Ref(self.text(token).to_string()),
            "tag" | "character" | "phoneme" => Expr::Terminal(self.tag_of(token)?),
            other => panic!("an unknown symbol {other}"),
        })
    }

    /// Decodes a string or a character tag's token (engine §9). A string
    /// escapes its double quote, and a character tag its quote.
    fn decode(&self, token: &'a Node) -> R<String> {
        let text = self.text(token);
        let chars: Vec<char> = text.chars().collect();
        let quote = chars.first().copied().unwrap_or('"');
        let body = &chars[1..chars.len().saturating_sub(1).max(1)];
        let mut out = String::new();
        let mut index = 0;
        let bad = || self.error(token, format!("a bad escape in {text}"));
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
        let arrow = Self::tokens_of(node).next().expect("%emits");
        let mut items = Vec::new();
        for item in Self::rules(node, "emit-item") {
            let target = Self::tokens_of(self.one(item, "emit-target")).next().expect("an emission target");
            let tags = Self::rules(item, "emit-tags").next();
            let text = self.text(target);
            match target.terminal.as_deref().unwrap_or("") {
                "capture" => {
                    let name = text.trim_start_matches('$').to_string();
                    let listed = items.iter().any(|item| match item {
                        EmitItem::Capture(other, _) => *other == name,
                        EmitItem::Insert(_) => false,
                    });
                    if listed && !name.is_empty() {
                        return Err(self.error(arrow, "an emission lists the same capture twice"));
                    }
                    // `<term>`, the item's own tags.
                    let tags = match tags {
                        Some(tags) => {
                            let term = self.tag_term(self.one(tags, "term"))?;
                            if term == Term::EmptySet {
                                return Err(
                                    self.error(item, "<∅> emits a token no terminal can read; %emits ε emits nothing")
                                );
                            }
                            Some(term)
                        }
                        None => None,
                    };
                    items.push(EmitItem::Capture(name, tags));
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
                    items.push(EmitItem::Insert(tag));
                }
            }
        }
        let whole = |item: &EmitItem| matches!(item, EmitItem::Capture(name, _) if name.is_empty());
        let wholes = items.iter().filter(|item| whole(item)).count();
        if wholes > 0 && wholes < items.len() {
            return Err(self.error(arrow, "$ is used with a capture or an inserted tag"));
        }
        Ok(items)
    }

    /// `A ⟹ B`, grouping to the right: `if` of its `any-of` and the
    /// implication after `⟹`, or the one `any-of` itself.
    fn implication(&self, node: &'a Node, depth: usize) -> R<Cond> {
        let depth = self.deeper(node, depth)?;
        let antecedent = self.any_of(self.one(node, "any-of"), depth)?;
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
        Ok(if parts.len() == 1 { parts.pop().expect("a condition") } else { Cond::Any(parts) })
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
        Ok(if parts.len() == 1 { parts.pop().expect("a condition") } else { Cond::All(parts) })
    }

    fn condition(&self, node: &'a Node, depth: usize) -> R<Cond> {
        let depth = self.deeper(node, depth)?;
        let inner = Self::inner(node);
        match rule_name(inner) {
            // Parentheses make no node of their own (§9).
            "implication" => self.implication(inner, depth),
            "comparison" => {
                let operands: Vec<&Node> = Self::rules(inner, "union").collect();
                let comparator = self.one(inner, "comparator");
                let op = self.text(Self::tokens_of(comparator).next().expect("a comparator")).to_string();
                let left = self.union(operands[0], depth, false)?;
                let right = self.union(operands[1], depth, false)?;
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
            "negation" => Ok(Cond::Not(Box::new(self.condition(self.one(inner, "condition"), depth)?))),
            "presence" => {
                let token = Self::tokens_of(inner).next().expect("a capture");
                Ok(Cond::Captured(self.text(token).trim_start_matches('$').to_string()))
            }
            "call" => {
                let name_token = Self::tokens_of(inner).next().expect("a function name");
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
            other => panic!("an unknown condition {other}"),
        }
    }

    /// A function's argument: a rule, where it is a bare name without a
    /// capital, alone and perhaps in parentheses, or else a term where a
    /// span may stand.
    fn argument(&self, node: &'a Node, depth: usize) -> R<Arg> {
        let union = self.one(node, "union");
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
                    let inner = Self::inner(inner);
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
        let inner = Self::inner(node);
        match rule_name(inner) {
            "guarded-term" => {
                let depth = self.deeper(inner, depth)?;
                let cond = self.any_of(self.one(inner, "any-of"), depth)?;
                if let Some(problem) = cond_type_problem(&cond) {
                    return Err(self.error(inner, problem));
                }
                let then = self.term(self.one(inner, "term"), depth, false)?;
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
        if let [part] = parts[..] {
            return self.intersection(part, depth, argument);
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
        let mut result = items.next().expect("a part");
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
        if let [atom] = atoms[..] {
            return self.atom(atom, depth, argument);
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
        let Some(inner) = node.children.iter().find(|child| child.kind == NodeKind::Rule) else {
            panic!("an empty term atom");
        };
        let token = || Self::tokens_of(inner).next().expect("a token");
        Ok(match rule_name(inner) {
            // A span may stand in parentheses where a span is due.
            "term" => self.term(inner, depth, argument)?,
            "string" => Term::Str(self.decode(token())?),
            "tag" | "character" | "phoneme" => Term::Tag(self.tag_of(token())?),
            // A bare name is a tag literal if it begins with a capital, and
            // otherwise a rule, which only a function's argument names.
            "name" => {
                let name = self.text(token());
                if !is_capital(name) {
                    return Err(
                        self.error(inner, format!("{name} names a rule, which is not a value; ~{name} is the tag"))
                    );
                }
                Term::Tag(name.to_string())
            }
            "empty-set" => Term::EmptySet,
            "capture-reference" => {
                let name = self.text(token()).trim_start_matches('$').to_string();
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
            other => panic!("an unknown term atom {other}"),
        })
    }

    fn call(&self, node: &'a Node, depth: usize) -> R<Term> {
        let name_token = Self::tokens_of(node).next().expect("a function name");
        let name = self.text(name_token).to_string();
        if !FUNCTIONS.contains(&name.as_str()) {
            return Err(self.error(name_token, format!("an unknown function {name}()")));
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
            ("lowercase", [Arg::Term(term)]) => term_type(term) == Ok(Type::String),
            ("matches" | "begins" | "tags" | "lowercase", _) => false,
            (_, [first]) => span(first),
            _ => false,
        };
        if !ok {
            return Err(self.error(name_token, format!("{name}() is called with the wrong arguments")));
        }
        if matches!(name.as_str(), "matches" | "begins" | "initial") {
            return Err(self.error(name_token, format!("{name}() is a condition, not a term")));
        }
        Ok(Term::Call(name, args))
    }
}

/// The functions of the notation (engine §9).
const FUNCTIONS: [&str; 14] = [
    "phonemes",
    "text",
    "lowercase",
    "tags",
    "classes",
    "runs",
    "head",
    "tail",
    "last",
    "from",
    "after",
    "matches",
    "begins",
    "initial",
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
    match term {
        Term::Capture(name) => name.is_empty(),
        Term::Call(name, args) => {
            matches!(name.as_str(), "tags" | "classes")
                && matches!(&args[..], [Arg::Term(Term::Capture(name))] if name.is_empty())
        }
        Term::Union(items) | Term::Intersection(items) => items.iter().any(reads_own_tags),
        Term::Difference(left, right) => reads_own_tags(left) || reads_own_tags(right),
        Term::If(cond, then) => cond_reads_own_tags(cond) || reads_own_tags(then),
        Term::Str(_) | Term::Tag(_) | Term::EmptySet => false,
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
/// tag literal `~name`, a phoneme tag or a character tag.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Operand {
    Name,
    Class,
    String,
    Tag,
    Phoneme,
    Character,
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
