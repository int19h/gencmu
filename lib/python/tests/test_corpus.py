"""The shared Lojban corpus (tests/README.md, "Corpus cases").

The core sample of tests/core.txt runs by default; GENCMU_CORPUS=full runs
every case. Each case is a separate unittest method, which pytest-xdist schedules.
Each worker caches its bundled pipelines. GENCMU_CORPUS_REPORT names a file
that records every case's outcome and time.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from typing import Any, Callable

from .shared import (
    SHARED,
    apply_mutant,
    load_case,
    load_case_pipeline,
    parse_case,
    parse_checked,
    read_json,
    result_mutants,
    result_problems,
    same_json,
    witness_lost,
    write_json,
)

FIELDS = ("expect", "verdict", "stage", "at", "error", "errors", "ties", "words", "brackets", "warnings")

_pipelines: dict[str, Any] = {}


def all_cases() -> list[dict[str, Any]]:
    """Every corpus case, in file order."""
    found: list[dict[str, Any]] = []
    for path in sorted((SHARED / "corpus").glob("*.jsonl")):
        with open(path, encoding="utf-8") as file:
            found.extend(read_json(line) for line in file if line.strip(" \t\r\n"))
    return found


def outcome(
    case: dict[str, Any],
    mutate: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    result: Any = None,
) -> dict[str, Any]:
    """What gencmu makes of a case, in the case's own terms. ``mutate``, for
    a test of the runner, changes the canonical result before the check of
    its invariants. ``result``, also for such a test, is a parse result that
    takes the place of the case's own parse."""
    import gencmu

    if result is None:
        pipeline = _pipelines.get(case["pipeline"])
        if pipeline is None:
            pipeline = _pipelines[case["pipeline"]] = gencmu.load_pipeline(case["pipeline"])
        # Every check of elision-only that ran keeps its witness
        # (tests/README.md).
        result = parse_checked(
            lambda: pipeline.parse(case["text"], features=case.get("features", []), without_features=case.get("withoutFeatures", []))
        )
    # A tied stage emits nothing and ends the run with its error
    # (tests/README.md).
    value = gencmu.result_json(result)
    if mutate is not None:
        value = mutate(value)
    problems = result_problems(value)
    if problems:
        raise AssertionError(f"the result breaks an invariant: {'; '.join(problems)}")
    # No corpus case gives elision-witness-lost, whatever it expects
    # (tests/README.md).
    if witness_lost(value):
        raise AssertionError("the result is the error elision-witness-lost, which no grammar gives")
    got: dict[str, Any] = {"expect": "accept" if result.ok else "reject"}
    if result.ok or result.error is not None and result.error.kind == "reported":
        got["verdict"] = result.stages[-1].verdict
    else:
        got["stage"] = result.error.stage if result.error else None
        # A rejection pins where its stage stopped, as a position in the
        # text (tests/README.md).
        if result.error is not None and result.error.source is not None:
            got["at"] = result.error.source[0]
    if result.error is not None and result.error.kind == "ambiguous":
        # An ambiguous error pins its kind and its reason (tests/README.md).
        got["error"] = {"kind": result.error.kind, "reason": result.error.reason}
    if result.error is not None and result.error.kind == "reported":
        got["stage"] = result.error.stage
        got["error"] = {"kind": "reported"}
        got["errors"] = [{"code": error.code, "at": error.source[0]} for error in result.error.errors]
        got["at"] = result.error.errors[0].source[0]
    got["warnings"] = [{"stage": warning.stage, "code": warning.code, "at": warning.source[0]} for warning in result.warnings]
    ties = [stage.name for stage in result.stages if stage.verdict == "tie"]
    if ties:
        got["ties"] = ties
    words = next((stage for stage in result.stages if stage.name == "words"), None)
    if words is not None and words.output is not None:
        got["words"] = [token.image for token in words.output]
    if result.ok:
        got["brackets"] = gencmu.to_brackets(result)
    return got


def run(case: dict[str, Any]) -> tuple[str, dict[str, Any] | str, float]:
    start = time.perf_counter()
    try:
        got: dict[str, Any] | str = outcome(case)
    except Exception as error:  # a crash is a failure of the case, not of the run
        got = f"{type(error).__name__}: {error}"
    return case["id"], got, time.perf_counter() - start


def mismatch(case: dict[str, Any], got: dict[str, Any] | str) -> str | None:
    if isinstance(got, str):
        return f"{case['id']}: crashed: {got}"
    for key in FIELDS:
        if key == "warnings" and key not in case:
            continue
        if key not in case and key not in got:
            continue
        if not same_json(case.get(key), got.get(key)):
            return f"{case['id']} ({case['pipeline']}): {key} expected {write_json(case.get(key))}, got {write_json(got.get(key))}"
    return None


class Corpus(unittest.TestCase):
    def test_jsonl_blank_lines_use_only_json_whitespace(self) -> None:
        record = {"id": "synthetic", "text": "\u00a0\u2028\ufeff", "pipeline": "synthetic",
                  "expect": "reject", "stage": "main", "at": 0}
        line = json.dumps(record, ensure_ascii=False) + "\n"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "corpus").mkdir()
            file = root / "corpus" / "synthetic.jsonl"
            with patch(__name__ + ".SHARED", root):
                for blank in ("", " ", "\t", "\r", "\n", " \t\r\n"):
                    with self.subTest(blank=blank):
                        file.write_text(blank + "\n" + line + blank + "\n", encoding="utf-8")
                        self.assertTrue(same_json(all_cases(), [record]))

    def test_jsonl_refuses_non_json_whitespace_on_every_line(self) -> None:
        record = {"id": "synthetic", "text": "a", "pipeline": "synthetic",
                  "expect": "reject", "stage": "main", "at": 0}
        line = json.dumps(record)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "corpus").mkdir()
            file = root / "corpus" / "synthetic.jsonl"
            with patch(__name__ + ".SHARED", root):
                for whitespace in ("\u00a0", "\v", "\f", "\u2028", "\u2029", "\u0085", "\u2003", "\ufeff"):
                    for text in (whitespace + "\n" + line, line + "\n" + whitespace,
                                 whitespace + line, line + whitespace):
                        with self.subTest(whitespace=whitespace, text=text):
                            file.write_text(text, encoding="utf-8")
                            with self.assertRaises((AssertionError, ValueError)):
                                all_cases()

    def test_json_expectations_distinguish_booleans_from_numbers(self) -> None:
        from .shared import run_case

        _, result, _, _ = run_case({"grammar": '%rule text "a"', "input": "b"})
        case = {"id": "synthetic", "pipeline": "synthetic", "text": "b", "expect": "reject", "stage": "main", "at": 0}
        self.assertIsNone(mismatch(case, outcome(case, result=result)))
        result.error.source = (False, result.error.source[1])
        self.assertIsNotNone(mismatch(case, outcome(case, result=result)))

    def test_corpus_selection(self) -> None:
        cases = all_cases()
        if os.environ.get("GENCMU_CORPUS") != "full":
            with open(SHARED / "core.txt", encoding="utf-8") as file:
                core = {line.strip() for line in file if line.strip()}
            cases = [case for case in cases if case["id"] in core]
            self.assertEqual(len(cases), len(core), "every id of core.txt names a case")

    def check_corpus_case(self, case: dict[str, Any]) -> None:
        cases = [case]
        by_id = {case["id"]: case}
        failures: list[str] = []
        lines: list[str] = []
        self.collect([run(case)], by_id, failures, lines)
        if report := os.environ.get("GENCMU_CORPUS_REPORT"):
            # One append write keeps records separate across processes.
            data = lines[0].encode("utf-8")
            fd = os.open(report, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
            try:
                if os.write(fd, data) != len(data):
                    raise OSError("a short corpus report write")
            finally:
                os.close(fd)
        self.assertEqual(failures[:20], [], f"{len(failures)} of {len(cases)} cases differ")

    @staticmethod
    def collect(results: Any, by_id: dict[str, dict[str, Any]], failures: list[str], lines: list[str]) -> None:
        for case_id, got, seconds in results:
            case = by_id[case_id]
            problem = mismatch(case, got)
            if problem:
                failures.append(problem)
            lines.append(
                json.dumps(
                    {"id": case_id, "seconds": round(seconds, 3), "chars": len(case["text"]), "ok": problem is None, "problem": problem},
                    ensure_ascii=False,
                )
                + "\n"
            )

    def test_a_result_that_breaks_an_invariant_is_refused(self) -> None:
        """The runner checks the invariants on the canonical result of each
        corpus case, and refuses each shared mutant (tests/README.md,
        "Result mutants"). Each corpus case that expects a tie must also pass
        without a mutation."""
        tied = [case for case in all_cases() if "ties" in case]
        self.assertTrue(tied, "no corpus cases expect a tie")
        for mutant in result_mutants():
            with self.subTest(mutant=mutant["name"]):
                pipeline, load_error = load_case_pipeline(mutant["engine_case"])
                self.assertIsNone(load_error)
                assert pipeline is not None
                result = parse_case(pipeline, mutant["engine_case"])[1]
                assert result is not None
                outcome({}, result=result)
                with self.assertRaisesRegex(AssertionError, "breaks an invariant"):
                    outcome({}, lambda value: apply_mutant(value, mutant), result=result)
        for case in tied:
            self.assertIsNone(mismatch(case, outcome(case)))

    def test_tie_control_selection_is_required(self) -> None:
        with patch(__name__ + ".all_cases", return_value=[]), self.assertRaisesRegex(AssertionError, "no corpus cases expect a tie"):
            self.test_a_result_that_breaks_an_invariant_is_refused()

    def test_the_runner_refuses_the_error_elision_witness_lost(self) -> None:
        """The runner fails a corpus case whose result is the error
        elision-witness-lost, or whose check loses its witness
        (tests/README.md). The check of le sutra tavla runs in lojban/cll,
        since the ranking chooses the fragment (grammars/lojban/cll/syntax.md). A
        replaced step of the check loses its witness after recognition."""
        from unittest import mock

        from gencmu import _stage

        from .shared import WitnessLost

        case = {"id": "lost", "pipeline": "lojban/cll", "text": "le sutra tavla"}
        clean = outcome(case)
        self.assertTrue(same_json(clean.get("verdict"), "resolved"))
        reconstruct = _stage._reconstruct

        def no_roots(context: Any) -> Any:
            forest = reconstruct(context)
            forest.roots = []
            return forest

        with mock.patch.object(_stage, "_reconstruct", no_roots), self.assertRaises(WitnessLost):
            outcome(case)
        pipeline = _pipelines["lojban/cll"]
        with mock.patch.object(_stage, "_rank_check", lambda forest, marks=None: None):
            result = pipeline.parse(case["text"])
        with self.assertRaisesRegex(AssertionError, "elision-witness-lost"):
            outcome(case, result=result)


def add_corpus_tests() -> None:
    def test_for(case: dict[str, Any]) -> Callable[[Corpus], None]:
        def test(self: Corpus) -> None:
            self.check_corpus_case(case)
        return test

    cases = all_cases()
    if os.environ.get("GENCMU_CORPUS") != "full":
        core = {line.strip() for line in (SHARED / "core.txt").read_text(encoding="utf-8").splitlines() if line.strip()}
        cases = [case for case in cases if case["id"] in core]
    # Schedule long texts first to reduce the wait for the last worker.
    cases.sort(key=lambda case: -len(case["text"]))
    for index, case in enumerate(cases):
        # The index keeps names unique even when IDs normalize alike.
        label = "".join(ch if ch.isalnum() else "_" for ch in case["id"])
        setattr(Corpus, f"test_case_{index:05d}_{label}", test_for(case))

    # pytest starts the report through conftest.py before workers run.
    if (report := os.environ.get("GENCMU_CORPUS_REPORT")) and "pytest" not in sys.modules:
        Path(report).write_text("", encoding="utf-8")


add_corpus_tests()


if __name__ == "__main__":
    unittest.main()
