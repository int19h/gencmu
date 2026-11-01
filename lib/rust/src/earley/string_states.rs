use super::*;
use crate::dom::{Arg, Term};

pub(super) fn demands(g: &Lowered) -> Vec<u8> {
    fn add(out: &mut [u8], p: &crate::lower::Prod, span: &Span, image: bool) -> bool {
        let rule = match span {
            Span::Whole => Some(p.rule),
            Span::Cap(slot) => match p.syms[p.cap_pos[*slot as usize]] {
                Sym::N(r) => Some(r),
                _ => None,
            },
            _ => None,
        };
        if let Some(rule) = rule {
            let bit = 1 << u8::from(image);
            let old = out[rule as usize];
            out[rule as usize] |= bit;
            return old != out[rule as usize];
        }
        false
    }
    fn term(t: &LTerm, p: &crate::lower::Prod, out: &mut [u8]) -> bool {
        match t {
            LTerm::Emitted(s, i) => add(out, p, s, *i),
            LTerm::Concat(xs) | LTerm::Union(xs) | LTerm::Inter(xs) => {
                let mut changed = false;
                for t in xs {
                    changed = term(t, p, out) || changed;
                }
                changed
            }
            LTerm::Diff(a, b) | LTerm::Split(a, b) => term(a, p, out) | term(b, p, out),
            LTerm::Ngrams(a, _) | LTerm::Classify(a, _) => term(a, p, out),
            LTerm::If(c, t) => cond(c, p, out) | term(t, p, out),
            _ => false,
        }
    }
    fn cond(c: &LCond, p: &crate::lower::Prod, out: &mut [u8]) -> bool {
        match c {
            LCond::Cmp(_, a, b) => term(a, p, out) | term(b, p, out),
            LCond::Not(c) => cond(c, p, out),
            LCond::Any(xs) | LCond::All(xs) => {
                let mut changed = false;
                for c in xs {
                    changed = cond(c, p, out) || changed;
                }
                changed
            }
            LCond::If(a, b) => cond(a, p, out) | cond(b, p, out),
            _ => false,
        }
    }
    fn recipe(t: &Term, p: &crate::lower::Prod, out: &mut [u8]) -> bool {
        let mut changed = false;
        if let Term::Call(name, args) = t {
            if let ("value" | "image", [Arg::Term(Term::Call(method, args))]) = (name.as_str(), &args[..]) {
                if let ("emitted", [Arg::Term(Term::Capture(capture))]) = (method.as_str(), &args[..]) {
                    let span = if capture.is_empty() {
                        Some(Span::Whole)
                    } else {
                        p.names.get(capture).map(|&slot| Span::Cap(slot))
                    };
                    if let Some(span) = span {
                        changed = add(out, p, &span, name == "image")
                    }
                }
            }
            for arg in args {
                if let Arg::Term(t) = arg {
                    changed = recipe(t, p, out) || changed
                }
            }
        }
        changed
    }
    let mut out = vec![0; g.rules.len()];
    for p in &g.prods {
        for (c, _) in &p.conds {
            cond(c, p, &mut out);
        }
    }
    let mut changed = true;
    while changed {
        changed = false;
        for p in &g.prods {
            for channel in 0..2 {
                if out[p.rule as usize] & (1 << channel) == 0 || p.erased {
                    continue;
                }
                let selected = if channel == 0 {
                    p.strings.value.as_ref()
                } else {
                    p.strings.image.as_ref().or(p.strings.value.as_ref())
                };
                if let Some(t) = selected {
                    changed = recipe(t, p, &mut out) || changed
                } else {
                    for s in &p.syms {
                        if let Sym::N(r) = s {
                            let old = out[*r as usize];
                            out[*r as usize] |= 1 << channel;
                            changed |= old != out[*r as usize]
                        }
                    }
                }
            }
        }
    }
    out
}

impl<'g, 's, 'a> Recognizer<'g, 's, 'a> {
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
        let mask = self.g.prepared.get().unwrap().strings[self.g.prods[item.prod as usize].rule as usize];
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
        let mask = self.g.prepared.get().unwrap().strings[p.rule as usize];
        if mask == 0 || item.dot as usize != p.syms.len() {
            return Ok(());
        }
        let mut saved: [Option<String>; 2] = [None, None];
        let mut active = [false; 2];
        let mut gaps = None;
        let values = [
            if mask & 1 != 0 {
                self.completed_string(chart, *item, end, tokens, base, 0, &mut saved, &mut active, &mut gaps)?
            } else {
                String::new()
            },
            if mask & 2 != 0 {
                self.completed_string(chart, *item, end, tokens, base, 1, &mut saved, &mut active, &mut gaps)?
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
        gaps: &mut Option<crate::strings::GapClaims>,
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
            self.recipe_string(chart, item, end, tokens, base, recipe, saved, active, gaps)?
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
        gaps: &mut Option<crate::strings::GapClaims>,
    ) -> Result<String, EngineError> {
        let p = &self.g.prods[item.prod as usize];
        let Term::Call(method, args) = term else {
            return Ok(if let Term::Str(s) = term { s.clone() } else { String::new() });
        };
        if method == "concat" {
            let mut value = String::new();
            for arg in args {
                if let Arg::Term(t) = arg {
                    value.push_str(&self.recipe_string(chart, item, end, tokens, base, t, saved, active, gaps)?);
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
            return self.completed_string(chart, item, end, tokens, base, channel, saved, active, gaps);
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
            "verbatim-text" => gaps
                .get_or_insert_with(|| {
                    crate::strings::GapClaims::with_sources(&self.shared.string_sources, self.shared.text.len())
                })
                .string(
                    (
                        start + if self.recon.is_some() { 0 } else { base },
                        end + if self.recon.is_some() { 0 } else { base },
                    ),
                    self.shared.text,
                )?,
            _ => unreachable!("a recipe uses a string method"),
        })
    }
}
