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
    steps: tuple = ()
    bindings: dict = field(default_factory=dict)


def join(left, right):
    return Route(left.length + right.length,
                 left.captures | {name: (node, at + left.length) for name, (node, at) in right.captures.items()},
                 left.ends | {group: (start + left.length, at + left.length, option) for group, (start, at, option) in right.ends.items()},
                 left.steps + right.steps, left.bindings | right.bindings)


def product(left, right):
    return [join(a, b) for a in left for b in right]


class RankedGroups:
    def __init__(self, stage, rules):
        self.stage, self.rules = stage, rules
        self.groups, self.expressions, self.owners, self.paths = [], {}, {}, {}
        self.source_sites = {}
        for rule in rules.values():
            for alternative, source in enumerate(rule.alternatives):
                self.source_sites[id(source)] = {"document":source.document,"at":list(source.at),"rule":rule.name,"alternative":alternative,"path":""}
                self.visit(source.expr, '', True, None, rule.name, alternative, source)

    def validate_clauses(self, group, prefix_can_read=lambda steps: False):
        source = group.source
        clauses = [source.conditions, source.tags, source.rule_tags, source.value, source.image, source.rule_value, source.rule_image, source.emit]
        if not reads(clauses) & reads(group.expr):
            return
        for route in self.routes(group.source.expr):
            if group not in route.ends:
                continue
            start, end, option = route.ends[group]
            present = {''} | route.captures.keys()
            def private(names):
                return any(name in route.captures and self.owners.get(route.captures[name][0]) is group for name in names)
            for index, condition in enumerate(group.source.conditions):
                effective = simplify_condition(condition, present)
                if effective is True or not any(route.bindings.get(name) is group for name in reads(condition)):
                    continue
                variables = reads(effective)
                if not variables <= present:
                    continue
                if any(not group.final if name == '' else route.captures[name][1] > end for name in variables):
                    self.fail(group, 'ranked-choice-continuation', 'A private capture requires a condition ready when its ranked choice closes.', option=option, expression=condition)
                from ._boundary import atoms
                atom = next((atom for atom in atoms(effective) if atom['method'] == 'preceded-by' and atom['receiver']['capture'] == ''), None)
                if atom is not None and prefix_can_read(route.steps[:start]):
                    targets = ' | '.join(arg.get('rule', arg.get('terminal')) for arg in atom['args'])
                    self.fail(group, 'ranked-choice-boundary',
                              f'Condition {index + 1} of {group.rule} combines $.preceded-by({targets}) with a private capture in option {option + 1}. That option can start after the rule starts. Move the condition into a rule that starts with the ranked group, or test the private capture itself.',
                              option=option, expression=condition)
            for term in (group.source.tags, group.source.rule_tags):
                if term is not None and private(reads(term)):
                    self.fail(group, 'ranked-choice-export', 'A tag term cannot read a private ranked capture.', option=option, expression=term)
            for recipe in (group.source.value, group.source.image, group.source.rule_value, group.source.rule_image):
                if recipe is not None and private(reads(recipe)):
                    self.fail(group, 'ranked-choice-export', 'A recipe cannot read a private ranked capture.', option=option, expression=recipe)
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
                    group = self.expressions[id(expr)]
                    names = reads(group.expr)
                    for nested in route.ends:
                        names -= reads(nested.expr)
                    route.bindings.update((name, group) for name in names)
                    route.ends[group] = (0, route.length, option)
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
            return out + product(out, (yield self._routes(expr['separator']))) if 'separator' in expr else out
        return [Route(1, {expr['capture']: (id(expr), 1)} if 'capture' in expr else {}, steps=(expr,))]

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

    def tag_failure(self, graph, group, helper, unsafe):
        queue, seen = [(helper, [self.site(group.source, group.path, True)], None)], {helper}
        for node, steps, option in queue:
            for route in graph.nodes[node].routes:
                selected = option if option is not None else route.option
                inheritance = steps if node == helper else [*steps, self.site(route.source, self.paths.get(id(route.expr), ''))]
                if route.unsafe or not route.tagged and None in route.children:
                    self.fail(group, 'ranked-choice-tags', 'A ranked choice must discard its returned tags or return provably empty tags.', option=selected, expression=group.expr, inheritance=inheritance)
                if not route.tagged:
                    for child in route.children:
                        if child in unsafe and child not in seen:
                            seen.add(child)
                            queue.append((child, inheritance, selected))
        self.fail(group, 'ranked-choice-tags', 'A ranked choice must discard its returned tags or return provably empty tags.', expression=group.expr)

    def validate_tags(self):
        graph = TagGraph(self)
        spans = None
        def prefix_can_read(steps):
            nonlocal spans
            if spans is None:
                spans = written_spans(self.rules)
            nonempty = False
            for step in steps:
                while "expr" in step:
                    step = step["expr"]
                name = step.get("ref")
                if name in self.rules:
                    if not spans[0].get(name):
                        return False
                    nonempty |= spans[1].get(name, False)
                else:
                    nonempty = True
            return nonempty
        unsafe, users = set(), {}
        for index, node in enumerate(graph.nodes):
            for route in node.routes:
                if route.tagged:
                    if route.unsafe:
                        unsafe.add(index)
                else:
                    for child in route.children:
                        if child is None:
                            unsafe.add(index)
                        else:
                            users.setdefault(child, []).append(index)
        pending = list(unsafe)
        for child in pending:
            for parent in users.get(child, ()):
                if parent not in unsafe:
                    unsafe.add(parent)
                    pending.append(parent)
        for group in self.groups:
            self.validate_clauses(group, prefix_can_read)
            helper = graph.groups[group]
            if helper not in unsafe:
                continue
            outward, seen = [helper], {helper}
            for child in outward:
                for parent in users.get(child, ()):
                    node = graph.nodes[parent]
                    if not node.helper and node.owner == group.rule:
                        self.tag_failure(graph, group, helper, unsafe)
                    if node.helper and node.owner == group.rule and parent not in seen:
                        seen.add(parent)
                        outward.append(parent)


@dataclass
class TagRoute:
    source: object
    expr: dict
    children: list
    option: int | None = None
    tagged: bool = False
    unsafe: bool = False


@dataclass
class TagNode:
    owner: str
    helper: bool
    routes: list = field(default_factory=list)


class TagGraph:
    """Logical empty routes and unary inheritance, without products."""
    def __init__(self, ranked):
        self.nodes, self.groups = [], {}
        named = {rule.name: self.node(rule.name, False) for rule in ranked.rules.values()}
        captured = {}
        def has_capture(expr):
            key = id(expr)
            if key not in captured:
                captured[key] = 'ranked' not in expr and ('capture' in expr or any(has_capture(child) for child, _ in children(expr)))
            return captured[key]
        for rule in ranked.rules.values():
            for source in rule.alternatives:
                memo = {}
                def describe(expr):
                    key = id(expr)
                    if key in memo:
                        return memo[key]
                    if 'empty' in expr:
                        result = (True, [])
                    elif 'seq' in expr:
                        parts = [describe(child) for child in expr['seq']]
                        blocking = sum(not zero for zero, _ in parts)
                        result = (not blocking, [child for zero, candidates in parts if blocking - (not zero) == 0 for child in candidates])
                    elif 'choice' in expr or 'and' in expr:
                        parts = [describe(child) for child in expr.get('choice', expr.get('and'))]
                        result = (any(zero for zero, _ in parts), [child for _, candidates in parts for child in candidates])
                    elif any(k in expr for k in ('ranked', 'optional', 'repeat')):
                        if 'optional' in expr and not expr.get('elidable') and has_capture(expr['optional']):
                            result = (False, describe(expr['optional'])[1])
                        else:
                            helper = self.node(rule.name, True)
                            result = (False, [helper])
                            memo[key] = result
                            if 'ranked' in expr:
                                self.groups[ranked.expressions[key]] = helper
                                for option, child in enumerate(expr['ranked']):
                                    self.nodes[helper].routes.append(TagRoute(source, expr, describe(child)[1], option))
                            else:
                                self.nodes[helper].routes.append(TagRoute(source, expr, describe(expr.get('optional', expr.get('repeat')))[1]))
                            # A recursive repetition route can only add a self edge.
                            if 'separator' in expr:
                                describe(expr['separator'])
                    elif 'expr' in expr:
                        result = describe(expr['expr'])
                    else:
                        result = (False, [named.get(expr.get('ref'))])
                    memo[key] = result
                    return result
                expr = source.expr
                body = describe(expr['repeat'] if expr.get('chain') else expr)
                if expr.get('chain') and 'separator' in expr:
                    describe(expr['separator'])
                terms = [term for term in (source.tags, source.rule_tags) if term is not None]
                self.nodes[named[rule.name]].routes.append(TagRoute(source, expr, body[1], tagged=bool(terms), unsafe=any(not literal_empty(term) for term in terms)))

    def node(self, owner, helper):
        self.nodes.append(TagNode(owner, helper))
        return len(self.nodes) - 1


def written_spans(rules):
    """Finite structural derivations over written branches and concatenations."""
    named = {name: i + 1 for i, name in enumerate(rules)}
    count, branches, memo = len(named) + 1, [], {}
    def expression(expr):
        nonlocal count
        key = id(expr)
        if key in memo:
            return memo[key]
        if 'expr' in expr:
            node = expression(expr['expr'])
        elif 'ref' in expr:
            node = named.get(expr['ref'], 0)
        elif any(k in expr for k in ('literal', 'range', 'wildcard')):
            node = 0
        else:
            node, count = count, count + 1
            if 'empty' in expr or 'optional' in expr:
                branches.append((node, []))
            if 'seq' in expr:
                branches.append((node, [expression(child) for child in expr['seq']]))
            for child in expr.get('choice', expr.get('ranked', expr.get('and', ()))):
                branches.append((node, [expression(child)]))
            if 'optional' in expr:
                branches.append((node, [expression(expr['optional'])]))
            if 'repeat' in expr:
                item = expression(expr['repeat'])
                branches.append((node, [item]))
                if 'separator' in expr:
                    branches.append((node, [item, expression(expr['separator']), item]))
        memo[key] = node
        return node
    for rule in rules.values():
        for source in rule.alternatives:
            branches.append((named[rule.name], [expression(source.expr)]))
    users = [[] for _ in range(count)]
    remaining = [len(rhs) for _, rhs in branches]
    productive, nonempty = {0}, {0}
    for i, (lhs, rhs) in enumerate(branches):
        if not rhs:
            productive.add(lhs)
        for child in rhs:
            users[child].append(i)
    pending = list(productive)
    for child in pending:
        for i in users[child]:
            remaining[i] -= 1
            lhs = branches[i][0]
            if not remaining[i] and lhs not in productive:
                productive.add(lhs)
                pending.append(lhs)
    for i, (lhs, rhs) in enumerate(branches):
        if not remaining[i] and any(child in nonempty for child in rhs):
            nonempty.add(lhs)
    pending = list(nonempty)
    for child in pending:
        for i in users[child]:
            lhs = branches[i][0]
            if not remaining[i] and lhs not in nonempty:
                nonempty.add(lhs)
                pending.append(lhs)
    return ({name: node in productive for name, node in named.items()}, {name: node in nonempty for name, node in named.items()})


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
    from ._template_nodes import nodes
    return any('ranked' in node for node in nodes(dom))


class LocatedExpression(dict):
    pass


def expression_locations(expr):
    locations, pending = {}, [(expr, '')]
    while pending:
        node, path = pending.pop()
        if hasattr(node, 'ranked_at'):
            locations[path] = node.ranked_at
        pending.extend((child, path + component) for child, component in children(node))
    return locations


def restore_template_locations(dom, tokens, position):
    from ._template_nodes import map_nodes
    result = map_nodes(dom, lambda node: LocatedExpression(node) if isinstance(node, dict) and 'ranked' in node else node)
    separators = [position(token.source[0]) for token in tokens if token.value == '≻']
    roots = []
    for rule in result['rules']:
        roots.extend(rule.get('args', []))
        roots.extend(rule.get(k) for k in ('instance', 'tags', 'value', 'image'))
        for alt in rule.get('alternatives', []):
            roots.extend(alt.get(k) for k in ('expr', 'tags', 'value', 'image'))
        roots.extend(rule.get(k) for k in ('conditions', 'emit'))
    index, locations = 0, []
    pending = [(root, 0) for root in reversed(roots)]
    while pending:
        node, action = pending.pop()
        if action == 1:
            if index < len(separators):
                locations.append((node, separators[index]))
        elif action == 2:
            index += 1
        elif isinstance(node, dict) and 'ranked' in node:
            for option in range(len(node['ranked']) - 1, 0, -1):
                pending.extend(((node['ranked'][option], 0), (None, 2)))
            pending.extend(((node, 1), (node['ranked'][0], 0)))
        elif isinstance(node, (dict, list)):
            values = [v for k, v in node.items() if k != 'at'] if isinstance(node, dict) else node
            pending.extend((child, 0) for child in reversed(values))
    if index == len(separators):
        for node, at in locations:
            node.ranked_at = at
    return result


def restore_locations(dom, tokens, position):
    if not has_ranked(dom):
        return dom
    from ._template_nodes import has_unresolved
    if has_unresolved(dom):
        return restore_template_locations(dom, tokens, position)
    separators = [position(token.source[0]) for token in tokens if token.value == '≻']
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
    if at < len(tokens) and tokens[at].value == '≻' or at > 0 and at-1 < len(tokens) and tokens[at-1].value == '≻':
        return True
    if at >= len(tokens) or tokens[at].value != '|':
        return False
    levels = [False]
    for token in tokens[:at]:
        if token.value in ('(', '[', '{'):
            levels.append(False)
        elif token.value in (')', ']', '}'):
            if levels:
                levels.pop()
        elif token.value == '≻' and levels:
            levels[-1] = True
        elif token.value.startswith('%') and levels:
            levels[-1] = False
    return bool(levels and levels[-1])
