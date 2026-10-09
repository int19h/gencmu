# jbogenbau: from characters to tokens: railroad diagrams

These are the rules of [jbogenbau: from characters to tokens](../../../grammars/notation/lexical.md), one diagram for each rule, in the order of the document.

`node tools/sync.js` writes this page and the diagrams from the document, so edit the document instead.

[Railroad diagrams](../../design.md#railroad-diagrams) in the design document explains how to read them.

## The text

These rules are in [this section of the document](../../../grammars/notation/lexical.md#the-text).

### `text`

![The rule text](lexical/text.svg)

### `piece`

![The rule piece](lexical/piece.svg)

## Names and tag literals

These rules are in [this section of the document](../../../grammars/notation/lexical.md#names-and-tag-literals).

### `word`

The diagram leaves out its tags and emission.

![The rule word](lexical/word.svg)

### `tag-literal`

The diagram leaves out its tags and emission.

![The rule tag-literal](lexical/tag-literal.svg)

### `whole-name`

The diagram leaves out its conditions.

![The rule whole-name](lexical/whole-name.svg)

### `name`

![The rule name](lexical/name.svg)

### `lower-name`

![The rule lower-name](lexical/lower-name.svg)

### `upper-name`

![The rule upper-name](lexical/upper-name.svg)

### `name-character`

![The rule name-character](lexical/name-character.svg)

### `letter`

![The rule letter](lexical/letter.svg)

### `digit`

![The rule digit](lexical/digit.svg)

## Strings, character tags, properties and phoneme tags

These rules are in [this section of the document](../../../grammars/notation/lexical.md#strings-character-tags-properties-and-phoneme-tags).

### `string`

The diagram leaves out its tags and emission.

![The rule string](lexical/string.svg)

### `string-part`

The diagram leaves out its conditions.

![The rule string-part](lexical/string-part.svg)

### `character-tag`

The diagram leaves out its tags and emission.

![The rule character-tag](lexical/character-tag.svg)

### `character-tag-first`

The diagram leaves out its conditions.

![The rule character-tag-first](lexical/character-tag-first.svg)

### `character-tag-part`

The diagram leaves out its conditions.

![The rule character-tag-part](lexical/character-tag-part.svg)

### `property`

The diagram leaves out its tags and emission.

![The rule property](lexical/property.svg)

### `phoneme`

The diagram leaves out its tags and emission.

![The rule phoneme](lexical/phoneme.svg)

### `character`

![The rule character](lexical/character.svg)

## Captures, constants, guards and keywords

These rules are in [this section of the document](../../../grammars/notation/lexical.md#captures-constants-guards-and-keywords).

### `capture`

The diagram leaves out its tags, conditions and emission.

![The rule capture](lexical/capture.svg)

### `constant`

The diagram leaves out its tags, conditions and emission.

![The rule constant](lexical/constant.svg)

### `guard`

The diagram leaves out its tags and emission.

![The rule guard](lexical/guard.svg)

### `negation`

The diagram leaves out its conditions and emission.

![The rule negation](lexical/negation.svg)

### `keyword`

The diagram leaves out its tags, conditions and emission.

![The rule keyword](lexical/keyword.svg)

## Symbols

These rules are in [this section of the document](../../../grammars/notation/lexical.md#symbols).

### `symbol`

The diagram leaves out its tags and emission.

![The rule symbol](lexical/symbol.svg)

## Layout

These rules are in [this section of the document](../../../grammars/notation/lexical.md#layout).

### `layout`

![The rule layout](lexical/layout.svg)

### `space`

![The rule space](lexical/space.svg)

### `comment`

![The rule comment](lexical/comment.svg)

### `comment-part`

The diagram leaves out its conditions.

![The rule comment-part](lexical/comment-part.svg)

### `stars`

![The rule stars](lexical/stars.svg)
