"""Parameterized rules and their source order (engine §2.3)."""

from copy import deepcopy
import json
from pathlib import Path
import unittest

from gencmu._dialect import read_document
from gencmu._templates import canonical_argument, expand_templates, template_audit
from gencmu._validate import dom_problem
from .shared import load_case_dialect, run_case


CASES = json.loads((Path(__file__).resolve().parents[3] / 'tests/parameters.json').read_text())


def grammar_of(text):
    dialect, error = load_case_dialect(dict(grammar=text))
    if error:
        raise error
    return dialect.grammars[0]


class Parameters(unittest.TestCase):
    def test_rule_order_and_rebinding(self):
        grammar = grammar_of('%rule atom(@X) @X\n%rule text atom("a") named\n%rule named = atom("b")\n%redefine-rule named = atom("c")')
        self.assertEqual(list(grammar.rules), ['text', 'named', 'atom("a")', 'atom("b")'])
        self.assertEqual([i['name'] for i in template_audit(grammar)['instances']], ['named', 'atom("a")', 'atom("b")'])

    def test_closed_inner_calls_precede_outer_calls(self):
        grammar = grammar_of('%rule atom(@X) @X\n%rule outer(@X) atom(@X) @X\n%rule text outer(atom("a")) atom("b")')
        self.assertEqual(list(grammar.rules), ['text', 'atom("a")', 'outer(atom("a"))', 'atom("b")', 'atom(atom("a"))'])

    def test_public_edits_stay_on_the_source_key(self):
        grammar = grammar_of('%rule atom(@X) @X\n%rule text item atom("a")\n%rule item = atom("a")\n%extend-rule item "b"\n%redefine-rule item = atom("c")\n%extend-rule item "d"')
        self.assertEqual([a.expr['literal']['string'] for a in grammar.rules['atom("a")'].alternatives], ['a', 'b'])
        self.assertEqual([a.expr['literal']['string'] for a in grammar.rules['item'].alternatives], ['c', 'd'])

    def test_flags_follow_source_order(self):
        grammar = grammar_of('%rule(fewest) atom(@X) @X\n%rule text atom("a") atom("b")\n%redefine-rule atom("a") "c"\n%extend-rule atom(@Y) "d"')
        self.assertEqual(grammar.rules['atom("a")'].flags, [])
        self.assertEqual(grammar.rules['atom("b")'].flags, ['fewest'])
        self.assertEqual([[e['scope'], e['op'], e['flagsAfter']] for e in template_audit(grammar)['instances'][0]['events']],
                         [['template', 'define', ['fewest']], ['instance', 'redefine', []], ['template', 'extend', []]])

    def test_symbol_normalization_and_nominal_constants(self):
        grammar = grammar_of('%const $A "a"\n%rule atom(@X) @X\n%rule text atom("a") atom(("a")) atom($A)')
        self.assertEqual(list(grammar.rules), ['text', 'atom("a")', 'atom($A)'])

    def test_binding_adds_no_tree_node(self):
        dialect, error = load_case_dialect(dict(grammar='%rule atom(@X) @X\n%rule text atom("a")\n%rule named = atom("a")'))
        self.assertIsNone(error)
        tree = dialect.parse('a').tree
        self.assertEqual(tree.children[0].rule, 'named')
        self.assertEqual(tree.children[0].children[0].kind, 'token')

    def test_audit_notes(self):
        grammar = grammar_of('%rule atom(@X) @X\n%rule unused(@A,@B) @A\n%rule outer(@X) @X\n%rule text outer(named) outer(atom("a"))\n%rule named = atom("a")')
        audit = template_audit(grammar)
        self.assertEqual(audit['templates'][1]['notes'], [dict(kind='unused-parameter', parameter='B'), dict(kind='uncalled-template')])
        self.assertEqual([i['notes'] for i in audit['instances'] if i['template'] == 'outer'],
                         [[dict(kind='argument-alias-twin', instances=['outer(atom("a"))'])], [dict(kind='argument-alias-twin', instances=['outer(named)'])]])

    def test_canonical_arguments(self):
        unicode = grammar_of('%rule text "a"').unicode
        self.assertEqual(canonical_argument(dict(call='f', args=[dict(string='a\n\t\u0301'), dict(concat=[dict(string='a'), dict(string='')])], at=[1, 1]), unicode),
                         'f("a‹LF›‹HT›‹U+0301›", "a" ++ "")')
        self.assertEqual(canonical_argument(dict(body=dict(seq=[dict(ref='a'), dict(seq=[dict(ref='b'), dict(ref='c')])])), unicode), '(a (b c))')

    def test_supplied_dom(self):
        unicode = grammar_of('%rule text "a"').unicode
        dom = read_document('```jbogenbau\n%rule atom(@X) @X\n%rule text atom("a")\n```')
        for bad in [dict(param='X'), dict(param='Y', at=[1, 1]), dict(param='X', at=[0, 1])]:
            mutated = deepcopy(dom)
            mutated['rules'][0]['alternatives'][0]['expr'] = bad
            self.assertIsNotNone(dom_problem(mutated, unicode))
        for bad in [dict(capture='x'), dict(method='value', receiver=dict(capture=''), args=[]), dict(body=dict(capture='x', expr=dict(ref='A')))]:
            mutated = deepcopy(dom)
            mutated['rules'][1]['alternatives'][0]['expr']['args'] = [bad]
            self.assertIsNotNone(dom_problem(mutated, unicode))

    def test_supplied_symbol_body_normalizes(self):
        unicode = grammar_of('%rule text "a"').unicode
        dom = read_document('```jbogenbau\n%ambiguity-resolution greedy\n%rule atom(@X) @X\n%rule text atom("a") atom("a")\n```')
        dom['rules'][1]['alternatives'][0]['expr']['seq'][1]['args'] = [dict(body=dict(literal=dict(string='a')))]
        self.assertIsNone(dom_problem(dom, unicode))
        self.assertEqual(len(expand_templates([('test.md', dom)], unicode)[3]), 1)

    def test_ordinary_documents_keep_identity(self):
        unicode = grammar_of('%rule text "a"').unicode
        documents = [('plain.md', read_document('```jbogenbau\n%ambiguity-resolution greedy\n%rule text "a"\n%extend-rule text "b"\n```'))]
        expanded, order, *_ = expand_templates(documents, unicode)
        self.assertIs(expanded, documents)
        self.assertIsNone(order)

    def test_ordinary_edit_history(self):
        grammar = grammar_of('%rule atom(@X) @X\n%rule text "a"\n%extend-rule text "b"\n%redefine-rule text "c"')
        self.assertEqual([(c.kind, c.rule) for c in grammar.changes], [('extend', 'text'), ('replace', 'text')])
        self.assertEqual(grammar.rules['text'].alternatives[0].expr['literal']['string'], 'c')

    def test_deep_template_bodies_and_arguments(self):
        unicode = grammar_of('%rule text "a"').unicode
        for supplied in (False, True):
            dom = read_document('```jbogenbau\n%rule atom(@X) @X\n%rule text atom("a")\n```')
            expr = dict(literal=dict(string='a')) if supplied else dict(param='X', at=[2, 16])
            for _ in range(250):
                expr = dict(seq=[expr, dict(empty=True)])
            if supplied:
                dom['rules'][1]['alternatives'][0]['expr']['args'] = [dict(body=expr)]
            else:
                dom['rules'][0]['alternatives'][0]['expr'] = expr
            self.assertIsNone(dom_problem(dom, unicode))
            expanded = expand_templates([('deep.md', dom)], unicode)
            self.assertEqual(len(expanded[3]), 1)

    def test_substituted_optionals_belong_to_the_instance(self):
        from gencmu._grammar import lower
        grammar = grammar_of('%rule tail(@T) "a" [+@T]\n%rule text tail(KU)')
        lowered = lower(grammar, frozenset())
        productions = [p for p in lowered.productions if p.elided == 'KU']
        self.assertTrue(productions)
        self.assertTrue(all(p.elided_owner == 'tail(KU)' for p in productions))

    def test_cached_arguments_and_invalid_parameters(self):
        from gencmu import load_dialect_sources
        from gencmu._dialect import _Loader, _resources
        from .test_ranked import cached_sources, sources
        texts = sources('%ambiguity-resolution greedy\n%rule atom(@X) @X\n%rule text = atom("a")')
        dom = read_document(texts['g.md'], 'g.md')
        for valid in (True, False):
            mutated = deepcopy(dom)
            if valid:
                mutated['rules'][1]['instance']['args'] = [dict(body=dict(literal=dict(string='a')))]
            else:
                mutated['rules'][0]['alternatives'][0]['expr'] = dict(param='Other', at=[3, 16])
            supplied = cached_sources(texts, mutated)
            loader = _Loader(lambda path: supplied.get(path), _resources(supplied))
            self.assertEqual(bool(loader.compiled), valid)
            self.assertTrue(load_dialect_sources(supplied, 'p.md').parse('a').ok)

    def test_ranked_location_recovery_preserves_arrays(self):
        from gencmu._dialect import _resources, _reader
        from gencmu._model import Token
        from gencmu._ranked import restore_locations
        from gencmu._template_nodes import nodes
        found = _resources()
        reader = _reader(found.bootstrap, found.unicode, found.properties)
        dom = reader.read('```jbogenbau\n%rule pair(@X,@Y) @X @Y\n%rule text pair("a","b") ("c" ≻ "d") :: ∅\n```', 'locations.md')
        before = deepcopy(dom)
        located = restore_locations(dom, [Token(text='≻', tags=set(), span=(0, 1), value='≻', source=(0, 1))], lambda _: (3, 42))
        self.assertEqual(dom, before)
        self.assertEqual(located, before)
        self.assertEqual([n.ranked_at for n in nodes(located) if hasattr(n, 'ranked_at')], [(3, 42)])

    def test_ranked_body_argument_keeps_its_location_after_substitution(self):
        from gencmu._dialect import _resources, _reader
        from gencmu._model import Token
        from gencmu._ranked import restore_locations, expression_locations
        found = _resources()
        reader = _reader(found.bootstrap, found.unicode, found.properties)
        dom = reader.read('```jbogenbau\n%rule choice(@X) @X :: ∅\n%rule text choice(("a" ≻ "b"))\n```', 'locations.md')
        located = restore_locations(dom, [Token(text='≻', tags=set(), span=(0, 1), value='≻', source=(0, 1))], lambda _: (3, 29))
        expanded = expand_templates([('locations.md', located)], reader.unicode)
        definition = expanded[3][0]['definitions'][0]['rule']
        self.assertEqual(expression_locations(definition['alternatives'][0]['expr']), {'': (3, 29)})


def case_test(case):
    def test(self):
        from .test_engine_cases import EngineCases
        EngineCases().check(case['name'], case['expect'], *run_case(case))
    return test


for index, case in enumerate(CASES):
    setattr(Parameters, f'test_parameter_{index:03d}', case_test(case))

class NestedArgumentAliases(unittest.TestCase):
    def test_nested_alias_twins_follow_expanded_order(self):
        for source in ['%rule atom(@X) @X\n%rule outer(@X) @X\n%rule public "a"\n%rule text outer((named named)) outer((atom("a") atom("a"))) outer((named atom("a"))) outer((atom("a") named))\n%rule named = atom("a")\n%redefine-rule public = outer((atom("a") named))','%rule atom(@X) @X\n%rule outer(@P) $x:named %conditions $x ≅ @P\n%rule text outer(#named) outer(#atom("a"))\n%rule named = atom("a")']:
            instances = [i for i in template_audit(grammar_of(source))['instances'] if i['template'] == 'outer']
            assert len(instances) == (4 if 'public' in source else 2)
            for instance in instances:
                assert instance['notes'] == [dict(kind='argument-alias-twin', instances=[other['name'] for other in instances if other is not instance])]

class ParameterStructure(unittest.TestCase):
    def test_shared_structure(self):
        cases = json.loads((Path(__file__).resolve().parents[3] / 'tests/parameter-structure.json').read_text())
        unicode = grammar_of('%rule text "a"').unicode
        for case in cases:
            with self.subTest(case=case['name']):
                if case.get('public'):
                    grammar = grammar_of(case['grammar'])
                    self.assertEqual(list(grammar.rules), case['order'])
                    if 'instances' in case:
                        self.assertEqual(len(template_audit(grammar)['instances']), case['instances'])
                    continue
                dom = case.get('dom') or read_document('```jbogenbau\n' + case['grammar'] + '\n```')
                if case.get('cacheFallback'):
                    from gencmu import load_dialect_sources
                    from .test_ranked import cached_sources, sources
                    self.assertIsNotNone(dom_problem(dom, unicode))
                    texts = sources('%ambiguity-resolution greedy\n' + case['grammar'])
                    supplied = cached_sources(texts, dom)
                    self.assertTrue(load_dialect_sources(supplied, 'p.md').parse(case['input']).ok)
                    continue
                self.assertIsNone(dom_problem(dom, unicode))
                if 'argument' in case:
                    self.assertEqual(dom['rules'][-1]['alternatives'][0]['expr']['args'][0], case['argument'])
                _, order, _, instances, _ = expand_templates([('review.md', dom)], unicode)
                if 'order' in case:
                    self.assertEqual(order, case['order'])
                if 'instances' in case:
                    self.assertEqual(len(instances), case['instances'])
                if 'flags' in case:
                    grammar = grammar_of(case['grammar'])
                    for name, flags in case['flags'].items():
                        self.assertEqual(grammar.rules[name].flags, flags)

    def test_over_deep_supplied_template(self):
        unicode = grammar_of('%rule text "a"').unicode
        dom = read_document('```jbogenbau\n%rule use(@X) @X\n```')
        expr = dict(param='X', at=[1, 1])
        for _ in range(20000):
            expr = dict(optional=expr)
        dom['rules'][0]['alternatives'][0]['expr'] = expr
        self.assertEqual(dom_problem(dom, unicode), 'nested too deeply')
