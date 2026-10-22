"""From the notation's document tree to a grammar DOM (engine §9)."""

from __future__ import annotations

import re
from typing import Any

from ._clauses import attachment_order, definition_problem, duplicate_captures, deferred_emission_problem, rule_has_ranked
from ._errors import GencmuError
from ._markdown import GrammarText
from ._model import Node, Token
from ._strings import ENGINE_TAGS, USER_NAME, scalar, lit_occurrences, literal_string
from ._trampoline import Walk, run
from ._patterns import pattern_problem
from ._types import (
    comparison_problem,
    method_shape_problem,
    method_type,
    Memo as TypeMemo,
    constant_value_type,
    expected_problem,
    is_value_test,
    joined_type,
    tag_term_problem,
    term_type,
    test_type_problem,
)
from ._validate import (
    CAPTURE_NAME,
    CLASSIFIER_NAME,
    FORMAT,
    Marks,
    range_problem,
    term_reads_own_tags,
)

Dom = dict[str, Any]

_MAPPED = frozenset("""directive argument-word argument-string argument-tag argument-term rule definer rule-flags rule-flag rule-name body headed-body alternative ranked-alternative ranked-choice guard alternative-tags
choice conjunction sequence primary repetition reference string-terminal string tag wildcard name tested tag-test tag-requirement value-test test test-operand capture
 group optional empty tags-clause value-clause image-clause recipe recipe-atom conditions-clause emits-clause erased-clause emit-item emit-target emit-tags emit-before
emit-after implication any-of all-of condition comparison comparator tree-comparator negation presence method method-receiver method-selector method-name arguments argument term guarded-term
union intersection concatenation term-atom tag-run string-run integer empty-set capture-reference range constant-definition constant-definer
constant-reference classifier classifier-name classifier-entry classifier-key classifier-operator classifier-class
implication-declaration tree-comparison pattern-literal pattern-union pattern-intersection pattern-sequence pattern-item pattern-atom pattern-brackets pattern-repeat pattern-path pattern-separator""".split())
_PRIMARIES = frozenset(("reference", "tag", "string-terminal", "wildcard", "range", "tested", "capture", "group", "optional", "repetition", "empty", "constant-reference"))
_CONDITIONS = frozenset(("tree-comparison", "comparison", "method", "negation", "presence", "implication"))
_TERMS = frozenset(("union", "guarded-term"))
_ATOMS = frozenset(("string", "tag", "tag-run", "string-run", "range", "name", "empty-set", "term", "union", "guarded-term", "method", "capture-reference", "constant-reference", "pattern-literal"))
_ITEMS = frozenset(("directive", "rule", "constant-definition", "classifier", "implication-declaration"))
_SYMBOLS = frozenset(("reference", "tag", "string-terminal", "wildcard", "range", "constant-reference"))
_DEFINERS = {"%rule": "define", "%redefine-rule": "redefine", "%extend-rule": "extend"}


def _is_span(dom: Any) -> bool:
    return isinstance(dom, dict) and term_type(dom)[0] in ("capture", "span", "restored")


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

    def __init__(self, tokens: list[Token], grammar_text: GrammarText, document: str, unicode: Marks, defer_emission: bool = False) -> None:
        self.defer_emission = defer_emission
        self.deferred_emissions = []
        self.tokens = tokens
        self.grammar_text = grammar_text
        self.document = document
        # The configured categories control canonical terminal spellings.
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
        self.recipe_context = False
        self.feature_context = False
        self.engine_nodes = {}
        self.boundary_nodes = {}

    # -- positions and errors

    def first_token(self, node: Node) -> int | None:
        pending = [node]
        while pending:
            current = pending.pop()
            if current.kind == "token":
                return current.token
            pending.extend(reversed(current.children))
        return None

    def position(self, node: Node) -> tuple[int, int]:
        index = self.first_token(node)
        if index is None:
            index = node.span[0]
        if index >= len(self.tokens):
            return self.grammar_text.position(self.tokens[-1].source[1] if self.tokens else 0)
        return self.grammar_text.position(self.tokens[index].source[0])

    def fail(self, node: Node, message: str) -> GencmuError:
        line, column = self.position(node)
        return GencmuError(message, document=self.document, line=line, column=column, code="ranked-choice-syntax" if node.rule == "ranked-choice" else None)

    def source_text(self, node: Node) -> str:
        assert node.kind == "token" and node.token is not None
        return self.tokens[node.token].text

    def token_value(self, node: Node) -> str:
        assert node.kind == "token" and node.token is not None
        return self.tokens[node.token].value

    def operator(self, node: Node) -> str:
        value = self.token_value(node)
        return {"≠": "≠", "∉": "∉", "⊈": "⊈", "≇": "≇"}.get(value, value)

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
        dom = {
            "format": FORMAT,
            "rules": rules,
            "directives": directives,
            "constants": constants,
            "classifiers": classifiers,
            "implications": implications,
        }
        flatten_groups(dom)
        return dom

    def classifier(self, node: Node) -> Dom:
        """A ``%classifier`` item: its name, which begins with a lower-case
        letter, and its entries (engine §2, §9)."""
        name_node = self.only(node, "classifier-name")
        name = self.token_value(self.token(name_node))
        if not CLASSIFIER_NAME.fullmatch(name):
            raise self.fail(name_node, f"{name} begins with a capital, so it is a tag; a classifier's name begins with a lower-case letter")
        entries = [self.entry(entry) for entry in self.rules(node, "classifier-entry")]
        return {"name": name, "entries": entries, "at": list(self.position(node))}

    def entry(self, node: Node) -> Dom:
        """An entry of a classifier: gates, exact keys, ``∈`` or ``∉``,
        and a class (engine §2, §9)."""
        guards: list[Dom] = []
        keys: list[Dom] = []
        for guard in self.rules(node, "guard"):
            value = self.guard(guard)
            if value["kind"] != "gate":
                raise self.fail(guard, "a classifier entry accepts gates only")
            guards.append(value)
        for key_node in self.some(node, "classifier-key"):
            keys.append(self.value(self.known_of(key_node, frozenset(("string", "constant-reference")))))
        op = self.operator(self.token(self.only(node, "classifier-operator")))
        class_node = self.only(node, "classifier-class")
        name = self.token_value(self.token(class_node))
        if USER_NAME.fullmatch(name) is None or not "A" <= name[-1] <= "Z":
            raise self.fail(class_node, "a class starts and ends with an uppercase ASCII letter")
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
        keyword = self.token_value(self.token(self.only(node, "constant-definer")))
        name_node = self.only(node, "constant-reference")
        name = self.token_value(self.token(name_node))[1:]
        if USER_NAME.fullmatch(name) is None:
            raise self.fail(name_node, "a constant declaration requires a user name")
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
        name = self.token_value(self.token(node))[1:]
        operands = [kid for kid in self.kids(node) if kid.kind == "rule" and kid.rule in ("argument-word", "argument-string", "argument-tag", "argument-term")]
        problem = operand_problem(name, [self.operand_kind(kid) for kid in operands])
        if problem:
            raise self.fail(node, problem)
        args = [self.token_value(self.token(kid)) if kid.rule == "argument-word" else self.source_text(self.token(kid))[1:-1] for kid in operands]
        if name in ("stage", "extend-stage", "redefine-stage") and not CLASSIFIER_NAME.fullmatch(args[0]):
            raise self.fail(node, "a stage name starts lowercase")
        if name == "features" and any(re.fullmatch(r"[A-Za-z][A-Za-z0-9-]*", arg) is None for arg in args):
            raise self.fail(node, "invalid feature name")
        if name == "ambiguity-resolution" and args not in (["greedy"], ["lazy"], ["late-elision"], ["greedy", "elision-only"], ["lazy", "elision-only"], ["late-elision", "elision-only"]):
            raise self.fail(node, "invalid ambiguity resolution operands")
        directive = {"name": name, "args": args, "at": list(self.position(node))}
        clause = self.one(node, "conditions-clause")
        if clause is not None:
            if name != "features":
                raise self.fail(node, "only %features accepts conditions")
            self.feature_context = True
            try:
                directive["conditions"] = [run(self._condition(item)) for item in self.some(clause, "implication")]
            except GencmuError as error:
                raise self.fail(node, error.message) from error
            finally:
                self.feature_context = False
        return directive

    def operand_kind(self, node: Node) -> str:
        """The kind of a directive's operand: ``name`` or ``class`` for a
        bare name, lowercase or with a capital, or ``string``
        (engine §9)."""
        if node.rule == "argument-word":
            return "class" if _is_capital(self.token_value(self.token(node))) else "name"
        if node.rule == "argument-string":
            return "string"
        return "invalid"

    def guard(self, node: Node) -> Dom:
        text = self.token_value(self.token(node))
        match = re.fullmatch(r"(¬?)([A-Za-z][A-Za-z0-9-]*)([?!])", text)
        if match is None or match[1] and match[3] == "!":
            raise self.fail(node, "invalid guard")
        return {"feature": match[2], "kind": "gate" if match[3] == "?" else "warning", "negated": bool(match[1])}

    def clauses(self, node: Node, tag_name: str, own: bool = False) -> Dom:
        result = {}
        tags = self.one(node, tag_name)
        if tags is not None:
            result["tags"] = self.own_tags(tags) if own else self.tag_term(self.only(tags, "term"))
        for channel in ("value", "image"):
            clause = self.one(node, channel + "-clause")
            if clause is not None:
                result[channel] = self.recipe(self.only(clause, "recipe"))
        return result

    def recipe(self, node: Node) -> Dom:
        atoms = []
        for atom in self.some(node, "recipe-atom"):
            if atoms:
                raise self.fail(atom, "juxtaposed recipe strings require ++, use ++ between string atoms")
            if any(t.value in ("(", ")") for t in self.tokens[atom.span[0]:atom.span[1]]):
                raise self.fail(atom, "a recipe atom accepts no grouping or arguments")
            if any(t.value in ("∪", "∩", "∖", "⟹") for t in self.tokens[atom.span[0]:atom.span[1]]):
                raise self.fail(atom, "a recipe atom accepts no set operator")
            before = self.recipe_context
            self.recipe_context = True
            try:
                value = self.value(self.only(atom, "term"))
            finally:
                self.recipe_context = before
            values = value.get("concat", [value])
            if any("union" in part for part in values):
                raise self.fail(atom, "juxtaposed recipe strings require ++, use ++ between string atoms")
            for value in values:
                if "method" in value:
                    receiver = value["receiver"]
                    emitted = receiver.get("method") == "emitted" and receiver.get("args") == [] and set(receiver.get("receiver", {})) == {"capture"}
                    if value["args"] or not (value["method"] in ("value", "image", "source-text", "decomposed-source-text", "verbatim-text") and set(receiver) == {"capture"}
                        or value["method"] in ("value", "image") and emitted):
                        raise self.fail(atom, "invalid recipe method chain")
                elif "string" not in value and "const" not in value:
                    raise self.fail(atom, "a recipe atom requires a string")
                atoms.append(value)
        from ._recipes import Recipe
        return Recipe(atoms, self.position(node))

    def rule(self, node: Node) -> Dom:
        """A definition: its keyword, its name, its alternatives and its
        clauses, checked as a whole once it is read (engine §9)."""
        op = _DEFINERS.get(self.token_value(self.token(self.only(node, "definer"))), "define")
        name_node = self.only(node, "rule-name")
        name = self.token_value(self.token(name_node))
        if not self.unicode.is_emoji_name(name) and CLASSIFIER_NAME.fullmatch(name) is None:
            raise self.fail(name_node, "a rule name starts with a lowercase letter or uses one eligible emoji")
        flags: list[str] = []
        flag_list = self.one(node, "rule-flags")
        if flag_list is not None:
            if op == "extend":
                raise self.fail(flag_list, "%extend-rule accepts no flags")
            for flag in self.some(flag_list, "rule-flag"):
                value = self.token_value(self.token(flag))
                if value not in ("leftmost-longest", "fewest"):
                    raise self.fail(flag, f"unknown rule flag {value}")
                if value in flags:
                    raise self.fail(flag, f"duplicate rule flag {value}")
                if flags:
                    raise self.fail(flag, "two different rule flags are not allowed")
                flags.append(value)
        header = self.clauses(node, "tags-clause", True)
        body = self.one(node, "body") or self.only(node, "headed-body")
        ranked = self.one(body, "ranked-alternative")
        alternatives = [self.alternative(kid) for kid in ([ranked] if ranked is not None else self.some(body, "alternative"))]
        conditions_node = self.one(node, "conditions-clause")
        conditions = [run(self._condition(item)) for item in self.some(conditions_node, "implication")] if conditions_node else []
        emits_node = self.one(node, "emits-clause")
        dom = {"name": name, "op": op, "flags": flags, **header, "alternatives": alternatives}
        if emits_node is not None:
            dom["emit"] = self.emission(emits_node)
        dom["conditions"] = conditions
        if self.one(node, "erased-clause") is not None:
            dom["erased"] = True
        dom["at"] = list(self.position(node))
        flatten_groups(dom)
        from ._boundary import problem as boundary_problem
        boundary = boundary_problem(dom)
        if boundary is not None:
            raise self.fail(self.boundary_nodes.get(id(boundary[1]), node), boundary[0])
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
        guards = [self.guard(guard) for guard in self.rules(node, "guard")]
        expr = run(self._expr(self.only(node, "ranked-choice" if node.rule == "ranked-alternative" else "conjunction"), True))
        # A name stands at most once in each production, gates aside: the
        # error stands at the second capture that such a production reads,
        # the first in the text where there are several (engine §3.5, §9).
        twice = [self.capture_nodes[id(capture)] for capture in duplicate_captures(expr)]
        if twice:
            first = min(twice, key=lambda capture: self.first_token(capture) or 0)
            name = self.token_value(self.token(first))[1:]
            raise self.fail(first, f"the capture ${name} is read twice by one production of the alternative")
        return {"guards": guards, "expr": expr, **self.clauses(node, "alternative-tags", True)}

    def own_tags(self, node: Node) -> Dom:
        """A rule's or an alternative's tag term, which may not read the tags
        it defines (engine §9)."""
        tags = self.tag_term(self.only(node, "term"))
        if term_reads_own_tags(tags):
            raise self.fail(node, "a constituent's tags cannot be made of its own: $.tags or $.classes")
        return tags

    def tag_term(self, node: Node) -> Dom:
        """A whole term that must be a tag set: a constituent's or an item's
        tags (engine §10). The error stands at the term."""
        term = self.value(node)
        problem = tag_term_problem(term, memo=self.types)
        if problem is not None:
            raise self.fail(node, problem)
        retained = lit_occurrences(term)
        if retained:
            found = [self.engine_nodes[id(t)] for t in retained if id(t) in self.engine_nodes]
            raise self.fail(min(found, key=lambda n: self.first_token(n) or 0) if found else node, "a tag clause cannot introduce engine tags")
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
            return {"ref": self.token_value(self.token(node))}
        if rule == "tag":
            return {"ref": self.tag_of(self.token(node))}
        if rule == "string-terminal":
            value = self.known_of(node, frozenset(("string", "constant-reference")))
            return {"literal": self.value(value)}
        if rule == "wildcard":
            self.token(node)
            return {"wildcard": True}
        if rule == "range":
            return {"range": self.range_of(node)}
        if rule == "tested":
            tests = [kid for kid in self.kids(node) if kid.rule in ("tag-test", "value-test")]
            if not tests:
                raise self.lacks(node, "tag-test or value-test")
            symbol = self.test_base(node)
            self.test_order(tests, symbol.rule in _SYMBOLS)
            expr = yield self._expr(symbol)
            return self.wrap_tests(expr, tests)
        if rule == "capture":
            # Its place, its name and its symbol, in that order, before what
            # it wraps (engine §9).
            if self.braces:
                raise self.fail(node, "a capture cannot stand inside braces, whose parts repeat: name the list as a rule, and capture that")
            if self.marked:
                raise self.fail(node, "a capture cannot stand inside an elidable optional, which elision restores as one unit")
            name = self.token_value(self.token(node))[1:]
            wrapped = self.only(node, "primary")
            if not name:
                raise self.fail(node, "$ is the whole constituent and wraps nothing")
            if not CAPTURE_NAME.fullmatch(name):
                raise self.fail(node, f"the capture ${name} has a capital; a capture's name is all lower case")
            inner = self.known_of(wrapped, _PRIMARIES)
            base = inner
            if base.rule == "tested":
                base = self.test_base(base)
            if base.rule not in _SYMBOLS:
                raise self.fail(node, f"the capture ${name} must wrap one reference or terminal, tested or not")
            capture = {"capture": name, "expr": (yield self._expr(inner))}
            self.capture_nodes[id(capture)] = node
            return capture
        if rule == "constant-reference":
            return {"literal": self.value(node)}
        if rule == "group":
            return (yield self._expr(self.only(node, "choice")))
        if rule == "optional":
            return (yield self._optional(node))
        if rule == "repetition":
            return (yield self._repetition(node, whole))
        if rule == "empty":
            return {"empty": True}
        raise self.fail(node, f"unexpected {rule} in an expression")

    def _token_value(self, node: Node) -> str | None:
        return self.token_value(node) if node.kind == "token" else None

    def _optional(self, node: Node) -> Walk:
        """An optional, and with a marker ``+`` among its parts an
        elidable one (engine §3.8, §9). Its form is checked on the tree,
        where a group is still a node: one sequence, whose first primary is
        the terminal itself, ``=``-tested or not."""
        # Its choice is looked up before its markers are counted (engine §9).
        choice = self.only(node, "choice")
        markers = [kid for kid in self.kids(node) if self._token_value(kid) == "+"]
        if len(markers) >= 2:
            raise self.fail(markers[1], "an optional has one marker + at most")
        if not markers:
            return {"optional": (yield self._expr(choice))}
        form = (
            "an elidable optional begins with its terminator, a name with a capital or ~name, written directly after the marker,"
            " and joins it to nothing with | or &"
        )
        # One conjunction of one sequence, with no leading | or & either:
        # the terminator stands directly after the marker (engine §9).
        conjunctions = self.rules(choice, "conjunction")
        leading = any(self._token_value(kid) == "|" for kid in self.kids(choice)) or (
            len(conjunctions) == 1 and any(self._token_value(kid) == "&" for kid in self.kids(conjunctions[0]))
        )
        sequences = self.rules(conjunctions[0], "sequence") if len(conjunctions) == 1 and not leading else []
        primaries = self.rules(sequences[0], "primary") if len(sequences) == 1 else []
        if not primaries:
            raise self.fail(node, form)
        head = self.known_of(primaries[0], _PRIMARIES)

        def is_terminal(symbol: Node) -> bool:
            return symbol.rule in ("tag", "reference") and USER_NAME.fullmatch(self.token_value(self.token(symbol))) is not None

        if head.rule == "tested":
            if not is_terminal(self.test_base(head)):
                raise self.fail(node, form)

        elif not is_terminal(head):
            raise self.fail(node, form)
        self.marked += 1
        expr = yield self._expr(choice)
        self.marked -= 1
        return {"optional": expr, "elidable": True}

    def _repetition(self, node: Node, whole: bool) -> Walk:
        """Braces: the item, its separator if a backslash has one, and a
        chain's direction from its marker, a ``...`` among the parts
        (engine §9)."""
        # Its choices are looked up before its markers are counted (engine
        # §9).
        kids = self.kids(node)
        choices = self.some(node, "choice")
        markers = [index for index, kid in enumerate(kids) if self._token_value(kid) == "..."]
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

    def decode(self, token: Node) -> Dom:
        return {"string": self.token_value(token)[1:-1]}

    def tag_of(self, token: Node) -> str:
        name = self.token_value(token)
        if not (USER_NAME.fullmatch(name) or name in ENGINE_TAGS):
            raise self.fail(token, "invalid tag name")
        return name

    def range_of(self, node: Node) -> list[Dom]:
        parts = [kid for kid in self.kids(node) if kid.rule in ("string", "constant-reference")]
        if len(parts) < 2:
            raise self.lacks(node, "two string operands")
        ends = [self.value(end) for end in parts[:2]]
        problem = range_problem(ends, self.unicode)
        if problem:
            raise self.fail(node, problem)
        return ends

    def test_base(self, node: Node) -> Node:
        primary = self.one(node, "primary")
        if primary:
            return self.known_of(primary, _PRIMARIES)
        found = next((kid for kid in self.kids(node) if kid.kind == "rule" and kid.rule in _PRIMARIES - {"tested"}), None)
        if found is None:
            raise self.lacks(node, "base symbol")
        return found

    def test_order(self, tests: list[Node], valid: bool) -> None:
        seen = set()
        for test in tests:
            if not valid or test.rule in seen or test.rule == "tag-test" and "value-test" in seen:
                raise self.fail(test, "invalid test target or test order")
            seen.add(test.rule)

    def wrap_tests(self, expr: Dom, tests: list[Node]) -> Dom:
        for test in tests:
            if test.rule == "tag-test":
                requirements = []
                for requirement in self.rules(test, "tag-requirement"):
                    negated = any(self._token_value(kid) == "¬" for kid in self.kids(requirement))
                    operand = self.only(requirement, "test-operand")
                    base = self.known_of(operand, _ATOMS)
                    if base.rule not in ("tag", "name", "constant-reference"):
                        raise self.fail(operand, "a tag test requires a tag or tag-set constant")
                    value = self.value(base)
                    if "tag" not in value and "const" not in value:
                        raise self.fail(operand, "a tag test requires a tag or tag-set constant")
                    problem = expected_problem(term_type(value, memo=self.types)[0], "tags")
                    if problem:
                        raise self.fail(operand, problem)
                    requirements.append({"negated": negated, "value": value})
                expr = {"test": "tags", "requirements": requirements, "expr": expr}
            else:
                op = self.operator(self.token(self.only(test, "test")))
                operand = self.only(test, "test-operand")
                base = self.known_of(operand, _ATOMS)
                if base.rule not in ("string", "constant-reference"):
                    raise self.fail(operand, "a value test requires a string or string constant")
                expr = {"test": op, "value": self.value(base), "expr": expr}
        return expr

    def emission(self, node: Node) -> Dom:
        items = []
        for item in self.rules(node, "emit-item"):
            target = self.only(item, "emit-target")
            token = self.token(target)
            text = self.token_value(token)
            if text == "ε":
                entry = {"insert": True}
            elif text.startswith("$") and (text == "$" or CAPTURE_NAME.fullmatch(text[1:])):
                entry = {"capture": text[1:]}
            else:
                raise self.fail(item, "an emission target requires a capture or ε")
            before = [name for part in self.rules(item, "emit-before") for name in self.attachments(part)]
            after = [name for part in self.rules(item, "emit-after") for name in self.attachments(part)]
            if (before or after) and not entry.get("capture"):
                raise self.fail(item, "attachments require a named carrier")
            entry.update(self.clauses(item, "emit-tags"))
            if before:
                entry["before"] = before
            if after:
                entry["after"] = after
            items.append(entry)
        if not items:
            items.append({"capture": "", **self.clauses(node, "emit-tags")})
        named = [name for item in items if "capture" in item for name in attachment_order(item) if name]
        if len(named) != len(set(named)):
            raise self.fail(node, "an emission lists a capture twice")
        return {"items": items}

    def attachments(self, node: Node) -> list[str]:
        names = []
        for part in self.some(node, "capture-reference"):
            name = self.token_value(self.token(part))[1:]
            if not CAPTURE_NAME.fullmatch(name):
                raise self.fail(node, "an attachment requires a named capture")
            names.append(name)
        return names

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
            left = {"capture":self.token_value(self.token(self.only(node, "capture-reference")))[1:]}
            op = self.operator(self.token(self.only(node, "tree-comparator")))
            operand = self.only(node, "union")
            name = self._first_of_rule(operand, "name")
            if name is not None and self._first_of_rule(operand, "pattern-literal") is None and len(self.some(operand, "intersection")) == 1:
                text = self.token_value(self.token(name))
                raise self.fail(name, f"tree comparison requires a pattern; write #({text}), not {text}")
            right = yield self._term(operand)
            kind, problem = term_type(right, memo=self.types)
            if problem is None:
                problem = comparison_problem(op, "capture", kind)
            if problem is not None and not self.feature_context:
                raise self.fail(node, problem)
            return {"op":op, "left":left, "right":right}
        if node.rule == "comparison":
            terms = self.some(node, "union", 2)
            op = self.operator(self.token(self.only(node, "comparator")))
            left = yield self._term(terms[0])
            right = yield self._term(terms[1])
            # The two sides fit the comparator (engine §10).
            left_type, problem = term_type(left, memo=self.types)
            if problem is None:
                right_type, problem = term_type(right, memo=self.types)
                if problem is None:
                    problem = comparison_problem(op, left_type, right_type)  # type: ignore[arg-type]
            if problem is not None and not self.feature_context:
                raise self.fail(node, problem)
            return {"op": op, "left": left, "right": right}
        if node.rule == "negation":
            return {"not": (yield self._condition(self.only(node, "condition")))}
        if node.rule == "presence":
            return {"captured": self.token_value(self.token(node))[1:]}
        if node.rule == "method":
            method = yield self._method(node)
            if term_type(method, memo=self.types)[0] != "predicate":
                raise self.fail(node, "a condition requires a query or starts-input method")
            return method
        raise self.fail(node, f"unexpected {node.rule} in a condition")

    # -- terms

    def value(self, node: Node) -> Dom:
        return run(self._term(node))  # type: ignore[no-any-return]

    def _method(self, node: Node) -> Walk:
        receiver = yield self._term(self.only(self.only(node, "method-receiver"), "term-atom"))
        for selector in self.some(node, "method-selector"):
            name = self.token_value(self.token(self.only(selector, "method-name")))
            if self.closed_for and name not in ("split", "ngrams"):
                raise self.fail(node, f"{self.closed_for} requires a closed term")
            if not self.recipe_context and name in ("verbatim-text", "emitted"):
                raise self.fail(node, "this method is legal only in recipes")
            arguments = self.one(selector, "arguments")
            args = []
            for part in self.some(arguments, "argument") if arguments else []:
                integer = self.one(part, "integer")
                if integer is not None:
                    digits = self.token_value(self.token(integer))
                    if re.fullmatch(r"[1-9][0-9]*", digits) is None:
                        raise self.fail(integer, "an integer argument is positive without leading zeros")
                    arg = {"integer": digits}
                else:
                    arg = yield self._term(self.only(part, "term"), True)
                if name == "classify" and "rule" in arg:
                    if CLASSIFIER_NAME.fullmatch(arg["rule"]) is None:
                        raise self.fail(node, "a classifier name must start with a lowercase letter")
                    arg = {"classifier": arg["rule"]}
                if name in ("matches", "begins", "followed-by", "preceded-by") and "tag" in arg and not arg["tag"].startswith("_"):
                    arg = {"terminal": arg["tag"]}
                from ._boundary import Located
                arg = Located(arg, self.position(part))
                args.append(arg)
            if arguments is not None:
                separators = [self.token_value(child) for child in arguments.children if child.kind == "token"]
                if any(separator != ("|" if name in ("matches", "begins", "followed-by", "preceded-by") else ",") for separator in separators):
                    raise self.fail(arguments, "invalid method argument separator")
            if self.feature_context:
                problem = method_shape_problem(name, receiver, args, self.recipe_context)
                if problem:
                    raise self.fail(node, problem)
            kind, problem = term_type(receiver, memo=self.types)
            if problem is None:
                _, problem = method_type(name, kind, args, set(receiver) == {"capture"}, self.recipe_context)
            if name in ("without-elision", "without-elision-except") and set(receiver) != {"capture"}:
                call = name + ("(F)" if name == "without-elision-except" else "")
                problem = f".{name} requires a bare capture; use $x.{call}.onward"
            if problem is not None and not self.feature_context:
                raise self.fail(node, problem)
            if not self.feature_context and name == "split" and literal_string(args[0]) == "":
                raise self.fail(node, "split has an empty delimiter")
            from ._boundary import Located
            receiver = Located({"method": name, "receiver": receiver, "args": args}, self.position(node))
            self.boundary_nodes[id(receiver)] = node
            if arguments is not None:
                separators = [self.token_value(child) for child in arguments.children if child.kind == "token"]
                if any(separator != ("|" if name in ("matches", "begins", "followed-by", "preceded-by") else ",") for separator in separators):
                    raise self.fail(arguments, "invalid method argument separator")
            kind, problem = term_type(receiver, memo=self.types)
            if problem and not self.feature_context:
                raise self.fail(node, problem)
        return receiver

    def _joined(self, node: Node, items: list[Dom], operator: str) -> None:
        """Sets joined by an operator are of one kind (engine §10); the
        error stands at the construct that joins them."""
        if self.feature_context:
            return
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
        if kind == "pattern-atom":
            kids = self.kids(node)
            if not kids:
                raise self.lacks(node, "pattern atom")
            first = kids[0]
            named = first.rule in ("name", "reference") or first.kind == "token" and first.terminal in ("Lowercase-Name", "Emoji-Name")
            tests = [kid for kid in kids if kid.rule in ("tag-test", "value-test")]
            valid = first.rule in ("tag", "string-terminal", "string", "range", "wildcard", "constant-reference")
            if first.kind == "token":
                name = self.token_value(first)
                valid = USER_NAME.fullmatch(name) is not None or name in ENGINE_TAGS
            if named:
                valid = False
            # Target and order errors precede conversion of a group's or
            # nested literal's contents, just as for a tested primary.
            self.test_order(tests, valid)
            if named:
                name_token = first if first.kind == "token" else self.token(first)
                name = self.token_value(name_token)
                if not self.unicode.is_emoji_name(name) and CLASSIFIER_NAME.fullmatch(name) is None:
                    raise self.fail(name_token, "a malformed pattern rule name")
                return {"node": {"name": name, "at": list(self.position(name_token))}}
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
            if first.kind == "token" and self.token_value(first) == "(":
                children = self.some(node, "pattern-union")
            elif first.rule == "pattern-literal":
                children = [self.one(first, "pattern-union") or self.only(first, "pattern-atom")]
            elif first.rule == "pattern-union":
                children = [first]
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
                ops = [self.token_value(kid) for kid in self.kids(node) if kid.kind == "token"]
                for i, part in enumerate(parts[1:]):
                    op = "intersection" if kind == "pattern-intersection" else "difference" if i < len(ops) and ops[i] == "∖" else "union"
                    following = self._pattern_node(part)
                    pattern = {op:[*pattern.get("union", [pattern]), *following.get("union", [following])]} if op == "union" else {op:[pattern, following]}
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
            if parts:
                result = {"node":self._pattern_node(parts[0])} if first.rule == "pattern-literal" else parts[0]
            else:
                token = first if first.kind == "token" else None if first.rule in ("string-terminal", "range") else self.token(first)
                name = self.token_value(token) if token is not None else ""
                at = list(self.position(first))
                if first.rule == "constant-reference":
                    value = self.value(first)
                    pattern = {"literal": value, "at": at} if name.startswith("$_") else {"constant": value["const"], "at": at}
                elif first.rule in ("string-terminal", "string"):
                    value = self.value(first if first.rule == "string" else self.known_of(first, frozenset(("string", "constant-reference"))))
                    pattern = {"literal": value, "at": at}
                elif first.rule == "range":
                    pattern = {"range": self.range_of(first), "at": at}
                elif first.rule == "wildcard" or name == "_":
                    pattern = {"wildcard": True, "at": at}
                elif first.rule == "tag" or USER_NAME.fullmatch(name) or name.startswith("_"):
                    pattern = {"terminal": self.tag_of(token), "at": at}
                else:
                    if not self.unicode.is_emoji_name(name) and CLASSIFIER_NAME.fullmatch(name) is None:
                        raise self.fail(first, "a malformed pattern rule name")
                    pattern = {"name": name, "at": at}
                result = {"node": self.wrap_tests(pattern, tests)}
        elif kind == "pattern-brackets":
            result = {"optional":parts[0]}
        elif kind == "pattern-repeat":
            result = {"repeat":parts[0]}
            if len(parts) == 2:
                result["separator"] = parts[1]
        else:
            # The direct operator token can follow the named atom.
            operator = self.token_value(self.token(node))
            path = {"⋮":"descendant", "⋰":"first", "⋱":"last"}[operator]
            result = {"node":{"path":path, "pattern":self._pattern_node(parts[0])}}
        problem = pattern_problem(self._pattern_node(result))
        if problem is not None:
            raise self.fail(node, problem)
        return result

    def tag_run_placement(self, node: Node) -> None:
        first = self.first_token(node)
        last = node.span[1] - 1
        if first is not None:
            before = self.tokens[first - 1].value if first else None
            after = self.tokens[last + 1].value if last + 1 < len(self.tokens) else None
            if before in ("∩", "∖") or after in ("∩", "∖"):
                raise self.fail(node, "a tag run next to intersection or difference requires parentheses")

    def _term(self, node: Node, argument: bool = False) -> Walk:
        """A term; ``argument`` says it is a function's argument, where a
        span or a rule may stand."""
        rule = node.rule
        if rule == "pattern-literal":
            closed = self.closed_for
            self.closed_for = None
            try:
                children = yield self._pattern(self.one(node, "pattern-union") or self.only(node, "pattern-atom"))
            finally:
                self.closed_for = closed
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
                _, problem = joined_type([kind], "⟹")
                if kind == "pattern":
                    problem = "a guarded term requires a set"
            if problem is not None and not self.feature_context:
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
            operators = [self.token_value(kid) for kid in kids if kid.kind == "token" and self.token_value(kid) in ("∪", "∖")]
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
                    # Keep child unions shared until the completed DOM's
                    # single flattening walk. Copying a growing child here
                    # costs nested parentheses their depth times their size.
                    result = {"union": [result, following]}
                    open_union = True
            return result
        if rule == "concatenation":
            nodes = self.some(node, "term-atom")
            items = []
            for part in nodes:
                value = yield self._term(part, argument and len(nodes) == 1)
                if len(nodes) > 1:
                    kind, problem = term_type(value, memo=self.types)
                    if not self.feature_context and (problem or kind not in ("string", "any")):
                        raise self.fail(node, problem or "++ requires string operands")
                items.extend(value.get("concat", [value]))
            if len(nodes) == 1:
                return items[0] if len(items) == 1 else {"concat": items}
            return {"concat": items}
        if rule == "intersection":
            parts = self.some(node, "concatenation")
            if len(parts) == 1:
                return (yield self._term(parts[0], argument))
            items = []
            for part in parts:
                items.append((yield self._term(part)))
            self._joined(node, items, "∩")
            return {"intersection": items}
        if rule == "string":
            return self.decode(self.token(node))
        if rule in ("tag", "name"):
            name = self.token_value(self.token(node))
            if USER_NAME.fullmatch(name) or name in ENGINE_TAGS:
                value = {"tag": self.tag_of(self.token(node))}
                if name in ENGINE_TAGS:
                    if self.closed_for:
                        raise self.fail(node, "a closed declaration cannot contain an engine-tag literal")
                    self.engine_nodes[id(value)] = node
                return value
            if rule == "name" and argument:
                return {"rule": name}
            raise self.fail(node, "a lowercase name is legal only as a rule or classifier argument")
        if rule == "range":
            raise self.fail(node, "a range is a terminal, not a term")
        if rule in ("tag-run", "string-run"):
            if self.recipe_context and rule == "string-run":
                raise self.fail(node, "juxtaposed recipe strings require ++, use ++ between string atoms")
            self.tag_run_placement(node)
            return {"union": [self.value(tag) for tag in self.some(node, "string" if rule == "string-run" else "tag", 2)]}
        if rule == "empty-set":
            return {"emptySet": True}
        if rule == "capture-reference":
            capture = self.token_value(self.token(node))[1:]
            if self.closed_for:
                raise self.fail(node, f"{self.closed_for} is a closed term, and holds no capture")
            return {"capture": capture}
        if rule == "constant-reference":
            name = self.token_value(self.token(node))[1:]
            if USER_NAME.fullmatch(name) is None and scalar(name) is None:
                raise self.fail(node, "invalid scalar constant")
            return {"const": name, "at": list(self.position(node))}
        if rule == "method":
            result = yield self._method(node)
            if not argument and term_type(result, memo=self.types)[0] == "predicate":
                raise self.fail(node, "a predicate cannot stand as a value term")
            return result
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
    ``class``, a bare name lowercase or with a capital, or ``string``
    (engine §9)."""
    names = all(kind in ("name", "class") for kind in kinds)

    if name in ("stage", "extend-stage", "redefine-stage"):
        return None if len(kinds) == 1 and names else f"%{name} takes one name"
    if name == "include":
        return None if kinds == ["string"] else "%include takes one string"
    if name == "features":
        return None if kinds and names else "%features takes one or more names"
    return None if names else f"%{name} takes names only"
