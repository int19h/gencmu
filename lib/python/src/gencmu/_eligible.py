"""Written-terminator priority for nested queries (engine §4): which
completed items of a queried rule have an eligible proof tree.

A proof tree of an item justifies it from the chart: a predicted item is a
leaf, and an advance over a token or a completed item is a node over a
proof tree of the item before it and, for a completion, one of the
completed item. An omission is an advance over the empty helper of an
elidable optional, at its position p. It is forbidden where the prefix
that the proof tree holds fixed can read the whole optional as written:

- Where the optional has a constituent Y, the fixed prefix is the item
  before Y in the same proof tree. The omission is forbidden when the
  chart advances that item over a completed Y to some p' >= p, and the
  item so made advances over a completed nonempty alternative of the
  optional.
- Otherwise the fixed prefix is the item before the optional, and the
  omission is forbidden when the chart advances that item over a completed
  nonempty alternative of the optional.

A proof tree is eligible when none of its omissions is forbidden. Each item
has two states, computed together to the least fixpoint: E, it has an
eligible proof tree, and P, it has one whose fixed prefix permits the next
optional to be empty. P follows the advance over Y of that same tree, so a
permitted omission never combines with the prefix of another tree.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ._earley import Forest

# What follows an item: no elidable optional, one with no constituent, or
# one whose constituent is the item's last symbol (engine §4).
NONE, ALONE, CONSTITUENT, OPTIONAL = 0, 1, 2, 3


def eligible(forest: Forest, witnesses: list[int]) -> list[int]:
    """The completed items among ``witnesses`` that have an eligible proof
    tree in the forest's chart, in their order."""
    if not witnesses:
        return witnesses
    lowered = forest.lowered
    helpers = lowered.elidable_helpers
    if not helpers:
        return witnesses
    productions = lowered.productions
    prod, dot, edges = forest.prod, forest.dot, forest.edges

    def omitted(item: int) -> bool:
        production = productions[prod[item]]
        return production.helper and production.elided is not None and not production.rhs

    # The items the witnesses rest on, each after the items below it where
    # the edges allow, so that one sweep settles most of them.
    order: list[int] = []
    seen: set[int] = set()
    omits = False
    for witness in witnesses:
        if witness in seen:
            continue
        seen.add(witness)
        stack = [(witness, 0)]
        while stack:
            item, step = stack[-1]
            item_edges = edges[item]
            pushed = False
            while step < 2 * len(item_edges):
                pred, kind, child, _ = item_edges[step >> 1]
                below = -1
                if step & 1 == 0:
                    below = pred if kind != 0 else -1
                elif kind == 2:
                    below = child
                    if omitted(child):
                        omits = True
                step += 1
                if below >= 0 and below not in seen:
                    seen.add(below)
                    stack[-1] = (item, step)
                    stack.append((below, 0))
                    pushed = True
                    break
            if pushed:
                continue
            stack.pop()
            order.append(item)
    # With no omission, every item has a finite proof tree: the one in
    # which the recognizer made it.
    if not omits:
        return witnesses

    # From the whole chart, eligible or not: the items that advance over a
    # written optional, and for each item before a constituent Y, the
    # furthest end of an advance over Y that then reads the optional as
    # written.
    reads: set[int] = set()
    for item_edges in edges:
        for pred, kind, child, _ in item_edges:
            if kind == 2:
                # A completed nonempty alternative of an elidable optional.
                production = productions[prod[child]]
                if production.lhs in helpers and production.rhs:
                    reads.add(pred)
    further: dict[int, int] = {}
    for item in reads:
        for pred, kind, _, _ in edges[item]:
            if kind == 2 and further.get(pred, -1) < forest.end[item]:
                further[pred] = forest.end[item]

    # Captured plain optionals have physical expansions, but remain one
    # preceding nonterminal for priority. Record each boundary in the
    # written structure, including starts inside nested optionals.
    boundaries: dict[tuple[int, int], tuple[int, tuple | None]] = {}
    for production in productions:
        sequences = [(production.logical, True)]
        while sequences:
            sequence, top = sequences.pop()
            previous = None
            for node in sequence:
                if node[0] == "optional":
                    sequences.append((node[3], False))
                else:
                    position = node[1]
                    if not production.terminal[position] and production.rhs[position] in helpers:
                        what, group = ALONE, None
                        if previous is not None and previous[0] == "optional":
                            what, group = OPTIONAL, previous
                        elif previous is not None and not production.terminal[previous[1]]:
                            self_reference = top and previous == sequence[0] and production.rhs[previous[1]] == production.lhs
                            if not self_reference:
                                what = CONSTITUENT
                        boundaries[production.id, position] = what, group
                previous = node

    def boundary(item: int):
        return boundaries.get((prod[item], dot[item]), (NONE, None))

    def prefixes(item: int, width: int, eligible_only: bool = False) -> set[int]:
        """Rewind the selected helper route to its own fixed prefix."""
        found = {item}
        for _ in range(width):
            earlier = set()
            for current in found:
                for pred, kind, child, _ in edges[current]:
                    if kind not in (1, 2):
                        continue
                    if eligible_only:
                        permits = pred in has_p if kind == 2 and omitted(child) else pred in has_e
                        if not permits or (kind == 2 and child not in has_e):
                            continue
                    earlier.add(pred)
            found = earlier
        return found

    def prefix_key(item: int, group: tuple):
        """Unify only the routes of this optional at this fixed prefix."""
        production = productions[prod[item]]
        start, width, place = group[1], group[2], group[4]
        stop = start + width
        tests = production.tests or (None,) * len(production.rhs)
        captured = tuple(
            (name, forest.caps[item][production.slots[position]])
            for name, position in sorted(production.captures.items())
            if name != "\u0000" and position < start
        )
        return (
            id(production.source), production.lhs, place,
            production.rhs[:start], production.rhs[stop:],
            production.terminal[:start], production.terminal[stop:],
            tests[:start], tests[stop:], forest.origin[item], forest.end[item], captured,
            forest.prefix[item] if forest.prefix else 0,
            forest.close_prefix[item] if forest.close_prefix else 0,
            id(production.lexical),
        )

    group_further: dict[tuple, int] = {}
    for item in reads:
        what, group = boundary(item)
        if what == OPTIONAL:
            for prefix in prefixes(item, group[2]):
                key = prefix_key(prefix, group)
                group_further[key] = max(group_further.get(key, -1), forest.end[item])

    after = {item: boundary(item) for item in order}

    has_e: set[int] = set()
    has_p: set[int] = set()
    changed = True
    while changed:
        changed = False
        for item in order:
            what, group = after[item]
            if item in has_e and (what == NONE or item in has_p):
                continue
            e = p = False
            end = forest.end[item]
            for pred, kind, child, _ in edges[item]:
                if kind == 0:
                    through = True
                elif kind == 1:
                    through = pred in has_e
                else:
                    through = (pred in has_p if omitted(child) else pred in has_e) and child in has_e
                if not through:
                    continue
                e = True
                if what == ALONE:
                    p = item not in reads
                elif what == CONSTITUENT and kind == 2 and further.get(pred, -1) < end:
                    # The tree's own prefix before Y permits the omission.
                    p = True
                if p or what == NONE:
                    break
            if e and what == OPTIONAL:
                p = any(
                    prefix in has_e and group_further.get(prefix_key(prefix, group), -1) < end
                    for prefix in prefixes(item, group[2], eligible_only=True)
                )
            if e and item not in has_e:
                has_e.add(item)
                changed = True
            if p and item not in has_p:
                has_p.add(item)
                changed = True
    return [witness for witness in witnesses if witness in has_e]
