"""Messages and static notes for named diagnostics."""
from __future__ import annotations

import unittest
from unittest.mock import patch

import gencmu
from gencmu import _testing
from gencmu._errors import _GrammarFault
from .shared import SHARED, load_case, load_case_pipeline, parse_case, run_case
from .test_corpus import outcome


def fixture(name):
    return load_case(SHARED / "engine" / f"i276-{name}.json")


class Diagnostics(unittest.TestCase):
    def test_a_failed_message_preserves_earlier_stages(self):
        case = fixture("message-guard")
        pipeline, error = load_case_pipeline(case)
        self.assertIsNone(error)
        calls = []
        def message(node, recipe):
            calls.append(node)
            if node.production.rule_name.endswith("bad"):
                raise _GrammarFault("injected message failure")
        with patch.object(_testing, "diagnostic_message", message):
            value, result, error = parse_case(pipeline, case)
        self.assertIsNone(error)
        self.assertEqual(len(calls), 3)
        self.assertEqual(result.error.kind, "grammar")
        self.assertIsNone(result.tree)
        self.assertEqual(result.stages[1].verdict, "unique")
        self.assertIsNone(result.stages[1].tree)
        self.assertIsNone(result.stages[1].output)
        self.assertIsNone(result.error.errors)
        self.assertEqual([warning.code for warning in result.warnings], ["early"])
        self.assertEqual(value["stages"][0]["output"][0]["value"], "a")
        self.assertNotIn("output", value["stages"][1])

    def test_disabled_and_suppressed_warnings_evaluate_no_message(self):
        with patch.object(_testing, "diagnostic_message", side_effect=AssertionError("a disabled message ran")) as message:
            self.assertTrue(run_case(fixture("warning-suppression-descendant"))[1].ok)
            case = fixture("warning-erased")
            case["options"] = {}
            self.assertTrue(run_case(case)[1].ok)
            message.assert_not_called()

    def test_a_guarded_occurrence_evaluates_its_message_once(self):
        with patch.object(_testing, "diagnostic_message") as message:
            result = run_case(fixture("tags-report-once"))[1]
        self.assertEqual(message.call_count, 1)
        self.assertEqual(result.warnings[0].message, "warning left")

    def test_static_notes_cover_queries_suppression_and_variants(self):
        def notes(case):
            pipeline, error = load_case_pipeline(case)
            self.assertIsNone(error)
            return pipeline, pipeline.ranking_reports()[0]["diagnosticNotes"]
        _, query = notes(fixture("error-query-matches"))
        self.assertTrue(any(note["kind"] == "query-error" and note["target"] == "bad" for note in query))
        pipeline, variants = notes(fixture("tags-variants-4"))
        self.assertTrue(any(note["kind"] == "guarded-tag-variants" and note["variants"] == 16 for note in variants))
        self.assertIn("16 guarded tag variants", pipeline.format_ranking_reports())
        case = fixture("warning-suppression-descendant")
        case["grammar"] = case["grammar"].replace("%rule wrap *warn", "%rule wrap A")
        _, suppression = notes(case)
        self.assertTrue(any(note["kind"] == "unused-suppression" and note["code"] == "warn" for note in suppression))

    def test_corpus_fields_keep_codes_and_source_positions(self):
        result = run_case(fixture("error-shape"))[1]
        got = outcome({}, result=result)
        self.assertEqual({key: got[key] for key in ("expect", "verdict", "stage", "error", "errors", "warnings")}, {
            "expect": "reject", "verdict": "unique", "stage": "main", "error": {"kind": "reported"},
            "errors": [{"code": "bad", "at": 0}], "warnings": [],
        })
        result = run_case(fixture("warning-with-errors"))[1]
        self.assertEqual(outcome({}, result=result)["warnings"], [{"stage": "main", "code": "text", "at": 0}])
