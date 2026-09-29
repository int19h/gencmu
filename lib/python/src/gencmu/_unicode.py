"""The character table every library shares, grammars/unicode.txt (engine §1):
the General_Category of a character, the White_Space property, and the simple
lowercase mapping."""

from __future__ import annotations

from bisect import bisect_right

from ._errors import GencmuError

CATEGORIES = (
    "Lu", "Ll", "Lt", "Lm", "Lo", "Mn", "Mc", "Me", "Nd", "Nl", "No", "Pc", "Pd", "Ps", "Pe", "Pi", "Pf", "Po",
    "Sm", "Sc", "Sk", "So", "Zs", "Zl", "Zp", "Cc", "Cf", "Cs", "Co", "Cn",
)  # fmt: skip
"""The General_Category values in their short form (engine §1)."""

PROPERTY_NAMES = frozenset((*CATEGORIES, "L", "M", "N", "P", "S", "Z", "C", "White_Space", "Any"))
"""The names a property can have (engine §1): the General_Category values in
their short form, their one-letter groups, White_Space and Any."""


class UnicodeTable:
    """General_Category ranges, White_Space ranges and simple lower-case
    mappings."""

    def __init__(self, text: str) -> None:
        categories: list[tuple[int, int, str]] = []
        white_space: list[tuple[int, int]] = []
        self.lower: dict[int, int] = {}
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
                elif fields[0] == "lower":
                    self.lower[int(fields[1], 16)] = int(fields[2], 16)
                else:
                    raise ValueError(fields[0])
            except (ValueError, IndexError) as error:
                raise GencmuError(f"unreadable line: {line!r}", document="unicode.txt", line=number) from error
        categories.sort()
        white_space.sort()
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

    def is_white_space(self, code: int) -> bool:
        """Whether a code point has the White_Space property."""
        index = bisect_right(self._space_starts, code) - 1
        return index >= 0 and code <= self._space_ends[index]

    def has_property(self, name: str, code: int) -> bool:
        """Whether a scalar value has a property (engine §1), whose name must
        be one of ``PROPERTY_NAMES``."""
        if name == "Any":
            return True
        if name == "White_Space":
            return self.is_white_space(code)
        if len(name) == 1:
            return self.category(code)[0] == name
        return self.category(code) == name

    def lowercase(self, text: str) -> str:
        lower = self.lower
        return "".join(chr(lower.get(ord(char), ord(char))) for char in text)
