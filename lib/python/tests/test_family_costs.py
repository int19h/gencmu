"""Abstract automaton costs, including repeated calls that reuse caches."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from gencmu import _testing
from gencmu._closes import Block, CloseMachine
from gencmu._families import DEAD, IDENTITY, FamilyMatcher, Summary
from gencmu._model import Restoration


class FamilyCosts(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(_testing, "work", {}))
        closes = CloseMachine()
        observation = closes.event(Restoration("T", 1, (1, 1)))
        self.matcher = FamilyMatcher(closes, observation, 0, 2, frozenset(("member",)))

    def charge(self, operation, expected):
        before = _testing.work.get("family_steps", 0)
        result = operation()
        self.assertEqual(_testing.work.get("family_steps", 0) - before, expected)
        return result

    def test_record_cache_hit_charges_every_inspection(self):
        first = self.charge(lambda: self.matcher.close("T", 1, "member"), 4)
        self.assertEqual(len(first.relation), 4)
        second = self.charge(lambda: self.matcher.close("T", 1, "member"), 4)
        self.assertIs(second, first)

    def test_composition_cache_hit_charges_each_row_product(self):
        relation = Summary(empty=True, relation=(6, 6, 8, 8))
        first = self.charge(lambda: self.matcher.join(relation, relation), 16)
        second = self.charge(lambda: self.matcher.join(relation, relation), 16)
        self.assertIs(second, first)
        short = Summary(empty=True, relation=(2, 2))
        first = self.charge(lambda: self.matcher.join(short, relation), 8)
        second = self.charge(lambda: self.matcher.join(short, relation), 8)
        self.assertIs(second, first)

    def test_image_and_preimage_cache_hits_charge_every_row(self):
        relation = Summary(empty=True, relation=(6, 6, 8, 8))
        span = Summary(before=4, after=1)
        for left, right in ((relation, span), (span, relation)):
            with self.subTest(left=left, right=right):
                first = self.charge(lambda: self.matcher.join(left, right), 4)
                second = self.charge(lambda: self.matcher.join(left, right), 4)
                self.assertIs(second, first)
        for operation, expected in ((self.matcher.image, 8), (self.matcher.preimage, 3)):
            for _ in range(2):
                self.assertEqual(self.charge(lambda: operation(relation.relation, 4), 4), expected)

    def test_identity_operations_stay_free_on_cache_hits(self):
        relation = Summary(empty=True, relation=(6, 6, 8, 8))
        span = Summary(before=4, after=1)
        for summary in (IDENTITY, relation, span):
            for left, right in ((IDENTITY, summary), (summary, IDENTITY)):
                for _ in range(2):
                    self.assertEqual(self.charge(lambda: self.matcher.join(left, right), 0), summary)
        for operation in (self.matcher.image, self.matcher.preimage):
            for _ in range(2):
                self.assertEqual(self.charge(lambda: operation(None, 4), 0), 4)

    def test_ignored_records_stay_free(self):
        for _ in range(2):
            self.assertIs(self.charge(lambda: self.matcher.close("T", 3, "member"), 0), IDENTITY)
            self.charge(lambda: self.matcher.block(Block(("group",), 2, 3, ())), 0)
            self.charge(lambda: self.matcher.block(Block(("group",), 3, 4, ())), 0)

    def test_block_record_cache_hit_charges_every_inspection(self):
        block = Block(("group",), 1, 1, ())
        for _ in range(2):
            self.assertIs(self.charge(lambda: self.matcher.block(block), 4), DEAD)

    def test_dead_and_nonempty_joins_need_no_relation_steps(self):
        span = Summary(before=1, after=1)
        relation = Summary(empty=True, relation=(6, 6, 8, 8))
        for left, right in ((DEAD, relation), (relation, DEAD), (span, span)):
            for _ in range(2):
                self.charge(lambda: self.matcher.join(left, right), 0)
