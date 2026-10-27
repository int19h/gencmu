"""Every case of tests/notation/ (tests/README.md)."""

from __future__ import annotations

from pathlib import Path
from copy import deepcopy
import json
import unittest
from unittest.mock import patch

import gencmu
from gencmu._pipeline import DOM_FORMAT, _Loader, _Resources, _resources, read_document
from gencmu._hash import fnv1a64

from .shared import REPOSITORY, add_case_tests, cases, load_case, mismatch, read_json, write_json


class NotationCases(unittest.TestCase):
    def test_every_recipe_position_instructs_the_author_to_use_concat(self) -> None:
        data = read_json((REPOSITORY / "tests" / "recipe-diagnostics.json").read_text())
        for position in data["positions"]:
            for channel in (":=", ":-"):
                for recipe in data["recipes"]:
                    with self.subTest(position=position["name"], channel=channel, recipe=recipe["source"]):
                        body = position["template"].replace("@CHANNEL@", channel).replace("@RECIPE@", recipe["source"])
                        marker = body.index(recipe["source"]) + recipe["source"].index(recipe["at"])
                        with self.assertRaises(gencmu.GencmuError) as caught:
                            read_document("```jbogenbau\n" + body + "\n```", "recipe.md")
                        self.assertIn("use ++", caught.exception.message.lower())
                        self.assertEqual((caught.exception.line, caught.exception.column), (2, marker + 1))
        for body in data["ordinary"]:
            with self.subTest(ordinary=body), self.assertRaises(gencmu.GencmuError) as caught:
                read_document("```jbogenbau\n" + body + "\n```", "recipe.md")
            self.assertIn("++", caught.exception.message)
            self.assertNotIn("use ++", caught.exception.message.lower())

    def test_cases_are_present(self) -> None:
        paths = cases("notation")
        self.assertTrue(paths, "no notation cases found")

    def check_case(self, path: Path) -> None:
        case = load_case(path)
        expect = case["expect"]
        if "dom" in expect:
            dom = read_document(case["document"], path.name)
            problem = mismatch(expect["dom"], dom)
            self.assertIsNone(problem, f"{path.name}: {problem}\n{write_json(dom)[:2000]}")
            if case.get("cacheMisses"):
                check_notation_cache_paths(self, path.name, case["document"], dom)
        else:
            with self.assertRaises(gencmu.GencmuError) as caught:
                read_document(case["document"], path.name)
            error = caught.exception
            self.assertEqual(error.kind, "grammar")
            for key in ("line", "column"):
                if key in expect["error"]:
                    self.assertEqual(getattr(error, key), expect["error"][key], f"{path.name}: {error}")

def check_notation_cache_paths(
    test: unittest.TestCase, name: str, document: str, expected: dict, resources: _Resources | None = None
) -> None:
    resources = _resources() if resources is None else resources
    cold = _Loader({name: document}.get, _Resources(resources.unicode, resources.bootstrap, None, resources.properties), use_cache=False)
    test.assertEqual(cold.dom(name), expected)
    envelope = {
        "format": DOM_FORMAT,
        "bootstrap": cold.reader.hash,
        "unicode": cold.unicode.fingerprint,
        "properties": cold.unicode.properties_fingerprint,
        "documents": {name: {"hash": fnv1a64(document), "dom": expected}},
    }

    def loader(preparsed):
        return _Loader({name: document}.get, _Resources(resources.unicode, resources.bootstrap, json.dumps(preparsed), resources.properties))

    cached = loader(envelope)
    with patch.object(cached.reader, "read", side_effect=AssertionError("preparsed cache was bypassed")):
        test.assertEqual(cached.dom(name), expected)
        test.assertIn((name, fnv1a64(document)), cached.preparsed)
        test.assertEqual(cached.dom(name), expected)
    for key in ("document", "bootstrap", "unicode", "format"):
        with test.subTest(cache_mismatch=key):
            stale = deepcopy(envelope)
            stale["documents"][name]["dom"]["rules"][0]["name"] = "cache-poison"
            if key == "document":
                stale["documents"][name]["hash"] = fnv1a64("another document")
            elif key == "format":
                stale["format"] = DOM_FORMAT - 1
            else:
                stale[key] = fnv1a64("another " + key)
            missed = loader(stale)
            test.assertEqual(missed.dom(name), expected)
            test.assertEqual(missed.dom(name), expected)


class NotationTies(unittest.TestCase):
    def test_a_tie_is_a_grammar_error_with_no_position(self) -> None:
        """A tie in a stage of the notation is a grammar error of loading.
        It names the document, and it has no line and no column (engine
        §8)."""
        # A notation whose one stage reads the character a in two ways.
        notation = read_document(
            '```jbogenbau\n%ambiguity-resolution greedy\n%rule text p | q\n%rule p "a"\n%rule q "a"\n```\n',
            "n.md",
        )
        bootstrap = json.dumps(
            {"format":notation["format"],"documents":{"grammars/gencmu/jbogenbau/pipeline.md":{"hash":"0","dom":read_document('```jbogenbau\n%stage syntax\n%include "../../../n.md"\n```\n',"boot.md")},"n.md":{"hash":"0","dom":notation}}}
        )
        sources = {"data/preparsed/gencmu.json": bootstrap}
        with self.assertRaises(gencmu.GencmuError) as caught:
            read_document("```jbogenbau\na\n```\n", "t.md", sources=sources)
        error = caught.exception
        self.assertEqual((error.kind, error.document, error.line, error.column), ("grammar", "t.md", None, None))
        self.assertEqual(str(error), "t.md: the grammar text is ambiguous: the syntax stage of the notation reads it in two ways")
        # A pipeline whose document ties in the notation does not load, with
        # the same error.
        with self.assertRaises(gencmu.GencmuError) as caught:
            gencmu.load_pipeline_sources({**sources, "t.md": "```jbogenbau\na\n```\n"}, "t.md", use_cache=False)
        error = caught.exception
        self.assertEqual((error.kind, error.document, error.line, error.column), ("grammar", "t.md", None, None))


add_case_tests(NotationCases, "notation")


if __name__ == "__main__":
    unittest.main()
