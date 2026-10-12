# jbogenbau: from tokens to a grammar

This stage reads the tokens from `lexical.md`. It recognizes the whole document before the reader converts or rejects any part.

The rules implement `../../docs/engine.md`, §9.2. Their named parts follow the constructor contract in §9.3. Other rules are wrappers that contribute their children in written order.

Recognition admits invalid capture targets and repeated tests. The reader reports those errors at the positions that §9.3 specifies.

```jbogenbau
%ambiguity-resolution greedy

%rule text
  [{statement}]

%rule statement
  rule | directive | constant-definition | classifier | implication-declaration

%rule rule
  definer [rule-flags] rule-name (body | clauses headed-body) [conditions-clause] [output]

%rule definer
  KW-RULE | KW-REDEFINE-RULE | KW-EXTEND-RULE

%rule rule-flags
  "(" {rule-flag / ","} ")"

%rule rule-flag
  Identifier

%rule rule-name
  Identifier | "#"

%rule clauses
  tags-clause [value-clause] [image-clause] | value-clause [image-clause] | image-clause

%rule headed-body
  "|" ordinary-body

%rule body
  ["|"] ordinary-body | ranked-alternative

%rule ordinary-body
  {alternative / "|"}

%rule ranked-alternative
  [{guard}] ranked-choice [alternative-clauses]

%rule ranked-choice
  conjunction "≻" {conjunction / "≻"}

%rule alternative
  [{guard}] conjunction [alternative-clauses]

%rule alternative-clauses
  alternative-tags [value-clause] [image-clause] | value-clause [image-clause] | image-clause

%rule alternative-tags
  "::" term

%rule choice
  ["|"] {conjunction / "|"} | ranked-choice

%rule conjunction
  ["&"] {sequence / "&"}

%rule sequence
  {primary}

%rule primary
  capture | tested | untested-primary

%rule capture
  (Capture | Constant) ":" primary

%rule untested-primary
  reference | tag | string-terminal | range | wildcard | group | optional | repetition | empty

%rule reference
  Lowercase-Name | "#"

%rule tag
  Uppercase-Name | Engine-Tag≠"_"

%rule string-terminal
  string | constant-reference

%rule wildcard
  "_"

%rule group
  "(" choice ")"

%rule optional
  "[" ["+"] choice "]"

%rule repetition
  "{" ["..."] choice ["/" choice] "}" | "{" choice "..." ["/" choice] "}"

%rule empty
  "ε"

%rule guard
  Guard

%rule tested
  untested-primary {symbol-test}

%rule symbol-test
  tag-test | value-test

%rule tag-test
  "<" [{tag-requirement}] ">"

%rule tag-requirement
  ["¬"] test-operand

%rule value-test
  test test-operand

%rule test
  "=" | "≠"

%rule operand-atom
  string | constant-reference | name | tag | range | capture-reference | empty-set | pattern-literal | "(" term ")"

%rule test-operand
  operand-atom | method

%rule range
  string-operand ".." string-operand

%rule string-operand
  string | constant-reference

%rule conditions-clause
  KW-CONDITIONS [","] {implication / ","}

%rule output
  erased-clause | emits-clause

%rule erased-clause
  KW-ERASED

%rule emits-clause
  KW-EMITS [emission]

%rule emission
  [","] {emit-item / ","} | emit-clauses

%rule emit-item
  [{emit-before}] emit-target [{emit-after}] [emit-clauses]

%rule emit-target
  Capture | "ε" | Identifier | Engine-Tag≠"_" | range

%rule emit-before
  "(" capture-reference ")"

%rule emit-after
  "(" capture-reference ")"

%rule emit-clauses
  emit-tags [value-clause] [image-clause] | value-clause [image-clause] | image-clause

%rule emit-tags
  "::" term

%rule recipe
  {recipe-atom}

%rule recipe-atom
  term

%rule value-clause
  ":=" recipe

%rule image-clause
  ":-" recipe

%rule tags-clause
  "::" term

%rule term
  union | guarded-term

%rule guarded-term
  {any-of "⟹"} union

%rule union
  ["∪"] {intersection / ("∪" | "∖")}

%rule intersection
  ["∩"] {term-atom / "∩"}

%rule tag-run
  tag tag [{tag}]

%rule term-atom
  plain-term-atom | method

%rule plain-term-atom
  tag-run | tag | name | string | constant-reference | range | capture-reference | empty-set | pattern-literal | "(" term ")"

%rule method
  method-receiver {method-selector}

%rule method-receiver
  term-atom

%rule method-selector
  "." method-name ["(" arguments ")"]

%rule method-name
  Identifier

%rule arguments
  {argument / ","}

%rule argument
  term

%rule name
  Lowercase-Name

%rule empty-set
  "∅"

%rule capture-reference
  Capture

%rule constant-reference
  Constant

%rule string
  String | Include-Path

%rule implication
  {any-of / "⟹"}

%rule any-of
  ["∨"] {all-of / "∨"}

%rule all-of
  ["∧"] {condition / "∧"}

%rule condition
  comparison | tree-comparison | method | presence | negation | "(" implication ")"

%rule presence
  Capture

%rule negation
  "¬" condition

%rule comparison
  union comparator union

%rule comparator
  "=" | "≠" | "∈" | "∉" | "⊆" | "⊈"

%rule tree-comparison
  capture-reference tree-comparator union

%rule tree-comparator
  "≅" | "≇"

%rule pattern-literal
  "@" "(" pattern-union ")" | "@" $short:pattern-atom
%conditions $short ⟹ $short.first-token.value ≠ "("

%rule pattern-union
  {pattern-intersection / ("∪" | "∖")}

%rule pattern-intersection
  {pattern-sequence / "∩"}

%rule pattern-sequence
  {pattern-item}

%rule pattern-item
  pattern-atom | pattern-brackets | pattern-repeat | pattern-path | "⋯"

%rule pattern-atom
  (pattern-name | tag | string | range | wildcard | constant-reference) [{symbol-test}] | pattern-literal | "(" pattern-union ")"

%rule pattern-name
  Lowercase-Name | "#"

%rule pattern-brackets
  "[" pattern-union "]"

%rule pattern-repeat
  "{" pattern-union ["/" pattern-union] "}"

%rule pattern-path
  ("⋮" | "⋱") pattern-atom | pattern-atom "⋰"

%rule directive
  directive-name [{directive-argument}]

%rule directive-name
  | KW-STAGE | KW-EXTEND-STAGE | KW-REDEFINE-STAGE
  | KW-INCLUDE | KW-FEATURES | KW-AMBIGUITY-RESOLUTION

%rule directive-argument
  argument-word | argument-string | argument-tag | argument-term

%rule argument-word
  Identifier

%rule argument-string
  String | Include-Path

%rule argument-tag
  Engine-Tag≠"_" | range

%rule argument-term
  method | capture-reference | constant-reference | empty-set | pattern-literal | "(" term ")" | "#" | "_"

%rule constant-definition
  constant-definer constant-reference term

%rule constant-definer
  KW-CONST | KW-REDEFINE-CONST

%rule classifier
  KW-CLASSIFIER classifier-name [{classifier-entry}]

%rule classifier-name
  Identifier

%rule classifier-entry
  [{guard}] {classifier-key} classifier-operator classifier-class

%rule classifier-key
  string

%rule classifier-operator
  "∈" | "∉"

%rule classifier-class
  Identifier | Engine-Tag≠"_"

%rule implication-declaration
  KW-IMPLIES union "⟹" union
```

<details><summary>Railroad diagrams of the 111 rules from <code>text</code> to <code>implication-declaration</code></summary>
<p><img src="../../docs/diagrams/notation/syntax/text.svg" alt="Railroad diagram of the rule text"></p>
<p><img src="../../docs/diagrams/notation/syntax/statement.svg" alt="Railroad diagram of the rule statement"></p>
<p><img src="../../docs/diagrams/notation/syntax/rule.svg" alt="Railroad diagram of the rule rule"></p>
<p><img src="../../docs/diagrams/notation/syntax/definer.svg" alt="Railroad diagram of the rule definer"></p>
<p><img src="../../docs/diagrams/notation/syntax/rule-flags.svg" alt="Railroad diagram of the rule rule-flags"></p>
<p><img src="../../docs/diagrams/notation/syntax/rule-flag.svg" alt="Railroad diagram of the rule rule-flag"></p>
<p><img src="../../docs/diagrams/notation/syntax/rule-name.svg" alt="Railroad diagram of the rule rule-name"></p>
<p><img src="../../docs/diagrams/notation/syntax/clauses.svg" alt="Railroad diagram of the rule clauses"></p>
<p><img src="../../docs/diagrams/notation/syntax/headed-body.svg" alt="Railroad diagram of the rule headed-body"></p>
<p><img src="../../docs/diagrams/notation/syntax/body.svg" alt="Railroad diagram of the rule body"></p>
<p><img src="../../docs/diagrams/notation/syntax/ordinary-body.svg" alt="Railroad diagram of the rule ordinary-body"></p>
<p><img src="../../docs/diagrams/notation/syntax/ranked-alternative.svg" alt="Railroad diagram of the rule ranked-alternative"></p>
<p><img src="../../docs/diagrams/notation/syntax/ranked-choice.svg" alt="Railroad diagram of the rule ranked-choice"></p>
<p><img src="../../docs/diagrams/notation/syntax/alternative.svg" alt="Railroad diagram of the rule alternative"></p>
<p><img src="../../docs/diagrams/notation/syntax/alternative-clauses.svg" alt="Railroad diagram of the rule alternative-clauses"></p>
<p><img src="../../docs/diagrams/notation/syntax/alternative-tags.svg" alt="Railroad diagram of the rule alternative-tags"></p>
<p><img src="../../docs/diagrams/notation/syntax/choice.svg" alt="Railroad diagram of the rule choice"></p>
<p><img src="../../docs/diagrams/notation/syntax/conjunction.svg" alt="Railroad diagram of the rule conjunction"></p>
<p><img src="../../docs/diagrams/notation/syntax/sequence.svg" alt="Railroad diagram of the rule sequence"></p>
<p><img src="../../docs/diagrams/notation/syntax/primary.svg" alt="Railroad diagram of the rule primary"></p>
<p><img src="../../docs/diagrams/notation/syntax/capture.svg" alt="Railroad diagram of the rule capture"></p>
<p><img src="../../docs/diagrams/notation/syntax/untested-primary.svg" alt="Railroad diagram of the rule untested-primary"></p>
<p><img src="../../docs/diagrams/notation/syntax/reference.svg" alt="Railroad diagram of the rule reference"></p>
<p><img src="../../docs/diagrams/notation/syntax/tag.svg" alt="Railroad diagram of the rule tag"></p>
<p><img src="../../docs/diagrams/notation/syntax/string-terminal.svg" alt="Railroad diagram of the rule string-terminal"></p>
<p><img src="../../docs/diagrams/notation/syntax/wildcard.svg" alt="Railroad diagram of the rule wildcard"></p>
<p><img src="../../docs/diagrams/notation/syntax/group.svg" alt="Railroad diagram of the rule group"></p>
<p><img src="../../docs/diagrams/notation/syntax/optional.svg" alt="Railroad diagram of the rule optional"></p>
<p><img src="../../docs/diagrams/notation/syntax/repetition.svg" alt="Railroad diagram of the rule repetition"></p>
<p><img src="../../docs/diagrams/notation/syntax/empty.svg" alt="Railroad diagram of the rule empty"></p>
<p><img src="../../docs/diagrams/notation/syntax/guard.svg" alt="Railroad diagram of the rule guard"></p>
<p><img src="../../docs/diagrams/notation/syntax/tested.svg" alt="Railroad diagram of the rule tested"></p>
<p><img src="../../docs/diagrams/notation/syntax/symbol-test.svg" alt="Railroad diagram of the rule symbol-test"></p>
<p><img src="../../docs/diagrams/notation/syntax/tag-test.svg" alt="Railroad diagram of the rule tag-test"></p>
<p><img src="../../docs/diagrams/notation/syntax/tag-requirement.svg" alt="Railroad diagram of the rule tag-requirement"></p>
<p><img src="../../docs/diagrams/notation/syntax/value-test.svg" alt="Railroad diagram of the rule value-test"></p>
<p><img src="../../docs/diagrams/notation/syntax/test.svg" alt="Railroad diagram of the rule test"></p>
<p><img src="../../docs/diagrams/notation/syntax/operand-atom.svg" alt="Railroad diagram of the rule operand-atom"></p>
<p><img src="../../docs/diagrams/notation/syntax/test-operand.svg" alt="Railroad diagram of the rule test-operand"></p>
<p><img src="../../docs/diagrams/notation/syntax/range.svg" alt="Railroad diagram of the rule range"></p>
<p><img src="../../docs/diagrams/notation/syntax/string-operand.svg" alt="Railroad diagram of the rule string-operand"></p>
<p><img src="../../docs/diagrams/notation/syntax/conditions-clause.svg" alt="Railroad diagram of the rule conditions-clause"></p>
<p><img src="../../docs/diagrams/notation/syntax/output.svg" alt="Railroad diagram of the rule output"></p>
<p><img src="../../docs/diagrams/notation/syntax/erased-clause.svg" alt="Railroad diagram of the rule erased-clause"></p>
<p><img src="../../docs/diagrams/notation/syntax/emits-clause.svg" alt="Railroad diagram of the rule emits-clause"></p>
<p><img src="../../docs/diagrams/notation/syntax/emission.svg" alt="Railroad diagram of the rule emission"></p>
<p><img src="../../docs/diagrams/notation/syntax/emit-item.svg" alt="Railroad diagram of the rule emit-item"></p>
<p><img src="../../docs/diagrams/notation/syntax/emit-target.svg" alt="Railroad diagram of the rule emit-target"></p>
<p><img src="../../docs/diagrams/notation/syntax/emit-before.svg" alt="Railroad diagram of the rule emit-before"></p>
<p><img src="../../docs/diagrams/notation/syntax/emit-after.svg" alt="Railroad diagram of the rule emit-after"></p>
<p><img src="../../docs/diagrams/notation/syntax/emit-clauses.svg" alt="Railroad diagram of the rule emit-clauses"></p>
<p><img src="../../docs/diagrams/notation/syntax/emit-tags.svg" alt="Railroad diagram of the rule emit-tags"></p>
<p><img src="../../docs/diagrams/notation/syntax/recipe.svg" alt="Railroad diagram of the rule recipe"></p>
<p><img src="../../docs/diagrams/notation/syntax/recipe-atom.svg" alt="Railroad diagram of the rule recipe-atom"></p>
<p><img src="../../docs/diagrams/notation/syntax/value-clause.svg" alt="Railroad diagram of the rule value-clause"></p>
<p><img src="../../docs/diagrams/notation/syntax/image-clause.svg" alt="Railroad diagram of the rule image-clause"></p>
<p><img src="../../docs/diagrams/notation/syntax/tags-clause.svg" alt="Railroad diagram of the rule tags-clause"></p>
<p><img src="../../docs/diagrams/notation/syntax/term.svg" alt="Railroad diagram of the rule term"></p>
<p><img src="../../docs/diagrams/notation/syntax/guarded-term.svg" alt="Railroad diagram of the rule guarded-term"></p>
<p><img src="../../docs/diagrams/notation/syntax/union.svg" alt="Railroad diagram of the rule union"></p>
<p><img src="../../docs/diagrams/notation/syntax/intersection.svg" alt="Railroad diagram of the rule intersection"></p>
<p><img src="../../docs/diagrams/notation/syntax/tag-run.svg" alt="Railroad diagram of the rule tag-run"></p>
<p><img src="../../docs/diagrams/notation/syntax/term-atom.svg" alt="Railroad diagram of the rule term-atom"></p>
<p><img src="../../docs/diagrams/notation/syntax/plain-term-atom.svg" alt="Railroad diagram of the rule plain-term-atom"></p>
<p><img src="../../docs/diagrams/notation/syntax/method.svg" alt="Railroad diagram of the rule method"></p>
<p><img src="../../docs/diagrams/notation/syntax/method-receiver.svg" alt="Railroad diagram of the rule method-receiver"></p>
<p><img src="../../docs/diagrams/notation/syntax/method-selector.svg" alt="Railroad diagram of the rule method-selector"></p>
<p><img src="../../docs/diagrams/notation/syntax/method-name.svg" alt="Railroad diagram of the rule method-name"></p>
<p><img src="../../docs/diagrams/notation/syntax/arguments.svg" alt="Railroad diagram of the rule arguments"></p>
<p><img src="../../docs/diagrams/notation/syntax/argument.svg" alt="Railroad diagram of the rule argument"></p>
<p><img src="../../docs/diagrams/notation/syntax/name.svg" alt="Railroad diagram of the rule name"></p>
<p><img src="../../docs/diagrams/notation/syntax/empty-set.svg" alt="Railroad diagram of the rule empty-set"></p>
<p><img src="../../docs/diagrams/notation/syntax/capture-reference.svg" alt="Railroad diagram of the rule capture-reference"></p>
<p><img src="../../docs/diagrams/notation/syntax/constant-reference.svg" alt="Railroad diagram of the rule constant-reference"></p>
<p><img src="../../docs/diagrams/notation/syntax/string.svg" alt="Railroad diagram of the rule string"></p>
<p><img src="../../docs/diagrams/notation/syntax/implication.svg" alt="Railroad diagram of the rule implication"></p>
<p><img src="../../docs/diagrams/notation/syntax/any-of.svg" alt="Railroad diagram of the rule any-of"></p>
<p><img src="../../docs/diagrams/notation/syntax/all-of.svg" alt="Railroad diagram of the rule all-of"></p>
<p><img src="../../docs/diagrams/notation/syntax/condition.svg" alt="Railroad diagram of the rule condition"></p>
<p><img src="../../docs/diagrams/notation/syntax/presence.svg" alt="Railroad diagram of the rule presence"></p>
<p><img src="../../docs/diagrams/notation/syntax/negation.svg" alt="Railroad diagram of the rule negation"></p>
<p><img src="../../docs/diagrams/notation/syntax/comparison.svg" alt="Railroad diagram of the rule comparison"></p>
<p><img src="../../docs/diagrams/notation/syntax/comparator.svg" alt="Railroad diagram of the rule comparator"></p>
<p><img src="../../docs/diagrams/notation/syntax/tree-comparison.svg" alt="Railroad diagram of the rule tree-comparison"></p>
<p><img src="../../docs/diagrams/notation/syntax/tree-comparator.svg" alt="Railroad diagram of the rule tree-comparator"></p>
<p><img src="../../docs/diagrams/notation/syntax/pattern-literal.svg" alt="Railroad diagram of the rule pattern-literal"></p>
<p><img src="../../docs/diagrams/notation/syntax/pattern-union.svg" alt="Railroad diagram of the rule pattern-union"></p>
<p><img src="../../docs/diagrams/notation/syntax/pattern-intersection.svg" alt="Railroad diagram of the rule pattern-intersection"></p>
<p><img src="../../docs/diagrams/notation/syntax/pattern-sequence.svg" alt="Railroad diagram of the rule pattern-sequence"></p>
<p><img src="../../docs/diagrams/notation/syntax/pattern-item.svg" alt="Railroad diagram of the rule pattern-item"></p>
<p><img src="../../docs/diagrams/notation/syntax/pattern-atom.svg" alt="Railroad diagram of the rule pattern-atom"></p>
<p><img src="../../docs/diagrams/notation/syntax/pattern-name.svg" alt="Railroad diagram of the rule pattern-name"></p>
<p><img src="../../docs/diagrams/notation/syntax/pattern-brackets.svg" alt="Railroad diagram of the rule pattern-brackets"></p>
<p><img src="../../docs/diagrams/notation/syntax/pattern-repeat.svg" alt="Railroad diagram of the rule pattern-repeat"></p>
<p><img src="../../docs/diagrams/notation/syntax/pattern-path.svg" alt="Railroad diagram of the rule pattern-path"></p>
<p><img src="../../docs/diagrams/notation/syntax/directive.svg" alt="Railroad diagram of the rule directive"></p>
<p><img src="../../docs/diagrams/notation/syntax/directive-name.svg" alt="Railroad diagram of the rule directive-name"></p>
<p><img src="../../docs/diagrams/notation/syntax/directive-argument.svg" alt="Railroad diagram of the rule directive-argument"></p>
<p><img src="../../docs/diagrams/notation/syntax/argument-word.svg" alt="Railroad diagram of the rule argument-word"></p>
<p><img src="../../docs/diagrams/notation/syntax/argument-string.svg" alt="Railroad diagram of the rule argument-string"></p>
<p><img src="../../docs/diagrams/notation/syntax/argument-tag.svg" alt="Railroad diagram of the rule argument-tag"></p>
<p><img src="../../docs/diagrams/notation/syntax/argument-term.svg" alt="Railroad diagram of the rule argument-term"></p>
<p><img src="../../docs/diagrams/notation/syntax/constant-definition.svg" alt="Railroad diagram of the rule constant-definition"></p>
<p><img src="../../docs/diagrams/notation/syntax/constant-definer.svg" alt="Railroad diagram of the rule constant-definer"></p>
<p><img src="../../docs/diagrams/notation/syntax/classifier.svg" alt="Railroad diagram of the rule classifier"></p>
<p><img src="../../docs/diagrams/notation/syntax/classifier-name.svg" alt="Railroad diagram of the rule classifier-name"></p>
<p><img src="../../docs/diagrams/notation/syntax/classifier-entry.svg" alt="Railroad diagram of the rule classifier-entry"></p>
<p><img src="../../docs/diagrams/notation/syntax/classifier-key.svg" alt="Railroad diagram of the rule classifier-key"></p>
<p><img src="../../docs/diagrams/notation/syntax/classifier-operator.svg" alt="Railroad diagram of the rule classifier-operator"></p>
<p><img src="../../docs/diagrams/notation/syntax/classifier-class.svg" alt="Railroad diagram of the rule classifier-class"></p>
<p><img src="../../docs/diagrams/notation/syntax/implication-declaration.svg" alt="Railroad diagram of the rule implication-declaration"></p>
</details>
