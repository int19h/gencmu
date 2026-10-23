"""Read shared layered patterns before the public DOM format changes."""

import json
import unittest

from gencmu._dialect import NotationReader, _notation_features, _resources, bundled_text, character_tokens
from gencmu._dom import DomBuilder
from gencmu._errors import GencmuError
from gencmu._grammar import lower
from gencmu._markdown import jbogenbau_text
from gencmu._pattern_shapes import layered_pattern_text
from gencmu._stage import StageRunner
from gencmu._trampoline import run
from gencmu._unicode import UnicodeTable

from .shared import SHARED, count_work
from .test_growth import reader_steps
from .test_layered_patterns import term


def without_positions(value):
    if isinstance(value, dict):
        return {key: without_positions(child) for key, child in value.items() if key != "at"}
    if isinstance(value, list):
        return [without_positions(child) for child in value]
    return value


class LayeredReader(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cases = json.loads((SHARED / "layered-pattern-reader.json").read_text())
        recognition = json.loads((SHARED / "fixtures/layered-patterns/recognition.json").read_text())
        bootstrap = json.loads(bundled_text("notation/bootstrap.json"))
        for stage in bootstrap["stages"]:
            for document in stage["documents"]:
                rules = document["dom"]["rules"]
                if stage["name"] == "lexical":
                    document["dom"]["rules"] = [recognition["lexical"] if rule["name"] == "symbol" else rule for rule in rules]
                if stage["name"] == "syntax":
                    document["dom"]["rules"] = [rule for rule in rules if not rule["name"].startswith(("pattern-", "child-"))] + recognition["syntax"]
        cls.unicode = UnicodeTable(_resources().unicode)
        cls.reader = NotationReader(json.dumps(bootstrap), cls.unicode)
        cls.prefix = "%rule probe(" + ", ".join("@" + name for name in cls.cases["parameters"]) + ") A\n%conditions $ ≅ "
        cls.start = len(cls.prefix.splitlines()[-1]) + 1

    def read(self, pattern):
        text = jbogenbau_text("```jbogenbau\n" + self.prefix + pattern + "\n```")
        tokens = character_tokens(text.text, self.unicode)
        features = frozenset()
        for index, (name, lowered) in enumerate(self.reader.stages):
            features = _notation_features(lowered.grammar, tokens, text.text, self.unicode, features)
            if features:
                lowered = lower(lowered.grammar, features)
            outcome = StageRunner(name, lowered, tokens, text.text, self.unicode, emit=index < len(self.reader.stages) - 1, features=features).run(lowered.grammar.elision_only)
            if outcome.error is not None:
                self.assertEqual(outcome.error.kind, "rejected")
                return {"error": {"phase": name, "at": text.position(outcome.error.source[0])}}
            if index < len(self.reader.stages) - 1:
                tokens = outcome.output
        builder = DomBuilder(tokens, text, "layered-reader.md", self.unicode)
        pending = [outcome.tree]
        while pending:
            node = pending.pop()
            if node.rule == "pattern-literal":
                break
            pending.extend(reversed(node.children))
        else:
            self.fail("the recognition tree contains no pattern literal")
        builder.parameter_scope = set(self.cases["parameters"])
        try:
            return {"pattern": run(builder._term(node))["pattern"]}
        except GencmuError as error:
            return {"error": {"phase": "reader", "at": (error.line, error.column)}}

    def test_shared_reader(self):
        for case in self.cases["cases"]:
            with self.subTest(case=case["description"]):
                result = self.read(case["source"])
                if "pattern" in case:
                    self.assertEqual(without_positions(result.get("pattern")), case["pattern"], result)
                    text = layered_pattern_text(result["pattern"], term)
                    self.assertEqual(without_positions(self.read(text).get("pattern")), case["pattern"])
                else:
                    self.assertEqual(result, {"error": {"phase": case["error"]["phase"], "at": (3, self.start + case["error"]["offset"])}})

    def test_shared_canonical_round_trips(self):
        cases = json.loads((SHARED / "layered-patterns.json").read_text())["printing"]
        for case in cases:
            with self.subTest(case=case["description"]):
                result = self.read(case["text"])
                self.assertEqual(without_positions(result.get("pattern")), without_positions(case["pattern"]), result)
                self.assertEqual(layered_pattern_text(result["pattern"], term), case["text"])

    def test_atom_positions(self):
        pattern = self.read("#·a« b »")["pattern"]
        self.assertEqual(pattern["at"], [3, self.start + 2])
        self.assertEqual(pattern["children"][0]["child"]["at"], [3, self.start + 5])
        self.assertEqual(self.read('#"a"')["pattern"]["at"], [3, self.start + 1])
        self.assertEqual(self.read("#·a")["pattern"]["at"], [3, self.start + 2])

    def test_group_and_width_growth(self):
        for kind in ("groups", "siblings"):
            baseline = None
            for size in (128, 256, 512):
                source = "#« " + ("(" * size + "a" + ")" * size if kind == "groups" else " ".join(["a"] * size)) + " »"
                with count_work(*reader_steps(), budget=baseline * 5 if baseline else 1000000) as work:
                    result = self.read(source)
                self.assertIn("pattern", result)
                self.assertEqual(len(result["pattern"]["children"]), 1 if kind == "groups" else size)
                if baseline is None:
                    baseline = work.count
