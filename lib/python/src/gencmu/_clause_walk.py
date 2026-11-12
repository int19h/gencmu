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
    if "present" in node:
        return [node["present"]]
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


def production_clauses(production):
    source = production.source
    return [production.conds_predict, list(production.conds_at.values()),
            production.tags_term, production.emit,
            production.slot.ranked_conditions if production.slot else None,
            production.parent_tags, production.items.conditions if production.items else None,
            [source.conditions, source.tags, source.rule_tags, source.emit,
             source.value, source.image, source.rule_value, source.rule_image,
             source.error, source.warning] if source else None]
