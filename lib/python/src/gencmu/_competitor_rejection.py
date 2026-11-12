"""Default rejection evidence for a ranked error (engine §12.1)."""

from . import _testing
from ._earley import prediction_groups, skipped_productions, expected_at
from ._source_lines import SourceLines


def competitor_rejections(flow, forest):
    for event in flow.evaluated:
        node = event.node
        if event.check or event.kind != "errors" or not hasattr(node, "production") or node.production.splice_of is not None:
            continue
        parent = flow.info(node).parent
        if (parent is None or not hasattr(parent, "production") or parent.production.ranked is None
                or len(parent.children) != 1 or parent.children[0] is not node):
            continue
        evidence = competitor_slice(forest, node.start, node.end, parent.production)
        if evidence is not None:
            event.diagnostic.rejection = evidence


def competitor_slice(forest, start, cap, option):
    group = option.ranked
    entries, advances, completions, skipped_indexes = {}, {}, {}, {}
    predictions, sets, omitted, omitted_seen = set(), {}, {}, {}
    reached, queue = set(), []
    productions = forest.lowered.productions

    def index_candidate(index, name, frame, candidate):
        _testing.count("walkSteps")
        index.setdefault((name, frame), []).append(candidate)

    def candidates_at(index, name, frame):
        _testing.count("walkSteps")
        return index.get((name, frame), ())

    def skipped_at(at):
        _testing.count("walkSteps")
        if at not in skipped_indexes:
            index = skipped_indexes[at] = {}
            for candidate in prediction_groups(forest, at):
                index_candidate(index, candidate[0], candidate[1], candidate)
        return skipped_indexes[at]

    def omissions(at, accept, candidates):
        return skipped_productions(forest, at, candidates, lambda production: production.error is None and accept(production))

    def competitor(production):
        if production.ranked is group:
            return production.option != option.option and production.lexical is option.lexical
        source = production.source
        return (not production.helper and production.rule_name == group.rule and source is not None
                and source is not group.source and source.definition is group.source.definition)

    def add(item):
        production = productions[forest.prod[item]]
        if production.error is not None or item in reached:
            return
        reached.add(item)
        queue.append(item)
        transparent = (forest.dot[item] == 0 and production.ranked is not None
                       and len(production.rhs) == 1 and not production.terminal[0])
        if not transparent:
            sets.setdefault(forest.end[item], []).append(item)

    def omit(at, production):
        _testing.count("walkSteps")
        seen = omitted_seen.setdefault(at, set())
        if production.id not in seen:
            seen.add(production.id)
            omitted.setdefault(at, []).append(production)
            sets.setdefault(at, [])

    for item, at in enumerate(forest.end):
        if at < start or at > cap:
            continue
        production = productions[forest.prod[item]]
        if production.error is not None:
            continue
        if forest.dot[item] == 0:
            index_candidate(entries.setdefault(at, {}), production.lhs, production.lexical, item)
            if forest.origin[item] == start and at == start and competitor(production):
                add(item)
        for previous, kind, child, terminal in forest.edges[item]:
            if kind not in (1, 2):
                continue
            completed = child if kind == 2 else None
            advances.setdefault(previous, []).append((item, completed))
            if completed is not None:
                completions.setdefault(completed, []).append((previous, item))
    for production in omissions(start, competitor, prediction_groups(forest, start)):
        omit(start, production)
    for item in queue:
        production = productions[forest.prod[item]]
        dot, at = forest.dot[item], forest.end[item]
        if dot < len(production.rhs) and not production.terminal[dot]:
            name = production.rhs[dot]
            frame = forest.entry_for(item, name)
            key = at, name, frame
            _testing.count("walkSteps")
            if key not in predictions:
                predictions.add(key)
                for entry in candidates_at(entries.get(at, {}), name, frame):
                    _testing.count("walkSteps")
                    add(entry)
                candidates = candidates_at(skipped_at(at), name, frame)
                for skipped in omissions(at, lambda p: p.lexical is frame, candidates):
                    omit(at, skipped)
        for next_item, child in advances.get(item, ()):
            if child is None or child in reached:
                add(next_item)
        for previous, next_item in completions.get(item, ()):
            if previous in reached:
                add(next_item)
    if not sets:
        return None
    position = max(sets)
    tokens = forest.context.tokens
    end = tokens[-1].source[1] if tokens else 0
    source = tokens[position].source if position < len(tokens) else (end, end)
    lines = forest.context.lines
    if lines is None:
        lines = forest.context.lines = SourceLines(forest.context.text)
    line, column = lines.position(source[0])
    expected = expected_at(forest, position, sets[position], omitted.get(position, ()))
    return dict(token=position, source=tuple(source), line=line, column=column,
                expected=[dict(terminal=terminal, rules=sorted(rules)) for terminal, rules in sorted(expected.items())])
