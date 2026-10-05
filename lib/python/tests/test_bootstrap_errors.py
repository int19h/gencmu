"""Shared metadata for errors while constructing the notation bootstrap."""
import json
import unittest

import gencmu
from .shared import REPOSITORY


class BootstrapErrors(unittest.TestCase):
    def test_shared_error_metadata(self) -> None:
        fixtures = json.loads((REPOSITORY / "tests/bootstrap-errors.json").read_text())
        bundled = (REPOSITORY / "grammars/notation/bootstrap.json").read_text()
        for item in fixtures["cases"]:
            with self.subTest(case=item["description"]):
                if "bootstrap" in item:
                    bootstrap = item["bootstrap"]
                else:
                    self.assertIn(item["find"], bundled)
                    bootstrap = bundled.replace(item["find"], item["replace"], 1)
                with self.assertRaises(gencmu.GencmuError) as raised:
                    gencmu.load_dialect_sources({
                        "p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n',
                        "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text A\n```\n",
                        "notation/bootstrap.json": bootstrap,
                    }, "p.md")
                self.assertEqual(raised.exception.kind, fixtures["kind"])
                self.assertEqual(raised.exception.document, fixtures["document"])
                if "line" in item:
                    self.assertEqual(raised.exception.line, item["line"])
                    self.assertEqual(raised.exception.column, item["column"])
