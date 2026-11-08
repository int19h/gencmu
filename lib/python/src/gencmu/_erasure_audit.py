"""Conservative effects of one written erasure (design, Diagnostics and debugging)."""

from . import _testing
from ._clause_walk import expression_children

READ, EMIT, DIAGNOSTIC, CHOICE = 1, 2, 4, 8
ALL = READ | EMIT | DIAGNOSTIC | CHOICE


def erasure_audit(grammar):
    alternatives, effects, dependents, pending = {}, {}, {}, []
    emission_indexes = {}

    def emits(emit, captures):
        if emit is None:
            return False
        known = emission_indexes.get(id(emit))
        if known is None:
            fixed, carriers = False, set()
            for item in emit["items"]:
                _testing.count("walkSteps")
                if "insert" in item or item.get("capture") == "":
                    fixed = True
                elif "capture" in item:
                    carriers.add(item["capture"])
            known = emission_indexes[id(emit)] = emit, fixed, carriers
        if known[1]:
            return True
        for name in captures:
            _testing.count("closures")
            if name in known[2]:
                return True
        return False

    def add(name, bits):
        old = effects.get(name, 0)
        if old | bits != old:
            effects[name] = old | bits
            pending.append(name)

    for rule in grammar.rules.values():
        if len(rule.alternatives) > 1:
            add(rule.name, CHOICE)
        for alternative in rule.alternatives:
            _testing.count("closures")
            bits = DIAGNOSTIC if alternative.error is not None or alternative.warning is not None else 0
            captures, references, stack = set(), {}, [alternative.expr]
            while stack:
                _testing.count("walkSteps")
                node = stack.pop()
                if "ref" in node:
                    if node["ref"] in grammar.rules:
                        references[node["ref"]] = None
                    else:
                        bits |= READ | DIAGNOSTIC
                if any(key in node for key in ("literal", "range", "wildcard")):
                    bits |= READ | DIAGNOSTIC
                if any(key in node for key in ("optional", "repeat", "choice", "ranked", "and")):
                    bits |= CHOICE
                if "capture" in node:
                    captures.add(node["capture"])
                stack.extend(expression_children(node))
            if emits(alternative.emit, captures):
                bits |= EMIT
            mask = ALL & ~EMIT if alternative.emit is not None else ALL
            alternatives[id(alternative)] = bits, mask, references
            if alternative.erased:
                continue
            add(rule.name, bits)
            for target in references:
                dependents.setdefault(target, []).append((rule.name, mask))
    for name in pending:
        for parent, mask in dependents.get(name, ()):
            _testing.count("closures")
            add(parent, effects.get(name, 0) & mask)
    result = []
    for rule in grammar.rules.values():
        for index, alternative in enumerate(rule.alternatives):
            if not alternative.erased:
                continue
            bits, mask, references = alternatives[id(alternative)]
            if len(rule.alternatives) > 1:
                bits |= CHOICE
            for target in references:
                bits |= effects.get(target, 0) & mask
            names = [name for bit, name in ((READ, "counted-parts"), (EMIT, "emission"),
                                           (DIAGNOSTIC, "diagnostics"), (CHOICE, "derivation-choice")) if bits & bit]
            result.append(dict(rule=rule.name, document=alternative.document,
                               line=alternative.at[0], column=alternative.at[1], alternative=index,
                               kind="semantic" if bits else "inert", effects=names))
    return result
