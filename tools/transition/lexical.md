# Transition lexer

The lexer reads one token or layout piece at a time. The left-recursive text rule lets greedy ranking compare piece lengths.

```jbogenbau
%ambiguity-resolution greedy

%rule text
  ε | text piece

%rule piece
  | call-name | parameter-token | emoji-name | identifier | string
  | engine-tag | wildcard | capture-token
  | constant-token | constant-call-token | include-directive | names-directive | keyword
  | integer | punctuation | layout

```

## Names and numbers

Names end before layout or comments. A name immediately before an opening parenthesis can act as a call name.

```jbogenbau
%rule emoji-name
  _Emoji_Presentation<¬_Emoji_Component>≠"#"
%conditions
  ¬$.parse(letter),
  ¬$.following-tokens.parse(call-open …)
%emits
  $ :: Emoji-Name

%rule identifier :: Identifier
  | $lower:lower-initial-name :: Lowercase-Name
  | upper-initial-name :: Uppercase-Name
%conditions
  ¬$.following-tokens.parse(name-character …),
  ($lower ∨ $.parse(_Emoji_Presentation<¬_Emoji_Component>)) ⟹
    ¬$.following-tokens.parse(call-open …)
%emits
  $

%rule whole-name
  name
%conditions
  ¬$.following-tokens.parse(name-character …)

%rule name
  letter | name name-character

%rule name-character
  letter | digit | name-hyphen | "_"

%rule name-hyphen
  "-"
%conditions
  $.following-tokens.first-token.value ≠ "-"

%rule letter
  "a".."z"
  | "A".."Z"

%rule digit
  "0".."9"

%rule integer
  digit | integer digit
%emits
  $ :: Integer

%rule lower-initial-name
  "a".."z"
  | lower-initial-name name-character

%rule upper-initial-name
  "A".."Z"
  | upper-initial-name name-character

```

## Engine keys

An underscore alone is a wildcard. The key rule consumes the full name, including a dot between digits.

```jbogenbau
%rule wildcard
  "_"
%conditions
  ¬$.following-tokens.parse(engine-name-part …)
%emits
  $

%rule engine-tag
  "_" engine-name
%conditions
  ¬$.following-tokens.parse(engine-name-part …)
%emits
  $ :: Engine-Tag

%rule engine-name
  engine-name-part | engine-name engine-name-part

%rule engine-name-part
  letter | digit | "_" | engine-digit-dot

%rule engine-digit-dot
  digit "."
%conditions
  $.following-tokens.parse(digit …)

```

## Calls and binders

A call name ends just before its opening parenthesis. Parameter and capture prefixes distinguish the two kinds of binders.

```jbogenbau
%rule call-name
  lower-initial-name
  | $emoji:_Emoji_Presentation<¬_Emoji_Component>≠"#"
%conditions
  $emoji ⟹ ¬$emoji.parse("a".."z"),
  $.following-tokens.parse(call-open …)
%emits
  $ :: Call-Name

%rule call-open
  "("

%rule parameter-token
  "@" whole-name
%emits
  $ :: Parameter

%rule capture-token
  "$" [lower-initial-name]
%conditions
  ¬$.following-tokens.parse(name-character …)
%emits
  $ :: Capture

%rule constant-token
  "$" upper-initial-name
%conditions
  ¬$.following-tokens.parse(name-character | call-open …)
%emits
  $ :: Constant

%rule constant-call-token
  "$" upper-initial-name
%conditions
  $.following-tokens.parse(call-open …)
%emits
  $ :: Constant-Call

```

## Strings and resources

A quoted string keeps layout and comment characters inside the quotes. Include and names directives tag their path as a resource.

```jbogenbau
%rule string
  quoted-string
%emits
  $ :: String

%rule quoted-string
  "‹U+0022›" [{string-character}] "‹U+0022›"

%rule string-character
  "‹U+0000›".."‹U+0021›"
  | "‹U+0023›".."‹U+10FFFF›"

%rule include-directive
  $keyword:include-keyword [layout-run] $path:resource-path
%emits
  $keyword :: KW-INCLUDE, $path :: Resource-Path

%rule names-directive
  $keyword:names-keyword [layout-run] $path:resource-path
%emits
  $keyword :: KW-NAMES, $path :: Resource-Path

%rule resource-path-tail
  [layout-run] resource-path

%rule include-keyword
  "%" whole-name="include"

%rule names-keyword
  "%" whole-name="names"

%rule resource-path
  quoted-string

```

## Layout

Whitespace and comments separate tokens. The lexer emits no token for layout.

```jbogenbau
%rule layout-run
  layout | layout-run layout

%rule layout
  _White_Space | comment

%rule comment
  "-" "-" [{comment-character}]
%conditions
  $.following-tokens.first-token.value ∈ ("" "‹U+000A›" "‹U+000D›")

%rule comment-character
  _
%conditions
  $.value ∉ ("‹U+000A›" "‹U+000D›")

```

## Keywords

The classifier gives known directives distinct keys. An unknown percent name stays a keyword so the syntax stage can reject it.

```jbogenbau
%classifier keywords
  "rule" ∈ KW-RULE
  "redefine-rule" ∈ KW-REDEFINE-RULE
  "extend-rule" ∈ KW-EXTEND-RULE
  "conditions" ∈ KW-CONDITIONS
  "error" ∈ KW-ERROR
  "warning" ∈ KW-WARNING
  "suppress-warnings" ∈ KW-SUPPRESS-WARNINGS
  "emit" ∈ KW-EMIT
  "erased" ∈ KW-ERASED
  "ambiguity-resolution" ∈ KW-AMBIGUITY-RESOLUTION
  "elision-only" ∈ KW-ELISION-ONLY
  "stage" ∈ KW-STAGE
  "extend-stage" ∈ KW-EXTEND-STAGE
  "redefine-stage" ∈ KW-REDEFINE-STAGE
  "include" ∈ KW-INCLUDE
  "names" ∈ KW-NAMES
  "features" ∈ KW-FEATURES
  "const" ∈ KW-CONST
  "redefine-const" ∈ KW-REDEFINE-CONST

%rule keyword
  | "%" $name:whole-name :: $name.value.classify(keywords)
  | "%" $other:whole-name :: Keyword
%conditions
  $name.value.classify(keywords) ≠ ∅,
  $other.value.classify(keywords) = ∅,
  $name.value = "include" ⟹ ¬$.following-tokens.parse(resource-path-tail …),
  $name.value = "names" ⟹ ¬$.following-tokens.parse(resource-path-tail …)
%emits
  $

```

## Punctuation

The longest compound operator wins. The emoji name rule emits eligible single punctuation scalars, and the syntax stage can still match their value.

```jbogenbau
%rule punctuation
  | "⁅" | "⁆" | "·" | "…" | "*" | "|" | "&" | "(" | ")" | "[" | "]" | "{" | "}"
  | "/" | "+" | "<" | ">" | "#" | "ε" | "," | "∧" | "∨" | "⟹" | "=" | "∈" | "⊆"
  | "∪" | "∩" | "∖" | "∅" | "≅" | "≤" | "≥" | "≝" | "⋯" | "⋮" | "⋰" | "⋱" | "≻" | ":" | "."
  | "+" "+" | "." "." "." | "." "."
  | "→" | "^" | "?" | "¬" | "↦" | "!" | "↓" | "'"
  | ("=" | "∈" | "⊆" | "≅") "‹U+0338›"
%conditions
  ¬$.parse(_Emoji_Presentation<¬_Emoji_Component>≠"#")
%emits
  $
```
