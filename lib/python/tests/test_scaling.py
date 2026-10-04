"""Work that must grow linearly with its input: the internal functions that
read a span, fold a union or check a list, counted at a size n and 4n. The
count of linear work grows about 4 times, and of quadratic work about 16
times, so the tests allow 6. The larger run stops at the first unit of work
past that budget, so that a regression fails by its count and does not run
on. Nothing here is timed."""

from __future__ import annotations

import unittest
from types import FrameType
from typing import Any, Callable
from unittest import mock

import gencmu
from gencmu import _clauses, _grammar, _pipeline, _tags, _types
from gencmu._clauses import definition_problem
from gencmu._earley import EdgeSets, Evaluator, StageContext, reading_last
from gencmu._grammar import Lowered, Production, _Constants, _Lowerer, _resolve_classifiers, stitch
from gencmu._model import Token
from gencmu._pipeline import splice_pipeline
from gencmu._stage import implied
from gencmu._trampoline import run

from .shared import OverBudget, Watch, calls, count_work, load_case_dialect, steps

MOST = 6
"""How many times the work at n the work at 4n may cost."""


class Linear(unittest.TestCase):
    def assert_linear(self, watches: Callable[[], list[Watch]], make: Callable[[int], Callable[[], object]], n: int) -> None:
        """Count the work that ``make`` builds for size n and 4n, the
        building not counted, through the watches that ``watches`` gives."""

        def count(size: int, budget: int | None = None) -> int:
            work = make(size)
            with count_work(*watches(), budget=budget) as counted:
                work()
            return counted.count

        small = count(n)
        self.assertGreater(small, 0, "the watches count nothing")
        try:
            count(4 * n, MOST * small)
        except OverBudget:
            self.fail(f"{small} for {n}, more than {MOST} times as much for {4 * n}")


def tag_copies() -> list[Watch]:
    """The tags that unions of tag sets copy: a union of two sets copies
    both, and a set added to a gathered union copies its own tags."""
    return [
        calls(_tags.union, lambda frame: len(frame.f_locals["left"]) + len(frame.f_locals["right"])),
        calls(_tags.Gathered.add, lambda frame: len(frame.f_locals["part"])),
    ]


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
            return lambda: evaluator.span_tags((0, n, None))

        self.assert_linear(tag_copies, make, 4000)

    def test_a_sound_test_costs_the_sound_not_the_silent_tokens_of_its_span(self) -> None:
        # One token with phonemes and then n without, tested over every
        # prefix, as a parse tests a growing span at each advance. The work
        # is the tokens whose sound the tests read.
        def make(n: int) -> Callable[[], object]:
            tokens = [Token("a", frozenset({"A"}), (index, index + 1), (index, index + 1), "" if index else "a") for index in range(n)]
            context = stage_context(tokens)
            return lambda: [context.sound_is("a", 0, end) for end in range(1, n + 1)]

        self.assert_linear(lambda: [calls(StageContext.sound)], make, 1000)


class UnionFolds(Linear):
    def test_a_union_of_many_parts_costs_its_parts(self) -> None:
        # Each part adds a tag of its own, so the union grows at each part,
        # in a parse's term and in a constant's alike.
        def make(n: int) -> Callable[[], object]:
            term = {"union": [{"tag": f"t{index}"} for index in range(n)]}
            evaluator = Evaluator(stage_context([]), 0, 0)
            constants = _Constants("s", None)  # type: ignore[arg-type]

            def work() -> None:
                assert len(evaluator.value(term, None)) == n  # type: ignore[arg-type]
                assert len(run(constants._closed("a.md", term, None))) == n

            return work

        self.assert_linear(tag_copies, make, 2000)


class Closures(Linear):
    def test_a_chain_of_implications_in_reverse_order_costs_its_length(self) -> None:
        # t0 implies t1, t1 implies t2, and so on, listed last link first:
        # a pass over the list in order finds one new link at a time.
        def make(n: int) -> Callable[[], object]:
            chain = [(frozenset({f"t{index}"}), frozenset({f"t{index + 1}"})) for index in reversed(range(n))]
            lowered = Lowered(None, [], [], {}, [], [], "", implications=chain)  # type: ignore[arg-type]
            start = frozenset({"t0"})

            def work() -> None:
                assert len(implied(start, lowered)) == n + 1

            return work

        self.assert_linear(lambda: [steps(implied)], make, 1000)

    def test_which_productions_read_costs_a_long_chain_its_length(self) -> None:
        # r0 → r1, r1 → r2, and so on, listed first link first, and only the
        # last rule reads a terminal: a pass in list order finds one rule.
        def make(n: int) -> Callable[[], object]:
            productions = [Production(index, index, (index + 1,), (False,), f"r{index}", False) for index in range(n)]
            productions.append(Production(n, n, ("A",), (True,), f"r{n}", False))
            names = [f"r{index}" for index in range(n + 1)]

            def work() -> None:
                lowered = Lowered(None, productions, names, {}, [], [], "")  # type: ignore[arg-type]
                assert reading_last(lowered)[0] == 0

            return work

        self.assert_linear(lambda: [steps(reading_last)], make, 1000)


class Edge(tuple):  # type: ignore[type-arg]
    """An edge whose comparisons the test counts: a search of a list by
    ``in`` compares the edge with each entry, in C, which no step of the
    library's own shows."""

    __hash__ = tuple.__hash__

    def __eq__(self, other: object) -> bool:
        return tuple.__eq__(self, other)  # type: ignore[arg-type,no-any-return]


class Dedupes(Linear):
    def test_an_item_of_many_edges_checks_each_new_edge_at_once(self) -> None:
        # Every edge distinct, and each offered twice, as a strict step and
        # then an ordinary one can offer it in the reconstruction mode.
        def make(n: int) -> Callable[[], object]:
            offered = [Edge((index, 2, index, 0)) for index in range(n)]

            def work() -> None:
                edge_sets = EdgeSets()
                edges: list[tuple[int, ...]] = []
                for edge in offered:
                    edge_sets.add(0, edges, edge)
                    edge_sets.add(0, edges, edge)
                assert edges == offered

            return work

        self.assert_linear(lambda: [calls(Edge.__eq__)], make, 5000)


def emitting_rule(n: int) -> dict[str, Any]:
    """The DOM of a rule of n captures whose %emits puts n inserted tags
    before the captures, as the reader makes it. Every inserted tag's
    anchor is the first capture, so a search for each anchor from its own
    item would pass all the tags after it."""
    items: list[dict[str, Any]] = [{"insert": f"X{index}"} for index in range(n)]
    items.extend({"capture": f"c{index}"} for index in range(n))
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
            return lambda: definition_problem(rule)

        self.assert_linear(lambda: [steps(_clauses)], make, 1000)

    def test_lowering_an_emission_costs_its_items(self) -> None:
        def make(n: int) -> Callable[[], object]:
            emit = emitting_rule(n)["emit"]
            captures = {f"c{index}": index for index in range(n)}
            return lambda: _Lowerer.lower_emit(None, emit, captures)  # type: ignore[arg-type]

        self.assert_linear(lambda: [steps(_Lowerer.lower_emit)], make, 1000)


def loading_steps() -> list[Watch]:
    """Every line that stitching and its checks run."""
    return [steps(_grammar), steps(_clauses), steps(_types)]


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

        self.assert_linear(loading_steps, make, 200)

    def test_resolving_the_tests_of_a_deep_expression_walks_it_once(self) -> None:
        # n tested symbols inside n nested optionals, within the depth limit
        # of 256: whether a node holds a test is found once for each node.
        dialect, error = load_case_dialect({"grammar": "%rule text A"})
        assert dialect is not None, error

        def make(n: int) -> Callable[[], object]:
            expr: dict[str, Any] = {"seq": [{"test": "=", "value": {"string": "a"}, "expr": {"ref": "A"}} for _ in range(n)]}
            for _ in range(n):
                expr = {"optional": expr}
            rule = {"name": "text", "op": "define", "alternatives": [{"guards": [], "expr": expr}], "conditions": [], "at": [2, 1]}
            dom = {
                "format": 18,
                "rules": [rule],
                "directives": [{"name": "ambiguity-resolution", "args": ["greedy"], "at": [1, 1]}],
                "constants": [],
                "classifiers": [],
                "implications": [],
            }
            return lambda: stitch("s", [("t.md", dom)], dialect.unicode)

        self.assert_linear(loading_steps, make, 60)


def new_sets_of(key: str) -> Callable[[FrameType], int]:
    """A weight for the steps of the classifier resolution: one for each
    step, and the size of the key's set of classes wherever the step finds
    a new set there, which a copy of the set made."""
    last: list[object] = [None]

    def weight(frame: FrameType) -> int:
        table = frame.f_locals.get("table")
        classes = table.get(key) if isinstance(table, dict) else None
        if classes is None or classes is last[0]:
            return 1
        last[0] = classes
        return 1 + len(classes)

    return weight


class Classifiers(Linear):
    def test_a_key_of_many_classes_costs_its_classes(self) -> None:
        # n entries, each giving the one key a class of its own.
        def make(n: int) -> Callable[[], object]:
            entries = [{"guards": [], "op": "∈", "class": f"C{index}", "keys": ["k"], "at": [1, 1]} for index in range(n)]
            items = [("t.md", {"name": "c", "entries": entries})]
            return lambda: _resolve_classifiers(items, frozenset())

        self.assert_linear(lambda: [steps(_resolve_classifiers, weight=new_sets_of("k"))], make, 2000)


def pipeline_dom(directives: list[dict[str, Any]], rules: int = 0) -> dict[str, Any]:
    return {
        "format": 18,
        "rules": [{"name": "text", "op": "define", "alternatives": [], "conditions": [], "at": [line + 1, 9]} for line in range(len(directives), len(directives) + rules)],
        "directives": [{**directive, "at": [line + 1, 1]} for line, directive in enumerate(directives)],
        "constants": [],
        "classifiers": [],
        "implications": [],
    }


class Path(str):
    """A document's path whose comparisons the test counts: a search of a
    list of paths by ``in`` compares the path with each, in C, which no
    step of the library's own shows."""

    __hash__ = str.__hash__

    def __eq__(self, other: object) -> bool:
        return str.__eq__(self, other)


class Pipelines(Linear):
    def test_a_deep_chain_of_includes_costs_its_depth(self) -> None:
        # d0 includes d1, which includes d2, and so on; the last holds the
        # stage. Each included path is compared where the splice looks for
        # it among the documents that include it.
        def make(n: int) -> Callable[[], object]:
            doms = {f"d{index}.md": pipeline_dom([{"name": "include", "args": [f"d{index + 1}.md"]}]) for index in range(n)}
            doms[f"d{n}.md"] = pipeline_dom([{"name": "stage", "args": ["s"]}], rules=1)
            resolve = _pipeline.resolve

            def work() -> None:
                with mock.patch.object(_pipeline, "resolve", lambda base, target: Path(resolve(base, target))):
                    splice_pipeline("d0.md", doms.get)

            return work

        self.assert_linear(lambda: [steps(splice_pipeline), calls(Path.__eq__)], make, 150)

    def test_many_stages_cost_their_number(self) -> None:
        def make(n: int) -> Callable[[], object]:
            directives = [{"name": "stage", "args": [f"s{index}"]} for index in range(n)]
            # One rule after the last stage; the earlier stages have none, so
            # the splice ends in an error after every stage is checked.
            dom = pipeline_dom(directives, rules=1)

            def work() -> None:
                try:
                    splice_pipeline("p.md", {"p.md": dom}.get)
                except gencmu.GencmuError as error:
                    assert "stage s0 has no rules" in str(error), error

            return work

        self.assert_linear(lambda: [steps(splice_pipeline)], make, 2000)


if __name__ == "__main__":
    unittest.main()
