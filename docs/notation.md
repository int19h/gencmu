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
  | @term-hierarchy? term-3-not-starting-with-bare-gek (joik # | ek #) BO # term-3
```

The same is true of every separator the notation has: `&` in bodies, `∪` and `∩` in tag terms, `∧` and `∨` in conditions, and the commas of a clause's list.

A body may be followed by clauses, each a keyword and what it says, at most one of each and in this order: `%tags`, the tags every alternative's constituent carries; `%conditions`, what must hold of the parts; `%emits`, what the constituent hands to the next stage; and `%verbatim`, which says that the constituent's text is not read as sounds. The sections below explain each.

`(* ... *)` is a comment, anywhere in a block.

## Names and terminals

A name is a letter followed by letters, digits and hyphens. A name that begins with a lower-case letter is a rule, and must be defined in the stage. A name that begins with an upper-case letter is a terminal: it matches a token of the input that carries that name as a tag, as `KOhA` matches a word the lexicon tagged KOhA.

Two other kinds of terminal spell tags a name cannot:

- a string in straight double quotes, `"а"`, `"word"`, `"≔"`; inside it, `\\` is a backslash, `\"` a quote, and `\u{ED80}` the code point with that hexadecimal value;
- a phoneme between slashes, `/a/`, `/'/`, and `/./` for a pause. It is a phoneme tag: it matches like any tag, and it also says what a token carrying it sounds like, which is what `phonemes()` reads.

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

A feature is a name that is on or off for a parse, the same for every stage of it. The dialect's pipeline turns some features on (see "Pipelines"), and the caller can turn others on and any of those off. An alternative may begin with guards, which make it depend on features. There are two kinds:

- A gate, `@name?`, keeps the alternative only while the feature `name` is on, and `@¬name?` keeps it only while the feature is off. A gate changes what the grammar accepts.
- A warning, `@name!`, keeps the alternative whether the feature is on or off. While the feature is on, a parse whose chosen tree uses the alternative carries a warning that names the feature and the text the alternative's constituent covers. A warning changes nothing that the grammar accepts or chooses. It reports where a text relies on an addition to a base grammar.

An alternative with several guards exists when all its gates hold. A name is a gate or a warning, not both: a name that one guard uses as a gate and another as a warning, in any stage of a dialect, is an error of the dialect. A warning has no negated form, since it keeps its alternative either way.

```jbogenbau
%rule tanru-unit-2
  | BRIVLA #
  | @cbm? CMEVLA #
  | ...

%rule sumti-tail
  | [sumti-6 [relative-clauses]] sumti-tail-1
  | relative-clauses sumti-tail-1
  | @inner-sumti! sumti sumti-tail-1
```

A dialect that extends another uses the two kinds for two kinds of change. An addition, a text the base grammar rejects and the dialect accepts, is a warning, so that a reader can learn which additions a text relies on. The dialect turns none of its warnings on, so that its texts parse without warnings unless the caller asks. A change to how the dialect reads a text of the base cannot be a warning, since the base reading would be gone. It is a gate, with the old form under `@¬name?` beside it, and the dialect turns it on; a caller who wants the base reading turns it off.

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
  | @¬zantufa-terms? NOI # subsentence [KUhO #]
  | @zantufa-terms? NOI # statement [KUhO #]
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

**Spans.** A capture `$x` is a span, the tokens the captured part covers, and `$` the tokens the whole constituent covers. `head($x)` is its first token, `tail($x)` the rest, `last($x)` the last. `from($x)` is the tokens from the start of `$x` to the end of the input, and `after($x)` the tokens after `$x` to the end of the input. These two reach past the constituent, to the text that follows it.

**Strings.** `phonemes(span)` is what a span sounds like: the phonemes of its tokens, joined. A token's phonemes are fixed when its stage emits it. A token over a verbatim constituent sounds like its text (see "Verbatim text"). Any other token sounds like the phoneme its `/x/` tag names, if it has one. Otherwise it sounds like the tokens of that stage's input that it covers, joined in order. That leaves out the tokens inside a rule that emits `ε` (see "Emission"). It also makes each run of pause tokens one, and removes a pause token at either end. A pause is `.`, so `klama bu` sounds as `klama.bu`; the renderings for people write it as a space. `text(span)` is the original text the span covers. `lowercase(string)` folds capitals, so `phonemes($m) ≠ lowercase(phonemes($m))` says that `$m` carries a stress mark. A string in quotes, or a phoneme tag, is a literal.

**Sets of tags.** `tags(span)` is the tag set of the captured part. `tags(span, rule)` is the tag set the span has when parsed as `rule`, unioned over every parse, and empty when it does not parse; this is how a word looks itself up in a lexicon that is itself a set of rules. `classes(span)` keeps only the tags that begin with a capital. `"KOhA"` is the set with that one tag, so `"UI" ∪ "CAI"` is the set of both; `∅` is empty; `∪` and `∩` are union and intersection, `∩` binding tighter. `words(span)` is the set of the words of a span's phonemes, the strings between its pauses, so `phonemes($open) ∉ words($content)` says that the word `$open` does not occur in `$content`.

The predicates are `=` and `≠` on two strings or two tag sets, `∈` and `∉` of a string in a tag set, `⊆` of one tag set in another, `$x` of a capture, `matches(span, rule)`, true when the span parses as the named rule, `begins(span, rule)`, true when some prefix of the span parses as the rule, the empty prefix included, and `initial(span)`, true when the span begins where the parser's input begins. `matches` and `tags(span, rule)` parse the captured span alone, as the named rule, with the same grammar, which is how CLL's slinku'i test is stated. No CV cmavo put before a borrowing may make a lujvo. That is `¬matches($f, lujvo-after-cv)`, since the rule is the part of a lujvo after its first two letters. A condition that asks, inside such a parse, about the very span being parsed as the same rule defines the rule in terms of itself over the same text, negated or not; the parser reports it as an error of the grammar.

`begins` with `from` or `after` is a lookahead, as a parsing expression grammar has one: it asks whether a rule could be read at a point, without reading it. `begins(after($f), post-word)` says that what follows `$f` begins with a `post-word`, which may lie in the words after the constituent. `¬begins(from($f), cmevla)` says that no `cmevla` begins where `$f` begins, as a PEG's `!cmevla` before `$f` does. The approved word forms use these to translate their PEG rule by rule. The nested parse of `begins` reads only as far as the rule can, so a lookahead costs what reading the rule costs, however long the rest of the input is.

`initial` lets a rule begin only at the start of the input. The rule below matches nothing, and its condition holds only where the input begins, so an alternative that starts with `text-start` is read there and nowhere else. The parser checks the condition before it looks further, so such an alternative costs nothing at the other positions. In a nested parse, the input is the span being parsed, so `initial` holds at the span's start.

```jbogenbau
%rule text-start
  ε
%conditions
  initial($)
```

## Tags

Every token and every constituent carries a set of tags. A terminal matches a token by tag, so the tags a grammar gives its constituents are the terminals of the grammar of the next stage. A rule says what tags its constituents carry with tag terms: in angle brackets after an alternative, for that alternative, and after `%tags`, for every alternative. A constituent's tags are the union of the two, where both are written:

```jbogenbau
%rule cmevla
  | @¬cbm? $b(cmevla-body) <"CMEVLA">
  | @cbm? $b(cmevla-body) <"CMEVLA" ∪ "BRIVLA">
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

`%emits ε` hands on nothing, and more: the constituent does not count, so none of it is part of what a token over it sounds like. That is what an erased stretch of text is. `broda brode si bu` hands on the letter word `broda bu`, whose token covers `brode si` too, since a `si` erasure may stand between a word and its `bu`, but does not sound like it. A part a rule's list merely does not name is not handed on, but it still counts: a pause inside a quote is part of what a compound over the quote sounds like. A rule with no `%emits` that happens to hand on nothing, as a gap does, counts as well; only `ε` says that text does not count.

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
  ε
```

## Verbatim text

`%verbatim` says that a rule's constituents are text that is not Lojban. Examples are the body of a `zoi` quote and a run of letters that no script reads. A token over such a constituent sounds like what the author wrote: its phonemes are its text, whatever tags it carries. This is true whether the constituent emits the token with `$` or a parent emits it as a capture. So `zoi gy. John is a man .gy.` hands on the body as `John is a man`. The stage before emitted the phonemes `jo'n.is.a.man` for it.

```jbogenbau
%rule zoi-body
  zoi-part | zoi-body zoi-part
%verbatim
```

The token also takes in the text next to it that no token of the stage's input covers. An example is punctuation that the stage before read as part of a pause but did not emit. So its text starts at the end of the input token before it, or at the start of the text. It ends at the start of the input token after it, or at the end of the text. Text between two such tokens of one stage belongs to the first of them. A token of a later stage that covers only one verbatim token is verbatim too, so a quote body stays verbatim to the end of the pipeline. The renderings for people show a verbatim token's text as it is, and do not write its periods as spaces. A rule cannot have both `%verbatim` and `%emits ε`, since a constituent that does not count cannot sound like its text.

## Directives

A directive is a keyword and its words. By convention each stands in a block of its own, after prose that says why the grammar needs it.

- `%ambiguity-resolution greedy` or `lazy`, optionally followed by `elision-only`, and then optionally by `maximal`: how the stage chooses among parses, explained under "Ambiguity" and "Elided terminators". Every stage must say it exactly once, in any of its documents.
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

`<?stage NAME?>` at the end of a heading starts a stage called `NAME`. `<?grammar?>` at the end of a line makes the link on that line a document of the stage; the link must be written `[text](path)` with no spaces, parentheses or backslashes in the path. Stages run in document order, and documents are stitched in list order, which matters since a later document may redefine or extend a rule. Every stage's start rule is `text`. `<?features NAME ...?>` at the end of any line names features the dialect turns on for every parse. A caller can turn other features on, and can turn any of these off. The first stage reads the text's characters, each a token tagged with the character itself and, weakly, its class; every later stage reads what the stage before it emitted.

## Ambiguity

A grammar admits every parse its rules allow. Where a text has more than one, each parse is read as the sequence of steps a bottom-up reader takes, reading the next token or closing a constituent, and at the first step where two differ:

- if both read the same token under two tags, a strong tag beats a weak one;
- if one reads and the other closes, the grammar's `%ambiguity-resolution` decides: `greedy` takes the one that reads, so a constituent ends as late as the grammar allows, and `lazy` takes the one that closes, so it ends as early as the grammar allows;
- if both close different constituents, the text is ambiguous for this grammar, and the result is a tie, reported with the two steps as its witness.

Constituents with a single symbol, and the ones the notation's sugar creates, are transparent to the comparison: two parses that differ only in such a relabelling have not yet diverged.

The preference is like greedy and lazy quantifiers in a backtracking regular expression engine, and unlike the greed of a PEG parser: it orders the parses the grammar already admits, never commits early, and so cannot reject a text; the earliest difference decides; and it applies to every constituent of the stage, not to one quantifier. The syntax grammars are greedy: an elided terminator sits as late as the grammar allows. The word grammar is lazy: a word ends as early as it can, which is CLL's tosmabru rule, so `lemiklama` is `le mi klama`.

## Elided terminators

CLL permits eliding a terminator "if no grammatical ambiguity results", and says no more about how a parser decides that. By default a stage decides it from the whole text; a stage that declares `maximal` decides it as a PEG does.

An elided terminator ends the part of its alternative written just before it, its *constituent*: a rule, an optional or a repetition, once parentheses are spelled out. In `le nanmu joi le ninmu`, the `ku` elided after `nanmu` ends the `sumti-tail` of `LE sumti-tail [KU #]`, which is `nanmu`. A terminator elided after a single word, at the start of its alternative, or at the start of a repeated item, where what the repetition has read so far stands before it, has no constituent.

By default, the constituent of an elided terminator may end wherever a parse of the whole text needs it to end, and the ranking above chooses among the parses. So `le lojbo se farvi le loglo gi'enai mintu ja dunli le logla` parses: the `sumti-tail` of `le lojbo` ends before `se farvi`, which becomes the selbri, since the longer `sumti-tail` `lojbo se farvi` would leave the sentence without one.

`maximal` forbids an elided terminator where its constituent could have been longer. That is what a PEG's greedy repetition does: once a PEG has read a constituent, it never gives back what it read. `le nanmu joi le ninmu cu klama` parses, since no longer `sumti-tail` begins at `nanmu`: `joi` may continue a tanru, but `le` may not follow it. The `le lojbo` text is an error, since `lojbo se farvi` is a longer `sumti-tail`. The longer constituent need not fit into a parse of the whole text, which is what makes `maximal` commit as a PEG does.

`maximal` only removes parses. It never chooses among the parses that remain, and a text that is still ambiguous is chosen or reported as before. It does not order the alternatives of a rule, as a PEG does: a stage that declares `maximal` still sees every parse its rules allow, apart from those it removes. A text that it leaves with no parse is an error at the first terminator it forbids in the parse the stage would otherwise have chosen; writing that terminator out ends its constituent there.

CLL's own rule is narrower: a terminator may be elided only if no ambiguity results, and CLL says nothing of its EBNF's other ambiguities. `elision-only` applies that rule literally. After choosing a parse, the chosen parse's elided terminators are written back into the input and it is parsed again with no terminator elidable; if it is still ambiguous, except for choices strong and weak tags settle, the ambiguity is not about terminators, and the parse is an error that shows both readings. For the CLL grammar this changes nothing: every ambiguous text of the corpus is about terminators. The grammars that extend CLL are really ambiguous in places, such as a bare `na` term beside a negated selbri, and declare only `greedy`. A caller can switch `elision-only` on or off for a parse, to check an extension for overlaps or to loosen a grammar that declares it.
