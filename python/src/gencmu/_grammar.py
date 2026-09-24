"""Stitching documents into a stage's grammar (engine §2) and lowering it to
productions (engine §3)."""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from typing import Any, Union

from ._errors import GencmuError
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
        defined_here: set[str] = set()
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
                    document=path,
                    at=at,
                )
                for alt in rule.get("alternatives", [])
            ]
            if rule.get("op") == "extend":
                existing = rules.get(name)
                if existing is None:
                    raise _error(f"|≔ extends {name}, which no document defined before it", path, at, stage)
                existing.alternatives.extend(alternatives)
                changes.append(Change("extend", name, path, existing.document))
            else:
                if name in defined_here:
                    raise _error(f"{name} is defined twice with ≔ in one document", path, at, stage)
                defined_here.add(name)
                if name in rules:
                    changes.append(Change("replace", name, path, rules[name].document))
                    rules[name] = Rule(name, alternatives, path, at)
                else:
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
    if not args or args[0] not in ("greedy", "lazy") or len(args) > 2 or (len(args) == 2 and args[1] != "elision-only"):
        raise _error("%ambiguity-resolution is greedy or lazy, optionally followed by elision-only", path, at, stage)
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
    return Grammar(stage, rules, args[0], len(args) == 2, frozenset(elidable), changes)


# ---------------------------------------------------------------------------
# Lowering


WHOLE = ""
"""The capture name of ``$``, the whole constituent, which every production
has without writing it (engine §3.5)."""


def captures_in(dom: Any) -> set[str]:
    """The capture names a condition or term mentions, ``WHOLE`` for ``$``."""
    found: set[str] = set()
    stack = [dom]
    while stack:
        value = stack.pop()
        if isinstance(value, dict):
            name = value.get("capture")
            if isinstance(name, str) and "expr" not in value:
                found.add(name)
            stack.extend(value.values())
        elif isinstance(value, list):
            stack.extend(value)
    return found


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
    captures: dict[str, int] = field(default_factory=dict)
    slots: tuple[int, ...] = ()
    conds_predict: list[Dom] = field(default_factory=list)
    conds_at: dict[int, list[Dom]] = field(default_factory=dict)
    conds_whole: list[Dom] = field(default_factory=list)
    tags_term: Dom | None = None
    emit: Any = None

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
    by_first_terminal: list[dict[str, list[int]]] = field(default_factory=list)
    not_terminal_first: list[list[int]] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.by_first_terminal = [{} for _ in self.rule_names]
        self.not_terminal_first = [[] for _ in self.rule_names]
        for production in self.productions:
            if production.rhs and production.terminal[0]:
                self.by_first_terminal[production.lhs].setdefault(production.rhs[0], []).append(production.id)  # type: ignore[arg-type]
            else:
                self.not_terminal_first[production.lhs].append(production.id)


# A symbol of an expansion: ("t", tag) or ("n", rule id), and its capture.
_Sym = tuple[tuple[str, Any], Union[str, None]]


class _Lowerer:
    def __init__(self, grammar: Grammar, features: frozenset[str], elision: bool) -> None:
        self.grammar = grammar
        self.features = features
        self.elision = elision
        self.rule_names: list[str] = list(grammar.rules)
        self.rule_ids = {name: index for index, name in enumerate(self.rule_names)}
        self.rule_display: list[str] = list(self.rule_names)
        self.helper_expansions: dict[int, list[list[_Sym]]] = {}
        self.helper_elided: dict[int, str] = {}
        self.emitted_helpers: set[int] = set()
        self.productions: list[Production] = []
        self.current: Rule | None = None
        self.current_alt: Alternative | None = None

    def fail(self, message: str) -> GencmuError:
        rule = self.current
        alt = self.current_alt
        document = alt.document if alt else (rule.document if rule else None)
        at = alt.at if alt else (rule.at if rule else None)
        return _error(message, document or "", at, self.grammar.stage)

    # -- expansions

    def new_helper(self, expansions: list[list[_Sym]], elided: str | None = None) -> int:
        number = len(self.rule_names)
        owner = self.current.name if self.current else "?"
        self.rule_names.append(f"\u0000{owner}\u0000{number}")
        self.rule_display.append(owner)
        self.helper_expansions[number] = expansions
        if elided is not None:
            self.helper_elided[number] = elided
        return number

    def first_terminal(self, expr: Dom) -> str | None:
        while True:
            if "seq" in expr:
                if not expr["seq"]:
                    return None
                expr = expr["seq"][0]
                continue
            if "ref" in expr:
                name: str = expr["ref"]
                return name if is_terminal_name(name) else None
            if "terminal" in expr:
                terminal: str = expr["terminal"]
                return terminal
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
            elidable = first is not None and first in self.grammar.elidable
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
        if "capture" in expr:
            if not top:
                raise self.fail(f"the capture ${expr['capture']} is not at the top level of its alternative")
            inner = expr.get("expr", {})
            if "ref" in inner:
                symbol = self.symbol(inner["ref"])
            elif "terminal" in inner:
                symbol = ("t", inner["terminal"])
            else:
                raise self.fail(f"the capture ${expr['capture']} does not wrap one symbol")
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

    def add(self, lhs: int, expansion: list[_Sym], alt: Alternative | None, rep_splice: bool = False, elided: str | None = None) -> None:
        rhs = tuple(sym[1] for sym, _ in expansion)
        terminal = tuple(sym[0] == "t" for sym, _ in expansion)
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
            elided=elided,
            captures=captures,
        )
        if alt is not None:
            # $ is a capture every production has (engine §3.6).
            present = captures.keys() | {WHOLE}
            for condition in alt.conditions:
                names = captures_in(condition)
                if not names <= present:
                    continue
                if WHOLE in names and rhs:
                    # Evaluated when the item is complete (engine §4).
                    production.conds_whole.append(condition)
                elif names - {WHOLE}:
                    production.conds_at.setdefault(max(captures[name] for name in names), []).append(condition)
                else:
                    # No capture, or only $ over an empty production: at
                    # prediction.
                    production.conds_predict.append(condition)
            term = alt.tags if alt.tags is not None else alt.rule_tags
            if term is not None and captures_in(term) <= present:
                production.tags_term = term
            production.emit = self.lower_emit(alt.emit, captures)
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

    def lower_emit(self, emit: Dom | None, captures: dict[str, int]) -> Any:
        """A production's emission: ``("erase",)`` for ``⇒ $ <>``,
        ``("whole", [term or None, ...])`` for ``⇒ $``, or ``("items", [...])``
        of ``("capture", position, term or None, erased)`` and
        ``("insert", tag)``, less what names a capture the production lacks
        (engine §3.6, §11)."""
        if emit is None:
            return None
        present = captures.keys() | {WHOLE}

        def own(term: Any) -> Any:
            return term if term is not None and captures_in(term) <= present else None

        items = emit.get("items", [])
        if items and all(item.get("capture") == WHOLE for item in items):
            if items[0].get("erase"):
                return ("erase",)
            return ("whole", [own(item.get("tags")) for item in items])
        lowered: list[tuple[Any, ...]] = []
        for item in items:
            if "capture" in item:
                if item["capture"] in captures:
                    lowered.append(("capture", captures[item["capture"]], own(item.get("tags")), bool(item.get("erase"))))
            elif "insert" in item:
                lowered.append(("insert", item["insert"]))
        return ("items", lowered)

    def check_captures(self, expr: Dom) -> None:
        top = expr["seq"] if "seq" in expr else [expr]
        count = 0
        nested: list[Any] = []
        for item in top:
            if "capture" in item and "expr" in item:
                count += 1
                inner = item["expr"]
                if not isinstance(inner, dict) or not ("ref" in inner or "terminal" in inner):
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
        )

    def holds(self, guards: list[Dom]) -> bool:
        return all((guard["feature"] in self.features) != bool(guard.get("negated")) for guard in guards)


def lower(grammar: Grammar, features: frozenset[str], elision: bool = False) -> Lowered:
    """Lower a stage's grammar for a set of enabled features (engine §3)."""
    return _Lowerer(grammar, features, elision).lower()
