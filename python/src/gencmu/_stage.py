"""Running one stage: recognition, the ranking, the elision-only check
(engine §7), the tree (engine §12) and emission (engine §11)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Union

from ._earley import Evaluator, Forest, Parser, StageContext
from ._errors import _GrammarFault
from ._grammar import Lowered, Production
from ._markdown import line_column
from ._model import Action, Expected, Node, ParseError, Range, Tags, Token
from ._rank import Act, Ranker, Rope, actions, count_roots
from ._tags import phoneme_of
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


class Tree:
    """The result tree of a derivation (engine §12), and where each closed
    production of the derivation stands in the text."""

    def __init__(self, root: DNode, tokens: list[Token], tagtab: Any) -> None:
        self.tokens = tokens
        self.sources: dict[int, Range] = {}
        self.root = self.build(root, tagtab)

    def build(self, root: DNode, tagtab: Any) -> Node:
        tokens = self.tokens
        by_dnode: list[tuple[DNode, Node]] = []
        top = Node("rule", (root.start, root.end), (0, 0), rule=root.production.rule_name, tags=dict(tagtab.get(root.tag)))
        by_dnode.append((root, top))
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
                    by_dnode.append((child, node))
                    parent.children.append(node)
                    builders.append(node)
                    work.append(("close", child))
                    work.append(("kids", (child, child.production.rep_splice)))
            else:
                builders.pop()
        # Sources, top down: an empty node stands at the end of the token
        # before it, or at the start of its parent if nothing of the parent
        # precedes it.
        top.source = _range_source(tokens, top.span[0], top.span[1]) or (0, 0)
        stack = [top]
        while stack:
            node = stack.pop()
            for child in node.children:
                if child.span[0] == child.span[1]:
                    start = child.span[0]
                    at = tokens[start - 1].source[1] if start > node.span[0] else node.source[0]
                    child.source = (at, at)
                elif child.kind == "rule":
                    child.source = _range_source(tokens, child.span[0], child.span[1])  # type: ignore[assignment]
                if child.kind == "rule":
                    stack.append(child)
        for dnode, node in by_dnode:
            self.sources[id(dnode)] = node.source
        return top

    def source_of(self, node: DNode) -> Range:
        found = self.sources.get(id(node))
        if found is not None:
            return found
        source = _range_source(self.tokens, node.start, node.end)
        if source is not None:
            return source
        if node.start > 0:
            at = self.tokens[node.start - 1].source[1]
        elif self.tokens:
            at = self.tokens[0].source[0]
        else:
            at = 0
        return (at, at)


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


def erased_tokens(root: DNode, size: int) -> list[bool]:
    """Which input tokens lie inside a constituent that emits nothing."""
    erased = [False] * size
    stack: list[DChild] = [root]
    while stack:
        node = stack.pop()
        if isinstance(node, DRead):
            continue
        if node.production.emit == ("nothing",):
            for index in range(node.start, node.end):
                erased[index] = True
            continue
        stack.extend(node.children)
    return erased


def span_phonemes(tokens: list[Token], erased: list[bool], start: int, end: int) -> str:
    return "".join(tokens[index].phonemes or "" for index in range(start, end) if not erased[index]).strip(" ")


class Emitter:
    """Emission (engine §11): the tokens a stage hands to the next."""

    def __init__(self, context: StageContext, forest: Forest, tree: Tree, root: DNode) -> None:
        self.context = context
        self.forest = forest
        self.tokens = context.tokens
        self.tree = tree
        self.root = root
        self.evaluator = Evaluator(context, 0)
        self.erased = erased_tokens(root, len(self.tokens))
        self.output: list[Token] = []

    def token(self, start: int, end: int, tags: Tags, source: Range, inserted_by: str | None) -> Token:
        strong = [phoneme for phoneme in (phoneme_of(tag) for tag, st in tags.items() if st) if phoneme is not None]
        if len(strong) > 1:
            raise _GrammarFault(f"an emitted token has two strong phoneme tags: {', '.join(sorted(t for t, s in tags.items() if s and phoneme_of(t) is not None))}", (start, end))
        phonemes = strong[0] if strong else span_phonemes(self.tokens, self.erased, start, end)
        text = self.context.text[source[0] : source[1]]
        return Token(text, dict(tags), (start, end), source, phonemes, inserted_by if start == end else None)

    def part_source(self, part: DChild) -> Range:
        if isinstance(part, DRead):
            return self.tokens[part.token].source
        return self.tree.source_of(part)

    def emit(self) -> list[Token]:
        tagtab = self.context.tagtab
        work: list[tuple[str, Any]] = [("walk", self.root)]
        while work:
            kind, value = work.pop()
            if kind == "token":
                self.output.append(value)
                continue
            if kind == "part":
                node, part, term = value
                if term is not None:
                    tags = self.evaluator.tags(term, self.evaluator.bind(node.production, self.context_caps(node)))
                elif isinstance(part, DRead):
                    tags = self.tokens[part.token].tags
                else:
                    tags = tagtab.get(part.tag)
                self.output.append(self.token(part.start, part.end, tags, self.part_source(part), node.production.rule_name))
                continue
            if kind == "insert":
                node, tag, boundary = value
                if boundary > node.start:
                    at = self.tokens[boundary - 1].source[1]
                else:
                    at = self.tree.source_of(node)[0]
                self.output.append(self.token(boundary, boundary, {tag: True}, (at, at), node.production.rule_name))
                continue
            node = value
            if isinstance(node, DRead):
                continue
            emit = node.production.emit
            if emit is None:
                work.extend(("walk", child) for child in reversed(node.children))
                continue
            if emit[0] == "nothing":
                continue
            if emit[0] == "this":
                source = self.tree.source_of(node)
                for term in emit[1]:
                    if term is not None:
                        tags = self.evaluator.tags(term, self.evaluator.bind(node.production, self.context_caps(node)))
                    else:
                        tags = tagtab.get(node.tag)
                    self.output.append(self.token(node.start, node.end, tags, source, node.production.rule_name))
                continue
            work.extend(reversed(self.plan(node, emit[1])))
        return self.output

    def context_caps(self, node: DNode) -> Any:
        return self.forest.caps[node.item]

    def plan(self, node: DNode, items: list[tuple[Any, ...]]) -> list[tuple[str, Any]]:
        named: dict[int, Any] = {}
        before: dict[int, list[str]] = {}
        after: dict[int, list[str]] = {}
        start: list[str] = []
        for index, item in enumerate(items):
            if item[0] == "capture":
                named[item[1]] = item[2]
                continue
            previous = next((other[1] for other in reversed(items[:index]) if other[0] == "capture"), None)
            if previous is not None:
                after.setdefault(previous, []).append(item[1])
                continue
            following = next((other[1] for other in items[index + 1 :] if other[0] == "capture"), None)
            if following is not None:
                before.setdefault(following, []).append(item[1])
            else:
                start.append(item[1])
        steps: list[tuple[str, Any]] = [("insert", (node, tag, node.start)) for tag in start]
        for position, child in enumerate(node.children):
            steps.extend(("insert", (node, tag, child.start)) for tag in before.get(position, ()))
            if position in named:
                steps.append(("part", (node, child, named[position])))
            else:
                steps.append(("walk", child))
            steps.extend(("insert", (node, tag, child.end)) for tag in after.get(position, ()))
        return steps


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
    erased: list[bool] | None = None
    chosen_actions: list[Act] | None = None
    tied_actions: list[Act] | None = None


def _action(act: Act, lowered: Lowered) -> Action:
    if act.read:
        return Action("read", token=act.token, terminal=act.terminal)
    production = lowered.productions[act.production]
    return Action("close", rule=production.rule_name, production=production.id, span=(act.start, act.end))


class StageRunner:
    """Runs one stage over its input tokens."""

    def __init__(
        self,
        name: str,
        lowered: Lowered,
        elision_lowered: Callable[[], Lowered],
        tokens: list[Token],
        text: str,
        unicode: UnicodeTable,
        emit: bool = True,
    ) -> None:
        self.name = name
        self.lowered = lowered
        self.elision_lowered = elision_lowered
        self.tokens = tokens
        self.text = text
        self.unicode = unicode
        self.emit = emit

    def context(self, lowered: Lowered, tokens: list[Token]) -> StageContext:
        context = StageContext(lowered, tokens, self.text, self.unicode)
        context.count = count_roots
        return context

    def fault(self, fault: _GrammarFault, tokens: list[Token]) -> ParseError:
        error = ParseError("grammar", fault.message, stage=self.name)
        if fault.span is not None:
            start, end = fault.span
            error.token = start
            source = _range_source(tokens, start, end)
            if source is None:
                at = tokens[start - 1].source[1] if 0 < start <= len(tokens) else 0
                source = (at, at)
            error.source = source
            error.line, error.column = line_column(self.text, source[0])
        return error

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
        outcome.chosen_actions = list(actions(ranking.chosen))
        if ranking.verdict == "tie":
            assert ranking.witness is not None and ranking.witness[0] is not None and ranking.witness[1] is not None
            outcome.witness = (_action(ranking.witness[0], lowered), _action(ranking.witness[1], lowered))
            outcome.tied = Tree(derivation(forest, ranking.tied), self.tokens, context.tagtab).root
            outcome.tied_actions = list(actions(ranking.tied))
        emitter = Emitter(context, forest, tree, root)
        outcome.erased = emitter.erased
        if self.emit:
            outcome.output = emitter.emit()
        if elision_only and ranking.verdict != "unique":
            # The stage accepted its input, so it has its output; the check
            # makes the parse fail, and the result has no tree.
            error = self.check_elision(tree.root)
            if error is not None:
                outcome.error = error
                outcome.tree = None
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
