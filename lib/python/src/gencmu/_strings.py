"""Scalar strings and stored engine tags (engine §§1 and 9)."""

from __future__ import annotations

import re
from typing import Any

from ._unicode_property_catalog import PROPERTY_CATALOG
ENGINE_TAGS = frozenset(PROPERTY_CATALOG["tags"])
USER_NAME = re.compile(r"(?!.*--)[A-Z][A-Za-z0-9_-]*")
def literal_string(term: Any) -> str | None:
    if not isinstance(term, dict):
        return None
    if isinstance(term.get("string"), str):
        return term["string"]
    return None


def spelling(value: str, unicode: Any) -> str:
    out = ['"']
    for char in value:
        code = ord(char)
        if (code <= 0x1F or 0x7F <= code <= 0x9F or char in ('"', '‹')
                or 0xE000 <= code <= 0xF8FF or 0xF0000 <= code <= 0xFFFFD
                or 0x100000 <= code <= 0x10FFFD or unicode.is_mark(code)
                or unicode.category(code) == "Cf" or unicode.changes_in_document(code)
                or code != 0x20 and unicode.is_white_space(code)):
            out.append('‹' + unicode.canonical_abbreviations.get(code, f"U+{code:04X}") + '›')
        else:
            out.append(char)
    out.append('"')
    return ''.join(out)
