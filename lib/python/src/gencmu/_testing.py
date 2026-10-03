"""A hook for the library's own tests. Nothing here is part of the API, and
the package does not export it.

``elision_check``, when set, receives each check of elision-only (engine
§7) that ran and met no error of the grammar, for the witness test of
tests/README.md.

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
  the ranking does not count W(D) though the chart holds it."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    from ._earley import Forest
    from ._rank import Ranking
    from ._stage import DNode


@dataclass
class CheckRun:
    """What the check of engine §7 hands its test hook: D, the chosen
    derivation of the main parse; the forest of the recognition of R, whose
    roots are the completed items of ``text`` over R; for each token of R,
    whether it is synthetic, by its provenance; for each token of the
    stage's input, its index in R; and for each restoration record, the
    index of its synthetic token in R. ``rank`` is the check's own ranking
    of a part of its forest, in the cycle contexts of the whole: ``None``
    where it counts no derivation."""

    chosen: DNode
    forest: Forest
    rank: Callable[[Forest], Ranking | None]
    synthetic: list[bool]
    original_at: list[int]
    record_at: list[int]


elision_check: Callable[[CheckRun], None] | None = None

faults: set[str] = set()
