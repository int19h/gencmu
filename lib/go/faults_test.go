package gencmu

import (
	"path/filepath"
	"testing"
)

// The faults of this library's own paths in the check of elision-only
// (tests/README.md, privateOptions.fault): with each one on, the shared
// engine cases that the table names fail.
var faultCatches = map[string][]string{
	"reprocess":        {"reparse-strict-reclose-late.json"},
	"route3":           {"reparse-strict-nested-route.json", "reparse-synthetic-suffix-empty.json"},
	"restore":          {"reparse-incompatible-optional-sound.json"},
	"rank-restoration": {"reparse-witness-hook-only.json", "elision-only-passes.json"},
}

func TestFaultsAreCaught(t *testing.T) {
	for fault, files := range faultCatches {
		for _, file := range files {
			c := loadCase(t, filepath.Join("../../tests/engine", file))
			c.fault = fault
			if err := checkCase(c, true); err == nil {
				t.Errorf("%s does not catch %s", file, fault)
			} else if testing.Verbose() {
				t.Logf("%s catches %s: %.200v", file, fault, err)
			}
		}
	}
}
