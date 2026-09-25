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

from typing import Any, Iterator, Optional

from ._earley import Forest
from ._maximal import Maximal

INF = 1 << 60


class Act:
    """An action: a read of a token as a terminal, or a close of an item."""

    __slots__ = ("read", "token", "terminal", "weak", "item", "production", "start", "end", "visible", "eq", "canon")

    def __init__(
        self,
        read: bool,
        token: int = -1,
        terminal: str = "",
        weak: bool = False,
        item: int = -1,
        production: int = -1,
        start: int = 0,
        end: int = 0,
        visible: bool = True,
    ) -> None:
        self.read = read
        self.token = token
        self.terminal = terminal
        self.weak = weak
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
    elision-only's check, which uses rule 1 alone."""
    if x.read and y.read:
        if x.weak == y.weak:
            return 0
        return 1 if x.weak else -1
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

    def __init__(self, settled: bool, order: int, index: int, decisive: bool, x: Act | None = None, y: Act | None = None) -> None:
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


Alt = tuple[Optional[Rope], int]
"""A tied derivation, and the class of its action where it diverges: in
elision-only's ranking, 1 for a close and 0 for a read; otherwise 0."""


class Entry:
    """A candidate: a derivation ``seq``, and the derivations tied with it that
    diverge from it earliest, ``alts``, after ``at`` visible actions (INF for
    those that differ from it only in transparent actions)."""

    __slots__ = ("seq", "alts", "at")

    def __init__(self, seq: Rope | None, alts: list[Alt], at: int) -> None:
        self.seq = seq
        self.alts = alts
        self.at = at


class Ranker:
    """Ranks a forest's derivations, or only counts them (up to two).
    ``maximal`` is the resolution's maximal, if it has it (engine §4)."""

    def __init__(self, forest: Forest, lean: str, maximal: Maximal | None = None, entries: bool = True) -> None:
        self.forest = forest
        self.lean = lean
        self.maximal = maximal
        self.entries = entries
        self.productions = forest.lowered.productions
        self.memo: dict[tuple[Any, ...], Any] = {}
        self.edge_keys: dict[tuple[Any, ...], list[tuple[Any, ...]]] = {}
        self.sensitive_memo: dict[int, bool] = {}
        self.read_leaves: dict[tuple[int, str], Rope] = {}
        self.close_leaves: dict[int, Rope] = {}
        self.empty: frozenset[int] = frozenset()

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

    def full_key(self, item: int, forbidden: frozenset[int]) -> tuple[Any, ...] | None:
        if self.rule(item) in forbidden:
            return None
        return (0, item, forbidden if forbidden and self.sensitive(item) else self.empty)

    def partial_key(self, item: int, forbidden: frozenset[int]) -> tuple[Any, ...]:
        return (1, item, forbidden if forbidden and self.sensitive(item) else self.empty)

    def dependencies(self, key: tuple[Any, ...]) -> list[tuple[Any, ...]]:
        found = self.edge_keys.get(key)
        if found is not None:
            return found
        kind, item, context = key
        forest = self.forest
        result: list[tuple[Any, ...]] = []
        if kind == 0:
            result.append(self.partial_key(item, context | {self.rule(item)}))
        else:
            start, end = forest.origin[item], forest.end[item]
            for pred, edge_kind, a, _ in forest.edges[item]:
                if edge_kind == 0:
                    continue
                result.append(self.partial_key(pred, context if forest.end[pred] == end else self.empty))
                if edge_kind == 2:
                    child = self.full_key(a, context if forest.origin[a] == start else self.empty)
                    if child is not None:
                        result.append(child)
        self.edge_keys[key] = result
        return result

    def solve(self, key: tuple[Any, ...]) -> Any:
        memo = self.memo
        if key in memo:
            return memo[key]
        # Each key is visited twice: once to push what it needs, once to be
        # computed when that is known.
        stack: list[tuple[tuple[Any, ...], bool]] = [(key, False)]
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

    # -- composition

    def read_leaf(self, token: int, terminal: str) -> Rope:
        found = self.read_leaves.get((token, terminal))
        if found is None:
            weak = self.forest.tokens[token].tags.get(terminal) is False
            found = leaf(Act(True, token=token, terminal=terminal, weak=weak))
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

    def compute(self, key: tuple[Any, ...]) -> Any:
        """A key's value: the candidates and the number of derivations, or
        the number alone when only counting. A partial key has two, as a
        pair: over all its item's derivations, and over those an elided
        terminator may follow."""
        kind, item, context = key
        deps = self.dependencies(key)
        memo = self.memo
        if kind == 0:
            inner = memo[deps[0]][0]
            if not self.entries:
                return inner
            entries, count = inner
            close = self.close_leaf(item)
            kept: list[Entry] = []
            for entry in entries:
                self.keep(kept, self.extend(entry, close))
            return (kept, count)
        # Under maximal (engine §4, §6), an item whose next symbol is an
        # elidable optional takes its second value from only the ways of
        # building it whose last symbol's node maximal does not forbid; for
        # any other item the two are one. An elided terminator's edge takes
        # the second value of the item before it.
        forest = self.forest
        maximal = self.maximal
        guarded = maximal is not None and maximal.guards(item)
        start = forest.origin[item]
        total = allowed_total = 0
        kept = []
        allowed: list[Entry] = []
        position = 0
        for pred, edge_kind, a, b in forest.edges[item]:
            permitted = True
            produced: list[Entry] = []
            if edge_kind == 0:
                ways = 1
                if self.entries:
                    produced.append(Entry(None, [], INF))
            else:
                pred_value = memo[deps[position]]
                position += 1
                earlier = pred_value[0]
                child_value: Any = None
                if edge_kind == 2:
                    child_key = self.full_key(a, context if forest.origin[a] == start else self.empty)
                    if child_key is None:
                        continue
                    child_value = memo[deps[position]]
                    position += 1
                    if maximal is not None:
                        if maximal.elided(a):
                            earlier = pred_value[1]
                        permitted = not (guarded and maximal.forbids(a))
                if not self.entries:
                    ways = earlier * (1 if child_value is None else child_value)
                elif edge_kind == 1:
                    pred_entries, ways = earlier
                    read = self.read_leaf(a, b)
                    for entry in pred_entries:
                        produced.append(self.extend(entry, read))
                else:
                    pred_entries, pred_count = earlier
                    child_entries, child_count = child_value
                    ways = pred_count * child_count
                    for before in pred_entries:
                        for after in child_entries:
                            produced.append(self.combine(before, after))
            total += ways
            if guarded and permitted:
                allowed_total += ways
            for entry in produced:
                if guarded and permitted:
                    # Candidates are settled in place, so the second list
                    # keeps copies of its own.
                    self.keep(allowed, Entry(entry.seq, list(entry.alts), entry.at))
                self.keep(kept, entry)
        total = min(total, 2)
        value = (kept, total) if self.entries else total
        if not guarded:
            return (value, value)
        allowed_total = min(allowed_total, 2)
        return (value, (allowed, allowed_total) if self.entries else allowed_total)

    def extend(self, entry: Entry, rope: Rope) -> Entry:
        result = Entry(concat(entry.seq, rope), [], INF)
        for alt, kind in entry.alts:
            self.offer(result, concat(alt, rope), entry.at, kind)
        return result

    def combine(self, before: Entry, after: Entry) -> Entry:
        result = Entry(concat(before.seq, after.seq), [], INF)
        for alt, kind in before.alts:
            self.offer(result, concat(alt, after.seq), before.at, kind)
        if after.alts:
            at = INF if after.at >= INF else vis(before.seq) + after.at
            for alt, kind in after.alts:
                self.offer(result, concat(before.seq, alt), at, kind)
        return result

    def kind(self, act: Act | None) -> int:
        return 1 if self.lean == "none" and act is not None and not act.read else 0

    def offer(self, entry: Entry, alt: Rope | None, at: int, kind: int = 0) -> None:
        """Add a tied derivation to an entry's, keeping the earliest-diverging,
        and of those the T-least of any two of one kind whose order is
        settled."""
        if not entry.alts or at < entry.at:
            entry.alts = [(alt, kind)]
            entry.at = at
            return
        if at > entry.at:
            return
        kept: list[Alt] = []
        pending = True
        for other, other_kind in entry.alts:
            if not pending or other_kind != kind:
                kept.append((other, other_kind))
                continue
            comparison = compare(other, alt, self.lean)
            if not comparison.settled:
                kept.append((other, other_kind))
            elif comparison.order <= 0:
                kept.append((other, other_kind))
                pending = False
        if pending:
            kept.append((alt, kind))
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
                self.absorb(new, other, comparison, comparison.y)
                del kept[index]
                continue
            self.absorb(other, new, comparison, comparison.x)
            return
        kept.append(new)

    def absorb(self, winner: Entry, loser: Entry, comparison: Comparison, lost: Act | None) -> None:
        """The winner takes over what of the loser is tied with it: the loser
        itself, if the two are tied, and the loser's tied derivations that
        diverge from it before the two do."""
        point = comparison.index
        if point >= INF:
            self.offer(winner, loser.seq, INF)
            for alt, kind in loser.alts:
                self.offer(winner, alt, loser.at, kind)
            return
        if not comparison.decisive:
            # The loser is tied with the winner here, and precedes in T every
            # derivation tied with it that diverges from it here or later.
            self.offer(winner, loser.seq, point, self.kind(lost))
        if loser.at < point:
            for alt, kind in loser.alts:
                self.offer(winner, alt, loser.at, kind)
        elif loser.at == point and comparison.decisive and self.lean == "none":
            # With rule 1 alone, ties are not transitive: a close is tied with
            # a weak read and with a strong one, which beats the weak one. So
            # a derivation that closes where the loser reads weakly and the
            # winner strongly is still tied with the winner there; that is
            # why tied derivations are kept by the kind of action they
            # diverge with.
            for alt, kind in loser.alts:
                if kind == 1:
                    self.offer(winner, alt, point, kind)

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
        """The chosen derivation, the verdict, the tied derivation and the
        witness; ``None`` if the input has no derivation."""
        total = 0
        kept: list[Entry] = []
        for root in roots:
            key = self.full_key(root, self.empty)
            if key is None:
                continue
            entries, count = self.solve(key)
            total += count
            for entry in entries:
                self.keep(kept, Entry(entry.seq, list(entry.alts), entry.at))
        if total == 0 or not kept:
            return None
        chosen = kept[0]
        for entry in kept[1:]:
            if compare(entry.seq, chosen.seq, self.lean).order < 0:
                chosen = entry
        if total == 1:
            return Ranking("unique", chosen.seq, None, None)
        # Every other candidate's visible sequence extends the chosen one's,
        # so it first differs from it visibly where the chosen one ends, and
        # so do its tied derivations that diverge from it no earlier.
        length = vis(chosen.seq)
        candidates: list[tuple[int, Rope | None]] = [(chosen.at, alt) for alt, _ in chosen.alts]
        for entry in kept:
            if entry is chosen:
                continue
            candidates.append((length, entry.seq))
            candidates.extend((entry.at if entry.at < length else length, alt) for alt, _ in entry.alts)
        if not candidates:
            return Ranking("resolved", chosen.seq, None, None)
        best_at, best = candidates[0]
        for at, rope in candidates[1:]:
            if at < best_at or (at == best_at and compare(rope, best, self.lean).order < 0):
                best_at, best = at, rope
        difference = first_difference(chosen.seq, best, True)
        if difference is None or difference[1] is None or difference[2] is None:
            difference = first_difference(chosen.seq, best, False)
        assert difference is not None
        witness = (difference[1], difference[2])
        return Ranking("tie", chosen.seq, best, witness)


class Ranking:
    __slots__ = ("verdict", "chosen", "tied", "witness")

    def __init__(self, verdict: str, chosen: Rope | None, tied: Rope | None, witness: tuple[Act | None, Act | None] | None) -> None:
        self.verdict = verdict
        self.chosen = chosen
        self.tied = tied
        self.witness = witness


def count_roots(forest: Forest, roots: list[int]) -> list[int]:
    """The number of derivations, up to two, of each of a forest's roots."""
    return Ranker(forest, "greedy", entries=False).count(roots)
