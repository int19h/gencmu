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
            observation = None
            if production.close_requested and forest.close_structure:
                state = forest.close_structure[item]
                observation = -1 if state == forest.close_machine.INVALID else forest.close_machine.semantic(state)
            lexical = production.lexical
            frame = (lexical.restoration_key() if hasattr(forest, "restoration_aliases") else lexical.id) if lexical is not None else None
            found = (
                production.lhs, forest.origin[item], forest.end[item], forest.tag.get(item),
                forest.structure[item] if forest.structure else None,
                observation,
                forest.family_structure[item] if forest.family_structure else None,
                forest.tree_identity.get(item) if production.tree_requested and hasattr(forest, "tree_identity") else None,
                forest.boundaries[item].id if forest.boundaries else None,
                forest.strict[item] if forest.strict else False,
                bool(forest.edges[item] and forest.edges[item][0][1] == 3),
                production.close_requested, production.tree_requested,
                frame,
                scope["id"] if scope is not None else None,
            )
            self.keys[item] = found
        return found

    def groups(self, steps, eligible=None):
        groups, seen = [], {}
        for step in steps:
            child = step[4]
            erased = step[1] == 2 and self.forest.lowered.productions[self.forest.prod[child]].erased
            if erased and eligible is not None and not eligible(step[3]):
                continue
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
