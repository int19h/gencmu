"""Fixed diagnostic charges and their additive order (engine §1 and §6)."""

from dataclasses import dataclass


ZERO_MEASURE = (0, 0, 0)


def sum_measure(left, right):
    if left is ZERO_MEASURE:
        return right
    if right is ZERO_MEASURE:
        return left
    return tuple(a + b for a, b in zip(left, right))


def compare_measure(left, right):
    for index in range(3):
        if left[index] != right[index]:
            order = -1 if left[index] < right[index] else 1
            return -order if index == 2 else order
    return 0


@dataclass(frozen=True, eq=False)
class DiagnosticIdentity:
    stage_order: int = 0
    ordinal: int = 0

    def __deepcopy__(self, memo):
        return self


@dataclass(frozen=True)
class DiagnosticRecord:
    measure: tuple[int, int, int]
    identity: DiagnosticIdentity


def record_diagnostic(diagnostic, measure, identity=None):
    diagnostic._diagnostic_record = DiagnosticRecord(tuple(measure), identity if identity is not None else DiagnosticIdentity())
    return diagnostic


def diagnostic_record(diagnostic):
    return diagnostic._diagnostic_record


def copy_diagnostic_record(original, duplicate):
    record = getattr(original, "_diagnostic_record", None)
    if record is not None:
        duplicate._diagnostic_record = record
    return duplicate


class Measures:
    def __init__(self, tokens, sources=None):
        if sources is None:
            from ._earley import Sources
            sources = Sources(tokens)
        self.sources = sources
        self.original = None
        self.nonempty = [0]
        self.carried = []
        for token in tokens:
            self.nonempty.append(self.nonempty[-1] + (token.source[0] < token.source[1]))
            measure = ZERO_MEASURE
            for diagnostic in token.errors:
                measure = sum_measure(measure, diagnostic_record(diagnostic).measure)
            self.carried.append(measure)

    def own(self, start, end):
        if self.original is not None:
            measures, project = self.original
            return measures.own(project[start], project[end])
        if self.nonempty[end] == self.nonempty[start]:
            return 0, 1, 1
        low, high = self.sources.of(start, end)
        return high - low, 0, 1
