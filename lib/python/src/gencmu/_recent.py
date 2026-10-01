"""A map that keeps only the entries used most recently."""

from __future__ import annotations

from collections import OrderedDict
from typing import Generic, Hashable, TypeVar

K = TypeVar("K", bound=Hashable)
V = TypeVar("V")


class Recent(Generic[K, V]):
    """A map of at most ``limit`` entries, whose sizes add up to at most
    ``max_size`` when that is given. When it is too full, it drops the
    entries that were used least recently. An entry larger than ``max_size``
    is not kept at all. It has no lock of its own, so the owner locks it
    when threads share it."""

    def __init__(self, limit: int, max_size: int | None = None) -> None:
        self._limit = limit
        self._max_size = max_size
        self._entries: OrderedDict[K, tuple[V, int]] = OrderedDict()
        self._size = 0

    def get(self, key: K) -> V | None:
        entry = self._entries.get(key)
        if entry is None:
            return None
        self._entries.move_to_end(key)
        return entry[0]

    def put(self, key: K, value: V, size: int = 0) -> None:
        old = self._entries.pop(key, None)
        if old is not None:
            self._size -= old[1]
        self._entries[key] = (value, size)
        self._size += size
        while len(self._entries) > self._limit or (self._max_size is not None and self._size > self._max_size):
            _, (_, dropped) = self._entries.popitem(last=False)
            self._size -= dropped

    def __len__(self) -> int:
        return len(self._entries)

    @property
    def size(self) -> int:
        """The sum of the sizes of the entries."""
        return self._size
