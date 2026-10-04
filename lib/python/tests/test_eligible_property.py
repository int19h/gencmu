"""Written-terminator priority and maximal terminators in nested queries
(engine §4) against a search for eligible proof trees on small random
grammars with chained elidable optionals.

The oracle searches proof trees one by one. It never repeats an item in one
state on one path of a tree, so it finds exactly the finite trees. It reads
whether an omission is forbidden straight from the edges of the chart, as
the specification words it, with no tables computed ahead.

GENCMU_PROPERTY_CASES sets the number of grammars (default 10000) and
GENCMU_PROPERTY_SEED the first seed, for a larger sweep.
"""

from __future__ import annotations

import os
import random
import unittest
from unittest import mock
from typing import Any

from gencmu._dialect import DOM_FORMAT, _resources, _unicode_table
from gencmu._earley import Forest, Parser, StageContext
from gencmu._eligible import eligible
from gencmu._maximal import Maximal, maximal_counters
from gencmu._grammar import lower, stitch
from gencmu._model import Token
from gencmu._rank import count_roots

import gencmu

from .shared import case_tokens, load_case_dialect

RULES = ["r", "t", "u", "v"]
TERMINALS = ["A", "B", "T", "U"]


class Budget(Exception):
    pass


def oracle(forest: Forest, witnesses: list[int], budget: int) -> list[int]:
    """The witnesses that have an eligible proof tree, by search."""
    productions = forest.lowered.productions
    edges = forest.edges
    all_edges = [(item, edge) for item, item_edges in enumerate(edges) for edge in item_edges]

    def production(item: int) -> Any:
        return productions[forest.prod[item]]

    def helper(item: int) -> bool:
        # A production of an elidable optional's helper: its rule has an
        # empty production that is an elided terminator.
        return any(p.helper and p.elided is not None for p in productions if p.lhs == production(item).lhs)

    def empty_helper(item: int) -> bool:
        return helper(item) and not production(item).rhs

    def written_helper(item: int) -> bool:
        return helper(item) and bool(production(item).rhs) and forest.dot[item] == len(production(item).rhs)

    def reads_written(item: int) -> bool:
        """Whether the chart advances the item over a completed nonempty
        alternative of the optional."""
        return any(kind == 2 and pred == item and written_helper(child) for _, (pred, kind, child, _) in all_edges)

    def forbidden_after(before: int, p: int) -> bool:
        """Whether the chart advances ``before`` over a completed Y to some
        p' >= p, and the item so made reads the optional as written."""
        return any(
            kind == 2 and pred == before and forest.end[made] >= p and reads_written(made) for made, (pred, kind, _, _) in all_edges
        )

    def maximal_after(item: int) -> bool:
        """Whether the optional after the item is of a maximal terminator."""
        symbol = production(item).rhs[forest.dot[item]]
        return any(p.lhs == symbol and p.elided in forest.lowered.grammar.maximal_terminals for p in productions)

    def longer(constituent: int) -> bool:
        """Whether the chart has a longer completed item of the
        constituent's symbol from its origin. The generated grammars have
        no tests."""
        return any(
            forest.dot[other] == len(production(other).rhs)
            and production(other).lhs == production(constituent).lhs
            and forest.origin[other] == forest.origin[constituent]
            and forest.end[other] > forest.end[constituent]
            for other in range(len(forest.prod))
        )

    def next_optional(item: int) -> str | None:
        """What comes next: an elidable optional with or without a
        constituent, or None."""
        found = production(item)
        position = forest.dot[item]
        if position == len(found.rhs) or found.terminal[position]:
            return None
        if not any(p.helper and p.elided is not None for p in productions if p.lhs == found.rhs[position]):
            return None
        if position == 0 or found.terminal[position - 1] or (position == 1 and found.rhs[0] == found.lhs):
            return "alone"
        return "constituent"

    spent = [0]

    def search(item: int, permit: bool, path: frozenset[tuple[int, bool]]) -> bool:
        """Whether the item has an eligible proof tree, and with ``permit``
        one whose own fixed prefix permits the next optional to be empty."""
        spent[0] += 1
        if spent[0] > budget:
            raise Budget()
        if (item, permit) in path:
            return False
        inner = path | {(item, permit)}
        kind = next_optional(item) if permit else None
        if kind == "alone" and reads_written(item):
            return False
        for pred, edge_kind, child, _ in edges[item]:
            if kind == "constituent" and (edge_kind != 2 or forbidden_after(pred, forest.end[item])):
                continue
            if kind == "constituent" and maximal_after(item) and longer(child):
                continue
            if edge_kind == 0:
                return True
            if edge_kind == 1:
                if search(pred, False, inner):
                    return True
                continue
            if search(pred, empty_helper(child), inner) and search(child, False, inner):
                return True
        return False

    return [witness for witness in witnesses if search(witness, False, frozenset())]


def random_dom(rng: random.Random) -> dict[str, Any]:
    def symbol() -> dict[str, Any]:
        return {"ref": rng.choice(TERMINALS) if rng.random() < 0.5 else rng.choice(RULES)}

    def body() -> dict[str, Any]:
        symbols: list[dict[str, Any]] = []
        for _ in range(rng.randrange(4)):
            pick = rng.random()
            if pick < 0.2:
                symbols.append({"optional": {"ref": "T"}})
            elif pick < 0.3:
                symbols.append({"optional": {"ref": "U"}})
            elif pick < 0.38:
                symbols.append({"optional": {"seq": [{"ref": "T"}, symbol()]}})
            else:
                symbols.append(symbol())
        if not symbols:
            return {"empty": True}
        return symbols[0] if len(symbols) == 1 else {"seq": symbols}

    # Now and then T or U is a maximal terminator.
    pick = rng.random()
    if pick < 0.5:
        elidable = [{"name": "elidable", "args": ["T", "U"], "at": [2, 1]}]
    elif pick < 0.75:
        elidable = [{"name": "elidable", "args": ["U"], "at": [2, 1]}, {"name": "elidable", "args": ["T"], "maximal": True, "at": [2, 2]}]
    else:
        elidable = [{"name": "elidable", "args": ["T", "U"], "maximal": True, "at": [2, 1]}]
    definitions = [("text", [{"ref": "A"}])] + [(rule, [body(), body()]) for rule in RULES]
    return {
        "format": DOM_FORMAT,
        "rules": [
            {"name": name, "op": "define", "alternatives": [{"guards": [], "expr": expr} for expr in alternatives], "conditions": [], "at": [number + 3, 1]}
            for number, (name, alternatives) in enumerate(definitions)
        ],
        "directives": [{"name": "ambiguity-resolution", "args": ["greedy"], "at": [1, 1]}] + elidable,
        "constants": [],
    }


def sample(lowered: Any, rng: random.Random) -> list[str] | None:
    """The terminals of a random derivation of r, or None if none comes
    out short. Its optionals are often written."""
    productions = lowered.productions
    out: list[str] = []
    stack: list[tuple[Any, bool, int]] = [(lowered.rule_ids["r"], False, 0)]
    while stack:
        symbol, terminal, depth = stack.pop()
        if terminal:
            out.append(symbol)
            if len(out) > 6:
                return None
            continue
        if depth > 10:
            return None
        choices = lowered.rule_productions[symbol]
        if depth > 5:
            shallow = [number for number in choices if all(productions[number].terminal)]
            choices = shallow or choices
        production = productions[rng.choice(choices)]
        stack.extend((value, is_terminal, depth + 1) for value, is_terminal in zip(reversed(production.rhs), reversed(production.terminal)))
    return out


class EligibleProperty(unittest.TestCase):
    def test_against_a_search_for_proof_trees(self) -> None:
        rounds = int(os.environ.get("GENCMU_PROPERTY_CASES", "10000"))
        seed = int(os.environ.get("GENCMU_PROPERTY_SEED", "1"))
        unicode = _unicode_table(_resources().unicode)
        checked = filtered = 0
        for number in range(rounds):
            rng = random.Random(40_000_000 + seed + number)
            dom = random_dom(rng)
            try:
                lowered = lower(stitch("main", [("g.md", dom)], unicode), frozenset())
            except gencmu.GencmuError:
                continue
            # Often a derivation of r, cut short now and then, so that an
            # attempt reads a written optional and never completes r.
            tags = sample(lowered, rng) if rng.random() < 0.6 else None
            if tags is None:
                tags = [rng.choice(TERMINALS) for _ in range(rng.randrange(5))]
            elif tags and rng.random() < 0.5:
                tags = tags[: rng.randrange(len(tags))]
            tokens = [Token("x", frozenset([tag]), (index, index + 1), (2 * index, 2 * index + 1)) for index, tag in enumerate(tags)]
            context = StageContext(lowered, tokens, " ".join("x" for _ in tokens), unicode)
            context.count = count_roots
            forest = Parser(context).parse(lowered.rule_ids["r"])
            # The witnesses of begins: completed items of r from the start,
            # in any set.
            r = lowered.rule_ids["r"]
            witnesses = [
                item
                for item in range(len(forest.prod))
                if forest.origin[item] == 0
                and lowered.productions[forest.prod[item]].lhs == r
                and forest.dot[item] == len(lowered.productions[forest.prod[item]].rhs)
            ]
            if not witnesses:
                continue
            try:
                expected = oracle(forest, witnesses, 200_000)
            except Budget:
                continue
            found = eligible(forest, witnesses, context)
            self.assertEqual(found, expected, f"seed {40_000_000 + seed + number}: {dom['rules']} over {tags}")
            if len(expected) < len(witnesses):
                filtered += 1
            checked += 1
        if os.environ.get("GENCMU_PROPERTY_VERBOSE"):
            print(f"\neligible: checked {checked}, filtered {filtered}")
        self.assertGreater(checked, rounds / 4)
        self.assertGreater(filtered, rounds / 50)



class OverBudget(BaseException):
    """A parse whose maximality checks went past the work a test allows
    them, raised as soon as they do, so that a regression to quadratic work
    fails by its count and does not run on. A BaseException, which no
    handler of the library's catches."""


class MaximalQueryCost(unittest.TestCase):
    """The maximality checks of a nested query read each completion once,
    so their work grows linearly with the input (engine §4)."""

    PLAIN = "%elidable maximal T\n%rule text body B\n%conditions begins(from($), r)\n%rule body A ...\n%rule r y [T]\n%rule y A ..."
    TESTED = "%elidable maximal T\n%rule text body B\n%conditions begins(from($), r)\n%rule body A ...\n%rule r y⊇~p [T]\n%rule y A ... <~p>"

    def work(self, grammar: str, length: int, budget: tuple[int, int, int] | None = None) -> tuple[int, int, int]:
        """The maximality checks, the test evaluations and the items looked
        at of a parse of ``length`` tokens A and then B; with a budget of
        each, it stops the parse and fails as soon as one is passed."""
        dialect, error = load_case_dialect({"grammar": grammar})
        assert dialect is not None, error
        tokens, text = case_tokens({"tokens": [{"text": "a", "tags": ["A"]}] * length + [{"text": "b", "tags": ["B"]}]})
        counts = [0, 0, 0]
        forbids, test_holds = Maximal.forbids, StageContext.test_holds

        def spend() -> None:
            counts[2] = maximal_counters.looked
            if budget is not None and any(count > most for count, most in zip(counts, budget)):
                raise OverBudget(tuple(counts))

        def counted_forbids(self: Maximal, *args: Any) -> bool:
            counts[0] += 1
            found = forbids(self, *args)
            spend()
            return found

        def counted_test(self: StageContext, *args: Any) -> bool:
            counts[1] += 1
            spend()
            return test_holds(self, *args)

        maximal_counters.looked = 0
        with mock.patch.object(Maximal, "forbids", counted_forbids), mock.patch.object(StageContext, "test_holds", counted_test):
            try:
                result = dialect.parse_tokens(tokens, text, auto_features=False)
            except OverBudget as over:
                self.fail(f"{length} tokens went past the budget {budget} of checks, tests and items looked at, at {over.args[0]}")
        self.assertTrue(result.stages[0].verdict is not None or result.error is not None)
        counts[2] = maximal_counters.looked
        return counts[0], counts[1], counts[2]

    def test_work_grows_linearly(self) -> None:
        for name, grammar in (("plain", self.PLAIN), ("tested", self.TESTED)):
            with self.subTest(grammar=name):
                # Each length four times the last, and each parse's budget
                # from the last one's work, so that quadratic work fails at
                # the first step that shows it, before it costs much.
                last = self.work(grammar, 250)
                self.assertGreater(last[0], 0, "the query made no maximality check")
                self.assertGreater(last[2], 0, "the checks looked at no item")
                for length in (1000, 4000):
                    # Four times the input, at most about four times the
                    # work, where a scan of the completions per check would
                    # take sixteen; the test evaluations read each
                    # completion at most about twice in all.
                    budget = (5 * last[0], min(5 * max(last[1], 1) + 4, 2 * (length + 1)), 5 * last[2])
                    work = self.work(grammar, length, budget)
                    for count, most in zip(work, budget):
                        self.assertLessEqual(count, most, f"{last} then {work} for {length} tokens")
                    last = work


if __name__ == "__main__":
    unittest.main()
