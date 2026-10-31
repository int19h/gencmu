//! Structural witnesses for the definition checks, without expansion products.
use super::*;
use std::sync::Arc;

#[derive(Clone)]
enum Rope<T> {
    Leaf(T),
    Join(Arc<Rope<T>>, Arc<Rope<T>>),
}
type Link<T> = Option<Arc<Rope<T>>>;
fn leaf<T>(value: T) -> Link<T> {
    Some(Arc::new(Rope::Leaf(value)))
}
fn join<T>(a: Link<T>, b: Link<T>) -> Link<T> {
    match (a, b) {
        (None, b) => b,
        (a, None) => a,
        (Some(a), Some(b)) => Some(Arc::new(Rope::Join(a, b))),
    }
}
fn flat<T: Clone>(tree: &Link<T>) -> Vec<T> {
    let mut out = Vec::new();
    let mut pending: Vec<_> = tree.iter().map(Arc::as_ref).collect();
    while let Some(part) = pending.pop() {
        match part {
            Rope::Leaf(value) => out.push(value.clone()),
            Rope::Join(a, b) => {
                pending.push(b);
                pending.push(a);
            }
        }
    }
    out
}
#[derive(Clone)]
struct Witness<'a> {
    count: usize,
    names: Link<&'a str>,
    key: Link<usize>,
    mask: usize,
}
impl Witness<'_> {
    fn empty() -> Self {
        Self { count: 0, names: None, key: None, mask: 0 }
    }
}
type States<'a> = [Option<Witness<'a>>; 4];
fn states() -> States<'static> {
    [None, None, None, None]
}
fn key_less(a: &Link<usize>, b: &Link<usize>) -> bool {
    let mut x: Vec<_> = a.iter().collect();
    let mut y: Vec<_> = b.iter().collect();
    while let (Some(u), Some(v)) = (x.last().copied(), y.last().copied()) {
        if Arc::ptr_eq(u, v) {
            x.pop();
            y.pop();
            continue;
        }
        match (u.as_ref(), v.as_ref()) {
            (Rope::Join(l, r), _) => {
                x.pop();
                x.push(r);
                x.push(l);
            }
            (_, Rope::Join(l, r)) => {
                y.pop();
                y.push(r);
                y.push(l);
            }
            (Rope::Leaf(a), Rope::Leaf(b)) => {
                if a != b {
                    return a < b;
                }
                x.pop();
                y.pop();
            }
        }
    }
    x.is_empty() && !y.is_empty()
}
fn pick<'a>(into: &mut States<'a>, state: usize, w: Witness<'a>) {
    if into[state]
        .as_ref()
        .map_or(true, |old| w.count > old.count || w.count == old.count && key_less(&w.key, &old.key))
    {
        into[state] = Some(w);
    }
}
fn query<'a>(
    expr: &'a Expr,
    required: &FxSet<String>,
    forbidden: &FxSet<String>,
    order: &[&str],
) -> Option<Witness<'a>> {
    if forbidden.contains("") || required.iter().any(|n| forbidden.contains(n)) {
        return None;
    }
    fn visit<'a>(e: &'a Expr, yes: &FxSet<String>, no: &FxSet<String>, order: &[&str]) -> States<'a> {
        work::count(Work::Checked, 1);
        let mut out = states();
        match e {
            Expr::Capture(name, _) => {
                if no.contains(name) {
                    return out;
                }
                let state = if order.first() == Some(&name.as_str()) {
                    1
                } else if order.get(1) == Some(&name.as_str()) {
                    2
                } else {
                    0
                };
                out[state] = Some(Witness {
                    count: usize::from(yes.contains(name)),
                    names: leaf(name.as_str()),
                    key: None,
                    mask: 0,
                });
            }
            Expr::Choice(items) | Expr::Ranked(items, _) => {
                for (i, child) in items.iter().enumerate() {
                    for (state, w) in visit(child, yes, no, order).into_iter().enumerate() {
                        if let Some(mut w) = w {
                            w.key = join(leaf(i), w.key);
                            pick(&mut out, state, w);
                        }
                    }
                }
            }
            Expr::Seq(items) | Expr::And(items) => {
                let and = matches!(e, Expr::And(_));
                if !and {
                    out[0] = Some(Witness::empty());
                }
                for (i, child) in items.iter().enumerate() {
                    let part = visit(child, yes, no, order);
                    let mut next = if and { out.clone() } else { states() };
                    if and {
                        for (state, w) in part.iter().enumerate() {
                            if let Some(w) = w {
                                let mut w = w.clone();
                                w.mask = 1 << i;
                                w.key = join(leaf(w.mask), w.key);
                                pick(&mut next, state, w);
                            }
                        }
                    }
                    for (a, x) in out.iter().enumerate() {
                        let Some(x) = x else { continue };
                        for (b, y) in part.iter().enumerate() {
                            let Some(y) = y else { continue };
                            if a & b != 0 || a & 2 != 0 && b & 1 != 0 {
                                continue;
                            }
                            let mut w = Witness {
                                count: x.count + y.count,
                                names: join(x.names.clone(), y.names.clone()),
                                key: join(x.key.clone(), y.key.clone()),
                                mask: 0,
                            };
                            if and {
                                w.mask = x.mask | 1 << i;
                                let tail = match x.key.as_deref() {
                                    Some(Rope::Join(_, right)) => Some(right.clone()),
                                    _ => None,
                                };
                                w.key = join(leaf(w.mask), join(tail, y.key.clone()));
                            }
                            pick(&mut next, a | b, w);
                        }
                    }
                    out = next;
                }
            }
            Expr::Optional(inner, Mark::Plain) => {
                let mut absent = Witness::empty();
                absent.key = leaf(0);
                out[0] = Some(absent);
                for (state, w) in visit(inner, yes, no, order).into_iter().enumerate() {
                    if let Some(mut w) = w {
                        w.key = join(leaf(1), w.key);
                        pick(&mut out, state, w);
                    }
                }
            }
            Expr::Tested(_, _, inner) => return visit(inner, yes, no, order),
            _ => out[0] = Some(Witness::empty()),
        }
        out
    }
    let mut found = visit(expr, required, forbidden, order);
    let w = found[if order.is_empty() { 0 } else { 3 }].take()?;
    (w.count == required.iter().filter(|n| !n.is_empty()).count()).then_some(w)
}
fn variable(expr: &Expr) -> bool {
    let mut pending = vec![(expr, false)];
    let mut done: Vec<(bool, bool)> = Vec::new();
    while let Some((e, ready)) = pending.pop() {
        let children: Vec<&Expr> = match e {
            Expr::Seq(items) | Expr::Choice(items) | Expr::Ranked(items, _) | Expr::And(items) => {
                items.iter().collect()
            }
            Expr::Optional(inner, Mark::Plain) | Expr::Tested(_, _, inner) => vec![inner],
            _ => Vec::new(),
        };
        if !ready {
            pending.push((e, true));
            pending.extend(children.iter().rev().map(|e| (*e, false)));
            continue;
        }
        let parts = done.split_off(done.len() - children.len());
        let has = matches!(e, Expr::Capture(..)) || parts.iter().any(|p| p.0);
        let varies = parts.iter().any(|p| p.1)
            || has
                && (matches!(e, Expr::Optional(_, Mark::Plain))
                    || children.len() > 1 && matches!(e, Expr::Choice(_) | Expr::Ranked(_, _) | Expr::And(_)));
        done.push((has, varies));
    }
    done[0].1
}
struct Queries<'a> {
    expr: &'a Expr,
    witnesses: Vec<Witness<'a>>,
}
impl<'a> Queries<'a> {
    fn ask(&mut self, yes: Vec<&str>, no: Vec<&str>, order: &[&str]) {
        if let Some(w) = query(
            self.expr,
            &yes.into_iter().map(str::to_string).collect(),
            &no.into_iter().map(str::to_string).collect(),
            order,
        ) {
            self.witnesses.push(w);
        }
    }
    fn clause(&mut self, p: Part<'_>, carrier: &[&str]) {
        if match p {
            Part::Term(t) => term_waits(t),
            Part::Cond(c) => cond_waits(c),
        } {
            return;
        }
        if let Part::Term(Term::Union(parts)) = p {
            for part in parts {
                self.clause(Part::Term(part), carrier);
            }
            return;
        }
        fn extend<'a>(expr: &'a Expr, witness: &Witness<'a>, yes: Vec<&str>, no: Vec<&str>) -> Option<Witness<'a>> {
            let mut names: FxSet<_> = flat(&witness.names).into_iter().collect();
            names.insert("");
            if yes.iter().all(|name| names.contains(name)) && no.iter().all(|name| !names.contains(name)) {
                return Some(witness.clone());
            }
            query(
                expr,
                &yes.into_iter().map(str::to_owned).collect(),
                &no.into_iter().map(str::to_owned).collect(),
                &[],
            )
        }
        fn branch<'a>(
            q: &mut Queries<'a>,
            p: Part<'_>,
            carrier: &[&str],
            yes: &mut Vec<String>,
            no: &mut Vec<String>,
            witness: Witness<'a>,
        ) {
            let has = |name: &str| {
                if name.is_empty() || yes.iter().any(|v| v == name) {
                    Some(true)
                } else if no.iter().any(|v| v == name) {
                    Some(false)
                } else {
                    None
                }
            };
            let condition;
            let term;
            let simple = match p {
                Part::Cond(c) => {
                    condition = simplify_cond_partial(c, &has);
                    match &condition {
                        Simple::True => return,
                        Simple::False => None,
                        Simple::Cond(c) => Some(Part::Cond(c)),
                    }
                }
                Part::Term(t) => {
                    term = simplify_term_partial(t, &has);
                    term.as_ref().map(Part::Term)
                }
            };
            let mut guards = Vec::new();
            if let Some(simple) = simple {
                walk_captures(simple, false, true, &mut guards);
            }
            if let Some(name) = guards.first() {
                no.push(name.to_string());
                if let Some(found) = extend(
                    q.expr,
                    &witness,
                    yes.iter().map(String::as_str).collect(),
                    no.iter().map(String::as_str).collect(),
                ) {
                    branch(q, simple.unwrap(), carrier, yes, no, found);
                }
                no.pop();
                yes.push(name.to_string());
                if let Some(found) = extend(
                    q.expr,
                    &witness,
                    yes.iter().map(String::as_str).collect(),
                    no.iter().map(String::as_str).collect(),
                ) {
                    branch(q, simple.unwrap(), carrier, yes, no, found);
                }
                yes.pop();
                return;
            }
            let mut used = Vec::new();
            if let Some(simple) = simple {
                walk_captures(simple, true, false, &mut used);
            }
            match p {
                Part::Cond(_) => {
                    let required = carrier.iter().copied().chain(yes.iter().map(String::as_str)).chain(used).collect();
                    if let Some(found) = extend(q.expr, &witness, required, no.iter().map(String::as_str).collect()) {
                        q.witnesses.push(found);
                    }
                }
                Part::Term(_) => {
                    for name in used {
                        let required = carrier.iter().copied().chain(yes.iter().map(String::as_str)).collect();
                        let forbidden = no.iter().map(String::as_str).chain(std::iter::once(name)).collect();
                        if let Some(found) = extend(q.expr, &witness, required, forbidden) {
                            q.witnesses.push(found);
                        }
                    }
                }
            }
        }
        if let Some(initial) = self.witnesses.first().cloned() {
            branch(self, p, carrier, &mut Vec::new(), &mut Vec::new(), initial);
        }
    }
}
/// Independent choice branches need one witness each. Their capture lists
/// occupy disjoint parts of the expression, so collecting them costs its size.
/// A variable sequence, optional or conjunction needs the structural queries.
fn independent_choices(expr: &Expr) -> Option<Vec<Vec<&str>>> {
    let mut branches = vec![expr];
    let mut witnesses = Vec::new();
    let mut seen = FxSet::default();
    while let Some(expr) = branches.pop() {
        match expr {
            Expr::Choice(items) | Expr::Ranked(items, _) => {
                work::count(Work::Checked, 1);
                branches.extend(items.iter().rev());
                continue;
            }
            Expr::Tested(_, _, inner) => {
                work::count(Work::Checked, 1);
                branches.push(inner);
                continue;
            }
            _ if variable(expr) => return None,
            _ => {}
        }
        let mut names = Vec::new();
        let mut pending = vec![expr];
        while let Some(e) = pending.pop() {
            work::count(Work::Checked, 1);
            match e {
                Expr::Capture(name, _) => names.push(name.as_str()),
                Expr::Seq(items) => pending.extend(items.iter().rev()),
                Expr::Choice(items) | Expr::Ranked(items, _) | Expr::And(items) => pending.push(&items[0]),
                Expr::Tested(_, _, inner) => pending.push(inner),
                _ => {}
            }
        }
        if seen.insert(names.clone()) {
            witnesses.push(names);
        }
    }
    Some(witnesses)
}

pub(super) fn captures(rule: &RuleDef, alternative: usize) -> Vec<Vec<&str>> {
    let alt = &rule.alternatives[alternative];
    #[cfg(test)]
    if work::mutated(Mutant::CopySequences) && !variable(&alt.expr) {
        return CaptureSequences::of(&alt.expr).named();
    }
    if let Some(witnesses) = independent_choices(&alt.expr) {
        return witnesses;
    }
    let mut q = Queries { expr: &alt.expr, witnesses: Vec::new() };
    q.ask(Vec::new(), Vec::new(), &[]);
    let items = rule.emit.as_deref().unwrap_or_default();
    let mut mentioned = Vec::new();
    for t in rule.tags.iter().chain(rule.strings.value.iter()).chain(rule.strings.image.iter()) {
        walk_captures(Part::Term(t), true, true, &mut mentioned);
    }
    for c in &rule.conditions {
        walk_captures(Part::Cond(c), true, true, &mut mentioned);
    }
    for a in &rule.alternatives {
        for t in a.tags.iter().chain(a.strings.value.iter()).chain(a.strings.image.iter()) {
            walk_captures(Part::Term(t), true, true, &mut mentioned);
        }
    }
    for item in items {
        let (tags, strings) = match item {
            EmitItem::Capture(name, tags, attachments) => {
                mentioned.push(name);
                mentioned.extend(attachments.names());
                (tags, &attachments.strings)
            }
            EmitItem::Insert(tags, strings) => (tags, strings),
        };
        for t in tags.iter().chain(strings.value.iter()).chain(strings.image.iter()) {
            walk_captures(Part::Term(t), true, true, &mut mentioned);
        }
    }
    for n in mentioned {
        q.ask(vec![n], Vec::new(), &[]);
    }
    for c in &rule.conditions {
        q.clause(Part::Cond(c), &[]);
    }
    for t in rule.tags.iter().chain(alt.tags.iter()) {
        q.clause(Part::Term(t), &[]);
    }
    let value = alt.strings.value.as_ref().or(rule.strings.value.as_ref());
    let image = alt.strings.image.as_ref().or(rule.strings.image.as_ref()).or(value);
    for t in value.into_iter().chain(image) {
        let mut used = Vec::new();
        term_captures(t, &mut used);
        for n in used {
            q.ask(Vec::new(), vec![n], &[]);
        }
    }
    let mut carriers = Vec::new();
    let mut always = false;
    let mut written = Vec::new();
    for item in items {
        let (carrier, tags, strings) = match item {
            EmitItem::Capture(name, tags, attachments) => {
                carriers.push(name.as_str());
                always |= name.is_empty();
                for n in attachments.names() {
                    q.ask(vec![n], vec![name], &[]);
                }
                q.ask(Vec::new(), vec![name], &[]);
                if !name.is_empty() {
                    written.extend(
                        attachments
                            .before
                            .iter()
                            .chain(std::iter::once(name))
                            .chain(&attachments.after)
                            .map(|n| (n.as_str(), name.as_str())),
                    );
                }
                (vec![name.as_str()], tags, &attachments.strings)
            }
            EmitItem::Insert(tags, strings) => {
                always = true;
                (Vec::new(), tags, strings)
            }
        };
        for t in strings.value.iter().chain(strings.image.iter()) {
            let mut used = Vec::new();
            term_captures(t, &mut used);
            for n in used {
                q.ask(carrier.clone(), vec![n], &[]);
            }
        }
        if let Some(t) = tags {
            q.clause(Part::Term(t), &carrier);
        }
    }
    if !items.is_empty() && !always {
        q.ask(Vec::new(), carriers, &[]);
    }
    for (i, (a, ac)) in written.iter().enumerate() {
        for (b, bc) in &written[i + 1..] {
            if a != b {
                q.ask(vec![a, ac, b, bc], Vec::new(), &[b, a]);
            }
        }
    }
    q.witnesses.sort_by_key(|w| flat(&w.key));
    let mut seen = FxSet::default();
    q.witnesses.into_iter().map(|w| flat(&w.names)).filter(|names| seen.insert(names.clone())).collect()
}
