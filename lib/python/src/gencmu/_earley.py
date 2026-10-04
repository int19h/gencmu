"""Recognition (engine §4): an Earley recognizer whose items hold their
captured parts' spans and tag sets, and the terms and conditions of engine
§10 that it evaluates."""

from __future__ import annotations

import itertools
import json
from dataclasses import dataclass, field
from typing import Any, Callable

from . import _testing
from ._clauses import WHOLE
from ._eligible import eligible
from ._errors import _GrammarFault
from ._grammar import Lowered, Production, SymbolTest, written_symbol
from ._model import Range, Tags, Token
from ._tags import EMPTY, TagTable, code_of_character_tag, difference, intersection, is_class, is_name, range_tags, split_string, union
from ._trampoline import Walk, run
from ._unicode import UnicodeTable

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
    compares them by identity (engine §4)."""

    __slots__ = ("parent", "part", "size")

    def __init__(self, parent: Caps | None, part: tuple[int, int, int] | None) -> None:
        self.parent = parent
        self.part = part
        self.size = 0 if parent is None else parent.size + 1

    def __len__(self) -> int:
        return self.size

    def __getitem__(self, slot: int) -> tuple[int, int, int]:
        """One slot's part, the last in constant time and an earlier one by
        a walk to it; ``parts`` reads them all in one walk."""
        if not 0 <= slot < self.size:
            raise IndexError(slot)
        found: Caps = self
        while found.size > slot + 1:
            assert found.parent is not None
            found = found.parent
            recognizer_counters.capture_steps += 1
        assert found.part is not None
        return found.part

    def parts(self) -> list[tuple[int, int, int]]:
        """Every slot's part, in slot order, read in one walk."""
        out: list[tuple[int, int, int]] = []
        found: Caps | None = self
        while found is not None and found.part is not None:
            out.append(found.part)
            found = found.parent
            recognizer_counters.capture_steps += 1
        out.reverse()
        return out


NO_CAPS = Caps(None, None)
"""The captured parts of an item that has none, which every parse shares."""

CONTENT_KEY_LIMIT = 64
"""The most tokens a span may have for a nested parse's answer to be kept
under its content, which equal spans at other positions share; a longer span
is kept under its position (engine §4)."""


class RecognizerCounters:
    """How many items and captured parts the recognizer has made, in parses
    and nested parses alike: measures of work and storage that tests compare
    across input lengths."""

    items = 0
    captures = 0
    # The steps taken through the shared captured parts, to read them.
    capture_steps = 0


recognizer_counters = RecognizerCounters()


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
    # Each token's phonemes in canonical form, for the sound tests of
    # symbols and for phonemes(), computed when one first looks at the token
    # (engine §4, §5).
    sounds: list[str | None] = field(init=False)
    # Whether a range or a property matches a tag set, by the terminal's
    # name and the set's number in the tag table (engine §4).
    carried: dict[tuple[str, int], bool] = field(default_factory=dict)
    # The tags of each range that a term holds, made once (engine §10).
    range_sets: dict[tuple[str, str], Tags] = field(default_factory=dict)
    # On the context of the reconstructed input R of the check of engine §7,
    # and nowhere else: whether each token of R is synthetic, by its
    # provenance (engine §7.2); π, the number of original tokens before each
    # position of R (engine §7.3); and the context of the stage's input,
    # whose tokens every observation reads and whose memo and nested parses
    # running the check's queries share (engine §7.5, §7.6).
    synthetic: list[bool] | None = None
    project: list[int] | None = None
    observed: StageContext | None = None

    def __post_init__(self) -> None:
        self.token_tags = [self.tagtab.intern(token.tags) for token in self.tokens]
        self.sources = Sources(self.tokens)
        self.sounds = [None] * len(self.tokens)

    def carries(self, terminal: str, tag_id: int) -> bool:
        """Whether a tag set holds a character tag of a range or a property,
        one of the lowered grammar's character terminals (engine §4). The
        terminal matches once however many of its tags qualify."""
        key = (terminal, tag_id)
        found = self.carried.get(key)
        if found is None:
            characters = self.lowered.characters[terminal]
            found = False
            for tag in self.tagtab.get(tag_id):
                code = code_of_character_tag(tag)
                if code < 0:
                    continue
                if isinstance(characters, str):
                    if self.unicode.has_property(characters, code):
                        found = True
                        break
                elif characters[0] <= code <= characters[1]:
                    found = True
                    break
            self.carried[key] = found
        return found

    def range_tags(self, ends: list[str]) -> Tags:
        """The character tags of a range in a term (engine §10)."""
        key = (ends[0], ends[1])
        found = self.range_sets.get(key)
        if found is None:
            found = self.range_sets[key] = range_tags(ends, self.unicode)
        return found

    def sound(self, index: int) -> str:
        """A token's phonemes in canonical form (engine §5), remembered for
        the parse. The lowercase mapping and the removal of commas act on
        each code point alone, so the canonical sound of a span is its
        tokens' joined."""
        sound = self.sounds[index]
        if sound is None:
            sound = self.sounds[index] = self.unicode.canonical(self.tokens[index].phonemes or "")
        return sound

    def test_holds(self, test: SymbolTest, start: int, end: int, tag_id: int) -> bool:
        """Whether a test holds of a symbol's own span, tokens start..end,
        and its own tags, the tag set numbered ``tag_id``: a token's for a
        terminal, the completed item's for a reference (engine §4). An empty
        span sounds like the empty string."""
        if test.sound is not None:
            return self.sound_is(test.sound, start, end) == (test.op == "=")
        return test.holds("", self.tagtab.get(tag_id))

    def sound_is(self, sound: str, start: int, end: int) -> bool:
        """Whether tokens start..end sound like a string: their canonical
        sound is exactly it (engine §4, §5). A token with no phonemes adds
        nothing."""
        offset = 0
        for index in range(start, end):
            part = self.sound(index)
            if not sound.startswith(part, offset):
                return False
            offset += len(part)
        return offset == len(sound)

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
                    self.tokens[index].phonemes,
                    self.tokens[index].source[0] - low,
                    self.tokens[index].source[1] - low,
                )
                for index in range(start, end)
            ),
        )

    def nested(self, rule: str, start: int, end: int) -> NestedAnswer:
        """Parse tokens start..end alone as rule (engine §4, nested parses):
        what matches and tags read."""
        key = self.nested_key(rule, start, end)
        found = self.memo.get(key)
        if found is not None:
            return found
        forest = self.parse_alone(rule, start, end)
        # The answer reads the completed items of the rule over the span
        # that have an eligible proof tree, under written-terminator
        # priority (engine §4).
        found_items = eligible(forest, forest.roots, self, start)
        tags: Tags = EMPTY
        for root in found_items:
            tags = union(tags, self.tagtab.get(forest.tag[root]))
        answer = NestedAnswer(bool(found_items), tags)
        self.memo[key] = answer
        return answer

    def begins(self, rule: str, start: int, end: int) -> bool:
        """Whether a prefix of tokens start..end, the empty one included,
        parses as rule: whether a completed item of the rule with an
        eligible proof tree begins at the span's start, in any set (engine
        §4)."""
        key = self.nested_key(rule, start, end)
        found = self.begins_memo.get(key)
        if found is not None:
            return found
        forest = self.parse_alone(rule, start, end)
        number = self.lowered.rule_ids[rule]
        productions = self.lowered.productions
        witnesses = [
            item
            for item, (prod, dot, origin) in enumerate(zip(forest.prod, forest.dot, forest.origin))
            if origin == 0 and productions[prod].lhs == number and dot == len(productions[prod].rhs)
        ]
        # Only an item with an eligible proof tree counts (engine §4).
        answer = bool(eligible(forest, witnesses, self, start))
        self.begins_memo[key] = answer
        return answer

    def parse_alone(self, rule: str, start: int, end: int) -> Forest:
        """The forest of tokens start..end parsed alone as rule. A parse in
        progress is known by its rule and span, whatever a condition asks of
        it, so that alternating matches, begins and tags cannot hide a
        question about a span from inside its own parse (engine §4)."""
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
            return Parser(self, start, end).parse(number)
        finally:
            self.running.discard(running)


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

    def bind(
        self, production: Production, caps: Caps, whole: tuple[int, int, int | Callable[[], int] | None] | None = None
    ) -> dict[str, tuple[int, int, int]]:
        """The captures of an item, and ``$`` when ``whole`` gives the
        constituent's span and tag set (``None`` while its tag set is being
        computed, when no term may read it)."""
        bound: dict[str, tuple[int, int, int]] = {}
        base = self.base
        project = self.project
        # The parts in one walk, not a walk for each capture.
        parts = caps.parts() if production.captures else []
        for name, position in production.captures.items():
            slot = production.slots[position]
            if 0 <= slot < len(parts):
                start, end, tag = parts[slot]
                if project is None:
                    bound[name] = (start + base, end + base, tag)
                else:
                    # A capture keeps its constituent's own tags, also where
                    # its span projects to empty (engine §7.5).
                    bound[name] = (project[start], project[end], tag)
        if whole is not None:
            if project is None:
                bound[WHOLE] = (whole[0] + base, whole[1] + base, whole[2])  # type: ignore[assignment]
            else:
                bound[WHOLE] = (project[whole[0]], project[whole[1]], whole[2])  # type: ignore[assignment]
        return bound

    def _span(self, dom: Any, bound: dict[str, tuple[int, int, int]]) -> Walk:
        if isinstance(dom, dict):
            if "capture" in dom:
                found = bound.get(dom["capture"])
                if found is None:
                    raise _GrammarFault(f"${dom['capture']} is not captured here")
                return found
            name = dom.get("call")
            if name in ("head", "tail", "last", "from", "after"):
                args = dom.get("args", [])
                if len(args) != 1:
                    raise _GrammarFault(f"{name}() takes one span")
                start, end, _ = yield self._span(args[0], bound)
                # To the end of the input of the parse that evaluates the
                # condition: the stage's, or a nested parse's span (engine
                # §10).
                if name == "from":
                    return (start, self.end, None)
                if name == "after":
                    return (end, self.end, None)
                if start >= end:
                    return (start, start, None)
                if name == "head":
                    return (start, start + 1, None)
                if name == "tail":
                    return (start + 1, end, None)
                return (end - 1, end, None)
        raise _GrammarFault("a span is needed here")

    def span_tags(self, span: tuple[int, int, int | Callable[[], int] | None]) -> Tags:
        start, end, whole = span
        if whole is not None:
            # $ of a completing item gives its tags on first use (engine §4).
            return self.context.tagtab.get(whole() if callable(whole) else whole)
        result: Tags = EMPTY
        for index in range(start, end):
            result = union(result, self.context.tokens[index].tags)
        return result

    def phonemes(self, start: int, end: int) -> str:
        """The canonical sound of tokens start..end (engine §5)."""
        sound = self.context.sound
        return "".join(sound(index) for index in range(start, end))

    def _value(self, dom: Any, bound: dict[str, tuple[int, int, int]]) -> Walk:
        """A term's value (engine §10): a string, or a set, of strings or of
        tags."""
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
        if "range" in dom:
            return self.context.range_tags(dom["range"])
        if "emptySet" in dom:
            return EMPTY
        if "if" in dom:
            # A guarded term: its term is evaluated only where its condition
            # holds (engine §10).
            if (yield self._condition(dom["if"], bound)):
                return _as_set((yield self._value(dom["then"], bound)))
            return EMPTY
        if "union" in dom:
            result: frozenset[str] = EMPTY
            for item in dom["union"]:
                result = union(result, _as_set((yield self._value(item, bound))))
            return result
        if "intersection" in dom:
            parts = dom["intersection"]
            result = _as_set((yield self._value(parts[0], bound)))
            for item in parts[1:]:
                result = intersection(result, _as_set((yield self._value(item, bound))))
            return result
        if "difference" in dom:
            left = _as_set((yield self._value(dom["difference"][0], bound)))
            return difference(left, _as_set((yield self._value(dom["difference"][1], bound))))
        name = dom.get("call")
        if name is not None:
            args = dom.get("args", [])
            if name == "split":
                # A set of strings (engine §10); an empty delimiter that only
                # a parse sees is an error of the grammar.
                text = _as_string((yield self._value(args[0], bound)))
                delimiter = _as_string((yield self._value(args[1], bound)))
                if delimiter == "":
                    raise _GrammarFault("split has an empty delimiter")
                return split_string(text, delimiter)
            if name == "tag":
                text = _as_string((yield self._value(args[0], bound)))
                if not is_name(text):
                    raise _GrammarFault(f"tag({json.dumps(text, ensure_ascii=False)}): the string is not a name")
                return frozenset((text,))
            if name == "classify":
                # The classes that the classifier gives the string, for the
                # features of the parse, or none for an unknown key (engine
                # §10).
                key = _as_string((yield self._value(args[0], bound)))
                table = self.context.lowered.classifiers.get(args[1]["classifier"])
                return table.get(key, EMPTY) if table is not None else EMPTY
            if name == "tags" and len(args) == 2:
                start, end, _ = yield self._span(args[0], bound)
                return self.context.nested(args[1]["rule"], start, end).tags
            span = yield self._span(args[0], bound)
            if name == "phonemes":
                return self.phonemes(span[0], span[1])
            if name == "text":
                return self.context.span_text(span[0], span[1])
            if name == "tags":
                return self.span_tags(span)
            if name == "classes":
                return frozenset(tag for tag in self.span_tags(span) if is_class(tag))
            raise _GrammarFault(f"an unknown function {name}()")
        raise _GrammarFault("a span is used where a value is needed")

    def value(self, dom: Any, bound: dict[str, tuple[int, int, int]]) -> Any:
        return run(self._value(dom, bound))

    def tags(self, dom: Any, bound: dict[str, tuple[int, int, int]]) -> Tags:
        return _as_set(self.value(dom, bound))

    def condition(self, dom: Any, bound: dict[str, tuple[int, int, int]]) -> bool:
        return bool(run(self._condition(dom, bound)))

    def _condition(self, dom: Any, bound: dict[str, tuple[int, int, int]]) -> Walk:
        if "op" in dom:
            op = dom["op"]
            left = yield self._value(dom["left"], bound)
            right = yield self._value(dom["right"], bound)
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
        if "matches" in dom:
            start, end, _ = yield self._span(dom["matches"], bound)
            return self.context.nested(dom["rule"], start, end).accepted
        if "begins" in dom:
            start, end, _ = yield self._span(dom["begins"], bound)
            return self.context.begins(dom["rule"], start, end)
        if "initial" in dom:
            # Where the input of the parse that reads the condition begins:
            # the stage's, or a nested parse's span (engine §10).
            start, _, _ = yield self._span(dom["initial"], bound)
            return start == self.base
        if "not" in dom:
            return not (yield self._condition(dom["not"], bound))
        if "if" in dom:
            # The consequent is evaluated only where the premise holds
            # (engine §10, "Order of evaluation").
            if not (yield self._condition(dom["if"], bound)):
                return True
            return bool((yield self._condition(dom["then"], bound)))
        if "captured" in dom:
            # Decided for each production when it is lowered (engine §3.6).
            raise _GrammarFault("a presence test outlived lowering")
        if "any" in dom:
            for item in dom["any"]:
                if (yield self._condition(item, bound)):
                    return True
            return False
        if "all" in dom:
            for item in dom["all"]:
                if not (yield self._condition(item, bound)):
                    return False
            return True
        raise _GrammarFault("an unknown condition")


class Parser:
    """One Earley parse of tokens start..end of a stage's input."""

    def __init__(self, context: StageContext, start: int = 0, end: int | None = None) -> None:
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
        context = self.context
        lowered = context.lowered
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

        prod: list[int] = []
        dot: list[int] = []
        origin: list[int] = []
        end: list[int] = []
        caps: list[Caps] = []
        # The interned captured parts, each by the parts it extends and the
        # part it adds.
        extended: dict[tuple[Caps, tuple[int, int, int]], Caps] = {}
        edges: list[list[tuple[Any, ...]]] = []
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

        def add(production: int, position: int, start: int, captured: Caps, at: int, edge: tuple[Any, ...], strict_step: bool = False) -> None:
            key = (production, position, start, captured)
            found = sets[at].get(key)
            if found is None:
                found = len(prod)
                sets[at][key] = found
                prod.append(production)
                dot.append(position)
                origin.append(start)
                end.append(at)
                caps.append(captured)
                edges.append([edge])
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
                found_edges = edges[found]
                if edge not in found_edges:
                    found_edges.append(edge)
                if strict[found] and not strict_step:
                    # One ordinary step makes an item ordinary, and the
                    # recognizer then applies to it what its strictness held
                    # back (engine §7.4).
                    strict[found] = False
                    if processed[found] and not _testing.fault("reprocess"):
                        agenda.append(found)
            else:
                edges[found].append(edge)

        def constituent_tag(production: Production, captured: Caps, start: int, at: int) -> int:
            """The tag set of a completed item (engine §4)."""
            if production.tags_term is not None:
                bound = evaluator.bind(production, captured, (start, at, None))
                return tagtab.intern(evaluator.tags(production.tags_term, bound))
            if len(production.rhs) == 1:
                return captured[production.slots[0]][2]
            return tagtab.empty

        def lazy_tag(production: Production, captured: Caps, start: int, at: int) -> Callable[[], int]:
            """The tag set of a completing item, computed on first use (engine
            §4)."""
            memo: list[int] = []

            def tag() -> int:
                if not memo:
                    memo.append(constituent_tag(production, captured, start, at))
                return memo[0]

            return tag

        def advance(item: int, part: tuple[int, int, int], at: int, edge: tuple[Any, ...], strict_step: bool = False, read_tag: int = -1) -> None:
            production = productions[prod[item]]
            position = dot[item]
            if strict_step and position + 1 == len(production.rhs):
                # A strict step that completes, route 3's read of T with
                # nothing after it, makes a strict item at the end of its
                # production. The step drops it before it evaluates
                # anything (engine §4, §7.4; JS earley.js, the written
                # routes).
                return
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
                        return
            captured = caps[item]
            if production.slots[position] >= 0:
                step = (captured, part)
                found = extended.get(step)
                if found is None:
                    found = extended[step] = Caps(captured, part)
                    recognizer_counters.captures += 1
                captured = found
            conditions = production.conds_at.get(position)
            if conditions:
                # The conditions that the advance makes ready, in written
                # order. Once the constituent is complete, $ has its tags,
                # and the tag term runs only where a condition reads them
                # (engine §4).
                if production.whole_ready and position + 1 == len(production.rhs):
                    bound = evaluator.bind(production, captured, (origin[item], at, lazy_tag(production, captured, origin[item], at)))
                else:
                    bound = evaluator.bind(production, captured)
                for condition in conditions:
                    if not evaluator.condition(condition, bound):
                        return
            add(production.id, position + 1, origin[item], captured, at, edge, strict_step)

        # A production whose first symbol is a terminal the next token lacks
        # is not predicted, since its item could never advance; a rejection
        # at that position lists the terminals it expected all the same.
        by_first = lowered.by_first_terminal
        by_first_characters = lowered.by_first_characters
        not_terminal_first = lowered.not_terminal_first
        characters = lowered.characters
        carries = context.carries

        def allowed(production: Production, j: int) -> bool:
            if not production.conds_predict:
                return True
            # $ is bound for an empty production, whose span is empty at j.
            # Its tag term runs only where a condition reads $'s tags (engine
            # §4).
            whole = (j, j, lazy_tag(production, NO_CAPS, j, j)) if not production.rhs else None
            bound = evaluator.bind(production, NO_CAPS, whole)
            return all(evaluator.condition(c, bound) for c in production.conds_predict)

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

        def predict(rule: int, j: int, strict_prediction: bool = False) -> None:
            # A rule's productions are the same at every prediction in one
            # set. A strict prediction (engine §7.4) leaves some out, so an
            # ordinary one after it adds them.
            before = predicted[j].get(rule)
            if before is not None and (before is False or strict_prediction):
                return
            predicted[j][rule] = strict_prediction
            for number in not_terminal_first[rule]:
                production = productions[number]
                if recon:
                    if not production.rhs and production.helper and production.elided is not None:
                        # The empty production of an elidable optional is its
                        # restoration, and never derives the empty sequence.
                        restore(number, j)
                        continue
                    # A strict prediction predicts only the productions that
                    # can read.
                    if strict_prediction and last_reading[number] < 0:
                        continue
                if allowed(production, j):
                    add(number, 0, j, NO_CAPS, j, SEED, strict_prediction)
            if j < n:
                table = by_first[rule]
                if table:
                    for tag in tokens[base + j].tags:
                        for number in table.get(tag, ()):
                            if allowed(productions[number], j):
                                add(number, 0, j, NO_CAPS, j, SEED, strict_prediction)
                # A range or a property matches by the token's characters.
                table = by_first_characters[rule]
                if table:
                    token_tag = token_tags[base + j]
                    for terminal, numbers in table.items():
                        if carries(terminal, token_tag):
                            for number in numbers:
                                if allowed(productions[number], j):
                                    add(number, 0, j, NO_CAPS, j, SEED, strict_prediction)

        current = [0]
        following: list[int] = []
        predict(start_rule, 0)
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
                            predict(rule, j)  # type: ignore[arg-type]
                            for child in empty_done[j].get(rule, ()):  # type: ignore[arg-type]
                                advance(item, (j, j, tag[child]), j, (item, 2, child, 0))
                        continue
                    processed[item] = True
                if position < len(production.rhs):
                    symbol = production.rhs[position]
                    if production.terminal[position]:
                        scanning[j].setdefault(symbol, []).append(item)  # type: ignore[arg-type]
                        continue
                    rule = symbol
                    waiting[j].setdefault(rule, []).append(item)  # type: ignore[arg-type]
                    if recon and strict[item]:
                        if last_reading[production.id] <= position:
                            # No symbol after the next one can read: the
                            # strict item predicts its next symbol strictly,
                            # and does not advance over an empty constituent
                            # (engine §7.4).
                            predict(rule, j, True)  # type: ignore[arg-type]
                            continue
                        predict(rule, j)  # type: ignore[arg-type]
                        for child in empty_done[j].get(rule, ()):  # type: ignore[arg-type]
                            advance(item, (j, j, tag[child]), j, (item, 2, child, 0), True)
                        continue
                    predict(rule, j)  # type: ignore[arg-type]
                    for child in empty_done[j].get(rule, ()):  # type: ignore[arg-type]
                        advance(item, (j, j, tag[child]), j, (item, 2, child, 0))
                    continue
                # A completed item: its tag set, then the items waiting for it.
                start = origin[item]
                tag[item] = constituent_tag(production, caps[item], start, j)
                lhs = production.lhs
                part = (start, j, tag[item])
                if start == j:
                    empty_done[j].setdefault(lhs, []).append(item)
                    if recon:
                        for waiter in list(waiting[start].get(lhs, ())):
                            if not strict[waiter]:
                                advance(waiter, part, j, (waiter, 2, item, 0))
                            elif last_reading[prod[waiter]] > dot[waiter]:
                                # A strict item advances over an empty
                                # constituent only where a later symbol can
                                # read, and stays strict (engine §7.4).
                                advance(waiter, part, j, (waiter, 2, item, 0), True)
                        continue
                for waiter in list(waiting[start].get(lhs, ())):
                    advance(waiter, part, j, (waiter, 2, item, 0))
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
                        # A range or a property matches by the token's
                        # characters, and never by a tag (engine §4).
                        if carries(terminal, token_tag) if characters and terminal in characters else terminal in token.tags:
                            for waiter in waiters:
                                advance(waiter, (j, j + 1, token_tag), j + 1, (waiter, 1, j, terminal))
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
                    if carries(terminal, token_tag) if characters and terminal in characters else terminal in token.tags:
                        for waiter in waiters:
                            # The written route of an elidable optional from a
                            # synthetic token: the rest of the optional must
                            # read, so the item after its terminal is strict
                            # (engine §7.4).
                            route = from_synthetic and dot[waiter] == 0 and productions[prod[waiter]].lhs in elidable_helpers
                            route = route and not _testing.fault("route3")
                            advance(waiter, (j, j + 1, captured_tag), j + 1, (waiter, 1, j, terminal), route, token_tag)
        # The last set, if the parse reached it.
        final = sets[n] if n < len(sets) else {}
        roots = [
            item
            for item in final.values()
            if origin[item] == 0 and productions[prod[item]].lhs == start_rule and dot[item] == len(productions[prod[item]].rhs)
        ]
        expected: dict[str, set[str]] = {}
        here = tokens[base + furthest].tags if furthest < n else {}
        here_tag = token_tags[base + furthest] if furthest < n else None
        for rule in predicted[furthest]:
            for terminal, numbers in itertools.chain(by_first[rule].items(), by_first_characters[rule].items()):
                if here_tag is not None and (carries(terminal, here_tag) if terminal in characters else terminal in here):
                    continue
                for number in numbers:
                    production = productions[number]
                    if allowed(production, furthest):
                        written = written_symbol(terminal, production.tests[0] if production.tests else None)
                        expected.setdefault(written, set()).add(production.rule_name)
        for terminal, waiters in scanning[furthest].items():
            for waiter in waiters:
                production = productions[prod[waiter]]
                test = production.tests[dot[waiter]] if production.tests else None
                expected.setdefault(written_symbol(terminal, test), set()).add(production.rule_name)
        # The forest's tokens are those the parse read, before its furthest
        # set.
        return Forest(tokens[base : base + furthest], lowered, prod, dot, origin, end, caps, edges, tag, roots, furthest, expected)


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
    rules: set[int] = set()
    changed = True
    while changed:
        changed = False
        for production in productions:
            if production.lhs in rules:
                continue
            restoration = not production.rhs and production.helper and production.elided is not None
            if restoration or any(terminal or symbol in rules for symbol, terminal in zip(production.rhs, production.terminal)):
                rules.add(production.lhs)
                changed = True
    found = []
    for production in productions:
        at = -1
        for index, (symbol, terminal) in enumerate(zip(production.rhs, production.terminal)):
            if terminal or symbol in rules:
                at = index
        found.append(at)
    lowered.reading_last = found
    return found
