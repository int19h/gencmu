//! Parentheses add no union or Boolean grouping to the document DOM.
use super::*;
use crate::dom::source::SourceTarget;
use crate::patterns::{Children, Pattern};

enum Part<'a> {
    Expr(&'a mut Expr),
    Term(&'a mut Term),
    Cond(&'a mut Cond),
    Symbol(&'a mut SourceSymbol),
    Call(&'a mut SourceCall),
    Argument(&'a mut SourceArgument),
    Pattern(&'a mut Pattern),
    Children(&'a mut Children),
}

fn channels<'a>(channels: &'a mut Channels, stack: &mut Vec<Part<'a>>) {
    stack.extend(channels.value.iter_mut().chain(channels.image.iter_mut()).map(Part::Term));
}

pub(super) fn document(dom: &mut Dom) {
    let mut stack = Vec::new();
    for rule in &mut dom.rules {
        stack.extend(rule.tags.iter_mut().map(Part::Term));
        channels(&mut rule.strings, &mut stack);
        stack.extend(rule.error.iter_mut().chain(&mut rule.warning).map(Part::Term));
        stack.extend(rule.conditions.iter_mut().map(Part::Cond));
        stack.extend(rule.source.args.iter_mut().flatten().map(Part::Argument));
        stack.extend(rule.source.instance.iter_mut().map(Part::Call));
        for alt in &mut rule.alternatives {
            stack.push(Part::Expr(&mut alt.expr));
            stack.extend(alt.tags.iter_mut().map(Part::Term));
            channels(&mut alt.strings, &mut stack);
        }
        for item in rule.emit.iter_mut().flatten() {
            let (tags, strings) = match item {
                EmitItem::Capture(_, tags, attachments) => (tags, &mut attachments.strings),
                EmitItem::Insert(tags, strings) => (tags, strings),
            };
            stack.extend(tags.iter_mut().map(Part::Term));
            channels(strings, &mut stack);
        }
    }
    for check in &mut dom.checks {
        stack.push(Part::Term(&mut check.pattern));
        stack.extend(check.conditions.iter_mut().map(Part::Cond));
        stack.extend(check.error.iter_mut().chain(&mut check.warning).map(Part::Term));
    }
    for directive in &mut dom.directives {
        stack.extend(directive.steps.iter_mut().flatten().filter_map(|step| step.pattern.as_mut()).map(Part::Term));
        stack.extend(directive.conditions.iter_mut().flatten().map(Part::Cond));
    }
    stack.extend(dom.constants.iter_mut().map(|c| Part::Term(&mut c.value)));
    for implication in &mut dom.implications {
        stack.extend([Part::Term(&mut implication.antecedent), Part::Term(&mut implication.consequent)]);
    }
    for classifier in &mut dom.classifiers {
        for entry in &mut classifier.entries {
            stack.extend(entry.keys.iter_mut().map(Part::Term));
        }
    }
    while let Some(part) = stack.pop() {
        work::count(Work::Walked, 1);
        match part {
            Part::Expr(expr) => match expr {
                Expr::Seq(xs) | Expr::Choice(xs) | Expr::Ranked(xs, _) | Expr::And(xs) => {
                    stack.extend(xs.iter_mut().map(Part::Expr))
                }
                Expr::Optional(inner, _, default) => {
                    stack.push(Part::Expr(inner));
                    stack.extend(default.iter_mut().map(|d| Part::Term(&mut d.term)));
                }
                Expr::Capture(_, inner) | Expr::Splice(inner) => stack.push(Part::Expr(inner)),
                Expr::Repeat(inner, separator, _) => {
                    stack.push(Part::Expr(inner));
                    stack.extend(separator.iter_mut().map(|s| Part::Expr(s)));
                }
                Expr::Tested(_, value, inner) => stack.extend([Part::Term(value), Part::Expr(inner)]),
                Expr::Literal(term) => stack.push(Part::Term(term)),
                Expr::ScalarRange(a, b) => stack.extend([Part::Term(a), Part::Term(b)]),
                Expr::Source(symbol) => stack.push(Part::Symbol(symbol)),
                _ => (),
            },
            Part::Term(term) => match term {
                Term::Body(body) => stack.push(Part::Expr(std::sync::Arc::make_mut(body))),
                Term::Union(xs) => {
                    fold(xs, |t| if let Term::Union(xs) = t { Some(std::mem::take(xs)) } else { None });
                    stack.extend(xs.iter_mut().map(Part::Term));
                }
                Term::Intersection(xs) => stack.extend(xs.iter_mut().map(Part::Term)),
                Term::Difference(a, b) => stack.extend([Part::Term(a), Part::Term(b)]),
                Term::If(c, t) => stack.extend([Part::Cond(c), Part::Term(t)]),
                Term::Call(name, args) => {
                    if name == "concat" {
                        fold(args, |arg| match arg {
                            Arg::Term(Term::Call(name, args)) if name == "concat" => Some(std::mem::take(args)),
                            _ => None,
                        });
                    }
                    stack.extend(args.iter_mut().filter_map(|arg| {
                        if let Arg::Term(t) = arg {
                            Some(Part::Term(t))
                        } else {
                            None
                        }
                    }));
                }
                Term::Source(symbol) => stack.push(Part::Symbol(symbol)),
                Term::Pattern(pattern) => stack.push(Part::Pattern(pattern)),
                _ => (),
            },
            Part::Cond(cond) => match cond {
                Cond::Truthy(term) => stack.push(Part::Term(term)),
                Cond::Present(term) | Cond::Forest(term) => stack.push(Part::Term(term)),
                Cond::Any(xs) => {
                    fold(xs, |c| if let Cond::Any(xs) = c { Some(std::mem::take(xs)) } else { None });
                    stack.extend(xs.iter_mut().map(Part::Cond));
                }
                Cond::All(xs) => {
                    fold(xs, |c| if let Cond::All(xs) = c { Some(std::mem::take(xs)) } else { None });
                    stack.extend(xs.iter_mut().map(Part::Cond));
                }
                Cond::Not(c) => stack.push(Part::Cond(c)),
                Cond::If(a, b) => stack.extend([Part::Cond(a), Part::Cond(b)]),
                Cond::Compare(_, a, b, _) => stack.extend([Part::Term(a), Part::Term(b)]),
                Cond::SourceQuery(_, args, _) => stack.extend(args.iter_mut().filter_map(|arg| {
                    if let Arg::Term(t) = arg {
                        Some(Part::Term(t))
                    } else {
                        None
                    }
                })),
                Cond::Matches(t, _)
                | Cond::Begins(t, _)
                | Cond::Ends(t, _)
                | Cond::Initial(t)
                | Cond::Final(t)
                | Cond::Boundary(_, t, _, _) => stack.push(Part::Term(t)),
                Cond::Captured(_) => (),
            },
            Part::Symbol(symbol) => {
                if let SourceSymbol::Call(call) = symbol {
                    stack.push(Part::Call(call));
                }
            }
            Part::Call(call) => stack.extend(call.args.iter_mut().map(Part::Argument)),
            Part::Argument(arg) => match arg {
                SourceArgument::Term(t) | SourceArgument::Requirements(t) => stack.push(Part::Term(t)),
                SourceArgument::Body(e) | SourceArgument::WrappedBody(e) => stack.push(Part::Expr(e)),
                SourceArgument::Targets(xs) => stack.extend(xs.iter_mut().filter_map(|t| {
                    if let SourceTarget::Symbol(s) = t {
                        Some(Part::Symbol(s))
                    } else {
                        None
                    }
                })),
            },
            Part::Pattern(pattern) => match pattern {
                Pattern::Union(xs) => {
                    fold(xs, |p| if let Pattern::Union(xs) = p { Some(std::mem::take(xs)) } else { None });
                    stack.extend(xs.iter_mut().map(Part::Pattern));
                }
                Pattern::Intersection(xs) => {
                    fold(xs, |p| if let Pattern::Intersection(xs) = p { Some(std::mem::take(xs)) } else { None });
                    stack.extend(xs.iter_mut().map(Part::Pattern));
                }
                Pattern::Difference(a, b) => stack.extend([Part::Pattern(a), Part::Pattern(b)]),
                Pattern::Source(s) => stack.push(Part::Symbol(s)),
                Pattern::Literal(t, _) => stack.push(Part::Term(t)),
                Pattern::Range(a, b, _) => stack.extend([Part::Term(a), Part::Term(b)]),
                Pattern::Test(_, t, p, _) => stack.extend([Part::Term(t), Part::Pattern(p)]),
                Pattern::Path(_, p) => stack.push(Part::Pattern(p)),
                Pattern::Node(p, _, children) => {
                    stack.push(Part::Pattern(p));
                    stack.extend(children.iter_mut().map(Part::Children));
                }
                _ => (),
            },
            Part::Children(children) => match children {
                Children::Node(p) => stack.push(Part::Pattern(p)),
                Children::Sequence(xs) => {
                    fold(xs, |c| if let Children::Sequence(xs) = c { Some(std::mem::take(xs)) } else { None });
                    stack.extend(xs.iter_mut().map(Part::Children));
                }
                Children::Choice(xs) => {
                    fold(xs, |arm| {
                        if let Children::Sequence(items) = arm {
                            fold(
                                items,
                                |c| if let Children::Sequence(xs) = c { Some(std::mem::take(xs)) } else { None },
                            );
                            if items.len() == 1 && matches!(items[0], Children::Choice(_)) {
                                let Children::Choice(xs) = items.pop().unwrap() else { unreachable!() };
                                return Some(xs);
                            }
                        }
                        None
                    });
                    stack.extend(xs.iter_mut().map(Part::Children));
                }
                Children::Optional(c) => stack.push(Part::Children(c)),
                Children::Repeat(c, separator) => {
                    stack.push(Part::Children(c));
                    stack.extend(separator.iter_mut().map(|s| Part::Children(s)));
                }
                Children::Siblings => (),
            },
        }
    }
}

fn fold<T>(items: &mut Vec<T>, inner: impl Fn(&mut T) -> Option<Vec<T>>) {
    let mut joined = Vec::with_capacity(items.len());
    let mut pending = std::mem::take(items);
    pending.reverse();
    while let Some(mut item) = pending.pop() {
        work::count(Work::Walked, 1);
        if let Some(mut parts) = inner(&mut item) {
            parts.reverse();
            pending.append(&mut parts);
        } else {
            joined.push(item);
        }
    }
    *items = joined;
}
