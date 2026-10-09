"""Slot admission preserves a linear forest and source diagnostics."""

from __future__ import annotations

import json
import unittest

from gencmu import GencmuError, _testing, load_dialect, load_dialect_sources, result_json
from gencmu._dialect import bundled_text, read_document, _reader, _resources
from gencmu._hash import fnv1a64
from .shared import load_case_dialect, parse_case


def sources(grammar):
    return {'p.md': '```jbogenbau\n%stage main\n%include "g.md"\n```\n', 'g.md': '```jbogenbau\n' + grammar + '\n```\n'}


def cached_sources(texts, dom):
    return {**texts, 'compiled.json': json.dumps({
        'format': 21,
        'bootstrap': fnv1a64(bundled_text('notation/bootstrap.json')),
        'documents': {'g.md': {'hash': fnv1a64(texts['g.md']), 'dom': dom}},
    })}


class Preferences(unittest.TestCase):
    def test_independent_slots_keep_a_linear_forest(self):
        case = {'grammar': '%ambiguity-resolution late-elision\n%rule text {unit}\n%rule unit a | b\n%rule a X\n%tags ∅\n%rule b X\n%tags ∅\n%prefer a > b'}
        dialect, error = load_case_dialect(case)
        self.assertIsNone(error)
        for length in range(1, 33):
            stats = []
            token = _testing.slot_admission.set(stats.append)
            try:
                result, _, _ = parse_case(dialect, {**case, 'tokens': [{'text': 'x', 'tags': ['X']}] * length})
            finally:
                _testing.slot_admission.reset(token)
            self.assertEqual(result['stages'][0]['verdict'], 'unique')
            self.assertEqual(stats[0]['groups'], length)
            self.assertEqual(stats[0]['candidate_edges'], 2 * length)
            self.assertEqual(stats[0]['retained_edges'], length)

    def test_absent_competitors_preserve_ordinary_ranking(self):
        for lean in ('greedy', 'lazy', 'late-elision'):
            case = {'grammar': f'%ambiguity-resolution {lean}\n%rule text a | b | n [+T]\n%rule a X\n%tags ∅\n%rule b Y\n%tags ∅\n%rule n X', 'tokens': [{'text': 'x', 'tags': ['X']}]}
            plain, _ = load_case_dialect(case)
            preferred, error = load_case_dialect({**case, 'grammar': case['grammar'] + '\n%prefer a > b'})
            self.assertIsNone(error)
            result, _, _ = parse_case(preferred, case)
            self.assertEqual(result, parse_case(plain, case)[0])

    def test_cached_dom_preserves_output(self):
        texts = sources("%ambiguity-resolution late-elision\n%rule text a | b\n%rule a 'x'\n%tags ∅\n%rule b 'x'\n%tags ∅\n%prefer a > b")
        plain = load_dialect_sources(texts, 'p.md', use_cache=False)
        cached = load_dialect_sources(cached_sources(texts, read_document(texts['g.md'], 'g.md')), 'p.md')
        self.assertEqual(plain.load_warnings, cached.load_warnings)
        for _ in range(3):
            self.assertEqual(result_json(plain.parse('x', auto_features=False)), result_json(cached.parse('x', auto_features=False)))

    def test_cache_preserves_named_slot_errors(self):
        for body in (
            '%rule text X a | Y b\n%rule a X Y\n%rule b X Y\n%prefer a > b',
            '%rule text $h(a) X | b X\n%emits $h\n%rule a Y Z\n%rule b Y Z\n%prefer a > b',
        ):
            texts = sources('%ambiguity-resolution late-elision\n' + body)
            with self.assertRaises(GencmuError) as plain:
                load_dialect_sources(texts, 'p.md', use_cache=False)
            found = _resources()
            reader = _reader(found.bootstrap, found.unicode)
            dom = reader.read(texts['g.md'], 'g.md', True)
            with self.assertRaises(GencmuError) as cached:
                load_dialect_sources(cached_sources(texts, dom), 'p.md')
            self.assertEqual(str(plain.exception), str(cached.exception))
            self.assertIn('prefer-slot-template', str(plain.exception))

    def test_tag_closure_reports_the_first_source_path(self):
        texts = sources('%ambiguity-resolution late-elision\n%rule text a | b\n%rule a u | v\n%rule v Y\n%rule u X\n%rule b X Y\n%prefer a > b')
        with self.assertRaises(GencmuError) as raised:
            load_dialect_sources(texts, 'p.md')
        self.assertIn('prefer-slot-tags', str(raised.exception))
        self.assertIn('u terminal X', str(raised.exception))
        self.assertNotIn('v terminal Y', str(raised.exception))

    def test_bundled_dialects_have_no_load_warnings(self):
        for name in ('cll-ebnf', 'bpfk', 'experimental', 'zantufa'):
            self.assertEqual(load_dialect(name).load_warnings, [], name)

    def test_every_cycle_edge_has_a_source_location(self):
        texts = sources("%ambiguity-resolution late-elision\n%rule text a\n%rule a 'x'\n%rule b 'x'\n%rule c 'x'\n%prefer a > b\n%prefer b > c\n%prefer c > a")
        with self.assertRaises(GencmuError) as raised:
            load_dialect_sources(texts, 'p.md')
        self.assertIn('a > b > c > a', str(raised.exception))
        for line in (7, 8, 9):
            self.assertIn(f'g.md:{line}:1', str(raised.exception))
