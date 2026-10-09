"""Running one stage: recognition, the ranking, the elision-only check
(engine §7), the tree (engine §12) and emission (engine §11)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Union

from ._earley import RESTORE, Evaluator, Forest, Parser, Sources, StageContext
from ._errors import _GrammarFault
from ._grammar import Lowered, Production, SymbolTest, written_symbol
from ._markdown import line_column
from ._maximal import Maximal
from ._model import Action, Expected, Node, ParseError, ParseWarning, Range, Restoration, Tags, Token
from ._rank import (
    Act, Elisions, Ranker, Ranking, Rope, actions, compare_profiles, concat,
    count_roots, first_difference, leaf, rank, sum_profiles,
)
from ._tags import PAUSE, phoneme_of
from ._unicode import UnicodeTable
from . import _testing


class DRead:
    """A read of a token in a derivation."""

    __slots__ = ("token", "terminal", "start", "end")

    def __init__(self, token: int, terminal: str) -> None:
        self.token = token
        self.terminal = terminal
        self.start = token
        self.end = token + 1


class DNode:
    """A closed production in a derivation."""

    __slots__ = ("item", "production", "start", "end", "children", "tag")

    def __init__(self, item: int, production: Production, start: int, end: int, children: list[DChild], tag: int) -> None:
        self.item = item
        self.production = production
        self.start = start
        self.end = end
        self.children = children
        self.tag = tag


DChild = Union[DNode, DRead]


def derivation(forest: Forest, rope: Rope | None) -> DNode:
    """Rebuild a derivation's tree from its actions."""
    productions = forest.lowered.productions
    stack: list[DChild] = []
    for act in actions(rope):
        if act.read:
            stack.append(DRead(act.token, act.terminal))
            continue
        production = productions[act.production]
        # A restoration closes its empty production over the one token that
        # it read (engine §7.4).
        size = 1 if forest.edges[act.item][0][1] == RESTORE else len(production.rhs)
        children = stack[len(stack) - size :] if size else []
        if size:
            del stack[len(stack) - size :]
        stack.append(DNode(act.item, production, act.start, act.end, children, forest.tag[act.item]))
    assert len(stack) == 1 and isinstance(stack[0], DNode)
    return stack[0]


def _restored_sound(test: SymbolTest | None) -> str | None:
    """What a restored terminator sounds like: the string of its = test,
    or nothing (engine §7)."""
    return test.sound if test is not None and test.op == "=" else None


def _range_source(sources: Sources, start: int, end: int) -> Range:
    """Where tokens start..end stand in the text: their source (engine
    §1), or, for an empty span, the point where it stands (engine §12)."""
    if start < end:
        return sources.of(start, end)
    return _empty_source(sources.tokens, start)


def _empty_source(tokens: list[Token], position: int) -> Range:
    """Where an empty span stands in the text (engine §12)."""
    if position > 0:
        at = tokens[position - 1].source[1]
    elif tokens:
        at = tokens[0].source[0]
    else:
        at = 0
    return (at, at)


class Tree:
    """The result tree of a derivation (engine §12), and where each closed
    production of the derivation stands in the text."""

    def __init__(self, root: DNode, sources: Sources, tagtab: Any) -> None:
        self.sources = sources
        self.tokens = sources.tokens
        self.root = self.build(root, tagtab)

    def build(self, root: DNode, tagtab: Any) -> Node:
        tokens = self.tokens
        top = Node("rule", (root.start, root.end), (0, 0), rule=root.production.rule_name, tags=tagtab.get(root.tag))
        builders: list[Node] = [top]
        # The engine splices out helpers, those of [ ] and of flat braces;
        # a chain's levels are rule nodes, and stay (engine §12).
        work: list[tuple[str, Any]] = [("close", root), ("kids", root)]
        while work:
            kind, value = work.pop()
            if kind == "kids":
                children = value.children
                for index in range(len(children) - 1, -1, -1):
                    work.append(("visit", children[index]))
            elif kind == "visit":
                child = value
                parent = builders[-1]
                if isinstance(child, DRead):
                    token = tokens[child.token]
                    parent.children.append(
                        Node("token", (child.token, child.token + 1), token.source, terminal=child.terminal, token=child.token)
                    )
                elif child.production.helper:
                    if child.production.elided is not None and child.start == child.end:
                        parent.children.append(
                            Node(
                                "elided",
                                (child.start, child.start),
                                (0, 0),
                                terminal=child.production.elided,
                                # The string of an = test is kept for
                                # elision-only's restored token; the output
                                # does not show it (engine §7).
                                sound=_restored_sound(child.production.elided_test),
                            )
                        )
                    else:
                        work.append(("kids", child))
                else:
                    node = Node(
                        "rule",
                        (child.start, child.end),
                        (0, 0),
                        rule=child.production.rule_name,
                        tags=tagtab.get(child.tag),
                    )
                    parent.children.append(node)
                    builders.append(node)
                    work.append(("close", child))
                    work.append(("kids", child))
            else:
                builders.pop()
        # Sources: an empty node stands at the source end of the token
        # before it, or at position 0 at the start of the first (engine §12).
        stack = [top]
        while stack:
            node = stack.pop()
            if node.kind != "token":
                node.source = _range_source(self.sources, node.span[0], node.span[1])
            stack.extend(node.children)
        return top

    def source_of(self, node: DNode) -> Range:
        return _range_source(self.sources, node.start, node.end)


def warnings_of(root: DNode, tree: Tree, features: frozenset[str], stage: str) -> list[ParseWarning]:
    """The warnings of a chosen derivation (engine §12): each rule node of its
    tree gives one for each warning of its alternative whose feature is on,
    in the order a walk meets the nodes, parent before children and children
    left to right. The walk splices helpers, which are no nodes of the
    tree, as the tree does."""
    warnings: list[ParseWarning] = []
    stack: list[DChild] = [root]
    while stack:
        node = stack.pop()
        if isinstance(node, DRead):
            continue
        production = node.production
        if not production.helper:
            for feature in production.warnings:
                if feature in features:
                    span = (node.start, node.end)
                    warnings.append(ParseWarning(stage, feature, production.rule_name, span, tree.source_of(node)))
        children = node.children
        stack.extend(reversed(children))
    return warnings


def forbidden_terminator(forest: Forest, ranking: Ranking | None, maximal: Maximal) -> tuple[int, list[Expected]] | None:
    """Of a ranking's first reading, the first elided terminator, in the
    order of the tree's leaves, that maximal forbids: its position, and its
    terminal with the rule its optional is written in as the one expected
    there (engine §4). ``None`` for no ranking, or none forbidden."""
    if ranking is None:
        return None
    # Each entry is a node, its parent, and its place among the parent's
    # children.
    stack: list[tuple[DChild, DNode | None, int]] = [(derivation(forest, ranking.first), None, 0)]
    while stack:
        node, parent, index = stack.pop()
        if isinstance(node, DRead):
            continue
        if parent is not None and index > 0 and maximal.elided(node.item):
            production = parent.production
            own = index == 1 and not production.terminal[0] and production.rhs[0] == production.lhs
            before = parent.children[index - 1]
            test = production.tests[index - 1] if production.tests else None
            if not own and isinstance(before, DNode) and maximal.forbids(before.item, test):
                terminal = node.production.elided
                assert terminal is not None
                written = written_symbol(terminal, node.production.elided_test)
                return (node.start, [Expected(written, [node.production.rule_name])])
        children = node.children
        for position in range(len(children) - 1, -1, -1):
            stack.append((children[position], node, position))
    return None


def elided_nodes(tree: Node) -> list[Node]:
    """The elided nodes of a tree in the order of its leaves."""
    found: list[Node] = []
    stack = [tree]
    while stack:
        node = stack.pop()
        if node.kind == "elided":
            found.append(node)
        stack.extend(reversed(node.children))
    return found


def emits_nothing(production: Production) -> bool:
    """Whether a production's emission is ``ε``, which makes its constituent
    not count (engine §11). An emission that lists items keeps at least one
    for every production (engine §9), so only ``ε`` lowers to none."""
    return production.emit is not None and not production.emit


def opaque_parts(root: DNode, tokens: list[Token], sources: Sources, text: str) -> dict[int, Range]:
    """The opaque parts of a chosen derivation, each with its source,
    keyed by the ``id`` of its node (engine §11). An opaque part is the
    constituent of a ``%opaque`` production inside no constituent that
    emits ``ε`` and no other opaque part. The stage fixes them before it
    emits anything, so that every token over a part holds the same text."""
    parts: list[DNode] = []
    stack: list[DChild] = [root]
    while stack:
        node = stack.pop()
        if isinstance(node, DRead) or emits_nothing(node.production):
            continue
        if node.production.opaque:
            parts.append(node)
            continue
        stack.extend(reversed(node.children))
    # Text between two input tokens belongs to the part with a non-empty
    # span that ends there, before one that starts there.
    ends = {part.end for part in parts if part.start < part.end}
    result: dict[int, Range] = {}
    for part in parts:
        if part.start == part.end:
            # An empty part takes in no text. Its source is that of an empty
            # node (engine §12).
            result[id(part)] = _empty_source(tokens, part.start)
            continue
        before = tokens[part.start - 1].source[1] if part.start > 0 else 0
        # It always holds its own tokens' sources, which the tokens next to
        # it can share, and takes in the text next to it that no input token
        # covers.
        own = sources.of(part.start, part.end)
        first = own[0] if part.start in ends else min(own[0], before)
        after = tokens[part.end].source[0] if part.end < len(tokens) else len(text)
        result[id(part)] = (first, max(own[1], after))
    return result


class Join:
    """A join of the phonemes or of the labels of a token's parts (engine
    §5): a part with an empty string is left out, of each run of adjacent
    pause parts only the first is kept, and a pause part at either end is
    left out. Pauses are counted by part, so a part keeps its own periods
    and spaces."""

    __slots__ = ("pieces", "pause")

    def __init__(self) -> None:
        self.pieces: list[str] = []
        self.pause = False

    def add(self, piece: str, pause: bool) -> None:
        if not piece or pause and (not self.pieces or self.pause):
            return
        self.pieces.append(piece)
        self.pause = pause

    def result(self) -> str:
        if self.pause:
            self.pieces.pop()
        return "".join(self.pieces)


def sounded(phoneme: str) -> tuple[str, str]:
    """The phonemes and the label of a phoneme tag ``/p/`` (engine §5):
    ``p`` and ``p``, but a space for the label of the pause."""
    return phoneme, " " if phoneme == PAUSE else phoneme


def phoneme_tag(tags: Tags) -> str | None:
    """The phonemes of an emitted token's phoneme tag, or ``None`` if
    it has none. Two are an error of the grammar on any emitted token
    (engine §5)."""
    found = sorted(tag for tag in tags if phoneme_of(tag) is not None)
    if len(found) > 1:
        raise _GrammarFault(f"an emitted token has two phoneme tags: {', '.join(found)}")
    return phoneme_of(found[0]) if found else None


def implied(tags: Tags, lowered: Lowered) -> Tags:
    """A token's explicit tags with the tags of the stage's implications,
    added until no tag changes (engine §11). Each tag gained is looked up
    once in an index of the premises, and each implication fires at most
    once, so a long chain costs its length, not its square."""
    implications = lowered.implications
    if not implications:
        return tags
    index = lowered.implication_index()
    result = set(tags)
    queue = list(tags)
    fired: set[int] = set()
    while queue:
        for number in index.get(queue.pop(), ()):
            if number in fired:
                continue
            fired.add(number)
            for tag in implications[number][1]:
                if tag not in result:
                    result.add(tag)
                    queue.append(tag)
    return tags if len(result) == len(tags) else frozenset(result)


class Emitter:
    """Emission (engine §11): the tokens a stage hands to the next."""

    def __init__(self, context: StageContext, forest: Forest, tree: Tree, root: DNode) -> None:
        self.context = context
        self.forest = forest
        self.tokens = context.tokens
        self.tree = tree
        self.root = root
        self.evaluator = Evaluator(context, 0, len(context.tokens))
        self.output: list[Token] = []
        self.forwards = False
        self.inherited: set[int] = set()
        # The opaque parts and their sources, fixed before any token
        # (engine §11).
        self.opaque = opaque_parts(root, self.tokens, context.sources, context.text)

    def spoken(self, part: DChild) -> tuple[str, str]:
        """What a part says and shows: the phonemes and the labels of its
        parts, joined (engine §5, §11). A part is a read input token or a
        opaque part. Nothing inside a constituent that does not count is a
        part, and the walk does not enter an opaque part."""
        phonemes = Join()
        label = Join()
        stack: list[DChild] = [part]
        while stack:
            node = stack.pop()
            if isinstance(node, DRead):
                token = self.tokens[node.token]
                sound = token.phonemes or ""
                phonemes.add(sound, sound == PAUSE)
                label.add(token.label, sound == PAUSE)
                continue
            if emits_nothing(node.production):
                continue
            source = self.opaque.get(id(node))
            if source is not None:
                phonemes.add("?", False)
                label.add(self.context.text[source[0] : source[1]], False)
                continue
            stack.extend(reversed(node.children))
        return phonemes.result(), label.result()

    def part_token(self, part: DChild, explicit: Tags) -> Token:
        """The token a ``$`` item or a capture item emits over a part, with
        the tags that the emission gives it (engine §11)."""
        # The stage's implications apply before the phonemes and the label
        # (engine §11).
        tags = implied(explicit, self.context.lowered)
        # Two phoneme tags are an error on any token (engine §5).
        phoneme = phoneme_tag(tags)
        # A token over an opaque part has the part's source and text (engine
        # §11).
        source = self.opaque.get(id(part)) if isinstance(part, DNode) else None
        if source is None:
            source = self.part_source(part)
        text = self.context.text[source[0] : source[1]]
        # A phoneme tag decides the sound and the label, over ``?`` (engine
        # §5).
        phonemes, label = sounded(phoneme) if phoneme is not None else self.spoken(part)
        token = Token(text, tags, (part.start, part.end), source, phonemes, None, label)
        # The parts decide the attachments too, after the phoneme tags are
        # checked (engine §11).
        origin = self.forwarded(part) if self.forwards else None
        if origin is not None:
            # Attachments belong to one token: an input token that is the one
            # part of a second token is an error of the grammar (engine §11).
            if id(origin) in self.inherited:
                raise _GrammarFault(
                    "a token with attachments is the one part of two emitted tokens, and its attachments cannot belong to both"
                )
            self.inherited.add(id(origin))
            token.before = list(origin.before)
            token.after = list(origin.after)
        return token

    def forwarded(self, part: DChild) -> Token | None:
        """The one input token whose attachments a token over ``part``
        inherits, or ``None`` (engine §11). The parts are those of the join
        (engine §5): a read input token, or an opaque part as one piece, and
        nothing inside a constituent that emits ``ε``. A token with
        attachments among other parts, or an opaque part that holds one, is
        an error of the grammar."""
        parts = 0
        found: Token | None = None
        stack: list[DChild] = [part]
        while stack:
            node = stack.pop()
            if isinstance(node, DRead):
                parts += 1
                token = self.tokens[node.token]
                if token.before or token.after:
                    found = token
                continue
            if emits_nothing(node.production):
                continue
            if id(node) in self.opaque:
                parts += 1
                if self.holds_attachments(node):
                    raise _GrammarFault(
                        f"{node.production.rule_name} is an opaque part over a token with attachments, which a token over it cannot place"
                    )
                continue
            stack.extend(reversed(node.children))
        if found is not None and parts > 1:
            raise _GrammarFault("a token over a token with attachments and another part cannot say which part each attachment belongs to")
        return found

    def holds_attachments(self, part: DNode) -> bool:
        """Whether an opaque part holds an input token with attachments: one
        that it reads outside any constituent that emits ``ε`` (engine
        §11)."""
        stack: list[DChild] = [part]
        while stack:
            node = stack.pop()
            if isinstance(node, DRead):
                token = self.tokens[node.token]
                if token.before or token.after:
                    return True
                continue
            if emits_nothing(node.production):
                continue
            stack.extend(node.children)
        return False

    def part_source(self, part: DChild) -> Range:
        if isinstance(part, DRead):
            return self.tokens[part.token].source
        return self.tree.source_of(part)

    def emit(self) -> list[Token]:
        """The stage's output: what the root emits (engine §11)."""
        # Whether any input token has attachments to forward, and the input
        # tokens whose attachments a token has inherited (engine §11).
        self.forwards = any(token.before or token.after for token in self.tokens)
        self.inherited = set()
        self.output = self.emitted(self.root)
        return self.output

    def emitted(self, root: DChild) -> list[Token]:
        """The tokens a constituent emits in its place in the derivation
        (engine §11): the stage's output from the root, or an attachment
        from a captured part. Walk the tree from the left: a constituent
        whose production has no emission is walked, and one that has one
        emits exactly its items, in list order, and nothing inside it is
        walked but the attachment captures of its items. Within an item, the
        before-attachments come first, then the carrier with its tag term,
        then the after-attachments, and the first error ends the emission.
        The work is a stack of tasks, so that nesting costs no recursion."""
        out: list[Token] = []
        # A task is ("walk", node, into), ("item", node, item, into),
        # ("carrier", node, item, into), or ("attach", into, before, after),
        # which gives the last token of ``into`` its new attachments.
        work: list[tuple[Any, ...]] = [("walk", root, out)]
        while work:
            task = work.pop()
            kind = task[0]
            if kind == "walk":
                _, node, into = task
                if isinstance(node, DRead):
                    continue
                emit = node.production.emit
                if emit is None:
                    work.extend(("walk", child, into) for child in reversed(node.children))
                    continue
                work.extend(("item", node, item, into) for item in reversed(emit))
            elif kind == "item":
                _, node, item, into = task
                if item[0] != "capture" or not (item[3] or item[4]):
                    self.emit_item(node, item, into)
                    continue
                before: list[Token] = []
                after: list[Token] = []
                steps: list[tuple[Any, ...]] = [("walk", node.children[position], before) for position in item[3]]
                steps.append(("carrier", node, item, into))
                steps.extend(("walk", node.children[position], after) for position in item[4])
                steps.append(("attach", into, before, after))
                work.extend(reversed(steps))
            elif kind == "carrier":
                _, node, item, into = task
                self.emit_item(node, item, into)
            else:
                # The carrier's token is the last of its list until the
                # after-attachments are done, since they go to their own
                # list. New attachments are outer to inherited ones, and an
                # attached token has no span (engine §11).
                _, into, before, after = task
                token = into[-1]
                for attached in (*before, *after):
                    attached.span = None
                if before:
                    token.before = [*before, *token.before]
                if after:
                    token.after = [*token.after, *after]
        return out

    def emit_item(self, node: DNode, item: tuple[Any, ...], out: list[Token]) -> None:
        tagtab = self.context.tagtab
        if item[0] == "whole":
            _, term = item
            tags = self.item_tags(node, term) if term is not None else tagtab.get(node.tag)
            out.append(self.part_token(node, tags))
        elif item[0] == "capture":
            _, position, term, _, _ = item
            part = node.children[position]
            if term is not None:
                tags = self.item_tags(node, term)
            elif isinstance(part, DRead):
                tags = self.tokens[part.token].tags
            else:
                tags = tagtab.get(part.tag)
            out.append(self.part_token(part, tags))
        else:
            # An inserted tag stands, with an empty span, at the start of its
            # anchor, the first written part of the capture item listed next
            # after it, or at the end of the constituent (engine §11).
            _, tag, anchor = item
            boundary = node.children[anchor].start if anchor is not None else node.end
            if boundary > node.start:
                at = self.tokens[boundary - 1].source[1]
            else:
                at = self.tree.source_of(node)[0]
            tags = implied(frozenset((tag,)), self.context.lowered)
            # An inserted token has no parts: a phoneme tag gives its phonemes
            # and its label, or both are empty (engine §5).
            phoneme = phoneme_tag(tags)
            phonemes, label = sounded(phoneme) if phoneme is not None else ("", "")
            out.append(Token("", tags, (boundary, boundary), (at, at), phonemes, node.production.rule_name, label))

    def context_caps(self, node: DNode) -> Any:
        return self.forest.caps[node.item]

    def item_tags(self, node: DNode, term: Any) -> Tags:
        """The tags an emission item's term gives, over the constituent's
        captures and ``$``; no tags at all is an error of the grammar, since
        no terminal could read the token (engine §11)."""
        bound = self.evaluator.bind(node.production, self.context_caps(node), (node.start, node.end, node.tag), self.forest.structure[node.item] if self.forest.structure else 0)
        tags = self.evaluator.tags(term, bound)
        if not tags:
            raise _GrammarFault(f"{node.production.rule_name} emits a token with no tags; a rule that emits nothing says %emits ε")
        return tags


@dataclass
class StageOutcome:
    """What one stage run produced."""

    verdict: str | None = None
    tree: Node | None = None
    derivation: DNode | None = None
    output: list[Token] | None = None
    witness: tuple[Action, Action] | None = None
    error: ParseError | None = None
    warnings: list[ParseWarning] = field(default_factory=list)


def _action(act: Act, lowered: Lowered) -> Action:
    if act.read:
        return Action("read", token=act.token, terminal=act.terminal)
    production = lowered.productions[act.production]
    return Action("close", rule=production.rule_name, production=production.real_id, span=(act.start, act.end))


class StageRunner:
    """Runs one stage over its input tokens. ``features`` are the features
    on, which decide the warnings the stage gives (engine §12)."""

    def __init__(
        self,
        name: str,
        lowered: Lowered,
        tokens: list[Token],
        text: str,
        unicode: UnicodeTable,
        emit: bool = True,
        features: frozenset[str] = frozenset(),
    ) -> None:
        self.name = name
        self.lowered = lowered
        self.tokens = tokens
        self.text = text
        self.unicode = unicode
        self.emit = emit
        self.features = features

    def context(self, lowered: Lowered, tokens: list[Token]) -> StageContext:
        context = StageContext(lowered, tokens, self.text, self.unicode)
        context.count = count_roots
        return context

    def fault(self, fault: _GrammarFault, tokens: list[Token]) -> ParseError:
        # A defect found while parsing has its stage and no position (§13).
        return ParseError("grammar", fault.message, stage=self.name)

    def rejection(self, forest: Forest, forbidden: tuple[int, list[Expected]] | None = None) -> ParseError:
        """The error of a stage that rejected its input: at the furthest
        position any item reached, with the terminals the items there could
        have read next, or at the terminator maximal forbids, ``forbidden``,
        with its one terminal (engine §4)."""
        tokens = self.tokens
        if forbidden is not None:
            position, expected = forbidden
        else:
            position = forest.furthest
            expected = [Expected(terminal, sorted(rules)) for terminal, rules in sorted(forest.expected.items())]
        if position < len(tokens):
            source = tokens[position].source
            shown = f"token {position} ({tokens[position].text!r})"
        else:
            at = tokens[-1].source[1] if tokens else 0
            source = (at, at)
            shown = "the end of the input"
        line, column = line_column(self.text, source[0])
        listed = ", ".join(f"{entry.terminal} ({', '.join(entry.rules)})" for entry in expected) or "nothing"
        message = f"stage {self.name} cannot read {shown}; it expected {listed}"
        return ParseError(
            "rejected", message, stage=self.name, token=position, source=source, line=line, column=column, expected=expected
        )

    def run(self, elision_only: bool) -> StageOutcome:
        try:
            return self._run(elision_only)
        except _GrammarFault as fault:
            return StageOutcome(error=self.fault(fault, self.tokens))

    def _run(self, elision_only: bool) -> StageOutcome:
        """The steps of a stage, in order (engine §6): recognize, rank, and
        then, for a verdict of unique or resolved, emit and run the check of
        engine §7 where it applies. A tie ends the stage at the ranking."""
        lowered = self.lowered
        context = self.context(lowered, self.tokens)
        start = lowered.rule_ids["text"]
        forest = Parser(context).parse(start)
        # Maximality, for maximal terminators, before
        # the ranking (engine §4).
        maximal = Maximal(forest, context) if lowered.maximal_helpers else None
        ranking = rank(forest, lowered.lean, maximal)
        if ranking is None:
            forbidden = None
            if forest.roots:
                forest.furthest = len(self.tokens)
                if maximal is not None:
                    # A text that maximality leaves with no derivation is
                    # rejected at the first terminator it forbids in the
                    # first reading of the ranking with both forms off, on
                    # the same chart, whatever its verdict (engine §4).
                    forbidden = forbidden_terminator(forest, rank(forest, lowered.lean), maximal)
            return StageOutcome(error=self.rejection(forest, forbidden))
        if ranking.verdict == "tie":
            return self.tie(forest, context, ranking)
        root = derivation(forest, ranking.first)
        tree = Tree(root, context.sources, context.tagtab)
        outcome = StageOutcome(verdict=ranking.verdict, tree=tree.root, derivation=root)
        outcome.warnings = warnings_of(root, tree, self.features, self.name)
        emitter = Emitter(context, forest, tree, root)
        try:
            if self.emit:
                outcome.output = emitter.emit()
            # The check runs only for a stage that chose one of several
            # derivations (engine §7.1).
            if elision_only and ranking.verdict == "resolved":
                # The stage accepted its input, so it has its output; the
                # check makes the parse fail, and the result has no tree.
                error = self.check_elision(context, root, tree.root)
                if error is not None:
                    outcome.error = error
                    outcome.tree = None
                    if error.code is not None:
                        # A lost witness is a defect of the engine, and the
                        # stage has no output (engine §7.9).
                        outcome.output = None
        except _GrammarFault as fault:
            # A defect found once the stage has chosen its tree, while emitting
            # or in the check of elision-only, leaves it without output; it
            # keeps its verdict and warnings (engine §7.7, §11). A defect
            # found while emitting ends the stage before the check.
            outcome.output = None
            outcome.tree = None
            outcome.error = self.fault(fault, self.tokens)
            return outcome
        return outcome

    def tie(self, forest: Forest, context: StageContext, ranking: Ranking) -> StageOutcome:
        """A tie is an error of kind ambiguous, with the reason tie. The
        stage keeps its verdict and its witness, and has no tree, no output
        and no warnings. The error holds the first and the second reading
        (engine §6)."""
        lowered = forest.lowered
        # Neither action of a witness is ever missing (engine §6, §7.10).
        if ranking.witness is None or ranking.witness[0] is None or ranking.witness[1] is None:
            raise RuntimeError("the witness of a ranking lacks an action")
        readings = [Tree(derivation(forest, rope), context.sources, context.tagtab).root for rope in (ranking.first, ranking.second)]
        error = ParseError(
            "ambiguous",
            f"stage {self.name} is ambiguous: two readings of its text are best, a tie",
            stage=self.name,
            reason="tie",
            readings=readings,
        )
        witness = (_action(ranking.witness[0], lowered), _action(ranking.witness[1], lowered))
        return StageOutcome(verdict="tie", witness=witness, error=error)

    def check_elision(self, main: StageContext, chosen: DNode, tree: Node) -> ParseError | None:
        """Engine §7: the check of elision-only. It writes the chosen
        derivation's elided terminators back into the stage's input as
        synthetic tokens and recognizes that input, R, with the main
        lowering in the reconstruction mode. Every observation reads the
        stage's input through the projection π. Slot admission precedes flag ranking.
        The check passes when admitted W(D) is the sole best reading.
        A tie gives two diagnostic readings.
        A missing witness is an engine defect. ``main`` is the main
        parse's context, whose memo the check's queries share. ``chosen`` is
        D and ``tree`` its tree."""
        tokens = self.tokens
        # The restoration records, in the order of the tree's leaves (engine
        # §7.2).
        records = [
            Restoration(node.terminal or "", node.span[0], node.source, node.sound) for node in elided_nodes(tree)
        ]
        # R: the stage's input with one synthetic token before the input
        # token at each record's position, or at the end. A synthetic token's
        # recognition tags are its terminal, and its recognition sound is its
        # saved sound. Its provenance, kept apart, is what marks it.
        restored: list[Token] = []
        synthetic: list[bool] = []
        original_at: list[int] = []
        record_at: list[int] = []
        record_of: list[int] = []
        pending = 0
        for index in range(len(tokens) + 1):
            while pending < len(records) and records[pending].at == index:
                record = records[pending]
                record_at.append(len(restored))
                record_of.append(pending)
                restored.append(Token("", frozenset((record.terminal,)), (len(restored), len(restored)), record.source, record.sound))
                synthetic.append(True)
                pending += 1
            if index < len(tokens):
                original_at.append(len(restored))
                record_of.append(-1)
                restored.append(tokens[index])
                synthetic.append(False)
        # π: the number of original tokens before each position of R (engine
        # §7.3).
        project = [0] * (len(restored) + 1)
        for index, is_synthetic in enumerate(synthetic):
            project[index + 1] = project[index] + (0 if is_synthetic else 1)
        lowered = self.lowered
        context = StageContext(lowered, restored, self.text, self.unicode, tagtab=main.tagtab, observed=main)
        context.synthetic = synthetic
        context.project = project
        # The recognition of R is not a query (engine §4, §7.6).
        forest = _reconstruct(context)
        # A test that watches the check marks W(D)'s edges before the check
        # ranks (tests/README.md).
        hook = _testing.elision_check
        watch = hook(_testing.CheckRun(chosen, forest, synthetic, original_at, record_at)) if hook is not None else None
        # Maximality does not apply to the derivations of R, and
        # they rank with no lean (engine §7.7).
        chosen_profile = ()
        walk = None
        protected = True
        if protected:
            from ._witness import walk_witness
            pending = [chosen]
            while pending:
                node = pending.pop()
                if isinstance(node, DRead):
                    continue
                if node.production.leftmost_longest and node.start < node.end:
                    chosen_profile = sum_profiles(chosen_profile, ((node.start, node.end, 1),))
                pending.extend(node.children)
            walk = walk_witness(_testing.CheckRun(chosen, forest, synthetic, original_at, record_at))
        marks = walk.marks if walk is not None else watch.marks if watch is not None else None
        preferred = bool(lowered.grammar.preferences.names)
        raw_counted = True
        if preferred:
            raw = rank(forest,"none",marks=marks,check=True,unfiltered=True)
            raw_counted = raw is not None and raw.witness_counted is True
        ranking = _rank_check(forest, marks)
        better = False
        watched_selection = False
        if protected and ranking is not None:
            order = compare_profiles(ranking.profile,chosen_profile)
            if walk is None or not raw_counted or not preferred and (ranking.witness_counted is not True or order>0):
                ranking = None
            else:
                restored_rope = None
                for act in walk.sequence:
                    restored_rope = concat(restored_rope,leaf(act))
                excluded = ranking.witness_counted is not True
                better = excluded or order<0
                if watch is not None and not better and not preferred:
                    watch.ranked(ranking)
                    watched_selection = True
                if better or ranking.verdict=="tie":
                    from ._rank import second_before
                    if excluded:
                        competitor = ranking.first
                    else:
                        options = [rope for rope in (ranking.first,ranking.second) if rope is not None and first_difference(restored_rope,rope,False) is not None]
                        competitor = options[0]
                        for other in options[1:]:
                            if second_before(restored_rope,other,competitor):
                                competitor = other
                    ranking.first,ranking.second = restored_rope,competitor
                    difference = first_difference(restored_rope,competitor,True) or first_difference(restored_rope,competitor,False)
                    assert difference is not None
                    ranking.witness = (difference[1],difference[2])
                if preferred:
                    ranking.raw_witness_counted = raw_counted
        if watch is not None and not watched_selection:
            watch.ranked(ranking)
        if ranking is None:
            # The witness of the chosen derivation is lost: a defect of the
            # engine (engine §7.9).
            return ParseError(
                "grammar",
                f"the {self.name} stage could not reconstruct its chosen derivation for elision-only",
                stage=self.name,
                code="elision-witness-lost",
                chosen=tree,
                completion=records,
            )
        if ranking.verdict != "tie" and not better:
            return None
        readings = []
        original = Sources(tokens)
        for rope in (ranking.first, ranking.second):
            if better and rope is ranking.first:
                readings.append(tree)
                continue
            reading = Tree(derivation(forest, rope), context.sources, context.tagtab).root
            readings.append(_map_back(reading, synthetic, project, records, record_of, original))
        # The witness, mapped to the stage's input as the readings are: a
        # read of a synthetic token is an elided action at its record's
        # position, and a close has the projection of its span (engine
        # §7.10).
        # Neither action of a witness is ever missing (engine §6, §7.10).
        if ranking.witness is None or ranking.witness[0] is None or ranking.witness[1] is None:
            raise RuntimeError("the witness of a ranking lacks an action")

        def mapped(act: Act) -> Action:
            if act.read and synthetic[act.token]:
                return Action("elided", terminal=act.terminal, at=project[act.token])
            if act.read:
                return Action("read", token=project[act.token], terminal=act.terminal)
            production = lowered.productions[act.production]
            return Action("close", rule=production.rule_name, production=production.real_id, span=(project[act.start], project[act.end]))

        return ParseError(
            "ambiguous",
            f"stage {self.name} is ambiguous even with every elided terminator written out",
            stage=self.name,
            reason="elision-only",
            readings=readings,
            witness=(mapped(ranking.witness[0]), mapped(ranking.witness[1])),
        )


def _reconstruct(context: StageContext) -> Forest:
    """The recognition of the reconstructed input in the reconstruction
    mode (engine §7.4, §7.7)."""
    return Parser(context).parse(context.lowered.rule_ids["text"])


def _rank_check(forest: Forest, marks: dict[int, set[int]] | None = None) -> Ranking | None:
    """Rank reconstruction with no stage policy or maximality."""
    return rank(forest, "none", marks=marks, check=True)


def _map_back(
    tree: Node, synthetic: list[bool], project: list[int], records: list[Restoration], record_of: list[int], original: Sources
) -> Node:
    """A reading of the check, mapped to the stage's input (engine §7.10): a
    read of an original token is a token node of its index there, a read of
    a synthetic token is an elided node of its record's terminal with an
    empty span at the record's position and the record's source, and a rule
    node has the projection of its span, with its source over the stage's
    input."""
    stack = [tree]
    while stack:
        node = stack.pop()
        if node.kind == "token" and node.token is not None and synthetic[node.token]:
            record = records[record_of[node.token]]
            node.kind = "elided"
            node.terminal = record.terminal
            node.span = (record.at, record.at)
            node.source = record.source
            node.sound = record.sound
            node.token = None
        elif node.kind == "token" and node.token is not None:
            node.token = project[node.token]
            node.span = (node.token, node.token + 1)
        else:
            node.span = (project[node.span[0]], project[node.span[1]])
            node.source = _range_source(original, node.span[0], node.span[1])
        stack.extend(node.children)
    return tree
