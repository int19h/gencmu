"""Recognition (engine §4): an Earley recognizer whose items hold their
captured parts' spans and tag sets, and the terms and conditions of engine
§10 that it evaluates."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from ._clauses import WHOLE
from ._errors import _GrammarFault
from ._grammar import Lowered, Production
from ._model import Tags, Token
from ._tags import PAUSE, TagTable, intersection, union
from ._trampoline import Walk, run
from ._unicode import UnicodeTable

SEED = (-1, 0, 0, 0)
"""The edge of a predicted item: (predecessor, kind, a, b), where kind is 0
for a prediction, 1 for a read of token a as terminal b, 2 for a completed
child item a."""

Caps = tuple[tuple[int, int, int], ...]

CONTENT_KEY_LIMIT = 64
"""The most tokens a span may have for a nested parse's answer to be kept
under its content, which equal spans at other positions share; a longer span
is kept under its position (engine §4)."""


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

    def __post_init__(self) -> None:
        self.token_tags = [self.tagtab.intern(token.tags) for token in self.tokens]

    def span_text(self, start: int, end: int) -> str:
        if start >= end:
            return ""
        return self.text[self.tokens[start].source[0] : self.tokens[end - 1].source[1]]

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
        return (
            rule,
            self.span_text(start, end),
            tuple((self.token_tags[index], self.tokens[index].text, self.tokens[index].phonemes) for index in range(start, end)),
        )

    def nested(self, rule: str, start: int, end: int) -> NestedAnswer:
        """Parse tokens start..end alone as rule (engine §4, nested parses):
        what matches and tags read."""
        key = self.nested_key(rule, start, end)
        found = self.memo.get(key)
        if found is not None:
            return found
        forest = self.parse_alone(rule, start, end)
        # The answer reads the items: every completed item of the rule over
        # the span, whether or not its derivations are all cyclic.
        tags: Tags = {}
        for root in forest.roots:
            tags = union(tags, self.tagtab.get(forest.tag[root]))
        answer = NestedAnswer(bool(forest.roots), tags)
        self.memo[key] = answer
        return answer

    def begins(self, rule: str, start: int, end: int) -> bool:
        """Whether a prefix of tokens start..end, the empty one included,
        parses as rule: whether a completed item of the rule begins at the
        span's start, in any set (engine §4)."""
        key = self.nested_key(rule, start, end)
        found = self.begins_memo.get(key)
        if found is not None:
            return found
        forest = self.parse_alone(rule, start, end)
        number = self.lowered.rule_ids[rule]
        productions = self.lowered.productions
        answer = any(
            origin == 0 and productions[prod].lhs == number and dot == len(productions[prod].rhs)
            for prod, dot, origin in zip(forest.prod, forest.dot, forest.origin)
        )
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
                f"a condition asks about tokens {start}..{end} as {rule} from inside the parse of that span as {rule}",
                (start, end),
            )
        number = self.lowered.rule_ids.get(rule)
        if number is None:
            raise _GrammarFault(f"{rule} is not a rule of this stage", (start, end))
        self.running.add(running)
        try:
            return Parser(self, start, end).parse(number)
        finally:
            self.running.discard(running)


def _as_tags(value: Any) -> Tags:
    """A value where a tag set is needed (engine §10): a string is the set of
    that one strong tag."""
    if isinstance(value, str):
        return {value: True}
    return value


class Evaluator:
    """Terms and conditions (engine §10) over one parse's captures."""

    def __init__(self, context: StageContext, base: int, end: int) -> None:
        self.context = context
        # Where the parse's input begins, in the stage's tokens: the captures
        # count from here, and initial() holds here (engine §10).
        self.base = base
        # Where it ends: from() and after() run to here.
        self.end = end

    def bind(
        self, production: Production, caps: Caps, whole: tuple[int, int, int | None] | None = None
    ) -> dict[str, tuple[int, int, int]]:
        """The captures of an item, and ``$`` when ``whole`` gives the
        constituent's span and tag set (``None`` while its tag set is being
        computed, when no term may read it)."""
        bound: dict[str, tuple[int, int, int]] = {}
        base = self.base
        for name, position in production.captures.items():
            slot = production.slots[position]
            if 0 <= slot < len(caps):
                start, end, tag = caps[slot]
                bound[name] = (start + base, end + base, tag)
        if whole is not None:
            bound[WHOLE] = (whole[0] + base, whole[1] + base, whole[2])  # type: ignore[assignment]
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

    def span_tags(self, span: tuple[int, int, int | None]) -> Tags:
        start, end, whole = span
        if whole is not None:
            return self.context.tagtab.get(whole)
        result: Tags = {}
        for index in range(start, end):
            result = union(result, self.context.tokens[index].tags)
        return result

    def phonemes(self, start: int, end: int) -> str:
        return "".join(token.phonemes or "" for token in self.context.tokens[start:end])

    def _value(self, dom: Any, bound: dict[str, tuple[int, int, int]]) -> Walk:
        if "literal" in dom:
            return dom["literal"]
        if "weak" in dom:
            return {dom["weak"]: False}
        if "emptySet" in dom:
            return {}
        if "if" in dom:
            # A guarded term: its term is evaluated only where its condition
            # holds (engine §10).
            if (yield self._condition(dom["if"], bound)):
                return _as_tags((yield self._value(dom["then"], bound)))
            return {}
        if "union" in dom:
            result: Tags = {}
            for item in dom["union"]:
                result = union(result, _as_tags((yield self._value(item, bound))))
            return result
        if "intersection" in dom:
            parts = dom["intersection"]
            result = _as_tags((yield self._value(parts[0], bound)))
            for item in parts[1:]:
                result = intersection(result, _as_tags((yield self._value(item, bound))))
            return result
        name = dom.get("call")
        if name is not None:
            args = dom.get("args", [])
            if name == "lowercase":
                text = yield self._value(args[0], bound)
                if not isinstance(text, str):
                    raise _GrammarFault("lowercase() takes a string")
                return self.context.unicode.lowercase(text)
            if name == "tags" and len(args) == 2:
                start, end, _ = yield self._span(args[0], bound)
                return dict(self.context.nested(args[1]["rule"], start, end).tags)
            span = yield self._span(args[0], bound)
            if name == "phonemes":
                return self.phonemes(span[0], span[1])
            if name == "text":
                return self.context.span_text(span[0], span[1])
            if name == "words":
                # The words between pauses, each a strong tag (engine §5).
                return {word: True for word in self.phonemes(span[0], span[1]).split(PAUSE) if word}
            if name == "tags":
                return dict(self.span_tags(span))
            if name == "classes":
                return {tag: strong for tag, strong in self.span_tags(span).items() if "A" <= tag[:1] <= "Z"}
            raise _GrammarFault(f"an unknown function {name}()")
        if "capture" in dom:
            # A bare capture is its tags (engine §10).
            return dict(self.span_tags((yield self._span(dom, bound))))
        raise _GrammarFault("a span is used where a value is needed")

    def value(self, dom: Any, bound: dict[str, tuple[int, int, int]]) -> Any:
        return run(self._value(dom, bound))

    def tags(self, dom: Any, bound: dict[str, tuple[int, int, int]]) -> Tags:
        return _as_tags(self.value(dom, bound))

    def condition(self, dom: Any, bound: dict[str, tuple[int, int, int]]) -> bool:
        return bool(run(self._condition(dom, bound)))

    def _condition(self, dom: Any, bound: dict[str, tuple[int, int, int]]) -> Walk:
        if "op" in dom:
            op = dom["op"]
            left = yield self._value(dom["left"], bound)
            right = yield self._value(dom["right"], bound)
            if op in ("=", "≠"):
                if isinstance(left, str) and isinstance(right, str):
                    equal = left == right
                else:
                    equal = _as_tags(left).keys() == _as_tags(right).keys()
                return equal if op == "=" else not equal
            if op in ("∈", "∉"):
                if not isinstance(left, str):
                    raise _GrammarFault(f"the left side of {op} is a string")
                inside = left in right if isinstance(right, dict) else left == right
                return inside if op == "∈" else not inside
            if op == "⊆":
                return _as_tags(left).keys() <= _as_tags(right).keys()
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
        self.evaluator = Evaluator(context, start, self.end)

    def parse(self, start_rule: int) -> Forest:
        context = self.context
        lowered = context.lowered
        productions = lowered.productions
        rule_productions = lowered.rule_productions
        # The stage's tokens, read from base on: a copy of the rest of a long
        # text would cost a nested parse its length.
        tokens = context.tokens
        token_tags = context.token_tags
        base = self.base
        tagtab = context.tagtab
        evaluator = self.evaluator
        n = self.end - base

        prod: list[int] = []
        dot: list[int] = []
        origin: list[int] = []
        end: list[int] = []
        caps: list[Caps] = []
        edges: list[list[tuple[Any, ...]]] = []
        tag: dict[int, int] = {}
        # A set is made when the parse reaches it: once one is empty, every
        # later one is, and a nested parse over the rest of a long text stops
        # there.
        sets: list[dict[tuple[Any, ...], int]] = [{}]
        waiting: list[dict[int, list[int]]] = [{}]
        scanning: list[dict[str, list[int]]] = [{}]
        empty_done: list[dict[int, list[int]]] = [{}]
        predicted: list[set[int]] = [set()]
        agenda: list[int] = []

        def add(production: int, position: int, start: int, captured: Caps, at: int, edge: tuple[Any, ...]) -> None:
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
                if at == current[0]:
                    agenda.append(found)
                else:
                    following.append(found)
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

        def advance(item: int, part: tuple[int, int, int], at: int, edge: tuple[Any, ...]) -> None:
            production = productions[prod[item]]
            position = dot[item]
            captured = caps[item]
            if production.slots[position] >= 0:
                captured = captured + (part,)
            conditions = production.conds_at.get(position)
            if conditions:
                bound = evaluator.bind(production, captured)
                for condition in conditions:
                    if not evaluator.condition(condition, bound):
                        return
            if production.conds_whole and position + 1 == len(production.rhs):
                # The conditions on $, once the constituent is complete.
                start = origin[item]
                whole = (start, at, constituent_tag(production, captured, start, at))
                bound = evaluator.bind(production, captured, whole)
                for condition in production.conds_whole:
                    if not evaluator.condition(condition, bound):
                        return
            add(production.id, position + 1, origin[item], captured, at, edge)

        # A production whose first symbol is a terminal the next token lacks
        # is not predicted, since its item could never advance; a rejection
        # at that position lists the terminals it expected all the same.
        by_first = lowered.by_first_terminal
        not_terminal_first = lowered.not_terminal_first

        def allowed(production: Production, j: int) -> bool:
            if not production.conds_predict:
                return True
            # $ is bound for an empty production, whose span is empty at j.
            whole = (j, j, constituent_tag(production, (), j, j)) if not production.rhs else None
            bound = evaluator.bind(production, (), whole)
            return all(evaluator.condition(c, bound) for c in production.conds_predict)

        def predict(rule: int, j: int) -> None:
            for number in not_terminal_first[rule]:
                if allowed(productions[number], j):
                    add(number, 0, j, (), j, SEED)
            if j < n:
                table = by_first[rule]
                if table:
                    for tag in tokens[base + j].tags:
                        for number in table.get(tag, ()):
                            if allowed(productions[number], j):
                                add(number, 0, j, (), j, SEED)

        current = [0]
        following: list[int] = []
        predicted[0].add(start_rule)
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
                if position < len(production.rhs):
                    symbol = production.rhs[position]
                    if production.terminal[position]:
                        scanning[j].setdefault(symbol, []).append(item)  # type: ignore[arg-type]
                        continue
                    rule = symbol
                    waiting[j].setdefault(rule, []).append(item)  # type: ignore[arg-type]
                    if rule not in predicted[j]:
                        predicted[j].add(rule)  # type: ignore[arg-type]
                        predict(rule, j)  # type: ignore[arg-type]
                    for child in empty_done[j].get(rule, ()):  # type: ignore[arg-type]
                        advance(item, (j, j, tag[child]), j, (item, 2, child, 0))
                    continue
                # A completed item: its tag set, then the items waiting for it.
                start = origin[item]
                tag[item] = constituent_tag(production, caps[item], start, j)
                lhs = production.lhs
                if start == j:
                    empty_done[j].setdefault(lhs, []).append(item)
                part = (start, j, tag[item])
                for waiter in list(waiting[start].get(lhs, ())):
                    advance(waiter, part, j, (waiter, 2, item, 0))
            if j < n:
                sets.append({})
                waiting.append({})
                scanning.append({})
                empty_done.append({})
                predicted.append(set())
                token = tokens[base + j]
                token_tag = token_tags[base + j]
                for terminal, waiters in scanning[j].items():
                    if terminal in token.tags:
                        for waiter in waiters:
                            advance(waiter, (j, j + 1, token_tag), j + 1, (waiter, 1, j, terminal))
        # The last set, if the parse reached it.
        final = sets[n] if n < len(sets) else {}
        roots = [
            item
            for item in final.values()
            if origin[item] == 0 and productions[prod[item]].lhs == start_rule and dot[item] == len(productions[prod[item]].rhs)
        ]
        expected: dict[str, set[str]] = {}
        here = tokens[base + furthest].tags if furthest < n else {}
        for rule in predicted[furthest]:
            for terminal, numbers in by_first[rule].items():
                if terminal in here:
                    continue
                for number in numbers:
                    if allowed(productions[number], furthest):
                        expected.setdefault(terminal, set()).add(productions[number].rule_name)
        for terminal, waiters in scanning[furthest].items():
            expected.setdefault(terminal, set()).update(productions[prod[waiter]].rule_name for waiter in waiters)
        # The forest's tokens are those the parse read, before its furthest
        # set.
        return Forest(tokens[base : base + furthest], lowered, prod, dot, origin, end, caps, edges, tag, roots, furthest, expected)
