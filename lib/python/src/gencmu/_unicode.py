"""The character table every library shares, grammars/unicode.txt (engine §1):
the General_Category of a character and the White_Space property."""

from __future__ import annotations

from bisect import bisect_right
import re

from ._errors import GencmuError
from ._hash import fnv1a64
from ._unicode_names_catalog import PINNED_CORE_NAMES
from ._unicode_properties import read_properties
from ._unicode_property_catalog import PROPERTY_CATALOG

CATEGORIES = (
    "Lu", "Ll", "Lt", "Lm", "Lo", "Mn", "Mc", "Me", "Nd", "Nl", "No", "Pc", "Pd", "Ps", "Pe", "Pi", "Pf", "Po",
    "Sm", "Sc", "Sk", "So", "Zs", "Zl", "Zp", "Cc", "Cf", "Cs", "Co", "Cn",
)  # fmt: skip
"""The General_Category values in their short form (engine §1)."""


def _number(field: str, base: int, limit: int) -> int:
    alphabet = "0123456789abcdefABCDEF" if base == 16 else "0123456789"
    if not field or any(c not in alphabet for c in field):
        raise ValueError(field)
    digits = field.lstrip("0")
    if len(digits) > limit:
        raise ValueError(field)
    return int(digits or "0", base)


class UnicodeTable:
    """Character properties and canonical decomposition from the shared table."""

    def __init__(self, text: str, properties: str | None = None) -> None:
        self.emoji: dict[str, list[tuple[int, int]]] = {"Emoji_Presentation": [], "Emoji_Component": []}
        categories: list[tuple[int, int, str]] = []
        white_space: list[tuple[int, int]] = []
        combining: list[tuple[int, int, int]] = []
        self.decompositions: dict[int, tuple[int, ...]] = {}
        self.fingerprint = fnv1a64(text)
        self.version = ""
        self.version_count = 0
        self.abbreviations: dict[str, int] = {}
        self.canonical_abbreviations: dict[int, str] = {}
        lines = text.split("\n")
        for number, raw in enumerate(lines, 1):
            line = raw.removesuffix("\r") if number < len(lines) else raw
            fields = [field for field in re.split(r"[ \t]+", line) if field]
            if not fields:
                continue
            try:
                entry = fields[0]
                count = {"unicode": 2, "category": 4, "combining": 4, "white-space": 3,
                         "emoji-presentation": 3, "emoji-component": 3, "abbreviation": 3}.get(entry)
                if entry == "decompose":
                    if len(fields) < 3:
                        raise ValueError(entry)
                elif count is None or len(fields) != count:
                    raise ValueError(entry)
                code_fields = fields[1:2] if entry == "abbreviation" else fields[1:] if entry == "decompose" else fields[2:] if entry in ("category", "combining") else fields[1:] if entry != "unicode" else []
                codes = [_number(field, 16, 6) for field in code_fields]
                if any(code > 0x10FFFF for code in codes):
                    raise ValueError(entry)
                if entry == "decompose":
                    if any(0xD800 <= code <= 0xDFFF for code in codes):
                        raise ValueError(entry)
                elif len(codes) == 2 and codes[0] > codes[1]:
                    raise ValueError(entry)
                if fields[0] == "unicode":
                    self.version = fields[1]
                    self.version_count += 1
                elif entry == "abbreviation":
                    code, alias = codes[0], fields[2]
                    if (0xD800 <= code <= 0xDFFF or re.fullmatch(r"[A-Z][A-Z0-9]*", alias) is None
                            or alias in self.abbreviations or alias in PINNED_CORE_NAMES and PINNED_CORE_NAMES[alias] != code):
                        raise ValueError(entry)
                    self.abbreviations[alias] = code
                    earlier = self.canonical_abbreviations.get(code)
                    if earlier is None or (len(alias), alias) < (len(earlier), earlier):
                        self.canonical_abbreviations[code] = alias
                elif fields[0] == "category":
                    if fields[1] not in CATEGORIES:
                        raise ValueError(fields[1])
                    categories.append((codes[0], codes[1], fields[1]))
                elif fields[0] == "white-space":
                    white_space.append((codes[0], codes[1]))
                elif fields[0] in ("emoji-presentation", "emoji-component"):
                    prop = "Emoji_Presentation" if fields[0] == "emoji-presentation" else "Emoji_Component"
                    self.emoji[prop].append((codes[0], codes[1]))
                elif fields[0] == "decompose":
                    self.decompositions[codes[0]] = tuple(codes[1:])
                elif fields[0] == "combining":
                    klass = _number(fields[1], 10, 3)
                    if not 1 <= klass <= 254:
                        raise ValueError(fields[1])
                    combining.append((codes[0], codes[1], klass))
                else:
                    raise ValueError(fields[0])
            except (ValueError, IndexError) as error:
                raise GencmuError(f"unreadable line: {line!r}", document="unicode.txt", line=number) from error
        for prop, ranges in self.emoji.items():
            union: list[tuple[int, int]] = []
            for start, end in sorted(ranges):
                if union and start <= union[-1][1] + 1:
                    union[-1] = (union[-1][0], max(union[-1][1], end))
                else:
                    union.append((start, end))
            self.emoji[prop] = union
        self._emoji_starts = {prop: [start for start, _ in ranges] for prop, ranges in self.emoji.items()}
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
        self.properties = read_properties(properties, self.version, self.version_count) if properties is not None else {}
        self.properties_fingerprint = fnv1a64(properties) if properties is not None else None
        self._profiles = {}

    def canonical_tag(self, spelling: str) -> str | None:
        canonical = PROPERTY_CATALOG["aliases"].get(spelling)
        if canonical is None:
            return None
        prop, value = PROPERTY_CATALOG["tags"][canonical]
        if prop in PROPERTY_CATALOG["core"]:
            return canonical
        data = self.properties.get(prop)
        return canonical if data is not None and (data.kind == "binary" or value in data.values) else None

    def profile(self, code: int) -> frozenset[str]:
        cached = self._profiles.get(code)
        if cached is not None:
            return cached
        category = self.category(code)
        tags = {PROPERTY_CATALOG["aliases"]["_" + category], PROPERTY_CATALOG["aliases"]["_" + category[0]],
                PROPERTY_CATALOG["combining"][str(self.combining_class(code))]}
        if self.is_white_space(code):
            tags.add("_White_Space")
        for prop in ("Emoji_Presentation", "Emoji_Component"):
            if self.has_emoji(prop, code):
                tags.add("_" + prop)
        for prop, data in self.properties.items():
            low, high = 0, len(data.ranges)
            while low < high:
                mid = (low + high) // 2
                if data.ranges[mid][0] <= code:
                    low = mid + 1
                else:
                    high = mid
            record = data.ranges[low - 1] if low else None
            values = record[2] if record is not None and code <= record[1] else data.defaults
            if data.kind == "binary":
                if values:
                    tags.add("_" + prop)
            else:
                tags.update("_" + prop + "_" + value for value in values)
        profile = frozenset(tags)
        if len(self._profiles) >= 4096:
            self._profiles.clear()
        self._profiles[code] = profile
        return profile

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

    def has_emoji(self, prop: str, code: int) -> bool:
        index = bisect_right(self._emoji_starts[prop], code) - 1
        return index >= 0 and code <= self.emoji[prop][index][1]

    def is_emoji_name(self, name: str) -> bool:
        return name not in ("#", "@") and len(name) == 1 and self.has_emoji("Emoji_Presentation", ord(name)) and not self.has_emoji("Emoji_Component", ord(name))

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
