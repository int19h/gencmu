"""Scalar strings and stored engine tags (engine §§1 and 9)."""

from __future__ import annotations

import re
from typing import Any

from ._unicode import CATEGORIES

ENGINE_TAGS = frozenset("_" + name for name in (*CATEGORIES, "L", "M", "N", "P", "S", "Z", "C", "White_Space"))
USER_NAME = re.compile(r"[A-Z][A-Za-z0-9_-]*")
SCALAR_NAME = re.compile(r"_[0-9A-F]{4,6}")


def scalar(name: str) -> str | None:
    if SCALAR_NAME.fullmatch(name) is None:
        return None
    code = int(name[1:], 16)
    return chr(code) if code <= 0x10FFFF and not 0xD800 <= code <= 0xDFFF else None


def is_constant(name: Any) -> bool:
    return isinstance(name, str) and (USER_NAME.fullmatch(name) is not None or scalar(name) is not None)


def literal_string(term: Any) -> str | None:
    if not isinstance(term, dict):
        return None
    if isinstance(term.get("string"), str):
        return term["string"]
    if isinstance(term.get("const"), str):
        return scalar(term["const"])
    if isinstance(term.get("interpolate"), list):
        parts = [literal_string(part) for part in term["interpolate"]]
        return "".join(parts) if all(part is not None for part in parts) else None
    return None


def spelling(value: str, unicode: Any) -> str:
    out = ['"']
    for char in value:
        code = ord(char)
        if char == "$":
            out.append("$$")
        elif (code <= 0x1F or 0x7F <= code <= 0x9F or code in (0x22, 0x5C)
              or 0xE000 <= code <= 0xF8FF or 0xF0000 <= code <= 0xFFFFD
              or 0x100000 <= code <= 0x10FFFD or unicode.is_mark(code)):
            out.append(f"$(_{code:04X})")
        else:
            out.append(char)
    out.append('"')
    return "".join(out)


def lit(term: Any) -> frozenset[str]:
    """Engine literals retained by a complete tag clause's filters."""
    from ._trampoline import run

    def walk(node):
        if not isinstance(node, dict):
            return frozenset()
        if node.get("tag") in ENGINE_TAGS:
            return frozenset((node["tag"],))
        if "if" in node:
            return (yield walk(node["then"]))
        for key in ("union", "intersection", "difference"):
            if key not in node:
                continue
            parts = node[key]
            result = yield walk(parts[0])
            if key == "difference":
                return result
            for part in parts[1:]:
                found = yield walk(part)
                result = result | found if key == "union" else result & found
            return result
        return frozenset()

    return run(walk(term))
