# jbogenbau: from characters to tokens

This is the first stage of the notation dialect, `../dialects/notation.md`. It reads the text of a grammar document's `jbogenbau` blocks, one token per character, and hands the second stage, `syntax.md`, the notation's tokens: names, strings, phoneme tags, captures, guards, keywords and symbols. It drops what carries no meaning, the spaces between tokens and the comments. The notation is explained in `../../docs/notation.md`; this document and `syntax.md` define it.

A character reaches this grammar tagged with itself, `"a"`, and, weakly, with its class, `"alpha"`, `"digit"`, `"space"`, `"mark"` or `"other"`. Every token this stage emits is one run of characters, so a token's text is exactly what the author wrote.

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
  word | string | phoneme | capture | guard | keyword | symbol | layout
```

## Names

A name is a letter followed by letters, digits and hyphens. Whether it names a rule or a terminal is decided later, by its first letter; here every name is an `identifier`.

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

A string is written in straight double quotes. Inside it, a backslash escapes the next character; the second stage's reader decodes `\\`, `\"` and `\u{h…}` and rejects any other escape, so this stage only has to find where the string ends. A phoneme tag is one character between slashes, `/a/`, and `/./` is the pause.

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

## Captures, guards and keywords

A capture is `$` and a name, or `$` alone for the whole constituent; a feature guard is a gate, `@` or `@¬`, a name and `?`, or a warning, `@`, a name and `!`; a keyword is `%` and a name, tagged with its own spelling, `%rule`, so that the second stage names each keyword it knows and has no other. Each is one token, so the second stage sees `$first` as one thing.

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

Every other token is a symbol, tagged with its own spelling. Most are one character, which already carries its spelling as a tag; `...` says its own.

```jbogenbau
%rule symbol
  | "|" | "&" | "(" | ")" | "[" | "]" | "<" | ">" | "#" | "ε" | "," | "∧" | "∨" | "¬" | "⟹"
  | "?" | "=" | "≠" | "∈" | "∉" | "⊆" | "∪" | "∩" | "∅"
  | "." "." "." <"...">
%emits
  $
```

## Layout

Spaces, tabs and line breaks separate tokens and mean nothing else. A comment runs from `(*` to the first `*)` after it and means nothing at all. Neither is emitted: the rules below have no `%emits`, and nothing under them has one.

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
