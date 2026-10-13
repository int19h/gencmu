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
    family: str | None = None

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
    power: int = 1
    height: int = 0


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
        _testing.count("close_sequence_nodes")
        self.nodes.append(Link(0, 0, event, 1, hash(event) & self.MASK, self.BASE & self.MASK, 1))
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
        fingerprint = (a.fingerprint*b.power + b.fingerprint) & self.MASK
        # Bounded length filters candidates, while exact nodes decide equality.
        size = (a.size + b.size) & ((1 << 64) - 1)
        number = len(self.nodes)
        _testing.count("close_sequence_nodes")
        self.nodes.append(Link(left, right, None, size, fingerprint, (a.power*b.power) & self.MASK, max(a.height,b.height)+1))
        bucket = self.buckets.setdefault((size, fingerprint), [])
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
            if first.event is None and (last.event is not None or first.height >= last.height):
                a.pop()
                a.extend((first.right, first.left))
            if last.event is None and (first.event is not None or last.height >= first.height):
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
        # Actual records retain value and source. Semantic links ignore both.
        self.sequences = Sequences()
        self.identities = Sequences()
        self.links = self.sequences.nodes
        self.semantic_links = self.identities.nodes
        self.semantic_by_sequence = {0:0}
        self.bounds = [(float("inf"), 0)]
        self.prefixes = {}
        self.states = [CloseState(0, frozenset()), CloseState(0, frozenset())]
        self.state_ids = {self.states[0]: 0}
        self.concatenations: dict[tuple[int, int], int] = {}
        self.counted_contexts: set[frozenset[Ancestor]] = set()

    def semantic(self, state: int) -> int:
        return self.semantic_by_sequence[self.states[state].sequence]

    def intern(self, sequence: int, ancestors: frozenset[Ancestor]) -> int:
        if _testing.work is not None and ancestors not in self.counted_contexts:
            self.counted_contexts.add(ancestors)
            _testing.count("cycle_contexts")
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
        sequence = self.semantic(state)
        nodes = self.identities.nodes
        while len(self.bounds) < len(nodes):
            node = nodes[len(self.bounds)]
            if node.event is None:
                a,b = self.bounds[node.left],self.bounds[node.right]
                bounds = min(a[0],b[0]),max(a[1],b[1])
            elif node.event[0] == "close":
                bounds = node.event[2],node.event[2]
            else:
                bounds = node.event[1].start,node.event[1].end
            self.bounds.append(bounds)
        pending = [sequence]
        while pending:
            at = pending[-1]
            key = at,endpoint
            if key in self.prefixes:
                pending.pop()
                continue
            low,high = self.bounds[at]
            node = nodes[at]
            if not at or low > endpoint:
                self.prefixes[key] = 0
            elif high <= endpoint:
                self.prefixes[key] = at
            elif node.event is not None:
                self.prefixes[key] = None if low < endpoint else 0
            elif (node.left,endpoint) not in self.prefixes:
                pending.append(node.left)
            elif (node.right,endpoint) not in self.prefixes:
                pending.append(node.right)
            else:
                a,b = self.prefixes[node.left,endpoint],self.prefixes[node.right,endpoint]
                self.prefixes[key] = None if a is None or b is None else self.identities.join(a,b)
        return self.prefixes[sequence,endpoint]


def needed(lowered: Any) -> frozenset[int]:
    """Find candidate and witness rules through reachable query references."""
    if lowered.close_rules is not None:
        return lowered.close_rules
    wanted = set()
    seen = set()
    rules = [lowered.rule_ids["text"]]
    while rules:
        rule = rules.pop()
        if rule in seen:
            continue
        seen.add(rule)
        for number in lowered.rule_productions[rule]:
            production = lowered.productions[number]
            rules.extend(symbol for symbol,terminal in zip(production.rhs,production.terminal) if not terminal)
            pending = [production.tags_term,production.emit,production.parent_tags,production.conds_predict]
            pending.extend(production.conds_at.values())
            if production.slot is not None:
                source = production.slot.source
                pending.extend((source.conditions,source.tags,source.rule_tags,source.emit))
            while pending:
                node = pending.pop()
                if isinstance(node,(list,tuple)):
                    pending.extend(node)
                elif isinstance(node,dict):
                    method = node.get("method")
                    target = node["args"][0].get("rule") if method in ("matches", "begins", "tags") and node["args"] else None
                    span = node.get("receiver")
                    if target is not None:
                        target = lowered.rule_ids[target]
                        rules.append(target)
                        spans = [span]
                        while spans:
                            part = spans.pop()
                            if isinstance(part,dict):
                                if part.get("method") in ("without-elision", "without-elision-except"):
                                    wanted.add(target)
                                spans.extend(part.values())
                            elif isinstance(part,(list,tuple)):
                                spans.extend(part)
                    if node.get("method") in ("without-elision", "without-elision-except"):
                        name = node["receiver"]["capture"]
                        at = production.captures.get(name)
                        if not name or at is None or production.contextual:
                            wanted.update((production.lhs,lowered.rule_ids[production.rule_name]))
                        elif not production.terminal[at]:
                            wanted.add(production.rhs[at])
                    pending.extend(node.values())
    pending = list(wanted)
    while pending:
        rule = pending.pop()
        for number in lowered.rule_productions[rule]:
            production = lowered.productions[number]
            for symbol,terminal in zip(production.rhs,production.terminal):
                if not terminal and symbol not in wanted:
                    wanted.add(symbol)
                    pending.append(symbol)
    lowered.close_rules = frozenset(wanted)
    return lowered.close_rules


def local_demand(production):
    """Find observations consumed here, rather than by another caller."""
    whole, positions, queries = False, set(), {}
    stack = [production.conds_predict, production.conds_at,
             production.tags_term, production.emit, production.parent_tags]
    if production.slot is not None:
        # Deferred option gates can consume earlier public captures.
        # A private whole capture also names the written alternative.
        source = production.slot.source
        stack.extend((source.conditions, source.tags, source.rule_tags))
    seen = set()
    while stack:
        node = stack.pop()
        if not isinstance(node, (dict, list, tuple)) or id(node) in seen:
            continue
        seen.add(id(node))
        if isinstance(node, dict):
            value = node.get("receiver") if node.get("method") in ("matches", "begins") else None
            aligned = value["receiver"] if isinstance(value, dict) and value.get("method") == "onward" else value
            if isinstance(aligned, dict) and aligned.get("method") in ("without-elision", "without-elision-except"):
                name = aligned["receiver"]["capture"]
                if name in production.captures:
                    position = production.captures[name]
                    positions.add(position)
                    if position not in queries:
                        queries[position] = set()
                    if queries[position] is not None:
                        queries[position].add(node["args"][0]["rule"])
                    continue
            if node.get("method") in ("without-elision", "without-elision-except"):
                name = node["receiver"]["capture"]
                if name == "":
                    whole = True
                elif name in production.captures:
                    position = production.captures[name]
                    positions.add(position)
                    queries[position] = None
            stack.extend(node.values())
        else:
            stack.extend(node)
    return whole, frozenset(positions), queries


def query_prefixes(lowered):
    """Overestimate first tokens, empty proofs, and leading omissions."""
    if lowered.close_prefixes is not None:
        return lowered.close_prefixes
    table = [[False, False, set()] for _ in lowered.rule_names]
    dependents = [set() for _ in lowered.rule_names]
    for number, production in enumerate(lowered.productions):
        for symbol, terminal in zip(production.rhs, production.terminal):
            if not terminal:
                dependents[symbol].add(number)
    pending = list(range(len(lowered.productions)))
    queued = set(pending)
    while pending:
        number = pending.pop()
        queued.remove(number)
        production = lowered.productions[number]
        here = table[production.lhs]
        before = here[0], here[1], len(here[2])
        if not production.rhs and production.elided is not None:
            here[1] = True
        empty = True
        for symbol, terminal in zip(production.rhs, production.terminal):
            if terminal:
                here[2].add(symbol)
                empty = False
                break
            child = table[symbol]
            here[2].update(child[2])
            here[1] |= child[1]
            if not child[0]:
                empty = False
                break
        here[0] |= empty
        if before != (here[0], here[1], len(here[2])):
            for dependent in dependents[production.lhs]:
                if dependent not in queued:
                    queued.add(dependent)
                    pending.append(dependent)
    lowered.close_prefixes = table
    return table
