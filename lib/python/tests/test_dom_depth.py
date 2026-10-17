"""Shared DOM depth boundaries from engine §9 and tests/dom-depth.json."""
from __future__ import annotations
import json
import unittest
from gencmu import GencmuError
from gencmu._dialect import DOM_FORMAT, _resources, _unicode_table
from gencmu._validate import dom_problem
from .shared import SHARED, load_json


class DomDepth(unittest.TestCase):
    def test_shared_depth_boundaries(self) -> None:
        cases = load_json(SHARED / "dom-depth.json")
        self.assertTrue(cases)
        unicode = _unicode_table(_resources().unicode)
        for case in cases:
            wrapper = json.dumps(case["wrapper"])
            template = json.dumps(case["dom"])
            self.assertEqual(wrapper.count('"$inner"'), 1)
            self.assertEqual(template.count('"$inner"'), 1)
            for extra in (0, 1):
                with self.subTest(case=case["description"], extra=extra):
                    node = json.dumps(case["leaf"])
                    for _ in range(case["atLimit"] + extra):
                        node = wrapper.replace('"$inner"', node)
                    dom = json.loads(template.replace('"$inner"', node))
                    dom["format"] = DOM_FORMAT
                    problem = dom_problem(dom, unicode)
                    if extra:
                        self.assertIn("nested", problem or "")
                    else:
                        self.assertIsNone(problem)

    def test_source_depth_boundaries(self) -> None:
        from gencmu._dialect import read_document
        for case in load_json(SHARED / "dom-depth-source.json"):
            for extra in (0, 1):
                with self.subTest(case=case["description"], extra=extra):
                    n = case["atLimit"] + extra
                    body = case["head"] + case["prefix"] * n + case["leaf"] + case["suffix"] * n + case["tail"]
                    source = "```jbogenbau\n" + body + "\n```\n"
                    if extra:
                        with self.assertRaisesRegex(GencmuError, "nested"):
                            read_document(source, "depth.md")
                    else:
                        read_document(source, "depth.md")
