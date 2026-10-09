"""The witness hook of tests/README.md: whether the check of elision-only
kept W(D), the chosen derivation mapped to the reconstructed input, as a
counted derivation of its forest (engine §7.8). It reads the check through
the library's private test hook, never through its API, and it ranks
nothing itself: it marks W(D)'s edges before the check ranks, and reads
what the check's own ranking did with them."""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from gencmu import _testing
from gencmu._rank import Ranking, Rope, compare, concat, leaf
from gencmu._witness import Walk, walk_witness


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
    after W(D) in the canonical order T."""
    if ranking is not None and ranking.raw_witness_counted is not None:
        return ranking.raw_witness_counted
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
    return first == 0 or compare(ranking.second, w, "none").order <= 0
