//! Static reachability for key steps (engine §6).
use crate::grammar::KeyStep;
use crate::lower::{LTerm, Lowered, Sym};
use crate::patterns::Pattern;

pub(crate) fn possible(
    pattern: &Pattern,
    name: Option<&str>,
    terminal: Option<&str>,
    omitted: bool,
    tags: Option<&[String]>,
) -> Option<bool> {
    fn and(a: Option<bool>, b: Option<bool>) -> Option<bool> {
        if a == Some(false) || b == Some(false) {
            Some(false)
        } else if a.is_none() || b.is_none() {
            None
        } else {
            Some(true)
        }
    }
    match pattern {
        Pattern::Node(inner, _, _) => possible(inner, name, terminal, omitted, tags),
        Pattern::Name(rule, _) => Some(name == Some(rule)),
        Pattern::Terminal(read, _) => Some(terminal.is_some() && (read == "_" || terminal == Some(read))),
        Pattern::Test(op, _, inner, _) => {
            let base = if matches!(inner.as_ref(), Pattern::Any) {
                Some(true)
            } else {
                possible(inner, name, terminal, omitted, tags)
            };
            if base == Some(false) {
                return base;
            }
            if op != "tags" {
                return None;
            }
            if let Some(tags) = tags {
                return Some(crate::patterns::local_matches(pattern, name, terminal.map(|t| (t, "", tags)), tags));
            }
            if crate::patterns::requires_elided(pattern) && !omitted {
                return Some(false);
            }
            if omitted {
                let names = vec![terminal.unwrap().to_owned(), "_Elided".into()];
                return Some(crate::patterns::local_matches(
                    pattern,
                    name,
                    terminal.map(|t| (t, "", names.as_slice())),
                    &names,
                ));
            }
            None
        }
        Pattern::Union(parts) => {
            let answers: Vec<_> = parts.iter().map(|p| possible(p, name, terminal, omitted, tags)).collect();
            if answers.contains(&Some(true)) {
                Some(true)
            } else if answers.contains(&None) {
                None
            } else {
                Some(false)
            }
        }
        Pattern::Intersection(parts) => {
            let mut answer = Some(true);
            for part in parts {
                answer = and(answer, possible(part, name, terminal, omitted, tags));
            }
            answer
        }
        Pattern::Difference(a, b) => {
            and(possible(a, name, terminal, omitted, tags), possible(b, name, terminal, omitted, tags).map(|v| !v))
        }
        _ => Some(false),
    }
}

pub(crate) fn can_count(g: &Lowered, steps: &[KeyStep]) -> bool {
    *g.profile_possible.get_or_init(|| {
        if g.prods.iter().any(|p| p.error.is_some()) {
            return true;
        }
        if steps.is_empty() {
            return false;
        }
        let mut pending = vec![g.start];
        let mut seen = std::collections::HashSet::new();
        let matches = |name, terminal, omitted, tags: Option<&[String]>| {
            steps.iter().any(|step| possible(&step.pattern, name, terminal, omitted, tags) != Some(false))
        };
        let mut found = false;
        while let Some(identity) = pending.pop() {
            if !seen.insert(identity) {
                continue;
            }
            let rule = &g.rules[identity as usize];
            for &id in &rule.prods {
                let production = &g.prods[id as usize];
                if !rule.helper {
                    let known = production
                        .tags
                        .as_ref()
                        .and_then(known_tags)
                        .or_else(|| (production.tags.is_none() && production.syms.len() != 1).then(Vec::new));
                    found |= matches(Some(rule.name.as_str()), None, false, known.as_deref());
                }
                if production.syms.is_empty() {
                    if let Some(terminal) = rule.elided.as_deref() {
                        found |= matches(None, Some(terminal), true, None);
                    }
                }
                for symbol in &production.syms {
                    match symbol {
                        Sym::N(id) => pending.push(*id),
                        Sym::T(id) => found |= matches(None, Some(g.terminals[*id as usize].as_str()), false, None),
                    }
                }
            }
        }
        found
    })
}

fn known_tags(term: &LTerm) -> Option<Vec<String>> {
    use std::collections::BTreeSet;
    match term {
        LTerm::Tag(tag) => Some(vec![tag.clone()]),
        LTerm::Empty => Some(Vec::new()),
        LTerm::Union(parts) | LTerm::Inter(parts) => {
            let sets: Vec<BTreeSet<String>> = parts
                .iter()
                .map(|part| known_tags(part).map(|tags| tags.into_iter().collect()))
                .collect::<Option<_>>()?;
            let mut result = sets.first().cloned().unwrap_or_default();
            for set in sets.iter().skip(1) {
                if matches!(term, LTerm::Union(_)) {
                    result.extend(set.iter().cloned());
                } else {
                    result.retain(|tag| set.contains(tag));
                }
            }
            Some(result.into_iter().collect())
        }
        LTerm::Diff(a, b) => {
            let b = known_tags(b)?;
            Some(known_tags(a)?.into_iter().filter(|tag| !b.contains(tag)).collect())
        }
        _ => None,
    }
}
