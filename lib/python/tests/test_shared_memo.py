"""The runs of tests/shared-memo.json (tests/README.md): parses that share
one pipeline, and so its shared memos (engine §4.3), give the results of
parses with an empty shared memo, in every order, with a bound of one entry,
and from several threads at once."""

from __future__ import annotations

import gc
import threading
import unittest
import weakref
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from unittest.mock import patch

import gencmu
from gencmu import _testing

from .shared import SHARED, case_tokens, load_case_pipeline, load_json

RUNS = load_json(SHARED / "shared-memo.json")["runs"]


def pipeline_of(run: dict[str, Any]) -> gencmu.Pipeline:
    if "pipeline" in run:
        return gencmu.load_pipeline(run["pipeline"])
    pipeline, error = load_case_pipeline({"grammar": run["grammar"]})
    assert pipeline is not None, error
    return pipeline


def parses_of(run: dict[str, Any]) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    inputs = [{"input": text} for text in run["texts"]] if "texts" in run else [{"tokens": tokens} for tokens in run["inputs"]]
    return [(item, options) for item in inputs for options in run["options"]]


def parse(pipeline: gencmu.Pipeline, item: dict[str, Any], options: dict[str, Any]) -> str:
    kwargs: dict[str, Any] = {
        "features": options.get("features", []),
        "without_features": options.get("withoutFeatures", []),
        "until": options.get("until"),
        "elision_only": options.get("elisionOnly"),
    }
    try:
        if "tokens" in item:
            tokens, text = case_tokens(item)
            result = pipeline.parse_tokens(tokens, text, **kwargs)
        else:
            result = pipeline.parse(item["input"], **kwargs)
    except gencmu.GencmuError as error:
        return f"error {error.kind} {error}"
    return gencmu.to_json(result)


def shared_rules(pipeline: gencmu.Pipeline) -> list[str]:
    """The rules of the entries of every shared memo of a pipeline."""
    rules: list[str] = []
    for lowered in pipeline._lowered_grammars():
        rules.extend(lowered.memo.rules())
    return rules


class SharedMemo(unittest.TestCase):
    def references(self, run: dict[str, Any]) -> list[str]:
        cold = pipeline_of(run)
        with patch.object(_testing, "memo_limit", 0):
            return [parse(cold, *item) for item in parses_of(run)]

    def test_every_order_gives_the_results_of_an_empty_memo(self) -> None:
        for number, run in enumerate(RUNS):
            parses = parses_of(run)
            reference = self.references(run)
            for limit in (None, 1):
                with patch.object(_testing, "memo_limit", limit):
                    warm = pipeline_of(run)
                    forward = list(range(len(parses)))
                    for order in (forward, forward[::-1], forward):
                        for i in order:
                            self.assertEqual(parse(warm, *parses[i]), reference[i], f"run {number}, parse {i}, bound {limit}")

    def test_threads_give_the_results_of_an_empty_memo(self) -> None:
        for number, run in enumerate(RUNS):
            parses = parses_of(run)
            reference = self.references(run)
            for limit in (None, 1):
                with patch.object(_testing, "memo_limit", limit):
                    shared = pipeline_of(run)

                    def work(worker: int) -> tuple[list[str], set[int]]:
                        # Every parse of the run, from a starting place of
                        # the worker's own.
                        failures, visited = [], set()
                        for step in range(len(parses)):
                            i = (step + worker * len(parses) // 4) % len(parses)
                            visited.add(i)
                            if parse(shared, *parses[i]) != reference[i]:
                                failures.append(f"run {number}, parse {i}, bound {limit}, thread {worker}")
                        return failures, visited

                    # Each future gives its worker's result, and raises its
                    # worker's exception, so neither is lost.
                    with ThreadPoolExecutor(4) as pool:
                        futures = [pool.submit(work, worker) for worker in range(4)]
                        results = [future.result() for future in futures]
                    self.assertEqual([failure for failures, _ in results for failure in failures], [])
                    for _, visited in results:
                        self.assertEqual(visited, set(range(len(parses))))

    def test_an_answer_that_reads_an_aligned_query_stays_out(self) -> None:
        # Directly, and through the memo of the parse (engine §4.3).
        runs = [run for run in RUNS if "without-elision" in run.get("grammar", "")]
        self.assertEqual(len(runs), 2)
        for run in runs:
            pipeline = pipeline_of(run)
            for item in parses_of(run):
                parse(pipeline, *item)
            rules = shared_rules(pipeline)
            self.assertIn("tail", rules)
            self.assertNotIn("driver", rules)
            self.assertNotIn("wrap", rules)

    def test_a_zero_bound_keeps_nothing(self) -> None:
        for limit, entries in ((None, True), (0, False)):
            with patch.object(_testing, "memo_limit", limit):
                pipeline = gencmu.load_pipeline("lojban/bpfk")
                pipeline.parse("bairsazdanti", until="forms")
                self.assertEqual(bool(shared_rules(pipeline)), entries, f"bound {limit}")

    def test_a_callers_string_runs_no_code_under_the_memo_lock(self) -> None:
        # A token's text of a str subclass, whose hash parses through the
        # same pipeline. The shared memo holds plain strings only, so the
        # hash never runs under its lock, and the parse ends.
        pipeline, error = load_case_pipeline({"grammar": "%rule text $x:W %conditions $x.matches(probe)\n%rule probe W\n"})
        assert pipeline is not None, error
        plain = gencmu.Token("x", frozenset({"W"}), (0, 1), (0, 1))

        class Callback(str):
            def __hash__(self) -> int:
                pipeline.parse_tokens([plain], "x")
                return str.__hash__(self)

        token = gencmu.Token(Callback("x"), frozenset({"W"}), (0, 1), (0, 1))
        errors: list[BaseException] = []

        def work() -> None:
            try:
                pipeline.parse_tokens([token], "x")
            except BaseException as caught:
                errors.append(caught)

        worker = threading.Thread(target=work, daemon=True)
        worker.start()
        worker.join(20)
        self.assertFalse(worker.is_alive(), "the parse waits for the memo's lock")
        self.assertEqual(errors, [])

    def test_eviction_runs_no_finalizer_under_the_memo_lock(self) -> None:
        # A caller's finalizer on the tags of a served answer parses through
        # the same pipeline. A hit gives a copy, and eviction releases the
        # dropped entries after the lock, so the parses end.
        pipeline, error = load_case_pipeline({"grammar": "%rule text $x:W :: $x.tags(probe)\n%rule probe W :: T\n"})
        assert pipeline is not None, error

        def one(text: str) -> gencmu.ParseResult:
            return pipeline.parse_tokens([gencmu.Token(text, frozenset({"W"}), (0, 1), (0, len(text)))], text)

        errors: list[BaseException] = []
        with patch.object(_testing, "memo_limit", 1):
            one("x")
            result = one("x")
            assert result.tree is not None
            finalizer = weakref.finalize(result.tree.tags, lambda: one("x"))
            del result
            gc.collect()

            def work() -> None:
                try:
                    for i in range(4):
                        one(str(i))
                    gc.collect()
                except BaseException as caught:
                    errors.append(caught)

            worker = threading.Thread(target=work, daemon=True)
            worker.start()
            worker.join(20)
        self.assertFalse(worker.is_alive(), "a finalizer waits for the memo's lock")
        self.assertEqual(errors, [])
        self.assertFalse(finalizer.alive)

    def test_no_shared_answer_while_an_aligned_query_is_active(self) -> None:
        # Each run twice on one pipeline, so that answers repeat. The guard of
        # engine §4.3 must hold, and ordinary hits must still happen. The test
        # keeps its own count of the aligned queries active, from the start
        # and end of their nested parses, apart from the library's count.
        # At each hit the two counts must agree. Both rest on one
        # classification of a query as aligned, so the runs of driver and
        # wrap stand behind it.
        during: list[str] = []
        ordinary: list[str] = []
        desync: list[str] = []
        active = [0]
        starts = [0]

        def changed(change: int) -> None:
            active[0] += change
            starts[0] += change > 0

        def seen(rule: str, library: int) -> None:
            if library != active[0]:
                desync.append(rule)
            (during if active[0] else ordinary).append(rule)

        with patch.object(_testing, "memo_hit", seen), patch.object(_testing, "aligned_query", changed):
            for run in RUNS:
                pipeline = pipeline_of(run)
                for item in parses_of(run) * 2:
                    parse(pipeline, *item)
        self.assertEqual(active[0], 0)
        self.assertGreater(starts[0], 0)
        self.assertEqual(desync, [])
        self.assertEqual(during, [])
        self.assertTrue(ordinary)

    def test_the_default_bound_keeps_at_most_two_generations(self) -> None:
        # Three generations of distinct answers. The newest is all there, in
        # the newer generation, and the oldest is gone.
        # The settled bound of engine §4.3, written out so that a changed
        # default fails here.
        bound = 8192
        pipeline = one_query_pipeline()
        hits = [0]

        def seen(rule: str, active: int) -> None:
            hits[0] += 1

        with patch.object(_testing, "memo_hit", seen):
            for i in range(3 * bound):
                self.assertTrue(one_token(pipeline, f"t{i}").ok)
            hits[0] = 0
            for i in range(2 * bound, 3 * bound):
                one_token(pipeline, f"t{i}")
            self.assertEqual(hits[0], bound)
            hits[0] = 0
            for i in range(bound):
                one_token(pipeline, f"t{i}")
            self.assertEqual(hits[0], 0)

    def test_matches_and_tags_share_one_entry(self) -> None:
        run = next(run for run in RUNS if "$x.tags(probe) = ∅" in run.get("grammar", ""))
        pipeline = pipeline_of(run)
        for item in parses_of(run):
            parse(pipeline, *item)
        self.assertEqual(shared_rules(pipeline).count("probe"), 1)

    def test_two_loaded_pipelines_never_share_answers(self) -> None:
        # Two grammars whose probe reads other tags, parsed in turn.
        grammars = [ONE, ONE.replace("%rule probe W", "%rule probe X")]
        tags = ["W", "X"]
        with patch.object(_testing, "memo_limit", 0):
            reference = [[gencmu.to_json(one_token(one_query_pipeline(grammar), "x", tag)) for tag in tags] for grammar in grammars]
        warm = [one_query_pipeline(grammar) for grammar in grammars]
        for _ in range(2):
            for i, tag in enumerate(tags):
                for g, pipeline in enumerate(warm):
                    self.assertEqual(gencmu.to_json(one_token(pipeline, "x", tag)), reference[g][i], f"grammar {g}, input {i}")


ONE = "%rule text $x:_ %conditions $x.matches(probe)\n%rule probe W\n"
"""A grammar of one query about one token."""


def one_query_pipeline(grammar: str = ONE) -> gencmu.Pipeline:
    pipeline, error = load_case_pipeline({"grammar": grammar})
    assert pipeline is not None, error
    return pipeline


def one_token(pipeline: gencmu.Pipeline, text: str, tag: str = "W") -> gencmu.ParseResult:
    return pipeline.parse_tokens([gencmu.Token(text, frozenset({tag}), (0, 1), (0, len(text)))], text)
