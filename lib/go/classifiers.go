package gencmu

import (
	"fmt"
	"sort"
	"strconv"
	"sync"
)

// A stage's classifiers and implications (engine §2, §11). A classifier
// maps a string to its classes. Its value depends on the features, so the
// stage resolves it for the features of each parse, and keeps the result
// for each set of features. An implication adds tags to each token the
// stage emits; its two sides are closed, so the loader gives them their
// values when it stitches the stage.

// classifierItem is a %classifier item of a stage, with its document.
type classifierItem struct {
	doc        string
	classifier *domClassifier
}

// stageImplication is an implication of a stage with the values of its two
// sides, each a tag set's names in code point order.
type stageImplication struct {
	ifNames, thenNames []string
}

// classifierTables is every classifier of a stage resolved for one set of
// features: for each classifier, each key's classes, a tag set. fault is
// the error of the grammar that resolving them found, or "".
type classifierTables struct {
	tables map[string]map[string]*constValue
	fault  string
}

// stageClassifiers holds a stage's classifier items in stitching order and
// its resolved classifiers for each set of its gates that is on, which
// parses on several threads share.
type stageClassifiers struct {
	items []classifierItem
	names map[string]bool
	// gates are the features that gate an entry, in code point order. Only
	// these change the classifiers.
	gates []string
	mu    sync.Mutex
	byKey *recent[string, *classifierEntry]
}

// classifierEntry is the classifiers for one set of gates, resolved once.
type classifierEntry struct {
	once   sync.Once
	tables *classifierTables
}

// addImplications gives each implication of the stage the values of its
// sides, once the constants have their final values (engine §2, §9): each
// is a closed term whose type is a tag set.
func (g *stageGrammar) addImplications(items []implicationItem) *Error {
	types := g.constantTypes()
	for _, it := range items {
		m := it.implication
		var sides [2][]string
		for i, side := range []*domTerm{m.If, m.Then} {
			for _, ref := range constRefs(side) {
				if g.constants[ref.Str] == nil {
					return g.constError(it.doc, ref.At, "$%s is not defined in stage %s", ref.Str, g.name)
				}
			}
			if f := implicationSideFault(side, types); f != nil {
				return g.faultError(it.doc, f.node, m.At, f.problem)
			}
			v, err := g.evaluateClosed(it.doc, side, m.At)
			if err != nil {
				return err
			}
			sides[i] = v.names
		}
		g.implications = append(g.implications, stageImplication{ifNames: sides[0], thenNames: sides[1]})
	}
	return nil
}

// implicationItem is an %implies item of a stage, with its document.
type implicationItem struct {
	doc         string
	implication *domImplication
}

// classifiers is every classifier of the stage for a set of features
// (engine §2): each key's classes after every entry whose gates hold, in
// stitching order. An entry that adds a membership that holds, or removes
// one that does not, is an error of the grammar for these features.
func (g *stageGrammar) classifiers(features map[string]bool) *classifierTables {
	c := &g.classifierSet
	on, key := namesOn(c.gates, features)
	c.mu.Lock()
	if c.byKey == nil {
		c.byKey = newRecent[string, *classifierEntry](maxLowered)
	}
	e, ok := c.byKey.get(key)
	if !ok {
		e = &classifierEntry{}
		c.byKey.put(key, e)
	}
	c.mu.Unlock()
	// The first parse that needs them resolves them, outside the lock. So
	// it does not hold up the parses that need other ones.
	e.once.Do(func() { e.tables = resolveClassifiers(c.items, on) })
	return e.tables
}

// resolveClassifiers applies the entries of the items in order, for a set
// of features.
func resolveClassifiers(items []classifierItem, features map[string]bool) *classifierTables {
	// The classes of each key as names in code point order, each once.
	classes := map[string]map[string][]string{}
	for _, it := range items {
		c := it.classifier
		table := classes[c.Name]
		if table == nil {
			table = map[string][]string{}
			classes[c.Name] = table
		}
	entries:
		for _, e := range c.Entries {
			for _, gd := range e.Guards {
				if features[gd.Feature] == gd.Negated {
					continue entries
				}
			}
			for _, word := range e.Keys {
				held := table[word]
				i := sort.SearchStrings(held, e.Class)
				has := i < len(held) && held[i] == e.Class
				if (e.Op == "∈") == has {
					message := fmt.Sprintf("%s is already in %s", strconv.Quote(word), e.Class)
					if e.Op == "∉" {
						message = fmt.Sprintf("%s is not in %s, so ∉ has nothing to remove", strconv.Quote(word), e.Class)
					}
					return &classifierTables{fault: fmt.Sprintf("%s:%d:%d: the classifier %s: %s", it.doc, e.At[0], e.At[1], c.Name, message)}
				}
				changed := make([]string, 0, len(held)+1)
				changed = append(changed, held[:i]...)
				if e.Op == "∈" {
					changed = append(changed, e.Class)
					changed = append(changed, held[i:]...)
				} else {
					changed = append(changed, held[i+1:]...)
				}
				table[word] = changed
			}
		}
	}
	out := &classifierTables{tables: map[string]map[string]*constValue{}}
	for name, table := range classes {
		values := make(map[string]*constValue, len(table))
		for word, names := range table {
			values[word] = &constValue{ty: tyTags, names: names}
		}
		out.tables[name] = values
	}
	return out
}

// implied is a token's explicit tags with the tags of the stage's
// implications, added until no tag changes (engine §11). An implication
// only adds tags, so the loop ends, also over a cycle.
func (run *stageRun) implied(tags *tagset) *tagset {
	implications := run.grammar.implications
	for changed := len(implications) > 0; changed; {
		changed = false
		for _, m := range implications {
			meets := false
			for _, name := range m.ifNames {
				if tags.has(name) {
					meets = true
					break
				}
			}
			if !meets {
				continue
			}
			for _, name := range m.thenNames {
				if !tags.has(name) {
					tags = run.ps.in.union(tags, run.ps.in.make(m.thenNames))
					changed = true
					break
				}
			}
		}
	}
	return tags
}
