"""Deferred pipeline endings and message guards (engine §12.1 and §13)."""

import unittest
from unittest.mock import patch

import gencmu
from gencmu import _testing
from gencmu._errors import _GrammarFault
from .shared import SHARED, load_case, run_case
from .test_corpus import outcome, mismatch


def fixture(name):
    return load_case(SHARED / "engine" / ("deferred-report-" + name + ".json"))


class Reporting(unittest.TestCase):
    def test_corpus_error_pins_can_name_the_raising_stage_on_any_failure(self):
        # Tests §Corpus: an optional stage names where the diagnostic first arose.
        _, result, error, _ = run_case(fixture("rejected"))
        self.assertIsNone(error)
        got = outcome({}, result=result)
        self.assertEqual(got["errors"], [{"stage": "before", "code": "fault", "at": 0}])
        expected = {"id": "projection", "pipeline": "main", "expect": "reject", "stage": "last", "at": 0,
                    "errors": [{"code": "fault", "at": 0}]}
        self.assertIsNone(mismatch(expected, got))
        self.assertIsNone(mismatch({**expected, "errors": [{"stage": "before", "code": "fault", "at": 0}]}, got))
        self.assertIsNotNone(mismatch({**expected, "errors": [{"stage": "last", "code": "fault", "at": 0}]}, got))

    def test_errors_at_tokens_or_stages_bar_reconstruction(self):
        # Engine §7: pending and carried errors both bar elision-only.
        with patch.object(_testing, "elision_check", side_effect=AssertionError("a counted error entered reconstruction")):
            for name in ("pending-skips-elision", "carried-skips-elision"):
                with self.subTest(case=name):
                    value, result, error, _ = run_case(fixture(name))
                    self.assertIsNone(error)
                    self.assertEqual(result.error.kind, "reported")

    def test_a_failed_tie_message_keeps_the_prefix_and_carried_facts(self):
        # Engine §12.1: failure keeps evaluated own messages outside erasure.
        calls = 0

        def message(node, recipe):
            nonlocal calls
            if node.production.rule_name == "note":
                calls += 1
                if calls == 2:
                    raise _GrammarFault("message guard")

        with patch.object(_testing, "diagnostic_message", message):
            value, result, error, _ = run_case(fixture("tie-carried-and-multiplicity"))
        self.assertIsNone(error)
        self.assertEqual(result.error.kind, "grammar")
        self.assertEqual(result.stages[-1].verdict, "tie")
        self.assertIsNone(result.tree)
        self.assertIsNone(result.stages[-1].output)
        self.assertEqual([item.code for item in result.error.errors], ["fault"])
        self.assertEqual([item.code for item in result.warnings], ["note", "carrier"])
        self.assertEqual(result.error.warnings, result.warnings)

    def test_unique_and_tied_message_failures_drop_erased_diagnostics(self):
        # Engine §12.1: an evaluated erased prefix never enters a grammar ending.
        for tied, fail_at in ((False, 1), (True, 1), (True, 2)):
            with self.subTest(tied=tied, fail_at=fail_at):
                body = "first gone fail"
                source = ('%stage before\n%ambiguity-resolution greedy\n%rule text $a:A $b:older $c:C\n'
                          '%emits $a, $b, $c\n%rule older B\n%error "input fault"\n'
                          '%stage last\n%ambiguity-resolution greedy\n%rule text ' + body + (' | ' + body if tied else '') + '\n'
                          '%rule first A\n%warning "kept"\n%rule gone bad notice\n%erased\n'
                          '%rule bad B\n%error "erased error"\n%rule notice ε\n%warning "erased warning"\n'
                          '%rule fail C\n%warning "stop"')
                seen, calls = [], 0

                def message(node, recipe):
                    nonlocal calls
                    seen.append(node.production.rule_name)
                    if node.production.rule_name == "fail":
                        calls += 1
                        if calls == fail_at:
                            raise _GrammarFault("message guard")

                case = {"documents": {"p.md": "```jbogenbau\n" + source + "\n```\n"}, "pipelineDocument": "p.md",
                        "tokens": [{"text": tag.lower(), "tags": [tag]} for tag in ("A", "B", "C")],
                        "options": {"features": ["first", "notice", "fail"]}}
                with patch.object(_testing, "diagnostic_message", message):
                    value, result, error, _ = run_case(case)
                self.assertIsNone(error)
                self.assertEqual(result.error.kind, "grammar")
                self.assertEqual(result.stages[-1].verdict, "tie" if tied else "unique")
                self.assertIsNone(result.tree)
                self.assertIsNone(result.stages[-1].output)
                self.assertEqual([(item.stage, item.code) for item in result.error.errors], [("before", "older")])
                self.assertEqual([item.code for item in result.warnings], ["first", "fail", "first"] if fail_at == 2 else ["first"])
                self.assertEqual(seen.count("bad"), fail_at)
                self.assertEqual(seen.count("notice"), fail_at)

    def test_canonical_diagnostic_arrays_do_not_alias_the_native_result(self):
        # Output §1: each serialized diagnostic owns its coordinate arrays.
        value, result, error, _ = run_case(fixture("forward"))
        self.assertIsNone(error)
        native = result.error.errors[0]
        value["error"]["errors"][0]["source"][0] = 999
        value["stages"][0]["output"][0]["errors"][0]["span"][0] = 999
        self.assertEqual(native.source, (0, 1))
        self.assertEqual(native.span, (0, 1))
        self.assertIsNot(value["stages"][0]["output"][0]["errors"][0]["source"],
                         value["stages"][1]["output"][0]["errors"][0]["source"])
