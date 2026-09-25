//! From the notation's document tree to a grammar DOM (engine §9).

use crate::dom::{Alternative, Arg, Cond, Directive, Dom, EmitItem, Expr, FeatureKind, Guard, Op, RuleDef, Term};
use crate::error::Error;
use crate::result::{Node, NodeKind, Token};

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
        let token = Self::tokens_of(self.one(node, "directive-name")).next().expect("a directive keyword");
        let name = self.text(token).trim_start_matches('%').to_string();
        let args = Self::rules(node, "argument-word")
            .map(|word| self.text(Self::tokens_of(word).next().expect("an argument")).to_string())
            .collect();
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
            Some(clause) => Some(self.tag_term(clause)?),
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
            at: self.at(definer),
        };
        // The definition is checked as a whole once it is read (§9).
        if let Some(problem) = crate::clauses::definition_problem(&rule) {
            return Err(self.error(definer, problem));
        }
        Ok(rule)
    }

    fn alternative(&self, node: &'a Node) -> R<Alternative> {
        // A guard's token is its spelling: `@f?` or `@¬f?` for a gate, `@f!`
        // for a warning (§9).
        let guards = Self::rules(node, "guard")
            .map(|guard| {
                let text = self.text(Self::tokens_of(guard).next().expect("a guard token"));
                let (text, kind) = match text.strip_suffix('!') {
                    Some(text) => (text, FeatureKind::Warning),
                    None => (text.trim_end_matches('?'), FeatureKind::Gate),
                };
                let text = text.trim_start_matches('@');
                match text.strip_prefix('¬') {
                    Some(feature) => Guard { feature: feature.to_string(), kind, negated: true },
                    None => Guard { feature: text.to_string(), kind, negated: false },
                }
            })
            .collect();
        self.captures.borrow_mut().clear();
        let expr = self.conjunction(self.one(node, "conjunction"), 0, true)?;
        let tags = match Self::rules(node, "alternative-tags").next() {
            Some(tags) => Some(self.tag_term(tags)?),
            None => None,
        };
        Ok(Alternative { guards, expr, tags })
    }

    /// A rule's or an alternative's tags, which say what the constituent's
    /// tags are and so cannot read them: `$`, `tags($)` and `classes($)`
    /// are errors anywhere in them, guards included (§9), reported at the
    /// tags.
    fn tag_term(&self, node: &'a Node) -> R<Term> {
        let term = self.term(self.one(node, "term"), 0)?;
        if reads_own_tags(&term) {
            return Err(self.error(node, "a tag term cannot read the tags it defines: $, tags($) or classes($)"));
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
            "reference" => Expr::Ref(self.text(token()).to_string()),
            "string" => Expr::Terminal(self.decode(token())?),
            "phoneme" => Expr::Terminal(self.text(token()).to_string()),
            "capture" => {
                let capture = token();
                if self.text(capture) == "$" {
                    return Err(self.error(capture, "$ is the whole constituent and wraps nothing"));
                }
                let primary = self.one(inner, "primary");
                let wrapped = Self::inner(primary);
                if !matches!(rule_name(wrapped), "reference" | "string" | "phoneme") {
                    return Err(self.error(capture, "a capture must wrap a single symbol"));
                }
                if !top {
                    return Err(self.error(
                        capture,
                        "a capture stands at the top level of an alternative, not inside [ ], ( ), ..., & or a choice",
                    ));
                }
                let name = self.text(capture).trim_start_matches('$').to_string();
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

    /// Decodes a string token (engine §9).
    fn decode(&self, token: &'a Node) -> R<String> {
        let text = self.text(token);
        let chars: Vec<char> = text.chars().collect();
        let body = &chars[1..chars.len().saturating_sub(1).max(1)];
        let mut out = String::new();
        let mut index = 0;
        let bad = || self.error(token, format!("a bad escape in the string {text}"));
        while index < body.len() {
            let c = body[index];
            if c != '\\' {
                out.push(c);
                index += 1;
                continue;
            }
            match body.get(index + 1) {
                Some('\\') => out.push('\\'),
                Some('"') => out.push('"'),
                Some('u') => {
                    if body.get(index + 2) != Some(&'{') {
                        return Err(bad());
                    }
                    let close = body[index + 3..].iter().position(|&c| c == '}').ok_or_else(bad)? + index + 3;
                    let digits: String = body[index + 3..close].iter().collect();
                    if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_hexdigit()) {
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

    fn emission(&self, node: &'a Node) -> R<Vec<EmitItem>> {
        let arrow = Self::tokens_of(node).next().expect("%emits");
        let mut items = Vec::new();
        for item in Self::rules(node, "emit-item") {
            let target = Self::tokens_of(self.one(item, "emit-target")).next().expect("an emission target");
            // `<term>`, the item's own tags.
            let tags = match Self::rules(item, "emit-tags").next() {
                Some(tags) => {
                    let term = self.term(self.one(tags, "term"), 0)?;
                    if term == Term::EmptySet {
                        return Err(self.error(item, "<∅> emits a token no terminal can read; %emits ε emits nothing"));
                    }
                    Some(term)
                }
                None => None,
            };
            let terminal = target.terminal.as_deref().unwrap_or("");
            match terminal {
                "capture" => {
                    let name = self.text(target).trim_start_matches('$').to_string();
                    let listed = items.iter().any(|item| match item {
                        EmitItem::Capture(other, _) => *other == name,
                        EmitItem::Insert(_) => false,
                    });
                    if listed && !name.is_empty() {
                        return Err(self.error(arrow, "an emission lists the same capture twice"));
                    }
                    items.push(EmitItem::Capture(name, tags));
                }
                _ => {
                    if tags.is_some() {
                        return Err(self.error(target, "an inserted tag takes no tags of its own"));
                    }
                    let tag = if terminal == "string" { self.decode(target)? } else { self.text(target).to_string() };
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
                let left = self.checked_value(operands[0], depth)?;
                let right = self.checked_value(operands[1], depth)?;
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
                if name != "matches" {
                    return Err(self.error(name_token, format!("{name}() is not a condition; only matches() is")));
                }
                let args: Vec<&Node> = Self::rules(inner, "argument").collect();
                if args.len() != 2 {
                    return Err(self.error(name_token, "matches() takes a span and a rule"));
                }
                let span = self.span_argument(args[0], depth)?;
                let rule =
                    self.rule_argument(args[1]).ok_or_else(|| self.error(args[1], "matches() takes a rule name"))?;
                Ok(Cond::Matches(span, rule))
            }
            other => panic!("an unknown condition {other}"),
        }
    }

    fn rule_argument(&self, node: &'a Node) -> Option<String> {
        match node.children.first() {
            Some(child) if child.kind == NodeKind::Token => Some(self.text(child).to_string()),
            _ => None,
        }
    }

    fn span_argument(&self, node: &'a Node, depth: usize) -> R<Term> {
        if self.rule_argument(node).is_some() {
            return Err(self.error(node, "a span is expected here"));
        }
        let term = self.union(self.one(node, "union"), depth)?;
        if is_span(&term) {
            Ok(term)
        } else {
            Err(self.error(node, "a span is expected here"))
        }
    }

    /// A `union` where a value is needed: a bare capture is its tags, but
    /// `head`, `tail` and `last` give spans, which are not values.
    fn checked_value(&self, node: &'a Node, depth: usize) -> R<Term> {
        let term = self.union(node, depth)?;
        if is_derived_span(&term) {
            return Err(self.error(node, "a span is used as a value"));
        }
        Ok(term)
    }

    /// A `term`: its union, or its guarded term, `if` of its condition and
    /// its term (§9).
    fn term(&self, node: &'a Node, depth: usize) -> R<Term> {
        let depth = self.deeper(node, depth)?;
        let inner = Self::inner(node);
        match rule_name(inner) {
            "guarded-term" => {
                let depth = self.deeper(inner, depth)?;
                let cond = self.any_of(self.one(inner, "any-of"), depth)?;
                let then = self.term(self.one(inner, "term"), depth)?;
                Ok(Term::If(Box::new(cond), Box::new(then)))
            }
            _ => self.checked_value(inner, depth),
        }
    }

    fn union(&self, node: &'a Node, depth: usize) -> R<Term> {
        let depth = self.deeper(node, depth)?;
        let mut parts = Vec::new();
        for intersection in Self::rules(node, "intersection") {
            let mut atoms = Vec::new();
            for atom in Self::rules(intersection, "term-atom") {
                atoms.push(self.atom(atom, depth)?);
            }
            if atoms.len() == 1 {
                parts.push(atoms.pop().expect("an atom"));
            } else {
                for (atom, node) in atoms.iter().zip(Self::rules(intersection, "term-atom")) {
                    if is_derived_span(atom) {
                        return Err(self.error(node, "a span is used as a value"));
                    }
                }
                parts.push(Term::Intersection(atoms));
            }
        }
        if parts.len() == 1 {
            return Ok(parts.pop().expect("a part"));
        }
        for (part, node) in parts.iter().zip(Self::rules(node, "intersection")) {
            if is_derived_span(part) {
                return Err(self.error(node, "a span is used as a value"));
            }
        }
        Ok(Term::Union(parts))
    }

    fn atom(&self, node: &'a Node, depth: usize) -> R<Term> {
        let depth = self.deeper(node, depth)?;
        let Some(inner) = node.children.iter().find(|child| child.kind == NodeKind::Rule) else {
            panic!("an empty term atom");
        };
        let token = || Self::tokens_of(inner).next().expect("a token");
        Ok(match rule_name(inner) {
            // A span may stand in parentheses where a span is due.
            "term" => match rule_name(Self::inner(inner)) {
                "guarded-term" => self.term(inner, depth)?,
                _ => self.union(Self::inner(inner), depth)?,
            },
            "string" => Term::Literal(self.decode(token())?),
            "phoneme" => Term::Literal(self.text(token()).to_string()),
            "weak" => {
                let string = Self::tokens_of(inner).nth(1).expect("a weak string");
                Term::Weak(self.decode(string)?)
            }
            "empty-set" => Term::EmptySet,
            "capture-reference" => Term::Capture(self.text(token()).trim_start_matches('$').to_string()),
            "call" => self.call(inner, depth)?,
            other => panic!("an unknown term atom {other}"),
        })
    }

    fn call(&self, node: &'a Node, depth: usize) -> R<Term> {
        let name_token = Self::tokens_of(node).next().expect("a function name");
        let name = self.text(name_token).to_string();
        let args: Vec<&Node> = Self::rules(node, "argument").collect();
        let wrong = || self.error(name_token, format!("{name}() is called with the wrong arguments"));
        let built = match (name.as_str(), args.len()) {
            ("phonemes" | "text" | "classes" | "words" | "head" | "tail" | "last", 1) => {
                vec![Arg::Term(self.span_argument(args[0], depth).map_err(|_| wrong())?)]
            }
            ("tags", 1 | 2) => {
                let mut built = vec![Arg::Term(self.span_argument(args[0], depth).map_err(|_| wrong())?)];
                if let Some(&rule) = args.get(1) {
                    built.push(Arg::Rule(self.rule_argument(rule).ok_or_else(wrong)?));
                }
                built
            }
            ("lowercase", 1) => {
                if self.rule_argument(args[0]).is_some() {
                    return Err(wrong());
                }
                let term = self.checked_value(self.one(args[0], "union"), depth)?;
                let string = match &term {
                    Term::Literal(_) => true,
                    Term::Call(name, _) => matches!(name.as_str(), "phonemes" | "text" | "lowercase"),
                    _ => false,
                };
                if !string {
                    return Err(wrong());
                }
                vec![Arg::Term(term)]
            }
            ("phonemes" | "text" | "classes" | "words" | "head" | "tail" | "last" | "tags" | "lowercase", _) => {
                return Err(wrong())
            }
            ("matches", _) => return Err(self.error(name_token, "matches() is a condition, not a value")),
            _ => return Err(self.error(name_token, format!("an unknown function {name}()"))),
        };
        Ok(Term::Call(name, built))
    }
}

/// Whether a term is `head`, `tail` or `last` of a span, which is a span
/// and never a value.
fn is_derived_span(term: &Term) -> bool {
    matches!(term, Term::Call(name, _) if matches!(name.as_str(), "head" | "tail" | "last"))
}

/// Whether a term is a span: a capture, or `head`, `tail` or `last` of one.
fn is_span(term: &Term) -> bool {
    match term {
        Term::Capture(_) => true,
        Term::Call(name, _) => matches!(name.as_str(), "head" | "tail" | "last"),
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
        Term::If(cond, then) => cond_reads_own_tags(cond) || reads_own_tags(then),
        Term::Literal(_) | Term::Weak(_) | Term::EmptySet => false,
    }
}

fn cond_reads_own_tags(cond: &Cond) -> bool {
    match cond {
        Cond::Compare(_, left, right) => reads_own_tags(left) || reads_own_tags(right),
        Cond::Not(inner) => cond_reads_own_tags(inner),
        Cond::Any(items) | Cond::All(items) => items.iter().any(cond_reads_own_tags),
        Cond::If(antecedent, consequent) => cond_reads_own_tags(antecedent) || cond_reads_own_tags(consequent),
        Cond::Matches(..) | Cond::Captured(_) => false,
    }
}
