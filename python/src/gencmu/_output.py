"""The canonical JSON of a result and the bracket rendering (docs/output.md)."""

from __future__ import annotations

import json
from typing import Any

from ._model import Action, Node, ParseError, ParseResult, Stage, Token

FORMAT = 1


def _tags(tags: dict[str, bool]) -> dict[str, bool]:
    return {tag: tags[tag] for tag in sorted(tags)}


def token_json(token: Token) -> dict[str, Any]:
    value: dict[str, Any] = {"text": token.text}
    if token.phonemes is not None:
        value["phonemes"] = token.phonemes
    value["tags"] = _tags(token.tags)
    value["span"] = list(token.span)
    value["source"] = list(token.source)
    if token.inserted_by is not None:
        value["insertedBy"] = token.inserted_by
    return value


def node_json(node: Node) -> dict[str, Any]:
    """A node and everything under it, built without recursion."""

    def shallow(current: Node) -> dict[str, Any]:
        if current.kind == "rule":
            return {
                "kind": "rule",
                "rule": current.rule,
                "span": list(current.span),
                "source": list(current.source),
                "tags": _tags(current.tags or {}),
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
    return {"close": {"rule": action.rule, "production": action.production, "span": list(action.span or (0, 0))}}


def stage_json(stage: Stage) -> dict[str, Any]:
    value: dict[str, Any] = {"name": stage.name, "verdict": stage.verdict}
    if stage.verdict == "tie" and stage.witness is not None:
        value["witness"] = [action_json(stage.witness[0]), action_json(stage.witness[1])]
        if stage.tied is not None:
            value["tied"] = node_json(stage.tied)
    if stage.output is not None:
        value["output"] = [token_json(token) for token in stage.output]
    return value


def error_json(error: ParseError) -> dict[str, Any]:
    value: dict[str, Any] = {"kind": error.kind}
    if error.stage is not None:
        value["stage"] = error.stage
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
    value["message"] = error.message
    return value


def result_json(result: ParseResult) -> dict[str, Any]:
    """The canonical JSON of a result, as plain data in the key order of
    docs/output.md."""
    return {
        "format": FORMAT,
        "ok": result.ok,
        "stages": [stage_json(stage) for stage in result.stages],
        "tree": node_json(result.tree) if result.tree is not None else None,
        "error": error_json(result.error) if result.error is not None else None,
    }


def to_json(result: ParseResult) -> str:
    """The canonical JSON of a result, as text."""
    return json.dumps(result_json(result), ensure_ascii=False, separators=(",", ":"))


class _Group:
    __slots__ = ("members",)

    def __init__(self, members: list[Any]) -> None:
        self.members = members


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
            label = (token.phonemes or token.text) if token is not None else ""
            rendered[id(node)] = label or None
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
