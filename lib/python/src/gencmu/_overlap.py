"""Conservative input ownership of final stitched rules (engine §9.3)."""

from __future__ import annotations

import itertools

from ._clauses import attachment_order
from ._strings import ENGINE_TAGS
from ._trampoline import run


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


def has_capture(expr):
    pending = [expr]
    while pending:
        node = pending.pop()
        if "capture" in node:
            return True
        for key in ("seq", "and", "choice", "ranked"):
            pending.extend(node.get(key, ()))
        if "optional" in node:
            pending.append(node["optional"])
    return False


def _routes(expr):
    if "seq" in expr:
        parts = []
        for child in expr["seq"]:
            parts.append((yield _routes(child)))
        return [sum(group, []) for group in itertools.product(*parts)]
    if "choice" in expr or "ranked" in expr:
        out = []
        for child in expr.get("choice", expr.get("ranked")):
            out.extend((yield _routes(child)))
        return out
    if "and" in expr:
        parts = []
        for child in expr["and"]:
            parts.append((yield _routes(child)))
        out = []
        for mask in range(1, 1 << len(parts)):
            selected = [part for i, part in enumerate(parts) if mask >> i & 1]
            out.extend(sum(group, []) for group in itertools.product(*selected))
        return out
    if "optional" in expr and has_capture(expr):
        return [[], *(yield _routes(expr["optional"]))]
    return [[expr]]


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
            for route in run(_routes(alt.expr)):
                captures = {part["capture"]: part["expr"] for part in route if "capture" in part}
                kept = [
                    item for item in alt.emit["items"] if "insert" not in item and (item["capture"] == "" or item["capture"] in captures)
                ]
                for i, left in enumerate(kept):
                    for right in kept[i + 1 :]:
                        if left["capture"] == right["capture"] == "":
                            if any(consuming(part, marked) for part in route):
                                return alt
                        elif left["capture"] == "" or right["capture"] == "":
                            other = right if left["capture"] == "" else left
                            if any(name in captures and consuming(captures[name], marked) for name in attachment_order(other)):
                                return alt
    return None
