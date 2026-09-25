"""Running one stage: recognition, the ranking, the elision-only check
(engine §7), the tree (engine §12) and emission (engine §11)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Union

from ._earley import Evaluator, Forest, Parser, StageContext
from ._errors import _GrammarFault
from ._grammar import Lowered, Production
from ._markdown import line_column
from ._model import Action, Expected, Node, ParseError, ParseWarning, Range, Tags, Token
from ._rank import Act, Ranker, Rope, actions, count_roots
from ._tags import PAUSE, phoneme_of
from ._unicode import UnicodeTable


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
        size = len(production.rhs)
        children = stack[len(stack) - size :] if size else []
        if size:
            del stack[len(stack) - size :]
        stack.append(DNode(act.item, production, act.start, act.end, children, forest.tag[act.item]))
    assert len(stack) == 1 and isinstance(stack[0], DNode)
    return stack[0]


def _range_source(tokens: list[Token], start: int, end: int) -> Range | None:
    if start < end:
        return (tokens[start].source[0], tokens[end - 1].source[1])
    return None


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

    def __init__(self, root: DNode, tokens: list[Token], tagtab: Any) -> None:
        self.tokens = tokens
        self.root = self.build(root, tagtab)

    def build(self, root: DNode, tagtab: Any) -> Node:
        tokens = self.tokens
        top = Node("rule", (root.start, root.end), (0, 0), rule=root.production.rule_name, tags=dict(tagtab.get(root.tag)))
        builders: list[Node] = [top]
        work: list[tuple[str, Any]] = [("close", root), ("kids", (root, root.production.rep_splice))]
        while work:
            kind, value = work.pop()
            if kind == "kids":
                node, splice = value
                children = node.children
                for index in range(len(children) - 1, -1, -1):
                    child = children[index]
                    if index == 0 and splice and isinstance(child, DNode):
                        work.append(("kids", (child, child.production.rep_splice)))
                    else:
                        work.append(("visit", child))
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
                        parent.children.append(Node("elided", (child.start, child.start), (0, 0), terminal=child.production.elided))
                    else:
                        work.append(("kids", (child, False)))
                else:
                    node = Node(
                        "rule",
                        (child.start, child.end),
                        (0, 0),
                        rule=child.production.rule_name,
                        tags=dict(tagtab.get(child.tag)),
                    )
                    parent.children.append(node)
                    builders.append(node)
                    work.append(("close", child))
                    work.append(("kids", (child, child.production.rep_splice)))
            else:
                builders.pop()
        # Sources: an empty node stands at the source end of the token
        # before it, or at position 0 at the start of the first (engine §12).
        stack = [top]
        while stack:
            node = stack.pop()
            if node.kind != "token":
                node.source = _range_source(tokens, node.span[0], node.span[1]) or _empty_source(tokens, node.span[0])
            stack.extend(node.children)
        return top

    def source_of(self, node: DNode) -> Range:
        return _range_source(self.tokens, node.start, node.end) or _empty_source(self.tokens, node.start)


def warnings_of(root: DNode, tree: Tree, features: frozenset[str], stage: str) -> list[ParseWarning]:
    """The warnings of a chosen derivation (engine §12): each rule node of its
    tree gives one for each warning of its alternative whose feature is on,
    in the order a walk meets the nodes, parent before children and children
    left to right. The walk splices helpers and the prefixes of a trailing
    repetition, which are no nodes of the tree, as the tree does."""
    warnings: list[ParseWarning] = []
    # Each entry is a node, and whether it is the prefix of a trailing
    # repetition, the first child of a production lowered as one.
    stack: list[tuple[DChild, bool]] = [(root, False)]
    while stack:
        node, prefix = stack.pop()
        if isinstance(node, DRead):
            continue
        production = node.production
        if not prefix and not production.helper:
            for feature in production.warnings:
                if feature in features:
                    span = (node.start, node.end)
                    warnings.append(ParseWarning(stage, feature, production.rule_name, span, tree.source_of(node)))
        children = node.children
        for index in range(len(children) - 1, -1, -1):
            stack.append((children[index], index == 0 and production.rep_splice))
    return warnings


def elided_nodes(tree: Node) -> list[Node]:
    """The elided nodes of a tree in text order, inner before outer."""
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


def uncounted_tokens(root: DNode, size: int) -> list[bool]:
    """Which input tokens lie inside a constituent that does not count."""
    uncounted = [False] * size
    stack: list[DChild] = [root]
    while stack:
        node = stack.pop()
        if isinstance(node, DRead):
            continue
        if emits_nothing(node.production):
            for index in range(node.start, node.end):
                uncounted[index] = True
            continue
        stack.extend(node.children)
    return uncounted


def joined_phonemes(parts: list[str]) -> str:
    """Phonemes joined in order, each run of pauses made one and a pause at
    either end removed (engine §5)."""
    return PAUSE.join(part for part in "".join(parts).split(PAUSE) if part)


def span_phonemes(tokens: list[Token], uncounted: list[bool], start: int, end: int) -> str:
    return joined_phonemes([tokens[index].phonemes or "" for index in range(start, end) if not uncounted[index]])


class Emitter:
    """Emission (engine §11): the tokens a stage hands to the next."""

    def __init__(self, context: StageContext, forest: Forest, tree: Tree, root: DNode) -> None:
        self.context = context
        self.forest = forest
        self.tokens = context.tokens
        self.tree = tree
        self.root = root
        self.evaluator = Evaluator(context, 0)
        self.uncounted = uncounted_tokens(root, len(self.tokens))
        self.output: list[Token] = []

    def token(self, start: int, end: int, tags: Tags, source: Range, inserted_by: str | None) -> Token:
        strong = [phoneme for phoneme in (phoneme_of(tag) for tag, st in tags.items() if st) if phoneme is not None]
        if len(strong) > 1:
            raise _GrammarFault(f"an emitted token has two strong phoneme tags: {', '.join(sorted(t for t, s in tags.items() if s and phoneme_of(t) is not None))}", (start, end))
        phonemes = strong[0] if strong else span_phonemes(self.tokens, self.uncounted, start, end)
        text = self.context.text[source[0] : source[1]]
        return Token(text, dict(tags), (start, end), source, phonemes, inserted_by)

    def part_source(self, part: DChild) -> Range:
        if isinstance(part, DRead):
            return self.tokens[part.token].source
        return self.tree.source_of(part)

    def emit(self) -> list[Token]:
        """Walk the chosen tree from the left: a constituent whose production
        has no emission is walked, and one that has one emits exactly its
        items, in list order, and nothing inside it is walked (engine §11)."""
        work: list[DChild] = [self.root]
        while work:
            node = work.pop()
            if isinstance(node, DRead):
                continue
            emit = node.production.emit
            if emit is None:
                work.extend(reversed(node.children))
                continue
            for item in emit:
                self.emit_item(node, item)
        return self.output

    def emit_item(self, node: DNode, item: tuple[Any, ...]) -> None:
        tagtab = self.context.tagtab
        if item[0] == "whole":
            _, term = item
            tags = self.item_tags(node, term) if term is not None else tagtab.get(node.tag)
            self.output.append(self.token(node.start, node.end, tags, self.tree.source_of(node), None))
        elif item[0] == "capture":
            _, position, term = item
            part = node.children[position]
            if term is not None:
                tags = self.item_tags(node, term)
            elif isinstance(part, DRead):
                tags = self.tokens[part.token].tags
            else:
                tags = tagtab.get(part.tag)
            self.output.append(self.token(part.start, part.end, tags, self.part_source(part), None))
        else:
            # An inserted tag stands, with an empty span, at the start of the
            # part of the capture listed next after it, or at the end of the
            # constituent (engine §11).
            _, tag, anchor = item
            boundary = node.children[anchor].start if anchor is not None else node.end
            if boundary > node.start:
                at = self.tokens[boundary - 1].source[1]
            else:
                at = self.tree.source_of(node)[0]
            self.output.append(self.token(boundary, boundary, {tag: True}, (at, at), node.production.rule_name))

    def context_caps(self, node: DNode) -> Any:
        return self.forest.caps[node.item]

    def item_tags(self, node: DNode, term: Any) -> Tags:
        """The tags an emission item's term gives, over the constituent's
        captures and ``$``; no tags at all is an error of the grammar, since
        no terminal could read the token (engine §11)."""
        bound = self.evaluator.bind(node.production, self.context_caps(node), (node.start, node.end, node.tag))
        tags = self.evaluator.tags(term, bound)
        if not tags:
            raise _GrammarFault(f"{node.production.rule_name} emits a token with no tags; a rule that emits nothing says %emits ε", (node.start, node.end))
        return tags


@dataclass
class StageOutcome:
    """What one stage run produced."""

    verdict: str | None = None
    tree: Node | None = None
    derivation: DNode | None = None
    output: list[Token] | None = None
    witness: tuple[Action, Action] | None = None
    tied: Node | None = None
    error: ParseError | None = None
    uncounted: list[bool] | None = None
    chosen_actions: list[Act] | None = None
    tied_actions: list[Act] | None = None
    warnings: list[ParseWarning] = field(default_factory=list)


def _action(act: Act, lowered: Lowered) -> Action:
    if act.read:
        return Action("read", token=act.token, terminal=act.terminal)
    production = lowered.productions[act.production]
    return Action("close", rule=production.rule_name, production=production.id, span=(act.start, act.end))


class StageRunner:
    """Runs one stage over its input tokens. ``features`` are the features
    on, which decide the warnings the stage gives (engine §12)."""

    def __init__(
        self,
        name: str,
        lowered: Lowered,
        elision_lowered: Callable[[], Lowered],
        tokens: list[Token],
        text: str,
        unicode: UnicodeTable,
        emit: bool = True,
        features: frozenset[str] = frozenset(),
    ) -> None:
        self.name = name
        self.lowered = lowered
        self.elision_lowered = elision_lowered
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

    def rejection(self, forest: Forest) -> ParseError:
        tokens = self.tokens
        position = forest.furthest
        if position < len(tokens):
            source = tokens[position].source
            shown = f"token {position} ({tokens[position].text!r})"
        else:
            at = tokens[-1].source[1] if tokens else 0
            source = (at, at)
            shown = "the end of the input"
        expected = [Expected(terminal, sorted(rules)) for terminal, rules in sorted(forest.expected.items())]
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
        lowered = self.lowered
        context = self.context(lowered, self.tokens)
        start = lowered.rule_ids["text"]
        forest = Parser(context).parse(start)
        ranking = Ranker(forest, lowered.lean).rank(forest.roots) if forest.roots else None
        if ranking is None:
            if forest.roots:
                forest.furthest = len(self.tokens)
            return StageOutcome(error=self.rejection(forest))
        root = derivation(forest, ranking.chosen)
        tree = Tree(root, self.tokens, context.tagtab)
        outcome = StageOutcome(verdict=ranking.verdict, tree=tree.root, derivation=root)
        outcome.warnings = warnings_of(root, tree, self.features, self.name)
        outcome.chosen_actions = list(actions(ranking.chosen))
        if ranking.verdict == "tie":
            assert ranking.witness is not None and ranking.witness[0] is not None and ranking.witness[1] is not None
            outcome.witness = (_action(ranking.witness[0], lowered), _action(ranking.witness[1], lowered))
            outcome.tied = Tree(derivation(forest, ranking.tied), self.tokens, context.tagtab).root
            outcome.tied_actions = list(actions(ranking.tied))
        emitter = Emitter(context, forest, tree, root)
        outcome.uncounted = emitter.uncounted
        try:
            if self.emit:
                outcome.output = emitter.emit()
            if elision_only and ranking.verdict != "unique":
                # The stage accepted its input, so it has its output; the
                # check makes the parse fail, and the result has no tree.
                error = self.check_elision(tree.root)
                if error is not None:
                    outcome.error = error
                    outcome.tree = None
        except _GrammarFault as fault:
            # A defect found once the stage has chosen its tree, while emitting
            # or in the reparse of elision-only, leaves it without output; it
            # keeps its verdict, witness, tied tree and warnings (engine §7,
            # §11).
            outcome.output = None
            outcome.tree = None
            outcome.error = self.fault(fault, self.tokens)
            return outcome
        return outcome

    def check_elision(self, tree: Node) -> ParseError | None:
        """Engine §7: write the chosen tree's elided terminators back, parse
        again with none elidable, and rank by the tag rule alone."""
        tokens = self.tokens
        inserted = elided_nodes(tree)
        new_tokens: list[Token] = []
        synthetic: list[bool] = []
        pending = 0
        for index in range(len(tokens) + 1):
            while pending < len(inserted) and inserted[pending].span[0] == index:
                node = inserted[pending]
                new_tokens.append(Token("", {node.terminal or "": True}, (index, index), node.source))
                synthetic.append(True)
                pending += 1
            if index < len(tokens):
                new_tokens.append(tokens[index])
                synthetic.append(False)
        boundary = [0] * (len(new_tokens) + 1)
        for index, is_synthetic in enumerate(synthetic):
            boundary[index + 1] = boundary[index] + (0 if is_synthetic else 1)
        lowered = self.elision_lowered()
        context = self.context(lowered, new_tokens)
        forest = Parser(context).parse(lowered.rule_ids["text"])
        ranking = Ranker(forest, "none").rank(forest.roots) if forest.roots else None
        if ranking is None or ranking.verdict != "tie":
            return None
        readings = []
        for rope in (ranking.chosen, ranking.tied):
            reading = Tree(derivation(forest, rope), new_tokens, context.tagtab).root
            readings.append(_map_back(reading, synthetic, boundary))
        return ParseError(
            "ambiguous",
            f"stage {self.name} is ambiguous even with every elided terminator written out",
            stage=self.name,
            readings=readings,
        )


def _map_back(tree: Node, synthetic: list[bool], boundary: list[int]) -> Node:
    """A tree over the tokens with terminators written back, shown over the
    original tokens: a written-back terminator is an elided node."""
    stack = [tree]
    while stack:
        node = stack.pop()
        if node.kind == "token" and node.token is not None and synthetic[node.token]:
            position = boundary[node.token]
            node.kind = "elided"
            node.span = (position, position)
            node.token = None
        elif node.kind == "token" and node.token is not None:
            node.token = boundary[node.token]
            node.span = (node.token, node.token + 1)
        else:
            node.span = (boundary[node.span[0]], boundary[node.span[1]])
        stack.extend(node.children)
    return tree
