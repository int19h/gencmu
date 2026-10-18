//! Conditions evaluated on stage input before recognition.
use crate::dom::{Arg, Cond, Term, Type};
use crate::result::Token;
use crate::unicode::Unicode;
use std::collections::BTreeSet;

pub(crate) fn problem(conditions: &[Cond]) -> Result<(), String> {
    fn term(value: &Term) -> Result<(), String> {
        match value {
            Term::Capture(name) if !name.is_empty() => Err("feature conditions can read only $".into()),
            Term::Call(name, args) => {
                if !matches!(
                    name.as_str(),
                    "tags"
                        | "classes"
                        | "value"
                        | "image"
                        | "text"
                        | "decomposed-source-text"
                        | "head"
                        | "tail"
                        | "last"
                        | "split"
                        | "ngrams"
                        | "interpolate"
                ) || name == "tags" && args.len() != 1
                {
                    return Err("feature conditions can read only tokens".into());
                }
                for arg in args {
                    if let Arg::Term(value) = arg {
                        term(value)?;
                    }
                }
                Ok(())
            }
            Term::Union(items) | Term::Intersection(items) => {
                for value in items {
                    term(value)?;
                }
                Ok(())
            }
            Term::Difference(left, right) => {
                term(left)?;
                term(right)
            }
            Term::If(condition, value) => {
                cond(condition)?;
                term(value)
            }
            _ => Ok(()),
        }
    }
    fn cond(value: &Cond) -> Result<(), String> {
        match value {
            Cond::Compare(op, left, right) if !matches!(op.as_str(), "≅" | "≇") => {
                term(left)?;
                term(right)
            }
            Cond::Not(inner) => cond(inner),
            Cond::Any(items) | Cond::All(items) => {
                for value in items {
                    cond(value)?;
                }
                Ok(())
            }
            Cond::If(left, right) => {
                cond(left)?;
                cond(right)
            }
            Cond::Captured(name) if name.is_empty() => Ok(()),
            _ => Err("feature conditions can read only tokens".into()),
        }
    }
    for condition in conditions {
        cond(condition)?;
        if let Some(fault) = crate::dom::cond_type_fault(condition, &|_| Type::Any) {
            return Err(fault.problem);
        }
    }
    Ok(())
}

#[derive(PartialEq)]
enum Value {
    Str(String),
    Set(BTreeSet<String>),
}
impl Value {
    fn string(self) -> Result<String, String> {
        if let Self::Str(text) = self {
            Ok(text)
        } else {
            Err("expected a string".into())
        }
    }
    fn set(self) -> Result<BTreeSet<String>, String> {
        match self {
            Self::Set(set) => Ok(set),
            Self::Str(s) => Ok(BTreeSet::from([s])),
        }
    }
}
struct Input<'a> {
    tokens: &'a [Token],
    text: &'a [char],
    unicode: &'a Unicode,
}
impl Input<'_> {
    fn argument<'a>(&self, args: &'a [Arg], index: usize) -> &'a Term {
        match &args[index] {
            Arg::Term(term) => term,
            _ => unreachable!("validated token method"),
        }
    }
    fn span(&self, term: &Term) -> (usize, usize) {
        match term {
            Term::Capture(_) => (0, self.tokens.len()),
            Term::Call(name, args) => {
                let (start, end) = self.span(self.argument(args, 0));
                match name.as_str() {
                    "head" => (start, (start + 1).min(end)),
                    "tail" => ((start + 1).min(end), end),
                    "last" => (end.saturating_sub(1).max(start), end),
                    _ => unreachable!("validated span method"),
                }
            }
            _ => unreachable!("validated span"),
        }
    }
    fn values(&self, term: &Term) -> String {
        let (start, end) = self.span(term);
        self.tokens[start..end].iter().map(|token| token.value.as_str()).collect()
    }
    fn value(&self, term: &Term) -> Result<Value, String> {
        Ok(match term {
            Term::Str(text) => Value::Str(text.clone()),
            Term::Tag(tag) => Value::Set([tag.clone()].into_iter().collect()),
            Term::EmptySet => Value::Set(BTreeSet::new()),
            Term::Capture(_) => Value::Str(self.values(term)),
            Term::Union(items) => {
                let mut set = BTreeSet::new();
                for item in items {
                    set.extend(self.value(item)?.set()?);
                }
                Value::Set(set)
            }
            Term::Intersection(items) => {
                let mut set = self.value(&items[0])?.set()?;
                for item in &items[1..] {
                    let right = self.value(item)?.set()?;
                    set.retain(|value| right.contains(value));
                }
                Value::Set(set)
            }
            Term::Difference(left, right) => {
                let mut set = self.value(left)?.set()?;
                let right = self.value(right)?.set()?;
                set.retain(|value| !right.contains(value));
                Value::Set(set)
            }
            Term::If(condition, value) => {
                if self.condition(condition)? {
                    self.value(value)?
                } else {
                    Value::Set(BTreeSet::new())
                }
            }
            Term::Call(name, args) => {
                let receiver = self.argument(args, 0);
                match name.as_str() {
                    "interpolate" => {
                        let mut text = String::new();
                        for argument in args {
                            if let Arg::Term(term) = argument {
                                text.push_str(&self.value(term)?.string()?);
                            }
                        }
                        Value::Str(text)
                    }
                    "ngrams" => {
                        let text = self.value(receiver)?.string()?;
                        let Arg::Integer(n) = &args[1] else { unreachable!() };
                        Value::Set(crate::dom::ngrams(&text, n).into_iter().collect())
                    }
                    "split" => {
                        let text = self.value(receiver)?.string()?;
                        let delimiter = self.value(self.argument(args, 1))?.string()?;
                        if delimiter.is_empty() {
                            return Err("split has an empty delimiter".into());
                        }
                        Value::Set(
                            text.split(&delimiter).filter(|piece| !piece.is_empty()).map(str::to_string).collect(),
                        )
                    }
                    "tags" | "classes" => {
                        let (start, end) = self.span(receiver);
                        let mut set: BTreeSet<String> =
                            self.tokens[start..end].iter().flat_map(|token| token.tags.iter().cloned()).collect();
                        if name == "classes" {
                            set.retain(|tag| {
                                tag.starts_with(|c: char| c.is_ascii_uppercase())
                                    && tag.ends_with(|c: char| c.is_ascii_uppercase())
                            });
                        }
                        Value::Set(set)
                    }
                    "value" => Value::Str(self.values(receiver)),
                    "image" => {
                        let (start, end) = self.span(receiver);
                        Value::Str(self.tokens[start..end].iter().map(|token| token.image.as_str()).collect())
                    }
                    "text" | "decomposed-source-text" => {
                        let (start, end) = self.span(receiver);
                        let chars = if start == end {
                            &[][..]
                        } else {
                            let tokens = &self.tokens[start..end];
                            let from = tokens.iter().map(|token| token.source.start).min().unwrap();
                            let to = tokens.iter().map(|token| token.source.end).max().unwrap();
                            &self.text[from..to]
                        };
                        Value::Str(if name == "decomposed-source-text" {
                            self.unicode.decompose(chars)
                        } else {
                            chars.iter().collect()
                        })
                    }
                    "head" | "tail" | "last" => Value::Str(self.values(term)),
                    _ => unreachable!("validated token method"),
                }
            }
            _ => unreachable!("bound feature condition"),
        })
    }
    fn condition(&self, condition: &Cond) -> Result<bool, String> {
        Ok(match condition {
            Cond::Captured(_) => true,
            Cond::Not(inner) => !self.condition(inner)?,
            Cond::Any(items) => {
                let mut held = false;
                for item in items {
                    if self.condition(item)? {
                        held = true;
                        break;
                    }
                }
                held
            }
            Cond::All(items) => {
                let mut held = true;
                for item in items {
                    if !self.condition(item)? {
                        held = false;
                        break;
                    }
                }
                held
            }
            Cond::If(left, right) => !self.condition(left)? || self.condition(right)?,
            Cond::Compare(op, left, right) => {
                let left = self.value(left)?;
                let right = self.value(right)?;
                match op.as_str() {
                    "=" | "≠" => {
                        let equal = match (left, right) {
                            (Value::Str(a), Value::Str(b)) => a == b,
                            (a, b) => a.set()? == b.set()?,
                        };
                        equal == (op == "=")
                    }
                    "∈" | "∉" => right.set()?.contains(&left.string()?) == (op == "∈"),
                    "⊆" | "⊈" => left.set()?.is_subset(&right.set()?) == (op == "⊆"),
                    _ => unreachable!("validated comparison"),
                }
            }
            _ => unreachable!("validated feature condition"),
        })
    }
}
pub(crate) fn holds(conditions: &[Cond], tokens: &[Token], text: &[char], unicode: &Unicode) -> Result<bool, String> {
    let input = Input { tokens, text, unicode };
    for condition in conditions {
        if !input.condition(condition)? {
            return Ok(false);
        }
    }
    Ok(true)
}
