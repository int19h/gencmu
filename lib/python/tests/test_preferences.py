"""Exact preference counts, lossless signatures, and the unchanged fast path."""
from __future__ import annotations
import json
import random
import unittest
from gencmu import load_dialect, load_dialect_sources, result_json
from gencmu._dialect import read_document, bundled_text
from gencmu._hash import fnv1a64
from gencmu._prefer_rank import contests
from gencmu import _testing
from .shared import load_case_dialect, parse_case

def sources(grammar):
    return {'p.md': '```jbogenbau\n%stage main\n%include "g.md"\n```\n', 'g.md': '```jbogenbau\n' + grammar + '\n```\n'}

class Preferences(unittest.TestCase):

    def test_exact_cancellation_and_common_additions(self):
        dialect = load_dialect_sources(sources('%ambiguity-resolution late-elision\n%rule text a | b\n%rule a X\n%rule b X\n%prefer a > b'), 'p.md')
        preferences = dialect.grammars[0].preferences
        large = 2 ** 70
        result = contests(preferences, {('a', 0, 1): large + 1}, {('a', 0, 1): large, ('b', 0, 1): 1})
        self.assertEqual(result['forward'][0]['residualCounts'], ['1', '1'])
        rng = random.Random(131)
        keys = [(name, p, q) for name in ('a', 'b') for p, q in ((0, 1), (1, 2), (0, 2))]
        for _ in range(10000):
            a, b, common = ({key: rng.randrange(5) for key in keys} for _ in range(3))
            self.assertEqual(contests(preferences, a, b), contests(preferences, {key: a[key] + common[key] for key in keys}, {key: b[key] + common[key] for key in keys}))

    def test_every_independent_signature_survives(self):
        case = {'grammar': '%ambiguity-resolution late-elision\n%rule text {unit}\n%rule unit a | b\n%rule a X\n%rule b X\n%prefer a > b'}
        dialect, error = load_case_dialect(case)
        self.assertIsNone(error)
        for length in range(1, 9):
            stats = []
            token = _testing.preference_ranking.set(stats.append)
            try:
                result, _, _ = parse_case(dialect, {**case, 'tokens': [{'text': 'x', 'tags': ['X']}] * length})
            finally:
                _testing.preference_ranking.reset(token)
            self.assertEqual(result['stages'][0]['verdict'], 'resolved')
            self.assertTrue(stats[0]['slow'])
            self.assertEqual(stats[0]['largest_set'], 2 ** length)

    def test_fast_path_matches_every_previous_result(self):
        for lean in ('greedy', 'lazy', 'late-elision'):
            case = {'grammar': f'%ambiguity-resolution {lean}\n%rule text a | n [+T]\n%rule a X\n%rule b Y\n%rule n X', 'tokens': [{'text': 'x', 'tags': ['X']}]}
            plain, _ = load_case_dialect(case)
            preferred, _ = load_case_dialect({**case, 'grammar': case['grammar'] + '\n%prefer a > b'})
            stats = []
            token = _testing.preference_ranking.set(stats.append)
            try:
                result, _, _ = parse_case(preferred, case)
            finally:
                _testing.preference_ranking.reset(token)
            self.assertFalse(stats[0]['slow'])
            self.assertEqual(result, parse_case(plain, case)[0])

    def test_cached_dom_preserves_warnings_and_output(self):
        texts = sources("%ambiguity-resolution late-elision\n%rule text a | b\n%rule a b\n%rule b 'x'\n%prefer a > b")
        plain = load_dialect_sources(texts, 'p.md', use_cache=False)
        dom = read_document(texts['g.md'], 'g.md')
        texts['compiled.json'] = json.dumps({'format': 21, 'bootstrap': fnv1a64(bundled_text('notation/bootstrap.json')), 'documents': {'g.md': {'hash': fnv1a64(texts['g.md']), 'dom': dom}}})
        cached = load_dialect_sources(texts, 'p.md')
        self.assertEqual(plain.load_warnings, cached.load_warnings)
        warnings = cached.load_warnings
        for _ in range(3):
            self.assertEqual(result_json(plain.parse('x', auto_features=False)), result_json(cached.parse('x', auto_features=False)))
        self.assertEqual(warnings, cached.load_warnings)

    def test_bundled_dialects_have_no_load_warnings(self):
        for name in ('cll-ebnf', 'bpfk', 'experimental', 'zantufa'):
            self.assertEqual(load_dialect(name).load_warnings, [], name)

    def test_every_cycle_edge_has_a_source_location(self):
        texts = sources("%ambiguity-resolution late-elision\n%rule text a\n%rule a 'x'\n%rule b 'x'\n%rule c 'x'\n%prefer a > b\n%prefer b > c\n%prefer c > a")
        from gencmu import GencmuError
        with self.assertRaises(GencmuError) as raised:
            load_dialect_sources(texts, 'p.md')
        self.assertIn('a > b > c > a', str(raised.exception))
        for line in (7, 8, 9):
            self.assertIn(f'g.md:{line}:1', str(raised.exception))
