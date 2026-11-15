//! The DOM validator (engine §9.3 step 5), for source grammars and supplied
//! DOMs alike: the envelope and the declaration positions, then each
//! declaration in the order of its position, its structural pass and then
//! its semantic pass, and the bound on nesting last.
use super::shape::{node_at, Shapes};
use super::*;

pub(crate) fn engine_tag(name: &str) -> bool {
    crate::unicode_properties::identity(name).is_some()
}

pub(crate) fn restored_span(mut value: &Json) -> bool {
    for _ in 0..=256 {
        match value.get("method").and_then(Json::as_str) {
            Some("without-elision" | "without-elision-except") => return true,
            Some("onward") => {
                let Some(inner) = value.get("receiver") else { return false };
                value = inner;
            }
            _ => return false,
        }
    }
    false
}

/// Why known literal endpoints do not form an ordered scalar interval.
pub(crate) fn literal_range_problem(left: &Json, right: &Json) -> Option<&'static str> {
    let ends = [left.get("string").and_then(Json::as_str), right.get("string").and_then(Json::as_str)];
    if ends.iter().flatten().any(|end| end.chars().count() != 1) {
        return Some("a range endpoint is one scalar");
    }
    if matches!(ends, [Some(a), Some(b)] if a > b) {
        return Some("a range starts above its end");
    }
    None
}

/// A fault of a DOM (engine §9.3 step 5): the problem, where it stands,
/// and whether it is a ranked-choice syntax fault, the one kind that
/// overrides an earlier semantic fault.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DomFault {
    pub problem: String,
    pub at: Option<(usize, usize)>,
    pub ranked: bool,
}

impl DomFault {
    pub(crate) fn new(problem: impl Into<String>, at: Option<(usize, usize)>) -> Self {
        let problem = problem.into();
        let ranked = problem.starts_with("ranked-choice-syntax");
        DomFault { problem, at, ranked }
    }
}

const ROOTS: [&str; 5] = ["rules", "directives", "constants", "classifiers", "implications"];

fn exact(value: &Json, fields: &[&str]) -> bool {
    value.as_object().is_some_and(|members| {
        members.iter().all(|(name, _)| name.starts_with('\0') || fields.contains(&name.as_str()))
    })
}

/// The declarations in the order of their positions: directives,
/// constants, classifiers, implications and rules, each with its index in
/// its own list.
fn declarations(dom: &Json) -> Vec<(&'static str, usize, &Json)> {
    let mut decls: Vec<(&'static str, usize, &Json, (usize, usize))> = Vec::new();
    for (kind, key) in [
        ("directive", "directives"),
        ("constant", "constants"),
        ("classifier", "classifiers"),
        ("implication", "implications"),
        ("rule", "rules"),
    ] {
        if let Some(items) = dom.get(key).and_then(Json::as_array) {
            for (index, item) in items.iter().enumerate() {
                let at = position(item).unwrap_or((1, 1));
                decls.push((kind, index, item, at));
            }
        }
    }
    decls.sort_by_key(|(_, _, _, at)| *at);
    decls.into_iter().map(|(kind, index, item, _)| (kind, index, item)).collect()
}

/// The whole validation of a DOM, in the order of engine §9.3 step 5.
/// With no typed DOM, one is decoded from the JSON for the semantic pass.
pub(crate) fn validate(dom: &Json, unicode: &Unicode, expanded: bool, typed: Option<&mut Dom>) -> Option<DomFault> {
    if let Some(fault) = envelope_fault(dom).or_else(|| positions_fault(dom)).or_else(|| names_fault(dom)) {
        return Some(fault);
    }
    let mut typed = typed;
    let mut shapes = Shapes::new(unicode, expanded);
    let mut first_semantic: Option<DomFault> = None;
    for (kind, index, item) in declarations(dom) {
        if let Some(fault) = shapes.declaration(kind, item) {
            // A ranked-choice syntax fault stands before every other, and
            // any other structural fault before a later semantic one.
            if fault.ranked {
                return Some(fault);
            }
            if first_semantic.is_none() {
                return Some(fault);
            }
            continue;
        }
        if first_semantic.is_some() {
            continue;
        }
        first_semantic = match typed.as_deref_mut() {
            Some(typed) => semantic(kind, item, typed, index, unicode, expanded),
            None => {
                // The declaration alone, decoded: its structural pass
                // accepted it, so it decodes.
                let single = single_declaration(kind, item);
                match decode_nodes(&single) {
                    Ok(mut decoded) => semantic(kind, item, &mut decoded, 0, unicode, expanded),
                    Err(problem) => Some(DomFault::new(problem, node_at(item))),
                }
            }
        };
    }
    first_semantic.or_else(|| shapes.first_deep.map(|at| DomFault::new("nested too deeply", Some(at))))
}

/// A DOM of one declaration.
fn single_declaration(kind: &str, item: &Json) -> Json {
    let key = match kind {
        "directive" => "directives",
        "constant" => "constants",
        "classifier" => "classifiers",
        "implication" => "implications",
        _ => "rules",
    };
    let mut fields = vec![("format".to_string(), Json::Int(DOM_FORMAT))];
    for root in ROOTS {
        fields.push((root.to_string(), Json::Arr(if root == key { vec![item.clone()] } else { Vec::new() })));
    }
    Json::Obj(fields)
}

fn envelope_fault(dom: &Json) -> Option<DomFault> {
    if crate::parameters::nodes(dom).any(|node| node.get(crate::parameters::SOURCE).is_some()) {
        return Some(DomFault::new("a private source annotation in a supplied DOM", None));
    }
    if !exact(dom, &["format", "rules", "directives", "constants", "classifiers", "implications"])
        || dom.get("format").and_then(Json::as_int) != Some(DOM_FORMAT)
        || ROOTS.iter().any(|key| !dom.get(key).is_some_and(|value| value.as_array().is_some()))
    {
        return Some(DomFault::new("not a DOM of this format", None));
    }
    None
}

/// Every declaration has a valid position, then no two share one.
fn positions_fault(dom: &Json) -> Option<DomFault> {
    let items = || ROOTS.into_iter().flat_map(|key| dom.get(key).and_then(Json::as_array).into_iter().flatten());
    if items().any(|item| item.as_object().is_none() || !is_position(item.get("at"))) {
        return Some(DomFault::new("a malformed declaration position", None));
    }
    let mut positions = FxSet::default();
    for item in items() {
        let at = position(item).ok()?;
        if !positions.insert(at) {
            return Some(DomFault::new("two items at one position", Some(at)));
        }
    }
    None
}

fn names_fault(dom: &Json) -> Option<DomFault> {
    // The first statement that is not a %names directive.
    let first_statement = ROOTS
        .into_iter()
        .flat_map(|key| dom.get(key).and_then(Json::as_array).into_iter().flatten().map(move |item| (key, item)))
        .filter(|(key, item)| *key != "directives" || item.get("name").and_then(Json::as_str) != Some("names"))
        .filter_map(|(_, item)| position(item).ok())
        .min()?;
    dom.get("directives")
        .and_then(Json::as_array)
        .into_iter()
        .flatten()
        .filter(|item| item.get("name").and_then(Json::as_str) == Some("names"))
        .filter_map(|item| position(item).ok())
        .filter(|at| *at > first_statement)
        .min()
        .map(|at| DomFault::new("%names must precede every other statement", Some(at)))
}

/// The structural pass alone, for the expanded DOMs of template expansion.
pub(crate) fn structure_problem(dom: &Json, unicode: &Unicode, expanded: bool) -> Option<String> {
    if let Some(fault) = envelope_fault(dom).or_else(|| positions_fault(dom)).or_else(|| names_fault(dom)) {
        return Some(fault.problem);
    }
    let mut shapes = Shapes::new(unicode, expanded);
    for (kind, _, item) in declarations(dom) {
        if let Some(fault) = shapes.declaration(kind, item) {
            return Some(fault.problem);
        }
    }
    shapes.first_deep.map(|_| "nested too deeply".to_string())
}

/// The semantic pass alone, for the expanded DOMs of template expansion.
pub(crate) fn decoded_problem(raw: &Json, dom: &mut Dom, unicode: &Unicode, expanded: bool) -> Option<String> {
    declarations(raw)
        .into_iter()
        .find_map(|(kind, index, item)| semantic(kind, item, dom, index, unicode, expanded))
        .map(|fault| fault.problem)
}

/// Whether an argument reads or declares a capture.
fn reads_capture(root: &Json) -> bool {
    crate::parameters::nodes(root).any(|node| node.get("capture").is_some() || node.get("captured").is_some())
}

/// The first argument of a call or a rule's head that reads or declares a
/// capture, in the order written, at the nearest node with a position.
fn capture_argument(root: &Json, fallback: Option<(usize, usize)>) -> Option<DomFault> {
    let mut stack = vec![(root, node_at(root).or(fallback))];
    while let Some((node, parent_at)) = stack.pop() {
        match node {
            Json::Arr(items) => stack.extend(items.iter().rev().map(|item| (item, parent_at))),
            Json::Obj(fields) => {
                let here = node_at(node).or(parent_at);
                if node.get("call").is_some() || node.get("alternatives").is_some() {
                    if let Some(args) = node.get("args").and_then(Json::as_array) {
                        if let Some(arg) = args.iter().find(|arg| reads_capture(arg)) {
                            return Some(DomFault::new(
                                "an argument cannot read or declare captures",
                                node_at(arg).or(here),
                            ));
                        }
                    }
                }
                stack.extend(
                    fields
                        .iter()
                        .rev()
                        .filter(|(key, _)| key != "at" && !key.starts_with('\0'))
                        .map(|(_, value)| (value, here)),
                );
            }
            _ => {}
        }
    }
    None
}

/// The first part of a constant's value or an implication's side that is
/// not closed or holds an engine-tag literal, in the order written, at the
/// nearest part with a position.
fn closed_term_fault(root: &Term, closed_for: &str, fallback: Option<(usize, usize)>) -> Option<DomFault> {
    let mut pending = vec![(root, root.at().or(fallback))];
    while let Some((term, parent_at)) = pending.pop() {
        let here = term.at().or(parent_at);
        let fault = |problem: String| Some(DomFault::new(problem, here));
        match term {
            Term::Capture(..) => return fault(format!("{closed_for} is a closed term, and holds no capture")),
            Term::If(..) => return fault(format!("{closed_for} is a closed term, and holds no guarded term")),
            Term::Tag(name, ..) if name.starts_with('_') => {
                return fault(format!("{closed_for} cannot contain an engine-tag literal"))
            }
            Term::Call(name, args, ..) if name != "concat" && name != "split" && name != "ngrams" => {
                if let Some(Arg::Term(receiver)) = args.first() {
                    if let Some(fault) = closed_term_fault(receiver, closed_for, here) {
                        return Some(fault);
                    }
                }
                return fault(format!("{closed_for} cannot read an input method"));
            }
            Term::Call(_, args, ..) => pending.extend(args.iter().rev().filter_map(|arg| match arg {
                Arg::Term(term) => Some((term, here)),
                _ => None,
            })),
            Term::Union(items, ..) | Term::Intersection(items, ..) => {
                pending.extend(items.iter().rev().map(|item| (item, here)))
            }
            Term::Difference(left, right, ..) => {
                pending.push((right, here));
                pending.push((left, here));
            }
            _ => {}
        }
    }
    None
}

/// Where `target` stands within `root`: its own position, or that of the
/// nearest expression around it that has one, or `fallback`.
fn enclosing_at_in(root: &Expr, target: &Expr, fallback: Option<(usize, usize)>) -> Option<(usize, usize)> {
    if let Some(at) = target.at() {
        return Some(at);
    }
    let mut pending = vec![(root, root.at().or(fallback))];
    while let Some((expr, enclosing)) = pending.pop() {
        let here = expr.at().or(enclosing);
        if std::ptr::eq(expr, target) {
            return here;
        }
        match expr {
            Expr::Seq(items, _) | Expr::Choice(items, _) | Expr::Ranked(items, _) | Expr::And(items, _) => {
                pending.extend(items.iter().rev().map(|item| (item, here)));
            }
            Expr::Optional(inner, _, _, _)
            | Expr::Capture(_, inner, _)
            | Expr::Splice(inner, _)
            | Expr::Tested(_, _, inner, _) => pending.push((inner, here)),
            Expr::Repeat(inner, separator, _, _) => {
                if let Some(separator) = separator {
                    pending.push((separator, here));
                }
                pending.push((inner, here));
            }
            _ => {}
        }
    }
    fallback
}

/// The captures of an expression in the order written.
fn captures_in_order<'e>(root: &'e Expr, out: &mut Vec<&'e Expr>) {
    let mut pending = vec![root];
    while let Some(expr) = pending.pop() {
        match expr {
            Expr::Capture(_, inner, _) => {
                out.push(expr);
                pending.push(inner);
            }
            Expr::Seq(items, _) | Expr::Choice(items, _) | Expr::Ranked(items, _) | Expr::And(items, _) => {
                pending.extend(items.iter().rev());
            }
            Expr::Optional(inner, _, _, _) | Expr::Splice(inner, _) | Expr::Tested(_, _, inner, _) => {
                pending.push(inner)
            }
            Expr::Repeat(inner, separator, _, _) => {
                if let Some(separator) = separator {
                    pending.push(separator);
                }
                pending.push(inner);
            }
            _ => {}
        }
    }
}

/// The fault of a term that must be a tag set, at the construct that holds
/// it, or at the clause's term when the whole term is of another type.
fn tag_clause_fault(term: &Term, term_at: Option<(usize, usize)>, fallback: (usize, usize)) -> Option<DomFault> {
    match term_type_in(term, &|_| Type::Any) {
        Err(fault) => Some(DomFault::new(fault.problem, fault.node_at.or(Some(fallback)))),
        Ok(ty) => expected_problem(ty, Type::Tags)
            .map(|problem| DomFault::new(problem, term_at.or_else(|| term.at()).or(Some(fallback)))),
    }
}

fn semantic(
    kind: &str,
    raw: &Json,
    dom: &mut Dom,
    index: usize,
    unicode: &Unicode,
    expanded: bool,
) -> Option<DomFault> {
    let decl_at = node_at(raw);
    match kind {
        "directive" => capture_argument(raw, decl_at),
        "constant" => {
            if let Some(fault) = capture_argument(raw, decl_at) {
                return Some(fault);
            }
            let constant = &dom.constants[index];
            if let Some(fault) = closed_term_fault(&constant.value, "a constant's value", decl_at) {
                return Some(fault);
            }
            let value_at = constant.value.at().or(decl_at);
            constant_value_type(&constant.value, constant.redefine, &|_| Type::Any)
                .err()
                .map(|fault| DomFault::new(fault.problem, fault.node_at.or(value_at)))
        }
        "implication" => {
            if let Some(fault) = capture_argument(raw, decl_at) {
                return Some(fault);
            }
            let implication = &dom.implications[index];
            for side in [&implication.antecedent, &implication.consequent] {
                let side_at = side.at().or(decl_at);
                if let Some(fault) = closed_term_fault(side, "a side of an implication", side_at) {
                    return Some(fault);
                }
                match term_type_in(side, &|_| Type::Any) {
                    Err(fault) => {
                        return Some(DomFault::new(
                            format!("a side of an implication is a tag set: {}", fault.problem),
                            fault.node_at.or(side_at),
                        ));
                    }
                    Ok(ty) => {
                        if let Some(problem) = expected_problem(ty, Type::Tags) {
                            return Some(DomFault::new(
                                format!("a side of an implication is a tag set: {problem}"),
                                side_at,
                            ));
                        }
                    }
                }
            }
            None
        }
        "rule" => semantic_rule(raw, dom, index, unicode, expanded),
        _ => None,
    }
}

fn semantic_rule(raw: &Json, dom: &mut Dom, index: usize, _unicode: &Unicode, _expanded: bool) -> Option<DomFault> {
    let rule = &mut dom.rules[index];
    let decl_at = rule.at;
    let instance = rule.source.instance.is_some();
    if !instance {
        // The header's tags: their type, then whether they read their own.
        if let Some(tags) = &rule.tags {
            if let Some(fault) = tag_clause_fault(tags, rule.tags_at.term, decl_at) {
                return Some(fault);
            }
            if crate::notation::reads_own_tags(tags) {
                return Some(DomFault::new(
                    "a constituent's tags cannot be made of its own: $.tags or $.classes",
                    rule.tags_at.clause.or_else(|| tags.at()).or(Some(decl_at)),
                ));
            }
        }
        for alternative in &rule.alternatives {
            let alt_at = alternative.at.or(Some(decl_at));
            let duplicates = crate::clauses::duplicate_captures(&alternative.expr);
            if let Some(first) =
                duplicates.iter().min_by_key(|capture| capture.at().unwrap_or((usize::MAX, usize::MAX)))
            {
                if let Expr::Capture(name, _, _) = first {
                    return Some(DomFault::new(
                        format!("the capture ${name} is read twice by one production of the alternative"),
                        enclosing_at_in(&alternative.expr, first, alt_at),
                    ));
                }
            }
            let items = crate::clauses::item_capture_names(&alternative.expr);
            if !items.is_empty() {
                let mut captures = Vec::new();
                captures_in_order(&alternative.expr, &mut captures);
                let mut seen: Vec<&str> = Vec::new();
                for capture in captures {
                    let Expr::Capture(name, _, _) = capture else { continue };
                    if !items.contains(&name.as_str()) {
                        continue;
                    }
                    if seen.contains(&name.as_str()) {
                        return Some(DomFault::new(
                            format!(
                                "the item capture ${name} is read again: the name of an item capture stands once in its alternative"
                            ),
                            enclosing_at_in(&alternative.expr, capture, alt_at),
                        ));
                    }
                    seen.push(name);
                }
            }
            if let Some(tags) = &alternative.tags {
                if let Some(fault) = tag_clause_fault(tags, alternative.tags_at.term, decl_at) {
                    return Some(fault);
                }
                if crate::notation::reads_own_tags(tags) {
                    return Some(DomFault::new(
                        "a constituent's tags cannot be made of its own: $.tags or $.classes",
                        alternative.tags_at.clause.or_else(|| tags.at()).or(alt_at),
                    ));
                }
            }
        }
    }
    if let Some(fault) = capture_argument(raw, Some(decl_at)) {
        return Some(fault);
    }
    if instance {
        return None;
    }
    let projected;
    let checked = if crate::parameters::unresolved(raw) {
        projected = match super::partial::rule(rule) {
            Ok(rule) => rule,
            Err(_) => return Some(DomFault::new("a malformed partial rule", Some(decl_at))),
        };
        &projected
    } else {
        &*rule
    };
    if let Some(fault) = rule_type_fault(checked, &|_| Type::Any) {
        return Some(DomFault::new(fault.problem, fault.node_at.or(Some(decl_at))));
    }
    if let Some(items) = &rule.emit {
        let mut names: Vec<&str> = Vec::new();
        for item in items {
            if let EmitItem::Capture(name, _, attachments) = item {
                if !name.is_empty() {
                    names.push(name);
                }
                names.extend(attachments.names());
            }
        }
        let mut seen = FxSet::default();
        if names.iter().any(|name| !seen.insert(*name)) {
            return Some(DomFault::new("an emission lists a capture twice", rule.places.emit_at.or(Some(decl_at))));
        }
    }
    if let Some((problem, at)) = crate::boundary::definition_problem(checked) {
        return Some(DomFault::new(problem, at.or(Some(decl_at))));
    }
    if rule.erased && (rule.emit.is_some() || rule.strings.value.is_some() || rule.strings.image.is_some()) {
        return Some(DomFault::new("a malformed erased rule", Some(decl_at)));
    }
    if rule.erased && rule.alternatives.iter().any(|a| a.strings.value.is_some() || a.strings.image.is_some()) {
        return Some(DomFault::new("a recipe beside erasure", Some(decl_at)));
    }
    if let Some(problem) = crate::diagnostics::definition_problem(rule) {
        return Some(DomFault::new(problem, Some(decl_at)));
    }
    // A bare empty set in a Boolean position has no kind (engine §10).
    if checked.conditions.iter().any(crate::clauses::has_bare_empty_set) {
        return Some(DomFault::new(format!("a condition of {} is the empty set", rule.name), Some(decl_at)));
    }
    // Retain the detailed issue and the deferred result on these nodes.
    let result = crate::clauses::check_definition(checked, true);
    if let Some(issue) = result.problem {
        return Some(DomFault::new(issue.message, Some(decl_at)));
    }
    rule.deferred_emission = result.deferred;
    None
}
