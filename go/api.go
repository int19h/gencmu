package gencmu

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

//go:embed grammars
var bundledFS embed.FS

var bundled struct {
	once     sync.Once
	sources  map[string]string
	uni      *unicodeTable
	reader   *notationReader
	compiled map[string]json.RawMessage
	err      error
}

func loadBundled() error {
	bundled.once.Do(func() {
		bundled.sources = map[string]string{}
		err := fs.WalkDir(bundledFS, "grammars", func(p string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return err
			}
			data, err := bundledFS.ReadFile(p)
			if err != nil {
				return err
			}
			bundled.sources[strings.TrimPrefix(p, "grammars/")] = string(data)
			return nil
		})
		if err != nil {
			bundled.err = err
			return
		}
		if bundled.uni, err = parseUnicodeTable(bundled.sources["unicode.txt"]); err != nil {
			bundled.err = err
			return
		}
		if bundled.reader, err = newNotationReader(bundled.sources["notation/bootstrap.json"], bundled.uni); err != nil {
			bundled.err = err
			return
		}
		bundled.compiled = readCompiled(bundled.sources["compiled.json"], bundled.reader.hash)
	})
	return bundled.err
}

// readCompiled indexes the precompiled DOMs by text hash, when they were
// made in this DOM format with this bootstrap (engine §8).
func readCompiled(text, bootstrapHash string) map[string]json.RawMessage {
	var c struct {
		Format    int
		Bootstrap string
		Documents map[string]struct {
			Hash string
			Dom  json.RawMessage
		}
	}
	out := map[string]json.RawMessage{}
	if text == "" || json.Unmarshal([]byte(text), &c) != nil || c.Format != domFormat || c.Bootstrap != bootstrapHash {
		return out
	}
	for _, d := range c.Documents {
		out[d.Hash] = d.Dom
	}
	return out
}

// loader reads a pipeline and its documents from one source of files.
type loader struct {
	read     func(p string) (string, bool)
	uni      *unicodeTable
	reader   *notationReader
	compiled map[string]json.RawMessage
	noCache  bool
}

func (l *loader) document(p string) (*domDoc, *Error) {
	text, ok := l.read(p)
	if !ok {
		return nil, &Error{Kind: ErrorGrammar, Document: p, Message: "the document is missing"}
	}
	if !l.noCache {
		if raw, ok := l.compiled[fnv1a64(text)]; ok {
			if dom, err := decodeDOM(raw); err == nil {
				return dom, nil
			}
		}
	}
	return l.reader.read(text, p)
}

// guard turns a panic, which a defect of this library or of data it trusted
// could still raise, into an error, so that no call of the API panics.
func guard(kind string, err *error) {
	if x := recover(); x != nil {
		*err = &Error{Kind: kind, Message: fmt.Sprintf("internal error: %v", x)}
	}
}

func (l *loader) dialect(pipelinePath string) (d *Dialect, err error) {
	defer guard(ErrorGrammar, &err)
	return l.load(pipelinePath)
}

func (l *loader) load(pipelinePath string) (*Dialect, error) {
	text, ok := l.read(pipelinePath)
	if !ok {
		return nil, &Error{Kind: ErrorGrammar, Document: pipelinePath, Message: "the pipeline document is missing"}
	}
	p, perr := readPipeline(text, pipelinePath)
	if perr != nil {
		return nil, perr
	}
	d := &Dialect{uni: l.uni, features: p.features, lowered: map[lowerKey]*lowered{}}
	doms := map[string]*domDoc{}
	for _, s := range p.stages {
		var docs []docDOM
		for _, dp := range s.documents {
			dom := doms[dp]
			if dom == nil {
				var err *Error
				if dom, err = l.document(dp); err != nil {
					err.Stage = s.name
					return nil, err
				}
				doms[dp] = dom
			}
			docs = append(docs, docDOM{path: dp, dom: dom})
		}
		g, err := stitch(s.name, docs)
		if err != nil {
			if err.Document == "" {
				err.Document = pipelinePath
				err.Line, err.Column = s.at[0], s.at[1]
			}
			return nil, err
		}
		d.stages = append(d.stages, g)
	}
	return d, nil
}

func bundledLoader() (*loader, error) {
	if err := loadBundled(); err != nil {
		return nil, err
	}
	return &loader{
		read:     func(p string) (string, bool) { s, ok := bundled.sources[p]; return s, ok },
		uni:      bundled.uni,
		reader:   bundled.reader,
		compiled: bundled.compiled,
	}, nil
}

// LoadDialect loads a dialect bundled with the package by name: the file
// name of a pipeline document under grammars/dialects/ without .md.
func LoadDialect(name string) (*Dialect, error) {
	l, err := bundledLoader()
	if err != nil {
		return nil, err
	}
	return l.dialect("dialects/" + name + ".md")
}

// LoadDialectFile loads a pipeline document from disk, whose grammar
// documents are found relative to it. unicode.txt and the notation's
// bootstrap come from the bundled grammars.
func LoadDialectFile(file string) (*Dialect, error) {
	l, err := bundledLoader()
	if err != nil {
		return nil, err
	}
	abs, err := filepath.Abs(file)
	if err != nil {
		return nil, &Error{Kind: ErrorGrammar, Document: file, Message: err.Error()}
	}
	l.read = func(p string) (string, bool) {
		data, err := os.ReadFile(filepath.FromSlash(p))
		return string(data), err == nil
	}
	return l.dialect(filepath.ToSlash(abs))
}

// LoadDialectSources loads a dialect from documents held in memory: a map
// from /-separated path to text, and the path of the pipeline document in
// it. The map may hold its own unicode.txt, notation/bootstrap.json and
// compiled.json; those it lacks come from the bundled grammars.
func LoadDialectSources(sources map[string]string, pipeline string) (*Dialect, error) {
	return loadSources(sources, pipeline, false)
}

func loadSources(sources map[string]string, pipeline string, noCache bool) (d *Dialect, err error) {
	defer guard(ErrorGrammar, &err)
	l, lerr := bundledLoader()
	if lerr != nil {
		return nil, lerr
	}
	norm := make(map[string]string, len(sources))
	for p, t := range sources {
		norm[path.Clean(p)] = t
	}
	l.read = func(p string) (string, bool) { s, ok := norm[p]; return s, ok }
	l.noCache = noCache
	if t, ok := norm["unicode.txt"]; ok {
		if l.uni, err = parseUnicodeTable(t); err != nil {
			return nil, &Error{Kind: ErrorGrammar, Document: "unicode.txt", Message: err.Error()}
		}
	}
	if t, ok := norm["notation/bootstrap.json"]; ok {
		if l.reader, err = newNotationReader(t, l.uni); err != nil {
			return nil, err
		}
		l.compiled = readCompiled(bundled.sources["compiled.json"], l.reader.hash)
	} else if l.uni != bundled.uni {
		r := *bundled.reader
		r.uni = l.uni
		l.reader = &r
	}
	if t, ok := norm["compiled.json"]; ok {
		l.compiled = readCompiled(t, l.reader.hash)
	}
	return l.dialect(path.Clean(pipeline))
}

// Dialect is a loaded pipeline. A *Dialect is safe for concurrent use by
// several goroutines: every parse keeps its own state, and the grammars
// lowered for a set of features are cached under a mutex.
type Dialect struct {
	stages   []*stageGrammar
	features []string
	uni      *unicodeTable
	mu       sync.Mutex
	lowered  map[lowerKey]*lowered
}

type lowerKey struct {
	stage     int
	features  string
	mandatory bool
}

// ParseOptions are the options of a parse (docs/api.md). The zero value
// parses with the dialect's own features, auto features on, every stage,
// and each grammar's own elision-only setting.
type ParseOptions struct {
	// Features to enable for every stage, besides those the pipeline enables.
	Features []string
	// NoAutoFeatures switches off adding sa-su only where the text needs it.
	NoAutoFeatures bool
	// Until names the last stage to run; empty runs every stage.
	Until string
	// ElisionOnly, when set, switches elision-only on or off for every stage.
	ElisionOnly *bool
}

// StageNames lists the dialect's stages in order.
func (d *Dialect) StageNames() []string {
	out := make([]string, len(d.stages))
	for i, s := range d.stages {
		out[i] = s.name
	}
	return out
}

func (d *Dialect) lower(stage int, features map[string]bool, mandatory bool) *lowered {
	names := make([]string, 0, len(features))
	for f, on := range features {
		if on {
			names = append(names, f)
		}
	}
	sort.Strings(names)
	key := lowerKey{stage, strings.Join(names, " "), mandatory}
	d.mu.Lock()
	defer d.mu.Unlock()
	if l, ok := d.lowered[key]; ok {
		return l
	}
	l := lower(d.stages[stage], features, mandatory)
	d.lowered[key] = l
	return l
}

// Parse parses a text. A text that does not parse is a result whose OK is
// false; the error is for a caller's mistake, such as an unknown stage, and
// is a *Error of kind "usage".
func (d *Dialect) Parse(text string, options ParseOptions) (*ParseResult, error) {
	return d.parse([]rune(text), nil, options)
}

// ParseTokens parses pre-built tokens in place of the first stage's
// character tokens, for tests and tools: text is the original text their
// Source ranges index, in code points.
// Each token's Source must lie within the text, in order: a token may not
// start before the one before it ends.
func (d *Dialect) ParseTokens(text string, tokens []Token, options ParseOptions) (*ParseResult, error) {
	if tokens == nil {
		tokens = []Token{}
	}
	runes := []rune(text)
	end := 0
	for i, t := range tokens {
		s := t.Source
		if s[0] < end || s[0] > s[1] || s[1] > len(runes) || t.Span[0] < 0 || t.Span[0] > t.Span[1] {
			return nil, &Error{Kind: ErrorUsage, Message: fmt.Sprintf("token %d: source %v and span %v do not lie in order within a text of %d code points", i, s, t.Span, len(runes))}
		}
		end = s[1]
	}
	return d.parse(runes, tokens, options)
}

func (d *Dialect) parse(text []rune, tokens []Token, options ParseOptions) (res *ParseResult, err error) {
	defer func() {
		if err != nil {
			res = nil
		}
	}()
	defer guard(ErrorGrammar, &err)
	last := len(d.stages) - 1
	if options.Until != "" {
		last = -1
		for i, s := range d.stages {
			if s.name == options.Until {
				last = i
			}
		}
		if last < 0 {
			return nil, &Error{Kind: ErrorUsage, Message: fmt.Sprintf("the dialect has no stage %q", options.Until)}
		}
	}
	features := map[string]bool{}
	for _, f := range d.features {
		features[f] = true
	}
	for _, f := range options.Features {
		features[f] = true
	}
	words := -1
	for i, s := range d.stages {
		if s.name == "words" {
			words = i
		}
	}
	ps := newParseState(d.uni, text)
	if tokens == nil {
		tokens = ps.characterTokens()
	}
	var outcomes []stageOutcome
	if !options.NoAutoFeatures && !features["sa-su"] && words >= 0 && words <= last {
		outcomes = d.runStages(ps, features, options, tokens, 0, words)
		probe := outcomes[len(outcomes)-1]
		// Rerun with sa-su unless the probe ends with words accepting, or if
		// words read sa or su (§13).
		if len(outcomes) != words+1 || probe.err != nil || hasSaSu(probe) {
			features["sa-su"] = true
			ps = newParseState(d.uni, text)
			outcomes = nil
		} else if words < last {
			outcomes = append(outcomes, d.runStages(ps, features, options, probe.stage.Output, words+1, last)...)
		}
	}
	if outcomes == nil {
		outcomes = d.runStages(ps, features, options, tokens, 0, last)
	}
	res = &ParseResult{OK: true}
	for _, o := range outcomes {
		res.Stages = append(res.Stages, o.stage)
		if o.err != nil {
			res.OK, res.Error = false, o.err
		}
	}
	if res.OK {
		res.Tree = outcomes[len(outcomes)-1].tree
	}
	return res, nil
}

func (d *Dialect) runStages(ps *parseState, features map[string]bool, options ParseOptions, tokens []Token, from, to int) []stageOutcome {
	var out []stageOutcome
	for i := from; i <= to; i++ {
		g := d.stages[i]
		elision := g.elisionOnly
		if options.ElisionOnly != nil {
			elision = *options.ElisionOnly
		}
		idx := i
		run := ps.newRun(g.name, g, tokens)
		o := run.run(d.lower(i, features, false), func() *lowered { return d.lower(idx, features, true) }, elision)
		out = append(out, o)
		if o.err != nil {
			break
		}
		tokens = o.stage.Output
	}
	return out
}

// hasSaSu says whether a words stage's tree has a word whose phonemes are
// sa or su (engine §13).
func hasSaSu(o stageOutcome) bool {
	if o.tree == nil {
		return false
	}
	stack := []*Node{o.tree}
	for len(stack) > 0 {
		n := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if n.Kind != KindRule {
			continue
		}
		if n.Rule == "word" {
			var b strings.Builder
			for i := n.Span[0]; i < n.Span[1]; i++ {
				b.WriteString(o.stage.Input[i].Phonemes)
			}
			if p := strings.Trim(b.String(), " "); p == "sa" || p == "su" {
				return true
			}
		}
		stack = append(stack, n.Children...)
	}
	return false
}
