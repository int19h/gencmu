package gencmu

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Places in the shared fixtures (tests/README.md, "Places in fixtures").

// anyPosition stands, in a fixture's find and replace, for a source
// position of any value.
const anyPosition = `"at":[*]`

var positionAt = regexp.MustCompile(`^"at":\[(\d+,\d+)\]`)

// fixturePlace is a place where a fixture's find stands, with the
// positions that its wildcards stand for, as "LINE,COLUMN".
type fixturePlace struct {
	start, end int
	positions  []string
}

// findPlaces gives every place where find stands in text.
func findPlaces(text, find string) []fixturePlace {
	pieces := strings.Split(find, anyPosition)
	var places []fixturePlace
	for from := 0; from <= len(text); from++ {
		offset := strings.Index(text[from:], pieces[0])
		if offset < 0 {
			break
		}
		start := from + offset
		from = start
		at := start + len(pieces[0])
		var positions []string
		for _, piece := range pieces[1:] {
			found := positionAt.FindStringSubmatch(text[at:])
			if found == nil || !strings.HasPrefix(text[at+len(found[0]):], piece) {
				break
			}
			positions = append(positions, found[1])
			at += len(found[0]) + len(piece)
		}
		if len(positions) == len(pieces)-1 {
			places = append(places, fixturePlace{start, at, positions})
		}
	}
	return places
}

// substitute replaces the first place of find in text with replace, whose
// wildcards take the positions of those of find, in order.
func substitute(text, find, replace string) (string, error) {
	places := findPlaces(text, find)
	if len(places) == 0 {
		return "", fmt.Errorf("the fixture's find is not in the text: %s", find)
	}
	place := places[0]
	pieces := strings.Split(replace, anyPosition)
	if len(pieces)-1 > len(place.positions) {
		return "", fmt.Errorf("the fixture's replace has more wildcards than its find: %s", replace)
	}
	var b strings.Builder
	b.WriteString(text[:place.start])
	b.WriteString(pieces[0])
	for index, piece := range pieces[1:] {
		b.WriteString(`"at":[` + place.positions[index] + `]`)
		b.WriteString(piece)
	}
	b.WriteString(text[place.end:])
	return b.String(), nil
}

// positionOf gives the line and column, counted from 1, where needle
// stands in text, which must hold it exactly once. A line ends at CR LF,
// CR or LF, and a column counts code points.
func positionOf(text, needle string) (int, int, error) {
	first := strings.Index(text, needle)
	if first < 0 || strings.Contains(text[first+1:], needle) {
		return 0, 0, fmt.Errorf("%q does not stand exactly once in the document", needle)
	}
	before := strings.ReplaceAll(strings.ReplaceAll(text[:first], "\r\n", "\n"), "\r", "\n")
	lineStart := strings.LastIndex(before, "\n") + 1
	return strings.Count(before, "\n") + 1, utf8.RuneCountInString(before[lineStart:]) + 1, nil
}
