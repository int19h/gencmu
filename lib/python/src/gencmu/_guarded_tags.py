"""Concrete neighbour guards in constituent tags (engine §3.7)."""
from ._boundary import METHODS, atoms


def literal_tags(term):
    if "tag" in term:
        return frozenset((term["tag"],))
    if "emptySet" in term:
        return frozenset()
    if "const" in term:
        return term.get("value") if isinstance(term.get("value"), frozenset) else None
    for key in ("union", "intersection", "difference"):
        if key not in term:
            continue
        parts = [literal_tags(part) for part in term[key]]
        if any(part is None for part in parts):
            return None
        value = parts[0]
        for part in parts[1:]:
            value = value | part if key == "union" else value & part if key == "intersection" else value - part
        return value
    return None


def guards(term):
    pending, found = [term], []
    while pending:
        part = pending.pop()
        if isinstance(part, dict):
            if "if" in part and atoms(part["if"]):
                found.append(part)
            else:
                pending.extend(reversed(list(part.values())))
        elif isinstance(part, list):
            pending.extend(reversed(part))
    return found


def problem(term):
    def closed(part):
        if any(key in part for key in ("tag", "emptySet", "const", "param")):
            return True
        return any(key in part and all(closed(child) for child in part[key]) for key in ("union", "intersection", "difference"))
    for guard in guards(term):
        atom = guard["if"].get("not", guard["if"])
        if atom.get("method") not in METHODS or atom.get("receiver") != {"capture": ""}:
            return "a tag guard requires one optionally negated neighbour atom on $", guard["if"]
        if not closed(guard["then"]):
            return "a neighbour tag guard requires a literal tag set", guard["if"]
    return None


def atom_key(atom):
    return atom["method"], tuple(sorted(set(("rule", a["rule"]) if "rule" in a else ("terminal", a["terminal"]) for a in atom["args"])))


def variants(term):
    found = guards(term)
    if not found:
        return [(term, [])]
    variables, indexes, parts = [], {}, {}
    for guard in found:
        tags = literal_tags(guard["then"])
        if tags is None:
            raise ValueError("a neighbour tag guard requires a literal tag set")
        if not tags:
            parts[id(guard)] = None
            continue
        condition = guard["if"]
        atom = condition.get("not", condition)
        key = atom_key(atom)
        if key not in indexes:
            indexes[key] = len(variables)
            variables.append((key, atom))
        parts[id(guard)] = indexes[key], "not" in condition
    assignments, result = [], []
    def possible():
        for index, truth in enumerate(assignments):
            if not truth:
                continue
            (direction, targets), _ = variables[index]
            negative = set().union(*(set(key[1]) for bit, (key, _) in enumerate(variables[:len(assignments)]) if not assignments[bit] and key[0] == direction))
            if set(targets) <= negative:
                return False
        return True
    def replace(node):
        if id(node) in parts:
            part = parts[id(node)]
            return node["then"] if part is not None and assignments[part[0]] != part[1] else {"emptySet": True}
        if not isinstance(node, dict):
            return node
        if "if" in node:
            return {**node, "then": replace(node["then"])}
        for key in ("union", "intersection", "difference"):
            if key in node:
                return {**node, key: [replace(child) for child in node[key]]}
        return node
    def visit():
        if not possible():
            return
        if len(assignments) == len(variables):
            result.append((replace(term), [atom if truth else {"not": atom} for truth, (_, atom) in zip(assignments, variables)]))
            if len(result) > 16:
                raise ValueError("a production has more than 16 guarded tag variants")
            return
        for truth in (False, True):
            assignments.append(truth)
            visit()
            assignments.pop()
    visit()
    return result
