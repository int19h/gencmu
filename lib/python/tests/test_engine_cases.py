"""Every case of tests/engine/ (tests/README.md)."""

from __future__ import annotations

import json
import sys
import unittest
from typing import Any

import gencmu

from .shared import case_features, cases, load_case, load_case_dialect, mismatch, parse_case, run_case


# The members of `expect` that only a loaded dialect can meet.
AFTER_LOAD = ("result", "brackets", "warnings", "features")


class EngineCases(unittest.TestCase):
    def test_cases(self) -> None:
        # A canonical result nests as deep as a case's attachments do
        # (attach-deep.json). The library needs no recursion for that, and
        # test_api tests it at the default limit. But json and == recurse
        # over the result here, and before Python 3.12 they count against
        # the recursion limit.
        limit = sys.getrecursionlimit()
        sys.setrecursionlimit(max(limit, 10_000))
        self.addCleanup(sys.setrecursionlimit, limit)
        paths = cases("engine")
        self.assertTrue(paths, "no engine cases found")
        for path in paths:
            with self.subTest(case=path.name):
                case = load_case(path)
                if "parses" in case:
                    # The case parses its input several times with the one
                    # loaded dialect (tests/README.md).
                    dialect, error = load_case_dialect(case)
                    if dialect is None:
                        raise AssertionError(f"{path.name}: the dialect did not load: {error}")
                    features = case_features(dialect)
                    for index, run in enumerate(case["parses"]):
                        value, result, error = parse_case(dialect, case, run)
                        self.check(f"{path.name} parse {index}", run["expect"], value, result, error, features)
                    continue
                value, result, error, features = run_case(case)
                self.check(path.name, case["expect"], value, result, error, features)

    def check(
        self,
        label: str,
        expect: dict[str, Any],
        value: dict[str, Any] | None,
        result: gencmu.ParseResult | None,
        error: gencmu.GencmuError | None,
        features: list[dict[str, Any]] | None,
    ) -> None:
        """Whether an outcome meets a case's expectation (tests/README.md)."""
        if features is None:
            # A dialect that does not load gives the error alone, so a case
            # that expects anything that only a loaded dialect gives fails
            # (tests/README.md).
            assert error is not None
            self.assertEqual(error.kind, expect.get("error"), f"{label}: unexpected load error: {error}")
            loaded_only = [name for name in AFTER_LOAD if name in expect]
            self.assertEqual(loaded_only, [], f"{label}: the dialect did not load: {error}")
            if "where" in expect:
                # Where the error stands, in a document of the case
                # (tests/README.md).
                self.assertEqual(
                    {"document": error.document, "line": error.line, "column": error.column},
                    expect["where"],
                    f"{label}: {error.message}",
                )
            return
        if "features" in expect:
            self.assertEqual(features, expect["features"], label)
        if error is not None:
            # A mistake of the caller is an error, not a result (engine §13).
            self.assertEqual(expect.get("error"), "usage", f"{label}: unexpected usage error: {error}")
            return
        assert value is not None and result is not None
        text = json.dumps(value, ensure_ascii=False)
        # The canonical JSON is the key order of docs/output.md and parses
        # back to the same value.
        self.assertEqual(json.loads(gencmu.to_json(result)), value)
        if "warnings" in expect:
            # Compared whole: [] says that there are none.
            self.assertEqual(value.get("warnings", []), expect["warnings"], label)
        if "result" in expect:
            problem = mismatch(expect["result"], value)
            self.assertIsNone(problem, f"{label}: {problem}\n{text[:3000]}")
        if "brackets" in expect:
            self.assertEqual(gencmu.to_brackets(result), expect["brackets"], label)
        if "error" in expect:
            self.assertIsNotNone(value["error"], f"{label}: expected an error\n{text[:2000]}")
            self.assertEqual(value["error"]["kind"], expect["error"], label)
        else:
            self.assertIsNone(value["error"], f"{label}: unexpected error\n{text[:2000]}")

    def test_a_load_error_meets_only_an_expectation_of_the_error(self) -> None:
        # The runner fails a case whose dialect does not load, when the case
        # expects another kind of error, or more than the error.
        value, result, error, features = run_case({"grammar": "%rule text A\n%rule text A"})
        assert error is not None
        self.assertEqual(error.kind, "grammar")
        self.check("load", {"error": "grammar"}, value, result, error, features)
        with self.assertRaises(AssertionError):
            self.check("load", {"error": "usage"}, value, result, error, features)
        with self.assertRaises(AssertionError):
            self.check("load", {}, value, result, error, features)
        for name in AFTER_LOAD:
            with self.subTest(member=name), self.assertRaises(AssertionError):
                self.check("load", {"error": "grammar", name: []}, value, result, error, features)


if __name__ == "__main__":
    unittest.main()
