"""Shared exact-key and duplicate-key behavior for external JSON."""
import json
import unittest

import gencmu
from gencmu._hash import fnv1a64
from .shared import REPOSITORY


class JsonKeys(unittest.TestCase):
    def test_shared_keys(self):
        fixtures = json.loads((REPOSITORY / "tests/json-keys.json").read_text())
        bundled = (REPOSITORY / "grammars/notation/bootstrap.json").read_text()
        sources = {"p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n', "g.md": fixtures["grammar"]}
        for item in fixtures["values"]:
            with self.subTest(case=item["description"]):
                self.assertEqual(json.loads(item["json"]), item["expect"])
        for item in fixtures["bootstrap"]:
            with self.subTest(case=item["description"]):
                self.assertIn(item["find"], bundled)
                bootstrap = bundled.replace(item["find"], item["replace"], 1)
                if item["loads"]:
                    self.assertTrue(gencmu.load_dialect_sources({**sources, "notation/bootstrap.json": bootstrap}, "p.md").parse("a").ok)
                else:
                    with self.assertRaises(gencmu.GencmuError) as caught:
                        gencmu.load_dialect_sources({**sources, "notation/bootstrap.json": bootstrap}, "p.md")
                    error = caught.exception
                    self.assertEqual((error.kind, error.document, error.stage, error.line, error.column), ("grammar", "notation/bootstrap.json", None, None, None))
                    self.assertTrue(error.message.startswith("notation/bootstrap.json:"))
        for item in fixtures["compiled"]:
            with self.subTest(case=item["description"]):
                self.assertIn(item["find"], fixtures["cache"])
                cache = fixtures["cache"].replace(item["find"], item["replace"], 1).replace("@bootstrap@", fnv1a64(bundled)).replace("@source@", fnv1a64(fixtures["grammar"]))
                dialect = gencmu.load_dialect_sources({**sources, "compiled.json": cache}, "p.md")
                self.assertEqual(dialect.parse("a").ok, not item["cached"])
                self.assertEqual(dialect.parse("b").ok, item["cached"])
