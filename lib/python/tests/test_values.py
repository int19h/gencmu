"""Independent checks of values and logical helpers from the specification."""

from __future__ import annotations

import unittest
import re

from .shared import run_case


class Values(unittest.TestCase):
    def test_engine_tag_diagnostics_follow_retained_occurrences(self) -> None:
        # Engine §1 retains occurrences, rather than every occurrence of
        # a name that survives somewhere else in the term.
        for term, retained in (
            ("(_Lu ∩ A) ∪ _Lu", 1),
            ("(A ∖ _Lu) ∪ _Lu", 1),
            ("(_Lu ∩ A) ∪ (_Lu ∩ _Lu)", 1),
            ("(A ∖ _Lu) ∪ (_Lu ∩ _Lu)", 1),
            ("(_Lu ∩ _Lu) ∪ _Lu", 0),
            ("(_Lu ∖ _Lu) ∪ _Lu", 0),
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
                    offset = list(re.finditer("_Lu", term))[retained].start()
                    self.assertEqual((error.line, error.column), (3 + prefix.count("\n"), len(prefix.rsplit("\n", 1)[-1]) + offset + 1))

    def test_captures_preserve_optional_query_priority(self) -> None:
        # Engine §4 fixes the prefix before the logical optional. Its
        # present D route reads the written T, even on an absent route.
        for optional in ("[c]", "[$c:c]", "[[$c:c]]", "[($c:c ≻ c)]"):
            with self.subTest(optional=optional):
                grammar = f"%rule text $r:r\n%conditions $r.matches(r)\n%rule r B {optional} [+T] D T\n%rule c D"
                value, _, error, _ = run_case(
                    {
                        "grammar": grammar,
                        "tokens": [{"text": name, "tags": [name]} for name in "BDT"],
                    }
                )
                self.assertIsNone(error)
                self.assertFalse(value["ok"])
                self.assertEqual(value["error"]["kind"], "rejected")

    def test_binding_checks_string_types_and_scalar_ranges_before_gates(self) -> None:
        for grammar in (
            "%const $S A\n%rule text $S",
            "%const $S A\n%rule text A := $S",
            '%const $S "ab"\n%rule text gate? $S.."z" | A',
            '%const $S A\n%classifier x\n "$(S)" ∈ A\n%rule text A',
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
        for recipe in ("$x.value", "$.emitted.value $x.value"):
            with self.subTest(recipe=recipe):
                value, _, error, _ = run_case(
                    {
                        "grammar": f"%rule text ($x:A ≻ B) := {recipe} %emits",
                    }
                )
                self.assertIsNone(value)
                self.assertEqual(error.code, "ranked-choice-export")
