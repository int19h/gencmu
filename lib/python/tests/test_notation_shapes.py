"""A bootstrap of another notation gives the reader a tree of another
shape (engine §9). Every library reads through a wrapper, and needs the
parts of each rule that it knows. tests/notation-shapes.json holds the
outcome that every library gives."""

from __future__ import annotations

import json
import unittest
from typing import Any, Callable

import gencmu

from .shared import SHARED, REPOSITORY

with open(SHARED / "notation-shapes.json", encoding="utf-8") as _file:
    SHAPES: dict[str, Any] = json.load(_file)
with open(REPOSITORY / "grammars" / "notation" / "bootstrap.json", encoding="utf-8") as _file:
    BOOTSTRAP = _file.read()
SYNTAX_AT = BOOTSTRAP.index('"path":"notation/syntax.md"')
NAMES = [
    rule["name"]
    for stage in json.loads(BOOTSTRAP)["stages"]
    for document in stage["documents"]
    if document["path"] == "notation/syntax.md"
    for rule in document["dom"]["rules"]
    if rule["name"] != "text"
]


def outcome(bootstrap: str, document: str | None = None, inputs: list[str] | None = None, where: dict[str, Any] | None = None) -> Any:
    """Loads a document with a bootstrap, and parses each input: its
    brackets, or the kind of its error. A load that fails gives the kind of
    its error, and must fail at ``where`` where an item gives it
    (tests/README.md). Any other exception escapes, and fails the test."""
    document = SHAPES["document"] if document is None else document
    inputs = SHAPES["inputs"] if inputs is None else inputs
    sources = {"p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n', "g.md": document, "notation/bootstrap.json": bootstrap}
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
    def test_a_notation_stage_that_declares_elision_only_runs_the_check(self) -> None:
        """Each notation stage runs the check of elision-only where its own
        directive declares it (engine §8). With greedy and elision-only on
        the lexical stage, the check finds the ambiguity that greedy settled
        in the pipeline document itself, and the document does not load."""
        directive = '"name":"ambiguity-resolution","args":["greedy"]'
        lexical = BOOTSTRAP.index('"path":"notation/lexical.md"')
        at = BOOTSTRAP.index(directive)
        self.assertTrue(lexical < at < SYNTAX_AT, "the first directive is the lexical stage's")
        elision = BOOTSTRAP.replace(directive, '"name":"ambiguity-resolution","args":["greedy","elision-only"]', 1)

        def sources(bootstrap: str) -> dict[str, str]:
            return {
                "p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n',
                "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text A B\n```\n",
                "notation/bootstrap.json": bootstrap,
            }

        # The bundled bootstrap loads the same documents.
        gencmu.load_dialect_sources(sources(BOOTSTRAP), "p.md", use_cache=False)
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
                f'{{"name":"{name}-wrapper","op":"define","alternatives":[{{"guards":[],"expr":{{"ref":"{name}"}}}}],'
                f'"conditions":[],"at":[{100000 + index},1]}},'
                for index, name in enumerate(NAMES)
            )
            return syntax.replace('"rules":[', '"rules":[' + wrappers, 1)

        self.assertEqual(outcome(with_syntax(wrap)), SHAPES["control"])

    def test_each_renamed_rule_gives_the_outcome_of_every_library(self) -> None:
        for name in NAMES:

            def rename(syntax: str, name: str = name) -> str:
                return syntax.replace(f'"name":"{name}","op"', f'"name":"{name}x","op"').replace(f'{{"ref":"{name}"}}', f'{{"ref":"{name}x"}}')

            with self.subTest(rule=name):
                self.assertEqual(outcome(with_syntax(rename)), SHAPES["loads"].get(name, "grammar"))
        for name in SHAPES["loads"]:
            self.assertIn(name, NAMES)

    def test_a_part_that_the_reader_does_not_read_is_ignored(self) -> None:
        for item in SHAPES["extraParts"]:
            with self.subTest(item["description"]):
                self.assertEqual(BOOTSTRAP[SYNTAX_AT:].count(item["find"]), 1)
                changed = with_syntax(lambda syntax, item=item: syntax.replace(item["find"], item["replace"]))
                self.assertEqual(outcome(changed, item["document"], item["inputs"], item.get("where")), item["expect"])
