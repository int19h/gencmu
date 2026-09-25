"""A precompiled DOM is held to every rule the reader holds a document to
(engine §9, docs/output.md "A grammar DOM"): one that breaks any of them is a
cache miss, and its document is read afresh, so a compiled.json entry can
never change a result."""

from __future__ import annotations

import copy
import json
import random
import unittest
from typing import Any, Callable

import gencmu
from gencmu._dialect import DOM_FORMAT, bundled_text, read_document
from gencmu._hash import fnv1a64
from gencmu._validate import dom_problem

DOCUMENT = """```jbogenbau
%ambiguity-resolution greedy
%rule text $x("a") ["b"] <"T" ∪ tags($x)>
%conditions phonemes($x) = ""
%emits $x
```
"""
PIPELINE = "## Main <?stage main?>\n\n- [g](g.md) <?grammar?>\n\n## Next <?stage next?>\n\n- [h](h.md) <?grammar?>\n"
NEXT = "```jbogenbau\n%ambiguity-resolution greedy\n%rule text [\"a\"] [\"Y\"]\n```\n"

Dom = dict[str, Any]


def rule(dom: Dom) -> Dom:
    return dom["rules"][0]  # type: ignore[no-any-return]


def alt(dom: Dom) -> Dom:
    return rule(dom)["alternatives"][0]  # type: ignore[no-any-return]


def set_expr(expr: Any) -> Callable[[Dom], None]:
    def change(dom: Dom) -> None:
        alt(dom)["expr"] = expr

    return change


def set_emit(emit: Any) -> Callable[[Dom], None]:
    def change(dom: Dom) -> None:
        rule(dom)["emit"] = emit

    return change


def set_tags(term: Any) -> Callable[[Dom], None]:
    def change(dom: Dom) -> None:
        alt(dom)["tags"] = term

    return change


def set_rule_tags(term: Any) -> Callable[[Dom], None]:
    def change(dom: Dom) -> None:
        rule(dom)["tags"] = term

    return change


def set_condition(condition: Any) -> Callable[[Dom], None]:
    def change(dom: Dom) -> None:
        rule(dom)["conditions"] = [condition]

    return change


def with_bare_alternative(*changes: Callable[[Dom], None]) -> Callable[[Dom], None]:
    """A second alternative, which captures nothing, and an emission of $,
    which serves it: then the changes."""

    def change(dom: Dom) -> None:
        rule(dom)["alternatives"].append({"guards": [], "expr": {"terminal": "b"}})
        rule(dom)["emit"] = {"items": [WHOLE]}
        for other in changes:
            other(dom)

    return change


def nested_union(depth: int) -> Any:
    term: Any = {"literal": "T"}
    for _ in range(depth):
        term = {"union": [term, {"literal": "U"}]}
    return term


def nested_not(depth: int) -> Any:
    condition: Any = {"op": "=", "left": {"literal": "a"}, "right": {"literal": "a"}}
    # The comparison is compound too: its terms lie below it.
    for _ in range(depth - 1):
        condition = {"not": condition}
    return condition


def nested(depth: int) -> Any:
    expr: Any = {"terminal": "a"}
    for _ in range(depth):
        expr = {"optional": expr}
    return expr


A = {"terminal": "a"}
X = {"capture": "x"}
WHOLE = {"capture": ""}
LIT = {"literal": "b"}
SAME = {"op": "=", "left": LIT, "right": LIT}


# One malformed DOM for each rule the reader enforces.
CASES: list[tuple[str, Callable[[Dom], None]]] = [
    (f"format other than {DOM_FORMAT}", lambda dom: dom.update(format=DOM_FORMAT - 1)),
    ("rules not a list", lambda dom: dom.update(rules={})),
    ("directive without a position", lambda dom: dom["directives"][0].pop("at")),
    ("directive argument not a word", lambda dom: dom["directives"][0].update(args=[1])),
    ("rule without a name", lambda dom: rule(dom).pop("name")),
    ("rule name not a name", lambda dom: rule(dom).update(name="9 x")),
    ("rule name ##", lambda dom: rule(dom).update(name="##")),
    ("rule op not define, redefine or extend", lambda dom: rule(dom).update(op="replace")),
    ("rule without alternatives", lambda dom: rule(dom).update(alternatives=[])),
    ("rule without a position", lambda dom: rule(dom).pop("at")),
    ("verbatim other than true", lambda dom: rule(dom).update(verbatim=False)),
    ("guard without negated", lambda dom: alt(dom).update(guards=[{"feature": "f", "kind": "gate"}])),
    ("guard without a kind", lambda dom: alt(dom).update(guards=[{"feature": "f", "negated": False}])),
    ("guard of an unknown kind", lambda dom: alt(dom).update(guards=[{"feature": "f", "kind": "hint", "negated": False}])),
    ("a negated warning", lambda dom: alt(dom).update(guards=[{"feature": "f", "kind": "warning", "negated": True}])),
    ("seq of one item", set_expr({"seq": [A]})),
    ("choice of one item", set_expr({"choice": [A]})),
    ("& of more than 16 items", set_expr({"and": [A] * 17})),
    ("repetition with min 2", set_expr({"repeat": A, "min": 2})),
    ("capture of an optional", set_expr({"capture": "x", "expr": {"optional": A}})),
    ("capture of a group", set_expr({"capture": "x", "expr": {"seq": [A, A]}})),
    ("capture inside an optional", set_expr({"seq": [{"optional": {"capture": "x", "expr": A}}, A]})),
    ("capture inside a group", set_expr({"seq": [{"seq": [{"capture": "x", "expr": A}, A]}, A]})),
    ("capture inside a choice", set_expr({"choice": [{"capture": "x", "expr": A}, A]})),
    ("capture inside a repetition", set_expr({"repeat": {"capture": "x", "expr": A}, "min": 1})),
    ("unknown expression", set_expr({"star": A})),
    ("$ wrapping a symbol", set_expr({"capture": "", "expr": A})),
    ("nested more than 256 deep", set_expr(nested(257))),
    ("five captures in an alternative", set_expr({"seq": [{"capture": name, "expr": A} for name in "xyzvw"]})),
    ("a capture name used twice", set_expr({"seq": [{"capture": "x", "expr": A}, {"capture": "x", "expr": A}]})),
    ("$ with an inserted tag", set_emit({"items": [WHOLE, {"insert": "Y"}]})),
    ("$ with a capture", set_emit({"items": [WHOLE, {"capture": "x"}]})),
    ("an item with a key of no item", set_emit({"items": [{"capture": "x", "tags": LIT, "weak": True}]})),
    ("a capture on an inserted tag", set_emit({"items": [{"capture": "x"}, {"insert": "Y", "capture": "x"}]})),
    ("∅ as an item's tags", set_emit({"items": [{"capture": "x", "tags": {"emptySet": True}}]})),
    ("a capture listed twice", set_emit({"items": [{"capture": "x"}, {"capture": "x"}]})),
    ("tags on an inserted tag", set_emit({"items": [{"capture": "x"}, {"insert": "Y", "tags": LIT}]})),
    ("an emission with items that are no list", set_emit({"items": None})),
    ("an unknown emission item", set_emit({"items": [{"that": True}]})),
    ("an unknown function", set_tags({"call": "upper", "args": [X]})),
    ("matches as a term", set_tags({"call": "matches", "args": [X, {"rule": "text"}]})),
    ("initial as a term", set_tags({"call": "initial", "args": [X]})),
    ("head where a value is needed", set_tags({"call": "head", "args": [X]})),
    ("lowercase of a weak tag", set_tags({"call": "lowercase", "args": [{"weak": "b"}]})),
    ("lowercase of a span", set_tags({"call": "lowercase", "args": [X]})),
    ("phonemes of two spans", set_tags({"call": "phonemes", "args": [X, X]})),
    ("phonemes of a literal", set_tags({"call": "phonemes", "args": [LIT]})),
    ("tags with a term for a rule", set_tags({"call": "tags", "args": [X, LIT]})),
    ("a rule name as a term", set_tags({"rule": "text"})),
    ("union of one part", set_tags({"union": [LIT]})),
    ("tags with arguments that are no list", set_tags({"call": "tags", "args": None})),
    ("classes of a list in a rule's tags", set_rule_tags({"call": "classes", "args": [[WHOLE]]})),
    ("$ in an alternative's tags", set_tags({"union": [WHOLE, LIT]})),
    ("tags($) in an alternative's tags", set_tags({"call": "tags", "args": [WHOLE]})),
    ("classes($) in a rule's tags", set_rule_tags({"intersection": [{"call": "classes", "args": [WHOLE]}, LIT]})),
    ("an unknown term", set_tags({"number": 1})),
    ("any of one condition", set_condition({"any": [SAME]})),
    ("all of one condition", set_condition({"all": [SAME]})),
    ("matches of a literal", set_condition({"matches": LIT, "rule": "text"})),
    ("matches without a rule", set_condition({"matches": X})),
    ("an unknown comparator", set_condition({"op": "<", "left": LIT, "right": LIT})),
    ("a comparator that is a list", set_condition({"op": ["="], "left": LIT, "right": LIT})),
    ("matches of a call that is a list", set_condition({"matches": {"call": []}, "rule": "text"})),
    ("initial of a literal", set_condition({"initial": LIT})),
    ("initial with a rule", set_condition({"initial": X, "rule": "text"})),
    ("a function that is a list", set_tags({"call": ["phonemes"], "args": [X]})),
    ("an op that is a list", lambda dom: rule(dom).update(op=["define"])),
    ("a comparison without a side", set_condition({"op": "=", "left": LIT})),
    ("a presence test of no name", set_condition({"captured": 1})),
    ("an implication without a consequent", set_condition({"if": SAME})),
    ("a guarded term without a term", set_tags({"if": SAME})),
    ("a guarded term as a span", set_tags({"call": "tags", "args": [{"if": SAME, "then": X}]})),
    ("a guarded term of a span", set_tags({"if": SAME, "then": {"call": "head", "args": [X]}})),
    ("$ in a guard of an alternative's tags", set_tags({"if": {"op": "∈", "left": LIT, "right": WHOLE}, "then": LIT})),
    ("tags($) in a guard of a rule's tags", set_rule_tags({"if": {"not": {"op": "=", "left": LIT, "right": {"call": "tags", "args": [WHOLE]}}}, "then": LIT})),
    # A definition as a whole (engine §9).
    ("a condition on a capture no alternative has", set_condition({"op": "=", "left": {"call": "text", "args": [{"capture": "y"}]}, "right": LIT})),
    ("a presence test of a capture no alternative has", set_condition({"captured": "y"})),
    ("an emitted capture no alternative has", set_emit({"items": [{"capture": "y"}]})),
    ("a condition that applies to no alternative", set_condition({"captured": "x"})),
    ("a condition that is true everywhere", set_condition({"if": {"captured": "x"}, "then": {"captured": ""}})),
    ("a rule's tags using a capture an alternative lacks", with_bare_alternative(set_rule_tags(X))),
    ("an alternative's tags using a capture it lacks", with_bare_alternative(lambda dom: rule(dom)["alternatives"][1].update(tags=X))),
    ("an emitted item's tags using a capture an alternative lacks", with_bare_alternative(set_emit({"items": [{"capture": "", "tags": X}]}))),
    ("captures emitted out of order", lambda dom: (set_expr({"seq": [{"capture": "x", "expr": A}, {"capture": "y", "expr": A}]})(dom), set_emit({"items": [{"capture": "y"}, {"capture": "x"}]})(dom))),
    ("an inserted tag anchored on a missing capture", with_bare_alternative(set_emit({"items": [{"insert": "Y"}, {"capture": "x"}]}))),
    ("an emission that leaves an alternative nothing", with_bare_alternative(set_emit({"items": [{"capture": "x"}]}))),
    ("verbatim with ε", lambda dom: (rule(dom).update(verbatim=True), set_emit({"items": []})(dom))),
]


def scramble(value: Any, rng: random.Random) -> Any:
    """A copy of a DOM with one value somewhere replaced by another of any
    JSON shape."""
    paths: list[tuple[Any, Any]] = []
    stack = [value]
    while stack:
        current = stack.pop()
        keys = range(len(current)) if isinstance(current, list) else list(current) if isinstance(current, dict) else []
        for key in keys:
            paths.append((current, key))
            stack.append(current[key])
    container, key = rng.choice(paths)
    container[key] = rng.choice(
        [None, True, 0, 2, -1, 1.5, "", "x", "=", "head", "matches", [], [{}], {}, {"call": []}, {"capture": 1},
         {"call": "head", "args": [{"capture": "x"}]}, {"literal": []}, {"capture": "x", "expr": {"ref": "A"}}]
    )
    return value


class PrecompiledDomRules(unittest.TestCase):
    dom: Dom
    bootstrap_hash: str

    @classmethod
    def setUpClass(cls) -> None:
        cls.dom = read_document(DOCUMENT, "g.md")
        cls.bootstrap_hash = fnv1a64(bundled_text("notation/bootstrap.json") or "")

    def parse(self, dom: Dom | None) -> str:
        sources = {"p.md": PIPELINE, "g.md": DOCUMENT, "h.md": NEXT}
        if dom is not None:
            sources["compiled.json"] = json.dumps(
                {"format": DOM_FORMAT, "bootstrap": self.bootstrap_hash, "documents": {"g.md": {"hash": fnv1a64(DOCUMENT), "dom": dom}}}
            )
        dialect = gencmu.load_dialect_sources(sources, "p.md", use_cache=dom is not None)
        return gencmu.to_json(dialect.parse("a", auto_features=False))

    def test_the_reading_passes(self) -> None:
        self.assertIsNone(dom_problem(self.dom))

    def test_a_well_formed_entry_is_used(self) -> None:
        """The control: an entry that breaks no rule is read in place of the
        document, so the cases below test the check, not a cache never
        consulted."""
        changed = copy.deepcopy(self.dom)
        set_emit({"items": [{"capture": "x"}, {"insert": "Y"}]})(changed)
        self.assertIsNone(dom_problem(changed))
        self.assertNotEqual(self.parse(changed), self.parse(None))

    def test_no_shape_raises(self) -> None:
        """Whatever the shape, the check gives an answer, never an exception."""
        rng = random.Random(7)
        for _ in range(3000):
            broken = copy.deepcopy(self.dom)
            for _ in range(rng.randint(1, 3)):
                broken = scramble(broken, rng)
            try:
                dom_problem(broken)
            except Exception as error:  # pragma: no cover - the failure itself
                self.fail(f"{type(error).__name__} for {json.dumps(broken)[:300]}")

    def test_a_broken_bootstrap_dom_is_an_error(self) -> None:
        """In a bootstrap, where there is no document to read instead, a
        broken DOM is a GencmuError."""
        bootstrap = json.loads(bundled_text("notation/bootstrap.json") or "{}")
        bootstrap["stages"][-1]["documents"][0]["dom"]["rules"][0]["conditions"] = [{"matches": {"call": []}, "rule": "text"}]
        sources = {"p.md": PIPELINE, "g.md": DOCUMENT, "h.md": NEXT, "notation/bootstrap.json": json.dumps(bootstrap)}
        with self.assertRaises(gencmu.GencmuError):
            gencmu.load_dialect_sources(sources, "p.md", use_cache=False)

    def test_nesting_bound(self) -> None:
        """No node may lie below more than 256 compound nodes of its
        expression, term or condition (engine §9); an emission is none."""
        for depth, allowed in ((256, True), (257, False)):
            for name, change in (
                # The capture the clauses use, and the nesting beside it in a
                # sequence, which is one compound node.
                ("expression", set_expr({"seq": [{"capture": "x", "expr": A}, nested(depth - 1)]})),
                ("alternative's term", set_tags(nested_union(depth))),
                ("emitted term", set_emit({"items": [{"capture": "x", "tags": nested_union(depth)}]})),
                ("condition", set_condition(nested_not(depth))),
            ):
                with self.subTest(what=name, depth=depth):
                    dom = copy.deepcopy(self.dom)
                    change(dom)
                    self.assertEqual(dom_problem(dom) is None, allowed, dom_problem(dom))

    def test_what_the_reader_allows_is_allowed(self) -> None:
        """$ in conditions, in emission and as a span of tags($, rule), ε,
        ∧, ⟹, presence tests, guarded terms, # as a rule's name, a negated
        gate and a warning (engine §9)."""
        for name, change in (
            ("$ twice", set_emit({"items": [{"capture": "", "tags": LIT}, WHOLE]})),
            ("ε", set_emit({"items": []})),
            ("verbatim", lambda dom: rule(dom).update(verbatim=True)),
            ("tags($) in an emitted term", set_emit({"items": [{"capture": "x", "tags": {"call": "tags", "args": [WHOLE]}}]})),
            ("tags($, rule) in an alternative's tags", set_tags({"call": "tags", "args": [WHOLE, {"rule": "text"}]})),
            ("text($) in an alternative's tags", set_tags({"call": "text", "args": [WHOLE]})),
            ("tags(head($)) in an alternative's tags", set_tags({"call": "tags", "args": [{"call": "head", "args": [WHOLE]}]})),
            ("a condition on $", set_condition({"op": "∈", "left": LIT, "right": {"call": "tags", "args": [WHOLE]}})),
            ("all", set_condition({"all": [SAME, {"not": {"matches": WHOLE, "rule": "text"}}]})),
            ("initial($) in a guard of an alternative's tags", set_tags({"if": {"initial": WHOLE}, "then": LIT})),
            ("# as a rule's name", lambda dom: rule(dom).update(name="#")),
            ("a negated gate", lambda dom: alt(dom).update(guards=[{"feature": "f", "kind": "gate", "negated": True}])),
            ("a warning", lambda dom: alt(dom).update(guards=[{"feature": "w", "kind": "warning", "negated": False}])),
            ("an implication", set_condition({"if": SAME, "then": {"op": "=", "left": {"call": "text", "args": [X]}, "right": LIT}})),
            ("a presence test that removes an alternative", with_bare_alternative(set_condition({"captured": "x"}))),
            ("a guarded term", with_bare_alternative(set_rule_tags({"union": [LIT, {"if": {"captured": "x"}, "then": X}]}))),
            ("a guard reading tags(head($))", set_tags({"if": {"op": "∈", "left": LIT, "right": {"call": "tags", "args": [{"call": "head", "args": [WHOLE]}]}}, "then": LIT})),
            ("an emitted item dropped where its capture is missing", with_bare_alternative(set_emit({"items": [{"capture": "x"}, {"insert": "Y"}]}))),
        ):
            with self.subTest(what=name):
                dom = copy.deepcopy(self.dom)
                change(dom)
                self.assertIsNone(dom_problem(dom))

    def test_four_captures_are_allowed(self) -> None:
        dom = copy.deepcopy(self.dom)
        set_expr({"seq": [{"capture": name, "expr": A} for name in "xyzv"]})(dom)
        self.assertIsNone(dom_problem(dom))

    def test_each_broken_rule_is_a_miss(self) -> None:
        fresh = self.parse(None)
        for name, change in CASES:
            with self.subTest(rule=name):
                broken = copy.deepcopy(self.dom)
                change(broken)
                self.assertIsNotNone(dom_problem(broken))
                self.assertEqual(self.parse(broken), fresh)


if __name__ == "__main__":
    unittest.main()
