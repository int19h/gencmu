package gencmu

import "testing"

// A written optional can block an earlier omission even when its later
// continuation fails. Capture expansion must keep that helper query (§4).
func TestCapturedOptionalQueryPriority(t *testing.T) {
	for _, optional := range []string{"[b]", "[$b:b]"} {
		grammar := `%rule text $all:run
%conditions ¬$all.begins(r)
%rule run { _ }
%rule r "a" ` + optional + ` [+T] "u"
%rule b "u" "b"`
		d, err := caseDialect(&engineCase{Grammar: &grammar}, true)
		if err != nil {
			t.Fatal(err)
		}
		tokens := []InputToken{{Text: "a"}, {Text: "u"}, {Text: "b"}, {Text: "t", Tags: []string{"T"}}, {Text: "w"}}
		for i := range tokens {
			tokens[i].Span = [2]int{i, i + 1}
			tokens[i].Source = [2]int{i, i + 1}
		}
		result, err := d.ParseTokens("aubtw", tokens, ParseOptions{NoAutoFeatures: true})
		if err != nil || !result.OK {
			t.Fatalf("%s: %v %v", optional, err, result.Error)
		}
	}
}

func TestStackedOmissionPredicates(t *testing.T) {
	grammar := `%rule text [+T<U>="saved"] %emits`
	d, err := caseDialect(&engineCase{Grammar: &grammar}, true)
	if err != nil {
		t.Fatal(err)
	}
	result, err := d.Parse("", ParseOptions{})
	if err != nil || result.OK || result.Error.Kind != ErrorRejected {
		t.Fatalf("an omitted T lacks U: %v %+v", err, result)
	}
	value := "saved"
	result, err = d.ParseTokens("t", []InputToken{{Text: "t", Value: &value, Tags: []string{"T", "U"}, Span: [2]int{0, 1}, Source: [2]int{0, 1}}}, ParseOptions{})
	if err != nil || !result.OK {
		t.Fatalf("a written T carrying U passes both predicates: %v %+v", err, result)
	}
}
