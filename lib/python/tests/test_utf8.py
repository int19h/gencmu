"""A grammar document read from disk is strict UTF-8 (engine §1): bytes that
do not decode are a grammar error of that document, with no line or column,
found before any hash or compiled DOM."""

from __future__ import annotations

import os
import tempfile
import unittest
from typing import Callable

import gencmu

PIPELINE = '# A dialect\n\n```jbogenbau\n%stage main\n%include "g.md"\n```\n'


def grammar(rule: str) -> str:
    return f"# A grammar\n\n```jbogenbau\n%ambiguity-resolution greedy\n{rule}\n```\n"


def with_bytes(text: str, data: bytes) -> bytes:
    """A document's text with bytes spliced in at the marker ``@``."""
    head, tail = text.split("@")
    return head.encode("utf-8") + data + tail.encode("utf-8")


# Invalid bytes: a stray continuation, a truncated sequence, an overlong
# form, an encoded surrogate and a value above U+10FFFF.
INVALID = (b"\x80", b"\xe2\x82", b"\xc0\xaf", b"\xed\xa0\x80", b"\xf4\x90\x80\x80", b"\xff")


class StrictUtf8(unittest.TestCase):
    def directory(self, files: dict[str, str | bytes]) -> str:
        """A directory holding the documents, each text or bytes."""
        holder = tempfile.TemporaryDirectory(prefix="gencmu-utf8-")
        self.addCleanup(holder.cleanup)
        for name, content in files.items():
            data = content.encode("utf-8") if isinstance(content, str) else content
            with open(os.path.join(holder.name, name), "wb") as file:
                file.write(data)
        return holder.name

    def test_invalid_bytes_are_a_grammar_error_of_the_document(self) -> None:
        good = grammar("%rule text 'a'")
        places: list[tuple[str, Callable[[bytes], dict[str, str | bytes]], str]] = [
            ("the pipeline's prose", lambda b: {"p.md": with_bytes("# A dialect @\n\n" + PIPELINE, b), "g.md": good}, "p.md"),
            (
                "a comment of the pipeline",
                lambda b: {"p.md": with_bytes(PIPELINE.replace("%stage main", "%stage main (* @ *)"), b), "g.md": good},
                "p.md",
            ),
            ("an included document's prose", lambda b: {"p.md": PIPELINE, "g.md": with_bytes("# A grammar @\n\n" + good, b)}, "g.md"),
            (
                "a comment of an included document",
                lambda b: {"p.md": PIPELINE, "g.md": with_bytes(grammar("%rule text 'a' (* @ *)"), b)},
                "g.md",
            ),
        ]
        for place, files, bad in places:
            for data in INVALID:
                for use_cache in (True, False):
                    with self.subTest(place=place, data=data.hex(), use_cache=use_cache):
                        root = self.directory(files(data))
                        with self.assertRaises(gencmu.GencmuError) as caught:
                            gencmu.load_dialect_file(os.path.join(root, "p.md"), use_cache=use_cache)
                        error = caught.exception
                        self.assertEqual(error.kind, "grammar")
                        self.assertEqual(error.document, bad)
                        self.assertIn("not valid UTF-8", str(error))
                        self.assertIsNone(error.line)
                        self.assertIsNone(error.column)

    def test_fffd_supplementary_characters_and_a_byte_order_mark_decode_as_themselves(self) -> None:
        root = self.directory(
            {
                "p.md": "# A dialect � \U0001f600\n\n" + PIPELINE,
                "g.md": grammar("%rule text '�' '\U0001f600' '\U0010fffd' (* � \U0001f600 *)"),
            }
        )
        dialect = gencmu.load_dialect_file(os.path.join(root, "p.md"))
        self.assertTrue(dialect.parse("�\U0001f600\U0010fffd", auto_features=False).ok)
        self.assertFalse(dialect.parse("�\U0001f600", auto_features=False).ok)
        # A byte order mark stays U+FEFF, so a fence after it opens no block.
        marked = self.directory({"p.md": "﻿" + PIPELINE[PIPELINE.index("```") :], "g.md": grammar("%rule text 'a'")})
        with self.assertRaises(gencmu.GencmuError) as caught:
            gencmu.load_dialect_file(os.path.join(marked, "p.md"))
        self.assertIn("at least one %stage", str(caught.exception))
        prose = self.directory({"p.md": "﻿" + PIPELINE, "g.md": grammar("%rule text '﻿'")})
        self.assertTrue(gencmu.load_dialect_file(os.path.join(prose, "p.md")).parse("﻿", auto_features=False).ok)


if __name__ == "__main__":
    unittest.main()
