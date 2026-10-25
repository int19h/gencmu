"""Expand parameterized rules before ordinary stitching (engine §2.3)."""

from __future__ import annotations

from copy import copy
import json

from ._errors import GencmuError
from ._trampoline import run
from ._pattern_shapes import _print_layered
from ._strings import spelling
from ._template_nodes import argument_of_expression, clone_nodes, has_unresolved, identity, nodes, normalize_argument, pattern_term, pattern_constant_names


def key_of(value):
    return json.dumps(identity(value), ensure_ascii=False, separators=(",", ":"))


def quoted(value, unicode):
    return spelling(value, unicode)


def term_group(n, parent, index):
    if 'if' in n:
        return True
    key = next((k for k in ('concat', 'union', 'intersection', 'difference') if k in n), None)
    if key is None:
        return False
    run = key == 'union' and (all('tag' in x for x in n[key]) or all('string' in x for x in n[key]))
    if run:
        return parent in ('intersection', 'difference')
    priority = dict(union=1, difference=1, intersection=2, concat=3, method=4)
    return priority[key] < priority[parent] or (priority[key] == priority[parent] and (parent == 'intersection' or index > 0 and parent in ('union', 'difference')))


def boolean_group(n, parent):
    key = next((k for k in ('if', 'any', 'all', 'not') if k in n), None)
    if key is None:
        return False
    priority = dict(zip(('if', 'any', 'all', 'not'), (1, 2, 3, 4)))
    return priority[key] < priority[parent] or priority[key] == priority[parent] and parent != 'not'


def canonical_argument(n, unicode):
    return run(_print_argument(n, unicode))


def body_text(n, unicode, parent=''):
    return run(_print_body(n, unicode, parent))


def pattern_text(n, unicode):
    return run(_print_pattern(n, unicode))


def _print_join(items, unicode, printer, separator, parent=None):
    parts = []
    for item in items:
        request = printer(item, unicode) if parent is None else printer(item, unicode, parent)
        parts.append((yield request))
    return separator.join(parts)


def _print_argument(n, unicode):
    if 'call' in n:
        args = yield _print_join(n['args'], unicode, _print_argument, ', ')
        return n['call'] + '(' + args + ')'
    if 'param' in n:
        return '@' + n['param']
    for key in ('rule', 'tag', 'terminal', 'ref', 'name', 'integer', 'classifier'):
        if key in n:
            return n[key]
    for key in ('const', 'constant'):
        if key in n:
            return '$' + n[key]
    if 'string' in n:
        return quoted(n['string'], unicode)
    if 'literal' in n:
        return (yield _print_argument(n['literal'], unicode))
    if 'range' in n:
        return (yield _print_join(n['range'], unicode, _print_argument, '..'))
    for key, text in (('wildcard', '_'), ('empty', 'ε'), ('emptySet', '∅')):
        if key in n:
            return text
    if 'requirements' in n and 'test' not in n:
        parts = []
        for entry in n['requirements']:
            value = yield _print_argument(entry['value'], unicode)
            parts.append(('¬' if entry['negated'] else '') + value)
        return '<' + ' '.join(parts) + '>'
    if 'targets' in n:
        return (yield _print_join(n['targets'], unicode, _print_argument, ' | '))
    if 'body' in n:
        body = yield _print_body(n['body'], unicode)
        return body if any(k in n['body'] for k in ('empty', 'optional', 'repeat')) else '(' + body + ')'
    if 'test' in n:
        expr = yield _print_argument(n['expr'], unicode)
        if n['test'] == 'tags':
            suffix = yield _print_argument({'requirements': n['requirements']}, unicode)
        else:
            suffix = n['test'] + (yield _print_argument(n['value'], unicode))
        return expr + suffix
    if 'pattern' in n:
        return (yield _print_layered(n['pattern'], lambda node: _print_argument(node, unicode), True))
    for key, op in (('concat', ' ++ '), ('union', ' ∪ '), ('intersection', ' ∩ '), ('difference', ' ∖ ')):
        if key in n:
            values = n[key]
            if key == 'union' and (all('tag' in x for x in values) or all('string' in x for x in values)):
                return (yield _print_join(values, unicode, _print_argument, ' '))
            parts = []
            for i, value in enumerate(values):
                text = yield _print_argument(value, unicode)
                parts.append('(' + text + ')' if term_group(value, key, i) else text)
            return op.join(parts)
    if 'method' in n:
        separator = ' | ' if n['method'] in ('matches', 'begins', 'ends', 'followed-by', 'preceded-by') else ', '
        args = yield _print_join(n['args'], unicode, _print_argument, separator)
        receiver = yield _print_argument(n['receiver'], unicode)
        if term_group(n['receiver'], 'method', 0):
            receiver = '(' + receiver + ')'
        return receiver + '.' + n['method'] + ('(' + args + ')' if n['args'] else '')
    if 'capture' in n:
        return '$' + n['capture']
    if 'if' in n:
        condition = yield _print_argument(n['if'], unicode)
        then = yield _print_argument(n['then'], unicode)
        return ('(' + condition + ')' if boolean_group(n['if'], 'if') else condition) + ' ⟹ ' + then
    if 'op' in n:
        parts = []
        for value in (n['left'], n['right']):
            text = yield _print_argument(value, unicode)
            parts.append('(' + text + ')' if 'if' in value else text)
        return (' ' + n['op'] + ' ').join(parts)
    if 'not' in n:
        text = yield _print_argument(n['not'], unicode)
        return '¬' + ('(' + text + ')' if boolean_group(n['not'], 'not') else text)
    if 'any' in n or 'all' in n:
        key = 'any' if 'any' in n else 'all'
        parts = []
        for value in n[key]:
            text = yield _print_argument(value, unicode)
            parts.append('(' + text + ')' if boolean_group(value, key) else text)
        return (' ∨ ' if key == 'any' else ' ∧ ').join(parts)
    if 'captured' in n:
        return '$' + n['captured']
    raise ValueError('unprintable argument ' + str(n))


def _print_body(n, unicode, parent=''):
    priority = {'seq': 3, 'and': 2, 'choice': 1, 'ranked': 1}
    for key, op in (('seq', ' '), ('and', ' & '), ('choice', ' | '), ('ranked', ' ≻ ')):
        if key in n:
            text = yield _print_join(n[key], unicode, _print_body, op, key)
            return '(' + text + ')' if parent and priority[key] <= priority[parent] else text
    if 'optional' in n:
        return '[' + ('+' if n.get('elidable') else '') + (yield _print_body(n['optional'], unicode)) + ']'
    if 'repeat' in n:
        text = yield _print_body(n['repeat'], unicode)
        separator = ' / ' + (yield _print_body(n['separator'], unicode)) if 'separator' in n else ''
        return ('{' + ('... ' if n.get('chain') == 'left' else '') + text
                + (' ...' if n.get('chain') == 'right' else '') + separator + '}')
    return (yield _print_argument(n, unicode))


def _print_pattern(n, unicode):
    return (yield _print_layered(n, lambda node: _print_argument(node, unicode), False))


def expand_templates(documents, unicode):
    from ._validate import dom_problem
    if not any(has_unresolved(dom) for _, dom in documents):
        return documents, None, [], [], []
    patterns = pattern_constant_names(c for _, dom in documents for c in dom["constants"])
    normalize = lambda value: normalize_argument(value, patterns)
    templates, names, instances = {}, {}, {}
    slots, events, queue, extra = [], [], [], []

    def fail(event, node, message):
        at = node.get('at', event['rule']['at'])
        if 'origin' in event:
            origin = event['origin']
            message += f", in {event['instance']} called at {origin['document']}:{origin['at'][0]}:{origin['at'][1]}"
        raise GencmuError(message, document=event['path'], line=at[0], column=at[1],
                          code='unbounded-instantiation' if message.startswith('unbounded-instantiation:') else None)

    serial = 0
    for path, dom in documents:
        declarations = sorted([(key, r) for key in ('rules', 'constants', 'directives', 'classifiers', 'implications') for r in dom[key]], key=lambda item: item[1]['at'])
        for kind, rule in declarations:
            event = dict(path=path, rule=rule, index=serial)
            serial += 1
            if kind != 'rules':
                extra.append(event)
                continue
            events.append(event)
            name = rule['name']
            if 'params' in rule:
                previous = templates.get(name)
                if rule['op'] == 'define':
                    if previous or name in names:
                        fail(event, rule, f'duplicate template {name}')
                    templates[name] = dict(name=name, arity=len(rule['params']), events=[event], at=rule['at'], path=path)
                else:
                    if not previous or previous['arity'] != len(rule['params']):
                        fail(event, rule, f'template {name} requires an earlier declaration with the same arity')
                    previous['events'].append(event)
            elif 'args' not in rule:
                if name in templates:
                    fail(event, rule, 'a template and an ordinary rule cannot share a name')
                if rule['op'] == 'define':
                    if name in names:
                        fail(event, rule, f'duplicate rule {name}')
                    names[name] = [event]
                    slots.append(name)
                else:
                    if name not in names:
                        fail(event, rule, f'{name} requires an earlier definition')
                    names[name].append(event)
    edges = {(t['name'], i): [] for t in templates.values() for i in range(t['arity'])}
    for event in events + extra:
        rule, params = event['rule'], event['rule'].get('params', [])
        for n in nodes(rule):
            if 'param' in n and n['param'] not in params:
                fail(event, n, 'undeclared parameter @' + n['param'])
            if 'call' not in n:
                continue
            target = templates.get(n['call'])
            if not target:
                fail(event, n, 'unknown template ' + n['call'])
            if len(n['args']) != target['arity']:
                fail(event, n, f"template {n['call']} expects {target['arity']} arguments")
            for i, arg in enumerate(n['args']):
                for part in nodes(arg):
                    if 'capture' in part or 'captured' in part:
                        fail(event, part, 'an argument cannot read or declare captures')
                    if part.get('param') in params:
                        edge = dict(to=(n['call'], i), growing=normalize(arg).get('param') != part['param'], event=event, node=n, argument=arg)
                        edges[(rule['name'], params.index(part['param']))].append(edge)
    for source, outgoing in edges.items():
        for edge in outgoing:
            if not edge['growing']:
                continue
            pending, seen = [(edge['to'], [])], set()
            while pending:
                target, steps = pending.pop()
                if target == source:
                    cycle = [(source, edge)] + steps
                    trail = ' then '.join(f"{a[0]}:{a[1]} → {b['to'][0]}:{b['to'][1]} at {b['event']['path']}:{b['node']['at'][0]}:{b['node']['at'][1]}" for a, b in cycle)
                    fail(edge['event'], edge['node'], 'unbounded-instantiation: ' + trail + ', growing argument ' + canonical_argument(edge['argument'], unicode))
                if target in seen:
                    continue
                seen.add(target)
                pending.extend((e['to'], steps + [(target, e)]) for e in edges.get(target, []))

    def intern(call, event, discover=False):
        signature = templates.get(call['call'])
        if not signature or len(call['args']) != signature['arity']:
            fail(event, call, 'an instance call requires the declared arity')
        normalized = dict(call=call['call'], args=normalize(call['args']), at=call['at'])
        key = key_of(normalized)
        if key not in instances:
            instances[key] = dict(key=key, call=normalized, canonical=canonical_argument(normalized, unicode), name=None,
                                  origin=dict(document=event['path'], at=call['at']), locals=[], definitions=[])
        instance = instances[key]
        if discover and not instance.get('discovered'):
            instance.update(discovered=True, origin=dict(document=event['path'], at=call['at']))
            queue.append(instance)
        return instance

    def discover(root, event):
        pending = [(root, False)]
        while pending:
            node, ready = pending.pop()
            if isinstance(node, list):
                pending.extend((v, False) for v in reversed(node))
            elif isinstance(node, dict):
                if ready:
                    if 'call' in node and not any('param' in n for n in nodes(node['args'])):
                        intern(node, event, True)
                    if 'call' in node and 'children' in node:
                        pending.append((node['children'], False))
                    continue
                if 'alternatives' in node:
                    children = []
                    for i, alternative in enumerate(node['alternatives']):
                        children.extend(alternative.get(k) for k in ('expr', 'tags', 'value', 'image'))
                        if i == 0:
                            children.extend(node.get(k) for k in ('tags', 'value', 'image', 'conditions', 'emit'))
                else:
                    children = [node.get('receiver'), node['args']] if 'method' in node else [node['args']] if 'call' in node else [node[k] for k in ordered_keys(node)]
                pending.append((node, True))
                pending.extend((v, False) for v in reversed(children))

    current, ordinary = {}, {}
    for event in events:
        rule, name = event['rule'], event['rule']['name']
        if 'params' in rule:
            continue
        if 'args' in rule:
            template = templates.get(name)
            if not template or template['events'][0]['index'] >= event['index']:
                fail(event, rule, 'an instance edit requires an earlier template')
            if any('param' in n for n in nodes(rule['args'])):
                fail(event, rule, 'an instance edit requires a closed call')
            intern(dict(call=name, args=rule['args'], at=rule['at']), event)['locals'].append(event)
        elif 'instance' in rule:
            instance, old = intern(rule['instance'], event), current.get(name)
            if instance['name'] and instance['name'] != name:
                fail(event, rule, 'an instance has at most one public name')
            if old is instance:
                fail(event, rule, 'repeating an instance binding is invalid')
            if old:
                old.update(name=None, binding=None)
            instance.update(name=name, binding=dict(document=event['path'], line=rule['at'][0], column=rule['at'][1]))
            current[name] = instance
            ordinary.pop(name, None)
        elif name in current:
            current[name]['locals'].append(event)
        else:
            ordinary.setdefault(name, []).append(event)

    def retained(items):
        start = 0
        for i, event in enumerate(items):
            if event['rule']['op'] != 'extend':
                start = i
        return items[start:]

    for event in sorted(events + extra, key=lambda e: e['index']):
        rule = event['rule']
        if any(e is event for e in extra):
            discover(rule, event)
            continue
        if 'instance' in rule:
            discover(rule['instance'], event)
            continue
        if 'args' in rule:
            discover(dict(call=rule['name'], args=rule['args'], at=rule['at']), event)
        items = templates[rule['name']]['events'] if 'params' in rule else ordinary.get(rule['name'])
        if items is None:
            subject = next((i for i in instances.values() if any(e is event for e in i['locals'])), None)
            if subject:
                items = sorted(templates[subject['call']['call']]['events'] + subject['locals'], key=lambda e: e['index'])
        if items and any(e is event for e in retained(items)):
            body = dict(rule)
            body.pop('args', None)
            discover(body, event)

    def convert(arg, position, event, use):
        arg = normalize(arg)
        if position == 'arg':
            return arg
        if position == 'expr':
            if 'body' in arg:
                return arg['body']
            if 'targets' in arg:
                return dict(choice=[convert(x, 'expr', event, use) for x in arg['targets']])
            if any(k in arg for k in ('rule', 'tag', 'terminal')):
                return dict(ref=arg.get('rule', arg.get('tag', arg.get('terminal'))))
            if 'string' in arg or 'const' in arg:
                return dict(literal=arg)
            if any(k in arg for k in ('call', 'test', 'range', 'wildcard')):
                return arg
        elif position == 'pattern':
            if 'rule' in arg:
                return dict(name=arg['rule'], at=use['at'])
            if 'tag' in arg or 'terminal' in arg:
                return dict(terminal=arg.get('tag', arg.get('terminal')), at=use['at'])
            if 'pattern' in arg:
                return arg['pattern']
            if 'string' in arg:
                return dict(literal=arg, at=use['at'])
            if 'const' in arg:
                return dict(constant=arg['const'], at=use['at'])
            if 'test' in arg:
                return {**arg, 'expr': convert(argument_of_expression(arg['expr']), 'pattern', event, use)}
            if any(k in arg for k in ('range', 'wildcard', 'call')):
                return {**arg, 'at': use['at']}
        elif position == 'target':
            if 'tag' in arg:
                return dict(terminal=arg['tag'])
            if any(k in arg for k in ('rule', 'terminal', 'call')):
                return arg
        elif position == 'term' and not any(k in arg for k in ('body', 'targets', 'requirements', 'rule', 'call', 'test', 'range', 'wildcard')):
            return arg
        fail(event, use, f"argument {canonical_argument(arg, unicode)} is invalid at @{use['param']} in {position} position")

    def substitute(root, env, event, position='term'):
        return run(substitute_walk(root, env, event, position))

    def substitute_walk(root, env, event, position='term'):
        if isinstance(root, list):
            items = []
            for v in root:
                items.append((yield substitute_walk(v, env, event, position)))
            return items
        if not isinstance(root, dict):
            return root
        if 'param' in root:
            converted = convert(env[root['param']], position, event, root)
            if position != 'pattern' or not (root.get('exact') or 'children' in root):
                return converted
            if any(key in converted for key in ('union', 'intersection', 'difference', 'path')):
                fail(event, root, 'a compound pattern cannot carry node decorations')
            result = dict(converted)
            if root.get('exact'):
                if converted.get('exact'):
                    fail(event, root, 'an exact prefix conflicts with an argument prefix')
                result['exact'] = True
            if 'children' in root:
                if not ('name' in converted or 'call' in converted) or 'children' in converted:
                    fail(event, root, 'an attached list requires a rule test without children')
                result['children'] = yield substitute_walk(root['children'], env, event, 'pattern-item')
            return result
        result = copy(root)
        for key, value in root.items():
            if key == 'at':
                continue
            if key == 'args' and 'call' in root:
                result[key] = []
                for x in value:
                    result[key].append((yield substitute_walk(x, env, event, 'arg')))
                continue
            if key == 'args' and 'method' in root:
                result[key] = []
                query = root['method'] in ('matches', 'begins', 'ends', 'followed-by', 'preceded-by')
                target = query or root['method'] in ('tags', 'without-elision-except')
                for arg in value:
                    replacement = env.get(arg.get('param'), {})
                    if query and 'targets' in replacement:
                        result[key].extend(convert(x, 'target', event, arg) for x in replacement['targets'])
                    else:
                        result[key].append((yield substitute_walk(arg, env, event, 'target' if target else 'term')))
                continue
            if key == 'requirements':
                result[key] = []
                for requirement in value:
                    replacement = env.get(requirement['value'].get('param'), {})
                    if set(replacement) == {'requirements'}:
                        if requirement['negated']:
                            fail(event, requirement['value'], 'a requirement list cannot replace a negated requirement')
                        result[key].extend(replacement['requirements'])
                    else:
                        result[key].append({**requirement, 'value': (yield substitute_walk(requirement['value'], env, event, 'term'))})
                continue
            if key == 'optional' and root.get('elidable'):
                head = value['seq'][0] if 'seq' in value else value
                while 'test' in head:
                    head = head['expr']
                if 'param' in head:
                    arg = normalize(env[head['param']])
                    if set(arg) != {'tag'} or not arg['tag'][:1].isupper():
                        fail(event, head, 'an elidable parameter head requires one bare user tag')
            next_position = child_position(key, position)
            result[key] = yield substitute_walk(value, env, event, next_position)
        if position == 'pattern' and 'test' in result and result['expr'].get('exact'):
            if result.get('exact'):
                use = root['expr']
                while 'expr' in use:
                    use = use['expr']
                fail(event, use, 'an exact prefix conflicts with an argument prefix')
            result['exact'] = True
            result['expr'] = {key: value for key, value in result['expr'].items() if key != 'exact'}
        for key in ('concat', 'union', 'intersection'):
            if key == 'intersection' and position != 'pattern' and not pattern_term(result, patterns):
                continue
            if key in result:
                result[key] = [v for x in result[key] for v in x.get(key, [x])]
        return result

    cursor = 0
    while cursor < len(queue):
        instance = queue[cursor]
        cursor += 1
        template = templates[instance['call']['call']]
        applicable = sorted(template['events'] + instance['locals'], key=lambda e: e['index'])
        for event in applicable:
            env = dict(zip(event['rule'].get('params', []), instance['call']['args']))
            body = copy(event['rule'])
            for key in ('params', 'args', 'instance'):
                body.pop(key, None)
            body['name'] = effective(instance)
            context = {**event, 'origin': instance['origin'], 'instance': instance['canonical']}
            expanded = substitute(body, env, context)
            problem = dom_problem(empty_dom(documents[0][1]['format'], [{**expanded, 'name': 'expanded'}]), unicode, True)
            if problem:
                fail(context, expanded, problem)
            instance['definitions'].append({**context, 'rule': expanded})
        for event in retained(instance['definitions']):
            discover(event['rule'], event)

    def rewrite(root, event, position='term'):
        return run(rewrite_walk(root, event, position))

    def rewrite_walk(root, event, position='term'):
        if isinstance(root, list):
            items = []
            for v in root:
                items.append((yield rewrite_walk(v, event, position)))
            return items
        if not isinstance(root, dict):
            return root
        if 'call' in root:
            instance = instances.get(key_of(normalize(dict(call=root['call'], args=root['args'], at=root['at']))))
            name = effective(instance) if instance else canonical_argument(root, unicode)
            if position == 'pattern':
                result = dict(name=name, at=root['at'])
                if root.get('exact'):
                    result['exact'] = True
                if 'children' in root:
                    result['children'] = yield rewrite_walk(root['children'], event, 'pattern-item')
                return result
            return {'ref' if position == 'expr' else 'rule': name}

        if position == 'pattern' and root.get('name') in templates:
            members = []
            for instance in queue:
                if instance['call']['call'] != root['name']:
                    continue
                member = {**root, 'name': effective(instance)}
                if 'children' in root:
                    member['children'] = yield rewrite_walk(root['children'], event, 'pattern-item')
                members.append(member)
            return members[0] if len(members) == 1 else dict(union=members) if members else dict(difference=[dict(name='text', at=root['at']), dict(name='text', at=root['at'])])
        if root.get('ref') in templates or root.get('rule') in templates:
            fail(event, root, 'a bare template reference must name one instance')
        result = copy(root)
        for key, value in root.items():
            result[key] = value if key == 'at' else (yield rewrite_walk(value, event, child_position(key, position)))
        if position == 'pattern':
            for key in ('union', 'intersection'):
                if key in result:
                    result[key] = [part for value in result[key] for part in value.get(key, [value])]
        return result

    validation = [{**e, 'rule': rewrite(e['rule'], e)} for e in events if not any(k in e['rule'] for k in ('params', 'args', 'instance'))]
    validation.extend({**e, 'rule': rewrite({**e['rule'], 'name': effective(i)}, e)} for i in queue for e in i['definitions'])
    for event in validation:
        aliases, shadow = {}, clone_nodes(event['rule'])
        for node in nodes(shadow):
            for key in ('name', 'rule', 'ref'):
                if isinstance(node.get(key), str) and '(' in node[key]:
                    aliases.setdefault(node[key], 'instance-' + str(len(aliases)))
                    node[key] = aliases[node[key]]
        problem = dom_problem(empty_dom(documents[0][1]['format'], [shadow]), unicode, True)
        if problem:
            fail(event, event['rule'], problem)
    output = [{**e, 'rule': rewrite(e['rule'], e)} for items in ordinary.values() for e in items]
    output.extend({**e, 'rule': rewrite({**e['rule'], 'name': effective(i)}, e)} for i in queue for e in i['definitions'])
    started = set()
    for event in output:
        if event['rule']['name'] not in started:
            event['rule'] = {**event['rule'], 'op': 'define'}
            started.add(event['rule']['name'])
    expanded_docs = [(path, {**dom, 'rules': [], **{k: [rewrite(item, dict(path=path, rule=item)) for item in dom[k]] for k in ('constants', 'directives', 'classifiers', 'implications')}}) for path, dom in documents]
    expanded_docs.extend((e['path'], empty_dom(documents[0][1]['format'], [e['rule']])) for e in output)
    order = [n for n in slots if n in current or n in ordinary] + [effective(i) for i in queue if not i['name']]
    return expanded_docs, order, list(templates.values()), queue, validation


def effective(instance):
    return instance['name'] or instance['canonical']


def empty_dom(format_, rules):
    return dict(format=format_, rules=rules, directives=[], constants=[], classifiers=[], implications=[])


def child_position(key, position):
    if key == 'children' or position == 'pattern-item' and key in ('choice', 'optional', 'repeat', 'separator'):
        return 'pattern-item'
    if position == 'pattern' and key in ('union', 'intersection', 'difference'):
        return 'pattern'
    if key in ('alternatives', 'conditions', 'emit', 'tags', 'value', 'image', 'requirements', 'range', 'literal', 'concat', 'union', 'intersection', 'difference', 'left', 'right', 'receiver', 'if', 'then', 'not', 'all', 'any', 'args'):
        return 'term'
    if key in ('seq', 'choice', 'ranked', 'and', 'optional', 'repeat', 'separator', 'expr') and position != 'pattern':
        return 'expr'
    if key in ('pattern', 'child'):
        return 'pattern'
    return position


def template_audit(grammar):
    ordered = sorted(grammar.instances, key=lambda i: list(grammar.rules).index(effective(i)))
    by_name = {i['name']: i for i in ordered if i['name']}

    def aliases(a, b):
        pending = [(a, b)]
        while pending:
            a, b = pending.pop()
            if isinstance(a, dict) and isinstance(b, dict):
                an = a.get('rule', a.get('ref', a.get('name')))
                bn = b.get('rule', b.get('ref', b.get('name')))
                if an in by_name and 'call' in b:
                    if by_name[an]['key'] != key_of(normalize_argument(b)):
                        return False
                    continue
                if bn in by_name and 'call' in a:
                    if by_name[bn]['key'] != key_of(normalize_argument(a)):
                        return False
                    continue
                ka, kb = set(a) - {'at'}, set(b) - {'at'}
                if ka != kb:
                    return False
                pending.extend((a[k], b[k]) for k in ka)
            elif isinstance(a, list) and isinstance(b, list):
                if len(a) != len(b):
                    return False
                pending.extend(zip(a, b))
            elif isinstance(a, (dict, list)) or isinstance(b, (dict, list)) or a != b:
                return False
        return True

    templates = []
    for template in grammar.templates:
        first = 0
        for i, event in enumerate(template['events']):
            if event['rule']['op'] != 'extend':
                first = i
        used = {e['rule']['params'].index(n['param']) for e in template['events'][first:]
                for n in nodes(e['rule']) if 'param' in n}
        parameters = list(template['events'][0]['rule']['params'])
        notes = [dict(kind='unused-parameter', parameter=p) for i, p in enumerate(parameters) if i not in used]
        if not any(i['call']['call'] == template['name'] for i in ordered):
            notes.append(dict(kind='uncalled-template'))
        templates.append(dict(template=template['name'], parameters=parameters, document=template['path'],
                              line=template['at'][0], column=template['at'][1], notes=notes))
    instances = []
    for instance in ordered:
        flags, events = [], []
        template = next(t for t in grammar.templates if t['name'] == instance['call']['call'])
        indices = {e['index'] for e in template['events']}
        for event in instance['definitions']:
            before = list(flags)
            if event['rule']['op'] != 'extend':
                flags = list(event['rule']['flags'])
            events.append(dict(scope='template' if event['index'] in indices else 'instance', op=event['rule']['op'],
                               document=event['path'], line=event['rule']['at'][0], column=event['rule']['at'][1],
                               flagsBefore=before, flagsAfter=list(flags)))
        twins = [effective(other) for other in ordered if other is not instance
                 and other['call']['call'] == instance['call']['call'] and aliases(other['call']['args'], instance['call']['args'])]
        origin = instance['origin']
        instances.append(dict(template=instance['call']['call'], arguments=identity(instance['call']['args']),
                              name=effective(instance), binding=instance.get('binding'),
                              firstCall=dict(document=origin['document'], line=origin['at'][0], column=origin['at'][1]),
                              flags=flags, events=events, notes=[dict(kind='argument-alias-twin', instances=twins)] if twins else []))
    return dict(templates=templates, instances=instances)


def ordered_keys(node):
    order = ('if', 'then', 'op', 'left', 'right', 'not', 'any', 'all', 'body', 'targets', 'requirements', 'negated', 'value', 'pattern', 'child', 'children', 'expr', 'repeat', 'separator', 'optional', 'seq', 'choice', 'ranked', 'and', 'union', 'intersection', 'difference', 'concat', 'items', 'tags', 'image', 'before', 'after')
    return [k for k in order if k in node] + sorted(k for k in node if k != 'at' and k not in order)
