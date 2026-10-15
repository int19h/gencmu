"""Every case of tests/notation/ (tests/README.md)."""

from __future__ import annotations

from pathlib import Path
from copy import deepcopy
import json
import unittest
from unittest.mock import patch

import gencmu
from gencmu._dialect import DOM_FORMAT, _Loader, _Resources, _resources, read_document
from gencmu._hash import fnv1a64

from .shared import add_case_tests, cases, load_case, mismatch, write_json


class NotationCases(unittest.TestCase):
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
                self.check_cache_misses(path.name, case["document"], dom)
        else:
            with self.assertRaises(gencmu.GencmuError) as caught:
                read_document(case["document"], path.name)
            error = caught.exception
            self.assertEqual(error.kind, "grammar")
            for key in ("line", "column"):
                if key in expect["error"]:
                    self.assertEqual(getattr(error, key), expect["error"][key], f"{path.name}: {error}")

    def check_cache_misses(self, name: str, document: str, expected: dict) -> None:
        resources = _resources()
        cold = _Loader({name: document}.get, _Resources(resources.unicode, resources.bootstrap, None), use_cache=False)
        self.assertEqual(cold.dom(name), expected)
        envelope = {
            "format": DOM_FORMAT,
            "bootstrap": cold.reader.hash,
            "unicode": cold.unicode.fingerprint,
            "documents": {name: {"hash": fnv1a64(document), "dom": expected}},
        }

        def loader(compiled):
            return _Loader({name: document}.get, _Resources(resources.unicode, resources.bootstrap, json.dumps(compiled)))

        cached = loader(envelope)
        self.assertIn(fnv1a64(document), cached.compiled)
        with patch.object(cached.reader, "read", side_effect=AssertionError("compiled cache was bypassed")):
            self.assertEqual(cached.dom(name), expected)
            self.assertEqual(cached.dom(name), expected)
        for key in ("document", "bootstrap", "unicode", "format"):
            with self.subTest(cache_mismatch=key):
                stale = deepcopy(envelope)
                stale["documents"][name]["dom"]["rules"][0]["name"] = "cache-poison"
                if key == "document":
                    stale["documents"][name]["hash"] = fnv1a64("another document")
                elif key == "format":
                    stale["format"] = DOM_FORMAT - 1
                else:
                    stale[key] = fnv1a64("another " + key)
                missed = loader(stale)
                self.assertEqual(missed.dom(name), expected)
                self.assertEqual(missed.dom(name), expected)


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
            {"format": notation["format"], "stages": [{"name": "syntax", "documents": [{"path": "n.md", "dom": notation}]}]}
        )
        sources = {"notation/bootstrap.json": bootstrap}
        with self.assertRaises(gencmu.GencmuError) as caught:
            read_document("```jbogenbau\na\n```\n", "t.md", sources=sources)
        error = caught.exception
        self.assertEqual((error.kind, error.document, error.line, error.column), ("grammar", "t.md", None, None))
        self.assertEqual(str(error), "t.md: the grammar text is ambiguous: the syntax stage of the notation reads it in two ways")
        # A dialect whose document ties in the notation does not load, with
        # the same error.
        with self.assertRaises(gencmu.GencmuError) as caught:
            gencmu.load_dialect_sources({**sources, "t.md": "```jbogenbau\na\n```\n"}, "t.md", use_cache=False)
        error = caught.exception
        self.assertEqual((error.kind, error.document, error.line, error.column), ("grammar", "t.md", None, None))


add_case_tests(NotationCases, "notation")


if __name__ == "__main__":
    unittest.main()
