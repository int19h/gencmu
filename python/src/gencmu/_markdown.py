"""The two parts of reading Markdown that are not grammars: the fenced
``ebnf`` blocks of a grammar document (engine §8) and the processing
instructions of a pipeline document (design, "Pipelines")."""

from __future__ import annotations

import posixpath
import re
from dataclasses import dataclass, field

from ._errors import GencmuError

_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
_LINE_BREAK = re.compile(r"\r\n|\r|\n")


def split_lines(text: str) -> list[str]:
    """The lines of a text, split at ``\\n``, ``\\r\\n`` and ``\\r``."""
    return _LINE_BREAK.split(text)


def line_column(text: str, index: int) -> tuple[int, int]:
    """The 1-based line and column of a code point index."""
    line = 1
    start = 0
    for match in _LINE_BREAK.finditer(text, 0, index):
        if match.end() > index:
            break
        line += 1
        start = match.end()
    return line, index - start + 1


@dataclass
class GrammarText:
    """The grammar text of a document: its ``ebnf`` blocks joined with a
    newline between them, and each character's line and column in the
    document, with one more entry for the end of the text."""

    text: str
    positions: list[tuple[int, int]]

    def position(self, index: int) -> tuple[int, int]:
        if not self.positions:
            return (1, 1)
        return self.positions[min(max(index, 0), len(self.positions) - 1)]


def ebnf_text(document: str) -> GrammarText:
    """Find the fenced ``ebnf`` blocks of a Markdown document (engine §8)."""
    lines = split_lines(document)
    blocks: list[list[tuple[int, str]]] = []
    index = 0
    while index < len(lines):
        match = _FENCE.match(lines[index])
        if match is None:
            index += 1
            continue
        fence, info = match.group(1), match.group(2)
        if fence[0] == "`" and "`" in info:
            index += 1
            continue
        closing = re.compile(r"^ {0,3}" + re.escape(fence[0]) + "{" + str(len(fence)) + r",}[ \t]*$")
        body: list[tuple[int, str]] = []
        opening = index + 1
        index += 1
        while index < len(lines) and closing.match(lines[index]) is None:
            body.append((index + 1, lines[index]))
            index += 1
        if index >= len(lines):
            # Were a block that is never closed to run to the end, a missing
            # fence would silently make the rest of the document grammar, or
            # hide it.
            raise GencmuError("a fenced code block is never closed", line=opening, column=1)
        index += 1
        if info.strip() == "ebnf":
            blocks.append(body)
    chars: list[str] = []
    positions: list[tuple[int, int]] = []
    last = (1, 1)
    for number, block in enumerate(blocks):
        if number > 0:
            chars.append("\n")
            positions.append(last)
        for row, (line_number, line) in enumerate(block):
            if row > 0:
                chars.append("\n")
                positions.append(last)
            for column, char in enumerate(line, 1):
                chars.append(char)
                positions.append((line_number, column))
            last = (line_number, len(line) + 1)
    positions.append(last)
    return GrammarText("".join(chars), positions)


_INSTRUCTION = re.compile(r"<\?(stage|grammar|features)(?=[\s?])([^?]*)\?>")
_LINK = re.compile(r"\[[^\]]*\]\(([^\s()\\]*)\)")
_FEATURE = re.compile(r"[A-Za-z][A-Za-z0-9-]*")
_STAGE_NAME = re.compile(r"[^\s<>?]+")


@dataclass
class PipelineStage:
    name: str
    documents: list[str] = field(default_factory=list)


@dataclass
class Pipeline:
    stages: list[PipelineStage]
    features: frozenset[str]


def resolve(base: str, target: str) -> str:
    """A link target resolved against the path of the document it is in."""
    joined = posixpath.join(posixpath.dirname(base), target) if not target.startswith("/") else target
    normalized = posixpath.normpath(joined)
    if normalized.startswith("/"):
        normalized = normalized.lstrip("/")
    return normalized


def read_pipeline(text: str, path: str) -> Pipeline:
    """Read a pipeline document's stages, documents and features."""
    stages: list[PipelineStage] = []
    features: set[str] = set()
    names: set[str] = set()
    for number, line in enumerate(split_lines(text), 1):
        found = list(_INSTRUCTION.finditer(line))
        if not found:
            continue

        def fail(message: str) -> GencmuError:
            return GencmuError(message, document=path, line=number, column=found[0].start() + 1)

        if len(found) > 1:
            raise fail("a line holds at most one processing instruction")
        match = found[0]
        if line[match.end():].strip():
            continue
        kind, argument = match.group(1), match.group(2).strip()
        if kind == "stage":
            if not line.lstrip().startswith("#"):
                raise fail("<?stage?> must end a heading")
            if not _STAGE_NAME.fullmatch(argument):
                raise fail(f"a malformed stage name: {argument!r}")
            if argument in names:
                raise fail(f"two stages are named {argument}")
            names.add(argument)
            stages.append(PipelineStage(argument))
        elif kind == "grammar":
            if argument:
                raise fail("<?grammar?> takes no argument")
            if not stages:
                raise fail("<?grammar?> before any <?stage?>")
            link = _LINK.search(line[: match.start()])
            if link is None or not link.group(1):
                raise fail("a <?grammar?> line without a link [text](path)")
            stages[-1].documents.append(resolve(path, link.group(1)))
        else:
            words = argument.split()
            if not words:
                raise fail("<?features?> names no feature")
            for word in words:
                if not _FEATURE.fullmatch(word):
                    raise fail(f"a malformed feature name: {word!r}")
            features.update(words)
    if not stages:
        raise GencmuError("the pipeline has no <?stage?>", document=path)
    return Pipeline(stages, frozenset(features))
