"""Diagnostic ownership and reporting collections (engine §11.5 and §12.1)."""

from dataclasses import dataclass, field
import json
from typing import Any

from ._measures import diagnostic_record


@dataclass
class DiagnosticLists:
    errors: list = field(default_factory=list)
    warnings: list = field(default_factory=list)


@dataclass
class StageDiagnostics:
    collected: DiagnosticLists = field(default_factory=DiagnosticLists)
    evaluated: DiagnosticLists = field(default_factory=DiagnosticLists)


def diagnostic_identity(diagnostic):
    return diagnostic_record(diagnostic).identity


def join_diagnostics(collections):
    result = DiagnosticLists()
    for kind in ("errors", "warnings"):
        seen = set()
        for collection in collections:
            for diagnostic in getattr(collection, kind):
                identity = diagnostic_identity(diagnostic)
                if identity not in seen:
                    seen.add(identity)
                    getattr(result, kind).append(diagnostic)
    return result


def input_diagnostics(tokens, end=None):
    return join_diagnostics(tokens if end is None else tokens[:end])


def ordered(diagnostics):
    return sorted(diagnostics, key=lambda diagnostic: (
        diagnostic_identity(diagnostic).stage_order, diagnostic_identity(diagnostic).ordinal))


def object_key(diagnostic):
    return json.dumps([diagnostic.stage, diagnostic.code, diagnostic.rule, diagnostic.span,
                       diagnostic.source, diagnostic.message, diagnostic.rejection],
                      ensure_ascii=False, separators=(",", ":"))


@dataclass
class DiagnosticEvent:
    node: Any
    diagnostic: Any
    kind: str
    own: bool
    check: bool = False


def tied_diagnostics(first, second):
    result = DiagnosticLists()
    for kind in ("errors", "warnings"):
        carried, counts, later = set(), {}, {}
        for reading, events in enumerate((first, second)):
            for event in events:
                if event.kind != kind:
                    continue
                diagnostic = event.diagnostic
                if not event.own:
                    identity = diagnostic_identity(diagnostic)
                    if identity in carried:
                        continue
                    carried.add(identity)
                else:
                    key = object_key(diagnostic)
                    table = counts if reading == 0 else later
                    number = table[key] = table.get(key, 0) + 1
                    if reading == 1 and number <= counts.get(key, 0):
                        continue
                getattr(result, kind).append(diagnostic)
    return result


@dataclass(eq=False)
class EmissionScope:
    root: Any
    rows: list = field(default_factory=list)
    carrier: Any = None
    unowned: DiagnosticLists = field(default_factory=DiagnosticLists)


@dataclass
class NodeInfo:
    parent: Any
    erased: bool
    scope: EmissionScope


@dataclass
class Carrier:
    token: Any
    span: Any
    part: Any
    emission: Any
    scope: EmissionScope
    support: Any
    own: DiagnosticLists = field(default_factory=DiagnosticLists)
    groups: list = field(default_factory=list)


class DiagnosticFlow:
    def __init__(self, root, tokens):
        self.root, self.input = root, tokens
        self.nodes, self.own, self.scope_roots, self.carriers = {}, {}, {}, {}
        self.order, self.evaluated = [], []
        self.main = EmissionScope(root)
        self.scopes = [self.main]
        live = [0] * len(tokens)
        pending = [(root, None, False)]
        while pending:
            node, parent, outer = pending.pop()
            read = not hasattr(node, "production")
            erased = outer or not read and node.production.erased
            self.nodes[node] = NodeInfo(parent, erased, self.main)
            self.order.append(node)
            if read:
                if not erased:
                    live[node.token] = 1
            else:
                pending.extend((child, node, erased) for child in reversed(node.children))
        self.prefix = [0]
        for bit in live:
            self.prefix.append(self.prefix[-1] + bit)
        self.next = [len(tokens)] * (len(tokens) + 1)
        for index in range(len(tokens) - 1, -1, -1):
            self.next[index] = index if live[index] else self.next[index + 1]
        self.previous = [0]
        for index, bit in enumerate(live):
            self.previous.append(index + 1 if bit else self.previous[-1])

    def info(self, node):
        return self.nodes[node]

    def add(self, node, diagnostic, kind, check=False):
        event = DiagnosticEvent(node, diagnostic, kind, True, check)
        self.own.setdefault(node, []).append(event)
        self.evaluated.append(event)

    def messages(self):
        result = DiagnosticLists()
        for event in self.evaluated:
            if not self.info(event.node).erased:
                getattr(result, event.kind).append(event.diagnostic)
        return result

    def events(self):
        result = []
        for node in self.order:
            if self.info(node).erased:
                continue
            result.extend(self.own.get(node, ()))
            if not hasattr(node, "production"):
                for kind in ("errors", "warnings"):
                    result.extend(DiagnosticEvent(node, diagnostic, kind, False)
                                  for diagnostic in getattr(self.input[node.token], kind))
        return result

    def collected(self):
        result = DiagnosticLists()
        for event in self.events():
            getattr(result, event.kind).append(event.diagnostic)
        return join_diagnostics([result])

    def attachment(self, root):
        scope = EmissionScope(root)
        self.scope_roots[root] = scope
        self.scopes.append(scope)
        return scope

    def count(self, start, end):
        return self.prefix[end] - self.prefix[start]

    def emitted(self, token, part, emission, scope):
        support = ((self.next[part.start], self.previous[part.end])
                   if part is not None and self.count(part.start, part.end) else None)
        row = Carrier(token, token.span, part, emission, scope, support)
        scope.rows.append(row)
        self.carriers[id(token)] = token, row
        return row

    def attached(self, original, duplicate):
        found = self.carriers.get(id(original))
        if found is not None:
            row = found[1]
            row.token = duplicate
            self.carriers[id(duplicate)] = duplicate, row

    def attachments(self, token, before, after, inherited_before, inherited_after):
        row = self.carriers[id(token)][1]
        row.groups = [*before, *inherited_before, *inherited_after, *after]
        for scope in (*before, *after):
            scope.carrier = row

    def all(self, scope):
        joined = join_diagnostics([scope.unowned, *(row.token for row in scope.rows)])
        return DiagnosticLists(ordered(joined.errors), ordered(joined.warnings))

    @staticmethod
    def _first(rows, after):
        low, high = 0, len(rows)
        while low < high:
            middle = (low + high) // 2
            if after(rows[middle]):
                low = middle + 1
            else:
                high = middle
        return rows[low] if low < len(rows) else None

    def assign(self):
        for node in self.order:
            info = self.info(node)
            parent = self.info(info.parent).scope if info.parent is not None else self.main
            info.scope = self.scope_roots.get(node, parent)
        buckets, emissions, nearest = {}, {}, {}
        for event in self.events():
            buckets.setdefault(self.info(event.node).scope, []).append(event)
        for scope in self.scopes:
            for row in scope.rows:
                emissions.setdefault(row.emission, []).append(row)
        for node in self.order:
            info = self.info(node)
            rows = emissions.get(node)
            nearest[node] = (rows if rows else nearest[info.parent]
                             if info.parent is not None and self.info(info.parent).scope is info.scope else None)
        for scope in self.scopes:
            supported = [row for row in scope.rows if row.support is not None]

            def owner(node):
                if self.count(node.start, node.end):
                    row = self._first(supported, lambda row: row.support[1] <= node.start)
                    if (row is not None and row.support[0] < node.end
                            and self.count(max(node.start, row.support[0]), min(node.end, row.support[1]))):
                        return row
                rows = nearest[node]
                if rows:
                    return self._first(rows, lambda row: (row.support or row.span)[1] < node.start) or rows[-1]
                return self._first(scope.rows, lambda row: row.span[0] < node.start) or (scope.rows[-1] if scope.rows else None)

            for event in buckets.get(scope, ()):
                row = owner(event.node)
                getattr(row.own if row is not None else scope.unowned, event.kind).append(event.diagnostic)
        for scope in reversed(self.scopes):
            for row in scope.rows:
                groups = [self.all(group) if isinstance(group, EmissionScope) else group for group in row.groups]
                for kind in ("errors", "warnings"):
                    displayed = {diagnostic_identity(diagnostic) for group in groups for diagnostic in getattr(group, kind)}
                    own = ordered([diagnostic for diagnostic in getattr(row.own, kind) if diagnostic_identity(diagnostic) not in displayed])
                    own_lists = DiagnosticLists(**{kind: own})
                    setattr(row.token, kind, getattr(join_diagnostics([own_lists, *groups]), kind))
        return self.main.unowned
