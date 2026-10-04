"""The API of docs/api.md: the three loaders, the options and the errors."""

from __future__ import annotations

import gc
import inspect
import json
import sys
import tempfile
import unittest
import weakref
from pathlib import Path

import gencmu
from gencmu._dialect import DOM_FORMAT, bundled_text

from .shared import case_sources, load_case_dialect

PIPELINE = """# A test dialect

## Sounds

```jbogenbau
%stage sounds
```

- [Sounds](sounds.md)
  ```jbogenbau
  %include "sounds.md"
  ```

## Words

```jbogenbau
%stage words
```

- [Words](words.md)
  ```jbogenbau
  %include "words.md"
  ```

## Syntax

```jbogenbau
%stage syntax
```

- [Syntax](syntax.md)
  ```jbogenbau
  %include "syntax.md"
  ```
"""

SOUNDS = """# Sounds

```jbogenbau
%ambiguity-resolution greedy

%rule text
  [{c}]

%rule c
  's' </s/> | 'a' </a/> | 'm' </m/> | 'i' </i/> | '\\p{White_Space}' </./>
%emits
  $
```
"""

WORDS = """# Words

```jbogenbau
%ambiguity-resolution lazy

%rule text
  [{piece}]

%rule piece
  word | pause

%rule pause
  /./
%emits
  ε

%rule word
  /s/ /a/ <SA> | /m/ /i/
%emits
  $ <WORD>
```
"""

SYNTAX = """# Syntax

```jbogenbau
%ambiguity-resolution greedy

%rule text
  ¬sa-su? {WORD} | sa-su? {WORD} <ERASING>
```
"""

SOURCES = {"dialect.md": PIPELINE, "sounds.md": SOUNDS, "words.md": WORDS, "syntax.md": SYNTAX}

ELIDING = {
    "p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n',
    "g.md": "```jbogenbau\n%ambiguity-resolution greedy elision-only\n%rule text s [+KU] | s B [+KU]\n%rule s A [B]\n```\n",
}


def elided_tokens() -> tuple[list[gencmu.Token], str]:
    return (
        [
            gencmu.Token("a", frozenset({"A"}), (0, 1), (0, 1)),
            gencmu.Token("b", frozenset({"B"}), (1, 2), (2, 3)),
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
            (root / "dialects" / "test.md").write_text(PIPELINE.replace("](", "](../grammars/").replace('%include "', '%include "../grammars/'), encoding="utf-8")
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
        broken["notation/bootstrap.json"] = json.dumps({"format": DOM_FORMAT, "stages": []})
        with self.assertRaises(gencmu.GencmuError):
            gencmu.load_dialect_sources(broken, "dialect.md", use_cache=False)

    def test_missing_document(self) -> None:
        sources = dict(SOURCES)
        del sources["words.md"]
        with self.assertRaises(gencmu.GencmuError) as caught:
            gencmu.load_dialect_sources(sources, "dialect.md")
        # The error stands at the %include of the missing document.
        error = caught.exception
        self.assertEqual((error.document, error.line, error.column), ("dialect.md", 22, 3))
        self.assertIn("words.md", error.message)

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
            "# No stage\n",
            '```jbogenbau\n%include "g.md"\n```\n',
            '```jbogenbau\n%stage a\n%include "missing.md"\n```\n',
            '```jbogenbau\n%stage a\n%include g.md\n```\n',
            '```jbogenbau\n%stage a\n%include "p.md"\n```\n',
            '```jbogenbau\n%stage a\n%include "g.md"\n%stage a\n```\n',
            '```jbogenbau\n%stage a\n%stage b\n%include "g.md"\n```\n',
            '```jbogenbau\n%features\n%stage a\n%include "g.md"\n```\n',
            '```jbogenbau\n%features 9x\n%stage a\n%include "g.md"\n```\n',
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
        sources["dialect.md"] = PIPELINE.replace("# A test dialect", "# A test dialect\n\n```jbogenbau\n%features sa-su\n```")
        dialect = gencmu.load_dialect_sources(sources, "dialect.md")
        self.assertEqual(dialect.features, (gencmu.Feature("sa-su", "gate", True),))
        self.assertTrue(self.erasing(dialect.parse("mi mi", auto_features=False)))
        # A caller can turn off a feature the pipeline turns on.
        self.assertFalse(self.erasing(dialect.parse("mi mi", without_features=["sa-su"], auto_features=False)))

    def test_dialect_features(self) -> None:
        self.assertEqual(self.dialect.features, (gencmu.Feature("sa-su", "gate", False),))

    def test_without_features(self) -> None:
        """Auto features do not add a feature the caller turned off, and a
        name both turned on and off is a mistake of the caller (engine §13)."""
        self.assertFalse(self.erasing(self.dialect.parse("mi sa mi", without_features={"sa-su"})))
        for options in ({"features": ["sa-su"], "without_features": ("sa-su",)}, {"without_features": "sa-su"}):
            with self.subTest(options=options):
                with self.assertRaises(gencmu.GencmuError) as caught:
                    self.dialect.parse("mi", **options)  # type: ignore[arg-type]
                self.assertEqual(caught.exception.kind, "usage")

    def test_until(self) -> None:
        result = self.dialect.parse("mi sa", until="words")
        self.assertTrue(result.ok)
        self.assertEqual([stage.name for stage in result.stages], ["sounds", "words"])
        words = result.stages[-1].output
        assert words is not None
        self.assertEqual([token.phonemes for token in words], ["mi", "sa"])
        self.assertEqual([token.tags for token in words], [frozenset({"WORD"}), frozenset({"WORD"})])
        only = self.dialect.parse("mi", until="sounds")
        self.assertEqual(len(only.stages), 1)
        with self.assertRaises(gencmu.GencmuError) as caught:
            self.dialect.parse("mi", until="semantics")
        self.assertEqual(caught.exception.kind, "usage")
        # An empty name names no stage either (docs/api.md).
        with self.assertRaises(gencmu.GencmuError) as caught:
            self.dialect.parse("mi", until="")
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

    def test_tested_terminator(self) -> None:
        """An elided terminator with an = test keeps the test's string
        inside, and its output is that of any elided node (engine §7,
        §12)."""
        grammar = '```jbogenbau\n%ambiguity-resolution greedy\n%rule text A [+KU="ku"]\n```\n'
        dialect = gencmu.load_dialect_sources({"p.md": ELIDING["p.md"], "g.md": grammar}, "p.md")
        result = dialect.parse_tokens([gencmu.Token("a", frozenset({"A"}), (0, 1), (0, 1), "a")], "a")
        assert result.tree is not None
        elided = result.tree.children[1]
        self.assertEqual((elided.kind, elided.terminal, elided.sound), ("elided", "KU", "ku"))
        value = gencmu.result_json(result)
        self.assertEqual(sorted(value["tree"]["children"][1]), ["kind", "source", "span", "terminal"])

    def test_caller_label(self) -> None:
        """A token that a caller supplies has its text as its label, and the
        caller's token stays as it is (engine §5, docs/api.md)."""
        grammar = "```jbogenbau\n%ambiguity-resolution greedy\n%rule text $a(A)\n%emits $a <X>\n```\n"
        dialect = gencmu.load_dialect_sources({"p.md": ELIDING["p.md"], "g.md": grammar}, "p.md")
        token = gencmu.Token("a", frozenset({"A"}), (0, 1), (0, 1), "a", label="CUSTOM")
        result = dialect.parse_tokens([token], "a", auto_features=False)
        self.assertEqual(result.stages[0].input[0].label, "a")
        self.assertEqual(result.stages[0].output[0].label, "a")
        self.assertEqual(gencmu.to_brackets(result), "a")
        self.assertEqual(token.label, "CUSTOM", "the caller's token changed")

    def test_caller_ranges(self) -> None:
        """A caller's source must lie within the text, in code points, and a
        caller's span must start at 0 or later and not end before it starts.
        Either mistake is a usage error. Sources can overlap or lie out of
        order (docs/api.md, engine §11)."""
        grammar = "```jbogenbau\n%ambiguity-resolution greedy\n%rule text A B\n%emits $\n```\n"
        dialect = gencmu.load_dialect_sources({"p.md": ELIDING["p.md"], "g.md": grammar}, "p.md")

        def tokens(first: tuple[int, int], second: tuple[int, int], span: tuple[int, int] = (1, 2)) -> list[gencmu.Token]:
            return [gencmu.Token("a", frozenset({"A"}), (0, 1), first), gencmu.Token("b", frozenset({"B"}), span, second)]

        for source in ((0, 6), (-2, 1), (2, 1), (3, 3)):
            with self.subTest(source=source):
                with self.assertRaises(gencmu.GencmuError) as caught:
                    dialect.parse_tokens(tokens((0, 1), source), "ab", auto_features=False)
                self.assertEqual(caught.exception.kind, "usage")
                self.assertIn("source", str(caught.exception))
        for span in ((-1, 0), (2, 1)):
            with self.subTest(span=span):
                with self.assertRaises(gencmu.GencmuError) as caught:
                    dialect.parse_tokens(tokens((0, 1), (1, 2), span), "ab", auto_features=False)
                self.assertEqual(caught.exception.kind, "usage")
                self.assertIn("span", str(caught.exception))
        result = dialect.parse_tokens(tokens((1, 2), (0, 2)), "ab", auto_features=False)
        self.assertTrue(result.ok, result.error)
        output = result.stages[0].output
        assert output is not None
        self.assertEqual((output[0].source, output[0].text), ((0, 2), "ab"))

    def test_caller_attachments(self) -> None:
        """A caller cannot supply attachments: a token with a list that is
        not empty is a usage error, and empty lists are dropped. The
        caller's tokens stay as they are (docs/api.md)."""
        grammar = "```jbogenbau\n%ambiguity-resolution greedy\n%rule text $a(A)\n%emits $a\n```\n"
        dialect = gencmu.load_dialect_sources({"p.md": ELIDING["p.md"], "g.md": grammar}, "p.md")
        attached = gencmu.Token("i", frozenset({"I"}), None, (2, 3))
        for side in ("before", "after"):
            with self.subTest(side=side):
                token = gencmu.Token("a", frozenset({"A"}), (0, 1), (0, 1), **{side: [attached]})
                with self.assertRaises(gencmu.GencmuError) as caught:
                    dialect.parse_tokens([token], "a i", auto_features=False)
                self.assertEqual(caught.exception.kind, "usage")
                self.assertEqual(getattr(token, side), [attached], "the caller's token changed")
        empty: list[gencmu.Token] = []
        token = gencmu.Token("a", frozenset({"A"}), (0, 1), (0, 1), before=empty, after=[])
        result = dialect.parse_tokens([token], "a", auto_features=False)
        self.assertTrue(result.ok, result.error)
        self.assertIsNot(result.stages[0].input[0].before, empty)
        self.assertNotIn("before", gencmu.result_json(result)["stages"][0]["output"][0])

    def test_tested_expected(self) -> None:
        """The message of a rejection writes a tested terminal with its
        test, as the expected list does (docs/output.md)."""
        grammar = '```jbogenbau\n%ambiguity-resolution greedy\n%rule text LE="la" | LE="lai" C | LE∩(~D ∪ C)≠∅ D\n```\n'
        dialect = gencmu.load_dialect_sources({"p.md": ELIDING["p.md"], "g.md": grammar}, "p.md")
        result = dialect.parse_tokens([gencmu.Token("lo", frozenset({"LE"}), (0, 2), (0, 2), "lo")], "lo")
        assert result.error is not None
        self.assertEqual([entry.terminal for entry in result.error.expected or []], ['LE="la"', 'LE="lai"', "LE∩(C ∪ D)≠∅"])
        self.assertIn('it expected LE="la" (text), LE="lai" (text), LE∩(C ∪ D)≠∅ (text)', result.error.message)

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
        self.assertTrue(text.startswith('{"format":9,"ok":true,"stages":[{"name":"sounds","verdict":"unique","output":[{"text":"m","phonemes":"m","label":"m","tags":["/m/"],"span":[0,1],"source":[0,1]}'), text)
        self.assertIn(
            '"tree":{"kind":"rule","rule":"text","span":[0,2],"source":[0,2],"tags":[],"children":[{"kind":"rule","rule":"piece"',
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
        # In code point order: a property is its written form (engine §4).
        self.assertEqual(value["error"]["expected"][0], {"terminal": "'\\p{White_Space}'", "rules": ["c"]})
        self.assertEqual(value["error"]["expected"][1], {"terminal": "'a'", "rules": ["c"]})
        self.assertIsNone(value["tree"])

    def test_witness_lost_json(self) -> None:
        """The members of elision-witness-lost stand in the order kind,
        stage, code, message, chosen, completion, and a record has its sound
        last and only for a tested terminator (docs/output.md)."""
        from gencmu._output import error_json

        chosen = gencmu.Node("rule", (0, 1), (0, 1), rule="text")
        error = gencmu.ParseError(
            "grammar",
            "the main stage could not reconstruct its chosen derivation for elision-only",
            stage="main",
            code="elision-witness-lost",
            chosen=chosen,
            completion=[gencmu.Restoration("KU", 1, (1, 1), "ku"), gencmu.Restoration("VAU", 1, (1, 1))],
        )
        value = error_json(error)
        self.assertEqual(list(value), ["kind", "stage", "code", "message", "chosen", "completion"])
        self.assertEqual(value["code"], "elision-witness-lost")
        self.assertEqual(value["chosen"]["rule"], "text")
        self.assertEqual(
            value["completion"],
            [{"terminal": "KU", "at": 1, "source": [1, 1], "sound": "ku"}, {"terminal": "VAU", "at": 1, "source": [1, 1]}],
        )
        self.assertEqual(list(value["completion"][0]), ["terminal", "at", "source", "sound"])
        # Any other error has no code.
        self.assertNotIn("code", error_json(gencmu.ParseError("grammar", "a defect", stage="main")))

    def test_brackets(self) -> None:
        dialect = gencmu.load_dialect_sources(ELIDING, "p.md")
        tokens, text = elided_tokens()
        result = dialect.parse_tokens(tokens, text, elision_only=False)
        self.assertEqual(gencmu.to_brackets(result), "(a b)")
        self.assertEqual(gencmu.to_brackets(result, show_elided=True), "([a b] ⟨ku⟩)")

    def test_brackets_depth(self) -> None:
        sources = {
            "p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n',
            "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text A s %rule s A t %rule t A u %rule u A A\n```\n",
        }
        dialect = gencmu.load_dialect_sources(sources, "p.md")
        tokens = [gencmu.Token(str(n), frozenset({"A"}), (n, n + 1), (2 * n, 2 * n + 1)) for n in range(5)]
        result = dialect.parse_tokens(tokens, "0 1 2 3 4")
        self.assertEqual(gencmu.to_brackets(result), "(0 [1 {2 (3 4)}])")

    def test_brackets_labels(self) -> None:
        """Brackets show each token by its label, not its phonemes. A token
        that a caller supplies has its text as its label, whatever label it
        carries (engine §5, docs/output.md)."""
        sources = {
            "p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n',
            "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text A A A\n```\n",
        }
        dialect = gencmu.load_dialect_sources(sources, "p.md")
        tokens = [
            gencmu.Token("klama bu", frozenset({"A"}), (0, 1), (0, 8), "klama.bu"),
            gencmu.Token("x.y", frozenset({"A"}), (1, 2), (9, 12), ""),
            gencmu.Token("ab", frozenset({"A"}), (2, 3), (13, 15), "ab", label="a..b"),
        ]
        self.assertEqual([token.label for token in tokens], ["klama bu", "x.y", "a..b"])
        result = dialect.parse_tokens(tokens, "klama bu x.y ab")
        self.assertEqual(gencmu.to_brackets(result), "(klama bu x.y ab)")


# A two-stage pipeline whose first stage attaches ``b`` before a word and
# ``i``, with ``n`` after it, after the word (engine §11).
ATTACHING = {
    "p.md": '```jbogenbau\n%stage a\n%include "a.md"\n%stage b\n%include "b.md"\n```\n',
    "a.md": """```jbogenbau
%ambiguity-resolution greedy
%rule text {item}
%rule item | $w(word) | $b(bb) $w(word) | $w(word) $a(ind) | $b(bb) $w(word) $a(ind)
%emits ($b) $w ($a)
%rule word 'w' <W> | 'z' <Z>
%rule bb 'b' <B>
%emits $
%rule ind | $u(uu) | $u(uu) $n(nn)
%emits $u ($n)
%rule uu 'i' <I ∪ UI>
%rule nn 'n'
%emits $ <~low>
```
""",
    "b.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text {pair}\n%rule pair W Z\n```\n",
}


class Attachments(unittest.TestCase):
    """Attachments in the result and the brackets (engine §11,
    docs/output.md)."""

    def test_attached_tokens(self) -> None:
        dialect = gencmu.load_dialect_sources(ATTACHING, "p.md")
        result = dialect.parse("bwinz", auto_features=False)
        self.assertTrue(result.ok, result.error)
        word = (result.stages[0].output or [])[0]
        self.assertEqual([token.label for token in word.before], ["b"])
        self.assertEqual([token.label for token in word.after], ["i"])
        self.assertEqual([token.label for token in word.after[0].after], ["n"])
        # An attached token has no span, and its source is in the text.
        self.assertIsNone(word.before[0].span)
        self.assertEqual(word.after[0].after[0].source, (3, 4))
        # The token that the next stage reads keeps them.
        self.assertIs(result.stages[1].input[0], word)
        value = gencmu.result_json(result)["stages"][0]["output"][0]
        self.assertEqual(list(value), ["text", "phonemes", "label", "tags", "span", "source", "before", "after"])
        self.assertEqual(value["after"][0]["after"], [{"text": "n", "phonemes": "", "label": "n", "tags": ["low"], "source": [3, 4]}])
        self.assertEqual(gencmu.to_brackets(result), "([b w {i n}] z)")

    def test_error_order(self) -> None:
        """Of two errors in one item, the before-attachment's comes first
        (engine §11)."""
        case = json.loads((Path(__file__).resolve().parents[3] / "tests" / "engine" / "attach-error-order.json").read_text("utf-8"))
        dialect = gencmu.load_dialect_sources(case["documents"], case["pipeline"])
        result = dialect.parse(case["input"], auto_features=False)
        assert result.error is not None
        self.assertIn("two phoneme tags", result.error.message)

    def test_inserted_error_order(self) -> None:
        """An inserted token's error comes after an earlier attachment's
        (engine §11)."""
        case = json.loads((Path(__file__).resolve().parents[3] / "tests" / "engine" / "attach-error-insert-order.json").read_text("utf-8"))
        dialect = gencmu.load_dialect_sources(*case_sources(case))
        result = dialect.parse(case["input"], auto_features=False)
        assert result.error is not None
        self.assertIn('tag("?")', result.error.message)

    def test_deep_nesting(self) -> None:
        """Attachments as deep as the text is long need no recursion."""
        grammar = "```jbogenbau\n%ambiguity-resolution greedy\n%rule text | $w(W) | $w(W) $a(text)\n%emits $w ($a)\n```\n"
        dialect = gencmu.load_dialect_sources({"p.md": ELIDING["p.md"], "g.md": grammar}, "p.md")
        count = 1500
        tokens = [gencmu.Token("w", frozenset({"W"}), (n, n + 1), (2 * n, 2 * n + 1)) for n in range(count)]
        result = dialect.parse_tokens(tokens, " ".join(["w"] * count), auto_features=False)
        self.assertTrue(result.ok, result.error)
        self.assertEqual(len(result.stages[0].output or []), 1)
        self.assertTrue(gencmu.to_json(result))
        # So do the equality and the representation of a token.
        again = dialect.parse_tokens(tokens, " ".join(["w"] * count), auto_features=False)
        self.assertEqual(result, again)
        self.assertEqual(repr(result.stages[0].output).count("Token(text='w'"), count)


class GrammarFaults(unittest.TestCase):
    """A defect of a grammar found while parsing is an error with the stage
    and no position (engine §13, docs/output.md)."""

    def test_a_fault_has_no_position(self) -> None:
        own_span = (
            "a condition asks whether its own span parses as text from inside the parse of that span as text: "
            "the grammar defines text in terms of itself over the same text"
        )
        for grammar, message in [
            ("%implies A ⟹ /o/\n%rule text [{word}]\n%rule word $w(W) <A ∪ /e/>\n%emits\n  $", "an emitted token has two phoneme tags: /e/, /o/"),
            ("%rule text [{word}]\n%rule word $w(W) </e/ ∪ /o/>\n%emits\n  $\n%opaque", "an emitted token has two phoneme tags: /e/, /o/"),
            ("%implies /e/ ⟹ /o/\n%rule text [{word}]\n%rule word $w(W)\n%emits\n  $w, /e/", "an emitted token has two phoneme tags: /e/, /o/"),
            ("%rule text $a(W) %emits $a <tags($a) ∩ Z>", "text emits a token with no tags; a rule that emits nothing says %emits ε"),
            ("%rule text $a(x) %conditions ¬matches($a, text)\n%rule x W", own_span),
            ("%rule text $a(x) %conditions ¬begins(from($a), text)\n%rule x W", own_span),
        ]:
            with self.subTest(grammar=grammar):
                sources = {
                    "p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n',
                    "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n" + grammar + "\n```\n",
                }
                dialect = gencmu.load_dialect_sources(sources, "p.md", use_cache=False)
                result = dialect.parse_tokens([gencmu.Token("x", frozenset({"W"}), (0, 1), (0, 1), "x")], "x", auto_features=False)
                self.assertFalse(result.ok)
                self.assertEqual(result.error, gencmu.ParseError("grammar", message, stage="main"))


class Warnings(unittest.TestCase):
    def dialect(self, rules: str) -> gencmu.Dialect:
        sources = {
            "p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n',
            "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n" + rules + "\n```\n",
        }
        return gencmu.load_dialect_sources(sources, "p.md")

    def test_result_and_json(self) -> None:
        """A warning is a ParseWarning of the result, and in the canonical
        JSON after the error only when there is one (docs/output.md)."""
        dialect = self.dialect("%rule text w! A | B")
        tokens = [gencmu.Token("a", frozenset({"A"}), (0, 1), (0, 1))]
        result = dialect.parse_tokens(tokens, "a", features=["w"])
        self.assertEqual(result.warnings, [gencmu.ParseWarning("main", "w", "text", (0, 1), (0, 1))])
        self.assertTrue(
            gencmu.to_json(result).endswith(',"error":null,"warnings":[{"stage":"main","feature":"w","rule":"text","span":[0,1],"source":[0,1]}]}')
        )
        quiet = dialect.parse_tokens(tokens, "a")
        self.assertEqual(quiet.warnings, [])
        self.assertNotIn("warnings", gencmu.result_json(quiet))

    def test_flat_braces(self) -> None:
        """A list of flat braces is no node of the tree, so its helper gives
        no warnings of its own (engine §3.2, §12)."""
        dialect = self.dialect("%rule text w! {x}\n%rule x v! A")
        tokens = [gencmu.Token(str(n), frozenset({"A"}), (n, n + 1), (2 * n, 2 * n + 1)) for n in range(3)]
        result = dialect.parse_tokens(tokens, "0 1 2", features=["v", "w"])
        self.assertEqual(
            [(warning.feature, warning.rule, warning.span, warning.source) for warning in result.warnings],
            [("w", "text", (0, 3), (0, 5)), ("v", "x", (0, 1), (0, 1)), ("v", "x", (1, 2), (2, 3)), ("v", "x", (2, 3), (4, 5))],
        )


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

    MAIN = '```jbogenbau\n%stage main\n%include "g.md"\n```\n'

    def grammar(self, rules: str) -> dict[str, str]:
        return {"p.md": self.MAIN, "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n" + rules + "\n```\n"}

    def test_malformed_bootstrap(self) -> None:
        for bootstrap in ('{"format":1,"stages":[]}', "[]", "not json", "[" * 2000 + "]" * 2000, '{"format":1,"stages":[{"name":"x","documents":[{"path":"a","dom":{"rules":[{}]}}]}]}'):
            with self.subTest(bootstrap=bootstrap[:40]):
                sources = self.grammar("%rule text 'a'")
                sources["notation/bootstrap.json"] = bootstrap
                with self.assertRaises(gencmu.GencmuError) as caught:
                    gencmu.load_dialect_sources(sources, "p.md", use_cache=False)
                self.assertEqual(caught.exception.kind, "grammar")

    def test_malformed_cache_entry_is_a_miss(self) -> None:
        from gencmu._hash import fnv1a64

        sources = self.grammar("%rule text 'a'")
        compiled = {
            "format": DOM_FORMAT,
            "bootstrap": fnv1a64(bundled_text("notation/bootstrap.json") or ""),
            "documents": {"g.md": {"hash": fnv1a64(sources["g.md"]), "dom": {"format": DOM_FORMAT, "rules": [{}], "directives": [], "constants": [], "classifiers": [], "implications": []}}},
        }
        sources["compiled.json"] = json.dumps(compiled)
        dialect = gencmu.load_dialect_sources(sources, "p.md")
        self.assertTrue(dialect.parse("a", auto_features=False).ok)

    def test_unreadable_cache_is_no_cache(self) -> None:
        for compiled in ("[" * 2000 + "]" * 2000, "not json", "[]"):
            with self.subTest(compiled=compiled[:10]):
                sources = self.grammar("%rule text 'a'")
                sources["compiled.json"] = compiled
                dialect = gencmu.load_dialect_sources(sources, "p.md")
                self.assertTrue(dialect.parse("a", auto_features=False).ok)

    def test_bundled_doms_are_well_formed(self) -> None:
        from gencmu._dialect import _unicode_table
        from gencmu._validate import dom_problem

        unicode = _unicode_table(bundled_text("unicode.txt") or "")
        compiled = json.loads(bundled_text("compiled.json") or "{}")
        for path, entry in compiled["documents"].items():
            with self.subTest(document=path):
                self.assertIsNone(dom_problem(entry["dom"], unicode))

    def test_deeply_nested_grammar(self) -> None:
        """A grammar nested as deep as engine §9 allows loads and parses."""
        depth = 250
        rules = "%rule text " + "[" * depth + "('a')" + "]" * depth
        rules += " <" + "(" * depth + "T" + ")" * depth + "> %conditions " + "¬" * depth + '"a" = "a"'
        dialect = gencmu.load_dialect_sources(self.grammar(rules), "p.md")
        result = dialect.parse("a", auto_features=False)
        self.assertTrue(result.ok, result.error)
        self.assertEqual(gencmu.to_brackets(result), "a")
        assert result.tree is not None
        self.assertEqual(result.tree.tags, frozenset({"T"}))

    def test_deeply_nested_clauses_need_no_recursion(self) -> None:
        """Constants and tests in clauses nested as deep as engine §9 allows
        resolve on a call stack shallower than the nesting. The test lowers
        the recursion limit, since before Python 3.12 the default limit
        was too low for the comprehensions that resolved them."""
        depth = 250
        term = "".join("($K ∪ " if level % 2 == 0 else "($K ∩ " for level in range(depth)) + "$K" + ")" * depth
        # Each level is an optional and a sequence, two levels of depth.
        expression = "[A⊇$K " * (depth // 2) + "]" * (depth // 2) + " A"
        limit = sys.getrecursionlimit()
        self.addCleanup(sys.setrecursionlimit, limit)
        sys.setrecursionlimit(len(inspect.stack()) + 150)
        dialect = gencmu.load_dialect_sources(self.grammar(f"%const $K ~a\n%rule text {expression} <{term}>"), "p.md", use_cache=False)
        sys.setrecursionlimit(limit)
        tokens = [gencmu.Token("a", frozenset({"A", "a"}), (0, 1), (0, 1)), gencmu.Token("b", frozenset({"A"}), (1, 2), (2, 3))]
        result = dialect.parse_tokens(tokens, "a b", auto_features=False)
        self.assertTrue(result.ok, result.error)
        assert result.tree is not None
        self.assertEqual(result.tree.tags, frozenset({"a"}))

    def test_too_deeply_nested_grammar(self) -> None:
        """Nesting more than 256 deep is an error at the rule that holds it."""
        for rules in (
            "%rule x 'b'\n%rule text " + "[" * 300 + "'a'" + "]" * 300,
            "%rule x 'b'\n%rule text 'a' %conditions " + "¬" * 300 + '"a" = "a"',
        ):
            with self.subTest(rules=rules[:30]):
                with self.assertRaises(gencmu.GencmuError) as caught:
                    gencmu.load_dialect_sources(self.grammar(rules), "p.md")
                self.assertEqual((caught.exception.document, caught.exception.line, caught.exception.column), ("g.md", 4, 1))

    def test_deep_include_chain(self) -> None:
        """A chain of includes far deeper than the call stack loads, and its
        errors name the whole chain. The DOMs come precompiled, since the
        notation reader would spend most of the run reading them."""
        from gencmu._dialect import read_document
        from gencmu._hash import fnv1a64

        depth = 20_000
        last = f"d{depth}.md"
        include = {"format": DOM_FORMAT, "rules": [], "directives": [], "constants": [], "classifiers": [], "implications": []}

        def sources(end: str | None) -> dict[str, str]:
            texts = {f"d{index}.md": f'```jbogenbau\n%include "d{index + 1}.md"\n```\n' for index in range(depth)}
            doms = {path: {**include, "directives": [{"name": "include", "args": [f"d{index + 1}.md"], "at": [2, 1]}]} for index, path in enumerate(texts)}
            if end is not None:
                texts[last] = end
                doms[last] = read_document(end, last)
            entries = {path: {"hash": fnv1a64(text), "dom": doms[path]} for path, text in texts.items()}
            bootstrap = fnv1a64(bundled_text("notation/bootstrap.json") or "")
            texts["compiled.json"] = json.dumps({"format": DOM_FORMAT, "bootstrap": bootstrap, "documents": entries})
            return texts

        dialect = gencmu.load_dialect_sources(sources("```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%rule text 'a'\n```\n"), "d0.md")
        self.assertTrue(dialect.parse("a", auto_features=False).ok)
        chain = " → ".join(f"d{index}.md" for index in range(depth + 1))
        with self.assertRaises(gencmu.GencmuError) as caught:
            gencmu.load_dialect_sources(sources(None), "d0.md")
        self.assertEqual(caught.exception.message, f"{last} was not found ({chain})")
        with self.assertRaises(gencmu.GencmuError) as caught:
            gencmu.load_dialect_sources(sources('```jbogenbau\n%include "d0.md"\n```\n'), "d0.md")
        self.assertEqual(caught.exception.message, f"d0.md includes itself ({chain} → d0.md)")

    def test_deep_tree(self) -> None:
        dialect = gencmu.load_dialect_sources(self.grammar("%rule text text 'a' | 'a'"), "p.md")
        result = dialect.parse("a" * 10000, auto_features=False)
        self.assertTrue(result.ok)
        text = gencmu.to_json(result)
        self.assertEqual(text.count('"rule":"text"'), 10000)
        brackets = gencmu.to_brackets(result)
        self.assertTrue(brackets.startswith("(" + "[{(" * 3) and brackets.endswith("a)"))
        # Equality and the representation of a tree walk it with a list for
        # a stack, as the dataclass's own methods would not.
        again = dialect.parse("a" * 10000, auto_features=False)
        self.assertEqual(result, again)
        assert again.tree is not None
        again.tree.children[0].children[0].children[0].span = (0, 0)
        self.assertNotEqual(result, again)
        self.assertEqual(repr(result.tree).count("Node(kind='rule'"), 10000)


def stage_output(dialect: gencmu.Dialect, text: str, name: str) -> list[gencmu.Token]:
    """The output of the stage NAME of a parse of TEXT, which must succeed."""
    result = dialect.parse(text)
    assert result.ok, (text, result.error)
    output = next(stage for stage in result.stages if stage.name == name).output
    assert output is not None
    return output


class BundledGrammars(unittest.TestCase):
    """What the shared corpus cannot see in the bundled grammars: the
    phonemes and the sources of the tokens of a stage."""

    def test_empty_zoi_body(self) -> None:
        """words/stream.md: the body of an empty zoi quote is an empty opaque
        part. So it sounds ?, and a letter word over the quote keeps the ?,
        with no pause after it, since the one pause between the delimiters
        comes first."""
        dialect = gencmu.load_dialect("cll-ebnf")
        body = next(token for token in stage_output(dialect, "zoi gy gy", "words") if "quoted-text" in token.tags)
        self.assertEqual(body.phonemes, "?")
        self.assertIsNone(body.inserted_by)
        letter = stage_output(dialect, "zoi gy gy bu", "words")[0]
        self.assertEqual(letter.phonemes, "zoi.gy.?gy.bu")

    def test_zbalermorna_shorthand(self) -> None:
        """phonemes/zbalermorna.md: the token of the vowel after the shorthand
        mark covers the mark, so a word that begins with the shorthand begins
        at it."""
        dialect = gencmu.load_dialect("bpfk")
        text = ""
        vowel = stage_output(dialect, text, "phonemes")[0]
        self.assertEqual((vowel.text, vowel.source), ("", (0, 2)))
        word = stage_output(dialect, text, "forms")[0]
        self.assertEqual((word.text, word.source, word.phonemes), (text, (0, 3), "u'i"))

    def test_cy_letter_is_never_continued(self) -> None:
        """words/cll.md and words/forms.md: a Cy letter is never continued. So
        the general join of run-words, a continued word before an onset,
        never joins a Cy letter to the word after it, and only the Cy rule
        joins two letters."""
        letters = stage_output(gencmu.load_dialect("cll-ebnf"), "cyky", "forms")
        self.assertEqual([token.label for token in letters], ["cy", "ky"])
        for letter in letters:
            self.assertTrue("cy" in letter.tags and "continued" not in letter.tags, letter.label)

    def test_ranking_reads_leading_nai_into_the_run(self) -> None:
        """indicators/cll.md: the greedy ranking reads a nai after a leading
        attitudinal into the leading run, with or without a ba'e before it,
        and after a text opener as at the start of the text. No condition
        decides it, so each of these texts has the verdict resolved in the
        indicator stage."""
        dialect = gencmu.load_dialect("cll-ebnf")
        for text, labels in [
            ("ui nai mi klama", ["ui", "nai", "mi", "klama"]),
            ("ui ba'e nai mi klama", ["ui", "nai", "mi", "klama"]),
            ("lu ui nai mi li'u", ["lu", "ui", "nai", "mi", "li'u"]),
        ]:
            result = dialect.parse(text)
            self.assertTrue(result.ok, text)
            stage = next(stage for stage in result.stages if stage.name == "indicators")
            self.assertEqual(stage.verdict, "resolved", text)
            assert stage.output is not None
            self.assertEqual([token.label for token in stage.output], labels, text)

    def test_experimental_syntax_reads_no_la(self) -> None:
        """syntax/experimental.md: the grammar reads no LA, since no word of
        the experimental lexicon has it. A probe document after the lexicon
        moves la from LE to LA, and then no rule reads la mlatu ku."""
        root = Path(__file__).resolve().parents[1] / "src" / "gencmu" / "grammars"
        sources = {path.relative_to(root).as_posix(): path.read_text(encoding="utf-8") for path in root.rglob("*.md")}
        include = '%include "../words/lexicon-experimental.md"'
        self.assertIn(include, sources["dialects/experimental.md"])
        sources["dialects/experimental.md"] = sources["dialects/experimental.md"].replace(
            include, include + '\n  %include "../words/la-probe.md"'
        )
        sources["words/la-probe.md"] = '```jbogenbau\n%classifier lexicon\n  "la" ∉ LE\n  "la" ∈ LA\n```\n'
        probe = gencmu.load_dialect_sources(sources, "dialects/experimental.md")
        result = probe.parse("la mlatu ku cu klama")
        forms = next(stage for stage in result.stages if stage.name == "forms").output
        assert forms is not None
        self.assertTrue("LA" in forms[0].tags and "LE" not in forms[0].tags)
        self.assertFalse(result.ok)
        assert result.error is not None
        self.assertEqual(result.error.stage, "syntax")
        self.assertTrue(probe.parse("lo mlatu ku cu klama").ok)


class LoweringCaches(unittest.TestCase):
    """A dialect keeps a lowered grammar for each set of a stage's gates that
    is on, and a bounded number of them (engine §3.1, §13)."""

    def test_unused_names_share_one_lowering(self) -> None:
        dialect, error = load_case_dialect({"grammar": "%rule text f? 'x' | 'y'"})
        assert dialect is not None, error
        for index in range(50):
            self.assertTrue(dialect.parse("y", features=[f"unused-{index}"], auto_features=False).ok)
        self.assertEqual(len(dialect._lowered[0]), 1)
        self.assertEqual(len(dialect.grammars[0]._classifier_tables), 1)

    def test_bounded(self) -> None:
        names = ["a", "b", "c", "d", "e", "f", "g"]
        grammar = "%rule text " + " | ".join(f"{name}? 'x'" for name in names) + " | 'y'"
        dialect, error = load_case_dialect({"grammar": grammar})
        assert dialect is not None, error
        for number in range(1 << len(names)):
            features = [name for index, name in enumerate(names) if number & (1 << index)]
            # The stage accepts its input whenever a feature is on, and ties
            # when two are (engine §6).
            result = dialect.parse("x", features=features, auto_features=False)
            self.assertEqual(result.stages[0].verdict is not None, bool(features), features)
            self.assertEqual(result.ok, len(features) == 1, features)
        self.assertLessEqual(len(dialect._lowered[0]), 16)
        self.assertLessEqual(len(dialect.grammars[0]._classifier_tables), 16)

    def test_classifier_tables_bounded(self) -> None:
        """Every set of five classifier gates, twice: the second round
        resolves again the tables that the first round dropped."""
        names = ["a", "b", "c", "d", "e"]
        entries = "".join(f'\n  {name}? "x" ∈ {name.upper()}' for name in names)
        dialect, error = load_case_dialect({"grammar": f'%classifier c\n  "x" ∈ X{entries}\n%rule text $w(\'x\') <classify(text($w), c)>'})
        assert dialect is not None, error
        for _ in range(2):
            for number in range(1 << len(names)):
                features = [name for index, name in enumerate(names) if number & (1 << index)]
                result = dialect.parse("x", features=features, auto_features=False)
                assert result.tree is not None
                self.assertEqual(result.tree.tags, frozenset(["X"] + [name.upper() for name in features]))
        self.assertLessEqual(len(dialect.grammars[0]._classifier_tables), 16)


class RepeatedFailures(unittest.TestCase):
    """An error of the grammar that lowering finds is kept for later parses
    with the same features. A parse that meets it keeps nothing of an
    earlier one alive (engine §2, §13)."""

    def test_no_earlier_input_stays_reachable(self) -> None:
        dialect, error = load_case_dialect(
            {"grammar": '%classifier c\n  "a" ∈ A\n  "a" ∈ A\n%rule text $w(\'a\') <classify(text($w), c)>'}
        )
        assert dialect is not None, error
        tokens = []
        for _ in range(5):
            result = dialect.parse("a", auto_features=False)
            self.assertFalse(result.ok)
            assert result.error is not None
            self.assertEqual(result.error.kind, "grammar")
            tokens.append(weakref.ref(result.stages[0].input[0]))
            del result
        gc.collect()
        self.assertEqual([token() for token in tokens], [None] * len(tokens))


class SharedCaches(unittest.TestCase):
    """The caches that loads share keep a few entries, and only so many
    characters of the texts that key them. A process that loads dialects
    from many texts does not keep them all."""

    def test_recent_bounds_count_and_size(self) -> None:
        from gencmu._recent import Recent

        recent: Recent[str, int] = Recent(3, 9)
        for index, key in enumerate("abcd"):
            recent.put(key, index, 1)
        self.assertEqual((len(recent), recent.get("a"), recent.get("d")), (3, None, 3))
        recent.put("big", 9, 8)
        self.assertEqual((len(recent), recent.size, recent.get("b"), recent.get("c")), (2, 9, None, None))
        recent.put("huge", 0, 11)
        self.assertEqual((len(recent), recent.size, recent.get("huge")), (0, 0, None))

    def test_unicode_tables_are_dropped(self) -> None:
        from gencmu import _dialect

        unicode = bundled_text("unicode.txt")
        assert unicode is not None
        tables = []
        for index in range(6):
            sources, pipeline = case_sources({"grammar": "%rule text 'a'"})
            # A different text, with the same table.
            sources["unicode.txt"] = unicode + "\n" * (index + 1)
            dialect = gencmu.load_dialect_sources(sources, pipeline)
            self.assertTrue(dialect.parse("a").ok)
            tables.append(weakref.ref(dialect.unicode))
            del dialect
        gc.collect()
        self.assertLessEqual(len(_dialect._unicode_tables), _dialect._MAX_TEXTS)
        self.assertLessEqual(len(_dialect._readers), _dialect._MAX_TEXTS)
        self.assertLessEqual(sum(table() is not None for table in tables), _dialect._MAX_TEXTS)
        self.assertIsNone(tables[0]())


class CallerTokens(unittest.TestCase):
    """A result shares nothing that can change with the caller's tokens
    (docs/api.md)."""

    def test_no_shared_values(self) -> None:
        dialect, error = load_case_dialect({"grammar": "%rule text A"})
        assert dialect is not None, error
        tags = {"A"}
        span = [0, 1]
        source = [0, 1]
        token = gencmu.Token("a", tags, span, source)  # type: ignore[arg-type]
        result = dialect.parse_tokens([token], "a", auto_features=False)
        self.assertTrue(result.ok)
        tags.add("Z")
        span[1] = 99
        source[0] = 99
        read = result.stages[0].input[0]
        self.assertEqual((read.tags, tuple(read.span or ()), tuple(read.source)), (frozenset({"A"}), (0, 1), (0, 1)))
        self.assertIsNot(read, token)
