"""Helpers for the shared test cases of the repository's tests/ directory."""

from __future__ import annotations

import __future__
import ast
from contextlib import contextmanager
from dataclasses import dataclass
import bisect
from collections import deque
from collections.abc import ItemsView, KeysView, ValuesView
import dis
import faulthandler
import functools
import inspect
import json
import linecache
import os
import re
from pathlib import Path
import signal
import sys
import textwrap
import threading
from types import CodeType, FrameType, MemberDescriptorType
from typing import Any, Callable, Iterator
from unittest import mock

import gencmu
from gencmu import _testing
from gencmu._model import Token
from gencmu._trampoline import Walk, run

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


Weight = Callable[[FrameType], int]
"""What one call or step adds to the count, read from the running frame
before the call or the step does its work."""


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
    """A code object and every code object inside it, including nested
    functions and generator expressions."""
    yield code
    for const in code.co_consts:
        if isinstance(const, CodeType):
            yield from _within(const)


def calls(target: Any, weight: Weight | None = None) -> Watch:
    """Count each call of a function, of the functions of a class or a
    module, or of a code object (see :func:`code_of`), as one, or as
    ``weight`` says. A generator counts once when its execution starts,
    rather than at each resumption."""
    return Watch(True, {code: None for code in _codes(target)}, weight)


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


COPIES = frozenset(
    {
        "set",
        "frozenset",
        "list",
        "tuple",
        "dict",
        "sorted",
        "sum",
        "min",
        "max",
        "any",
        "all",
        "str",
        "repr",
        "bytes",
        "bytearray",
        "hash",
        "deque",
        "deepcopy",
    }
)
"""The functions that read every element of their arguments."""

READS_ARGUMENTS = frozenset(
    {
        "update",
        "intersection_update",
        "difference_update",
        "symmetric_difference_update",
        "extend",
        "extendleft",
        "fromkeys",
        "startswith",
        "endswith",
        "match",
        "fullmatch",
        "search",
        "findall",
        "finditer",
        "sub",
        "subn",
        "deepcopy",
    }
)
"""The methods that read every element of their arguments, but not the
container they change or are called on."""

READS_BOTH = frozenset({"union", "intersection", "difference", "symmetric_difference", "issubset", "issuperset", "isdisjoint"})
"""The methods that read the set they are called on and their arguments."""

READS_SEQUENCE = frozenset({"index", "count", "find", "rfind", "rindex"})
"""The methods that search a list, a tuple or a string they are called on."""

READS_LIST = frozenset({"remove", "insert", "sort", "reverse", "rotate"})
"""The methods of a list that read or move every element."""

READS_TEXT = frozenset(
    {
        "split",
        "rsplit",
        "splitlines",
        "replace",
        "strip",
        "lstrip",
        "rstrip",
        "lower",
        "upper",
        "casefold",
        "partition",
        "rpartition",
        "encode",
        "decode",
        "format",
        "translate",
        "title",
        "capitalize",
        "swapcase",
        "expandtabs",
        "zfill",
        "center",
        "ljust",
        "rjust",
        "isalpha",
        "isalnum",
        "isdigit",
        "isdecimal",
        "isnumeric",
        "isspace",
        "isidentifier",
        "isupper",
        "islower",
        "isascii",
        "isprintable",
    }
)
"""The methods of a string that read every character of it."""

LAZY = frozenset({"zip", "map", "filter", "reversed", "enumerate", "iter", "chain", "islice"})
"""The functions that make an iterator over their arguments. A call that
reads such an iterator through reads the containers under it."""

VIEWS = frozenset({"keys", "values", "items"})

SIZED = (set, frozenset, list, tuple, dict, str, bytes, bytearray, range, deque, KeysView, ValuesView, ItemsView)
HASHED = (set, frozenset, dict, range, KeysView, ItemsView)
"""What ``in`` searches without reading its elements."""
SEQUENCES = (list, tuple, str, bytes, bytearray, deque)
LISTS = (list, bytearray, deque)
MUTABLE = (set, dict, list, bytearray, deque)
"""What a copy reads in full. A copy of a frozenset, a tuple or a string
is the same object."""
IMMUTABLE = (frozenset, tuple, str, bytes)
"""What an augmented assignment copies, since it makes a new object."""


def _value(node: ast.AST, frame: FrameType) -> Any:
    """What a name, an attribute, an index or a view of a dict names in a
    frame, read without running any code of the library's, or None where
    it is not known so."""
    if isinstance(node, ast.Name):
        found = frame.f_locals
        if node.id in found:
            return found[node.id]
        return frame.f_globals.get(node.id)
    if isinstance(node, ast.Attribute):
        owner = _value(node.value, frame)
        if owner is None:
            return None
        try:
            static = inspect.getattr_static(owner, node.attr)
        except AttributeError:
            return None
        if isinstance(static, MemberDescriptorType):
            return getattr(owner, node.attr, None)
        return None if callable(static) or isinstance(static, (property, staticmethod, classmethod)) else static
    if isinstance(node, ast.Subscript) and not isinstance(node.slice, ast.Slice):
        owner = _value(node.value, frame)
        key = node.slice.value if isinstance(node.slice, ast.Constant) else _value(node.slice, frame)
        if isinstance(owner, dict):
            return owner.get(key)
        if isinstance(owner, (list, tuple)) and isinstance(key, int) and -len(owner) <= key < len(owner):
            return owner[key]
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in VIEWS and not node.args:
        # A view of a dict is made by the dict's own C method, which runs
        # none of the library's code.
        owner = _value(node.func.value, frame)
        if type(owner) is dict:
            return getattr(owner, node.func.attr)()
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "len" and len(node.args) == 1:
        # The length of a built-in container, which a repetition reads.
        counted = _value(node.args[0], frame)
        if isinstance(counted, SIZED):
            return len(counted)
    return None


def _size(node: ast.AST, frame: FrameType) -> int:
    """The elements that reading a value through reads. An iterator over
    containers, such as a zip, reads the containers under it."""
    if isinstance(node, ast.Call) and node.args:
        name = node.func.id if isinstance(node.func, ast.Name) else node.func.attr if isinstance(node.func, ast.Attribute) else None
        if name in LAZY:
            # A map or a filter reads its iterables after its function.
            under = node.args[1:] if name in ("map", "filter") else node.args
            return sum(_size(argument, frame) for argument in under)
    value = _value(node, frame)
    return len(value) if isinstance(value, SIZED) else 0


def _text(node: ast.AST, frame: FrameType) -> int:
    """The characters that a join reads: each part, and each character of
    the parts that are strings, since the join copies them all."""
    value = _value(node, frame)
    if not isinstance(value, (list, tuple)):
        return _size(node, frame)
    return len(value) + sum(len(part) for part in value if isinstance(part, (str, bytes)))


# Each file's charges, by line: the operands whose elements an operation
# that starts on that line reads in C, and apart from them, those that a
# loop's iterable reads once as the loop starts. Kept with the source they
# were found in, since each mutant of a function puts its own source under
# one file name.
Charges = list[tuple[str, ast.AST]]
_CHARGES: dict[str, tuple[str, dict[int, tuple[Charges, Charges]]]] = {}


def _charges(filename: str) -> dict[int, tuple[Charges, Charges]]:
    """What each line of a file reads in C, as nodes to size when the line
    runs. The first list charges at each step of the line. The second
    charges only as a loop on the line starts, since a loop's line runs at
    each pass but its iterable is made once.

    The kinds are "size" for a container read through, "search" for a
    container searched by ``in``, which reads a set or a dict by its hash,
    "sequence", "list" and "text" for a receiver that a method reads only
    when it is a sequence, a list or a string, "copy" for a receiver whose
    copy reads it unless it is immutable, "new" for the target of an
    augmented assignment, which is copied when immutable, "times" for a
    repetition and "join" for the parts of a join."""
    source = "".join(linecache.getlines(filename))
    found = _CHARGES.get(filename)
    if found is not None and found[0] == source:
        return found[1]
    tree = ast.parse(source)
    # What a loop iterates is charged only as the loop starts. Each pass
    # counts as a step of its own, and the header's line runs at each pass.
    iterables = {id(node.iter) for node in ast.walk(tree) if isinstance(node, (ast.For, ast.comprehension))}
    lines: dict[int, tuple[Charges, Charges]] = {}
    stack: list[tuple[ast.AST, bool]] = [(tree, False)]
    while stack:
        node, starting = stack.pop()
        starting = starting or id(node) in iterables
        stack.extend((child, starting) for child in ast.iter_child_nodes(node))
        charges: Charges = []
        if isinstance(node, ast.BinOp):
            if isinstance(node.op, ast.Mult):
                charges.append(("times", node))
            else:
                charges += [("size", node.left), ("size", node.right)]
        elif isinstance(node, ast.AugAssign):
            charges += [("size", node.value), ("new", node.target)]
        elif isinstance(node, ast.Starred):
            charges.append(("size", node.value))
        elif isinstance(node, ast.Dict):
            # A ** in a display copies a dict.
            charges += [("size", value) for key, value in zip(node.keys, node.values) if key is None]
        elif isinstance(node, ast.FormattedValue):
            charges.append(("size", node.value))
        elif isinstance(node, ast.Subscript) and isinstance(node.slice, ast.Slice):
            charges.append(("size", node.value))
        elif isinstance(node, ast.Delete):
            # Deleting from a list moves every element after it.
            charges += [("list", target.value) for target in node.targets if isinstance(target, ast.Subscript)]
        elif isinstance(node, ast.Compare):
            for operator, operand in zip(node.ops, node.comparators):
                if isinstance(operator, (ast.In, ast.NotIn)):
                    charges.append(("search", operand))
                elif isinstance(operator, (ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE)):
                    charges += [("size", node.left), ("size", operand)]
        elif isinstance(node, ast.Call):
            function = node.func
            if isinstance(function, ast.Name) and function.id in COPIES:
                charges += [("size", argument) for argument in node.args]
            elif isinstance(function, ast.Attribute):
                name = function.attr
                if name == "join":
                    charges += [("join", argument) for argument in node.args]
                if name in READS_ARGUMENTS or name in READS_BOTH:
                    charges += [("size", argument) for argument in node.args]
                if name in READS_BOTH:
                    charges.append(("size", function.value))
                if name == "copy":
                    # A container's own copy, or copy.copy of one.
                    charges += [("copy", argument) for argument in node.args] or [("copy", function.value)]
                if name in READS_SEQUENCE:
                    charges.append(("sequence", function.value))
                if name in READS_LIST or name == "pop" and node.args:
                    charges.append(("list", function.value))
                if name in READS_TEXT:
                    charges.append(("text", function.value))
        if charges:
            both = lines.setdefault(node.lineno, ([], []))  # type: ignore[attr-defined]
            both[1 if starting else 0].extend(charges)
    _CHARGES[filename] = (source, lines)
    return lines


def _operand(node: ast.AST, frame: FrameType) -> Any:
    """An operand of a repetition: a constant, a display of a list or a
    tuple, which stands for its elements, or what :func:`_value` reads."""
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, (ast.List, ast.Tuple)) and not any(isinstance(element, ast.Starred) for element in node.elts):
        return tuple(range(len(node.elts)))
    return _value(node, frame)


def _weigh(kind: str, node: ast.AST, frame: FrameType) -> int:
    """The elements that one charge reads in a frame."""
    if kind == "size":
        return _size(node, frame)
    if kind == "join":
        return _text(node, frame)
    if kind == "times":
        assert isinstance(node, ast.BinOp)
        left, right = _operand(node.left, frame), _operand(node.right, frame)
        # A repetition makes its sequence's elements the number of times.
        if isinstance(right, int) and isinstance(left, SIZED):
            return len(left) * max(right, 1)
        if isinstance(left, int) and isinstance(right, SIZED):
            return len(right) * max(left, 1)
        return _size(node.left, frame) + _size(node.right, frame)
    value = _value(node, frame)
    if not isinstance(value, SIZED):
        return 0
    wanted = {"search": SIZED, "sequence": SEQUENCES, "list": LISTS, "text": (str, bytes, bytearray), "copy": MUTABLE, "new": IMMUTABLE}[kind]
    if kind == "search" and isinstance(value, HASHED) or not isinstance(value, wanted):
        return 0
    return len(value)


_COMPREHENSIONS = frozenset({"<genexpr>"})

# The offset of the first loop instruction of each line of each code
# object, found once.
_LOOPS: dict[int, tuple[CodeType, dict[int, int]]] = {}


def _starting(frame: FrameType) -> bool:
    """Whether a frame's line starts its loops, and so makes their
    iterables. A pass of a loop runs from its loop instruction or a jump
    back after it. A generator expression receives its iterable. List,
    set, and dict comprehensions run inside the enclosing code."""
    code = frame.f_code
    if code.co_name in _COMPREHENSIONS:
        return False
    entry = _LOOPS.get(id(code))
    if entry is None:
        loops: dict[int, int] = {}
        _LOOPS[id(code)] = (code, loops)
        lines = [(start, number) for start, _, number in code.co_lines()]
        for instruction in dis.get_instructions(code):
            if instruction.opname != "FOR_ITER":
                continue
            number = next((number for start, number in reversed(lines) if start <= instruction.offset), None)
            if number is not None and number not in loops:
                loops[number] = instruction.offset
    else:
        loops = entry[1]
    first = loops.get(frame.f_lineno)
    return first is None or frame.f_lasti < first


# The charges of each line of each code object, found once.
# Code objects have structural hashes. Identity keys avoid that work,
# and each entry retains its code object so that its ID stays unique.
_CODE_CHARGES: dict[int, tuple[CodeType, dict[int, tuple[Charges, Charges]]]] = {}


def reads(frame: FrameType) -> int:
    """A weight for a step of a line, read before the line runs: one, and
    the elements that the operations starting on it read in C. A union, a
    copy, a comparison of containers, a join or a search of a sequence
    reads each element of its operands. An update in place reads its
    arguments only, and a search of a set or a dict reads none. A loop's
    iterable is charged as the loop starts. Every operand of the line
    counts, whichever branch runs, so the weight does not fall short of
    the work."""
    code = frame.f_code
    entry = _CODE_CHARGES.get(id(code))
    if entry is None:
        by_line: dict[int, tuple[Charges, Charges]] = {}
        _CODE_CHARGES[id(code)] = (code, by_line)
    else:
        by_line = entry[1]
    charges = by_line.get(frame.f_lineno)
    if charges is None:
        charges = by_line[frame.f_lineno] = _charges(code.co_filename).get(frame.f_lineno, ([], []))
    every, starts = charges
    if not every and not starts:
        return 1
    read = 1
    for kind, node in every:
        read += _weigh(kind, node, frame)
    if starts and _starting(frame):
        for kind, node in starts:
            read += _weigh(kind, node, frame)
    return read


def made_items() -> Watch:
    """Count the items that the recognizer makes, in parses and nested
    parses alike, each at the line of ``add`` that numbers a new item,
    before the item is stored. So a budget stops the parse before the
    item past it exists."""
    from gencmu._earley import Parser

    return steps(code_of(Parser.walk, "add"), "found = len(prod)")


@contextmanager
def count_work(*watches: Watch, budget: int | None = None) -> Iterator[Work]:
    """Count the work that ``watches`` describe, all in one count, from
    the test's side, so that the library itself counts nothing. With a
    budget, the unit of work past it stops the work with
    :class:`OverBudget`.

    The count watches only the named code through sys.monitoring. Each
    nested count uses its own monitoring tool."""
    work = Work()
    # Keep the code objects alive while callbacks use their identity keys.
    codes: dict[int, CodeType] = {}
    starts: dict[int, list[Watch]] = {}
    lines: dict[int, list[tuple[frozenset[int] | None, Weight | None]]] = {}
    for watch in watches:
        for code, numbers in watch.codes.items():
            key = id(code)
            codes[key] = code
            if watch.calls:
                starts.setdefault(key, []).append(watch)
            else:
                lines.setdefault(key, []).append((numbers, watch.weight))

    # Every unit counts before its work, so the budget stops the work at
    # the first unit past it and none of that unit's work is done. A
    # weighted step counts the elements that its C code will read, one at a
    # time, so it too stops at the first element past the budget.
    def add(count: int) -> None:
        if budget is not None and work.count + count > budget:
            work.count = budget + 1
            raise OverBudget(f"more than {budget} units of work")
        work.count += count

    def begin(code: CodeType, frame: FrameType) -> None:
        for watch in starts[id(code)]:
            add(1 if watch.weight is None else watch.weight(frame))

    def step(code: CodeType, number: int, frame: FrameType) -> bool:
        """Counts a step of a line, and tells whether any watch counts it."""
        counted = False
        for numbers, weight in lines[id(code)]:
            if numbers is None or number in numbers:
                counted = True
                add(1 if weight is None else weight(frame))
        return counted

    places: dict[int, tuple[list[int], list[int | None]]] = {}

    def line_at(code: CodeType, offset: int) -> int | None:
        key = id(code)
        found = places.get(key)
        if found is None:
            spans = [(start, number) for start, _, number in code.co_lines()]
            found = places[key] = ([start for start, _ in spans], [number for _, number in spans])
        starts_of, numbers = found
        return numbers[bisect.bisect_right(starts_of, offset) - 1]

    def looped(code: CodeType, source: int, target: int, frame: FrameType) -> bool:
        """Counts a jump back within one line as a step of that line, and
        tells whether it counted."""
        if target < source:
            number = line_at(code, target)
            if number is not None and number == line_at(code, source):
                return step(code, number, frame)
        return False

    monitoring = sys.monitoring
    tool = next((tool for tool in range(6) if monitoring.get_tool(tool) is None), None)
    assert tool is not None, "no tool of sys.monitoring is free"
    events = monitoring.events
    monitoring.use_tool_id(tool, "gencmu tests: count_work")
    try:
        monitoring.register_callback(tool, events.PY_START, lambda code, offset: begin(code, sys._getframe(1)))
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
        for key, code in codes.items():
            wanted = events.NO_EVENTS
            if key in starts:
                wanted |= events.PY_START
            if key in lines:
                wanted |= events.LINE | events.JUMP
            monitoring.set_local_events(tool, code, wanted)
        # The places that an earlier count turned off count again.
        monitoring.restart_events()
        # The work counts with the shared memo off (engine §4.3), so that
        # answers of an earlier parse never shorten the counted one.
        with mock.patch.object(_testing, "memo_limit", 0):
            yield work
    finally:
        monitoring.set_events(tool, events.NO_EVENTS)
        for code in codes.values():
            monitoring.set_local_events(tool, code, events.NO_EVENTS)
        for event in (events.PY_START, events.LINE, events.JUMP):
            monitoring.register_callback(tool, event, None)
        monitoring.free_tool_id(tool)


@contextmanager
def mutant(owner: Any, name: str, *changes: tuple[str, str]) -> Iterator[Any]:
    """Put in place of the function ``name`` of ``owner`` a copy of its
    source with each change made, each old text found exactly once. The
    copy stands for a regression of the library's code, so that a test can
    show its budget stops it.

    The copy's lines are kept where :func:`steps` reads them, so a watch
    made while the copy is in place names the copy's lines by their text.
    A test makes its watches inside this context for that reason."""
    function = inspect.unwrap(getattr(owner, name))
    source = textwrap.dedent(inspect.getsource(function))
    for old, new in changes:
        assert source.count(old) == 1, f"{function.__qualname__} holds {old!r} {source.count(old)} times"
        source = source.replace(old, new)
    filename = f"<mutant of {function.__module__}.{function.__qualname__}>"
    linecache.cache[filename] = (len(source), None, source.splitlines(True), filename)
    code = compile(source, filename, "exec", flags=__future__.annotations.compiler_flag, dont_inherit=True)
    defined: dict[str, Any] = {}
    exec(code, function.__globals__, defined)
    try:
        # A mutant's answers are wrong by design, so no shared memo keeps
        # them (engine §4.3).
        with mock.patch.object(owner, name, defined[function.__name__]), mock.patch.object(_testing, "memo_limit", 0):
            yield defined[function.__name__]
    finally:
        linecache.cache.pop(filename, None)


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


def add_case_tests(cls: Any, kind: str) -> None:
    """Give each fixture a unittest method that runners can schedule."""
    def test_for(path: Path) -> Callable[[Any], None]:
        def test(self: Any) -> None:
            self.check_case(path)
        return test

    for path in cases(kind):
        name = "test_case_" + path.stem.replace("-", "_")
        if hasattr(cls, name):
            raise AssertionError(f"duplicate test name: {name}")
        setattr(cls, name, test_for(path))


def cases(kind: str) -> list[Path]:
    return [p for p in sorted((SHARED / kind).glob("*.json")) if not os.environ.get("GENCMU_CASE_FILTER") or os.environ["GENCMU_CASE_FILTER"] in p.name]


def load_json(path: Path) -> Any:
    """A shared file's JSON value, read with a list for a stack, since a
    case can nest as deep as the results it expects."""
    return read_json(path.read_text(encoding="utf-8"))


def load_case(path: Path) -> dict[str, Any]:
    case = load_json(path)
    if path.parent.name == "engine":
        validate_engine_case(case, complete=True)
    elif path.parent.name == "notation":
        validate_notation_case(case)
    return case  # type: ignore[no-any-return]


def case_object(value: Any, members: str, where: str, required: str = "") -> None:
    """Refuse unknown members and missing required members of a case object."""
    assert isinstance(value, dict), f"{where}: expected an object"
    unknown = value.keys() - set(members.split())
    assert not unknown, f"{where}: unknown members {sorted(unknown)}"
    missing = set(required.split()) - value.keys()
    assert not missing, f"{where}: missing members {sorted(missing)}"


def case_value(value: Any, kind: str, where: str) -> None:
    """Check the type of a case member without converting its value."""
    valid = False
    if kind == "string":
        valid = isinstance(value, str)
    elif kind == "boolean":
        valid = type(value) is bool
    elif kind == "strings":
        valid = isinstance(value, list) and all(isinstance(item, str) for item in value)
    elif kind == "position":
        valid = type(value) is int and value > 0
    elif kind == "range":
        valid = isinstance(value, list) and len(value) == 2 and all(type(item) is int for item in value)
    assert valid, f"{where}: expected {kind}"


def validate_engine_expect(expect: Any) -> None:
    case_object(expect, "result brackets warnings features enabledFeatures error where message diagnostic bundledPipelines", "expect")
    for field in ("brackets", "error", "message", "diagnostic"):
        if field in expect:
            case_value(expect[field], "string", "expect." + field)
    for field in ("enabledFeatures", "bundledPipelines"):
        if field in expect:
            case_value(expect[field], "strings", "expect." + field)
    if "where" in expect:
        case_object(expect["where"], "document line column", "expect.where", "document")
        for field, value in expect["where"].items():
            case_value(value, "string" if field == "document" else "position", "expect.where." + field)
    if "features" in expect:
        assert isinstance(expect["features"], list), "expect.features: expected an array"
        for feature in expect["features"]:
            case_object(feature, "name kind default", "expect.features[]", "name kind default")
            for field, value in feature.items():
                case_value(value, "boolean" if field == "default" else "string", "expect.features[]." + field)
    if "warnings" in expect:
        assert isinstance(expect["warnings"], list), "expect.warnings: expected an array"
        for warning in expect["warnings"]:
            case_object(warning, "stage feature rule span source", "expect.warnings[]", "stage feature rule span source")
            for field, value in warning.items():
                case_value(value, "range" if field in ("span", "source") else "string", "expect.warnings[]." + field)
    if "result" in expect:
        validate_result_pattern(expect["result"])


def validate_case_options(options: Any) -> None:
    case_object(options, "features withoutFeatures until elisionOnly", "options")
    for field, value in options.items():
        kind = "strings" if field in ("features", "withoutFeatures") else "string" if field == "until" else "boolean"
        case_value(value, kind, "options." + field)
        if field == "until":
            assert value, "options.until: expected a nonempty string"


def validate_case_tokens(tokens: Any, usage: bool = False) -> None:
    assert isinstance(tokens, list), "tokens: expected an array"
    stack = list(tokens)
    while stack:
        token = stack.pop()
        case_object(token, "text tags value image span source before after", "token", "" if usage else "text tags")
        for field, value in token.items():
            if field in ("before", "after"):
                if not usage:
                    assert isinstance(value, list), f"token.{field}: expected an array"
                if isinstance(value, list):
                    stack.extend(value)
            elif not usage:
                kind = "strings" if field == "tags" else "range" if field in ("span", "source") else "string"
                case_value(value, kind, "token." + field)


def validate_engine_case(case: Any, complete: bool = False, *, parameters: bool = False) -> None:
    """Validate case metadata, retaining malformed token fields in usage cases."""
    members = "description grammar pipeline documents pipelineDocument input tokens options expect parses treeRendering"
    case_object(case, members + (" name" if parameters else ""), "case", "name" if parameters else "")
    for field in ("description", "name", "grammar", "pipelineDocument", "pipeline", "input"):
        if field in case:
            case_value(case[field], "string", "case." + field)
    sources = sum(field in case for field in ("grammar", "pipeline", "documents"))
    assert sources == 1, "case: expected exactly one of grammar, pipeline, or documents"
    assert ("documents" in case) == ("pipelineDocument" in case), "case: documents requires pipelineDocument"
    if "documents" in case:
        assert isinstance(case["documents"], dict), "case.documents: expected an object"
        for name, text in case["documents"].items():
            case_value(name, "string", "case.documents key")
            case_value(text, "string", "case.documents[]")
    if "treeRendering" in case:
        tree = case["treeRendering"]
        case_object(tree, "aliases text decodedError", "case.treeRendering", "aliases text decodedError")
        for field, value in tree.items():
            case_value(value, "strings" if field == "aliases" else "string", "case.treeRendering." + field)
    if "parses" in case:
        assert "expect" not in case and "options" not in case, "case.parses replaces case.expect and case.options"
        assert isinstance(case["parses"], list) and case["parses"], "case.parses: expected a nonempty array"
        runs = case["parses"]
        for item in runs:
            case_object(item, "options expect", "case.parses[]", "expect")
    else:
        assert not complete or "expect" in case, "case: missing expect"
        runs = [case]
    for item in runs:
        if "expect" in item:
            validate_engine_expect(item["expect"])
        usage = item.get("expect", {}).get("error") == "usage"
        validate_case_options(item.get("options", {}))
        if "tokens" in case:
            validate_case_tokens(case["tokens"], usage)


def validate_notation_case(case: Any, values: bool = False) -> None:
    members = "id description aliases document expect" if values else "description document expect cacheMisses"
    required = "id aliases document expect" if values else "document expect"
    case_object(case, members, "case", required)
    for field in ("id", "description", "document"):
        if field in case:
            case_value(case[field], "string", "case." + field)
    if values:
        assert isinstance(case["aliases"], list), "case.aliases: expected an array"
        for alias in case["aliases"]:
            case_object(alias, "spelling tags value", "alias", "spelling tags value")
            for field, value in alias.items():
                case_value(value, "strings" if field == "tags" else "string", "alias." + field)
    if "cacheMisses" in case:
        case_value(case["cacheMisses"], "boolean", "case.cacheMisses")
    expect = case["expect"]
    case_object(expect, "dom error message" if values else "dom error", "expect")
    assert ("dom" in expect) != ("error" in expect), "notation expect: expected exactly one of dom or error"
    if "message" in expect:
        assert "error" in expect, "expect.message requires an error"
        case_value(expect["message"], "string", "expect.message")
    if "dom" in expect:
        assert isinstance(expect["dom"], dict), "expect.dom: expected an object"
    else:
        assert not case.get("cacheMisses"), "cacheMisses requires a DOM expectation"
        case_object(expect["error"], "line column" if values else "line column message", "expect.error", "line column")
        for field, value in expect["error"].items():
            case_value(value, "string" if field == "message" else "position", "expect.error." + field)


def read_json(text: str) -> Any:
    """A JSON text's value, read with a list for a stack. A result can nest
    beyond the depth that json.loads accepts, so the reader keeps open
    containers in an explicit stack."""
    def invalid_constant(name: str) -> Any:
        raise ValueError(f"invalid JSON constant: {name}")

    decoder = json.JSONDecoder(parse_constant=invalid_constant)
    # Each open container, and for an object the key that waits for its
    # value.
    stack: list[tuple[Any, str | None]] = []
    index = 0
    whitespace = " \t\n\r"

    def skip() -> None:
        nonlocal index
        while index < len(text) and text[index] in whitespace:
            index += 1

    while True:
        skip()
        char = text[index] if index < len(text) else ""
        value: Any
        if char == "{" or char == "[":
            index += 1
            skip()
            if text[index] == ("}" if char == "{" else "]"):
                index += 1
                value = {} if char == "{" else []
            else:
                container: Any = {} if char == "{" else []
                key = None
                if char == "{":
                    assert text[index] == '"', f"expected a quoted member name at {index}"
                    key, index = json.decoder.scanstring(text, index + 1)
                    skip()
                    assert text[index] == ":", f"expected : at {index}"
                    index += 1
                stack.append((container, key))
                continue
        elif char == '"':
            value, index = json.decoder.scanstring(text, index + 1)
        else:
            # A number, true, false or null, which nests nothing.
            value, index = decoder.raw_decode(text, index)
        # The value goes into its container, and each container that it
        # closes goes into the one around it.
        while True:
            if not stack:
                skip()
                assert index == len(text), f"extra data at {index}"
                return value
            container, key = stack[-1]
            if isinstance(container, dict):
                container[key] = value
            else:
                container.append(value)
            skip()
            closer = "}" if isinstance(container, dict) else "]"
            if text[index] == ",":
                index += 1
                if isinstance(container, dict):
                    skip()
                    assert text[index] == '"', f"expected a quoted member name at {index}"
                    key, index = json.decoder.scanstring(text, index + 1)
                    skip()
                    assert text[index] == ":", f"expected : at {index}"
                    index += 1
                    stack[-1] = (container, key)
                break
            assert text[index] == closer, f"expected {closer} at {index}"
            index += 1
            stack.pop()
            value = container


def write_json(value: Any) -> str:
    """A value's compact JSON, written with a list for a stack, for the
    messages of a failed case. A result can nest beyond the depth that
    json.dumps accepts, so the writer keeps values in an explicit stack."""
    out: list[str] = []
    # Each entry is text to write, or a value to write.
    stack: list[tuple[bool, Any]] = [(False, value)]
    while stack:
        literal, item = stack.pop()
        if literal:
            out.append(item)
        elif isinstance(item, dict):
            parts: list[tuple[bool, Any]] = [(True, "{")]
            for position, (key, member) in enumerate(item.items()):
                parts.append((True, ("," if position else "") + json.dumps(key, ensure_ascii=False) + ":"))
                parts.append((False, member))
            parts.append((True, "}"))
            stack.extend(reversed(parts))
        elif isinstance(item, list):
            parts = [(True, "[")]
            for position, member in enumerate(item):
                if position:
                    parts.append((True, ","))
                parts.append((False, member))
            parts.append((True, "]"))
            stack.extend(reversed(parts))
        else:
            out.append(json.dumps(item, ensure_ascii=False))
    return "".join(out)


def same_scalar(left: Any, right: Any) -> bool:
    """Compare JSON scalars, with one number type distinct from booleans."""
    if type(left) is bool or type(right) is bool:
        return type(left) is type(right) and left == right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return left == right
    return type(left) is type(right) and left == right


def same_json(left: Any, right: Any) -> bool:
    """Whether two JSON values are equal, as == says of their lists, objects
    and scalars, compared with a list for a stack."""
    stack = [(left, right)]
    while stack:
        one, other = stack.pop()
        if isinstance(one, dict):
            if not isinstance(other, dict) or one.keys() != other.keys():
                return False
            stack.extend((one[key], other[key]) for key in one)
        elif isinstance(one, list):
            if not isinstance(other, list) or len(one) != len(other):
                return False
            stack.extend(zip(one, other))
        elif not same_scalar(one, other):
            return False
    return True


def validate_result_pattern(pattern: Any) -> None:
    """Refuse error-message assertions before comparing any result member."""
    stack = [(pattern, False)]
    while stack:
        item, in_error = stack.pop()
        if isinstance(item, dict):
            assert not (in_error and "message" in item), "a result pattern cannot assert an error message"
            stack.extend((child, in_error or key == "error") for key, child in item.items())
        elif isinstance(item, list):
            stack.extend((child, in_error) for child in item)


def mismatch(pattern: Any, value: Any, where: str = "$") -> str | None:
    """Where a value fails to match a pattern (tests/README.md), or None.
    The first in document order, found with a list for a stack, since a
    pattern can follow a result as deep as it nests."""
    validate_result_pattern(pattern)
    # Each entry is a pattern, its value and where it stands, and for a
    # member of an object, its key, which is checked when the entry is
    # reached, as a walk in order would.
    stack: list[tuple[Any, Any, str, str | None]] = [(pattern, value, where, None)]
    while stack:
        pattern, value, where, key = stack.pop()
        if key is not None:
            if key not in value:
                return f"{where}.{key}: missing"
            value, where = value[key], f"{where}.{key}"
        if isinstance(pattern, dict):
            if not isinstance(value, dict):
                return f"{where}: expected an object, found {write_json(value)[:200]}"
            stack.extend((expected, value, where, member) for member, expected in reversed(pattern.items()))
        elif isinstance(pattern, list):
            if not isinstance(value, list) or len(value) != len(pattern):
                return f"{where}: expected {len(pattern)} elements, found {write_json(value)[:200]}"
            stack.extend((expected, found, f"{where}[{index}]", None) for index, (expected, found) in reversed(list(enumerate(zip(pattern, value)))))
        elif not same_scalar(pattern, value):
            return f"{where}: expected {write_json(pattern)}, found {write_json(value)}"
    return None


def result_problems(value: dict[str, Any]) -> list[str]:
    """Report broken result invariants from tests/README.md.

    An ambiguous error has no token or source, and no stage has a tied
    member. A tied stage comes last and has no output. Its result has ok
    false, tree null, and an ambiguous error with reason tie, its stage
    name, and two readings. Errors have no cycle, conflict, or chosenReading.

    A witness-loss error has kind grammar, a stage, chosen, and completion.
    It has no token, source, line, column, expected, reason, or readings.
    Its stage comes last, is unique or resolved, and has no output.
    """
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
        if last is None or last["name"] != error.get("stage") or last["verdict"] not in ("unique", "resolved") or "output" in last:
            problems.append("the stage of the elision-witness-lost error is not the last, unique or resolved, with no output")
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
    if isinstance(error, dict):
        for member in ("cycle", "conflict", "chosenReading"):
            if member in error:
                problems.append(f"the error has the member {member}")
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
    if any("../grammars/" in text for text in case["documents"].values()):
        root = REPOSITORY / "grammars"
        sources = {"grammars/" + p.relative_to(root).as_posix(): p.read_text(encoding="utf-8") for p in root.rglob("*") if p.is_file()}
        sources.update({"case/" + name: text for name, text in case["documents"].items()})
        return sources, "case/" + case["pipelineDocument"]
    return dict(case["documents"]), case["pipelineDocument"]


def case_tokens(case: dict[str, Any]) -> tuple[list[Token], str]:
    # A walk, since attachments nest as deep as a case writes them.
    validate_case_tokens(case["tokens"], usage=True)
    tokens = run(_case_tokens(case["tokens"]))
    # Invalid fields belong to the library's usage validation. They supply
    # no characters for the runner's default source text.
    text = case["input"] if "input" in case else " ".join(token.text if isinstance(token.text, str) else "" for token in tokens)
    return tokens, text


def _case_tokens(specs: list[dict[str, Any]]) -> Walk:
    tokens: list[Token] = []
    position = 0
    for index, spec in enumerate(specs):
        # Attachments, which a caller cannot supply, go to the library as
        # they stand, so that it refuses them or drops empty ones
        # (tests/README.md).
        attachments = {}
        for field in ("before", "after"):
            value = spec.get(field, [])
            attachments[field] = ((yield _case_tokens(value))
                                  if isinstance(value, list) and all(isinstance(item, dict) for item in value) else value)
        # Pass invalid tags to the library for usage cases.
        tags = spec.get("tags")
        text = spec.get("text")
        length = len(text) if isinstance(text, str) else 0
        tokens.append(
            Token(text, tags, spec.get("span", (index, index + 1)), spec.get("source", (position, position + length)), spec.get("value"), image=spec.get("image"), **attachments)
        )
        # None selects the constructor default. Set explicit JSON null on
        # the stored field so that malformed-token cases reach validation.
        for field in ("value", "image", "before", "after"):
            if field in spec and spec[field] is None:
                setattr(tokens[-1], field, None)
        position += length + 1
    return tokens


@functools.lru_cache(maxsize=16)
def _whole_case_sources(documents: tuple[tuple[str, str], ...], pipeline: str) -> tuple[dict[str, str], str]:
    """Share a whole-pipeline case's source documents within one worker.
    Each case still loads a fresh pipeline, so that no case depends on the
    state that an earlier case left in a shared pipeline."""
    return case_sources({"documents": dict(documents), "pipelineDocument": pipeline})


def load_case_pipeline(case: dict[str, Any], use_cache: bool = True) -> tuple[gencmu.Pipeline | None, gencmu.GencmuError | None]:
    """An engine case's loaded pipeline, or the error of its load."""
    try:
        if "pipeline" in case:
            return gencmu.load_pipeline(case["pipeline"], use_cache=use_cache), None
        if use_cache and "grammar" not in case and any("../grammars/" in text for text in case["documents"].values()):
            sources, pipeline = _whole_case_sources(tuple(sorted(case["documents"].items())), case["pipelineDocument"])
            return gencmu.load_pipeline_sources(sources, pipeline), None
        sources, pipeline = case_sources(case)
        loaded = gencmu.load_pipeline_sources(sources, pipeline, use_cache=use_cache)
        return loaded, None
    except gencmu.GencmuError as error:
        return None, error


def parse_case(
    pipeline: gencmu.Pipeline, case: dict[str, Any], run: dict[str, Any] | None = None
) -> tuple[dict[str, Any] | None, gencmu.ParseResult | None, gencmu.GencmuError | None]:
    """An engine case's canonical result and result, parsed with a loaded
    pipeline under the options of ``run``, the case itself or one item of
    its ``parses`` (tests/README.md); or a mistake of the caller in their
    place, which is no result (engine §13)."""
    options = (case if run is None else run).get("options", {})
    validate_case_options(options)
    kwargs: dict[str, Any] = {
        "features": options.get("features", []),
        "without_features": options.get("withoutFeatures", []),
        "until": options.get("until"),
        "elision_only": options.get("elisionOnly"),
    }
    try:
        # Every check of elision-only that ran must keep its witness
        # (tests/README.md).
        if "tokens" in case:
            tokens, text = case_tokens(case)
            result = parse_checked(lambda: pipeline.parse_tokens(tokens, text, **kwargs))
        else:
            result = parse_checked(lambda: pipeline.parse(case.get("input", ""), **kwargs))
    except gencmu.GencmuError as error:
        if error.kind != "usage":
            raise
        return None, None, error
    return gencmu.result_json(result), result, None


def case_features(pipeline: gencmu.Pipeline) -> list[dict[str, Any]]:
    """A pipeline's features as a case writes them."""
    return [{"name": feature.name, "kind": feature.kind, "default": feature.default} for feature in pipeline.features]


def run_case(
    case: dict[str, Any], use_cache: bool = True, *, parameters: bool = False
) -> tuple[dict[str, Any] | None, gencmu.ParseResult | None, gencmu.GencmuError | None, list[dict[str, Any]] | None]:
    """An engine case's canonical result and result, or the error in their
    place: the load's, or the parse's for a mistake of the caller, which is
    no result (engine §13). Last, the pipeline's features as a case writes
    them, or None if it did not load."""
    validate_engine_case(case, parameters=parameters)
    pipeline, error = load_case_pipeline(case, use_cache)
    if pipeline is None:
        return None, None, error, None
    value, result, error = parse_case(pipeline, case)
    return value, result, error, case_features(pipeline)


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
    value = read_json(write_json(value))

    def follow(path: list[Any]) -> Any:
        target: Any = value
        for step in path:
            target = target[step]
        return target

    parent = follow(mutant["path"][:-1])
    last = mutant["path"][-1]
    if "set" in mutant:
        parent[last] = read_json(write_json(mutant["set"]))
    elif "copy" in mutant:
        parent[last] = follow(mutant["copy"])
    elif "keep" in mutant:
        parent[last] = parent[last][: mutant["keep"]]
    elif "remove" in mutant:
        del parent[last]
    elif "append" in mutant:
        parent[last] = [*parent[last], read_json(write_json(mutant["append"]))]
    else:
        raise AssertionError(f"the mutant {mutant['name']} changes nothing")
    return value


# ---- Places in the shared fixtures (tests/README.md, "Places in fixtures")

# In a fixture's find and replace, a source position of any value.
ANY_POSITION = '"at":[*]'
_POSITION_AT = re.compile(r'"at":\[(\d+,\d+)\]')


def find_places(text: str, find: str) -> list[tuple[int, int, list[str]]]:
    """Every place where a fixture's find stands in text: its start, its
    end, and the positions that its wildcards stand for, as "LINE,COLUMN"."""
    first, *rest = find.split(ANY_POSITION)
    places = []
    start = text.find(first)
    while start != -1:
        at = start + len(first)
        positions = []
        for piece in rest:
            found = _POSITION_AT.match(text, at)
            if not found or not text.startswith(piece, found.end()):
                break
            positions.append(found.group(1))
            at = found.end() + len(piece)
        if len(positions) == len(rest):
            places.append((start, at, positions))
        start = text.find(first, start + 1)
    return places


def substitute(text: str, find: str, replace: str) -> str:
    """text with the first place of find replaced by replace, whose
    wildcards take the positions of those of find, in order."""
    places = find_places(text, find)
    if not places:
        raise AssertionError(f"the fixture's find is not in the text: {find}")
    start, end, positions = places[0]
    first, *rest = replace.split(ANY_POSITION)
    if len(rest) > len(positions):
        raise AssertionError(f"the fixture's replace has more wildcards than its find: {replace}")
    return text[:start] + first + "".join(f'"at":[{position}]{piece}' for position, piece in zip(positions, rest)) + text[end:]


def position_of(text: str, needle: str) -> tuple[int, int]:
    """The line and column, counted from 1, where needle stands in text,
    which must hold it exactly once. A line ends at CR LF, CR or LF, and a
    column counts code points."""
    if not needle:
        raise AssertionError("an empty text stands everywhere in the document")
    first = text.find(needle)
    if first == -1 or text.find(needle, first + 1) != -1:
        raise AssertionError(f"{needle!r} does not stand exactly once in the document")
    lines = re.split(r"\r\n|\r|\n", text[:first])
    return len(lines), len(lines[-1]) + 1
