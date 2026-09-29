"""The character table of grammars/unicode.txt (engine §1): the records can
stand in any order, and a caller's table can leave scalar values out."""

from __future__ import annotations

import unittest

import gencmu
from gencmu._dialect import bundled_text
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
            self.assertEqual(reversed_table.lowercase(chr(code)), bundled.lowercase(chr(code)), hex(code))
        self.assertEqual(reversed_table.category(0x61), "Ll")
        self.assertEqual(reversed_table.category(0x41), "Lu")

    def test_an_omitted_scalar_value_is_cn_without_white_space_or_lowercase(self) -> None:
        table = UnicodeTable("unicode 0.0.0\ncategory Lu 0041 005A\n")
        self.assertEqual(table.category(0x41), "Lu")
        self.assertEqual(table.category(0x61), "Cn")
        self.assertEqual(table.category(0x10FFFF), "Cn")
        self.assertEqual(table.category(0x0), "Cn")
        self.assertEqual(table.category(0xD800), "Cs")
        self.assertTrue(table.has_property("Cn", 0x61) and table.has_property("C", 0x61))
        self.assertFalse(table.has_property("L", 0x61) or table.has_property("Cs", 0x61))
        self.assertFalse(table.is_white_space(0x20) or table.is_white_space(0x9))
        self.assertFalse(table.has_property("White_Space", 0x20))
        self.assertEqual(table.lowercase("AB"), "AB")
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
        self.assertFalse(load(sources("'\\p{L}'"), "p.md").parse("a", auto_features=False).ok)
        self.assertTrue(load(sources("'\\p{Cn}'"), "p.md").parse("a", auto_features=False).ok)
        bundled = sources("'\\p{L}'")
        del bundled["unicode.txt"]
        self.assertTrue(load(bundled, "p.md").parse("a", auto_features=False).ok)


if __name__ == "__main__":
    unittest.main()
