"""Work that must grow linearly with its input: the internal functions that
read a span, fold a union or check a list, counted at a size n and 4n. The
count of linear work grows about 4 times, and of quadratic work about 16
times, so the tests allow 6. The larger run stops at the first unit of work
past that budget, so that a regression fails by its count and does not run
on. Nothing here is timed."""

from __future__ import annotations

import linecache
import re
import unittest
from types import FrameType
from typing import Any, Callable, ContextManager
from unittest import mock

import gencmu
from gencmu import _clauses, _grammar, _pipeline, _tags, _types
from gencmu._clauses import definition_problem
from gencmu._earley import EdgeSets, Evaluator, Forest, Parser, StageContext, reading_last
from gencmu._grammar import Lowered, Production, _Constants, _Lowerer, lower, stitch
from gencmu._model import Token
from gencmu._pipeline import splice_pipeline
from gencmu._rank import Summaries
from gencmu._stage import implied
from gencmu._trampoline import run

from .shared import OverBudget, Watch, Work, calls, code_of, count_work, load_case_dialect, mutant, parse_case, reads, steps

MOST = 6
"""How many times the work at n the work at 4n may cost."""


class Linear(unittest.TestCase):
    def assert_linear(self, watches: Callable[[], list[Watch]], make: Callable[[int], Callable[[], object]], n: int) -> None:
        """Count the work that ``make`` builds for size n and 4n, the
        building not counted, through the watches that ``watches`` gives."""
        small = self.count(watches, make(n))
        self.assertGreater(small, 0, "the watches count nothing")
        try:
            self.count(watches, make(4 * n), MOST * small)
        except OverBudget:
            self.fail(f"{small} for {n}, more than {MOST} times as much for {4 * n}")

    @staticmethod
    def count(watches: Callable[[], list[Watch]], work: Callable[[], object], budget: int | None = None, works: list[Work] | None = None) -> int:
        """The count of some work under a budget. ``works`` receives the
        count, which a test reads where the budget stops the work."""
        with count_work(*watches(), budget=budget) as counted:
            if works is not None:
                works.append(counted)
            work()
        return counted.count

    def assert_mutant_stops(
        self, watches: Callable[[], list[Watch]], make: Callable[[int], Callable[[], object]], n: int, mutation: Callable[[], ContextManager[Any]]
    ) -> None:
        """A regression, put in place by ``mutation``, stops at the first
        unit past the budget that the library's own work at n sets for 4n.
        The work is built before the mutation, since building it can run
        the code that the mutation changes. The watches are made within the
        mutation, so that they name its lines."""
        small = self.count(watches, make(n))
        large = make(4 * n)
        works: list[Work] = []
        with mutation(), self.assertRaises(OverBudget):
            self.count(watches, large, MOST * small, works)
        self.assertEqual(works[0].count, MOST * small + 1)


def tag_copies() -> list[Watch]:
    """The tags that the operations on tag sets read, each line counted
    before it runs, with what it reads: a union of two sets, a set added
    to a gathered union, the gathered union frozen, an intersection and a
    difference."""
    return [steps(target, weight=reads) for target in (_tags.union, _tags.Gathered, _tags.intersection, _tags.difference)]


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

    def test_phonemes_of_growing_prefixes_cost_the_tokens_that_sound(self) -> None:
        # Each level of a left chain asks the phonemes of the prefix it
        # spans. Only the first token sounds, so a call that read every
        # token would cost the prefixes' lengths summed.
        def case_of(n: int) -> dict[str, Any]:
            tokens = [{"text": "a", "tags": ["A"], "phonemes": "" if index else "a"} for index in range(n)]
            return {"grammar": '%rule text {... A}\n%conditions phonemes($) = "a"', "tokens": tokens}

        dialect, error = load_case_dialect(case_of(1))
        assert dialect is not None, error

        def make(n: int) -> Callable[[], object]:
            case = case_of(n)

            def work() -> None:
                value, _, _ = parse_case(dialect, case)
                assert value is not None and value["ok"], value

            return work

        self.assert_linear(lambda: [calls(StageContext.sound)], make, 100)


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

    def test_a_union_that_freezes_its_tags_at_each_part_fails_at_the_first_unit_past_its_budget(self) -> None:
        # The regression copies the tags gathered so far from a frozen
        # union at each part, which only a count of the freezing sees.
        def make(n: int) -> Callable[[], object]:
            term = {"union": [{"tag": f"t{index}"} for index in range(n)]}
            evaluator = Evaluator(stage_context([]), 0, 0)
            return lambda: evaluator.value(term, None)  # type: ignore[arg-type]

        freeze = (
            "if self.grown is not None:\n        self.grown.update(part)",
            "if self.grown is not None:\n        self.grown = set(self.value())\n        self.grown.update(part)",
        )
        self.assert_mutant_stops(tag_copies, make, 2000, lambda: mutant(_tags.Gathered, "add", freeze))

    def test_a_union_that_copies_or_scans_its_gathered_tags_fails_at_the_first_unit_past_its_budget(self) -> None:
        # Two regressions copy the growing set at each part, by a union and
        # by the set's own copy method, and one scans it for each tag of the
        # part. Each reads the gathered tags in C, which only a count of
        # each operand that a line reads sees.
        def make(n: int) -> Callable[[], object]:
            term = {"union": [{"tag": f"t{index}"} for index in range(n)]}
            evaluator = Evaluator(stage_context([]), 0, 0)
            return lambda: evaluator.value(term, None)  # type: ignore[arg-type]

        grown = "if self.grown is not None:\n        self.grown.update(part)"
        for name, change in (
            ("copy", "if self.grown is not None:\n        self.grown = self.grown | part"),
            ("scan", "if self.grown is not None:\n        self.grown.update(tag for tag in part if tag not in list(self.grown))"),
            ("method copy", "if self.grown is not None:\n        self.grown = self.grown.copy()\n        self.grown.update(part)"),
        ):
            with self.subTest(mutant=name):
                self.assert_mutant_stops(tag_copies, make, 2000, lambda: mutant(_tags.Gathered, "add", (grown, change)))


    def test_each_operation_that_reads_the_gathered_tags_in_c_fails_at_the_first_unit_past_its_budget(self) -> None:
        # Each regression reads the growing set in one opaque operation at
        # each part. The weight of a line must see every such operation,
        # or a quadratic regression written with it passes its budget.
        def make(n: int) -> Callable[[], object]:
            term = {"union": [{"tag": f"t{index}"} for index in range(n)]}
            evaluator = Evaluator(stage_context([]), 0, 0)
            return lambda: evaluator.value(term, None)  # type: ignore[arg-type]

        grown = "if self.grown is not None:\n        self.grown.update(part)"
        reads_grown = {
            "the set's copy method": "self.grown = self.grown.copy()",
            "copy.copy": "self.grown = __import__('copy').copy(self.grown)",
            "a sort that a loop leaves at once": "for tag in sorted(self.grown):\n            break",
            "a list that a comprehension iterates": "first = [tag for tag in list(self.grown)][:1]",
            "a dict made from its keys": "self.grown = set(dict.fromkeys(self.grown))",
            "a dict display that unpacks a dict": "self.grown = set({**dict.fromkeys(self.grown)})",
            "a join": "''.join(self.grown)",
            "a list of a zip": "list(zip(self.grown, self.grown))",
            "a formatted string": "f'{self.grown}'",
            "an augmented union of a frozenset": "frozen = frozenset()\n        frozen |= self.grown",
            "a repetition": "[0] * len(self.grown)",
        }
        for name, reading in reads_grown.items():
            change = f"if self.grown is not None:\n        {reading}\n        self.grown.update(part)"
            with self.subTest(mutant=name):
                self.assert_mutant_stops(tag_copies, make, 2000, lambda: mutant(_tags.Gathered, "add", (grown, change)))

def reading(table: dict[str, int], items: list[str], text: str) -> None:
    """Lines that each read one container in C, for the test of the weight."""
    list(table.values())
    items.sort()
    del items[0]
    text.split(",")
    "x" in text
    items.index("b")
    for _ in sorted(table):
        break


class Weights(unittest.TestCase):
    def test_a_step_weighs_what_its_c_operations_read(self) -> None:
        # Each line of reading reads its container once, so it weighs one
        # and the container's length. The loop's line starts once and then
        # leaves at once, so its sort counts once.
        table = {f"k{index}": index for index in range(10)}
        items = [f"{chr(97 + index)}" for index in range(20)]
        text = "," * 30
        with count_work(steps(reading, weight=reads)) as work:
            reading(table, items, text)
        lines = 7 + 1
        read = len(table) + 20 + 20 + len(text) + len(text) + 19 + len(table)
        self.assertEqual(work.count, lines + read)

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

        self.assert_linear(lambda: [steps(implied, weight=reads)], make, 1000)

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

        self.assert_linear(lambda: [steps(reading_last, weight=reads)], make, 1000)


class Edge(tuple):  # type: ignore[type-arg]
    """An edge whose comparisons and hashes the test counts: a search of a
    list by ``in`` compares the edge with each entry, and a set hashes it,
    in C, which no step of the library's own shows."""

    def __hash__(self) -> int:
        # A set hashes an edge at each lookup and at each copy into it, so a
        # set built again at each edge shows in the count of these calls.
        return tuple.__hash__(self)

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

        self.assert_linear(self.watches, make, 5000)

    @staticmethod
    def watches() -> list[Watch]:
        # The comparisons and hashes of edges, and every line of add with
        # what it reads in C, since a copy of a set of edges reuses their
        # hashes and calls neither.
        return [calls(Edge.__eq__), calls(Edge.__hash__), steps(EdgeSets.add, weight=reads)]

    def test_an_item_that_copies_its_set_of_edges_fails_at_the_first_unit_past_its_budget(self) -> None:
        def make(n: int) -> Callable[[], object]:
            offered = [Edge((index, 2, index, 0)) for index in range(n)]

            def work() -> None:
                edge_sets = EdgeSets()
                edges: list[tuple[int, ...]] = []
                for edge in offered:
                    edge_sets.add(0, edges, edge)

            return work

        copy = ("        if edge in seen:\n", "        seen = self.sets[item] = seen.copy()\n        if edge in seen:\n")
        self.assert_mutant_stops(self.watches, make, 5000, lambda: mutant(EdgeSets, "add", copy))


def unit_chain(n: int) -> Forest:
    """The forest of one token read through a chain of n rules, text to r1
    and so on, each a unit production of the next. Each completion of one
    rule over the token is the child of the next over the same span."""
    rules = "".join(f"\n%rule r{index} {f'r{index + 1}' if index + 1 < n else 'A'}" for index in range(1, n))
    dialect, error = load_case_dialect({"grammar": "%rule text r1" + rules})
    assert dialect is not None, error
    tokens = [Token("a", frozenset({"A"}), (0, 1), (0, 1))]
    context = StageContext(dialect.lowered(0, frozenset()), tokens, "a", dialect.unicode)
    return Parser(context).parse(context.lowered.rule_ids["text"])


class ItemAdds(Linear):
    # The item that a step makes is found by its key in its set, and a
    # step that reaches an item again adds one edge to it. The recognizer's
    # own count is of items, so a search that scans a set, or a copy of
    # an item's edges at each edge, shows only in the lines of add.

    @staticmethod
    def watches() -> list[Watch]:
        return [steps(code_of(Parser.walk, "add"), weight=reads)]

    @staticmethod
    def make(n: int) -> Callable[[], object]:
        # text reads u, which has n alternatives, each a rule of its own
        # over A. So each set holds about n items, and the item of text
        # after u has n edges, one for each completed alternative of u.
        alternatives = " | ".join(f"v{index}" for index in range(n))
        rules = "".join(f"\n%rule v{index} A" for index in range(n))
        dialect, error = load_case_dialect({"grammar": f"%rule text u B\n%rule u {alternatives}{rules}"})
        assert dialect is not None, error
        tokens = [Token("a", frozenset({"A"}), (0, 1), (0, 1)), Token("b", frozenset({"B"}), (1, 2), (1, 2))]
        context = StageContext(dialect.lowered(0, frozenset()), tokens, "ab", dialect.unicode)
        number = context.lowered.rule_ids["text"]
        return lambda: Parser(context).parse(number)

    def test_making_items_and_edges_costs_their_number(self) -> None:
        self.assert_linear(self.watches, self.make, 200)


class UnitEdges(Linear):
    # The arcs between rules that complete one below the other over one
    # span, which the cycle rule's groups are found from (engine §6). Each
    # completed child is examined once, at its edge, and no other item.

    @staticmethod
    def watches() -> list[Watch]:
        return [steps(Summaries.groups, weight=reads)]

    @staticmethod
    def make(n: int) -> Callable[[], object]:
        forest = unit_chain(n)
        return lambda: Summaries(forest, None).groups()

    def test_finding_the_arcs_examines_each_edge_once(self) -> None:
        self.assert_linear(self.watches, self.make, 200)

    def test_a_check_of_every_item_as_a_child_fails_at_the_first_step_past_its_budget(self) -> None:
        # The regression looks for the children of each item among all the
        # items of the forest, not among its edges.
        scan = (
            "        for _, kind, child, _ in edges:\n",
            "        for child in range(len(origin)):\n"
            "            kind = 2 if any(edge[1] == 2 and edge[2] == child for edge in edges) else 0\n",
        )
        self.assert_mutant_stops(self.watches, self.make, 200, lambda: mutant(Summaries, "groups", scan))


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

        self.assert_linear(lambda: [steps(_clauses, weight=reads)], make, 1000)

    def test_a_mutant_that_moves_the_larger_captures_fails_at_the_first_step_past_its_budget(self) -> None:
        # The check of repeated captures joins the captures of each item of
        # a sequence into those before it, the smaller into the larger. The
        # regression always moves those before into the new item's, which
        # moves each capture once for each item after it.
        def make(n: int) -> Callable[[], object]:
            expr = {"seq": [{"capture": f"c{index}", "expr": {"ref": "A"}} for index in range(n)]}
            return lambda: _clauses.duplicate_captures(expr)

        def watches() -> list[Watch]:
            return [steps(_clauses.duplicate_captures, weight=reads)]

        self.assert_linear(watches, make, 1000)
        swap = ("large, small = (joined, part) if joined[1] >= part[1] else (part, joined)", "large, small = (part, joined)")
        self.assert_mutant_stops(watches, make, 1000, lambda: mutant(_clauses, "duplicate_captures", swap))
        # The regression copies the larger side's dict of captures at each
        # join, by the dict's own copy method, which reads it in C.
        copy = ("joined = (large[0], large[1] + small[1])", "joined = (large[0].copy(), large[1] + small[1])")
        self.assert_mutant_stops(watches, make, 1000, lambda: mutant(_clauses, "duplicate_captures", copy))

    def test_lowering_an_emission_costs_its_items(self) -> None:
        def make(n: int) -> Callable[[], object]:
            emit = emitting_rule(n)["emit"]
            captures = {f"c{index}": index for index in range(n)}
            return lambda: _Lowerer.lower_emit(None, emit, captures)  # type: ignore[arg-type]

        self.assert_linear(lambda: [steps(_Lowerer.lower_emit, weight=reads)], make, 1000)


def loading_steps() -> list[Watch]:
    """Every line that stitching and its checks run."""
    return [steps(_grammar, weight=reads), steps(_clauses, weight=reads), steps(_types, weight=reads)]


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


def holds(index: int) -> dict[str, Any]:
    """The condition text($ci) = "a"."""
    return {"op": "=", "left": {"call": "text", "args": [{"capture": f"c{index}"}]}, "right": {"string": "a"}}


GUARDED: dict[str, Callable[[int], dict[str, Any]]] = {
    "a union of guarded tags": lambda n: {"tags": {"union": [{"if": {"captured": f"c{index}"}, "then": {"tag": f"t{index}"}} for index in range(n)]}},
    "a list of guarded conditions": lambda n: {"conditions": [{"if": {"captured": f"c{index}"}, "then": holds(index)} for index in range(n)]},
    "a conjunction of guarded conditions": lambda n: {"conditions": [{"all": [{"if": {"captured": f"c{index}"}, "then": holds(index)} for index in range(n)]}]},
    # A constant, which the loader resolves in the clauses that the
    # alternatives share, and a part that tests no presence.
    "guarded tags and a constant": lambda n: {
        "tags": {"union": [{"const": "K", "at": [1, 1]}, *({"if": {"captured": f"c{index}"}, "then": {"tag": f"t{index}"}} for index in range(n))]}
    },
}
"""The clauses of a choice of n captures, $c0(A) | … | $c(n−1)(A), whose
parts are each guarded by one capture, so that each production keeps one."""

GUARDED_MOST = 256
"""How many units of the counted lines each production and each node of
the lowered clauses may cost."""


def nodes_of(value: Any) -> int:
    """The containers within a value, as the size of an output."""
    count = 0
    stack = [value]
    while stack:
        found = stack.pop()
        if isinstance(found, dict):
            count += 1
            stack.extend(found.values())
        elif isinstance(found, list):
            count += 1
            stack.extend(found)
    return count


class GuardedClauses(Linear):
    """A choice of n captures with clauses whose parts are each guarded by
    one capture. Each production keeps one part, so the output is linear
    in n. The definition check and lowering simplify each clause for each
    production, and a scan of every part for each would cost n². The work
    is held to a constant times n and the output, during the work."""

    @staticmethod
    def documents(n: int, clause: Callable[[int], dict[str, Any]]) -> tuple[dict[str, Any], dict[str, Any]]:
        rule = {
            "name": "text",
            "op": "define",
            "alternatives": [{"guards": [], "expr": {"capture": f"c{index}", "expr": {"terminal": "A"}}} for index in range(n)],
            "conditions": [],
            "at": [3, 1],
            **clause(n),
        }
        dom = {
            "format": 18,
            "rules": [rule],
            "directives": [{"name": "ambiguity-resolution", "args": ["greedy"], "at": [1, 1]}],
            "constants": [{"name": "K", "op": "define", "value": {"tag": "k"}, "at": [2, 1]}],
            "classifiers": [],
            "implications": [],
        }
        return rule, dom

    def budget(self, n: int, clause: Callable[[int], dict[str, Any]]) -> int:
        """The budget at n: the constant times n and the size of the
        lowered clauses, which a lowering of the grammar's own finds, since
        preparing a clause once is part of the work counted."""
        dialect, error = load_case_dialect({"grammar": "%rule text A"})
        assert dialect is not None, error
        _, dom = self.documents(n, clause)
        lowered = lower(stitch("s", [("t.md", dom)], dialect.unicode), frozenset())
        output = sum(nodes_of(production.tags_term) + nodes_of(production.conds_predict) + nodes_of(production.conds_at) for production in lowered.productions)
        return GUARDED_MOST * (n + output)

    def make(self, n: int, clause: Callable[[int], dict[str, Any]]) -> Callable[[], object]:
        dialect, error = load_case_dialect({"grammar": "%rule text A"})
        assert dialect is not None, error
        rule, dom = self.documents(n, clause)

        def work() -> None:
            self.assertIsNone(_clauses.definition_problem(rule))
            lower(stitch("s", [("t.md", dom)], dialect.unicode), frozenset())

        return work

    def test_guarded_clauses_cost_the_productions_and_the_output(self) -> None:
        for name, clause in GUARDED.items():
            for n in (250, 1000):
                with self.subTest(clause=name, n=n):
                    budget = self.budget(n, clause)
                    try:
                        counted = self.count(loading_steps, self.make(n, clause), budget)
                    except OverBudget:
                        self.fail(f"{name}: more than {budget} units for {n} productions")
                    self.assertGreater(counted, 0)

    def test_simplifying_every_part_for_each_production_fails_at_the_first_unit_past_its_budget(self) -> None:
        # Each regression simplifies the whole union of guarded tags for
        # each production, as lowering and the definition check did before
        # the clauses were prepared once.
        clause = GUARDED["a union of guarded tags"]
        for owner, function, change in (
            (_Lowerer, "add", ("self.prepare(term, False).simplified(present)", "simplify_term(term, present)")),
            (_clauses, "definition_problem", ("captures_in(known[1].simplified(present))", "captures_in(simplify_term(term, present))")),
        ):
            with self.subTest(function=function):
                budget = self.budget(1000, clause)
                large = self.make(1000, clause)
                works: list[Work] = []
                with mutant(owner, function, change), self.assertRaises(OverBudget):
                    self.count(loading_steps, large, budget, works)
                self.assertEqual(works[0].count, budget + 1)

ONE_CLASS = frozenset(
    {
        "classes = table.get(key)",
        "if classes is None:",
        "classes = table[key] = set()",
        "if adds == (name in classes):",
        "classes.add(name)",
        "classes.discard(name)",
    }
)
"""The lines of the classifier resolution that touch one class of a key's
set, or none, and so cost one step."""


def whole_reads(frame: FrameType) -> int:
    """A weight for the steps of the classifier resolution, read before
    each step runs: one, and the size of the set of classes for a line
    that names it but is not known to touch one class. Such a line can
    copy or walk the set in C, which no step of Python's shows."""
    line = linecache.getline(frame.f_code.co_filename, frame.f_lineno).strip()
    if not re.search(r"\bclasses\b", line) or line in ONE_CLASS:
        return 1
    classes = frame.f_locals.get("classes")
    return 1 + (len(classes) if isinstance(classes, (set, frozenset)) else 0)


class Classifiers(Linear):
    @staticmethod
    def make(n: int) -> Callable[[], object]:
        # n entries, each giving the one key a class of its own.
        entries = [{"guards": [], "op": "∈", "class": f"C{index}", "keys": ["k"], "at": [1, 1]} for index in range(n)]
        items = [("t.md", {"name": "c", "entries": entries})]
        return lambda: _grammar._resolve_classifiers(items, frozenset())

    @staticmethod
    def watches() -> list[Watch]:
        return [steps(_grammar._resolve_classifiers, weight=whole_reads)]

    def test_a_key_of_many_classes_costs_its_classes(self) -> None:
        self.assert_linear(self.watches, self.make, 2000)

    def test_a_test_that_copies_the_classes_fails_at_the_first_unit_past_its_budget(self) -> None:
        # The regression tests a class against a list copied from the set,
        # which makes no new set, so only a count of what each line reads
        # sees it.
        copy = ("if adds == (name in classes):", "if adds == (name in list(classes)):")
        self.assert_mutant_stops(self.watches, self.make, 2000, lambda: mutant(_grammar, "_resolve_classifiers", copy))


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

        self.assert_linear(lambda: [steps(splice_pipeline, weight=reads), calls(Path.__eq__)], make, 150)

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

        self.assert_linear(lambda: [steps(splice_pipeline, weight=reads)], make, 2000)


if __name__ == "__main__":
    unittest.main()
