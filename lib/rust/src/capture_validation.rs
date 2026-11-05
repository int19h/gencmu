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
struct Presence<'a> {
    names: FxSet<&'a str>,
    order: Vec<&'a str>,
}
#[derive(Clone)]
struct Witness<'a> {
    present: Option<Arc<Presence<'a>>>,
    count: usize,
    names: Link<&'a str>,
    key: Link<usize>,
    mask: usize,
}
impl Witness<'_> {
    fn empty() -> Self {
        Self { present: None, count: 0, names: None, key: None, mask: 0 }
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
fn query<'a>(expr: &'a Expr, required: &FxSet<&str>, forbidden: &FxSet<&str>, order: &[&str]) -> Option<Witness<'a>> {
    if forbidden.contains("") || required.iter().any(|n| forbidden.contains(n)) {
        return None;
    }
    fn visit<'a>(e: &'a Expr, yes: &FxSet<&str>, no: &FxSet<&str>, order: &[&str]) -> States<'a> {
        work::count(Work::Checked, 1);
        let mut out = states();
        match e {
            Expr::Capture(name, _) => {
                if no.contains(name.as_str()) {
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
                    present: None,
                    count: usize::from(yes.contains(name.as_str())),
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
                                present: None,
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
            Expr::Optional(inner, mark, _) if *mark == Mark::Plain || matches!(&**inner, Expr::Capture(..)) => {
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
    let mut w = found[if order.is_empty() { 0 } else { 3 }].take()?;
    if w.count != required.iter().filter(|n| !n.is_empty()).count() {
        return None;
    }
    let order = flat(&w.names);
    let mut names: FxSet<_> = order.iter().copied().collect();
    names.insert("");
    w.present = Some(Arc::new(Presence { names, order }));
    Some(w)
}
fn variable(expr: &Expr) -> bool {
    let mut pending = vec![(expr, false)];
    let mut done: Vec<(bool, bool)> = Vec::new();
    while let Some((e, ready)) = pending.pop() {
        let children: Vec<&Expr> = match e {
            Expr::Seq(items) | Expr::Choice(items) | Expr::Ranked(items, _) | Expr::And(items) => {
                items.iter().collect()
            }
            Expr::Optional(inner, mark, _) if *mark == Mark::Plain || matches!(&**inner, Expr::Capture(..)) => {
                vec![inner]
            }
            Expr::Tested(_, _, inner) => vec![inner],
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
                && (matches!(e, Expr::Optional(inner, mark, _) if *mark==Mark::Plain || matches!(&**inner,Expr::Capture(..)))
                    || children.len() > 1 && matches!(e, Expr::Choice(_) | Expr::Ranked(_, _) | Expr::And(_)));
        done.push((has, varies));
    }
    done[0].1
}
#[derive(Clone, Copy)]
struct Reduction<'a> {
    shape: Outcome<'a>,
    guard: Option<&'a str>,
}
impl Reduction<'_> {
    fn plain(shape: Outcome<'_>) -> Reduction<'_> {
        Reduction { shape, guard: None }
    }
}
struct PartialNode<'a> {
    guard: Option<usize>,
    part: Part<'a>,
    children: Vec<usize>,
    reads: Vec<&'a str>,
    fixed: bool,
}
/// A borrowed clause in postorder. Each assignment updates the affected
/// ancestors and returns the next guard without constructing a new clause.
struct PartialClause<'a> {
    nodes: Vec<PartialNode<'a>>,
    reduced: Vec<Reduction<'a>>,
    condition: bool,
    affected: Vec<Vec<usize>>,
    guard_ids: FxMap<&'a str, usize>,
    assigned: Vec<Option<bool>>,
    dirty: Vec<bool>,
    pending: Vec<usize>,
}
impl<'a> PartialClause<'a> {
    fn new(root: Part<'a>) -> Self {
        let mut nodes: Vec<PartialNode<'a>> = Vec::new();
        let mut reduced = Vec::new();
        let mut guard_ids = FxMap::default();
        let mut assigned = Vec::new();
        let mut pending = vec![(root, false)];
        let mut done = Vec::new();
        while let Some((part, ready)) = pending.pop() {
            let children = part.reducing_children();
            if !ready {
                pending.push((part, true));
                pending.extend(children.into_iter().rev().map(|child| (child, false)));
                continue;
            }
            let children = done.split_off(done.len() - children.len());
            let fixed = !matches!(part, Part::Cond(Cond::Captured(name)) if !name.is_empty())
                && children.iter().all(|&i: &usize| nodes[i].fixed);
            let guard = match part {
                Part::Cond(Cond::Captured(name)) if !name.is_empty() => {
                    let next = guard_ids.len();
                    let index = *guard_ids.entry(name.as_str()).or_insert(next);
                    if index == assigned.len() {
                        assigned.push(None);
                    }
                    Some(index)
                }
                _ => None,
            };
            let mut node = PartialNode { part, children, fixed, reads: Vec::new(), guard };
            let value = if node.children.is_empty() && !matches!(part, Part::Cond(Cond::Captured(_))) {
                let shaped = Shaped::of(part, &|_| true);
                node.reads = shaped.uses;
                Reduction::plain(shaped.shape)
            } else {
                Self::combine(&node, &reduced, &assigned)
            };
            done.push(nodes.len());
            nodes.push(node);
            reduced.push(value);
        }
        let mut parents = vec![Vec::new(); nodes.len()];
        let mut affected = vec![Vec::new(); assigned.len()];
        for (index, node) in nodes.iter().enumerate() {
            for &child in &node.children {
                parents[child].push(index);
            }
            if let Some(guard) = node.guard {
                affected[guard].push(index);
            }
        }
        for indices in &mut affected {
            let mut pending = std::mem::take(indices);
            let mut seen = vec![false; nodes.len()];
            while let Some(index) = pending.pop() {
                if !seen[index] {
                    seen[index] = true;
                    indices.push(index);
                    pending.extend_from_slice(&parents[index]);
                }
            }
            indices.sort_unstable();
        }
        let dirty = vec![false; nodes.len()];
        Self {
            nodes,
            reduced,
            condition: matches!(root, Part::Cond(_)),
            affected,
            guard_ids,
            assigned,
            dirty,
            pending: Vec::new(),
        }
    }
    fn combine(node: &PartialNode<'a>, values: &[Reduction<'a>], assigned: &[Option<bool>]) -> Reduction<'a> {
        let used = Outcome::Uses(None);
        let plain = Reduction::plain;
        let first = |a: Reduction<'a>, b: Reduction<'a>| Reduction { shape: used, guard: a.guard.or(b.guard) };
        let child = |i| values[node.children[i]];
        match node.part {
            Part::Cond(Cond::Captured(name)) => match node.guard.map_or(Some(true), |index| assigned[index]) {
                Some(true) => plain(Outcome::True),
                Some(false) => plain(Outcome::False),
                None => Reduction { shape: used, guard: Some(name) },
            },
            Part::Cond(Cond::Not(_)) => {
                let inner = child(0);
                match inner.shape {
                    Outcome::True => plain(Outcome::False),
                    Outcome::False => plain(Outcome::True),
                    _ => inner,
                }
            }
            Part::Cond(Cond::All(_) | Cond::Any(_)) => {
                let all = matches!(node.part, Part::Cond(Cond::All(_)));
                let mut result = plain(if all { Outcome::True } else { Outcome::False });
                for &index in &node.children {
                    let value = values[index];
                    match value.shape {
                        Outcome::True if !all => return plain(Outcome::True),
                        Outcome::False if all => return plain(Outcome::False),
                        Outcome::True | Outcome::False => {}
                        _ => result = first(result, value),
                    }
                }
                result
            }
            Part::Cond(Cond::If(_, _)) => {
                let (premise, then) = (child(0), child(1));
                match (premise.shape, then.shape) {
                    (Outcome::False, _) | (_, Outcome::True) => plain(Outcome::True),
                    (Outcome::True, _) => then,
                    _ => first(premise, then),
                }
            }
            Part::Term(Term::If(_, _)) => {
                let (premise, then) = (child(0), child(1));
                match (premise.shape, then.shape) {
                    (Outcome::False, _) | (_, Outcome::Empty) => plain(Outcome::Empty),
                    (Outcome::True, _) => then,
                    _ => first(premise, then),
                }
            }
            Part::Term(Term::Union(_) | Term::Intersection(_)) => {
                let intersection = matches!(node.part, Part::Term(Term::Intersection(_)));
                let mut result = plain(if intersection { used } else { Outcome::Empty });
                for &index in &node.children {
                    let value = values[index];
                    if value.shape == Outcome::Empty {
                        if intersection {
                            return plain(Outcome::Empty);
                        }
                    } else {
                        result = first(result, value);
                    }
                }
                result
            }
            Part::Term(Term::Difference(_, _)) => {
                let (left, right) = (child(0), child(1));
                if left.shape == Outcome::Empty {
                    plain(Outcome::Empty)
                } else if right.shape == Outcome::Empty {
                    left
                } else {
                    first(left, right)
                }
            }
            Part::Cond(Cond::Compare(_, _, _, _)) => first(child(0), child(1)),
            _ => unreachable!("a variable clause node"),
        }
    }
    fn assign(&mut self, slot: usize, value: Option<bool>) {
        self.assigned[slot] = value;
        for &index in &self.affected[slot] {
            work::count(Work::Walked, 1);
            if !self.dirty[index] {
                self.dirty[index] = true;
                self.pending.push(index);
            }
        }
    }
    fn reduce(&mut self) -> Reduction<'a> {
        // Restoring a guard and extending its parent share ancestor work.
        self.pending.sort_unstable();
        for index in self.pending.drain(..) {
            work::count(Work::Walked, 1);
            self.reduced[index] = Self::combine(&self.nodes[index], &self.reduced, &self.assigned);
            self.dirty[index] = false;
        }
        *self.reduced.last().expect("a clause root")
    }
    fn reads(&self) -> Vec<&'a str> {
        let mut pending = vec![self.nodes.len() - 1];
        let mut out = Vec::new();
        while let Some(index) = pending.pop() {
            if matches!(self.reduced[index].shape, Outcome::Uses(_)) {
                let node = &self.nodes[index];
                out.extend_from_slice(&node.reads);
                pending.extend(node.children.iter().rev());
            }
        }
        out
    }
}

struct Queries<'a> {
    expr: &'a Expr,
    witnesses: Vec<Witness<'a>>,
}
impl<'a> Queries<'a> {
    fn ask(&mut self, yes: Vec<&str>, no: Vec<&str>, order: &[&str]) {
        if let Some(w) = query(self.expr, &yes.into_iter().collect(), &no.into_iter().collect(), order) {
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
        // The witness already meets yes and no. Only new constraints need
        // membership tests before the same witness can be reused.
        fn extend<'a>(
            expr: &'a Expr,
            witness: &Witness<'a>,
            yes: &[&str],
            no: &[&str],
            required: &[&str],
            forbidden: &[&str],
        ) -> Option<Witness<'a>> {
            let names = &witness.present.as_ref().expect("a completed query witness").names;
            if required.iter().all(|name| names.contains(name)) && forbidden.iter().all(|name| !names.contains(name)) {
                return Some(witness.clone());
            }
            query(
                expr,
                &yes.iter().chain(required).copied().collect(),
                &no.iter().chain(forbidden).copied().collect(),
                &[],
            )
        }
        fn branch<'a, 'c>(
            q: &mut Queries<'a>,
            plan: &mut PartialClause<'c>,
            carrier: &[&str],
            yes: &mut Vec<&'c str>,
            no: &mut Vec<&'c str>,
            witness: Witness<'a>,
        ) {
            let simple = plan.reduce();
            if simple.shape == Outcome::True {
                return;
            }
            if let Some(name) = simple.guard {
                let slot = plan.guard_ids[name];
                no.push(name);
                plan.assign(slot, Some(false));
                if let Some(found) = extend(q.expr, &witness, yes, no, &[], &[name]) {
                    branch(q, plan, carrier, yes, no, found);
                }
                no.pop();
                yes.push(name);
                plan.assign(slot, Some(true));
                if let Some(found) = extend(q.expr, &witness, yes, no, &[name], &[]) {
                    branch(q, plan, carrier, yes, no, found);
                }
                yes.pop();
                plan.assign(slot, None);
                return;
            }
            let used = plan.reads();
            if plan.condition {
                let required: Vec<_> = carrier.iter().copied().chain(used).collect();
                if let Some(found) = extend(q.expr, &witness, yes, no, &required, &[]) {
                    q.witnesses.push(found);
                }
            } else {
                for name in used {
                    if let Some(found) = extend(q.expr, &witness, yes, no, carrier, &[name]) {
                        q.witnesses.push(found);
                    }
                }
            }
        }
        if let Some(initial) = self.witnesses.first().cloned() {
            branch(self, &mut PartialClause::new(p), carrier, &mut Vec::new(), &mut Vec::new(), initial);
        }
    }
}
/// Independent choice branches need one witness each. Their capture lists
/// occupy disjoint parts of the expression, so collecting them costs its size.
/// A variable sequence, optional or conjunction needs the structural queries.
fn independent_choices(expr: &Expr) -> Option<Vec<Vec<&str>>> {
    let mut branches = vec![expr];
    let mut witnesses: Vec<Vec<&str>> = Vec::new();
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
        let distinct = if work::mutated(Mutant::CompareCaptureChoices) {
            !witnesses.iter().any(|previous| {
                work::count(Work::Checked, 1);
                previous == &names
            })
        } else {
            seen.insert(names.clone())
        };
        if distinct {
            witnesses.push(names);
        }
    }
    Some(witnesses)
}

pub(super) fn captures(rule: &RuleDef, alternative: usize) -> Vec<Vec<&str>> {
    let alt = &rule.alternatives[alternative];
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
    q.witnesses.sort_by_cached_key(|w| flat(&w.key));
    let mut seen = FxSet::default();
    q.witnesses
        .into_iter()
        .map(|w| w.present.as_ref().expect("a completed query witness").order.clone())
        .filter(|names| seen.insert(names.clone()))
        .collect()
}
