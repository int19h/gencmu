package gencmu

// Token is a token a stage reads or emits (engine §1). Span is the range of
// the previous stage's tokens it covers, Source the range of the original
// text, in code points. Phonemes is empty for a token that has none.
// InsertedBy names the rule whose emission clause inserted a token with an
// empty span.
type Token struct {
	Text       string
	Phonemes   string
	Tags       map[string]bool // tag → strong
	Span       [2]int
	Source     [2]int
	InsertedBy string
}

// Node kinds.
const (
	KindRule   = "rule"
	KindToken  = "token"
	KindElided = "elided"
)

// Node is a node of a parse tree (engine §12). A rule node has Rule, Tags
// and Children; a token node has Terminal and Token, the index of the
// stage-input token it read; an elided node has Terminal, and an empty span
// where the terminator would have been.
type Node struct {
	Kind     string
	Rule     string
	Terminal string
	Token    int
	Span     [2]int
	Source   [2]int
	Tags     map[string]bool
	Children []*Node
}

// Action is one step of a derivation read bottom-up: a read of a token as a
// terminal, or a close of a production over a span (engine §6).
type Action struct {
	Read  *ReadAction
	Close *CloseAction
}

type ReadAction struct {
	Token    int
	Terminal string
}

// CloseAction closes a production, numbered as in engine §3, of Rule.
type CloseAction struct {
	Rule       string
	Production int
	Span       [2]int
}

// Verdicts.
const (
	VerdictUnique   = "unique"
	VerdictResolved = "resolved"
	VerdictTie      = "tie"
)

// Stage is what one stage of a pipeline did. Verdict is empty for a stage
// that rejected its input; Witness and Tied are set for a tie; Output is
// nil unless the stage accepted.
type Stage struct {
	Name    string
	Input   []Token
	Output  []Token
	Verdict string
	Witness []Action
	Tied    *Node
}

// Error kinds.
const (
	ErrorRejected  = "rejected"
	ErrorAmbiguous = "ambiguous"
	ErrorGrammar   = "grammar"
)

// Expected is a terminal a rejected input could have continued with, and
// the rules whose items could have read it.
type Expected struct {
	Terminal string
	Rules    []string
}

// ParseError says why a text did not parse (docs/output.md, "Error").
// Token and Source are nil when unknown; Line and Column are 0 when unknown.
// For a rejection they give the position in the text; for a grammar error,
// the position in Document.
type ParseError struct {
	Kind     string
	Stage    string
	Token    *int
	Source   *[2]int
	Document string
	Line     int
	Column   int
	Expected []Expected
	Readings []*Node
	Message  string
}

// ParseResult is the result of a parse: OK when every stage run accepted
// without an error, the stages run, the last stage's chosen tree, and the
// error that ended the run.
type ParseResult struct {
	OK     bool
	Stages []Stage
	Tree   *Node
	Error  *ParseError
}
