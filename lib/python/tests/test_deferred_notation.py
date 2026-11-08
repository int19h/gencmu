"""Body query shapes and structural error width (engine §3.6 and §9)."""

from copy import deepcopy
import unittest

import gencmu
from gencmu._pipeline import _Loader, _resources, read_document
from gencmu._query_forms import query_body, query_capture, query_identity
from gencmu._template_nodes import normalize_argument
from gencmu._templates import canonical_argument
from gencmu._validate import dom_problem


def document(condition):
    return "```jbogenbau\n%ambiguity-resolution greedy\n%rule text A\n%conditions " + condition + "\n```\n"


class BodyQueries(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.loader = _Loader(lambda path: None, _resources())

    def test_query_bodies_round_trip_without_template_argument_conversion(self):
        # Engine §9: a parse argument remains a body, including a bare tag.
        for target in ("A", "A …", "… A", 'A="x"', '"a".."z"', "_", "A | B", "A ≻ B", "[A]", "{A}", "ε"):
            with self.subTest(target=target):
                dom = read_document(document("$.parse(" + target + ").error-free"), "probe.md")
                self.assertIsNone(dom_problem(dom, self.loader.unicode))
                condition = dom["rules"][0]["conditions"][0]
                self.assertIn("body", condition["receiver"]["args"][0])
                self.assertEqual(normalize_argument(condition), condition)
                printed = canonical_argument(condition, self.loader.unicode)
                self.assertEqual(read_document(document(printed), "probe.md"), dom)

    def test_preparsed_shapes_refuse_captures_and_nested_remainders(self):
        # Engine §9: both loading routes enforce the same query body contract.
        valid = read_document(document("$.parse(A …).error-free"), "probe.md")
        for body in ({"remainder": True}, {"seq": [{"remainder": True}, {"ref": "A"}, {"remainder": True}]},
                     {"seq": [{"ref": "A"}, {"optional": {"remainder": True}}]},
                     {"capture": "x", "expr": {"ref": "A"}},
                     {"seq": [{"ref": "A"}, {"remainder": True}], "extra": True}):
            with self.subTest(body=body):
                dom = deepcopy(valid)
                dom["rules"][0]["conditions"][0]["receiver"]["args"][0]["body"] = body
                self.assertIsNotNone(dom_problem(dom, self.loader.unicode))

    def test_nested_capture_errors_stand_at_the_binder(self):
        # Engine §9: the binder, rather than its group, owns this error.
        for body in ("(A | $x:A)", "{A / $x:A}", "[$x:A]"):
            source = document("$.parse(" + body + ")")
            with self.subTest(body=body), self.assertRaises(gencmu.GencmuError) as caught:
                read_document(source, "probe.md")
            self.assertEqual(caught.exception.line, 4)
            self.assertEqual(caught.exception.column, source.splitlines()[3].index("$x") + 1)

    def test_query_identity_uses_structure_and_preserves_tests(self):
        # Engine §4.3: equivalent bodies share an identity across query forms.
        body = {"seq": [{"ref": "A"}, {"seq": [{"ref": "B"}]}]}
        flat = {"seq": [{"ref": "A"}, {"ref": "B"}]}
        self.assertEqual(query_identity(body), query_identity(flat))
        self.assertEqual(query_identity({"seq": [flat, {"remainder": True}]}), query_identity(flat))
        self.assertNotEqual(query_identity({"ref": "A"}), query_identity({"test": "=", "expr": {"ref": "A"}, "value": {"string": "x"}}))
        self.assertEqual(query_body({"seq": [{"remainder": True}, flat]})[1], "ends")
        self.assertEqual(query_capture({"repeat": {"ref": "A"}, "separator": {"capture": "x", "expr": {"ref": "B"}}})["capture"], "x")
