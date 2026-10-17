"""The fixpoint of the notation and the precompiled DOMs (engine §8)."""

from __future__ import annotations

import functools
import json
import unittest
from unittest.mock import patch

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
            {"name": stage.name, "documents": [{"path": path, "dom": dom} for path, dom in stage.documents]} for stage in pipeline.stages
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
        self.assertEqual(self.compiled["unicode"], fnv1a64(bundled_text("unicode.txt") or ""))

    def test_dialects_with_and_without_the_cache(self) -> None:
        """Each cached document equals a fresh reading.

        Both loading paths give the same stages, grammars, and features.
        One worker shares the fresh reads between these comparisons.
        """
        self.assertTrue(self.compiled["documents"])
        for path, entry in self.compiled["documents"].items():
            with self.subTest(document=path):
                text = bundled_text(path)
                assert text is not None
                self.assertEqual(entry["hash"], fnv1a64(text))
                self.assertEqual(fresh_dom(path), entry["dom"])

        names = sorted(entry.name[:-3] for entry in _bundled_root().joinpath("dialects").iterdir() if entry.name.endswith(".md"))
        self.assertTrue(names)
        for name in names:
            with self.subTest(dialect=name):
                path = f"dialects/{name}.md"
                cached = _Loader(bundled_text, _resources())
                self.assertTrue(cached.compiled)
                uncached = _Loader(bundled_text, _resources(), use_cache=False)
                uncached.dom = fresh_dom  # type: ignore[method-assign]
                with (
                    patch.object(cached.reader, "read", side_effect=AssertionError("compiled grammar cache was bypassed")),
                    patch.object(cached.reader.doms, "get", side_effect=AssertionError("compiled grammar cache was bypassed")),
                ):
                    a = cached.load(path)
                b = uncached.load(path)
                self.assertEqual(b.stage_names, a.stage_names)
                self.assertEqual(b.grammars, a.grammars)
                self.assertEqual((b.features, b.declared), (a.features, a.declared))

    def test_parsing_with_and_without_the_cache(self) -> None:
        cached = gencmu.load_dialect("notation")
        fresh = gencmu.load_dialect("notation", use_cache=False)
        for text in (
            "%rule text A B",
            '%rule a $x:A [{B #}]\n%conditions $x.source-text = "y"\n%emits $',
            "%rule a {... A / [+KU]} :: B\n",
        ):
            with self.subTest(text=text):
                self.assertEqual(gencmu.to_json(cached.parse(text)), gencmu.to_json(fresh.parse(text)))

    def test_a_stale_entry_is_a_miss(self) -> None:
        """An entry whose hash does not match the text is not used."""
        lexical = bundled_text("notation/lexical.md")
        assert lexical is not None
        stale = json.loads(json.dumps(self.compiled))
        stale["documents"]["notation/lexical.md"]["dom"] = {
            "format": DOM_FORMAT,
            "rules": [],
            "directives": [],
            "constants": [],
            "classifiers": [],
            "implications": [],
        }
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

    def test_an_entry_of_format_17_is_never_used(self) -> None:
        """A library never uses a cached DOM of another version
        (docs/output.md): neither a file of format 17 nor an entry whose
        DOM uses an unsupported format or has an unknown expression member."""
        document = "```jbogenbau\n%ambiguity-resolution greedy\n%rule text {A}\n```\n"
        sources = {"p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n', "g.md": document}
        bootstrap_hash = fnv1a64(bundled_text("notation/bootstrap.json") or "")
        # A DOM with no rules: were it used, the stage would have no rule
        # text and fail to load.
        empty: Dom = {"rules": [], "directives": [], "constants": [], "classifiers": [], "implications": []}

        def load(file_format: int, dom: Dom) -> gencmu.Dialect:
            compiled = {"format": file_format, "bootstrap": bootstrap_hash, "unicode": fnv1a64(bundled_text("unicode.txt") or ""), "documents": {"g.md": {"hash": fnv1a64(document), "dom": dom}}}
            return gencmu.load_dialect_sources({**sources, "compiled.json": json.dumps(compiled)}, "p.md")

        with self.assertRaises(gencmu.GencmuError):
            load(DOM_FORMAT, {"format": DOM_FORMAT, **empty})
        self.assertTrue(load(17, {"format": 17, **empty}).parse_tokens([gencmu.Token("a", frozenset({"A"}), (0, 1), (0, 1))], "a").ok)
        self.assertTrue(
            load(DOM_FORMAT, {"format": 17, **empty}).parse_tokens([gencmu.Token("a", frozenset({"A"}), (0, 1), (0, 1))], "a").ok
        )
        # An unknown expression member makes this DOM a miss.
        # Its condition matches no text, so the result shows source fallback.
        old = read_document(document, "g.md")
        old["rules"][0]["alternatives"][0]["expr"] = {"repeat": {"ref": "A"}, "extra": True}
        old["rules"][0]["conditions"] = [{"op": "=", "left": {"string": "a"}, "right": {"string": "b"}}]
        for file_format in (17, DOM_FORMAT):
            with self.subTest(file_format=file_format):
                dialect = load(file_format, {**old, "format": file_format})
                tokens = [gencmu.Token("a", frozenset({"A"}), (index, index + 1), (2 * index, 2 * index + 1)) for index in range(2)]
                self.assertEqual(gencmu.to_brackets(dialect.parse_tokens(tokens, "a a")), "(a a)")


class Lexical(unittest.TestCase):
    def test_the_lexical_stage_tags_braces_and_the_backslash(self) -> None:
        """Stored token tags follow the lexical grammar.

        Punctuation retains its stage-zero categories. Strings carry their
        lexical tag. Backslash values use engine interpolation (engine §9).
        """
        notation = gencmu.load_dialect("notation")
        result = notation.parse(
            '%rule a ¬f? B "c" "d" {E ... / "$(_005C)"} | g! %tags X %rulex $e ¬h "x".."y" _L "a"... [+F] [+G]',
            until="lexical",
        )
        self.assertTrue(result.ok, result.error)
        output = result.stages[0].output
        assert output is not None
        self.assertEqual(
            [(token.text, sorted(token.tags)) for token in output],
            [
                ("%rule", ["KW-RULE"]),
                ("a", ["Identifier", "Lowercase-Name"]),
                ("¬f?", ["Guard"]),
                ("B", ["Identifier", "Uppercase-Name"]),
                ('"c"', ["String"]),
                ('"d"', ["String"]),
                ("{", ["_P", "_Ps"]),
                ("E", ["Identifier", "Uppercase-Name"]),
                ("...", []),
                ("/", ["_P", "_Po"]),
                ('"$(_005C)"', ["String"]),
                ("}", ["_P", "_Pe"]),
                ("|", ["_S", "_Sm"]),
                ("g!", ["Guard"]),
                ("%tags", ["Keyword"]),
                ("X", ["Identifier", "Uppercase-Name"]),
                ("%rulex", ["Keyword"]),
                ("$e", ["Capture"]),
                ("¬", ["_S", "_Sm"]),
                ("h", ["Identifier", "Lowercase-Name"]),
                ('"x"', ["String"]),
                ("..", []),
                ('"y"', ["String"]),
                ("_L", ["Engine-Tag"]),
                ('"a"', ["String"]),
                ("...", []),
                ("[", ["_P", "_Ps"]),
                ("+", ["_S", "_Sm"]),
                ("F", ["Identifier", "Uppercase-Name"]),
                ("]", ["_P", "_Pe"]),
                ("[", ["_P", "_Ps"]),
                ("+", ["_S", "_Sm"]),
                ("G", ["Identifier", "Uppercase-Name"]),
                ("]", ["_P", "_Pe"]),
            ],
        )


if __name__ == "__main__":
    unittest.main()
