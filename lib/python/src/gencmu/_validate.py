"""Validate source, cached, and bootstrap DOMs against engine §9."""

from __future__ import annotations

import re
from typing import Any, Protocol

from ._clause_walk import clause_children
from ._clauses import check_definition, duplicate_captures, repeated_item_capture
from ._pattern_shapes import layered_pattern_fault, layered_pattern_problem, MAX_POSITION
from ._strings import USER_NAME
from ._template_nodes import has_unresolved
from ._trampoline import run
from ._types import _METHODS, condition_type_problem, method_shape_problem, rule_type_fault, tag_term_fault, term_type_fault


class Marks(Protocol):
    def canonical_tag(self, spelling: str) -> str | None: ...
    def is_mark(self, code: int) -> bool: ...
    def is_emoji_name(self, name: str) -> bool: ...
    def changes_in_document(self, code: int) -> bool: ...


FORMAT = 50
MAX_DEPTH = 256
TOO_DEEP = "nested too deeply"
CONSTANT_NAME = USER_NAME
CLASSIFIER_NAME = re.compile(r"(?!.*--)[a-z][A-Za-z0-9_-]*")
CAPTURE_NAME = re.compile(r"(?!.*--)[a-z][a-z0-9_-]*")
_NAME = re.compile(r"(?!.*--)[A-Za-z][A-Za-z0-9_-]*")
_FEATURE = re.compile(r"(?!.*--)[A-Za-z][A-Za-z0-9-]*")
_DIRECTIVES = {"ambiguity-resolution", "elision-only", "stage", "extend-stage", "redefine-stage", "include", "names", "features"}
TEST_OPS = frozenset(("tags", "=", "≠"))
KEY_STEPS = frozenset(("leftmost-longest", "fewest", "most", "late", "early"))
"""The steps of ``%ambiguity-resolution`` that take a category (engine §6)."""
LEANS = frozenset(("greedy", "lazy"))
"""The steps of ``%ambiguity-resolution`` that compare actions (engine §6)."""

def valid_steps(steps: Any) -> bool:
    if not isinstance(steps, list) or not steps:
        return False
    for index, step in enumerate(steps):
        if not isinstance(step, dict) or not isinstance(step.get("step"), str):
            return False
        if step["step"] in LEANS:
            if index != len(steps) - 1 or set(step) != {"step"}:
                return False
        elif step["step"] not in KEY_STEPS or set(step) != {"step", "pattern"} or not isinstance(step["pattern"], dict):
            return False
    return True


def _is_position(value: Any) -> bool:
    return isinstance(value, (list, tuple)) and len(value) == 2 and all(type(x) is int and 1 <= x <= MAX_POSITION for x in value)


def _object(value: Any) -> bool:
    return isinstance(value, dict)


def _exact(value: Any, fields: tuple[str, ...] | list[str]) -> bool:
    return isinstance(value, dict) and all(key in fields for key in value)


def _grouped(value: Any) -> bool:
    return getattr(value, "grouped", False) is True


def node_at(value: Any, fallback: Any = None) -> Any:
    """A node's position, written or held outside its members, or
    ``fallback``."""
    if isinstance(value, dict):
        at = value.get("at")
        if _is_position(at):
            return list(at)
        at = getattr(value, "at", None)
        if _is_position(at):
            return list(at)
    return fallback


class At(dict):
    """A stand-in that holds only a source position, outside its members."""

    def __init__(self, at: Any):
        super().__init__()
        self.at = list(at) if at is not None else None


def _has_one_form(value: dict, forms: list[list[str]]) -> bool:
    """Whether a node has exactly the members of one of its forms."""
    form = next((members for members in forms if members[0] in value), None)
    if form is None:
        return False
    return all(member in value for member in form) and all(key in form for key in value)


def elidable_head(expr: Any) -> Any:
    """The head of an elidable optional, or None when it has no terminator
    head (engine §3.8, §9)."""
    if not isinstance(expr, dict) or _grouped(expr):
        return None
    head = expr.get("expr") if isinstance(expr.get("capture"), str) else expr["seq"][0] if isinstance(expr.get("seq"), list) and expr["seq"] else expr
    if not isinstance(head, dict) or _grouped(head):
        return None

    def terminal(node):
        return isinstance(node, dict) and not _grouped(node) and (
            isinstance(node.get("param"), str)
            or all(key in ("ref", "at") for key in node) and isinstance(node.get("ref"), str) and USER_NAME.fullmatch(node["ref"]) is not None)

    if terminal(head):
        return head
    base = head
    while isinstance(base, dict) and not _grouped(base) and isinstance(base.get("test"), str) and base["test"] in TEST_OPS:
        base = base.get("expr")
    return head if terminal(base) else None


def term_reads_own_tags(node: Any) -> bool:
    """Whether a term, or a condition inside one, reads the tags of ``$``:
    ``$.tags`` or ``$.classes``. Anything malformed reads nothing."""
    from ._patterns import reads_node_tags
    stack = [node]
    while stack:
        current = stack.pop()
        if not isinstance(current, dict):
            continue
        if isinstance(current.get("method"), str):
            args = current.get("args")
            receiver = current.get("receiver")
            if current["method"] in ("tags", "classes") and isinstance(args, list) and not args and isinstance(receiver, dict) and receiver.get("capture") == "":
                return True
            if current["method"] == "tags" or current["method"] in _QUERY_METHODS:
                continue
            stack.append(receiver)
            stack.extend(args if isinstance(args, list) else [])
            continue
        if current.get("op") in ("≅", "≇"):
            left, right = current.get("left"), current.get("right")
            if isinstance(left, dict) and left.get("capture") == "" and isinstance(right, dict) and right.get("pattern") and reads_node_tags(right["pattern"]):
                return True
            continue
        key = next((name for name in ("union", "intersection", "difference", "concat", "any", "all") if isinstance(current.get(name), list)), None)
        if key is not None:
            stack.extend(current[key])
        else:
            stack.extend(current.get(name) for name in ("left", "right", "not", "if", "then"))
    return False


def range_problem(ends: Any) -> str | None:
    """What is wrong with a range (engine §1, §9), or None: visible
    endpoints each hold one scalar, and the start is not above the end."""
    if not isinstance(ends, list) or len(ends) != 2:
        return "a malformed range"
    values = [end["string"] if isinstance(end, dict) and isinstance(end.get("string"), str) else None for end in ends]
    if any(value is not None and len(value) != 1 for value in values):
        return "a range endpoint is one scalar"
    if all(value is not None for value in values) and values[0] > values[1]:
        return "a range starts above its end"
    return None


def first_engine_literal(term: Any) -> Any:
    """The first engine-tag literal that a tag term retains, or None."""
    return (run(_literal_terms(term)) or [None])[0]


def _literal_terms(term: Any) -> Any:
    if not isinstance(term, dict):
        return []
    if isinstance(term.get("tag"), str) and term["tag"].startswith("_"):
        return [term]
    if term.get("if"):
        return (yield _literal_terms(term.get("then")))
    if term.get("difference"):
        return (yield _literal_terms(term["difference"][0]))
    values = term.get("union") or term.get("intersection")
    if not values:
        return []
    parts = []
    for value in values:
        parts.append((yield _literal_terms(value)))
    flat = [value for part in parts for value in part]
    if term.get("union"):
        return flat
    names = [{value["tag"] for value in part} for part in parts]
    return [value for value in flat if all(value["tag"] in found for found in names)]


def known_dom_members(dom):
    if isinstance(dom, dict) and isinstance(dom.get("directives"), list):
        return {**dom, "directives": [
            {key: value for key, value in directive.items() if key in ("name", "args", "steps", "conditions", "at")}
            if isinstance(directive, dict) else directive for directive in dom["directives"]
        ]}
    return dom


def dom_fault(dom: Any, unicode: Marks, defer_emission: bool = True, expanded: bool = False, held: Any = None):
    """The first DOM fault as ``(problem, at, code)``, or None. ``at`` is the
    position of the fault, or None for the document."""
    try:
        return _inspect(known_dom_members(dom), unicode, defer_emission, expanded, held)
    except (KeyError, IndexError, TypeError, ValueError, AttributeError):
        # External JSON can violate a child schema before type selection.
        return ("a malformed DOM", None, None)


def dom_problem(dom: Any, unicode: Marks, defer_emission: bool = True, expanded: bool = False, held: Any = None) -> str | None:
    """Why a value is not a grammar DOM, or None."""
    fault = dom_fault(dom, unicode, defer_emission, expanded, held)
    return None if fault is None else fault[0]


_QUERY_METHODS = frozenset(("starts-input", "ends-input", "parse", "error-free", "followed-by", "preceded-by"))
_TARGET_METHODS = frozenset(("followed-by", "preceded-by"))
_COMPARATORS = frozenset(("=", "≠", "∈", "∉", "⊆", "⊈", "≅", "≇"))
_CLASS_NAME = re.compile(r"(?!.*--)[A-Z](?:[A-Za-z0-9_-]*[A-Z])?")
_TAG_NAME = re.compile(r"(?!.*--)[A-Z][A-Za-z0-9_-]*")
_PARAM_NAME = re.compile(r"(?!.*--)[A-Za-z][A-Za-z0-9_-]*")
_INTEGER = re.compile(r"[1-9][0-9]*")
_TERM_FORMS = [["string"], ["concat"], ["tag"], ["const", "at"], ["emptySet"], ["capture"], ["method", "receiver", "args"],
               ["union"], ["intersection"], ["difference"], ["if", "then"], ["pattern"]]
_CONDITION_FORMS = [["method", "receiver", "args"], ["op", "left", "right"], ["not"], ["any"], ["all"], ["captured"], ["if", "then"], ["nonempty"]]
_RULE_FIELDS = ("name", "params", "args", "op", "tags", "value", "image", "alternatives", "emit", "conditions", "erased", "error", "warning", "suppressWarnings", "at")
_RECIPE_METHODS = ("value", "image", "source-text", "decomposed-source-text", "verbatim-text")


def _reads_capture(root: Any) -> bool:
    pending = [root]
    while pending:
        node = pending.pop()
        if isinstance(node, list):
            pending.extend(node)
        elif isinstance(node, dict):
            if "capture" in node or "captured" in node:
                return True
            pending.extend(node.values())
    return False


class _Task:
    """One queued construct of the DOM walk, with the context it inherits."""

    __slots__ = ("kind", "value", "depth", "params", "at", "closed", "feature_at", "whole", "sealed", "chain", "item",
                 "ranked", "captured_terminator", "recipe", "query", "message", "owner", "pattern_tag", "set_condition_at")

    def __init__(self, kind, value, depth, params, **context):
        self.kind = kind
        self.value = value
        self.depth = depth
        self.params = params
        self.at = None
        self.closed = None
        self.feature_at = None
        self.whole = False
        self.sealed = False
        self.chain = False
        self.item = False
        self.ranked = False
        self.captured_terminator = False
        self.recipe = False
        self.query = False
        self.message = False
        self.owner = None
        self.pattern_tag = False
        self.set_condition_at = None
        for key, value in context.items():
            setattr(self, key, value)


def _inspect(dom: Any, unicode: Marks, defer_emission: bool, expanded: bool, held: Any = None):
    """One DOM validator, in the order of engine §9.3 step 5. Returns
    ``(problem, at, code)`` or None."""
    from ._boundary import problem as boundary_problem
    from ._query_forms import query_body, query_capture
    from ._types import constant_value_type, expected_problem

    arrays = ("rules", "directives", "constants", "classifiers", "implications")
    if (
        not isinstance(dom, dict)
        or not all(key in ("format", *arrays) for key in dom)
        or type(dom.get("format")) is not int
        or dom["format"] != FORMAT
        or any(not isinstance(dom.get(key), list) for key in arrays)
    ):
        return (f"not a DOM of format {FORMAT}", None, None)

    def string_atom(value):
        return isinstance(value, dict) and not _grouped(value) and ("string" in value or "const" in value)

    def string_term(value):
        return not _grouped(value) and (string_atom(value) or isinstance(value, dict) and "param" in value)

    def tag(value):
        return isinstance(value, str) and (_TAG_NAME.fullmatch(value) is not None or value.startswith("_") and value != "_" and unicode.canonical_tag(value) == value)

    def rule_name(name):
        return isinstance(name, str) and (CLASSIFIER_NAME.fullmatch(name) is not None or unicode.is_emoji_name(name)
                                         or expanded and "(" in name and name.endswith(")"))

    def gate(value):
        return (_exact(value, ("feature", "kind", "negated")) and len(value) == 3 and isinstance(value.get("feature"), str)
                and _FEATURE.fullmatch(value["feature"]) is not None and type(value.get("negated")) is bool and value.get("kind") == "gate")

    def base(value):
        return isinstance(value, dict) and not _grouped(value) and (
            "param" in value or "call" in value or "splice" in value or isinstance(value.get("ref"), str)
            or "literal" in value or "range" in value or value.get("wildcard") is True)

    def target(value):
        return base(value) or isinstance(value, dict) and value.get("test") == "tags" and base(value.get("expr"))

    def expr_exact(value, fields):
        return _exact(value, (*fields, "at")) and ("at" not in value or _is_position(value["at"]))

    def expr_single(value, key):
        return expr_exact(value, (key,)) and key in value

    def fault(problem, value=None, fallback=None, code=None):
        return (problem, node_at(value, fallback), code)

    declared = [item for key in arrays for item in dom[key]]
    for item in declared:
        if not isinstance(item, dict) or not _is_position(item.get("at")):
            return ("a malformed declaration position", None, None)
    positions = set()
    for item in declared:
        at = tuple(item["at"])
        if at in positions:
            return ("two items at one position", list(item["at"]), None)
        positions.add(at)
    statements = [item["at"] for key in ("rules", "constants", "classifiers", "implications") for item in dom[key]]
    statements += [d["at"] for d in dom["directives"] if d.get("name") != "names"]
    if statements:
        first = min(tuple(at) for at in statements)
        late = sorted((tuple(d["at"]) for d in dom["directives"] if d.get("name") == "names" and tuple(d["at"]) > first))
        if late:
            return ("%names must precede every other statement", list(late[0]), None)

    first_deep = None
    first_semantic = None
    pending: list[_Task] = []
    active = [frozenset()]

    def push(kind, value, depth=0, **context):
        context.setdefault("params", active[0])
        params = context.pop("params")
        pending.append(_Task(kind, value, depth, params, **context))

    def run_shape_tasks(decl_at):
        first_shape = None
        while pending:
            found = run_one(pending.pop(), decl_at)
            if found is not None:
                if found[2] == "ranked-choice-syntax":
                    return found
                if first_shape is None:
                    first_shape = found
        return first_shape

    def run_one(task, decl_at):
        nonlocal first_deep
        kind, value, depth = task.kind, task.value, task.depth
        enclosing = task.feature_at or node_at(value, task.at or decl_at)

        def report(problem, target_node=value, code=None):
            return fault(problem, None if task.feature_at else target_node, enclosing, code)

        active[0] = task.params
        if depth > MAX_DEPTH and first_deep is None:
            first_deep = decl_at
        if not isinstance(value, dict):
            return report(f"a malformed {kind}")

        def child(child_kind, child_value, **context):
            base_context = dict(params=task.params, at=enclosing, closed=task.closed, feature_at=task.feature_at)
            base_context.update(context)
            push(child_kind, child_value, depth + 1, **base_context)

        def same(child_kind, child_value, at=None, **context):
            push(child_kind, child_value, depth, params=task.params, at=enclosing if at is None else at, feature_at=task.feature_at, **context)

        if kind == "classifier-entry":
            bad_gate = next((g for g in value.get("gates") if not gate(g)), None) if isinstance(value.get("gates"), list) else None
            if (not _exact(value, ("gates", "keys", "op", "class", "at")) or not _is_position(value.get("at")) or not isinstance(value.get("gates"), list)
                    or bad_gate is not None or value.get("op") not in ("∈", "∉") or not isinstance(value.get("class"), str)
                    or not isinstance(value.get("keys"), list) or not value["keys"]):
                return report("a malformed classifier entry", bad_gate if bad_gate is not None else value)
            for key in value["keys"]:
                if not string_term(key):
                    return report("a malformed classifier key", key)
            class_at = getattr(value, "class_at", None)
            push("classifier-class", value, depth, params=task.params, at=list(class_at) if class_at else value["at"])
            for key in reversed(value["keys"]):
                push("term", key, depth, params=task.params, at=node_at(key, value["at"]))
            return None
        if kind == "classifier-class":
            if _CLASS_NAME.fullmatch(value["class"]) is None:
                class_at = getattr(value, "class_at", None)
                return report(f"{value['class']} is not a class: a class starts and ends with a capital", At(class_at) if class_at else value)
            return None
        if kind == "alternative":
            bad_gate = next((g for g in value.get("gates") if not gate(g)), None) if isinstance(value.get("gates"), list) else None
            if not _exact(value, ("gates", "expr", "tags", "value", "image")) or "expr" not in value or not isinstance(value.get("gates"), list) or bad_gate is not None:
                return report("a malformed alternative", bad_gate if bad_gate is not None else value)
            for channel in ("image", "value"):
                if channel in value:
                    push("recipe", value[channel], depth, params=task.params, at=node_at(value[channel], enclosing), feature_at=task.feature_at)
            if "tags" in value:
                push("tags", value["tags"], depth, params=task.params, owner=task.owner, at=node_at(value["tags"], enclosing), feature_at=task.feature_at)
            push("expr", value["expr"], depth, params=task.params, whole=True, at=node_at(value["expr"], enclosing), feature_at=task.feature_at)
            return None
        if kind == "pattern":
            inspect = dict(name=lambda name: rule_name(name) and not tag(name), terminal=lambda name: name == "_Elided" or tag(name), range_check=range_problem)
            found = layered_pattern_fault(value, depth=depth, defer_depth=True, **inspect)
            if found is not None:
                return report(found[0], found[1] if found[1] is not None else At(task.at) if task.at else value)
            if layered_pattern_problem(value, depth=depth, **inspect) == TOO_DEEP and first_deep is None:
                first_deep = decl_at
            same("pattern-part", value)
            return None
        if kind == "pattern-part":
            if value.get("param") and value["param"] not in task.params:
                return report(f"undeclared parameter @{value['param']}")
            if value.get("call"):
                stack = [value.get("args")]
                while stack:
                    node = stack.pop()
                    if isinstance(node, list):
                        stack.extend(reversed(node))
                    elif isinstance(node, dict):
                        if node.get("rule") and tag(node["rule"]):
                            return report("a pattern argument rule reads back as a tag", node)
                        stack.extend(reversed(list(node.values())))
                for arg in reversed(value["args"]):
                    child("arg", arg, closed=None)
            if value.get("children"):
                for item in reversed(value["children"]):
                    child("pattern-item", item, closed=None)
            for key in ("union", "intersection", "difference"):
                if value.get(key):
                    for operand in reversed(value[key]):
                        child("pattern-part", operand, closed=None)
            if value.get("path"):
                child("pattern-part", value["pattern"], closed=None)
            if value.get("test") == "tags":
                if not expanded and isinstance(value.get("expr"), dict) and ("name" in value["expr"] or "call" in value["expr"]):
                    for requirement in value["requirements"]:
                        if not requirement.get("negated") and isinstance(requirement.get("value"), dict) and requirement["value"].get("tag") == "_Elided":
                            return report("a rule pattern cannot require _Elided", requirement["value"])
                for requirement in reversed(value["requirements"]):
                    child("term", requirement["value"], pattern_tag=True, closed=None)
            elif value.get("test"):
                child("term", value["value"], closed=None)
            if value.get("expr"):
                child("pattern-part", value["expr"], closed=None)
            if value.get("range"):
                problem = range_problem(value["range"])
                if problem:
                    return report(problem)
                for end in reversed(value["range"]):
                    same("term", end)
            if value.get("literal"):
                same("term", value["literal"])
            return None
        if kind == "pattern-item":
            if value.get("choice"):
                for arm in reversed(value["choice"]):
                    for item in reversed(arm):
                        child("pattern-item", item, closed=None)
            for key in ("separator", "repeat", "optional"):
                if value.get(key):
                    for item in reversed(value[key]):
                        child("pattern-item", item, closed=None)
            if value.get("child"):
                child("pattern-part", value["child"], closed=None)
            return None
        # Unresolved leaves still obey the category of their position.
        if "param" in value:
            if kind not in ("expr", "arg", "term", "tags", "target", "pattern", "pattern-part"):
                return report(f"a malformed {kind}")
            if not _exact(value, ("param", "at")) or not _is_position(value.get("at")) or not isinstance(value["param"], str) or value["param"] not in task.params:
                well_formed = isinstance(value["param"], str) and _exact(value, ("param", "at")) and _is_position(value.get("at"))
                return report(f"undeclared parameter @{value['param']}" if well_formed else "an undeclared or malformed parameter")
            return None
        if "call" in value or kind == "call":
            if kind not in ("expr", "arg", "term", "tags", "target", "pattern", "pattern-part", "call"):
                return report(f"a malformed {kind}")
            if not _exact(value, ("call", "args", "at")) or not rule_name(value.get("call")) or not _is_position(value.get("at")) or not isinstance(value.get("args"), list) or not value["args"]:
                return report("a malformed call")
            for arg in reversed(value["args"]):
                child("arg", arg, closed=None)
            return None
        if kind == "arg":
            if "classifier" in value or "integer" in value:
                return report("an argument cannot read or declare captures")
            if "body" in value:
                if not _exact(value, ("body",)):
                    return report("a malformed body argument")
                same("expr", value["body"], whole=True)
            elif "targets" in value:
                if not _exact(value, ("targets",)) or not isinstance(value["targets"], list) or len(value["targets"]) < 2:
                    return report("a malformed target choice")
                for choice in reversed(value["targets"]):
                    same("target", choice)
            elif "requirements" in value and not value.get("test"):
                if not _exact(value, ("requirements",)) or not isinstance(value["requirements"], list):
                    return report("a malformed requirement list")
                for entry in value["requirements"]:
                    entry_value = entry.get("value") if isinstance(entry, dict) else None
                    if (not _exact(entry, ("negated", "value")) or type(entry.get("negated")) is not bool or not isinstance(entry_value, dict)
                            or _grouped(entry_value) or not (entry_value.get("tag") or entry_value.get("const") or entry_value.get("param"))):
                        return report("a malformed requirement", entry_value if entry_value is not None else entry)
                for entry in reversed(value["requirements"]):
                    same("term", entry["value"])
            elif value.get("rule"):
                if not _exact(value, ("rule",)) or not rule_name(value["rule"]):
                    return report("a malformed nominal rule argument")
            elif value.get("splice") or value.get("test") or value.get("range") or value.get("wildcard"):
                same("expr", value)
            else:
                same("term", value)
            return None
        if kind == "target":
            if not (_exact(value, ("rule",)) and rule_name(value.get("rule")) or _exact(value, ("terminal",)) and isinstance(value.get("terminal"), str) and _TAG_NAME.fullmatch(value["terminal"])):
                return report("a malformed query target")
            return None
        if kind == "test-operands":
            if value.get("test") == "tags":
                for requirement in value["requirements"]:
                    requirement_value = requirement.get("value") if isinstance(requirement, dict) else None
                    if (not _exact(requirement, ("negated", "value")) or type(requirement.get("negated")) is not bool or not isinstance(requirement_value, dict)
                            or _grouped(requirement_value) or not ("tag" in requirement_value or "const" in requirement_value or "param" in requirement_value)):
                        return report("a malformed requirement", requirement_value if requirement_value is not None else requirement)
                for requirement in reversed(value["requirements"]):
                    child("term", requirement["value"])
            else:
                if not string_term(value.get("value")):
                    return report("a malformed value test", value.get("value"))
                child("term", value["value"])
            return None
        if kind == "method-shape":
            # An unknown method in a recipe atom is a fault of type
            # inspection, which reports it after the clause's tag terms
            # (engine §9.3).
            unknown = isinstance(value.get("method"), str) and value["method"] not in _METHODS
            problem = None if task.recipe and unknown else method_shape_problem(value.get("method"), value.get("receiver"), value.get("args"), task.recipe)
            if problem:
                return report(problem)
            if task.query and value.get("method") in _METHODS and value["method"] not in _QUERY_METHODS:
                return report("a condition requires a query method")
            return None
        if kind == "expr":
            inside = dict(sealed=task.sealed, chain=task.chain, item=task.item, ranked=task.ranked)
            if "splice" in value:
                spliced = value["splice"]
                if not expr_single(value, "splice") or not isinstance(spliced, dict) or not (isinstance(spliced.get("ref"), str) and rule_name(spliced["ref"]) or spliced.get("call")):
                    return report("a malformed splice")
                child("expr", spliced, **inside)
            elif value.get("test"):
                fields = ("test", "requirements", "expr") if value["test"] == "tags" else ("test", "value", "expr")
                if (value["test"] not in TEST_OPS or not expr_exact(value, fields) or not ("requirements" in value if value["test"] == "tags" else "value" in value)
                        or "expr" not in value or not (base(value["expr"]) if value["test"] == "tags" else target(value["expr"]))):
                    return report("a malformed test")
                if value["test"] == "tags" and not isinstance(value["requirements"], list):
                    return report("a malformed tag test")
                push("test-operands", value, depth, params=task.params, at=enclosing, closed=task.closed, feature_at=task.feature_at)
                child("expr", value["expr"], **inside)
            elif "capture" in value:
                if not expr_exact(value, ("capture", "expr")) or "expr" not in value or not isinstance(value["capture"], str) or not isinstance(value["expr"], dict):
                    return report("a malformed capture")
                if task.chain:
                    return report("a capture cannot stand inside a chain, whose levels are constituents of its rule: a condition on $ serves each level")
                if task.item and task.ranked:
                    return report("an item capture cannot stand inside a ranked group: name the ranked choice as a rule and capture that rule")
                if task.sealed and not task.captured_terminator:
                    return report("a capture cannot stand inside an elidable optional, which elision restores as one unit")
                if value["capture"] == "":
                    return report("$ is the whole constituent and wraps nothing")
                if CAPTURE_NAME.fullmatch(value["capture"]) is None:
                    return report("a capture's name is all lower case")
                inner = value["expr"]
                while isinstance(inner, dict) and not _grouped(inner) and isinstance(inner.get("test"), str):
                    inner = inner.get("expr")
                if not base(inner):
                    return report("a capture wraps one symbol")
                child("expr", value["expr"], **inside)
            elif any(key in value for key in ("seq", "choice", "ranked", "and")):
                own = [key for key in value if key != "at"]
                if len(own) != 1 or not expr_exact(value, own):
                    return report("a malformed expression")
                key = own[0]
                items = value[key]
                if not isinstance(items, list) or len(items) < 2 or key == "and" and len(items) > 16:
                    if key == "ranked":
                        return report("ranked-choice-syntax: a ranked expression requires two options", value, "ranked-choice-syntax")
                    return report("an & joins at most 16 items" if key == "and" and isinstance(items, list) and len(items) > 16 else "a malformed expression")
                for item in reversed(items):
                    child("expr", item, **{**inside, "ranked": task.ranked or key == "ranked"})
            elif "optional" in value:
                optional = value["optional"]
                if (not expr_exact(value, ("optional", "elidable", "default")) or not isinstance(optional, dict)
                        or "elidable" in value and (value["elidable"] is not True or elidable_head(optional) is None)):
                    return report("a malformed optional")
                if "default" in value:
                    default = value["default"]
                    if value.get("elidable") is not True or not string_term(default):
                        return report("a malformed default", default)
                    if "string" in default:
                        head = optional.get("expr") if "capture" in optional else optional["seq"][0] if "seq" in optional else optional
                        while isinstance(head, dict) and "test" in head:
                            if (head["test"] != "tags" and isinstance(head.get("value"), dict) and "string" in head["value"]
                                    and (default["string"] == head["value"]["string"]) != (head["test"] == "=")):
                                default_at = getattr(default, "default_at", None)
                                return report("a default fails its head test", At(default_at) if default_at else default)
                            head = head.get("expr")
                    child("term", default)
                elidable = value.get("elidable") is True
                child("expr", optional, sealed=task.sealed or elidable,
                      captured_terminator=not task.sealed and elidable and isinstance(optional.get("capture"), str),
                      chain=task.chain, item=task.item, ranked=task.ranked)
            elif "repeat" in value:
                if not expr_exact(value, ("repeat", "separator", "chain")) or "chain" in value and value["chain"] not in ("left", "right"):
                    return report("a malformed repetition")
                if "chain" in value and (not task.whole or _grouped(value)):
                    return report("a chain is the whole expression of its alternative: name it as a rule to use it here")
                braces = dict(sealed=task.sealed, chain="chain" in value, item="chain" not in value, ranked=False)
                if "separator" in value:
                    child("expr", value["separator"], **braces)
                child("expr", value["repeat"], **braces)
            elif "literal" in value:
                if not expr_single(value, "literal") or not string_term(value["literal"]):
                    return report("a malformed literal")
                same("term", value["literal"])
            elif "range" in value:
                ends = value["range"]
                if not expr_single(value, "range") or not isinstance(ends, list) or len(ends) != 2 or not all(string_term(end) for end in ends):
                    return report("a malformed range")
                problem = range_problem(ends)
                if problem:
                    return report(problem)
                for end in reversed(ends):
                    same("term", end)
            elif "ref" in value:
                if not expr_single(value, "ref") or not (rule_name(value["ref"]) or tag(value["ref"])):
                    return report("a malformed reference")
            elif not (expr_single(value, "empty") and value["empty"] is True or expr_single(value, "wildcard") and value["wildcard"] is True):
                return report("a malformed expression")
            return None
        if kind == "tags":
            # A malformed tag term gets its structural fault from its own task.
            try:
                retained = first_engine_literal(value)
            except (KeyError, IndexError, TypeError, ValueError, AttributeError):
                retained = None
            if retained is not None:
                return report("a tag clause cannot introduce an engine tag", retained)
            same("term", value)
            return None
        if kind == "emission":
            items = value.get("items")
            if len(value) != 1 or not isinstance(items, list) or not items:
                return report("a malformed emission")
            for item in items:
                if (not _exact(item, ("capture", "insert", "tags", "value", "image", "before", "after")) or ("capture" in item) == ("insert" in item)
                        or "capture" in item and not isinstance(item["capture"], str) or "insert" in item and item["insert"] is not True):
                    return report("a malformed emission item", item)
                if isinstance(item.get("capture"), str) and item["capture"] != "" and CAPTURE_NAME.fullmatch(item["capture"]) is None:
                    return fault("a malformed emission item", None, decl_at)
                for side in ("before", "after"):
                    if side in item:
                        names = item[side]
                        if not item.get("capture") or not isinstance(names, list) or not names or not all(isinstance(name, str) for name in names):
                            return report("a malformed attachment", item)
                        if not all(CAPTURE_NAME.fullmatch(name) for name in names):
                            return fault("a malformed attachment", None, decl_at)
            for item in reversed(items):
                item_at = node_at(item, enclosing)
                for channel in ("image", "value"):
                    if channel in item:
                        push("recipe", item[channel], depth, params=task.params, at=node_at(item[channel], item_at), feature_at=task.feature_at)
                if "tags" in item:
                    push("tags", item["tags"], depth, params=task.params, owner=task.owner, at=node_at(item["tags"], item_at), feature_at=task.feature_at)
            return None
        if kind == "recipe":
            atoms = value.get("concat")
            if len(value) != 1 or not isinstance(atoms, list) or not atoms:
                return report("a malformed recipe")
            if task.message:
                stack = [value]
                while stack:
                    node = stack.pop()
                    if isinstance(node, dict) and node.get("method") == "emitted":
                        clause_at = getattr(value, "clause_at", None)
                        return report("a message recipe cannot read .emitted", At(clause_at) if clause_at else value)
                    stack.extend(clause_children(node))
            for atom in atoms:
                if not isinstance(atom, dict):
                    return report("a malformed recipe atom", atom)
            for atom in reversed(atoms):
                child("term", atom, recipe=True)
            return None
        if kind == "condition":
            if not _has_one_form(value, _CONDITION_FORMS):
                return report("a malformed condition")
            if "method" in value:
                if not isinstance(value["method"], str):
                    return report("a condition requires a query method")
                same("term", value, query=True, closed=None)
            elif "nonempty" in value:
                operand = value["nonempty"]
                set_at = node_at(operand, enclosing) if isinstance(operand, dict) and any(key in operand for key in ("union", "intersection", "difference")) else None
                push("term", operand, depth + 1, params=task.params, set_condition_at=set_at, at=enclosing, feature_at=task.feature_at)
            elif value.get("op"):
                left = value.get("left")
                if value["op"] not in _COMPARATORS or value["op"] in ("≅", "≇") and not (isinstance(left, dict) and isinstance(left.get("capture"), str) and len(left) == 1):
                    return report("a malformed comparison")
                child("term", value["right"])
                child("term", value["left"])
            elif "captured" in value:
                if not isinstance(value["captured"], str) or value["captured"] != "" and CAPTURE_NAME.fullmatch(value["captured"]) is None:
                    return report("a malformed presence")
            elif value.get("not"):
                child("condition", value["not"])
            elif value.get("if"):
                child("condition", value["then"])
                child("condition", value["if"])
            else:
                values = value.get("any") if "any" in value else value.get("all")
                if not isinstance(values, list) or len(values) < 2:
                    return report("a malformed connective")
                for condition in reversed(values):
                    child("condition", condition)
            return None
        # A term, in every other position.
        if not _has_one_form(value, _TERM_FORMS):
            return report("a malformed term")
        if "string" in value:
            if not isinstance(value["string"], str) or any(0xD800 <= ord(c) <= 0xDFFF for c in value["string"]):
                return report("a malformed scalar string")
        elif value.get("tag"):
            if not (task.pattern_tag and value["tag"] == "_Elided") and not tag(value["tag"]):
                return report("a malformed tag")
        elif value.get("const"):
            if not isinstance(value["const"], str) or CONSTANT_NAME.fullmatch(value["const"]) is None or not _is_position(value.get("at")):
                return report("a malformed constant reference")
        elif "emptySet" in value:
            if value["emptySet"] is not True:
                return report("a malformed empty set")
        elif "capture" in value:
            if not isinstance(value["capture"], str) or value["capture"] != "" and CAPTURE_NAME.fullmatch(value["capture"]) is None:
                return report("a malformed capture reference")
        elif "method" in value:
            method, args, receiver = value["method"], value["args"], value["receiver"]
            if method in ("classify", "ngrams") and isinstance(args, list) and any(has_unresolved(arg) for arg in args):
                return report("a parameter cannot replace a classifier name or integer argument")
            if not isinstance(args, list) or not isinstance(receiver, dict) or not task.query and method in _QUERY_METHODS and method not in ("parse", "error-free"):
                wrong_place = not task.query and isinstance(args, list) and isinstance(receiver, dict) and method in _QUERY_METHODS
                return report("a query method is a condition, not a term" if wrong_place else "a malformed method",
                              At(task.set_condition_at) if task.set_condition_at else value)
            # The receiver and arguments come before the signature, so that
            # faults inside them come first in written order.
            if not task.closed or method in ("split", "ngrams") or method not in _METHODS:
                same("method-shape", value, recipe=task.recipe, query=task.query)
            if isinstance(method, str) and method in _METHODS:
                for arg in reversed(args):
                    if isinstance(arg, dict) and "body" in arg:
                        if method != "parse" or not _exact(arg, ("body",)):
                            return report("a malformed parse argument", arg)
                        body, _, problem = query_body(arg["body"])
                        if problem:
                            return report(problem, arg["body"])
                        captured = query_capture(body)
                        if captured:
                            return report("a parse argument cannot declare captures", captured)
                        stripped = isinstance(arg["body"].get("seq"), list) and not (isinstance(body, dict) and isinstance(body.get("seq"), list))
                        push("expr", body, depth + (2 if stripped else 1), params=task.params, at=node_at(body, enclosing), feature_at=task.feature_at)
                    elif isinstance(arg, dict) and isinstance(arg.get("rule"), str):
                        if len(arg) != 1 or method not in ("without-elision-except", "followed-by", "preceded-by") or not rule_name(arg["rule"]):
                            return report("a malformed rule argument", value)
                    elif isinstance(arg, dict) and isinstance(arg.get("terminal"), str):
                        if len(arg) != 1 or method not in _TARGET_METHODS or _TAG_NAME.fullmatch(arg["terminal"]) is None:
                            return report("a malformed boundary target", value)
                    elif isinstance(arg, dict) and "integer" in arg:
                        if len(arg) != 1 or method != "ngrams" or not isinstance(arg["integer"], str):
                            return report("a malformed integer argument", arg)
                        if _INTEGER.fullmatch(arg["integer"]) is None:
                            return report("an integer argument is positive and has no leading zeros", arg)
                    elif isinstance(arg, dict) and isinstance(arg.get("classifier"), str):
                        if len(arg) != 1 or method != "classify" or CLASSIFIER_NAME.fullmatch(arg["classifier"]) is None:
                            return report("a malformed classifier argument", value)
                    else:
                        child("term", arg)
            child("term", receiver, recipe=task.recipe)
        elif value.get("concat"):
            if not isinstance(value["concat"], list) or len(value["concat"]) < 2:
                return report("a malformed concatenation")
            for segment in reversed(value["concat"]):
                child("term", segment)
        elif value.get("pattern"):
            child("pattern", value["pattern"], closed=None)
        elif value.get("if"):
            child("term", value["then"])
            child("condition", value["if"])
        else:
            items = value.get("union") or value.get("intersection") or value.get("difference")
            if not isinstance(items, list) or len(items) < 2 or value.get("difference") and len(items) != 2:
                return report("a malformed set operation")
            for item in reversed(items):
                child("term", item, set_condition_at=task.set_condition_at)
        return None

    def closed_term_fault(root, closed_for, fallback):
        stack = [(root, node_at(root, fallback))]
        while stack:
            node, parent_at = stack.pop()
            if not isinstance(node, dict):
                continue
            here = node_at(node, parent_at)
            if "capture" in node:
                return fault(f"{closed_for} is a closed term, and holds no capture", node, here)
            if "if" in node:
                return fault(f"{closed_for} is a closed term, and holds no guarded term", node, here)
            if isinstance(node.get("tag"), str) and node["tag"].startswith("_"):
                return fault(f"{closed_for} cannot contain an engine-tag literal", node, here)
            if node.get("pattern"):
                continue
            if isinstance(node.get("method"), str):
                if node["method"] not in ("split", "ngrams"):
                    inner = closed_term_fault(node.get("receiver"), closed_for, here)
                    if inner is not None:
                        return inner
                    return fault(f"{closed_for} cannot read an input method", node, here)
                stack.extend((arg, here) for arg in reversed(node["args"]))
                stack.append((node.get("receiver"), here))
                continue
            key = next((name for name in ("union", "intersection", "difference", "concat") if isinstance(node.get(name), list)), None)
            if key is not None:
                stack.extend((item, here) for item in reversed(node[key]))
        return None

    def first_capture_arg(root, fallback):
        stack = [(root, node_at(root, fallback))]
        while stack:
            node, parent_at = stack.pop()
            if isinstance(node, list):
                stack.extend((item, parent_at) for item in reversed(node))
                continue
            if not isinstance(node, dict):
                continue
            here = node_at(node, parent_at)
            if isinstance(node.get("args"), list) and ("call" in node or "alternatives" in node):
                for arg in node["args"]:
                    if _reads_capture(arg):
                        return fault("an argument cannot read or declare captures", arg, here)
            stack.extend((value, here) for key, value in reversed(list(node.items())) if key != "at")
        return None

    def enclosing_at(root, target_node, fallback):
        own = node_at(target_node)
        if own is not None:
            return own
        stack = [(root, node_at(root, fallback))]
        seen = set()
        while stack:
            node, at = stack.pop()
            if not isinstance(node, (dict, list)) or id(node) in seen:
                continue
            seen.add(id(node))
            here = node_at(node, at)
            if node is target_node:
                return here
            if isinstance(node, list):
                stack.extend((item, here) for item in reversed(node))
            else:
                stack.extend((value, here) for key, value in reversed(list(node.items())) if key != "at")
        return fallback

    def type_fault_at(found, root, decl_at):
        """A type fault at its own position, or its construct's."""
        at = getattr(found, "at", None)
        return fault(found[0], At(at) if at else found[1], enclosing_at(root, found[1], decl_at))

    declarations = sorted(
        [("directive", d) for d in dom["directives"]] + [("constant", c) for c in dom["constants"]]
        + [("classifier", c) for c in dom["classifiers"]] + [("implication", i) for i in dom["implications"]]
        + [("rule", r) for r in dom["rules"]],
        key=lambda pair: tuple(pair[1]["at"]))

    for decl_kind, decl in declarations:
        pending.clear()
        active[0] = frozenset()
        decl_at = decl["at"]
        header = None
        name_at = getattr(decl, "name_at", None)
        named_at = list(name_at) if name_at else decl_at
        if decl_kind == "directive":
            name, args = decl.get("name"), decl.get("args")
            if name not in _DIRECTIVES:
                header = fault("a malformed directive", decl, decl_at)
            elif "conditions" in decl and (name != "features" or not isinstance(decl["conditions"], list) or not decl["conditions"]):
                header = fault("only %features accepts conditions" if name != "features" else "malformed feature conditions", decl, decl_at)
            elif name == "ambiguity-resolution":
                if "args" in decl or not valid_steps(decl.get("steps")):
                    header = fault("%ambiguity-resolution requires a pattern for each key step and no operand on a final lean", decl, decl_at)
                else:
                    for step in reversed(decl["steps"]):
                        if "pattern" in step:
                            step_at = node_at(step)
                            if "const" in step["pattern"]:
                                push("term", step["pattern"], 0, at=step_at or decl_at)
                            else:
                                push("pattern", step["pattern"], 0, at=step_at or node_at(step["pattern"], decl_at))
            elif not isinstance(args, list) or any(not isinstance(arg, str) for arg in args):
                header = fault("a malformed directive", decl, decl_at)
            elif name == "elision-only" and args:
                header = fault("a malformed directive", decl, decl_at)
            elif name in ("stage", "extend-stage", "redefine-stage") and not (len(args) == 1 and CLASSIFIER_NAME.fullmatch(args[0])):
                header = fault(f"%{name} takes one lowercase name", decl, decl_at)
            elif name in ("include", "names") and len(args) != 1 or name == "features" and not (args and all(_FEATURE.fullmatch(arg) for arg in args)):
                header = fault("%features takes feature names" if name == "features" else "a malformed directive", decl, decl_at)
            elif "conditions" in decl:
                for condition in reversed(decl["conditions"]):
                    push("condition", condition, 0, at=decl_at, feature_at=decl_at)
        elif decl_kind == "constant":
            if not _exact(decl, ("name", "op", "value", "at")) or not isinstance(decl.get("name"), str) or CONSTANT_NAME.fullmatch(decl["name"]) is None or decl.get("op") not in ("define", "redefine"):
                header = fault("a constant requires a user name" if isinstance(decl.get("name"), str) and CONSTANT_NAME.fullmatch(decl["name"]) is None else "a malformed constant", None, named_at)
            else:
                push("term", decl["value"], 0, at=node_at(decl["value"], decl_at), closed="constant")
        elif decl_kind == "classifier":
            if not _exact(decl, ("name", "entries", "at")) or not (isinstance(decl.get("name"), str) and CLASSIFIER_NAME.fullmatch(decl["name"])) or not isinstance(decl.get("entries"), list):
                bad_name = isinstance(decl.get("name"), str) and CLASSIFIER_NAME.fullmatch(decl["name"]) is None
                header = fault(f"{decl['name']} begins with a capital, so it is a tag; a classifier's name begins with a lower-case letter" if bad_name else "a malformed classifier", None, named_at)
            else:
                for entry in reversed(decl["entries"]):
                    push("classifier-entry", entry, 0, at=entry["at"] if isinstance(entry, dict) and _is_position(entry.get("at")) else decl_at)
        elif decl_kind == "implication":
            if not _exact(decl, ("if", "then", "at")):
                header = fault("a malformed implication", decl, decl_at)
            else:
                push("term", decl.get("then"), 0, at=node_at(decl.get("then"), decl_at), closed="implication")
                push("term", decl.get("if"), 0, at=node_at(decl.get("if"), decl_at), closed="implication")
        else:
            rule = decl
            params = rule.get("params")
            active[0] = frozenset(params) if isinstance(params, list) and all(isinstance(p, str) for p in params) else frozenset()
            if "params" in rule and (not isinstance(params, list) or not params or any(not isinstance(p, str) or _PARAM_NAME.fullmatch(p) is None for p in params)
                                     or len(set(params)) != len(params) or "args" in rule):
                valid_names = isinstance(params, list) and params and "args" not in rule and all(isinstance(p, str) and _PARAM_NAME.fullmatch(p) for p in params)
                duplicate = next((index for index, p in enumerate(params) if params.index(p) < index), -1) if valid_names else -1
                if duplicate >= 0:
                    param_ats = getattr(rule, "param_ats", None)
                    header = fault(f"duplicate parameter @{params[duplicate]}", None, list(param_ats[duplicate]) if param_ats else decl_at)
                else:
                    header = fault("malformed template parameters", rule, decl_at)
            elif rule.get("instance"):
                if getattr(rule, "has_head", False):
                    header = fault("a binding requires a plain rule name", rule, decl_at)
                elif (not _exact(rule, ("name", "op", "instance", "conditions", "at")) or not rule_name(rule.get("name")) or rule.get("op") not in ("define", "redefine")
                      or not isinstance(rule.get("conditions"), list) or rule["conditions"]):
                    bad_name = isinstance(rule.get("name"), str) and not rule_name(rule["name"])
                    header = fault("a rule name starts with a lowercase letter or uses one eligible emoji" if bad_name else "a malformed instance binding", None, named_at)
                else:
                    push("call", rule["instance"], 0, at=node_at(rule["instance"], decl_at))
            else:
                if "args" in rule:
                    if not isinstance(rule["args"], list) or not rule["args"]:
                        header = fault("a malformed call", None, named_at)
                    else:
                        stack = list(rule["args"])
                        while stack:
                            part = stack.pop()
                            if isinstance(part, list):
                                stack.extend(part)
                            elif isinstance(part, dict):
                                if "param" in part:
                                    header = fault("a head cannot mix parameters and concrete arguments", None, named_at)
                                    break
                                stack.extend(part.values())
                        if header is None and rule.get("op") not in ("redefine", "extend"):
                            header = fault("an instance head requires an edit", None, named_at)
                if header is None and (not _exact(rule, _RULE_FIELDS) or not (isinstance(rule.get("name"), str) and rule_name(rule["name"])) or rule.get("op") not in ("define", "redefine", "extend")
                                       or not isinstance(rule.get("alternatives"), list) or not rule["alternatives"] or not isinstance(rule.get("conditions"), list)):
                    bad_name = isinstance(rule.get("name"), str) and not rule_name(rule["name"])
                    header = fault("a rule name starts with a lowercase letter or uses one eligible emoji" if bad_name else "a malformed rule", None, named_at)
                if header is None and "erased" in rule and rule["erased"] is not True:
                    header = fault("a malformed erased rule", rule, decl_at)
                if header is None and ("error" in rule and "warning" in rule or params and ("error" in rule or "warning" in rule)):
                    header = fault("a definition accepts one diagnostic, and a template accepts none", rule, decl_at)
                codes = rule.get("suppressWarnings")
                if header is None and codes is not None and (not isinstance(codes, list) or not codes
                                                             or not (codes == ["_"]) and not all(isinstance(code, str) and _FEATURE.fullmatch(code) for code in codes)):
                    header = fault("a malformed warning suppression", rule, decl_at)
                if header is None:
                    # Pushed in reverse of the order of inspection: the head,
                    # tags, value, image, alternatives, conditions, the
                    # diagnostic and the emission.
                    if "emit" in rule:
                        push("emission", rule["emit"], 0, owner=rule, at=node_at(rule["emit"], decl_at))
                    for channel in ("warning", "error"):
                        if channel in rule:
                            push("recipe", rule[channel], 0, message=True, at=node_at(rule[channel], decl_at))
                    for condition in reversed(rule["conditions"]):
                        push("condition", condition, 0, at=node_at(condition, decl_at))
                    for alternative in reversed(rule["alternatives"]):
                        push("alternative", alternative, 0, owner=rule, at=node_at(alternative, decl_at))
                    for channel in ("image", "value"):
                        if channel in rule:
                            push("recipe", rule[channel], 0, at=node_at(rule[channel], decl_at))
                    if "tags" in rule:
                        push("tags", rule["tags"], 0, owner=rule, at=node_at(rule["tags"], decl_at))
                    if "args" in rule:
                        push("call", {"call": rule["name"], "args": rule["args"], "at": named_at}, 0, at=named_at)

        shape = header if header is not None else run_shape_tasks(decl_at)
        if shape is not None:
            if shape[2] == "ranked-choice-syntax":
                return shape
            if shape[0] == "split has an empty delimiter":
                if first_semantic is None:
                    first_semantic = shape
                continue
            if first_semantic is None:
                return shape
            continue
        if first_semantic is not None:
            continue

        if decl_kind == "directive":
            first_semantic = first_capture_arg(decl, decl_at)
        elif decl_kind == "constant":
            first_semantic = first_capture_arg(decl, decl_at) or closed_term_fault(decl["value"], "a constant's value", decl_at)
            if first_semantic is None:
                _, found = constant_value_type(decl["value"], decl["op"] == "redefine")
                if found is not None:
                    first_semantic = fault(found[0], found[1], node_at(decl["value"], decl_at))
        elif decl_kind == "implication":
            first_semantic = first_capture_arg(decl, decl_at)
            if first_semantic is None:
                for side in (decl["if"], decl["then"]):
                    side_at = node_at(side, decl_at)
                    first_semantic = closed_term_fault(side, "a side of an implication", side_at)
                    if first_semantic is not None:
                        break
                    kind_found, found = term_type_fault(side)
                    if found is not None:
                        first_semantic = fault(f"a side of an implication is a tag set: {found[0]}", found[1], side_at)
                        break
                    problem = expected_problem(kind_found, "tags")
                    if problem:
                        first_semantic = fault(f"a side of an implication is a tag set: {problem}", side, side_at)
                        break
        elif decl_kind == "rule":
            rule = decl
            if not rule.get("instance"):
                if "tags" in rule:
                    found = tag_term_fault(rule["tags"])
                    if found is not None:
                        first_semantic = type_fault_at(found, rule, decl_at)
                    elif term_reads_own_tags(rule["tags"]):
                        clause_at = getattr(rule["tags"], "clause_at", None)
                        first_semantic = fault("a constituent's tags cannot be made of its own: $.tags or $.classes",
                                               At(clause_at) if clause_at else rule["tags"], node_at(rule["tags"], decl_at))
                for alternative in rule["alternatives"]:
                    if first_semantic is not None:
                        break
                    alternative_at = node_at(alternative, decl_at)
                    twice = duplicate_captures(alternative["expr"])
                    if twice:
                        first = twice[0]
                        for other in twice[1:]:
                            a, b = node_at(first), node_at(other)
                            if a and b and tuple(b) < tuple(a):
                                first = other
                        first_semantic = fault(f"the capture ${first['capture']} is read twice by one production of the alternative", first,
                                               enclosing_at(alternative["expr"], first, alternative_at))
                        break
                    repeated = repeated_item_capture(alternative["expr"])
                    if repeated is not None:
                        first_semantic = fault(f"the item capture ${repeated['capture']} is read again: the name of an item capture stands once in its alternative",
                                               repeated, enclosing_at(alternative["expr"], repeated, alternative_at))
                        break
                    if "tags" in alternative:
                        found = tag_term_fault(alternative["tags"])
                        if found is not None:
                            first_semantic = type_fault_at(found, rule, decl_at)
                            break
                        if term_reads_own_tags(alternative["tags"]):
                            clause_at = getattr(alternative["tags"], "clause_at", None)
                            first_semantic = fault("a constituent's tags cannot be made of its own: $.tags or $.classes",
                                                   At(clause_at) if clause_at else alternative["tags"], node_at(alternative["tags"], alternative_at))
                            break
            if first_semantic is None:
                first_semantic = first_capture_arg(rule, decl_at)
            if first_semantic is None and not rule.get("instance"):
                found = rule_type_fault(rule)
                if found is not None:
                    first_semantic = type_fault_at(found, rule, decl_at)
            if first_semantic is None and not rule.get("instance") and rule.get("emit"):
                names = []
                for item in rule["emit"]["items"]:
                    if item.get("capture"):
                        names.append(item["capture"])
                    for side in ("before", "after"):
                        names.extend(item.get(side) or [])
                if len(set(names)) != len(names):
                    first_semantic = fault("an emission lists a capture twice", rule["emit"], decl_at)
            if first_semantic is None and not rule.get("instance"):
                found = boundary_problem(rule)
                if found is not None:
                    first_semantic = fault(found[0], found[1], enclosing_at(rule, found[1], decl_at))
                elif rule.get("erased") and (rule.get("emit") or rule.get("value") or rule.get("image")):
                    first_semantic = fault("a malformed erased rule", rule, decl_at)
                elif rule.get("erased") and any("value" in a or "image" in a for a in rule["alternatives"]):
                    first_semantic = fault("a recipe beside erasure", rule, decl_at)
                else:
                    issue = check_definition(rule, defer_emission, held if len(dom["rules"]) == 1 else None).problem
                    if issue:
                        first_semantic = fault(issue.message, rule, decl_at)

    if first_semantic is not None:
        return first_semantic
    if first_deep is not None:
        return (TOO_DEEP, list(first_deep), None)
    return None


def input_conditions_problem(conditions):
    allowed = {"tags", "classes", "value", "image", "source-text", "decomposed-source-text", "first-token", "tokens-after-first", "last-token", "split", "ngrams"}
    pending = list(conditions)
    while pending:
        node = pending.pop()
        if isinstance(node, list):
            pending.extend(node)
        elif isinstance(node, dict):
            if ("capture" in node and node["capture"] != "") or ("captured" in node and node["captured"] != ""):
                return "feature conditions can read only $"
            if node.get("op") in ("≅", "≇") or "method" in node and (node["method"] not in allowed or node["method"] == "tags" and node["args"]):
                return "feature conditions can read only tokens"
            pending.extend(node.values())
    for condition in conditions:
        problem = condition_type_problem(condition)
        if problem:
            return problem
    return None
