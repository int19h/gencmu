# jbogenbau, the grammar notation

Every grammar in gencmu is a Markdown document. Its fenced `jbogenbau` blocks, read in order, are one grammar, and the prose between the blocks explains it. This document explains jbogenbau, the notation that those blocks use. The grammars only say what they are about, and refer here for the rest. Two grammars written in jbogenbau itself define it: `grammars/notation/lexical.md` and `grammars/notation/syntax.md`. This document explains the notation, and those two grammars define it.

A jbogenbau grammar is an attribute grammar with EBNF rule bodies. An attribute grammar is a grammar whose constituents carry computed values. A constituent is a part of the text that one rule matched. EBNF (Extended Backus-Naur Form) is a common notation for the bodies of grammar rules. Each rule body is EBNF in the form that *The Complete Lojban Language* (CLL) prints in chapter 21. Each constituent carries one attribute, its set of tags (labels such as `KOhA`), computed bottom-up from its parts.

Conditions over the parts restrict which parses exist. A condition can also ask whether a part parses as another rule. This takes the grammar beyond context-free grammars, whose rules only combine symbols. It goes beyond them in the way that Boolean grammars do. In a Boolean grammar, a rule can also require that the same text matches, or does not match, another rule.

A token is one unit of text. Examples are characters and words. A transducer reads tokens and emits another sequence. Each rule can also say what its constituents hand to the next stage. So a grammar is a transducer. A dialect is a pipeline of these grammars.

A grammar is unordered: its alternatives are not ranked. Where a text has more than one parse, one rule makes the choice afterwards. The section "Ambiguity" describes that rule.

## Rules

A grammar is a sequence of rules and directives (see "Directives"). Each one begins with a keyword, which is a word after `%`, and ends where the next one begins. A rule is `%rule`, its name, and its body:

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

The same is true of every other separator of the notation. These are `&` in bodies, `∪` and `∩` in tag terms, `∧` and `∨` in conditions, and the commas of a clause's list. A tag term is an expression that gives a set of tags.

A body can be followed by clauses. A clause is a keyword and what it says. A body has at most one clause of each kind, and the clauses come in this order:

- `%tags`: the tags that the constituent of every alternative carries.
- `%conditions`: what must hold of the parts.
- `%emits`: what the constituent hands to the next stage.
- `%verbatim`: the constituent's text is not read as sounds.

The sections below explain each clause.

`(* ... *)` is a comment, anywhere in a block.

## Names and terminals

A name is an ASCII letter followed by ASCII letters, digits and hyphens. A name that begins with a lower-case letter is a rule, and must be defined in the stage. A name that begins with an upper-case letter is a terminal. A terminal matches a token of the input that carries that name as a tag. For example, `KOhA` matches a word that the lexicon tagged KOhA.

Two other kinds of terminal can spell tags that a name cannot spell. The first is a string in straight double quotes, `"а"`, `"word"`, `"≔"`. Inside it, `\\` is a backslash and `\"` a quote. `\u{ED80}` is the character with that hexadecimal value. The value has one to six digits. It is at most `10FFFF`, and it is not a surrogate, `D800` to `DFFF`.

The second is a phoneme between slashes, `/a/`, `/'/`, and `/./` for a pause. It is a phoneme tag. It matches like any tag, and it also says what a token that carries it sounds like. `phonemes()` reads that sound.

A reference, a string or a phoneme tag can be followed by a spelling. A spelling is text between backticks, as in ``LE`la` ``. The symbol then matches only where what it spans sounds like the spelling. That is, the phonemes of its tokens, joined with no separator and lowercased, are the spelling. So a stressed `lA`, a Cyrillic `ла` and a zbalermorna `la` all match ``LE`la` ``.

A rule reference sounds like its whole span, so ``sumti`lomlatu` `` matches `lo mlatu`. Each token keeps its own periods. For example, `broda bu` is one `BY` word that sounds `broda.bu`. The spelling is written in phonemes, in lower case, with `'` for the apostrophe. An empty spelling is an error, as is one in capitals or one after `#`. Spaces and comments can stand between a symbol and its spelling, but the grammars write them together.

A symbol with a spelling is a spelled symbol. The spelling binds tighter than `...`, so every repetition of ``UI`ui` ...`` must sound like `ui`. A capture can wrap a spelled symbol, as in ``$l(LE`la`)``. An optional can hold one, as in ``[KU`ku`]``, which can be elided (left out) when `[KU]` can. A group, an optional, a capture or `ε` cannot take a spelling, so ``(LE NU)`lonu` `` is an error. A spelled symbol never matches an empty span.

A spelling does not replace a class. `zo la` quotes a word that sounds `la` but has only the tag `word`, so ``LE`la` `` does not match it.

## Operators

The operators of a body are those of CLL:

- Juxtaposition is sequence.
- `[x]` is optional.
- `x ...` is one or more of `x`, and `[x] ...` is zero or more. Left grouping is implied.
- `A & B` is and/or: `A`, `B` or `A B`, but not `B A`. `A & B & C` is any non-empty subsequence in that order.
- `( )` groups.
- `ε` is the empty sequence.

`...` binds tighter than `&`, which binds tighter than `|`.

`#` is the free-modifier slot, which CLL writes after almost every word. A free modifier is a word or phrase that stands almost anywhere. A vocative is an example.

`#` is not an operator but a rule, whose name is `#` and not a word. The grammar defines it like any other rule. The syntax grammars define it as `[free ...]`, zero or more free modifiers, as CLL's own EBNF does. Its constituent is a node of the tree like that of any rule, so the free modifiers in one slot are grouped under it.

A terminator is a word that closes a construct, such as `ku`. CLL writes a terminator that can be elided (left out) between slashes, `/KU/`. It writes `/KU#/` for such a terminator whose free-modifier slot goes with it. In this notation, both are optionals: `[KU]` and `[KU #]`. The grammar declares once which terminators are elidable (see "Directives"). Here, slashes are for phonemes.

## Feature guards

A feature is a name that is on or off for a parse. It has the same value in every stage of that parse. The pipeline of the dialect turns some features on (see "Pipelines"). The caller, the program or person that asks for the parse, can turn other features on, and can turn any of the dialect's features off. An alternative can begin with guards, which make it depend on features. There are two kinds of guard, gates and warnings.

A gate, `@name?`, keeps the alternative only while the feature `name` is on, and `@¬name?` keeps it only while the feature is off. A gate changes what the grammar accepts.

A warning, `@name!`, keeps the alternative whether the feature is on or off. While the feature is on, a parse whose chosen tree uses the alternative carries a warning. The warning names the feature and the text that the alternative's constituent covers. A warning changes nothing that the grammar accepts or chooses. It reports where a text relies on an addition to a base grammar.

An alternative with several guards exists when all its gates hold. A name is a gate or a warning, not both. If one guard uses a name as a gate and another guard uses it as a warning, the dialect has an error. The two guards can be in any stages of the dialect. A warning has no negated form, because it keeps its alternative either way.

```jbogenbau
%rule tanru-unit-2
  | BRIVLA #
  | @cbm? CMEVLA #
  | ...

%redefine-rule cmavo-token
  | $c("cmavo") <tags($c)>
  | @y-cmavo! $w("cmavo") <tags($w)>
%conditions
  "cmavo-warning" ∉ tags($c),
  "cmavo-warning" ∈ tags($w)
```

A dialect that extends another dialect can use the two kinds for two kinds of change. An addition is a text that the base grammar rejects and the dialect accepts. A warning can mark an addition, so that a reader can learn which additions a text relies on. The bundled dialects turn none of their warnings on, so their texts parse without warnings unless the caller asks for them.

A change to how the dialect reads a text of the base cannot be a warning. The change removes the base reading, and a warning changes nothing that the grammar accepts or chooses. So a gate can guard such a change, with the old form under `@¬name?` beside it. The dialect then turns the gate on, and a caller who wants the base reading turns it off.

The bundled dialects do not guard every change. The only bundled warning is `y-cmavo`, in the CLL dialect, so the additions of the experimental dialect carry no warning yet. A dialect also makes a change without a guard where a feature needs a convoluted grammar to keep the change separate. The documents of the dialect then say so.

## Stitching documents

A stage of a pipeline is the rules and directives of several documents, read in order. A later rule can change what an earlier one said. Only the order of the rules in the stage matters, not the document where each was written. There are three ways to state a rule, and each says what it expects to be there already:

- `%rule` defines a rule. It is an error if a rule of that name was defined before it in the stage.
- `%redefine-rule` replaces a rule defined before it in the stage. It is an error if none was. The earlier alternatives are gone.
- `%extend-rule` adds alternatives to a rule defined before it in the stage. It is an error if none was.

```jbogenbau
%extend-rule consonant
  "б" </b/> | "в" </v/>
%emits
  $

%redefine-rule text
  | @¬cbm? [NAI ...] CMEVLA ... # [joik-jek] text-1
  | [indicators & free ...] [joik-jek] text-1
```

So `%rule` never quietly replaces a rule. A misspelled name in `%redefine-rule` or `%extend-rule` is an error. So is a reference to a rule that no document defines. A misspelled `%rule` defines a new rule that nothing reads, and the audit (gencmu's report on a grammar) reports it as unreachable.

The alternatives that an extension adds carry the extension's own clauses, not those of the base rule. The clauses of the base rule do not apply to them. So an extension says everything about what it adds. The loader, the part of gencmu that reads the documents, reports every replacement and extension: which document changed which rule. So a reader can see the effect of a dialect on its base in one place.

The notation has no way to remove a single alternative. A rule is small enough to restate, and a restated rule reads better than a list of deletions.

## Captures

Writing `$name(symbol)` around a symbol of a rule's body captures that symbol. A capture gives a part of the constituent a name that the clauses of the rule can use. A capture wraps one symbol at the top level of an alternative, not inside `[ ]`, `...`, `( )` or `&`. So an alternative either reads that symbol or does not exist. An alternative has at most four captures. `$` alone is the whole constituent, a capture that every alternative has without writing it.

The gates can leave one alternative in a rule. If that alternative ends in `...`, an explicit capture in its body is an error. gencmu turns such an alternative into left recursion on its rule, and the recursive part has no place for the capture (engine §3). To capture a part there, move the repetition into a rule of its own.

The clauses of a rule serve all its alternatives, and the alternatives need not capture the same parts. gencmu knows whether an alternative captured a part when it reads the grammar. A clause can refer to a capture that an alternative lacks. What happens then depends on the kind of clause.

A condition or an item of `%emits` that uses a capture that an alternative lacks does not apply to that alternative. A condition about a part that is not there holds. A part that is not there is not emitted.

A tag term that uses a capture that one of its alternatives lacks is an error, unless `⟹` (below) guards the use. The reason is that a tag term has no value that can mean "nothing to say". An alternative's own tags serve that alternative. The tags after `%tags` serve every alternative. The tags of an emitted item serve every alternative that has the item.

It is an error to mention a capture that no alternative of the rule, or of the extension, captures. It is also an error to write a condition or an item of `%emits` that applies to no alternative. Each of these is a mistake, such as a misspelled name.

`$x`, standing as a condition, is a presence test: it says whether the alternative captured `x`. gencmu also knows this when it reads the grammar. `$` alone is always true. gencmu decides a presence test for each alternative before anything else, so it is not a use of the capture. So `%conditions $x` applies to every alternative, and removes those that do not capture `x`.

`A ⟹ B`, where `A` is a condition, is `B` where `A` holds. As a condition, it is `B` where `A` holds, and true elsewhere. As a tag term, it is the tags of `B` where `A` holds, and no tags elsewhere. So a tag term that is only for the alternatives with a certain capture says so:

```jbogenbau
%rule word
  | $c(cmavo-shape) <"cmavo">
  | brivla-shape <"BRIVLA">
%tags
  "word" ∪ ($c ⟹ tags($c, lexicon))
```

## Conditions

`%conditions` lists what must hold of a rule's captured parts, separated by commas. A parse in which a condition fails does not exist. The parser evaluates each condition as soon as it reads the last capture that the condition mentions. It evaluates a condition that mentions `$` when the constituent is complete. Each condition of the list applies to the alternatives that capture everything it mentions, and to no other alternative. So one rule can state a condition for the alternatives that have a quote body, and none for the alternative that does not:

```jbogenbau
%rule zoi-quote
  | zoi-marker gap $open(word) PAUSE $content(body) PAUSE $close(word)
  | empty-zoi-quote
%conditions
  phonemes($open) = phonemes($close),
  phonemes($open) ∉ runs($content)
```

Within one condition of the list, `∧` and `∨` join conditions, and `∧` binds tighter. `⟹` binds looser than both, and groups to the right. Parentheses group, and `¬` negates the condition after it. The parser evaluates a condition joined with `∧` only when it can evaluate all its parts. So two conditions about different parts are better as two items of the list. The parser then evaluates each one as early as it can.

The terms of a condition have three types: spans, strings and sets of tags.

A span is a sequence of tokens. A capture `$x` is a span, the tokens that the captured part covers, and `$` is the tokens that the whole constituent covers. `head($x)` is its first token, `tail($x)` the rest, and `last($x)` the last. `from($x)` is the tokens from the start of `$x` to the end of the input. `after($x)` is the tokens after `$x`, to the end of the input. These two reach past the constituent, to the text that follows it.

The second type is the string. `phonemes(span)` is what a span sounds like: the phonemes of its tokens, joined. A token's phonemes are fixed when its stage emits it. A token over a verbatim constituent sounds like its text (see "Verbatim text"). Any other token sounds like the phoneme that its strong `/x/` tag names, if it has one. Two strong phoneme tags on one token are an error of the grammar.

A token of neither kind sounds like the tokens of its stage's input that it covers, joined in order. That leaves out the tokens inside a rule that emits `ε` (see "Emission"). It also makes each run of pause tokens into one pause token, and removes a pause token at either end. A pause is `.`, so `klama bu` sounds as `klama.bu`. The renderings for people write a pause as a space.

`text(span)` is the original text that the span covers. `lowercase(string)` folds capitals. So `phonemes($m) ≠ lowercase(phonemes($m))` says that `$m` carries a stress mark. Where a condition compares one word's phonemes with a constant, as in `lowercase(phonemes($l)) = "la"`, a spelling says it in the body: ``LE`la` ``. A string in quotes, or a phoneme tag, is a literal.

The third type is the set of tags. `tags(span)` is the tag set of the captured part. `tags(span, rule)` is the tag set that the span has when parsed as `rule`, unioned over every parse. It is empty when the span does not parse as `rule`. This is how a word looks itself up in a lexicon that is itself a set of rules. `classes(span)` keeps only the tags that begin with a capital.

`"KOhA"` is the set with that one tag, so `"UI" ∪ "CAI"` is the set of both. `∅` is the empty set. `∪` and `∩` are union and intersection, and `∩` binds tighter.

`runs(span)` is the set of the runs of a span's phonemes. The runs are the strings between its pauses. So `phonemes($open) ∉ runs($content)` says that the word `$open` is not one of the runs of `$content`. A run can hold several words: a text writes `lemiklama` as one run.

The predicates are:

- `=` and `≠`, on two strings or two tag sets.
- `∈` and `∉`, of a string in a tag set. The left side must be a string, so a tag set there is an error.
- `⊆`, of one tag set in another.
- `$x`, of a capture.
- `matches(span, rule)`, true when the span parses as the named rule.
- `begins(span, rule)`, true when some prefix of the span parses as the rule. The empty prefix counts.
- `initial(span)`, true when the span begins where the parser's input begins.

`matches` and `tags(span, rule)` parse the captured span alone, as the named rule, with the same grammar. This is how gencmu states CLL's slinku'i test for borrowings. A CV cmavo is a particle of one consonant and one vowel. The test says that such a cmavo before a borrowing must not make a lujvo, a compound word. That is `¬matches($f, lujvo-after-cv)`, because the rule is the part of a lujvo after its first two letters.

Inside such a parse, a condition can ask about the very span that is being parsed, as the same rule. Such a condition defines the rule in terms of itself over the same text, negated or not. The parser reports it as an error of the grammar.

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

Sometimes no tags are written at all, neither after the alternative nor after `%tags`. Then a constituent built from one symbol has that symbol's tags, and a constituent built from several symbols has none. So a rule `word` whose body is `cmavo | brivla | cmevla` needs no tags. A `mi` arrives at the next stage tagged by the chain of rules that built it.

A tag term that defines a constituent's tags cannot be made of those tags. So `$`, `tags($)` and `classes($)` are errors in a tag term after an alternative or after `%tags`. `tags($, lexicon)` is not an error there, because it parses the constituent's tokens again. The tag term of an emitted item does not define the constituent's tags, so it can use `$`, `tags($)` and `classes($)`.

A tag can be weak, as in `?"KOhA"`. A tag that is not weak is strong. A reading of a token under a weak tag loses, at the first difference between two parses, to a reading under a strong one. Weak tags are how a lexicon records a membership that a dialect admits as a second choice. The word can be read that way, but never in preference to its standard class. A warning comes only from a feature guard of the form `@name!`.

## Emission

The stage walks a rule with no `%emits`. What it hands to the next stage is what its parts hand on, in order. A token that it reads directly hands on nothing. A rule with `%emits` hands on exactly what the list says, in the order that the list says it. The stage walks nothing else of the constituent.

An item of the list can be a capture. The stage hands a capture on as one token. The token has the constituent's tags, or the tags of a tag term after the capture in angle brackets. An item can also be a string or a phoneme tag. The stage hands it on as a token with that one tag and no text of its own. The author must list the captures in the order they stand in the text.

`$` is the whole constituent. A list of `$` items hands on one token over the whole constituent for each item. For example, `%emits $ </n/>, $ </o/>` is how the digit `0` becomes the phonemes of `no`. An inserted tag stands where it is listed. So `%emits $g, /'/, $v` hands on an apostrophe between two vowels, for a script that writes none. A tag term that gives no tags when the parse is made is an error of the grammar, because no terminal can read the token.

`%emits ε` hands on nothing, and it does more: the constituent does not count. So nothing in it is part of what a token over it sounds like. That is what an erased stretch of text is. `broda brode si bu` hands on the letter word `broda bu` (`si` erases the word before it). Its token covers `brode si` too, because a `si` erasure can stand between a word and its `bu`. But the token does not sound like `brode si`.

A part that the list of a rule merely does not name is not handed on, but it still counts. For example, a pause inside a quote is part of what a compound over the quote sounds like. A rule with no `%emits` that happens to hand on nothing, as a gap does, counts as well. Only `ε` says that text does not count.

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

The token also takes in the text next to it that no token of the stage's input covers. An example is punctuation that the stage before read as part of a pause but did not emit. So its text starts at the end of the input token before it, or at the start of the text. It ends at the start of the input token after it, or at the end of the text. Text between two such tokens of one stage belongs to the first of them.

A token of a later stage that covers only one verbatim token is verbatim too. So a quote body stays verbatim to the end of the pipeline. The renderings for people show a verbatim token's text as it is, and do not write its periods as spaces. A rule cannot have both `%verbatim` and `%emits ε`, because a constituent that does not count cannot sound like its text.

## Directives

A directive is a keyword and its operands. By convention each stands in a block of its own, after prose that says why the grammar needs it. Two directives can share a line.

- `%ambiguity-resolution greedy` or `lazy`, optionally followed by `elision-only`, and then optionally by `maximal`: how the stage chooses among parses, explained under "Ambiguity" and "Elided terminators". Every stage must say it exactly once, in any of its documents.
- `%elidable KU KEI VAU ...`: the terminators that can be elided. An absent optional whose first symbol is one of them shows in the parse tree as that terminator, elided at that point. `elision-only` writes these terminators back.
- `%stage NAME`, `%include "PATH"` and `%features NAME ...` build a pipeline, as the next section says.

## Pipelines

A dialect is a pipeline document, which is Markdown too. Each stage is a heading, followed by the list of its documents. Prose then says what the stage receives, does and hands on. Three directives in `jbogenbau` blocks say what the pipeline is made of:

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
- `%features NAME ...` names features the dialect turns on for every parse, wherever it stands. A caller can turn other features on, and can turn any of these off.

Rules can also stand in the pipeline document itself, between its `%include` blocks. The loader stitches them in their places. A rule or a stage-level directive before the first `%stage` is an error. So are two stages of one name and a stage with no rules.

By convention, each document keeps its link in the prose, and its `%include` follows in a block of its own, in the same list item. So the pipeline reads as hyperlinked prose. A block's fence can be indented by up to three spaces, so a block can stand under a list item, indented by two. The reader knows no other Markdown container.

The layout is a matter of style, and the notation does not require it. An `%include` can stand in any block, between any two rules or directives. `tools/sync.js --check` makes sure that the bundled pipelines keep the style.

The first stage reads the text's characters, each a token tagged with the character itself and, weakly, its class. Every later stage reads what the stage before it emitted.

`gencmu stitch --dialect NAME` prints a dialect's pipeline as one jbogenbau text. The command replaces every `%include` with what it stands for, and puts the dialect's features in one `%features` at the top. Each run of rules from one document follows a comment naming it.

## Ambiguity

A grammar admits every parse that its rules allow. Where a text has more than one parse, gencmu treats each parse as the sequence of steps that a bottom-up reader takes. A step reads the next token or closes a constituent. gencmu compares the parses at the first step where two of them differ:

- If both read the same token under two tags, a strong tag beats a weak one.
- If one reads and the other closes, the grammar's `%ambiguity-resolution` decides. `greedy` takes the one that reads, so a constituent ends as late as the grammar allows. `lazy` takes the one that closes, so a constituent ends as early as the grammar allows.
- If both close different constituents, the text is ambiguous for this grammar. The result is a tie, reported with the two steps as its witness.

Constituents with a single symbol, and the helper constituents that the notation creates for `[ ]` and `...`, are transparent to the comparison. So two parses that differ only in such a relabeling do not differ yet.

The preference is like greedy and lazy quantifiers in a backtracking regular-expression engine. It is unlike the greed of a PEG parser. The preference orders the parses that the grammar already admits, and never commits early, so it cannot reject a text. The earliest difference decides. And it applies to every constituent of the stage, not to one quantifier.

The syntax grammars are greedy: an elided terminator sits as late as the grammar allows. The forms and words stages are lazy. The word forms divide a run in one way only, so in the forms stage the choice never decides where a word ends. A magic word, such as `si`, acts on other words. In the words stage, the choice makes a magic word act on what exists when it is read. So `mi si si` erases `mi` and then nothing.

## Elided terminators

CLL permits eliding a terminator "if no grammatical ambiguity results", and says no more about how a parser decides that. By default, a stage decides it from the whole text. A stage that declares `maximal` decides it as a PEG does.

An elided terminator ends the part of its alternative that is written just before it. That part is its *constituent*: a rule, an optional or a repetition, once parentheses are spelled out. In `le nanmu joi le ninmu`, the `ku` elided after `nanmu` ends the `sumti-tail` of `LE sumti-tail [KU #]`, which is `nanmu`. Some elided terminators have no constituent. These are the terminators elided after a single word, at the start of their alternative, or at the start of a repeated item. At the start of a repeated item, what the repetition read so far stands before the terminator.

By default, the constituent of an elided terminator can end wherever a parse of the whole text needs it to end. The ranking above chooses among the parses. So `le lojbo se farvi le loglo gi'enai mintu ja dunli le logla` parses. The `sumti-tail` of `le lojbo` ends before `se farvi`, which becomes the selbri (the main predicate). A parse with the longer `sumti-tail` `lojbo se farvi` leaves the sentence without a selbri.

`maximal` forbids an elided terminator where its constituent can be longer. If the constituent is a spelled symbol, the longer one must sound like the spelling too. That is what a PEG's greedy repetition does: once a PEG reads a constituent, it never gives back what it read.

`le nanmu joi le ninmu cu klama` parses, because no longer `sumti-tail` begins at `nanmu`. `joi` can continue a tanru (a compound predicate), but `le` cannot follow it. The `le lojbo` text is an error, because `lojbo se farvi` is a longer `sumti-tail`. The longer constituent need not fit into a parse of the whole text, and that is what makes `maximal` commit as a PEG does.

`maximal` only removes parses, and never chooses among the parses that remain. A text that is still ambiguous is chosen or reported as before. `maximal` does not order the alternatives of a rule, as a PEG does. A stage that declares `maximal` still sees every parse that its rules allow, apart from those that `maximal` removes.

If `maximal` leaves a text with no parse, the text is an error. The error is at the first terminator that `maximal` forbids in the parse that the stage chooses without `maximal`. Writing that terminator out ends its constituent there.

CLL's own rule is narrower: a terminator can be elided only if no ambiguity results. CLL says nothing of the other ambiguities of its EBNF. `elision-only` applies that rule literally.

With `elision-only`, after the stage chooses a parse, it writes the elided terminators of that parse back into the input. A spelled terminator that it writes back sounds like its spelling. Then it parses the input again, with no terminator elidable. If the input is still ambiguous, apart from choices that strong and weak tags settle, the ambiguity is not about terminators. The parse is then an error that shows both readings. For the CLL grammar, `elision-only` rejects only the few texts that the printed grammar leaves ambiguous in more than a terminator, such as `mi broda joi ke brode ke'e`.

The grammars that extend CLL are really ambiguous in places. A sumti is an argument of the selbri. A term is a wider kind of argument that includes the sumti. In the experimental grammar, the `mi .e do` of `mi .e do klama` is two sumti joined by `.e`, or two terms joined by it.

These grammars declare only `greedy`. A caller can switch `elision-only` on for a parse, to look for overlaps in the text that it supplies. A caller can also switch it off, to loosen a grammar that declares it.
