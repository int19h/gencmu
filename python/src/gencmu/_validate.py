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

MAX_DEPTH = 256
"""The deepest an expression, a term or a condition may nest (engine §9)."""

TOO_DEEP = "nested too deeply"

_FUNCTIONS = {"phonemes", "text", "lowercase", "tags", "classes", "words", "head", "tail", "last", "matches"}
_COMPARATORS = {"=", "≠", "∈", "∉", "⊆"}
_SPANS = {"head", "tail", "last"}
_NAME = re.compile(r"[A-Za-z][A-Za-z0-9-]*")


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_position(value: Any) -> bool:
    return isinstance(value, list) and len(value) == 2 and all(_is_int(x) for x in value)


def _is_span(value: Any) -> bool:
    """A capture, or head, tail or last of one."""
    return isinstance(value, dict) and (isinstance(value.get("capture"), str) or value.get("call") in _SPANS)


def _is_string(value: Any) -> bool:
    """A literal, or phonemes, text or lowercase of something."""
    return isinstance(value, dict) and (
        isinstance(value.get("literal"), str) or value.get("call") in ("phonemes", "text", "lowercase")
    )


def _is_rule_name(value: Any) -> bool:
    return isinstance(value, dict) and isinstance(value.get("rule"), str) and len(value) == 1


def _items(value: Any, least: int, most: float = float("inf")) -> bool:
    return isinstance(value, list) and least <= len(value) <= most


def dom_problem(dom: Any) -> str | None:
    """Why a value is not a grammar DOM the reader could have written, or
    None when it is one."""
    if (
        not isinstance(dom, dict)
        or dom.get("format") != 1
        or not isinstance(dom.get("rules"), list)
        or not isinstance(dom.get("directives"), list)
    ):
        return "not a DOM of format 1"
    for directive in dom["directives"]:
        if (
            not isinstance(directive, dict)
            or not isinstance(directive.get("name"), str)
            or not isinstance(directive.get("args"), list)
            or not all(isinstance(arg, str) for arg in directive["args"])
            or not _is_position(directive.get("at"))
        ):
            return "a malformed directive"
    pending: list[tuple[str, Any, int]] = []
    for rule in dom["rules"]:
        if (
            not isinstance(rule, dict)
            or not isinstance(rule.get("name"), str)
            or not _NAME.fullmatch(rule["name"])
            or rule.get("op") not in ("define", "extend")
            or not _items(rule.get("alternatives"), 1)
            or not isinstance(rule.get("conditions"), list)
            or not _is_position(rule.get("at"))
        ):
            return "a malformed rule"
        if "tags" in rule:
            pending.append(("term", rule["tags"], 0))
        if "emit" in rule:
            pending.append(("emission", rule["emit"], 0))
        pending.extend(("condition", condition, 0) for condition in rule["conditions"])
        for alternative in rule["alternatives"]:
            if (
                not isinstance(alternative, dict)
                or not isinstance(alternative.get("guards"), list)
                or not all(
                    isinstance(guard, dict) and isinstance(guard.get("feature"), str) and isinstance(guard.get("negated"), bool)
                    for guard in alternative["guards"]
                )
            ):
                return "a malformed alternative"
            pending.append(("expr", alternative.get("expr"), 0))
            if "tags" in alternative:
                pending.append(("term", alternative["tags"], 0))
    items: Any
    args: Any
    while pending:
        kind, value, depth = pending.pop()
        if depth > MAX_DEPTH:
            return TOO_DEEP
        if not isinstance(value, dict):
            return f"a malformed {kind}"
        below = depth + 1
        if kind == "expr":
            if "choice" in value or "seq" in value:
                items = value["choice"] if "choice" in value else value["seq"]
                if not _items(items, 2):
                    return "a malformed expression"
                pending.extend(("expr", item, below) for item in items)
            elif "and" in value:
                if not _items(value["and"], 2, 16):
                    return "a malformed expression"
                pending.extend(("expr", item, below) for item in value["and"])
            elif "repeat" in value:
                if value.get("min") not in (0, 1) or isinstance(value.get("min"), bool):
                    return "a malformed expression"
                pending.append(("expr", value["repeat"], below))
            elif "optional" in value:
                pending.append(("expr", value["optional"], below))
            elif "capture" in value:
                inner = value.get("expr")
                if (
                    not isinstance(value["capture"], str)
                    or not isinstance(inner, dict)
                    or not (isinstance(inner.get("ref"), str) or isinstance(inner.get("terminal"), str))
                ):
                    return "a malformed capture"
            elif not (
                isinstance(value.get("ref"), str)
                or isinstance(value.get("terminal"), str)
                or value.get("hash") is True
                or value.get("empty") is True
            ):
                return "a malformed expression"
        elif kind == "emission":
            # Nothing alone, this only with this, a capture listed once, no
            # tags on an inserted tag (engine §9).
            if value.get("nothing") is True:
                if len(value) != 1:
                    return "a malformed emission"
                continue
            items = value.get("items")
            if not _items(items, 1):
                return "a malformed emission"
            kinds: list[str | None] = []
            for item in items:
                if not isinstance(item, dict):
                    kinds.append(None)
                elif item.get("this") is True:
                    kinds.append("this")
                elif isinstance(item.get("capture"), str):
                    kinds.append("capture")
                elif isinstance(item.get("insert"), str):
                    kinds.append("insert")
                else:
                    kinds.append(None)
            if None in kinds or ("this" in kinds and any(k != "this" for k in kinds)):
                return "a malformed emission"
            captures = [item["capture"] for item, k in zip(items, kinds) if k == "capture"]
            if len(set(captures)) != len(captures):
                return "a malformed emission"
            for item, k in zip(items, kinds):
                if "tags" not in item:
                    continue
                if k == "insert":
                    return "a malformed emission"
                pending.append(("term", item["tags"], below))
        elif kind == "condition":
            if "any" in value:
                if not _items(value["any"], 2):
                    return "a malformed condition"
                pending.extend(("condition", item, below) for item in value["any"])
            elif "not" in value:
                pending.append(("condition", value["not"], below))
            elif "matches" in value:
                if not isinstance(value.get("rule"), str) or not _is_span(value["matches"]):
                    return "a malformed condition"
                pending.append(("argument", value["matches"], below))
            else:
                if value.get("op") not in _COMPARATORS:
                    return "a malformed condition"
                pending.append(("term", value.get("left"), below))
                pending.append(("term", value.get("right"), below))
        else:
            # A term; an argument is a term where a span may stand.
            if "set" in value or "union" in value or "intersection" in value:
                items = value["set"] if "set" in value else value["union"] if "union" in value else value["intersection"]
                if not _items(items, 0 if "set" in value else 2):
                    return "a malformed term"
                pending.extend(("term", item, below) for item in items)
            elif "call" in value:
                # The reader's signatures (engine §9), with a span where one is due.
                args = value.get("args") if isinstance(value.get("args"), list) else []
                call = value["call"]
                if not isinstance(call, str) or call not in _FUNCTIONS or call == "matches":
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
                pending.extend(("argument", arg, below) for arg in args if not _is_rule_name(arg))
            elif not (
                isinstance(value.get("literal"), str)
                or isinstance(value.get("weak"), str)
                or value.get("emptySet") is True
                or isinstance(value.get("capture"), str)
            ):
                return "a malformed term"
    return None
