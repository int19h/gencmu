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


def duplicate_captures(expr: Any) -> list[Dom]:
    """The capture nodes that some production of an expression reads after
    a capture of the same name (engine §3.5, §9), found from the structure
    alone: two captures are read by one production exactly when they stand
    in different items of one sequence or one ``&``, since each item is read
    in any of its expansions. So no production is listed. A choice's
    branches never meet, and braces and an elidable optional hold no
    capture. In no particular order."""
    duplicates: list[Dom] = []

    def children(node: Any) -> list[Any]:
        if not isinstance(node, dict) or (isinstance(node.get("capture"), str) and "expr" in node):
            return []
        for key in ("seq", "choice", "and"):
            if isinstance(node.get(key), list):
                return node[key]
        if "optional" in node and node.get("elidable") is not True:
            return [node["optional"]]
        return []

    # Each frame: a node, the index of its next child, and what each child
    # done so far gives: its captures by name, and their number. An explicit
    # stack, since a DOM's depth is bounded only by its check. An item of a
    # sequence or an & meets the items before it: the side with fewer
    # captures is looked up in the other, and the two are then joined, the
    # smaller into the larger, so a capture moves a number of times that
    # grows with the logarithm of their count, not with the depth of the
    # expression.
    flagged: dict[int, Dom] = {}
    Found = tuple[dict[str, list[Dom]], int]
    stack: list[tuple[Any, list[int], list[Found]]] = [(expr, [0], [])]
    while True:
        node, index, parts = stack[-1]
        kids = children(node)
        if index[0] < len(kids):
            index[0] += 1
            stack.append((kids[index[0] - 1], [0], []))
            continue
        joined: Found = ({}, 0)
        if isinstance(node, dict) and isinstance(node.get("capture"), str) and "expr" in node:
            joined = ({node["capture"]: [node]}, 1)
        else:
            meets = isinstance(node, dict) and (isinstance(node.get("seq"), list) or isinstance(node.get("and"), list))
            for position, part in enumerate(parts):
                if position == 0:
                    joined = part
                    continue
                if meets:
                    # A capture marked as repeated is taken from its list,
                    # and the name stays with an empty list. So the name
                    # still meets later items, and no meeting above marks
                    # that capture again, which would cost each capture the
                    # depth of the expression.
                    if joined[1] <= part[1]:
                        repeated = [name for name in joined[0] if part[0].get(name)]
                    else:
                        repeated = [name for name, captures in part[0].items() if captures and name in joined[0]]
                    for name in repeated:
                        for capture in part[0][name]:
                            flagged[id(capture)] = capture
                        part[0][name] = []
                large, small = (joined, part) if joined[1] >= part[1] else (part, joined)
                for name, captures in small[0].items():
                    moved = large[0].setdefault(name, [])
                    # One step for each capture moved, not one extend, so
                    # that a test counts the captures and not the lists.
                    for capture in captures:
                        moved.append(capture)
                joined = (large[0], large[1] + small[1])
        stack.pop()
        if not stack:
            duplicates.extend(flagged.values())
            return duplicates
        stack[-1][2].append(joined)


class _Sequence:
    """One sequence of captures as capture_sequences builds it, with the
    set of its names and its key of names, so that extending it by a few
    captures costs those captures and not the whole sequence again."""

    __slots__ = ("captures", "names", "cached")

    def __init__(self, captures: list[Dom], names: set[str]) -> None:
        self.captures = captures
        self.names = names
        self.cached: tuple[str, ...] | None = None

    def key(self) -> tuple[str, ...]:
        if self.cached is None:
            self.cached = tuple(capture["capture"] for capture in self.captures)
        return self.cached

    def extend(self, captures: list[Dom]) -> None:
        if captures:
            self.captures.extend(captures)
            self.names.update(capture["capture"] for capture in captures)
            self.cached = None

    def copy(self) -> _Sequence:
        return _Sequence(list(self.captures), set(self.names))


def capture_sequences(expr: Any) -> tuple[list[list[Dom]], list[Dom]]:
    """The distinct sequences of captures that the productions of an
    expression read, each in the order read (engine §3.2, §3.5): a choice
    gives each branch's, an ``&`` each subsequence's, a plain optional none
    or its content's, and braces and an elidable optional none. Productions
    that read the same names in the same order are one sequence. The second
    list holds the capture nodes that some production reads after one of
    the same name, in no particular order. Gates do not matter, since they
    drop whole alternatives."""
    duplicates: dict[int, Dom] = {}

    def distinct(sequences: list[_Sequence]) -> list[_Sequence]:
        seen: set[tuple[str, ...]] = set()
        result: list[_Sequence] = []
        for sequence in sequences:
            key = sequence.key()
            if key not in seen:
                seen.add(key)
                result.append(sequence)
        return result

    def product(left: list[_Sequence], right: list[_Sequence], owned: bool) -> list[_Sequence]:
        """Each sequence of the left followed by each of the right. Where the
        right has one sequence, distinct lefts stay distinct, and a left that
        this product's caller ``owned`` is extended in place, since a copy of
        each would cost the sequence's whole length at every step."""
        for first in left:
            for second in right:
                for capture in second.captures:
                    if capture["capture"] in first.names:
                        duplicates[id(capture)] = capture
        if len(right) == 1:
            result = left if owned else [first.copy() for first in left]
            for first in result:
                first.extend(right[0].captures)
            return result
        joined: list[_Sequence] = []
        for first in left:
            for second in right:
                sequence = first.copy()
                sequence.extend(second.captures)
                joined.append(sequence)
        return distinct(joined)

    def visit(node: Any) -> Walk:
        if not isinstance(node, dict):
            return [_Sequence([], set())]
        if isinstance(node.get("capture"), str) and "expr" in node:
            return [_Sequence([node], {node["capture"]})]
        if isinstance(node.get("seq"), list):
            # The sequences built here are this loop's own, so the product
            # may extend them in place.
            sequences: list[_Sequence] = [_Sequence([], set())]
            for item in node["seq"]:
                sequences = product(sequences, (yield visit(item)), True)
            return sequences
        if isinstance(node.get("choice"), list):
            branches: list[_Sequence] = []
            for item in node["choice"]:
                branches.extend((yield visit(item)))
            return distinct(branches)
        if isinstance(node.get("and"), list):
            parts = []
            for item in node["and"]:
                parts.append((yield visit(item)))
            result: list[_Sequence] = []
            for mask in range(1, 1 << len(parts)):
                chosen: list[_Sequence] = [_Sequence([], set())]
                for index, part in enumerate(parts):
                    if mask >> index & 1:
                        chosen = product(chosen, part, True)
                result.extend(chosen)
            return distinct(result)
        if "optional" in node:
            if node.get("elidable") is True:
                return [_Sequence([], set())]
            return distinct([_Sequence([], set()), *(yield visit(node["optional"]))])
        return [_Sequence([], set())]

    sequences: list[_Sequence] = run(visit(expr))
    return [sequence.captures for sequence in sequences], list(duplicates.values())


def alternative_captures(alternative: Dom) -> list[dict[str, int]]:
    """The captures of each production of an alternative, each name with its
    place in the order that the production reads them, and ``$`` at -1
    (engine §3.5). Productions that read the same captures in the same order
    are one."""
    sequences, _ = capture_sequences(alternative["expr"])
    return [{WHOLE: -1, **{capture["capture"]: index for index, capture in enumerate(sequence)}} for sequence in sequences]


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
    return _applied(simplify_condition(condition, present), present)


def tests_no_presence(node: Any) -> bool:
    """Whether a clause tests the presence of no capture anywhere inside
    it, so that it simplifies the same for every production."""
    stack = [node]
    while stack:
        value = stack.pop()
        if isinstance(value, dict):
            if "captured" in value:
                return False
            stack.extend(value.values())
        elif isinstance(value, list):
            stack.extend(value)
    return True


def guard_of(part: Any) -> str | None:
    """The capture that a part ``$c ⟹ X`` tests, where X tests no presence,
    so that the part's value for a production depends on that capture
    alone. ``$`` is no guard, since every production has it."""
    if not isinstance(part, dict) or "if" not in part or "captured" in part:
        return None
    premise = part["if"]
    if not isinstance(premise, dict) or not isinstance(premise.get("captured"), str) or premise["captured"] == WHOLE:
        return None
    return premise["captured"] if tests_no_presence(part["then"]) else None


_UNSET: Any = object()
_NONE: frozenset[str] = frozenset()


class Prepared:
    """A clause prepared once for the productions of a definition, so that
    simplifying it for one production costs that production's captures and
    its output, not every part of the clause (engine §3.6).

    The parts are the items of a top-level union of a term or ∧ of a
    condition, the conditions of a list, or the clause alone. A part that
    tests no presence simplifies the same for every production, and a part
    ``$c ⟹ X`` simplifies to X's value or vanishes. Those values are kept,
    and the guarded parts are indexed by capture. Parts of any other shape
    are simplified for each production, as before."""

    __slots__ = ("join", "parts", "condition", "listed", "fixed", "values", "guards", "absent", "inner")

    def __init__(self, parts: list[Any], join: str | None, condition: bool, listed: bool) -> None:
        self.join = join
        self.parts = parts
        self.condition = condition
        # Whether the parts are the conditions of a list, each prepared in
        # turn when it is simplified for each production.
        self.listed = listed
        # The parts that every production keeps, in order: those that test
        # no presence and do not vanish from the join, and the others.
        self.fixed: list[int] = []
        # Each part's value where it is the same for every production that
        # keeps it.
        self.values: list[Any] = [_UNSET] * len(parts)
        # The guarded parts by capture, each list in order.
        self.guards: dict[str, list[int]] = {}
        # For a guarded clause alone, its value for a production without
        # the capture.
        self.absent: Any = _UNSET
        self.inner: dict[int, Prepared] = {}
        absent: Any = True if condition else EMPTY_SET
        for index, part in enumerate(parts):
            name = guard_of(part)
            if name is not None:
                value = _simplify(part["then"], _NONE, condition)
                self.values[index] = value
                self.absent = absent
                # A join drops a guarded part where its capture is absent,
                # and a part that it drops where its capture is present too
                # is never kept.
                if join is not None and self.vanishes(value):
                    continue
                self.guards.setdefault(name, []).append(index)
                continue
            if tests_no_presence(part):
                value = _simplify(part, _NONE, condition)
                self.values[index] = value
                if join is not None and self.vanishes(value):
                    continue
            self.fixed.append(index)

    def vanishes(self, value: Any) -> bool:
        """Whether the join drops a part's value: the empty set from a
        union, and true from a conjunction (engine §3.6)."""
        return is_empty_set(value) if self.join == "union" else value is True if self.join == "all" else False

    def kept(self, present: AbstractSet[str]) -> list[Any]:
        """The values of the parts that a production with the captures
        ``present`` keeps, in order, each simplified, without those that
        the join drops."""
        # The guarded parts this production keeps, found from whichever is
        # fewer, its captures or the captures that guard parts.
        kept: list[int] = []
        if len(present) <= len(self.guards):
            for name in present:
                found = self.guards.get(name)
                if found is not None:
                    kept.extend(found)
        else:
            for name, found in self.guards.items():
                if name in present:
                    kept.extend(found)
        kept.sort()
        items: list[Any] = []
        next_kept = 0
        for index in self.fixed:
            while next_kept < len(kept) and kept[next_kept] < index:
                self.keep(kept[next_kept], present, items)
                next_kept += 1
            self.keep(index, present, items)
        while next_kept < len(kept):
            self.keep(kept[next_kept], present, items)
            next_kept += 1
        return items

    def keep(self, index: int, present: AbstractSet[str], items: list[Any]) -> None:
        value = self.values[index]
        if value is _UNSET:
            if self.listed:
                inner = self.inner.get(index)
                if inner is None:
                    inner = self.inner[index] = prepare(self.parts[index], True)
                value = inner.simplified(present)
            else:
                value = _simplify(self.parts[index], present, self.condition)
        if not self.vanishes(value):
            items.append(value)

    def simplified(self, present: AbstractSet[str]) -> Any:
        """The clause simplified for a production with the captures
        ``present``, the same as :func:`simplify_term` or
        :func:`simplify_condition` gives."""
        if self.join is None:
            if self.fixed:
                value = self.values[0]
                return _simplify(self.parts[0], present, self.condition) if value is _UNSET else value
            # A guarded clause alone is its value or the value of its absence.
            (name,) = self.guards
            return self.values[0] if name in present else dict(self.absent) if isinstance(self.absent, dict) else self.absent
        items = self.kept(present)
        if self.join == "union":
            if not items:
                return dict(EMPTY_SET)
            return items[0] if len(items) == 1 else {"union": items}
        # ∧ is decided by a false part (engine §3.6).
        if any(item is False for item in items):
            return False
        if not items:
            return True
        return items[0] if len(items) == 1 else {"all": items}


def _simplify(dom: Any, present: AbstractSet[str], condition: bool) -> Any:
    return simplify_condition(dom, present) if condition else simplify_term(dom, present)


def prepare(clause: Any, condition: bool) -> Prepared:
    """A condition or a tag term prepared for the productions of its
    definition. The join that simplifying reads first decides, as it does
    there. An ∨ does not split, since a guarded part that its capture's
    absence makes true makes the whole ∨ true."""
    join: str | None = None
    if isinstance(clause, dict):
        if condition:
            if "captured" not in clause and "if" not in clause and "not" not in clause and isinstance(clause.get("all"), list):
                join = "all"
        elif "if" not in clause and isinstance(clause.get("union"), list):
            join = "union"
    parts = clause["all"] if join == "all" else clause["union"] if join == "union" else [clause]
    return Prepared(parts, join, condition, False)


def prepare_conditions(conditions: list[Dom]) -> Prepared:
    """A list of conditions prepared for the productions of its definition.
    A condition false for a production removes it, and one true is dropped,
    as the items of an ∧ are (engine §3.6)."""
    return Prepared(conditions, "all", True, True)


def applies_prepared(prepared: Prepared, present: AbstractSet[str]) -> Simplified | None:
    """What :func:`applies` gives, for a prepared condition."""
    return _applied(prepared.simplified(present), present)


def _applied(simplified: Simplified, present: AbstractSet[str]) -> Simplified | None:
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
    # A definition with no clause has nothing to check about its captures,
    # and its productions, whose number can be exponential, are not listed.
    if "tags" not in rule and not rule["conditions"] and "emit" not in rule and all("tags" not in alternative for alternative in alternatives):
        return None
    # Each production of each alternative, with the captures it reads
    # (engine §3.5, §9); productions that read the same captures in the same
    # order are one.
    productions = [(alternative, captures) for alternative in alternatives for captures in alternative_captures(alternative)]
    captured = [[name for name, _ in sorted(captures.items(), key=lambda pair: pair[1]) if name != WHOLE] for _, captures in productions]
    presents = [set(captures) for _, captures in productions]
    known = set().union(*presents)
    emit = rule.get("emit")
    items: list[Dom] = emit["items"] if emit is not None else []
    # A constituent that does not count is never an opaque part (engine §9).
    if rule.get("opaque") and emit is not None and not items:
        return f"{rule['name']} is opaque and emits ε"
    clauses: list[Any] = [rule.get("tags"), rule["conditions"], items]
    clauses.extend(alternative.get("tags") for alternative in alternatives)
    # An emission item mentions its attachments too.
    attached = {name for item in items if "capture" in item for name in attachments_of(item)}
    unknown = sorted(set().union(attached, *(mentioned_in(clause) for clause in clauses)) - known)
    if unknown:
        return f"${unknown[0]} is captured by no alternative of {rule['name']}"
    # The rule-level clauses depend only on a production's captures, which
    # many alternatives share, so each is checked once for each sequence of
    # captures and not once for each production.
    distinct: dict[tuple[str, ...], tuple[list[str], set[str]]] = {}
    for names, present in zip(captured, presents):
        distinct.setdefault(tuple(names), (names, present))
    # The distinct sequences that capture each name, so that a condition
    # whose parts are all guarded asks only those with a guard's capture.
    capturing: dict[str, list[set[str]]] = {}
    for names, present in distinct.values():
        for name in names:
            capturing.setdefault(name, []).append(present)
    for condition in rule["conditions"]:
        if waits(condition):
            continue
        prepared = prepare(condition, True)
        # A condition made only of guarded parts is true for a production
        # that has none of their captures, so only those that have one can
        # apply.
        if not prepared.fixed and (prepared.join == "all" or prepared.join is None and prepared.guards):
            candidates: Any = (present for name in prepared.guards for present in capturing.get(name, ()))
        else:
            candidates = (present for _, present in distinct.values())
        if all(applies_prepared(prepared, present) is None for present in candidates):
            return f"a condition of {rule['name']} applies to none of its productions"

    # Each term is prepared, and looked at for constants, once, though the
    # checks below ask again for each production.
    prepared_terms: dict[int, tuple[bool, Prepared]] = {}

    def lacks(term: Dom, present: set[str]) -> bool:
        known = prepared_terms.get(id(term))
        if known is None:
            known = prepared_terms[id(term)] = (waits(term), prepare(term, False))
        return not known[0] and not captures_in(known[1].simplified(present)) <= present

    rule_lacks: dict[tuple[str, ...], bool] = {}
    for (alternative, _), names, present in zip(productions, captured, presents):
        if "tags" in alternative and lacks(alternative["tags"], present):
            return "an alternative's tags use a capture that one of its productions lacks; guard the use with ⟹"
        if "tags" in rule:
            key = tuple(names)
            if key not in rule_lacks:
                rule_lacks[key] = lacks(rule["tags"], present)
            if rule_lacks[key]:
                return f"the %tags of {rule['name']} use a capture a production lacks; guard the use with ⟹"
    # The anchor of each inserted tag, the capture of the next capture
    # item, found for every item in one backward pass.
    anchors: list[str | None] = [None] * len(items)
    following: str | None = None
    for index in range(len(items) - 1, -1, -1):
        anchors[index] = following
        if "capture" in items[index]:
            following = items[index]["capture"]
    for names, present in distinct.values():
        kept = [item for item in items if "insert" in item or item["capture"] in present]
        if items and not kept:
            return f"%emits of {rule['name']} leaves a production nothing to emit"
        for item in kept:
            if "tags" in item and lacks(item["tags"], present):
                return "the tags of an item of %emits use a capture a production lacks; guard the use with ⟹"
        # A production without an item's carrier lacks its attachments too
        # (engine §9).
        for item in items:
            if "capture" not in item or item["capture"] in present:
                continue
            stray = next((name for name in attachments_of(item) if name in present), None)
            if stray is not None:
                return f"%emits of {rule['name']} attaches ${stray} in a production without its carrier ${item['capture']}"
        # The written order of the captures, attachments included, is the
        # order they stand in (engine §9).
        written = [name for item in kept if item.get("capture") for name in attachment_order(item)]
        place = {name: index for index, name in enumerate(names)}
        order = [place[name] for name in written if name in place]
        if order != sorted(order):
            return f"%emits of {rule['name']} lists captures out of the order they stand in the text"
        for index, item in enumerate(items):
            if "insert" not in item:
                continue
            anchor = anchors[index]
            if anchor is not None and anchor not in present:
                return f"an inserted tag of {rule['name']} stands before ${anchor}, which a production lacks"
    return None
