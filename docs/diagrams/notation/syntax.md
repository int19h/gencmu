# jbogenbau: from tokens to a grammar: railroad diagrams

These are the rules of [jbogenbau: from tokens to a grammar](../../../grammars/notation/syntax.md), one diagram for each rule, in the order of the document.

`node tools/sync.js` writes this page and the diagrams from the document, so edit the document instead.

[Railroad diagrams](../../design.md#railroad-diagrams) in the design document explains how to read them.

## Documents

These rules are in [this section of the document](../../../grammars/notation/syntax.md#documents).

### `text`

![The rule text](syntax/text.svg)

### `statement`

![The rule statement](syntax/statement.svg)

### `constant-definition`

![The rule constant-definition](syntax/constant-definition.svg)

### `constant-definer`

![The rule constant-definer](syntax/constant-definer.svg)

### `directive`

![The rule directive](syntax/directive.svg)

### `directive-name`

![The rule directive-name](syntax/directive-name.svg)

### `argument-word`

![The rule argument-word](syntax/argument-word.svg)

### `argument-string`

![The rule argument-string](syntax/argument-string.svg)

### `argument-tag`

![The rule argument-tag](syntax/argument-tag.svg)

## Classifiers and implications

These rules are in [this section of the document](../../../grammars/notation/syntax.md#classifiers-and-implications).

### `classifier`

![The rule classifier](syntax/classifier.svg)

### `classifier-name`

![The rule classifier-name](syntax/classifier-name.svg)

### `classifier-entry`

![The rule classifier-entry](syntax/classifier-entry.svg)

### `classifier-key`

![The rule classifier-key](syntax/classifier-key.svg)

### `classifier-operator`

![The rule classifier-operator](syntax/classifier-operator.svg)

### `classifier-class`

![The rule classifier-class](syntax/classifier-class.svg)

### `implication-declaration`

![The rule implication-declaration](syntax/implication-declaration.svg)

## Rules

These rules are in [this section of the document](../../../grammars/notation/syntax.md#rules).

### `rule`

![The rule rule](syntax/rule.svg)

### `definer`

![The rule definer](syntax/definer.svg)

### `rule-flags`

![The rule rule-flags](syntax/rule-flags.svg)

### `rule-flag`

![The rule rule-flag](syntax/rule-flag.svg)

### `rule-name`

![The rule rule-name](syntax/rule-name.svg)

### `body`

![The rule body](syntax/body.svg)

### `alternative`

![The rule alternative](syntax/alternative.svg)

### `guard`

![The rule guard](syntax/guard.svg)

### `alternative-tags`

![The rule alternative-tags](syntax/alternative-tags.svg)

## Expressions

These rules are in [this section of the document](../../../grammars/notation/syntax.md#expressions).

### `conjunction`

![The rule conjunction](syntax/conjunction.svg)

### `sequence`

![The rule sequence](syntax/sequence.svg)

### `primary`

![The rule primary](syntax/primary.svg)

### `tested`

![The rule tested](syntax/tested.svg)

### `test`

![The rule test](syntax/test.svg)

### `test-comparator`

![The rule test-comparator](syntax/test-comparator.svg)

### `test-emptiness`

![The rule test-emptiness](syntax/test-emptiness.svg)

### `test-operand`

![The rule test-operand](syntax/test-operand.svg)

### `reference`

![The rule reference](syntax/reference.svg)

### `tag`

![The rule tag](syntax/tag.svg)

### `character`

![The rule character](syntax/character.svg)

### `phoneme`

![The rule phoneme](syntax/phoneme.svg)

### `range`

![The rule range](syntax/range.svg)

### `property`

![The rule property](syntax/property.svg)

### `capture`

![The rule capture](syntax/capture.svg)

### `group`

![The rule group](syntax/group.svg)

### `optional`

![The rule optional](syntax/optional.svg)

### `repetition`

![The rule repetition](syntax/repetition.svg)

### `choice`

![The rule choice](syntax/choice.svg)

### `empty`

![The rule empty](syntax/empty.svg)

## Clauses

These rules are in [this section of the document](../../../grammars/notation/syntax.md#clauses).

### `tags-clause`

![The rule tags-clause](syntax/tags-clause.svg)

### `conditions-clause`

![The rule conditions-clause](syntax/conditions-clause.svg)

### `emits-clause`

![The rule emits-clause](syntax/emits-clause.svg)

### `opaque-clause`

![The rule opaque-clause](syntax/opaque-clause.svg)

### `emit-item`

![The rule emit-item](syntax/emit-item.svg)

### `emit-before`

![The rule emit-before](syntax/emit-before.svg)

### `emit-after`

![The rule emit-after](syntax/emit-after.svg)

### `emit-target`

![The rule emit-target](syntax/emit-target.svg)

### `emit-tags`

![The rule emit-tags](syntax/emit-tags.svg)

### `implication`

![The rule implication](syntax/implication.svg)

### `any-of`

![The rule any-of](syntax/any-of.svg)

### `all-of`

![The rule all-of](syntax/all-of.svg)

### `condition`

![The rule condition](syntax/condition.svg)

### `comparison`

![The rule comparison](syntax/comparison.svg)

### `comparator`

![The rule comparator](syntax/comparator.svg)

### `negation`

![The rule negation](syntax/negation.svg)

### `presence`

![The rule presence](syntax/presence.svg)

## Terms

These rules are in [this section of the document](../../../grammars/notation/syntax.md#terms).

### `term`

![The rule term](syntax/term.svg)

### `guarded-term`

![The rule guarded-term](syntax/guarded-term.svg)

### `union`

![The rule union](syntax/union.svg)

### `intersection`

![The rule intersection](syntax/intersection.svg)

### `term-atom`

![The rule term-atom](syntax/term-atom.svg)

### `string`

![The rule string](syntax/string.svg)

### `name`

![The rule name](syntax/name.svg)

### `empty-set`

![The rule empty-set](syntax/empty-set.svg)

### `call`

![The rule call](syntax/call.svg)

### `argument`

![The rule argument](syntax/argument.svg)

### `capture-reference`

![The rule capture-reference](syntax/capture-reference.svg)

### `constant-reference`

![The rule constant-reference](syntax/constant-reference.svg)

## Tree patterns

These rules are in [this section of the document](../../../grammars/notation/syntax.md#tree-patterns).

### `tree-comparison`

![The rule tree-comparison](syntax/tree-comparison.svg)

### `tree-comparator`

![The rule tree-comparator](syntax/tree-comparator.svg)

### `pattern-literal`

![The rule pattern-literal](syntax/pattern-literal.svg)

### `pattern-union`

![The rule pattern-union](syntax/pattern-union.svg)

### `pattern-intersection`

![The rule pattern-intersection](syntax/pattern-intersection.svg)

### `pattern-sequence`

![The rule pattern-sequence](syntax/pattern-sequence.svg)

### `pattern-item`

![The rule pattern-item](syntax/pattern-item.svg)

### `pattern-atom`

![The rule pattern-atom](syntax/pattern-atom.svg)

### `pattern-brackets`

![The rule pattern-brackets](syntax/pattern-brackets.svg)

### `pattern-repeat`

![The rule pattern-repeat](syntax/pattern-repeat.svg)

### `pattern-path`

![The rule pattern-path](syntax/pattern-path.svg)
