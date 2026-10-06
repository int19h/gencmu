"""Helpers for the shared test cases of the repository's tests/ directory."""

from __future__ import annotations

import __future__
import ast
from contextlib import contextmanager
from dataclasses import dataclass, replace
import bisect
from collections import deque
from collections.abc import ItemsView, KeysView, ValuesView
import dis
import faulthandler
import inspect
import json
import linecache
import os
from pathlib import Path
import signal
import sys
import textwrap
import threading
from types import CodeType, FrameType, MemberDescriptorType
from typing import Any, Callable, Iterator
from unittest import mock

import gencmu
from gencmu._model import Token
from gencmu._trampoline import Walk, run
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
_LOOPS: dict[CodeType, dict[int, int]] = {}


def _starting(frame: FrameType) -> bool:
    """Whether a frame's line starts its loops, and so makes their
    iterables. A pass of a loop runs from its loop instruction or a jump
    back after it. A generator expression receives its iterable. List,
    set, and dict comprehensions run inside the enclosing code."""
    code = frame.f_code
    if code.co_name in _COMPREHENSIONS:
        return False
    loops = _LOOPS.get(code)
    if loops is None:
        loops = _LOOPS[code] = {}
        lines = [(start, number) for start, _, number in code.co_lines()]
        for instruction in dis.get_instructions(code):
            if instruction.opname != "FOR_ITER":
                continue
            number = next((number for start, number in reversed(lines) if start <= instruction.offset), None)
            if number is not None and number not in loops:
                loops[number] = instruction.offset
    first = loops.get(frame.f_lineno)
    return first is None or frame.f_lasti < first


# The charges of each line of each code object, found once.
_CODE_CHARGES: dict[tuple[CodeType, int], tuple[Charges, Charges]] = {}


def reads(frame: FrameType) -> int:
    """A weight for a step of a line, read before the line runs: one, and
    the elements that the operations starting on it read in C. A union, a
    copy, a comparison of containers, a join or a search of a sequence
    reads each element of its operands. An update in place reads its
    arguments only, and a search of a set or a dict reads none. A loop's
    iterable is charged as the loop starts. Every operand of the line
    counts, whichever branch runs, so the weight does not fall short of
    the work."""
    key = (frame.f_code, frame.f_lineno)
    charges = _CODE_CHARGES.get(key)
    if charges is None:
        charges = _CODE_CHARGES[key] = _charges(frame.f_code.co_filename).get(frame.f_lineno, ([], []))
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
    starts: dict[CodeType, list[Watch]] = {}
    lines: dict[CodeType, list[Watch]] = {}
    for watch in watches:
        for code in watch.codes:
            (starts if watch.calls else lines).setdefault(code, []).append(watch)

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
        for watch in starts[code]:
            add(1 if watch.weight is None else watch.weight(frame))

    def step(code: CodeType, number: int, frame: FrameType) -> bool:
        """Counts a step of a line, and tells whether any watch counts it."""
        counted = False
        for watch in lines[code]:
            numbers = watch.codes[code]
            if numbers is None or number in numbers:
                counted = True
                add(1 if watch.weight is None else watch.weight(frame))
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
        for code in set(starts) | set(lines):
            wanted = events.NO_EVENTS
            if code in starts:
                wanted |= events.PY_START
            if code in lines:
                wanted |= events.LINE | events.JUMP
            monitoring.set_local_events(tool, code, wanted)
        # The places that an earlier count turned off count again.
        monitoring.restart_events()
        yield work
    finally:
        monitoring.set_events(tool, events.NO_EVENTS)
        for code in set(starts) | set(lines):
            monitoring.set_local_events(tool, code, events.NO_EVENTS)
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
        with mock.patch.object(owner, name, defined[function.__name__]):
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


def cases(kind: str) -> list[Path]:
    return sorted((SHARED / kind).glob("*.json"))


def load_json(path: Path) -> Any:
    """A shared file's JSON value, read with a list for a stack, since a
    case can nest as deep as the results it expects."""
    return read_json(path.read_text(encoding="utf-8"))


def load_case(path: Path) -> dict[str, Any]:
    return load_json(path)  # type: ignore[no-any-return]


def read_json(text: str) -> Any:
    """A JSON text's value, read with a list for a stack. A result can nest
    beyond the depth that json.loads accepts, so the reader keeps open
    containers in an explicit stack."""
    decoder = json.JSONDecoder()
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
        elif isinstance(other, (dict, list)) or one != other:
            return False
    return True


def mismatch(pattern: Any, value: Any, where: str = "$") -> str | None:
    """Where a value fails to match a pattern (tests/README.md), or None.
    The first in document order, found with a list for a stack, since a
    pattern can follow a result as deep as it nests."""
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
        elif pattern != value or type(pattern) is not type(value):
            return f"{where}: expected {write_json(pattern)}, found {write_json(value)}"
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
    # A walk, since attachments nest as deep as a case writes them.
    return run(_case_tokens(case["tokens"])), " ".join(spec["text"] for spec in case["tokens"])  # type: ignore[no-any-return]


def _case_tokens(specs: list[dict[str, Any]]) -> Walk:
    tokens: list[Token] = []
    position = 0
    for index, spec in enumerate(specs):
        # Attachments, which a caller cannot supply, go to the library as
        # they stand, so that it refuses them or drops empty ones
        # (tests/README.md).
        before = [replace(token, span=None) for token in (yield _case_tokens(spec["before"]))] if "before" in spec else []
        after = [replace(token, span=None) for token in (yield _case_tokens(spec["after"]))] if "after" in spec else []
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
    return tokens


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
