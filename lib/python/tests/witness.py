"""The witness hook of tests/README.md: whether the check of elision-only
kept W(D), the chosen derivation mapped to the reconstructed input, as a
counted derivation of its forest (engine §7.8). It reads the check through
the library's private test hook, never through its API, and it ranks
nothing itself: it marks W(D)'s edges before the check ranks, and reads
what the check's own ranking did with them."""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator, NamedTuple

from gencmu import _testing
from gencmu._earley import RESTORE, SEED
from gencmu._rank import INF, Act, Ranking, Rope, compare, concat, first_difference, leaf
from gencmu._stage import DNode, DRead


class Walk(NamedTuple):
    """W(D) as the walk finds it: for each item of W(D), the indices of the
    edges that W(D) uses, and W(D)'s actions in order."""

    marks: dict[int, set[int]]
    sequence: list[Act]


@contextmanager
def checks() -> Iterator[list[bool]]:
    """For each check of elision-only that runs inside the block and meets
    no error of the grammar, whether it kept its witness. The hook answers
    as the check runs, so that no check's forest outlives it."""
    answers: list[bool] = []
    before = _testing.elision_check

    def watch(run: _testing.CheckRun) -> _testing.CheckWatch:
        walk = walk_witness(run)
        index = len(answers)
        answers.append(False)

        def ranked(ranking: Ranking | None) -> None:
            answers[index] = walk is not None and keeps(walk, ranking)

        return _testing.CheckWatch(walk.marks if walk is not None else None, ranked)

    _testing.elision_check = watch
    try:
        yield answers
    finally:
        _testing.elision_check = before


def keeps(walk: Walk, ranking: Ranking | None) -> bool:
    """The hook's two channels. The count channel: the check's own count, in
    the same loop that counts, counted a derivation of W(D)'s marked edges
    only. The selection channel: where the check reports two readings, the
    first does not come after W(D) in the order T. Where the first is not
    W(D), W(D) was a candidate for the second, so the second does not come
    after W(D) by the criterion of engine §6 that picks it: divergence from
    the first, then T."""
    if ranking is None or not ranking.witness_counted:
        return False
    if ranking.verdict != "tie":
        return True
    w: Rope | None = None
    for act in walk.sequence:
        w = concat(w, leaf(act))
    first = compare(ranking.first, w, "none").order
    if first > 0:
        return False
    return first == 0 or second_order(ranking.first, ranking.second, w) <= 0


def second_order(first: Rope | None, left: Rope | None, right: Rope | None) -> int:
    """How two derivations compare as the second reading after ``first``
    (engine §6): the one that diverges from it earlier, in visible actions,
    comes first, and the order T decides between two that diverge at one
    point. Negative where ``left`` comes first."""

    def divergence(other: Rope | None) -> Any:
        difference = first_difference(first, other, True)
        return INF if difference is None else difference[0]

    a, b = divergence(left), divergence(right)
    if a != b:
        return -1 if a < b else 1
    return compare(left, right, "none").order


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
