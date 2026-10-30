//! Pattern constructors in the ordinary reader, with heap frames.
use super::*;
use crate::patterns::{Children, Pattern};

enum Value {
    Pattern(Pattern),
    Items(Vec<Children>),
}
impl Value {
    fn pattern(mut self) -> Pattern {
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
struct PatternFrame<'a> {
    node: &'a Node,
    parts: Vec<&'a Node>,
    values: Vec<Value>,
    atom: Option<Pattern>,
    early: Option<Value>,
}

impl<'a> Reader<'a> {
    fn pattern_frame(&self, node: &'a Node) -> R<PatternFrame<'a>> {
        let mut frame = PatternFrame {
            node,
            parts: Self::parts(node).into_iter().filter(|part| part.kind == NodeKind::Rule).collect(),
            values: Vec::new(),
            atom: None,
            early: None,
        };
        if matches!(rule_name(node), "pattern-node" | "pattern-bare") {
            let atom = if rule_name(node) == "pattern-node" {
                self.pattern_atom(self.one(node, "pattern-atom")?)?
            } else {
                Pattern::Any
            };
            frame.parts = Self::rules(node, "pattern-children").collect();
            if !frame.parts.is_empty() && !matches!(atom, Pattern::Name(..) | Pattern::Any) {
                return Err(self.error(frame.parts[0], "a child list requires a rule test"));
            }
            frame.atom = Some(atom);
        }
        if rule_name(node) == "child-item" && Self::tokens_of(node).any(|token| self.value(token) == "⋯") {
            frame.parts.clear();
            frame.early = Some(Value::Items(vec![Children::Siblings]));
        }
        Ok(frame)
    }

    pub(super) fn pattern(&self, node: &'a Node) -> R<Pattern> {
        let mut frames = vec![self.pattern_frame(node)?];
        loop {
            let frame = frames.last_mut().expect("the current pattern constructor");
            if let Some(&part) = frame.parts.get(frame.values.len()) {
                frames.push(self.pattern_frame(part)?);
                continue;
            }
            let value = self.pattern_value(frames.pop().unwrap())?;
            if let Some(parent) = frames.last_mut() {
                parent.values.push(value);
            } else {
                return Ok(value.pattern());
            }
        }
    }

    fn pattern_child(&self, value: Value, node: &Node) -> R<Pattern> {
        let mut items = value.items();
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
        if let Some(value) = frame.early {
            return Ok(value);
        }
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
                        let mut items = match result {
                            Pattern::Intersection(items) => items,
                            other => vec![other],
                        };
                        match value {
                            Pattern::Intersection(nested) => items.extend(nested),
                            other => items.push(other),
                        }
                        result = Pattern::Intersection(items);
                    } else if ops.get(index) == Some(&"∖") {
                        result = Pattern::Difference(Box::new(result), Box::new(value));
                    } else {
                        let mut items = match result {
                            Pattern::Union(items) => items,
                            other => vec![other],
                        };
                        match value {
                            Pattern::Union(nested) => items.extend(nested),
                            other => items.push(other),
                        }
                        result = Pattern::Union(items);
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
                let mut arms = Vec::new();
                for value in values {
                    let mut items = value.items();
                    if items.len() == 1 && matches!(items[0], Children::Choice(_)) {
                        let Children::Choice(nested) = items.pop().unwrap() else { unreachable!() };
                        arms.extend(nested);
                    } else {
                        arms.push(Children::Sequence(items));
                    }
                }
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
            "child-sequence" => Ok(Value::Items(values.into_iter().flat_map(Value::items).collect())),
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
