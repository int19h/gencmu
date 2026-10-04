"""Every case of tests/engine/ (tests/README.md)."""

from __future__ import annotations

from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest
from typing import Any

import gencmu

from .shared import (
    CaseTimeout,
    apply_mutant,
    case_features,
    case_tokens,
    cases,
    deadline,
    load_case,
    load_case_dialect,
    mismatch,
    parse_case,
    read_json,
    result_mutants,
    result_problems,
    run_case,
    same_json,
    witness_lost,
    write_json,
)


# The members of `expect` that only a loaded dialect can meet.
AFTER_LOAD = ("result", "brackets", "warnings", "features")


class EngineCases(unittest.TestCase):
    def test_cases(self) -> None:
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
        # A canonical result nests as deep as a case's attachments do
        # (attach-deep.json). So the runner reads, writes and compares it
        # with a list for a stack, as the library does, not with json and ==.
        text = write_json(value)
        # The invariants hold of every result, whatever the case expects
        # (tests/README.md).
        self.assertEqual(result_problems(value), [], f"{label} breaks an invariant of the result\n{text[:2000]}")
        self.assertFalse(witness_lost(value), f"{label} gives the error elision-witness-lost, which no grammar gives\n{text[:2000]}")
        # The canonical JSON is the key order of docs/output.md and parses
        # back to the same value.
        self.assertTrue(same_json(read_json(gencmu.to_json(result)), value), f"{label}: the canonical JSON reads back as another value")
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

    def test_the_runner_handles_values_far_deeper_than_the_call_stack(self) -> None:
        # Results and case tokens nest as deep as their attachments do. So
        # the runner's readers, writers and comparisons need no recursion.
        depth = 20_000
        text = '{"a":[' * depth + "1" + "]}" * depth
        value = read_json(text)
        self.assertEqual(write_json(value), text)
        self.assertTrue(same_json(value, read_json(text)))
        self.assertFalse(same_json(value, read_json(text.replace("1", "2"))))
        self.assertIsNone(mismatch(value, read_json(text)))
        problem = mismatch(value, read_json(text.replace("1", "2")))
        self.assertEqual(problem, "$" + ".a[0]" * depth + ": expected 1, found 2")
        spec: dict[str, Any] = {"text": "x", "tags": ["A"]}
        top = spec
        for _ in range(depth):
            spec["before"] = [{"text": "y", "tags": ["A"]}]
            spec = spec["before"][0]
        tokens, _ = case_tokens({"tokens": [top]})
        token = tokens[0]
        for _ in range(depth):
            token = token.before[0]
        self.assertEqual(token.text, "y")
        # A case file can nest as deep, in what it expects, and so can a
        # mutant's value.
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "deep.json"
            path.write_text('{"expect":{"result":' + text + "}}", encoding="utf-8")
            self.assertTrue(same_json(load_case(path)["expect"]["result"], value))
        changed = apply_mutant({"error": None}, {"path": ["error"], "set": value})
        self.assertTrue(same_json(changed["error"], value))

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
        """The runner refuses a result that breaks an invariant, whatever the
        case expects: each shared mutant (tests/README.md, "Result
        mutants")."""
        for mutant in result_mutants():
            with self.subTest(mutant=mutant["name"]):
                value, result, error, features = run_case(mutant["engine_case"])
                assert value is not None and error is None
                self.assertEqual(result_problems(value), [])
                changed = apply_mutant(value, mutant)
                self.assertNotEqual(result_problems(changed), [])
                with self.assertRaisesRegex(AssertionError, "breaks an invariant"):
                    self.check("mutant", {"error": "ambiguous"}, changed, result, error, features)


if __name__ == "__main__":
    unittest.main()
