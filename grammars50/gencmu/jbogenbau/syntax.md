# jbogenbau: from tokens to a document tree

The syntax stage reads the [lexical tokens](lexical.md). The document reader converts its tree to the records in [Engine §9](../../../docs/engine.md#9-from-notation-tree-to-dom).

## Declarations

The declarations contain the rule bodies and the clauses that belong to them. The tree keeps both in source order.

```jbogenbau
%ambiguity-resolution greedy

%rule text
  [{statement}]

%rule statement
  rule | ranking-directive | directive | constant-definition

%rule rule
  rule-keyword rule-name "=" call
  | rule-keyword (rule-name | call) [$header:statement-term] body
    [conditions-clause] [diagnostic-clause] [suppress-warnings-clause] [output-clause]
%conditions
  $header ⟹ $header.following-tokens.first-token.tokens!'value.join() = "|"

%rule rule-keyword
  KW-RULE | KW-EXTEND-RULE | KW-REDEFINE-RULE

%rule rule-name
  Identifier | Emoji-Name

%rule statement-term
  "→" bag

%rule body
  | ["|"] ordinary-body
  | ["|"] ranked-body

%rule ordinary-body
  {alternative / "|"}

%rule ranked-body
  [{feature-gate}] ranked-choice [alternative-term]

%rule ranked-choice
  some-of "≻" {some-of / "≻"}

%rule alternative
  [{feature-gate}] some-of [alternative-term]

%rule alternative-term
  "→" bag
```

<details><summary>Railroad diagrams of the 12 rules from <code>text</code> to <code>alternative-term</code></summary>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/text.svg" alt="Railroad diagram of the rule text"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/statement.svg" alt="Railroad diagram of the rule statement"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/rule.svg" alt="Railroad diagram of the rule rule"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/rule-keyword.svg" alt="Railroad diagram of the rule rule-keyword"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/rule-name.svg" alt="Railroad diagram of the rule rule-name"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/statement-term.svg" alt="Railroad diagram of the rule statement-term"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/body.svg" alt="Railroad diagram of the rule body"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/ordinary-body.svg" alt="Railroad diagram of the rule ordinary-body"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/ranked-body.svg" alt="Railroad diagram of the rule ranked-body"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/ranked-choice.svg" alt="Railroad diagram of the rule ranked-choice"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/alternative.svg" alt="Railroad diagram of the rule alternative"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/alternative-term.svg" alt="Railroad diagram of the rule alternative-term"></p>
</details>

## Rule bodies

Factors are symbols, groups and the operators that apply to them. A capture or primary mark wraps one factor.

```jbogenbau
%rule choice
  | ["|"] {some-of / "|"}
  | ranked-choice

%rule some-of
  ["&"] {sequence / "&"}

%rule sequence
  {factor}

%rule factor
  marked-factor | capture | tested-factor | untested-factor

%rule marked-factor
  "^" (capture | tested-factor | untested-factor)

%rule capture
  binding-token ":" factor

%rule binding-token
  Capture | Constant

%rule untested-factor
  | rule-reference | call | splice | parameter | tag | string-terminal
  | range | wildcard | group | optional | repetition | empty

%rule rule-reference
  Lowercase-Name | Emoji-Name

%rule tag
  Uppercase-Name | Engine-Tag

%rule string-terminal
  string | constant-reference

%rule string-operand
  string | constant-reference | parameter

%rule range
  string-operand ".." string-operand

%rule wildcard
  "_"

%rule group
  "(" choice ")"

%rule optional
  | "[" ["+"] choice "]"
  | "[" captured-terminator "]"

%rule captured-terminator
  binding-token ":" "+" factor

%rule repetition
  "{" ["..."] choice ["/" choice] "}"
  | "{" choice "..." ["/" choice] "}"

%rule empty
  "ε"

%rule splice
  $mark:"*" $target:splice-target
%conditions
  $.source-text = $mark.source-text ++ $target.source-text

%rule splice-target
  rule-reference | call

%rule feature-gate
  ["¬"] Identifier "?"
%conditions
  $.source-text = $.span.tokens!'value.join()

%rule tested-factor
  untested-factor {symbol-test}

%rule symbol-test
  tag-test | value-test | default-value

%rule tag-test
  "<" [{tag-requirement}] ">"

%rule tag-requirement
  ["¬"] test-operand

%rule value-test
  ("=" | "≠") test-operand

%rule default-value
  "≝" test-operand

%rule test-operand
  range | rule-reference | call | tag | post
```

<details><summary>Railroad diagrams of the 29 rules from <code>choice</code> to <code>test-operand</code></summary>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/choice.svg" alt="Railroad diagram of the rule choice"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/some-of.svg" alt="Railroad diagram of the rule some-of"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/sequence.svg" alt="Railroad diagram of the rule sequence"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/factor.svg" alt="Railroad diagram of the rule factor"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/marked-factor.svg" alt="Railroad diagram of the rule marked-factor"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/capture.svg" alt="Railroad diagram of the rule capture"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/binding-token.svg" alt="Railroad diagram of the rule binding-token"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/untested-factor.svg" alt="Railroad diagram of the rule untested-factor"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/rule-reference.svg" alt="Railroad diagram of the rule rule-reference"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/tag.svg" alt="Railroad diagram of the rule tag"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/string-terminal.svg" alt="Railroad diagram of the rule string-terminal"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/string-operand.svg" alt="Railroad diagram of the rule string-operand"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/range.svg" alt="Railroad diagram of the rule range"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/wildcard.svg" alt="Railroad diagram of the rule wildcard"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/group.svg" alt="Railroad diagram of the rule group"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/optional.svg" alt="Railroad diagram of the rule optional"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/captured-terminator.svg" alt="Railroad diagram of the rule captured-terminator"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/repetition.svg" alt="Railroad diagram of the rule repetition"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/empty.svg" alt="Railroad diagram of the rule empty"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/splice.svg" alt="Railroad diagram of the rule splice"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/splice-target.svg" alt="Railroad diagram of the rule splice-target"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/feature-gate.svg" alt="Railroad diagram of the rule feature-gate"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/tested-factor.svg" alt="Railroad diagram of the rule tested-factor"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/symbol-test.svg" alt="Railroad diagram of the rule symbol-test"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/tag-test.svg" alt="Railroad diagram of the rule tag-test"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/tag-requirement.svg" alt="Railroad diagram of the rule tag-requirement"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/value-test.svg" alt="Railroad diagram of the rule value-test"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/default-value.svg" alt="Railroad diagram of the rule default-value"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/test-operand.svg" alt="Railroad diagram of the rule test-operand"></p>
</details>

## Calls and arguments

An equals sign before a call argument selects the expression grammar.

```jbogenbau
%rule call
  Call-Name "(" {call-argument / ","} ")"

%rule call-argument
  "=" expr | requirement-argument | target-argument | body-argument | symbol-argument

%rule requirement-argument
  "<" [{tag-requirement}] ">"

%rule target-argument
  target-option "|" {target-option / "|"}

%rule target-option
  rule-reference | tag | call | parameter

%rule body-argument
  group | optional | repetition | empty

%rule symbol-argument
  | tested-factor | range | wildcard | splice
  | rule-reference | call | parameter | tag | string-terminal

%rule parameter
  Parameter

%rule constant-reference
  Constant

%rule string
  String
```

<details><summary>Railroad diagrams of the 10 rules from <code>call</code> to <code>string</code></summary>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/call.svg" alt="Railroad diagram of the rule call"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/call-argument.svg" alt="Railroad diagram of the rule call-argument"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/requirement-argument.svg" alt="Railroad diagram of the rule requirement-argument"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/target-argument.svg" alt="Railroad diagram of the rule target-argument"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/target-option.svg" alt="Railroad diagram of the rule target-option"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/body-argument.svg" alt="Railroad diagram of the rule body-argument"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/symbol-argument.svg" alt="Railroad diagram of the rule symbol-argument"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/parameter.svg" alt="Railroad diagram of the rule parameter"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/constant-reference.svg" alt="Railroad diagram of the rule constant-reference"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/string.svg" alt="Railroad diagram of the rule string"></p>
</details>

## Clauses and directives

Clause keywords end the body. A resolution step can name a pattern.

```jbogenbau
%rule conditions-clause
  KW-CONDITIONS [","] {expr / ","}

%rule diagnostic-clause
  error-clause | warning-clause

%rule error-clause
  KW-ERROR expr

%rule warning-clause
  KW-WARNING expr

%rule suppress-warnings-clause
  KW-SUPPRESS-WARNINGS ("_" | {suppression-code / ","})

%rule suppression-code
  Identifier

%rule output-clause
  erased-clause | emit-clause

%rule erased-clause
  KW-ERASED

%rule emit-clause
  KW-EMIT [{output / ","}]

%rule output
  prefix (Capture [bag] | "ε" bag)

%rule directive
  directive-keyword [{directive-argument}] [conditions-clause]

%rule directive-keyword
  | KW-STAGE | KW-EXTEND-STAGE | KW-REDEFINE-STAGE
  | KW-INCLUDE | KW-NAMES | KW-FEATURES | KW-ELISION-ONLY

%rule directive-argument
  directive-identifier | directive-string | directive-terminal | directive-expression

%rule directive-identifier
  Identifier

%rule directive-string
  String | Resource-Path

%rule directive-terminal
  Engine-Tag | range

%rule directive-expression
  expr | Emoji-Name | "_"
%conditions
  ¬($.onward.parse(String …) ∧
    $.first-token.tokens!'value.join() = $.span.tokens!'value.join())

%rule ranking-directive
  KW-AMBIGUITY-RESOLUTION {ranking-step / ","}

%rule ranking-step
  Identifier [pattern-literal | constant-reference]

%rule constant-definition
  constant-keyword constant-name expr

%rule constant-keyword
  KW-CONST | KW-REDEFINE-CONST

%rule constant-name
  Constant
```

<details><summary>Railroad diagrams of the 22 rules from <code>conditions-clause</code> to <code>constant-name</code></summary>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/conditions-clause.svg" alt="Railroad diagram of the rule conditions-clause"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/diagnostic-clause.svg" alt="Railroad diagram of the rule diagnostic-clause"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/error-clause.svg" alt="Railroad diagram of the rule error-clause"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/warning-clause.svg" alt="Railroad diagram of the rule warning-clause"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/suppress-warnings-clause.svg" alt="Railroad diagram of the rule suppress-warnings-clause"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/suppression-code.svg" alt="Railroad diagram of the rule suppression-code"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/output-clause.svg" alt="Railroad diagram of the rule output-clause"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/erased-clause.svg" alt="Railroad diagram of the rule erased-clause"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/emit-clause.svg" alt="Railroad diagram of the rule emit-clause"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/output.svg" alt="Railroad diagram of the rule output"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/directive.svg" alt="Railroad diagram of the rule directive"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/directive-keyword.svg" alt="Railroad diagram of the rule directive-keyword"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/directive-argument.svg" alt="Railroad diagram of the rule directive-argument"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/directive-identifier.svg" alt="Railroad diagram of the rule directive-identifier"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/directive-string.svg" alt="Railroad diagram of the rule directive-string"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/directive-terminal.svg" alt="Railroad diagram of the rule directive-terminal"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/directive-expression.svg" alt="Railroad diagram of the rule directive-expression"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/ranking-directive.svg" alt="Railroad diagram of the rule ranking-directive"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/ranking-step.svg" alt="Railroad diagram of the rule ranking-step"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/constant-definition.svg" alt="Railroad diagram of the rule constant-definition"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/constant-keyword.svg" alt="Railroad diagram of the rule constant-keyword"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/constant-name.svg" alt="Railroad diagram of the rule constant-name"></p>
</details>

## Expressions

Expression rules group operators by precedence. Method names select the syntax of their arguments.

```jbogenbau
%rule expr
  | function
  | disj ["⟹" expr]

%rule function
  Capture "↦" expr

%rule disj
  ["∨"] {conj / "∨"}

%rule conj
  ["∧"] {neg / "∧"}

%rule neg
  "¬" neg | comparison

%rule comparison
  union [comparator union]

%rule comparator
  | "=" | "≤" | "≥" | "<" | ">" | "∈" | "⊆" | "≅"
  | "≠" | "∉" | "⊈" | "≇"

%rule union
  {inter / ("∪" | "∖")}

%rule inter
  {sum / "∩"}

%rule sum
  {post / ("++" | "+")}

%rule post
  atom [{prop | method | map | flatten}]

%rule prop
  "'" key

%rule method
  "." selector

%rule selector
  | named-selector
  | parse-selector
  | neighbor-selector
  | family-selector
  | key-selector
  | width-selector
  | predicate-selector

%rule named-selector
  method-name ["(" [{expr / ","}] ")"]
%conditions
  $.first-token.tokens!'value.join() ∉
    ["parse", "followed-by", "preceded-by", "without-elision-except",
     "has", "has-value", "ngrams", "at-most", "any", "all"]

%rule method-name
  Identifier | Call-Name

%rule parse-selector
  "parse" "(" query-body ")"

%rule query-body
  ["…"] choice ["…"]

%rule neighbor-selector
  ("followed-by" | "preceded-by") "(" {neighbor-target / "|"} ")"

%rule neighbor-target
  target-option | "(" target-option ")"

%rule family-selector
  "without-elision-except" "(" (rule-reference | call | parameter) ")"

%rule key-selector
  ("has" | "has-value") "(" key ")"

%rule width-selector
  ("ngrams" | "at-most") "(" integer ")"

%rule predicate-selector
  ("all" | "any") ["(" [predicate] ")"]

%rule predicate
  expr

%rule map
  "!" (prop | method | "(" predicate ")")

%rule flatten
  "↓"

%rule atom
  | Capture | constant-reference | application | parameter | string | integer
  | pattern-literal | "∅" | bag | list | item-reference | method | grouped-expr

%rule grouped-expr
  "(" expr ["?" expr "|" expr] ")"

%rule application
  Constant-Call "(" expr ")"

%rule item-reference
  "'" [$name:key]
%conditions
  $name ∨ ¬$.following-tokens.parse(key | "'" …)

%rule integer
  Integer

%rule key
  Identifier | Engine-Tag
```

<details><summary>Railroad diagrams of the 33 rules from <code>expr</code> to <code>key</code></summary>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/expr.svg" alt="Railroad diagram of the rule expr"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/function.svg" alt="Railroad diagram of the rule function"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/disj.svg" alt="Railroad diagram of the rule disj"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/conj.svg" alt="Railroad diagram of the rule conj"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/neg.svg" alt="Railroad diagram of the rule neg"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/comparison.svg" alt="Railroad diagram of the rule comparison"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/comparator.svg" alt="Railroad diagram of the rule comparator"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/union.svg" alt="Railroad diagram of the rule union"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/inter.svg" alt="Railroad diagram of the rule inter"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/sum.svg" alt="Railroad diagram of the rule sum"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/post.svg" alt="Railroad diagram of the rule post"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/prop.svg" alt="Railroad diagram of the rule prop"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/method.svg" alt="Railroad diagram of the rule method"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/selector.svg" alt="Railroad diagram of the rule selector"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/named-selector.svg" alt="Railroad diagram of the rule named-selector"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/method-name.svg" alt="Railroad diagram of the rule method-name"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/parse-selector.svg" alt="Railroad diagram of the rule parse-selector"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/query-body.svg" alt="Railroad diagram of the rule query-body"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/neighbor-selector.svg" alt="Railroad diagram of the rule neighbor-selector"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/neighbor-target.svg" alt="Railroad diagram of the rule neighbor-target"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/family-selector.svg" alt="Railroad diagram of the rule family-selector"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/key-selector.svg" alt="Railroad diagram of the rule key-selector"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/width-selector.svg" alt="Railroad diagram of the rule width-selector"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/predicate-selector.svg" alt="Railroad diagram of the rule predicate-selector"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/predicate.svg" alt="Railroad diagram of the rule predicate"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/map.svg" alt="Railroad diagram of the rule map"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/flatten.svg" alt="Railroad diagram of the rule flatten"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/atom.svg" alt="Railroad diagram of the rule atom"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/grouped-expr.svg" alt="Railroad diagram of the rule grouped-expr"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/application.svg" alt="Railroad diagram of the rule application"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/item-reference.svg" alt="Railroad diagram of the rule item-reference"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/integer.svg" alt="Railroad diagram of the rule integer"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/key.svg" alt="Railroad diagram of the rule key"></p>
</details>

## Constructors

A prefix gates or guards one entry. Commas separate entries at their own nesting level.

```jbogenbau
%rule bag
  "{" [{entry / ","}] "}"

%rule entry
  prefix (write-entry | delete-entry | splat-entry | copy-entry | bare-entry)

%rule bare-entry
  key

%rule write-entry
  {key ":"} expr

%rule delete-entry
  "¬" key

%rule splat-entry
  "*" expr

%rule copy-entry
  post
%conditions
  $.last-token.tokens!'value.join() ≠ "'"

%rule prefix
  [{feature-gate}] [guard]

%rule guard
  expr "?"

%rule list
  "[" [{item / ","}] "]"

%rule item
  prefix ["*"] expr
```

<details><summary>Railroad diagrams of the 11 rules from <code>bag</code> to <code>item</code></summary>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/bag.svg" alt="Railroad diagram of the rule bag"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/entry.svg" alt="Railroad diagram of the rule entry"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/bare-entry.svg" alt="Railroad diagram of the rule bare-entry"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/write-entry.svg" alt="Railroad diagram of the rule write-entry"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/delete-entry.svg" alt="Railroad diagram of the rule delete-entry"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/splat-entry.svg" alt="Railroad diagram of the rule splat-entry"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/copy-entry.svg" alt="Railroad diagram of the rule copy-entry"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/prefix.svg" alt="Railroad diagram of the rule prefix"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/guard.svg" alt="Railroad diagram of the rule guard"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/list.svg" alt="Railroad diagram of the rule list"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/item.svg" alt="Railroad diagram of the rule item"></p>
</details>

## Tree patterns

A pattern starts with `#` and one node test, bare child list, or grouped predicate. An exact prefix suppresses the node test's single-child search.

A pattern atom names a rule, terminal, constant, or wildcard. A tag test follows the atom, as in `#_<Tense>`. The reader converts it as [engine §9.3](../../../docs/engine.md#93-conversion-and-validation) says.

The brackets `⁅` and `⁆` enclose child items. A child list attaches to the preceding atom. Only a rule name, emoji rule, template family, exact call, or compatible parameter accepts an attached list.

A bare list or an exact prefix needs whitespace or a comment after a node test, `⁆`, `]`, `}`, or a group's `)`. Thus `⁅ a ⁅b⁆ ⁆` has two items, while `⁅ a⁅b⁆ ⁆` attaches the list to `a`. `⁅ (a)⁅b⁆ ⁆` is an error. After `⋯` or `⋰`, no space is necessary.

The syntax stage does not see layout, which consists of whitespace and comments. The helper rules test adjacency through source text. `adjacent-item-opening` matches two tokens whose joined source text equals the source text of their span. That equality holds only when nothing lies between them.

`pattern-exact-start` keeps `·` adjacent to its node test. `pattern-attached-start` detects a list directly after the complete atom. `pattern-node` tests this condition in both directions, so an adjacent list always attaches and a separated list never does. Its third condition rejects an unattached reading of `a⁅b⁆`, which keeps the attachment routes disjoint.

`pattern-item-opening` reads `⁅` or `·`. `child-item` rejects such an adjacent opening after its last token, except after `⋯` or `⋰`.

A child set has at least one operator. A lone child path is therefore a one-item sequence, and never also a set.

Child lists contain sequences, choices, optional sequences, repeats, and sibling gaps. Paths and set operations combine whole predicates.

Recognition admits repeated or reversed tests on node atoms. Each node atom accepts one tag test, then one value test. A pattern-valued constant atom accepts neither test.

```jbogenbau
%rule pattern-literal
  "#" pattern-primary

%rule pattern-union
  {pattern-intersection / ("∪" | "∖")}

%rule pattern-intersection
  {pattern-path / "∩"}

%rule pattern-path
  ("⋮" | "⋱") pattern-primary
  | pattern-primary ["⋰"]

%rule pattern-primary
  pattern-node | bare-child-list | "(" pattern-union ")"

%rule pattern-node
  [$exact:"·"] $atom:pattern-atom [$list:child-list]
%conditions
  $exact ⟹ $exact.onward.parse(pattern-exact-start …),
  $list ⟹ $atom.onward.parse(pattern-attached-start …),
  ¬$list ⟹ ¬$atom.onward.parse(pattern-attached-start …)

%rule bare-child-list
  [$exact:"·"] child-list
%conditions
  $exact ⟹ $exact.onward.parse(pattern-exact-start …)

%rule pattern-atom
  (pattern-rule | tag | string | range | wildcard | constant-reference) [{symbol-test}]

%rule pattern-rule
  Lowercase-Name | Emoji-Name | call | parameter

%rule child-list
  "⁅" [child-choice] "⁆"

%rule child-choice
  {child-alternative / "|"}

%rule child-alternative
  child-sequence | child-set-operation

%rule child-sequence
  {child-item}

%rule child-set-operation
  child-intersection ("∪" | "∖") {child-intersection / ("∪" | "∖")}
  | child-path "∩" {child-path / "∩"}

%rule child-intersection
  {child-path / "∩"}

%rule child-item
  child-path | child-optional | child-repetition | "⋯"
%conditions
  ¬$.last-token.onward.parse(adjacent-item-opening …)

%rule child-path
  ("⋮" | "⋱") child-primary
  | child-primary ["⋰"]

%rule child-primary
  pattern-node | bare-child-list | "(" child-choice ")"

%rule child-optional
  "[" child-choice "]"

%rule child-repetition
  "{" child-choice ["/" child-choice] "}"

%rule pattern-exact-start
  $mark:"·" $next:_
%conditions
  $.source-text = $mark.source-text ++ $next.source-text

%rule pattern-attached-start
  $atom:pattern-atom $open:"⁅"
%conditions
  $.source-text = $atom.source-text ++ $open.source-text

%rule pattern-item-opening
  "⁅" | "·"

%rule adjacent-item-opening
  $left:_ $right:pattern-item-opening
%conditions
  $left.value ≠ "⋯",
  $left.value ≠ "⋰",
  $.source-text = $left.source-text ++ $right.source-text
```

<details><summary>Railroad diagrams of the 24 rules from <code>pattern-literal</code> to <code>adjacent-item-opening</code></summary>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/pattern-literal.svg" alt="Railroad diagram of the rule pattern-literal"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/pattern-union.svg" alt="Railroad diagram of the rule pattern-union"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/pattern-intersection.svg" alt="Railroad diagram of the rule pattern-intersection"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/pattern-path.svg" alt="Railroad diagram of the rule pattern-path"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/pattern-primary.svg" alt="Railroad diagram of the rule pattern-primary"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/pattern-node.svg" alt="Railroad diagram of the rule pattern-node"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/bare-child-list.svg" alt="Railroad diagram of the rule bare-child-list"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/pattern-atom.svg" alt="Railroad diagram of the rule pattern-atom"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/pattern-rule.svg" alt="Railroad diagram of the rule pattern-rule"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/child-list.svg" alt="Railroad diagram of the rule child-list"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/child-choice.svg" alt="Railroad diagram of the rule child-choice"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/child-alternative.svg" alt="Railroad diagram of the rule child-alternative"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/child-sequence.svg" alt="Railroad diagram of the rule child-sequence"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/child-set-operation.svg" alt="Railroad diagram of the rule child-set-operation"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/child-intersection.svg" alt="Railroad diagram of the rule child-intersection"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/child-item.svg" alt="Railroad diagram of the rule child-item"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/child-path.svg" alt="Railroad diagram of the rule child-path"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/child-primary.svg" alt="Railroad diagram of the rule child-primary"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/child-optional.svg" alt="Railroad diagram of the rule child-optional"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/child-repetition.svg" alt="Railroad diagram of the rule child-repetition"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/pattern-exact-start.svg" alt="Railroad diagram of the rule pattern-exact-start"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/pattern-attached-start.svg" alt="Railroad diagram of the rule pattern-attached-start"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/pattern-item-opening.svg" alt="Railroad diagram of the rule pattern-item-opening"></p>
<p><img src="../../../docs/diagrams/50/gencmu/jbogenbau/syntax/adjacent-item-opening.svg" alt="Railroad diagram of the rule adjacent-item-opening"></p>
</details>
