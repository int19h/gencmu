"""The shared cases of tests/growth.json: the work of the bundled grammars
on long texts (tests/README.md). A condition that parses a whole prefix
again at each step makes a long text cost more than its length says, so
these tests count the items that the recognizer makes, in parses and nested
parses alike."""

from __future__ import annotations

import json
import unittest

import gencmu

from .shared import SHARED, OverItems, count_items, load_case_dialect, parse_case


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
                    with count_items(budget) as work:
                        result = dialect.parse(text)
                    self.assertTrue(result.ok, text)
                    return work.items

                small = items(case["small"])
                # The longer text's parse stops at the first item past its
                # budget, so that a regression fails by its count before it
                # costs much.
                try:
                    items(case["large"], case["most"] * small)
                except OverItems:
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
            recognizer_counters.captures = 0
            recognizer_counters.items = 0
            recognizer_counters.capture_steps = 0
            value, _, _ = parse_case(dialect, case)
            self.assertIsNotNone(value)
            assert value is not None
            self.assertTrue(value["ok"], f"{count} captures")
            self.assertEqual(recognizer_counters.captures, count, f"{count} captures")
            self.assertLessEqual(recognizer_counters.items, 2 * count + 4, f"{count} captures")
            # Reading the parts, for the conditions, the tags and the
            # result, walks each a bounded number of times, not once for
            # each capture before it.
            self.assertLessEqual(recognizer_counters.capture_steps, 2 * count + 4, f"{count} captures: {recognizer_counters.capture_steps} steps")


if __name__ == "__main__":
    unittest.main()
