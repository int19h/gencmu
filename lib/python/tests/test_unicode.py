"""The character table of grammars/unicode.txt (engine §1): the records can
stand in any order, and a caller's table can leave scalar values out."""

from __future__ import annotations

import unittest

import gencmu
from gencmu._dialect import bundled_text, character_tokens
from gencmu._unicode import UnicodeTable

BUNDLED = bundled_text("unicode.txt") or ""


def _boundaries() -> list[int]:
    """Every code point next to a boundary of a record, where an unsorted
    search goes wrong first."""
    points: set[int] = set()
    for line in BUNDLED.splitlines():
        for field in line.split()[1:]:
            try:
                value = int(field, 16)
            except ValueError:
                continue
            points.update(point for point in (value - 1, value, value + 1) if 0 <= point <= 0x10FFFF)
    return sorted(points)


class UnicodeTableOrder(unittest.TestCase):
    def test_records_in_any_order_give_the_same_answers(self) -> None:
        bundled = UnicodeTable(BUNDLED)
        reversed_table = UnicodeTable("\n".join(reversed(BUNDLED.splitlines())))
        self.assertEqual(reversed_table.version, bundled.version)
        for code in _boundaries():
            self.assertEqual(reversed_table.category(code), bundled.category(code), hex(code))
            self.assertEqual(reversed_table.is_white_space(code), bundled.is_white_space(code), hex(code))
            if not 0xD800 <= code <= 0xDFFF:
                self.assertEqual(character_tokens(chr(code), reversed_table), character_tokens(chr(code), bundled), hex(code))
        self.assertEqual(reversed_table.category(0x61), "Ll")
        self.assertEqual(reversed_table.category(0x41), "Lu")

    def test_an_omitted_scalar_value_is_cn_without_white_space_or_normalization(self) -> None:
        table = UnicodeTable("unicode 0.0.0\ncategory Lu 0041 005A\n")
        self.assertEqual(table.category(0x41), "Lu")
        self.assertEqual(table.category(0x61), "Cn")
        self.assertEqual(table.category(0x10FFFF), "Cn")
        self.assertEqual(table.category(0x0), "Cn")
        self.assertEqual(table.category(0xD800), "Cs")
        token = character_tokens("a", table)[0]
        self.assertEqual(token.tags, frozenset({"_Canonical_Combining_Class_Not_Reordered", "_General_Category_Unassigned", "_General_Category_Other"}))
        self.assertFalse({"_General_Category_Letter", "_General_Category_Surrogate"} & token.tags)
        self.assertFalse(table.is_white_space(0x20) or table.is_white_space(0x9))
        self.assertNotIn("_White_Space", character_tokens(" ", table)[0].tags)
        self.assertEqual([token.value for token in character_tokens("AB", table)], ["A", "B"])
        self.assertFalse(table.is_mark(0x301))


class CallerTable(unittest.TestCase):
    def test_a_callers_table_replaces_the_bundled_one(self) -> None:
        # A table that knows no letters, only the white space that the
        # notation reads between tokens.
        table = "unicode 0.0.0\nwhite-space 0009 000D\nwhite-space 0020 0020\n"

        def sources(rule: str) -> dict[str, str]:
            return {
                "p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n',
                "g.md": f"```jbogenbau\n%ambiguity-resolution greedy\n%rule text {rule}\n```\n",
                "unicode.txt": table,
            }

        load = gencmu.load_dialect_sources
        self.assertFalse(load(sources("_General_Category_Letter"), "p.md").parse("a").ok)
        self.assertTrue(load(sources("_General_Category_Unassigned"), "p.md").parse("a").ok)
        bundled = sources("_General_Category_Letter")
        del bundled["unicode.txt"]
        self.assertTrue(load(bundled, "p.md").parse("a").ok)


class LoneSurrogates(unittest.TestCase):
    """A text or a document with a lone surrogate is a usage error, refused
    before any character token (engine §1)."""

    @staticmethod
    def _sources(rule: str) -> dict[str, str]:
        return {
            "p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n',
            "g.md": f"```jbogenbau\n%ambiguity-resolution greedy\n%rule text {rule}\n```\n",
        }

    def test_a_text_with_a_lone_surrogate_is_a_usage_error(self) -> None:
        # Each of these would read U+D800 if it became a character tag.
        rules = ("_General_Category_Surrogate", "_", '"‹U+D7FF›".."‹U+E000›"', "[{character}]\n%rule character _")
        for rule in rules:
            dialect = gencmu.load_dialect_sources(self._sources(rule), "p.md")
            for text in ("\ud800", "a\udc00", "\udbff\udbff", "\udfff\ud800"):
                with self.subTest(rule=rule, text=ascii(text)):
                    with self.assertRaises(gencmu.GencmuError) as caught:
                        dialect.parse(text)
                    self.assertEqual(caught.exception.kind, "usage")
                    with self.assertRaises(gencmu.GencmuError) as caught:
                        dialect.parse_tokens([], text)
                    self.assertEqual(caught.exception.kind, "usage")
        dialect = gencmu.load_dialect_sources(self._sources("_"), "p.md")
        self.assertTrue(dialect.parse("\U0001f600").ok)

    def test_a_document_with_a_lone_surrogate_is_a_usage_error(self) -> None:
        with self.assertRaises(gencmu.GencmuError) as caught:
            gencmu.load_dialect_sources(self._sources("'\ud800'"), "p.md", use_cache=False)
        self.assertEqual(caught.exception.kind, "usage")
        self.assertEqual(caught.exception.document, "g.md")


if __name__ == "__main__":
    unittest.main()
