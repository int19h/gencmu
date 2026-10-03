"""The error elision-witness-lost (engine §7.9) and the witness hook of
tests/README.md. No grammar gives the error while the witness of engine §7.8
holds, so these tests lose the witness on purpose after recognition, by
replacing a step of the check, and call the engine directly, not through the
runner: no completed item of text over R, or items with no counted
derivation."""

from __future__ import annotations

import json
import unittest
from typing import Any, Callable
from unittest import mock

import gencmu
from gencmu import _stage, _testing

from .shared import SHARED, WitnessLost, case_tokens, load_case, load_case_dialect, parse_checked, result_problems, run_case, witness_lost
from .witness import checks, keeps_witness

CASE: dict[str, Any] = {
    "documents": {
        "p.md": "```jbogenbau\n%stage main\n%ambiguity-resolution late-elision elision-only\n%elidable T U\n"
        '%rule text a | b\n%rule a w! A [T="ta"] [U] %emits $ <~x>\n%rule b A [T="ta"] [U] [U]\n'
        "%stage later\n%ambiguity-resolution greedy\n%rule text ~x\n```\n",
    },
    "pipeline": "p.md",
    "tokens": [{"text": "a", "tags": ["A"]}],
}


def no_roots(forest: Any) -> Any:
    """The check's forest with no completed item of text over R."""
    forest.roots = []
    return forest


def lose_roots() -> Any:
    reconstruct = _stage._reconstruct
    return mock.patch.object(_stage, "_reconstruct", lambda context: no_roots(reconstruct(context)))


def lose_count() -> Any:
    # The roots stay, and the ranking finds no counted derivation.
    return mock.patch.object(_stage, "_rank_check", lambda forest: None)


LOSSES: dict[str, Callable[[], Any]] = {"no root item": lose_roots, "no counted derivation": lose_count}


def parse(**options: Any) -> gencmu.ParseResult:
    dialect, error = load_case_dialect(CASE)
    assert dialect is not None, error
    tokens, text = case_tokens(CASE)
    return dialect.parse_tokens(tokens, text, features=["w"], **options)


class WitnessLostError(unittest.TestCase):
    def test_a_lost_witness_is_the_grammar_error_elision_witness_lost(self) -> None:
        clean = parse()
        self.assertTrue(clean.ok, clean.error)
        clean_value = gencmu.result_json(clean)
        main = gencmu.result_json(parse(elision_only=False, until="main"))
        for name, lose in LOSSES.items():
            with self.subTest(loss=name):
                with lose():
                    result = parse()
                value = gencmu.result_json(result)
                self.assertEqual(result_problems(value), [])
                self.assertTrue(witness_lost(value))
                # The runner fails it, whatever a case expects
                # (tests/README.md).
                from . import test_engine_cases

                with self.assertRaises(AssertionError):
                    test_engine_cases.EngineCases().check("lost", {"error": "grammar"}, value, result, None, [])
                self.assertIs(value["ok"], False)
                self.assertIsNone(value["tree"])
                error = value["error"]
                self.assertEqual(list(error), ["kind", "stage", "code", "message", "chosen", "completion"])
                self.assertEqual(error["kind"], "grammar")
                self.assertEqual(error["stage"], "main")
                self.assertEqual(error["code"], "elision-witness-lost")
                self.assertEqual(error["message"], "the main stage could not reconstruct its chosen derivation for elision-only")
                # The chosen tree is that of the main stage, as a run that
                # ends there shows it.
                self.assertEqual(error["chosen"], main["tree"])
                # The records in their order of insertion, with the sound
                # only for the tested terminator.
                self.assertEqual(
                    error["completion"],
                    [{"terminal": "T", "at": 1, "source": [1, 1], "sound": "ta"}, {"terminal": "U", "at": 1, "source": [1, 1]}],
                )
                # The stage keeps its verdict and warnings, has no output,
                # and no later stage runs.
                self.assertEqual(value["stages"], [{"name": "main", "verdict": "resolved"}])
                self.assertEqual(value["warnings"], [warning for warning in clean_value["warnings"] if warning["stage"] == "main"])
                self.assertEqual(len(value["warnings"]), 1)
                self.assertEqual(json.loads(gencmu.to_json(result)), value)

    def test_an_ordinary_grammar_error_in_the_check_has_no_code(self) -> None:
        case = load_case(SHARED / "engine" / "reparse-competing-evaluation-error.json")
        value, _, error, _ = run_case(case)
        assert value is not None, error
        self.assertEqual(value["error"]["kind"], "grammar")
        self.assertNotIn("code", value["error"])
        self.assertNotIn("chosen", value["error"])
        self.assertNotIn("completion", value["error"])
        self.assertNotEqual(value["error"]["message"], "the main stage could not reconstruct its chosen derivation for elision-only")


class WitnessHook(unittest.TestCase):
    def test_the_hook_finds_the_witness_of_a_check(self) -> None:
        with checks() as answers:
            result = parse()
        self.assertTrue(result.ok)
        self.assertEqual(answers, [True])

    def test_the_hook_sees_both_losses(self) -> None:
        # The hook sees the loss also where the forest still holds W(D) but
        # the ranking counted nothing, and the runner refuses either.
        for name, lose in LOSSES.items():
            with self.subTest(loss=name):
                with lose(), checks() as answers:
                    parse()
                self.assertEqual(answers, [False])
                with lose(), self.assertRaises(WitnessLost):
                    parse_checked(parse)

    def test_a_forest_without_the_chosen_root_has_no_witness(self) -> None:
        # A forest that holds another reading but not W(D) is no witness,
        # however many derivations it counts: here, the item of the chosen
        # derivation's root is taken away from the roots.
        runs: list[_testing.CheckRun] = []
        with mock.patch.object(_testing, "elision_check", runs.append):
            parse()
        run = runs[0]
        self.assertTrue(keeps_witness(run))
        run.forest.roots = []
        self.assertFalse(keeps_witness(run))


if __name__ == "__main__":
    unittest.main()
