"""From the notation's document tree to a grammar DOM (engine §9)."""

from __future__ import annotations

import re
from typing import Any

from ._clauses import definition_problem
from ._errors import GencmuError
from ._markdown import GrammarText
from ._model import Node, Token
from ._tags import character_tag
from ._trampoline import Walk, run
from ._types import comparison_problem, condition_type_problem, joined_type, tag_term_problem, term_type
from ._validate import (
    CAPTURE_NAME,
    FORMAT,
    Lowercase,
    property_problem,
    range_problem,
    spelling_problem,
    term_reads_own_tags,
)

Dom = dict[str, Any]

_MAPPED = frozenset(
    """directive argument-string argument-tag rule alternative alternative-tags choice conjunction sequence element
    reference string tag character phoneme name spelled capture group optional empty tags-clause conditions-clause
    emits-clause verbatim-clause emit-item emit-tags implication any-of all-of comparison negation presence call term
    guarded-term union intersection empty-set capture-reference range property""".split()
)
_PROPERTY = re.compile(r"'\\p\{([^}]*)\}'")
_SYMBOLS = frozenset(["reference", "tag", "character", "phoneme", "range", "property", "spelled"])
"""What a capture can wrap: one symbol (engine §9)."""
_DEFINERS = {"%rule": "define", "%redefine-rule": "redefine", "%extend-rule": "extend"}
_SPAN_FUNCTIONS = frozenset(["head", "tail", "last", "from", "after"])
_FUNCTIONS = frozenset(
    ["phonemes", "text", "lowercase", "tags", "classes", "runs", "head", "tail", "last", "from", "after", "matches", "begins", "initial"]
)
_SIGNATURES = {
    "phonemes": "one span",
    "text": "one span",
    "classes": "one span",
    "runs": "one span",
    "head": "one span",
    "tail": "one span",
    "last": "one span",
    "from": "one span",
    "after": "one span",
    "initial": "one span",
    "lowercase": "one string",
    "tags": "a span, and optionally a rule",
    "matches": "a span and a rule",
    "begins": "a span and a rule",
}


def decode_string(text: str) -> str | None:
    """A string or character tag token's value: quotes removed, escapes
    decoded; ``None`` for an escape the notation does not have. A string
    escapes its double quote, and a character tag its quote."""
    quote = text[0]
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
        if following in ("\\", quote):
            out.append(following)
            index += 2
            continue
        if following == "u" and body[index + 2 : index + 3] == "{":
            close = body.find("}", index + 3)
            digits = body[index + 3 : close] if close >= 0 else ""
            # One to six hexadecimal digits of a Unicode scalar value (engine §9).
            if digits and len(digits) <= 6 and all(c in "0123456789abcdefABCDEF" for c in digits):
                value = int(digits, 16)
                if value <= 0x10FFFF and not 0xD800 <= value <= 0xDFFF:
                    out.append(chr(value))
                    index = close + 1
                    continue
        return None
    return "".join(out)


def _is_span(dom: Any) -> bool:
    return isinstance(dom, dict) and ("capture" in dom and "expr" not in dom or dom.get("call") in _SPAN_FUNCTIONS)


def _is_capital(name: str) -> bool:
    """Whether a name begins with a capital, and so is a terminal and a tag
    literal (engine §2)."""
    return "A" <= name[:1] <= "Z"


class DomBuilder:
    """Reads the DOM off a document tree, rule by rule of the §9 table."""

    def __init__(self, tokens: list[Token], grammar_text: GrammarText, document: str, unicode: Lowercase) -> None:
        self.tokens = tokens
        self.grammar_text = grammar_text
        self.document = document
        # The lowercase mapping that spellings are checked against (engine §9, §10).
        self.unicode = unicode

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
            elif kid.kind == "rule" and kid.rule == "directive":
                directives.append(self.directive(kid))
        return {"format": FORMAT, "rules": rules, "directives": directives}

    def directive(self, node: Node) -> Dom:
        kids = self.kids(node)
        name = self.text(kids[0])[1:]
        operands = [kid for kid in kids[1:] if kid.kind == "token" or kid.rule in ("argument-string", "argument-tag")]
        problem = operand_problem(name, [self.operand_kind(kid) for kid in operands])
        if problem:
            raise self.fail(node, problem)
        args = [self.operand(kid) for kid in operands]
        return {"name": name, "args": args, "at": list(self.position(node))}

    def operand(self, node: Node) -> str:
        """A directive's operand: a name is its text, a string is decoded,
        as a string of a rule is, and a tag literal is its tag."""
        if node.kind == "token":
            return self.text(node)
        if node.rule == "argument-string":
            return self.decode(self.kids(node)[0])
        # A range or a property has no tag; operand_problem has refused it.
        return self.tag_of(self.kids(node)[0])

    def operand_kind(self, node: Node) -> str:
        """The kind of a directive's operand: ``name`` or ``class`` for a
        bare name, lower case or with a capital, ``string``, or ``tag``,
        ``phoneme`` or ``character`` for a tag, or ``range`` or ``property``
        (engine §9)."""
        if node.kind == "token":
            return "class" if _is_capital(self.text(node)) else "name"
        if node.rule == "argument-string":
            return "string"
        operand = self.kids(node)[0]
        if operand.kind == "rule" and operand.rule in ("range", "property"):
            return operand.rule
        written = self.text(operand)
        return "tag" if written.startswith("~") else "phoneme" if written.startswith("/") else "character"

    def rule(self, node: Node) -> Dom:
        """A definition: its keyword, its name, its alternatives and its
        clauses, checked as a whole once it is read (engine §9)."""
        kids = self.kids(node)
        op = _DEFINERS[self.text(kids[0])]
        name = self.text(kids[1])
        tags: Dom | None = None
        alternatives: list[Dom] = []
        emit: Dom | None = None
        verbatim = False
        conditions: list[Dom] = []
        for kid in kids[2:]:
            if kid.kind == "token":
                continue
            if kid.rule == "alternative":
                alternatives.append(self.alternative(kid))
            elif kid.rule == "tags-clause":
                tags = self.own_tags(kid)
            elif kid.rule == "conditions-clause":
                conditions.extend(run(self._condition(item)) for item in self.rules(kid, "implication"))
            elif kid.rule == "emits-clause":
                emit = self.emission(kid)
            elif kid.rule == "verbatim-clause":
                verbatim = True
        dom: Dom = {"name": name, "op": op}
        if tags is not None:
            dom["tags"] = tags
        dom["alternatives"] = alternatives
        if emit is not None:
            dom["emit"] = emit
        dom["conditions"] = conditions
        # Present only for a rule that has %verbatim (docs/output.md).
        if verbatim:
            dom["verbatim"] = True
        dom["at"] = list(self.position(node))
        problem = definition_problem(dom)
        if problem is not None:
            raise self.fail(node, problem)
        return dom

    # -- expressions

    def alternative(self, node: Node) -> Dom:
        guards: list[Dom] = []
        expr: Dom | None = None
        tags: Dom | None = None
        self.captures: set[str] = set()
        for kid in self.kids(node):
            if kid.kind == "token":
                # A guard's token is its spelling: f? or ¬f? for a gate, f!
                # for a warning (engine §9).
                text = self.text(kid)
                negated = text.startswith("¬")
                kind = "warning" if text.endswith("!") else "gate"
                guards.append({"feature": text[1 if negated else 0 : -1], "kind": kind, "negated": negated})
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
        tags = self.tag_term(self.rules(node, "term")[0])
        if term_reads_own_tags(tags):
            raise self.fail(node, "a constituent's tags cannot be made of its own: tags($) or classes($)")
        return tags

    def tag_term(self, node: Node) -> Dom:
        """A whole term that must be a tag set: a constituent's or an item's
        tags (engine §10). The error stands at the term."""
        term = self.value(node)
        problem = tag_term_problem(term)
        if problem is not None:
            raise self.fail(node, problem)
        return term

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
        if rule in ("tag", "character", "phoneme"):
            return {"terminal": self.tag_of(self.kids(node)[0])}
        if rule == "range":
            return {"range": self.range_of(node)}
        if rule == "property":
            return {"property": self.property_of(self.kids(node)[0])}
        if rule == "spelled":
            # A reference or a terminal and its spelling, which the syntax
            # grammar gives nothing else (engine §9).
            kids = self.kids(node)
            symbol = next(kid for kid in kids if kid.kind == "rule")
            spelling_token = kids[-1]
            expr = yield self._expr(symbol)
            if "range" in expr or "property" in expr:
                raise self.fail(spelling_token, "a range or a property takes no spelling")
            spelling = self.text(spelling_token)[1:-1]
            problem = spelling_problem(spelling, expr, self.unicode)
            if problem is not None:
                raise self.fail(spelling_token, problem)
            return {"spelling": spelling, "expr": expr}
        if rule == "capture":
            kids = self.kids(node)
            name = self.text(kids[0])[1:]
            if not name:
                raise self.fail(node, "$ is the whole constituent and wraps nothing")
            if not CAPTURE_NAME.fullmatch(name):
                raise self.fail(node, f"the capture ${name} has a capital; a capture's name is all lower case")
            inner = [kid for kid in kids[1:] if kid.kind == "rule"]
            if len(inner) != 1 or inner[0].rule not in _SYMBOLS:
                raise self.fail(node, f"the capture ${name} must wrap one reference or terminal, spelled or not")
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
            raise self.fail(token, "a string or a character tag has an escape other than \\\\, its quote and \\u{…}")
        return value

    def tag_of(self, token: Node) -> str:
        """The tag of a tag literal ``~name``, a character tag or a phoneme
        tag token: a character tag in its canonical spelling (engine §1, §9)."""
        written = self.text(token)
        if written.startswith("~"):
            return written[1:]
        if written.startswith("/"):
            return written
        decoded = self.decode(token)
        if len(decoded) != 1:
            raise self.fail(token, "a character tag holds exactly one character")
        return character_tag(ord(decoded), self.unicode)

    def range_of(self, node: Node) -> list[str]:
        """A range's two ends, each a character tag in its canonical
        spelling; its start must not be above its end (engine §1, §9)."""
        ends = [self.tag_of(self.kids(end)[0]) for end in self.rules(node, "character")]
        problem = range_problem(ends, self.unicode)
        if problem is not None:
            raise self.fail(node, problem)
        return ends

    def property_of(self, token: Node) -> str:
        """A property's name: its token is ``'\\p{Name}'``, with a name of
        engine §1."""
        match = _PROPERTY.fullmatch(self.text(token))
        if match is None:
            raise self.fail(token, "a property is written '\\p{Name}'")
        name = match.group(1)
        problem = property_problem(name)
        if problem is not None:
            raise self.fail(token, problem)
        return name

    # -- emission

    def emission(self, node: Node) -> Dom:
        """An ``%emits`` clause: its items, each a capture, with a term for
        its own tags if it has one, or an inserted tag; no items for ``ε``
        (engine §9)."""
        items: list[Dom] = []
        for item in self.rules(node, "emit-item"):
            kids = self.kids(item)
            target = kids[0]
            if target.kind == "rule" and target.rule in ("range", "property"):
                raise self.fail(item, "an inserted item is one tag, not a range or a property")
            tag_nodes = [kid for kid in kids[1:] if kid.kind == "rule" and kid.rule == "emit-tags"]
            text = self.text(target)
            tags_of_target = self.tokens[target.token].tags if target.token is not None else frozenset()
            entry: Dom
            if "capture" in tags_of_target:
                entry = {"capture": text[1:]}
            elif "identifier" in tags_of_target:
                # An inserted item is one tag literal (engine §9): a bare
                # lower-case name is a rule, and a string is no tag.
                if not _is_capital(text):
                    raise self.fail(target, f"{text} names a rule; an inserted tag is a tag literal, such as ~{text}")
                entry = {"insert": text}
            elif tags_of_target & {"tag", "character", "phoneme"}:
                entry = {"insert": self.tag_of(target)}
            else:
                raise self.fail(target, "expected a capture or a tag after %emits")
            if tag_nodes:
                if "insert" in entry:
                    raise self.fail(target, "an inserted tag takes no tags of its own")
                entry["tags"] = self.tag_term(self.rules(tag_nodes[0], "term")[0])
                if entry["tags"].get("emptySet") is True:
                    raise self.fail(target, "an emitted token's tags cannot be ∅, which no terminal reads; a rule that emits nothing says %emits ε")
            items.append(entry)
        whole = [item for item in items if item.get("capture") == ""]
        if whole and len(whole) != len(items):
            raise self.fail(node, "$ is used with items other than $")
        named = [item["capture"] for item in items if item.get("capture")]
        if len(set(named)) != len(named):
            raise self.fail(node, "%emits lists a capture twice")
        return {"items": items}

    # -- conditions

    def _condition(self, node: Node) -> Walk:
        """A condition: ``⟹`` groups to the right, and a group of the same
        connective, ``∧`` or ``∨``, is folded into the one around it, since
        parentheses make no node (engine §9)."""
        if node.rule == "implication":
            parts = [kid for kid in self.kids(node) if kid.kind == "rule"]
            premise = yield self._condition(parts[0])
            if len(parts) == 1:
                return premise
            return {"if": premise, "then": (yield self._condition(parts[1]))}
        if node.rule in ("any-of", "all-of"):
            key = "any" if node.rule == "any-of" else "all"
            parts: list[Dom] = []
            for kid in self.kids(node):
                if kid.kind == "rule":
                    part = yield self._condition(kid)
                    # Parentheses make no node: a group of the same
                    # connective is folded into this one (engine §9).
                    if key in part:
                        parts.extend(part[key])
                    else:
                        parts.append(part)
            return parts[0] if len(parts) == 1 else {key: parts}
        return (yield self._simple_condition(node))

    def _simple_condition(self, node: Node) -> Walk:
        if node.rule == "comparison":
            kids = self.kids(node)
            terms = [kid for kid in kids if kid.kind == "rule"]
            op = next(self.text(kid) for kid in kids if kid.kind == "token")
            left = yield self._term(terms[0])
            right = yield self._term(terms[1])
            # The two sides fit the comparator (engine §10).
            left_type, problem = term_type(left)
            if problem is None:
                right_type, problem = term_type(right)
                if problem is None:
                    problem = comparison_problem(op, left_type, right_type)  # type: ignore[arg-type]
            if problem is not None:
                raise self.fail(node, problem)
            return {"op": op, "left": left, "right": right}
        if node.rule == "negation":
            inner = [kid for kid in self.kids(node) if kid.kind == "rule"]
            return {"not": (yield self._condition(inner[0]))}
        if node.rule == "presence":
            return {"captured": self.text(self.kids(node)[0])[1:]}
        if node.rule == "call":
            call = yield self._call(node)
            args = call["args"]
            if call["call"] == "initial" and len(args) == 1 and "rule" not in args[0]:
                return {"initial": args[0]}
            if call["call"] not in ("matches", "begins") or len(args) != 2 or "rule" not in args[1] or "rule" in args[0]:
                raise self.fail(node, "a condition calls only matches(span, rule), begins(span, rule) or initial(span)")
            return {call["call"]: args[0], "rule": args[1]["rule"]}
        raise self.fail(node, f"unexpected {node.rule} in a condition")

    # -- terms

    def value(self, node: Node) -> Dom:
        return run(self._term(node))  # type: ignore[no-any-return]

    def _call(self, node: Node) -> Walk:
        """A call and its arguments, checked against the function's
        signature (engine §9). A bare lower-case name is a rule, which only
        the second argument of tags, matches or begins names."""
        kids = self.kids(node)
        name = self.text(kids[0])
        if name not in _FUNCTIONS:
            raise self.fail(node, f"an unknown function {name}()")
        args: list[Dom] = []
        for kid in kids[1:]:
            if kid.kind == "rule":
                args.append((yield self._term(kid, True)))

        def is_string(argument: Dom) -> bool:
            if "rule" in argument:
                return False
            kind, problem = term_type(argument)
            return problem is None and kind == "string"

        def is_rule(argument: Dom) -> bool:
            return "rule" in argument

        if name == "tags":
            ok = (len(args) == 1 and _is_span(args[0])) or (len(args) == 2 and _is_span(args[0]) and is_rule(args[1]))
        elif name in ("matches", "begins"):
            ok = len(args) == 2 and _is_span(args[0]) and is_rule(args[1])
        elif name == "lowercase":
            ok = len(args) == 1 and is_string(args[0])
        else:
            ok = len(args) == 1 and _is_span(args[0])
        # A rule stands only as the second argument.
        if not ok or any(is_rule(argument) and index != 1 for index, argument in enumerate(args)):
            raise self.fail(node, f"{name}() takes {_SIGNATURES[name]}")
        return {"call": name, "args": args}

    def _joined(self, node: Node, items: list[Dom], operator: str) -> None:
        """Sets joined by an operator are of one kind (engine §10); the
        error stands at the construct that joins them."""
        types = []
        for item in items:
            kind, problem = term_type(item)
            if problem is not None:
                raise self.fail(node, problem)
            types.append(kind)
        _, problem = joined_type(types, operator)  # type: ignore[arg-type]
        if problem is not None:
            raise self.fail(node, problem)

    def _term(self, node: Node, argument: bool = False) -> Walk:
        """A term; ``argument`` says it is a function's argument, where a
        span or a rule may stand."""
        rule = node.rule
        if rule == "term":
            return (yield self._term([kid for kid in self.kids(node) if kid.kind == "rule"][0], argument))
        if rule == "guarded-term":
            parts = [kid for kid in self.kids(node) if kid.kind == "rule"]
            condition = yield self._condition(parts[0])
            problem = condition_type_problem(condition)
            if problem is not None:
                raise self.fail(node, problem)
            guarded = {"if": condition, "then": (yield self._term(parts[1]))}
            _, problem = term_type(guarded)
            if problem is not None:
                raise self.fail(node, problem)
            return guarded
        if rule == "union":
            # Parts joined by ∪ and ∖ group from the left: a run joined by ∪
            # is one union, and each ∖ takes what stands before it (engine
            # §9). A leading ∪ is a separator, not an operator.
            kids = self.kids(node)
            parts = [kid for kid in kids if kid.kind == "rule"]
            if len(parts) == 1:
                return (yield self._term(parts[0], argument))
            operators = [self.text(kid) for kid in kids if kid.kind == "token" and self.text(kid) in ("∪", "∖")]
            operators = operators[len(operators) - (len(parts) - 1) :]
            items: list[Dom] = []
            for part in parts:
                items.append((yield self._term(part)))
            self._joined(node, items, "∖" if "∖" in operators else "∪")
            result = items[0]
            open_union = False
            for operator, following in zip(operators, items[1:]):
                if operator == "∖":
                    result = {"difference": [result, following]}
                    open_union = False
                elif open_union:
                    result["union"].append(following)
                else:
                    result = {"union": [result, following]}
                    open_union = True
            return result
        if rule == "intersection":
            parts = [kid for kid in self.kids(node) if kid.kind == "rule"]
            if len(parts) == 1:
                return (yield self._term(parts[0], argument))
            items = []
            for part in parts:
                items.append((yield self._term(part)))
            self._joined(node, items, "∩")
            return {"intersection": items}
        if rule == "string":
            return {"string": self.decode(self.kids(node)[0])}
        if rule in ("tag", "character", "phoneme"):
            return {"tag": self.tag_of(self.kids(node)[0])}
        if rule == "range":
            return {"range": self.range_of(node)}
        if rule == "property":
            raise self.fail(node, "a property is not a tag set, and stands only as a terminal in a body")
        if rule == "name":
            # A bare name is a tag literal if it begins with a capital, and
            # otherwise a rule, which only a function's argument names.
            name = self.text(self.kids(node)[0])
            if _is_capital(name):
                return {"tag": name}
            if argument:
                return {"rule": name}
            raise self.fail(node, f"{name} names a rule, which is not a value; ~{name} is the tag")
        if rule == "empty-set":
            return {"emptySet": True}
        if rule == "capture-reference":
            capture = self.text(self.kids(node)[0])[1:]
            if not argument:
                raise self.fail(node, f"a span is not a value: tags(${capture}) is the tag set of ${capture}")
            return {"capture": capture}
        if rule == "call":
            call = yield self._call(node)
            # A span is not a value: the error stands at the span (engine §9).
            if not argument and call["call"] in _SPAN_FUNCTIONS:
                raise self.fail(node, f"{call['call']}() gives a span, which is not a value")
            if call["call"] in ("matches", "begins", "initial"):
                raise self.fail(node, f"{call['call']}() is a condition, not a term")
            return call
        raise self.fail(node, f"unexpected {rule} in a term")


def operand_problem(name: str, kinds: list[str]) -> str | None:
    """What is wrong with a directive's operands, each ``name`` or
    ``class``, a bare name lower case or with a capital, ``string``,
    ``tag``, ``phoneme`` or ``character``, or ``range`` or ``property``, or
    None (engine §9)."""
    names = all(kind in ("name", "class") for kind in kinds)
    if name == "stage":
        return None if len(kinds) == 1 and names else "%stage takes one name"
    if name == "include":
        return None if kinds == ["string"] else "%include takes one string"
    if name == "features":
        return None if kinds and names else "%features takes one or more names"
    # %elidable takes identifier tags: a name with a capital, or ~name.
    if name == "elidable":
        return None if all(kind in ("class", "tag") for kind in kinds) else "%elidable takes identifier tags: names with a capital, or ~name"
    return None if names else f"%{name} takes names only"
