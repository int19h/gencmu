//! Finite observations of structural trees (engine §4.1).
use crate::dom::{self, Term};
use crate::json::{write_str, Json};

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Pattern {
    Name(String, (usize, usize)),
    Terminal(String, (usize, usize)),
    Constant(String, (usize, usize)),
    Test(String, Term, Box<Pattern>),
    Children(Children),
    Path(String, Box<Pattern>),
    Union(Vec<Pattern>),
    Intersection(Vec<Pattern>),
    Difference(Box<Pattern>, Box<Pattern>),
}
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Children {
    Node(Box<Pattern>),
    Siblings,
    Sequence(Vec<Children>),
    Optional(Box<Children>),
    Repeat(Box<Children>, Option<Box<Children>>),
}
fn field<'a>(j: &'a Json, key: &str) -> Result<&'a Json, String> {
    j.get(key).ok_or_else(|| format!("a pattern lacks {key}"))
}
fn string(j: &Json, key: &str) -> Result<String, String> {
    field(j, key)?.as_str().map(str::to_owned).ok_or_else(|| "a malformed pattern atom".into())
}
fn at(j: &Json) -> Result<(usize, usize), String> {
    match field(j, "at")?.as_array() {
        Some([Json::Int(a), Json::Int(b)]) => Ok((*a as usize, *b as usize)),
        _ => Err("a malformed pattern atom".into()),
    }
}
fn exact(j: &Json, keys: &[&str]) -> bool {
    j.as_object().is_some_and(|o| o.len() == keys.len() && keys.iter().all(|k| j.get(k).is_some()))
}
impl Pattern {
    pub(crate) fn from_json(j: &Json) -> Result<Self, String> {
        let p = Self::read(j, 0)?;
        if let Some(problem) = p.problem() {
            return Err(problem.into());
        }
        Ok(p)
    }
    fn read(j: &Json, depth: usize) -> Result<Self, String> {
        if depth > 256 {
            return Err("nested too deeply".into());
        }
        for key in ["name", "terminal", "constant"] {
            if exact(j, &[key, "at"]) {
                let text = string(j, key)?;
                let valid = if key == "name" {
                    text == "#"
                        || text.chars().next().is_some_and(|c| c.is_ascii_lowercase()) && crate::tags::is_name(&text)
                } else {
                    dom::is_constant_name(&text)
                };
                if !valid {
                    return Err("a malformed pattern atom".into());
                }
                return Ok(match key {
                    "name" => Self::Name(text, at(j)?),
                    "terminal" => Self::Terminal(text, at(j)?),
                    _ => Self::Constant(text, at(j)?),
                });
            }
        }
        if exact(j, &["test", "value", "expr"]) {
            let op = string(j, "test")?;
            let expr = Self::read(field(j, "expr")?, depth + 1)?;
            if !dom::TEST_OPS.contains(&op.as_str()) || !matches!(expr, Self::Terminal(..)) {
                return Err("a pattern test requires one terminal atom".into());
            }
            let value = dom::term_from_json(field(j, "value")?)?;
            return Ok(Self::Test(op, value, Box::new(expr)));
        }
        if exact(j, &["children"]) {
            return Ok(Self::Children(Children::read(field(j, "children")?, depth + 1, false)?));
        }
        if exact(j, &["path", "pattern"]) {
            let path = string(j, "path")?;
            if !["descendant", "first", "last"].contains(&path.as_str()) {
                return Err("a malformed pattern path".into());
            }
            return Ok(Self::Path(path, Box::new(Self::read(field(j, "pattern")?, depth + 1)?)));
        }
        for key in ["union", "intersection", "difference"] {
            if exact(j, &[key]) {
                let items = field(j, key)?.as_array().ok_or("a malformed pattern")?;
                if items.len() < 2 || key == "difference" && items.len() != 2 {
                    return Err("a malformed pattern".into());
                }
                let mut items = items.iter().map(|x| Self::read(x, depth + 1)).collect::<Result<Vec<_>, _>>()?;
                return Ok(match key {
                    "union" => Self::Union(items),
                    "intersection" => Self::Intersection(items),
                    _ => {
                        let right = items.pop().unwrap();
                        Self::Difference(Box::new(items.pop().unwrap()), Box::new(right))
                    }
                });
            }
        }
        Err("a malformed pattern".into())
    }
    pub(crate) fn write(&self, out: &mut String) {
        match self {
            Self::Name(s, a) | Self::Terminal(s, a) | Self::Constant(s, a) => {
                out.push('{');
                write_str(
                    out,
                    match self {
                        Self::Name(..) => "name",
                        Self::Terminal(..) => "terminal",
                        _ => "constant",
                    },
                );
                out.push(':');
                write_str(out, s);
                out.push_str(&format!(",\"at\":[{},{}]}}", a.0, a.1));
            }
            Self::Test(op, value, expr) => {
                out.push_str("{\"test\":");
                write_str(out, op);
                out.push_str(",\"value\":");
                dom::write_term(out, value);
                out.push_str(",\"expr\":");
                expr.write(out);
                out.push('}');
            }
            Self::Children(c) => {
                out.push_str("{\"children\":");
                c.write(out);
                out.push('}');
            }
            Self::Path(p, n) => {
                out.push_str("{\"path\":");
                write_str(out, p);
                out.push_str(",\"pattern\":");
                n.write(out);
                out.push('}');
            }
            Self::Union(xs) | Self::Intersection(xs) => {
                out.push_str(if matches!(self, Self::Union(_)) { "{\"union\":[" } else { "{\"intersection\":[" });
                for (i, x) in xs.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    x.write(out);
                }
                out.push_str("]}");
            }
            Self::Difference(a, b) => {
                out.push_str("{\"difference\":[");
                a.write(out);
                out.push(',');
                b.write(out);
                out.push_str("]}");
            }
        }
    }
    pub(crate) fn constants<'a>(&'a self, out: &mut Vec<(&'a str, (usize, usize))>) {
        match self {
            Self::Constant(n, a) => out.push((n, *a)),
            Self::Test(_, v, _) => dom::constants_in_term(v, out),
            Self::Children(c) => c.constants(out),
            Self::Path(_, p) => p.constants(out),
            Self::Union(xs) | Self::Intersection(xs) => {
                for p in xs {
                    p.constants(out);
                }
            }
            Self::Difference(a, b) => {
                a.constants(out);
                b.constants(out);
            }
            _ => {}
        }
    }
    pub(crate) fn type_fault(&self, constants: dom::ConstantTypes) -> Option<dom::Fault> {
        match self {
            Self::Constant(n, a) => dom::expected_problem(constants(n), dom::Type::Pattern)
                .map(|problem| dom::Fault { problem, at: Some(*a) }),
            Self::Test(op, v, _) => match dom::term_type_in(v, constants) {
                Err(f) => Some(f),
                Ok(ty) => dom::test_type_problem(op, ty)
                    .map(|problem| dom::Fault { problem, at: dom::first_constant_in_term(v) }),
            },
            Self::Children(c) => c.type_fault(constants),
            Self::Path(_, p) => p.type_fault(constants),
            Self::Union(xs) | Self::Intersection(xs) => xs.iter().find_map(|p| p.type_fault(constants)),
            Self::Difference(a, b) => a.type_fault(constants).or_else(|| b.type_fault(constants)),
            _ => None,
        }
    }
}
impl Children {
    fn read(j: &Json, depth: usize, repeated: bool) -> Result<Self, String> {
        if depth > 256 {
            return Err("nested too deeply".into());
        }
        if exact(j, &["node"]) {
            return Ok(Self::Node(Box::new(Pattern::read(field(j, "node")?, depth + 1)?)));
        }
        if exact(j, &["siblings"]) {
            if repeated || field(j, "siblings")?.as_bool() != Some(true) {
                return Err("a sibling ellipsis cannot be a repeat item or separator".into());
            }
            return Ok(Self::Siblings);
        }
        if exact(j, &["sequence"]) {
            let xs = field(j, "sequence")?.as_array().ok_or("a malformed pattern sequence")?;
            if xs.len() < 2 {
                return Err("a malformed pattern sequence".into());
            }
            return Ok(Self::Sequence(
                xs.iter().map(|x| Self::read(x, depth + 1, repeated)).collect::<Result<_, _>>()?,
            ));
        }
        if exact(j, &["optional"]) {
            return Ok(Self::Optional(Box::new(Self::read(field(j, "optional")?, depth + 1, repeated)?)));
        }
        if exact(j, &["repeat"]) || exact(j, &["repeat", "separator"]) {
            let item = Self::read(field(j, "repeat")?, depth + 1, true)?;
            if !item.consumes() {
                return Err("a pattern repeat cannot match only empty sequences".into());
            }
            let sep = j.get("separator").map(|x| Self::read(x, depth + 1, true).map(Box::new)).transpose()?;
            return Ok(Self::Repeat(Box::new(item), sep));
        }
        Err("a malformed pattern children expression".into())
    }
    fn consumes(&self) -> bool {
        match self {
            Self::Node(_) | Self::Siblings => true,
            Self::Sequence(xs) => xs.iter().any(Self::consumes),
            Self::Optional(x) | Self::Repeat(x, _) => x.consumes(),
        }
    }
    fn write(&self, out: &mut String) {
        match self {
            Self::Node(n) => {
                out.push_str("{\"node\":");
                n.write(out);
                out.push('}');
            }
            Self::Siblings => out.push_str("{\"siblings\":true}"),
            Self::Sequence(xs) => {
                out.push_str("{\"sequence\":[");
                for (i, x) in xs.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    x.write(out);
                }
                out.push_str("]}");
            }
            Self::Optional(x) => {
                out.push_str("{\"optional\":");
                x.write(out);
                out.push('}');
            }
            Self::Repeat(x, s) => {
                out.push_str("{\"repeat\":");
                x.write(out);
                if let Some(s) = s {
                    out.push_str(",\"separator\":");
                    s.write(out);
                }
                out.push('}');
            }
        }
    }
    fn constants<'a>(&'a self, out: &mut Vec<(&'a str, (usize, usize))>) {
        match self {
            Self::Node(n) => n.constants(out),
            Self::Sequence(xs) => {
                for x in xs {
                    x.constants(out);
                }
            }
            Self::Optional(x) => x.constants(out),
            Self::Repeat(x, s) => {
                x.constants(out);
                if let Some(s) = s {
                    s.constants(out);
                }
            }
            Self::Siblings => {}
        }
    }
    fn type_fault(&self, c: dom::ConstantTypes) -> Option<dom::Fault> {
        match self {
            Self::Node(n) => n.type_fault(c),
            Self::Sequence(xs) => xs.iter().find_map(|x| x.type_fault(c)),
            Self::Optional(x) => x.type_fault(c),
            Self::Repeat(x, s) => x.type_fault(c).or_else(|| s.as_ref().and_then(|s| s.type_fault(c))),
            Self::Siblings => None,
        }
    }
}
type ConstantResolver<'a, E> = &'a dyn Fn(&str, (usize, usize)) -> Result<Pattern, E>;

impl Pattern {
    pub(crate) fn map_values<E>(
        &self,
        constant: ConstantResolver<'_, E>,
        value: &dyn Fn(&Term, &str) -> Result<Term, E>,
    ) -> Result<Self, E> {
        Ok(match self {
            Self::Constant(n, a) => constant(n, *a)?,
            Self::Test(op, v, n) => Self::Test(op.clone(), value(v, op)?, n.clone()),
            Self::Children(c) => Self::Children(c.map_values(constant, value)?),
            Self::Path(p, n) => Self::Path(p.clone(), Box::new(n.map_values(constant, value)?)),
            Self::Union(xs) => Self::Union(xs.iter().map(|x| x.map_values(constant, value)).collect::<Result<_, _>>()?),
            Self::Intersection(xs) => {
                Self::Intersection(xs.iter().map(|x| x.map_values(constant, value)).collect::<Result<_, _>>()?)
            }
            Self::Difference(a, b) => {
                Self::Difference(Box::new(a.map_values(constant, value)?), Box::new(b.map_values(constant, value)?))
            }
            _ => self.clone(),
        })
    }
}
impl Children {
    fn map_values<E>(&self, c: ConstantResolver<'_, E>, v: &dyn Fn(&Term, &str) -> Result<Term, E>) -> Result<Self, E> {
        Ok(match self {
            Self::Node(n) => Self::Node(Box::new(n.map_values(c, v)?)),
            Self::Siblings => Self::Siblings,
            Self::Sequence(xs) => Self::Sequence(xs.iter().map(|x| x.map_values(c, v)).collect::<Result<_, _>>()?),
            Self::Optional(x) => Self::Optional(Box::new(x.map_values(c, v)?)),
            Self::Repeat(x, s) => Self::Repeat(
                Box::new(x.map_values(c, v)?),
                s.as_ref().map(|s| s.map_values(c, v).map(Box::new)).transpose()?,
            ),
        })
    }
}

use crate::fxhash::FxMap;
type Bits = Vec<u64>;
fn bit(bits: &[u64], i: usize) -> bool {
    bits.get(i / 64).is_some_and(|x| x & (1u64 << (i % 64)) != 0)
}
fn set(bits: &mut Bits, i: usize) {
    bits[i / 64] |= 1u64 << (i % 64);
}
fn merge(a: &[u64], b: &[u64]) -> Bits {
    a.iter().zip(b).map(|(a, b)| a | b).collect()
}
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct State {
    count: u8,
    first: Bits,
    last: Bits,
    any: Bits,
    relations: Vec<Vec<Bits>>,
    bits: Option<Bits>,
    empty: bool,
}
#[derive(Debug)]
struct Nfa {
    size: usize,
    start: usize,
    end: usize,
    edges: Vec<(usize, usize, Option<usize>)>,
    epsilon: Vec<Bits>,
}
#[derive(Debug)]
enum Predicate {
    Name(String),
    Terminal(String),
    Test(String, Term, String),
    Children(usize),
    Path(String, usize),
    Union(Vec<usize>),
    Intersection(Vec<usize>),
    Difference(usize, usize),
}
#[derive(Debug)]
pub(crate) struct Machine {
    predicates: Vec<Predicate>,
    machines: Vec<Nfa>,
    ids: FxMap<String, usize>,
    states: Vec<State>,
    state_ids: FxMap<State, u32>,
    transitions: FxMap<String, u32>,
    pub empty: u32,
}
fn pattern_key(p: &Pattern) -> String {
    fn plain(p: &Pattern) -> Pattern {
        match p {
            Pattern::Name(s, _) => Pattern::Name(s.clone(), (0, 0)),
            Pattern::Terminal(s, _) => Pattern::Terminal(s.clone(), (0, 0)),
            Pattern::Constant(s, _) => Pattern::Constant(s.clone(), (0, 0)),
            Pattern::Test(op, v, n) => Pattern::Test(op.clone(), v.clone(), Box::new(plain(n))),
            Pattern::Children(c) => Pattern::Children(children(c)),
            Pattern::Path(s, n) => Pattern::Path(s.clone(), Box::new(plain(n))),
            Pattern::Union(xs) => Pattern::Union(xs.iter().map(plain).collect()),
            Pattern::Intersection(xs) => Pattern::Intersection(xs.iter().map(plain).collect()),
            Pattern::Difference(a, b) => Pattern::Difference(Box::new(plain(a)), Box::new(plain(b))),
        }
    }
    fn children(c: &Children) -> Children {
        match c {
            Children::Node(n) => Children::Node(Box::new(plain(n))),
            Children::Sequence(xs) => Children::Sequence(xs.iter().map(children).collect()),
            Children::Optional(x) => Children::Optional(Box::new(children(x))),
            Children::Repeat(x, s) => {
                Children::Repeat(Box::new(children(x)), s.as_ref().map(|x| Box::new(children(x))))
            }
            Children::Siblings => Children::Siblings,
        }
    }
    let mut s = String::new();
    plain(p).write(&mut s);
    s
}
impl Machine {
    pub(crate) fn new(roots: &[Pattern]) -> Self {
        let mut m = Self {
            predicates: vec![],
            machines: vec![],
            ids: FxMap::default(),
            states: vec![],
            state_ids: FxMap::default(),
            transitions: FxMap::default(),
            empty: 0,
        };
        for p in roots {
            m.compile(p);
        }
        let zero = vec![0; m.predicates.len().div_ceil(64)];
        let relations = m.machines.iter().map(|n| n.epsilon.clone()).collect();
        m.empty = m.intern(State {
            count: 0,
            first: zero.clone(),
            last: zero.clone(),
            any: zero,
            relations,
            bits: None,
            empty: false,
        });
        m
    }
    fn compile(&mut self, p: &Pattern) -> usize {
        let key = pattern_key(p);
        if let Some(&id) = self.ids.get(&key) {
            return id;
        }
        let pred = match p {
            Pattern::Name(s, _) => Predicate::Name(s.clone()),
            Pattern::Terminal(s, _) => Predicate::Terminal(s.clone()),
            Pattern::Test(op, v, n) => {
                let Pattern::Terminal(t, _) = &**n else { unreachable!() };
                Predicate::Test(op.clone(), v.clone(), t.clone())
            }
            Pattern::Children(c) => {
                let n = self.sequence(c);
                let id = self.machines.len();
                self.machines.push(n);
                Predicate::Children(id)
            }
            Pattern::Path(path, p) => Predicate::Path(path.clone(), self.compile(p)),
            Pattern::Union(xs) => Predicate::Union(xs.iter().map(|p| self.compile(p)).collect()),
            Pattern::Intersection(xs) => Predicate::Intersection(xs.iter().map(|p| self.compile(p)).collect()),
            Pattern::Difference(a, b) => Predicate::Difference(self.compile(a), self.compile(b)),
            Pattern::Constant(..) => unreachable!("resolved pattern"),
        };
        let id = self.predicates.len();
        self.predicates.push(pred);
        self.ids.insert(key, id);
        id
    }
    fn sequence(&mut self, c: &Children) -> Nfa {
        fn build(m: &mut Machine, n: &mut Nfa, c: &Children, from: usize, to: usize) {
            fn state(n: &mut Nfa) -> usize {
                let id = n.size;
                n.size += 1;
                id
            }
            match c {
                Children::Node(p) => {
                    let id = m.compile(p);
                    n.edges.push((from, to, Some(id)));
                }
                Children::Siblings => {
                    n.edges.push((from, to, None));
                    n.edges.push((from, from, Some(usize::MAX)));
                }
                Children::Sequence(xs) => {
                    let mut a = from;
                    for (i, x) in xs.iter().enumerate() {
                        let b = if i + 1 == xs.len() { to } else { state(n) };
                        build(m, n, x, a, b);
                        a = b;
                    }
                }
                Children::Optional(x) => {
                    n.edges.push((from, to, None));
                    build(m, n, x, from, to);
                }
                Children::Repeat(x, s) => {
                    let a = state(n);
                    let b = state(n);
                    build(m, n, x, from, a);
                    n.edges.push((a, to, None));
                    if let Some(s) = s {
                        build(m, n, s, a, b);
                    } else {
                        n.edges.push((a, b, None));
                    }
                    build(m, n, x, b, a);
                }
            }
        }
        let mut n = Nfa { size: 2, start: 0, end: 1, edges: vec![], epsilon: vec![] };
        build(self, &mut n, c, 0, 1);
        n.epsilon = vec![vec![0; n.size.div_ceil(64)]; n.size];
        for i in 0..n.size {
            set(&mut n.epsilon[i], i);
        }
        for &(a, b, p) in &n.edges {
            if p.is_none() {
                set(&mut n.epsilon[a], b);
            }
        }
        for k in 0..n.size {
            for i in 0..n.size {
                if bit(&n.epsilon[i], k) {
                    n.epsilon[i] = merge(&n.epsilon[i], &n.epsilon[k]);
                }
            }
        }
        n
    }
    fn intern(&mut self, s: State) -> u32 {
        if let Some(&id) = self.state_ids.get(&s) {
            return id;
        }
        crate::work::count(crate::work::Work::StructuralStates, 1);
        let id = self.states.len() as u32;
        self.state_ids.insert(s.clone(), id);
        self.states.push(s);
        id
    }
    fn compose(a: &[Bits], b: &[Bits]) -> Vec<Bits> {
        a.iter()
            .map(|row| {
                let mut out = vec![0; b.len().div_ceil(64)];
                for (k, x) in b.iter().enumerate() {
                    if bit(row, k) {
                        out = merge(&out, x);
                    }
                }
                out
            })
            .collect()
    }
    pub(crate) fn sealed(&mut self) -> u32 {
        self.node(None, self.empty, Some(("", "", &[])))
    }
    pub(crate) fn concat(&mut self, left: u32, right: u32) -> u32 {
        let key = format!("c{left},{right}");
        if let Some(&id) = self.transitions.get(&key) {
            return id;
        }
        let a = &self.states[left as usize];
        let b = &self.states[right as usize];
        let s = State {
            count: 2.min(a.count + b.count),
            first: if a.count > 0 { a.first.clone() } else { b.first.clone() },
            last: if b.count > 0 { b.last.clone() } else { a.last.clone() },
            any: merge(&a.any, &b.any),
            relations: a.relations.iter().zip(&b.relations).map(|(a, b)| Self::compose(a, b)).collect(),
            bits: None,
            empty: false,
        };
        let id = self.intern(s);
        crate::work::count(crate::work::Work::StructuralTransitions, 1);
        self.transitions.insert(key, id);
        id
    }
    pub(crate) fn node(&mut self, name: Option<&str>, children: u32, leaf: Option<(&str, &str, &[String])>) -> u32 {
        let key = format!("n{name:?}/{children}/{leaf:?}");
        if let Some(&id) = self.transitions.get(&key) {
            return id;
        }
        let s = &self.states[children as usize];
        let mut bits = vec![0; self.predicates.len().div_ceil(64)];
        for (i, p) in self.predicates.iter().enumerate() {
            let mut holds = match p {
                Predicate::Name(n) => name == Some(n),
                Predicate::Terminal(t) => leaf.is_some_and(|(n, _, _)| n == t),
                Predicate::Test(op, v, t) => {
                    leaf.is_some_and(|(n, sound, tags)| n == t && leaf_test(op, v, sound, tags))
                }
                Predicate::Children(id) => {
                    let n = &self.machines[*id];
                    bit(&s.relations[*id][n.start], n.end)
                }
                Predicate::Path(path, child) => {
                    bit(&bits, *child)
                        || bit(
                            match path.as_str() {
                                "descendant" => &s.any,
                                "first" => &s.first,
                                _ => &s.last,
                            },
                            i,
                        )
                }
                Predicate::Union(xs) => xs.iter().any(|&i| bit(&bits, i)),
                Predicate::Intersection(xs) => xs.iter().all(|&i| bit(&bits, i)),
                Predicate::Difference(a, b) => bit(&bits, *a) && !bit(&bits, *b),
            };
            if matches!(p, Predicate::Name(_) | Predicate::Terminal(_) | Predicate::Test(..) | Predicate::Children(_))
                && s.count == 1
            {
                holds |= bit(&s.first, i);
            }
            if holds {
                set(&mut bits, i);
            }
        }
        let empty = leaf.is_none() && s.count == 0;
        let relations = if empty {
            self.states[self.empty as usize].relations.clone()
        } else {
            self.machines
                .iter()
                .map(|n| {
                    let mut moves = vec![vec![0; n.size.div_ceil(64)]; n.size];
                    for &(a, b, p) in &n.edges {
                        if p.is_some_and(|i| i == usize::MAX || bit(&bits, i)) {
                            set(&mut moves[a], b);
                        }
                    }
                    Self::compose(&Self::compose(&n.epsilon, &moves), &n.epsilon)
                })
                .collect()
        };
        let zero = vec![0; bits.len()];
        let state = State {
            count: if empty { 0 } else { 1 },
            first: if empty { zero.clone() } else { bits.clone() },
            last: if empty { zero.clone() } else { bits.clone() },
            any: if empty { zero } else { bits.clone() },
            relations,
            bits: Some(bits),
            empty,
        };
        let id = self.intern(state);
        crate::work::count(crate::work::Work::StructuralTransitions, 1);
        self.transitions.insert(key, id);
        id
    }
    pub(crate) fn matches(&self, state: u32, p: &Pattern) -> bool {
        let id = self.ids[&pattern_key(p)];
        self.states[state as usize].bits.as_ref().is_some_and(|b| bit(b, id))
    }
}
fn leaf_test(op: &str, value: &Term, sound: &str, tags: &[String]) -> bool {
    if let Term::Str(v) = value {
        return (sound == v) == (op == "=");
    }
    fn literals<'a>(v: &'a Term, out: &mut Vec<&'a str>) {
        match v {
            Term::Tag(t) => out.push(t),
            Term::Union(xs) => {
                for x in xs {
                    literals(x, out);
                }
            }
            Term::EmptySet => {}
            _ => unreachable!("evaluated tag set"),
        }
    }
    let mut values = vec![];
    literals(value, &mut values);
    let all = values.iter().all(|v| tags.iter().any(|t| t == v));
    let any = values.iter().any(|v| tags.iter().any(|t| t == v));
    match op {
        "⊇" => all,
        "⊉" => !all,
        "∩=∅" => !any,
        "∩≠∅" => any,
        _ => unreachable!(),
    }
}

impl Pattern {
    pub(crate) fn problem(&self) -> Option<&'static str> {
        enum Part<'a> {
            Node(&'a Pattern),
            Children(&'a Children),
        }
        let mut todo = vec![(Part::Node(self), false, 0)];
        while let Some((part, repeated, depth)) = todo.pop() {
            if depth > 256 {
                return Some("nested too deeply");
            }
            let next = depth + 1;
            match part {
                Part::Node(p) => match p {
                    Pattern::Children(c) => todo.push((Part::Children(c), repeated, next)),
                    Pattern::Test(_, _, p) | Pattern::Path(_, p) => todo.push((Part::Node(p), repeated, next)),
                    Pattern::Union(xs) | Pattern::Intersection(xs) => {
                        todo.extend(xs.iter().map(|p| (Part::Node(p), repeated, next)))
                    }
                    Pattern::Difference(a, b) => {
                        todo.push((Part::Node(a), repeated, next));
                        todo.push((Part::Node(b), repeated, next));
                    }
                    _ => {}
                },
                Part::Children(c) => match c {
                    Children::Node(p) => todo.push((Part::Node(p), repeated, next)),
                    Children::Siblings if repeated => {
                        return Some("a sibling ellipsis cannot be a repeat item or separator")
                    }
                    Children::Siblings => {}
                    Children::Sequence(xs) => todo.extend(xs.iter().map(|c| (Part::Children(c), repeated, next))),
                    Children::Optional(c) => todo.push((Part::Children(c), repeated, next)),
                    Children::Repeat(c, s) => {
                        if !c.consumes() {
                            return Some("a pattern repeat cannot match only empty sequences");
                        }
                        todo.push((Part::Children(c), true, next));
                        if let Some(s) = s {
                            todo.push((Part::Children(s), true, next));
                        }
                    }
                },
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn long_lists_reuse_finite_states() {
        let p = Pattern::Children(Children::Repeat(
            Box::new(Children::Node(Box::new(Pattern::Terminal("A".into(), (1, 1))))),
            None,
        ));
        let mut m = Machine::new(std::slice::from_ref(&p));
        let tags = vec!["A".into()];
        let a = m.node(None, m.empty, Some(("A", "a", &tags)));
        let mut prefix = m.empty;
        for _ in 0..1000 {
            prefix = m.concat(prefix, a);
            let node = m.node(Some("list"), prefix, None);
            assert!(m.matches(node, &p));
        }
        assert!(m.states.len() < 10, "{} states", m.states.len());
    }
    #[test]
    fn predicates_and_sequence_relations_have_no_word_limit() {
        let p = Pattern::Union((0..150).map(|i| Pattern::Terminal(format!("T{i}"), (1, 1))).collect());
        let mut m = Machine::new(std::slice::from_ref(&p));
        let tags = vec!["T149".into()];
        let a = m.node(None, m.empty, Some(("T149", "a", &tags)));
        assert!(m.matches(a, &p));
        let p = Pattern::Children(Children::Sequence(
            (0..100).map(|_| Children::Node(Box::new(Pattern::Terminal("A".into(), (1, 1))))).collect(),
        ));
        let mut m = Machine::new(std::slice::from_ref(&p));
        let tags = vec!["A".into()];
        let a = m.node(None, m.empty, Some(("A", "a", &tags)));
        let mut prefix = m.empty;
        for _ in 0..100 {
            prefix = m.concat(prefix, a);
        }
        let node = m.node(Some("list"), prefix, None);
        assert!(m.matches(node, &p));
    }
}
