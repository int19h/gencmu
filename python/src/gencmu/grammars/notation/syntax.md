# The notation: from tokens to a grammar

This is the second stage of the notation dialect, `../dialects/notation.md`.
It reads the tokens `lexical.md` emitted and builds the tree from which a
library reads the grammar's rules and directives. Its rule names matter to
that reader: the table in `../../docs/engine.md`, §9, says what each named
constituent becomes. The notation is explained for authors in
`../../docs/notation.md`.

The tokens arrive tagged `identifier`, `string`, `phoneme`, `capture`,
`guard` or `directive`, or with their own spelling for a symbol such as
`"≔"` or `"..."`.

## Choosing among parses

Every construct of the notation is closed by a symbol or by the `;` that
ends its rule, so the grammar is unambiguous except where a list could end
earlier or later; the greedy reading takes the longer list.

```ebnf
%ambiguity-resolution greedy ;
```

## Documents

A grammar text is a sequence of rules and directives. A directive is its
name and any number of words, ended by `;`.

```ebnf
text ≔ [item] ... ;

item ≔ rule | directive-statement ;

directive-statement ≔ "directive" [argument-word] ... ";" ;

argument-word ≔ "identifier" ;
```

## Rules

A rule is a name, optional tags for all its alternatives, `≔` to define it
or `|≔` to add to it, its alternatives, its clauses, and `;`. Every list
separator may also stand first, so an author can put each alternative on a
line of its own starting with `|`.

```ebnf
rule ≔ "identifier" [rule-tags] definer body [clause] ... ";" ;

rule-tags ≔ "<" term ">" ;

definer ≔ "≔" | "|≔" ;

body ≔ ["|"] alternative ["|" alternative] ... ;

alternative ≔ [guard] ... conjunction [alternative-tags] ;

guard ≔ "guard" ;

alternative-tags ≔ "<" term ">" ;
```

## Expressions

`&` joins sequences, and a sequence is one or more elements. An element is a
primary, followed by `...` for one or more of it; an optional followed by
`...` is zero or more. Parentheses group a choice, whose alternatives carry
neither guards nor tags.

```ebnf
conjunction ≔ ["&"] sequence ["&" sequence] ... ;

sequence ≔ element ... ;

element ≔ primary ["..."] ;

primary ≔
| reference
| string
| phoneme
| capture
| group
| optional
| hash
| empty
;

reference ≔ "identifier" ;

string ≔ "string" ;

phoneme ≔ "phoneme" ;

capture ≔ "capture" "(" primary ")" ;

group ≔ "(" choice ")" ;

optional ≔ "[" choice "]" ;

choice ≔ ["|"] conjunction ["|" conjunction] ... ;

hash ≔ "#" ;

empty ≔ "ε" ;
```

## Clauses

A rule may say what it emits, after `⇒`, and what must hold of its captured
parts, after `:`, in either order.

```ebnf
clause ≔ emission | conditions ;

emission ≔ "⇒" [","] emit-item ["," emit-item] ... ;

emit-item ≔ emit-target [emit-tags] ;

emit-target ≔ "identifier" | "capture" | "string" | "phoneme" ;

emit-tags ≔ "<" term ">" ;

conditions ≔ ":" [condition-separator] condition-item [condition-separator condition-item] ... ;

condition-separator ≔ "," | "∧" ;

condition-item ≔ ["∨"] condition ["∨" condition] ... ;

condition ≔ comparison | call | negation ;

comparison ≔ term comparator term ;

comparator ≔ "=" | "≠" | "∈" | "∉" | "⊆" ;

negation ≔ "¬" condition | "¬" "(" condition ")" ;
```

## Terms

A term is a string, a tag set or a list. `∩` binds tighter than `∪`.

```ebnf
term ≔ ["∪"] intersection ["∪" intersection] ... ;

intersection ≔ ["∩"] term-atom ["∩" term-atom] ... ;

term-atom ≔
| string
| phoneme
| weak
| empty-set
| set
| "(" term ")"
| call
| capture-reference
;

weak ≔ "?" "string" ;

empty-set ≔ "∅" ;

set ≔ "{" [term ["," term] ...] "}" ;

call ≔ "identifier" "(" argument ["," argument] ... ")" ;

argument ≔ term | "identifier" ;

capture-reference ≔ "capture" ;
```
