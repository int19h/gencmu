# jbogenbau: from characters to tokens

This stage reads one token per source character. Each token has its character as its value and image, and its stored engine tags.

The stage follows `../../docs/engine.md`, §9.1. It emits names, strings, captures, constants, guards, keywords, and punctuation. It discards whitespace and comments.

The greedy ranking selects the longest complete piece. The conditions on names prevent a token from ending inside a name.

```jbogenbau
%ambiguity-resolution greedy

%rule text
  ε | text piece

%rule piece
  word | string | engine-tag | capture-token | constant-token | guard | include | keyword | symbol | negation | layout

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
%emits $ :: Engine-Tag

%rule engine-name
  engine-name-character | engine-name engine-name-character
%conditions ¬$.following-tokens.begins(engine-name-character)

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
  $c:_ | "$$" "$$" | "$$" "(" interpolation-name ")"
%conditions $c.value ≠ "$(_0022)", $c.value ≠ "$(_005C)", $c.value ≠ "$$"

%rule interpolation-name
  upper-name | "_" scalar-name

%rule include
  $keyword:include-keyword [layout-run] $path:include-path
%emits $keyword :: KW-INCLUDE, $path :: Include-Path

%rule include-keyword
  "%" $n:whole-name
%conditions $n.value = "include"

%rule include-path
  $_0022 [{path-part}] $_0022

%rule path-part
  $c:_
%conditions $c.value ≠ "$(_0022)", $c.value ≠ "$(_005C)"

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
  $other.value ≠ "implies"
%emits $

%rule symbol

  | "|" | "&" | "(" | ")" | "[" | "]" | "{" | "}" | "/" | "+" | "<" | ">" | "#" | "ε" | "," | "∧" | "∨" | "⟹" | "=" | "≠" | "∈" | "∉" | "⊆" | "⊈" | "∪" | "∩" | "∖" | "∅" | "≅" | "≇" | "⋯" | "⋮" | "⋰" | "⋱" | "≻" | ":" | "." | "@"
  | "." "." "." | "." "." | ":" ":" | ":" "=" | ":" "-"
%emits $
```
