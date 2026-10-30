//! Typed source symbols before template expansion (engine §2.3).
use super::{write_expr, write_requirements, write_str, write_term, Expr, Term};

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
        match self {
            Self::Parameter(name, at) => {
                out.push_str("\"param\":");
                write_str(out, name);
                out.push_str(&format!(",\"at\":[{},{}]", at.0, at.1));
            }
            Self::Call(call) => call.write_fields(out),
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
        out.push_str("\"call\":");
        write_str(out, &self.name);
        out.push_str(",\"args\":");
        write_arguments(out, &self.args);
        out.push_str(&format!(",\"at\":[{},{}]", self.at.0, self.at.1));
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
            SourceArgument::Body(expr) => match expr {
                Expr::Ref(name) | Expr::Terminal(name) => {
                    let rule =
                        matches!(expr, Expr::Ref(_)) && !name.starts_with(|c: char| c.is_ascii_uppercase() || c == '_');
                    out.push_str(if rule { "{\"rule\":" } else { "{\"tag\":" });
                    write_str(out, name);
                    out.push('}');
                }
                Expr::Literal(term) => write_term(out, term),
                Expr::Source(_) | Expr::Tested(..) | Expr::ScalarRange(..) | Expr::Property(_) => write_expr(out, expr),
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
