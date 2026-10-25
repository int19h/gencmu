package gencmu

import (
	"encoding/json"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

type propertyData struct {
	kind     string
	values   map[string]bool
	defaults []string
	ranges   []propertyRange
	line     int
}

type propertyRange struct {
	first, last rune
	values      []string
	line        int
}

type propertyCatalogData struct {
	Types     map[string]string
	Values    map[string][]string
	Aliases   map[string]string
	Tags      map[string][]string
	Core      []string
	Combining map[string]string
}

var propertyInventory = func() propertyCatalogData {
	var data propertyCatalogData
	if err := json.Unmarshal([]byte(propertyCatalog), &data); err != nil {
		panic(err)
	}
	return data
}()

var propertyVersion = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+$`)

func propertyError(line int) error {
	return &Error{Kind: ErrorGrammar, Document: "unicode-properties.txt", Line: line, Message: "the property record is invalid"}
}

func parseProperties(text string, core *unicodeTable) (map[string]*propertyData, error) {
	if !utf8.ValidString(text) {
		return nil, &Error{Kind: ErrorGrammar, Document: "unicode-properties.txt", Message: "the resource bytes do not decode as UTF-8"}
	}
	properties := map[string]*propertyData{}
	type record struct {
		fields []string
		line   int
	}
	var pending []record
	header := false
	lines := strings.Split(text, "\n")
	for index, raw := range lines {
		line := index + 1
		if index < len(lines)-1 {
			raw = strings.TrimSuffix(raw, "\r")
		}
		fields := strings.FieldsFunc(raw, func(c rune) bool { return c == ' ' || c == '\t' })
		if len(fields) == 0 {
			continue
		}
		if !header {
			if len(fields) != 2 || fields[0] != "unicode-properties" || !propertyVersion.MatchString(fields[1]) || core.versionCount != 1 || core.version != fields[1] {
				return nil, propertyError(line)
			}
			header = true
			continue
		}
		if len(fields) < 2 || propertyInventory.Types[fields[1]] == "" || slices.Contains(propertyInventory.Core, fields[1]) {
			return nil, propertyError(line)
		}
		kind, name := fields[0], fields[1]
		switch kind {
		case "binary", "enumerated", "multiple":
			if kind != propertyInventory.Types[name] || properties[name] != nil || kind == "binary" && len(fields) != 2 || kind == "enumerated" && len(fields) != 3 || kind == "multiple" && len(fields) < 3 {
				return nil, propertyError(line)
			}
			defaults := slices.Clone(fields[2:])
			slices.Sort(defaults)
			if len(slices.Compact(slices.Clone(defaults))) != len(defaults) {
				return nil, propertyError(line)
			}
			properties[name] = &propertyData{kind: kind, values: map[string]bool{}, defaults: defaults, line: line}
		case "value", "range":
			pending = append(pending, record{fields, line})
		default:
			return nil, propertyError(line)
		}
	}
	if !header {
		return nil, propertyError(0)
	}
	for _, row := range pending {
		fields, line := row.fields, row.line
		prop := properties[fields[1]]
		if prop == nil {
			return nil, propertyError(line)
		}
		if fields[0] == "value" {
			if len(fields) != 3 || prop.kind == "binary" || !slices.Contains(propertyInventory.Values[fields[1]], fields[2]) || prop.values[fields[2]] {
				return nil, propertyError(line)
			}
			prop.values[fields[2]] = true
			continue
		}
		if prop.kind == "binary" && len(fields) != 4 || prop.kind == "enumerated" && len(fields) != 5 || prop.kind == "multiple" && len(fields) < 5 {
			return nil, propertyError(line)
		}
		var codes [2]rune
		for i, field := range fields[2:4] {
			digits := strings.TrimLeft(field, "0")
			if field == "" || len(digits) > 6 || strings.IndexFunc(field, func(c rune) bool { return !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F') }) >= 0 {
				return nil, propertyError(line)
			}
			if digits == "" {
				digits = "0"
			}
			code, err := strconv.ParseUint(digits, 16, 32)
			if err != nil || code > 0x10ffff {
				return nil, propertyError(line)
			}
			codes[i] = rune(code)
		}
		if codes[0] > codes[1] || codes[0] <= 0xdfff && codes[1] >= 0xd800 {
			return nil, propertyError(line)
		}
		values := slices.Clone(fields[4:])
		if prop.kind == "binary" {
			values = []string{"Yes"}
		}
		slices.Sort(values)
		if len(slices.Compact(slices.Clone(values))) != len(values) {
			return nil, propertyError(line)
		}
		prop.ranges = append(prop.ranges, propertyRange{codes[0], codes[1], values, line})
	}
	for _, prop := range properties {
		for _, value := range prop.defaults {
			if !prop.values[value] {
				return nil, propertyError(prop.line)
			}
		}
		slices.SortFunc(prop.ranges, func(a, b propertyRange) int {
			if a.first != b.first {
				return int(a.first - b.first)
			}
			if a.last != b.last {
				return int(a.last - b.last)
			}
			return a.line - b.line
		})
		var merged []propertyRange
		for _, row := range prop.ranges {
			if prop.kind != "binary" {
				for _, value := range row.values {
					if !prop.values[value] {
						return nil, propertyError(row.line)
					}
				}
			}
			if len(merged) > 0 {
				previous := &merged[len(merged)-1]
				equal := slices.Equal(previous.values, row.values)
				if row.first <= previous.last && !equal {
					return nil, propertyError(row.line)
				}
				if row.first <= previous.last+1 && equal {
					previous.last = max(previous.last, row.last)
					continue
				}
			}
			merged = append(merged, row)
		}
		prop.ranges = merged
	}
	return properties, nil
}

func (t *unicodeTable) canonicalTag(spelling string) string {
	canonical, ok := propertyInventory.Aliases[spelling]
	if !ok {
		return ""
	}
	identity := propertyInventory.Tags[canonical]
	if slices.Contains(propertyInventory.Core, identity[0]) {
		return canonical
	}
	data := t.properties[identity[0]]
	if data != nil && (data.kind == "binary" || data.values[identity[1]]) {
		return canonical
	}
	return ""
}

func (t *unicodeTable) profile(code rune) []string {
	category := t.category(code)
	tags := []string{propertyInventory.Aliases["_"+category], propertyInventory.Aliases["_"+category[:1]], propertyInventory.Combining[strconv.Itoa(t.combiningClass(code))]}
	if t.isWhiteSpace(code) {
		tags = append(tags, "_White_Space")
	}
	for _, prop := range []string{"Emoji_Presentation", "Emoji_Component"} {
		if t.hasProperty(prop, code) {
			tags = append(tags, "_"+prop)
		}
	}
	for prop, data := range t.properties {
		i := sort.Search(len(data.ranges), func(i int) bool { return data.ranges[i].first > code })
		values := data.defaults
		if i > 0 && code <= data.ranges[i-1].last {
			values = data.ranges[i-1].values
		}
		if data.kind == "binary" {
			if len(values) > 0 {
				tags = append(tags, "_"+prop)
			}
		} else {
			for _, value := range values {
				tags = append(tags, "_"+prop+"_"+value)
			}
		}
	}
	sort.Strings(tags)
	return tags
}
