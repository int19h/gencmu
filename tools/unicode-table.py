#!/usr/bin/env python3
"""Writes grammars/unicode.txt, the character data every gencmu library uses.

The engine reads Unicode properties from this table
rather than with the platform's own Unicode data, so that the four libraries
agree on every character whatever version their platform has. The table is
generated from the Unicode data of the Python that runs this script, whose
version it records; regenerate it deliberately, and review the change.

Format, one entry per line, code points in hexadecimal (docs/engine.md, §1):

    unicode 15.1.0
    category Lu 0041 005A   a range of one General_Category, in its short
                            form; each range is a longest run of one
                            category, and together the ranges hold every
                            Unicode scalar value once, Cn included, and no
                            surrogate
    white-space 0009 000D   a range of the White_Space property

The category lines come first, in the order of their code points, then the
white-space lines.
"""
import pathlib
import sys
import unicodedata

# The White_Space property, from PropList.txt. Python has no API for it, and
# it has not changed since Unicode 6.3. Each entry is a range, first and last.
WHITE_SPACE = [
    (0x0009, 0x000D),
    (0x0020, 0x0020),
    (0x0085, 0x0085),
    (0x00A0, 0x00A0),
    (0x1680, 0x1680),
    (0x2000, 0x200A),
    (0x2028, 0x2029),
    (0x202F, 0x202F),
    (0x205F, 0x205F),
    (0x3000, 0x3000),
]

def scalar_values():
    """Every Unicode scalar value: every code point but the surrogates."""
    yield from range(0xD800)
    yield from range(0xE000, 0x110000)

def category_ranges():
    """The longest runs of one General_Category, over the scalar values."""
    start = previous = category = None
    for code in scalar_values():
        current = unicodedata.category(chr(code))
        if category is not None and (current != category or code != previous + 1):
            yield category, start, previous
            start = None
        if start is None:
            start, category = code, current
        previous = code
    yield category, start, previous

def main():
    lines = [f"unicode {unicodedata.unidata_version}"]
    for category, start, end in category_ranges():
        lines.append(f"category {category} {start:04X} {end:04X}")
    for start, end in WHITE_SPACE:
        lines.append(f"white-space {start:04X} {end:04X}")
    path = pathlib.Path(__file__).resolve().parent.parent / "grammars" / "unicode.txt"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{path}: {len(lines)} lines, Unicode {unicodedata.unidata_version}", file=sys.stderr)

if __name__ == "__main__":
    main()
