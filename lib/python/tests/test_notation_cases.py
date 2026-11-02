"""Every case of tests/notation/ (tests/README.md)."""

from __future__ import annotations

from pathlib import Path
from copy import deepcopy
import json
import unittest
from unittest.mock import patch

import gencmu
from gencmu._pipeline import DOM_FORMAT, _Loader, _Resources, _resources, _reader, read_document
from gencmu._hash import fnv1a64

from .shared import REPOSITORY, add_case_tests, cases, load_case, mismatch, read_json, same_json, validate_notation_case, write_json


class NotationCases(unittest.TestCase):
    def test_notation_schema_refuses_unknown_members_and_conflicting_outcomes(self) -> None:
        base = {"document": "", "expect": {"dom": {}}}
        for change in (
            {"typo": True}, {"document": []}, {"description": 3}, {"cacheMisses": 1},
            {"expect": {"dom": {}, "typo": True}}, {"expect": {}}, {"expect": []},
            {"expect": {"dom": []}}, {"expect": {"dom": {}, "error": {}}},
            {"expect": {"error": {"typo": True}}}, {"expect": {"error": "grammar"}},
            {"expect": {"error": {"line": True}}}, {"expect": {"error": {"column": "2"}}},
            {"expect": {"error": {"message": []}}}, {"expect": {"error": {}}, "cacheMisses": True},
        ):
            with self.subTest(change=change), self.assertRaises(AssertionError):
                validate_notation_case({**base, **change})
        validate_notation_case(base)
        for position in ({}, {"line": 2}, {"column": 15}):
            with self.subTest(position=position), self.assertRaises(AssertionError):
                validate_notation_case({**base, "expect": {"error": position}})
        validate_notation_case({**base, "expect": {"error": {"line": 2, "column": 15}}})

    def test_actual_error_coordinates_keep_their_json_types(self) -> None:
        case = {"document": "", "expect": {"error": {"line": 1, "column": 1}}}
        for line, column in ((1, 1), (True, 1), (1, True), (False, 1), (1, False), ("1", 1), (1, "1"), (None, 1), (1, None)):
            error = gencmu.GencmuError("reason", line=line, column=column)
            with self.subTest(line=line, column=column), patch(__name__ + ".load_case", return_value=case), patch(__name__ + ".read_document", side_effect=error):
                if type(line) is int and type(column) is int:
                    self.check_case(Path("coordinates.json"))
                else:
                    with self.assertRaises(AssertionError):
                        self.check_case(Path("coordinates.json"))

    def test_range_emission_target_reports_a_content_error(self) -> None:
        with self.assertRaisesRegex(gencmu.GencmuError, "an emission target requires a capture or ε"):
            read_document('```jbogenbau\n%rule r A %emits "a".."z"\n```\n', "grammar.md")

    def test_canonical_dom_member_order(self) -> None:
        dom = read_document('```jbogenbau\n%rule f(@X) @X\n%extend-rule f("a") A\n%features f %conditions $\n```\n', "order.md")
        text = write_json(dom)
        for want in ('"name":"f","params":["X"],"op":"define"', '"name":"f","args":[{"string":"a"}],"op":"extend"', '"name":"features","args":["f"],"at":[4,1],"conditions":[{"captured":""}]'):
            self.assertIn(want, text)

    def test_decorated_pattern_member_order(self) -> None:
        document = '```jbogenbau\n%const $P #·pair("a")«»\n%rule f(@X) A %conditions $ ≅ #·@X«»\n```\n'
        dom = read_document(document, "order.md")
        json = write_json(dom)
        for want in ('"call":"pair","args":[{"string":"a"}],"exact":true,"children":[],"at":[2,13]',
                     '"param":"X","exact":true,"children":[],"at":[3,33]'):
            self.assertIn(want, json)

    def test_the_final_notation_stage_reports_emission_errors(self) -> None:
        found = _resources()
        bootstrap = json.loads(found.bootstrap)
        rules = bootstrap["documents"]["grammars/gencmu/jbogenbau/syntax.md"]["dom"]["rules"]
        root = next(rule for rule in rules if rule["name"] == "text")
        root["emit"] = {"items": [{"capture": "", "tags": {
            "if": {"op": "∈", "left": {"string": "x"}, "right": {
                "method": "split", "receiver": {"string": "x"},
                "args": [{"method": "value", "receiver": {"capture": ""}, "args": []}],
            }}, "then": {"tag": "X"},
        }}]}
        reader = _reader(json.dumps(bootstrap), found.unicode, found.properties)
        self.assertTrue(reader.read('```jbogenbau\n%rule text "a"\n```', "valid.md")["rules"])
        with self.assertRaises(gencmu.GencmuError) as caught:
            reader.read("", "empty.md")
        self.assertEqual(caught.exception.kind, "grammar")
        self.assertEqual(caught.exception.document, "empty.md")
        self.assertIn("split", caught.exception.message)
        self.assertIn("empty", caught.exception.message)

    def test_every_recipe_position_instructs_the_author_to_use_concat(self) -> None:
        data = read_json((REPOSITORY / "tests" / "recipe-diagnostics.json").read_text())
        for position in data["positions"]:
            for channel in (":=", ":-"):
                for recipe in data["recipes"]:
                    with self.subTest(position=position["name"], channel=channel, recipe=recipe["source"]):
                        body = position["template"].replace("@CHANNEL@", channel).replace("@RECIPE@", recipe["source"])
                        marker = body.index(recipe["source"]) + recipe["source"].index(recipe["at"])
                        with self.assertRaises(gencmu.GencmuError) as caught:
                            read_document("```jbogenbau\n" + body + "\n```", "recipe.md")
                        self.assertIn("use ++", caught.exception.message.lower())
                        self.assertTrue(same_json([caught.exception.line, caught.exception.column], [2, marker + 1]))
        for body in data["ordinary"]:
            with self.subTest(ordinary=body), self.assertRaises(gencmu.GencmuError) as caught:
                read_document("```jbogenbau\n" + body + "\n```", "recipe.md")
            self.assertIn("++", caught.exception.message)
            self.assertNotIn("use ++", caught.exception.message.lower())

    def test_cases_are_present(self) -> None:
        paths = cases("notation")
        self.assertTrue(paths, "no notation cases found")

    def check_case(self, path: Path) -> None:
        case = load_case(path)
        expect = case["expect"]
        if "dom" in expect:
            dom = read_document(case["document"], path.name)
            problem = mismatch(expect["dom"], dom)
            self.assertIsNone(problem, f"{path.name}: {problem}\n{write_json(dom)[:2000]}")
            if case.get("cacheMisses"):
                check_notation_cache_paths(self, path.name, case["document"], dom)
        else:
            with self.assertRaises(gencmu.GencmuError) as caught:
                read_document(case["document"], path.name)
            error = caught.exception
            self.assertEqual(error.kind, "grammar")
            for key in ("line", "column"):
                self.assertTrue(same_json(getattr(error, key), expect["error"][key]), f"{path.name}: {error}")
            if "message" in expect["error"]:
                self.assertEqual(error.message, expect["error"]["message"], f"{path.name}: {error}")

def check_notation_cache_paths(
    test: unittest.TestCase, name: str, document: str, expected: dict, resources: _Resources | None = None
) -> None:
    resources = _resources() if resources is None else resources
    cold = _Loader({name: document}.get, _Resources(resources.unicode, resources.bootstrap, None, resources.properties), use_cache=False)
    test.assertEqual(cold.dom(name), expected)
    envelope = {
        "format": DOM_FORMAT,
        "bootstrap": cold.reader.hash,
        "unicode": cold.unicode.fingerprint,
        "properties": cold.unicode.properties_fingerprint,
        "documents": {name: {"hash": fnv1a64(document), "dom": expected}},
    }

    def loader(preparsed):
        return _Loader({name: document}.get, _Resources(resources.unicode, resources.bootstrap, json.dumps(preparsed), resources.properties))

    cached = loader(envelope)
    with patch.object(cached.reader, "read", side_effect=AssertionError("preparsed cache was bypassed")):
        test.assertEqual(cached.dom(name), expected)
        test.assertIn((name, fnv1a64(document)), cached.preparsed)
        test.assertEqual(cached.dom(name), expected)
    for key in ("document", "bootstrap", "unicode", "format"):
        with test.subTest(cache_mismatch=key):
            stale = deepcopy(envelope)
            stale["documents"][name]["dom"]["rules"][0]["name"] = "cache-poison"
            if key == "document":
                stale["documents"][name]["hash"] = fnv1a64("another document")
            elif key == "format":
                stale["format"] = DOM_FORMAT - 1
            else:
                stale[key] = fnv1a64("another " + key)
            missed = loader(stale)
            test.assertEqual(missed.dom(name), expected)
            test.assertEqual(missed.dom(name), expected)


class NotationTies(unittest.TestCase):
    def test_a_tie_is_a_grammar_error_with_no_position(self) -> None:
        """A tie in a stage of the notation is a grammar error of loading.
        It names the document, and it has no line and no column (engine
        §8)."""
        # A notation whose one stage reads the character a in two ways.
        notation = read_document(
            '```jbogenbau\n%ambiguity-resolution greedy\n%rule text p | q\n%rule p "a"\n%rule q "a"\n```\n',
            "n.md",
        )
        bootstrap = json.dumps(
            {"format":notation["format"],"documents":{"grammars/gencmu/jbogenbau/pipeline.md":{"hash":"0","dom":read_document('```jbogenbau\n%stage syntax\n%include "../../../n.md"\n```\n',"boot.md")},"n.md":{"hash":"0","dom":notation}}}
        )
        sources = {"data/preparsed/gencmu.json": bootstrap}
        with self.assertRaises(gencmu.GencmuError) as caught:
            read_document("```jbogenbau\na\n```\n", "t.md", sources=sources)
        error = caught.exception
        self.assertEqual((error.kind, error.document, error.line, error.column), ("grammar", "t.md", None, None))
        self.assertEqual(str(error), "t.md: the grammar text is ambiguous: the syntax stage of the notation reads it in two ways")
        # A pipeline whose document ties in the notation does not load, with
        # the same error.
        with self.assertRaises(gencmu.GencmuError) as caught:
            gencmu.load_pipeline_sources({**sources, "t.md": "```jbogenbau\na\n```\n"}, "t.md", use_cache=False)
        error = caught.exception
        self.assertEqual((error.kind, error.document, error.line, error.column), ("grammar", "t.md", None, None))


add_case_tests(NotationCases, "notation")


if __name__ == "__main__":
    unittest.main()
