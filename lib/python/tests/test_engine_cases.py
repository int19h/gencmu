"""Every case of tests/engine/ (tests/README.md)."""

from __future__ import annotations

from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from typing import Any

import gencmu
from gencmu import _testing

from .family_oracle import FamilyOracle

from .shared import (
    CaseTimeout,
    add_case_tests,
    apply_mutant,
    case_features,
    case_tokens,
    cases,
    deadline,
    load_case,
    load_case_pipeline,
    mismatch,
    parse_case,
    read_json,
    result_mutants,
    result_problems,
    run_case,
    same_json,
    validate_engine_case,
    validate_engine_expect,
    witness_lost,
    write_json,
)


# The members of `expect` that only a loaded pipeline can meet.
AFTER_LOAD = ("result", "brackets", "warnings", "features", "enabledFeatures")


class EngineCases(unittest.TestCase):
    def test_case_schema_refuses_unknown_members_and_wrong_metadata_types(self) -> None:
        base = {"grammar": '%rule text "a"', "input": "a", "expect": {}}
        changes = (
            {"typo": True}, {"description": []}, {"name": 3}, {"grammar": []}, {"input": 7},
            {"options": {"typo": True}}, {"options": []}, {"options": {"features": "f"}},
            {"options": {"withoutFeatures": [False]}}, {"options": {"until": False}}, {"options": {"elisionOnly": 1}},
            {"expect": {"typo": True}}, {"expect": []}, {"expect": {"brackets": False}},
            {"expect": {"warnings": {}}}, {"expect": {"features": {}}}, {"expect": {"error": False}},
            {"expect": {"enabledFeatures": "f"}}, {"expect": {"bundledPipelines": [3]}},
            {"expect": {"diagnostic": 1}}, {"expect": {"message": None}},
            {"expect": {"where": {"document": "main.md", "typo": 1}}},
            {"expect": {"where": {"document": "main.md", "line": True}}},
            {"expect": {"features": [{"name": "f", "kind": "gate", "default": 1}]}},
            {"expect": {"warnings": [{"feature": "f", "typo": True}]}},
            {"tokens": [{"text": "a", "tags": [], "typo": True}]},
            {"tokens": [{"text": "a", "tags": "A"}]},
            {"tokens": [{"text": "a", "tags": [], "source": [False, 1]}]},
            {"tokens": [{"text": "a", "tags": [], "before": [{"text": "b", "tags": [], "typo": True}]}]},
            {"tokens": [{"text": "a", "tags": [], "before": 1}]},
            {"parses": []}, {"parses": {}}, {"documents": [], "pipelineDocument": "p.md"},
            {"treeRendering": {"aliases": "LF", "text": "x", "decodedError": "usage"}},
        )
        for change in changes:
            with self.subTest(change=change), self.assertRaises(AssertionError):
                run_case({**base, **change})
        for item in ({"options": {}, "expect": {}, "typo": True}, {"expect": []}, {"options": {}}):
            with self.subTest(run=item), self.assertRaises(AssertionError):
                validate_engine_case({"grammar": base["grammar"], "parses": [item]}, complete=True)
        for case in ({"grammar": base["grammar"]}, {"expect": {}},
                     {"documents": {"p.md": ""}, "expect": {}},
                     {"grammar": base["grammar"], "pipeline": "lojban/cll", "expect": {}}):
            with self.subTest(case=case), self.assertRaises(AssertionError):
                validate_engine_case(case, complete=True)
        # An invalid token value remains expressible in a usage case.
        usage = {**base, "tokens": [{"text": 7, "tags": None}], "expect": {"error": "usage"}}
        validate_engine_case(usage, complete=True)
        for change in ({"expect": {"error": "usage", "typo": True}}, {"options": {"typo": 3}},
                       {"tokens": [{"text": 7, "typo": True}]}):
            with self.subTest(usage=change), self.assertRaises(AssertionError):
                validate_engine_case({**usage, **change}, complete=True)

    def test_usage_cases_refuse_malformed_control_members(self) -> None:
        base = {"grammar": '%rule text "a"', "input": "a", "expect": {"error": "usage"}}
        for options in ({"features": "f"}, {"features": 3}, {"features": [3]},
                        {"withoutFeatures": "f"}, {"withoutFeatures": [False]},
                        {"until": False}, {"until": None}, {"until": ""}, {"elisionOnly": 1}, {"elisionOnly": None}):
            with self.subTest(options=options):
                with self.assertRaisesRegex(AssertionError, "options\\."):
                    run_case({**base, "options": options})
                with self.assertRaisesRegex(AssertionError, "options\\."):
                    validate_engine_case({"grammar": base["grammar"], "parses": [{"options": options, "expect": base["expect"]}]})
                with self.assertRaisesRegex(AssertionError, "options\\."):
                    parse_case(None, {**base, "options": options})
                with self.assertRaisesRegex(AssertionError, "options\\."):
                    parse_case(None, base, {"options": options, "expect": base["expect"]})
        for value in (7, None, False, [], {}):
            with self.subTest(value=value):
                with self.assertRaisesRegex(AssertionError, "case.input"):
                    run_case({**base, "input": value})
                with self.assertRaisesRegex(AssertionError, "case.pipeline"):
                    run_case({"pipeline": value, "expect": base["expect"]})
                for field in ("input", "pipeline"):
                    case = {field: value, "parses": [{"expect": base["expect"]}]}
                    if field == "input":
                        case["grammar"] = base["grammar"]
                    with self.assertRaisesRegex(AssertionError, "case\\." + field):
                        validate_engine_case(case)

    def test_expectations_must_apply_to_the_actual_outcome(self) -> None:
        base = {"grammar": '%rule text "a"', "input": "a"}
        successful = run_case(base)
        for expect in ({"where": {"document": "main.md"}}, {"diagnostic": "code"}, {"message": "reason"}, {"typo": True}):
            with self.subTest(expect=expect), self.assertRaises(AssertionError):
                self.check("successful parse", expect, *successful)
        usage = run_case({**base, "options": {"until": "missing"}, "expect": {"error": "usage"}})
        self.check("usage", {"error": "usage", "features": []}, *usage)
        for field, value in (("result", {}), ("brackets", ""), ("warnings", []), ("enabledFeatures", []),
                             ("where", {"document": "main.md"}), ("message", "reason"), ("diagnostic", "code")):
            with self.subTest(field=field), self.assertRaises(AssertionError):
                self.check("usage", {"error": "usage", field: value}, *usage)
        load_usage = run_case({"grammar": '%rule text "\ud800"'})
        for field, value in (("where", {"document": "main.md"}), ("message", load_usage[2].message), ("diagnostic", "code")):
            with self.subTest(load_field=field), self.assertRaises(AssertionError):
                self.check("load usage", {"error": "usage", field: value}, *load_usage)

    def test_malformed_token_fields_reach_library_usage_validation(self) -> None:
        for token in ({"text": 7, "tags": []}, {"tags": []}, {"text": "a"},
                      {"text": "a", "tags": [], "before": 3}, {"text": "a", "tags": [], "after": "bad"},
                      {"text": "a", "tags": [], "before": [None]}, {"text": "a", "tags": [], "after": ["bad"]}):
            for source in ({}, {"input": "a"}):
                case = {"grammar": '%rule text "a"', "tokens": [token], "expect": {"error": "usage"}, **source}
                with self.subTest(token=token, source=source):
                    value, result, error, features = run_case(case)
                    self.assertIsNone(value)
                    self.assertIsNone(result)
                    self.assertIsNotNone(features)
                    self.assertEqual(error.kind, "usage")

    def test_token_defaults_replace_only_absent_fields(self) -> None:
        for field in ("text", "tags", "value", "image", "source", "span", "before", "after"):
            spec = {"text": "a", "tags": [], field: None}
            with self.subTest(field=field):
                tokens, text = case_tokens({"tokens": [spec], "input": "original"})
                self.assertIsNone(getattr(tokens[0], field))
                self.assertEqual(text, "original")
        tokens, _ = case_tokens({"tokens": [{"text": "a", "tags": [], "before": [{"text": "b", "tags": [], "span": [3, 4]}]}]})
        self.assertEqual(tokens[0].before[0].span, [3, 4])
        tokens, text = case_tokens({"tokens": [{"text": "ab", "tags": []}, {"text": "c", "tags": []}]})
        self.assertEqual(text, "ab c")
        self.assertEqual([(t.value, t.image, t.span, t.source, t.before, t.after) for t in tokens],
                         [("ab", "ab", (0, 1), (0, 2), [], []), ("c", "c", (1, 2), (3, 4), [], [])])

    def test_json_comparisons_distinguish_booleans_from_numbers(self) -> None:
        for left, right in ((True, 1), (False, 0), ({"a": [True]}, {"a": [1]})):
            with self.subTest(left=left, right=right):
                self.assertFalse(same_json(left, right))
                self.assertFalse(same_json(right, left))
                self.assertIsNotNone(mismatch(left, right))
                self.assertIsNotNone(mismatch(right, left))
        for left, right in ((1.0, 1), (0, -0.0), ({"a": [1.0]}, {"a": [1]})):
            with self.subTest(left=left, right=right):
                self.assertTrue(same_json(left, right))
                self.assertTrue(same_json(right, left))
                self.assertIsNone(mismatch(left, right))
                self.assertIsNone(mismatch(right, left))

    def test_result_patterns_refuse_error_messages_before_matching(self) -> None:
        for pattern in (
            {"error": {"message": "same"}},
            {"ok": False, "error": {"message": "same"}},
            {"stages": [{"error": {"details": [{"message": "same"}]}}]},
        ):
            for value in ({}, pattern):
                with self.subTest(pattern=pattern, value=value), self.assertRaisesRegex(AssertionError, "error message"):
                    mismatch(pattern, value)
        self.assertIsNone(mismatch({"message": "ordinary"}, {"message": "ordinary"}))

    def test_whole_pipeline_cases_share_sources_but_load_fresh_pipelines(self) -> None:
        documents = {
            "memo-a.md": '```jbogenbau\n%include "../grammars/gencmu/jbogenbau/pipeline.md"\n```\n',
            "memo-b.md": '```jbogenbau\n%include "../grammars/lojban/bpfk/pipeline.md"\n```\n',
        }
        case = {"documents": documents, "pipelineDocument": "memo-a.md"}
        with patch.object(gencmu, "load_pipeline_sources", wraps=gencmu.load_pipeline_sources) as load:
            first, error = load_case_pipeline(case)
            self.assertIsNone(error)
            again, error = load_case_pipeline({**case, "documents": dict(reversed(list(documents.items())))})
            self.assertIsNone(error)
            # A case never sees a pipeline that an earlier case used.
            self.assertIsNot(again, first)
            self.assertEqual(load.call_count, 2)
            self.assertIs(load.call_args_list[1].args[0], load.call_args_list[0].args[0])
            other, error = load_case_pipeline({**case, "pipelineDocument": "memo-b.md"})
            self.assertIsNone(error)
            self.assertNotEqual(other.stage_names, first.stage_names)
            changed, error = load_case_pipeline({**case, "documents": {**documents, "memo-a.md": documents["memo-b.md"]}})
            self.assertIsNone(error)
            self.assertEqual(changed.stage_names, other.stage_names)
            uncached, error = load_case_pipeline(case, use_cache=False)
            self.assertIsNone(error)
            self.assertIsNot(uncached, first)
            self.assertEqual(uncached.stage_names, first.stage_names)
            self.assertEqual(load.call_args.kwargs, {"use_cache": False})

    def test_cases_are_present(self) -> None:
        paths = cases("engine")
        self.assertTrue(paths, "no engine cases found")

    def check_case(self, path: Path) -> None:
        with patch.object(_testing, "family_check", FamilyOracle()):
            self.check_family_case(path)

    def check_family_case(self, path: Path) -> None:
        with deadline(path.name):
            self.check_fixture(path.name, load_case(path))

    def check_fixture(self, name: str, case: dict[str, Any]) -> None:
        validate_engine_case(case, complete=True)
        if "parses" in case:
            # The case parses its input several times with the one
            # loaded pipeline (tests/README.md).
            pipeline, error = load_case_pipeline(case)
            if pipeline is None:
                raise AssertionError(f"{name}: the pipeline did not load: {error}")
            features = case_features(pipeline)
            for index, run in enumerate(case["parses"]):
                value, result, error = parse_case(pipeline, case, run)
                self.check(f"{name} parse {index}", run["expect"], value, result, error, features)
            return
        value, result, error, features = run_case(case)
        self.check(name, case["expect"], value, result, error, features)

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
        validate_engine_expect(expect)
        if "bundledPipelines" in expect:
            self.assertEqual(gencmu.bundled_pipelines(), expect["bundledPipelines"], label)
        if features is None:
            # A pipeline that does not load gives the error alone, so a case
            # that expects anything that only a loaded pipeline gives fails
            # (tests/README.md).
            assert error is not None
            self.assertEqual(error.kind, expect.get("error"), f"{label}: unexpected load error: {error}")
            loaded_only = [name for name in AFTER_LOAD if name in expect]
            self.assertEqual(loaded_only, [], f"{label}: the pipeline did not load: {error}")
            if error.kind != "grammar":
                for field in ("message", "where", "diagnostic"):
                    self.assertNotIn(field, expect, f"{label}: expect.{field} requires a grammar error")
            if "message" in expect:
                self.assertEqual(error.message, expect["message"], label)
            if "diagnostic" in expect:
                self.assertEqual(error.code, expect["diagnostic"], f"{label}: {error.message}")
            if "where" in expect:
                # Where the error stands, in a document of the case, given
                # only for a grammar error (tests/README.md).
                self.assertEqual(error.kind, "grammar", f"{label}: expect.where is only for a grammar error")
                self.assertEqual(
                    {"document": error.document, "line": error.line, "column": error.column},
                    {"line": None, "column": None, **expect["where"]},
                    f"{label}: {error.message}",
                )
            return
        for field in ("where", "diagnostic"):
            self.assertNotIn(field, expect, f"{label}: expect.{field} requires a load error")
        if "features" in expect:
            self.assertEqual(features, expect["features"], label)
        if error is not None:
            # A mistake of the caller is an error, not a result (engine §13).
            self.assertEqual(expect.get("error"), "usage", f"{label}: unexpected usage error: {error}")
            for field in ("result", "brackets", "warnings", "enabledFeatures", "message"):
                self.assertNotIn(field, expect, f"{label}: expect.{field} requires a parse result")
            return
        assert value is not None and result is not None
        self.assertNotIn("features", value)
        if "enabledFeatures" in expect:
            self.assertEqual(result.features, expect["enabledFeatures"], label)
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
        if "message" in expect:
            self.assertIsNotNone(value["error"], f"{label}: expect.message requires a grammar error")
            self.assertEqual(value["error"]["kind"], "grammar", f"{label}: expect.message requires a grammar error")
            self.assertEqual(value["error"]["message"], expect["message"], label)
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

    def test_the_runner_refuses_wrong_agreed_error_reasons(self):
        for name in ("cr1-unicode-categories-conflict.json", "w2-75-suffix-recursion-local.json"):
            fixture = load_case(Path(__file__).resolve().parents[3] / "tests" / "engine" / name)
            outcome = run_case(fixture)
            self.check(name, fixture["expect"], *outcome)
            with self.assertRaises(AssertionError):
                self.check(name, {**fixture["expect"], "message": "a wrong reason"}, *outcome)

    def test_a_load_error_meets_only_an_expectation_of_the_error(self) -> None:
        # The runner fails a case whose pipeline does not load, when the case
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


add_case_tests(EngineCases, "engine")


if __name__ == "__main__":
    unittest.main()
