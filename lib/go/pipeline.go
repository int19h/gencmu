package gencmu

import (
	"sort"
	"strings"
)

// A pipeline: the items of a pipeline document, with each %include replaced
// by the items of the document it names, split into stages at each %stage
// (engine §13).

// docItem is an item of a document: a rule or a directive.
type docItem struct {
	rule *domRule
	dir  *domDirective
}

func (it docItem) at() [2]int {
	if it.rule != nil {
		return it.rule.At
	}
	return it.dir.At
}

// itemsInOrder lists a document's rules and directives in the order they
// were written, which is the order of their positions (engine §9).
func itemsInOrder(dom *domDoc) []docItem {
	items := make([]docItem, 0, len(dom.Rules)+len(dom.Directives))
	for _, r := range dom.Rules {
		items = append(items, docItem{rule: r})
	}
	for _, d := range dom.Directives {
		items = append(items, docItem{dir: d})
	}
	sort.SliceStable(items, func(i, j int) bool {
		a, b := items[i].at(), items[j].at()
		return a[0] < b[0] || (a[0] == b[0] && a[1] < b[1])
	})
	return items
}

// splicedStage is one stage of a spliced pipeline: its name, where its
// %stage stands, and its items as runs of consecutive items of one
// document, each with a DOM that holds exactly those items.
type splicedStage struct {
	name      string
	doc       string
	at        [2]int
	documents []docDOM
}

type splicedPipeline struct {
	stages   []*splicedStage
	features []string // in code point order
}

// splicePipeline splices the pipeline document at pipelinePath. domOf gives
// a document's DOM, or nil and no error when the document does not exist.
func splicePipeline(pipelinePath string, domOf func(p string) (*domDoc, *Error)) (*splicedPipeline, *Error) {
	p := &splicedPipeline{}
	features := map[string]bool{}
	// The run being built: its DOM and its document.
	var run *domDoc
	runPath := ""
	current := func() *splicedStage {
		if len(p.stages) == 0 {
			return nil
		}
		return p.stages[len(p.stages)-1]
	}

	var splice func(docPath string, dom *domDoc, chain []string) *Error
	splice = func(docPath string, dom *domDoc, chain []string) *Error {
		for _, item := range itemsInOrder(dom) {
			at := item.at()
			switch {
			case item.dir != nil && item.dir.Name == "include":
				target := resolvePath(docPath, item.dir.Args[0])
				through := append(append([]string{}, chain...), docPath)
				trail := strings.Join(append(through, target), " → ")
				for _, c := range through {
					if c == target {
						return grammarError(docPath, at, "%s includes itself (%s)", target, trail)
					}
				}
				included, err := domOf(target)
				if err != nil {
					if s := current(); s != nil && err.Stage == "" {
						err.Stage = s.name
					}
					return err
				}
				if included == nil {
					return grammarError(docPath, at, "%s was not found (%s)", target, trail)
				}
				run = nil
				if err := splice(target, included, through); err != nil {
					return err
				}
				run = nil
			case item.dir != nil && item.dir.Name == "features":
				for _, name := range item.dir.Args {
					if !features[name] {
						features[name] = true
						p.features = append(p.features, name)
					}
				}
			case item.dir != nil && item.dir.Name == "stage":
				name := item.dir.Args[0]
				for _, s := range p.stages {
					if s.name == name {
						return grammarError(docPath, at, "a second stage named %s; the first is at %s:%d:%d", name, s.doc, s.at[0], s.at[1])
					}
				}
				p.stages = append(p.stages, &splicedStage{name: name, doc: docPath, at: at})
				run = nil
			default:
				s := current()
				if s == nil {
					if item.rule != nil {
						return grammarError(docPath, at, "the rule %s stands before the first %%stage", item.rule.Name)
					}
					return grammarError(docPath, at, "%%%s stands before the first %%stage", item.dir.Name)
				}
				if run == nil || runPath != docPath {
					run, runPath = &domDoc{Rules: []*domRule{}, Directives: []*domDirective{}}, docPath
					s.documents = append(s.documents, docDOM{path: docPath, dom: run})
				}
				if item.rule != nil {
					run.Rules = append(run.Rules, item.rule)
				} else {
					run.Directives = append(run.Directives, item.dir)
				}
			}
		}
		return nil
	}

	top, err := domOf(pipelinePath)
	if err != nil {
		return nil, err
	}
	if top == nil {
		return nil, &Error{Kind: ErrorGrammar, Document: pipelinePath, Message: "the pipeline document is missing"}
	}
	if err := splice(pipelinePath, top, nil); err != nil {
		return nil, err
	}
	if len(p.stages) == 0 {
		return nil, &Error{Kind: ErrorGrammar, Document: pipelinePath, Message: "a pipeline needs at least one %stage"}
	}
	for _, s := range p.stages {
		rules := 0
		for _, d := range s.documents {
			rules += len(d.dom.Rules)
		}
		if rules == 0 {
			e := grammarError(s.doc, s.at, "the stage has no rules")
			e.Stage = s.name
			return nil, e
		}
	}
	sort.Strings(p.features)
	return p, nil
}
