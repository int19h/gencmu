"""The faults of this library's own paths in the check of elision-only
(tests/README.md, ``gencmu._testing.faults``): with each one on, the shared
engine cases that the table names fail, in the way that the table says,
through the result or through the witness hook alone."""

from __future__ import annotations

import os
import unittest
from typing import Any

from gencmu import _testing

from .shared import REPOSITORY, case_features, cases, load_case, load_case_dialect, parse_case, run_case
from . import shared, test_engine_cases

RESULT = "result"
"""The result alone fails the case."""
HOOK = "hook"
"""Only the witness hook fails it: with the hook off, it passes."""

# For each fault, shared engine cases that catch it, and how.
CATCHES: dict[str, dict[str, str]] = {
    "reprocess": {"reparse-strict-reclose-swapped.json": RESULT},
    "again": {"reparse-strict-reclose-swapped.json": RESULT},
    "route3": {"reparse-strict-nested-route.json": RESULT, "reparse-synthetic-suffix-empty.json": RESULT},
    "restore": {"reparse-incompatible-optional-sound.json": RESULT},
    "rank-restoration": {
        "reparse-witness-hook-only.json": RESULT,
        "elision-only-passes.json": RESULT,
        "reparse-witness-sibling-last.json": HOOK,
    },
    "lost:context": {"reparse-witness-sibling-first.json": HOOK, "reparse-witness-sibling-last.json": HOOK},
    "lost:select": {"reparse-witness-sibling-first.json": RESULT},
}


def fails(fault: str, case: dict[str, Any], hook: bool = True) -> bool:
    """Whether an engine case fails with a fault on, as the runner of
    test_engine_cases checks it, with the witness hook or without it."""
    checker = test_engine_cases.EngineCases()
    _testing.faults.add(fault)
    shared.HOOK[0] = hook
    try:
        if "parses" in case:
            dialect, error = load_case_dialect(case, False)
            if dialect is None:
                return True
            features = case_features(dialect)
            for run in case["parses"]:
                value, result, error = parse_case(dialect, case, run)
                checker.check("", run["expect"], value, result, error, features)
        else:
            value, result, error, features = run_case(case, False)
            checker.check("", case["expect"], value, result, error, features)
    except Exception:
        return True
    finally:
        _testing.faults.discard(fault)
        shared.HOOK[0] = True
    return False


def catch(fault: str, case: dict[str, Any]) -> str | None:
    """How a case catches a fault, if it does: it runs once without the
    hook and once with it."""
    if fails(fault, case, hook=False):
        return RESULT
    if fails(fault, case):
        return HOOK
    return None


class Faults(unittest.TestCase):
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

    @unittest.skipUnless(os.environ.get("GENCMU_FAULTS_LIST"), "set GENCMU_FAULTS_LIST to list every catch")
    def test_list_catches(self) -> None:
        """Lists, for each fault, every engine case that catches it, and
        how, to choose the cases of the table."""
        for fault in _testing.FAULTS:
            caught = [(path.name, catch(fault, load_case(path))) for path in cases("engine")]
            print(fault, [entry for entry in caught if entry[1] is not None])


if __name__ == "__main__":
    unittest.main()
