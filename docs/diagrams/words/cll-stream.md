# The CLL word stream: railroad diagrams

These are the rules of [The CLL word stream](../../../grammars/words/cll-stream.md), one diagram for each rule, in the order of the document.

`node tools/sync.js` writes this page and the diagrams from the document, so edit the document instead.

[Railroad diagrams](../../design.md#railroad-diagrams) in the design document explains how to read them.

## Introduction

These rules are in [the introduction of the document](../../../grammars/words/cll-stream.md).

### `cmavo-token`

`%redefine-rule` replaces a rule of an earlier document.

![The rule cmavo-token](cll-stream/cmavo-token.svg)

### `lerfu-word`

`%redefine-rule` replaces a rule of an earlier document. The diagram leaves out its tags, conditions and emission.

![The rule lerfu-word](cll-stream/lerfu-word.svg)
