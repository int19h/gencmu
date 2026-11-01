"""Select the string channels that conditions can read."""
from ._errors import GencmuError


def demanded_strings(productions, seeds=None):
    string_bindings = {}
    for p in productions:
        names=string_bindings.setdefault(id(p.source),{})
        for name,index in p.captures.items():
            if not p.terminal[index]: names.setdefault(name,set()).add(p.rhs[index])
    string_demands = {}
    def demand(production, channel):
        channels = string_demands.setdefault(production.real_id, set())
        before = len(channels)
        channels.add(channel)
        return before != len(channels)

    by_rule = {}
    for p in productions: by_rule.setdefault(p.lhs, []).append(p)
    def child(rule, channel):
        changed = False
        for p in by_rule.get(rule, ()): changed = demand(p, channel) or changed
        return changed

    def string_reads(term, production, own=False):
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
                        if own or not production.helper:
                            changed = demand(production, node["method"]) or changed
                        else:
                            for p in productions:
                                if not p.helper and p.source is production.source:
                                    changed = demand(p, node["method"]) or changed
                    elif index is not None and not production.terminal[index]:
                        changed = child(production.rhs[index], node["method"]) or changed
                    else:
                        for target in string_bindings.get(id(production.source),{}).get(name,()):
                            changed = child(target,node["method"]) or changed
                pending.extend(node.values())
        return changed

    if seeds is not None:
        for p, term in seeds: string_reads(term, p)
    else:
        for p in productions:
            string_reads([p.conds_predict, *p.conds_at.values(), p.string_conditions], p)
    changed = True
    while changed:
        changed = False
        for p in productions:
            for channel in tuple(string_demands.get(p.real_id, ())):
                if p.erased: continue
                recipe = p.value if channel == "value" else p.image if p.image is not None else p.value
                if recipe is not None: changed = string_reads(recipe, p, True) or changed
                else:
                    for index, symbol in enumerate(p.rhs):
                        if not p.terminal[index]: changed = child(symbol, channel) or changed
    return string_demands


def reads(node):
    if isinstance(node, (tuple, list)):
        return [read for part in node for read in reads(part)]
    if not isinstance(node, dict): return []
    if node.get("method") in ("value", "image") and node.get("receiver", {}).get("method") == "emitted":
        return [node]
    return [read for part in node.values() for read in reads(part)]


def validate_condition_strings(lowered):
    for production in lowered.productions:
        conditions = [production.conds_predict, *production.conds_at.values(), production.string_conditions]
        for term in reads(conditions):
            demands = demanded_strings(lowered.productions, [(production, term)])
            for p in lowered.productions:
                if p.erased: continue
                for channel in demands.get(p.real_id, ()):
                    recipe = p.value if channel == "value" else p.image if p.image is not None else p.value
                    if recipe is not None and any(atom.get("method") == "verbatim-text" for atom in recipe["concat"]):
                        at = getattr(term["receiver"], "at", None)
                        document = production.source.document
                        error = GencmuError("a condition walk cannot reach verbatim-text", document=document,
                                            line=at[0] if at else None, column=at[1] if at else None)
                        if at is None: error._boundary_document = document
                        raise error
