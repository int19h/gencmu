"""Find the restored chosen derivation in the reconstruction chart."""

from __future__ import annotations

from typing import Any, NamedTuple

from . import _testing
from ._earley import RESTORE, SEED
from ._rank import Act
from ._stage import DNode, DRead


class Walk(NamedTuple):
    """W(D) as the walk finds it: for each item of W(D), the indices of the
    edges that W(D) uses, and W(D)'s actions in order."""

    marks: dict[int, set[int]]
    sequence: list[Act]


def is_elided(node: DNode | DRead) -> bool:
    """Whether a node of a derivation is an elided terminator: the empty
    production of an elidable optional's helper."""
    if isinstance(node, DRead):
        return False
    production = node.production
    return production.helper and production.elided is not None and not production.rhs and not node.children


def walk_witness(run: _testing.CheckRun) -> Walk | None:
    """The walk: W(D) in the chart of the check, before the check ranks.
    For each node of W(D), from the leaves up, a completed item of the
    node's production over the node's span of R that has an edge whose
    children are the items of the node's children. A read is of the
    original token that D reads, found by its provenance. An elided
    terminator of D is the restoration of its helper over its own synthetic
    token. The walk marks the edges that it matched, by their index, and
    builds W(D)'s actions in order. It pins the shape of W(D), not its
    tags, which the cases pin. ``None`` where the chart does not hold
    W(D)."""
    forest = run.forest
    synthetic = run.synthetic
    # The nodes of D in post-order, each with its span in R. A cursor walks
    # the leaves of D left to right: a read takes the original token, an
    # elided terminator its record's synthetic token, in order.
    order: list[DNode | DRead] = []
    spans: dict[int, tuple[int, int]] = {}
    cursor = 0
    records = 0
    # Each frame is a node, the index of its next child, and where it
    # starts in R.
    stack: list[list[Any]] = [[run.chosen, 0, 0]]
    while stack:
        frame = stack[-1]
        node = frame[0]
        if isinstance(node, DRead):
            at = run.original_at[node.token]
            if at != cursor or synthetic[at]:
                return None
            cursor += 1
            spans[id(node)] = (at, at + 1)
            order.append(node)
            stack.pop()
            continue
        if is_elided(node):
            if records >= len(run.record_at):
                return None
            at = run.record_at[records]
            records += 1
            if at != cursor or not synthetic[at]:
                return None
            cursor += 1
            spans[id(node)] = (at, at + 1)
            order.append(node)
            stack.pop()
            continue
        if frame[1] < len(node.children):
            child = node.children[frame[1]]
            frame[1] += 1
            stack.append([child, 0, cursor])
            continue
        spans[id(node)] = (frame[2], cursor)
        order.append(node)
        stack.pop()
    if records != len(run.record_at) or cursor != len(synthetic):
        return None

    # The items of the forest by their end, production, dot and origin, for
    # the keys that W(D) asks for alone.
    index: dict[tuple[int, int, int, int], list[int]] = {}
    for node in order:
        if isinstance(node, DRead):
            continue
        start, end = spans[id(node)]
        production = node.production.id
        if is_elided(node):
            index[(end, production, 0, start)] = []
            continue
        index[(start, production, 0, start)] = []
        for position, child in enumerate(node.children):
            index[(spans[id(child)][1], production, position + 1, start)] = []
    for item, key in enumerate(zip(forest.end, forest.prod, forest.dot, forest.origin)):
        found_items = index.get(key)
        if found_items is not None:
            found_items.append(item)
    edges = forest.edges

    # For each rule node of W(D), the items that derive it exactly; and for
    # each item found, the indices of the edges that the walk matched.
    found: dict[int, set[int]] = {}
    marks: dict[int, set[int]] = {}

    def mark(item: int, index: int) -> None:
        marks.setdefault(item, set()).add(index)

    for node in order:
        if isinstance(node, DRead):
            continue
        start, end = spans[id(node)]
        production = node.production.id
        if is_elided(node):
            found[id(node)] = {item for item in index.get((end, production, 0, start), ()) if edges[item][0][1] == RESTORE}
            for item in found[id(node)]:
                mark(item, 0)
            continue
        current = {item for item in index.get((start, production, 0, start), ()) if SEED in edges[item]}
        for item in current:
            mark(item, edges[item].index(SEED))
        for position, child in enumerate(node.children):
            child_start, child_end = spans[id(child)]
            following: set[int] = set()
            for item in index.get((child_end, production, position + 1, start), ()):
                for number, edge in enumerate(edges[item]):
                    pred, kind, a, b = edge
                    if pred not in current:
                        continue
                    if isinstance(child, DRead):
                        matched = kind == 1 and a == child_start and b == child.terminal
                    else:
                        matched = kind == 2 and a in found[id(child)]
                    if matched:
                        following.add(item)
                        mark(item, number)
            current = following
        found[id(node)] = current
    top = found[id(run.chosen)]
    if not any(root in top for root in forest.roots):
        return None
    # W(D)'s actions, in the order in which the ranking builds a sequence:
    # reads and closes in post-order, over the tokens of R and the spans of
    # the items found. A restoration reads its synthetic token, and then
    # closes over it. Nothing is ranked to build it.
    sequence: list[Act] = []
    for node in order:
        start, end = spans[id(node)]
        if isinstance(node, DRead):
            sequence.append(Act(True, token=start, terminal=node.terminal))
            continue
        production = node.production
        if is_elided(node):
            sequence.append(Act(True, token=start, terminal=production.elided or ""))
        item = min(found[id(node)])
        sequence.append(Act(False, item=item, production=production.id, start=start, end=end, visible=not production.transparent))
    return Walk(marks, sequence)
