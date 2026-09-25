"""The data a parse hands back (docs/output.md), and a dialect's features,
as dataclasses."""

from __future__ import annotations

from dataclasses import dataclass, field

Tags = dict[str, bool]
"""A tag set: tag name to strength, ``True`` for strong."""

Range = tuple[int, int]
"""A half-open range ``(start, end)``."""


@dataclass
class Token:
    """A token a stage reads or writes (engine §1).

    ``span`` is the range of the previous stage's tokens it covers, and
    ``source`` the range of the original text, in code points. ``phonemes``
    is ``None`` for a token that has none, such as a character.
    ``inserted_by`` names the rule whose emission clause made a token with
    an empty span. ``verbatim`` is true for a verbatim token, whose
    phonemes are its text (engine §11).
    """

    text: str
    tags: Tags
    span: Range
    source: Range
    phonemes: str | None = None
    inserted_by: str | None = None
    verbatim: bool = False


@dataclass
class Node:
    """A node of a stage's tree (engine §12).

    ``kind`` is ``"rule"``, ``"token"`` or ``"elided"``. A rule node has
    ``rule``, ``tags`` and ``children``; a token node has ``terminal`` and
    ``token``, the index of the stage-input token it read; an elided node
    has ``terminal``, the terminator it stands for.
    """

    kind: str
    span: Range
    source: Range
    rule: str | None = None
    terminal: str | None = None
    token: int | None = None
    tags: Tags | None = None
    children: list[Node] = field(default_factory=list)


@dataclass
class Action:
    """One step of a derivation, as a tie's witness shows it (engine §6):
    a ``"read"`` of ``token`` as ``terminal``, or a ``"close"`` of
    ``production`` of ``rule`` over ``span``."""

    kind: str
    token: int | None = None
    terminal: str | None = None
    rule: str | None = None
    production: int | None = None
    span: Range | None = None


@dataclass
class Expected:
    """A terminal a rejected stage could have read next, and the rules whose
    items could have read it."""

    terminal: str
    rules: list[str]


@dataclass
class ParseError:
    """Why a parse failed: ``kind`` is ``"rejected"``, ``"ambiguous"`` or
    ``"grammar"`` (docs/output.md, "Error")."""

    kind: str
    message: str
    stage: str | None = None
    token: int | None = None
    source: Range | None = None
    document: str | None = None
    line: int | None = None
    column: int | None = None
    expected: list[Expected] | None = None
    readings: list[Node] | None = None


@dataclass
class Stage:
    """One stage of a run: its verdict (``"unique"``, ``"resolved"``,
    ``"tie"``, or ``None`` if it did not accept), the tie's witness and tied
    tree, its input tokens and, if it accepted, the tokens it emitted."""

    name: str
    verdict: str | None
    input: list[Token]
    output: list[Token] | None = None
    witness: tuple[Action, Action] | None = None
    tied: Node | None = None
    tree: Node | None = None


@dataclass
class ParseWarning:
    """A warning (engine §12): a rule node of a stage's chosen tree whose
    alternative has a warning ``@feature!``, while the feature is on.
    ``span`` is the node's range of the stage's input tokens, and ``source``
    its range of the original text. Not called ``Warning``, which is a
    built-in exception."""

    stage: str
    feature: str
    rule: str
    span: Range
    source: Range


@dataclass
class ParseResult:
    """The result of a parse: ``ok`` when every stage run accepted without an
    error, the stages run, the last stage's ``tree``, the ``error``, and the
    ``warnings`` of every stage run, in stage order, whether or not the
    parse is ``ok``."""

    ok: bool
    stages: list[Stage]
    tree: Node | None
    error: ParseError | None
    text: str = ""
    warnings: list[ParseWarning] = field(default_factory=list)


@dataclass(frozen=True)
class Feature:
    """One of a dialect's features (engine §13): its ``name``, its ``kind``,
    ``"gate"`` or ``"warning"``, and whether the pipeline's
    ``<?features?>`` turns it on by ``default``."""

    name: str
    kind: str
    default: bool
