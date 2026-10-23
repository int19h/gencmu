"""Validate source, cached, and bootstrap DOMs against engine §9."""

from __future__ import annotations

from ._template_nodes import has_unresolved, nodes
from ._types import _METHODS

import re
from typing import Any, Protocol

from ._clauses import definition_problem, duplicate_captures, deferred_emission_problem, rule_has_ranked
from ._patterns import pattern_problem, walk_pattern
from ._pattern_shapes import layered_pattern_problem
from ._strings import ENGINE_TAGS, USER_NAME, is_constant, literal_string, lit
from ._types import constant_value_problem, open_part, rule_type_problem, term_type, tag_term_problem, condition_type_problem, method_shape_problem


class Marks(Protocol):
    def is_mark(self, code: int) -> bool: ...
    def is_emoji_name(self, name: str) -> bool: ...
    def changes_in_document(self, code: int) -> bool: ...


FORMAT = 40
MAX_DEPTH = 256
TOO_DEEP = "nested too deeply"
CONSTANT_NAME = USER_NAME
CLASSIFIER_NAME = re.compile(r"[a-z][A-Za-z0-9_-]*")
CAPTURE_NAME = re.compile(r"[a-z][a-z0-9_-]*")
_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_-]*")
_FEATURE = re.compile(r"[A-Za-z][A-Za-z0-9-]*")
_DIRECTIVES = {"ambiguity-resolution", "stage", "extend-stage", "redefine-stage", "include", "names", "features"}
TEST_OPS = frozenset(("tags", "=", "≠"))


def _is_position(value: Any) -> bool:
    return isinstance(value, list) and len(value) == 2 and all(type(x) is int and x >= 1 for x in value)


def _items(value: Any, least: int = 1, most: float = float("inf")) -> bool:
    return isinstance(value, list) and least <= len(value) <= most


def _tag(value: Any) -> bool:
    return isinstance(value, str) and (USER_NAME.fullmatch(value) is not None or value in ENGINE_TAGS)


def _ref(value: Any) -> bool:
    return isinstance(value, str) and (len(value) == 1 or _NAME.fullmatch(value) is not None or value in ENGINE_TAGS)


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


def _base(expr: Any) -> bool:
    return (
        isinstance(expr, dict)
        and ("param" in expr or "call" in expr or len(expr) == 1)
        and (
            "param" in expr or "call" in expr or "ref" in expr
            and _ref(expr["ref"])
            or "literal" in expr
            or "range" in expr
            or expr.get("wildcard") is True
        )
    )


def _target(expr: Any) -> bool:
    if _base(expr):
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
    if isinstance(base, dict) and "param" in base:
        return head if _target(head) else None
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
    for key in ('directives', 'constants', 'classifiers', 'implications'):
        if any('param' in node for item in dom[key] for node in nodes(item)):
            return 'an undeclared or malformed parameter'
    pending = []
    for d in dom["directives"]:
        if "conditions" in d:
            if d.get("name") != "features" or not isinstance(d["conditions"], list) or not d["conditions"]:
                return "malformed feature conditions"
            pending.extend(("condition", condition, 0, False, False) for condition in d["conditions"])
        name, args = d.get("name"), d.get("args")
        if name not in _DIRECTIVES or not isinstance(args, list) or any(not isinstance(x, str) for x in args):
            return "a malformed directive"
        if name in ("stage", "extend-stage", "redefine-stage"):
            valid = len(args) == 1 and CLASSIFIER_NAME.fullmatch(args[0]) is not None
        elif name in ("include", "names"):
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
    ordered = sorted(((item, key == "directives" and item.get("name") == "names") for key in ("rules", "directives", "constants", "classifiers", "implications") for item in dom[key]), key=lambda pair: pair[0]["at"])
    seen_statement = False
    for item, names in ordered:
        if names and seen_statement:
            return "%names must precede every other statement"
        seen_statement = seen_statement or not names
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
        params = r.get('params', [])
        if 'params' in r and (not isinstance(params, list) or not params or any(not isinstance(p, str) or re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]*', p) is None for p in params) or len(set(params)) != len(params) or 'args' in r):
            return 'malformed template parameters'
        for node in nodes(r):
            if 'param' in node and (not {'param', 'at'} <= set(node) or not set(node) <= {'param', 'at', 'exact', 'children'} or not _is_position(node['at']) or node['param'] not in params):
                return 'an undeclared or malformed parameter'
        if 'instance' in r:
            if set(r) != {'name', 'op', 'flags', 'instance', 'conditions', 'at'} or not isinstance(r['name'], str) or not (unicode.is_emoji_name(r['name']) or CLASSIFIER_NAME.fullmatch(r['name'])) or r['op'] not in ('define', 'redefine') or r['flags'] != [] or r['conditions'] != []:
                return 'a malformed instance binding'
            pending.append(('call', r['instance'], 0, False, False))
            continue
        if 'args' in r:
            if r['op'] not in ('extend', 'redefine'):
                return 'an instance head requires an edit'
            pending.append(('call', dict(call=r['name'], args=r['args'], at=r['at']), 0, False, False))
        if (
            not set(r) <= {"name", "params", "args", "op", "flags", "tags", "value", "image", "alternatives", "emit", "conditions", "erased", "at"}
            or not isinstance(r.get("name"), str)
            or not (unicode.is_emoji_name(r["name"]) or CLASSIFIER_NAME.fullmatch(r["name"]))
            or r.get("op") not in ("define", "redefine", "extend")
            or r.get("flags") not in ([], ["leftmost-longest"], ["fewest"])
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
    # Feature types depend on the surviving selected stage.
    deferred = set()
    feature_nodes = [condition for directive in dom["directives"] for condition in directive.get("conditions", [])]
    while feature_nodes:
        node = feature_nodes.pop()
        if isinstance(node, dict) and id(node) not in deferred:
            deferred.add(id(node))
            feature_nodes.extend(node.values())
        elif isinstance(node, list):
            feature_nodes.extend(node)
    problem = _walk(pending, unicode, deferred)
    if problem:
        return problem
    for r in dom["rules"]:
        if has_unresolved(r):
            continue
        for a in r["alternatives"]:
            if duplicate_captures(a["expr"]):
                return "a capture name used twice in one production"
        from ._boundary import problem as boundary_problem
        boundary = boundary_problem(r)
        problem = (boundary[0] if boundary else None) or definition_problem(r) or rule_type_problem(r)
        if problem and not (defer_emission and deferred_emission_problem(problem) and rule_has_ranked(r)):
            return problem
    for c in dom["constants"]:
        problem = constant_value_problem(c["value"], c["op"] == "redefine")
        if problem:
            return problem
    return None


def _walk(pending: list, unicode: Marks, deferred: set[int]) -> str | None:
    types = {}
    while pending:
        kind, node, depth, whole, sealed = pending.pop()
        if depth > MAX_DEPTH:
            return TOO_DEEP
        if not isinstance(node, dict):
            return f"a malformed {kind}"
        below = depth + 1
        keys = set(node)
        if kind == 'pattern-part':
            if 'call' in node:
                for part in nodes(node['args']):
                    if 'rule' in part and _tag(part['rule']):
                        return 'a pattern argument rule reads back as a tag'
                pending.extend(('arg', arg, below, False, False) for arg in node['args'])
            if 'literal' in node:
                pending.append(('string', node['literal'], depth, False, False))
            if 'range' in node:
                problem = range_problem(node['range'], unicode)
                if problem:
                    return problem
                pending.extend(('string', end, depth, False, False) for end in node['range'])
            if node.get('test') == 'tags':
                pending.extend(('term', r['value'], below, False, False) for r in node['requirements'])
            elif 'test' in node:
                pending.append(('string', node['value'], below, False, False))
            if 'expr' in node:
                pending.append(('pattern-part', node['expr'], below, False, False))
            if 'path' in node:
                pending.append(('pattern-part', node['pattern'], below, False, False))
            for key in ('union', 'intersection', 'difference'):
                pending.extend(('pattern-part', part, below, False, False) for part in node.get(key, []))
            pending.extend(('pattern-item', item, below, False, False) for item in node.get('children', []))
            continue
        if kind == 'pattern-item':
            if 'child' in node:
                pending.append(('pattern-part', node['child'], below, False, False))
            for key in ('optional', 'repeat', 'separator'):
                pending.extend(('pattern-item', item, below, False, False) for item in node.get(key, []))
            for arm in node.get('choice', []):
                pending.extend(('pattern-item', item, below, False, False) for item in arm)
            continue
        # Unresolved leaves still obey the category of their position.
        if 'param' in node:
            if kind not in ('expr', 'arg', 'term', 'tags', 'string', 'target'):
                return f'a malformed {kind}'
            if keys != {'param', 'at'} or not isinstance(node['param'], str) or re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]*', node['param']) is None or not _is_position(node['at']):
                return 'an undeclared or malformed parameter'
            continue
        if 'call' in node or kind == 'call':
            if kind not in ('expr', 'arg', 'term', 'tags', 'target', 'call'):
                return f'a malformed {kind}'
            if keys != {'call', 'args', 'at'} or not isinstance(node['call'], str) or not (CLASSIFIER_NAME.fullmatch(node['call']) or unicode.is_emoji_name(node['call'])) or not _is_position(node['at']) or not _items(node['args']):
                return 'a malformed call'
            pending.extend(('arg', arg, below, False, False) for arg in node['args'])
            continue
        if kind == 'arg':
            if any('capture' in n or 'captured' in n for n in nodes(node)) or keys & {'classifier', 'integer'}:
                return 'an argument cannot read or declare captures'
            if 'body' in node:
                if keys != {'body'}:
                    return 'a malformed body argument'
                pending.append(('expr', node['body'], depth, True, False))
            elif 'targets' in node:
                if keys != {'targets'} or not _items(node['targets'], 2):
                    return 'a malformed target choice'
                pending.extend(('target', v, depth, False, False) for v in node['targets'])
            elif 'requirements' in node and 'test' not in node:
                if keys != {'requirements'} or not isinstance(node['requirements'], list):
                    return 'a malformed requirement list'
                for entry in node['requirements']:
                    if not isinstance(entry, dict) or set(entry) != {'negated', 'value'} or type(entry['negated']) is not bool or not isinstance(entry['value'], dict) or not any(k in entry['value'] for k in ('tag', 'const', 'param')):
                        return 'a malformed requirement'
                    pending.append(('term', entry['value'], depth, False, False))
            elif 'rule' in node:
                if keys != {'rule'} or not isinstance(node['rule'], str) or not (CLASSIFIER_NAME.fullmatch(node['rule']) or unicode.is_emoji_name(node['rule'])):
                    return 'a malformed nominal rule argument'
            else:
                pending.append(('expr' if keys & {'test', 'range', 'wildcard'} else 'term', node, depth, False, False))
            continue
        if kind == 'target':
            if not (keys == {'rule'} and isinstance(node['rule'], str) and (CLASSIFIER_NAME.fullmatch(node['rule']) or unicode.is_emoji_name(node['rule'])) or keys == {'terminal'} and _tag(node['terminal']) and not node['terminal'].startswith('_')):
                return 'a malformed query target'
            continue
        dependent = has_unresolved(node)
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
                if keys != {"capture", "expr"} or sealed or not _capture(node["capture"], False) or not _target(node["expr"]):
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
                        if not isinstance(value, dict) or not (set(value) == {"tag"} or set(value) == {"const", "at"} or set(value) == {"param", "at"}):
                            return "a tag test requires tags or constants"
                        pending.append(("tags", value, below, False, False))
                else:
                    pending.append(("string", node["value"], below, False, False))
            # Literal and range wrappers add no compound ancestor.
            elif "range" in node:
                if keys != {"range"} or not _items(node["range"], 2, 2) or not dependent and range_problem(node["range"], unicode):
                    return "a malformed range"
                pending.extend(("string", x, depth, False, False) for x in node["range"])
            elif "literal" in node:
                if keys != {"literal"}:
                    return "a malformed literal"
                pending.append(("string", node["literal"], depth, False, False))
            elif not (
                keys == {"ref"}
                and isinstance(node["ref"], str)
                and (_NAME.fullmatch(node["ref"]) or node["ref"] in ENGINE_TAGS or unicode.is_emoji_name(node["ref"]))
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
                        atom["method"] in ("value", "image", "source-text", "decomposed-source-text", "verbatim-text")
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
                        return "a recipe requires one of its seven captured string methods"
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
                and node["method"] in ("matches", "begins", "starts-input", "ends-input", "followed-by", "preceded-by")
            ):
                return "a malformed condition"
            problem = None if id(node) in deferred or dependent else condition_type_problem(node, memo=types)
            if problem:
                return problem
            if "method" not in node:
                continue
        elif kind == "tags":
            problem = None if id(node) in deferred or dependent else tag_term_problem(node, memo=types)
            if problem:
                return problem
        if "method" in node:
            if keys != {"method", "receiver", "args"} or not isinstance(node["method"], str) or not isinstance(node["args"], list):
                return "a malformed method"
            recipe = kind == "recipe-method"
            if node['method'] not in _METHODS:
                return 'unknown method name'
            if node['method'] in ('classify', 'ngrams') and has_unresolved(node['args']):
                return 'a parameter cannot replace a classifier name or integer argument'
            problem = method_shape_problem(node["method"], node.get("receiver"), node["args"], recipe)
            if problem:
                return problem
            if kind != "condition" and node["method"] in ("matches", "begins", "starts-input", "ends-input", "followed-by", "preceded-by"):
                return "a predicate method cannot supply a value"
            if not recipe and (
                node["method"] in ("verbatim-text", "emitted")
                or isinstance(node["receiver"], dict)
                and node["receiver"].get("method") == "emitted"
            ):
                return "a recipe-only method outside a recipe"
            result, problem = ("any", None) if id(node) in deferred or dependent else term_type(node, memo=types)
            if problem:
                return problem
            if kind == "string":
                return "a string operand requires a literal or constant"
            if id(node) not in deferred and node["method"] == "split" and literal_string(node["args"][0]) == "":
                return "split has an empty delimiter"
            pending.append(("recipe-method" if recipe else "term", node["receiver"], below, False, False))
            for arg in node["args"]:
                if isinstance(arg, dict) and set(arg) in ({"rule"}, {"classifier"}, {"terminal"}, {"integer"}):
                    key = next(iter(arg))
                    if key == "integer":
                        if node["method"] != "ngrams" or not isinstance(arg[key], str) or re.fullmatch(r"[1-9][0-9]*", arg[key]) is None:
                            return "a malformed integer argument"
                        continue
                    if not isinstance(arg[key], str) or not (key == "rule" and unicode.is_emoji_name(arg[key]) or key == "terminal" and USER_NAME.fullmatch(arg[key]) and arg[key][:1].isupper() and node["method"] in ("matches", "begins", "followed-by", "preceded-by") or key != "terminal" and CLASSIFIER_NAME.fullmatch(arg[key])):
                        return "a malformed method name argument"
                else:
                    pending.append(("term", arg, below, False, False))
        elif "concat" in node:
            if kind == "string":
                return "a string operand requires a literal or constant"
            if keys != {"concat"} or not _items(node["concat"], 2):
                return "a malformed concatenation"
            pending.extend(("term", x, below, False, False) for x in node["concat"])
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
            problem = layered_pattern_problem(node['pattern'], depth=below,
                name=lambda name: (CLASSIFIER_NAME.fullmatch(name) is not None or unicode.is_emoji_name(name)) and not _tag(name),
                terminal=_tag)
            if problem:
                return problem
            pending.append(('pattern-part', node['pattern'], below, False, False))
        elif any(k in node for k in ("union", "intersection", "difference")):
            key = next(k for k in ("union", "intersection", "difference") if k in node)
            if keys != {key} or not _items(node[key], 2, 2 if key == "difference" else float("inf")):
                return "a malformed set expression"
            problem = None if id(node) in deferred else term_type(node, memo=types)[1]
            if problem:
                return problem
            pending.extend(("term", x, below, False, False) for x in node[key])
        elif "if" in node:
            if keys != {"if", "then"}:
                return "a malformed guarded term"
            pending.append(("condition", node["if"], below, False, False))
            pending.append(("term", node["then"], below, False, False))
        elif not (keys == {"emptySet"} and node["emptySet"] is True):
            return "a malformed term"
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
