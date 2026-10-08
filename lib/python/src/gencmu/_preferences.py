"""Stage preferences and their source authoring diagnostics."""
from __future__ import annotations
from collections import deque
from ._errors import GencmuError

def children(expr, path=''):
    out = [(child, f'{path}/{key}/{i}') for key in ('seq', 'choice', 'and') for i, child in enumerate(expr.get(key, []))]
    out.extend(((expr[key], f'{path}/{key}') for key in ('expr', 'optional', 'repeat', 'separator') if key in expr))
    return out

def visit(expr):
    stack = [(expr, '')]
    while stack:
        node, path = stack.pop()
        yield (node, path)
        stack.extend(reversed(children(node, path)))

def properties(expr, facts, restorable):
    values = {}
    stack = [(expr, False)]
    while stack:
        node, ready = stack.pop()
        if not ready:
            stack.append((node, True))
            stack.extend(((child, False) for child, _ in children(node)))
            continue

        def value(child):
            return values[id(child)]
        if 'expr' in node:
            result = value(node['expr'])
        elif node.get('empty'):
            result = (True, True, False)
        elif 'ref' in node and (not node['ref'][0].isupper()):
            result = tuple(facts[node['ref']])
        elif any((key in node for key in ('ref', 'terminal', 'range', 'property'))):
            result = (node.get('ref', node.get('terminal')) in restorable, True, True)
        elif 'optional' in node:
            result = (True, True, value(node['optional'])[2])
        elif 'repeat' in node:
            body = value(node['repeat'])
            sep = value(node['separator']) if 'separator' in node else (True, True, False)
            result = (body[0], body[1], body[2] or (body[1] and sep[1] and sep[2]))
        else:
            key = next((key for key in ('choice', 'and', 'seq') if key in node))
            parts = [value(child) for child in node[key]]
            result = tuple((any((part[i] for part in parts)) for i in range(3))) if key != 'seq' else (all((part[0] for part in parts)), all((part[1] for part in parts)), all((part[1] for part in parts)) and any((part[2] for part in parts)))
        values[id(node)] = result
    return values[id(expr)]

def contained_references(expr, facts, restorable):
    stack = [(expr, '')]
    while stack:
        node, path = stack.pop()
        if 'ref' in node and (not node['ref'][0].isupper()):
            yield (node['ref'], path)
            continue
        parts = children(node, path)
        if 'seq' in node:
            parts = [(child, p) for i, (child, p) in enumerate(parts) if all((i == j or properties(other, facts, restorable)[0] for j, (other, _) in enumerate(parts)))]
        if 'repeat' in node and (not properties(node['repeat'], facts, restorable)[0]):
            parts = [(child, p) for child, p in parts if p != path + '/separator']
        stack.extend(reversed(parts))

class Preferences:
    def __eq__(self, other):
        if not isinstance(other, Preferences):
            return NotImplemented
        return self.paths == other.paths and self.warnings == other.warnings


    def __init__(self, stage, rules, declarations):
        edges = {}
        self.paths = {}
        self.warnings = []

        def fail(declaration, message):
            _, _, document, at = declaration
            return GencmuError(message, document=document, line=at[0], column=at[1], stage=stage)
        for declaration in declarations:
            higher, lower, document, at = declaration
            for name in (higher, lower):
                if name[0].isupper() or name not in rules:
                    raise fail(declaration, f'%prefer requires an existing rule: {name}')
                edges.setdefault(name, set())
            if higher == lower:
                raise fail(declaration, f'%prefer cannot prefer {higher} to itself')
            edges[higher].add(lower)
        self.names = frozenset(edges)
        for start in sorted(edges):
            found = {}
            queue = deque([[start]])
            while queue:
                path = queue.popleft()
                for target in sorted(edges[path[-1]]):
                    if target == start:
                        cycle = path + [target]
                        locations = []
                        first = None
                        for a, b in zip(cycle, cycle[1:]):
                            declaration = next((d for d in declarations if d[:2] == (a, b)))
                            if first is None:
                                first = declaration
                            locations.append(f'{declaration[2]}:{declaration[3][0]}:{declaration[3][1]}')
                        raise fail(first, 'preference cycle: ' + ' > '.join(cycle) + ' (' + ', '.join(locations) + ')')
                    if target not in found:
                        found[target] = path + [target]
                        queue.append(found[target])
            self.paths[start] = found
        if not edges:
            return
        sites = {name: [] for name in edges}
        restorable = set()

        def site(rule, alternative, number, path):
            return {'document': alternative.document, 'at': list(alternative.at), 'rule': rule.name, 'alternative': number, 'path': path}
        for name in sorted(rules):
            rule = rules[name]
            for number, alternative in enumerate(rule.alternatives):
                for expr, path in visit(alternative.expr):
                    if expr.get('ref') in sites:
                        sites[expr['ref']].append(site(rule, alternative, number, path))
                    if expr.get('elidable'):
                        head = expr['optional']
                        if 'seq' in head:
                            head = head['seq'][0]
                        if 'test' in head:
                            head = head['expr']
                        restorable.add(head.get('ref', head.get('terminal')))
        for name in sorted(sites):
            if len(sites[name]) > 1:
                self.warnings.append({'kind': 'prefer-multiple-references', 'stage': stage, 'rule': name, 'references': sites[name], 'message': f'Preference rule {name} has several written construction sites.'})
        facts = {name: [False, False, False] for name in rules}
        changed = True
        while changed:
            changed = False
            for name, rule in rules.items():
                values = [properties(alternative.expr, facts, restorable) for alternative in rule.alternatives]
                for i in range(3):
                    if any((value[i] for value in values)) and (not facts[name][i]):
                        facts[name][i] = True
                        changed = True
        containment = {}
        for name, rule in rules.items():
            containment[name] = [(target, site(rule, alternative, number, path)) for number, alternative in enumerate(rule.alternatives) for target, path in contained_references(alternative.expr, facts, restorable)]

        def containment_path(start, target):
            queue = deque([(start, [])])
            seen = {start}
            while queue:
                name, path = queue.popleft()
                for child, reference in containment[name]:
                    next_path = path + [reference]
                    if child == target:
                        return next_path
                    if child not in seen:
                        seen.add(child)
                        queue.append((child, next_path))
            return None
        for higher in sorted(self.paths):
            for lower in sorted(self.paths[higher]):
                for container, contained in ((higher, lower), (lower, higher)):
                    references = containment_path(container, contained) if facts[contained][2] else None
                    if references is not None:
                        self.warnings.append({'kind': 'prefer-same-span-containment', 'stage': stage, 'higher': higher, 'lower': lower, 'container': container, 'contained': contained, 'references': references, 'message': f'Rule {container} can contain rival {contained} over the same original words.'})
        self.warnings.sort(key=lambda w: tuple((w.get(k, '') for k in ('kind', 'rule', 'higher', 'lower', 'container', 'contained'))))
