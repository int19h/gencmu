"""Checks over the chosen derivation, after ranking (engine §12.1)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ._chart_readings import site as chart_site
from ._clause_walk import clause_children
from ._earley import Evaluator
from ._patterns import PatternMachine
from ._query_forms import local_target
from ._trampoline import run


class AbsentCheckValue(Exception):
    """An absent value makes its whole condition fail."""


@dataclass(eq=False)
class CheckNode:
    kind: str
    derivation: Any
    name: str | None = None
    terminal: str | None = None
    children: list = field(default_factory=list)
    parent: CheckNode | None = None
    index: int = 0
    kept: bool = True
    identity: int = 0
    structure: int = 0
    tags: frozenset = frozenset()
    tag_id: int = 0


class ChosenChecks:
    boundary_value = None

    def __init__(self, flow, context, features, checks):
        self.flow, self.context, self.features = flow, context, features
        self.checks = checks
        patterns = [check["pattern"] for check in self.checks]
        pending = [check["conditions"] for check in self.checks]
        boundaries = set()
        while pending:
            node = pending.pop()
            if isinstance(node, dict) and "pattern" in node:
                patterns.append(node["pattern"])
            if isinstance(node, dict) and node.get("method") in ("followed-by", "preceded-by"):
                boundaries.update(target.get("rule", target.get("terminal")) for target in node["args"])
            pending.extend(clause_children(node))
        self.machine = PatternMachine(patterns)
        self.nodes, self.identities = {}, {}
        self.first, self.last = {}, {}
        self.evaluator = Evaluator(context, 0, len(context.tokens))
        for node in flow.order if boundaries else ():
            if node.start == node.end:
                continue
            name = node.terminal if not hasattr(node, "production") else None if node.production.helper else node.production.rule_name
            if name in boundaries:
                self.first.setdefault(node.start, set()).add(name)
                self.last.setdefault(node.end, set()).add(name)
        roots, nodes = [], []
        pending = [(flow.root, roots)]
        while pending:
            derivation, into = pending.pop()
            if not hasattr(derivation, "production"):
                node = CheckNode("token", derivation, terminal=derivation.terminal)
            else:
                p = derivation.production
                if p.erased:
                    seal = CheckNode("seal", derivation)
                    if p.helper:
                        into.append(seal)
                        nodes.append(seal)
                    else:
                        node = CheckNode("rule", derivation, name=p.rule_name, children=[seal])
                        into.append(node)
                        nodes.extend([node, seal])
                    continue
                if p.elided is not None and not derivation.children:
                    node = CheckNode("elided", derivation, terminal=p.elided)
                elif p.helper:
                    pending.extend((child, into) for child in reversed(derivation.children))
                    continue
                else:
                    node = CheckNode("rule", derivation, name=p.rule_name)
                    pending.extend((child, node.children) for child in reversed(derivation.children))
            into.append(node)
            nodes.append(node)
        for node in reversed(nodes):
            node.children = [child for child in node.children if child.kept]
            node.kept = node.kind != "rule" or bool(node.children) or node.derivation is flow.root
            if node.kept:
                self.make(node)
        for node in nodes:
            if node.kept:
                for index, child in enumerate(node.children):
                    child.parent, child.index = node, index

    def make(self, node):
        part, context = node.derivation, self.context
        values = lambda: tuple(token.value for token in context.tokens[part.start:part.end])
        node.tags = (frozenset((node.terminal,)) if node.kind == "elided" else context.tokens[part.token].tags
                     if not hasattr(part, "production") else context.tagtab.get(part.tag))
        node.tag_id = context.tagtab.intern(node.tags)
        identity = (("rule", node.name, tuple(child.identity for child in node.children)) if node.kind == "rule"
                    else ("seal", values()) if node.kind == "seal" else ("elided", node.terminal) if node.kind == "elided"
                    else ("token", node.terminal, context.tokens[part.token].value))
        node.identity = self.identities.setdefault(identity, len(self.identities))
        if node.kind == "seal":
            node.structure = self.machine.seal
            return
        sequence = self.machine.empty
        for child in node.children:
            sequence = self.machine.concat(sequence, child.structure)
        leaf = None if node.kind == "rule" else (node.terminal, "" if node.kind == "elided" else context.tokens[part.token].value,
                                                node.tags | {"_Elided"} if node.kind == "elided" else node.tags)
        node.structure = self.machine.node(node.name, sequence, leaf, node.tags,
                                           "".join(values()) if self.machine.node_values else None)
        self.nodes[part] = node

    def check_node(self, term):
        if "capture" in term:
            return self.current
        receiver = self.check_node(term["receiver"])
        if receiver is None:
            return None
        if term["method"] == "parent":
            return receiver.parent
        if receiver.parent is None:
            return None
        index = receiver.index + (-1 if term["method"] == "preceding-node" else 1)
        siblings = receiver.parent.children
        found = siblings[index] if 0 <= index < len(siblings) else None
        return found if found is not None and found.kind != "seal" else None

    def require(self, term):
        node = self.check_node(term)
        if node is None:
            raise AbsentCheckValue()
        return node

    def get(self, name):
        return self.check_value({"capture": name})

    def check_value(self, term):
        if term.get("method") == "preceding-element":
            start, end, _ = self.preceding(self.require(term["receiver"]))
            return start, end, None
        node = self.require(term)
        return node.derivation.start, node.derivation.end, node.tag_id

    def site(self, parent, index):
        p = parent.production
        written = p.site_expressions[index] if index < len(p.site_expressions) else None
        if written is not None:
            return written
        symbol = p.rhs[index]
        if not p.terminal[index] and symbol in self.context.lowered.helper_expressions:
            return self.context.lowered.helper_expressions[symbol]
        return {"ref": self.context.lowered.rule_names[symbol]} if not p.terminal[index] else {"ref": symbol}

    def preceding(self, node):
        child = node.derivation
        while True:
            parent = self.flow.info(child).parent
            if parent is None or not hasattr(parent, "production"):
                raise AbsentCheckValue()
            at = parent.children.index(child)
            sequence = parent.production.elements
            ancestors = []
            def contains(element):
                return element[1] <= at < (element[1] + 1 if element[0] == "symbol" else element[1] + element[2])
            index = next((index for index, element in enumerate(sequence) if contains(element)), -1)
            if index < 0:
                raise AbsentCheckValue()
            while sequence[index][0] == "optional":
                inner = sequence[index][3]
                found = next((index for index, element in enumerate(inner) if contains(element)), -1)
                if found < 0:
                    break
                ancestors.append((sequence, index))
                sequence, index = inner, found
            while index == 0 and ancestors:
                sequence, index = ancestors.pop()
            if index > 0:
                element = sequence[index - 1]
                start, length = element[1], 1 if element[0] == "symbol" else element[2]
                low = parent.children[start].start if start < len(parent.children) else parent.end
                high = parent.children[start + length - 1].end if length else low
                return low, high, (parent, element)
            if not parent.production.helper or parent.production.splice_of is not None:
                raise AbsentCheckValue()
            child = parent

    def local_reading(self, term):
        site = None
        if term.get("method") == "preceding-element":
            start, _, (parent, element) = self.preceding(self.require(term["receiver"]))
            if element[0] == "symbol":
                site = chart_site(self.context.lowered, parent.production, element[1])
            expression = (self.site(parent, element[1]) if element[0] == "symbol"
                          else self.context.lowered.element_expressions[element[4]])
        else:
            node = self.require(term)
            part = node.derivation
            start = part.start
            parent = self.flow.info(part).parent
            if parent is not None:
                site = chart_site(self.context.lowered, parent.production, parent.children.index(part))
            else:
                site = chart_site(self.context.lowered, rule=part.production.lhs)
            if node.kind == "elided":
                expression = self.context.lowered.helper_expressions[part.production.lhs]
            elif parent is None:
                expression = {"ref": part.production.rule_name}
            else:
                expression = self.site(parent, parent.children.index(part))
        return start, local_target(self.context.lowered, expression), site

    def boundary_test(self, atom):
        start, end, _ = self.check_value(atom["receiver"])
        forward = atom["method"] == "followed-by"
        offers = (self.first if forward else self.last).get(end if forward else start, ())
        return any(target.get("rule", target.get("terminal")) in offers for target in atom["args"])

    def at(self, derivation, suppressed):
        node = self.nodes.get(derivation)
        if node is None or self.flow.info(derivation).erased:
            return
        self.current = node
        for check in self.checks:
            if "warning" in check and (check["name"] not in self.features or check["name"] in suppressed or "_" in suppressed):
                continue
            if not self.machine.matches(node.structure, check["pattern"]):
                continue
            for condition in check["conditions"]:
                try:
                    if not run(self.evaluator.walk_condition(condition, self)):
                        break
                except AbsentCheckValue:
                    break
            else:
                yield check
