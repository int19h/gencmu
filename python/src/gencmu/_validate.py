"""The shape of a grammar DOM (docs/output.md, "A grammar DOM").

DOMs come from files a library did not write itself, a bootstrap or a
compiled.json supplied beside the documents, so they are checked before use.
"""

from __future__ import annotations

from typing import Any

_EXPRESSION_KEYS = {"seq", "choice", "and", "optional", "repeat", "ref", "terminal", "capture", "hash", "empty"}
_OPS = {"=", "≠", "∈", "∉", "⊆"}
_FUNCTIONS = {"phonemes", "text", "words", "classes", "head", "tail", "last", "lowercase", "tags"}


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def dom_problem(dom: Any) -> str | None:
    """What is wrong with a DOM's shape, or None if nothing is."""
    if not isinstance(dom, dict) or dom.get("format") != 1:
        return "a DOM is an object of format 1"
    rules = dom.get("rules")
    directives = dom.get("directives")
    if not isinstance(rules, list) or not isinstance(directives, list):
        return "a DOM has lists of rules and directives"
    work: list[tuple[str, Any]] = []
    for rule in rules:
        if not isinstance(rule, dict) or not isinstance(rule.get("name"), str) or rule.get("op") not in ("define", "extend"):
            return "a rule has a name and an op"
        at = rule.get("at")
        if not (isinstance(at, list) and len(at) == 2 and all(_is_int(x) for x in at)):
            return f"rule {rule['name']} has no position"
        alternatives = rule.get("alternatives")
        conditions = rule.get("conditions")
        if not isinstance(alternatives, list) or not isinstance(conditions, list):
            return f"rule {rule['name']} has lists of alternatives and conditions"
        for alternative in alternatives:
            if not isinstance(alternative, dict) or not isinstance(alternative.get("guards"), list) or "expr" not in alternative:
                return f"an alternative of {rule['name']} has guards and an expression"
            for guard in alternative["guards"]:
                if not isinstance(guard, dict) or not isinstance(guard.get("feature"), str) or not isinstance(guard.get("negated"), bool):
                    return f"a guard of {rule['name']} has a feature and negated"
            work.append(("expr", alternative["expr"]))
            if "tags" in alternative:
                work.append(("term", alternative["tags"]))
        if "tags" in rule:
            work.append(("term", rule["tags"]))
        work.extend(("cond", condition) for condition in conditions)
        if "emit" in rule:
            work.append(("emit", rule["emit"]))
    for directive in directives:
        if (
            not isinstance(directive, dict)
            or not isinstance(directive.get("name"), str)
            or not isinstance(directive.get("args"), list)
            or not all(isinstance(arg, str) for arg in directive["args"])
        ):
            return "a directive has a name and words"
    while work:
        kind, value = work.pop()
        if not isinstance(value, dict):
            return f"a malformed {kind}"
        if kind == "expr":
            keys = _EXPRESSION_KEYS & value.keys()
            if len(keys) != 1:
                return "a malformed expression"
            key = keys.pop()
            if key in ("seq", "choice", "and"):
                if not isinstance(value[key], list):
                    return "a malformed expression"
                work.extend(("expr", item) for item in value[key])
            elif key in ("optional", "repeat"):
                if key == "repeat" and value.get("min") not in (0, 1):
                    return "a repetition has min 0 or 1"
                work.append(("expr", value[key]))
            elif key in ("ref", "terminal"):
                if not isinstance(value[key], str):
                    return "a malformed name"
            elif key == "capture":
                if not isinstance(value[key], str) or not isinstance(value.get("expr"), dict):
                    return "a malformed capture"
                work.append(("expr", value["expr"]))
        elif kind == "emit":
            if value.get("nothing") is True:
                continue
            items = value.get("items")
            if not isinstance(items, list):
                return "a malformed emission"
            for item in items:
                if not isinstance(item, dict) or not ({"this", "capture", "insert"} & item.keys()):
                    return "a malformed emission item"
                if "tags" in item:
                    work.append(("term", item["tags"]))
        elif kind == "cond":
            if "op" in value:
                if value["op"] not in _OPS or "left" not in value or "right" not in value:
                    return "a malformed comparison"
                work.append(("term", value["left"]))
                work.append(("term", value["right"]))
            elif "matches" in value:
                if not isinstance(value.get("rule"), str):
                    return "a malformed matches"
                work.append(("term", value["matches"]))
            elif "not" in value:
                work.append(("cond", value["not"]))
            elif "any" in value:
                if not isinstance(value["any"], list):
                    return "a malformed condition"
                work.extend(("cond", item) for item in value["any"])
            else:
                return "a malformed condition"
        else:
            if "literal" in value or "weak" in value:
                if not isinstance(value.get("literal", value.get("weak")), str):
                    return "a malformed term"
            elif "emptySet" in value or "capture" in value:
                if "capture" in value and not isinstance(value["capture"], str):
                    return "a malformed term"
            elif "rule" in value:
                if not isinstance(value["rule"], str):
                    return "a malformed term"
            elif any(key in value for key in ("set", "union", "intersection")):
                items = value.get("set", value.get("union", value.get("intersection")))
                if not isinstance(items, list) or (not items and "set" not in value):
                    return "a malformed term"
                work.extend(("term", item) for item in items)
            elif "call" in value:
                if value["call"] not in _FUNCTIONS or not isinstance(value.get("args"), list) or not value["args"]:
                    return "a malformed call"
                work.extend(("term", item) for item in value["args"])
            else:
                return "a malformed term"
    return None
