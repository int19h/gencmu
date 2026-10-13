"""Validate source, cached, and bootstrap DOMs against engine §9."""

from __future__ import annotations

import re
from typing import Any, Protocol

from ._clauses import definition_problem, duplicate_captures, deferred_emission_problem, rule_has_ranked
from ._patterns import pattern_problem, walk_pattern
from ._strings import ENGINE_TAGS, USER_NAME, is_constant, literal_string, lit
from ._types import constant_value_problem, open_part, rule_type_problem, term_type, tag_term_problem, condition_type_problem


class Marks(Protocol):
    def is_mark(self, code: int) -> bool: ...


FORMAT = 26
MAX_DEPTH = 256
TOO_DEEP = "nested too deeply"
CONSTANT_NAME = USER_NAME
CLASSIFIER_NAME = re.compile(r"[a-z][A-Za-z0-9_-]*")
CAPTURE_NAME = re.compile(r"[a-z][a-z0-9_-]*")
_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_-]*")
_FEATURE = re.compile(r"[A-Za-z][A-Za-z0-9-]*")
_DIRECTIVES = {"ambiguity-resolution", "stage", "extend-stage", "redefine-stage", "include", "features"}
TEST_OPS = frozenset(("tags", "=", "≠"))


def _is_position(value: Any) -> bool:
    return isinstance(value, list) and len(value) == 2 and all(type(x) is int and x >= 1 for x in value)


def _items(value: Any, least: int = 1, most: float = float("inf")) -> bool:
    return isinstance(value, list) and least <= len(value) <= most


def _tag(value: Any) -> bool:
    return isinstance(value, str) and (USER_NAME.fullmatch(value) is not None or value in ENGINE_TAGS)


def _ref(value: Any) -> bool:
    return isinstance(value, str) and (value == "#" or _NAME.fullmatch(value) is not None or value in ENGINE_TAGS)


def _capture(value: Any, whole: bool = True) -> bool:
    return isinstance(value, str) and (whole and value == "" or CAPTURE_NAME.fullmatch(value) is not None)


def _guard(value: Any, gate: bool = False) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == {"feature", "kind", "negated"}
        and isinstance(value["feature"], str)
        and _FEATURE.fullmatch(value["feature"]) is not None
        and type(value["negated"]) is bool
        and (value["kind"] == "gate" or not gate and value["kind"] == "warning" and not value["negated"])
    )


def _base(expr: Any, hash_: bool = False) -> bool:
    return (
        isinstance(expr, dict)
        and len(expr) == 1
        and (
            "ref" in expr
            and _ref(expr["ref"])
            and (hash_ or expr["ref"] != "#")
            or "literal" in expr
            or "range" in expr
            or expr.get("wildcard") is True
        )
    )


def _target(expr: Any, hash_: bool = False) -> bool:
    if _base(expr, hash_):
        return True
    if not isinstance(expr, dict):
        return False
    if expr.get("test") == "tags":
        return set(expr) == {"test", "requirements", "expr"} and _base(expr["expr"])
    if expr.get("test") in ("=", "≠"):
        inner = expr.get("expr")
        return set(expr) == {"test", "value", "expr"} and (
            _base(inner) or isinstance(inner, dict) and inner.get("test") == "tags" and _target(inner)
        )
    return False


def elidable_head(expr: Any) -> Any:
    head = expr["seq"][0] if isinstance(expr, dict) and _items(expr.get("seq")) else expr
    base = head
    while isinstance(base, dict) and "test" in base:
        base = base.get("expr")
    if isinstance(base, dict) and set(base) == {"ref"} and isinstance(base["ref"], str) and USER_NAME.fullmatch(base["ref"]):
        return head if _target(head) else None
    return None


def term_reads_own_tags(root: Any) -> bool:
    pending = [root]
    while pending:
        node = pending.pop()
        if isinstance(node, list):
            pending.extend(node)
        elif isinstance(node, dict):
            if node.get("method") in ("tags", "classes") and not node["args"] and node["receiver"] == {"capture": ""}:
                return True
            if node.get("op") not in ("≅", "≇"):
                pending.extend(node.values())
    return False


def range_problem(ends: Any, unicode: Marks) -> str | None:
    if not _items(ends, 2, 2):
        return "a range requires two string terms"
    values = [literal_string(end) for end in ends]
    if any(value is not None and len(value) != 1 for value in values):
        return "a range endpoint requires one scalar"
    if all(value is not None for value in values) and values[0] > values[1]:
        return "a range starts above its end"
    return None


def _contains_engine(root: Any) -> bool:
    pending = [root]
    while pending:
        node = pending.pop()
        if isinstance(node, list):
            pending.extend(node)
        elif isinstance(node, dict) and "pattern" not in node:
            if node.get("tag") in ENGINE_TAGS:
                return True
            pending.extend(node.values())
    return False


def dom_problem(dom: Any, unicode: Marks, defer_emission: bool = False) -> str | None:
    try:
        return _dom_problem(dom, unicode, defer_emission)
    except (KeyError, IndexError, TypeError, ValueError):
        # External JSON can violate a child schema before type selection.
        return "a malformed DOM"


def _dom_problem(dom: Any, unicode: Marks, defer_emission: bool = False) -> str | None:
    arrays = ("rules", "directives", "constants", "classifiers", "implications")
    if (
        not isinstance(dom, dict)
        or type(dom.get("format")) is not int
        or dom["format"] != FORMAT
        or any(not isinstance(dom.get(k), list) for k in arrays)
    ):
        return f"not a DOM of format {FORMAT}"
    positions = set()
    for key in arrays:
        for item in dom[key]:
            if not isinstance(item, dict) or not _is_position(item.get("at")):
                return "a declaration requires a position"
            at = tuple(item["at"])
            if at in positions:
                return "two items at one position"
            positions.add(at)
    pending = []
    for d in dom["directives"]:
        name, args = d.get("name"), d.get("args")
        if name not in _DIRECTIVES or "maximal" in d or not isinstance(args, list) or any(not isinstance(x, str) for x in args):
            return "a malformed directive"
        if name in ("stage", "extend-stage", "redefine-stage"):
            valid = len(args) == 1 and CLASSIFIER_NAME.fullmatch(args[0]) is not None
        elif name == "include":
            valid = len(args) == 1
        elif name == "features":
            valid = bool(args) and all(_FEATURE.fullmatch(x) for x in args)
        else:
            valid = args in (
                ["greedy"],
                ["lazy"],
                ["late-elision"],
                ["greedy", "elision-only"],
                ["lazy", "elision-only"],
                ["late-elision", "elision-only"],
            )
        if not valid:
            return "a directive has invalid operands"
    for c in dom["constants"]:
        if (
            set(c) != {"name", "op", "value", "at"}
            or not isinstance(c["name"], str)
            or not CONSTANT_NAME.fullmatch(c["name"])
            or c["op"] not in ("define", "redefine")
        ):
            return "a malformed constant"
        if open_part(c["value"]) is not None or _contains_engine(c["value"]):
            return "a constant requires a closed term without engine-tag literals"
        pending.append(("term", c["value"], 0, False, False))
    for c in dom["classifiers"]:
        if (
            set(c) != {"name", "entries", "at"}
            or not isinstance(c["name"], str)
            or not CLASSIFIER_NAME.fullmatch(c["name"])
            or not isinstance(c["entries"], list)
        ):
            return "a malformed classifier"
        for e in c["entries"]:
            if (
                not isinstance(e, dict)
                or set(e) != {"guards", "keys", "op", "class", "at"}
                or not _is_position(e["at"])
                or not isinstance(e["guards"], list)
                or not all(_guard(g, True) for g in e["guards"])
                or not _items(e["keys"])
                or e["op"] not in ("∈", "∉")
                or not isinstance(e["class"], str)
                or not USER_NAME.fullmatch(e["class"])
                or not "A" <= e["class"][-1] <= "Z"
            ):
                return "a malformed classifier entry"
            pending.extend(("string", x, 0, False, False) for x in e["keys"])
    for i in dom["implications"]:
        if set(i) != {"if", "then", "at"}:
            return "a malformed implication"
        for term in (i["if"], i["then"]):
            if open_part(term) is not None or _contains_engine(term):
                return "an implication requires closed terms without engine-tag literals"
            pending.append(("tags", term, 0, False, False))
    for r in dom["rules"]:
        if (
            not set(r) <= {"name", "op", "flags", "tags", "value", "image", "alternatives", "emit", "conditions", "erased", "at"}
            or not isinstance(r.get("name"), str)
            or not (r["name"] == "#" or CLASSIFIER_NAME.fullmatch(r["name"]))
            or r.get("op") not in ("define", "redefine", "extend")
            or r.get("flags") not in ([], ["leftmost-longest"])
            or r["op"] == "extend"
            and r["flags"]
            or not _items(r.get("alternatives"))
            or not isinstance(r.get("conditions"), list)
            or "erased" in r
            and (r["erased"] is not True or any(k in r for k in ("emit", "value", "image")))
        ):
            return "a malformed rule"
        for channel in ("value", "image"):
            if channel in r:
                pending.append(("recipe", r[channel], 0, False, False))
        if "tags" in r:
            if term_reads_own_tags(r["tags"]) or lit(r["tags"]):
                return "a constituent tag clause introduces engine tags or reads its own tags"
            pending.append(("tags", r["tags"], 0, False, False))
        if "emit" in r:
            emit = r["emit"]
            if not isinstance(emit, dict) or set(emit) != {"items"} or not _items(emit["items"]):
                return "a malformed emission"
            names = []
            for item in emit["items"]:
                if not isinstance(item, dict) or not set(item) <= {"capture", "insert", "tags", "value", "image", "before", "after"}:
                    return "a malformed emission item"
                if "insert" in item:
                    if item["insert"] is not True or "capture" in item or "before" in item or "after" in item:
                        return "a malformed insertion"
                elif not _capture(item.get("capture")):
                    return "a malformed carrier"
                elif item["capture"]:
                    names.append(item["capture"])
                for side in ("before", "after"):
                    if side in item:
                        if not item.get("capture") or not _items(item[side]) or any(not _capture(x, False) for x in item[side]):
                            return "a malformed attachment"
                        names.extend(item[side])
                if "tags" in item:
                    if lit(item["tags"]):
                        return "an emission tag clause introduces engine tags"
                    pending.append(("tags", item["tags"], 0, False, False))
                for channel in ("value", "image"):
                    if channel in item:
                        pending.append(("recipe", item[channel], 0, False, False))
            if len(set(names)) != len(names):
                return "an emission lists a capture twice"
        pending.extend(("condition", c, 0, False, False) for c in r["conditions"])
        for a in r["alternatives"]:
            if (
                not isinstance(a, dict)
                or not set(a) <= {"guards", "expr", "tags", "value", "image"}
                or not isinstance(a.get("guards"), list)
                or not all(_guard(g) for g in a["guards"])
            ):
                return "a malformed alternative"
            pending.append(("expr", a.get("expr"), 0, True, False))
            if "tags" in a:
                if term_reads_own_tags(a["tags"]) or lit(a["tags"]):
                    return "a constituent tag clause introduces engine tags or reads its own tags"
                pending.append(("tags", a["tags"], 0, False, False))
            for channel in ("value", "image"):
                if channel in a:
                    if "erased" in r:
                        return "an erased rule has a recipe"
                    pending.append(("recipe", a[channel], 0, False, False))
    problem = _walk(pending, unicode)
    if problem:
        return problem
    for r in dom["rules"]:
        for a in r["alternatives"]:
            if duplicate_captures(a["expr"]):
                return "a capture name used twice in one production"
        problem = definition_problem(r) or rule_type_problem(r)
        if problem and not (defer_emission and deferred_emission_problem(problem) and rule_has_ranked(r)):
            return problem
    for c in dom["constants"]:
        problem = constant_value_problem(c["value"], c["op"] == "redefine")
        if problem:
            return problem
    return None


def _walk(pending: list, unicode: Marks) -> str | None:
    types = {}
    while pending:
        kind, node, depth, whole, sealed = pending.pop()
        if depth > MAX_DEPTH:
            return TOO_DEEP
        if not isinstance(node, dict):
            return f"a malformed {kind}"
        below = depth + 1
        keys = set(node)
        if kind == "expr":
            if any(k in node for k in ("seq", "choice", "ranked", "and")):
                key = next(k for k in ("seq", "choice", "ranked", "and") if k in node)
                if keys != {key} or not _items(node[key], 2, 16 if key == "and" else float("inf")):
                    return "ranked-choice-syntax: malformed ranked choice" if key == "ranked" else "a malformed expression"
                pending.extend(("expr", x, below, False, sealed) for x in node[key])
            elif "optional" in node:
                if (
                    not keys <= {"optional", "elidable"}
                    or "elidable" in node
                    and (node["elidable"] is not True or elidable_head(node["optional"]) is None)
                ):
                    return "a malformed optional"
                pending.append(("expr", node["optional"], below, False, sealed or "elidable" in node))
            elif "repeat" in node:
                if (
                    not keys <= {"repeat", "separator", "chain"}
                    or "chain" in node
                    and (not whole or node["chain"] not in ("left", "right"))
                ):
                    return "a malformed repetition"
                pending.append(("expr", node["repeat"], below, False, True))
                if "separator" in node:
                    pending.append(("expr", node["separator"], below, False, True))
            elif "capture" in node:
                if keys != {"capture", "expr"} or sealed or not _capture(node["capture"], False) or not _target(node["expr"], True):
                    return "a malformed capture"
                pending.append(("expr", node["expr"], below, False, sealed))
            elif "test" in node:
                if not _target(node):
                    return "a malformed test"
                pending.append(("expr", node["expr"], below, False, sealed))
                if node["test"] == "tags":
                    if not isinstance(node["requirements"], list):
                        return "a malformed tag test"
                    for r in node["requirements"]:
                        if not isinstance(r, dict) or set(r) != {"negated", "value"} or type(r["negated"]) is not bool:
                            return "a malformed requirement"
                        value = r["value"]
                        if not isinstance(value, dict) or not (set(value) == {"tag"} or set(value) == {"const", "at"}):
                            return "a tag test requires tags or constants"
                        pending.append(("tags", value, below, False, False))
                else:
                    pending.append(("string", node["value"], below, False, False))
            elif "range" in node:
                if keys != {"range"} or range_problem(node["range"], unicode):
                    return "a malformed range"
                pending.extend(("string", x, depth, False, False) for x in node["range"])
            elif "literal" in node:
                if keys != {"literal"}:
                    return "a malformed literal"
                pending.append(("string", node["literal"], depth, False, False))
            elif not (
                keys == {"ref"}
                and _ref(node["ref"])
                or keys == {"wildcard"}
                and node["wildcard"] is True
                or keys == {"empty"}
                and node["empty"] is True
            ):
                return "a malformed expression"
            continue
        if kind == "recipe":
            if keys != {"concat"} or not _items(node["concat"]):
                return "a malformed recipe"
            for atom in node["concat"]:
                if isinstance(atom, dict) and "method" in atom:
                    receiver = atom.get("receiver")
                    valid = atom.get("args") == [] and (
                        atom["method"] in ("value", "image", "source-text", "verbatim-text")
                        and isinstance(receiver, dict)
                        and set(receiver) == {"capture"}
                        or atom["method"] in ("value", "image")
                        and isinstance(receiver, dict)
                        and set(receiver) == {"method", "receiver", "args"}
                        and receiver["method"] == "emitted"
                        and receiver["args"] == []
                        and isinstance(receiver["receiver"], dict)
                        and set(receiver["receiver"]) == {"capture"}
                    )
                    if not valid:
                        return "a recipe requires one of its six captured string methods"
                    pending.append(("recipe-method", atom, below, False, False))
                else:
                    pending.append(("string", atom, below, False, False))
            continue
        if kind == "condition":
            if "op" in node:
                if keys != {"op", "left", "right"} or node["op"] not in ("=", "≠", "∈", "∉", "⊆", "⊈", "≅", "≇"):
                    return "a malformed comparison"
                if node["op"] in ("≅", "≇") and not (isinstance(node["left"], dict) and set(node["left"]) == {"capture"}):
                    return "a tree comparison requires a bare capture"
                pending.extend(("term", node[k], below, False, False) for k in ("left", "right"))
            elif "any" in node or "all" in node:
                key = "any" if "any" in node else "all"
                if keys != {key} or not _items(node[key], 2):
                    return "a malformed condition"
                pending.extend(("condition", x, below, False, False) for x in node[key])
            elif "not" in node:
                if keys != {"not"}:
                    return "a malformed condition"
                pending.append(("condition", node["not"], below, False, False))
            elif "if" in node:
                if keys != {"if", "then"}:
                    return "a malformed condition"
                pending.extend(("condition", node[k], below, False, False) for k in ("if", "then"))
            elif not (
                keys == {"captured"}
                and _capture(node["captured"])
                or keys == {"method", "receiver", "args"}
                and node["method"] in ("matches", "begins", "starts-input")
            ):
                return "a malformed condition"
            problem = condition_type_problem(node, memo=types)
            if problem:
                return problem
            if "method" not in node:
                continue
        elif kind == "tags":
            problem = tag_term_problem(node, memo=types)
            if problem:
                return problem
        if "method" in node:
            if keys != {"method", "receiver", "args"} or not isinstance(node["method"], str) or not isinstance(node["args"], list):
                return "a malformed method"
            recipe = kind == "recipe-method"
            if not recipe and (
                node["method"] in ("verbatim-text", "emitted")
                or isinstance(node["receiver"], dict)
                and node["receiver"].get("method") == "emitted"
            ):
                return "a recipe-only method outside a recipe"
            result, problem = term_type(node, memo=types)
            if problem:
                return problem
            if kind == "string":
                return "a string operand requires a literal or constant"
            if node["method"] == "split" and literal_string(node["args"][0]) == "":
                return "split has an empty delimiter"
            pending.append(("recipe-method" if recipe else "term", node["receiver"], below, False, False))
            for arg in node["args"]:
                if isinstance(arg, dict) and set(arg) in ({"rule"}, {"classifier"}):
                    key = next(iter(arg))
                    if not isinstance(arg[key], str) or not CLASSIFIER_NAME.fullmatch(arg[key]):
                        return "a malformed method name argument"
                else:
                    pending.append(("term", arg, below, False, False))
        elif "interpolate" in node:
            if keys != {"interpolate"} or not _items(node["interpolate"]):
                return "a malformed interpolation"
            pending.extend(("string", x, below, False, False) for x in node["interpolate"])
        elif "string" in node:
            if keys != {"string"} or not isinstance(node["string"], str) or any(0xD800 <= ord(c) <= 0xDFFF for c in node["string"]):
                return "a malformed scalar string"
        elif "const" in node:
            if keys != {"const", "at"} or not is_constant(node["const"]) or not _is_position(node["at"]):
                return "a malformed constant reference"
        elif kind == "string":
            return "a string operand requires a literal or constant"
        elif "tag" in node:
            if keys != {"tag"} or not _tag(node["tag"]):
                return "a malformed tag"
        elif "capture" in node:
            if keys != {"capture"} or not _capture(node["capture"]):
                return "a malformed capture reference"
        elif "pattern" in node:
            if keys != {"pattern"}:
                return "a malformed pattern term"
            problem = pattern_problem(node["pattern"], initial_depth=below)
            if problem:
                return problem
            for atom, offset in walk_pattern(node["pattern"]):
                atom_depth = below + offset
                if "literal" in atom:
                    pending.append(("string", atom["literal"], atom_depth, False, False))
                elif "range" in atom:
                    problem = range_problem(atom["range"], unicode)
                    if problem:
                        return problem
                    pending.extend(("string", end, atom_depth, False, False) for end in atom["range"])
                elif atom.get("test") == "tags":
                    if not isinstance(atom["requirements"], list):
                        return "a malformed pattern tag test"
                    for requirement in atom["requirements"]:
                        if (
                            not isinstance(requirement, dict)
                            or set(requirement) != {"negated", "value"}
                            or type(requirement["negated"]) is not bool
                        ):
                            return "a malformed pattern tag requirement"
                        operand = requirement["value"]
                        if not isinstance(operand, dict) or not (set(operand) == {"tag"} or set(operand) == {"const", "at"}):
                            return "a pattern tag test requires a tag or constant"
                        pending.append(("tags", operand, atom_depth + 1, False, False))
                elif "test" in atom:
                    pending.append(("string", atom["value"], atom_depth + 1, False, False))
        elif any(k in node for k in ("union", "intersection", "difference")):
            key = next(k for k in ("union", "intersection", "difference") if k in node)
            if keys != {key} or not _items(node[key], 2, 2 if key == "difference" else float("inf")):
                return "a malformed set expression"
            problem = term_type(node, memo=types)[1]
            if problem:
                return problem
            pending.extend(("term", x, below, False, False) for x in node[key])
        elif "if" in node:
            if keys != {"if", "then"}:
                return "a malformed guarded term"
            pending.append(("condition", node["if"], below, False, False))
            pending.append(("tags", node["then"], below, False, False))
        elif not (keys == {"emptySet"} and node["emptySet"] is True):
            return "a malformed term"
    return None
