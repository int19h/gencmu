package gencmu

import (
	"sort"
	"strings"
)

// A pipeline: the items of a pipeline document, with each %include replaced
// by the items of the document it names, split into stages at each %stage
// (engine §13).

// docItem is an item of a document: a rule, a directive, a constant's
// definition, a classifier or an implication.
type docItem struct {
	rule        *domRule
	dir         *domDirective
	constant    *domConst
	classifier  *domClassifier
	implication *domImplication
}

func (it docItem) at() [2]int {
	switch {
	case it.rule != nil:
		return it.rule.At
	case it.constant != nil:
		return it.constant.At
	case it.classifier != nil:
		return it.classifier.At
	case it.implication != nil:
		return it.implication.At
	}
	return it.dir.At
}

// itemsInOrder lists a document's rules, directives, constants,
// classifiers and implications in the order they were written, which is
// the order of their positions (engine §9).
func itemsInOrder(dom *domDoc) []docItem {
	items := make([]docItem, 0, len(dom.Rules)+len(dom.Directives)+len(dom.Constants)+len(dom.Classifiers)+len(dom.Implications))
	for _, r := range dom.Rules {
		items = append(items, docItem{rule: r})
	}
	for _, d := range dom.Directives {
		items = append(items, docItem{dir: d})
	}
	for _, k := range dom.Constants {
		items = append(items, docItem{constant: k})
	}
	for _, c := range dom.Classifiers {
		items = append(items, docItem{classifier: c})
	}
	for _, m := range dom.Implications {
		items = append(items, docItem{implication: m})
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

	// The documents being spliced, outermost first, and the same as a set.
	// The trail of includes is joined only for an error, so a deep chain
	// of includes costs its depth, not its square.
	var through []string
	inChain := map[string]bool{}
	stageNamed := map[string]*splicedStage{}
	var splice func(docPath string, dom *domDoc) *Error
	splice = func(docPath string, dom *domDoc) *Error {
		through = append(through, docPath)
		inChain[docPath] = true
		defer func() {
			through = through[:len(through)-1]
			delete(inChain, docPath)
		}()
		for _, item := range itemsInOrder(dom) {
			at := item.at()
			switch {
			case item.dir != nil && item.dir.Name == "include":
				target := resolvePath(docPath, item.dir.Args[0])
				trail := func() string {
					return strings.Join(append(append([]string{}, through...), target), " → ")
				}
				if w := work.Load(); w != nil {
					w.spliceSteps.add("splice steps")
				}
				if inChain[target] {
					return grammarError(docPath, at, "%s includes itself (%s)", target, trail())
				}
				included, err := domOf(target)
				if err != nil {
					if s := current(); s != nil && err.Stage == "" {
						err.Stage = s.name
					}
					return err
				}
				if included == nil {
					return grammarError(docPath, at, "%s was not found (%s)", target, trail())
				}
				run = nil
				if err := splice(target, included); err != nil {
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
				if w := work.Load(); w != nil {
					w.spliceSteps.add("splice steps")
				}
				if s := stageNamed[name]; s != nil {
					return grammarError(docPath, at, "a second stage named %s; the first is at %s:%d:%d", name, s.doc, s.at[0], s.at[1])
				}
				stageNamed[name] = &splicedStage{name: name, doc: docPath, at: at}
				p.stages = append(p.stages, stageNamed[name])
				run = nil
			default:
				s := current()
				if s == nil {
					if item.rule != nil {
						return grammarError(docPath, at, "the rule %s stands before the first %%stage", item.rule.Name)
					}
					if item.constant != nil {
						return grammarError(docPath, at, "the constant $%s stands before the first %%stage", item.constant.Name)
					}
					if item.classifier != nil {
						return grammarError(docPath, at, "the classifier %s stands before the first %%stage", item.classifier.Name)
					}
					if item.implication != nil {
						return grammarError(docPath, at, "%%implies stands before the first %%stage")
					}
					return grammarError(docPath, at, "%%%s stands before the first %%stage", item.dir.Name)
				}
				if run == nil || runPath != docPath {
					run, runPath = &domDoc{Rules: []*domRule{}, Directives: []*domDirective{}, Constants: []*domConst{}, Classifiers: []*domClassifier{}, Implications: []*domImplication{}}, docPath
					s.documents = append(s.documents, docDOM{path: docPath, dom: run})
				}
				switch {
				case item.rule != nil:
					run.Rules = append(run.Rules, item.rule)
				case item.constant != nil:
					run.Constants = append(run.Constants, item.constant)
				case item.classifier != nil:
					run.Classifiers = append(run.Classifiers, item.classifier)
				case item.implication != nil:
					run.Implications = append(run.Implications, item.implication)
				default:
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
	if err := splice(pipelinePath, top); err != nil {
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
