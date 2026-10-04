"""Choosing a parse (engine §6), computed over the packed forest without
enumerating derivations.

A derivation is its sequence of actions in bottom-up order, held as a rope
so that derivations built on a common part share it. For every item and
every context of the cycle rule (engine §4, "Derivations"), the ranking
keeps a short list of candidates: the T-least derivation of each visible
sequence that a later action could still decide, since two sequences one
of which is a visible prefix of the other are ordered only by what follows
them; and with each, the derivations tied with it that diverge from it
earliest. Everything else is settled where it is found.
"""

from __future__ import annotations

import math
from typing import Any, Iterator, Optional

from . import _testing
from ._earley import RESTORE, Forest
from ._maximal import Maximal

Count = float
"""A number of visible actions, an exact integer, or INF."""

INF: Count = math.inf
"""The point of divergence of two derivations that differ only in
transparent actions: after every visible action. It is no integer, so no
real count of visible actions, however large, can reach it."""


class Act:
    """An action: a read of a token as a terminal, or a close of an item."""

    __slots__ = ("read", "token", "terminal", "item", "production", "start", "end", "visible", "eq", "canon")

    def __init__(
        self,
        read: bool,
        token: int = -1,
        terminal: str = "",
        item: int = -1,
        production: int = -1,
        start: int = 0,
        end: int = 0,
        visible: bool = True,
    ) -> None:
        self.read = read
        self.token = token
        self.terminal = terminal
        self.item = item
        self.production = production
        self.start = start
        self.end = end
        self.visible = visible
        if read:
            self.eq: tuple[Any, ...] = (0, token, terminal)
            self.canon: tuple[Any, ...] = (0, terminal)
        else:
            self.eq = (1, production, start, end)
            self.canon = (1, production, start, end)


class Rope:
    """A sequence of actions: a leaf holding one, or the concatenation of two."""

    __slots__ = ("act", "left", "right", "vis", "size")

    def __init__(self, act: Act | None, left: Optional["Rope"], right: Optional["Rope"], vis: int, size: int) -> None:
        self.act = act
        self.left = left
        self.right = right
        self.vis = vis
        self.size = size


def leaf(act: Act) -> Rope:
    return Rope(act, None, None, 1 if act.visible else 0, 1)


def concat(left: Rope | None, right: Rope | None) -> Rope | None:
    if left is None:
        return right
    if right is None:
        return left
    return Rope(None, left, right, left.vis + right.vis, left.size + right.size)


def vis(rope: Rope | None) -> int:
    return 0 if rope is None else rope.vis


def actions(rope: Rope | None) -> Iterator[Act]:
    """The actions of a rope, in order."""
    stack = [rope] if rope is not None else []
    while stack:
        node = stack.pop()
        if node.act is not None:
            yield node.act
        else:
            stack.append(node.right)  # type: ignore[arg-type]
            stack.append(node.left)  # type: ignore[arg-type]


def _front(stack: list[Rope], visible: bool) -> Rope | None:
    while stack:
        top = stack[-1]
        if visible and top.vis == 0:
            stack.pop()
            continue
        return top
    return None


def _first(node: Rope, visible: bool) -> Act:
    while node.act is None:
        left = node.left
        assert left is not None and node.right is not None
        node = node.right if visible and left.vis == 0 else left
    return node.act


def _expand(stack: list[Rope]) -> None:
    node = stack.pop()
    stack.append(node.right)  # type: ignore[arg-type]
    stack.append(node.left)  # type: ignore[arg-type]


def first_difference(a: Rope | None, b: Rope | None, visible: bool) -> tuple[int, Act | None, Act | None] | None:
    """The first pair of differing actions, with the number of visible actions
    before it; ``None`` on the side that ended; ``None`` if the two are equal.
    With ``visible``, only visible actions are compared."""
    sa = [a] if a is not None else []
    sb = [b] if b is not None else []
    index = 0
    while True:
        fa = _front(sa, visible)
        fb = _front(sb, visible)
        if fa is None or fb is None:
            if fa is None and fb is None:
                return None
            return (index, _first(fa, visible) if fa is not None else None, _first(fb, visible) if fb is not None else None)
        if fa is fb:
            sa.pop()
            sb.pop()
            index += fa.vis
            continue
        la, lb = fa.act, fb.act
        if la is not None and lb is not None:
            if la is lb or la.eq == lb.eq:
                sa.pop()
                sb.pop()
                index += fa.vis
                continue
            return (index, la, lb)
        if la is None and lb is None:
            ma = fa.vis if visible else fa.size
            mb = fb.vis if visible else fb.size
            if ma >= mb:
                _expand(sa)
            if mb >= ma:
                _expand(sb)
        elif la is None:
            _expand(sa)
        else:
            _expand(sb)


def decide(x: Act, y: Act, lean: str) -> int:
    """Rules 1-3 of engine §6 at a visible difference: -1 when x wins, 1 when
    y wins, 0 when they are tied. ``lean`` is greedy, lazy, or none for
    elision-only's check, under which any two derivations that differ are
    tied (engine §7). Two reads of one token as different terminals are
    tied (engine §6)."""
    if x.read and y.read:
        return 0
    if x.read != y.read:
        if lean == "none":
            return 0
        reads_win = lean == "greedy"
        return -1 if x.read == reads_win else 1
    return 0


def canonical(x: Act, y: Act) -> int:
    return -1 if x.canon < y.canon else (1 if x.canon > y.canon else 0)


class Comparison:
    __slots__ = ("settled", "order", "index", "decisive", "x", "y")

    def __init__(self, settled: bool, order: int, index: Count, decisive: bool, x: Act | None = None, y: Act | None = None) -> None:
        self.settled = settled
        self.order = order
        self.index = index
        self.decisive = decisive
        self.x = x
        self.y = y


def compare(a: Rope | None, b: Rope | None, lean: str) -> Comparison:
    """The order T of two derivations of one item. Unsettled when one visible
    sequence is a proper prefix of the other, or when the visible sequences
    are equal and one whole sequence is a proper prefix of the other; the
    order is then the one the end of the text gives, the shorter first. ``index`` is the number of
    visible actions before the first visible difference, INF when there is
    none."""
    difference = first_difference(a, b, True)
    if difference is None:
        whole = first_difference(a, b, False)
        if whole is None:
            return Comparison(True, 0, INF, False)
        if whole[1] is None or whole[2] is None:
            # Equal visible sequences, one whole sequence a prefix of the
            # other: only a part of a production's children can be so, and
            # what follows it decides.
            return Comparison(False, -1 if whole[1] is None else 1, INF, False)
        return Comparison(True, canonical(whole[1], whole[2]), INF, False)
    index, x, y = difference
    if x is None or y is None:
        return Comparison(False, -1 if x is None else 1, index, False)
    decided = decide(x, y, lean)
    if decided:
        return Comparison(True, decided, index, True, x, y)
    return Comparison(True, canonical(x, y), index, False, x, y)


Alt = Optional[Rope]
"""A tied derivation."""


class Entry:
    """A candidate: a derivation ``seq``, and the derivations tied with it that
    diverge from it earliest, ``alts``, after ``at`` visible actions (INF for
    those that differ from it only in transparent actions)."""

    __slots__ = ("seq", "alts", "at")

    def __init__(self, seq: Rope | None, alts: list[Alt], at: Count) -> None:
        self.seq = seq
        self.alts = alts
        self.at = at


Key = tuple[Any, ...]
"""A summary's key: ``(0, item, context)`` for all the derivations of a
completed item, its close included, or ``(1, item, context)`` for those of
an item up to its dot. ``context`` is the cycle context (engine §6): the
rules above the item over its own span, or none where the item's
derivations cannot depend on it."""

Step = tuple[int, int, Optional[Key], Optional[Key], Any, Any]
"""One edge of an item (engine §6), as a summary uses it: the edge's index
among the item's edges, its kind (0 start, 1 read, 2 completion, RESTORE a
restoration of the check of engine §7.4), the keys
of the item before the step and of the completed child, and the token and
terminal of a read or the child item of a completion."""


class Summaries:
    """What every ranking rule shares (engine §6): the summaries of a
    forest's items, one for each item, eligibility and cycle context, found
    without recursion. A summary of an item up to its dot is a pair: over
    all its derivations, and over those that ``maximal`` lets an elided
    terminator follow, its eligible ones. Without ``maximal``, or for an
    item whose next symbol is no elidable optional, the two are one."""

    def __init__(self, forest: Forest, maximal: Maximal | None) -> None:
        self.forest = forest
        self.maximal = maximal
        self.productions = forest.lowered.productions
        self.memo: dict[Key, Any] = {}
        self.steps_memo: dict[Key, list[Step]] = {}
        self.dependencies_memo: dict[Key, list[Key]] = {}
        self.sensitive_memo: dict[int, bool] = {}
        self.empty: frozenset[int] = frozenset()
        self.groups_memo: dict[int, int] | None = None

    # -- the cycle rule's contexts

    def rule(self, item: int) -> int:
        return self.productions[self.forest.prod[item]].lhs

    def sensitive(self, item: int) -> bool:
        """Whether an item's derivations depend on its context: whether it has
        a child, directly or through an empty-ended predecessor, spanning its
        whole span. Predecessors are followed with a stack, not recursion."""
        memo = self.sensitive_memo
        if item in memo:
            return memo[item]
        forest = self.forest
        origin = forest.origin
        stack = [item]
        while stack:
            current = stack[-1]
            if current in memo:
                stack.pop()
                continue
            start, end = origin[current], forest.end[current]
            result = False
            waiting = None
            for pred, kind, a, _ in forest.edges[current]:
                if kind != 2:
                    continue
                if origin[a] == start:
                    result = True
                    break
                if origin[a] == end:
                    known = memo.get(pred)
                    if known is None:
                        waiting = pred
                        break
                    if known:
                        result = True
                        break
            if waiting is not None and not result:
                stack.append(waiting)
                continue
            memo[current] = result
            stack.pop()
        return memo[item]

    def groups(self) -> dict[int, int]:
        """The group of each rule that can complete again below itself over
        its own span, found once, when first asked for.

        The graph has an arc from one rule to another when an item of the
        first has a completed child of the second over the same span. A rule
        above an item over its span can complete again below it only if the
        two rules reach each other in this graph: they are in one strongly
        connected group (engine §6). A group of one rule with no arc to
        itself has no cycle, and its rule has no group."""
        if self.groups_memo is not None:
            return self.groups_memo
        forest = self.forest
        origin, end = forest.origin, forest.end
        arcs: dict[int, set[int]] = {}
        for item, edges in enumerate(forest.edges):
            for _, kind, child, _ in edges:
                if kind == 2 and origin[child] == origin[item] and end[child] == end[item]:
                    arcs.setdefault(self.rule(item), set()).add(self.rule(child))
        # Tarjan's algorithm, with a stack of its own in place of recursion.
        index: dict[int, int] = {}
        low: dict[int, int] = {}
        open_: list[int] = []
        on_open: set[int] = set()
        groups: dict[int, int] = {}
        found = 0
        for start in arcs:
            if start in index:
                continue
            frames: list[tuple[int, Iterator[int]]] = []

            def enter(rule: int) -> None:
                index[rule] = low[rule] = len(index)
                open_.append(rule)
                on_open.add(rule)
                frames.append((rule, iter(arcs.get(rule, ()))))

            enter(start)
            while frames:
                rule, targets = frames[-1]
                target = next(targets, None)
                if target is not None:
                    if target not in index:
                        enter(target)
                    elif target in on_open:
                        low[rule] = min(low[rule], index[target])
                    continue
                frames.pop()
                if frames:
                    parent = frames[-1][0]
                    low[parent] = min(low[parent], low[rule])
                if low[rule] == index[rule]:
                    members = []
                    while True:
                        member = open_.pop()
                        on_open.discard(member)
                        members.append(member)
                        if member == rule:
                            break
                    if len(members) > 1 or rule in arcs.get(rule, ()):
                        for member in members:
                            groups[member] = found
                        found += 1
        self.groups_memo = groups
        return groups

    def context_of(self, item: int, forbidden: frozenset[int]) -> frozenset[int]:
        """The part of a cycle context that matters to an item: the rules of
        its own rule's cyclic group, the only ones that can complete again
        below it over its span (engine §6). So ancestors outside that group
        cause no difference of context. Different sets of ancestors within
        the group can still need different summaries of the item."""
        if not forbidden or not self.sensitive(item):
            return self.empty
        groups = self.groups()
        own = groups.get(self.rule(item))
        if own is None:
            return self.empty
        kept = frozenset(rule for rule in forbidden if groups.get(rule) == own)
        return kept if kept else self.empty

    def full_key(self, item: int, forbidden: frozenset[int]) -> Key | None:
        """The key of a completed item in a context, or ``None`` where the
        context forbids its rule, since the derivation would be cyclic."""
        if self.rule(item) in forbidden:
            return None
        return (0, item, self.context_of(item, forbidden))

    def partial_key(self, item: int, forbidden: frozenset[int]) -> Key:
        return (1, item, self.context_of(item, forbidden))

    def inner_key(self, key: Key) -> Key:
        """The key of a completed item's derivations before its close: its
        own rule joins the context of its children over its span."""
        _, item, context = key
        return self.partial_key(item, context | {self.rule(item)})

    def all_steps(self, key: Key) -> list[Step]:
        """The edges of a partial key's item that its context allows."""
        found = self.steps_memo.get(key)
        if found is not None:
            return found
        _, item, context = key
        forest = self.forest
        start, end = forest.origin[item], forest.end[item]
        found = []
        for index, (pred, kind, a, b) in enumerate(forest.edges[item]):
            if kind == RESTORE and _testing.fault("rank-restoration"):
                # A fault gives a restoration no derivation (tests/README.md).
                continue
            if kind == 0 or kind == RESTORE:
                found.append((index, kind, None, None, a, b))
                continue
            pred_key = self.partial_key(pred, context if forest.end[pred] == end else self.empty)
            child_key = None
            if kind == 2:
                child_key = self.full_key(a, context if forest.origin[a] == start else self.empty)
                if child_key is None:
                    continue
            found.append((index, kind, pred_key, child_key, a, b))
        self.steps_memo[key] = found
        return found

    def steps(self, key: Key) -> list[Step]:
        """The edges that a partial key's summary combines."""
        return self.all_steps(key)

    def dependencies(self, key: Key) -> list[Key]:
        found = self.dependencies_memo.get(key)
        if found is not None:
            return found
        if key[0] == 0:
            found = [self.inner_key(key)]
        else:
            found = []
            for _, _, pred_key, child_key, _, _ in self.steps(key):
                if pred_key is not None:
                    found.append(pred_key)
                if child_key is not None:
                    found.append(child_key)
        self.dependencies_memo[key] = found
        return found

    def solve(self, key: Key) -> Any:
        memo = self.memo
        if key in memo:
            return memo[key]
        # Each key is visited twice: once to push what it needs, once to be
        # computed when that is known.
        stack: list[tuple[Key, bool]] = [(key, False)]
        while stack:
            top, ready = stack.pop()
            if top in memo:
                continue
            if ready:
                memo[top] = self.compute(top)
                continue
            stack.append((top, True))
            for dep in self.dependencies(top):
                if dep not in memo:
                    stack.append((dep, False))
        return memo[key]

    def compute(self, key: Key) -> Any:
        raise NotImplementedError

    # -- eligibility under maximal

    def guarded(self, item: int) -> bool:
        """Whether the item's next symbol is an elidable optional whose
        elision maximal can forbid, so that its two summaries can differ."""
        return self.maximal is not None and self.maximal.guards(item)

    def eligible_before(self, kind: int, child: Any) -> bool:
        """Whether an edge combines only the eligible derivations of the
        item before it: an edge over an elided terminator (engine §6)."""
        return kind == 2 and self.maximal is not None and self.maximal.elided(child)

    def permits(self, item: int, kind: int, child: Any) -> bool:
        """Whether the derivations of a guarded item through an edge are
        eligible: maximal does not forbid the node of its last symbol."""
        if kind != 2:
            return True
        assert self.maximal is not None
        forest = self.forest
        tests = self.productions[forest.prod[item]].tests
        test = tests[forest.dot[item] - 1] if tests else None
        return not self.maximal.forbids(child, test)


class Ranker(Summaries):
    """Ranks a forest's derivations under ``greedy``, ``lazy`` or no lean,
    or only counts them (up to two). ``maximal`` is the resolution's
    maximal, if it has it (engine §4). ``best``, when given, is the
    summaries of ``late-elision``, and the ranker then sees only the edges
    that attain their least vectors, the forest of the best derivations
    (engine §6)."""

    def __init__(
        self,
        forest: Forest,
        lean: str,
        maximal: Maximal | None = None,
        entries: bool = True,
        best: Elisions | None = None,
    ) -> None:
        super().__init__(forest, maximal)
        self.lean = lean
        self.entries = entries
        self.best = best
        self.read_leaves: dict[tuple[int, str], Rope] = {}
        self.close_leaves: dict[int, Rope] = {}
        # Whether this ranks the check of elision-only, which only its
        # faults read.
        self.check = False
        # The witness hook's marks (tests/README.md): for each item of W(D),
        # the indices of its edges that W(D) uses. With them, the same loop
        # that counts also says, for each key, whether its count includes a
        # derivation of marked edges only: over all derivations and over the
        # eligible ones. A parse that no test watches has none.
        self.marks: dict[int, set[int]] | None = None
        self.witnessed: dict[Key, tuple[bool, bool]] = {}

    def steps(self, key: Key) -> list[Step]:
        best = self.best
        if best is None:
            return self.all_steps(key)
        kept = best.kept(key)
        return [step for step in self.all_steps(key) if step[0] in kept]

    # -- composition

    def read_leaf(self, token: int, terminal: str) -> Rope:
        found = self.read_leaves.get((token, terminal))
        if found is None:
            found = leaf(Act(True, token=token, terminal=terminal))
            self.read_leaves[(token, terminal)] = found
        return found

    def close_leaf(self, item: int) -> Rope:
        found = self.close_leaves.get(item)
        if found is None:
            forest = self.forest
            production = self.productions[forest.prod[item]]
            found = leaf(
                Act(
                    False,
                    item=item,
                    production=production.id,
                    start=forest.origin[item],
                    end=forest.end[item],
                    visible=not production.transparent,
                )
            )
            self.close_leaves[item] = found
        return found

    def compute(self, key: Key) -> Any:
        """A key's value: the candidates and the number of derivations, or
        the number alone when only counting. A partial key has two, as a
        pair: over all its item's derivations, and over its eligible ones."""
        kind, item, _ = key
        memo = self.memo
        marks = self.marks
        if kind == 0:
            if marks is not None:
                inner_w = self.witnessed[self.inner_key(key)][0]
                self.witnessed[key] = (inner_w, inner_w)
            inner = memo[self.inner_key(key)][0]
            if not self.entries:
                return inner
            entries, count = inner
            close = self.close_leaf(item)
            kept: list[Entry] = []
            for entry in entries:
                self.keep(kept, self.extend(entry, close))
            return (kept, count)
        guarded = self.guarded(item)
        best = self.best
        if best is not None:
            best_all, best_eligible = best.edges(key)
        total = allowed_total = 0
        kept = []
        allowed: list[Entry] = []
        marked = marks.get(item) if marks is not None else None
        witnessed = self.witnessed
        w_all = w_allowed = False
        edges = len(self.forest.edges[item])
        for index, edge_kind, pred_key, child_key, a, b in self.steps(key):
            to_all = True
            to_allowed = guarded and self.permits(item, edge_kind, a)
            if best is not None:
                to_all = index in best_all
                to_allowed = to_allowed and index in best_eligible
            # Faults of the check skip the first of two or more edges, in the
            # count or in the candidates (tests/README.md). Python's agenda
            # completes the restoring sibling first.
            sibling = self.check and edges > 1 and index == 0
            counted = not (sibling and _testing.fault("lost:context"))
            selected = not (sibling and _testing.fault("lost:select"))
            produced: list[Entry] = []
            if edge_kind == 0:
                ways = 1
                if self.entries:
                    produced.append(Entry(None, [], INF))
            elif edge_kind == RESTORE:
                # A restoration reads its synthetic token, and its own close
                # follows (engine §7.4, §7.7).
                ways = 1
                if self.entries:
                    produced.append(Entry(self.read_leaf(a, b), [], INF))
            else:
                assert pred_key is not None
                earlier = memo[pred_key][1 if self.eligible_before(edge_kind, a) else 0]
                if not self.entries:
                    ways = earlier * (memo[child_key] if edge_kind == 2 else 1)
                elif edge_kind == 1:
                    pred_entries, ways = earlier
                    read = self.read_leaf(a, b)
                    for entry in pred_entries:
                        produced.append(self.extend(entry, read))
                else:
                    pred_entries, pred_count = earlier
                    child_entries, child_count = memo[child_key]
                    ways = pred_count * child_count
                    for before in pred_entries:
                        for after in child_entries:
                            produced.append(self.combine(before, after))
            if marked is not None and ways > 0 and index in marked and counted:
                # The edge is W(D)'s where it is marked, and its predecessor
                # and child are W(D)'s.
                edge_w = True
                if pred_key is not None:
                    edge_w = witnessed[pred_key][1 if self.eligible_before(edge_kind, a) else 0]
                if edge_w and child_key is not None and edge_kind == 2:
                    edge_w = witnessed[child_key][0]
                w_all = w_all or (to_all and edge_w)
                w_allowed = w_allowed or (to_allowed and edge_w)
            if not counted:
                ways = 0
            if to_all:
                total += ways
            if to_allowed:
                allowed_total += ways
            if not selected:
                produced = []
            for entry in produced:
                if to_allowed:
                    # Candidates are settled in place, so the second list
                    # keeps copies of its own.
                    self.keep(allowed, Entry(entry.seq, list(entry.alts), entry.at))
                if to_all:
                    self.keep(kept, entry)
        total = min(total, 2)
        value = (kept, total) if self.entries else total
        if marks is not None:
            witnessed[key] = (w_all, w_allowed if guarded else w_all)
        if not guarded:
            return (value, value)
        allowed_total = min(allowed_total, 2)
        return (value, (allowed, allowed_total) if self.entries else allowed_total)

    def extend(self, entry: Entry, rope: Rope) -> Entry:
        result = Entry(concat(entry.seq, rope), [], INF)
        for alt in entry.alts:
            self.offer(result, concat(alt, rope), entry.at)
        return result

    def combine(self, before: Entry, after: Entry) -> Entry:
        result = Entry(concat(before.seq, after.seq), [], INF)
        for alt in before.alts:
            self.offer(result, concat(alt, after.seq), before.at)
        if after.alts:
            at = INF if after.at >= INF else vis(before.seq) + after.at
            for alt in after.alts:
                self.offer(result, concat(before.seq, alt), at)
        return result

    def offer(self, entry: Entry, alt: Rope | None, at: Count) -> None:
        """Add a tied derivation to an entry's, keeping the earliest-diverging,
        and of those the T-least of any two whose order is
        settled."""
        if not entry.alts or at < entry.at:
            entry.alts = [alt]
            entry.at = at
            return
        if at > entry.at:
            return
        kept: list[Alt] = []
        pending = True
        for other in entry.alts:
            if not pending:
                kept.append(other)
                continue
            comparison = compare(other, alt, self.lean)
            if not comparison.settled:
                kept.append(other)
            elif comparison.order <= 0:
                kept.append(other)
                pending = False
        if pending:
            kept.append(alt)
        entry.alts = kept

    def keep(self, kept: list[Entry], new: Entry) -> None:
        """Add a candidate to a list of candidates whose order is not yet
        settled, settling it against each where it can be."""
        index = 0
        while index < len(kept):
            other = kept[index]
            comparison = compare(new.seq, other.seq, self.lean)
            if not comparison.settled:
                index += 1
                continue
            if comparison.order < 0:
                self.absorb(new, other, comparison)
                del kept[index]
                continue
            self.absorb(other, new, comparison)
            return
        kept.append(new)

    def absorb(self, winner: Entry, loser: Entry, comparison: Comparison) -> None:
        """The winner takes over what of the loser is tied with it: the loser
        itself, if the two are tied, and the loser's tied derivations that
        diverge from it before the two do."""
        point = comparison.index
        if point >= INF:
            self.offer(winner, loser.seq, INF)
            for alt in loser.alts:
                self.offer(winner, alt, loser.at)
            return
        if not comparison.decisive:
            # The loser is tied with the winner here, and precedes in T every
            # derivation tied with it that diverges from it here or later.
            self.offer(winner, loser.seq, point)
        if loser.at < point:
            for alt in loser.alts:
                self.offer(winner, alt, loser.at)

    # -- the whole input

    def count(self, roots: list[int]) -> list[int]:
        """The number of derivations of each root, up to two."""
        results: list[int] = []
        for root in roots:
            key = self.full_key(root, self.empty)
            if key is None:
                results.append(0)
                continue
            value = self.solve(key)
            results.append(value[1] if self.entries else value)
        return results

    def rank(self, roots: list[int]) -> Ranking | None:
        """The first reading, the verdict, the second reading and the
        witness; ``None`` if the input has no derivation. The root combines
        the derivations of every root item (engine §6)."""
        total = 0
        kept: list[Entry] = []
        counted = False
        for root in roots:
            key = self.full_key(root, self.empty)
            if key is None:
                continue
            entries, count = self.solve(key)
            total += count
            if self.marks is not None:
                counted = counted or (count > 0 and self.witnessed[key][0])
            for entry in entries:
                self.keep(kept, Entry(entry.seq, list(entry.alts), entry.at))
        if total == 0 or not kept:
            return None
        first = kept[0]
        for entry in kept[1:]:
            if compare(entry.seq, first.seq, self.lean).order < 0:
                first = entry
        counted_w = counted if self.marks is not None else None
        if total == 1:
            return Ranking("unique", first.seq, None, None, counted_w)
        # Every other candidate's visible sequence extends the first one's,
        # so it first differs from it visibly where the first one ends, and
        # so do its tied derivations that diverge from it no earlier.
        length = vis(first.seq)
        candidates: list[tuple[Count, Rope | None]] = [(first.at, alt) for alt in first.alts]
        for entry in kept:
            if entry is first:
                continue
            candidates.append((length, entry.seq))
            candidates.extend((entry.at if entry.at < length else length, alt) for alt in entry.alts)
        if not candidates:
            return Ranking("resolved", first.seq, None, None, counted_w)
        best_at, second = candidates[0]
        for at, rope in candidates[1:]:
            if at < best_at or (at == best_at and compare(rope, second, self.lean).order < 0):
                best_at, second = at, rope
        difference = first_difference(first.seq, second, True)
        if difference is None or difference[1] is None or difference[2] is None:
            difference = first_difference(first.seq, second, False)
        assert difference is not None
        witness = (difference[1], difference[2])
        return Ranking("tie", first.seq, second, witness, counted_w)


class Elided:
    """A non-empty sequence of elisions: the positions of a derivation's
    elided terminators, in text order, with one entry for each terminator.
    It is one elision, a leaf, or two sequences joined. A sequence built on
    another shares it, so an edge adds one node and copies nothing. Each
    node knows its size, an exact integer, and its first and last
    positions. A node whose first and last positions are equal is a run:
    all its elisions stand at one position."""

    __slots__ = ("size", "first", "last", "left", "right")

    def __init__(self, size: int, first: int, last: int, left: Elided | None = None, right: Elided | None = None) -> None:
        self.size = size
        self.first = first
        self.last = last
        self.left = left
        self.right = right


Vector = Optional[Elided]
"""An elision vector (engine §6): its sequence of elisions, or ``None``
for a derivation that elides nothing. The count at a boundary is the
number of elisions at that position."""


def join(left: Vector, right: Vector) -> Vector:
    """The sum of the vectors of an edge's two children. Every position of
    the item before the step precedes every position of the child, so the
    sum is the two sequences joined."""
    if left is None:
        return right
    if right is None:
        return left
    return Elided(left.size + right.size, left.first, right.last, left, right)


def compare_vectors(left: Vector, right: Vector) -> int:
    """-1 when the left vector is less, 1 when the right one is, 0 when they
    are equal (engine §6). Two sequences compare at their first differing
    elision. There, the one at the earlier position has the greater count
    at that position, so the later position is less. A sequence that ends
    first has fewer elisions after the shared part, so it is less.

    The comparison takes a run whole and counts how much of the run at the
    front of each side it has taken. So it never walks the elisions of a
    run one by one, and it skips a part that both sides share at the same
    point."""
    a: list[Elided] = [left] if left is not None else []
    b: list[Elided] = [right] if right is not None else []
    taken_a = taken_b = 0
    while True:
        if not a or not b:
            return 0 if not a and not b else (-1 if not a else 1)
        x, y = a[-1], b[-1]
        if x is y and taken_a == taken_b:
            a.pop()
            b.pop()
            taken_a = taken_b = 0
            continue
        x_run = x.first == x.last
        y_run = y.first == y.last
        if not x_run or not y_run:
            # Descend the larger side first, so that a part both share is
            # met at the front of both. Only a node that is no run is
            # descended, and nothing of it has been taken.
            descend_a = not x_run and (y_run or x.size >= y.size)
            descend_b = not y_run and (x_run or y.size >= x.size)
            if descend_a:
                a.pop()
                a.append(x.right)  # type: ignore[arg-type]
                a.append(x.left)  # type: ignore[arg-type]
            if descend_b:
                b.pop()
                b.append(y.right)  # type: ignore[arg-type]
                b.append(y.left)  # type: ignore[arg-type]
            continue
        if x.first != y.first:
            return -1 if x.first > y.first else 1
        rest_a = x.size - taken_a
        rest_b = y.size - taken_b
        if rest_a < rest_b:
            a.pop()
            taken_a = 0
            taken_b += rest_a
        elif rest_b < rest_a:
            b.pop()
            taken_b = 0
            taken_a += rest_b
        else:
            a.pop()
            b.pop()
            taken_a = taken_b = 0


class Summary:
    """The derivations of one item in one context under ``late-elision``
    (engine §6): their total, capped at two; their least vector; the least
    count, the number of derivations with that vector, capped at two; and
    the indices of the edges that attain it."""

    __slots__ = ("total", "vector", "count", "edges")

    def __init__(self, total: int, vector: Vector, count: int, edges: frozenset[int]) -> None:
        self.total = total
        self.vector = vector
        self.count = count
        self.edges = edges


class Least:
    """A summary being built over the edges of an item."""

    __slots__ = ("total", "found", "vector", "count", "edges")

    def __init__(self) -> None:
        self.total = 0
        self.found = False
        self.vector: Vector = None
        self.count = 0
        self.edges: list[int] = []

    def offer(self, index: int, total: int, vector: Vector, count: int) -> None:
        # Every edge adds to the total, losing ones included.
        self.total += total
        order = compare_vectors(vector, self.vector) if self.found else -1
        if order < 0:
            self.found = True
            self.vector, self.count, self.edges = vector, count, [index]
        elif order == 0:
            self.count += count
            self.edges.append(index)

    def summary(self) -> Summary | None:
        if not self.found:
            return None
        return Summary(min(self.total, 2), self.vector, min(self.count, 2), frozenset(self.edges))


NO_EDGES: frozenset[int] = frozenset()


class Elisions(Summaries):
    """The ranking of ``late-elision`` (engine §6). Each summary holds the
    total of its derivations, their least elision vector and the least
    count. Vectors add over an edge, so a best derivation is made of best
    derivations of its children in their own contexts. The edges that
    attain each least vector form the forest of the best derivations, and a
    ranking with no lean over it gives the two readings."""

    def __init__(self, forest: Forest, maximal: Maximal | None = None) -> None:
        super().__init__(forest, maximal)
        # The helpers of the elidable optionals: an empty production of one
        # is an elided terminator (engine §3.8, §6).
        self.elided = [
            production.helper and production.elided is not None and not production.rhs for production in self.productions
        ]
        # The one sequence of a single elision at each position.
        self.leaves: dict[int, Elided] = {}

    def compute(self, key: Key) -> Any:
        """A full key's summary, or ``None`` with no derivation; a partial
        key's pair of them, over all its derivations and its eligible ones."""
        kind, item, _ = key
        forest = self.forest
        memo = self.memo
        if kind == 0:
            inner = memo[self.inner_key(key)][0]
            # A restoration elides nothing (engine §7.7).
            if inner is None or not self.elided[forest.prod[item]] or forest.edges[item][0][1] == RESTORE:
                return inner
            # An elided terminator counts one at its position.
            at = forest.origin[item]
            unit = self.leaves.get(at)
            if unit is None:
                unit = self.leaves[at] = Elided(1, at, at)
            return Summary(inner.total, join(inner.vector, unit), inner.count, NO_EDGES)
        guarded = self.guarded(item)
        every = Least()
        eligible = Least()
        for index, edge_kind, pred_key, child_key, a, _ in self.steps(key):
            if edge_kind == 0 or edge_kind == RESTORE:
                total, vector, count = 1, None, 1
            else:
                assert pred_key is not None
                before: Summary | None = memo[pred_key][1 if self.eligible_before(edge_kind, a) else 0]
                if before is None:
                    continue
                total, vector, count = before.total, before.vector, before.count
                if edge_kind == 2:
                    child: Summary | None = memo[child_key]
                    if child is None:
                        continue
                    total = min(total * child.total, 2)
                    vector = join(vector, child.vector)
                    count = min(count * child.count, 2)
            every.offer(index, total, vector, count)
            if guarded and self.permits(item, edge_kind, a):
                eligible.offer(index, total, vector, count)
        summary = every.summary()
        return (summary, eligible.summary() if guarded else summary)

    def edges(self, key: Key) -> tuple[frozenset[int], frozenset[int]]:
        """The edges of a partial key that attain its least vectors, over all
        its derivations and over its eligible ones."""
        every, eligible = self.memo[key]
        return (every.edges if every is not None else NO_EDGES, eligible.edges if eligible is not None else NO_EDGES)

    def kept(self, key: Key) -> frozenset[int]:
        """The edges of a partial key in the forest of the best derivations."""
        every, eligible = self.edges(key)
        return every | eligible

    def rank(self, roots: list[int]) -> Ranking | None:
        """The verdict from the totals and least counts, and the readings
        from a ranking with no lean over the best derivations; ``None`` if
        the input has no derivation. The root combines its items as a
        summary combines its edges (engine §6)."""
        roots_least = Least()
        for root in roots:
            key = self.full_key(root, self.empty)
            if key is None:
                continue
            summary: Summary | None = self.solve(key)
            if summary is None:
                continue
            # The root combines its items as a summary combines its edges.
            roots_least.offer(root, summary.total, summary.vector, summary.count)
        if not roots_least.found:
            return None
        total = roots_least.total
        count = roots_least.count
        best = roots_least.edges
        readings = Ranker(self.forest, "none", self.maximal, best=self).rank(best)
        # The least count says whether the best forest holds a second
        # derivation, and the ranking with no lean over it finds one exactly
        # then. A disagreement is a defect of the library, never a verdict.
        if readings is None or (readings.verdict == "tie") != (count > 1):
            raise RuntimeError("internal error: the least count of late-elision disagrees with its forest of best derivations")
        if total == 1:
            return Ranking("unique", readings.first, None, None)
        if count == 1:
            return Ranking("resolved", readings.first, None, None)
        return readings


class Ranking:
    """The outcome of a ranking (engine §6): its verdict, its first reading
    ``m``, and for a tie its second reading ``t`` and the witness, the pair
    of actions where the two first differ. ``witness_counted``, with the
    witness hook's marks, says whether the count counted W(D)
    (tests/README.md); ``None`` without marks."""

    __slots__ = ("verdict", "first", "second", "witness", "witness_counted")

    def __init__(
        self,
        verdict: str,
        first: Rope | None,
        second: Rope | None,
        witness: tuple[Act | None, Act | None] | None,
        witness_counted: bool | None = None,
    ) -> None:
        self.verdict = verdict
        self.first = first
        self.second = second
        self.witness = witness
        self.witness_counted = witness_counted


def rank(forest: Forest, lean: str, maximal: Maximal | None = None) -> Ranking | None:
    """Rank a forest's derivations by a rule of the ranking, ``greedy``,
    ``lazy`` or ``late-elision``, or by no lean, ``none``; ``None`` if the
    input has no derivation that counts."""
    if not forest.roots:
        return None
    if lean == "late-elision":
        return Elisions(forest, maximal).rank(forest.roots)
    return Ranker(forest, lean, maximal).rank(forest.roots)


def count_roots(forest: Forest, roots: list[int]) -> list[int]:
    """The number of derivations, up to two, of each of a forest's roots."""
    return Ranker(forest, "greedy", entries=False).count(roots)
