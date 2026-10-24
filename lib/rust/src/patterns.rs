//! Finite observations of structural trees (engine §4.1).
mod layered;
pub(crate) mod shapes;

use crate::dom::{self, Arg, Term};
use crate::json::{write_str, Json};

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Pattern {
    Name(String, (usize, usize)),
    Terminal(String, (usize, usize)),
    Literal(Term, (usize, usize)),
    Range(Term, Term, (usize, usize)),
    Wildcard((usize, usize)),
    Constant(String, (usize, usize)),
    Test(String, Term, Box<Pattern>),
    Node(Box<Pattern>, bool, Option<Children>),
    Any,
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
    Choice(Vec<Children>),
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
        Some([Json::Int(a), Json::Int(b)]) if *a > 0 && *b > 0 => Ok((*a as usize, *b as usize)),
        _ => Err("a malformed pattern atom".into()),
    }
}
fn exact(j: &Json, keys: &[&str]) -> bool {
    j.as_object().is_some_and(|o| o.len() == keys.len() && keys.iter().all(|k| j.get(k).is_some()))
}
/// Convert patterns and child expressions without a recursive call stack.
impl Pattern {
    pub(crate) fn from_json(j: &Json) -> Result<Self, String> {
        Self::from_layered_json(j)
    }
    fn read_atom(j: &Json) -> Result<Self, String> {
        if exact(j, &["literal", "at"]) {
            return Ok(Self::Literal(dom::term_from_json(field(j, "literal")?)?, at(j)?));
        }
        if exact(j, &["wildcard", "at"]) && j.get("wildcard") == Some(&Json::Bool(true)) {
            if shapes::problem(j, &shapes::Inspection::default()).is_some() {
                return Err("a malformed pattern atom".into());
            }
            return Ok(Self::Wildcard(at(j)?));
        }
        if exact(j, &["range", "at"]) {
            let Some([left, right]) = field(j, "range")?.as_array() else {
                return Err("a malformed pattern range".into());
            };
            return Ok(Self::Range(dom::term_from_json(left)?, dom::term_from_json(right)?, at(j)?));
        }
        for key in ["name", "terminal", "constant"] {
            if exact(j, &[key, "at"]) {
                let text = string(j, key)?;
                let valid = if key == "name" {
                    // The DOM schema checks source names. Expansion adds canonical call names.
                    text.contains('(') && text.ends_with(')')
                        || text.chars().count() == 1
                        || text.chars().next().is_some_and(|c| c.is_ascii_lowercase()) && crate::tags::is_name(&text)
                } else if key == "terminal" {
                    dom::is_engine_tag(&text) || dom::is_constant_name(&text)
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
        Err("a malformed pattern".into())
    }
    pub(crate) fn write(&self, out: &mut String) {
        self.write_layered(out);
    }
    pub(crate) fn constants<'a>(&'a self, out: &mut Vec<(&'a str, (usize, usize))>) {
        match self {
            Self::Literal(t, _) => dom::constants_in_term(t, out),
            Self::Range(a, b, _) => {
                dom::constants_in_term(a, out);
                dom::constants_in_term(b, out);
            }
            Self::Constant(n, a) => out.push((n, *a)),
            Self::Test(_, v, p) => {
                p.constants(out);
                dom::constants_in_term(v, out);
            }
            Self::Node(node, _, children) => {
                node.constants(out);
                if let Some(children) = children {
                    children.constants(out);
                }
            }
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
    pub(crate) fn references<'a>(&'a self, out: &mut Vec<(&'a str, (usize, usize))>) {
        self.constants(out);
        enum Part<'a> {
            Pattern(&'a Pattern),
            Children(&'a Children),
        }
        let mut pending = vec![Part::Pattern(self)];
        while let Some(part) = pending.pop() {
            match part {
                Part::Pattern(pattern) => match pattern {
                    Pattern::Literal(term, _) => dom::references_in_term(term, out),
                    Pattern::Range(a, b, _) => {
                        dom::references_in_term(a, out);
                        dom::references_in_term(b, out);
                    }
                    Pattern::Test(_, term, inner) => {
                        dom::references_in_term(term, out);
                        pending.push(Part::Pattern(inner));
                    }
                    Pattern::Union(items) | Pattern::Intersection(items) => {
                        pending.extend(items.iter().map(Part::Pattern))
                    }
                    Pattern::Difference(a, b) => {
                        pending.push(Part::Pattern(a));
                        pending.push(Part::Pattern(b));
                    }
                    Pattern::Path(_, inner) => pending.push(Part::Pattern(inner)),
                    Pattern::Node(node, _, children) => {
                        pending.push(Part::Pattern(node));
                        pending.extend(children.as_ref().map(Part::Children));
                    }
                    _ => {}
                },
                Part::Children(children) => match children {
                    Children::Node(pattern) => pending.push(Part::Pattern(pattern)),
                    Children::Sequence(items) | Children::Choice(items) => {
                        pending.extend(items.iter().map(Part::Children))
                    }
                    Children::Optional(inner) => pending.push(Part::Children(inner)),
                    Children::Repeat(item, separator) => {
                        pending.push(Part::Children(item));
                        pending.extend(separator.as_deref().map(Part::Children));
                    }
                    Children::Siblings => {}
                },
            }
        }
        out.sort_by_key(|reference| reference.1);
        out.dedup();
    }

    pub(crate) fn type_fault(&self, constants: dom::ConstantTypes) -> Option<dom::Fault> {
        match self {
            Self::Constant(n, a) => (!matches!(constants(n), dom::Type::String | dom::Type::Pattern | dom::Type::Any))
                .then(|| dom::Fault {
                    problem: "a pattern atom requires a string or pattern constant".into(),
                    at: Some(*a),
                }),
            Self::Literal(t, _) => match dom::term_type_in(t, constants) {
                Err(f) => Some(f),
                Ok(ty) => dom::expected_problem(ty, dom::Type::String)
                    .map(|problem| dom::Fault { problem, at: dom::first_constant_in_term(t) }),
            },
            Self::Range(a, b, _) => [a, b].into_iter().find_map(|t| match dom::term_type_in(t, constants) {
                Err(f) => Some(f),
                Ok(ty) => dom::expected_problem(ty, dom::Type::String)
                    .map(|problem| dom::Fault { problem, at: dom::first_constant_in_term(t) }),
            }),
            Self::Test(op, v, p) => {
                // A tested user constant is a terminal, never a predicate.
                let mut base = p.as_ref();
                while let Self::Test(_, _, inner) = base {
                    base = inner;
                }
                if let Self::Constant(n, at) = base {
                    if !matches!(constants(n), dom::Type::String | dom::Type::Any) {
                        return Some(dom::Fault {
                            problem: "a tested pattern atom requires a string constant".into(),
                            at: Some(*at),
                        });
                    }
                }
                p.type_fault(constants).or_else(|| match dom::term_type_in(v, constants) {
                    Err(f) => Some(f),
                    Ok(ty) => dom::test_type_problem(op, ty)
                        .map(|problem| dom::Fault { problem, at: dom::first_constant_in_term(v) }),
                })
            }
            Self::Node(node, _, children) => {
                if let Self::Constant(name, at) = node.as_ref() {
                    if matches!(constants(name), dom::Type::Pattern) {
                        return Some(dom::Fault {
                            problem: "a pattern-valued constant cannot carry node decorations".into(),
                            at: Some(*at),
                        });
                    }
                }
                node.type_fault(constants).or_else(|| children.as_ref().and_then(|c| c.type_fault(constants)))
            }
            Self::Path(_, p) => p.type_fault(constants),
            Self::Union(xs) | Self::Intersection(xs) => xs.iter().find_map(|p| p.type_fault(constants)),
            Self::Difference(a, b) => a.type_fault(constants).or_else(|| b.type_fault(constants)),
            _ => None,
        }
    }
}
impl Children {
    fn constants<'a>(&'a self, out: &mut Vec<(&'a str, (usize, usize))>) {
        match self {
            Self::Node(n) => n.constants(out),
            Self::Sequence(xs) | Self::Choice(xs) => {
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
            Self::Sequence(xs) | Self::Choice(xs) => xs.iter().find_map(|x| x.type_fault(c)),
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
            Self::Literal(t, a) => {
                let Term::Tag(ref spelling) = value(t, "literal")? else { unreachable!("a bound literal spelling") };
                Self::Terminal(spelling.clone(), *a)
            }
            Self::Range(a, b, at) => {
                let Term::Tag(ref a) = value(a, "endpoint")? else { unreachable!() };
                let Term::Tag(ref b) = value(b, "endpoint")? else { unreachable!() };
                Self::Terminal(format!("{a}..{b}"), *at)
            }
            Self::Wildcard(a) => Self::Terminal("_".into(), *a),
            Self::Test(op, v, n) => Self::Test(op.clone(), value(v, op)?, Box::new(n.map_values(constant, value)?)),
            Self::Node(node, exact, children) => Self::Node(
                Box::new(node.map_values(constant, value)?),
                *exact,
                children.as_ref().map(|c| c.map_values(constant, value)).transpose()?,
            ),
            Self::Path(p, n) => Self::Path(p.clone(), Box::new(n.map_values(constant, value)?)),
            Self::Union(xs) => Self::Union(
                xs.iter()
                    .map(|x| x.map_values(constant, value))
                    .collect::<Result<Vec<_>, _>>()?
                    .into_iter()
                    .flat_map(|p| if let Self::Union(xs) = p { xs } else { vec![p] })
                    .collect(),
            ),
            Self::Intersection(xs) => Self::Intersection(
                xs.iter()
                    .map(|x| x.map_values(constant, value))
                    .collect::<Result<Vec<_>, _>>()?
                    .into_iter()
                    .flat_map(|p| if let Self::Intersection(xs) = p { xs } else { vec![p] })
                    .collect(),
            ),
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
            Self::Choice(xs) => Self::Choice(xs.iter().map(|x| x.map_values(c, v)).collect::<Result<_, _>>()?),
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
    observation: u32,
    family: u32,
    oracle: u32,
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
enum NodeTest {
    Name(String),
    Terminal(String),
    Test(Vec<(String, Term)>, String),
    Any,
}
#[derive(Debug)]
enum Predicate {
    Node { test: NodeTest, exact: bool, children: Option<usize> },
    Path(String, usize),
    Union(Vec<usize>),
    Intersection(Vec<usize>),
    Difference(usize, usize),
}
#[derive(Debug)]
enum PatternItem {
    Child(usize),
    Siblings,
    Choice(Vec<Vec<PatternItem>>),
    Repeat(Vec<PatternItem>, Option<Vec<PatternItem>>),
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
    pub observations: Option<crate::restoration::Observations>,
    pub families: crate::restoration::family::Families,
}
fn pattern_key(p: &Pattern) -> String {
    fn plain(p: &Pattern) -> Pattern {
        match p {
            Pattern::Literal(t, _) => Pattern::Literal(t.clone(), (0, 0)),
            Pattern::Range(a, b, _) => Pattern::Range(a.clone(), b.clone(), (0, 0)),
            Pattern::Wildcard(_) => Pattern::Wildcard((0, 0)),
            Pattern::Name(s, _) => Pattern::Name(s.clone(), (0, 0)),
            Pattern::Terminal(s, _) => Pattern::Terminal(s.clone(), (0, 0)),
            Pattern::Constant(s, _) => Pattern::Constant(s.clone(), (0, 0)),
            Pattern::Test(op, v, n) => Pattern::Test(op.clone(), v.clone(), Box::new(plain(n))),
            Pattern::Node(node, exact, attached) => {
                Pattern::Node(Box::new(plain(node)), *exact, attached.as_ref().map(children))
            }
            Pattern::Any => Pattern::Any,
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
            Children::Choice(xs) => Children::Choice(xs.iter().map(children).collect()),
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
        Self::build(|m| {
            for p in roots {
                m.compile(p);
            }
        })
    }
    fn build(configure: impl FnOnce(&mut Self)) -> Self {
        let mut m = Self {
            predicates: vec![],
            machines: vec![],
            ids: FxMap::default(),
            states: vec![],
            state_ids: FxMap::default(),
            transitions: FxMap::default(),
            empty: 0,
            observations: None,
            families: Default::default(),
        };
        m.families.enable_oracle();
        configure(&mut m);
        let zero = vec![0; m.predicates.len().div_ceil(64)];
        let relations = m.machines.iter().map(|n| n.epsilon.clone()).collect();
        m.empty = m.intern(State {
            observation: 0,
            family: 0,
            oracle: 0,
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
            Pattern::Node(node, exact, attached) => {
                let test = self.node_test(node);
                let children = attached.as_ref().map(|children| {
                    let items = self.pattern_items(children);
                    self.sequence(&items)
                });
                Predicate::Node { test, exact: *exact, children }
            }
            Pattern::Any => Predicate::Node { test: NodeTest::Any, exact: false, children: None },
            Pattern::Name(s, _) => Predicate::Node { test: NodeTest::Name(s.clone()), exact: false, children: None },
            Pattern::Terminal(s, _) => {
                Predicate::Node { test: NodeTest::Terminal(s.clone()), exact: false, children: None }
            }
            Pattern::Test(..) => {
                let mut tests = Vec::new();
                let mut base = p;
                while let Pattern::Test(op, value, inner) = base {
                    tests.push((op.clone(), value.clone()));
                    base = inner;
                }
                let Pattern::Terminal(terminal, _) = base else { unreachable!("a tested terminal atom") };
                Predicate::Node { test: NodeTest::Test(tests, terminal.clone()), exact: false, children: None }
            }
            Pattern::Path(path, p) => Predicate::Path(path.clone(), self.compile(p)),
            Pattern::Union(xs) => Predicate::Union(xs.iter().map(|p| self.compile(p)).collect()),
            Pattern::Intersection(xs) => Predicate::Intersection(xs.iter().map(|p| self.compile(p)).collect()),
            Pattern::Difference(a, b) => Predicate::Difference(self.compile(a), self.compile(b)),
            Pattern::Constant(..) | Pattern::Literal(..) | Pattern::Range(..) | Pattern::Wildcard(..) => {
                unreachable!("resolved pattern")
            }
        };
        let id = self.predicates.len();
        self.predicates.push(pred);
        self.ids.insert(key, id);
        id
    }
    fn node_test(&self, pattern: &Pattern) -> NodeTest {
        match pattern {
            Pattern::Name(name, _) => NodeTest::Name(name.clone()),
            Pattern::Terminal(name, _) => NodeTest::Terminal(name.clone()),
            Pattern::Any => NodeTest::Any,
            Pattern::Test(..) => {
                let mut tests = Vec::new();
                let mut base = pattern;
                while let Pattern::Test(op, value, inner) = base {
                    tests.push((op.clone(), value.clone()));
                    base = inner;
                }
                let Pattern::Terminal(terminal, _) = base else { unreachable!("a tested terminal atom") };
                NodeTest::Test(tests, terminal.clone())
            }
            _ => unreachable!("a resolved node test"),
        }
    }
    fn pattern_items(&mut self, children: &Children) -> Vec<PatternItem> {
        match children {
            Children::Node(p) => vec![PatternItem::Child(self.compile(p))],
            Children::Siblings => vec![PatternItem::Siblings],
            Children::Sequence(items) => items.iter().flat_map(|c| self.pattern_items(c)).collect(),
            Children::Choice(arms) => {
                vec![PatternItem::Choice(arms.iter().map(|arm| self.pattern_items(arm)).collect())]
            }
            Children::Optional(c) => vec![PatternItem::Choice(vec![self.pattern_items(c), vec![]])],
            Children::Repeat(c, s) => {
                vec![PatternItem::Repeat(self.pattern_items(c), s.as_ref().map(|s| self.pattern_items(s)))]
            }
        }
    }
    fn sequence(&mut self, items: &[PatternItem]) -> usize {
        fn state(n: &mut Nfa) -> usize {
            let id = n.size;
            n.size += 1;
            id
        }
        fn build(n: &mut Nfa, items: &[PatternItem], from: usize, to: usize) {
            if items.is_empty() {
                n.edges.push((from, to, None));
            }
            let mut start = from;
            for (i, item) in items.iter().enumerate() {
                let end = if i + 1 == items.len() { to } else { state(n) };
                match item {
                    PatternItem::Child(p) => n.edges.push((start, end, Some(*p))),
                    PatternItem::Siblings => {
                        n.edges.push((start, end, None));
                        n.edges.push((start, start, Some(usize::MAX)));
                    }
                    PatternItem::Choice(arms) => {
                        for arm in arms {
                            build(n, arm, start, end);
                        }
                    }
                    PatternItem::Repeat(body, separator) => {
                        let a = state(n);
                        let b = state(n);
                        build(n, body, start, a);
                        n.edges.push((a, end, None));
                        if let Some(separator) = separator {
                            build(n, separator, a, b);
                        } else {
                            n.edges.push((a, b, None));
                        }
                        build(n, body, b, a);
                    }
                }
                start = end;
            }
        }
        let mut n = Nfa { size: 2, start: 0, end: 1, edges: vec![], epsilon: vec![] };
        build(&mut n, items, 0, 1);
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
        let id = self.machines.len();
        self.machines.push(n);
        id
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
        let key = "seal".to_string();
        if let Some(&id) = self.transitions.get(&key) {
            return id;
        }
        let bits = vec![0; self.predicates.len().div_ceil(64)];
        let relations = self
            .machines
            .iter()
            .map(|n| {
                let mut moves = vec![vec![0; n.size.div_ceil(64)]; n.size];
                for &(a, b, p) in &n.edges {
                    if p == Some(usize::MAX) {
                        set(&mut moves[a], b);
                    }
                }
                Self::compose(&Self::compose(&n.epsilon, &moves), &n.epsilon)
            })
            .collect();
        let id = self.intern(State {
            observation: 0,
            family: 0,
            oracle: 0,
            count: 1,
            first: bits.clone(),
            last: bits.clone(),
            any: bits.clone(),
            relations,
            bits: Some(bits),
            empty: false,
        });
        crate::work::count(crate::work::Work::StructuralTransitions, 1);
        self.transitions.insert(key, id);
        id
    }
    pub(crate) fn concat(&mut self, left: u32, right: u32) -> u32 {
        let key = format!("c{left},{right}");
        if let Some(&id) = self.transitions.get(&key) {
            self.families.charge_join(self.states[left as usize].family, self.states[right as usize].family);
            return id;
        }
        let a = &self.states[left as usize];
        let b = &self.states[right as usize];
        let observation = match &mut self.observations {
            Some(observations) => observations.join(a.observation, b.observation),
            None => 0,
        };
        let s = State {
            observation,
            family: {
                let family = self.families.join(a.family, b.family);
                if observation == crate::restoration::INVALID && family != 0 {
                    self.families.invalid(family)
                } else {
                    family
                }
            },
            oracle: if observation == crate::restoration::INVALID {
                0
            } else {
                self.families.oracle_join(a.oracle, b.oracle)
            },
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
                Predicate::Node { test, children, .. } => {
                    let holds = match test {
                        NodeTest::Name(n) => name == Some(n),
                        NodeTest::Terminal(t) => leaf.is_some_and(|(n, _, _)| n == t),
                        NodeTest::Test(tests, terminal) => leaf.is_some_and(|(name, value, tags)| {
                            name == terminal && tests.iter().all(|(op, operand)| leaf_test(op, operand, value, tags))
                        }),
                        NodeTest::Any => name.is_some() || leaf.is_some(),
                    };
                    holds
                        && children.map_or(true, |id| {
                            let n = &self.machines[id];
                            bit(&s.relations[id][n.start], n.end)
                        })
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
            if matches!(p, Predicate::Node { exact: false, .. }) && s.count == 1 {
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
            observation: s.observation,
            family: s.family,
            oracle: s.oracle,
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
    pub(crate) fn observation(&self, state: u32) -> u32 {
        self.states[state as usize].observation
    }
    pub(crate) fn observing(&mut self, state: u32, observation: u32) -> u32 {
        if self.states[state as usize].observation == observation && observation != crate::restoration::INVALID {
            return state;
        }
        let mut state = self.states[state as usize].clone();
        state.observation = observation;
        if observation == crate::restoration::INVALID && state.family != 0 {
            state.family = self.families.invalid(state.family);
            state.oracle = 0;
        }
        self.intern(state)
    }
    pub(crate) fn normalized_observation(&self, state: u32) -> u32 {
        self.observations.as_ref().map_or(0, |o| o.normalized(self.observation(state)))
    }
    pub(crate) fn structural(&mut self, state: u32) -> u32 {
        let mut s = self.states[state as usize].clone();
        s.observation = 0;
        s.family = 0;
        s.oracle = 0;
        self.intern(s)
    }
    pub(crate) fn block(&mut self, block: crate::restoration::Block, child: u32) -> u32 {
        let observation = self.observation(child);
        let state = self.sealed();
        let observation = self.observations.as_mut().map_or(0, |o| o.block(block, observation));
        self.observing(state, observation)
    }

    pub(crate) fn oracle(&self, state: u32) -> u32 {
        self.states[state as usize].oracle
    }
    pub(crate) fn family_record(
        &mut self,
        state: u32,
        context: u32,
        record: crate::restoration::Aligned,
        permitted: bool,
    ) -> u32 {
        let family = self.families.record(context, record.clone(), permitted);
        let oracle = self.families.oracle_record(record, permitted);
        let mut s = self.states[state as usize].clone();
        s.family = family;
        s.oracle = oracle;
        self.intern(s)
    }
    pub(crate) fn family(&self, state: u32) -> u32 {
        self.states[state as usize].family
    }
    pub(crate) fn with_family(&mut self, state: u32, family: u32) -> u32 {
        let mut s = self.states[state as usize].clone();
        s.family = family;
        self.intern(s)
    }
    pub(crate) fn family_block(&mut self, context: Option<u32>, block: crate::restoration::Block, child: u32) -> u32 {
        let state = self.block(block.clone(), child);
        if let Some(context) = context {
            let family = if self.observation(state) == crate::restoration::INVALID {
                self.families.dead(context)
            } else {
                self.families.block(context, block.clone())
            };
            let state = self.with_family(state, family);
            if self.observation(state) == crate::restoration::INVALID {
                state
            } else {
                let mut s = self.states[state as usize].clone();
                s.oracle = self.families.oracle_record(crate::restoration::Aligned::Block(block), false);
                self.intern(s)
            }
        } else {
            state
        }
    }
    pub(crate) fn matches(&self, state: u32, p: &Pattern) -> bool {
        let id = self.ids[&pattern_key(p)];
        self.states[state as usize].bits.as_ref().is_some_and(|b| bit(b, id))
    }
}
fn leaf_test(op: &str, value: &Term, sound: &str, tags: &[String]) -> bool {
    if let Term::Str(value) = value {
        return (sound == value) == (op == "=");
    }
    let Term::Call(_, requirements) = value else { unreachable!("a signed requirement list") };
    requirements.iter().all(|requirement| {
        let Arg::Term(requirement) = requirement else { unreachable!() };
        let (negative, term) = match requirement {
            Term::Call(name, args) if name == "forbid" => {
                let [Arg::Term(term)] = &args[..] else { unreachable!() };
                (true, term)
            }
            term => (false, term),
        };
        let mut pending = vec![term];
        while let Some(term) = pending.pop() {
            match term {
                Term::Tag(tag) => {
                    if tags.contains(tag) == negative {
                        return false;
                    }
                }
                Term::Union(items) => pending.extend(items),
                Term::EmptySet => {}
                _ => unreachable!("a bound tag requirement"),
            }
        }
        true
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn long_lists_reuse_finite_states() {
        let p = Pattern::Node(
            Box::new(Pattern::Any),
            false,
            Some(Children::Repeat(Box::new(Children::Node(Box::new(Pattern::Terminal("A".into(), (1, 1))))), None)),
        );
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
        let p = Pattern::Node(
            Box::new(Pattern::Any),
            false,
            Some(Children::Sequence(
                (0..100).map(|_| Children::Node(Box::new(Pattern::Terminal("A".into(), (1, 1))))).collect(),
            )),
        );
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

#[cfg(test)]
#[path = "patterns/layered_tests.rs"]
mod layered_tests;
