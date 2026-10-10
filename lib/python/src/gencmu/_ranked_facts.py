"""Ranked admission over finite, eligible proofs of raw packed edges."""
from __future__ import annotations
from ._rank import Summaries
from ._earley import RESTORE
from . import _testing


class RankedFacts(Summaries):
    def availability_key(self,key,group):
        _,item,context = key
        production = self.productions[self.forest.prod[item]]
        scope = self.forest.slot_scopes[item] if hasattr(self.forest,"slot_scopes") else None
        parent = self.productions[self.forest.prod[scope["frames"][0]]].lhs if scope is not None else production.lhs
        return (group,context,parent if self.forest.dot[item]==len(production.rhs) else None)

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
            return getattr(self.forest,"slot_routes",{}).get(key[1])
        self.solve(key)
        return self.masks[key]

    def prepare(self):
        for root in self.forest.roots:
            key = self.full_key(root,self.empty)
            if key is not None:
                self.solve(key)
