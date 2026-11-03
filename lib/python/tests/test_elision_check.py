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

from .shared import SHARED, WitnessLost, case_tokens, load_case, load_case_pipeline, parse_checked, result_problems, run_case, witness_lost, same_json
from .witness import checks, walk_witness

CASE: dict[str, Any] = {
    "documents": {
        "p.md": """```jbogenbau
%stage main
%ambiguity-resolution late #·<_Elided>
%elision-only
%rule text a | b
%rule a w! A [+T="ta"] [+U] %emits $ :: X
%rule b A [+T="ta"] [+U] [+U]
%stage later
%ambiguity-resolution greedy
%rule text X
```
""",
    },
    "pipelineDocument": "p.md",
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
    return mock.patch.object(_stage, "_rank_check", lambda forest, marks=None: None)


LOSSES: dict[str, Callable[[], Any]] = {"no root item": lose_roots, "no counted derivation": lose_count}


def parse(**options: Any) -> gencmu.ParseResult:
    pipeline, error = load_case_pipeline(CASE)
    assert pipeline is not None, error
    tokens, text = case_tokens(CASE)
    return pipeline.parse_tokens(tokens, text, features=["w"], **options)


class WitnessLostError(unittest.TestCase):
    def test_serialized_witness_errors_distinguish_booleans_from_numbers(self) -> None:
        loads = json.loads

        def decode(text, *args, **kwargs):
            value = loads(text, *args, **kwargs)
            if isinstance(value, dict) and value.get("format") == 15:
                value["ok"] = int(value["ok"])
            return value

        with mock.patch(__name__ + ".json.loads", side_effect=decode), self.assertRaises(AssertionError):
            WitnessLostError().test_a_lost_witness_is_the_grammar_error_elision_witness_lost()

    def test_a_lost_witness_is_the_grammar_error_elision_witness_lost(self) -> None:
        clean = parse()
        self.assertTrue(clean.ok, clean.error)
        clean_value = gencmu.result_json(clean)
        main = gencmu.result_json(parse(elision_only=False, until="main"))
        for name, lose in LOSSES.items():
            with self.subTest(loss=name):
                with lose():
                    result = parse()
                self.assertIsNotNone(result.stages[0].tree)
                self.assertIsNone(result.stages[0].output)
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
                self.assertTrue(same_json(list(error), ["kind", "stage", "code", "message", "chosen", "completion"]))
                self.assertTrue(same_json(error["kind"], "grammar"))
                self.assertTrue(same_json(error["stage"], "main"))
                self.assertTrue(same_json(error["code"], "elision-witness-lost"))
                self.assertTrue(same_json(error["message"], "the main stage could not reconstruct its chosen derivation for elision-only"))
                # The chosen tree is that of the main stage, as a run that
                # ends there shows it.
                self.assertTrue(same_json(error["chosen"], main["tree"]))
                # The records in their order of insertion, with the sound
                # only for the tested terminator.
                self.assertTrue(same_json(error["completion"], [{"terminal": "T", "at": 1, "source": [1, 1], "value": "ta"}, {"terminal": "U", "at": 1, "source": [1, 1]}]))
                # The stage keeps its verdict and warnings, has no output,
                # and no later stage runs.
                self.assertTrue(same_json(value["stages"], [{"name": "main", "verdict": "resolved"}]))
                self.assertTrue(same_json(value["warnings"], [warning for warning in clean_value["warnings"] if warning["stage"] == "main"]))
                self.assertEqual(len(value["warnings"]), 1)
                self.assertTrue(same_json(json.loads(gencmu.to_json(result)), value))

    def test_an_ordinary_grammar_error_in_the_check_has_no_code(self) -> None:
        case = load_case(SHARED / "engine" / "reparse-competing-evaluation-error.json")
        value, _, error, _ = run_case(case)
        assert value is not None, error
        self.assertTrue(same_json(value["error"]["kind"], "grammar"))
        self.assertNotIn("code", value["error"])
        self.assertNotIn("chosen", value["error"])
        self.assertNotIn("completion", value["error"])
        self.assertFalse(same_json(value["error"]["message"], "the main stage could not reconstruct its chosen derivation for elision-only"))


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

    def test_a_lost_walk_skips_raw_and_filtered_ranking(self) -> None:
        from gencmu import _witness
        for body in [
            '%rule text a\n%rule a "a" [+T]',
            '%rule text (a ≻ b) ::∅\n%rule a "a" [+T]\n%rule b "a" [+T] [+U]',
        ]:
            pipeline = gencmu.load_pipeline_sources({"p.md":'```jbogenbau\n%stage main\n%ambiguity-resolution late #·<_Elided>\n%elision-only\n'+body+'\n```'},"p.md")
            original = _stage.rank
            def rank(forest, steps, lean, **options):
                self.assertFalse(options.get("check",False))
                return original(forest,steps,lean,**options)
            with (
                mock.patch.object(_witness,"walk_witness",return_value=None),
                mock.patch.object(_stage,"rank",side_effect=rank),
                mock.patch.object(_stage,"_rank_check",side_effect=AssertionError("a lost walk cannot rank")),
            ):
                result = pipeline.parse("a")
            self.assertEqual(result.error.code,"elision-witness-lost")

    def test_a_forest_without_the_chosen_root_has_no_witness(self) -> None:
        # A forest that holds another reading but not W(D) is no witness,
        # however many derivations it counts: here, the item of the chosen
        # derivation's root is taken away from the roots.
        runs: list[_testing.CheckRun] = []

        def watch(run: _testing.CheckRun) -> _testing.CheckWatch:
            runs.append(run)
            return _testing.CheckWatch(lambda ranking: None)

        with mock.patch.object(_testing, "elision_check", watch):
            parse()
        run = runs[0]
        self.assertIsNotNone(walk_witness(run))
        run.forest.roots = []
        self.assertIsNone(walk_witness(run))


if __name__ == "__main__":
    unittest.main()
