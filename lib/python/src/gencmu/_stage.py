"""Running one stage: recognition, the ranking, the elision-only check
(engine §7), the tree (engine §12) and emission (engine §11)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Union

from ._earley import RESTORE, Evaluator, Forest, Parser, Sources, StageContext
from ._errors import _GrammarFault
from ._grammar import Lowered, Production, SymbolTest, written_symbol
from ._markdown import line_column
from ._model import Action, Expected, Node, ParseError, ParseWarning, Range, Restoration, Tags, Token
from ._rank import (
    Act,
    Elisions,
    Ranker,
    Ranking,
    Rope,
    actions,
    compare_profiles,
    concat,
    count_roots,
    first_difference,
    leaf,
    rank,
    sum_profiles,
)
from ._trampoline import run
from ._recipes import selected
from ._unicode import UnicodeTable
from . import _testing
from ._restored import empty_source, restore


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


def _restored_value(test: SymbolTest | None) -> str | None:
    """A restored terminator's value: the string of its = test,
    or nothing (engine §7)."""
    return test.value if test is not None and test.op == "=" else None


def _range_source(sources: Sources, start: int, end: int) -> Range:
    """Where tokens start..end stand in the text: their source (engine
    §1), or, for an empty span, the point where it stands (engine §12)."""
    if start < end:
        return sources.of(start, end)
    return _empty_source(sources.tokens, start)


def _empty_source(tokens: list[Token], position: int) -> Range:
    """Where an empty span stands in the text (engine §12)."""
    return empty_source(tokens, position)


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
                                value=_restored_value(child.production.elided_test),
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
    return production.erased


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
    """Separate emission, channel, and ownership walks (engine §11)."""

    def __init__(self, context: StageContext, forest: Forest, tree: Tree, root: DNode) -> None:
        self.context = context
        self.forest = forest
        self.tokens = context.tokens
        self.tree = tree
        self.root = root
        self.evaluator = Evaluator(context, 0, len(context.tokens))
        self.boundary_first = self.boundary_last = None
        self.channels = {}
        self.recipes = {}
        self.active = set()
        self.claims = {}
        self.inherited = set()
        self.forwards = any(token.before or token.after for token in self.tokens)
        self.coverage = []
        for start, end in sorted(token.source for token in self.tokens if token.source[0] < token.source[1]):
            if self.coverage and start <= self.coverage[-1][1]:
                self.coverage[-1] = (self.coverage[-1][0], max(end, self.coverage[-1][1]))
            else:
                self.coverage.append((start, end))

    def boundary_index(self):
        self.boundary_first, self.boundary_last = {}, {}
        pending = [self.root]
        while pending:
            child = pending.pop()
            if child.start == child.end:
                continue
            if isinstance(child, DRead):
                name = child.terminal
            else:
                name = None if child.production.helper else child.production.rule_name
                pending.extend(child.children)
            if name is not None:
                self.boundary_first.setdefault(child.start, set()).add(name)
                self.boundary_last.setdefault(child.end, set()).add(name)

    def part_source(self, part: DChild) -> Range:
        return self.tokens[part.token].source if isinstance(part, DRead) else self.tree.source_of(part)

    def capture(self, owner: DNode, name: str) -> DChild:
        return owner if name == "" else owner.children[owner.production.captures[name]]

    def verbatim(self, part: DChild) -> str:
        span = part.start, part.end
        if part.start == part.end:
            return ""
        left, right = self.part_source(part)
        before = self.tokens[part.start - 1].source[1] if part.start else 0
        after = self.tokens[part.end].source[0] if part.end < len(self.tokens) else len(self.context.text)
        start, end = left, right
        if before < left:
            start = before
            for a, b in self.coverage:
                if a >= left:
                    break
                if b > start:
                    start = min(left, b)
        if right < after:
            end = after
            for a, b in self.coverage:
                if b <= right:
                    continue
                end = max(right, min(end, a))
                break
        extensions = [(start, left)] if start < left else []
        if right < end:
            extensions.append((right, end))
        if span not in self.claims:
            for other in self.claims.values():
                if any(max(a, c) < min(b, d) for a, b in extensions for c, d in other):
                    raise _GrammarFault("verbatim recipes claim the same uncovered text from different spans")
            self.claims[span] = extensions
        return self.context.text[start:end]

    def string(self, part: DChild, channel: str):
        key = id(part), channel
        if key in self.channels:
            return self.channels[key]
        if isinstance(part, DRead):
            return getattr(self.tokens[part.token], channel)
        if part.production.erased:
            return ""
        if key in self.active:
            raise _GrammarFault("a constituent recipe has a channel dependency cycle")
        self.active.add(key)
        try:
            recipe = part.production.value if channel == "value" else selected(part.production.value, part.production.image)[1]
            if recipe is not None:
                value = yield self.recipe(part, recipe)
            else:
                pieces = []
                for child in part.children:
                    pieces.append((yield self.string(child, channel)))
                value = "".join(pieces)
            self.channels[key] = value
            return value
        finally:
            self.active.remove(key)

    def recipe(self, owner: DNode, recipe):
        key = id(owner), id(recipe)
        if key in self.recipes:
            return self.recipes[key]
        parts = []
        for atom in recipe["concat"]:
            if "string" in atom:
                value = atom["string"]
            elif "interpolate" in atom:
                value = "".join(part["string"] for part in atom["interpolate"])
            else:
                method = atom["method"]
                receiver = atom["receiver"]
                emitted = receiver.get("method") == "emitted"
                name = receiver["receiver"]["capture"] if emitted else receiver["capture"]
                part = self.capture(owner, name)
                if emitted:
                    value = yield self.string(part, method)
                elif method == "verbatim-text":
                    value = self.verbatim(part)
                elif method in ("source-text", "decomposed-source-text"):
                    source = self.part_source(part)
                    value = self.context.text[source[0] : source[1]] if part.start < part.end else ""
                    if method == "decomposed-source-text":
                        value = self.context.unicode.decompose(value)
                else:
                    value = "".join(getattr(self.tokens[i], method) for i in range(part.start, part.end))
            parts.append(value)
        value = "".join(parts)
        self.recipes[key] = value
        return value

    def item_strings(self, owner: DNode, part: DChild | None, value, image) -> tuple[str, str]:
        if value is not None:
            written_value = run(self.recipe(owner, value))
        else:
            written_value = run(self.string(part, "value")) if part is not None else ""
        if image is not None:
            written_image = run(self.recipe(owner, image))
        elif value is not None:
            written_image = written_value
        else:
            written_image = run(self.string(part, "image")) if part is not None else ""
        return written_value, written_image

    def forwarded(self, part: DChild) -> Token | None:
        count = 0
        found = None
        pending = [part]
        while pending:
            node = pending.pop()
            if isinstance(node, DRead):
                count += 1
                token = self.tokens[node.token]
                if token.before or token.after:
                    found = token
            elif not node.production.erased:
                pending.extend(reversed(node.children))
        if found is not None and count > 1:
            raise _GrammarFault("a covering token combines attached input with another counted token")
        return found

    def part_token(self, owner: DNode, part: DChild, explicit: Tags, value, image) -> Token:
        source = self.part_source(part)
        text = self.context.text[source[0] : source[1]]
        written_value, written_image = self.item_strings(owner, part, value, image)
        token = Token(text, implied(explicit, self.context.lowered), (part.start, part.end), source, written_value, image=written_image)
        origin = self.forwarded(part) if self.forwards else None
        if origin is not None:
            if id(origin) in self.inherited:
                raise _GrammarFault("two covering tokens claim the same input attachments")
            self.inherited.add(id(origin))
            token.before = list(origin.before)
            token.after = list(origin.after)
        return token

    def item_tags(self, node: DNode, term: Any) -> Tags:
        bound = self.evaluator.bind(
            node.production,
            self.forest.caps[node.item],
            (node.start, node.end, node.tag),
            self.forest.structure[node.item] if self.forest.structure else 0,
            self.forest.close_structure[node.item] if self.forest.close_structure else 0,
        )
        def boundary_test(atom):
            if self.boundary_first is None:
                self.boundary_index()
            part = self.capture(node, atom["receiver"]["capture"])
            names = (self.boundary_first.get(part.end, ()) if atom["method"] == "followed-by"
                     else self.boundary_last.get(part.start, ()))
            return any(arg.get("rule", arg.get("terminal")) in names for arg in atom["args"])
        bound.boundary_test = boundary_test
        return self.evaluator.tags(term, bound)

    def emit_item(self, node: DNode, item: tuple, out: list[Token]) -> None:
        tagtab = self.context.tagtab
        if item[0] == "whole":
            _, term, value, image = item
            tags = self.item_tags(node, term) if term is not None else tagtab.get(node.tag)
            out.append(self.part_token(node, node, tags, value, image))
        elif item[0] == "capture":
            _, position, term, _, _, value, image = item
            part = node.children[position]
            tags = (
                self.item_tags(node, term)
                if term is not None
                else self.tokens[part.token].tags
                if isinstance(part, DRead)
                else tagtab.get(part.tag)
            )
            out.append(self.part_token(node, part, tags, value, image))
        else:
            _, term, anchor, value, image = item
            if anchor == -1:
                boundary, at = node.start, self.part_source(node)[0]
            elif anchor is not None:
                part = node.children[anchor]
                boundary, at = part.start, self.part_source(part)[0]
            else:
                boundary = node.end
                at = self.tokens[boundary - 1].source[1] if boundary > node.start else self.part_source(node)[0]
            tags = self.item_tags(node, term) if term is not None else frozenset()
            written_value, written_image = self.item_strings(node, None, value, image)
            out.append(
                Token(
                    "",
                    implied(tags, self.context.lowered),
                    (boundary, boundary),
                    (at, at),
                    written_value,
                    node.production.rule_name,
                    written_image,
                )
            )

    def emit(self) -> list[Token]:
        return self.emitted(self.root)

    def emitted(self, root: DChild) -> list[Token]:
        out = []
        work = [("walk", root, out)]
        while work:
            task = work.pop()
            kind = task[0]
            if kind == "walk":
                _, node, into = task
                if isinstance(node, DRead) or node.production.erased:
                    continue
                if node.production.emit is None:
                    work.extend(("walk", child, into) for child in reversed(node.children))
                else:
                    work.extend(("item", node, item, into) for item in reversed(node.production.emit))
            elif kind == "item":
                _, node, item, into = task
                if item[0] != "capture" or not (item[3] or item[4]):
                    self.emit_item(node, item, into)
                    continue
                before, after = [], []
                steps = [("walk", node.children[p], before) for p in item[3]]
                steps.append(("carrier", node, item, into))
                steps.extend(("walk", node.children[p], after) for p in item[4])
                steps.append(("attach", into, before, after))
                work.extend(reversed(steps))
            elif kind == "carrier":
                _, node, item, into = task
                self.emit_item(node, item, into)
            else:
                _, into, before, after = task
                for token in (*before, *after):
                    token.span = None
                token = into[-1]
                token.before = [*before, *token.before]
                token.after = [*token.after, *after]
        return out


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

    def rejection(self, forest: Forest) -> ParseError:
        """The error of a stage that rejected its input: at the furthest
        position any item reached, with the terminals the items there could
        have read next (engine §4)."""
        tokens = self.tokens
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
        candidates = []
        for literal, at, end, annotation in forest.boundary_failures:
            if end >= position and annotation is not None:
                for order, condition, rule in annotation.sites:
                    candidates.append((at, order, condition, rule))
        boundary = None
        if candidates:
            at, order, condition, rule = min(candidates)
            boundary = {"rule": rule, "condition": condition, "at": at}
            message += f"; boundary condition {condition + 1} of {rule} failed at {at}"
        return ParseError("rejected", message, stage=self.name, token=position, source=source, line=line, column=column, expected=expected, boundary=boundary)

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
        ranking = rank(forest, lowered.lean)
        if ranking is None:
            if forest.roots:
                forest.furthest = len(self.tokens)
            return StageOutcome(error=self.rejection(forest))
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
        records = [Restoration(node.terminal or "", node.span[0], node.source, node.value) for node in elided_nodes(tree)]
        view = restore(tokens, records)
        restored, synthetic, project = view.tokens, view.synthetic, view.project
        original_at, record_at, record_of = view.original_at, view.record_at, view.record_of
        lowered = self.lowered
        context = StageContext(lowered, restored, self.text, self.unicode, tagtab=main.tagtab, observed=main)
        context.synthetic = synthetic
        context.project = project
        # The recognition of R is not a query (engine §4, §7.6).
        forest = _reconstruct(context)
        lowered = forest.lowered
        # A test that watches the check marks W(D)'s edges before the check
        # ranks (tests/README.md).
        hook = _testing.elision_check
        watch = hook(_testing.CheckRun(chosen, forest, synthetic, original_at, record_at)) if hook is not None else None
        # The reconstruction ranks with no stage policy, and
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
                if node.production.fewest and node.start < node.end:
                    from ._rank import Profile
                    chosen_profile = Profile(chosen_profile, getattr(chosen_profile, "fewest", 0) + 1)
                pending.extend(node.children)
            walk = walk_witness(_testing.CheckRun(chosen, forest, synthetic, original_at, record_at))
        marks = walk.marks if walk is not None else watch.marks if watch is not None else None
        preferred = bool(lowered.ranked_helpers)
        raw_counted = True
        if preferred:
            raw = rank(forest, "none", marks=marks, check=True, unfiltered=True)
            raw_counted = raw is not None and raw.witness_counted is True
        ranking = _rank_check(forest, marks)
        better = False
        watched_selection = False
        if protected and ranking is not None:
            order = compare_profiles(ranking.profile, chosen_profile)
            if walk is None or not raw_counted or not preferred and (ranking.witness_counted is not True or order > 0):
                ranking = None
            else:
                restored_rope = None
                for act in walk.sequence:
                    restored_rope = concat(restored_rope, leaf(act))
                excluded = ranking.witness_counted is not True
                better = excluded or order < 0
                if watch is not None and not better and not preferred:
                    watch.ranked(ranking)
                    watched_selection = True
                if better or ranking.verdict == "tie":
                    competitor = ranking.first if first_difference(restored_rope, ranking.first, False) is not None else ranking.second
                    if competitor is None:
                        raise RuntimeError("Reconstruction requires a distinct best admitted competitor.")
                    ranking.first, ranking.second = restored_rope, competitor
                    difference = first_difference(restored_rope, competitor, True) or first_difference(restored_rope, competitor, False)
                    assert difference is not None
                    ranking.witness = (difference[1], difference[2])
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
    """Rank reconstruction with no stage policy."""
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
            node.value = record.value
            node.token = None
        elif node.kind == "token" and node.token is not None:
            node.token = project[node.token]
            node.span = (node.token, node.token + 1)
        else:
            node.span = (project[node.span[0]], project[node.span[1]])
            node.source = _range_source(original, node.span[0], node.span[1])
        stack.extend(node.children)
    return tree
