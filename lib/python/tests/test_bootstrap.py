"""The fixpoint of the notation and the preparsed DOMs (engine §8)."""

from __future__ import annotations

import functools
import json
import unittest
from unittest.mock import patch

import gencmu
from gencmu._pipeline import DOM_FORMAT, Dom, _bundled_root, _Loader, _resources, bundled_text, read_document
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
        """Loading the notation's pipeline, grammars/gencmu/jbogenbau/pipeline.md,
        with the bootstrap and splicing it reproduces the bootstrap's stages."""
        with open(REPOSITORY / "data/preparsed/gencmu.json", encoding="utf-8") as file:
            bootstrap = json.load(file)
        self.assertEqual(bootstrap["format"], DOM_FORMAT)

        def lookup(path: str) -> str | None:
            try:
                with open(REPOSITORY / path, encoding="utf-8", newline="") as file:
                    return file.read()
            except OSError:
                return None

        pipeline = _Loader(lookup, _resources(), use_cache=False).splice("grammars/gencmu/jbogenbau/pipeline.md")
        stages = [
            {"name": stage.name, "documents": [{"path": path, "dom": dom} for path, dom in stage.documents]} for stage in pipeline.stages
        ]
        entries = bootstrap["documents"]
        expected_names = [d["args"][0] for d in entries["grammars/gencmu/jbogenbau/pipeline.md"]["dom"]["directives"] if d["name"] == "stage"]
        self.assertEqual([stage["name"] for stage in stages], expected_names)
        for stage in stages:
            for document in stage["documents"]:
                self.assertEqual(document["dom"],entries[document["path"]]["dom"])
        for path,entry in entries.items():
            self.assertEqual(fresh_dom(path),entry["dom"])

    def test_bundled_copy_is_the_repository_grammars(self) -> None:
        for path in ("data/preparsed/gencmu.json", "grammars/gencmu/jbogenbau/lexical.md", "grammars/gencmu/jbogenbau/syntax.md", "data/unicode/unicode.txt", "data/preparsed/lojban.json"):
            with self.subTest(path=path):
                with open(REPOSITORY / path, encoding="utf-8", newline="") as file:
                    self.assertEqual(bundled_text(path), file.read())


class Preparsed(unittest.TestCase):
    def setUp(self) -> None:
        text = bundled_text("data/preparsed/lojban.json")
        assert text is not None
        self.preparsed = json.loads(text)

    def test_keys(self) -> None:
        bootstrap = bundled_text("data/preparsed/gencmu.json")
        assert bootstrap is not None
        self.assertEqual(self.preparsed["format"], DOM_FORMAT)
        self.assertEqual(self.preparsed["bootstrap"], fnv1a64(bootstrap))
        self.assertEqual(self.preparsed["unicode"], fnv1a64(bundled_text("data/unicode/unicode.txt") or ""))

    def test_pipelines_with_and_without_the_cache(self) -> None:
        """Each cached document equals a fresh reading.

        Both loading paths give the same stages, grammars, and features.
        One worker shares the fresh reads between these comparisons.
        """
        self.assertTrue(self.preparsed["documents"])
        for path, entry in self.preparsed["documents"].items():
            with self.subTest(document=path):
                text = bundled_text(path)
                assert text is not None
                self.assertEqual(entry["hash"], fnv1a64(text))
                self.assertEqual(fresh_dom(path), entry["dom"])

        names = sorted(path[len("grammars/"):-len("/pipeline.md")] for path in [*self.preparsed["documents"], *json.loads(bundled_text("data/preparsed/gencmu.json"))["documents"]] if path.endswith("/pipeline.md"))
        self.assertTrue(names)
        for name in names:
            with self.subTest(pipeline=name):
                path = f"grammars/{name}/pipeline.md"
                cached = _Loader(bundled_text, _resources())
                uncached = _Loader(bundled_text, _resources(), use_cache=False)
                uncached.dom = fresh_dom  # type: ignore[method-assign]
                with (
                    patch.object(cached.reader, "read", side_effect=AssertionError("preparsed grammar cache was bypassed")),
                    patch.object(cached.reader.doms, "get", side_effect=AssertionError("preparsed grammar cache was bypassed")),
                ):
                    a = cached.load(path)
                self.assertTrue(cached.preparsed)
                b = uncached.load(path)
                self.assertEqual(b.stage_names, a.stage_names)
                self.assertEqual(b.grammars, a.grammars)
                self.assertEqual((b.features, b.declared), (a.features, a.declared))

    def test_parsing_with_and_without_the_cache(self) -> None:
        cached = gencmu.load_pipeline("gencmu/jbogenbau")
        fresh = gencmu.load_pipeline("gencmu/jbogenbau", use_cache=False)
        for text in (
            "%rule text A B",
            '%rule a $x:A [{B 🆓}]\n%conditions $x.source-text = "y"\n%emits $',
            "%rule a {... A / [+KU]} :: B\n",
        ):
            with self.subTest(text=text):
                self.assertEqual(gencmu.to_json(cached.parse(text)), gencmu.to_json(fresh.parse(text)))

    def test_a_stale_entry_is_a_miss(self) -> None:
        """An entry whose hash does not match the text is not used."""
        lexical = bundled_text("grammars/gencmu/jbogenbau/lexical.md")
        assert lexical is not None
        path = "grammars/test/lexical.md"
        stale = {**self.preparsed, "documents": {path: {
            "hash":fnv1a64(lexical), "dom": {"format":DOM_FORMAT,"rules":[],"directives":[],"constants":[],"classifiers":[],"implications":[]}
        }}}
        edited = lexical + "\nA note added after the grammar.\n"
        sources = {
            "data/preparsed/test.json": json.dumps(stale),
            "p.md": '```jbogenbau\n%stage lexical\n%include "grammars/test/lexical.md"\n```\n',
            path: edited,
        }
        # The stale DOM has no rules; were it used, the stage would have no
        # rule text and fail to load.
        loaded = gencmu.load_pipeline_sources(sources, "p.md")
        self.assertTrue(loaded.parse("%rule a B").ok)
        # And an entry that matches the text is used: the same stale DOM
        # under the text's own hash makes the load fail.
        stale["documents"][path]["hash"] = fnv1a64(edited)
        sources["data/preparsed/test.json"] = json.dumps(stale)
        with self.assertRaises(gencmu.GencmuError):
            gencmu.load_pipeline_sources(sources, "p.md")

    def test_an_entry_of_format_17_is_never_used(self) -> None:
        """A library never uses a cached DOM of another version
        (docs/output.md): neither a file of format 17 nor an entry whose
        DOM uses an unsupported format or has an unknown expression member."""
        document = "```jbogenbau\n%ambiguity-resolution greedy\n%rule text {A}\n```\n"
        sources = {"grammars/test/p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n', "grammars/test/g.md": document}
        bootstrap_hash = fnv1a64(bundled_text("data/preparsed/gencmu.json") or "")
        # A DOM with no rules: were it used, the stage would have no rule
        # text and fail to load.
        empty: Dom = {"rules": [], "directives": [], "constants": [], "classifiers": [], "implications": []}

        def load(file_format: int, dom: Dom) -> gencmu.Pipeline:
            preparsed = {"format": file_format, "bootstrap": bootstrap_hash, "unicode": fnv1a64(bundled_text("data/unicode/unicode.txt") or ""), "properties": fnv1a64(bundled_text("data/unicode/unicode-properties.txt") or ""), "documents": {"grammars/test/g.md": {"hash": fnv1a64(document), "dom": dom}}}
            return gencmu.load_pipeline_sources({**sources, "data/preparsed/test.json": json.dumps(preparsed)}, "grammars/test/p.md")

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
                pipeline = load(file_format, {**old, "format": file_format})
                tokens = [gencmu.Token("a", frozenset({"A"}), (index, index + 1), (2 * index, 2 * index + 1)) for index in range(2)]
                self.assertEqual(gencmu.to_brackets(pipeline.parse_tokens(tokens, "a a")), "(a a)")


class Lexical(unittest.TestCase):
    def test_the_lexical_stage_tags_braces_and_plain_dollar_text(self) -> None:
        """Stored token tags follow the lexical grammar.

        Punctuation retains its stage-zero categories. Strings carry their
        lexical tag. Dollar forms inside strings stay literal (engine §9).
        """
        notation = gencmu.load_pipeline("gencmu/jbogenbau")
        result = notation.parse(
            '%rule a ¬f? B "c" "d" {E ... / "$(_005C)"} | g! %tags X %rulex $e ¬h "x".."y" _General_Category_Letter "a"... [+F] [+G]',
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
                ("{", ["_Age_V1_1", "_Bidi_Class_Other_Neutral", "_Bidi_Mirrored", "_Bidi_Paired_Bracket_Type_Open", "_Block_Basic_Latin", "_Canonical_Combining_Class_Not_Reordered", "_Decomposition_Type_None", "_East_Asian_Width_Narrow", "_General_Category_Open_Punctuation", "_General_Category_Punctuation", "_Grapheme_Base", "_Grapheme_Cluster_Break_Other", "_Hangul_Syllable_Type_Not_Applicable", "_Indic_Conjunct_Break_None", "_Indic_Positional_Category_NA", "_Indic_Syllabic_Category_Other", "_Joining_Group_No_Joining_Group", "_Joining_Type_Non_Joining", "_Line_Break_Open_Punctuation", "_NFC_Quick_Check_Yes", "_NFD_Quick_Check_Yes", "_NFKC_Quick_Check_Yes", "_NFKD_Quick_Check_Yes", "_Numeric_Type_None", "_Pattern_Syntax", "_Script_Common", "_Script_Extensions_Common", "_Sentence_Break_Close", "_Vertical_Orientation_Rotated", "_Word_Break_Other"]),
                ("E", ["Identifier", "Uppercase-Name"]),
                ("...", []),
                ("/", ["_Age_V1_1", "_Bidi_Class_Common_Separator", "_Bidi_Paired_Bracket_Type_None", "_Block_Basic_Latin", "_Canonical_Combining_Class_Not_Reordered", "_Decomposition_Type_None", "_East_Asian_Width_Narrow", "_General_Category_Other_Punctuation", "_General_Category_Punctuation", "_Grapheme_Base", "_Grapheme_Cluster_Break_Other", "_Hangul_Syllable_Type_Not_Applicable", "_Indic_Conjunct_Break_None", "_Indic_Positional_Category_NA", "_Indic_Syllabic_Category_Other", "_Joining_Group_No_Joining_Group", "_Joining_Type_Non_Joining", "_Line_Break_Break_Symbols", "_NFC_Quick_Check_Yes", "_NFD_Quick_Check_Yes", "_NFKC_Quick_Check_Yes", "_NFKD_Quick_Check_Yes", "_Numeric_Type_None", "_Pattern_Syntax", "_Script_Common", "_Script_Extensions_Common", "_Sentence_Break_Other", "_Vertical_Orientation_Rotated", "_Word_Break_Other"]),
                ('"$(_005C)"', ["String"]),
                ("}", ["_Age_V1_1", "_Bidi_Class_Other_Neutral", "_Bidi_Mirrored", "_Bidi_Paired_Bracket_Type_Close", "_Block_Basic_Latin", "_Canonical_Combining_Class_Not_Reordered", "_Decomposition_Type_None", "_East_Asian_Width_Narrow", "_General_Category_Close_Punctuation", "_General_Category_Punctuation", "_Grapheme_Base", "_Grapheme_Cluster_Break_Other", "_Hangul_Syllable_Type_Not_Applicable", "_Indic_Conjunct_Break_None", "_Indic_Positional_Category_NA", "_Indic_Syllabic_Category_Other", "_Joining_Group_No_Joining_Group", "_Joining_Type_Non_Joining", "_Line_Break_Close_Punctuation", "_NFC_Quick_Check_Yes", "_NFD_Quick_Check_Yes", "_NFKC_Quick_Check_Yes", "_NFKD_Quick_Check_Yes", "_Numeric_Type_None", "_Pattern_Syntax", "_Script_Common", "_Script_Extensions_Common", "_Sentence_Break_Close", "_Vertical_Orientation_Rotated", "_Word_Break_Other"]),
                ("|", ["_Age_V1_1", "_Bidi_Class_Other_Neutral", "_Bidi_Paired_Bracket_Type_None", "_Block_Basic_Latin", "_Canonical_Combining_Class_Not_Reordered", "_Decomposition_Type_None", "_East_Asian_Width_Narrow", "_General_Category_Math_Symbol", "_General_Category_Symbol", "_Grapheme_Base", "_Grapheme_Cluster_Break_Other", "_Hangul_Syllable_Type_Not_Applicable", "_Indic_Conjunct_Break_None", "_Indic_Positional_Category_NA", "_Indic_Syllabic_Category_Other", "_Joining_Group_No_Joining_Group", "_Joining_Type_Non_Joining", "_Line_Break_Break_After", "_Math", "_NFC_Quick_Check_Yes", "_NFD_Quick_Check_Yes", "_NFKC_Quick_Check_Yes", "_NFKD_Quick_Check_Yes", "_Numeric_Type_None", "_Pattern_Syntax", "_Script_Common", "_Script_Extensions_Common", "_Sentence_Break_Other", "_Vertical_Orientation_Rotated", "_Word_Break_Other"]),
                ("g!", ["Guard"]),
                ("%tags", ["Keyword"]),
                ("X", ["Identifier", "Uppercase-Name"]),
                ("%rulex", ["Keyword"]),
                ("$e", ["Capture"]),
                ("¬", ["_Age_V1_1", "_Bidi_Class_Other_Neutral", "_Bidi_Paired_Bracket_Type_None", "_Block_Latin_1_Supplement", "_Canonical_Combining_Class_Not_Reordered", "_Decomposition_Type_None", "_East_Asian_Width_Narrow", "_General_Category_Math_Symbol", "_General_Category_Symbol", "_Grapheme_Base", "_Grapheme_Cluster_Break_Other", "_Hangul_Syllable_Type_Not_Applicable", "_Indic_Conjunct_Break_None", "_Indic_Positional_Category_NA", "_Indic_Syllabic_Category_Other", "_Joining_Group_No_Joining_Group", "_Joining_Type_Non_Joining", "_Line_Break_Alphabetic", "_Math", "_NFC_Quick_Check_Yes", "_NFD_Quick_Check_Yes", "_NFKC_Quick_Check_Yes", "_NFKD_Quick_Check_Yes", "_Numeric_Type_None", "_Pattern_Syntax", "_Script_Common", "_Script_Extensions_Common", "_Sentence_Break_Other", "_Vertical_Orientation_Rotated", "_Word_Break_Other"]),
                ("h", ["Identifier", "Lowercase-Name"]),
                ('"x"', ["String"]),
                ("..", []),
                ('"y"', ["String"]),
                ("_General_Category_Letter", ["Engine-Tag"]),
                ('"a"', ["String"]),
                ("...", []),
                ("[", ["_Age_V1_1", "_Bidi_Class_Other_Neutral", "_Bidi_Mirrored", "_Bidi_Paired_Bracket_Type_Open", "_Block_Basic_Latin", "_Canonical_Combining_Class_Not_Reordered", "_Decomposition_Type_None", "_East_Asian_Width_Narrow", "_General_Category_Open_Punctuation", "_General_Category_Punctuation", "_Grapheme_Base", "_Grapheme_Cluster_Break_Other", "_Hangul_Syllable_Type_Not_Applicable", "_Indic_Conjunct_Break_None", "_Indic_Positional_Category_NA", "_Indic_Syllabic_Category_Other", "_Joining_Group_No_Joining_Group", "_Joining_Type_Non_Joining", "_Line_Break_Open_Punctuation", "_NFC_Quick_Check_Yes", "_NFD_Quick_Check_Yes", "_NFKC_Quick_Check_Yes", "_NFKD_Quick_Check_Yes", "_Numeric_Type_None", "_Pattern_Syntax", "_Script_Common", "_Script_Extensions_Common", "_Sentence_Break_Close", "_Vertical_Orientation_Rotated", "_Word_Break_Other"]),
                ("+", ["_Age_V1_1", "_Bidi_Class_European_Separator", "_Bidi_Paired_Bracket_Type_None", "_Block_Basic_Latin", "_Canonical_Combining_Class_Not_Reordered", "_Decomposition_Type_None", "_East_Asian_Width_Narrow", "_General_Category_Math_Symbol", "_General_Category_Symbol", "_Grapheme_Base", "_Grapheme_Cluster_Break_Other", "_Hangul_Syllable_Type_Not_Applicable", "_Indic_Conjunct_Break_None", "_Indic_Positional_Category_NA", "_Indic_Syllabic_Category_Other", "_Joining_Group_No_Joining_Group", "_Joining_Type_Non_Joining", "_Line_Break_Prefix_Numeric", "_Math", "_NFC_Quick_Check_Yes", "_NFD_Quick_Check_Yes", "_NFKC_Quick_Check_Yes", "_NFKD_Quick_Check_Yes", "_Numeric_Type_None", "_Pattern_Syntax", "_Script_Common", "_Script_Extensions_Common", "_Sentence_Break_Other", "_Vertical_Orientation_Rotated", "_Word_Break_Other"]),
                ("F", ["Identifier", "Uppercase-Name"]),
                ("]", ["_Age_V1_1", "_Bidi_Class_Other_Neutral", "_Bidi_Mirrored", "_Bidi_Paired_Bracket_Type_Close", "_Block_Basic_Latin", "_Canonical_Combining_Class_Not_Reordered", "_Decomposition_Type_None", "_East_Asian_Width_Narrow", "_General_Category_Close_Punctuation", "_General_Category_Punctuation", "_Grapheme_Base", "_Grapheme_Cluster_Break_Other", "_Hangul_Syllable_Type_Not_Applicable", "_Indic_Conjunct_Break_None", "_Indic_Positional_Category_NA", "_Indic_Syllabic_Category_Other", "_Joining_Group_No_Joining_Group", "_Joining_Type_Non_Joining", "_Line_Break_Close_Parenthesis", "_NFC_Quick_Check_Yes", "_NFD_Quick_Check_Yes", "_NFKC_Quick_Check_Yes", "_NFKD_Quick_Check_Yes", "_Numeric_Type_None", "_Pattern_Syntax", "_Script_Common", "_Script_Extensions_Common", "_Sentence_Break_Close", "_Vertical_Orientation_Rotated", "_Word_Break_Other"]),
                ("[", ["_Age_V1_1", "_Bidi_Class_Other_Neutral", "_Bidi_Mirrored", "_Bidi_Paired_Bracket_Type_Open", "_Block_Basic_Latin", "_Canonical_Combining_Class_Not_Reordered", "_Decomposition_Type_None", "_East_Asian_Width_Narrow", "_General_Category_Open_Punctuation", "_General_Category_Punctuation", "_Grapheme_Base", "_Grapheme_Cluster_Break_Other", "_Hangul_Syllable_Type_Not_Applicable", "_Indic_Conjunct_Break_None", "_Indic_Positional_Category_NA", "_Indic_Syllabic_Category_Other", "_Joining_Group_No_Joining_Group", "_Joining_Type_Non_Joining", "_Line_Break_Open_Punctuation", "_NFC_Quick_Check_Yes", "_NFD_Quick_Check_Yes", "_NFKC_Quick_Check_Yes", "_NFKD_Quick_Check_Yes", "_Numeric_Type_None", "_Pattern_Syntax", "_Script_Common", "_Script_Extensions_Common", "_Sentence_Break_Close", "_Vertical_Orientation_Rotated", "_Word_Break_Other"]),
                ("+", ["_Age_V1_1", "_Bidi_Class_European_Separator", "_Bidi_Paired_Bracket_Type_None", "_Block_Basic_Latin", "_Canonical_Combining_Class_Not_Reordered", "_Decomposition_Type_None", "_East_Asian_Width_Narrow", "_General_Category_Math_Symbol", "_General_Category_Symbol", "_Grapheme_Base", "_Grapheme_Cluster_Break_Other", "_Hangul_Syllable_Type_Not_Applicable", "_Indic_Conjunct_Break_None", "_Indic_Positional_Category_NA", "_Indic_Syllabic_Category_Other", "_Joining_Group_No_Joining_Group", "_Joining_Type_Non_Joining", "_Line_Break_Prefix_Numeric", "_Math", "_NFC_Quick_Check_Yes", "_NFD_Quick_Check_Yes", "_NFKC_Quick_Check_Yes", "_NFKD_Quick_Check_Yes", "_Numeric_Type_None", "_Pattern_Syntax", "_Script_Common", "_Script_Extensions_Common", "_Sentence_Break_Other", "_Vertical_Orientation_Rotated", "_Word_Break_Other"]),
                ("G", ["Identifier", "Uppercase-Name"]),
                ("]", ["_Age_V1_1", "_Bidi_Class_Other_Neutral", "_Bidi_Mirrored", "_Bidi_Paired_Bracket_Type_Close", "_Block_Basic_Latin", "_Canonical_Combining_Class_Not_Reordered", "_Decomposition_Type_None", "_East_Asian_Width_Narrow", "_General_Category_Close_Punctuation", "_General_Category_Punctuation", "_Grapheme_Base", "_Grapheme_Cluster_Break_Other", "_Hangul_Syllable_Type_Not_Applicable", "_Indic_Conjunct_Break_None", "_Indic_Positional_Category_NA", "_Indic_Syllabic_Category_Other", "_Joining_Group_No_Joining_Group", "_Joining_Type_Non_Joining", "_Line_Break_Close_Parenthesis", "_NFC_Quick_Check_Yes", "_NFD_Quick_Check_Yes", "_NFKC_Quick_Check_Yes", "_NFKD_Quick_Check_Yes", "_Numeric_Type_None", "_Pattern_Syntax", "_Script_Common", "_Script_Extensions_Common", "_Sentence_Break_Close", "_Vertical_Orientation_Rotated", "_Word_Break_Other"]),
            ],
        )


if __name__ == "__main__":
    unittest.main()
