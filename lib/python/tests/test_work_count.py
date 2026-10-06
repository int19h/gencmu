"""The monitoring counters preserve calls, loop steps, weights, and nesting."""

from __future__ import annotations

import sys
import unittest

from .shared import OverBudget, calls, count_work, steps


class WorkCount(unittest.TestCase):
    def test_nested_counts_keep_the_outer_calls(self) -> None:
        def visit() -> None:
            pass

        tools = [sys.monitoring.get_tool(tool) for tool in range(6)]
        with count_work(calls(visit)) as outer:
            visit()
            with count_work(calls(visit)) as inner:
                visit()
                visit()
            visit()
        self.assertEqual(outer.count, 4)
        self.assertEqual(inner.count, 2)
        self.assertEqual([sys.monitoring.get_tool(tool) for tool in range(6)], tools)

    def test_a_generator_counts_once_across_its_resumptions(self) -> None:
        def generate():
            yield 1
            yield 2
            yield 3

        with count_work(calls(generate)) as work:
            generator = generate()
            self.assertEqual(work.count, 0)
            self.assertEqual(list(generator), [1, 2, 3])
        self.assertEqual(work.count, 1)

    def test_a_loop_on_one_line_counts_each_backward_jump(self) -> None:
        def repeat(remaining: int) -> None:
            while remaining: remaining -= 1

        for count in (0, 1, 7):
            with self.subTest(count=count), count_work(steps(repeat, "while remaining:")) as work:
                repeat(count)
            # Compilers can revisit the condition on the last pass or return
            # directly. Every pass still counts, including the zero-pass check.
            self.assertGreaterEqual(work.count, max(count, 1))
            self.assertLessEqual(work.count, count + 1)

    def test_filtered_lines_count_again_in_a_later_context(self) -> None:
        def total(count: int) -> int:
            answer = 0
            for number in range(count):
                answer += number
            return answer

        for count in (3, 7):
            with count_work(steps(total, "answer += number")) as work:
                self.assertEqual(total(count), sum(range(count)))
            self.assertEqual(work.count, count)

    def test_a_weight_stops_before_the_call_and_releases_its_tool(self) -> None:
        effects = []

        def visit(values: list[int]) -> None:
            effects.append(values)

        watch = calls(visit, weight=lambda frame: len(frame.f_locals["values"]))
        tools = [sys.monitoring.get_tool(tool) for tool in range(6)]
        with self.assertRaises(OverBudget), count_work(watch, budget=2) as work:
            visit([1, 2, 3])
        self.assertEqual(work.count, 3)
        self.assertEqual(effects, [])
        self.assertEqual([sys.monitoring.get_tool(tool) for tool in range(6)], tools)
        with count_work(watch) as work:
            visit([1, 2, 3])
        self.assertEqual(work.count, 3)
        self.assertEqual(effects, [[1, 2, 3]])

    def test_a_freed_tool_can_monitor_other_code_without_stale_callbacks(self) -> None:
        def visit() -> None:
            pass

        def unrelated() -> None:
            for _ in range(3):
                pass

        monitoring = sys.monitoring
        events = (monitoring.events.PY_START, monitoring.events.LINE, monitoring.events.JUMP)
        for budget in (None, 0):
            with self.subTest(budget=budget):
                tool = next(tool for tool in range(6) if monitoring.get_tool(tool) is None)
                if budget is None:
                    with count_work(calls(visit), steps(visit)):
                        visit()
                else:
                    with self.assertRaises(OverBudget), count_work(calls(visit), steps(visit), budget=budget):
                        visit()
                self.assertIsNone(monitoring.get_tool(tool))
                monitoring.use_tool_id(tool, "gencmu tests: reused tool")
                try:
                    self.assertEqual(monitoring.get_events(tool), monitoring.events.NO_EVENTS)
                    self.assertEqual(monitoring.get_local_events(tool, visit.__code__), monitoring.events.NO_EVENTS)
                    for event in events:
                        with self.subTest(event=event):
                            try:
                                monitoring.set_local_events(tool, unrelated.__code__, event)
                                unrelated()
                            finally:
                                monitoring.set_local_events(tool, unrelated.__code__, monitoring.events.NO_EVENTS)
                            self.assertIsNone(monitoring.register_callback(tool, event, None))
                finally:
                    monitoring.set_events(tool, monitoring.events.NO_EVENTS)
                    monitoring.set_local_events(tool, unrelated.__code__, monitoring.events.NO_EVENTS)
                    for event in events:
                        monitoring.register_callback(tool, event, None)
                    monitoring.free_tool_id(tool)
