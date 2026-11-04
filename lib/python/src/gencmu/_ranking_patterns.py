"""Local node predicates for ranking (engine §6 and §9.3)."""

from ._patterns import pattern_parts, local_node_matches


def requires_elided(pattern):
    if "union" in pattern:
        return all(map(requires_elided, pattern["union"]))
    if "intersection" in pattern:
        return any(map(requires_elided, pattern["intersection"]))
    if "difference" in pattern:
        return requires_elided(pattern["difference"][0])
    return (pattern.get("test") == "tags" and any(not r["negated"] and "_Elided" in r["value"]["set"] for r in pattern["requirements"])) or ("expr" in pattern and requires_elided(pattern["expr"]))


def ranking_pattern_problem(pattern):
    for key in ("union", "intersection", "difference"):
        if key in pattern:
            return next((problem for child in pattern[key] if (problem := ranking_pattern_problem(child))), None)
    if not pattern.get("exact") or "children" in pattern or "path" in pattern or (pattern.get("any") and "test" not in pattern):
        return "a ranking step requires an exact local node pattern"
    return None


def has_pattern_value(pattern):
    return pattern.get("test") in ("=", "≠") or any(map(has_pattern_value, pattern_parts(pattern)))


def possible_node_match(pattern, name=None, terminal=None, tags=None, value=None):
    def conjunction(values):
        return False if False in values else None if None in values else True
    def disjunction(values):
        return True if True in values else None if None in values else False
    def match(child):
        return possible_node_match(child, name, terminal, tags, value)
    if "union" in pattern:
        return disjunction([match(child) for child in pattern["union"]])
    if "intersection" in pattern:
        return conjunction([match(child) for child in pattern["intersection"]])
    if "difference" in pattern:
        right = match(pattern["difference"][1])
        return conjunction([match(pattern["difference"][0]), None if right is None else not right])
    if "test" in pattern:
        base = match(pattern["expr"])
        if base is False:
            return False
        if pattern["test"] != "tags":
            return None if value is None else conjunction([base, local_node_matches(pattern, name, tags or frozenset(), (terminal, value, tags or frozenset()) if terminal else None, value)])
        if tags is not None:
            return conjunction([base, local_node_matches(pattern, name, tags, (terminal, value, tags or frozenset()) if terminal else None)])
        if any(not r["negated"] and "_Elided" in r["value"]["set"] for r in pattern["requirements"]):
            return False
        return conjunction([base, None if pattern["requirements"] else True])
    if "name" in pattern:
        return pattern["name"] == name
    if "terminal" in pattern:
        return terminal is not None if pattern["terminal"] == "_" else pattern["terminal"] == terminal
    return False


def known_tags(term):
    if term is None:
        return None
    if 'tag' in term:
        return frozenset((term['tag'],))
    if 'set' in term:
        return term['set']
    if 'emptySet' in term:
        return frozenset()
    operation = next((key for key in ('union','intersection','difference') if key in term), None)
    if operation is None:
        return None
    values = [known_tags(part) for part in term[operation]]
    if any(value is None for value in values):
        return None
    if operation == 'union':
        return frozenset().union(*values)
    if operation == 'intersection':
        return values[0].intersection(*values[1:])
    return values[0] - values[1]


def can_count_profiles(lowered, steps):
    if not steps:
        return False
    decisions = getattr(lowered, "ranking_possible", None)
    if decisions is None:
        decisions = lowered.ranking_possible = {}
    key = tuple(id(pattern) for _, pattern in steps)
    if key in decisions:
        return decisions[key]
    pending = [lowered.rule_ids["text"]]
    seen = set()
    possible = False
    def matches(**node):
        return any(possible_node_match(pattern, **node) is not False for _, pattern in steps)
    while pending:
        rule = pending.pop()
        if rule in seen:
            continue
        seen.add(rule)
        for identity in lowered.rule_productions[rule]:
            production = lowered.productions[identity]
            if not production.helper:
                tags = known_tags(production.tags_term) if production.tags_term is not None else frozenset() if production.inherited is None else None
                possible |= matches(name=production.rule_name, tags=tags)
            if production.elided and not production.rhs:
                possible |= matches(terminal=production.elided, tags=frozenset((production.elided, "_Elided")), value="")
            for terminal, symbol in zip(production.terminal, production.rhs):
                if terminal:
                    possible |= matches(terminal=symbol)
                else:
                    pending.append(symbol)
    decisions[key] = possible
    return possible
