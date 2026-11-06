"""Messages and static notes for named diagnostics."""
from __future__ import annotations

import unittest
import json
from unittest.mock import patch

import gencmu
from gencmu import _testing
from gencmu._errors import _GrammarFault
from .shared import SHARED, load_case, load_case_pipeline, parse_case, run_case
from .test_corpus import outcome, mismatch


def fixture(name):
    return load_case(SHARED / "engine" / f"i276-{name}.json")


class Diagnostics(unittest.TestCase):
    def test_guard_occurrence_sites_survive_preparsed_loading(self):
        from gencmu._pipeline import read_document, bundled_text, DOM_FORMAT
        from gencmu._hash import fnv1a64
        for name, index in [('guard-duplicate-alternatives', 1), ('guard-header-first', 0), ('guard-simplified-origin', 1)]:
            with self.subTest(case=name):
                case = fixture(name)
                path, grammar = 'grammars/test/p.md', 'grammars/test/g.md'
                sources = {path: '```jbogenbau\n%stage main\n%include "g.md"\n```\n', grammar: '```jbogenbau\n' + case['grammar'] + '\n```\n'}
                dom = read_document(sources[grammar], grammar)
                cache = json.dumps({
                    'format': DOM_FORMAT, 'bootstrap': fnv1a64(bundled_text('data/preparsed/gencmu.json') or ''),
                    'unicode': fnv1a64(bundled_text('data/unicode/unicode.txt') or ''),
                    'properties': fnv1a64(bundled_text('data/unicode/unicode-properties.txt') or ''),
                    'documents': {grammar: {'hash': fnv1a64(sources[grammar]), 'dom': dom}},
                }, separators=(',', ':'))
                plain = parse_case(gencmu.load_pipeline_sources(sources, path), case)
                cached = parse_case(gencmu.load_pipeline_sources({**sources, 'data/preparsed/test.json': cache}, path), case)
                self.assertEqual(plain[1].error.boundary['condition'], index)
                self.assertEqual(cached[1].error.boundary['condition'], index)
                self.assertEqual(cached[0], plain[0])
                if name == 'guard-duplicate-alternatives':
                    changed = cache.replace('"string":"x"', '"string":"a"')
                    self.assertNotEqual(changed, cache)
                    control = gencmu.load_pipeline_sources({**sources, 'data/preparsed/test.json': changed}, path)
                    self.assertEqual(parse_case(control, case)[1].error.boundary['condition'], 0)

    def test_message_capture_reason_distinguishes_absent_from_unknown(self):
        for name in ('message-optional-capture-reason', 'message-captured-terminator-reason'):
            with self.subTest(case=name):
                _, error = load_case_pipeline(fixture(name))
                self.assertIsNotNone(error)
                self.assertIn('recipe', str(error))
                self.assertNotIn('captured by no alternative', str(error))

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
        # Engine §12.1 keeps the evaluated prefix before the input's carried lists.
        self.assertEqual([warning.code for warning in result.warnings], ["late", "early"])
        self.assertEqual(result.error.warnings, result.warnings)
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
        self.assertEqual(got["at"], 0)
        self.assertEqual({key: got[key] for key in ("expect", "verdict", "stage", "error", "errors", "warnings")}, {
            "expect": "reject", "verdict": "unique", "stage": "main", "error": {"kind": "reported"},
            "errors": [{"stage": "main", "code": "bad", "at": 0}], "warnings": [],
        })
        result = run_case(fixture("warning-with-errors"))[1]
        self.assertEqual(outcome({}, result=result)["warnings"], [{"stage": "main", "code": "text", "at": 0}])

    def test_query_note_names_the_reachable_error_rule(self):
        case = fixture("error-query-matches")
        case["grammar"] = case["grammar"].replace("matches(bad)", "matches(wrapper)") + "\n%rule wrapper bad"
        pipeline, error = load_case_pipeline(case)
        self.assertIsNone(error)
        notes = pipeline.ranking_reports()[0]["diagnosticNotes"]
        self.assertEqual([n["target"] for n in notes if n["kind"] == "query-error"], ["bad"])

    def test_suppression_reach_is_local_to_its_alternative(self):
        case = fixture("warning-suppression-descendant")
        case["grammar"] = '%rule text wrap\n%rule wrap A %suppress-warnings warn\n%extend-rule wrap warn\n%rule warn A %warning "warning"'
        pipeline, error = load_case_pipeline(case)
        self.assertIsNone(error)
        notes = pipeline.ranking_reports()[0]["diagnosticNotes"]
        self.assertTrue(any(n["kind"] == "unused-suppression" and n["rule"] == "wrap" for n in notes))

    def test_ordinary_tag_audit_enumerates_no_capture_choices(self):
        case = fixture("warning-erased")
        pipeline, error = load_case_pipeline(case)
        self.assertIsNone(error)
        with patch("gencmu._diagnostic_audit.validation_captures", side_effect=AssertionError("unexpected capture work")):
            pipeline.ranking_reports()

    def test_corpus_warnings_are_optional_and_exact_when_present(self):
        case = {"id": "projection", "pipeline": "main", "expect": "accept"}
        got = {"expect": "accept", "warnings": [{"stage": "main", "code": "warn", "at": 0}]}
        self.assertIsNone(mismatch(case, got))
        self.assertIsNotNone(mismatch({**case, "warnings": []}, got))
        self.assertIsNone(mismatch({**case, "warnings": got["warnings"]}, got))

    def test_guarded_tag_limit_is_a_load_error(self):
        for name in ("tags-variants-5", "tags-same-result-limit"):
            with self.subTest(case=name):
                pipeline, error = load_case_pipeline(fixture(name))
                self.assertIsNone(pipeline)
                self.assertIsNotNone(error)
                self.assertEqual(error.kind, "grammar")
                self.assertIn("16", str(error))

    def test_splice_only_cycles_share_the_called_rule_key(self):
        for entry in ("loop", "*loop"):
            case = fixture("splice-cycle")
            case["grammar"] = "%rule text " + entry + "\n%rule loop *loop | A"
            result = run_case(case)[1]
            self.assertTrue(result.ok)
            self.assertEqual(result.stages[0].verdict, "unique")
