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


def prepare_ranked(lowered):
    ranked = lowered.grammar.ranked
    if ranked is None or not ranked.groups:
        return
    sources = {id(g.source) for g in ranked.groups}
    for p in lowered.productions:
        if p.ranked is not None:
            lowered.ranked_helpers[p.lhs] = p.ranked
        if p.helper:
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
        p.private_conditions = [c for c in p.slot.source.conditions if not reads(c).isdisjoint(own) and reads(c).isdisjoint(nested)]


def written_prefix(lowered, p, dot, origin, prefix, caps, restores=False):
    symbols = tuple((terminal, lowered.written_helpers.get(symbol,symbol),p.tests[i] if p.tests else None) for i,(terminal,symbol) in enumerate(zip(p.terminal,p.rhs)))
    captures = tuple((name,caps[p.slots[position]]) for name,position in sorted(p.captures.items(),key=lambda part:part[1]) if not name.startswith('\u0000') and position<dot)
    source = (p.rule_name,p.slot.source.document,p.slot.source.at,lowered.written_helpers.get(p.lhs))
    return (p.lexical.key if p.lexical else None,source,symbols,dot,origin,prefix,captures,restores)


class Frames:
    def __init__(self,lowered,machine):
        self.lowered,self.machine = lowered,machine
        self.frames,self.productions = {},{}

    def entry(self,p,dot,origin,prefix,caps,rule,restores=False):
        own = self.lowered.rule_productions[rule]
        if not own or not self.lowered.productions[own[0]].contextual:
            return None
        outer = p.lexical
        if outer is not None and p.lhs==rule:
            return outer
        key = written_prefix(self.lowered,p,dot,origin,prefix,caps,restores)
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
        frame = Frame(len(self.frames)+1,key,captures,present,root,named_origin,prefix,seal_prefix,inside)
        self.frames[key] = frame
        return frame

    def production(self,p,frame):
        if frame is None:
            return p
        key = (p.id,frame.id)
        if key in self.productions:
            return self.productions[key]
        q = replace(p,id=len(self.lowered.productions),base_id=p.id,lexical=frame,conds_predict=[],conds_at={},whole_ready=False)
        present = {''} | frame.present | p.captures.keys()
        for raw in p.private_conditions:
            condition = simplify_condition(raw,present)
            if condition is True:
                continue
            if condition is False:
                condition = {'any':[]}
            names = captures_in(condition)
            if not names<=present:
                continue
            if '' in names:
                at = len(p.rhs)-1
                q.whole_ready = True
            else:
                at = max((p.captures[n] for n in names if n in p.captures),default=-1)
            if at<0:
                q.conds_predict.append(condition)
            else:
                q.conds_at.setdefault(at,[]).append(condition)
        source = p.slot.source
        private = set().union(*(reads(g.expr) for g in self.lowered.grammar.ranked.groups if g.source is source))
        public = {''} | (frame.present-private)
        tags = [simplify_term(t,public) for t in (source.tags,source.rule_tags) if t is not None]
        q.parent_tags = tags[0] if len(tags)==1 else {'union':tags} if tags else {'emptySet':True}
        self.lowered.productions.append(q)
        self.productions[key] = q
        return q
