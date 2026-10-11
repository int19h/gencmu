"""Shared restoration observations of finite proofs (engine §4.1)."""

from dataclasses import dataclass
from typing import Any, Iterator

from . import _testing
from ._model import Restoration


@dataclass(frozen=True)
class Block:
    occurrence: tuple
    start: int
    end: int
    entry: tuple


Event = Restoration | Block
Ancestor = tuple[int, int, int]


class InvalidObservation(Exception):
    """A reached restoration observer excludes this cyclic proof."""


@dataclass(frozen=True)
class CloseState:
    sequence: int
    ancestors: frozenset[Ancestor]


@dataclass(frozen=True)
class RestoredSpan:
    """Yield ordinary start, end, and tags while retaining query constraints."""

    start: int
    end: int
    captured_end: int
    context_end: int
    observation: int

    def __iter__(self):
        return iter((self.start, self.end, None))

    def __getitem__(self, index):
        return (self.start, self.end, None)[index]


@dataclass(frozen=True)
class Link:
    left: int
    right: int
    event: Any
    size: int
    fingerprint: int


# A rope shares event leaves and concatenation nodes.
class Sequences:
    """Intern shared ropes by content, with exact comparison after hashing."""

    MASK = (1 << 64) - 1
    BASE = 0x100000001B3

    def __init__(self):
        self.nodes = [Link(0, 0, None, 0, 0)]
        self.leaves = {}
        self.joins = {}
        self.buckets = {}

    def leaf(self, event):
        old = self.leaves.get(event)
        if old is not None:
            return old
        number = len(self.nodes)
        self.nodes.append(Link(0, 0, event, 1, hash(event) & self.MASK))
        self.leaves[event] = number
        return number

    def join(self, left, right):
        if not left or not right:
            return left or right
        key = left, right
        old = self.joins.get(key)
        if old is not None:
            return old
        a, b = self.nodes[left], self.nodes[right]
        fingerprint = (a.fingerprint*pow(self.BASE, b.size, 1 << 64) + b.fingerprint) & self.MASK
        number = len(self.nodes)
        self.nodes.append(Link(left, right, None, a.size + b.size, fingerprint))
        bucket = self.buckets.setdefault((a.size + b.size, fingerprint), [])
        for other in bucket:
            if self.equal(number, other):
                self.nodes.pop()
                self.joins[key] = other
                return other
        bucket.append(number)
        self.joins[key] = number
        return number

    def equal(self, left, right):
        a, b = [left], [right]
        while a and b:
            x, y = a[-1], b[-1]
            if x == y:
                a.pop()
                b.pop()
                continue
            first, last = self.nodes[x], self.nodes[y]
            if first.event is not None and last.event is not None:
                if first.event != last.event:
                    return False
                a.pop()
                b.pop()
                continue
            if first.event is None and (last.event is not None or first.size >= last.size):
                a.pop()
                a.extend((first.right, first.left))
            if last.event is None and (first.event is not None or last.size >= first.size):
                b.pop()
                b.extend((last.right, last.left))
        return not a and not b

    def events(self, sequence):
        pending = [sequence] if sequence else []
        while pending:
            node = self.nodes[pending.pop()]
            if node.event is not None:
                yield node.event
            else:
                pending.extend((node.right, node.left))


class CloseMachine:
    """Share close sequences and bounded state keys, without full lists."""

    INVALID = 1

    def __init__(self):
        # Actual records retain sound and source. Semantic links ignore both.
        self.sequences = Sequences()
        self.identities = Sequences()
        self.links = self.sequences.nodes
        self.semantic_links = self.identities.nodes
        self.semantic_by_sequence = {0:0}
        self.states = [CloseState(0, frozenset()), CloseState(0, frozenset())]
        self.state_ids = {self.states[0]: 0}
        self.concatenations: dict[tuple[int, int], int] = {}

    def semantic(self, state: int) -> int:
        return self.semantic_by_sequence[self.states[state].sequence]

    def intern(self, sequence: int, ancestors: frozenset[Ancestor]) -> int:
        value = CloseState(sequence, ancestors)
        found = self.state_ids.get(value)
        if found is None:
            found = len(self.states)
            self.state_ids[value] = found
            self.states.append(value)
            _testing.count("close_observation_states")
        return found

    def append(self, sequence: int, event: Event) -> int:
        leaf = self.sequences.leaf(event)
        identity = self.identity(event)
        self.semantic_by_sequence[leaf] = self.identities.leaf(identity)
        found = self.sequences.join(sequence, leaf)
        self.semantic_by_sequence[found] = self.identities.join(self.semantic_by_sequence[sequence], self.semantic_by_sequence[leaf])
        return found

    @staticmethod
    def identity(event):
        return ("close", event.terminal, event.at) if isinstance(event, Restoration) else ("block", event)

    def events(self, sequence: int) -> Iterator[Event]:
        yield from self.sequences.events(sequence)

    def event(self, event: Event) -> int:
        return self.intern(self.append(0, event), frozenset())

    def concat(self, left: int, right: int) -> int:
        if left == self.INVALID or right == self.INVALID:
            return self.INVALID
        key = left, right
        old = self.concatenations.get(key)
        if old is not None:
            return old
        a, b = self.states[left], self.states[right]
        sequence = self.sequences.join(a.sequence, b.sequence)
        self.semantic_by_sequence[sequence] = self.identities.join(self.semantic(left), self.semantic(right))
        result = self.intern(sequence, a.ancestors | b.ancestors)
        self.concatenations[key] = result
        return result

    def trim(self, state: int, start: int, end: int) -> int:
        if state == self.INVALID:
            return state
        old = self.states[state]
        ancestors = frozenset(pair for pair in old.ancestors if pair[1:] == (start, end))
        return self.intern(old.sequence, ancestors)

    def complete(self, state: int, rule: int, start: int, end: int) -> int:
        state = self.trim(state, start, end)
        if state == self.INVALID:
            return state
        old = self.states[state]
        pair = rule, start, end
        if pair in old.ancestors:
            return self.INVALID
        return self.intern(old.sequence, old.ancestors | {pair})

    def seal(self, state: int, block: Block) -> int:
        if state == self.INVALID:
            return state
        return self.intern(self.append(0, block), self.states[state].ancestors)

    def through(self, state: int, endpoint: int) -> int | None:
        """Compare complete boundary groups and retain zero-width blocks."""
        if state == self.INVALID:
            return None
        semantic = 0
        for event in self.events(self.states[state].sequence):
            if isinstance(event, Restoration):
                if event.at > endpoint:
                    continue
                identity = "close", event.terminal, event.at
            else:
                if event.start < endpoint < event.end:
                    return None
                if event.end > endpoint:
                    continue
                identity = "block", event
            semantic = self.identities.join(semantic, self.identities.leaf(identity))
        return semantic


def needed(lowered: Any) -> bool:
    pending = []
    for production in lowered.productions:
        pending.extend(production.conds_predict)
        pending.extend(condition for conditions in production.conds_at.values() for condition in conditions)
        pending.extend((production.tags_term, production.emit))
        if production.slot is not None:
            source = production.slot.source
            pending.extend(source.conditions)
            pending.extend((source.tags, source.rule_tags, source.emit))
    while pending:
        node = pending.pop()
        if isinstance(node, dict):
            if node.get("call") == "without-elision":
                return True
            pending.extend(node.values())
        elif isinstance(node, (list, tuple)):
            pending.extend(node)
    return False
