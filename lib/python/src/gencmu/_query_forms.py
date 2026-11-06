"""Structural body queries (engine §3.10 and §4)."""

import json

from . import _testing
from ._clause_walk import expression_children


def query_body(body):
    sequence = body.get("seq") if isinstance(body, dict) else None
    markers, parts = [], []
    if isinstance(sequence, list):
        for index, node in enumerate(sequence):
            _testing.count("walkSteps")
            if isinstance(node, dict) and node.get("remainder"):
                markers.append(index)
            else:
                parts.append(node)
    if markers:
        if (len(body) != 1 or len(markers) != 1 or len(sequence) < 2
                or markers[0] not in (0, len(sequence) - 1)
                or sequence[markers[0]] != {"remainder": True}):
            return body, "matches", "a remainder stands at one outer edge of a parse argument"
        return (parts[0] if len(parts) == 1 else {"seq": parts}), "ends" if markers[0] == 0 else "begins", None
    return body, "matches", None


def query_capture(body):
    pending, seen = [body], set()
    while pending:
        _testing.count("walkSteps")
        node = pending.pop()
        if not isinstance(node, dict) or id(node) in seen:
            continue
        seen.add(id(node))
        if isinstance(node.get("capture"), str):
            return node
        pending.extend(reversed(expression_children(node)))
    return None


def query_identity(body):
    # The owning lowered grammar caches identities, not input-dependent facts.
    def normalized(node):
        _testing.count("walkSteps")
        if isinstance(node, (set, frozenset)):
            return sorted(node)
        if isinstance(node, list):
            return [normalized(child) for child in node]
        if not isinstance(node, dict):
            return node
        if "set" in node:
            return {"set": sorted(node["set"])}
        if "const" in node and "value" in node:
            return normalized(node["value"])
        result = {}
        for key in sorted(node):
            if key == "at":
                continue
            value = normalized(node[key])
            if key in ("seq", "choice"):
                value = [part for child in value for part in child.get(key, [child])]
            result[key] = value
        return result
    return json.dumps(normalized(query_body(body)[0]), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def query_references(body):
    found, pending = [], [query_body(body)[0]]
    while pending:
        _testing.count("walkSteps")
        node = pending.pop()
        if "ref" in node:
            found.append(node["ref"])
        pending.extend(reversed(expression_children(node)))
    return found


def body_target(lowered, body):
    return lowered.query_targets[query_identity(body)]
