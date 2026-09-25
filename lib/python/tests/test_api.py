"""The API of docs/api.md: the three loaders, the options and the errors."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import gencmu
from gencmu._dialect import bundled_text

PIPELINE = """# A test dialect

## Sounds <?stage sounds?>

- [Sounds](sounds.md) <?grammar?>

## Words <?stage words?>

- [Words](words.md) <?grammar?>

## Syntax <?stage syntax?>

- [Syntax](syntax.md) <?grammar?>
"""

SOUNDS = """# Sounds

```jbogenbau
%ambiguity-resolution greedy

%rule text
  [c] ...

%rule c
  "s" </s/> | "a" </a/> | "m" </m/> | "i" </i/> | "space" </./>
%emits
  $
```
"""

WORDS = """# Words

```jbogenbau
%ambiguity-resolution lazy

%rule text
  [piece] ...

%rule piece
  word | pause

%rule pause
  /./
%emits
  ε

%rule word
  /s/ /a/ | /m/ /i/
%emits
  $ <"WORD">
```
"""

SYNTAX = """# Syntax

```jbogenbau
%ambiguity-resolution greedy

%rule text
  @¬sa-su WORD ... | @sa-su WORD ... <"ERASING">
```
"""

SOURCES = {"dialect.md": PIPELINE, "sounds.md": SOUNDS, "words.md": WORDS, "syntax.md": SYNTAX}

ELIDING = {
    "p.md": "## Main <?stage main?>\n\n- [g](g.md) <?grammar?>\n",
    "g.md": "```jbogenbau\n%ambiguity-resolution greedy elision-only\n%elidable KU\n%rule text s [KU] | s B [KU]\n%rule s A [B]\n```\n",
}


def elided_tokens() -> tuple[list[gencmu.Token], str]:
    return (
        [
            gencmu.Token("a", {"A": True}, (0, 1), (0, 1)),
            gencmu.Token("b", {"B": True}, (1, 2), (2, 3)),
        ],
        "a b",
    )


class Loaders(unittest.TestCase):
    def test_bundled(self) -> None:
        dialect = gencmu.load_dialect("notation")
        self.assertEqual(dialect.stage_names, ["lexical", "syntax"])
        result = dialect.parse("%rule text A")
        self.assertTrue(result.ok)
        self.assertEqual(result.tree.rule if result.tree else None, "text")

    def test_unknown_bundled_dialect(self) -> None:
        with self.assertRaises(gencmu.GencmuError) as caught:
            gencmu.load_dialect("no-such-dialect")
        self.assertEqual(caught.exception.kind, "grammar")

    def test_sources(self) -> None:
        dialect = gencmu.load_dialect_sources(SOURCES, "dialect.md")
        self.assertEqual(dialect.stage_names, ["sounds", "words", "syntax"])
        self.assertTrue(dialect.parse("mi mi").ok)

    def test_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "dialects").mkdir()
            (root / "dialects" / "test.md").write_text(PIPELINE.replace("](", "](../grammars/"), encoding="utf-8")
            (root / "grammars").mkdir()
            for name in ("sounds.md", "words.md", "syntax.md"):
                (root / "grammars" / name).write_text(SOURCES[name], encoding="utf-8")
            dialect = gencmu.load_dialect_file(root / "dialects" / "test.md")
            self.assertEqual(gencmu.to_brackets(dialect.parse("mi mi")), "(mi mi)")
            (root / "grammars" / "words.md").unlink()
            with self.assertRaises(gencmu.GencmuError) as caught:
                gencmu.load_dialect_file(str(root / "dialects" / "test.md"))
            self.assertIn("words.md", str(caught.exception))

    def test_sources_bring_their_own_bootstrap(self) -> None:
        """A map may supply the notation's bootstrap; the bundled one is used
        only when it does not."""
        broken = dict(SOURCES)
        broken["notation/bootstrap.json"] = json.dumps({"format": 4, "stages": []})
        with self.assertRaises(gencmu.GencmuError):
            gencmu.load_dialect_sources(broken, "dialect.md", use_cache=False)

    def test_missing_document(self) -> None:
        sources = dict(SOURCES)
        del sources["words.md"]
        with self.assertRaises(gencmu.GencmuError) as caught:
            gencmu.load_dialect_sources(sources, "dialect.md")
        self.assertEqual(caught.exception.document, "words.md")

    def test_grammar_error_position(self) -> None:
        sources = dict(SOURCES)
        sources["syntax.md"] = "# Syntax\n\n```jbogenbau\n%ambiguity-resolution greedy\n%rules text WORD\n```\n"
        with self.assertRaises(gencmu.GencmuError) as caught:
            gencmu.load_dialect_sources(sources, "dialect.md")
        error = caught.exception
        self.assertEqual((error.kind, error.document), ("grammar", "syntax.md"))
        self.assertEqual(error.line, 5)
        self.assertEqual(error.where, f"syntax.md:5:{error.column}")

    def test_pipeline_errors(self) -> None:
        for pipeline in (
            "- [g](g.md) <?grammar?>\n",
            "## A <?stage a?>\n\n- g.md <?grammar?>\n",
            "## A <?stage a?>\n## B <?stage a?>\n",
            "# D <?features?>\n## A <?stage a?>\n",
            "# D <?features 9x?>\n## A <?stage a?>\n",
        ):
            with self.subTest(pipeline=pipeline):
                with self.assertRaises(gencmu.GencmuError):
                    gencmu.load_dialect_sources({"p.md": pipeline, "g.md": SYNTAX}, "p.md")


class Options(unittest.TestCase):
    dialect: gencmu.Dialect

    @classmethod
    def setUpClass(cls) -> None:
        cls.dialect = gencmu.load_dialect_sources(SOURCES, "dialect.md")

    def erasing(self, result: gencmu.ParseResult) -> bool:
        self.assertTrue(result.ok, result.error)
        assert result.tree is not None and result.tree.tags is not None
        return "ERASING" in result.tree.tags

    def test_auto_features(self) -> None:
        self.assertTrue(self.erasing(self.dialect.parse("mi sa mi")))
        self.assertFalse(self.erasing(self.dialect.parse("mi mi")))
        self.assertFalse(self.erasing(self.dialect.parse("mi sa mi", auto_features=False)))

    def test_features(self) -> None:
        self.assertTrue(self.erasing(self.dialect.parse("mi mi", features={"sa-su"})))
        self.assertTrue(self.erasing(self.dialect.parse("mi mi", features=["sa-su"], auto_features=False)))
        with self.assertRaises(gencmu.GencmuError):
            self.dialect.parse("mi", features="sa-su")

    def test_pipeline_features(self) -> None:
        sources = dict(SOURCES)
        sources["dialect.md"] = PIPELINE.replace("# A test dialect", "# A test dialect <?features sa-su?>")
        dialect = gencmu.load_dialect_sources(sources, "dialect.md")
        self.assertEqual(dialect.features, frozenset({"sa-su"}))
        self.assertTrue(self.erasing(dialect.parse("mi mi", auto_features=False)))

    def test_until(self) -> None:
        result = self.dialect.parse("mi sa", until="words")
        self.assertTrue(result.ok)
        self.assertEqual([stage.name for stage in result.stages], ["sounds", "words"])
        words = result.stages[-1].output
        assert words is not None
        self.assertEqual([token.phonemes for token in words], ["mi", "sa"])
        self.assertEqual([token.tags for token in words], [{"WORD": True}, {"WORD": True}])
        only = self.dialect.parse("mi", until="sounds")
        self.assertEqual(len(only.stages), 1)
        with self.assertRaises(gencmu.GencmuError) as caught:
            self.dialect.parse("mi", until="semantics")
        self.assertEqual(caught.exception.kind, "usage")

    def test_elision_only(self) -> None:
        dialect = gencmu.load_dialect_sources(ELIDING, "p.md")
        tokens, text = elided_tokens()
        declared = dialect.parse_tokens(tokens, text)
        self.assertFalse(declared.ok)
        assert declared.error is not None
        self.assertEqual(declared.error.kind, "ambiguous")
        self.assertEqual(len(declared.error.readings or []), 2)
        self.assertTrue(dialect.parse_tokens(tokens, text, elision_only=False).ok)
        plain = gencmu.load_dialect_sources({**ELIDING, "g.md": ELIDING["g.md"].replace(" elision-only", "")}, "p.md")
        self.assertTrue(plain.parse_tokens(tokens, text).ok)
        self.assertFalse(plain.parse_tokens(tokens, text, elision_only=True).ok)

    def test_rejection(self) -> None:
        result = self.dialect.parse("mi xa")
        self.assertFalse(result.ok)
        assert result.error is not None
        self.assertEqual((result.error.kind, result.error.stage, result.error.token), ("rejected", "sounds", 3))
        self.assertEqual((result.error.line, result.error.column), (1, 4))
        self.assertIsNone(result.tree)
        self.assertIsNone(result.stages[-1].verdict)


class Output(unittest.TestCase):
    def test_canonical_json(self) -> None:
        dialect = gencmu.load_dialect_sources(SOURCES, "dialect.md")
        result = dialect.parse("mi", until="words", auto_features=False)
        text = gencmu.to_json(result)
        self.assertEqual(json.loads(text), gencmu.result_json(result))
        self.assertTrue(text.startswith('{"format":1,"ok":true,"stages":[{"name":"sounds","verdict":"unique","output":[{"text":"m","phonemes":"m","tags":{"/m/":true},"span":[0,1],"source":[0,1]}'), text)
        self.assertIn(
            '"tree":{"kind":"rule","rule":"text","span":[0,2],"source":[0,2],"tags":{},"children":[{"kind":"rule","rule":"piece"',
            text,
        )
        self.assertTrue(text.endswith(',"error":null}'))

    def test_error_json(self) -> None:
        dialect = gencmu.load_dialect_sources(SOURCES, "dialect.md")
        value = gencmu.result_json(dialect.parse("mx"))
        self.assertEqual(
            list(value["error"]),
            ["kind", "stage", "token", "source", "line", "column", "expected", "message"],
        )
        self.assertEqual(value["error"]["expected"][0], {"terminal": "a", "rules": ["c"]})
        self.assertIsNone(value["tree"])

    def test_brackets(self) -> None:
        dialect = gencmu.load_dialect_sources(ELIDING, "p.md")
        tokens, text = elided_tokens()
        result = dialect.parse_tokens(tokens, text, elision_only=False)
        self.assertEqual(gencmu.to_brackets(result), "(a b)")
        self.assertEqual(gencmu.to_brackets(result, show_elided=True), "([a b] ⟨ku⟩)")

    def test_brackets_depth(self) -> None:
        sources = {
            "p.md": "## Main <?stage main?>\n\n- [g](g.md) <?grammar?>\n",
            "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text A s %rule s A t %rule t A u %rule u A A\n```\n",
        }
        dialect = gencmu.load_dialect_sources(sources, "p.md")
        tokens = [gencmu.Token(str(n), {"A": True}, (n, n + 1), (2 * n, 2 * n + 1)) for n in range(5)]
        result = dialect.parse_tokens(tokens, "0 1 2 3 4")
        self.assertEqual(gencmu.to_brackets(result), "(0 [1 {2 (3 4)}])")

    def test_brackets_pause(self) -> None:
        """A label writes each pause in a token's phonemes as a space, and a
        token with no phonemes is labelled with its text as it is (docs/output.md)."""
        sources = {
            "p.md": "## Main <?stage main?>\n\n- [g](g.md) <?grammar?>\n",
            "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text A A\n```\n",
        }
        dialect = gencmu.load_dialect_sources(sources, "p.md")
        tokens = [
            gencmu.Token("klama bu", {"A": True}, (0, 1), (0, 8), "klama.bu"),
            gencmu.Token("x.y", {"A": True}, (1, 2), (9, 12), ""),
        ]
        result = dialect.parse_tokens(tokens, "klama bu x.y")
        self.assertEqual(gencmu.to_brackets(result), "(klama bu x.y)")


class Deep(unittest.TestCase):
    def test_long_left_recursion(self) -> None:
        """A derivation as deep as the text is long needs no recursion."""
        dialect = gencmu.load_dialect_sources(SOURCES, "dialect.md")
        text = " ".join(["mi"] * 1500)
        result = dialect.parse(text, auto_features=False)
        self.assertTrue(result.ok, result.error)
        self.assertEqual(len(result.stages[1].output or []), 1500)
        self.assertTrue(gencmu.to_json(result))
        self.assertEqual(gencmu.to_brackets(result), "(" + text + ")")


if __name__ == "__main__":
    unittest.main()


class Robustness(unittest.TestCase):
    """Malformed support files, and grammars and trees deeper than the call
    stack."""

    MAIN = "## Main <?stage main?>\n\n- [g](g.md) <?grammar?>\n"

    def grammar(self, rules: str) -> dict[str, str]:
        return {"p.md": self.MAIN, "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n" + rules + "\n```\n"}

    def test_malformed_bootstrap(self) -> None:
        for bootstrap in ('{"format":1,"stages":[]}', "[]", "not json", "[" * 2000 + "]" * 2000, '{"format":1,"stages":[{"name":"x","documents":[{"path":"a","dom":{"rules":[{}]}}]}]}'):
            with self.subTest(bootstrap=bootstrap[:40]):
                sources = self.grammar('%rule text "a"')
                sources["notation/bootstrap.json"] = bootstrap
                with self.assertRaises(gencmu.GencmuError) as caught:
                    gencmu.load_dialect_sources(sources, "p.md", use_cache=False)
                self.assertEqual(caught.exception.kind, "grammar")

    def test_malformed_cache_entry_is_a_miss(self) -> None:
        from gencmu._hash import fnv1a64

        sources = self.grammar('%rule text "a"')
        compiled = {
            "format": 4,
            "bootstrap": fnv1a64(bundled_text("notation/bootstrap.json") or ""),
            "documents": {"g.md": {"hash": fnv1a64(sources["g.md"]), "dom": {"format": 4, "rules": [{}], "directives": []}}},
        }
        sources["compiled.json"] = json.dumps(compiled)
        dialect = gencmu.load_dialect_sources(sources, "p.md")
        self.assertTrue(dialect.parse("a", auto_features=False).ok)

    def test_unreadable_cache_is_no_cache(self) -> None:
        for compiled in ("[" * 2000 + "]" * 2000, "not json", "[]"):
            with self.subTest(compiled=compiled[:10]):
                sources = self.grammar('%rule text "a"')
                sources["compiled.json"] = compiled
                dialect = gencmu.load_dialect_sources(sources, "p.md")
                self.assertTrue(dialect.parse("a", auto_features=False).ok)

    def test_bundled_doms_are_well_formed(self) -> None:
        from gencmu._validate import dom_problem

        compiled = json.loads(bundled_text("compiled.json") or "{}")
        for path, entry in compiled["documents"].items():
            with self.subTest(document=path):
                self.assertIsNone(dom_problem(entry["dom"]))

    def test_deeply_nested_grammar(self) -> None:
        """A grammar nested as deep as engine §9 allows loads and parses."""
        depth = 250
        rules = "%rule text " + "[" * depth + '("a")' + "]" * depth
        rules += " <" + "(" * depth + '"T"' + ")" * depth + "> %conditions " + "¬" * depth + '"a" = "a"'
        dialect = gencmu.load_dialect_sources(self.grammar(rules), "p.md")
        result = dialect.parse("a", auto_features=False)
        self.assertTrue(result.ok, result.error)
        self.assertEqual(gencmu.to_brackets(result), "a")
        assert result.tree is not None
        self.assertEqual(result.tree.tags, {"T": True})

    def test_too_deeply_nested_grammar(self) -> None:
        """Nesting more than 256 deep is an error at the rule that holds it."""
        for rules in (
            '%rule x "b"\n%rule text ' + "[" * 300 + '"a"' + "]" * 300,
            '%rule x "b"\n%rule text "a" %conditions ' + "¬" * 300 + '"a" = "a"',
        ):
            with self.subTest(rules=rules[:30]):
                with self.assertRaises(gencmu.GencmuError) as caught:
                    gencmu.load_dialect_sources(self.grammar(rules), "p.md")
                self.assertEqual((caught.exception.document, caught.exception.line, caught.exception.column), ("g.md", 4, 1))

    def test_deep_tree(self) -> None:
        dialect = gencmu.load_dialect_sources(self.grammar('%rule text text "a" | "a"'), "p.md")
        result = dialect.parse("a" * 10000, auto_features=False)
        self.assertTrue(result.ok)
        text = gencmu.to_json(result)
        self.assertEqual(text.count('"rule":"text"'), 10000)
        brackets = gencmu.to_brackets(result)
        self.assertTrue(brackets.startswith("(" + "[{(" * 3) and brackets.endswith("a)"))
