# The Zantufa word stream: railroad diagrams

These are the rules of [The Zantufa word stream](../../../grammars/words/zantufa-stream.md), one diagram for each rule, in the order of the document.

`node tools/sync.js` writes this page and the diagrams from the document, so edit the document instead.

[Railroad diagrams](../../design.md#railroad-diagrams) in the design document explains how to read them.

## Introduction

These rules are in [the introduction of the document](../../../grammars/words/zantufa-stream.md).

### `word-quote-marker`

`%redefine-rule` replaces a rule of an earlier document. The diagram leaves out its tags and conditions.

![The rule word-quote-marker](zantufa-stream/word-quote-marker.svg)

### `quote`

`%extend-rule` adds these alternatives to a rule of an earlier document.

![The rule quote](zantufa-stream/quote.svg)

### `rahoi-quote`

The diagram leaves out its tags and emission.

![The rule rahoi-quote](zantufa-stream/rahoi-quote.svg)

### `rahoi-marker`

The diagram leaves out its tags and conditions.

![The rule rahoi-marker](zantufa-stream/rahoi-marker.svg)

### `zoi-marker`

`%redefine-rule` replaces a rule of an earlier document. The diagram leaves out its tags and conditions.

![The rule zoi-marker](zantufa-stream/zoi-marker.svg)

### `hesitation`

`%redefine-rule` replaces a rule of an earlier document. The diagram leaves out its tags, conditions and emission.

![The rule hesitation](zantufa-stream/hesitation.svg)

### `y-letter-ahead`

![The rule y-letter-ahead](zantufa-stream/y-letter-ahead.svg)

### `attached-y`

The diagram leaves out its tags, conditions and emission.

![The rule attached-y](zantufa-stream/attached-y.svg)

### `read-word`

`%extend-rule` adds these alternatives to a rule of an earlier document.

![The rule read-word](zantufa-stream/read-word.svg)

### `word`

`%redefine-rule` replaces a rule of an earlier document. The diagram leaves out its tags, conditions and emission.

![The rule word](zantufa-stream/word.svg)

### `text-opener`

The diagram leaves out its tags, conditions and emission.

![The rule text-opener](zantufa-stream/text-opener.svg)

### `opener-spaces`

The diagram leaves out its emission.

![The rule opener-spaces](zantufa-stream/opener-spaces.svg)

### `opener-space-token`

The diagram leaves out its conditions.

![The rule opener-space-token](zantufa-stream/opener-space-token.svg)

### `payload-token`

`%extend-rule` adds these alternatives to a rule of an earlier document.

![The rule payload-token](zantufa-stream/payload-token.svg)

### `delimiter`

`%extend-rule` adds these alternatives to a rule of an earlier document.

![The rule delimiter](zantufa-stream/delimiter.svg)

### `unit`

`%extend-rule` adds these alternatives to a rule of an earlier document. The diagram leaves out its tags and conditions.

![The rule unit](zantufa-stream/unit.svg)

### `bare-marker-tail`

![The rule bare-marker-tail](zantufa-stream/bare-marker-tail.svg)

### `bare-marker`

The diagram leaves out its conditions.

![The rule bare-marker](zantufa-stream/bare-marker.svg)

### `unit`

`%extend-rule` adds these alternatives to a rule of an earlier document. The diagram leaves out its tags and emission.

![The rule unit](zantufa-stream/unit.2.svg)

### `su-letter-base`

The diagram leaves out its conditions.

![The rule su-letter-base](zantufa-stream/su-letter-base.svg)

### `su-letter-tail`

![The rule su-letter-tail](zantufa-stream/su-letter-tail.svg)

### `su-word`

`%redefine-rule` replaces a rule of an earlier document. The diagram leaves out its conditions.

![The rule su-word](zantufa-stream/su-word.svg)
