"""Unresolved nodes and structural arguments (engine §2.3)."""

from __future__ import annotations

from copy import copy


def nodes(root):
    pending = [root]
    while pending:
        node = pending.pop()
        if isinstance(node, dict):
            yield node
            pending.extend(reversed([v for k, v in node.items() if k != "at"]))
        elif isinstance(node, list):
            pending.extend(reversed(node))


def has_unresolved(root):
    return any(n.get("param") or n.get("call") or n.get("params") or n.get("instance")
               or "args" in n and n.get("name") and n.get("op") for n in nodes(root))


def argument_of_expression(expr):
    if "ref" in expr:
        name = expr["ref"]
        return {"tag" if name[:1].isupper() or name.startswith("_") else "rule": name}
    if "literal" in expr:
        return expr["literal"]
    if any(k in expr for k in ("param", "call", "test", "range", "wildcard")):
        return expr
    return {"body": expr}


def normalize_argument(value):
    if isinstance(value, list):
        return [normalize_argument(v) for v in value]
    if not isinstance(value, dict):
        return value
    if "body" in value:
        return argument_of_expression(normalize_argument(value["body"]))
    result = copy(value)
    for key, item in value.items():
        result[key] = normalize_argument(item)
        if key in ("union", "concat", "any", "all") and isinstance(result[key], list):
            result[key] = [v for n in result[key] for v in n.get(key, [n])]
    return result


def identity(value):
    if isinstance(value, list):
        return [identity(v) for v in value]
    if isinstance(value, dict):
        return {k: identity(v) for k, v in sorted(value.items()) if k != "at"}
    return value
