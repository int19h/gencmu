"""Find the restored chosen derivation in the reconstruction chart."""

from __future__ import annotations

from typing import Any, NamedTuple

from . import _testing
from ._earley import RESTORE, SEED
from ._rank import Act
from ._stage import DNode, DRead


class Walk(NamedTuple):
    """Matched edge indices for each witness item, plus its action sequence."""

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
    """Find the restored chosen derivation W(D) before ranking.

    Match each production, span and child in the reconstruction chart.
    Original reads match their token provenance.
    Each omitted terminator matches its helper's synthetic token.
    Return matched edges and the witness's action sequence.
    A missing witness gives None.
    Tests compare the chosen tree's tags separately.
    """
    forest = run.forest
    synthetic = run.synthetic
    # Visit each node after its children and record its reconstructed span.
    # A cursor visits leaves from left to right.
    # Reads consume original tokens.
    # Omitted terminators consume their records' synthetic tokens.
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
        production = node.production.real_id
        if is_elided(node):
            index[(end, production, 0, start)] = []
            continue
        index[(start, production, 0, start)] = []
        for position, child in enumerate(node.children):
            index[(spans[id(child)][1], production, position + 1, start)] = []
    production_ids = (forest.lowered.productions[p].real_id for p in forest.prod)
    for item, key in enumerate(zip(forest.end, production_ids, forest.dot, forest.origin)):
        found_items = index.get(key)
        if found_items is not None:
            found_items.append(item)
    edges = forest.edges

    # Record exact items for each rule node and matched edges for each item.
    found: dict[int, set[int]] = {}
    marks: dict[int, set[int]] = {}
    steps = {}

    def mark(item: int, index: int) -> None:
        marks.setdefault(item, set()).add(index)

    for node in order:
        if isinstance(node, DRead):
            continue
        steps[id(node)] = {}
        start, end = spans[id(node)]
        production = node.production.real_id
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
                        steps[id(node)].setdefault(item, edge)
                        following.add(item)
                        mark(item, number)
            current = following
        found[id(node)] = current
    top = found[id(run.chosen)]
    if not any(root in top for root in forest.roots):
        return None
    # Bind the exact child states of one coherent restored derivation.
    bound = {}
    pending = [(run.chosen, next(root for root in forest.roots if root in top))]
    while pending:
        node, item = pending.pop()
        bound[id(node)] = item
        for child in reversed(node.children):
            pred, kind, a, b = steps[id(node)][item]
            if isinstance(child, DNode):
                pending.append((child, a))
            item = pred
    # Build the witness's actions after visiting each node's children.
    # Use reconstruction tokens and the spans of matched items.
    # Each restoration reads its synthetic token and closes over it.
    # This step does not rank derivations.
    sequence: list[Act] = []
    for node in order:
        start, end = spans[id(node)]
        if isinstance(node, DRead):
            sequence.append(Act(True, token=start, terminal=node.terminal))
            continue
        item = bound[id(node)]
        production = forest.lowered.productions[forest.prod[item]]
        if is_elided(node):
            sequence.append(Act(True, token=start, terminal=production.elided or ""))
        sequence.append(Act(False, item=item, production=production.id, canonical=production.real_id, start=start, end=end, visible=not production.transparent))
    return Walk(marks, sequence)
