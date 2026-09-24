"""A precompiled DOM is held to every rule the reader holds a document to
(engine §9, docs/output.md "A grammar DOM"): one that breaks any of them is a
cache miss, and its document is read afresh, so a compiled.json entry can
never change a result."""

from __future__ import annotations

import copy
import json
import unittest
from typing import Any, Callable

import gencmu
from gencmu._dialect import bundled_text, read_document
from gencmu._hash import fnv1a64
from gencmu._validate import dom_problem

DOCUMENT = """```ebnf
%ambiguity-resolution greedy ;
text ≔ $x("a") ["b"] <"T" ∪ tags($x)> : phonemes($x) = "" ⇒ $x ;
```
"""
PIPELINE = "## Main <?stage main?>\n\n- [g](g.md) <?grammar?>\n\n## Next <?stage next?>\n\n- [h](h.md) <?grammar?>\n"
NEXT = "```ebnf\n%ambiguity-resolution greedy ;\ntext ≔ [\"a\"] [\"Y\"] ;\n```\n"

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


def set_condition(condition: Any) -> Callable[[Dom], None]:
    def change(dom: Dom) -> None:
        rule(dom)["conditions"] = [condition]

    return change


def nested(depth: int) -> Any:
    expr: Any = {"terminal": "a"}
    for _ in range(depth):
        expr = {"optional": expr}
    return expr


A = {"terminal": "a"}
X = {"capture": "x"}
LIT = {"literal": "b"}


# One malformed DOM for each rule the reader enforces.
CASES: list[tuple[str, Callable[[Dom], None]]] = [
    ("format other than 1", lambda dom: dom.update(format=2)),
    ("rules not a list", lambda dom: dom.update(rules={})),
    ("directive without a position", lambda dom: dom["directives"][0].pop("at")),
    ("directive argument not a word", lambda dom: dom["directives"][0].update(args=[1])),
    ("rule without a name", lambda dom: rule(dom).pop("name")),
    ("rule name not a name", lambda dom: rule(dom).update(name="9 x")),
    ("rule op neither define nor extend", lambda dom: rule(dom).update(op="replace")),
    ("rule without alternatives", lambda dom: rule(dom).update(alternatives=[])),
    ("rule without a position", lambda dom: rule(dom).pop("at")),
    ("guard without negated", lambda dom: alt(dom).update(guards=[{"feature": "f"}])),
    ("seq of one item", set_expr({"seq": [A]})),
    ("choice of one item", set_expr({"choice": [A]})),
    ("& of more than 16 items", set_expr({"and": [A] * 17})),
    ("repetition with min 2", set_expr({"repeat": A, "min": 2})),
    ("capture of an optional", set_expr({"capture": "x", "expr": {"optional": A}})),
    ("capture of a group", set_expr({"capture": "x", "expr": {"seq": [A, A]}})),
    ("unknown expression", set_expr({"star": A})),
    ("nested more than 256 deep", set_expr(nested(300))),
    ("nothing with tags", set_emit({"nothing": True, "tags": LIT})),
    ("this with an inserted tag", set_emit({"items": [{"this": True}, {"insert": "Y"}]})),
    ("this with a capture", set_emit({"items": [{"this": True}, {"capture": "x"}]})),
    ("a capture listed twice", set_emit({"items": [{"capture": "x"}, {"capture": "x"}]})),
    ("tags on an inserted tag", set_emit({"items": [{"capture": "x"}, {"insert": "Y", "tags": LIT}]})),
    ("an emission with no items", set_emit({"items": []})),
    ("an unknown emission item", set_emit({"items": [{"that": True}]})),
    ("an unknown function", set_tags({"call": "upper", "args": [X]})),
    ("matches as a term", set_tags({"call": "matches", "args": [X, {"rule": "text"}]})),
    ("head where a value is needed", set_tags({"call": "head", "args": [X]})),
    ("lowercase of a weak tag", set_tags({"call": "lowercase", "args": [{"weak": "b"}]})),
    ("lowercase of a span", set_tags({"call": "lowercase", "args": [X]})),
    ("phonemes of two spans", set_tags({"call": "phonemes", "args": [X, X]})),
    ("phonemes of a literal", set_tags({"call": "phonemes", "args": [LIT]})),
    ("tags with a term for a rule", set_tags({"call": "tags", "args": [X, LIT]})),
    ("a rule name as a term", set_tags({"rule": "text"})),
    ("union of one part", set_tags({"union": [LIT]})),
    ("an unknown term", set_tags({"number": 1})),
    ("any of one condition", set_condition({"any": [{"op": "=", "left": LIT, "right": LIT}]})),
    ("matches of a literal", set_condition({"matches": LIT, "rule": "text"})),
    ("matches without a rule", set_condition({"matches": X})),
    ("an unknown comparator", set_condition({"op": "<", "left": LIT, "right": LIT})),
    ("a comparison without a side", set_condition({"op": "=", "left": LIT})),
]


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
                {"format": 1, "bootstrap": self.bootstrap_hash, "documents": {"g.md": {"hash": fnv1a64(DOCUMENT), "dom": dom}}}
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
