# jbogenbau: from characters to tokens

This is the first stage of the notation dialect, `../dialects/notation.md`. A stage is one step of a pipeline, with its own grammar. The stage reads the text of a grammar document's `jbogenbau` blocks, one token (a unit of input) per character. It hands the notation's tokens to the second stage, `syntax.md`. These tokens are names, strings, tag literals, phoneme tags, character tags, properties, spellings, captures, constants, guards, keywords and symbols. The stage drops what carries no meaning: the spaces between tokens, and the comments.

`../../docs/notation.md` explains the notation. This document and `syntax.md` define it.

A character reaches this grammar with one tag (a label that the grammar reads), its character tag, such as `'a'`. The rules below read a character by that tag, by a range such as `'a'..'z'`, or by a Unicode property such as `'\p{White_Space}'`. Every token that this stage emits is one run of characters. So a token's text is exactly what the author wrote.

## Choosing among readings

A name is the longest run of name characters, and `...` is one symbol, not three periods or `..` and a period. That is the greedy reading: where one reading ends a token and another reads on, the one that reads on wins.

```jbogenbau
%ambiguity-resolution greedy
```

## The text

A text is any number of pieces, each a token or layout.

```jbogenbau
%rule text
  [piece] ...

%rule piece
  | word | string | tag-literal | phoneme | character-tag | property | spelling
  | capture | constant | guard | keyword | symbol | negation | layout
```

## Names and tag literals

A name is an ASCII letter followed by ASCII letters, digits and hyphens. Its first letter decides later whether it names a rule or a terminal. Here, every name is an `identifier`. A tag literal is `~` and a name, such as `~word`, and the stage tags it `tag`.

```jbogenbau
%rule word
  name
%tags
  ~identifier
%emits
  $

%rule tag-literal
  '~' name
%tags
  ~tag
%emits
  $

%rule name
  letter | name name-character

%rule lower-name
  'a'..'z' | lower-name name-character

%rule upper-name
  'A'..'Z' | upper-name name-character

%rule name-character
  letter | digit | '-'

%rule letter
  'a'..'z' | 'A'..'Z'

%rule digit
  '0'..'9'
```

## Strings, character tags, properties and phoneme tags

The grammar author writes a string in straight double quotes. Inside it, a backslash escapes the next character. The second stage's reader decodes `\\`, `\"` and `\u{h…}`, and rejects any other escape (`../../docs/engine.md`, §9). So this stage only has to find where the string ends.

A character tag is written between single quotes, such as `'a'`, and its escapes are `\\`, `\'` and `\u{h…}`. The reader decodes it and makes sure that it holds exactly one character. So this stage finds its end in the same way. A phoneme tag is one character between slashes, `/a/`, and `/./` is the pause.

A property is a quote, `\p`, and anything up to the next quote that no backslash escapes, such as `'\p{L}'`. The stage tags it `property`. A character tag never begins with `\p`, so the two kinds of token never overlap. Later in either token, `\p` is an escape like any other. The stage finds the token's end, and the reader reports the malformed token at its opening quote. The reader makes sure that a property is `'\p{Name}'` with a name that the notation knows (`../../docs/engine.md`, §1, §9).

```jbogenbau
%rule string
  '"' [string-part] ... '"'
%tags
  ~string
%emits
  $

%rule string-part
  | $c(character)
  | '\\' character
%conditions
  text($c) ≠ "\"",
  text($c) ≠ "\\"

%rule character-tag
  '\'' [character-tag-first [character-tag-part] ...] '\''
%tags
  ~character
%emits
  $

%rule character-tag-first
  | $c(character)
  | '\\' $e(character)
%conditions
  text($c) ≠ "'",
  text($c) ≠ "\\",
  text($e) ≠ "p"

%rule character-tag-part
  | $c(character)
  | '\\' character
%conditions
  text($c) ≠ "'",
  text($c) ≠ "\\"

%rule property
  '\'' '\\' 'p' [character-tag-part] ... '\''
%tags
  ~property
%emits
  $

%rule phoneme
  '/' character '/'
%tags
  ~phoneme
%emits
  $

%rule character
  '\p{Any}'
```

## Spellings

A spelling says what a symbol must sound like, as in ``LE`la` ``. It is the characters between two backticks. It has no escapes, so it cannot hold a backtick. The second stage's reader rejects empty spellings and spellings that lowercasing changes (`../../docs/engine.md`, §9). This stage only finds the spelling's end. So two backticks with nothing between them are still one token, which the reader reports.

```jbogenbau
%rule spelling
  '`' [spelling-part] ... '`'
%tags
  ~spelling
%emits
  $

%rule spelling-part
  $c(character)
%conditions
  text($c) ≠ "`"
```

## Captures, constants, guards and keywords

A capture is `$` and a name that begins with a lower-case letter, or `$` alone for the whole constituent. A constant is `$` and a name that begins with a capital, such as `$SU-STOPS`. The stage tags it `constant`.

A feature guard tests a feature. A feature is a named switch that the grammars test. A guard is either a gate or a warning. A gate is a name and `?`, with `¬` before it for a negated gate. A warning is a name and `!`.

A `¬` directly before a guard belongs to the guard. Anywhere else, `¬` is a symbol of its own, which negates a condition. So the symbol `¬` is only read where no guard begins after it.

```jbogenbau
%rule capture
  '$' [lower-name]
%tags
  ~capture
%emits
  $

%rule constant
  '$' upper-name
%tags
  ~constant
%emits
  $

%rule guard
  | ['¬'] name '?'
  | name '!'
%tags
  ~guard
%emits
  $

%rule negation
  '¬'
%conditions
  ¬begins(after($), guard)
%emits
  $
```

A keyword is `%` and a name. The stage tags each keyword that the notation knows with its own identifier, such as `keyword-rule` for `%rule`. So the second stage names each keyword it knows and has no other. Any other `%` and name is one token tagged `keyword`, which the second stage never reads. So an unknown keyword is an error at that token. Each capture, constant, guard and keyword is one token, so the second stage sees `$first` as one thing.

```jbogenbau
%rule keyword
  | '%' $rule(name) <~keyword-rule>
  | '%' $redefine-rule(name) <~keyword-redefine-rule>
  | '%' $extend-rule(name) <~keyword-extend-rule>
  | '%' $tags(name) <~keyword-tags>
  | '%' $conditions(name) <~keyword-conditions>
  | '%' $emits(name) <~keyword-emits>
  | '%' $verbatim(name) <~keyword-verbatim>
  | '%' $ambiguity-resolution(name) <~keyword-ambiguity-resolution>
  | '%' $elidable(name) <~keyword-elidable>
  | '%' $stage(name) <~keyword-stage>
  | '%' $include(name) <~keyword-include>
  | '%' $features(name) <~keyword-features>
  | '%' $const(name) <~keyword-const>
  | '%' $redefine-const(name) <~keyword-redefine-const>
  | '%' $other(name) <~keyword>
%conditions
  text($rule) = "rule",
  text($redefine-rule) = "redefine-rule",
  text($extend-rule) = "extend-rule",
  text($tags) = "tags",
  text($conditions) = "conditions",
  text($emits) = "emits",
  text($verbatim) = "verbatim",
  text($ambiguity-resolution) = "ambiguity-resolution",
  text($elidable) = "elidable",
  text($stage) = "stage",
  text($include) = "include",
  text($features) = "features",
  text($const) = "const",
  text($redefine-const) = "redefine-const",
  text($other) ≠ "rule", text($other) ≠ "redefine-rule", text($other) ≠ "extend-rule",
  text($other) ≠ "tags", text($other) ≠ "conditions", text($other) ≠ "emits",
  text($other) ≠ "verbatim", text($other) ≠ "ambiguity-resolution", text($other) ≠ "elidable",
  text($other) ≠ "stage", text($other) ≠ "include", text($other) ≠ "features",
  text($other) ≠ "const", text($other) ≠ "redefine-const"
%emits
  $
```

## Symbols

Every other token is a symbol. A symbol of one character keeps the character tag of its one character, such as `'|'`. The rule for `...` tags it `ellipsis`, and `..`, which joins the two ends of a range, is `double-dot`.

```jbogenbau
%rule symbol
  | '|' | '&' | '(' | ')' | '[' | ']' | '<' | '>' | '#' | 'ε' | ',' | '∧' | '∨' | '⟹'
  | '=' | '≠' | '∈' | '∉' | '⊆' | '⊈' | '∪' | '∩' | '∖' | '∅'
  | '.' '.' '.' <~ellipsis>
  | '.' '.' <~double-dot>
%emits
  $
```

## Layout

Spaces, tabs and line breaks separate tokens and mean nothing else. A comment runs from `(*` to the first `*)` after it and means nothing at all. The stage emits neither: the rules below have no `%emits`, and nothing under them has one.

```jbogenbau
%rule layout
  space | comment

%rule space
  '\p{White_Space}'

%rule comment
  '(' '*' [comment-part] ... stars ')'

%rule comment-part
  | $c(character)
  | stars $d(character)
%conditions
  text($c) ≠ "*",
  text($d) ≠ ")",
  text($d) ≠ "*"

%rule stars
  '*' | stars '*'
```
