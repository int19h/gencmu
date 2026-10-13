"""Whole-observation deletion, independent of the boundary summaries.

Only the private conformance switch retains permission marks. The oracle
expands the packed proof edges, so it also checks distinct ownership routes
that share one raw close observation and one item summary.
"""

from __future__ import annotations

from gencmu._closes import Block, CloseMachine


def observations(forest, root, base):
    """Enumerate complete token/record streams without summary operations."""
    productions = forest.lowered.productions
    permitted = forest.family.permitted
    streams = {}
    pending = [(root, False)]

    def seal(item, child):
        parent = productions[forest.prod[item]]
        position = forest.dot[item] - 1
        return parent.observes_closes and parent.rhs[position] in forest.lowered.ranked_helpers

    while pending:
        item, ready = pending.pop()
        if item in streams:
            continue
        if not ready:
            pending.append((item, True))
            for pred, kind, child, _ in forest.edges[item]:
                if kind:
                    pending.append((pred, False))
                if kind == 2 and not seal(item, child):
                    pending.append((child, False))
            continue
        production = productions[forest.prod[item]]
        found = set()
        for pred, kind, child, _ in forest.edges[item]:
            if kind == 0:
                if production.elided is not None and production.observes_closes:
                    found.add((("close", production.elided, base + forest.origin[item],
                                production.elided_owner in permitted),))
                else:
                    found.add(())
                continue
            if kind == 1:
                tails = {(("token", base + child),)}
            elif seal(item, child):
                option = productions[forest.prod[child]]
                group = option.ranked
                block = Block((group.rule, group.source.document, group.source.at, group.alternative, group.path),
                              base + forest.origin[child], base + forest.end[child], option.lexical.close_entry)
                tails = {(("block", block),)}
            else:
                tails = streams[child]
            found.update(prefix + tail for prefix in streams[pred] for tail in tails)
        streams[item] = found
    return streams[root]


def candidate_elements(matcher, endpoint):
    """Restore raw records in leaf order, with opaque blocks as one element."""
    elements = []
    cursor = matcher.start
    for event in matcher.closes.events(matcher.closes.states[matcher.observation].sequence):
        boundary = event.start if isinstance(event, Block) else event.at
        if boundary > endpoint:
            break
        elements.extend(("token", position) for position in range(cursor, boundary))
        cursor = max(cursor, boundary)
        if isinstance(event, Block):
            if event.start == endpoint and event.end > endpoint:
                continue
            if event.end > endpoint:
                return None
            elements.append(("block", event))
            cursor = max(cursor, event.end)
        else:
            elements.append(("close", event.terminal, event.at))
    elements.extend(("token", position) for position in range(cursor, endpoint))
    return elements


def deletion(candidate, witness, start, captured_end, endpoint):
    """Try every kept/deleted choice on one complete observation stream."""
    if candidate is None:
        return False
    boundary = min(captured_end, endpoint)
    states = {(0, False)}
    for record in witness:
        kind = record[0]
        if kind == "token":
            if record[1] >= boundary:
                continue
            identity, permitted = record, False
        elif kind == "block":
            block = record[1]
            if block.start < captured_end < block.end:
                return False
            if block.start > boundary or block.start == boundary and block.end > boundary:
                continue
            if block.end > boundary:
                return False
            identity, permitted = record, False
        else:
            if record[2] > boundary:
                continue
            identity, permitted = record[:3], record[3]
        next_states = set()
        for matched, pending in states:
            if matched < len(candidate) and candidate[matched] == identity:
                next_states.add((matched + 1, False))
            if permitted and matched:
                next_states.add((matched, True))
        states = next_states
    return (len(candidate), False) in states


class FamilyOracle:
    def __init__(self):
        self.witnesses = 0
        self.observations = 0

    def __call__(self, forest, item, base, answer):
        self.witnesses += 1
        matcher = forest.family
        if forest.close_structure[item] == CloseMachine.INVALID:
            assert not answer, "a cyclic family witness passed alignment"
            return
        endpoint = base + forest.end[item]
        candidate = candidate_elements(matcher, min(matcher.end, endpoint))
        streams = observations(forest, item, base)
        assert streams, "an eligible family witness has no finite proof"
        for witness in streams:
            self.observations += 1
            expected = deletion(candidate, witness, matcher.start, matcher.end, endpoint)
            assert answer == expected, ("family summary disagrees with whole-observation deletion", candidate, witness, endpoint, answer)
