"""Recognition (engine §4): an Earley recognizer whose items hold their
captured parts' spans and tag sets, and the terms and conditions of engine
§10 that it evaluates."""

from __future__ import annotations

import itertools
import json
from dataclasses import dataclass, field, replace
from typing import Any, Callable

from . import _testing
from ._boundary import METHODS, Records, Annotations, atoms
from ._clauses import WHOLE
from ._eligible import eligible
from ._errors import _GrammarFault
from ._grammar import Lowered, Production, SymbolTest, written_symbol
from ._model import Range, Tags, Token
from ._tags import EMPTY, Gathered, TagTable, difference, intersection, is_class, split_string
from ._trampoline import Walk, run
from ._patterns import PatternMachine, observation_machine
from ._unicode import UnicodeTable
from ._closes import Block, CloseMachine, InvalidObservation, RestoredSpan, needed, local_demand, query_prefixes
from ._families import DEAD, IDENTITY, FamilyMatcher, Summary
from ._model import Restoration
from ._restored import empty_source

SEED = (-1, 0, 0, 0)
"""The edge of a predicted item: (predecessor, kind, a, b), where kind is 0
for a prediction, 1 for a read of token a as terminal b, 2 for a completed
child item a, and RESTORE for a restoration."""

RESTORE = 3
"""The kind of the one edge of a restoration in the check of engine §7.4,
(-1, RESTORE, token, terminal): the read of the synthetic token as the
terminal, after which the empty production closes over that token."""

class Caps:
    """An item's captured parts, slot by slot: each a span and the tags its
    constituent keeps. A parse interns them, each by the parts it extends
    and the part it adds, which it shares: one production of C captures
    keeps C parts, not C², and equal parts are one object, so an item's key
    compares them by identity (engine §4).

    ``jump`` is an earlier sequence that a search for a part can skip to:
    the parent's jump's jump where the two jumps skip the same number of
    parts, and the parent otherwise. These are the jumps of a skew-binary
    list, so a search for any part takes a number of steps that grows with
    the logarithm of the parts."""

    __slots__ = ("parent", "part", "size", "jump")

    def __init__(self, parent: Caps | None, part: tuple[int, ...] | None) -> None:
        self.parent = parent
        self.part = part
        self.size = 0 if parent is None else parent.size + 1
        jump = parent
        if parent is not None and parent.jump is not None:
            above = parent.jump
            if parent.size - above.size == above.size - (0 if above.jump is None else above.jump.size):
                jump = above.jump
        self.jump = jump

    def __len__(self) -> int:
        return self.size

    def __getitem__(self, slot: int) -> tuple[int, ...]:
        """One slot's part, the last in constant time and an earlier one by
        the jumps; ``parts`` reads them all in one walk."""
        return self.find(slot)[0]

    def find(self, slot: int) -> tuple[tuple[int, ...], int]:
        """One slot's part, with the steps the search took, which tell
        :class:`Bound` when one walk of every part would cost less."""
        if not 0 <= slot < self.size:
            raise IndexError(slot)
        found: Caps = self
        steps = 0
        while found.size > slot + 1:
            jump = found.jump
            found = jump if jump is not None and jump.size >= slot + 1 else found.parent  # type: ignore[assignment]
            steps += 1
        assert found.part is not None
        return found.part, steps

    def parts(self) -> list[tuple[int, ...]]:
        """Every slot's part, in slot order, read in one walk."""
        out: list[tuple[int, ...]] = []
        found: Caps | None = self
        while found is not None and found.part is not None:
            out.append(found.part)
            found = found.parent
        out.reverse()
        return out


class Bound:
    """The captures of an item as an evaluation reads them, each found when
    it is first read: the last part at once, an earlier one by the jumps.
    Once the searches took half as many steps as there are parts, every
    part comes from one walk, so a term that reads them all walks them
    about twice at most. ``$`` is the whole constituent where it is known."""

    __slots__ = ("production", "caps", "base", "project", "whole", "found", "all", "searched", "machine", "structure", "close_structure", "boundary_value", "boundary_test")

    def __init__(
        self,
        production: Production,
        caps: Caps,
        base: int,
        project: list[int] | None,
        whole: tuple[int, int, int | Callable[[], Walk] | None] | None,
        machine: PatternMachine | None = None,
        structure: int = 0,
        close_structure: int = 0,
    ) -> None:
        self.boundary_value = None
        self.boundary_test = None
        self.production = production
        self.caps = caps
        self.base = base
        self.project = project
        self.whole = whole
        self.machine = machine
        self.structure = structure
        self.close_structure = close_structure
        self.found: dict[str, tuple[int, ...] | None] = {}
        self.all: list[tuple[int, ...]] | None = None
        self.searched = 0

    def get(self, name: str) -> tuple[int, ...] | None:
        if name == WHOLE:
            whole = self.whole
            if whole is None:
                return None
            if self.project is None:
                return (whole[0] + self.base, whole[1] + self.base, whole[2])  # type: ignore[return-value]
            return (self.project[whole[0]], self.project[whole[1]], whole[2])  # type: ignore[return-value]
        if name in self.found:
            return self.found[name]
        position = self.production.captures.get(name)
        result: tuple[int, ...] | None = None
        if position is not None:
            slot = self.production.slots[position]
            caps = self.caps
            if 0 <= slot < len(caps):
                if self.all is None and self.searched * 2 >= len(caps):
                    self.all = caps.parts()
                if self.all is not None:
                    start, end, tag = self.all[slot][:3]
                else:
                    part, steps = caps.find(slot)
                    start, end, tag = part[:3]
                    self.searched += steps + 1
                if self.project is None:
                    result = (start + self.base, end + self.base, tag)
                else:
                    # A capture keeps its constituent's own tags, also where
                    # its span projects to empty (engine §7.5).
                    result = (self.project[start], self.project[end], tag)
        if result is None and self.production.lexical is not None and name in self.production.lexical.captures:
            start,end,tag = self.production.lexical.captures[name][:3]
            result = (start+self.base,end+self.base,tag) if self.project is None else (self.project[start],self.project[end],tag)
        self.found[name] = result
        return result

    def observation(self, name: str) -> int:
        if name == WHOLE:
            return self.structure
        position = self.production.captures.get(name)
        if position is None:
            frame = self.production.lexical
            part = frame.captures.get(name) if frame else None
            return part[3] if part and len(part)>3 else 0
        slot = self.production.slots[position]
        if not 0 <= slot < len(self.caps):
            return 0
        part = self.caps[slot]
        return part[3] if len(part) > 3 else 0

    def close_observation(self, name: str) -> int:
        if name == WHOLE:
            return self.close_structure
        position = self.production.captures.get(name)
        if position is None:
            frame = self.production.lexical
            part = frame.captures.get(name) if frame else None
        else:
            slot = self.production.slots[position]
            part = self.caps[slot] if 0 <= slot < len(self.caps) else None
        return part[4] if part and len(part) > 4 else 0


NO_CAPS = Caps(None, None)
"""The captured parts of an item that has none, which every parse shares."""

CONTENT_KEY_LIMIT = 64
"""The most tokens a span may have for a nested parse's answer to be kept
under its content, which equal spans at other positions share; a longer span
is kept under its position (engine §4)."""


class EdgeSets:
    """The edges each item has, as sets, for the reconstruction mode, where
    a step can repeat an edge an item already has (engine §7.4). A short
    list is scanned, and an item gets a set once its list grows past a few
    edges, so an item of many edges does not scan them all at each one."""

    SHORT = 8

    __slots__ = ("sets",)

    def __init__(self) -> None:
        self.sets: dict[int, set[tuple[Any, ...]]] = {}

    def add(self, item: int, edges: list[tuple[Any, ...]], edge: tuple[Any, ...]) -> None:
        """Appends an edge to an item's list unless the list holds it."""
        if len(edges) < self.SHORT:
            if edge in edges:
                return
        else:
            seen = self.sets.get(item)
            if seen is None:
                seen = self.sets[item] = set(edges)
            if edge in seen:
                return
            seen.add(edge)
        edges.append(edge)


@dataclass
class Forest:
    """The items of a parse, each with the edges it was derived by."""

    tokens: list[Token]
    lowered: Lowered
    prod: list[int]
    dot: list[int]
    origin: list[int]
    end: list[int]
    caps: list[Caps]
    edges: list[list[tuple[Any, ...]]]
    tag: dict[int, int]
    roots: list[int]
    furthest: int
    expected: dict[str, set[str]]
    project: list[int] | None = None
    structure: list[int] = field(default_factory=list)
    machine: PatternMachine | None = None
    prefix: list[int] = field(default_factory=list)
    strict: list[bool] = field(default_factory=list)
    close_structure: list[int] = field(default_factory=list)
    close_prefix: list[int] = field(default_factory=list)
    close_machine: CloseMachine | None = None
    close_requested: bool = False
    family: FamilyMatcher | None = None
    family_prefix: list[Summary] = field(default_factory=list)
    family_structure: list[Summary] = field(default_factory=list)
    boundaries: list = field(default_factory=list)
    boundary_machine: Any = None
    boundary_annotations: list = field(default_factory=list)
    boundary_failures: list = field(default_factory=list)


@dataclass
class NestedAnswer:
    accepted: bool
    tags: Tags


class Sources:
    """The source of a run of tokens (engine §1): from the least source
    start among them to the greatest source end. Tokens usually lie in the
    order of their sources, and then that is the first token's start and
    the last token's end. Otherwise a table of the least start and the
    greatest end of every run of a power of two tokens answers without a
    scan, so that the nested nodes of a long left-recursive rule cost no
    more than its tokens."""

    def __init__(self, tokens: list[Token]) -> None:
        self.tokens = tokens
        self.made = False
        # lows[k][i] is the least source start of tokens i..i + 2**k, and
        # highs[k][i] the greatest end; empty when the tokens are in order.
        self.lows: list[list[int]] = []
        self.highs: list[list[int]] = []

    def of(self, start: int, end: int) -> Range:
        """The source of tokens start..end, which must not be empty."""
        if not self.made:
            self.make()
        if not self.lows:
            return (self.tokens[start].source[0], self.tokens[end - 1].source[1])
        # Two runs of a power of two tokens cover the span between them.
        level = (end - start).bit_length() - 1
        other = end - (1 << level)
        lows, highs = self.lows[level], self.highs[level]
        return (min(lows[start], lows[other]), max(highs[start], highs[other]))

    def make(self) -> None:
        self.made = True
        tokens = self.tokens
        if all(
            before.source[0] <= after.source[0] and before.source[1] <= after.source[1]
            for before, after in zip(tokens, tokens[1:])
        ):
            return
        low = [token.source[0] for token in tokens]
        high = [token.source[1] for token in tokens]
        self.lows, self.highs = [low], [high]
        width = 1
        while 2 * width <= len(tokens):
            count = len(tokens) - 2 * width + 1
            low = [min(low[index], low[index + width]) for index in range(count)]
            high = [max(high[index], high[index + width]) for index in range(count)]
            self.lows.append(low)
            self.highs.append(high)
            width *= 2


@dataclass
class StageContext:
    """What every parse of one stage run shares: the stage's input tokens,
    the original text, the tag table, and the answers of nested parses."""

    lowered: Lowered
    tokens: list[Token]
    text: str
    unicode: UnicodeTable
    tagtab: TagTable = field(default_factory=TagTable)
    # The answers of nested parses (engine §4), under nested_key: those of
    # matches and tags, which read one recognition, and those of begins,
    # which can hold where matches does not.
    memo: dict[tuple[Any, ...], NestedAnswer] = field(default_factory=dict)
    begins_memo: dict[tuple[Any, ...], bool] = field(default_factory=dict)
    # The nested parses running, by rule and span, whatever was asked of them.
    running: set[tuple[str, int, int]] = field(default_factory=set)
    token_tags: list[int] = field(default_factory=list)
    count: Callable[[Forest, list[int]], list[int]] | None = None
    # Where each run of the tokens lies in the text (engine §1).
    sources: Sources = field(init=False)
    # The next token with a nonempty stored value, made on first use.
    sounding: list[int] | None = field(init=False, default=None)
    # On the context of the reconstructed input R of the check of engine §7,
    # and nowhere else: whether each token of R is synthetic, by its
    # provenance (engine §7.2); π, the number of original tokens before each
    # position of R (engine §7.3); and the context of the stage's input,
    # whose tokens every observation reads and whose memo and nested parses
    # running the check's queries share (engine §7.5, §7.6).
    synthetic: list[bool] | None = None
    project: list[int] | None = None
    observed: StageContext | None = None
    machine: PatternMachine | None = field(init=False, default=None)
    close_rules: frozenset[int] = field(init=False, default=frozenset())
    closes: CloseMachine | None = field(init=False, default=None)
    aligned_memo: dict[tuple, NestedAnswer] = field(default_factory=dict)
    qualified_memo: dict[tuple, tuple[Forest, list[int]]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.token_tags = [self.tagtab.intern(token.tags) for token in self.tokens]
        self.sources = Sources(self.tokens)
        self.machine = self.observed.machine if self.observed is not None else observation_machine(self.lowered)
        self.close_rules = self.observed.close_rules if self.observed is not None else needed(self.lowered)
        self.closes = self.observed.closes if self.observed is not None else CloseMachine() if self.close_rules else None

    def carries(self, terminal: str, token_index: int) -> bool:
        """String and range terminals observe stored values on ordinary tokens."""
        if self.synthetic is not None and self.synthetic[token_index]:
            return False
        token = self.tokens[token_index]
        wanted = self.lowered.characters[terminal]
        if wanted is None:
            return True
        if isinstance(wanted, str):
            return token.value == wanted
        return len(token.value) == 1 and wanted[0] <= ord(token.value) <= wanted[1]

    def value(self, index: int) -> str:
        """A token's stored value, without normalization (engine §1)."""
        return self.tokens[index].value

    def test_holds(self, test: SymbolTest, start: int, end: int, tag_id: int) -> bool:
        """Whether a test holds of a symbol's own span, tokens start..end,
        and its own tags, the tag set numbered ``tag_id``: a token's for a
        terminal, the completed item's for a reference (engine §4). An empty
        span has the empty value."""
        if test.value is not None and test.prior is None:
            return self.value_is(test.value, start, end) == (test.op == "=")
        value = "".join(self.tokens[i].value for i in range(start, end)) if test.value is not None else ""
        return test.holds(value, self.tagtab.get(tag_id))

    def value_is(self, value: str, start: int, end: int) -> bool:
        """Whether the stored values of tokens start..end join to a string."""
        sounding = self.nonempty_tokens()
        # Each token read adds at least one code point, so the test costs
        # the length of the value, however many silent tokens the span has.
        offset = 0
        index = sounding[start]
        while index < end:
            part = self.value(index)
            if not value.startswith(part, offset):
                return False
            offset += len(part)
            index = sounding[index + 1]
        return offset == len(value)

    def nonempty_tokens(self) -> list[int]:
        """For each position, the first token from there on that sounds,
        made on first use."""
        sounding = self.sounding
        if sounding is None:
            sounding = self.sounding = self.make_nonempty()
        return sounding

    def make_nonempty(self) -> list[int]:
        count = len(self.tokens)
        sounding = [count] * (count + 1)
        for index in range(count - 1, -1, -1):
            sounding[index] = index if self.value(index) else sounding[index + 1]
        return sounding

    def span_text(self, start: int, end: int) -> str:
        if start >= end:
            return ""
        source = self.sources.of(start, end)
        return self.text[source[0] : source[1]]

    def nested_key(self, rule: str, start: int, end: int) -> tuple[Any, ...]:
        """The key of a nested parse's answer, which fixes everything the
        parse can observe (engine §4): a short span's content, so that equal
        spans at other positions share the answer, or a longer span's
        position, which within one parse fixes its tokens. A key of content
        costs as much as the span is long, and the span of from() or after()
        runs to the end of the input. The two kinds of key never meet: one
        holds numbers where the other holds text."""
        if end - start > CONTENT_KEY_LIMIT:
            return (rule, start, end)
        # The text over the span's source (engine §1), and where each token
        # begins and ends in that text, which text() of a part of the span
        # reads.
        low, high = self.sources.of(start, end) if start < end else (0, 0)
        return (
            rule,
            self.text[low:high],
            tuple(
                (
                    self.token_tags[index],
                    self.tokens[index].text,
                    self.tokens[index].value,
                    self.tokens[index].source[0] - low,
                    self.tokens[index].source[1] - low,
                )
                for index in range(start, end)
            ),
        )

    def nested(self, rule: str, start: int, end: int) -> Walk:
        """Whether tokens start..end alone parse as rule, and the tags of
        their derivations (engine §4, nested parses): what matches and tags
        read. A walk, which runs the nested parse where its answer is not
        yet known."""
        self.require_inactive(rule, start, end)
        key = self.nested_key(rule, start, end)
        if self.closes is not None:
            key = key, frozenset(self.running)
        found = self.memo.get(key)
        if found is None:
            yield self.answer(rule, start, end, key, False)
            found = self.memo[key]
        return found

    def begins(self, rule: str, start: int, end: int) -> Walk:
        """Whether a prefix of tokens start..end, the empty one included,
        parses as rule: whether a completed item of the rule with an
        eligible proof tree begins at the span's start, in any set (engine
        §4). A walk, as for :meth:`nested`."""
        self.require_inactive(rule, start, end)
        key = self.nested_key(rule, start, end)
        if self.closes is not None:
            key = key, frozenset(self.running)
        found = self.begins_memo.get(key)
        if found is None:
            yield self.answer(rule, start, end, key, True)
            found = self.begins_memo[key]
        return found

    def require_inactive(self, rule, start, end):
        if (rule, start, end) in self.running:
            raise _GrammarFault(
                f"a condition asks whether its own span parses as {rule} from inside the parse of that span as {rule}: "
                f"the grammar defines {rule} in terms of itself over the same text"
            )

    def aligned(self, rule: str, span: RestoredSpan, prefix: bool) -> Walk:
        """Filter original eligible proofs with one captured observation."""
        self.require_inactive(rule, span.start, span.context_end)
        closes = self.closes
        assert closes is not None
        if span.observation == closes.INVALID:
            return NestedAnswer(False, EMPTY)
        ancestry = frozenset(self.running)
        key = (rule, span.start, span.context_end, span.end, span.captured_end, prefix,
               closes.semantic(span.observation), span.family, ancestry)
        found = self.aligned_memo.get(key)
        if found is not None:
            return found
        request = rule, span.start, span.context_end
        self.running.add(request)
        try:
            raw_key = rule, span.start, span.context_end, ancestry
            family = None
            if span.family is not None:
                raw_key += span.family, span.captured_end, closes.semantic(span.observation)
            qualified = self.qualified_memo.get(raw_key)
            if qualified is None:
                number = self.lowered.rule_ids.get(rule)
                if number is None:
                    raise _GrammarFault(f"{rule} is not a rule of this stage")
                if span.family is not None:
                    family = FamilyMatcher(closes, span.observation, span.start, span.captured_end,
                                           self.lowered.grammar.families[span.family])
                forest = yield Parser(self, span.start, span.context_end, observe=True, family=family).walk(number)
                candidates = [item for item in range(len(forest.prod))
                              if item in forest.tag and forest.origin[item] == 0
                              and forest.lowered.productions[forest.prod[item]].lhs == number
                              and forest.dot[item] == len(forest.lowered.productions[forest.prod[item]].rhs)
                              and forest.lowered.productions[forest.prod[item]].close_requested]
                qualified = forest, eligible(forest, boundary_witnesses(forest, candidates))
                self.qualified_memo[raw_key] = qualified
            forest, candidates = qualified
            tags = Gathered()
            accepted = False
            for item in candidates:
                end = span.start + forest.end[item]
                if forest.family is not None and _testing.family_check is not None:
                    answer = forest.family.accepts(forest.family_structure[item], end)
                    _testing.family_check(forest, item, span.start, answer)
                if end > span.end or not prefix and end != span.end:
                    continue
                boundary = min(span.captured_end, end)
                if forest.family is not None:
                    matches = forest.family.accepts(forest.family_structure[item], end)
                else:
                    candidate = closes.through(span.observation, boundary)
                    witness = closes.through(forest.close_structure[item], boundary)
                    matches = candidate is not None and candidate == witness
                if matches:
                    accepted = True
                    tags.add(self.tagtab.get(forest.tag[item]))
            found = NestedAnswer(accepted, tags.value())
            self.aligned_memo[key] = found
            return found
        finally:
            self.running.discard(request)

    def answer(self, rule: str, start: int, end: int, key: tuple[Any, ...], begins: bool) -> Walk:
        """Parses tokens start..end alone as rule, and remembers the answer
        under key. The parse is a walk on the stack of the parse that asked,
        so a chain of nested parses costs heap and not the call stack. A
        parse in progress is known by its rule and span, whatever a
        condition asks of it. So alternating matches, begins and tags cannot
        hide a question about a span from inside its own parse (engine §4)."""
        running = (rule, start, end)
        if running in self.running:
            raise _GrammarFault(
                f"a condition asks whether its own span parses as {rule} from inside the parse of that span as {rule}: "
                f"the grammar defines {rule} in terms of itself over the same text"
            )
        number = self.lowered.rule_ids.get(rule)
        if number is None:
            raise _GrammarFault(f"{rule} is not a rule of this stage")
        self.running.add(running)
        try:
            forest: Forest = yield Parser(self, start, end).walk(number)
        finally:
            # Also when the parse failed, so that the place is free again.
            self.running.discard(running)
        if not begins:
            # The answer reads the completed items of the rule over the span
            # that have an eligible proof tree, under written-terminator
            # priority (engine §4).
            found_items = eligible(forest, boundary_witnesses(forest, forest.roots))
            gathered = Gathered()
            for root in found_items:
                gathered.add(self.tagtab.get(forest.tag[root]))
            self.memo[key] = NestedAnswer(bool(found_items), gathered.value())
            return
        # A completed item of the rule from the span's start, in any set.
        productions = forest.lowered.productions
        witnesses = [
            item
            for item, (prod, dot, origin) in enumerate(zip(forest.prod, forest.dot, forest.origin))
            if item in forest.tag and origin == 0 and productions[prod].lhs == number and dot == len(productions[prod].rhs) and not productions[prod].close_requested
        ]
        # Only an item with an eligible proof tree counts (engine §4).
        self.begins_memo[key] = bool(eligible(forest, boundary_witnesses(forest, witnesses)))


def _as_set(value: Any) -> Tags:
    """A value where a set is needed (engine §10). The reader has made sure
    that the types agree, so a set's kind needs no mark here, and no value
    turns into another."""
    if not isinstance(value, (frozenset, set)):
        raise _GrammarFault("a set is needed here")
    return value


def _as_string(value: Any) -> str:
    """A value where a string is needed (engine §10)."""
    if not isinstance(value, str):
        raise _GrammarFault("a string is needed here")
    return value


class Evaluator:
    """Terms and conditions (engine §10) over one parse's captures."""

    def __init__(self, context: StageContext, base: int, end: int, project: list[int] | None = None) -> None:
        self.context = context
        # Where the parse's input begins, in the stage's tokens: the captures
        # count from here, and initial() holds here (engine §10).
        self.base = base
        # Where it ends: from() and after() run to here.
        self.end = end
        # In the check of engine §7, π: the captures are spans of the
        # reconstructed input R, and every observation reads their
        # projections in the stage's input, which is ``context``'s. So the
        # projection comes first, and then any function of a span (engine
        # §7.3, §7.5). None elsewhere.
        self.project = project

    def bind(self, production: Production, caps: Caps, whole: tuple[int, int, int | Callable[[], Walk] | None] | None = None, structure: int = 0, close_structure: int = 0) -> Bound:
        """The captures of an item, and ``$`` when ``whole`` gives the
        constituent's span and tag set (``None`` while its tag set is being
        computed, when no term may read it). Each capture is found when it
        is first read, not all of them at once."""
        return Bound(production, caps, self.base, self.project, whole, self.context.machine, structure, close_structure)

    def _span(self, dom: Any, bound: Bound) -> Walk:
        if "capture" in dom:
            found = bound.get(dom["capture"])
            if found is None:
                raise _GrammarFault(f"${dom['capture']} is not captured here")
            return found
        name = dom.get("method")
        receiver = dom.get("receiver")
        span = yield self._span(receiver, bound)
        start, end, _ = span
        if name in ("without-elision", "without-elision-except"):
            observation = bound.close_observation(receiver["capture"])
            if observation == CloseMachine.INVALID:
                raise InvalidObservation()
            family = dom["args"][0]["rule"] if name == "without-elision-except" else None
            return RestoredSpan(start, end, end, self.end, observation, family)
        if name == "onward":
            return replace(span, end=self.end) if isinstance(span, RestoredSpan) else (start, self.end, None)
        if name == "following-tokens":
            return end, self.end, None
        if start >= end:
            return start, start, None
        if name == "first-token":
            return start, start + 1, None
        if name == "tokens-after-first":
            return start + 1, end, None
        if name == "last-token":
            return end - 1, end, None
        raise _GrammarFault("a span is needed here")

    def span_tags(self, span: tuple[int, int, int | None]) -> Tags:
        start, end, whole = span
        if whole is not None:
            return self.context.tagtab.get(whole)
        # One set grows over the span, since a union per token would copy
        # the tags gathered so far at every token.
        tokens = self.context.tokens
        gathered = Gathered()
        for index in range(start, end):
            gathered.add(tokens[index].tags)
        return gathered.value()

    def input_value(self, start: int, end: int) -> str:
        """The stored values of tokens start..end, concatenated (engine §1)."""
        # Only tokens with nonempty values are read, so that a long run of silent
        # tokens costs nothing to each of many calls over it.
        context = self.context
        sounding = context.nonempty_tokens()
        parts: list[str] = []
        index = sounding[start]
        while index < end:
            parts.append(context.value(index))
            index = sounding[index + 1]
        return "".join(parts)

    def walk_value(self, dom: Any, bound: Bound) -> Walk:
        """A term's value (engine §10): a string, or a set, of strings or of
        tags."""
        if "capture" in dom:
            start, end, _ = yield self._span(dom, bound)
            return self.input_value(start, end)
        if "interpolate" in dom:
            parts = []
            for part in dom["interpolate"]:
                parts.append((yield self.walk_value(part, bound)))
            return "".join(parts)
        if "string" in dom:
            return dom["string"]
        if "tag" in dom:
            return frozenset((dom["tag"],))
        if "const" in dom:
            # A constant holds its final value once the stage is stitched
            # (engine §2).
            if "value" not in dom:
                raise _GrammarFault(f"the constant ${dom['const']} has no value")
            return dom["value"]
        if "emptySet" in dom:
            return EMPTY
        if "if" in dom:
            # A guarded term: its term is evaluated only where its condition
            # holds (engine §10).
            if (yield self.walk_condition(dom["if"], bound)):
                return _as_set((yield self.walk_value(dom["then"], bound)))
            return EMPTY
        if "union" in dom:
            gathered = Gathered()
            for item in dom["union"]:
                gathered.add(_as_set((yield self.walk_value(item, bound))))
            return gathered.value()
        if "intersection" in dom:
            parts = dom["intersection"]
            result = _as_set((yield self.walk_value(parts[0], bound)))
            for item in parts[1:]:
                result = intersection(result, _as_set((yield self.walk_value(item, bound))))
            return result
        if "difference" in dom:
            left = _as_set((yield self.walk_value(dom["difference"][0], bound)))
            return difference(left, _as_set((yield self.walk_value(dom["difference"][1], bound))))
        name = dom.get("method")
        if name is not None:
            args = dom["args"]
            receiver = dom["receiver"]
            if name in ("split", "classify"):
                text = _as_string((yield self.walk_value(receiver, bound)))
                if name == "split":
                    delimiter = _as_string((yield self.walk_value(args[0], bound)))
                    if delimiter == "":
                        raise _GrammarFault("split has an empty delimiter")
                    return split_string(text, delimiter)
                table = self.context.lowered.classifiers[args[0]["classifier"]]
                return table.get(text, EMPTY)
            span = yield self._span(receiver, bound)
            if name == "tags" and args:
                if isinstance(span, RestoredSpan):
                    return (yield self.context.aligned(args[0]["rule"], span, False)).tags
                start, end, _ = span
                return (yield self.context.nested(args[0]["rule"], start, end)).tags
            if name == "value":
                return self.input_value(span[0], span[1])
            if name == "image":
                return "".join(self.context.tokens[i].image for i in range(span[0], span[1]))
            if name in ("source-text", "decomposed-source-text"):
                text = self.context.span_text(span[0], span[1])
                return self.context.unicode.decompose(text) if name == "decomposed-source-text" else text
            if name in ("tags", "classes"):
                whole = span[2]
                if callable(whole):
                    span = span[0], span[1], (yield whole())
                tags = self.span_tags(span)
                return tags if name == "tags" else frozenset(tag for tag in tags if is_class(tag))
            if name in ("first-token", "tokens-after-first", "last-token", "onward", "following-tokens", "without-elision", "without-elision-except"):
                start, end, _ = yield self._span(dom, bound)
                return self.input_value(start, end)
            raise _GrammarFault(f"unknown method .{name}")
        raise _GrammarFault("a span is used where a value is needed")

    def value(self, dom: Any, bound: Bound) -> Any:
        """A term's value outside any parse, as emission needs. The nested
        parses it asks run on the stack of this walk."""
        return run(self.walk_value(dom, bound))

    def tags(self, dom: Any, bound: Bound) -> Tags:
        return _as_set(self.value(dom, bound))

    def walk_condition(self, dom: Any, bound: Bound) -> Walk:
        if "op" in dom:
            op = dom["op"]
            if op in ("≅", "≇"):
                machine = bound.machine
                holds = machine is not None and machine.matches(bound.observation(dom["left"]["capture"]), dom["right"]["pattern"])
                return holds == (op == "≅")
            left = yield self.walk_value(dom["left"], bound)
            right = yield self.walk_value(dom["right"], bound)
            if op in ("=", "≠"):
                # Two strings, or two sets of one kind (engine §10).
                equal = left == right
                return equal if op == "=" else not equal
            if op in ("∈", "∉"):
                if not isinstance(left, str):
                    raise _GrammarFault(f"the left side of {op} is a string")
                inside = left in _as_set(right)
                return inside if op == "∈" else not inside
            if op in ("⊆", "⊈"):
                inside = _as_set(left) <= _as_set(right)
                return inside if op == "⊆" else not inside
            raise _GrammarFault(f"an unknown comparison {op}")
        if "method" in dom:
            name = dom["method"]
            if name in METHODS:
                return bound.boundary_value if bound.boundary_value is not None else bound.boundary_test(dom)
            span = yield self._span(dom["receiver"], bound)
            if name == "ends-input":
                return span[1] == self.end
            if name == "starts-input":
                return span[0] == self.base
            rule = dom["args"][0]["rule"]
            if isinstance(span, RestoredSpan):
                return (yield self.context.aligned(rule, span, name == "begins")).accepted
            start, end, _ = span
            return (yield self.context.begins(rule, start, end)) if name == "begins" else (yield self.context.nested(rule, start, end)).accepted
        if "not" in dom:
            return not (yield self.walk_condition(dom["not"], bound))
        if "if" in dom:
            # The consequent is evaluated only where the premise holds
            # (engine §10, "Order of evaluation").
            if not (yield self.walk_condition(dom["if"], bound)):
                return True
            return bool((yield self.walk_condition(dom["then"], bound)))
        if "captured" in dom:
            # Decided for each production when it is lowered (engine §3.6).
            raise _GrammarFault("a presence test outlived lowering")
        if "any" in dom:
            for item in dom["any"]:
                if (yield self.walk_condition(item, bound)):
                    return True
            return False
        if "all" in dom:
            for item in dom["all"]:
                if not (yield self.walk_condition(item, bound)):
                    return False
            return True
        raise _GrammarFault("an unknown condition")


class Parser:
    """One Earley parse of tokens start..end of a stage's input."""

    def __init__(self, context: StageContext, start: int = 0, end: int | None = None, *, observe: bool = False, family: FamilyMatcher | None = None) -> None:
        self.observe = observe
        self.family = family
        self.context = context
        self.base = start
        self.end = len(context.tokens) if end is None else end
        observed = context.observed
        if observed is None:
            self.evaluator = Evaluator(context, start, self.end)
        else:
            # The recognition of R in the check of engine §7: its conditions,
            # tag terms and tests of references read the stage's input
            # through π, and the input that initial(), from() and after()
            # see is the stage's. Its queries run in the context of the
            # stage's input, with the main grammar in its ordinary mode, so
            # they name their spans in positions of that input and share
            # the main parse's memo and the nested parses running (engine
            # §4, §7.6).
            assert context.project is not None
            self.evaluator = Evaluator(observed, 0, len(observed.tokens), context.project)

    def parse(self, start_rule: int) -> Forest:
        """The forest of the parse, with the nested parses its conditions
        and tag terms ask for, each run on one stack of walks."""
        return run(self.walk(start_rule))  # type: ignore[no-any-return]

    def walk(self, start_rule: int) -> Walk:
        """The parse as a walk (see :mod:`._trampoline`). A nested parse
        that a condition or a tag term asks for is a walk pushed on the same
        stack, and its answer resumes the evaluation that asked (engine §4).
        So a chain of nested parses costs heap and not the call stack.

        This is the design of the Rust recognizer, with the same frames and
        order of work. There a run keeps its chart, its queue's place and
        its step by hand, and a step that needs an answer is made again once
        it is known. Here the generator's frame keeps the parse's state, and
        the evaluation's own walks keep their place. So nothing is evaluated
        twice, which matters more in Python, where each repeat is costly.

        Only the work that can ask a nested parse is a walk: a prediction,
        the conditions of an advance, and a tag term. A plain call costs
        less, and most advances evaluate nothing."""
        context = self.context
        lowered = context.lowered
        prefix_table = query_prefixes(lowered) if context.closes is not None else None
        ranked_groups = bool(lowered.ranked_helpers)
        if ranked_groups or context.closes is not None:
            lowered = replace(lowered,productions=list(lowered.productions))
        productions = lowered.productions
        # The stage's tokens, read from base on: a copy of the rest of a long
        # text would cost a nested parse its length.
        tokens = context.tokens
        token_tags = context.token_tags
        base = self.base
        tagtab = context.tagtab
        evaluator = self.evaluator
        n = self.end - base

        # The reconstruction mode of the check of engine §7.4, on the context
        # of the reconstructed input R alone; every other parse reads as
        # engine §4 says. R is always parsed whole, so base is 0 there.
        synthetic = context.synthetic
        recon = synthetic is not None
        project = context.project
        observed = context.observed
        last_reading = reading_last(lowered) if recon else []
        elidable_helpers = lowered.elidable_helpers

        boundaries = Records(productions)
        if not boundaries.forward and not boundaries.backward:
            boundaries = None
        records, annotations, failures, prediction_obligations = [], [], [], {}
        has_slots = bool(ranked_groups)
        prod: list[int] = []
        dot: list[int] = []
        origin: list[int] = []
        end: list[int] = []
        caps: list[Caps] = []
        prefixes: list[int] = []
        structures: list[int] = []
        close_prefixes: list[int] = []
        close_structures: list[int] = []
        family = self.family
        family_prefixes: list[Summary] = []
        family_structures: list[Summary] = []
        machine = context.machine
        closes = context.closes
        def original(position):
            return project[position] if project is not None else base + position
        from ._ranked_frame import Frames
        frames = Frames(lowered, machine, closes, original) if ranked_groups else None
        def prediction_key(rule, frame=None, requested=False):
            if closes is not None:
                return rule, frame.id if frame else 0, requested
            return (rule, frame.id if frame else 0) if frames is not None else rule
        variants = {}
        demands = {}
        def demand(production):
            if production.id not in demands:
                demands[production.id] = local_demand(production)
            return demands[production.id]
        def request_child(production, position, at):
            if closes is None:
                return False
            if production.observes_closes:
                return True
            local = demand(production)
            if position not in local[1]:
                return False
            rules = local[2].get(position)
            child = prefix_table[production.rhs[position]]
            if rules is None or child[0] or child[1] or base + at >= len(tokens) or recon:
                return True
            for rule in rules:
                witness = prefix_table[lowered.rule_ids[rule]]
                if witness[0]:
                    return True
                for terminal in witness[2]:
                    tags = token_tags[base + at]
                    if (context.carries(terminal, base + at) if terminal in lowered.characters
                            else terminal in tagtab.get(tags)):
                        return True
            return False
        elidable_heads = {p.lhs:p.elided for p in productions if p.elided is not None} if machine is not None else {}
        # The interned captured parts, each by the parts it extends and the
        # part it adds.
        extended: dict[tuple[Caps, tuple[int, ...]], Caps] = {}
        edges: list[list[tuple[Any, ...]]] = []
        edge_sets = EdgeSets()
        tag: dict[int, int] = {}
        # In the reconstruction mode: whether every step that made an item is
        # strict, and whether the item has been processed (engine §7.4).
        strict: list[bool] = []
        processed: list[bool] = []
        # A set is made when the parse reaches it: once one is empty, every
        # later one is, and a nested parse over the rest of a long text stops
        # there.
        sets: list[dict[tuple[Any, ...], int]] = [{}]
        waiting: list[dict[int, list[int]]] = [{}]
        scanning: list[dict[str, list[int]]] = [{}]
        empty_done: list[dict[int, list[int]]] = [{}]
        # The rules predicted in each set, each with whether its prediction
        # was strict (engine §7.4), which only the reconstruction mode makes.
        predicted: list[dict[int, bool]] = [{}]
        # The restorations of the current set's synthetic token, made in the
        # next set when the parse reaches it (engine §7.4).
        restorations: list[int] = []
        agenda: list[int] = []

        def completed_structure(production: Production, position: int, prefix: int) -> int:
            if machine is None or position != len(production.rhs):
                return 0
            if production.elided is not None:
                return machine.node(None, machine.empty, (production.elided, "", frozenset((production.elided,))))
            if production.helper:
                return prefix
            return machine.node(production.rule_name, prefix)

        def terminal_structure(production: Production, position: int, token: int, terminal: str) -> int:
            if machine is None:
                return 0
            if recon and synthetic[token]:
                if position == 0 and elidable_heads.get(production.lhs) == terminal:
                    return machine.node(None, machine.empty, (terminal, "", frozenset((terminal,))))
                return machine.empty
            original = base + token if not recon else project[token]
            source = context if not recon else observed
            return machine.node(None, machine.empty, (terminal, source.value(original), source.tokens[original].tags))

        def omission_allowed(production: Production) -> bool:
            if _testing.fault("omission") or production.elided_test is None:
                return True
            test = production.elided_test
            value = test.value if test.op == "=" else ""
            return test.holds(value, frozenset((production.elided,)))

        def close_record(terminal, position, value=None):
            boundary = original(position)
            source = observed if observed is not None else context
            return closes.event(Restoration(terminal, boundary, empty_source(source.tokens, boundary), value))

        def completed_closes(production, position, start, at, prefix):
            if closes is None or not production.observes_closes or position != len(production.rhs):
                return 0
            if production.elided is not None:
                test = production.elided_test
                return close_record(production.elided, start, test.value if test is not None and test.op == '=' else None)
            if production.helper:
                return prefix
            return closes.complete(prefix, production.lhs, original(start), original(at))

        def block(production, start, at, frame, outermost=False):
            group = frame.seal_group if outermost else production.ranked
            entry = frame.seal_entry if outermost else frame.close_entry
            first = frame.seal_start if outermost else start
            return Block((group.rule, group.source.document, group.source.at, group.alternative, group.path),
                         original(first), original(at), entry)

        def completed_family(production, position, start, close_structure, prefix):
            if close_structure == CloseMachine.INVALID:
                return DEAD
            if production.observes_closes and position == len(production.rhs) and production.elided is not None:
                return family.close(production.elided, original(start), production.elided_owner)
            return prefix

        sites = {}
        for order, rule in enumerate(lowered.grammar.rules.values()):
            seen, index = set(), 0
            for alternative in rule.alternatives:
                key = id(alternative.conditions)
                if key in seen:
                    continue
                seen.add(key)
                for condition in alternative.conditions:
                    sites.setdefault(key, []).append((condition, (order, index, rule.name)))
                    index += 1

        def boundary_condition(condition, bound, obligations):
            found = atoms(condition)
            if not found:
                return (yield evaluator.walk_condition(condition, bound))
            atom = found[0]
            values = []
            try:
                for value in (True, False):
                    bound.boundary_value = value
                    try:
                        values.append(bool((yield evaluator.walk_condition(condition, bound))))
                    except InvalidObservation:
                        values.append(False)
            finally:
                bound.boundary_value = None
            yes, no = values
            if yes != no:
                p = bound.production
                source = p.lexical.root.source if p.lexical else p.source
                whole = atom["receiver"]["capture"] == ""
                # A lexical ancestor can evaluate the clause, but its own
                # final group alone owns a whole-rule literal.
                private = p.private_names | (p.lexical.known_private if p.lexical else set())
                from ._ranked import reads
                if not whole or not p.helper or bool(reads(next((raw for raw in source.conditions if atom in atoms(raw)), condition)) & p.private_names):
                    site = next((site for raw, site in sites.get(id(source.conditions), ()) if atom in atoms(raw)), None)
                    obligations.append((atom, boundaries.literal(atom, yes), site))
            return yes or no

        def boundary_step(p, position, start, at, edge, obligations):
            previous = edge[0]
            record = records[previous] if previous >= 0 else boundaries.empty
            notes = annotations[previous].retain(record) if previous >= 0 else Annotations()
            backward = forward = before = after = 0
            for atom, literal, site in obligations:
                if atom["receiver"]["capture"] == "":
                    if literal.direction == "f": forward |= literal.bit
                    else: backward |= literal.bit
                elif literal.direction == "f": after |= literal.bit
                else: before |= literal.bit
            def fail(literal, where, source):
                failures.append((literal, where, at, source))
            if previous >= 0:
                record = boundaries.append(record, before)
                for atom, literal, site in obligations:
                    if atom["receiver"]["capture"] and literal.direction == "p": notes.add("end", literal.bit, site)
                child = edge[2] if edge[1] == 2 else None
                leaf = records[child] if child is not None else boundaries.leaf(p.rhs[position-1], original(end[previous]) == original(at))
                sources = annotations[child] if child is not None else Annotations()
                advanced = boundaries.advance(record, leaf, lambda literal: fail(literal, end[previous], notes.meeting(sources, leaf.empty, literal.bit)))
                if advanced is None: return None
                notes = notes.advance(boundaries, record, leaf, advanced, sources)
                record = boundaries.append(advanced, after)
                for atom, literal, site in obligations:
                    if atom["receiver"]["capture"] and literal.direction == "f": notes.add("end", literal.bit, site)
            if position == len(p.rhs):
                completed = boundaries.complete(record, None if p.helper else p.rule_name, backward, forward, lambda literal: fail(literal, start if literal.direction == "f" else at, getattr(notes, "start" if literal.direction == "f" else "end").get(literal.bit)))
                if completed is None: return None
                record, notes = completed, notes.retain(completed)
                for atom, literal, site in obligations:
                    if atom["receiver"]["capture"] == "": notes.add("start" if not record.empty and literal.direction == "p" else "end", literal.bit, site)
                if p.lhs == start_rule and not p.helper and start == 0 and at == n:
                    if not boundaries.accepts(record, lambda literal: fail(literal, start if record.start & literal.bit else at, getattr(notes, "start" if record.start & literal.bit else "end").get(literal.bit))):
                        return None
            return record, notes

        def add(production: int, position: int, start: int, captured: Caps, at: int, edge: tuple[Any, ...], strict_step: bool = False, prefix: int = 0, close_prefix: int = 0, family_prefix: Summary = IDENTITY, obligations=None) -> None:
            bounded = None
            if boundaries is not None:
                obligations = prediction_obligations.pop((production, at), []) if obligations is None else obligations
                bounded = boundary_step(productions[production], position, start, at, edge, obligations)
                if bounded is None:
                    return
            structure = completed_structure(productions[production], position, prefix)
            key = (production, position, start, captured) + ((prefix, structure) if machine is not None else ())
            if closes is not None:
                close_prefix = closes.trim(close_prefix, original(start), original(at))
                close_structure = completed_closes(productions[production], position, start, at, close_prefix)
                key += close_prefix, close_structure
            if family is not None:
                if close_prefix == CloseMachine.INVALID:
                    family_prefix = DEAD
                family_structure = completed_family(productions[production], position, start, close_structure, family_prefix)
                key += family_prefix, family_structure
            if bounded is not None:
                key += (bounded[0].id,)
            found = sets[at].get(key)
            if found is not None and bounded is not None:
                annotations[found].merge(bounded[1])
            if found is None:
                _testing.count("items")
                found = len(prod)
                sets[at][key] = found
                if bounded is not None:
                    records.append(bounded[0])
                    annotations.append(bounded[1])
                prod.append(production)
                dot.append(position)
                origin.append(start)
                end.append(at)
                caps.append(captured)
                prefixes.append(prefix)
                structures.append(structure)
                if closes is not None:
                    close_prefixes.append(close_prefix)
                    close_structures.append(close_structure)
                if family is not None:
                    family.take(family_prefix)
                    family.take(family_structure)
                    family_prefixes.append(family_prefix)
                    family_structures.append(family_structure)
                edges.append([edge])
                if edge != SEED:
                    _testing.count("packed_edges")
                if recon:
                    strict.append(strict_step)
                    processed.append(False)
                if at == current[0]:
                    agenda.append(found)
                else:
                    following.append(found)
            elif recon:
                # An item is processed again where an ordinary step reaches
                # it after it was processed as strict, and that step can
                # repeat an edge it already has.
                edge_sets.add(found, edges[found], edge)
                if strict[found] and not strict_step:
                    # One ordinary step makes an item ordinary, and the
                    # recognizer then applies to it what its strictness held
                    # back (engine §7.4).
                    strict[found] = False
                    if processed[found] and not _testing.fault("reprocess"):
                        agenda.append(found)
            else:
                edges[found].append(edge)
                _testing.count("packed_edges")

        def entry(item,rule):
            if frames is None:
                return None
            p = productions[prod[item]]
            return frames.entry(p, dot[item], origin[item], prefixes[item], caps[item], rule, any(edge[1] == RESTORE for edge in edges[item]), close_prefixes[item] if closes is not None else 0, end[item], records[item] if boundaries is not None else None)

        def candidate(p, frame, requested=False):
            p = frames.production(p, frame) if frames is not None else p
            if closes is None:
                return p
            key = p.id, requested
            if key not in variants:
                q = replace(p, id=len(productions), base_id=p.real_id,
                            close_requested=requested,
                            observes_closes=requested or demand(p)[0])
                productions.append(q)
                demands[q.id] = demand(p)
                variants[key] = q
            return variants[key]

        def bound_for(production, captured, whole=None, structure=0, close_structure=0):
            frame = production.lexical
            if frame is not None and whole is not None:
                start, at, own = whole
                if closes is not None and frame.root.observes_closes and frame.seal_group is not None:
                    sealed = closes.seal(close_structure, block(production, start, at, frame, True))
                    close_structure = closes.concat(frame.seal_close_prefix, sealed)
                    close_structure = closes.complete(close_structure, frame.root.lhs, original(frame.origin), original(at))
                if own is not None:
                    memo = []
                    def parent_tag():
                        if not memo:
                            hidden = evaluator.bind(production, captured, (frame.origin, at, tagtab.empty), structure, close_structure)
                            memo.append(tagtab.intern(_as_set((yield evaluator.walk_value(production.parent_tags,hidden)))))
                        return memo[0]
                    whole = (frame.origin,at,parent_tag)
                else:
                    whole = (frame.origin,at,tagtab.empty)
                structure = machine.node(frame.root.rule_name,machine.concat(frame.seal_prefix,machine.sealed()))
            return evaluator.bind(production, captured, whole, structure, close_structure)

        def constituent_tag(production: Production, captured: Caps) -> int:
            """The tag set of a completed item whose production has no tag
            term (engine §4)."""
            if production.inherited is not None:
                return captured[production.slots[production.inherited]][2]
            return tagtab.empty

        def term_tag(production: Production, captured: Caps, start: int, at: int, structure: int = 0, close_structure: int = 0) -> Walk:
            """The tag set of a completed item from its production's tag
            term, which can ask nested parses (engine §4)."""
            bound = bound_for(production, captured, (start, at, None), structure, close_structure)
            return tagtab.intern(_as_set((yield evaluator.walk_value(production.tags_term, bound))))

        def lazy_tag(production: Production, captured: Caps, start: int, at: int, structure: int = 0, close_structure: int = 0) -> Callable[[], Walk]:
            """The walk of the tag set of a completing item, computed on
            first use (engine §4)."""
            memo: list[int] = []

            def tag() -> Walk:
                if not memo:
                    if production.tags_term is None:
                        memo.append(constituent_tag(production, captured))
                    else:
                        memo.append((yield term_tag(production, captured, start, at, structure, close_structure)))
                return memo[0]

            return tag

        def advance(
            item: int, part: tuple[int, ...], at: int, edge: tuple[Any, ...], strict_step: bool = False, read_tag: int = -1
        ) -> Walk | None:
            """Advances an item over a part. Where the advance makes
            conditions ready, it gives the walk that evaluates them and then
            adds the item, which the caller yields. A plain call costs less
            than a walk, so an advance without conditions makes none."""
            production = productions[prod[item]]
            position = dot[item]
            if strict_step and position + 1 == len(production.rhs):
                # A strict step that completes, route 3's read of T with
                # nothing after it, makes a strict item at the end of its
                # production. The step drops it before it evaluates
                # anything (engine §4, §7.4; JS earley.js, the written
                # routes).
                return None
            # A tested symbol's test must hold of its own span and tags, which
            # is checked before any condition the advance makes ready (engine
            # §4).
            tests = production.tests
            if tests is not None:
                test = tests[position]
                if test is not None:
                    if read_tag >= 0:
                        # A test of a terminal reads the token with its
                        # recognition values, a synthetic one's included
                        # (engine §7.5).
                        holds = context.test_holds(test, base + part[0], base + part[1], read_tag)
                    elif project is not None:
                        # In the check, a test of a reference reads its
                        # projected span and its constituent's tags (engine
                        # §7.5).
                        assert observed is not None
                        holds = observed.test_holds(test, project[part[0]], project[part[1]], part[2])
                    else:
                        holds = context.test_holds(test, base + part[0], base + part[1], part[2])
                    if not holds:
                        return None
            part_structure = 0
            prefix = 0
            close_prefix = 0
            part_closes = 0
            family_prefix = IDENTITY
            if machine is not None:
                part_structure = structures[edge[2]] if edge[1] == 2 else terminal_structure(production, position, edge[2], edge[3])
                symbol = production.rhs[position]
                exported = machine.sealed() if not production.terminal[position] and symbol in lowered.ranked_helpers else part_structure
                prefix = machine.concat(prefixes[item], exported)
                part = (*part[:3], part_structure)
            if closes is not None:
                if edge[1] == 2:
                    child = edge[2]
                    part_closes = close_structures[child]
                    symbol = production.rhs[position]
                    if production.observes_closes and not production.terminal[position] and symbol in lowered.ranked_helpers:
                        child_production = productions[prod[child]]
                        part_closes = closes.seal(part_closes, block(child_production, origin[child], end[child], child_production.lexical))
                elif recon and synthetic[edge[2]]:
                    part_closes = close_record(edge[3], edge[2], tokens[edge[2]].value)
                if production.observes_closes:
                    close_prefix = closes.concat(close_prefixes[item], part_closes)
                    close_prefix = closes.trim(close_prefix, original(origin[item]), original(at))
                part = (*part[:3], part_structure, part_closes)
            if family is not None:
                if edge[1] == 2:
                    child = edge[2]
                    part_summary = family_structures[child]
                    if production.observes_closes and production.rhs[position] in lowered.ranked_helpers:
                        child_production = productions[prod[child]]
                        part_summary = family.block(block(child_production, origin[child], end[child], child_production.lexical))
                else:
                    part_summary = family.token(original(edge[2]))
                family_prefix = family.join(family_prefixes[item], part_summary)
            captured = caps[item]
            if production.slots[position] >= 0:
                step = (captured, part)
                found = extended.get(step)
                if found is None:
                    found = extended[step] = Caps(captured, part)
                captured = found
            conditions = production.conds_at.get(position)
            if conditions or boundaries is not None and position + 1 == len(production.rhs) and production.tags_term is not None:
                return checked(production, position, origin[item], captured, at, edge, strict_step, conditions, prefix, close_prefix, family_prefix)
            add(production.id, position + 1, origin[item], captured, at, edge, strict_step, prefix, close_prefix, family_prefix)
            return None

        def checked(
            production: Production,
            position: int,
            start: int,
            captured: Caps,
            at: int,
            edge: tuple[Any, ...],
            strict_step: bool,
            conditions: list[Any],
            prefix: int,
            close_prefix: int,
            family_prefix: Summary = IDENTITY,
        ) -> Walk:
            """The conditions that an advance makes ready, in written order,
            and then the item, if they all hold. Once the constituent is
            complete, $ has its tags, and the tag term runs only where a
            condition reads them (engine §4)."""
            if production.whole_ready and position + 1 == len(production.rhs):
                structure = completed_structure(production, position + 1, prefix)
                close_structure = completed_closes(production, position + 1, start, at, close_prefix)
                bound = bound_for(production, captured, (start, at, lazy_tag(production, captured, start, at, structure, close_structure)), structure, close_structure)
            else:
                bound = bound_for(production, captured)
            obligations = []
            try:
                for condition in conditions or ():
                    if not (yield boundary_condition(condition, bound, obligations)):
                        return
            except InvalidObservation:
                return
            if boundaries is not None and position + 1 == len(production.rhs) and production.tags_term is not None:
                yield term_tag(production, captured, start, at, completed_structure(production, position + 1, prefix), completed_closes(production, position + 1, start, at, close_prefix))
            add(production.id, position + 1, start, captured, at, edge, strict_step, prefix, close_prefix, family_prefix, obligations)

        # A production whose first symbol is a terminal the next token lacks
        # is not predicted, since its item could never advance; a rejection
        # at that position lists the terminals it expected all the same.
        by_first = lowered.by_first_terminal
        by_first_characters = lowered.by_first_characters
        not_terminal_first = lowered.not_terminal_first
        characters = lowered.characters
        carries = context.carries

        def allowed(production: Production, j: int) -> Walk:
            """Whether the prediction conditions of a production that has
            some hold at j."""
            # $ is bound for an empty production, whose span is empty at j.
            # Its tag term runs only where a condition reads $'s tags (engine
            # §4).
            structure = completed_structure(production, 0, 0)
            close_structure = completed_closes(production, 0, j, j, 0)
            whole = (j, j, lazy_tag(production, NO_CAPS, j, j, structure, close_structure)) if not production.rhs else None
            bound = bound_for(production, NO_CAPS, whole, structure, close_structure)
            obligations = []
            try:
                for condition in production.conds_predict:
                    if not (yield boundary_condition(condition, bound, obligations)):
                        return False
            except InvalidObservation:
                return False
            if boundaries is not None:
                prediction_obligations[production.id, j] = obligations
                if not production.rhs and production.tags_term is not None:
                    yield term_tag(production, NO_CAPS, j, j, structure, close_structure)
            return True

        def restore(number: int, j: int) -> None:
            """The restoration of an elidable optional at j (engine §7.4):
            its empty production read over the one synthetic token there,
            where that token is compatible with the optional. It is made in
            the next set, with no tags, and evaluates nothing of the
            optional's content."""
            assert synthetic is not None
            if j >= n or not synthetic[j]:
                return
            production = productions[number]
            if production.elided not in tokens[j].tags:
                return
            test = production.elided_test
            if test is not None and not context.test_holds(test, j, j + 1, token_tags[j]) and not _testing.fault("restore"):
                return
            restorations.append(number)

        def begin(rule: int, j: int, strict_prediction: bool = False, frame=None, requested=False) -> bool:
            """Whether a prediction of rule in set j adds anything, which
            then begins. A rule's productions are the same at every
            prediction in one set. A strict prediction (engine §7.4) leaves
            some out, so an ordinary one after it adds them."""
            key = prediction_key(rule,frame,requested)
            before = predicted[j].get(key)
            if before is not None and (before is False or strict_prediction):
                return False
            predicted[j][key] = strict_prediction
            return True

        def predict(rule: int, j: int, strict_prediction: bool = False, frame=None, requested=False) -> Walk:
            """The prediction that :func:`begin` began, a walk since its
            conditions can ask nested parses."""
            for number in not_terminal_first[rule]:
                production = candidate(productions[number],frame,requested)
                number = production.id
                if production.elided is not None and not omission_allowed(production):
                    continue
                if recon:
                    if not production.rhs and production.helper and production.elided is not None:
                        # The empty production of an elidable optional is its
                        # restoration, and never derives the empty sequence.
                        restore(number, j)
                        continue
                    # A strict prediction predicts only the productions that
                    # can read.
                    if strict_prediction and last_reading[production.real_id] < 0:
                        continue
                if not production.conds_predict or (yield allowed(production, j)):
                    add(number, 0, j, NO_CAPS, j, SEED, strict_prediction)
            if j < n:
                table = by_first[rule]
                if table:
                    for tag in tokens[base + j].tags:
                        for number in table.get(tag, ()):
                            p = candidate(productions[number],frame,requested)
                            number = p.id
                            if not p.conds_predict or (yield allowed(p, j)):
                                add(number, 0, j, NO_CAPS, j, SEED, strict_prediction)
                # A string, range, or wildcard matches the stored token value.
                table = by_first_characters[rule]
                if table:
                    token_tag = token_tags[base + j]
                    for terminal, numbers in table.items():
                        if carries(terminal, base + j):
                            for number in numbers:
                                p = candidate(productions[number],frame,requested)
                                number = p.id
                                if not p.conds_predict or (yield allowed(p, j)):
                                    add(number, 0, j, NO_CAPS, j, SEED, strict_prediction)

        current = [0]
        following: list[int] = []
        if begin(start_rule, 0, requested=self.observe):
            yield from predict(start_rule, 0, requested=self.observe)
        furthest = 0
        for j in range(n + 1):
            current[0] = j
            if j > 0:
                agenda = following
                following = []
            if not agenda and not sets[j]:
                break
            furthest = j
            while agenda:
                item = agenda.pop()
                production = productions[prod[item]]
                position = dot[item]
                if recon:
                    if processed[item]:
                        # An item that an ordinary step reached after it was
                        # processed as strict: the ordinary prediction of its
                        # next symbol, and its advances over empty
                        # constituents (engine §7.4). The step's own edge is
                        # already in place.
                        if _testing.fault("again"):
                            continue
                        if position < len(production.rhs) and not production.terminal[position]:
                            rule = production.rhs[position]
                            frame = entry(item,rule)
                            requested = request_child(production, position, j)
                            if begin(rule, j,frame=frame,requested=requested):  # type: ignore[arg-type]
                                yield from predict(rule, j,frame=frame,requested=requested)  # type: ignore[arg-type]
                            for child in empty_done[j].get(prediction_key(rule,frame,requested), ()):  # type: ignore[arg-type]
                                walk = advance(item, (j, j, tag[child]), j, (item, 2, child, 0))
                                if walk is not None:
                                    yield walk
                        continue
                    processed[item] = True
                if position < len(production.rhs):
                    symbol = production.rhs[position]
                    if production.terminal[position]:
                        scanning[j].setdefault(symbol, []).append(item)  # type: ignore[arg-type]
                        continue
                    rule = symbol
                    frame = entry(item,rule)
                    requested = request_child(production, position, j)
                    waiting[j].setdefault(prediction_key(rule,frame,requested), []).append(item)  # type: ignore[arg-type]
                    if recon and strict[item]:
                        if last_reading[production.real_id] <= position:
                            # No symbol after the next one can read: the
                            # strict item predicts its next symbol strictly,
                            # and does not advance over an empty constituent
                            # (engine §7.4).
                            if begin(rule, j, True,frame,requested):  # type: ignore[arg-type]
                                yield from predict(rule, j, True,frame,requested)  # type: ignore[arg-type]
                            continue
                        if begin(rule, j,frame=frame,requested=requested):  # type: ignore[arg-type]
                            yield from predict(rule, j,frame=frame,requested=requested)  # type: ignore[arg-type]
                        for child in empty_done[j].get(prediction_key(rule,frame,requested), ()):  # type: ignore[arg-type]
                            walk = advance(item, (j, j, tag[child]), j, (item, 2, child, 0), True)
                            if walk is not None:
                                yield walk
                        continue
                    if begin(rule, j,frame=frame,requested=requested):  # type: ignore[arg-type]
                        yield from predict(rule, j,frame=frame,requested=requested)  # type: ignore[arg-type]
                    for child in empty_done[j].get(prediction_key(rule,frame,requested), ()):  # type: ignore[arg-type]
                        walk = advance(item, (j, j, tag[child]), j, (item, 2, child, 0))
                        if walk is not None:
                            yield walk
                    continue
                # A completed item: its tag set, then the items waiting for it.
                start = origin[item]
                if production.tags_term is None:
                    tag[item] = constituent_tag(production, caps[item])
                else:
                    try:
                        tag[item] = yield term_tag(production, caps[item], start, j, structures[item], close_structures[item] if closes is not None else 0)
                    except InvalidObservation:
                        continue
                lhs = production.lhs
                part = (start, j, tag[item])
                if start == j:
                    empty_done[j].setdefault(prediction_key(lhs,production.lexical,production.close_requested), []).append(item)
                    if recon:
                        for waiter in list(waiting[start].get(prediction_key(lhs,production.lexical,production.close_requested), ())):
                            if not strict[waiter]:
                                walk = advance(waiter, part, j, (waiter, 2, item, 0))
                                if walk is not None:
                                    yield walk
                            elif last_reading[productions[prod[waiter]].real_id] > dot[waiter]:
                                # A strict item advances over an empty
                                # constituent only where a later symbol can
                                # read, and stays strict (engine §7.4).
                                walk = advance(waiter, part, j, (waiter, 2, item, 0), True)
                                if walk is not None:
                                    yield walk
                        continue
                for waiter in list(waiting[start].get(prediction_key(lhs,production.lexical,production.close_requested), ())):
                    walk = advance(waiter, part, j, (waiter, 2, item, 0))
                    if walk is not None:
                        yield walk
            if j < n:
                sets.append({})
                waiting.append({})
                scanning.append({})
                empty_done.append({})
                predicted.append({})
                token = tokens[base + j]
                token_tag = token_tags[base + j]
                if not recon:
                    for terminal, waiters in scanning[j].items():
                        # A string, range, or wildcard reads the stored
                        # value independently of tags (engine §4).
                        if carries(terminal, base + j) if characters and terminal in characters else terminal in token.tags:
                            for waiter in waiters:
                                walk = advance(waiter, (j, j + 1, token_tag), j + 1, (waiter, 1, j, terminal))
                                if walk is not None:
                                    yield walk
                    continue
                for number in restorations:
                    add(number, 0, j, NO_CAPS, j + 1, (-1, RESTORE, j, productions[number].elided))
                restorations.clear()
                # A terminal that reads a synthetic token captures no tags,
                # and a production that inherits from it inherits none
                # (engine §7.5).
                from_synthetic = synthetic[j]  # type: ignore[index]
                captured_tag = tagtab.empty if from_synthetic else token_tag
                for terminal, waiters in scanning[j].items():
                    if carries(terminal, base + j) if characters and terminal in characters else terminal in token.tags:
                        for waiter in waiters:
                            # The written route of an elidable optional from a
                            # synthetic token: the rest of the optional must
                            # read, so the item after its terminal is strict
                            # (engine §7.4).
                            route = from_synthetic and dot[waiter] == 0 and productions[prod[waiter]].lhs in elidable_helpers
                            route = route and not _testing.fault("route3")
                            walk = advance(waiter, (j, j + 1, captured_tag), j + 1, (waiter, 1, j, terminal), route, token_tag)
                            if walk is not None:
                                yield walk
        # The last set, if the parse reached it.
        final = sets[n] if n < len(sets) else {}
        roots = [
            item
            for item in final.values()
            if item in tag and origin[item] == 0 and productions[prod[item]].lhs == start_rule and dot[item] == len(productions[prod[item]].rhs)
            and productions[prod[item]].close_requested == self.observe
        ]
        expected: dict[str, set[str]] = {}
        here = tokens[base + furthest].tags if furthest < n else {}
        here_tag = token_tags[base + furthest] if furthest < n else None
        for prediction in predicted[furthest]:
            rule = prediction[0] if frames is not None or closes is not None else prediction
            requested = prediction[2] if closes is not None else False
            frame = next((f for f in frames.frames.values() if f.id==prediction[1]),None) if frames is not None else None
            for terminal, numbers in itertools.chain(by_first[rule].items(), by_first_characters[rule].items()):
                if here_tag is not None and (carries(terminal, base + furthest) if terminal in characters else terminal in here):
                    continue
                for number in numbers:
                    production = candidate(productions[number],frame,requested)
                    if not production.conds_predict or (yield allowed(production, furthest)):
                        written = written_symbol(terminal, production.tests[0] if production.tests else None)
                        expected.setdefault(written, set()).add(production.rule_name)
        for terminal, waiters in scanning[furthest].items():
            for waiter in waiters:
                production = productions[prod[waiter]]
                test = production.tests[dot[waiter]] if production.tests else None
                expected.setdefault(written_symbol(terminal, test), set()).add(production.rule_name)
        # The forest's tokens are those the parse read, before its furthest
        # set.
        return Forest(tokens[base : base + furthest], lowered, prod, dot, origin, end, caps, edges, tag, roots, furthest, expected, context.project, structures, machine, prefixes if has_slots else [], strict if has_slots else [], close_structures, close_prefixes, closes, self.observe, family, family_prefixes, family_structures, records, boundaries, annotations, failures)


def reading_last(lowered: Lowered) -> list[int]:
    """Which productions can read in the reconstruction mode of engine
    §7.4: for each production, the index of its last symbol that can read,
    or -1. A terminal can read, and so can a rule or helper with a
    production that can, the empty production of an elidable helper
    included, since in that mode it is the restoration, which reads a
    synthetic token. These are the least sets that the rules give, so a rule
    that can read only through itself cannot. Found once per lowered
    grammar."""
    found = lowered.reading_last
    if found is not None:
        return found
    productions = lowered.productions
    # A worklist, with the productions that use each rule: a pass over all
    # productions until nothing changes would find one rule of a long chain
    # at each pass.
    users: dict[int, list[Production]] = {}
    rules: set[int] = set()
    queue: list[int] = []
    for production in productions:
        restoration = not production.rhs and production.helper and production.elided is not None
        if restoration or any(production.terminal):
            if production.lhs not in rules:
                rules.add(production.lhs)
                queue.append(production.lhs)
        for symbol, terminal in zip(production.rhs, production.terminal):
            if not terminal:
                users.setdefault(symbol, []).append(production)  # type: ignore[arg-type]
    while queue:
        for production in users.get(queue.pop(), ()):
            if production.lhs not in rules:
                rules.add(production.lhs)
                queue.append(production.lhs)
    found = []
    for production in productions:
        at = -1
        for index, (symbol, terminal) in enumerate(zip(production.rhs, production.terminal)):
            if terminal or symbol in rules:
                at = index
        found.append(at)
    lowered.reading_last = found
    return found


def boundary_witnesses(forest, witnesses):
    machine = forest.boundary_machine
    return [item for item in witnesses if machine.accepts(forest.boundaries[item])] if machine is not None else witnesses
