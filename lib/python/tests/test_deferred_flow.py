"""Diagnostic owners and preorder collections (engine §11.5 and §12.1)."""

from types import SimpleNamespace
import unittest

import gencmu
from gencmu._diagnostic_flow import DiagnosticFlow, tied_diagnostics
from gencmu._measures import record_diagnostic, DiagnosticIdentity
from gencmu._stage import DNode, DRead


def node(start, end, children=(), erased=False):
    return DNode(0, SimpleNamespace(erased=erased), start, end, list(children), 0)


def token(start, end):
    return gencmu.Token("a", {"A"}, (start, end), (start, end))


def diagnostic(code, stage=0, ordinal=0):
    return record_diagnostic(gencmu.ParseWarning(str(stage), code, code, (0, 1), (0, 1), code),
                             (1, 0, 1), DiagnosticIdentity(stage, ordinal))


def codes(diagnostics):
    return [item.code for item in diagnostics]


class Ownership(unittest.TestCase):
    def test_carriers_sort_by_stage_while_reports_follow_preorder(self):
        # Engine §12.1: own diagnostics precede the carried lists of child leaves.
        original = token(0, 1)
        original.errors = [diagnostic("carried")]
        root = node(0, 1, [DRead(0, "A")])
        flow = DiagnosticFlow(root, [original])
        flow.add(root, diagnostic("own", 1), "errors")
        output = token(0, 1)
        flow.emitted(output, root, root, flow.main)
        self.assertEqual(flow.assign().errors, [])
        self.assertEqual(codes(output.errors), ["carried", "own"])
        self.assertEqual(codes(flow.collected().errors), ["own", "carried"])
        self.assertEqual(codes(tied_diagnostics(flow.events(), flow.events()).errors), ["own", "carried"])

    def test_attachment_captures_sort_across_all_their_output_tokens(self):
        # Engine §11.5: one attachment group spans all tokens of its capture.
        inputs = [token(index, index + 1) for index in range(3)]
        inputs[0].warnings = [diagnostic("later", 2)]
        inputs[1].warnings = [diagnostic("earlier", 1)]
        annotation = node(0, 2, [DRead(0, "A"), DRead(1, "A")])
        word = node(2, 3, [DRead(2, "A")])
        root = node(0, 3, [annotation, word])
        flow = DiagnosticFlow(root, inputs)
        attachment = flow.attachment(annotation)
        first, second, carrier = token(0, 1), token(1, 2), token(2, 3)
        flow.emitted(first, annotation.children[0], annotation, attachment)
        flow.emitted(second, annotation.children[1], annotation, attachment)
        flow.emitted(carrier, word, word, flow.main)
        flow.attachments(carrier, [attachment], [], [], [])
        flow.assign()
        self.assertEqual(codes(first.warnings), ["later"])
        self.assertEqual(codes(second.warnings), ["earlier"])
        self.assertEqual(codes(carrier.warnings), ["earlier", "later"])
        self.assertEqual(codes(flow.collected().warnings), ["later", "earlier"])

    def test_erased_messages_evaluate_but_never_enter_reports_or_failure_lists(self):
        # Engine §12.1: erasure removes both own and carried diagnostics.
        original = token(0, 1)
        original.errors = [diagnostic("carried")]
        gone = node(0, 1, [DRead(0, "A")], erased=True)
        root = node(0, 1, [gone])
        flow = DiagnosticFlow(root, [original])
        flow.add(gone, diagnostic("evaluated", 1), "warnings")
        self.assertEqual(len(flow.evaluated), 1)
        self.assertEqual(flow.messages().warnings, [])
        self.assertEqual(flow.collected().errors, [])
        self.assertEqual(flow.assign().errors, [])

    def test_zero_width_diagnostics_follow_the_nearest_emission(self):
        # Engine §11.5: an inserted carrier can own an empty occurrence.
        original = token(0, 1)
        empty = node(0, 0)
        root = node(0, 1, [empty, DRead(0, "A")])
        flow = DiagnosticFlow(root, [original])
        flow.add(empty, diagnostic("empty"), "warnings")
        inserted = token(1, 1)
        flow.emitted(inserted, None, root, flow.main)
        flow.assign()
        self.assertEqual(codes(inserted.warnings), ["empty"])

    def test_empty_output_keeps_unowned_diagnostics_at_the_stage(self):
        # Engine §11.5: the absence of a carrier preserves pending diagnostics.
        root = node(0, 1, [DRead(0, "A")])
        flow = DiagnosticFlow(root, [token(0, 1)])
        flow.add(root, diagnostic("pending"), "errors")
        self.assertEqual(codes(flow.assign().errors), ["pending"])

    def test_ties_keep_maximum_own_multiplicity_and_one_carried_identity(self):
        # Engine §12.1: equal own objects and carried identities use separate rules.
        original = token(0, 1)
        original.warnings = [diagnostic("carried")]
        empty = node(0, 0)
        first = node(0, 1, [empty, DRead(0, "A")])
        flow = DiagnosticFlow(first, [original])
        flow.add(first, diagnostic("own", 1, 0), "warnings")
        flow.add(empty, diagnostic("own", 1, 1), "warnings")
        second = node(0, 1, [DRead(0, "A")])
        other = DiagnosticFlow(second, [original])
        other.add(second, diagnostic("own", 1, 0), "warnings")
        self.assertEqual(codes(tied_diagnostics(flow.events(), other.events()).warnings), ["own", "own", "carried"])
