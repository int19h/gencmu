"""The faults of this library's own paths in the check of elision-only
(tests/README.md, ``gencmu._testing.faults``): with each one on, the shared
engine cases that the table names fail."""

from __future__ import annotations

import os
import unittest
from typing import Any

from gencmu import _testing

from .shared import REPOSITORY, case_features, cases, load_case, load_case_dialect, parse_case, run_case
from . import test_engine_cases

# For each fault, shared engine cases that catch it.
CATCHES: dict[str, list[str]] = {
    "reprocess": ["reparse-strict-reclose-swapped.json"],
    "again": ["reparse-strict-reclose-swapped.json"],
    "route3": ["reparse-strict-nested-route.json", "reparse-synthetic-suffix-empty.json"],
    "restore": ["reparse-incompatible-optional-sound.json"],
    "rank-restoration": ["reparse-witness-hook-only.json", "elision-only-passes.json"],
}


def fails(fault: str, case: dict[str, Any]) -> bool:
    """Whether an engine case fails with a fault on, as the runner of
    test_engine_cases checks it."""
    checker = test_engine_cases.EngineCases()
    _testing.faults.add(fault)
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
    return False


class Faults(unittest.TestCase):
    def test_the_shared_cases_catch_each_fault(self) -> None:
        for fault, names in CATCHES.items():
            self.assertTrue(names, f"no case catches {fault}")
            for name in names:
                case = load_case(REPOSITORY / "tests" / "engine" / name)
                self.assertTrue(fails(fault, case), f"{name} does not catch {fault}")

    @unittest.skipUnless(os.environ.get("GENCMU_FAULTS_LIST"), "set GENCMU_FAULTS_LIST to list every catch")
    def test_list_catches(self) -> None:
        """Lists, for each fault, every engine case that catches it, to
        choose the cases of the table."""
        for fault in CATCHES:
            caught = [path.name for path in cases("engine") if fails(fault, load_case(path))]
            print(fault, caught)


if __name__ == "__main__":
    unittest.main()
