"""Exact tree identities for compared occurrences (engine §4.1)."""
def children(node):
    if isinstance(node, (list, tuple)): return node
    if isinstance(node, dict) and "pattern" not in node: return list(node.values())
    return []


def comparisons(root):
    result, pending, seen = [], [root], set()
    while pending:
        node = pending.pop()
        if not isinstance(node, (dict, list, tuple)) or id(node) in seen:
            continue
        seen.add(id(node))
        if isinstance(node, dict) and node.get("op") in ("≅", "≇") and "capture" in node["right"]:
            result.append(node)
        else:
            pending.extend(reversed(children(node)))
    return result


class TreeIdentities:
    def __init__(self):
        self.nodes, self.ids = [], {}
        self.sequences, self.sequence_ids = [(0, -1)], {}
        self.concatenations, self.seals = {}, {}
        self.semantic_nodes, self.semantic_sequences = {}, {}
        self.empty_projection = self.intern(("EmptyProjection",), True)

    def intern(self, key, empty=False):
        old = self.ids.get(key)
        if old is not None:
            return old
        identity = len(self.nodes)
        self.ids[key] = identity
        self.nodes.append((key, empty))
        return identity

    def append(self, prefix, node):
        if self.nodes[node][1]:
            return prefix
        key = prefix, node
        old = self.sequence_ids.get(key)
        if old is not None:
            return old
        result = len(self.sequences)
        self.sequences.append(key)
        self.sequence_ids[key] = result
        return result

    def concat(self, left, right):
        if not left: return right
        if not right: return left
        key = left, right
        old = self.concatenations.get(key)
        if old is not None: return old
        pending = []
        while right:
            right, node = self.sequences[right]
            pending.append(node)
        result = left
        for node in reversed(pending):
            result = self.append(result, node)
        self.concatenations[key] = result
        return result

    def elements(self, sequence):
        nodes = []
        while sequence:
            sequence, node = self.sequences[sequence]
            nodes.append(node)
        return list(reversed(nodes))

    def semantic(self, identity):
        import json
        if identity is None: return None
        pending = [identity]
        while pending:
            node = pending[-1]
            if node in self.semantic_nodes:
                pending.pop()
                continue
            key = self.nodes[node][0]
            if key[0] != "Rule":
                self.semantic_nodes[node] = json.dumps(key, separators=(",", ":"))
                continue
            children = self.elements(key[2])
            missing = next((child for child in children if child not in self.semantic_nodes), None)
            if missing is not None:
                pending.append(missing)
                continue
            self.semantic_nodes[node] = '["Rule",' + json.dumps(key[1]) + ',[' + ','.join(self.semantic_nodes[child] for child in children) + ']]'
        return self.semantic_nodes[identity]

    def sequence_semantic(self, sequence):
        if sequence not in self.semantic_sequences:
            self.semantic_sequences[sequence] = '[' + ','.join(self.semantic(node) for node in self.elements(sequence)) + ']'
        return self.semantic_sequences[sequence]

    def rule(self, name, sequence):
        return self.intern(("Rule", name, sequence), sequence == 0)

    def written(self, terminal, value):
        return self.intern(("Written", terminal, value))

    def omitted(self, terminal):
        return self.intern(("Omitted", terminal))

    def seal(self, values):
        return self.intern(("Seal", tuple(values)))


def own_conditions(production):
    return [production.tags_term, production.parent_tags, production.conds_predict,
            [condition for group in production.conds_at.values() for condition in group],
            production.tree_conditions]


def prepare(lowered):
    demands = {}
    outer, whole = {}, set()
    for p in lowered.productions:
        names = {term["capture"] for c in comparisons(own_conditions(p)) for term in (c["left"], c["right"])}
        demands[p.real_id] = ["" in names, {p.captures[n] for n in names if n in p.captures}]
        if p.helper:
            outer.setdefault(p.lhs, set()).update(names - p.captures.keys() - {""})
            if "" in names: whole.add(p.lhs)
    changed = True
    while changed:
        changed = False
        for p in lowered.productions:
            if not p.helper: continue
            for terminal, symbol in zip(p.terminal, p.rhs):
                if terminal: continue
                if symbol in whole and p.lhs not in whole:
                    whole.add(p.lhs)
                    changed = True
                names = outer.get(symbol, set()) - p.captures.keys() - outer[p.lhs]
                if names:
                    outer[p.lhs].update(names)
                    changed = True
    for p in lowered.productions:
        demand = demands[p.real_id]
        for index, (terminal, symbol) in enumerate(zip(p.terminal, p.rhs)):
            if terminal: continue
            if symbol in whole: demand[0] = True
            demand[1].update(position for name, position in p.captures.items() if name in outer.get(symbol, ()) and position < index)
    lowered.tree_demands = demands


def check_cycles(lowered, structural):
    from ._errors import GencmuError
    sites = list(lowered.tree_sites)
    for p in lowered.productions:
        bindings = {name: (p.terminal[at], p.rhs[at]) for name, at in p.captures.items()}
        for comparison in comparisons([p.tags_term, p.parent_tags, p.conds_predict, list(p.conds_at.values())]):
            sites.append((comparison, p, bindings, ()))
    # A named root adds its constructor once. Only its children demand other rules.
    nullable, rows = set(), {}
    for lhs, rhs, terminal in structural:
        rows.setdefault(lhs, []).append((rhs, terminal))
    changed = True
    while changed:
        changed = False
        for lhs, rhs, terminal in structural:
            if lhs not in nullable and all(not t and s in nullable for s, t in zip(rhs, terminal)):
                nullable.add(lhs)
                changed = True
    edges = {}
    for lhs, productions in rows.items():
        edges[lhs] = [(symbol, all(j == i or not ts[j] and rhs[j] in nullable for j in range(len(rhs))))
                      for rhs, ts in productions for i, symbol in enumerate(rhs)
                      if not ts[i] and symbol not in lowered.ranked_helpers]
    import json
    order, hints = {}, {}
    next_order = 0
    for rule in lowered.grammar.rules.values():
        definitions = {}
        for alt in rule.alternatives: definitions.setdefault((alt.document, alt.at), []).append(alt)
        for (document, _), alternatives in definitions.items():
            for root in (alternatives[0].rule_tags, *(alt.tags for alt in alternatives), alternatives[0].conditions):
                for comparison in comparisons(root):
                    order[id(comparison)] = next_order
                    hints.setdefault((document, getattr(comparison, "at", None), json.dumps(comparison, sort_keys=True)), next_order)
                    next_order += 1
    def ordinal(site):
        comparison, p, _, _ = site
        return order.get(id(comparison), hints.get((p.source.document, getattr(comparison, "at", None), json.dumps(comparison, sort_keys=True)), next_order)), p.id
    sites.sort(key=ordinal)
    for comparison, p, bindings, prefix in sites:
        roots = []
        for term in (comparison["left"], comparison["right"]):
            name = term["capture"]
            if name:
                binding = bindings.get(name)
                if binding is not None and not binding[0]: roots.append(binding[1])
            else:
                roots.extend(prefix)
                if not p.helper:
                    roots.extend(symbol for terminal, symbol in zip(p.terminal, p.rhs) if not terminal and symbol not in lowered.ranked_helpers)
        pending, reachable, known = list(reversed(roots)), [], set()
        while pending:
            name = pending.pop()
            if name in known: continue
            known.add(name)
            reachable.append(name)
            pending.extend(child for child, _ in reversed(edges.get(name, ())))
        done, active, path = set(), {}, []
        for root in reachable:
            if root in done: continue
            stack = [(root, 0)]
            while stack:
                name, index = stack[-1]
                if name not in active:
                    active[name] = len(path)
                    path.append(name)
                children = edges.get(name, ())
                if index == len(children):
                    path.pop()
                    active.pop(name)
                    done.add(name)
                    stack.pop()
                    continue
                stack[-1] = name, index + 1
                child, marked = children[index]
                if not marked or child in done: continue
                if child in active:
                    cycle = [lowered.rule_names[n] for n in (*path[active[child]:], child) if not lowered.rule_names[n].startswith("\0")]
                    source = p.source
                    at = getattr(comparison, "at", source.at)
                    place = f"{source.document}:{at[0]}:{at[1]}"
                    raise GencmuError(f"{place}: tree comparison demands a cycle {' → '.join(cycle)} that can repeat a demanded rule over one span", document=source.document, line=at[0], column=at[1], stage=lowered.grammar.stage)
                stack.append((child, 0))


def derivation_identity(context, root):
    if not hasattr(context, "emission_trees"):
        context.emission_trees = TreeIdentities()
        context.emission_tree_values = {}
    machine, memo = context.emission_trees, context.emission_tree_values
    pending = [root]
    while pending:
        node = pending[-1]
        if node in memo:
            pending.pop()
            continue
        if not hasattr(node, "production"):
            identity = machine.written(node.terminal, context.tokens[node.token].value)
            memo[node] = identity, machine.append(0, identity)
            continue
        child = next((child for index, child in enumerate(node.children)
                      if (node.production.terminal[index] or node.production.rhs[index] not in context.lowered.ranked_helpers)
                      and child not in memo), None)
        if child is not None:
            pending.append(child)
            continue
        sequence = 0
        for index, child in enumerate(node.children):
            if not node.production.terminal[index] and node.production.rhs[index] in context.lowered.ranked_helpers:
                sequence = machine.append(sequence, machine.seal(token.value for token in context.tokens[child.start:child.end]))
            else:
                sequence = machine.concat(sequence, memo[child][1])
        identity = None
        if not node.production.helper:
            identity = machine.rule(node.production.rule_name, sequence)
            sequence = machine.append(0, identity)
        elif not node.children and node.production.elided is not None:
            identity = machine.omitted(node.production.elided)
            sequence = machine.append(0, identity)
        memo[node] = identity, sequence
    return memo[root][0]
