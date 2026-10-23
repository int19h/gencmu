"""The shared pattern DOM cases and finite observation bounds."""

from __future__ import annotations

import unittest

from gencmu._patterns import PatternMachine, observation_machine
from types import SimpleNamespace



class Patterns(unittest.TestCase):
    def test_state_growth(self) -> None:
        pattern = {"any": True, "children": [{"repeat": [{"child": {"terminal": "A", "at": [1, 1]}}]}]}
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
        pattern = {"any": True, "children": [{"child": roots[-1]} for _ in range(100)]}
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
            ranked=None, contextual=False,
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
