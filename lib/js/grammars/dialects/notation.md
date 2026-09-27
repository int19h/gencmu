# The notation dialect

The dialect in which gencmu reads its own grammar documents. It is an ordinary dialect, run by the same engine as the Lojban ones. So the notation's definition is the same kind of thing as any grammar it defines. The libraries do not read these documents to start: they read the DOM of this dialect from `../notation/bootstrap.json`. A check in every library's tests loads this pipeline with that DOM and compares the result with the bootstrap itself.

The input is the text of a grammar document's `jbogenbau` blocks, joined with a newline between blocks; finding the blocks in the Markdown is the one part of reading a grammar that is not itself a grammar.

## Stage 1: tokens

```jbogenbau
%stage lexical
```

- [The notation's tokens](../notation/lexical.md)
  ```jbogenbau
  %include "../notation/lexical.md"
  ```

The stage receives one token per character and hands on the notation's tokens: names, strings, phoneme tags, captures, guards, directives and symbols, each a run of the characters the author wrote. Spaces and comments are dropped.

## Stage 2: the document

```jbogenbau
%stage syntax
```

- [The notation's syntax](../notation/syntax.md)
  ```jbogenbau
  %include "../notation/syntax.md"
  ```

The stage receives those tokens and builds the tree of rules and directives from which a library reads the grammar.
