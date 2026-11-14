"""Finite records for conditions on complete derivations (engine §4.2)."""
from dataclasses import dataclass

METHODS = frozenset(('followed-by', 'preceded-by'))


def atoms(value):
    found, pending = [], [value]
    while pending:
        part = pending.pop()
        if isinstance(part, dict):
            if part.get('method') in METHODS:
                found.append(part)
            else:
                pending.extend(reversed(list(part.values())))
        elif isinstance(part, list):
            pending.extend(reversed(part))
    return found


def problem(rule):
    allowed = set()
    for condition in rule['conditions']:
        found = atoms(condition)
        if len(found) > 1:
            return 'a condition item accepts only one boundary atom', found[1]
        if not found:
            continue
        atom = found[0]
        allowed.add(id(atom))
        name = atom['receiver'].get('capture')
        if name:
            from ._clauses import captures_in
            if captures_in(condition) - {name}:
                return 'a boundary condition with a captured receiver reads only that capture', atom
    from ._guarded_tags import guards, problem as tag_problem
    for term in [rule.get("tags"), *(a.get("tags") for a in rule["alternatives"])]:
        fault = tag_problem(term)
        if fault:
            return fault
        for guard in guards(term):
            allowed.update(id(atom) for atom in atoms(guard["if"]))
    for atom in atoms(rule.get('emit')):
        allowed.add(id(atom))
    for atom in atoms(rule):
        if id(atom) not in allowed:
            return 'a boundary atom stands only in conditions or emission tags', atom
    return None


@dataclass(frozen=True, slots=True)
class Literal:
    bit: int
    direction: str
    target: int
    positive: bool


@dataclass(frozen=True, slots=True)
class Record:
    id: int
    empty: bool
    start: int
    first: int
    end: int
    last: int


class Records:
    def __init__(self, productions):
        self.names, self.keys, self.records = {}, {}, {}
        self.forward = self.backward = 0
        self.literals = []
        self.empty = self.intern(True, 0, 0, 0, 0)
        seen = set()

        def add_condition(condition):
            seen.add(id(condition))
            for atom in atoms(condition):
                mask = self.targets(atom)
                if atom['method'] == 'followed-by':
                    self.forward |= mask
                else:
                    self.backward |= mask

        for p in productions:
            for condition in p.conds_predict:
                if id(condition) not in seen:
                    add_condition(condition)
            for cs in p.conds_at.values():
                for condition in cs:
                    if id(condition) not in seen:
                        add_condition(condition)
            if p.items is not None:
                for condition in p.items.conditions:
                    if id(condition) not in seen:
                        add_condition(condition)
            if p.slot is not None:
                for condition in p.slot.ranked_conditions:
                    if id(condition) not in seen:
                        add_condition(condition)

    def targets(self, atom):
        mask = 0
        for arg in atom['args']:
            name = arg.get('rule', arg.get('terminal'))
            if name not in self.names:
                self.names[name] = 1 << len(self.names)
            mask |= self.names[name]
        return mask

    def literal(self, atom, positive):
        key = ('f' if atom['method'] == 'followed-by' else 'p', self.targets(atom), positive)
        if key not in self.keys:
            literal = Literal(1 << len(self.literals), *key)
            self.keys[key] = literal
            self.literals.append(literal)
        return self.keys[key]

    def intern(self, empty, start, first, end, last):
        key = empty, start, first, end, last
        if key not in self.records:
            self.records[key] = Record(len(self.records), *key)
        return self.records[key]

    def meet(self, literals, offers, direction, final, fail):
        remaining, failed = literals, False
        pending = literals
        while pending:
            bit = pending & -pending
            pending &= pending - 1
            literal = self.literals[bit.bit_length() - 1]
            if literal.direction != direction:
                continue
            hit = bool(literal.target & offers)
            if not hit and not final:
                continue
            if hit != literal.positive:
                fail(literal)
                failed = True
            remaining &= ~literal.bit
        return None if failed else remaining

    def append(self, record, bits):
        return self.intern(record.empty, record.start, record.first, record.end | bits, record.last)

    def leaf(self, name, empty):
        bit = self.names.get(name, 0)
        return self.empty if empty else self.intern(False, 0, bit & self.forward, 0, bit & self.backward)

    def advance(self, prefix, child, fail):
        if child.empty:
            if prefix.empty:
                return self.append(prefix, child.end)
            end = self.meet(child.end, prefix.last, 'p', False, fail)
            return None if end is None else self.append(prefix, end)
        if prefix.empty:
            start = self.meet(prefix.end | child.start, child.first, 'f', False, fail)
            return None if start is None else self.intern(False, start, child.first, child.end, child.last)
        middle = prefix.end | child.start
        forward = self.meet(middle, child.first, 'f', True, fail)
        backward = self.meet(middle, prefix.last, 'p', True, fail)
        return None if forward is None or backward is None else self.intern(False, prefix.start, prefix.first, child.end, child.last)

    def complete(self, record, name, backward, forward, fail):
        if record.empty:
            return self.append(record, backward | forward)
        bit = self.names.get(name, 0)
        first, last = record.first | (bit & self.forward), record.last | (bit & self.backward)
        start = self.meet(record.start, first, 'f', False, fail)
        if start is None:
            return None
        end = self.meet(record.end, last, 'p', False, fail)
        return None if end is None else self.intern(False, start | backward, first, end | forward, last)

    def accepts(self, record, fail=lambda literal: None):
        accepted = True
        pending = record.start | record.end
        while pending:
            bit = pending & -pending
            pending &= pending - 1
            literal = self.literals[bit.bit_length() - 1]
            if literal.positive:
                fail(literal)
                accepted = False
        return accepted

    def open(self, prefix, child):
        if child.empty:
            end = child.end if prefix.empty else self.meet(child.end, prefix.last, 'p', False, lambda literal: None)
            return None if end is None else self.intern(True, 0, 0, end, 0)
        return child if prefix.empty else self.intern(False, 0, 0, child.end, child.last)


def dominates(higher, lower):
    if higher is None or lower is None:
        return higher is lower
    return (higher.empty == lower.empty and higher.first == lower.first and higher.last == lower.last
            and not higher.start & ~lower.start and not higher.end & ~lower.end)


class Source:
    def __init__(self):
        self.sites, self.users = set(), set()

    def add(self, site):
        pending = [self]
        while pending:
            source = pending.pop()
            if site not in source.sites:
                source.sites.add(site)
                pending.extend(source.users)

    def inherit(self, source):
        if source is None or source is self or self in source.users:
            return
        source.users.add(self)
        for site in source.sites:
            self.add(site)


def select(mask, *inputs):
    out = {}
    for values in inputs:
        for bit, source in values.items():
            if mask & bit:
                out.setdefault(bit, Source()).inherit(source)
    return out


class Annotations:
    def __init__(self, start=None, end=None):
        self.start = {} if start is None else start
        self.end = {} if end is None else end

    def retain(self, record):
        return Annotations(select(record.start, self.start), select(record.end, self.end))

    def add(self, edge, bit, site):
        if site is not None:
            getattr(self, edge).setdefault(bit, Source()).add(site)

    def merge(self, other):
        for edge in ('start', 'end'):
            for bit, source in getattr(other, edge).items():
                getattr(self, edge).setdefault(bit, Source()).inherit(source)

    def meeting(self, child, empty, bit):
        source = Source()
        if empty:
            source.inherit(child.end.get(bit))
        else:
            source.inherit(self.end.get(bit))
            source.inherit(child.start.get(bit))
        return source

    def advance(self, machine, prefix, child, result, sources):
        if child.empty:
            pending = child.end if prefix.empty else machine.meet(child.end, prefix.last, 'p', False, lambda literal: None) or 0
            return Annotations(select(result.start, self.start), select(result.end, self.end, select(pending, sources.end)))
        return (Annotations(select(result.start, self.end, sources.start), select(result.end, sources.end)) if prefix.empty
                else Annotations(select(result.start, self.start), select(result.end, sources.end)))


class Located(dict):
    """Reader positions stay outside the serializable DOM."""
    def __init__(self, value, at):
        super().__init__(value)
        self.at = at


def condition_items(rule):
    from ._guarded_tags import guards
    definitions = {}
    for alternative in rule.alternatives:
        definitions.setdefault(id(alternative.conditions), []).append(alternative)
    for alternatives in definitions.values():
        first = alternatives[0]
        items = list(first.conditions)
        seen = {id(atom) for atom in atoms(items)}
        for alternative in alternatives:
            for term in (first.rule_tags, alternative.tags):
                for guard in guards(term):
                    for atom in atoms(guard['if']):
                        if id(atom) not in seen:
                            seen.add(id(atom))
                            items.append(atom)
        yield first, items


def validate_targets(rules, stage):
    from ._errors import GencmuError
    found = []
    for rule in rules.values():
        for alternative, items in condition_items(rule):
            found.extend((alternative, atom) for atom in atoms([items, alternative.emit]))
    if not found:
        return
    queries, visited = [], set()
    for rule in rules.values():
        for alternative in rule.alternatives:
            pending = [alternative.conditions, alternative.tags, alternative.rule_tags, alternative.emit]
            while pending:
                part = pending.pop()
                if not isinstance(part, (list, dict)) or id(part) in visited:
                    continue
                visited.add(id(part))
                if isinstance(part, list):
                    pending.extend(part)
                else:
                    if part.get('method') == 'parse':
                        # The references and terminals of a parse body
                        # are query roots, as a shorthand target was
                        # (engine §9.3).
                        from ._query_forms import query_references
                        queries.extend(query_references(part['args'][0]['body']))
                    pending.extend(part.values())
    reached, terminals, pending = set(), set(), ['text', *queries]
    while pending:
        name = pending.pop()
        if name[:1].isupper():
            terminals.add(name)
            continue
        if name in reached:
            continue
        reached.add(name)
        for alternative in rules[name].alternatives if name in rules else ():
            stack = [alternative.expr]
            while stack:
                part = stack.pop()
                if isinstance(part, list): stack.extend(part)
                elif isinstance(part, dict):
                    ref = part.get('ref')
                    if ref:
                        if ref[:1].isupper() or ref.startswith('_'): terminals.add(ref)
                        else: pending.append(ref)
                    stack.extend(part.values())
    for alternative, atom in found:
        for target in atom['args']:
            name = target.get('rule', target.get('terminal'))
            if name not in (reached if 'rule' in target else terminals):
                at = getattr(target, 'at', (None, None))
                error = GencmuError(f'boundary target {name} is unreachable', document=alternative.document, line=at[0], column=at[1], stage=stage)
                error._boundary_document = alternative.document
                raise error
