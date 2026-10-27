"""Finite boundary transfers and diagnostic annotations."""
import unittest
from gencmu._boundary import Records, Annotations, Source, dominates


class BoundaryTests(unittest.TestCase):
    def test_nested_queries_discover_boundary_targets_once_per_stage(self):
        from .shared import calls, count_work, load_case_dialect, parse_case
        for boundary in ('', '\n%conditions ¬$.followed-by(A)'):
            grammar = ('%rule text {piece}\n%rule piece A\n'
                       '%conditions $.matches(one), $.begins(two), Seen ⊆ $.tags(three)\n'
                       '%rule one A' + boundary + '\n%rule two A\n%rule three A :: Seen')
            dialect, error = load_case_dialect({'grammar': grammar})
            self.assertIsNone(error)
            case = {'tokens': [{'text': 'a', 'tags': ['A']}] * 10}
            for _ in range(2):
                with self.subTest(boundary=boundary), count_work(calls(Records.__init__)) as work:
                    value, _, error = parse_case(dialect, case)
                self.assertIsNone(error)
                self.assertTrue(value['ok'], value)
                self.assertEqual(work.count, 1)

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
                dom = read_document(texts['grammars/test/g.md'], 'g.md')
                cached = cached_sources(texts, dom)
                with self.subTest(method=method, clause=clause):
                    errors = []
                    for values in (texts, cached):
                        with self.assertRaises(gencmu.GencmuError) as caught:
                            gencmu.load_dialect_sources(values, 'grammars/test/p.md')
                        errors.append(caught.exception)
                    self.assertEqual((errors[0].line, errors[0].column), (errors[1].line, errors[1].column))
                    self.assertEqual(errors[1].line, 6)

    def test_cached_private_boundary_error_preserves_expression(self):
        import gencmu
        from gencmu._dialect import read_document
        from .test_ranked import sources, cached_sources
        texts = sources('%const $OK A\n%ambiguity-resolution greedy\n%rule text X r | Y r\n%rule r C ($a:aa ≻ bb) :: ∅\n%conditions $a.tags = $OK ∧ ¬$.preceded-by(X)\n%rule aa A\n%rule bb A')
        dom = read_document(texts['grammars/test/g.md'], 'g.md')
        errors = []
        for values in (texts, cached_sources(texts, dom)):
            with self.assertRaises(gencmu.GencmuError) as caught:
                gencmu.load_dialect_sources(values, 'grammars/test/p.md')
            errors.append(caught.exception)
        self.assertEqual(errors[0].code, 'ranked-choice-boundary')
        for field in ('code', 'group', 'option', 'expression', 'line', 'column'):
            self.assertEqual(getattr(errors[0], field), getattr(errors[1], field))

    def test_equal_literals_keep_both_condition_sources(self):
        from gencmu._earley import Parser, StageContext
        from .shared import load_case_dialect, case_tokens
        dialect, error = load_case_dialect({'grammar': '%rule text r B\n%rule r A\n%conditions ¬$.followed-by(B), ¬$.followed-by(B)'})
        self.assertIsNone(error)
        tokens, text = case_tokens({'tokens': [{'text': 'a', 'tags': ['A']}, {'text': 'b', 'tags': ['B']}]})
        for token in tokens:
            token.tags = frozenset(token.tags)
        lowered = dialect.lowered(0, frozenset())
        forest = Parser(StageContext(lowered, tokens, text, dialect.unicode)).parse(lowered.rule_ids['text'])
        sites = {(condition, rule) for _, _, _, source in forest.boundary_failures if source is not None
                 for order, condition, rule in source.sites}
        self.assertEqual(sites, {(0, 'r'), (1, 'r')})

    def test_admission_reports_a_split_once(self):
        from gencmu import _testing
        from .shared import load_case_dialect, parse_case
        grammar = '%rule text (p ≻ q ≻ r) :: ∅ | B\n%rule p A\n%conditions ¬$.followed-by(B)\n%rule q A\n%rule r A'
        dialect, error = load_case_dialect({'grammar': grammar})
        self.assertIsNone(error)
        stats = []
        handle = _testing.slot_admission.set(stats.append)
        try:
            parse_case(dialect, {'tokens': [{'text': 'a', 'tags': ['A']}]})
        finally:
            _testing.slot_admission.reset(handle)
        splits = [split for result in stats for split in result['boundary_splits']]
        self.assertEqual(len(splits), 1)
        self.assertEqual((splits[0]['start'], splits[0]['end']), (0, 1))

    def test_query_settles_a_witness_after_its_ancestors_complete(self):
        from .shared import load_case_dialect, parse_case
        for query in ('$.matches(r)', '$.begins(r)', 'Seen ⊆ $.tags(r)'):
            grammar = ('%rule text A\n%conditions ' + query +
                       '\n%rule r :: Seen\n | a\n | q\n%rule q r\n%rule a $e:empty A'
                       '\n%conditions $e.followed-by(q)\n%rule empty ε')
            dialect, error = load_case_dialect({'grammar': grammar})
            self.assertIsNone(error)
            with self.subTest(query=query):
                value, _, _ = parse_case(dialect, {'tokens': [{'text': 'a', 'tags': ['A']}]})
                self.assertTrue(value['ok'], value)
