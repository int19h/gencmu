"""Slot admission over finite, eligible proofs of raw packed edges."""
from __future__ import annotations
from ._rank import Summaries
from ._earley import RESTORE
from ._preferences import symbol_role
from . import _testing


class SlotAdmission(Summaries):
    def __init__(self, forest, preferences, maximal, check=False):
        super().__init__(forest,maximal)
        self.preferences = preferences
        self.check = check
        self.at, self.slot_groups, self.maxima, self.masks = {}, {}, {}, {}
        self.stats = {'chart_facts':len(forest.prod),'groups':0,'candidate_edges':0,'retained_edges':0}
        lowered = forest.lowered
        for item,edges in enumerate(forest.edges):
            production = self.productions[forest.prod[item]]
            position = forest.dot[item]-1
            if position<0 or position>=len(production.rhs) or production.terminal[position]:
                continue
            label = lowered.rule_names[production.rhs[position]]
            if label not in preferences.names:
                continue
            variant = preferences.variants[label]
            role = variant['paths'].get(production.slot.path,'root')
            prefix = tuple((symbol_role(symbol,terminal,variant,lowered),production.tests[i] if production.tests else None) for i,(terminal,symbol) in enumerate(zip(production.terminal[:position],production.rhs[:position])))
            for index,(previous,kind,child,_) in enumerate(edges):
                if kind!=2:
                    continue
                before = self.productions[forest.prod[previous]]
                captures = tuple((variant['roles'].get(name,name),forest.caps[previous][before.slots[pos]]) for name,pos in sorted(before.captures.items(),key=lambda part:part[1]) if pos<forest.dot[previous])
                restores = any(edge[1]==RESTORE for edge in forest.edges[previous])
                key = (variant['component'],role,prefix,forest.origin[item],forest.prefix[previous],captures,forest.strict[previous] if forest.strict else False,restores,forest.origin[child],forest.end[child])
                group = self.slot_groups.setdefault(key,[])
                group.append((item,index,label))
                self.at.setdefault(item,{})[index] = key
                self.stats['candidate_edges'] += 1
        self.stats['groups'] = len(self.slot_groups)

    def availability_key(self,key,group):
        _,item,context = key
        production = self.productions[self.forest.prod[item]]
        return (group,context,production.lhs if self.forest.dot[item]==len(production.rhs) else None)

    def dependencies(self,key):
        if key[0]==0:
            return [self.inner_key(key)]
        found = list(super().dependencies(key))
        for group in set(self.at.get(key[1],{}).values()):
            if self.availability_key(key,group) in self.maxima:
                continue
            for item,index,_ in self.slot_groups[group]:
                candidate = self.partial_key(item,key[2])
                for number,_,previous,child,_,_ in self.all_steps(candidate):
                    if number!=index:
                        continue
                    if previous is not None:
                        found.append(previous)
                    if child is not None:
                        found.append(child)
        return found

    def ways(self,step):
        _,kind,previous,child,a,_ = step
        if kind in (0,RESTORE):
            return 1
        left = self.memo[previous][1 if self.eligible_before(kind,a) else 0]
        right = self.memo[child] if child is not None else 1
        return min(left*right,2)

    def admit(self,key):
        choices = self.at.get(key[1])
        if choices is None:
            return None
        all_,allowed = set(),set()
        for index,group in choices.items():
            context = self.availability_key(key,group)
            kept = self.maxima.get(context)
            if kept is None:
                present,eligible = set(),set()
                for item,number,label in self.slot_groups[group]:
                    candidate = self.partial_key(item,key[2])
                    step = next((s for s in self.all_steps(candidate) if s[0]==number),None)
                    if step is not None and self.ways(step):
                        present.add(label)
                        if not self.guarded(item) or self.permits(item,step[1],step[4]):
                            eligible.add(label)
                def maximal(labels):
                    return {label for label in labels if not any(label in self.preferences.paths[higher] for higher in labels)}
                kept = self.maxima[context] = (maximal(present),maximal(eligible))
            label = self.forest.lowered.rule_names[self.productions[self.forest.prod[key[1]]].rhs[self.forest.dot[key[1]]-1]]
            if label in kept[0]:
                all_.add(index)
            if label in kept[1]:
                allowed.add(index)
        mask = (frozenset(all_),frozenset(allowed))
        self.masks[key] = mask
        self.stats['retained_edges'] += len(all_)
        return mask

    def compute(self,key):
        if key[0]==0:
            return self.memo[self.inner_key(key)][0]
        mask = self.admit(key)
        guarded = self.guarded(key[1])
        all_,allowed = 0,0
        edges = len(self.forest.edges[key[1]])
        for step in self.all_steps(key):
            index,kind,_,_,child,_ = step
            if self.check and edges>1 and index==0 and _testing.fault('lost:context'):
                continue
            ways = self.ways(step)
            if mask is None or index in mask[0]:
                all_ = min(all_+ways,2)
            if (not guarded or self.permits(key[1],kind,child)) and (mask is None or index in mask[1]):
                allowed = min(allowed+ways,2)
        return (all_,allowed)

    def mask(self,key):
        if key[1] not in self.at:
            return None
        self.solve(key)
        return self.masks[key]

    def prepare(self):
        for root in self.forest.roots:
            key = self.full_key(root,self.empty)
            if key is not None:
                self.solve(key)
