//! Typed source symbols before template expansion (engine §2.3).
use super::{array, expr_from_json, position, requirements_from_json, string, term_from_json, Expr, Term, R};
use crate::json::Json;
mod locations;
pub(crate) use locations::{restore_locations, restore_rule_locations};

impl SourceSymbol {
    pub(crate) fn from_json(value: &Json) -> R<Self> {
        if value.get("param").is_some() {
            Ok(Self::Parameter(string(value, "param")?, position(value)?))
        } else {
            Ok(Self::Call(SourceCall::from_json(value)?))
        }
    }
}

impl SourceCall {
    pub(crate) fn from_json(value: &Json) -> R<Self> {
        Ok(Self { name: string(value, "call")?, args: arguments_from_json(value)?, at: position(value)? })
    }
}

pub(crate) fn arguments_from_json(value: &Json) -> R<Vec<SourceArgument>> {
    array(value, "args")?
        .iter()
        .map(|arg| {
            Ok(if let Some(body) = arg.get("body") {
                SourceArgument::WrappedBody(expr_from_json(body)?)
            } else if arg.get("requirements").is_some() && arg.get("test").is_none() {
                SourceArgument::Requirements(requirements_from_json(arg)?)
            } else if arg.get("targets").is_some() {
                SourceArgument::Targets(
                    array(arg, "targets")?
                        .iter()
                        .map(|target| {
                            Ok(if target.get("rule").is_some() {
                                SourceTarget::Rule(string(target, "rule")?)
                            } else if target.get("terminal").is_some() {
                                SourceTarget::Terminal(string(target, "terminal")?)
                            } else {
                                SourceTarget::Symbol(SourceSymbol::from_json(target)?)
                            })
                        })
                        .collect::<R<Vec<_>>>()?,
                )
            } else if arg.get("rule").is_some() {
                SourceArgument::Body(Expr::Ref(string(arg, "rule")?))
            } else if ["splice", "test", "range", "wildcard"].iter().any(|key| arg.get(key).is_some()) {
                SourceArgument::Body(expr_from_json(arg)?)
            } else {
                SourceArgument::Term(term_from_json(arg)?)
            })
        })
        .collect()
}

impl SourceHead {
    pub(crate) fn from_json(value: &Json) -> R<Self> {
        Ok(Self {
            params: value
                .get("params")
                .map(|_| {
                    array(value, "params")?
                        .iter()
                        .map(|v| v.as_str().map(str::to_owned).ok_or_else(|| "a malformed parameter name".to_string()))
                        .collect::<R<Vec<_>>>()
                })
                .transpose()?,
            args: value.get("args").map(|_| arguments_from_json(value)).transpose()?,
            instance: value.get("instance").map(SourceCall::from_json).transpose()?,
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum SourceSymbol {
    Parameter(String, (usize, usize)),
    Call(SourceCall),
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SourceCall {
    pub name: String,
    pub args: Vec<SourceArgument>,
    pub at: (usize, usize),
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum SourceArgument {
    Term(Term),
    Body(Expr),
    WrappedBody(Expr),
    Requirements(Term),
    Targets(Vec<SourceTarget>),
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum SourceTarget {
    Rule(String),
    Terminal(String),
    Symbol(SourceSymbol),
}

#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct SourceHead {
    pub params: Option<Vec<String>>,
    pub args: Option<Vec<SourceArgument>>,
    pub instance: Option<SourceCall>,
}

impl SourceSymbol {
    pub(crate) fn at(&self) -> (usize, usize) {
        match self {
            Self::Parameter(_, at) => *at,
            Self::Call(call) => call.at,
        }
    }
}
impl SourceCall {
    pub(crate) fn write(&self, out: &mut String) {
        super::writing::write(out, super::writing::Part::Call(self, true, true));
    }
}
pub(crate) fn write_arguments(out: &mut String, args: &[SourceArgument]) {
    super::writing::write(out, super::writing::Part::Arguments(args));
}
