package gencmu

// Token is a token a stage reads or emits (engine §1). Tags are its tags,
// each in its canonical spelling, in code point order and each once; a tag
// has no strength. Span is the range of the previous stage's tokens it
// covers, Source the range of the original text, in code points. Phonemes is empty for a token that has none.
// Label is what the token shows to people (engine §5). A character token and
// a token that a caller supplies have their text as their label.
// InsertedBy names the rule whose emission clause inserted a token with an
// empty span. Before and After are the token's attachments (engine §11):
// tokens that belong to it and that no later stage reads, nil when there
// are none. An attached token has no span, since its span would count the
// input of the stage that attached it: its Span is zero, and the output
// leaves it out. Its Source is in the original text, as any token's.
// A caller of ParseTokens cannot supply attachments.
type Token struct {
	Text       string
	Phonemes   string
	Label      string
	Tags       []string
	Span       [2]int
	Source     [2]int
	InsertedBy string
	Before     []Token
	After      []Token
}

// Node kinds.
const (
	KindRule   = "rule"
	KindToken  = "token"
	KindElided = "elided"
)

// Node is a node of a parse tree (engine §12). A rule node has Rule, Tags,
// in code point order, and Children; a token node has Terminal and Token, the index of the
// stage-input token it read; an elided node has Terminal, and an empty span
// where the terminator would have been.
type Node struct {
	Kind     string
	Rule     string
	Terminal string
	Token    int
	Span     [2]int
	Source   [2]int
	Tags     []string
	Children []*Node
	// sound is the string of an elided node's terminator's = test, if it
	// has one, which elision-only gives the restored token as its phonemes
	// (engine §7, §12); the output does not show it.
	sound string
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
	// ErrorUsage is a caller's mistake, returned by Parse, never a result.
	ErrorUsage = "usage"
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

// Warning reports a rule node of a stage's chosen tree that an alternative
// with a warning guard, f!, built while the feature f was on (engine §12).
// Span counts the stage's input tokens, Source the original text's code
// points, as a node's do.
type Warning struct {
	Stage   string
	Feature string
	Rule    string
	Span    [2]int
	Source  [2]int
}

// ParseResult is the result of a parse: OK when every stage run accepted
// without an error, the stages run, the last stage's chosen tree, the error
// that ended the run, and the warnings of every stage run, in stage order,
// an empty list when there are none.
type ParseResult struct {
	OK       bool
	Stages   []Stage
	Tree     *Node
	Error    *ParseError
	Warnings []Warning
}

// Feature kinds: a gate keeps its alternatives only while it is on, or off
// where negated; a warning keeps them either way and reports their use.
const (
	FeatureGate    = "gate"
	FeatureWarning = "warning"
)

// Feature is one of a dialect's features (engine §13): a name its guards
// use or its pipeline's %features declares, its kind, and whether
// %features turns it on by default.
type Feature struct {
	Name    string
	Kind    string
	Default bool
}
