package gencmu

import (
	"regexp"
	"slices"
	"strconv"
	"strings"
)

var numericEscapePattern = regexp.MustCompile(`^U\+[0-9A-Fa-f]{4,6}$`)

type documentStrings struct {
	path     string
	uni      *unicodeTable
	names    *namesScope
	position func(int) [2]int
}

func (d *documentStrings) inspect(tokens []Token) *Error {
	for _, token := range tokens {
		path := slices.Contains(token.Tags, "Include-Path")
		if path || slices.Contains(token.Tags, "String") {
			if _, err := d.decode(token, path); err != nil {
				return err
			}
		}
	}
	return nil
}
func (d *documentStrings) decode(token Token, path bool) (string, *Error) {
	source := []rune(token.Text)
	var result, literal strings.Builder
	flush := func() {
		if path {
			result.WriteString(literal.String())
		} else {
			result.WriteString(d.uni.decompose(literal.String()))
		}
		literal.Reset()
	}
	for index := 1; index < len(source)-1; index++ {
		if source[index] != '‹' {
			literal.WriteRune(source[index])
			continue
		}
		flush()
		opening := index
		fail := func() *Error {
			return grammarError(d.path, d.position(token.Source[0]+opening), "an invalid or unknown string escape")
		}
		start := index + 1
		for index++; index < len(source)-1 && source[index] != '›'; index++ {
			if source[index] == '"' || source[index] == '\n' || source[index] == '\r' {
				return "", fail()
			}
		}
		if index >= len(source)-1 || source[index] != '›' || index == start {
			return "", fail()
		}
		name := string(source[start:index])
		var code rune
		if strings.HasPrefix(name, "U+") {
			if !numericEscapePattern.MatchString(name) {
				return "", fail()
			}
			n, err := strconv.ParseUint(name[2:], 16, 32)
			if err != nil || n > 0x10ffff || n >= 0xd800 && n <= 0xdfff {
				return "", fail()
			}
			code = rune(n)
		} else {
			value, ok, err := d.names.lookup(name, false)
			if err != nil {
				return "", err
			}
			if !ok {
				return "", fail()
			}
			code = value
		}
		result.WriteRune(code)
	}
	flush()
	return result.String(), nil
}
