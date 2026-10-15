"""The character table every library shares, grammars/unicode.txt (engine §1):
the General_Category of a character and the White_Space property."""

from __future__ import annotations

from bisect import bisect_right

from ._errors import GencmuError
from ._hash import fnv1a64

CATEGORIES = (
    "Lu", "Ll", "Lt", "Lm", "Lo", "Mn", "Mc", "Me", "Nd", "Nl", "No", "Pc", "Pd", "Ps", "Pe", "Pi", "Pf", "Po",
    "Sm", "Sc", "Sk", "So", "Zs", "Zl", "Zp", "Cc", "Cf", "Cs", "Co", "Cn",
)  # fmt: skip
"""The General_Category values in their short form (engine §1)."""

class UnicodeTable:
    """Character properties and canonical decomposition from the shared table."""

    def __init__(self, text: str) -> None:
        categories: list[tuple[int, int, str]] = []
        white_space: list[tuple[int, int]] = []
        combining: list[tuple[int, int, int]] = []
        self.decompositions: dict[int, tuple[int, ...]] = {}
        self.fingerprint = fnv1a64(text)
        self.version = ""
        for number, line in enumerate(text.splitlines(), 1):
            fields = line.split()
            if not fields:
                continue
            try:
                if fields[0] == "unicode":
                    self.version = fields[1]
                elif fields[0] == "category":
                    if fields[1] not in CATEGORIES:
                        raise ValueError(fields[1])
                    categories.append((int(fields[2], 16), int(fields[3], 16), fields[1]))
                elif fields[0] == "white-space":
                    white_space.append((int(fields[1], 16), int(fields[2], 16)))
                elif fields[0] == "decompose":
                    self.decompositions[int(fields[1], 16)] = tuple(int(field, 16) for field in fields[2:])
                elif fields[0] == "combining":
                    combining.append((int(fields[2], 16), int(fields[3], 16), int(fields[1])))
                else:
                    raise ValueError(fields[0])
            except (ValueError, IndexError) as error:
                raise GencmuError(f"unreadable line: {line!r}", document="unicode.txt", line=number) from error
        categories.sort()
        white_space.sort()
        combining.sort()
        self._combining_starts = [start for start, _, _ in combining]
        self._combining_ends = [end for _, end, _ in combining]
        self._combining_classes = [klass for _, _, klass in combining]
        self._starts = [start for start, _, _ in categories]
        self._ends = [end for _, end, _ in categories]
        self._categories = [category for _, _, category in categories]
        self._space_starts = [start for start, _ in white_space]
        self._space_ends = [end for _, end in white_space]

    def category(self, code: int) -> str:
        """The General_Category of a code point, in its short form, by a
        binary search of the category ranges (engine §1): ``Cs`` for a
        surrogate, which a table does not list, and ``Cn`` for any other code
        point that the table omits."""
        if 0xD800 <= code <= 0xDFFF:
            return "Cs"
        index = bisect_right(self._starts, code) - 1
        if index >= 0 and code <= self._ends[index]:
            return self._categories[index]
        return "Cn"

    def is_mark(self, code: int) -> bool:
        """Whether a code point is a nonspacing mark, of General_Category
        ``Mn``. A character tag writes such a character escaped (engine §1)."""
        return self.category(code) == "Mn"

    def combining_class(self, code: int) -> int:
        """The canonical combining class, or zero for an omitted scalar."""
        index = bisect_right(self._combining_starts, code) - 1
        if index >= 0 and code <= self._combining_ends[index]:
            return self._combining_classes[index]
        return 0

    def changes_in_document(self, code: int) -> bool:
        return code in self.decompositions or 0xAC00 <= code <= 0xD7A3 or self.combining_class(code) != 0

    def decompose_with_origins(self, text: str) -> list[tuple[str, int]]:
        """Decompose scalars and retain their original code point positions."""
        result: list[tuple[str, int]] = []
        marks: list[tuple[int, str, int]] = []
        for origin, character in enumerate(text):
            code = ord(character)
            if 0xAC00 <= code <= 0xD7A3:
                syllable = code - 0xAC00
                scalars = (0x1100 + syllable // 588, 0x1161 + syllable % 588 // 28)
                if syllable % 28:
                    scalars += (0x11A7 + syllable % 28,)
            else:
                scalars = self.decompositions.get(code, (code,))
            for scalar in scalars:
                klass = self.combining_class(scalar)
                if klass:
                    marks.append((klass, chr(scalar), origin))
                else:
                    if marks:
                        result.extend((char, at) for _, char, at in sorted(marks, key=lambda item: item[0]))
                        marks.clear()
                    result.append((chr(scalar), origin))
        result.extend((char, at) for _, char, at in sorted(marks, key=lambda item: item[0]))
        return result

    def decompose(self, text: str) -> str:
        return "".join(character for character, _ in self.decompose_with_origins(text))

    def is_white_space(self, code: int) -> bool:
        """Whether a code point has the White_Space property."""
        index = bisect_right(self._space_starts, code) - 1
        return index >= 0 and code <= self._space_ends[index]
