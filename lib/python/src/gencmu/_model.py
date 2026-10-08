"""The data a parse hands back (docs/output.md), and a dialect's features,
as dataclasses."""

from __future__ import annotations

from dataclasses import dataclass, field, fields
from typing import Any

Tags = frozenset[str]
"""A tag set: the tags it holds, each in its canonical spelling (engine §1).
A tag has no strength."""

Range = tuple[int, int]
"""A half-open range ``(start, end)``."""


@dataclass
class Token:
    """A token a stage reads or writes (engine §1).

    ``span`` is the range of the previous stage's tokens it covers, and
    ``source`` the range of the original text, in code points. ``phonemes``
    is ``None`` for a token that has none, such as a character, whose only
    tag is its character tag.
    ``inserted_by`` names the rule whose emission clause made a token with
    an empty span. ``label`` is what the token shows to people (engine §5).
    It defaults to the token's text, which is the label of a character
    token and of a token that a caller supplies.
    ``before`` and ``after`` are the token's attachments (engine §11):
    tokens that belong to it and that no later stage reads. A caller cannot
    supply them. An attached token has no span, so its ``span`` is
    ``None``; its ``source`` stays in the coordinates of the original text.
    """

    text: str
    tags: Tags
    span: Range | None
    source: Range
    phonemes: str | None = None
    inserted_by: str | None = None
    label: str = None  # type: ignore[assignment]
    before: list[Token] = field(default_factory=list)
    after: list[Token] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.label is None:
            self.label = self.text

    # Attachments nest as deep as a text is long, so equality and the
    # representation walk them with a list for a stack. They give what the
    # dataclass's own methods would.
    def __eq__(self, other: object) -> bool:
        if other.__class__ is not self.__class__:
            return NotImplemented
        return _equal(self, other)

    def __repr__(self) -> str:
        return _represent(self)


@dataclass
class Node:
    """A node of a stage's tree (engine §12).

    ``kind`` is ``"rule"``, ``"token"`` or ``"elided"``. A rule node has
    ``rule``, ``tags`` and ``children``; a token node has ``terminal`` and
    ``token``, the index of the stage-input token it read. That terminal is
    a tag, or the written form of a range or a property, such as
    ``'a'..'z'`` or ``'\\p{L}'`` (engine §4). An elided node
    has ``terminal``, the terminator it stands for, and ``sound``, the
    string of the terminator's ``=`` test if it has one, which elision-only's
    restored token sounds like (engine §7) and the output does not show.
    """

    kind: str
    span: Range
    source: Range
    rule: str | None = None
    terminal: str | None = None
    token: int | None = None
    tags: Tags | None = None
    children: list[Node] = field(default_factory=list)
    sound: str | None = None

    # A tree nests as deep as a text is long, so equality and the
    # representation walk it with a list for a stack. They give what the
    # dataclass's own methods would.
    def __eq__(self, other: object) -> bool:
        if other.__class__ is not self.__class__:
            return NotImplemented
        return _equal(self, other)

    def __repr__(self) -> str:
        return _represent(self)


_NESTED = (Token, Node)
"""The classes whose instances nest as deep as a text is long."""

_FIELDS = {cls: tuple(item.name for item in fields(cls)) for cls in _NESTED}


def _equal(left: Any, right: Any) -> bool:
    """Whether two tokens or two nodes are equal, field by field, as the
    dataclass's own equality says."""
    pending: list[tuple[Any, Any]] = [(left, right)]
    while pending:
        one, other = pending.pop()
        if one is other:
            continue
        if isinstance(one, _NESTED) and one.__class__ is other.__class__:
            pending.extend((getattr(one, name), getattr(other, name)) for name in _FIELDS[one.__class__])
        elif isinstance(one, list) and isinstance(other, list):
            if len(one) != len(other):
                return False
            pending.extend(zip(one, other))
        elif not one == other:
            return False
    return True


def _represent(value: Any) -> str:
    """A token's or a node's representation, as the dataclass's own would
    write it."""
    out: list[str] = []
    # Each entry is text to write, or a value to write.
    pending: list[tuple[bool, Any]] = [(False, value)]
    while pending:
        literal, item = pending.pop()
        if literal:
            out.append(item)
        elif isinstance(item, _NESTED):
            parts: list[tuple[bool, Any]] = [(True, item.__class__.__qualname__ + "(")]
            for position, name in enumerate(_FIELDS[item.__class__]):
                parts.append((True, (", " if position else "") + name + "="))
                parts.append((False, getattr(item, name)))
            parts.append((True, ")"))
            pending.extend(reversed(parts))
        elif isinstance(item, list) and any(isinstance(member, _NESTED) for member in item):
            parts = [(True, "[")]
            for position, member in enumerate(item):
                if position:
                    parts.append((True, ", "))
                parts.append((False, member))
            parts.append((True, "]"))
            pending.extend(reversed(parts))
        else:
            out.append(repr(item))
    return "".join(out)


@dataclass
class Action:
    """One step of a derivation, as a witness shows it (engine §6): a
    ``"read"`` of ``token`` as ``terminal``, or a ``"close"`` of
    ``production`` of ``rule`` over ``span``. In the witness of an error of
    elision-only, it can also be an ``"elided"`` read, as ``terminal``, of a
    terminator that the check wrote back at ``at``, a position in the
    stage's input (engine §7.10)."""

    kind: str
    token: int | None = None
    terminal: str | None = None
    rule: str | None = None
    production: int | None = None
    span: Range | None = None
    at: int | None = None


@dataclass
class Expected:
    """A terminal a rejected stage could have read next, and the rules whose
    items could have read it."""

    terminal: str
    rules: list[str]


@dataclass
class ParseError:
    """Why a parse failed: ``kind`` is ``"rejected"``, ``"ambiguous"`` or
    ``"grammar"`` (docs/output.md, "Error").

    An ambiguous error has a ``reason``: ``"tie"`` where a stage has two or
    more best readings (engine §6), or ``"elision-only"`` where the check of
    engine §7 fails. Its ``readings`` hold two trees for an ordinary tie.
    A comparison cycle holds at least three trees and each edge in ``cycle``.
    An ordinary elision-only error also holds the first differing actions in ``witness``.
    A cycle under elision-only holds ``chosen_reading`` equal to zero.

    A grammar error has the ``code`` ``"elision-witness-lost"`` where the
    check of engine §7 lost its chosen derivation, a defect of the library
    (engine §7.9). Such an error also has ``chosen``, the chosen tree, and
    ``completion``, the terminators that the check wrote back. Any other
    error has no ``code``."""

    kind: str
    message: str
    stage: str | None = None
    code: str | None = None
    reason: str | None = None
    token: int | None = None
    source: Range | None = None
    document: str | None = None
    line: int | None = None
    column: int | None = None
    expected: list[Expected] | None = None
    readings: list[Node] | None = None
    chosen: Node | None = None
    completion: list[Restoration] | None = None
    witness: tuple[Action, Action] | None = None
    cycle: list[dict[str, Any]] | None = None
    conflict: dict[str, Any] | None = None
    chosen_reading: int | None = None


@dataclass(frozen=True)
class Restoration:
    """A terminator that the check of elision-only wrote back (engine §7.9):
    its terminal, its position in the stage's input, the empty source of its
    elided node, and the sound of a terminator with an ``=`` test."""

    terminal: str
    at: int
    source: Range
    sound: str | None = None


@dataclass
class Stage:
    """One stage of a run: its verdict (``"unique"``, ``"resolved"``,
    ``"tie"``, or ``None`` if it did not accept), its input tokens and, if
    it chose a derivation, its tree and the tokens it emitted.

    A tied stage has its ``witness``, the pair of actions where the two
    readings of the tie first differ, with the first reading's first. It has
    no tree and no output, and its two readings are in the result's error
    (engine §6)."""

    name: str
    verdict: str | None
    input: list[Token]
    output: list[Token] | None = None
    witness: tuple[Action, Action] | None = None
    tree: Node | None = None


@dataclass
class ParseWarning:
    """A warning (engine §12): a rule node of a stage's chosen tree whose
    alternative has a warning ``feature!``, while the feature is on.
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
    ``%features`` turns it on by ``default``."""

    name: str
    kind: str
    default: bool
