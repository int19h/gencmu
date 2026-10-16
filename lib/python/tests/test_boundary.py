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

    def test_cached_target_locations_follow_the_reader(self):
        import gencmu
        from gencmu._dialect import read_document
        from .test_ranked import sources, cached_sources
        for method in ('followed-by', 'preceded-by'):
            for clause in ('%conditions $.METHOD(((a)) | (A) | z)',
                           '%emits $ :: ($.METHOD(((a)) | (A) | z) ⟹ T)'):
                text = '%const $OK A\n%ambiguity-resolution greedy\n%rule text a\n%rule a A\n' + clause.replace('METHOD', method) + '\n%rule z B'
                texts = sources(text)
                dom = read_document(texts['g.md'], 'g.md')
                cached = cached_sources(texts, dom)
                with self.subTest(method=method, clause=clause):
                    errors = []
                    for values in (texts, cached):
                        with self.assertRaises(gencmu.GencmuError) as caught:
                            gencmu.load_dialect_sources(values, 'p.md')
                        errors.append(caught.exception)
                    self.assertEqual((errors[0].line, errors[0].column), (errors[1].line, errors[1].column))
                    self.assertEqual(errors[1].line, 6)

    def test_cached_private_boundary_error_preserves_expression(self):
        import gencmu
        from gencmu._dialect import read_document
        from .test_ranked import sources, cached_sources
        texts = sources('%const $OK A\n%ambiguity-resolution greedy\n%rule text X r | Y r\n%rule r C ($a:aa ≻ bb) :: ∅\n%conditions $a.tags = $OK ∧ ¬$.preceded-by(X)\n%rule aa A\n%rule bb A')
        dom = read_document(texts['g.md'], 'g.md')
        errors = []
        for values in (texts, cached_sources(texts, dom)):
            with self.assertRaises(gencmu.GencmuError) as caught:
                gencmu.load_dialect_sources(values, 'p.md')
            errors.append(caught.exception)
        self.assertEqual(errors[0].code, 'ranked-choice-boundary')
        for field in ('code', 'group', 'option', 'expression', 'line', 'column'):
            self.assertEqual(getattr(errors[0], field), getattr(errors[1], field))
