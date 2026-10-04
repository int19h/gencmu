package gencmu

import (
	"fmt"
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
	g.indexImplications()
	return nil
}

// indexImplications lists each implication under each tag of its if side.
func (g *stageGrammar) indexImplications() {
	g.impliedBy = map[string][]int{}
	for i, m := range g.implications {
		for _, name := range m.ifNames {
			g.impliedBy[name] = append(g.impliedBy[name], i)
		}
	}
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
	// The classes of each key, each once, in the order added. They are
	// sorted at the end. Inserting into a sorted list would copy or shift it at each
	// entry, so a key of K classes would cost K squared.
	classes := map[string]map[string]*keyClasses{}
	for _, it := range items {
		c := it.classifier
		table := classes[c.Name]
		if table == nil {
			table = map[string]*keyClasses{}
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
				if held == nil {
					held = &keyClasses{}
					table[word] = held
				}
				at := held.find(e.Class)
				if (e.Op == "∈") == (at >= 0) {
					message := fmt.Sprintf("%s is already in %s", strconv.Quote(word), e.Class)
					if e.Op == "∉" {
						message = fmt.Sprintf("%s is not in %s, so ∉ has nothing to remove", strconv.Quote(word), e.Class)
					}
					return &classifierTables{fault: fmt.Sprintf("%s:%d:%d: the classifier %s: %s", it.doc, e.At[0], e.At[1], c.Name, message)}
				}
				if e.Op == "∈" {
					held.add(e.Class)
				} else {
					held.remove(at)
				}
			}
		}
	}
	out := &classifierTables{tables: map[string]map[string]*constValue{}}
	for name, table := range classes {
		values := make(map[string]*constValue, len(table))
		for word, held := range table {
			names := held.names
			var c *workCount
			if w := work.Load(); w != nil {
				c = &w.classSteps
			}
			sortStrings(names, c, "class steps")
			if len(names) == 0 {
				names = []string{}
			}
			values[word] = &constValue{ty: tyTags, names: names}
		}
		out.tables[name] = values
	}
	return out
}

// keyClasses is the classes of one key while the entries are applied, in
// no order. Past a few classes, an index finds each without a scan.
type keyClasses struct {
	names []string
	index map[string]int
}

const keyScanLimit = 8

// find is where a class stands among the key's classes, or -1.
func (k *keyClasses) find(class string) int {
	w := work.Load()
	if k.index != nil {
		if w != nil {
			w.classSteps.add("class steps")
		}
		if i, ok := k.index[class]; ok {
			return i
		}
		return -1
	}
	for i, name := range k.names {
		if w != nil {
			w.classSteps.add("class steps")
		}
		if name == class {
			return i
		}
	}
	return -1
}

func (k *keyClasses) add(class string) {
	k.names = append(k.names, class)
	if k.index != nil {
		k.index[class] = len(k.names) - 1
	} else if len(k.names) > keyScanLimit {
		w := work.Load()
		k.index = make(map[string]int, 2*len(k.names))
		for i, name := range k.names {
			if w != nil {
				w.classSteps.add("class steps")
			}
			k.index[name] = i
		}
	}
}

// remove takes out the class at i, moving the last class into its place.
func (k *keyClasses) remove(i int) {
	last := len(k.names) - 1
	if k.index != nil {
		delete(k.index, k.names[i])
		if i != last {
			k.index[k.names[last]] = i
		}
	}
	k.names[i] = k.names[last]
	k.names = k.names[:last]
}

// implied is a token's explicit tags with the tags of the stage's
// implications, added until no tag changes (engine §11). An implication
// only adds tags, so it fires at most once, also over a cycle. Each tag,
// explicit or added, fires the implications its index lists, so the work
// is the implications that fire, not passes over all of them.
func (run *stageRun) implied(tags *tagset) *tagset {
	g := run.grammar
	if len(g.implications) == 0 {
		return tags
	}
	var fired map[int]bool
	var added []string
	var have map[string]bool
	w := work.Load()
	for i := 0; i < len(tags.names)+len(added); i++ {
		var tag string
		if i < len(tags.names) {
			tag = tags.names[i]
		} else {
			tag = added[i-len(tags.names)]
		}
		for _, m := range g.impliedBy[tag] {
			if w != nil {
				w.implicationSteps.add("implication steps")
			}
			if fired[m] {
				continue
			}
			if fired == nil {
				fired, have = map[int]bool{}, map[string]bool{}
			}
			fired[m] = true
			for _, then := range g.implications[m].thenNames {
				if !have[then] && !tags.has(then) {
					have[then] = true
					added = append(added, then)
				}
			}
		}
	}
	if len(added) == 0 {
		return tags
	}
	return run.ps.in.fromList(append(append([]string{}, tags.names...), added...))
}
