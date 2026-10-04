"""What lowering owes each library's own tests (tests/README.md): the
place and the order of its errors (engine §3), and the cost of captures in
the recognizer (engine §4)."""

from __future__ import annotations

import itertools
import random
import unittest
from typing import Any

import gencmu
from gencmu._clauses import WHOLE, applies, applies_prepared, prepare, prepare_conditions, simplify_condition, simplify_term
from gencmu._earley import Parser, StageContext
from gencmu._model import Token
from gencmu._rank import count_roots

from .shared import load_case_dialect

PIPELINE = '```jbogenbau\n%stage main\n%include "a.md"\n%include "b.md"\n```\n'


class LoweringErrors(unittest.TestCase):
    """An error that lowering finds is a result of the parse, whose message
    begins with the document, line and column of the definition at fault,
    and the dialect loads (engine §3)."""

    def parse(self, dialect: gencmu.Dialect, features: list[str]) -> gencmu.ParseResult:
        return dialect.parse_tokens([Token("a", frozenset({"A"}), (0, 1), (0, 1))], "a", features=features, auto_features=False)

    def test_the_message_names_the_definition_and_the_order_is_engine_3(self) -> None:
        sources = {
            "p.md": PIPELINE,
            "a.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text {r} | c\n%rule c {... A} | f? B\n```\n",
            "b.md": "```jbogenbau\n%rule r A\n%extend-rule r\n  ε\n```\n",
        }
        dialect = gencmu.load_dialect_sources(sources, "p.md", use_cache=False)
        # The empty item of text's braces, made so by b.md, is reported at
        # the definition of text in a.md, line 3, column 1.
        empty = self.parse(dialect, [])
        self.assertFalse(empty.ok)
        assert empty.error is not None
        value = gencmu.result_json(empty)
        self.assertEqual(list(value["error"]), ["kind", "stage", "message"])
        self.assertEqual((value["error"]["kind"], value["error"]["stage"]), ("grammar", "main"))
        self.assertEqual((empty.stages[0].verdict, empty.tree), (None, None))
        self.assertTrue(empty.error.message.startswith("a.md:3:1: "), empty.error.message)
        # With f on, c's chain stands beside B, which comes before the empty
        # item of an earlier rule.
        both = self.parse(dialect, ["f"])
        assert both.error is not None
        self.assertEqual(both.error.kind, "grammar")
        self.assertTrue(both.error.message.startswith("a.md:4:1: c is a chain"), both.error.message)

    def test_in_one_rule_a_chain_beside_another_alternative_comes_before_an_empty_item(self) -> None:
        dialect, error = load_case_dialect({"grammar": "%rule text r\n%rule r {... [A]} | B"})
        assert dialect is not None, error
        result = dialect.parse_tokens([Token("b", frozenset({"B"}), (0, 1), (0, 1))], "b", auto_features=False)
        assert result.error is not None
        self.assertTrue(result.error.message.startswith("main.md:4:1: r is a chain"), result.error.message)

    def test_an_empty_item_is_reported_at_the_first_braces_lowering_meets(self) -> None:
        """Nullability is decided once every rule is lowered, and the first
        empty item in the order lowering met the braces is reported, at the
        definition that wrote it, whatever definition makes it empty."""
        sources = {
            "p.md": PIPELINE,
            "a.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text x y\n%rule x A\n%rule y {[A]}\n%rule z {q}\n%rule q ε\n```\n",
            "b.md": "```jbogenbau\n%redefine-rule x {[B] \\ C}\n```\n",
        }
        dialect = gencmu.load_dialect_sources(sources, "p.md", use_cache=False)
        result = self.parse(dialect, [])
        assert result.error is not None
        # x keeps its place, the first rule after text, and b.md wrote it.
        self.assertTrue(result.error.message.startswith("b.md:2:1: "), result.error.message)

    def test_a_chain_beside_another_alternative_comes_before_an_earlier_empty_item(self) -> None:
        """An empty item of braces comes last, whichever rules hold the
        errors (engine §3)."""
        sources = {
            "p.md": PIPELINE,
            "a.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text r {[A]}\n%rule r {... A} | B\n```\n",
            "b.md": "```jbogenbau\n```\n",
        }
        dialect = gencmu.load_dialect_sources(sources, "p.md", use_cache=False)
        result = self.parse(dialect, [])
        assert result.error is not None
        # r's chain stands beside B, a later rule than text's empty item.
        self.assertTrue(result.error.message.startswith("a.md:4:1: r is a chain"), result.error.message)


class CaptureGrowth(unittest.TestCase):
    """A captured part's span is part of an item's identity, so captures can
    multiply the items of a production (engine §4)."""

    @staticmethod
    def whole_items(grammar: str, n: int) -> int:
        """The completed items of the production t → t t or t → $l(t) $r(t)
        over the whole input of n tokens A."""
        dialect, error = load_case_dialect({"grammar": grammar})
        assert dialect is not None, error
        lowered = dialect.lowered(0, frozenset())
        tokens = [Token("a", frozenset({"A"}), (index, index + 1), (2 * index, 2 * index + 1)) for index in range(n)]
        context = StageContext(lowered, tokens, " ".join("a" for _ in tokens), dialect.unicode)
        context.count = count_roots
        forest = Parser(context).parse(lowered.rule_ids["text"])
        t = lowered.rule_ids["t"]
        found = 0
        for item in range(len(forest.prod)):
            production = lowered.productions[forest.prod[item]]
            if production.lhs == t and len(production.rhs) == 2 and forest.dot[item] == 2 and forest.origin[item] == 0 and forest.end[item] == n:
                found += 1
        return found

    def test_a_capture_of_a_rule_that_ends_in_many_places_keeps_an_item_for_each(self) -> None:
        for n in range(2, 6):
            with self.subTest(n=n):
                self.assertEqual(self.whole_items("%rule text t\n%rule t t t | A", n), 1)
                self.assertEqual(self.whole_items("%rule text t\n%rule t $l(t) $r(t) | A", n), n - 1)


if __name__ == "__main__":
    unittest.main()


class PreparedClauses(unittest.TestCase):
    """A clause prepared once for many productions simplifies, for each,
    to exactly what simplifying it for that production alone gives,
    including the order of its parts (engine §3.6)."""

    NAMES = ("a", "b", "c")

    def guarded(self, rng: random.Random, part: Any) -> Any:
        """A part ``$c ⟹ X``, or now and then X alone."""
        return part if rng.random() < 0.3 else {"if": {"captured": rng.choice(self.NAMES)}, "then": part}

    def term(self, rng: random.Random, depth: int) -> Any:
        choice = rng.randrange(9 if depth else 3)
        if choice == 8:
            # A union of guarded parts, the shape that preparing indexes.
            return {"union": [self.guarded(rng, self.term(rng, 0)) for _ in range(rng.randrange(1, 7))]}
        if choice == 0:
            return {"tag": rng.choice("xyz")}
        if choice == 1:
            return {"emptySet": True}
        if choice == 2:
            return {"tags": [{"capture": rng.choice(self.NAMES)}]} if rng.random() < 0.5 else {"const": "K", "at": [1, 1], "value": frozenset(rng.choice(([], ["k"])))}
        if choice in (3, 4):
            return {"if": self.condition(rng, depth - 1, presence=True), "then": self.term(rng, depth - 1)}
        if choice == 5:
            return {"union": [self.term(rng, depth - 1) for _ in range(rng.randrange(1, 5))]}
        if choice == 6:
            return {"intersection": [self.term(rng, depth - 1) for _ in range(rng.randrange(1, 3))]}
        return {"difference": [self.term(rng, depth - 1), self.term(rng, depth - 1)]}

    def condition(self, rng: random.Random, depth: int, presence: bool = False) -> Any:
        choice = rng.randrange(8 if depth else 2)
        if choice == 7 and not presence:
            # A conjunction of guarded parts, the shape that preparing indexes.
            return {"all": [self.guarded(rng, self.condition(rng, 0)) for _ in range(rng.randrange(1, 7))]}
        if choice == 0 or presence and rng.random() < 0.5:
            return {"captured": rng.choice((*self.NAMES, ""))}
        if choice == 1:
            return {"op": "=", "left": self.term(rng, 0), "right": {"string": "a"}}
        if choice in (2, 3):
            return {"if": self.condition(rng, depth - 1, presence=True), "then": self.condition(rng, depth - 1)}
        if choice == 4:
            return {"not": self.condition(rng, depth - 1)}
        return {rng.choice(("all", "any")): [self.condition(rng, depth - 1) for _ in range(rng.randrange(1, 5))]}

    def test_a_prepared_clause_simplifies_as_the_clause_does_for_each_production(self) -> None:
        rng = random.Random(8)
        presents = [frozenset(names) | {WHOLE} for size in range(4) for names in itertools.combinations(self.NAMES, size)]
        for _ in range(3000):
            term = self.term(rng, 3)
            condition = self.condition(rng, 3)
            conditions = [self.guarded(rng, self.condition(rng, 1)) for _ in range(rng.randrange(0, 7))]
            prepared_term, prepared_condition = prepare(term, False), prepare(condition, True)
            prepared_list = prepare_conditions(conditions)
            for present in presents:
                self.assertEqual(prepared_term.simplified(present), simplify_term(term, present), (term, present))
                self.assertEqual(prepared_condition.simplified(present), simplify_condition(condition, present), (condition, present))
                self.assertEqual(applies_prepared(prepared_condition, present), applies(condition, present), (condition, present))
                # The conditions of a list that are not true, in order, up to
                # the first false one, which removes the production.
                expected: list[Any] = []
                for written in conditions:
                    simplified = simplify_condition(written, present)
                    if simplified is not True:
                        expected.append(simplified)
                    if simplified is False:
                        break
                found = prepared_list.kept(present)
                if False in expected:
                    self.assertIn(False, found, (conditions, present))
                    found = found[: found.index(False) + 1]
                self.assertEqual(found, expected, (conditions, present))
