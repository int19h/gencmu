use super::*;
use crate::dom::{Arg, Term};

fn mark(out: &mut [u8], index: usize, image: bool) -> bool {
    let old = out[index];
    out[index] |= 1 << u8::from(image);
    old != out[index]
}
fn named(out: &mut [u8], rule: u32, image: bool, g: &Lowered) -> bool {
    let mut changed = false;
    for &index in &g.rules[rule as usize].prods {
        changed = mark(out, index as usize, image) || changed;
    }
    changed
}
fn own(out: &mut [u8], p: &crate::lower::Prod, image: bool, g: &Lowered) -> bool {
    let index = g.prods.iter().position(|q| std::ptr::eq(p, q)).unwrap();
    mark(out, index, image)
}
fn add(out: &mut [u8], p: &crate::lower::Prod, span: &Span, image: bool, g: &Lowered, recipe: bool) -> bool {
    match span {
        Span::Whole if recipe || !g.rules[p.rule as usize].helper => own(out, p, image, g),
        Span::Whole => {
            let mut changed = false;
            for q in &g.prods {
                if !g.rules[q.rule as usize].helper && q.owner == p.owner && q.at == p.at && q.document == p.document {
                    changed = own(out, q, image, g) || changed;
                }
            }
            changed
        }
        Span::Cap(slot) => match p.syms[p.cap_pos[*slot as usize]] {
            Sym::N(rule) => named(out, rule, image, g),
            _ => false,
        },
        Span::Lexical(name) => {
            let mut changed = false;
            for q in &g.prods {
                if q.owner != p.owner || q.at != p.at || q.document != p.document {
                    continue;
                }
                if let Some(&slot) = q.names.get(name) {
                    changed = add(out, q, &Span::Cap(slot), image, g, recipe) || changed;
                }
            }
            changed
        }
        _ => false,
    }
}
fn term_reads(t: &LTerm, out: &mut Vec<(Span, bool)>) {
    match t {
        LTerm::Emitted(span, image) => out.push((span.clone(), *image)),
        LTerm::Concat(xs) | LTerm::Union(xs) | LTerm::Inter(xs) => {
            for t in xs {
                term_reads(t, out);
            }
        }
        LTerm::Diff(a, b) | LTerm::Split(a, b) => {
            term_reads(a, out);
            term_reads(b, out);
        }
        LTerm::Ngrams(a, _) | LTerm::Classify(a, _) => term_reads(a, out),
        LTerm::If(c, t) => {
            compiled_reads(c, out);
            term_reads(t, out);
        }
        _ => {}
    }
}
fn compiled_reads(c: &LCond, out: &mut Vec<(Span, bool)>) {
    match c {
        LCond::Cmp(_, a, b) => {
            term_reads(a, out);
            term_reads(b, out);
        }
        LCond::Not(c) => compiled_reads(c, out),
        LCond::Any(xs) | LCond::All(xs) => {
            for c in xs {
                compiled_reads(c, out);
            }
        }
        LCond::If(a, b) => {
            compiled_reads(a, out);
            compiled_reads(b, out);
        }
        _ => {}
    }
}
fn effective_conditions(g: &Lowered) -> impl Iterator<Item = (&crate::lower::Prod, &LCond)> {
    let ordinary = g.prods.iter().flat_map(|p| p.conds.iter().map(move |(c, _)| (p, c)));
    let deferred = g.ranked.plans.iter().flat_map(|((production, _, _, _), plan)| {
        let p = &g.prods[*production as usize];
        plan.conditions.iter().flatten().map(move |(c, _)| (p, c))
    });
    ordinary.chain(deferred)
}
pub(super) fn demands(g: &Lowered) -> Vec<u8> {
    fn recipe(t: &Term, p: &crate::lower::Prod, out: &mut [u8], g: &Lowered) -> bool {
        let mut changed = false;
        if let Term::Call(name, args) = t {
            if let ("value" | "image", [Arg::Term(Term::Call(method, args))]) = (name.as_str(), &args[..]) {
                if let ("emitted", [Arg::Term(Term::Capture(capture))]) = (method.as_str(), &args[..]) {
                    let span = if capture.is_empty() {
                        Some(Span::Whole)
                    } else {
                        Some(
                            p.names
                                .get(capture)
                                .map_or_else(|| Span::Lexical(capture.clone()), |&slot| Span::Cap(slot)),
                        )
                    };
                    if let Some(span) = span {
                        changed = add(out, p, &span, name == "image", g, true)
                    }
                }
            }
            for arg in args {
                if let Arg::Term(t) = arg {
                    changed = recipe(t, p, out, g) || changed
                }
            }
        }
        changed
    }
    let mut out = vec![0; g.prods.len()];
    for (p, c) in effective_conditions(g) {
        let mut reads = Vec::new();
        compiled_reads(c, &mut reads);
        for (span, image) in reads {
            add(&mut out, p, &span, image, g, false);
        }
    }
    let mut changed = true;
    while changed {
        changed = false;
        for (index, p) in g.prods.iter().enumerate() {
            for channel in 0..2 {
                if out[index] & (1 << channel) == 0 || p.erased {
                    continue;
                }
                let selected = if channel == 0 {
                    p.strings.value.as_ref()
                } else {
                    p.strings.image.as_ref().or(p.strings.value.as_ref())
                };
                if let Some(t) = selected {
                    changed = recipe(t, p, &mut out, g) || changed
                } else {
                    for s in &p.syms {
                        if let Sym::N(r) = s {
                            changed = named(&mut out, *r, channel == 1, g) || changed;
                        }
                    }
                }
            }
        }
    }
    out
}

impl<'g, 's, 'a> Recognizer<'g, 's, 'a> {
    pub(super) fn enclosing_strings(
        &mut self,
        frame: &Frame<'_>,
        tokens: &[Tok],
        base: usize,
    ) -> Result<u32, EngineError> {
        let Some(enclosing) = frame.lexical else { return Ok(frame.emitted) };
        let root = &self.g.prods[enclosing.root as usize];
        let mut captured = enclosing.captures.clone();
        let current = &self.g.prods[frame.prod as usize];
        for (name, &slot) in &current.names {
            captured.insert(name.clone(), frame.caps.get(slot));
        }
        let mut chart = Chart::default();
        let mut bound = enclosing.clone();
        bound.captures = captured.clone();
        chart.lexical.push(bound);
        let empty = Cap {
            emitted: 0,
            boundary: 0,
            close_requested: false,
            start: frame.origin,
            end: frame.origin,
            tags: 0,
            structure: u32::MAX,
        };
        let mut parts = vec![empty; root.cap_pos.len()];
        for (name, &slot) in &root.names {
            if let Some(&part) = captured.get(name) {
                parts[slot as usize] = part;
            }
        }
        let mut caps = 0;
        for part in parts {
            caps = chart.extend_caps(caps, part);
        }
        let mut values = self.shared.string_states[enclosing.emitted as usize].clone();
        for (channel, text) in values.iter_mut().enumerate() {
            text.push_str(&self.shared.string_states[frame.emitted as usize][channel]);
        }
        let mut item = Item {
            emitted: self.intern_strings(values),
            boundary: 0,
            close_requested: false,
            lexical: 1,
            prod: enclosing.root,
            dot: root.syms.len() as u32,
            origin: enclosing.origin,
            caps,
            prefix: 0,
            structure: u32::MAX,
        };
        self.finish_strings(&chart, &mut item, frame.end as usize, tokens, base)?;
        Ok(item.emitted)
    }
    pub(super) fn intern_strings(&mut self, values: [String; 2]) -> u32 {
        if values.iter().all(String::is_empty) {
            return 0;
        }
        if let Some(&id) = self.shared.string_ids.get(&values) {
            return id;
        }
        let id = self.shared.string_states.len() as u32;
        self.shared.string_ids.insert(values.clone(), id);
        self.shared.string_states.push(values);
        id
    }
    pub(super) fn advance_strings(&mut self, item: Item, cap: Cap) -> u32 {
        let mask = self.g.prepared.get().unwrap().strings.get(item.prod as usize).copied().unwrap_or(0);
        if mask == 0 {
            return 0;
        }
        let mut values = self.shared.string_states[item.emitted as usize].clone();
        for (i, value) in values.iter_mut().enumerate() {
            let p = &self.g.prods[item.prod as usize];
            let recipe =
                if i == 0 { p.strings.value.as_ref() } else { p.strings.image.as_ref().or(p.strings.value.as_ref()) };
            if mask & (1 << i) != 0 && !p.erased && recipe.is_none() {
                value.push_str(&self.shared.string_states[cap.emitted as usize][i]);
            }
        }
        self.intern_strings(values)
    }
    pub(super) fn finish_strings(
        &mut self,
        chart: &Chart,
        item: &mut Item,
        end: usize,
        tokens: &[Tok],
        base: usize,
    ) -> Result<(), EngineError> {
        let p = &self.g.prods[item.prod as usize];
        let mask = self.g.prepared.get().unwrap().strings.get(item.prod as usize).copied().unwrap_or(0);
        if mask == 0 || item.dot as usize != p.syms.len() {
            return Ok(());
        }
        let mut saved: [Option<String>; 2] = [None, None];
        let mut active = [false; 2];
        let values = [
            if mask & 1 != 0 {
                self.completed_string(chart, *item, end, tokens, base, 0, &mut saved, &mut active)?
            } else {
                String::new()
            },
            if mask & 2 != 0 {
                self.completed_string(chart, *item, end, tokens, base, 1, &mut saved, &mut active)?
            } else {
                String::new()
            },
        ];
        item.emitted = self.intern_strings(values);
        Ok(())
    }
    #[allow(clippy::too_many_arguments)]
    fn completed_string(
        &self,
        chart: &Chart,
        item: Item,
        end: usize,
        tokens: &[Tok],
        base: usize,
        channel: usize,
        saved: &mut [Option<String>; 2],
        active: &mut [bool; 2],
    ) -> Result<String, EngineError> {
        if let Some(value) = &saved[channel] {
            return Ok(value.clone());
        }
        if active[channel] {
            return Err(EngineError { message: "a selected string recipe has a dependency cycle".into(), rule: None });
        }
        active[channel] = true;
        let p = &self.g.prods[item.prod as usize];
        let rule = &self.g.rules[p.rule as usize];
        let selected =
            if channel == 0 { p.strings.value.as_ref() } else { p.strings.image.as_ref().or(p.strings.value.as_ref()) };
        let value = if rule.elided.is_some() && p.syms.is_empty() {
            if channel == 0 {
                if end > item.origin as usize {
                    tokens[item.origin as usize].value.clone()
                } else {
                    rule.elided_value.clone().unwrap_or_default()
                }
            } else {
                String::new()
            }
        } else if p.erased {
            String::new()
        } else if let Some(recipe) = selected {
            self.recipe_string(chart, item, end, tokens, base, recipe, saved, active)?
        } else {
            self.shared.string_states[item.emitted as usize][channel].clone()
        };
        active[channel] = false;
        saved[channel] = Some(value.clone());
        Ok(value)
    }
    #[allow(clippy::too_many_arguments)]
    fn recipe_string(
        &self,
        chart: &Chart,
        item: Item,
        end: usize,
        tokens: &[Tok],
        base: usize,
        term: &Term,
        saved: &mut [Option<String>; 2],
        active: &mut [bool; 2],
    ) -> Result<String, EngineError> {
        let p = &self.g.prods[item.prod as usize];
        let Term::Call(method, args) = term else {
            return Ok(if let Term::Str(s) = term { s.clone() } else { String::new() });
        };
        if method == "concat" {
            let mut value = String::new();
            for arg in args {
                if let Arg::Term(t) = arg {
                    value.push_str(&self.recipe_string(chart, item, end, tokens, base, t, saved, active)?);
                }
            }
            return Ok(value);
        }
        let [Arg::Term(receiver)] = &args[..] else { unreachable!("a recipe method has one receiver") };
        let (capture, emitted) = match receiver {
            Term::Capture(name) => (name, false),
            Term::Call(name, args) if name == "emitted" => {
                let [Arg::Term(Term::Capture(name))] = &args[..] else { unreachable!() };
                (name, true)
            }
            _ => unreachable!(),
        };
        let channel = usize::from(method == "image");
        if emitted && capture.is_empty() {
            return self.completed_string(chart, item, end, tokens, base, channel, saved, active);
        }
        let cap = if capture.is_empty() {
            None
        } else {
            p.names
                .get(capture)
                .map(|&slot| chart.cap_at(item.caps, slot).0)
                .or_else(|| chart.lexical_frame(item.lexical).and_then(|f| f.captures.get(capture)).copied())
        };
        if emitted {
            return Ok(cap.map_or_else(String::new, |c| self.shared.string_states[c.emitted as usize][channel].clone()));
        }
        let (start, end) = cap.map_or((item.origin as usize, end), |c| (c.start as usize, c.end as usize));
        let (observed, start, end) = self
            .recon
            .map_or((tokens, start, end), |r| (r.observed, r.project[start] as usize, r.project[end] as usize));
        Ok(match method.as_str() {
            "value" => observed[start..end].iter().map(|t| t.value.as_str()).collect(),
            "image" => observed[start..end].iter().map(|t| t.image.as_str()).collect(),
            "text" => self.text(observed, start, end),
            "decomposed-source-text" => {
                self.shared.unicode.decompose(&self.text(observed, start, end).chars().collect::<Vec<_>>())
            }
            _ => unreachable!("a recipe uses a string method"),
        })
    }
}

fn emitted_reads(conditions: &[crate::dom::Cond], recipe: Option<&Term>) -> Vec<(String, bool)> {
    fn term(t: &Term, out: &mut Vec<(String, bool)>) {
        if let Term::Call(name, args) = t {
            if let ("value" | "image", [Arg::Term(Term::Call(method, args))]) = (name.as_str(), &args[..]) {
                if let ("emitted", [Arg::Term(Term::Capture(capture))]) = (method.as_str(), &args[..]) {
                    out.push((capture.clone(), name == "image"));
                    return;
                }
            }
            for a in args {
                if let Arg::Term(t) = a {
                    term(t, out);
                }
            }
        }
        match t {
            Term::If(c, t) => {
                condition(c, out);
                term(t, out);
            }
            Term::Union(xs) | Term::Intersection(xs) => {
                for t in xs {
                    term(t, out);
                }
            }
            Term::Difference(a, b) => {
                term(a, out);
                term(b, out);
            }
            _ => {}
        }
    }
    fn condition(c: &crate::dom::Cond, out: &mut Vec<(String, bool)>) {
        use crate::dom::Cond;
        match c {
            Cond::Compare(_, a, b) => {
                term(a, out);
                term(b, out);
            }
            Cond::Not(c) => condition(c, out),
            Cond::Any(xs) | Cond::All(xs) => {
                for c in xs {
                    condition(c, out);
                }
            }
            Cond::If(a, b) => {
                condition(a, out);
                condition(b, out);
            }
            _ => {}
        }
    }
    let mut reads = Vec::new();
    if let Some(recipe) = recipe {
        term(recipe, &mut reads);
    }
    for c in conditions {
        condition(c, &mut reads);
    }
    reads
}
pub(crate) fn has_condition_reads(conditions: &[crate::dom::Cond]) -> bool {
    !emitted_reads(conditions, None).is_empty()
}

pub(crate) fn validate_condition_strings(grammar: &crate::grammar::StageGrammar) -> Result<(), crate::error::Error> {
    use crate::dom::Expr;
    use crate::grammar::StitchedAlternative;
    use std::collections::{BTreeMap, BTreeSet};
    fn children(expr: &Expr) -> Vec<&Expr> {
        match expr {
            Expr::Seq(xs) | Expr::Choice(xs) | Expr::Ranked(xs, _) | Expr::And(xs) => xs.iter().collect(),
            Expr::Optional(e, _, _) | Expr::Capture(_, e) | Expr::Tested(_, _, e) => vec![e],
            Expr::Repeat(e, separator, _) => std::iter::once(e.as_ref()).chain(separator.as_deref()).collect(),
            _ => Vec::new(),
        }
    }
    fn references(expr: &Expr, grammar: &crate::grammar::StageGrammar) -> BTreeSet<usize> {
        let mut names = BTreeSet::new();
        let mut pending = vec![expr];
        while let Some(expr) = pending.pop() {
            if let Expr::Ref(name) = expr {
                if let Some(&rule) = grammar.index.get(name) {
                    names.insert(rule);
                }
            }
            pending.extend(children(expr));
        }
        names
    }
    fn verbatim(t: &Term) -> bool {
        matches!(t,Term::Call(name,_) if name=="verbatim-text")
            || matches!(t,Term::Call(_,args) if args.iter().any(|a|matches!(a,Arg::Term(t) if verbatim(t))))
    }
    type Definition = (usize, Arc<str>, (usize, usize));
    let mut definitions: BTreeMap<Definition, BTreeMap<String, BTreeSet<usize>>> = BTreeMap::new();
    let mut bodies = BTreeMap::new();
    for (rule_id, rule) in grammar.rules.iter().enumerate() {
        for alt in &rule.alternatives {
            bodies.insert(alt as *const StitchedAlternative as usize, references(&alt.alternative.expr, grammar));
            let bindings = definitions.entry((rule_id, alt.document.clone(), alt.at)).or_default();
            let mut pending = vec![&alt.alternative.expr];
            while let Some(expr) = pending.pop() {
                if let Expr::Capture(name, inner) = expr {
                    bindings.entry(name.clone()).or_default().extend(references(inner, grammar));
                }
                pending.extend(children(expr));
            }
        }
    }
    let targets = |rule, alt: &StitchedAlternative, capture: &str| -> BTreeSet<usize> {
        if capture.is_empty() {
            BTreeSet::from([rule])
        } else {
            definitions[&(rule, alt.document.clone(), alt.at)].get(capture).cloned().unwrap_or_default()
        }
    };
    let reaches_verbatim = |rule, alt: &StitchedAlternative, capture: &str, image| {
        let mut pending: Vec<_> = targets(rule, alt, capture).into_iter().map(|r| (r, image)).collect();
        let mut seen = BTreeSet::new();
        while let Some((rule, image)) = pending.pop() {
            if !seen.insert((rule, image)) {
                continue;
            }
            for alt in &grammar.rules[rule].alternatives {
                if alt.erased {
                    continue;
                }
                let value = alt.alternative.strings.value.as_ref().or(alt.clauses.strings.value.as_ref());
                let recipe = if image {
                    alt.alternative.strings.image.as_ref().or(alt.clauses.strings.image.as_ref()).or(value)
                } else {
                    value
                };
                if let Some(recipe) = recipe {
                    if verbatim(recipe) {
                        return true;
                    }
                    for (capture, image) in emitted_reads(&[], Some(recipe)) {
                        pending.extend(targets(rule, alt, &capture).into_iter().map(|r| (r, image)));
                    }
                } else {
                    pending.extend(bodies[&(alt as *const StitchedAlternative as usize)].iter().map(|&r| (r, image)));
                }
            }
        }
        false
    };
    for (rule, definition) in grammar.rules.iter().enumerate() {
        for alt in &definition.alternatives {
            for (capture, image) in emitted_reads(&alt.clauses.conditions, None) {
                if reaches_verbatim(rule, alt, &capture, image) {
                    let key = format!("{capture}:{}", if image { "image" } else { "value" });
                    let mut error = crate::error::Error::grammar("a condition walk cannot reach verbatim-text")
                        .in_document(&alt.document);
                    if let Some(&(line, column)) = alt.clauses.emitted_locations.get(&key) {
                        error = error.at(line, column);
                    }
                    return Err(error);
                }
            }
        }
    }
    Ok(())
}
