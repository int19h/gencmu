# jbogenbau, the grammar notation

Every grammar in gencmu is a Markdown document. Its fenced `jbogenbau` blocks, read in order, are one grammar, and the prose between the blocks explains it. This document explains jbogenbau, the notation that those blocks use. The grammars only say what they are about, and refer here for the rest. Two grammars written in jbogenbau itself define it: `grammars/notation/lexical.md` and `grammars/notation/syntax.md`.

A jbogenbau grammar is an attribute grammar with EBNF rule bodies. An attribute grammar is a grammar whose constituents carry computed values. A constituent is a part of the text that one rule matched. EBNF (Extended Backus-Naur Form) is a common notation for the bodies of grammar rules. Each rule body is EBNF close to the form that *The Complete Lojban Language* (CLL) prints in chapter 21, except for repetition and elidable terminators. Each constituent carries one attribute, its set of tags (names, phonemes or characters, such as `KOhA`, `/a/` or `'a'`), computed bottom-up from its parts.

Conditions over the parts restrict which parses exist. A condition can also ask whether a part parses as another rule. This takes the grammar beyond context-free grammars, whose rules only combine symbols. It goes beyond them in the way that Boolean grammars do. In a Boolean grammar, a rule can also require that the same text matches, or does not match, another rule.

A token is one unit that a grammar reads or emits. Examples are characters, phonemes and words. A transducer reads tokens and emits another sequence. Each rule can also say what its constituents hand to the next grammar. So a grammar is a transducer. A dialect is a pipeline of these grammars, its stages, defined by one pipeline document.

A grammar is unordered: its alternatives are not ranked. Where a text has more than one parse, one rule makes the choice afterwards. The section "Ambiguity" describes that rule.

## Rules

A grammar is a sequence of rules, directives (see "Directives"), constants (see "Constants"), classifiers (see "Classifiers") and implications (see "Implications"). Each one begins with a keyword, which is a word after `%`, and ends where the next one begins. A rule is `%rule`, its name, and its body:

```jbogenbau
%rule sumti-tail
  [sumti-6 [relative-clauses]] sumti-tail-1 | relative-clauses sumti-tail-1
```

Line breaks and indentation mean nothing. So a long list of alternatives can put each alternative on a line of its own, and every `|` can also stand first. By convention, authors indent the body by two spaces under the keyword:

```jbogenbau
%rule term-connective
  | joik #
  | jek #
  | ek #
  | VUhU #
```

The same is true of every other separator of the notation. These are `&` in bodies, `∪` and `∩` in terms, `∧` and `∨` in conditions, and the commas of a clause's list. `∖` in terms and `\` in braces are not separators of this kind, so neither can stand first. A tag term is a term that gives a set of tags.

A body can be followed by clauses. A clause is a keyword and what it says. A body has at most one clause of each kind, and the clauses come in this order:

- `%tags` gives the tags that the constituent of every alternative carries.
- `%conditions` states what must hold of the parts.
- `%emits` states what the constituent hands to the next stage.
- `%opaque` makes the constituent one part during emission. That part sounds `?` and shows its text.

The sections below explain each clause.

`(* ... *)` is a comment, anywhere in a block.

## Names and terminals

A name is an ASCII letter followed by ASCII letters, digits and hyphens. A name that begins with a lower-case letter is a rule, and must be defined in the stage. A name that begins with an upper-case letter is a terminal. A terminal matches a token of the input that carries that name as a tag. For example, `KOhA` matches a word that the lexicon tagged KOhA.

A tag is of one of three kinds. A tag has no strength: a token either carries it or not.

- An identifier tag is a name, such as `KOhA` or `run-initial`. By convention, a name that begins with a capital is a class, such as a selma'o (a class of Lojban particles). Any other name is a mark.
- A phoneme tag is one phoneme between slashes, such as `/a/`, `/'/`, and `/./` for a pause.
- A character tag is one character between single quotes, such as `'a'`. The quotes are part of the tag's name.

A tag literal is a tag written as a value: a set of that one tag. `~name` is the identifier tag `name`. A bare name that begins with a capital is the same thing, wherever a tag literal can stand. So `KOhA` and `~KOhA` are one tag, in a body, in a tag term and in a set expression.

A bare name that begins with a lower-case letter is never a tag. It names a rule, or a classifier (see "Classifiers"). So `~run-initial` needs its `~`.

A tag literal is a terminal in a body. So is a phoneme tag, `/a/`, and a character tag, `'a'`. A phoneme tag matches like any tag, and it also says what a token that carries it sounds like. `phonemes()` reads that sound. A character tag matches a character of the text, in the first stage (see "Pipelines").

A character tag names one Unicode scalar value, and that value is its identity. Inside the quotes, `\'` is a quote and `\\` a backslash. `\u{ED80}` is the character with that hexadecimal value. The value has one to six digits. It is at most `10FFFF`, and it is not a surrogate, `D800` to `DFFF`. So `'a'` and `'\u{61}'` are one tag, and `'\u{301}'` is a combining acute accent.

A range, `'a'..'z'`, is the character tags from `'a'` to `'z'`, by scalar value. It skips the surrogates, so `'\u{D7FF}'..'\u{E000}'` is two tags. Its ends take the escapes of a character tag. A range whose start is above its end is an error. `...` is always a chain marker (see "Repetition"), never part of a range, so `'a'...'z'` is an error.

A property, `'\p{L}'`, is the characters that have a property in the Unicode data of `grammars/unicode.txt`. Its name is a General_Category value in its short form, such as `Lu` or `Nd`. It can also name a group of values by their first letter, such as `L`. `White_Space` and `Any`, every character, are the two other names. The case of a name counts, and no long name or alias is a property, so `'\p{lu}'` and `'\p{Letter}'` are errors. The engine documentation lists every name (`docs/engine.md`, §1).

A range and a property are terminals in a body. Each matches a token that carries one of its characters, once, with one reading. A capture can wrap either one, as in `$c('0'..'9')`. Either one can take a test (see "Tests"). An elidable optional cannot begin with either (see "Elided terminators"), and `%emits` takes neither. In the expected terminals and the tree, each stands as its written form, such as `'a'..'z'`.

A string is text in straight double quotes, such as `"la"`. It is a value in a condition or a test, and never a tag or a terminal. Inside it, `\\` is a backslash and `\"` a quote, and `\u{h…}` is as in a character tag.

## Tests

A reference or a terminal in a body can carry one test on its own span. Here, `X` stands for the symbol:

- `X="s"` holds where the canonical sound of the span, `phonemes()` (see "Conditions"), is `s`. `X≠"s"` holds where it is not.
- `X⊇t` holds where the symbol's own tags include every tag of `t`. `X⊉t` holds where they lack one at least.
- `X∩t=∅` holds where the symbol's own tags include no tag of `t`. `X∩t≠∅` holds where they include one at least.

A terminal's own tags are the tags of the token that it reads. A reference's own tags are the tags of its constituent (see "Tags"). A symbol with a test is a tested symbol. The symbol matches only where its test holds.

So a stressed `lA`, a Cyrillic `ла` and a zbalermorna `la` all match `LE="la"`. A reference sounds like its whole span, so `sumti="lomlatu"` matches `lo mlatu`. Each token keeps its own periods. For example, `broda bu` is one `BY` word that sounds `broda.bu`.

`s` is a string or a constant whose value is a string. The string is in phonemes, in lower case, with `'` for the apostrophe and no comma. So `LE="La"` and `LE="l,a"` are errors. `t` is a tag set: a tag literal, a range, `∅`, a constant, or a term in parentheses, such as `(UI ∪ CAI)`. It holds no capture, and no function that reads a span. A property is not a tag set, so it cannot be `t`.

A test belongs to its one symbol, so every item of `{UI="ui"}` must sound like `ui`. A capture can wrap a tested symbol, as in `$l(LE="la")`. A test follows only a reference other than `#`, or a terminal. So a test after a group, an optional, braces, a capture, `ε`, `#` or another test is an error, such as `(LE NU)="lonu"`. Spaces and comments can stand between a symbol and its test, and inside the test. The grammars write a test without them.

A test holds or fails as a condition does, and a span with no tokens is no exception. So `X=""` and `X≠"la"` hold for a rule that matches no tokens, and `X⊇∅` always holds. An elidable optional can hold its terminator with an `=` test, as in `[+KU="ku"]`. Any other test on that terminator is an error (see "Elided terminators").

A test does not replace a class. `zo la` quotes a word that sounds `la` but has only the tag `word`, so `LE="la"` does not match it. A condition that only compares one capture's tags with a set can often be a test in the body. For example, `$c(cmavo)` with the condition `tags($c) ∩ UI = ∅` says what `cmavo∩UI=∅` says.

## Operators

The operators of a body are those of CLL, except for repetition and elidable terminators:

- Juxtaposition is sequence.
- `[x]` is optional.
- `[+T x]` is an elidable optional, whose first item is the terminator `T`. `[++T x]` is one whose terminator is also maximal. "Elided terminators" below explains both.
- `{x}` is one or more of `x`, and `[{x}]` is zero or more. `{x \ s}` is one or more of `x` with `s` between each two. "Repetition" below explains braces, and the chains `{... x \ s}` and `{x ... \ s}`. A chain can also leave out `\ s`, as `{... x}` and `{x ...}`.
- `A & B` is and/or: `A`, `B` or `A B`, but not `B A`. `A & B & C` is any non-empty subsequence in that order.
- `( )` groups.
- `ε` is the empty sequence.

`&` binds tighter than `|`. Parentheses, brackets and braces each delimit what they hold, so they need no precedence.

`#` is the free-modifier slot, which CLL writes after almost every word. A free modifier is a word or phrase that stands almost anywhere. A vocative is an example.

`#` is not an operator but a rule, whose name is `#` and not a word. The grammar defines it like any other rule. The syntax grammars define it as `[{free}]`, zero or more free modifiers, as CLL's own EBNF does with `[free ...]`. Its constituent is a node of the tree like that of any rule, so the free modifiers in one slot are grouped under it.

A terminator is a word that closes a construct, such as `ku`. CLL writes a terminator that can be elided (left out) between slashes, `/KU/`. It writes `/KU#/` for such a terminator whose free-modifier slot goes with it. In this notation, both are elidable optionals: `[+KU]` and `[+KU #]`.

The `+` after the bracket marks the optional as elidable, in its place (see "Elided terminators"). A plain optional, `[KU]`, is never elidable. Here, slashes are for phonemes.

## Repetition

Braces repeat what they hold. There are two kinds of braces. Flat braces read a list, and the tree shows the list as it stands. Chain braces read the same words, and the tree shows how they group.

- `{x}` is one or more of `x`.
- `{x \ s}` is a separated list: `x`, then any number of `s x`. So `{term \ CEhE #}` is one or more terms, with `CEhE #` between each two.
- `{... x \ s}` is a left chain: `x`, or a left chain, then `s` and `x`.
- `{x ... \ s}` is a right chain: `x`, or `x` and `s`, then a right chain.

A chain, like a list, can leave out `\ s`. So `{... selbri-4}` is a left chain of `selbri-4` with nothing between the items.

`[{x}]` is zero or more of `x`: an optional list. The notation has no other way to say "zero or more". ISO 14977, the standard EBNF, reads `{x}` as zero or more. This notation reads it as one or more. So every kind of braces counts its items in the same way, and brackets are the one way to say "or none".

### How braces are written

Braces are a primary, like parentheses and brackets. So an operator outside them treats them as one operand. `{A B} & C` repeats the sequence `A B`, and `[{x}]` makes the whole list optional.

Inside one pair of braces, the item `x` and the separator `s` are each a full choice, as inside parentheses. Each can hold sequences, `&`, `|`, optionals, groups and other flat braces. So `{a | b \ c | d}` is items from `a | b`, separated by `c | d`. The separator of `{... simple-tense-modal \ jek | joik}` is `jek | joik`. Like a choice in parentheses, each side can begin with `|`. The backslash cannot stand first.

A pair of braces has at most one backslash, and each side of it holds an expression. So `{}`, `{x \}`, `{\ s}` and `{x \ s \ t}` are errors of the document. A separator can be `ε`, but an item cannot (below).

The chain marker `...` stands right after `{` for a left chain. It stands after the whole item, before `\` or `}`, for a right chain. So `{a | b ... \ s}` is a right chain whose item is `a | b`.

A pair of braces has at most one marker, and the separator has none. So `{... x ...}` and `{x \ ... s}` are errors of the document. `...` has no other use. CLL's postfix `x ...` is an error of the document, and so is `'a'...'z'`.

The backslash has no other use in a body. Inside a string or a character tag, it is still an escape, as in `"\\"` and `'\''`. The braces of a property, such as `'\p{L}'`, are part of that one token.

A chain is the whole of its rule. That means two things. First, the chain is the whole expression of its alternative. A chain inside parentheses, brackets, other braces, a capture, a sequence, a choice or `&` is an error of the document.

Second, that alternative is the only alternative of its rule that the gates leave (see "Feature guards"). A warning does not remove an alternative. So a rule with another alternative beside its chain is an error of the grammar for the features that leave both. For those features, gencmu finds the error when it prepares the grammar, as it finds an error of a classifier. A `%extend-rule` of a chain's rule can cause this error.

The chain's alternative can still have guards and tags of its own, and its rule can have clauses. A chain can be optional, or part of a sequence, through a rule. Name the chain as a rule, and write the rule's name there, as in `[tag]`.

An item of braces must read at least one token. An item that can match no tokens is an error of the grammar, found as the error above. So `{[x]}`, `{ε}` and `{#}` are errors, and so is `{r}` where `r` can match no tokens for the features of the parse.

gencmu decides this from the rules alone, as the gates and the stitching leave them, ignoring every test and condition. So a rule `r` whose only alternative is `ε` with a condition that never holds still makes `{r}` an error. An alternative that a gate drops does not count, and one that an `%extend-rule` adds does.

A separator can match no tokens. So `{relative-clause \ [joik]}` reads relative clauses with or without `joik` between them. Since an item is never empty, `[{x}]` reads nothing in exactly one way.

### Lists in the tree

A flat list is not a constituent. Its items and its separators are children of the constituent of the rule that writes the braces, in order. So the first rule below gives one `terms-2` node over all its terms and separators. The second gives one `text` node with every `B` between `A` and `C`:

```jbogenbau
%rule terms-2
  {term \ CEhE #}

%rule text
  A {B} C
```

A list has no node, so nothing can name it, capture it or test it. The clauses of the rule apply to the whole constituent of the rule, and never to a part of the list. To make a list a constituent of its own, name it as a rule.

### Chains in the tree

Each level of a chain is a constituent of the chain's rule. The chain needs no rule names of its own, because every level is a node of that rule. Take `%rule tag {... tense-modal \ joik-jek}`. It reads `ba je ca je pu` as three `tag` nodes. The outer node holds a `tag` node over `ba je ca`, then `je` and `pu`. That inner node holds a `tag` node over `ba` alone, then `je` and `ca`.

The clauses of the rule serve every level, as they serve every alternative:

- A condition on `$` holds of each level. So a condition of a left chain holds of every prefix, and one of a right chain of every suffix. A condition on the whole chain alone belongs to a rule that refers to the chain's rule.
- A level has the tags of the rule's tag terms, where the rule writes them (see "Tags"). Where it writes none, the level of one item has the item's tags if the item is one symbol, and every longer level has none.
- A warning on the chain's alternative gives one warning for each level in the chosen tree, each with the text of its level.
- `%emits` and `%opaque` treat each level as a constituent of the rule. So `%emits $` emits the outermost level as one token, and the levels inside it emit nothing more (see "Emission" and "Opaque text").

A chain cannot hold a capture, since a capture never stands inside braces (see "Captures"). So a clause can say nothing about a part of a chain, only about a level, `$`.

A right chain is not the same as an optional suffix. In a rule `r`, the body `x [s r]` and the chain `{x ... \ s}` read the same words. But the level of one item is `x` alone in the chain, and `x` with an empty optional in the suffix. That makes three differences:

- The suffix can be an elidable optional, `[+T s′ r]`, where `s` is `T s′`. Where that suffix is absent, it leaves an elided node, and `late-elision` counts it. The chain has no optional there, so it elides nothing. So a text can tie, or resolve otherwise, under `late-elision`, and maximal terminators and `elision-only` see a different terminator. A plain suffix, `[s r]`, elides nothing, as the chain does.
- That level has the tags of `x` in the chain, where `x` is one symbol, and none with the suffix, unless the rule writes tags.
- Where `s` begins with an elidable optional `[+T]`, the two place `[+T]` differently. In the suffix, it starts the optional's content, so it has no constituent. In the chain, it follows `x`, and the rules of "Elided terminators" decide its constituent.

Where the suffix is plain and `s` does not begin with an elidable optional, the two group the words in the same way. The tags of a level of one item can still differ, as the second difference says.

## Feature guards

A feature is a name that is on or off for a parse. It has the same value in every stage of that parse. The pipeline of the dialect turns some features on (see "Pipelines"). The caller, the program or person that asks for the parse, can turn other features on, and can turn any of the dialect's features off. An alternative can begin with guards, which make it depend on features. There are two kinds of guard, gates and warnings.

A gate, `name?`, keeps the alternative only while the feature `name` is on, and `¬name?` keeps it only while the feature is off. A gate changes what the grammar accepts. A gate can also stand before an entry of a classifier (see "Classifiers"). `?` and `!` have no other use in the notation.

A warning, `name!`, keeps the alternative whether the feature is on or off. While the feature is on, a parse whose chosen tree uses the alternative carries a warning. The warning names the feature and the text that the alternative's constituent covers. A warning changes nothing that the grammar accepts or chooses. It reports where a text relies on an addition to a base grammar.

An alternative with several guards exists when all its gates hold. A name is a gate or a warning, not both. If one guard uses a name as a gate and another guard uses it as a warning, the dialect has an error. The two guards can be in any stages of the dialect. A warning has no negated form, because it keeps its alternative either way.

```jbogenbau
%rule tanru-unit-2
  | BRIVLA #
  | cbm? CMEVLA #

%redefine-rule cmavo-token
  | ~cmavo⊉~cmavo-warning
  | y-cmavo! ~cmavo⊇~cmavo-warning
```

A dialect that extends another dialect can use the two kinds for two kinds of change. An addition is a text that the base grammar rejects and the dialect accepts. A warning can mark an addition, so that a reader can learn which additions a text relies on. The bundled dialects turn none of their warnings on, so their texts parse without warnings unless the caller asks for them.

A change to how the dialect reads a text of the base cannot be a warning. The change removes the base reading, and a warning changes nothing that the grammar accepts or chooses. So a gate can guard such a change, with the old form under `¬name?` beside it. The dialect then turns the gate on, and a caller who wants the base reading turns it off.

The bundled dialects do not guard every change. The only bundled warning is `y-cmavo`, in the `cll-ebnf` dialect, so the additions of the experimental dialect carry no warning yet. A dialect also makes a change without a guard where a feature needs a convoluted grammar to keep the change separate. The documents of the dialect then say so.

## Layout of the bundled grammars

The bundled grammars keep a layout convention for a rule with two or more alternatives that are each a single symbol. A single symbol is a reference, a terminal, a range, a property, a tested symbol or `ε`. An alternative with a guard, or with tags of its own (see "Tags"), is not a single symbol. If such a rule has more than one line, it does not put exactly one symbol on each line. The exception is a rule in which no two adjacent symbols fit together on one line.

No line of such a rule's body holds more than 100 characters, counted as Unicode code points. A symbol can run over several lines, and each of these lines counts. Apart from this, the author chooses the groups, such as the vowels on one line and the consonants on the next. `tools/sync.js --check` makes sure that the bundled grammars keep this convention. For a rule with one symbol per line, it suggests a layout, and keeps the line breaks inside each symbol.

## Stitching documents

A stage reads its input with one grammar. The loader assembles that grammar from the items of one or more documents, read in order. A later rule can change what an earlier one said. Only the order of the rules in the stage matters, not the document where each was written. There are three ways to state a rule, and each says what it expects to be there already:

- `%rule` defines a rule. It is an error if a rule of that name was defined before it in the stage.
- `%redefine-rule` replaces a rule defined before it in the stage. It is an error if none was. The earlier alternatives are gone.
- `%extend-rule` adds alternatives to a rule defined before it in the stage. It is an error if none was.

```jbogenbau
%extend-rule consonant
  'б' </b/> | 'в' </v/>
%emits
  $

%redefine-rule text
  | ¬cbm? [{NAI}] {CMEVLA} # [joik-jek] text-1
  | [indicators & {free}] [joik-jek] text-1
```

So `%rule` never quietly replaces a rule. A misspelled name in `%redefine-rule` or `%extend-rule` is an error. So is a reference to a rule that no document defines. A misspelled `%rule` defines a new rule that nothing reads, and the audit (gencmu's report on a grammar) reports it as unreachable.

The alternatives that an extension adds carry the extension's own clauses, not those of the base rule. The clauses of the base rule do not apply to them. So an extension says everything about what it adds. The loader, the part of gencmu that reads the documents, reports every replacement and extension: which document changed which rule. So a reader can see the effect of a dialect on its base in one place.

The notation has no way to remove a single alternative. A rule is small enough to restate, and a restated rule reads better than a list of deletions.

## Constants

A constant names a value that several rules use, such as a list of classes. Its name is `$` and a name that begins with a capital. By convention, the whole name is in capitals, as in `$SU-STOPS`. The loader stitches a constant as it stitches a rule, and the constant belongs to its stage.

`%const $NAME value` defines a constant. It is an error if a constant of that name was defined before it in the stage. `%redefine-const $NAME value` gives a constant a new value. It is an error if no constant of that name was defined before it in the stage.

```jbogenbau
%const $SU-STOPS NIhO ∪ LU ∪ TUhE ∪ TO
%const $PAUSE "."
%redefine-const $MAGIC-WORDS $MAGIC-WORDS ∪ RAhOI ∪ GOhOI ∪ MUhOI ∪ LOhAI ∪ LEhAI
```

The first line is a constant of the word stage, in `grammars/words/stream.md`. The last line is how the Zantufa word stream adds its magic words, in `grammars/words/zantufa-stream.md`. The other dialects keep LOhAI and LEhAI out of `$MAGIC-WORDS`, because the experimental dialect reads a bare marker of these as a plain word. No bundled grammar defines `$PAUSE`. It shows a string value.

The value is a string, a set of strings or a tag set, never a span. It is a closed term: it uses no capture and no span. So it holds only strings, tag literals, ranges, `∅` and other constants, joined by `∪`, `∩` and `∖`. `split` and `tag` of such terms are closed too (see "Conditions"). A call of `phonemes`, `text`, `tags`, `classes` or `classify`, a capture and a guarded term are errors in a value. The value of `classify` depends on the features, and the value of a constant does not.

Inside a `%redefine-const`, the constant's own name is its value before the redefinition. So one redefinition can extend a set with `∪`, narrow it with `∩` or `∖`, or replace it. A redefinition keeps the type of the value, so a set cannot become a string. That type also gives `∅` its kind. So `%redefine-const $A ∅` makes a set empty, but `%const $E ∅` is an error.

A constant in a value has the value that it has at that point of the stage. It is an error to use a constant before its `%const`. So after `%const $A ~a`, `%const $B $A` and `%redefine-const $A ~b`, `$B` is `~a`. A constant in a rule has the final value of the stage, wherever the rule stands. So a document can use a constant that a later document redefines.

A constant stands wherever a value of its type can, in tag terms and in conditions. It cannot stand in a body. A body names a class of tokens with a rule, such as `%rule digit '0'..'9'`. A constant that the stage never defines is an error. That holds in a rule that a later `%redefine-rule` replaces too.

The loader gives the constants their values when it stitches each stage. So a document that several dialects include takes the values of each dialect. The error for a constant stands at the reference to it, or at the definition that is wrong.

## Classifiers

A classifier gives a sound its classes. A cmavo is a particle, a short structure word. A lexicon is a classifier: it gives each cmavo its selma'o. `%classifier` and a name start a classifier, and its entries follow:

```jbogenbau
%classifier lexicon
  "mi" "do" "ko'a" "ko'e" ∈ KOhA
  "ui" "u'i" ∈ UI
  "de'i" "ti'u" ∈ BAI

%classifier lexicon
  date-li? "de'i" "na'a" "ti'u" ∈ LI
  date-li? "de'i" "ti'u" ∉ BAI
```

An entry is one or more keys, `∈` or `∉`, and one class. A `%classifier` can also have no entries. A key is a string. `∈` adds the class to each key, and `∉` removes it from each key. A word in several classes has several entries.

Line breaks mean nothing here, as everywhere in the notation. An entry ends after its class, and by convention each entry stands on a line of its own.

A key is a canonical sound, as `phonemes()` gives it (see "Conditions"). So it is in lower case, with `'` for the apostrophe and no comma, and `"Mi"` and `"ko,a"` are errors. A class is an identifier tag whose name begins with a capital, such as `KOhA` or `~KOhA`. So `~indicator` is not a class, and a phoneme tag is not one either.

An entry can begin with gates, as an alternative can (see "Feature guards"). An entry whose gates do not all hold does nothing. A warning on an entry is an error.

The name of a classifier begins with a lower-case letter. A classifier belongs to its stage, as a rule does. Every `%classifier` of one name in a stage adds entries to one classifier. gencmu applies the entries in the order of the stage, whatever documents they come from. A key has the classes that hold after the last entry.

An entry that adds a class that a key already has is an error. So is an entry that removes a class that a key does not have. These errors depend on the features, so they are errors of the grammar. gencmu reports one at its entry, for a parse that turns on the features that make it. A mistake in how an entry is written is an error of the document, even where the entry's gates do not hold.

`classify(string, name)` (see "Conditions") is the set of the classes that the classifier gives the string. It is empty for a string that no entry names. A `classify` that names a classifier that no `%classifier` of the stage declares is an error. `tags(span, rule)` is still the way to ask a rule for the tags of a span, as `brivla-shape` asks `brivla-scan` in the CLL word forms.

The audit data lists every membership change, with its key, class, gates and document. The printed report shows the gated memberships and those that more than one entry changes.

## Implications

An implication says that some tags bring other tags with them:

```jbogenbau
%implies UI ∪ CAI ∪ Y ∪ DAhO ∪ FUhE ∪ FUhO ⟹ ~indicator
```

`%implies A ⟹ B` says that each token that the stage emits with a tag of `A` also carries every tag of `B`. `A` and `B` are tag sets. Each is a closed term, as a constant's value is (see "Constants"). A constant in them has its final value, as in a rule.

The stage applies its implications when it emits a token. First it gives the token the tags that the emission gives it (see "Emission"). Then it adds `B` for each implication whose `A` shares a tag with the token. It repeats this until no tag changes. So implications chain, and a cycle ends, because an implication only adds tags.

Only then does the stage find the token's sound. So an implication that adds a phoneme tag sets the token's sound. Two phoneme tags on one token are an error, also when an implication added one of them.

Implications apply only to the tokens that the stage emits. They do not change a constituent's tags, the value of a term or the classes of a classifier. A later stage applies only its own implications. So the lexicon's implication in the forms stage marks each word of these classes `indicator`. The word stage can drop that mark from a quote's marker, and nothing adds it again.

## Captures

Writing `$name(symbol)` around a symbol of a rule's body captures that symbol. A capture gives a part of the constituent a name that the clauses of the rule can use. A capture's name is all lower case.

A capture wraps one symbol. That symbol can stand anywhere in an alternative, except inside braces and inside an elidable optional, `[+ ]` or `[++ ]`. So a capture can stand in a group, in a choice, in an item of `&` and in a plain optional, at any depth.

A name can stand at most once in each production (below), so two branches of a choice can capture one name, as two alternatives can. `A ($x(B) | $x(C))` is valid, but `[$x(A)] $x(B)` and `$x(A) & $x(B)` are errors, because one of their productions reads `$x` twice. gencmu checks this when it reads the grammar, before the gates, so a guard does not excuse it. An alternative can have any number of captures, but each one has a cost (below). `$` alone is the whole constituent, a capture that every alternative has without writing it.

A capture cannot wrap anything but one symbol. So `$x((a | b))`, `$x((a b))` and `$x([a])` are errors. A capture names one constituent, with one span and one set of tags, and a group or an optional is no constituent. To capture a choice or a sequence, make it a rule of its own and capture the reference. To capture a part that can be absent, write the capture inside the optional, as in `[$x(a)]`. A presence test then says whether the part is there.

A capture cannot wrap braces, and braces cannot hold a capture. A list is not a constituent, so no capture can name its span. A part of a list or of a chain repeats, so one name cannot stand for all its parts. To capture a list or a chain, make it a rule of its own and capture the reference, as in `$t(tag)`.

An elidable optional cannot hold a capture, at any depth. gencmu restores an elided terminator as the terminator alone (see "Elided terminators"), and it keeps the optional as one unit for that. A part inside it is there in some readings of one omission and not in others.

gencmu expands each alternative into productions, as engine §3 says. A production is one way to read the alternative. It reads one branch of each choice and one subsequence of each `&`, and reads each optional or not. A plain optional that holds a capture is expanded in place, as if it were `(ε | x)`. The production without it comes first, then those with it. So `A [$b(B)] [$c(C)]` gives four productions, in this order: `A`, `A C`, `A B` and `A B C`.

A plain optional without a capture stays one optional. It is not expanded into two productions. A production has a capture where it reads the captured symbol, and lacks it elsewhere.

Either way, a rule node holds the parts that its production reads as its children, and an optional makes no node. But the tags and the constituents can differ, in two ways. A production that reads one symbol has that symbol's tags where no tags are written (see "Tags"). So `%rule r A [$b(B)]` without tags has the tags of `A` where `B` is absent.

And an elided terminator after the optional has the constituent that the production gives it (see "Elided terminators"). Take `a [$b(b)] [+KU]`, where `a` and `b` are rules. The constituent of an elided `ku` is `b` where the production reads `b`, and `a` where it does not.

A plain optional that holds a capture, whose content has k expansions, contributes 1 + k: the empty one and those k. A sequence multiplies these counts. So `[$b(B)]` doubles the productions of its alternative, `[($a(A) | B | C)]` contributes four, and `[A [$b(B)]]` three, not four. Each capture can also multiply the work of the parser. The parser keeps a captured part's span with each partial reading, so readings that differ only in where a captured part ends are not merged. So a capture whose span can end in many places costs much more than one that reads a single token.

The clauses of a rule serve all its productions, and the productions need not capture the same parts. gencmu knows whether a production captured a part when it reads the grammar. A clause can refer to a capture that a production lacks. What happens then depends on the kind of clause.

A condition or an item of `%emits` that uses a capture that a production lacks does not apply to that production. A condition about a part that is not there holds. A part that is not there is not emitted.

A tag term that uses a capture that one of its productions lacks is an error, unless `⟹` (below) guards the use. The reason is that a tag term has no value that can mean "nothing to say". An alternative's own tags serve the productions of that alternative. The tags after `%tags` serve every production. The tags of an emitted item serve every production that has the item.

It is an error to mention a capture that no alternative of the rule, or of the extension, captures. It is also an error to write a condition or an item of `%emits` that applies to no production. Each of these is a mistake, such as a misspelled name.

A constant counts in these rules as its value. So where `$E` is empty, `$E ∩ tags($x)` is empty and uses no capture. gencmu makes sure that such a clause meets these rules when it stitches the stage. Only then does the constant have a value.

`$x`, standing as a condition, is a presence test: it says whether the production captured `x`. gencmu also knows this when it reads the grammar. `$` alone is always true. gencmu decides a presence test for each production before anything else, so it is not a use of the capture. So `%conditions $x` applies to every production, and removes those that do not capture `x`.

`A ⟹ B`, where `A` is a condition, is `B` where `A` holds. As a condition, it is `B` where `A` holds, and true elsewhere. As a tag term, it is the tags of `B` where `A` holds, and no tags elsewhere. So a tag term that is only for the alternatives with a certain capture says so:

```jbogenbau
%rule word
  | $c(cmavo-shape) <~cmavo>
  | brivla-shape <BRIVLA>
%tags
  ~word ∪ ($c ⟹ classify(phonemes($c), lexicon))
```

## Conditions

`%conditions` lists what must hold of a rule's captured parts, separated by commas. A parse in which a condition fails does not exist. The parser evaluates each condition as soon as it reads the last capture that the condition mentions. It evaluates a condition that mentions `$` when the constituent is complete.

Each condition of the list applies to the productions that capture everything it mentions, and to no other production. A production is one expanded sequence of an alternative (see "Captures"). So `A [$b(B)]` has two productions, and a condition that mentions `$b` applies only to the one that reads `B`. One rule can also state a condition for the productions that have a quote body, and none for those that do not:

```jbogenbau
%rule zoi-quote
  | zoi-marker gap $open(word) PAUSE $content(body) PAUSE $close(word)
  | empty-zoi-quote
%conditions
  phonemes($open) = phonemes($close),
  phonemes($open) ∉ split(phonemes($content), ".")
```

Within one condition of the list, `∧` and `∨` join conditions, and `∧` binds tighter. `⟹` binds looser than both, and groups to the right. Parentheses group, and `¬` negates the condition after it. The parser evaluates a condition joined with `∧` only when it can evaluate all its parts. So two conditions about different parts are better as two items of the list. The parser then evaluates each one as early as it can.

A term of a condition has one of four types: a span, a string, a set of strings or a tag set. No value turns into another. So a string is never a tag, and a span never stands for its tags.

The first type is the span, a sequence of tokens. A capture `$x` is a span, the tokens that the captured part covers, and `$` is the tokens that the whole constituent covers. `head($x)` is its first token, `tail($x)` the rest, and `last($x)` the last.

`from($x)` is the tokens from the start of `$x` to the end of the input. `after($x)` is the tokens after `$x`, to the end of the input. These two reach past the constituent, to the text that follows it. A condition can parse a span with `matches`, `begins` or `tags(span, rule)` (see below). In such a parse, the input is that span, so `from` and `after` stop at its end. A span is only an argument of a function, such as `tags($x)`, and never a value of its own.

The second type is the string. `phonemes(span)` is the canonical sound of a span. That is the phonemes of its tokens, joined, in lower case and without commas. So `phonemes()` ignores stress and syllable breaks. It keeps every pause, and adds none between the tokens.

The next paragraph uses four more Lojban terms. A gismu is a root word. A lujvo is a compound word. A fu'ivla is a borrowed word. A cmevla is a proper name.

In the `cll-ebnf` dialect, a comma between two vowels marks a syllable break, as CLL 3.3 describes. In that dialect, a cmavo, a gismu or a lujvo has no comma between two vowels. A fu'ivla or a cmevla can have one, as in the cmevla `nu,iork`. Without its commas and with its capitals lowered, a fu'ivla must still be a fu'ivla, and a cmevla must still be a cmevla. For example, the fu'ivla `zba,A,u` passes this check as `zbaau`, which is a fu'ivla, although `zbaAu` is none. So `ba,irgau` and `ma,i` are no words, because `bairgau` is a lujvo and `mai` is a cmavo.

In the other bundled Lojban dialects, a comma between two vowels is nothing, so `ma,i` is `mai`. In all four bundled Lojban dialects, the word stage compares `zoi` delimiters by `phonemes()`, which has no commas, so `nuiork` and `nu,iork` match.

A token's own phonemes are fixed when its stage emits it, and they keep their capitals and commas. A token sounds like the phoneme that its `/x/` tag names, if it has one. Such a tag can come from an implication (see "Implications"). Two phoneme tags on one token are an error of the grammar.

A token without such a tag sounds like the tokens of its stage's input that it covers, joined in order. That leaves out the tokens inside a rule that emits `ε` (see "Emission"). An opaque part inside the token sounds `?` (see "Opaque text"). The join also makes each run of pause tokens into one pause token, and removes a pause token at either end. A pause is `.`, so `klama bu` sounds as `klama.bu`. `?` is an ordinary character in a comparison.

`text(span)` is the original text that the span covers. A string in double quotes, such as `"la"`, is a string literal. Where a condition compares one word's sound with a literal, as in `phonemes($l) = "la"`, a test says it in the body: `LE="la"`.

The third type is the set of strings. `split(string, delimiter)` is the set of the pieces of the string between the occurrences of the delimiter. It reads the string from the left, and two occurrences never overlap. It drops the empty pieces.

So `split(phonemes($content), ".")` is the set of the runs of `$content`, the stretches between its pauses. Then `phonemes($open) ∉ split(phonemes($content), ".")` says that the word `$open` is not one of those runs. A run can hold several words: a text writes `lemiklama` as one run.

An empty delimiter is an error. It is an error of the document when the reader sees it, as `""` or a constant. Otherwise it is an error of the grammar, when a parse meets it.

The fourth type is the tag set. A tag literal is the set with that one tag, so `UI ∪ CAI` is the set of both, and `~indicator` is the set of the mark. A range is the set of its character tags, so `tags($c) ∩ 'a'..'z' ≠ ∅` says that `$c` carries a lower-case ASCII letter. `..` binds tighter than every other operator, so `'a'..'c' ∪ 'x'` is four tags. A property is not a tag set, so it cannot stand in a term.

`tags(span)` is the tag set of the captured part, when the span is a whole capture. For another span, such as `head($x)`, it is the union of the tags of the span's tokens. `tags(span, rule)` is the tag set that the span has when parsed as `rule`, unioned over every parse. It is empty when the span does not parse as `rule`. `classes(span)` keeps only the tags that begin with a capital.

`classify(string, classifier)` is the set of the classes that a classifier gives the string (see "Classifiers"). It is empty for a string that the classifier does not know. The second argument is a bare name, which names a classifier of the stage. So `classify(phonemes($c), lexicon)` is the set of the classes of the word `$c`.

`tag(string)` is the identifier tag of that name, as a set of one tag. A string that is not a name is an error, in the same way as an empty delimiter.

`∪`, `∩` and `∖` are union, intersection and difference. Each applies to two sets of one kind: two sets of strings, or two tag sets. `∩` binds tighter than `∪` and `∖`. Those two bind equally and group from the left, so `A ∖ B ∪ C` is `(A ∖ B) ∪ C`. `∅` is the empty set, and its context gives its kind. An expression whose kind nothing gives, such as `∅ = ∅`, is an error.

The predicates are:

- `=` and `≠` compare two strings, two sets of strings or two tag sets. Any other pair is an error.
- `∈` and `∉` test whether a string is in a set of strings.
- `⊆` and `⊈` test whether one set is in another of the same kind. So `~indicator ⊆ tags($i)` says that `$i` carries the mark `indicator`, and `~indicator ⊈ tags($i)` says that it does not.
- `$x` holds when the production has the capture `x`.
- `matches(span, rule)` holds when the span parses as the named rule.
- `begins(span, rule)` holds when some prefix of the span parses as the rule. The empty prefix counts.
- `initial(span)` holds when the span begins where the parser's input begins.

`matches` and `tags(span, rule)` parse the captured span alone, as the named rule, with the same grammar. This is how gencmu states CLL's slinku'i test for fu'ivla. A CV cmavo is a particle of one consonant and one vowel. The test says that such a cmavo before a fu'ivla must not make a lujvo. That is `¬matches($f, lujvo-after-cv)`, because the rule is the part of a lujvo after its first two letters.

Inside such a parse, a condition can ask about the very span that is being parsed, as the same rule. Such a condition defines the rule in terms of itself over the same text, negated or not. The parser reports it as an error of the grammar.

Every nested query, whether `matches`, `begins` or `tags`, follows written-terminator priority (engine §4). A nested reading cannot leave out an elidable optional where the same construct can read that whole optional as written. In the Zantufa dialect, `cy to roi toi klama` gives `([cy {to roi toi}] klama)`. A nested `tag` cannot read `cy to roi` as `cy roi` with an empty parenthesis, because the parenthesis can read on to its written `toi`.

In the same way, the experimental dialect gives `(mi [klama {na (to broda toi)}])` for `mi klama na to broda toi`. There `broda` stays inside the parenthesis. The priority has a cost: a positive query can fail where a parse without it succeeds. Take `r → A c [+T] T` and `c → B`. Then `matches` of `r` over `A B T` fails, because `[+T]` takes the written `T`. Several readings that the priority keeps do not cause an ambiguity error.

A lookahead tests a rule without reading the input. A PEG is a grammar that tries alternatives in order. PEG is short for parsing expression grammar. `begins` with `from` or `after` is a lookahead, like the lookahead of a PEG.

`begins(after($f), post-word)` says that what follows `$f` begins with a `post-word`. That `post-word` can lie in the words after the constituent. `¬begins(from($f), cmevla)` says that no `cmevla` begins where `$f` begins, as a PEG's `!cmevla` before `$f` does.

The approved word forms, the word grammar of the `bpfk` dialect, use these to translate their PEG rule by rule. The nested parse of `begins` reads only as far as the rule can read. So a lookahead costs what reading the rule costs, however long the rest of the input is.

`initial` lets a rule begin only at the start of the input. The rule below matches nothing, and its condition holds only where the input begins. So an alternative that starts with `text-start` is read there and nowhere else. The parser evaluates the condition before it looks further, so such an alternative costs nothing at the other positions. In a nested parse, the input is the span being parsed, so `initial` holds at the span's start.

```jbogenbau
%rule text-start
  ε
%conditions
  initial($)
```

## Tags

Every token and every constituent carries a set of tags, and a terminal matches a token by tag. So the tags that a grammar gives its constituents are the terminals of the grammar of the next stage. A rule uses tag terms to say what tags its constituents carry. A tag term in angle brackets after an alternative is for that alternative. A tag term after `%tags` is for every alternative. Where both are written, a constituent's tags are the union of the two:

```jbogenbau
%rule source-word
  | $b(brivla-shape) <BRIVLA ∪ tags($b)>
  | $n(cmevla-shape) <CMEVLA ∪ tags($n)>
%tags
  ~word

%rule cmavo
  $w(cmavo-shape)
%tags
  ~cmavo ∪ classify(phonemes($w), lexicon)
```

Sometimes no tags are written at all, neither after the alternative nor after `%tags`. Then a constituent built from one symbol has that symbol's tags, and a constituent built from several symbols has none. So a rule `word` whose body is `cmavo | brivla | cmevla` needs no tags. A `mi` arrives at the next stage tagged by the chain of rules that built it.

Brackets and flat braces count as one symbol here. Their tags are those of what they read, when that is one symbol, and none otherwise. So `%rule terms {terms-1}` over one `terms-1` has its tags, and over two has none. An empty optional has none.

A chain's levels follow the same rule (see "Repetition"). A plain optional that holds a capture is the exception. It is expanded in place (see "Captures"), so each of its productions counts the symbols that it reads, as a choice does.

A tag term that defines a constituent's tags cannot be made of those tags. So `tags($)` and `classes($)` are errors in a tag term after an alternative or after `%tags`. `tags($, rule)` and `classify(phonemes($), lexicon)` are not errors there. The first parses the constituent's tokens again, and the second reads their sound. The tag term of an emitted item does not define the constituent's tags, so it can use `tags($)` and `classes($)`.

## Emission

The stage walks a rule with no `%emits`. What it hands to the next stage is what its parts hand on, in order. A token that it reads directly hands on nothing. A rule with `%emits` hands on exactly what the list says, in the order that the list says it. The stage walks nothing else of the constituent.

An item of the list can be a capture. The stage hands a capture on as one token. The token has the captured part's tags, or the tags of a tag term after the capture in angle brackets.

An item can also be a single tag literal: an identifier tag, a phoneme tag or a character tag. The stage hands it on as a token with that one tag and no text of its own. A string is not a tag, so `%emits "foo"` is an error. A range or a property is not one tag, so it is an error there too. The author must list the captures in the order in which each production reads them.

`$` is the whole constituent. A list of `$` items hands on one token over the whole constituent for each item. For example, `%emits $ </n/>, $ </o/>` is how the digit `0` becomes the phonemes of `no`. A list with a `$` item holds only `$` items.

An inserted tag stands where it is listed. So `%emits /'/, $v` hands on an apostrophe before a vowel, for a script that writes none (`joined-vowel` in `latin-strict.md`). A tag term that gives no tags when the parse is made is an error of the grammar, because no terminal can read the token.

`%emits ε` hands on nothing, and it does more: the constituent does not count. So nothing in it is part of what a token over it sounds like. That is what an erased stretch of text is. `broda brode si bu` hands on the letter word `broda bu` (`si` erases the word before it). Its token covers `brode si` too, because a `si` erasure can stand between a word and its `bu`. But the token does not sound like `brode si`.

A capture item can carry attachments: other tokens that belong to its token, which no later stage reads. Each attachment is a capture in parentheses, before the item or after it, and an item can have any number on each side. The item's own capture is its carrier, and it must be a named capture. Neither a `$` item nor an inserted tag can name attachment captures. `($)` is an error.

```jbogenbau
%rule item
  | $w(unit) | $b(bahe-run) $w(unit) | $w(unit) $a(indicator-run) | $b(bahe-run) $w(unit) $a(indicator-run)
%tags
  tags($w)
%emits
  ($b) $w ($a)
```

The carrier's token covers its own capture only. An attachment is the list of tokens that its captured part hands on, as if the stage walked that part. So `mi ui klama` hands on `mi` with `ui` attached after it, and the next stage reads `mi klama`. The carrier does not run the emission of its own part. So a structure inside the carrier's part stays only where the item captures it separately.

An attachment capture stands in exactly one item, and never as an item of its own. A production without the carrier emits nothing for the item, and it must also lack the item's attachment captures. The captures of an emission, attachments included, must be written in the order in which each production reads them.

A production reads each name at most once, so each name is one part of it and the order is clear. Two productions can read names in different orders, as in `($a(A) $b(B) | $b(B) $a(A))`. Then no order of `$a` and `$b` fits both, and an emission of both is an error. Where a production lacks an attachment capture, the item has one attachment fewer.

The four alternatives of `item` above can also be one, with two optionals that hold captures: `[$b(bahe-run)] $w(unit) [$a(indicator-run)]`. That alternative expands to the same four productions, `$w`, `$w $a`, `$b $w` and `$b $w $a`, in that order (see "Captures"). Only the numbers of the productions differ.

A token that the next stage forwards keeps its attachments. A token over exactly one input token with attachments inherits them, whatever tags it gets. A token over an input token with attachments and any other part that counts is an error. Such a token cannot say which part each attachment belongs to. An input token with attachments under two tokens, as under `$ <t>, $ <u>`, is an error too.

No condition, test or function sees attachments, and neither does a terminal. The renderings show them with their token.

A part that the list of a rule merely does not name is not handed on, but it still counts. For example, a pause inside a quote is part of what a compound over the quote sounds like. A rule with no `%emits` that happens to hand on nothing, as a gap does, counts as well. Only `ε` says that text does not count.

```jbogenbau
%rule plain-word
  cmavo | brivla | cmevla
%emits
  $

%rule quoted-word
  $m(zo-marker) gap $w(quotable-word)
%emits
  $m, $w <~word>

%rule erasure
  unit gap si-word
%emits
  ε
```

## Opaque text

During emission, `%opaque` treats each constituent of a rule as one part, an opaque part. An opaque part has its text as its label and `?` as its phonemes, whatever it holds. This is true whether the constituent emits a token with `$` or a parent emits a token over it. Recognition and conditions do not change. They still read the phonemes of the input tokens, so an opaque rule can test `phonemes($a) = "a"` and still emit `?`.

The directive says nothing about the language of the text. It only says how the stage emits the text. Examples of opaque parts are a `zoi` body and a run with a character that no script reads, such as `klama?` in `cll-ebnf`. The body of a `zoi` quote is opaque even when it holds good Lojban words.

```jbogenbau
%rule zoi-body
  zoi-part | zoi-body zoi-part
%opaque
```

So `zoi gy. John is a man .gy.` hands on the body as a token that sounds `?`. In the experimental dialect, the forms stage before it emitted the phonemes `jo'n.is.a.man` for the body. The label of the token is `John is a man`. The label is what the renderings for people show (see "Labels").

The text of an opaque part also takes in the text next to it that no token of the stage's input covers. An example is punctuation that the stage before read as part of a pause but did not emit. So the text starts at the end of the input token before it, or at the start of the text. It ends at the start of the input token after it, or at the end of the text. Text between two opaque parts belongs to the first of them. An empty opaque part sounds `?` and has no text.

Three rules settle what an opaque part gives. An opaque part inside a rule that emits `ε` gives nothing, as any part there does. An opaque part inside another gives nothing of its own, because the outer one counts once. So a recursive rule such as `zoi-body` is one part. A token with a phoneme tag sounds like that phoneme, and an opaque part inside it does not change that. A rule cannot have both `%opaque` and `%emits ε`, because a constituent that does not count holds no opaque part.

A later stage that forwards a token keeps its text and its source. So a quote body sounds `?` and shows its text to the end of the pipeline.

## Labels

Every token has a label, which is what the renderings for people show. The stage gives a token its label when it emits the token, from the same parts as its phonemes. An opaque part gives its text, and a pause gives a space. A token with a phoneme tag has that phoneme as its label, but a token with the pause, `/./`, has a space. Any other part gives its own label. A character token, the input of the first stage, has its text as its label.

An inserted token with a phoneme tag has that phoneme as its label, or a space for the pause, `/./`. So the apostrophe that the zbalermorna shorthand inserts stays in the label of `u'i`. An inserted token without a phoneme tag has an empty label.

## Directives

A directive is a keyword and its operands. By convention each stands in a block of its own, after prose that says why the grammar needs it. Two directives can share a line.

- `%ambiguity-resolution` says how the stage chooses among parses. Its first operand is the rule of the ranking: `greedy`, `lazy` or `late-elision`. `elision-only` can follow it. The retired operand `maximal` is an error. "Ambiguity" and "Elided terminators" explain it. Every stage must say it exactly once, in any of its documents.
- No directive names the elidable terminators. Each elidable optional is marked in its place, as `[+KU]` or `[++TOI]` (see "Elided terminators"). `%elidable` is not a directive. A document that writes it is an error, which the reader reports at the keyword.
- `%stage NAME`, `%include "PATH"` and `%features NAME…` build a pipeline, as the next section says.

## Pipelines

A pipeline document, which is Markdown too, defines a dialect. Each stage is a heading, followed by the list of its documents. Prose then says what the stage receives, does and hands on. Three directives in `jbogenbau` blocks say what the pipeline is made of:

````markdown
# The experimental dialect

... what the dialect is ...

```jbogenbau
%features cbm soi-clause su-boundary
```

## Stage 1: phonemes

```jbogenbau
%stage phonemes
```

- [Latin orthography](../phonemes/latin.md): what this document contributes
  ```jbogenbau
  %include "../phonemes/latin.md"
  ```

... what the stage receives, does and hands on ...
````

- `%stage NAME` starts a stage called `NAME`. The rules and directives after it, up to the next `%stage`, are the stage's. Stages run in the order they start, and every stage's start rule is `text`.
- `%include "PATH"` stands for the rules and directives of the document at `PATH`. The loader resolves the path against the directory of the document that holds the `%include`. It works as if their text stood in its place, so an included document can include others and can hold `%stage` and `%features` too. Each document must still be complete rules and directives on its own. A document can be included in several stages. A document that includes itself, directly or through others, is an error.
- `%features NAME…` names one or more features the dialect turns on for every parse, wherever it stands. A caller can turn other features on, and can turn any of these off.

Rules can also stand in the pipeline document itself, between its `%include` blocks. The loader stitches them in their places. A rule, a constant, a classifier, an implication or a stage-level directive before the first `%stage` is an error. So are two stages of one name and a stage with no rules.

By convention, each document keeps its link in the prose, and its `%include` follows in a block of its own, in the same list item. So the pipeline reads as hyperlinked prose. A block's fence can be indented by up to three spaces, so a block can stand under a list item, indented by two. The reader knows no other Markdown container.

The layout is a matter of style, and the notation does not require it. An `%include` can stand in any block, between any two rules or directives. `tools/sync.js --check` makes sure that the bundled pipelines keep the style.

The first stage reads the text's characters. Each is a token with one tag, its character tag, such as `'a'`. A grammar reads a class of characters with a range or a property, such as `'0'..'9'` or `'\p{L}'`. Every later stage reads what the stage before it emitted.

`node lib/js/cli.js stitch --dialect NAME` prints a dialect's pipeline as one jbogenbau text. The command replaces every `%include` with what it stands for, and puts the dialect's features in one `%features` at the top. Each run of rules from one document follows a comment naming it. A classifier stands as its author wrote it, entry by entry, and not as the table that its entries make.

## Ambiguity

A grammar admits every parse that its rules allow. Where a text has more than one parse, the stage's `%ambiguity-resolution` names the rule that ranks them: `greedy`, `lazy` or `late-elision`. A parse is best when no other parse beats it under that rule. If exactly one parse is best, the stage takes it. If two or more are best, they are tied, and the text is ambiguous for this grammar.

A tie is an error of kind `ambiguous`. The stage hands nothing on, and no later stage runs. The error shows two of the tied parses. The stage shows the first point at which they differ, its witness.

The engine's canonical order (engine §6) orders the ambiguity diagnostics and selects the forbidden terminator that a maximality rejection reports. Among its keys are the numbers of the productions, which follow the order of a rule's alternatives. The canonical tie-break keys never turn a tie into an accepted reading.

`greedy` and `lazy` treat each parse as the sequence of steps that a bottom-up reader takes. A step reads the next token or closes a constituent. gencmu compares the parses at the first step where two of them differ:

- If both read the same token under two tags, they are tied.
- If one reads and the other closes, the rule decides. `greedy` takes the one that reads, so a constituent ends as late as the grammar allows. `lazy` takes the one that closes, so a constituent ends as early as the grammar allows.
- If both close different constituents, they are tied.

Some constituents are transparent to the comparison. They are the constituents with a single symbol. They are also the helpers that the notation creates for flat `{ }` and for `[ ]` without a capture. So two parses that differ only in such a relabeling do not differ yet. The levels of a chain are constituents of its rule, so a level with more than one symbol is not transparent. Where `greedy` or `lazy` must see where each step of a list ends, the grammar writes a chain or explicit recursion, not flat braces.

Transparency does not merge parses, though. Two parses that differ only there are still two parses. `greedy` and `lazy` tie them. `late-elision` ties them exactly when their counts of elided terminators are equal at every position. For example, `[[X]]` matches the empty text in two ways, and `[A] & [B]` in three.

The preference is like greedy and lazy quantifiers in a backtracking regular-expression engine. It is unlike the greed of a PEG parser. The preference orders the parses that the grammar already admits, and never commits early. So it never rejects a text by itself, but a tie that it leaves is an error. The earliest difference decides. And it applies to every constituent of the stage, not to one quantifier.

`late-elision` looks only at the terminators that each parse elides ("Elided terminators"). In plain words, at the first place where two parses differ in leaving out a terminator, it takes the parse that reads on. It counts the elided terminators of each parse at each position, from the start of the text. At the first position where the counts differ, the parse with fewer elided terminators there wins.

Two parses with the same counts at every position are tied, whatever else differs. So a stage whose parses elide nothing has a tie wherever its text has more than one parse. A token read under two tags does not decide anything, and neither do two different closes. The name of an elided terminator, and the constituent that it ends, do not count either.

For example, the experimental grammar can read `to mi klama` in two ways. One ends the parenthesis `to` after `mi`, with `vau` and `toi` elided there, and `klama` is the main predicate. The other puts `mi klama` inside the parenthesis and elides terminators only at the end. `late-elision` takes the second, because the first leaves out a terminator earlier. `greedy` leaves the two readings tied, so the text is an error under `greedy`. Before ties became errors, the canonical order took the first.

The syntax stage of the four bundled Lojban dialects uses `late-elision`. Each grammar settles with rules of its own the choices that `late-elision` leaves tied, such as where a free modifier attaches.

The forms and words stages are lazy. The word forms divide a run in one way only, so in the forms stage the choice never decides where a word ends. A magic word, such as `si`, acts on other words. In the words stage, the choice makes a magic word act on what exists when it is read. So `mi si si` erases `mi` and then nothing.

## Elided terminators

CLL permits eliding a terminator "if no grammatical ambiguity results", and says no more about how a parser decides that. A stage decides it from the whole text. A grammar can restrict an individual terminator with `[++T]`.

A grammar marks each terminator that can be elided where it writes it. An elidable optional is a bracket, then `+`, then the terminator, then the rest of the optional:

```jbogenbau
%rule sumti-6
  | LE # sumti-tail [+KU #]
  | LI # mex [+LOhO #]
```

- The terminator `T` stands directly after the marker, as written, with no parentheses around it. So `[+(KU) #]`, `[+((KU)) #]`, `[+(KU #)]` and `[+(KU #) A]` are errors, although parentheses make no node elsewhere. One spelling for each marked optional keeps every reader's check the same, and the check reads the written text, before parentheses are dropped.
- `T` is an identifier tag: a bare name that begins with a capital, or `~name`. So `[+KU]` and `[+~KU]` mark the same terminator. A phoneme tag, a character tag, a range, a property, a rule and `#` cannot be the terminator.
- `T` can have an `=` test, as in `[+KU="ku"]`. Any other test on `T` is an error, because `elision-only` restores `T` with the sound of its test (below). A test on a later item is no error.
- The rest is a sequence of any primaries, or nothing. A choice or `&` in the rest stands in parentheses, as in `[+KU (A | B)]`. A `|` or `&` that joins `T` to something else is an error, because some reading of the optional then does not begin with `T`. So `[+KU | VAU]` is an error.
- No capture stands inside an elidable optional, at any depth (see "Captures").
- `[++T rest]` is the same, but its terminator is also maximal (below).

An elidable optional is an optional in every other way. It can stand anywhere that an optional can, inside braces and other optionals too. Spaces can stand between its parts, but the grammars write `[+KU #]` without them. `++` is one token, so `[+ +KU]` is an error.

A plain optional is never elidable, whatever it holds. So `[KU]`, `[KU | VAU]` and `[{KU}]` are ordinary optionals. Where one is absent, it counts for nothing and leaves no node, as an absent optional separator does. A grammar can read a terminator both ways: `[+KU]` in one rule and `[KU]` in another. Only the first one is elided.

The marker decides everything that follows in this section, and in "Ambiguity". It decides which absent optionals show as elided terminators and what `late-elision` counts. It also decides what maximality forbids and what `elision-only` writes back. The terminator of an elided node is `T`.

An elided terminator ends the part of its alternative that is written just before it. That part is its *constituent*: a rule, an optional or braces, once parentheses are spelled out. In `le nanmu joi le ninmu`, the `ku` elided after `nanmu` ends the `sumti-tail` of `LE sumti-tail [+KU #]`, which is `nanmu`. Some elided terminators have no constituent. These are the terminators elided directly after a terminal or at the start of their alternative. The next paragraph gives one more case.

Braces add no case of their own: these rules apply to the expanded productions that gencmu makes from the braces (engine §3, §4). So a terminator elided at the start of the first item of braces has no constituent, as at the start of an alternative. One at the start of each later item of `{x}` has none either, since what the braces read so far stands before it. The same holds at the start of each separator of `{x \ s}` or of a left chain.

At the start of a separator of a right chain, the end of the item stands before it. Its constituent is the last part of that item. It has none where that part is a terminal, or where the item is a reference to the chain's own rule.

A production is an alternative of the expanded grammar (engine §3). An elided terminator also has no constituent when it immediately follows the production's initial reference to its own rule. So a rule that an author writes with left recursion can have such terminators too.

A plain optional that holds a capture is expanded in place (see "Captures"), so it is no part of its own here. The part before the terminator is what the production reads before it. In `a [$b(b)] [+KU]`, where `a` and `b` are rules, that is `b` where the production reads `b`, and `a` where it does not. The usual exceptions still apply: in `A [$b(B)] [+KU]`, both productions put `KU` after a terminal, so it has no constituent in either.

By default, the constituent of an elided terminator can end wherever a parse of the whole text needs it to end. The ranking above chooses among the parses. So `le lojbo se farvi le loglo gi'enai mintu ja dunli le logla` parses. The `sumti-tail` of `le lojbo` ends before `se farvi`, which becomes the selbri (the main predicate). A parse with the longer `sumti-tail` `lojbo se farvi` leaves the sentence without a selbri.

A maximal terminator, written `[++T]`, cannot be elided where its constituent can be longer. If the constituent is a tested symbol, the test must hold of the longer one too. The longer constituent need not fit into a parse of the whole text. This restriction only removes parses and never chooses among those that remain.

If maximal terminators remove every main parse, the text is an error. The error names the first forbidden terminator in the parse that the stage ranks first without the restriction. Where that ranking ties, the engine's canonical order selects the diagnostic parse. The canonical order never decides whether the text parses.

`late-elision` ranks only complete parses. Maximal terminators can exclude a parse because of a longer constituent that fits no complete parse. So ranking cannot replace the restriction.

`[++T]` applies in the main parse and inside `matches`, `begins` and `tags`. Inside a query, the longer constituent lies within the query's span. Written-terminator priority also applies there. An optional written `[+T]` keeps the default, even when another optional of that terminal uses `[++T]`.

Only the Zantufa dialect uses `[++T]`, for `TOI` and `SEhU`, until its redesign (GitHub issues #138 and #139). The notation retires stage-wide `maximal`. A document that declares it is an error.

A rejection names a forbidden terminator only when maximality removes every main parse. A nested query that maximality changes only changes the value of its condition. If no parse then remains, the error is an ordinary rejection, which lists the terminals expected at the furthest position.

`[++T]` is for a construct that a reader closes as late as it can, such as a parenthesis. In Zantufa, `so to mi klama` can close the parenthesis `to` after `mi`, with `toi` elided, and leave `klama` as the selbri. The reference parser reads `to mi klama` as one parenthesis. No `toi` is written, so written-terminator priority cannot decide. With `TOI` maximal, the `to` cannot close before `klama`, because a longer parenthesis exists.

CLL's own rule is narrower: a terminator can be elided only if no ambiguity results. CLL says nothing of the other ambiguities of its EBNF. `elision-only` is one reading of that rule. It tests only the parse that the ranking chose, and CLL does not say how to choose that parse.

With `elision-only`, after the stage chooses one of several parses, it writes the elided terminators of that parse back into the input. A terminator with an `=` test sounds like the test's string there. So an elidable terminator has no test or an `=` test. Any other test on it is an error of the document, which the reader reports.

Then the stage parses that input again. Each elidable optional is now either restored or written. In the chosen parse's own reading, an optional that it left out is restored: it reads only its written-back terminator. Another reading can start an optional from a written-back terminator and read more after it, where the rest of the optional reads something.

In that parse, the grammar reads the text with its terminators written back, but every condition, tag and test of a rule sees the original input. A written-back terminator has no text, no sound and no tags there. So a condition answers as it did for the chosen parse, and the chosen parse is always one reading. A test on a terminal is the one exception: `KU="ku"` reads a written-back `KU` by its sound. A test on a rule, such as `t="ku"`, sees the original input like a condition.

If that parse has exactly one reading, the check passes. With two or more, the ambiguity is not about terminators, and the parse is an error that shows two readings. It never has none. If it does, that is a defect of the library, which it reports as the error `elision-witness-lost`. A tie is an error before the check runs, so the check sees only a text that the rule settled.

So the check fails only where one best parse survives, but the text with its terminators written back has two readings. The corpus measured for this decision had no such text, but that is no general guarantee. Historically, under `greedy`, `mi broda joi ke brode ke'e` was one. The CLL grammar now settles it as the official parser does. A plain joik, a joik that does not open its own `ke` group, cannot take a unit that is only a `ke` group.

The grammars that extend CLL are really ambiguous in places. A sumti is an argument of the selbri. A term is a wider kind of argument that includes the sumti. Historically, the experimental grammar read the `mi .e do` of `mi .e do klama` in two ways. It was two sumti joined by `.e`, or two terms joined by it. Its rule that a sumti connection comes before a term connection now settles it.

`late-elision` does not make `elision-only` redundant. Written-back terminators can let another alternative match, or let a test on a terminal match. So the check can find two readings where the ranking found one best parse.

The grammars that extend CLL do not declare `elision-only`. A caller can switch `elision-only` on for a parse, to find ambiguities that are not about terminators in the text that it supplies. Their conditions and tags were not reviewed for the check, as the CLL grammar's were. So a second reading that the check reports there can come from a condition that reads a written-back terminator otherwise than a written one. A caller can also switch it off, to loosen a grammar that declares it.
