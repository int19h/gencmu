"""The shape of a grammar DOM (docs/output.md, "A grammar DOM").

A DOM that was not read from a document here, the bootstrap's or a
precompiled one from compiled.json, is held to every rule the reader holds a
document to (engine §9), so that a corrupt or hand-made one is refused, or
read afresh, rather than changing a result or failing inside a parse. The
same walk bounds the nesting of a document that was read (engine §9).
"""

from __future__ import annotations

import re
from typing import Any

from ._clauses import definition_problem

FORMAT = 5
"""The version of the DOM's shape (docs/output.md)."""

MAX_DEPTH = 256
"""No node of an expression, a term or a condition may lie below more than
this many compound nodes of it (engine §9). A node's depth here is the
number of compound nodes above it, since only compound nodes have children:
optional, repeat, and, choice, seq and capture; union, intersection, if and
call; any, all, not, if, matches and a comparison."""

TOO_DEEP = "nested too deeply"

_FUNCTIONS = {"phonemes", "text", "lowercase", "tags", "classes", "words", "head", "tail", "last", "matches"}
_COMPARATORS = {"=", "≠", "∈", "∉", "⊆"}
_SPANS = {"head", "tail", "last"}
_NAME = re.compile(r"[A-Za-z][A-Za-z0-9-]*")
_WHOLE = ""
"""The capture name of ``$``, the whole constituent (engine §3.5)."""


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_position(value: Any) -> bool:
    return isinstance(value, list) and len(value) == 2 and all(_is_int(x) for x in value)


def _is_one_of(value: Any, names: set[str]) -> bool:
    """Whether a value is one of some strings; any other value, a list or an
    object included, is not, and raises nothing."""
    return isinstance(value, str) and value in names


def _is_span(value: Any) -> bool:
    """A capture, or head, tail or last of one."""
    return isinstance(value, dict) and (isinstance(value.get("capture"), str) or _is_one_of(value.get("call"), _SPANS))


def _is_string(value: Any) -> bool:
    """A literal, or phonemes, text or lowercase of something."""
    return isinstance(value, dict) and (
        isinstance(value.get("literal"), str) or _is_one_of(value.get("call"), {"phonemes", "text", "lowercase"})
    )


def _is_guard(value: Any) -> bool:
    """A gate, negated or not, or a warning, which never is (engine §9)."""
    return (
        isinstance(value, dict)
        and isinstance(value.get("feature"), str)
        and isinstance(value.get("negated"), bool)
        and (value.get("kind") == "gate" or (value.get("kind") == "warning" and value["negated"] is False))
    )


def _is_rule_name(value: Any) -> bool:
    return isinstance(value, dict) and isinstance(value.get("rule"), str) and len(value) == 1


def _items(value: Any, least: int, most: float = float("inf")) -> bool:
    return isinstance(value, list) and least <= len(value) <= most


def _is_whole(value: Any) -> bool:
    """Whether a span is ``$``, the whole constituent."""
    return isinstance(value, dict) and value.get("capture") == _WHOLE


def reads_own_tags(term: Any, argument: bool = False) -> bool:
    """Whether one node of a rule's or an alternative's tag term reads the
    tags that term defines: ``$`` as a value, ``tags($)`` or ``classes($)``
    (engine §9). The caller walks the term; ``argument`` says the node is an
    argument of a call, where ``$`` is a span."""
    if not isinstance(term, dict):
        return False
    if not argument and _is_whole(term) and "expr" not in term:
        return True
    args = term.get("args")
    return (
        _is_one_of(term.get("call"), {"tags", "classes"})
        and isinstance(args, list)
        and len(args) == 1
        and _is_whole(args[0])
    )


def term_reads_own_tags(term: Any) -> bool:
    """Whether a well-formed tag term reads the tags it defines anywhere,
    the conditions of its guarded terms included."""
    stack: list[tuple[Any, bool]] = [(term, False)]
    while stack:
        value, argument = stack.pop()
        if reads_own_tags(value, argument):
            return True
        if isinstance(value, dict):
            for key, inner in value.items():
                # A call's arguments and a matches() are spans, where $ is
                # the constituent's tokens and not its tags.
                spans = key in ("args", "matches")
                if isinstance(inner, list):
                    stack.extend((item, spans) for item in inner)
                elif isinstance(inner, dict):
                    stack.append((inner, spans))
    return False


def dom_problem(dom: Any) -> str | None:
    """Why a value is not a grammar DOM the reader could have written, or
    None when it is one."""
    if (
        not isinstance(dom, dict)
        or dom.get("format") != FORMAT
        or not isinstance(dom.get("rules"), list)
        or not isinstance(dom.get("directives"), list)
    ):
        return f"not a DOM of format {FORMAT}"
    for directive in dom["directives"]:
        if (
            not isinstance(directive, dict)
            or not isinstance(directive.get("name"), str)
            or not isinstance(directive.get("args"), list)
            or not all(isinstance(arg, str) for arg in directive["args"])
            or not _is_position(directive.get("at"))
        ):
            return "a malformed directive"
    # Each entry is a node to check, its kind, its depth, and whether it
    # lies in a rule's or an alternative's tag term, which may not read
    # the tags it defines.
    pending: list[tuple[str, Any, int, bool]] = []
    for rule in dom["rules"]:
        if (
            not isinstance(rule, dict)
            or not isinstance(rule.get("name"), str)
            or not (_NAME.fullmatch(rule["name"]) or rule["name"] == "#")
            or not _is_one_of(rule.get("op"), {"define", "redefine", "extend"})
            or not _items(rule.get("alternatives"), 1)
            or not isinstance(rule.get("conditions"), list)
            or not _is_position(rule.get("at"))
        ):
            return "a malformed rule"
        if "tags" in rule:
            pending.append(("term", rule["tags"], 0, True))
        if "emit" in rule:
            pending.append(("emission", rule["emit"], 0, False))
        pending.extend(("condition", condition, 0, False) for condition in rule["conditions"])
        for alternative in rule["alternatives"]:
            if (
                not isinstance(alternative, dict)
                or not isinstance(alternative.get("guards"), list)
                or not all(_is_guard(guard) for guard in alternative["guards"])
            ):
                return "a malformed alternative"
            # A capture stands only at the top level of an alternative: the
            # expression itself, or an item of its sequence (engine §3.5);
            # an alternative has at most four, each named once.
            expr = alternative.get("expr")
            top = expr["seq"] if isinstance(expr, dict) and isinstance(expr.get("seq"), list) else [expr]
            names = [item["capture"] for item in top if isinstance(item, dict) and isinstance(item.get("capture"), str)]
            if _WHOLE in names:
                return "$ wrapping a symbol"
            if len(set(names)) != len(names):
                return "a capture name used twice in an alternative"
            if len(names) > 4:
                return "more than four captures in an alternative"
            pending.append(("top", expr, 0, False))
            if "tags" in alternative:
                pending.append(("term", alternative["tags"], 0, True))
    problem = _walk(pending)
    if problem is not None:
        return problem
    # A definition is checked as a whole (engine §9), once its clauses are
    # known to be well formed.
    for rule in dom["rules"]:
        problem = definition_problem(rule)
        if problem is not None:
            return problem
    return None


def _walk(pending: list[tuple[str, Any, int, bool]]) -> str | None:
    """Check the nodes of expressions, emissions, conditions and terms, each
    entry a node, its kind, its depth, and whether it lies in a rule's or an
    alternative's tag term, which may not read the tags it defines."""
    items: Any
    args: Any
    while pending:
        kind, value, depth, own = pending.pop()
        if depth > MAX_DEPTH:
            return TOO_DEEP
        if not isinstance(value, dict):
            return f"a malformed {'expression' if kind in ('top', 'item') else kind}"
        below = depth + 1
        if kind in ("expr", "top", "item"):
            if "choice" in value or "seq" in value:
                items = value["choice"] if "choice" in value else value["seq"]
                if not _items(items, 2):
                    return "a malformed expression"
                child_kind = "item" if kind == "top" and "seq" in value else "expr"
                pending.extend((child_kind, item, below, False) for item in items)
            elif "and" in value:
                if not _items(value["and"], 2, 16):
                    return "a malformed expression"
                pending.extend(("expr", item, below, False) for item in value["and"])
            elif "repeat" in value:
                if not (_is_int(value.get("min")) and value["min"] in (0, 1)):
                    return "a malformed expression"
                pending.append(("expr", value["repeat"], below, False))
            elif "optional" in value:
                pending.append(("expr", value["optional"], below, False))
            elif "capture" in value:
                inner = value.get("expr")
                if kind == "expr":
                    return "a capture below the top level of an alternative"
                if (
                    not isinstance(value["capture"], str)
                    or value["capture"] == _WHOLE
                    or not isinstance(inner, dict)
                    or not (isinstance(inner.get("ref"), str) or isinstance(inner.get("terminal"), str))
                ):
                    return "a malformed capture"
            elif not (
                isinstance(value.get("ref"), str)
                or isinstance(value.get("terminal"), str)
                or value.get("empty") is True
            ):
                return "a malformed expression"
        elif kind == "emission":
            # No items for ε; otherwise items of the keys capture, insert and
            # tags alone, $ only with $, a capture other than $ listed once,
            # no tags on an inserted tag, no ∅ as an item's tags (engine §9).
            items = value.get("items")
            if not _items(items, 0):
                return "a malformed emission"
            kinds: list[str | None] = []
            for item in items:
                if not isinstance(item, dict):
                    kinds.append(None)
                elif isinstance(item.get("insert"), str):
                    kinds.append("insert" if item.keys() == {"insert"} else None)
                elif isinstance(item.get("capture"), str):
                    if not item.keys() <= {"capture", "tags"}:
                        kinds.append(None)
                    elif item["capture"] == _WHOLE:
                        kinds.append("whole")
                    else:
                        kinds.append("capture")
                else:
                    kinds.append(None)
            if None in kinds:
                return "a malformed emission"
            if "whole" in kinds and any(k != "whole" for k in kinds):
                return "a malformed emission"
            captures = [item["capture"] for item, k in zip(items, kinds) if k == "capture"]
            if len(set(captures)) != len(captures):
                return "a malformed emission"
            for item in items:
                if "tags" not in item:
                    continue
                if isinstance(item["tags"], dict) and item["tags"].get("emptySet") is True:
                    return "∅ as an emitted item's tags"
                # An emission is no node of a term: its tags start at the top.
                pending.append(("term", item["tags"], depth, False))
        elif kind == "condition":
            # The condition of a guarded term in a tag term may not read the
            # tags the term defines either.
            if "any" in value or "all" in value:
                items = value["any"] if "any" in value else value["all"]
                if not _items(items, 2):
                    return "a malformed condition"
                pending.extend(("condition", item, below, own) for item in items)
            elif "not" in value:
                pending.append(("condition", value["not"], below, own))
            elif "if" in value:
                if "then" not in value:
                    return "a malformed condition"
                pending.append(("condition", value["if"], below, own))
                pending.append(("condition", value["then"], below, own))
            elif "captured" in value:
                if not isinstance(value["captured"], str):
                    return "a malformed condition"
            elif "matches" in value:
                if not isinstance(value.get("rule"), str) or not _is_span(value["matches"]):
                    return "a malformed condition"
                pending.append(("argument", value["matches"], below, own))
            else:
                if not _is_one_of(value.get("op"), _COMPARATORS):
                    return "a malformed condition"
                pending.append(("term", value.get("left"), below, own))
                pending.append(("term", value.get("right"), below, own))
        else:
            # A term; an argument is a term where a span may stand.
            if own and reads_own_tags(value, kind == "argument"):
                return "a tag term that reads the tags it defines"
            if "union" in value or "intersection" in value:
                items = value["union"] if "union" in value else value["intersection"]
                if not _items(items, 2):
                    return "a malformed term"
                pending.extend(("term", item, below, own) for item in items)
            elif "if" in value:
                # A guarded term: its condition, and the tag set it guards.
                if kind == "argument" or "then" not in value:
                    return "a malformed term"
                pending.append(("condition", value["if"], below, own))
                pending.append(("term", value["then"], below, own))
            elif "call" in value:
                # The reader's signatures (engine §9), with a span where one is due.
                args = value.get("args") if isinstance(value.get("args"), list) else []
                call = value["call"]
                if not _is_one_of(call, _FUNCTIONS) or call == "matches":
                    ok = False
                elif call == "tags":
                    ok = (len(args) == 1 and _is_span(args[0])) or (
                        len(args) == 2 and _is_span(args[0]) and _is_rule_name(args[1])
                    )
                elif call == "lowercase":
                    ok = len(args) == 1 and _is_string(args[0])
                else:
                    ok = len(args) == 1 and _is_span(args[0])
                if not ok or (kind != "argument" and call in _SPANS):
                    return "a malformed term"
                pending.extend(("argument", arg, below, own) for arg in args if not _is_rule_name(arg))
            elif not (
                isinstance(value.get("literal"), str)
                or isinstance(value.get("weak"), str)
                or value.get("emptySet") is True
                or isinstance(value.get("capture"), str)
            ):
                return "a malformed term"
    return None
