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
from copy import copy

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


def first_absent_recipe_capture(recipe: Dom, present: AbstractSet[str]) -> str | None:
    """Find the first absent capture in the recipe's written order."""
    for atom in recipe["concat"]:
        receiver = atom.get("receiver")
        while isinstance(receiver, dict) and "method" in receiver:
            receiver = receiver.get("receiver")
        if isinstance(receiver, dict):
            name = receiver.get("capture")
            if isinstance(name, str) and name not in present:
                return name
    return None


def mentions_in_order(dom: Any):
    """Capture mentions in written operand order, including presence tests."""
    stack = [dom]
    while stack:
        node = stack.pop()
        if isinstance(node, list):
            stack.extend(reversed(node))
            continue
        if not isinstance(node, dict):
            continue
        for key in ("capture", "captured"):
            if isinstance(node.get(key), str):
                yield node[key]
        if "pattern" in node:
            continue
        if "method" in node:
            children = [node["receiver"], *node["args"]]
        elif "op" in node:
            children = [node["left"], node["right"]]
        elif "if" in node:
            children = [node["if"], node["then"]]
        elif "not" in node:
            children = [node["not"]]
        else:
            children = next((node[key] for key in ("any", "all", "union", "intersection", "difference", "concat") if key in node), [])
        stack.extend(reversed(children))


def mentioned_in(dom: Any) -> set[str]:
    """The capture names a clause mentions, presence tests included."""
    return set(mentions_in_order(dom))


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
        if "optional" in node and (node.get("elidable") is not True or "capture" in node["optional"]):
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


def capture_sequences(expr: Any, braced: list[Any] | None = None) -> tuple[list[list[Dom]], list[Dom]]:
    """The distinct sequences of captures that the productions of an
    expression read, each in the order read (engine §3.2, §3.5): a choice
    gives each branch's, an ``&`` each subsequence's, a plain optional none
    or its content's, and braces and an elidable optional none. Productions
    that read the same names in the same order are one sequence. The second
    list holds the capture nodes that some production reads after one of
    the same name, in no particular order. Gates do not matter, since they
    drop whole alternatives. An expression that holds braces, which can
    hold item captures (engine §3.5), is added to ``braced`` where a list is
    given."""
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
        if isinstance(node.get("choice", node.get("ranked")), list):
            branches: list[_Sequence] = []
            for item in node.get("choice", node.get("ranked", [])):
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
            if node.get("elidable") is True and "capture" not in node["optional"]:
                return [_Sequence([], set())]
            return distinct([_Sequence([], set()), *(yield visit(node["optional"]))])
        if "repeat" in node and braced is not None and (not braced or braced[-1] is not expr):
            braced.append(expr)
        return [_Sequence([], set())]

    sequences: list[_Sequence] = run(visit(expr))
    return [sequence.captures for sequence in sequences], list(duplicates.values())


def _expression_children(node: Dom) -> list[Any]:
    """The expressions directly inside an expression node."""
    for key in ("seq", "choice", "ranked", "and"):
        if isinstance(node.get(key), list):
            return node[key]
    found = [node[key] for key in ("optional", "repeat", "separator", "expr") if key in node]
    return found


class ItemCapture:
    """Where an item capture stands (engine §3.5): the innermost flat braces
    around it, which the check of two pairs of braces compares, and the
    outermost flat braces around it, which the productions of the
    alternative read in its place. Each is the braces' DOM node, compared by
    identity."""

    __slots__ = ("braces", "outer")

    def __init__(self, braces: Dom, outer: Dom) -> None:
        self.braces = braces
        self.outer = outer


def item_captures(expr: Any) -> dict[str, ItemCapture]:
    """The item captures of an expression, each by its name: the captures
    inside flat braces, with the innermost and the outermost flat braces
    around each (engine §3.5). A chain holds no capture, which the reader
    makes sure of, so a capture inside a chain's own braces is not listed,
    while one inside flat braces inside a chain is. The first capture of a
    name in the order written decides where the name stands."""
    found: dict[str, ItemCapture] = {}
    # Each entry: a node, and the place of the flat braces around it.
    stack: list[tuple[Any, ItemCapture | None]] = [(expr, None)]
    while stack:
        node, place = stack.pop()
        if not isinstance(node, dict):
            continue
        if isinstance(node.get("capture"), str) and "expr" in node:
            if place is not None and node["capture"] not in found:
                found[node["capture"]] = place
            stack.append((node["expr"], place))
            continue
        if "repeat" in node:
            inner = place if "chain" in node else ItemCapture(node, place.outer if place is not None else node)
            if "separator" in node:
                stack.append((node["separator"], inner))
            stack.append((node["repeat"], inner))
            continue
        stack.extend((child, place) for child in reversed(_expression_children(node)))
    return found


def repeats_item_capture(expr: Any) -> bool:
    """Whether the name of an item capture stands more than once in an
    expression, inside its braces or outside them (engine §3.5, §9)."""
    items = item_captures(expr)
    if not items:
        return False
    seen: set[str] = set()
    stack: list[Any] = [expr]
    while stack:
        node = stack.pop()
        if not isinstance(node, dict):
            continue
        name = node.get("capture")
        if isinstance(name, str) and "expr" in node and name in items:
            if name in seen:
                return True
            seen.add(name)
        stack.extend(_expression_children(node))
    return False


def braces_sequences(expr: Any) -> list[list[Any]]:
    """The sequences of captures that the productions of an expression
    read, as :func:`capture_sequences` lists them, with each pair of flat
    braces that a production reads standing as its DOM node. A chain gives
    the sequences of its item, and of its separator followed by its item. The item
    captures inside the braces stay out, as in every production. The check
    of item conditions compares the place of the braces with the places of
    the captures a condition reads (engine §3.6)."""

    def visit(node: Any) -> Walk:
        if not isinstance(node, dict):
            return [[]]
        if isinstance(node.get("capture"), str) and "expr" in node:
            return [[node["capture"]]]
        if "repeat" in node:
            if "chain" not in node:
                return [[node]]
            # A chain holds no capture, but flat braces inside its item can
            # hold item captures. Its productions read an item, or a
            # separator and an item, beside the rule itself (engine §3.3).
            items = yield visit(node["repeat"])
            if "separator" not in node:
                return items
            separators = yield visit(node["separator"])
            return [*items, *(left + right for left in separators for right in items)]
        if isinstance(node.get("seq"), list):
            sequences: list[list[Any]] = [[]]
            for item in node["seq"]:
                following = yield visit(item)
                sequences = [left + right for left in sequences for right in following]
            return sequences
        if isinstance(node.get("choice", node.get("ranked")), list):
            branches: list[list[Any]] = []
            for item in node.get("choice", node.get("ranked", [])):
                branches.extend((yield visit(item)))
            return branches
        if isinstance(node.get("and"), list):
            parts = []
            for item in node["and"]:
                parts.append((yield visit(item)))
            result: list[list[Any]] = []
            for mask in range(1, 1 << len(parts)):
                chosen: list[list[Any]] = [[]]
                for index, part in enumerate(parts):
                    if mask >> index & 1:
                        chosen = [left + right for left in chosen for right in part]
                result.extend(chosen)
            return result
        if "optional" in node:
            if node.get("elidable") is True and "capture" not in node["optional"]:
                return [[]]
            return [[], *(yield visit(node["optional"]))]
        return [[]]

    return run(visit(expr))  # type: ignore[no-any-return]


def _index(sequence: list[Any], wanted: Any) -> int:
    """The place of a capture name, or of a braces node by identity, in a
    sequence of :func:`braces_sequences`, or -1."""
    for index, part in enumerate(sequence):
        if part is wanted if isinstance(wanted, dict) else part == wanted:
            return index
    return -1


def _brace_helper_sequences(braces: Dom) -> list[set[str]]:
    """The captures of each production of the helper of flat braces: each
    item, and each separator followed by an item (engine §3.2). The item
    captures of braces nested inside stay out, as in every production."""
    items, _ = capture_sequences(braces["repeat"])
    names = [{capture["capture"] for capture in sequence} for sequence in items]
    if "separator" not in braces:
        return names
    separators, _ = capture_sequences(braces["separator"])
    return names + [{capture["capture"] for capture in left} | right for left in separators for right in names]


def _item_capture_problem(rule: Dom, places: dict[int, dict[str, ItemCapture]], productions: list[tuple[Dom, set[str]]]) -> str | None:
    """Why the item captures of a definition cannot be read (engine §3.6,
    §9), or None. ``places`` gives the item captures of each alternative
    with braces, by the identity of its expression, and ``productions`` each
    production of each alternative with the captures it has, ``$`` among
    them. Only a condition reads
    an item capture. In each alternative whose item captures it reads, such
    a condition reads the item captures of one pair of braces, no ``$``, and
    no capture that a production binds after those braces. In the others it
    is an ordinary condition. Like any condition, it applies to some
    production."""
    alternatives = rule["alternatives"]
    item_names: set[str] = set().union(*places.values())
    emit = rule.get("emit")
    emitted: list[Dom] = emit["items"] if emit is not None else []
    named = [name for item in emitted if "capture" in item for name in attachment_order(item)]
    others: list[tuple[str, Any]] = [("a clause", rule.get(key)) for key in ("tags", "value", "image")]
    others.extend(("a clause", alternative.get(key)) for alternative in alternatives for key in ("tags", "value", "image"))
    others.extend(("%emits", item) for item in emitted)
    for kind, clause in others:
        if clause is None:
            continue
        mentioned = [*(named if kind == "%emits" else []), *sorted(mentioned_in(clause))]
        item = next((name for name in mentioned if name in item_names), None)
        if item is not None:
            return f"{kind} of {rule['name']} names ${item}, an item capture, which only a condition reads"
    sequences: dict[int, list[list[Any]]] = {}
    helpers: dict[int, list[set[str]]] = {}
    for condition in rule["conditions"]:
        mentioned = sorted(mentioned_in(condition))
        inside = [name for name in mentioned if name in item_names]
        if not inside:
            continue
        if WHOLE in mentioned:
            return f"a condition of {rule['name']} reads ${inside[0]}, an item capture, together with $, which is not complete at each item"
        prepared = None if waits(condition) else prepare(condition, True)
        applies = prepared is None
        for alternative in alternatives:
            place = places.get(id(alternative["expr"]), {})
            here = [name for name in inside if name in place]
            if not here:
                # The condition reads no item capture of this alternative,
                # so here it is an ordinary condition of its productions.
                if not applies:
                    applies = any(applies_prepared(prepared, present) is not None for owner, present in productions if owner is alternative)
                continue
            first = place[here[0]]
            other = next((name for name in here if place[name].braces is not first.braces), None)
            if other is not None:
                return f"a condition of {rule['name']} reads ${here[0]} and ${other}, item captures of two pairs of braces"
            outer = [name for name in mentioned if name not in place]
            listed = sequences.get(id(alternative))
            if listed is None:
                listed = sequences[id(alternative)] = braces_sequences(alternative["expr"])
            helper = helpers.get(id(first.braces))
            if helper is None:
                helper = helpers[id(first.braces)] = _brace_helper_sequences(first.braces)
            # The productions read the outermost braces in place of the item
            # capture, so a capture they read later is bound after the
            # braces.
            for sequence in listed:
                at = _index(sequence, first.outer)
                if at < 0:
                    continue
                late = next((name for name in outer if _index(sequence, name) > at), None)
                if late is not None:
                    return f"a condition of {rule['name']} reads ${late} with the item capture ${here[0]}, but a production binds ${late} after the braces"
                if applies:
                    continue
                # A helper production applies the condition with the
                # captures that the frame holds, those bound before the
                # braces (engine §4).
                before = {WHOLE, *(name for name in sequence[:at] if isinstance(name, str))}
                applies = any(applies_prepared(prepared, before | items) is not None for items in helper)
        if not applies:
            return f"a condition of {rule['name']} applies to no production"
    return None


def alternative_captures(alternative: Dom, braced: list[Dom] | None = None) -> list[dict[str, int]]:
    """The captures of each production of an alternative, each name with its
    place in the order that the production reads them, and ``$`` at -1
    (engine §3.5). Productions that read the same captures in the same order
    are one. The expression of an alternative that holds braces is added to
    ``braced``, where a list is given."""
    sequences, _ = capture_sequences(alternative["expr"], braced)
    return [{WHOLE: -1, **{capture["capture"]: index for index, capture in enumerate(sequence)}} for sequence in sequences]


def simplify_condition(condition: Dom, present: AbstractSet[str], absent: AbstractSet[str] | None = None) -> Simplified:
    """A condition simplified for a production that has the captures
    ``present`` (engine §3.6). If ``absent`` is supplied, other names
    retain their presence tests for partial assignments."""
    return run(_condition(condition, present, absent))[0]  # type: ignore[no-any-return]


def simplify_term(term: Dom, present: AbstractSet[str], absent: AbstractSet[str] | None = None) -> Dom:
    """A tag term simplified for a production that has the captures
    ``present``: a guarded term whose condition is false is the empty set
    (engine §3.6). If ``absent`` is supplied, other names stay unresolved."""
    return run(_term(term, present, absent))[0]  # type: ignore[no-any-return]


def _condition(dom: Dom, present: AbstractSet[str], absent: AbstractSet[str] | None = None, fixed=None) -> Walk:
    """Return the simplified value and its first unresolved presence test."""
    if fixed is not None and id(dom) in fixed:
        known = fixed[id(dom)]
        if known is None:
            known = yield _condition(dom, present, absent)
            fixed[id(dom)] = known
        return known
    if "captured" in dom:
        name = dom["captured"]
        if name == WHOLE or name in present:
            return True, None
        return (dom, name) if absent is not None and name not in absent else (False, None)
    if "if" in dom:
        premise, guard = yield _condition(dom["if"], present, absent, fixed)
        if premise is False:
            return True, None
        consequent, next_guard = yield _condition(dom["then"], present, absent, fixed)
        if premise is True or consequent is True:
            return consequent, next_guard
        if consequent is False:
            return {"not": premise}, guard
        value = dom if premise is dom["if"] and consequent is dom["then"] else {"if": premise, "then": consequent}
        return value, guard if guard is not None else next_guard
    if "not" in dom:
        inner, guard = yield _condition(dom["not"], present, absent, fixed)
        if isinstance(inner, bool):
            return not inner, None
        return (dom if inner is dom["not"] else {"not": inner}), guard
    if "all" in dom or "any" in dom:
        key = "all" if "all" in dom else "any"
        deciding = key == "any"
        parts, guard, unchanged = [], None, True
        for item in dom[key]:
            part, next_guard = yield _condition(item, present, absent, fixed)
            if part is deciding:
                return deciding, None
            if part is not (not deciding):
                parts.append(part)
                if guard is None:
                    guard = next_guard
            unchanged = unchanged and part is item
        if not parts:
            return not deciding, None
        if len(parts) == 1:
            return parts[0], guard
        return (dom if unchanged else {key: parts}), guard
    if "nonempty" in dom:
        term, guard = yield _term(dom["nonempty"], present, absent, fixed)
        # A set term that simplifies to the empty set is false (§3.6).
        if is_empty_set(term):
            return False, guard
        # A closed set term that is not empty is true (§3.6).
        closed = closed_set_value(term)
        if closed:
            return True, guard
        return (dom if term is dom["nonempty"] else {"nonempty": term}), guard
    if "op" in dom:
        left, guard = yield _term(dom["left"], present, absent, fixed)
        right, next_guard = yield _term(dom["right"], present, absent, fixed)
        value = dom if left is dom["left"] and right is dom["right"] else {"op": dom["op"], "left": left, "right": right}
        return value, guard if guard is not None else next_guard
    return dom, None


def guarded_clause_bare_empty_set(rule: Dom) -> bool:
    """Whether a bare empty set stands on the condition side of a guarded
    term in a tag clause of a rule (engine §10). DOM admission runs this
    once per rule, where check_definition can run several times."""
    clauses: list[Any] = [rule.get("tags"), rule.get("value"), rule.get("image"), rule.get("error"), rule.get("warning")]
    clauses.extend(alternative.get(channel) for alternative in rule["alternatives"] for channel in ("tags", "value", "image"))
    emit = rule.get("emit")
    if emit is not None:
        for item in emit["items"]:
            clauses.extend([item.get("tags"), item.get("value"), item.get("image")])
    return any(clause is not None and _guarded_bare_empty_set(clause) for clause in clauses)


def _guarded_bare_empty_set(term: Any) -> bool:
    """Whether a bare empty set stands on the condition side of a guarded
    term anywhere in a tag clause (engine §10). Only a guarded term holds
    a condition there, so other subtrees cannot hold the wrapper."""
    pending = [term]
    while pending:
        node = pending.pop()
        if isinstance(node, dict):
            if "if" in node and has_bare_empty_set(node["if"]):
                return True
            pending.extend(value for key, value in node.items() if key != "at")
        elif isinstance(node, list):
            pending.extend(node)
    return False


def has_bare_empty_set(condition: Any) -> bool:
    """Whether a bare empty set stands as the term of a set-as-condition
    anywhere in a condition (engine §10)."""
    pending = [condition]
    while pending:
        node = pending.pop()
        if isinstance(node, dict):
            inner = node.get("nonempty")
            if isinstance(inner, dict) and inner.get("emptySet") is True and len(inner) == 1:
                return True
            pending.extend(value for key, value in node.items() if key != "at")
        elif isinstance(node, list):
            pending.extend(node)
    return False


def closed_set_value(dom: Any) -> frozenset | None:
    """The value of a closed set term, or None where the term is not
    closed or its value is not fixed. A closed term is the term of §10,
    read as the template writes it."""
    if not isinstance(dom, dict):
        return None
    if dom.get("emptySet") is True and len(dom) == 1:
        return frozenset()
    if isinstance(dom.get("tag"), str) and len(dom) == 1:
        return frozenset((dom["tag"],))
    if isinstance(dom.get("string"), str) and len(dom) == 1:
        return frozenset((dom["string"],))
    if isinstance(dom.get("const"), str) and isinstance(dom.get("value"), frozenset):
        return dom["value"]
    for key in ("union", "intersection"):
        if isinstance(dom.get(key), list):
            result: frozenset | None = None
            for part in dom[key]:
                value = closed_set_value(part)
                if value is None:
                    return None
                result = value if result is None else (result | value if key == "union" else result & value)
            return result if result is not None else frozenset()
    if isinstance(dom.get("difference"), list) and len(dom["difference"]) == 2:
        left = closed_set_value(dom["difference"][0])
        right = closed_set_value(dom["difference"][1])
        if left is None or right is None:
            return None
        return left - right
    # `.split` and `.ngrams` on a closed string are closed (§10). Every
    # other method, `.classify` among them, keeps the term open.
    if dom.get("method") in ("split", "ngrams") and isinstance(dom.get("args"), list):
        from ._tags import ngrams, split_string
        receiver = closed_string_value(dom.get("receiver"))
        if receiver is None:
            return None
        if dom["method"] == "ngrams":
            arg = dom["args"][0] if len(dom["args"]) == 1 else None
            digits = arg.get("integer") if isinstance(arg, dict) else None
            if not isinstance(digits, str) or not digits.isdigit() or digits.startswith("0"):
                return None
            return ngrams(receiver, digits)
        if len(dom["args"]) != 1:
            return None
        delimiter = closed_string_value(dom["args"][0])
        if not delimiter:
            return None
        return frozenset(split_string(receiver, delimiter))
    return None


def closed_string_value(dom: Any) -> str | None:
    """The value of a closed string term, or None where the term is not
    a closed string (§10): a string, a string constant, or a
    concatenation of closed strings."""
    if not isinstance(dom, dict):
        return None
    if isinstance(dom.get("string"), str) and len(dom) == 1:
        return dom["string"]
    value = dom.get("value")
    if isinstance(dom.get("const"), str) and isinstance(value, dict) and isinstance(value.get("string"), str):
        return value["string"]
    if isinstance(dom.get("concat"), list):
        parts = [closed_string_value(part) for part in dom["concat"]]
        if any(part is None for part in parts):
            return None
        return "".join(parts)
    return None


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


def _term(dom: Any, present: AbstractSet[str], absent: AbstractSet[str] | None = None, fixed=None) -> Walk:
    """Reduce a term and retain its next unresolved presence test."""
    if fixed is not None and id(dom) in fixed:
        known = fixed[id(dom)]
        if known is None:
            known = yield _term(dom, present, absent)
            fixed[id(dom)] = known
        return known
    if not isinstance(dom, dict):
        return dom, None
    if "if" in dom:
        premise, guard = yield _condition(dom["if"], present, absent, fixed)
        if premise is False:
            return dict(EMPTY_SET), None
        then, next_guard = yield _term(dom["then"], present, absent, fixed)
        if is_empty_set(then):
            return then, None
        if premise is True:
            return then, next_guard
        value = dom if premise is dom["if"] and then is dom["then"] else {"if": premise, "then": then}
        return value, guard if guard is not None else next_guard
    if isinstance(dom.get("union"), list) or isinstance(dom.get("intersection"), list):
        key = "union" if "union" in dom else "intersection"
        parts, guard, unchanged = [], None, True
        for item in dom[key]:
            part, next_guard = yield _term(item, present, absent, fixed)
            if is_empty_set(part):
                if key == "intersection":
                    return part, None
                unchanged = False
            else:
                parts.append(part)
                if guard is None:
                    guard = next_guard
            unchanged = unchanged and part is item
        if key == "union":
            if not parts:
                return dict(EMPTY_SET), None
            if len(parts) == 1:
                return parts[0], guard
        return (dom if unchanged else {key: parts}), guard
    if isinstance(dom.get("difference"), list):
        left, guard = yield _term(dom["difference"][0], present, absent, fixed)
        if is_empty_set(left):
            return left, None
        right, next_guard = yield _term(dom["difference"][1], present, absent, fixed)
        if is_empty_set(right):
            return left, guard
        value = dom if left is dom["difference"][0] and right is dom["difference"][1] else {"difference": [left, right]}
        return value, guard if guard is not None else next_guard
    if isinstance(dom.get("args"), list):
        args, guard, unchanged = [], None, True
        if "receiver" in dom:
            receiver, guard = yield _term(dom["receiver"], present, absent, fixed)
            unchanged = receiver is dom["receiver"]
        for arg in dom["args"]:
            value, next_guard = yield _term(arg, present, absent, fixed)
            args.append(value)
            if guard is None:
                guard = next_guard
            unchanged = unchanged and value is arg
        if unchanged:
            return dom, guard
        return ({**dom, "receiver": receiver, "args": args} if "receiver" in dom else {**dom, "args": args}), guard
    return dom, None


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

    __slots__ = ("join", "parts", "condition", "listed", "fixed", "values", "guards", "required", "absent", "inner")

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
                # A join drops a guarded part where its capture is absent,
                # and a part that it drops where its capture is present too
                # is never kept. An ∨ is made true by the absence instead.
                if not condition and self.vanishes(value):
                    continue
                self.guards.setdefault(name, []).append(index)
                continue
            if tests_no_presence(part):
                value = _simplify(part, _NONE, condition)
                self.values[index] = value
                if not condition and self.vanishes(value):
                    continue
                if listed:
                    used = captures_in(value) - {WHOLE}
                    if used:
                        self.guards.setdefault(min(used), []).append(index)
                        continue
            self.fixed.append(index)

    def vanishes(self, value: Any) -> bool:
        """Whether the join drops a part's value (engine §3.6)."""
        if self.join == "union":
            return is_empty_set(value)
        if self.join == "all":
            return value is True
        return value is False if self.join == "any" else False

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
    from ._template_nodes import has_unresolved
    if has_unresolved(clause):
        return True
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
        if 'optional' in node and (not node.get('elidable') or 'capture' in node['optional']):
            out = {0: (0, None, 0)}
            for state, w in (yield visit(node['optional'])).items():
                pick(out, state, (w[0], w[1], (1, w[2])))
            return out
        if 'test' in node:
            return (yield visit(node['expr']))
        return {0: (0, None, None)}

    result = run(visit(expr)).get(3 if order else 0)
    if result is None or result[0] != len(required):
        return None
    return (*result, frozenset(_witness_flat(result[1])) | {WHOLE})


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
        elif 'optional' in node and (not node.get('elidable') or 'capture' in node['optional']):
            pending.append((node['optional'], True))
        elif 'test' in node:
            pending.append((node['expr'], variable))
    return False


def _independent_capture_choices(expr):
    branches, lists, seen = [expr], [], set()
    while branches:
        branch = branches.pop()
        if 'choice' in branch or 'ranked' in branch:
            branches.extend(reversed(branch.get('choice', branch.get('ranked'))))
            continue
        if 'test' in branch:
            branches.append(branch['expr'])
            continue
        if _variable_captures(branch):
            return None
        captures, pending = {WHOLE: -1}, [branch]
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
        key = tuple(captures)
        if key not in seen:
            seen.add(key)
            lists.append(captures)
    return lists


def _fixed_clause_parts(value):
    """Index fixed subtrees once, before partial assignments branch."""
    fixed, free = {}, {}
    pending = [(value, False)]
    while pending:
        node, ready = pending.pop()
        if not isinstance(node, (dict, list)) or id(node) in free:
            continue
        children = list(node.values()) if isinstance(node, dict) and 'pattern' not in node else node if isinstance(node, list) else []
        if not ready:
            pending.append((node, True))
            pending.extend((child, False) for child in children)
            continue
        stable = not (isinstance(node, dict) and node.get('captured', WHOLE) != WHOLE)
        stable = stable and all(free.get(id(child), True) for child in children)
        free[id(node)] = stable
        if stable and isinstance(node, dict):
            fixed[id(node)] = None
    return fixed


def validation_captures(rule, alternative):
    expr = alternative['expr']
    # A direct capture already fixes its complete capture list.
    if 'capture' in expr:
        return [{WHOLE: -1, expr['capture']: 0}]
    lists = _independent_capture_choices(expr)
    if lists is not None:
        return lists
    witnesses = []

    def ask(required=(), forbidden=(), order=()):
        w = _capture_witness(expr, required, forbidden, order)
        if w is not None:
            witnesses.append(w)

    initial = _capture_witness(expr)
    if initial is not None:
        witnesses.append(initial)
    items = rule.get('emit', {}).get('items', [])
    clauses = [rule.get('tags'), rule.get('value'), rule.get('image'), rule.get('error'), rule.get('warning'), *rule['conditions']]
    for item in items:
        clauses.extend(item.get(channel) for channel in ('tags', 'value', 'image'))
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
        if not condition and 'union' in value:
            for part in value['union']:
                clause(part, carrier=carrier)
            return

        fixed = _fixed_clause_parts(value)

        def branch(part, yes, no, witness):
            simple, guard = run(_condition(part, set(yes) | {WHOLE}, set(no), fixed) if condition
                                else _term(part, set(yes) | {WHOLE}, set(no), fixed))
            if simple is True:
                return

            def extend(required, forbidden):
                names = witness[3]
                if set(required) <= names and not (set(forbidden) & names):
                    return witness
                return _capture_witness(expr, required, forbidden)

            if guard is not None:
                without = extend(yes, [*no, guard])
                if without is not None:
                    branch(simple, yes, [*no, guard], without)
                with_guard = extend([*yes, guard], no)
                if with_guard is not None:
                    branch(simple, [*yes, guard], no, with_guard)
                return
            used = captures_in(simple)
            if condition:
                found = extend([*carrier, *yes, *used], no)
                if found is not None:
                    witnesses.append(found)
            else:
                for name in used:
                    found = extend([*carrier, *yes], [*no, name])
                    if found is not None:
                        witnesses.append(found)
        if initial is not None:
            branch(value, [], [], initial)

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


class DefinitionIssue:
    """A definition problem whose kind controls its validation phase."""
    def __init__(self, kind: str, message: str):
        self.kind, self.message = kind, message


class DefinitionCheck:
    def __init__(self):
        self.problem: DefinitionIssue | None = None
        self.deferred: DefinitionIssue | None = None


def check_definition(rule: Dom, defer_ranked: bool = False, held: Any = None) -> DefinitionCheck:
    result = DefinitionCheck()
    ranked: bool | None = None
    for issue in _definition_issues(rule, held):
        deferred_kind = defer_ranked and issue.kind in ("recipe-capture", "empty-emission")
        if deferred_kind and ranked is None:
            ranked = rule_has_ranked(rule)
        if deferred_kind and ranked:
            if result.deferred is None or result.deferred.kind == "empty-emission" and issue.kind == "recipe-capture":
                result.deferred = issue
        else:
            result.problem = issue
            break
    return result


def definition_problem(rule: Dom) -> str | None:
    issue = check_definition(rule).problem
    return issue.message if issue is not None else None


def _definition_issues(rule: Dom, held: Any = None):
    """Yield definition faults in their established validation order."""
    if rule.get("erased") and ("emit" in rule or any(channel in owner for owner in [rule, *rule["alternatives"]] for channel in ("value", "image"))):
        yield DefinitionIssue("independent", "an erased definition cannot carry a recipe or emission")
    alternatives = rule["alternatives"]
    # A definition with no clause has nothing to check about its captures,
    # and its productions, whose number can be exponential, are not listed.
    if not any(k in rule for k in ("tags", "value", "image", "error", "warning", "emit")) and not rule["conditions"] and all(not any(k in alternative for k in ("tags", "value", "image")) for alternative in alternatives):
        return
    # Each production of each alternative, with the captures it reads
    # (engine §3.5, §9); productions that read the same captures in the same
    # order are one.
    productions = [(alternative, captures) for alternative in alternatives for captures in validation_captures(rule, alternative)]
    captured = [[name for name, _ in sorted(captures.items(), key=lambda pair: pair[1]) if name != WHOLE] for _, captures in productions]
    presents = [set(captures) for _, captures in productions]
    known = set().union(*presents)
    emit = rule.get("emit")
    items: list[Dom] = emit["items"] if emit is not None else []
    places = {id(a["expr"]): found for a in alternatives if "capture" not in a["expr"] if (found := item_captures(a["expr"]))}
    item_places: set[str] = set().union(*places.values())
    clauses: list[Any] = [rule.get("tags"), rule.get("value"), rule.get("image"), rule.get("error"), rule.get("warning")]
    clauses.extend(alternative.get(channel) for alternative in alternatives for channel in ("tags", "value", "image"))
    clauses.extend(rule["conditions"])
    for item in items:
        clauses.extend([{"capture": item["capture"]} if "capture" in item else None,
                        item.get("tags"), item.get("value"), item.get("image")])
        clauses.extend({"capture": name} for name in attachments_of(item))
    for clause in clauses:
        for name in mentions_in_order(clause):
            if name not in known and name not in item_places:
                yield DefinitionIssue("independent", f"${name} is captured by no alternative of {rule['name']}")
    if places:
        problem = _item_capture_problem(rule, places, [(alternative, present) for (alternative, _), present in zip(productions, presents)])
        if problem is not None:
            yield DefinitionIssue("independent", problem)
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
    for condition_index, condition in enumerate(rule["conditions"]):
        if has_bare_empty_set(condition):
            yield DefinitionIssue("independent", f"a condition of {rule['name']} is the empty set")
            continue
        if waits(condition):
            continue
        # An item condition applies to the productions of its braces'
        # helper (engine §3.6), which are not listed here: the check of
        # item captures has made sure that it applies to some production.
        if item_places and not mentioned_in(condition).isdisjoint(item_places):
            continue
        prepared = prepare(condition, True)
        candidates: Any = (present for _, present in distinct.values())
        if not prepared.fixed and (prepared.join == "all" or prepared.join is None and prepared.guards):
            # A condition made only of guarded parts is true for a
            # production that has none of their captures, so only those
            # that have one can apply.
            candidates = (present for name in prepared.guards for present in capturing.get(name, ()))
        elif prepared.join == "any" and prepared.required:
            # An ∨ is true for a production that lacks one of its guards.
            candidates = iter(capturing.get(min(prepared.required), ()))
        elif prepared.join is None and prepared.values[0] is not _UNSET:
            # A condition the same for every production applies only to
            # those that have every capture it uses.
            used = captures_in(prepared.values[0]) - {WHOLE}
            if used:
                candidates = iter(capturing.get(min(used), ()))
        candidate_list = list(candidates)
        if all(applies_prepared(prepared, present) is None for present in candidate_list):
            # A condition that held a parameter as written is never
            # closed (engine §3.6), so in an instance it still applies
            # where it simplifies to true.
            if not (held is not None and condition_index < len(held) and held[condition_index]
                    and any(prepared.simplified(present) is True for present in candidate_list)):
                yield DefinitionIssue("independent", f"a condition of {rule['name']} applies to none of its productions")

    # Each term is prepared, and looked at for constants, once, though the
    # checks below ask again for each production.
    prepared_terms: dict[int, tuple[bool, Prepared]] = {}

    def missing(term: Dom, present: set[str]) -> str | None:
        known = prepared_terms.get(id(term))
        if known is None:
            known = prepared_terms[id(term)] = (waits(term), prepare(term, False))
        if known[0]:
            return None
        simple = known[1].simplified(present)
        used = captures_in(simple)
        if used <= present:
            return None
        return next(name for name in mentions_in_order(simple) if name in used and name not in present)

    def tag_issue(name: str) -> DefinitionIssue:
        return DefinitionIssue("independent", f"a tag term of {rule['name']} uses ${name}, which a production lacks; guard it with ${name} ⟹")

    from ._guarded_tags import guards as tag_guards, variants as tag_variants
    guarded_terms = {id(term) for term in [rule.get("tags"), *(a.get("tags") for a in alternatives)]
                     if term is not None and tag_guards(term)}
    rule_missing: dict[tuple[str, ...], str | None] = {}
    # The anchor of each inserted tag is its next covering capture item.
    anchors: list[str | None] = [None] * len(items)
    following: str | None = None
    for index in range(len(items) - 1, -1, -1):
        anchors[index] = following
        if "capture" in items[index]:
            following = items[index]["capture"]
    emission = Emission(items) if items else None
    checked_emissions: set[tuple[str, ...]] = set()
    for (alternative, _), names, present in zip(productions, captured, presents):
        key = tuple(names)
        if "tags" in rule:
            if key not in rule_missing:
                rule_missing[key] = missing(rule["tags"], present)
            absent = rule_missing[key]
            if absent is not None:
                yield tag_issue(absent)
        if "tags" in alternative:
            absent = missing(alternative["tags"], present)
            if absent is not None:
                yield tag_issue(absent)
        effective_tags = [term for term in (rule.get("tags"), alternative.get("tags")) if term is not None]
        if any(id(term) in guarded_terms for term in effective_tags) and not any(waits(term) for term in effective_tags):
            terms = [prepared_terms[id(term)][1].simplified(present) for term in effective_tags]
            try:
                tag_variants(terms[0] if len(terms) == 1 else {"union": terms})
            except ValueError as error:
                yield DefinitionIssue("independent", str(error))
        value = alternative.get("value", rule.get("value"))
        image = alternative.get("image", rule.get("image", value))
        for recipe in (value, image, rule.get("error"), rule.get("warning")):
            if recipe is None:
                continue
            absent = first_absent_recipe_capture(recipe, present)
            if absent is not None:
                yield DefinitionIssue("recipe-capture", f"a selected recipe reads an absent capture ${absent}")
        if emission is None or key in checked_emissions:
            continue
        checked_emissions.add(key)
        kept = [items[index] for index in emission.kept(present)]
        if not kept:
            yield DefinitionIssue("empty-emission", f"%emits of {rule['name']} leaves a production nothing to emit")
        # A production without an item's carrier lacks its attachments too.
        stray = emission.stray(present)
        if stray is not None:
            yield DefinitionIssue("independent", f"%emits of {rule['name']} attaches ${stray[1]} in a production without its carrier ${items[stray[0]]['capture']}")
        written = [name for item in kept if item.get("capture") for name in attachment_order(item)]
        place = {name: index for index, name in enumerate(names)}
        order = [place[name] for name in written if name in place]
        if order != sorted(order):
            yield DefinitionIssue("independent", f"%emits of {rule['name']} lists captures out of the order they stand in the text")
        for item in kept:
            for channel in ("value", "image"):
                if channel not in item:
                    continue
                absent = first_absent_recipe_capture(item[channel], present)
                if absent is not None:
                    yield DefinitionIssue("recipe-capture", f"an item recipe of {rule['name']} uses absent capture ${absent}")
            if "tags" in item:
                absent = missing(item["tags"], present)
                if absent is not None:
                    yield tag_issue(absent)
    if emission is not None:
        for index in emission.inserts:
            anchor = anchors[index]
            if anchor is not None and any(anchor not in present for _, present in distinct.values()):
                yield DefinitionIssue("independent", f"an inserted tag of {rule['name']} stands before ${anchor}, which a production lacks")
    return


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
