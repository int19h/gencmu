"""The fixpoint of the notation and the precompiled DOMs (engine §8)."""

from __future__ import annotations

import json
import unittest

import gencmu
from gencmu._dialect import DOM_FORMAT, bundled_text, read_document
from gencmu._hash import fnv1a64

from .shared import REPOSITORY


class Fixpoint(unittest.TestCase):
    def test_notation_reads_itself(self) -> None:
        """Reading grammars/notation/*.md with the bootstrap reproduces it."""
        with open(REPOSITORY / "grammars" / "notation" / "bootstrap.json", encoding="utf-8") as file:
            bootstrap = json.load(file)
        self.assertEqual(bootstrap["format"], DOM_FORMAT)
        for stage in bootstrap["stages"]:
            for document in stage["documents"]:
                with self.subTest(document=document["path"]):
                    with open(REPOSITORY / "grammars" / document["path"], encoding="utf-8", newline="") as file:
                        text = file.read()
                    self.assertEqual(read_document(text, document["path"]), document["dom"])

    def test_bundled_copy_is_the_repository_grammars(self) -> None:
        for path in ("notation/bootstrap.json", "notation/lexical.md", "notation/syntax.md", "unicode.txt", "compiled.json"):
            with self.subTest(path=path):
                with open(REPOSITORY / "grammars" / path, encoding="utf-8", newline="") as file:
                    self.assertEqual(bundled_text(path), file.read())


class Compiled(unittest.TestCase):
    def setUp(self) -> None:
        text = bundled_text("compiled.json")
        assert text is not None
        self.compiled = json.loads(text)

    def test_keys(self) -> None:
        bootstrap = bundled_text("notation/bootstrap.json")
        assert bootstrap is not None
        self.assertEqual(self.compiled["format"], DOM_FORMAT)
        self.assertEqual(self.compiled["bootstrap"], fnv1a64(bootstrap))

    def test_every_document_agrees_with_a_fresh_reading(self) -> None:
        self.assertTrue(self.compiled["documents"])
        for path, entry in self.compiled["documents"].items():
            with self.subTest(document=path):
                text = bundled_text(path)
                assert text is not None
                self.assertEqual(entry["hash"], fnv1a64(text))
                self.assertEqual(read_document(text, path), entry["dom"])

    def test_parsing_with_and_without_the_cache(self) -> None:
        cached = gencmu.load_dialect("notation")
        fresh = gencmu.load_dialect("notation", use_cache=False)
        for text in ("text ≔ A B ;", "a ≔ $x(A) [B #] ... : text($x) = \"y\" ⇒ this ;", "%elidable KU ;\n"):
            with self.subTest(text=text):
                self.assertEqual(gencmu.to_json(cached.parse(text)), gencmu.to_json(fresh.parse(text)))

    def test_a_stale_entry_is_a_miss(self) -> None:
        """An entry whose hash does not match the text is not used."""
        lexical = bundled_text("notation/lexical.md")
        assert lexical is not None
        stale = json.loads(json.dumps(self.compiled))
        stale["documents"]["notation/lexical.md"]["dom"] = {"format": 1, "rules": [], "directives": []}
        edited = lexical + "\nA note added after the grammar.\n"
        sources = {
            "compiled.json": json.dumps(stale),
            "p.md": "## Tokens <?stage lexical?>\n\n- [lexical](notation/lexical.md) <?grammar?>\n",
            "notation/lexical.md": edited,
        }
        # The stale DOM has no rules; were it used, the stage would have no
        # rule text and fail to load.
        loaded = gencmu.load_dialect_sources(sources, "p.md")
        self.assertTrue(loaded.parse("a ≔ B ;").ok)
        # And an entry that matches the text is used: the same stale DOM
        # under the text's own hash makes the load fail.
        stale["documents"]["notation/lexical.md"]["hash"] = fnv1a64(edited)
        sources["compiled.json"] = json.dumps(stale)
        with self.assertRaises(gencmu.GencmuError):
            gencmu.load_dialect_sources(sources, "p.md")


if __name__ == "__main__":
    unittest.main()
