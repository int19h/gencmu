"""A rule's clauses as they apply to one production (engine §3.6), and the
checks a definition is held to as a whole (engine §9).

Whether a production has a capture is known when the grammar is read, so a
clause is simplified for each production before it is attached: presence
tests become true or false, and the connectives over them are reduced. The
reader, the check of a precompiled DOM and lowering all simplify the same
way, so that a DOM the reader refuses is refused everywhere.
"""

from __future__ import annotations

from typing import AbstractSet, Any, Union

from ._trampoline import Walk, run

Dom = dict[str, Any]

WHOLE = ""
"""The capture name of ``$``, the whole constituent, which every production
has without writing it (engine §3.5)."""

Simplified = Union[bool, Dom]
"""A condition simplified for a production: true, false, or what is left to
evaluate while parsing."""

EMPTY_SET: Dom = {"emptySet": True}


def captures_in(dom: Any) -> set[str]:
    """The capture names a condition or term uses, ``WHOLE`` for ``$``; a
    presence test is not a use (engine §3.6)."""
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


def mentioned_in(dom: Any) -> set[str]:
    """The capture names a clause mentions, presence tests included."""
    found = captures_in(dom)
    stack = [dom]
    while stack:
        value = stack.pop()
        if isinstance(value, dict):
            if isinstance(value.get("captured"), str):
                found.add(value["captured"])
            stack.extend(value.values())
        elif isinstance(value, list):
            stack.extend(value)
    return found


def top_captures(expr: Any) -> list[str]:
    """The captures an alternative writes, in text order (engine §3.5)."""
    top = expr["seq"] if isinstance(expr, dict) and isinstance(expr.get("seq"), list) else [expr]
    return [item["capture"] for item in top if isinstance(item, dict) and isinstance(item.get("capture"), str) and "expr" in item]


def simplify_condition(condition: Dom, present: AbstractSet[str]) -> Simplified:
    """A condition simplified for a production that has the captures
    ``present`` (engine §3.6)."""
    return run(_condition(condition, present))  # type: ignore[no-any-return]


def simplify_term(term: Dom, present: AbstractSet[str]) -> Dom:
    """A tag term simplified for a production that has the captures
    ``present``: a guarded term whose condition is false is the empty set
    (engine §3.6)."""
    return run(_term(term, present))  # type: ignore[no-any-return]


def _condition(dom: Dom, present: AbstractSet[str]) -> Walk:
    if "captured" in dom:
        return dom["captured"] == WHOLE or dom["captured"] in present
    if "if" in dom:
        premise = yield _condition(dom["if"], present)
        if premise is False:
            return True
        consequent = yield _condition(dom["then"], present)
        if premise is True or consequent is True:
            return consequent
        if consequent is False:
            return {"not": premise}
        return {"if": premise, "then": consequent}
    if "not" in dom:
        inner = yield _condition(dom["not"], present)
        return (not inner) if isinstance(inner, bool) else {"not": inner}
    if "all" in dom or "any" in dom:
        key = "all" if "all" in dom else "any"
        # ∧ is decided by a false part, ∨ by a true one; the other constant
        # adds nothing.
        deciding = key == "any"
        parts: list[Dom] = []
        for item in dom[key]:
            part = yield _condition(item, present)
            if part is deciding:
                return deciding
            if part is not (not deciding):
                parts.append(part)
        if not parts:
            return not deciding
        return parts[0] if len(parts) == 1 else {key: parts}
    if "op" in dom:
        left = yield _term(dom["left"], present)
        right = yield _term(dom["right"], present)
        return {"op": dom["op"], "left": left, "right": right}
    return dom


def is_empty_set(dom: Any) -> bool:
    """Whether a term is the empty set: ``∅``, or a constant whose value is
    empty, since a constant is its value here, once the loader has given it
    one (engine §3.6)."""
    if not isinstance(dom, dict):
        return False
    if dom.get("emptySet") is True:
        return True
    value = dom.get("value")
    return isinstance(dom.get("const"), str) and isinstance(value, frozenset) and not value


def _term(dom: Any, present: AbstractSet[str]) -> Walk:
    """A term's empty set, written or left by a guard, is dropped from a
    union, and makes an intersection, a difference from it or a guarded term
    empty (engine §3.6):
    what is reduced away is never evaluated."""
    if not isinstance(dom, dict):
        return dom
    if "if" in dom:
        premise = yield _condition(dom["if"], present)
        if premise is False:
            return dict(EMPTY_SET)
        then = yield _term(dom["then"], present)
        if is_empty_set(then):
            return then
        return then if premise is True else {"if": premise, "then": then}
    if isinstance(dom.get("union"), list):
        parts = []
        for item in dom["union"]:
            part = yield _term(item, present)
            if not is_empty_set(part):
                parts.append(part)
        if not parts:
            return dict(EMPTY_SET)
        return parts[0] if len(parts) == 1 else {"union": parts}
    if isinstance(dom.get("intersection"), list):
        parts = []
        for item in dom["intersection"]:
            part = yield _term(item, present)
            if is_empty_set(part):
                return part
            parts.append(part)
        return {"intersection": parts}
    if isinstance(dom.get("difference"), list):
        # A difference from the empty set is empty, and one of the empty set
        # is its first part (engine §3.6).
        left = yield _term(dom["difference"][0], present)
        if is_empty_set(left):
            return left
        right = yield _term(dom["difference"][1], present)
        return left if is_empty_set(right) else {"difference": [left, right]}
    if isinstance(dom.get("args"), list):
        args = []
        for arg in dom["args"]:
            args.append((yield _term(arg, present)))
        return {**dom, "args": args}
    return dom


def applies(condition: Dom, present: AbstractSet[str]) -> Simplified | None:
    """A condition as it applies to a production with the captures
    ``present``: ``None`` where it does not apply, having simplified to true
    or using a capture the production lacks; ``False`` where it removes the
    production; else what is left to evaluate (engine §3.6)."""
    simplified = simplify_condition(condition, present)
    if simplified is True:
        return None
    if simplified is False:
        return False
    return simplified if captures_in(simplified) <= present else None


def waits(clause: Any) -> bool:
    """Whether a clause holds a constant without its value. A constant is
    its value in simplification (engine §3.6), so the checks that
    simplification decides wait for the loader, which checks the definition
    again once the constants have their values (engine §9)."""
    stack = [clause]
    while stack:
        value = stack.pop()
        if isinstance(value, dict):
            if isinstance(value.get("const"), str) and "value" not in value:
                return True
            stack.extend(value.values())
        elif isinstance(value, list):
            stack.extend(value)
    return False


def attachments_of(item: Dom) -> list[str]:
    """An emission item's attachment captures, before it and after it, in
    order (engine §11)."""
    return [*item.get("before", ()), *item.get("after", ())]


def attachment_order(item: Dom) -> list[str]:
    """The captures a capture item writes, in written order: its
    before-attachments, its carrier and its after-attachments (engine §9)."""
    return [*item.get("before", ()), item["capture"], *item.get("after", ())]


def definition_problem(rule: Dom) -> str | None:
    """Why a definition, a well-formed rule of a DOM with its clauses, is an
    error of its document as a whole (engine §9), or None. The checks that
    simplification decides skip a clause that holds a constant without its
    value."""
    alternatives = rule["alternatives"]
    captured = [top_captures(alternative["expr"]) for alternative in alternatives]
    presents = [set(names) | {WHOLE} for names in captured]
    known = set().union(*presents)
    emit = rule.get("emit")
    items: list[Dom] = emit["items"] if emit is not None else []
    # A constituent that does not count is never a foreign part (engine §9).
    if rule.get("foreign") and emit is not None and not items:
        return f"{rule['name']} is foreign and emits ε"
    clauses: list[Any] = [rule.get("tags"), rule["conditions"], items]
    clauses.extend(alternative.get("tags") for alternative in alternatives)
    # An emission item mentions its attachments too.
    attached = {name for item in items if "capture" in item for name in attachments_of(item)}
    unknown = sorted(set().union(attached, *(mentioned_in(clause) for clause in clauses)) - known)
    if unknown:
        return f"${unknown[0]} is captured by no alternative of {rule['name']}"
    for condition in rule["conditions"]:
        if waits(condition):
            continue
        if all(applies(condition, present) is None for present in presents):
            return f"a condition of {rule['name']} applies to none of its alternatives"

    def lacks(term: Dom, present: set[str]) -> bool:
        return not waits(term) and not captures_in(simplify_term(term, present)) <= present

    for alternative, present in zip(alternatives, presents):
        if "tags" in alternative and lacks(alternative["tags"], present):
            return "an alternative's tags use a capture it lacks; guard the use with ⟹"
        if "tags" in rule and lacks(rule["tags"], present):
            return f"the %tags of {rule['name']} use a capture an alternative lacks; guard the use with ⟹"
    for names, present in zip(captured, presents):
        kept = [item for item in items if "insert" in item or item["capture"] in present]
        if items and not kept:
            return f"%emits of {rule['name']} leaves an alternative nothing to emit"
        for item in kept:
            if "tags" in item and lacks(item["tags"], present):
                return "the tags of an item of %emits use a capture an alternative lacks; guard the use with ⟹"
        # An alternative without an item's carrier lacks its attachments too
        # (engine §9).
        for item in items:
            if "capture" not in item or item["capture"] in present:
                continue
            stray = next((name for name in attachments_of(item) if name in present), None)
            if stray is not None:
                return f"%emits of {rule['name']} attaches ${stray} in an alternative without its carrier ${item['capture']}"
        # The written order of the captures, attachments included, is the
        # order they stand in (engine §9).
        written = [name for item in kept if item.get("capture") for name in attachment_order(item)]
        order = [names.index(name) for name in written if name in names]
        if order != sorted(order):
            return f"%emits of {rule['name']} lists captures out of the order they stand in the text"
        for index, item in enumerate(items):
            if "insert" not in item:
                continue
            anchor = next((other["capture"] for other in items[index + 1 :] if "capture" in other), None)
            if anchor is not None and anchor not in present:
                return f"an inserted tag of {rule['name']} stands before ${anchor}, which an alternative lacks"
    return None
