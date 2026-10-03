"""Helpers for the shared test cases of the repository's tests/ directory."""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import replace
import faulthandler
import json
import os
from pathlib import Path
import signal
import sys
import threading
from typing import Any, Iterator

import gencmu
from gencmu._model import Token
from gencmu._tags import is_tag

from .witness import checks

REPOSITORY = Path(__file__).resolve().parents[3]
SHARED = REPOSITORY / "tests"

CASE_SECONDS = float(os.environ.get("GENCMU_CASE_TIMEOUT", "60"))
"""How long one shared case may run before the runner reports it as a
failure. GENCMU_CASE_TIMEOUT sets it."""


class CaseTimeout(AssertionError):
    """A shared case that ran past its time, reported as a failure."""


@contextmanager
def deadline(label: str, seconds: float = CASE_SECONDS) -> Iterator[None]:
    """Fail a case that runs longer than ``seconds``, so that a hang is a
    failure and not a run that never ends. Where the process can have an
    alarm signal, the case fails with :class:`CaseTimeout` and the other
    cases go on. Elsewhere the process ends with a traceback of every
    thread, which fails the run."""
    alarm = hasattr(signal, "setitimer") and threading.current_thread() is threading.main_thread()
    if not alarm:
        faulthandler.dump_traceback_later(seconds, exit=True, file=sys.stderr)
        try:
            yield
        finally:
            faulthandler.cancel_dump_traceback_later()
        return

    def expire(signum: int, frame: Any) -> None:
        raise CaseTimeout(f"{label} ran for more than {seconds:g} seconds")

    previous = signal.signal(signal.SIGALRM, expire)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


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


def result_problems(value: dict[str, Any]) -> list[str]:
    """What a canonical result breaks of the invariants that every runner
    checks on every result, whatever the case expects (tests/README.md): an
    ambiguous error has no token or source, no stage has a tied tree, and a stage whose verdict is tie has no output,
    comes last, and has the result's ambiguous error with the reason tie,
    its name and two readings."""
    problems: list[str] = []
    stages = value["stages"]
    error = value["error"]
    # An ambiguous error has no position (docs/output.md).
    if isinstance(error, dict) and error.get("kind") == "ambiguous":
        for member in ("token", "source"):
            if member in error:
                problems.append(f"the ambiguous error has a member {member}")
    # An error that loses the witness of elision-only is a grammar error of
    # the last stage, with its chosen tree and completion, and nothing else
    # (engine §7.9).
    if isinstance(error, dict) and error.get("code") == "elision-witness-lost":
        if (
            error.get("kind") != "grammar"
            or not isinstance(error.get("stage"), str)
            or "chosen" not in error
            or not isinstance(error.get("completion"), list)
        ):
            problems.append("the elision-witness-lost error lacks its kind grammar, stage, chosen or completion")
        for member in ("token", "source", "line", "column", "expected", "reason", "readings"):
            if member in error:
                problems.append(f"the elision-witness-lost error has a member {member}")
        last = stages[-1] if stages else None
        if last is None or last["name"] != error.get("stage") or last["verdict"] != "resolved" or "output" in last:
            problems.append("the stage of the elision-witness-lost error is not the last, resolved, with no output")
    for index, stage in enumerate(stages):
        if "tied" in stage:
            problems.append(f"stage {stage['name']} has a tied tree")
        if stage["verdict"] != "tie":
            continue
        if "output" in stage:
            problems.append(f"the tied stage {stage['name']} has output")
        if index != len(stages) - 1:
            problems.append(f"a stage runs after the tied stage {stage['name']}")
        error = value["error"]
        if (
            value["ok"] is not False
            or value["tree"] is not None
            or not isinstance(error, dict)
            or error.get("kind") != "ambiguous"
            or error.get("reason") != "tie"
            or error.get("stage") != stage["name"]
            or not isinstance(error.get("readings"), list)
            or len(error["readings"]) != 2
        ):
            problems.append(f"the tied stage {stage['name']} lacks its error of kind ambiguous, reason tie and two readings")
    return problems


def witness_lost(value: dict[str, Any]) -> bool:
    """Whether a canonical result has the error elision-witness-lost. No
    grammar gives it (engine §7.8), so a shared case or a corpus case that
    gives it fails, whatever it expects (tests/README.md). The library's own
    tests that lose the witness on purpose do not run through the runner."""
    error = value.get("error")
    return isinstance(error, dict) and error.get("code") == "elision-witness-lost"


class WitnessLost(AssertionError):
    """A check of elision-only that lost the witness of its chosen
    derivation (tests/README.md)."""


def parse_checked(parse: Any) -> Any:
    """The value of ``parse()``, after asking the library whether every
    check of elision-only that ran in it kept its witness (tests/README.md);
    a check that did not fails the case."""
    with checks() as answers:
        value = parse()
    lost = answers.count(False)
    if lost:
        raise WitnessLost(f"{lost} check(s) of elision-only lost the witness of the chosen derivation")
    return value


def case_sources(case: dict[str, Any]) -> tuple[dict[str, str], str]:
    if "grammar" in case:
        grammar = case["grammar"]
        if "%ambiguity-resolution" not in grammar:
            grammar = "%ambiguity-resolution greedy\n" + grammar
        return (
            {
                "p.md": '```jbogenbau\n%stage main\n%include "main.md"\n```\n',
                "main.md": "```jbogenbau\n" + grammar + "\n```\n",
            },
            "p.md",
        )
    return dict(case["documents"]), case["pipeline"]


def case_tokens(case: dict[str, Any]) -> tuple[list[Token], str]:
    tokens: list[Token] = []
    position = 0
    for index, spec in enumerate(case["tokens"]):
        # Attachments, which a caller cannot supply, go to the library as
        # they stand, so that it refuses them or drops empty ones
        # (tests/README.md).
        before = [replace(token, span=None) for token in case_tokens({"tokens": spec["before"]})[0]] if "before" in spec else []
        after = [replace(token, span=None) for token in case_tokens({"tokens": spec["after"]})[0]] if "after" in spec else []
        # Each tag in its canonical spelling, as the output writes it
        # (tests/README.md).
        for tag in spec["tags"]:
            if not is_tag(tag):
                raise ValueError(f"a case token's tag {tag} is not a tag")
        tags = frozenset(spec["tags"])
        text = spec["text"]
        tokens.append(
            Token(text, tags, (index, index + 1), (position, position + len(text)), spec.get("phonemes"), before=before, after=after)
        )
        position += len(text) + 1
    return tokens, " ".join(spec["text"] for spec in case["tokens"])


def load_case_dialect(case: dict[str, Any], use_cache: bool = True) -> tuple[gencmu.Dialect | None, gencmu.GencmuError | None]:
    """An engine case's loaded dialect, or the error of its load."""
    sources, pipeline = case_sources(case)
    try:
        return gencmu.load_dialect_sources(sources, pipeline, use_cache=use_cache), None
    except gencmu.GencmuError as error:
        return None, error


def parse_case(
    dialect: gencmu.Dialect, case: dict[str, Any], run: dict[str, Any] | None = None
) -> tuple[dict[str, Any] | None, gencmu.ParseResult | None, gencmu.GencmuError | None]:
    """An engine case's canonical result and result, parsed with a loaded
    dialect under the options of ``run``, the case itself or one item of
    its ``parses`` (tests/README.md); or a mistake of the caller in their
    place, which is no result (engine §13)."""
    options = (case if run is None else run).get("options", {})
    kwargs: dict[str, Any] = {
        "features": options.get("features", []),
        "without_features": options.get("withoutFeatures", []),
        "auto_features": options.get("autoFeatures", False),
        "until": options.get("until"),
        "elision_only": options.get("elisionOnly"),
    }
    try:
        # Every check of elision-only that ran must keep its witness
        # (tests/README.md).
        if "tokens" in case:
            tokens, text = case_tokens(case)
            result = parse_checked(lambda: dialect.parse_tokens(tokens, text, **kwargs))
        else:
            result = parse_checked(lambda: dialect.parse(case.get("input", ""), **kwargs))
    except gencmu.GencmuError as error:
        if error.kind != "usage":
            raise
        return None, None, error
    return gencmu.result_json(result), result, None


def case_features(dialect: gencmu.Dialect) -> list[dict[str, Any]]:
    """A dialect's features as a case writes them."""
    return [{"name": feature.name, "kind": feature.kind, "default": feature.default} for feature in dialect.features]


def run_case(
    case: dict[str, Any], use_cache: bool = True
) -> tuple[dict[str, Any] | None, gencmu.ParseResult | None, gencmu.GencmuError | None, list[dict[str, Any]] | None]:
    """An engine case's canonical result and result, or the error in their
    place: the load's, or the parse's for a mistake of the caller, which is
    no result (engine §13). Last, the dialect's features as a case writes
    them, or None if it did not load."""
    dialect, error = load_case_dialect(case, use_cache)
    if dialect is None:
        return None, None, error, None
    value, result, error = parse_case(dialect, case)
    return value, result, error, case_features(dialect)


def result_mutants() -> list[dict[str, Any]]:
    """The changes to a canonical result that break an invariant
    (tests/README.md, "Result mutants"), each with its engine case under
    ``engine_case``."""
    mutants = load_case(SHARED / "result-mutants.json")["mutants"]
    # An empty list would pass every runner with nothing refused.
    assert mutants, "tests/result-mutants.json has no mutant"
    return [{**mutant, "engine_case": load_case(SHARED / "engine" / mutant["case"])} for mutant in mutants]


def apply_mutant(value: dict[str, Any], mutant: dict[str, Any]) -> dict[str, Any]:
    """A copy of a canonical result with a mutant's change. A path step of
    -1 is the last element of a list."""
    value = json.loads(json.dumps(value))

    def follow(path: list[Any]) -> Any:
        target: Any = value
        for step in path:
            target = target[step]
        return target

    parent = follow(mutant["path"][:-1])
    last = mutant["path"][-1]
    if "set" in mutant:
        parent[last] = json.loads(json.dumps(mutant["set"]))
    elif "copy" in mutant:
        parent[last] = follow(mutant["copy"])
    elif "keep" in mutant:
        parent[last] = parent[last][: mutant["keep"]]
    elif "remove" in mutant:
        del parent[last]
    elif "append" in mutant:
        parent[last] = [*parent[last], json.loads(json.dumps(mutant["append"]))]
    else:
        raise AssertionError(f"the mutant {mutant['name']} changes nothing")
    return value
