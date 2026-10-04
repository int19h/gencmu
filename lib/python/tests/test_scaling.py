"""Work that must grow linearly with its input: the internal functions that
read a span, fold a union or check a list, timed at a size n and 4n. A
function whose work grows with the square of its input takes about 16 times
as long at 4n, and a linear one about 4 times, so the tests allow 8."""

from __future__ import annotations

import time
import unittest
from typing import Callable

from gencmu._earley import Evaluator, StageContext
from gencmu._model import Token

from .shared import load_case_dialect

EPSILON = 0.002
"""Seconds of slack for timer noise on very short runs."""


def best_time(work: Callable[[], object]) -> float:
    """The least of three timings, which is the least disturbed by other work
    on the machine. A run of over a second is decisive alone, so that a
    quadratic fault fails without waiting for two more."""
    best = float("inf")
    for _ in range(3):
        start = time.perf_counter()
        work()
        best = min(best, time.perf_counter() - start)
        if best > 1:
            break
    return best


class Linear(unittest.TestCase):
    def assert_linear(self, make: Callable[[int], Callable[[], object]], n: int) -> None:
        """Time the work that ``make`` builds for size n and 4n, the building
        not counted."""
        small = best_time(make(n))
        large = best_time(make(4 * n))
        self.assertLessEqual(large, 8 * small + EPSILON, f"{small:.4f} s for {n}, {large:.4f} s for {4 * n}")


def stage_context(tokens: list[Token]) -> StageContext:
    dialect, error = load_case_dialect({"grammar": "%rule text A"})
    assert dialect is not None, error
    return StageContext(dialect.lowered(0, frozenset()), tokens, "a" * len(tokens), dialect.unicode)


class SpanReads(Linear):
    def test_the_tags_of_a_span_cost_its_length(self) -> None:
        # Each token holds a tag of its own, so the set grows at each token.
        def make(n: int) -> Callable[[], object]:
            tokens = [Token("a", frozenset({f"T{index}", "A"}), (index, index + 1), (index, index + 1)) for index in range(n)]
            evaluator = Evaluator(stage_context(tokens), 0, n)
            return lambda: [evaluator.span_tags((0, n, None)) for _ in range(25)]

        self.assert_linear(make, 4000)

    def test_a_sound_test_costs_the_sound_not_the_silent_tokens_of_its_span(self) -> None:
        # One token with phonemes and then n without, tested over every
        # prefix, as a parse tests a growing span at each advance.
        def make(n: int) -> Callable[[], object]:
            tokens = [Token("a", frozenset({"A"}), (index, index + 1), (index, index + 1), "" if index else "a") for index in range(n)]
            context = stage_context(tokens)
            context.sound_is("a", 0, 1)
            return lambda: [context.sound_is("a", 0, end) for _ in range(50) for end in range(1, n + 1)]

        self.assert_linear(make, 1000)


if __name__ == "__main__":
    unittest.main()
