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
    decompose 00E1 0061 0301   a full canonical decomposition
    combining 230 0300 0314   a range of one nonzero combining class

The records follow this order: unicode, category, white-space, decompose, combining.
Hangul syllables decompose by arithmetic and have no records.
The tool compares its generated decomposition with Python before it writes the file.
"""
import pathlib
import random
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

HANGUL_FIRST, HANGUL_LAST = 0xAC00, 0xD7A3

def decompositions():
    """The full canonical decomposition of every scalar that NFD changes, Hangul syllables aside."""
    for code in scalar_values():
        if HANGUL_FIRST <= code <= HANGUL_LAST:
            continue
        nfd = unicodedata.normalize("NFD", chr(code))
        if nfd != chr(code):
            yield code, [ord(c) for c in nfd]

def combining_ranges():
    """The longest runs of one nonzero Canonical_Combining_Class."""
    run = None
    for code in scalar_values():
        klass = unicodedata.combining(chr(code))
        if run and klass == run[0] and code == run[2] + 1:
            run[2] = code
            continue
        if run and run[0]:
            yield tuple(run)
        run = [klass, code, code]
    if run and run[0]:
        yield tuple(run)

def library_nfd(text, table, classes):
    """The algorithm of engine §1, over the records that the tool writes."""
    def klass(code):
        return classes.get(code, 0)
    out = []
    for ch in text:
        code = ord(ch)
        if HANGUL_FIRST <= code <= HANGUL_LAST:
            s = code - HANGUL_FIRST
            out += [0x1100 + s // 588, 0x1161 + (s % 588) // 28] + ([0x11A7 + s % 28] if s % 28 else [])
        else:
            out += table.get(code, [code])
    result, i = [], 0
    while i < len(out):
        if klass(out[i]) == 0:
            result.append(out[i])
            i += 1
            continue
        j = i
        while j < len(out) and klass(out[j]) != 0:
            j += 1
        result += sorted(out[i:j], key=klass)
        i = j
    return "".join(map(chr, result))

def check(table, ranges, samples=20000, seed=15):
    """Stop with an error where the records disagree with Python's NFD."""
    classes = {code: k for k, start, end in ranges for code in range(start, end + 1)}
    for code in scalar_values():
        c = chr(code)
        if library_nfd(c, table, classes) != unicodedata.normalize("NFD", c):
            raise SystemExit(f"U+{code:04X}: the records disagree with NFD")
    marks = [code for k, s, e in ranges for code in range(s, e + 1)]
    pool = list(table) + marks + [0x61, 0x41, 0xAC00, 0xD7A3]
    rng = random.Random(seed)
    for _ in range(samples):
        s = "".join(chr(rng.choice(pool)) for _ in range(rng.randint(1, 6)))
        if library_nfd(s, table, classes) != unicodedata.normalize("NFD", s):
            raise SystemExit(f"{s!r}: the records disagree with NFD")


def main():
    lines = [f"unicode {unicodedata.unidata_version}"]
    for category, start, end in category_ranges():
        lines.append(f"category {category} {start:04X} {end:04X}")
    for start, end in WHITE_SPACE:
        lines.append(f"white-space {start:04X} {end:04X}")
    table = dict(decompositions())
    ranges = list(combining_ranges())
    check(table, ranges)
    for code, scalars in table.items():
        lines.append("decompose " + " ".join(f"{c:04X}" for c in [code] + scalars))
    for klass, start, end in ranges:
        lines.append(f"combining {klass} {start:04X} {end:04X}")
    path = pathlib.Path(__file__).resolve().parent.parent / "grammars" / "unicode.txt"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{path}: {len(lines)} lines, Unicode {unicodedata.unidata_version}", file=sys.stderr)

if __name__ == "__main__":
    main()
