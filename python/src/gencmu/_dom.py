"""From the notation's document tree to a grammar DOM (engine §9)."""

from __future__ import annotations

from typing import Any

from ._errors import GencmuError
from ._markdown import GrammarText
from ._model import Node, Token

Dom = dict[str, Any]

_MAPPED = frozenset(
    """rule rule-tags alternative alternative-tags directive-statement choice conjunction sequence element
    reference string phoneme capture group optional hash empty emission emit-item emit-tags conditions
    condition-item comparison negation call term intersection weak empty-set set capture-reference""".split()
)
_SPAN_FUNCTIONS = frozenset(["head", "tail", "last"])
_ONE_SPAN = frozenset(["phonemes", "text", "classes", "words", "head", "tail", "last"])


def decode_string(text: str) -> str | None:
    """A string token's value: quotes removed, escapes decoded; ``None`` for
    an escape the notation does not have."""
    body = text[1:-1]
    out: list[str] = []
    index = 0
    while index < len(body):
        char = body[index]
        if char != "\\":
            out.append(char)
            index += 1
            continue
        following = body[index + 1 : index + 2]
        if following in ("\\", '"'):
            out.append(following)
            index += 2
            continue
        if following == "u" and body[index + 2 : index + 3] == "{":
            close = body.find("}", index + 3)
            digits = body[index + 3 : close] if close >= 0 else ""
            if digits and all(c in "0123456789abcdefABCDEF" for c in digits):
                value = int(digits, 16)
                if value <= 0x10FFFF:
                    out.append(chr(value))
                    index = close + 1
                    continue
        return None
    return "".join(out)


def _is_span(dom: Any) -> bool:
    return isinstance(dom, dict) and ("capture" in dom and "expr" not in dom or dom.get("call") in _SPAN_FUNCTIONS)


class DomBuilder:
    """Reads the DOM off a document tree, rule by rule of the §9 table."""

    def __init__(self, tokens: list[Token], grammar_text: GrammarText, document: str) -> None:
        self.tokens = tokens
        self.grammar_text = grammar_text
        self.document = document

    # -- positions and errors

    def first_token(self, node: Node) -> int | None:
        while node.kind == "rule":
            if not node.children:
                return None
            node = node.children[0]
        return node.token

    def position(self, node: Node) -> tuple[int, int]:
        index = self.first_token(node)
        if index is None:
            return self.grammar_text.position(len(self.grammar_text.text))
        return self.grammar_text.position(self.tokens[index].source[0])

    def fail(self, node: Node, message: str) -> GencmuError:
        line, column = self.position(node)
        return GencmuError(message, document=self.document, line=line, column=column)

    def text(self, node: Node) -> str:
        assert node.kind == "token" and node.token is not None
        return self.tokens[node.token].text

    def kids(self, node: Node) -> list[Node]:
        """A node's children, reading every unmapped rule in its place."""
        result: list[Node] = []
        stack = list(reversed(node.children))
        while stack:
            child = stack.pop()
            if child.kind == "rule" and child.rule not in _MAPPED:
                stack.extend(reversed(child.children))
            elif child.kind != "elided":
                result.append(child)
        return result

    def rules(self, node: Node, name: str) -> list[Node]:
        return [kid for kid in self.kids(node) if kid.kind == "rule" and kid.rule == name]

    # -- the document

    def document_dom(self, root: Node) -> Dom:
        rules: list[Dom] = []
        directives: list[Dom] = []
        for kid in self.kids(root):
            if kid.kind == "rule" and kid.rule == "rule":
                rules.append(self.rule(kid))
            elif kid.kind == "rule" and kid.rule == "directive-statement":
                directives.append(self.directive(kid))
        return {"format": 1, "rules": rules, "directives": directives}

    def directive(self, node: Node) -> Dom:
        kids = self.kids(node)
        name = self.text(kids[0])[1:]
        args = [self.text(kid) for kid in kids[1:] if kid.kind == "token" and self.text(kid) != ";"]
        return {"name": name, "args": args, "at": list(self.position(node))}

    def rule(self, node: Node) -> Dom:
        kids = self.kids(node)
        name = self.text(kids[0])
        op = "define"
        tags: Dom | None = None
        alternatives: list[Dom] = []
        emit: Dom | None = None
        conditions: list[Dom] = []
        for kid in kids[1:]:
            if kid.kind == "token":
                if self.text(kid) == "|≔":
                    op = "extend"
                continue
            if kid.rule == "rule-tags":
                tags = self.value(self.rules(kid, "term")[0])
            elif kid.rule == "alternative":
                alternatives.append(self.alternative(kid))
            elif kid.rule == "emission":
                if emit is not None:
                    raise self.fail(kid, "a rule has at most one ⇒ clause")
                emit = self.emission(kid)
            elif kid.rule == "conditions":
                conditions.extend(self.condition_item(item) for item in self.rules(kid, "condition-item"))
        dom: Dom = {"name": name, "op": op}
        if tags is not None:
            dom["tags"] = tags
        dom["alternatives"] = alternatives
        if emit is not None:
            dom["emit"] = emit
        dom["conditions"] = conditions
        dom["at"] = list(self.position(node))
        return dom

    # -- expressions

    def alternative(self, node: Node) -> Dom:
        guards: list[Dom] = []
        expr: Dom | None = None
        tags: Dom | None = None
        self.captures: set[str] = set()
        for kid in self.kids(node):
            if kid.kind == "token":
                text = self.text(kid)
                negated = text.startswith("@!")
                guards.append({"feature": text[2:] if negated else text[1:], "negated": negated})
            elif kid.rule == "conjunction":
                expr = self.expr(kid, True)
            elif kid.rule == "alternative-tags":
                tags = self.value(self.rules(kid, "term")[0])
        assert expr is not None
        dom: Dom = {"guards": guards, "expr": expr}
        if tags is not None:
            dom["tags"] = tags
        return dom

    def expr(self, node: Node, top: bool = False) -> Dom:
        rule = node.rule
        if rule in ("choice", "conjunction", "sequence"):
            part = {"choice": "conjunction", "conjunction": "sequence", "sequence": "element"}[rule]
            parts = self.rules(node, part)
            if len(parts) == 1:
                return self.expr(parts[0], top and rule != "choice")
            key = {"choice": "choice", "conjunction": "and", "sequence": "seq"}[rule]
            return {key: [self.expr(p, top and rule == "sequence") for p in parts]}
        if rule == "element":
            kids = self.kids(node)
            primary = kids[0]
            repeated = any(kid.kind == "token" and self.text(kid) == "..." for kid in kids[1:])
            if not repeated:
                return self.expr(primary, top)
            if primary.kind == "rule" and primary.rule == "optional":
                return {"repeat": self.expr(self.rules(primary, "choice")[0]), "min": 0}
            return {"repeat": self.expr(primary), "min": 1}
        if rule == "reference":
            return {"ref": self.text(self.kids(node)[0])}
        if rule == "string":
            return {"terminal": self.decode(self.kids(node)[0])}
        if rule == "phoneme":
            return {"terminal": self.text(self.kids(node)[0])}
        if rule == "capture":
            kids = self.kids(node)
            name = self.text(kids[0])[1:]
            inner = [kid for kid in kids[1:] if kid.kind == "rule"]
            if len(inner) != 1 or inner[0].rule not in ("reference", "string", "phoneme"):
                raise self.fail(node, f"the capture ${name} must wrap one name, string or phoneme")
            if not top:
                raise self.fail(node, f"the capture ${name} is not at the top level of its alternative")
            if name in self.captures:
                raise self.fail(node, f"the capture ${name} appears twice in one alternative")
            self.captures.add(name)
            if len(self.captures) > 4:
                raise self.fail(node, "an alternative has at most four captures")
            return {"capture": name, "expr": self.expr(inner[0])}
        if rule == "group":
            return self.expr(self.rules(node, "choice")[0])
        if rule == "optional":
            return {"optional": self.expr(self.rules(node, "choice")[0])}
        if rule == "hash":
            return {"hash": True}
        if rule == "empty":
            return {"empty": True}
        raise self.fail(node, f"unexpected {rule} in an expression")

    def decode(self, token: Node) -> str:
        value = decode_string(self.text(token))
        if value is None:
            raise self.fail(token, "a string has an escape other than \\\\, \\\" and \\u{…}")
        return value

    # -- emission

    def emission(self, node: Node) -> Dom:
        items: list[Dom] = []
        kinds: list[str] = []
        for item in self.rules(node, "emit-item"):
            kids = self.kids(item)
            target = kids[0]
            tag_nodes = [kid for kid in kids[1:] if kid.kind == "rule" and kid.rule == "emit-tags"]
            tags = self.value(self.rules(tag_nodes[0], "term")[0]) if tag_nodes else None
            text = self.text(target)
            tags_of_target = self.tokens[target.token].tags if target.token is not None else {}
            if "identifier" in tags_of_target:
                if text == "this":
                    kinds.append("this")
                    items.append({"this": True} if tags is None else {"this": True, "tags": tags})
                elif text == "nothing":
                    if tags is not None:
                        raise self.fail(target, "nothing takes no tags")
                    kinds.append("nothing")
                    items.append({"nothing": True})
                else:
                    raise self.fail(target, f"⇒ lists {text}, which is neither this, nothing, a capture nor a tag")
            elif "capture" in tags_of_target:
                kinds.append("capture")
                items.append({"capture": text[1:]} if tags is None else {"capture": text[1:], "tags": tags})
            else:
                if tags is not None:
                    raise self.fail(target, "an inserted tag takes no tags of its own")
                kinds.append("insert")
                value = self.decode(target) if "string" in tags_of_target else text
                items.append({"insert": value})
        if "nothing" in kinds:
            if len(kinds) > 1:
                raise self.fail(node, "nothing is used with other items")
            return {"nothing": True}
        if "this" in kinds and any(kind != "this" for kind in kinds):
            raise self.fail(node, "this is used with items other than this")
        return {"items": items}

    # -- conditions

    def condition_item(self, node: Node) -> Dom:
        parts = [self.condition(kid) for kid in self.kids(node) if kid.kind == "rule"]
        return parts[0] if len(parts) == 1 else {"any": parts}

    def condition(self, node: Node) -> Dom:
        if node.rule == "comparison":
            kids = self.kids(node)
            terms = [kid for kid in kids if kid.kind == "rule"]
            op = next(self.text(kid) for kid in kids if kid.kind == "token")
            return {"op": op, "left": self.value(terms[0]), "right": self.value(terms[1])}
        if node.rule == "negation":
            inner = [kid for kid in self.kids(node) if kid.kind == "rule"]
            return {"not": self.condition(inner[0])}
        if node.rule == "call":
            name, args = self.call_parts(node)
            if name != "matches":
                raise self.fail(node, f"a condition calls matches(), not {name}()")
            if len(args) != 2 or args[1].kind != "token":
                raise self.fail(node, "matches() takes a span and a rule name")
            return {"matches": self.span(args[0]), "rule": self.text(args[1])}
        raise self.fail(node, f"unexpected {node.rule} in a condition")

    # -- terms

    def call_parts(self, node: Node) -> tuple[str, list[Node]]:
        kids = self.kids(node)
        name = self.text(kids[0])
        args = [kid for kid in kids[1:] if kid.kind == "rule" or self.tokens[kid.token].tags.get("identifier")]  # type: ignore[index]
        return name, args

    def span(self, node: Node) -> Dom:
        if node.kind == "token":
            raise self.fail(node, "a span is needed here, not a name")
        dom = self.term(node)
        if not _is_span(dom):
            raise self.fail(node, "a span is needed here: a capture, or head(), tail() or last() of one")
        return dom

    def value(self, node: Node) -> Dom:
        dom = self.term(node)
        if _is_span(dom):
            raise self.fail(node, "a span is used where a string or tag set is needed")
        return dom

    def term(self, node: Node) -> Dom:
        rule = node.rule
        if rule in ("term", "intersection"):
            part_names = ("intersection",) if rule == "term" else None
            parts = [
                kid
                for kid in self.kids(node)
                if kid.kind == "rule" and (part_names is None or kid.rule in part_names)
            ]
            if len(parts) == 1:
                return self.term(parts[0])
            key = "union" if rule == "term" else "intersection"
            return {key: [self.value(part) for part in parts]}
        if rule == "string":
            return {"literal": self.decode(self.kids(node)[0])}
        if rule == "phoneme":
            return {"literal": self.text(self.kids(node)[0])}
        if rule == "weak":
            token = [kid for kid in self.kids(node) if kid.kind == "token" and "string" in self.tokens[kid.token].tags]  # type: ignore[index]
            return {"weak": self.decode(token[0])}
        if rule == "empty-set":
            return {"emptySet": True}
        if rule == "set":
            return {"set": [self.value(kid) for kid in self.kids(node) if kid.kind == "rule"]}
        if rule == "capture-reference":
            return {"capture": self.text(self.kids(node)[0])[1:]}
        if rule == "call":
            name, args = self.call_parts(node)
            if name in _ONE_SPAN:
                if len(args) != 1:
                    raise self.fail(node, f"{name}() takes one span")
                return {"call": name, "args": [self.span(args[0])]}
            if name == "tags":
                if len(args) not in (1, 2):
                    raise self.fail(node, "tags() takes a span and optionally a rule name")
                converted: list[Dom] = [self.span(args[0])]
                if len(args) == 2:
                    if args[1].kind != "token":
                        raise self.fail(args[1], "the second argument of tags() is a rule name")
                    converted.append({"rule": self.text(args[1])})
                return {"call": name, "args": converted}
            if name == "lowercase":
                if len(args) != 1 or args[0].kind == "token":
                    raise self.fail(node, "lowercase() takes a string")
                return {"call": name, "args": [self.value(args[0])]}
            if name == "matches":
                raise self.fail(node, "matches() is a condition, not a term")
            raise self.fail(node, f"an unknown function {name}()")
        raise self.fail(node, f"unexpected {rule} in a term")
