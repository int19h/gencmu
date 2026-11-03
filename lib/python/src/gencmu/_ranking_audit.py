"""Static reports for node-pattern ranking steps (docs/design.md)."""

from dataclasses import asdict

from ._patterns import pattern_parts
from ._ranking_patterns import known_tags, possible_node_match
from ._strings import spelling as quoted
from ._templates import canonical_argument


def literals(term):
    found = set()
    pending = [term]
    while pending:
        node = pending.pop()
        if isinstance(node, dict):
            if 'tag' in node:
                found.add(node['tag'])
            found.update(node.get('set', ()))
            pending.extend(node.values())
        elif isinstance(node, list):
            pending.extend(node)
    return found


def widths_together(a, b):
    return sum(1 << i for i in {min(2, x + y) for x in range(3) for y in range(3) if a & (1 << x) and b & (1 << y)})


def widths(expr):
    if 'empty' in expr:
        return 1
    if 'capture' in expr or 'test' in expr:
        return widths(expr['expr'])
    if 'seq' in expr:
        mask = 1
        for part in expr['seq']:
            mask = widths_together(mask, widths(part))
        return mask
    if 'choice' in expr or 'ranked' in expr:
        mask = 0
        for part in expr.get('choice', expr.get('ranked')):
            mask |= widths(part)
        return mask
    return 7 if 'and' in expr else 2


def sole(expr):
    if not widths(expr) & 2:
        return None
    if 'capture' in expr or 'test' in expr:
        return sole(expr['expr'])
    if 'seq' in expr:
        parts = [part for part in expr['seq'] if widths(part) != 1]
        return sole(parts[0]) if len(parts) == 1 else {}
    return {} if any(key in expr for key in ('choice', 'ranked', 'and')) else expr


def ranking_audit(grammar, previous=frozenset()):
    rules = {}
    vocabulary = {'_Elided'} | set(previous)

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
                    vocabulary.add(head['ref'])
            for key in ('seq', 'choice', 'ranked', 'and'):
                pending.extend(node.get(key, ()))
            for key in ('expr', 'optional', 'repeat', 'separator'):
                if key in node:
                    pending.append(node[key])
        return refs, terminals, omitted

    for name, rule in grammar.rules.items():
        own, sets, refs, terminals, omitted, unary = set(), [], set(), set(), set(), []
        unknown = False
        for alternative in rule.alternatives:
            r, t, o = body(alternative.expr)
            refs.update(r)
            terminals.update(t)
            omitted.update(o)
            terms = [t for t in (alternative.tags, alternative.rule_tags) if t is not None]
            for term in terms:
                own.update(literals(term))
            for item in (alternative.emit or {}).get('items', ()):
                vocabulary.update(literals(item.get('tags')))
            child = sole(alternative.expr)
            tags = known_tags({'union': terms}) if terms else frozenset() if child is None else None
            if tags is None:
                unknown = True
            else:
                sets.append(tags)
            if child is not None:
                unary.append((child, terms, alternative))
        vocabulary.update(own)
        rules[name] = dict(own=own, sets=sets, unknown=unknown, refs=refs, terminals=terminals, omitted=omitted, unary=unary)
    for _, consequent in grammar.implications:
        vocabulary.update(consequent)
    for _, classifier in grammar.classifier_items:
        for entry in classifier['entries']:
            vocabulary.add(entry['class'])
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
            return False if pattern.get('any') else dead(pattern['expr'])
        if 'name' in pattern:
            return pattern['name'] not in reachable
        if 'terminal' in pattern:
            return pattern['terminal'] not in terminals | omitted
        return False

    reports, changes, inherited, dropped, warnings = [], [], [], [], []
    for index, (_, pattern) in enumerate(grammar.steps):
        named, tested, positive, pending = set(), set(), set(), [pattern]
        while pending:
            node = pending.pop()
            if 'name' in node:
                named.add(node['name'])
            for requirement in node.get('requirements', ()):
                tested.update(requirement['value']['set'])
                if not requirement['negated']:
                    positive.update(requirement['value']['set'])
            pending.extend(pattern_parts(node))
        answers = []
        counted = set()
        for name, rule in rules.items():
            if name in named or rule['own'] & tested:
                counted.add(name)
            carried = sorted(tag for tag in tested - rule['own'] - {'_Elided'} if rule['unknown'] or any(tag in s for s in rule['sets']))
            if carried:
                inherited.append(dict(rule=name, step=index, tags=carried, unknown=rule['unknown']))
            for child, terms, alternative in rule['unary']:
                if not any(literals(t) & tested for t in terms):
                    continue
                source = rules.get(child.get('ref'))
                explicit = known_tags({'union': terms})
                lost = set().union(*source['sets']) - (explicit or frozenset()) if source and explicit is not None else set()
                dropped.append(dict(rule=name, step=index, tags=sorted(lost), unknown=source is None or source['unknown'] or explicit is None, document=alternative.document, line=alternative.at[0], column=alternative.at[1]))
            if name in reachable:
                answers.extend(possible_node_match(pattern, name=name, tags=tags) for tags in rule['sets'])
                if rule['unknown']:
                    answers.append(possible_node_match(pattern, name=name))
        answers.extend(possible_node_match(pattern, terminal=t) for t in terminals)
        answers.extend(possible_node_match(pattern, terminal=t, tags=frozenset((t, '_Elided')), value='') for t in omitted)
        status = 'impossible' if dead(pattern) else 'unknown' if None in answers else 'possible' if True in answers else 'impossible'
        reports.append(dict(step=index, pattern=canonical_argument({'pattern':pattern},grammar.unicode), status=status))
        changes.extend(dict(asdict(change), kind={'extend':'extended','replace':'replaced'}[change.kind], step=index) for change in grammar.changes if change.rule in counted)
        warnings.extend(dict(kind='ranking-tag-vocabulary', stage=grammar.stage, step=index, tag=tag) for tag in sorted(positive - vocabulary) if not (tag.startswith('_') and grammar.unicode.canonical_tag(tag) == tag))
    return dict(keySteps=reports, countedChanges=changes, inheritedRankingTags=inherited, droppedRankingTags=dropped, vocabularyWarnings=warnings), frozenset(vocabulary)


def format_ranking_reports(reports):
    lines = []
    for report in reports:
        lines.append(report['name'] + ':')
        for step in report['keySteps']:
            lines.append(f"  ranking step {step['step'] + 1}: {step['status']}")
        for change in report['countedChanges']:
            lines.append(f"  counted rule {change['rule']}: {change['kind']}, step {change['step'] + 1}")
        for key, label in (('inheritedRankingTags', 'ranking tags without a literal'), ('droppedRankingTags', 'dropped inherited tags')):
            for note in report[key]:
                lines.append(f"  {label}: {note['rule']}, step {note['step'] + 1}, {', '.join(note['tags']) or 'none'}" + (' (unknown)' if note['unknown'] else ''))
        for warning in report['vocabularyWarnings']:
            lines.append(f"  warning: ranking step {warning['step'] + 1} tests {warning['tag']}, outside the stage vocabulary")
    return '\n'.join(lines)
