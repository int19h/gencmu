"""Shared exact-key and duplicate-key behavior for external JSON."""
import json
import unittest
from unittest.mock import patch

import gencmu
from gencmu._hash import fnv1a64
from .shared import REPOSITORY, same_json


class JsonKeys(unittest.TestCase):
    def test_decoded_values_distinguish_booleans_from_numbers(self):
        loads = json.loads
        raw = (REPOSITORY / "tests/json-keys.json").read_text()
        fixtures = loads(raw)
        fixtures["bootstrap"] = fixtures["bootstrap"][:1]
        fixtures["preparsed"] = fixtures["preparsed"][:1]
        for expected, actual in ((1, True), (0, False)):
            fixtures["values"] = [{"description": "numeric expectation", "json": str(expected), "expect": expected}]

            def decode(text, *args, **kwargs):
                if text == raw:
                    return fixtures
                if text == str(expected):
                    return actual
                return loads(text, *args, **kwargs)

            with self.subTest(expected=expected, actual=actual), patch(__name__ + ".json.loads", side_effect=decode):
                with self.assertRaises(AssertionError):
                    JsonKeys().test_shared_keys()

    def test_shared_keys(self):
        fixtures = json.loads((REPOSITORY / "tests/json-keys.json").read_text())
        bundled = (REPOSITORY / "data/preparsed/gencmu.json").read_text()
        sources = {"p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n', "g.md": fixtures["grammar"]}
        for item in fixtures["values"]:
            with self.subTest(case=item["description"]):
                self.assertTrue(same_json(json.loads(item["json"]), item["expect"]))
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
                    self.assertTrue(str(error).startswith("data/preparsed/gencmu.json:"))
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
                    self.assertTrue(same_json([caught.exception.kind, caught.exception.document, caught.exception.line, caught.exception.column],
                                              ["grammar", item["error"]["document"], item["error"].get("line"), item["error"].get("column")]))
                    continue
                pipeline = gencmu.load_pipeline_sources({**case_sources, "data/preparsed/test.json": cache}, "grammars/test/p.md")
                self.assertEqual(pipeline.parse("a").ok, not item["cached"])
                self.assertEqual(pipeline.parse("b").ok, item["cached"])
                if "tags" in item:
                    self.assertEqual(sorted(pipeline.parse("b").tree.tags), item["tags"])
