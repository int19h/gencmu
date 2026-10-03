"""Maximality (engine §4): an elided terminator is forbidden where its
constituent, the node before it, could have been longer. It holds for every
elidable terminator under the resolution's stage-wide maximal, and for the
maximal terminators alone otherwise."""

from __future__ import annotations

from ._earley import Forest, StageContext
from ._grammar import SymbolTest


class Maximal:
    """What the ranking asks of maximal about one parse's items."""

    def __init__(self, forest: Forest, context: StageContext, stage_wide: bool = True, base: int = 0) -> None:
        self.forest = forest
        # The parse's stage, whose tokens a sound test is checked against,
        # and where the parse's tokens begin among them: a nested parse
        # counts its positions from the start of its span.
        self.context = context
        self.base = base
        self.productions = forest.lowered.productions
        # The helpers whose omission maximality restricts: every elidable
        # optional's under stage-wide maximal, and otherwise those of the
        # maximal terminators. An empty production of one is an elided
        # terminator.
        lowered = forest.lowered
        self.elidable = lowered.elidable_helpers if stage_wide else lowered.maximal_helpers
        self.furthest: dict[tuple[int, int], int] | None = None
        self.completed: dict[tuple[int, int], list[int]] | None = None
        # For a tested symbol, the furthest end from each origin at which
        # the symbol completes and the test holds, found once per key.
        self.passing: dict[tuple[SymbolTest, int, int], int] = {}

    def elided(self, item: int) -> bool:
        """Whether a completed item is an elided terminator: the empty
        production of an elidable optional's helper."""
        production = self.productions[self.forest.prod[item]]
        return not production.rhs and production.lhs in self.elidable

    def guards(self, item: int) -> bool:
        """Whether an item's next symbol is an elidable optional whose
        elision the node before it can forbid: not at the start of a
        production, and not after a production's first symbol when that is
        its own rule, what braces or a left chain have read so far."""
        forest = self.forest
        production = self.productions[forest.prod[item]]
        dot = forest.dot[item]
        if dot == len(production.rhs) or production.terminal[dot] or production.rhs[dot] not in self.elidable:
            return False
        return not (dot == 1 and not production.terminal[0] and production.rhs[0] == production.lhs)

    def forbids(self, item: int, test: SymbolTest | None = None) -> bool:
        """Whether an elided terminator may not follow the completed item,
        its constituent, which stands for a symbol with the given test, if
        it has one: its symbol completes from its origin in a later set, in
        an item of which the test also holds, with its own span and tags
        (engine §4)."""
        forest = self.forest
        key = (self.productions[forest.prod[item]].lhs, forest.origin[item])
        if test is not None:
            found = self.passing.get((test, *key))
            if found is None:
                origin = forest.origin[item]
                base = self.base
                found = max(
                    (
                        forest.end[longer]
                        for longer in self.all_completed().get(key, ())
                        if self.context.test_holds(test, base + origin, base + forest.end[longer], forest.tag[longer])
                    ),
                    default=-1,
                )
                self.passing[(test, *key)] = found
            return found > forest.end[item]
        furthest = self.longest().get(key)
        return furthest is not None and furthest > forest.end[item]

    def all_completed(self) -> dict[tuple[int, int], list[int]]:
        """For a tested symbol, every completed item of each symbol from
        each origin, since a longer constituent counts only where the test
        holds of it too, with its own span and tags. Found once, when first
        asked for."""
        completed = self.completed
        if completed is not None:
            return completed
        forest = self.forest
        productions = self.productions
        completed = self.completed = {}
        for item, number in enumerate(forest.prod):
            production = productions[number]
            if forest.dot[item] != len(production.rhs):
                continue
            completed.setdefault((production.lhs, forest.origin[item]), []).append(item)
        return completed

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
