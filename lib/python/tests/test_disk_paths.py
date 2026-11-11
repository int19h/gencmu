"""A pipeline loaded from disk knows each document by its absolute path, so an
error names the file the same way from any working directory, and in every
library."""

from __future__ import annotations

import os
import json
import pathlib
import tempfile
import unittest

import gencmu
from gencmu._splice import splice_pipeline
from .shared import same_json


class DiskPaths(unittest.TestCase):
    def test_include_relocation_keeps_structured_error_fields(self):
        top = {"format": 50, "rules": [], "constants": [], "classifiers": [], "implications": [], "directives": [
            {"name": "stage", "args": ["main"], "at": [1, 1]},
            {"name": "include", "args": ["g.md"], "at": [2, 1]},
        ], "checks": []}
        for line in (None, 7):
            original = gencmu.GencmuError("read failure", document="g.md", line=line, code="sentinel")
            cause = OSError("disk")

            def dom(path, inherited):
                if path == "p.md":
                    return top
                raise original from cause

            with self.assertRaises(gencmu.GencmuError) as caught:
                splice_pipeline("p.md", dom)
            error = caught.exception
            self.assertEqual(error.code, "sentinel")
            self.assertIs(error.__cause__, cause)
            self.assertEqual(error.document, "p.md" if line is None else "g.md")
            self.assertEqual(error.line, 2 if line is None else 7)
            self.assertEqual(original.document, "g.md")

    def test_unreadable_documents(self):
        for depth in (0, 1, 2):
            for exists in (False, True):
                with self.subTest(depth=depth, exists=exists), tempfile.TemporaryDirectory() as root:
                    pipeline = pathlib.Path(root, "p.md")
                    file = pathlib.Path(root, ("p.md", "g.md", "h.md")[depth])
                    if depth > 0:
                        pipeline.write_text('```jbogenbau\n%stage main\n%include "g.md"\n```\n', encoding="utf-8")
                    if depth == 2:
                        pathlib.Path(root, "g.md").write_text('```jbogenbau\n%include "h.md"\n```\n', encoding="utf-8")
                    if exists:
                        file.mkdir()
                    with self.assertRaises(gencmu.GencmuError) as caught:
                        gencmu.load_pipeline_file(pipeline)
                    error = caught.exception
                    self.assertEqual(error.kind, "grammar")
                    self.assertIn("the document could not be read:" if exists else "was not found", str(error))
                    self.assertIn(str(file), str(error))
                    self.assertEqual(error.document, str(pathlib.Path(root, "g.md")) if depth == 2 else str(pipeline))
                    if depth > 0:
                        self.assertEqual((error.line, error.column), (2 if depth == 2 else 3, 1))

    def test_selected_disk_names(self):
        cases = json.loads((pathlib.Path(__file__).resolve().parents[3] / "tests/disk-names.json").read_text())
        home = os.getcwd()
        for item in cases:
            with self.subTest(item["description"]), tempfile.TemporaryDirectory() as root:
                for name, text in item["files"].items():
                    file = pathlib.Path(root, name)
                    file.parent.mkdir(parents=True, exist_ok=True)
                    file.write_text(text, encoding="utf-8")
                os.chdir(root)
                try:
                    with self.assertRaises(gencmu.GencmuError) as caught:
                        gencmu.load_pipeline_file(pathlib.Path(root, "p.md"))
                    error = caught.exception
                    self.assertEqual(error.kind, "grammar")
                    self.assertEqual(error.document, str(pathlib.Path(root, item["error"]["document"])))
                    self.assertTrue(same_json([error.line, error.column], [item["error"]["line"], item["error"]["column"]]))
                finally:
                    os.chdir(home)

    def test_errors_name_the_absolute_path_from_another_working_directory(self) -> None:
        home = os.getcwd()
        with tempfile.TemporaryDirectory() as included, tempfile.TemporaryDirectory() as pipeline, tempfile.TemporaryDirectory() as elsewhere:
            files = {
                included: {
                    "p.md": '```jbogenbau\n%stage main\n%include "sub/g.md"\n```\n',
                    "sub/g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text (\n```\n",
                },
                pipeline: {"p.md": "```jbogenbau\n%stage main\n%rule text (\n```\n"},
            }
            for root, documents in files.items():
                for name, text in documents.items():
                    file = pathlib.Path(root, *name.split("/"))
                    file.parent.mkdir(parents=True, exist_ok=True)
                    file.write_text(text, encoding="utf-8")
            os.chdir(elsewhere)
            try:
                for root, bad in ((included, "sub/g.md"), (pipeline, "p.md")):
                    expected = os.path.abspath(os.path.join(root, *bad.split("/"))).replace(os.sep, "/")
                    given_paths = (os.path.join(root, "p.md"), os.path.relpath(os.path.join(root, "p.md"), elsewhere))
                    for given in given_paths:
                        with self.subTest(given=given), self.assertRaises(gencmu.GencmuError) as caught:
                            gencmu.load_pipeline_file(given, use_cache=False)
                        self.assertEqual(caught.exception.document, expected, given)
                        self.assertIn(f"{expected}:", str(caught.exception), given)
            finally:
                os.chdir(home)


if __name__ == "__main__":
    unittest.main()
