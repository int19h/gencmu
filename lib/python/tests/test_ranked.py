"""Ranked admission preserves a linear forest and source diagnostics."""
from __future__ import annotations
import json
import unittest
from unittest.mock import patch
from gencmu import GencmuError, _testing, load_dialect_sources
from gencmu._dialect import bundled_text, _reader, _resources, NotationReader
from gencmu._hash import fnv1a64
from .shared import load_case_dialect, parse_case


def sources(grammar):
    return {'p.md': '```jbogenbau\n%stage main\n%include "g.md"\n```\n', 'g.md': '```jbogenbau\n' + grammar + '\n```\n'}


def cached_sources(texts, dom):
    return {**texts, 'compiled.json': json.dumps({
        'format': 22,
        'bootstrap': fnv1a64(bundled_text('notation/bootstrap.json')),
        'documents': {'g.md': {'hash': fnv1a64(texts['g.md']), 'dom': dom}},
    })}


class Ranked(unittest.TestCase):
    def test_independent_slots_keep_a_linear_forest(self):
        case = {'grammar': '%ambiguity-resolution late-elision\n%rule text {unit}\n%rule unit a ≻ b\n%rule a X Y\n%rule b X Y'}
        dialect, error = load_case_dialect(case)
        self.assertIsNone(error)
        for length in (1, 2, 4, 8, 16):
            stats = []
            token = _testing.slot_admission.set(stats.append)
            try:
                result, _, _ = parse_case(dialect, {**case, 'tokens': [{'text': tag.lower(), 'tags': [tag]} for _ in range(length) for tag in ('X', 'Y')]})
            finally:
                _testing.slot_admission.reset(token)
            self.assertEqual(result['stages'][0]['verdict'], 'unique')
            self.assertEqual(stats[0]['groups'], length)
            self.assertEqual(stats[0]['candidate_edges'], 2 * length)
            self.assertEqual(stats[0]['retained_edges'], length)

    def test_valid_cached_grammar_never_recovers_locations(self):
        texts = sources('%ambiguity-resolution late-elision\n%rule text Q (a ≻ b) Z\n%rule a X Y\n%rule b X Y')
        found = _resources()
        reader = _reader(found.bootstrap, found.unicode)
        dom = reader.read(texts['g.md'], 'g.md', True)
        with patch.object(NotationReader, 'located', side_effect=AssertionError('source-location recovery ran')), patch('gencmu._ranked.restore_locations', side_effect=AssertionError('source-location recovery ran')):
            load_dialect_sources(texts, 'p.md', use_cache=False)
            for _ in range(2):
                load_dialect_sources(cached_sources(texts, dom), 'p.md')

    def test_cached_dom_preserves_original_diagnostic(self):
        texts = sources('%const $K ~k\n%ambiguity-resolution late-elision\n%rule text Q (($x(a) ≻ b) ≻ c) Z\n%tags $x ⟹ (tags($x) ∪ $K)\n%rule a X Y\n%rule b U V\n%rule c R S')
        with self.assertRaises(GencmuError) as plain:
            load_dialect_sources(texts, 'p.md', use_cache=False)
        found = _resources()
        reader = _reader(found.bootstrap, found.unicode)
        dom = reader.read(texts['g.md'], 'g.md', True)
        with self.assertRaises(GencmuError) as cached:
            load_dialect_sources(cached_sources(texts, dom), 'p.md')
        error = plain.exception
        self.assertEqual(error.to_dict(), cached.exception.to_dict())
        self.assertEqual(error.code, 'ranked-choice-export')
        self.assertEqual(error.group['path'], '/seq/1/ranked/0')
        self.assertEqual(error.group['at'], [4, 22])
        self.assertEqual(error.option, 0)
        self.assertIn('"const":"K"', error.to_json())
        self.assertEqual(list(error.to_dict()), ['kind', 'code', 'message', 'group', 'option', 'expression'])

    def test_shortest_tag_witness(self):
        texts = sources('%ambiguity-resolution late-elision\n%rule text a ≻ b\n%rule a u | v\n%rule u deeper\n%rule deeper X\n%rule v Y\n%rule b Z\n%tags ∅')
        with self.assertRaises(GencmuError) as raised:
            load_dialect_sources(texts, 'p.md')
        error = raised.exception
        self.assertEqual(error.code, 'ranked-choice-tags')
        self.assertEqual([site['rule'] for site in error.inheritance], ['text', 'a', 'v'])

    def test_syntax_and_retirement(self):
        found = _resources()
        reader = _reader(found.bootstrap, found.unicode)
        for body in ('a | b ≻ c', 'a ≻ b | c', '| a ≻ b', 'a ≻', '≻ a'):
            with self.subTest(body=body), self.assertRaises(GencmuError) as raised:
                reader.read('```jbogenbau\n%rule text ' + body + '\n```\n', 'g.md')
            self.assertEqual(raised.exception.code, 'ranked-choice-syntax')
        with self.assertRaises(GencmuError) as raised:
            reader.read('```jbogenbau\n%prefer a > b\n```\n', 'g.md')
        self.assertIsNone(raised.exception.code)
        self.assertEqual((raised.exception.line, raised.exception.column), (2, 1))
        self.assertIn('unknown directive %prefer; use an inline ranked choice', raised.exception.message)
