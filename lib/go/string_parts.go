package gencmu

import "strings"

// stringParts shares concatenation prefixes without copying their text.
// A requested output string is flattened once, with an explicit stack.
type stringParts struct {
	text     string
	children []*stringParts
	size     int
}

func literalParts(text string) *stringParts { return &stringParts{text: text, size: len(text)} }

func concatParts(parts []*stringParts) *stringParts {
	if len(parts) == 1 {
		return parts[0]
	}
	result := &stringParts{children: parts}
	for _, part := range parts {
		result.size += part.size
	}
	return result
}

func partsText(root *stringParts) string {
	if len(root.children) == 0 {
		return root.text
	}
	var out strings.Builder
	out.Grow(root.size)
	stack := []*stringParts{root}
	for len(stack) > 0 {
		part := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		out.WriteString(part.text)
		for i := len(part.children) - 1; i >= 0; i-- {
			stack = append(stack, part.children[i])
		}
	}
	return out.String()
}
