"""A bootstrap of another notation gives the reader a tree of another
shape (engine §9). Every library reads through a wrapper, and needs the
parts of each rule that it knows. tests/notation-shapes.json holds the
outcome that every library gives."""

from __future__ import annotations

import json
import unittest
from typing import Any, Callable

import gencmu

from .shared import SHARED, REPOSITORY, find_places, load_json, read_json, substitute

SHAPES: dict[str, Any] = load_json(SHARED / "notation-shapes.json")
with open(REPOSITORY / "data/preparsed/gencmu.json", encoding="utf-8") as _file:
    BOOTSTRAP = _file.read()
SYNTAX_AT = BOOTSTRAP.index('"grammars/gencmu/jbogenbau/syntax.md":')
NAMES = [rule["name"] for rule in read_json(BOOTSTRAP)["documents"]["grammars/gencmu/jbogenbau/syntax.md"]["dom"]["rules"] if rule["name"] != "text"]


def outcome(bootstrap: str, document: str | None = None, inputs: list[str] | None = None, where: dict[str, Any] | None = None) -> Any:
    """Loads a document with a bootstrap, and parses each input: its
    brackets, or the kind of its error. A load that fails gives the kind of
    its error, and must fail at ``where`` where an item gives it
    (tests/README.md). Any other exception escapes, and fails the test."""
    document = SHAPES["document"] if document is None else document
    inputs = SHAPES["inputs"] if inputs is None else inputs
    sources = {"p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n', "g.md": document, "data/preparsed/gencmu.json": bootstrap}
    try:
        dialect = gencmu.load_dialect_sources(sources, "p.md", use_cache=False)
    except gencmu.GencmuError as error:
        if where is not None:
            found = {"document": error.document, "line": error.line, "column": error.column}
            assert found == where, f"{error}: expected the error at {where}"
        return error.kind
    assert where is None, "the document loaded, but the item gives where its error stands"
    results = []
    for text in inputs:
        result = dialect.parse(text)
        if result.ok:
            results.append(gencmu.to_brackets(result))
        else:
            assert result.error is not None
            results.append(result.error.kind)
    return results


def with_syntax(change: Callable[[str], str]) -> str:
    """The bundled bootstrap with ``change`` made to its syntax document only."""
    return BOOTSTRAP[:SYNTAX_AT] + change(BOOTSTRAP[SYNTAX_AT:])


class NotationShapes(unittest.TestCase):
    def test_an_empty_leading_wrapper_preserves_the_guard_position(self) -> None:
        parsed = json.loads(BOOTSTRAP)
        documents = {path:entry["dom"] for path,entry in parsed["documents"].items()}
        lexical = documents["grammars/gencmu/jbogenbau/lexical.md"]
        next(rule for rule in lexical["rules"] if rule["name"] == "feature-character")["alternatives"].append(
            {"guards": [], "expr": {"literal": {"string": "_"}}}
        )
        syntax = documents["grammars/gencmu/jbogenbau/syntax.md"]
        next(rule for rule in syntax["rules"] if rule["name"] == "guard")["alternatives"][0]["expr"] = {
            "seq": [{"ref": "padding"}, {"ref": "Guard"}]
        }
        syntax["rules"].append({
            "name": "padding", "op": "define", "flags": [],
            "alternatives": [{"guards": [], "expr": {"empty": True}}],
            "conditions": [], "at": [1, 1],
        })
        bootstrap = json.dumps(parsed, ensure_ascii=False)
        document = '```jbogenbau\n%ambiguity-resolution greedy\n%rule text bad_name? A\n```\n'
        self.assertEqual(outcome(bootstrap, document, [], {"document": "g.md", "line": 3, "column": 12}), "grammar")

    def test_empty_constructor_positions_use_their_token_boundary(self) -> None:
        from gencmu._dom import DomBuilder
        from gencmu._markdown import jbogenbau_text
        from gencmu._unicode import UnicodeTable

        tokens = [gencmu.Token("a", frozenset(), (0, 1), (0, 1)), gencmu.Token("b", frozenset(), (1, 2), (2, 3))]
        builder = DomBuilder(tokens, jbogenbau_text('```jbogenbau\na b   \n```'), "g.md", UnicodeTable("unicode 0.0.0\n"))
        for boundary, column in ((1, 3), (2, 4)):
            with self.subTest(boundary=boundary):
                node = gencmu.Node("rule", (boundary, boundary), (0, 0), rule="padding")
                self.assertEqual(builder.position(node), (2, column))
        builder.tokens = []
        self.assertEqual(builder.position(gencmu.Node("rule", (0, 0), (0, 0), rule="padding")), (2, 1))

    def test_a_notation_stage_that_declares_elision_only_runs_the_check(self) -> None:
        """Each notation stage runs the check of elision-only where its own
        directive declares it (engine §8). With greedy and elision-only on
        the lexical stage, the check finds the ambiguity that greedy settled
        in `...`, which is also three `.`, and the document does not load."""
        parsed = json.loads(BOOTSTRAP)
        lexical_dom = parsed["documents"]["grammars/gencmu/jbogenbau/lexical.md"]["dom"]
        next(r for r in lexical_dom["rules"] if r["name"] == "symbol")["alternatives"].append(
            {"guards": [], "expr": {"literal": {"string": "."}}}
        )
        bootstrap = json.dumps(parsed, separators=(",", ":"), ensure_ascii=False)
        directive = '"name":"ambiguity-resolution","args":["greedy"]'
        lexical = bootstrap.index('"grammars/gencmu/jbogenbau/lexical.md":')
        at = bootstrap.index(directive)
        self.assertTrue(lexical < at < bootstrap.index('"grammars/gencmu/jbogenbau/syntax.md":'), "the first directive is the lexical stage's")
        elision = bootstrap.replace(directive, '"name":"ambiguity-resolution","args":["greedy","elision-only"]', 1)

        def sources(bootstrap: str) -> dict[str, str]:
            return {
                "p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n',
                "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text {...B}\n```\n",
                "data/preparsed/gencmu.json": bootstrap,
            }

        # The bundled bootstrap loads the same documents.
        gencmu.load_dialect_sources(sources(bootstrap), "p.md", use_cache=False)
        with self.assertRaises(gencmu.GencmuError) as raised:
            gencmu.load_dialect_sources(sources(elision), "p.md", use_cache=False)
        self.assertEqual(raised.exception.kind, "grammar")
        self.assertIsNone(raised.exception.line)
        self.assertIn("lexical stage of the notation", raised.exception.message)

    def test_the_bundled_bootstrap_gives_the_control(self) -> None:
        self.assertEqual(outcome(BOOTSTRAP), SHAPES["control"])

    def test_a_wrapper_around_each_rule_changes_nothing(self) -> None:
        def wrap(syntax: str) -> str:
            for name in NAMES:
                syntax = syntax.replace(f'{{"ref":"{name}"}}', f'{{"ref":"{name}-wrapper"}}')
            wrappers = "".join(
                f'{{"name":"{name}-wrapper","op":"define","flags":[],"alternatives":[{{"guards":[],"expr":{{"ref":"{name}"}}}}],'
                f'"conditions":[],"at":[{100000 + index},1]}},'
                for index, name in enumerate(NAMES)
            )
            return syntax.replace('"rules":[', '"rules":[' + wrappers, 1)

        self.assertEqual(outcome(with_syntax(wrap)), SHAPES["control"])

    def test_each_renamed_rule_gives_the_outcome_of_every_library(self) -> None:
        for name in NAMES:

            def rename(syntax: str, name: str = name) -> str:
                return syntax.replace(f'"name":"{name}","op"', f'"name":"{name}x","op"').replace(
                    f'{{"ref":"{name}"}}', f'{{"ref":"{name}x"}}'
                )

            with self.subTest(rule=name):
                self.assertEqual(outcome(with_syntax(rename)), SHAPES["loads"].get(name, "grammar"))
        for name in SHAPES["loads"]:
            self.assertIn(name, NAMES)

    def test_a_part_that_the_reader_does_not_read_is_ignored(self) -> None:
        for item in SHAPES["extraParts"]:
            with self.subTest(item["description"]):
                self.assertEqual(len(find_places(BOOTSTRAP, item["find"])), 1)
                changed = substitute(BOOTSTRAP, item["find"], item["replace"])
                self.assertEqual(outcome(changed, item["document"], item["inputs"], item.get("where")), item["expect"])
