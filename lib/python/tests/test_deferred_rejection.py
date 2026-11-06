"""Competitor evidence and shared position indexes (engine §12.1)."""

import unittest
from unittest.mock import patch

import gencmu
from gencmu import _testing, _earley
from gencmu._competitor_rejection import competitor_slice
from gencmu._earley import StageContext, Parser
from gencmu._grammar import lower
from gencmu._markdown import line_column
from gencmu._source_lines import SourceLines
from .shared import run_case


def context_for(grammar, tags=("A",)):
    loaded = gencmu.load_pipeline_sources({
        "p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n',
        "g.md": '```jbogenbau\n%ambiguity-resolution greedy\n' + grammar + '\n```\n',
    }, "p.md")
    lowered = lower(loaded._grammars[0], frozenset())
    tokens = [gencmu.Token(tag.lower(), frozenset({tag}), (i, i+1), (i, i+1)) for i, tag in enumerate(tags)]
    return StageContext(lowered, tokens, "".join(token.text for token in tokens), loaded._unicode)


def option_of(forest, option):
    for number, dot in zip(forest.prod, forest.dot):
        production = forest.lowered.productions[number]
        if dot == 0 and production.ranked is not None and production.ranked.rule == "text" and production.option == option:
            return production
    raise AssertionError("no ranked text option")


class CompetitorEvidence(unittest.TestCase):
    def test_skipped_conditions_run_only_for_reached_competitors_and_remain_cached(self):
        # Engine §12.1: evidence adds no condition evaluation outside its slice.
        context = context_for('%rule text :: ∅ | (good ≻ bad) C\n%extend-rule text unrelated\n'
                              '%rule good A wanted\n%rule wanted K\n%rule bad A B\n%error "bad"\n'
                              '%rule unrelated A B unwanted\n%rule unwanted Z', ("A", "B", "C"))
        forest = Parser(context).parse(context.lowered.rule_ids["text"])
        option = next(production for production in (forest.lowered.productions[number] for number in forest.prod)
                      if production.ranked is not None and production.option == 1 and production.rhs
                      and not production.terminal[0] and forest.lowered.rule_names[production.rhs[0]] == "bad")
        calls = []
        original = _earley.prediction_holds

        def evaluate(forest, production, position):
            calls.append(production.rule_name)
            return original(forest, production, position)

        with patch.object(_earley, "prediction_holds", evaluate):
            evidence = competitor_slice(forest, 0, 2, option)
            self.assertEqual(evidence["expected"], [{"terminal": "K", "rules": ["wanted"]}])
            self.assertEqual(calls, ["wanted"])
            self.assertEqual(competitor_slice(forest, 0, 2, option), evidence)
            self.assertEqual(calls, ["wanted"])

    def test_reconstruction_uses_the_first_competitor_in_action_order(self):
        # Engine §7.10: the competitor keeps the exterior before its divergence.
        for grouped, surrounded in ((False, False), (True, False), (False, True)):
            if surrounded:
                body = ('%rule text start middle end | other\n%rule start "a"\n%rule middle head tail\n'
                        '%rule head "b"\n%rule tail [+T] | T\n%rule end "c"\n'
                        '%rule other start elsewhere end\n%rule elsewhere "b" T')
            else:
                body = ('%rule text (group ≻ other) :: ∅\n%rule group head tail' if grouped else '%rule text head tail | other')
                body += '\n%rule head "a"\n%rule tail [+T] | T\n%rule other "a" T'
            case = {"grammar": "%ambiguity-resolution greedy\n%elision-only\n" + body, "input": "abc" if surrounded else "a"}
            _, result, error, _ = run_case(case)
            self.assertIsNone(error)
            self.assertEqual(result.error.reason, "elision-only")
            competing = result.error.readings[1]
            if grouped:
                self.assertEqual(competing.children[0].rule, "group")
                competing = competing.children[0]
            if surrounded:
                self.assertEqual([node.rule for node in competing.children], ["start", "middle", "end"])
                competing = competing.children[1]
            self.assertEqual([node.rule for node in competing.children], ["head", "tail"])

    def test_each_recognition_retains_the_frames_that_bound_its_helpers(self):
        # Engine §12.1: a later recognition cannot replace a chart's frames.
        context = context_for('%rule text :: ∅ | bad ≻ good\n%rule bad A\n%error "bad"\n%rule good inner B\n%rule inner :: ∅ | A ≻ C')
        first = Parser(context).parse(context.lowered.rule_ids["text"])
        second = Parser(context).parse(context.lowered.rule_ids["text"])
        self.assertIsNot(first.frames, second.frames)
        for forest in (first, second):
            self.assertEqual(competitor_slice(forest, 0, 1, option_of(forest, 0)), {
                "token": 1, "source": (1, 1), "line": 1, "column": 2,
                "expected": [{"terminal": "B", "rules": ["good"]}],
            })

    def test_candidate_lookup_and_enumeration_grow_linearly(self):
        # Engine §12.1: one pass indexes candidates by name and lexical frame.
        for family in ("names", "skipped group", "entry group", "frames"):
            counts = []
            for count in (50, 200):
                with self.subTest(family=family, count=count):
                    distinct = family == "names"
                    good = "%rule good " + " | ".join("A " + ("r" + str(i) if distinct else "r") for i in range(count))
                    if distinct:
                        rules = "\n".join("%rule r" + str(i) + " B" + str(i) for i in range(count))
                    elif family == "skipped group":
                        rules = "%rule r " + " | ".join("B" + str(i) for i in range(count))
                    else:
                        rules = "%rule r " + " | ".join("s" + str(i) for i in range(count)) + "\n" + "\n".join(
                            "%rule s" + str(i) + " B" + str(i) for i in range(count))
                    if family == "frames":
                        good = '%rule good $x:choice {$i:inner} B\n%conditions $i.value ≠ "x"'
                        rules = "%rule choice " + " | ".join("A :: T" + str(i) for i in range(count)) + "\n%rule inner C"
                    context = context_for('%rule text :: ∅ | good ≻ bad\n%rule bad A\n%error "bad"\n' + good + "\n" + rules)
                    forest = Parser(context).parse(context.lowered.rule_ids["text"])
                    option = option_of(forest, 1)
                    work = {}
                    with patch.object(_testing, "work", work):
                        evidence = competitor_slice(forest, 0, 1, option)
                    expected = ([{"terminal": "C", "rules": ["inner"]}] if family == "frames" else sorted([
                        {"terminal": "B" + str(i), "rules": ["r" + str(i) if distinct else "r" if family == "skipped group" else "s" + str(i)]}
                        for i in range(count)], key=lambda entry: entry["terminal"]))
                    self.assertEqual(evidence, {"token": 1, "source": (1, 1), "line": 1, "column": 2, "expected": expected})
                    counts.append(work.get("walkSteps", 0))
                    self.assertLess(counts[-1], 60 * count + 50)
            self.assertLess(counts[1], 5 * counts[0])

    def test_line_positions_share_one_scan_and_preserve_codepoint_coordinates(self):
        # Engine §12.1: all excerpts use one line index for the original source.
        text = "a😀\r\nb\rc\nd"
        lines = SourceLines(text)
        work = {}
        with patch.object(_testing, "work", work):
            for index in range(len(text) + 1):
                self.assertEqual(lines.position(index), line_column(text, index))
            before = work["text"]
            for _ in range(100):
                self.assertEqual(lines.position(len(text)), (4, 2))
        self.assertLess(work["text"] - before, 301)
        self.assertEqual(lines.excerpt((5, 6)), (2, 2, "2 | b\n  |  ^"))
