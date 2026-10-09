"""Sealed slot declarations, templates and the local tag closure."""
from __future__ import annotations
import json
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


class Preferences:
    def __init__(self, stage, rules, declarations):
        edges = {}
        self.paths = {}
        self.stage, self.declarations = stage, declarations
        self.components, self.by_name, self.variants = [], {}, {}
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
        for rule in rules.values():
            for number, source in enumerate(rule.alternatives):
                for expr, path in visit(source.expr):
                    if expr.get('ref') in sites:
                        sites[expr['ref']].append({'document': source.document, 'at': list(source.at), 'rule': rule.name, 'alternative': number, 'path': path, 'expr': expr, 'source': source})
        for name, refs in sites.items():
            if len(refs) != 1:
                self.fail('prefer-slot-multiple-references', name, refs, 'exactly one written reference site is required')
        seen = set()
        for start in edges:
            if start in seen:
                continue
            names, pending = {start}, [start]
            while pending:
                name = pending.pop()
                seen.add(name)
                for other in edges:
                    if (other in edges[name] or name in edges[other]) and other not in names:
                        names.add(other)
                        pending.append(other)
            refs = [sites[name][0] for name in sorted(names)]
            parent = refs[0]['rule']
            if any(ref['rule'] != parent for ref in refs):
                self.fail('prefer-slot-parent', start, refs, 'ranked references require one common parent')
            component = len(self.components)
            self.components.append({'names': names, 'refs': refs, 'parent': parent})
            common = None
            for name in sorted(names):
                ref = sites[name][0]
                variant = {'component': component, 'source': ref['source'], 'roles': {}, 'paths': {}, 'hole_names': set()}
                body = normalize(ref['source'].expr, ref['expr'], '', variant)
                key = canonical(body)
                if common is not None and key != common:
                    self.fail('prefer-slot-template', name, refs, 'parent bodies differ outside the ranked hole')
                common = key
                variant['body'] = body
                variant['hole_names'] = {n for n, role in variant['roles'].items() if role == 'hole'}
                if mentions(ref['source'].emit, variant['hole_names']):
                    self.fail('prefer-slot-template', name, refs, 'an emission item cannot name or read a ranked hole capture')
                self.by_name[name] = component
                self.variants[name] = variant

    def __eq__(self, other):
        if not isinstance(other, Preferences):
            return NotImplemented
        return self.paths == other.paths and self.warnings == other.warnings and self.by_name == other.by_name and {n: (v['body'], v['roles']) for n,v in self.variants.items()} == {n: (v['body'], v['roles']) for n,v in other.variants.items()}

    def fail(self, code, name, refs, detail):
        higher, lower, document, at = next(d for d in self.declarations if name in d[:2])
        sites = ', '.join(f"{r['document']}:{r['at'][0]}:{r['at'][1]} {r['rule']} alternative {r['alternative']} {r['path']}" for r in refs)
        raise GencmuError(f'{code}: Rule {name}: {detail}. Declaration %prefer {higher} > {lower}. References: {sites}', document=document, line=at[0], column=at[1], stage=self.stage)

    def variant(self, production, component, lowered):
        for terminal, symbol in zip(production.terminal, production.rhs):
            if not terminal:
                found = self.variants.get(lowered.rule_names[symbol])
                if found is not None and found['component'] == component:
                    return found
        source = production.slot.source if production.slot is not None else None
        return next((v for v in self.variants.values() if v['source'] is source and v['component'] == component), None)

    def validate(self, lowered):
        unsafe, users = set(), {}
        for p in lowered.productions:
            terms = p.slot.tags
            if terms:
                if any(canonical(t) != canonical({'emptySet': True}) for t in terms):
                    unsafe.add(p.lhs)
            elif len(p.rhs) == 1:
                if p.terminal[0]:
                    unsafe.add(p.lhs)
                else:
                    users.setdefault(p.rhs[0], []).append(p.lhs)
        pending = list(unsafe)
        for child in pending:
            for parent in users.get(child, ()):
                if parent not in unsafe:
                    unsafe.add(parent)
                    pending.append(parent)
        for component, c in enumerate(self.components):
            first = sorted(c['names'])[0]
            def require_empty(expression):
                for name in sorted(c['names']):
                    rule = lowered.rule_ids[name]
                    if rule in unsafe:
                        self.fail('prefer-slot-tags', name, c['refs'], f'private hole tags in {expression} are neither dead nor empty: ' + ' -> '.join(inheritance_path(lowered, rule, unsafe)))
            signatures = {}
            for p in lowered.productions:
                variant = self.variant(p, component, lowered)
                if variant is None:
                    continue
                hole = next((i for i,(terminal,symbol) in enumerate(zip(p.terminal,p.rhs)) if not terminal and lowered.rule_names[symbol] in c['names']), -1)
                private = variant['hole_names'] | {name for name,position in p.captures.items() if position == hole}
                roles = variant['roles']
                common = []
                conditions = [(cond, index) for index,conds in p.conds_at.items() for cond in conds] + [(cond,-1) for cond in p.conds_predict]
                for cond, index in conditions:
                    ready = hole >= 0 and index <= hole
                    if structural_read(cond,private) and not ready:
                        self.fail('prefer-slot-continuation', first, c['refs'], 'private hole pattern requires a ready condition gate: '+canonical(cond,roles))
                    if tag_read(cond,private) and not ready:
                        require_empty(canonical(cond,roles))
                    if not ready:
                        common.append(canonical(cond,roles))
                for term in p.slot.tags:
                    if structural_read(term, private):
                        self.fail('prefer-slot-continuation', first, c['refs'], 'tag term reads private hole structure: '+canonical(term,roles))
                    if tag_read(term, private):
                        require_empty(canonical(term,roles))
                if not p.slot.tags and len(p.rhs) == 1 and hole >= 0:
                    require_empty('default inheritance')
                symbols = [('hole',) if i == hole else (symbol_role(symbol, terminal, variant, lowered),p.tests[i] if p.tests else None) for i,(terminal,symbol) in enumerate(zip(p.terminal,p.rhs))]
                captures = [(roles.get(name,name), index) for name,index in p.captures.items() if index != hole and name != '\u0000']
                key = (tuple(symbols), tuple(captures))
                signature = ([None if t is None else canonical(t,roles) for t in p.slot.tag_clauses],canonical(p.emit,roles))
                previous = signatures.get(key)
                if previous is not None:
                    if previous[0] != signature:
                        self.fail('prefer-slot-template', first, c['refs'], 'effective parent tag or emission clauses differ')
                    if previous[1] != common:
                        self.fail('prefer-slot-continuation', first, c['refs'], 'differing conditions must be ready at the ranked hole boundary')
                signatures[key] = (signature,common)


def contains(expr, target):
    return any(node is target for node,_ in visit(expr))

def direct(expr, target):
    while 'expr' in expr:
        expr = expr['expr']
    return expr is target

def normalize(expr, target, path, variant):
    variant['paths'][id(expr)] = path
    if 'choice' in expr:
        branch = next((child for child in expr['choice'] if contains(child,target)), None)
        if branch is not None:
            return normalize(branch,target,path,variant)
    if 'capture' in expr:
        hole = direct(expr['expr'],target)
        variant['roles'][expr['capture']] = 'hole' if hole else path
        inner = normalize(expr['expr'],target,path+'/expr',variant)
        return inner if hole else {'capture':path,'expr':inner}
    if 'test' in expr and direct(expr['expr'],target):
        return normalize(expr['expr'],target,path+'/expr',variant)
    if expr is target:
        return {'hole': True}
    out = {}
    for key,value in expr.items():
        if key in ('at','resolved'):
            continue
        if key in ('seq','choice','and'):
            out[key] = [normalize(child,target,f'{path}/{key}/{i}',variant) for i,child in enumerate(value)]
        elif key in ('expr','optional','repeat','separator'):
            out[key] = normalize(value,target,path+'/'+key,variant)
        else:
            out[key] = expanded(value)
    return out

def expanded(value, roles=None):
    roles = roles or {}
    if isinstance(value,dict) and 'const' in value and 'value' in value:
        item = value['value']
        if isinstance(item,str):
            return {'string': item}
        if isinstance(item,frozenset):
            tags = [{'tag': tag} for tag in sorted(item)]
            return {'emptySet': True} if not tags else tags[0] if len(tags)==1 else {'union':tags}
        return expanded(item,roles)
    if isinstance(value,frozenset):
        return sorted(value)
    if isinstance(value,(list,tuple)):
        return [expanded(child,roles) for child in value]
    if not isinstance(value,dict):
        return value
    return {key: roles.get(child,child) if key in ('capture','captured') and isinstance(child,str) else [roles.get(n,n) for n in child] if key in ('before','after') else expanded(child,roles) for key,child in value.items() if key not in ('at','resolved')}

def canonical(value,roles=None):
    return json.dumps(expanded(value,roles),ensure_ascii=False,sort_keys=True,separators=(',',':'))

def nodes(value):
    pending = [value]
    while pending:
        node = pending.pop()
        if isinstance(node,dict):
            yield node
            pending.extend(node.values())
        elif isinstance(node,(list,tuple)):
            pending.extend(node)

def mentions(value, names):
    for node in nodes(value):
        if any(node.get(key) in names for key in ('capture','captured')):
            return True
        if any(name in names for key in ('before','after') for name in node.get(key, ())):
            return True
    return False

def tag_read(value, names):
    return any(node.get('call') in ('tags','classes') and len(node.get('args',[]))==1 and node['args'][0].get('capture') in names for node in nodes(value))

def structural_read(value, names):
    return any(node.get('op') in ('≅','≇') and mentions(node.get('left'),names) for node in nodes(value))

def symbol_role(symbol,terminal,variant,lowered):
    if terminal:
        return ('T',symbol)
    name = lowered.rule_names[symbol]
    prods = lowered.rule_productions[symbol]
    if prods and lowered.productions[prods[0]].helper:
        path = lowered.productions[prods[0]].slot.path
        if path in variant['paths']:
            return ('H',variant['paths'][path])
    return ('N',name)

def inheritance_path(lowered, start, unsafe):
    pending,seen,paths = [(start,-1,False)],set(),[]
    while pending:
        rule,previous,finished = pending.pop()
        if finished:
            result = []
            while previous >= 0:
                text,previous = paths[previous]
                result.append(text)
            return list(reversed(result))
        if rule in seen:
            continue
        seen.add(rule)
        for number in reversed(lowered.rule_productions[rule]):
            p = lowered.productions[number]
            source = p.slot.source
            location = f'{source.document}:{source.at[0]}:{source.at[1]} {lowered.rule_names[rule]}'
            if any(canonical(t)!=canonical({'emptySet':True}) for t in p.slot.tags):
                paths.append((location+' tags '+canonical(p.slot.tags),previous))
                pending.append((rule,len(paths)-1,True))
            elif not p.slot.tags and len(p.rhs)==1:
                if p.terminal[0]:
                    paths.append((location+' terminal '+p.rhs[0],previous))
                    pending.append((rule,len(paths)-1,True))
                elif p.rhs[0] in unsafe:
                    paths.append((location,previous))
                    pending.append((p.rhs[0],len(paths)-1,False))
    raise RuntimeError('an unsafe tag source lacks an inheritance path')
