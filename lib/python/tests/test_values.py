"""Independent checks of values and element helpers from the specification."""

from __future__ import annotations

import unittest
import re

from .shared import run_case, same_json


class Values(unittest.TestCase):
    def test_partial_presence_simplification_bounds_independent_guards(self) -> None:
        from gencmu import _clauses
        from .shared import calls, count_work
        n = 24
        names = [f"c{i}" for i in range(n)]
        base = {"name": "r", "op": "define", "at": [1, 1], "conditions": [],
                "alternatives": [{"guards": [], "expr": {"seq": [{"optional": {"capture": c, "expr": {"ref": "A"}}} for c in names]}}]}
        for clause in [
            {"conditions": [{"any": [{"captured": c} for c in names]}]},
            {"conditions": [{"all": [{"captured": c} for c in names]}]},
            {"conditions": [{"all": [{"if": {"captured": c}, "then": {"op": "=", "left": {"method": "value", "receiver": {"capture": c}, "args": []}, "right": {"string": "x"}}} for c in names[:8]]}]},
            {"tags": {"union": [{"if": {"captured": c}, "then": {"method": "tags", "receiver": {"capture": c}, "args": []}} for c in names]}},
        ]:
            with self.subTest(clause=clause), count_work(calls(_clauses._capture_witness), budget=8*n*n):
                self.assertIsNone(_clauses.definition_problem({**base, **clause}))

    def test_stitching_diagnostics_use_common_messages_and_written_capture_order(self) -> None:
        cases = [
            ('%rule text missing', 'missing is not a rule of stage main'),
            ('%classifier lex $NOPEK ∈ K\n%rule text \"a\"', '$NOPEK is not defined in stage main'),
            ('%rule other "a"', 'has no rule text'),
            ('%ambiguity-resolution greedy\n%rule text "a"', 'has a second %ambiguity-resolution'),
            ('%rule text $x:A :: $x.value.classify(unknown)', 'unknown is not a classifier of stage main'),
            ('%extend-rule absent "a"\n%rule text "a"', '%extend-rule absent extends a rule that is not defined before it'),
            ('%rule text "a"\n%rule text "b"', '%rule text is already defined, in g.md; %redefine-rule replaces a rule'),
            ('%const $P $Q\n%rule text "a"', '$Q is not defined in stage main; dependency $P → $Q'),
            ('%const $S "ab"\n%rule text $S.."z"', 'a range endpoint is one scalar'),
            ('%const $S "z"\n%rule text $S.."a"', 'a range starts above its end'),
            ('%rule text "a"\n%conditions $zz ∧ $bb', '$zz is captured by no alternative of text'),
            ('%rule text "a"\n%conditions $zz ∧ $.value = $bb.value', '$zz is captured by no alternative of text'),
            ('%rule text "a" :: ($zz ⟹ $bb.tags)', '$zz is captured by no alternative of text'),
            ('%rule text := $zz.value | "a" :: $bb.tags', '$zz is captured by no alternative of text'),
            ('%rule r :: $a.tags := $b.value\n | $a:"a"\n | $b:"b"\n%rule text r', 'a selected recipe reads an absent capture $b'),
        ]
        for grammar, expected in cases:
            with self.subTest(grammar=grammar):
                _, _, error, _ = run_case({"grammar": "%ambiguity-resolution greedy\n" + grammar, "input": "a"})
                self.assertIsNotNone(error)
                self.assertEqual(error.message, expected.replace("g.md", "main.md"))

    def test_stitching_errors_retain_stages_and_written_reference_order(self) -> None:
        import gencmu
        cases = [
            ('%rule other missing', 'has no rule text', True, True),
            ('%rule text A', 'has no %ambiguity-resolution', False, True),
            ('%rule text A :: $.value.classify(nolex) ∪ $.parse(norule).tags', 'nolex is not a classifier of stage main', True, False),
            ('%rule text A :: $.parse(norule).tags ∪ $.value.classify(nolex)', 'norule is not a rule of stage main', True, False),
            ('%const $A $MISSING\n%rule text A', '$MISSING is not defined in stage main; dependency $A → $MISSING', True, False),
            ('%ambiguity-resolution greedy\n%rule text A', 'has a second %ambiguity-resolution', True, False),
        ]
        for source, expected, resolution, unlocated in cases:
            with self.subTest(source=source):
                sources = {"p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```',
                           "g.md": '```jbogenbau\n' + ('%ambiguity-resolution greedy\n' if resolution else '') + source + '\n```'}
                with self.assertRaises(gencmu.GencmuError) as found:
                    gencmu.load_pipeline_sources(sources, "p.md")
                error = found.exception
                self.assertEqual(error.message, expected)
                self.assertEqual(error.stage, "main")
                if unlocated:
                    self.assertEqual((error.document, error.line, error.column), (None, None, None))

    def test_missing_resolution_message(self) -> None:
        import gencmu
        sources = {"p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```',
                   "g.md": '```jbogenbau\n%rule text "a"\n```'}
        with self.assertRaises(gencmu.GencmuError) as found:
            gencmu.load_pipeline_sources(sources, "p.md")
        self.assertEqual(found.exception.message, "has no %ambiguity-resolution")

    def test_classifier_diagnostics_print_canonical_keys(self) -> None:
        for entries, ending in [
            (' "a‹U+00AD›é" ∈ A\n "a‹U+00AD›é" ∈ A', 'is already in A'),
            (' "a‹U+00AD›é" ∉ A', 'is not in A, so ∉ has nothing to remove'),
        ]:
            value, _, error, _ = run_case({"grammar": '%classifier lex\n' + entries + '\n%rule text "a"', "input": "a"})
            self.assertIsNone(error)
            self.assertTrue(same_json(re.sub(r'^main\.md:\d+:\d+: ', '', value["error"]["message"]),
                                      'the classifier lex: "a‹SHY›e‹U+0301›" ' + ending))

    def test_constant_cycles_exclude_entry_paths_and_identify_versions(self) -> None:
        cases = [
            ('%const $A $B\n%const $B $C\n%const $C $B', r'constant dependency cycle: \$B → \$C → \$B$'),
            ('%const $A $B\n%const $B $A\n%redefine-const $A $A',
             r'constant dependency cycle: \$A \[(?P<doc>[^]]+):3:1\] → \$B \[(?P=doc):4:1\] → \$A \[(?P=doc):5:1\] → \$A \[(?P=doc):3:1\]$'),
        ]
        for declarations, expected in cases:
            _, _, error, _ = run_case({'grammar': declarations + '\n%rule text "a"', 'input': 'a'})
            self.assertIsNotNone(error)
            self.assertRegex(str(error), expected)

    def test_parent_helper_routes_preserve_optional_priority(self) -> None:
        # Engine §4 keeps one element parent across the physical helper
        # routes introduced by a private capture.
        for capture in ("c", "$c:c"):
            for suffix, allowed in (("T", False), ("T U", True)):
                for method in ("whole", "prefix", "tags"):
                    with self.subTest(capture=capture, suffix=suffix, method=method):
                        head = "%rule text $r:input"
                        query = "$r.parse(r).tags" if method == "tags" else "$r.parse(r …)" if method == "prefix" else "$r.parse(r)"
                        head += f" :: {query}" if method == "tags" else f"\n%conditions {query}"
                        grammar = f"{head}\n%rule input B D T Z\n%rule r :: Queried | B [[({capture} ≻ c)] [+{suffix}] D T] Z\n%rule c D"
                        value, _, error, _ = run_case({"grammar": grammar, "tokens": [{"text": tag, "tags": [tag]} for tag in "BDTZ"]})
                        self.assertIsNone(error)
                        if method == "tags":
                            self.assertTrue(same_json(value["ok"], True))
                            self.assertTrue(same_json(value["tree"]["tags"], ["Queried"] if allowed else []))
                        else:
                            self.assertTrue(same_json(value["ok"], allowed))

    def test_engine_tag_diagnostics_follow_retained_occurrences(self) -> None:
        # Engine §1 retains occurrences, rather than every occurrence of
        # a name that survives somewhere else in the term.
        for term, retained in (
            ("(_General_Category_Uppercase_Letter ∩ A) ∪ _General_Category_Uppercase_Letter", 1),
            ("(A ∖ _General_Category_Uppercase_Letter) ∪ _General_Category_Uppercase_Letter", 1),
            ("(_General_Category_Uppercase_Letter ∩ A) ∪ (_General_Category_Uppercase_Letter ∩ _General_Category_Uppercase_Letter)", 1),
            ("(A ∖ _General_Category_Uppercase_Letter) ∪ (_General_Category_Uppercase_Letter ∩ _General_Category_Uppercase_Letter)", 1),
            ("(_General_Category_Uppercase_Letter ∩ _General_Category_Uppercase_Letter) ∪ _General_Category_Uppercase_Letter", 0),
            ("(_General_Category_Uppercase_Letter ∖ _General_Category_Uppercase_Letter) ∪ _General_Category_Uppercase_Letter", 0),
        ):
            for prefix, suffix in (
                ('%rule text :: ', '\n | "a"'),
                ('%rule text "a" :: ', ''),
                ('%rule text "a"\n%emits $ :: ', ''),
            ):
                with self.subTest(term=term, clause=prefix):
                    value, _, error, _ = run_case({"grammar": prefix + term + suffix})
                    self.assertIsNone(value)
                    self.assertIsNotNone(error)
                    self.assertEqual(error.kind, "grammar")
                    self.assertIn("cannot introduce engine tags", error.message)
                    offset = list(re.finditer("_General_Category_Uppercase_Letter", term))[retained].start()
                    self.assertEqual((error.line, error.column), (3 + prefix.count("\n"), len(prefix.rsplit("\n", 1)[-1]) + offset + 1))

    def test_captures_preserve_optional_query_priority(self) -> None:
        # Engine §4 fixes the prefix before the element optional. Its
        # present D route reads the written T, even on an absent route.
        for optional in ("[c]", "[$c:c]", "[[$c:c]]", "[($c:c ≻ c)]"):
            with self.subTest(optional=optional):
                grammar = f"%rule text $r:r\n%conditions $r.parse(r)\n%rule r B {optional} [+T] D T\n%rule c D"
                value, _, error, _ = run_case(
                    {
                        "grammar": grammar,
                        "tokens": [{"text": name, "tags": [name]} for name in "BDT"],
                    }
                )
                self.assertIsNone(error)
                self.assertTrue(same_json(value["ok"], False))
                self.assertTrue(same_json(value["error"]["kind"], "rejected"))

    def test_loading_checks_string_types_and_scalar_ranges_before_gates(self) -> None:
        for grammar in (
            "%const $S A\n%rule text $S",
            "%const $S A\n%rule text A := $S",
            '%const $S "ab"\n%rule text gate? $S.."z" | A',
            '%const $S A\n%classifier x\n $S ∈ A\n%rule text A',
        ):
            with self.subTest(grammar=grammar):
                value, _, error, _ = run_case({"grammar": grammar})
                self.assertIsNone(value)
                self.assertEqual(error.kind, "grammar")
                self.assertIsNotNone(error.line)
                self.assertIsNotNone(error.column)

    def test_private_recipe_exports_precede_capture_pruning_and_cycles(self) -> None:
        # Engine §11.4 requires scope analysis before absent-item pruning
        # and effective dependency analysis.
        for recipe in ("$x.value", "$.emitted.value ++ $x.value"):
            with self.subTest(recipe=recipe):
                value, _, error, _ = run_case(
                    {
                        "grammar": f"%rule text ($x:A ≻ B) := {recipe} %emits",
                    }
                )
                self.assertIsNone(value)
                self.assertEqual(error.code, "ranked-choice-export")
