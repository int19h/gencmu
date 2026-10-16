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
        name = atom['receiver']['capture']
        if name:
            from ._clauses import captures_in
            if captures_in(condition) - {name}:
                return 'a boundary condition with a captured receiver reads only that capture', atom
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
        for p in productions:
            for condition in [*p.conds_predict, *(c for cs in p.conds_at.values() for c in cs), *(p.source.conditions if p.source is not None else [])]:
                for atom in atoms(condition):
                    mask = self.targets(atom)
                    if atom['method'] == 'followed-by':
                        self.forward |= mask
                    else:
                        self.backward |= mask

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
        for literal in self.literals:
            if not literals & literal.bit or literal.direction != direction:
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
        for literal in self.literals:
            if (record.start | record.end) & literal.bit and literal.positive:
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
