"""A pipeline: the items of a pipeline document, with each ``%include``
replaced by the items of the document it names, assigned to the selected
stage (engine §13)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from ._errors import GencmuError
from ._dom import DeferredDom
from ._markdown import resolve
from ._names import selected_names

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


_LISTS = {
    "rule": "rules",
    "directive": "directives",
    "constant": "constants",
    "classifier": "classifiers",
    "implication": "implications",
}
"""The list of a DOM that holds each kind of item."""


def _empty_dom(format_: Any) -> Dom:
    return {"format": format_, "rules": [], "directives": [], "constants": [], "classifiers": [], "implications": []}


def items_in_order(dom: Dom) -> list[tuple[str, Dom]]:
    """A document's rules, directives, constant definitions, classifiers and
    implications, each tagged ``"rule"``, ``"directive"``, ``"constant"``,
    ``"classifier"`` or ``"implication"``, in the order they were written,
    which is the order of their positions (engine §9)."""
    items = (
        [("rule", rule) for rule in dom["rules"]]
        + [("directive", directive) for directive in dom["directives"]]
        + [("constant", constant) for constant in dom.get("constants", [])]
        + [("classifier", classifier) for classifier in dom.get("classifiers", [])]
        + [("implication", implication) for implication in dom.get("implications", [])]
    )
    items.sort(key=lambda item: (item[1]["at"][0], item[1]["at"][1]))
    return items


def splice_pipeline(path: str, dom_of: Callable[[str], Dom | None], scoped_dom_of=None) -> Pipeline:
    """Splice the pipeline document at ``path``. ``dom_of`` gives a
    document's DOM, or ``None`` when the document does not exist."""
    stages: list[SplicedStage] = []
    # The stages by name, for the check of a second stage of a name.
    named: dict[str, SplicedStage] = {}
    features: set[str] = set()
    declarations = []
    # The run being built: a path and its DOM.
    run: tuple[str, Dom] | None = None
    selected: SplicedStage | None = None
    # The documents being spliced, outermost first, each with its items and
    # the index of the next. A chain of includes is as long as its input
    # makes it, so the walk keeps its own stack, not Python's.
    frames: list[tuple[str, Dom, list[tuple[str, Dom]], list[int], list[str]]] = []
    # The documents of the frames, for the check of an include of itself.
    on_chain: set[str] = set()

    def get_dom(document, inherited):
        return scoped_dom_of(document, inherited) if scoped_dom_of else dom_of(document)

    def enter(document: str, dom: Dom, inherited=()) -> None:
        frames.append((document, dom, items_in_order(dom), [0], selected_names(document, dom, inherited)))
        on_chain.add(document)

    def chain_to(target: str) -> str:
        # Built only for an error, since a copy at each include would cost
        # a deep chain its square.
        return " → ".join([*(frame[0] for frame in frames), target])

    def splice() -> None:
        nonlocal run, selected
        while frames:
            document, dom, items, next_at, names = frames[-1]
            if next_at[0] == len(items):
                frames.pop()
                on_chain.discard(document)
                run = None
                continue
            kind, item = items[next_at[0]]
            next_at[0] += 1
            line, column = int(item["at"][0]), int(item["at"][1])

            def fail(message: str) -> GencmuError:
                return GencmuError(message, document=document, line=line, column=column)

            name = item["name"] if kind == "directive" else None
            if name == "names":
                continue
            if name == "include":
                target = resolve(document, item["args"][0])
                if target in on_chain:
                    raise fail(f"{target} includes itself ({chain_to(target)})")
                included = get_dom(target, names)
                if included is None:
                    raise fail(f"{target} was not found ({chain_to(target)})")
                run = None
                enter(target, included, names)
            elif name == "features" and selected is None:
                if "conditions" in item:
                    raise fail("global features cannot have conditions")
                features.update(item["args"])
            elif name == "stage":
                stage_name = item["args"][0]
                earlier = named.get(stage_name)
                if earlier is not None:
                    raise fail(
                        f"a second stage named {stage_name}; the first is at "
                        f"{earlier.document}:{earlier.at[0]}:{earlier.at[1]}"
                    )
                stages.append(SplicedStage(stage_name, document, (line, column)))
                selected = stages[-1]
                named[stage_name] = selected
                run = None
            elif name in ("extend-stage", "redefine-stage"):
                stage_name = item["args"][0]
                selected = named.get(stage_name)
                if selected is None:
                    raise fail(f"%{name} names an unknown stage {stage_name}")
                if name == "redefine-stage":
                    selected.documents.clear()
                run = None
            else:
                if selected is None:
                    if kind == "rule":
                        what = f"the rule {item['name']}"
                    elif kind == "constant":
                        what = f"the constant ${item['name']}"
                    elif kind == "classifier":
                        what = f"the classifier {item['name']}"
                    elif kind == "implication":
                        what = "%implies"
                    else:
                        what = f"%{name}"
                    raise fail(f"{what} stands before the first %stage")
                if run is None or run[0] != document:
                    run_dom = _empty_dom(dom["format"])
                    if isinstance(dom, DeferredDom):
                        run_dom = DeferredDom(run_dom, [])
                    run = (document, run_dom)
                    selected.documents.append(run)
                run[1][_LISTS[kind]].append(item)
                if name == "features":
                    declarations.append((selected.name, run[1], document, item))
                if kind == "rule" and isinstance(dom, DeferredDom):
                    run[1].deferred_emissions.extend(
                        (rule, problem) for rule, problem in dom.deferred_emissions if rule is item
                    )

    top = get_dom(path, ())
    if top is None:
        raise GencmuError(f"{path} was not found", document=path)
    enter(path, top)
    splice()
    if not stages:
        raise GencmuError("a pipeline needs at least one %stage", document=path)
    for stage in stages:
        if not any(dom["rules"] for _, dom in stage.documents):
            raise GencmuError(f"stage {stage.name} has no rules", document=stage.document, line=stage.at[0], column=stage.at[1])
    surviving = {id(dom) for stage in stages for _, dom in stage.documents}
    owners = {}
    for stage, dom, document, directive in declarations:
        if id(dom) not in surviving:
            continue
        for name in directive["args"]:
            owner = owners.setdefault(name, stage)
            if owner != stage:
                raise GencmuError(f"feature {name} is local to both {owner} and {stage}", document=document,
                                  line=directive["at"][0], column=directive["at"][1], stage=stage)
    return Pipeline(stages, frozenset(features))
