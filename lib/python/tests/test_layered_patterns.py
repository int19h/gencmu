"""The shared matching cases for layered tree patterns."""

from __future__ import annotations

import json
import unittest

from gencmu._patterns import PatternMachine
from gencmu._pattern_shapes import layered_pattern_problem, layered_pattern_text

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


def term(node):
    for key in ("name", "terminal", "tag"):
        if key in node:
            return node[key]
    for key, prefix in (("param", "@"), ("const", "$")):
        if key in node:
            return prefix + node[key]
    if "call" in node:
        return node["call"] + "(" + ", ".join(term(arg) for arg in node["args"]) + ")"
    if "pattern" in node:
        return layered_pattern_text(node["pattern"], term)
    if "string" in node:
        return json.dumps(node["string"], ensure_ascii=False)
    if "requirements" in node:
        return "<" + " ".join(("¬" if r["negated"] else "") + term(r["value"]) for r in node["requirements"]) + ">"
    raise AssertionError(node)


class LayeredPatterns(unittest.TestCase):
    def test_shapes(self):
        for case in CASES["shapes"]:
            with self.subTest(case=case["description"]):
                problem = layered_pattern_problem(case["pattern"], depth=case.get("depth", 0))
                self.assertEqual(problem is None, case["valid"], problem)
                if "problem" in case:
                    self.assertEqual(problem, case["problem"])

    def test_printing(self):
        for case in CASES["printing"]:
            with self.subTest(case=case["description"]):
                self.assertEqual(layered_pattern_text(case["pattern"], term), case["text"])

    def test_depth_and_width(self):
        pattern = {"name": "a", "at": [1, 1]}
        for _ in range(256):
            pattern = {"path": "descendant", "pattern": pattern}
        self.assertIsNone(layered_pattern_problem(pattern))
        self.assertEqual(layered_pattern_problem({"path": "descendant", "pattern": pattern}), "nested too deeply")
        self.assertEqual(layered_pattern_text(pattern, term), "#(" + "⋮ (" * 255 + "⋮ a" + ")" * 256)
        wide = {"any": True, "children": [{"child": {"name": "a", "at": [1, 1]}}] * 1000}
        self.assertIsNone(layered_pattern_problem(wide, depth=254))
        self.assertEqual(layered_pattern_problem(wide, depth=255), "nested too deeply")
        siblings = {"any": True, "children": [{"siblings": True}] * 1000}
        self.assertIsNone(layered_pattern_problem(siblings, depth=255))
        self.assertEqual(layered_pattern_problem(siblings, depth=256), "nested too deeply")
        child = {"child": {"param": "X", "at": [1, 1]}}
        self.assertIsNone(layered_pattern_problem({"any": True, "children": [{"repeat": [{"optional": [child] * 150000}]}]}))

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
