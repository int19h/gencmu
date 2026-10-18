"""The shared memo (engine §4.3): the answers of ordinary nested queries,
kept across the parses of one lowered grammar. Its keys hold tags by name,
so that the tag numbers of one parse never leave it."""

from __future__ import annotations

import threading
from typing import Any

from . import _testing

DEFAULT_LIMIT = 1 << 13
"""The default bound on the entries of one generation."""


def limit() -> int:
    """The bound of the shared memos for a parse. A fault of the library's
    own tests changes answers, so a parse with a fault neither reads nor
    keeps shared answers."""
    if _testing.faults:
        return 0
    return DEFAULT_LIMIT if _testing.memo_limit is None else _testing.memo_limit


class SharedMemo:
    """The answers of one lowered grammar, in two generations. Each lookup
    and each insertion holds the lock, and an answer never changes after
    its insertion."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._newer: dict[tuple[Any, ...], Any] = {}
        self._older: dict[tuple[Any, ...], Any] = {}

    def _room(self, bound: int) -> dict[tuple[Any, ...], Any] | None:
        """Makes room for one entry, and gives the dropped generation. The
        caller releases it after the lock, so that no finalizer of its
        objects runs under the lock."""
        if len(self._newer) < bound:
            return None
        dropped = self._older
        self._older, self._newer = self._newer, {}
        return dropped

    def get(self, key: tuple[Any, ...], bound: int) -> Any:
        """The answer of a key, or None. An answer found in the older
        generation moves to the newer one."""
        if bound <= 0:
            return None
        dropped = None
        with self._lock:
            found = self._newer.get(key)
            if found is None:
                found = self._older.pop(key, None)
                if found is not None:
                    dropped = self._room(bound)
                    self._newer[key] = found
        del dropped
        return found

    def insert(self, key: tuple[Any, ...], answer: Any, bound: int) -> None:
        """Keeps an answer. With a bound of 0 the memo keeps nothing."""
        if bound <= 0:
            return
        dropped = None
        with self._lock:
            if key not in self._newer:
                dropped = self._room(bound)
                self._newer[key] = answer
        del dropped

    def rules(self) -> list[str]:
        """The rules of the entries in both generations, for the library's
        own tests."""
        with self._lock:
            return [key[1] for key in [*self._newer, *self._older]]
