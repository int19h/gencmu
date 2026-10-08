//! The rule preference graph and source authoring warnings.
use crate::dom::{Expr, Mark};
use crate::error::Error;
use crate::grammar::{is_terminal_name, StageGrammar};
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
        let mut prefs = Self::default();
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
        let mut sites: BTreeMap<String, Vec<ReferenceSite>> = edges.keys().map(|n| (n.clone(), Vec::new())).collect();
        let mut restorable = BTreeSet::new();
        let mut rules: Vec<_> = g.rules.iter().collect();
        rules.sort_by(|a, b| a.name.cmp(&b.name));
        for rule in &rules {
            for (i, alt) in rule.alternatives.iter().enumerate() {
                visit(&alt.alternative.expr, "", &mut |e, path| {
                    if let Expr::Ref(n) = e {
                        if let Some(s) = sites.get_mut(n) {
                            s.push(site(rule.name.as_str(), i, alt, path));
                        }
                    }
                    if let Expr::Optional(body, mark) = e {
                        if *mark != Mark::Plain {
                            let head =
                                if let Expr::Seq(xs) = body.as_ref() { xs.first().unwrap_or(body) } else { body };
                            let head = if let Expr::Tested(_, _, e) = head { e } else { head };
                            if let Expr::Ref(n) | Expr::Terminal(n) = head {
                                restorable.insert(n.clone());
                            }
                        }
                    }
                });
            }
        }
        for (name, refs) in sites {
            if refs.len() > 1 {
                prefs.warnings.push(LoadWarning {
                    kind: "prefer-multiple-references".into(),
                    stage: g.name.clone(),
                    rule: Some(name.clone()),
                    higher: None,
                    lower: None,
                    container: None,
                    contained: None,
                    references: refs,
                    message: format!("Preference rule {name} has several written construction sites."),
                });
            }
        }
        let mut facts: BTreeMap<String, [bool; 3]> = g.rules.iter().map(|r| (r.name.clone(), [false; 3])).collect();
        loop {
            let mut changed = false;
            for rule in &rules {
                let value = alternative_facts(
                    rule.alternatives.iter().map(|a| properties(&a.alternative.expr, &facts, &restorable)),
                );
                let before = facts.get_mut(&rule.name).expect("a rule");
                for i in 0..3 {
                    if value[i] && !before[i] {
                        before[i] = true;
                        changed = true;
                    }
                }
            }
            if !changed {
                break;
            }
        }
        let mut contained: BTreeMap<String, Vec<(String, ReferenceSite)>> = BTreeMap::new();
        for rule in &rules {
            let mut children = Vec::new();
            for (i, alt) in rule.alternatives.iter().enumerate() {
                contained_refs(&alt.alternative.expr, "", &facts, &restorable, &mut |n, p| {
                    children.push((n.into(), site(&rule.name, i, alt, p)))
                });
            }
            contained.insert(rule.name.clone(), children);
        }
        for (higher, paths) in &prefs.paths {
            for lower in paths.keys() {
                for (container, rival) in [(higher, lower), (lower, higher)] {
                    if !facts[rival][2] {
                        continue;
                    }
                    if let Some(references) = containment_path(container, rival, &contained) {
                        prefs.warnings.push(LoadWarning {
                            kind: "prefer-same-span-containment".into(),
                            stage: g.name.clone(),
                            rule: None,
                            higher: Some(higher.clone()),
                            lower: Some(lower.clone()),
                            container: Some(container.clone()),
                            contained: Some(rival.clone()),
                            references,
                            message: format!(
                                "Rule {container} can contain rival {rival} over the same original words."
                            ),
                        });
                    }
                }
            }
        }
        prefs.warnings.sort_by(|a, b| {
            (&a.kind, &a.rule, &a.higher, &a.lower, &a.container, &a.contained).cmp(&(
                &b.kind,
                &b.rule,
                &b.higher,
                &b.lower,
                &b.container,
                &b.contained,
            ))
        });
        Ok(prefs)
    }
}
fn site(rule: &str, alternative: usize, alt: &crate::grammar::StitchedAlternative, path: &str) -> ReferenceSite {
    ReferenceSite { document: alt.document.to_string(), at: alt.at, rule: rule.into(), alternative, path: path.into() }
}
fn visit(e: &Expr, p: &str, call: &mut impl FnMut(&Expr, &str)) {
    call(e, p);
    match e {
        Expr::Seq(xs) | Expr::Choice(xs) | Expr::And(xs) => {
            let k = match e {
                Expr::Seq(_) => "seq",
                Expr::Choice(_) => "choice",
                _ => "and",
            };
            for (i, x) in xs.iter().enumerate() {
                visit(x, &format!("{p}/{k}/{i}"), call);
            }
        }
        Expr::Capture(_, x) | Expr::Tested(_, _, x) => visit(x, &format!("{p}/expr"), call),
        Expr::Optional(x, _) => visit(x, &format!("{p}/optional"), call),
        Expr::Repeat(x, sep, _) => {
            visit(x, &format!("{p}/repeat"), call);
            if let Some(s) = sep {
                visit(s, &format!("{p}/separator"), call);
            }
        }
        _ => {}
    }
}
fn alternative_facts(xs: impl Iterator<Item = [bool; 3]>) -> [bool; 3] {
    xs.fold([false; 3], |a, b| [a[0] || b[0], a[1] || b[1], a[2] || b[2]])
}
fn properties(e: &Expr, f: &BTreeMap<String, [bool; 3]>, r: &BTreeSet<String>) -> [bool; 3] {
    match e {
        Expr::Capture(_, x) | Expr::Tested(_, _, x) => properties(x, f, r),
        Expr::Empty => [true, true, false],
        Expr::Ref(n) if !is_terminal_name(n) => f.get(n).copied().unwrap_or([false; 3]),
        Expr::Ref(n) | Expr::Terminal(n) => [r.contains(n), true, true],
        Expr::Range(_, _) | Expr::Property(_) => [false, true, true],
        Expr::Optional(x, _) => [true, true, properties(x, f, r)[2]],
        Expr::Repeat(x, sep, _) => {
            let a = properties(x, f, r);
            let b = sep.as_ref().map_or([true, true, false], |s| properties(s, f, r));
            [a[0], a[1], a[2] || (a[1] && b[1] && b[2])]
        }
        Expr::Choice(xs) | Expr::And(xs) => alternative_facts(xs.iter().map(|x| properties(x, f, r))),
        Expr::Seq(xs) => {
            let v: Vec<_> = xs.iter().map(|x| properties(x, f, r)).collect();
            let productive = v.iter().all(|p| p[1]);
            [v.iter().all(|p| p[0]), productive, productive && v.iter().any(|p| p[2])]
        }
    }
}
fn contained_refs(
    e: &Expr,
    p: &str,
    f: &BTreeMap<String, [bool; 3]>,
    r: &BTreeSet<String>,
    call: &mut impl FnMut(&str, &str),
) {
    match e {
        Expr::Ref(n) if !is_terminal_name(n) => call(n, p),
        Expr::Capture(_, x) | Expr::Tested(_, _, x) => contained_refs(x, &format!("{p}/expr"), f, r, call),
        Expr::Optional(x, _) => contained_refs(x, &format!("{p}/optional"), f, r, call),
        Expr::Repeat(x, sep, _) => {
            contained_refs(x, &format!("{p}/repeat"), f, r, call);
            if properties(x, f, r)[0] {
                if let Some(s) = sep {
                    contained_refs(s, &format!("{p}/separator"), f, r, call);
                }
            }
        }
        Expr::Seq(xs) | Expr::Choice(xs) | Expr::And(xs) => {
            let k = match e {
                Expr::Seq(_) => "seq",
                Expr::Choice(_) => "choice",
                _ => "and",
            };
            for (i, x) in xs.iter().enumerate() {
                if k != "seq" || xs.iter().enumerate().all(|(j, y)| i == j || properties(y, f, r)[0]) {
                    contained_refs(x, &format!("{p}/{k}/{i}"), f, r, call);
                }
            }
        }
        _ => {}
    }
}
fn containment_path(
    from: &str,
    to: &str,
    edges: &BTreeMap<String, Vec<(String, ReferenceSite)>>,
) -> Option<Vec<ReferenceSite>> {
    let mut seen = BTreeSet::from([from.to_string()]);
    let mut q = VecDeque::from([(from.to_string(), Vec::new())]);
    while let Some((n, p)) = q.pop_front() {
        for (next, s) in &edges[&n] {
            let mut path = p.clone();
            path.push(s.clone());
            if next == to {
                return Some(path);
            }
            if seen.insert(next.clone()) {
                q.push_back((next.clone(), path));
            }
        }
    }
    None
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
