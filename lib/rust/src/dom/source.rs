//! Typed source symbols before template expansion (engine §2.3).
use super::{
    array, expr_from_json, position, requirements_from_json, string, term_from_json, write_expr, write_requirements,
    write_str, write_term, Expr, Term, R,
};
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
            } else if ["test", "range", "wildcard"].iter().any(|key| arg.get(key).is_some()) {
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
    pub(crate) fn write(&self, out: &mut String) {
        out.push('{');
        self.write_fields(out);
        out.push('}');
    }

    pub(crate) fn write_fields(&self, out: &mut String) {
        self.write_atom_fields(out);
        let at = self.at();
        out.push_str(&format!(",\"at\":[{},{}]", at.0, at.1));
    }

    pub(crate) fn at(&self) -> (usize, usize) {
        match self {
            Self::Parameter(_, at) => *at,
            Self::Call(call) => call.at,
        }
    }

    pub(crate) fn write_atom_fields(&self, out: &mut String) {
        match self {
            Self::Parameter(name, _) => {
                out.push_str("\"param\":");
                write_str(out, name);
            }
            Self::Call(call) => call.write_atom_fields(out),
        }
    }
}

impl SourceCall {
    pub(crate) fn write(&self, out: &mut String) {
        out.push('{');
        self.write_fields(out);
        out.push('}');
    }

    fn write_fields(&self, out: &mut String) {
        self.write_atom_fields(out);
        out.push_str(&format!(",\"at\":[{},{}]", self.at.0, self.at.1));
    }

    fn write_atom_fields(&self, out: &mut String) {
        out.push_str("\"call\":");
        write_str(out, &self.name);
        out.push_str(",\"args\":");
        write_arguments(out, &self.args);
    }
}

pub(crate) fn write_arguments(out: &mut String, args: &[SourceArgument]) {
    out.push('[');
    for (index, arg) in args.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        match arg {
            SourceArgument::Term(term) => write_term(out, term),
            SourceArgument::WrappedBody(expr) => {
                out.push_str("{\"body\":");
                write_expr(out, expr);
                out.push('}');
            }
            SourceArgument::Body(expr) => match expr {
                Expr::Ref(name) | Expr::Terminal(name) => {
                    let rule =
                        matches!(expr, Expr::Ref(_)) && !name.starts_with(|c: char| c.is_ascii_uppercase() || c == '_');
                    out.push_str(if rule { "{\"rule\":" } else { "{\"tag\":" });
                    write_str(out, name);
                    out.push('}');
                }
                Expr::Literal(term) => write_term(out, term),
                Expr::Source(_) | Expr::Tested(..) | Expr::ScalarRange(..) | Expr::Wildcard => write_expr(out, expr),
                _ => {
                    out.push_str("{\"body\":");
                    write_expr(out, expr);
                    out.push('}');
                }
            },
            SourceArgument::Requirements(term) => {
                out.push_str("{\"requirements\":");
                write_requirements(out, term);
                out.push('}');
            }
            SourceArgument::Targets(targets) => {
                out.push_str("{\"targets\":");
                write_targets(out, targets);
                out.push('}');
            }
        }
    }
    out.push(']');
}

pub(crate) fn write_targets(out: &mut String, targets: &[SourceTarget]) {
    out.push('[');
    for (index, target) in targets.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        match target {
            SourceTarget::Symbol(symbol) => symbol.write(out),
            SourceTarget::Rule(name) | SourceTarget::Terminal(name) => {
                out.push_str(if matches!(target, SourceTarget::Rule(_)) { "{\"rule\":" } else { "{\"terminal\":" });
                write_str(out, name);
                out.push('}');
            }
        }
    }
    out.push(']');
}
