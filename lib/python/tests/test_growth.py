"""The shared cases of tests/growth.json: the work of the bundled grammars
on long texts (tests/README.md). A condition that parses a whole prefix
again at each step makes a long text cost more than its length says, so
these tests count the items that the recognizer makes, in parses and nested
parses alike."""

from __future__ import annotations

import functools
import json
import math
import unittest
from typing import Any, Callable
from unittest import mock

import gencmu
from gencmu import _clauses, _dom, _trampoline
from gencmu._dialect import read_document
from gencmu._earley import Caps, StageContext

from .shared import SHARED, OverBudget, Watch, Work, calls, case_sources, count_work, load_case_dialect, made_items, parse_case, steps


def capture_steps() -> list[Watch]:
    """The steps taken through the shared captured parts to read them: a
    search's jumps, and a walk of every part."""
    return [steps(Caps.find, "found = jump if jump is not None"), steps(Caps.parts, "found = found.parent")]


class Growth(unittest.TestCase):
    def test_cases(self) -> None:
        with open(SHARED / "growth.json", encoding="utf-8") as file:
            cases = json.load(file)
        self.assertTrue(cases, "no cases found")
        for case in cases:
            with self.subTest(dialect=case["dialect"], link=case["link"]):
                dialect = gencmu.load_dialect(case["dialect"])

                def items(n: int, budget: int | None = None) -> int:
                    text = case["text"].replace("{links}", " ".join([case["link"]] * n))
                    with count_work(made_items(), budget=budget) as work:
                        result = dialect.parse(text)
                    self.assertTrue(result.ok, text)
                    return work.count

                small = items(case["small"])
                # The longer text's parse stops at the first item past its
                # budget, so that a regression fails by its count before it
                # costs much.
                try:
                    items(case["large"], case["most"] * small)
                except OverBudget:
                    self.fail(f"{case['link']}: {small} items for {case['small']} links, more than {case['most']} times as many for {case['large']}")


class CaptureStorage(unittest.TestCase):
    def storage(self, count: int, works: dict[str, Work], captures: Watch, steps_: list[Watch]) -> None:
        """Parse a production of ``count`` captures over as many tokens, under
        the budgets of each count, which stop the parse at the first unit
        past one. ``works`` receives each count, by name."""
        names = " ".join(f"$c{index}(A)" for index in range(count))
        # A tag term that reads every capture, the first last. The rule rest
        # makes no captures, for a regression that parses it again.
        tags = " ∪ ".join(f"tags($c{count - 1 - index})" for index in range(count))
        grammar = f'%rule text {names}\n%tags ~x ∪ {tags}\n%conditions text($c0) = "a"\n%rule rest {{A}}'
        case = {"grammar": grammar, "tokens": [{"text": "a", "tags": ["A"]}] * count}
        dialect, error = load_case_dialect(case)
        self.assertIsNone(error)
        assert dialect is not None
        with (
            count_work(captures, budget=count) as works["captures"],
            count_work(made_items(), budget=2 * count + 4) as works["items"],
            count_work(*steps_, budget=2 * count + 4) as works["walked"],
        ):
            value, _, _ = parse_case(dialect, case)
        self.assertIsNotNone(value)
        assert value is not None
        self.assertTrue(value["ok"], f"{count} captures")
        self.assertEqual(works["captures"].count, count, f"{count} captures")

    def test_an_item_shares_the_parts_of_the_item_it_advanced(self) -> None:
        # One production of C captures over C tokens keeps C captured parts,
        # not C², since each item shares the parts of the item it advanced
        # (engine §4). The tags and the conditions read them in a bounded
        # number of walks: each part a bounded number of times, not once
        # for each capture before it.
        captures, steps_ = calls(Caps.__init__), capture_steps()
        for count in (100, 200, 400):
            works: dict[str, Work] = {}
            try:
                self.storage(count, works, captures, steps_)
            except OverBudget:
                self.fail(f"{count} captures: past a budget, at {({name: work.count for name, work in works.items()})}")

    def test_regressions_fail_at_the_first_count_past_each_budget(self) -> None:
        # Each regression passes one budget, and the parse stops at the
        # first unit past it, with 100 captures.
        captures, steps_ = calls(Caps.__init__), capture_steps()
        init, span_text = Caps.__init__, StageContext.span_text

        @functools.wraps(init)
        def copying_init(self: Caps, parent: Caps | None, part: tuple[int, int, int] | None) -> None:
            # Each new sequence copies the parts it extends, not shares them.
            if parent is not None:
                chain: list[Caps] = []
                found: Caps | None = parent
                while found is not None:
                    chain.append(found)
                    found = found.parent
                copy: Caps | None = None
                for old in reversed(chain):
                    fresh = object.__new__(Caps)
                    init(fresh, copy, old.part)
                    copy = fresh
                parent = copy
            init(self, parent, part)

        def parsing_text(self: StageContext, start: int, end: int) -> str:
            # text() parses the rest of the input again, as a condition that
            # reads a whole prefix anew would.
            _trampoline.run(self.nested("rest", 1, len(self.tokens)))
            return span_text(self, start, end)

        def walking_find(self: Caps, slot: int) -> tuple[tuple[int, int, int], int]:
            # A search walks every part, not the jumps.
            if not 0 <= slot < self.size:
                raise IndexError(slot)
            return self.parts()[slot], 0

        count = 100
        budgets = {"captures": count, "items": 2 * count + 4, "walked": 2 * count + 4}
        for name, target, method, mutant in (
            ("captures", Caps, "__init__", copying_init),
            ("items", StageContext, "span_text", parsing_text),
            ("walked", Caps, "find", walking_find),
        ):
            with self.subTest(budget=name):
                works: dict[str, Work] = {}
                with mock.patch.object(target, method, mutant), self.assertRaises(OverBudget):
                    self.storage(count, works, captures, steps_)
                self.assertEqual(works[name].count, budgets[name] + 1, {key: work.count for key, work in works.items()})

    def walked(self, count: int, far: Callable[[int], str], budget: int, steps_: list[Watch], works: list[Work]) -> None:
        """Parse a production of ``count`` captures with a condition at each
        that reads the capture ``far`` names, under a budget of the steps
        of the searches, which ``works`` receives."""
        names = " ".join(f"$c{index}(A)" for index in range(count))
        conditions = ", ".join(f"text($c{index}) = text({far(index)})" for index in range(count))
        case = {"grammar": f"%rule text {names}\n%conditions {conditions}", "tokens": [{"text": "a", "tags": ["A"]}] * count}
        dialect, error = load_case_dialect(case)
        self.assertIsNone(error)
        assert dialect is not None
        with count_work(*steps_, budget=budget) as work:
            works.append(work)
            value, _, _ = parse_case(dialect, case)
        assert value is not None
        self.assertTrue(value["ok"], f"{count} captures")

    @staticmethod
    def searches(count: int) -> list[tuple[str, Callable[[int], str], int]]:
        """The two searches at each capture: of the capture just made, the
        last part, and of the first capture, by the jumps, whose steps grow
        with the logarithm of the parts (engine §4). Each with its budget."""
        return [
            ("near", lambda index: f"$c{index}", 2 * count + 4),
            ("first", lambda index: "$c0", int(count * (2 * math.log2(count) + 4))),
        ]

    def test_a_condition_at_each_capture_reads_its_part_without_walking_the_parts_before_it(self) -> None:
        steps_ = capture_steps()
        for count in (100, 200, 400):
            for name, far, budget in self.searches(count):
                works: list[Work] = []
                try:
                    self.walked(count, far, budget, steps_, works)
                except OverBudget:
                    self.fail(f"{count} captures that each read {name}: more than {budget} steps")

    def test_a_search_that_walks_every_part_fails_at_the_first_step_past_its_budget(self) -> None:
        steps_ = capture_steps()

        def walking_find(self: Caps, slot: int) -> tuple[tuple[int, int, int], int]:
            if not 0 <= slot < self.size:
                raise IndexError(slot)
            return self.parts()[slot], 0

        for name, far, budget in self.searches(100):
            with self.subTest(search=name):
                works: list[Work] = []
                with mock.patch.object(Caps, "find", walking_find), self.assertRaises(OverBudget):
                    self.walked(100, far, budget, steps_, works)
                self.assertEqual(works[0].count, budget + 1)


def reader_steps() -> list[Watch]:
    """The steps of the readers and the walks of a document: each pass of
    the loop that runs a walk, each node that a walk with a list for a stack
    meets, and each capture that the check of repeated captures moves."""
    return [
        steps(_trampoline.run, "top = stack[-1]"),
        steps(_dom.flatten_groups, "current = stack.pop()"),
        steps(_dom.flatten_groups, "item = pending.pop()"),
        steps(_clauses.duplicate_captures, "node, index, parts = stack[-1]"),
        steps(_clauses.duplicate_captures, "large[0].setdefault(name, []).extend(captures)", lambda frame: len(frame.f_locals["captures"])),
    ]


class NotationGrowth(unittest.TestCase):
    # The shared cases of tests/notation-growth.json: reading a document
    # whose constructs nest deep costs work that grows with its length, not
    # with its square. The work is the recognizer's items and the steps of
    # the readers and walks, counted, not timed.

    def grows(self, case: dict[str, str], watches: list[Watch]) -> tuple[int, Work]:
        """The work of a case at 250 levels, and the count of a read at 1000
        levels under a budget of five times that, which stops the read at
        the first unit past it."""

        def work(n: int, budget: int | None = None, works: list[Work] | None = None) -> int:
            text = "```jbogenbau\n" + case["prefix"] + case["open"] * n + case["middle"] + case["close"] * n + case["suffix"] + "\n```\n"
            with count_work(*watches, budget=budget) as counted:
                if works is not None:
                    works.append(counted)
                try:
                    read_document(text, "t.md")
                except gencmu.GencmuError:
                    # An error is an outcome too. Its place is the
                    # notation cases' concern.
                    pass
            return counted.count

        # Once first, so that loading the notation counts in neither.
        work(250)
        small = work(250)
        works: list[Work] = []
        try:
            work(1000, 5 * small, works)
        except OverBudget:
            pass
        return small, works[0]

    def test_cases(self) -> None:
        with open(SHARED / "notation-growth.json", encoding="utf-8") as file:
            cases = json.load(file)
        self.assertGreater(len(cases), 5)
        watches = [made_items(), *reader_steps()]
        for case in cases:
            with self.subTest(case=case["name"]):
                small, large = self.grows(case, watches)
                self.assertLessEqual(large.count, 5 * small, f"{case['name']}: {small} for 250 levels, more than 5 times as much for 1000")

    def test_a_walk_of_each_subtree_fails_at_the_first_step_past_its_budget(self) -> None:
        # A regression that flattens the groups of each node's subtree in
        # turn, deepest first, walks a deep DOM once for each level. The
        # read at 1000 levels stops at the first step past its budget.
        with open(SHARED / "notation-growth.json", encoding="utf-8") as file:
            case = next(case for case in json.load(file) if case["name"] == "negations")
        watches = [made_items(), *reader_steps()]
        flatten = _dom.flatten_groups

        def flatten_each(root: Any) -> None:
            nodes: list[Any] = []
            stack = [root]
            while stack:
                current = stack.pop()
                if isinstance(current, (dict, list)):
                    nodes.append(current)
                    stack.extend(current.values() if isinstance(current, dict) else current)
            for node in reversed(nodes):
                flatten(node)

        with mock.patch.object(_dom, "flatten_groups", flatten_each):
            small, large = self.grows(case, watches)
        self.assertEqual(large.count, 5 * small + 1)


class QueryDepth(unittest.TestCase):
    # The shared cases of tests/query-depth.json: nested queries nest as
    # deep as the text makes them, with no bound (engine §4). The parse runs
    # on the main thread under the default recursion limit, so a recognizer
    # that ran each nested parse on the call stack would fail here.

    def test_cases(self) -> None:
        with open(SHARED / "query-depth.json", encoding="utf-8") as file:
            cases = json.load(file)
        self.assertTrue(cases, "no cases found")
        for case in cases:
            with self.subTest(case=case["name"]):
                sources, pipeline = case_sources(case)
                dialect = gencmu.load_dialect_sources(sources, pipeline, use_cache=False)
                result = dialect.parse(case["link"] * case["count"] + case["suffix"], auto_features=False)
                self.assertTrue(result.ok, result.error)


if __name__ == "__main__":
    unittest.main()
