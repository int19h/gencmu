"""The resolution maximal (engine §4): an elided terminator is forbidden
where its constituent, the node before it, could have been longer."""

from __future__ import annotations

from ._earley import Forest


class Maximal:
    """What the ranking asks of maximal about one parse's items."""

    def __init__(self, forest: Forest) -> None:
        self.forest = forest
        self.productions = forest.lowered.productions
        # The helpers of the elidable optionals: an empty production of one
        # is an elided terminator.
        self.elidable = frozenset(
            production.lhs for production in self.productions if production.helper and production.elided is not None
        )
        self.furthest: dict[tuple[int, int], int] | None = None

    def elided(self, item: int) -> bool:
        """Whether a completed item is an elided terminator: the empty
        production of an elidable optional's helper."""
        production = self.productions[self.forest.prod[item]]
        return production.helper and production.elided is not None and not production.rhs

    def guards(self, item: int) -> bool:
        """Whether an item's next symbol is an elidable optional whose
        elision the node before it can forbid: not at the start of a
        production, and not after a production's first symbol when that is
        its own rule, what a repetition has read so far."""
        forest = self.forest
        production = self.productions[forest.prod[item]]
        dot = forest.dot[item]
        if dot == len(production.rhs) or production.terminal[dot] or production.rhs[dot] not in self.elidable:
            return False
        return not (dot == 1 and not production.terminal[0] and production.rhs[0] == production.lhs)

    def forbids(self, item: int) -> bool:
        """Whether an elided terminator may not follow the completed item,
        its constituent: its symbol completes from its origin in a later
        set."""
        forest = self.forest
        end = self.longest().get((self.productions[forest.prod[item]].lhs, forest.origin[item]))
        return end is not None and end > forest.end[item]

    def longest(self) -> dict[tuple[int, int], int]:
        """Whether a constituent could have been longer depends only on its
        symbol, origin and end: the furthest set holding a completed item of
        each symbol from each origin decides it. Found once, when first
        asked for."""
        furthest = self.furthest
        if furthest is not None:
            return furthest
        forest = self.forest
        productions = self.productions
        furthest = self.furthest = {}
        for item, number in enumerate(forest.prod):
            production = productions[number]
            if forest.dot[item] != len(production.rhs):
                continue
            key = (production.lhs, forest.origin[item])
            known = furthest.get(key)
            if known is None or known < forest.end[item]:
                furthest[key] = forest.end[item]
        return furthest
