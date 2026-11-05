"""Static notes for diagnostic rules and guarded tag variants."""
from ._template_nodes import nodes
from ._clauses import capture_sequences, simplify_term
from ._guarded_tags import variants


def diagnostic_notes(grammar):
    edges = {name: {node["ref"] for alt in rule.alternatives for node in nodes(alt.expr) if node.get("ref") in grammar.rules} for name, rule in grammar.rules.items()}
    warnings = {name for name, rule in grammar.rules.items() if any(a.warning is not None for a in rule.alternatives)}
    errors = {name for name, rule in grammar.rules.items() if any(a.error is not None for a in rule.alternatives)}
    def closure(roots):
        found, pending = set(), list(roots)
        while pending:
            name = pending.pop()
            if name not in found:
                found.add(name)
                pending.extend(edges.get(name, ()))
        return found
    notes = []
    for name, rule in grammar.rules.items():
        for alt in rule.alternatives:
            where = dict(rule=name, document=alt.document, line=alt.at[0], column=alt.at[1])
            for node in nodes([alt.expr, alt.conditions, alt.tags, alt.rule_tags, alt.emit]):
                if node.get("method") in ("matches", "begins", "ends", "tags"):
                    for arg in node["args"]:
                        if "rule" in arg and closure([arg["rule"]]) & errors:
                            notes.append(dict(kind="query-error", target=arg["rule"], **where))
            possible = closure([name]) & warnings
            for code in dict.fromkeys(alt.suppress_warnings):
                if not possible if code == "_" else code not in possible:
                    notes.append(dict(kind="unused-suppression", code=code, **where))
            terms = [term for term in (alt.tags, alt.rule_tags) if term is not None]
            term = {"union": terms} if len(terms) > 1 else terms[0] if terms else {"emptySet": True}
            for sequence in capture_sequences(alt.expr)[0]:
                present = {"", *(capture["capture"] for capture in sequence)}
                try:
                    count = len(variants(simplify_term(term, present)))
                except ValueError:
                    continue
                if count > 8:
                    notes.append(dict(kind="guarded-tag-variants", variants=count, **where))
                    break
    return notes
