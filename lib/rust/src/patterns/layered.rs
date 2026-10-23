//! Typed storage for the layered pattern DOM.
use super::*;

impl Pattern {
    pub(crate) fn from_layered_json(root: &Json) -> Result<Self, String> {
        let name = |name: &str| {
            name.contains('(') && name.ends_with(')')
                || dom::is_classifier_name(name)
                // The public schema checks eligibility against the configured core.
                || name.chars().count() == 1
                    && name.chars().next().is_some_and(|c| !c.is_ascii_uppercase() && !c.is_ascii_digit() && c != '#' && c != '@' && c != '_')
        };
        let inspect = shapes::Inspection { name: Some(&name), ..Default::default() };
        if let Some(problem) = shapes::problem(root, &inspect) {
            return Err(problem);
        }
        enum Value {
            Pattern(Pattern),
            Items(Children),
        }
        impl Value {
            fn pattern(self) -> Pattern {
                let Self::Pattern(p) = self else { unreachable!() };
                p
            }
            fn items(self) -> Children {
                let Self::Items(items) = self else { unreachable!() };
                items
            }
        }
        enum Task<'a> {
            Pattern(&'a Json),
            Items(&'a Json),
            Item(&'a Json),
            BuildPattern(&'a Json),
            BuildItems(usize),
            BuildItem(&'a Json, usize),
        }
        let mut tasks = vec![Task::Pattern(root)];
        let mut values = Vec::<Value>::new();
        while let Some(task) = tasks.pop() {
            match task {
                Task::Pattern(node) => {
                    tasks.push(Task::BuildPattern(node));
                    if let Some(items) = node.get("children") {
                        tasks.push(Task::Items(items));
                    }
                    if let Some(items) = ["union", "intersection", "difference"].iter().find_map(|key| node.get(key)) {
                        tasks.extend(items.as_array().unwrap().iter().rev().map(Task::Pattern));
                    } else if node.get("path").is_some() {
                        tasks.push(Task::Pattern(node.get("pattern").unwrap()));
                    } else if node.get("test").is_some() {
                        tasks.push(Task::Pattern(node.get("expr").unwrap()));
                    }
                }
                Task::Items(items) => {
                    let items = items.as_array().unwrap();
                    tasks.push(Task::BuildItems(items.len()));
                    tasks.extend(items.iter().rev().map(Task::Item));
                }
                Task::Item(item) => {
                    if let Some(child) = item.get("child") {
                        tasks.push(Task::BuildItem(item, 1));
                        tasks.push(Task::Pattern(child));
                    } else if let Some(arms) = item.get("choice") {
                        let arms = arms.as_array().unwrap();
                        tasks.push(Task::BuildItem(item, arms.len()));
                        tasks.extend(arms.iter().rev().map(Task::Items));
                    } else if let Some(body) = item.get("optional").or_else(|| item.get("repeat")) {
                        tasks.push(Task::BuildItem(item, 1 + usize::from(item.get("separator").is_some())));
                        if let Some(separator) = item.get("separator") {
                            tasks.push(Task::Items(separator));
                        }
                        tasks.push(Task::Items(body));
                    } else {
                        values.push(Value::Items(Children::Siblings));
                    }
                }
                Task::BuildItems(count) => {
                    let start = values.len() - count;
                    let items = values.drain(start..).map(Value::items).collect();
                    values.push(Value::Items(Children::Sequence(items)));
                }
                Task::BuildItem(item, count) => {
                    let start = values.len() - count;
                    let mut operands = values.drain(start..).collect::<Vec<_>>();
                    let value = if item.get("child").is_some() {
                        Children::Node(Box::new(operands.remove(0).pattern()))
                    } else if item.get("choice").is_some() {
                        Children::Choice(operands.into_iter().map(Value::items).collect())
                    } else if item.get("optional").is_some() {
                        Children::Optional(Box::new(operands.remove(0).items()))
                    } else {
                        let body = Box::new(operands.remove(0).items());
                        Children::Repeat(body, operands.pop().map(|value| Box::new(value.items())))
                    };
                    values.push(Value::Items(value));
                }
                Task::BuildPattern(node) => {
                    let attached = node.get("children").map(|_| values.pop().unwrap().items());
                    let mut pattern = if let Some(key) =
                        ["union", "intersection", "difference"].iter().find(|key| node.get(key).is_some())
                    {
                        let count = node.get(key).unwrap().as_array().unwrap().len();
                        let start = values.len() - count;
                        let mut operands = values.drain(start..).map(Value::pattern).collect::<Vec<_>>();
                        match *key {
                            "union" => Self::Union(operands),
                            "intersection" => Self::Intersection(operands),
                            _ => {
                                let right = operands.pop().unwrap();
                                Self::Difference(Box::new(operands.pop().unwrap()), Box::new(right))
                            }
                        }
                    } else if node.get("path").is_some() {
                        Self::Path(string(node, "path")?, Box::new(values.pop().unwrap().pattern()))
                    } else if node.get("test").is_some() {
                        let value = if string(node, "test")? == "tags" {
                            dom::requirements_from_json(node)?
                        } else {
                            dom::term_from_json(field(node, "value")?)?
                        };
                        Self::Test(string(node, "test")?, value, Box::new(values.pop().unwrap().pattern()))
                    } else if node.get("any").is_some() {
                        Self::Any
                    } else {
                        if node.get("call").is_some() || node.get("param").is_some() {
                            return Err("a pattern still contains an unresolved reference".into());
                        }
                        let Json::Obj(fields) = node else { unreachable!() };
                        let atom = Json::Obj(
                            fields
                                .iter()
                                .filter(|(key, _)| !matches!(key.as_str(), "exact" | "children"))
                                .cloned()
                                .collect(),
                        );
                        Self::read_atom(&atom)?
                    };
                    let exact = node.get("exact").and_then(Json::as_bool) == Some(true);
                    if exact || attached.is_some() {
                        pattern = Self::Node(Box::new(pattern), exact, attached);
                    }
                    values.push(Value::Pattern(pattern));
                }
            }
        }
        Ok(values.pop().unwrap().pattern())
    }

    pub(crate) fn write_layered(&self, out: &mut String) {
        write(out, Write::Pattern(self));
    }
}
impl Children {
    pub(super) fn write_layered_item(&self, out: &mut String) {
        write(out, Write::Item(self));
    }
}
enum Write<'a> {
    Pattern(&'a Pattern),
    Atom(&'a Pattern, bool, Option<&'a Children>),
    Items(&'a Children),
    Item(&'a Children),
    Raw(String),
}
fn write(out: &mut String, root: Write<'_>) {
    let mut tasks = vec![root];
    while let Some(task) = tasks.pop() {
        match task {
            Write::Raw(text) => out.push_str(&text),
            Write::Pattern(pattern) => match pattern {
                Pattern::Node(node, exact, children) => tasks.push(Write::Atom(node, *exact, children.as_ref())),
                Pattern::Children(children) => tasks.push(Write::Atom(&Pattern::Any, false, Some(children))),
                Pattern::Path(path, inner) => {
                    out.push_str("{\"path\":");
                    write_str(out, path);
                    out.push_str(",\"pattern\":");
                    tasks.push(Write::Raw("}".into()));
                    tasks.push(Write::Pattern(inner));
                }
                Pattern::Union(items) | Pattern::Intersection(items) => {
                    out.push_str(if matches!(pattern, Pattern::Union(_)) {
                        "{\"union\":["
                    } else {
                        "{\"intersection\":["
                    });
                    tasks.push(Write::Raw("]}".into()));
                    for (index, item) in items.iter().enumerate().rev() {
                        tasks.push(Write::Pattern(item));
                        if index > 0 {
                            tasks.push(Write::Raw(",".into()));
                        }
                    }
                }
                Pattern::Difference(left, right) => {
                    out.push_str("{\"difference\":[");
                    tasks.push(Write::Raw("]}".into()));
                    tasks.push(Write::Pattern(right));
                    tasks.push(Write::Raw(",".into()));
                    tasks.push(Write::Pattern(left));
                }
                _ => tasks.push(Write::Atom(pattern, false, None)),
            },
            Write::Atom(atom, exact, children) => {
                out.push('{');
                let at = match atom {
                    Pattern::Name(name, at) | Pattern::Terminal(name, at) | Pattern::Constant(name, at) => {
                        write_str(
                            out,
                            match atom {
                                Pattern::Name(..) => "name",
                                Pattern::Terminal(..) => "terminal",
                                _ => "constant",
                            },
                        );
                        out.push(':');
                        write_str(out, name);
                        Some(*at)
                    }
                    Pattern::Literal(value, at) => {
                        out.push_str("\"literal\":");
                        dom::write_term(out, value);
                        Some(*at)
                    }
                    Pattern::Range(left, right, at) => {
                        out.push_str("\"range\":[");
                        dom::write_term(out, left);
                        out.push(',');
                        dom::write_term(out, right);
                        out.push(']');
                        Some(*at)
                    }
                    Pattern::Wildcard(at) => {
                        out.push_str("\"wildcard\":true");
                        Some(*at)
                    }
                    Pattern::Any => {
                        out.push_str("\"any\":true");
                        None
                    }
                    Pattern::Test(op, value, _) => {
                        out.push_str("\"test\":");
                        write_str(out, op);
                        if op == "tags" {
                            out.push_str(",\"requirements\":");
                            dom::write_requirements(out, value)
                        } else {
                            out.push_str(",\"value\":");
                            dom::write_term(out, value)
                        }
                        out.push_str(",\"expr\":");
                        None
                    }
                    _ => unreachable!("a node test cannot contain a compound predicate"),
                };
                tasks.push(Write::Raw(at.map_or("}".into(), |at| format!(",\"at\":[{},{}]}}", at.0, at.1))));
                if let Some(children) = children {
                    tasks.push(Write::Items(children));
                    tasks.push(Write::Raw(",\"children\":".into()));
                }
                if exact {
                    tasks.push(Write::Raw(",\"exact\":true".into()));
                }
                if let Pattern::Test(_, _, inner) = atom {
                    tasks.push(Write::Pattern(inner));
                }
            }
            Write::Items(children) => {
                let mut pending = vec![children];
                let mut items = Vec::new();
                while let Some(item) = pending.pop() {
                    if let Children::Sequence(sequence) = item {
                        pending.extend(sequence.iter().rev());
                    } else {
                        items.push(item);
                    }
                }
                out.push('[');
                tasks.push(Write::Raw("]".into()));
                for (index, item) in items.into_iter().enumerate().rev() {
                    tasks.push(Write::Item(item));
                    if index > 0 {
                        tasks.push(Write::Raw(",".into()));
                    }
                }
            }
            Write::Item(item) => match item {
                Children::Node(pattern) => {
                    out.push_str("{\"child\":");
                    tasks.push(Write::Raw("}".into()));
                    tasks.push(Write::Pattern(pattern));
                }
                Children::Siblings => out.push_str("{\"siblings\":true}"),
                Children::Optional(body) => {
                    out.push_str("{\"optional\":");
                    tasks.push(Write::Raw("}".into()));
                    tasks.push(Write::Items(body));
                }
                Children::Repeat(body, separator) => {
                    out.push_str("{\"repeat\":");
                    tasks.push(Write::Raw("}".into()));
                    if let Some(separator) = separator {
                        tasks.push(Write::Items(separator));
                        tasks.push(Write::Raw(",\"separator\":".into()));
                    }
                    tasks.push(Write::Items(body));
                }
                Children::Choice(arms) => {
                    out.push_str("{\"choice\":[");
                    tasks.push(Write::Raw("]}".into()));
                    for (index, arm) in arms.iter().enumerate().rev() {
                        tasks.push(Write::Items(arm));
                        if index > 0 {
                            tasks.push(Write::Raw(",".into()));
                        }
                    }
                }
                Children::Sequence(_) => unreachable!("an item array is not an item"),
            },
        }
    }
}
