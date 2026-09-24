"""From the notation's document tree to a grammar DOM (engine §9)."""

from __future__ import annotations

from typing import Any

from ._errors import GencmuError
from ._markdown import GrammarText
from ._model import Node, Token
from ._trampoline import Walk, run
from ._validate import FORMAT, term_reads_own_tags

Dom = dict[str, Any]

_MAPPED = frozenset(
    """rule rule-tags alternative alternative-tags directive-statement choice conjunction sequence element
    reference string phoneme capture group optional empty emission emit-item emit-tags erase conditions
    any-of all-of comparison negation call term intersection weak empty-set capture-reference""".split()
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
        return {"format": FORMAT, "rules": rules, "directives": directives}

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
                tags = self.own_tags(kid)
            elif kid.rule == "alternative":
                alternatives.append(self.alternative(kid))
            elif kid.rule == "emission":
                if emit is not None:
                    raise self.fail(kid, "a rule has at most one ⇒ clause")
                emit = self.emission(kid)
            elif kid.rule == "conditions":
                conditions.extend(self.conditions(self.rules(kid, "any-of")[0]))
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
                negated = text.startswith("@¬")
                guards.append({"feature": text[2:] if negated else text[1:], "negated": negated})
            elif kid.rule == "conjunction":
                expr = run(self._expr(kid, True))
            elif kid.rule == "alternative-tags":
                tags = self.own_tags(kid)
        assert expr is not None
        dom: Dom = {"guards": guards, "expr": expr}
        if tags is not None:
            dom["tags"] = tags
        return dom

    def own_tags(self, node: Node) -> Dom:
        """A rule's or an alternative's tag term, which may not read the tags
        it defines (engine §9)."""
        tags = self.value(self.rules(node, "term")[0])
        if term_reads_own_tags(tags):
            raise self.fail(node, "a constituent's tags cannot be made of its own: $, tags($) or classes($)")
        return tags

    def _expr(self, node: Node, top: bool = False) -> Walk:
        rule = node.rule
        if rule in ("choice", "conjunction", "sequence"):
            part = {"choice": "conjunction", "conjunction": "sequence", "sequence": "element"}[rule]
            parts = self.rules(node, part)
            if rule == "conjunction" and len(parts) > 16:
                raise self.fail(node, "& joins at most 16 items, since it expands to 2ⁿ−1 sequences")
            if len(parts) == 1:
                return (yield self._expr(parts[0], top and rule != "choice"))
            key = {"choice": "choice", "conjunction": "and", "sequence": "seq"}[rule]
            items: list[Dom] = []
            for p in parts:
                items.append((yield self._expr(p, top and rule == "sequence")))
            return {key: items}
        if rule == "element":
            kids = self.kids(node)
            primary = kids[0]
            repeated = any(kid.kind == "token" and self.text(kid) == "..." for kid in kids[1:])
            if not repeated:
                return (yield self._expr(primary, top))
            if primary.kind == "rule" and primary.rule == "optional":
                return {"repeat": (yield self._expr(self.rules(primary, "choice")[0])), "min": 0}
            return {"repeat": (yield self._expr(primary)), "min": 1}
        if rule == "reference":
            return {"ref": self.text(self.kids(node)[0])}
        if rule == "string":
            return {"terminal": self.decode(self.kids(node)[0])}
        if rule == "phoneme":
            return {"terminal": self.text(self.kids(node)[0])}
        if rule == "capture":
            kids = self.kids(node)
            name = self.text(kids[0])[1:]
            if not name:
                raise self.fail(node, "$ is the whole constituent and wraps nothing")
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
            return {"capture": name, "expr": (yield self._expr(inner[0]))}
        if rule == "group":
            return (yield self._expr(self.rules(node, "choice")[0]))
        if rule == "optional":
            return {"optional": (yield self._expr(self.rules(node, "choice")[0]))}
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
        for item in self.rules(node, "emit-item"):
            kids = self.kids(item)
            target = kids[0]
            tag_nodes = [kid for kid in kids[1:] if kid.kind == "rule" and kid.rule == "emit-tags"]
            erase = bool(tag_nodes) and bool(self.rules(tag_nodes[0], "erase"))
            tags = self.value(self.rules(tag_nodes[0], "term")[0]) if tag_nodes and not erase else None
            text = self.text(target)
            tags_of_target = self.tokens[target.token].tags if target.token is not None else {}
            if "capture" in tags_of_target:
                name = text[1:]
                if name and any(item.get("capture") == name for item in items):
                    raise self.fail(node, f"⇒ lists ${name} twice")
                if tags is not None and tags.get("emptySet") is True:
                    raise self.fail(target, "an emitted token's tags cannot be ∅, which no terminal reads; <> erases")
                entry: Dom = {"capture": name}
                if erase:
                    entry["erase"] = True
                elif tags is not None:
                    entry["tags"] = tags
                items.append(entry)
            else:
                if tag_nodes:
                    raise self.fail(target, "an inserted tag takes no tags of its own, nor <>")
                value = self.decode(target) if "string" in tags_of_target else text
                items.append({"insert": value})
        whole = [item for item in items if item.get("capture") == ""]
        if whole and len(whole) != len(items):
            raise self.fail(node, "$ is used with items other than $")
        if any(item.get("erase") for item in whole) and len(items) > 1:
            raise self.fail(node, "$ <> erases the whole constituent and stands alone")
        return {"items": items}

    # -- conditions

    def conditions(self, node: Node) -> list[Dom]:
        """The conditions a ``:`` clause adds to its rule: read as one
        condition, each of its conditions on its own if it is an ``all``,
        else itself (engine §9). Parentheses make no node, so ``: (a ∧ b)``
        is two conditions, as ``: a ∧ b`` is."""
        top: Dom = run(self._condition(node))
        return list(top["all"]) if "all" in top else [top]

    def _condition(self, node: Node) -> Walk:
        if node.rule in ("any-of", "all-of"):
            parts: list[Dom] = []
            for kid in self.kids(node):
                if kid.kind == "rule":
                    parts.append((yield self._condition(kid)))
            key = "any" if node.rule == "any-of" else "all"
            return parts[0] if len(parts) == 1 else {key: parts}
        return (yield self._simple_condition(node))

    def _simple_condition(self, node: Node) -> Walk:
        if node.rule == "comparison":
            kids = self.kids(node)
            terms = [kid for kid in kids if kid.kind == "rule"]
            op = next(self.text(kid) for kid in kids if kid.kind == "token")
            left = yield self._value(terms[0])
            right = yield self._value(terms[1])
            return {"op": op, "left": left, "right": right}
        if node.rule == "negation":
            inner = [kid for kid in self.kids(node) if kid.kind == "rule"]
            return {"not": (yield self._condition(inner[0]))}
        if node.rule == "call":
            name, args = self.call_parts(node)
            if name != "matches":
                raise self.fail(node, f"a condition calls matches(), not {name}()")
            if len(args) != 2 or args[1].kind != "token":
                raise self.fail(node, "matches() takes a span and a rule name")
            return {"matches": (yield self._span(args[0], node)), "rule": self.text(args[1])}
        raise self.fail(node, f"unexpected {node.rule} in a condition")

    # -- terms

    def call_parts(self, node: Node) -> tuple[str, list[Node]]:
        kids = self.kids(node)
        name = self.text(kids[0])
        args = [kid for kid in kids[1:] if kid.kind == "rule" or self.tokens[kid.token].tags.get("identifier")]  # type: ignore[index]
        return name, args

    def value(self, node: Node) -> Dom:
        return run(self._value(node))  # type: ignore[no-any-return]

    def _span(self, node: Node, at: Node | None = None) -> Walk:
        """A span argument; a wrong one is an error of the call ``at``."""
        if node.kind == "token":
            raise self.fail(at or node, "a span is needed here, not a name")
        dom = yield self._term(node)
        if not _is_span(dom):
            raise self.fail(at or node, "a span is needed here: a capture, or head(), tail() or last() of one")
        return dom

    def _value(self, node: Node) -> Walk:
        dom = yield self._term(node)
        if isinstance(dom, dict) and dom.get("call") in _SPAN_FUNCTIONS:
            raise self.fail(node, f"{dom['call']}() is a span, used where a string or tag set is needed")
        return dom

    def _term(self, node: Node) -> Walk:
        rule = node.rule
        if rule in ("term", "intersection"):
            part_names = ("intersection",) if rule == "term" else None
            parts = [
                kid
                for kid in self.kids(node)
                if kid.kind == "rule" and (part_names is None or kid.rule in part_names)
            ]
            if len(parts) == 1:
                return (yield self._term(parts[0]))
            key = "union" if rule == "term" else "intersection"
            values: list[Dom] = []
            for part in parts:
                values.append((yield self._value(part)))
            return {key: values}
        if rule == "string":
            return {"literal": self.decode(self.kids(node)[0])}
        if rule == "phoneme":
            return {"literal": self.text(self.kids(node)[0])}
        if rule == "weak":
            token = [kid for kid in self.kids(node) if kid.kind == "token" and "string" in self.tokens[kid.token].tags]  # type: ignore[index]
            return {"weak": self.decode(token[0])}
        if rule == "empty-set":
            return {"emptySet": True}
        if rule == "capture-reference":
            return {"capture": self.text(self.kids(node)[0])[1:]}
        if rule == "call":
            name, args = self.call_parts(node)
            if name in _ONE_SPAN:
                if len(args) != 1:
                    raise self.fail(node, f"{name}() takes one span")
                return {"call": name, "args": [(yield self._span(args[0], node))]}
            if name == "tags":
                if len(args) not in (1, 2):
                    raise self.fail(node, "tags() takes a span and optionally a rule name")
                converted: list[Dom] = [(yield self._span(args[0], node))]
                if len(args) == 2:
                    if args[1].kind != "token":
                        raise self.fail(args[1], "the second argument of tags() is a rule name")
                    converted.append({"rule": self.text(args[1])})
                return {"call": name, "args": converted}
            if name == "lowercase":
                if len(args) != 1 or args[0].kind == "token":
                    raise self.fail(node, "lowercase() takes a string")
                dom = yield self._term(args[0])
                if not ("literal" in dom or dom.get("call") in ("phonemes", "text", "lowercase")):
                    raise self.fail(node, "lowercase() takes a string")
                return {"call": name, "args": [dom]}
            if name == "matches":
                raise self.fail(node, "matches() is a condition, not a term")
            raise self.fail(node, f"an unknown function {name}()")
        raise self.fail(node, f"unexpected {rule} in a term")
