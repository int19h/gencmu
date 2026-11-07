"""A ranking view projects close bookkeeping after recognition (engine §6)."""
from copy import copy
from . import _testing


def restoration_forest(raw, marks):
    closes = raw.close_machine
    if closes is None or not any(p.erased for p in raw.lowered.productions):
        return raw, marks

    def observation(state):
        return -1 if state == closes.INVALID else closes.semantic(state)

    captured, capture_ids = {}, {}

    def captures(parts):
        pending = []
        at = parts
        while at is not None and at not in captured:
            pending.append(at)
            at = at.parent
        for at in reversed(pending):
            _testing.count("walk_steps")
            if at.part is None:
                captured[at] = 0
                continue
            part = at.part
            value = (*part[:4], observation(part[4]), *part[5:]) if len(part) > 4 else part
            key = captured.get(at.parent, 0), value
            captured[at] = capture_ids.setdefault(key, len(capture_ids) + 1)
        return captured.get(parts, 0)

    def field(name, item, default=None):
        values = getattr(raw, name, ())
        return values[item] if values else default

    aliases, found = [], {}
    for item, number in enumerate(raw.prod):
        _testing.count("walk_steps")
        p = raw.lowered.productions[number]
        key = (p.real_id, raw.dot[item], raw.origin[item], raw.end[item], raw.tag.get(item),
               captures(raw.caps[item]), field("structure", item), field("prefix", item),
               observation(field("close_structure", item, 0)), observation(field("close_prefix", item, 0)),
               field("family_structure", item), field("family_prefix", item),
               getattr(raw, "tree_prefix", {}).get(item), getattr(raw, "tree_identity", {}).get(item),
               getattr(raw, "tree_sequence", {}).get(item), p.close_requested, p.tree_requested,
               p.lexical.restoration_key() if p.lexical is not None else None,
               raw.boundaries[item].id if raw.boundaries else None,
               field("strict", item, False), bool(raw.edges[item] and raw.edges[item][0][1] == 3))
        aliases.append(found.setdefault(key, item))
    forest = copy(raw)
    forest.edges = [[] for _ in raw.prod]
    forest.roots = list(dict.fromkeys(aliases[item] for item in raw.roots))
    edge_ids, indices = {}, []
    for item, source in enumerate(raw.edges):
        target = aliases[item]
        table = edge_ids.setdefault(target, {})
        positions = []
        for previous, kind, child, extra in source:
            _testing.count("walk_steps")
            edge = (aliases[previous] if kind in (1, 2) else previous, kind,
                    aliases[child] if kind == 2 else child, extra)
            if edge not in table:
                table[edge] = len(forest.edges[target])
                forest.edges[target].append(edge)
            positions.append(table[edge])
        indices.append(positions)
    forest.restoration_aliases, forest.restoration_indices = aliases, indices
    if marks is not None:
        projected = {}
        for item, edges in marks.items():
            projected.setdefault(aliases[item], set()).update(indices[item][edge] for edge in edges)
        marks = projected
    return forest, marks
