//! Stage-local discovery, substitution, and source-order event replay.
use super::print::canonical;
use super::*;
use crate::error::Error;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::Arc;
type R<T> = Result<T, Error>;
type Documents = Vec<(Arc<str>, Arc<Dom>)>;
#[derive(Debug, Clone)]
pub(crate) struct Event {
    pub kind: usize,
    pub path: Arc<str>,
    pub rule: Json,
    pub index: usize,
    pub inspection_run: usize,
    pub origin: Option<Json>,
    pub instance: String,
    /// Per condition, its form as its template writes it, where it held
    /// a parameter, for an instance event (engine §3.6). A null entry
    /// held no parameter.
    pub template_conditions: Vec<Json>,
}
impl Event {
    fn fail(&self, n: &Json, mut message: String) -> Error {
        let at = at(n).or_else(|| at(&self.rule)).unwrap_or((1, 1));
        if let Some(origin) = &self.origin {
            let a = at_origin(origin);
            message.push_str(&format!(
                ", in {} called at {}:{}:{}",
                self.instance,
                text(get(origin, "document")),
                a.0,
                a.1
            ))
        }
        let mut e = Error::grammar(message).in_document(&self.path).at(at.0, at.1);
        if e.message.starts_with("unbounded-instantiation:") {
            e = e.coded("unbounded-instantiation")
        }
        e
    }
}
/// Whether a clause as written mentions a parameter (engine §3.6).
fn mentions_parameter(value: &Json) -> bool {
    match value {
        Json::Obj(members) => members
            .iter()
            .any(|(key, member)| (key == "param" && matches!(member, Json::Str(_))) || mentions_parameter(member)),
        Json::Arr(items) => items.iter().any(mentions_parameter),
        _ => false,
    }
}

fn at_origin(n: &Json) -> (usize, usize) {
    at(n).unwrap_or((1, 1))
}
#[derive(Debug, Clone)]
pub(crate) struct Template {
    pub name: String,
    pub arity: usize,
    pub events: Vec<Event>,
}
#[derive(Debug, Clone)]
pub(crate) struct Instance {
    pub canonical: String,
    pub name: Option<String>,
    pub call: Json,
    pub origin: Json,
    pub locals: Vec<Event>,
    pub definitions: Vec<Event>,
    discovered: bool,
}
impl Instance {
    pub fn effective(&self) -> &str {
        self.name.as_deref().unwrap_or(&self.canonical)
    }
}
pub(crate) enum RetainedPart {
    Term(dom::Term),
    Fragment(Box<dom::RuleDef>),
}
pub(crate) struct ArgumentUse {
    order: usize,
    pub kind: usize,
    pub path: Arc<str>,
    pub inspection_run: usize,
    pub position: (usize, usize),
    pub part: RetainedPart,
    pub at: (usize, usize),
    pub tags: bool,
}
struct FragmentInspection {
    order: usize,
    inspection_run: usize,
    position: (usize, usize),
    event: Event,
}
#[derive(Clone)]
pub(crate) struct ErasurePatternCheck {
    pub names: Vec<String>,
    pub name: String,
    pub document: String,
    pub at: (usize, usize),
}
pub(crate) struct Expansion {
    pub erasure_checks: Vec<ErasurePatternCheck>,
    pub documents: Documents,
    pub inspection_runs: Vec<usize>,
    pub order: Vec<String>,
    #[cfg(test)]
    pub instance_names: Vec<String>,
    pub validation: Vec<(usize, Arc<str>, Arc<Dom>)>,
    pub arguments: Vec<ArgumentUse>,
}
struct Expander<'a> {
    erasure_checks: std::cell::RefCell<Vec<ErasurePatternCheck>>,
    uni: &'a Unicode,
    patterns: BTreeSet<String>,
    templates: Vec<Template>,
    template_names: BTreeMap<String, usize>,
    instances: Vec<Instance>,
    keys: BTreeMap<String, usize>,
    queue: Vec<usize>,
}
fn retained(items: &[Event]) -> &[Event] {
    let start = items.iter().rposition(|e| text(get(&e.rule, "op")) != "extend").unwrap_or(0);
    &items[start..]
}
fn remember_retained<'a>(events: impl Iterator<Item = &'a Event> + Clone, indexes: &mut BTreeSet<usize>) {
    let first = events.clone().filter(|e| text(get(&e.rule, "op")) != "extend").map(|e| e.index).max().unwrap_or(0);
    indexes.extend(events.filter(|e| e.index >= first).map(|e| e.index));
}
fn sorted(a: &[Event], b: &[Event]) -> Vec<Event> {
    let mut xs = a.to_vec();
    xs.extend_from_slice(b);
    xs.sort_by_key(|e| e.index);
    xs
}
fn key(n: &Json) -> String {
    identity(n).to_json()
}
fn child_position<'a>(key: &str, position: &'a str) -> &'a str {
    if key == "children" || position == "pattern-item" && ["choice", "optional", "repeat", "separator"].contains(&key) {
        return "pattern-item";
    }
    if position == "pattern" && ["union", "intersection", "difference"].contains(&key) {
        return "pattern";
    }
    if [
        "alternatives",
        "conditions",
        "emit",
        "tags",
        "value",
        "image",
        "default",
        "requirements",
        "range",
        "literal",
        "concat",
        "union",
        "intersection",
        "difference",
        "left",
        "right",
        "receiver",
        "if",
        "then",
        "not",
        "all",
        "any",
        "args",
    ]
    .contains(&key)
    {
        return "term";
    }
    if position != "pattern"
        && ["body", "splice", "seq", "choice", "ranked", "and", "optional", "repeat", "separator", "expr"]
            .contains(&key)
    {
        return "expr";
    }
    if ["pattern", "child"].contains(&key) {
        return "pattern";
    }
    position
}
fn empty(rules: Vec<Json>) -> Json {
    obj([
        ("format", Json::Int(dom::DOM_FORMAT)),
        ("rules", Json::Arr(rules)),
        ("constants", Json::Arr(Vec::new())),
        ("directives", Json::Arr(Vec::new())),
        ("classifiers", Json::Arr(Vec::new())),
        ("implications", Json::Arr(Vec::new())),
    ])
}
pub(crate) fn expand(documents: &[(Arc<str>, Arc<Dom>)], uni: &Unicode) -> R<Option<Expansion>> {
    if !documents.iter().any(|(_, d)| d.unresolved) {
        return Ok(None);
    }
    let mut x = Expander {
        erasure_checks: Default::default(),
        uni,
        patterns: BTreeSet::new(),
        templates: Vec::new(),
        template_names: BTreeMap::new(),
        instances: Vec::new(),
        keys: BTreeMap::new(),
        queue: Vec::new(),
    };
    let mut names: BTreeSet<String> = BTreeSet::new();
    let mut slots = Vec::new();
    let mut events = Vec::new();
    let mut extra = Vec::new();
    let mut raw_docs = Vec::new();
    let mut serial = 0;
    for (inspection_run, (path, d)) in documents.iter().enumerate() {
        let mut raw = crate::json::parse(&dom::dom_to_json(d)).expect("a DOM writer produces JSON");
        super::locations::annotate_document(&mut raw, d);
        let mut items: Vec<_> =
            KINDS.into_iter().flat_map(|k| list(get(&raw, k)).iter().map(move |r| (k, r))).collect();
        items.sort_by_key(|(_, r)| at(r));
        for (kind, r) in items {
            let e = Event {
                path: path.clone(),
                rule: r.clone(),
                index: serial,
                kind: match kind {
                    "rules" => 0,
                    "directives" => 1,
                    "constants" => 2,
                    "classifiers" => 3,
                    _ => 4,
                },
                inspection_run,
                origin: None,
                instance: String::new(),
                template_conditions: Vec::new(),
            };
            serial += 1;
            if kind != "rules" {
                extra.push(e);
                continue;
            }
            let name = text(get(r, "name")).to_string();
            if has(r, "params") {
                if text(get(r, "op")) == "define" {
                    if x.template_names.contains_key(&name) || names.contains(&name) {
                        return Err(e.fail(r, format!("duplicate template {name}")));
                    }
                    x.template_names.insert(name.clone(), x.templates.len());
                    x.templates.push(Template { name, arity: list(get(r, "params")).len(), events: vec![e.clone()] });
                } else {
                    let t = x
                        .template_names
                        .get(&name)
                        .and_then(|i| x.templates.get_mut(*i))
                        .filter(|t| t.arity == list(get(r, "params")).len())
                        .ok_or_else(|| {
                            e.fail(r, format!("template {name} requires an earlier declaration with the same arity"))
                        })?;
                    t.events.push(e.clone());
                }
            } else if !has(r, "args") {
                if x.template_names.contains_key(&name) {
                    return Err(e.fail(r, "a template and an ordinary rule cannot share a name".into()));
                }
                if text(get(r, "op")) == "define" {
                    if !names.insert(name.clone()) {
                        return Err(e.fail(r, format!("duplicate rule {name}")));
                    }
                    slots.push(name)
                } else if !names.contains(&name) {
                    return Err(e.fail(r, format!("{name} requires an earlier definition")));
                }
            }
            events.push(e);
        }
        raw_docs.push(raw);
    }
    x.patterns = pattern_constant_names(raw_docs.iter().flat_map(|d| list(get(d, "constants"))));
    let mut source_events: Vec<_> = events.iter().chain(&extra).collect();
    source_events.sort_by_key(|e| e.index);
    x.flow(&source_events)?;
    let mut current: BTreeMap<String, usize> = BTreeMap::new();
    let mut ordinary: BTreeMap<String, Vec<Event>> = BTreeMap::new();
    for e in &events {
        let r = &e.rule;
        let name = text(get(r, "name"));
        if has(r, "params") {
            continue;
        }
        if has(r, "args") {
            if !x.template_names.get(name).is_some_and(|i| x.templates[*i].events[0].index < e.index) {
                return Err(e.fail(r, "an instance edit requires an earlier template".into()));
            }
            let i = x.intern(
                &obj([("call", string(name)), ("args", get(r, "args").clone()), ("at", get(r, "at").clone())]),
                e,
                false,
            )?;
            x.instances[i].locals.push(e.clone());
        } else if has(r, "instance") {
            let i = x.intern(get(r, "instance"), e, false)?;
            if x.instances[i].name.as_ref().is_some_and(|n| n != name) {
                return Err(e.fail(r, "an instance has at most one public name".into()));
            }
            if current.get(name) == Some(&i) {
                return Err(e.fail(r, "repeating an instance binding is invalid".into()));
            }
            if let Some(old) = current.get(name) {
                x.instances[*old].name = None;
            }
            x.instances[i].name = Some(name.into());
            current.insert(name.into(), i);
            ordinary.remove(name);
        } else if let Some(i) = current.get(name) {
            x.instances[*i].locals.push(e.clone())
        } else {
            ordinary.entry(name.into()).or_default().push(e.clone())
        }
    }
    let extra_indexes: BTreeSet<_> = extra.iter().map(|e| e.index).collect();
    let mut retained_indexes = BTreeSet::new();
    for template in &x.templates {
        remember_retained(template.events.iter(), &mut retained_indexes);
    }
    for history in ordinary.values() {
        remember_retained(history.iter(), &mut retained_indexes);
    }
    for instance in &x.instances {
        let template = &x.templates[x.template_names[text(get(&instance.call, "call"))]];
        remember_retained(template.events.iter().chain(&instance.locals), &mut retained_indexes);
    }
    for &e in &source_events {
        let r = &e.rule;
        let name = text(get(r, "name"));
        if extra_indexes.contains(&e.index) {
            x.discover(r, e)?;
            continue;
        }
        if has(r, "instance") {
            x.discover(get(r, "instance"), e)?;
            continue;
        }
        if has(r, "args") {
            x.discover(
                &obj([("call", string(name)), ("args", get(r, "args").clone()), ("at", get(r, "at").clone())]),
                e,
            )?
        }
        if retained_indexes.contains(&e.index) {
            let mut body = r.clone();
            remove(&mut body, "args");
            x.discover(&body, e)?
        }
    }
    let mut cursor = 0;
    while cursor < x.queue.len() {
        let id = x.queue[cursor];
        cursor += 1;
        let i = x.instances[id].clone();
        let t = &x.templates[x.template_names[text(get(&i.call, "call"))]];
        for e in sorted(&t.events, &i.locals) {
            let env: BTreeMap<_, _> = list(get(&e.rule, "params"))
                .iter()
                .zip(list(get(&i.call, "args")))
                .map(|(k, v)| (text(k).to_string(), v.clone()))
                .collect();
            let mut body = e.rule.clone();
            for k in ["params", "args", "instance"] {
                remove(&mut body, k)
            }
            set(&mut body, "name", string(i.effective()));
            let context = Event { origin: Some(i.origin.clone()), instance: i.canonical.clone(), ..e };
            let template_conditions: Vec<Json> = match get(&body, "conditions") {
                Json::Arr(conditions) => conditions
                    .iter()
                    .map(|condition| if mentions_parameter(condition) { condition.clone() } else { Json::Null })
                    .collect(),
                _ => Vec::new(),
            };
            let expanded = x.substitute(&body, &env, &context, "term")?;
            let definition = Event { template_conditions, rule: expanded, ..context };
            x.decode(&empty(vec![definition.rule.clone()]), &definition)?;
            x.instances[id].definitions.push(definition);
        }
        for e in retained(&x.instances[id].definitions.clone()) {
            x.discover(&e.rule, e)?
        }
    }
    let mut validation_keys: BTreeSet<_> = x.keys.keys().cloned().collect();
    let mut validation_queue = VecDeque::new();
    let mut validation_definitions = Vec::new();
    for e in &events {
        if !["params", "args", "instance"].iter().any(|k| has(&e.rule, k)) {
            x.validation_calls(&e.rule, e, &mut validation_keys, &mut validation_queue)?;
        }
    }
    for id in &x.queue {
        for e in &x.instances[*id].definitions {
            x.validation_calls(&e.rule, e, &mut validation_keys, &mut validation_queue)?;
        }
    }
    while let Some((call, origin)) = validation_queue.pop_front() {
        let name = canonical(&call, uni);
        let t = &x.templates[x.template_names[text(get(&call, "call"))]];
        for e in &t.events {
            let env = list(get(&e.rule, "params"))
                .iter()
                .zip(list(get(&call, "args")))
                .map(|(k, v)| (text(k).to_string(), v.clone()))
                .collect();
            let mut body = e.rule.clone();
            remove(&mut body, "params");
            set(&mut body, "name", string(&name));
            let context = Event { origin: Some(origin.clone()), instance: name.clone(), ..e.clone() };
            let template_conditions: Vec<Json> = match get(&body, "conditions") {
                Json::Arr(conditions) => conditions
                    .iter()
                    .map(|condition| if mentions_parameter(condition) { condition.clone() } else { Json::Null })
                    .collect(),
                _ => Vec::new(),
            };
            let rule = x.substitute(&body, &env, &context, "term")?;
            let definition = Event { template_conditions, rule, ..context };
            x.decode(&empty(vec![definition.rule.clone()]), &definition)?;
            x.validation_calls(&definition.rule, &definition, &mut validation_keys, &mut validation_queue)?;
            validation_definitions.push(definition);
        }
    }
    let mut validation = Vec::new();
    let mut output = Vec::new();
    for e in &events {
        if has(&e.rule, "params") {
            x.rewrite(&e.rule, e, "term")?;
            validation.push(e.clone());
        } else if !["args", "instance"].iter().any(|k| has(&e.rule, k)) {
            validation.push(Event { rule: x.rewrite(&e.rule, e, "term")?, ..e.clone() })
        }
    }
    for id in &x.queue {
        let i = &x.instances[*id];
        for e in &i.definitions {
            let mut r = e.rule.clone();
            set(&mut r, "name", string(i.effective()));
            validation.push(Event { rule: x.rewrite(&r, e, "term")?, ..e.clone() })
        }
    }
    for e in &validation_definitions {
        validation.push(Event { rule: x.rewrite(&e.rule, e, "term")?, ..e.clone() });
    }
    let mut arguments = Vec::new();
    let mut fragments = Vec::new();
    let owner_runs: BTreeMap<_, _> = validation
        .iter()
        .enumerate()
        .map(|(index, event)| {
            let run = if event.origin.is_some() { documents.len() + index } else { event.inspection_run };
            ((event.index, event.instance.clone()), run)
        })
        .collect();
    for e in source_events
        .iter()
        .copied()
        .chain(x.queue.iter().flat_map(|id| x.instances[*id].definitions.iter()))
        .chain(&validation_definitions)
    {
        let run = owner_runs.get(&(e.index, e.instance.clone())).copied().unwrap_or(e.inspection_run);
        x.inspect_arguments(e, run, extra_indexes.contains(&e.index), &mut arguments, &mut fragments)?;
    }
    let mut users = Vec::new();
    let mut decoded = BTreeMap::new();
    for (index, e) in validation.into_iter().enumerate() {
        let run = if e.origin.is_some() { documents.len() + index } else { e.inspection_run };
        let d = Arc::new(x.decode(&empty(vec![e.rule.clone()]), &e)?);
        decoded.insert((e.index, text(get(&e.rule, "name")).to_string()), (run, d.clone()));
        users.push((run, e.path, d));
    }
    for fragment in fragments {
        let event = fragment.event;
        let mut decoded = x.decode(&empty(vec![event.rule.clone()]), &event)?;
        arguments.push(ArgumentUse {
            order: fragment.order,
            kind: event.kind,
            path: event.path.clone(),
            inspection_run: fragment.inspection_run,
            position: fragment.position,
            at: at(&event.rule).unwrap(),
            tags: false,
            part: RetainedPart::Fragment(Box::new(decoded.rules.remove(0))),
        });
    }
    arguments.sort_by_key(|argument| argument.order);
    let mut ordinary_events: Vec<_> = ordinary.values().flatten().collect();
    ordinary_events.sort_by_key(|e| e.index);
    for e in ordinary_events {
        output.push((e.path.clone(), e.index, text(get(&e.rule, "name")).to_string()));
    }
    for id in &x.queue {
        let i = &x.instances[*id];
        for e in &i.definitions {
            output.push((e.path.clone(), e.index, i.effective().to_string()));
        }
    }
    let mut expanded = Vec::new();
    let mut inspection_runs = Vec::new();
    for (index, ((path, _), raw)) in documents.iter().zip(raw_docs).enumerate() {
        let mut raw = raw;
        set(&mut raw, "rules", Json::Arr(Vec::new()));
        for k in KINDS.into_iter().filter(|k| *k != "rules") {
            let items = list(get(&raw, k))
                .iter()
                .map(|r| {
                    x.rewrite(
                        r,
                        &Event {
                            path: path.clone(),
                            rule: r.clone(),
                            index: 0,
                            kind: 0,
                            inspection_run: 0,
                            origin: None,
                            instance: String::new(),
                            template_conditions: Vec::new(),
                        },
                        "term",
                    )
                })
                .collect::<R<Vec<_>>>()?;
            set(&mut raw, k, Json::Arr(items));
        }
        let e = Event {
            path: path.clone(),
            rule: raw.clone(),
            index: 0,
            kind: 0,
            inspection_run: 0,
            origin: None,
            instance: String::new(),
            template_conditions: Vec::new(),
        };
        expanded.push((path.clone(), Arc::new(x.decode(&raw, &e)?)));
        inspection_runs.push(index);
    }
    for (path, index, name) in output {
        // Output events are a subset of the checked ordinary and instance definitions.
        let (run, dom) = decoded.get(&(index, name)).expect("a checked output definition");
        expanded.push((path, dom.clone()));
        inspection_runs.push(*run);
    }
    let mut order: Vec<_> = slots.into_iter().filter(|n| current.contains_key(n) || ordinary.contains_key(n)).collect();
    order.extend(
        x.queue.iter().map(|i| &x.instances[*i]).filter(|i| i.name.is_none()).map(|i| i.effective().to_string()),
    );
    #[cfg(test)]
    let instance_names = {
        let names: BTreeSet<_> = x.queue.iter().map(|i| x.instances[*i].effective()).collect();
        order.iter().filter(|name| names.contains(name.as_str())).cloned().collect()
    };
    Ok(Some(Expansion {
        erasure_checks: x.erasure_checks.into_inner(),
        documents: expanded,
        inspection_runs,
        order,
        #[cfg(test)]
        instance_names,
        validation: users,
        arguments,
    }))
}
impl Expander<'_> {
    fn normalize(&self, root: &Json) -> Json {
        normalize_patterns(root, &self.patterns)
    }
    fn flow(&self, events: &[&Event]) -> R<()> {
        struct Edge<'a> {
            from: (&'a str, usize),
            to: (&'a str, usize),
            growing: bool,
            event: &'a Event,
            node: &'a Json,
            arg: &'a Json,
        }
        let mut edges = Vec::new();
        let mut outgoing = BTreeMap::<_, Vec<usize>>::new();
        for &e in events {
            let params = list(get(&e.rule, "params"));
            for n in source_nodes(&e.rule) {
                if has(n, "param") && !params.contains(get(n, "param")) {
                    return Err(e.fail(n, format!("undeclared parameter @{}", text(get(n, "param")))));
                }
                if !has(n, "call") {
                    continue;
                }
                let name = text(get(n, "call"));
                let t = self
                    .template_names
                    .get(name)
                    .map(|i| &self.templates[*i])
                    .ok_or_else(|| e.fail(n, format!("unknown template {name}")))?;
                if list(get(n, "args")).len() != t.arity {
                    return Err(e.fail(n, format!("template {name} expects {} arguments", t.arity)));
                }
                for (i, arg) in list(get(n, "args")).iter().enumerate() {
                    let mut normalized = None;
                    for part in source_nodes(arg) {
                        if has(part, "capture") || has(part, "captured") {
                            return Err(e.fail(part, "an argument cannot read or declare captures".into()));
                        }
                        if let Some(p) = params.iter().position(|p| p == get(part, "param")) {
                            let from = (text(get(&e.rule, "name")), p);
                            outgoing.entry(from).or_default().push(edges.len());
                            edges.push(Edge {
                                from,
                                to: (name, i),
                                growing: get(normalized.get_or_insert_with(|| self.normalize(arg)), "param")
                                    != get(part, "param"),
                                event: e,
                                node: n,
                                arg,
                            });
                        }
                    }
                }
            }
        }
        for template in &self.templates {
            for parameter in 0..template.arity {
                let source = (template.name.as_str(), parameter);
                for &first in outgoing.get(&source).into_iter().flatten() {
                    let edge = &edges[first];
                    if !edge.growing {
                        continue;
                    }
                    // Each trace entry names one edge and its predecessor.
                    let mut traces = vec![(first, None)];
                    let mut pending = vec![(edge.to, 0)];
                    let mut seen = BTreeSet::new();
                    while let Some((target, trace)) = pending.pop() {
                        if target == source {
                            let mut path = Vec::new();
                            let mut cursor = Some(trace);
                            while let Some(index) = cursor {
                                let (edge, previous) = traces[index];
                                path.push(edge);
                                cursor = previous;
                            }
                            path.reverse();
                            let trail = path
                                .into_iter()
                                .map(|index| {
                                    let e = &edges[index];
                                    let a = at(e.node).unwrap();
                                    format!(
                                        "{}:{} → {}:{} at {}:{}:{}",
                                        e.from.0, e.from.1, e.to.0, e.to.1, e.event.path, a.0, a.1
                                    )
                                })
                                .collect::<Vec<_>>()
                                .join(" then ");
                            return Err(edge.event.fail(
                                edge.node,
                                format!(
                                    "unbounded-instantiation: {trail}, growing argument {}",
                                    canonical(edge.arg, self.uni)
                                ),
                            ));
                        }
                        if !seen.insert(target) {
                            continue;
                        }
                        for &next in outgoing.get(&target).into_iter().flatten() {
                            let index = traces.len();
                            traces.push((next, Some(trace)));
                            pending.push((edges[next].to, index));
                        }
                    }
                }
            }
        }
        Ok(())
    }
    fn intern(&mut self, call: &Json, event: &Event, discover: bool) -> R<usize> {
        let name = text(get(call, "call"));
        let t = self
            .template_names
            .get(name)
            .map(|i| &self.templates[*i])
            .filter(|t| t.arity == list(get(call, "args")).len())
            .ok_or_else(|| event.fail(call, "an instance call requires the declared arity".into()))?;
        let _ = t;
        let call =
            obj([("call", string(name)), ("args", self.normalize(get(call, "args"))), ("at", get(call, "at").clone())]);
        let k = key(&call);
        let i = if let Some(i) = self.keys.get(&k) {
            *i
        } else {
            let i = self.instances.len();
            self.keys.insert(k.clone(), i);
            self.instances.push(Instance {
                canonical: canonical(&call, self.uni),
                name: None,
                origin: obj([("document", string(&*event.path)), ("at", get(&call, "at").clone())]),
                call: call.clone(),
                locals: Vec::new(),
                definitions: Vec::new(),
                discovered: false,
            });
            i
        };
        if discover && !self.instances[i].discovered {
            self.instances[i].discovered = true;
            self.instances[i].origin = obj([("document", string(&*event.path)), ("at", get(&call, "at").clone())]);
            self.queue.push(i)
        }
        Ok(i)
    }
    fn discover(&mut self, root: &Json, event: &Event) -> R<()> {
        Self::visit_calls(root, &mut |call| {
            self.intern(call, event, true)?;
            Ok(())
        })
    }
    fn visit_calls(root: &Json, visit: &mut impl FnMut(&Json) -> R<()>) -> R<()> {
        match root {
            Json::Arr(xs) => {
                for x in xs {
                    Self::visit_calls(x, visit)?
                }
            }
            Json::Obj(fs) => {
                if has(root, "alternatives") {
                    for (i, alt) in list(get(root, "alternatives")).iter().enumerate() {
                        for k in ["expr", "tags", "value", "image"] {
                            Self::visit_calls(get(alt, k), visit)?
                        }
                        if i == 0 {
                            for k in ["tags", "value", "image", "conditions", "emit"] {
                                Self::visit_calls(get(root, k), visit)?
                            }
                        }
                    }
                    return Ok(());
                }
                if has(root, "method") {
                    Self::visit_calls(get(root, "receiver"), visit)?;
                    Self::visit_calls(get(root, "args"), visit)?
                } else if has(root, "call") {
                    Self::visit_calls(get(root, "args"), visit)?
                } else {
                    const ORDER: &[&str] = &[
                        "if",
                        "then",
                        "op",
                        "left",
                        "right",
                        "not",
                        "any",
                        "all",
                        "body",
                        "targets",
                        "requirements",
                        "negated",
                        "value",
                        "pattern",
                        "child",
                        "children",
                        "expr",
                        "repeat",
                        "separator",
                        "optional",
                        "seq",
                        "choice",
                        "ranked",
                        "and",
                        "union",
                        "intersection",
                        "difference",
                        "concat",
                        "items",
                        "tags",
                        "image",
                        "before",
                        "after",
                    ];
                    let mut fields: Vec<_> = fs.iter().filter(|(k, _)| k != "at" && k != SOURCE).collect();
                    fields.sort_by_key(|(k, _)| (ORDER.iter().position(|v| *v == k).unwrap_or(ORDER.len()), k));
                    for (_, v) in fields {
                        Self::visit_calls(v, visit)?;
                    }
                }
                if has(root, "call") && !nodes(get(root, "args")).any(|n| has(n, "param")) {
                    visit(root)?;
                }
                if has(root, "call") && has(root, "children") {
                    Self::visit_calls(get(root, "children"), visit)?;
                }
            }
            _ => (),
        }
        Ok(())
    }
    fn validation_calls(
        &self,
        root: &Json,
        event: &Event,
        keys: &mut BTreeSet<String>,
        queue: &mut VecDeque<(Json, Json)>,
    ) -> R<()> {
        Self::visit_calls(root, &mut |call| {
            let normalized = obj([
                ("call", get(call, "call").clone()),
                ("args", self.normalize(get(call, "args"))),
                ("at", get(call, "at").clone()),
            ]);
            if keys.insert(key(&normalized)) {
                queue.push_back((
                    normalized,
                    obj([("document", string(&*event.path)), ("at", get(call, "at").clone())]),
                ));
            }
            Ok(())
        })
    }
    fn inspect_arguments(
        &self,
        event: &Event,
        inspection_run: usize,
        extra: bool,
        arguments: &mut Vec<ArgumentUse>,
        fragments: &mut Vec<FragmentInspection>,
    ) -> R<()> {
        for call in
            source_nodes(&event.rule).filter(|n| has(n, "call") || has(n, "name") && has(n, "args") && has(n, "op"))
        {
            for argument in list(get(call, "args")) {
                let parts: Vec<_> = source_nodes(argument).collect();
                let references: Vec<_> = parts.iter().filter(|n| has(n, "const") || has(n, "constant")).collect();
                if references.is_empty() {
                    continue;
                }
                let position = at(references[0]).unwrap();
                let mut add = |term: &Json, tags| -> R<()> {
                    let term = self.rewrite(term, event, "term")?;
                    let decoded = dom::term_from_json(&term).map_err(|p| event.fail(&term, p))?;
                    arguments.push(ArgumentUse {
                        order: arguments.len() + fragments.len(),
                        path: event.path.clone(),
                        kind: event.kind,
                        part: RetainedPart::Term(decoded),
                        inspection_run,
                        position,
                        at: at(&event.rule).unwrap(),
                        tags,
                    });
                    Ok(())
                };
                let arg = self.normalize(argument);
                if ["splice", "body", "test", "range", "wildcard"].iter().any(|k| has(&arg, k)) {
                    let body = arg.get("body").unwrap_or(&arg);
                    let mut rule = obj([
                        ("name", if extra { string("text") } else { get(&event.rule, "name").clone() }),
                        ("op", string("define")),
                        ("conditions", Json::Arr(Vec::new())),
                        (
                            "alternatives",
                            Json::Arr(vec![obj([
                                ("guards", Json::Arr(Vec::new())),
                                ("expr", self.rewrite(body, event, "expr")?),
                            ])]),
                        ),
                        ("at", get(&event.rule, "at").clone()),
                    ]);
                    if parts.iter().any(|node| has(node, "param")) {
                        set(&mut rule, "params", get(&event.rule, "params").clone());
                    }
                    let fragment = Event { rule, ..event.clone() };
                    fragments.push(FragmentInspection {
                        order: arguments.len() + fragments.len(),
                        inspection_run,
                        position,
                        event: fragment,
                    });
                } else if has(&arg, "requirements") {
                    for requirement in list(get(&arg, "requirements")) {
                        add(get(requirement, "value"), true)?;
                    }
                } else if !["call", "rule", "targets"].iter().any(|k| has(&arg, k)) {
                    add(&arg, false)?;
                }
            }
        }
        Ok(())
    }
    fn convert(&self, arg: &Json, position: &str, event: &Event, use_: &Json) -> R<Json> {
        let arg = self.normalize(arg);
        if position == "arg" {
            return Ok(arg);
        }
        if position == "expr" {
            if has(&arg, "body") {
                return Ok(get(&arg, "body").clone());
            }
            if has(&arg, "targets") {
                return Ok(obj([(
                    "choice",
                    Json::Arr(
                        list(get(&arg, "targets"))
                            .iter()
                            .map(|a| self.convert(a, "expr", event, use_))
                            .collect::<R<_>>()?,
                    ),
                )]));
            }
            for k in ["rule", "tag", "terminal"] {
                if has(&arg, k) {
                    return Ok(obj([("ref", get(&arg, k).clone())]));
                }
            }
            if has(&arg, "string") || has(&arg, "const") {
                return Ok(obj([("literal", arg)]));
            }
            if ["splice", "call", "test", "range", "wildcard"].iter().any(|k| has(&arg, k)) {
                return Ok(arg);
            }
        } else if position == "pattern" {
            for (k, out) in [("rule", "name"), ("tag", "terminal"), ("terminal", "terminal")] {
                if has(&arg, k) {
                    return Ok(obj([(out, get(&arg, k).clone()), ("at", get(use_, "at").clone())]));
                }
            }
            if has(&arg, "pattern") {
                return Ok(get(&arg, "pattern").clone());
            }
            if has(&arg, "string") {
                return Ok(obj([("literal", arg), ("at", get(use_, "at").clone())]));
            }
            if has(&arg, "const") {
                return Ok(obj([("constant", get(&arg, "const").clone()), ("at", get(use_, "at").clone())]));
            }
            if has(&arg, "test") {
                let mut r = arg.clone();
                set(&mut r, "expr", self.convert(&argument(get(&arg, "expr").clone()), "pattern", event, use_)?);
                return Ok(r);
            }
            if ["range", "wildcard", "call"].iter().any(|k| has(&arg, k)) {
                let mut r = arg;
                set(&mut r, "at", get(use_, "at").clone());
                return Ok(r);
            }
        } else if position == "target" {
            if has(&arg, "tag") {
                return Ok(obj([("terminal", get(&arg, "tag").clone())]));
            }
            if ["rule", "terminal", "call"].iter().any(|k| has(&arg, k)) {
                return Ok(arg);
            }
        } else if position == "term"
            && !["body", "targets", "requirements", "rule", "call", "test", "range", "wildcard"]
                .iter()
                .any(|k| has(&arg, k))
        {
            return Ok(arg);
        }
        Err(event.fail(
            use_,
            format!(
                "argument {} is invalid at @{} in {position} position",
                canonical(&arg, self.uni),
                text(get(use_, "param"))
            ),
        ))
    }
    fn substitute(&self, root: &Json, env: &BTreeMap<String, Json>, event: &Event, position: &str) -> R<Json> {
        if let Json::Arr(xs) = root {
            return Ok(Json::Arr(xs.iter().map(|v| self.substitute(v, env, event, position)).collect::<R<_>>()?));
        }
        let Some(_) = root.as_object() else { return Ok(root.clone()) };
        if has(root, "param") {
            let arg =
                env.get(text(get(root, "param"))).ok_or_else(|| event.fail(root, "an undeclared parameter".into()))?;
            let mut converted = self.convert(arg, position, event, root)?;
            if position != "pattern" || !has(root, "exact") && !has(root, "children") {
                return Ok(converted);
            }
            if ["union", "intersection", "difference", "path"].iter().any(|k| has(&converted, k)) {
                return Err(event.fail(root, "a compound pattern cannot carry node decorations".into()));
            }
            if has(root, "exact") {
                if has(&converted, "exact") {
                    return Err(event.fail(root, "an exact prefix conflicts with an argument prefix".into()));
                }
                set(&mut converted, "exact", Json::Bool(true));
            }
            if has(root, "children") {
                if !(has(&converted, "name") || has(&converted, "call")) || has(&converted, "children") {
                    return Err(event.fail(root, "an attached list requires a rule test without children".into()));
                }
                set(&mut converted, "children", self.substitute(get(root, "children"), env, event, "pattern-item")?);
            }
            return Ok(converted);
        }
        let mut result = root.clone();
        for (k, v) in source_fields(root) {
            if k == "at" || k == SOURCE {
                continue;
            }
            if k == "args" && has(root, "call") {
                set(
                    &mut result,
                    k,
                    Json::Arr(list(v).iter().map(|x| self.substitute(x, env, event, "arg")).collect::<R<_>>()?),
                );
                continue;
            }
            if k == "args" && has(root, "method") {
                let method = text(get(root, "method"));
                let query = ["matches", "begins", "ends", "followed-by", "preceded-by"].contains(&method);
                let target = query || ["tags", "without-elision-except"].contains(&method);
                let mut args = Vec::new();
                for arg in list(v) {
                    let replacement = env.get(text(get(arg, "param")));
                    if let Some(r) = replacement.filter(|r| query && has(r, "targets")) {
                        for t in list(get(r, "targets")) {
                            args.push(self.convert(t, "target", event, arg)?)
                        }
                    } else {
                        args.push(self.substitute(arg, env, event, if target { "target" } else { "term" })?)
                    }
                }
                set(&mut result, k, Json::Arr(args));
                continue;
            }
            if k == "requirements" {
                let mut rs = Vec::new();
                for r in list(v) {
                    let replacement = env.get(text(get(get(r, "value"), "param")));
                    if let Some(rp) = replacement.filter(|r| {
                        r.as_object().is_some_and(|fs| fs.iter().all(|(k, _)| k == "requirements" || k == SOURCE))
                            && has(r, "requirements")
                    }) {
                        if get(r, "negated") == &Json::Bool(true) {
                            return Err(event.fail(
                                get(r, "value"),
                                "a requirement list cannot replace a negated requirement".into(),
                            ));
                        }
                        rs.extend_from_slice(list(get(rp, "requirements")))
                    } else {
                        let mut r = r.clone();
                        let v = self.substitute(get(&r, "value"), env, event, "term")?;
                        set(&mut r, "value", v);
                        rs.push(r)
                    }
                }
                set(&mut result, k, Json::Arr(rs));
                continue;
            }
            if k == "optional" && get(root, "elidable") == &Json::Bool(true) {
                let mut head = list(get(v, "seq")).first().unwrap_or(v);
                while has(head, "test") {
                    head = get(head, "expr")
                }
                if let Some(arg) = env.get(text(get(head, "param"))) {
                    let arg = identity(&self.normalize(arg));
                    if !arg.as_object().is_some_and(|fs| {
                        fs.len() == 1
                            && has(&arg, "tag")
                            && text(get(&arg, "tag")).starts_with(|c: char| c.is_ascii_uppercase())
                    }) {
                        return Err(event.fail(head, "an elidable parameter head requires one bare user tag".into()));
                    }
                }
            }
            let mut substituted = self.substitute(v, env, event, child_position(k, position))?;
            if k == "default" {
                if let Some(source) = v.get(SOURCE) {
                    set(&mut substituted, SOURCE, source.clone());
                }
            }
            set(&mut result, k, substituted);
        }
        if position == "pattern" && has(&result, "test") && has(get(&result, "expr"), "exact") {
            if has(&result, "exact") {
                let mut use_ = get(root, "expr");
                while has(use_, "expr") {
                    use_ = get(use_, "expr");
                }
                return Err(event.fail(use_, "an exact prefix conflicts with an argument prefix".into()));
            }
            set(&mut result, "exact", Json::Bool(true));
            let mut inner = get(&result, "expr").clone();
            remove(&mut inner, "exact");
            set(&mut result, "expr", inner);
        }
        for k in if position == "pattern" || pattern_term(&result, &self.patterns) {
            vec!["concat", "union", "intersection"]
        } else {
            vec!["concat", "union"]
        } {
            if let Some(xs) = result.get(k).and_then(Json::as_array) {
                let flat = xs
                    .iter()
                    .flat_map(|n| n.get(k).and_then(Json::as_array).unwrap_or(std::slice::from_ref(n)))
                    .cloned()
                    .collect();
                set(&mut result, k, Json::Arr(flat))
            }
        }
        Ok(result)
    }
    fn erasure_check(&self, root: &Json, event: &Event, position: &str, names: Vec<String>, name: &str) {
        let children = list(get(root, "children"));
        if position != "pattern"
            || !has(root, "children")
            || matches!(children,[child] if get(child,"siblings").as_bool()==Some(true))
        {
            return;
        }
        self.erasure_checks.borrow_mut().push(ErasurePatternCheck {
            names,
            name: name.to_owned(),
            document: event.path.to_string(),
            at: at(root).or_else(|| at(&event.rule)).unwrap_or_default(),
        });
    }
    fn rewrite(&self, root: &Json, event: &Event, position: &str) -> R<Json> {
        if let Json::Arr(xs) = root {
            return Ok(Json::Arr(xs.iter().map(|v| self.rewrite(v, event, position)).collect::<R<_>>()?));
        }
        let Some(fields) = root.as_object() else { return Ok(root.clone()) };
        let named = text(get(root, "name"));
        if !named.is_empty() && !self.template_names.contains_key(named) {
            self.erasure_check(root, event, position, vec![named.to_string()], named);
        }

        if has(root, "call") {
            let name = self
                .keys
                .get(&key(&self.normalize(&obj([
                    ("call", get(root, "call").clone()),
                    ("args", get(root, "args").clone()),
                    ("at", get(root, "at").clone()),
                ]))))
                .map(|i| self.instances[*i].effective().to_string())
                .unwrap_or_else(|| canonical(root, self.uni));
            self.erasure_check(root, event, position, vec![name.clone()], &name);
            let mut value = if position == "pattern" {
                obj([("name", string(name)), ("at", get(root, "at").clone())])
            } else {
                obj([(if position == "expr" { "ref" } else { "rule" }, string(name))])
            };
            if position == "pattern" {
                if has(root, "exact") {
                    set(&mut value, "exact", Json::Bool(true));
                }
                if has(root, "children") {
                    set(&mut value, "children", self.rewrite(get(root, "children"), event, "pattern-item")?);
                }
            }
            set(&mut value, SOURCE, root.get(SOURCE).cloned().unwrap_or_else(|| get(root, "at").clone()));
            return Ok(value);
        }
        if position == "pattern" && self.template_names.contains_key(text(get(root, "name"))) {
            let names = self
                .queue
                .iter()
                .map(|i| &self.instances[*i])
                .filter(|i| get(&i.call, "call") == get(root, "name"))
                .map(|i| i.effective().to_string())
                .collect();
            self.erasure_check(root, event, position, names, text(get(root, "name")));
            let children = if has(root, "children") {
                Some(self.rewrite(get(root, "children"), event, "pattern-item")?)
            } else {
                None
            };
            let members: Vec<_> = self
                .queue
                .iter()
                .map(|i| &self.instances[*i])
                .filter(|i| get(&i.call, "call") == get(root, "name"))
                .map(|i| {
                    let mut member = root.clone();
                    set(&mut member, "name", string(i.effective()));
                    if has(root, "children") {
                        set(&mut member, "children", children.clone().unwrap());
                    }
                    Ok(member)
                })
                .collect::<R<_>>()?;
            return Ok(if members.len() == 1 {
                members[0].clone()
            } else if !members.is_empty() {
                obj([("union", Json::Arr(members))])
            } else {
                let mut n = obj([("name", string("text")), ("at", get(root, "at").clone())]);
                if get(root, "exact").as_bool() == Some(true) {
                    set(&mut n, "exact", Json::Bool(true));
                }
                obj([("difference", Json::Arr(vec![n.clone(), n]))])
            });
        }
        if ["ref", "rule"].iter().any(|k| self.template_names.contains_key(text(get(root, k)))) {
            return Err(event.fail(root, "a bare template reference must name one instance".into()));
        }
        let mut result = Json::Obj(
            fields
                .iter()
                .map(|(k, v)| {
                    Ok((
                        k.clone(),
                        if k == "at" || k == SOURCE {
                            v.clone()
                        } else {
                            self.rewrite(v, event, child_position(k, position))?
                        },
                    ))
                })
                .collect::<R<_>>()?,
        );
        if position == "pattern" && has(&result, "test") {
            return Ok(distribute_family_test(result));
        }
        if position == "pattern" {
            for key in ["union", "intersection"] {
                if has(&result, key) {
                    let flat = list(get(&result, key))
                        .iter()
                        .flat_map(|v| if has(v, key) { list(get(v, key)).to_vec() } else { vec![v.clone()] })
                        .collect();
                    set(&mut result, key, Json::Arr(flat));
                }
            }
        }
        Ok(result)
    }
    fn decode(&self, root: &Json, event: &Event) -> R<Dom> {
        // The conditions of the template rule as written, where one
        // held a parameter (engine §3.6), for the instances decoded
        // here. A parameter decodes to a source term, which is never
        // closed, so the decoded form is the template's reading.
        let template_conditions: Vec<Option<dom::Cond>> = {
            let written: Vec<Json> = if !event.template_conditions.is_empty() {
                event.template_conditions.clone()
            } else {
                match get(&event.rule, "conditions") {
                    Json::Arr(conditions) => conditions
                        .iter()
                        .map(|condition| if mentions_parameter(condition) { condition.clone() } else { Json::Null })
                        .collect(),
                    _ => Vec::new(),
                }
            };
            written
                .iter()
                .map(|condition| match condition {
                    Json::Null => None,
                    condition => dom::cond_from_json(condition).ok(),
                })
                .collect()
        };
        let checked = clean(root);
        let failure = |message: String| {
            let name = text(get(&event.rule, "name"));
            let prefix = format!("rule {name}: ");
            let message = if name.is_empty() || message.starts_with(&prefix) { message } else { prefix + &message };
            event.fail(&event.rule, message)
        };
        if let Some(problem) = dom::schema::structure_problem(&checked, self.uni, true) {
            return Err(failure(problem));
        }
        // The template forms go on before the definition checks, which
        // read them (engine §3.6).
        let mut d = dom::decode_nodes(&checked).map_err(failure)?;
        for rule in &mut d.rules {
            rule.template_conditions = template_conditions.clone();
        }
        if let Some(problem) = dom::schema::decoded_problem(&checked, &mut d) {
            return Err(failure(problem));
        }
        super::locations::restore_document(&mut d, root);
        Ok(d)
    }
}

fn distribute_family_test(test: Json) -> Json {
    for key in ["union", "intersection", "difference"] {
        if let Some(parts) = get(get(&test, "expr"), key).as_array() {
            let members = parts
                .iter()
                .map(|part| {
                    let mut member = test.clone();
                    set(&mut member, "expr", part.clone());
                    distribute_family_test(member)
                })
                .collect();
            let mut out = obj([(key, Json::Arr(members))]);
            if let Some(source) = test.get(SOURCE) {
                set(&mut out, SOURCE, source.clone())
            }
            return out;
        }
    }
    test
}
