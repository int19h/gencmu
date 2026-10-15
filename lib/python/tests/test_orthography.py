"""Stage zero preserves original text through canonical decomposition."""

import unittest

import gencmu
from gencmu._dialect import bundled_text, character_tokens
from gencmu._unicode import UnicodeTable


class StageZero(unittest.TestCase):
    def test_expansion_and_reordering_preserve_sources(self) -> None:
        table = UnicodeTable(bundled_text("unicode.txt") or "")
        for text, values, origins in (
            ("á", "a\u0301", [0, 0]),
            ("a\u0301\u0323", "a\u0323\u0301", [0, 2, 1]),
            ("á\u0323", "a\u0323\u0301", [0, 1, 0]),
            ("각", "\u1100\u1161\u11a8", [0, 0, 0]),
        ):
            with self.subTest(text=text):
                tokens = character_tokens(text, table)
                self.assertEqual([token.value for token in tokens], list(values))
                self.assertEqual([token.image for token in tokens], list(values))
                self.assertEqual([token.text for token in tokens], [text[i] for i in origins])
                self.assertEqual([token.source for token in tokens], [(i, i + 1) for i in origins])
                self.assertEqual([token.span for token in tokens], [(i, i + 1) for i in range(len(values))])
        self.assertEqual(character_tokens("á", table)[1].tags, frozenset({"_Mn", "_M"}))

    def test_scalar_validation_precedes_decomposition(self) -> None:
        class UnusedTable(UnicodeTable):
            def decompose_with_origins(self, text):
                raise AssertionError("decomposition must not run")

        with self.assertRaises(gencmu.GencmuError) as caught:
            character_tokens("á\ud800", UnusedTable(""))
        self.assertEqual(caught.exception.kind, "usage")
