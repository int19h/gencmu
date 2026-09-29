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
from gencmu._dialect import DOM_FORMAT, _unicode_table, bundled_text, read_document
from gencmu._hash import fnv1a64
from gencmu._model import Token
from gencmu._validate import Lowercase
from gencmu._validate import dom_problem as _dom_problem

DOCUMENT = """```jbogenbau
%ambiguity-resolution greedy
%rule text $x('a') ['b'] <~T ∪ tags($x)>
%conditions phonemes($x) = ""
%emits $x
```
"""
PIPELINE = '```jbogenbau\n%stage main\n%include "g.md"\n%stage next\n%include "h.md"\n```\n'
NEXT = "```jbogenbau\n%ambiguity-resolution greedy\n%rule text ['a'] [Y]\n```\n"

Dom = dict[str, Any]

BUNDLED_UNICODE = _unicode_table(bundled_text("unicode.txt") or "")


def dom_problem(dom: Any, unicode: Lowercase = BUNDLED_UNICODE) -> str | None:
    """The check, which always has a table: the bundled one, unless a test
    gives its own."""
    return _dom_problem(dom, unicode)


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
        rule(dom)["alternatives"].append({"guards": [], "expr": {"terminal": "'b'"}})
        rule(dom)["emit"] = {"items": [WHOLE]}
        for other in changes:
            other(dom)

    return change


def nested_union(depth: int) -> Any:
    term: Any = {"tag": "T"}
    for _ in range(depth):
        term = {"union": [term, {"tag": "U"}]}
    return term


def nested_not(depth: int) -> Any:
    condition: Any = {"op": "=", "left": {"string": "a"}, "right": {"string": "a"}}
    # The comparison is compound too: its terms lie below it.
    for _ in range(depth - 1):
        condition = {"not": condition}
    return condition


def nested(depth: int) -> Any:
    expr: Any = {"terminal": "'a'"}
    for _ in range(depth):
        expr = {"optional": expr}
    return expr


A = {"terminal": "'a'"}
X = {"capture": "x"}
TAGS_X = {"call": "tags", "args": [X]}
WHOLE = {"capture": ""}
TAG = {"tag": "b"}
STR = {"string": "b"}
RUNS = {"call": "split", "args": [{"call": "phonemes", "args": [X]}, {"string": "."}]}
TEXT = {"call": "text", "args": [X]}
SAME = {"op": "=", "left": STR, "right": STR}


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
    ("an item with a key of no item", set_emit({"items": [{"capture": "x", "tags": TAG, "weak": True}]})),
    ("a capture on an inserted tag", set_emit({"items": [{"capture": "x"}, {"insert": "Y", "capture": "x"}]})),
    ("∅ as an item's tags", set_emit({"items": [{"capture": "x", "tags": {"emptySet": True}}]})),
    ("a capture listed twice", set_emit({"items": [{"capture": "x"}, {"capture": "x"}]})),
    ("tags on an inserted tag", set_emit({"items": [{"capture": "x"}, {"insert": "Y", "tags": TAG}]})),
    # An inserted item is one tag in its canonical spelling (engine §1, §9).
    ("an inserted item that is no tag", set_emit({"items": [{"capture": "x"}, {"insert": "a b"}]})),
    ("an inserted character tag not in its canonical spelling", set_emit({"items": [{"capture": "x"}, {"insert": "'\\u{61}'"}]})),
    ("an emission with items that are no list", set_emit({"items": None})),
    ("an unknown emission item", set_emit({"items": [{"that": True}]})),
    ("an unknown function", set_tags({"call": "upper", "args": [X]})),
    ("matches as a term", set_tags({"call": "matches", "args": [X, {"rule": "text"}]})),
    ("begins as a term", set_tags({"call": "begins", "args": [X, {"rule": "text"}]})),
    ("initial as a term", set_tags({"call": "initial", "args": [X]})),
    ("head where a value is needed", set_tags({"call": "head", "args": [X]})),
    ("after where a value is needed", set_tags({"call": "after", "args": [X]})),
    ("from of a tag", set_tags({"call": "tags", "args": [{"call": "from", "args": [TAG]}]})),
    ("a weak tag", set_tags({"weak": "b"})),
    ("a literal", set_tags({"literal": "b"})),
    ("a string as a tag term", set_tags(STR)),
    ("a set of strings as a tag term", set_tags(RUNS)),
    ("lowercase, which is no function", set_condition({"op": "=", "left": {"call": "lowercase", "args": [STR]}, "right": STR})),
    ("runs, which is no function", set_condition({"op": "∈", "left": STR, "right": {"call": "runs", "args": [X]}})),
    ("tag of a tag set", set_tags({"call": "tag", "args": [TAG]})),
    ("tag of a span", set_tags({"call": "tag", "args": [X]})),
    ("tag of two strings", set_tags({"call": "tag", "args": [STR, STR]})),
    ("tag of a string that is no name", set_tags({"call": "tag", "args": [{"string": "x y"}]})),
    ("split of one string", set_condition({"op": "∈", "left": STR, "right": {"call": "split", "args": [STR]}})),
    ("split of a span", set_condition({"op": "∈", "left": STR, "right": {"call": "split", "args": [X, STR]}})),
    ("split of a tag set", set_condition({"op": "∈", "left": STR, "right": {"call": "split", "args": [TAG, STR]}})),
    ("split with an empty delimiter", set_condition({"op": "∈", "left": STR, "right": {"call": "split", "args": [STR, {"string": ""}]}})),
    # A reference to a constant has a name with a capital and a position,
    # and never a value (engine §9, docs/output.md).
    ("a constant with a lower-case name", set_tags({"const": "k", "at": [9, 20]})),
    ("a constant without a position", set_tags({"const": "K"})),
    ("a constant with a value", set_tags({"const": "K", "at": [9, 20], "value": {"set": []}})),
    ("a constant where a string must be a set", set_condition({"op": "∈", "left": TAG, "right": {"const": "K", "at": [9, 20]}})),
    ("a capture on the left of ∈", set_condition({"op": "∈", "left": X, "right": RUNS})),
    ("tags on the left of ∉", set_condition({"op": "∉", "left": TAGS_X, "right": STR})),
    ("a string in a tag set", set_condition({"op": "∈", "left": STR, "right": TAGS_X})),
    ("⊆ of a tag set and a set of strings", set_condition({"op": "⊆", "left": TAG, "right": RUNS})),
    ("= of a string and a tag set", set_condition({"op": "=", "left": TEXT, "right": TAG})),
    ("= of two sets of no kind", set_condition({"op": "=", "left": {"emptySet": True}, "right": {"emptySet": True}})),
    ("a union of two kinds", set_tags({"union": [TAGS_X, RUNS]})),
    ("a difference of three parts", set_tags({"difference": [TAG, TAG, TAG]})),
    ("a difference of one part", set_tags({"difference": [TAG]})),
    ("a character tag not in its canonical spelling", set_tags({"tag": "'\\'"})),
    # A term has exactly the members of one form, in either order.
    ("a string that is also a tag", set_condition({"op": "=", "left": {"call": "phonemes", "args": [X]}, "right": {"string": "wrong", "tag": "Bad"}})),
    ("a tag that is also a string", set_condition({"op": "=", "left": {"call": "phonemes", "args": [X]}, "right": {"tag": "Bad", "string": "wrong"}})),
    ("a tag of ! that is also a string", set_tags({"tag": "!", "string": "x"})),
    ("a string that is also a tag of !", set_tags({"string": "x", "tag": "!"})),
    ("a difference that is also a union", set_tags({"difference": [TAG, TAG], "union": [TAG, TAG]})),
    ("a union that is also a difference", set_tags({"union": [TAG, TAG], "difference": [TAG, TAG]})),
    ("a difference that is also an intersection", set_tags({"difference": [TAG, TAG], "intersection": [TAG, TAG]})),
    ("a difference that is also a tag", set_tags({"difference": [TAG, TAG], "tag": "b"})),
    ("a tag that is also a difference", set_tags({"tag": "b", "difference": [TAG, TAG]})),
    ("a span that is also a tag", set_tags({"call": "tags", "args": [{"capture": "x", "tag": "b"}]})),
    ("a call that is also a string", set_condition({"op": "=", "left": {"call": "phonemes", "args": [X], "string": "a"}, "right": STR})),
    ("a guarded term that is also a tag", set_tags({"if": SAME, "then": TAG, "tag": "b"})),
    ("an empty set that is also a tag", set_tags({"union": [{"emptySet": True, "tag": "b"}, TAG]})),
    ("a terminal that is no tag", set_expr({"capture": "x", "expr": {"terminal": "é"}})),
    ("a terminal of two characters", set_expr({"capture": "x", "expr": {"terminal": "'ab'"}})),
    ("a capture name with a capital", set_expr({"capture": "X", "expr": A})),
    ("an elidable phoneme tag", lambda dom: dom["directives"].append({"name": "elidable", "args": ["/a/"], "at": [9, 1]})),
    ("phonemes of two spans", set_tags({"call": "phonemes", "args": [X, X]})),
    ("phonemes of a tag", set_tags({"call": "phonemes", "args": [TAG]})),
    ("tags with a term for a rule", set_tags({"call": "tags", "args": [X, TAG]})),
    ("a rule name as a term", set_tags({"rule": "text"})),
    ("union of one part", set_tags({"union": [TAG]})),
    ("tags with arguments that are no list", set_tags({"call": "tags", "args": None})),
    ("classes of a list in a rule's tags", set_rule_tags({"call": "classes", "args": [[WHOLE]]})),
    ("$ in an alternative's tags", set_tags({"union": [WHOLE, TAG]})),
    ("tags($) in an alternative's tags", set_tags({"call": "tags", "args": [WHOLE]})),
    ("classes($) in a rule's tags", set_rule_tags({"intersection": [{"call": "classes", "args": [WHOLE]}, TAG]})),
    ("an unknown term", set_tags({"number": 1})),
    ("any of one condition", set_condition({"any": [SAME]})),
    ("all of one condition", set_condition({"all": [SAME]})),
    ("matches of a tag", set_condition({"matches": TAG, "rule": "text"})),
    ("matches without a rule", set_condition({"matches": X})),
    ("an unknown comparator", set_condition({"op": "<", "left": STR, "right": STR})),
    ("a comparator that is a list", set_condition({"op": ["="], "left": STR, "right": STR})),
    ("matches of a call that is a list", set_condition({"matches": {"call": []}, "rule": "text"})),
    ("begins of a tag", set_condition({"begins": TAG, "rule": "text"})),
    ("begins without a rule", set_condition({"begins": X})),
    ("matches and begins in one condition", set_condition({"matches": X, "begins": X, "rule": "text"})),
    ("initial of a tag", set_condition({"initial": TAG})),
    ("initial with a rule", set_condition({"initial": X, "rule": "text"})),
    ("a function that is a list", set_tags({"call": ["phonemes"], "args": [X]})),
    ("an op that is a list", lambda dom: rule(dom).update(op=["define"])),
    ("a comparison without a side", set_condition({"op": "=", "left": STR})),
    ("a presence test of no name", set_condition({"captured": 1})),
    ("an implication without a consequent", set_condition({"if": SAME})),
    ("a guarded term without a term", set_tags({"if": SAME})),
    ("a guarded term as a span", set_tags({"call": "tags", "args": [{"if": SAME, "then": X}]})),
    ("a guarded term of a span", set_tags({"if": SAME, "then": {"call": "head", "args": [X]}})),
    ("$ in a guard of an alternative's tags", set_tags({"if": {"op": "∈", "left": STR, "right": WHOLE}, "then": TAG})),
    ("tags($) in a guard of a rule's tags", set_rule_tags({"if": {"not": {"op": "=", "left": TAG, "right": {"call": "tags", "args": [WHOLE]}}}, "then": TAG})),
    # A definition as a whole (engine §9).
    ("a condition on a capture no alternative has", set_condition({"op": "=", "left": {"call": "text", "args": [{"capture": "y"}]}, "right": STR})),
    ("a presence test of a capture no alternative has", set_condition({"captured": "y"})),
    ("an emitted capture no alternative has", set_emit({"items": [{"capture": "y"}]})),
    ("a condition that applies to no alternative", set_condition({"captured": "x"})),
    ("a condition that is true everywhere", set_condition({"if": {"captured": "x"}, "then": {"captured": ""}})),
    ("a rule's tags using a capture an alternative lacks", with_bare_alternative(set_rule_tags(TAGS_X))),
    ("an alternative's tags using a capture it lacks", with_bare_alternative(lambda dom: rule(dom)["alternatives"][1].update(tags=TAGS_X))),
    ("an emitted item's tags using a capture an alternative lacks", with_bare_alternative(set_emit({"items": [{"capture": "", "tags": TAGS_X}]}))),
    ("captures emitted out of order", lambda dom: (set_expr({"seq": [{"capture": "x", "expr": A}, {"capture": "y", "expr": A}]})(dom), set_emit({"items": [{"capture": "y"}, {"capture": "x"}]})(dom))),
    ("an inserted tag anchored on a missing capture", with_bare_alternative(set_emit({"items": [{"insert": "Y"}, {"capture": "x"}]}))),
    ("an emission that leaves an alternative nothing", with_bare_alternative(set_emit({"items": [{"capture": "x"}]}))),
    ("verbatim with ε", lambda dom: (rule(dom).update(verbatim=True), set_emit({"items": []})(dom))),
    # Tests in a body (engine §2, §9).
    ("a test with an unknown comparator", set_expr({"capture": "x", "expr": {"test": "==", "value": {"string": "a"}, "expr": A}})),
    ("a test whose comparator is no string", set_expr({"capture": "x", "expr": {"test": 7, "value": {"string": "a"}, "expr": A}})),
    ("a test of #", set_expr({"seq": [{"capture": "x", "expr": A}, {"test": "=", "value": {"string": "a"}, "expr": {"ref": "#"}}]})),
    ("a test of an optional", set_expr({"seq": [{"capture": "x", "expr": A}, {"test": "=", "value": {"string": "a"}, "expr": {"optional": A}}]})),
    ("a test of a test", set_expr({"capture": "x", "expr": {"test": "=", "value": {"string": "a"}, "expr": {"test": "=", "value": {"string": "a"}, "expr": A}}})),
    ("a test of a capture", set_expr({"test": "=", "value": {"string": "a"}, "expr": {"capture": "x", "expr": A}})),
    ("a test of ε", set_expr({"seq": [{"capture": "x", "expr": A}, {"test": "=", "value": {"string": "a"}, "expr": {"empty": True}}]})),
    ("a test without its symbol", set_expr({"capture": "x", "expr": {"test": "=", "value": {"string": "a"}}})),
    ("a test without its value", set_expr({"capture": "x", "expr": {"test": "=", "expr": A}})),
    ("a test whose string has a comma", set_expr({"capture": "x", "expr": {"test": "=", "value": {"string": "a,b"}, "expr": A}})),
    ("a sound test of a tag set", set_expr({"capture": "x", "expr": {"test": "=", "value": {"tag": "A"}, "expr": A}})),
    ("a tag test of a string", set_expr({"capture": "x", "expr": {"test": "⊇", "value": {"string": "a"}, "expr": A}})),
    ("a test whose value reads a span", set_expr({"capture": "x", "expr": {"test": "⊇", "value": TAGS_X, "expr": A}})),
    ("a test of an empty terminal", set_expr({"capture": "x", "expr": {"test": "=", "value": {"string": "a"}, "expr": {"empty": True, "terminal": "a"}}})),
    ("a test of a reference and a terminal", set_expr({"capture": "x", "expr": {"test": "=", "value": {"string": "a"}, "expr": {"ref": "text", "terminal": "a"}}})),
    ("a tested symbol that is also empty", set_expr({"capture": "x", "expr": {"test": "=", "value": {"string": "a"}, "expr": A, "empty": True}})),
    ("a tested symbol that is also a reference", set_expr({"seq": [{"capture": "x", "expr": A}, {"test": "=", "value": {"string": "a"}, "expr": A, "ref": "text"}]})),
    ("a tested symbol that is also a capture", set_expr({"capture": "x", "test": "=", "value": {"string": "a"}, "expr": A})),
    ("a top-level sequence that is also a tested symbol", set_expr({"seq": [{"capture": "x", "expr": A}, A], "test": "=", "value": {"string": "a"}, "expr": A})),
    ("a tested symbol that is also an optional", set_expr({"seq": [{"capture": "x", "expr": A}, {"optional": A, "test": "=", "value": {"string": "a"}, "expr": {"ref": "#"}}]})),
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
         {"call": "head", "args": [{"capture": "x"}]}, {"tag": []}, {"string": 1}, {"tag": "'\\u{61}'"}, {"capture": "x", "expr": {"ref": "A"}}]
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

    def test_a_bootstrap_term_of_two_forms_is_an_error(self) -> None:
        """A term in the bootstrap that joins the members of two forms, or
        a malformed difference, is a GencmuError."""

        def tagged(term: Any) -> str:
            # Give the first alternative of the bootstrap a tag term.
            bootstrap = json.loads(bundled_text("notation/bootstrap.json") or "{}")
            bootstrap["stages"][0]["documents"][0]["dom"]["rules"][0]["alternatives"][0]["tags"] = term
            return json.dumps(bootstrap)

        def refused(bootstrap: str) -> bool:
            sources = {"p.md": PIPELINE, "g.md": DOCUMENT, "h.md": NEXT, "notation/bootstrap.json": bootstrap}
            try:
                gencmu.load_dialect_sources(sources, "p.md", use_cache=False)
            except gencmu.GencmuError as error:
                return error.document == "notation/bootstrap.json"
            return False

        self.assertFalse(refused(tagged({"tag": "B"})))
        self.assertFalse(refused(tagged({"difference": [{"tag": "B"}, {"tag": "C"}]})))
        for term in (
            {"tag": "!", "string": "x"},
            {"string": "x", "tag": "!"},
            {"difference": [{"tag": "B"}, {"tag": "C"}], "union": [{"tag": "B"}, {"tag": "C"}]},
            {"union": [{"tag": "B"}, {"tag": "C"}], "difference": [{"tag": "B"}, {"tag": "C"}]},
            {"difference": [{"tag": "B"}, {"tag": "C"}], "tag": "B"},
            {"difference": [{"tag": "B"}]},
        ):
            with self.subTest(term=term):
                self.assertTrue(refused(tagged(term)))

    def test_a_refused_bootstrap_test_is_an_error(self) -> None:
        """A test in the bootstrap that the reader would refuse is a
        GencmuError, not a failure inside lowering."""

        def wrap(tested: Callable[[Dom], Dom]) -> str:
            # Test the first plain reference of the bootstrap.
            bootstrap = json.loads(bundled_text("notation/bootstrap.json") or "{}")
            stack: list[Any] = [bootstrap]
            while stack:
                node = stack.pop()
                keys = range(len(node)) if isinstance(node, list) else list(node) if isinstance(node, dict) else []
                for key in keys:
                    value = node[key]
                    if isinstance(value, dict) and len(value) == 1 and isinstance(value.get("ref"), str) and value["ref"] != "#":
                        node[key] = tested(value)
                        return json.dumps(bootstrap)
                    stack.append(value)
            raise AssertionError("the bootstrap has no plain reference")

        def refused(bootstrap: str) -> bool:
            """Whether the bootstrap itself is refused. The notation it
            gives may still fail to read the document."""
            sources = {"p.md": PIPELINE, "g.md": DOCUMENT, "h.md": NEXT, "notation/bootstrap.json": bootstrap}
            try:
                gencmu.load_dialect_sources(sources, "p.md", use_cache=False)
            except gencmu.GencmuError as error:
                return error.document == "notation/bootstrap.json"
            return False

        value = {"string": "a"}
        self.assertFalse(refused(wrap(lambda ref: {"test": "=", "value": value, "expr": ref})))
        for name, tested in (
            ("a comma", lambda ref: {"test": "=", "value": {"string": "a,b"}, "expr": ref}),
            ("an empty reference", lambda ref: {"test": "=", "value": value, "expr": {**ref, "empty": True}}),
            ("a sequence that is also a test", lambda ref: {"seq": [ref, ref], "test": "=", "value": value, "expr": ref}),
        ):
            with self.subTest(what=name):
                self.assertTrue(refused(wrap(tested)))

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
            ("$ twice", set_emit({"items": [{"capture": "", "tags": TAG}, WHOLE]})),
            ("ε", set_emit({"items": []})),
            ("verbatim", lambda dom: rule(dom).update(verbatim=True)),
            ("tags($) in an emitted term", set_emit({"items": [{"capture": "x", "tags": {"call": "tags", "args": [WHOLE]}}]})),
            ("tags($, rule) in an alternative's tags", set_tags({"call": "tags", "args": [WHOLE, {"rule": "text"}]})),
            ("text($) in a guard of an alternative's tags", set_tags({"if": {"op": "=", "left": {"call": "text", "args": [WHOLE]}, "right": STR}, "then": TAG})),
            ("tags(head($)) in an alternative's tags", set_tags({"call": "tags", "args": [{"call": "head", "args": [WHOLE]}]})),
            ("a condition on $", set_condition({"op": "⊆", "left": TAG, "right": {"call": "tags", "args": [WHOLE]}})),
            ("all", set_condition({"all": [SAME, {"not": {"matches": WHOLE, "rule": "text"}}]})),
            ("begins of after($)", set_condition({"begins": {"call": "after", "args": [WHOLE]}, "rule": "text"})),
            ("tags(from($)) in an alternative's tags", set_tags({"call": "tags", "args": [{"call": "from", "args": [WHOLE]}]})),
            ("initial($) in a guard of an alternative's tags", set_tags({"if": {"initial": WHOLE}, "then": TAG})),
            ("# as a rule's name", lambda dom: rule(dom).update(name="#")),
            ("a negated gate", lambda dom: alt(dom).update(guards=[{"feature": "f", "kind": "gate", "negated": True}])),
            ("a warning", lambda dom: alt(dom).update(guards=[{"feature": "w", "kind": "warning", "negated": False}])),
            ("an implication", set_condition({"if": SAME, "then": {"op": "=", "left": TEXT, "right": STR}})),
            ("a presence test that removes an alternative", with_bare_alternative(set_condition({"captured": "x"}))),
            ("a guarded term", with_bare_alternative(set_rule_tags({"union": [TAG, {"if": {"captured": "x"}, "then": TAGS_X}]}))),
            ("a guard reading tags(head($))", set_tags({"if": {"op": "⊆", "left": TAG, "right": {"call": "tags", "args": [{"call": "head", "args": [WHOLE]}]}}, "then": TAG})),
            # Typed terms and conditions (engine §10).
            ("a difference", set_tags({"difference": [TAGS_X, {"union": [TAG, {"tag": "/a/"}]}]})),
            ("⊈", set_condition({"op": "⊈", "left": TAG, "right": TAGS_X})),
            ("a string in a set of strings", set_condition({"op": "∈", "left": TEXT, "right": RUNS})),
            ("∅ compared with a set of strings", set_condition({"op": "=", "left": {"emptySet": True}, "right": RUNS})),
            ("tag of a string", set_tags({"call": "tag", "args": [STR]})),
            ("tag of text", set_tags({"call": "tag", "args": [TEXT]})),
            # The reader cannot know a constant's type, so it fits any value
            # but a span (engine §9).
            ("a constant as a tag set", set_tags({"union": [TAG, {"const": "K", "at": [9, 20]}]})),
            ("constants on both sides of ∈", set_condition({"op": "∈", "left": {"const": "S", "at": [9, 20]}, "right": {"const": "T", "at": [9, 30]}})),
            ("a constant as split's delimiter", set_condition({"op": "∈", "left": TEXT, "right": {"call": "split", "args": [TEXT, {"const": "D", "at": [9, 20]}]}})),
            ("a character tag", set_tags({"union": [{"tag": "'\\u{5C}'"}, {"tag": "'é'"}]})),
            ("an elidable tag", lambda dom: dom["directives"].append({"name": "elidable", "args": ["KU", "ku"], "at": [9, 1]})),
            ("an emitted item dropped where its capture is missing", with_bare_alternative(set_emit({"items": [{"capture": "x"}, {"insert": "Y"}]}))),
        ):
            with self.subTest(what=name):
                dom = copy.deepcopy(self.dom)
                change(dom)
                self.assertIsNone(dom_problem(dom))

    def test_tests(self) -> None:
        """A test in a precompiled DOM is checked as the reader checks it,
        with the lowercase mapping that the match uses (engine §9)."""
        unicode = _unicode_table(bundled_text("unicode.txt") or "")

        def tested(value: Any, expr: Any = A, op: Any = "=") -> Dom:
            return {"test": op, "value": {"string": value} if isinstance(value, str) else value, "expr": expr}

        refusal = "a test follows only a reference other than # or a terminal"
        for name, expr, problem in (
            ("a tested terminal", {"capture": "x", "expr": tested("a")}, None),
            ("a tested reference", {"seq": [{"capture": "x", "expr": A}, tested("la", {"ref": "text"})]}, None),
            ("a repeated tested symbol", {"seq": [{"capture": "x", "expr": A}, {"repeat": tested("a"), "min": 1}]}, None),
            ("an empty string", {"capture": "x", "expr": tested("")}, None),
            ("≠", {"capture": "x", "expr": tested("a", A, "≠")}, None),
            ("∩=∅ of a tag", {"capture": "x", "expr": tested({"tag": "UI"}, A, "∩=∅")}, None),
            ("⊇ of a union with a range, on a range", {"capture": "x", "expr": tested({"union": [{"tag": "UI"}, {"range": ["'a'", "'c'"]}]}, {"range": ["'a'", "'z'"]}, "⊇")}, None),
            ("⊉ of ∅ on a property", {"capture": "x", "expr": tested({"emptySet": True}, {"property": "L"}, "⊉")}, None),
            ("∩≠∅ of a constant", {"capture": "x", "expr": tested({"const": "A", "at": [1, 1]}, A, "∩≠∅")}, None),
            # A string constant is checked by the loader, which knows its value.
            ("= of a constant", {"capture": "x", "expr": tested({"const": "A", "at": [1, 1]})}, None),
            ("an unknown comparator", {"capture": "x", "expr": tested("a", A, "==")}, "a malformed test"),
            ("a comparator that is no string", {"capture": "x", "expr": tested("a", A, 7)}, "a malformed test"),
            ("a string in capitals", {"capture": "x", "expr": tested("La")}, 'the string "La" is not in lower case, which every canonical sound is'),
            ("a Cyrillic capital", {"capture": "x", "expr": tested("Ла")}, 'the string "Ла" is not in lower case, which every canonical sound is'),
            ("a string with a comma", {"capture": "x", "expr": tested("ko,a")}, 'the string "ko,a" holds a comma, which no canonical sound holds'),
            ("a test of #", {"seq": [{"capture": "x", "expr": A}, tested("a", {"ref": "#"})]}, refusal),
            ("a test of a test", {"capture": "x", "expr": tested("a", tested("a"))}, refusal),
            ("a test of ε", {"seq": [{"capture": "x", "expr": A}, tested("a", {"empty": True})]}, refusal),
            ("a test of an empty terminal", {"capture": "x", "expr": tested("a", {"empty": True, "terminal": "a"})}, refusal),
            ("a test of a reference and a terminal", {"capture": "x", "expr": tested("a", {"ref": "text", "terminal": "a"})}, refusal),
            ("a tested symbol that is also empty", {"capture": "x", "expr": {**tested("a"), "empty": True}}, "a malformed expression"),
            ("a test without its value", {"capture": "x", "expr": {"test": "=", "expr": A}}, "a malformed expression"),
        ):
            with self.subTest(what=name):
                dom = copy.deepcopy(self.dom)
                set_expr(expr)(dom)
                self.assertEqual(dom_problem(dom, unicode), problem)
        # A value of the wrong type, or one that is not closed.
        for name, expr in (
            ("= of a tag", tested({"tag": "UI"})),
            ("⊇ of a string", tested("la", A, "⊇")),
            ("⊇ of tags($)", tested({"call": "tags", "args": [{"capture": ""}]}, A, "⊇")),
            ("= of phonemes($)", tested({"call": "phonemes", "args": [{"capture": ""}]})),
            ("= of a capture", tested({"capture": "x"})),
        ):
            with self.subTest(refused=name):
                dom = copy.deepcopy(self.dom)
                set_expr({"capture": "x", "expr": expr})(dom)
                self.assertIsNotNone(dom_problem(dom, unicode))
        dom = copy.deepcopy(self.dom)
        set_expr({"capture": "x", "expr": tested("La")})(dom)
        # An entry with a string in capitals is a miss: the document is read afresh.
        self.assertEqual(self.parse(dom), self.parse(None))
        # A tested symbol is a compound node (engine §9), and its value
        # counts on from its depth.
        for value, most in (("a", 255), ({"union": [{"tag": "A"}, {"tag": "B"}]}, 254)):
            for depth, allowed in ((most, True), (most + 1, False)):
                with self.subTest(value=value, depth=depth):
                    dom = copy.deepcopy(self.dom)
                    deep: Any = tested(value, A, "=" if isinstance(value, str) else "⊇")
                    for _ in range(depth):
                        deep = {"optional": deep}
                    set_expr(deep)(dom)
                    rule(dom)["conditions"] = []
                    rule(dom).pop("tags", None)
                    rule(dom).pop("emit", None)
                    alt(dom).pop("tags", None)
                    self.assertEqual(dom_problem(dom, unicode) is None, allowed, dom_problem(dom, unicode))

    def test_the_unicode_table_keys_the_cache(self) -> None:
        """A document read once with one Unicode table is read again with
        another, since the table decides which strings of sound tests are
        allowed (engine §9)."""
        pipeline = '```jbogenbau\n%stage main\n%include "g.md"\n```\n'
        sources = {"p.md": pipeline, "g.md": '```jbogenbau\n%ambiguity-resolution greedy\n%rule text A="a"\n```\n'}
        gencmu.load_dialect_sources(sources, "p.md")
        # With a in capitals, the string "a" is no longer in lower case.
        table = (bundled_text("unicode.txt") or "").rstrip("\n") + "\nlower 0061 0062\n"
        for use_cache in (False, True):
            with self.subTest(use_cache=use_cache), self.assertRaises(gencmu.GencmuError) as caught:
                gencmu.load_dialect_sources({**sources, "unicode.txt": table}, "p.md", use_cache=use_cache)
            self.assertIn("lower case", str(caught.exception))

    def test_ranges_and_properties(self) -> None:
        """A precompiled range or property is checked as the reader checks
        it (engine §9)."""
        for name, expr, tags in (
            ("a range", {"range": ["'a'", "'z'"]}, None),
            ("a property", {"property": "White_Space"}, None),
            ("captured", {"seq": [{"capture": "c", "expr": {"range": ["'\\u{300}'", "'\\u{36F}'"]}}, {"capture": "d", "expr": {"property": "Cs"}}]}, None),
            ("a range in a term", {"ref": "A"}, {"union": [{"range": ["'a'", "'c'"]}, {"tag": "'x'"}]}),
            # A range or a property is a terminal, and takes a test (engine §2).
            ("a tested range", {"test": "=", "value": {"string": "a"}, "expr": {"range": ["'a'", "'z'"]}}, None),
            ("a tested property", {"test": "∩≠∅", "value": {"tag": "'a'"}, "expr": {"property": "L"}}, None),
        ):
            with self.subTest(allowed=name):
                dom = copy.deepcopy(self.dom)
                set_expr(expr)(dom)
                rule(dom)["conditions"] = []
                rule(dom).pop("tags", None)
                rule(dom).pop("emit", None)
                alt(dom).pop("tags", None)
                if tags is not None:
                    alt(dom)["tags"] = tags
                self.assertIsNone(dom_problem(dom))
        for name, expr, tags in (
            ("a reversed range", {"range": ["'z'", "'a'"]}, None),
            ("a range of one end", {"range": ["'a'"]}, None),
            ("a range whose end is not canonical", {"range": ["'\\u{61}'", "'z'"]}, None),
            ("a range whose end is no character tag", {"range": ["A", "'z'"]}, None),
            ("a range that is also a terminal", {"range": ["'a'", "'z'"], "terminal": "A"}, None),
            ("a long property name", {"property": "Letter"}, None),
            ("a property name in other case", {"property": "lu"}, None),
            ("a property that is also a range", {"property": "L", "range": ["'a'", "'z'"]}, None),
            ("a tested reversed range", {"test": "⊇", "value": {"tag": "'a'"}, "expr": {"range": ["'z'", "'a'"]}}, None),
            ("a tested long property name", {"test": "=", "value": {"string": "a"}, "expr": {"property": "Letter"}}, None),
            ("a property in a term", {"ref": "A"}, {"property": "L"}),
            ("a reversed range in a term", {"ref": "A"}, {"range": ["'z'", "'a'"]}),
        ):
            with self.subTest(refused=name):
                dom = copy.deepcopy(self.dom)
                set_expr(expr)(dom)
                rule(dom)["conditions"] = []
                rule(dom).pop("tags", None)
                rule(dom).pop("emit", None)
                alt(dom).pop("tags", None)
                if tags is not None:
                    alt(dom)["tags"] = tags
                self.assertIsNotNone(dom_problem(dom))
        # An inserted range or property is not one tag.
        dom = copy.deepcopy(self.dom)
        set_emit({"items": [{"insert": "'a'..'z'"}]})(dom)
        self.assertIsNotNone(dom_problem(dom))

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


CLASS_DOCUMENT = "```jbogenbau\n%ambiguity-resolution greedy\n%rule text 'a'..'z' '\\p{L}'\n```\n"
CLASS_PIPELINE = '```jbogenbau\n%stage main\n%include "g.md"\n```\n'


def _class_changes() -> list[tuple[str, Callable[[Dom], None]]]:
    """Malformed range and property nodes, as changes to a DOM whose first
    alternative is a sequence of a range and a property. The reader would
    refuse each (engine §9)."""

    def seq_item(index: int, key: str, value: Any) -> Callable[[Dom], None]:
        def change(dom: Dom) -> None:
            alt(dom)["expr"]["seq"][index][key] = value

        return change

    def beside(key: str, value: Any) -> Callable[[Dom], None]:
        def change(dom: Dom) -> None:
            alt(dom)["expr"][key] = value

        return change

    return [
        ("a reversed range", seq_item(0, "range", ["'b'", "'a'"])),
        ("a range with an end not in its canonical spelling", seq_item(0, "range", ["'\\u{61}'", "'b'"])),
        ("an unknown property", seq_item(1, "property", "Bogus")),
        ("a property in a term", set_tags({"property": "L"})),
        ("a reversed range beside a sequence", beside("range", ["'z'", "'a'"])),
        ("a range beside a sequence", beside("range", ["'a'", "'z'"])),
        ("an unknown property beside a sequence", beside("property", "Bogus")),
        ("a property beside a sequence", beside("property", "L")),
    ]


class CharacterClassLoading(unittest.TestCase):
    """A malformed range or property takes the whole loading path: a
    precompiled one is a miss, and one in the bootstrap is an error."""

    def test_a_precompiled_malformed_range_or_property_is_a_miss(self) -> None:
        sources = {"p.md": CLASS_PIPELINE, "g.md": CLASS_DOCUMENT}
        fresh_result = gencmu.load_dialect_sources(sources, "p.md", use_cache=False).parse("zb", auto_features=False)
        self.assertTrue(fresh_result.ok)
        fresh = gencmu.to_json(fresh_result)
        bootstrap_hash = fnv1a64(bundled_text("notation/bootstrap.json") or "")

        def parse(dom: Dom) -> str:
            documents = {"g.md": {"hash": fnv1a64(CLASS_DOCUMENT), "dom": dom}}
            compiled = json.dumps({"format": DOM_FORMAT, "bootstrap": bootstrap_hash, "documents": documents})
            dialect = gencmu.load_dialect_sources({**sources, "compiled.json": compiled}, "p.md")
            return gencmu.to_json(dialect.parse("zb", auto_features=False))

        # The control: a well-formed entry with the range 'a'..'b' is used in
        # place of the document, and rejects the z. Each broken entry below
        # keeps that range, so an entry used by mistake would reject it too.
        control = read_document(CLASS_DOCUMENT, "g.md")
        alt(control)["expr"]["seq"][0]["range"] = ["'a'", "'b'"]
        self.assertIsNone(dom_problem(control))
        self.assertNotEqual(parse(control), fresh)
        for name, change in _class_changes():
            with self.subTest(refused=name):
                dom = copy.deepcopy(control)
                change(dom)
                self.assertIsNotNone(dom_problem(dom))
                self.assertEqual(parse(dom), fresh)

    def test_a_bootstrap_with_a_malformed_range_or_property_is_an_error(self) -> None:
        def with_rule(change: Callable[[Dom], None] | None) -> str:
            # Put a rule of the shape above first in the bootstrap's first
            # document.
            bootstrap = json.loads(bundled_text("notation/bootstrap.json") or "{}")
            expr = {"seq": [{"range": ["'a'", "'z'"]}, {"property": "L"}]}
            added = {"name": "unused-rule", "op": "define", "alternatives": [{"guards": [], "expr": expr}], "conditions": [], "at": [100000, 1]}
            if change is not None:
                change({"rules": [added]})
            bootstrap["stages"][0]["documents"][0]["dom"]["rules"].insert(0, added)
            return json.dumps(bootstrap)

        def refused(bootstrap: str) -> bool:
            sources = {"p.md": CLASS_PIPELINE, "g.md": CLASS_DOCUMENT, "notation/bootstrap.json": bootstrap}
            try:
                gencmu.load_dialect_sources(sources, "p.md", use_cache=False)
            except gencmu.GencmuError as error:
                return error.document == "notation/bootstrap.json"
            return False

        self.assertFalse(refused(with_rule(None)))
        for name, change in _class_changes():
            with self.subTest(refused=name):
                self.assertTrue(refused(with_rule(change)))



CONSTANT_SOURCES = {
    "p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n',
    "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%const $K ~a ∪ B\n%rule text A <$K>\n```\n",
}


class Constants(unittest.TestCase):
    """A constant's definition and a reference to one in a precompiled or
    bootstrap DOM are checked as the reader checks them (engine §2, §9)."""

    @staticmethod
    def text(constants: list[Dom], conditions: list[Dom] | None = None) -> Dom:
        return {
            "format": DOM_FORMAT,
            "rules": [{"name": "text", "op": "define", "alternatives": [{"guards": [], "expr": {"ref": "A"}}], "conditions": conditions or [], "at": [9, 1]}],
            "directives": [],
            "constants": constants,
            "classifiers": [],
            "implications": [],
        }

    @staticmethod
    def constant(value: Any, **extra: Any) -> Dom:
        return {"name": "K", "op": "define", "value": value, "at": [1, 1], **extra}

    def test_a_precompiled_constant_is_checked(self) -> None:
        text, constant = self.text, self.constant
        self.assertIsNone(dom_problem(text([constant({"tag": "a"})])))
        split = {"call": "split", "args": [{"string": "a.b"}, {"const": "K", "at": [2, 20]}]}
        self.assertIsNone(dom_problem(text([constant({"string": "."}), constant(split, name="S", at=[2, 1])])))
        self.assertIsNone(dom_problem(text([constant({"emptySet": True}, op="redefine")])))
        self.assertEqual(dom_problem({"format": DOM_FORMAT, "rules": [], "directives": []}), f"not a DOM of format {DOM_FORMAT}")
        for extra in ({"name": "k"}, {"op": "extend"}, {"at": None}, {"extra": True}):
            with self.subTest(extra=extra):
                self.assertEqual(dom_problem(text([constant({"tag": "a"}, **extra)])), "a malformed constant")
        for value in ({"capture": "x"}, {"call": "phonemes", "args": [{"capture": "x"}]}, {"if": {"captured": "x"}, "then": {"tag": "a"}}):
            with self.subTest(value=value):
                self.assertEqual(dom_problem(text([constant(value)])), "a constant's value is not a closed term")
        self.assertIn("not given", str(dom_problem(text([constant({"emptySet": True})]))))
        self.assertIn("joins sets", str(dom_problem(text([constant({"union": [{"string": "a"}, {"tag": "b"}]})]))))
        empty = {"call": "split", "args": [{"string": "a"}, {"string": ""}]}
        self.assertEqual(dom_problem(text([constant(empty)])), "split has an empty delimiter")
        # Two items at one position, a constant among them.
        self.assertEqual(dom_problem(text([constant({"tag": "a"}, at=[9, 1])])), "two items at one position")

    def test_a_precompiled_constant_serves_the_parse(self) -> None:
        """A cached DOM holds the constant, and the loader gives it its
        value; one that holds a value, or a malformed definition, is a
        miss, and the document is read instead (engine §2, §8)."""
        token = [Token("a", frozenset(["A"]), (0, 1), (0, 1), None)]
        fresh = gencmu.load_dialect_sources(CONSTANT_SOURCES, "p.md", use_cache=False)
        expected = fresh.parse_tokens(token, "a", auto_features=False)
        assert expected.tree is not None
        self.assertEqual(sorted(expected.tree.tags), ["B", "a"])
        dom = read_document(CONSTANT_SOURCES["g.md"], "g.md")
        self.assertEqual(dom["constants"], [{"name": "K", "op": "define", "value": {"union": [{"tag": "a"}, {"tag": "B"}]}, "at": [3, 1]}])
        bootstrap_hash = fnv1a64(bundled_text("notation/bootstrap.json") or "")

        def parse(entry: Dom) -> str:
            documents = {"g.md": {"hash": fnv1a64(CONSTANT_SOURCES["g.md"]), "dom": entry}}
            compiled = json.dumps({"format": DOM_FORMAT, "bootstrap": bootstrap_hash, "documents": documents})
            dialect = gencmu.load_dialect_sources({**CONSTANT_SOURCES, "compiled.json": compiled}, "p.md")
            return gencmu.to_json(dialect.parse_tokens(token, "a", auto_features=False))

        # The control: an entry whose constant is ~c is used in place of the
        # document.
        control = copy.deepcopy(dom)
        control["constants"][0]["value"] = {"tag": "c"}
        self.assertIn('"tags":["c"]', parse(control))
        self.assertEqual(parse(dom), gencmu.to_json(expected))
        valued = copy.deepcopy(control)
        alt(valued)["tags"] = {"const": "K", "at": [4, 15], "value": ["a"]}
        opened = copy.deepcopy(control)
        opened["constants"][0]["value"] = {"capture": "x"}
        missing = copy.deepcopy(control)
        del missing["constants"]
        for bad in (valued, opened, missing):
            with self.subTest(bad=bad):
                self.assertIsNotNone(dom_problem(bad))
                self.assertEqual(parse(bad), gencmu.to_json(expected))

    def test_a_bootstrap_with_a_malformed_constant_is_an_error(self) -> None:
        bootstrap = json.loads(bundled_text("notation/bootstrap.json") or "{}")
        bootstrap["stages"][0]["documents"][0]["dom"]["constants"].append({"name": "k", "op": "define", "value": {"tag": "a"}, "at": [1, 1]})
        with self.assertRaisesRegex(gencmu.GencmuError, "malformed constant") as caught:
            gencmu.load_dialect_sources({**CONSTANT_SOURCES, "notation/bootstrap.json": json.dumps(bootstrap)}, "p.md", use_cache=False)
        self.assertEqual(caught.exception.kind, "grammar")

    @staticmethod
    def deep_value_json(depth: int) -> str:
        """A constant's value nested `depth` unions deep, as JSON text: deeper
        than a walk that recursed could follow, and shallower than json.loads
        can."""
        return '{"union":[' * depth + '{"tag":"a"}' + ',{"tag":"B"}]}' * depth

    def test_a_precompiled_constant_nested_too_deeply_is_a_miss(self) -> None:
        """The bound on nesting holds before any walk that recurses (engine
        §9), so the entry is a miss and the document is read instead."""
        token = [Token("a", frozenset(["A"]), (0, 1), (0, 1), None)]
        fresh = gencmu.load_dialect_sources(CONSTANT_SOURCES, "p.md", use_cache=False)
        expected = gencmu.to_json(fresh.parse_tokens(token, "a", auto_features=False))
        dom = read_document(CONSTANT_SOURCES["g.md"], "g.md")
        dom["constants"][0]["value"] = "@VALUE@"
        deep = json.dumps(dom).replace('"@VALUE@"', self.deep_value_json(2000))
        try:
            parsed = json.loads(deep)
        except RecursionError:
            # Before Python 3.12, json.loads cannot follow this depth, and the
            # loader then treats the whole compiled.json as unreadable.
            parsed = None
        if parsed is not None:
            self.assertEqual(dom_problem(parsed), "nested too deeply")
        bootstrap_hash = fnv1a64(bundled_text("notation/bootstrap.json") or "")
        compiled = (
            f'{{"format":{DOM_FORMAT},"bootstrap":"{bootstrap_hash}",'
            f'"documents":{{"g.md":{{"hash":"{fnv1a64(CONSTANT_SOURCES["g.md"])}","dom":{deep}}}}}}}'
        )
        dialect = gencmu.load_dialect_sources({**CONSTANT_SOURCES, "compiled.json": compiled}, "p.md")
        self.assertEqual(gencmu.to_json(dialect.parse_tokens(token, "a", auto_features=False)), expected)

    def test_a_bootstrap_constant_nested_too_deeply_is_an_error(self) -> None:
        """The bound on nesting holds before any walk that recurses (engine
        §9), so the bootstrap is an error of the grammar."""
        bootstrap = json.loads(bundled_text("notation/bootstrap.json") or "{}")
        bootstrap["stages"][0]["documents"][0]["dom"]["constants"].append({"name": "K", "op": "define", "value": "@VALUE@", "at": [99999, 1]})
        text = json.dumps(bootstrap).replace('"@VALUE@"', self.deep_value_json(2000))
        # Before Python 3.12, json.loads cannot follow this depth, and the
        # bootstrap is then an error because it is not JSON.
        with self.assertRaisesRegex(gencmu.GencmuError, "nested too deeply|is not JSON") as caught:
            gencmu.load_dialect_sources({**CONSTANT_SOURCES, "notation/bootstrap.json": text}, "p.md", use_cache=False)
        self.assertEqual(caught.exception.kind, "grammar")

    def test_a_precompiled_clause_with_a_constant_waits_for_its_value(self) -> None:
        """A cached DOM whose capture checks wait for a constant's value is
        used, and the loader makes the checks once the constants have their
        values (engine §3.6, §9)."""
        token = [Token("a", frozenset(["A"]), (0, 1), (0, 1), None)]
        bootstrap_hash = fnv1a64(bundled_text("notation/bootstrap.json") or "")

        def document(first: str, last: str) -> str:
            return (
                f"```jbogenbau\n%ambiguity-resolution greedy\n%const $E {first}\n%rule text A | $x(A)\n"
                f"%tags Y ∪ ($E ∩ tags($x))\n%redefine-const $E {last}\n```\n"
            )

        def outcome(text: str, entry: Dom | None) -> Any:
            sources = {**CONSTANT_SOURCES, "g.md": text}
            if entry is not None:
                documents = {"g.md": {"hash": fnv1a64(text), "dom": entry}}
                sources["compiled.json"] = json.dumps({"format": DOM_FORMAT, "bootstrap": bootstrap_hash, "documents": documents})
            try:
                dialect = gencmu.load_dialect_sources(sources, "p.md", use_cache=entry is not None)
            except gencmu.GencmuError as error:
                return (error.line, error.column)
            result = dialect.parse_tokens(token, "a", auto_features=False)
            assert result.tree is not None
            return sorted(result.tree.tags)

        empty = document("B", "$E ∖ B")
        dom = read_document(empty, "g.md")
        self.assertIsNone(dom_problem(dom))
        self.assertEqual(outcome(empty, None), ["Y"])
        self.assertEqual(outcome(empty, dom), ["Y"])
        # A hit: the entry, changed, is the one the parse sees.
        changed = json.loads(json.dumps(dom).replace('{"tag": "Y"}', '{"tag": "Z"}'))
        self.assertNotEqual(changed, dom)
        self.assertEqual(outcome(empty, changed), ["Z"])
        full = document("B ∖ B", "B")
        dom = read_document(full, "g.md")
        self.assertIsNone(dom_problem(dom))
        self.assertEqual(outcome(full, None), (4, 1))
        self.assertEqual(outcome(full, dom), (4, 1))

    def test_lexical_tokens(self) -> None:
        """The notation's lexical stage tags constants and the keywords that
        define them (grammars/notation/lexical.md)."""
        notation = gencmu.load_dialect("notation")
        result = notation.parse("%const $SU-STOPS %redefine-const $x $ $K1", until="lexical", auto_features=False)
        output = result.stages[0].output
        assert output is not None
        self.assertEqual(
            [(token.text, sorted(token.tags)) for token in output],
            [
                ("%const", ["keyword-const"]),
                ("$SU-STOPS", ["constant"]),
                ("%redefine-const", ["keyword-redefine-const"]),
                ("$x", ["capture"]),
                ("$", ["capture"]),
                ("$K1", ["constant"]),
            ],
        )



class Classifiers(unittest.TestCase):
    """A classifier, an implication and a call of classify in a precompiled
    or bootstrap DOM are checked as the reader checks them (engine §9)."""

    @staticmethod
    def dom(classifiers: list[Dom], implications: list[Dom] | None = None) -> Dom:
        return {
            "format": DOM_FORMAT,
            "rules": [],
            "directives": [],
            "constants": [],
            "classifiers": classifiers,
            "implications": implications or [],
        }

    @staticmethod
    def entry(**extra: Any) -> Dom:
        return {"guards": [], "keys": ["mi"], "op": "∈", "class": "KOhA", "at": [3, 3], **extra}

    @staticmethod
    def classifier(entries: list[Dom], **extra: Any) -> Dom:
        return {"name": "lex", "entries": entries, "at": [2, 1], **extra}

    @staticmethod
    def implication(**extra: Any) -> Dom:
        return {"if": {"tag": "UI"}, "then": {"tag": "indicator"}, "at": [5, 1], **extra}

    def test_a_precompiled_classifier_is_checked(self) -> None:
        dom, entry, classifier = self.dom, self.entry, self.classifier
        negated = entry(guards=[{"feature": "f", "kind": "gate", "negated": True}], op="∉", at=[4, 3])
        self.assertIsNone(dom_problem(dom([classifier([entry(), negated])])))
        self.assertIsNone(dom_problem(dom([classifier([])])))
        self.assertEqual(
            dom_problem({"format": DOM_FORMAT, "rules": [], "directives": [], "constants": []}), f"not a DOM of format {DOM_FORMAT}"
        )
        for bad in [classifier([], name="Lex"), classifier([], at=None), classifier([], extra=True)]:
            self.assertEqual(dom_problem(dom([bad])), "a malformed classifier", json.dumps(bad))
        for bad_entry in [
            entry(guards=[{"feature": "f", "kind": "warning", "negated": False}]),
            entry(keys=[]),
            entry(keys=["Mi"]),
            entry(keys=["m,i"]),
            entry(keys=[1]),
            entry(op="="),
            entry(**{"class": "koha"}),
            entry(**{"class": "/a/"}),
            entry(extra=True),
        ]:
            self.assertEqual(dom_problem(dom([classifier([bad_entry])])), "a malformed entry of a classifier", json.dumps(bad_entry))

    def test_a_precompiled_implication_is_checked(self) -> None:
        dom, implication = self.dom, self.implication
        self.assertIsNone(dom_problem(dom([], [implication(**{"if": {"union": [{"tag": "UI"}, {"const": "K", "at": [5, 15]}]}})])))
        self.assertEqual(dom_problem(dom([], [implication(at=None)])), "a malformed implication")
        self.assertEqual(dom_problem(dom([], [implication(extra=True)])), "a malformed implication")
        self.assertEqual(dom_problem(dom([], [implication(then={"capture": "x"})])), "a side of an implication is not a closed term")
        classify = {"call": "classify", "args": [{"string": "mi"}, {"classifier": "lex"}]}
        self.assertEqual(dom_problem(dom([], [implication(**{"if": classify})])), "a side of an implication is not a closed term")
        self.assertIn("a side of an implication is a tag set", dom_problem(dom([], [implication(then={"string": "a"})])) or "")
        # Two items at one position, a classifier and an implication among
        # them.
        self.assertEqual(dom_problem(dom([self.classifier([])], [implication(at=[2, 1])])), "two items at one position")

    def test_a_precompiled_classify_names_a_classifier(self) -> None:
        def call(args: list[Dom]) -> Dom:
            alternative = {"guards": [], "expr": {"capture": "w", "expr": {"ref": "W"}}, "tags": {"call": "classify", "args": args}}
            return {
                **self.dom([]),
                "rules": [{"name": "text", "op": "define", "alternatives": [alternative], "conditions": [], "at": [1, 1]}],
            }

        sound = {"call": "phonemes", "args": [{"capture": "w"}]}
        self.assertIsNone(dom_problem(call([sound, {"classifier": "lex"}])))
        self.assertEqual(dom_problem(call([sound, {"rule": "lex"}])), "a malformed term")
        self.assertEqual(dom_problem(call([sound, {"classifier": "Lex"}])), "a malformed term")
        self.assertEqual(dom_problem(call([{"capture": "w"}, {"classifier": "lex"}])), "a malformed term")

    def test_a_bootstrap_with_a_malformed_classifier_is_an_error(self) -> None:
        bootstrap = json.loads(bundled_text("notation/bootstrap.json") or "{}")
        bad = {"guards": [], "keys": ["Mi"], "op": "∈", "class": "KOhA", "at": [9999, 3]}
        bootstrap["stages"][0]["documents"][0]["dom"]["classifiers"].append({"name": "lex", "entries": [bad], "at": [9999, 1]})
        with self.assertRaises(gencmu.GencmuError) as caught:
            gencmu.load_dialect_sources({**CONSTANT_SOURCES, "notation/bootstrap.json": json.dumps(bootstrap)}, "p.md", use_cache=False)
        self.assertEqual(caught.exception.kind, "grammar")
        self.assertIn("malformed entry of a classifier", str(caught.exception))

    def test_a_classifier_name_stands_only_in_classify(self) -> None:
        """A classifier's name is only the second argument of classify
        (engine §9). Elsewhere it makes a cached entry a miss and a bootstrap
        an error of the grammar."""
        misplaced = [
            {"op": "⊆", "left": {"call": "tag", "args": [{"classifier": "lex"}]}, "right": {"tag": "a"}},
            {"op": "∈", "left": {"string": "a"}, "right": {"call": "split", "args": [{"classifier": "lex"}, {"string": "."}]}},
            {"op": "∈", "left": {"string": "a"}, "right": {"call": "split", "args": [{"string": "a.b"}, {"classifier": "lex"}]}},
        ]
        well_formed = {"op": "∈", "left": {"string": "a"}, "right": {"call": "split", "args": [{"string": "a.b"}, {"string": "."}]}}
        self.assert_refused(well_formed, misplaced, "a malformed term")

    def test_a_gate_of_an_entry_names_a_feature(self) -> None:
        """A gate of a classifier's entry follows the notation's name syntax
        (engine §9). A cached entry with another feature is a miss, so it
        never changes the dialect's features."""

        def gate(feature: str) -> Dom:
            return {"feature": feature, "kind": "gate", "negated": False}

        refused = [gate(""), gate("!"), gate("bad name")]
        self.assert_refused(gate("f"), refused, "a malformed entry of a classifier", slot="entry")

    def test_a_guard_of_an_alternative_names_a_feature(self) -> None:
        """A guard of a rule's alternative, a gate or a warning, follows the
        notation's name syntax (engine §9). A cached entry with another
        feature is a miss, so it never changes the dialect's features."""
        for kind in ("gate", "warning"):

            def guard(feature: str) -> Dom:
                return {"feature": feature, "kind": kind, "negated": False}

            with self.subTest(kind=kind):
                refused = [guard(""), guard("!"), guard("bad name")]
                self.assert_refused(guard("f"), refused, "a malformed alternative", slot="alternative")

    def assert_refused(self, well_formed: Dom, refused: list[Dom], problem: str, *, slot: str = "condition") -> None:
        """Each of ``refused`` is refused by the check, makes a cached entry a
        miss, and makes a bootstrap an error of the grammar. ``well_formed``
        passes the check. Each stands in ``slot``: a condition of the rule
        ``text``, a guard of its alternative, or a gate of an entry of its
        classifier."""
        guard = slot != "condition"
        sources = {"p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n', "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text A\n```\n"}
        bootstrap_hash = fnv1a64(bundled_text("notation/bootstrap.json") or "")
        token = gencmu.Token("a", frozenset({"A"}), (0, 1), (0, 1))

        def text_rule(part: Dom, name: str = "text", at: list[int] | None = None) -> Dom:
            guards = [part] if slot == "alternative" else []
            alternative = {"guards": guards, "expr": {"capture": "x", "expr": {"ref": "A"}}}
            conditions = [part] if slot == "condition" else []
            return {"name": name, "op": "define", "alternatives": [alternative], "conditions": conditions, "at": at or [3, 1]}

        def classifier(part: Dom, at: list[int]) -> Dom:
            guards = [part] if slot == "entry" else []
            entry = {"guards": guards, "keys": ["mi"], "op": "∈", "class": "KOhA", "at": [at[0], 3]}
            return {"name": "lex", "entries": [entry], "at": at}

        def dom(part: Dom) -> Dom:
            return {
                "format": DOM_FORMAT,
                "rules": [text_rule(part)],
                "directives": [{"name": "ambiguity-resolution", "args": ["greedy"], "at": [2, 1]}],
                "constants": [],
                "classifiers": [classifier(part, [4, 1])],
                "implications": [],
            }

        def cached(part: Dom) -> gencmu.Dialect:
            documents = {"g.md": {"hash": fnv1a64(sources["g.md"]), "dom": dom(part)}}
            compiled = json.dumps({"format": DOM_FORMAT, "bootstrap": bootstrap_hash, "documents": documents})
            return gencmu.load_dialect_sources({**sources, "compiled.json": compiled}, "p.md")

        self.assertIsNone(dom_problem(dom(well_formed)))
        if guard:
            # The control: the well-formed entry is used, and its guard is a
            # feature of the dialect.
            features = [(feature.name, feature.kind) for feature in cached(well_formed).features]
            self.assertEqual(features, [(well_formed["feature"], well_formed["kind"])])
        for part in refused:
            with self.subTest(refused=json.dumps(part, ensure_ascii=False)):
                found = dom_problem(dom(part)) or ""
                self.assertIn(problem, found)
                dialect = cached(part)
                self.assertTrue(dialect.parse_tokens([token], "a", auto_features=False).ok, "the document was read instead")
                self.assertEqual(dialect.features, (), "no feature of the refused entry")
                bootstrap = json.loads(bundled_text("notation/bootstrap.json") or "{}")
                first = bootstrap["stages"][0]["documents"][0]["dom"]
                if slot == "entry":
                    first["classifiers"].append(classifier(part, [9999, 1]))
                else:
                    first["rules"].append(text_rule(part, "refused-part", [9999, 1]))
                with self.assertRaises(gencmu.GencmuError) as caught:
                    gencmu.load_dialect_sources({**sources, "notation/bootstrap.json": json.dumps(bootstrap)}, "p.md", use_cache=False)
                self.assertEqual(caught.exception.kind, "grammar")
                self.assertIn(problem, str(caught.exception))

    def test_lexical_tokens(self) -> None:
        """The notation's lexical stage tags the keywords of classifiers and
        implications (grammars/notation/lexical.md)."""
        notation = gencmu.load_dialect("notation")
        result = notation.parse("%classifier %implies %classifiers", until="lexical", auto_features=False)
        output = result.stages[0].output
        assert output is not None
        self.assertEqual(
            [(token.text, sorted(token.tags)) for token in output],
            [("%classifier", ["keyword-classifier"]), ("%implies", ["keyword-implies"]), ("%classifiers", ["keyword"])],
        )

    def test_the_reader_refuses(self) -> None:
        """A document that the reader refuses, read fresh or from its DOM."""
        for refused in [
            '%classifier Lex "a" ∈ A',
            '%classifier l f! "a" ∈ A',
            '%classifier l "A" ∈ A',
            '%classifier l "a,b" ∈ A',
            '%classifier l "a" ∈ ~a',
            '%implies A ⟹ "a"',
            "%implies tags($x) ⟹ A",
            '%implies classify("a", l) ⟹ A',
        ]:
            with self.subTest(refused=refused), self.assertRaises(gencmu.GencmuError):
                read_document("```jbogenbau\n" + refused + "\n```\n", "t.md")

if __name__ == "__main__":
    unittest.main()
