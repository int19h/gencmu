"""Stitching documents into a stage's grammar (engine §2) and lowering it to
productions (engine §3)."""

from __future__ import annotations

import itertools
import json
import threading
from dataclasses import dataclass, field
from typing import Any, Union

from ._clauses import WHOLE, Emission, Prepared, captures_in, definition_problem, deferred_emission_problem, prepare, prepare_conditions, simplify_term
from ._errors import ErrorData, GencmuError
from ._recent import Recent
from ._tags import (
    EMPTY,
    Gathered,
    code_of_character_tag,
    difference,
    intersection,
    is_name,
    property_name,
    range_name,
    range_tags,
    split_string,
    written_test,
)
from ._trampoline import Walk, run
from ._patterns import empty_pattern, walk_pattern
from ._ranked import RankedGroups, reads
from ._types import (
    TermType,
    constant_value_type,
    constants_in,
    expected_problem,
    is_sound_test,
    rule_type_fault,
    term_type_fault,
    tests_in,
    type_name,
)
from ._validate import Lowercase, sound_problem

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
    opaque: bool
    document: str
    at: tuple[int, int]
    ranked_locations: dict = field(default_factory=dict, repr=False, compare=False)


@dataclass
class Rule:
    name: str
    alternatives: list[Alternative]
    document: str
    at: tuple[int, int]
    flags: list[str] = field(default_factory=list)


@dataclass
class FlagChange:
    """The flags before and after a replacement that changes them."""

    from_flags: list[str]
    to_flags: list[str]


@dataclass
class Change:
    """A replacement or extension the loader records (engine §2)."""

    kind: str
    rule: str
    document: str
    previous: str
    flag_change: FlagChange | None = None


@dataclass(frozen=True)
class SymbolTest:
    """A test of a body with its value, from the constants' final values
    (engine §2, §4): its comparator, and the string of a sound test or the
    tag set of a tag test. ``written`` is the test as an expected list
    writes it after its terminal (docs/output.md)."""

    op: str
    sound: str | None
    tags: frozenset[str] | None
    written: str

    def holds(self, sound: str, tags: frozenset[str]) -> bool:
        """Whether the test holds of a span that sounds like ``sound`` and
        a symbol whose own tags are ``tags`` (engine §4)."""
        op = self.op
        if op == "=":
            return sound == self.sound
        if op == "≠":
            return sound != self.sound
        wanted = self.tags if self.tags is not None else EMPTY
        if op == "⊇":
            return wanted <= tags
        if op == "⊉":
            return not wanted <= tags
        if op == "∩=∅":
            return tags.isdisjoint(wanted)
        return not tags.isdisjoint(wanted)


RANKING_RULES = ("greedy", "lazy", "late-elision")
"""The rules of the ranking that ``%ambiguity-resolution`` can name
(engine §2, §6)."""


@dataclass
class Grammar:
    """A stage's stitched grammar and its directives."""

    stage: str
    rules: dict[str, Rule]
    # The rule of the ranking, one of RANKING_RULES (engine §6).
    lean: str
    elision_only: bool
    changes: list[Change] = field(default_factory=list)
    ranked: RankedGroups | None = field(default=None, repr=False, compare=False)
    # The stage's %classifier items in stitching order, each with its
    # document (engine §2).
    classifier_items: list[tuple[str, Dom]] = field(default_factory=list)
    # The stage's implications, each side's tags with the constants' final
    # values (engine §2, §11).
    implications: list[tuple[frozenset[str], frozenset[str]]] = field(default_factory=list)
    # The features that gate an entry of a classifier. Only these change
    # the classifiers.
    classifier_gates: frozenset[str] = field(init=False, repr=False, compare=False)
    # The features that gate an alternative or an entry of a classifier.
    # Only these change a lowered grammar. A warning keeps its alternative
    # (engine §3.1), and any other name matches no guard (engine §13).
    gates: frozenset[str] = field(init=False, repr=False, compare=False)
    # The classifiers resolved for each set of the classifier gates that is
    # on, or the error of their resolution (engine §2).
    _classifier_tables: Recent[frozenset[str], Classifiers | ErrorData] = field(
        default_factory=lambda: Recent(MAX_LOWERED), repr=False, compare=False
    )
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False, compare=False)

    def __post_init__(self) -> None:
        entries = [guard for _, classifier in self.classifier_items for entry in classifier["entries"] for guard in entry["guards"]]
        alternatives = [guard for rule in self.rules.values() for alternative in rule.alternatives for guard in alternative.guards]
        self.classifier_gates = _gate_names(entries)
        self.gates = _gate_names(alternatives + entries)

    def classifiers(self, features: frozenset[str]) -> Classifiers:
        """Each classifier of the stage for one set of features: each key's
        classes after every entry whose gates hold, in stitching order
        (engine §2). An entry that adds a membership that holds, or removes
        one that does not, is an error of the grammar for these features."""
        key = features & self.classifier_gates
        with self._lock:
            found = self._classifier_tables.get(key)
        if found is None:
            try:
                found = _resolve_classifiers(self.classifier_items, key)
            except GencmuError as error:
                error.stage = self.stage
                found = ErrorData.of(error)
            with self._lock:
                self._classifier_tables.put(key, found)
        if isinstance(found, ErrorData):
            raise found.error()
        return found


MAX_LOWERED = 16
"""The most lowered grammars, and the most classifier tables, that a stage
keeps. Each set of the stage's gates that is on has its own, so a stage with
k gates can have 2^k of them. The least recently used goes first."""


def _gate_names(guards: list[Dom]) -> frozenset[str]:
    return frozenset(guard["feature"] for guard in guards if guard.get("kind") != "warning")


Classifiers = dict[str, dict[str, frozenset[str]]]
"""Each classifier of a stage by name, resolved for one set of features:
each key's classes."""


def _resolve_classifiers(items: list[tuple[str, Dom]], features: frozenset[str]) -> Classifiers:
    # Each key's classes grow in one mutable set, frozen at the end, since
    # a frozen set copied at each entry costs a key of C classes C².
    building: dict[str, dict[str, set[str]]] = {}
    for path, classifier in items:
        table = building.setdefault(classifier["name"], {})
        for entry in classifier["entries"]:
            if not all((guard["feature"] in features) != guard["negated"] for guard in entry["guards"]):
                continue
            adds = entry["op"] == "∈"
            name = entry["class"]
            for key in entry["keys"]:
                classes = table.get(key)
                if classes is None:
                    classes = table[key] = set()
                if adds == (name in classes):
                    line, column = int(entry["at"][0]), int(entry["at"][1])
                    word = json.dumps(key, ensure_ascii=False)
                    message = f"{word} is already in {name}" if adds else f"{word} is not in {name}, so ∉ has nothing to remove"
                    # A lowering error is a result's, whose message alone
                    # names the entry (engine §2).
                    raise GencmuError(f"{path}:{line}:{column}: the classifier {classifier['name']}: {message}", document=path, line=line, column=column)
                if adds:
                    classes.add(name)
                else:
                    classes.discard(name)
    return {name: {key: frozenset(classes) for key, classes in table.items()} for name, table in building.items()}


def _error(message: str, document: str, at: Any = None, stage: str | None = None) -> GencmuError:
    line = column = None
    if isinstance(at, (list, tuple)) and len(at) == 2:
        line, column = int(at[0]), int(at[1])
    return GencmuError(message, document=document, line=line, column=column, stage=stage)


@dataclass
class _Constant:
    """A constant of a stage (engine §2): its value and type now, and the
    document of its last definition."""

    value: Any
    type: TermType
    document: str


class _Constants:
    """The final constant graph of a stage (engine §2).

    A reference takes the final definition. A redefinition's own name
    takes its previous definition.
    """

    def __init__(self, stage: str, unicode: Lowercase) -> None:
        self.stage = stage
        self.unicode = unicode
        self.values: dict[str, _Constant] = {}
        self.versions: list[Dom] = []
        self.latest: dict[str, Dom] = {}
        # The definitions of rules that use constants, which the loader
        # checks once the constants have their final values.
        self.users: list[tuple[str, Dom]] = []
        self.deferred_emissions = []

    def type_of(self, name: str) -> TermType:
        return self.values[name].type

    def fault_error(self, path: str, node: Any, item: Any, problem: str) -> GencmuError:
        """The error for a construct whose types disagree, or whose value
        is refused: at its first constant, which the loader alone could
        type, or else at the item (engine §9)."""
        found = constants_in(node)
        return _error(problem, path, found[0]["at"] if found else item, self.stage)

    def add(self, path: str, constant: Dom) -> None:
        name, op, at = constant["name"], constant["op"], constant["at"]
        previous = self.latest.get(name)
        if op == "define" and previous is not None:
            raise _error(f"%const ${name} is already defined in stage {self.stage}, in {previous['path']}; %redefine-const gives it a new value", path, at, self.stage)
        if op == "redefine" and previous is None:
            raise _error(f"%redefine-const ${name} gives a value to no constant defined before it in stage {self.stage}", path, at, self.stage)
        version = {**constant, "path":path, "previous":previous, "state":0}
        self.versions.append(version)
        self.latest[name] = version

    def bind(self) -> None:
        for version in self.versions:
            dependencies = []
            for reference in constants_in(version["value"]):
                name = reference["const"]
                target = version["previous"] if name == version["name"] and version["op"] == "redefine" else self.latest.get(name)
                if target is None:
                    raise _error(f"${name} is not defined in stage {self.stage}; dependency ${version['name']} → ${name}", version["path"], reference["at"], self.stage)
                dependencies.append((target, reference["at"]))
            version["dependencies"] = dependencies
        ordered = []
        for root in self.versions:
            if root["state"] == 2:
                continue
            root["state"] = 1
            stack = [(root, 0)]
            while stack:
                version, index = stack[-1]
                if index < len(version["dependencies"]):
                    target, at = version["dependencies"][index]
                    stack[-1] = (version, index + 1)
                    if target["state"] == 1:
                        cycle = " → ".join(["$" + v["name"] for v, _ in stack] + ["$" + target["name"]])
                        raise _error("constant dependency cycle: " + cycle, version["path"], at, self.stage)
                    if target["state"] == 0:
                        target["state"] = 1
                        stack.append((target, 0))
                    continue
                version["state"] = 2
                ordered.append(version)
                stack.pop()
        kinds: dict[str, str] = {}
        users: dict[str, set[int]] = {}
        for index, version in enumerate(self.versions):
            for name in [version["name"]] + [r["const"] for r in constants_in(version["value"])]:
                users.setdefault(name, set()).add(index)
        queue = list(range(len(self.versions)))
        queued = set(queue)
        index = 0
        while index < len(queue):
            at = queue[index]
            index += 1
            queued.discard(at)
            version = self.versions[at]
            kind, fault = constant_value_type(version["value"], version["op"] == "redefine", lambda name: kinds.get(name, "any"))
            if fault is not None:
                raise self.fault_error(version["path"], fault[1], version["at"], fault[0])
            if kind in ("any", "set"):
                continue
            previous = kinds.get(version["name"])
            if previous is not None and previous != kind:
                raise _error(f"%redefine-const ${version['name']} keeps the type of the constant, and cannot make it {type_name(kind)}", version["path"], version["at"], self.stage)
            if previous is None:
                kinds[version["name"]] = kind
                for user in sorted(users[version["name"]]):
                    if user not in queued:
                        queued.add(user)
                        queue.append(user)
        for version in ordered:
            kind = kinds.get(version["name"])
            if kind is None:
                raise _error(f"the kind of the value of ${version['name']} is not given", version["path"], version["at"], self.stage)
            self.values = {}
            for reference, (target, _) in zip(constants_in(version["value"]), version["dependencies"]):
                self.values[reference["const"]] = target["result"]
            value = run(self._closed(version["path"], version["value"], version["at"], kind))
            version["result"] = _Constant(value, kind, version["path"])
        self.values = {name:version["result"] for name, version in self.latest.items()}

    def _is_pattern(self, term: Dom) -> bool:
        stack = [term]
        while stack:
            node = stack.pop()
            if "pattern" in node:
                return True
            if "const" in node:
                if self.values[node["const"]].type == "pattern":
                    return True
            else:
                for key in ("union", "intersection", "difference"):
                    if key in node:
                        stack.extend(node[key])
        return False

    def _closed_pattern(self, path: str, root: Dom, at: Any) -> Walk:
        if "constant" in root:
            return self.values[root["constant"]].value["pattern"]
        result = dict(root)
        for key in ("union", "intersection", "difference", "sequence"):
            if key in root:
                result[key] = []
                for child in root[key]:
                    result[key].append((yield self._closed_pattern(path, child, at)))
        for key in ("pattern", "children", "node", "optional", "repeat", "separator"):
            if key in root:
                result[key] = yield self._closed_pattern(path, root[key], at)
        if "test" in root:
            value = yield self._closed(path, root["value"], at)
            if is_sound_test(root["test"]):
                problem = sound_problem(value, self.unicode)
                if problem is not None:
                    raise self.fault_error(path, root["value"], at, problem)
            result["value"] = {"string":value} if isinstance(value, str) else {"set":value}
        return result

    def _closed(self, path: str, term: Dom, item: Any, expected: str = "any") -> Walk:
        """The value of a closed term, with the constants' values now
        (engine §2, §10). An empty delimiter or a tag's string that is not a
        name comes from a constant here, since the reader refuses a literal
        one, and the error stands at that constant."""
        if "pattern" in term:
            return {"pattern":(yield self._closed_pattern(path, term["pattern"], item))}
        if (expected == "pattern" or self._is_pattern(term)) and any(key in term for key in ("union", "intersection", "difference")):
            key = next(key for key in ("union", "intersection", "difference") if key in term)
            patterns = []
            for part in term[key]:
                value = yield self._closed(path, part, item, "pattern")
                patterns.append(value["pattern"] if isinstance(value, dict) else empty_pattern())
            return {"pattern":{key:patterns}}
        if "string" in term:
            return term["string"]
        if "tag" in term:
            return frozenset((term["tag"],))
        if "range" in term:
            return range_tags(term["range"], self.unicode)
        if "emptySet" in term:
            return {"pattern":empty_pattern()} if expected == "pattern" else EMPTY
        if "const" in term:
            return self.values[term["const"]].value
        if "union" in term:
            gathered = Gathered()
            for part in term["union"]:
                gathered.add(_set((yield self._closed(path, part, item))))
            return gathered.value()
        if "intersection" in term:
            parts = term["intersection"]
            result = _set((yield self._closed(path, parts[0], item)))
            for part in parts[1:]:
                result = intersection(result, _set((yield self._closed(path, part, item))))
            return result
        if "difference" in term:
            left = _set((yield self._closed(path, term["difference"][0], item)))
            return difference(left, _set((yield self._closed(path, term["difference"][1], item))))
        if term.get("call") == "split":
            # Left to right, as a parse evaluates a term (engine §10).
            text, delimiter = term["args"]
            pieces = _string((yield self._closed(path, text, item)))
            seen = _string((yield self._closed(path, delimiter, item)))
            if seen == "":
                raise self.fault_error(path, delimiter, item, "split has an empty delimiter")
            return split_string(pieces, seen)
        if term.get("call") == "tag":
            name = _string((yield self._closed(path, term["args"][0], item)))
            if not is_name(name):
                raise self.fault_error(path, term["args"][0], item, f"tag({json.dumps(name, ensure_ascii=False)}): the string is not a name")
            return frozenset((name,))
        raise _error("a constant's value is not a closed term", path, item, self.stage)

    def implication(self, path: str, implication: Dom) -> tuple[frozenset[str], frozenset[str]]:
        """An implication's two sides, with the constants' final values:
        closed terms whose type is a tag set (engine §2, §9)."""
        sides: list[frozenset[str]] = []
        for side in (implication["if"], implication["then"]):
            for reference in constants_in(side):
                if reference["const"] not in self.values:
                    raise _error(f"${reference['const']} is not defined in stage {self.stage}", path, reference["at"], self.stage)
            kind, fault = term_type_fault(side, self.type_of)
            if fault is None:
                problem = expected_problem(kind, "tags")  # type: ignore[arg-type]
                if problem is not None:
                    fault = (problem, side)
            if fault is not None:
                raise self.fault_error(path, fault[1], implication["at"], f"a side of an implication is a tag set: {fault[0]}")
            sides.append(_set(run(self._closed(path, side, implication["at"]))))
        return sides[0], sides[1]

    def check(self) -> None:
        """Checks what the reader could not in each rule that uses a
        constant: that each is defined, that the types agree, and that a
        constant that split or tag reads directly is a delimiter that is
        not empty, or a name (engine §2, §9, §10)."""
        for path, rule in self.users:
            for reference in constants_in(rule):
                if reference["const"] not in self.values:
                    raise _error(f"${reference['const']} is not defined in stage {self.stage}", path, reference["at"], self.stage)
            fault = rule_type_fault(rule, self.type_of)
            if fault is not None:
                raise self.fault_error(path, fault[1], rule["at"], fault[0])
            pending = [rule]
            while pending:
                node = pending.pop()
                if isinstance(node, list):
                    pending.extend(node)
                elif isinstance(node, dict):
                    if "pattern" in node:
                        run(self._closed(path, node, rule["at"]))
                    else:
                        pending.extend(node.values())
            # The checks that simplification decides, which the reader left
            # to the loader, now with the constants' values (engine §9).
            problem = definition_problem(run(self.with_values(rule)))
            if problem is not None:
                if deferred_emission_problem(problem):
                    self.deferred_emissions.append(_error(problem,path,rule["at"],self.stage))
                else:
                    raise _error(problem, path, rule["at"], self.stage)
            # A string constant in a sound test must be a canonical sound
            # (engine §2, §9); the error stands at the constant.
            for alternative in rule["alternatives"]:
                for test in tests_in(alternative["expr"]):
                    found = constants_in(test["value"])
                    if not is_sound_test(test["test"]) or not found:
                        continue
                    value = run(self._closed(path, test["value"], rule["at"]))
                    wrong = sound_problem(value if isinstance(value, str) else "", self.unicode)
                    if wrong is not None:
                        raise _error(wrong, path, found[0]["at"], self.stage)
            for call in _calls_in(rule):
                argument = call["args"][1] if call["call"] == "split" else call["args"][0]
                if not isinstance(argument, dict) or "const" not in argument:
                    continue
                value = self.values[argument["const"]].value
                seen = value if isinstance(value, str) else ""
                if call["call"] == "split" and seen == "":
                    raise _error("split has an empty delimiter", path, argument["at"], self.stage)
                if call["call"] == "tag" and not is_name(seen):
                    raise _error(
                        f"tag({json.dumps(seen, ensure_ascii=False)}): the string is not a name", path, argument["at"], self.stage
                    )

    def test(self, path: str, test: Dom, at: Any) -> SymbolTest:
        """A test of a body with its value, from the constants' final
        values (engine §2, §4)."""
        value = run(self._closed(path, test["value"], at))
        written = written_test(test["test"], value)
        if isinstance(value, str):
            return SymbolTest(test["test"], value, None, written)
        return SymbolTest(test["test"], None, _set(value), written)

    def with_values(self, node: Any) -> Walk:
        """A copy of a DOM node in which each reference to a constant holds
        the constant's value now."""
        if isinstance(node, list):
            items: list[Any] = []
            for item in node:
                items.append((yield self.with_values(item)))
            return items
        if not isinstance(node, dict):
            return node
        if "pattern" in node or self._is_pattern(node) and any(key in node for key in ("union", "intersection", "difference")):
            return (yield self._closed("", node, None))
        if isinstance(node.get("const"), str):
            constant = self.values[node["const"]]
            return constant.value if constant.type == "pattern" else {"const": node["const"], "at": node["at"], "value": constant.value}
        if node.get("op") in ("≅", "≇"):
            return {**node, "right":(yield self._closed("", node["right"], None, "pattern"))}
        copy: dict[str, Any] = {}
        for key, value in node.items():
            copy[key] = yield self.with_values(value)
        return copy

    def resolve(self, rules: dict[str, Rule]) -> None:
        """Gives every reference to a constant in the stitched rules its
        final value, in copies of the clauses: the documents' DOMs are
        shared by every stage and dialect that includes them. Clauses that
        alternatives share stay shared."""
        # Each node's copy, or the node itself where it holds no constant,
        # by identity: the rule-level clauses that alternatives share are
        # walked once, not once for each alternative.
        copies: dict[int, Any] = {}

        # The walk resolves nested clauses without adding a call frame at
        # each level. It also works when the caller lowers the stack limit.
        def resolve(node: Any) -> Walk:
            if not isinstance(node, (dict, list)):
                return node
            done = copies.get(id(node))
            if done is not None:
                return done
            copy: Any
            if isinstance(node, list):
                items: list[Any] = []
                for item in node:
                    items.append((yield resolve(item)))
                copy = node if all(item is old for item, old in zip(items, node)) else items
            elif "pattern" in node or self._is_pattern(node) and any(key in node for key in ("union", "intersection", "difference")):
                copy = yield self._closed("", node, None)
            elif isinstance(node.get("const"), str):
                constant = self.values[node["const"]]
                copy = constant.value if constant.type == "pattern" else {"const": node["const"], "at": node["at"], "value": constant.value}
            elif node.get("op") in ("≅", "≇"):
                copy = {**node, "right":(yield self._closed("", node["right"], None, "pattern"))}
            else:
                values: dict[str, Any] = {}
                for key, value in node.items():
                    values[key] = yield resolve(value)
                copy = node if all(values[key] is value for key, value in node.items()) else values
            copies[id(node)] = copy
            return copy

        for rule in rules.values():
            for alternative in rule.alternatives:
                alternative.tags = run(resolve(alternative.tags))
                alternative.rule_tags = run(resolve(alternative.rule_tags))
                alternative.emit = run(resolve(alternative.emit))
                alternative.conditions = run(resolve(alternative.conditions))


def _set(value: Any) -> Any:
    return value if isinstance(value, frozenset) else EMPTY


def _string(value: Any) -> str:
    return value if isinstance(value, str) else ""


def _calls_in(node: Any) -> list[Dom]:
    """The calls of split and tag in a rule's clauses."""
    found: list[Dom] = []
    stack: list[Any] = [node]
    while stack:
        current = stack.pop()
        if isinstance(current, list):
            stack.extend(reversed(current))
        elif isinstance(current, dict):
            if current.get("call") in ("split", "tag") and isinstance(current.get("args"), list):
                found.append(current)
            stack.extend(reversed(list(current.values())))
    return found


def stitch(stage: str, documents: list[tuple[str, Dom]], unicode: Lowercase) -> Grammar:
    """Stitch a stage's documents, in order, into one grammar. ``unicode``
    is the loader's table, for the tags of a range in a constant's value and
    the canonical sound of a string constant in a test."""
    rules: dict[str, Rule] = {}
    constants = _Constants(stage, unicode)
    changes: list[Change] = []
    resolutions: list[tuple[list[str], str, Any]] = []
    classifier_items: list[tuple[str, Dom]] = []
    implication_items: list[tuple[str, Dom]] = []
    for path, dom in documents:
        for rule,message in getattr(dom,"deferred_emissions",()):
            if not constants_in(rule) and not _rule_has_pattern(rule):
                constants.deferred_emissions.append(_error(message,path,rule["at"],stage))
        for rule in dom.get("rules", []):
            if constants_in(rule) or _rule_has_pattern(rule):
                constants.users.append((path, rule))
            name = rule["name"]
            at: tuple[int, int] = (int(rule.get("at", (0, 0))[0]), int(rule.get("at", (0, 0))[1]))
            # One list that the alternatives share, as they share the other
            # rule-level clauses, so that walks of it can skip it once seen.
            conditions = list(rule.get("conditions", []))
            alternatives = [
                Alternative(
                    guards=list(alt.get("guards", [])),
                    expr=alt["expr"],
                    tags=alt.get("tags"),
                    rule_tags=rule.get("tags"),
                    emit=rule.get("emit"),
                    conditions=conditions,
                    opaque=rule.get("opaque") is True,
                    document=path,
                    at=at,
                    ranked_locations=getattr(rule,"ranked_locations",{}).get(alternative_index,{}),
                )
                for alternative_index,alt in enumerate(rule.get("alternatives", []))
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
                flags = list(rule["flags"])
                flag_change = FlagChange(previous.flags.copy(), flags.copy()) if previous.flags != flags else None
                changes.append(Change("replace", name, path, previous.document, flag_change))
                # The rule keeps its place (engine §3, "Numbering").
                rules[name] = Rule(name, alternatives, path, at, list(rule["flags"]))
            else:
                if previous is not None:
                    raise _error(
                        f"%rule {name} is already defined, in {previous.document}; %redefine-rule replaces a rule",
                        path,
                        at,
                        stage,
                    )
                rules[name] = Rule(name, alternatives, path, at, list(rule["flags"]))
        for directive in dom.get("directives", []):
            name = directive["name"]
            args = list(directive.get("args", []))
            at = directive.get("at")
            if name == "ambiguity-resolution":
                resolutions.append((args, path, at))
            else:
                raise _error(f"an unknown directive %{name}", path, at, stage)
        for constant in dom.get("constants", []):
            constants.add(path, constant)
        classifier_items.extend((path, classifier) for classifier in dom.get("classifiers", []))
        implication_items.extend((path, implication) for implication in dom.get("implications", []))
    constants.bind()
    constants.check()
    constants.resolve(rules)
    _resolve_tests(rules, constants)
    implications = [constants.implication(path, implication) for path, implication in implication_items]
    if not resolutions:
        raise GencmuError(f"stage {stage} has no %ambiguity-resolution", stage=stage)
    if len(resolutions) > 1:
        args, path, at = resolutions[1]
        raise _error(f"stage {stage} has more than one %ambiguity-resolution", path, at, stage)
    args, path, at = resolutions[0]
    # The rule of the ranking (engine §6), then optionally elision-only,
    # each optional, in that order (engine §2).
    rest = args[1:]
    elision_only = rest[:1] == ["elision-only"]
    if elision_only:
        rest = rest[1:]
    if not args or args[0] not in RANKING_RULES or rest:
        raise _error(
            "%ambiguity-resolution takes greedy, lazy or late-elision, then optionally elision-only",
            path,
            at,
            stage,
        )
    if "text" not in rules:
        raise GencmuError(f"stage {stage} has no rule text, its start rule", stage=stage)
    classifier_names = {classifier["name"] for _, classifier in classifier_items}
    # The clauses of a rule that its alternatives share, by identity, once
    # checked: an error in one would have stopped the first check, at the
    # same document and place.
    checked: set[int] = set()

    def unchecked(clause: Any) -> Any:
        if clause is None or id(clause) in checked:
            return None
        checked.add(id(clause))
        return clause

    for rule in rules.values():
        for alt in rule.alternatives:
            stack: list[Any] = [alt.expr, alt.tags, unchecked(alt.rule_tags), unchecked(alt.emit), unchecked(alt.conditions)]
            while stack:
                value = stack.pop()
                if isinstance(value, dict):
                    ref = value.get("ref")
                    if isinstance(ref, str) and not is_terminal_name(ref) and ref not in rules:
                        raise _error(f"{ref} is not a rule of stage {stage}", alt.document, alt.at, stage)
                    if isinstance(value.get("rule"), str) and value["rule"] not in rules:
                        raise _error(f"{value['rule']} is not a rule of stage {stage}", alt.document, alt.at, stage)
                    # A classifier that classify names belongs to the stage
                    # (engine §2).
                    named = value.get("classifier")
                    if isinstance(named, str) and named not in classifier_names:
                        raise _error(
                            f"{rule.name} classifies with {named}, which no %classifier of stage {stage} names",
                            alt.document,
                            alt.at,
                            stage,
                        )
                    stack.extend(value.values())
                elif isinstance(value, list):
                    stack.extend(value)
    grammar = Grammar(
        stage,
        rules,
        args[0],
        elision_only,
        changes,
        classifier_items=classifier_items,
        implications=implications,
    )

    grammar.ranked = RankedGroups(stage, rules)
    if grammar.ranked.groups:
        lowered = _Lowerer(grammar,frozenset(),True).lower()
        grammar.ranked.validate_tags(lowered)
    if constants.deferred_emissions:
        raise constants.deferred_emissions[0]
    return grammar


RESOLVED = "resolved"
"""The member of a tested symbol, in a stitched grammar's copy of an
expression, that holds its test with its value (engine §2, §4)."""


def _resolve_tests(rules: dict[str, Rule], constants: _Constants) -> None:
    """Gives every test of a body in the stitched rules its value, from the
    constants' final values, made once for every lowering. The documents'
    DOMs are shared by every stage and dialect that includes them, so the
    tests go into copies of the expressions that hold them."""
    copies: dict[int, Any] = {}
    # Whether each node holds a test, by identity, found once: a walk of a
    # node's whole subtree at each level of its nesting would cost a deep
    # expression its depth times its size.
    tested: dict[int, bool] = {}

    # An explicit stack keeps expression depth independent of the
    # caller's recursion limit.
    def holds_test(node: Any) -> Walk:
        if not isinstance(node, dict):
            return False
        found = tested.get(id(node))
        if found is None:
            found = isinstance(node.get("test"), str)
            for key, child in node.items():
                if key in ("choice", "ranked", "and", "seq") and isinstance(child, list):
                    for item in child:
                        found = (yield holds_test(item)) or found
                elif key in ("expr", "separator", "repeat", "optional"):
                    found = (yield holds_test(child)) or found
            tested[id(node)] = found
        return found

    def resolve(node: Any, alt: Alternative) -> Walk:
        if not isinstance(node, dict) or not (yield holds_test(node)):
            return node
        done = copies.get(id(node))
        if done is not None:
            return done
        copy: dict[str, Any] = {}
        for key, value in node.items():
            if isinstance(value, list):
                items: list[Any] = []
                for item in value:
                    items.append((yield resolve(item, alt)))
                copy[key] = items
            elif key in ("optional", "repeat", "separator", "expr"):
                copy[key] = yield resolve(value, alt)
            else:
                copy[key] = value
        if isinstance(node.get("test"), str):
            copy[RESOLVED] = constants.test(alt.document, node, alt.at)
        copies[id(node)] = copy
        return copy

    for rule in rules.values():
        for alt in rule.alternatives:
            alt.expr = run(resolve(alt.expr, alt))


# ---------------------------------------------------------------------------
# Lowering


@dataclass
class SlotMetadata:
    source: Alternative
    path: int | None = None
    tags: list[Dom] = field(default_factory=list)
    tag_clauses: tuple[Dom | None, Dom | None] = (None, None)


@dataclass
class Production:
    """A production of the lowered grammar."""

    id: int
    lhs: int
    rhs: tuple[Union[str, int], ...]
    terminal: tuple[bool, ...]
    rule_name: str
    helper: bool
    leftmost_longest: bool = False
    elided: str | None = None
    # The test of that terminator, if it is tested; a restored token
    # sounds like the string of its = test (engine §7).
    elided_test: SymbolTest | None = None
    # The test of each symbol, which reads its own span and its own tags,
    # or None for a symbol without one (engine §4); None when no symbol has
    # one. The test is not part of the symbol's identity.
    tests: tuple[SymbolTest | None, ...] | None = None
    captures: dict[str, int] = field(default_factory=dict)
    slots: tuple[int, ...] = ()
    conds_predict: list[Dom] = field(default_factory=list)
    conds_at: dict[int, list[Dom]] = field(default_factory=dict)
    # Whether a condition at the last symbol reads ``$``, which then has the
    # constituent's tags (engine §4).
    whole_ready: bool = False
    tags_term: Dom | None = None
    emit: Any = None
    # Whether its constituent is an opaque part, which sounds ``?`` and
    # shows its text (engine §11). It is false for a helper.
    opaque: bool = False
    # The features of the alternative's warnings, in the order they are
    # written (engine §12); none for a helper.
    warnings: tuple[str, ...] = ()
    slot: SlotMetadata | None = field(default=None,repr=False,compare=False)
    base_id: int | None = field(default=None,repr=False,compare=False)
    lexical: Any = field(default=None,repr=False,compare=False)
    ranked: Any = field(default=None,repr=False,compare=False)
    option: int = -1
    contextual: bool = False
    private_conditions: list = field(default_factory=list,repr=False,compare=False)
    parent_tags: Any = field(default=None,repr=False,compare=False)

    @property
    def real_id(self):
        return self.id if self.base_id is None else self.base_id

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
    # The stage's classifiers for the same features, and its implications
    # (engine §2, §11).
    classifiers: Classifiers = field(default_factory=dict)
    implications: list[tuple[frozenset[str], frozenset[str]]] = field(default_factory=list)
    # The helpers of the elidable optionals, by rule number (engine §3.8):
    # the rules of the productions whose empty alternative is an elided
    # terminator.
    elidable_helpers: frozenset[int] = frozenset()
    # The helpers of the optionals written [++T x], whose terminators are
    # maximal (engine §3.8, §4).
    maximal_helpers: frozenset[int] = frozenset()
    # For each production, the index of its last symbol that can read in
    # the reconstruction mode of engine §7.4, or -1; found when the check
    # first needs it.
    reading_last: list[int] | None = None
    # For each tag, the implications whose premise holds it, by their
    # place in ``implications``; made when emission first needs it.
    implications_by_tag: dict[str, list[int]] | None = None

    ranked_helpers: dict = field(default_factory=dict)
    written_helpers: dict = field(default_factory=dict)

    def implication_index(self) -> dict[str, list[int]]:
        index = self.implications_by_tag
        if index is None:
            # Built whole before it is kept, since a lowered grammar can be
            # shared by parses on other threads.
            index = {}
            for number, (premise, _) in enumerate(self.implications):
                for tag in premise:
                    index.setdefault(tag, []).append(number)
            self.implications_by_tag = index
        return index

    def __post_init__(self) -> None:
        self.elidable_helpers = frozenset(
            production.lhs for production in self.productions if production.helper and production.elided is not None
        )
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
# element, its test, for a tested symbol; and its capture.
_Sym = tuple[tuple[Any, ...], Union[str, None]]


def written_symbol(name: str, test: SymbolTest | None) -> str:
    """A terminal as the diagnostics write it: its name, followed by its
    test if it has one, such as LE="la" (docs/output.md)."""
    return name if test is None else f"{name}{test.written}"


class _Lowerer:
    def __init__(self, grammar: Grammar, features: frozenset[str], validation: bool = False) -> None:
        self.grammar = grammar
        self.validation = validation
        self.current_expr = None
        self.helper_sources = {}
        self.helper_options = {}
        self.common_conditions = {}
        if grammar.ranked and grammar.ranked.groups:
            self._expand_plain = self._expand
            self._expand = self._expand_slot
        self.features = features
        self.rule_names: list[str] = list(grammar.rules)
        self.rule_ids = {name: index for index, name in enumerate(self.rule_names)}
        self.rule_display: list[str] = list(self.rule_names)
        self.helper_expansions: dict[int, list[list[_Sym]]] = {}
        self.helper_elided: dict[int, tuple[str, SymbolTest | None]] = {}
        self.emitted_helpers: set[int] = set()
        self.productions: list[Production] = []
        self.current: Rule | None = None
        self.current_alt: Alternative | None = None
        self.characters: dict[str, CharacterClass] = {}
        # The helpers of the optionals written [++T x], whose terminators
        # are maximal (engine §3.8, §4).
        self.maximal_helpers: set[int] = set()
        # The structural grammar (engine §3.3): every production that the
        # gates and the expansion make, before a false condition removes
        # any, as its left side and its symbols, with their tests ignored.
        self.structural: list[tuple[int, tuple[Union[str, int], ...], tuple[bool, ...]]] = []
        # The item of each pair of braces, as its expansions, with the
        # definition that wrote it, in the order lowering meets them.
        self.brace_items: list[tuple[list[list[_Sym]], Alternative | None, Rule | None]] = []
        # Each clause prepared once for all the productions that share it,
        # by its identity, with the clause kept so that the identity stays
        # its own.
        self.prepared: dict[int, tuple[Any, Any]] = {}

    def emission(self, emit: Dom | None) -> Emission | None:
        """An emission's items indexed once for all the productions that
        share it."""
        if emit is None:
            return None
        known = self.prepared.get(id(emit))
        if known is None:
            known = self.prepared[id(emit)] = (emit, Emission(emit.get("items", [])))
        return known[1]  # type: ignore[return-value]

    def prepare(self, clause: Any, condition: bool) -> Prepared:
        known = self.prepared.get(id(clause))
        if known is None:
            known = self.prepared[id(clause)] = (clause, prepare_conditions(clause) if condition else prepare(clause, False))
        return known[1]

    def fail(self, message: str, alt: Alternative | None = None, rule: Rule | None = None) -> GencmuError:
        """An error of the grammar that lowering finds (engine §3). A parse
        reports it as a result, whose error has no position of its own
        (docs/output.md), so the message begins with the document, line and
        column of the definition that wrote the alternative at fault."""
        rule = rule or self.current
        alt = alt or self.current_alt
        document = alt.document if alt else (rule.document if rule else "")
        at = alt.at if alt else (rule.at if rule else None)
        place = f"{document}:{at[0]}:{at[1]}" if at is not None else document
        return GencmuError(f"{place}: {message}", document=document or None, line=at[0] if at else None, column=at[1] if at else None, stage=self.grammar.stage)

    # -- expansions

    def new_helper(self, expansions: list[list[_Sym]], elided: tuple[str, SymbolTest | None] | None = None) -> int:
        number = len(self.rule_names)
        owner = self.current.name if self.current else "?"
        self.rule_names.append(f"\u0000{owner}\u0000{number}")
        self.rule_display.append(owner)
        self.helper_expansions[number] = expansions
        if self.grammar.ranked and self.grammar.ranked.groups:
            self.helper_sources[number] = (self.current_alt,id(self.current_expr))
        if elided is not None:
            self.helper_elided[number] = elided
        return number

    def elided_terminal(self, expr: Dom) -> tuple[str, SymbolTest | None]:
        """The terminal of an elidable optional, the first item of its
        content, and its ``=`` test, if any (engine §3.8, §12)."""
        first = expr["seq"][0] if "seq" in expr and expr["seq"] else expr
        test: SymbolTest | None = first[RESOLVED] if "test" in first else None
        symbol = first["expr"] if "test" in first else first
        name = symbol.get("terminal")
        if name is None and is_terminal_name(symbol.get("ref", "")):
            name = symbol["ref"]
        if not isinstance(name, str):
            raise self.fail(f"an elidable optional in {self.current.name if self.current else '?'} does not begin with its terminator")
        return (name, test)

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

    def expand(self, expr: Dom) -> list[list[_Sym]]:
        """An expression's expansions (engine §3.2), without recursion."""
        return run(self._expand(expr))  # type: ignore[no-any-return]

    def _expand_slot(self, expr: Dom) -> Walk:
        previous = self.current_expr
        self.current_expr = expr
        try:
            return (yield self._expand_plain(expr))
        finally:
            self.current_expr = previous

    def _expand(self, expr: Dom) -> Walk:
        if "seq" in expr:
            parts = []
            for item in expr["seq"]:
                parts.append((yield self._expand(item)))
            return [[sym for part in combination for sym in part] for combination in itertools.product(*parts)]
        if "ranked" in expr:
            options, labels = [], []
            for number, option in enumerate(expr["ranked"]):
                expanded = yield self._expand(option)
                options.extend(expanded)
                labels.extend([number] * len(expanded))
            helper = self.new_helper(options)
            self.helper_options[helper] = labels
            return [[(("n", helper), None)]]
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
            elidable = expr.get("elidable") is True
            body = yield self._expand(inner)
            # A plain optional that holds a capture expands in place, as
            # (ε | x) would: first the empty sequence, then each expansion
            # of x (engine §3.2).
            if not elidable and _holds_capture(inner):
                return [[], *body]
            # Any other optional is a helper, and a marked one is elidable,
            # with the terminal that its marker names; ++ makes it maximal
            # (engine §3.8).
            helper = self.new_helper([[]] + body, self.elided_terminal(inner) if elidable else None)
            if expr.get("maximal") is True:
                self.maximal_helpers.add(helper)
            return [[(("n", helper), None)]]
        if "repeat" in expr:
            # Flat braces are a helper, h → x | h s x, its base productions
            # first; the places inside the item come before those inside the
            # separator (engine §3.2).
            if "chain" in expr:
                raise self.fail(f"a chain in {self.current.name if self.current else '?'} is not the whole of its rule")
            items = yield self._expand(expr["repeat"])
            self.brace_items.append((items, self.current_alt, self.current))
            separators = (yield self._expand(expr["separator"])) if "separator" in expr else [[]]
            return [[(("n", self.repeat_helper(items, separators)), None)]]
        if "empty" in expr:
            return [[]]
        if "ref" in expr:
            return [[(self.symbol(expr["ref"]), None)]]
        if "terminal" in expr:
            return [[(("t", expr["terminal"]), None)]]
        if "range" in expr or "property" in expr:
            return [[(self.character_class(expr), None)]]
        if "test" in expr:
            # A tested symbol lowers to its symbol with the test, and adds
            # no helper (engine §3).
            tested = yield self._expand(expr["expr"])
            kind, name = tested[0][0][0][:2]
            return [[((kind, name, expr[RESOLVED]), None)]]
        if "capture" in expr:
            inner = expr.get("expr", {})
            test = inner[RESOLVED] if "test" in inner else None
            if test is not None:
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
            if test is not None:
                symbol = (symbol[0], symbol[1], test)
            return [[(symbol, expr["capture"])]]
        raise self.fail(f"an unknown expression {sorted(expr)}")

    def repeat_helper(self, items: list[list[_Sym]], separators: list[list[_Sym]]) -> int:
        number = len(self.rule_names)
        recursive: list[list[_Sym]] = [[(("n", number), None)] + separator + item for separator in separators for item in items]
        helper = self.new_helper(items + recursive)
        assert helper == number
        return helper

    # -- productions

    def ranked_common(self, expansion, alt):
        ranked = self.grammar.ranked
        if ranked is None or not ranked.groups:
            return alt.conditions
        names, seen = set(), set()
        pending = [sym[1] for sym, _ in expansion if sym[0] == 'n']
        while pending:
            rule = pending.pop()
            if rule in seen or rule not in self.helper_expansions:
                continue
            seen.add(rule)
            source, path = self.helper_sources[rule]
            group = ranked.expressions.get(path)
            if group is not None:
                names.update(reads(group.expr))
            pending.extend(sym[1] for body in self.helper_expansions[rule] for sym, _ in body if sym[0] == 'n')
        if not names:
            return alt.conditions
        key = (id(alt), frozenset(names))
        if key not in self.common_conditions:
            self.common_conditions[key] = [c for c in alt.conditions if reads(c).isdisjoint(names)]
        return self.common_conditions[key]

    def add(self, lhs: int, expansion: list[_Sym], alt: Alternative | None, elided: tuple[str, SymbolTest | None] | None = None, option: int = -1) -> None:
        rhs = tuple(sym[1] for sym, _ in expansion)
        terminal = tuple(sym[0] == "t" for sym, _ in expansion)
        self.structural.append((lhs, rhs, terminal))
        tests = tuple(sym[2] if len(sym) > 2 else None for sym, _ in expansion)
        # A production reads each name at most once (engine §3.5); the
        # reader and the check of a DOM have made sure of it.
        captures: dict[str, int] = {}
        for position, (_, name) in enumerate(expansion):
            if name is not None:
                captures[name] = position
        production = Production(
            id=len(self.productions),
            lhs=lhs,
            rhs=rhs,
            terminal=terminal,
            rule_name=self.rule_display[lhs],
            helper=alt is None,
            leftmost_longest=alt is not None and "leftmost-longest" in self.grammar.rules[self.rule_names[lhs]].flags,
            elided=elided[0] if elided is not None else None,
            elided_test=elided[1] if elided is not None else None,
            tests=tests if any(test is not None for test in tests) else None,
            captures=captures,
        )
        if self.grammar.ranked and self.grammar.ranked.groups:
            source,path = (alt,None) if alt is not None else self.helper_sources[lhs]
            production.slot = SlotMetadata(source,path)
            if alt is None:
                production.ranked = self.grammar.ranked.expressions.get(path)
                production.option = option
        if alt is not None:
            # $ is a capture every production has, and each clause is
            # simplified for the captures this one has (engine §3.6).
            present = captures.keys() | {WHOLE}
            # The conditions not true for this production, in order, each
            # prepared once for all productions, so that one costs its own
            # captures and output, not every part of the conditions.
            for condition in self.prepare(self.ranked_common(expansion, alt), True).kept(present):
                if condition is False:
                    if self.validation:
                        continue
                    return
                names = captures_in(condition)
                if not names <= present:
                    # A condition that uses a capture this production lacks
                    # does not apply to it.
                    continue
                if WHOLE in names and rhs:
                    # Evaluated when the item is complete, in written order
                    # with the conditions on captures that become ready at
                    # the same advance (engine §4).
                    production.conds_at.setdefault(len(rhs) - 1, []).append(condition)
                    production.whole_ready = True
                elif names - {WHOLE}:
                    production.conds_at.setdefault(max(captures[name] for name in names), []).append(condition)
                else:
                    # No capture, or only $ over an empty production: at
                    # prediction.
                    production.conds_predict.append(condition)
            # The union of the alternative's own tags and the definition's
            # (engine §3.7); the reader has made sure neither uses a capture
            # the alternative lacks.
            if self.validation:
                tag_clauses = tuple(None if clause is None else self.prepare(clause, False).simplified(present) for clause in (alt.tags, alt.rule_tags))
                terms = [term for term in tag_clauses if term is not None]
                production.slot.tags = terms
                production.slot.tag_clauses = tag_clauses
            else:
                terms = [self.prepare(term, False).simplified(present) for term in (alt.tags, alt.rule_tags) if term is not None]
            if terms:
                production.tags_term = terms[0] if len(terms) == 1 else {"union": terms}
            production.emit = self.lower_emit(alt.emit, captures, self.emission(alt.emit))
            production.opaque = alt.opaque
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
            for index, expansion in enumerate(own):
                self.add(number, expansion, None, elided=elided if not expansion else None, option=self.helper_options[number][index] if number in self.helper_options else -1)
            stack.extend(reversed(used(own)))

    def lower_emit(self, emit: Dom | None, captures: dict[str, int], emission: Emission | None = None) -> list[tuple[Any, ...]] | None:
        """A production's emission, the items it emits in list order, less
        those whose carrier the production lacks, and each item less the
        attachment captures it lacks (engine §3.6, §11): ``("whole", term
        or None)`` for ``$``, ``("capture", position, term or None,
        before, after)``, with the positions of the attachment captures
        before it and after it, and ``("insert", tag, anchor)``, the anchor
        being the position of the first written part of the capture item
        listed next after it, its first before-attachment or else its
        carrier, or ``None`` for the constituent's end. ``%emits ε`` is the
        empty list. ``emission`` is the emission's items indexed, which
        the productions that share it share."""
        if emit is None:
            return None
        present = captures.keys() | {WHOLE}
        if emission is None:
            emission = Emission(emit.get("items", []))

        def own(term: Any) -> Any:
            return simplify_term(term, present) if term is not None else None

        def positions(names: Any) -> tuple[int, ...]:
            return tuple(captures[name] for name in names or () if name in captures)

        # The items this production keeps, found by their carriers, not by
        # a scan of every item.
        items = [emission.items[index] for index in emission.kept(present)]
        # Built from the last item back, so that each inserted tag's anchor
        # comes from the capture item last passed, found once for all the
        # tags before it.
        lowered: list[tuple[Any, ...]] = []
        following: Dom | None = None
        anchor: int | None = None
        anchored = True
        for item in reversed(items):
            if "insert" in item:
                if not anchored:
                    assert following is not None
                    first = positions(following.get("before"))
                    anchor = first[0] if first else captures[following["capture"]]
                    anchored = True
                lowered.append(("insert", item["insert"], anchor))
                continue
            following, anchor, anchored = item, None, False
            if item["capture"] == WHOLE:
                lowered.append(("whole", own(item.get("tags"))))
            else:
                lowered.append(
                    ("capture", captures[item["capture"]], own(item.get("tags")), positions(item.get("before")), positions(item.get("after")))
                )
        lowered.reverse()
        return lowered

    def lower(self) -> Lowered:
        for name, rule in self.grammar.rules.items():
            self.current = rule
            lhs = self.rule_ids[name]
            alternatives = [alt for alt in rule.alternatives if self.holds(alt.guards)]
            # A chain is the only alternative of its rule that the gates
            # leave (engine §3.3); a %extend-rule can add another.
            chain = next((alt for alt in alternatives if "repeat" in alt.expr and "chain" in alt.expr), None)
            if not self.validation and chain is not None and len(alternatives) > 1:
                raise self.fail(f"{name} is a chain, which is the whole of its rule, but another alternative stands beside it", chain)
            for alt in alternatives:
                self.current_alt = alt
                expr = alt.expr
                if "repeat" in expr and "chain" in expr:
                    # A chain is recursion on the rule itself, with no
                    # helper: its base productions first, one for each
                    # expansion of the item, then its recursive ones
                    # (engine §3.3).
                    items = self.expand(expr["repeat"])
                    self.brace_items.append((items, alt, rule))
                    separators = self.expand(expr["separator"]) if "separator" in expr else [[]]
                    me: list[_Sym] = [(("n", lhs), None)]
                    if expr["chain"] == "left":
                        recursive = [me + separator + item for separator in separators for item in items]
                    else:
                        recursive = [item + separator + me for item in items for separator in separators]
                    expansions = items + recursive
                else:
                    expansions = self.expand(expr)
                for expansion in expansions:
                    self.add(lhs, expansion, alt)
                self.flush(expansions)
            self.current_alt = None
        if not self.validation:
            self.check_brace_items()
        rule_productions: list[list[int]] = [[] for _ in self.rule_names]
        for production in self.productions:
            rule_productions[production.lhs].append(production.id)
        lowered = Lowered(
            grammar=self.grammar,
            productions=self.productions,
            rule_names=self.rule_names,
            rule_ids={name: index for index, name in enumerate(self.rule_names)},
            rule_productions=rule_productions,
            rule_display=self.rule_display,
            lean=self.grammar.lean,
            characters=self.characters,
            maximal_helpers=frozenset(self.maximal_helpers),
        )
        from ._ranked_frame import prepare_ranked
        prepare_ranked(lowered)
        return lowered

    def check_brace_items(self) -> None:
        """An item of braces that can derive the empty sequence is an error
        of the grammar (engine §3.3). Nullability is decided over the
        structural grammar, every production that the gates leave,
        reachable or not, before a false condition removes any."""
        nullable: set[Union[str, int]] = set()
        # Each rule's productions that are not yet known to derive ε, by
        # the rules among their symbols that are not yet known to.
        waiting: dict[Union[str, int], list[int]] = {}
        missing: list[int] = []
        queue: list[Union[str, int]] = []
        for index, (lhs, rhs, terminal) in enumerate(self.structural):
            if any(terminal):
                missing.append(-1)
                continue
            symbols = set(rhs)
            missing.append(len(symbols))
            for symbol in symbols:
                waiting.setdefault(symbol, []).append(index)
            if not symbols and lhs not in nullable:
                nullable.add(lhs)
                queue.append(lhs)
        while queue:
            symbol = queue.pop()
            for index in waiting.get(symbol, ()):
                missing[index] -= 1
                lhs = self.structural[index][0]
                if missing[index] == 0 and lhs not in nullable:
                    nullable.add(lhs)
                    queue.append(lhs)
        for items, alt, rule in self.brace_items:
            if any(all(sym[0] == "n" and sym[1] in nullable for sym, _ in item) for item in items):
                raise self.fail(f"an item of braces in {rule.name if rule else '?'} can match no tokens", alt, rule)

    def holds(self, guards: list[Dom]) -> bool:
        if self.validation:
            return True
        # Only gates drop an alternative; a warning keeps it (engine §3.1).
        return all(
            guard.get("kind") == "warning" or (guard["feature"] in self.features) != bool(guard.get("negated"))
            for guard in guards
        )


def _holds_capture(expr: Any) -> bool:
    """Whether an expression holds a capture, at any depth (engine §3.5)."""
    stack: list[Any] = [expr]
    while stack:
        value = stack.pop()
        if isinstance(value, dict):
            if "ranked" in value:
                continue
            if isinstance(value.get("capture"), str) and "expr" in value:
                return True
            stack.extend(value.get(key) for key in ("seq", "choice", "ranked", "and") if isinstance(value.get(key), list))
            stack.extend(value[key] for key in ("optional", "repeat", "separator", "expr") if key in value)
        elif isinstance(value, list):
            stack.extend(value)
    return False


def lower(grammar: Grammar, features: frozenset[str]) -> Lowered:
    """Lower a stage's grammar for a set of enabled features (engine §3).
    The stage resolves its classifiers for the same features, before it
    lowers its rules (engine §2, §3)."""
    classifiers = grammar.classifiers(features)
    lowered = _Lowerer(grammar, features).lower()
    lowered.classifiers = classifiers
    lowered.implications = grammar.implications
    return lowered


def _rule_has_pattern(root: Any) -> bool:
    stack = [root]
    while stack:
        node = stack.pop()
        if isinstance(node, list):
            stack.extend(node)
        elif isinstance(node, dict):
            if "pattern" in node or node.get("op") in ("≅", "≇"):
                return True
            stack.extend(node.values())
    return False
