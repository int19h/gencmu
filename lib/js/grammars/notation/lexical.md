# jbogenbau: from characters to tokens

The lexical stage opens the [notation dialect](../dialects/notation.md). A stage is one step of a pipeline. A token is one unit that a stage reads or emits.

This stage reads the decomposed character tokens of stage zero. A token's value is the string that exact comparisons read. Its image is the string that people see. Each input token carries its decomposed scalar as both strings and the stored engine tags.

A tag is a named mark on a token. The rules read characters by string terminals, ranges, or engine tags such as `_White_Space`.

The stage passes names, strings, integers, captures, constants, guards, keywords, and punctuation to [syntax.md](syntax.md). It discards whitespace and comments. Each emitted token covers the exact source characters that form it.

[The notation guide](../../docs/notation.md) explains these forms. This document defines their lexical recognition under [engine §9.1](../../docs/engine.md#91-lexical-forms).

## Choosing among readings

The greedy reading favors the longest complete piece. It reads `...` as one symbol rather than three periods.

A name ends only when no name character follows. This prevents a token from ending inside a longer name.

```jbogenbau
%ambiguity-resolution greedy
```

## The text

A text contains any number of pieces. Each piece is a token or layout.

The left-recursive `text` gives each shorter text its own constituent. Greedy ranking can then compare where each piece ends.

```jbogenbau
%rule text
  ε | text piece

%rule piece
  | call-name | parameter-token | emoji-name | word | string | engine-tag
  | capture-token | constant-token | guard
  | include | names | keyword | integer | symbol | negation | layout
```

<details><summary>Railroad diagrams of <code>text</code> and <code>piece</code></summary>
<p><img src="../../docs/diagrams/notation/lexical/text.svg" alt="Railroad diagram of the rule text"></p>
<p><img src="../../docs/diagrams/notation/lexical/piece.svg" alt="Railroad diagram of the rule piece"></p>
</details>

## Names and engine tags

An ordinary name starts with an ASCII letter. Letters, digits, hyphens, and underscores can follow it.

An emoji name contains one scalar with `Emoji_Presentation` and without `Emoji_Component` in the configured Unicode table. Adjacent emoji names remain separate tokens.

`word` distinguishes lowercase and uppercase names while marking both as `Identifier`. The first letter later distinguishes rule names from user tags.

`whole-name` refuses a following name character. Keywords use it so that a keyword cannot stop inside a longer name.

An integer token is a run of decimal digits. The reader permits it only as a positive `.ngrams` argument without leading zeros.

An engine tag starts with `_` and continues with letters, digits, or underscores. A bare `_` is the wildcard. Later recognition rules exclude it where they require a tag.

```jbogenbau
%rule emoji-name
  _Emoji_Presentation<¬_Emoji_Component>
%conditions
  ¬$.following-tokens.begins(call-open)
%emits
  $ :: Emoji-Name

%rule word
  | $lower:lower-name :: Identifier Lowercase-Name
  | upper-name :: Identifier Uppercase-Name
%conditions
  ¬$.following-tokens.begins(name-character),
  $lower ⟹ ¬$.following-tokens.begins(call-open)
%emits
  $

%rule whole-name
  name
%conditions
  ¬$.following-tokens.begins(name-character)

%rule name
  letter | name name-character

%rule name-character
  letter | digit | "-" | "_"

%rule letter
  "a".."z" | "A".."Z"

%rule digit
  "0".."9"

%rule integer
  digit | integer digit
%emits
  $ :: Integer

%rule lower-name
  "a".."z" | lower-name name-character

%rule upper-name
  "A".."Z" | upper-name name-character

%rule engine-tag
  "_" [engine-name]
%conditions
  ¬$.following-tokens.begins(engine-name-character)
%emits
  $ :: Engine-Tag

%rule engine-name
  engine-name-character | engine-name engine-name-character

%rule engine-name-character
  letter | digit | "_"
```

<details><summary>Railroad diagrams of the 13 rules from <code>emoji-name</code> to <code>engine-name-character</code></summary>
<p><img src="../../docs/diagrams/notation/lexical/emoji-name.svg" alt="Railroad diagram of the rule emoji-name"></p>
<p><img src="../../docs/diagrams/notation/lexical/word.svg" alt="Railroad diagram of the rule word"></p>
<p><img src="../../docs/diagrams/notation/lexical/whole-name.svg" alt="Railroad diagram of the rule whole-name"></p>
<p><img src="../../docs/diagrams/notation/lexical/name.svg" alt="Railroad diagram of the rule name"></p>
<p><img src="../../docs/diagrams/notation/lexical/name-character.svg" alt="Railroad diagram of the rule name-character"></p>
<p><img src="../../docs/diagrams/notation/lexical/letter.svg" alt="Railroad diagram of the rule letter"></p>
<p><img src="../../docs/diagrams/notation/lexical/digit.svg" alt="Railroad diagram of the rule digit"></p>
<p><img src="../../docs/diagrams/notation/lexical/integer.svg" alt="Railroad diagram of the rule integer"></p>
<p><img src="../../docs/diagrams/notation/lexical/lower-name.svg" alt="Railroad diagram of the rule lower-name"></p>
<p><img src="../../docs/diagrams/notation/lexical/upper-name.svg" alt="Railroad diagram of the rule upper-name"></p>
<p><img src="../../docs/diagrams/notation/lexical/engine-tag.svg" alt="Railroad diagram of the rule engine-tag"></p>
<p><img src="../../docs/diagrams/notation/lexical/engine-name.svg" alt="Railroad diagram of the rule engine-name"></p>
<p><img src="../../docs/diagrams/notation/lexical/engine-name-character.svg" alt="Railroad diagram of the rule engine-name-character"></p>
</details>

## Calls and parameters

A call name requires an adjacent opening parenthesis. The name does not include that parenthesis. A comment opener takes priority over a call.

A parameter starts with `@` and an ASCII letter. Its remaining characters follow the ordinary name rules.

```jbogenbau
%rule call-name
  lower-name | _Emoji_Presentation<¬_Emoji_Component>
%conditions
  $.following-tokens.begins(call-open),
  ¬$.following-tokens.begins(name-character)
%emits
  $ :: Call-Name

%rule call-open
  "("
%conditions
  ¬$.following-tokens.begins(star-character)

%rule star-character
  "*"

%rule parameter-token
  "@" whole-name
%emits
  $ :: Parameter
```

<details><summary>Railroad diagrams of the 4 rules from <code>call-name</code> to <code>parameter-token</code></summary>
<p><img src="../../docs/diagrams/notation/lexical/call-name.svg" alt="Railroad diagram of the rule call-name"></p>
<p><img src="../../docs/diagrams/notation/lexical/call-open.svg" alt="Railroad diagram of the rule call-open"></p>
<p><img src="../../docs/diagrams/notation/lexical/star-character.svg" alt="Railroad diagram of the rule star-character"></p>
<p><img src="../../docs/diagrams/notation/lexical/parameter-token.svg" alt="Railroad diagram of the rule parameter-token"></p>
</details>

## Captures and constants

A capture is `$` alone or `$` followed by a lowercase name. `$` alone names the enclosing constituent.

A user constant starts with `$` and an uppercase name. An engine scalar reference starts with `$_` and letters or digits. The reader later requires valid hexadecimal digits and a Unicode scalar value.

In these grammar strings, `"$"` denotes one dollar sign. Thus `"$" upper-name` reads a constant.

The boundary conditions prevent either token from ending inside its name. The syntax stage receives each prefixed name as one token.

```jbogenbau
%rule capture-token
  "$" | "$" $n:lower-name
%conditions
  ¬$n.following-tokens.begins(name-character)
%emits
  $ :: Capture

%rule constant-token
  | user-constant
  | "$" "_" [scalar-name]
%conditions
  ¬$.following-tokens.begins(scalar-name-character)
%emits
  $ :: Constant

%rule user-constant
  "$" upper-name
%conditions
  ¬$.following-tokens.begins(name-character)

%rule scalar-name
  scalar-name-character | scalar-name scalar-name-character

%rule scalar-name-character
  letter | digit
```

<details><summary>Railroad diagrams of the 5 rules from <code>capture-token</code> to <code>scalar-name-character</code></summary>
<p><img src="../../docs/diagrams/notation/lexical/capture-token.svg" alt="Railroad diagram of the rule capture-token"></p>
<p><img src="../../docs/diagrams/notation/lexical/constant-token.svg" alt="Railroad diagram of the rule constant-token"></p>
<p><img src="../../docs/diagrams/notation/lexical/user-constant.svg" alt="Railroad diagram of the rule user-constant"></p>
<p><img src="../../docs/diagrams/notation/lexical/scalar-name.svg" alt="Railroad diagram of the rule scalar-name"></p>
<p><img src="../../docs/diagrams/notation/lexical/scalar-name-character.svg" alt="Railroad diagram of the rule scalar-name-character"></p>
</details>

## Feature guards

A feature is a named switch that a grammar tests. Its name starts with a letter and continues with letters, digits, or hyphens.

A guard ends with `?` for a gate or `!` for a warning. A gate can start with `¬`.

A `¬` immediately before a guard belongs to that guard. Elsewhere, `negation` emits it separately for a condition.

```jbogenbau
%rule guard
  ["¬"] feature-name "?" | feature-name "!"
%emits
  $ :: Guard

%rule feature-name
  letter | feature-name feature-character

%rule feature-character
  letter | digit | "-"

%rule negation
  "¬"
%conditions
  ¬$.followed-by(guard)
%emits
  $
```

<details><summary>Railroad diagrams of <code>guard</code>, <code>feature-name</code>, <code>feature-character</code> and <code>negation</code></summary>
<p><img src="../../docs/diagrams/notation/lexical/guard.svg" alt="Railroad diagram of the rule guard"></p>
<p><img src="../../docs/diagrams/notation/lexical/feature-name.svg" alt="Railroad diagram of the rule feature-name"></p>
<p><img src="../../docs/diagrams/notation/lexical/feature-character.svg" alt="Railroad diagram of the rule feature-character"></p>
<p><img src="../../docs/diagrams/notation/lexical/negation.svg" alt="Railroad diagram of the rule negation"></p>
</details>

## Strings

Straight double quotes enclose a string. Ordinary string characters exclude the quote and backslash: U+0022 and U+005C.

Dollar signs are ordinary characters.

A backslash has no string form, so the stage rejects it rather than treating it as an escape.

The reader decodes the complete token only after syntax recognition. This keeps syntax errors ahead of reader errors.

```jbogenbau
%rule string
  $_0022 [{string-part}] $_0022
%emits
  $ :: String

%rule string-part
  ordinary-string-character

%rule ordinary-string-character
  $_0000..$_0021 | $_0023..$_005B | $_005D..$_10FFFF
```

<details><summary>Railroad diagrams of <code>string</code>, <code>string-part</code> and <code>ordinary-string-character</code></summary>
<p><img src="../../docs/diagrams/notation/lexical/string.svg" alt="Railroad diagram of the rule string"></p>
<p><img src="../../docs/diagrams/notation/lexical/string-part.svg" alt="Railroad diagram of the rule string-part"></p>
<p><img src="../../docs/diagrams/notation/lexical/ordinary-string-character.svg" alt="Railroad diagram of the rule ordinary-string-character"></p>
</details>

## Resource paths

`include` reads `%include` and its quoted path together, then emits two tokens. The keyword carries `KW-INCLUDE`, and the path carries `Include-Path`.

`names` reads `%names` and its quoted path in the same way. Its keyword carries `KW-NAMES`. The reader collects leading names declarations before it inspects other string escapes.

An include path keeps dollar signs literally. It excludes quotes and backslashes.

`include-tail` identifies layout followed by a path. The ordinary keyword rule uses it to avoid a competing bare directive token when a path follows.

```jbogenbau
%rule include
  $keyword:include-keyword [layout-run] $path:include-path
%emits
  $keyword :: KW-INCLUDE, $path :: Include-Path

%rule names
  $keyword:names-keyword [layout-run] $path:include-path
%emits
  $keyword :: KW-NAMES, $path :: Include-Path

%rule include-tail
  [layout-run] include-path

%rule include-keyword
  "%" whole-name="include"

%rule names-keyword
  "%" whole-name="names"

%rule include-path
  $_0022 [{path-part}] $_0022

%rule path-part
  $_0000..$_0021 | $_0023..$_005B | $_005D..$_10FFFF
```

<details><summary>Railroad diagrams of the 7 rules from <code>include</code> to <code>path-part</code></summary>
<p><img src="../../docs/diagrams/notation/lexical/include.svg" alt="Railroad diagram of the rule include"></p>
<p><img src="../../docs/diagrams/notation/lexical/names.svg" alt="Railroad diagram of the rule names"></p>
<p><img src="../../docs/diagrams/notation/lexical/include-tail.svg" alt="Railroad diagram of the rule include-tail"></p>
<p><img src="../../docs/diagrams/notation/lexical/include-keyword.svg" alt="Railroad diagram of the rule include-keyword"></p>
<p><img src="../../docs/diagrams/notation/lexical/names-keyword.svg" alt="Railroad diagram of the rule names-keyword"></p>
<p><img src="../../docs/diagrams/notation/lexical/include-path.svg" alt="Railroad diagram of the rule include-path"></p>
<p><img src="../../docs/diagrams/notation/lexical/path-part.svg" alt="Railroad diagram of the rule path-part"></p>
</details>

## Layout

Whitespace and comments separate tokens without contributing meaning. `layout-run` joins consecutive layout pieces for include recognition.

A comment starts with `(*` and ends at the first `*)`. Stars belong to its contents unless the next character is `)`.

These rules emit nothing. Their contents therefore never reach syntax recognition.

```jbogenbau
%rule layout-run
  layout | layout-run layout

%rule layout
  _White_Space | comment

%rule comment
  "(" "*" [{comment-part}] stars ")"

%rule comment-part
  $c:_ | stars $d:_
%conditions
  $c.value ≠ "*", $d.value ∉ (")" "*")

%rule stars
  "*" | stars "*"
```

<details><summary>Railroad diagrams of <code>layout-run</code>, <code>layout</code>, <code>comment</code>, <code>comment-part</code> and <code>stars</code></summary>
<p><img src="../../docs/diagrams/notation/lexical/layout-run.svg" alt="Railroad diagram of the rule layout-run"></p>
<p><img src="../../docs/diagrams/notation/lexical/layout.svg" alt="Railroad diagram of the rule layout"></p>
<p><img src="../../docs/diagrams/notation/lexical/comment.svg" alt="Railroad diagram of the rule comment"></p>
<p><img src="../../docs/diagrams/notation/lexical/comment-part.svg" alt="Railroad diagram of the rule comment-part"></p>
<p><img src="../../docs/diagrams/notation/lexical/stars.svg" alt="Railroad diagram of the rule stars"></p>
</details>

## Keywords

A keyword is `%` followed by a whole name. Each known keyword receives its own tag, such as `KW-RULE`.

An unknown keyword receives `Keyword`, which the syntax grammar never reads. Recognition therefore reports it as a syntax error at that token.

The `%include` and `%names` alternatives apply only when no quoted path follows. A complete directive instead uses its path rule above.

Value tests select known keywords. `$KEYWORDS` holds their exact names. The fallback excludes that set with one membership condition.

```jbogenbau
%const $KEYWORDS
  "rule" "redefine-rule" "extend-rule" "conditions"
  "emits" "erased" "ambiguity-resolution" "stage"
  "extend-stage" "redefine-stage" "include" "features"
  "const" "redefine-const" "classifier" "implies" "names"

%rule keyword
  | "%" whole-name="rule" :: KW-RULE
  | "%" whole-name="redefine-rule" :: KW-REDEFINE-RULE
  | "%" whole-name="extend-rule" :: KW-EXTEND-RULE
  | "%" whole-name="conditions" :: KW-CONDITIONS
  | "%" whole-name="emits" :: KW-EMITS
  | "%" whole-name="erased" :: KW-ERASED
  | "%" whole-name="ambiguity-resolution" :: KW-AMBIGUITY-RESOLUTION
  | "%" whole-name="stage" :: KW-STAGE
  | "%" whole-name="extend-stage" :: KW-EXTEND-STAGE
  | "%" whole-name="redefine-stage" :: KW-REDEFINE-STAGE
  | "%" $include:whole-name="include" :: KW-INCLUDE
  | "%" $names:whole-name="names" :: KW-NAMES
  | "%" whole-name="features" :: KW-FEATURES
  | "%" whole-name="const" :: KW-CONST
  | "%" whole-name="redefine-const" :: KW-REDEFINE-CONST
  | "%" whole-name="classifier" :: KW-CLASSIFIER
  | "%" whole-name="implies" :: KW-IMPLIES
  | "%" $other:whole-name :: Keyword
%conditions
  $other.value ∉ $KEYWORDS,
  $include ⟹ ¬$.following-tokens.begins(include-tail),
  $names ⟹ ¬$.following-tokens.begins(include-tail)
%emits
  $
```

<details><summary>Railroad diagram of <code>keyword</code></summary>
<p><img src="../../docs/diagrams/notation/lexical/keyword.svg" alt="Railroad diagram of the rule keyword"></p>
</details>

## Symbols

`@` starts a parameter token. A bare `@` is invalid.

A symbol is punctuation that no larger lexical form contains. Symbols preserve their input values and images. The operator `≇` has value and image `≅` followed by U+0338. Its `text` retains `≇`.

The greedy reading keeps `...`, `..`, `++`, `::`, `:=`, and `:-` together as compound tokens. `#` and `(` remain separate tokens.

`≻` separates ranked options. `/` separates a repetition's item and separator. Pattern paths and comparisons retain their own punctuation tokens.

```jbogenbau
%rule symbol
  | "«" | "»" | "·"
  | "|" | "&" | "(" | ")" | "[" | "]" | "{" | "}" | "/" | "+" | "<" | ">" | "#" | "ε" | ","
  | "∧" | "∨" | "⟹" | "=" | "∈" | "⊆" | "∪" | "∩" | "∖" | "∅"
  | "≅" | "⋯" | "⋮" | "⋰" | "⋱" | "≻" | ":" | "."
  | "+" "+" | "." "." "." | "." "." | ":" ":" | ":" "=" | ":" "-"
  | ("=" | "∈" | "⊆" | "≅") $_0338
%emits
  $
```

<details><summary>Railroad diagram of <code>symbol</code></summary>
<p><img src="../../docs/diagrams/notation/lexical/symbol.svg" alt="Railroad diagram of the rule symbol"></p>
</details>
