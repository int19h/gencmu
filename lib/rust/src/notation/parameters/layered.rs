//! Convert layered recognition constructors without using the process stack.
use super::*;

impl<'a> Reader<'a> {
    fn layered_child(&self, value: Json, node: &Node) -> R<Json> {
        let items = list(&value);
        if items.len() != 1 || !has(&items[0], "child") {
            return Err(self.error(node, "a pattern path or set requires one whole pattern"));
        }
        Ok(get(&items[0], "child").clone())
    }
    pub(super) fn parameter_layered(&self, n: &'a Node) -> R<Json> {
        if let Some(value) = self.parameter_start(Mode::Layered, n, false)? {
            return Ok(value);
        }
        let kind = rule_name(n);
        if matches!(kind, "pattern-node" | "pattern-bare") {
            let mut atom = if kind == "pattern-node" {
                pattern_node(self.parameter_pattern(self.one(n, "pattern-atom")?)?)
            } else {
                obj([("any", Json::Bool(true))])
            };
            if let Some(name) = get(&atom, "literal").get("const").and_then(Json::as_str) {
                let name = string(name);
                p::remove(&mut atom, "literal");
                set(&mut atom, "constant", name);
            }
            let children = Self::rules(n, "pattern-children").next();
            if let Some(children) = children {
                if !["name", "call", "param", "any"].iter().any(|key| has(&atom, key)) {
                    return Err(self.error(children, "a child list requires a rule test"));
                }
            }
            if Self::tokens_of(n).any(|token| self.value(token) == "·") {
                set(&mut atom, "exact", Json::Bool(true));
            }
            if let Some(children) = children {
                set(&mut atom, "children", self.parameter_layered(children)?);
            }
            return Ok(atom);
        }
        if kind == "child-item" && Self::tokens_of(n).any(|token| self.value(token) == "⋯") {
            return Ok(Json::Arr(vec![obj([("siblings", Json::Bool(true))])]));
        }
        let parts: Vec<_> = Self::parts(n).into_iter().filter(|part| part.kind == NodeKind::Rule).collect();
        let mut values = parts.iter().map(|part| self.parameter_layered(part)).collect::<R<Vec<_>>>()?;
        match kind {
            "pattern-primary" | "child-item" => {
                if values.len() != 1 {
                    return Err(self.shape_error(n, "one pattern operand"));
                }
                Ok(values.remove(0))
            }
            "pattern-union" | "pattern-intersection" | "child-set" | "child-intersection" => {
                if values.is_empty() {
                    return Err(self.shape_error(n, "pattern operands"));
                }
                for (index, value) in values.iter_mut().enumerate() {
                    if rule_name(parts[index]) == "child-path" {
                        *value = self.layered_child(std::mem::replace(value, Json::Null), parts[index])?;
                    }
                }
                let ops: Vec<_> = Self::tokens_of(n).map(|token| self.value(token)).collect();
                let mut result = values.remove(0);
                for (index, value) in values.into_iter().enumerate() {
                    let key = if kind.ends_with("intersection") || ops.get(index) == Some(&"∩") {
                        "intersection"
                    } else if ops.get(index) == Some(&"∖") {
                        "difference"
                    } else {
                        "union"
                    };
                    let mut items = Vec::new();
                    for value in [result, value] {
                        if key != "difference" && has(&value, key) {
                            items.extend(list(get(&value, key)).iter().cloned());
                        } else {
                            items.push(value);
                        }
                    }
                    result = obj([(key, Json::Arr(items))]);
                }
                Ok(result)
            }
            "pattern-path" | "child-path" => {
                if values.len() != 1 {
                    return Err(self.shape_error(n, "one pattern operand"));
                }
                let value = values.remove(0);
                let Some(axis) = Self::tokens_of(n).next() else { return Ok(value) };
                let path = match self.value(axis) {
                    "⋮" => "descendant",
                    "⋱" => "last",
                    "⋰" => "first",
                    _ => return Err(self.error(axis, "a malformed pattern path")),
                };
                let pattern = if kind == "child-path" { self.layered_child(value, parts[0])? } else { value };
                let result = obj([("path", string(path)), ("pattern", pattern)]);
                Ok(if kind == "child-path" { Json::Arr(vec![obj([("child", result)])]) } else { result })
            }
            "pattern-children" => Ok(if values.is_empty() { Json::Arr(vec![]) } else { values.remove(0) }),
            "child-choice" => {
                let mut arms = Vec::new();
                for value in values {
                    let items = list(&value);
                    if items.len() == 1 && has(&items[0], "choice") {
                        arms.extend(list(get(&items[0], "choice")).iter().cloned());
                    } else {
                        arms.push(value);
                    }
                }
                Ok(if arms.len() == 1 { arms.remove(0) } else { Json::Arr(vec![obj([("choice", Json::Arr(arms))])]) })
            }
            "child-alternative" | "child-primary" => {
                if values.len() != 1 {
                    return Err(self.shape_error(n, "one child operand"));
                }
                let value = values.remove(0);
                Ok(if matches!(rule_name(parts[0]), "child-set" | "pattern-node" | "pattern-bare") {
                    Json::Arr(vec![obj([("child", value)])])
                } else {
                    value
                })
            }
            "child-sequence" => Ok(Json::Arr(values.iter().flat_map(|value| list(value).iter().cloned()).collect())),
            "pattern-brackets" => {
                if values.len() != 1 {
                    return Err(self.shape_error(n, "one child choice"));
                }
                Ok(Json::Arr(vec![obj([("optional", values.remove(0))])]))
            }
            "pattern-repeat" => {
                if values.is_empty() {
                    return Err(self.shape_error(n, "child choice"));
                }
                let mut result = obj([("repeat", values.remove(0))]);
                if !values.is_empty() {
                    set(&mut result, "separator", values.remove(0));
                }
                Ok(Json::Arr(vec![result]))
            }
            _ => Err(self.error(n, format!("unexpected {kind} in layered pattern"))),
        }
    }
}
