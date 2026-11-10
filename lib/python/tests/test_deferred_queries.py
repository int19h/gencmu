"""Eligible body witnesses and memo dependencies (engine §4.3)."""

import unittest
from unittest.mock import patch

import gencmu
from gencmu import _testing
from gencmu._earley import StageContext
from gencmu._grammar import lower
from gencmu._query_forms import body_target
from gencmu._query_dependencies import reads_carried_errors
from gencmu._trampoline import run


def pipeline(grammar):
    return gencmu.load_pipeline_sources({
        "p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n',
        "g.md": '```jbogenbau\n%ambiguity-resolution greedy\n' + grammar + '\n```\n',
    }, "p.md")


def context(grammar, dirty=False):
    loaded = pipeline(grammar)
    item = gencmu.Token("a", {"A"}, (0, 1), (0, 1))
    if dirty:
        item.errors = [gencmu.ParseWarning("earlier", "bad", "bad", (0, 1), (0, 1), "bad")]
    return StageContext(lower(loaded._grammars[0], frozenset()), [item], "a", loaded._unicode)


class BodyWitnesses(unittest.TestCase):
    def test_carried_error_dependencies_close_once_for_the_lowered_grammar(self):
        # Engine §4.3: all query targets reuse one closed dependency graph.
        loaded = pipeline("%rule text target\n%rule target A\n%conditions $.parse(A).error-free")
        lowered = lower(loaded._grammars[0], frozenset())
        work = {}
        with patch.object(_testing, "work", work):
            self.assertTrue(reads_carried_errors(lowered, lowered.rule_ids["text"]))
            first = work.get("walkSteps", 0)
            self.assertGreater(first, 0)
            for number in range(len(lowered.rule_names)):
                reads_carried_errors(lowered, number)
            self.assertEqual(work["walkSteps"], first)

    def test_filter_keeps_ordinary_carried_errors_apart(self):
        # Engine §4.3: ordinary witnesses can carry errors, filtered ones cannot.
        grammar = "%rule text target\n%rule target A"
        for dirty in (False, True):
            with self.subTest(dirty=dirty):
                state = context(grammar, dirty)
                self.assertTrue(run(state.nested("target", 0, 1)).accepted)
                self.assertEqual(run(state.nested("target", 0, 1, True)).accepted, not dirty)
                self.assertEqual(run(state.begins("target", 0, 1, True)), not dirty)
                self.assertEqual(run(state.ends("target", 0, 1, True)).answers[1], not dirty)

    def test_erasure_replaces_the_error_transition(self):
        # Engine §4.3: an erased finite proof remains eligible through own errors.
        grammar = '%rule text target\n%rule target bad\n%erased\n%rule bad A\n%error "bad"'
        state = context(grammar, True)
        self.assertTrue(run(state.nested("target", 0, 1, True)).accepted)
        self.assertFalse(run(state.nested("bad", 0, 1)).accepted)

    def test_nested_filtered_queries_make_the_content_key_error_dependent(self):
        # Engine §4.3: an outer unfiltered query inherits its filtered dependency.
        grammar = "%rule text target\n%rule target A\n%conditions $.parse(A).error-free"
        loaded = pipeline(grammar)
        lowered = lower(loaded._grammars[0], frozenset())
        for dirty in (False, True, False):
            with self.subTest(dirty=dirty):
                item = gencmu.Token("a", {"A"}, (0, 1), (0, 1))
                if dirty:
                    item.errors = [gencmu.ParseWarning("earlier", "bad", "bad", (0, 1), (0, 1), "bad")]
                state = StageContext(lowered, [item], "a", loaded._unicode)
                self.assertEqual(run(state.nested("target", 0, 1)).accepted, not dirty)

    def test_targets_preserve_tests_and_share_structural_identities(self):
        # Engine §3.10: tags mentioned only by parse still receive targets.
        loaded = pipeline('%rule text A\n%conditions $.parse(A), $.parse((A)), $.parse(A="x")')
        lowered = lower(loaded._grammars[0], frozenset())
        conditions = loaded._grammars[0].rules["text"].alternatives[0].conditions
        targets = [body_target(lowered, node["args"][0]["body"]) for node in conditions]
        self.assertEqual(targets[0], targets[1])
        self.assertNotEqual(targets[0], targets[2])
        self.assertIn(targets[0], lowered.rule_ids)
        self.assertIn(targets[2], lowered.rule_ids)
