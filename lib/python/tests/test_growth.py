"""The shared cases of tests/growth.json: the work of the bundled grammars
on long texts (tests/README.md). A condition that parses a whole prefix
again at each step makes a long text cost more than its length says, so
these tests count the items that the recognizer makes, in parses and nested
parses alike."""

from __future__ import annotations

import json
import math
import unittest
from typing import Callable

import gencmu
from gencmu import _clauses, _dom, _trampoline
from gencmu._dialect import read_document
from gencmu._earley import Caps

from .shared import SHARED, OverBudget, Watch, calls, count_work, load_case_dialect, made_items, parse_case, steps


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
    def test_an_item_shares_the_parts_of_the_item_it_advanced(self) -> None:
        # One production of C captures over C tokens keeps C captured parts,
        # not C², since each item shares the parts of the item it advanced
        # (engine §4). The tags and the conditions read them in a bounded
        # number of walks.
        for count in (100, 200, 400):
            names = " ".join(f"$c{index}(A)" for index in range(count))
            # A tag term that reads every capture, the first last.
            tags = " ∪ ".join(f"tags($c{count - 1 - index})" for index in range(count))
            case = {"grammar": f'%rule text {names}\n%tags ~x ∪ {tags}\n%conditions text($c0) = "a"', "tokens": [{"text": "a", "tags": ["A"]}] * count}
            dialect, error = load_case_dialect(case)
            self.assertIsNone(error)
            assert dialect is not None
            with count_work(calls(Caps.__init__)) as captures, count_work(made_items()) as items, count_work(*capture_steps()) as walked:
                value, _, _ = parse_case(dialect, case)
            self.assertIsNotNone(value)
            assert value is not None
            self.assertTrue(value["ok"], f"{count} captures")
            self.assertEqual(captures.count, count, f"{count} captures")
            self.assertLessEqual(items.count, 2 * count + 4, f"{count} captures")
            # Reading the parts, for the conditions, the tags and the
            # result, walks each a bounded number of times, not once for
            # each capture before it.
            self.assertLessEqual(walked.count, 2 * count + 4, f"{count} captures: {walked.count} steps")

    def test_a_condition_at_each_capture_reads_its_part_without_walking_the_parts_before_it(self) -> None:
        # A condition at each capture of a long production reads the part
        # it names: the capture just made is the last part, and the first
        # capture is a search by the jumps, whose steps grow with the
        # logarithm of the parts (engine §4).
        def walked(count: int, far: Callable[[int], str]) -> int:
            names = " ".join(f"$c{index}(A)" for index in range(count))
            conditions = ", ".join(f"text($c{index}) = text({far(index)})" for index in range(count))
            case = {"grammar": f"%rule text {names}\n%conditions {conditions}", "tokens": [{"text": "a", "tags": ["A"]}] * count}
            dialect, error = load_case_dialect(case)
            self.assertIsNone(error)
            assert dialect is not None
            with count_work(*capture_steps()) as work:
                value, _, _ = parse_case(dialect, case)
            assert value is not None
            self.assertTrue(value["ok"], f"{count} captures")
            return work.count

        for count in (100, 200, 400):
            near = walked(count, lambda index: f"$c{index}")
            first = walked(count, lambda index: "$c0")
            self.assertLessEqual(near, 2 * count + 4, f"{count} captures read where they are made: {near} steps")
            self.assertLessEqual(first, count * (2 * math.log2(count) + 4), f"{count} captures that each read the first: {first} steps")


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
    def test_cases(self) -> None:
        # The shared cases of tests/notation-growth.json: reading a document
        # whose constructs nest deep costs work that grows with its length,
        # not with its square. The work is the recognizer's items and the
        # steps of the readers and walks, counted, not timed.
        with open(SHARED / "notation-growth.json", encoding="utf-8") as file:
            cases = json.load(file)
        self.assertGreater(len(cases), 5)
        for case in cases:
            with self.subTest(case=case["name"]):

                def work(n: int) -> int:
                    text = "```jbogenbau\n" + case["prefix"] + case["open"] * n + case["middle"] + case["close"] * n + case["suffix"] + "\n```\n"
                    with count_work(made_items(), *reader_steps()) as counted:
                        try:
                            read_document(text, "t.md")
                        except gencmu.GencmuError:
                            # An error is an outcome too; its place is the
                            # notation cases' concern.
                            pass
                    return counted.count

                # Once first, so that loading the notation counts in neither.
                work(250)
                small = work(250)
                large = work(1000)
                self.assertLessEqual(large, 5 * small, f"{case['name']}: {small} for 250 levels, {large} for 1000")


if __name__ == "__main__":
    unittest.main()
