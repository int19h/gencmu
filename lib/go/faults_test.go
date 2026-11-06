package gencmu

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// The faults of this library's own paths in the check of elision-only
// (tests/README.md, privateOptions.fault): with each one on, the shared
// engine cases that the table names fail, in the way that the table says,
// through the result or through the witness hook alone.

// A catch: how a case catches a fault, each check on its own.
const (
	catchResult = "result"      // the result fails the case, the hook does not
	catchHook   = "hook"        // only the witness hook fails it
	catchBoth   = "result+hook" // both fail it, each on its own
)

// faults lists every fault that privateOptions.fault takes, each with its
// sites: the places in the code where it is checked, each of which the
// named cases must enter while it is on.
var faults = []string{"omission", "reprocess", "route3", "restore", "rank-restoration", "lost:context", "lost:select"}

var faultSites = map[string][]string{
	"lost:context":     {"lost:context@links", "lost:context@items", "lost:context@admission-members", "lost:context@admission-links"},
	"rank-restoration": {"rank-restoration@ranker", "rank-restoration@admission"},
	"lost:select":      {"lost:select@links", "lost:select@items"},
}

func sitesOf(fault string) []string {
	if sites, ok := faultSites[fault]; ok {
		return sites
	}
	return []string{fault}
}

// faultCatches names, for each fault, shared cases that catch it, and how.
var faultCatches = map[string]map[string]string{
	"omission":  {"elidable-table-unequal-empty.json": catchBoth},
	"reprocess": {"reparse-strict-reclose-late.json": catchResult},
	"route3":    {"reparse-strict-nested-route.json": catchResult, "reparse-synthetic-suffix-empty.json": catchResult},
	"restore":   {"reparse-incompatible-optional-sound.json": catchResult},
	"rank-restoration": {"reparse-witness-hook-only.json": catchBoth, "elision-only-passes.json": catchBoth,
		"reparse-witness-sibling-last.json": catchBoth, "ranked-reconstruction-newly-resolved.json": catchBoth, "ranked-reconstruction-physical-spans.json": catchBoth},
	"lost:context": {"reparse-witness-sibling-first.json": catchBoth, "reparse-witness-sibling-last.json": catchBoth,
		"reparse-strict-later-reading-symbol.json": catchResult, "ranked-reconstruction-physical-spans.json": catchBoth, "ranked-reconstruction-displaced.json": catchBoth, "ranked-reconstruction-empty-flag.json": catchBoth},
	"lost:select": {"reparse-witness-sibling-first.json": catchHook, "reparse-strict-later-reading-symbol.json": catchResult},
}

func faultCatch(c *engineCase) (bool, error) {
	err := checkCase(c, true)
	if isGuardedCrash(err) {
		return false, fmt.Errorf("fault run crashed: %w", err)
	}
	return err != nil, nil
}

// catchOf runs a case with a fault on, once checking only the result and
// once checking only the hook, and says how the case catches the fault, or
// "" where it does not.
func catchOf(t *testing.T, fault, file string, hits map[string]bool) string {
	run := func(result bool) bool {
		c := loadCase(t, filepath.Join("../../tests/engine", file))
		c.fault, c.noHook, c.onlyHook, c.hits = fault, result, !result, hits
		caught, err := faultCatch(c)
		if err != nil {
			t.Fatalf("%s with %s: %v", file, fault, err)
		}
		return caught
	}
	switch result, hook := run(true), run(false); {
	case result && hook:
		return catchBoth
	case result:
		return catchResult
	case hook:
		return catchHook
	}
	return ""
}

func TestFaultsAreCaught(t *testing.T) {
	t.Parallel()
	hookOnly := false
	for _, fault := range faults {
		files := faultCatches[fault]
		if len(files) == 0 {
			t.Errorf("no case catches %s", fault)
		}
		hits := map[string]bool{}
		for file, want := range files {
			if got := catchOf(t, fault, file, hits); got != want {
				t.Errorf("%s catches %s as %q, not %q", file, fault, got, want)
			}
			hookOnly = hookOnly || want == catchHook
		}
		// The named cases enter every site of the fault, and no other.
		for _, site := range sitesOf(fault) {
			if !hits[site] {
				t.Errorf("no named case enters the site %s", site)
			}
			delete(hits, site)
		}
		for site := range hits {
			t.Errorf("%s enters the site %s, which it does not declare", fault, site)
		}
	}
	if len(faultCatches) != len(faults) {
		t.Errorf("the table names %d faults, not %d", len(faultCatches), len(faults))
	}
	if !hookOnly {
		t.Error("no fault that only the hook catches")
	}
	// The selection channel catches lost:select itself, whatever the result
	// does.
	selects := false
	for _, how := range faultCatches["lost:select"] {
		selects = selects || how != catchResult
	}
	if !selects {
		t.Error("no case catches lost:select through the hook")
	}
}

// TestListFaultCatches lists every case that catches each fault, and how,
// with -v and GENCMU_FAULTS_LIST set, to choose the cases of the table.
func TestListFaultCatches(t *testing.T) {
	t.Parallel()
	if !testing.Verbose() || os.Getenv("GENCMU_FAULTS_LIST") == "" {
		t.Skip("set GENCMU_FAULTS_LIST and -v to list every catch")
	}
	files, _ := filepath.Glob("../../tests/engine/*.json")
	for _, fault := range faults {
		for _, f := range files {
			if how := catchOf(t, fault, filepath.Base(f), nil); how != "" {
				t.Logf("%s %s %s", fault, filepath.Base(f), how)
			}
		}
	}
}

// Every static fault call has one declared key and one source location.
func TestFaultSiteDeclarationsCoverSource(t *testing.T) {
	found := map[string]string{}
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		if strings.HasSuffix(file, "_test.go") {
			continue
		}
		positions := token.NewFileSet()
		tree, err := parser.ParseFile(positions, file, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		ast.Inspect(tree, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			selector, ok := call.Fun.(*ast.SelectorExpr)
			if !ok || (selector.Sel.Name != "fault" && selector.Sel.Name != "faultAt" && selector.Sel.Name != "skips") || len(call.Args) == 0 {
				return true
			}
			literal, ok := call.Args[0].(*ast.BasicLit)
			if !ok || literal.Kind != token.STRING {
				return true
			}
			name, err := strconv.Unquote(literal.Value)
			if err != nil {
				t.Fatal(err)
			}
			if selector.Sel.Name != "fault" {
				site, ok := call.Args[1].(*ast.BasicLit)
				if !ok || site.Kind != token.STRING {
					t.Fatalf("%s has no literal fault site", positions.Position(call.Pos()))
				}
				value, err := strconv.Unquote(site.Value)
				if err != nil {
					t.Fatal(err)
				}
				name += "@" + value
			}
			at := positions.Position(call.Pos()).String()
			if previous, duplicate := found[name]; duplicate {
				t.Errorf("%s shares its fault key between %s and %s", name, previous, at)
			}
			found[name] = at
			return true
		})
	}
	for _, fault := range faults {
		for _, site := range sitesOf(fault) {
			if _, ok := found[site]; !ok {
				t.Errorf("declared site %s has no source call", site)
			}
			delete(found, site)
		}
	}
	for site, at := range found {
		t.Errorf("undeclared site %s at %s", site, at)
	}
}

func TestFaultRunsRejectParseCrashes(t *testing.T) {
	for _, repeated := range []bool{false, true} {
		for _, result := range []bool{true, false} {
			c := loadCase(t, "../../tests/engine/without-elision-except-owner-choice.json")
			c.fault, c.noHook, c.onlyHook = "probe-crash", result, !result
			c.familyOracle = func(*recognizer, *item) { panic("probe crash") }
			if repeated {
				c.Parses = append(c.Parses, struct {
					Options caseOptions `json:"options"`
					Expect  caseExpect  `json:"expect"`
				}{Expect: c.Expect})
			}
			caught, err := faultCatch(c)
			if err == nil || caught || !strings.Contains(err.Error(), "probe crash") {
				t.Errorf("repeated=%t, result-only=%t: crash counted as caught=%t, error=%v", repeated, result, caught, err)
			}
		}
	}
}
