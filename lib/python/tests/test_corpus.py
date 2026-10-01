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

from .shared import SHARED, result_problems

FIELDS = ("expect", "verdict", "stage", "error", "ties", "words", "brackets")

_dialects: dict[str, Any] = {}


def all_cases() -> list[dict[str, Any]]:
    """Every corpus case, in file order."""
    found: list[dict[str, Any]] = []
    for path in sorted((SHARED / "corpus").glob("*.jsonl")):
        with open(path, encoding="utf-8") as file:
            found.extend(json.loads(line) for line in file if line.strip())
    return found


def outcome(case: dict[str, Any], mutate: Callable[[dict[str, Any]], dict[str, Any]] | None = None) -> dict[str, Any]:
    """What gencmu makes of a case, in the case's own terms. ``mutate``, for
    a test of the runner, changes the canonical result before the check of
    its invariants."""
    import gencmu

    dialect = _dialects.get(case["dialect"])
    if dialect is None:
        dialect = _dialects[case["dialect"]] = gencmu.load_dialect(case["dialect"])
    result = dialect.parse(case["text"], features=case.get("features", []), without_features=case.get("withoutFeatures", []))
    # A tied stage emits nothing and ends the run with its error
    # (tests/README.md).
    value = gencmu.result_json(result)
    if mutate is not None:
        value = mutate(value)
    problems = result_problems(value)
    if problems:
        raise AssertionError(f"the result breaks an invariant: {'; '.join(problems)}")
    got: dict[str, Any] = {"expect": "accept" if result.ok else "reject"}
    if result.ok:
        got["verdict"] = result.stages[-1].verdict
    else:
        got["stage"] = result.error.stage if result.error else None
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
        """The runner checks the whole invariant of a tie on the canonical
        result of each tied corpus case (tests/README.md)."""
        tied_cases = [case for case in all_cases() if "ties" in case]
        self.assertTrue(tied_cases, "the corpus has tied cases")

        def tied(value: dict[str, Any], **changes: Any) -> dict[str, Any]:
            stages = list(value["stages"])
            stages[-1] = {**stages[-1], **changes}
            return {**value, "stages": stages}

        def error(value: dict[str, Any], **changes: Any) -> dict[str, Any]:
            return {**value, "error": {**value["error"], **changes}}

        mutants: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
            "a tree": lambda value: {**value, "tree": value["error"]["readings"][0]},
            "one reading": lambda value: error(value, readings=value["error"]["readings"][:1]),
            "an ok result": lambda value: {**value, "ok": True},
            "another kind of error": lambda value: error(value, kind="rejected"),
            "an error of another stage": lambda value: error(value, stage="another"),
            "another reason": lambda value: error(value, reason="elision-only"),
            "a tied stage with output": lambda value: tied(value, output=[]),
            "a stage with a tied tree": lambda value: tied(value, tied=value["error"]["readings"][1]),
            "a stage after the tie": lambda value: {**value, "stages": [*value["stages"], {"name": "later", "verdict": "unique"}]},
            "an error without a reason": lambda value: {
                **value,
                "error": {key: found for key, found in value["error"].items() if key != "reason"},
            },
        }
        for case in tied_cases:
            self.assertIsNone(mismatch(case, outcome(case)))
            for name, mutate in mutants.items():
                with self.subTest(case=case["id"], mutant=name), self.assertRaisesRegex(AssertionError, "breaks an invariant"):
                    outcome(case, mutate)

if __name__ == "__main__":
    unittest.main()
