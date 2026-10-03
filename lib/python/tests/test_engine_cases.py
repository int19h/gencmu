"""Every case of tests/engine/ (tests/README.md)."""

from __future__ import annotations

import json
from pathlib import Path
import signal
import subprocess
import sys
import unittest
from typing import Any

import gencmu

from .shared import (
    CaseTimeout,
    case_features,
    cases,
    deadline,
    load_case,
    load_case_dialect,
    mismatch,
    parse_case,
    result_problems,
    run_case,
    witness_lost,
)


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
            # A case that hangs fails, and the other cases go on.
            with self.subTest(case=path.name), deadline(path.name):
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
                # Where the error stands, in a document of the case, given
                # only for a grammar error (tests/README.md).
                self.assertEqual(error.kind, "grammar", f"{label}: expect.where is only for a grammar error")
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
        # The invariants hold of every result, whatever the case expects
        # (tests/README.md).
        self.assertEqual(result_problems(value), [], f"{label} breaks an invariant of the result\n{text[:2000]}")
        self.assertFalse(witness_lost(value), f"{label} gives the error elision-witness-lost, which no grammar gives\n{text[:2000]}")
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

    @unittest.skipUnless(hasattr(signal, "setitimer"), "the process has no alarm signal")
    def test_a_case_that_hangs_fails(self) -> None:
        """With an alarm signal, the runner reports a case that runs past
        its time as a failure, and the other cases go on."""
        with self.assertRaises(CaseTimeout), deadline("a loop", 0.2):
            while True:
                pass

    def test_a_case_that_hangs_without_an_alarm_ends_the_process(self) -> None:
        """Without an alarm signal, as in a thread other than the main one,
        the deadline ends the process with a traceback. The test runs it in
        a process of its own, so that this suite goes on."""
        program = (
            "import threading\n"
            "from tests.shared import deadline\n"
            "def hang():\n"
            "    with deadline('a loop', 0.2):\n"
            "        while True:\n"
            "            pass\n"
            "thread = threading.Thread(target=hang)\n"
            "thread.start()\n"
            "thread.join()\n"
        )
        done = subprocess.run(
            [sys.executable, "-c", program], cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True, timeout=60
        )
        self.assertEqual(done.returncode, 1, done.stderr)
        self.assertIn("Timeout (", done.stderr)
        self.assertIn("in hang", done.stderr)

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

    def test_a_usage_error_of_loading_meets_only_its_kind(self) -> None:
        # A document held in memory with a lone surrogate is a mistake of the
        # caller (engine §1), found at load (tests/README.md).
        value, result, error, features = run_case({"grammar": "%rule text 'a\ud800'"})
        assert error is not None
        self.assertEqual(error.kind, "usage")
        self.check("load", {"error": "usage"}, value, result, error, features)
        with self.assertRaises(AssertionError):
            self.check("load", {"error": "grammar"}, value, result, error, features)
        with self.assertRaises(AssertionError):
            self.check("load", {"error": "usage", "result": {}}, value, result, error, features)
        # A usage error has no line or column, so a case gives no `where` for
        # it.
        with self.assertRaises(AssertionError):
            self.check("load", {"error": "usage", "where": {"document": "main.md"}}, value, result, error, features)

    def test_a_result_that_breaks_an_invariant_is_refused(self) -> None:
        """The runner refuses a result that breaks an invariant of a tie,
        whatever the case expects (tests/README.md)."""
        value, result, error, features = run_case(
            {"grammar": "%rule text x | y\n%rule x A\n%rule y A", "tokens": [{"text": "a", "tags": ["A"]}]}
        )
        assert value is not None and error is None
        self.assertEqual(result_problems(value), [])
        self.check("tie", {"error": "ambiguous"}, value, result, error, features)
        tied = value["stages"][0]
        mutants = {
            "a tied stage with output": {**value, "stages": [{**tied, "output": []}]},
            "a stage with a tied tree": {**value, "stages": [{**tied, "tied": value["error"]["readings"][1]}]},
            "a stage after the tie": {**value, "stages": [tied, {"name": "later", "verdict": "unique"}]},
            "an error without a reason": {**value, "error": {key: found for key, found in value["error"].items() if key != "reason"}},
            "an ambiguous error with a token": {**value, "error": {**value["error"], "token": 0}},
            "an ambiguous error with a source": {**value, "error": {**value["error"], "source": [0, 1]}},
        }
        for name, mutant in mutants.items():
            with self.subTest(mutant=name):
                self.assertNotEqual(result_problems(mutant), [])
                with self.assertRaisesRegex(AssertionError, "breaks an invariant"):
                    self.check("tie", {"error": "ambiguous"}, mutant, result, error, features)


if __name__ == "__main__":
    unittest.main()
