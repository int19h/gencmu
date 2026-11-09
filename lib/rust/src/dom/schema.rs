//! Schema validation for grammar DOMs. The work list bounds the complete DOM
//! before conversion constructs any recursively owned term or expression.
use super::*;
mod source;

/// Where an expression stands, as far as a capture may stand there (engine
/// §3.5, §9): inside an elidable optional, which seals everything in it,
/// inside a chain, inside flat braces, where a capture is an item capture,
/// and inside a ranked group since the innermost flat braces.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct ExprFlags {
    pub sealed: bool,
    pub chain: bool,
    pub item: bool,
    pub ranked: bool,
    pub query: bool,
}

#[derive(Clone, Copy)]
pub(crate) enum Part {
    Expr { whole: bool, flags: ExprFlags },
    Term,
    Body,
    RecipeAtom,
    Condition,
    String,
    Recipe,
    Pattern,
    PatternNode,
    PatternItem,
    Argument,
    Call,
    Target,
    Requirements,
}

fn exact(value: &Json, required: &[&str], optional: &[&str]) -> bool {
    value.as_object().is_some_and(|members| {
        required.iter().all(|name| value.get(name).is_some())
            && members.iter().all(|(name, _)| required.contains(&name.as_str()) || optional.contains(&name.as_str()))
    })
}

pub(crate) fn engine_tag(name: &str) -> bool {
    crate::unicode_properties::identity(name).is_some()
}

fn tag(name: &str) -> bool {
    engine_tag(name) || name.starts_with(|c: char| c.is_ascii_uppercase()) && is_name(name)
}

fn rule_name(name: &str, unicode: &Unicode, expanded: bool) -> bool {
    unicode.is_emoji_name(name)
        || name.starts_with(|c: char| c.is_ascii_lowercase()) && is_name(name)
        || expanded && name.contains('(') && name.ends_with(')')
}

fn feature(name: &str) -> bool {
    !name.contains("--")
        && name.starts_with(|c: char| c.is_ascii_alphabetic())
        && name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
}

fn guards(value: Option<&Json>, _gates: bool) -> bool {
    value.and_then(Json::as_array).is_some_and(|items| {
        items.iter().all(|item| {
            exact(item, &["feature", "kind", "negated"], &[])
                && item.get("feature").and_then(Json::as_str).is_some_and(feature)
                && matches!(
                    (item.get("kind").and_then(Json::as_str), item.get("negated")),
                    (Some("gate"), Some(Json::Bool(_)))
                )
        })
    })
}

fn bare_capture(value: &Json) -> bool {
    exact(value, &["capture"], &[])
        && value.get("capture").and_then(Json::as_str).is_some_and(|name| name.is_empty() || is_capture_name(name))
}

fn span(value: &Json) -> bool {
    bare_capture(value)
        || source::leaf(value)
        || matches!(
            value.get("method").and_then(Json::as_str),
            Some(
                "without-elision"
                    | "without-elision-except"
                    | "first-token"
                    | "last-token"
                    | "tokens-after-first"
                    | "onward"
                    | "following-tokens"
                    | "preceding-tokens"
            )
        )
}

fn forest(value: &Json) -> bool {
    source::leaf(value) || matches!(value.get("method").and_then(Json::as_str), Some("parse" | "error-free"))
}

fn body_json_problem(body: &Json) -> Option<&'static str> {
    let marker = "a remainder stands at one outer edge of a parse argument";
    let mut pending = vec![body];
    if let Some(items) = body.get("seq").and_then(Json::as_array) {
        let markers: Vec<_> = items
            .iter()
            .enumerate()
            .filter_map(|(index, item)| item.get("remainder").is_some().then_some(index))
            .collect();
        if !markers.is_empty() {
            if markers.len() > 2
                || markers.iter().any(|&index| index != 0 && index + 1 != items.len())
                || items.iter().filter(|item| item.get("remainder").is_none()).count() < 1
            {
                return Some(marker);
            }
            pending = items.iter().filter(|item| item.get("remainder").is_none()).collect();
        }
    }
    while let Some(expression) = pending.pop() {
        crate::work::count(crate::work::Work::Walked, 1);
        if expression.get("capture").is_some() {
            return Some("a parse argument cannot declare captures");
        }
        if expression.get("remainder").is_some() {
            return Some(marker);
        }
        for key in ["seq", "choice", "ranked", "and"] {
            if let Some(items) = expression.get(key).and_then(Json::as_array) {
                pending.extend(items);
            }
        }
        for key in ["optional", "repeat", "separator", "splice", "expr"] {
            if let Some(inner) = expression.get(key) {
                pending.push(inner);
            }
        }
    }
    None
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

fn string_atom(value: &Json) -> bool {
    exact(value, &["string"], &[]) && is_str(value.get("string"))
        || exact(value, &["const", "at"], &[])
        || value.get("param").is_some()
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

fn base(value: &Json, unicode: &Unicode, expanded: bool) -> bool {
    source::leaf(value)
        || exact(value, &["ref"], &[])
            && value
                .get("ref")
                .and_then(Json::as_str)
                .is_some_and(|name| rule_name(name, unicode, expanded) || tag(name))
        || exact(value, &["literal"], &[])
        || exact(value, &["range"], &[])
        || exact(value, &["wildcard"], &[]) && is_true(value.get("wildcard"))
}

fn tested_base(value: &Json, unicode: &Unicode, expanded: bool) -> bool {
    let symbol = |value: &Json| base(value, unicode, expanded) || value.get("splice").is_some();
    symbol(value)
        || value.get("test").and_then(Json::as_str).is_some_and(|op| match (op, value.get("expr")) {
            ("tags", Some(inner)) => symbol(inner),
            ("=" | "≠", Some(inner)) => {
                symbol(inner)
                    || inner.get("test").and_then(Json::as_str) == Some("tags") && inner.get("expr").is_some_and(symbol)
            }
            _ => false,
        })
}

fn recipe_atom(value: &Json) -> bool {
    if string_atom(value) {
        return true;
    }
    let Some(receiver) = value.get("receiver") else { return false };
    match value.get("method").and_then(Json::as_str) {
        Some("value" | "image") => {
            bare_capture(receiver)
                || receiver.get("method").and_then(Json::as_str) == Some("emitted")
                    && receiver.get("receiver").is_some_and(bare_capture)
        }
        Some("source-text" | "decomposed-source-text" | "verbatim-text") => bare_capture(receiver),
        _ => false,
    }
}

pub(crate) fn structure_problem(dom: &Json, unicode: &Unicode, expanded: bool) -> Option<String> {
    if crate::parameters::nodes(dom).any(|node| node.get(crate::parameters::SOURCE).is_some()) {
        return Some("a private source annotation in a supplied DOM".into());
    }
    if !exact(dom, &["format", "rules", "directives", "constants", "classifiers", "implications"], &[])
        || dom.get("format").and_then(Json::as_int) != Some(DOM_FORMAT)
    {
        return Some("not a DOM of this format".into());
    }
    let rule = |name: &str| rule_name(name, unicode, expanded);
    let mut pending = Vec::new();
    let mut positions = FxSet::default();
    for name in ["rules", "directives", "constants", "classifiers", "implications"] {
        let Some(items) = dom.get(name).and_then(Json::as_array) else {
            return Some("missing declaration array".into());
        };
        for item in items {
            if !is_position(item.get("at")) {
                return Some("a malformed declaration position".into());
            }
            let at = position(item).ok()?;
            if !positions.insert(at) {
                return Some("two items at one position".into());
            }
            if name != "rules" && crate::parameters::nodes(item).any(|node| node.get("param").is_some()) {
                return Some("an undeclared or malformed parameter".into());
            }
            match name {
                "directives" => {
                    let name = item.get("name").and_then(Json::as_str);
                    let valid = if name == Some("ambiguity-resolution") {
                        item.get("args").is_none()
                            && item.get("steps").is_some_and(|steps| {
                                crate::dom::steps_from_json(steps).is_ok_and(|steps| crate::dom::valid_steps(&steps))
                            })
                    } else {
                        let Some(args) = item.get("args").and_then(Json::as_array) else {
                            return Some("a malformed directive".into());
                        };
                        let args: Option<Vec<_>> = args.iter().map(Json::as_str).collect();
                        let Some(args) = args else { return Some("a malformed directive".into()) };
                        match name {
                            Some("stage" | "extend-stage" | "redefine-stage") => {
                                matches!(&args[..], [name] if name.starts_with(|c: char| c.is_ascii_lowercase()) && is_name(name))
                            }
                            Some("include" | "names") => args.len() == 1,
                            Some("features") => !args.is_empty() && args.iter().all(|name| feature(name)),
                            Some("elision-only") => args.is_empty(),
                            _ => false,
                        }
                    };
                    if !valid {
                        return Some("a malformed directive".into());
                    }
                    if name == Some("ambiguity-resolution") {
                        for step in item.get("steps").and_then(Json::as_array).unwrap() {
                            if let Some(operand) = step.get("pattern") {
                                pending.push((
                                    if operand.get("const").is_some() { Part::Term } else { Part::Pattern },
                                    operand,
                                    0,
                                ));
                            }
                        }
                    }
                    if let Some(value) = item.get("conditions") {
                        let Some(conditions) = value.as_array().filter(|items| !items.is_empty()) else {
                            return Some("malformed feature conditions".into());
                        };
                        if item.get("name").and_then(Json::as_str) != Some("features") {
                            return Some("conditions on another directive".into());
                        }
                        pending.extend(conditions.iter().map(|value| (Part::Condition, value, 0)));
                    }
                }
                "rules" => {
                    if !crate::parameters::unresolved(item) {
                        if let Some(problem) = boundary_problem(item) {
                            return Some(problem.into());
                        }
                    }
                    if let Some(problem) = source::head(item, &mut pending) {
                        return Some(problem.into());
                    }
                    if item.get("instance").is_some() {
                        if !item.get("name").and_then(Json::as_str).is_some_and(rule)
                            || !matches!(item.get("op").and_then(Json::as_str), Some("define" | "redefine"))
                        {
                            return Some("a malformed instance binding".into());
                        }
                        continue;
                    }
                    if !exact(
                        item,
                        &["name", "op", "alternatives", "conditions", "at"],
                        &[
                            "tags",
                            "value",
                            "image",
                            "emit",
                            "erased",
                            "params",
                            "args",
                            "error",
                            "warning",
                            "suppressWarnings",
                        ],
                    ) || !item.get("name").and_then(Json::as_str).is_some_and(rule)
                        || !matches!(item.get("op").and_then(Json::as_str), Some("define" | "extend" | "redefine"))
                    {
                        return Some("a malformed rule".into());
                    }
                    if !matches!(item.get("erased"), None | Some(Json::Bool(true)))
                        || item.get("erased").is_some()
                            && ["emit", "value", "image"].iter().any(|name| item.get(name).is_some())
                    {
                        return Some("an erased rule with an emission or recipe".into());
                    }
                    if item.get("error").is_some() && item.get("warning").is_some() {
                        return Some("a rule cannot report both an error and a warning".into());
                    }
                    if let Some(codes) = item.get("suppressWarnings") {
                        if !codes.as_array().is_some_and(|codes| {
                            !codes.is_empty()
                                && (!codes.iter().any(|c| c.as_str() == Some("_")) || codes.len() == 1)
                                && codes.iter().all(|c| c.as_str().is_some_and(|c| c == "_" || feature(c)))
                        }) {
                            return Some("a malformed suppression list".into());
                        }
                    }
                    for key in ["tags", "value", "image", "error", "warning"] {
                        if let Some(value) = item.get(key) {
                            pending.push((if key == "tags" { Part::Term } else { Part::Recipe }, value, 0));
                        }
                    }
                    let Some(conditions) = item.get("conditions").and_then(Json::as_array) else {
                        return Some("a malformed condition list".into());
                    };
                    pending.extend(conditions.iter().map(|value| (Part::Condition, value, 0)));
                    let Some(alts) =
                        item.get("alternatives").and_then(Json::as_array).filter(|items| !items.is_empty())
                    else {
                        return Some("an empty alternative list".into());
                    };
                    for alt in alts {
                        if !exact(alt, &["guards", "expr"], &["tags", "value", "image"])
                            || !guards(alt.get("guards"), false)
                        {
                            return Some("a malformed alternative".into());
                        }
                        if item.get("erased").is_some() && ["value", "image"].iter().any(|key| alt.get(key).is_some()) {
                            return Some("an erased rule has a recipe".into());
                        }
                        pending.push((
                            Part::Expr { whole: true, flags: ExprFlags::default() },
                            alt.get("expr").unwrap(),
                            0,
                        ));
                        for key in ["tags", "value", "image"] {
                            if let Some(value) = alt.get(key) {
                                pending.push((if key == "tags" { Part::Term } else { Part::Recipe }, value, 0));
                            }
                        }
                    }
                    if let Some(emit) = item.get("emit") {
                        if !exact(emit, &["items"], &[]) {
                            return Some("a malformed emission".into());
                        }
                        let Some(items) = emit.get("items").and_then(Json::as_array).filter(|items| !items.is_empty())
                        else {
                            return Some("an empty emission list".into());
                        };
                        let mut names = FxSet::default();
                        for output in items {
                            let capture = output.get("capture").and_then(Json::as_str);
                            let insert = is_true(output.get("insert"));
                            if !(capture.is_some() ^ insert)
                                || !exact(
                                    output,
                                    if insert { &["insert"] } else { &["capture"] },
                                    &["tags", "value", "image", "before", "after"],
                                )
                            {
                                return Some("a malformed emission item".into());
                            }
                            if let Some(name) = capture.filter(|name| !name.is_empty()) {
                                if !is_capture_name(name) || !names.insert(name) {
                                    return Some("a malformed carrier".into());
                                }
                            }
                            for side in ["before", "after"] {
                                if let Some(list) = output.get(side) {
                                    let Some(list) = list.as_array().filter(|items| !items.is_empty()) else {
                                        return Some("a malformed attachment list".into());
                                    };
                                    if capture.is_none() || capture == Some("") {
                                        return Some("attachments require a named carrier".into());
                                    }
                                    for name in list {
                                        let Some(name) = name.as_str().filter(|name| is_capture_name(name)) else {
                                            return Some("a malformed attachment".into());
                                        };
                                        if !names.insert(name) {
                                            return Some("a repeated emission capture".into());
                                        }
                                    }
                                }
                            }
                            for key in ["tags", "value", "image"] {
                                if let Some(value) = output.get(key) {
                                    pending.push((if key == "tags" { Part::Term } else { Part::Recipe }, value, 0));
                                }
                            }
                        }
                    }
                }
                "constants" => {
                    if !exact(item, &["name", "op", "value", "at"], &[])
                        || !item.get("name").and_then(Json::as_str).is_some_and(is_constant_name)
                        || !matches!(item.get("op").and_then(Json::as_str), Some("define" | "redefine"))
                    {
                        return Some("a malformed constant".into());
                    }
                    pending.push((Part::Term, item.get("value").unwrap(), 0));
                }
                "classifiers" => {
                    if !exact(item, &["name", "entries", "at"], &[])
                        || !item.get("name").and_then(Json::as_str).is_some_and(is_classifier_name)
                    {
                        return Some("a malformed classifier".into());
                    }
                    let Some(entries) = item.get("entries").and_then(Json::as_array) else {
                        return Some("a malformed entry list".into());
                    };
                    for entry in entries {
                        let class = entry.get("class").and_then(Json::as_str);
                        if !exact(entry, &["guards", "keys", "op", "class", "at"], &[])
                            || !guards(entry.get("guards"), true)
                            || !matches!(entry.get("op").and_then(Json::as_str), Some("∈" | "∉"))
                            || !is_position(entry.get("at"))
                            || !class.is_some_and(|name| {
                                tag(name) && !engine_tag(name) && name.ends_with(|c: char| c.is_ascii_uppercase())
                            })
                        {
                            return Some("a malformed classifier entry".into());
                        }
                        let Some(keys) = entry.get("keys").and_then(Json::as_array).filter(|keys| !keys.is_empty())
                        else {
                            return Some("an empty classifier key list".into());
                        };
                        pending.extend(keys.iter().map(|key| (Part::String, key, 0)));
                    }
                }
                "implications" => {
                    if !exact(item, &["if", "then", "at"], &[]) {
                        return Some("a malformed implication".into());
                    }
                    pending.push((Part::Term, item.get("if").unwrap(), 0));
                    pending.push((Part::Term, item.get("then").unwrap(), 0));
                }
                _ => unreachable!(),
            }
        }
    }
    parts_problem(pending, unicode, expanded)
}

fn literal_split_problem(declaration: &Json) -> Option<&'static str> {
    crate::parameters::nodes(declaration)
        .any(|node| {
            node.get("method").and_then(Json::as_str) == Some("split")
                && node
                    .get("args")
                    .and_then(Json::as_array)
                    .and_then(|args| args.first())
                    .and_then(|arg| arg.get("string"))
                    .and_then(Json::as_str)
                    == Some("")
        })
        .then_some("split has an empty delimiter")
}

pub(crate) fn decoded_problem(raw: &Json, dom: &mut Dom) -> Option<String> {
    enum Declaration {
        Rule(usize),
        Constant(usize),
        Implication(usize),
    }
    let mut declarations = Vec::new();
    for (index, rule) in dom.rules.iter().enumerate() {
        declarations.push((rule.at, Declaration::Rule(index)));
    }
    for (index, constant) in dom.constants.iter().enumerate() {
        declarations.push((constant.at, Declaration::Constant(index)));
    }
    for (index, implication) in dom.implications.iter().enumerate() {
        declarations.push((implication.at, Declaration::Implication(index)));
    }
    declarations.sort_unstable_by_key(|(at, _)| *at);
    for (_, declaration) in declarations {
        match declaration {
            Declaration::Rule(index) => {
                let item = &raw.get("rules").and_then(Json::as_array).unwrap()[index];
                if let Some(problem) = literal_split_problem(item) {
                    return Some(problem.into());
                }
                let rule = &mut dom.rules[index];
                if let Some(problem) = crate::diagnostics::definition_problem(rule) {
                    return Some(problem);
                }
                if rule.source.instance.is_some() {
                    continue;
                }
                if rule.alternatives.iter().any(|a| {
                    !crate::clauses::duplicate_captures(&a.expr).is_empty()
                        || crate::clauses::repeats_item_capture(&a.expr)
                }) {
                    return Some("a production captures a name twice".into());
                }
                let projected;
                let checked = if crate::parameters::unresolved(item) {
                    projected = match super::partial::rule(rule) {
                        Ok(rule) => rule,
                        Err(_) => return Some("a malformed partial rule".into()),
                    };
                    &projected
                } else {
                    &*rule
                };
                if let Some((problem, _)) = crate::boundary::definition_problem(checked) {
                    return Some(problem);
                }
                if let Some(problem) = rule_type_problem(checked) {
                    return Some(problem);
                }
                // Retain the detailed issue and the deferred result on these nodes.
                let result = crate::clauses::check_definition(checked, true);
                if let Some(issue) = result.problem {
                    return Some(issue.message);
                }
                rule.deferred_emission = result.deferred;
                for term in rule.tags.iter().chain(rule.alternatives.iter().filter_map(|alt| alt.tags.as_ref())) {
                    if crate::notation::reads_own_tags(term) {
                        return Some("a tag clause reads its own tags".into());
                    }
                }
                for term in rule.tags.iter().chain(rule.alternatives.iter().filter_map(|alt| alt.tags.as_ref())).chain(
                    rule.emit.iter().flatten().filter_map(|item| match item {
                        EmitItem::Capture(_, tags, _) | EmitItem::Insert(tags, _) => tags.as_ref(),
                    }),
                ) {
                    if !engine_literals(term).is_empty() {
                        return Some("a tag clause introduces an engine tag".into());
                    }
                }
            }
            Declaration::Constant(index) => {
                let definition = &raw.get("constants").and_then(Json::as_array).unwrap()[index];
                if let Some(problem) = literal_split_problem(definition) {
                    return Some(problem.into());
                }
                let constant = &dom.constants[index];
                let term = &constant.value;
                if !closed(term)
                    || any_engine_literal(term)
                    || !crate::parameters::unresolved(definition)
                        && constant_value_type(
                            term,
                            definition.get("op").and_then(Json::as_str) == Some("redefine"),
                            &|_| Type::Any,
                        )
                        .is_err()
                {
                    return Some("an invalid closed constant value".into());
                }
            }
            Declaration::Implication(index) => {
                let raw = &raw.get("implications").and_then(Json::as_array).unwrap()[index];
                if let Some(problem) = literal_split_problem(raw) {
                    return Some(problem.into());
                }
                let implication = &dom.implications[index];
                for term in [&implication.antecedent, &implication.consequent] {
                    if !closed(term)
                        || any_engine_literal(term)
                        || !crate::parameters::unresolved(raw)
                            && term_type(term).map_or(true, |ty| expected_problem(ty, Type::Tags).is_some())
                    {
                        return Some("an invalid implication side".into());
                    }
                }
            }
        }
    }
    names_problem(raw).map(str::to_string)
}

pub(crate) fn names_problem(dom: &Json) -> Option<&'static str> {
    let first_statement = ["rules", "directives", "constants", "classifiers", "implications"]
        .into_iter()
        .flat_map(|key| array(dom, key).into_iter().flatten().map(move |item| (key, item)))
        .filter(|(key, item)| *key != "directives" || item.get("name").and_then(Json::as_str) != Some("names"))
        .filter_map(|(_, item)| position(item).ok())
        .min();
    if let Some(first) = first_statement {
        if array(dom, "directives").into_iter().flatten().any(|item| {
            item.get("name").and_then(Json::as_str) == Some("names") && position(item).is_ok_and(|at| at > first)
        }) {
            return Some("%names must precede every other statement");
        }
    }
    None
}

fn parts_problem(mut pending: Vec<(Part, &Json, usize)>, unicode: &Unicode, expanded: bool) -> Option<String> {
    let rule = |name: &str| rule_name(name, unicode, expanded);
    while let Some((kind, value, depth)) = pending.pop() {
        if depth > DOM_MAX_DEPTH {
            return Some("nested too deeply".into());
        }
        let next = depth + 1;
        if value.get("param").is_some() && !matches!(kind, Part::Pattern | Part::PatternNode | Part::Argument) {
            if !matches!(kind, Part::Expr { .. } | Part::Term | Part::RecipeAtom | Part::String | Part::Target | Part::Condition) {
                return Some("a parameter in the wrong source category".into());
            }
            if let Some(problem) = source::parameter_problem(value) {
                return Some(problem.into());
            }
            continue;
        }
        if value.get("call").is_some() && !matches!(kind, Part::Pattern | Part::PatternNode | Part::Argument) {
            if !matches!(kind, Part::Expr { .. } | Part::Term | Part::Target | Part::Call) {
                return Some("a call in the wrong source category".into());
            }
            if let Some(problem) = source::call(value, depth, &mut pending, &rule, false) {
                return Some(problem.into());
            }
            continue;
        }
        match kind {
            Part::Body => {
                if !exact(value, &["body"], &[]) {
                    return Some("a malformed parse body".into());
                }
                let body = value.get("body").unwrap();
                if let Some(problem) = body_json_problem(body) {
                    return Some(problem.into());
                }
                pending.push((
                    Part::Expr { whole: true, flags: ExprFlags { query: true, ..ExprFlags::default() } },
                    body,
                    // The argument wrapper adds no depth (engine §9).
                    depth,
                ));
            }
            Part::Call => return Some("a malformed call".into()),
            Part::Argument => {
                if let Some(problem) = source::argument(value, depth, &mut pending, &rule) {
                    return Some(problem.into());
                }
            }
            Part::Target => {
                if !(exact(value, &["rule"], &[]) && value.get("rule").and_then(Json::as_str).is_some_and(rule)
                    || exact(value, &["terminal"], &[])
                        && value.get("terminal").and_then(Json::as_str).is_some_and(|s| tag(s) && !engine_tag(s)))
                {
                    return Some("a malformed query target".into());
                }
            }
            Part::Requirements => {
                let Some(items) = value.as_array() else { return Some("a malformed requirement list".into()) };
                for item in items {
                    let Some(term) = item.get("value") else { return Some("a missing requirement value".into()) };
                    if !exact(item, &["negated", "value"], &[])
                        || !matches!(item.get("negated"), Some(Json::Bool(_)))
                        || !["tag", "const", "param"].iter().any(|key| term.get(key).is_some())
                    {
                        return Some("a malformed requirement".into());
                    }
                    // The requirement record adds no depth to its value.
                    pending.push((Part::Term, term, depth));
                }
            }
            Part::Expr { whole, flags } => {
                let expression = |value, flags| (Part::Expr { whole: false, flags }, value, next);
                if base(value, unicode, expanded) {
                    if value.get("ref").and_then(Json::as_str).is_some_and(|name| !rule(name) && !tag(name)) {
                        return Some("a malformed reference".into());
                    }
                    if let Some(term) = value.get("literal") {
                        pending.push((Part::String, term, depth));
                    }
                    if let Some(range) = value.get("range") {
                        let Some([left, right]) = range.as_array() else {
                            return Some("a malformed scalar range".into());
                        };
                        if let Some(problem) = literal_range_problem(left, right) {
                            return Some(problem.into());
                        }
                        pending.push((Part::String, left, depth));
                        pending.push((Part::String, right, depth));
                    }
                } else if exact(value, &["remainder"], &[]) && is_true(value.get("remainder")) && flags.query
                    || exact(value, &["empty"], &[]) && is_true(value.get("empty"))
                {
                } else if let Some(inner) = value.get("splice") {
                    if !exact(value, &["splice"], &[])
                        || !(inner.get("call").is_some()
                            || exact(inner, &["ref"], &[]) && inner.get("ref").and_then(Json::as_str).is_some_and(rule))
                    {
                        return Some("a splice targets a rule reference or call".into());
                    }
                    pending.push(expression(inner, flags));
                } else if let Some(inner) = value.get("capture") {
                    // A chain holds no capture, and an elidable optional
                    // seals everything inside it. Flat braces hold item
                    // captures, also inside a chain, but not inside a ranked
                    // group (engine §3.5).
                    if flags.sealed
                        || flags.chain
                        || flags.item && flags.ranked
                        || !exact(value, &["capture", "expr"], &[])
                        || !inner.as_str().is_some_and(is_capture_name)
                        || !value
                            .get("expr")
                            .is_some_and(|value| tested_base(value, unicode, expanded) || value.get("splice").is_some())
                    {
                        return Some("a malformed capture".into());
                    }
                    pending.push(expression(value.get("expr").unwrap(), flags));
                } else if let Some(inner) = value.get("optional") {
                    if !exact(value, &["optional"], &["elidable", "default"])
                        || !matches!(value.get("elidable"), None | Some(Json::Bool(true)))
                    {
                        return Some("a malformed optional".into());
                    }
                    if value.get("elidable").is_some() && !source::elidable(inner) {
                        return Some("a malformed elidable optional".into());
                    }
                    if let Some(default) = value.get("default") {
                        if value.get("elidable") != Some(&Json::Bool(true))
                            || !(default.get("string").is_some()
                                || default.get("const").is_some()
                                || default.get("param").is_some())
                        {
                            return Some("a malformed default".into());
                        }
                        pending.push((Part::String, default, depth + 1));
                    }
                    let malformed_capture = inner.get("capture").is_some()
                        && value.get("elidable").is_some()
                        && !inner.get("expr").is_some_and(|t| {
                            let mut base = t;
                            while let Some(inner) = base.get("expr").filter(|_| base.get("test").is_some()) {
                                base = inner;
                            }
                            base.get("param").is_some()
                                || base.get("ref").and_then(Json::as_str).is_some_and(|t| tag(t) && !engine_tag(t))
                        });
                    if malformed_capture {
                        return Some("a malformed captured terminator".into());
                    }
                    let sealed = flags.sealed || value.get("elidable").is_some() && inner.get("capture").is_none();
                    pending.push(expression(inner, ExprFlags { sealed, ..flags }));
                } else if let Some(inner) = value.get("repeat") {
                    if !exact(value, &["repeat"], &["separator", "chain"])
                        || value
                            .get("chain")
                            .is_some_and(|chain| !whole || !matches!(chain.as_str(), Some("left" | "right")))
                    {
                        return Some("a malformed repeat".into());
                    }
                    let chain = value.get("chain").is_some();
                    let inside =
                        ExprFlags { sealed: flags.sealed, chain, item: !chain, ranked: false, query: flags.query };
                    pending.push(expression(inner, inside));
                    if let Some(separator) = value.get("separator") {
                        pending.push(expression(separator, inside));
                    }
                } else if value.get("test").is_some() {
                    if !tested_base(value, unicode, expanded) {
                        return Some("a malformed test target or order".into());
                    }
                    pending.push(expression(value.get("expr").unwrap(), flags));
                    match value.get("test").and_then(Json::as_str) {
                        Some("=" | "≠") if exact(value, &["test", "value", "expr"], &[]) => {
                            pending.push((Part::String, value.get("value").unwrap(), next))
                        }
                        Some("tags") if exact(value, &["test", "requirements", "expr"], &[]) => {
                            pending.push((Part::Requirements, value.get("requirements").unwrap(), next));
                        }
                        _ => return Some("a malformed test".into()),
                    }
                } else {
                    let Some(key) = ["seq", "choice", "ranked", "and"].into_iter().find(|key| value.get(key).is_some())
                    else {
                        return Some("a malformed expression".into());
                    };
                    if !exact(value, &[key], &[]) {
                        return Some("a malformed expression".into());
                    }
                    let Some(items) = value
                        .get(key)
                        .and_then(Json::as_array)
                        .filter(|items| items.len() >= 2 && (key != "and" || items.len() <= crate::grammar::MAX_AND))
                    else {
                        return Some(
                            (if key == "ranked" {
                                "ranked-choice-syntax: a ranked expression requires two options"
                            } else {
                                "a malformed expression list"
                            })
                            .into(),
                        );
                    };
                    let inside = ExprFlags { ranked: flags.ranked || key == "ranked", ..flags };
                    pending.extend(items.iter().map(|item| expression(item, inside)));
                }
            }
            Part::Recipe => {
                if !exact(value, &["concat"], &[]) {
                    return Some("a malformed recipe".into());
                }
                let Some(atoms) = value.get("concat").and_then(Json::as_array).filter(|atoms| !atoms.is_empty()) else {
                    return Some("an empty recipe".into());
                };
                for atom in atoms {
                    if !recipe_atom(atom) {
                        return Some("a recipe contains a non-string atom".into());
                    }
                    pending.push((Part::RecipeAtom, atom, next));
                }
            }
            Part::String => {
                if !string_atom(value) {
                    return Some("a string term is required".into());
                }
                pending.push((Part::Term, value, depth));
            }
            Part::Term | Part::RecipeAtom => {
                if exact(value, &["string"], &[]) && is_str(value.get("string"))
                    || exact(value, &["tag"], &[]) && value.get("tag").and_then(Json::as_str).is_some_and(tag)
                    || bare_capture(value)
                    || exact(value, &["emptySet"], &[]) && is_true(value.get("emptySet"))
                {
                } else if exact(value, &["const", "at"], &[]) {
                    if !is_position(value.get("at"))
                        || !value.get("const").and_then(Json::as_str).is_some_and(is_constant_name)
                    {
                        return Some("a malformed constant reference".into());
                    }
                } else if exact(value, &["concat"], &[]) {
                    let Some(items) = value.get("concat").and_then(Json::as_array).filter(|items| items.len() >= 2)
                    else {
                        return Some("a malformed concatenation".into());
                    };
                    for item in items {
                        pending.push((Part::Term, item, next));
                    }
                } else if exact(value, &["pattern"], &[]) {
                    pending.push((Part::Pattern, value.get("pattern").unwrap(), next));
                } else if exact(value, &["if", "then"], &[]) {
                    pending.push((Part::Condition, value.get("if").unwrap(), next));
                    pending.push((Part::Term, value.get("then").unwrap(), next));
                } else if value.get("method").is_some() {
                    if !exact(value, &["method", "receiver", "args"], &[]) {
                        return Some("a malformed method".into());
                    }
                    let Some(args) = value.get("args").and_then(Json::as_array) else {
                        return Some("a malformed method argument list".into());
                    };
                    let receiver = value.get("receiver").unwrap();
                    let name = value.get("method").and_then(Json::as_str).unwrap_or("");
                    let capture = bare_capture(receiver) || source::leaf(receiver);
                    let rule_arg = |arg: &Json| {
                        source::leaf(arg)
                            || exact(arg, &["rule"], &[]) && arg.get("rule").and_then(Json::as_str).is_some_and(rule)
                    };
                    let valid = match (name, args) {
                        ("parse", [arg]) => {
                            span(receiver)
                                && exact(arg, &["body"], &[])
                                && !(restored_span(receiver)
                                    && arg
                                        .get("body")
                                        .and_then(|body| body.get("seq"))
                                        .and_then(Json::as_array)
                                        .and_then(|items| items.first())
                                        .is_some_and(|first| first.get("remainder").is_some()))
                        }
                        ("error-free", []) => forest(receiver),
                        ("without-elision", []) => capture,
                        ("without-elision-except", [arg]) => capture && rule_arg(arg),
                        ("verbatim-text", []) => matches!(kind, Part::RecipeAtom) && capture,
                        ("emitted", []) => matches!(kind, Part::RecipeAtom) && capture,
                        ("value" | "image", []) => {
                            span(receiver) || receiver.get("method").and_then(Json::as_str) == Some("emitted")
                        }
                        (
                            "source-text"
                            | "decomposed-source-text"
                            | "first-token"
                            | "last-token"
                            | "tokens-after-first"
                            | "onward"
                            | "following-tokens"
                            | "preceding-tokens"
                            | "classes",
                            [],
                        ) => span(receiver),
                        ("tags", []) => span(receiver) || forest(receiver),
                        ("tags", [arg]) => span(receiver) && rule_arg(arg),
                        ("ngrams", [arg]) => {
                            exact(arg, &["integer"], &[])
                                && arg.get("integer").and_then(Json::as_str).is_some_and(crate::dom::valid_integer)
                        }
                        ("split", [arg]) => {
                            !is_rule_arg(arg) && !is_classifier_arg(arg) && arg.get("integer").is_none()
                        }
                        ("classify", [arg]) => {
                            exact(arg, &["classifier"], &[])
                                && arg.get("classifier").and_then(Json::as_str).is_some_and(is_classifier_name)
                        }
                        _ => false,
                    };
                    if !valid {
                        return Some("a method has the wrong receiver or arguments".into());
                    }
                    pending.push((kind, receiver, next));
                    for arg in args {
                        if name == "parse" {
                            pending.push((Part::Body, arg, next));
                            continue;
                        }
                        if arg.get("rule").is_none() && arg.get("classifier").is_none() && arg.get("integer").is_none()
                        {
                            pending.push((Part::Term, arg, next));
                        }
                    }
                } else {
                    let Some(key) =
                        ["union", "intersection", "difference"].into_iter().find(|key| value.get(key).is_some())
                    else {
                        return Some("a malformed term".into());
                    };
                    let Some(items) = value
                        .get(key)
                        .and_then(Json::as_array)
                        .filter(|items| items.len() >= 2 && (key != "difference" || items.len() == 2))
                    else {
                        return Some("a malformed set operation".into());
                    };
                    if !exact(value, &[key], &[]) {
                        return Some("a malformed term".into());
                    }
                    pending.extend(items.iter().map(|item| (Part::Term, item, next)));
                }
            }
            Part::Condition => {
                if exact(value, &["captured"], &[])
                    && value
                        .get("captured")
                        .and_then(Json::as_str)
                        .is_some_and(|name| name.is_empty() || is_capture_name(name))
                {
                } else if exact(value, &["not"], &[]) {
                    pending.push((Part::Condition, value.get("not").unwrap(), next));
                } else if exact(value, &["if", "then"], &[]) {
                    pending.push((Part::Condition, value.get("if").unwrap(), next));
                    pending.push((Part::Condition, value.get("then").unwrap(), next));
                } else if ["union", "intersection", "difference", "tag", "emptySet"].iter().any(|key| exact(value, &[key], &[]))
                    || exact(value, &["const", "at"], &[])
                {
                    pending.push((Part::Term, value, next));
                } else if exact(value, &["op", "left", "right"], &[]) {
                    if !matches!(
                        value.get("op").and_then(Json::as_str),
                        Some("=" | "≠" | "∈" | "∉" | "⊆" | "⊈" | "≅" | "≇")
                    ) {
                        return Some("a malformed comparator".into());
                    }
                    if matches!(value.get("op").and_then(Json::as_str), Some("≅" | "≇"))
                        && !bare_capture(value.get("left").unwrap())
                    {
                        return Some("a tree comparison requires a bare capture".into());
                    }
                    pending.push((Part::Term, value.get("left").unwrap(), next));
                    pending.push((Part::Term, value.get("right").unwrap(), next));
                } else if exact(value, &["method", "receiver", "args"], &[]) {
                    if matches!(value.get("method").and_then(Json::as_str), Some("parse" | "error-free")) {
                        pending.push((Part::Term, value, depth));
                        continue;
                    }
                    // The tags of a forest, as a set in a Boolean position.
                    if value.get("method").and_then(Json::as_str) == Some("tags")
                        && value
                            .get("receiver")
                            .is_some_and(|receiver| {
                                exact(receiver, &["method", "receiver", "args"], &[])
                                    && matches!(receiver.get("method").and_then(Json::as_str), Some("parse" | "error-free"))
                            })
                    {
                        pending.push((Part::Term, value, depth));
                        continue;
                    }
                    let receiver = value.get("receiver").unwrap();
                    let args = value.get("args").and_then(Json::as_array);
                    if value.get("method").and_then(Json::as_str) == Some("ends") && restored_span(receiver) {
                        return Some("ends requires an ordinary span, not a restored span".into());
                    }
                    if !span(receiver)
                        || !match (value.get("method").and_then(Json::as_str), args) {
                            (Some("starts-input" | "ends-input"), Some([])) => true,
                            (Some("followed-by" | "preceded-by"), Some(args)) => {
                                (bare_capture(receiver) || source::leaf(receiver))
                                    && !args.is_empty()
                                    && args.iter().all(|arg| {
                                        source::leaf(arg)
                                            || exact(arg, &["rule"], &[])
                                                && arg.get("rule").and_then(Json::as_str).is_some_and(rule)
                                            || exact(arg, &["terminal"], &[])
                                                && arg.get("terminal").and_then(Json::as_str).is_some_and(|s| {
                                                    s.starts_with(|c: char| c.is_ascii_uppercase()) && tag(s)
                                                })
                                    })
                            }
                            (Some("tags" | "classes" | "split" | "ngrams" | "classify"), Some(_)) => true,
                            (Some(name @ ("matches" | "begins" | "ends")), Some(args)) => {
                                (name != "ends" || !restored_span(receiver))
                                    && !args.is_empty()
                                    && args.iter().all(|arg| {
                                        source::leaf(arg)
                                            || exact(arg, &["rule"], &[])
                                                && arg.get("rule").and_then(Json::as_str).is_some_and(rule)
                                            || exact(arg, &["terminal"], &[])
                                                && arg.get("terminal").and_then(Json::as_str).is_some_and(|s| {
                                                    s.starts_with(|c: char| c.is_ascii_uppercase()) && tag(s)
                                                })
                                    })
                            }
                            _ => false,
                        }
                    {
                        return Some("a malformed query predicate".into());
                    }
                    pending.push((Part::Term, receiver, next));
                    pending.extend(args.unwrap().iter().map(|arg| (Part::Target, arg, next)));
                } else {
                    let Some(key) = ["any", "all"].into_iter().find(|key| value.get(key).is_some()) else {
                        return Some("a malformed condition".into());
                    };
                    let Some(items) = value.get(key).and_then(Json::as_array).filter(|items| items.len() >= 2) else {
                        return Some("a malformed condition list".into());
                    };
                    if !exact(value, &[key], &[]) {
                        return Some("a malformed condition".into());
                    }
                    pending.extend(items.iter().map(|item| (Part::Condition, item, next)));
                }
            }
            Part::Pattern => {
                let name = |name: &str| rule(name) && !tag(name);
                let inspect = crate::patterns::shapes::Inspection {
                    name: Some(&name),
                    terminal: Some(&tag),
                    depth,
                    ..Default::default()
                };
                if let Some(problem) = crate::patterns::shapes::problem(value, &inspect) {
                    return Some(problem);
                }
                pending.push((Part::PatternNode, value, depth));
            }
            Part::PatternNode => {
                if value.get("call").is_some() {
                    if let Some(problem) = source::call(value, depth, &mut pending, &rule, true) {
                        return Some(problem.into());
                    }
                }
                if let Some(term) = value.get("literal") {
                    pending.push((Part::String, term, depth));
                }
                if let Some(range) = value.get("range") {
                    let [a, b] = range.as_array().unwrap() else { unreachable!() };
                    if let Some(problem) = literal_range_problem(a, b) {
                        return Some(problem.into());
                    }
                    pending.extend([(Part::String, a, depth), (Part::String, b, depth)]);
                }
                if value.get("test").and_then(Json::as_str) == Some("tags") {
                    for r in value.get("requirements").unwrap().as_array().unwrap() {
                        let operand = r.get("value").unwrap();
                        if operand.get("tag").and_then(Json::as_str) != Some("_Elided") {
                            pending.push((Part::Term, operand, next));
                        }
                    }
                } else if value.get("test").is_some() {
                    pending.push((Part::String, value.get("value").unwrap(), next));
                }
                for key in ["expr", "pattern"] {
                    if let Some(p) = value.get(key) {
                        pending.push((Part::PatternNode, p, next));
                    }
                }
                for key in ["union", "intersection", "difference"] {
                    if let Some(items) = value.get(key).and_then(Json::as_array) {
                        pending.extend(items.iter().map(|p| (Part::PatternNode, p, next)));
                    }
                }
                if let Some(items) = value.get("children").and_then(Json::as_array) {
                    pending.extend(items.iter().map(|p| (Part::PatternItem, p, next)));
                }
            }
            Part::PatternItem => {
                if let Some(child) = value.get("child") {
                    pending.push((Part::PatternNode, child, next));
                }
                for key in ["optional", "repeat", "separator"] {
                    if let Some(items) = value.get(key).and_then(Json::as_array) {
                        pending.extend(items.iter().map(|p| (Part::PatternItem, p, next)));
                    }
                }
                if let Some(arms) = value.get("choice").and_then(Json::as_array) {
                    for arm in arms {
                        pending.extend(arm.as_array().unwrap().iter().map(|p| (Part::PatternItem, p, next)));
                    }
                }
            }
        }
    }
    None
}

fn closed(root: &Term) -> bool {
    let mut pending = vec![root];
    while let Some(term) = pending.pop() {
        match term {
            Term::Capture(_) | Term::If(..) => return false,
            Term::Call(name, args) => {
                if !matches!(name.as_str(), "split" | "ngrams" | "concat") {
                    return false;
                }
                for arg in args {
                    if let Arg::Term(term) = arg {
                        pending.push(term);
                    } else if !matches!(arg, crate::dom::Arg::Integer(_)) {
                        return false;
                    }
                }
            }
            Term::Union(items) | Term::Intersection(items) => pending.extend(items),
            Term::Difference(a, b) => {
                pending.push(b);
                pending.push(a);
            }
            _ => {}
        }
    }
    true
}

fn any_engine_literal(root: &Term) -> bool {
    let mut pending = vec![root];
    while let Some(term) = pending.pop() {
        match term {
            Term::Tag(tag) if engine_tag(tag) => return true,
            Term::Union(items) | Term::Intersection(items) => pending.extend(items),
            Term::Difference(a, b) => {
                pending.push(b);
                pending.push(a);
            }
            Term::Call(_, args) => {
                pending.extend(args.iter().filter_map(|arg| if let Arg::Term(term) = arg { Some(term) } else { None }))
            }
            _ => {}
        }
    }
    false
}

fn json_parts(value: &Json) -> impl Iterator<Item = &Json> {
    value.as_array().unwrap_or(&[]).iter().chain(value.as_object().unwrap_or(&[]).iter().map(|(_, value)| value))
}
fn json_boundary_atoms(value: &Json) -> Vec<&Json> {
    let mut found = Vec::new();
    let mut pending = vec![value];
    while let Some(value) = pending.pop() {
        if matches!(value.get("method").and_then(Json::as_str), Some("followed-by" | "preceded-by")) {
            found.push(value);
        } else {
            pending.extend(json_parts(value));
        }
    }
    found
}
fn boundary_problem(rule: &Json) -> Option<&'static str> {
    let mut allowed = FxSet::default();
    for condition in rule.get("conditions").and_then(Json::as_array).unwrap_or(&[]) {
        let atoms = json_boundary_atoms(condition);
        if atoms.len() > 1 {
            return Some("a condition item accepts only one boundary atom");
        }
        for atom in atoms {
            allowed.insert(atom as *const Json);
            if let Some(receiver) = atom.get("receiver").and_then(|r| r.get("capture")).and_then(Json::as_str) {
                if !receiver.is_empty() {
                    let mut pending = vec![condition];
                    while let Some(part) = pending.pop() {
                        let capture = part.get("capture").or_else(|| part.get("captured")).and_then(Json::as_str);
                        if capture.is_some_and(|name| name != receiver) {
                            return Some("a boundary condition with a captured receiver reads only that capture");
                        }
                        pending.extend(json_parts(part));
                    }
                }
            }
        }
    }
    for tags in rule
        .get("tags")
        .into_iter()
        .chain(rule.get("alternatives").and_then(Json::as_array).unwrap_or(&[]).iter().filter_map(|a| a.get("tags")))
    {
        allowed.extend(json_boundary_atoms(tags).iter().map(|v| *v as *const Json));
    }
    for item in rule.get("emit").and_then(|v| v.get("items")).and_then(Json::as_array).unwrap_or(&[]) {
        if let Some(tags) = item.get("tags") {
            allowed.extend(json_boundary_atoms(tags).iter().map(|v| *v as *const Json));
        }
    }
    if json_boundary_atoms(rule).iter().any(|v| !allowed.contains(&(*v as *const Json))) {
        return Some("a boundary atom stands only in conditions or emission tags");
    }
    None
}
