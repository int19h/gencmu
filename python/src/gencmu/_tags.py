"""Tag sets (engine §1) and their interning."""

from __future__ import annotations

from ._model import Tags


def union(left: Tags, right: Tags) -> Tags:
    """Every tag of either, strong if it is strong in either."""
    result = dict(left)
    for tag, strong in right.items():
        result[tag] = result.get(tag, False) or strong
    return result


def intersection(left: Tags, right: Tags) -> Tags:
    """The tags of the first that are in the second, with the first's strength."""
    return {tag: strong for tag, strong in left.items() if tag in right}


PAUSE = "/./"
"""The pause's phoneme tag, whose phonemes are a space (engine §5)."""


def phoneme_of(tag: str) -> str | None:
    """The phonemes of a phoneme tag ``/p/``, a space for the pause, or
    ``None`` for another tag."""
    if len(tag) == 3 and tag[0] == "/" and tag[2] == "/":
        return " " if tag == PAUSE else tag[1]
    return None


class TagTable:
    """Interns tag sets, so that an item can hold a tag set as a number."""

    def __init__(self) -> None:
        self._ids: dict[tuple[tuple[str, bool], ...], int] = {}
        self._sets: list[Tags] = []
        self.empty = self.intern({})

    def intern(self, tags: Tags) -> int:
        key = tuple(sorted(tags.items()))
        found = self._ids.get(key)
        if found is None:
            found = len(self._sets)
            self._ids[key] = found
            self._sets.append(dict(tags))
        return found

    def get(self, number: int) -> Tags:
        return self._sets[number]
