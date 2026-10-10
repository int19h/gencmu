# The kihei dialect

This dialect adds `ki'ei` to the CLL dialect. A dialect is a sequence of parsing stages. A stage reads the output of the previous stage.

The example keeps the CLL documents and adds two documents. A layer is a document that changes earlier definitions. The [word layer](../words/kihei.md) gives the new word its class. The [syntax layer](../syntax/kihei.md) adds phrases that set a frame for several utterances.

The first stage reads letters as phonemes, the sounds of words. The `cll-cyrillic` feature enables the Cyrillic spelling that CLL describes. A feature is a named switch in a grammar.

```jbogenbau
%features cll-cyrillic
%stage phonemes
```

- [CLL Latin spelling](../phonemes/latin-strict.md)
  ```jbogenbau
  %include "../phonemes/latin-strict.md"
  ```

- [CLL Cyrillic spelling](../phonemes/cyrillic-cll.md)
  ```jbogenbau
  %include "../phonemes/cyrillic-cll.md"
  ```

The forms stage divides those sounds into words. A lexicon gives each word its classes. The new word layer follows the CLL lexicon so that both contribute to the same classifier.

```jbogenbau
%stage forms
```

- [Word division](../words/forms.md)
  ```jbogenbau
  %include "../words/forms.md"
  ```

- [Word shapes](../words/shapes.md)
  ```jbogenbau
  %include "../words/shapes.md"
  ```

- [CLL word forms](../words/cll.md)
  ```jbogenbau
  %include "../words/cll.md"
  ```

- [CLL lexicon](../words/lexicon-cll.md)
  ```jbogenbau
  %include "../words/lexicon-cll.md"
  ```

- [The new word layer](../words/kihei.md)
  ```jbogenbau
  %include "../words/kihei.md"
  ```

The words stage applies quotes, compounds, and erasers. The indicators stage attaches attitude words to their hosts. Both stages use the CLL documents.

```jbogenbau
%stage words
```

- [The word stream](../words/stream.md)
  ```jbogenbau
  %include "../words/stream.md"
  ```

- [The CLL word stream](../words/cll-stream.md)
  ```jbogenbau
  %include "../words/cll-stream.md"
  ```

```jbogenbau
%stage indicators
```

- [CLL indicators](../indicators/cll.md)
  ```jbogenbau
  %include "../indicators/cll.md"
  ```

The syntax stage reads the structure of the text. The new layer follows the CLL grammar so that it can replace the paragraph rule. Every other CLL rule keeps its definition.

```jbogenbau
%stage syntax
```

- [CLL grammar](../syntax/cll.md)
  ```jbogenbau
  %include "../syntax/cll.md"
  ```

- [The new syntax layer](../syntax/kihei.md)
  ```jbogenbau
  %include "../syntax/kihei.md"
  ```

```jbogenbau
%ambiguity-resolution late-elision elision-only
```

The dialect keeps the CLL policy for omitted closing words. `late-elision` prefers a reading that omits a closing word later. `elision-only` rejects remaining ambiguity after the parser restores the chosen closing words. The [CLL dialect](cll-ebnf.md) explains that policy.
