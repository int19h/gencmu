"""Static notes for diagnostic rules and guarded tag variants."""
from . import _testing
from ._clause_walk import clause_children, expression_children
from ._query_forms import query_references
from ._clauses import validation_captures, simplify_term
from ._guarded_tags import variants, guards


def diagnostic_notes(grammar):
    edges, warnings, errors = {}, {}, set()
    for name, rule in grammar.rules.items():
        references, codes = {}, set()
        for alternative in rule.alternatives:
            _testing.count("closures")
            if alternative.error is not None:
                errors.add(name)
            if alternative.warning is not None:
                codes.add(name)
            pending = [alternative.expr]
            while pending:
                _testing.count("walkSteps")
                node = pending.pop()
                if node.get("ref") in grammar.rules:
                    references[node["ref"]] = None
                pending.extend(expression_children(node))
        edges[name], warnings[name] = references, codes

    def closure(roots):
        found, pending = {}, list(roots)
        while pending:
            _testing.count("closures")
            name, bits = pending.pop()
            old = found.get(name, 0)
            added = bits & ~old
            if not added:
                continue
            found[name] = old | bits
            for child in edges.get(name, ()):
                _testing.count("closures")
                pending.append((child, added))
        return found

    targets_cache, queries_cache, guard_cache = {}, {}, {}
    empty_targets = {}

    def targets_of(root):
        known = targets_cache.get(id(root))
        if known is not None:
            return known[1]
        found, pending = {}, [(root, False)]
        while pending:
            _testing.count("walkSteps")
            node, filtered = pending.pop()
            method = node.get("method") if isinstance(node, dict) else None
            if method == "parse":
                names = query_references(node["args"][0]["body"])
            else:
                names = ()
            for name in names:
                found[name] = found.get(name, 0) | (2 if filtered else 1)
            pending.extend((child, filtered or method == "error-free") for child in clause_children(node))
        result = found if found else empty_targets
        targets_cache[id(root)] = root, result
        return result

    def queries_of(alt):
        own = targets_of(alt.tags)
        key = alt.definition, id(own)
        if key not in queries_cache:
            targets = {}
            for part in (targets_of(alt.emit), own, targets_of(alt.rule_tags), targets_of(alt.conditions)):
                for name, bits in part.items():
                    targets[name] = targets.get(name, 0) | bits
            selected = {}
            for name, bits in closure(targets.items()).items():
                _testing.count("closures")
                if name in errors:
                    selected[name] = bits
            queries_cache[key] = selected
        return queries_cache[key]

    def guarded(term):
        if id(term) not in guard_cache:
            guard_cache[id(term)] = term, bool(guards(term))
        return guard_cache[id(term)][1]

    notes = []
    for name, rule in grammar.rules.items():
        for alt in rule.alternatives:
            where = dict(rule=name, document=alt.document, line=alt.at[0], column=alt.at[1])
            for target, bits in queries_of(alt).items():
                _testing.count("closures")
                if target in errors:
                    for filtered in (False, True):
                        if bits & (2 if filtered else 1):
                            notes.append(dict(kind="query-error", **where, target=target, filtered=filtered))
            if alt.suppress_warnings:
                roots, pending = {}, [alt.expr]
                while pending:
                    _testing.count("walkSteps")
                    node = pending.pop()
                    if node.get("ref") in grammar.rules:
                        roots[node["ref"]] = 1
                    pending.extend(expression_children(node))
                possible = {name} if alt.warning is not None else set()
                possible.update(check["name"] for _, check in grammar.checks if "warning" in check)
                for target in closure(roots.items()):
                    possible.update(warnings.get(target, ()))
                for code in dict.fromkeys(alt.suppress_warnings):
                    if not possible if code == "_" else code not in possible:
                        notes.append(dict(kind="unused-suppression", **where, code=code))
            terms = [term for term in (alt.tags, alt.rule_tags) if term is not None]
            term = {"union": terms} if len(terms) > 1 else terms[0] if terms else {"emptySet": True}
            if not any(guarded(term) for term in terms):
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
