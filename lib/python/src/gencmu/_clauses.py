"""A rule's clauses as they apply to one production (engine §3.6), and the
checks a definition is held to as a whole (engine §9).

Whether a production has a capture is known when the grammar is read, so a
clause is simplified for each production before it is attached: presence
tests become true or false, and the connectives over them are reduced. The
reader, the check of a preparsed DOM and lowering all simplify the same
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
        for key in ("seq", "choice", "ranked", "and"):
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
        if "receiver" in dom:
            return {**dom, "receiver": (yield _term(dom["receiver"], present)), "args": args}
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

    The parts are the items of a top-level union of a term, ∧ or ∨ of a
    condition, the conditions of a list, or the clause alone. A part that
    tests no presence simplifies the same for every production, and a part
    ``$c ⟹ X`` simplifies to X's value or vanishes. Those values are kept,
    and the guarded parts are indexed by capture. In a list, a condition
    that tests no presence but uses captures is indexed by the first of
    them, since a production without it drops the condition. Parts of any
    other shape are simplified for each production, as before."""

    __slots__ = ("join", "parts", "condition", "listed", "fixed", "values", "guards", "required", "decided", "absent", "inner")

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
        # The indexed parts by capture, each list in order. A production
        # keeps those under the captures it has.
        self.guards: dict[str, list[int]] = {}
        # For an ∨, the captures of its guarded parts. A production that
        # lacks one of them makes that part true, and so the whole ∨.
        self.required: set[str] = set()
        # The value of the whole for every production, where a part that
        # tests no presence decides it: false for an ∧, true for an ∨.
        self.decided: Any = _UNSET
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
                if join == "any":
                    self.required.add(name)
                    # True whether the capture is there or not.
                    if value is True:
                        self.decided = True
                # A join drops a guarded part where its capture is absent,
                # and a part that it drops where its capture is present too
                # is never kept. An ∨ is made true by the absence instead.
                if join is not None and self.vanishes(value):
                    continue
                self.guards.setdefault(name, []).append(index)
                continue
            if tests_no_presence(part):
                value = _simplify(part, _NONE, condition)
                self.values[index] = value
                if join is not None:
                    if self.decides(value) and self.decided is _UNSET:
                        self.decided = value
                    if self.vanishes(value):
                        continue
                if listed and not isinstance(value, bool):
                    used = captures_in(value) - {WHOLE}
                    if used:
                        self.guards.setdefault(min(used), []).append(index)
                        continue
            self.fixed.append(index)

    def vanishes(self, value: Any) -> bool:
        """Whether the join drops a part's value: the empty set from a
        union, true from a conjunction and false from a disjunction
        (engine §3.6)."""
        if self.join == "union":
            return is_empty_set(value)
        if self.join == "all":
            return value is True
        return value is False if self.join == "any" else False

    def decides(self, value: Any) -> bool:
        """Whether a part's value decides the join: false decides an ∧, and
        true decides an ∨."""
        return value is False if self.join == "all" else value is True if self.join == "any" else False

    def has_required(self, present: AbstractSet[str]) -> bool:
        """Whether a production has every capture that guards a part of an
        ∨, read from the fewer of the two."""
        if len(present) < len(self.required):
            return False
        return all(name in present for name in self.required)

    def kept(self, present: AbstractSet[str]) -> list[Any]:
        """The values of the parts that a production with the captures
        ``present`` keeps, in order, each simplified, without those that
        the join drops."""
        if self.decided is False:
            return [False]
        # The indexed parts this production keeps, found from whichever is
        # fewer, its captures or the captures that index parts.
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
        if self.decided is not _UNSET:
            return self.decided
        if self.join == "any" and self.required and not self.has_required(present):
            return True
        items = self.kept(present)
        if self.join == "union":
            if not items:
                return dict(EMPTY_SET)
            return items[0] if len(items) == 1 else {"union": items}
        # ∧ is decided by a false part, ∨ by a true one (engine §3.6).
        deciding = self.join == "any"
        if any(item is deciding for item in items):
            return deciding
        if not items:
            return not deciding
        return items[0] if len(items) == 1 else {self.join: items}


def _simplify(dom: Any, present: AbstractSet[str], condition: bool) -> Any:
    return simplify_condition(dom, present) if condition else simplify_term(dom, present)


def prepare(clause: Any, condition: bool) -> Prepared:
    """A condition or a tag term prepared for the productions of its
    definition. The join that simplifying reads first decides, as it does
    there."""
    join: str | None = None
    if isinstance(clause, dict):
        if condition:
            if "captured" not in clause and "if" not in clause and "not" not in clause:
                if isinstance(clause.get("all"), list):
                    join = "all"
                elif "all" not in clause and isinstance(clause.get("any"), list):
                    join = "any"
        elif "if" not in clause and isinstance(clause.get("union"), list):
            join = "union"
    parts = clause[join] if join is not None else [clause]
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


class Emission:
    """The items of an %emits, indexed so that a production finds the items
    it keeps and the attachments it holds without a scan of every item
    (engine §3.6, §9). Inserted tags and the items of ``$`` are kept by
    every production, and the others by the productions with their
    carrier."""

    __slots__ = ("fixed", "inserts", "carried", "attached", "items")

    def __init__(self, items: list[Dom]) -> None:
        self.items = items
        self.fixed: list[int] = []
        self.inserts: list[int] = []
        # The capture items by carrier, and by each attachment, in order.
        self.carried: dict[str, list[int]] = {}
        self.attached: dict[str, list[int]] = {}
        for index, item in enumerate(items):
            if "insert" in item:
                self.fixed.append(index)
                self.inserts.append(index)
                continue
            if item["capture"] == WHOLE:
                self.fixed.append(index)
            else:
                self.carried.setdefault(item["capture"], []).append(index)
            for name in attachments_of(item):
                self.attached.setdefault(name, []).append(index)

    @staticmethod
    def found(index: dict[str, list[int]], present: AbstractSet[str]) -> list[int]:
        """The entries of an index under the captures a production has,
        read from the fewer of the two, in no order."""
        found: list[int] = []
        if len(present) <= len(index):
            for name in present:
                found.extend(index.get(name, ()))
        else:
            for name, entries in index.items():
                if name in present:
                    found.extend(entries)
        return found

    def kept(self, present: AbstractSet[str]) -> list[int]:
        """The items a production keeps, in list order."""
        carried = self.found(self.carried, present)
        if not carried:
            return self.fixed
        carried.sort()
        kept: list[int] = []
        next_carried = 0
        for index in self.fixed:
            while next_carried < len(carried) and carried[next_carried] < index:
                kept.append(carried[next_carried])
                next_carried += 1
            kept.append(index)
        kept.extend(carried[next_carried:])
        return kept

    def stray(self, present: AbstractSet[str]) -> tuple[int, str] | None:
        """The first item whose carrier a production lacks but which
        attaches a capture it has, with the first such attachment, or
        None."""
        first: int | None = None
        for index in self.found(self.attached, present):
            if self.items[index]["capture"] not in present and (first is None or index < first):
                first = index
        if first is None:
            return None
        return first, next(name for name in attachments_of(self.items[first]) if name in present)


def _witness_flat(tree):
    out, pending = [], [tree]
    while pending:
        part = pending.pop()
        if isinstance(part, tuple):
            pending.extend((part[1], part[0]))
        elif part is not None:
            out.append(part)
    return out


def _witness_key_less(left, right):
    x, y = [left], [right]
    while x and y:
        a, b = x[-1], y[-1]
        if a is None:
            x.pop()
        elif b is None:
            y.pop()
        elif a is b or not isinstance(a, tuple) and not isinstance(b, tuple) and a == b:
            x.pop()
            y.pop()
        elif isinstance(a, tuple):
            x.pop()
            x.extend((a[1], a[0]))
        elif isinstance(b, tuple):
            y.pop()
            y.extend((b[1], b[0]))
        else:
            return a < b
    return not any(p is not None for p in x) and any(p is not None for p in y)


def _capture_witness(expr, required=(), forbidden=(), order=()):
    required, forbidden = set(required) - {WHOLE}, set(forbidden)
    if WHOLE in forbidden or required & forbidden:
        return None

    def pick(into, state, candidate):
        old = into.get(state)
        if old is None or candidate[0] > old[0] or candidate[0] == old[0] and _witness_key_less(candidate[2], old[2]):
            into[state] = candidate

    def join(left, right):
        out = {}
        for a, x in left.items():
            for b, y in right.items():
                if a & b or a & 2 and b & 1:
                    continue
                pick(out, a | b, (x[0] + y[0], (x[1], y[1]), (x[2], y[2])))
        return out

    def visit(node):
        if 'capture' in node:
            name = node['capture']
            state = 1 if order and name == order[0] else 2 if order and name == order[1] else 0
            return {} if name in forbidden else {state: (int(name in required), name, None)}
        children = next((node[k] for k in ('seq', 'choice', 'ranked', 'and') if k in node), None)
        if children is not None:
            all_parts = {0: (0, None, None)}
            if 'choice' in node or 'ranked' in node:
                all_parts = {}
                for i, child in enumerate(children):
                    for state, w in (yield visit(child)).items():
                        pick(all_parts, state, (w[0], w[1], (i, w[2])))
            elif 'and' in node:
                all_parts = {}
                for i, child in enumerate(children):
                    part = yield visit(child)
                    next_parts = dict(all_parts)
                    for state, w in part.items():
                        pick(next_parts, state, (w[0], w[1], (1 << i, w[2])))
                    for a, x in all_parts.items():
                        for b, y in part.items():
                            if a & b or a & 2 and b & 1:
                                continue
                            pick(next_parts, a | b, (x[0] + y[0], (x[1], y[1]), (x[2][0] | 1 << i, (x[2][1], y[2]))))
                    all_parts = next_parts
            else:
                for child in children:
                    all_parts = join(all_parts, (yield visit(child)))
            return all_parts
        if 'optional' in node and not node.get('elidable'):
            out = {0: (0, None, 0)}
            for state, w in (yield visit(node['optional'])).items():
                pick(out, state, (w[0], w[1], (1, w[2])))
            return out
        if 'test' in node:
            return (yield visit(node['expr']))
        return {0: (0, None, None)}

    result = run(visit(expr)).get(3 if order else 0)
    return result if result is not None and result[0] == len(required) else None


def _variable_captures(expr):
    # A capture varies only below an optional or a branching choice or &.
    # Its content does not change the presence of the capture itself.
    pending = [(expr, False)]
    while pending:
        node, variable = pending.pop()
        if 'capture' in node:
            if variable:
                return True
            continue
        children = next((node[k] for k in ('seq', 'choice', 'ranked', 'and') if k in node), None)
        if children is not None:
            variable = variable or len(children) > 1 and any(k in node for k in ('choice', 'ranked', 'and'))
            pending.extend((child, variable) for child in reversed(children))
        elif 'optional' in node and not node.get('elidable'):
            pending.append((node['optional'], True))
        elif 'test' in node:
            pending.append((node['expr'], variable))
    return False


def validation_captures(rule, alternative):
    expr = alternative['expr']
    if not _variable_captures(expr):
        captures, pending = {WHOLE: -1}, [expr]
        while pending:
            node = pending.pop()
            if 'capture' in node:
                captures[node['capture']] = len(captures) - 1
            elif 'seq' in node:
                pending.extend(reversed(node['seq']))
            elif any(k in node for k in ('choice', 'ranked', 'and')):
                pending.append(next(node[k][0] for k in ('choice', 'ranked', 'and') if k in node))
            elif 'test' in node:
                pending.append(node['expr'])
        return [captures]
    witnesses = []

    def ask(required=(), forbidden=(), order=()):
        w = _capture_witness(expr, required, forbidden, order)
        if w is not None:
            witnesses.append(w)

    ask()
    items = rule.get('emit', {}).get('items', [])
    clauses = [rule.get('tags'), rule.get('value'), rule.get('image'), *rule['conditions'], *items]
    clauses.extend(a.get(k) for a in rule['alternatives'] for k in ('tags', 'value', 'image'))
    for value in clauses:
        for name in mentioned_in(value):
            ask([name])
    for item in items:
        if 'capture' in item:
            for name in attachment_order(item):
                ask([name])

    def clause(value, condition=False, carrier=()):
        if value is None or waits(value):
            return
        # A capture can be both tested for presence and read as a value.
        pending = [value]
        guards = set()
        while pending:
            n = pending.pop()
            if isinstance(n, dict) and 'pattern' not in n:
                if 'captured' in n and n['captured'] != WHOLE:
                    guards.add(n['captured'])
                pending.extend(n.values())
            elif isinstance(n, list):
                pending.extend(n)
        guards = sorted(guards)

        def branch(i, yes, no):
            if i < len(guards):
                branch(i + 1, yes, no + [guards[i]])
                branch(i + 1, yes + [guards[i]], no)
                return
            simple = simplify_condition(value, set(yes) | {WHOLE}) if condition else simplify_term(value, set(yes) | {WHOLE})
            used = captures_in(simple)
            if condition:
                if simple is not True:
                    ask([*carrier, *yes, *used], no)
            else:
                for name in used:
                    ask([*carrier, *yes], [*no, name])
        branch(0, [], [])

    for value in rule['conditions']:
        clause(value, True)
    for value in (rule.get('tags'), alternative.get('tags')):
        clause(value)
    value = alternative.get('value', rule.get('value'))
    for recipe in (value, alternative.get('image', rule.get('image', value))):
        for name in captures_in(recipe):
            ask(forbidden=[name])
    if items and not any('insert' in i or i.get('capture') == WHOLE for i in items):
        ask(forbidden=[i['capture'] for i in items])
    written = []
    for item in items:
        carrier = [item['capture']] if 'capture' in item else []
        if carrier:
            for name in attachments_of(item):
                ask([name], carrier)
            ask(forbidden=carrier)
        for channel in ('value', 'image'):
            for name in captures_in(item.get(channel)):
                ask(carrier, [name])
        clause(item.get('tags'), carrier=carrier)
        if item.get('capture'):
            written.extend((name, item['capture']) for name in attachment_order(item))
    for i, (a, ac) in enumerate(written):
        for b, bc in written[i + 1:]:
            if a != b:
                ask([a, ac, b, bc], order=[b, a])
    witnesses.sort(key=lambda w: _witness_flat(w[2]))
    found, out = set(), []
    for w in witnesses:
        names = tuple(_witness_flat(w[1]))
        if names not in found:
            found.add(names)
            out.append({WHOLE: -1, **{name: i for i, name in enumerate(names)}})
    return out


def definition_problem(rule: Dom) -> str | None:
    """Why a definition, a well-formed rule of a DOM with its clauses, is an
    error of its document as a whole (engine §9), or None. The checks that
    simplification decides skip a clause that holds a constant without its
    value."""
    if rule.get("erased") and ("emit" in rule or any(channel in owner for owner in [rule, *rule["alternatives"]] for channel in ("value", "image"))):
        return "an erased definition cannot carry a recipe or emission"
    alternatives = rule["alternatives"]
    # A definition with no clause has nothing to check about its captures,
    # and its productions, whose number can be exponential, are not listed.
    if not any(k in rule for k in ("tags", "value", "image", "emit")) and not rule["conditions"] and all(not any(k in alternative for k in ("tags", "value", "image")) for alternative in alternatives):
        return None
    # Each production of each alternative, with the captures it reads
    # (engine §3.5, §9); productions that read the same captures in the same
    # order are one.
    productions = [(alternative, captures) for alternative in alternatives for captures in validation_captures(rule, alternative)]
    captured = [[name for name, _ in sorted(captures.items(), key=lambda pair: pair[1]) if name != WHOLE] for _, captures in productions]
    presents = [set(captures) for _, captures in productions]
    known = set().union(*presents)
    emit = rule.get("emit")
    items: list[Dom] = emit["items"] if emit is not None else []
    clauses: list[Any] = [rule.get("tags"), rule["conditions"], items]
    clauses.extend(alternative.get("tags") for alternative in alternatives)
    clauses.extend(owner.get(channel) for owner in [rule, *alternatives] for channel in ("value", "image"))
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
        candidates: Any = (present for _, present in distinct.values())
        if prepared.decided is not _UNSET:
            pass
        elif not prepared.fixed and (prepared.join == "all" or prepared.join is None and prepared.guards):
            # A condition made only of guarded parts is true for a
            # production that has none of their captures, so only those
            # that have one can apply.
            candidates = (present for name in prepared.guards for present in capturing.get(name, ()))
        elif prepared.join == "any" and prepared.required:
            # An ∨ is true for a production that lacks one of its guards.
            candidates = iter(capturing.get(min(prepared.required), ()))
        elif prepared.join is None and prepared.values[0] is not _UNSET and not isinstance(prepared.values[0], bool):
            # A condition the same for every production applies only to
            # those that have every capture it uses.
            used = captures_in(prepared.values[0]) - {WHOLE}
            if used:
                candidates = iter(capturing.get(min(used), ()))
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
    for (alternative, _), present in zip(productions, presents):
        value = alternative.get("value", rule.get("value"))
        image = alternative.get("image", rule.get("image", value))
        for recipe in (value, image):
            if recipe is None:
                continue
            if not captures_in(recipe) <= present:
                return "a selected recipe uses a capture that its production lacks"
    # The anchor of each inserted tag, the capture of the next capture
    # item, found for every item in one backward pass.
    anchors: list[str | None] = [None] * len(items)
    following: str | None = None
    for index in range(len(items) - 1, -1, -1):
        anchors[index] = following
        if "capture" in items[index]:
            following = items[index]["capture"]
    emission = Emission(items)
    for names, present in distinct.values():
        kept = [items[index] for index in emission.kept(present)]
        if items and not kept:
            return f"%emits of {rule['name']} leaves a production nothing to emit"
        for item in kept:
            for channel in ("value", "image"):
                if channel not in item:
                    continue
                if not captures_in(item[channel]) <= present:
                    return "an item recipe uses a capture that its production lacks"
            if "tags" in item and lacks(item["tags"], present):
                return "the tags of an item of %emits use a capture a production lacks; guard the use with ⟹"
        # A production without an item's carrier lacks its attachments too
        # (engine §9).
        stray = emission.stray(present)
        if stray is not None:
            return f"%emits of {rule['name']} attaches ${stray[1]} in a production without its carrier ${items[stray[0]]['capture']}"
        # The written order of the captures, attachments included, is the
        # order they stand in (engine §9).
        written = [name for item in kept if item.get("capture") for name in attachment_order(item)]
        place = {name: index for index, name in enumerate(names)}
        order = [place[name] for name in written if name in place]
        if order != sorted(order):
            return f"%emits of {rule['name']} lists captures out of the order they stand in the text"
        for index in emission.inserts:
            anchor = anchors[index]
            if anchor is not None and anchor not in present:
                return f"an inserted tag of {rule['name']} stands before ${anchor}, which a production lacks"
    return None


def rule_has_ranked(rule: Dom) -> bool:
    pending = [a['expr'] for a in rule['alternatives']]
    while pending:
        value = pending.pop()
        if isinstance(value,dict):
            if 'ranked' in value:
                return True
            pending.extend(value.values())
        elif isinstance(value,list):
            pending.extend(value)
    return False


def deferred_emission_problem(message):
    return any(part in message for part in (
        "leaves a production nothing to emit",
        "a selected recipe uses a capture that its production lacks",
        "an item recipe uses a capture that its production lacks",
    ))
