"""Static reports for ranking patterns (docs/design.md)."""
from dataclasses import asdict
from ._strings import spelling as quoted
from ._patterns import pattern_parts
from ._templates import canonical_argument


def pattern_reach(grammar, roots=(), expr=None):
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

    reachable, terminals, omitted, pending = set(), set(), set(), list(roots)

    def add(root):
        refs, terms, omissions = body(root)
        pending.extend(refs)
        terminals.update(terms)
        omitted.update(omissions)

    if expr is not None:
        add(expr)
    while pending:
        name = pending.pop()
        if name in reachable or name not in grammar.rules:
            continue
        reachable.add(name)
        for alternative in grammar.rules[name].alternatives:
            add(alternative.expr)
    return reachable, terminals, omitted


def pattern_dead(pattern, reachable, terminals, omitted):
    if pattern.get("never"):
        return True
    for key, combine in (('union', all), ('intersection', any)):
        if key in pattern:
            return combine(pattern_dead(p, reachable, terminals, omitted) for p in pattern[key])
    if 'difference' in pattern:
        return pattern_dead(pattern['difference'][0], reachable, terminals, omitted)
    if 'test' in pattern:
        return pattern_dead(pattern['expr'], reachable, terminals, omitted)
    if 'name' in pattern:
        return pattern['name'] not in reachable
    if 'terminal' in pattern:
        return not (terminals or omitted) if pattern['terminal'] == '_' else pattern['terminal'] not in terminals | omitted
    return False


def ranking_audit(grammar):
    if not grammar.steps:
        return dict(keySteps=[], countedChanges=[])
    reach = pattern_reach(grammar, ['text'])

    reports, changes = [], []
    for index, (_, pattern) in enumerate(grammar.steps):
        named, pending = set(), [pattern]
        while pending:
            node = pending.pop()
            if 'name' in node: named.add(node['name'])
            pending.extend(pattern_parts(node))
        report = dict(step=index, pattern=canonical_argument({'pattern': pattern}, grammar.unicode))
        if pattern_dead(pattern, *reach): report['status'] = 'impossible'
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
