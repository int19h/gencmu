"""Stitching documents into a stage's grammar (engine §2) and lowering it to
productions (engine §3)."""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from typing import Any, Union

from ._clauses import WHOLE, applies, captures_in, simplify_term
from ._errors import GencmuError
from ._tags import code_of_character_tag, property_name, range_name
from ._trampoline import Walk, run

Dom = dict[str, Any]


def is_terminal_name(name: str) -> bool:
    return bool(name) and "A" <= name[0] <= "Z"


# ---------------------------------------------------------------------------
# Stitching


@dataclass
class Alternative:
    """An alternative as stitched, with the clauses of the rule that wrote it."""

    guards: list[Dom]
    expr: Dom
    tags: Dom | None
    rule_tags: Dom | None
    emit: Dom | None
    conditions: list[Dom]
    verbatim: bool
    document: str
    at: tuple[int, int]


@dataclass
class Rule:
    name: str
    alternatives: list[Alternative]
    document: str
    at: tuple[int, int]


@dataclass
class Change:
    """A replacement or extension the loader records (engine §2)."""

    kind: str
    rule: str
    document: str
    previous: str


@dataclass
class Grammar:
    """A stage's stitched grammar and its directives."""

    stage: str
    rules: dict[str, Rule]
    lean: str
    elision_only: bool
    # Whether an elided terminator is forbidden where its constituent could
    # have been longer (engine §4).
    maximal: bool
    elidable: frozenset[str]
    changes: list[Change] = field(default_factory=list)


def _error(message: str, document: str, at: Any = None, stage: str | None = None) -> GencmuError:
    line = column = None
    if isinstance(at, (list, tuple)) and len(at) == 2:
        line, column = int(at[0]), int(at[1])
    return GencmuError(message, document=document, line=line, column=column, stage=stage)


def stitch(stage: str, documents: list[tuple[str, Dom]]) -> Grammar:
    """Stitch a stage's documents, in order, into one grammar."""
    rules: dict[str, Rule] = {}
    changes: list[Change] = []
    resolutions: list[tuple[list[str], str, Any]] = []
    elidable: set[str] = set()
    for path, dom in documents:
        for rule in dom.get("rules", []):
            name = rule["name"]
            at: tuple[int, int] = (int(rule.get("at", (0, 0))[0]), int(rule.get("at", (0, 0))[1]))
            alternatives = [
                Alternative(
                    guards=list(alt.get("guards", [])),
                    expr=alt["expr"],
                    tags=alt.get("tags"),
                    rule_tags=rule.get("tags"),
                    emit=rule.get("emit"),
                    conditions=list(rule.get("conditions", [])),
                    verbatim=rule.get("verbatim") is True,
                    document=path,
                    at=at,
                )
                for alt in rule.get("alternatives", [])
            ]
            previous = rules.get(name)
            op = rule.get("op")
            if op == "extend":
                if previous is None:
                    raise _error(f"%extend-rule {name} extends a rule that is not defined before it", path, at, stage)
                previous.alternatives.extend(alternatives)
                changes.append(Change("extend", name, path, previous.document))
            elif op == "redefine":
                if previous is None:
                    raise _error(f"%redefine-rule {name} replaces no rule defined before it", path, at, stage)
                changes.append(Change("replace", name, path, previous.document))
                # The rule keeps its place (engine §3, "Numbering").
                rules[name] = Rule(name, alternatives, path, at)
            else:
                if previous is not None:
                    raise _error(
                        f"%rule {name} is already defined, in {previous.document}; %redefine-rule replaces a rule",
                        path,
                        at,
                        stage,
                    )
                rules[name] = Rule(name, alternatives, path, at)
        for directive in dom.get("directives", []):
            name = directive["name"]
            args = list(directive.get("args", []))
            at = directive.get("at")
            if name == "ambiguity-resolution":
                resolutions.append((args, path, at))
            elif name == "elidable":
                elidable.update(args)
            else:
                raise _error(f"an unknown directive %{name}", path, at, stage)
    if not resolutions:
        raise GencmuError(f"stage {stage} has no %ambiguity-resolution", stage=stage)
    if len(resolutions) > 1:
        args, path, at = resolutions[1]
        raise _error(f"stage {stage} has more than one %ambiguity-resolution", path, at, stage)
    args, path, at = resolutions[0]
    # The lean, then elision-only and maximal, each optional, in that order
    # (engine §2).
    rest = args[1:]
    elision_only = rest[:1] == ["elision-only"]
    if elision_only:
        rest = rest[1:]
    maximal = rest[:1] == ["maximal"]
    if maximal:
        rest = rest[1:]
    if not args or args[0] not in ("greedy", "lazy") or rest:
        raise _error(
            "%ambiguity-resolution takes greedy or lazy, then optionally elision-only, then optionally maximal", path, at, stage
        )
    if "text" not in rules:
        raise GencmuError(f"stage {stage} has no rule text, its start rule", stage=stage)
    for rule in rules.values():
        for alt in rule.alternatives:
            stack: list[Any] = [alt.expr, alt.tags, alt.rule_tags, alt.emit, alt.conditions]
            while stack:
                value = stack.pop()
                if isinstance(value, dict):
                    ref = value.get("ref")
                    if isinstance(ref, str) and not is_terminal_name(ref) and ref not in rules:
                        raise _error(f"{ref} is not a rule of stage {stage}", alt.document, alt.at, stage)
                    if isinstance(value.get("rule"), str) and value["rule"] not in rules:
                        raise _error(f"{value['rule']} is not a rule of stage {stage}", alt.document, alt.at, stage)
                    stack.extend(value.values())
                elif isinstance(value, list):
                    stack.extend(value)
    return Grammar(stage, rules, args[0], elision_only, maximal, frozenset(elidable), changes)


# ---------------------------------------------------------------------------
# Lowering


@dataclass
class Production:
    """A production of the lowered grammar."""

    id: int
    lhs: int
    rhs: tuple[Union[str, int], ...]
    terminal: tuple[bool, ...]
    rule_name: str
    helper: bool
    rep_splice: bool = False
    elided: str | None = None
    # The spelling of that terminator, if it is spelled, which a restored
    # token sounds like (engine §7).
    elided_spelling: str | None = None
    # What each symbol's span must sound like, lowercased, or None for a
    # symbol without a spelling (engine §4); None when no symbol has one.
    # The spelling is not part of the symbol's identity.
    spellings: tuple[str | None, ...] | None = None
    captures: dict[str, int] = field(default_factory=dict)
    slots: tuple[int, ...] = ()
    conds_predict: list[Dom] = field(default_factory=list)
    conds_at: dict[int, list[Dom]] = field(default_factory=dict)
    conds_whole: list[Dom] = field(default_factory=list)
    tags_term: Dom | None = None
    emit: Any = None
    # Whether a token over its constituent sounds like its text (engine
    # §11). It is false for a helper.
    verbatim: bool = False
    # The features of the alternative's warnings, in the order they are
    # written (engine §12); none for a helper.
    warnings: tuple[str, ...] = ()

    @property
    def transparent(self) -> bool:
        return self.helper or len(self.rhs) == 1


IMPLICIT = "\u0000"
"""The capture name of the implicit capture of a one-symbol production
without tags (engine §3.7), which no written capture can have."""


@dataclass
class Lowered:
    """A lowered grammar: productions, and rules by number."""

    grammar: Grammar
    productions: list[Production]
    rule_names: list[str]
    rule_ids: dict[str, int]
    rule_productions: list[list[int]]
    rule_display: list[str]
    lean: str
    # The ranges and properties among the terminals, by their written
    # form, which is their name (engine §4): what each one matches.
    characters: dict[str, CharacterClass] = field(default_factory=dict)
    # The productions of each rule that begin with a terminal, by that
    # terminal; those that begin with a range or a property are apart, since
    # a token matches them by its characters and not by a tag.
    by_first_terminal: list[dict[str, list[int]]] = field(default_factory=list)
    by_first_characters: list[dict[str, list[int]]] = field(default_factory=list)
    not_terminal_first: list[list[int]] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.by_first_terminal = [{} for _ in self.rule_names]
        self.by_first_characters = [{} for _ in self.rule_names]
        self.not_terminal_first = [[] for _ in self.rule_names]
        for production in self.productions:
            if production.rhs and production.terminal[0]:
                first: str = production.rhs[0]  # type: ignore[assignment]
                table = self.by_first_characters if first in self.characters else self.by_first_terminal
                table[production.lhs].setdefault(first, []).append(production.id)
            else:
                self.not_terminal_first[production.lhs].append(production.id)


CharacterClass = Union[tuple[int, int], str]
"""What a range or a property matches: a range's first and last scalar
values, or a property's name."""


# A symbol of an expansion: ("t", tag) or ("n", rule id), with a third
# element, its spelling, for a spelled symbol; and its capture.
_Sym = tuple[tuple[Any, ...], Union[str, None]]


def written_symbol(name: str, spelling: str | None) -> str:
    """A terminal as the diagnostics write it: its name, followed by its
    spelling in backticks if it has one, such as LE`la` (docs/output.md)."""
    return name if spelling is None else f"{name}`{spelling}`"


class _Lowerer:
    def __init__(self, grammar: Grammar, features: frozenset[str], elision: bool) -> None:
        self.grammar = grammar
        self.features = features
        self.elision = elision
        self.rule_names: list[str] = list(grammar.rules)
        self.rule_ids = {name: index for index, name in enumerate(self.rule_names)}
        self.rule_display: list[str] = list(self.rule_names)
        self.helper_expansions: dict[int, list[list[_Sym]]] = {}
        self.helper_elided: dict[int, tuple[str, str | None]] = {}
        self.emitted_helpers: set[int] = set()
        self.productions: list[Production] = []
        self.current: Rule | None = None
        self.current_alt: Alternative | None = None
        self.characters: dict[str, CharacterClass] = {}

    def fail(self, message: str) -> GencmuError:
        rule = self.current
        alt = self.current_alt
        document = alt.document if alt else (rule.document if rule else None)
        at = alt.at if alt else (rule.at if rule else None)
        return _error(message, document or "", at, self.grammar.stage)

    # -- expansions

    def new_helper(self, expansions: list[list[_Sym]], elided: tuple[str, str | None] | None = None) -> int:
        number = len(self.rule_names)
        owner = self.current.name if self.current else "?"
        self.rule_names.append(f"\u0000{owner}\u0000{number}")
        self.rule_display.append(owner)
        self.helper_expansions[number] = expansions
        if elided is not None:
            self.helper_elided[number] = elided
        return number

    def first_terminal(self, expr: Dom) -> tuple[str, str | None] | None:
        """The terminal an expression begins with, if any, and its
        spelling: a spelled terminal is elidable when its terminal is
        (engine §3.8)."""
        spelling: str | None = None
        while True:
            if "seq" in expr:
                if not expr["seq"]:
                    return None
                expr = expr["seq"][0]
                continue
            if "spelling" in expr:
                spelling = expr["spelling"]
                expr = expr["expr"]
                continue
            if "ref" in expr:
                name: str = expr["ref"]
                return (name, spelling) if is_terminal_name(name) else None
            if "terminal" in expr:
                terminal: str = expr["terminal"]
                return (terminal, spelling)
            return None

    def character_class(self, expr: Dom) -> tuple[str, Any] | None:
        """A range or a property as a terminal, whose name is its written
        form, and which matches by its characters rather than by a tag
        (engine §4); None for any other expression."""
        if "range" in expr:
            ends = expr["range"]
            name = range_name(ends)
            self.characters[name] = (code_of_character_tag(ends[0]), code_of_character_tag(ends[1]))
            return ("t", name)
        if "property" in expr:
            name = property_name(expr["property"])
            self.characters[name] = expr["property"]
            return ("t", name)
        return None

    def symbol(self, name: str) -> tuple[str, Any]:
        if is_terminal_name(name):
            return ("t", name)
        number = self.rule_ids.get(name)
        if number is None:
            raise self.fail(f"{name} is not a rule of stage {self.grammar.stage}")
        return ("n", number)

    def expand(self, expr: Dom, top: bool = False) -> list[list[_Sym]]:
        """An expression's expansions (engine §3.2), without recursion."""
        return run(self._expand(expr, top))  # type: ignore[no-any-return]

    def _expand(self, expr: Dom, top: bool = False) -> Walk:
        if "seq" in expr:
            parts = []
            for item in expr["seq"]:
                parts.append((yield self._expand(item, top)))
            return [[sym for part in combination for sym in part] for combination in itertools.product(*parts)]
        if "choice" in expr:
            options = []
            for option in expr["choice"]:
                options.extend((yield self._expand(option)))
            return options
        if "and" in expr:
            items = expr["and"]
            if len(items) > 16:
                raise self.fail("& joins at most 16 items, since it expands to 2ⁿ−1 sequences")
            expanded = []
            for item in items:
                expanded.append((yield self._expand(item)))
            result: list[list[_Sym]] = []
            for mask in range(1, 1 << len(items)):
                parts = [expanded[index] for index in range(len(items)) if mask >> index & 1]
                result.extend([sym for part in combination for sym in part] for combination in itertools.product(*parts))
            return result
        if "optional" in expr:
            inner = expr["optional"]
            body = yield self._expand(inner)
            first = self.first_terminal(inner)
            elidable = first is not None and first[0] in self.grammar.elidable
            if elidable and self.elision:
                return [[(("n", self.new_helper(body)), None)]]
            helper = self.new_helper([[]] + body, first if elidable else None)
            return [[(("n", helper), None)]]
        if "repeat" in expr:
            body = yield self._expand(expr["repeat"])
            return [[(("n", self.repeat_helper(body, expr.get("min", 1))), None)]]
        if "empty" in expr:
            return [[]]
        if "ref" in expr:
            return [[(self.symbol(expr["ref"]), None)]]
        if "terminal" in expr:
            return [[(("t", expr["terminal"]), None)]]
        if "range" in expr or "property" in expr:
            return [[(self.character_class(expr), None)]]
        if "spelling" in expr:
            # A spelled symbol lowers to its symbol with the spelling, and
            # adds no helper (engine §3).
            spelled = yield self._expand(expr["expr"])
            kind, name = spelled[0][0][0][:2]
            return [[((kind, name, expr["spelling"]), None)]]
        if "capture" in expr:
            if not top:
                raise self.fail(f"the capture ${expr['capture']} is not at the top level of its alternative")
            inner = expr.get("expr", {})
            spelling = inner.get("spelling")
            if spelling is not None:
                inner = inner.get("expr", {})
            symbol: tuple[Any, ...]
            if "ref" in inner:
                symbol = self.symbol(inner["ref"])
            elif "terminal" in inner:
                symbol = ("t", inner["terminal"])
            elif "range" in inner or "property" in inner:
                symbol = self.character_class(inner)  # type: ignore[assignment]
            else:
                raise self.fail(f"the capture ${expr['capture']} does not wrap one symbol")
            if spelling is not None:
                symbol = (symbol[0], symbol[1], spelling)
            return [[(symbol, expr["capture"])]]
        raise self.fail(f"an unknown expression {sorted(expr)}")

    def repeat_helper(self, body: list[list[_Sym]], minimum: int) -> int:
        number = len(self.rule_names)
        recursive: list[list[_Sym]] = [[(("n", number), None)] + expansion for expansion in body]
        base: list[list[_Sym]] = [[]] if minimum == 0 else body
        helper = self.new_helper(base + recursive)
        assert helper == number
        return helper

    # -- productions

    def add(
        self, lhs: int, expansion: list[_Sym], alt: Alternative | None, rep_splice: bool = False, elided: tuple[str, str | None] | None = None
    ) -> None:
        rhs = tuple(sym[1] for sym, _ in expansion)
        terminal = tuple(sym[0] == "t" for sym, _ in expansion)
        spellings = tuple(sym[2] if len(sym) > 2 else None for sym, _ in expansion)
        captures: dict[str, int] = {}
        for position, (_, name) in enumerate(expansion):
            if name is not None:
                if name in captures:
                    raise self.fail(f"the capture ${name} appears twice in one alternative")
                captures[name] = position
        production = Production(
            id=len(self.productions),
            lhs=lhs,
            rhs=rhs,
            terminal=terminal,
            rule_name=self.rule_display[lhs],
            helper=alt is None,
            rep_splice=rep_splice,
            elided=elided[0] if elided is not None else None,
            elided_spelling=elided[1] if elided is not None else None,
            spellings=spellings if any(spelling is not None for spelling in spellings) else None,
            captures=captures,
        )
        if alt is not None:
            # $ is a capture every production has, and each clause is
            # simplified for the captures this one has (engine §3.6).
            present = captures.keys() | {WHOLE}
            for written in alt.conditions:
                condition = applies(written, present)
                if condition is None:
                    continue
                if condition is False:
                    # A condition false for this production removes it.
                    return
                names = captures_in(condition)
                if WHOLE in names and rhs:
                    # Evaluated when the item is complete (engine §4).
                    production.conds_whole.append(condition)
                elif names - {WHOLE}:
                    production.conds_at.setdefault(max(captures[name] for name in names), []).append(condition)
                else:
                    # No capture, or only $ over an empty production: at
                    # prediction.
                    production.conds_predict.append(condition)
            # The union of the alternative's own tags and the definition's
            # (engine §3.7); the reader has made sure neither uses a capture
            # the alternative lacks.
            terms = [simplify_term(term, present) for term in (alt.tags, alt.rule_tags) if term is not None]
            if terms:
                production.tags_term = terms[0] if len(terms) == 1 else {"union": terms}
            production.emit = self.lower_emit(alt.emit, captures)
            production.verbatim = alt.verbatim
            production.warnings = tuple(guard["feature"] for guard in alt.guards if guard.get("kind") == "warning")
        if production.tags_term is None and len(rhs) == 1 and 0 not in captures.values():
            captures[IMPLICIT] = 0
        slots = [-1] * len(rhs)
        for index, position in enumerate(sorted(captures.values())):
            slots[position] = index
        production.slots = tuple(slots)
        self.productions.append(production)

    def flush(self, expansions: list[list[_Sym]]) -> None:
        """Number the helpers these expansions use, after the productions of
        the alternative that introduced them: in the order they were made,
        each followed by the helpers its own productions use."""
        def used(expansions: list[list[_Sym]]) -> list[int]:
            return sorted(
                {sym[1] for expansion in expansions for sym, _ in expansion if sym[0] == "n" and sym[1] in self.helper_expansions}
            )

        # Depth first, with a stack of the helpers still to number.
        stack = list(reversed(used(expansions)))
        while stack:
            number = stack.pop()
            if number in self.emitted_helpers:
                continue
            self.emitted_helpers.add(number)
            elided = self.helper_elided.get(number)
            own = self.helper_expansions[number]
            for expansion in own:
                self.add(number, expansion, None, elided=elided if not expansion else None)
            stack.extend(reversed(used(own)))

    def lower_emit(self, emit: Dom | None, captures: dict[str, int]) -> list[tuple[Any, ...]] | None:
        """A production's emission, the items it emits in list order, less
        those that name a capture the production lacks (engine §3.6, §11):
        ``("whole", term or None)`` for ``$``, ``("capture", position, term
        or None)``, and ``("insert", tag, anchor)``, the anchor being the
        position of the capture listed next after it, or ``None`` for the
        constituent's end. ``%emits ε`` is the empty list."""
        if emit is None:
            return None
        present = captures.keys() | {WHOLE}

        def own(term: Any) -> Any:
            return simplify_term(term, present) if term is not None else None

        items = [item for item in emit.get("items", []) if "insert" in item or item["capture"] in present]
        lowered: list[tuple[Any, ...]] = []
        for index, item in enumerate(items):
            if "insert" in item:
                anchor = next((captures[other["capture"]] for other in items[index + 1 :] if "capture" in other), None)
                lowered.append(("insert", item["insert"], anchor))
            elif item["capture"] == WHOLE:
                lowered.append(("whole", own(item.get("tags"))))
            else:
                lowered.append(("capture", captures[item["capture"]], own(item.get("tags"))))
        return lowered

    def check_captures(self, expr: Dom) -> None:
        top = expr["seq"] if "seq" in expr else [expr]
        count = 0
        nested: list[Any] = []
        for item in top:
            if "capture" in item and "expr" in item:
                count += 1
                inner = item["expr"]
                # A capture may wrap a spelled symbol (engine §3.5).
                if isinstance(inner, dict) and "spelling" in inner:
                    inner = inner.get("expr")
                if not isinstance(inner, dict) or not ("ref" in inner or "terminal" in inner or "range" in inner or "property" in inner):
                    raise self.fail(f"the capture ${item['capture']} does not wrap one symbol")
            else:
                nested.append(item)
        while nested:
            value = nested.pop()
            if isinstance(value, dict):
                if "capture" in value and "expr" in value:
                    raise self.fail(f"the capture ${value['capture']} is not at the top level of its alternative")
                nested.extend(value.values())
            elif isinstance(value, list):
                nested.extend(value)
        if count > 4:
            raise self.fail("an alternative has more than four captures")

    def lower(self) -> Lowered:
        for name, rule in self.grammar.rules.items():
            self.current = rule
            lhs = self.rule_ids[name]
            for alt in rule.alternatives:
                self.current_alt = alt
                self.check_captures(alt.expr)
            alternatives = [alt for alt in rule.alternatives if self.holds(alt.guards)]
            for alt in alternatives:
                self.current_alt = alt
                expr = alt.expr
                trailing: tuple[list[Dom], Dom] | None = None
                if len(alternatives) == 1:
                    if "repeat" in expr:
                        trailing = ([], expr)
                    elif "seq" in expr and expr["seq"] and "repeat" in expr["seq"][-1]:
                        trailing = (expr["seq"][:-1], expr["seq"][-1])
                if trailing is None:
                    expansions = self.expand(expr, top=True)
                    for expansion in expansions:
                        self.add(lhs, expansion, alt)
                    self.flush(expansions)
                    continue
                prefix, repeat = trailing
                if any("capture" in item and "expr" in item for item in prefix):
                    # The recursive productions could not have the capture,
                    # whose part lies inside the inner constituent (engine
                    # §3.3).
                    raise self.fail(f"an alternative of {name} captures a part, and is lowered as a trailing repetition")
                heads = self.expand({"seq": prefix}, top=True)
                body = self.expand(repeat["repeat"])
                if repeat.get("min", 1) == 1:
                    bases = [head + item for head in heads for item in body]
                else:
                    bases = heads
                for expansion in bases:
                    self.add(lhs, expansion, alt)
                for expansion in body:
                    self.add(lhs, [(("n", lhs), None)] + expansion, alt, rep_splice=True)
                self.flush(bases + body)
            self.current_alt = None
        rule_productions: list[list[int]] = [[] for _ in self.rule_names]
        for production in self.productions:
            rule_productions[production.lhs].append(production.id)
        return Lowered(
            grammar=self.grammar,
            productions=self.productions,
            rule_names=self.rule_names,
            rule_ids={name: index for index, name in enumerate(self.rule_names)},
            rule_productions=rule_productions,
            rule_display=self.rule_display,
            lean=self.grammar.lean,
            characters=self.characters,
        )

    def holds(self, guards: list[Dom]) -> bool:
        # Only gates drop an alternative; a warning keeps it (engine §3.1).
        return all(
            guard.get("kind") == "warning" or (guard["feature"] in self.features) != bool(guard.get("negated"))
            for guard in guards
        )


def lower(grammar: Grammar, features: frozenset[str], elision: bool = False) -> Lowered:
    """Lower a stage's grammar for a set of enabled features (engine §3)."""
    return _Lowerer(grammar, features, elision).lower()
