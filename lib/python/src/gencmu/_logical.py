"""Keep written optional structure beside physical capture expansions."""

from __future__ import annotations


class Expansion(list):
    __slots__ = ("logical",)

    def __init__(self, symbols=(), logical=None):
        super().__init__(symbols)
        if logical is None:
            self.logical = tuple(("symbol", i) for i in range(len(self)))
        elif isinstance(logical, tuple):
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


def _logical_of(part):
    logical = part.logical if isinstance(part, Expansion) else getattr(part, "logical", None)
    if logical is None:
        return tuple(("symbol", i) for i in range(len(part)))
    return logical


def extend_all(left, right):
    """Extend owned prefix expansions with each right-hand expansion."""
    if not left or not right:
        return []
    right_logicals = [_logical_of(part) for part in right]
    shifted_right = [{0: logical} for logical in right_logicals]
    last = len(right) - 1
    if last == 0:
        b = right[0]
        b_logical = right_logicals[0]
        cache = shifted_right[0]
        for a in left:
            offset = len(a)
            suffix = cache.get(offset)
            if suffix is None:
                suffix = cache[offset] = tuple(shift(node, offset) for node in b_logical)
            if b:
                a.extend(b)
            if suffix:
                a.logical = a.logical + suffix
        return left
    result = []
    b_last = right[last]
    b_last_logical = right_logicals[last]
    b_last_cache = shifted_right[last]
    for a in left:
        offset = len(a)
        a_logical = a.logical
        for index in range(last):
            b = right[index]
            cache = shifted_right[index]
            suffix = cache.get(offset)
            if suffix is None:
                suffix = cache[offset] = tuple(shift(node, offset) for node in right_logicals[index])
            copy = Expansion(a, a_logical + suffix if suffix else a_logical)
            if b:
                copy.extend(b)
            result.append(copy)
        suffix = b_last_cache.get(offset)
        if suffix is None:
            suffix = b_last_cache[offset] = tuple(shift(node, offset) for node in b_last_logical)
        if b_last:
            a.extend(b_last)
        if suffix:
            a.logical = a_logical + suffix
        result.append(a)
    return result


def combine(parts):
    sequences = [Expansion()]
    for part in parts:
        sequences = extend_all(sequences, [part])
    return sequences[0]


def optional(part, place):
    logical = _logical_of(part)
    return Expansion(part, (("optional", 0, len(part), logical, place),))


def inherited(logical):
    while len(logical) == 1:
        node = logical[0]
        if node[0] == "symbol":
            return node[1]
        logical = node[3]
    return None
