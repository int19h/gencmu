"""Finite structural observations of candidate trees (engine §4.1)."""

from __future__ import annotations

import re
from typing import Any, Callable

from . import _testing

Dom = dict[str, Any]


def pattern_parts(node: Dom) -> list[Dom]:
    for key in ("union", "intersection", "difference", "sequence"):
        if key in node:
            return node[key]
    if "test" in node:
        return [node["expr"]]
    return [node[key] for key in ("pattern", "children", "node", "optional", "repeat", "separator") if key in node]


def walk_pattern(root: Dom):
    stack = [(root, 0)]
    while stack:
        node, depth = stack.pop()
        yield node, depth
        stack.extend((child, depth + 1) for child in reversed(pattern_parts(node)))


def _consumes(root: Dom) -> bool:
    return any("node" in node or "siblings" in node for node, _ in walk_pattern(root))


def pattern_problem(root: Any, test_fault: Callable[[Dom], str | None] | None = None, initial_depth: int = 0) -> str | None:
    stack = [(root, False, False, initial_depth)]
    while stack:
        node, children, repeated, depth = stack.pop()
        if depth > 256:
            return "nested too deeply"
        if not isinstance(node, dict):
            return "a malformed pattern"
        keys = set(node)
        def push(value: Any, child: bool = False, repeat: bool = repeated) -> None:
            stack.append((value, child, repeat, depth + 1))
        if children:
            if keys == {"node"}:
                push(node["node"])
            elif keys == {"siblings"}:
                if node["siblings"] is not True or repeated:
                    return "a sibling ellipsis cannot be a repeat item or separator"
            elif keys == {"sequence"}:
                if not isinstance(node["sequence"], list) or len(node["sequence"]) < 2:
                    return "a malformed pattern sequence"
                for child in node["sequence"]:
                    push(child, True)
            elif keys == {"optional"}:
                push(node["optional"], True)
            elif keys in ({"repeat"}, {"repeat", "separator"}):
                push(node["repeat"], True, True)
                if "separator" in node:
                    push(node["separator"], True, True)
            else:
                return "a malformed pattern children expression"
        elif any(keys == {key, "at"} for key in ("name", "terminal", "constant")):
            key = next(key for key in ("name", "terminal", "constant") if key in node)
            name, at = node[key], node["at"]
            if not isinstance(name, str) or not isinstance(at, list) or len(at) != 2 or any(type(n) is not int for n in at):
                return "a malformed pattern atom"
            if key == "name":
                if name != "#" and re.fullmatch(r"[a-z][A-Za-z0-9-]*", name) is None:
                    return "a malformed pattern rule name"
            elif re.fullmatch(r"[A-Z][A-Za-z0-9-]*", name) is None:
                return "a malformed pattern terminal or constant"
        elif keys == {"test", "expr", "value"}:
            if not isinstance(node["expr"], dict) or "terminal" not in node["expr"] or node["test"] not in ("=", "≠", "⊇", "⊉", "∩=∅", "∩≠∅"):
                return "a pattern test requires one terminal atom"
            if test_fault is not None:
                problem = test_fault(node)
                if problem is not None:
                    return problem
            push(node["expr"])
        elif keys == {"children"}:
            push(node["children"], True)
        elif keys == {"path", "pattern"}:
            if node["path"] not in ("descendant", "first", "last"):
                return "a malformed pattern path"
            push(node["pattern"])
        else:
            key = next((key for key in ("union", "intersection", "difference") if keys == {key}), None)
            if key is None or not isinstance(node[key], list) or len(node[key]) < 2 or key == "difference" and len(node[key]) != 2:
                return "a malformed pattern"
            for child in node[key]:
                push(child)
    for node, _ in walk_pattern(root):
        if "repeat" in node and not _consumes(node["repeat"]):
            return "a pattern repeat cannot match only empty sequences"
    return None


def empty_pattern() -> Dom:
    all_nodes = {"children": {"siblings": True}}
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


def leaf_test(node: Dom, sound: str, tags: frozenset[str]) -> bool:
    value, op = node["value"], node["test"]
    if op in ("=", "≠"):
        return (sound == value["string"]) == (op == "=")
    wanted = value.get("set", frozenset((value["tag"],)) if "tag" in value else frozenset())
    if op in ("⊇", "⊉"):
        return (wanted <= tags) == (op == "⊇")
    return tags.isdisjoint(wanted) == (op == "∩=∅")


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
                    kids = [p["node"] for p, _ in walk_pattern(node["children"]) if "node" in p]
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
            if "node" in node:
                edges.append((start, end, self.root_ids[id(node["node"])]))
            elif "siblings" in node:
                edges.extend(((start, end, None), (start, start, -1)))
            elif "sequence" in node:
                tasks = []
                for i, child in enumerate(node["sequence"]):
                    target = end if i == len(node["sequence"]) - 1 else size
                    size += i != len(node["sequence"]) - 1
                    tasks.append((child, start, target))
                    start = target
                pending.extend(reversed(tasks))
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
        return self.node(None,self.empty,("","",frozenset()))

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
                holds = leaf is not None and leaf[0] == p["expr"]["terminal"] and leaf_test(p, leaf[1], leaf[2])
            elif "children" in p:
                machine = self.machines[p["machine"]]
                holds = bool(state[4][p["machine"]][machine["start"]] & (1 << machine["end"]))
            elif "path" in p:
                child = state[3] if p["path"] == "descendant" else state[1] if p["path"] == "first" else state[2]
                holds = bool(bits & (1 << p["child"]) or child & bit)
            elif "union" in p:
                holds = any(bits & (1 << j) for j in p["operands"])
            elif "intersection" in p:
                holds = all(bits & (1 << j) for j in p["operands"])
            elif "difference" in p:
                holds = bool(bits & (1 << p["operands"][0]) and not bits & (1 << p["operands"][1]))
            if any(key in p for key in ("name", "terminal", "test", "children")) and state[0] == 1:
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
        return PatternMachine(roots) if roots or lowered.grammar.preferences and lowered.grammar.preferences.names else None
    pending = []
    for production in lowered.productions:
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
    return PatternMachine(roots) if roots or lowered.grammar.preferences and lowered.grammar.preferences.names else None
