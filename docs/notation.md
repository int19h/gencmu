# The grammar notation

Every grammar in gencmu is a Markdown document whose fenced `ebnf` blocks,
read in order, are one grammar, and whose prose between the blocks explains
it. This document explains the notation those blocks use. The grammars only
say what they are about and refer here for the rest. The notation is defined
by two grammars written in itself, `grammars/notation/lexical.md` and
`grammars/notation/syntax.md`; this document explains it, and those define
it.

The notation keeps the look of the EBNF printed in *The Complete Lojban
Language*, chapter 21, and extends it: a rule may carry conditions that the
shape of a sequence cannot state, say what tags its constituents carry, and
say what it hands to the next stage of a pipeline. A grammar is unordered:
alternatives are not ranked, and where a text has more than one parse the
choice is made afterwards by one rule, described under "Ambiguity".

## Rules

A rule is its name, `≔`, its body, and `;`:

```
sumti-tail ≔ [sumti-6 [relative-clauses]] sumti-tail-1 | relative-clauses sumti-tail-1 ;
```

Line breaks mean nothing, so a long list of alternatives may put each on a
line of its own, and every `|` may also stand first:

```
term-not-starting-with-bare-gek ≔
| term-3-not-starting-with-bare-gek [term-connective term-3] ...
| tagged-term (joik # | ek #) BO # tagged-term
| @term-hierarchy term-3-not-starting-with-bare-gek (joik # | ek #) BO # term-3
;
```

The same is true of every separator the notation has: `&` in bodies, `∪` and
`∩` in tag terms, `,`, `∧` and `∨` in conditions.

`(* ... *)` is a comment, anywhere in a block.

## Names and terminals

A name is a letter followed by letters, digits and hyphens. A name that
begins with a lower-case letter is a rule, and must be defined in the
stage. A name that begins with an upper-case letter is a terminal: it
matches a token of the input that carries that name as a tag, as `KOhA`
matches a word the lexicon tagged KOhA.

Two other kinds of terminal spell tags a name cannot:

- a string in straight double quotes, `"а"`, `"word"`, `"≔"`; inside it,
  `\\` is a backslash, `\"` a quote, and `\u{ED80}` the code point with that
  hexadecimal value;
- a phoneme between slashes, `/a/`, `/'/`, and `/ /` for a pause. It is a
  phoneme tag: it matches like any tag, and it also says what a token
  carrying it sounds like, which is what `phonemes()` reads.

## Operators

The operators are those of CLL:

- juxtaposition is sequence;
- `[x]` is optional;
- `x ...` is one or more of `x`, and `[x] ...` zero or more; left grouping
  is implied;
- `A & B` is and/or: `A`, `B` or `A B`, but not `B A`, and `A & B & C` is any
  non-empty subsequence in that order;
- `( )` groups;
- `ε` is the empty sequence;
- `#` is shorthand for zero or more free modifiers, where the grammar says
  what a free modifier is: `%free-modifiers free ;` makes `#` mean
  `[free] ...`.

`...` binds tighter than `&`, which binds tighter than `|`.

CLL writes an elidable terminator between slashes, `/KU/`, and `/KU#/` for a
terminator whose free-modifier slot goes with it. In this notation both are
optionals, `[KU]` and `[KU #]`, and which terminators are elidable is
declared once for the grammar (see "Directives"). Slashes are for phonemes.

## Feature guards

An alternative may begin with `@name` or `@!name`. The alternative exists
only when the feature `name` is enabled, respectively disabled, for the
parse. Features come from the dialect's pipeline, which may enable some
(see "Pipelines"), and from the caller, who may add others; the same set is
enabled for every stage.

```
tanru-unit-2 ≔ BRIVLA # | @cbm CMEVLA # | ... ;
```

## Stitching documents

A stage of a pipeline is several documents read in order, and a later one
may change what an earlier one said:

```
consonant |≔ "б" </b/> | "в" </v/> ⇒ this ;

relative-clause ≔
| GOI # term [GEhU #]
| @!zantufa-terms NOI # subsentence [KUhO #]
| @zantufa-terms NOI # statement [KUhO #]
;
```

`|≔` adds alternatives to a rule defined before it, in an earlier document
or earlier in the same one; it is an error if none was, so a misspelt name
cannot quietly start a new rule. The added alternatives carry the extending
rule's own tags, emission and conditions, not the base rule's, so an
extension says everything about what it adds.

`≔` defines a rule and, if an earlier document defined it, replaces it: the
earlier alternatives are gone. Defining a rule twice with `≔` in one
document is an error. The loader reports every replacement and extension,
which document changed which rule, so a dialect's effect on its base can be
read off in one place.

Removing a single alternative is not possible: a rule is small enough to
restate, and restating it reads better than a list of deletions.

## Captures and conditions

A symbol of a rule's body may be captured by writing `$name(symbol)` around
it. A rule may then list conditions over its captures after `:`, joined by
`,` or `∧`; an item of the list may itself be several conditions joined by
`∨`, of which one must hold. A parse in which a condition fails does not
exist: the parser checks each condition the moment it has read the last
capture the condition mentions. A condition applies to every alternative
that captures all the parts it mentions and to no other, so one rule can
state a condition for the alternatives that have a quote body and none for
the one that has not. A capture wraps one symbol at the top level of an
alternative, not inside `[ ]`, `...`, `( )` or `&`, and an alternative has at
most four.

```
zoi-quote ≔ zoi-marker gap $open(word) PAUSE $content(body) PAUSE $close(word)
: phonemes($open) = phonemes($close), phonemes($open) ∉ words($content) ;
```

The terms of a condition have three types.

**Spans.** A capture `$x` is a span, the tokens the captured part covers.
`head($x)` is its first token, `tail($x)` the rest, `last($x)` the last.

**Strings.** `phonemes(span)` is what a span sounds like: for each token,
the phoneme its `/x/` tag names, or else the phonemes of the tokens it was
emitted from, with a space for each pause and nothing for a token that has
no phoneme. `text(span)` is the original text the span covers.
`lowercase(string)` folds capitals, so `phonemes($m) ≠
lowercase(phonemes($m))` says that `$m` carries a stress mark. A string in
quotes, or a phoneme tag, is a literal.

**Sets of tags.** `tags(span)` is the tag set of the captured part.
`tags(span, rule)` is the tag set the span has when parsed as `rule`, unioned
over every parse, and empty when it does not parse; this is how a word looks
itself up in a lexicon that is itself a set of rules. `classes(span)` keeps
only the tags that begin with a capital. `"KOhA"` is the set with that one
tag; `{"UI", "CAI"}` lists several; `∅` is empty; `∪` and `∩` are union and
intersection, `∩` binding tighter.

**Lists.** `words(span)` is the list of pause-separated words of a span's
phonemes.

The predicates are `=` and `≠` on two strings or two tag sets, `∈` and `∉`
of a string in a list or a tag set, `⊆` of one tag set in another, and
`matches(span, rule)`, true when the span parses as the named rule; `¬`
negates, and `¬( ... )` negates a whole condition. `matches` and
`tags(span, rule)` parse the captured span alone, as the named rule, with
the same grammar, which is how CLL's slinku'i test, "a borrowing is not a
consonant followed by a string of rafsi", is stated as `¬matches(tail($b),
rafsi-string)`. A condition that asks, inside such a parse, about the very
span being parsed as the same rule defines the rule by its own negation;
that has no answer, and the parser reports it as an error of the grammar.

## Tags

Every token and every constituent carries a set of tags. A terminal matches
a token by tag, so the tags a grammar gives its constituents are the
terminals of the grammar of the next stage. A rule says what tags its
constituents carry with a tag term in angle brackets: after an alternative
for that alternative, or after the rule's name for every alternative that
has none of its own.

```
cmevla ≔
| @!cbm $b(cmevla-body) <"CMEVLA">
| @cbm $b(cmevla-body) <"CMEVLA" ∪ "BRIVLA">
;

cmavo <"cmavo" ∪ tags($w, lexicon)> ≔ $w(cmavo-body) ;
```

With no tags at all, a constituent built from one symbol has that symbol's
tags, and one built from several has none. So `word ≔ cmavo | brivla |
cmevla ;` needs no tags: a `mi` arrives at the next stage tagged by the
chain of rules that built it.

A tag may be weak, `?"KOhA"`. A reading of a token under a weak tag loses,
at the first difference between two parses, to a reading under a strong
one. Weak tags are how a lexicon records a membership a dialect admits with
a warning: the word may be read that way, but never in preference to its
standard class.

## Emission

A rule says what its constituents hand to the next stage after `⇒`. `⇒ this`
emits the whole constituent as one token, carrying the constituent's tags;
`⇒ this <term>` emits it with the tags of the term instead, and `⇒ this
</n/>, this </o/>` emits it twice, as two tokens over the same text, which
is how the digit `0` becomes the phonemes of `no`. `⇒ $a <term>,
$b` emits the captured parts named, each as one token, in text order, with
the tags given or their own; a part not named is walked in turn, and its own
rules decide. A string or phoneme tag in the list, `⇒ $g, /'/, $v`, emits a
token with that one tag and no text of its own, for a phoneme the script
writes with no letter. `⇒ nothing` emits neither the constituent nor
anything inside it, which is what an erased stretch of text hands on. With
no `⇒`, a rule is transparent: the walk continues into its children.

```
plain-word ≔ cmavo | brivla | cmevla ⇒ this ;

quoted-word ≔ $m(zo-marker) gap $w(quotable-word) ⇒ $m, $w <"word"> ;

erasure ≔ unit gap si-word ⇒ nothing ;
```

## Directives

A directive starts with `%` and ends with `;`. By convention each stands in
a block of its own, after prose that says why the grammar needs it.

- `%ambiguity-resolution greedy ;` or `lazy`, optionally followed by
  `elision-only`: how the stage chooses among parses, explained under
  "Ambiguity". Every stage must say it exactly once, in any of its
  documents.
- `%elidable KU KEI VAU ... ;`: the terminators that may be elided. An
  absent optional whose first symbol is one of them shows in the parse tree
  as that terminator, elided at that point, and `elision-only` writes them
  back.
- `%free-modifiers free ;`: what `#` stands for.

## Pipelines

A dialect is a pipeline document, which is Markdown too: each stage is a
heading, followed by the list of documents stitched into it and prose
saying what the stage receives, does and hands on. The machine-readable
parts are processing instructions at the end of a line, which GitHub does
not show, so the document reads as plain hyperlinked prose there:

```
## Stage 1: phonemes <?stage phonemes?>

- [Latin orthography](../phonemes/latin.md) <?grammar?>
  ... what this document contributes ...
- [Cyrillic orthography](../phonemes/cyrillic.md) <?grammar?>

... what the stage receives, does and hands on ...
```

`<?stage NAME?>` at the end of a heading starts a stage called `NAME`.
`<?grammar?>` at the end of a line makes the link on that line a document of
the stage; the link must be written `[text](path)` with no spaces,
parentheses or backslashes in the path. Stages run in document order, and
documents are stitched in list order, which matters since `≔` replaces.
Every stage's start rule is `text`. `<?features NAME ...?>` at the end of
any line names features the dialect enables for every parse, to which a
caller may add others. The first stage reads the text's
characters, each a token tagged with the character itself and, weakly, its
class; every later stage reads what the stage before it emitted.

## Ambiguity

A grammar admits every parse its rules allow. Where a text has more than
one, each parse is read as the sequence of steps a bottom-up reader takes,
reading the next token or closing a constituent, and at the first step
where two differ:

- if both read the same token under two tags, a strong tag beats a weak one;
- if one reads and the other closes, the grammar's `%ambiguity-resolution`
  decides: `greedy` takes the one that reads, so a constituent ends as late
  as the grammar allows, and `lazy` takes the one that closes, so it ends as
  early as the grammar allows;
- if both close different constituents, the text is ambiguous for this
  grammar, and the result is a tie, reported with the two steps as its
  witness.

Constituents with a single symbol, and the ones the notation's sugar
creates, are transparent to the comparison: two parses that differ only in
such a relabelling have not yet diverged.

The preference is like greedy and lazy quantifiers in a backtracking regular
expression engine, and unlike the greed of a PEG parser: it orders the
parses the grammar already admits, never commits early, and so cannot
reject a text; the earliest difference decides; and it applies to every
constituent of the stage, not to one quantifier. The syntax grammars are
greedy: an elided terminator sits as late as the grammar allows, which is
what CLL's official YACC parser does. The word grammar is lazy: a word ends
as early as it can, which is CLL's tosmabru rule, so `lemiklama` is `le mi
klama`.

CLL's own rule is narrower: a terminator may be elided only if no ambiguity
results, and CLL says nothing of its EBNF's other ambiguities.
`elision-only` applies that rule literally. After choosing a parse, the
chosen parse's elided terminators are written back into the input and it is
parsed again with no terminator elidable; if it is still ambiguous, except
for choices strong and weak tags settle, the ambiguity is not about
terminators, and the parse is an error that shows both readings. For the CLL
grammar this changes nothing: every ambiguous text of the corpus is about
terminators. The grammars that extend CLL are really ambiguous in places,
such as a bare `na` term beside a negated selbri, and declare only `greedy`.
A caller can switch `elision-only` on or off for a parse, to check an
extension for overlaps or to loosen a grammar that declares it.
