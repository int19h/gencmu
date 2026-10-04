"""A dialect loaded from disk knows each document by its absolute path, so an
error names the file the same way from any working directory, and in every
library."""

from __future__ import annotations

import os
import pathlib
import tempfile
import unittest

import gencmu


class DiskPaths(unittest.TestCase):
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
                            gencmu.load_dialect_file(given, use_cache=False)
                        self.assertEqual(caught.exception.document, expected, given)
                        self.assertIn(f"{expected}:", str(caught.exception), given)
            finally:
                os.chdir(home)


if __name__ == "__main__":
    unittest.main()
