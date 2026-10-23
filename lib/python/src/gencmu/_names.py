"""Pinned Unicode names and lazy resource selection (engine §1)."""

from __future__ import annotations

from dataclasses import dataclass
import re

from ._errors import GencmuError
from ._hash import fnv1a64
from ._unicode_names_catalog import PINNED_NAMES_HASH
from ._markdown import resolve

NO_NAMES = object()


def selected_names(path, dom, inherited=()):
    return sorted(set(inherited) | {resolve(path, d["args"][0]) for d in dom["directives"] if d["name"] == "names"})


def _fail(path, message, line=None):
    raise GencmuError(message, document=path, line=line)


def _scalar(field, path, line):
    digits = field.lstrip("0")
    if re.fullmatch(r"[0-9A-Fa-f]+", field) is None or len(digits) > 6:
        _fail(path, "an invalid scalar", line)
    code = int(digits or "0", 16)
    if code > 0x10FFFF or 0xD800 <= code <= 0xDFFF:
        _fail(path, "an invalid scalar", line)
    return code


_L = ("G", "GG", "N", "D", "DD", "R", "M", "B", "BB", "S", "SS", "", "J", "JJ", "C", "K", "T", "P", "H")
_V = ("A", "AE", "YA", "YAE", "EO", "E", "YEO", "YE", "O", "WA", "WAE", "OE", "YO", "U", "WEO", "WE", "WI", "YU", "EU", "YI", "I")
_T = ("", "G", "GG", "GS", "N", "NJ", "NH", "D", "L", "LG", "LM", "LB", "LS", "LT", "LP", "LH", "M", "B", "BS", "S", "SS", "NG", "J", "C", "K", "T", "P", "H")


@dataclass(frozen=True)
class _Record:
    code: int
    name: str
    kind: str
    line: int

    def alias_key(self):
        return self.kind, self.code, self.name


@dataclass(frozen=True)
class _Algorithm:
    kind: str
    first: int
    last: int
    prefix: str
    line: int

    def rule(self):
        return self.kind, self.first, self.last, self.prefix

    def lookup(self, name):
        if self.kind == "hex":
            if not name.startswith(self.prefix):
                return None
            suffix = name[len(self.prefix):]
            if re.fullmatch(r"[0-9A-F]{4,6}", suffix) is None:
                return None
            code = int(suffix, 16)
            return code if self.first <= code <= self.last and f"{code:04X}" == suffix else None
        if not name.startswith("HANGUL SYLLABLE "):
            return None
        suffix = name[16:]
        for l, lead in enumerate(_L):
            for v, vowel in enumerate(_V):
                prefix = lead + vowel
                if suffix.startswith(prefix) and suffix[len(prefix):] in _T:
                    return 0xAC00 + (l * 21 + v) * 28 + _T.index(suffix[len(prefix):])
        return None


class UnicodeNames:
    def __init__(self, text, path, version):
        self.path = path
        self.records = []
        self.names = {}
        self.formal = {}
        self.aliases = set()
        self.scalars = set()
        self.algorithms = []
        header = False
        lines = text.split("\n")
        for index, raw in enumerate(lines):
            line = index + 1
            raw = raw.removesuffix("\r") if index < len(lines) - 1 else raw
            fields = [field for field in re.split(r"[ \t]+", raw) if field]
            if not fields:
                continue
            if not header:
                if (len(fields) != 2 or fields[0] != "unicode-names"
                        or re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", fields[1]) is None or fields[1] != version):
                    _fail(path, "the names header must match the core version", line)
                header = True
                continue
            if fields[0] in ("name", "alias"):
                alias = fields[0] == "alias"
                start = 3 if alias else 2
                kind = fields[1] if alias and len(fields) > 1 else "name"
                if len(fields) <= start or alias and kind not in ("correction", "control", "alternate", "figment", "abbreviation"):
                    _fail(path, "an invalid name record", line)
                code = _scalar(fields[start - 1], path, line)
                name = " ".join(fields[start:])
                if re.fullmatch(r"[A-Z0-9 -]+", name) is None:
                    _fail(path, "an invalid name spelling", line)
                record = _Record(code, name, kind, line)
                if alias:
                    if record.alias_key() in self.aliases:
                        _fail(path, "a duplicate alias record", line)
                    self.aliases.add(record.alias_key())
                else:
                    if code in self.formal:
                        _fail(path, "a scalar has more than one formal name", line)
                    self.formal[code] = record
                if name in self.names and self.names[name] != code:
                    _fail(path, "a name identifies different scalars", line)
                self.names[name] = code
                self.scalars.add(code)
                self.records.append(record)
            elif fields[0] == "algorithm":
                kind = fields[1] if len(fields) > 1 else None
                if not (kind == "hex" and len(fields) >= 5 or kind == "hangul" and len(fields) == 4):
                    _fail(path, "an invalid naming algorithm", line)
                first, last = (_scalar(field, path, line) for field in fields[2:4])
                prefix = " ".join(fields[4:]) if kind == "hex" else "HANGUL SYLLABLE "
                if (first > last or first <= 0xDFFF and last >= 0xD800 or re.fullmatch(r"[A-Z0-9 -]+", prefix) is None
                        or kind == "hangul" and (first, last) != (0xAC00, 0xD7A3)):
                    _fail(path, "an invalid naming algorithm", line)
                if any(rule.kind == kind and rule.prefix == prefix and first <= rule.last and last >= rule.first for rule in self.algorithms):
                    _fail(path, "overlapping naming algorithms", line)
                self.algorithms.append(_Algorithm(kind, first, last, prefix, line))
            else:
                _fail(path, "an unknown names record", line)
        if not header:
            _fail(path, "the names header is missing")
        for record in self.records:
            for rule in self.algorithms:
                if record.kind == "name" and rule.first <= record.code <= rule.last:
                    _fail(path, "an explicit name lies in an algorithmic range", record.line)
                code = rule.lookup(record.name)
                if code is not None and code != record.code:
                    _fail(path, "a name identifies different scalars", record.line)

    def lookup(self, name):
        if name in self.names:
            return self.names[name]
        for rule in self.algorithms:
            code = rule.lookup(name)
            if code is not None:
                return code
        return None

    def has_scalar(self, code):
        return code in self.scalars or any(rule.first <= code <= rule.last for rule in self.algorithms)

    def inspect(self, pinned, abbreviations, extra):
        for rule in self.algorithms:
            if extra or not any(rule.rule() == known.rule() for known in pinned.algorithms):
                _fail(self.path, "an algorithm must retain its pinned rule and range", rule.line)
        for record in self.records:
            if record.kind != "name":
                if extra or record.alias_key() not in pinned.aliases:
                    _fail(self.path, "an alias must retain its pinned kind, spelling, and scalar", record.line)
            elif not extra and record.code in pinned.formal and pinned.formal[record.code].name == record.name:
                continue
            elif (pinned.has_scalar(record.code) or pinned.lookup(record.name) is not None
                    or re.fullmatch(r"[A-Z][A-Z0-9 -]*", record.name) is None or record.name in abbreviations):
                _fail(self.path, "an added name must name an unnamed scalar without a reserved spelling", record.line)


class NamesScope:
    def __init__(self, read, unicode, extras=()):
        self.read = read
        self.unicode = unicode
        self.extras = sorted(set(extras))
        self.tables = None
        self.dependencies = None

    def need(self, path):
        text = self.read(path)
        if text is None:
            _fail(path, "the names resource is missing")
        if re.search("[\ud800-\udfff]", text):
            _fail(path, "the names resource is not a sequence of Unicode scalar values")
        return text

    def load(self):
        if self.tables is not None:
            return
        version = self.unicode.version
        if self.unicode.version_count != 1 or not version:
            _fail("unicode.txt", "names require exactly one Unicode version")
        text = self.need("unicode-names.txt")
        fingerprint = fnv1a64(text)
        base = UnicodeNames(text, "unicode-names.txt", version)
        reference = text if fingerprint == PINNED_NAMES_HASH else self.need("unicode-names-reference.txt")
        if fnv1a64(reference) != PINNED_NAMES_HASH:
            _fail("unicode-names-reference.txt", "the reference fingerprint differs from the pinned data")
        if version != "15.1.0":
            _fail("unicode-names-reference.txt", "the reference version differs from the selected names version")
        pinned = base if fingerprint == PINNED_NAMES_HASH else UnicodeNames(reference, "unicode-names-reference.txt", "15.1.0")
        base.inspect(pinned, self.unicode.abbreviations, False)
        tables = [base]
        dependencies = {"unicode-names.txt": fingerprint}
        for path in self.extras:
            text = self.need(path)
            table = UnicodeNames(text, path, version)
            table.inspect(pinned, self.unicode.abbreviations, True)
            for record in table.records:
                for earlier in tables:
                    code, formal = earlier.lookup(record.name), earlier.formal.get(record.code)
                    if code is not None and code != record.code or formal is not None and formal.name != record.name:
                        _fail(path, "names resources conflict", record.line)
            dependencies[path] = fnv1a64(text)
            tables.append(table)
        self.tables = tables
        self.dependencies = dict(sorted(dependencies.items()))

    def lookup(self, name, core_only=False):
        core = self.unicode.abbreviations.get(name)
        if core is not None or core_only:
            return core
        self.load()
        for table in self.tables:
            code = table.lookup(name)
            if code is not None:
                return code
        return None

    def matches(self, dependencies):
        if dependencies is NO_NAMES:
            return True
        if (not isinstance(dependencies, dict) or set(dependencies) != {"unicode-names.txt", *self.extras}
                or any(not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{16}", value) is None for value in dependencies.values())):
            return False
        self.load()
        return self.dependencies == dependencies


class NamesDom(dict):
    def __init__(self, dom, dependencies):
        super().__init__(dom)
        self.__dict__.update(getattr(dom, "__dict__", {}))
        self.names_dependencies = dependencies
