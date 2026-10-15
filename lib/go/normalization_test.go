package gencmu

import (
	"os"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

func normalizationTable(t *testing.T) *unicodeTable {
	t.Helper()
	data, err := bundledFS.ReadFile("grammars/unicode.txt")
	if err != nil {
		t.Fatal(err)
	}
	table, err := parseUnicodeTable(string(data))
	if err != nil {
		t.Fatal(err)
	}
	return table
}

func TestNormalizationConformance(t *testing.T) {
	t.Parallel()
	table := normalizationTable(t)
	data, err := os.ReadFile("../../tests/unicode/NormalizationTest.txt")
	if err != nil {
		t.Fatal(err)
	}
	listed := map[rune]bool{}
	part, count := "", 0
	for lineNumber, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(strings.SplitN(line, "#", 2)[0])
		if strings.HasPrefix(line, "@") {
			part = strings.Fields(line)[0]
			continue
		}
		if line == "" {
			continue
		}
		fields := strings.Split(line, ";")
		var columns [5]string
		for i := range columns {
			var scalars []rune
			for _, field := range strings.Fields(fields[i]) {
				value, err := strconv.ParseUint(field, 16, 32)
				if err != nil {
					t.Fatal(err)
				}
				scalars = append(scalars, rune(value))
			}
			columns[i] = string(scalars)
		}
		for i, column := range columns {
			target := 2
			if i >= 3 {
				target = 4
			}
			if got := table.decompose(column); got != columns[target] {
				t.Fatalf("line %d column %d: %U, want %U", lineNumber+1, i+1, []rune(got), []rune(columns[target]))
			}
		}
		if part == "@Part1" {
			listed[[]rune(columns[0])[0]] = true
		}
		count++
	}
	if count != 19074 {
		t.Fatalf("data rows: %d, want 19074", count)
	}
	for code := rune(0); code <= 0x10ffff; code++ {
		if code >= 0xd800 && code <= 0xdfff || listed[code] {
			continue
		}
		if got := table.decompose(string(code)); got != string(code) {
			t.Fatalf("unlisted U+%04X decomposes to %U", code, []rune(got))
		}
	}
}

func TestNormalizationOriginsAndCustomTable(t *testing.T) {
	t.Parallel()
	table := normalizationTable(t)
	got := table.decomposeWithOrigins([]rune("á\u0323\u0300\u034f\u0315\u0301"))
	want := []decomposedScalar{{'a', 0, 0}, {'\u0323', 1, 220}, {'\u0301', 0, 230}, {'\u0300', 2, 230}, {'\u034f', 3, 0}, {'\u0301', 5, 230}, {'\u0315', 4, 232}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("origins: %#v, want %#v", got, want)
	}
	if got := table.decompose("ﬁ²Ｋ"); got != "ﬁ²Ｋ" {
		t.Fatalf("compatibility decomposition: %q", got)
	}
	custom, err := parseUnicodeTable("combining 230 0301 0301\ndecompose 00E9 0065 0301\ncombining 220 0323 0323\n")
	if err != nil {
		t.Fatal(err)
	}
	if got := custom.decompose("é\u0323á각"); got != "e\u0323\u0301á각" {
		t.Fatalf("custom: %U", []rune(got))
	}
	empty, err := parseUnicodeTable("")
	if err != nil {
		t.Fatal(err)
	}
	if got := empty.decompose("éa\u0301\u0323각"); got != "éa\u0301\u0323각" {
		t.Fatalf("empty table: %U", []rune(got))
	}
}

func TestNormalizationRecordOrderAndDefaults(t *testing.T) {
	t.Parallel()
	data, err := bundledFS.ReadFile("grammars/unicode.txt")
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(string(data), "\n")
	for a, b := 0, len(lines)-1; a < b; a, b = a+1, b-1 {
		lines[a], lines[b] = lines[b], lines[a]
	}
	reversed, err := parseUnicodeTable(strings.Join(lines, "\n"))
	if err != nil {
		t.Fatal(err)
	}
	table := normalizationTable(t)
	if !reflect.DeepEqual(reversed.categories, table.categories) || !reflect.DeepEqual(reversed.whiteSpace, table.whiteSpace) || !reflect.DeepEqual(reversed.decompositions, table.decompositions) || !reflect.DeepEqual(reversed.combining, table.combining) {
		t.Fatal("record order changed the table")
	}
	noClasses, err := parseUnicodeTable("decompose 00E1 0061 0301\n")
	if err != nil {
		t.Fatal(err)
	}
	if got := noClasses.decompose("á\u0323"); got != "a\u0301\u0323" {
		t.Fatalf("missing classes reordered marks: %U", []rune(got))
	}
	noMappings, err := parseUnicodeTable("combining 230 0301 0301\ncombining 220 0323 0323\n")
	if err != nil {
		t.Fatal(err)
	}
	if got := noMappings.decompose("á\u0323a\u0301\u0323"); got != "á\u0323a\u0323\u0301" {
		t.Fatalf("missing mappings: %U", []rune(got))
	}
}
