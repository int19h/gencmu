"""Dependencies of query answers (engine §4.3)."""

from . import _testing
from ._clause_walk import clause_children, production_clauses
from ._query_forms import body_target


def _reads(lowered, number, end_observation):
    memo = lowered.suffix_dependencies if end_observation else lowered.carried_dependencies
    if number in memo:
        return memo[number]
    pending, seen = [(number, False)], set()
    while pending:
        rule, nested = pending.pop()
        if (rule, nested) in seen:
            continue
        seen.add((rule, nested))
        for index in lowered.rule_productions[rule]:
            production = lowered.productions[index]
            pending.extend((child, nested) for child, terminal in zip(production.rhs, production.terminal) if not terminal)
            clauses, visited = production_clauses(production), set()
            while clauses:
                _testing.count("walkSteps")
                node = clauses.pop()
                if not isinstance(node, (dict, list, tuple)) or id(node) in visited:
                    continue
                visited.add(id(node))
                if isinstance(node, dict):
                    method = node.get("method")
                    if (end_observation and not nested and method in ("onward", "following-tokens", "ends-input", "followed-by")
                            or not end_observation and method == "error-free"):
                        memo[number] = True
                        return True
                    if method in ("matches", "begins", "ends", "tags", "parse") and node.get("args"):
                        receiver = node["receiver"]
                        while receiver.get("method") == "onward":
                            receiver = receiver["receiver"]
                        if end_observation and receiver.get("method") in ("without-elision", "without-elision-except"):
                            memo[number] = True
                            return True
                        for arg in node["args"]:
                            if "rule" in arg or "body" in arg:
                                target = arg["rule"] if "rule" in arg else body_target(lowered, arg["body"])
                                pending.append((lowered.rule_ids[target], True))
                clauses.extend(clause_children(node))
    memo[number] = False
    return False


def suffix_reads_end(lowered, number):
    return _reads(lowered, number, True)


def reads_carried_errors(lowered, number):
    return _reads(lowered, number, False)
