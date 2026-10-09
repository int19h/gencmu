"""The places of the shared fixtures (tests/README.md, "Places in
fixtures"): the helpers of every library's runner agree with
tests/places.json."""

import unittest

from .shared import SHARED, find_places, load_json, position_of, substitute


class Places(unittest.TestCase):
    def test_places_agree_with_the_shared_cases(self) -> None:
        places = load_json(SHARED / "places.json")
        for item in places["positions"]:
            with self.subTest(needle=item["needle"], text=item["text"]):
                if item["line"] is None:
                    with self.assertRaises(AssertionError):
                        position_of(item["text"], item["needle"])
                else:
                    self.assertEqual(position_of(item["text"], item["needle"]), (item["line"], item["column"]))
        for item in places["substitutions"]:
            with self.subTest(find=item["find"], text=item["text"]):
                self.assertEqual(len(find_places(item["text"], item["find"])), item["places"])
                if item["expect"] is None:
                    with self.assertRaises(AssertionError):
                        substitute(item["text"], item["find"], item["replace"])
                else:
                    self.assertEqual(substitute(item["text"], item["find"], item["replace"]), item["expect"])
