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

An omission of a maximal terminator with a constituent Y is also forbidden
when Y is not the longest possible: the query's whole chart has a completed
item of the same symbol, from the same origin, with a later end, that
passes Y's test. That item need not be eligible or fit a proof tree, and a
terminator need not be written. Maximality never forbids an omission with
no constituent.

A proof tree is eligible when none of its omissions is forbidden. Each item
has two states, computed together to the least fixpoint: E, it has an
eligible proof tree, and P, it has one whose fixed prefix permits the next
optional to be empty. P follows the advance over Y of that same tree, so a
permitted omission never combines with the prefix of another tree.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ._earley import Forest, StageContext

# What follows an item: no elidable optional, one with no constituent, or
# one whose constituent is the item's last symbol (engine §4).
NONE, ALONE, CONSTITUENT = 0, 1, 2


def eligible(forest: Forest, witnesses: list[int], context: StageContext | None = None, base: int = 0) -> list[int]:
    """The completed items among ``witnesses`` that have an eligible proof
    tree in the forest's chart, in their order. ``context`` and ``base`` are
    the stage and where the query's span begins in its tokens, which the
    test of a longer constituent of a maximal terminator reads."""
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

    def follows(item: int) -> int:
        production = productions[prod[item]]
        position = dot[item]
        if position == len(production.rhs) or production.terminal[position] or production.rhs[position] not in helpers:
            return NONE
        if position == 0 or production.terminal[position - 1]:
            return ALONE
        if position == 1 and production.rhs[0] == production.lhs:
            return ALONE
        return CONSTITUENT

    after = {item: follows(item) for item in order}

    # The table of longer constituents, built from the query's own chart
    # once, when a maximal terminator first needs it (engine §4).
    maximal_helpers = lowered.maximal_helpers
    longest: list[Any] = []

    def shorter(item: int, child: int) -> bool:
        """Whether the item's maximal optional may not be empty after the
        constituent ``child``: a longer one completes from its origin."""
        if productions[prod[item]].rhs[dot[item]] not in maximal_helpers:
            return False
        if not longest:
            from ._maximal import Maximal

            assert context is not None
            longest.append(Maximal(forest, context, False, base))
        production = productions[prod[item]]
        test = production.tests[dot[item] - 1] if production.tests else None
        return bool(longest[0].forbids(child, test))

    has_e: set[int] = set()
    has_p: set[int] = set()
    changed = True
    while changed:
        changed = False
        for item in order:
            what = after[item]
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
                elif what == CONSTITUENT and kind == 2 and further.get(pred, -1) < end and not shorter(item, child):
                    # The tree's own prefix before Y permits the omission,
                    # and Y is the longest possible where the terminator is
                    # maximal.
                    p = True
                if p or what == NONE:
                    break
            if e and item not in has_e:
                has_e.add(item)
                changed = True
            if p and item not in has_p:
                has_p.add(item)
                changed = True
    return [witness for witness in witnesses if witness in has_e]
