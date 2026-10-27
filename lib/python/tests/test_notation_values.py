"""Shared semantic names from caller-supplied notation values."""

from __future__ import annotations

import json
import unittest
from typing import Any
from gencmu import GencmuError

from gencmu._pipeline import _Resources, _resources, bundled_text, read_document

from .shared import SHARED, load_json, mismatch, write_json
from .test_notation_cases import check_notation_cache_paths


def value_notation(aliases: list[dict[str, Any]]) -> str:
    bootstrap = json.loads(bundled_text("data/preparsed/gencmu.json") or "")
    lexical = bootstrap["documents"]["grammars/gencmu/jbogenbau/lexical.md"]["dom"]
    piece = next(rule for rule in lexical["rules"] if rule["name"] == "piece")
    for index, alias in enumerate(aliases):
        name = f"value-alias-{index}"
        tags = [{"tag": tag} for tag in alias["tags"]]
        piece["alternatives"].append({"guards": [], "expr": {"ref": name}})
        lexical["rules"].append({
            "name": name, "op": "define", "flags": ["leftmost-longest"],
            "at": [100000 + index, 1], "conditions": [],
            "alternatives": [{"guards": [], "expr": {"seq": [
                {"literal": {"string": character}} for character in alias["spelling"]
            ]}}],
            "emit": {"items": [{
                "capture": "", "tags": tags[0] if len(tags) == 1 else {"union": tags},
                "value": {"concat": [{"string": alias["value"]}]},
            }]},
        })
    return json.dumps(bootstrap)


class NotationValues(unittest.TestCase):
    def check_case(self, case: dict[str, Any]) -> None:
        name = case["id"] + ".md"
        bootstrap = value_notation(case["aliases"])
        sources = {"data/preparsed/gencmu.json": bootstrap}
        if "error" in case["expect"]:
            with self.assertRaises(GencmuError) as caught:
                read_document(case["document"], name, sources=sources)
            expected = case["expect"]["error"]
            self.assertEqual((caught.exception.line, caught.exception.column),
                             (expected["line"], expected["column"]))
            return
        dom = read_document(case["document"], name, sources=sources)
        problem = mismatch(case["expect"], {"dom": dom})
        self.assertIsNone(problem, f"{name}: {problem}\n{write_json(dom)[:2000]}")
        bundled = _resources()
        resources = _Resources(bundled.unicode, bootstrap, None)
        check_notation_cache_paths(self, name, case["document"], dom, resources)


def add_value_tests() -> None:
    cases = load_json(SHARED / "notation-values.json")["cases"]
    assert cases, "no supplied-notation cases found"

    def test_for(case):
        def test(self):
            self.check_case(case)
        return test

    for case in cases:
        setattr(NotationValues, "test_" + case["id"].replace("-", "_"), test_for(case))


add_value_tests()
