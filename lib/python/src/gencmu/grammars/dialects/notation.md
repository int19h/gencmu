# The notation dialect

This is the dialect in which gencmu reads its own grammar documents. A dialect is a pipeline of stages, defined by one pipeline document. A stage is one step of a pipeline, with its own grammar. This dialect is an ordinary one, and the same engine runs it as runs the Lojban ones. So the notation's definition is the same kind of thing as any grammar it defines.

The libraries do not read these documents to start. Instead, they read the DOM of this dialect from `../notation/bootstrap.json`. A DOM holds the parsed rules and directives. A test in every library loads this pipeline with that DOM. The test compares the result with the bootstrap itself.

The input is the text of a grammar document's `jbogenbau` blocks, joined with a newline between blocks. Only one part of the reading of a grammar is not itself a grammar: the step that finds the blocks in the Markdown.

## Stage 1: tokens

```jbogenbau
%stage lexical
```

- [The notation's tokens](../notation/lexical.md)
  ```jbogenbau
  %include "../notation/lexical.md"
  ```

The stage receives one token (a unit of input) per character. It hands on the notation's tokens: names, strings, phoneme tags, spellings, captures, guards, keywords and symbols. Each of these tokens is a run of the characters that the author wrote. The stage drops spaces and comments.

## Stage 2: the document

```jbogenbau
%stage syntax
```

- [The notation's syntax](../notation/syntax.md)
  ```jbogenbau
  %include "../notation/syntax.md"
  ```

The stage receives those tokens. It builds the tree of rules and directives from which a library reads the grammar.
