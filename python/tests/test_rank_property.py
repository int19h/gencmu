"""The ranking of engine §6 against brute force.

Random small grammars, with ε, left recursion and unary cycles, over short
random inputs whose tokens carry strong and weak tags. The reference
enumerates every derivation, leaving out the cyclic ones as engine §4
defines them, and computes the verdict, the chosen derivation, the tied
derivation and the witness straight from the definitions of §6; the library
computes them over the packed forest without enumerating. A grammar whose
derivations exceed a budget is skipped rather than enumerated.

GENCMU_PROPERTY_CASES sets the number of grammars (default 400) and
GENCMU_PROPERTY_SEED the first seed, for a larger sweep.
"""

from __future__ import annotations

import functools
import os
import random
import unittest
from typing import Any

from gencmu._dialect import _resources, _unicode_table
from gencmu._earley import Parser, StageContext
from gencmu._grammar import lower, stitch
from gencmu._model import Token
from gencmu._rank import Ranker, actions, count_roots

TERMINALS = ["A", "B", "C"]
INF = float("inf")


class Budget(Exception):
    pass


# An action: ("r", token, terminal, weak) or ("c", production, start, end, visible).


def same(x: tuple[Any, ...], y: tuple[Any, ...]) -> bool:
    return x[:3] == y[:3] if x[0] == "r" else x[:4] == y[:4]


def visible(action: tuple[Any, ...]) -> bool:
    return action[0] == "r" or action[4]


def decide(x: tuple[Any, ...], y: tuple[Any, ...], lean: str) -> int:
    if x[0] == "r" and y[0] == "r":
        if x[3] == y[3]:
            return 0
        return 1 if x[3] else -1
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


def reference(productions: list[tuple[int, tuple[Any, ...], bool]], rules: int, tokens: list[dict[str, bool]], lean: str, budget: int) -> dict[str, Any] | None:
    """Every derivation of the start rule, rule 0, and the ranking's answers
    from the definitions. A production is its rule, its symbols (a string
    for a terminal, a number for a rule) and whether it is transparent."""
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
                read = ("r", i, symbol, not tokens[i][symbol])
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

    derivations = derive(0, 0, n, frozenset())
    if not derivations:
        return {"verdict": None}
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


def random_tokens(rules: list[list[list[Any]]], rng: random.Random) -> list[dict[str, bool]]:
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
        tokens.append({tag: rng.random() < 0.7 for tag in sorted(tags)})
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
        "format": 3,
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


def library(lowered: Any, tokens: list[dict[str, bool]], lean: str) -> dict[str, Any]:
    text = " ".join("x" for _ in tokens)
    token_list = [Token("x", dict(tags), (index, index + 1), (2 * index, 2 * index + 1)) for index, tags in enumerate(tokens)]
    context = StageContext(lowered, token_list, text, _unicode_table(_resources().unicode))
    context.count = count_roots
    forest = Parser(context).parse(lowered.rule_ids["text"])
    ranking = Ranker(forest, lean).rank(forest.roots) if forest.roots else None
    if ranking is None:
        return {"verdict": None}

    def plain(rope: Any) -> tuple[Any, ...]:
        return tuple(
            ("r", act.token, act.terminal, act.weak) if act.read else ("c", act.production, act.start, act.end, act.visible)
            for act in actions(rope)
        )

    found: dict[str, Any] = {"verdict": ranking.verdict, "chosen": plain(ranking.chosen)}
    if ranking.verdict == "tie":
        found["tied"] = plain(ranking.tied)
        x, y = ranking.witness  # type: ignore[misc]
        found["witness"] = tuple(
            ("r", act.token, act.terminal, act.weak) if act.read else ("c", act.production, act.start, act.end, act.visible)
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
        "format": 3,
        "rules": rules,
        "directives": [{"name": "ambiguity-resolution", "args": ["greedy"], "at": [9, 1]}],
    }


def describe(rules: list[list[list[Any]]], names: list[str], tokens: list[dict[str, bool]], lean: str) -> str:
    def show(value: Any) -> str:
        return value if isinstance(value, str) else names[value]

    grammar = " ".join(
        f"%rule {names[number]} {' | '.join(' '.join(show(v) for v in alt) or 'ε' for alt in alts)}" for number, alts in enumerate(rules)
    )
    shown = " ".join("[" + " ".join(t if s else "?" + t for t, s in tags.items()) + "]" for tags in tokens)
    return f"{lean}: {grammar} over {shown}"


class RankingProperty(unittest.TestCase):
    def test_against_enumeration(self) -> None:
        cases = int(os.environ.get("GENCMU_PROPERTY_CASES", "1000"))
        seed = int(os.environ.get("GENCMU_PROPERTY_SEED", "1"))
        compared = skipped = 0
        verdicts: dict[Any, int] = {}
        for number in range(cases):
            rng = random.Random(seed + number)
            rules, names = random_grammar(rng)
            productions = productions_of(rules)
            lowered = lower(stitch("main", [("g.md", dom_of(rules, names, "greedy"))]), frozenset())
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
            lowered = lower(stitch("main", [("g.md", random_sugared(rng))]), frozenset())
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


if __name__ == "__main__":
    unittest.main()
