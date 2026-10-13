"""The shared cases of tests/dom-malformed.json: directives that every
library refuses, or accepts, in a DOM (tests/README.md, engine §9)."""

from __future__ import annotations

import unittest
from itertools import permutations

from gencmu import GencmuError
from gencmu._dialect import DOM_FORMAT, _resources, _unicode_table
from gencmu._grammar import stitch
from gencmu._validate import dom_problem

from .shared import SHARED, load_json


class DomMalformed(unittest.TestCase):
    def test_family_reference_order_ignores_dom_object_order(self) -> None:
        unicode = _unicode_table(_resources().unicode)
        family = {"method": "without-elision-except", "receiver": {"capture": "x"}, "args": [{"rule": "missing_family"}]}
        query = {"method": "matches", "receiver": family, "args": [{"rule": "missing_rival"}]}
        for fields in permutations(query.items()):
            with self.subTest(fields=[name for name, _ in fields]):
                dom = {"format": DOM_FORMAT, "directives": [{"name": "ambiguity-resolution", "args": ["greedy"], "at": [1, 1]}],
                       "constants": [], "classifiers": [], "implications": [],
                       "rules": [{"op": "define", "name": "text", "flags": [], "at": [2, 1],
                                  "alternatives": [{"guards": [], "expr": {"capture": "x", "expr": {"ref": "X"}}}],
                                  "conditions": [dict(fields)]}]}
                self.assertIsNone(dom_problem(dom, unicode))
                with self.assertRaises(GencmuError) as raised:
                    stitch("main", [("case.md", dom)], unicode)
                self.assertIn("missing_family is not a rule", raised.exception.message)
                self.assertEqual((raised.exception.document, raised.exception.line, raised.exception.column), ("case.md", 2, 1))

    def test_cases(self) -> None:
        cases = load_json(SHARED / "dom-malformed.json")
        self.assertTrue(cases, "no cases found")
        unicode = _unicode_table(_resources().unicode)
        for case in cases:
            with self.subTest(case=case["description"]):
                # The directive alone in an otherwise empty DOM of the
                # current format, checked as a precompiled one is.
                dom = {"format": DOM_FORMAT, "rules": [case["rule"]] if "rule" in case else [], "directives": [case["directive"]] if "directive" in case else [], "constants": [], "classifiers": [], "implications": []}
                problem = dom_problem(dom, unicode)
                self.assertEqual(problem is not None, case["malformed"], str(problem))


if __name__ == "__main__":
    unittest.main()
