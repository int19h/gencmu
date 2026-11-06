"""Fixed charges and diagnostic fields (engine §1, §6, and §7.7)."""

from copy import deepcopy
from dataclasses import replace
from types import SimpleNamespace
import unittest

import gencmu
from gencmu._measures import (Measures, ZERO_MEASURE, sum_measure, compare_measure,
                             record_diagnostic, diagnostic_record, copy_diagnostic_record)
from gencmu._output import token_json, stage_json, error_json, warning_json
from gencmu._earley import StageContext, Parser
from gencmu._grammar import lower
from gencmu._rank import rank, Profiles
from gencmu._stage import DNode, DRead


def token(source):
    return gencmu.Token("a", frozenset({"A"}), (0, 1), source)


def diagnostic():
    return gencmu.ParseWarning("words", "fault", "fault", (0, 1), (3, 7), "fault")


class FixedCharges(unittest.TestCase):
    def test_actual_derivation_profiles_drop_erased_charges(self):
        # Engine §7.9: the actual witness profile drops every erased charge.
        original = token((0, 1))
        original.errors = [record_diagnostic(diagnostic(), (4, 0, 1))]
        root = DNode(0, SimpleNamespace(erased=True, helper=False, rule_name="gone", error={"string": "bad"}),
                     0, 1, [DRead(0, "A")], 0)
        self.assertEqual(Profiles((), tokens=[original]).derivation_profile(root), ZERO_MEASURE)

    def test_rankers_and_ranked_admission_use_the_same_three_part_order(self):
        # Engine §6: source blame precedes grammar keys and ranked preferences.
        cases = (
            ('%rule text long | short short\n%rule long A A %error "long"\n%rule short A %error "short"', (2, 0, 2)),
            ('%rule text long | short A\n%rule long A A %error "long"\n%rule short A %error "short"', (1, 0, 1)),
            ('%rule text (long ≻ short A) :: ∅\n%rule long A A %error "long"\n%rule short A %error "short"', (1, 0, 1)),
            ('%rule text (long ≻ short short) :: ∅\n%rule long A A %error "long"\n%rule short A %error "short"', (2, 0, 2)),
        )
        for grammar, expected in cases:
            with self.subTest(grammar=grammar):
                loaded = gencmu.load_pipeline_sources({
                    "p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n',
                    "g.md": '```jbogenbau\n%ambiguity-resolution greedy\n' + grammar + '\n```\n',
                }, "p.md")
                lowered = lower(loaded._grammars[0], frozenset())
                inputs = [token((0, 1)), token((1, 2))]
                context = StageContext(lowered, inputs, "aa", loaded._unicode)
                forest = Parser(context).parse(lowered.rule_ids["text"])
                ranking = rank(forest, lowered.steps, lowered.lean)
                self.assertEqual(ranking.verdict, "unique")
                self.assertEqual(ranking.profile[:3], expected)

    def test_reconstruction_rankers_project_own_charges(self):
        # Engine §7.7: a synthetic source point does not extend an error charge.
        loaded = gencmu.load_pipeline_sources({
            "p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n',
            "g.md": '```jbogenbau\n%ambiguity-resolution greedy\n%rule text fault\n%rule fault A A\n%error "fault"\n```\n',
        }, "p.md")
        lowered = lower(loaded._grammars[0], frozenset())
        inputs = [token((2, 5)), token((50, 50))]
        context = StageContext(lowered, inputs, " " * 50, loaded._unicode)
        forest = Parser(context).parse(lowered.rule_ids["text"])
        forest.project = [0, 1, 1]
        forest.original_tokens = [inputs[0]]
        ranking = rank(forest, lowered.steps, lowered.lean)
        self.assertEqual(ranking.profile[:3], (3, 0, 1))

    def test_sourceless_tokens_do_not_charge_the_gaps_between_them(self):
        # Engine §6: sourcelessness tests tokens, rather than the envelope.
        measures = Measures([token((2, 2)), token((9, 9)), token((7, 8))])
        self.assertEqual(measures.own(0, 2), (0, 1, 1))
        self.assertEqual(measures.own(0, 3), (7, 0, 1))

    def test_charge_order_and_arithmetic_are_exact(self):
        # Engine §6: blame and sourceless counts ascend, while count descends.
        self.assertEqual(compare_measure((0, 2000, 2000), (1, 0, 1)), -1)
        self.assertEqual(compare_measure(ZERO_MEASURE, (0, 2000, 2000)), -1)
        self.assertEqual(compare_measure((0, 0, 4), (0, 0, 3)), -1)
        large = 2 ** 64
        self.assertEqual(sum_measure((large, large, large), (1, 1, 1)), (large + 1,) * 3)

    def test_copies_keep_a_fixed_charge_and_identity(self):
        # Engine §1: changing a public span never changes an existing charge.
        original = record_diagnostic(diagnostic(), (4, 0, 1))
        duplicate = copy_diagnostic_record(original, replace(original, source=(0, 100)))
        self.assertIs(diagnostic_record(original), diagnostic_record(duplicate))
        self.assertIs(diagnostic_record(original).identity, diagnostic_record(deepcopy(original)).identity)
        carried = token((0, 1))
        carried.errors = [duplicate]
        self.assertEqual(Measures([carried]).carried, [(4, 0, 1)])
        self.assertNotIn("_diagnostic_record", warning_json(original, "errors"))

    def test_reconstruction_projects_own_charges_onto_original_tokens(self):
        # Engine §7.7: inserted tokens neither add source nor extend envelopes.
        original = Measures([token((2, 5)), token((9, 11))])
        reconstructed = Measures([token((2, 5)), token((50, 50)), token((9, 11))])
        reconstructed.original = original, [0, 1, 1, 2]
        self.assertEqual(reconstructed.own(0, 2), (3, 0, 1))
        self.assertEqual(reconstructed.own(1, 2), (0, 1, 1))
        self.assertEqual(reconstructed.own(0, 3), (9, 0, 1))


class DiagnosticShapes(unittest.TestCase):
    def test_callers_supply_only_empty_diagnostic_lists(self):
        # API §4: stored engine diagnostics cannot enter through caller tokens.
        pipeline = gencmu.load_pipeline_sources({
            "p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n',
            "g.md": '```jbogenbau\n%ambiguity-resolution greedy\n%rule text A\n```\n',
        }, "p.md")
        self.assertTrue(pipeline.parse_tokens([token((0, 1))], "a").ok)
        for field in ("errors", "warnings"):
            for supplied in ([diagnostic()], "bad", ()):
                with self.subTest(field=field, supplied=supplied):
                    supplied_token = token((0, 1))
                    setattr(supplied_token, field, supplied)
                    with self.assertRaises(gencmu.GencmuError) as caught:
                        pipeline.parse_tokens([supplied_token], "a")
                    self.assertEqual(caught.exception.kind, "usage")
        for supplied in (None, "a", 42, {}):
            with self.subTest(tokens=supplied), self.assertRaises(gencmu.GencmuError) as caught:
                pipeline.parse_tokens(supplied, "a")
            self.assertEqual(caught.exception.kind, "usage")
        class ReadTags(list):
            reads = 0

            def __iter__(self):
                self.reads += 1
                return super().__iter__()

        tags = ReadTags(["A"])
        supplied_token = token((0, 1))
        supplied_token.tags = tags
        self.assertTrue(pipeline.parse_tokens([supplied_token], "a").ok)
        self.assertEqual(tags.reads, 1)

    def test_token_and_stage_lists_are_independent_and_empty_lists_disappear(self):
        # Output §1: empty arrays do not appear in canonical JSON.
        first, second = token((0, 1)), token((0, 1))
        self.assertIsNot(first.errors, second.errors)
        self.assertNotIn("errors", token_json(first))
        first.errors.append(diagnostic())
        self.assertEqual(token_json(first)["errors"], [warning_json(first.errors[0], "errors")])
        stage = gencmu.Stage("main", "unique", [], [], errors=first.errors)
        self.assertEqual(list(stage_json(stage)), ["name", "verdict", "output", "errors"])

    def test_failure_arrays_follow_evidence_and_precede_the_message(self):
        # Output §1: the grammar envelope has no separate document member.
        item = diagnostic()
        error = gencmu.ParseError("grammar", "failed", stage="main", document="g.md", errors=[item], warnings=[item])
        self.assertEqual(list(error_json(error)), ["kind", "stage", "errors", "warnings", "message"])
        self.assertNotIn("warnings", error_json(replace(error, warnings=[])))
        self.assertNotIn("errors", error_json(replace(error, errors=[])))

    def test_rejection_evidence_belongs_only_to_errors_and_is_copied(self):
        # Output §1: warning copies never acquire competitor rejection evidence.
        item = diagnostic()
        item.rejection = {"token": 1, "source": [7, 7], "line": 1, "column": 8,
                          "expected": [{"terminal": "B", "rules": ["text"]}]}
        self.assertNotIn("rejection", warning_json(item))
        copied = warning_json(item, "errors")["rejection"]
        self.assertEqual(list(copied), ["token", "source", "line", "column", "expected"])
        copied["expected"][0]["rules"].append("other")
        self.assertEqual(item.rejection["expected"][0]["rules"], ["text"])
