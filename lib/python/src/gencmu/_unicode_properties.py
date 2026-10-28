"""Inspect the complete Unicode properties companion before notation loading."""

from dataclasses import dataclass
import re

from ._errors import GencmuError
from ._unicode_property_catalog import PROPERTY_CATALOG


@dataclass(frozen=True)
class PropertyData:
    kind: str
    values: frozenset[str]
    defaults: tuple[str, ...]
    ranges: tuple[tuple[int, int, tuple[str, ...]], ...]


def _fail(line=None):
    raise GencmuError("the property record is invalid", document="data/unicode/unicode-properties.txt", line=line)


def read_properties(text: str, version: str, version_count: int) -> dict[str, PropertyData]:
    properties, pending = {}, []
    header = False
    lines = text.split("\n")
    for line, raw in enumerate(lines, 1):
        fields = [field for field in re.split(r"[ \t]+", raw.removesuffix("\r") if line < len(lines) else raw) if field]
        if not fields:
            continue
        if not header:
            if (len(fields) != 2 or fields[0] != "unicode-properties"
                    or re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", fields[1]) is None
                    or version_count != 1 or fields[1] != version):
                _fail(line)
            header = True
            continue
        if len(fields) < 2:
            _fail(line)
        kind, name = fields[:2]
        if name not in PROPERTY_CATALOG["types"] or name in PROPERTY_CATALOG["core"]:
            _fail(line)
        if kind in ("binary", "enumerated", "multiple"):
            if (kind != PROPERTY_CATALOG["types"][name] or name in properties
                    or (len(fields) != 2 if kind == "binary" else len(fields) != 3 if kind == "enumerated" else len(fields) < 3)):
                _fail(line)
            defaults = tuple(sorted(fields[2:]))
            if len(set(defaults)) != len(defaults):
                _fail(line)
            properties[name] = [kind, set(), defaults, [], line]
        elif kind in ("value", "range"):
            pending.append((fields, line))
        else:
            _fail(line)
    if not header:
        _fail()
    for fields, line in pending:
        kind, name = fields[:2]
        if name not in properties:
            _fail(line)
        prop = properties[name]
        if kind == "value":
            if (len(fields) != 3 or prop[0] == "binary" or fields[2] not in PROPERTY_CATALOG["values"][name]
                    or fields[2] in prop[1]):
                _fail(line)
            prop[1].add(fields[2])
        else:
            if ((prop[0] == "binary" and len(fields) != 4) or (prop[0] == "enumerated" and len(fields) != 5)
                    or (prop[0] == "multiple" and len(fields) < 5)):
                _fail(line)
            codes = []
            for field in fields[2:4]:
                digits = field.lstrip("0")
                if re.fullmatch(r"[0-9a-fA-F]+", field) is None or len(digits) > 6:
                    _fail(line)
                codes.append(int(digits or "0", 16))
            first, last = codes
            if first > last or last > 0x10FFFF or first <= 0xDFFF and last >= 0xD800:
                _fail(line)
            values = ("Yes",) if prop[0] == "binary" else tuple(sorted(fields[4:]))
            if len(set(values)) != len(values):
                _fail(line)
            prop[3].append((first, last, values, line))
    result = {}
    for name, (kind, values, defaults, ranges, line) in properties.items():
        if not set(defaults) <= values:
            _fail(line)
        merged = []
        for first, last, members, line in sorted(ranges, key=lambda row: (row[0], row[1], row[3])):
            if kind != "binary" and not set(members) <= values:
                _fail(line)
            previous = merged[-1] if merged else None
            if previous and first <= previous[1] and members != previous[2]:
                _fail(line)
            if previous and first <= previous[1] + 1 and members == previous[2]:
                merged[-1] = (previous[0], max(previous[1], last), members)
            else:
                merged.append((first, last, members))
        result[name] = PropertyData(kind, frozenset(values), defaults, tuple(merged))
    return result
