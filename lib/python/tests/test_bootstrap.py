"""The fixpoint of the notation and the precompiled DOMs (engine §8)."""

from __future__ import annotations

import functools
import json
import unittest

import gencmu
from gencmu._dialect import DOM_FORMAT, Dom, _bundled_root, _Loader, _resources, bundled_text, read_document
from gencmu._hash import fnv1a64

from .shared import REPOSITORY


@functools.lru_cache(maxsize=None)
def fresh_dom(path: str) -> Dom:
    """A bundled document read afresh through the notation, once per run."""
    text = bundled_text(path)
    assert text is not None, path
    return read_document(text, path)


class Fixpoint(unittest.TestCase):
    def test_notation_reads_itself(self) -> None:
        """Loading the notation's pipeline, grammars/dialects/notation.md,
        with the bootstrap and splicing it reproduces the bootstrap's stages."""
        with open(REPOSITORY / "grammars" / "notation" / "bootstrap.json", encoding="utf-8") as file:
            bootstrap = json.load(file)
        self.assertEqual(bootstrap["format"], DOM_FORMAT)

        def lookup(path: str) -> str | None:
            try:
                with open(REPOSITORY / "grammars" / path, encoding="utf-8", newline="") as file:
                    return file.read()
            except OSError:
                return None

        pipeline = _Loader(lookup, _resources(), use_cache=False).pipeline("dialects/notation.md")
        stages = [
            {"name": stage.name, "documents": [{"path": path, "dom": dom} for path, dom in stage.documents]}
            for stage in pipeline.stages
        ]
        self.assertEqual([stage["name"] for stage in stages], [stage["name"] for stage in bootstrap["stages"]])
        for ours, theirs in zip(stages, bootstrap["stages"]):
            with self.subTest(stage=ours["name"]):
                self.assertEqual(ours, theirs)

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
                self.assertEqual(fresh_dom(path), entry["dom"])

    def test_dialects_with_and_without_the_cache(self) -> None:
        """Each bundled dialect has the same stages and features whether its
        documents' DOMs come from compiled.json or from a fresh reading."""
        names = sorted(entry.name[:-3] for entry in _bundled_root().joinpath("dialects").iterdir() if entry.name.endswith(".md"))
        self.assertTrue(names)
        for name in names:
            with self.subTest(dialect=name):
                path = f"dialects/{name}.md"
                cached = _Loader(bundled_text, _resources())
                self.assertTrue(cached.compiled)
                uncached = _Loader(bundled_text, _resources(), use_cache=False)
                uncached.dom = fresh_dom  # type: ignore[method-assign]
                a, b = cached.load(path), uncached.load(path)
                self.assertEqual(b.stage_names, a.stage_names)
                self.assertEqual(b.grammars, a.grammars)
                self.assertEqual((b.features, b.declared), (a.features, a.declared))

    def test_parsing_with_and_without_the_cache(self) -> None:
        cached = gencmu.load_dialect("notation")
        fresh = gencmu.load_dialect("notation", use_cache=False)
        for text in ("%rule text A B", "%rule a $x(A) [B #] ...\n%conditions text($x) = \"y\"\n%emits $", "%elidable KU\n"):
            with self.subTest(text=text):
                self.assertEqual(gencmu.to_json(cached.parse(text)), gencmu.to_json(fresh.parse(text)))

    def test_a_stale_entry_is_a_miss(self) -> None:
        """An entry whose hash does not match the text is not used."""
        lexical = bundled_text("notation/lexical.md")
        assert lexical is not None
        stale = json.loads(json.dumps(self.compiled))
        stale["documents"]["notation/lexical.md"]["dom"] = {"format": DOM_FORMAT, "rules": [], "directives": [], "constants": [], "classifiers": [], "implications": []}
        edited = lexical + "\nA note added after the grammar.\n"
        sources = {
            "compiled.json": json.dumps(stale),
            "p.md": '```jbogenbau\n%stage lexical\n%include "notation/lexical.md"\n```\n',
            "notation/lexical.md": edited,
        }
        # The stale DOM has no rules; were it used, the stage would have no
        # rule text and fail to load.
        loaded = gencmu.load_dialect_sources(sources, "p.md")
        self.assertTrue(loaded.parse("%rule a B").ok)
        # And an entry that matches the text is used: the same stale DOM
        # under the text's own hash makes the load fail.
        stale["documents"]["notation/lexical.md"]["hash"] = fnv1a64(edited)
        sources["compiled.json"] = json.dumps(stale)
        with self.assertRaises(gencmu.GencmuError):
            gencmu.load_dialect_sources(sources, "p.md")


if __name__ == "__main__":
    unittest.main()
