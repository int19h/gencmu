"""A ranking view carries written invocations through generated helpers."""
from dataclasses import replace
from ._earley import RESTORE


def helper_forest(raw, names, marks):
    productions = raw.lowered.productions
    helpers = {p.lhs for p in productions if p.helper}
    users = {}
    for p in productions:
        if p.helper:
            for terminal,symbol in zip(p.terminal,p.rhs):
                if not terminal:
                    users.setdefault(symbol,[]).append(p.lhs)
    pending = [raw.lowered.rule_ids[name] for name in names]
    wrapped = set(pending)
    for symbol in pending:
        for parent in users.get(symbol,()):
            if parent not in wrapped:
                wrapped.add(parent)
                pending.append(parent)
    if not wrapped:
        return raw,marks
    names = ['prod', 'dot', 'origin', 'end', 'caps', 'edges', 'structure', 'prefix', 'strict', 'close_structure', 'close_prefix']
    forest = replace(raw,**{name:list(getattr(raw,name)) for name in names},tag=dict(raw.tag))
    forest.slot_original = list(range(len(raw.prod)))
    forest.slot_scopes = [None]*len(raw.prod)
    forest.slot_indices = [[] for _ in raw.prod]
    forest.slot_helpers = helpers
    scoped,scopes = {},{}

    def view(item,scope):
        if scope is None:
            return item
        key = (item,scope['id'])
        if key in scoped:
            return scoped[key]
        number = len(forest.prod)
        scoped[key] = number
        for name in names:
            values = getattr(forest,name)
            if name == 'edges':
                values.append([])
            elif getattr(raw,name):
                values.append(getattr(raw,name)[item])
        if item in raw.tag:
            forest.tag[number] = raw.tag[item]
        forest.slot_original.append(item)
        forest.slot_scopes.append(scope)
        forest.slot_indices.append([])
        return number

    def scope_for(previous,carrier,outer,parent):
        if outer is not None and productions[raw.prod[parent]].lhs == productions[raw.prod[carrier]].lhs:
            return outer
        key = (previous,carrier,outer['id'] if outer is not None else None)
        if key in scopes:
            return scopes[key]
        scope = {'id':len(scopes),'frames':(outer['frames'] if outer else ())+(previous,),
                 'bounds':(outer['bounds'] if outer else ()) + (carrier,)}
        scopes[key] = scope
        return scope

    at = 0
    while at < len(forest.prod):
        original,scope = forest.slot_original[at],forest.slot_scopes[at]
        production = productions[raw.prod[original]]
        edges,indices = [],[]

        def append(edge,index):
            edges.append(edge)
            indices.append(index)
        for index,(previous,kind,child,extra) in enumerate(raw.edges[original]):
            if kind != 1 and kind != 2:
                append((previous,kind,child,extra),index)
                continue
            predecessor = view(previous,scope)
            carries = kind == 2 and productions[raw.prod[child]].lhs in wrapped and (not production.helper or scope is not None)
            if not carries:
                append((predecessor,kind,child,extra),index)
                continue
            inner = scope_for(previous,child,scope,original)
            append((predecessor,kind,view(child,inner),extra),index)
        forest.edges[at] = edges
        forest.slot_indices[at] = indices
        at += 1
    if marks is not None:
        marks = {item:{i for i,original_index in enumerate(forest.slot_indices[item]) if original_index in marks[original]} for item,original in enumerate(forest.slot_original) if original in marks}
    return forest,marks
