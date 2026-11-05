package gencmu

import (
	"fmt"
	"math"
	"testing"
)

// Case schemas inspect test instructions, not the arbitrary JSON patterns
// or invalid token values that a usage case deliberately supplies.
type caseSchema func(any, string) error

func caseAny(any, string) error { return nil }
func caseString(value any, path string) error {
	if _, ok := value.(string); !ok {
		return fmt.Errorf("%s: expected a string", path)
	}
	return nil
}
func caseNonemptyString(value any, path string) error {
	if err := caseString(value, path); err != nil {
		return err
	}
	if value == "" {
		return fmt.Errorf("%s: expected a nonempty string", path)
	}
	return nil
}
func casePositiveInteger(value any, path string) error {
	if err := caseInteger(value, path); err != nil {
		return err
	}
	if value.(float64) < 1 {
		return fmt.Errorf("%s: expected a positive integer", path)
	}
	return nil
}
func caseBool(value any, path string) error {
	if _, ok := value.(bool); !ok {
		return fmt.Errorf("%s: expected a boolean", path)
	}
	return nil
}
func caseInteger(value any, path string) error {
	if n, ok := value.(float64); !ok || math.Trunc(n) != n {
		return fmt.Errorf("%s: expected an integer", path)
	}
	return nil
}
func caseArray(item caseSchema) caseSchema {
	return func(value any, path string) error {
		values, ok := value.([]any)
		if !ok {
			return fmt.Errorf("%s: expected an array", path)
		}
		for i, value := range values {
			if err := item(value, fmt.Sprintf("%s[%d]", path, i)); err != nil {
				return err
			}
		}
		return nil
	}
}
func caseObject(fields map[string]caseSchema, required ...string) caseSchema {
	return func(value any, path string) error {
		object, ok := value.(map[string]any)
		if !ok {
			return fmt.Errorf("%s: expected an object", path)
		}
		for key, value := range object {
			schema, ok := fields[key]
			if !ok {
				return fmt.Errorf("%s.%s: unknown member", path, key)
			}
			if err := schema(value, path+"."+key); err != nil {
				return err
			}
		}
		for _, key := range required {
			if _, ok := object[key]; !ok {
				return fmt.Errorf("%s.%s: missing member", path, key)
			}
		}
		return nil
	}
}

var optionsSchema = caseObject(map[string]caseSchema{
	"features": caseArray(caseString), "withoutFeatures": caseArray(caseString),
	"elisionOnly": caseBool, "until": caseNonemptyString,
})
var expectSchema = caseObject(map[string]caseSchema{
	"message": caseString, "diagnostic": caseString, "error": caseString, "brackets": caseString,
	"result":   func(value any, _ string) error { return resultPatternProblem(value) },
	"warnings": caseArray(caseAny), "features": caseArray(caseAny),
	"enabledFeatures": caseArray(caseString), "bundledPipelines": caseArray(caseString),
	"where": caseObject(map[string]caseSchema{"document": caseString, "line": caseInteger, "column": caseInteger}),
})

func tokenSchema(usage bool) caseSchema {
	return func(value any, path string) error {
		tokens, ok := value.([]any)
		if !ok {
			return fmt.Errorf("%s: expected an array", path)
		}
		type entry struct {
			value any
			path  *jsonPath
		}
		pending := []entry{}
		root := &jsonPath{step: path}
		for i, value := range tokens {
			pending = append(pending, entry{value, root.index(i)})
		}
		fields := map[string]caseSchema{"text": caseString, "tags": caseArray(caseString), "value": caseString, "image": caseString}
		pair := func(value any, path string) error {
			if err := caseArray(caseInteger)(value, path); err != nil {
				return err
			}
			if len(value.([]any)) != 2 {
				return fmt.Errorf("expected two coordinates")
			}
			return nil
		}
		fields["span"], fields["source"] = pair, pair
		for len(pending) > 0 {
			part := pending[len(pending)-1]
			pending = pending[:len(pending)-1]
			object, ok := part.value.(map[string]any)
			if !ok {
				return fmt.Errorf("%s: expected a token object", part.path)
			}
			if !usage {
				for _, key := range []string{"text", "tags"} {
					if _, ok := object[key]; !ok {
						return fmt.Errorf("%s.%s: missing member", part.path, key)
					}
				}
			}
			for key, value := range object {
				if key == "before" || key == "after" {
					values, ok := value.([]any)
					if !ok {
						if usage {
							continue
						}
						return fmt.Errorf("%s.%s: expected an array", part.path, key)
					}
					for i, child := range values {
						pending = append(pending, entry{child, part.path.member(key).index(i)})
					}
					continue
				}
				schema, known := fields[key]
				if !known {
					return fmt.Errorf("%s.%s: unknown member", part.path, key)
				}
				if !usage {
					if err := schema(value, ""); err != nil {
						return fmt.Errorf("%s.%s: %w", part.path, key, err)
					}
				}
			}
		}
		return nil
	}
}

func caseExpectsUsage(object map[string]any) bool {
	groups := []any{object}
	if parses, ok := object["parses"].([]any); ok {
		groups = append(groups, parses...)
	}
	for _, group := range groups {
		if group, ok := group.(map[string]any); ok {
			if expect, ok := group["expect"].(map[string]any); ok && expect["error"] == ErrorUsage {
				return true
			}
		}
	}
	return false
}

func engineCaseSchema(value any) error {
	object, ok := value.(map[string]any)
	if !ok {
		return fmt.Errorf("case: expected an object")
	}
	usage := caseExpectsUsage(object)
	documents := func(value any, path string) error {
		object, ok := value.(map[string]any)
		if !ok {
			return fmt.Errorf("%s: expected an object", path)
		}
		for key, value := range object {
			if err := caseString(value, path+"."+key); err != nil {
				return err
			}
		}
		return nil
	}
	schema := caseObject(map[string]caseSchema{
		"description": caseString, "pipeline": caseString, "grammar": caseString, "documents": documents,
		"pipelineDocument": caseString, "input": caseString, "tokens": tokenSchema(usage),
		"options": optionsSchema, "expect": expectSchema,
		"parses": caseArray(caseObject(map[string]caseSchema{"options": optionsSchema, "expect": expectSchema}, "expect")),
		// Tree listing is a JavaScript-only operation. Go still inspects its case fields.
		"treeRendering": caseObject(map[string]caseSchema{"aliases": caseArray(caseString), "text": caseString, "decodedError": caseString}),
	})
	if err := schema(value, "case"); err != nil {
		return err
	}
	sources := 0
	for _, key := range []string{"pipeline", "grammar", "documents"} {
		if _, ok := object[key]; ok {
			sources++
		}
	}
	if sources != 1 {
		return fmt.Errorf("case: expected exactly one grammar source")
	}
	_, documentsPresent := object["documents"]
	_, documentPresent := object["pipelineDocument"]
	if documentsPresent != documentPresent {
		return fmt.Errorf("case: documents and pipelineDocument must occur together")
	}
	if parses, present := object["parses"]; present {
		if len(parses.([]any)) == 0 {
			return fmt.Errorf("case.parses: expected a nonempty array")
		}
		for _, key := range []string{"expect", "options"} {
			if _, present := object[key]; present {
				return fmt.Errorf("case.%s does not apply beside parses", key)
			}
		}
	}
	return nil
}

func notationCaseSchema(value any) error {
	schema := caseObject(map[string]caseSchema{
		"description": caseString, "document": caseString, "cacheMisses": caseBool,
		"expect": caseObject(map[string]caseSchema{"dom": caseAny, "error": caseObject(map[string]caseSchema{"line": casePositiveInteger, "column": casePositiveInteger, "message": caseString}, "line", "column")}),
	}, "document", "expect")
	if err := schema(value, "case"); err != nil {
		return err
	}
	expect := value.(map[string]any)["expect"].(map[string]any)
	if len(expect) != 1 {
		return fmt.Errorf("case.expect: expected exactly one of dom and error")
	}
	return nil
}

func notationValuesSchema(value any) error {
	expectSchema := func(value any, path string) error {
		schema := caseObject(map[string]caseSchema{
			"dom": caseAny, "message": caseString,
			"error": caseObject(map[string]caseSchema{"line": caseInteger, "column": caseInteger}, "line", "column"),
		})
		if err := schema(value, path); err != nil {
			return err
		}
		expect := value.(map[string]any)
		_, hasDOM := expect["dom"]
		_, hasError := expect["error"]
		if hasDOM == hasError {
			return fmt.Errorf("%s: expected exactly one of dom and error", path)
		}
		if _, message := expect["message"]; message && !hasError {
			return fmt.Errorf("%s.message requires an error expectation", path)
		}
		return nil
	}
	aliasSchema := caseObject(map[string]caseSchema{
		"spelling": caseString, "value": caseString, "tags": caseArray(caseString),
	}, "spelling", "value", "tags")
	schema := caseObject(map[string]caseSchema{
		"description": caseString,
		"cases": caseArray(caseObject(map[string]caseSchema{
			"id": caseString, "description": caseString, "document": caseString,
			"aliases": caseArray(aliasSchema), "expect": expectSchema,
		}, "id", "document", "aliases", "expect")),
	}, "cases")
	return schema(value, "notation values")
}

func memoRunsSchema(value any) error {
	runSchema := caseObject(map[string]caseSchema{
		"pipeline": caseString, "grammar": caseString, "texts": caseArray(caseString),
		"inputs": caseArray(tokenSchema(false)), "options": caseArray(optionsSchema),
	}, "options")
	schema := caseObject(map[string]caseSchema{
		"description": caseString, "runs": caseArray(runSchema),
	}, "runs")
	return schema(value, "memo runs")
}

func resultPatternProblem(pattern any) error {
	type entry struct {
		value   any
		inError bool
	}
	pending := []entry{{pattern, false}}
	for len(pending) > 0 {
		part := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		switch value := part.value.(type) {
		case map[string]any:
			if _, present := value["message"]; part.inError && present {
				return fmt.Errorf("a result pattern cannot assert an error message. Use expect.message")
			}
			for key, child := range value {
				pending = append(pending, entry{child, key != "errors" && (part.inError || key == "error")})
			}
		case []any:
			for _, child := range value {
				pending = append(pending, entry{child, part.inError})
			}
		}
	}
	return nil
}

func TestNotationErrorPositionsRequired(t *testing.T) {
	for _, position := range []string{`{}`, `{"line":2}`, `{"column":15}`, `{"line":0,"column":15}`} {
		value, err := decodeJSON([]byte(`{"document":"","expect":{"error":` + position + `}}`))
		if err != nil {
			t.Fatal(err)
		}
		if err := notationCaseSchema(value); err == nil {
			t.Errorf("accepted incomplete position %s", position)
		}
	}
}

func TestOptionsRequireNonemptyUntil(t *testing.T) {
	if err := optionsSchema(map[string]any{"until": ""}, "options"); err == nil {
		t.Error("accepted an empty stage name")
	}
	for _, value := range []map[string]any{{}, {"until": "main"}} {
		if err := optionsSchema(value, "options"); err != nil {
			t.Fatal(err)
		}
	}
}
