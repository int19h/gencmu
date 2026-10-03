"""The witness hook of tests/README.md: whether the check of elision-only
kept W(D), the chosen derivation mapped to the reconstructed input, as a
counted derivation of its forest (engine §7.8). It reads the check through
the library's private test hook, never through its API."""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import replace
from typing import Any, Iterator

from gencmu import _testing
from gencmu._earley import RESTORE, SEED
from gencmu._stage import DNode, DRead


@contextmanager
def checks() -> Iterator[list[bool]]:
    """For each check of elision-only that runs inside the block and meets
    no error of the grammar, whether it kept its witness. The hook answers
    as the check runs, so that no check's forest outlives it."""
    answers: list[bool] = []
    before = _testing.elision_check
    _testing.elision_check = lambda run: answers.append(keeps_witness(run))
    try:
        yield answers
    finally:
        _testing.elision_check = before


def is_elided(node: DNode | DRead) -> bool:
    """Whether a node of a derivation is an elided terminator: the empty
    production of an elidable optional's helper."""
    if isinstance(node, DRead):
        return False
    production = node.production
    return production.helper and production.elided is not None and not production.rhs and not node.children


def keeps_witness(run: _testing.CheckRun) -> bool:
    """Whether a check's forest holds W(D) as a counted derivation. First,
    the chart must hold it: for each node of W(D), from the leaves up, a
    completed item of the node's production over the node's span of R that
    has an edge whose children are the items of the node's children. A read
    is of the original token that D reads, found by its provenance. An
    elided terminator of D is the restoration of its helper over its own
    synthetic token. Then the check's own ranking must count it: the part
    of the forest made of the items found, each with only the edges that
    the walk matched, must have a derivation that counts. A faulty ranker
    can lose W(D) from a chart that holds it. The walk pins the shape of
    W(D) and its count, not its tags, which the cases pin."""
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
                return False
            cursor += 1
            spans[id(node)] = (at, at + 1)
            order.append(node)
            stack.pop()
            continue
        if is_elided(node):
            if records >= len(run.record_at):
                return False
            at = run.record_at[records]
            records += 1
            if at != cursor or not synthetic[at]:
                return False
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
        return False

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
    # each item found, the edges that the walk matched.
    found: dict[int, set[int]] = {}
    matched_edges: dict[int, list[tuple[Any, ...]]] = {}

    def keep(item: int, edge: tuple[Any, ...]) -> None:
        kept = matched_edges.setdefault(item, [])
        if edge not in kept:
            kept.append(edge)

    for node in order:
        if isinstance(node, DRead):
            continue
        start, end = spans[id(node)]
        production = node.production.id
        if is_elided(node):
            found[id(node)] = {item for item in index.get((end, production, 0, start), ()) if edges[item][0][1] == RESTORE}
            for item in found[id(node)]:
                keep(item, edges[item][0])
            continue
        current = {item for item in index.get((start, production, 0, start), ()) if SEED in edges[item]}
        for item in current:
            keep(item, SEED)
        for position, child in enumerate(node.children):
            child_start, child_end = spans[id(child)]
            following: set[int] = set()
            for item in index.get((child_end, production, position + 1, start), ()):
                for edge in edges[item]:
                    pred, kind, a, b = edge
                    if pred not in current:
                        continue
                    if isinstance(child, DRead):
                        matched = kind == 1 and a == child_start and b == child.terminal
                    else:
                        matched = kind == 2 and a in found[id(child)]
                    if matched:
                        following.add(item)
                        keep(item, edge)
            current = following
        found[id(node)] = current
    top = found[id(run.chosen)]
    roots = [root for root in forest.roots if root in top]
    if not roots:
        return False
    # The part of the forest that holds W(D): every other item keeps no
    # edge. The check's own ranker must count a derivation of it.
    part = replace(forest, edges=[matched_edges.get(item, []) for item in range(len(edges))], roots=roots)
    return run.rank(part) is not None
