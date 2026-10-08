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
	// (engine §7, §12); the output does not show it. tested says that the
	// terminator has an = test, so that sound holds, even where it is "".
	sound  string
	tested bool
}

// Action is one step of a derivation read bottom-up: a read of a token as a
// terminal, or a close of a production over a span (engine §6). In the
// witness of an error of elision-only, it can also be a read of a
// terminator that the check wrote back (engine §7.10).
type Action struct {
	Read   *ReadAction
	Close  *CloseAction
	Elided *ElidedAction
}

// ElidedAction reads a terminator that the check of elision-only wrote back
// at At, a position in the stage's input, as Terminal (engine §7.10).
type ElidedAction struct {
	At       int
	Terminal string
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
// that rejected its input. Witness is set for a tie, whose two readings are
// in the result's Error (engine §6). Output is nil unless the verdict is
// unique or resolved, and nil too when the stage's emission failed.
type Stage struct {
	Name    string
	Input   []Token
	Output  []Token
	Verdict string
	Witness []Action
}

// Error kinds.
const (
	ErrorRejected  = "rejected"
	ErrorAmbiguous = "ambiguous"
	ErrorGrammar   = "grammar"
	// ErrorUsage is a caller's mistake, returned by Parse, never a result.
	ErrorUsage = "usage"
)

// Reasons of an ambiguous error.
const (
	// ReasonTie is a stage whose ranking has two or more best derivations
	// (engine §6).
	ReasonTie = "tie"
	// ReasonElisionOnly is a text that stays ambiguous with its elided
	// terminators written back (engine §7).
	ReasonElisionOnly = "elision-only"
)

// CodeElisionWitnessLost is the code of a grammar error that marks a defect
// of the library: the check of elision-only lost the witness of the chosen
// derivation (engine §7.9).
const CodeElisionWitnessLost = "elision-witness-lost"

// Restoration is an elided terminator that the check of elision-only wrote
// back (engine §7.2, §7.9): its terminal, its position in the stage's input,
// the empty source of its elided node, and, for a terminator with an = test,
// that test's string, its saved sound. Sound is "" both for a terminator
// with no test and for one whose test is T="", so Tested tells them apart.
type Restoration struct {
	Terminal string
	At       int
	Source   [2]int
	Sound    string
	// Tested says that the terminator has an = test, so Sound is its
	// saved sound and the output shows it, even where it is empty.
	Tested bool
}

// Expected is a terminal a rejected input could have continued with, and
// the rules whose items could have read it.
type Expected struct {
	Terminal string
	Rules    []string
}

// ParseError says why a text did not parse (docs/output.md, "Error").
// Reason is set only for an ambiguous error: ReasonTie or ReasonElisionOnly.
// Token and Source are nil when unknown; Line and Column are 0 when unknown.
// For a rejection they give the position in the text; for a grammar error,
// the position in Document. An ambiguous error has Readings over the stage input.
// An ordinary tie has two readings and can include opposed contests in Conflict.
// A comparison cycle has at least three readings and each directed edge in Cycle.
// An ordinary elision-only error also has Witness, its first differing actions.
// A cycle under elision-only has ChosenReading equal to zero and no Witness.
// Code is set only for the grammar error
// CodeElisionWitnessLost, which also has Chosen, the stage's chosen tree,
// and Completion, the terminators that the check wrote back (engine §7.9).
type ParseError struct {
	Cycle         []CycleEdge
	Conflict      *PreferenceConflict
	ChosenReading *int
	Kind          string
	Stage         string
	Code          string
	Reason        string
	Token         *int
	Source        *[2]int
	Document      string
	Line          int
	Column        int
	Expected      []Expected
	Readings      []*Node
	Witness       []Action
	Message       string
	Chosen        *Node
	Completion    []Restoration
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

// PreferenceContest records one same-span contest after common occurrences cancel.
type PreferenceContest struct {
	Span           [2]int    `json:"span"`
	Higher         string    `json:"higher"`
	Lower          string    `json:"lower"`
	Path           []string  `json:"path"`
	ResidualCounts [2]string `json:"residualCounts"`
}

// PreferenceConflict records contests that favor opposite complete readings.
type PreferenceConflict struct {
	Forward []PreferenceContest `json:"forward"`
	Reverse []PreferenceContest `json:"reverse"`
}

// CycleEdge records one comparison edge and its reason.
type CycleEdge struct {
	From, To  int
	Basis     string
	Contests  []PreferenceContest
	Directive string
	Boundary  *int
	Counts    []string
	Witness   []Action
}
