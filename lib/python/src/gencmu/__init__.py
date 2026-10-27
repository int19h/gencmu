"""gencmu: a Lojban parser whose grammars are literate documents loaded at
runtime.

    import gencmu

    pipeline = gencmu.load_pipeline("lojban/cll")
    result = pipeline.parse("mi klama", features={"cbm"}, until="words")
    result.ok, result.tree, result.error, result.warnings
    pipeline.features  # (Feature(name="sa-su", kind="gate", default=False),)
    gencmu.to_json(result)
    gencmu.to_brackets(result, show_elided=True)

The engine is specified by ``docs/engine.md`` of the gencmu repository, the
results by ``docs/output.md`` and the API by ``docs/api.md``.
"""

from __future__ import annotations

from ._pipeline import Pipeline, bundled_pipelines, load_pipeline, load_pipeline_file, load_pipeline_sources
from ._errors import GencmuError
from ._model import Action, Expected, Feature, Node, ParseError, ParseResult, ParseWarning, Restoration, Stage, Token
from ._output import result_json, to_brackets, to_json

__all__ = [
    "Action",
    "Pipeline",
    "Expected",
    "Feature",
    "GencmuError",
    "Node",
    "ParseError",
    "ParseResult",
    "ParseWarning",
    "Restoration",
    "Stage",
    "Token",
    "bundled_pipelines",
    "load_pipeline",
    "load_pipeline_file",
    "load_pipeline_sources",
    "result_json",
    "to_brackets",
    "to_json",
]

__version__ = "0.1.0"
