package gencmu

import (
	"os"
	"path/filepath"
	"testing"
)

// The faults of this library's own paths in the check of elision-only
// (tests/README.md, privateOptions.fault): with each one on, the shared
// engine cases that the table names fail, in the way that the table says,
// through the result or through the witness hook alone.

// A catch: how a case catches a fault.
const (
	catchResult = "result" // the result alone fails the case
	catchHook   = "hook"   // only the witness hook fails it
)

// faults lists every fault that privateOptions.fault takes.
var faults = []string{"reprocess", "route3", "restore", "rank-restoration", "lost:context", "lost:select"}

// faultCatches names, for each fault, shared cases that catch it, and how.
var faultCatches = map[string]map[string]string{
	"reprocess": {"reparse-strict-reclose-late.json": catchResult},
	"route3":    {"reparse-strict-nested-route.json": catchResult, "reparse-synthetic-suffix-empty.json": catchResult},
	"restore":   {"reparse-incompatible-optional-sound.json": catchResult},
	"rank-restoration": {"reparse-witness-hook-only.json": catchResult, "elision-only-passes.json": catchResult,
		"reparse-witness-sibling-last.json": catchHook},
	"lost:context": {"reparse-witness-sibling-first.json": catchHook, "reparse-witness-sibling-last.json": catchHook},
	"lost:select":  {"reparse-witness-sibling-first.json": catchResult},
}

// catchOf runs a case with a fault on, once with the hook off and once with
// it on, and says how the case catches the fault, or "" where it does not.
func catchOf(t *testing.T, fault, file string) string {
	run := func(hook bool) error {
		c := loadCase(t, filepath.Join("../../tests/engine", file))
		c.fault, c.noHook = fault, !hook
		return checkCase(c, true)
	}
	if run(false) != nil {
		return catchResult
	}
	if run(true) != nil {
		return catchHook
	}
	return ""
}

func TestFaultsAreCaught(t *testing.T) {
	hookOnly := false
	for _, fault := range faults {
		files := faultCatches[fault]
		if len(files) == 0 {
			t.Errorf("no case catches %s", fault)
		}
		for file, want := range files {
			if got := catchOf(t, fault, file); got != want {
				t.Errorf("%s catches %s as %q, not %q", file, fault, got, want)
			}
			hookOnly = hookOnly || want == catchHook
		}
	}
	if len(faultCatches) != len(faults) {
		t.Errorf("the table names %d faults, not %d", len(faultCatches), len(faults))
	}
	if !hookOnly {
		t.Error("no fault that only the hook catches")
	}
}

// TestListFaultCatches lists every case that catches each fault, and how,
// with -v and GENCMU_FAULTS_LIST set, to choose the cases of the table.
func TestListFaultCatches(t *testing.T) {
	if !testing.Verbose() || os.Getenv("GENCMU_FAULTS_LIST") == "" {
		t.Skip("set GENCMU_FAULTS_LIST and -v to list every catch")
	}
	files, _ := filepath.Glob("../../tests/engine/*.json")
	for _, fault := range faults {
		for _, f := range files {
			if how := catchOf(t, fault, filepath.Base(f)); how != "" {
				t.Logf("%s %s %s", fault, filepath.Base(f), how)
			}
		}
	}
}
