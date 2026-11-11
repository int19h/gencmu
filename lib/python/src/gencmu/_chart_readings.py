"""Per-site qualification for local readings from the main chart."""

from ._clause_walk import clause_children, expression_children
from ._query_forms import body_target


def binds(expression):
    pending = [expression]
    while pending:
        node = pending.pop()
        if not isinstance(node, dict):
            continue
        if isinstance(node.get("capture"), str):
            return True
        pending.extend(expression_children(node))
    return False


def prepare(lowered):
    # Propagate input-context and root-settlement properties through calls,
    # including query targets in recognition conditions and tag terms.
    properties = [[False, name == "text", False] for name in lowered.rule_names]
    parents = [set() for _ in properties]
    for production in lowered.productions:
        calls = {symbol for symbol, terminal in zip(production.rhs, production.terminal) if not terminal}
        pending = [production.conds_predict, list(production.conds_at.values()), production.tags_term,
                   production.slot.ranked_conditions if production.slot else None,
                   production.parent_tags, production.items.conditions if production.items else None]
        info = properties[production.lhs]
        while pending:
            node = pending.pop()
            if isinstance(node, dict):
                method = node.get("method")
                if method in ("preceding-tokens", "starts-input"):
                    info[0] = True
                if method in ("followed-by", "preceded-by"):
                    info[2] = True
                if method == "parse":
                    calls.add(lowered.rule_ids[body_target(lowered, node["args"][0]["body"])])
            pending.extend(clause_children(node))
        for child in calls:
            parents[child].add(production.lhs)
    pending, queued = list(range(len(properties))), set(range(len(properties)))
    while pending:
        child = pending.pop()
        queued.remove(child)
        for parent in parents[child]:
            merged = [left or right for left, right in zip(properties[parent], properties[child])]
            if merged != properties[parent]:
                properties[parent] = merged
                if parent not in queued:
                    pending.append(parent)
                    queued.add(parent)

    rules = {}
    for rule, ids in enumerate(lowered.rule_productions):
        productions = [lowered.productions[index] for index in ids]
        safe = bool(productions)
        for production in productions:
            if not production.helper or production.splice_of is not None:
                continue
            expression = lowered.helper_expressions.get(rule)
            safe &= (expression is not None and production.elided is None and not binds(expression)
                     and all(name.startswith("\0") for name in production.captures)
                     and not production.conds_predict and not production.conds_at
                     and not (production.slot and production.slot.ranked_conditions)
                     and not production.parent_tags and not (production.items and production.items.conditions))
        outside, entry, boundary = properties[rule]
        rules[rule] = safe and not outside, entry and boundary
    lowered.chart_rules = rules
    for production in lowered.productions:
        production.chart_sites = tuple(
            (symbol, terminal, production.tests[index] if production.tests else None,
             *((True, False) if terminal else rules[symbol]))
            for index, (symbol, terminal) in enumerate(zip(production.rhs, production.terminal))
        )


def site(lowered, production=None, index=None, rule=None):
    if production is not None:
        return production.chart_sites[index] if production.chart_sites else None
    properties = lowered.chart_rules.get(rule)
    return (rule, False, None, *properties) if properties else None
