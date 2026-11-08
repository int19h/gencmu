"""Static reports for ranking patterns (docs/design.md)."""
from dataclasses import asdict
from ._strings import spelling as quoted
from ._patterns import pattern_parts
from ._templates import canonical_argument


def ranking_audit(grammar):
    if not grammar.steps:
        return dict(keySteps=[], countedChanges=[])
    rules = {}

    def body(root):
        refs, terminals, omitted = set(), set(), set()
        pending = [root]
        while pending:
            node = pending.pop()
            if 'ref' in node:
                (refs if node['ref'] in grammar.rules else terminals).add(node['ref'])
            if 'literal' in node and 'string' in node['literal']:
                terminals.add(quoted(node['literal']['string'], grammar.unicode))
            if 'wildcard' in node:
                terminals.add('_')
            if 'range' in node:
                terminals.add('..'.join(quoted(n['string'], grammar.unicode) for n in node['range']))
            if node.get('elidable'):
                head = node['optional']
                while 'seq' in head or 'capture' in head or 'test' in head:
                    head = head['seq'][0] if 'seq' in head else head['expr']
                if 'ref' in head:
                    omitted.add(head['ref'])
            for key in ('seq', 'choice', 'ranked', 'and'):
                pending.extend(node.get(key, ()))
            for key in ('expr', 'optional', 'repeat', 'separator', 'splice'):
                if key in node:
                    pending.append(node[key])
        return refs, terminals, omitted

    for name, rule in grammar.rules.items():
        refs, terminals, omitted = set(), set(), set()
        for alternative in rule.alternatives:
            r, t, o = body(alternative.expr)
            refs.update(r)
            terminals.update(t)
            omitted.update(o)
        rules[name] = dict(refs=refs, terminals=terminals, omitted=omitted)
    reachable, pending = set(), ['text']
    while pending:
        name = pending.pop()
        if name in reachable or name not in rules:
            continue
        reachable.add(name)
        pending.extend(rules[name]['refs'])
    terminals = set().union(*(rules[n]['terminals'] for n in reachable))
    omitted = set().union(*(rules[n]['omitted'] for n in reachable))

    def dead(pattern):
        for key, combine in (('union', all), ('intersection', any)):
            if key in pattern:
                return combine(dead(p) for p in pattern[key])
        if 'difference' in pattern:
            return dead(pattern['difference'][0])
        if 'test' in pattern:
            return dead(pattern['expr'])
        if 'name' in pattern:
            return pattern['name'] not in reachable
        if 'terminal' in pattern:
            return not (terminals or omitted) if pattern['terminal'] == '_' else pattern['terminal'] not in terminals | omitted
        return False

    reports, changes = [], []
    for index, (_, pattern) in enumerate(grammar.steps):
        named, pending = set(), [pattern]
        while pending:
            node = pending.pop()
            if 'name' in node: named.add(node['name'])
            pending.extend(pattern_parts(node))
        report = dict(step=index, pattern=canonical_argument({'pattern': pattern}, grammar.unicode))
        if dead(pattern): report['status'] = 'impossible'
        reports.append(report)
        changes.extend(dict(asdict(change), kind={'extend': 'extended', 'replace': 'replaced'}[change.kind], step=index)
                       for change in grammar.changes if change.rule in named)
    return dict(keySteps=reports, countedChanges=changes)


def format_ranking_reports(reports):
    lines = []
    for report in reports:
        lines.append(report['name'] + ':')
        for step in report['keySteps']:
            if step.get('status'): lines.append(f"  ranking step {step['step'] + 1}: {step['status']}")
        for erasure in report.get('erasures', []):
            lines.append(f"  {erasure['kind']} erasure: {erasure['rule']}")
        for note in report.get('diagnosticNotes', []):
            if note['kind'] == 'guarded-tag-variants':
                detail = f"{note['variants']} guarded tag variants"
            elif note['kind'] == 'query-error':
                detail = f"query target {note['target']} contains error productions. Witnesses exclude unerased own errors"
                detail += " and carried errors outside erased parts" if note['filtered'] else " but allow carried errors"
            else:
                detail = f"suppression code {note['code']} reaches no warning"
            lines.append(f"  {note['rule']}: {detail}")
        for change in report['countedChanges']:
            lines.append(f"  counted rule {change['rule']}: {change['kind']}, step {change['step'] + 1}")
    return '\n'.join(lines)
