"""The shared Lojban corpus (tests/README.md, "Corpus cases").

The core sample of tests/core.txt runs by default; GENCMU_CORPUS=full runs
every case. Cases run on a pool of processes, each loading the bundled
dialects once; GENCMU_CORPUS_WORKERS sets their number (default: the CPUs
less one), and GENCMU_CORPUS_REPORT a file to which every case's outcome
and time are written.
"""

from __future__ import annotations

import json
import os
import time
import unittest
from concurrent.futures import ProcessPoolExecutor
from typing import Any, Callable

from .shared import SHARED, apply_mutant, load_case, load_case_dialect, parse_case, parse_checked, result_mutants, result_problems, witness_lost

FIELDS = ("expect", "verdict", "stage", "at", "error", "ties", "words", "brackets")

_dialects: dict[str, Any] = {}


def all_cases() -> list[dict[str, Any]]:
    """Every corpus case, in file order."""
    found: list[dict[str, Any]] = []
    for path in sorted((SHARED / "corpus").glob("*.jsonl")):
        with open(path, encoding="utf-8") as file:
            found.extend(json.loads(line) for line in file if line.strip())
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
        dialect = _dialects.get(case["dialect"])
        if dialect is None:
            dialect = _dialects[case["dialect"]] = gencmu.load_dialect(case["dialect"])
        # Every check of elision-only that ran keeps its witness
        # (tests/README.md).
        result = parse_checked(
            lambda: dialect.parse(case["text"], features=case.get("features", []), without_features=case.get("withoutFeatures", []))
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
    if result.ok:
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
    ties = [stage.name for stage in result.stages if stage.verdict == "tie"]
    if ties:
        got["ties"] = ties
    words = next((stage for stage in result.stages if stage.name == "words"), None)
    if words is not None and words.output is not None:
        got["words"] = [token.label for token in words.output]
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
        if key not in case and key not in got:
            continue
        if case.get(key) != got.get(key):
            return f"{case['id']} ({case['dialect']}): {key} expected {json.dumps(case.get(key), ensure_ascii=False)}, got {json.dumps(got.get(key), ensure_ascii=False)}"
    return None


class Corpus(unittest.TestCase):
    def test_corpus(self) -> None:
        cases = all_cases()
        if os.environ.get("GENCMU_CORPUS") != "full":
            with open(SHARED / "core.txt", encoding="utf-8") as file:
                core = {line.strip() for line in file if line.strip()}
            cases = [case for case in cases if case["id"] in core]
            self.assertEqual(len(cases), len(core), "every id of core.txt names a case")
        by_id = {case["id"]: case for case in cases}
        # The longest texts first, so that the pool is not left waiting on one.
        queue = sorted(cases, key=lambda case: -len(case["text"]))
        workers = int(os.environ.get("GENCMU_CORPUS_WORKERS") or max(1, (os.cpu_count() or 2) - 1))
        failures: list[str] = []
        report = os.environ.get("GENCMU_CORPUS_REPORT")
        lines: list[str] = []
        if workers <= 1:
            results = map(run, queue)
            self.collect(results, by_id, failures, lines)
        else:
            with ProcessPoolExecutor(max_workers=workers) as pool:
                self.collect(pool.map(run, queue, chunksize=1), by_id, failures, lines)
        if report:
            with open(report, "w", encoding="utf-8") as file:
                file.writelines(lines)
        self.assertEqual(failures[:20], [], f"{len(failures)} of {len(cases)} cases differ")

    @staticmethod
    def collect(results: Any, by_id: dict[str, dict[str, Any]], failures: list[str], lines: list[str]) -> None:
        for case_id, got, seconds in results:
            case = by_id[case_id]
            problem = mismatch(case, got)
            if problem:
                failures.append(problem)
            lines.append(json.dumps({"id": case_id, "seconds": round(seconds, 3), "chars": len(case["text"]), "ok": problem is None, "problem": problem}, ensure_ascii=False) + "\n")

    def test_a_result_that_breaks_an_invariant_is_refused(self) -> None:
        """The runner checks the invariants on the canonical result of each
        corpus case, and refuses each shared mutant (tests/README.md,
        "Result mutants"). No text ties in a bundled dialect, so the tied
        corpus cases, if any, only pass as they are."""
        for mutant in result_mutants():
            with self.subTest(mutant=mutant["name"]):
                dialect, load_error = load_case_dialect(mutant["engine_case"])
                self.assertIsNone(load_error)
                assert dialect is not None
                result = parse_case(dialect, mutant["engine_case"])[1]
                assert result is not None
                outcome({}, result=result)
                with self.assertRaisesRegex(AssertionError, "breaks an invariant"):
                    outcome({}, lambda value: apply_mutant(value, mutant), result=result)
        for case in all_cases():
            if "ties" in case:
                self.assertIsNone(mismatch(case, outcome(case)))


    def test_the_runner_refuses_the_error_elision_witness_lost(self) -> None:
        """The runner fails a corpus case whose result is the error
        elision-witness-lost, or whose check loses its witness
        (tests/README.md). The check of le sutra tavla runs in cll-ebnf,
        since the ranking chooses the fragment (grammars/syntax/cll.md). A
        replaced step of the check loses its witness after recognition."""
        from unittest import mock

        from gencmu import _stage

        from .shared import WitnessLost

        case = {"id": "lost", "dialect": "cll-ebnf", "text": "le sutra tavla"}
        clean = outcome(case)
        self.assertEqual(clean.get("verdict"), "resolved")
        reconstruct = _stage._reconstruct

        def no_roots(context: Any) -> Any:
            forest = reconstruct(context)
            forest.roots = []
            return forest

        with mock.patch.object(_stage, "_reconstruct", no_roots), self.assertRaises(WitnessLost):
            outcome(case)
        dialect = _dialects["cll-ebnf"]
        with mock.patch.object(_stage, "_rank_check", lambda forest: None):
            result = dialect.parse(case["text"])
        with self.assertRaisesRegex(AssertionError, "elision-witness-lost"):
            outcome(case, result=result)


if __name__ == "__main__":
    unittest.main()
