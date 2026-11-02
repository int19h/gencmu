package gencmu

// restoreRecipeLocations reads source positions only after a cached cycle
// failure. It does not replace the cached definitions or their recipes (§8).
func (nr *notationReader) restoreRecipeLocations(text, document string, cached *domDoc, names ...*namesScope) {
	source, err := nr.readMode(text, document, true, names...)
	if err != nil {
		return
	}
	type declaration struct {
		name, op string
		at       [2]int
	}
	written := map[declaration]*domRule{}
	for _, rule := range source.Rules {
		written[declaration{rule.Name, rule.Op, rule.At}] = rule
	}
	copyPosition := func(recipe, original *domTerm) {
		if recipe != nil && original != nil {
			recipe.At = original.At
		}
	}
	for _, rule := range cached.Rules {
		original := written[declaration{rule.Name, rule.Op, rule.At}]
		if original == nil {
			continue
		}
		copyPosition(rule.Value, original.Value)
		copyPosition(rule.Image, original.Image)
		for index, alternative := range rule.Alternatives {
			if index < len(original.Alternatives) {
				copyPosition(alternative.Value, original.Alternatives[index].Value)
				copyPosition(alternative.Image, original.Alternatives[index].Image)
			}
		}
	}
}
