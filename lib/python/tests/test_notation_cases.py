"""Every case of tests/notation/ (tests/README.md)."""

from __future__ import annotations

import json
import unittest

import gencmu
from gencmu._dialect import read_document

from .shared import cases, load_case, mismatch, write_json


class NotationCases(unittest.TestCase):
    def test_cases(self) -> None:
        paths = cases("notation")
        self.assertTrue(paths, "no notation cases found")
        for path in paths:
            with self.subTest(case=path.name):
                case = load_case(path)
                expect = case["expect"]
                if "dom" in expect:
                    dom = read_document(case["document"], path.name)
                    problem = mismatch(expect["dom"], dom)
                    self.assertIsNone(problem, f"{path.name}: {problem}\n{write_json(dom)[:2000]}")
                else:
                    with self.assertRaises(gencmu.GencmuError) as caught:
                        read_document(case["document"], path.name)
                    error = caught.exception
                    self.assertEqual(error.kind, "grammar")
                    for key in ("line", "column"):
                        if key in expect["error"]:
                            self.assertEqual(getattr(error, key), expect["error"][key], f"{path.name}: {error}")


class NotationTies(unittest.TestCase):
    def test_a_tie_is_a_grammar_error_with_no_position(self) -> None:
        """A tie in a stage of the notation is a grammar error of loading.
        It names the document, and it has no line and no column (engine
        §8)."""
        # A notation whose one stage reads the character a in two ways.
        notation = read_document(
            "```jbogenbau\n%ambiguity-resolution greedy\n%rule text p | q\n%rule p 'a'\n%rule q 'a'\n```\n",
            "n.md",
        )
        bootstrap = json.dumps({"format": notation["format"], "stages": [{"name": "syntax", "documents": [{"path": "n.md", "dom": notation}]}]})
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


if __name__ == "__main__":
    unittest.main()
