"""Select the string channels that conditions can read."""
from ._errors import GencmuError


def demanded_strings(productions):
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


def validate_condition_strings(grammar):
    def children(expr):
        for key in ("seq", "choice", "ranked", "and"):
            if key in expr: return expr[key]
        for key in ("optional", "repeat", "expr"):
            if key in expr: return [expr[key]] + ([expr["separator"]] if "separator" in expr else [])
        return ()

    def references(expr):
        names, pending = set(), [expr]
        while pending:
            node = pending.pop()
            if node.get("ref") in grammar.rules: names.add(node["ref"])
            pending.extend(children(node))
        return names

    definitions, bodies = {}, {}
    def definition(rule, alt): return rule.name, alt.document, alt.at
    for rule in grammar.rules.values():
        for alt in rule.alternatives:
            bodies[id(alt)] = references(alt.expr)
            bindings = definitions.setdefault(definition(rule, alt), {})
            pending = [alt.expr]
            while pending:
                node = pending.pop()
                if "capture" in node:
                    bindings.setdefault(node["capture"], set()).update(references(node["expr"]))
                pending.extend(children(node))

    def targets(rule, alt, read):
        name = read["receiver"]["receiver"]["capture"]
        return (rule.name,) if not name else definitions[definition(rule, alt)].get(name, ())

    def reaches_verbatim(rule, alt, read):
        pending = [(name, read["method"]) for name in targets(rule, alt, read)]
        seen = set()
        while pending:
            name, channel = pending.pop()
            if (name, channel) in seen: continue
            seen.add((name, channel))
            current = grammar.rules[name]
            for variant in current.alternatives:
                if variant.erased: continue
                value = variant.value if variant.value is not None else variant.rule_value
                image = variant.image if variant.image is not None else variant.rule_image
                recipe = value if channel == "value" or image is None else image
                if recipe is not None:
                    if any(atom.get("method") == "verbatim-text" for atom in recipe["concat"]): return True
                    pending.extend((target, atom["method"]) for atom in reads(recipe) for target in targets(current, variant, atom))
                else:
                    pending.extend((target, channel) for target in bodies[id(variant)])
        return False

    for rule in grammar.rules.values():
        for alt in rule.alternatives:
            for read in reads(alt.conditions):
                if not reaches_verbatim(rule, alt, read): continue
                at = getattr(read["receiver"], "at", None)
                error = GencmuError("a condition walk cannot reach verbatim-text", document=alt.document,
                                    line=at[0] if at else None, column=at[1] if at else None)
                if at is None: error._boundary_document = alt.document
                raise error
