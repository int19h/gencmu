"""64-bit FNV-1a, the key of the precompiled DOMs (engine §8)."""

from __future__ import annotations

_OFFSET = 0xCBF29CE484222325
_PRIME = 0x100000001B3
_MASK = 0xFFFFFFFFFFFFFFFF


def fnv1a64(text: str | bytes) -> str:
    """The hash of a text's UTF-8 bytes, as 16 lower-case hexadecimal digits."""
    data = text.encode("utf-8") if isinstance(text, str) else text
    value = _OFFSET
    for byte in data:
        value = ((value ^ byte) * _PRIME) & _MASK
    return f"{value:016x}"
