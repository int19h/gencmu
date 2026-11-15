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

thread_local! {
    /// Whether the writer also writes what a reader knows of each node and
    /// the DOM does not hold, under members whose names begin with NUL, for
    /// the DOM validator alone (engine §9.3).
    static LOCATED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Runs `write` with the hidden members written.
pub(crate) fn located<T>(write: impl FnOnce() -> T) -> T {
    let before = LOCATED.with(|flag| flag.replace(true));
    let result = write();
    LOCATED.with(|flag| flag.set(before));
    result
}

pub(crate) fn is_located() -> bool {
    LOCATED.with(std::cell::Cell::get)
}

/// The hidden members of a node, when the writer writes them.
pub(crate) fn hidden_text(at: Option<(usize, usize)>, grouped: bool) -> String {
    if !is_located() {
        return String::new();
    }
    let mut text = String::new();
    if let Some((line, column)) = at {
        text.push_str(&format!(",\"\\u0000at\":[{line},{column}]"));
    }
    if grouped {
        text.push_str(",\"\\u0000grouped\":true");
    }
    text
}

fn hidden_of(hidden: Option<&Hidden>) -> String {
    hidden.map_or_else(String::new, |hidden| hidden_text(hidden.position(), hidden.grouped))
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
fn write_list_with<'a, T>(
    out: &mut Pieces<'a>,
    key: &str,
    items: &'a [T],
    write: fn(&mut Pieces<'a>, &'a T),
    hidden: &str,
) {
    out.push_str("{\"");
    out.push_str(key);
    out.push_str("\":[");
    for (index, item) in items.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        write(out, item);
    }
    out.push(']');
    out.push_str(hidden);
    out.push('}');
}

fn at_text(at: &Option<(usize, usize)>) -> String {
    match at {
        Some((line, column)) => format!(",\"at\":[{line},{column}]"),
        None => String::new(),
    }
}

fn emit_expr<'a>(out: &mut Pieces<'a>, expr: &'a Expr) {
    let at = at_text(&expr.at()) + &hidden_text(None, expr.grouped());
    match expr {
        Expr::Splice(inner, _) => {
            out.push_str("{\"splice\":");
            write_expr(out, inner);
            out.push_str(&at);
            out.push('}');
        }
        Expr::Source(symbol, hidden) => {
            out.push('{');
            out.parts.push(Part::Symbol(symbol, false, true));
            out.push_str(&hidden_of(Some(hidden)));
            out.push('}');
        }
        Expr::Seq(items, _) => write_expr_list(out, "seq", items, &at),
        Expr::Choice(items, _) => write_expr_list(out, "choice", items, &at),
        Expr::Ranked(items, _) => write_expr_list(out, "ranked", items, &at),
        Expr::And(items, _) => write_expr_list(out, "and", items, &at),
        Expr::Optional(inner, mark, default, _) => {
            out.push_str("{\"optional\":");
            write_expr(out, inner);
            if *mark == Mark::Elidable {
                out.push_str(",\"elidable\":true");
            }
            if let Some(default) = default {
                out.push_str(",\"default\":");
                write_term(out, &default.term);
                out.push_str(&super::hidden_member("defaultAt", default.at));
            }
            out.push_str(&at);
            out.push('}');
        }
        Expr::Repeat(item, separator, chain, _) => {
            out.push_str("{\"repeat\":");
            write_expr(out, item);
            if let Some(separator) = separator {
                out.push_str(",\"separator\":");
                write_expr(out, separator);
            }
            if let Some(chain) = chain {
                out.push_str(match chain {
                    Chain::Left => ",\"chain\":\"left\"",
                    Chain::Right => ",\"chain\":\"right\"",
                });
            }
            out.push_str(&at);
            out.push('}');
        }
        Expr::Ref(name, _) => {
            out.push_str("{\"ref\":");
            write_str(out, name);
            out.push_str(&at);
            out.push('}');
        }
        Expr::Terminal(name, _) => {
            out.push_str("{\"terminal\":");
            write_str(out, name);
            out.push_str(&at);
            out.push('}');
        }
        Expr::Literal(term, _) => {
            out.push_str("{\"literal\":");
            write_term(out, term);
            out.push_str(&at);
            out.push('}');
        }
        Expr::ScalarRange(start, end, _) => {
            out.push_str("{\"range\":[");
            write_term(out, start);
            out.push(',');
            write_term(out, end);
            out.push(']');
            out.push_str(&at);
            out.push('}');
        }
        Expr::Range(start, end, _) => {
            out.push_str("{\"range\":[{\"string\":");
            write_str(out, &start.to_string());
            out.push_str("},{\"string\":");
            write_str(out, &end.to_string());
            out.push_str("}]");
            out.push_str(&at);
            out.push('}');
        }
        Expr::Wildcard(_) => {
            out.push_str("{\"wildcard\":true");
            out.push_str(&at);
            out.push('}');
        }
        Expr::Capture(name, inner, _) => {
            out.push_str("{\"capture\":");
            write_str(out, name);
            out.push_str(",\"expr\":");
            write_expr(out, inner);
            out.push_str(&at);
            out.push('}');
        }
        Expr::Tested(op, value, inner, _) => {
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
            out.push_str(&at);
            out.push('}');
        }
        Expr::Empty(_) => {
            out.push_str("{\"empty\":true");
            out.push_str(&at);
            out.push('}');
        }
        Expr::Remainder(_) => {
            out.push_str("{\"remainder\":true");
            out.push_str(&at);
            out.push('}');
        }
    }
}

fn write_expr_list<'a>(out: &mut Pieces<'a>, key: &str, items: &'a [Expr], at: &str) {
    out.push_str("{\"");
    out.push_str(key);
    out.push_str("\":[");
    for (index, item) in items.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        write_expr(out, item);
    }
    out.push(']');
    out.push_str(at);
    out.push('}');
}

fn emit_term<'a>(out: &mut Pieces<'a>, term: &'a Term) {
    let hidden = hidden_of(term.hidden());
    match term {
        Term::Body(body) => {
            out.push_str("{\"body\":");
            write_expr(out, body);
            out.push('}');
        }
        Term::Source(symbol) => out.parts.push(Part::Symbol(symbol, true, true)),
        Term::Pattern(p, ..) => {
            out.push_str("{\"pattern\":");
            out.parts.push(Part::Pattern(p));
            out.push_str(&hidden);
            out.push('}');
        }
        Term::Str(text, ..) => {
            out.push_str("{\"string\":");
            write_str(out, text);
            out.push_str(&hidden);
            out.push('}');
        }
        Term::Tag(tag, ..) => {
            out.push_str("{\"tag\":");
            write_str(out, tag);
            out.push_str(&hidden);
            out.push('}');
        }
        Term::EmptySet(..) => {
            out.push_str("{\"emptySet\":true");
            out.push_str(&hidden);
            out.push('}');
        }
        Term::Union(items, ..) => write_list_with(out, "union", items, write_term, &hidden),
        Term::Intersection(items, ..) => write_list_with(out, "intersection", items, write_term, &hidden),
        Term::Difference(left, right, ..) => {
            out.push_str("{\"difference\":[");
            write_term(out, left);
            out.push(',');
            write_term(out, right);
            out.push(']');
            out.push_str(&hidden);
            out.push('}');
        }
        Term::Capture(name, ..) => {
            out.push_str("{\"capture\":");
            write_str(out, name);
            out.push_str(&hidden);
            out.push('}');
        }
        Term::Const(name, at, ..) => {
            out.push_str("{\"const\":");
            write_str(out, name);
            out.push_str(&format!(",\"at\":[{},{}]", at.0, at.1));
            out.push_str(&hidden);
            out.push('}');
        }
        Term::If(cond, then, ..) => {
            out.push_str("{\"if\":");
            write_cond(out, cond);
            out.push_str(",\"then\":");
            write_term(out, then);
            out.push_str(&hidden);
            out.push('}');
        }
        Term::Call(name, args, ..) => {
            if matches!(name.as_str(), "concat") {
                write_list_with(out, name, args, write_argument, &hidden);
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
                out.push(']');
                out.push_str(&hidden);
                out.push('}');
            }
        }
    }
}

fn emit_argument<'a>(out: &mut Pieces<'a>, arg: &'a Arg) {
    match arg {
        Arg::Term(term) => write_term(out, term),
        Arg::Integer(digits, hidden) => {
            out.push_str("{\"integer\":");
            write_str(out, digits);
            out.push_str(&hidden_of(Some(hidden)));
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
    let Term::Call(_, args, ..) = term else { unreachable!("a signed requirement list") };
    out.push('[');
    for (index, arg) in args.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        let Arg::Term(term) = arg else { unreachable!() };
        let (negative, value) = match term {
            Term::Call(name, args, ..) if name == "forbid" => {
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
    let hidden = hidden_of(cond.hidden());
    match cond {
        Cond::Truthy(term, ..) => {
            out.push_str("{\"nonempty\":");
            write_term(out, term);
            out.push_str(&hidden);
            out.push('}');
        }
        Cond::Forest(term, ..) => write_term(out, term),
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
                if let Arg::Term(Term::Tag(tag, ..)) = arg {
                    out.push_str("{\"terminal\":");
                    write_str(out, tag);
                    out.push('}');
                } else {
                    write_argument(out, arg);
                }
            }
            out.push_str("]}");
        }
        Cond::Compare(op, left, right, at) => {
            out.push_str("{\"op\":");
            write_str(out, op);
            out.push_str(",\"left\":");
            write_term(out, left);
            out.push_str(",\"right\":");
            write_term(out, right);
            out.push_str(&hidden_text(*at, false));
            out.push('}');
        }
        Cond::Initial(span, ..) => emit_span_query(out, "starts-input", span),
        Cond::Final(span, ..) => emit_span_query(out, "ends-input", span),
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
        Cond::Not(inner, ..) => {
            out.push_str("{\"not\":");
            write_cond(out, inner);
            out.push_str(&hidden);
            out.push('}');
        }
        Cond::Any(items, ..) => write_list_with(out, "any", items, write_cond, &hidden),
        Cond::All(items, ..) => write_list_with(out, "all", items, write_cond, &hidden),
        Cond::Captured(name, ..) => {
            out.push_str("{\"captured\":");
            write_str(out, name);
            out.push_str(&hidden);
            out.push('}');
        }
        Cond::If(cond, then, ..) => {
            out.push_str("{\"if\":");
            write_cond(out, cond);
            out.push_str(",\"then\":");
            write_cond(out, then);
            out.push_str(&hidden);
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
                Expr::Ref(name, _) | Expr::Terminal(name, _) => {
                    let rule = matches!(expr, Expr::Ref(_, _))
                        && !name.starts_with(|c: char| c.is_ascii_uppercase() || c == '_');
                    out.push_str(if rule { "{\"rule\":" } else { "{\"tag\":" });
                    write_str(out, name);
                    out.push('}');
                }
                Expr::Literal(term, _) => write_term(out, term),
                Expr::Splice(_, _)
                | Expr::Source(..)
                | Expr::Tested(..)
                | Expr::ScalarRange(..)
                | Expr::Wildcard(_) => write_expr(out, expr),
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
