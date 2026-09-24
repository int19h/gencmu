//! From the notation's document tree to a grammar DOM (engine §9).

use crate::dom::{Alternative, Arg, Cond, Directive, Dom, Emit, EmitItem, Expr, Guard, Op, RuleDef, Term};
use crate::error::Error;
use crate::result::{Node, NodeKind, Token};

/// How deeply constructs may nest before the reader gives up, so that a
/// pathological document cannot exhaust the stack.
const MAX_DEPTH: usize = 400;

pub(crate) struct Reader<'a> {
    pub tokens: &'a [Token],
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
                "directive-statement" => dom.directives.push(self.directive(node)?),
                _ => stack.extend(node.children.iter().rev()),
            }
        }
        Ok(dom)
    }

    fn directive(&self, node: &'a Node) -> R<Directive> {
        let token = Self::tokens_of(node).next().expect("a directive token");
        let name = self.text(token).trim_start_matches('%').to_string();
        let args = Self::rules(node, "argument-word")
            .map(|word| self.text(Self::tokens_of(word).next().expect("an argument")).to_string())
            .collect();
        Ok(Directive { name, args, at: self.at(token) })
    }

    fn rule(&self, node: &'a Node) -> R<RuleDef> {
        let name_token = Self::tokens_of(node).next().expect("a rule name");
        let definer = self.one(node, "definer");
        let op = match self.text(Self::tokens_of(definer).next().expect("a definer")) {
            "|≔" => Op::Extend,
            _ => Op::Define,
        };
        let tags = match Self::rules(node, "rule-tags").next() {
            Some(tags) => Some(self.value(self.one(tags, "term"), 0)?),
            None => None,
        };
        let mut alternatives = Vec::new();
        for alternative in Self::rules(self.one(node, "body"), "alternative") {
            alternatives.push(self.alternative(alternative)?);
        }
        let mut emit = None;
        let mut conditions = Vec::new();
        for clause in Self::rules(node, "clause") {
            let inner = Self::inner(clause);
            match rule_name(inner) {
                "emission" => {
                    if emit.is_some() {
                        return Err(self.error(inner, "a rule has two emission clauses"));
                    }
                    emit = Some(self.emission(inner)?);
                }
                _ => {
                    for item in Self::rules(inner, "condition-item") {
                        conditions.push(self.condition_item(item)?);
                    }
                }
            }
        }
        Ok(RuleDef {
            name: self.text(name_token).to_string(),
            op,
            tags,
            alternatives,
            emit,
            conditions,
            at: self.at(name_token),
        })
    }

    fn alternative(&self, node: &'a Node) -> R<Alternative> {
        let guards = Self::rules(node, "guard")
            .map(|guard| {
                let text = self.text(Self::tokens_of(guard).next().expect("a guard token"));
                let text = text.trim_start_matches('@');
                match text.strip_prefix('!') {
                    Some(feature) => Guard { feature: feature.to_string(), negated: true },
                    None => Guard { feature: text.to_string(), negated: false },
                }
            })
            .collect();
        let expr = self.conjunction(self.one(node, "conjunction"), 0)?;
        let tags = match Self::rules(node, "alternative-tags").next() {
            Some(tags) => Some(self.value(self.one(tags, "term"), 0)?),
            None => None,
        };
        Ok(Alternative { guards, expr, tags })
    }

    fn conjunction(&self, node: &'a Node, depth: usize) -> R<Expr> {
        let depth = self.deeper(node, depth)?;
        let mut parts = Vec::new();
        for sequence in Self::rules(node, "sequence") {
            let mut elements = Vec::new();
            for element in Self::rules(sequence, "element") {
                elements.push(self.element(element, depth)?);
            }
            parts.push(if elements.len() == 1 { elements.pop().expect("an element") } else { Expr::Seq(elements) });
        }
        Ok(if parts.len() == 1 { parts.pop().expect("a sequence") } else { Expr::And(parts) })
    }

    fn choice(&self, node: &'a Node, depth: usize) -> R<Expr> {
        let depth = self.deeper(node, depth)?;
        let mut parts = Vec::new();
        for conjunction in Self::rules(node, "conjunction") {
            parts.push(self.conjunction(conjunction, depth)?);
        }
        Ok(if parts.len() == 1 { parts.pop().expect("a conjunction") } else { Expr::Choice(parts) })
    }

    fn element(&self, node: &'a Node, depth: usize) -> R<Expr> {
        let primary = self.primary(self.one(node, "primary"), depth)?;
        let repeated = Self::tokens_of(node).any(|token| self.text(token) == "...");
        Ok(match (repeated, primary) {
            (false, primary) => primary,
            (true, Expr::Optional(inner)) => Expr::Repeat(inner, 0),
            (true, primary) => Expr::Repeat(Box::new(primary), 1),
        })
    }

    fn primary(&self, node: &'a Node, depth: usize) -> R<Expr> {
        let depth = self.deeper(node, depth)?;
        let inner = Self::inner(node);
        let token = || Self::tokens_of(inner).next().expect("a token");
        Ok(match rule_name(inner) {
            "reference" => Expr::Ref(self.text(token()).to_string()),
            "string" => Expr::Terminal(self.decode(token())?),
            "phoneme" => Expr::Terminal(self.text(token()).to_string()),
            "capture" => {
                let capture = token();
                let primary = self.one(inner, "primary");
                let wrapped = Self::inner(primary);
                if !matches!(rule_name(wrapped), "reference" | "string" | "phoneme") {
                    return Err(self.error(capture, "a capture must wrap a single symbol"));
                }
                let name = self.text(capture).trim_start_matches('$').to_string();
                Expr::Capture(name, Box::new(self.primary(primary, depth)?))
            }
            "group" => self.choice(self.one(inner, "choice"), depth)?,
            "optional" => Expr::Optional(Box::new(self.choice(self.one(inner, "choice"), depth)?)),
            "hash" => Expr::Hash,
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

    fn emission(&self, node: &'a Node) -> R<Emit> {
        let arrow = Self::tokens_of(node).next().expect("⇒");
        let mut items = Vec::new();
        let mut nothing = false;
        for item in Self::rules(node, "emit-item") {
            let target = Self::tokens_of(self.one(item, "emit-target")).next().expect("an emission target");
            let tags = match Self::rules(item, "emit-tags").next() {
                Some(tags) => Some((tags, self.value(self.one(tags, "term"), 0)?)),
                None => None,
            };
            let terminal = target.terminal.as_deref().unwrap_or("");
            match terminal {
                "capture" => items.push(EmitItem::Capture(
                    self.text(target).trim_start_matches('$').to_string(),
                    tags.map(|(_, term)| term),
                )),
                "string" | "phoneme" => {
                    if let Some((tags, _)) = tags {
                        return Err(self.error(tags, "an inserted tag takes no tags of its own"));
                    }
                    let tag = if terminal == "string" { self.decode(target)? } else { self.text(target).to_string() };
                    items.push(EmitItem::Insert(tag));
                }
                _ => match self.text(target) {
                    "this" => items.push(EmitItem::This(tags.map(|(_, term)| term))),
                    "nothing" => {
                        if let Some((tags, _)) = tags {
                            return Err(self.error(tags, "nothing takes no tags"));
                        }
                        nothing = true;
                    }
                    other => return Err(self.error(target, format!("{other} is not this, nothing or a capture"))),
                },
            }
        }
        if nothing {
            if !items.is_empty() {
                return Err(self.error(arrow, "nothing is used with other items"));
            }
            return Ok(Emit::Nothing);
        }
        let this = items.iter().filter(|item| matches!(item, EmitItem::This(_))).count();
        if this > 0 && this < items.len() {
            return Err(self.error(arrow, "this is used with a capture or an inserted tag"));
        }
        Ok(Emit::Items(items))
    }

    fn condition_item(&self, node: &'a Node) -> R<Cond> {
        let mut parts = Vec::new();
        for condition in Self::rules(node, "condition") {
            parts.push(self.condition(condition, 0)?);
        }
        Ok(if parts.len() == 1 { parts.pop().expect("a condition") } else { Cond::Any(parts) })
    }

    fn condition(&self, node: &'a Node, depth: usize) -> R<Cond> {
        let depth = self.deeper(node, depth)?;
        let inner = Self::inner(node);
        match rule_name(inner) {
            "comparison" => {
                let terms: Vec<&Node> = Self::rules(inner, "term").collect();
                let comparator = self.one(inner, "comparator");
                let op = self.text(Self::tokens_of(comparator).next().expect("a comparator")).to_string();
                Ok(Cond::Compare(op, self.value(terms[0], depth)?, self.value(terms[1], depth)?))
            }
            "negation" => Ok(Cond::Not(Box::new(self.condition(self.one(inner, "condition"), depth)?))),
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
        let term = self.term(self.one(node, "term"), depth)?;
        if is_span(&term) {
            Ok(term)
        } else {
            Err(self.error(node, "a span is expected here"))
        }
    }

    fn value(&self, node: &'a Node, depth: usize) -> R<Term> {
        let term = self.term(node, depth)?;
        if is_span(&term) {
            return Err(self.error(node, "a span is used as a value"));
        }
        Ok(term)
    }

    fn term(&self, node: &'a Node, depth: usize) -> R<Term> {
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
                    if is_span(atom) {
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
            if is_span(part) {
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
            "term" => self.term(inner, depth)?,
            "string" => Term::Literal(self.decode(token())?),
            "phoneme" => Term::Literal(self.text(token()).to_string()),
            "weak" => {
                let string = Self::tokens_of(inner).nth(1).expect("a weak string");
                Term::Weak(self.decode(string)?)
            }
            "empty-set" => Term::EmptySet,
            "set" => {
                let mut items = Vec::new();
                for term in Self::rules(inner, "term") {
                    items.push(self.value(term, depth)?);
                }
                Term::Set(items)
            }
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
                vec![Arg::Term(self.value(self.one(args[0], "term"), depth)?)]
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

/// Whether a term is a span: a capture, or `head`, `tail` or `last` of one.
fn is_span(term: &Term) -> bool {
    match term {
        Term::Capture(_) => true,
        Term::Call(name, _) => matches!(name.as_str(), "head" | "tail" | "last"),
        _ => false,
    }
}
