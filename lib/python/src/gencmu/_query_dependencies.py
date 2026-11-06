"""Dependencies of query answers (engine §4.3)."""

from . import _testing
from ._clause_walk import clause_children, production_clauses
from ._query_forms import body_target


def _clause_nodes(production, visited):
    clauses = production_clauses(production)
    while clauses:
        _testing.count("walkSteps")
        node = clauses.pop()
        if not isinstance(node, (dict, list, tuple)) or id(node) in visited:
            continue
        visited[id(node)] = node
        if isinstance(node, dict):
            yield node
        clauses.extend(clause_children(node))


def suffix_reads_end(lowered, number):
    memo = lowered.suffix_dependencies
    if number in memo:
        return memo[number]
    pending, seen = [(number, False)], set()
    while pending:
        rule, nested = pending.pop()
        if (rule, nested) in seen:
            continue
        seen.add((rule, nested))
        visited = {}
        for index in lowered.rule_productions[rule]:
            production = lowered.productions[index]
            pending.extend((child, nested) for child, terminal in zip(production.rhs, production.terminal) if not terminal)
            for node in _clause_nodes(production, visited):
                method = node.get("method")
                if not nested and method in ("onward", "following-tokens", "ends-input", "followed-by"):
                    memo[number] = True
                    return True
                if method in ("matches", "begins", "ends", "tags", "parse") and node.get("args"):
                    receiver = node["receiver"]
                    while receiver.get("method") == "onward":
                        receiver = receiver["receiver"]
                    if receiver.get("method") in ("without-elision", "without-elision-except"):
                        memo[number] = True
                        return True
                    for arg in node["args"]:
                        if "rule" in arg or "body" in arg:
                            target = arg["rule"] if "rule" in arg else body_target(lowered, arg["body"])
                            pending.append((lowered.rule_ids[target], True))
    memo[number] = False
    return False


def reads_carried_errors(lowered, number):
    sensitive = lowered.carried_dependencies
    if sensitive is None:
        sensitive, callers = set(), {}

        def edge(target, caller):
            callers.setdefault(target, set()).add(caller)

        for rule, productions in enumerate(lowered.rule_productions):
            visited = {}
            for index in productions:
                production = lowered.productions[index]
                for child, terminal in zip(production.rhs, production.terminal):
                    if not terminal:
                        edge(child, rule)
                for node in _clause_nodes(production, visited):
                    method = node.get("method")
                    if method == "error-free":
                        sensitive.add(rule)
                    if method in ("matches", "begins", "ends", "tags", "parse"):
                        for arg in node["args"]:
                            if "rule" in arg or "body" in arg:
                                target = arg["rule"] if "rule" in arg else body_target(lowered, arg["body"])
                                edge(lowered.rule_ids[target], rule)
        pending = list(sensitive)
        for target in pending:
            for caller in callers.get(target, ()):
                if caller not in sensitive:
                    sensitive.add(caller)
                    pending.append(caller)
        lowered.carried_dependencies = frozenset(sensitive)
    return number in sensitive
