"""Written ranked groups and their local loading rules."""
from __future__ import annotations
from dataclasses import dataclass, field
from ._clauses import simplify_condition, simplify_term
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
        for rule in rules.values():
            for alternative, source in enumerate(rule.alternatives):
                self.visit(source.expr, '', True, None, rule.name, alternative, source)
        for group in self.groups:
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
                        self.fail(group, 'ranked-choice-continuation', 'A private capture requires a condition ready when its ranked choice closes.')
                for term in (group.source.tags, group.source.rule_tags):
                    if term is not None and private(reads(simplify_term(term, present))):
                        self.fail(group, 'ranked-choice-export', 'A tag term cannot read a private ranked capture.')
                if private(reads(group.source.emit)):
                    self.fail(group, 'ranked-choice-export', 'An emission item cannot read a private ranked capture.')

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

    def fail(self, group, code, message):
        raise GencmuError(f'{code}: {message}', document=group.source.document, line=group.source.at[0], column=group.source.at[1], stage=self.stage)

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
            helper = helpers.get(group)
            if helper not in unsafe:
                continue
            outward, seen = [helper], {helper}
            for child in outward:
                for parent in users.get(child, ()):
                    if not parent.helper and parent.rule_name == group.rule:
                        self.fail(group, 'ranked-choice-tags', 'A ranked choice must discard its returned tags or return provably empty tags.')
                    if parent.helper and parent.rule_name == group.rule and parent.lhs not in seen:
                        seen.add(parent.lhs)
                        outward.append(parent.lhs)


def literal_empty(term):
    if term.get('emptySet') is True:
        return True
    from ._grammar import RESOLVED
    return 'const' in term and term.get(RESOLVED) == frozenset()
