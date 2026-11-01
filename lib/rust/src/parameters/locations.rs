//! Private source annotations survive substitution but never enter keys or JSON.
use super::*;
use std::collections::BTreeMap;
pub(crate) fn source_at(n: &Json) -> Option<(usize, usize)> {
    let s = get(n, SOURCE);
    at(s)
        .or_else(|| match s.as_array() {
            Some([Json::Int(a), Json::Int(b)]) if *a > 0 && *b > 0 => Some((*a as usize, *b as usize)),
            _ => None,
        })
        .or_else(|| at(n))
}
fn ranked_at(n: &Json) -> Option<(usize, usize)> {
    at(&obj([("at", get(get(n, SOURCE), "ranked").clone())]))
}
fn record_rank(n: &mut Json, a: (usize, usize)) {
    let mut s = if get(n, SOURCE).as_object().is_some() {
        get(n, SOURCE).clone()
    } else {
        obj([("at", source_at(n).map_or(Json::Null, position))])
    };
    set(&mut s, "ranked", position(a));
    set(n, SOURCE, s);
}
fn expression(n: &Json, path: String, locations: &mut BTreeMap<String, (usize, usize)>) {
    if let Some(a) = ranked_at(n) {
        locations.insert(path.clone(), a);
    }
    for k in ["seq", "choice", "ranked", "and"] {
        for (i, v) in list(get(n, k)).iter().enumerate() {
            expression(v, format!("{path}/{k}/{i}"), locations)
        }
    }
    for k in ["optional", "repeat", "separator", "expr"] {
        if let Some(v) = n.get(k) {
            expression(v, format!("{path}/{k}"), locations)
        }
    }
}
fn channels(channels: &mut dom::Channels, n: &Json) {
    channels.value_at = n.get("value").and_then(source_at);
    channels.image_at = n.get("image").and_then(source_at);
}
fn term(t: &mut dom::Term, n: &Json) {
    use dom::{Arg, Term};
    match t {
        Term::Union(xs) | Term::Intersection(xs) => {
            let key = if has(n, "union") { "union" } else { "intersection" };
            for (t, n) in xs.iter_mut().zip(list(get(n, key))) {
                term(t, n)
            }
        }
        Term::Difference(a, b) => {
            let xs = list(get(n, "difference"));
            if xs.len() == 2 {
                term(a, &xs[0]);
                term(b, &xs[1])
            }
        }
        Term::If(c, t) => {
            cond(c, get(n, "if"));
            term(t, get(n, "then"))
        }
        Term::Call(_, args) => {
            if let Some(Arg::Term(receiver)) = args.first_mut() {
                term(receiver, get(n, "receiver"))
            }
            for (a, n) in args.iter_mut().skip(1).zip(list(get(n, "args"))) {
                if let Arg::Term(t) = a {
                    term(t, n)
                }
            }
        }
        _ => (),
    }
}
fn cond(c: &mut dom::Cond, n: &Json) {
    use dom::Cond;
    match c {
        Cond::Boundary(_, receiver, _, location) => {
            location.at = source_at(n);
            location.targets = list(get(n, "args")).iter().filter_map(source_at).collect();
            term(receiver, get(n, "receiver"))
        }
        Cond::Compare(_, a, b) => {
            term(a, get(n, "left"));
            term(b, get(n, "right"))
        }
        Cond::Matches(r, _) | Cond::Begins(r, _) | Cond::Ends(r, _) | Cond::Initial(r) | Cond::Final(r) => {
            term(r, get(n, "receiver"))
        }
        Cond::If(a, b) => {
            cond(a, get(n, "if"));
            cond(b, get(n, "then"))
        }
        Cond::Not(c) => cond(c, get(n, "not")),
        Cond::Any(xs) | Cond::All(xs) => {
            let k = if has(n, "any") { "any" } else { "all" };
            for (c, n) in xs.iter_mut().zip(list(get(n, k))) {
                cond(c, n)
            }
        }
        _ => (),
    }
}
pub(crate) fn restore_rule(rule: &mut dom::RuleDef, n: &Json) {
    channels(&mut rule.strings, n);
    for (alt, n) in rule.alternatives.iter_mut().zip(list(get(n, "alternatives"))) {
        expression(get(n, "expr"), String::new(), &mut alt.ranked_locations);
        restore_defaults(&mut alt.expr, get(n, "expr"));
        channels(&mut alt.strings, n);
        if let Some(t) = &mut alt.tags {
            term(t, get(n, "tags"))
        }
    }
    if let Some(t) = &mut rule.tags {
        term(t, get(n, "tags"))
    }
    for (c, n) in rule.conditions.iter_mut().zip(list(get(n, "conditions"))) {
        cond(c, n)
    }
    if let Some(items) = &mut rule.emit {
        for (item, n) in items.iter_mut().zip(list(get(get(n, "emit"), "items"))) {
            let (tags, strings) = match item {
                dom::EmitItem::Capture(_, tags, a) => (tags, &mut a.strings),
                dom::EmitItem::Insert(tags, s) => (tags, s),
            };
            channels(strings, n);
            if let Some(t) = tags {
                term(t, get(n, "tags"))
            }
        }
    }
}

fn locate(n: &mut Json, a: Option<(usize, usize)>) {
    if let Some(a) = a {
        if !has(n, SOURCE) {
            set(n, SOURCE, position(a))
        }
    }
}
fn slot<'a>(n: &'a mut Json, key: &str) -> Option<&'a mut Json> {
    match n {
        Json::Obj(fs) => fs.iter_mut().find(|(k, _)| k == key).map(|(_, v)| v),
        Json::Arr(xs) => key.parse::<usize>().ok().and_then(|i| xs.get_mut(i)),
        _ => None,
    }
}
fn annotate_source(symbol: &dom::source::SourceSymbol, n: &mut Json) {
    if let dom::source::SourceSymbol::Call(call) = symbol {
        annotate_arguments(&call.args, n);
    }
}
fn annotate_arguments(args: &[dom::source::SourceArgument], n: &mut Json) {
    use dom::source::{SourceArgument, SourceTarget};
    if let Some(Json::Arr(values)) = slot(n, "args") {
        for (arg, n) in args.iter().zip(values) {
            match arg {
                SourceArgument::Body(expr) | SourceArgument::WrappedBody(expr) => {
                    if has(n, "body") {
                        annotate_expr(expr, slot(n, "body").unwrap());
                    } else {
                        annotate_expr(expr, n);
                    }
                }
                SourceArgument::Term(term) => annotate_term(term, n),
                SourceArgument::Targets(targets) => {
                    if let Some(Json::Arr(values)) = slot(n, "targets") {
                        for (target, n) in targets.iter().zip(values) {
                            if let SourceTarget::Symbol(symbol) = target {
                                annotate_source(symbol, n);
                            }
                        }
                    }
                }
                SourceArgument::Requirements(_) => (),
            }
        }
    }
}
fn annotate_expr(expr: &dom::Expr, n: &mut Json) {
    use dom::Expr;
    match expr {
        Expr::Ranked(_, Some(at)) => record_rank(n, *at),
        Expr::Source(symbol) => annotate_source(symbol, n),
        Expr::Literal(term) => {
            if let Some(n) = slot(n, "literal") {
                annotate_term(term, n);
            }
        }
        Expr::ScalarRange(a, b) => {
            if let Some(Json::Arr(xs)) = slot(n, "range") {
                if xs.len() == 2 {
                    annotate_term(a, &mut xs[0]);
                    annotate_term(b, &mut xs[1]);
                }
            }
        }
        Expr::Tested(kind, term, _) if kind != "tags" => {
            if let Some(n) = slot(n, "value") {
                annotate_term(term, n);
            }
        }
        _ => (),
    }
    match expr {
        Expr::Seq(xs) | Expr::Choice(xs) | Expr::Ranked(xs, _) | Expr::And(xs) => {
            let key = match expr {
                Expr::Seq(_) => "seq",
                Expr::Choice(_) => "choice",
                Expr::And(_) => "and",
                _ => "ranked",
            };
            if let Some(Json::Arr(values)) = slot(n, key) {
                for (expr, n) in xs.iter().zip(values) {
                    annotate_expr(expr, n);
                }
            }
        }
        Expr::Optional(inner, _) | Expr::Repeat(inner, _, _) | Expr::Capture(_, inner) | Expr::Tested(_, _, inner) => {
            let key = match expr {
                Expr::Optional(..) => "optional",
                Expr::Repeat(..) => "repeat",
                _ => "expr",
            };
            if let Some(n) = slot(n, key) {
                annotate_expr(inner, n);
            }
            if let Expr::Repeat(_, Some(separator), _) = expr {
                if let Some(n) = slot(n, "separator") {
                    annotate_expr(separator, n);
                }
            }
        }
        _ => (),
    }
}
fn annotate_pattern(pattern: &crate::patterns::Pattern, n: &mut Json) {
    use crate::patterns::{Children, Pattern};
    fn children(items: &Children, n: &mut Json) {
        let mut pending = vec![items];
        let mut flat = Vec::new();
        while let Some(item) = pending.pop() {
            if let Children::Sequence(xs) = item {
                pending.extend(xs.iter().rev());
            } else {
                flat.push(item);
            }
        }
        if let Json::Arr(values) = n {
            for (item, n) in flat.into_iter().zip(values) {
                match item {
                    Children::Node(pattern) => {
                        if let Some(n) = slot(n, "child") {
                            annotate_pattern(pattern, n);
                        }
                    }
                    Children::Choice(arms) => {
                        if let Some(Json::Arr(values)) = slot(n, "choice") {
                            for (arm, n) in arms.iter().zip(values) {
                                children(arm, n);
                            }
                        }
                    }
                    Children::Optional(inner) => {
                        if let Some(n) = slot(n, "optional") {
                            children(inner, n);
                        }
                    }
                    Children::Repeat(inner, separator) => {
                        if let Some(n) = slot(n, "repeat") {
                            children(inner, n);
                        }
                        if let (Some(separator), Some(n)) = (separator, slot(n, "separator")) {
                            children(separator, n);
                        }
                    }
                    _ => (),
                }
            }
        }
    }
    match pattern {
        Pattern::Source(symbol) => annotate_source(symbol, n),
        Pattern::Node(inner, _, items) => {
            annotate_pattern(inner, n);
            if let (Some(items), Some(n)) = (items, slot(n, "children")) {
                children(items, n);
            }
        }
        Pattern::Test(kind, term, inner) => {
            if kind != "tags" {
                if let Some(n) = slot(n, "value") {
                    annotate_term(term, n);
                }
            }
            if let Some(n) = slot(n, "expr") {
                annotate_pattern(inner, n);
            }
        }
        Pattern::Literal(term, _) => {
            if let Some(n) = slot(n, "literal") {
                annotate_term(term, n);
            }
        }
        Pattern::Range(a, b, _) => {
            if let Some(Json::Arr(xs)) = slot(n, "range") {
                if xs.len() == 2 {
                    annotate_term(a, &mut xs[0]);
                    annotate_term(b, &mut xs[1]);
                }
            }
        }
        Pattern::Path(_, inner) => {
            if let Some(n) = slot(n, "pattern") {
                annotate_pattern(inner, n);
            }
        }
        Pattern::Union(xs) | Pattern::Intersection(xs) => {
            let key = if matches!(pattern, Pattern::Union(_)) { "union" } else { "intersection" };
            if let Some(Json::Arr(values)) = slot(n, key) {
                for (pattern, n) in xs.iter().zip(values) {
                    annotate_pattern(pattern, n);
                }
            }
        }
        Pattern::Difference(a, b) => {
            if let Some(Json::Arr(xs)) = slot(n, "difference") {
                if xs.len() == 2 {
                    annotate_pattern(a, &mut xs[0]);
                    annotate_pattern(b, &mut xs[1]);
                }
            }
        }
        _ => (),
    }
}
fn annotate_term(t: &dom::Term, n: &mut Json) {
    use dom::{Arg, Term};
    match t {
        Term::Source(symbol) => annotate_source(symbol, n),
        Term::Pattern(pattern) => {
            if let Some(n) = slot(n, "pattern") {
                annotate_pattern(pattern, n);
            }
        }
        Term::If(c, t) => {
            if let Some(v) = slot(n, "if") {
                annotate_condition(c, v)
            }
            if let Some(v) = slot(n, "then") {
                annotate_term(t, v)
            }
        }
        Term::Union(xs) | Term::Intersection(xs) => {
            let k = if has(n, "union") { "union" } else { "intersection" };
            if let Some(Json::Arr(values)) = slot(n, k) {
                for (t, n) in xs.iter().zip(values) {
                    annotate_term(t, n)
                }
            }
        }
        Term::Difference(a, b) => {
            if let Some(Json::Arr(xs)) = slot(n, "difference") {
                if xs.len() == 2 {
                    annotate_term(a, &mut xs[0]);
                    annotate_term(b, &mut xs[1])
                }
            }
        }
        Term::Call(name, args) => {
            if name == "concat" {
                if let Some(Json::Arr(xs)) = slot(n, "concat") {
                    for (a, n) in args.iter().zip(xs) {
                        if let Arg::Term(t) = a {
                            annotate_term(t, n)
                        }
                    }
                }
            } else {
                if let Some(Arg::Term(r)) = args.first() {
                    if let Some(n) = slot(n, "receiver") {
                        annotate_term(r, n)
                    }
                }
                if let Some(Json::Arr(xs)) = slot(n, "args") {
                    for (a, n) in args.iter().skip(1).zip(xs) {
                        if let Arg::Term(t) = a {
                            annotate_term(t, n)
                        }
                    }
                }
            }
        }
        _ => (),
    }
}
pub(crate) fn annotate_condition(c: &dom::Cond, n: &mut Json) {
    use dom::Cond;
    match c {
        Cond::SourceQuery(_, args, location) => {
            locate(n, location.at);
            if let Some(dom::Arg::Term(receiver)) = args.first() {
                if let Some(v) = slot(n, "receiver") {
                    annotate_term(receiver, v);
                }
            }
            if let Some(Json::Arr(xs)) = slot(n, "args") {
                for ((arg, n), a) in args.iter().skip(1).zip(xs).zip(&location.targets) {
                    locate(n, Some(*a));
                    if let dom::Arg::Term(term) = arg {
                        annotate_term(term, n);
                    }
                }
            }
        }
        Cond::Boundary(_, receiver, _, location) => {
            locate(n, location.at);
            if let Some(v) = slot(n, "receiver") {
                annotate_term(receiver, v)
            }
            if let Some(Json::Arr(xs)) = slot(n, "args") {
                for (n, a) in xs.iter_mut().zip(&location.targets) {
                    locate(n, Some(*a))
                }
            }
        }
        Cond::Compare(_, a, b) => {
            if let Some(n) = slot(n, "left") {
                annotate_term(a, n)
            }
            if let Some(n) = slot(n, "right") {
                annotate_term(b, n)
            }
        }
        Cond::Matches(r, _) | Cond::Begins(r, _) | Cond::Ends(r, _) | Cond::Initial(r) | Cond::Final(r) => {
            if let Some(n) = slot(n, "receiver") {
                annotate_term(r, n)
            }
        }
        Cond::If(a, b) => {
            if let Some(n) = slot(n, "if") {
                annotate_condition(a, n)
            }
            if let Some(n) = slot(n, "then") {
                annotate_condition(b, n)
            }
        }
        Cond::Not(c) => {
            if let Some(n) = slot(n, "not") {
                annotate_condition(c, n)
            }
        }
        Cond::Any(cs) | Cond::All(cs) => {
            let k = if has(n, "any") { "any" } else { "all" };
            if let Some(Json::Arr(xs)) = slot(n, k) {
                for (c, n) in cs.iter().zip(xs) {
                    annotate_condition(c, n)
                }
            }
        }
        _ => (),
    }
}
fn annotate_channels(c: &dom::Channels, n: &mut Json) {
    if let Some(v) = slot(n, "value") {
        locate(v, c.value_at)
    }
    if let Some(v) = slot(n, "image") {
        locate(v, c.image_at)
    }
}
fn restore_defaults(expr: &mut dom::Expr, n: &Json) {
    use dom::Expr;
    match expr {
        Expr::Optional(inner, _, default) => {
            if let (Some(default), Some(value)) = (default, n.get("default")) {
                default.at = source_at(value);
            }
            if let Some(n) = n.get("optional") {
                restore_defaults(inner, n);
            }
        }
        Expr::Seq(xs) | Expr::Choice(xs) | Expr::Ranked(xs) | Expr::And(xs) => {
            let key = ["seq", "choice", "ranked", "and"].into_iter().find(|key| has(n, key)).unwrap();
            if let Some(Json::Arr(ns)) = n.get(key) {
                for (x, n) in xs.iter_mut().zip(ns) {
                    restore_defaults(x, n);
                }
            }
        }
        Expr::Capture(_, x) | Expr::Tested(_, _, x) => {
            if let Some(n) = n.get("expr") {
                restore_defaults(x, n);
            }
        }
        Expr::Repeat(x, separator, _) => {
            if let Some(n) = n.get("repeat") {
                restore_defaults(x, n);
            }
            if let (Some(x), Some(n)) = (separator, n.get("separator")) {
                restore_defaults(x, n);
            }
        }
        _ => {}
    }
}
fn annotate_defaults(expr: &dom::Expr, n: &mut Json) {
    use dom::Expr;
    match expr {
        Expr::Optional(inner, _, default) => {
            if let (Some(default), Some(value)) = (default, slot(n, "default")) {
                locate(value, default.at);
            }
            if let Some(n) = slot(n, "optional") {
                annotate_defaults(inner, n);
            }
        }
        Expr::Seq(xs) | Expr::Choice(xs) | Expr::Ranked(xs) | Expr::And(xs) => {
            let key = match expr {
                Expr::Seq(_) => "seq",
                Expr::Choice(_) => "choice",
                Expr::Ranked(_) => "ranked",
                _ => "and",
            };
            if let Some(Json::Arr(ns)) = slot(n, key) {
                for (x, n) in xs.iter().zip(ns) {
                    annotate_defaults(x, n);
                }
            }
        }
        Expr::Capture(_, x) | Expr::Tested(_, _, x) => {
            if let Some(n) = slot(n, "expr") {
                annotate_defaults(x, n);
            }
        }
        Expr::Repeat(x, separator, _) => {
            if let Some(n) = slot(n, "repeat") {
                annotate_defaults(x, n);
            }
            if let (Some(x), Some(n)) = (separator, slot(n, "separator")) {
                annotate_defaults(x, n);
            }
        }
        _ => {}
    }
}
fn annotate_rule(rule: &dom::RuleDef, n: &mut Json) {
    if let Some(args) = &rule.source.args {
        annotate_arguments(args, n);
    }
    if let (Some(call), Some(n)) = (&rule.source.instance, slot(n, "instance")) {
        annotate_arguments(&call.args, n);
    }
    annotate_channels(&rule.strings, n);
    if let Some(t) = &rule.tags {
        if let Some(n) = slot(n, "tags") {
            annotate_term(t, n)
        }
    }
    if let Some(Json::Arr(alts)) = slot(n, "alternatives") {
        for (alt, n) in rule.alternatives.iter().zip(alts) {
            if let Some(n) = slot(n, "expr") {
                annotate_expr(&alt.expr, n);
                annotate_defaults(&alt.expr, n);
            }
            annotate_channels(&alt.strings, n);
            if let Some(t) = &alt.tags {
                if let Some(n) = slot(n, "tags") {
                    annotate_term(t, n)
                }
            }
            for (path, a) in &alt.ranked_locations {
                if let Some(n) = slot(n, "expr").and_then(|n| path_slot(n, path)) {
                    record_rank(n, *a)
                }
            }
        }
    }
    if let Some(Json::Arr(cs)) = slot(n, "conditions") {
        for (c, n) in rule.conditions.iter().zip(cs) {
            annotate_condition(c, n)
        }
    }
    if let (Some(items), Some(Json::Arr(xs))) = (&rule.emit, slot(n, "emit").and_then(|n| slot(n, "items"))) {
        for (item, n) in items.iter().zip(xs) {
            let (tags, strings) = match item {
                dom::EmitItem::Capture(_, tags, a) => (tags, &a.strings),
                dom::EmitItem::Insert(tags, s) => (tags, s),
            };
            annotate_channels(strings, n);
            if let (Some(t), Some(n)) = (tags, slot(n, "tags")) {
                annotate_term(t, n)
            }
        }
    }
}
pub(crate) fn annotate_document(raw: &mut Json, dom: &Dom) {
    if let Some(Json::Arr(rules)) = slot(raw, "rules") {
        for (rule, n) in dom.rules.iter().zip(rules) {
            annotate_rule(rule, n)
        }
    }
    if let Some(Json::Arr(constants)) = slot(raw, "constants") {
        for (constant, n) in dom.constants.iter().zip(constants) {
            if let Some(n) = slot(n, "value") {
                annotate_term(&constant.value, n);
            }
        }
    }
    if let Some(Json::Arr(implications)) = slot(raw, "implications") {
        for (implication, n) in dom.implications.iter().zip(implications) {
            if let Some(n) = slot(n, "if") {
                annotate_term(&implication.antecedent, n);
            }
            if let Some(n) = slot(n, "then") {
                annotate_term(&implication.consequent, n);
            }
        }
    }
    if let Some(Json::Arr(ds)) = slot(raw, "directives") {
        for (d, n) in dom.directives.iter().zip(ds) {
            if let (Some(cs), Some(Json::Arr(xs))) = (&d.conditions, slot(n, "conditions")) {
                for (c, n) in cs.iter().zip(xs) {
                    annotate_condition(c, n)
                }
            }
        }
    }
}

fn path_slot<'a>(mut n: &'a mut Json, path: &str) -> Option<&'a mut Json> {
    for key in path.split('/').filter(|s| !s.is_empty()) {
        n = slot(n, key)?
    }
    Some(n)
}

pub(crate) fn restore_document(dom: &mut Dom, raw: &Json) {
    for (r, n) in dom.rules.iter_mut().zip(list(get(raw, "rules"))) {
        restore_rule(r, n)
    }
    for (d, n) in dom.directives.iter_mut().zip(list(get(raw, "directives"))) {
        if let Some(cs) = &mut d.conditions {
            for (c, n) in cs.iter_mut().zip(list(get(n, "conditions"))) {
                cond(c, n)
            }
        }
    }
}
