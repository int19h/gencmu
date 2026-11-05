//! Recover private positions without replacing any cached grammar member.
use super::*;
use crate::dom::{Arg, Channels, Cond, Dom, EmitItem, RuleDef};
use crate::patterns::{Children, Pattern};
use std::collections::BTreeMap;

enum Pair<'a> {
    Rule(&'a mut RuleDef, &'a RuleDef),
    Expr(&'a mut Expr, &'a Expr),
    Term(&'a mut Term, &'a Term),
    Cond(&'a mut Cond, &'a Cond),
    Symbol(&'a mut SourceSymbol, &'a SourceSymbol),
    Call(&'a mut SourceCall, &'a SourceCall),
    Argument(&'a mut SourceArgument, &'a SourceArgument),
    Pattern(&'a mut Pattern, &'a Pattern),
    Children(&'a mut Children, &'a Children),
}

fn channels<'a>(to: &'a mut Channels, from: &'a Channels, pending: &mut Vec<Pair<'a>>) {
    to.value_at = from.value_at;
    to.image_at = from.image_at;
    for (to, from) in to.value.iter_mut().zip(&from.value).chain(to.image.iter_mut().zip(&from.image)) {
        pending.push(Pair::Term(to, from));
    }
}

fn arguments<'a>(to: &'a mut [Arg], from: &'a [Arg], pending: &mut Vec<Pair<'a>>) {
    for (to, from) in to.iter_mut().zip(from) {
        if let (Arg::Term(to), Arg::Term(from)) = (to, from) {
            pending.push(Pair::Term(to, from));
        }
    }
}

fn children_parts(root: &Children) -> Vec<&Children> {
    let mut pending = vec![root];
    let mut out = Vec::new();
    while let Some(part) = pending.pop() {
        if let Children::Sequence(xs) = part {
            pending.extend(xs.iter().rev());
        } else {
            out.push(part);
        }
    }
    out
}

fn children_parts_mut(root: &mut Children) -> Vec<&mut Children> {
    let mut pending = vec![root];
    let mut out = Vec::new();
    while let Some(part) = pending.pop() {
        if let Children::Sequence(xs) = part {
            pending.extend(xs.iter_mut().rev());
        } else {
            out.push(part);
        }
    }
    out
}

fn predicate(cond: &Cond) -> Option<(&str, &Term)> {
    Some(match cond {
        Cond::SourceQuery(name, args, _) => {
            let Arg::Term(receiver) = args.first()? else { return None };
            (name.as_str(), receiver)
        }
        Cond::Matches(receiver, _) => ("matches", receiver),
        Cond::Begins(receiver, _) => ("begins", receiver),
        Cond::Ends(receiver, _) => ("ends", receiver),
        Cond::Initial(receiver) => ("starts-input", receiver),
        Cond::Final(receiver) => ("ends-input", receiver),
        Cond::Boundary(after, receiver, _, _) => (if *after { "followed-by" } else { "preceded-by" }, receiver),
        _ => return None,
    })
}

fn predicate_mut(cond: &mut Cond) -> Option<(&str, &mut Term)> {
    Some(match cond {
        Cond::SourceQuery(name, args, _) => {
            let Arg::Term(receiver) = args.first_mut()? else { return None };
            (name.as_str(), receiver)
        }
        Cond::Matches(receiver, _) => ("matches", receiver),
        Cond::Begins(receiver, _) => ("begins", receiver),
        Cond::Ends(receiver, _) => ("ends", receiver),
        Cond::Initial(receiver) => ("starts-input", receiver),
        Cond::Final(receiver) => ("ends-input", receiver),
        Cond::Boundary(after, receiver, _, _) => (if *after { "followed-by" } else { "preceded-by" }, receiver),
        _ => return None,
    })
}

pub(crate) fn restore_locations(to: &mut Dom, from: &Dom) {
    let mut pending = Vec::new();
    let rules: BTreeMap<_, _> = from.rules.iter().map(|r| (r.at, r)).collect();
    for rule in &mut to.rules {
        if let Some(source) = rules.get(&rule.at) {
            pending.push(Pair::Rule(rule, source));
        }
    }
    let constants: BTreeMap<_, _> = from.constants.iter().map(|r| (r.at, r)).collect();
    for constant in &mut to.constants {
        if let Some(source) = constants.get(&constant.at) {
            pending.push(Pair::Term(&mut constant.value, &source.value));
        }
    }
    let implications: BTreeMap<_, _> = from.implications.iter().map(|r| (r.at, r)).collect();
    for implication in &mut to.implications {
        if let Some(source) = implications.get(&implication.at) {
            pending.push(Pair::Term(&mut implication.antecedent, &source.antecedent));
            pending.push(Pair::Term(&mut implication.consequent, &source.consequent));
        }
    }
    let directives: BTreeMap<_, _> = from.directives.iter().map(|r| (r.at, r)).collect();
    for directive in &mut to.directives {
        if let Some(source) = directives.get(&directive.at) {
            for (to, from) in directive.conditions.iter_mut().flatten().zip(source.conditions.iter().flatten()) {
                pending.push(Pair::Cond(to, from));
            }
        }
    }
    restore(pending);
}

pub(crate) fn restore_rule_locations(to: &mut RuleDef, from: &RuleDef) {
    restore(vec![Pair::Rule(to, from)]);
}

fn restore(mut pending: Vec<Pair<'_>>) {
    while let Some(pair) = pending.pop() {
        match pair {
            Pair::Rule(to, from) => {
                channels(&mut to.strings, &from.strings, &mut pending);
                for (to, from) in to.tags.iter_mut().zip(&from.tags) {
                    pending.push(Pair::Term(to, from));
                }
                for (to, from) in to.source.instance.iter_mut().zip(&from.source.instance) {
                    pending.push(Pair::Call(to, from));
                }
                for (to, from) in to.source.args.iter_mut().flatten().zip(from.source.args.iter().flatten()) {
                    pending.push(Pair::Argument(to, from));
                }
                for (to, from) in to.alternatives.iter_mut().zip(&from.alternatives) {
                    channels(&mut to.strings, &from.strings, &mut pending);
                    pending.push(Pair::Expr(&mut to.expr, &from.expr));
                    for (to, from) in to.tags.iter_mut().zip(&from.tags) {
                        pending.push(Pair::Term(to, from));
                    }
                }
                for (to, from) in to.conditions.iter_mut().zip(&from.conditions) {
                    pending.push(Pair::Cond(to, from));
                }
                for (to, from) in to.emit.iter_mut().flatten().zip(from.emit.iter().flatten()) {
                    let (to_tags, to_strings, from_tags, from_strings) = match (to, from) {
                        (EmitItem::Capture(_, tt, ts), EmitItem::Capture(_, ft, fs)) => {
                            (tt, &mut ts.strings, ft, &fs.strings)
                        }
                        (EmitItem::Insert(tt, ts), EmitItem::Insert(ft, fs)) => (tt, ts, ft, fs),
                        _ => continue,
                    };
                    channels(to_strings, from_strings, &mut pending);
                    for (to, from) in to_tags.iter_mut().zip(from_tags) {
                        pending.push(Pair::Term(to, from));
                    }
                }
            }
            Pair::Expr(to, from) => match (to, from) {
                (Expr::Ranked(to, ta), Expr::Ranked(from, fa)) => {
                    *ta = *fa;
                    pending.extend(to.iter_mut().zip(from).map(|(to, from)| Pair::Expr(to, from)));
                }
                (Expr::Seq(to), Expr::Seq(from))
                | (Expr::Choice(to), Expr::Choice(from))
                | (Expr::And(to), Expr::And(from)) => {
                    pending.extend(to.iter_mut().zip(from).map(|(to, from)| Pair::Expr(to, from)));
                }
                (Expr::Optional(to, _, td), Expr::Optional(from, _, fd)) => {
                    pending.push(Pair::Expr(to, from));
                    for (to, from) in td.iter_mut().zip(fd) {
                        to.at = from.at;
                        pending.push(Pair::Term(&mut to.term, &from.term));
                    }
                }
                (Expr::Capture(_, to), Expr::Capture(_, from)) => pending.push(Pair::Expr(to, from)),
                (Expr::Repeat(to, ts, _), Expr::Repeat(from, fs, _)) => {
                    pending.push(Pair::Expr(to, from));
                    for (to, from) in ts.iter_mut().zip(fs) {
                        pending.push(Pair::Expr(to, from));
                    }
                }
                (Expr::Tested(_, tv, to), Expr::Tested(_, fv, from)) => {
                    pending.push(Pair::Term(tv, fv));
                    pending.push(Pair::Expr(to, from));
                }
                (Expr::Literal(to), Expr::Literal(from)) => pending.push(Pair::Term(to, from)),
                (Expr::ScalarRange(ta, tb), Expr::ScalarRange(fa, fb)) => {
                    pending.push(Pair::Term(ta, fa));
                    pending.push(Pair::Term(tb, fb));
                }
                (Expr::Source(to), Expr::Source(from)) => pending.push(Pair::Symbol(to, from)),
                _ => (),
            },
            Pair::Term(to, from) => match (to, from) {
                (Term::Union(to), Term::Union(from)) | (Term::Intersection(to), Term::Intersection(from)) => {
                    pending.extend(to.iter_mut().zip(from).map(|(to, from)| Pair::Term(to, from)));
                }
                (Term::Difference(ta, tb), Term::Difference(fa, fb)) => {
                    pending.push(Pair::Term(ta, fa));
                    pending.push(Pair::Term(tb, fb));
                }
                (Term::If(tc, tt), Term::If(fc, ft)) => {
                    pending.push(Pair::Cond(tc, fc));
                    pending.push(Pair::Term(tt, ft));
                }
                (Term::Call(tn, to), Term::Call(fn_, from)) if tn == fn_ => arguments(to, from, &mut pending),
                (Term::Source(to), Term::Source(from)) => pending.push(Pair::Symbol(to, from)),
                (Term::Pattern(to), Term::Pattern(from)) => pending.push(Pair::Pattern(to, from)),
                _ => (),
            },
            Pair::Cond(to, from) => match (to, from) {
                (Cond::SourceQuery(tn, to, tl), Cond::SourceQuery(fn_, from, fl)) => {
                    if tn == fn_ {
                        *tl = fl.clone();
                        arguments(to, from, &mut pending);
                    }
                }
                (Cond::Boundary(td, to, _, tl), Cond::Boundary(fd, from, _, fl)) => {
                    if td == fd {
                        *tl = fl.clone();
                        pending.push(Pair::Term(to, from));
                    }
                }
                (Cond::Boundary(_, to, _, tl), Cond::SourceQuery(_, from, fl)) => {
                    *tl = fl.clone().into();
                    if let Some(Arg::Term(from)) = from.first() {
                        pending.push(Pair::Term(to, from));
                    }
                }
                (Cond::SourceQuery(_, to, tl), Cond::Boundary(_, from, _, fl)) => {
                    *tl = (**fl).clone();
                    if let Some(Arg::Term(to)) = to.first_mut() {
                        pending.push(Pair::Term(to, from));
                    }
                }
                (Cond::Compare(_, ta, tb, tl), Cond::Compare(_, fa, fb, fl)) => {
                    *tl = *fl;
                    pending.push(Pair::Term(ta, fa));
                    pending.push(Pair::Term(tb, fb));
                }
                (Cond::Any(to), Cond::Any(from)) | (Cond::All(to), Cond::All(from)) => {
                    pending.extend(to.iter_mut().zip(from).map(|(to, from)| Pair::Cond(to, from)));
                }
                (Cond::Not(to), Cond::Not(from)) => pending.push(Pair::Cond(to, from)),
                (Cond::If(ta, tb), Cond::If(fa, fb)) => {
                    pending.push(Pair::Cond(ta, fa));
                    pending.push(Pair::Cond(tb, fb));
                }
                (to, from) => {
                    if let (Some((tn, to)), Some((fn_, from))) = (predicate_mut(to), predicate(from)) {
                        if tn == fn_ {
                            pending.push(Pair::Term(to, from));
                        }
                    }
                }
            },
            Pair::Symbol(to, from) => {
                if let (SourceSymbol::Call(to), SourceSymbol::Call(from)) = (to, from) {
                    pending.push(Pair::Call(to, from));
                }
            }
            Pair::Call(to, from) => {
                pending.extend(to.args.iter_mut().zip(&from.args).map(|(to, from)| Pair::Argument(to, from)))
            }
            Pair::Argument(to, from) => match (to, from) {
                (SourceArgument::Term(to), SourceArgument::Term(from))
                | (SourceArgument::Requirements(to), SourceArgument::Requirements(from)) => {
                    pending.push(Pair::Term(to, from))
                }
                (
                    SourceArgument::Body(to) | SourceArgument::WrappedBody(to),
                    SourceArgument::Body(from) | SourceArgument::WrappedBody(from),
                ) => pending.push(Pair::Expr(to, from)),
                (
                    SourceArgument::Body(Expr::Source(to)) | SourceArgument::WrappedBody(Expr::Source(to)),
                    SourceArgument::Term(Term::Source(from)),
                )
                | (
                    SourceArgument::Term(Term::Source(to)),
                    SourceArgument::Body(Expr::Source(from)) | SourceArgument::WrappedBody(Expr::Source(from)),
                ) => pending.push(Pair::Symbol(to, from)),
                (SourceArgument::Targets(to), SourceArgument::Targets(from)) => {
                    for (to, from) in to.iter_mut().zip(from) {
                        if let (SourceTarget::Symbol(to), SourceTarget::Symbol(from)) = (to, from) {
                            pending.push(Pair::Symbol(to, from));
                        }
                    }
                }
                _ => (),
            },
            Pair::Pattern(to, from) => match (to, from) {
                (Pattern::Source(to), Pattern::Source(from)) => pending.push(Pair::Symbol(to, from)),
                (Pattern::Literal(to, _), Pattern::Literal(from, _)) => pending.push(Pair::Term(to, from)),
                (Pattern::Range(ta, tb, _), Pattern::Range(fa, fb, _)) => {
                    pending.push(Pair::Term(ta, fa));
                    pending.push(Pair::Term(tb, fb));
                }
                (Pattern::Test(_, tv, to, to_at), Pattern::Test(_, fv, from, from_at)) => {
                    *to_at = *from_at;
                    pending.push(Pair::Term(tv, fv));
                    pending.push(Pair::Pattern(to, from));
                }
                (Pattern::Node(to, _, tc), Pattern::Node(from, _, fc)) => {
                    pending.push(Pair::Pattern(to, from));
                    for (to, from) in tc.iter_mut().zip(fc) {
                        pending.push(Pair::Children(to, from));
                    }
                }
                (Pattern::Path(_, to), Pattern::Path(_, from)) => pending.push(Pair::Pattern(to, from)),
                (Pattern::Union(to), Pattern::Union(from))
                | (Pattern::Intersection(to), Pattern::Intersection(from)) => {
                    pending.extend(to.iter_mut().zip(from).map(|(to, from)| Pair::Pattern(to, from)));
                }
                (Pattern::Difference(ta, tb), Pattern::Difference(fa, fb)) => {
                    pending.push(Pair::Pattern(ta, fa));
                    pending.push(Pair::Pattern(tb, fb));
                }
                _ => (),
            },
            Pair::Children(to, from) => {
                if matches!(to, Children::Sequence(_)) || matches!(from, Children::Sequence(_)) {
                    pending.extend(
                        children_parts_mut(to)
                            .into_iter()
                            .zip(children_parts(from))
                            .map(|(to, from)| Pair::Children(to, from)),
                    );
                    continue;
                }
                match (to, from) {
                    (Children::Node(to), Children::Node(from)) => pending.push(Pair::Pattern(to, from)),
                    (Children::Choice(to), Children::Choice(from)) => {
                        pending.extend(to.iter_mut().zip(from).map(|(to, from)| Pair::Children(to, from)))
                    }
                    (Children::Optional(to), Children::Optional(from)) => pending.push(Pair::Children(to, from)),
                    (Children::Repeat(to, ts), Children::Repeat(from, fs)) => {
                        pending.push(Pair::Children(to, from));
                        for (to, from) in ts.iter_mut().zip(fs) {
                            pending.push(Pair::Children(to, from));
                        }
                    }
                    _ => (),
                }
            }
        }
    }
}
