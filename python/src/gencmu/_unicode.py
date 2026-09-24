"""The character table every library shares, grammars/unicode.txt (engine §1)."""

from __future__ import annotations

from bisect import bisect_right

from ._errors import GencmuError

_SPACES = frozenset(
    [*range(0x09, 0x0E), 0x20, 0x85, 0xA0, 0x1680, *range(0x2000, 0x200B), 0x2028, 0x2029, 0x202F, 0x205F, 0x3000]
)


class UnicodeTable:
    """Character classes and simple lower-case mappings."""

    def __init__(self, text: str) -> None:
        marks: list[tuple[int, int]] = []
        alphas: list[tuple[int, int]] = []
        self.lower: dict[int, int] = {}
        self.version = ""
        for number, line in enumerate(text.splitlines(), 1):
            fields = line.split()
            if not fields:
                continue
            try:
                if fields[0] == "unicode":
                    self.version = fields[1]
                elif fields[0] == "mark":
                    marks.append((int(fields[1], 16), int(fields[2], 16)))
                elif fields[0] == "alpha":
                    alphas.append((int(fields[1], 16), int(fields[2], 16)))
                elif fields[0] == "lower":
                    self.lower[int(fields[1], 16)] = int(fields[2], 16)
                else:
                    raise ValueError(fields[0])
            except (ValueError, IndexError) as error:
                raise GencmuError(f"unreadable line: {line!r}", document="unicode.txt", line=number) from error
        marks.sort()
        alphas.sort()
        self._mark_starts = [start for start, _ in marks]
        self._mark_ends = [end for _, end in marks]
        self._alpha_starts = [start for start, _ in alphas]
        self._alpha_ends = [end for _, end in alphas]
        self._classes: dict[str, str] = {}

    @staticmethod
    def _within(code: int, starts: list[int], ends: list[int]) -> bool:
        index = bisect_right(starts, code) - 1
        return index >= 0 and code <= ends[index]

    def character_class(self, char: str) -> str:
        cached = self._classes.get(char)
        if cached is not None:
            return cached
        code = ord(char)
        if code in _SPACES:
            result = "space"
        elif 0x30 <= code <= 0x39:
            result = "digit"
        elif self._within(code, self._mark_starts, self._mark_ends):
            result = "mark"
        elif self._within(code, self._alpha_starts, self._alpha_ends):
            result = "alpha"
        else:
            result = "other"
        self._classes[char] = result
        return result

    def lowercase(self, text: str) -> str:
        lower = self.lower
        return "".join(chr(lower.get(ord(char), ord(char))) for char in text)
