"""Tags and tag sets (engine §1), and their interning.

A tag is a string in its canonical spelling: an identifier tag is a name, a
phoneme tag is ``/p/``, and a character tag is one character between quotes,
``'a'``. A tag has no strength, so a tag set is a set of these strings.
"""

from __future__ import annotations

import re
from typing import Iterable, Protocol

from ._model import Tags

EMPTY: Tags = frozenset()


def tag_set(tags: Iterable[str] = ()) -> Tags:
    return frozenset(tags)


def union(left: Tags, right: Tags) -> Tags:
    """Every tag of either."""
    if not right:
        return left
    if not left:
        return right
    return left | right


def intersection(left: Tags, right: Tags) -> Tags:
    """The tags of both."""
    return left & right


def difference(left: Tags, right: Tags) -> Tags:
    """The tags of the first that are not in the second."""
    return left - right


def sorted_tags(tags: Iterable[str]) -> list[str]:
    """Tags in code point order, as the output lists them (docs/output.md)."""
    return sorted(tags)


PAUSE = "."
"""The pause, the phonemes of the tag ``/./`` (engine §5)."""


def phoneme_of(tag: str) -> str | None:
    """The phonemes of a phoneme tag ``/p/``, ``.`` for the pause, or
    ``None`` for another tag."""
    if len(tag) == 3 and tag[0] == "/" and tag[2] == "/":
        return tag[1]
    return None


def is_phoneme_tag(tag: str) -> bool:
    """A tag of exactly three code points, whose first and last are ``/``."""
    return phoneme_of(tag) is not None


def split_string(string: str, delimiter: str) -> Tags:
    """The value of split(string, delimiter) (engine §10): the pieces
    between the occurrences of the delimiter, found from the left without
    overlap, with the empty pieces dropped. The delimiter is not empty."""
    return frozenset(piece for piece in string.split(delimiter) if piece)


_NAME = re.compile(r"[A-Za-z][A-Za-z0-9-]*")


def is_name(tag: str) -> bool:
    """Whether a string is a name, and so an identifier tag (engine §1)."""
    return _NAME.fullmatch(tag) is not None


class Marks(Protocol):
    """What a character tag's canonical spelling depends on: which code
    points are nonspacing marks, of General_Category ``Mn`` in unicode.txt."""

    def is_mark(self, code: int) -> bool: ...


def _escaped(code: int, unicode: Marks) -> bool:
    """Whether a character tag writes its character as ``\\u{h...}``: a
    control character, a nonspacing mark, a private-use character, the quote
    or the backslash (engine §1)."""
    return (
        code <= 0x1F
        or 0x7F <= code <= 0x9F
        or code in (0x27, 0x5C)
        or 0xE000 <= code <= 0xF8FF
        or 0xF0000 <= code <= 0xFFFFD
        or 0x100000 <= code <= 0x10FFFD
        or unicode.is_mark(code)
    )


def character_tag(code: int, unicode: Marks) -> str:
    """The character tag of a code point, in its canonical spelling (engine §1)."""
    if _escaped(code, unicode):
        return f"'\\u{{{code:X}}}'"
    return f"'{chr(code)}'"


_ESCAPE = re.compile(r"\\u\{([0-9A-F]{1,6})\}")


def character_of_tag(tag: str, unicode: Marks) -> int | None:
    """The scalar value of a character tag in its canonical spelling, or
    ``None`` for any other string."""
    if len(tag) < 3 or tag[0] != "'" or tag[-1] != "'":
        return None
    inner = tag[1:-1]
    escaped = _ESCAPE.fullmatch(inner)
    if escaped:
        code = int(escaped.group(1), 16)
    elif len(inner) == 1:
        code = ord(inner)
    else:
        return None
    if code > 0x10FFFF or 0xD800 <= code <= 0xDFFF:
        return None
    return code if character_tag(code, unicode) == tag else None


class _NoMarks:
    def is_mark(self, code: int) -> bool:
        return False


class _AllMarks:
    # No mark lies below U+0300.
    def is_mark(self, code: int) -> bool:
        return code >= 0x300


def is_tag(tag: object, unicode: Marks | None = None) -> bool:
    """Whether a value is a tag in its canonical spelling (engine §1).
    Without a table, a character tag is accepted in either spelling a mark
    could have."""
    if not isinstance(tag, str):
        return False
    if is_name(tag) or is_phoneme_tag(tag):
        return True
    if unicode is not None:
        return character_of_tag(tag, unicode) is not None
    return character_of_tag(tag, _NoMarks()) is not None or character_of_tag(tag, _AllMarks()) is not None


def code_of_character_tag(tag: str) -> int:
    """The scalar value of a character tag in its canonical spelling, or -1
    for any other tag. The tag is not checked beyond its first character:
    every tag inside the engine is in its canonical spelling (engine §1)."""
    if tag[:1] != "'":
        return -1
    if tag[1:2] == "\\" and len(tag) > 3:
        return int(tag[4:-2], 16)
    return ord(tag[1])


def range_name(range_: tuple[str, str] | list[str]) -> str:
    """The written form of a range, its identity as a terminal (engine §4):
    its two ends, in their canonical spelling, joined by ``..``."""
    return f"{range_[0]}..{range_[1]}"


def property_name(name: str) -> str:
    """The written form of a property, its identity as a terminal (engine §4)."""
    return f"'\\p{{{name}}}'"


def range_tags(range_: tuple[str, str] | list[str], unicode: Marks) -> Tags:
    """The character tags of a range (engine §1), from its start to its end
    by scalar value, the surrogates skipped."""
    first = code_of_character_tag(range_[0])
    last = code_of_character_tag(range_[1])
    return frozenset(
        character_tag(code, unicode) for code in range(first, last + 1) if not 0xD800 <= code <= 0xDFFF
    )


def is_class(tag: str) -> bool:
    """Whether a tag's first character is ``A`` to ``Z`` (engine §10)."""
    return "A" <= tag[:1] <= "Z"


class TagTable:
    """Interns tag sets, so that an item can hold a tag set as a number."""

    def __init__(self) -> None:
        self._ids: dict[Tags, int] = {}
        self._sets: list[Tags] = []
        self.empty = self.intern(EMPTY)

    def intern(self, tags: Tags) -> int:
        if not isinstance(tags, frozenset):
            tags = frozenset(tags)
        found = self._ids.get(tags)
        if found is None:
            found = len(self._sets)
            self._ids[tags] = found
            self._sets.append(tags)
        return found

    def get(self, number: int) -> Tags:
        return self._sets[number]


def written_test(op: str, value: str | Tags) -> str:
    """A test as an expected list writes it after its terminal
    (docs/output.md): its comparator and its value in canonical form. A
    string stands between double quotes, a backslash before each ``\\`` and
    ``"``. A tag set is ``∅``, its one tag, or its tags in code point order
    joined by `` ∪ `` in parentheses."""
    if isinstance(value, str):
        written = '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'
    else:
        tags = sorted_tags(value)
        written = "∅" if not tags else tags[0] if len(tags) == 1 else f"({' ∪ '.join(tags)})"
    if op in ("∩=∅", "∩≠∅"):
        return f"∩{written}{op[1:]}"
    return f"{op}{written}"
