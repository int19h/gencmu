"""A bootstrap of another notation gives the reader a tree of another
shape (engine §9). Every library reads through a wrapper, and needs the
parts of each rule that it knows. tests/notation-shapes.json holds the
outcome that every library gives."""

from __future__ import annotations

import json
import unittest
from unittest.mock import patch
from typing import Any, Callable

import gencmu

from .shared import SHARED, REPOSITORY, find_places, load_json, read_json, same_json, substitute

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
        pipeline = gencmu.load_pipeline_sources(sources, "p.md", use_cache=False)
    except gencmu.GencmuError as error:
        if where is not None:
            found = {"document": error.document, "line": error.line, "column": error.column}
            assert same_json(found, where), f"{error}: expected the error at {where}"
        return error.kind
    assert where is None, "the document loaded, but the item gives where its error stands"
    results = []
    for text in inputs:
        result = pipeline.parse(text)
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
    def test_actual_error_coordinates_keep_their_json_types(self) -> None:
        where = {"document": "g.md", "line": 1, "column": 1}
        for line, column in ((1, 1), (True, 1), (1, True)):
            error = gencmu.GencmuError("reason", document="g.md", line=line, column=column)
            with self.subTest(line=line, column=column), patch.object(gencmu, "load_pipeline_sources", side_effect=error):
                if type(line) is int and type(column) is int:
                    self.assertEqual(outcome("", where=where), "grammar")
                else:
                    with self.assertRaises(AssertionError):
                        outcome("", where=where)

    def test_a_headless_rule_requires_its_rule_name(self) -> None:
        case = next(item for item in SHAPES["extraParts"] if item["description"] == "A headless rule reports its missing rule-name.")
        with self.assertRaisesRegex(gencmu.GencmuError, "the notation's rule has no rule-name"):
            gencmu.load_pipeline_sources({
                "p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n',
                "g.md": case["document"],
                "data/preparsed/gencmu.json": BOOTSTRAP.replace(case["find"], case["replace"]),
            }, "p.md")

    def test_a_supplied_ranked_choice_error_has_no_syntax_code(self) -> None:
        bootstrap = BOOTSTRAP.replace(
            '{"seq":[{"ref":"conjunction"},{"literal":{"string":"≻"}},{"repeat":{"ref":"conjunction"},"separator":{"literal":{"string":"≻"}}}]}',
            '{"literal":{"string":"."}}',
        )
        with self.assertRaises(gencmu.GencmuError) as caught:
            gencmu.load_pipeline_sources({
                "p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n',
                "g.md": '```jbogenbau\n%rule text .\n```\n',
                "data/preparsed/gencmu.json": bootstrap,
            }, "p.md")
        self.assertIsNone(caught.exception.code)

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
            "name": "padding", "op": "define", "categories": [],
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
        builder = DomBuilder(tokens, jbogenbau_text('```jbogenbau\na b   \n```', UnicodeTable("unicode 0.0.0\n")), "g.md", UnicodeTable("unicode 0.0.0\n"), lambda *_: self.fail("the position test decodes no string"))
        for boundary, column in ((1, 3), (2, 4)):
            with self.subTest(boundary=boundary):
                node = gencmu.Node("rule", (boundary, boundary), (0, 0), rule="padding")
                self.assertEqual(builder.position(node), (2, column))
        builder.tokens = []
        self.assertEqual(builder.position(gencmu.Node("rule", (0, 0), (0, 0), rule="padding")), (2, 1))

    def test_a_notation_stage_that_declares_elision_only_runs_the_check(self) -> None:
        """Each notation stage runs the check of elision-only where its own
        %elision-only declares it (engine §8). With greedy and elision-only on
        the lexical stage, the check finds the ambiguity that greedy settled
        in `...`, which is also three `.`, and the document does not load."""
        parsed = json.loads(BOOTSTRAP)
        lexical_dom = parsed["documents"]["grammars/gencmu/jbogenbau/lexical.md"]["dom"]
        next(r for r in lexical_dom["rules"] if r["name"] == "symbol")["alternatives"].append(
            {"guards": [], "expr": {"literal": {"string": "."}}}
        )
        bootstrap = json.dumps(parsed, separators=(",", ":"), ensure_ascii=False)
        directive = next(item for item in lexical_dom["directives"] if item["name"] == "ambiguity-resolution")
        self.assertEqual(directive["steps"], [{"step": "greedy"}])
        lexical_dom["directives"].append({"name": "elision-only", "args": [], "at": [directive["at"][0], directive["at"][1] + 40]})
        elision = json.dumps(parsed, separators=(",", ":"), ensure_ascii=False)

        def sources(bootstrap: str) -> dict[str, str]:
            return {
                "p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n',
                "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text {...B}\n```\n",
                "data/preparsed/gencmu.json": bootstrap,
            }

        # The bundled bootstrap loads the same documents.
        gencmu.load_pipeline_sources(sources(bootstrap), "p.md", use_cache=False)
        with self.assertRaises(gencmu.GencmuError) as raised:
            gencmu.load_pipeline_sources(sources(elision), "p.md", use_cache=False)
        self.assertEqual(raised.exception.kind, "grammar")
        self.assertIsNone(raised.exception.line)
        self.assertIn("lexical stage of the notation", raised.exception.message)

    def test_the_bundled_bootstrap_gives_the_control(self) -> None:
        self.assertTrue(same_json(outcome(BOOTSTRAP), SHAPES["control"]))

    def test_a_wrapper_around_each_rule_changes_nothing(self) -> None:
        self.assertTrue(NAMES, "the wrapper test selects no syntax rule")
        def wrap(syntax: str) -> str:
            for name in NAMES:
                for field in ("ref", "rule"):
                    syntax = syntax.replace(f'"{field}":"{name}"', f'"{field}":"{name}-wrapper"')
            wrappers = "".join(
                f'{{"name":"{name}-wrapper","op":"define","categories":[],"alternatives":[{{"guards":[],"expr":{{"ref":"{name}"}}}}],'
                f'"conditions":[],"at":[{100000 + index},1]}},'
                for index, name in enumerate(NAMES)
            )
            return syntax.replace('"rules":[', '"rules":[' + wrappers, 1)

        self.assertTrue(same_json(outcome(with_syntax(wrap)), SHAPES["control"]))

    def test_each_renamed_rule_gives_the_outcome_of_every_library(self) -> None:
        for name in NAMES:

            def rename(syntax: str, name: str = name) -> str:
                syntax = syntax.replace(f'"name":"{name}","op"', f'"name":"{name}x","op"')
                for field in ("ref", "rule"):
                    syntax = syntax.replace(f'"{field}":"{name}"', f'"{field}":"{name}x"')
                return syntax

            with self.subTest(rule=name):
                self.assertTrue(same_json(outcome(with_syntax(rename)), SHAPES["loads"].get(name, "grammar")))
        for name in SHAPES["loads"]:
            self.assertIn(name, NAMES)

    def test_a_part_that_the_reader_does_not_read_is_ignored(self) -> None:
        for item in SHAPES["extraParts"]:
            with self.subTest(item["description"]):
                # A find and a replace can be arrays of pairs, applied in
                # order (tests/README.md).
                finds, replaces = item["find"], item["replace"]
                if isinstance(finds, str):
                    finds, replaces = [finds], [replaces]
                self.assertEqual(len(finds), len(replaces))
                changed = BOOTSTRAP
                for find, replace in zip(finds, replaces):
                    self.assertEqual(len(find_places(changed, find)), 1)
                    changed = substitute(changed, find, replace)
                self.assertEqual(outcome(changed, item["document"], item["inputs"], item.get("where")), item["expect"])
