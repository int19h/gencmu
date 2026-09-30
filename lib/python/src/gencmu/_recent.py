"""A map that keeps only the entries used most recently."""

from __future__ import annotations

from collections import OrderedDict
from typing import Generic, Hashable, TypeVar

K = TypeVar("K", bound=Hashable)
V = TypeVar("V")


class Recent(Generic[K, V]):
    """A map of at most ``limit`` entries. When it is full, a new entry
    drops the entry that was used least recently. It has no lock of its own,
    so the owner locks it when threads share it."""

    def __init__(self, limit: int) -> None:
        self._limit = limit
        self._entries: OrderedDict[K, V] = OrderedDict()

    def get(self, key: K) -> V | None:
        value = self._entries.get(key)
        if value is not None:
            self._entries.move_to_end(key)
        return value

    def put(self, key: K, value: V) -> None:
        self._entries[key] = value
        self._entries.move_to_end(key)
        while len(self._entries) > self._limit:
            self._entries.popitem(last=False)

    def __len__(self) -> int:
        return len(self._entries)
