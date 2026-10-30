//! Pattern constructors in the ordinary reader, with heap frames.
use super::*;
use crate::patterns::{Children, Pattern};

pub(super) enum Value {
    Pattern(Pattern),
    Items(Vec<Children>),
}
impl Value {
    pub(super) fn pattern(mut self) -> Pattern {
        let Self::Pattern(value) = &mut self else { unreachable!("a predicate") };
        std::mem::replace(value, Pattern::Any)
    }
    fn items(mut self) -> Vec<Children> {
        let Self::Items(value) = &mut self else { unreachable!("a child list") };
        std::mem::take(value)
    }
}
impl Drop for Value {
    fn drop(&mut self) {
        match self {
            Self::Pattern(pattern) => pattern.clear(),
            Self::Items(items) => {
                for item in items {
                    item.clear();
                }
            }
        }
    }
}
pub(super) struct PatternFrame<'a> {
    node: &'a Node,
    initialized: bool,
    parts: Vec<&'a Node>,
    values: Vec<Value>,
    atom: Option<Pattern>,
}

impl<'a> Reader<'a> {
    pub(super) fn pattern_frame(&self, node: &'a Node) -> PatternFrame<'a> {
        PatternFrame { node, initialized: false, parts: Vec::new(), values: Vec::new(), atom: None }
    }

    pub(super) fn resume_pattern(&self, frame: &mut PatternFrame<'a>, input: Option<Val>) -> R<Step<'a>> {
        if !frame.initialized {
            frame.initialized = true;
            frame.parts = Self::parts(frame.node).into_iter().filter(|part| part.kind == NodeKind::Rule).collect();
            if matches!(rule_name(frame.node), "pattern-node" | "pattern-bare") {
                frame.parts = Self::rules(frame.node, "pattern-children").collect();
                if rule_name(frame.node) == "pattern-node" {
                    return Ok(Step::Call(Frame::PatternAtom(self.one(frame.node, "pattern-atom")?)));
                }
                frame.atom = Some(Pattern::Any);
            }
            if rule_name(frame.node) == "child-item"
                && Self::tokens_of(frame.node).any(|token| self.value(token) == "⋯")
            {
                return Ok(Step::Done(Val::Pattern(Value::Items(vec![Children::Siblings]))));
            }
        }
        if let Some(Val::Pattern(value)) = input {
            if rule_name(frame.node) == "pattern-node" && frame.atom.is_none() {
                let atom = value.pattern();
                if !frame.parts.is_empty() && !matches!(atom, Pattern::Name(..) | Pattern::Source(_) | Pattern::Any) {
                    return Err(self.error(frame.parts[0], "a child list requires a rule test"));
                }
                frame.atom = Some(atom);
            } else {
                frame.values.push(value);
            }
        }
        if let Some(&part) = frame.parts.get(frame.values.len()) {
            return Ok(Step::Call(Frame::Pattern(self.pattern_frame(part))));
        }
        let finished = std::mem::replace(frame, self.pattern_frame(frame.node));
        Ok(Step::Done(Val::Pattern(self.pattern_value(finished)?)))
    }

    pub(super) fn resume_pattern_atom(&self, node: &'a Node, input: Option<Val>) -> R<Step<'a>> {
        let call = match input {
            Some(Val::SourceCall(call)) => Some(call),
            None => {
                let base = self.pattern_atom_base(node)?;
                if rule_name(base) == "call" {
                    self.pattern_test_nodes(node, false)?;
                    return Ok(Step::Call(Frame::SourceCall(CallFrame::new(base))));
                }
                None
            }
            _ => unreachable!("a pattern atom reads a source call"),
        };
        Ok(Step::Done(Val::Pattern(Value::Pattern(self.pattern_atom(node, call)?))))
    }

    fn pattern_child(&self, value: Value, node: &Node) -> R<Pattern> {
        let mut items = value.items();
        while items.len() == 1 && matches!(items[0], Children::Sequence(_)) {
            let Children::Sequence(nested) = items.pop().unwrap() else { unreachable!() };
            items = nested;
        }
        if items.len() == 1 && matches!(items[0], Children::Node(_)) {
            let Children::Node(pattern) = items.remove(0) else { unreachable!() };
            return Ok(*pattern);
        }
        for item in &mut items {
            item.clear();
        }
        Err(self.error(node, "a pattern path or set requires one whole pattern"))
    }

    fn pattern_value(&self, frame: PatternFrame<'a>) -> R<Value> {
        let node = frame.node;
        let kind = rule_name(node);
        let mut values = frame.values;
        match kind {
            "pattern-primary" | "child-item" => {
                if values.len() != 1 {
                    return Err(self.shape_error(node, "one pattern operand"));
                }
                Ok(values.pop().unwrap())
            }
            "pattern-node" | "pattern-bare" => {
                let atom = frame.atom.unwrap();
                let exact = Self::tokens_of(node).any(|token| self.value(token) == "·");
                let children = values.pop().map(|value| Children::Sequence(value.items()));
                Ok(Value::Pattern(if exact || children.is_some() {
                    Pattern::Node(Box::new(atom), exact, children)
                } else {
                    atom
                }))
            }
            "pattern-union" | "pattern-intersection" | "child-set" | "child-intersection" => {
                if values.is_empty() {
                    return Err(self.shape_error(node, "pattern operands"));
                }
                let mut operands = Vec::new();
                for (part, value) in frame.parts.iter().zip(values) {
                    operands.push(if rule_name(part) == "child-path" {
                        self.pattern_child(value, part)?
                    } else {
                        value.pattern()
                    });
                }
                let ops: Vec<_> = Self::tokens_of(node).map(|token| self.value(token)).collect();
                let mut operands = operands.into_iter();
                let mut result = operands.next().unwrap();
                for (index, value) in operands.enumerate() {
                    if kind.ends_with("intersection") || ops.get(index) == Some(&"∩") {
                        result = Pattern::Intersection(vec![result, value]);
                    } else if ops.get(index) == Some(&"∖") {
                        result = Pattern::Difference(Box::new(result), Box::new(value));
                    } else {
                        result = Pattern::Union(vec![result, value]);
                    }
                }
                Ok(Value::Pattern(result))
            }
            "pattern-path" | "child-path" => {
                if values.len() != 1 {
                    return Err(self.shape_error(node, "one pattern operand"));
                }
                let value = values.pop().unwrap();
                let Some(axis) = Self::tokens_of(node).next() else { return Ok(value) };
                let path = match self.value(axis) {
                    "⋮" => "descendant",
                    "⋱" => "last",
                    "⋰" => "first",
                    _ => return Err(self.error(axis, "a malformed pattern path")),
                };
                let pattern =
                    if kind == "child-path" { self.pattern_child(value, frame.parts[0])? } else { value.pattern() };
                let result = Pattern::Path(path.into(), Box::new(pattern));
                Ok(if kind == "child-path" {
                    Value::Items(vec![Children::Node(Box::new(result))])
                } else {
                    Value::Pattern(result)
                })
            }
            "pattern-children" => Ok(values.pop().unwrap_or_else(|| Value::Items(Vec::new()))),
            "child-choice" => {
                let mut arms: Vec<_> = values.into_iter().map(|value| Children::Sequence(value.items())).collect();
                Ok(Value::Items(if arms.len() == 1 {
                    let Children::Sequence(items) = arms.pop().unwrap() else { unreachable!() };
                    items
                } else {
                    vec![Children::Choice(arms)]
                }))
            }
            "child-alternative" | "child-primary" => {
                if values.len() != 1 {
                    return Err(self.shape_error(node, "one child operand"));
                }
                let value = values.pop().unwrap();
                Ok(if matches!(rule_name(frame.parts[0]), "child-set" | "pattern-node" | "pattern-bare") {
                    Value::Items(vec![Children::Node(Box::new(value.pattern()))])
                } else {
                    value
                })
            }
            "child-sequence" => Ok(Value::Items(vec![Children::Sequence(
                values.into_iter().map(|value| Children::Sequence(value.items())).collect(),
            )])),
            "pattern-brackets" | "pattern-repeat" => {
                if values.is_empty() || kind == "pattern-brackets" && values.len() != 1 {
                    return Err(self.shape_error(node, "child choice"));
                }
                let mut parts = values.into_iter().map(|value| Box::new(Children::Sequence(value.items())));
                let body = parts.next().unwrap();
                Ok(Value::Items(vec![if kind == "pattern-brackets" {
                    Children::Optional(body)
                } else {
                    Children::Repeat(body, parts.next())
                }]))
            }
            _ => Err(self.error(node, format!("unexpected {kind} in a pattern"))),
        }
    }
}

/// Inspect child repetition after the local constructors succeed.
pub(super) fn source_pattern_problem(root: &Pattern) -> Option<&'static str> {
    enum Part<'p> {
        Pattern(&'p Pattern),
        Children(&'p Children, bool),
    }
    let mut pending = vec![Part::Pattern(root)];
    let mut repeats = Vec::new();
    while let Some(part) = pending.pop() {
        match part {
            Part::Pattern(pattern) => match pattern {
                Pattern::Node(inner, _, children) => {
                    pending.push(Part::Pattern(inner));
                    pending.extend(children.as_ref().map(|children| Part::Children(children, false)));
                }
                Pattern::Test(_, _, inner) | Pattern::Path(_, inner) => pending.push(Part::Pattern(inner)),
                Pattern::Union(items) | Pattern::Intersection(items) => {
                    pending.extend(items.iter().map(Part::Pattern));
                }
                Pattern::Difference(a, b) => pending.extend([Part::Pattern(a), Part::Pattern(b)]),
                _ => {}
            },
            Part::Children(children, repeated) => match children {
                Children::Siblings if repeated => {
                    return Some("a sibling ellipsis cannot be a repeat item or separator")
                }
                Children::Node(pattern) => pending.push(Part::Pattern(pattern)),
                Children::Sequence(items) | Children::Choice(items) => {
                    pending.extend(items.iter().map(|item| Part::Children(item, repeated)));
                }
                Children::Optional(inner) => pending.push(Part::Children(inner, repeated)),
                Children::Repeat(item, separator) => {
                    repeats.push(item.as_ref());
                    pending.push(Part::Children(item, true));
                    pending.extend(separator.as_deref().map(|separator| Part::Children(separator, true)));
                }
                Children::Siblings => {}
            },
        }
    }
    let mut known = crate::fxhash::FxMap::<*const Children, bool>::default();
    for root in repeats {
        let mut stack = vec![(root, false)];
        while let Some((children, ready)) = stack.pop() {
            let key = children as *const Children;
            if known.contains_key(&key) {
                continue;
            }
            let parts: Vec<_> = match children {
                Children::Sequence(items) | Children::Choice(items) => items.iter().collect(),
                Children::Optional(inner) => vec![inner.as_ref()],
                Children::Repeat(item, separator) => {
                    std::iter::once(item.as_ref()).chain(separator.as_deref()).collect()
                }
                _ => Vec::new(),
            };
            if !ready && !parts.is_empty() {
                stack.push((children, true));
                stack.extend(parts.into_iter().map(|child| (child, false)));
            } else {
                let consumes = matches!(children, Children::Node(_))
                    || parts.iter().any(|child| known[&(*child as *const Children)]);
                known.insert(key, consumes);
            }
        }
        if !known[&(root as *const Children)] {
            return Some("a pattern repeat cannot match only empty sequences");
        }
    }
    None
}
