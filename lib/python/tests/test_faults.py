"""The faults of this library's own paths in the check of elision-only
(tests/README.md, ``gencmu._testing.faults``): with each one on, the shared
engine cases that the table names fail, in the way that the table says,
through the result or through the witness hook alone."""

from __future__ import annotations

import os
import unittest
from unittest.mock import patch
from typing import Any

from gencmu import _testing
from gencmu import GencmuError

from .shared import REPOSITORY, case_features, cases, load_case, load_case_pipeline, parse_case, run_case
from . import shared, test_engine_cases

RESULT = "result"
"""The result fails the case, and the hook does not."""
HOOK = "hook"
"""Only the witness hook fails it."""
BOTH = "result+hook"
"""Both fail it, each on its own."""


class _CaseMismatch(AssertionError):
    """An expectation fails, rather than an engine assertion."""

# For each fault, shared engine cases that catch it, and how.
CATCHES: dict[str, dict[str, str]] = {
    "omission": {"elidable-table-unequal-empty.json": BOTH},
    "reprocess": {"reparse-strict-reclose-swapped.json": RESULT},
    "again": {"reparse-strict-reclose-swapped.json": RESULT},
    "route3": {"reparse-strict-nested-route.json": RESULT, "reparse-synthetic-suffix-empty.json": RESULT},
    "restore": {"reparse-incompatible-optional-sound.json": RESULT},
    "rank-restoration": {
        "reparse-witness-hook-only.json": BOTH,
        "elision-only-passes.json": BOTH,
        "reparse-witness-sibling-last.json": BOTH,
    },
    "lost:context": {"reparse-witness-sibling-first.json": BOTH, "reparse-witness-sibling-last.json": BOTH},
    "lost:select": {"reparse-witness-sibling-first.json": HOOK},
}


def fails(fault: str, case: dict[str, Any], hook: bool = True) -> bool:
    """Whether an engine case fails with a fault on, as the runner of
    test_engine_cases checks it, with the witness hook or without it."""
    checker = test_engine_cases.EngineCases()
    checker.failureException = _CaseMismatch
    _testing.faults.add(fault)
    shared.HOOK[0] = hook
    try:
        if "parses" in case:
            pipeline, error = load_case_pipeline(case, False)
            if pipeline is None:
                assert error is not None, "the loader returned neither a pipeline nor an error"
                raise error
            features = case_features(pipeline)
            for run in case["parses"]:
                value, result, error = parse_case(pipeline, case, run)
                checker.check("", run["expect"], value, result, error, features)
        else:
            value, result, error, features = run_case(case, False)
            checker.check("", case["expect"], value, result, error, features)
    except (_CaseMismatch, GencmuError):
        return True
    except shared.WitnessLost:
        if hook:
            return True
        raise
    finally:
        _testing.faults.discard(fault)
        shared.HOOK[0] = True
    return False


def fails_hook(fault: str, case: dict[str, Any]) -> bool:
    """Whether the witness hook alone fails an engine case with a fault on,
    whatever its result."""
    _testing.faults.add(fault)
    try:
        if "parses" in case:
            pipeline, error = load_case_pipeline(case, False)
            if pipeline is None:
                assert error is not None, "the loader returned neither a pipeline nor an error"
                raise error
            for run in case["parses"]:
                parse_case(pipeline, case, run)
        else:
            run_case(case, False)
    except shared.WitnessLost:
        return True
    except GencmuError:
        return False
    finally:
        _testing.faults.discard(fault)
    return False


def catch(fault: str, case: dict[str, Any]) -> str | None:
    """How a case catches a fault, if it does: it runs once checking only
    the result and once checking only the hook."""
    result, hook = fails(fault, case, hook=False), fails_hook(fault, case)
    if result and hook:
        return BOTH
    if result:
        return RESULT
    if hook:
        return HOOK
    return None


class Faults(unittest.TestCase):
    def test_crashes_escape_both_fault_checks(self) -> None:
        case = {"grammar": '%rule text "a"', "input": "a", "expect": {}}
        for error in (RuntimeError("engine crash"), AssertionError("engine assertion")):
            with patch(__name__ + ".run_case", side_effect=error):
                for check in (fails, fails_hook, catch):
                    with self.subTest(error=type(error), check=check.__name__), self.assertRaises(type(error)):
                        check("omission", case)
            self.assertNotIn("omission", _testing.faults)
            self.assertTrue(shared.HOOK[0])

    def test_library_errors_count_only_as_result_failures(self) -> None:
        case = {"grammar": '%rule text "a"', "input": "a", "expect": {}}
        pipeline, error = load_case_pipeline(case)
        self.assertIsNone(error)
        repeated = {"grammar": case["grammar"], "input": case["input"], "parses": [{"expect": {}}]}
        for kind in ("grammar", "usage"):
            error = GencmuError("library failure", kind=kind)
            for mode in ("single", "repeated", "load"):
                fixture = case if mode == "single" else repeated
                with self.subTest(kind=kind, mode=mode):
                    loaded = (None, error) if mode == "load" else (pipeline, None)
                    with (patch(__name__ + ".load_case_pipeline", return_value=loaded),
                          patch(__name__ + ".run_case", side_effect=error),
                          patch(__name__ + ".parse_case", side_effect=error)):
                        self.assertTrue(fails("omission", fixture, hook=False))
                        self.assertFalse(fails_hook("omission", fixture))
                        self.assertEqual(catch("omission", fixture), RESULT)
                    self.assertNotIn("omission", _testing.faults)
                    self.assertTrue(shared.HOOK[0])

    def test_the_shared_cases_catch_each_fault(self) -> None:
        self.assertEqual(sorted(CATCHES), sorted(_testing.FAULTS), "the table names every fault, and only those")
        for fault, names in CATCHES.items():
            self.assertTrue(names, f"no case catches {fault}")
            _testing.hits.clear()
            for name, how in names.items():
                case = load_case(REPOSITORY / "tests" / "engine" / name)
                self.assertEqual(catch(fault, case), how, f"{name} catches {fault}")
            # The named cases enter every site of the fault, and no other.
            # Each fault of this library has one site.
            self.assertEqual(_testing.hits, {fault}, f"the sites that {fault} enters")
        self.assertIn(HOOK, [how for names in CATCHES.values() for how in names.values()], "no fault that only the hook catches")
        # The selection channel catches lost:select itself, whatever the
        # result does.
        self.assertTrue(any(how != RESULT for how in CATCHES["lost:select"].values()), "no case catches lost:select through the hook")

    @unittest.skipUnless(os.environ.get("GENCMU_FAULTS_LIST"), "set GENCMU_FAULTS_LIST to list every catch")
    def test_list_catches(self) -> None:
        """Lists, for each fault, every engine case that catches it, and
        how, to choose the cases of the table."""
        for fault in _testing.FAULTS:
            caught = [(path.name, catch(fault, load_case(path))) for path in cases("engine")]
            print(fault, [entry for entry in caught if entry[1] is not None])


if __name__ == "__main__":
    unittest.main()
