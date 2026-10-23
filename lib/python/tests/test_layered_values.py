"""Bind shared layered pattern values through the stage's constant resolver."""

import json
import unittest

from gencmu._dialect import _resources
from gencmu._errors import GencmuError
from gencmu._grammar import _Constant, _Constants
from gencmu._trampoline import run
from gencmu._unicode import UnicodeTable

from .shared import SHARED


def normalized(value):
    if isinstance(value, (set, frozenset)):
        return sorted(value)
    if isinstance(value, list):
        return [normalized(child) for child in value]
    if isinstance(value, dict):
        return {key: normalized(child) for key, child in value.items()}
    return value


class LayeredValues(unittest.TestCase):
    def test_shared_binding(self):
        cases = json.loads((SHARED / 'layered-pattern-values.json').read_text())
        constants = _Constants('main', UnicodeTable(_resources().unicode))
        for name, value in cases['constants'].items():
            kind = 'pattern' if 'pattern' in value else 'tags' if 'set' in value else 'string'
            constants.values[name] = _Constant(value if kind == 'pattern' else frozenset(value['set']) if kind == 'tags' else value['string'], kind, 'values.md')
        for case in cases['cases']:
            with self.subTest(case=case['description']):
                if 'error' in case:
                    with self.assertRaises(GencmuError) as found:
                        run(constants._closed_pattern('values.md', case['pattern'], [1, 1]))
                    self.assertEqual([found.exception.line, found.exception.column], case['error']['at'])
                else:
                    result = run(constants._closed_pattern('values.md', case['pattern'], [1, 1]))
                    self.assertEqual(normalized(result), case['resolved'])
