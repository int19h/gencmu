package gencmu

import (
	"fmt"
	"path"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Error is a dialect that cannot be loaded: a document is missing, does not
// parse as the notation, or does not stitch into a valid grammar. Document,
// Line and Column say where, when known; Line and Column count from 1, in
// code points.
type Error struct {
	Kind     string // always "grammar" for a load error
	Document string
	Line     int
	Column   int
	Stage    string
	Message  string
}

func (e *Error) Error() string {
	var b strings.Builder
	if e.Document != "" {
		b.WriteString(e.Document)
		if e.Line > 0 {
			fmt.Fprintf(&b, ":%d:%d", e.Line, e.Column)
		}
		b.WriteString(": ")
	}
	if e.Stage != "" {
		fmt.Fprintf(&b, "stage %s: ", e.Stage)
	}
	b.WriteString(e.Message)
	return b.String()
}

func grammarError(document string, at [2]int, format string, args ...any) *Error {
	return &Error{Kind: "grammar", Document: document, Line: at[0], Column: at[1], Message: fmt.Sprintf(format, args...)}
}

// splitLines splits at \n, \r\n and \r, the line ends of every position in
// gencmu.
func splitLines(s string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '\n':
			lines = append(lines, s[start:i])
			start = i + 1
		case '\r':
			lines = append(lines, s[start:i])
			if i+1 < len(s) && s[i+1] == '\n' {
				i++
			}
			start = i + 1
		}
	}
	return append(lines, s[start:])
}

// grammarText is the text of a document's ebnf blocks (engine §8), with the
// document position of each of its code points and of its end.
type grammarText struct {
	text []rune
	pos  [][2]int // len(text)+1 entries: line and column, from 1
}

func (g *grammarText) at(offset int) [2]int {
	if offset < 0 {
		offset = 0
	}
	if offset >= len(g.pos) {
		offset = len(g.pos) - 1
	}
	return g.pos[offset]
}

var fenceOpen = regexp.MustCompile("^ {0,3}(`{3,}|~{3,})(.*)$")

// extractEBNF finds the fenced code blocks whose info string is ebnf and joins
// their contents with a newline between blocks. A block's lines are joined
// with a newline too, so every line ending reads as \n.
func extractEBNF(doc string) *grammarText {
	g := &grammarText{}
	lines := splitLines(doc)
	var fence string // the open fence, or "" outside a block
	isEBNF, blocks, linesInBlock := false, 0, 0
	lastEnd := [2]int{1, 1}
	newline := func() {
		g.text = append(g.text, '\n')
		g.pos = append(g.pos, lastEnd)
	}
	for n, line := range lines {
		if fence == "" {
			m := fenceOpen.FindStringSubmatch(line)
			if m == nil {
				continue
			}
			info := strings.TrimSpace(m[2])
			if m[1][0] == '`' && strings.Contains(info, "`") {
				continue
			}
			fence = m[1]
			isEBNF = info == "ebnf"
			if isEBNF {
				if blocks > 0 {
					newline()
				}
				blocks++
				linesInBlock = 0
			}
			continue
		}
		if isClosingFence(line, fence) {
			fence = ""
			continue
		}
		if !isEBNF {
			continue
		}
		if linesInBlock > 0 {
			newline()
		}
		linesInBlock++
		col := 1
		for _, c := range line {
			g.text = append(g.text, c)
			g.pos = append(g.pos, [2]int{n + 1, col})
			col++
		}
		lastEnd = [2]int{n + 1, col}
	}
	g.pos = append(g.pos, lastEnd)
	return g
}

// isClosingFence: a fence of the same character at least as long, indented
// up to three spaces, followed by nothing but spaces.
func isClosingFence(line, fence string) bool {
	t := strings.TrimLeft(line, " ")
	if len(line)-len(t) > 3 {
		return false
	}
	n := 0
	for n < len(t) && t[n] == fence[0] {
		n++
	}
	return n >= len(fence) && strings.TrimRight(t[n:], " \t") == ""
}

// A pipeline document (design, "Pipelines"): stages, the documents stitched
// into each, and the features the dialect enables.
type pipelineStage struct {
	name      string
	documents []string // resolved paths
	at        [2]int
}

type pipeline struct {
	stages   []pipelineStage
	features []string
}

var (
	instruction = regexp.MustCompile(`<\?([A-Za-z][A-Za-z0-9-]*)((?:\s[^?]*)?)\?>`)
	heading     = regexp.MustCompile(`^ {0,3}#{1,6}(\s|$)`)
	linkStart   = regexp.MustCompile(`\[[^\]]*\]\(`)
	featureName = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9-]*$`)
)

func runeColumn(line string, byteOffset int) int {
	return utf8.RuneCountInString(line[:byteOffset]) + 1
}

// readPipeline reads a pipeline document's processing instructions, one per
// line at most, each at the end of its line.
func readPipeline(text, docPath string) (*pipeline, *Error) {
	p := &pipeline{}
	seen := map[string]bool{}
	features := map[string]bool{}
	for n, line := range splitLines(text) {
		found := instruction.FindAllStringSubmatchIndex(line, -1)
		if len(found) == 0 {
			continue
		}
		at := [2]int{n + 1, runeColumn(line, found[0][0])}
		if len(found) > 1 {
			second := [2]int{n + 1, runeColumn(line, found[1][0])}
			return nil, grammarError(docPath, second, "a line of a pipeline holds at most one processing instruction")
		}
		m := found[0]
		if strings.TrimSpace(line[m[1]:]) != "" {
			continue // not at the end of the line: prose
		}
		name, args := line[m[2]:m[3]], strings.TrimSpace(line[m[4]:m[5]])
		switch name {
		case "stage":
			if !heading.MatchString(line) {
				return nil, grammarError(docPath, at, "<?stage?> must end a heading")
			}
			if args == "" || strings.ContainsAny(args, " \t") {
				return nil, grammarError(docPath, at, "<?stage?> needs one stage name")
			}
			if seen[args] {
				return nil, grammarError(docPath, at, "two stages are named %s", args)
			}
			seen[args] = true
			p.stages = append(p.stages, pipelineStage{name: args, at: at})
		case "grammar":
			if args != "" {
				return nil, grammarError(docPath, at, "<?grammar?> takes no arguments")
			}
			if len(p.stages) == 0 {
				return nil, grammarError(docPath, at, "a <?grammar?> line comes before any stage")
			}
			l := linkStart.FindStringIndex(line[:m[0]])
			if l == nil {
				return nil, grammarError(docPath, at, "a <?grammar?> line needs a link [text](path)")
			}
			rest := line[l[1]:m[0]]
			end := strings.IndexByte(rest, ')')
			target := ""
			if end >= 0 {
				target = rest[:end]
			}
			if end < 0 || target == "" || strings.ContainsAny(target, " \t()\\") {
				return nil, grammarError(docPath, [2]int{n + 1, runeColumn(line, l[0])}, "a <?grammar?> link must be [text](path) with no spaces, parentheses or backslashes in the path")
			}
			s := &p.stages[len(p.stages)-1]
			s.documents = append(s.documents, resolvePath(docPath, target))
		case "features":
			names := strings.Fields(args)
			if len(names) == 0 {
				return nil, grammarError(docPath, at, "<?features?> names no feature")
			}
			for _, f := range names {
				if !featureName.MatchString(f) {
					return nil, grammarError(docPath, at, "%q is not a feature name", f)
				}
				if !features[f] {
					features[f] = true
					p.features = append(p.features, f)
				}
			}
		default:
			// Another tool's instruction: not the engine's to read.
		}
	}
	if len(p.stages) == 0 {
		return nil, grammarError(docPath, [2]int{}, "the pipeline has no <?stage?>")
	}
	return p, nil
}

// resolvePath resolves a link target against the document holding it, with
// . and .. normalized.
func resolvePath(from, target string) string {
	return path.Clean(path.Join(path.Dir(from), target))
}
