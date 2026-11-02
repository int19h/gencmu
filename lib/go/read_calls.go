package gencmu

import "strings"

func (b *domBuilder) parameter(n *Node) *domTerm {
	b.unresolved = true
	name := strings.TrimPrefix(b.tokenValue(b.token(n)), "@")
	if !b.readingHead && !b.parameters[name] {
		b.fail(n, "undeclared parameter @%s", name)
	}
	return &domTerm{Kind: tmParam, Str: name, At: b.at(n)}
}

type sourceCallFrame struct {
	n     *Node
	parts []*Node
	call  *domSourceCall
}

func (f *sourceCallFrame) resume(b *domBuilder, in any) readStep {
	if f.call == nil {
		b.unresolved = true
		f.call = &domSourceCall{Name: b.tokenValue(b.token(f.n)), At: b.at(f.n), Args: []*domArgument{}}
		f.parts = b.some(f.n, "call-argument", 1)
	} else {
		f.call.Args = append(f.call.Args, in.(*domArgument))
	}
	if len(f.call.Args) < len(f.parts) {
		return ask(&sourceArgumentFrame{n: f.parts[len(f.call.Args)]})
	}
	return give(f.call)
}

type sourceArgumentFrame struct {
	n       *Node
	part    *Node
	targets []*Node
	value   *domArgument
}

func (f *sourceArgumentFrame) resume(b *domBuilder, in any) readStep {
	if f.part == nil {
		f.part = b.knownOf(f.n, []string{"requirement-argument", "target-argument", "body-argument", "symbol-argument", "term"})
		switch f.part.Rule {
		case "requirement-argument":
			return give(&domArgument{Requirements: b.requirements(f.part)})
		case "target-argument":
			f.value = &domArgument{Targets: []*domTerm{}}
			f.targets = b.ruleParts(f.part)
		case "body-argument", "symbol-argument":
			return ask(&exprFrame{n: b.knownOf(f.part, primaryRules), whole: true})
		default:
			return ask(&termFrame{n: f.part, argument: true})
		}
	} else {
		switch f.part.Rule {
		case "body-argument", "symbol-argument":
			return give(sourceArgument(in.(*domExpr)))
		case "target-argument":
			if call, ok := in.(*domSourceCall); ok {
				f.value.Targets = append(f.value.Targets, &domTerm{Kind: tmSourceCall, Call: call, At: call.At})
			}
		default:
			return give(&domArgument{Term: in.(*domTerm)})
		}
	}
	for len(f.value.Targets) < len(f.targets) {
		target := f.targets[len(f.value.Targets)]
		switch target.Rule {
		case "reference":
			f.value.Targets = append(f.value.Targets, &domTerm{Kind: tmRule, Str: b.tokenValue(b.token(target)), At: b.at(target)})
		case "tag":
			f.value.Targets = append(f.value.Targets, &domTerm{Kind: tmTerminal, Str: b.tagOf(b.token(target)), At: b.at(target)})
		case "parameter":
			f.value.Targets = append(f.value.Targets, b.parameter(target))
		case "call":
			return ask(&sourceCallFrame{n: target})
		default:
			b.fail(target, "invalid target argument")
		}
	}
	return give(f.value)
}
