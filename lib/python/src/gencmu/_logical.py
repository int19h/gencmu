"""Keep written optional structure beside physical capture expansions."""

from __future__ import annotations


class Expansion(list):
    __slots__ = ("logical",)

    def __init__(self, symbols=(), logical=None):
        super().__init__(symbols)
        if logical is None:
            self.logical = tuple(("symbol", i) for i in range(len(self)))
        elif isinstance(logical, (tuple, list)):
            self.logical = logical
        else:
            self.logical = tuple(logical)


def shift(node, offset):
    """Move physical indices without using a call frame per optional."""
    if not offset:
        return node
    if node[0] == "symbol":
        return "symbol", node[1] + offset
    if not node[3]:
        return "optional", node[1] + offset, node[2], (), node[4]
    shifted = {}
    pending = [(node, False)]
    while pending:
        current, ready = pending.pop()
        if current[0] == "symbol":
            shifted[id(current)] = "symbol", current[1] + offset
        elif ready:
            shifted[id(current)] = (
                "optional",
                current[1] + offset,
                current[2],
                tuple(shifted[id(child)] for child in current[3]),
                current[4],
            )
        else:
            pending.append((current, True))
            pending.extend((child, False) for child in reversed(current[3]))
    return shifted[id(node)]


def logical_of(part):
    logical = part.logical if isinstance(part, Expansion) else getattr(part, "logical", None)
    if logical is None:
        return tuple(("symbol", i) for i in range(len(part)))
    if isinstance(logical, list):
        logical = tuple(logical)
        if isinstance(part, Expansion):
            part.logical = logical
    return logical


def freeze(expansions):
    """Freeze the mutable logical buffers of owned expansions into tuples."""
    for expansion in expansions:
        if isinstance(expansion.logical, list):
            expansion.logical = tuple(expansion.logical)
    return expansions


def extend_all(left, right):
    """The product of expansions that the caller owns with others, made by
    extending each owned expansion in place where it continues one way. A
    copy of the growing prefix at each item would cost the square of a
    sequence's length. An expansion that continues several ways is copied
    for all but the last. ``left`` is owned and changed. ``right`` is only
    read."""
    if not left or not right:
        return []
    right_logicals = [logical_of(part) for part in right]
    shifted_right = [{0: logical} for logical in right_logicals]
    last = len(right) - 1
    result = []
    for a in left:
        offset = len(a)
        a_logical = a.logical
        if not isinstance(a_logical, list):
            a_logical = a.logical = list(a_logical)
        for index, b in enumerate(right):
            cache = shifted_right[index]
            suffix = cache.get(offset)
            if suffix is None:
                suffix = cache[offset] = tuple(shift(node, offset) for node in right_logicals[index])
            if index < last:
                copy_logical = list(a_logical)
                if suffix:
                    copy_logical.extend(suffix)
                copy = Expansion(a, copy_logical)
                if b:
                    copy.extend(b)
                result.append(copy)
            else:
                if b:
                    a.extend(b)
                if suffix:
                    a_logical.extend(suffix)
                result.append(a)
    return result


def optional(part, place):
    logical = logical_of(part)
    return Expansion(part, (("optional", 0, len(part), logical, place),))


def inherited(logical):
    while len(logical) == 1:
        node = logical[0]
        if node[0] == "symbol":
            return node[1]
        logical = node[3]
    return None
