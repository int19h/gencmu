"""The layered pattern constructors and their canonical spelling."""

from __future__ import annotations

import re



_IDENTIFIER = re.compile(r"(?!.*--)[A-Za-z][A-Za-z0-9_-]*\Z", re.ASCII)
_CONSTANT = re.compile(r"(?!.*--)[A-Z][A-Za-z0-9_-]*\Z", re.ASCII)
_RULE = re.compile(r"(?!.*--)[a-z][A-Za-z0-9_-]*\Z", re.ASCII)
_SETS = ("union", "intersection", "difference")


MAX_POSITION = 9007199254740991


def _position(value):
    return isinstance(value, list) and len(value) == 2 and all(type(x) is int and 1 <= x <= MAX_POSITION for x in value)


def _string_term(node):
    if not isinstance(node, dict):
        return False
    if set(node) == {"string"}:
        return isinstance(node["string"], str) and all(not 0xD800 <= ord(c) <= 0xDFFF for c in node["string"])
    for key, syntax in (("const", _CONSTANT), ("param", _IDENTIFIER)):
        if set(node) == {key, "at"}:
            return _position(node["at"]) and isinstance(node[key], str) and syntax.fullmatch(node[key]) is not None
    return False


def layered_pattern_problem(root, *, name=None, terminal=None, test=None, depth=0, defer_depth=False, defer_groups=False):
    def rule_name(value):
        return isinstance(value, str) and (name(value) if name else bool(_RULE.fullmatch(value)) or len(value) == 1 and ord(value) > 127)

    def terminal_name(value):
        return isinstance(value, str) and (terminal(value) if terminal else bool(_CONSTANT.fullmatch(value)) or value.startswith("_"))

    def requirement_term(node):
        return (_string_term(node) and "string" not in node
                or isinstance(node, dict) and set(node) == {"tag"} and terminal_name(node["tag"]))

    def terminal_atom(node):
        return (isinstance(node, dict) and any(k in node for k in ("terminal", "literal", "range", "wildcard", "constant", "param"))
                and "exact" not in node and "children" not in node)

    pending = [(root, False, False, depth, False)]
    while pending:
        node, item, repeated, level, inner = pending.pop()
        if not defer_depth and level > 256:
            return "nested too deeply"
        if not isinstance(node, dict):
            return "a malformed pattern"
        keys = set(node)

        def push(child, is_item=False, in_repeat=repeated, is_inner=False):
            pending.append((child, is_item, in_repeat, level + 1, is_inner))

        def items(array, in_repeat=repeated, empty=False):
            if not isinstance(array, list) or not empty and not array:
                return False
            for child in array:
                push(child, True, in_repeat)
            return True

        if item:
            if defer_groups and keys == {"sequence"}:
                if not items(node["sequence"]):
                    return "a malformed pattern sequence"
            elif keys == {"child"}:
                push(node["child"], False, False)
            elif keys == {"siblings"}:
                if node["siblings"] is not True:
                    return "a malformed sibling ellipsis"
                if repeated:
                    return "a sibling ellipsis cannot be a repeat item or separator"
            elif keys == {"optional"}:
                if not items(node["optional"]):
                    return "a malformed pattern optional"
            elif keys in ({"repeat"}, {"repeat", "separator"}):
                if not items(node["repeat"], True) or "separator" in node and not items(node["separator"], True):
                    return "a malformed pattern repeat"
            elif keys == {"choice"}:
                if not isinstance(node["choice"], list) or len(node["choice"]) < 2:
                    return "a malformed pattern choice"
                for arm in node["choice"]:
                    if not items(arm) or not defer_groups and len(arm) == 1 and isinstance(arm[0], dict) and "choice" in arm[0]:
                        return "a malformed pattern choice"
            else:
                return "a malformed pattern child item"
            continue
        if "never" in node:
            if not (keys == {"never"} or keys == {"never", "at"} and _position(node["at"])) or node["never"] is not True or inner:
                return "a malformed empty pattern"
            continue
        compound = next((key for key in _SETS if key in node), None)
        if compound:
            operands = node[compound]
            if keys != {compound} or not isinstance(operands, list) or len(operands) < 2 or compound == "difference" and len(operands) != 2:
                return "a malformed pattern"
            if not defer_groups and compound != "difference" and any(isinstance(x, dict) and compound in x for x in operands):
                return "a nested pattern set must be flat"
            for child in operands:
                push(child, False, False)
            continue
        if "path" in node:
            if keys != {"path", "pattern"} or node["path"] not in ("descendant", "first", "last"):
                return "a malformed pattern path"
            push(node["pattern"], False, False)
            continue
        forms = [k for k in ("name", "call", "param", "terminal", "literal", "range", "wildcard", "constant", "test", "any") if k in node]
        if len(forms) != 1:
            return "a malformed pattern node test"
        key = forms[0]
        if "exact" in node and (node["exact"] is not True or inner):
            return "a malformed exact pattern prefix"
        if "children" in node and (inner or key not in ("name", "call", "param", "any")):
            return "a child list requires a rule test"
        fields = {key} | (keys & {"exact", "children"})
        if key == "test":
            if node["test"] == "tags":
                fields |= {"requirements", "expr"}
                expr = node.get("expr")
                rule_atom = isinstance(expr, dict) and any(k in expr for k in ("name", "call")) and not {"exact", "children"} & expr.keys()
                if not (terminal_atom(expr) or rule_atom) or not isinstance(node.get("requirements"), list):
                    return "a pattern tag test requires a node atom"
                for requirement in node["requirements"]:
                    if not isinstance(requirement, dict) or set(requirement) != {"negated", "value"} or type(requirement["negated"]) is not bool or not requirement_term(requirement["value"]):
                        return "a malformed pattern requirement"
            else:
                fields |= {"value", "expr"}
                expr = node.get("expr")
                if node["test"] not in ("=", "≠") or not (terminal_atom(expr) or isinstance(expr, dict) and ("name" in expr or "call" in expr) or isinstance(expr, dict) and expr.get("test") == "tags" and "exact" not in expr and "children" not in expr and (terminal_atom(expr.get("expr")) or isinstance(expr.get("expr"), dict) and ("name" in expr["expr"] or "call" in expr["expr"]))):
                    return "a pattern value test requires a node atom"
                if not _string_term(node.get("value")):
                    return "a malformed pattern value test"
            problem = test(node) if test else None
            if problem:
                return problem
            if "expr" in node:
                push(node["expr"], False, False, True)
        elif key == "any":
            if node["any"] is not True or "children" not in node:
                return "a malformed bare child list"
        else:
            fields.add("at")
            if not _position(node.get("at")):
                return "a malformed pattern position"
            if key == "call":
                fields.add("args")
                if not rule_name(node["call"]) or not isinstance(node.get("args"), list) or not node["args"] or any(not isinstance(x, dict) for x in node["args"]):
                    return "a malformed pattern call"
            elif key == "name":
                if not rule_name(node["name"]):
                    return "a malformed pattern rule name"
            elif key in ("param", "constant"):
                if not isinstance(node[key], str) or not (_IDENTIFIER if key == "param" else _CONSTANT).fullmatch(node[key]):
                    return "a malformed pattern reference"
            elif key == "terminal":
                if node[key] == "_Elided":
                    return "_Elided stands only in a pattern tag test"
                if not terminal_name(node[key]):
                    return "a malformed pattern terminal"
            elif key == "wildcard":
                if node[key] is not True:
                    return "a malformed pattern wildcard"
            elif key == "literal":
                if not _string_term(node[key]) or "string" not in node[key]:
                    return "a malformed pattern literal"
            elif key == "range":
                if not isinstance(node[key], list) or len(node[key]) != 2 or any(not _string_term(x) for x in node[key]):
                    return "a malformed pattern range"
        if keys != fields:
            return "a malformed pattern node test"
        if "children" in node and not items(node["children"], False, True):
            return "a malformed pattern child list"
    return None


def _print_layered(root, term, literal=True):
    """Yield ordinary term printers through the common trampoline."""
    def atom(node):
        return not any(key in node for key in (*_SETS, "path"))

    def is_set(node):
        return any(key in node for key in _SETS)

    out = []
    pending = [("pattern", root)]
    if literal:
        out.append("#" if atom(root) else "#(")
        if not atom(root):
            pending.insert(0, ("text", ")"))
    while pending:
        kind, value = pending.pop()
        tasks = []
        if kind == "text":
            out.append(value)
        elif kind == "term":
            out.append((yield term(value)))
        elif kind == "items":
            for i, item in enumerate(value):
                if i:
                    tasks.append(("text", " "))
                group = len(value) > 1 and ("choice" in item or "child" in item and is_set(item["child"]))
                if group:
                    tasks.append(("text", "("))
                tasks.append(("item", item))
                if group:
                    tasks.append(("text", ")"))
        elif kind == "item":
            if "child" in value:
                tasks.append(("pattern", value["child"]))
            elif "siblings" in value:
                out.append("⋯")
            elif "optional" in value:
                tasks = [("text", "["), ("items", value["optional"]), ("text", "]")]
            elif "repeat" in value:
                tasks = [("text", "{"), ("items", value["repeat"])]
                if "separator" in value:
                    tasks += [("text", " / "), ("items", value["separator"])]
                tasks.append(("text", "}"))
            else:
                for i, arm in enumerate(value["choice"]):
                    if i:
                        tasks.append(("text", " | "))
                    tasks.append(("items", arm))
        elif "path" in value:
            if value["path"] != "first":
                tasks.append(("text", "⋱ " if value["path"] == "last" else "⋮ "))
            group = not atom(value["pattern"])
            if group:
                tasks.append(("text", "("))
            tasks.append(("pattern", value["pattern"]))
            if group:
                tasks.append(("text", ")"))
            if value["path"] == "first":
                tasks.append(("text", " ⋰"))
        elif value.get("never"):
            out.append("∅")
        elif is_set(value):
            key = next(key for key in _SETS if key in value)
            for i, child in enumerate(value[key]):
                if i:
                    tasks.append(("text", {"union": " ∪ ", "intersection": " ∩ ", "difference": " ∖ "}[key]))
                group = (key == "intersection" and ("union" in child or "difference" in child)
                         or key == "difference" and i == 1 and ("union" in child or "difference" in child)
                         or key == "union" and i > 0 and "difference" in child)
                if group:
                    tasks.append(("text", "("))
                tasks.append(("pattern", child))
                if group:
                    tasks.append(("text", ")"))
        else:
            if value.get("exact"):
                tasks.append(("text", "·"))
            if "test" in value:
                if "expr" in value:
                    tasks.append(("pattern", value["expr"]))
                if value["test"] == "tags":
                    tasks.append(("term", {"requirements": value["requirements"]}))
                else:
                    tasks += [("text", value["test"]), ("term", value["value"])]
            elif "literal" in value:
                tasks.append(("term", value["literal"]))
            elif "range" in value:
                tasks += [("term", value["range"][0]), ("text", ".."), ("term", value["range"][1])]
            elif "wildcard" in value:
                tasks.append(("text", "_"))
            elif "constant" in value:
                tasks.append(("text", "$" + value["constant"]))
            elif "any" not in value:
                tasks.append(("term", value))
            if "children" in value:
                tasks += [("text", "⁅ "), ("items", value["children"]), ("text", " ⁆")] if value["children"] else [("text", "⁅⁆")]
        pending.extend(reversed(tasks))
    return "".join(out)
