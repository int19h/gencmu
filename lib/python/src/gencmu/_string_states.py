"""Select the string channels that conditions can read."""
from ._errors import GencmuError


def demanded_strings(productions, seeds=None):
    string_bindings = {}
    for p in productions:
        names=string_bindings.setdefault(id(p.source),{})
        for name,index in p.captures.items():
            if not p.terminal[index]: names.setdefault(name,set()).add(p.rhs[index])
    string_demands = {}
    def demand(rule, channel):
        channels = string_demands.setdefault(rule, set())
        before = len(channels)
        channels.add(channel)
        return before != len(channels)

    def string_reads(term, production):
        changed = False
        pending = [term]
        while pending:
            node = pending.pop()
            if isinstance(node, (list,tuple)): pending.extend(node)
            elif isinstance(node, dict):
                receiver = node.get("receiver", {})
                if node.get("method") in ("value", "image") and receiver.get("method") == "emitted":
                    name = receiver["receiver"]["capture"]
                    index = production.captures.get(name)
                    if not name:
                        changed = demand(production.lhs, node["method"]) or changed
                        for p in productions:
                            if not p.helper and p.rule_name==production.rule_name:
                                changed=demand(p.lhs,node["method"]) or changed
                    elif index is not None and not production.terminal[index]:
                        changed = demand(production.rhs[index], node["method"]) or changed
                    else:
                        for target in string_bindings.get(id(production.source),{}).get(name,()):
                            changed=demand(target,node["method"]) or changed
                pending.extend(node.values())
        return changed

    if seeds is not None:
        for p, term in seeds: string_reads(term, p)
    else:
        for p in productions:
            string_reads([p.conds_predict, *p.conds_at.values(), p.items.conditions if p.items else None, p.slot.ranked_conditions if p.slot else None], p)
    changed = True
    while changed:
        changed = False
        for p in productions:
            for channel in tuple(string_demands.get(p.lhs, ())):
                if p.erased: continue
                recipe = p.value if channel == "value" else p.image if p.image is not None else p.value
                if recipe is not None: changed = string_reads(recipe, p) or changed
                else:
                    for index, symbol in enumerate(p.rhs):
                        if not p.terminal[index]: changed = demand(symbol, channel) or changed
    return string_demands


def reads(node):
    if isinstance(node, (tuple, list)):
        return [read for part in node for read in reads(part)]
    if not isinstance(node, dict): return []
    if node.get("method") in ("value", "image") and node.get("receiver", {}).get("method") == "emitted":
        return [node]
    return [read for part in node.values() for read in reads(part)]


def validate_condition_strings(lowered):
    for rule in lowered.grammar.rules.values():
        for alternative in rule.alternatives:
            production = next((p for p in lowered.productions if not p.helper and p.rule_name == rule.name and p.source is alternative), None)
            if production is None: continue
            for term in reads(alternative.conditions):
                demands = demanded_strings(lowered.productions, [(production, term)])
                for p in lowered.productions:
                    if p.erased: continue
                    for channel in demands.get(p.lhs, ()):
                        recipe = p.value if channel == "value" else p.image if p.image is not None else p.value
                        if recipe is not None and any(atom.get("method") == "verbatim-text" for atom in recipe["concat"]):
                            at = getattr(term["receiver"], "at", None)
                            error = GencmuError("a condition walk cannot reach verbatim-text", document=alternative.document,
                                                line=at[0] if at else None, column=at[1] if at else None)
                            if at is None: error._boundary_document = alternative.document
                            raise error
