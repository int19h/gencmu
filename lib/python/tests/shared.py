"""Helpers for the shared test cases of the repository's tests/ directory."""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass, replace
import bisect
import faulthandler
import inspect
import json
import linecache
import os
from pathlib import Path
import signal
import sys
import threading
from types import CodeType, FrameType
from typing import Any, Callable, Iterator

import gencmu
from gencmu._model import Token
from gencmu._tags import is_tag

from .witness import checks

REPOSITORY = Path(__file__).resolve().parents[3]
SHARED = REPOSITORY / "tests"

CASE_SECONDS = float(os.environ.get("GENCMU_CASE_TIMEOUT", "60"))
"""How long one shared case may run before the runner reports it as a
failure. GENCMU_CASE_TIMEOUT sets it."""


class Work:
    """The work that :func:`count_work` has counted so far."""

    def __init__(self) -> None:
        self.count = 0


class OverBudget(BaseException):
    """Work past the budget that :func:`count_work` allowed, raised at the
    first unit past it, so that a regression to quadratic work fails by its
    count and does not run on. A BaseException, which no handler of the
    library's catches."""


Weight = Callable[[FrameType], "int | Callable[[], int]"]
"""What one call or step adds to the count, read from the running frame.
For a call, it can instead give a function that gives the count once the
call returns."""


@dataclass
class Watch:
    """What :func:`count_work` counts: the calls of some code, or the steps
    of some code, which are the lines it runs, each loop pass included.
    Make one with :func:`calls`, :func:`steps` or :func:`made_items`."""

    calls: bool
    # Each code object watched, with the lines of it that count, or None
    # where every line counts.
    codes: dict[CodeType, frozenset[int] | None]
    weight: Weight | None = None


def code_of(target: Any, *nested: str) -> CodeType:
    """The code of a function or method, or of the function by the names
    ``nested`` defined within it, one inside the other."""
    code: CodeType = target if isinstance(target, CodeType) else inspect.unwrap(target).__code__
    for name in nested:
        found = next((const for const in code.co_consts if isinstance(const, CodeType) and const.co_name == name), None)
        assert found is not None, f"{code.co_name} defines no {name}"
        code = found
    return code


def _codes(target: Any) -> list[CodeType]:
    """The code objects of a function, a code object, or every function of
    a class or a module that it defines itself."""
    if isinstance(target, CodeType):
        return [target]
    if isinstance(target, (property, staticmethod, classmethod)):
        target = target.fget if isinstance(target, property) else target.__func__
    if inspect.isfunction(target) or inspect.ismethod(target):
        return [code_of(target)]
    if inspect.isclass(target) or inspect.ismodule(target):
        owner = target.__name__ if inspect.ismodule(target) else target.__module__
        found: list[CodeType] = []
        for value in vars(target).values():
            if inspect.isclass(value) and value.__module__ == owner and not inspect.isclass(target):
                found.extend(_codes(value))
            elif isinstance(value, (property, staticmethod, classmethod)) or inspect.isfunction(value):
                function = value.fget if isinstance(value, property) else getattr(value, "__func__", value)
                if function is not None and function.__module__ == owner:
                    found.append(code_of(function))
        return found
    raise TypeError(f"cannot watch {target!r}")


def _within(code: CodeType) -> Iterator[CodeType]:
    """A code object and every code object defined inside it, such as its
    comprehensions before Python 3.12 inlined them."""
    yield code
    for const in code.co_consts:
        if isinstance(const, CodeType):
            yield from _within(const)


def calls(target: Any, weight: Weight | None = None) -> Watch:
    """Count each call of a function, of the functions of a class or a
    module, or of a code object (see :func:`code_of`), as one, or as
    ``weight`` says. The code must not be a generator's, since the fallback
    before Python 3.12 would count each of its resumptions as a call."""
    codes = _codes(target)
    for code in codes:
        assert not code.co_flags & inspect.CO_GENERATOR, f"{code.co_name} is a generator"
    return Watch(True, {code: None for code in codes}, weight)


def steps(target: Any, line: str | None = None, weight: Weight | None = None) -> Watch:
    """Count each line that a function runs, with the functions defined
    inside it, or those of a class or a module, as one, or as ``weight``
    says. A loop's line counts at each pass. With ``line``, only the lines
    whose source holds that text count, such as the first line of a loop's
    body.

    Only Python's own steps count: a step of C, such as a copy of a list or
    a search by ``in``, is one step, however long. A test that guards
    against such work gives the line a weight, or counts the calls of its
    own data's methods, which the C code calls."""
    codes: dict[CodeType, frozenset[int] | None] = {}
    for top in _codes(target):
        for code in _within(top):
            if line is None:
                codes[code] = None
                continue
            numbers = frozenset(
                number
                for _, _, number in code.co_lines()
                if number is not None and line in linecache.getline(code.co_filename, number)
            )
            if numbers:
                codes[code] = numbers
    assert codes, f"no line of {target!r} holds {line!r}"
    return Watch(False, codes, weight)


def made_items() -> Watch:
    """Count the items that the recognizer makes, in parses and nested
    parses alike: a call of the recognizer's ``add`` that grows its list of
    items makes one."""
    from gencmu._earley import Parser

    def made(frame: FrameType) -> Callable[[], int]:
        items = frame.f_locals["prod"]
        before = len(items)
        return lambda: int(len(items) > before)

    return calls(code_of(Parser.parse, "add"), made)


@contextmanager
def count_work(*watches: Watch, budget: int | None = None) -> Iterator[Work]:
    """Count the work that ``watches`` describe, all in one count, from
    the test's side, so that the library itself counts nothing. With a
    budget, the unit of work past it stops the work with
    :class:`OverBudget`.

    The count watches the code it names alone through sys.monitoring where
    there is one, from Python 3.12. Before that, it traces every call of
    the thread, and passes each event on to the trace function that was
    there before, so that counts nest."""
    work = Work()
    starts: dict[CodeType, list[Watch]] = {}
    lines: dict[CodeType, list[Watch]] = {}
    for watch in watches:
        for code in watch.codes:
            (starts if watch.calls else lines).setdefault(code, []).append(watch)
    # The counts that wait for the return of each running call, innermost
    # last.
    waiting: list[list[Callable[[], int]]] = []

    def add(count: int) -> None:
        work.count += count
        if budget is not None and work.count > budget:
            raise OverBudget(f"more than {budget} units of work")

    def begin(code: CodeType, frame: FrameType) -> None:
        # Pushed first, so that a budget passed here leaves the stack as
        # the unwinding of this call expects it.
        later: list[Callable[[], int]] = []
        waiting.append(later)
        for watch in starts[code]:
            count = 1 if watch.weight is None else watch.weight(frame)
            if callable(count):
                later.append(count)
            else:
                add(count)

    def end() -> None:
        for count in waiting.pop():
            add(count())

    def step(code: CodeType, number: int, frame: FrameType) -> bool:
        """Counts a step of a line, and tells whether any watch counts it."""
        counted = False
        for watch in lines[code]:
            numbers = watch.codes[code]
            if numbers is None or number in numbers:
                counted = True
                count = 1 if watch.weight is None else watch.weight(frame)
                assert isinstance(count, int), "a step's weight is a number"
                add(count)
        return counted

    places: dict[CodeType, tuple[list[int], list[int | None]]] = {}

    def line_at(code: CodeType, offset: int) -> int | None:
        if code not in places:
            spans = [(start, number) for start, _, number in code.co_lines()]
            places[code] = ([start for start, _ in spans], [number for _, number in spans])
        starts_of, numbers = places[code]
        return numbers[bisect.bisect_right(starts_of, offset) - 1]

    def looped(code: CodeType, source: int, target: int, frame: FrameType) -> bool:
        """Counts a jump back within one line as a step of that line, and
        tells whether it counted."""
        if target < source:
            number = line_at(code, target)
            if number is not None and number == line_at(code, source):
                return step(code, number, frame)
        return False

    monitoring = getattr(sys, "monitoring", None)
    if monitoring is not None:
        tool = next((tool for tool in range(6) if monitoring.get_tool(tool) is None), None)
        assert tool is not None, "no tool of sys.monitoring is free"
        events = monitoring.events
        monitoring.use_tool_id(tool, "gencmu tests: count_work")
        try:
            monitoring.register_callback(tool, events.PY_START, lambda code, offset: begin(code, sys._getframe(1)))
            monitoring.register_callback(tool, events.PY_RETURN, lambda code, offset, value: end())
            # A call that raises returns nothing, and an unwinding is a
            # global event only, which the callback narrows to the calls.
            monitoring.register_callback(tool, events.PY_UNWIND, lambda code, offset, error: end() if code in starts else None)
            # A line or a jump that no watch counts is turned off where it
            # stands, so that the code runs at its own speed between the
            # steps that count.
            skip = monitoring.DISABLE
            monitoring.register_callback(tool, events.LINE, lambda code, number: None if step(code, number, sys._getframe(1)) else skip)
            # A line event comes only where the line changes, so a loop
            # that jumps back within one line counts at its jump, as a
            # trace function's line event would.
            monitoring.register_callback(
                tool, events.JUMP, lambda code, source, target: None if looped(code, source, target, sys._getframe(1)) else skip
            )
            for code in set(starts) | set(lines):
                wanted = events.NO_EVENTS
                if code in starts:
                    wanted |= events.PY_START | events.PY_RETURN
                if code in lines:
                    wanted |= events.LINE | events.JUMP
                monitoring.set_local_events(tool, code, wanted)
            if starts:
                monitoring.set_events(tool, events.PY_UNWIND)
            # The places that an earlier count turned off count again.
            monitoring.restart_events()
            yield work
        finally:
            monitoring.set_events(tool, events.NO_EVENTS)
            for code in set(starts) | set(lines):
                monitoring.set_local_events(tool, code, events.NO_EVENTS)
            monitoring.free_tool_id(tool)
        return

    def own(frame: FrameType) -> Any:
        """This count's tracer of a frame, or None where it counts nothing."""
        code = frame.f_code
        if code not in starts and code not in lines:
            return None
        if code in starts:
            begin(code, frame)

        def local(frame: FrameType, event: str, arg: Any) -> Any:
            if event == "line" and code in lines:
                step(code, frame.f_lineno, frame)
            elif event == "return" and code in starts:
                end()
            return local

        return local

    def trace(frame: FrameType, event: str, arg: Any) -> Any:
        # The trace function that was there first, such as an enclosing
        # count's, still traces, so that counts can nest.
        mine = own(frame)
        other = previous(frame, event, arg) if previous is not None else None
        if other is None or mine is None:
            return mine or other

        def both(frame: FrameType, event: str, arg: Any) -> Any:
            nonlocal mine, other
            mine = mine(frame, event, arg) if mine is not None else None
            other = other(frame, event, arg) if other is not None else None
            return both if mine is not None or other is not None else None

        return both

    previous = sys.gettrace()
    sys.settrace(trace)
    try:
        yield work
    finally:
        sys.settrace(previous)


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


# Whether the runner asks the witness hook; a fault test switches it off.
HOOK = [True]


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
    # A fault test switches the hook off to see what the result alone
    # catches (tests/README.md).
    if lost and HOOK[0]:
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
