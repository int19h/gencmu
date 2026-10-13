"""The public constructor accepts the documented typed consumer calls."""

from dataclasses import is_dataclass, replace
from typing import get_type_hints
import unittest

import gencmu

from .typing_token_constructor import construct_tokens


class TokenTypes(unittest.TestCase):
    def test_documented_defaults_and_tag_collections(self) -> None:
        defaults, api_example = construct_tokens()
        self.assertTrue(is_dataclass(defaults))
        self.assertEqual((defaults.value, defaults.image), ("A", "A"))
        self.assertEqual((api_example.value, api_example.image), ("a", "A"))
        self.assertEqual(defaults.tags, api_example.tags)
        self.assertEqual(replace(defaults, value=""), gencmu.Token("A", defaults.tags, (0, 1), (0, 1), value=""))
        self.assertIsNot(defaults.before, api_example.before)
        self.assertIsNot(defaults.after, api_example.after)

    def test_constructor_and_stored_string_types(self) -> None:
        arguments = get_type_hints(gencmu.Token.__init__)
        self.assertEqual(arguments["value"], str | None)
        self.assertEqual(arguments["image"], str | None)
        self.assertEqual(arguments["tags"], frozenset[str] | set[str])
        stored = get_type_hints(gencmu.Token)
        self.assertIs(stored["value"], str)
        self.assertIs(stored["image"], str)
