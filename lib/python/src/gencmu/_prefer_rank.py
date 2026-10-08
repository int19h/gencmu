"""Lossless complete signatures when a rule preference can participate.

A signature records rule spans, ranked occurrences, elisions, and visible actions.
Equal signatures share action summaries.
Each item keeps every signature in its eligibility and cycle context.
Only complete roots compete.
"""
from __future__ import annotations
from dataclasses import dataclass
from functools import cmp_to_key
from . import _testing
from ._earley import RESTORE
from ._rank import Ranker, Ranking, Entry, INF, actions, compare, compare_profiles, sum_profiles, first_difference, decide

def add_counts(a, b):
    out = dict(a)
    for key, value in b.items():
        out[key] = out.get(key, 0) + value
    return out

def compare_elisions(a, b):
    for p in sorted(a.keys() | b.keys()):
        x, y = (a.get(p, 0), b.get(p, 0))
        if x != y:
            return (-1 if x < y else 1, {'basis': 'stage', 'directive': 'late-elision', 'boundary': p, 'counts': [str(x), str(y)]})
    return (0, None)

def contests(preferences, a, b):
    left, right = ({}, {})
    for key in a.keys() | b.keys():
        delta = a.get(key, 0) - b.get(key, 0)
        if delta > 0:
            left[key] = delta
        if delta < 0:
            right[key] = -delta
    forward, reverse = ([], [])
    for (x, p, q), xn in left.items():
        for (y, u, v), yn in right.items():
            if (p, q) != (u, v):
                continue
            path = preferences.paths.get(x, {}).get(y)
            back = preferences.paths.get(y, {}).get(x)
            if path:
                forward.append({'span': [p, q], 'higher': x, 'lower': y, 'path': list(path), 'residualCounts': [str(xn), str(yn)]})
            if back:
                reverse.append({'span': [p, q], 'higher': y, 'lower': x, 'path': list(back), 'residualCounts': [str(yn), str(xn)]})
    key = lambda c: (*c['span'], c['higher'], c['lower'], tuple(c['path']))
    return {'forward': sorted(forward, key=key), 'reverse': sorted(reverse, key=key)}

def occurrences_of_rope(rope, lowered, project):
    occurrences = {}
    for act in actions(rope):
        if act.read:
            continue
        production = lowered.productions[act.production]
        if production.helper or production.rule_name not in lowered.grammar.preferences.names:
            continue
        p, q = project[act.start], project[act.end]
        if p < q:
            key = (production.rule_name, p, q)
            occurrences[key] = occurrences.get(key, 0) + 1
    return occurrences

def directed_cycle(edges):
    color = [0] * len(edges)
    for start in range(len(edges)):
        if color[start]:
            continue
        path, positions = ([start], {start: 0})
        color[start] = 1
        stack = [(start, iter(sorted(edges[start])))]
        while stack:
            source, targets = stack[-1]
            target = next(targets, None)
            if target is None:
                color[source] = 2
                positions.pop(source)
                path.pop()
                stack.pop()
                continue
            if color[target] == 1:
                cycle = path[positions[target]:]
                least = cycle.index(min(cycle))
                return cycle[least:] + cycle[:least]
            if color[target] == 0:
                color[target] = 1
                positions[target] = len(path)
                path.append(target)
                stack.append((target, iter(sorted(edges[target]))))
    return None

@dataclass
class Signature:
    profile: tuple
    occurrences: dict
    elisions: dict
    entries: list
    count: int
    w: bool = False

class PreferenceRanker(Ranker):

    def __init__(self, forest, lean, preferences, maximal=None):
        super().__init__(forest, 'none' if lean == 'late-elision' else lean, maximal)
        self.stage_lean = lean
        self.preferences = preferences
        self.statistics = dict(slow=False, forest_items=0, forest_edges=0, contexts=0, signatures=0, largest_set=0, comparisons=0)

    def position(self, p):
        return self.forest.project[p] if self.forest.project is not None else p

    def possible_contest(self, roots):
        seen, inventory = (set(), {})
        stack = list(roots)
        possible = False
        forest = self.forest
        while stack:
            item = stack.pop()
            if item in seen:
                continue
            seen.add(item)
            self.statistics['forest_items'] += 1
            self.statistics['forest_edges'] += len(forest.edges[item])
            production = self.productions[forest.prod[item]]
            p, q = (self.position(forest.origin[item]), self.position(forest.end[item]))
            name = production.rule_name
            if forest.dot[item] == len(production.rhs) and (not production.helper) and (p < q) and (name in self.preferences.names):
                names = inventory.setdefault((p, q), set())
                for other in names:
                    possible = possible or other in self.preferences.paths[name] or name in self.preferences.paths[other]
                names.add(name)
            for pred, kind, a, b in forest.edges[item]:
                if kind in (1, 2):
                    stack.append(pred)
                if kind == 2:
                    stack.append(a)
        return possible

    def signature_key(self, s):
        visible = None
        if self.stage_lean in ('greedy', 'lazy'):
            visible = tuple((act.eq for act in actions(s.entries[0].seq) if act.visible))
        return (s.profile, tuple(sorted(s.occurrences.items())), tuple(sorted(s.elisions.items())) if self.stage_lean == 'late-elision' else None, visible)

    def store(self, table, s):
        """Merge identical signatures without ranking distinct signatures."""
        key = self.signature_key(s)
        if key not in table:
            table[key] = Signature(s.profile, s.occurrences, s.elisions, [Entry(e.seq, list(e.alts), e.at) for e in s.entries], s.count, s.w)
        else:
            old = table[key]
            old.count = min(2, old.count + s.count)
            old.w = old.w or s.w
            for e in s.entries:
                self.keep(old.entries, Entry(e.seq, list(e.alts), e.at))

    def compute(self, key):
        kind, item, _ = key
        forest = self.forest
        all_ = {}
        if kind == 0:
            production = self.productions[forest.prod[item]]
            p, q = (self.position(forest.origin[item]), self.position(forest.end[item]))
            for body in self.memo[self.inner_key(key)][0].values():
                profile, occurrences, elisions = (body.profile, body.occurrences, body.elisions)
                if not production.helper and p < q:
                    if production.leftmost_longest:
                        profile = sum_profiles(profile, ((p, q, 1),))
                    if production.rule_name in self.preferences.names:
                        occurrences = add_counts(occurrences, {(production.rule_name, p, q): 1})
                if self.stage_lean == 'late-elision' and production.helper and (production.elided is not None) and (not production.rhs) and (forest.edges[item][0][1] != RESTORE):
                    elisions = add_counts(elisions, {forest.origin[item]: 1})
                self.store(all_, Signature(profile, occurrences, elisions, [self.extend(e, self.close_leaf(item)) for e in body.entries], body.count, body.w))
            result = all_
            allowed = all_
        else:
            guarded = self.guarded(item)
            allowed = {} if guarded else all_
            for index, edge_kind, pred_key, child_key, a, b in self.steps(key):
                produced = []
                marked = self.marks is not None and index in self.marks.get(item, ())
                if edge_kind in (0, RESTORE):
                    produced = [Signature((), {}, {}, [Entry(self.read_leaf(a, b) if edge_kind == RESTORE else None, [], INF)], 1, marked)]
                else:
                    earlier = self.memo[pred_key][1 if self.eligible_before(edge_kind, a) else 0]
                    for before in earlier.values():
                        if edge_kind == 1:
                            produced.append(Signature(before.profile, before.occurrences, before.elisions, [self.extend(e, self.read_leaf(a, b)) for e in before.entries], before.count, marked and before.w))
                        else:
                            for after in self.memo[child_key].values():
                                produced.append(Signature(sum_profiles(before.profile, after.profile), add_counts(before.occurrences, after.occurrences), add_counts(before.elisions, after.elisions), [self.combine(x, y) for x in before.entries for y in after.entries], min(2, before.count * after.count), marked and before.w and after.w))
                sibling = self.check and len(forest.edges[item]) > 1 and (index == 0)
                if sibling and _testing.fault('lost:select'):
                    continue
                for s in produced:
                    if sibling and _testing.fault('lost:context'):
                        s.count, s.w = (0, False)
                    self.store(all_, s)
                    if guarded and self.permits(item, edge_kind, a):
                        self.store(allowed, s)
            result = (all_, allowed)
        self.statistics['contexts'] += 1
        self.statistics['signatures'] += len(all_)
        self.statistics['largest_set'] = max(self.statistics['largest_set'], len(all_), len(allowed))
        return result

    def canonical_entry(self, s):
        kept = []
        for e in s.entries:
            self.keep(kept, Entry(e.seq, list(e.alts), e.at))
        kept.sort(key=cmp_to_key(lambda a, b: compare(a.seq, b.seq, self.lean).order))
        first = kept[0]
        for e in kept[1:]:
            difference = first_difference(first.seq, e.seq, True)
            at = difference[0] if difference is not None else INF
            self.offer(first, e.seq, at)
            for alt in e.alts:
                self.offer(first, alt, min(at, e.at))
        return first

    def canonical_order(self, a, b):
        return (compare_elisions(a[0].elisions, b[0].elisions)[0] if self.stage_lean == 'late-elision' else 0) or compare(a[1].seq, b[1].seq, self.lean).order

    def pair(self, a, b):
        c = contests(self.preferences, a[0].occurrences, b[0].occurrences)
        # Opposed contests tie without the stage policy.
        if c['forward'] and c['reverse']:
            return (0, None)
        if c['forward']:
            return (-1, {'basis': 'prefer', 'contests': c['forward']})
        if c['reverse']:
            return (1, None)
        if self.stage_lean == 'late-elision':
            return compare_elisions(a[0].elisions, b[0].elisions)
        difference = first_difference(a[1].seq, b[1].seq, True)
        if difference is None or difference[1] is None or difference[2] is None:
            return (0, None)
        order = decide(difference[1], difference[2], self.stage_lean)
        return (order, {'basis': 'stage', 'directive': self.stage_lean, 'witness': difference[1:]})

    def rank(self, roots):
        try:
            return self.rank_complete(roots)
        finally:
            hook = _testing.preference_ranking.get()
            if hook is not None:
                hook(dict(self.statistics))

    def rank_complete(self, roots):
        if not self.possible_contest(roots):
            from ._rank import rank_original
            return rank_original(self.forest, self.stage_lean, self.maximal, self.marks, self.check)
        self.statistics['slow'] = True
        root = {}
        for item in roots:
            key = self.full_key(item, self.empty)
            if key is not None:
                for s in self.solve(key).values():
                    self.store(root, s)
        self.statistics['contexts'] += 1
        self.statistics['signatures'] += len(root)
        self.statistics['largest_set'] = max(self.statistics['largest_set'], len(root))
        total = min(2, sum((s.count for s in root.values())))
        if not root or not total:
            return None
        profile = next(iter(root.values())).profile
        for s in root.values():
            if compare_profiles(s.profile, profile) < 0:
                profile = s.profile
        best = [(s, self.canonical_entry(s)) for s in root.values() if compare_profiles(s.profile, profile) == 0]
        best.sort(key=cmp_to_key(self.canonical_order))
        # Include every flag-best vertex, even when another vertex defeats it.
        edges = [{} for _ in best]
        incoming = set()
        for i, a in enumerate(best):
            for j in range(i + 1, len(best)):
                self.statistics['comparisons'] += 1
                order, reason = self.pair(a, best[j])
                if not order:
                    continue
                source, target = (i, j) if order < 0 else (j, i)
                if order > 0:
                    _, reason = self.pair(best[j], a)
                edges[source][target] = reason
                incoming.add(target)
        result = Ranking('tie', None, None, None, any((s.w for s in root.values())) if self.marks is not None else None)
        result.profile, result.slow = (profile, True)
        cycle = directed_cycle(edges)
        if cycle is not None:
            result.readings = [best[i][1].seq for i in cycle]
            result.first = result.readings[0]
            result.cycle = [{'from': i, 'to': (i + 1) % len(cycle), **edges[v][cycle[(i + 1) % len(cycle)]]} for i, v in enumerate(cycle)]
            return result
        survivors = [entry for i, entry in enumerate(best) if i not in incoming]
        result.first = survivors[0][1].seq
        alts = [(s, Entry(rope, [], INF)) for i, (s, e) in enumerate(survivors) for rope in ([e.seq] if i else []) + e.alts]
        if not alts:
            result.verdict = 'unique' if total == 1 else 'resolved'
            return result

        def divergence(entry):
            difference = first_difference(result.first, entry[1].seq, True)
            return difference[0] if difference is not None else INF

        def alt_order(a, b):
            x, y = (divergence(a), divergence(b))
            return (-1 if x < y else 1 if x > y else 0) or self.canonical_order(a, b)
        alts.sort(key=cmp_to_key(alt_order))
        result.second = alts[0][1].seq
        difference = first_difference(result.first, result.second, True)
        if difference is None or difference[1] is None or difference[2] is None:
            difference = first_difference(result.first, result.second, False)
        result.witness = difference[1:]
        c = contests(self.preferences, survivors[0][0].occurrences, alts[0][0].occurrences)
        if c['forward'] and c['reverse']:
            result.conflict = c
        return result
