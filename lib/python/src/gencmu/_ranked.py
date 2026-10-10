"""Written ranked groups and their local loading rules."""
from __future__ import annotations
from dataclasses import dataclass, field
from ._clauses import simplify_condition
from ._errors import GencmuError
from ._trampoline import run


def children(expr):
    out = [(child, f'/{key}/{i}') for key in ('seq', 'choice', 'ranked', 'and') for i, child in enumerate(expr.get(key, ()))]
    out.extend((expr[key], f'/{key}') for key in ('expr', 'optional', 'repeat', 'separator') if key in expr)
    return out


def reads(value):
    found, pending = set(), [value]
    while pending:
        node = pending.pop()
        if isinstance(node, dict):
            for key in ('capture', 'captured', 'take'):
                if isinstance(node.get(key), str):
                    found.add(node[key])
            for key in ('before', 'after'):
                found.update(name for name in node.get(key, ()) if isinstance(name, str))
            pending.extend(node.values())
        elif isinstance(node, list):
            pending.extend(node)
    return found


@dataclass(eq=False)
class Group:
    id: int
    rule: str
    alternative: int
    path: str
    expr: dict
    source: object
    final: bool


@dataclass
class Route:
    length: int = 0
    captures: dict = field(default_factory=dict)
    ends: dict = field(default_factory=dict)


def join(left, right):
    return Route(left.length + right.length,
                 left.captures | {name: (node, at + left.length) for name, (node, at) in right.captures.items()},
                 left.ends | {group: (at + left.length, option) for group, (at, option) in right.ends.items()})


def product(left, right):
    return [join(a, b) for a in left for b in right]


class RankedGroups:
    def __init__(self, stage, rules):
        self.stage, self.rules = stage, rules
        self.groups, self.expressions, self.owners, self.paths = [], {}, {}, {}
        self.source_sites, self.clause_errors = {}, {}
        for rule in rules.values():
            for alternative, source in enumerate(rule.alternatives):
                self.source_sites[id(source)] = {"document":source.document,"at":list(source.at),"rule":rule.name,"alternative":alternative,"path":""}
                self.visit(source.expr, '', True, None, rule.name, alternative, source)
        for group in self.groups:
            try:
                self.validate_clauses(group)
            except GencmuError as error:
                self.clause_errors[group] = error

    def validate_clauses(self, group):
        for route in self.routes(group.source.expr):
            if group not in route.ends:
                continue
            end, option = route.ends[group]
            present = {''} | route.captures.keys()
            def private(names):
                return any(name in route.captures and self.owners.get(route.captures[name][0]) is group for name in names)
            for condition in group.source.conditions:
                if not private(reads(condition)):
                    continue
                effective = simplify_condition(condition, present)
                if isinstance(effective, bool):
                    continue
                variables = reads(effective)
                if not variables <= present:
                    continue
                if any(not group.final if name == '' else route.captures[name][1] > end for name in variables):
                    self.fail(group, 'ranked-choice-continuation', 'A private capture requires a condition ready when its ranked choice closes.', option=option, expression=condition)
            for term in (group.source.tags, group.source.rule_tags):
                if term is not None and private(reads(term)):
                    self.fail(group, 'ranked-choice-export', 'A tag term cannot read a private ranked capture.', option=option, expression=term)
            if private(reads(group.source.emit)):
                self.fail(group, 'ranked-choice-export', 'An emission item cannot read a private ranked capture.', option=option, expression=group.source.emit)

    def visit(self, expr, path, final, owner, rule, alternative, source):
        pending = [(expr, path, final, owner)]
        while pending:
            expr, path, final, owner = pending.pop()
            self.paths[id(expr)] = path
            if 'ranked' in expr:
                group = Group(len(self.groups), rule, alternative, path, expr, source, final)
                self.groups.append(group)
                self.expressions[id(expr)] = group
                pending.extend((child, f'{path}/ranked/{index}', final, group) for index, child in reversed(list(enumerate(expr['ranked']))))
                continue
            if 'capture' in expr and owner is not None:
                self.owners[id(expr)] = owner
            for child, component in reversed(children(expr)):
                last = not ('seq' in expr or 'and' in expr) or component.endswith(f"/{len(expr.get('seq',expr.get('and',()))) - 1}")
                pending.append((child, path + component, final and last and 'repeat' not in expr, owner))

    def routes(self, expr):
        return run(self._routes(expr))

    def _routes(self, expr):
        if 'empty' in expr:
            return [Route()]
        if 'seq' in expr:
            out = [Route()]
            for child in expr['seq']:
                out = product(out, (yield self._routes(child)))
            return out
        if 'choice' in expr:
            out = []
            for child in expr['choice']:
                out.extend((yield self._routes(child)))
            return out
        if 'ranked' in expr:
            out = []
            for option, child in enumerate(expr['ranked']):
                for route in (yield self._routes(child)):
                    route.ends[self.expressions[id(expr)]] = (route.length, option)
                    out.append(route)
            return out
        if 'and' in expr:
            out, expanded = [], []
            for child in expr['and']:
                expanded.append((yield self._routes(child)))
            for mask in range(1, 1 << len(expanded)):
                route = [Route()]
                for index, alternatives in enumerate(expanded):
                    if mask & (1 << index):
                        route = product(route, alternatives)
                out.extend(route)
            return out
        if 'optional' in expr:
            return [Route(), *(yield self._routes(expr['optional']))]
        if 'repeat' in expr:
            out = yield self._routes(expr['repeat'])
            return product(out, (yield self._routes(expr['separator']))) if 'separator' in expr else out
        return [Route(1, {expr['capture']: (id(expr), 1)} if 'capture' in expr else {})]

    def site(self, source, path='', group=False):
        site = dict(self.source_sites[id(source)])
        site['path'] = path
        if group:
            site.pop('at', None)
            if path in source.ranked_locations:
                site['at'] = list(source.ranked_locations[path])
        return {key: site[key] for key in ('document', 'at', 'rule', 'alternative', 'path') if key in site}

    def fail(self, group, code, message, **fields):
        site = self.site(group.source, group.path, True)
        at = site.get('at', (None, None))
        if 'expression' in fields:
            fields['expression'] = written(fields['expression'])
        raise GencmuError(f'{code}: {message}', document=group.source.document, line=at[0], column=at[1], code=code, group=site, **fields)

    def tag_failure(self, lowered, group, helper, unsafe):
        productions = {}
        for production in lowered.productions:
            productions.setdefault(production.lhs, []).append(production)
        queue, seen = [(helper, [self.site(group.source, group.path, True)], None)], {helper}
        for rule, steps, option in queue:
            for production in productions.get(rule, ()):
                selected_option = option if option is not None else production.option if production.ranked is not None else None
                inheritance = list(steps)
                if rule != helper:
                    inheritance.append(self.site(production.slot.source, self.paths.get(production.slot.path, '')))
                source = production.slot.source
                terms = production.slot.tags if production.helper else [term for term in (source.tags, source.rule_tags) if term is not None]
                if any(not literal_empty(term) for term in terms) or not terms and len(production.rhs) == 1 and production.terminal[0]:
                    self.fail(group, 'ranked-choice-tags', 'A ranked choice must discard its returned tags or return provably empty tags.', option=selected_option, expression=group.expr, inheritance=inheritance)
                if not terms and len(production.rhs) == 1 and not production.terminal[0]:
                    child = production.rhs[0]
                    if child in unsafe and child not in seen:
                        seen.add(child)
                        queue.append((child, inheritance, selected_option))
        self.fail(group, 'ranked-choice-tags', 'A ranked choice must discard its returned tags or return provably empty tags.', expression=group.expr)

    def validate_tags(self, lowered):
        unsafe, users, helpers = set(), {}, {}
        for production in lowered.productions:
            slot = production.slot
            if slot.path in self.expressions:
                helpers[self.expressions[slot.path]] = production.lhs
            terms = slot.tags if production.helper else [term for term in (slot.source.tags, slot.source.rule_tags) if term is not None]
            if terms:
                if any(not literal_empty(term) for term in terms):
                    unsafe.add(production.lhs)
            elif len(production.rhs) == 1:
                if production.terminal[0]:
                    unsafe.add(production.lhs)
                else:
                    users.setdefault(production.rhs[0], []).append(production)
        pending = list(unsafe)
        for rule in pending:
            for parent in users.get(rule, ()):
                if parent.lhs not in unsafe:
                    unsafe.add(parent.lhs)
                    pending.append(parent.lhs)
        for group in self.groups:
            if group in self.clause_errors:
                raise self.clause_errors[group]
            helper = helpers.get(group)
            if helper not in unsafe:
                continue
            outward, seen = [helper], {helper}
            for child in outward:
                for parent in users.get(child, ()):
                    if not parent.helper and parent.rule_name == group.rule:
                        self.tag_failure(lowered, group, helper, unsafe)
                    if parent.helper and parent.rule_name == group.rule and parent.lhs not in seen:
                        seen.add(parent.lhs)
                        outward.append(parent.lhs)


def literal_empty(term):
    if term.get('emptySet') is True:
        return True
    from ._grammar import RESOLVED
    return 'const' in term and term.get(RESOLVED) == frozenset()


def written(value):
    if isinstance(value, dict):
        return {key: written(child) for key, child in value.items() if key != 'resolved' and not (key == 'value' and 'const' in value)}
    if isinstance(value, (tuple, list)):
        return [written(child) for child in value]
    return value


class LocatedRule(dict):
    def __init__(self, rule):
        super().__init__(rule)
        self.ranked_locations = {}


def has_ranked(dom):
    pending = [alt['expr'] for rule in dom['rules'] for alt in rule['alternatives']]
    while pending:
        expr = pending.pop()
        if 'ranked' in expr:
            return True
        pending.extend(child for child, _ in children(expr))
    return False


def restore_locations(dom, tokens, position):
    if not has_ranked(dom):
        return dom
    separators = [position(token.source[0]) for token in tokens if token.text == '≻']
    index = 0
    from ._dom import DeferredDom
    copy = DeferredDom(dom, getattr(dom, 'deferred_emissions', ()))
    copy['rules'] = [LocatedRule(rule) for rule in dom['rules']]
    for rule in copy['rules']:
        for alternative, alt in enumerate(rule['alternatives']):
            locations = {}
            pending = [(alt['expr'], '', 0)]
            while pending:
                expr, path, action = pending.pop()
                if action == 1:
                    if index < len(separators):
                        locations[path] = separators[index]
                elif action == 2:
                    index += 1
                elif 'ranked' in expr:
                    for option in range(len(expr['ranked']) - 1, 0, -1):
                        pending.extend(((expr['ranked'][option], path + f'/ranked/{option}', 0), (None, '', 2)))
                    pending.extend(((None, path, 1), (expr['ranked'][0], path + '/ranked/0', 0)))
                else:
                    pending.extend((child, path + component, 0) for child, component in reversed(children(expr)))
            rule.ranked_locations[alternative] = locations
    if index != len(separators):
        for rule in copy['rules']:
            rule.ranked_locations.clear()
    return copy


def syntax_failure(tokens, at):
    if at < len(tokens) and tokens[at].text == '≻' or at > 0 and at-1 < len(tokens) and tokens[at-1].text == '≻':
        return True
    if at >= len(tokens) or tokens[at].text != '|':
        return False
    levels = [False]
    for token in tokens[:at]:
        if token.text in ('(', '[', '{'):
            levels.append(False)
        elif token.text in (')', ']', '}'):
            if levels:
                levels.pop()
        elif token.text == '≻' and levels:
            levels[-1] = True
        elif token.text.startswith('%') and levels:
            levels[-1] = False
    return bool(levels and levels[-1])
