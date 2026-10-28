"""Canonical decomposition from the shared Unicode 15.1 conformance data."""

import unittest

from gencmu._pipeline import bundled_text
from gencmu._unicode import UnicodeTable

from .shared import SHARED


class Normalization(unittest.TestCase):
    def test_unicode_conformance(self) -> None:
        table = UnicodeTable(bundled_text("data/unicode/unicode.txt") or "")
        listed: set[int] = set()
        part = ""
        count = 0
        for line in (SHARED / "unicode" / "NormalizationTest.txt").read_text(encoding="utf-8").splitlines():
            data = line.split("#")[0].strip()
            if data.startswith("@"):
                part = data.split()[0]
                continue
            if not data:
                continue
            columns = ["".join(chr(int(code, 16)) for code in column.split()) for column in data.split(";")[:5]]
            for index, column in enumerate(columns):
                self.assertEqual(table.decompose(column), columns[2 if index < 3 else 4], f"row {count + 1}, column {index + 1}")
            if part == "@Part1":
                listed.add(ord(columns[0]))
            count += 1
        self.assertEqual(count, 19074)
        for code in range(0x110000):
            if 0xD800 <= code <= 0xDFFF or code in listed:
                continue
            self.assertEqual(table.decompose(chr(code)), chr(code), f"unlisted U+{code:04X}")

    def test_origins_and_stable_order(self) -> None:
        table = UnicodeTable(bundled_text("data/unicode/unicode.txt") or "")
        self.assertEqual(table.decompose_with_origins("á\u0323"), [("a", 0), ("\u0323", 1), ("\u0301", 0)])
        self.assertEqual(table.decompose_with_origins("\u0301\u0300a\u0315\u0301"),
                         [("\u0301", 0), ("\u0300", 1), ("a", 2), ("\u0301", 4), ("\u0315", 3)])
        self.assertEqual(table.decompose("ﬁ²Ｋ"), "ﬁ²Ｋ")

    def test_custom_table_and_record_order(self) -> None:
        text = "unicode 0.0.0\ndecompose 00E1 0061 0301\ncombining 230 0301 0301\ncombining 220 0323 0323\n"
        table = UnicodeTable(text)
        reverse = UnicodeTable("\n".join(reversed(text.splitlines())))
        self.assertEqual(reverse.decompose_with_origins("á\u0323"), table.decompose_with_origins("á\u0323"))
        self.assertEqual(UnicodeTable("").decompose("á\u0323각"), "á\u0323\u1100\u1161\u11a8")
        self.assertEqual(UnicodeTable("decompose 00E1 0061 0301").decompose("á\u0323"), "a\u0301\u0323")
