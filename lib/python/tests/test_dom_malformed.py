"""The shared cases of tests/dom-malformed.json: directives that every
library refuses, or accepts, in a DOM (tests/README.md, engine §9)."""

from __future__ import annotations

import unittest

from gencmu._dialect import DOM_FORMAT, _resources, _unicode_table
from gencmu._validate import dom_problem

from .shared import SHARED, load_json


class DomMalformed(unittest.TestCase):
    def test_cases(self) -> None:
        cases = load_json(SHARED / "dom-malformed.json")
        self.assertTrue(cases, "no cases found")
        unicode = _unicode_table(_resources().unicode)
        for case in cases:
            with self.subTest(case=case["description"]):
                # The directive alone in an otherwise empty DOM of the
                # current format, checked as a precompiled one is.
                dom = {"format": DOM_FORMAT, "rules": [], "directives": [case["directive"]], "constants": [], "classifiers": [], "implications": []}
                problem = dom_problem(dom, unicode)
                self.assertEqual(problem is not None, case["malformed"], str(problem))


if __name__ == "__main__":
    unittest.main()
