"""Expand parameterized rules before ordinary stitching (engine §2.3)."""

from __future__ import annotations

from copy import copy
import json

from ._errors import GencmuError
from ._strings import spelling
from ._template_nodes import argument_of_expression, clone_nodes, has_unresolved, identity, nodes, normalize_argument


def key_of(value):
    return json.dumps(identity(value), ensure_ascii=False, separators=(",", ":"))


def quoted(value, unicode):
    result = '"'
    for c in value:
        code = ord(c)
        if c in '"\\\b\t\n\f\r':
            result += json.dumps(c)[1:-1]
        elif code < 32 or spelling(c, unicode).startswith("$_"):
            result += ''.join('\\u' + format(int.from_bytes(c.encode('utf-16-be')[i:i+2], 'big'), '04x')
                              for i in range(0, len(c.encode('utf-16-be')), 2))
        else:
            result += c
    return result + '"'


def canonical_argument(n, unicode):
    def p(x):
        return canonical_argument(x, unicode)
    if "call" in n:
        return n["call"] + '(' + ', '.join(map(p, n["args"])) + ')'
    if "param" in n:
        return '@' + n["param"]
    for key in ("rule", "tag", "terminal", "ref", "name", "integer", "classifier"):
        if key in n:
            return n[key]
    for key in ("const", "constant"):
        if key in n:
            return '$' + n[key]
    if "string" in n:
        return quoted(n["string"], unicode)
    if "literal" in n:
        return p(n["literal"])
    if "range" in n:
        return '..'.join(map(p, n["range"]))
    for key, text in (("wildcard", "_"), ("empty", "ε"), ("emptySet", "∅")):
        if key in n:
            return text
    if "requirements" in n and "test" not in n:
        return '<' + ' '.join(('¬' if x["negated"] else '') + p(x["value"]) for x in n["requirements"]) + '>'
    if "targets" in n:
        return ' | '.join(map(p, n["targets"]))
    if "body" in n:
        body = body_text(n["body"], unicode)
        return body if any(k in n["body"] for k in ("empty", "optional", "repeat")) else '(' + body + ')'
    if "test" in n:
        return p(n["expr"]) + (p({"requirements": n["requirements"]}) if n["test"] == "tags" else n["test"] + p(n["value"]))
    if "pattern" in n:
        return '#(' + pattern_text(n["pattern"], unicode) + ')'
    for key, op in (("concat", " ++ "), ("union", " ∪ "), ("intersection", " ∩ "), ("difference", " ∖ ")):
        if key not in n:
            continue
        values = n[key]
        if key == "union" and (all("tag" in x for x in values) or all("string" in x for x in values)):
            return ' '.join(map(p, values))
        return op.join('(' + p(x) + ')' if any(k in x for k in ("concat", "union", "intersection", "difference")) else p(x) for x in values)
    if "method" in n:
        separator = ' | ' if n["method"] in ("matches", "begins", "ends", "followed-by", "preceded-by") else ', '
        args = '(' + separator.join(map(p, n["args"])) + ')' if n["args"] else ''
        receiver = p(n['receiver'])
        if any(k in n['receiver'] for k in ('concat', 'union', 'intersection', 'difference')):
            receiver = '(' + receiver + ')'
        return receiver + '.' + n["method"] + args
    if "capture" in n:
        return '$' + n["capture"]
    if "if" in n:
        return '(' + p(n["if"]) + ' ⟹ ' + p(n["then"]) + ')'
    if "op" in n:
        return p(n["left"]) + ' ' + n["op"] + ' ' + p(n["right"])
    if "not" in n:
        return '¬' + p(n["not"])
    if "any" in n or "all" in n:
        key = 'any' if 'any' in n else 'all'
        return '(' + (' ∨ ' if key == 'any' else ' ∧ ').join(map(p, n[key])) + ')'
    if "captured" in n:
        return '$' + n["captured"]
    raise ValueError('unprintable argument ' + str(n))


def body_text(n, unicode, parent=''):
    priority = {"seq": 3, "and": 2, "choice": 1, "ranked": 1}
    for key, op in (("seq", " "), ("and", " & "), ("choice", " | "), ("ranked", " ≻ ")):
        if key in n:
            text = op.join(body_text(x, unicode, key) for x in n[key])
            return '(' + text + ')' if parent and priority[key] <= priority[parent] else text
    if "optional" in n:
        return '[' + ('+' if n.get('elidable') else '') + body_text(n['optional'], unicode) + ']'
    if "repeat" in n:
        return ('{' + ('... ' if n.get('chain') == 'left' else '') + body_text(n['repeat'], unicode)
                + (' ...' if n.get('chain') == 'right' else '')
                + (' / ' + body_text(n['separator'], unicode) if 'separator' in n else '') + '}')
    return canonical_argument(n, unicode)


def pattern_text(n, unicode):
    def p(x):
        return pattern_text(x, unicode)
    if "node" in n or "children" in n:
        return p(n.get('node', n.get('children')))
    if "sequence" in n:
        return ' '.join(map(p, n['sequence']))
    if "siblings" in n:
        return '⋯'
    if "path" in n:
        return '(' + p(n['pattern']) + ') ⋰' if n['path'] == 'first' else ('⋱ ' if n['path'] == 'last' else '⋮ ') + '(' + p(n['pattern']) + ')'
    if "optional" in n:
        return '[' + p(n['optional']) + ']'
    if "repeat" in n:
        return '{' + p(n['repeat']) + (' / ' + p(n['separator']) if 'separator' in n else '') + '}'
    for key, op in (("union", " ∪ "), ("intersection", " ∩ "), ("difference", " ∖ ")):
        if key in n:
            return op.join('(' + p(x) + ')' for x in n[key])
    return canonical_argument(n, unicode)


def expand_templates(documents, unicode):
    if not any(has_unresolved(dom) for _, dom in documents):
        return documents, None, [], [], []
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
                        edge = dict(to=(n['call'], i), growing=normalize_argument(arg).get('param') != part['param'], event=event, node=n, argument=arg)
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
        normalized = dict(call=call['call'], args=normalize_argument(call['args']), at=call['at'])
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
        if isinstance(root, list):
            for v in root:
                discover(v, event)
        elif isinstance(root, dict):
            if 'alternatives' in root:
                for i, alternative in enumerate(root['alternatives']):
                    for k in ('expr', 'tags', 'value', 'image'):
                        discover(alternative.get(k), event)
                    if i == 0:
                        for k in ('tags', 'value', 'image', 'conditions', 'emit'):
                            discover(root.get(k), event)
                return
            children = [root.get('receiver'), root['args']] if 'method' in root else [root['args']] if 'call' in root else [v for k, v in root.items() if k != 'at']
            for v in children:
                discover(v, event)
            if 'call' in root and not any('param' in n for n in nodes(root)):
                intern(root, event, True)

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
        arg = normalize_argument(arg)
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
            if 'string' in arg or arg.get('const', '').startswith('_'):
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
        if isinstance(root, list):
            return [substitute(v, env, event, position) for v in root]
        if not isinstance(root, dict):
            return root
        if 'param' in root:
            return convert(env[root['param']], position, event, root)
        result = copy(root)
        for key, value in root.items():
            if key == 'at':
                continue
            if key == 'args' and 'call' in root:
                result[key] = [substitute(x, env, event, 'arg') for x in value]
                continue
            if key == 'args' and 'method' in root:
                result[key] = []
                target = root['method'] in ('matches', 'begins', 'ends', 'followed-by', 'preceded-by', 'tags', 'without-elision-except')
                for arg in value:
                    replacement = env.get(arg.get('param'), {})
                    if target and 'targets' in replacement:
                        result[key].extend(convert(x, 'target', event, arg) for x in replacement['targets'])
                    else:
                        result[key].append(substitute(arg, env, event, 'target' if target else 'term'))
                continue
            if key == 'requirements':
                result[key] = []
                for requirement in value:
                    replacement = env.get(requirement['value'].get('param'), {})
                    if 'requirements' in replacement:
                        if requirement['negated']:
                            fail(event, requirement['value'], 'a requirement list cannot replace a negated requirement')
                        result[key].extend(replacement['requirements'])
                    else:
                        result[key].append({**requirement, 'value': substitute(requirement['value'], env, event, 'term')})
                continue
            if key == 'optional' and root.get('elidable'):
                head = value['seq'][0] if 'seq' in value else value
                while 'test' in head:
                    head = head['expr']
                if 'param' in head:
                    arg = normalize_argument(env[head['param']])
                    if set(arg) != {'tag'} or not arg['tag'][:1].isupper():
                        fail(event, head, 'an elidable parameter head requires one bare user tag')
            next_position = child_position(key, position)
            result[key] = substitute(value, env, event, next_position)
        for key in ('concat', 'union'):
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
            instance['definitions'].append({**context, 'rule': expanded})
        for event in retained(instance['definitions']):
            discover(event['rule'], event)

    def rewrite(root, event, position='term'):
        if isinstance(root, list):
            return [rewrite(v, event, position) for v in root]
        if not isinstance(root, dict):
            return root
        if 'call' in root:
            instance = instances.get(key_of(normalize_argument(root)))
            name = effective(instance) if instance else canonical_argument(root, unicode)
            return dict(name=name, at=root['at']) if position == 'pattern' else {'ref' if position == 'expr' else 'rule': name}
        if position == 'pattern' and root.get('name') in templates:
            members = [dict(name=effective(i), at=root['at']) for i in queue if i['call']['call'] == root['name']]
            return members[0] if len(members) == 1 else dict(union=members) if members else dict(difference=[dict(name='text', at=root['at']), dict(name='text', at=root['at'])])
        if root.get('ref') in templates or root.get('rule') in templates:
            fail(event, root, 'a bare template reference must name one instance')
        result = copy(root)
        for key, value in root.items():
            result[key] = value if key == 'at' else rewrite(value, event, child_position(key, position))
        return result

    validation = [{**e, 'rule': rewrite(e['rule'], e)} for e in events if not any(k in e['rule'] for k in ('params', 'args', 'instance'))]
    validation.extend({**e, 'rule': rewrite({**e['rule'], 'name': effective(i)}, e)} for i in queue for e in i['definitions'])
    from ._validate import dom_problem
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
    if position == 'pattern' and key in ('union', 'intersection', 'difference'):
        return 'pattern'
    if key in ('alternatives', 'conditions', 'emit', 'tags', 'value', 'image', 'requirements', 'range', 'literal', 'concat', 'union', 'intersection', 'difference', 'left', 'right', 'receiver', 'if', 'then', 'not', 'all', 'any', 'args'):
        return 'term'
    if key in ('seq', 'choice', 'ranked', 'and', 'optional', 'repeat', 'separator', 'expr') and position != 'pattern':
        return 'expr'
    if key in ('pattern', 'children', 'node'):
        return 'pattern'
    return position


def template_audit(grammar):
    ordered = sorted(grammar.instances, key=lambda i: list(grammar.rules).index(effective(i)))
    by_name = {i['name']: i for i in ordered if i['name']}

    def aliases(a, b):
        if isinstance(a, dict) and isinstance(b, dict):
            if a.get('rule') in by_name and 'call' in b:
                return by_name[a['rule']]['key'] == key_of(normalize_argument(b))
            if b.get('rule') in by_name and 'call' in a:
                return by_name[b['rule']]['key'] == key_of(normalize_argument(a))
            ka, kb = set(a) - {'at'}, set(b) - {'at'}
            return ka == kb and all(aliases(a[k], b[k]) for k in ka)
        if isinstance(a, list) and isinstance(b, list):
            return len(a) == len(b) and all(aliases(x, y) for x, y in zip(a, b))
        return a == b

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
