# jbogenbau: from tokens to a grammar

This is the second stage of the notation dialect, `../dialects/notation.md`. A stage is one step of a pipeline, with its own grammar. The stage reads the tokens (units of input) that `lexical.md` emitted. It builds the tree from which a library reads the grammar's rules and directives. Its rule names matter to that reader: the table in `../../docs/engine.md`, §9, says what each named constituent becomes. `../../docs/notation.md` explains the notation for authors.

The tokens arrive with tags (labels that the grammar reads). The lexical stage tags a token `~identifier`, `~string`, `~tag`, `~phoneme`, `~character`, `~property`, `~spelling`, `~capture` or `~guard`. It tags a keyword that the notation knows with its own identifier, such as `~keyword-rule` for `%rule`, `...` with `~ellipsis`, and `..` with `~double-dot`. Any other symbol is one character, which keeps its character tag, such as `'|'`.

## Choosing among parses

Every rule and directive begins with a keyword, and a keyword begins nothing else. So where one ends is never in doubt. The grammar is unambiguous except where a list can end earlier or later. There, the greedy reading takes the longer list: it ends each constituent as late as the grammar allows.

```jbogenbau
%ambiguity-resolution greedy
```

## Documents

A grammar text is a sequence of rules and directives. A directive is its keyword and any number of operands, each a name, a string, a tag, a range or a property. A library reads the tree into a DOM (document object model), its own form of the grammar. At that point, the library makes sure that each directive has the operands that it takes, so that an error names the directive (`../../docs/engine.md`, §9).

```jbogenbau
%rule text
  [statement] ...

%rule statement
  rule | directive

%rule directive
  directive-name [argument-word | argument-string | argument-tag] ...

%rule directive-name
  | ~keyword-ambiguity-resolution | ~keyword-elidable | ~keyword-stage
  | ~keyword-include | ~keyword-features

%rule argument-word
  ~identifier

%rule argument-string
  ~string

%rule argument-tag
  ~tag | ~phoneme | ~character | range | property
```

## Rules

A rule is a keyword, its name, its alternatives and its clauses, in this order. The keyword says whether the rule defines, redefines or extends the rule. A rule has at most one clause of each kind, and the clauses come in a fixed order. A rule's name is a name, or `#`, the free-modifier slot. Every list separator can also stand first, so an author can put each alternative on a line of its own that starts with `|`.

```jbogenbau
%rule rule
  definer rule-name body [tags-clause] [conditions-clause] [emits-clause] [verbatim-clause]

%rule definer
  ~keyword-rule | ~keyword-redefine-rule | ~keyword-extend-rule

%rule rule-name
  ~identifier | '#'

%rule body
  ['|'] alternative ['|' alternative] ...

%rule alternative
  [guard] ... conjunction [alternative-tags]

%rule guard
  ~guard

%rule alternative-tags
  '<' term '>'
```

## Expressions

`&` joins sequences, and a sequence is one or more elements. An element is a primary, followed by `...` for one or more of it. An optional followed by `...` is zero or more. Parentheses group a choice, whose alternatives carry neither guards nor tags.

A terminal is a name, a tag literal, a character tag, a phoneme tag, a range or a property. A string is not a terminal. A range is two character tags joined by `..`, such as `'a'..'z'`. A reference or a terminal can carry a spelling, as in ``LE`la` ``. It matches only where its span sounds like the spelling. Nothing else takes a spelling, so a group or an optional followed by one is not a primary, and the spelling binds tighter than `...`.

The grammar also reads a spelling on a range or a property. The reader refuses it there, and names the reason.

```jbogenbau
%rule conjunction
  ['&'] sequence ['&' sequence] ...

%rule sequence
  element ...

%rule element
  primary [~ellipsis]

%rule primary
  reference | tag | character | phoneme | range | property | spelled | capture | group | optional | empty

%rule spelled
  (reference | tag | character | phoneme | range | property) ~spelling

%rule reference
  ~identifier | '#'

%rule tag
  ~tag

%rule character
  ~character

%rule phoneme
  ~phoneme

%rule range
  character ~double-dot character

%rule property
  ~property

%rule capture
  ~capture '(' primary ')'

%rule group
  '(' choice ')'

%rule optional
  '[' choice ']'

%rule choice
  ['|'] conjunction ['|' conjunction] ...

%rule empty
  'ε'
```

## Clauses

`%tags` says what tags every alternative's constituent carries. `%conditions` lists what must hold of the captured parts.

`%emits` says what the constituent hands on. That is a list of items. An item is a capture, with tags of its own between `<` and `>`, or an inserted tag. An inserted tag is a capital-initial name, a tag literal, a character tag or a phoneme tag. The grammar also reads a range or a property there, so that the reader can refuse it by name. The clause can also be `ε`, nothing, which also makes the constituent not count.

`%verbatim` is a keyword alone. It says that a token over the constituent sounds like its text.

```jbogenbau
%rule tags-clause
  ~keyword-tags term

%rule conditions-clause
  ~keyword-conditions [','] implication [',' implication] ...

%rule emits-clause
  ~keyword-emits ([','] emit-item [',' emit-item] ... | 'ε')

%rule verbatim-clause
  ~keyword-verbatim

%rule emit-item
  emit-target [emit-tags]

%rule emit-target
  ~capture | ~identifier | ~tag | ~character | ~phoneme | range | property

%rule emit-tags
  '<' term '>'
```

A condition joins others with `∧`, `∨` and `⟹`. These operators bind in that order, and `⟹` groups to the right. Parentheses group, and `¬` negates the condition after it. A capture alone is a condition, true where the alternative has it.

```jbogenbau
%rule implication
  any-of ['⟹' implication]

%rule any-of
  ['∨'] all-of ['∨' all-of] ...

%rule all-of
  ['∧'] condition ['∧' condition] ...

%rule condition
  comparison | call | negation | presence | '(' implication ')'

%rule comparison
  union comparator union

%rule comparator
  '=' | '≠' | '∈' | '∉' | '⊆' | '⊈'

%rule negation
  '¬' condition

%rule presence
  ~capture
```

## Terms

A term is a string, a set of strings, a tag set or a span. A range is a tag set, and `..` binds tighter than any other operator, since its two sides are character tags. `∩` binds tighter than `∪` and `∖`, which bind equally and group from the left. A term guarded by a condition, `A ⟹ t`, is `t` where `A` holds and nothing where it does not. It binds looser than `∪`, `∩` and `∖`, so it stands in parentheses inside a larger term. Only a whole tag term can be a guarded term without parentheses.

A property is not a tag set, but the grammar reads one in a term, so that the reader can refuse it by name. A bare name in a term is a tag literal when it begins with a capital. Otherwise it names a rule, which only a function's argument can do. The reader tells the two apart and gives each term its type (`../../docs/engine.md`, §9, §10).

```jbogenbau
%rule term
  union | guarded-term

%rule guarded-term
  any-of '⟹' term

%rule union
  ['∪'] intersection [('∪' | '∖') intersection] ...

%rule intersection
  ['∩'] term-atom ['∩' term-atom] ...

%rule term-atom
  | string | tag | character | phoneme | range | property | name | empty-set
  | '(' term ')' | call | capture-reference

%rule string
  ~string

%rule name
  ~identifier

%rule empty-set
  '∅'

%rule call
  ~identifier '(' argument [',' argument] ... ')'

%rule argument
  union

%rule capture-reference
  ~capture
```
