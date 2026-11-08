"""The structural width of an error production (engine §3.6)."""


def nullable_error(rules):
    errors = [(rule, alt) for rule in rules.values() for alt in rule.alternatives if alt.error is not None]
    nodes, identities, pending = [], {}, []

    def intern(identity):
        key = identity if isinstance(identity, str) else id(identity)
        if key in identities:
            return identities[key]
        number = len(nodes)
        identities[key] = number
        nodes.append(dict(all=False, children=[], users=[], remaining=0, value=False))
        pending.append(identity)
        return number

    roots = [intern(alt.expr) for _, alt in errors]
    index = 0
    while index < len(pending):
        identity, node = pending[index], nodes[index]
        children = []
        if isinstance(identity, str):
            children = [alt.expr for alt in rules[identity].alternatives] if identity in rules else []
        else:
            expr = identity
            if "empty" in expr or "optional" in expr:
                node["all"] = True
            elif "seq" in expr:
                node["all"], children = True, expr["seq"]
            elif "choice" in expr:
                children = expr["choice"]
            elif "ranked" in expr:
                children = expr["ranked"]
            elif "and" in expr:
                children = expr["and"]
            elif "repeat" in expr:
                children = [expr["repeat"]]
            elif "capture" in expr or "test" in expr:
                children = [expr["expr"]]
            elif "splice" in expr:
                children = [expr["splice"]]
            elif expr.get("ref") in rules:
                children = [expr["ref"]]
        node["children"] = [intern(child) for child in children]
        node["remaining"] = len(children)
        for child in node["children"]:
            nodes[child]["users"].append(index)
        index += 1
    ready = []
    for index, node in enumerate(nodes):
        if node["all"] and not node["remaining"]:
            node["value"] = True
            ready.append(index)
    index = 0
    while index < len(ready):
        for user in nodes[ready[index]]["users"]:
            node = nodes[user]
            if node["value"]:
                continue
            node["remaining"] -= 1
            if not node["all"] or not node["remaining"]:
                node["value"] = True
                ready.append(user)
        index += 1
    return next((error for error, root in zip(errors, roots) if nodes[root]["value"]), None)
