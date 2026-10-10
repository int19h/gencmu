"""The one exception type the library raises."""

from __future__ import annotations

from dataclasses import dataclass
from copy import deepcopy
import json


class GencmuError(Exception):
    """A dialect that cannot be loaded, or a caller's mistake.

    ``kind`` is ``"grammar"`` for a grammar or pipeline document that cannot
    be read, stitched or lowered, and ``"usage"`` for a mistake in a call,
    such as an unknown stage name. ``where`` is ``document:line:column`` so
    far as it is known, or ``None``; the parts are also attributes.
    """

    def __init__(
        self,
        message: str,
        *,
        kind: str = "grammar",
        document: str | None = None,
        line: int | None = None,
        column: int | None = None,
        stage: str | None = None,
        code: str | None = None,
        group: dict | None = None,
        option: int | None = None,
        expression: object = None,
        inheritance: list | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.kind = kind
        self.document = document
        self.line = line
        self.column = column
        self.stage = stage
        self.code, self.group, self.option = code, group, option
        self.expression, self.inheritance = expression, inheritance

    def to_dict(self) -> dict:
        """Returns the canonical loading diagnostic value."""
        value = {'kind': self.kind}
        if self.code is not None:
            value['code'] = self.code
        value['message'] = str(self)
        for name in ('group', 'option', 'expression', 'inheritance'):
            field = getattr(self, name)
            if field is not None:
                value[name] = deepcopy(field)
        return value

    def to_json(self) -> str:
        """Writes the canonical loading diagnostic schema."""
        return json.dumps(self.to_dict(), ensure_ascii=False, separators=(',', ':'))

    @property
    def where(self) -> str | None:
        parts: list[str] = []
        if self.document is not None:
            parts.append(self.document)
        if self.line is not None:
            parts.append(str(self.line))
            if self.column is not None:
                parts.append(str(self.column))
        return ":".join(parts) if parts else None

    def __str__(self) -> str:
        if self.document == "notation/bootstrap.json" and self.message.startswith("notation/bootstrap.json:"):
            return self.message
        where = self.where
        prefix = f"{where}: " if where else ""
        stage = f" (stage {self.stage})" if self.stage and not where else ""
        return f"{prefix}{self.message}{stage}"


@dataclass(frozen=True)
class ErrorData:
    """What a :class:`GencmuError` says, without the error itself. A cache
    keeps this, and raises a new error each time. An error that is raised
    again keeps the frames of each raise in its traceback, and so the text
    and the tokens of every parse that met it."""

    message: str
    kind: str
    document: str | None
    line: int | None
    column: int | None
    stage: str | None
    code: str | None = None
    group: dict | None = None
    option: int | None = None
    expression: object = None
    inheritance: list | None = None

    @staticmethod
    def of(error: GencmuError) -> ErrorData:
        return ErrorData(error.message, error.kind, error.document, error.line, error.column, error.stage, error.code, deepcopy(error.group), error.option, deepcopy(error.expression), deepcopy(error.inheritance))

    def error(self) -> GencmuError:
        return GencmuError(
            self.message, kind=self.kind, document=self.document, line=self.line, column=self.column, stage=self.stage, code=self.code, group=deepcopy(self.group), option=self.option, expression=deepcopy(self.expression), inheritance=deepcopy(self.inheritance)
        )


class _GrammarFault(Exception):
    """A defect of a grammar found while parsing: a nested parse asked about
    its own span, two phoneme tags on one token, a term of the wrong
    type. It ends the parse with an error of kind ``grammar``, which has the
    stage and no position (engine §13)."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message
