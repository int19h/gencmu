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


def eligible(forest: Forest, witnesses: list[int], error_free: bool = False) -> list[int]:
    """The completed items among ``witnesses`` that have an eligible proof
    tree in the forest's chart, in their order."""
    if not witnesses:
        return witnesses
    lowered = forest.lowered
    helpers = lowered.elidable_helpers
    errors = lowered.has_errors
    if not helpers and not errors and not error_free:
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
    if not omits and not errors and not error_free:
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

    def prefixes(item: int, width: int) -> set[int]:
        """Rewind the selected helper route to its own fixed prefix."""
        found = {item}
        for _ in range(width):
            earlier = set()
            for current in found:
                for pred, kind, child, _ in edges[current]:
                    if kind not in (1, 2):
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
            # Private capture routes can have separate helpers for one
            # written parent. Their logical parent remains the same.
            id(production.source), lowered.written_helpers.get(production.lhs, production.lhs), place,
            production.rhs[:start], production.rhs[stop:],
            production.terminal[:start], production.terminal[stop:],
            tests[:start], tests[stop:], forest.origin[item], forest.end[item], captured,
            forest.prefix[item] if forest.prefix else 0,
            forest.close_prefix[item] if forest.close_prefix else 0,
            id(production.lexical),
            forest.boundaries[item].id if forest.boundaries else 0,
        )

    group_further: dict[tuple, int] = {}
    for item in reads:
        what, group = boundary(item)
        if what == OPTIONAL:
            for prefix in prefixes(item, group[2]):
                key = prefix_key(prefix, group)
                group_further[key] = max(group_further.get(key, -1), forest.end[item])

    after = {item: boundary(item) for item in order}

    # Clean and dirty proof states remain separate through each E/P channel.
    eligible_states, permits = [0] * len(edges), [0] * len(edges)
    support, support_permits = [0] * len(edges), [0] * len(edges)
    tokens = forest.context.tokens if forest.context is not None else forest.tokens
    base = forest.base if forest.context is not None else 0

    def combine(left, right):
        return (left & right & 1) | (2 if left and right and (left | right) & 2 else 0)

    def dirty_read(kind, child):
        return kind in (1, 3) and bool(tokens[base + child].errors)

    def group_permits(item, group, end, states, permissions, bit):
        pending, seen = [(item, bit)], set()
        while pending:
            current, bit = pending.pop()
            key = current, bit
            if key in seen or not states[current] & bit:
                continue
            seen.add(key)
            if dot[current] == group[1]:
                if group_further.get(prefix_key(current, group), -1) < end:
                    return True
                continue
            for pred, kind, child, _ in edges[current]:
                if kind == 1:
                    for before in (1, 2):
                        if states[pred] & before and (2 if dirty_read(kind, child) else before) == bit:
                            pending.append((pred, before))
                elif kind == 2:
                    before_states = permissions[pred] if omitted(child) else states[pred]
                    for before in (1, 2):
                        for child_bit in (1, 2):
                            if before_states & before and states[child] & child_bit and combine(before, child_bit) == bit:
                                pending.append((pred, before))
        return False

    changed = True
    while changed:
        changed = False
        for item in order:
            what, group = after[item]
            for raw in (True, False):
                states, permissions = (support, support_permits) if raw else (eligible_states, permits)
                e = p = 0
                for pred, kind, child, _ in edges[item]:
                    if kind in (0, 3):
                        through = 2 if dirty_read(kind, child) else 1
                    elif kind == 1:
                        through = (2 if states[pred] else 0) if dirty_read(kind, child) else states[pred]
                    else:
                        through = combine(permissions[pred] if omitted(child) else states[pred], states[child])
                    if not through:
                        continue
                    e |= through
                    if what == ALONE and item not in reads:
                        p |= through
                    elif what == OPTIONAL:
                        for bit in (1, 2):
                            if through & bit and group_permits(item, group, forest.end[item], states, permissions, bit):
                                p |= bit
                    elif what == CONSTITUENT and kind == 2 and further.get(pred, -1) < forest.end[item]:
                        p |= through
                production = productions[prod[item]]
                if dot[item] == len(production.rhs):
                    if production.erased:
                        e = 1 if support[item] or e else 0
                        p = 1 if p else 0
                    elif production.error is not None:
                        e = 2 if raw and e else 0
                        p = 2 if raw and p else 0
                if states[item] | e != states[item]:
                    states[item] |= e
                    changed = True
                if permissions[item] | p != permissions[item]:
                    permissions[item] |= p
                    changed = True
    return [item for item in witnesses if eligible_states[item] & (1 if error_free else 3)]
