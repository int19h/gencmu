"""Finite structural observations of candidate trees (engine §4.1)."""

from __future__ import annotations

import re
from typing import Any, Callable

from . import _testing
from ._pattern_shapes import layered_pattern_problem
from ._strings import ENGINE_TAGS, USER_NAME, is_constant

Dom = dict[str, Any]


def pattern_parts(node):
    if isinstance(node, list):
        return node
    for key in ('union', 'intersection', 'difference'):
        if key in node:
            return node[key]
    if 'test' in node:
        return [node['expr']]
    if 'path' in node:
        return [node['pattern']]
    if 'child' in node:
        return [node['child']]
    if 'choice' in node:
        return [item for arm in node['choice'] for item in arm]
    return [*node.get('children', []), *node.get('optional', node.get('repeat', [])), *node.get('separator', [])]


def walk_pattern(root: Dom):
    stack = [(root, 0)]
    while stack:
        node, depth = stack.pop()
        if not isinstance(node, dict):
            continue
        yield node, depth
        stack.extend((child, depth + 1) for child in reversed(pattern_parts(node)))


def _consumes(root: Dom) -> bool:
    return any("node" in node or "siblings" in node for node, _ in walk_pattern(root))


def pattern_problem(root, test_fault=None, initial_depth=0):
    return layered_pattern_problem(root, test=test_fault, depth=initial_depth,
        terminal=lambda name: USER_NAME.fullmatch(name) is not None or name in ENGINE_TAGS)


def empty_pattern() -> Dom:
    all_nodes = {"any": True, "children": [{"siblings": True}]}
    return {"difference": [all_nodes, all_nodes]}


def pattern_key(root: Any) -> tuple[Any, ...]:
    # A flat key avoids recursion in hashing and JSON encoding.
    result: list[Any] = []
    stack = [root]
    while stack:
        node = stack.pop()
        if isinstance(node, dict):
            fields = sorted((key, value) for key, value in node.items() if key != "at")
            result.append(("object", tuple(key for key, _ in fields)))
            stack.extend(value for _, value in reversed(fields))
        elif isinstance(node, list):
            result.append(("array", len(node)))
            stack.extend(reversed(node))
        elif isinstance(node, (set, frozenset)):
            result.append(("set", tuple(sorted(node))))
        else:
            result.append(("value", node))
    return tuple(result)


def leaf_test(node: Dom, value: str, tags: frozenset[str]) -> bool:
    if node["test"] == "tags":
        return all(tags.isdisjoint(r["value"]["set"]) if r["negated"] else r["value"]["set"] <= tags for r in node["requirements"])
    return (value == node["value"]["string"]) == (node["test"] == "=")


def terminal_predicate(node: Dom, leaf) -> bool:
    while "test" in node:
        if not leaf_test(node, leaf[1], leaf[2]):
            return False
        node = node["expr"]
    return leaf[0] == node["terminal"]


class PatternMachine:
    """A finite product of node predicates and child-sequence automata."""

    def __init__(self, roots: list[Dom]) -> None:
        self.predicates: list[Dom] = []
        self.machines: list[Dom] = []
        self.ids: dict[tuple[Any, ...], int] = {}
        self.root_ids: dict[int, int] = {}
        self.states: list[tuple[Any, ...]] = []
        self.state_ids: dict[tuple[Any, ...], int] = {}
        self.transitions: dict[tuple[Any, ...], int] = {}
        for root in roots:
            self.compile(root)
        self.empty = self.intern((0, 0, 0, 0, tuple(m["epsilon"] for m in self.machines), None, False))

    def compile(self, root: Dom) -> int:
        pending = [(root, False)]
        while pending:
            node, ready = pending.pop()
            if id(node) in self.root_ids:
                continue
            key = pattern_key(node)
            if key in self.ids:
                self.root_ids[id(node)] = self.ids[key]
                continue
            if not ready:
                pending.append((node, True))
                kids = [node["pattern"]] if "path" in node else node.get("union", node.get("intersection", node.get("difference", [])))
                if "children" in node:
                    todo = list(node["children"])
                    kids = []
                    while todo:
                        item = todo.pop()
                        if "child" in item:
                            kids.append(item["child"])
                        elif "choice" in item:
                            todo.extend(child for arm in item["choice"] for child in arm)
                        else:
                            todo.extend(item.get("optional", item.get("repeat", [])))
                            todo.extend(item.get("separator", []))
                pending.extend((child, False) for child in reversed(kids))
                continue
            predicate = dict(node)
            if "path" in node:
                predicate["child"] = self.root_ids[id(node["pattern"])]
            for kind in ("union", "intersection", "difference"):
                if kind in node:
                    predicate["operands"] = [self.root_ids[id(n)] for n in node[kind]]
            if "children" in node:
                machine = self.sequence(node["children"])
                predicate["machine"] = len(self.machines)
                self.machines.append(machine)
            index = len(self.predicates)
            self.predicates.append(predicate)
            self.ids[key] = index
            self.root_ids[id(node)] = index
        return self.root_ids[id(root)]

    def sequence(self, root: Dom) -> Dom:
        edges: list[tuple[int, int, int | None]] = []
        size = 2
        pending = [(root, 0, 1)]
        while pending:
            node, start, end = pending.pop()
            if isinstance(node, list):
                if not node:
                    edges.append((start, end, None))
                tasks = []
                for i, child in enumerate(node):
                    target = end if i == len(node) - 1 else size
                    size += i != len(node) - 1
                    tasks.append((child, start, target))
                    start = target
                pending.extend(reversed(tasks))
            elif "child" in node:
                edges.append((start, end, self.root_ids[id(node["child"])]))
            elif "siblings" in node:
                edges.extend(((start, end, None), (start, start, -1)))
            elif "choice" in node:
                pending.extend((arm, start, end) for arm in reversed(node["choice"]))
            elif "optional" in node:
                edges.append((start, end, None))
                pending.append((node["optional"], start, end))
            elif "repeat" in node:
                a, b = size, size + 1
                size += 2
                edges.append((a, end, None))
                pending.extend(((node["repeat"], b, a), (node["repeat"], start, a)))
                if "separator" in node:
                    pending.append((node["separator"], a, b))
                else:
                    edges.append((a, b, None))
        epsilon = [1 << i for i in range(size)]
        for a, b, predicate in edges:
            if predicate is None:
                epsilon[a] |= 1 << b
        for k in range(size):
            for i in range(size):
                if epsilon[i] & (1 << k):
                    epsilon[i] |= epsilon[k]
        return {"size": size, "start": 0, "end": 1, "edges": edges, "epsilon": tuple(epsilon)}

    def intern(self, state: tuple[Any, ...]) -> int:
        old = self.state_ids.get(state)
        if old is not None:
            return old
        index = len(self.states)
        self.states.append(state)
        self.state_ids[state] = index
        _testing.count("structural_states")
        return index

    @staticmethod
    def compose(a: tuple[int, ...], b: tuple[int, ...]) -> tuple[int, ...]:
        out = []
        for row in a:
            value = 0
            while row:
                bit = row & -row
                value |= b[bit.bit_length() - 1]
                row ^= bit
            out.append(value)
        return tuple(out)

    def concat(self, left: int, right: int) -> int:
        key = ("concat", left, right)
        old = self.transitions.get(key)
        if old is not None:
            return old
        a, b = self.states[left], self.states[right]
        state = (min(2, a[0] + b[0]), a[1] if a[0] else b[1], b[2] if b[0] else a[2], a[3] | b[3], tuple(self.compose(x, y) for x, y in zip(a[4], b[4])), None, False)
        result = self.intern(state)
        self.transitions[key] = result
        _testing.count("structural_transitions")
        return result

    def node_state(self, bits: int, empty: bool) -> int:
        if empty:
            return self.intern((0, 0, 0, 0, self.states[self.empty][4], bits, True))
        relations = []
        for machine in self.machines:
            move = [0] * machine["size"]
            for a, b, predicate in machine["edges"]:
                if predicate is not None and (predicate == -1 or bits & (1 << predicate)):
                    move[a] |= 1 << b
            relations.append(self.compose(self.compose(machine["epsilon"], tuple(move)), machine["epsilon"]))
        return self.intern((1, bits, bits, bits, tuple(relations), bits, False))

    def sealed(self) -> int:
        return self.node_state(0,False)

    def node(self, name: str | None, children: int, leaf: tuple[str, str, frozenset[str]] | None = None) -> int:
        key = ("node", name, children, leaf)
        old = self.transitions.get(key)
        if old is not None:
            return old
        state = self.states[children]
        bits = 0
        for i, p in enumerate(self.predicates):
            bit = 1 << i
            holds = False
            if "name" in p:
                holds = name == p["name"]
            elif "terminal" in p:
                holds = leaf is not None and leaf[0] == p["terminal"]
            elif "test" in p:
                holds = leaf is not None and terminal_predicate(p, leaf)
            elif "any" in p or "children" in p:
                holds = (name is not None or leaf is not None) if "any" in p else True
            elif "path" in p:
                child = state[3] if p["path"] == "descendant" else state[1] if p["path"] == "first" else state[2]
                holds = bool(bits & (1 << p["child"]) or child & bit)
            elif "union" in p:
                holds = any(bits & (1 << j) for j in p["operands"])
            elif "intersection" in p:
                holds = all(bits & (1 << j) for j in p["operands"])
            elif "difference" in p:
                holds = bool(bits & (1 << p["operands"][0]) and not bits & (1 << p["operands"][1]))
            if "children" in p:
                machine = self.machines[p["machine"]]
                holds = holds and bool(state[4][p["machine"]][machine["start"]] & (1 << machine["end"]))
            if not p.get("exact", False) and any(key in p for key in ("name", "terminal", "test", "any", "children")) and state[0] == 1:
                holds = holds or bool(state[1] & bit)
            if holds:
                bits |= bit
        result = self.node_state(bits, leaf is None and state[0] == 0)
        self.transitions[key] = result
        _testing.count("structural_transitions")
        return result

    def matches(self, state: int, pattern: Dom) -> bool:
        index = self.root_ids.get(id(pattern))
        return index is not None and self.states[state][5] is not None and bool(self.states[state][5] & (1 << index))


def observation_machine(lowered: Any) -> PatternMachine | None:
    roots = getattr(lowered, "_pattern_roots", None)
    if roots is not None:
        return PatternMachine(roots) if roots or lowered.ranked_helpers else None
    pending = []
    for production in lowered.productions:
        if production.ranked is not None:
            pending.extend(production.slot.source.conditions)
        if production.contextual:
            pending.extend((production.slot.source.tags,production.slot.source.rule_tags))
        pending.extend(production.conds_predict)
        for conditions in production.conds_at.values():
            pending.extend(conditions)
        pending.append(production.tags_term)
        pending.append(production.emit)
    roots = []
    seen: set[int] = set()
    while pending:
        node = pending.pop()
        if not isinstance(node, (list, tuple, dict)) or id(node) in seen:
            continue
        seen.add(id(node))
        if isinstance(node, (list, tuple)):
            pending.extend(node)
        elif node.get("op") in ("≅", "≇"):
            roots.append(node["right"]["pattern"])
        else:
            pending.extend(node.values())
    lowered._pattern_roots = roots
    return PatternMachine(roots) if roots or lowered.ranked_helpers else None
