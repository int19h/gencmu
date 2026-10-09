# The word stream: railroad diagrams

These are the rules of [The word stream](../../../grammars/words/stream.md), one diagram for each rule, in the order of the document.

`node tools/sync.js` writes this page and the diagrams from the document, so edit the document instead.

[Railroad diagrams](../../design.md#railroad-diagrams) in the design document explains how to read them.

## The stream of elements

These rules are in [this section of the document](../../../grammars/words/stream.md#the-stream-of-elements).

### `text`

The diagram leaves out its conditions.

![The rule text](stream/text.svg)

### `text-start`

The diagram leaves out its conditions.

![The rule text-start](stream/text-start.svg)

### `empty`

The diagram leaves out its emission.

![The rule empty](stream/empty.svg)

### `su-cleared`

The diagram leaves out its conditions.

![The rule su-cleared](stream/su-cleared.svg)

### `stream`

The diagram leaves out its tags.

![The rule stream](stream/stream.svg)

### `unit`

![The rule unit](stream/unit.svg)

### `spacing`

![The rule spacing](stream/spacing.svg)

### `skipped`

![The rule skipped](stream/skipped.svg)

### `erasures`

![The rule erasures](stream/erasures.svg)

### `erasure`

![The rule erasure](stream/erasure.svg)

### `fault-unit`

The diagram leaves out its tags and emission.

![The rule fault-unit](stream/fault-unit.svg)

### `hesitation`

The diagram leaves out its tags, conditions and emission.

![The rule hesitation](stream/hesitation.svg)

### `y-run`

![The rule y-run](stream/y-run.svg)

### `faho-group`

The diagram leaves out its emission.

![The rule faho-group](stream/faho-group.svg)

### `faho-word`

![The rule faho-word](stream/faho-word.svg)

### `sa-tail`

The diagram leaves out its conditions.

![The rule sa-tail](stream/sa-tail.svg)

## Words

These rules are in [this section of the document](../../../grammars/words/stream.md#words).

### `read-word`

The diagram leaves out its tags.

![The rule read-word](stream/read-word.svg)

### `y-bu-word`

The diagram leaves out its tags and emission.

![The rule y-bu-word](stream/y-bu-word.svg)

### `word`

The diagram leaves out its tags, conditions and emission.

![The rule word](stream/word.svg)

### `cmavo-token`

The diagram leaves out its tags.

![The rule cmavo-token](stream/cmavo-token.svg)

## Quotes

These rules are in [this section of the document](../../../grammars/words/stream.md#quotes).

### `quote`

![The rule quote](stream/quote.svg)

### `quoted-word`

The diagram leaves out its tags and emission.

![The rule quoted-word](stream/quoted-word.svg)

### `word-quote-marker`

The diagram leaves out its tags and conditions.

![The rule word-quote-marker](stream/word-quote-marker.svg)

### `single-word-quote`

The diagram leaves out its tags, conditions and emission.

![The rule single-word-quote](stream/single-word-quote.svg)

### `single-marker`

The diagram leaves out its tags and conditions.

![The rule single-marker](stream/single-marker.svg)

### `zoi-y-quote`

The diagram leaves out its tags, conditions and emission.

![The rule zoi-y-quote](stream/zoi-y-quote.svg)

### `zoi-quote`

The diagram leaves out its tags, conditions and emission.

![The rule zoi-quote](stream/zoi-quote.svg)

### `delimiter`

The diagram leaves out its conditions.

![The rule delimiter](stream/delimiter.svg)

### `delimiter-gap`

![The rule delimiter-gap](stream/delimiter-gap.svg)

### `delimiter-hesitations`

![The rule delimiter-hesitations](stream/delimiter-hesitations.svg)

### `delimiter-hesitation`

The diagram leaves out its conditions and emission.

![The rule delimiter-hesitation](stream/delimiter-hesitation.svg)

### `y-key`

The diagram leaves out its tags.

![The rule y-key](stream/y-key.svg)

### `raw-close`

![The rule raw-close](stream/raw-close.svg)

### `raw-run`

The diagram leaves out its conditions.

![The rule raw-run](stream/raw-run.svg)

### `raw-run-parts`

![The rule raw-run-parts](stream/raw-run-parts.svg)

### `matched-close-token`

![The rule matched-close-token](stream/matched-close-token.svg)

### `raw-y-close`

The diagram leaves out its tags and conditions.

![The rule raw-y-close](stream/raw-y-close.svg)

### `raw-y-base`

The diagram leaves out its conditions.

![The rule raw-y-base](stream/raw-y-base.svg)

### `raw-y-key`

The diagram leaves out its tags.

![The rule raw-y-key](stream/raw-y-key.svg)

### `raw-y-letter`

![The rule raw-y-letter](stream/raw-y-letter.svg)

### `zohoi-hesitation`

The diagram leaves out its conditions and emission.

![The rule zohoi-hesitation](stream/zohoi-hesitation.svg)

### `zohoi-hesitations`

![The rule zohoi-hesitations](stream/zohoi-hesitations.svg)

### `body-with-y-close`

The diagram leaves out its tags.

![The rule body-with-y-close](stream/body-with-y-close.svg)

### `empty-zoi-body`

The diagram leaves out its `%opaque`.

![The rule empty-zoi-body](stream/empty-zoi-body.svg)

### `zoi-marker`

The diagram leaves out its tags and conditions.

![The rule zoi-marker](stream/zoi-marker.svg)

### `lohu-quote`

The diagram leaves out its tags.

![The rule lohu-quote](stream/lohu-quote.svg)

### `lohu-marker`

The diagram leaves out its tags, conditions and emission.

![The rule lohu-marker](stream/lohu-marker.svg)

### `lehu-marker`

The diagram leaves out its tags, conditions and emission.

![The rule lehu-marker](stream/lehu-marker.svg)

### `lohu-stream`

![The rule lohu-stream](stream/lohu-stream.svg)

### `lohu-element`

![The rule lohu-element](stream/lohu-element.svg)

### `lohu-word`

The diagram leaves out its conditions and emission.

![The rule lohu-word](stream/lohu-word.svg)

### `quote-gap`

![The rule quote-gap](stream/quote-gap.svg)

### `hesitations`

![The rule hesitations](stream/hesitations.svg)

### `raw-tokens`

The diagram leaves out its `%opaque`.

![The rule raw-tokens](stream/raw-tokens.svg)

### `zohoi-payload`

The diagram leaves out its `%opaque`.

![The rule zohoi-payload](stream/zohoi-payload.svg)

### `any-token`

![The rule any-token](stream/any-token.svg)

### `payload-token`

![The rule payload-token](stream/payload-token.svg)

## Compounds

These rules are in [this section of the document](../../../grammars/words/stream.md#compounds).

### `lerfu-word`

The diagram leaves out its tags and emission.

![The rule lerfu-word](stream/lerfu-word.svg)

### `bu-word`

The diagram leaves out its conditions.

![The rule bu-word](stream/bu-word.svg)

### `zei-compound`

The diagram leaves out its tags and emission.

![The rule zei-compound](stream/zei-compound.svg)

### `zei-word`

The diagram leaves out its conditions.

![The rule zei-word](stream/zei-word.svg)

## Erasure by `si`

These rules are in [this section of the document](../../../grammars/words/stream.md#erasure-by-si).

### `si-erasure`

The diagram leaves out its emission.

![The rule si-erasure](stream/si-erasure.svg)

### `si-word`

The diagram leaves out its conditions.

![The rule si-word](stream/si-word.svg)

## Erasure by `sa` and `su`

These rules are in [this section of the document](../../../grammars/words/stream.md#erasure-by-sa-and-su).

### `sa-erasure`

The diagram leaves out its conditions and emission.

![The rule sa-erasure](stream/sa-erasure.svg)

### `sa-nest`

The diagram leaves out its tags and conditions.

![The rule sa-nest](stream/sa-nest.svg)

### `sa-open`

The diagram leaves out its tags and conditions.

![The rule sa-open](stream/sa-open.svg)

### `sa-key`

The diagram leaves out its tags and conditions.

![The rule sa-key](stream/sa-key.svg)

### `next-word-class`

The diagram leaves out its tags.

![The rule next-word-class](stream/next-word-class.svg)

### `sa-word`

The diagram leaves out its conditions.

![The rule sa-word](stream/sa-word.svg)

### `sa-run`

![The rule sa-run](stream/sa-run.svg)

### `sa-run-twice`

![The rule sa-run-twice](stream/sa-run-twice.svg)

### `sa-wiped`

The diagram leaves out its conditions and emission.

![The rule sa-wiped](stream/sa-wiped.svg)

### `sa-wipe-core`

The diagram leaves out its tags and conditions.

![The rule sa-wipe-core](stream/sa-wipe-core.svg)

### `su-survivor`

The diagram leaves out its tags and conditions.

![The rule su-survivor](stream/su-survivor.svg)

### `su-suffix`

The diagram leaves out its emission.

![The rule su-suffix](stream/su-suffix.svg)

### `su-reach`

![The rule su-reach](stream/su-reach.svg)

### `su-word`

The diagram leaves out its conditions.

![The rule su-word](stream/su-word.svg)
