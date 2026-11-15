"""From the notation's document tree to a grammar DOM (engine §9)."""

from __future__ import annotations

import re
from typing import Any

from ._boundary import hide
from ._errors import GencmuError
from ._markdown import GrammarText
from ._model import Node, Token
from ._trampoline import Walk, run
from ._template_nodes import argument_of_expression
from ._validate import (
    CLASSIFIER_NAME,
    FORMAT,
    KEY_STEPS,
    LEANS,
    Marks,
    node_at,
)

Dom = dict[str, Any]

_MAPPED = frozenset("""captured-terminator directive directive-identifier directive-string directive-terminal directive-term rule rule-keyword ranking-directive ranking-step rule-name body headed-body alternative ranked-body ranked-choice feature-gate splice error-clause warning-clause suppress-warnings-clause suppression-code alternative-tags
choice some-of sequence primary repetition rule-reference string-terminal string tag wildcard rule-or-classifier-name tested-primary tag-test tag-requirement value-test default-value value-comparator test-operand capture
 group optional empty header-tags value-clause image-clause recipe recipe-term conditions-clause emits-clause erased-clause emit-item emit-target emit-tags attachment-before
attachment-after condition any-of all-of condition-primary comparison comparator tree-comparator negation presence method-chain method-receiver method-selector parse-selector parse-argument method-name method-arguments method-argument term guarded-term set-condition union-operation intersection-operation set-atom
union intersection concatenation term-atom plain-term-atom tag-run string-run integer empty-set capture-reference range constant-definition constant-keyword
constant-reference classifier classifier-name classifier-entry classifier-key classifier-operator classifier-class
implication-declaration tree-comparison pattern-literal pattern-union pattern-intersection pattern-atom child-optional child-repetition pattern-path pattern-primary pattern-node bare-child-list child-list child-choice child-alternative child-set-operation child-intersection child-sequence child-item child-path child-primary call parameter call-argument requirement-argument target-argument body-argument symbol-argument constant-name""".split())
_PRIMARIES = frozenset(("captured-terminator", "rule-reference", "tag", "string-terminal", "wildcard", "range", "tested-primary", "capture", "group", "optional", "repetition", "empty", "constant-reference", "call", "parameter", "splice"))
_CONDITIONS = frozenset(("tree-comparison", "comparison", "method-chain", "negation", "presence", "condition", "set-condition"))
_TERMS = frozenset(("union", "guarded-term"))
_ATOMS = frozenset(("term-atom", "plain-term-atom", "string", "tag", "tag-run", "string-run", "range", "rule-or-classifier-name", "empty-set", "term", "union", "guarded-term", "method-chain", "capture-reference", "constant-reference", "pattern-literal", "call", "parameter", "splice"))
_ITEMS = frozenset(("directive", "ranking-directive", "rule", "constant-definition", "classifier", "implication-declaration"))
_SYMBOLS = frozenset(("rule-reference", "tag", "string-terminal", "wildcard", "range", "constant-reference", "call", "parameter", "splice"))
_DEFINERS = {"%rule": "define", "%redefine-rule": "redefine", "%extend-rule": "extend"}


def _is_capital(name: str) -> bool:
    """Whether a name begins with a capital, and so is a terminal and a tag
    literal (engine §2)."""
    return "A" <= name[:1] <= "Z"


class DomBuilder:
    """Reads the DOM off a document tree, rule by rule of the §9 table."""

    def __init__(self, tokens: list[Token], grammar_text: GrammarText, document: str, unicode: Marks, decode_string, defer_emission: bool = False) -> None:
        self.decode_string = decode_string
        self.defer_emission = defer_emission
        self.tokens = tokens
        self.grammar_text = grammar_text
        self.document = document
        # The configured categories control canonical terminal spellings.
        self.unicode = unicode
        self.parts_cache: dict[int, tuple[Node, list[Node]]] = {}
        # Whether the reader is inside a recipe, where juxtaposed strings
        # need ++, and the head of the elidable optional being read, with
        # its default and the default's node (engine §3.8, §9).
        self.recipe_context = False
        self.default_head = None
        self.head_default = None
        self.default_node = None

    # -- positions and errors

    def first_token(self, node: Node) -> int | None:
        pending = [node]
        while pending:
            current = pending.pop()
            if current.kind == "token":
                return current.token
            if current.kind != "elided":
                pending.extend(reversed(current.children))
        return None

    def position(self, node: Node) -> tuple[int, int]:
        index = self.first_token(node)
        if index is None:
            index = node.span[0]
        if index < 0 or index >= len(self.tokens):
            return self.grammar_text.position(self.tokens[-1].source[1] if self.tokens else 0)
        return self.grammar_text.position(self.tokens[index].source[0])

    def fail(self, node: Node, message: str) -> GencmuError:
        line, column = self.position(node)
        return GencmuError(message, document=self.document, line=line, column=column)

    def token_value(self, node: Node) -> str:
        assert node.kind == "token" and node.token is not None
        return self.tokens[node.token].value

    def operator(self, node: Node) -> str:
        value = self.token_value(node)
        return {"≠": "≠", "∉": "∉", "⊈": "⊈", "≇": "≇"}.get(value, value)

    def kids(self, node: Node) -> list[Node]:
        """A node's children, reading every unmapped rule in its place."""
        cached = self.parts_cache.get(id(node))
        if cached is not None:
            return cached[1]
        result: list[Node] = []
        self.parts_cache[id(node)] = (node, result)
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
        parts = self.kids(node)
        if parts and (parts[0].kind == "token" or parts[0].rule == "range"):
            return parts[0]
        raise self.lacks(node, "token or range")

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
            elif kid.kind == "rule" and kid.rule == "ranking-directive":
                directives.append(self.ranking_directive(kid))
            elif kid.kind == "rule" and kid.rule == "directive":
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

    def at(self, node: Node) -> list[int]:
        return list(self.position(node))

    def classifier(self, node: Node) -> Dom:
        """A ``%classifier`` item: its name and its entries (engine §2,
        §9). The validator checks the name."""
        name_node = self.only(node, "classifier-name")
        name = self.token_value(self.token(name_node))
        entries = [self.entry(entry) for entry in self.rules(node, "classifier-entry")]
        return hide({"name": name, "entries": entries, "at": self.at(node)}, self.at(name_node), "name_at")

    def entry(self, node: Node) -> Dom:
        """An entry of a classifier: gates, keys, ``∈`` or ``∉``, and a
        class (engine §2, §9)."""
        gates = [self.gate(gate) for gate in self.rules(node, "feature-gate")]
        keys = [self.value(self.known_of(key_node, frozenset(("string", "constant-reference")))) for key_node in self.some(node, "classifier-key")]
        op = self.operator(self.token(self.only(node, "classifier-operator")))
        class_node = self.only(node, "classifier-class")
        name = self.token_value(self.token(class_node))
        return hide({"gates": gates, "keys": keys, "op": op, "class": name, "at": self.at(node)}, self.at(class_node), "class_at")

    def implication(self, node: Node) -> Dom:
        """An implication, ``%implies A ⟹ B``: two terms that the validator
        holds to closed tag sets (engine §2, §9)."""
        sides: list[Dom] = []
        for side in self.some(node, "union", 2)[:2]:
            term = self.value(side)
            if isinstance(term, dict) and "at" not in term:
                term = hide(term, self.at(side))
            sides.append(term)
        return {"if": sides[0], "then": sides[1], "at": self.at(node)}

    def constant(self, node: Node) -> Dom:
        """A constant's definition: its name without ``$``, and its value
        (engine §2, §9, §10)."""
        keyword = self.token_value(self.token(self.only(node, "constant-keyword")))
        name_node = self.only(node, "constant-name")
        name = self.token_value(self.token(name_node))[1:]
        value = self.value(self.only(node, "term"))
        op = "redefine" if keyword == "%redefine-const" else "define"
        return hide({"name": name, "op": op, "value": value, "at": self.at(node)}, self.at(name_node), "name_at")

    def directive(self, node: Node) -> Dom:
        name = self.token_value(self.token(node))[1:]
        operands = [kid for kid in self.kids(node) if kid.kind == "rule" and kid.rule in ("directive-identifier", "directive-string", "directive-terminal", "directive-term")]
        problem = operand_problem(name, [self.operand_kind(kid) for kid in operands])
        if problem:
            raise self.fail(node, problem)
        args = [self.token_value(self.token(kid)) if kid.rule == "directive-identifier" else
                self.decode_string(self.tokens[self.token(kid).token], True) for kid in operands]
        directive = {"name": name, "args": args, "at": self.at(node)}
        clause = self.one(node, "conditions-clause")
        if clause is not None:
            directive["conditions"] = [run(self._condition(item)) for item in self.some(clause, "condition")]
        return directive

    def ranking_directive(self, node: Node) -> Dom:
        steps = []
        nodes = self.some(node, "ranking-step")
        for step_node in nodes:
            name = self.token_value(self.token(step_node))
            operand = next((kid for kid in self.kids(step_node) if kid.rule in ("pattern-literal", "constant-reference")), None)
            if operand is not None and name not in KEY_STEPS or operand is None and (name not in LEANS or step_node is not nodes[-1]):
                raise self.fail(node, "%ambiguity-resolution requires a pattern for each key step and no operand on a final lean")
            if operand is None:
                steps.append({"step": name})
            else:
                value = run(self._term(operand))
                steps.append(hide({"step": name, "pattern": value.get("pattern", value)}, self.at(operand)))
        return {"name": "ambiguity-resolution", "steps": steps, "at": self.at(node)}

    def operand_kind(self, node: Node) -> str:
        """The kind of a directive's operand: ``name`` or ``class`` for a
        bare name, lowercase or with a capital, or ``string``
        (engine §9)."""
        if node.rule == "directive-identifier":
            return "class" if _is_capital(self.token_value(self.token(node))) else "name"
        if node.rule == "directive-string":
            return "string"
        return "invalid"

    def gate(self, node: Node) -> Dom:
        text = self.token_value(self.token(node))
        match = re.fullmatch(r"(¬?)(?!.*--)([A-Za-z][A-Za-z0-9-]*)(\?)", text)
        if match is None:
            raise self.fail(node, "invalid feature guard")
        return hide({"feature": match[2], "kind": "gate", "negated": bool(match[1])}, self.at(node))

    def rule(self, node: Node) -> Dom:
        """A definition: its keyword, its name or head, its alternatives and
        its clauses (engine §9). The validator checks them."""
        op = _DEFINERS.get(self.token_value(self.token(self.only(node, "rule-keyword"))), "define")
        name_node = self.one(node, "rule-name")
        head_node = self.one(node, "call") if name_node is None else None
        if head_node is None and name_node is None:
            raise self.lacks(node, "rule-name")
        head = run(self._call(head_node)) if head_node is not None else None
        name_token = self.token(head_node if head_node is not None else name_node)
        name = head["call"] if head else self.token_value(name_token)
        all_params = head is not None and all("param" in arg for arg in head["args"])
        head_fields = {}
        if head:
            head_fields = {"params": [arg["param"] for arg in head["args"]]} if all_params else {"args": head["args"]}
        if any(self._token_value(kid) == "=" for kid in self.kids(node)):
            instance = run(self._call(self.only(node, "call")))
            bound = hide({"name": name, **head_fields, "op": op, "instance": instance, "conditions": [], "at": self.at(node)}, self.at(name_token), "name_at")
            if head:
                bound.has_head = True
            return bound
        header = self.clauses(node, "header-tags", True)
        body = self.one(node, "body") or self.only(node, "headed-body")
        ranked = self.one(body, "ranked-body")
        alternatives = [self.alternative(kid) for kid in ([ranked] if ranked is not None else self.some(body, "alternative"))]
        conditions_node = self.one(node, "conditions-clause")
        conditions = [run(self._condition(item)) for item in self.some(conditions_node, "condition")] if conditions_node else []
        emits_node = self.one(node, "emits-clause")
        dom = {"name": name, **head_fields, "op": op, **header, "alternatives": alternatives}
        if emits_node is not None:
            dom["emit"] = self.emission(emits_node)
        for kind in ("error", "warning"):
            diagnostic = self.one(node, kind + "-clause")
            if diagnostic is not None:
                dom[kind] = hide(self.recipe(self.only(diagnostic, "recipe")), self.at(diagnostic), "clause_at")
        suppression = self.one(node, "suppress-warnings-clause")
        if suppression is not None:
            dom["suppressWarnings"] = ["_"] if any(self._token_value(child) == "_" for child in self.kids(suppression)) else [self.token_value(self.token(code)) for code in self.some(suppression, "suppression-code")]
        dom["conditions"] = conditions
        if self.one(node, "erased-clause") is not None:
            dom["erased"] = True
        dom["at"] = self.at(node)
        dom = hide(dom, self.at(name_token), "name_at")
        if all_params:
            dom.param_ats = [arg["at"] for arg in head["args"]]
        flatten_groups(dom)
        return dom

    def parameter(self, node):
        param = self.token_value(self.token(node))[1:]
        return dict(param=param, at=self.at(node))

    def _call(self, node):
        name = self.token_value(self.token(node))
        args = []
        for argument in self.some(node, 'call-argument'):
            part = self.known_of(argument, frozenset(('requirement-argument', 'target-argument', 'body-argument', 'symbol-argument', 'term')))
            if part.rule == 'requirement-argument':
                value = dict(requirements=(yield self._read_test(part))['requirements'])
            elif part.rule == 'target-argument':
                targets = []
                for target in (k for k in self.kids(part) if k.kind == 'rule'):
                    if target.rule == 'rule-reference':
                        targets.append(hide(dict(rule=self.token_value(self.token(target))), self.at(target)))
                    elif target.rule == 'tag':
                        targets.append(hide(dict(terminal=self.tag_of(self.token(target))), self.at(target)))
                    else:
                        targets.append((yield self._call(target)) if target.rule == 'call' else self.parameter(target))
                value = dict(targets=targets)
            elif part.rule in ('body-argument', 'symbol-argument'):
                expr = yield self._expr(self.known_of(part, _PRIMARIES), True)
                value = argument_of_expression(expr)
            else:
                value = yield self._term(part, True)
            if isinstance(value, dict) and node_at(value) is None:
                value = hide(value, self.at(argument))
            args.append(value)
        return dict(call=name, args=args, at=self.at(node))

    # -- expressions

    def alternative(self, node: Node) -> Dom:
        gates = [self.gate(gate) for gate in self.rules(node, "feature-gate")]
        expr = run(self._expr(self.only(node, "ranked-choice" if node.rule == "ranked-body" else "some-of"), True))
        return hide({"gates": gates, "expr": expr, **self.clauses(node, "alternative-tags", True)}, self.at(node))

    def clauses(self, node: Node, tag_name: str, own: bool = False) -> Dom:
        result = {}
        tags = self.one(node, tag_name)
        if tags is not None:
            term = self.tag_term(self.only(tags, "term"))
            result["tags"] = hide(term, self.at(tags), "clause_at") if own else term
        for channel in ("value", "image"):
            clause = self.one(node, channel + "-clause")
            if clause is not None:
                result[channel] = self.recipe(self.only(clause, "recipe"))
        return result

    def recipe(self, node: Node) -> Dom:
        atoms = []
        for atom in self.some(node, "recipe-term"):
            if any(type(index) is not int for index in atom.span) or not 0 <= atom.span[0] <= atom.span[1] <= len(self.tokens):
                raise self.lacks(atom, "valid token span")
            if atoms:
                raise self.fail(atom, "juxtaposed recipe strings require ++. Use ++ between string atoms")
            if any(t.value in ("(", ")") for t in self.tokens[atom.span[0]:atom.span[1]]):
                raise self.fail(atom, "a recipe atom has no grouping or arguments")
            if any(t.value in ("∪", "∩", "∖", "⟹") for t in self.tokens[atom.span[0]:atom.span[1]]):
                raise self.fail(atom, "a recipe atom has no set operator")
            before = self.recipe_context
            self.recipe_context = True
            try:
                value = self.value(self.only(atom, "term"))
            finally:
                self.recipe_context = before
            values = value.get("concat", [value])
            if any("union" in part for part in values):
                raise self.fail(atom, "juxtaposed recipe strings require ++. Use ++ between string atoms")
            for value in values:
                if node_at(value) is None:
                    value = hide(value, self.at(atom))
                atoms.append(value)
        from ._recipes import Recipe
        return Recipe(atoms, self.position(node))

    def tag_term(self, node: Node) -> Dom:
        """A whole term that must be a tag set: a constituent's or an item's
        tags (engine §10). The validator checks its type."""
        return hide(self.value(node), self.at(node), "tag_term_at")

    def _expr(self, node: Node, whole: bool = False) -> Walk:
        """An expression or a primary. The validator checks its shape and
        places (engine §9.3)."""
        rule = node.rule
        if rule == 'parameter':
            return self.parameter(node)
        if rule == 'call':
            return (yield self._call(node))
        if rule == "choice":
            ranked = self.one(node, "ranked-choice")
            if ranked is not None:
                return (yield self._expr(ranked))
            items = []
            for item in self.some(node, "some-of"):
                items.append((yield self._expr(item)))
            return items[0] if len(items) == 1 else {"choice": items, "at": self.at(node)}
        if rule == "ranked-choice":
            items = []
            for item in self.some(node, "some-of", 2):
                items.append((yield self._expr(item)))
            separator = next((kid for kid in self.kids(node) if kid.kind == "token" and self.token_value(kid) == "≻"), None)
            return {"ranked": items, "at": self.at(separator if separator is not None else node)}
        if rule in ("some-of", "sequence"):
            found = self.some(node, "sequence" if rule == "some-of" else "primary")
            items = []
            for item in found:
                items.append((yield self._expr(self.known_of(item, _PRIMARIES) if rule == "sequence" else item, whole and len(found) == 1)))
            return items[0] if len(items) == 1 else {"and" if rule == "some-of" else "seq": items, "at": self.at(node)}
        if rule == "splice":
            target = self.known_of(node, frozenset(("rule-reference", "call")))
            return {"splice": (yield self._expr(target)), "at": self.at(node)}
        if rule == "rule-reference":
            return {"ref": self.token_value(self.token(node)), "at": self.at(node)}
        if rule == "tag":
            return {"ref": self.tag_of(self.token(node)), "at": self.at(node)}
        if rule == "string-terminal":
            value = self.known_of(node, frozenset(("string", "constant-reference")))
            return {"literal": (yield self._term(value)), "at": self.at(node)}
        if rule == "constant-reference":
            return {"literal": (yield self._term(node)), "at": self.at(node)}
        if rule == "wildcard":
            self.token(node)
            return {"wildcard": True, "at": self.at(node)}
        if rule == "range":
            return {"range": (yield self._range(node)), "at": self.at(node)}
        if rule == "tested-primary":
            tests = [kid for kid in self.kids(node) if kid.rule in ("tag-test", "value-test", "default-value")]
            if not tests:
                raise self.lacks(node, "test")
            # The base is converted before the test operands (engine §9.3).
            expr = yield self._expr(self.test_base(node))
            for test in tests:
                if test.rule == "default-value":
                    if node is not self.default_head:
                        raise self.fail(test, "a default stands only on an elidable optional head")
                    if self.head_default is not None:
                        raise self.fail(test, "an elidable head has one default at most")
                    operand = self.only(test, "test-operand")
                    inner = self.known_of(operand, _ATOMS)
                    if inner.rule not in ("string", "constant-reference", "parameter"):
                        raise self.fail(operand, "a default requires one string")
                    self.head_default = hide((yield self._term(inner)), self.at(test), "default_at")
                    self.default_node = test
                else:
                    expr = {**(yield self._read_test(test)), "expr": expr, "at": self.at(test)}
            return expr
        if rule in ("capture", "captured-terminator"):
            name = self.token_value(self.token(node))[1:]
            inner = self.known_of(self.only(node, "primary"), _PRIMARIES)
            return {"capture": name, "expr": (yield self._expr(inner)), "at": self.at(node)}
        if rule == "group":
            return hide((yield self._expr(self.only(node, "choice"))), True, "grouped")
        if rule == "optional":
            return (yield self._optional(node))
        if rule == "repetition":
            return (yield self._repetition(node))
        if rule == "empty":
            return {"empty": True, "at": self.at(node)}
        raise self.fail(node, f"unexpected {rule}")

    def _with_default(self, result: Dom) -> Dom:
        """An elidable optional with its head's default, if the head has one."""
        if self.head_default is None:
            return result
        result = {**{key: value for key, value in result.items() if key != "at"}, "default": self.head_default, "at": result["at"]}
        return hide(result, self.at(self.default_node), "default_at")

    def _captured_optional(self, optional, node):
        markers = sorted((kid for part in (optional, node) for kid in self.kids(part) if self._token_value(kid) == "+"), key=lambda kid: self.first_token(kid) or 0)
        if len(markers) > 1:
            raise self.fail(markers[1], "an optional has one marker + at most")
        if not markers or self.one(optional, "choice") is not None:
            raise self.fail(optional, "a captured elidable optional holds only its terminator")
        head = self.known_of(self.only(node, "primary"), _PRIMARIES)
        previous = self.default_head, self.head_default, self.default_node
        self.default_head, self.head_default, self.default_node = head, None, None
        expr = yield self._expr(node)
        result = self._with_default({"optional": expr, "elidable": True, "at": self.at(optional)})
        self.default_head, self.head_default, self.default_node = previous
        return result

    def _token_value(self, node: Node) -> str | None:
        return self.token_value(node) if node.kind == "token" else None

    def _optional(self, node: Node) -> Walk:
        """An optional, and with a marker ``+`` among its parts an
        elidable one (engine §3.8, §9). The validator checks the form of an
        elidable one. A choice or conjunction directly after the marker is
        marked as a group, which is not its head."""
        captured = self.one(node, "captured-terminator")
        if captured is not None:
            return (yield self._captured_optional(node, captured))
        # Its required part first, then its markers (engine §9).
        choice = self.only(node, "choice")
        markers = [kid for kid in self.kids(node) if self._token_value(kid) == "+"]
        if len(markers) >= 2:
            raise self.fail(markers[1], "an optional has one marker + at most")
        if not markers:
            return {"optional": (yield self._expr(choice)), "at": self.at(node)}
        conjunctions = self.rules(choice, "some-of")
        leading = any(self._token_value(kid) == "|" for kid in self.kids(choice)) or (
            len(conjunctions) == 1 and any(self._token_value(kid) == "&" for kid in self.kids(conjunctions[0]))
        )
        sequences = self.rules(conjunctions[0], "sequence") if len(conjunctions) == 1 and not leading else []
        primaries = self.rules(sequences[0], "primary") if len(sequences) == 1 else []
        head = self.known_of(primaries[0], _PRIMARIES) if primaries else None
        previous = self.default_head, self.head_default, self.default_node
        self.default_head, self.head_default, self.default_node = head, None, None
        expr = yield self._expr(choice)
        if leading or isinstance(expr, dict) and "capture" in expr:
            expr = hide(expr, True, "grouped")
        result = self._with_default({"optional": expr, "elidable": True, "at": self.at(node)})
        self.default_head, self.head_default, self.default_node = previous
        return result

    def _repetition(self, node: Node) -> Walk:
        """Braces: the item, its separator if a `/` has one, and a
        chain's direction from its marker, a ``...`` among the parts
        (engine §9)."""
        kids = self.kids(node)
        choices = self.some(node, "choice")
        markers = [index for index, kid in enumerate(kids) if self._token_value(kid) == "..."]
        # Repeated markers fail before separator placement is inspected.
        # A sole marker after the separator fails at that marker (engine §9).
        if len(markers) >= 2:
            raise self.fail(kids[markers[1]], "braces have one chain marker ... at most")
        place = {id(kid): index for index, kid in enumerate(kids)}
        second = place[id(choices[1])] if len(choices) >= 2 else len(kids)
        if markers and markers[0] > second:
            raise self.fail(kids[markers[0]], "a separator has no chain marker: ... stands after { or after the item")
        chain = None if not markers else "left" if markers[0] < place[id(choices[0])] else "right"
        result: Dom = {"repeat": (yield self._expr(choices[0]))}
        if len(choices) >= 2:
            result["separator"] = yield self._expr(choices[1])
        if chain is not None:
            result["chain"] = chain
        result["at"] = self.at(node)
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
        return {"string": self.decode_string(self.tokens[token.token], False)}

    def tag_of(self, token: Node) -> str:
        name = self.token_value(token)
        if name.startswith("_"):
            canonical = self.unicode.canonical_tag(name)
            if canonical is None:
                raise self.fail(token, f"unknown engine tag {name}; every _ tag is a Unicode property")
            return canonical
        return name

    def _range(self, node: Node) -> Walk:
        parts = [kid for kid in self.kids(node) if kid.rule in ("string", "constant-reference", "parameter")]
        if len(parts) < 2:
            raise self.lacks(node, "two string operands")
        ends = []
        for end in parts[:2]:
            ends.append((yield self._term(end)))
        return ends

    def find_test_base(self, node: Node) -> Node | None:
        primary = self.one(node, "primary")
        if primary:
            return self.known_of(primary, _PRIMARIES)
        return next((kid for kid in self.kids(node) if kid.kind == "rule" and kid.rule in _PRIMARIES - {"tested-primary"}), None)

    def test_base(self, node: Node) -> Node:
        found = self.find_test_base(node)
        if found is None:
            raise self.lacks(node, "primary")
        return found

    def test_order(self, tests: list[Node], valid: bool) -> None:
        seen = set()
        for test in tests:
            if not valid or test.rule in seen or test.rule == "tag-test" and "value-test" in seen:
                raise self.fail(test, "this target or test order is invalid")
            seen.add(test.rule)

    def _read_test(self, test: Node, pattern: bool = False) -> Walk:
        """A test without its base: a tag test's requirements, or a value
        test's comparator and value. A parenthesized operand is a group,
        at its opening parenthesis."""
        def grouped(value, inner, operand):
            if inner.rule in ("term", "term-atom"):
                value = hide(value, True, "grouped")
                value = hide(value, self.at(operand))
            return value

        if test.rule in ("tag-test", "requirement-argument"):
            requirements = []
            for requirement in self.rules(test, "tag-requirement"):
                operand = self.only(requirement, "test-operand")
                inner = self.known_of(operand, _ATOMS)
                if pattern and inner.rule == "tag" and self.token_value(self.token(inner)) == "_Elided":
                    value = hide({"tag": "_Elided"}, self.at(self.token(inner)))
                else:
                    value = yield self._term(inner)
                negated = any(self._token_value(kid) == "¬" for kid in self.kids(requirement))
                requirements.append(hide({"negated": negated, "value": grouped(value, inner, operand)}, self.at(operand)))
            return {"test": "tags", "requirements": requirements}
        op = self.operator(self.token(self.only(test, "value-comparator")))
        operand = self.only(test, "test-operand")
        inner = self.known_of(operand, _ATOMS)
        value = yield self._term(inner)
        return {"test": op, "value": grouped(value, inner, operand)}

    def emission(self, node: Node) -> Dom:
        item_nodes = self.rules(node, "emit-item")
        if not item_nodes:
            item = hide({"capture": "", **self.clauses(node, "emit-tags")}, self.at(node))
            return hide({"items": [item]}, self.at(node))
        items = []
        for item_node in item_nodes:
            target = self.only(item_node, "emit-target")
            token = self.symbol_part(target)
            text = self.token_value(token) if token.kind == "token" else ""
            if text != "ε" and not text.startswith("$"):
                raise self.fail(target, "an emission target is a capture or ε")
            entry = {"insert": True} if text == "ε" else {"capture": text[1:]}
            before = [name for part in self.rules(item_node, "attachment-before") for name in self.attachments(part)]
            after = [name for part in self.rules(item_node, "attachment-after") for name in self.attachments(part)]
            entry.update(self.clauses(item_node, "emit-tags"))
            if before:
                entry["before"] = before
            if after:
                entry["after"] = after
            items.append(hide(entry, self.at(item_node)))
        return hide({"items": items}, self.at(node))

    def attachments(self, node: Node) -> list[str]:
        names = []
        for part in self.some(node, "capture-reference"):
            name = self.token_value(self.token(part))[1:]
            if not name:
                raise self.fail(node, "an attachment holds a named capture, not $")
            names.append(name)
        return names

    # -- conditions

    def _condition(self, node: Node) -> Walk:
        """A condition: ``⟹`` groups to the right, and a group of the same
        connective, ``∧`` or ``∨``, is folded into the one around it once
        the rule is read, since parentheses make no node (engine §9)."""
        if node.rule == "condition":
            # Its any-ofs in order, and after them the implication of a
            # notation that writes one after ⟹, grouped to the right (engine
            # §9).
            items: list[Dom] = []
            for kid in self.some(node, "any-of"):
                items.append((yield self._condition(kid)))
            consequent = self.one(node, "condition")
            if consequent is not None:
                items.append((yield self._condition(consequent)))
            result = items.pop()
            while items:
                left = items.pop()
                result = hide({"if": left, "then": result}, node_at(left) or self.at(node))
            return result
        if node.rule == "any-of":
            items = []
            for all_node in self.some(node, "all-of"):
                parts = []
                for kid in self.some(all_node, "condition-primary"):
                    parts.append((yield self._condition(kid)))
                items.append(parts[0] if len(parts) == 1 else hide({"all": parts}, self.at(all_node)))
            return items[0] if len(items) == 1 else hide({"any": items}, self.at(node))
        if node.rule == "condition-primary":
            return (yield self._simple_condition(self.known_of(node, _CONDITIONS)))
        raise self.fail(node, f"unexpected {node.rule}")

    def _simple_condition(self, inner: Node) -> Walk:
        if inner.rule == "condition":
            return (yield self._condition(inner))
        if inner.rule == "presence":
            return hide({"captured": self.token_value(self.token(inner))[1:]}, self.at(inner))
        if inner.rule == "tree-comparison":
            reference = self.only(inner, "capture-reference")
            left = hide({"capture": self.token_value(self.token(reference))[1:]}, self.at(reference))
            op = self.operator(self.token(self.only(inner, "tree-comparator")))
            operand = self.only(inner, "union")
            name = self._first_of_rule(operand, "rule-or-classifier-name") or self._first_of_rule(operand, "tag")
            # A bare name gets this error before the typing of a tag.
            if name is not None and operand.span[1] - operand.span[0] == 1:
                text = self.token_value(self.token(name))
                raise self.fail(name, f"tree comparison requires a pattern; write #{text}, not {text}")
            right = yield self._term(operand)
            return hide({"op": op, "left": left, "right": right}, self.at(inner))
        if inner.rule == "comparison":
            op = self.operator(self.token(self.only(inner, "comparator")))
            terms = self.some(inner, "union", 2)
            left = yield self._term(terms[0])
            right = yield self._term(terms[1])
            return hide({"op": op, "left": left, "right": right}, self.at(inner))
        if inner.rule == "negation":
            return hide({"not": (yield self._condition(self.only(inner, "condition-primary")))}, self.at(inner))
        if inner.rule == "set-condition":
            operation = self.known_of(inner, frozenset(("union-operation", "intersection-operation", "set-atom")))
            if operation.rule == "set-atom":
                atom = next((kid for kid in self.kids(operation) if kid.kind == "rule"), None)
                if atom is None:
                    raise self.fail(operation, "a set atom")
                return hide({"nonempty": (yield self._term(atom))}, self.at(inner))
            if operation.rule == "intersection-operation":
                items = []
                for item in self.some(operation, "concatenation"):
                    items.append((yield self._term(item)))
                term = items[0] if len(items) == 1 else hide({"intersection": items}, self.at(operation))
                return hide({"nonempty": term}, self.at(inner))
            found = self.some(operation, "intersection")
            operators = [self.token_value(kid) for kid in self.kids(operation) if kid.kind == "token" and self.token_value(kid) in ("∪", "∖")]
            # A leading ∪ is a separator, not an operator.
            operators = operators[max(0, len(operators) - len(found) + 1):]
            items = []
            for item in found:
                items.append((yield self._term(item)))
            term = items[0]
            open_union = False
            for index, operator in enumerate(operators):
                following = items[index + 1]
                if operator == "∖":
                    term = hide({"difference": [term, following]}, self.at(operation))
                    open_union = False
                elif open_union and "union" in term:
                    term["union"].append(following)
                else:
                    term = hide({"union": [term, following]}, self.at(operation))
                    open_union = True
            return hide({"nonempty": term}, self.at(inner))
        if inner.rule == "method-chain":
            method = yield self._method(inner)
            # A set-valued method in a Boolean position tests that its set
            # is not empty, through the wrapper of engine §9.2.
            if method.get("method") in ("tags", "classes", "split", "ngrams", "classify"):
                return hide({"nonempty": method}, self.at(inner))
            return method
        raise self.fail(inner, f"unexpected {inner.rule}")

    # -- terms

    def value(self, node: Node) -> Dom:
        return run(self._term(node))  # type: ignore[no-any-return]

    def _method(self, node: Node) -> Walk:
        receiver = yield self._term(self.only(self.only(node, "method-receiver"), "plain-term-atom"), True)
        for selector in self.some(node, "method-selector"):
            parsed = self.one(selector, "parse-selector")
            name = "parse" if parsed is not None else self.token_value(self.token(self.only(selector, "method-name")))
            arguments = self.one(selector, "method-arguments")
            args = []
            if parsed is not None:
                argument = self.only(parsed, "parse-argument")
                body = yield self._expr(self.only(argument, "choice"))
                markers = [child for child in self.kids(argument) if child.kind == "token" and self.token_value(child) == "…"]
                if markers:
                    sequence: list[Dom] = []
                    for child in self.kids(argument):
                        if child.kind == "token" and self.token_value(child) == "…":
                            sequence.append(hide({"remainder": True}, self.at(child)))
                        elif child.rule == "choice":
                            sequence.append(body)
                    if not any(part is body for part in sequence):
                        sequence.append(body)
                    body = {"seq": sequence, "at": self.at(argument)}
                args.append(hide({"body": body}, self.at(argument)))
            for part in self.some(arguments, "method-argument") if arguments is not None else []:
                integer = self.one(part, "integer")
                if integer is not None:
                    args.append(hide({"integer": self.token_value(self.token(integer))}, self.at(integer)))
                else:
                    term = yield self._term(self.only(part, "term"), True)
                    args.append(term if node_at(term) is not None and "rule" not in term else hide(term, self.at(part)))
            if arguments is not None:
                separators = [self.token_value(child) for child in self.kids(arguments) if child.kind == "token"]
                if any(separator != ("|" if name in ("followed-by", "preceded-by") else ",") for separator in separators):
                    raise self.fail(arguments, "invalid method argument separator")
            if name == "classify" and len(args) == 1 and isinstance(args[0].get("rule"), str) and CLASSIFIER_NAME.fullmatch(args[0]["rule"]):
                args[0] = hide({"classifier": args[0]["rule"]}, node_at(args[0]))
            if name in ("followed-by", "preceded-by"):
                for index, arg in enumerate(args):
                    if isinstance(arg.get("tag"), str) and not arg["tag"].startswith("_"):
                        args[index] = hide({"terminal": arg["tag"]}, node_at(arg))
            receiver = hide({"method": name, "receiver": receiver, "args": args}, self.at(node))
        return receiver

    def _pattern_atom(self, node: Node) -> Walk:
        kids = self.kids(node)
        for kid in kids:
            if kid.rule == "default-value":
                raise self.fail(kid, "a default stands only on an elidable optional head")
        if not kids:
            raise self.lacks(node, "pattern atom")
        first = kids[0]
        named = first.rule in ("rule-or-classifier-name", "rule-reference") or first.kind == "token" and first.terminal in ("Lowercase-Name", "Emoji-Name")
        tests = [kid for kid in kids if kid.rule in ("tag-test", "value-test")]
        self.test_order(tests, True)
        if first.rule in ("tag-test", "value-test"):
            raise self.fail(first, "a pattern test requires an atom")
        if first.rule in ("call", "parameter"):
            expr = (yield self._call(first)) if first.rule == "call" else self.parameter(first)
        elif named:
            name_token = first if first.kind == "token" else self.token(first)
            expr = {"name": self.token_value(name_token), "at": self.at(name_token)}
        else:
            at = self.at(first)
            if first.kind == "token":
                name = self.token_value(first)
                expr = {"terminal": self.tag_of(first), "at": at} if _is_capital(name) or name.startswith("_") else {"name": name, "at": at}
            elif first.rule == "tag":
                expr = {"terminal": self.tag_of(self.token(first)), "at": at}
            elif first.rule == "string":
                expr = {"literal": self.decode(self.token(first)), "at": at}
            elif first.rule == "string-terminal":
                expr = {"literal": (yield self._term(self.known_of(first, frozenset(("string", "constant-reference"))))), "at": at}
            elif first.rule == "range":
                expr = {"range": (yield self._range(first)), "at": at}
            elif first.rule == "wildcard":
                self.token(first)
                expr = {"wildcard": True, "at": at}
            elif first.rule == "constant-reference":
                expr = {"constant": (yield self._term(first))["const"], "at": at}
            else:
                raise self.lacks(node, "pattern atom")
            if isinstance(expr.get("literal"), dict) and "const" in expr["literal"]:
                expr = {"constant": expr["literal"]["const"], "at": at}
        for test in tests:
            expr = hide({**(yield self._read_test(test, True)), "expr": expr}, self.at(test))
        return {"node": expr}

    def _child_predicate(self, items: list[Dom], node: Node) -> Dom:
        while len(items) == 1 and "sequence" in items[0]:
            items = items[0]["sequence"]
        if len(items) != 1 or "child" not in items[0]:
            raise self.fail(node, "a pattern path or set requires one whole pattern")
        return items[0]["child"]

    def _layered_pattern(self, node: Node) -> Walk:
        kind = node.rule
        if kind == "pattern-primary":
            return (yield self._layered_pattern(self.known_of(node, frozenset(("pattern-node", "bare-child-list", "pattern-union")))))
        if kind in ("pattern-node", "bare-child-list"):
            atom = (yield self._pattern_atom(self.only(node, "pattern-atom")))["node"] if kind == "pattern-node" else {"any": True}
            children = self.one(node, "child-list")
            written_at = atom.get("at")
            result = {key: value for key, value in atom.items() if key != "at"}
            if any(part.kind == "token" and self.token_value(part) == "·" for part in self.kids(node)):
                result["exact"] = True
            if children is not None:
                result["children"] = yield self._layered_pattern(children)
            if written_at is not None:
                result["at"] = written_at
            else:
                result = hide(result, node_at(atom) or self.at(node))
            if children is not None:
                result = hide(result, self.at(children), "list_at")
            return result
        if kind in ("pattern-union", "pattern-intersection", "child-set-operation", "child-intersection"):
            if kind == "pattern-union":
                operands = self.some(node, "pattern-intersection")
            elif kind == "pattern-intersection":
                operands = self.some(node, "pattern-path")
            elif kind == "child-intersection":
                operands = self.some(node, "child-path")
            else:
                operands = [part for part in self.kids(node) if part.rule in ("child-intersection", "child-path")]
            if not operands:
                raise self.lacks(node, "pattern operands")
            values = []
            for operand in operands:
                value = yield self._layered_pattern(operand)
                values.append(self._child_predicate(value, operand) if operand.rule == "child-path" else value)
            operators = [self.token_value(part) for part in self.kids(node) if part.kind == "token"]
            operators = [op for op in operators if op in ("∪", "∖") or kind != "pattern-union" and op == "∩"]
            if kind in ("pattern-union", "child-set-operation"):
                if len(operators) < max(1 if kind == "child-set-operation" else 0, len(values) - 1):
                    raise self.lacks(node, "operator")
            result = values[0]
            for index, value in enumerate(values[1:]):
                operator = operators[index] if index < len(operators) else None
                key = "intersection" if kind.endswith("intersection") or operator == "∩" else "difference" if operator == "∖" else "union"
                result = hide({key: [result, value]}, self.at(node))
            return result
        if kind in ("pattern-path", "child-path"):
            primary = self.only(node, "pattern-primary" if kind == "pattern-path" else "child-primary")
            value = yield self._layered_pattern(primary)
            axis = next((part for part in self.kids(node) if part.kind == "token"), None)
            if axis is None:
                return value
            op = self.token_value(axis)
            if op not in ("⋮", "⋱", "⋰"):
                raise self.fail(axis, "a malformed pattern path")
            pattern = self._child_predicate(value, primary) if kind == "child-path" else value
            path = "descendant" if op == "⋮" else "last" if op == "⋱" else "first"
            result = hide({"path": path, "pattern": pattern}, self.at(node))
            return [hide({"child": result}, self.at(node))] if kind == "child-path" else result
        if kind == "child-list":
            choice = self.one(node, "child-choice")
            return (yield self._layered_pattern(choice)) if choice is not None else []
        if kind == "child-choice":
            arms = []
            for alternative in self.some(node, "child-alternative"):
                arms.append((yield self._layered_pattern(alternative)))
            return arms[0] if len(arms) == 1 else [hide({"choice": arms}, self.at(node))]
        if kind == "child-alternative":
            sequence = self.one(node, "child-sequence")
            if sequence is not None:
                return (yield self._layered_pattern(sequence))
            return [hide({"child": (yield self._layered_pattern(self.only(node, "child-set-operation")))}, self.at(node))]
        if kind == "child-sequence":
            result = []
            for item in self.some(node, "child-item"):
                result.append({"sequence": (yield self._layered_pattern(item))})
            return [{"sequence": result}]
        if kind == "child-item":
            parts = self.kids(node)
            if not parts:
                raise self.lacks(node, "child item")
            child = parts[0]
            if child.kind == "token" and self.token_value(child) == "⋯":
                return [hide({"siblings": True}, self.at(node))]
            return (yield self._layered_pattern(child))
        if kind == "child-primary":
            choice = self.one(node, "child-choice")
            if choice is not None:
                return (yield self._layered_pattern(choice))
            return [hide({"child": (yield self._layered_pattern(self.known_of(node, frozenset(("pattern-node", "bare-child-list")))))}, self.at(node))]
        if kind == "child-optional":
            return [hide({"optional": (yield self._layered_pattern(self.only(node, "child-choice")))}, self.at(node))]
        if kind == "child-repetition":
            choices = self.some(node, "child-choice")
            result = {"repeat": (yield self._layered_pattern(choices[0]))}
            if len(choices) >= 2:
                result["separator"] = yield self._layered_pattern(choices[1])
            return [hide(result, self.at(node))]
        raise self.fail(node, f"unexpected {kind} in layered pattern")

    def tag_run_placement(self, node: Node) -> None:
        first = self.first_token(node)
        last = node.span[1] - 1
        if first is not None:
            before = self.tokens[first - 1].value if first else None
            after = self.tokens[last + 1].value if last + 1 < len(self.tokens) else None
            if before in ("∩", "∖") or after in ("∩", "∖"):
                kind = "string" if node.rule == "string-run" else "tag"
                raise self.fail(node, f"a {kind} run beside intersection or difference requires parentheses")

    def _term(self, node: Node, argument: bool = False) -> Walk:
        """A term; ``argument`` says it is a function's argument, where a
        span or a rule may stand. The validator checks its type and its
        place (engine §9.3)."""
        rule = node.rule
        if rule == "term":
            return (yield self._term(self.known_of(node, _TERMS), argument))
        if rule == "guarded-term":
            guards = self.some(node, "any-of")
            conditions: list[Dom] = []
            for guard in guards:
                conditions.append((yield self._condition(guard)))
            guarded = yield self._term(self.one(node, "union") or self.only(node, "term"))
            for condition, guard in reversed(list(zip(conditions, guards))):
                guarded = hide({"if": condition, "then": guarded}, self.at(guard))
            return guarded
        if rule == "union":
            # Parts joined by ∪ and ∖ group from the left: a run joined by ∪
            # is one union, and each ∖ takes what stands before it (engine
            # §9). A leading ∪ is a separator, not an operator.
            parts = self.some(node, "intersection")
            if len(parts) == 1:
                return (yield self._term(parts[0], argument))
            operators = [self.token_value(kid) for kid in self.kids(node) if kid.kind == "token" and self.token_value(kid) in ("∪", "∖")]
            operators = operators[max(0, len(operators) - len(parts) + 1):]
            items: list[Dom] = []
            for part in parts:
                items.append((yield self._term(part)))
            if len(operators) < len(parts) - 1:
                raise self.lacks(node, "operator")
            result = items[0]
            open_union = False
            for operator, following in zip(operators, items[1:]):
                if operator == "∖":
                    result = hide({"difference": [result, following]}, self.at(node))
                    open_union = False
                elif open_union and "union" in result:
                    result["union"].append(following)
                else:
                    # Child unions stay shared until the single flattening
                    # walk of the completed DOM.
                    result = hide({"union": [result, following]}, self.at(node))
                    open_union = True
            return result
        if rule == "concatenation":
            nodes = self.some(node, "term-atom")
            items = []
            for part in nodes:
                items.append((yield self._term(part, argument and len(nodes) == 1)))
            return items[0] if len(nodes) == 1 else hide({"concat": items}, self.at(node))
        if rule == "intersection":
            parts = self.some(node, "concatenation")
            items = []
            for part in parts:
                items.append((yield self._term(part, argument and len(parts) == 1)))
            return items[0] if len(items) == 1 else hide({"intersection": items}, self.at(node))
        if rule in ("term-atom", "plain-term-atom", "test-operand"):
            inner = self.known_of(node, _ATOMS)
            if inner.rule == "method-chain":
                return (yield self._method(inner))
            return (yield self._term(inner, argument))
        if rule == "call":
            return (yield self._call(node))
        if rule == "parameter":
            return self.parameter(node)
        if rule == "pattern-literal":
            pattern = yield self._layered_pattern(self.only(node, "pattern-primary"))
            if node_at(pattern) is None:
                pattern = hide(pattern, self.at(node))
            return hide({"pattern": pattern}, self.at(node))
        if rule == "string":
            return hide(self.decode(self.token(node)), self.at(node))
        if rule == "tag":
            return hide({"tag": self.tag_of(self.token(node))}, self.at(node))
        if rule in ("string-run", "tag-run"):
            if self.recipe_context and rule == "string-run":
                raise self.fail(node, "juxtaposed recipe strings require ++. Use ++ between string atoms")
            self.tag_run_placement(node)
            items = []
            for tag in self.some(node, "string" if rule == "string-run" else "tag", 2):
                items.append((yield self._term(tag)))
            return hide({"union": items}, self.at(node))
        if rule == "range":
            raise self.fail(node, "a range is a terminal, not a term")
        if rule == "rule-or-classifier-name":
            # A bare name is a tag literal if it begins with a capital, and
            # otherwise a rule, which only a function's argument names.
            name = self.token_value(self.token(node))
            if _is_capital(name):
                return hide({"tag": name}, self.at(node))
            if argument:
                return hide({"rule": name}, self.at(node))
            raise self.fail(node, f"{name} names a rule, which is not a value")
        if rule == "empty-set":
            return hide({"emptySet": True}, self.at(node))
        if rule == "method-chain":
            return (yield self._method(node))
        if rule == "constant-reference":
            return {"const": self.token_value(self.token(node))[1:], "at": self.at(node)}
        if rule == "capture-reference":
            return hide({"capture": self.token_value(self.token(node))[1:]}, self.at(node))
        raise self.fail(node, f"unexpected {rule}")


def flatten_groups(root: Any) -> None:
    """Fold nested ``any``, ``all``, and ``union`` operands into their enclosing lists.

    Parentheses preserve the reader's grouping rules (engine §9).
    An explicit stack gathers each folded list once.
    """
    def gather_items(items):
        joined = []
        pending = list(reversed(items))
        while pending:
            item = pending.pop()
            if "sequence" in item:
                pending.extend(reversed(item["sequence"]))
            else:
                joined.append(item)
        return joined

    stack: list[tuple[Any, bool]] = [(root, False)]
    while stack:
        current, pattern = stack.pop()
        if isinstance(current, list):
            stack.extend((item, pattern) for item in current)
            continue
        if not isinstance(current, dict):
            continue
        if pattern:
            for key in ("children", "optional", "repeat", "separator"):
                if isinstance(current.get(key), list):
                    current[key] = gather_items(current[key])
            if isinstance(current.get("choice"), list):
                arms = []
                pending = list(reversed(current["choice"]))
                while pending:
                    arm = gather_items(pending.pop())
                    if len(arm) == 1 and "choice" in arm[0]:
                        pending.extend(reversed(arm[0]["choice"]))
                    else:
                        arms.append(arm)
                current["choice"] = arms
        for key in ("any", "all", "union", "concat", *(["intersection"] if pattern else [])):
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
        for key, value in current.items():
            if isinstance(value, (dict, list)):
                # Test and call operands leave the pattern context.
                child_pattern = key == "pattern" or pattern and key not in ("literal", "range", "value", "requirements", "args")
                stack.append((value, child_pattern))


def operand_problem(name: str, kinds: list[str]) -> str | None:
    """What is wrong with a directive's operands, each ``name`` or
    ``class``, a bare name lowercase or with a capital, or ``string``
    (engine §9)."""
    names = all(kind in ("name", "class") for kind in kinds)

    if name in ("stage", "extend-stage", "redefine-stage"):
        return None if len(kinds) == 1 and names else f"%{name} takes one name"
    if name in ("include", "names"):
        return None if kinds == ["string"] else f"%{name} takes one string"
    if name == "features":
        return None if kinds and names else "%features takes one or more names"
    if name == "elision-only":
        return None if not kinds else "%elision-only takes no operand"
    return None if names else f"%{name} takes names only"
