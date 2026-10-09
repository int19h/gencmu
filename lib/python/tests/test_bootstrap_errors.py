"""Shared metadata for errors while constructing the notation bootstrap."""
import json
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch
from gencmu import _dialect

import gencmu
from .shared import REPOSITORY, find_places, position_of, substitute


class BootstrapErrors(unittest.TestCase):
    def test_shared_error_metadata(self) -> None:
        fixtures = json.loads((REPOSITORY / "tests/bootstrap-errors.json").read_text())
        bundled = (REPOSITORY / "grammars/notation/bootstrap.json").read_text()
        for item in fixtures["cases"]:
            with self.subTest(case=item["description"]):
                if "bootstrap" in item:
                    bootstrap = item["bootstrap"]
                else:
                    self.assertTrue(find_places(bundled, item["find"]), "the mutation is absent")
                    bootstrap = substitute(bundled, item["find"], item["replace"])
                with self.assertRaises(gencmu.GencmuError) as raised:
                    gencmu.load_dialect_sources({
                        "p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n',
                        "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text A\n```\n",
                        "notation/bootstrap.json": bootstrap,
                    }, "p.md")
                self.assertEqual(raised.exception.kind, fixtures["kind"])
                self.assertEqual(raised.exception.document, fixtures["document"])
                self.assertTrue(raised.exception.message.startswith(fixtures["document"] + ":"), raised.exception.message)
                self.assertEqual(str(raised.exception), raised.exception.message)
                if "context" in item:
                    self.assertIn(item["context"], raised.exception.message)
                if "message" in item:
                    self.assertIn(item["message"], raised.exception.message)
                # The place of the error, by the text that stands there in
                # its grammar document, or as the case gives it.
                if "at" in item:
                    line, column = position_of((REPOSITORY / "grammars" / item["context"]).read_text(encoding="utf-8"), item["at"])
                else:
                    line, column = item["line"], item["column"]
                for field, value in (("stage", item["stage"]), ("line", line), ("column", column)):
                    self.assertEqual(getattr(raised.exception, field), value, field)

    def test_bootstrap_file_reading_errors(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "notation").mkdir()
            (root / "unicode.txt").write_bytes((REPOSITORY / "grammars/unicode.txt").read_bytes())
            for failure in ("missing", "directory", "invalid UTF-8"):
                with self.subTest(failure=failure):
                    file = root / "notation/bootstrap.json"
                    if failure == "directory":
                        file.mkdir()
                    if failure == "invalid UTF-8":
                        file.rmdir()
                        file.write_bytes(b"\xff")
                    with patch.object(_dialect, "_bundled_root", return_value=root), patch.dict(_dialect._bundled, {}, clear=True):
                        with self.assertRaises(gencmu.GencmuError) as raised:
                            gencmu.load_dialect_sources({"p.md": "%stage main"}, "p.md")
                    self.assertEqual(raised.exception.document, "notation/bootstrap.json")
                    self.assertTrue(raised.exception.message.startswith("notation/bootstrap.json:"), raised.exception.message)
                    self.assertEqual(str(raised.exception), raised.exception.message)
