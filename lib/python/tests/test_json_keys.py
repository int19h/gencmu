"""Shared exact-key and duplicate-key behavior for external JSON."""
import json
import unittest

import gencmu
from gencmu._hash import fnv1a64
from .shared import REPOSITORY


class JsonKeys(unittest.TestCase):
    def test_shared_keys(self):
        fixtures = json.loads((REPOSITORY / "tests/json-keys.json").read_text())
        bundled = (REPOSITORY / "data/preparsed/gencmu.json").read_text()
        sources = {"p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n', "g.md": fixtures["grammar"]}
        for item in fixtures["values"]:
            with self.subTest(case=item["description"]):
                self.assertEqual(json.loads(item["json"]), item["expect"])
        for item in fixtures["bootstrap"]:
            with self.subTest(case=item["description"]):
                self.assertIn(item["find"], bundled)
                bootstrap = bundled.replace(item["find"], item["replace"], 1)
                if item["loads"]:
                    self.assertTrue(gencmu.load_pipeline_sources({**sources, "data/preparsed/gencmu.json": bootstrap}, "p.md").parse("a").ok)
                else:
                    with self.assertRaises(gencmu.GencmuError) as caught:
                        gencmu.load_pipeline_sources({**sources, "data/preparsed/gencmu.json": bootstrap}, "p.md")
                    error = caught.exception
                    self.assertEqual((error.kind, error.document, error.stage, error.line, error.column), ("grammar", "data/preparsed/gencmu.json", None, None, None))
                    self.assertTrue(error.message.startswith("data/preparsed/gencmu.json:"))
        for item in fixtures["preparsed"]:
            with self.subTest(case=item["description"]):
                self.assertIn(item["find"], fixtures["cache"])
                cache = fixtures["cache"].replace(item["find"], item["replace"], 1).replace("@bootstrap@", fnv1a64(bundled)).replace("@unicode@", fnv1a64((REPOSITORY / "data/unicode/unicode.txt").read_text())).replace("@source@", fnv1a64(fixtures["grammar"]))
                document = item.get("document", "g.md")
                case_sources = {"data/unicode/unicode.txt": (REPOSITORY / "data/unicode/unicode.txt").read_text(), "grammars/test/p.md": '```jbogenbau\n%stage main\n%include ' + json.dumps(document) + '\n```\n', "grammars/test/" + document: fixtures["grammar"]}
                for path, value in item.get("sources", {}).items():
                    case_sources[path] = (REPOSITORY / "data/unicode/unicode-names.txt").read_text() if value == "@bundled-names@" else (REPOSITORY / "data/unicode/unicode.txt").read_text().replace("unicode 15.1.0", "unicode 16.0.0") if value == "@unicode-16@" else value
                for resource,value in case_sources.items():
                    if value == "@matching-cache@":
                        case_sources[resource] = fixtures["cache"].replace("@bootstrap@",fnv1a64(bundled)).replace("@source@",fnv1a64(fixtures["grammar"])).replace("@unicode@",fnv1a64(case_sources["data/unicode/unicode.txt"]))
                if "error" in item:
                    with self.assertRaises(gencmu.GencmuError) as caught:
                        gencmu.load_pipeline_sources({**case_sources, "data/preparsed/test.json": cache}, "grammars/test/p.md")
                    self.assertEqual((caught.exception.kind, caught.exception.document, caught.exception.line),
                                     ("grammar", item["error"]["document"], item["error"].get("line")))
                    continue
                pipeline = gencmu.load_pipeline_sources({**case_sources, "data/preparsed/test.json": cache}, "grammars/test/p.md")
                self.assertEqual(pipeline.parse("a").ok, not item["cached"])
                self.assertEqual(pipeline.parse("b").ok, item["cached"])
                if "tags" in item:
                    self.assertEqual(sorted(pipeline.parse("b").tree.tags), item["tags"])
