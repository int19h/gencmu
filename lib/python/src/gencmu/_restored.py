"""Restored tokens and their source projection (engine §7.2 and §7.3)."""

from dataclasses import dataclass

from ._model import Range, Restoration, Token


def empty_source(tokens: list[Token], position: int) -> Range:
    at = tokens[position - 1].source[1] if position else tokens[0].source[0] if tokens else 0
    return at, at


@dataclass
class Restored:
    tokens: list[Token]
    synthetic: list[bool]
    project: list[int]
    original_at: list[int]
    record_at: list[int]
    record_of: list[int]


def restore(tokens: list[Token], records: list[Restoration]) -> Restored:
    """Keep original token objects and mark synthetic tokens by provenance."""
    restored, synthetic, project = [], [], [0]
    original_at, record_at, record_of = [], [], []
    pending = 0
    for index in range(len(tokens) + 1):
        while pending < len(records) and records[pending].at == index:
            record = records[pending]
            record_at.append(len(restored))
            record_of.append(pending)
            restored.append(Token("", frozenset((record.terminal,)), (len(restored), len(restored)), record.source, record.sound))
            synthetic.append(True)
            project.append(index)
            pending += 1
        if index < len(tokens):
            original_at.append(len(restored))
            record_of.append(-1)
            restored.append(tokens[index])
            synthetic.append(False)
            project.append(index + 1)
    return Restored(restored, synthetic, project, original_at, record_at, record_of)
