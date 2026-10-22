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


def map_nodes(root, transform):
    result = [None]
    pending = [(root, result, 0, False)]
    while pending:
        node, parent, key, complete = pending.pop()
        if complete:
            parent[key] = transform(parent[key])
        elif isinstance(node, (dict, list)):
            value = copy(node)
            parent[key] = value
            pending.append((None, parent, key, True))
            children = list(node.items()) if isinstance(node, dict) else list(enumerate(node))
            pending.extend((child, value, slot, False) for slot, child in reversed(children))
        else:
            parent[key] = node
    return result[0]


def clone_nodes(root):
    return map_nodes(root, lambda node: node)


def normalize_argument(root):
    def normalized(value):
        if isinstance(value, dict):
            if 'body' in value:
                return argument_of_expression(value['body'])
            for key in ('union', 'concat', 'any', 'all'):
                if isinstance(value.get(key), list):
                    value[key] = [v for n in value[key] for v in n.get(key, [n])]
        return value
    return map_nodes(root, normalized)


def identity(value):
    return map_nodes(value, lambda node: {k: v for k, v in sorted(node.items()) if k != 'at'} if isinstance(node, dict) else node)
