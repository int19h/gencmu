"""The types of terms and conditions (engine §10).

A term is a string, a set, a capture, or a span. Captures and spans convert
to input values where a string is required. Methods first select on the
actual receiver type. The reader refuses a term whose
parts do not agree (engine §9); a DOM from elsewhere is held to the same
rules. ``set`` is a set whose kind nothing has given yet, such as ``∅``.
``any`` is a constant whose type the reader cannot know, which fits any
type but a span; the loader checks it again once the stage is stitched
(engine §2, §9).
"""

from __future__ import annotations

from typing import Any, Callable, Optional, Union

from ._trampoline import Walk, run
from ._patterns import walk_pattern
from ._strings import scalar

TermType = str
"""``"string"``, ``"strings"``, ``"tags"``, ``"span"``, ``"pattern"``, ``"set"`` or ``"any"``."""

Found = Union[tuple[TermType, None], tuple[None, str]]
"""A type and no problem, or no type and why the parts do not agree."""

Fault = tuple[str, Any]
"""Why the parts of a term or a condition do not agree, and the smallest
construct that holds the disagreement."""

FoundFault = Union[tuple[TermType, None], tuple[None, Fault]]
"""A type and no fault, or no type and the fault."""

ConstantTypes = Callable[[str], TermType]
"""The type of each constant by its name, where the loader knows it; the
reader knows none, and gives every constant the type ``any``."""

_SET_KINDS = frozenset(["strings", "tags", "set", "pattern"])
_NAMES = {
    "pattern": "a tree pattern",
    "string": "a string",
    "strings": "a set of strings",
    "tags": "a tag set",
    "span": "a span",
    "capture": "a capture",
    "restored": "a restored span",
    "emitted": "an emitted pair",
    "predicate": "a predicate",
    "set": "a set",
    "any": "a value",
}
SPAN_NOT_VALUE = "a capture or span is not a tag set; use $x.tags"


def type_name(kind: TermType) -> str:
    """A type as the messages write it, such as ``a tag set``."""
    return _NAMES[kind]


def _unknown_constants(name: str) -> TermType:
    return "string" if scalar(name) is not None else "any"


_SPAN_METHODS = {"first-token", "tokens-after-first", "last-token", "onward", "following-tokens"}
_STRING_METHODS = {"value", "image", "source-text", "verbatim-text"}
_PREDICATES = {"matches", "begins", "starts-input"}


def method_type(name: str, receiver: TermType, args: list[Any], bare: bool = False, recipe: bool = False) -> Found:
    """Select a method on its actual receiver before string conversion."""
    spans = {"capture", "span", "restored"}
    if name in _STRING_METHODS:
        valid = receiver in spans or (recipe and receiver == "emitted" and name in ("value", "image"))
        if name == "verbatim-text":
            valid = recipe and bare
        result, arity = "string", 0
    elif name == "emitted":
        valid, result, arity = recipe and bare, "emitted", 0
    elif name in ("without-elision", "without-elision-except"):
        valid, result, arity = bare, "restored", 0 if name == "without-elision" else 1
        if arity and (len(args) != 1 or set(args[0]) != {"rule"}):
            valid = False
    elif name in _SPAN_METHODS:
        valid = receiver in spans
        result = "restored" if name == "onward" and receiver == "restored" else "span"
        arity = 0
    elif name in ("tags", "classes"):
        valid, result, arity = receiver in spans, "tags", None if name == "tags" else 0
        if name == "tags" and (len(args) > 1 or args and set(args[0]) != {"rule"}):
            valid = False
    elif name in _PREDICATES:
        valid, result, arity = receiver in spans, "predicate", 0 if name == "starts-input" else 1
        if arity and (len(args) != 1 or set(args[0]) != {"rule"}):
            valid = False
    elif name in ("split", "classify"):
        valid, result, arity = receiver in spans | {"string", "any"}, "strings" if name == "split" else "tags", 1
        if name == "classify" and (len(args) != 1 or set(args[0]) != {"classifier"}):
            valid = False
    else:
        return None, f"unknown method .{name}"
    if not valid or arity is not None and len(args) != arity:
        return None, f"invalid receiver or arguments for .{name}"
    return result, None


def joined_type(types: list[TermType], operator: str) -> Found:
    """The kind of sets joined by ∪, ∩ or ∖, or why they cannot be joined:
    each is a set, and all whose kind is known have one kind. A constant
    whose type is not known yet fits any set."""
    if any(kind in ("capture", "span", "restored") for kind in types):
        return None, SPAN_NOT_VALUE
    known = [kind for kind in types if kind != "any"]
    for kind in known:
        if kind not in _SET_KINDS:
            return None, f"{operator} joins sets, not {_NAMES[kind]}"
    kinds = {kind for kind in known if kind != "set"}
    if len(kinds) > 1:
        return None, f"{operator} joins two sets of one kind, not a set of strings and a tag set"
    if kinds:
        return next(iter(kinds)), None
    return ("any" if len(known) < len(types) else "set"), None


def comparison_problem(op: str, left: TermType, right: TermType) -> str | None:
    """Why a comparison's two sides do not fit its comparator, or None. A
    side of type ``any`` fits, and the loader checks it again."""
    if op in ("≅", "≇"):
        if left != "capture":
            return "a tree comparison requires a bare capture on its left"
        if right not in ("pattern", "set", "any"):
            return "a tree comparison requires a tree pattern on its right"
        return None
    if "pattern" in (left, right):
        return "tree patterns use ≅ or ≇"
    if op in ("=", "≠", "∈", "∉"):
        left = "string" if left in ("capture", "span", "restored") else left
        right = "string" if right in ("capture", "span", "restored") else right
    if left in ("capture", "span", "restored") or right in ("capture", "span", "restored"):
        return SPAN_NOT_VALUE
    if op in ("∈", "∉"):
        if left not in ("string", "any"):
            return f"{op} tests a string, not {_NAMES[left]}, in a set of strings; ⊆ and ⊈ compare two sets"
        if right not in ("strings", "set", "any"):
            return f"{op} tests a string in a set of strings, not in {_NAMES[right]}"
        return None
    if op in ("=", "≠"):
        if left == "any" or right == "any":
            return None
        if left == "string" or right == "string":
            # = and ≠ compare two values of one type.
            return None if left == right else f"{op} compares two values of one type, not {_NAMES[left]} and {_NAMES[right]}"
    kind, problem = joined_type([left, right], op)
    if problem is not None:
        return problem
    return f"the kind of the sets that {op} compares is not given" if kind == "set" else None


def expected_problem(kind: TermType, expected: TermType) -> str | None:
    """Why a term of type ``kind`` cannot stand where ``expected``, a string
    or a tag set, is needed, or None. A set of open kind takes the kind it
    is given, and a constant of unknown type fits."""
    if (
        kind == expected
        or kind == "any"
        or (kind == "set" and expected in ("tags", "strings", "pattern"))
        or (expected == "string" and kind in ("capture", "span", "restored"))
    ):
        return None
    if kind in ("capture", "span", "restored"):
        return SPAN_NOT_VALUE
    return f"{_NAMES[expected]} is needed here, not {_NAMES[kind]}"


def is_value_test(op: str) -> bool:
    """Whether a test's comparator is a value test, whose value is a string,
    rather than a tag test, whose value is a tag set (engine §2)."""
    return op in ("=", "≠")


def test_type_problem(op: str, kind: TermType) -> str | None:
    """Why a test's value of type ``kind`` does not fit its comparator, or
    None: a string for a value test, a tag set for a tag test (engine §9,
    §10)."""
    value = is_value_test(op)
    problem = expected_problem(kind, "string" if value else "tags")
    if problem is None:
        return None
    return f"{op} tests {'a string' if value else 'a tag set'}: {problem}"


def term_type_fault(term: Any, constants: ConstantTypes = _unknown_constants, memo: Optional[Memo] = None) -> FoundFault:
    """The type of a term, or why its parts do not agree with the smallest
    construct that disagrees. The term's shape must already be checked.
    ``constants`` gives the type of each constant. ``memo`` keeps the types
    found, so that a reader that asks the type of each term it reads and of
    the terms around it finds each once; its terms do not change."""
    return run(_term_typing(term, constants, {} if memo is None else memo))  # type: ignore[no-any-return]


Memo = dict[Any, tuple[Any, Any]]
"""Types found, by the identity of the term or the condition, with the term
or the condition, which keeps the identity from being reused."""


def _term_typing(term: Any, constants: ConstantTypes, memo: Memo) -> Walk:
    found = memo.get(id(term))
    if found is not None and found[0] is term:
        return found[1]
    result = yield _term_typing_once(term, constants, memo)
    memo[id(term)] = (term, result)
    return result


def _term_typing_once(term: Any, constants: ConstantTypes, memo: Memo) -> Walk:
    if not isinstance(term, dict):
        return None, ("a malformed term", term)
    if "pattern" in term:
        tested = set()
        for node, _ in walk_pattern(term["pattern"]):
            if "test" in node:
                base = node["expr"]
                while "test" in base:
                    base = base["expr"]
                tested.add(id(base))
        for node, _ in walk_pattern(term["pattern"]):
            operands = [node["literal"]] if "literal" in node else node.get("range", [])
            for operand in operands:
                kind, fault = yield _term_typing(operand, constants, memo)
                if fault is not None:
                    return None, fault
                problem = expected_problem(kind, "string")
                if problem is not None:
                    return None, (problem, operand)
            if "constant" in node:
                kind = constants(node["constant"])
                allowed = ("string", "any") if id(node) in tested else ("pattern", "string", "any")
                problem = (
                    None
                    if kind in allowed
                    else "a tested constant requires a string"
                    if id(node) in tested
                    else "a pattern atom requires a string or pattern constant"
                )
                if problem is not None:
                    return None, (problem, {"const": node["constant"], "at": node["at"]})
            if "test" in node:
                operands = [r["value"] for r in node["requirements"]] if node["test"] == "tags" else [node["value"]]
                for operand in operands:
                    kind, fault = yield _term_typing(operand, constants, memo)
                    if fault is not None:
                        return None, fault
                    problem = test_type_problem(node["test"], kind)
                    if problem is not None:
                        return None, (problem, operand)
        return "pattern", None
    if isinstance(term.get("string"), str):
        return "string", None
    if isinstance(term.get("tag"), str):
        return "tags", None
    if term.get("emptySet") is True:
        return "set", None
    if isinstance(term.get("capture"), str):
        return "capture", None
    if "interpolate" in term:
        for part in term["interpolate"]:
            kind, fault = yield _term_typing(part, constants, memo)
            if fault is not None:
                return None, fault
            problem = expected_problem(kind, "string")
            if problem:
                return None, (problem, part)
        return "string", None
    if isinstance(term.get("const"), str):
        return constants(term["const"]), None
    for key, operator in (("union", "∪"), ("intersection", "∩"), ("difference", "∖")):
        items = term.get(key)
        if not isinstance(items, list):
            continue
        types: list[TermType] = []
        for item in items:
            kind, fault = yield _term_typing(item, constants, memo)
            if fault is not None:
                return None, fault
            types.append(kind)
        joined, problem = joined_type(types, operator)
        return (None, (problem, term)) if problem is not None else (joined, None)
    if "if" in term:
        fault = yield _condition_typing(term["if"], constants, memo)
        if fault is not None:
            return None, fault
        kind, fault = yield _term_typing(term["then"], constants, memo)
        if fault is not None:
            return None, fault
        problem = expected_problem(kind, "tags")
        return (None, (problem, term)) if problem is not None else ("tags", None)
    name = term.get("method")
    if isinstance(name, str):
        kind, fault = yield _term_typing(term["receiver"], constants, memo)
        if fault is not None:
            return None, fault
        recipe = name in ("verbatim-text", "emitted") or kind == "emitted"
        result, problem = method_type(name, kind, term["args"], set(term["receiver"]) == {"capture"}, recipe)
        if problem is not None:
            return None, (problem, term)
        if name == "split":
            argument, fault = yield _term_typing(term["args"][0], constants, memo)
            if fault is not None:
                return None, fault
            problem = expected_problem(argument, "string")
            if problem:
                return None, (problem, term)
        return result, None
    return None, ("a malformed term", term)


def term_type(term: Any, constants: ConstantTypes = _unknown_constants, memo: Optional[Memo] = None) -> Found:
    """The type of a term, or why its parts do not agree."""
    kind, fault = term_type_fault(term, constants, memo)
    return (None, fault[0]) if fault is not None else (kind, None)  # type: ignore[return-value]


def condition_type_fault(condition: Any, constants: ConstantTypes = _unknown_constants, memo: Optional[Memo] = None) -> Optional[Fault]:
    """Why a condition's terms do not agree in type, with the smallest
    construct that disagrees, or None."""
    return run(_condition_typing(condition, constants, {} if memo is None else memo))  # type: ignore[no-any-return]


def _condition_typing(condition: Any, constants: ConstantTypes, memo: Memo) -> Walk:
    found = memo.get(("condition", id(condition)))
    if found is not None and found[0] is condition:
        return found[1]
    result = yield _condition_typing_once(condition, constants, memo)
    memo[("condition", id(condition))] = (condition, result)
    return result


def _condition_typing_once(condition: Any, constants: ConstantTypes, memo: Memo) -> Walk:
    if not isinstance(condition, dict):
        return "a malformed condition", condition
    items = condition.get("any", condition.get("all"))
    if isinstance(items, list):
        for item in items:
            fault = yield _condition_typing(item, constants, memo)
            if fault is not None:
                return fault
        return None
    if "not" in condition:
        return (yield _condition_typing(condition["not"], constants, memo))
    if "if" in condition:
        return (yield _condition_typing(condition["if"], constants, memo)) or (yield _condition_typing(condition["then"], constants, memo))
    if isinstance(condition.get("op"), str):
        left, fault = yield _term_typing(condition["left"], constants, memo)
        if fault is not None:
            return fault
        right, fault = yield _term_typing(condition["right"], constants, memo)
        if fault is not None:
            return fault
        problem = comparison_problem(condition["op"], left, right)
        return (problem, condition) if problem is not None else None
    if "method" in condition:
        kind, fault = yield _term_typing(condition, constants, memo)
        if fault:
            return fault
        if kind != "predicate":
            return "a condition requires a predicate", condition
    return None


def condition_type_problem(condition: Any, memo: Optional[Memo] = None) -> str | None:
    """Why a condition's terms do not agree in type, or None."""
    fault = condition_type_fault(condition, memo=memo)
    return fault[0] if fault is not None else None


def tag_term_fault(term: Any, constants: ConstantTypes = _unknown_constants, memo: Optional[Memo] = None) -> Optional[Fault]:
    """Why a term that must be a tag set, a constituent's or an item's, is
    not one, with the construct at fault, or None."""
    kind, fault = term_type_fault(term, constants, memo)
    if fault is not None:
        return fault
    problem = expected_problem(kind, "tags")  # type: ignore[arg-type]
    return (problem, term) if problem is not None else None


def tag_term_problem(term: Any, memo: Optional[Memo] = None) -> str | None:
    """Why a term that must be a tag set is not one, or None."""
    fault = tag_term_fault(term, memo=memo)
    return fault[0] if fault is not None else None


def rule_type_fault(rule: Any, constants: ConstantTypes = _unknown_constants) -> Optional[Fault]:
    """Why a well-formed rule's terms and conditions do not agree in type,
    with the construct at fault, or None."""
    terms = [rule.get("tags"), *(alternative.get("tags") for alternative in rule["alternatives"])]
    if "emit" in rule:
        terms.extend(item.get("tags") for item in rule["emit"]["items"])
    for term in terms:
        if term is None:
            continue
        fault = tag_term_fault(term, constants)
        if fault is not None:
            return fault
    for condition in rule["conditions"]:
        fault = condition_type_fault(condition, constants)
        if fault is not None:
            return fault
    for alternative in rule["alternatives"]:
        for test in tests_in(alternative["expr"]):
            operands = [r["value"] for r in test["requirements"]] if test["test"] == "tags" else [test["value"]]
            for value in operands:
                kind, fault = term_type_fault(value, constants)
                if fault is not None:
                    return fault
                problem = test_type_problem(test["test"], kind)
                if problem is not None:
                    return problem, value
    # The reader knows the shape of string terminals and recipe atoms.
    # Binding supplies the types of their user constants, including those
    # in definitions that a later declaration replaces.
    pending = [rule]
    while pending:
        node = pending.pop()
        if isinstance(node, list):
            pending.extend(reversed(node))
        elif isinstance(node, dict):
            operands = node.get("concat", node.get("range", []))
            if "literal" in node:
                operands = [node["literal"]]
            for operand in operands:
                kind, fault = term_type_fault(operand, constants)
                if fault is not None:
                    return fault
                problem = expected_problem(kind, "string")
                if problem is not None:
                    return problem, operand
            pending.extend(reversed(list(node.values())))
    return None


def tests_in(expr: Any) -> list[dict[str, Any]]:
    """The tested symbols of an expression, in the order written."""
    found: list[dict[str, Any]] = []
    stack: list[Any] = [expr]
    while stack:
        current = stack.pop()
        if not isinstance(current, dict):
            continue
        if isinstance(current.get("test"), str):
            found.append(current)
        for key in ("choice", "ranked", "and", "seq"):
            items = current.get(key)
            if isinstance(items, list):
                stack.extend(reversed(items))
        # In reverse, so that a repeat's item comes before its separator.
        for key in ("expr", "separator", "repeat", "optional"):
            if key in current:
                stack.append(current[key])
    return found


def rule_type_problem(rule: Any) -> str | None:
    """Why a well-formed rule's terms and conditions do not agree in type,
    or None."""
    fault = rule_type_fault(rule)
    return fault[0] if fault is not None else None


def constant_value_type(
    value: Any, redefine: bool, constants: ConstantTypes = _unknown_constants, memo: Optional[Memo] = None
) -> FoundFault:
    """The type of a constant's value, or why it cannot be one (engine §2,
    §10): a string, a set of strings or a tag set. A redefinition keeps the
    constant's type, which gives ``∅`` its kind, so its value can be of
    open kind."""
    kind, fault = term_type_fault(value, constants, memo)
    if fault is not None:
        return None, fault
    if kind in ("capture", "span", "restored"):
        return None, ("a constant's value is a string or a set, never a span", value)
    if kind == "set" and not redefine:
        return None, ("the kind of the set that the constant holds is not given", value)
    return kind, None


def constant_value_problem(value: Any, redefine: bool) -> str | None:
    """Why a constant's value cannot be one, or None."""
    _, fault = constant_value_type(value, redefine)
    return fault[0] if fault is not None else None


def open_part(term: Any) -> Any:
    """The first part of a term that is not closed (engine §10), or None: a
    capture, a guarded term, or a method other than split. The
    shape of the term need not be checked. In the order written, with a
    list for a stack."""
    stack: list[Any] = [term]
    while stack:
        current = stack.pop()
        if not isinstance(current, dict):
            continue
        if "capture" in current or "if" in current:
            return current
        if "pattern" in current:
            for node, _ in walk_pattern(current["pattern"]):
                if "test" in node:
                    stack.extend(r["value"] for r in node["requirements"]) if node["test"] == "tags" else stack.append(node["value"])
            continue
        items: Any = []
        if isinstance(current.get("method"), str):
            if current["method"] != "split":
                return current
            items = [current["receiver"], *current["args"]]
        else:
            for key in ("union", "intersection", "difference", "interpolate"):
                if isinstance(current.get(key), list):
                    items = current[key]
                    break
        if isinstance(items, list):
            stack.extend(reversed(items))
    return None


def constants_in(node: Any) -> list[dict[str, Any]]:
    """The references to constants in a term, a condition, a rule or any
    part of a DOM, in the order written."""
    found: list[dict[str, Any]] = []
    stack: list[Any] = [node]
    while stack:
        current = stack.pop()
        if isinstance(current, list):
            stack.extend(reversed(current))
        elif isinstance(current, dict):
            if isinstance(current.get("constant"), str):
                found.append({"const": current["constant"], "at": current["at"]})
            elif isinstance(current.get("const"), str):
                found.append(current)
            else:
                stack.extend(reversed(list(current.values())))
    return found
