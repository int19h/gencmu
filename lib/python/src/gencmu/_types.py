"""The types of terms and conditions (engine §10).

A term is a string, a set of strings, a tag set or a span, and no value turns
into another. The reader gives every term its type and refuses one whose
parts do not agree (engine §9); a DOM from elsewhere is held to the same
rules. ``set`` is a set whose kind nothing has given yet, such as ``∅``.
``any`` is a constant whose type the reader cannot know, which fits any
type but a span; the loader checks it again once the stage is stitched
(engine §2, §9).
"""

from __future__ import annotations

from typing import Any, Callable, Optional, Union

TermType = str
"""``"string"``, ``"strings"``, ``"tags"``, ``"span"``, ``"set"`` or ``"any"``."""

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

_SET_KINDS = frozenset(["strings", "tags", "set"])
_NAMES = {"string": "a string", "strings": "a set of strings", "tags": "a tag set", "span": "a span", "set": "a set", "any": "a value"}
SPAN_NOT_VALUE = "a span is not a value: tags($x) is the tag set of $x"


def type_name(kind: TermType) -> str:
    """A type as the messages write it, such as ``a tag set``."""
    return _NAMES[kind]


def _unknown_constants(name: str) -> TermType:
    return "any"


def _call_type(call: str) -> TermType:
    if call in ("phonemes", "text"):
        return "string"
    if call == "split":
        return "strings"
    if call in ("tags", "classes", "tag"):
        return "tags"
    return "span"


def joined_type(types: list[TermType], operator: str) -> Found:
    """The kind of sets joined by ∪, ∩ or ∖, or why they cannot be joined:
    each is a set, and all whose kind is known have one kind. A constant
    whose type is not known yet fits any set."""
    if "span" in types:
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
    if left == "span" or right == "span":
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
    if kind == expected or kind == "any" or (kind == "set" and expected == "tags"):
        return None
    if kind == "span":
        return SPAN_NOT_VALUE
    return f"{_NAMES[expected]} is needed here, not {_NAMES[kind]}"


def is_sound_test(op: str) -> bool:
    """Whether a test's comparator is a sound test, whose value is a string,
    rather than a tag test, whose value is a tag set (engine §2)."""
    return op in ("=", "≠")


def test_type_problem(op: str, kind: TermType) -> str | None:
    """Why a test's value of type ``kind`` does not fit its comparator, or
    None: a string for a sound test, a tag set for a tag test (engine §9,
    §10)."""
    sound = is_sound_test(op)
    problem = expected_problem(kind, "string" if sound else "tags")
    if problem is None:
        return None
    return f"{op} tests {'a string' if sound else 'a tag set'}: {problem}"


def term_type_fault(term: Any, constants: ConstantTypes = _unknown_constants) -> FoundFault:
    """The type of a term, or why its parts do not agree with the smallest
    construct that disagrees. The term's shape must already be checked.
    ``constants`` gives the type of each constant."""
    if isinstance(term.get("string"), str):
        return "string", None
    if isinstance(term.get("tag"), str) or "range" in term:
        return "tags", None
    if term.get("emptySet") is True:
        return "set", None
    if isinstance(term.get("capture"), str):
        return "span", None
    if isinstance(term.get("const"), str):
        return constants(term["const"]), None
    for key, operator in (("union", "∪"), ("intersection", "∩"), ("difference", "∖")):
        items = term.get(key)
        if not isinstance(items, list):
            continue
        types: list[TermType] = []
        for item in items:
            kind, fault = term_type_fault(item, constants)
            if fault is not None:
                return None, fault
            types.append(kind)  # type: ignore[arg-type]
        joined, problem = joined_type(types, operator)
        return (None, (problem, term)) if problem is not None else (joined, None)  # type: ignore[return-value]
    if "if" in term:
        fault = condition_type_fault(term["if"], constants)
        if fault is not None:
            return None, fault
        kind, fault = term_type_fault(term["then"], constants)
        if fault is not None:
            return None, fault
        problem = expected_problem(kind, "tags")  # type: ignore[arg-type]
        return (None, (problem, term)) if problem is not None else ("tags", None)
    call = term.get("call")
    if isinstance(call, str):
        for argument in term.get("args", []):
            if "rule" in argument:
                continue
            kind, fault = term_type_fault(argument, constants)
            if fault is not None:
                return None, fault
            if call in ("split", "tag"):
                problem = expected_problem(kind, "string")  # type: ignore[arg-type]
                if problem is not None:
                    signature = "two strings" if call == "split" else "one string"
                    return None, (f"{call} takes {signature}: {problem}", term)
        return _call_type(call), None
    return None, ("a malformed term", term)


def term_type(term: Any, constants: ConstantTypes = _unknown_constants) -> Found:
    """The type of a term, or why its parts do not agree."""
    kind, fault = term_type_fault(term, constants)
    return (None, fault[0]) if fault is not None else (kind, None)  # type: ignore[return-value]


def condition_type_fault(condition: Any, constants: ConstantTypes = _unknown_constants) -> Optional[Fault]:
    """Why a condition's terms do not agree in type, with the smallest
    construct that disagrees, or None."""
    items = condition.get("any", condition.get("all"))
    if isinstance(items, list):
        for item in items:
            fault = condition_type_fault(item, constants)
            if fault is not None:
                return fault
        return None
    if "not" in condition:
        return condition_type_fault(condition["not"], constants)
    if "if" in condition:
        return condition_type_fault(condition["if"], constants) or condition_type_fault(condition["then"], constants)
    if isinstance(condition.get("op"), str):
        left, fault = term_type_fault(condition["left"], constants)
        if fault is not None:
            return fault
        right, fault = term_type_fault(condition["right"], constants)
        if fault is not None:
            return fault
        problem = comparison_problem(condition["op"], left, right)  # type: ignore[arg-type]
        return (problem, condition) if problem is not None else None
    return None


def condition_type_problem(condition: Any) -> str | None:
    """Why a condition's terms do not agree in type, or None."""
    fault = condition_type_fault(condition)
    return fault[0] if fault is not None else None


def tag_term_fault(term: Any, constants: ConstantTypes = _unknown_constants) -> Optional[Fault]:
    """Why a term that must be a tag set, a constituent's or an item's, is
    not one, with the construct at fault, or None."""
    kind, fault = term_type_fault(term, constants)
    if fault is not None:
        return fault
    problem = expected_problem(kind, "tags")  # type: ignore[arg-type]
    return (problem, term) if problem is not None else None


def tag_term_problem(term: Any) -> str | None:
    """Why a term that must be a tag set is not one, or None."""
    fault = tag_term_fault(term)
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
    # A test's value is a string for a sound test and a tag set for a tag
    # test (engine §9, §10).
    for alternative in rule["alternatives"]:
        for test in tests_in(alternative["expr"]):
            kind, fault = term_type_fault(test["value"], constants)
            if fault is not None:
                return fault
            problem = test_type_problem(test["test"], kind)  # type: ignore[arg-type]
            if problem is not None:
                return problem, test["value"]
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
        for key in ("choice", "and", "seq"):
            items = current.get(key)
            if isinstance(items, list):
                stack.extend(reversed(items))
        for key in ("optional", "repeat", "expr"):
            if key in current:
                stack.append(current[key])
    return found


def rule_type_problem(rule: Any) -> str | None:
    """Why a well-formed rule's terms and conditions do not agree in type,
    or None."""
    fault = rule_type_fault(rule)
    return fault[0] if fault is not None else None


def constant_value_type(value: Any, redefine: bool, constants: ConstantTypes = _unknown_constants) -> FoundFault:
    """The type of a constant's value, or why it cannot be one (engine §2,
    §10): a string, a set of strings or a tag set. A redefinition keeps the
    constant's type, which gives ``∅`` its kind, so its value can be of
    open kind."""
    kind, fault = term_type_fault(value, constants)
    if fault is not None:
        return None, fault
    if kind == "span":
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
    capture, a guarded term, or a call of anything but split and tag. The
    shape of the term need not be checked."""
    if not isinstance(term, dict):
        return None
    if "capture" in term or "if" in term:
        return term
    if isinstance(term.get("call"), str):
        if term["call"] not in ("split", "tag"):
            return term
        args = term.get("args")
        for argument in args if isinstance(args, list) else []:
            found = open_part(argument)
            if found is not None:
                return found
        return None
    for key in ("union", "intersection", "difference"):
        items = term.get(key)
        if not isinstance(items, list):
            continue
        for item in items:
            found = open_part(item)
            if found is not None:
                return found
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
            if isinstance(current.get("const"), str):
                found.append(current)
            else:
                stack.extend(reversed(list(current.values())))
    return found
