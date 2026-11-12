package gencmu

import (
	"reflect"
	"testing"
)

func flowNode(a, b int, erased bool, kids ...*occurrence) *occurrence {
	return &occurrence{d: &dn{kind: dClose, start: int32(a), end: int32(b), prod: &production{nothing: erased}}, kids: kids}
}
func flowRead(index int) *occurrence { return &occurrence{d: readNode(int32(index), 0)} }
func flowDiagnostic(code string, stage, ordinal int) Warning {
	return recordDiagnostic(Warning{Stage: "main", Code: code, Rule: code, Span: [2]int{0, 1}, Source: [2]int{0, 1}, Message: code}, fixedMeasure(1, 0, 1), &diagnosticIdentity{stageOrder: stage, ordinal: ordinal})
}
func flowCodes(list []Warning) []string {
	result := make([]string, len(list))
	for i, diagnostic := range list {
		result[i] = diagnostic.Code
	}
	return result
}
func requireFlowCodes(t *testing.T, list []Warning, want ...string) {
	t.Helper()
	got := flowCodes(list)
	if !reflect.DeepEqual(got, append([]string{}, want...)) {
		t.Fatalf("codes %v, want %v", got, want)
	}
}
func standaloneFlow(root *occurrence, tokens []Token) *diagnosticFlow {
	return newDiagnosticFlow(root, &stageRun{toks: tokens, tagsets: make([]*tagset, len(tokens))}, &recognizer{})
}

func TestDeferredFlowSeparatesCarrierOrderFromReportingPreorder(t *testing.T) {
	// Engine §11.5 and §12.1: carriers sort identities while reports keep preorder.
	tokens := deferredTokens("A")
	tokens[0].Errors = []Warning{flowDiagnostic("carried", 0, 0)}
	root := flowNode(0, 1, false, flowRead(0))
	flow := standaloneFlow(root, tokens)
	flow.add(root, flowDiagnostic("own", 1, 0), true)
	row := flow.emitted(tokens[0], root, root, flow.main)
	requireFlowCodes(t, flow.assign().errors)
	requireFlowCodes(t, row.token.Errors, "carried", "own")
	requireFlowCodes(t, flow.collected().errors, "own", "carried")
	requireFlowCodes(t, tiedDiagnostics(flow.events(), flow.events()).errors, "own", "carried")
}

func TestDeferredFlowSortsAcrossAnEntireAttachmentCapture(t *testing.T) {
	// Engine §11.5: all tokens of an attachment capture form one ordered group.
	tokens := deferredTokens("A", "A", "A")
	tokens[0].Warnings = []Warning{flowDiagnostic("later", 2, 0)}
	tokens[1].Warnings = []Warning{flowDiagnostic("earlier", 1, 0)}
	annotation := flowNode(0, 2, false, flowRead(0), flowRead(1))
	word := flowNode(2, 3, false, flowRead(2))
	flow := standaloneFlow(flowNode(0, 3, false, annotation, word), tokens)
	attachment := flow.attachment(annotation)
	first := flow.emitted(tokens[0], annotation.kids[0], annotation, attachment)
	second := flow.emitted(tokens[1], annotation.kids[1], annotation, attachment)
	carrier := flow.emitted(tokens[2], word, word, flow.main)
	carrier.groups = []diagnosticGroup{{scope: attachment}}
	attachment.carrier = carrier
	flow.assign()
	requireFlowCodes(t, first.token.Warnings, "later")
	requireFlowCodes(t, second.token.Warnings, "earlier")
	requireFlowCodes(t, carrier.token.Warnings, "earlier", "later")
	requireFlowCodes(t, flow.collected().warnings, "later", "earlier")
}

func TestDeferredFlowDropsErasedEvaluatedAndCarriedDiagnostics(t *testing.T) {
	// Engine §12.1: erased recipes evaluate but neither failure list keeps them.
	tokens := deferredTokens("A")
	tokens[0].Errors = []Warning{flowDiagnostic("carried", 0, 0)}
	gone := flowNode(0, 1, true, flowRead(0))
	flow := standaloneFlow(flowNode(0, 1, false, gone), tokens)
	flow.add(gone, flowDiagnostic("evaluated", 1, 0), false)
	if len(flow.evaluated) != 1 {
		t.Fatal("missing evaluation")
	}
	requireFlowCodes(t, flow.messages().warnings)
	requireFlowCodes(t, flow.collected().errors)
	requireFlowCodes(t, flow.assign().errors)
}

func TestDeferredFlowAssignsEmptyOccurrencesToTheirNearestEmission(t *testing.T) {
	// Engine §11.5: a source-free insertion can own an empty occurrence.
	tokens := deferredTokens("A")
	empty := flowNode(0, 0, false)
	root := flowNode(0, 1, false, empty, flowRead(0))
	flow := standaloneFlow(root, tokens)
	flow.add(empty, flowDiagnostic("empty", 0, 0), false)
	inserted := Token{Span: [2]int{1, 1}}
	row := flow.emitted(inserted, nil, root, flow.main)
	flow.assign()
	requireFlowCodes(t, row.token.Warnings, "empty")
}

func TestDeferredFlowKeepsUnownedDiagnosticsWhenEmissionIsEmpty(t *testing.T) {
	// Engine §11.5: no carrier leaves the diagnostic at its stage.
	tokens := deferredTokens("A")
	root := flowNode(0, 1, false, flowRead(0))
	flow := standaloneFlow(root, tokens)
	flow.add(root, flowDiagnostic("pending", 0, 0), true)
	requireFlowCodes(t, flow.assign().errors, "pending")
}

func TestDeferredFlowTiesKeepOwnMultiplicityAndCarriedIdentity(t *testing.T) {
	// Engine §12.1: tied readings use own multiplicity and carried identity.
	tokens := deferredTokens("A")
	tokens[0].Warnings = []Warning{flowDiagnostic("carried", 0, 0)}
	empty := flowNode(0, 0, false)
	first := flowNode(0, 1, false, empty, flowRead(0))
	flow := standaloneFlow(first, tokens)
	flow.add(first, flowDiagnostic("own", 1, 0), false)
	flow.add(empty, flowDiagnostic("own", 1, 1), false)
	second := flowNode(0, 1, false, flowRead(0))
	other := standaloneFlow(second, tokens)
	other.add(second, flowDiagnostic("own", 1, 0), false)
	requireFlowCodes(t, tiedDiagnostics(flow.events(), other.events()).warnings, "own", "own", "carried")
}
