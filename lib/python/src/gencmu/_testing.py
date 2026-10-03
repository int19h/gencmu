"""A hook for the library's own tests. Nothing here is part of the API, and
the package does not export it.

``elision_check``, when set, receives each check of elision-only (engine
§7) that ran and met no error of the grammar, for the witness test of
tests/README.md."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    from ._earley import Forest
    from ._stage import DNode


@dataclass
class CheckRun:
    """What the check of engine §7 hands its test hook: D, the chosen
    derivation of the main parse; the forest of the recognition of R, whose
    roots are the completed items of ``text`` over R; for each token of R,
    whether it is synthetic, by its provenance; for each token of the
    stage's input, its index in R; and for each restoration record, the
    index of its synthetic token in R. ``counted`` says whether the ranking
    of the check counted a derivation."""

    chosen: DNode
    forest: Forest
    counted: bool
    synthetic: list[bool]
    original_at: list[int]
    record_at: list[int]


elision_check: Callable[[CheckRun], None] | None = None
