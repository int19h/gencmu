//! Stage-local discovery, substitution, and source-order event replay.
use super::print::canonical;
use super::*;
use crate::error::Error;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
type R<T> = Result<T, Error>;
type Documents = Vec<(Arc<str>, Arc<Dom>)>;
#[derive(Debug, Clone)]
pub(crate) struct Event {
    pub path: Arc<str>,
    pub rule: Json,
    pub index: usize,
    pub origin: Option<Json>,
    pub instance: String,
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
            e.code = Some("unbounded-instantiation".into())
        }
        e
    }
}
fn at_origin(n: &Json) -> (usize, usize) {
    at(n).unwrap_or((1, 1))
}
#[derive(Debug, Clone)]
pub(crate) struct Template {
    pub name: String,
    pub path: Arc<str>,
    pub at: (usize, usize),
    pub arity: usize,
    pub events: Vec<Event>,
}
#[derive(Debug, Clone)]
pub(crate) struct Instance {
    pub key: String,
    pub canonical: String,
    pub name: Option<String>,
    pub call: Json,
    pub origin: Json,
    pub binding: Json,
    pub locals: Vec<Event>,
    pub definitions: Vec<Event>,
    discovered: bool,
}
impl Instance {
    pub fn effective(&self) -> &str {
        self.name.as_deref().unwrap_or(&self.canonical)
    }
}
#[derive(Debug, Clone, Default)]
pub(crate) struct Records {
    pub templates: Vec<Template>,
    pub instances: Vec<Instance>,
}
pub(crate) struct Expansion {
    pub documents: Documents,
    pub order: Vec<String>,
    pub records: Records,
    pub validation: Vec<(Arc<str>, dom::RuleDef)>,
}
struct Expander<'a> {
    uni: &'a Unicode,
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
        && ["seq", "choice", "ranked", "and", "optional", "repeat", "separator", "expr"].contains(&key)
    {
        return "expr";
    }
    if ["pattern", "children", "node"].contains(&key) {
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
    if !documents.iter().any(|(_, d)| !d.unresolved.is_empty()) {
        return Ok(None);
    }
    let mut x = Expander {
        uni,
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
    for (path, d) in documents {
        let mut raw = crate::json::parse(&dom::dom_to_json(d)).expect("a DOM writer produces JSON");
        for kind in KINDS {
            let rs = list(get(&raw, kind))
                .iter()
                .map(|r| d.unresolved.get(&at(r).unwrap()).cloned().unwrap_or_else(|| r.clone()))
                .collect();
            set(&mut raw, kind, Json::Arr(rs));
        }
        super::locations::annotate_document(&mut raw, d);
        let mut items: Vec<_> =
            KINDS.into_iter().flat_map(|k| list(get(&raw, k)).iter().map(move |r| (k, r))).collect();
        items.sort_by_key(|(_, r)| at(r));
        for (kind, r) in items {
            let e = Event { path: path.clone(), rule: r.clone(), index: serial, origin: None, instance: String::new() };
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
                    x.templates.push(Template {
                        name,
                        path: path.clone(),
                        at: at(r).unwrap(),
                        arity: list(get(r, "params")).len(),
                        events: vec![e.clone()],
                    });
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
    x.flow(&sorted(&events, &extra))?;
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
                x.instances[*old].binding = Json::Null
            }
            let a = at(r).unwrap();
            x.instances[i].name = Some(name.into());
            x.instances[i].binding = obj([
                ("document", string(&*e.path)),
                ("line", Json::Int(a.0 as i64)),
                ("column", Json::Int(a.1 as i64)),
            ]);
            current.insert(name.into(), i);
            ordinary.remove(name);
        } else if let Some(i) = current.get(name) {
            x.instances[*i].locals.push(e.clone())
        } else {
            ordinary.entry(name.into()).or_default().push(e.clone())
        }
    }
    for e in sorted(&events, &extra) {
        let r = &e.rule;
        let name = text(get(r, "name"));
        if extra.iter().any(|v| v.index == e.index) {
            x.discover(r, &e)?;
            continue;
        }
        if has(r, "instance") {
            x.discover(get(r, "instance"), &e)?;
            continue;
        }
        if has(r, "args") {
            x.discover(
                &obj([("call", string(name)), ("args", get(r, "args").clone()), ("at", get(r, "at").clone())]),
                &e,
            )?
        }
        let items = if has(r, "params") {
            Some(x.templates[x.template_names[name]].events.clone())
        } else {
            ordinary.get(name).cloned()
        }
        .or_else(|| {
            x.instances
                .iter()
                .find(|i| i.locals.iter().any(|v| v.index == e.index))
                .map(|i| sorted(&x.templates[x.template_names[text(get(&i.call, "call"))]].events, &i.locals))
        });
        if items.is_some_and(|items| retained(&items).iter().any(|v| v.index == e.index)) {
            let mut body = r.clone();
            remove(&mut body, "args");
            x.discover(&body, &e)?
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
            let expanded = x.substitute(&body, &env, &context, "term")?;
            let mut checked = expanded.clone();
            set(&mut checked, "name", string("expanded"));
            if let Some(p) = schema::declaration(&checked, "rules", uni) {
                return Err(context.fail(&expanded, p.into()));
            }
            x.instances[id].definitions.push(Event { rule: expanded, ..context });
        }
        for e in retained(&x.instances[id].definitions.clone()) {
            x.discover(&e.rule, e)?
        }
    }
    let mut validation = Vec::new();
    let mut output = Vec::new();
    for e in &events {
        if !["params", "args", "instance"].iter().any(|k| has(&e.rule, k)) {
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
    let mut users = Vec::new();
    for e in validation {
        let mut d = x.decode(&empty(vec![e.rule.clone()]), &e)?;
        users.push((e.path, d.rules.remove(0)))
    }
    let mut ordinary_events: Vec<_> = ordinary.values().flatten().collect();
    ordinary_events.sort_by_key(|e| e.index);
    for e in ordinary_events {
        output.push(Event { rule: x.rewrite(&e.rule, e, "term")?, ..e.clone() })
    }
    for id in &x.queue {
        let i = &x.instances[*id];
        for e in &i.definitions {
            let mut r = e.rule.clone();
            set(&mut r, "name", string(i.effective()));
            output.push(Event { rule: x.rewrite(&r, e, "term")?, ..e.clone() })
        }
    }
    let mut started = BTreeSet::new();
    for e in &mut output {
        if started.insert(text(get(&e.rule, "name")).to_string()) {
            set(&mut e.rule, "op", string("define"))
        }
    }
    let mut expanded = Vec::new();
    for ((path, _), raw) in documents.iter().zip(raw_docs) {
        let mut raw = raw;
        set(&mut raw, "rules", Json::Arr(Vec::new()));
        for k in KINDS.into_iter().filter(|k| *k != "rules") {
            let items = list(get(&raw, k))
                .iter()
                .map(|r| {
                    x.rewrite(
                        r,
                        &Event { path: path.clone(), rule: r.clone(), index: 0, origin: None, instance: String::new() },
                        "term",
                    )
                })
                .collect::<R<Vec<_>>>()?;
            set(&mut raw, k, Json::Arr(items));
        }
        let e = Event { path: path.clone(), rule: raw.clone(), index: 0, origin: None, instance: String::new() };
        expanded.push((path.clone(), Arc::new(x.decode(&raw, &e)?)));
    }
    for e in output {
        expanded.push((e.path.clone(), Arc::new(x.decode(&empty(vec![e.rule.clone()]), &e)?)))
    }
    let mut order: Vec<_> = slots.into_iter().filter(|n| current.contains_key(n) || ordinary.contains_key(n)).collect();
    order.extend(
        x.queue.iter().map(|i| &x.instances[*i]).filter(|i| i.name.is_none()).map(|i| i.effective().to_string()),
    );
    let records =
        Records { templates: x.templates, instances: x.queue.into_iter().map(|i| x.instances[i].clone()).collect() };
    Ok(Some(Expansion { documents: expanded, order, records, validation: users }))
}
impl Expander<'_> {
    fn flow(&self, events: &[Event]) -> R<()> {
        #[derive(Clone)]
        struct Edge {
            to: (String, usize),
            growing: bool,
            event: Event,
            node: Json,
            arg: Json,
        }
        let mut edges: BTreeMap<(String, usize), Vec<Edge>> = BTreeMap::new();
        for e in events {
            let params = list(get(&e.rule, "params"));
            for n in nodes(&e.rule) {
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
                    for part in nodes(arg) {
                        if has(part, "capture") || has(part, "captured") {
                            return Err(e.fail(part, "an argument cannot read or declare captures".into()));
                        }
                        if let Some(p) = params.iter().position(|p| p == get(part, "param")) {
                            edges.entry((text(get(&e.rule, "name")).into(), p)).or_default().push(Edge {
                                to: (name.into(), i),
                                growing: get(&normalize(arg), "param") != get(part, "param"),
                                event: e.clone(),
                                node: n.clone(),
                                arg: arg.clone(),
                            })
                        }
                    }
                }
            }
        }
        for (source, outgoing) in &edges {
            for edge in outgoing.iter().filter(|e| e.growing) {
                let mut pending = vec![(edge.to.clone(), vec![(source.clone(), edge.clone())])];
                let mut seen = BTreeSet::new();
                while let Some((target, steps)) = pending.pop() {
                    if &target == source {
                        let trail = steps
                            .iter()
                            .map(|(s, e)| {
                                let a = at(&e.node).unwrap();
                                format!("{}:{} → {}:{} at {}:{}:{}", s.0, s.1, e.to.0, e.to.1, e.event.path, a.0, a.1)
                            })
                            .collect::<Vec<_>>()
                            .join(" then ");
                        return Err(edge.event.fail(
                            &edge.node,
                            format!(
                                "unbounded-instantiation: {trail}, growing argument {}",
                                canonical(&edge.arg, self.uni)
                            ),
                        ));
                    }
                    if !seen.insert(target.clone()) {
                        continue;
                    }
                    for e in edges.get(&target).into_iter().flatten() {
                        let mut path = steps.clone();
                        path.push((target.clone(), e.clone()));
                        pending.push((e.to.clone(), path))
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
        if nodes(call).any(|n| has(n, "param")) {
            return Err(event.fail(call, "an instance call requires closed arguments".into()));
        }
        let call =
            obj([("call", string(name)), ("args", normalize(get(call, "args"))), ("at", get(call, "at").clone())]);
        let k = key(&call);
        let i = if let Some(i) = self.keys.get(&k) {
            *i
        } else {
            let i = self.instances.len();
            self.keys.insert(k.clone(), i);
            self.instances.push(Instance {
                key: k,
                canonical: canonical(&call, self.uni),
                name: None,
                origin: obj([("document", string(&*event.path)), ("at", get(&call, "at").clone())]),
                call: call.clone(),
                binding: Json::Null,
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
        match root {
            Json::Arr(xs) => {
                for x in xs {
                    self.discover(x, event)?
                }
            }
            Json::Obj(fs) => {
                if has(root, "alternatives") {
                    for (i, alt) in list(get(root, "alternatives")).iter().enumerate() {
                        for k in ["expr", "tags", "value", "image"] {
                            self.discover(get(alt, k), event)?
                        }
                        if i == 0 {
                            for k in ["tags", "value", "image", "conditions", "emit"] {
                                self.discover(get(root, k), event)?
                            }
                        }
                    }
                    return Ok(());
                }
                if has(root, "method") {
                    self.discover(get(root, "receiver"), event)?;
                    self.discover(get(root, "args"), event)?
                } else if has(root, "call") {
                    self.discover(get(root, "args"), event)?
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
                        "node",
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
                        self.discover(v, event)?;
                    }
                }
                if has(root, "call") && !nodes(root).any(|n| has(n, "param")) {
                    self.intern(root, event, true)?;
                }
            }
            _ => (),
        }
        Ok(())
    }
    fn convert(&self, arg: &Json, position: &str, event: &Event, use_: &Json) -> R<Json> {
        let arg = normalize(arg);
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
            if ["call", "test", "range", "wildcard"].iter().any(|k| has(&arg, k)) {
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
            if has(&arg, "string") || text(get(&arg, "const")).starts_with('_') {
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
        let Some(fields) = root.as_object() else { return Ok(root.clone()) };
        if has(root, "param") {
            let arg =
                env.get(text(get(root, "param"))).ok_or_else(|| event.fail(root, "an undeclared parameter".into()))?;
            return self.convert(arg, position, event, root);
        }
        let mut result = root.clone();
        for (k, v) in fields {
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
                    let arg = identity(&normalize(arg));
                    if !arg.as_object().is_some_and(|fs| {
                        fs.len() == 1
                            && has(&arg, "tag")
                            && text(get(&arg, "tag")).starts_with(|c: char| c.is_ascii_uppercase())
                    }) {
                        return Err(event.fail(head, "an elidable parameter head requires one bare user tag".into()));
                    }
                }
            }
            set(&mut result, k, self.substitute(v, env, event, child_position(k, position))?);
        }
        for k in ["concat", "union"] {
            if let Some(xs) = result.get(k).and_then(Json::as_array) {
                let j = joined(k, xs.to_vec());
                set(&mut result, k, get(&j, k).clone())
            }
        }
        Ok(result)
    }
    fn rewrite(&self, root: &Json, event: &Event, position: &str) -> R<Json> {
        if let Json::Arr(xs) = root {
            return Ok(Json::Arr(xs.iter().map(|v| self.rewrite(v, event, position)).collect::<R<_>>()?));
        }
        let Some(fields) = root.as_object() else { return Ok(root.clone()) };
        if has(root, "call") {
            let name = self
                .keys
                .get(&key(&normalize(root)))
                .map(|i| self.instances[*i].effective().to_string())
                .unwrap_or_else(|| canonical(root, self.uni));
            let mut value = if position == "pattern" {
                obj([("name", string(name)), ("at", get(root, "at").clone())])
            } else {
                obj([(if position == "expr" { "ref" } else { "rule" }, string(name))])
            };
            set(&mut value, SOURCE, root.get(SOURCE).cloned().unwrap_or_else(|| get(root, "at").clone()));
            return Ok(value);
        }
        if position == "pattern" && self.template_names.contains_key(text(get(root, "name"))) {
            let members: Vec<_> = self
                .queue
                .iter()
                .map(|i| &self.instances[*i])
                .filter(|i| get(&i.call, "call") == get(root, "name"))
                .map(|i| obj([("name", string(i.effective())), ("at", get(root, "at").clone())]))
                .collect();
            return Ok(if members.len() == 1 {
                members[0].clone()
            } else if !members.is_empty() {
                obj([("union", Json::Arr(members))])
            } else {
                let n = obj([("name", string("text")), ("at", get(root, "at").clone())]);
                obj([("difference", Json::Arr(vec![n.clone(), n]))])
            });
        }
        if ["ref", "rule"].iter().any(|k| self.template_names.contains_key(text(get(root, k)))) {
            return Err(event.fail(root, "a bare template reference must name one instance".into()));
        }
        Ok(Json::Obj(
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
        ))
    }
    fn decode(&self, root: &Json, event: &Event) -> R<Dom> {
        fn shadow(n: &Json, aliases: &mut BTreeMap<String, String>) -> Json {
            match n {
                Json::Obj(fs) => Json::Obj(
                    fs.iter()
                        .filter(|(k, _)| k != SOURCE)
                        .map(|(k, v)| {
                            let value = if ["name", "rule", "ref"].contains(&k.as_str()) && text(v).contains('(') {
                                let len = aliases.len();
                                string(
                                    aliases.entry(text(v).into()).or_insert_with(|| format!("instance-{len}")).clone(),
                                )
                            } else {
                                shadow(v, aliases)
                            };
                            (k.clone(), value)
                        })
                        .collect(),
                ),
                Json::Arr(xs) => Json::Arr(xs.iter().map(|v| shadow(v, aliases)).collect()),
                _ => n.clone(),
            }
        }
        let checked = shadow(root, &mut BTreeMap::new());
        if let Some(problem) = dom::schema::problem(&checked, self.uni) {
            return Err(event.fail(&event.rule, problem.into()));
        }
        let mut d = dom::decode_checked(&clean(root), self.uni, true).map_err(|s| event.fail(&event.rule, s))?;
        super::locations::restore_document(&mut d, root);
        Ok(d)
    }
}
