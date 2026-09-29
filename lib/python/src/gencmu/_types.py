"""The types of terms and conditions (engine §10).

A term is a string, a set of strings, a tag set or a span, and no value turns
into another. The reader gives every term its type and refuses one whose
parts do not agree (engine §9); a DOM from elsewhere is held to the same
rules. ``set`` is a set whose kind nothing has given yet, such as ``∅``.
"""

from __future__ import annotations

from typing import Any, Union

TermType = str
"""``"string"``, ``"strings"``, ``"tags"``, ``"span"`` or ``"set"``."""

Found = Union[tuple[TermType, None], tuple[None, str]]
"""A type and no problem, or no type and why the parts do not agree."""

_SET_KINDS = frozenset(["strings", "tags", "set"])
_NAMES = {"string": "a string", "strings": "a set of strings", "tags": "a tag set", "span": "a span", "set": "a set"}
SPAN_NOT_VALUE = "a span is not a value: tags($x) is the tag set of $x"


def _call_type(call: str) -> TermType:
    if call in ("phonemes", "text", "lowercase"):
        return "string"
    if call == "runs":
        return "strings"
    if call in ("tags", "classes"):
        return "tags"
    return "span"


def joined_type(types: list[TermType], operator: str) -> Found:
    """The kind of sets joined by ∪, ∩ or ∖, or why they cannot be joined:
    each is a set, and all whose kind is known have one kind."""
    if "span" in types:
        return None, SPAN_NOT_VALUE
    for kind in types:
        if kind not in _SET_KINDS:
            return None, f"{operator} joins sets, not {_NAMES[kind]}"
    kinds = {kind for kind in types if kind != "set"}
    if len(kinds) > 1:
        return None, f"{operator} joins two sets of one kind, not a set of strings and a tag set"
    return (next(iter(kinds)) if kinds else "set"), None


def comparison_problem(op: str, left: TermType, right: TermType) -> str | None:
    """Why a comparison's two sides do not fit its comparator, or None."""
    if left == "span" or right == "span":
        return SPAN_NOT_VALUE
    if op in ("∈", "∉"):
        if left != "string":
            return f"{op} tests a string, not {_NAMES[left]}, in a set of strings; ⊆ and ⊈ compare two sets"
        if right not in ("strings", "set"):
            return f"{op} tests a string in a set of strings, not in {_NAMES[right]}"
        return None
    if op in ("=", "≠") and (left == "string" or right == "string"):
        # = and ≠ compare two values of one type.
        return None if left == right else f"{op} compares two values of one type, not {_NAMES[left]} and {_NAMES[right]}"
    kind, problem = joined_type([left, right], op)
    if problem is not None:
        return problem
    return f"the kind of the sets that {op} compares is not given" if kind == "set" else None


def expected_problem(kind: TermType, expected: TermType) -> str | None:
    """Why a term of type ``kind`` cannot stand where ``expected``, a string
    or a tag set, is needed, or None. A set of open kind takes the kind it
    is given."""
    if kind == expected or (kind == "set" and expected == "tags"):
        return None
    if kind == "span":
        return SPAN_NOT_VALUE
    return f"{_NAMES[expected]} is needed here, not {_NAMES[kind]}"


def term_type(term: Any) -> Found:
    """The type of a term, or why its parts do not agree. The term's shape
    must already be checked."""
    if isinstance(term.get("string"), str):
        return "string", None
    if isinstance(term.get("tag"), str):
        return "tags", None
    if term.get("emptySet") is True:
        return "set", None
    if isinstance(term.get("capture"), str):
        return "span", None
    for key, operator in (("union", "∪"), ("intersection", "∩"), ("difference", "∖")):
        items = term.get(key)
        if not isinstance(items, list):
            continue
        types: list[TermType] = []
        for item in items:
            kind, problem = term_type(item)
            if problem is not None:
                return None, problem
            types.append(kind)  # type: ignore[arg-type]
        return joined_type(types, operator)
    if "if" in term:
        problem = condition_type_problem(term["if"])
        if problem is not None:
            return None, problem
        kind, problem = term_type(term["then"])
        if problem is not None:
            return None, problem
        problem = expected_problem(kind, "tags")  # type: ignore[arg-type]
        return (None, problem) if problem is not None else ("tags", None)
    call = term.get("call")
    if isinstance(call, str):
        for argument in term.get("args", []):
            if "rule" in argument:
                continue
            kind, problem = term_type(argument)
            if problem is not None:
                return None, problem
            if call == "lowercase":
                problem = expected_problem(kind, "string")  # type: ignore[arg-type]
                if problem is not None:
                    return None, f"lowercase takes one string: {problem}"
        return _call_type(call), None
    return None, "a malformed term"


def condition_type_problem(condition: Any) -> str | None:
    """Why a condition's terms do not agree in type, or None."""
    items = condition.get("any", condition.get("all"))
    if isinstance(items, list):
        for item in items:
            problem = condition_type_problem(item)
            if problem is not None:
                return problem
        return None
    if "not" in condition:
        return condition_type_problem(condition["not"])
    if "if" in condition:
        return condition_type_problem(condition["if"]) or condition_type_problem(condition["then"])
    if isinstance(condition.get("op"), str):
        left, problem = term_type(condition["left"])
        if problem is not None:
            return problem
        right, problem = term_type(condition["right"])
        if problem is not None:
            return problem
        return comparison_problem(condition["op"], left, right)  # type: ignore[arg-type]
    return None


def tag_term_problem(term: Any) -> str | None:
    """Why a term that must be a tag set, a constituent's or an item's, is
    not one, or None."""
    kind, problem = term_type(term)
    if problem is not None:
        return problem
    return expected_problem(kind, "tags")  # type: ignore[arg-type]


def rule_type_problem(rule: Any) -> str | None:
    """Why a well-formed rule's terms and conditions do not agree in type,
    or None."""
    terms = [rule.get("tags"), *(alternative.get("tags") for alternative in rule["alternatives"])]
    if "emit" in rule:
        terms.extend(item.get("tags") for item in rule["emit"]["items"])
    for term in terms:
        if term is None:
            continue
        problem = tag_term_problem(term)
        if problem is not None:
            return problem
    for condition in rule["conditions"]:
        problem = condition_type_problem(condition)
        if problem is not None:
            return problem
    return None
