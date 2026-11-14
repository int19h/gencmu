"""Shared clause and production walks (engine §3 and §4)."""


def expression_children(expr):
    if "splice" in expr:
        return [expr["splice"]]
    for key in ("seq", "choice", "ranked", "and"):
        if key in expr:
            return expr[key]
    if "optional" in expr:
        return [expr["optional"]]
    if "repeat" in expr:
        return [expr["repeat"], expr["separator"]] if "separator" in expr else [expr["repeat"]]
    if "capture" in expr or "test" in expr:
        return [expr["expr"]]
    return []


def clause_children(node):
    if isinstance(node, (list, tuple)):
        return node
    if not isinstance(node, dict) or "pattern" in node:
        return []
    if "body" in node:
        return [node["body"]]
    if any(key in node for key in ("seq", "choice", "ranked", "and", "optional", "repeat", "splice", "expr")):
        children = list(expression_children(node))
        if "test" in node:
            children.extend([r["value"] for r in node["requirements"]] if node["test"] == "tags" else [node["value"]])
        return children
    if "literal" in node:
        return [node["literal"]] if isinstance(node["literal"], dict) else []
    if "range" in node:
        return node["range"]
    if any(key in node for key in ("string", "tag", "captured", "rule", "classifier")):
        return []
    if "capture" in node and not any(key in node for key in ("tags", "value", "image")):
        return []
    if "method" in node:
        return [node["receiver"], *node["args"]]
    if "op" in node:
        return [node["left"], node["right"]]
    if "if" in node:
        return [node["if"], node["then"]]
    if "nonempty" in node:
        return [node["nonempty"]]
    if "not" in node:
        return [node["not"]]
    for key in ("any", "all", "union", "intersection", "difference", "concat", "items"):
        if key in node:
            return node[key]
    if "const" in node:
        return [node["value"]] if "value" in node else []
    if "condition" in node:
        return [node["condition"]]
    return [node[key] for key in ("conditions", "tags", "emit", "value", "image", "error", "warning") if key in node]


def source_clauses(source):
    return [source.conditions, source.tags, source.rule_tags, source.emit,
            source.value, source.image, source.rule_value, source.rule_image,
            source.error, source.warning]


def own_clauses(production):
    yield from production.conds_predict
    for conditions in production.conds_at.values():
        yield from conditions
    if production.tags_term is not None:
        yield production.tags_term
    if production.emit is not None:
        yield production.emit
    if production.slot is not None:
        yield from production.slot.ranked_conditions
    if production.parent_tags is not None:
        yield production.parent_tags
    if production.items is not None:
        yield from production.items.conditions


def production_clauses(production):
    source = production.source
    return [*own_clauses(production), *(source_clauses(source) if source else ())]
