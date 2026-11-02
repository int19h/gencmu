//! A shared heap stack writes native nodes before the DOM depth check.
use super::source::{SourceArgument, SourceCall, SourceSymbol, SourceTarget};
use super::*;
use crate::patterns::Pattern;

pub(crate) enum Part<'a> {
    Raw(String),
    Expr(&'a Expr),
    Term(&'a Term),
    Cond(&'a Cond),
    Argument(&'a Arg),
    Requirements(&'a Term),
    Pattern(&'a Pattern),
    Symbol(&'a SourceSymbol, bool, bool),
    Call(&'a SourceCall, bool, bool),
    Arguments(&'a [SourceArgument]),
    Targets(&'a [SourceTarget]),
}

#[derive(Default)]
pub(crate) struct Pieces<'a> {
    parts: Vec<Part<'a>>,
}
impl<'a> Pieces<'a> {
    fn text(&mut self) -> &mut String {
        if !matches!(self.parts.last(), Some(Part::Raw(_))) {
            self.parts.push(Part::Raw(String::new()));
        }
        let Some(Part::Raw(text)) = self.parts.last_mut() else { unreachable!() };
        text
    }
    pub(crate) fn quote(&mut self, text: &str) {
        crate::json::write_str(self.text(), text);
    }
    pub(crate) fn push_str(&mut self, text: &str) {
        self.text().push_str(text);
    }
    pub(crate) fn push(&mut self, ch: char) {
        self.text().push(ch);
    }
    pub(crate) fn term(&mut self, term: &'a Term) {
        self.parts.push(Part::Term(term));
    }
    pub(crate) fn requirements(&mut self, term: &'a Term) {
        self.parts.push(Part::Requirements(term));
    }
    pub(crate) fn symbol_fields(&mut self, symbol: &'a SourceSymbol) {
        self.parts.push(Part::Symbol(symbol, false, false));
    }
}

pub(crate) fn write(out: &mut String, root: Part<'_>) {
    let mut pending = vec![root];
    while let Some(part) = pending.pop() {
        let mut pieces = Pieces::default();
        match part {
            Part::Raw(text) => {
                out.push_str(&text);
                continue;
            }
            Part::Expr(expr) => emit_expr(&mut pieces, expr),
            Part::Term(term) => emit_term(&mut pieces, term),
            Part::Cond(cond) => emit_cond(&mut pieces, cond),
            Part::Argument(arg) => emit_argument(&mut pieces, arg),
            Part::Requirements(term) => emit_requirements(&mut pieces, term),
            Part::Pattern(pattern) => crate::patterns::emit_pattern(&mut pieces, pattern),
            Part::Symbol(symbol, wrap, at) => {
                if wrap {
                    pieces.push('{');
                }
                match symbol {
                    SourceSymbol::Parameter(name, _) => {
                        pieces.push_str("\"param\":");
                        write_str(&mut pieces, name);
                    }
                    SourceSymbol::Call(call) => emit_call_fields(&mut pieces, call),
                }
                if at {
                    let (line, column) = symbol.at();
                    pieces.push_str(&format!(",\"at\":[{line},{column}]"));
                }
                if wrap {
                    pieces.push('}');
                }
            }
            Part::Call(call, wrap, at) => {
                if wrap {
                    pieces.push('{');
                }
                emit_call_fields(&mut pieces, call);
                if at {
                    pieces.push_str(&format!(",\"at\":[{},{}]", call.at.0, call.at.1));
                }
                if wrap {
                    pieces.push('}');
                }
            }
            Part::Arguments(args) => emit_source_arguments(&mut pieces, args),
            Part::Targets(targets) => emit_source_targets(&mut pieces, targets),
        }
        pending.extend(pieces.parts.into_iter().rev());
    }
}
fn write_str(out: &mut Pieces<'_>, text: &str) {
    crate::json::write_str(out.text(), text);
}
fn write_expr<'a>(out: &mut Pieces<'a>, value: &'a Expr) {
    out.parts.push(Part::Expr(value));
}
fn write_term<'a>(out: &mut Pieces<'a>, value: &'a Term) {
    out.term(value);
}
fn write_cond<'a>(out: &mut Pieces<'a>, value: &'a Cond) {
    out.parts.push(Part::Cond(value));
}
fn write_argument<'a>(out: &mut Pieces<'a>, value: &'a Arg) {
    out.parts.push(Part::Argument(value));
}
fn write_requirements<'a>(out: &mut Pieces<'a>, value: &'a Term) {
    out.requirements(value);
}
fn write_targets<'a>(out: &mut Pieces<'a>, value: &'a [SourceTarget]) {
    out.parts.push(Part::Targets(value));
}
fn emit_call_fields<'a>(out: &mut Pieces<'a>, call: &'a SourceCall) {
    out.push_str("\"call\":");
    write_str(out, &call.name);
    out.push_str(",\"args\":");
    out.parts.push(Part::Arguments(&call.args));
}
fn write_list<'a, T>(out: &mut Pieces<'a>, key: &str, items: &'a [T], write: fn(&mut Pieces<'a>, &'a T)) {
    out.push_str("{\"");
    out.push_str(key);
    out.push_str("\":[");
    for (index, item) in items.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        write(out, item);
    }
    out.push_str("]}");
}

fn emit_expr<'a>(out: &mut Pieces<'a>, expr: &'a Expr) {
    match expr {
        Expr::Source(symbol) => out.parts.push(Part::Symbol(symbol, true, true)),
        Expr::Seq(items) => write_list(out, "seq", items, write_expr),
        Expr::Choice(items) => write_list(out, "choice", items, write_expr),
        Expr::Ranked(items, _) => write_list(out, "ranked", items, write_expr),
        Expr::And(items) => write_list(out, "and", items, write_expr),
        Expr::Optional(inner, mark, default) => {
            out.push_str("{\"optional\":");
            write_expr(out, inner);
            if *mark == Mark::Elidable {
                out.push_str(",\"elidable\":true");
            }
            if let Some(default) = default {
                out.push_str(",\"default\":");
                write_term(out, &default.term);
            }
            out.push('}');
        }
        Expr::Repeat(item, separator, chain) => {
            out.push_str("{\"repeat\":");
            write_expr(out, item);
            if let Some(separator) = separator {
                out.push_str(",\"separator\":");
                write_expr(out, separator);
            }
            out.push_str(match chain {
                None => "}",
                Some(Chain::Left) => ",\"chain\":\"left\"}",
                Some(Chain::Right) => ",\"chain\":\"right\"}",
            });
        }
        Expr::Ref(name) => {
            out.push_str("{\"ref\":");
            write_str(out, name);
            out.push('}');
        }
        Expr::Terminal(name) => {
            out.push_str("{\"terminal\":");
            write_str(out, name);
            out.push('}');
        }
        Expr::Literal(term) => {
            out.push_str("{\"literal\":");
            write_term(out, term);
            out.push('}');
        }
        Expr::ScalarRange(start, end) => {
            out.push_str("{\"range\":[");
            write_term(out, start);
            out.push(',');
            write_term(out, end);
            out.push_str("]}");
        }
        Expr::Range(start, end) => write_range(out, *start, *end),
        Expr::Wildcard => out.push_str("{\"wildcard\":true}"),
        Expr::Capture(name, inner) => {
            out.push_str("{\"capture\":");
            write_str(out, name);
            out.push_str(",\"expr\":");
            write_expr(out, inner);
            out.push('}');
        }
        Expr::Tested(op, value, inner) => {
            out.push_str("{\"test\":");
            write_str(out, op);
            if op == "tags" {
                out.push_str(",\"requirements\":");
                write_requirements(out, value);
            } else {
                out.push_str(",\"value\":");
                write_term(out, value);
            }
            out.push_str(",\"expr\":");
            write_expr(out, inner);
            out.push('}');
        }
        Expr::Empty => out.push_str("{\"empty\":true}"),
    }
}

fn write_range(out: &mut Pieces<'_>, start: char, end: char) {
    out.push_str("{\"range\":[{\"string\":");
    write_str(out, &start.to_string());
    out.push_str("},{\"string\":");
    write_str(out, &end.to_string());
    out.push_str("}]}");
}
fn emit_term<'a>(out: &mut Pieces<'a>, term: &'a Term) {
    match term {
        Term::Source(symbol) => out.parts.push(Part::Symbol(symbol, true, true)),
        Term::Pattern(p) => {
            out.push_str("{\"pattern\":");
            out.parts.push(Part::Pattern(p));
            out.push('}');
        }
        Term::Str(text) => {
            out.push_str("{\"string\":");
            write_str(out, text);
            out.push('}');
        }
        Term::Tag(tag) => {
            out.push_str("{\"tag\":");
            write_str(out, tag);
            out.push('}');
        }
        Term::EmptySet => out.push_str("{\"emptySet\":true}"),
        Term::Union(items) => write_list(out, "union", items, write_term),
        Term::Intersection(items) => write_list(out, "intersection", items, write_term),
        Term::Difference(left, right) => {
            out.push_str("{\"difference\":[");
            write_term(out, left);
            out.push(',');
            write_term(out, right);
            out.push_str("]}");
        }
        Term::Capture(name) => {
            out.push_str("{\"capture\":");
            write_str(out, name);
            out.push('}');
        }
        Term::Const(name, at) => {
            out.push_str("{\"const\":");
            write_str(out, name);
            out.push_str(&format!(",\"at\":[{},{}]}}", at.0, at.1));
        }
        Term::If(cond, then) => {
            out.push_str("{\"if\":");
            write_cond(out, cond);
            out.push_str(",\"then\":");
            write_term(out, then);
            out.push('}');
        }
        Term::Call(name, args) => {
            if matches!(name.as_str(), "concat") {
                write_list(out, name, args, write_argument);
            } else {
                out.push_str("{\"method\":");
                write_str(out, name);
                out.push_str(",\"receiver\":");
                write_argument(out, &args[0]);
                out.push_str(",\"args\":[");
                for (index, arg) in args[1..].iter().enumerate() {
                    if index > 0 {
                        out.push(',');
                    }
                    write_argument(out, arg);
                }
                out.push_str("]}");
            }
        }
    }
}

fn emit_argument<'a>(out: &mut Pieces<'a>, arg: &'a Arg) {
    match arg {
        Arg::Term(term) => write_term(out, term),
        Arg::Integer(digits) => {
            out.push_str("{\"integer\":");
            write_str(out, digits);
            out.push('}');
        }
        Arg::Rule(name) | Arg::Classifier(name) => {
            out.push_str(if matches!(arg, Arg::Rule(_)) { "{\"rule\":" } else { "{\"classifier\":" });
            write_str(out, name);
            out.push('}');
        }
    }
}

fn emit_requirements<'a>(out: &mut Pieces<'a>, term: &'a Term) {
    let Term::Call(_, args) = term else { unreachable!("a signed requirement list") };
    out.push('[');
    for (index, arg) in args.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        let Arg::Term(term) = arg else { unreachable!() };
        let (negative, value) = match term {
            Term::Call(name, args) if name == "forbid" => {
                let Arg::Term(value) = &args[0] else { unreachable!() };
                (true, value)
            }
            _ => (false, term),
        };
        out.push_str(if negative { "{\"negated\":true,\"value\":" } else { "{\"negated\":false,\"value\":" });
        write_term(out, value);
        out.push('}');
    }
    out.push(']');
}

fn emit_cond<'a>(out: &mut Pieces<'a>, cond: &'a Cond) {
    match cond {
        Cond::SourceQuery(name, args, _) => {
            out.push_str("{\"method\":");
            write_str(out, name);
            out.push_str(",\"receiver\":");
            write_argument(out, &args[0]);
            out.push_str(",\"args\":[");
            for (index, arg) in args[1..].iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                if let Arg::Term(Term::Tag(tag)) = arg {
                    out.push_str("{\"terminal\":");
                    write_str(out, tag);
                    out.push('}');
                } else {
                    write_argument(out, arg);
                }
            }
            out.push_str("]}");
        }
        Cond::Compare(op, left, right) => {
            out.push_str("{\"op\":");
            write_str(out, op);
            out.push_str(",\"left\":");
            write_term(out, left);
            out.push_str(",\"right\":");
            write_term(out, right);
            out.push('}');
        }
        Cond::Matches(span, rule) | Cond::Begins(span, rule) | Cond::Ends(span, rule) => {
            let name = if matches!(cond, Cond::Matches(..)) {
                "matches"
            } else if matches!(cond, Cond::Ends(..)) {
                "ends"
            } else {
                "begins"
            };
            out.push_str("{\"method\":");
            write_str(out, name);
            out.push_str(",\"receiver\":");
            write_term(out, span);
            out.push_str(",\"args\":[");
            for (i, target) in rule.iter().enumerate() {
                if i > 0 {
                    out.push(',')
                };
                out.push_str(if target.starts_with(|c: char| c.is_ascii_uppercase()) {
                    "{\"terminal\":"
                } else {
                    "{\"rule\":"
                });
                write_str(out, target);
                out.push('}')
            }
            out.push_str("]}");
        }
        Cond::Initial(span) => emit_span_query(out, "starts-input", span),
        Cond::Final(span) => emit_span_query(out, "ends-input", span),
        Cond::Boundary(forward, receiver, targets, _) => {
            out.push_str("{\"method\":");
            write_str(out, if *forward { "followed-by" } else { "preceded-by" });
            out.push_str(",\"receiver\":");
            write_term(out, receiver);
            out.push_str(",\"args\":[");
            for (index, target) in targets.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                out.push_str(if target.starts_with(|c: char| c.is_ascii_uppercase()) {
                    "{\"terminal\":"
                } else {
                    "{\"rule\":"
                });
                write_str(out, target);
                out.push('}');
            }
            out.push_str("]}");
        }
        Cond::Not(inner) => {
            out.push_str("{\"not\":");
            write_cond(out, inner);
            out.push('}');
        }
        Cond::Any(items) => write_list(out, "any", items, write_cond),
        Cond::All(items) => write_list(out, "all", items, write_cond),
        Cond::Captured(name) => {
            out.push_str("{\"captured\":");
            write_str(out, name);
            out.push('}');
        }
        Cond::If(cond, then) => {
            out.push_str("{\"if\":");
            write_cond(out, cond);
            out.push_str(",\"then\":");
            write_cond(out, then);
            out.push('}');
        }
    }
}

fn emit_span_query<'a>(out: &mut Pieces<'a>, name: &str, span: &'a Term) {
    out.push_str("{\"method\":");
    write_str(out, name);
    out.push_str(",\"receiver\":");
    write_term(out, span);
    out.push_str(",\"args\":[]}");
}
fn emit_source_arguments<'a>(out: &mut Pieces<'a>, args: &'a [SourceArgument]) {
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

fn emit_source_targets<'a>(out: &mut Pieces<'a>, targets: &'a [SourceTarget]) {
    out.push('[');
    for (index, target) in targets.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        match target {
            SourceTarget::Symbol(symbol) => out.parts.push(Part::Symbol(symbol, true, true)),
            SourceTarget::Rule(name) | SourceTarget::Terminal(name) => {
                out.push_str(if matches!(target, SourceTarget::Rule(_)) { "{\"rule\":" } else { "{\"terminal\":" });
                write_str(out, name);
                out.push('}');
            }
        }
    }
    out.push(']');
}
