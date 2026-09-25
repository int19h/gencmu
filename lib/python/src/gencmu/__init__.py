"""gencmu: a Lojban parser whose grammars are literate documents loaded at
runtime.

    import gencmu

    dialect = gencmu.load_dialect("cll")
    result = dialect.parse("mi klama", features={"cbm"}, until="words")
    result.ok, result.tree, result.error
    gencmu.to_json(result)
    gencmu.to_brackets(result, show_elided=True)

The engine is specified by ``docs/engine.md`` of the gencmu repository, the
results by ``docs/output.md`` and the API by ``docs/api.md``.
"""

from __future__ import annotations

from ._dialect import Dialect, load_dialect, load_dialect_file, load_dialect_sources
from ._errors import GencmuError
from ._model import Action, Expected, Node, ParseError, ParseResult, Stage, Token
from ._output import result_json, to_brackets, to_json

__all__ = [
    "Action",
    "Dialect",
    "Expected",
    "GencmuError",
    "Node",
    "ParseError",
    "ParseResult",
    "Stage",
    "Token",
    "load_dialect",
    "load_dialect_file",
    "load_dialect_sources",
    "result_json",
    "to_brackets",
    "to_json",
]

__version__ = "0.1.0"
