package gencmu

import (
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"
)

type unicodeNameRecord struct {
	code       rune
	name, kind string
	line       int
}
type unicodeNameAlias struct {
	kind string
	code rune
	name string
}
type unicodeNameAlgorithm struct {
	kind        string
	first, last rune
	prefix      string
	line        int
}
type unicodeNames struct {
	path       string
	records    []unicodeNameRecord
	names      map[string]rune
	formal     map[rune]unicodeNameRecord
	aliases    map[unicodeNameAlias]bool
	scalars    map[rune]bool
	algorithms []unicodeNameAlgorithm
}

var namesVersionPattern = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+$`)
var namesHexPattern = regexp.MustCompile(`^[0-9A-Fa-f]+$`)
var namesSpellingPattern = regexp.MustCompile(`^[A-Z0-9 -]+$`)
var namesAddedPattern = regexp.MustCompile(`^[A-Z][A-Z0-9 -]*$`)
var namesSuffixPattern = regexp.MustCompile(`^[0-9A-F]{4,6}$`)
var namesHangulL = []string{"G", "GG", "N", "D", "DD", "R", "M", "B", "BB", "S", "SS", "", "J", "JJ", "C", "K", "T", "P", "H"}
var namesHangulV = []string{"A", "AE", "YA", "YAE", "EO", "E", "YEO", "YE", "O", "WA", "WAE", "OE", "YO", "U", "WEO", "WE", "WI", "YU", "EU", "YI", "I"}
var namesHangulT = []string{"", "G", "GG", "GS", "N", "NJ", "NH", "D", "L", "LG", "LM", "LB", "LS", "LT", "LP", "LH", "M", "B", "BS", "S", "SS", "NG", "J", "C", "K", "T", "P", "H"}

func namesError(path string, line int, message string) *Error {
	return &Error{Kind: ErrorGrammar, Document: path, Line: line, Message: message}
}
func namesFail(path string, line int, message string) { panic(namesError(path, line, message)) }
func namesScalar(field, path string, line int) rune {
	digits := strings.TrimLeft(field, "0")
	if !namesHexPattern.MatchString(field) || len(digits) > 6 {
		namesFail(path, line, "an invalid scalar")
	}
	if digits == "" {
		digits = "0"
	}
	n, err := strconv.ParseUint(digits, 16, 32)
	if err != nil || n > 0x10ffff || n >= 0xd800 && n <= 0xdfff {
		namesFail(path, line, "an invalid scalar")
	}
	return rune(n)
}
func (r unicodeNameAlgorithm) lookup(name string) (rune, bool) {
	if r.kind == "hex" {
		if !strings.HasPrefix(name, r.prefix) {
			return 0, false
		}
		suffix := strings.TrimPrefix(name, r.prefix)
		if !namesSuffixPattern.MatchString(suffix) {
			return 0, false
		}
		code, err := strconv.ParseUint(suffix, 16, 32)
		return rune(code), err == nil && rune(code) >= r.first && rune(code) <= r.last && fmt.Sprintf("%04X", code) == suffix
	}
	if !strings.HasPrefix(name, "HANGUL SYLLABLE ") {
		return 0, false
	}
	suffix := strings.TrimPrefix(name, "HANGUL SYLLABLE ")
	for l, lead := range namesHangulL {
		for v, vowel := range namesHangulV {
			prefix := lead + vowel
			if !strings.HasPrefix(suffix, prefix) {
				continue
			}
			if t := slices.Index(namesHangulT, strings.TrimPrefix(suffix, prefix)); t >= 0 {
				return rune(0xac00 + (l*21+v)*28 + t), true
			}
		}
	}
	return 0, false
}

// The parser retains algorithms rather than expanding their scalar ranges.
func parseUnicodeNames(text, path, version string) (table *unicodeNames, failure *Error) {
	defer func() {
		if e := recover(); e != nil {
			if err, ok := e.(*Error); ok {
				table = nil
				failure = err
			} else {
				panic(e)
			}
		}
	}()
	t := &unicodeNames{path: path, names: map[string]rune{}, formal: map[rune]unicodeNameRecord{}, aliases: map[unicodeNameAlias]bool{}, scalars: map[rune]bool{}}
	header := false
	lines := strings.Split(text, "\n")
	for index, raw := range lines {
		line := index + 1
		if index < len(lines)-1 {
			raw = strings.TrimSuffix(raw, "\r")
		}
		f := strings.FieldsFunc(raw, func(c rune) bool { return c == ' ' || c == '\t' })
		if len(f) == 0 {
			continue
		}
		if !header {
			if len(f) != 2 || f[0] != "unicode-names" || !namesVersionPattern.MatchString(f[1]) || f[1] != version {
				namesFail(path, line, "the names header must match the core version")
			}
			header = true
			continue
		}
		switch f[0] {
		case "name", "alias":
			alias := f[0] == "alias"
			start, kind := 2, "name"
			if alias {
				start = 3
				if len(f) > 1 {
					kind = f[1]
				}
			}
			if len(f) <= start || alias && !slices.Contains([]string{"correction", "control", "alternate", "figment", "abbreviation"}, kind) {
				namesFail(path, line, "an invalid name record")
			}
			code, name := namesScalar(f[start-1], path, line), strings.Join(f[start:], " ")
			if !namesSpellingPattern.MatchString(name) {
				namesFail(path, line, "an invalid name spelling")
			}
			r := unicodeNameRecord{code, name, kind, line}
			if alias {
				key := unicodeNameAlias{kind, code, name}
				if t.aliases[key] {
					namesFail(path, line, "a duplicate alias record")
				}
				t.aliases[key] = true
			} else {
				if _, ok := t.formal[code]; ok {
					namesFail(path, line, "a scalar has more than one formal name")
				}
				t.formal[code] = r
			}
			if previous, ok := t.names[name]; ok && previous != code {
				namesFail(path, line, "a name identifies different scalars")
			}
			t.names[name] = code
			t.scalars[code] = true
			t.records = append(t.records, r)
		case "algorithm":
			kind := ""
			if len(f) > 1 {
				kind = f[1]
			}
			if !(kind == "hex" && len(f) >= 5 || kind == "hangul" && len(f) == 4) {
				namesFail(path, line, "an invalid naming algorithm")
			}
			first, last := namesScalar(f[2], path, line), namesScalar(f[3], path, line)
			prefix := "HANGUL SYLLABLE "
			if kind == "hex" {
				prefix = strings.Join(f[4:], " ")
			}
			if first > last || first <= 0xdfff && last >= 0xd800 || !namesSpellingPattern.MatchString(prefix) || kind == "hangul" && (first != 0xac00 || last != 0xd7a3) {
				namesFail(path, line, "an invalid naming algorithm")
			}
			for _, rule := range t.algorithms {
				if rule.kind == kind && rule.prefix == prefix && first <= rule.last && last >= rule.first {
					namesFail(path, line, "overlapping naming algorithms")
				}
			}
			t.algorithms = append(t.algorithms, unicodeNameAlgorithm{kind, first, last, prefix, line})
		default:
			namesFail(path, line, "an unknown names record")
		}
	}
	if !header {
		namesFail(path, 0, "the names header is missing")
	}
	for _, record := range t.records {
		for _, rule := range t.algorithms {
			if record.kind == "name" && record.code >= rule.first && record.code <= rule.last {
				namesFail(path, record.line, "an explicit name lies in an algorithmic range")
			}
			if code, ok := rule.lookup(record.name); ok && code != record.code {
				namesFail(path, record.line, "a name identifies different scalars")
			}
		}
	}
	return t, nil
}
func (t *unicodeNames) lookup(name string) (rune, bool) {
	if code, ok := t.names[name]; ok {
		return code, true
	}
	for _, rule := range t.algorithms {
		if code, ok := rule.lookup(name); ok {
			return code, true
		}
	}
	return 0, false
}
func (t *unicodeNames) hasScalar(code rune) bool {
	if t.scalars[code] {
		return true
	}
	for _, rule := range t.algorithms {
		if code >= rule.first && code <= rule.last {
			return true
		}
	}
	return false
}
func (t *unicodeNames) inspect(pinned *unicodeNames, abbreviations map[string]rune, extra bool) *Error {
	for _, rule := range t.algorithms {
		valid := false
		for _, known := range pinned.algorithms {
			valid = valid || rule.kind == known.kind && rule.first == known.first && rule.last == known.last && rule.prefix == known.prefix
		}
		if extra || !valid {
			return namesError(t.path, rule.line, "an algorithm must retain its pinned rule and range")
		}
	}
	for _, r := range t.records {
		if r.kind != "name" {
			if extra || !pinned.aliases[unicodeNameAlias{r.kind, r.code, r.name}] {
				return namesError(t.path, r.line, "an alias must retain its pinned kind, spelling, and scalar")
			}
		} else if known, ok := pinned.formal[r.code]; !extra && ok && known.name == r.name {
			continue
		} else {
			_, reserved := pinned.lookup(r.name)
			_, abbreviation := abbreviations[r.name]
			if pinned.hasScalar(r.code) || reserved || !namesAddedPattern.MatchString(r.name) || abbreviation {
				return namesError(t.path, r.line, "an added name must name an unnamed scalar without a reserved spelling")
			}
		}
	}
	return nil
}

type namesScope struct {
	read         func(string) (string, bool)
	uni          *unicodeTable
	extras       []string
	tables       []*unicodeNames
	dependencies map[string]string
}

func newNamesScope(read func(string) (string, bool), uni *unicodeTable, extras []string) *namesScope {
	paths := append([]string{}, extras...)
	slices.Sort(paths)
	return &namesScope{read: read, uni: uni, extras: slices.Compact(paths)}
}

func selectedNames(path string, dom *domDoc, inherited []string) []string {
	paths := append([]string{}, inherited...)
	for _, directive := range dom.Directives {
		if directive.Name == "names" {
			paths = append(paths, resolvePath(path, directive.Args[0]))
		}
	}
	slices.Sort(paths)
	return slices.Compact(paths)
}
func (n *namesScope) need(path string) (string, *Error) {
	text, ok := n.read(path)
	if !ok {
		return "", namesError(path, 0, "the names resource is missing")
	}
	if !utf8.ValidString(text) {
		return "", namesError(path, 0, "the names resource is not valid UTF-8")
	}
	return text, nil
}
func (n *namesScope) load() *Error {
	if n.tables != nil {
		return nil
	}
	if n.uni.versionCount != 1 || n.uni.version == "" {
		return namesError("unicode.txt", 0, "names require exactly one Unicode version")
	}
	text, err := n.need("unicode-names.txt")
	if err != nil {
		return err
	}
	hash := fnv1a64(text)
	base, err := parseUnicodeNames(text, "unicode-names.txt", n.uni.version)
	if err != nil {
		return err
	}
	reference := text
	if hash != pinnedNamesHash {
		reference, err = n.need("unicode-names-reference.txt")
		if err != nil {
			return err
		}
	}
	if fnv1a64(reference) != pinnedNamesHash {
		return namesError("unicode-names-reference.txt", 0, "the reference fingerprint differs from the pinned data")
	}
	if n.uni.version != "15.1.0" {
		return namesError("unicode-names-reference.txt", 0, "the reference version differs from the selected names version")
	}
	pinned := base
	if hash != pinnedNamesHash {
		pinned, err = parseUnicodeNames(reference, "unicode-names-reference.txt", "15.1.0")
		if err != nil {
			return err
		}
	}
	if err = base.inspect(pinned, n.uni.abbreviations, false); err != nil {
		return err
	}
	tables := []*unicodeNames{base}
	dependencies := map[string]string{"unicode-names.txt": hash}
	for _, path := range n.extras {
		text, err := n.need(path)
		if err != nil {
			return err
		}
		table, err := parseUnicodeNames(text, path, n.uni.version)
		if err != nil {
			return err
		}
		if err = table.inspect(pinned, n.uni.abbreviations, true); err != nil {
			return err
		}
		for _, r := range table.records {
			for _, earlier := range tables {
				code, ok := earlier.lookup(r.name)
				formal, hasFormal := earlier.formal[r.code]
				if ok && code != r.code || hasFormal && formal.name != r.name {
					return namesError(path, r.line, "names resources conflict")
				}
			}
		}
		dependencies[path] = fnv1a64(text)
		tables = append(tables, table)
	}
	n.tables, n.dependencies = tables, dependencies
	return nil
}
func (n *namesScope) lookup(name string, coreOnly bool) (rune, bool, *Error) {
	if code, ok := n.uni.abbreviations[name]; ok {
		return code, true, nil
	}
	if coreOnly {
		return 0, false, nil
	}
	if err := n.load(); err != nil {
		return 0, false, err
	}
	for _, table := range n.tables {
		if code, ok := table.lookup(name); ok {
			return code, true, nil
		}
	}
	return 0, false, nil
}

var namesFingerprintPattern = regexp.MustCompile(`^[0-9a-f]{16}$`)

func (n *namesScope) matches(raw json.RawMessage) (bool, *Error) {
	if len(raw) == 0 {
		return true, nil
	}
	var dependencies map[string]string
	paths := append([]string{"unicode-names.txt"}, n.extras...)
	slices.Sort(paths)
	paths = slices.Compact(paths)
	if unmarshalJSON(raw, &dependencies) != nil || len(dependencies) != len(paths) {
		return false, nil
	}
	for _, path := range paths {
		if !namesFingerprintPattern.MatchString(dependencies[path]) {
			return false, nil
		}
	}
	if err := n.load(); err != nil {
		return false, err
	}
	for _, path := range paths {
		if dependencies[path] != n.dependencies[path] {
			return false, nil
		}
	}
	return true, nil
}
