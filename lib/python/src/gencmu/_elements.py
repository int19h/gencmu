"""Keep written optional structure beside physical capture expansions."""

from __future__ import annotations


class Expansion(list):
    def __init__(self, symbols=(), elements=None, sites=None):
        super().__init__(symbols)
        self.sites = None if sites is None else dict(sites)
        self.elements = tuple(("symbol", i) for i in range(len(self))) if elements is None else tuple(elements)


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


def combine(parts):
    symbols, elements, sites = [], [], None
    for part in parts:
        structure = getattr(part, "elements", None)
        if structure is None:
            structure = tuple(("symbol", i) for i in range(len(part)))
        elements.extend(shift(node, len(symbols)) for node in structure)
        written = getattr(part, "sites", None)
        if written:
            if sites is None:
                sites = {}
            sites.update((index + len(symbols), expr) for index, expr in written.items())
        symbols.extend(part)
    return Expansion(symbols, elements, sites)


def optional(part, place):
    elements = getattr(part, "elements", tuple(("symbol", i) for i in range(len(part))))
    return Expansion(part, (("optional", 0, len(part), elements, place),), getattr(part, "sites", None))


def inherited(elements):
    while len(elements) == 1:
        node = elements[0]
        if node[0] == "symbol":
            return node[1]
        elements = node[3]
    return None
