# jbogenbau: from characters to tokens

This stage reads one token per source character. Each token has its character as its value and image, and its stored engine tags.

The stage follows `../../docs/engine.md`, §9.1. It emits names, strings, captures, constants, guards, keywords, and punctuation. It discards whitespace and comments.

The greedy ranking selects the longest complete piece. The conditions on names prevent a token from ending inside a name.

```jbogenbau
%ambiguity-resolution greedy

%rule text
  ε | text piece

%rule piece
  | word | string | engine-tag | capture-token | constant-token | guard
  | include | keyword | symbol | negation | layout

%rule word
  | lower-name :: Identifier Lowercase-Name
  | upper-name :: Identifier Uppercase-Name
%conditions ¬$.following-tokens.begins(name-character)
%emits $

%rule whole-name
  name
%conditions ¬$.following-tokens.begins(name-character)

%rule name
  letter | name name-character

%rule name-character
  letter | digit | "-" | "_"

%rule letter
  "a".."z" | "A".."Z"

%rule digit
  "0".."9"

%rule engine-tag
  "_" [engine-name]
%conditions ¬$.following-tokens.begins(engine-name-character)
%emits $ :: Engine-Tag

%rule engine-name
  engine-name-character | engine-name engine-name-character

%rule engine-name-character
  letter | digit | "_"

%rule capture-token
  "$$" | "$$" $n:lower-name
%conditions ¬$n.following-tokens.begins(name-character)
%emits $ :: Capture

%rule lower-name
  "a".."z" | lower-name name-character

%rule upper-name
  "A".."Z" | upper-name name-character

%rule constant-token
  | user-constant
  | "$$" "_" [scalar-name]
%conditions ¬$.following-tokens.begins(scalar-name-character)
%emits $ :: Constant

%rule user-constant
  "$$" upper-name
%conditions ¬$.following-tokens.begins(name-character)

%rule scalar-name
  scalar-name-character | scalar-name scalar-name-character

%rule scalar-name-character
  letter | digit

%rule guard
  ["¬"] feature-name "?" | feature-name "!"
%emits $ :: Guard

%rule feature-name
  letter | feature-name feature-character

%rule feature-character
  letter | digit | "-"

%rule negation
  "¬"
%conditions ¬$.following-tokens.begins(guard)
%emits $

%rule string
  $_0022 [{string-part}] $_0022
%emits $ :: String

%rule string-part
  ordinary-string-character | dollar-ready dollar-complete

%rule ordinary-string-character
  $_0000..$_0021 | $_0023 | $_0025..$_005B | $_005D..$_10FFFF

%rule dollar-ready
  ε
%conditions $.onward.begins(dollar-complete)

%rule dollar-complete
  "$$" "$$" | "$$" "(" interpolation-name ")"

%rule interpolation-name
  upper-name | "_" scalar-name

%rule include
  $keyword:include-keyword [layout-run] $path:include-path
%emits $keyword :: KW-INCLUDE, $path :: Include-Path

%rule include-tail
  [layout-run] include-path

%rule include-keyword
  "%" $n:whole-name
%conditions $n.value = "include"

%rule include-path
  $_0022 [{path-part}] $_0022

%rule path-part
  $_0000..$_0021 | $_0023..$_005B | $_005D..$_10FFFF

%rule layout-run
  layout | layout-run layout

%rule layout
  _White_Space | comment

%rule comment
  "(" "*" [{comment-part}] stars ")"

%rule comment-part
  $c:_ | stars $d:_
%conditions $c.value ≠ "*", $d.value ≠ ")", $d.value ≠ "*"

%rule stars
  "*" | stars "*"

%rule keyword

  | "%" $rule:whole-name :: KW-RULE
  | "%" $redefine-rule:whole-name :: KW-REDEFINE-RULE
  | "%" $extend-rule:whole-name :: KW-EXTEND-RULE
  | "%" $conditions:whole-name :: KW-CONDITIONS
  | "%" $emits:whole-name :: KW-EMITS
  | "%" $erased:whole-name :: KW-ERASED
  | "%" $ambiguity-resolution:whole-name :: KW-AMBIGUITY-RESOLUTION
  | "%" $stage:whole-name :: KW-STAGE
  | "%" $extend-stage:whole-name :: KW-EXTEND-STAGE
  | "%" $redefine-stage:whole-name :: KW-REDEFINE-STAGE
  | "%" $include:whole-name :: KW-INCLUDE
  | "%" $features:whole-name :: KW-FEATURES
  | "%" $const:whole-name :: KW-CONST
  | "%" $redefine-const:whole-name :: KW-REDEFINE-CONST
  | "%" $classifier:whole-name :: KW-CLASSIFIER
  | "%" $implies:whole-name :: KW-IMPLIES
  | "%" $other:whole-name :: Keyword
%conditions
  $rule.value = "rule",
  $redefine-rule.value = "redefine-rule",
  $extend-rule.value = "extend-rule",
  $conditions.value = "conditions",
  $emits.value = "emits",
  $erased.value = "erased",
  $ambiguity-resolution.value = "ambiguity-resolution",
  $stage.value = "stage",
  $extend-stage.value = "extend-stage",
  $redefine-stage.value = "redefine-stage",
  $include.value = "include",
  $features.value = "features",
  $const.value = "const",
  $redefine-const.value = "redefine-const",
  $classifier.value = "classifier",
  $implies.value = "implies",
  $other.value ≠ "rule",
  $other.value ≠ "redefine-rule",
  $other.value ≠ "extend-rule",
  $other.value ≠ "conditions",
  $other.value ≠ "emits",
  $other.value ≠ "erased",
  $other.value ≠ "ambiguity-resolution",
  $other.value ≠ "stage",
  $other.value ≠ "extend-stage",
  $other.value ≠ "redefine-stage",
  $other.value ≠ "include",
  $other.value ≠ "features",
  $other.value ≠ "const",
  $other.value ≠ "redefine-const",
  $other.value ≠ "classifier",
  $other.value ≠ "implies",
  $include ⟹ ¬$.following-tokens.begins(include-tail)
%emits $

%rule symbol

  | "|" | "&" | "(" | ")" | "[" | "]" | "{" | "}" | "/" | "+" | "<" | ">" | "#" | "ε" | "," | "∧" | "∨" | "⟹" | "=" | "≠" | "∈" | "∉" | "⊆" | "⊈" | "∪" | "∩" | "∖" | "∅" | "≅" | "≇" | "⋯" | "⋮" | "⋰" | "⋱" | "≻" | ":" | "." | "@"
  | "." "." "." | "." "." | ":" ":" | ":" "=" | ":" "-"
%emits $
```

<details><summary>Railroad diagrams of the 40 rules from <code>text</code> to <code>symbol</code></summary>
<p><img src="../../docs/diagrams/notation/lexical/text.svg" alt="Railroad diagram of the rule text"></p>
<p><img src="../../docs/diagrams/notation/lexical/piece.svg" alt="Railroad diagram of the rule piece"></p>
<p><img src="../../docs/diagrams/notation/lexical/word.svg" alt="Railroad diagram of the rule word"></p>
<p><img src="../../docs/diagrams/notation/lexical/whole-name.svg" alt="Railroad diagram of the rule whole-name"></p>
<p><img src="../../docs/diagrams/notation/lexical/name.svg" alt="Railroad diagram of the rule name"></p>
<p><img src="../../docs/diagrams/notation/lexical/name-character.svg" alt="Railroad diagram of the rule name-character"></p>
<p><img src="../../docs/diagrams/notation/lexical/letter.svg" alt="Railroad diagram of the rule letter"></p>
<p><img src="../../docs/diagrams/notation/lexical/digit.svg" alt="Railroad diagram of the rule digit"></p>
<p><img src="../../docs/diagrams/notation/lexical/engine-tag.svg" alt="Railroad diagram of the rule engine-tag"></p>
<p><img src="../../docs/diagrams/notation/lexical/engine-name.svg" alt="Railroad diagram of the rule engine-name"></p>
<p><img src="../../docs/diagrams/notation/lexical/engine-name-character.svg" alt="Railroad diagram of the rule engine-name-character"></p>
<p><img src="../../docs/diagrams/notation/lexical/capture-token.svg" alt="Railroad diagram of the rule capture-token"></p>
<p><img src="../../docs/diagrams/notation/lexical/lower-name.svg" alt="Railroad diagram of the rule lower-name"></p>
<p><img src="../../docs/diagrams/notation/lexical/upper-name.svg" alt="Railroad diagram of the rule upper-name"></p>
<p><img src="../../docs/diagrams/notation/lexical/constant-token.svg" alt="Railroad diagram of the rule constant-token"></p>
<p><img src="../../docs/diagrams/notation/lexical/user-constant.svg" alt="Railroad diagram of the rule user-constant"></p>
<p><img src="../../docs/diagrams/notation/lexical/scalar-name.svg" alt="Railroad diagram of the rule scalar-name"></p>
<p><img src="../../docs/diagrams/notation/lexical/scalar-name-character.svg" alt="Railroad diagram of the rule scalar-name-character"></p>
<p><img src="../../docs/diagrams/notation/lexical/guard.svg" alt="Railroad diagram of the rule guard"></p>
<p><img src="../../docs/diagrams/notation/lexical/feature-name.svg" alt="Railroad diagram of the rule feature-name"></p>
<p><img src="../../docs/diagrams/notation/lexical/feature-character.svg" alt="Railroad diagram of the rule feature-character"></p>
<p><img src="../../docs/diagrams/notation/lexical/negation.svg" alt="Railroad diagram of the rule negation"></p>
<p><img src="../../docs/diagrams/notation/lexical/string.svg" alt="Railroad diagram of the rule string"></p>
<p><img src="../../docs/diagrams/notation/lexical/string-part.svg" alt="Railroad diagram of the rule string-part"></p>
<p><img src="../../docs/diagrams/notation/lexical/ordinary-string-character.svg" alt="Railroad diagram of the rule ordinary-string-character"></p>
<p><img src="../../docs/diagrams/notation/lexical/dollar-ready.svg" alt="Railroad diagram of the rule dollar-ready"></p>
<p><img src="../../docs/diagrams/notation/lexical/dollar-complete.svg" alt="Railroad diagram of the rule dollar-complete"></p>
<p><img src="../../docs/diagrams/notation/lexical/interpolation-name.svg" alt="Railroad diagram of the rule interpolation-name"></p>
<p><img src="../../docs/diagrams/notation/lexical/include.svg" alt="Railroad diagram of the rule include"></p>
<p><img src="../../docs/diagrams/notation/lexical/include-tail.svg" alt="Railroad diagram of the rule include-tail"></p>
<p><img src="../../docs/diagrams/notation/lexical/include-keyword.svg" alt="Railroad diagram of the rule include-keyword"></p>
<p><img src="../../docs/diagrams/notation/lexical/include-path.svg" alt="Railroad diagram of the rule include-path"></p>
<p><img src="../../docs/diagrams/notation/lexical/path-part.svg" alt="Railroad diagram of the rule path-part"></p>
<p><img src="../../docs/diagrams/notation/lexical/layout-run.svg" alt="Railroad diagram of the rule layout-run"></p>
<p><img src="../../docs/diagrams/notation/lexical/layout.svg" alt="Railroad diagram of the rule layout"></p>
<p><img src="../../docs/diagrams/notation/lexical/comment.svg" alt="Railroad diagram of the rule comment"></p>
<p><img src="../../docs/diagrams/notation/lexical/comment-part.svg" alt="Railroad diagram of the rule comment-part"></p>
<p><img src="../../docs/diagrams/notation/lexical/stars.svg" alt="Railroad diagram of the rule stars"></p>
<p><img src="../../docs/diagrams/notation/lexical/keyword.svg" alt="Railroad diagram of the rule keyword"></p>
<p><img src="../../docs/diagrams/notation/lexical/symbol.svg" alt="Railroad diagram of the rule symbol"></p>
</details>
