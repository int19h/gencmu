"""The one exception type the library raises."""

from __future__ import annotations


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
    ) -> None:
        super().__init__(message)
        self.message = message
        self.kind = kind
        self.document = document
        self.line = line
        self.column = column
        self.stage = stage

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
        where = self.where
        prefix = f"{where}: " if where else ""
        stage = f" (stage {self.stage})" if self.stage and not where else ""
        return f"{prefix}{self.message}{stage}"


class _GrammarFault(Exception):
    """A defect of a grammar found while parsing: a nested parse asked about
    its own span, two strong phoneme tags on one token, a term of the wrong
    type. It ends the parse with an error of kind ``grammar``."""

    def __init__(self, message: str, span: tuple[int, int] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.span = span
