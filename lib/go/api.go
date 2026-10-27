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
	"sync/atomic"
	"unicode/utf8"
)

//go:embed grammars data
var bundledFS embed.FS

var bundled struct {
	once             sync.Once
	sources          map[string]string
	uni              *unicodeTable
	reader           *notationReader
	err              error
	propertiesOnce   sync.Once
	propertiesUni    *unicodeTable
	propertiesReader *notationReader
	propertiesErr    error
}

func loadBundled() error {
	bundled.once.Do(func() {
		bundled.sources = map[string]string{}
		err := fs.WalkDir(bundledFS, ".", func(p string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return err
			}
			if strings.HasSuffix(p, "-names.txt") || (strings.HasPrefix(p, "data/preparsed/") && p != "data/preparsed/gencmu.json") {
				return nil
			}
			data, err := bundledFS.ReadFile(p)
			if err != nil {
				return err
			}
			bundled.sources[p] = string(data)
			return nil
		})
		if err != nil {
			bundled.err = err
			return
		}
		if bundled.uni, err = parseUnicodeTable(bundled.sources["data/unicode/unicode.txt"]); err != nil {
			bundled.err = err
			return
		}
		if bundled.reader, err = newNotationReader(bundled.sources["data/preparsed/gencmu.json"], bundled.uni); err != nil {
			bundled.err = err
			return
		}
	})
	return bundled.err
}

// domCacheKey includes every input that determines a document DOM (engine §8).
type domCacheKey struct {
	path, hash, bootstrap, unicode, properties string
	format                                     int
}

// readPreparsed admits an envelope only under the complete loader identity.
func readPreparsed(text, bootstrapHash, unicodeHash, propertiesHash string) map[domCacheKey]json.RawMessage {
	doms, _, _ := readPreparsedCache(text, bootstrapHash, unicodeHash, propertiesHash)
	return doms
}

func readPreparsedCache(text, bootstrapHash, unicodeHash, propertiesHash string, implicit ...bool) (map[domCacheKey]json.RawMessage, map[domCacheKey]json.RawMessage, map[string]string) {
	var c struct {
		Format       int             `json:"format"`
		Bootstrap    string          `json:"bootstrap"`
		Unicode      string          `json:"unicode"`
		Properties   json.RawMessage `json:"properties"`
		BundledNames json.RawMessage `json:"bundledNames"`
		Documents    map[string]struct {
			Hash  string          `json:"hash"`
			Dom   json.RawMessage `json:"dom"`
			Names json.RawMessage `json:"names"`
		} `json:"documents"`
	}
	out := map[domCacheKey]json.RawMessage{}
	names := map[domCacheKey]json.RawMessage{}
	if text == "" || unmarshalJSON([]byte(text), &c) != nil || c.Format != domFormat || (c.Bootstrap != bootstrapHash && !(len(implicit) > 0 && implicit[0])) || c.Unicode != unicodeHash {
		return out, names, nil
	}
	// An absent fingerprint differs from explicit null for a core-only table.
	var properties *string
	if len(c.Properties) == 0 || unmarshalJSON(c.Properties, &properties) != nil {
		return out, names, nil
	}
	if properties == nil {
		if propertiesHash != "" {
			return out, names, nil
		}
	} else if propertiesHash == "" || *properties != propertiesHash {
		return out, names, nil
	}
	for path, d := range c.Documents {
		out[domCacheKey{path, d.Hash, bootstrapHash, unicodeHash, propertiesHash, domFormat}] = d.Dom
		if len(d.Names) > 0 {
			names[domCacheKey{path, d.Hash, bootstrapHash, unicodeHash, propertiesHash, domFormat}] = d.Names
		}
	}
	return out, names, readNamesRegistry(c.BundledNames)
}

func preparsedPath(document string) string {
	if !strings.HasPrefix(document, "grammars/") {
		return ""
	}
	family, child, ok := strings.Cut(strings.TrimPrefix(document, "grammars/"), "/")
	if !ok || child == "" {
		return ""
	}
	if family == "" {
		return ""
	}
	for i, c := range family {
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || i > 0 && c == '-') {
			return ""
		}
	}
	return "data/preparsed/" + family + ".json"
}

type familyPreparsed struct {
	doms, names map[domCacheKey]json.RawMessage
	registry    map[string]string
}

func (l *loader) activatePreparsed(document string) {
	if l.preparsedRead == nil {
		return
	}
	file := preparsedPath(document)
	if file == "" || l.noCache {
		l.preparsed, l.preparsedNames, l.bundledNames = nil, nil, nil
		return
	}
	if l.families == nil {
		l.families = map[string]familyPreparsed{}
	}
	family, ok := l.families[file]
	if !ok {
		text, _ := l.preparsedRead(file)
		doms, names, registry := readPreparsedCache(text, l.bootstrapHash, l.uni.hash, l.uni.propertiesHash, file == "data/preparsed/gencmu.json")
		for key := range doms {
			if preparsedPath(key.path) != file {
				delete(doms, key)
				delete(names, key)
			}
		}
		family = familyPreparsed{doms, names, registry}
		l.families[file] = family
	}
	l.preparsed, l.preparsedNames, l.bundledNames = family.doms, family.names, family.registry
}

// loader reads a pipeline and its documents from one source of files.
type loader struct {
	preparsedRead      func(string) (string, bool)
	families           map[string]familyPreparsed
	read               func(p string) (string, bool)
	uni                *unicodeTable
	reader             *notationReader
	bootstrapHash      string
	preparsed          map[domCacheKey]json.RawMessage
	preparsedNames     map[domCacheKey]json.RawMessage
	bundledNames       map[string]string
	namesOverride      func(string) bool
	noCache            bool
	diagnosticDocument string
	recipeDocument     string
	boundaryDocument   string
	// fromDisk is set when read decodes files, not strings the caller
	// supplies: bytes that are not valid UTF-8 are then a grammar error of
	// the document, not a usage error (engine §1).
	fromDisk bool
}

func (l *loader) document(p string, selected ...[]string) (*domDoc, *Error) {
	l.activatePreparsed(p)
	var inherited []string
	if len(selected) > 0 {
		inherited = selected[0]
	}
	text, ok := l.read(p)
	if !ok {
		return nil, &Error{Kind: ErrorGrammar, Document: p, Message: "the document is missing"}
	}
	// A document is a sequence of scalar values, as a text is. A file on
	// disk is strict UTF-8, checked before its hash finds a preparsed DOM
	// (engine §1). A byte order mark stays U+FEFF.
	if problem := utf8Problem(text); problem != "" {
		if l.fromDisk {
			return nil, &Error{Kind: ErrorGrammar, Document: p, Message: "the document is not valid UTF-8: " + problem}
		}
		return nil, &Error{Kind: ErrorUsage, Document: p, Message: "the document is not a sequence of Unicode scalar values: " + problem}
	}
	names := newNamesScope(l.namesText, l.uni, inherited)
	if !l.noCache {
		key := domCacheKey{p, fnv1a64(text), l.bootstrapHash, l.uni.hash, l.uni.propertiesHash, domFormat}
		if raw, ok := l.preparsed[key]; ok {
			if dom, err := decodeDOM(raw, l.uni); err == nil {
				candidate := newNamesScope(l.namesText, l.uni, selectedNames(p, dom, inherited))
				match, err := candidate.matches(l.preparsedNames[key], l.bundledNames, l.namesOverride)
				if err != nil {
					return nil, err
				}
				if !match {
					return l.readSource(p, text, names)
				}
				dom.namesDependencies = candidate.dependencies
				if p == l.diagnosticDocument {
					l.reader.restoreLocations(text, dom)
				}
				if p == l.boundaryDocument {
					if source, e := l.reader.readMode(text, p, true, names); e == nil {
						restoreBoundaryLocations(dom, source)
					}
				}
				if p == l.recipeDocument {
					l.reader.restoreRecipeLocations(text, p, dom, names)
				}
				return dom, nil
			}
		}
	}
	return l.readSource(p, text, names)
}

func (l *loader) readSource(p, text string, names *namesScope) (*domDoc, *Error) {
	dom, err := l.reader.readMode(text, p, true, names)
	if err == nil && p == l.diagnosticDocument {
		l.reader.restoreLocations(text, dom)
	}
	return dom, err
}

func bundledNamesText(p string) (string, bool) {
	if p == "data/unicode/unicode-names-reference.txt" {
		p = "data/unicode/unicode-names.txt"
	}
	data, err := bundledFS.ReadFile(p)
	return string(data), err == nil
}
func (l *loader) namesText(p string) (string, bool) {
	if l.fromDisk && p == "data/unicode/unicode-names-reference.txt" {
		return bundledNamesText(p)
	}
	if text, ok := l.read(p); ok {
		return text, true
	}
	return bundledNamesText(p)
}

// utf8Problem says why a string is not valid UTF-8, which engine §1 makes
// a usage error, or is "" when it is valid. A string that encodes a
// surrogate is not valid either.
func utf8Problem(s string) string {
	if utf8.ValidString(s) {
		return ""
	}
	for i := 0; i < len(s); {
		r, size := utf8.DecodeRuneInString(s[i:])
		if r == utf8.RuneError && size <= 1 {
			return fmt.Sprintf("invalid UTF-8 at byte %d", i)
		}
		i += size
	}
	return "invalid UTF-8"
}

// guard turns a panic, which a defect of this library or of data it trusted
// could still raise, into an error, so that no call of the API panics.
func guard(kind string, err *error) {
	if x := recover(); x != nil {
		*err = &Error{Kind: kind, Message: fmt.Sprintf("internal error: %v", x)}
	}
}

func (l *loader) pipeline(pipelinePath string) (d *Pipeline, err error) {
	defer guard(ErrorGrammar, &err)
	return l.load(pipelinePath)
}

func (l *loader) load(pipelinePath string) (*Pipeline, error) {
	d, err := l.loadMode(pipelinePath)
	if failure, ok := err.(*Error); ok {
		// Retry only a failed load, retaining the cached DOM's semantics.
		diagnostic := *l
		switch {
		case strings.HasPrefix(failure.Code, "ranked-choice-") && failure.Group != nil && failure.Group.At == nil && failure.Group.Document != "":
			diagnostic.diagnosticDocument = failure.Group.Document
		case failure.boundaryLocation && failure.Line == 0 && failure.Document != "":
			diagnostic.boundaryDocument = failure.Document
		case failure.recipeCycle && failure.Line == 0 && failure.Document != "":
			diagnostic.recipeDocument = failure.Document
		default:
			return d, err
		}
		return diagnostic.loadMode(pipelinePath)
	}
	return d, err
}

func (l *loader) loadMode(pipelinePath string) (*Pipeline, error) {
	p, perr := l.splice(pipelinePath)
	if perr != nil {
		return nil, perr
	}
	d := &Pipeline{uni: l.uni, declared: p.features}
	for _, s := range p.stages {
		g, err := stitch(s.name, s.documents, l.uni)
		if err != nil {
			if err.Document == "" {
				err.Document = s.doc
				err.Line, err.Column = s.at[0], s.at[1]
			}
			return nil, err
		}
		d.stages = append(d.stages, g)
	}
	pipeline, err := newPipeline(d.stages, p.features, l.uni)
	if err != nil {
		return nil, err
	}
	return pipeline, nil
}

// pipeline splices the pipeline document at pipelinePath: its stages, each
// a list of runs of one document's items, and the features it turns on
// (engine §13). A document included more than once is read once.
func (l *loader) splice(pipelinePath string) (*splicedPipeline, *Error) {
	doms := map[string]*domDoc{}
	return splicePipelineWithNames(pipelinePath, func(p string, names []string) (*domDoc, *Error) {
		encoded, _ := json.Marshal(names)
		key := p + "\x00" + string(encoded)
		if dom, ok := doms[key]; ok {
			return dom, nil
		}
		if _, ok := l.read(p); !ok {
			return nil, nil
		}
		dom, err := l.document(p, names)
		if err != nil {
			return nil, err
		}
		doms[key] = dom
		return dom, nil
	})
}

// newPipeline applies the validation shared by normal and bootstrap pipelines.
func newPipeline(stages []*stageGrammar, declared []string, uni *unicodeTable) (*Pipeline, *Error) {
	features, err := pipelineFeatures(stages, declared)
	if err != nil {
		return nil, err
	}
	return &Pipeline{uni: uni, stages: stages, declared: declared, features: features}, nil
}

// pipelineFeatures lists a pipeline's features (engine §13): every name that a
// guard of a stage's stitched rules or a gate of its classifiers' entries
// uses, whatever features are on, and
// every name the pipeline's %features declares, in code point order. A
// name only %features declares is a gate; a name that one guard uses as a
// gate and another as a warning is an error of the pipeline.
func pipelineFeatures(stages []*stageGrammar, declared []string) ([]Feature, *Error) {
	kinds := map[string]string{}
	firstIn := map[string]string{} // the document of a name's first guard
	for _, g := range stages {
		for _, r := range g.rules {
			for _, a := range r.alts {
				for _, gd := range a.alt.Guards {
					known, ok := kinds[gd.Feature]
					if !ok {
						kinds[gd.Feature], firstIn[gd.Feature] = gd.Kind, a.doc
						continue
					}
					if known != gd.Kind {
						e := grammarError(a.doc, a.at, "the feature %s is used as a %s here and as a %s in %s; a feature is a gate or a warning, not both", gd.Feature, gd.Kind, known, firstIn[gd.Feature])
						e.Stage = g.name
						return nil, e
					}
				}
			}
		}
		// The gates of every classifier's entries count too (§13).
		for _, it := range g.classifierSet.items {
			for _, e := range it.classifier.Entries {
				for _, gd := range e.Guards {
					known, ok := kinds[gd.Feature]
					if !ok {
						kinds[gd.Feature], firstIn[gd.Feature] = gd.Kind, it.doc
						continue
					}
					if known != gd.Kind {
						err := grammarError(it.doc, e.At, "the feature %s is used as a %s here and as a %s in %s; a feature is a gate or a warning, not both", gd.Feature, gd.Kind, known, firstIn[gd.Feature])
						err.Stage = g.name
						return nil, err
					}
				}
			}
		}
	}
	on := map[string]bool{}
	for _, f := range declared {
		on[f] = true
		if kinds[f] == "" {
			kinds[f] = FeatureGate
		}
	}
	tested := map[string]string{}
	for _, stage := range stages {
		for _, item := range stage.features {
			for _, name := range item.directive.Args {
				if earlier := tested[name]; earlier != "" {
					err := grammarError(item.doc, item.directive.At, "stage %s tests local feature %s", earlier, name)
					err.Stage = stage.name
					return nil, err
				}
				if kinds[name] == "" {
					kinds[name] = FeatureGate
				}
				if item.directive.Conditions == nil {
					on[name] = true
				}
			}
		}
		for _, rule := range stage.rules {
			for _, alt := range rule.alts {
				for _, guard := range alt.alt.Guards {
					if tested[guard.Feature] == "" {
						tested[guard.Feature] = stage.name
					}
				}
			}
		}
		for _, item := range stage.classifierSet.items {
			for _, entry := range item.classifier.Entries {
				for _, guard := range entry.Guards {
					if tested[guard.Feature] == "" {
						tested[guard.Feature] = stage.name
					}
				}
			}
		}
	}
	features := make([]Feature, 0, len(kinds))
	for name, kind := range kinds {
		features = append(features, Feature{Name: name, Kind: kind, Default: on[name]})
	}
	sort.Slice(features, func(i, j int) bool { return features[i].Name < features[j].Name })
	return features, nil
}

func bundledLoader() (*loader, error) {
	return loaderForBundled(true)
}

func loaderForBundled(withProperties bool) (*loader, error) {
	if err := loadBundled(); err != nil {
		return nil, err
	}
	uni, reader := bundled.uni, bundled.reader
	if withProperties {
		bundled.propertiesOnce.Do(func() {
			text, ok := bundled.sources["data/unicode/unicode-properties.txt"]
			if !ok {
				bundled.propertiesErr = &Error{Kind: ErrorGrammar, Document: "data/unicode/unicode-properties.txt", Message: "the bundled properties file is missing"}
				return
			}
			copy := *bundled.uni
			var err error
			if copy.properties, err = parseProperties(text, &copy); err != nil {
				bundled.propertiesErr = err
				return
			}
			copy.propertiesHash = fnv1a64(text)
			bundled.propertiesUni = &copy
			bundled.propertiesReader, bundled.propertiesErr = newNotationReader(bundled.sources["data/preparsed/gencmu.json"], &copy)

		})
		if bundled.propertiesErr != nil {
			return nil, bundled.propertiesErr
		}
		uni, reader = bundled.propertiesUni, bundled.propertiesReader
	}
	return &loader{
		preparsedRead: bundledNamesText,
		read: func(p string) (string, bool) {
			if text, ok := bundled.sources[p]; ok {
				return text, true
			}
			data, err := bundledFS.ReadFile(p)
			return string(data), err == nil
		},
		uni:           uni,
		reader:        reader,
		bootstrapHash: reader.hash,
		namesOverride: func(string) bool { return false },
	}, nil
}

// LoadPipeline loads a pipeline bundled with the package by name: the file
// directory path NAME of grammars/NAME/pipeline.md.
func LoadPipeline(name string) (*Pipeline, error) {
	names := BundledPipelines()
	at := sort.SearchStrings(names, name)
	if !validPipelineName(name) || at == len(names) || names[at] != name {
		return nil, &Error{Kind: ErrorUsage, Message: fmt.Sprintf("there is no bundled pipeline named %q", name)}
	}
	l, err := bundledLoader()
	if err != nil {
		return nil, err
	}
	return l.pipeline("grammars/" + name + "/pipeline.md")
}

func validPipelineName(name string) bool {
	segments := strings.Split(name, "/")
	if len(segments) < 2 {
		return false
	}
	for _, segment := range segments {
		if segment == "" {
			return false
		}
		for i, c := range segment {
			if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || i > 0 && c == '-') {
				return false
			}
		}
	}
	return true
}

// BundledPipelines lists valid bundled pipeline names in code-point order.
func BundledPipelines() []string {
	names := []string{}
	_ = fs.WalkDir(bundledFS, "grammars", func(p string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() && strings.HasSuffix(p, "/pipeline.md") {
			name := strings.TrimSuffix(strings.TrimPrefix(p, "grammars/"), "/pipeline.md")
			if validPipelineName(name) {
				names = append(names, name)
			}
		}
		return nil
	})
	sort.Strings(names)
	return names
}

// LoadPipelineFile loads a pipeline document from disk, whose grammar
// documents are found relative to it. data/unicode/unicode.txt and the notation's
// bootstrap come from the bundled resources.
func LoadPipelineFile(file string) (*Pipeline, error) {
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
	l.fromDisk = true
	l.namesOverride = func(p string) bool {
		_, err := os.Stat(filepath.FromSlash(p))
		return !os.IsNotExist(err)
	}
	return l.pipeline(filepath.ToSlash(abs))
}

// LoadPipelineSources loads a pipeline from documents held in memory: a map
// from /-separated path to text, and the path of the pipeline document in
// it. The map may hold its own data/unicode/unicode.txt, data/preparsed/gencmu.json and
// data/preparsed/lojban.json; those it lacks come from the bundled resources.
func LoadPipelineSources(sources map[string]string, pipeline string) (*Pipeline, error) {
	return loadSources(sources, pipeline, false)
}

func loadSources(sources map[string]string, pipeline string, noCache bool) (d *Pipeline, err error) {
	defer guard(ErrorGrammar, &err)
	norm := make(map[string]string, len(sources))
	for p, t := range sources {
		norm[path.Clean(p)] = t
	}
	_, customCore := norm["data/unicode/unicode.txt"]
	_, customProperties := norm["data/unicode/unicode-properties.txt"]
	l, lerr := loaderForBundled(!customCore && !customProperties)
	if lerr != nil {
		return nil, lerr
	}
	l.read = func(p string) (string, bool) { s, ok := norm[p]; return s, ok }
	l.noCache = noCache
	l.namesOverride = func(p string) bool { _, ok := norm[p]; return ok }
	if t, ok := norm["data/unicode/unicode.txt"]; ok {
		if l.uni, err = parseUnicodeTable(t); err != nil {
			problem := &Error{Kind: ErrorGrammar, Document: "data/unicode/unicode.txt", Message: err.Error()}
			_, _ = fmt.Sscanf(err.Error(), "data/unicode/unicode.txt line %d:", &problem.Line)
			return nil, problem
		}
	}
	if text, ok := norm["data/unicode/unicode-properties.txt"]; ok {
		copy := *l.uni
		l.uni = &copy
		if l.uni.properties, err = parseProperties(text, l.uni); err != nil {
			return nil, err
		}
	}
	if customProperties {
		l.uni.propertiesHash = fnv1a64(norm["data/unicode/unicode-properties.txt"])
	}
	if t, ok := norm["data/preparsed/gencmu.json"]; ok {
		if l.reader, err = newNotationReader(t, l.uni); err != nil {
			return nil, err
		}
	} else if l.uni != l.reader.uni {
		if l.reader, err = newNotationReader(bundled.sources["data/preparsed/gencmu.json"], l.uni); err != nil {
			return nil, err
		}
	}
	l.bootstrapHash = l.reader.hash
	l.preparsedRead = func(p string) (string, bool) {
		if text, ok := norm[p]; ok {
			return text, true
		}
		return bundledNamesText(p)
	}
	l.families = nil

	return l.pipeline(path.Clean(pipeline))
}

// Pipeline is a loaded pipeline. A *Pipeline is safe for concurrent use by
// several goroutines: every parse keeps its own state, and the grammars
// lowered for a set of features are cached under a mutex.
type Pipeline struct {
	stages   []*stageGrammar
	declared []string  // the features the pipeline's %features turns on
	features []Feature // every feature, with its kind and default (§13)
	uni      *unicodeTable
	mu       sync.Mutex
	// lowered holds each stage's lowered grammars, keyed by the guarded
	// features that are on.
	lowered []*recent[lowerKey, *lowerEntry]
	// memoLimit is the bound of the shared memos that the library's own
	// tests set, 0 where they set none (memo.go).
	memoLimit atomic.Int64
}

type lowerKey struct {
	guarded string
}

// lowerEntry is a stage's grammar lowered for one key, once.
type lowerEntry struct {
	once sync.Once
	l    *lowered
}

// ParseOptions are the options of a parse (docs/api.md). The zero value
// parses with the pipeline's own features, every stage,
// and each grammar's own elision-only setting.
type ParseOptions struct {
	// Features to turn on for every stage, besides those the pipeline turns
	// on.
	Features []string
	// WithoutFeatures names features to disable in every stage, including
	// defaults. A holding conditional declaration for a disabled feature
	// gives a feature-conflict result. A name in both lists is a usage error.
	WithoutFeatures []string
	// Until names the last stage to run. The zero value, the empty string,
	// runs every stage, so Go cannot ask for a stage with an empty name
	// (docs/api.md).
	Until string
	// ElisionOnly, when set, switches elision-only on or off for every stage.
	ElisionOnly *bool
	// private holds the switches and hooks of the library's own tests,
	// which no caller can set.
	private *privateOptions
}

// StageNames lists the pipeline's stages in order.
func (d *Pipeline) StageNames() []string {
	out := make([]string, len(d.stages))
	for i, s := range d.stages {
		out[i] = s.name
	}
	return out
}

// Features lists the pipeline's features in code point order of their names
// (engine §13): each a gate or a warning, and on by default when the
// pipeline declares it unconditionally, globally or locally.
func (d *Pipeline) Features() []Feature {
	return append([]Feature{}, d.features...)
}

// lower is a stage's grammar lowered for a set of features. Only the guarded
// features that are on change the productions. So two sets of features with
// the same guarded features on share one lowered grammar.
func (d *Pipeline) lower(stage int, features map[string]bool) *lowered {
	g := d.stages[stage]
	on, guarded := namesOn(g.guarded, features)
	key := lowerKey{guarded}
	d.mu.Lock()
	if d.lowered == nil {
		d.lowered = make([]*recent[lowerKey, *lowerEntry], len(d.stages))
	}
	if d.lowered[stage] == nil {
		d.lowered[stage] = newRecent[lowerKey, *lowerEntry](maxLowered)
	}
	e, ok := d.lowered[stage].get(key)
	if !ok {
		e = &lowerEntry{}
		d.lowered[stage].put(key, e)
	}
	d.mu.Unlock()
	// The first parse that needs it lowers it, outside the lock. So it does
	// not hold up the parses that need other ones.
	e.once.Do(func() { e.l = lower(g, on) })
	return e.l
}

// Parse parses a text. A text that does not parse is a result whose OK is
// false; the error is for a caller's mistake, such as an unknown stage, a
// feature named both to turn on and to turn off, or a text that is not valid
// UTF-8, and is a *Error of kind "usage".
func (d *Pipeline) Parse(text string, options ParseOptions) (*ParseResult, error) {
	if err := textProblem(text); err != nil {
		return nil, err
	}
	return d.parse([]rune(text), nil, options)
}

// ParseTokens parses pre-built tokens in place of the first stage's
// character tokens, for tests and tools: text is the original text their
// Source ranges index, in code points.
// Each token's Source must lie within the text. The sources of two tokens
// can overlap or lie out of order (engine §11). Each token's Span must
// start at 0 or later and must not end before it starts. Value and Image
// default independently to Text when their pointers are nil. A caller cannot
// supply attachments: a token with a non-empty Before or After is a usage
// error, and empty ones are dropped (docs/api.md). The parse copies the
// tokens and leaves the caller's unchanged.
func (d *Pipeline) ParseTokens(text string, tokens []InputToken, options ParseOptions) (*ParseResult, error) {
	if err := textProblem(text); err != nil {
		return nil, err
	}
	runes := []rune(text)
	own := make([]Token, len(tokens))
	for i, t := range tokens {
		fail := func(message string) (*ParseResult, error) {
			return nil, &Error{Kind: ErrorUsage, Message: fmt.Sprintf("token %d: %s", i, message)}
		}
		if len(t.Before) > 0 || len(t.After) > 0 {
			return fail("a caller cannot supply attachments")
		}
		if s := t.Source; s[0] < 0 || s[0] > s[1] || s[1] > len(runes) {
			return fail("the source is outside the text")
		}
		if s := t.Span; s[0] < 0 || s[0] > s[1] {
			return fail("the span is not a range")
		}
		value, image := t.Text, t.Text
		if t.Value != nil {
			value = *t.Value
		}
		if t.Image != nil {
			image = *t.Image
		}
		for _, s := range []string{t.Text, value, image} {
			if !utf8.ValidString(s) {
				return fail("a string is not valid UTF-8")
			}
		}
		canonical := make([]string, 0, len(t.Tags))
		seen := map[string]bool{}
		for _, tag := range t.Tags {
			name := tag
			if strings.HasPrefix(tag, "_") {
				name = d.uni.canonicalTag(tag)
			}
			if !isTag(name, d.uni) {
				return fail("invalid stored tag " + tag)
			}
			if !seen[name] {
				canonical = append(canonical, name)
				seen[name] = true
			}
		}
		own[i] = Token{Text: t.Text, Value: value, Image: image, Tags: canonical, Span: t.Span, Source: t.Source}
	}
	return d.parse(runes, own, options)
}

// textProblem is the usage error of a text that is not valid UTF-8, which
// is no sequence of scalar values (engine §1), or nil. It comes before any
// character token.
func textProblem(text string) error {
	if problem := utf8Problem(text); problem != "" {
		return &Error{Kind: ErrorUsage, Message: "the text is not a sequence of Unicode scalar values: " + problem}
	}
	return nil
}

func (d *Pipeline) parse(text []rune, tokens []Token, options ParseOptions) (res *ParseResult, err error) {
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
			return nil, &Error{Kind: ErrorUsage, Message: fmt.Sprintf("the pipeline has no stage %q", options.Until)}
		}
	}
	// The features on are the pipeline's and the caller's, less those the
	// caller turns off (§13).
	off := map[string]bool{}
	for _, f := range options.WithoutFeatures {
		off[f] = true
	}
	features := map[string]bool{}
	for _, f := range options.Features {
		if off[f] {
			return nil, &Error{Kind: ErrorUsage, Message: fmt.Sprintf("the feature %s is named both to turn on and to turn off", f)}
		}
		features[f] = true
	}
	for _, f := range d.declared {
		if !off[f] {
			features[f] = true
		}
	}
	ps := newParseState(d.uni, text)
	ps.private = options.private
	// The private options of the library's own tests can change answers,
	// so such a parse neither reads nor keeps shared answers (engine §4.3).
	// Nor does a parse whose work a test counts, so that answers of an
	// earlier parse never shorten the count.
	if options.private == nil && work.Load() == nil {
		ps.memoLimit = d.memoBound()
	}
	if tokens == nil {
		tokens = ps.characterTokens()
	}
	outcomes := d.runStages(ps, features, options, tokens, 0, last)
	// The warnings of every stage run, in stage order, whether or not the
	// result is ok (§13).
	res = &ParseResult{OK: true, Warnings: []Warning{}, Features: []string{}}
	for name := range features {
		res.Features = append(res.Features, name)
	}
	sort.Strings(res.Features)
	for _, o := range outcomes {
		res.Stages = append(res.Stages, o.stage)
		res.Warnings = append(res.Warnings, o.warnings...)
		if o.err != nil {
			res.OK, res.Error = false, o.err
		}
	}
	if res.OK {
		res.Tree = outcomes[len(outcomes)-1].tree
	}
	return res, nil
}

func (d *Pipeline) runStages(ps *parseState, features map[string]bool, options ParseOptions, tokens []Token, from, to int) []stageOutcome {
	var out []stageOutcome
	for i := from; i <= to; i++ {
		g := d.stages[i]
		elision := g.elisionOnly
		if options.ElisionOnly != nil {
			elision = *options.ElisionOnly
		}
		run := ps.newRun(g.name, g, tokens)
		var o stageOutcome
		if failure := run.activateFeatures(g.features, features, options.WithoutFeatures); failure != nil {
			o = stageOutcome{stage: Stage{Name: g.name, Input: tokens}, err: failure}
		} else {
			o = run.run(d.lower(i, features), elision)
		}
		out = append(out, o)
		if o.err != nil {
			break
		}
		tokens = o.stage.Output
	}
	return out
}
