"""Semantic erasure and query audit notes (design, Diagnostics and debugging)."""

import unittest
from unittest.mock import patch

import gencmu
from gencmu import _testing


def load(grammar):
    if "%ambiguity-resolution" not in grammar:
        grammar = "%ambiguity-resolution greedy\n" + grammar
    return gencmu.load_pipeline_sources({
        "p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n',
        "g.md": '```jbogenbau\n' + grammar + '\n```\n',
    }, "p.md")


class DiagnosticAudit(unittest.TestCase):
    def test_semantic_effects_include_counted_input_diagnostics_choices_and_emission(self):
        # Design, Diagnostics and debugging: empty emission alone does not imply inertness.
        pipeline = load('%rule text gone empty choice warning inserted\n%rule gone A\n%erased\n%rule empty ε\n%erased\n%rule choice (ε | ε)\n%erased\n%rule warning ε\n%warning "note"\n%erased\n%rule inserted producer\n%erased\n%rule producer ε\n%emits ε :: X')
        report = pipeline.ranking_reports()[0]
        kinds = {entry["rule"]: entry for entry in report["erasures"]}
        self.assertEqual(kinds["empty"]["kind"], "inert")
        self.assertEqual(report["idleErasures"], [{"rule": "empty", "document": "g.md"}])
        self.assertIn("counted-parts", kinds["gone"]["effects"])
        self.assertIn("diagnostics", kinds["gone"]["effects"])
        self.assertIn("derivation-choice", kinds["choice"]["effects"])
        self.assertIn("diagnostics", kinds["warning"]["effects"])
        self.assertIn("emission", kinds["inserted"]["effects"])
        printed = pipeline.format_ranking_reports()
        self.assertIn("semantic erasure: gone", printed)
        self.assertIn("inert erasure: empty", printed)

    def test_each_alternative_keeps_its_effects_while_inner_erasure_remains(self):
        # Design, Diagnostics and debugging: another erasure still hides its effects.
        report = load('%rule text outer multi closed\n%rule outer inner\n%erased\n%rule inner A\n%erased\n%rule multi ε | A\n%erased\n%rule closed producer\n%erased\n%rule producer child\n%emits\n%rule child ε\n%emits ε :: X').ranking_reports()[0]
        self.assertEqual(len([entry for entry in report["erasures"] if entry["rule"] == "multi"]), 2)
        kinds = {entry["rule"]: entry for entry in report["erasures"]}
        self.assertEqual(kinds["outer"]["kind"], "inert")
        self.assertEqual(kinds["closed"]["kind"], "semantic")
        self.assertFalse(any(entry["rule"] == "multi" for entry in report["idleErasures"]))

    def test_query_notes_keep_ordinary_and_filtered_targets_apart(self):
        # Engine §4.3: erased error rules can supply an ordinary witness.
        pipeline = load('%rule text $a:A\n%conditions $a.parse(target), $a.parse(target …).error-free\n%rule target hidden\n%rule hidden A\n%error "fault"\n%erased')
        notes = [note for note in pipeline.ranking_reports()[0]["diagnosticNotes"] if note["kind"] == "query-error"]
        self.assertEqual(sorted((note["target"], note["filtered"]) for note in notes), [("hidden", False), ("hidden", True)])
        printed = pipeline.format_ranking_reports()
        self.assertIn("allow carried errors", printed)
        self.assertIn("carried errors outside erased parts", printed)
        self.assertNotIn("cannot supply", printed)

    def test_effect_closure_shares_a_long_chain(self):
        # Design, Diagnostics and debugging: each dependency propagates fixed effect bits.
        for count in (50, 200):
            grammar = "%rule text gone\n%rule gone r0\n%erased\n" + "\n".join(
                "%rule r" + str(index) + " " + ("A" if index == count - 1 else "r" + str(index + 1)) for index in range(count))
            pipeline = load(grammar)
            work = {}
            with patch.object(_testing, "work", work):
                report = pipeline.ranking_reports()[0]
            self.assertIn("counted-parts", report["erasures"][0]["effects"])
            self.assertLess(work.get("walkSteps", 0), 20 * count + 100)
            self.assertLess(work.get("closures", 0), 10 * count + 100)

    def test_shared_definition_clauses_do_not_repeat_the_query_walk(self):
        # Engine §4.3: source clauses and their closed query targets stay shared.
        for count in (25, 100):
            captures = ["c" + str(index) for index in range(count)]
            grammar = ("%rule text " + " | ".join("$" + name + ":A" for name in captures)
                       + "\n%conditions " + ", ".join("$" + name + '.value="a"' for name in captures))
            pipeline = load(grammar)
            work = {}
            with patch.object(_testing, "work", work):
                pipeline.ranking_reports()
            self.assertLess(work.get("walkSteps", 0), 20 * count + 100)

    def test_shared_emission_items_are_indexed_once_by_capture(self):
        # Design, Diagnostics and debugging: shared emission clauses retain a shared index.
        for count in (25, 100):
            captures = ["c" + str(index) for index in range(count)]
            grammar = ("%rule text " + " | ".join("$" + name + ":A" for name in captures)
                       + "\n%emits " + ", ".join("$" + name for name in captures))
            pipeline = load(grammar)
            work = {}
            with patch.object(_testing, "work", work):
                pipeline.ranking_reports()
            self.assertLess(work.get("walkSteps", 0), 20 * count + 100)

    def test_shared_queries_and_distinct_annotations_cost_linear_work(self):
        # Design, Diagnostics and debugging: the cached query result retains only report targets.
        counts = []
        for count in (50, 200):
            alternatives = [f"$c{index}:A :: T{index}" for index in range(count)]
            conditions = [f"$c{index}.parse(r0)" for index in range(count)]
            rules = [f"%rule r{index} " + ("A" if index + 1 == count else f"r{index + 1}") for index in range(count)]
            grammar = ("%rule text :: $.parse(r0).tags | " + " | ".join(alternatives)
                       + "\n%conditions " + ", ".join(conditions) + "\n" + "\n".join(rules) + '\n%error "fault"\n%erased')
            pipeline = load(grammar)
            work = {}
            with patch.object(_testing, "work", work):
                notes = pipeline.ranking_reports()[0]["diagnosticNotes"]
            self.assertEqual([(note["kind"], note["target"], note["filtered"]) for note in notes], [("query-error", f"r{count - 1}", False)])
            total = work.get("walkSteps", 0) + work.get("closures", 0)
            self.assertLess(total, 80 * count + 100)
            counts.append(total)
            print(f"query annotations n={count}: {total} audit steps")
        self.assertLessEqual(counts[1], 5 * counts[0])

    def test_cached_queries_keep_alternative_targets_and_extension_locations(self):
        # Engine §2: extensions retain their own clauses and note locations.
        grammar = ("%rule text :: $.parse(common).tags | A :: $.parse(first).tags | A :: $.parse(second).tags\n"
                   "%conditions $.parse(target), $.parse(target).error-free\n"
                   "%extend-rule text A :: $.parse(first).tags\n%conditions $.parse(other).error-free\n"
                   + "\n".join('%rule ' + name + ' A\n%error "fault"\n%erased' for name in ("common", "first", "second", "target", "other")))
        notes = load(grammar).ranking_reports()[0]["diagnosticNotes"]
        self.assertEqual(sorted((note["line"], note["target"], note["filtered"]) for note in notes), sorted([
            (3, "common", False), (3, "first", False), (3, "second", False), (3, "target", False), (3, "target", True),
            (5, "first", False), (5, "other", True),
        ]))
