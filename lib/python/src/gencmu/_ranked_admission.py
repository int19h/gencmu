"""The earliest qualifying option in each explicit, written slot."""
from ._ranked_facts import RankedFacts
from ._rank import Summaries
from ._ranked_frame import written_prefix
from ._earley import RESTORE


def prefix(forest,item):
    p = forest.lowered.productions[forest.prod[item]]
    return (written_prefix(forest.lowered, p, forest.dot[item], forest.origin[item], forest.prefix[item], forest.caps[item], any(e[1] == RESTORE for e in forest.edges[item]), forest.close_machine, forest.close_prefix[item] if forest.close_prefix else 0), forest.strict[item] if forest.strict else False)


def ancestry(forest,scope):
    if scope is None:
        return None
    lowered = forest.lowered
    frames = tuple(prefix(forest,item) for item in scope['frames'])
    bounds = tuple((lowered.written_helpers[lowered.productions[forest.prod[item]].lhs],forest.origin[item],forest.end[item]) for item in scope['bounds'])
    return (frames,bounds)


class RankedAdmission(RankedFacts):
    def __init__(self,forest,check=False):
        Summaries.__init__(self,forest)
        self.check = check
        self.at,self.slot_groups,self.maxima,self.masks = {},{},{},{}
        self.stats = {'chart_facts':len(forest.prod),'groups':0,'candidate_edges':0,'retained_edges':0}
        lowered = forest.lowered
        for item,edges in enumerate(forest.edges):
            p = self.productions[forest.prod[item]]
            scope = forest.slot_scopes[item] if hasattr(forest,'slot_scopes') else None
            if p.helper and scope is None:
                continue
            position = forest.dot[item]-1
            if position<0 or p.terminal[position]:
                continue
            group_info = lowered.ranked_helpers.get(p.rhs[position])
            if group_info is None:
                continue
            for index,(previous,kind,child,_) in enumerate(edges):
                if kind!=2:
                    continue
                key = (group_info.id,prefix(forest,previous),ancestry(forest,scope),forest.origin[child],forest.end[child])
                group = self.slot_groups.setdefault(key,[])
                group.append((item,index,self.productions[forest.prod[child]].option))
                self.at.setdefault(item,{})[index] = key
                self.stats['candidate_edges'] += 1
        self.stats['groups'] = len(self.slot_groups)

    def admit(self,key):
        choices = self.at.get(key[1])
        if choices is None:
            return None
        all_ = set()
        for index,group in choices.items():
            context = self.availability_key(key,group)
            kept = self.maxima.get(context)
            if context not in self.maxima:
                present = set()
                for item,number,option in self.slot_groups[group]:
                    candidate = self.partial_key(item,key[2])
                    step = next((s for s in self.all_steps(candidate) if s[0]==number),None)
                    if step is not None and self.ways(step):
                        present.add(option)
                kept = self.maxima[context] = min(present,default=None)
            child = self.forest.edges[key[1]][index][2]
            option = self.productions[self.forest.prod[child]].option
            if option==kept:
                all_.add(index)
        mask = frozenset(all_)
        self.masks[key] = mask
        self.stats['retained_edges'] += len(all_)
        return mask
