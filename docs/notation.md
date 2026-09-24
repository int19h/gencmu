# jbogenbau, the grammar notation

Every grammar in gencmu is a Markdown document whose fenced `jbogenbau` blocks, read in order, are one grammar, and whose prose between the blocks explains it. This document explains jbogenbau, the notation those blocks use. The grammars only say what they are about and refer here for the rest. jbogenbau is defined by two grammars written in itself, `grammars/notation/lexical.md` and `grammars/notation/syntax.md`; this document explains it, and those define it.

A jbogenbau grammar is an attribute grammar with EBNF rule bodies. Each rule's body is EBNF in the dialect *The Complete Lojban Language* prints in chapter 21. Each constituent carries one attribute, its set of tags, computed bottom-up from its parts. Conditions over the parts, including whether a part also parses as another rule, restrict which parses exist, which takes the grammar beyond context-free in the way Boolean grammars do. And each rule may say what its constituents hand to the next stage, so that a grammar is a transducer from one sequence of tokens to the next, and a dialect is a pipeline of them. A grammar is unordered: alternatives are not ranked, and where a text has more than one parse the choice is made afterwards by one rule, described under "Ambiguity".

## Rules

A grammar is a sequence of rules and directives, each beginning with a keyword, a word after `%`, and ending where the next begins. A rule is `%rule`, its name, and its body:

```jbogenbau
%rule sumti-tail
  [sumti-6 [relative-clauses]] sumti-tail-1 | relative-clauses sumti-tail-1
```

Line breaks and indentation mean nothing, so a long list of alternatives may put each on a line of its own, and every `|` may also stand first. By convention the body is indented by two spaces under the keyword:

```jbogenbau
%rule term-not-starting-with-bare-gek
  | term-3-not-starting-with-bare-gek [term-connective term-3] ...
  | tagged-term (joik # | ek #) BO # tagged-term
  | @term-hierarchy term-3-not-starting-with-bare-gek (joik # | ek #) BO # term-3
```

The same is true of every separator the notation has: `&` in bodies, `∪` and `∩` in tag terms, `∧` and `∨` in conditions, and the commas of a clause's list.

A body may be followed by clauses, each a keyword and what it says, at most one of each and in this order: `%tags`, the tags every alternative's constituent carries; `%conditions`, what must hold of the parts; and `%emits`, what the constituent hands to the next stage. The sections below explain each.

`(* ... *)` is a comment, anywhere in a block.

## Names and terminals

A name is a letter followed by letters, digits and hyphens. A name that begins with a lower-case letter is a rule, and must be defined in the stage. A name that begins with an upper-case letter is a terminal: it matches a token of the input that carries that name as a tag, as `KOhA` matches a word the lexicon tagged KOhA.

Two other kinds of terminal spell tags a name cannot:

- a string in straight double quotes, `"а"`, `"word"`, `"≔"`; inside it, `\\` is a backslash, `\"` a quote, and `\u{ED80}` the code point with that hexadecimal value;
- a phoneme between slashes, `/a/`, `/'/`, and `/./` for a pause, which sounds as a space. It is a phoneme tag: it matches like any tag, and it also says what a token carrying it sounds like, which is what `phonemes()` reads.

## Operators

The operators of a body are those of CLL:

- juxtaposition is sequence;
- `[x]` is optional;
- `x ...` is one or more of `x`, and `[x] ...` zero or more; left grouping is implied;
- `A & B` is and/or: `A`, `B` or `A B`, but not `B A`, and `A & B & C` is any non-empty subsequence in that order;
- `( )` groups;
- `ε` is the empty sequence.

`...` binds tighter than `&`, which binds tighter than `|`.

`#` is the free-modifier slot, which CLL writes after almost every word. It is not an operator but a rule, whose name is `#` rather than a word, and the grammar defines it like any other: the syntax grammars define it as `[free ...]`, zero or more free modifiers, as CLL's own EBNF does. Its constituent is a node of the tree like any rule's, so the free modifiers in one slot are grouped under it.

CLL writes an elidable terminator between slashes, `/KU/`, and `/KU#/` for a terminator whose free-modifier slot goes with it. In this notation both are optionals, `[KU]` and `[KU #]`, and which terminators are elidable is declared once for the grammar (see "Directives"). Slashes are for phonemes.

## Feature guards

An alternative may begin with `@name` or `@¬name`. The alternative exists only when the feature `name` is enabled, respectively disabled, for the parse. Features come from the dialect's pipeline, which may enable some (see "Pipelines"), and from the caller, who may add others; the same set is enabled for every stage.

```jbogenbau
%rule tanru-unit-2
  | BRIVLA #
  | @cbm CMEVLA #
  | ...
```

## Stitching documents

A stage of a pipeline is several documents read in order, and a later one may change what an earlier one said. There are three ways to state a rule, and each says what it expects to be there already:

- `%rule` defines a rule, and it is an error if one of that name was defined before it, in an earlier document of the stage or earlier in the same one;
- `%redefine-rule` replaces a rule an earlier document defined, and it is an error if none did: the earlier alternatives are gone;
- `%extend-rule` adds alternatives to a rule defined before it, in an earlier document or earlier in the same one, and it is an error if none was.

```jbogenbau
%extend-rule consonant
  "б" </b/> | "в" </v/>
%emits
  $

%redefine-rule relative-clause
  | GOI # term [GEhU #]
  | @¬zantufa-terms NOI # subsentence [KUhO #]
  | @zantufa-terms NOI # statement [KUhO #]
```

So a misspelt name can neither quietly start a new rule nor quietly replace one. The alternatives an extension adds carry the extension's own clauses, not the base rule's, and the base rule's clauses do not apply to them, so an extension says everything about what it adds. The loader reports every replacement and extension, which document changed which rule, so a dialect's effect on its base can be read off in one place.

Removing a single alternative is not possible: a rule is small enough to restate, and restating it reads better than a list of deletions.

## Captures

A symbol of a rule's body may be captured by writing `$name(symbol)` around it. A capture wraps one symbol at the top level of an alternative, not inside `[ ]`, `...`, `( )` or `&`, so an alternative either reads that symbol or does not exist; an alternative has at most four. `$` alone is the whole constituent, a capture every alternative has without writing it.

The clauses of a rule serve all its alternatives, which need not capture the same parts. Whether an alternative captured a part is known when the grammar is read, and a clause refers to a capture an alternative lacks in one of two ways, depending on what the clause is:

- a condition, or an item of `%emits`, that uses a capture an alternative lacks does not apply to that alternative: a condition about a part that is not there holds, and a part that is not there is not emitted;
- a tag term that uses a capture an alternative it serves lacks is an error, unless the use is guarded by `⟹` (below), since a tag term has no value that could mean "nothing to say". An alternative's own tags serve that alternative, `%tags` every alternative, and an emitted item's tags every alternative that has the item.

A capture that no alternative of the rule, or of the extension, captures is an error wherever it is mentioned, and so is a condition or an item of `%emits` that applies to no alternative: each is a mistake, such as a misspelt name.

`$x`, standing as a condition, says whether the alternative captured `x`, which is also known when the grammar is read; `$` alone is always true. A presence test is decided for each alternative before anything else, so it is not a use of the capture: `%conditions $x` applies to every alternative, and removes those that do not capture `x`. `A ⟹ B`, where `A` is a condition, is `B` where `A` holds: as a condition, `B` or true; as a tag term, the tags of `B` or none. So a tag term that should apply only to the alternatives with a certain capture says so:

```jbogenbau
%rule word
  | $c(cmavo-shape) <"cmavo">
  | brivla-shape <"BRIVLA">
%tags
  "word" ∪ ($c ⟹ tags($c, lexicon))
```

## Conditions

`%conditions` lists what must hold of a rule's captured parts, separated by commas. A parse in which a condition fails does not exist: the parser checks each condition the moment it has read the last capture the condition mentions, and one that mentions `$` when the constituent is complete. Each condition of the list applies to the alternatives that capture everything it mentions, and to no other, so one rule can state a condition for the alternatives that have a quote body and none for the one that has not:

```jbogenbau
%rule zoi-quote
  | zoi-marker gap $open(word) PAUSE $content(body) PAUSE $close(word)
  | empty-zoi-quote
%conditions
  phonemes($open) = phonemes($close),
  phonemes($open) ∉ words($content)
```

Within one condition of the list, `∧` and `∨` join conditions, `∧` binding tighter, `⟹` binds looser than both and groups to the right, parentheses group, and `¬` negates the condition after it. A condition joined with `∧` is checked only once all its parts can be, so two conditions about different parts are better written as two items of the list, each checked as early as it can be.

The terms of a condition have three types.

**Spans.** A capture `$x` is a span, the tokens the captured part covers, and `$` the tokens the whole constituent covers. `head($x)` is its first token, `tail($x)` the rest, `last($x)` the last.

**Strings.** `phonemes(span)` is what a span sounds like: for each token, the phoneme its `/x/` tag names, or else the phonemes of the tokens it was emitted from, with a space for each pause and nothing for a token that has no phoneme. `text(span)` is the original text the span covers. `lowercase(string)` folds capitals, so `phonemes($m) ≠ lowercase(phonemes($m))` says that `$m` carries a stress mark. A string in quotes, or a phoneme tag, is a literal.

**Sets of tags.** `tags(span)` is the tag set of the captured part. `tags(span, rule)` is the tag set the span has when parsed as `rule`, unioned over every parse, and empty when it does not parse; this is how a word looks itself up in a lexicon that is itself a set of rules. `classes(span)` keeps only the tags that begin with a capital. `"KOhA"` is the set with that one tag, so `"UI" ∪ "CAI"` is the set of both; `∅` is empty; `∪` and `∩` are union and intersection, `∩` binding tighter.

**Lists.** `words(span)` is the list of pause-separated words of a span's phonemes.

The predicates are `=` and `≠` on two strings or two tag sets, `∈` and `∉` of a string in a list or a tag set, `⊆` of one tag set in another, `$x` of a capture, and `matches(span, rule)`, true when the span parses as the named rule. `matches` and `tags(span, rule)` parse the captured span alone, as the named rule, with the same grammar, which is how CLL's slinku'i test, "a borrowing is not a consonant followed by a string of rafsi", is stated as `¬matches(tail($b), rafsi-string)`. A condition that asks, inside such a parse, about the very span being parsed as the same rule defines the rule by its own negation; that has no answer, and the parser reports it as an error of the grammar.

## Tags

Every token and every constituent carries a set of tags. A terminal matches a token by tag, so the tags a grammar gives its constituents are the terminals of the grammar of the next stage. A rule says what tags its constituents carry with tag terms: in angle brackets after an alternative, for that alternative, and after `%tags`, for every alternative. A constituent's tags are the union of the two, where both are written:

```jbogenbau
%rule cmevla
  | @¬cbm $b(cmevla-body) <"CMEVLA">
  | @cbm $b(cmevla-body) <"CMEVLA" ∪ "BRIVLA">
%tags
  "word"

%rule cmavo
  $w(cmavo-body)
%tags
  "cmavo" ∪ tags($w, lexicon)
```

With no tags written at all, neither after the alternative nor after `%tags`, a constituent built from one symbol has that symbol's tags, and one built from several has none. So a rule `word` whose body is `cmavo | brivla | cmevla` needs no tags: a `mi` arrives at the next stage tagged by the chain of rules that built it. A tag term says what a constituent's tags are, so it cannot be made of them: `$`, `tags($)` and `classes($)` are errors there, while `tags($, lexicon)`, which parses the constituent's tokens again, is not.

A tag may be weak, `?"KOhA"`. A reading of a token under a weak tag loses, at the first difference between two parses, to a reading under a strong one. Weak tags are how a lexicon records a membership a dialect admits with a warning: the word may be read that way, but never in preference to its standard class.

## Emission

A rule with no `%emits` is walked: what it hands to the next stage is what its parts hand on, in order, and a token it reads directly hands on nothing. A rule with `%emits` hands on exactly what the list says, in the order it says it, and nothing else of the constituent is walked.

An item of the list is a capture, handed on as one token with the constituent's tags or with those of a tag term after it in angle brackets, or a string or phoneme tag, handed on as a token with that one tag and no text of its own. The captures must be listed in the order they stand in the text. `$` is the whole constituent, and a list of `$` items hands on one token over the whole constituent for each: `%emits $ </n/>, $ </o/>` is how the digit `0` becomes the phonemes of `no`. An inserted tag stands where it is listed: `%emits $g, /'/, $v` hands on an apostrophe between two vowels for a script that writes none. A tag term that gives no tags when the parse is made is an error of the grammar, since no terminal could read the token.

A capture with `<>`, no tags at all, is **silent**: it is not handed on, and nothing of it is heard in the phonemes of a token that covers it. `%emits $ <>` makes the whole constituent silent, which is what an erased stretch of text is: `broda si` hands on nothing, and a `bu` compound built across it does not sound like it. A part that is merely not listed is not handed on, but is still heard.

```jbogenbau
%rule plain-word
  cmavo | brivla | cmevla
%emits
  $

%rule quoted-word
  $m(zo-marker) gap $w(quotable-word)
%emits
  $m, $w <"word">

%rule erasure
  unit gap si-word
%emits
  $ <>
```

## Directives

A directive is a keyword and its words. By convention each stands in a block of its own, after prose that says why the grammar needs it.

- `%ambiguity-resolution greedy` or `lazy`, optionally followed by `elision-only`: how the stage chooses among parses, explained under "Ambiguity". Every stage must say it exactly once, in any of its documents.
- `%elidable KU KEI VAU ...`: the terminators that may be elided. An absent optional whose first symbol is one of them shows in the parse tree as that terminator, elided at that point, and `elision-only` writes them back.

## Pipelines

A dialect is a pipeline document, which is Markdown too: each stage is a heading, followed by the list of documents stitched into it and prose saying what the stage receives, does and hands on. The machine-readable parts are processing instructions at the end of a line, which GitHub does not show, so the document reads as plain hyperlinked prose there:

```
## Stage 1: phonemes <?stage phonemes?>

- [Latin orthography](../phonemes/latin.md) <?grammar?>
  ... what this document contributes ...
- [Cyrillic orthography](../phonemes/cyrillic.md) <?grammar?>

... what the stage receives, does and hands on ...
```

`<?stage NAME?>` at the end of a heading starts a stage called `NAME`. `<?grammar?>` at the end of a line makes the link on that line a document of the stage; the link must be written `[text](path)` with no spaces, parentheses or backslashes in the path. Stages run in document order, and documents are stitched in list order, which matters since a later document may redefine or extend a rule. Every stage's start rule is `text`. `<?features NAME ...?>` at the end of any line names features the dialect enables for every parse, to which a caller may add others. The first stage reads the text's characters, each a token tagged with the character itself and, weakly, its class; every later stage reads what the stage before it emitted.

## Ambiguity

A grammar admits every parse its rules allow. Where a text has more than one, each parse is read as the sequence of steps a bottom-up reader takes, reading the next token or closing a constituent, and at the first step where two differ:

- if both read the same token under two tags, a strong tag beats a weak one;
- if one reads and the other closes, the grammar's `%ambiguity-resolution` decides: `greedy` takes the one that reads, so a constituent ends as late as the grammar allows, and `lazy` takes the one that closes, so it ends as early as the grammar allows;
- if both close different constituents, the text is ambiguous for this grammar, and the result is a tie, reported with the two steps as its witness.

Constituents with a single symbol, and the ones the notation's sugar creates, are transparent to the comparison: two parses that differ only in such a relabelling have not yet diverged.

The preference is like greedy and lazy quantifiers in a backtracking regular expression engine, and unlike the greed of a PEG parser: it orders the parses the grammar already admits, never commits early, and so cannot reject a text; the earliest difference decides; and it applies to every constituent of the stage, not to one quantifier. The syntax grammars are greedy: an elided terminator sits as late as the grammar allows, which is what CLL's official YACC parser does. The word grammar is lazy: a word ends as early as it can, which is CLL's tosmabru rule, so `lemiklama` is `le mi klama`.

CLL's own rule is narrower: a terminator may be elided only if no ambiguity results, and CLL says nothing of its EBNF's other ambiguities. `elision-only` applies that rule literally. After choosing a parse, the chosen parse's elided terminators are written back into the input and it is parsed again with no terminator elidable; if it is still ambiguous, except for choices strong and weak tags settle, the ambiguity is not about terminators, and the parse is an error that shows both readings. For the CLL grammar this changes nothing: every ambiguous text of the corpus is about terminators. The grammars that extend CLL are really ambiguous in places, such as a bare `na` term beside a negated selbri, and declare only `greedy`. A caller can switch `elision-only` on or off for a parse, to check an extension for overlaps or to loosen a grammar that declares it.
