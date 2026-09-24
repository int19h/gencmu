"""Helpers for the shared test cases of the repository's tests/ directory."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import gencmu
from gencmu._model import Token

REPOSITORY = Path(__file__).resolve().parents[2]
SHARED = REPOSITORY / "tests"


def cases(kind: str) -> list[Path]:
    return sorted((SHARED / kind).glob("*.json"))


def load_case(path: Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as file:
        return json.load(file)  # type: ignore[no-any-return]


def mismatch(pattern: Any, value: Any, where: str = "$") -> str | None:
    """Where a value fails to match a pattern (tests/README.md), or None."""
    if isinstance(pattern, dict):
        if not isinstance(value, dict):
            return f"{where}: expected an object, found {json.dumps(value, ensure_ascii=False)[:200]}"
        for key, expected in pattern.items():
            if key not in value:
                return f"{where}.{key}: missing"
            found = mismatch(expected, value[key], f"{where}.{key}")
            if found:
                return found
        return None
    if isinstance(pattern, list):
        if not isinstance(value, list) or len(value) != len(pattern):
            return f"{where}: expected {len(pattern)} elements, found {json.dumps(value, ensure_ascii=False)[:200]}"
        for index, (expected, found_value) in enumerate(zip(pattern, value)):
            found = mismatch(expected, found_value, f"{where}[{index}]")
            if found:
                return found
        return None
    if pattern != value or type(pattern) is not type(value):
        return f"{where}: expected {json.dumps(pattern, ensure_ascii=False)}, found {json.dumps(value, ensure_ascii=False)}"
    return None


def case_sources(case: dict[str, Any]) -> tuple[dict[str, str], str]:
    if "grammar" in case:
        grammar = case["grammar"]
        if "%ambiguity-resolution" not in grammar:
            grammar = "%ambiguity-resolution greedy ;\n" + grammar
        return (
            {
                "p.md": "## Main <?stage main?>\n\n- [main](main.md) <?grammar?>\n",
                "main.md": "```ebnf\n" + grammar + "\n```\n",
            },
            "p.md",
        )
    return dict(case["documents"]), case["pipeline"]


def case_tokens(case: dict[str, Any]) -> tuple[list[Token], str]:
    tokens: list[Token] = []
    position = 0
    for index, spec in enumerate(case["tokens"]):
        tags = {tag[1:] if tag.startswith("?") else tag: not tag.startswith("?") for tag in spec["tags"]}
        text = spec["text"]
        tokens.append(Token(text, tags, (index, index + 1), (position, position + len(text)), spec.get("phonemes")))
        position += len(text) + 1
    return tokens, " ".join(spec["text"] for spec in case["tokens"])


def run_case(case: dict[str, Any], use_cache: bool = True) -> tuple[dict[str, Any] | None, gencmu.ParseResult | None, gencmu.GencmuError | None]:
    sources, pipeline = case_sources(case)
    try:
        dialect = gencmu.load_dialect_sources(sources, pipeline, use_cache=use_cache)
    except gencmu.GencmuError as error:
        return None, None, error
    options = case.get("options", {})
    kwargs: dict[str, Any] = {
        "features": options.get("features", []),
        "auto_features": options.get("autoFeatures", False),
        "until": options.get("until"),
        "elision_only": options.get("elisionOnly"),
    }
    if "tokens" in case:
        tokens, text = case_tokens(case)
        result = dialect.parse_tokens(tokens, text, **kwargs)
    else:
        result = dialect.parse(case.get("input", ""), **kwargs)
    return gencmu.result_json(result), result, None
