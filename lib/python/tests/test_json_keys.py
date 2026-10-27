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
                    self.assertTrue(gencmu.load_dialect_sources({**sources, "grammars/notation/bootstrap.json": bootstrap}, "p.md").parse("a").ok)
                else:
                    with self.assertRaises(gencmu.GencmuError) as caught:
                        gencmu.load_dialect_sources({**sources, "grammars/notation/bootstrap.json": bootstrap}, "p.md")
                    error = caught.exception
                    self.assertEqual((error.kind, error.document, error.stage, error.line, error.column), ("grammar", "grammars/notation/bootstrap.json", None, None, None))
                    self.assertTrue(error.message.startswith("grammars/notation/bootstrap.json:"))
        for item in fixtures["compiled"]:
            with self.subTest(case=item["description"]):
                self.assertIn(item["find"], fixtures["cache"])
                cache = fixtures["cache"].replace(item["find"], item["replace"], 1).replace("@bootstrap@", fnv1a64(bundled)).replace("@unicode@", fnv1a64((REPOSITORY / "data/unicode/unicode.txt").read_text())).replace("@source@", fnv1a64(fixtures["grammar"]))
                document = item.get("document", "g.md")
                case_sources = {"data/unicode/unicode.txt": (REPOSITORY / "data/unicode/unicode.txt").read_text(), "p.md": '```jbogenbau\n%stage main\n%include ' + json.dumps(document) + '\n```\n', document: fixtures["grammar"]}
                for path, value in item.get("sources", {}).items():
                    case_sources[path] = (REPOSITORY / "data/unicode/unicode-names.txt").read_text() if value == "@bundled-names@" else (REPOSITORY / "data/unicode/unicode.txt").read_text().replace("unicode 15.1.0", "unicode 16.0.0") if value == "@unicode-16@" else value
                if "error" in item:
                    with self.assertRaises(gencmu.GencmuError) as caught:
                        gencmu.load_dialect_sources({**case_sources, "grammars/compiled.json": cache}, "p.md")
                    self.assertEqual((caught.exception.kind, caught.exception.document, caught.exception.line),
                                     ("grammar", item["error"]["document"], item["error"].get("line")))
                    continue
                dialect = gencmu.load_dialect_sources({**case_sources, "grammars/compiled.json": cache}, "p.md")
                self.assertEqual(dialect.parse("a").ok, not item["cached"])
                self.assertEqual(dialect.parse("b").ok, item["cached"])
                if "tags" in item:
                    self.assertEqual(sorted(dialect.parse("b").tree.tags), item["tags"])
