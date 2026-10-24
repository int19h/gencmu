"""Written prefix values and ready conditions across generated helpers."""
from dataclasses import dataclass, replace
from ._ranked import reads
from ._clauses import simplify_condition, simplify_term, captures_in


@dataclass(eq=False)
class Frame:
    id: int
    key: tuple
    captures: dict
    present: set
    root: object
    origin: int
    prefix: int
    seal_prefix: int
    inside: bool
    known_private: set
    close_prefix: int = 0
    seal_close_prefix: int = 0
    seal_group: object = None
    seal_start: int = 0
    close_entry: tuple = ()
    seal_entry: tuple = ()


def prepare_ranked(lowered):
    ranked = lowered.grammar.ranked
    if ranked is None or not ranked.groups:
        return
    sources = {id(g.source) for g in ranked.groups}
    for p in lowered.productions:
        if p.ranked is not None:
            lowered.ranked_helpers[p.lhs] = p.ranked
        if p.helper and p.slot is not None:
            lowered.written_helpers[p.lhs] = (p.rule_name, p.slot.source.document, p.slot.source.at, ranked.paths[p.slot.path])
            p.contextual = id(p.slot.source) in sources
    for p in lowered.productions:
        if p.ranked is None:
            continue
        pending = [s for terminal,s in zip(p.terminal,p.rhs) if not terminal]
        nested,seen = set(),set()
        while pending:
            rule = pending.pop()
            if rule in seen or not lowered.rule_names[rule].startswith('\u0000'):
                continue
            seen.add(rule)
            if rule in lowered.ranked_helpers:
                nested.update(reads(lowered.ranked_helpers[rule].expr))
            for index in lowered.rule_productions[rule]:
                child = lowered.productions[index]
                pending.extend(s for terminal,s in zip(child.terminal,child.rhs) if not terminal)
        own = reads(p.ranked.expr)
        p.private_names = own - nested
    for p in lowered.productions:
        p.ranked_bindings = (tuple(sorted(n for n in p.captures if not n.startswith('\u0000'))),tuple(sorted(p.private_names)))
    prepare_ranked_conditions(lowered)


def frame_conditions(p, frame, private):
    """Reduce conditions for both runtime frames and static target discovery."""
    from ._boundary import atoms
    present = {''} | frame.present | p.captures.keys()
    for raw in p.slot.source.conditions if p.ranked is not None else []:
        boundary = atoms(raw)
        if boundary and boundary[0]["receiver"]["capture"] and boundary[0]["receiver"]["capture"] in frame.captures:
            continue
        if any(n in private and n not in p.private_names and n not in frame.known_private and n not in p.captures and n not in frame.captures for n in reads(raw)):
            continue
        condition = simplify_condition(raw, present)
        if condition is True:
            continue
        if condition is False:
            condition = {'any': []}
        names = captures_in(condition)
        if not names <= present:
            continue
        if any(n and n not in p.captures and n not in frame.captures for n in names):
            continue
        if '' in names:
            if not p.ranked.final:
                continue
            at = len(p.rhs) - 1
        else:
            at = max((p.captures[n] for n in names if n in p.captures), default=-1)
        yield condition, at, '' in names


def prepare_ranked_conditions(lowered):
    """Follow finite capture contexts through active lowered helpers."""
    from types import SimpleNamespace
    private = {}
    for group in lowered.grammar.ranked.groups:
        private.setdefault(id(group.source), set()).update(reads(group.expr))
    pending = []

    def enter(p, frame):
        present = frame.present | p.captures.keys()
        known = frame.known_private | p.private_names
        for index, (terminal, symbol) in enumerate(zip(p.terminal, p.rhs)):
            if terminal or not any(lowered.productions[i].contextual for i in lowered.rule_productions[symbol]):
                continue
            captures = frame.captures | {name: None for name, at in p.captures.items() if at < index}
            pending.append((symbol, SimpleNamespace(present=present, captures=captures, known_private=known)))

    for p in lowered.productions:
        if not p.helper:
            enter(p, SimpleNamespace(present=set(), captures={}, known_private=set()))
    seen, at = set(), 0
    while at < len(pending):
        rule, frame = pending[at]
        at += 1
        key = rule, frozenset(frame.present), frozenset(frame.captures), frozenset(frame.known_private)
        if key in seen:
            continue
        seen.add(key)
        for index in lowered.rule_productions[rule]:
            p = lowered.productions[index]
            p.slot.ranked_conditions.extend(c for c, _, _ in frame_conditions(p, frame, private[id(p.slot.source)]))
            enter(p, frame)


def written_prefix(lowered, p, dot, origin, prefix, caps, restores=False, closes=None, close_prefix=0):
    symbols = tuple((terminal, lowered.written_helpers.get(symbol,symbol),p.tests[i] if p.tests else None) for i,(terminal,symbol) in enumerate(zip(p.terminal,p.rhs)))
    def observation(part):
        return (*part[:4], closes.semantic(part[4])) if closes is not None and len(part) > 4 else part
    captures = tuple((name, observation(caps[p.slots[position]])) for name, position in sorted(p.captures.items(), key=lambda part: part[1]) if not name.startswith('\u0000') and position < dot)
    source = (p.rule_name,p.slot.source.document,p.slot.source.at,lowered.written_helpers.get(p.lhs))
    parent = p.lexical.close_entry if closes is not None and p.lexical else p.lexical.key if p.lexical else None
    key = (parent, source, symbols, dot, origin, prefix, captures, restores, p.ranked_bindings)
    return key + (closes.semantic(close_prefix),) if closes is not None else key


class Frames:
    def __init__(self, lowered, machine, closes=None, project=None):
        self.lowered,self.machine = lowered,machine
        self.closes, self.project = closes, project
        self.frames,self.productions = {},{}

    def entry(self, p, dot, origin, prefix, caps, rule, restores=False, close_prefix=0, at=0, boundary=None):
        own = self.lowered.rule_productions[rule]
        if not own or not self.lowered.productions[own[0]].contextual:
            return None
        outer = p.lexical
        if outer is not None and p.lhs==rule:
            return outer
        key = (written_prefix(self.lowered,p,dot,origin,prefix,caps,restores), boundary.id if boundary is not None else None)
        if self.closes is not None:
            key = key, close_prefix
        if key in self.frames:
            return self.frames[key]
        captures = dict(outer.captures) if outer else {}
        captures.update((name,caps[p.slots[pos]]) for name,pos in p.captures.items() if not name.startswith('\u0000') and pos<dot)
        present = (outer.present if outer else set()) | {n for n in p.captures if not n.startswith('\u0000')}
        root = outer.root if outer else p
        named_origin = outer.origin if outer else origin
        prefix = self.machine.concat(outer.prefix,prefix) if outer else prefix
        inside = bool(p.ranked or outer and outer.inside)
        seal_prefix = outer.seal_prefix if inside and outer else prefix
        frame = Frame(len(self.frames)+1,key,captures,present,root,named_origin,prefix,seal_prefix,inside,(outer.known_private if outer else set()) | p.private_names)
        if self.closes is not None and p.lhs in self.lowered.close_rules:
            frame.close_prefix = self.closes.concat(outer.close_prefix, close_prefix) if outer else close_prefix
            frame.seal_close_prefix = outer.seal_close_prefix if inside and outer else frame.close_prefix
            frame.close_entry = self.common_entry(p, dot, origin, prefix, caps, outer, frame.close_prefix)
            own_group = self.lowered.ranked_helpers.get(rule)
            frame.seal_group = outer.seal_group if inside and outer else own_group
            frame.seal_start = outer.seal_start if inside and outer else at
            frame.seal_entry = outer.seal_entry if inside and outer else frame.close_entry
        self.frames[key] = frame
        return frame

    def common_entry(self, p, dot, origin, prefix, caps, outer, close_prefix):
        """Use written control and public observations, without proof IDs."""
        lowered = self.lowered
        def symbol(value, terminal):
            return value if terminal else lowered.written_helpers.get(value, lowered.rule_names[value])
        route = tuple((terminal, symbol(value, terminal), p.tests[i] if p.tests else None)
                      for i, (terminal, value) in enumerate(zip(p.terminal[:dot], p.rhs[:dot])))
        private = p.private_names | (outer.known_private if outer else set())
        public = dict(outer.captures) if outer else {}
        public.update((name, caps[p.slots[position]]) for name, position in p.captures.items()
                      if not name.startswith('\u0000') and position < dot)
        observations = []
        for name, part in sorted(public.items()):
            if name in private:
                continue
            start, end, tags = part[:3]
            observations.append((name, self.project(start), self.project(end), tags,
                                 part[3] if len(part) > 3 else 0,
                                 self.closes.semantic(part[4]) if len(part) > 4 else 0))
        source = p.rule_name, p.slot.source.document, p.slot.source.at, lowered.written_helpers.get(p.lhs)
        return (outer.close_entry if outer else None, source, route, self.project(origin), prefix,
                tuple(observations), self.closes.semantic(close_prefix))

    def production(self,p,frame):
        if frame is None:
            return p
        key = (p.id,frame.id)
        if key in self.productions:
            return self.productions[key]
        q = replace(p,id=len(self.lowered.productions),base_id=p.id,lexical=frame,conds_predict=[],conds_at={},whole_ready=False)
        source = p.slot.source
        private = set().union(*(reads(g.expr) for g in self.lowered.grammar.ranked.groups if g.source is source))
        for condition, at, whole in frame_conditions(p, frame, private):
            q.whole_ready |= whole
            if at<0:
                q.conds_predict.append(condition)
            else:
                q.conds_at.setdefault(at,[]).append(condition)
        public = {''} | (frame.present-private)
        tags = [simplify_term(t,public) for t in (source.tags,source.rule_tags) if t is not None]
        q.parent_tags = tags[0] if len(tags)==1 else {'union':tags} if tags else {'emptySet':True}
        self.lowered.productions.append(q)
        self.productions[key] = q
        return q
