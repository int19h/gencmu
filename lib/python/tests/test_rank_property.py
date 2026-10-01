"""The ranking of engine §6 against brute force.

Random small grammars, with ε, left recursion and unary cycles, over short
random inputs whose tokens carry one tag or several. The reference
enumerates every derivation, leaving out the cyclic ones as engine §4
defines them. It computes the verdict, the first and the second reading
and the witness straight from the definitions of §6, under greedy, lazy,
no lean and late-elision. The library computes them over the packed forest
without enumerating. A grammar whose
derivations exceed a budget is skipped rather than enumerated.

GENCMU_PROPERTY_CASES sets the number of grammars (default 400) and
GENCMU_PROPERTY_SEED the first seed, for a larger sweep.
"""

from __future__ import annotations

import functools
import os
import random
import unittest
from unittest import mock
from typing import Any

import gencmu
from gencmu._dialect import DOM_FORMAT, _resources, _unicode_table
from gencmu._earley import Forest, Parser, StageContext
from gencmu._grammar import lower, stitch
from gencmu._maximal import Maximal
from gencmu._model import Token
from gencmu._rank import Least, Vector, actions, add, count_roots, rank
from gencmu._stage import StageRunner

TERMINALS = ["A", "B", "C"]
INF = float("inf")


class Budget(Exception):
    pass


# An action: ("r", token, terminal) or ("c", production, start, end, visible).


def same(x: tuple[Any, ...], y: tuple[Any, ...]) -> bool:
    return x[:3] == y[:3] if x[0] == "r" else x[:4] == y[:4]


def visible(action: tuple[Any, ...]) -> bool:
    return action[0] == "r" or action[4]


def decide(x: tuple[Any, ...], y: tuple[Any, ...], lean: str) -> int:
    # Two reads of one token as different terminals are tied (engine §6),
    # and under no lean, elision-only's, so is any other pair (engine §7).
    if x[0] == "r" and y[0] == "r":
        return 0
    if x[0] != y[0]:
        if lean == "none":
            return 0
        read_wins = lean == "greedy"
        return -1 if (x[0] == "r") == read_wins else 1
    return 0


def canonical(x: tuple[Any, ...], y: tuple[Any, ...]) -> int:
    kx = (0, x[2]) if x[0] == "r" else (1, x[1], x[2], x[3])
    ky = (0, y[2]) if y[0] == "r" else (1, y[1], y[2], y[3])
    return -1 if kx < ky else (1 if kx > ky else 0)


def visible_difference(a: tuple[Any, ...], b: tuple[Any, ...]) -> tuple[int, Any, Any] | None:
    va = [x for x in a if visible(x)]
    vb = [y for y in b if visible(y)]
    for index, (x, y) in enumerate(zip(va, vb)):
        if not same(x, y):
            return (index, x, y)
    return None


def whole_difference(a: tuple[Any, ...], b: tuple[Any, ...]) -> tuple[Any, Any] | None:
    for x, y in zip(a, b):
        if not same(x, y):
            return (x, y)
    return None


def order(a: tuple[Any, ...], b: tuple[Any, ...], lean: str) -> int:
    """The total order T: the first visible difference by rules 1-3, their
    ties broken canonically; a visible prefix first; equal visible sequences
    by the first difference of the whole sequences."""
    difference = visible_difference(a, b)
    if difference is not None:
        _, x, y = difference
        return decide(x, y, lean) or canonical(x, y)
    la = sum(1 for x in a if visible(x))
    lb = sum(1 for y in b if visible(y))
    if la != lb:
        return -1 if la < lb else 1
    whole = whole_difference(a, b)
    return 0 if whole is None else canonical(*whole)


def reference(
    productions: list[tuple[int, tuple[Any, ...], bool]],
    rules: int,
    tokens: list[frozenset[str]],
    lean: str,
    budget: int,
    elided: frozenset[int] = frozenset(),
) -> dict[str, Any] | None:
    """Every derivation of the start rule, rule 0, and the ranking's answers
    from the definitions. A production is its rule, its symbols (a string
    for a terminal, a number for a rule) and whether it is transparent.
    ``elided`` holds the empty productions of the helpers of elidable
    optionals, whose closes ``late-elision`` counts."""
    n = len(tokens)
    by_rule: list[list[int]] = [[] for _ in range(rules)]
    for number, (lhs, _, _) in enumerate(productions):
        by_rule[lhs].append(number)
    memo: dict[tuple[Any, ...], list[tuple[Any, ...]]] = {}
    work = [0]

    def spend(amount: int) -> None:
        work[0] += amount
        if work[0] > budget:
            raise Budget()

    def derive(rule: int, i: int, j: int, forbidden: frozenset[int]) -> list[tuple[Any, ...]]:
        if rule in forbidden:
            return []
        key = (rule, i, j, forbidden)
        if key in memo:
            return memo[key]
        inner = forbidden | {rule}
        found: list[tuple[Any, ...]] = []
        for number in by_rule[rule]:
            _, rhs, transparent = productions[number]
            close = ("c", number, i, j, not transparent)
            for sequence in expand(rhs, 0, i, j, i, j, inner):
                found.append(sequence + (close,))
        spend(len(found) + 1)
        memo[key] = found
        return found

    def expand(rhs: tuple[Any, ...], index: int, i: int, j: int, node_i: int, node_j: int, inner: frozenset[int]) -> list[tuple[Any, ...]]:
        if index == len(rhs):
            return [()] if i == j else []
        symbol = rhs[index]
        results: list[tuple[Any, ...]] = []
        if isinstance(symbol, str):
            if i < j and symbol in tokens[i]:
                read = ("r", i, symbol)
                results = [(read,) + rest for rest in expand(rhs, index + 1, i + 1, j, node_i, node_j, inner)]
        else:
            for k in range(i, j + 1):
                context = inner if (i == node_i and k == node_j) else frozenset()
                left = derive(symbol, i, k, context)
                if not left:
                    continue
                rest = expand(rhs, index + 1, k, j, node_i, node_j, inner)
                spend(len(left) * len(rest))
                results.extend(a + b for a in left for b in rest)
        return results

    return ranked(derive(0, 0, n, frozenset()), lean, elided, n)


def ranked(derivations: list[tuple[Any, ...]], lean: str, elided: frozenset[int], n: int) -> dict[str, Any]:
    """The ranking's answers over every derivation that counts of an input
    of ``n`` tokens, from the definitions of engine §6."""
    if not derivations:
        return {"verdict": None}
    if lean == "late-elision":
        # One derivation beats another by its elision vector alone, and T
        # orders equal vectors as no lean does (engine §6). So the readings
        # are those of no lean over the derivations of the least vector.
        def vector(sequence: tuple[Any, ...]) -> tuple[int, ...]:
            counts = [0] * (n + 1)
            for action in sequence:
                if action[0] == "c" and action[1] in elided:
                    counts[action[2]] += 1
            return tuple(counts)

        least = min(vector(sequence) for sequence in derivations)
        best = [sequence for sequence in derivations if vector(sequence) == least]
        found = answers(best, "none")
        if len(derivations) > 1 and found["verdict"] == "unique":
            found["verdict"] = "resolved"
        return found
    return answers(derivations, lean)


def answers(derivations: list[tuple[Any, ...]], lean: str) -> dict[str, Any]:
    """The verdict, the first and the second reading and the witness of
    derivations ranked under greedy, lazy or no lean (engine §6)."""
    key = functools.cmp_to_key(lambda a, b: order(a, b, lean))
    chosen = min(derivations, key=key)
    if len(derivations) == 1:
        return {"verdict": "unique", "chosen": chosen}
    tied: list[tuple[float, tuple[Any, ...]]] = []
    for other in derivations:
        if other is chosen:
            continue
        difference = visible_difference(chosen, other)
        if difference is None:
            # Equal visible sequences diverge last; one that extends the
            # other first differs where the shorter ends.
            shorter = min(sum(1 for x in seq if visible(x)) for seq in (chosen, other))
            longer = max(sum(1 for x in seq if visible(x)) for seq in (chosen, other))
            tied.append((INF if shorter == longer else shorter, other))
        elif decide(difference[1], difference[2], lean) == 0:
            tied.append((difference[0], other))
    if not tied:
        return {"verdict": "resolved", "chosen": chosen}
    best_at = min(at for at, _ in tied)
    second = min((other for at, other in tied if at == best_at), key=key)
    difference = visible_difference(chosen, second)
    witness = (difference[1], difference[2]) if difference is not None else whole_difference(chosen, second)
    return {"verdict": "tie", "chosen": chosen, "tied": second, "witness": witness}


def random_grammar(rng: random.Random) -> tuple[list[list[list[Any]]], list[str]]:
    count = rng.randint(1, 4)
    names = ["text", "ra", "rb", "rc"][:count]
    rules: list[list[list[Any]]] = []
    for number in range(count):
        alternatives = []
        for _ in range(rng.randint(1, 3)):
            length = rng.choice([0, 1, 1, 1, 2, 2, 3])
            alt: list[Any] = []
            for _ in range(length):
                if rng.random() < 0.45:
                    alt.append(rng.choice(TERMINALS))
                else:
                    alt.append(rng.randrange(count))
            # Now and then, left recursion on the rule itself.
            if length and rng.random() < 0.2:
                alt[0] = number
            alternatives.append(alt)
        rules.append(alternatives)
    return rules, names


def sample(rules: list[list[list[Any]]], rng: random.Random) -> list[str] | None:
    """The terminals of a random derivation of text, or None if one does not
    come out short."""
    out: list[str] = []
    stack: list[tuple[Any, int]] = [(0, 0)]
    while stack:
        symbol, depth = stack.pop()
        if isinstance(symbol, str):
            out.append(symbol)
            if len(out) > 6:
                return None
            continue
        if depth > 8:
            return None
        choices = rules[symbol]
        if depth > 4:
            # Deep down, prefer the alternatives that end the recursion.
            shallow = [alt for alt in choices if all(isinstance(value, str) for value in alt)]
            choices = shallow or choices
        alt = rng.choice(choices)
        stack.extend((value, depth + 1) for value in reversed(alt))
    return out


def random_tokens(rules: list[list[list[Any]]], rng: random.Random) -> list[frozenset[str]]:
    """Mostly the terminals of a derivation, each with other tags besides;
    now and then any tokens at all."""
    terminals = None
    if rng.random() < 0.8:
        for _ in range(10):
            terminals = sample(rules, rng)
            if terminals is not None:
                break
    if terminals is None:
        terminals = [rng.choice(TERMINALS) for _ in range(rng.randint(0, 4))]
    tokens = []
    for terminal in terminals:
        tags = {terminal, *rng.sample(TERMINALS, rng.choice([0, 0, 1, 1, 2]))}
        tokens.append(frozenset(tags))
    return tokens


def dom_of(rules: list[list[list[Any]]], names: list[str], lean: str) -> dict[str, Any]:
    def symbol(value: Any) -> dict[str, Any]:
        return {"ref": value if isinstance(value, str) else names[value]}

    def expression(alt: list[Any]) -> dict[str, Any]:
        if not alt:
            return {"empty": True}
        if len(alt) == 1:
            return symbol(alt[0])
        return {"seq": [symbol(value) for value in alt]}

    return {
        "format": DOM_FORMAT,
        "rules": [
            {
                "name": names[number],
                "op": "define",
                "alternatives": [{"guards": [], "expr": expression(alt)} for alt in alternatives],
                "conditions": [],
                "at": [number + 1, 1],
            }
            for number, alternatives in enumerate(rules)
        ],
        "directives": [{"name": "ambiguity-resolution", "args": ["lazy" if lean == "lazy" else "greedy"], "at": [9, 1]}],
    }


def library(lowered: Any, tokens: list[frozenset[str]], lean: str) -> dict[str, Any]:
    text = " ".join("x" for _ in tokens)
    token_list = [Token("x", tags, (index, index + 1), (2 * index, 2 * index + 1)) for index, tags in enumerate(tokens)]
    context = StageContext(lowered, token_list, text, _unicode_table(_resources().unicode))
    context.count = count_roots
    forest = Parser(context).parse(lowered.rule_ids["text"])
    return library_ranking(forest, lean, None)


def library_ranking(forest: Any, lean: str, maximal: Maximal | None) -> dict[str, Any]:
    """The library's ranking of a forest, in the reference's terms."""
    ranking = rank(forest, lean, maximal)
    if ranking is None:
        return {"verdict": None}

    def plain(rope: Any) -> tuple[Any, ...]:
        return tuple(
            ("r", act.token, act.terminal) if act.read else ("c", act.production, act.start, act.end, act.visible)
            for act in actions(rope)
        )

    found: dict[str, Any] = {"verdict": ranking.verdict, "chosen": plain(ranking.first)}
    if ranking.verdict == "tie":
        found["tied"] = plain(ranking.second)
        x, y = ranking.witness  # type: ignore[misc]
        found["witness"] = tuple(
            ("r", act.token, act.terminal) if act.read else ("c", act.production, act.start, act.end, act.visible)
            for act in (x, y)
        )
    return found


def productions_of(rules: list[list[list[Any]]]) -> list[tuple[int, tuple[Any, ...], bool]]:
    return [(number, tuple(alt), len(alt) == 1) for number, alternatives in enumerate(rules) for alt in alternatives]


def random_expression(rng: random.Random, rules: int, depth: int = 0) -> dict[str, Any]:
    names = ["text", "ra", "rb", "rc"]
    roll = rng.random()
    if depth >= 2 or roll < 0.45:
        if rng.random() < 0.5:
            return {"ref": rng.choice(TERMINALS)}
        return {"ref": names[rng.randrange(rules)]}
    if roll < 0.6:
        return {"seq": [random_expression(rng, rules, depth + 1) for _ in range(2)]}
    if roll < 0.72:
        return {"optional": random_expression(rng, rules, depth + 1)}
    if roll < 0.84:
        return {"repeat": random_expression(rng, rules, depth + 1), "min": rng.choice([0, 1])}
    if roll < 0.92:
        return {"choice": [random_expression(rng, rules, depth + 1) for _ in range(2)]}
    if roll < 0.96:
        return {"and": [random_expression(rng, rules, depth + 1) for _ in range(2)]}
    return {"empty": True}


def random_sugared(rng: random.Random) -> dict[str, Any]:
    """A grammar written with the notation's sugar: optionals, repetitions,
    groups, & and ε, which lowering turns into helpers."""
    count = rng.randint(1, 3)
    names = ["text", "ra", "rb", "rc"][:count]
    rules = []
    for number in range(count):
        alternatives = []
        for _ in range(rng.randint(1, 2)):
            items = [random_expression(rng, count) for _ in range(rng.choice([1, 1, 2]))]
            alternatives.append({"guards": [], "expr": items[0] if len(items) == 1 else {"seq": items}})
        rules.append({"name": names[number], "op": "define", "alternatives": alternatives, "conditions": [], "at": [number + 1, 1]})
    return {
        "format": DOM_FORMAT,
        "rules": rules,
        "directives": [{"name": "ambiguity-resolution", "args": ["greedy"], "at": [9, 1]}],
        "constants": [],
    }


def random_eliding(rng: random.Random) -> dict[str, Any]:
    """A grammar with optionals of the elidable terminator T, alone or
    before another symbol, among the sugar of random_sugared."""
    count = rng.randint(1, 3)
    names = ["text", "ra", "rb", "rc"][:count]

    def item() -> dict[str, Any]:
        roll = rng.random()
        if roll < 0.25:
            return {"optional": {"ref": "T"}}
        if roll < 0.4:
            return {"optional": {"seq": [{"ref": "T"}, random_expression(rng, count, 2)]}}
        return random_expression(rng, count)

    rules = []
    for number in range(count):
        alternatives = []
        for _ in range(rng.randint(1, 3)):
            items = [item() for _ in range(rng.choice([1, 2, 2, 3]))]
            alternatives.append({"guards": [], "expr": items[0] if len(items) == 1 else {"seq": items}})
        rules.append({"name": names[number], "op": "define", "alternatives": alternatives, "conditions": [], "at": [number + 1, 1]})
    return {
        "format": DOM_FORMAT,
        "rules": rules,
        "directives": [
            {"name": "ambiguity-resolution", "args": ["late-elision"], "at": [9, 1]},
            {"name": "elidable", "args": ["T"], "at": [10, 1]},
        ],
        "constants": [],
    }


def describe(rules: list[list[list[Any]]], names: list[str], tokens: list[frozenset[str]], lean: str) -> str:
    def show(value: Any) -> str:
        return value if isinstance(value, str) else names[value]

    grammar = " ".join(
        f"%rule {names[number]} {' | '.join(' '.join(show(v) for v in alt) or 'ε' for alt in alts)}" for number, alts in enumerate(rules)
    )
    shown = " ".join("[" + " ".join(sorted(tags)) + "]" for tags in tokens)
    return f"{lean}: {grammar} over {shown}"


def forest_derivations(forest: Forest, context: StageContext, maximal: bool, budget: int) -> list[tuple[Any, ...]]:
    """Every derivation of the input that counts (engine §4), enumerated
    from the forest's items and edges. The oracle leaves out the cyclic ones
    and, under maximal, those with an elided terminator whose constituent
    could be longer. It applies maximal itself, from the definition, and
    uses the library only to test a symbol's span (engine §4)."""
    productions = forest.lowered.productions
    spent = [0]

    def production(item: int) -> Any:
        return productions[forest.prod[item]]

    def complete(item: int) -> bool:
        return forest.dot[item] == len(production(item).rhs)

    def elided(item: int) -> bool:
        found = production(item)
        return bool(found.helper and found.elided is not None and not found.rhs)

    def close(item: int) -> tuple[Any, ...]:
        found = production(item)
        return ("c", found.id, forest.origin[item], forest.end[item], not found.transparent)

    def shorter(constituent: int, test: Any) -> bool:
        # A completed item of the same symbol from the same origin ends
        # later, and the symbol's test, if any, holds of it.
        lhs, origin, end = production(constituent).lhs, forest.origin[constituent], forest.end[constituent]
        for other in range(len(forest.prod)):
            if not complete(other) or production(other).lhs != lhs or forest.origin[other] != origin or forest.end[other] <= end:
                continue
            if test is None or context.test_holds(test, origin, forest.end[other], forest.tag[other]):
                return True
        return False

    def spend(amount: int) -> None:
        spent[0] += amount
        if spent[0] > budget:
            raise Budget()

    def enumerate_item(item: int, open_: frozenset[Any]) -> list[tuple[tuple[Any, ...], int | None]]:
        """The derivations of an item, each with the completed item that its
        last edge advanced over, or None."""
        keys: list[Any] = [item]
        if complete(item):
            keys.append((production(item).lhs, forest.origin[item], forest.end[item]))
        if any(key in open_ for key in keys):
            return []
        inner = open_ | frozenset(keys)
        found: list[tuple[tuple[Any, ...], int | None]] = []
        for pred, kind, a, b in forest.edges[item]:
            if kind == 0:
                found.append(((), None))
            elif kind == 1:
                for before, _ in enumerate_item(pred, inner):
                    found.append((before + (("r", a, b),), None))
            else:
                children = [sequence + (close(a),) for sequence, _ in enumerate_item(a, inner)]
                # The constituent of an elided terminator is the node just
                # before it, unless that is a terminal, or it stands first,
                # or it is what a left-recursive production has read so far.
                previous = production(pred)
                dot = forest.dot[pred]
                guarded = (
                    maximal
                    and elided(a)
                    and dot > 0
                    and not (dot == 1 and not previous.terminal[0] and previous.rhs[0] == previous.lhs)
                )
                test = previous.tests[dot - 1] if guarded and previous.tests else None
                for before, last in enumerate_item(pred, inner):
                    if guarded and last is not None and shorter(last, test):
                        continue
                    for child in children:
                        found.append((before + child, a))
            spend(len(found) + 1)
        return found

    return [sequence + (close(root),) for root in forest.roots for sequence, _ in enumerate_item(root, frozenset())]


def random_rules_grammar(rng: random.Random) -> tuple[dict[str, Any], str, bool, bool, list[str]]:
    """A random grammar like that of the JS property test: text and three
    rules, references now and then tested by their sound, the notation's
    sugar, and under late-elision, or now and then another rule, optionals
    of the elidable T, often right after a rule reference; now and then
    maximal. The grammar's DOM, the rule of the ranking, whether T is
    elidable, whether maximal holds, and the terminals."""
    pick = rng.random()
    lean = "greedy" if pick < 0.3 else "lazy" if pick < 0.6 else "late-elision" if pick < 0.85 else "none"
    elidable = lean == "late-elision" or rng.random() < 0.3
    maximal = elidable and rng.random() < 0.4
    terminals = ["A", "B", "T"] if elidable else ["A", "B", "C"]
    rules = ["t", "u", "v"]

    def reference(tested: float = 0.25) -> dict[str, Any]:
        rule = {"ref": rng.choice(rules)}
        roll = rng.random() * 0.25 / tested
        if roll < 0.15:
            return {"test": "=", "value": {"string": "x"}, "expr": rule}
        if roll < 0.25:
            return {"test": "≠", "value": {"string": "x"}, "expr": rule}
        return rule

    def body() -> dict[str, Any]:
        symbols: list[dict[str, Any]] = []
        for _ in range(rng.randrange(3)):
            symbol = {"ref": rng.choice(terminals)} if rng.random() < 0.5 else reference()
            sugar = rng.random()
            if elidable and sugar < 0.25:
                # A rule right before an elidable optional is the node that
                # maximal tests, so its own test often decides (engine §4).
                if rng.random() < 0.5:
                    symbols.append(reference(0.6))
                symbols.append({"optional": {"ref": "T"}} if rng.random() < 0.5 else {"optional": {"seq": [{"ref": "T"}, symbol]}})
            elif sugar < 0.08:
                symbols.append({"optional": symbol})
            elif sugar < 0.12:
                symbols.append({"repeat": symbol, "min": 1})
            elif sugar < 0.16:
                symbols.append({"repeat": symbol, "min": 0})
            else:
                symbols.append(symbol)
        if not symbols:
            return {"empty": True}
        return symbols[0] if len(symbols) == 1 else {"seq": symbols}

    definitions = [("text", 3)] + [(rule, 2) for rule in rules]
    dom_rules = [
        {
            "name": name,
            "op": "define",
            "alternatives": [{"guards": [], "expr": body()} for _ in range(count)],
            "conditions": [],
            "at": [number + 3, 1],
        }
        for number, (name, count) in enumerate(definitions)
    ]
    args = ["greedy" if lean == "none" else lean] + (["maximal"] if maximal else [])
    directives: list[dict[str, Any]] = [{"name": "ambiguity-resolution", "args": args, "at": [1, 1]}]
    if elidable:
        directives.append({"name": "elidable", "args": ["T"], "at": [2, 1]})
    dom = {"format": DOM_FORMAT, "rules": dom_rules, "directives": directives, "constants": []}
    return dom, lean, elidable, maximal, terminals


class RankingProperty(unittest.TestCase):
    def test_a_least_count_that_disagrees_is_an_internal_error(self) -> None:
        """If the least count of late-elision and the ranking with no lean
        over the best derivations ever disagree, the library fails with an
        internal error and does not pick a verdict. Here a least count
        capped at one stands for a defect of the count: the item of text
        has two least derivations through w."""
        dom = {
            "format": DOM_FORMAT,
            "rules": [
                {"name": "text", "op": "define", "alternatives": [{"guards": [], "expr": {"ref": "w"}}], "conditions": [], "at": [2, 1]},
                {"name": "w", "op": "define", "alternatives": [{"guards": [], "expr": {"ref": "x"}}, {"guards": [], "expr": {"ref": "y"}}], "conditions": [], "at": [3, 1]},
                {"name": "x", "op": "define", "alternatives": [{"guards": [], "expr": {"ref": "A"}}], "conditions": [], "at": [4, 1]},
                {"name": "y", "op": "define", "alternatives": [{"guards": [], "expr": {"ref": "A"}}], "conditions": [], "at": [5, 1]},
            ],
            "directives": [{"name": "ambiguity-resolution", "args": ["late-elision"], "at": [1, 1]}],
            "constants": [],
        }
        unicode = _unicode_table(_resources().unicode)
        lowered = lower(stitch("main", [("g.md", dom)], unicode), frozenset())
        context = StageContext(lowered, [Token("a", frozenset(["A"]), (0, 1), (0, 1))], "a", unicode)
        context.count = count_roots
        forest = Parser(context).parse(lowered.rule_ids["text"])
        self.assertEqual(library_ranking(forest, "late-elision", None)["verdict"], "tie")
        summary = Least.summary

        def one(self: Least) -> Any:
            found = summary(self)
            if found is not None:
                found.count = 1
            return found

        with mock.patch.object(Least, "summary", one), self.assertRaisesRegex(RuntimeError, "internal error"):
            rank(forest, "late-elision")

    def test_rules_and_maximal_against_enumeration(self) -> None:
        """Every rule of the ranking, with and without maximal, over empty
        and rejected inputs too, against an oracle that enumerates the
        derivations that count by itself. The ranking is None exactly when
        no derivation counts, and the stage has the oracle's verdict, or
        none for a rejection."""
        rounds = int(os.environ.get("GENCMU_PROPERTY_CASES", "1000")) * 3
        seed = int(os.environ.get("GENCMU_PROPERTY_SEED", "1"))
        unicode = _unicode_table(_resources().unicode)
        checked = rejected = empty = with_maximal = 0
        verdicts: dict[Any, int] = {}
        for number in range(rounds):
            rng = random.Random(30_000_000 + seed + number)
            dom, lean, elidable, maximal, terminals = random_rules_grammar(rng)
            specs = []
            for _ in range(rng.randrange(4)):
                tags = frozenset(terminal for terminal in terminals if rng.random() < 0.5) or frozenset(["A"])
                specs.append((tags, "x" if rng.random() < 0.6 else "y"))
            try:
                lowered = lower(stitch("main", [("g.md", dom)], unicode), frozenset())
            except gencmu.GencmuError:
                continue
            tokens = [Token("x", tags, (index, index + 1), (2 * index, 2 * index + 1), sound) for index, (tags, sound) in enumerate(specs)]
            text = " ".join("x" for _ in tokens)
            context = StageContext(lowered, tokens, text, unicode)
            context.count = count_roots
            forest = Parser(context).parse(lowered.rule_ids["text"])
            try:
                derivations = forest_derivations(forest, context, maximal, 20000)
            except Budget:
                continue
            if len(derivations) > 200:
                continue
            elided = frozenset(p.id for p in lowered.productions if p.helper and p.elided is not None and not p.rhs)
            expected = ranked(derivations, lean, elided, len(tokens))
            where = f"seed {30_000_000 + seed + number}, {lean}{' maximal' if maximal else ''}: {dom['rules']} over {specs}"
            found = library_ranking(forest, lean, Maximal(forest, context) if maximal else None)
            self.assertEqual(found, expected, where)
            if lean != "none":
                stage = StageRunner("main", lowered, lambda: lowered, tokens, text, unicode).run(False)
                self.assertEqual(stage.verdict, expected["verdict"], f"the stage's verdict, {where}")
            verdicts[(lean, expected["verdict"])] = verdicts.get((lean, expected["verdict"]), 0) + 1
            if expected["verdict"] is None:
                rejected += 1
            elif not tokens:
                empty += 1
            if maximal and expected["verdict"] is not None:
                with_maximal += 1
            checked += 1
        if os.environ.get("GENCMU_PROPERTY_VERBOSE"):
            print(f"\nrules: checked {checked}, rejected {rejected}, empty {empty}, under maximal {with_maximal}, verdicts {verdicts}")
        # Every kind of round is checked often enough to count.
        self.assertGreater(rejected, rounds / 50)
        self.assertGreater(empty, rounds / 100)
        self.assertGreater(with_maximal, rounds / 50)
        self.assertGreater(checked, rounds / 6)

    def test_against_enumeration(self) -> None:
        cases = int(os.environ.get("GENCMU_PROPERTY_CASES", "1000"))
        seed = int(os.environ.get("GENCMU_PROPERTY_SEED", "1"))
        compared = skipped = 0
        verdicts: dict[Any, int] = {}
        for number in range(cases):
            rng = random.Random(seed + number)
            rules, names = random_grammar(rng)
            productions = productions_of(rules)
            lowered = lower(stitch("main", [("g.md", dom_of(rules, names, "greedy"))], _unicode_table(_resources().unicode)), frozenset())
            for _ in range(4):
                tokens = random_tokens(rules, rng)
                for lean in ("greedy", "lazy", "none"):
                    try:
                        expected = reference(productions, len(rules), tokens, lean, 20000)
                    except Budget:
                        skipped += 1
                        continue
                    assert expected is not None
                    found = library(lowered, tokens, lean)
                    compared += 1
                    verdicts[expected["verdict"]] = verdicts.get(expected["verdict"], 0) + 1
                    self.assertEqual(found, expected, f"seed {seed + number}: {describe(rules, names, tokens, lean)}")
        if os.environ.get("GENCMU_PROPERTY_VERBOSE"):
            print(f"\ncompared {compared}, skipped {skipped}, verdicts {verdicts}")
        self.assertGreater(compared, cases)
        self.assertGreater(verdicts.get("tie", 0), 0)
        self.assertGreater(verdicts.get("resolved", 0), 0)

    def test_sugar_against_enumeration(self) -> None:
        """The same over grammars with helpers, whose closes are transparent
        whatever their length, and trailing repetitions."""
        cases = int(os.environ.get("GENCMU_PROPERTY_CASES", "1000")) // 2
        seed = int(os.environ.get("GENCMU_PROPERTY_SEED", "1"))
        compared = skipped = 0
        verdicts: dict[Any, int] = {}
        for number in range(cases):
            rng = random.Random(10_000_000 + seed + number)
            lowered = lower(stitch("main", [("g.md", random_sugared(rng))], _unicode_table(_resources().unicode)), frozenset())
            productions = [(p.lhs, tuple(s if t else s for s, t in zip(p.rhs, p.terminal)), p.transparent) for p in lowered.productions]
            plain_rules: list[list[list[Any]]] = [[] for _ in lowered.rule_names]
            for lhs, rhs, _ in productions:
                plain_rules[lhs].append(list(rhs))
            for _ in range(4):
                tokens = random_tokens(plain_rules, rng)
                for lean in ("greedy", "lazy", "none"):
                    try:
                        expected = reference(productions, len(lowered.rule_names), tokens, lean, 20000)
                    except Budget:
                        skipped += 1
                        continue
                    assert expected is not None
                    found = library(lowered, tokens, lean)
                    compared += 1
                    verdicts[expected["verdict"]] = verdicts.get(expected["verdict"], 0) + 1
                    self.assertEqual(found, expected, f"seed {10_000_000 + seed + number}, {lean}, over {tokens}")
        if os.environ.get("GENCMU_PROPERTY_VERBOSE"):
            print(f"\nsugar: compared {compared}, skipped {skipped}, verdicts {verdicts}")
        self.assertGreater(verdicts.get("tie", 0), 0)

    def test_late_elision_against_enumeration(self) -> None:
        """late-elision over grammars with an elidable terminator: the
        verdict from the elision vectors, and the readings of no lean over
        the derivations with the least vector (engine §6)."""
        cases = int(os.environ.get("GENCMU_PROPERTY_CASES", "1000")) // 2
        seed = int(os.environ.get("GENCMU_PROPERTY_SEED", "1"))
        compared = skipped = 0
        verdicts: dict[Any, int] = {}
        for number in range(cases):
            rng = random.Random(20_000_000 + seed + number)
            lowered = lower(stitch("main", [("g.md", random_eliding(rng))], _unicode_table(_resources().unicode)), frozenset())
            productions = [(p.lhs, tuple(p.rhs), p.transparent) for p in lowered.productions]
            elided = frozenset(p.id for p in lowered.productions if p.helper and p.elided is not None and not p.rhs)
            plain_rules: list[list[list[Any]]] = [[] for _ in lowered.rule_names]
            for lhs, rhs, _ in productions:
                plain_rules[lhs].append(list(rhs))
            for _ in range(4):
                tokens = random_tokens(plain_rules, rng)
                try:
                    expected = reference(productions, len(lowered.rule_names), tokens, "late-elision", 20000, elided)
                except Budget:
                    skipped += 1
                    continue
                assert expected is not None
                found = library(lowered, tokens, "late-elision")
                compared += 1
                verdicts[expected["verdict"]] = verdicts.get(expected["verdict"], 0) + 1
                self.assertEqual(found, expected, f"seed {20_000_000 + seed + number}, over {tokens}")
        if os.environ.get("GENCMU_PROPERTY_VERBOSE"):
            print(f"\nlate-elision: compared {compared}, skipped {skipped}, verdicts {verdicts}")
        self.assertGreater(verdicts.get("tie", 0), 0)
        self.assertGreater(verdicts.get("resolved", 0), 0)



class ElisionVectors(unittest.TestCase):
    """Elision vectors compare exactly however many elisions they share,
    also when two equal vectors are built apart (engine §6)."""

    @staticmethod
    def elisions(at: int, k: int) -> Vector:
        """2^k elisions at one boundary, built by doubling, each sum a new
        tuple."""
        vector: Vector = (-at, 1)
        for _ in range(k):
            vector = add(vector, tuple(list(vector)))
        return vector

    def test_runs_of_elisions(self) -> None:
        one: Vector = (0, 1)
        for k in (32, 53, 60, 100):
            with self.subTest(k=k):
                self.assertEqual(self.elisions(0, k), (0, 2**k))
                self.assertEqual(self.elisions(0, k), self.elisions(0, k), f"2^{k} and 2^{k}")
                # One more elision at the same boundary is greater, also
                # past 2^53, and one fewer is less.
                self.assertLess(self.elisions(0, k), add(self.elisions(0, k), one), f"2^{k} and 2^{k} + 1")
                self.assertGreater(add(one, self.elisions(0, k)), self.elisions(0, k), f"1 + 2^{k} and 2^{k}")
                self.assertLess((0, 2**k - 1), self.elisions(0, k), f"2^{k} - 1 and 2^{k}")
                # The same counts, followed by elisions at different
                # boundaries: the later boundary is less.
                self.assertLess(add(self.elisions(0, k), self.elisions(3, k)), add(self.elisions(0, k), self.elisions(2, k)), f"then at 3 or at 2, 2^{k} each")
                # One elision earlier outweighs any number later.
                self.assertLess(self.elisions(1, k), one, f"2^{k} at 1 and one at 0")


if __name__ == "__main__":
    unittest.main()
