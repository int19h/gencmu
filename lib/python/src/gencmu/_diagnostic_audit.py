"""Static notes for diagnostic rules and guarded tag variants."""
from ._template_nodes import nodes
from ._clauses import validation_captures, simplify_term
from ._guarded_tags import variants, guards


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
            reached = set()
            for node in nodes([alt.conditions, alt.tags, alt.rule_tags, alt.emit]):
                if node.get("method") in ("matches", "begins", "ends", "tags"):
                    for arg in node["args"]:
                        if "rule" in arg:
                            reached.update(closure([arg["rule"]]))
            for target in grammar.rules:
                if target in reached and target in errors:
                    notes.append(dict(kind="query-error", target=target, **where))
            roots = {node["ref"] for node in nodes(alt.expr) if node.get("ref") in grammar.rules}
            possible = closure(roots) & warnings
            if alt.warning is not None:
                possible.add(name)
            for code in dict.fromkeys(alt.suppress_warnings):
                if not possible if code == "_" else code not in possible:
                    notes.append(dict(kind="unused-suppression", code=code, **where))
            terms = [term for term in (alt.tags, alt.rule_tags) if term is not None]
            term = {"union": terms} if len(terms) > 1 else terms[0] if terms else {"emptySet": True}
            if not guards(term):
                continue
            owner = dict(tags=alt.rule_tags, conditions=alt.conditions, alternatives=[dict(expr=alt.expr, tags=alt.tags)])
            if alt.emit is not None:
                owner["emit"] = alt.emit
            for present in validation_captures(owner, owner["alternatives"][0]):
                try:
                    count = len(variants(simplify_term(term, present)))
                except ValueError:
                    continue
                if count > 8:
                    notes.append(dict(kind="guarded-tag-variants", variants=count, captures=sorted(key for key in present if key), **where))
    seen, unique = set(), []
    for note in notes:
        key = repr(note)
        if key not in seen:
            seen.add(key)
            unique.append(note)
    return unique
