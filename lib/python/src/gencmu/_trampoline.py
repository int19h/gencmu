"""Running recursive walks without the call stack.

A walk over a tree nests as deep as the tree does, and a grammar or a
derivation may nest deeper than Python's recursion limit allows. A walk is
written as a generator that yields a generator for each recursive call and
receives its result; ``run`` drives them with a list for a stack.
"""

from __future__ import annotations

from typing import Any, Generator

Walk = Generator[Any, Any, Any]


class WalkCounter:
    """The steps that the readers and the walks of a document have taken:
    a measure of work that the tests of growth compare across depths of
    nesting (tests/README.md). Each step of a run counts one, and so does
    each node that a walk with an explicit stack meets."""

    steps = 0


walk_counter = WalkCounter()


def run(walk: Walk) -> Any:
    """The result of a walk, as a recursive call would have returned it;
    an exception propagates to the callers as it would have."""
    stack: list[Walk] = [walk]
    value: Any = None
    error: BaseException | None = None
    while True:
        walk_counter.steps += 1
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
