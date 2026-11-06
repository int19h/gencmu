"""Completed observable states of erased constituents (engine §6)."""


class ErasedClasses:
    def __init__(self, forest):
        self.forest = forest
        self.keys = {}

    def key(self, item):
        found = self.keys.get(item)
        if found is None:
            forest = self.forest
            production = forest.lowered.productions[forest.prod[item]]
            scope = forest.slot_scopes[item] if hasattr(forest, "slot_scopes") else None
            found = (
                production.lhs, forest.origin[item], forest.end[item], forest.tag.get(item),
                forest.structure[item] if forest.structure else None,
                forest.close_structure[item] if production.close_requested and forest.close_structure else None,
                forest.family_structure[item] if forest.family_structure else None,
                forest.tree_identity.get(item) if production.tree_requested and hasattr(forest, "tree_identity") else None,
                forest.boundaries[item].id if forest.boundaries else None,
                forest.strict[item] if forest.strict else False,
                bool(forest.edges[item] and forest.edges[item][0][1] == 3),
                production.close_requested, production.tree_requested,
                production.lexical.id if production.lexical is not None else None,
                scope["id"] if scope is not None else None,
            )
            self.keys[item] = found
        return found

    def groups(self, steps):
        groups, seen = [], {}
        for step in steps:
            child = step[4]
            erased = step[1] == 2 and self.forest.lowered.productions[self.forest.prod[child]].erased
            key = (step[2], self.key(child)) if erased else None
            if key is not None and key in seen:
                seen[key].append(step)
            else:
                group = [step]
                groups.append((erased, group))
                if key is not None:
                    seen[key] = group
        return groups

    def roots(self, roots):
        groups, seen = [], {}
        for root in roots:
            erased = self.forest.lowered.productions[self.forest.prod[root]].erased
            key = self.key(root) if erased else None
            if key is not None and key in seen:
                seen[key].append(root)
            else:
                group = [root]
                groups.append((erased, group))
                if key is not None:
                    seen[key] = group
        return groups
