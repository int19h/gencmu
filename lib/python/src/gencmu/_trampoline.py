"""Running recursive walks without the call stack.

A walk over a tree nests as deep as the tree does, and a grammar or a
derivation may nest deeper than Python's recursion limit allows. A walk is
written as a generator that yields a generator for each recursive call and
receives its result; ``run`` drives them with a list for a stack.
"""

from __future__ import annotations

from typing import Any, Generator

Walk = Generator[Any, Any, Any]


def run(walk: Walk) -> Any:
    """The result of a walk, as a recursive call would have returned it;
    an exception propagates to the callers as it would have."""
    stack: list[Walk] = [walk]
    value: Any = None
    error: BaseException | None = None
    while True:
        top = stack[-1]
        try:
            if error is not None:
                pending, error = error, None
                request = top.throw(pending)
            else:
                request = top.send(value)
        except StopIteration as stop:
            stack.pop()
            if not stack:
                return stop.value
            value = stop.value
            continue
        except BaseException as exception:
            stack.pop()
            if not stack:
                raise
            error = exception
            continue
        stack.append(request)
        value = None
