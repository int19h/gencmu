"""Every case of tests/engine/ (tests/README.md)."""

from __future__ import annotations

import json
import unittest

import gencmu

from .shared import cases, load_case, mismatch, run_case


class EngineCases(unittest.TestCase):
    def test_cases(self) -> None:
        paths = cases("engine")
        self.assertTrue(paths, "no engine cases found")
        for path in paths:
            with self.subTest(case=path.name):
                case = load_case(path)
                expect = case["expect"]
                value, result, error, features = run_case(case)
                if features is None:
                    self.assertEqual(expect.get("error"), "grammar", f"{path.name}: the dialect did not load: {error}")
                    assert error is not None
                    self.assertEqual(error.kind, "grammar")
                    continue
                if "features" in expect:
                    self.assertEqual(features, expect["features"], path.name)
                if error is not None:
                    # A mistake of the caller is an error, not a result
                    # (engine §13).
                    self.assertEqual(expect.get("error"), "usage", f"{path.name}: unexpected usage error: {error}")
                    continue
                assert value is not None and result is not None
                text = json.dumps(value, ensure_ascii=False)
                # The canonical JSON is the key order of docs/output.md and
                # parses back to the same value.
                self.assertEqual(json.loads(gencmu.to_json(result)), value)
                if "warnings" in expect:
                    # Compared whole: [] says that there are none.
                    self.assertEqual(value.get("warnings", []), expect["warnings"], path.name)
                if "result" in expect:
                    problem = mismatch(expect["result"], value)
                    self.assertIsNone(problem, f"{path.name}: {problem}\n{text[:3000]}")
                if "brackets" in expect:
                    self.assertEqual(gencmu.to_brackets(result), expect["brackets"], path.name)
                if "error" in expect:
                    self.assertIsNotNone(value["error"], f"{path.name}: expected an error\n{text[:2000]}")
                    self.assertEqual(value["error"]["kind"], expect["error"], path.name)
                else:
                    self.assertIsNone(value["error"], f"{path.name}: unexpected error\n{text[:2000]}")


if __name__ == "__main__":
    unittest.main()
