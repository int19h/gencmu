package gencmu

// diagnosticMeasure is (blame, sourceless occurrences, diagnostic count).
// The first two counts ascend, and the last count descends (engine §6).
type diagnosticMeasure [3]count

func (a diagnosticMeasure) add(b diagnosticMeasure) diagnosticMeasure {
	return diagnosticMeasure{a[0].add(b[0]), a[1].add(b[1]), a[2].add(b[2])}
}

func (a diagnosticMeasure) cmp(b diagnosticMeasure) int {
	for i := range a {
		if order := a[i].cmp(b[i]); order != 0 {
			if i == 2 {
				return -order
			}
			return order
		}
	}
	return 0
}

// Identity and fixed charge remain private when a public diagnostic moves.
type diagnosticIdentity struct{ stageOrder, ordinal int }
type diagnosticRecord struct {
	measure  diagnosticMeasure
	identity *diagnosticIdentity
}

func recordDiagnostic(diagnostic Warning, measure diagnosticMeasure, identity *diagnosticIdentity) Warning {
	if identity == nil {
		identity = &diagnosticIdentity{}
	}
	diagnostic.record = &diagnosticRecord{measure, identity}
	return diagnostic
}

type diagnosticMeasures struct {
	tokens   []Token
	sources  *sourceTable
	nonempty []int
	carried  []diagnosticMeasure
	original *diagnosticMeasures
	project  []int
}

func newDiagnosticMeasures(tokens []Token) *diagnosticMeasures {
	m := &diagnosticMeasures{tokens: tokens, sources: newSourceTable(tokens), nonempty: make([]int, len(tokens)+1), carried: make([]diagnosticMeasure, len(tokens))}
	for i := range tokens {
		m.nonempty[i+1] = m.nonempty[i]
		if tokens[i].Source[0] < tokens[i].Source[1] {
			m.nonempty[i+1]++
		}
		for _, diagnostic := range tokens[i].Errors {
			m.carried[i] = m.carried[i].add(diagnostic.record.measure)
		}
	}
	return m
}

func (m *diagnosticMeasures) own(start, end int) diagnosticMeasure {
	if m.original != nil {
		return m.original.own(m.project[start], m.project[end])
	}
	if m.nonempty[start] == m.nonempty[end] {
		return diagnosticMeasure{{}, countOne, countOne}
	}
	source := [2]int{m.tokens[start].Source[0], m.tokens[end-1].Source[1]}
	if m.sources != nil {
		source = m.sources.source(start, end)
	}
	return diagnosticMeasure{countOf(int64(source[1] - source[0])), {}, countOne}
}
