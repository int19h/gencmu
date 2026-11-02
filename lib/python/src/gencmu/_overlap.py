"""Conservative input ownership of final stitched rules (engine §9.3)."""

from __future__ import annotations

from ._clauses import attachment_order
from ._strings import ENGINE_TAGS


def consuming(expr, rules):
    pending = [expr]
    while pending:
        node = pending.pop()
        if "literal" in node or "range" in node or "wildcard" in node:
            return True
        if "ref" in node:
            name = node["ref"]
            if name in rules or name in ENGINE_TAGS or "A" <= name[:1] <= "Z":
                return True
        for key in ("seq", "and", "choice", "ranked"):
            pending.extend(node.get(key, ()))
        for key in ("expr", "optional", "repeat", "separator"):
            if key in node:
                pending.append(node[key])
    return False


def conflict(grammar):
    marked = set()
    changed = True
    while changed:
        changed = False
        for rule in grammar.rules.values():
            if rule.name not in marked and any(consuming(alt.expr, marked) for alt in rule.alternatives):
                marked.add(rule.name)
                changed = True
    for rule in grammar.rules.values():
        for alt in rule.alternatives:
            if alt.emit is None or not any(item.get("capture") == "" for item in alt.emit["items"]):
                continue
            captures = {}
            pending = [alt.expr]
            while pending:
                node = pending.pop()
                if "capture" in node:
                    name = node["capture"]
                    captures[name] = captures.get(name, False) or consuming(node["expr"], marked)
                for key in ("seq", "and", "choice", "ranked"):
                    pending.extend(node.get(key, ()))
                for key in ("expr", "optional", "repeat", "separator"):
                    if key in node:
                        pending.append(node[key])
            items = alt.emit["items"]
            for i, left in enumerate(items):
                for right in items[i + 1:]:
                    if "insert" in left or "insert" in right or left["capture"] != "" and right["capture"] != "":
                        continue
                    other = right if left["capture"] == "" else left
                    if other["capture"] == "":
                        if consuming(alt.expr, marked):
                            return alt
                    elif any(captures.get(name, False) for name in attachment_order(other)):
                        return alt
    return None
