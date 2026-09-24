# The notation: from characters to tokens

This is the first stage of the notation dialect, `../dialects/notation.md`. It reads the text of a grammar document's `ebnf` blocks, one token per character, and hands the second stage, `syntax.md`, the notation's tokens: names, strings, phoneme tags, captures, guards, directives and symbols. It drops what carries no meaning, the spaces between tokens and the comments. The notation is explained in `../../docs/notation.md`; this document and `syntax.md` define it.

A character reaches this grammar tagged with itself, `"a"`, and, weakly, with its class, `"alpha"`, `"digit"`, `"space"`, `"mark"` or `"other"`. Every token this stage emits is one run of characters, so a token's text is exactly what the author wrote.

## Choosing among readings

A name is the longest run of name characters, and `|≔` is one symbol, not `|` followed by `≔`. That is the greedy reading: where one reading ends a token and another reads on, the one that reads on wins.

```ebnf
%ambiguity-resolution greedy ;
```

## The text

A text is any number of pieces, each a token or layout.

```ebnf
text ≔ [piece] ... ;

piece ≔
| word
| string
| phoneme
| capture
| guard
| directive
| symbol
| layout
;
```

## Names

A name is a letter followed by letters, digits and hyphens. Whether it names a rule or a terminal is decided later, by its first letter; here every name is an `identifier`.

```ebnf
word ≔ name <"identifier"> ⇒ $ ;

name ≔ letter | name name-character ;

name-character ≔ letter | digit | "-" ;

letter ≔
| "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m"
| "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z"
| "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L" | "M"
| "N" | "O" | "P" | "Q" | "R" | "S" | "T" | "U" | "V" | "W" | "X" | "Y" | "Z"
;

digit ≔ "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" ;
```

## Strings and phoneme tags

A string is written in straight double quotes. Inside it, a backslash escapes the next character; the second stage's reader decodes `\\`, `\"` and `\u{h…}` and rejects any other escape, so this stage only has to find where the string ends. A phoneme tag is one character between slashes, `/a/`, and `/./` is the pause.

```ebnf
string ≔ "\"" [string-part] ... "\"" <"string"> ⇒ $ ;

string-part ≔
| $c(character)
| "\\" character
: text($c) ≠ "\"" ∧ text($c) ≠ "\\"
;

phoneme ≔ "/" character "/" <"phoneme"> ⇒ $ ;

character ≔ "alpha" | "digit" | "space" | "mark" | "other" ;
```

## Captures, guards and directives

A capture is `$` and a name, or `$` alone for the whole constituent; a feature guard is `@` or `@¬` and a name; a directive is `%` and a name. Each is one token, so the second stage sees `$first` as one thing.

```ebnf
capture ≔ "$" [name] <"capture"> ⇒ $ ;

guard ≔ "@" ["¬"] name <"guard"> ⇒ $ ;

directive ≔ "%" name <"directive"> ⇒ $ ;
```

## Symbols

Every other token is a symbol, tagged with its own spelling. Most are one character, which already carries its spelling as a tag; the two longer ones say theirs.

```ebnf
symbol ≔
| "≔" | "|" | "&" | "(" | ")" | "[" | "]" | "<" | ">" | "#" | "ε" | "⇒" | ":" | ";" | ","
| "∧" | "∨" | "¬" | "?" | "=" | "≠" | "∈" | "∉" | "⊆" | "∪" | "∩" | "∅"
⇒ $ ;

symbol |≔
| "|" "≔" <"|≔">
| "." "." "." <"...">
⇒ $ ;
```

## Layout

Spaces, tabs and line breaks separate tokens and mean nothing else. A comment runs from `(*` to the first `*)` after it and means nothing at all. Neither is emitted: the rules below say nothing after `⇒`, and nothing under them does.

```ebnf
layout ≔ "space" | comment ;

comment ≔ "(" "*" [comment-part] ... stars ")" ;

comment-part ≔
| $c(character)
| stars $d(character)
: text($c) ≠ "*" ∧ text($d) ≠ ")" ∧ text($d) ≠ "*"
;

stars ≔ "*" | stars "*" ;
```
