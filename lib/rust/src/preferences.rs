//! Sealed slot declarations, templates and the local tag closure.
use crate::dom::{Arg, Cond, EmitItem, Expr, Term};
use crate::error::Error;
use crate::fxhash::{FxMap, FxSet};
use crate::grammar::{is_terminal_name, StageGrammar};
use crate::json::{self, Json};
use crate::lower::{Lowered, Sym};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::Arc;

/// A written reference in a surviving rule alternative.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReferenceSite {
    /// The grammar document.
    pub document: String,
    /// The rule definition's line and column, from one.
    pub at: (usize, usize),
    /// The containing rule.
    pub rule: String,
    /// The alternative's index, from zero.
    pub alternative: usize,
    /// The JSON pointer of the reference expression.
    pub path: String,
}
/// A warning about the scope of a rule preference.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadWarning {
    /// The warning's kind.
    pub kind: String,
    /// The stage's name.
    pub stage: String,
    /// The rule with several construction sites.
    pub rule: Option<String>,
    /// The higher rule of a containment warning.
    pub higher: Option<String>,
    /// The lower rule of a containment warning.
    pub lower: Option<String>,
    /// The containing rival.
    pub container: Option<String>,
    /// The contained rival.
    pub contained: Option<String>,
    /// The source references that explain the warning.
    pub references: Vec<ReferenceSite>,
    /// The human description.
    pub message: String,
}
#[derive(Debug, Clone)]
pub(crate) struct Declaration {
    pub higher: String,
    pub lower: String,
    pub document: Arc<str>,
    pub at: (usize, usize),
}
#[derive(Debug, Clone, Default)]
pub(crate) struct Preferences {
    pub paths: BTreeMap<String, BTreeMap<String, Vec<String>>>,
    pub warnings: Vec<LoadWarning>,
    pub components: Vec<Component>,
    pub labels: BTreeMap<String, usize>,
    pub variants: BTreeMap<String, Variant>,
    pub declarations: Vec<Declaration>,
    pub stage: String,
}
impl Preferences {
    pub fn new(g: &StageGrammar, declarations: &[Declaration]) -> Result<Self, Error> {
        let mut edges: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for d in declarations {
            let fail = |s| Error::grammar(s).in_document(&d.document).at(d.at.0, d.at.1).in_stage(&g.name);
            for name in [&d.higher, &d.lower] {
                if is_terminal_name(name) || !g.index.contains_key(name) {
                    return Err(fail(format!("%prefer requires an existing rule: {name}")));
                }
                edges.entry(name.clone()).or_default();
            }
            if d.higher == d.lower {
                return Err(fail(format!("%prefer cannot prefer {} to itself", d.higher)));
            }
            edges.get_mut(&d.higher).expect("a rule").insert(d.lower.clone());
        }
        let mut prefs = Self { declarations: declarations.to_vec(), stage: g.name.clone(), ..Self::default() };
        for start in edges.keys() {
            let mut found = BTreeMap::new();
            let mut queue = VecDeque::from([vec![start.clone()]]);
            while let Some(path) = queue.pop_front() {
                for next in &edges[path.last().expect("a path")] {
                    let mut reached = path.clone();
                    reached.push(next.clone());
                    if next == start {
                        let locations: Vec<_> = reached
                            .windows(2)
                            .map(|pair| {
                                let d = declarations
                                    .iter()
                                    .find(|d| d.higher == pair[0] && d.lower == pair[1])
                                    .expect("an edge");
                                format!("{}:{}:{}", d.document, d.at.0, d.at.1)
                            })
                            .collect();
                        let d = declarations.iter().find(|d| &d.higher == start).expect("a declaration");
                        return Err(Error::grammar(format!(
                            "preference cycle: {} ({})",
                            reached.join(" > "),
                            locations.join(", ")
                        ))
                        .in_document(&d.document)
                        .at(d.at.0, d.at.1)
                        .in_stage(&g.name));
                    }
                    if !found.contains_key(next) {
                        found.insert(next.clone(), reached.clone());
                        queue.push_back(reached);
                    }
                }
            }
            prefs.paths.insert(start.clone(), found);
        }
        if edges.is_empty() {
            return Ok(prefs);
        }
        let mut sites: BTreeMap<String, Vec<(ReferenceSite, usize)>> =
            edges.keys().map(|n| (n.clone(), vec![])).collect();
        for (parent, rule) in g.rules.iter().enumerate() {
            for (alternative, source) in rule.alternatives.iter().enumerate() {
                visit(&source.alternative.expr, "", &mut |expr, path| {
                    if let Expr::Ref(name) = expr {
                        if let Some(list) = sites.get_mut(name) {
                            list.push((
                                ReferenceSite {
                                    document: source.document.to_string(),
                                    at: source.at,
                                    rule: rule.name.clone(),
                                    alternative,
                                    path: path.into(),
                                },
                                parent,
                            ));
                        }
                    }
                });
            }
        }
        for (name, references) in &sites {
            if references.len() != 1 {
                return Err(prefs.fail(
                    "prefer-slot-multiple-references",
                    name,
                    &references.iter().map(|x| x.0.clone()).collect::<Vec<_>>(),
                    "exactly one written reference site is required",
                ));
            }
        }
        let mut seen = BTreeSet::new();
        for start in edges.keys() {
            if seen.contains(start) {
                continue;
            }
            let mut names = BTreeSet::from([start.clone()]);
            let mut queue = vec![start.clone()];
            while let Some(name) = queue.pop() {
                seen.insert(name.clone());
                for other in edges.keys() {
                    if (edges[&name].contains(other) || edges[other].contains(&name)) && names.insert(other.clone()) {
                        queue.push(other.clone());
                    }
                }
            }
            let refs: Vec<_> = names.iter().map(|n| sites[n][0].0.clone()).collect();
            let parent = sites[start][0].1;
            if names.iter().any(|n| sites[n][0].1 != parent) {
                return Err(prefs.fail(
                    "prefer-slot-parent",
                    start,
                    &refs,
                    "ranked references require one common parent",
                ));
            }
            let component = prefs.components.len();
            prefs.components.push(Component { names: names.clone(), references: refs.clone() });
            let mut common = None;
            for name in &names {
                let source = (parent, sites[name][0].0.alternative);
                let alt = &g.rules[parent].alternatives[source.1];
                let mut variant = Variant {
                    component,
                    source,
                    roles: BTreeMap::new(),
                    paths: FxMap::default(),
                    carriers: FxMap::default(),
                    hole_names: BTreeSet::new(),
                };
                let body = normalize_expr(&alt.alternative.expr, name, "", &mut variant);
                visit(&alt.alternative.expr, "", &mut |expr, _| {
                    if contains(expr, name) {
                        variant.carriers.insert(expr as *const Expr as usize, ends_at_hole(expr, name));
                    }
                });
                let body = canonical_expr(&body);
                if common.as_ref().is_some_and(|old| old != &body) {
                    return Err(prefs.fail(
                        "prefer-slot-template",
                        name,
                        &refs,
                        "parent bodies differ outside the ranked hole",
                    ));
                }
                common = Some(body);
                variant.hole_names =
                    variant.roles.iter().filter(|(_, r)| r.as_str() == "hole").map(|(n, _)| n.clone()).collect();
                if alt
                    .clauses
                    .emit
                    .as_ref()
                    .is_some_and(|items| items.iter().any(|item| emit_mentions(item, &variant.hole_names)))
                {
                    return Err(prefs.fail(
                        "prefer-slot-template",
                        name,
                        &refs,
                        "an emission item cannot name or read a ranked hole capture",
                    ));
                }
                prefs.labels.insert(name.clone(), component);
                prefs.variants.insert(name.clone(), variant);
            }
        }
        Ok(prefs)
    }
    pub fn fail(&self, code: &str, name: &str, references: &[ReferenceSite], detail: &str) -> Error {
        let d = self.declarations.iter().find(|d| d.higher == name || d.lower == name).expect("a declaration");
        let sites = references
            .iter()
            .map(|r| {
                format!("{}:{}:{} {} alternative {} {}", r.document, r.at.0, r.at.1, r.rule, r.alternative, r.path)
            })
            .collect::<Vec<_>>()
            .join(", ");
        Error::grammar(format!(
            "{code}: Rule {name}: {detail}. Declaration %prefer {} > {}. References: {sites}",
            d.higher, d.lower
        ))
        .in_document(&d.document)
        .at(d.at.0, d.at.1)
        .in_stage(&self.stage)
    }
    pub fn variant(
        &self,
        source: Option<(usize, usize)>,
        component: usize,
        syms: &[Sym],
        g: &Lowered,
    ) -> Option<&Variant> {
        for sym in syms {
            if let Sym::N(rule) = sym {
                if let Some(v) = self
                    .variants
                    .get(&g.rules[*rule as usize].name)
                    .filter(|v| v.component == component && !g.rules[*rule as usize].helper)
                {
                    return Some(v);
                }
            }
        }
        source.and_then(|s| {
            self.variants
                .values()
                .find(|v| {
                    v.source == s
                        && v.component == component
                        && syms.iter().any(|sym| match sym {
                            Sym::N(r) => helper_path(g, *r).is_some_and(|path| v.carriers.contains_key(&path)),
                            _ => false,
                        })
                })
                .or_else(|| self.variants.values().find(|v| v.source == s && v.component == component))
        })
    }
    pub fn validate(&self, g: &Lowered) -> Result<(), Error> {
        let mut unsafe_tags = FxSet::default();
        let mut users: FxMap<u32, Vec<u32>> = FxMap::default();
        let mut pending = Vec::new();
        for p in &g.prods {
            let slot = p.slot.as_ref().expect("slot validation");
            let mut mark = false;
            if !slot.tags.is_empty() {
                mark = slot.tags.iter().any(|t| !matches!(t, Term::EmptySet));
            } else if p.syms.len() == 1 {
                match p.syms[0] {
                    Sym::T(_) => mark = true,
                    Sym::N(child) => users.entry(child).or_default().push(p.rule),
                }
            }
            if mark && unsafe_tags.insert(p.rule) {
                pending.push(p.rule);
            }
        }
        let mut at = 0;
        while at < pending.len() {
            let child = pending[at];
            at += 1;
            for &parent in users.get(&child).into_iter().flatten() {
                if unsafe_tags.insert(parent) {
                    pending.push(parent);
                }
            }
        }
        for (component, c) in self.components.iter().enumerate() {
            let first = c.names.first().unwrap();
            let require_empty = |expression: &str| -> Result<(), Error> {
                for n in &c.names {
                    let r = g.rules.iter().position(|r| !r.helper && &r.name == n).unwrap() as u32;
                    if unsafe_tags.contains(&r) {
                        let path = inheritance_path(g, r, &unsafe_tags);
                        return Err(self.fail(
                            "prefer-slot-tags",
                            n,
                            &c.references,
                            &format!(
                                "private hole tags in {expression} are neither dead nor empty: {}",
                                path.join(" -> ")
                            ),
                        ));
                    }
                }
                Ok(())
            };
            let mut templates: BTreeMap<String, (String, String)> = BTreeMap::new();
            for p in &g.prods {
                let slot = p.slot.as_ref().expect("slot validation");
                let Some(v) = self.variant(p.slot.as_ref().map(|s| s.source), component, &p.syms, g) else { continue };
                let hole = p.syms.iter().position(|s| match s {
                    Sym::N(r) => {
                        c.names.contains(&g.rules[*r as usize].name)
                            || helper_path(g, *r).is_some_and(|path| v.carriers.contains_key(&path))
                    }
                    _ => false,
                });
                let actual = hole.is_some_and(|h| match p.syms[h] {
                    Sym::N(r) => !g.rules[r as usize].helper,
                    _ => false,
                });
                let boundary = hole.is_some_and(|h| {
                    actual
                        || match p.syms[h] {
                            Sym::N(r) => {
                                helper_path(g, r).and_then(|path| v.carriers.get(&path)).copied().unwrap_or(false)
                            }
                            _ => false,
                        }
                });
                let mut private = v.hole_names.clone();
                if let Some(h) = hole.filter(|_| actual) {
                    for (name, &pos) in slot.names.iter().zip(&p.cap_pos) {
                        if pos == h {
                            if let Some(n) = name {
                                private.insert(n.clone());
                            }
                        }
                    }
                }
                let mut private_tags = private.clone();
                if let Some(h) = hole {
                    if matches!(p.syms[h], Sym::N(r) if unsafe_tags.contains(&r)) {
                        for (name, &pos) in slot.names.iter().zip(&p.cap_pos) {
                            if pos == h {
                                if let Some(n) = name {
                                    private_tags.insert(n.clone());
                                }
                            }
                        }
                    }
                }
                let mut common_conditions = vec![];
                for (condition, ready) in &slot.conditions {
                    let ready = hole.is_some_and(|h| *ready < h + 1 || *ready == h + 1 && boundary);
                    if structural_read(condition, &private) && !ready {
                        return Err(self.fail(
                            "prefer-slot-continuation",
                            first,
                            &c.references,
                            &format!("private hole pattern requires a ready condition gate: {condition:?}"),
                        ));
                    }
                    if tag_read_cond(condition, &private_tags) && !ready {
                        require_empty(&format!("{condition:?}"))?;
                    }
                    if !ready {
                        common_conditions.push(canonical_cond(condition, &v.roles));
                    }
                }
                for term in &slot.tags {
                    if structural_term(term, &private) {
                        return Err(self.fail(
                            "prefer-slot-continuation",
                            first,
                            &c.references,
                            &format!("tag term reads private hole structure: {term:?}"),
                        ));
                    }
                    if tag_read(term, &private_tags) {
                        require_empty(&format!("{term:?}"))?;
                    }
                }
                if !g.rules[p.rule as usize].helper
                    && slot.tags.is_empty()
                    && p.syms.len() == 1
                    && hole.is_some()
                    && matches!(p.syms[0], Sym::N(r) if actual || unsafe_tags.contains(&r))
                {
                    require_empty("default inheritance")?;
                }
                let syms = p
                    .syms
                    .iter()
                    .enumerate()
                    .map(|(i, s)| {
                        if Some(i) == hole {
                            "HOLE".into()
                        } else {
                            match s {
                                Sym::T(t) => format!(
                                    "T{} {:?}",
                                    g.terminals[*t as usize],
                                    p.test(i).map(|x| &g.tests[x as usize])
                                ),
                                Sym::N(r) => {
                                    let role = if g.rules[*r as usize].helper {
                                        g.prods[g.rules[*r as usize].prods[0] as usize]
                                            .slot
                                            .as_ref()
                                            .and_then(|s| s.path)
                                            .and_then(|id| v.paths.get(&id))
                                            .cloned()
                                            .unwrap_or_else(|| format!("helper{r}"))
                                    } else {
                                        g.rules[*r as usize].name.clone()
                                    };
                                    format!("N{role} {:?}", p.test(i).map(|x| &g.tests[x as usize]))
                                }
                            }
                        }
                    })
                    .collect::<Vec<_>>();
                let captures = slot
                    .names
                    .iter()
                    .zip(&p.cap_pos)
                    .filter(|(_, pos)| Some(**pos) != hole)
                    .filter_map(|(n, pos)| n.as_ref().map(|n| (v.roles.get(n).unwrap_or(n), pos)))
                    .collect::<Vec<_>>();
                let role = slot.path.and_then(|path| v.paths.get(&path));
                let key = format!("{role:?}/{syms:?}/{captures:?}");
                let clauses = format!(
                    "{:?}/{:?}",
                    [&slot.tag_clauses[0], &slot.tag_clauses[1]]
                        .map(|t| t.as_ref().map(|t| canonical_term(t, &v.roles))),
                    slot.emit
                        .as_ref()
                        .map(|items| items.iter().map(|e| canonical_emit(e, &v.roles)).collect::<Vec<_>>())
                );
                let conditions = format!("{common_conditions:?}");
                if let Some((old, conds)) = templates.get(&key) {
                    if old != &clauses {
                        return Err(self.fail(
                            "prefer-slot-template",
                            first,
                            &c.references,
                            "effective parent tag or emission clauses differ",
                        ));
                    }
                    if hole.is_some() && conds != &conditions {
                        return Err(self.fail(
                            "prefer-slot-continuation",
                            first,
                            &c.references,
                            "differing conditions must be ready at the ranked hole boundary",
                        ));
                    }
                }
                templates.insert(key, (clauses, conditions));
            }
        }
        Ok(())
    }
}
#[derive(Debug, Clone)]
pub(crate) struct Component {
    pub names: BTreeSet<String>,
    pub references: Vec<ReferenceSite>,
}
#[derive(Debug, Clone)]
pub(crate) struct Variant {
    pub component: usize,
    pub source: (usize, usize),
    pub roles: BTreeMap<String, String>,
    pub paths: FxMap<usize, String>,
    pub hole_names: BTreeSet<String>,
    pub carriers: FxMap<usize, bool>,
}
fn visit(expr: &Expr, path: &str, call: &mut impl FnMut(&Expr, &str)) {
    call(expr, path);
    match expr {
        Expr::Seq(xs) | Expr::Choice(xs) | Expr::Ranked(xs) | Expr::And(xs) => {
            let key = match expr {
                Expr::Seq(_) => "seq",
                Expr::Choice(_) => "choice",
                Expr::Ranked(_) => "ranked",
                _ => "and",
            };
            for (i, x) in xs.iter().enumerate() {
                visit(x, &format!("{path}/{key}/{i}"), call);
            }
        }
        Expr::Capture(_, x) | Expr::Tested(_, _, x) => visit(x, &format!("{path}/expr"), call),
        Expr::Optional(x, _) => visit(x, &format!("{path}/optional"), call),
        Expr::Repeat(x, s, _) => {
            visit(x, &format!("{path}/repeat"), call);
            if let Some(s) = s {
                visit(s, &format!("{path}/separator"), call);
            }
        }
        _ => {}
    }
}
fn contains(expr: &Expr, name: &str) -> bool {
    let mut yes = false;
    visit(expr, "", &mut |e, _| {
        if matches!(e,Expr::Ref(n) if n==name) {
            yes = true
        }
    });
    yes
}
fn direct(expr: &Expr, name: &str) -> bool {
    match expr {
        Expr::Ref(n) => n == name,
        Expr::Capture(_, x) | Expr::Tested(_, _, x) => direct(x, name),
        _ => false,
    }
}
fn normalize_expr(expr: &Expr, name: &str, path: &str, v: &mut Variant) -> Expr {
    v.paths.insert(expr as *const Expr as usize, path.into());
    match expr {
        Expr::Choice(xs) if xs.iter().any(|x| contains(x, name)) => {
            normalize_expr(xs.iter().find(|x| contains(x, name)).unwrap(), name, path, v)
        }
        Expr::Capture(n, x) => {
            let hole = direct(x, name);
            v.roles.insert(n.clone(), if hole { "hole".into() } else { path.into() });
            let x = normalize_expr(x, name, &format!("{path}/expr"), v);
            if hole {
                x
            } else {
                Expr::Capture(path.into(), Box::new(x))
            }
        }
        Expr::Tested(_, _, x) if direct(x, name) => normalize_expr(x, name, &format!("{path}/expr"), v),
        Expr::Ref(n) if n == name => Expr::Ref("HOLE".into()),
        Expr::Seq(xs) | Expr::Choice(xs) | Expr::Ranked(xs) | Expr::And(xs) => {
            let key = match expr {
                Expr::Seq(_) => "seq",
                Expr::Choice(_) => "choice",
                Expr::Ranked(_) => "ranked",
                _ => "and",
            };
            let xs =
                xs.iter().enumerate().map(|(i, x)| normalize_expr(x, name, &format!("{path}/{key}/{i}"), v)).collect();
            match expr {
                Expr::Seq(_) => Expr::Seq(xs),
                Expr::Choice(_) => Expr::Choice(xs),
                Expr::Ranked(_) => Expr::Ranked(xs),
                _ => Expr::And(xs),
            }
        }
        Expr::Optional(x, m) => Expr::Optional(Box::new(normalize_expr(x, name, &format!("{path}/optional"), v)), *m),
        Expr::Repeat(x, s, c) => Expr::Repeat(
            Box::new(normalize_expr(x, name, &format!("{path}/repeat"), v)),
            s.as_ref().map(|s| Box::new(normalize_expr(s, name, &format!("{path}/separator"), v))),
            *c,
        ),
        Expr::Tested(op, t, x) => {
            Expr::Tested(op.clone(), t.clone(), Box::new(normalize_expr(x, name, &format!("{path}/expr"), v)))
        }
        _ => expr.clone(),
    }
}
fn canonical_expr(e: &Expr) -> String {
    let mut s = String::new();
    crate::dom::write_expr(&mut s, e);
    s
}
fn canonical_json(value: &Json, roles: &BTreeMap<String, String>) -> String {
    match value {
        Json::Arr(xs) => format!("[{}]", xs.iter().map(|x| canonical_json(x, roles)).collect::<Vec<_>>().join(",")),
        Json::Obj(xs) => {
            let mut out = vec![];
            for (k, v) in xs {
                if k == "at" {
                    continue;
                }
                let value = if k == "capture" || k == "captured" {
                    v.as_str()
                        .map(|n| format!("{:?}", roles.get(n).map_or(n, String::as_str)))
                        .unwrap_or_else(|| canonical_json(v, roles))
                } else {
                    canonical_json(v, roles)
                };
                out.push(format!("{k}:{value}"));
            }
            out.sort();
            format!("{{{}}}", out.join(","))
        }
        _ => format!("{value:?}"),
    }
}
fn canonical_term(t: &Term, r: &BTreeMap<String, String>) -> String {
    let mut s = String::new();
    crate::dom::write_term(&mut s, t);
    canonical_json(&json::parse(&s).unwrap(), r)
}
fn canonical_cond(c: &Cond, r: &BTreeMap<String, String>) -> String {
    let mut s = String::new();
    crate::dom::write_cond(&mut s, c);
    canonical_json(&json::parse(&s).unwrap(), r)
}
fn canonical_emit(e: &EmitItem, r: &BTreeMap<String, String>) -> String {
    match e {
        EmitItem::Insert(n) => format!("insert{n}"),
        EmitItem::Capture(n, t, a) => format!(
            "cap{:?}/{:?}/{:?}/{:?}",
            r.get(n).unwrap_or(n),
            t.as_ref().map(|t| canonical_term(t, r)),
            a.before.iter().map(|n| r.get(n).unwrap_or(n)).collect::<Vec<_>>(),
            a.after.iter().map(|n| r.get(n).unwrap_or(n)).collect::<Vec<_>>()
        ),
    }
}
fn arg_mentions(a: &Arg, n: &BTreeSet<String>) -> bool {
    match a {
        Arg::Term(t) => mentions(t, n),
        Arg::Rule(_) | Arg::Classifier(_) => false,
    }
}
fn mentions(t: &Term, n: &BTreeSet<String>) -> bool {
    match t {
        Term::Capture(c) => n.contains(c),
        Term::Call(_, args) => args.iter().any(|a| arg_mentions(a, n)),
        Term::Union(xs) | Term::Intersection(xs) => xs.iter().any(|t| mentions(t, n)),
        Term::Difference(a, b) => mentions(a, n) || mentions(b, n),
        Term::If(c, t) => cond_mentions(c, n) || mentions(t, n),
        _ => false,
    }
}
fn cond_mentions(c: &Cond, n: &BTreeSet<String>) -> bool {
    match c {
        Cond::Compare(_, a, b) => mentions(a, n) || mentions(b, n),
        Cond::Matches(t, _) | Cond::Begins(t, _) | Cond::Initial(t) => mentions(t, n),
        Cond::Captured(c) => n.contains(c),
        Cond::Not(c) => cond_mentions(c, n),
        Cond::Any(cs) | Cond::All(cs) => cs.iter().any(|c| cond_mentions(c, n)),
        Cond::If(a, b) => cond_mentions(a, n) || cond_mentions(b, n),
    }
}
fn emit_mentions(e: &EmitItem, n: &BTreeSet<String>) -> bool {
    match e {
        EmitItem::Capture(c, t, a) => {
            n.contains(c)
                || t.as_ref().is_some_and(|t| mentions(t, n))
                || a.before.iter().chain(&a.after).any(|c| n.contains(c))
        }
        _ => false,
    }
}
fn tag_read(t: &Term, n: &BTreeSet<String>) -> bool {
    match t {
        Term::Call(f, args) => {
            ((f == "tags" || f == "classes")
                && matches!(args.as_slice(),[Arg::Term(Term::Capture(c))] if n.contains(c)))
                || args.iter().any(|a| matches!(a,Arg::Term(t) if tag_read(t,n)))
        }
        Term::Union(xs) | Term::Intersection(xs) => xs.iter().any(|t| tag_read(t, n)),
        Term::Difference(a, b) => tag_read(a, n) || tag_read(b, n),
        Term::If(c, t) => tag_read_cond(c, n) || tag_read(t, n),
        _ => false,
    }
}
fn tag_read_cond(c: &Cond, n: &BTreeSet<String>) -> bool {
    match c {
        Cond::Compare(_, a, b) => tag_read(a, n) || tag_read(b, n),
        Cond::Matches(t, _) | Cond::Begins(t, _) | Cond::Initial(t) => tag_read(t, n),
        Cond::Not(c) => tag_read_cond(c, n),
        Cond::Any(cs) | Cond::All(cs) => cs.iter().any(|c| tag_read_cond(c, n)),
        Cond::If(a, b) => tag_read_cond(a, n) || tag_read_cond(b, n),
        _ => false,
    }
}
fn structural_read(c: &Cond, n: &BTreeSet<String>) -> bool {
    match c {
        Cond::Compare(op, a, b) => {
            ((op == "≅" || op == "≇") && mentions(a, n)) || structural_term(a, n) || structural_term(b, n)
        }
        Cond::Matches(t, _) | Cond::Begins(t, _) | Cond::Initial(t) => structural_term(t, n),
        Cond::Not(c) => structural_read(c, n),
        Cond::Any(cs) | Cond::All(cs) => cs.iter().any(|c| structural_read(c, n)),
        Cond::If(a, b) => structural_read(a, n) || structural_read(b, n),
        _ => false,
    }
}
fn structural_term(t: &Term, n: &BTreeSet<String>) -> bool {
    match t {
        Term::If(c, t) => structural_read(c, n) || structural_term(t, n),
        Term::Call(_, args) => args.iter().any(|a| matches!(a,Arg::Term(t) if structural_term(t,n))),
        Term::Union(xs) | Term::Intersection(xs) => xs.iter().any(|t| structural_term(t, n)),
        Term::Difference(a, b) => structural_term(a, n) || structural_term(b, n),
        _ => false,
    }
}

impl LoadWarning {
    /// The warning as compact JSON, with source reference locations.
    pub fn to_json(&self) -> String {
        use crate::json::write_str;
        let mut out = String::from("{");
        let fields = [
            ("kind", Some(self.kind.as_str())),
            ("stage", Some(self.stage.as_str())),
            ("rule", self.rule.as_deref()),
            ("higher", self.higher.as_deref()),
            ("lower", self.lower.as_deref()),
            ("container", self.container.as_deref()),
            ("contained", self.contained.as_deref()),
        ];
        let mut first = true;
        for (k, v) in fields {
            if let Some(v) = v {
                if !first {
                    out.push(',');
                }
                first = false;
                write_str(&mut out, k);
                out.push(':');
                write_str(&mut out, v);
            }
        }
        out.push_str(",\"references\":[");
        for (i, s) in self.references.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            out.push_str("{\"document\":");
            write_str(&mut out, &s.document);
            out.push_str(&format!(",\"at\":[{},{}],\"rule\":", s.at.0, s.at.1));
            write_str(&mut out, &s.rule);
            out.push_str(&format!(",\"alternative\":{},\"path\":", s.alternative));
            write_str(&mut out, &s.path);
            out.push('}');
        }
        out.push_str("],\"message\":");
        write_str(&mut out, &self.message);
        out.push('}');
        out
    }
}

fn inheritance_path(g: &Lowered, start: u32, unsafe_tags: &FxSet<u32>) -> Vec<String> {
    enum Part {
        Rule(u32, Option<usize>),
        End(usize),
    }
    let mut stack = vec![Part::Rule(start, None)];
    let mut visited = FxSet::default();
    let mut paths: Vec<(String, Option<usize>)> = vec![];
    while let Some(part) = stack.pop() {
        let (rule, path) = match part {
            Part::End(at) => {
                let mut out = vec![];
                let mut next = Some(at);
                while let Some(at) = next {
                    out.push(paths[at].0.clone());
                    next = paths[at].1;
                }
                out.reverse();
                return out;
            }
            Part::Rule(r, p) => (r, p),
        };
        if !visited.insert(rule) {
            continue;
        }
        for &id in g.rules[rule as usize].prods.iter().rev() {
            let p = &g.prods[id as usize];
            let slot = p.slot.as_ref().expect("slot validation");
            let source = format!(
                "{}:{}:{} {}",
                p.document.as_deref().unwrap_or(""),
                p.at.0,
                p.at.1,
                g.rules[rule as usize].name
            );
            if slot.tags.iter().any(|t| !matches!(t, Term::EmptySet)) {
                let at = paths.len();
                paths.push((format!("{source} tags {:?}", slot.tags), path));
                stack.push(Part::End(at));
            } else if slot.tags.is_empty() && p.syms.len() == 1 {
                match p.syms[0] {
                    Sym::T(t) => {
                        let at = paths.len();
                        paths.push((format!("{source} terminal {}", g.terminals[t as usize]), path));
                        stack.push(Part::End(at));
                    }
                    Sym::N(child) if unsafe_tags.contains(&child) => {
                        let at = paths.len();
                        paths.push((source, path));
                        stack.push(Part::Rule(child, Some(at)));
                    }
                    _ => {}
                }
            }
        }
    }
    unreachable!("an unsafe tag source has an inheritance path")
}

fn helper_path(g: &Lowered, rule: u32) -> Option<usize> {
    if !g.rules[rule as usize].helper {
        return None;
    }
    g.prods[g.rules[rule as usize].prods[0] as usize].slot.as_ref()?.path
}
fn ends_at_hole(expr: &Expr, name: &str) -> bool {
    match expr {
        Expr::Ref(n) => n == name,
        Expr::Capture(_, x) | Expr::Tested(_, _, x) | Expr::Optional(x, _) => ends_at_hole(x, name),
        Expr::Seq(xs) => xs.last().is_some_and(|x| ends_at_hole(x, name)),
        Expr::Choice(xs) => xs.iter().any(|x| ends_at_hole(x, name)),
        _ => false,
    }
}
