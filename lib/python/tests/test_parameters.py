"""Parameterized rules and their source order (engine §2.3)."""

from copy import deepcopy
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from gencmu import GencmuError

from gencmu._pipeline import read_document
from gencmu._templates import canonical_argument, expand_templates
from gencmu._validate import dom_problem
from .shared import load_case_pipeline, same_json


CASES = json.loads((Path(__file__).resolve().parents[3] / 'tests/parameters.json').read_text())


def grammar_of(text):
    pipeline, error = load_case_pipeline(dict(grammar=text))
    if error:
        raise error
    return pipeline._grammars[0]


def instance_names(text):
    dom = read_document('```jbogenbau\n' + text + '\n```')
    unicode = grammar_of('%rule text "a"').unicode
    return expand_templates([('test.md', dom)], unicode)[2]


class Parameters(unittest.TestCase):
    def test_parameter_runner_accepts_repeated_parses_and_document_sources(self):
        for case in (
            {"name": "repeated", "grammar": '%rule atom(@X) @X\n%rule text atom("a")', "input": "a",
             "parses": [{"expect": {"brackets": "a"}}, {"expect": {"brackets": "a"}}]},
            {"name": "documents", "documents": {"p.md": '```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%rule text "a"\n```'},
             "pipelineDocument": "p.md", "input": "a", "expect": {"brackets": "a"}},
        ):
            with self.subTest(case=case["name"]):
                case_test(case)(self)

    def test_instance_errors_retain_effective_names(self):
        for effective, tail in [('use("a")', '%rule text use("a")'), ('named', '%rule named = use("a")\n%rule text named')]:
            with self.subTest(effective=effective), self.assertRaises(GencmuError) as caught:
                grammar_of('%rule use(@X) @X :: @X\n' + tail)
            message = caught.exception.message
            self.assertIn(effective, message)
            self.assertNotIn('expanded', message)
            self.assertNotIn('instance-', message)
        with self.assertRaises(GencmuError) as caught:
            grammar_of('%const $A "a"\n%rule atom(@X) @X\n%rule holder(@Y) @Y\n%rule text holder(($A atom))')
        self.assertEqual((caught.exception.line, caught.exception.column), (5, 1))
        self.assertIn('in holder(($A atom)) called at main.md:6:12', caught.exception.message)

    def test_rule_order_and_rebinding(self):
        grammar = grammar_of('%rule atom(@X) @X\n%rule text atom("a") named\n%rule named = atom("b")\n%redefine-rule named = atom("c")')
        self.assertEqual(list(grammar.rules), ['text', 'named', 'atom("a")', 'atom("b")'])
        self.assertEqual(instance_names('%rule atom(@X) @X\n%rule text atom("a") named\n%rule named = atom("b")\n%redefine-rule named = atom("c")'), ['named', 'atom("a")', 'atom("b")'])

    def test_closed_inner_calls_precede_outer_calls(self):
        grammar = grammar_of('%rule atom(@X) @X\n%rule outer(@X) atom(@X) @X\n%rule text outer(atom("a")) atom("b")')
        self.assertEqual(list(grammar.rules), ['text', 'atom("a")', 'outer(atom("a"))', 'atom("b")', 'atom(atom("a"))'])

    def test_public_edits_stay_on_the_source_key(self):
        grammar = grammar_of('%rule atom(@X) @X\n%rule text item atom("a")\n%rule item = atom("a")\n%extend-rule item "b"\n%redefine-rule item = atom("c")\n%extend-rule item "d"')
        self.assertTrue(same_json([a.expr['literal']['string'] for a in grammar.rules['atom("a")'].alternatives], ['a', 'b']))
        self.assertTrue(same_json([a.expr['literal']['string'] for a in grammar.rules['item'].alternatives], ['c', 'd']))

    def test_ranking_steps_follow_source_order(self):
        grammar = grammar_of('%ambiguity-resolution fewest #·atom, greedy\n%rule atom(@X) @X\n%rule text atom("a") atom("b")\n%redefine-rule atom("a") "c"\n%extend-rule atom(@Y) "d"')
        self.assertEqual(len(grammar.steps), 1)
        self.assertIn('union', grammar.steps[0][1])

    def test_symbol_normalization_and_nominal_constants(self):
        grammar = grammar_of('%const $A "a"\n%rule atom(@X) @X\n%rule text atom("a") atom(("a")) atom($A)')
        self.assertEqual(list(grammar.rules), ['text', 'atom("a")', 'atom($A)'])

    def test_binding_adds_no_tree_node(self):
        pipeline, error = load_case_pipeline(dict(grammar='%rule atom(@X) @X\n%rule text atom("a")\n%rule named = atom("a")'))
        self.assertIsNone(error)
        tree = pipeline.parse('a').tree
        self.assertEqual(tree.children[0].rule, 'named')
        self.assertEqual(tree.children[0].children[0].kind, 'token')

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
        self.assertEqual(len(expand_templates([('test.md', dom)], unicode)[2]), 1)

    def test_ordinary_documents_keep_identity(self):
        unicode = grammar_of('%rule text "a"').unicode
        documents = [('plain.md', read_document('```jbogenbau\n%ambiguity-resolution greedy\n%rule text "a"\n%extend-rule text "b"\n```'))]
        expanded, order, *_ = expand_templates(documents, unicode)
        self.assertIs(expanded, documents)
        self.assertIsNone(order)

    def test_ordinary_edit_history(self):
        grammar = grammar_of('%rule atom(@X) @X\n%rule text "a"\n%extend-rule text "b"\n%redefine-rule text "c"')
        self.assertEqual([(c.kind, c.rule) for c in grammar.changes], [('extend', 'text'), ('replace', 'text')])
        self.assertTrue(same_json(grammar.rules['text'].alternatives[0].expr['literal']['string'], 'c'))

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
            self.assertEqual(len(expanded[2]), 1)

    def test_substituted_optionals_belong_to_the_instance(self):
        from gencmu._grammar import lower
        grammar = grammar_of('%rule tail(@T) "a" [+@T]\n%rule text tail(KU)')
        lowered = lower(grammar, frozenset())
        productions = [p for p in lowered.productions if p.elided == 'KU']
        self.assertTrue(productions)
        self.assertTrue(all(p.elided_owner == 'tail(KU)' for p in productions))

    def test_cached_arguments_and_invalid_parameters(self):
        from gencmu import load_pipeline_sources
        from gencmu._pipeline import _Loader, _resources
        from .test_ranked import cached_sources, sources
        texts = sources('%ambiguity-resolution greedy\n%rule atom(@X) @X\n%rule text = atom("a")')
        dom = read_document(texts['grammars/test/g.md'], 'g.md')
        for valid in (True, False):
            mutated = deepcopy(dom)
            if valid:
                mutated['rules'][1]['instance']['args'] = [dict(body=dict(literal=dict(string='a')))]
            else:
                mutated['rules'][0]['alternatives'][0]['expr'] = dict(param='Other', at=[3, 16])
            supplied = cached_sources(texts, mutated)
            loader = _Loader(lambda path: supplied.get(path), _resources(supplied))
            loader.dom('grammars/test/g.md')
            self.assertEqual(bool(loader.preparsed), valid)
            self.assertTrue(load_pipeline_sources(supplied, 'grammars/test/p.md').parse('a').ok)

    def test_ranked_location_recovery_preserves_arrays(self):
        from gencmu._pipeline import _resources, _reader
        from gencmu._model import Token
        from gencmu._ranked import restore_locations
        from gencmu._template_nodes import nodes
        found = _resources()
        reader = _reader(found.bootstrap, found.unicode, found.properties)
        dom = reader.read('```jbogenbau\n%rule pair(@X,@Y) @X @Y\n%rule text pair("a","b") ("c" ≻ "d") :: ∅\n```', 'locations.md')
        before = deepcopy(dom)
        located = restore_locations(dom, [Token(text='≻', tags=set(), span=(0, 1), value='≻', source=(0, 1))], lambda _: (3, 42))
        self.assertTrue(same_json(dom, before))
        self.assertTrue(same_json(located, before))
        self.assertEqual([n.ranked_at for n in nodes(located) if hasattr(n, 'ranked_at')], [(3, 42)])

    def test_ranked_body_argument_keeps_its_location_after_substitution(self):
        from gencmu._pipeline import _resources, _reader
        from gencmu._model import Token
        from gencmu._ranked import restore_locations, expression_locations
        found = _resources()
        reader = _reader(found.bootstrap, found.unicode, found.properties)
        dom = reader.read('```jbogenbau\n%rule choice(@X) @X :: ∅\n%rule text choice(("a" ≻ "b"))\n```', 'locations.md')
        located = restore_locations(dom, [Token(text='≻', tags=set(), span=(0, 1), value='≻', source=(0, 1))], lambda _: (3, 29))
        expanded = expand_templates([('locations.md', located)], reader.unicode)
        definition = next(dom['rules'][0] for _, dom in expanded[0] if dom['rules'] and dom['rules'][0]['name'].startswith('choice('))
        self.assertEqual(expression_locations(definition['alternatives'][0]['expr']), {'': (3, 29)})


def case_test(case):
    def test(self):
        from .test_engine_cases import EngineCases
        EngineCases().check_fixture(case.get('name', 'parameter case'), case, parameters=True)
    return test


for index, case in enumerate(CASES):
    setattr(Parameters, f'test_parameter_{index:03d}', case_test(case))

class NestedArgumentAliases(unittest.TestCase):
    def test_pattern_constant_fault_comes_from_pattern_schema(self):
        unicode = grammar_of('%rule text "a"').unicode
        for operand in ({'capture': 'x'}, None):
            test = {'test': '=', 'expr': {'terminal': 'A'}}
            if operand is not None:
                test['value'] = operand
            dom = {'format': 43, 'rules': [], 'directives': [], 'classifiers': [], 'implications': [],
                   'constants': [{'name': 'P', 'op': 'define', 'value': {'pattern': test}, 'at': [1, 1]}]}
            self.assertEqual(dom_problem(dom, unicode), 'a malformed pattern value test')

class ParameterStructure(unittest.TestCase):
    def test_argument_comparisons_distinguish_booleans_from_numbers(self):
        source = '%rule use(@X) "a"\n%rule text use(#·A)'
        dom = read_document('```jbogenbau\n' + source + '\n```')
        argument = deepcopy(dom['rules'][-1]['alternatives'][0]['expr']['args'][0])
        case = {'name': 'pattern argument', 'grammar': source, 'argument': argument}
        read_text = Path.read_text
        problem = dom_problem

        def text(path, *args, **kwargs):
            return json.dumps([case]) if path.name == 'parameter-structure.json' else read_text(path, *args, **kwargs)

        def corrupt_after_validation(dom, unicode):
            found = problem(dom, unicode)
            # The comparison must detect a wrong type after DOM validation.
            dom['rules'][-1]['alternatives'][0]['expr']['args'][0]['pattern']['exact'] = 1
            return found

        with patch.object(Path, 'read_text', text):
            ParameterStructure().test_shared_structure()
            with patch(__name__ + '.dom_problem', side_effect=corrupt_after_validation), self.assertRaises(AssertionError):
                ParameterStructure().test_shared_structure()

    def test_supplied_empty_dom_values_reach_cache_validation(self):
        read_text = Path.read_text
        for dom in (None, False, 0, "", [], {}):
            case = {'name': 'supplied empty DOM', 'dom': dom, 'grammar': '%rule text "a"',
                    'cacheFallback': True, 'input': 'a'}

            def read(path, *args, **kwargs):
                return json.dumps([case]) if path.name == 'parameter-structure.json' else read_text(path, *args, **kwargs)

            with self.subTest(dom=dom), patch.object(Path, 'read_text', read):
                self.test_shared_structure()

    def test_shared_structure(self):
        cases = json.loads((Path(__file__).resolve().parents[3] / 'tests/parameter-structure.json').read_text())
        unicode = grammar_of('%rule text "a"').unicode
        for case in cases:
            with self.subTest(case=case['name']):
                if case.get('public'):
                    grammar = grammar_of(case['grammar'])
                    self.assertTrue(same_json(list(grammar.rules), case['order']))
                    if 'instances' in case:
                        self.assertTrue(same_json(len(instance_names(case['grammar'])), case['instances']))
                    continue
                dom = case['dom'] if 'dom' in case else read_document('```jbogenbau\n' + case['grammar'] + '\n```')
                if case.get('cacheFallback'):
                    from gencmu import load_pipeline_sources
                    from .test_ranked import cached_sources, sources
                    self.assertIsNotNone(dom_problem(dom, unicode))
                    texts = sources('%ambiguity-resolution greedy\n' + case['grammar'])
                    supplied = cached_sources(texts, dom)
                    self.assertTrue(load_pipeline_sources(supplied, 'grammars/test/p.md').parse(case['input']).ok)
                    continue
                self.assertIsNone(dom_problem(dom, unicode))
                if 'argument' in case:
                    self.assertTrue(same_json(dom['rules'][-1]['alternatives'][0]['expr']['args'][0], case['argument']))
                _, order, instances, *_ = expand_templates([('parameters.md', dom)], unicode)
                if 'order' in case:
                    if order is None:
                        order = list(dict.fromkeys(rule['name'] for rule in dom['rules']))
                    self.assertTrue(same_json(order, case['order']))
                if 'instances' in case:
                    self.assertEqual(len(instances), case['instances'])


    def test_over_deep_supplied_template(self):
        unicode = grammar_of('%rule text "a"').unicode
        dom = read_document('```jbogenbau\n%rule use(@X) @X\n```')
        expr = dict(param='X', at=[1, 1])
        for _ in range(20000):
            expr = dict(optional=expr)
        dom['rules'][0]['alternatives'][0]['expr'] = expr
        self.assertEqual(dom_problem(dom, unicode), 'nested too deeply')
