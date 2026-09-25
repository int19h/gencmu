# jbogenbau: from tokens to a grammar

This is the second stage of the notation dialect, `../dialects/notation.md`. It reads the tokens `lexical.md` emitted and builds the tree from which a library reads the grammar's rules and directives. Its rule names matter to that reader: the table in `../../docs/engine.md`, §9, says what each named constituent becomes. The notation is explained for authors in `../../docs/notation.md`.

The tokens arrive tagged `identifier`, `string`, `phoneme`, `capture` or `guard`, with their own spelling for a keyword such as `"%rule"`, or with their own spelling for a symbol such as `"|"` or `"..."`.

## Choosing among parses

Every rule and directive begins with a keyword, and a keyword begins nothing else, so where one ends is never in doubt, and the grammar is unambiguous except where a list could end earlier or later; the greedy reading takes the longer list.

```jbogenbau
%ambiguity-resolution greedy
```

## Documents

A grammar text is a sequence of rules and directives. A directive is its keyword and any number of words.

```jbogenbau
%rule text
  [statement] ...

%rule statement
  rule | directive

%rule directive
  directive-name [argument-word] ...

%rule directive-name
  "%ambiguity-resolution" | "%elidable"

%rule argument-word
  "identifier"
```

## Rules

A rule is a keyword that says whether it defines, redefines or extends the rule, its name, its alternatives, and its clauses, at most one of each and in a fixed order. A rule's name is a name, or `#`, the free-modifier slot. Every list separator may also stand first, so an author can put each alternative on a line of its own starting with `|`.

```jbogenbau
%rule rule
  definer rule-name body [tags-clause] [conditions-clause] [emits-clause] [verbatim-clause]

%rule definer
  "%rule" | "%redefine-rule" | "%extend-rule"

%rule rule-name
  "identifier" | "#"

%rule body
  ["|"] alternative ["|" alternative] ...

%rule alternative
  [guard] ... conjunction [alternative-tags]

%rule guard
  "guard"

%rule alternative-tags
  "<" term ">"
```

## Expressions

`&` joins sequences, and a sequence is one or more elements. An element is a primary, followed by `...` for one or more of it; an optional followed by `...` is zero or more. Parentheses group a choice, whose alternatives carry neither guards nor tags.

```jbogenbau
%rule conjunction
  ["&"] sequence ["&" sequence] ...

%rule sequence
  element ...

%rule element
  primary ["..."]

%rule primary
  reference | string | phoneme | capture | group | optional | empty

%rule reference
  "identifier" | "#"

%rule string
  "string"

%rule phoneme
  "phoneme"

%rule capture
  "capture" "(" primary ")"

%rule group
  "(" choice ")"

%rule optional
  "[" choice "]"

%rule choice
  ["|"] conjunction ["|" conjunction] ...

%rule empty
  "ε"
```

## Clauses

`%tags` says what tags every alternative's constituent carries. `%conditions` lists what must hold of the captured parts. `%emits` says what the constituent hands on. That is a list of items, each a capture, with tags of its own between `<` and `>`, or an inserted tag. It can also be `ε`, nothing, which also makes the constituent not count. `%verbatim` is a keyword alone. It says that a token over the constituent sounds like its text.

```jbogenbau
%rule tags-clause
  "%tags" term

%rule conditions-clause
  "%conditions" [","] implication ["," implication] ...

%rule emits-clause
  "%emits" ([","] emit-item ["," emit-item] ... | "ε")

%rule verbatim-clause
  "%verbatim"

%rule emit-item
  emit-target [emit-tags]

%rule emit-target
  "capture" | "string" | "phoneme"

%rule emit-tags
  "<" term ">"
```

A condition joins others with `∧`, `∨` and `⟹`, binding in that order, `⟹` grouping to the right; parentheses group, and `¬` negates the condition after it. A capture alone is a condition, true where the alternative has it.

```jbogenbau
%rule implication
  any-of ["⟹" implication]

%rule any-of
  ["∨"] all-of ["∨" all-of] ...

%rule all-of
  ["∧"] condition ["∧" condition] ...

%rule condition
  comparison | call | negation | presence | "(" implication ")"

%rule comparison
  union comparator union

%rule comparator
  "=" | "≠" | "∈" | "∉" | "⊆"

%rule negation
  "¬" condition

%rule presence
  "capture"
```

## Terms

A term is a string or a tag set. `∩` binds tighter than `∪`. A term guarded by a condition, `A ⟹ t`, is `t` where `A` holds and nothing where it does not; it binds looser than `∪` and `∩`, so it stands in parentheses inside a larger term, and only a whole tag term may be one without them.

```jbogenbau
%rule term
  union | guarded-term

%rule guarded-term
  any-of "⟹" term

%rule union
  ["∪"] intersection ["∪" intersection] ...

%rule intersection
  ["∩"] term-atom ["∩" term-atom] ...

%rule term-atom
  string | phoneme | weak | empty-set | "(" term ")" | call | capture-reference

%rule weak
  "?" "string"

%rule empty-set
  "∅"

%rule call
  "identifier" "(" argument ["," argument] ... ")"

%rule argument
  union | "identifier"

%rule capture-reference
  "capture"
```
