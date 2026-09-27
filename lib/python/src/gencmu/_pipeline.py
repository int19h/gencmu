"""A pipeline: the items of a pipeline document, with each ``%include``
replaced by the items of the document it names, split into stages at each
``%stage`` (engine §13)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from ._errors import GencmuError
from ._markdown import resolve

Dom = dict[str, Any]


@dataclass
class SplicedStage:
    """One stage of a spliced pipeline: its name, where its ``%stage``
    stands, and its items as runs of consecutive items of one document, each
    a path and a DOM that holds exactly those items."""

    name: str
    document: str
    at: tuple[int, int]
    documents: list[tuple[str, Dom]] = field(default_factory=list)


@dataclass
class Pipeline:
    """A spliced pipeline: its stages, and the features it turns on."""

    stages: list[SplicedStage]
    features: frozenset[str]


def items_in_order(dom: Dom) -> list[tuple[str, Dom]]:
    """A document's rules and directives, each tagged ``"rule"`` or
    ``"directive"``, in the order they were written, which is the order of
    their positions (engine §9)."""
    items = [("rule", rule) for rule in dom["rules"]] + [("directive", directive) for directive in dom["directives"]]
    items.sort(key=lambda item: (item[1]["at"][0], item[1]["at"][1]))
    return items


def splice_pipeline(path: str, dom_of: Callable[[str], Dom | None]) -> Pipeline:
    """Splice the pipeline document at ``path``. ``dom_of`` gives a
    document's DOM, or ``None`` when the document does not exist."""
    stages: list[SplicedStage] = []
    features: set[str] = set()
    # The run being built: a path and its DOM.
    run: tuple[str, Dom] | None = None

    def splice(document: str, dom: Dom, chain: list[str]) -> None:
        nonlocal run
        for kind, item in items_in_order(dom):
            line, column = int(item["at"][0]), int(item["at"][1])

            def fail(message: str) -> GencmuError:
                return GencmuError(message, document=document, line=line, column=column)

            name = item["name"] if kind == "directive" else None
            if name == "include":
                target = resolve(document, item["args"][0])
                through = " → ".join([*chain, document, target])
                if target in chain or target == document:
                    raise fail(f"{target} includes itself ({through})")
                included = dom_of(target)
                if included is None:
                    raise fail(f"{target} was not found ({through})")
                run = None
                splice(target, included, [*chain, document])
                run = None
            elif name == "features":
                features.update(item["args"])
            elif name == "stage":
                stage_name = item["args"][0]
                for earlier in stages:
                    if earlier.name == stage_name:
                        raise fail(
                            f"a second stage named {stage_name}; the first is at "
                            f"{earlier.document}:{earlier.at[0]}:{earlier.at[1]}"
                        )
                stages.append(SplicedStage(stage_name, document, (line, column)))
                run = None
            else:
                if not stages:
                    what = f"the rule {item['name']}" if kind == "rule" else f"%{name}"
                    raise fail(f"{what} stands before the first %stage")
                if run is None or run[0] != document:
                    run = (document, {"format": dom["format"], "rules": [], "directives": []})
                    stages[-1].documents.append(run)
                run[1]["rules" if kind == "rule" else "directives"].append(item)

    top = dom_of(path)
    if top is None:
        raise GencmuError(f"{path} was not found", document=path)
    splice(path, top, [])
    if not stages:
        raise GencmuError("a pipeline needs at least one %stage", document=path)
    for stage in stages:
        if not any(dom["rules"] for _, dom in stage.documents):
            raise GencmuError(f"stage {stage.name} has no rules", document=stage.document, line=stage.at[0], column=stage.at[1])
    return Pipeline(stages, frozenset(features))
