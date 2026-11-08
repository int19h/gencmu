"""Ranked admission over finite, eligible proofs of raw packed edges."""
from __future__ import annotations
from ._rank import Summaries, INFINITE_MEASURE
from ._measures import ZERO_MEASURE, sum_measure, compare_measure
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
        left = self.memo[previous]
        right = self.memo[child] if child is not None else 1
        return min(left*right,2)

    def cost(self, step):
        _, kind, previous, child, token, _ = step
        measure = self.measure_counts.get(previous, INFINITE_MEASURE) if previous is not None else ZERO_MEASURE
        if kind in (1, RESTORE):
            return sum_measure(measure, self.measures.carried[token])
        if kind == 2:
            production = self.productions[self.forest.prod[child[1]]]
            measure = sum_measure(measure, ZERO_MEASURE if production.erased else self.measure_counts.get(child, INFINITE_MEASURE))
        return measure

    def compute(self,key):
        if key[0]==0:
            inner = self.inner_key(key)
            p = self.productions[self.forest.prod[key[1]]]
            measure = self.measure_counts.get(inner, INFINITE_MEASURE)
            if p.error is not None:
                measure = sum_measure(measure, self.measures.own(self.forest.origin[key[1]], self.forest.end[key[1]]))
            self.measure_counts[key] = measure
            return self.memo[inner]
        mask = self.admit(key)
        all_ = 0
        measure = INFINITE_MEASURE
        edges = len(self.forest.edges[key[1]])
        for step in self.all_steps(key):
            index,kind,_,_,child,_ = step
            if self.check and edges>1 and index==0 and _testing.fault('lost:context'):
                continue
            ways = self.ways(step)
            cost = self.cost(step)
            order = compare_measure(cost, measure)
            if ways and (mask is None or index in mask) and order <= 0:
                if order < 0:
                    measure, all_ = cost, 0
                all_ = min(all_+ways,2)
        self.measure_counts[key] = measure
        return all_

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
