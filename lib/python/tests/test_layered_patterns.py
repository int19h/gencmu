"""The shared matching cases for layered tree patterns."""

from __future__ import annotations

import json
import unittest

from gencmu._patterns import PatternMachine

from .shared import SHARED


CASES = json.loads((SHARED / "layered-patterns.json").read_text())


def bound_pattern(node):
    if isinstance(node, list):
        return [bound_pattern(child) for child in node]
    if isinstance(node, dict):
        return {key: frozenset(value) if key == "set" else bound_pattern(value) for key, value in node.items()}
    return node


def observe(machine, tree):
    if tree.get("seal"):
        return machine.sealed()
    if "terminal" in tree:
        return machine.node(None, machine.empty, (tree["terminal"], tree["value"], frozenset(tree["tags"])))
    children = machine.empty
    for child in tree["children"]:
        children = machine.concat(children, observe(machine, child))
    return machine.node(tree["name"], children)


class LayeredPatterns(unittest.TestCase):
    def test_matching(self):
        for case in CASES["matching"]:
            with self.subTest(case=case["description"]):
                pattern = bound_pattern(case["pattern"])
                machine = PatternMachine([pattern])
                self.assertEqual(machine.matches(observe(machine, case["tree"]), pattern), case["expected"])

    def test_state_growth(self):
        pattern = {"any": True, "children": [{"repeat": [{"child": {"terminal": "A", "at": [1, 1]}}]}]}
        machine = PatternMachine([pattern])
        a = observe(machine, {"terminal": "A", "value": "a", "tags": ["A"]})
        prefix = machine.empty
        for _ in range(1000):
            prefix = machine.concat(prefix, a)
            self.assertTrue(machine.matches(machine.node("list", prefix), pattern))
        self.assertLess(len(machine.states), 10)
