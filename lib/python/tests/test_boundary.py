"""Finite boundary transfers and diagnostic annotations."""
import unittest
from gencmu._boundary import Records, Annotations, Source, dominates


class BoundaryTests(unittest.TestCase):
    def test_empty_child_keeps_prefix_forward_literal(self):
        machine = Records([])
        atom = {'method': 'followed-by', 'args': [{'rule': 's'}]}
        literal = machine.literal(atom, False)
        prefix = machine.intern(False, 0, 0, literal.bit, 0)
        self.assertEqual(machine.advance(prefix, machine.empty, self.fail), prefix)

    def test_dominance_uses_subset_and_equal_offers(self):
        machine = Records([])
        weak = machine.intern(False, 1, 4, 2, 8)
        strong = machine.intern(False, 3, 4, 6, 8)
        self.assertTrue(dominates(weak, strong))
        self.assertFalse(dominates(strong, weak))
        self.assertFalse(dominates(weak, machine.intern(False, 3, 16, 6, 8)))

    def test_sources_flow_after_an_item_merges(self):
        original, joined, downstream = Source(), Source(), Source()
        joined.inherit(original)
        downstream.inherit(joined)
        site = (0, 2, 'r')
        original.add(site)
        self.assertEqual(downstream.sites, {site})
