"""Every case of tests/notation/ (tests/README.md)."""

from __future__ import annotations

import json
import unittest

import gencmu
from gencmu._dialect import read_document

from .shared import cases, load_case, mismatch


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
                    self.assertIsNone(problem, f"{path.name}: {problem}\n{json.dumps(dom, ensure_ascii=False)[:2000]}")
                else:
                    with self.assertRaises(gencmu.GencmuError) as caught:
                        read_document(case["document"], path.name)
                    error = caught.exception
                    self.assertEqual(error.kind, "grammar")
                    self.assertEqual(
                        (error.line, error.column),
                        (expect["error"]["line"], expect["error"]["column"]),
                        f"{path.name}: {error}",
                    )


if __name__ == "__main__":
    unittest.main()
