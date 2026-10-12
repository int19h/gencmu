"""Tags and tag sets (engine §1), and their interning.

A tag is an identifier string. A tag set stores membership without strength.
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


class Gathered:
    """The union of many tag sets, added one at a time. A fold of
    ``union`` copies the tags gathered so far at each set, so this grows
    one mutable set, made only once a second set adds a tag."""

    __slots__ = ("first", "grown")

    def __init__(self) -> None:
        self.first: Tags = EMPTY
        self.grown: set[str] | None = None

    def add(self, part: Tags) -> None:
        if not part:
            return
        if self.grown is not None:
            self.grown.update(part)
        elif not self.first:
            self.first = part
        else:
            self.grown = set(self.first)
            self.grown.update(part)

    def value(self) -> Tags:
        return self.first if self.grown is None else frozenset(self.grown)


def intersection(left: Tags, right: Tags) -> Tags:
    """The tags of both."""
    return left & right


def difference(left: Tags, right: Tags) -> Tags:
    """The tags of the first that are not in the second."""
    return left - right


def sorted_tags(tags: Iterable[str]) -> list[str]:
    """Tags in code point order, as the output lists them (docs/output.md)."""
    return sorted(tags)


def split_string(string: str, delimiter: str) -> Tags:
    """The value of split(string, delimiter) (engine §10): the pieces
    between the occurrences of the delimiter, found from the left without
    overlap, with the empty pieces dropped. The delimiter is not empty."""
    return frozenset(piece for piece in string.split(delimiter) if piece)


_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_-]*")


def is_name(tag: str) -> bool:
    """Whether a string is a name, and so an identifier tag (engine §1)."""
    return _NAME.fullmatch(tag) is not None


class Marks(Protocol):
    def is_mark(self, code: int) -> bool: ...


def is_tag(tag: object, unicode: Marks | None = None) -> bool:
    from ._strings import ENGINE_TAGS, USER_NAME
    return isinstance(tag, str) and (USER_NAME.fullmatch(tag) is not None or tag in ENGINE_TAGS)


def is_class(tag: str) -> bool:
    """Whether a tag's first character is ``A`` to ``Z`` (engine §10)."""
    return bool(tag) and "A" <= tag[0] <= "Z" and "A" <= tag[-1] <= "Z"


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
