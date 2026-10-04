"""The one part of reading Markdown that is not a grammar: the fenced
``jbogenbau`` blocks of a grammar document (engine §8)."""

from __future__ import annotations

import posixpath
import re
from dataclasses import dataclass

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
    """The grammar text of a document: its ``jbogenbau`` blocks joined with a
    newline between them, and each character's line and column in the
    document, with one more entry for the end of the text."""

    text: str
    positions: list[tuple[int, int]]

    def position(self, index: int) -> tuple[int, int]:
        if not self.positions:
            return (1, 1)
        return self.positions[min(max(index, 0), len(self.positions) - 1)]


INFO = "jbogenbau"
"""The info string of a fenced block that holds grammar text (engine §8)."""


def jbogenbau_text(document: str) -> GrammarText:
    """Find the fenced ``jbogenbau`` blocks of a Markdown document (engine §8)."""
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
        if index >= len(lines) and info.strip() == INFO:
            # A jbogenbau block that is never closed is an error; any other
            # runs to the end of the document, as in CommonMark (engine §8).
            raise GencmuError(f"a {INFO} block is never closed", line=opening, column=1)
        index += 1
        if info.strip() == INFO:
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


def resolve(base: str, target: str) -> str:
    """A path resolved against the path of the document it is in."""
    joined = posixpath.join(posixpath.dirname(base), target) if not target.startswith("/") else target
    normalized = posixpath.normpath(joined)
    # A path in memory is relative to the root of the documents; only the
    # absolute path of a document on disk keeps its leading slash.
    if normalized.startswith("/") and not base.startswith("/"):
        normalized = normalized.lstrip("/")
    return normalized
