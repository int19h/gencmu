"""Select constituent channels and find their dependencies (engine §11)."""

from __future__ import annotations

from typing import Any


class Recipe(dict):
    """Keep a source position outside the canonical DOM members."""

    def __init__(self, atoms, at):
        super().__init__(concat=atoms)
        self.at = at


def selected(value: Any, image: Any) -> tuple[Any, Any]:
    return value, image if image is not None else value


def channels(alternative: Any, definition: Any) -> tuple[Any, Any]:
    value = alternative.get("value", definition.get("value"))
    image = alternative.get("image", definition.get("image"))
    return selected(value, image)


def own_dependencies(recipe: Any) -> list[str]:
    if recipe is None:
        return []
    dependencies = []
    for atom in recipe["concat"]:
        receiver = atom.get("receiver", {})
        if atom.get("method") in ("value", "image") and receiver.get("method") == "emitted" and receiver["receiver"] == {"capture": ""}:
            dependencies.append(atom["method"])
    return dependencies


def cycle(value: Any, image: Any) -> tuple[Any, list[str]] | None:
    recipes = dict(zip(("value", "image"), selected(value, image)))
    done: set[str] = set()

    def channel(name: str) -> str:
        return "value" if name == "image" and image is None else name

    for start in ("value", "image"):
        start = channel(start)
        if start in done:
            continue
        stack = [(start, iter(own_dependencies(recipes[start])))]
        while stack:
            current, dependencies = stack[-1]
            dependency = next(dependencies, None)
            if dependency is None:
                done.add(current)
                stack.pop()
                continue
            dependency = channel(dependency)
            path = [name for name, _ in stack]
            if dependency in path:
                return recipes[current], [*path, dependency]
            if dependency not in done:
                stack.append((dependency, iter(own_dependencies(recipes[dependency]))))
    return None
