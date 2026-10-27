"""Close-family conformance and the shared growth contracts."""

from __future__ import annotations

import json
import re
from pathlib import Path
from time import perf_counter
import tracemalloc
import unittest
from unittest.mock import patch

from gencmu import _testing
from gencmu._families import FamilyMatcher

from .family_oracle import FamilyOracle
from .shared import case_features, load_case_pipeline, parse_case, run_case
from . import test_engine_cases as engine_cases


ROOT = Path(__file__).resolve().parents[3] / "tests"
GROWTH = json.loads((ROOT / "without-elision-growth.json").read_text())


def sized_case(entry, size, family, witness=False):
    path = entry["case"] if family else entry["strictCase"]
    case = json.loads((ROOT / path).read_text())
    if "depths" in entry:
        lines = case["grammar"].splitlines()
        first = next(index for index, line in enumerate(lines) if line.startswith("%rule r1 "))
        head = "\n".join(lines[:first])
        head = re.sub(r"\br(?:16|10)\b", f"r{size}", head)
        ranked = "ranked-sibling" in path
        head += "".join(f"\n%rule r{i} r{i - 1} r{i - 1}" + (" | [+V]" if ranked else "")
                        for i in range(1, size + 1))
        if family:
            head += "\n" + next(line for line in lines if line.startswith("%rule fam "))
        if witness:
            head = head.replace(".matches(empty)", f".matches(r{size})")
            head = head.replace("%conditions $x", "%conditions ¬$x")
        case["grammar"] = head
    elif "input" in case:
        case["input"] = "x" + "a" * size
    else:
        first = case["tokens"][0]
        if "two-terminals" in path:
            second = case["tokens"][1]
            units = [first if index % 2 == 0 else second for index in range(size)]
        else:
            units = [first] * size
        suffix = case["tokens"][-2:] if "anchored" in path else case["tokens"][-1:]
        case["tokens"] = units + suffix
    return case


class CloseFamilies(unittest.TestCase):
    def test_oracle_checks_each_ownership_route_and_catches_a_wrong_answer(self):
        case = sized_case(GROWTH["familyOwnerChoice"], 4, True)
        oracle = FamilyOracle()
        with patch.object(_testing, "family_check", oracle):
            value, _, error, _ = run_case(case)
        self.assertIsNone(error)
        self.assertTrue(value["ok"])
        self.assertGreater(oracle.witnesses, 0)
        self.assertGreater(oracle.observations, oracle.witnesses)
        with patch.object(_testing, "family_check", FamilyOracle()), patch.object(FamilyMatcher, "accepts", return_value=False):
            with self.assertRaisesRegex(AssertionError, "summary disagrees"):
                run_case(case)

    def measure(self, case, limits, label):
        pipeline, error = load_case_pipeline(case)
        self.assertIsNone(error, label)
        original = _testing.count

        def bounded(name, amount=1):
            if name in limits:
                self.assertLessEqual(_testing.work.get(name, 0) + amount, limits[name], f"{label}: {name}")
            original(name, amount)

        _testing.work = {}
        tracemalloc.start()
        start = perf_counter()
        try:
            with patch.object(_testing, "count", bounded):
                value, result, error = parse_case(pipeline, case)
            elapsed = perf_counter() - start
            _, peak = tracemalloc.get_traced_memory()
            engine_cases.EngineCases().check(label, case["expect"], value, result, error, case_features(pipeline))
            counts = {name: _testing.work.get(name, 0) for name in (
                "items", "packed_edges", "close_observation_states", "close_sequence_nodes",
                "cycle_contexts", "family_summaries", "family_steps")}
            print(f"{label}: {counts}, {elapsed:.3f}s, {peak} peak traced bytes", flush=True)
            return counts
        finally:
            tracemalloc.stop()
            _testing.work = None

    def growth_case(self, name, entry):
        for size in entry.get("lengths", entry.get("depths", ())):
            for witness in ((False, True) if "double-closes" in entry["case"] else (False,)):
                limits = {}
                if "maxCloseNodes" in entry:
                    limits["close_sequence_nodes"] = entry["maxCloseNodes"]
                if "nodesPerDepth" in entry:
                    limits["close_sequence_nodes"] = entry["nodesPerDepth"] * (size + 1) + entry["slack"]
                if "maxCloseStates" in entry:
                    limits["close_observation_states"] = entry["maxCloseStates"]
                if "itemsPerUnit" in entry:
                    limits["items"] = entry["itemsPerUnit"] * size + entry["slack"]
                strict_limits = dict(limits)
                bound = entry.get("strictBound")
                if bound:
                    strict_limits["close_observation_states"] = bound["closeStatesPerUnit"] * size + bound["closeStatesSlack"]
                label = f"{name} size {size}, witness {witness}"
                strict = self.measure(sized_case(entry, size, False, witness), strict_limits, label + ", strict")
                bound = entry.get("overStrict")
                if bound:
                    percent = bound.get("itemsPercent", 0) + bound.get("itemsPercentPerUnit", 0) * size
                    limits["items"] = min(limits.get("items", float("inf")), strict["items"] * percent // 100 + bound.get("itemsSlack", 0))
                    limits["close_observation_states"] = min(limits.get("close_observation_states", float("inf")), strict["close_observation_states"] + bound.get("closeStatesPerUnit", 0) * size)
                if entry.get("equalsStrict") or entry.get("atMostStrict"):
                    for field in ("items", "close_observation_states"):
                        limits[field] = min(limits.get(field, float("inf")), strict[field])
                if "summaries" in entry:
                    bound = entry["summaries"]
                    limits["family_summaries"] = bound["perSquare"] * size**2 + bound["slack"]
                if "steps" in entry:
                    bound = entry["steps"]
                    limits["family_steps"] = bound["perCube"] * size**3 + bound["slack"]
                family = self.measure(sized_case(entry, size, True, witness), limits, label + ", family")
                if entry.get("equalsStrict"):
                    for field in ("items", "close_observation_states"):
                        self.assertEqual(family[field], strict[field], label)


def growth_test(name, entry):
    def test(self):
        self.growth_case(name, entry)
    test.__name__ = "test_growth_" + name
    return test


for _name, _entry in GROWTH.items():
    if _name.startswith("family"):
        setattr(CloseFamilies, "test_growth_" + _name, growth_test(_name, _entry))
