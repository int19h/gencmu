"""Bounded content keys and positional query costs (engine §4.3)."""

import unittest
from unittest.mock import patch

import gencmu
from .shared import calls, count_work
from gencmu import _testing
from gencmu._earley import CONTENT_KEY_LIMIT, StageContext, Parser
from gencmu._grammar import lower
from gencmu._trampoline import run


class TokenReads:
    def __init__(self, tokens, counts, long_span, budget):
        self.tokens = tokens
        self.counts = counts
        self.long_span = long_span
        self.budget = budget

    def __getitem__(self, index):
        self.counts["reads"] += 1
        if self.long_span:
            self.counts["long_reads"] += 1
        if self.counts["reads"] > self.budget:
            raise AssertionError("query key token reads exceed the linear budget")
        return self.tokens[index]

    def __len__(self):
        return len(self.tokens)


def tracked_keys(counts, budget):
    original = StageContext.query_key

    def query_key(context, rule, start, end, error_free, ending_after=None):
        counts["calls"] += 1
        tokens = context.tokens
        context.tokens = TokenReads(tokens, counts, end - start > CONTENT_KEY_LIMIT, budget)
        try:
            return original(context, rule, start, end, error_free, ending_after)
        finally:
            context.tokens = tokens

    return patch.object(StageContext, "query_key", query_key)


def pipeline(body):
    source = "```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n" + body + "\n```\n"
    return gencmu.load_pipeline_sources({"p.md": source}, "p.md")


def tokens(size):
    return [gencmu.Token("a", {"A"}, (i, i + 1), (i, i + 1)) for i in range(size)]


class QueryKeyWork(unittest.TestCase):
    def test_optional_helper_uses_the_stage_chart(self):
        for body, recognitions in (("[r]", 1), ("[$x:r]", 2)):
            with self.subTest(body=body):
                loaded = pipeline(f'%rule text {body} [+T]\n%rule r "a"\n%check c #·_<_Elided>\n'
                                  '%conditions $.preceding-element.local-readings\n%warning "local"')
                with count_work(calls(Parser.walk)) as work:
                    result = loaded.parse("a", features={"c"})
                self.assertTrue(result.ok, result.error)
                self.assertEqual([warning.code for warning in result.warnings], ["c"])
                self.assertEqual(work.count, recognitions)

    def assert_linear_keys(self, condition, extra=""):
        loaded = pipeline("%rule text {word}\n%rule word A\n%conditions " + condition + extra)
        tail = sum(range(CONTENT_KEY_LIMIT + 1))
        for size in (2 * CONTENT_KEY_LIMIT, 8 * CONTENT_KEY_LIMIT):
            counts = {"calls": 0, "reads": 0, "long_reads": 0}
            work = {}
            # Eight token reads per bounded slot allow the token metadata and error bit.
            with tracked_keys(counts, 8 * tail), patch.object(_testing, "work", work):
                result = loaded.parse_tokens(tokens(size), "a" * size)
            self.assertTrue(result.ok, result.error)
            self.assertEqual(counts["long_reads"], 0)
            self.assertLessEqual(counts["calls"], 2 * size + 1)
            self.assertLessEqual(counts["calls"] + counts["reads"], 2 * size + 1 + 8 * tail)
            self.assertGreater(work.get("keySteps", 0), 0)
            self.assertLessEqual(work["keySteps"], 2 * tail)

    def test_whole_span_queries_have_linear_key_work(self):
        # Engine §4.3: a failed whole-span query does not inspect its long suffix.
        self.assert_linear_keys("¬$.onward.parse(B).error-free")

    def test_prefix_queries_have_linear_key_work(self):
        # Engine §4.3: a failed prefix query has the same positional bound.
        self.assert_linear_keys("¬$.onward.parse(B …).error-free")

    def test_nested_filtered_dependencies_have_linear_key_work(self):
        # Engine §4.3: transitive error sensitivity does not require long error vectors.
        self.assert_linear_keys("¬$.onward.parse(probe)", "\n%rule probe B\n%conditions ¬$.parse(C).error-free")

    def test_repeated_long_memo_hits_do_not_read_tokens(self):
        # Engine §4.3: a cached answer needs only its positional key and filter flag.
        loaded = pipeline("%rule text target\n%rule target B")
        lowered = lower(loaded._grammars[0], frozenset())
        for size in (2 * CONTENT_KEY_LIMIT, 8 * CONTENT_KEY_LIMIT):
            state = StageContext(lowered, tokens(size), "a" * size, loaded._unicode)
            self.assertFalse(run(state.nested("target", 0, size, True)).accepted)
            self.assertFalse(run(state.prefix("target", 0, size, True)))
            counts = {"calls": 0, "reads": 0, "long_reads": 0}
            work = {}
            with tracked_keys(counts, 0), patch.object(_testing, "work", work), patch.object(
                state, "answer", side_effect=AssertionError("a memo hit starts another query")
            ):
                for _ in range(size):
                    self.assertFalse(run(state.nested("target", 0, size, True)).accepted)
                    self.assertFalse(run(state.prefix("target", 0, size, True)))
            self.assertEqual(counts, {"calls": 2 * size, "reads": 0, "long_reads": 0})
            self.assertEqual(work.get("keySteps", 0), 0)
            self.assertEqual(len(state.memo), 1)
            self.assertEqual(len(state.prefix_memo), 1)

    def test_long_keys_keep_filtered_answers_separate(self):
        # Engine §4.3: one position can have different ordinary and filtered answers.
        loaded = pipeline("%rule text target\n%rule target {A}\n%conditions $.ends-input")
        size = CONTENT_KEY_LIMIT + 1
        items = tokens(size)
        items[size // 2].errors = [gencmu.ParseWarning("before", "bad", "bad", (0, 1), (0, 1), "bad")]
        state = StageContext(lower(loaded._grammars[0], frozenset()), items, "a" * size, loaded._unicode)
        self.assertTrue(run(state.nested("target", 0, size)).accepted)
        self.assertFalse(run(state.nested("target", 0, size, True)).accepted)
        self.assertTrue(run(state.prefix("target", 0, size)))
        self.assertFalse(run(state.prefix("target", 0, size, True)))

    def test_local_and_shared_content_keys_count_error_bits(self):
        # Engine §4.3: both bounded key builders charge every constructed error bit.
        loaded = pipeline("%rule text target\n%rule target A")
        state = StageContext(lower(loaded._grammars[0], frozenset()), tokens(3), "aaa", loaded._unicode)
        work = {}
        with patch.object(_testing, "work", work):
            state.query_key("target", 0, 3, True)
            self.assertEqual(work["keySteps"], 3)
            state.shared_key("target", 0, 3, False, True)
            self.assertEqual(work["keySteps"], 6)
