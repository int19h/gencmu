"""Erased classes and their canonical interiors (engine §6 and §7.10)."""

import unittest

import gencmu
from gencmu._earley import StageContext, Parser
from gencmu._grammar import lower
from gencmu._rank import rank
from gencmu._stage import derivation


def prepare(grammar, tags=("A",)):
    if "%ambiguity-resolution" not in grammar:
        grammar = "%ambiguity-resolution greedy\n" + grammar
    loaded = gencmu.load_pipeline_sources({
        "p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n',
        "g.md": '```jbogenbau\n' + grammar + '\n```\n',
    }, "p.md")
    lowered = lower(loaded._grammars[0], frozenset())
    tokens = [gencmu.Token(tag.lower(), frozenset({tag}), (index, index + 1), (index, index + 1)) for index, tag in enumerate(tags)]
    context = StageContext(lowered, tokens, "".join(token.text for token in tokens), loaded._unicode)
    forest = Parser(context).parse(lowered.rule_ids["text"])
    ranking = rank(forest, lowered.steps, lowered.lean)
    return ranking, derivation(forest, ranking.first)


def find(root, name):
    pending = [root]
    while pending:
        node = pending.pop()
        if hasattr(node, "production"):
            if node.production.rule_name == name:
                return node
            pending.extend(reversed(node.children))
    return None


class ErasedInteriors(unittest.TestCase):
    def test_unused_private_bindings_do_not_split_a_class(self):
        # Engine §6: only completed observable state crosses an erased call.
        for body in ("[A] [A] :: ∅", "[$x:A] [A] :: ∅", "first | second"):
            with self.subTest(body=body):
                ranking, root = prepare("%rule text gone\n%rule gone " + body + "\n%erased\n%rule first A\n%rule second A")
                self.assertEqual(ranking.verdict, "unique")
                self.assertEqual(ranking.profile[:3], (0, 0, 0))

    def test_a_common_suffix_settles_canonical_prefixes(self):
        # Engine §6: the key-free channel retains prefix-related candidates.
        ranking, root = prepare("%rule text gone\n%rule gone x y\n%erased\n%rule x a | a b\n%rule a ε\n%rule b ε\n%rule y ε", ())
        self.assertEqual(ranking.verdict, "unique")
        self.assertEqual(len(find(root, "x").children), 2)

    def test_shared_live_and_erased_items_use_different_summaries(self):
        # Engine §6: a live caller keeps grammar preferences over shared items.
        ranking, root = prepare("%ambiguity-resolution fewest #·a\n%rule text gone B live\n%rule gone choices\n%erased\n%rule live choices\n%rule choices a | b\n%rule a A\n%rule b A", ("A", "B", "A"))
        self.assertEqual(ranking.verdict, "resolved")
        self.assertIsNotNone(find(find(root, "gone"), "a"))
        self.assertIsNotNone(find(find(root, "live"), "b"))

    def test_an_erased_interior_chooses_measure_before_canonical_actions(self):
        # Engine §6: an error-free interior beats an earlier faulty production.
        ranking, root = prepare('%rule text gone\n%rule gone bad | A\n%erased\n%rule bad A\n%error "bad"')
        self.assertEqual(ranking.verdict, "unique")
        self.assertIsNone(find(root, "bad"))
        self.assertEqual(ranking.profile[:3], (0, 0, 0))

    def test_membership_survives_a_canonical_interior_with_a_better_measure(self):
        # Engine §7.10: admitted class membership is separate from its kept edges.
        loaded = gencmu.load_pipeline_sources({
            "p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n',
            "g.md": '```jbogenbau\n%ambiguity-resolution greedy\n%elision-only\n%rule text gone\n%rule gone "a" T | bad [+T]\n%erased\n%rule bad "a"\n%error "bad"\n```\n',
        }, "p.md")
        result = loaded.parse("a")
        self.assertTrue(result.ok, result.error)
        self.assertEqual(result.stages[0].verdict, "unique")
        self.assertEqual(result.warnings, [])

    def test_an_erased_cycle_keeps_only_finite_interiors(self):
        # Engine §6: collapse preserves the same-span cycle context.
        ranking, root = prepare("%rule text gone\n%rule gone gone | A\n%erased")
        self.assertEqual(ranking.verdict, "unique")
        self.assertEqual(len(find(root, "gone").children), 1)
        self.assertFalse(hasattr(find(root, "gone").children[0], "production"))

    def test_canonical_interiors_obey_ranked_admission(self):
        # Engine §6.1: erasure resets a contribution after ranked admission.
        ranking, root = prepare("%rule text gone\n%rule gone A (b ≻ c) :: ∅\n%erased\n%rule b B\n%rule c B", ("A", "B"))
        self.assertEqual(ranking.verdict, "unique")
        self.assertIsNotNone(find(root, "b"))
        self.assertIsNone(find(root, "c"))
        ranking, root = prepare('%rule text (gone ≻ live) :: ∅\n%rule gone bad\n%erased\n%rule bad A\n%error "bad"\n%rule live A')
        self.assertEqual(ranking.verdict, "unique")
        self.assertIsNotNone(find(root, "gone"))
        self.assertEqual(ranking.profile[:3], (0, 0, 0))

    def test_independent_erased_choices_share_linear_summaries(self):
        # Engine §6: the extra channel shares items instead of enumerating interiors.
        for count in (2, 8, 32):
            with self.subTest(count=count):
                ranking, root = prepare("%rule text " + "gone B " * count + "\n%rule gone [A] [A] :: ∅\n%erased", ("A", "B") * count)
                self.assertEqual(ranking.verdict, "unique")
                canonical = ranking._ranker.canonical_ranker
                self.assertIsNotNone(canonical)
                contexts = len(ranking._ranker.memo) + len(canonical.memo) + len(canonical.best.memo)
                self.assertLess(contexts, 60 * count + 10)
                for entries, total in canonical.memo.values():
                    self.assertLess(len(entries), 5)


    def test_post_selection_owns_a_working_view_but_exports_a_seal(self):
        # Engine §4.1: serialized children never reconstruct the public identity.
        from gencmu._stage import working_structure
        from gencmu._tree_identities import derivation_identity
        ranking, root = prepare("%rule text e\n%rule e a\n%conditions $ ≅ #« a »\n%erased\n%rule a A")
        forest = ranking._ranker.forest
        context = forest.context
        node = find(root, "e")
        pattern = context.lowered._pattern_roots[0]
        self.assertTrue(forest.machine.matches(working_structure(context, forest, node), pattern))
        self.assertFalse(forest.machine.matches(forest.structure[node.item], pattern))
        exported = derivation_identity(context, node)
        private = derivation_identity(context, node, working=True)
        self.assertNotEqual(exported, private)
        machine = context.emission_trees
        children = machine.elements(machine.nodes[exported][0][2])
        self.assertEqual(len(children), 1)
        self.assertEqual(machine.nodes[children[0]][0][0], "Seal")
        self.assertEqual(derivation_identity(context, node), exported)


class UndemandedStructure(unittest.TestCase):
    def test_ranked_machine_interns_equal_parts_without_minimization(self):
        # Engine §4.1: equal parts share a state, while a seal retains its width.
        from gencmu._patterns import PatternMachine
        machine = PatternMachine([])
        node = machine.node("r", machine.empty)
        self.assertNotEqual(machine.seal, machine.empty)
        self.assertEqual(machine.node("r", machine.empty), node)
        self.assertEqual(machine.states[machine.concat(node, machine.seal)][0], 1)
