//! Read unresolved template nodes without textual substitution.
mod layered;
use super::*;
use crate::json::Json;
use crate::parameters::{self as p, get, has, list, obj, position, set, string, text};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum Mode {
    Declaration,
    Call,
    Expr,
    Term,
    Condition,
    Pattern,
    Layered,
    Emission,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct Context {
    braces: usize,
    marked: usize,
    recipe: bool,
    feature: bool,
    closed: Option<&'static str>,
}
type Key = (Mode, usize, bool, Context);
#[derive(Clone, Copy)]
struct Task<'a> {
    mode: Mode,
    node: &'a Node,
    argument: bool,
    context: Context,
}
impl Task<'_> {
    fn key(&self) -> Key {
        (self.mode, self.node as *const Node as usize, self.argument, self.context)
    }
}
#[derive(Default)]
pub(crate) struct State<'a> {
    values: crate::fxhash::FxMap<Key, Json>,
    active: Option<Key>,
    pending: Option<Task<'a>>,
}
pub(super) fn syntax(root: &Node) -> bool {
    let mut stack = vec![root];
    while let Some(n) = stack.pop() {
        if matches!(rule_name(n), "call" | "parameter" | "pattern-primary" | "pattern-literal") {
            return true;
        }
        stack.extend(n.children.iter())
    }
    false
}
fn written<T>(value: &T, write: fn(&mut String, &T)) -> Json {
    let mut s = String::new();
    write(&mut s, value);
    crate::json::parse(&s).expect("a native DOM writer produces JSON")
}
fn pattern_node(n: Json) -> Json {
    n.get("node").expect("a converted pattern atom").clone()
}
impl<'a> Reader<'a> {
    fn parameter_context(&self) -> Context {
        Context {
            braces: self.braces.get(),
            marked: self.marked.get(),
            recipe: self.in_recipe.get(),
            feature: self.feature_context.get(),
            closed: self.closed_for.get(),
        }
    }
    fn parameter_restore(&self, c: Context) {
        self.braces.set(c.braces);
        self.marked.set(c.marked);
        self.in_recipe.set(c.recipe);
        self.feature_context.set(c.feature);
        self.closed_for.set(c.closed);
    }
    fn parameter_start(&self, mode: Mode, node: &'a Node, argument: bool) -> R<Option<Json>> {
        let task = Task { mode, node, argument, context: self.parameter_context() };
        let key = task.key();
        let mut state = self.parameter_state.borrow_mut();
        if let Some(value) = state.values.get(&key) {
            return Ok(Some(value.clone()));
        }
        if state.active == Some(key) {
            return Ok(None);
        }
        state.pending = Some(task);
        Err(Error::grammar("a private reader continuation"))
    }
    // A missing child suspends its constructor. The heap stack resumes it
    // after that child completes, with its recipe and capture context intact.
    pub(super) fn parameter_document(&self, node: &'a Node) -> R<Json> {
        self.parameter_read(Mode::Declaration, node)
    }
    fn parameter_read(&self, mode: Mode, node: &'a Node) -> R<Json> {
        let context = self.parameter_context();
        *self.parameter_state.borrow_mut() = State::default();
        let result = (|| {
            let mut tasks = vec![Task { mode, node, argument: false, context }];
            let mut prepared = FxSet::default();
            while let Some(task) = tasks.last().copied() {
                // Schedule sibling operands together. Restarting a lazy constructor
                // after each sibling makes a wide child list quadratic.
                if task.mode == Mode::Layered
                    && !matches!(rule_name(task.node), "pattern-node" | "pattern-bare")
                    && prepared.insert(task.key())
                {
                    let children: Vec<_> =
                        Self::parts(task.node).into_iter().filter(|part| part.kind == NodeKind::Rule).collect();
                    if !children.is_empty() {
                        tasks.extend(children.into_iter().rev().map(|node| Task { node, ..task }));
                        continue;
                    }
                }
                self.parameter_restore(task.context);
                self.parameter_state.borrow_mut().active = Some(task.key());
                let result = match task.mode {
                    Mode::Declaration => self.parameter_declaration(task.node),
                    Mode::Call => self.call(task.node),
                    Mode::Expr => self.parameter_expr(task.node, task.argument),
                    Mode::Term => self.parameter_term(task.node, task.argument),
                    Mode::Condition => self.parameter_condition(task.node),
                    Mode::Pattern => self.parameter_pattern(task.node),
                    Mode::Layered => self.parameter_layered(task.node),
                    Mode::Emission => self.parameter_emission(task.node),
                };
                let pending = self.parameter_state.borrow_mut().pending.take();
                if let Some(child) = pending {
                    tasks.push(child);
                    continue;
                }
                let value = result?;
                let kind = match task.mode {
                    Mode::Expr => "expr",
                    Mode::Call => "call",
                    Mode::Condition => "condition",
                    Mode::Pattern => "children",
                    _ => "term",
                };
                if task.mode != Mode::Layered && crate::parameters::source_depth_problem(&value, kind, self.unicode) {
                    return Err(self.error(node, "an expression, term or condition is nested more than 256 deep"));
                }
                tasks.pop();
                if tasks.is_empty() {
                    return Ok(value);
                }
                self.parameter_state.borrow_mut().values.insert(task.key(), value);
            }
            unreachable!("a source task returns its node")
        })();
        self.parameter_restore(context);
        *self.parameter_state.borrow_mut() = State::default();
        result
    }

    fn parameter(&self, n: &Node) -> R<Json> {
        Ok(obj([
            ("param", string(self.value(self.token(n)?).trim_start_matches('@'))),
            ("at", position(self.first(n))),
        ]))
    }
    fn call(&self, n: &'a Node) -> R<Json> {
        if let Some(value) = self.parameter_start(Mode::Call, n, false)? {
            return Ok(value);
        }
        let mut args = Vec::new();
        for a in self.some(n, "call-argument", 1)? {
            let inner = self
                .inner(a, &["requirement-argument", "target-argument", "body-argument", "symbol-argument", "term"])?;
            args.push(match rule_name(inner) {
                "requirement-argument" => obj([("requirements", self.parameter_requirements(inner)?)]),
                "target-argument" => {
                    let mut ts = Vec::new();
                    for t in Self::parts(inner).into_iter().filter(|n| n.kind == NodeKind::Rule) {
                        ts.push(match rule_name(t) {
                            "reference" => obj([("rule", string(self.value(self.token(t)?)))]),
                            "tag" => obj([("terminal", string(self.tag_of(self.token(t)?)?))]),
                            "call" => self.call(t)?,
                            "parameter" => self.parameter(t)?,
                            _ => return Err(self.error(t, "invalid target argument")),
                        });
                    }
                    obj([("targets", Json::Arr(ts))])
                }
                "body-argument" | "symbol-argument" => {
                    p::argument(self.parameter_expr(self.inner(inner, PRIMARIES)?, true)?)
                }
                _ => self.parameter_term(inner, true)?,
            });
        }
        Ok(obj([
            ("call", string(self.value(self.token(n)?))),
            ("args", Json::Arr(args)),
            ("at", position(self.first(n))),
        ]))
    }
    pub(super) fn parameter_declaration(&self, n: &'a Node) -> R<Json> {
        if let Some(value) = self.parameter_start(Mode::Declaration, n, false)? {
            return Ok(value);
        }
        match rule_name(n) {
            "rule" => {
                let op = match self.value(self.token(self.one(n, "definer")?)?) {
                    "%redefine-rule" => "redefine",
                    "%extend-rule" => "extend",
                    _ => "define",
                };
                let mut r = obj([
                    ("op", string(op)),
                    ("flags", Json::Arr(Vec::new())),
                    ("conditions", Json::Arr(Vec::new())),
                    ("at", position(self.first(n))),
                ]);
                if let Some(name) = Self::rules(n, "rule-name").next() {
                    set(&mut r, "name", string(self.value(self.token(name)?)))
                } else {
                    let head = self.call(self.one(n, "call")?)?;
                    set(&mut r, "name", get(&head, "call").clone());
                    let args = list(get(&head, "args"));
                    let params: Vec<_> = args.iter().filter_map(|a| a.get("param").cloned()).collect();
                    if params.len() == args.len() {
                        set(&mut r, "params", Json::Arr(params))
                    } else {
                        set(&mut r, "args", Json::Arr(args.to_vec()))
                    }
                }
                if let Some(flags) = Self::rules(n, "rule-flags").next() {
                    set(
                        &mut r,
                        "flags",
                        Json::Arr(
                            self.some(flags, "rule-flag", 1)?
                                .iter()
                                .map(|f| Ok(string(self.value(self.token(f)?))))
                                .collect::<R<_>>()?,
                        ),
                    )
                }
                if Self::tokens_of(n).any(|t| self.value(t) == "=") {
                    set(&mut r, "instance", self.call(self.one(n, "call")?)?);
                    return Ok(r);
                }
                self.parameter_clauses(n, "tags-clause", &mut r)?;
                let body = Self::rules(n, "body")
                    .next()
                    .or_else(|| Self::rules(n, "headed-body").next())
                    .ok_or_else(|| self.shape_error(n, "body"))?;
                let alts = if let Some(a) = Self::rules(body, "ranked-alternative").next() {
                    vec![a]
                } else {
                    self.some(body, "alternative", 1)?
                };
                let mut alternatives = Vec::new();
                for a in alts {
                    self.braces.set(0);
                    self.marked.set(0);
                    self.captures.borrow_mut().clear();
                    let guards = Self::rules(a, "guard")
                        .map(|g| {
                            let g = self.guard(g, false)?;
                            Ok(obj([
                                ("feature", string(g.feature)),
                                ("kind", string(if g.kind == FeatureKind::Gate { "gate" } else { "warning" })),
                                ("negated", Json::Bool(g.negated)),
                            ]))
                        })
                        .collect::<R<Vec<_>>>()?;
                    let key = if rule_name(a) == "ranked-alternative" { "ranked-choice" } else { "conjunction" };
                    let mut alt =
                        obj([("guards", Json::Arr(guards)), ("expr", self.parameter_expr(self.one(a, key)?, true)?)]);
                    self.parameter_clauses(a, "alternative-tags", &mut alt)?;
                    alternatives.push(alt);
                }
                set(&mut r, "alternatives", Json::Arr(alternatives));
                if let Some(c) = Self::rules(n, "conditions-clause").next() {
                    set(
                        &mut r,
                        "conditions",
                        Json::Arr(
                            self.some(c, "implication", 1)?
                                .iter()
                                .map(|n| self.parameter_condition(n))
                                .collect::<R<_>>()?,
                        ),
                    )
                }
                if let Some(c) = Self::rules(n, "emits-clause").next() {
                    set(&mut r, "emit", self.parameter_emission(c)?)
                }
                if Self::rules(n, "erased-clause").next().is_some() {
                    set(&mut r, "erased", Json::Bool(true))
                }
                Ok(r)
            }
            "constant-definition" => Ok(obj([
                ("name", string(self.value(self.token(self.one(n, "constant-reference")?)?).trim_start_matches('$'))),
                (
                    "op",
                    string(if self.value(self.token(self.one(n, "constant-definer")?)?) == "%redefine-const" {
                        "redefine"
                    } else {
                        "define"
                    }),
                ),
                ("value", self.parameter_term(self.one(n, "term")?, false)?),
                ("at", position(self.first(n))),
            ])),
            "implication-declaration" => {
                let sides = self.some(n, "union", 2)?;
                Ok(obj([
                    ("if", self.parameter_term(sides[0], false)?),
                    ("then", self.parameter_term(sides[1], false)?),
                    ("at", position(self.first(n))),
                ]))
            }
            "directive" => {
                // The directive operands remain ordinary words, strings, or tags.
                let mut args = Vec::new();
                for part in Self::parts(n) {
                    if matches!(rule_name(part), "argument-word" | "argument-string" | "argument-tag") {
                        args.push(string(self.value(self.token(part)?)))
                    }
                }
                let name = self.value(self.token(n)?).trim_start_matches('%');
                let mut r = obj([("name", string(name)), ("args", Json::Arr(args)), ("at", position(self.first(n)))]);
                if let Some(c) = Self::rules(n, "conditions-clause").next() {
                    let before = self.feature_context.replace(name == "features");
                    let conditions = self
                        .some(c, "implication", 1)
                        .and_then(|nodes| nodes.iter().map(|n| self.parameter_condition(n)).collect::<R<_>>());
                    self.feature_context.set(before);
                    set(&mut r, "conditions", Json::Arr(conditions?))
                }
                Ok(r)
            }
            _ => Err(self.error(n, "an unexpected declaration with parameters")),
        }
    }
    fn parameter_clauses(&self, n: &'a Node, tag_name: &'static str, out: &mut Json) -> R<()> {
        if let Some(c) = Self::rules(n, tag_name).next() {
            set(out, "tags", self.parameter_term(self.one(c, "term")?, false)?)
        }
        for k in ["value", "image"] {
            if let Some(c) = Self::rules(n, if k == "value" { "value-clause" } else { "image-clause" }).next() {
                let recipe = self.one(c, "recipe")?;
                let atoms = self.some(recipe, "recipe-atom", 1)?;
                if atoms.len() != 1 {
                    return Err(self.error(recipe, "juxtaposed recipe strings require ++, use ++ between string atoms"));
                }
                let mut pending = vec![recipe];
                while let Some(p) = pending.pop() {
                    if p.kind == NodeKind::Token && matches!(self.value(p), "(" | ")" | "∪" | "∩" | "∖" | "⟹") {
                        return Err(self.error(recipe, "a recipe uses no grouping or arguments"));
                    }
                    pending.extend(p.children.iter());
                }
                self.in_recipe.set(true);
                let value = self.parameter_term(self.one(atoms[0], "term")?, false);
                self.in_recipe.set(false);
                let v = value?;
                let mut value = if has(&v, "concat") { v } else { obj([("concat", Json::Arr(vec![v]))]) };
                set(&mut value, p::SOURCE, position(self.first(recipe)));
                set(out, k, value);
            }
        }
        Ok(())
    }
    fn parameter_expr(&self, mut n: &'a Node, mut whole: bool) -> R<Json> {
        if let Some(value) = self.parameter_start(Mode::Expr, n, whole)? {
            return Ok(value);
        }
        loop {
            let (part, key) = match rule_name(n) {
                "choice" => ("conjunction", "choice"),
                "ranked-choice" => ("conjunction", "ranked"),
                "conjunction" => ("sequence", "and"),
                "sequence" => ("primary", "seq"),
                "group" => {
                    n = self.one(n, "choice")?;
                    whole = false;
                    continue;
                }
                _ => break,
            };
            if rule_name(n) == "choice" {
                if let Some(r) = Self::rules(n, "ranked-choice").next() {
                    n = r;
                    whole = false;
                    continue;
                }
            }
            let xs = self.some(n, part, 1)?;
            if xs.len() != 1 {
                break;
            }
            n = if key == "seq" { self.inner(xs[0], PRIMARIES)? } else { xs[0] };
            if matches!(key, "choice" | "ranked") {
                whole = false
            }
        }
        let mut r = if !syntax(n)
            && matches!(
                rule_name(n),
                "reference" | "tag" | "string-terminal" | "constant-reference" | "wildcard" | "range" | "empty"
            ) {
            let expr = if rule_name(n) == "empty" { Expr::Empty } else { self.symbol(n)? };
            written(&expr, crate::dom::write_expr)
        } else {
            match rule_name(n) {
                "call" => self.call(n)?,
                "parameter" => self.parameter(n)?,
                "choice" | "ranked-choice" | "conjunction" | "sequence" => {
                    if rule_name(n) == "choice" {
                        if let Some(c) = Self::rules(n, "ranked-choice").next() {
                            return self.parameter_expr(c, false);
                        }
                    }
                    let (key, part) = match rule_name(n) {
                        "choice" => ("choice", "conjunction"),
                        "ranked-choice" => ("ranked", "conjunction"),
                        "conjunction" => ("and", "sequence"),
                        _ => ("seq", "primary"),
                    };
                    let ps = self.some(n, part, 1)?;
                    let mut values = Vec::new();
                    for p in &ps {
                        let p = if key == "seq" { self.inner(p, PRIMARIES)? } else { p };
                        values.push(
                            self.parameter_expr(p, whole && !matches!(key, "choice" | "ranked") && ps.len() == 1)?,
                        )
                    }
                    if values.len() == 1 {
                        values.pop().unwrap()
                    } else {
                        obj([(key, Json::Arr(values))])
                    }
                }
                "group" => self.parameter_expr(self.one(n, "choice")?, false)?,
                "capture" => {
                    if self.braces.get() > 0 || self.marked.get() > 0 {
                        return Err(self.error(n, "a capture cannot stand inside braces or an elidable optional"));
                    }
                    obj([
                        ("capture", string(self.value(self.token(n)?).trim_start_matches('$'))),
                        ("expr", self.parameter_expr(self.inner(self.one(n, "primary")?, PRIMARIES)?, false)?),
                    ])
                }
                "optional" => {
                    let markers = Self::tokens_of(n).filter(|t| self.value(t) == "+").count();
                    if markers > 1 {
                        return Err(self.error(n, "an optional has one marker + at most"));
                    }
                    if markers == 1 {
                        let c = self.one(n, "choice")?;
                        let cs = self.some(c, "conjunction", 1)?;
                        if cs.len() != 1
                            || Self::tokens_of(c).any(|t| self.value(t) == "|")
                            || Self::tokens_of(cs[0]).any(|t| self.value(t) == "&")
                        {
                            return Err(self.error(n, "an elidable optional requires one sequence"));
                        }
                        let ss = self.some(cs[0], "sequence", 1)?;
                        if ss.len() != 1 {
                            return Err(self.error(n, "an elidable optional requires one sequence"));
                        }
                        let ps = self.some(ss[0], "primary", 1)?;
                        let mut head = self.inner(ps[0], PRIMARIES)?;
                        if rule_name(head) == "tested" {
                            head = Self::parts(head)
                                .into_iter()
                                .find(|n| PRIMARIES.contains(&rule_name(n)))
                                .ok_or_else(|| self.shape_error(head, "base symbol"))?
                        }
                        if rule_name(head) != "parameter"
                            && !(matches!(rule_name(head), "tag" | "reference")
                                && self.value(self.token(head)?).starts_with(|c: char| c.is_ascii_uppercase()))
                        {
                            return Err(self.error(n, "an elidable optional begins with a bare user tag or parameter"));
                        }
                        self.marked.set(self.marked.get() + 1)
                    }
                    let mut r = obj([("optional", self.parameter_expr(self.one(n, "choice")?, false)?)]);
                    if markers == 1 {
                        self.marked.set(self.marked.get() - 1);
                        set(&mut r, "elidable", Json::Bool(true))
                    }
                    r
                }
                "repetition" => {
                    let cs = self.some(n, "choice", 1)?;
                    let parts = Self::parts(n);
                    let markers: Vec<_> = parts
                        .iter()
                        .enumerate()
                        .filter(|(_, p)| p.kind == NodeKind::Token && self.value(p) == "...")
                        .map(|(i, _)| i)
                        .collect();
                    if markers.len() > 1 {
                        return Err(self.error(n, "braces have one chain marker ... at most"));
                    }
                    let mut chain = None;
                    if let Some(&m) = markers.first() {
                        let first = parts.iter().position(|p| std::ptr::eq(*p, cs[0])).unwrap();
                        if !whole {
                            return Err(self.error(n, "a chain is the whole expression of its alternative"));
                        }
                        if cs.len() > 1 && m > parts.iter().position(|p| std::ptr::eq(*p, cs[1])).unwrap() {
                            return Err(self.error(n, "a separator has no chain marker"));
                        }
                        chain = Some(if m < first { "left" } else { "right" });
                    }
                    self.braces.set(self.braces.get() + 1);
                    let mut r = obj([("repeat", self.parameter_expr(cs[0], false)?)]);
                    if cs.len() > 1 {
                        set(&mut r, "separator", self.parameter_expr(cs[1], false)?)
                    }
                    self.braces.set(self.braces.get() - 1);
                    if let Some(c) = chain {
                        set(&mut r, "chain", string(c))
                    }
                    r
                }
                "tested" => {
                    let base = Self::parts(n)
                        .into_iter()
                        .find(|p| {
                            p.kind == NodeKind::Rule && PRIMARIES.contains(&rule_name(p)) && rule_name(p) != "tested"
                        })
                        .ok_or_else(|| self.shape_error(n, "base symbol"))?;
                    self.parameter_tests(self.parameter_expr(base, false)?, n)?
                }
                "range" => {
                    let ends = Self::parts(n)
                        .into_iter()
                        .filter(|p| matches!(rule_name(p), "string" | "constant-reference" | "parameter"))
                        .map(|p| self.parameter_term(p, false))
                        .collect::<R<_>>()?;
                    obj([("range", Json::Arr(ends))])
                }
                _ => return Err(self.error(n, format!("unexpected {} in an expression", rule_name(n)))),
            }
        };
        if !has(&r, p::SOURCE) {
            set(&mut r, p::SOURCE, position(self.at(n)))
        }
        Ok(r)
    }
    fn parameter_requirements(&self, n: &'a Node) -> R<Json> {
        let mut out = Vec::new();
        for r in Self::rules(n, "tag-requirement") {
            let negated = Self::tokens_of(r).any(|t| self.value(t) == "¬");
            let value = self.parameter_term(self.inner(self.one(r, "test-operand")?, ATOMS)?, false)?;
            out.push(obj([("negated", Json::Bool(negated)), ("value", value)]));
        }
        Ok(Json::Arr(out))
    }
    fn parameter_tests(&self, mut expr: Json, n: &'a Node) -> R<Json> {
        let mut tag = false;
        let mut value = false;
        for t in Self::parts(n).into_iter().filter(|p| matches!(rule_name(p), "tag-test" | "value-test")) {
            if rule_name(t) == "tag-test" {
                if tag || value {
                    return Err(self.error(t, "invalid test target or test order"));
                }
                tag = true;
                expr =
                    obj([("test", string("tags")), ("expr", expr), ("requirements", self.parameter_requirements(t)?)]);
            } else {
                if value {
                    return Err(self.error(t, "invalid test target or test order"));
                }
                value = true;
                let operand = self.one(t, "test-operand")?;
                let value = self.parameter_term(self.inner(operand, ATOMS)?, false)?;
                if !["string", "const", "param"].iter().any(|key| has(&value, key)) {
                    return Err(self.error(operand, "a value test requires a string literal or constant"));
                }
                expr = obj([
                    ("test", string(self.operator(self.token(self.one(t, "test")?)?))),
                    ("expr", expr),
                    ("value", value),
                ]);
            }
        }
        Ok(expr)
    }
    fn parameter_term(&self, mut n: &'a Node, argument: bool) -> R<Json> {
        if let Some(value) = self.parameter_start(Mode::Term, n, argument)? {
            return Ok(value);
        }
        while syntax(n) {
            match rule_name(n) {
                "term" => n = self.inner(n, &TERMS)?,
                "term-atom" => n = self.inner(n, ATOMS)?,
                "union" | "intersection" | "concatenation" => {
                    let k = match rule_name(n) {
                        "union" => "intersection",
                        "intersection" => "concatenation",
                        _ => "term-atom",
                    };
                    let xs = self.some(n, k, 1)?;
                    if xs.len() != 1 {
                        break;
                    }
                    n = xs[0]
                }
                _ => break,
            }
        }
        if argument {
            if let Some(name) = self.rule_name_in(if rule_name(n) == "term" { self.inner(n, &TERMS)? } else { n }) {
                return Ok(obj([("rule", string(name))]));
            }
        }
        let mut r = if !syntax(n) {
            let t = match rule_name(n) {
                "term" => self.term(n, argument)?.0,
                "union" => self.union(n, argument)?.0,
                "intersection" => self.typed(Frame::Intersection(Joined::new(n, argument)))?.0,
                "concatenation" => self.typed(Frame::Concatenation(Joined::new(n, argument)))?.0,
                "term-atom" => self.typed(Frame::Atom(Atom::new(n, argument)))?.0,
                "constant-reference" => self.constant_reference(self.token(n)?)?,
                "string" => self.string_term(self.token(n)?)?,
                "tag" => Term::Tag(self.tag_of(self.token(n)?)?),
                "capture-reference" => Term::Capture(self.value(self.token(n)?).trim_start_matches('$').into()),
                "name" => {
                    let s = self.value(self.token(n)?);
                    if !is_capital(s) {
                        if argument {
                            return Ok(obj([("rule", string(s))]));
                        }
                        return Err(self.error(n, "a rule is not a value"));
                    }
                    Term::Tag(s.into())
                }
                "empty-set" => Term::EmptySet,
                _ => return Err(self.error(n, "an unexpected closed term")),
            };
            written(&t, crate::dom::write_term)
        } else {
            match rule_name(n) {
                "parameter" => self.parameter(n)?,
                "call" => self.call(n)?,
                "term" => self.parameter_term(self.inner(n, &TERMS)?, argument)?,
                "term-atom" => self.parameter_term(self.inner(n, ATOMS)?, argument)?,
                "union" | "intersection" | "concatenation" => {
                    let part = match rule_name(n) {
                        "union" => "intersection",
                        "intersection" => "concatenation",
                        _ => "term-atom",
                    };
                    let ps = self.some(n, part, 1)?;
                    if ps.len() == 1 {
                        return self.parameter_term(ps[0], argument);
                    }
                    let values = ps.iter().map(|p| self.parameter_term(p, false)).collect::<R<Vec<_>>>()?;
                    if rule_name(n) == "concatenation" {
                        for (part, value) in ps.iter().zip(&values) {
                            if p::pattern_term(value, &std::collections::BTreeSet::new()) {
                                return Err(self.error(part, "a concatenation requires strings"));
                            }
                        }
                    }
                    if rule_name(n) != "union" {
                        p::joined(if rule_name(n) == "intersection" { "intersection" } else { "concat" }, values)
                    } else {
                        let ops: Vec<_> =
                            Self::tokens_of(n).map(|t| self.value(t)).filter(|s| matches!(*s, "∪" | "∖")).collect();
                        let mut vs = values.into_iter();
                        let mut r = vs.next().unwrap();
                        for (op, v) in ops.iter().skip(ops.len() - (ps.len() - 1)).zip(vs) {
                            r = p::joined(if *op == "∪" { "union" } else { "difference" }, vec![r, v])
                        }
                        r
                    }
                }
                "guarded-term" => {
                    let last = Self::rules(n, "union").next().map(Ok).unwrap_or_else(|| self.one(n, "term"))?;
                    let mut r = self.parameter_term(last, argument)?;
                    let cs: Vec<_> = Self::rules(n, "any-of").collect();
                    for c in cs.into_iter().rev() {
                        r = obj([("if", self.parameter_condition(c)?), ("then", r)])
                    }
                    r
                }
                "method" => self.parameter_method(n)?,
                "pattern-literal" => {
                    let before = self.closed_for.replace(None);
                    let primary = self.one(n, "pattern-primary")?;
                    let pattern = self.parameter_layered(primary)?;
                    let name = |name: &str| is_classifier_name(name) || self.unicode.is_emoji_name(name);
                    let inspect = crate::patterns::shapes::Inspection { name: Some(&name), ..Default::default() };
                    if let Some(problem) = crate::patterns::shapes::problem(&p::clean(&pattern), &inspect) {
                        return Err(self.error(n, problem));
                    }
                    self.closed_for.set(before);
                    obj([("pattern", pattern)])
                }
                _ => return Err(self.error(n, format!("unexpected {} in a term", rule_name(n)))),
            }
        };
        if !has(&r, p::SOURCE) {
            set(&mut r, p::SOURCE, position(self.at(n)))
        }
        if !self.feature_context.get() && !p::unresolved(&r) {
            if let Ok(term) = crate::dom::term_from_json(&p::clean(&r)) {
                if let Err(problem) = crate::dom::term_type(&term) {
                    return Err(self.error(n, problem));
                }
            }
        }
        Ok(r)
    }
    fn parameter_method(&self, n: &'a Node) -> R<Json> {
        let mut r = self.parameter_term(self.one(self.one(n, "method-receiver")?, "term-atom")?, true)?;
        for s in self.some(n, "method-selector", 1)? {
            let name = self.value(self.token(self.one(s, "method-name")?)?);
            let mut args = Vec::new();
            if let Some(a) = Self::rules(s, "arguments").next() {
                for p in self.some(a, "argument", 1)? {
                    let value = if let Some(i) = Self::rules(p, "integer").next() {
                        obj([("integer", string(self.value(self.token(i)?)))])
                    } else {
                        let mut arg = self.parameter_term(self.one(p, "term")?, true)?;
                        if name == "classify" && has(&arg, "rule") {
                            arg = obj([("classifier", get(&arg, "rule").clone())])
                        }
                        if matches!(name, "matches" | "begins" | "followed-by" | "preceded-by")
                            && has(&arg, "tag")
                            && !crate::dom::is_engine_tag(text(get(&arg, "tag")))
                        {
                            arg = obj([("terminal", get(&arg, "tag").clone())])
                        }
                        arg
                    };
                    let mut value = value;
                    set(&mut value, p::SOURCE, position(self.at(p)));
                    args.push(value);
                }
                let separator =
                    if matches!(name, "matches" | "begins" | "followed-by" | "preceded-by") { "|" } else { "," };
                if Self::tokens_of(a).any(|p| self.value(p) != separator) {
                    return Err(self.error(a, "invalid method argument separator"));
                }
            }
            r = obj([("method", string(name)), ("receiver", r), ("args", Json::Arr(args))]);
            set(&mut r, p::SOURCE, position(self.at(n)));
            if !self.feature_context.get() && !p::unresolved(&r) {
                use crate::dom::schema::{parts_problem, Part};
                let kind = if matches!(
                    name,
                    "matches" | "begins" | "starts-input" | "ends-input" | "followed-by" | "preceded-by"
                ) {
                    Part::Condition
                } else {
                    Part::Term
                };
                let closed = p::clean(&r);
                if let Some(problem) = parts_problem(vec![(kind, &closed, 0)], self.unicode) {
                    return Err(self.error(n, problem));
                }
            }
        }
        Ok(r)
    }
    fn parameter_condition(&self, n: &'a Node) -> R<Json> {
        if let Some(value) = self.parameter_start(Mode::Condition, n, false)? {
            return Ok(value);
        }
        if !syntax(n) && rule_name(n) == "implication" {
            let condition = self.implication(n)?;
            let mut value = written(&condition, crate::dom::write_cond);
            crate::parameters::locations::annotate_condition(&condition, &mut value);
            return Ok(value);
        }
        let r = match rule_name(n) {
            "condition" => self.parameter_condition(self.inner(n, CONDITIONS)?)?,
            "implication" => {
                let xs = self.some(n, "any-of", 1)?;
                let mut it = xs.into_iter().rev();
                let mut r = self.parameter_condition(it.next().unwrap())?;
                for x in it {
                    r = obj([("if", self.parameter_condition(x)?), ("then", r)])
                }
                r
            }
            "any-of" | "all-of" => {
                let (key, part) = if rule_name(n) == "any-of" { ("any", "all-of") } else { ("all", "condition") };
                let mut xs =
                    self.some(n, part, 1)?.iter().map(|p| self.parameter_condition(p)).collect::<R<Vec<_>>>()?;
                if xs.len() == 1 {
                    xs.pop().unwrap()
                } else {
                    p::joined(key, xs)
                }
            }
            "presence" => obj([("captured", string(self.value(self.token(n)?).trim_start_matches('$')))]),
            "negation" => obj([("not", self.parameter_condition(self.one(n, "condition")?)?)]),
            "comparison" => {
                let ps = self.some(n, "union", 2)?;
                let op = self.operator(self.token(self.one(n, "comparator")?)?);
                let left = self.parameter_term(ps[0], false)?;
                let right = self.parameter_term(ps[1], false)?;
                if !self.feature_context.get() && !p::unresolved(&left) && !p::unresolved(&right) {
                    let left = crate::dom::term_from_json(&p::clean(&left)).map_err(|e| self.error(n, e))?;
                    let right = crate::dom::term_from_json(&p::clean(&right)).map_err(|e| self.error(n, e))?;
                    let a = crate::dom::term_type(&left).map_err(|e| self.error(n, e))?;
                    let b = crate::dom::term_type(&right).map_err(|e| self.error(n, e))?;
                    if let Some(problem) = comparison_problem(op, a, b) {
                        return Err(self.error(n, problem));
                    }
                }
                obj([("op", string(op)), ("left", left), ("right", right)])
            }
            "tree-comparison" => {
                let right = self.one(n, "union")?;
                if let Some(name) = first_of_rule(right, "name").or_else(|| first_of_rule(right, "tag")) {
                    if right.span.end - right.span.start == 1 {
                        let text = self.value(self.token(name)?);
                        return Err(
                            self.error(name, format!("tree comparison requires a pattern; write #{text}, not {text}"))
                        );
                    }
                }
                obj([
                    ("op", string(self.operator(self.token(self.one(n, "tree-comparator")?)?))),
                    (
                        "left",
                        obj([(
                            "capture",
                            string(self.value(self.token(self.one(n, "capture-reference")?)?).trim_start_matches('$')),
                        )]),
                    ),
                    ("right", self.parameter_term(self.one(n, "union")?, false)?),
                ])
            }
            "method" => self.parameter_method(n)?,
            _ => return Err(self.error(n, "an unexpected condition with parameters")),
        };
        Ok(r)
    }
    fn parameter_pattern(&self, n: &'a Node) -> R<Json> {
        if let Some(value) = self.parameter_start(Mode::Pattern, n, false)? {
            return Ok(value);
        }
        if !syntax(n) {
            return Ok(obj([("node", written(&self.pattern_atom(n)?, |out, p| p.write(out)))]));
        }
        match rule_name(n) {
            "pattern-atom" => {
                let base = Self::parts(n)
                    .into_iter()
                    .find(|p| matches!(rule_name(p), "call" | "parameter"))
                    .map(Ok)
                    .unwrap_or_else(|| self.pattern_atom_base(n))?;
                let mut expr = match rule_name(base) {
                    "call" => self.call(base)?,
                    "parameter" => self.parameter(base)?,
                    "tag" => obj([("terminal", string(self.tag_of(self.token(base)?)?))]),
                    "string" => {
                        obj([("literal", written(&self.string_term(self.token(base)?)?, crate::dom::write_term))])
                    }
                    "range" => {
                        let ends = Self::parts(base)
                            .into_iter()
                            .filter(|part| matches!(rule_name(part), "string" | "constant-reference" | "parameter"))
                            .map(|part| self.parameter_term(part, false))
                            .collect::<R<Vec<_>>>()?;
                        obj([("range", Json::Arr(ends))])
                    }
                    "string-terminal" => written(&self.symbol(base)?, crate::dom::write_expr),
                    "wildcard" => obj([("wildcard", Json::Bool(true))]),
                    "constant-reference" => {
                        let t = self.token(base)?;
                        self.constant_reference(t)?;
                        obj([("constant", string(self.value(t).trim_start_matches('$')))])
                    }
                    _ => {
                        let t = if base.kind == NodeKind::Token { base } else { self.token(base)? };
                        let name = self.value(t);
                        obj([(
                            if !Self::pattern_rule_name(base) && (is_capital(name) || crate::dom::is_engine_tag(name)) {
                                "terminal"
                            } else {
                                "name"
                            },
                            string(name),
                        )])
                    }
                };
                set(&mut expr, "at", position(self.at(base)));
                if has(&expr, "call")
                    && Self::parts(n).iter().any(|p| matches!(rule_name(p), "tag-test" | "value-test"))
                {
                    return Err(self.error(n, "invalid pattern test target or order"));
                }
                Ok(obj([("node", self.parameter_tests(expr, n)?)]))
            }
            _ => Err(self.error(n, "an unexpected pattern with parameters")),
        }
    }
    fn parameter_emission(&self, n: &'a Node) -> R<Json> {
        if let Some(value) = self.parameter_start(Mode::Emission, n, false)? {
            return Ok(value);
        }
        let parts: Vec<_> = Self::rules(n, "emit-item").collect();
        let mut items = Vec::new();
        if parts.is_empty() {
            let mut r = obj([("capture", string(""))]);
            self.parameter_clauses(n, "emit-tags", &mut r)?;
            items.push(r)
        }
        for p in parts {
            let target = self.one(p, "emit-target")?;
            let token = Self::tokens_of(target)
                .next()
                .ok_or_else(|| self.error(target, "an emission requires a capture or epsilon target"))?;
            let t = self.value(token);
            let mut r = if t == "ε" {
                obj([("insert", Json::Bool(true))])
            } else if let Some(c) = t.strip_prefix('$') {
                obj([("capture", string(c))])
            } else {
                return Err(self.error(p, "an emission target requires a capture or ε"));
            };
            self.parameter_clauses(p, "emit-tags", &mut r)?;
            for (key, rule) in [("before", "emit-before"), ("after", "emit-after")] {
                let mut names = Vec::new();
                for a in Self::rules(p, rule) {
                    for c in self.some(a, "capture-reference", 1)? {
                        names.push(string(self.value(self.token(c)?).trim_start_matches('$')))
                    }
                }
                if !names.is_empty() {
                    set(&mut r, key, Json::Arr(names))
                }
            }
            items.push(r);
        }
        Ok(obj([("items", Json::Arr(items))]))
    }
}
