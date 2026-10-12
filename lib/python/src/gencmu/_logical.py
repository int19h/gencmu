"""Keep written optional structure beside physical capture expansions."""

from __future__ import annotations


class Expansion(list):
    def __init__(self, symbols=(), logical=None):
        super().__init__(symbols)
        self.logical = tuple(("symbol", i) for i in range(len(self))) if logical is None else tuple(logical)


def shift(node, offset):
    """Move physical indices without using a call frame per optional."""
    shifted = {}
    pending = [(node, False)]
    while pending:
        current, ready = pending.pop()
        if current[0] == "symbol":
            shifted[id(current)] = "symbol", current[1] + offset
        elif ready:
            shifted[id(current)] = (
                "optional", current[1] + offset, current[2],
                tuple(shifted[id(child)] for child in current[3]), current[4],
            )
        else:
            pending.append((current, True))
            pending.extend((child, False) for child in reversed(current[3]))
    return shifted[id(node)]


def combine(parts):
    symbols, logical = [], []
    for part in parts:
        structure = getattr(part, "logical", None)
        if structure is None:
            structure = tuple(("symbol", i) for i in range(len(part)))
        logical.extend(shift(node, len(symbols)) for node in structure)
        symbols.extend(part)
    return Expansion(symbols, logical)


def optional(part, place):
    logical = getattr(part, "logical", tuple(("symbol", i) for i in range(len(part))))
    return Expansion(part, (("optional", 0, len(part), logical, place),))


def inherited(logical):
    while len(logical) == 1:
        node = logical[0]
        if node[0] == "symbol":
            return node[1]
        logical = node[3]
    return None
