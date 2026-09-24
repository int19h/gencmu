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
                value, result, error = run_case(case)
                if error is not None:
                    self.assertEqual(expect.get("error"), "grammar", f"{path.name}: the dialect did not load: {error}")
                    self.assertEqual(error.kind, "grammar")
                    continue
                assert value is not None and result is not None
                text = json.dumps(value, ensure_ascii=False)
                # The canonical JSON is the key order of docs/output.md and
                # parses back to the same value.
                self.assertEqual(json.loads(gencmu.to_json(result)), value)
                if "result" in expect:
                    problem = mismatch(expect["result"], value)
                    self.assertIsNone(problem, f"{path.name}: {problem}\n{text[:3000]}")
                if "brackets" in expect:
                    self.assertEqual(gencmu.to_brackets(result), expect["brackets"], path.name)
                if "error" in expect:
                    self.assertIsNotNone(value["error"], f"{path.name}: expected an error\n{text[:2000]}")
                    self.assertEqual(value["error"]["kind"], expect["error"], path.name)


if __name__ == "__main__":
    unittest.main()
