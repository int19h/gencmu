"""The shared pattern DOM cases and finite observation bounds."""

from __future__ import annotations

import json
import unittest

from gencmu._dialect import DOM_FORMAT, read_document
from gencmu._patterns import PatternMachine, observation_machine
from types import SimpleNamespace

from .shared import SHARED
from .test_dom_rules import dom_problem


class Patterns(unittest.TestCase):
    def test_dom_cases(self) -> None:
        for case in json.loads((SHARED / "pattern-dom.json").read_text()):
            with self.subTest(case=case["description"]):
                dom = {"format": DOM_FORMAT, "rules": [], "directives": [], "constants": [], "classifiers": [], "implications": []}
                if "pattern" in case:
                    dom["constants"] = [{"name": "P", "op": "define", "at": [1, 1], "value": {"pattern": case["pattern"]}}]
                if "expr" in case or "condition" in case:
                    dom["rules"] = [{"name": "text", "op": "define", "at": [1, 1], "flags": [], "alternatives": [{"guards": [], "expr": case.get("expr", {"capture": "x", "expr": {"ref": "A"}})}], "conditions": [case["condition"]] if "condition" in case else []}]
                self.assertEqual(dom_problem(dom) is not None, case["malformed"])

    def test_depth(self) -> None:
        for depth in (250, 3000):
            document = "```jbogenbau\n%const $P @(" + "⋮(" * depth + "A" + ")" * depth + ")\n```"
            if depth > 256:
                with self.assertRaises(Exception) as caught:
                    read_document(document, "case.md")
                self.assertIn("nested too deeply", str(caught.exception))
            else:
                read_document(document, "case.md")

    def test_state_growth(self) -> None:
        pattern = {"children": {"repeat": {"node": {"terminal": "A", "at": [1, 1]}}}}
        machine = PatternMachine([pattern])
        leaf = machine.node(None, machine.empty, ("A", "a", frozenset(("A",))))
        prefix = machine.empty
        for _ in range(1000):
            prefix = machine.concat(prefix, leaf)
        root = machine.node("text", prefix)
        self.assertTrue(machine.matches(root, pattern))
        self.assertLessEqual(len(machine.states), 10)

    def test_beyond_word_size(self) -> None:
        roots = [{"terminal": "A" + str(i), "at": [1, 1]} for i in range(150)]
        pattern = {"children": {"sequence": [{"node": roots[-1]} for _ in range(100)]}}
        machine = PatternMachine([*roots, pattern])
        leaf = machine.node(None, machine.empty, ("A149", "a", frozenset(("A149",))))
        self.assertTrue(machine.matches(leaf, roots[-1]))
        prefix = machine.empty
        for _ in range(100):
            prefix = machine.concat(prefix, leaf)
        self.assertTrue(machine.matches(machine.node("text", prefix), pattern))

    def test_shared_clauses_are_scanned_once(self) -> None:
        pattern = {"terminal": "A", "at": [1, 1]}
        condition = {"op": "≅", "left": {"capture": "$"}, "right": {"pattern": pattern}}
        production = SimpleNamespace(
            conds_predict=[condition] * 1000, conds_at={}, tags_term=None, emit=None,
            private_conditions=[], contextual=False,
        )
        lowered = SimpleNamespace(
            productions=[production] * 1000, ranked_helpers={},
            grammar=SimpleNamespace(),
        )
        first = observation_machine(lowered)
        self.assertEqual(len(lowered._pattern_roots), 1)
        second = observation_machine(lowered)
        self.assertIsNot(first, second)
        self.assertEqual(first.predicates, second.predicates)
