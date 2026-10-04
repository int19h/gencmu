"""A hook for the library's own tests. Nothing here is part of the API, and
the package does not export it.

``elision_check``, when set, receives each check of elision-only (engine
§7) that recognized R and met no error of the grammar, before it ranks,
for the witness test of tests/README.md. It gives back the marks of W(D)'s
edges, which the check's own ranker takes, and a callback for the
ranking.

``faults`` holds the faults of the library's own paths in the check that a
test turns on, one at a time, to show that the shared cases catch each
(tests/README.md, tests/test_faults.py). An empty set is the engine as
specified:

- "reprocess" leaves an item that an ordinary step reaches after it was
  processed as strict as it was (engine §7.4).
- "again" makes the processing of such an item again do nothing: no
  ordinary prediction of its next symbol, and no advance over an empty
  constituent.
- "route3" makes the item after the T of route 3 ordinary (engine §7.4).
- "restore" makes a restoration without the test of its terminal.
- "rank-restoration" gives a restoration no derivation in the ranking, so
  the ranking does not count W(D) though the chart holds it.
- "lost:context" makes the check's count skip the first of two or more
  edges of an item, and "lost:select" makes its candidates skip it. In the
  sibling cases that edge is W(D)'s, since the agenda completes it first.
  Only the witness hook sees lost:context where the readings stay."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    from ._earley import Forest
    from ._rank import Ranking
    from ._stage import DNode


@dataclass
class CheckRun:
    """What the check of engine §7 hands its test hook, after it recognizes
    R and before it ranks: D, the chosen derivation of the main parse; the
    forest of the recognition of R, whose roots are the completed items of
    ``text`` over R; for each token of R, whether it is synthetic, by its
    provenance; for each token of the stage's input, its index in R; and for
    each restoration record, the index of its synthetic token in R."""

    chosen: DNode
    forest: Forest
    synthetic: list[bool]
    original_at: list[int]
    record_at: list[int]


@dataclass
class CheckWatch:
    """What the witness test hands back to the check: the marks of W(D),
    for each item the indices of the edges that W(D) uses, or ``None``
    where the chart does not hold W(D); and a callback that receives the
    check's ranking, ``None`` where it has none."""

    marks: dict[int, set[int]] | None
    ranked: Callable[[Ranking | None], None]


elision_check: Callable[[CheckRun], CheckWatch] | None = None

# Every fault that ``faults`` takes, for the tests that run each one.
FAULTS = ("reprocess", "again", "route3", "restore", "rank-restoration", "lost:context", "lost:select")

faults: set[str] = set()
