"""From the notation's document tree to a grammar DOM (engine §9)."""

from __future__ import annotations

import re
from typing import Any

from ._clauses import attachment_order, definition_problem, duplicate_captures, deferred_emission_problem, rule_has_ranked
from ._errors import GencmuError
from ._markdown import GrammarText
from ._model import Node, Token
from ._tags import character_tag
from ._trampoline import Walk, run
from ._patterns import pattern_problem
from ._types import (
    comparison_problem,
    Memo as TypeMemo,
    constant_value_type,
    expected_problem,
    is_sound_test,
    joined_type,
    tag_term_problem,
    term_type,
    test_type_problem,
)
from ._validate import (
    CAPTURE_NAME,
    CLASSIFIER_NAME,
    FORMAT,
    Lowercase,
    literal_call_problem,
    property_problem,
    range_problem,
    sound_problem,
    term_reads_own_tags,
)

Dom = dict[str, Any]

_MAPPED = frozenset(
    """directive argument-word argument-string argument-tag rule definer rule-flags rule-flag rule-name body alternative ranked-alternative ranked-choice guard alternative-tags
    choice conjunction sequence primary repetition reference string tag character phoneme name tested test test-operand capture
    group optional empty tags-clause conditions-clause emits-clause opaque-clause emit-item emit-target emit-tags emit-before
    emit-after implication any-of all-of condition comparison comparator negation presence call argument term guarded-term
    union intersection term-atom empty-set capture-reference range property constant-definition constant-definer
    constant-reference classifier classifier-name classifier-entry classifier-key classifier-operator classifier-class
    implication-declaration tree-comparison pattern-literal pattern-union pattern-intersection pattern-sequence pattern-item pattern-atom pattern-brackets pattern-repeat pattern-path pattern-separator""".split()
)
"""The rules of the notation's syntax grammar that the reader knows (engine
§9). Every other rule is a wrapper, and the reader reads its parts in its
place."""
_PRIMARIES = frozenset(
    [
        "reference",
        "tag",
        "character",
        "phoneme",
        "range",
        "property",
        "tested",
        "capture",
        "group",
        "optional",
        "repetition",
        "empty",
        "constant-reference",
    ]
)
_CONDITIONS = frozenset(["tree-comparison", "comparison", "call", "negation", "presence", "implication"])
_TERMS = frozenset(["union", "guarded-term"])
_ATOMS = frozenset(
    ["string", "tag", "character", "phoneme", "range", "property", "name", "empty-set", "term", "call", "capture-reference", "constant-reference", "pattern-literal"]
)
"""What a primary, a condition, a term and a term atom hold: the one rule
among their parts is one of these (engine §9)."""
_ITEMS = frozenset(["directive", "rule", "constant-definition", "classifier", "implication-declaration"])
"""The items of a document (engine §9)."""
_PROPERTY = re.compile(r"'\\p\{([^}]*)\}'")
_SYMBOLS = frozenset(["reference", "tag", "character", "phoneme", "range", "property", "tested"])
"""What a capture can wrap: one symbol (engine §9)."""
_DEFINERS = {"%rule": "define", "%redefine-rule": "redefine", "%extend-rule": "extend"}
_SPAN_FUNCTIONS = frozenset(["head", "tail", "last", "from", "after"])
_FUNCTIONS = frozenset(
    ["phonemes", "text", "split", "tag", "tags", "classes", "classify", "head", "tail", "last", "from", "after", "matches", "begins", "initial"]
)
_SIGNATURES = {
    "phonemes": "one span",
    "text": "one span",
    "classes": "one span",
    "head": "one span",
    "tail": "one span",
    "last": "one span",
    "from": "one span",
    "after": "one span",
    "initial": "one span",
    "split": "two strings",
    "tag": "one string",
    "tags": "a span, and optionally a rule",
    "classify": "a string and a classifier's name",
    "matches": "a span and a rule",
    "begins": "a span and a rule",
}


_CONSTANT_IN_BODY = (
    "a constant cannot stand in a body: a body names a class of tokens with a rule, such as %rule digit '0'..'9'"
)


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


class DeferredDom(dict):
    def __init__(self,dom,pending):
        super().__init__(dom)
        self.deferred_emissions = pending


class DomBuilder:
    """Reads the DOM off a document tree, rule by rule of the §9 table."""

    def __init__(self, tokens: list[Token], grammar_text: GrammarText, document: str, unicode: Lowercase, defer_emission: bool = False) -> None:
        self.defer_emission = defer_emission
        self.deferred_emissions = []
        self.tokens = tokens
        self.grammar_text = grammar_text
        self.document = document
        # The lowercase mapping that the strings of sound tests are checked
        # against (engine §5, §9).
        self.unicode = unicode
        # What the reader is reading as a closed term, a constant's value or
        # a test's operand, or None (engine §9, §10).
        self.closed_for: str | None = None
        # The notation node of each capture of the alternative being read,
        # by the identity of its DOM, and how many braces and elidable
        # optionals the reader is inside, where no capture stands.
        self.capture_nodes: dict[int, Node] = {}
        self.braces = 0
        self.marked = 0
        # The types found of the terms and conditions read, each found once
        # (engine §10).
        self.types: TypeMemo = {}

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
        return GencmuError(message, document=self.document, line=line, column=column, code="ranked-choice-syntax" if node.rule == "ranked-choice" else None)

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

    # -- the parts that the reader reads from a node (engine §9). A node that
    # lacks one is an error of the document, which only a bootstrap of
    # another notation gives.

    def lacks(self, node: Node, what: str) -> GencmuError:
        return self.fail(node, f"the notation's {node.rule} has no {what}")

    def one(self, node: Node, name: str) -> Node | None:
        found = self.rules(node, name)
        return found[0] if found else None

    def only(self, node: Node, name: str) -> Node:
        found = self.rules(node, name)
        if not found:
            raise self.lacks(node, name)
        return found[0]

    def some(self, node: Node, name: str, least: int = 1) -> list[Node]:
        found = self.rules(node, name)
        if len(found) < least:
            raise self.lacks(node, name if least == 1 else f"{least} of {name}")
        return found

    def token(self, node: Node) -> Node:
        found = next((kid for kid in self.kids(node) if kid.kind == "token"), None)
        if found is None:
            raise self.lacks(node, "token")
        return found

    def symbol_part(self, node: Node) -> Node:
        """The first part, a token, a range or a property."""
        kids = self.kids(node)
        if kids and (kids[0].kind == "token" or kids[0].rule in ("range", "property")):
            return kids[0]
        raise self.lacks(node, "token, range or property")

    def known_of(self, node: Node, kinds: frozenset[str]) -> Node:
        """The one rule among the parts, which must be one of ``kinds``."""
        found = [kid for kid in self.kids(node) if kid.kind == "rule"]
        if len(found) != 1 or found[0].rule not in kinds:
            raise self.lacks(node, "single part of these: " + ", ".join(sorted(kinds)))
        return found[0]

    # -- the document

    def document_dom(self, root: Node) -> Dom:
        rules: list[Dom] = []
        directives: list[Dom] = []
        constants: list[Dom] = []
        classifiers: list[Dom] = []
        implications: list[Dom] = []
        for kid in self.kids(root):
            if kid.kind == "rule" and kid.rule not in _ITEMS:
                raise self.fail(kid, f"the notation gives a {kid.rule} where an item stands")
            if kid.kind == "rule" and kid.rule == "rule":
                rules.append(self.rule(kid))
            elif kid.kind == "rule" and kid.rule in ("directive"):
                directives.append(self.directive(kid))
            elif kid.kind == "rule" and kid.rule == "constant-definition":
                constants.append(self.constant(kid))
            elif kid.kind == "rule" and kid.rule == "classifier":
                classifiers.append(self.classifier(kid))
            elif kid.kind == "rule" and kid.rule == "implication-declaration":
                implications.append(self.implication(kid))
        return {
            "format": FORMAT,
            "rules": rules,
            "directives": directives,
            "constants": constants,
            "classifiers": classifiers,
            "implications": implications,
        }

    def classifier(self, node: Node) -> Dom:
        """A ``%classifier`` item: its name, which begins with a lower-case
        letter, and its entries (engine §2, §9)."""
        name_node = self.only(node, "classifier-name")
        name = self.text(self.token(name_node))
        if not CLASSIFIER_NAME.fullmatch(name):
            raise self.fail(name_node, f"{name} begins with a capital, so it is a tag; a classifier's name begins with a lower-case letter")
        entries = [self.entry(entry) for entry in self.rules(node, "classifier-entry")]
        return {"name": name, "entries": entries, "at": list(self.position(node))}

    def entry(self, node: Node) -> Dom:
        """An entry of a classifier: gates, canonical keys, ``∈`` or ``∉``,
        and a class (engine §2, §9)."""
        guards: list[Dom] = []
        keys: list[str] = []
        for guard in self.rules(node, "guard"):
            # A guard's token is its text: f? or ¬f? for a gate. A warning
            # f! is an error here.
            text = self.text(self.token(guard))
            if text.endswith("!"):
                raise self.fail(guard, "an entry of a classifier takes gates only, not a warning")
            negated = text.startswith("¬")
            guards.append({"feature": text[1 if negated else 0 : -1], "kind": "gate", "negated": negated})
        for key_node in self.some(node, "classifier-key"):
            key = self.decode(self.token(key_node))
            wrong = sound_problem(key, self.unicode)
            if wrong is not None:
                raise self.fail(key_node, f"a key is a canonical sound: {wrong}")
            keys.append(key)
        op = self.text(self.token(self.only(node, "classifier-operator")))
        class_node = self.only(node, "classifier-class")
        written = self.text(self.token(class_node))
        name = written[1:] if written.startswith("~") else written
        if not _is_capital(name):
            raise self.fail(class_node, f"{written} is not a class: a class is an identifier tag that begins with a capital")
        return {"guards": guards, "keys": keys, "op": op, "class": name, "at": list(self.position(node))}

    def implication(self, node: Node) -> Dom:
        """An implication, ``%implies A ⟹ B``: two closed terms whose type is
        a tag set (engine §2, §9)."""
        sides: list[Dom] = []
        for side in self.some(node, "union", 2)[:2]:
            self.closed_for = "a side of an implication"
            try:
                term = self.value(side)
            finally:
                self.closed_for = None
            kind, problem = term_type(term, memo=self.types)
            if problem is None:
                problem = expected_problem(kind, "tags")  # type: ignore[arg-type]
            if problem is not None:
                raise self.fail(side, f"a side of an implication is a tag set: {problem}")
            sides.append(term)
        return {"if": sides[0], "then": sides[1], "at": list(self.position(node))}

    def constant(self, node: Node) -> Dom:
        """A constant's definition: its name without ``$``, and its value, a
        closed term of a type that a constant can have (engine §2, §9,
        §10)."""
        keyword = self.text(self.token(self.only(node, "constant-definer")))
        name = self.text(self.token(self.only(node, "constant-reference")))[1:]
        value_node = self.only(node, "term")
        self.closed_for = "a constant's value"
        try:
            value = self.value(value_node)
        finally:
            self.closed_for = None
        op = "redefine" if keyword == "%redefine-const" else "define"
        _, fault = constant_value_type(value, op == "redefine", memo=self.types)
        if fault is not None:
            raise self.fail(value_node, fault[0])
        return {"name": name, "op": op, "value": value, "at": list(self.position(node))}

    def directive(self, node: Node) -> Dom:
        name = self.text(self.token(node))[1:]
        operands = [kid for kid in self.kids(node) if kid.kind == "rule" and kid.rule in ("argument-word", "argument-string", "argument-tag")]
        problem = operand_problem(name, [self.operand_kind(kid) for kid in operands])
        if problem:
            raise self.fail(node, problem)
        args = [self.operand(kid) for kid in operands]
        if name == "ambiguity-resolution" and "maximal" in args:
            raise self.fail(node, "stage-wide maximal is retired; use [++T] for an individual terminator")
        return {"name": name, "args": args, "at": list(self.position(node))}

    def operand(self, node: Node) -> str:
        """A directive's operand: a name is its text, a string is decoded,
        as a string of a rule is, and a tag literal is its tag."""
        if node.rule == "argument-word":
            return self.text(self.token(node))
        if node.rule == "argument-string":
            return self.decode(self.token(node))
        # A range or a property has no tag; operand_problem has refused it.
        return self.tag_of(self.symbol_part(node))

    def operand_kind(self, node: Node) -> str:
        """The kind of a directive's operand: ``name`` or ``class`` for a
        bare name, lower case or with a capital, ``string``, or ``tag``,
        ``phoneme`` or ``character`` for a tag, or ``range`` or ``property``
        (engine §9)."""
        if node.rule == "argument-word":
            return "class" if _is_capital(self.text(self.token(node))) else "name"
        if node.rule == "argument-string":
            return "string"
        operand = self.symbol_part(node)
        if operand.kind == "rule" and operand.rule in ("range", "property"):
            return operand.rule
        written = self.text(operand)
        return "tag" if written.startswith("~") else "phoneme" if written.startswith("/") else "character"

    def rule(self, node: Node) -> Dom:
        """A definition: its keyword, its name, its alternatives and its
        clauses, checked as a whole once it is read (engine §9)."""
        op = _DEFINERS.get(self.text(self.token(self.only(node, "definer"))), "define")
        name = self.text(self.token(self.only(node, "rule-name")))
        flags: list[str] = []
        flag_list = self.one(node, "rule-flags")
        if flag_list is not None:
            if op == "extend":
                raise self.fail(flag_list, "%extend-rule accepts no flags")
            for flag in self.some(flag_list, "rule-flag"):
                value = self.text(self.token(flag))
                if value != "leftmost-longest":
                    raise self.fail(flag, f"unknown rule flag {value}")
                if value in flags:
                    raise self.fail(flag, f"duplicate rule flag {value}")
                flags.append(value)
        # The parts of a definition are read in the order written: the body,
        # then its clauses in their fixed order, and the checks of the whole
        # definition last (engine §9).
        body = self.only(node, "body")
        ranked = self.one(body, "ranked-alternative")
        alternatives = [self.alternative(kid) for kid in ([ranked] if ranked is not None else self.some(body, "alternative"))]
        tags_node = self.one(node, "tags-clause")
        tags = self.own_tags(tags_node) if tags_node is not None else None
        conditions_node = self.one(node, "conditions-clause")
        conditions: list[Dom] = []
        if conditions_node is not None:
            conditions = [run(self._condition(item)) for item in self.some(conditions_node, "implication")]
        emits_node = self.one(node, "emits-clause")
        emit = self.emission(emits_node) if emits_node is not None else None
        opaque = self.one(node, "opaque-clause") is not None
        dom: Dom = {"name": name, "op": op, "flags": flags}
        if tags is not None:
            dom["tags"] = tags
        dom["alternatives"] = alternatives
        if emit is not None:
            dom["emit"] = emit
        dom["conditions"] = conditions
        # Present only for a rule that has %opaque (docs/output.md).
        if opaque:
            dom["opaque"] = True
        dom["at"] = list(self.position(node))
        flatten_groups(dom)
        problem = definition_problem(dom)
        if problem is not None:
            if self.defer_emission and deferred_emission_problem(problem) and rule_has_ranked(dom):
                self.deferred_emissions.append((dom,problem))
            else:
                raise self.fail(node, problem)
        return dom

    # -- expressions

    def alternative(self, node: Node) -> Dom:
        guards: list[Dom] = []
        self.capture_nodes = {}
        self.braces = 0
        self.marked = 0
        for guard in self.rules(node, "guard"):
            # A guard's token is its text: f? or ¬f? for a gate, f! for a
            # warning (engine §9).
            text = self.text(self.token(guard))
            negated = text.startswith("¬")
            kind = "warning" if text.endswith("!") else "gate"
            guards.append({"feature": text[1 if negated else 0 : -1], "kind": kind, "negated": negated})
        expr = run(self._expr(self.only(node, "ranked-choice" if node.rule == "ranked-alternative" else "conjunction"), True))
        # A name stands at most once in each production, gates aside: the
        # error stands at the second capture that such a production reads,
        # the first in the text where there are several (engine §3.5, §9).
        twice = [self.capture_nodes[id(capture)] for capture in duplicate_captures(expr)]
        if twice:
            first = min(twice, key=lambda capture: self.first_token(capture) or 0)
            name = self.text(self.token(first))[1:]
            raise self.fail(first, f"the capture ${name} is read twice by one production of the alternative")
        tags_node = self.one(node, "alternative-tags")
        tags = self.own_tags(tags_node) if tags_node is not None else None
        dom: Dom = {"guards": guards, "expr": expr}
        if tags is not None:
            dom["tags"] = tags
        return dom

    def own_tags(self, node: Node) -> Dom:
        """A rule's or an alternative's tag term, which may not read the tags
        it defines (engine §9)."""
        tags = self.tag_term(self.only(node, "term"))
        if term_reads_own_tags(tags):
            raise self.fail(node, "a constituent's tags cannot be made of its own: tags($) or classes($)")
        return tags

    def tag_term(self, node: Node) -> Dom:
        """A whole term that must be a tag set: a constituent's or an item's
        tags (engine §10). The error stands at the term."""
        term = self.value(node)
        problem = tag_term_problem(term, memo=self.types)
        if problem is not None:
            raise self.fail(node, problem)
        return term

    def _expr(self, node: Node, whole: bool = False) -> Walk:
        """An expression; ``whole`` says it is its alternative's whole
        expression, where a chain may stand (engine §9)."""
        rule = node.rule
        if rule == "choice":
            ranked = self.one(node, "ranked-choice")
            if ranked is not None:
                return (yield self._expr(ranked))
        if rule in ("choice", "ranked-choice", "conjunction", "sequence"):
            part = {"choice": "conjunction", "ranked-choice": "conjunction", "conjunction": "sequence", "sequence": "primary"}[rule]
            parts = self.some(node, part, 2 if rule == "ranked-choice" else 1)
            if rule == "conjunction" and len(parts) > 16:
                raise self.fail(node, "& joins at most 16 items, since it expands to 2ⁿ−1 sequences")
            # A choice's conjunction is never the whole expression, nor is
            # an item of a sequence or of & of several.
            nested = whole and rule not in ("choice", "ranked-choice") and len(parts) == 1
            items: list[Dom] = []
            for p in parts:
                items.append((yield self._expr(self.known_of(p, _PRIMARIES) if rule == "sequence" else p, nested)))
            if len(items) == 1:
                return items[0]
            key = {"choice": "choice", "ranked-choice": "ranked", "conjunction": "and", "sequence": "seq"}[rule]
            return {key: items}
        if rule == "reference":
            return {"ref": self.text(self.token(node))}
        if rule in ("tag", "character", "phoneme"):
            return {"terminal": self.tag_of(self.token(node))}
        if rule == "range":
            return {"range": self.range_of(node)}
        if rule == "property":
            return {"property": self.property_of(self.token(node))}
        if rule == "tested":
            # A reference other than # or a terminal, and one test on its
            # own span (engine §2, §9). The syntax grammar reads a test after
            # any primary, so that the reader can name the reason. The test
            # is checked before what the primary holds.
            test_node = self.only(node, "test")
            symbol = self.known_of(self.only(node, "primary"), _PRIMARIES)
            kind = symbol.rule
            if kind == "constant-reference":
                raise self.fail(symbol, _CONSTANT_IN_BODY)
            if kind not in ("reference", "tag", "character", "phoneme", "range", "property") or (
                kind == "reference" and self.text(self.token(symbol)) == "#"
            ):
                raise self.fail(
                    test_node,
                    "a test follows only a reference other than # or a terminal, not a group, an optional, braces, a capture, ε, # or another test",
                )
            expr = yield self._expr(symbol)
            # The comparator is the test's tokens: =, ≠, ⊇ or ⊉, or ∩ and
            # =∅ or ≠∅ around the operand.
            op = "".join(self.text(kid) for kid in self.kids(test_node) if kid.kind == "token")
            operand = self.only(test_node, "test-operand")
            self.closed_for = "a test's operand"
            try:
                value = self.value(operand)
            finally:
                self.closed_for = None
            found, problem = term_type(value, memo=self.types)
            if problem is None:
                problem = test_type_problem(op, found)  # type: ignore[arg-type]
            if problem is not None:
                raise self.fail(operand, problem)
            if is_sound_test(op) and "string" in value:
                wrong = sound_problem(value["string"], self.unicode)
                if wrong is not None:
                    raise self.fail(self._first_of_rule(operand, "string") or operand, wrong)
            return {"test": op, "value": value, "expr": expr}
        if rule == "capture":
            # Its place, its name and its symbol, in that order, before what
            # it wraps (engine §9).
            if self.braces:
                raise self.fail(node, "a capture cannot stand inside braces, whose parts repeat: name the list as a rule, and capture that")
            if self.marked:
                raise self.fail(node, "a capture cannot stand inside an elidable optional, which elision restores as one unit")
            name = self.text(self.token(node))[1:]
            wrapped = self.only(node, "primary")
            if not name:
                raise self.fail(node, "$ is the whole constituent and wraps nothing")
            if not CAPTURE_NAME.fullmatch(name):
                raise self.fail(node, f"the capture ${name} has a capital; a capture's name is all lower case")
            inner = self.known_of(wrapped, _PRIMARIES)
            if inner.rule == "constant-reference":
                raise self.fail(inner, _CONSTANT_IN_BODY)
            if inner.rule not in _SYMBOLS:
                raise self.fail(node, f"the capture ${name} must wrap one reference or terminal, tested or not")
            capture = {"capture": name, "expr": (yield self._expr(inner))}
            self.capture_nodes[id(capture)] = node
            return capture
        if rule == "constant-reference":
            raise self.fail(node, _CONSTANT_IN_BODY)
        if rule == "group":
            return (yield self._expr(self.only(node, "choice")))
        if rule == "optional":
            return (yield self._optional(node))
        if rule == "repetition":
            return (yield self._repetition(node, whole))
        if rule == "empty":
            return {"empty": True}
        raise self.fail(node, f"unexpected {rule} in an expression")

    def _token_text(self, node: Node) -> str | None:
        return self.text(node) if node.kind == "token" else None

    def _optional(self, node: Node) -> Walk:
        """An optional, and with a marker ``+`` or ``++`` among its parts an
        elidable one (engine §3.8, §9). Its form is checked on the tree,
        where a group is still a node: one sequence, whose first primary is
        the terminal itself, ``=``-tested or not."""
        # Its choice is looked up before its markers are counted (engine §9).
        choice = self.only(node, "choice")
        markers = [kid for kid in self.kids(node) if self._token_text(kid) in ("+", "++")]
        if len(markers) >= 2:
            raise self.fail(markers[1], "an optional has one marker + or ++ at most")
        if not markers:
            return {"optional": (yield self._expr(choice))}
        form = (
            "an elidable optional begins with its terminator, a name with a capital or ~name, written directly after the marker,"
            " and joins it to nothing with | or &"
        )
        # One conjunction of one sequence, with no leading | or & either:
        # the terminator stands directly after the marker (engine §9).
        conjunctions = self.rules(choice, "conjunction")
        leading = any(self._token_text(kid) == "|" for kid in self.kids(choice)) or (
            len(conjunctions) == 1 and any(self._token_text(kid) == "&" for kid in self.kids(conjunctions[0]))
        )
        sequences = self.rules(conjunctions[0], "sequence") if len(conjunctions) == 1 and not leading else []
        primaries = self.rules(sequences[0], "primary") if len(sequences) == 1 else []
        if not primaries:
            raise self.fail(node, form)
        head = self.known_of(primaries[0], _PRIMARIES)

        def is_terminal(symbol: Node) -> bool:
            return symbol.rule == "tag" or (symbol.rule == "reference" and _is_capital(self.text(self.token(symbol))))

        if head.rule == "tested":
            if not is_terminal(self.known_of(self.only(head, "primary"), _PRIMARIES)):
                raise self.fail(node, form)
            test_node = self.only(head, "test")

        elif not is_terminal(head):
            raise self.fail(node, form)
        self.marked += 1
        expr = yield self._expr(choice)
        self.marked -= 1
        if self._token_text(markers[0]) == "++":
            return {"optional": expr, "elidable": True, "maximal": True}
        return {"optional": expr, "elidable": True}

    def _repetition(self, node: Node, whole: bool) -> Walk:
        """Braces: the item, its separator if a backslash has one, and a
        chain's direction from its marker, a ``...`` among the parts
        (engine §9)."""
        # Its choices are looked up before its markers are counted (engine
        # §9).
        kids = self.kids(node)
        choices = self.some(node, "choice")
        markers = [index for index, kid in enumerate(kids) if self._token_text(kid) == "..."]
        # Two markers are an error at the second, and a marker after the
        # separator is an error at that marker, whichever a reader meets
        # first.
        if len(markers) >= 2:
            raise self.fail(kids[markers[1]], "braces have one chain marker ... at most")
        place = {id(kid): index for index, kid in enumerate(kids)}
        second = place[id(choices[1])] if len(choices) >= 2 else len(kids)
        if markers and markers[0] > second:
            raise self.fail(kids[markers[0]], "a separator has no chain marker: ... stands after { or after the item")
        chain = None if not markers else "left" if markers[0] < place[id(choices[0])] else "right"
        # A chain is the whole expression of its alternative, as the
        # lowering of its levels needs (engine §3.3, §9).
        if chain is not None and not whole:
            raise self.fail(node, "a chain is the whole expression of its alternative: name it as a rule to use it here")
        self.braces += 1
        result: Dom = {"repeat": (yield self._expr(choices[0]))}
        if len(choices) >= 2:
            result["separator"] = yield self._expr(choices[1])
        self.braces -= 1
        if chain is not None:
            result["chain"] = chain
        return result

    def _first_of_rule(self, node: Node, name: str) -> Node | None:
        """The first node of a rule at or below a node, in the order
        written."""
        stack = [node]
        while stack:
            current = stack.pop()
            if current.kind == "rule" and current.rule == name:
                return current
            stack.extend(reversed(current.children))
        return None

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
        ends = [self.tag_of(self.token(end)) for end in self.some(node, "character", 2)[:2]]
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
        (engine §9). A named capture, the item's carrier, can have attachment
        captures in parentheses before it and after it (engine §11). An
        error of an item stands at the item, whose first part can be an
        attachment."""
        items: list[Dom] = []
        # %emits ε emits nothing, and the constituent does not count.
        empty = any(kid.kind == "token" and self.text(kid) == "ε" for kid in self.kids(node))
        for item in [] if empty else self.some(node, "emit-item"):
            target = self.symbol_part(self.only(item, "emit-target"))
            if target.kind == "rule":
                raise self.fail(item, "an inserted item is one tag, not a range or a property")
            tag_nodes = self.rules(item, "emit-tags")
            text = self.text(target)
            tags_of_target = self.tokens[target.token].tags if target.token is not None else frozenset()
            entry: Dom
            if "capture" in tags_of_target:
                entry = {"capture": text[1:]}
            elif "identifier" in tags_of_target:
                # An inserted item is one tag literal (engine §9): a bare
                # lower-case name is a rule, and a string is no tag.
                if not _is_capital(text):
                    raise self.fail(item, f"{text} names a rule; an inserted tag is a tag literal, such as ~{text}")
                entry = {"insert": text}
            elif tags_of_target & {"tag", "character", "phoneme"}:
                entry = {"insert": self.tag_of(target)}
            else:
                raise self.fail(item, "expected a capture or a tag after %emits")
            if tag_nodes:
                if "insert" in entry:
                    raise self.fail(item, "an inserted tag takes no tags of its own")
                entry["tags"] = self.tag_term(self.only(tag_nodes[0], "term"))
                if entry["tags"].get("emptySet") is True:
                    raise self.fail(item, "an emitted token's tags cannot be ∅, which no terminal reads; a rule that emits nothing says %emits ε")
            # Attachments: named captures in parentheses, carried only by a
            # named capture (engine §9, §11).
            before = [self.attachment(kid) for kid in self.rules(item, "emit-before")]
            after = [self.attachment(kid) for kid in self.rules(item, "emit-after")]
            if before or after:
                if "insert" in entry:
                    raise self.fail(item, "an inserted tag carries no attachments")
                if entry["capture"] == "":
                    raise self.fail(item, "$ carries no attachments; name a capture")
            if before:
                entry["before"] = before
            if after:
                entry["after"] = after
            items.append(entry)
        whole = [item for item in items if item.get("capture") == ""]
        if whole and len(whole) != len(items):
            raise self.fail(node, "$ is used with items other than $")
        # A capture stands once in an emission, as an item or as an attachment.
        named = [name for item in items if item.get("capture") for name in attachment_order(item)]
        if len(set(named)) != len(named):
            raise self.fail(node, "%emits lists a capture twice")
        return {"items": items}

    def attachment(self, node: Node) -> str:
        """An attachment's capture, by its name without ``$``: never ``$``
        itself (engine §9)."""
        capture = next((kid for kid in self.kids(node) if kid.kind == "token" and self.text(kid).startswith("$")), None)
        name = self.text(capture)[1:] if capture is not None else ""
        if name == "":
            raise self.fail(node, "an attachment holds a named capture, not $")
        return name

    # -- conditions

    def _condition(self, node: Node) -> Walk:
        """A condition: ``⟹`` groups to the right, and a group of the same
        connective, ``∧`` or ``∨``, is folded into the one around it, since
        parentheses make no node (engine §9)."""
        if node.rule == "implication":
            # Its any-ofs in order, and after them the implication of a
            # notation that writes one after ⟹, grouped to the right (engine
            # §9).
            items: list[Dom] = []
            for kid in self.some(node, "any-of"):
                items.append((yield self._condition(kid)))
            consequent = self.one(node, "implication")
            if consequent is not None:
                items.append((yield self._condition(consequent)))
            result = items.pop()
            while items:
                result = {"if": items.pop(), "then": result}
            return result
        if node.rule == "condition":
            return (yield self._condition(self.known_of(node, _CONDITIONS)))
        if node.rule in ("any-of", "all-of"):
            key = "any" if node.rule == "any-of" else "all"
            parts: list[Dom] = []
            for kid in self.some(node, "all-of" if node.rule == "any-of" else "condition"):
                if kid.kind == "rule":
                    # Parentheses make no node: a group of the same
                    # connective is folded into this one (engine §9), once
                    # the rule is read (flatten_groups), in one walk, since
                    # folding here would copy a list at each depth.
                    parts.append((yield self._condition(kid)))
            return parts[0] if len(parts) == 1 else {key: parts}
        return (yield self._simple_condition(node))

    def _simple_condition(self, node: Node) -> Walk:
        if node.rule == "tree-comparison":
            left = {"capture":self.text(self.token(self.only(node, "capture-reference")))[1:]}
            op = next(self.text(kid) for kid in self.kids(node) if kid.kind == "token" and self.text(kid) in ("≅", "≇"))
            operand = self.only(node, "union")
            name = self._first_of_rule(operand, "name")
            if name is not None and self._first_of_rule(operand, "pattern-literal") is None and len(self.some(operand, "intersection")) == 1:
                text = self.text(self.token(name))
                raise self.fail(name, f"tree comparison requires a pattern; write @({text}), not {text}")
            right = yield self._term(operand)
            kind, problem = term_type(right, memo=self.types)
            if problem is None:
                problem = comparison_problem(op, "span", kind)
            if problem is not None:
                raise self.fail(node, problem)
            return {"op":op, "left":left, "right":right}
        if node.rule == "comparison":
            terms = self.some(node, "union", 2)
            op = self.text(self.token(self.only(node, "comparator")))
            left = yield self._term(terms[0])
            right = yield self._term(terms[1])
            # The two sides fit the comparator (engine §10).
            left_type, problem = term_type(left, memo=self.types)
            if problem is None:
                right_type, problem = term_type(right, memo=self.types)
                if problem is None:
                    problem = comparison_problem(op, left_type, right_type)  # type: ignore[arg-type]
            if problem is not None:
                raise self.fail(node, problem)
            return {"op": op, "left": left, "right": right}
        if node.rule == "negation":
            return {"not": (yield self._condition(self.only(node, "condition")))}
        if node.rule == "presence":
            return {"captured": self.text(self.token(node))[1:]}
        if node.rule == "call":
            call = yield self._call(node)
            args = call["args"]
            if call["call"] == "initial" and len(args) == 1 and "rule" not in args[0] and "classifier" not in args[0]:
                return {"initial": args[0]}
            if (
                call["call"] not in ("matches", "begins")
                or len(args) != 2
                or "rule" not in args[1]
                or "rule" in args[0]
                or "classifier" in args[0]
            ):
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
        name = self.text(self.token(node))
        if name not in _FUNCTIONS:
            raise self.fail(node, f"an unknown function {name}()")
        if self.closed_for and name == "classify":
            raise self.fail(node, f"{self.closed_for} is a closed term, and classify depends on the features")
        if self.closed_for and name not in ("split", "tag"):
            raise self.fail(node, f"{self.closed_for} is a closed term, and {name} reads a span")
        args: list[Dom] = []
        for kid in self.rules(node, "argument"):
            args.append((yield self._term(self.only(kid, "union"), True)))

        def is_string(argument: Dom) -> bool:
            if "rule" in argument:
                return False
            kind, problem = term_type(argument, memo=self.types)
            # A constant's type is known only when the loader stitches the
            # stage.
            return problem is None and kind in ("string", "any")

        def is_rule(argument: Dom) -> bool:
            return "rule" in argument

        if name == "tags":
            ok = (len(args) == 1 and _is_span(args[0])) or (len(args) == 2 and _is_span(args[0]) and is_rule(args[1]))
        elif name in ("matches", "begins"):
            ok = len(args) == 2 and _is_span(args[0]) and is_rule(args[1])
        elif name == "split":
            ok = len(args) == 2 and all(is_string(argument) for argument in args)
        elif name == "tag":
            ok = len(args) == 1 and is_string(args[0])
        elif name == "classify":
            ok = len(args) == 2 and is_string(args[0]) and is_rule(args[1])
        else:
            ok = len(args) == 1 and _is_span(args[0])
        # A rule stands only as the second argument.
        if not ok or any(is_rule(argument) and index != 1 for index, argument in enumerate(args)):
            raise self.fail(node, f"{name}() takes {_SIGNATURES[name]}")
        # The second argument of classify names a classifier, not a rule
        # (engine §9).
        if name == "classify":
            return {"call": name, "args": [args[0], {"classifier": args[1]["rule"]}]}
        # An empty delimiter or a tag's name that the reader sees (engine §9).
        seen = literal_call_problem(name, args)
        if seen is not None:
            raise self.fail(node, seen)
        return {"call": name, "args": args}

    def _joined(self, node: Node, items: list[Dom], operator: str) -> None:
        """Sets joined by an operator are of one kind (engine §10); the
        error stands at the construct that joins them."""
        types = []
        for item in items:
            kind, problem = term_type(item, memo=self.types)
            if problem is not None:
                raise self.fail(node, problem)
            types.append(kind)
        _, problem = joined_type(types, operator)  # type: ignore[arg-type]
        if problem is not None:
            raise self.fail(node, problem)

    @staticmethod
    def _pattern_node(children: Dom) -> Dom:
        return children["node"] if "node" in children else {"children":children}

    def _pattern(self, node: Node) -> Walk:
        kind = node.rule
        children: list[Node] = []
        if kind == "pattern-union":
            children = self.some(node, "pattern-intersection")
        elif kind == "pattern-intersection":
            children = self.some(node, "pattern-sequence")
        elif kind == "pattern-sequence":
            children = self.some(node, "pattern-item")
        elif kind == "pattern-item":
            children = [kid for kid in self.kids(node) if kid.kind != "token"]
        elif kind in ("pattern-brackets", "pattern-repeat"):
            children = self.some(node, "pattern-union")
        elif kind == "pattern-path":
            children = self.some(node, "pattern-atom")
        elif kind == "pattern-atom":
            first = self.kids(node)[0]
            if first.kind == "token" and self.text(first) == "(":
                children = self.some(node, "pattern-union")
            elif first.rule == "pattern-literal":
                children = self.some(first, "pattern-union")
        else:
            raise self.fail(node, f"unexpected {kind} in a pattern")
        parts: list[Dom] = []
        for child in children:
            parts.append((yield self._pattern(child)))
        result: Dom
        if kind in ("pattern-union", "pattern-intersection"):
            if len(parts) == 1:
                result = parts[0]
            else:
                pattern = self._pattern_node(parts[0])
                ops = [self.text(kid) for kid in self.kids(node) if kid.kind == "token"]
                for i, part in enumerate(parts[1:]):
                    op = "intersection" if kind == "pattern-intersection" else "difference" if i < len(ops) and ops[i] == "∖" else "union"
                    pattern = {op:[pattern, self._pattern_node(part)]}
                    problem = pattern_problem(pattern)
                    if problem is not None:
                        raise self.fail(node, problem)
                result = {"node":pattern}
        elif kind == "pattern-sequence":
            flat: list[Dom] = []
            for part in parts:
                flat.extend(part["sequence"] if "sequence" in part else [part])
            result = flat[0] if len(flat) == 1 else {"sequence":flat}
        elif kind == "pattern-item":
            result = parts[0] if parts else {"siblings":True}
        elif kind == "pattern-atom":
            first = self.kids(node)[0]
            if parts:
                result = {"node":self._pattern_node(parts[0])} if first.rule == "pattern-literal" else parts[0]
            elif first.kind == "token":
                name = self.text(first)
                pattern = {"terminal" if _is_capital(name) else "name":name, "at":list(self.position(first))}
                test = self.one(node, "test")
                if test is not None:
                    if not _is_capital(name):
                        raise self.fail(test, "a pattern test requires one terminal atom")
                    op = "".join(self.text(kid) for kid in self.kids(test) if kid.kind == "token")
                    operand = self.only(test, "test-operand")
                    if self._first_of_rule(operand, "pattern-literal") is not None:
                        raise self.fail(operand, "a symbol test cannot read a pattern")
                    before = self.closed_for
                    self.closed_for = "a test's operand"
                    value = yield self._term(operand)
                    self.closed_for = before
                    value_type, problem = term_type(value, memo=self.types)
                    if problem is None:
                        problem = test_type_problem(op, value_type)
                    if problem is not None:
                        raise self.fail(operand, problem)
                    if is_sound_test(op) and "string" in value:
                        problem = sound_problem(value["string"], self.unicode)
                        if problem is not None:
                            raise self.fail(operand, problem)
                    pattern = {"test":op, "value":value, "expr":pattern}
                result = {"node":pattern}
            elif first.rule == "constant-reference":
                result = {"node":{"constant":self.text(self.token(first))[1:], "at":list(self.position(first))}}
            else:
                raise self.fail(node, "a malformed pattern atom")
        elif kind == "pattern-brackets":
            result = {"optional":parts[0]}
        elif kind == "pattern-repeat":
            result = {"repeat":parts[0]}
            if len(parts) == 2:
                result["separator"] = parts[1]
        else:
            # The direct operator token can follow the named atom.
            operator = self.text(self.token(node))
            path = {"⋮":"descendant", "⋰":"first", "⋱":"last"}[operator]
            result = {"node":{"path":path, "pattern":self._pattern_node(parts[0])}}
        problem = pattern_problem(self._pattern_node(result))
        if problem is not None:
            raise self.fail(node, problem)
        return result

    def _term(self, node: Node, argument: bool = False) -> Walk:
        """A term; ``argument`` says it is a function's argument, where a
        span or a rule may stand."""
        rule = node.rule
        if rule == "pattern-literal":
            children = yield self._pattern(self.only(node, "pattern-union"))
            return {"pattern":self._pattern_node(children)}
        if rule in ("test-operand", "term-atom"):
            # A test's operand is one term, as a term-atom reads it.
            return (yield self._term(self.known_of(node, _ATOMS), argument))
        if rule == "term":
            return (yield self._term(self.known_of(node, _TERMS), argument))
        if rule == "guarded-term":
            if self.closed_for:
                raise self.fail(node, f"{self.closed_for} is a closed term, and holds no guarded term")
            # Its any-ofs, each guarding the rest, and then its union, or the
            # term of a notation that writes one after ⟹ (engine §9). The
            # reader has checked each comparison of a condition, so a
            # condition's terms agree; the term guarded last must be a tag
            # set, an error at its guard.
            guards = self.some(node, "any-of")
            conditions: list[Dom] = []
            for guard in guards:
                conditions.append((yield self._condition(guard)))
            last = self.one(node, "union") or self.only(node, "term")
            guarded = yield self._term(last)
            kind, problem = term_type(guarded, memo=self.types)
            if problem is None:
                problem = expected_problem(kind, "tags")  # type: ignore[arg-type]
            if problem is not None:
                raise self.fail(guards[-1], problem)
            for condition in reversed(conditions):
                guarded = {"if": condition, "then": guarded}
            return guarded
        if rule == "union":
            # Parts joined by ∪ and ∖ group from the left: a run joined by ∪
            # is one union, and each ∖ takes what stands before it (engine
            # §9). A leading ∪ is a separator, not an operator.
            kids = self.kids(node)
            parts = self.some(node, "intersection")
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
            parts = self.some(node, "term-atom")
            if len(parts) == 1:
                return (yield self._term(parts[0], argument))
            items = []
            for part in parts:
                items.append((yield self._term(part)))
            self._joined(node, items, "∩")
            return {"intersection": items}
        if rule == "string":
            return {"string": self.decode(self.token(node))}
        if rule in ("tag", "character", "phoneme"):
            return {"tag": self.tag_of(self.token(node))}
        if rule == "range":
            return {"range": self.range_of(node)}
        if rule == "property":
            raise self.fail(node, "a property is not a tag set, and stands only as a terminal in a body")
        if rule == "name":
            # A bare name is a tag literal if it begins with a capital, and
            # otherwise a rule, which only a function's argument names.
            name = self.text(self.token(node))
            if _is_capital(name):
                return {"tag": name}
            if argument:
                return {"rule": name}
            raise self.fail(node, f"{name} names a rule, which is not a value; ~{name} is the tag")
        if rule == "empty-set":
            return {"emptySet": True}
        if rule == "capture-reference":
            capture = self.text(self.token(node))[1:]
            if self.closed_for:
                raise self.fail(node, f"{self.closed_for} is a closed term, and holds no capture")
            if not argument:
                raise self.fail(node, f"a span is not a value: tags(${capture}) is the tag set of ${capture}")
            return {"capture": capture}
        if rule == "constant-reference":
            return {"const": self.text(self.token(node))[1:], "at": list(self.position(node))}
        if rule == "call":
            call = yield self._call(node)
            # A span is not a value: the error stands at the span (engine §9).
            if not argument and call["call"] in _SPAN_FUNCTIONS:
                raise self.fail(node, f"{call['call']}() gives a span, which is not a value")
            if call["call"] in ("matches", "begins", "initial"):
                raise self.fail(node, f"{call['call']}() is a condition, not a term")
            return call
        raise self.fail(node, f"unexpected {rule} in a term")


def flatten_groups(root: Any) -> None:
    """Folds each ``any`` that stands directly in an ``any``, and each
    ``all`` in an ``all``, into the one around it, in place: a group in
    parentheses of the same connective is part of the one around it (engine
    §9). One walk, with a list for a stack, that gathers each folded list
    once."""
    stack: list[Any] = [root]
    while stack:
        current = stack.pop()
        if isinstance(current, list):
            stack.extend(current)
            continue
        if not isinstance(current, dict):
            continue
        for key in ("any", "all"):
            items = current.get(key)
            if not isinstance(items, list):
                continue
            joined: list[Any] = []
            pending = list(reversed(items))
            while pending:
                item = pending.pop()
                inner = item.get(key) if isinstance(item, dict) else None
                if isinstance(inner, list):
                    pending.extend(reversed(inner))
                else:
                    joined.append(item)
            current[key] = joined
        stack.extend(value for value in current.values() if isinstance(value, (dict, list)))


def operand_problem(name: str, kinds: list[str]) -> str | None:
    """What is wrong with a directive's operands, each ``name`` or
    ``class``, a bare name lower case or with a capital, ``string``,
    ``tag``, ``phoneme`` or ``character``, or ``range`` or ``property``, or
    None (engine §9)."""
    names = all(kind in ("name", "class") for kind in kinds)

    if name in ("stage", "extend-stage", "redefine-stage"):
        return None if len(kinds) == 1 and names else f"%{name} takes one name"
    if name == "include":
        return None if kinds == ["string"] else "%include takes one string"
    if name == "features":
        return None if kinds and names else "%features takes one or more names"
    return None if names else f"%{name} takes names only"
