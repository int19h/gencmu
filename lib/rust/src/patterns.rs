//! Finite observations of structural trees (engine §4.1).
mod dropping;
mod layered;
pub(crate) use layered::emit_pattern;
pub(crate) mod shapes;

use crate::dom::{self, Arg, Term};
use crate::json::Json;

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Pattern {
    Source(crate::dom::source::SourceSymbol),
    Name(String, (usize, usize)),
    Terminal(String, (usize, usize)),
    Literal(Term, (usize, usize)),
    Range(Term, Term, (usize, usize)),
    Wildcard((usize, usize)),
    Constant(String, (usize, usize)),
    Test(String, Term, Box<Pattern>, Option<(usize, usize)>),
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
    pub(crate) fn empty() -> Self {
        let all = Self::Node(Box::new(Self::Any), false, Some(Children::Sequence(vec![Children::Siblings])));
        Self::Difference(Box::new(all.clone()), Box::new(all))
    }

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
    pub(crate) fn walk(&self) -> Walk<'_> {
        Walk { pending: vec![Part::Pattern(self)] }
    }

    pub(crate) fn type_fault(&self, constants: dom::ConstantTypes) -> Option<dom::Fault> {
        for part in self.walk() {
            match part {
                Part::Term(term, test) => match dom::term_type_in(term, constants) {
                    Err(fault) => return Some(fault),
                    Ok(ty) => {
                        let problem = match test {
                            Some(op) => dom::test_type_problem(op, ty),
                            None => dom::expected_problem(ty, dom::Type::String),
                        };
                        if let Some(problem) = problem {
                            return Some(dom::Fault { problem, at: dom::first_constant_in_term(term) });
                        }
                    }
                },
                Part::Pattern(Self::Constant(name, at)) => {
                    if !matches!(constants(name), dom::Type::String | dom::Type::Pattern | dom::Type::Any) {
                        return Some(dom::Fault {
                            problem: "a pattern atom requires a string or pattern constant".into(),
                            at: Some(*at),
                        });
                    }
                }
                Part::Pattern(Self::Test(_, _, inner, _)) => {
                    let mut base = inner.as_ref();
                    while let Self::Test(_, _, nested, _) = base {
                        base = nested;
                    }
                    if let Self::Constant(name, at) = base {
                        if !matches!(constants(name), dom::Type::String | dom::Type::Any) {
                            return Some(dom::Fault {
                                problem: "a tested pattern atom requires a string constant".into(),
                                at: Some(*at),
                            });
                        }
                    }
                }
                Part::Pattern(Self::Node(node, _, _)) => {
                    if let Self::Constant(name, at) = node.as_ref() {
                        if matches!(constants(name), dom::Type::Pattern) {
                            return Some(dom::Fault {
                                problem: "a pattern-valued constant cannot carry node decorations".into(),
                                at: Some(*at),
                            });
                        }
                    }
                }
                _ => {}
            }
        }
        None
    }
}

/// A pattern part in written order. A term records its enclosing test,
/// or requires a string when it is a literal or range endpoint.
#[derive(Clone, Copy)]
pub(crate) enum Part<'a> {
    Pattern(&'a Pattern),
    Children(&'a Children),
    Source(&'a crate::dom::source::SourceSymbol),
    Term(&'a Term, Option<&'a str>),
}
pub(crate) struct Walk<'a> {
    pending: Vec<Part<'a>>,
}
impl Part<'_> {
    /// Schedule children in reverse written order for an explicit stack.
    pub(crate) fn push_children(self, mut push: impl FnMut(Self)) {
        match self {
            Part::Pattern(pattern) => match pattern {
                Pattern::Source(symbol) => push(Part::Source(symbol)),
                Pattern::Literal(term, _) => push(Part::Term(term, None)),
                Pattern::Range(a, b, _) => {
                    push(Part::Term(b, None));
                    push(Part::Term(a, None));
                }
                Pattern::Test(op, term, inner, _) => {
                    push(Part::Term(term, Some(op)));
                    push(Part::Pattern(inner));
                }
                Pattern::Node(node, _, children) => {
                    if let Some(children) = children {
                        push(Part::Children(children));
                    }
                    push(Part::Pattern(node));
                }
                Pattern::Path(_, inner) => push(Part::Pattern(inner)),
                Pattern::Union(items) | Pattern::Intersection(items) => {
                    for item in items.iter().rev() {
                        push(Part::Pattern(item));
                    }
                }
                Pattern::Difference(a, b) => {
                    push(Part::Pattern(b));
                    push(Part::Pattern(a));
                }
                _ => {}
            },
            Part::Children(children) => match children {
                Children::Node(pattern) => push(Part::Pattern(pattern)),
                Children::Sequence(items) | Children::Choice(items) => {
                    for item in items.iter().rev() {
                        push(Part::Children(item));
                    }
                }
                Children::Optional(inner) => push(Part::Children(inner)),
                Children::Repeat(item, separator) => {
                    if let Some(separator) = separator.as_deref() {
                        push(Part::Children(separator));
                    }
                    push(Part::Children(item));
                }
                Children::Siblings => {}
            },
            Part::Term(..) | Part::Source(_) => {}
        }
    }
}
impl<'a> Iterator for Walk<'a> {
    type Item = Part<'a>;
    fn next(&mut self) -> Option<Self::Item> {
        let part = self.pending.pop()?;
        part.push_children(|child| self.pending.push(child));
        Some(part)
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
            Self::Test(op, v, n, mark_at) => {
                Self::Test(op.clone(), value(v, op)?, Box::new(n.map_values(constant, value)?), *mark_at)
            }
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

use crate::hash::FastMap;
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
    tree: u32,
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
    Test(Pattern),
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
    pub trees: Option<crate::tree_identity::Arena>,
    pub node_tags: bool,
    pub node_values: bool,
    predicates: Vec<Predicate>,
    machines: Vec<Nfa>,
    ids: FastMap<String, usize>,
    states: Vec<State>,
    state_ids: FastMap<State, u32>,
    transitions: FastMap<String, u32>,
    restoration_keys: FastMap<u32, (u32, u32)>,
    restoration_states: FastMap<(u32, u32), u32>,
    pub empty: u32,
    pub observations: Option<crate::restoration::Observations>,
    pub families: crate::restoration::family::Families,
}
fn pattern_key(p: &Pattern) -> String {
    fn plain(p: &Pattern) -> Pattern {
        match p {
            Pattern::Source(symbol) => Pattern::Source(symbol.clone()),
            Pattern::Literal(t, _) => Pattern::Literal(t.clone(), (0, 0)),
            Pattern::Range(a, b, _) => Pattern::Range(a.clone(), b.clone(), (0, 0)),
            Pattern::Wildcard(_) => Pattern::Wildcard((0, 0)),
            Pattern::Name(s, _) => Pattern::Name(s.clone(), (0, 0)),
            Pattern::Terminal(s, _) => Pattern::Terminal(s.clone(), (0, 0)),
            Pattern::Constant(s, _) => Pattern::Constant(s.clone(), (0, 0)),
            Pattern::Test(op, v, n, _) => Pattern::Test(op.clone(), v.clone(), Box::new(plain(n)), None),
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
            m.node_tags = roots.iter().any(reads_node_tags);
            m.node_values = roots.iter().any(reads_node_values);
            for p in roots {
                m.compile(p);
            }
        })
    }
    fn build(configure: impl FnOnce(&mut Self)) -> Self {
        let mut m = Self {
            trees: None,
            node_tags: false,
            node_values: false,
            predicates: vec![],
            machines: vec![],
            ids: FastMap::default(),
            states: vec![],
            state_ids: FastMap::default(),
            transitions: FastMap::default(),
            restoration_keys: FastMap::default(),
            restoration_states: FastMap::default(),
            empty: 0,
            observations: None,
            families: Default::default(),
        };
        m.families.enable_oracle();
        configure(&mut m);
        let zero = vec![0; m.predicates.len().div_ceil(64)];
        let relations = m.machines.iter().map(|n| n.epsilon.clone()).collect();
        m.empty = m.intern(State {
            tree: 0,
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
            Pattern::Source(_) => unreachable!("source symbols expand before pattern compilation"),
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
            Pattern::Test(..) => Predicate::Node { test: NodeTest::Test(p.clone()), exact: false, children: None },
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
            Pattern::Test(..) => NodeTest::Test(pattern.clone()),
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
                        let gap = state(n);
                        n.edges.push((start, gap, None));
                        n.edges.push((gap, gap, Some(usize::MAX)));
                        n.edges.push((gap, end, None));
                    }
                    PatternItem::Choice(arms) => {
                        for arm in arms {
                            build(n, arm, start, end);
                        }
                    }
                    PatternItem::Repeat(body, separator) => {
                        let a = state(n);
                        let b = state(n);
                        n.edges.push((start, a, None));
                        build(n, body, a, b);
                        n.edges.push((b, end, None));
                        if let Some(separator) = separator {
                            build(n, separator, b, a);
                        } else {
                            n.edges.push((b, a, None));
                        }
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
            tree: 0,
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
        let tree = match self.trees.as_mut() {
            Some(trees) if a.tree != 0 || b.tree != 0 => trees.join(a.tree, b.tree),
            _ => 0,
        };
        let s = State {
            tree,
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
        self.transitions.insert(key, id);
        id
    }
    pub(crate) fn node(&mut self, name: Option<&str>, children: u32, leaf: Option<(&str, &str, &[String])>) -> u32 {
        self.node_with_tags(name, children, leaf, leaf.map_or(&[], |(_, _, tags)| tags))
    }
    pub(crate) fn node_with_tags(
        &mut self,
        name: Option<&str>,
        children: u32,
        leaf: Option<(&str, &str, &[String])>,
        tags: &[String],
    ) -> u32 {
        self.node_with_value(name, children, leaf, tags, None)
    }
    pub(crate) fn node_with_value(
        &mut self,
        name: Option<&str>,
        children: u32,
        leaf: Option<(&str, &str, &[String])>,
        tags: &[String],
        value: Option<&str>,
    ) -> u32 {
        let key = format!("n{name:?}/{children}/{leaf:?}/{tags:?}/{value:?}");
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
                        NodeTest::Terminal(t) => leaf.is_some_and(|(n, _, _)| t == "_" || n == t),
                        NodeTest::Test(pattern) => local_matches_with_value(pattern, name, leaf, tags, value),
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
            tree: 0,
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
        self.transitions.insert(key, id);
        id
    }
    pub(crate) fn tree_state(&self, state: u32) -> u32 {
        self.states[state as usize].tree
    }
    pub(crate) fn tree(&self, state: u32) -> Option<crate::tree_identity::Tree> {
        if state == u32::MAX {
            return None;
        }
        self.trees.as_ref().and_then(|arena| arena.get(self.states[state as usize].tree))
    }
    pub(crate) fn with_tree(&mut self, state: u32, tree: u32) -> u32 {
        if self.states[state as usize].tree == tree {
            return state;
        }
        let mut state = self.states[state as usize].clone();
        state.tree = tree;
        self.intern(state)
    }
    pub(crate) fn select(&mut self, state: u32, closes: bool, trees: bool) -> u32 {
        let mut state = self.states[state as usize].clone();
        if !closes {
            state.observation = 0;
            state.family = 0;
            state.oracle = 0;
        }
        if !trees {
            state.tree = 0;
        }
        self.intern(state)
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
    /// Class identity retains records, blocks and validity, without named closes (§6).
    pub(crate) fn restoration_key(&mut self, state: u32) -> (u32, u32) {
        if let Some(&key) = self.restoration_keys.get(&state) {
            return key;
        }
        let observation = self.normalized_observation(state);
        let mut parts = self.states[state as usize].clone();
        parts.observation = 0;
        let key = (self.intern(parts), observation);
        self.restoration_keys.insert(state, key);
        key
    }
    pub(crate) fn restoration_state(&mut self, state: u32) -> u32 {
        if state == u32::MAX {
            return state;
        }
        let key = self.restoration_key(state);
        *self.restoration_states.entry(key).or_insert(state)
    }
    /// Export a seal while preserving independent restoration observations (§4.1).
    pub(crate) fn erased(&mut self, state: u32, name: Option<&str>, tags: &[String], value: Option<&str>) -> u32 {
        let seal = self.sealed();
        let target = if name.is_some() { self.node_with_value(name, seal, None, tags, value) } else { seal };
        let source = self.states[state as usize].clone();
        let mut result = self.states[target as usize].clone();
        result.tree = source.tree;
        result.observation = source.observation;
        result.family = source.family;
        result.oracle = source.oracle;
        self.intern(result)
    }

    pub(crate) fn structural(&mut self, state: u32) -> u32 {
        let mut s = self.states[state as usize].clone();
        s.observation = 0;
        s.family = 0;
        s.oracle = 0;
        s.tree = 0;
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

pub(crate) fn local_matches(
    pattern: &Pattern,
    name: Option<&str>,
    leaf: Option<(&str, &str, &[String])>,
    tags: &[String],
) -> bool {
    local_matches_with_value(pattern, name, leaf, tags, None)
}

pub(crate) fn local_matches_with_value(
    pattern: &Pattern,
    name: Option<&str>,
    leaf: Option<(&str, &str, &[String])>,
    tags: &[String],
    node_value: Option<&str>,
) -> bool {
    match pattern {
        Pattern::Node(inner, _, _) => local_matches_with_value(inner, name, leaf, tags, node_value),
        Pattern::Name(rule, _) => name == Some(rule),
        Pattern::Terminal(terminal, _) => leaf.is_some_and(|(read, _, _)| terminal == "_" || read == terminal),
        Pattern::Any => name.is_some() || leaf.is_some(),
        Pattern::Test(op, value, inner, _) => {
            local_matches_with_value(inner, name, leaf, tags, node_value)
                && if op == "tags" {
                    leaf_test(op, value, "", tags)
                } else {
                    leaf.map(|(_, sound, _)| sound)
                        .or(node_value)
                        .is_some_and(|sound| leaf_test(op, value, sound, tags))
                }
        }
        Pattern::Union(items) => items.iter().any(|p| local_matches_with_value(p, name, leaf, tags, node_value)),
        Pattern::Intersection(items) => items.iter().all(|p| local_matches_with_value(p, name, leaf, tags, node_value)),
        Pattern::Difference(a, b) => {
            local_matches_with_value(a, name, leaf, tags, node_value)
                && !local_matches_with_value(b, name, leaf, tags, node_value)
        }
        _ => false,
    }
}

pub(crate) fn reads_node_tags(pattern: &Pattern) -> bool {
    pattern.walk().any(|part|matches!(part,Part::Pattern(Pattern::Test(op,_,inner, _)) if op == "tags" && matches!(inner.as_ref(),Pattern::Name(..)|Pattern::Source(crate::dom::source::SourceSymbol::Call(_)))))
}

pub(crate) fn requires_elided(pattern: &Pattern) -> bool {
    match pattern {
        Pattern::Union(parts) => parts.iter().all(requires_elided),
        Pattern::Intersection(parts) => parts.iter().any(requires_elided),
        Pattern::Difference(a, _) | Pattern::Node(a, _, _) => requires_elided(a),
        Pattern::Test(op, Term::Call(_, requirements), inner, _) if op == "tags" => {
            requirements.iter().any(|r| matches!(r,Arg::Term(t) if positive_elided(t))) || requires_elided(inner)
        }
        Pattern::Test(_, _, inner, _) => requires_elided(inner),
        _ => false,
    }
}
fn positive_elided(term: &Term) -> bool {
    match term {
        Term::Tag(tag) => tag == "_Elided",
        Term::Union(parts) => parts.iter().any(positive_elided),
        _ => false,
    }
}

pub(crate) fn ranking_problem(pattern: &Pattern) -> Option<&'static str> {
    match pattern {
        Pattern::Union(parts) | Pattern::Intersection(parts) => parts.iter().find_map(ranking_problem),
        Pattern::Difference(a, b) => ranking_problem(a).or_else(|| ranking_problem(b)),
        Pattern::Node(inner, true, None)
            if matches!(inner.as_ref(), Pattern::Name(..) | Pattern::Terminal(..) | Pattern::Test(..)) =>
        {
            None
        }
        _ => Some("a ranking step requires an exact local node pattern"),
    }
}

pub(crate) fn reads_node_values(pattern: &Pattern) -> bool {
    pattern.walk().any(|part| match part {
        Part::Pattern(Pattern::Test(op, _, inner, _)) if op != "tags" => {
            let atom = match inner.as_ref() {
                Pattern::Test(_, _, atom, _) => atom.as_ref(),
                atom => atom,
            };
            matches!(atom, Pattern::Name(..) | Pattern::Source(crate::dom::source::SourceSymbol::Call(_)))
        }
        _ => false,
    })
}

#[cfg(test)]
mod undemanded_tests {
    use super::Machine;
    #[test]
    fn restoration_class_keys_project_names_and_preserve_validity() {
        // Engine §6: the key projects observations, while chart states stay raw.
        let mut m = Machine::new(&[]);
        let mut closes = crate::restoration::Observations::new();
        let a = closes.complete(0, Some(1), 0, 1);
        let b = closes.complete(0, Some(2), 0, 1);
        let omitted = closes.close(crate::restoration::record("T".into(), 0, &[], None));
        m.observations = Some(closes);
        let root = m.sealed();
        let first = m.observing(root, a);
        let second = m.observing(root, b);
        let empty = m.observing(root, crate::restoration::INVALID);
        let written = m.observing(root, omitted);
        assert_ne!(first, second);
        assert_eq!(m.restoration_key(first), m.restoration_key(second));
        assert_eq!(m.restoration_state(first), m.restoration_state(second));
        assert_ne!(m.restoration_key(first), m.restoration_key(empty));
        assert_ne!(m.restoration_key(first), m.restoration_key(written));
        assert_eq!(m.observation(first), a);
        assert_eq!(m.observation(second), b);
    }
    #[test]
    fn equal_parts_retain_seals_and_independent_observations() {
        // Engine §4.1: state interning compares parts without semantic minimization.
        let mut machine = Machine::new(&[]);
        let empty = machine.empty;
        let node = machine.node(Some("r"), empty, None);
        assert_eq!(machine.node(Some("r"), empty, None), node);
        assert_ne!(machine.sealed(), empty);
        let tree = machine.with_tree(node, 42);
        let observation = machine.observing(tree, 7);
        assert_eq!(machine.tree_state(observation), 42);
        assert_eq!(machine.observation(observation), 7);
        assert_eq!(machine.structural(observation), node);
        let exported = machine.erased(observation, Some("r"), &[], None);
        assert_eq!(machine.tree_state(exported), 42);
        assert_eq!(machine.observation(exported), 7);
        assert_ne!(machine.structural(exported), node);
    }
}
