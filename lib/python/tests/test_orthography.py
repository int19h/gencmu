"""Stage zero preserves original text through canonical decomposition."""

import unittest

import gencmu
from gencmu._dialect import bundled_text, character_tokens
from gencmu._unicode import UnicodeTable


class StageZero(unittest.TestCase):
    def test_expansion_and_reordering_preserve_sources(self) -> None:
        table = UnicodeTable(bundled_text("data/unicode/unicode.txt") or "")
        for text, values, origins in (
            ("á", "a\u0301", [0, 0]),
            ("a\u0301\u0323", "a\u0323\u0301", [0, 2, 1]),
            ("á\u0323", "a\u0323\u0301", [0, 1, 0]),
            ("각", "\u1100\u1161\u11a8", [0, 0, 0]),
        ):
            with self.subTest(text=text):
                tokens = character_tokens(text, table)
                self.assertEqual([token.value for token in tokens], list(values))
                self.assertEqual([token.image for token in tokens], list(values))
                self.assertEqual([token.text for token in tokens], [text[i] for i in origins])
                self.assertEqual([token.source for token in tokens], [(i, i + 1) for i in origins])
                self.assertEqual([token.span for token in tokens], [(i, i + 1) for i in range(len(values))])
        self.assertEqual(character_tokens("á", table)[1].tags, frozenset({"_General_Category_Nonspacing_Mark", "_General_Category_Mark"}))

    def test_scalar_validation_precedes_decomposition(self) -> None:
        class UnusedTable(UnicodeTable):
            def decompose_with_origins(self, text):
                raise AssertionError("decomposition must not run")

        with self.assertRaises(gencmu.GencmuError) as caught:
            character_tokens("á\ud800", UnusedTable(""))
        self.assertEqual(caught.exception.kind, "usage")


def document(source):
    return "```jbogenbau\n" + source + "\n```\n"


class GrammarReading(unittest.TestCase):
    def test_cache_identity_includes_exact_table_text(self) -> None:
        import json
        from unittest.mock import patch
        from gencmu._dialect import DOM_FORMAT, _preparsed_index, _Loader, _resources
        from gencmu._hash import fnv1a64

        table = bundled_text("data/unicode/unicode.txt") or ""
        sparse = "\n".join(line for line in table.splitlines() if not line.startswith(("decompose ", "combining ")))
        grammar = document('%ambiguity-resolution greedy\n%rule text "é"')
        texts = {"p.md": document('%stage main\n%include "g.md"'), "g.md": grammar}
        resources = _resources()
        first = _Loader(texts.get, resources)
        dom = first.dom("g.md")
        self.assertEqual(dom["rules"][0]["alternatives"][0]["expr"]["literal"], {"string": "e\u0301"})
        cache = {"format": DOM_FORMAT, "bootstrap": first.reader.hash, "unicode": fnv1a64(table), "properties": None,
                 "documents": {"g.md": {"hash": fnv1a64(grammar), "dom": dom}}}
        preparsed = json.dumps(cache)
        self.assertTrue(_preparsed_index(preparsed, first.reader.hash, table))
        self.assertFalse(_preparsed_index(preparsed, first.reader.hash, sparse))
        for fingerprint in (None, "0000000000000000"):
            cache["unicode"] = fingerprint
            self.assertFalse(_preparsed_index(json.dumps(cache), first.reader.hash, table))
        cache["unicode"] = fnv1a64(table)
        second = _Loader(texts.get, type(resources)(sparse, resources.bootstrap, preparsed))
        sparse_dom = second.dom("g.md")
        self.assertEqual(sparse_dom["rules"][0]["alternatives"][0]["expr"]["literal"], {"string": "é"})
        # The matching envelope must be used even if its valid DOM differs.
        cache["documents"]["g.md"]["dom"] = sparse_dom
        cached = _Loader(texts.get, type(resources)(table, resources.bootstrap, json.dumps(cache)))
        with patch.object(cached.reader, "read", side_effect=AssertionError("cache was bypassed")):
            self.assertIs(cached.dom("g.md"), cached.preparsed[fnv1a64(grammar)])

    def test_negated_operator_needs_its_decomposition_record(self) -> None:
        from gencmu._dialect import read_document
        sparse = "\n".join(line for line in (bundled_text("data/unicode/unicode.txt") or "").splitlines()
                           if not line.startswith(("decompose ", "combining ")))
        source = document('%rule r $a:A %conditions $a.value ≠ "a"')
        for use_cache in (False, True):
            with self.subTest(use_cache=use_cache), self.assertRaises(gencmu.GencmuError) as caught:
                gencmu.load_dialect_sources({"data/unicode/unicode.txt": sparse, "p.md": document('%stage main\n%include "g.md"'),
                                            "g.md": source}, "p.md", use_cache=use_cache)
            self.assertEqual((caught.exception.document, caught.exception.column), ("g.md", 35))
        self.assertEqual(read_document(source, "g.md")["rules"][0]["conditions"][0]["op"], "≠")

    def test_include_preserves_original_filename(self) -> None:
        texts = {"p.md": document('%stage main\n%include "café.md"'),
                 "café.md": document('%ambiguity-resolution greedy\n%rule text "a"')}
        self.assertTrue(gencmu.load_dialect_sources(texts, "p.md").parse("a").ok)

    def test_diagnostics_read_back_as_exact_scalars(self) -> None:
        from gencmu._strings import spelling
        table = UnicodeTable(bundled_text("data/unicode/unicode.txt") or "")
        for value in ("é", "à", "ź", "한", "\u302e\u1b44"):
            with self.subTest(value=value):
                texts = {"p.md": document('%stage main\n%include "g.md"'),
                         "g.md": document('%ambiguity-resolution greedy\n%const $S ' + spelling(value, table) + '\n%rule text $S')}
                dialect = gencmu.load_dialect_sources(texts, "p.md")
                token = gencmu.Token("", frozenset(), (0, 1), (0, 0), value=value)
                self.assertTrue(dialect.parse_tokens([token], "").ok)
        texts["g.md"] = document('%ambiguity-resolution greedy\n%rule text "‹U+00E0›".."‹U+017A›"')
        dialect = gencmu.load_dialect_sources(texts, "p.md")
        terminal = dialect.parse("").error.expected[0].terminal
        self.assertEqual(terminal, '"‹U+00E0›".."‹U+017A›"')
        texts["g.md"] = document('%ambiguity-resolution greedy\n%rule text ' + terminal)
        dialect = gencmu.load_dialect_sources(texts, "p.md")
        self.assertTrue(dialect.parse_tokens([gencmu.Token("é", frozenset(), (0, 1), (0, 1))], "é").ok)


class DecomposedSource(unittest.TestCase):
    def test_conditions_and_recipes_use_the_configured_table(self) -> None:
        table = bundled_text("data/unicode/unicode.txt") or ""
        sparse = "\n".join(line for line in table.splitlines() if not line.startswith(("decompose ", "combining ")))
        for data, expected in ((table, "e\u0301"), (sparse, "é")):
            with self.subTest(expected=expected):
                texts = {"data/unicode/unicode.txt": data, "p.md": document('%stage main\n%include "g.md"'),
                         "g.md": document('%ambiguity-resolution greedy\n%rule text $x:_\n%conditions $x.decomposed-source-text = "é"\n'
                                          '%emits\n$x := $x.decomposed-source-text :- $x.source-text')}
                dialect = gencmu.load_dialect_sources(texts, "p.md")
                token = gencmu.Token("é", frozenset(), (0, 1), (0, 1), value="untouched")
                result = dialect.parse_tokens([token], "é")
                self.assertTrue(result.ok, result.error)
                output = result.stages[0].output[0]
                self.assertEqual((output.value, output.image, output.text, output.source), (expected, "é", "é", (0, 1)))
                self.assertEqual(token.value, "untouched")

    def test_an_observed_source_is_decomposed_alone(self) -> None:
        texts = {"p.md": document('%stage main\n%include "g.md"'),
                 "g.md": document('%ambiguity-resolution greedy\n%rule text $x:_\n%emits\n$x := $x.decomposed-source-text')}
        dialect = gencmu.load_dialect_sources(texts, "p.md")
        # The token covers the acute alone, outside the preceding cluster.
        token = gencmu.Token("\u0301", frozenset(), (0, 1), (1, 2), value="x")
        result = dialect.parse_tokens([token], "á\u0301\u0323")
        self.assertTrue(result.ok, result.error)
        self.assertEqual(result.stages[0].output[0].value, "\u0301")


class StageZero(unittest.TestCase):
    def test_stage_zero_runs_once(self) -> None:
        from unittest.mock import patch

        dialect = gencmu.load_dialect("experimental")
        for options in ({}, {"until": "words"}):
            with self.subTest(options=options):
                with patch.object(dialect.unicode, "decompose_with_origins", wraps=dialect.unicode.decompose_with_origins) as decompose:
                    with patch.object(dialect, "_run", wraps=dialect._run) as run:
                        result = dialect.parse("mi klama", **options)
                self.assertTrue(result.ok, result.error)
                self.assertEqual(decompose.call_args_list, [unittest.mock.call("mi klama")])
                self.assertEqual(run.call_count, 1)
