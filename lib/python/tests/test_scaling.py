"""Work that must grow linearly with its input: the internal functions that
read a span, fold a union or check a list, timed at a size n and 4n. A
function whose work grows with the square of its input takes about 16 times
as long at 4n, and a linear one about 4 times, so the tests allow 8."""

from __future__ import annotations

import gc
import time
import unittest
from typing import Callable

import gencmu
from gencmu._clauses import definition_problem
from gencmu._earley import EdgeSets, Evaluator, StageContext
from gencmu._grammar import Lowered, _Constants, _Lowerer, _resolve_classifiers, stitch
from gencmu._trampoline import run
from gencmu._model import Token
from gencmu._pipeline import splice_pipeline
from gencmu._stage import implied

from .shared import load_case_dialect

EPSILON = 0.002
"""Seconds of slack for timer noise on very short runs."""


def best_time(work: Callable[[], object]) -> float:
    """The least of three timings, which is the least disturbed by other work
    on the machine. A run of over a second is decisive alone, so that a
    quadratic fault fails without waiting for two more."""
    # The cycle collector's passes cost more as more objects live, which
    # is no work of the function timed.
    gc.collect()
    gc.disable()
    try:
        best = float("inf")
        for _ in range(3):
            start = time.perf_counter()
            work()
            best = min(best, time.perf_counter() - start)
            if best > 1:
                break
        return best
    finally:
        gc.enable()


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
            return lambda: [context.sound_is("a", 0, end) for _ in range(100) for end in range(1, n + 1)]

        self.assert_linear(make, 1000)



class UnionFolds(Linear):
    def test_a_union_of_many_parts_costs_its_parts(self) -> None:
        # Each part adds a tag of its own, so the union grows at each part,
        # in a parse's term and in a constant's alike.
        def make(n: int) -> Callable[[], object]:
            term = {"union": [{"tag": f"t{index}"} for index in range(n)]}
            evaluator = Evaluator(stage_context([]), 0, 0)
            constants = _Constants("s", None)  # type: ignore[arg-type]

            def work() -> None:
                for _ in range(10):
                    assert len(evaluator.value(term, None)) == n  # type: ignore[arg-type]
                    assert len(run(constants._closed("a.md", term, None))) == n

            return work

        self.assert_linear(make, 2000)



class Closures(Linear):
    def test_a_chain_of_implications_in_reverse_order_costs_its_length(self) -> None:
        # t0 implies t1, t1 implies t2, and so on, listed last link first:
        # a pass over the list in order finds one new link at a time.
        def make(n: int) -> Callable[[], object]:
            chain = [(frozenset({f"t{index}"}), frozenset({f"t{index + 1}"})) for index in reversed(range(n))]
            lowered = Lowered(None, [], [], {}, [], [], "", implications=chain)  # type: ignore[arg-type]
            start = frozenset({"t0"})

            def work() -> None:
                for _ in range(20):
                    assert len(implied(start, lowered)) == n + 1

            return work

        self.assert_linear(make, 1000)



class Dedupes(Linear):
    def test_an_item_of_many_edges_checks_each_new_edge_at_once(self) -> None:
        # Every edge distinct, and each offered twice, as a strict step and
        # then an ordinary one can offer it in the reconstruction mode.
        def make(n: int) -> Callable[[], object]:
            offered = [(index, 2, index, 0) for index in range(n)]

            def work() -> None:
                for _ in range(10):
                    edge_sets = EdgeSets()
                    edges: list[tuple[int, ...]] = []
                    for edge in offered:
                        edge_sets.add(0, edges, edge)
                        edge_sets.add(0, edges, edge)
                    assert edges == offered

            return work

        self.assert_linear(make, 5000)



def emitting_rule(n: int) -> dict:
    """The DOM of a rule of n captures whose %emits puts an inserted tag
    before each, as the reader makes it."""
    items: list[dict] = []
    for index in range(n):
        items.extend(({"insert": f"X{index}"}, {"capture": f"c{index}"}))
    return {
        "name": "text",
        "op": "define",
        "alternatives": [{"guards": [], "expr": {"seq": [{"capture": f"c{index}", "expr": {"ref": "A"}} for index in range(n)]}}],
        "emit": {"items": items},
        "conditions": [],
        "at": [2, 1],
    }


class DefinitionChecks(Linear):
    def test_the_checks_of_a_definition_cost_its_captures_and_items(self) -> None:
        # The capture sequences, the written order of the captures and the
        # anchors of the inserted tags, for one production.
        def make(n: int) -> Callable[[], object]:
            rule = emitting_rule(n)
            return lambda: [definition_problem(rule) for _ in range(3)]

        self.assert_linear(make, 1000)

    def test_lowering_an_emission_costs_its_items(self) -> None:
        def make(n: int) -> Callable[[], object]:
            emit = emitting_rule(n)["emit"]
            captures = {f"c{index}": index for index in range(n)}
            return lambda: [_Lowerer.lower_emit(None, emit, captures) for _ in range(20)]  # type: ignore[arg-type]

        self.assert_linear(make, 1000)



class SharedClauses(Linear):
    def test_stitching_walks_the_clauses_that_alternatives_share_once(self) -> None:
        # n alternatives that share a %tags term of n parts, one of them a
        # constant, and n conditions: the loader checks and resolves each
        # rule-level clause once, not once for each alternative.
        dialect, error = load_case_dialect({"grammar": "%rule text A"})
        assert dialect is not None, error

        def make(n: int) -> Callable[[], object]:
            rule = {
                "name": "text",
                "op": "define",
                "tags": {"union": [*({"tag": f"y{index}"} for index in range(n)), {"const": "K", "at": [2, 1]}]},
                "alternatives": [{"guards": [], "expr": {"ref": "A"}} for _ in range(n)],
                "conditions": [
                    {"op": "=", "left": {"call": "text", "args": [{"capture": ""}]}, "right": {"string": f"a{index}"}} for index in range(n)
                ],
                "at": [3, 1],
            }
            dom = {
                "format": 18,
                "rules": [rule],
                "directives": [{"name": "ambiguity-resolution", "args": ["greedy"], "at": [1, 1]}],
                "constants": [{"name": "K", "op": "define", "value": {"tag": "K"}, "at": [2, 1]}],
                "classifiers": [],
                "implications": [],
            }
            return lambda: stitch("s", [("t.md", dom)], dialect.unicode)

        self.assert_linear(make, 500)



class Classifiers(Linear):
    def test_a_key_of_many_classes_costs_its_classes(self) -> None:
        # n entries, each giving the one key a class of its own.
        def make(n: int) -> Callable[[], object]:
            entries = [{"guards": [], "op": "∈", "class": f"C{index}", "keys": ["k"], "at": [1, 1]} for index in range(n)]
            items = [("t.md", {"name": "c", "entries": entries})]
            return lambda: [_resolve_classifiers(items, frozenset()) for _ in range(30)]

        self.assert_linear(make, 2000)



def pipeline_dom(directives: list[dict], rules: int = 0) -> dict:
    return {
        "format": 18,
        "rules": [{"name": "text", "op": "define", "alternatives": [], "conditions": [], "at": [line + 1, 9]} for line in range(len(directives), len(directives) + rules)],
        "directives": [{**directive, "at": [line + 1, 1]} for line, directive in enumerate(directives)],
        "constants": [],
        "classifiers": [],
        "implications": [],
    }


class Pipelines(Linear):
    def test_a_deep_chain_of_includes_costs_its_depth(self) -> None:
        # d0 includes d1, which includes d2, and so on; the last holds the
        # stage.
        def make(n: int) -> Callable[[], object]:
            doms = {f"d{index}.md": pipeline_dom([{"name": "include", "args": [f"d{index + 1}.md"]}]) for index in range(n)}
            doms[f"d{n}.md"] = pipeline_dom([{"name": "stage", "args": ["s"]}], rules=1)
            return lambda: [splice_pipeline("d0.md", doms.get) for _ in range(100)]

        self.assert_linear(make, 150)

    def test_many_stages_cost_their_number(self) -> None:
        def make(n: int) -> Callable[[], object]:
            directives = [{"name": "stage", "args": [f"s{index}"]} for index in range(n)]
            # One rule after the last stage; the earlier stages have none, so
            # the splice ends in an error after every stage is checked.
            dom = pipeline_dom(directives, rules=1)

            def work() -> None:
                for _ in range(20):
                    try:
                        splice_pipeline("p.md", {"p.md": dom}.get)
                    except gencmu.GencmuError as error:
                        assert "stage s0 has no rules" in str(error), error

            return work

        self.assert_linear(make, 2000)


if __name__ == "__main__":
    unittest.main()
