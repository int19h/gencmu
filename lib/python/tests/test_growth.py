"""The shared cases of tests/growth.json: the work of the bundled grammars
on long texts (tests/README.md). A condition that parses a whole prefix
again at each step makes a long text cost more than its length says, so
these tests count the items that the recognizer makes, in parses and nested
parses alike."""

from __future__ import annotations

import json
import unittest

import gencmu
from gencmu._earley import recognizer_counters

from .shared import SHARED


class Growth(unittest.TestCase):
    def test_cases(self) -> None:
        with open(SHARED / "growth.json", encoding="utf-8") as file:
            cases = json.load(file)
        self.assertTrue(cases, "no cases found")
        for case in cases:
            with self.subTest(dialect=case["dialect"], link=case["link"]):
                dialect = gencmu.load_dialect(case["dialect"])

                def items(n: int) -> int:
                    text = case["text"].replace("{links}", " ".join([case["link"]] * n))
                    recognizer_counters.items = 0
                    result = dialect.parse(text)
                    self.assertTrue(result.ok, text)
                    return recognizer_counters.items

                small = items(case["small"])
                large = items(case["large"])
                self.assertLessEqual(large, case["most"] * small, f"{case['link']}: {small} items for {case['small']} links, {large} for {case['large']}")


if __name__ == "__main__":
    unittest.main()
