"""The canonical JSON of a result and the bracket rendering (docs/output.md)."""

from __future__ import annotations

import json
from typing import Any

from ._model import Action, Node, ParseError, ParseResult, ParseWarning, Restoration, Stage, Token
from ._tags import sorted_tags

FORMAT = 10


def token_json(token: Token) -> dict[str, Any]:
    """A token in the result JSON. An attached token has no span, and a list
    of attachments is present only when it is not empty (docs/output.md).
    Attachments can nest deep, so this is built without recursion."""

    def shallow(current: Token) -> dict[str, Any]:
        value: dict[str, Any] = {"text": current.text}
        if current.phonemes is not None:
            value["phonemes"] = current.phonemes
        value["label"] = current.label
        value["tags"] = sorted_tags(current.tags)
        if current.span is not None:
            value["span"] = list(current.span)
        value["source"] = list(current.source)
        if current.inserted_by is not None:
            value["insertedBy"] = current.inserted_by
        if current.before:
            value["before"] = []
        if current.after:
            value["after"] = []
        return value

    top = shallow(token)
    stack = [(token, top)]
    while stack:
        current, value = stack.pop()
        for side, attachments in (("before", current.before), ("after", current.after)):
            for attached in attachments:
                attached_value = shallow(attached)
                value[side].append(attached_value)
                stack.append((attached, attached_value))
    return top


def node_json(node: Node) -> dict[str, Any]:
    """A node and everything under it, built without recursion."""

    def shallow(current: Node) -> dict[str, Any]:
        if current.kind == "rule":
            return {
                "kind": "rule",
                "rule": current.rule,
                "span": list(current.span),
                "source": list(current.source),
                "tags": sorted_tags(current.tags or ()),
                "children": [],
            }
        if current.kind == "token":
            return {
                "kind": "token",
                "terminal": current.terminal,
                "token": current.token,
                "span": list(current.span),
                "source": list(current.source),
            }
        return {"kind": "elided", "terminal": current.terminal, "span": list(current.span), "source": list(current.source)}

    top = shallow(node)
    stack = [(node, top)]
    while stack:
        current, value = stack.pop()
        for child in current.children:
            child_value = shallow(child)
            value["children"].append(child_value)
            if child.kind == "rule":
                stack.append((child, child_value))
    return top


def action_json(action: Action) -> dict[str, Any]:
    if action.kind == "read":
        return {"read": {"token": action.token, "terminal": action.terminal}}
    if action.kind == "elided":
        return {"elided": {"at": action.at, "terminal": action.terminal}}
    return {"close": {"rule": action.rule, "production": action.production, "span": list(action.span or (0, 0))}}


def stage_json(stage: Stage) -> dict[str, Any]:
    value: dict[str, Any] = {"name": stage.name, "verdict": stage.verdict}
    if stage.verdict == "tie" and stage.witness is not None:
        value["witness"] = [action_json(stage.witness[0]), action_json(stage.witness[1])]
    if stage.output is not None:
        value["output"] = [token_json(token) for token in stage.output]
    return value


def error_json(error: ParseError) -> dict[str, Any]:
    value: dict[str, Any] = {"kind": error.kind}
    if error.stage is not None:
        value["stage"] = error.stage
    if error.code is not None:
        value["code"] = error.code
    if error.reason is not None:
        value["reason"] = error.reason
    if error.token is not None:
        value["token"] = error.token
    if error.source is not None:
        value["source"] = list(error.source)
    if error.document is not None:
        value["document"] = error.document
    if error.line is not None:
        value["line"] = error.line
    if error.column is not None:
        value["column"] = error.column
    if error.expected is not None:
        value["expected"] = [{"terminal": entry.terminal, "rules": list(entry.rules)} for entry in error.expected]
    if error.readings is not None:
        value["readings"] = [node_json(reading) for reading in error.readings]
    # Only an error of elision-only has a witness (docs/output.md).
    if error.witness is not None and error.reason == "elision-only":
        value["witness"] = [action_json(error.witness[0]), action_json(error.witness[1])]
    if error.cycle is not None:
        value["cycle"] = []
        for edge in error.cycle:
            public = dict(edge)
            if "witness" in public:
                public["witness"] = [action_json(a) if a is not None else None for a in public["witness"]]
            value["cycle"].append(public)
    if error.conflict is not None:
        value["conflict"] = error.conflict
    if error.chosen_reading is not None:
        value["chosenReading"] = error.chosen_reading
    value["message"] = error.message
    # The members of elision-witness-lost follow its message
    # (docs/output.md).
    if error.chosen is not None:
        value["chosen"] = node_json(error.chosen)
    if error.completion is not None:
        value["completion"] = [restoration_json(record) for record in error.completion]
    return value


def restoration_json(record: Restoration) -> dict[str, Any]:
    """A terminator that the check of elision-only wrote back (engine
    §7.9), with its sound last and only for a tested terminator."""
    value: dict[str, Any] = {"terminal": record.terminal, "at": record.at, "source": list(record.source)}
    if record.sound is not None:
        value["sound"] = record.sound
    return value


def warning_json(warning: ParseWarning) -> dict[str, Any]:
    return {
        "stage": warning.stage,
        "feature": warning.feature,
        "rule": warning.rule,
        "span": list(warning.span),
        "source": list(warning.source),
    }


def result_json(result: ParseResult) -> dict[str, Any]:
    """The canonical JSON of a result, as plain data in the key order of
    docs/output.md."""
    value: dict[str, Any] = {
        "format": FORMAT,
        "ok": result.ok,
        "stages": [stage_json(stage) for stage in result.stages],
        "tree": node_json(result.tree) if result.tree is not None else None,
        "error": error_json(result.error) if result.error is not None else None,
    }
    # Present only when there is at least one (docs/output.md).
    if result.warnings:
        value["warnings"] = [warning_json(warning) for warning in result.warnings]
    return value


def compact_json(value: Any) -> str:
    """JSON with no whitespace outside strings and non-ASCII characters as
    themselves, written without recursion, since a tree can nest deeper
    than the call stack allows."""
    out: list[str] = []
    # Each entry is a value to write, or a piece of text already written.
    stack: list[tuple[bool, Any]] = [(False, value)]
    while stack:
        is_text, item = stack.pop()
        if is_text:
            out.append(item)
        elif isinstance(item, dict):
            out.append("{")
            stack.append((True, "}"))
            entries = list(item.items())
            for index in range(len(entries) - 1, -1, -1):
                key, member = entries[index]
                stack.append((False, member))
                stack.append((True, json.dumps(key, ensure_ascii=False) + ":"))
                if index:
                    stack.append((True, ","))
        elif isinstance(item, (list, tuple)):
            out.append("[")
            stack.append((True, "]"))
            for index in range(len(item) - 1, -1, -1):
                stack.append((False, item[index]))
                if index:
                    stack.append((True, ","))
        else:
            out.append(json.dumps(item, ensure_ascii=False))
    return "".join(out)


def to_json(result: ParseResult) -> str:
    """The canonical JSON of a result, as text."""
    return compact_json(result_json(result))


class _Group:
    __slots__ = ("members",)

    def __init__(self, members: list[Any]) -> None:
        self.members = members


def _token_member(token: Token) -> Any:
    """A token as a member of the brackets: its label, or, with attachments,
    a group of its before-attachments, its label and its after-attachments,
    each rendered the same way (docs/output.md). Built without recursion."""

    def shallow(current: Token) -> Any:
        return current.label if not current.before and not current.after else _Group([])

    top = shallow(token)
    stack = [(token, top)]
    while stack:
        current, member = stack.pop()
        if not isinstance(member, _Group):
            continue
        for attached in current.before:
            inner = shallow(attached)
            member.members.append(inner)
            stack.append((attached, inner))
        member.members.append(current.label)
        for attached in current.after:
            inner = shallow(attached)
            member.members.append(inner)
            stack.append((attached, inner))
    return top


def to_brackets(result: ParseResult, *, show_elided: bool = False) -> str:
    """The last stage's tree as nested groups (docs/output.md, "Brackets")."""
    tree = result.tree
    if tree is None or not result.stages:
        return ""
    tokens = result.stages[-1].input
    rendered: dict[int, Any] = {}
    stack: list[tuple[Node, bool]] = [(tree, False)]
    while stack:
        node, done = stack.pop()
        if node.kind == "token":
            token = tokens[node.token] if node.token is not None and node.token < len(tokens) else None
            # A token is a member even when its label is empty, as an empty
            # quotation's text is; only empty rule nodes are dropped.
            # Every rendering shows a token by its label (docs/output.md). A
            # token with attachments is a group of its before-attachments,
            # its label and its after-attachments, each rendered the same way.
            rendered[id(node)] = _token_member(token) if token is not None else ""
        elif node.kind == "elided":
            rendered[id(node)] = f"⟨{(node.terminal or '').lower()}⟩" if show_elided else None
        elif not done:
            stack.append((node, True))
            stack.extend((child, False) for child in node.children)
        else:
            members = [rendered[id(child)] for child in node.children if rendered[id(child)] is not None]
            rendered[id(node)] = None if not members else members[0] if len(members) == 1 else _Group(members)
    top = rendered[id(tree)]
    if top is None:
        return ""
    out: list[str] = []
    work: list[tuple[Any, int]] = [(top, 0)]
    brackets = ("()", "[]", "{}")
    while work:
        item, depth = work.pop()
        if isinstance(item, str):
            out.append(item)
        elif isinstance(item, _Group):
            pair = brackets[depth % 3]
            out.append(pair[0])
            work.append((pair[1], -1))
            for index in range(len(item.members) - 1, -1, -1):
                work.append((item.members[index], depth + 1))
                if index:
                    work.append((" ", -1))
    return "".join(out)
