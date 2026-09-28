# jbogenbau: from characters to tokens

This is the first stage of the notation dialect, `../dialects/notation.md`. A stage is one step of a pipeline, with its own grammar. The stage reads the text of a grammar document's `jbogenbau` blocks, one token (a unit of input) per character. It hands the notation's tokens to the second stage, `syntax.md`. These tokens are names, strings, phoneme tags, spellings, captures, guards, keywords and symbols. The stage drops what carries no meaning: the spaces between tokens, and the comments.

`../../docs/notation.md` explains the notation. This document and `syntax.md` define it.

A character reaches this grammar with two tags (labels that the grammar reads). The first tag is the character itself, `"a"`. The second tag is its class, `"alpha"`, `"digit"`, `"space"`, `"mark"` or `"other"`, and this tag is weak. At their first differing visible action, if both readings read one token under different tags, a strong tag beats a weak one. Every token that this stage emits is one run of characters. So a token's text is exactly what the author wrote.

## Choosing among readings

A name is the longest run of name characters, and `...` is one symbol, not three periods. That is the greedy reading: where one reading ends a token and another reads on, the one that reads on wins.

```jbogenbau
%ambiguity-resolution greedy
```

## The text

A text is any number of pieces, each a token or layout.

```jbogenbau
%rule text
  [piece] ...

%rule piece
  word | string | phoneme | spelling | capture | guard | keyword | symbol | layout
```

## Names

A name is an ASCII letter followed by ASCII letters, digits and hyphens. Its first letter decides later whether it names a rule or a terminal. Here, every name is an `identifier`.

```jbogenbau
%rule word
  name
%tags
  "identifier"
%emits
  $

%rule name
  letter | name name-character

%rule name-character
  letter | digit | "-"

%rule letter
  | "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m"
  | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z"
  | "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L" | "M"
  | "N" | "O" | "P" | "Q" | "R" | "S" | "T" | "U" | "V" | "W" | "X" | "Y" | "Z"

%rule digit
  "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
```

## Strings and phoneme tags

The grammar author writes a string in straight double quotes. Inside it, a backslash escapes the next character. The second stage's reader decodes `\\`, `\"` and `\u{h…}`, and rejects any other escape (`../../docs/engine.md`, §9). So this stage only has to find where the string ends. A phoneme tag is one character between slashes, `/a/`, and `/./` is the pause.

```jbogenbau
%rule string
  "\"" [string-part] ... "\""
%tags
  "string"
%emits
  $

%rule string-part
  | $c(character)
  | "\\" character
%conditions
  text($c) ≠ "\"",
  text($c) ≠ "\\"

%rule phoneme
  "/" character "/"
%tags
  "phoneme"
%emits
  $

%rule character
  "alpha" | "digit" | "space" | "mark" | "other"
```

## Spellings

A spelling says what a symbol must sound like, as in ``LE`la` ``. It is the characters between two backticks. It has no escapes, so it cannot hold a backtick. The second stage's reader rejects empty spellings and spellings that lowercasing changes (`../../docs/engine.md`, §9). This stage only finds the spelling's end. So two backticks with nothing between them are still one token, which the reader reports.

```jbogenbau
%rule spelling
  "`" [spelling-part] ... "`"
%tags
  "spelling"
%emits
  $

%rule spelling-part
  $c(character)
%conditions
  text($c) ≠ "`"
```

## Captures, guards and keywords

A capture is `$` and a name, or `$` alone for the whole constituent. A feature guard tests a feature. A feature is a named switch that the grammars test. A guard is either a gate or a warning. A gate is `@` or `@¬`, a name and `?`. A warning is `@`, a name and `!`.

A keyword is `%` and a name. The stage tags a keyword with its own spelling, `%rule`, so that the second stage names each keyword it knows and has no other. Each capture, guard and keyword is one token, so the second stage sees `$first` as one thing.

```jbogenbau
%rule capture
  "$" [name]
%tags
  "capture"
%emits
  $

%rule guard
  | "@" ["¬"] name "?"
  | "@" name "!"
%tags
  "guard"
%emits
  $

%rule keyword
  "%" name
%emits
  $ <text($)>
```

## Symbols

Every other token is a symbol, tagged with its own spelling. Most symbols are one character, which already carries its spelling as a tag. The rule for `...` states its own tag.

```jbogenbau
%rule symbol
  | "|" | "&" | "(" | ")" | "[" | "]" | "<" | ">" | "#" | "ε" | "," | "∧" | "∨" | "¬" | "⟹"
  | "?" | "=" | "≠" | "∈" | "∉" | "⊆" | "∪" | "∩" | "∅"
  | "." "." "." <"...">
%emits
  $
```

## Layout

Spaces, tabs and line breaks separate tokens and mean nothing else. A comment runs from `(*` to the first `*)` after it and means nothing at all. The stage emits neither: the rules below have no `%emits`, and nothing under them has one.

```jbogenbau
%rule layout
  "space" | comment

%rule comment
  "(" "*" [comment-part] ... stars ")"

%rule comment-part
  | $c(character)
  | stars $d(character)
%conditions
  text($c) ≠ "*",
  text($d) ≠ ")",
  text($d) ≠ "*"

%rule stars
  "*" | stars "*"
```
