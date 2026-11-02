"""The shared cases of tests/dom-malformed.json: directives that every
library refuses, or accepts, in a DOM (tests/README.md, engine §9)."""

from __future__ import annotations

import unittest
from unittest.mock import patch
from itertools import permutations

from gencmu import GencmuError
from gencmu._pipeline import DOM_FORMAT, _resources, _unicode_table
from gencmu._grammar import stitch
from gencmu._validate import dom_problem

from .shared import SHARED, load_json


class DomMalformed(unittest.TestCase):
    def test_family_reference_order_ignores_dom_object_order(self) -> None:
        unicode = _unicode_table(_resources().unicode)
        family = {"method": "without-elision-except", "receiver": {"capture": "x"}, "args": [{"rule": "missing_family"}]}
        other = {**family, "args": [{"rule": "other_family"}]}
        query = {"method": "matches", "receiver": family, "args": [{"rule": "missing_rival"}]}
        implication = {"if": query, "then": {**query, "receiver": other}}
        comparison = {"op": "=", "left": {"method": "value", "receiver": family, "args": []},
                      "right": {"method": "value", "receiver": other, "args": []}}
        variants = [fields for clause in (query, implication, comparison) for fields in permutations(clause.items())]
        for fields in variants:
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

    def test_ranked_syntax_code_shape(self) -> None:
        unicode = _unicode_table(_resources().unicode)
        for expr, coded in [
            ({"ranked": None}, True), ({"ranked": []}, True), ({"ranked": [{"ref": "A"}]}, True),
            ({"ranked": [{"ref": "A"}, {"ref": "B"}], "extra": 1}, False),
            ({"extra": 1, "ranked": [{"ref": "A"}, {"ref": "B"}]}, False),
            ({"ranked": [None, {"ref": "B"}]}, False),
        ]:
            dom = {"format": DOM_FORMAT, "rules": [{"name": "text", "op": "define", "flags": [], "alternatives": [{"guards": [], "expr": expr}], "conditions": [], "at": [1, 1]}], "directives": [], "constants": [], "classifiers": [], "implications": []}
            problem = dom_problem(dom, unicode)
            self.assertIsNotNone(problem)
            self.assertEqual(problem.startswith("ranked-choice-syntax:"), coded, str(expr))

    def test_rule_type_fault_keeps_construct_order(self) -> None:
        from gencmu._types import rule_type_fault
        cases = [case for case in load_json(SHARED / "dom-malformed.json") if case["description"].startswith("A first ")]
        self.assertTrue(cases, "no construct-order cases found")
        for case in cases:
            with self.subTest(case=case["description"]):
                rule = case["rule"]
                fault = rule_type_fault(rule)
                self.assertIsNotNone(fault)
                self.assertIs(fault[1], rule["conditions"][0])

    def test_construct_order_selection_is_required(self) -> None:
        with patch(__name__ + ".load_json", return_value=[]), self.assertRaisesRegex(AssertionError, "no construct-order cases"):
            self.test_rule_type_fault_keeps_construct_order()

    def test_supplied_empty_dom_values_reach_validation(self) -> None:
        for dom in (None, False, 0, "", [], {}):
            case = {"description": "supplied empty DOM", "dom": dom, "malformed": True}
            with self.subTest(dom=dom), patch(__name__ + ".load_json", return_value=[case]):
                self.test_cases()

    def test_cases(self) -> None:
        cases = load_json(SHARED / "dom-malformed.json")
        self.assertTrue(cases, "no cases found")
        unicode = _unicode_table(_resources().unicode)
        for case in cases:
            with self.subTest(case=case["description"]):
                # The directive alone in an otherwise empty DOM of the
                # current format, checked as a preparsed one is.
                dom = case["dom"] if "dom" in case else {"format": DOM_FORMAT, "rules": [case["rule"]] if "rule" in case else [], "directives": [case["directive"]] if "directive" in case else [], "constants": [], "classifiers": [], "implications": []}
                table = _unicode_table(case["unicode"]) if "unicode" in case else unicode
                problem = dom_problem(dom, table)
                self.assertEqual(problem is not None, case["malformed"], str(problem))
                if "message" in case:
                    self.assertIn(case["message"], problem or "")
                if "code" in case:
                    self.assertEqual((problem or "").split(":")[0], case["code"])


if __name__ == "__main__":
    unittest.main()
