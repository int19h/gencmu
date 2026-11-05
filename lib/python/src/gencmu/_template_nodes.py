"""Unresolved nodes and structural arguments (engine §2.3)."""

from __future__ import annotations

from copy import copy


_SOURCE_KEYS = ('if', 'then', 'left', 'right', 'not', 'any', 'all', 'receiver', 'args', 'expr', 'splice', 'body', 'targets', 'requirements', 'negated', 'tags', 'value', 'image', 'error', 'warning', 'suppressWarnings', 'pattern', 'child', 'children', 'repeat', 'separator', 'optional', 'seq', 'choice', 'ranked', 'and', 'union', 'intersection', 'difference', 'concat', 'items', 'before', 'after')


def _source_order(prefix):
    return {key: index for index, key in reversed(list(enumerate((*prefix, *_SOURCE_KEYS))))}


_SOURCE_ORDERS = (
    _source_order(('instance', 'args', 'tags', 'value', 'image', 'alternatives', 'conditions', 'error', 'warning', 'suppressWarnings', 'emit')),
    _source_order(('expr', 'tags', 'value', 'image')),
    _source_order(('tags', 'value', 'image')),
    _source_order(()),
)


def source_keys(node):
    if node.get('name') and node.get('op'):
        order = _SOURCE_ORDERS[0]
    elif node.get('expr') and not node.get('test'):
        order = _SOURCE_ORDERS[1]
    elif 'capture' in node or node.get('insert'):
        order = _SOURCE_ORDERS[2]
    else:
        order = _SOURCE_ORDERS[3]
    return sorted(node, key=lambda key: (order.get(key, 100), key))


def nodes(root, *, source=False):
    pending = [root]
    while pending:
        node = pending.pop()
        if isinstance(node, dict):
            yield node
            keys = source_keys(node) if source else node.keys()
            pending.extend(node[key] for key in reversed(list(keys)) if key != "at")
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
    if any(k in expr for k in ("param", "call", "test", "range", "wildcard", "splice")):
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


def normalize_argument(root, patterns=frozenset()):
    def normalized(value):
        if isinstance(value, dict):
            if 'body' in value:
                return argument_of_expression(value['body'])
            for key in ('union', 'concat', 'intersection'):
                if key == 'intersection' and not pattern_term(value, patterns):
                    continue
                if isinstance(value.get(key), list):
                    value[key] = [v for n in value[key] for v in n.get(key, [n])]
        return value
    return map_nodes(root, normalized)


def identity(value):
    return map_nodes(value, lambda node: {k: v for k, v in sorted(node.items()) if k != 'at'} if isinstance(node, dict) else node)


def pattern_term(root, patterns):
    pending = [root]
    while pending:
        node = pending.pop()
        if 'pattern' in node or node.get('const') in patterns:
            return True
        for key in ('union', 'intersection', 'difference'):
            pending.extend(node.get(key, []))
    return False


def pattern_constant_names(definitions):
    # A valid constant keeps its type across all redefinitions.
    patterns, users = set(), {}
    for definition in definitions:
        pending = [definition['value']]
        while pending:
            node = pending.pop()
            if 'pattern' in node:
                patterns.add(definition['name'])
            if 'const' in node:
                users.setdefault(node['const'], set()).add(definition['name'])
            for key in ('union', 'intersection', 'difference'):
                pending.extend(node.get(key, []))
    queue = list(patterns)
    for name in queue:
        for user in users.get(name, ()):
            if user not in patterns:
                patterns.add(user)
                queue.append(user)
    return patterns
