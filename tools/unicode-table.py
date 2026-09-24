#!/usr/bin/env python3
"""Writes grammars/unicode.txt, the character data every gencmu library uses.

The engine classifies characters and lower-cases strings with this table
rather than with the platform's own Unicode data, so that the four libraries
agree on every character whatever version their platform has. The table is
generated from the Unicode data of the Python that runs this script, whose
version it records; regenerate it deliberately, and review the change.

Format, one entry per line, code points in hexadecimal:

    unicode 15.1.0
    mark 0300 036F        a range of General_Category Mn
    alpha 0041 005A       a range of General_Category Lu, Ll, Lt, Lm or Lo
    lower 0041 0061       a code point and its simple lowercase mapping
"""
import pathlib
import sys
import unicodedata

def ranges(predicate):
    start = None
    for code in range(0x110000):
        inside = predicate(chr(code))
        if inside and start is None:
            start = code
        elif not inside and start is not None:
            yield start, code - 1
            start = None
    if start is not None:
        yield start, 0x10FFFF

def main():
    lines = [f"unicode {unicodedata.unidata_version}"]
    for start, end in ranges(lambda c: unicodedata.category(c) == "Mn"):
        lines.append(f"mark {start:04X} {end:04X}")
    for start, end in ranges(lambda c: unicodedata.category(c) in ("Lu", "Ll", "Lt", "Lm", "Lo")):
        lines.append(f"alpha {start:04X} {end:04X}")
    for code in range(0x110000):
        c = chr(code)
        lower = c.lower()
        # The simple mapping is one code point to one code point; str.lower
        # applies the full mapping, which differs only where it expands.
        if len(lower) == 1 and lower != c:
            lines.append(f"lower {code:04X} {ord(lower):04X}")
        elif code == 0x0130:
            # The one character whose full lowercase mapping expands
            # (SpecialCasing.txt); its simple mapping is U+0069.
            lines.append("lower 0130 0069")
    path = pathlib.Path(__file__).resolve().parent.parent / "grammars" / "unicode.txt"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{path}: {len(lines)} lines, Unicode {unicodedata.unidata_version}", file=sys.stderr)

if __name__ == "__main__":
    main()
