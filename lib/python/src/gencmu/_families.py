"""Written close families and witness group summaries (engine §2.2, §4.1)."""

from __future__ import annotations

from dataclasses import dataclass
from . import _testing
from ._closes import Block, CloseMachine


def members(rules: dict, families: list[str]) -> dict[str, frozenset[str]]:
    """Follow only single-reference paths in the final written rules."""
    if not families:
        return {}
    edges = {}
    for name, rule in rules.items():
        targets = []
        pending = [alternative.expr for alternative in reversed(rule.alternatives)]
        while pending:
            expr = pending.pop()
            if "ref" in expr:
                if expr["ref"] in rules:
                    targets.append(expr["ref"])
            elif "capture" in expr or "test" in expr:
                pending.append(expr["expr"])
            elif "choice" in expr:
                pending.extend(reversed(expr["choice"]))
        edges[name] = targets
    found = {}
    for family in families:
        queue, seen = [family], {family}
        for name in queue:
            for target in edges[name]:
                if target not in seen:
                    seen.add(target)
                    queue.append(target)
        found[family] = frozenset(seen)
    return found


@dataclass(frozen=True, slots=True)
class Summary:
    """Boundary state sets, or an empty span's state relation."""

    before: int = 0
    after: int = 0
    empty: bool = False
    relation: tuple[int, ...] | None = None
    dead: bool = False


DEAD = Summary(dead=True)
IDENTITY = Summary(empty=True)


class FamilyMatcher:
    """Compare one fixed candidate without retaining witness permission marks."""

    def __init__(self, closes: CloseMachine, observation: int, start: int, end: int, permitted: frozenset[str]):
        self.closes = closes
        self.observation = observation
        self.start = start
        self.end = end
        self.permitted = permitted
        groups: dict[int, list[tuple]] = {}
        for event in closes.events(closes.states[observation].sequence):
            boundary = event.start if isinstance(event, Block) else event.at
            groups.setdefault(boundary, []).append(closes.identity(event))
        self.groups = {boundary: tuple(records) for boundary, records in groups.items()}
        self.records: dict[tuple, Summary] = {}
        self.tokens: dict[int, Summary] = {}
        self.joins: dict[tuple[Summary, Summary], Summary] = {}
        self.taken: set[Summary] = set()

    def size(self, boundary: int) -> int:
        return 2 * (len(self.groups.get(boundary, ())) + 1)

    def accepting(self, boundary: int, final: bool = False) -> int:
        if boundary > self.end:
            return 3
        records = self.groups.get(boundary, ())
        count = len(records)
        if final or boundary == self.end:
            if records and records[-1][0] == "block" and records[-1][1].end > boundary:
                count -= 1
            return 1 << (2 * count)
        return 3 << (2 * count)

    def take(self, summary: Summary) -> None:
        """Count a distinct summary only after an item takes it."""
        if summary not in self.taken:
            self.taken.add(summary)
            _testing.count("family_summaries")

    @staticmethod
    def image(relation: tuple[int, ...] | None, states: int) -> int:
        if relation is None:
            return states
        _testing.count("family_steps", len(relation))
        result = 0
        for index, row in enumerate(relation):
            if states & (1 << index):
                result |= row
        return result

    @staticmethod
    def preimage(relation: tuple[int, ...] | None, states: int) -> int:
        if relation is None:
            return states
        _testing.count("family_steps", len(relation))
        result = 0
        for index, row in enumerate(relation):
            if row & states:
                result |= 1 << index
        return result

    def record(self, identity: tuple, boundary: int, permitted: bool = False) -> Summary:
        if boundary > self.end:
            return IDENTITY
        key = identity, boundary, permitted
        found = self.records.get(key)
        if found is not None:
            return found
        records = self.groups.get(boundary, ())
        rows = []
        _testing.count("family_steps", self.size(boundary))
        for matched in range(len(records) + 1):
            target = 0
            if matched < len(records) and records[matched] == identity:
                target |= 1 << (2 * (matched + 1))
            if permitted and (matched or boundary > self.start):
                target |= 1 << (2 * matched + 1)
            rows.extend((target, target))
        found = Summary(empty=True, relation=tuple(rows)) if any(rows) else DEAD
        self.records[key] = found
        return found

    def close(self, terminal: str, boundary: int, owner: str | None) -> Summary:
        return self.record(("close", terminal, boundary), boundary, owner in self.permitted)

    def token(self, boundary: int) -> Summary:
        found = self.tokens.get(boundary)
        if found is None:
            found = self.tokens[boundary] = Summary(self.accepting(boundary), 1)
        return found

    def block(self, block: Block) -> Summary:
        if block.start < self.end < block.end:
            return DEAD
        if block.start == self.end and block.end > block.start:
            record = IDENTITY
        else:
            record = self.record(("block", block), block.start)
        if block.start == block.end or record.dead:
            return record
        before = self.preimage(record.relation, self.accepting(block.start))
        return Summary(before, 1) if before else DEAD

    def join(self, left: Summary, right: Summary) -> Summary:
        key = left, right
        found = self.joins.get(key)
        if found is not None:
            return found
        if left.dead or right.dead:
            found = DEAD
        elif left.empty and right.empty:
            if left.relation is None:
                found = right
            elif right.relation is None:
                found = left
            else:
                rows = tuple(self.image(right.relation, row) for row in left.relation)
                found = Summary(empty=True, relation=rows) if any(rows) else DEAD
        elif left.empty:
            before = self.preimage(left.relation, right.before)
            found = Summary(before, right.after) if before else DEAD
        elif right.empty:
            after = self.image(right.relation, left.after)
            found = Summary(left.before, after) if after else DEAD
        elif left.after & right.before:
            found = Summary(left.before, right.after)
        else:
            found = DEAD
        self.joins[key] = found
        return found

    def accepts(self, summary: Summary, endpoint: int) -> bool:
        if summary.dead:
            return False
        target = self.accepting(endpoint, True)
        if summary.empty:
            return bool(self.image(summary.relation, 1) & target)
        return bool(summary.before & 1 and (endpoint > self.end or summary.after & target))
