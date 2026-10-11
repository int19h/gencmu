"""Independent storage and integration controls for aligned queries."""

from __future__ import annotations

import json
from pathlib import Path
import unittest
from gencmu import _testing
from unittest.mock import patch

from gencmu._closes import Block, CloseMachine, Sequences
from gencmu._earley import Parser, StageContext
from gencmu._model import Restoration

from .shared import case_tokens, load_case_dialect, run_case


def tokens(*tags):
    return [{"text": tag.lower(), "tags": [tag]} for tag in tags]


class WithoutElision(unittest.TestCase):
    def assert_outcome(self, grammar, input_tags, accepted):
        value, result, error, _ = run_case({"grammar": grammar, "tokens": tokens(*input_tags)})
        self.assertIsNone(error)
        self.assertIsNotNone(result)
        self.assertEqual(value["ok"], accepted, value)
        return value

    def test_saved_sound_does_not_change_a_common_block_entry(self):
        self.assert_outcome(
            '%rule text Q $x(choice)\n%conditions matches(without-elision($x), choice)\n'
            '%rule choice $p(prefix) (a ≻ b)\n'
            '%rule prefix t | u\n'
            '%rule t X [+T="a"]\n%conditions ¬initial($)\n'
            '%rule u X [+T="b"]\n%conditions initial($)\n'
            '%rule a Y [+U]\n%rule b Y [+V]',
            ('Q', 'X', 'Y'), True,
        )

    def test_prior_control_routes_distinguish_a_common_block_entry(self):
        self.assert_outcome(
            '%rule text Q $x(choice)\n%conditions matches(without-elision($x), choice)\n'
            '%rule choice (a & b) (c ≻ d)\n'
            '%rule a X\n%conditions ¬initial($)\n'
            '%rule b X\n%conditions initial($)\n'
            '%rule c Y [+T]\n%rule d Y [+U]',
            ('Q', 'X', 'Y'), False,
        )

    def test_emission_observes_captured_and_whole_closes(self):
        for body, captured in (('$x(candidate)', '$x'), ('X [+T]', '$')):
            with self.subTest(body=body):
                value, result, error, _ = run_case({
                    'documents': {
                        'p.md': '```jbogenbau\n%stage first\n%include "first.md"\n%stage second\n%include "second.md"\n```',
                        'first.md': '```jbogenbau\n%ambiguity-resolution greedy\n%rule text ' + body + '\n%emits ' + captured +
                            ' <tags(without-elision(' + captured + '), rival)>\n'
                            '%rule candidate X [+T]\n%rule rival X [+T] <KEPT>\n```',
                        'second.md': '```jbogenbau\n%ambiguity-resolution greedy\n%rule text KEPT\n```',
                    },
                    'pipeline': 'p.md',
                    'tokens': tokens('X'),
                })
                self.assertIsNone(error)
                self.assertIsNotNone(result)
                self.assertTrue(value['ok'], value)
                self.assertEqual(value['stages'][0]['output'][0]['tags'], ['KEPT'])

    def test_whole_capture_keeps_the_enclosing_named_cycle(self):
        self.assert_outcome(
            '%rule text $x(X)\n%conditions tags($x, r) = ∅\n'
            '%rule r (($rec(r) [+T]) ≻ Y) <~recursive> | X <∅>\n'
            '%conditions $rec ⟹ ¬matches(without-elision($), rival)\n%rule rival X',
            ('X',), True,
        )

    def test_sound_and_source_stay_in_records_but_not_close_equality(self):
        machine = CloseMachine()
        a = machine.event(Restoration('T', 0, (3, 3), 'a'))
        b = machine.event(Restoration('T', 0, (7, 7), 'b'))
        self.assertNotEqual(a, b)
        self.assertEqual(machine.semantic(a), machine.semantic(b))
        self.assertEqual(list(machine.events(machine.states[a].sequence))[0].sound, 'a')

    def test_a_seal_keeps_cycles_and_hides_private_records(self):
        machine = CloseMachine()
        record = machine.event(Restoration('T', 0, (0, 0)))
        completed = machine.complete(record, 3, 0, 0)
        block = Block(('group',), 0, 0, ())
        sealed = machine.seal(completed, block)
        self.assertEqual(machine.complete(sealed, 3, 0, 0), machine.INVALID)
        self.assertEqual(list(machine.events(machine.states[sealed].sequence)), [block])
        self.assertEqual(machine.seal(machine.INVALID, block), machine.INVALID)

    def test_partial_prefixes_discard_smaller_cycle_spans(self):
        machine = CloseMachine()
        prefix = 0
        for position in range(4000):
            child = machine.complete(0, 3, position, position + 1)
            prefix = machine.trim(machine.concat(prefix, child), 0, position + 1)
            self.assertLessEqual(len(machine.states[prefix].ancestors), 1)
        self.assertLessEqual(sum(len(state.ancestors) for state in machine.states), 8000)

    def test_parent_links_store_a_long_script_without_full_prefix_copies(self):
        machine = CloseMachine()
        prefix = 0
        for position in range(4000):
            prefix = machine.concat(prefix, machine.event(Restoration('T', position, (position, position))))
        self.assertLessEqual(len(machine.links), 8000)
        self.assertLessEqual(len(machine.states), 8001)
        self.assertEqual(sum(1 for _ in machine.events(machine.states[prefix].sequence)), 4000)
        self.assertTrue(all(len(key) == 2 for key in machine.sequences.joins))

    def test_right_recursion_shares_suffix_scripts(self):
        machine = CloseMachine()
        suffix = 0
        for position in range(3999, - 1, - 1):
            suffix = machine.concat(machine.event(Restoration('T', position, (position, position))), suffix)
        self.assertLessEqual(len(machine.links), 8000)
        self.assertEqual(sum(1 for _ in machine.events(machine.states[suffix].sequence)), 4000)

    def test_sequence_equality_is_independent_of_grouping(self):
        machine = CloseMachine()
        a, b, c = [machine.event(Restoration(terminal, 0, (0, 0))) for terminal in ('T', 'U', 'V')]
        self.assertEqual(machine.concat(machine.concat(a, b), c), machine.concat(a, machine.concat(b, c)))

    def test_sequence_fingerprints_never_replace_exact_equality(self):
        with patch.object(Sequences, 'MASK', 0):
            machine = CloseMachine()
            a, b, c = [machine.event(Restoration(terminal, 0, (0, 0))) for terminal in ('T', 'U', 'V')]
            self.assertNotEqual(machine.concat(a, b), machine.concat(a, c))
            self.assertEqual(machine.concat(machine.concat(a, b), c), machine.concat(a, machine.concat(b, c)))

    def test_ambiguous_children_share_close_observations(self):
        grammar = ('%rule text $x(list)\n%conditions matches(without-elision($x), list)\n'
                   '%rule list {unit}\n%rule unit a | b\n%rule a X [+T]\n%rule b X [+T]')
        dialect, error = load_case_dialect({'grammar': grammar})
        self.assertIsNone(error)
        sizes = []
        for count in (8, 32):
            input_tokens, text = case_tokens({'tokens': tokens(*('X' for _ in range(count)))})
            context = StageContext(dialect.lowered(0, frozenset()), input_tokens, text, dialect.unicode)
            forest = Parser(context).parse(context.lowered.rule_ids['text'])
            self.assertTrue(forest.roots)
            sizes.append((len(forest.prod), len(context.closes.states), len(context.closes.links)))
        for small, large in zip(*sizes):
            self.assertLessEqual(large, 6 * small, sizes)


    def test_shared_doubling_bound_and_unused_queries(self):
        shared_root = Path(__file__).resolve().parents[3] / "tests"
        growth = json.loads((shared_root / "without-elision-growth.json").read_text())
        fixture = json.loads((shared_root / growth["case"]).read_text())
        original_count = _testing.count
        for depth in growth["depths"]:
            budget = growth["nodesPerDepth"] * (depth + 1) + growth["slack"]
            for witness in (False,True):
                grammar = "\n".join(fixture["grammar"].splitlines()[:5]).replace("r16",f"r{depth}")
                grammar += "".join(f"\n%rule r{i} r{i-1} r{i-1}" for i in range(1,depth+1))
                if witness:
                    grammar = grammar.replace("matches(without-elision($x), empty)",f"¬matches(without-elision($x), r{depth})")
                def bounded_count(name):
                    original_count(name)
                    if name == "close_sequence_nodes":
                        self.assertLessEqual(_testing.work[name],budget)
                _testing.work = {}
                try:
                    with patch.object(_testing,"count",bounded_count):
                        value,result,error,_ = run_case({**fixture,"grammar":grammar})
                    self.assertIsNone(error)
                    self.assertTrue(value["ok"],value)
                    print(f"depth {depth}, witness {witness}: {_testing.work.get('close_sequence_nodes',0)} close nodes")
                finally:
                    _testing.work = None
        for file in growth["unusedCases"]:
            fixture = json.loads((shared_root / "engine" / file).read_text())
            fixture["grammar"] += "\n%rule unused $x(empty)\n%conditions matches(without-elision($x), empty)\n%rule empty ε"
            dialect,error = load_case_dialect(fixture)
            self.assertIsNone(error)
            input_tokens,text = case_tokens(fixture)
            context = StageContext(dialect.lowered(0,frozenset()),input_tokens,text,dialect.unicode)
            self.assertIsNone(context.closes)
            def unused_count(name):
                original_count(name)
                self.assertNotIn(name,("close_sequence_nodes","close_observation_states"))
            _testing.work = {}
            try:
                with patch.object(_testing,"count",unused_count):
                    value,result,error,_ = run_case(fixture)
                self.assertIsNone(error)
                self.assertTrue(value["ok"],value)
            finally:
                _testing.work = None


if __name__ == '__main__':
    unittest.main()
