# The notation dialect

This is the dialect in which gencmu reads its own grammar documents. A dialect is a pipeline of stages, defined by one pipeline document. A stage is one step of a pipeline, with its own grammar. This dialect is an ordinary one, and the same engine runs it as runs the Lojban ones. So the notation's definition is the same kind of thing as any grammar it defines.

The libraries do not read these documents to start. Instead, they read the DOM of this dialect from `../notation/bootstrap.json`. A DOM holds the parsed rules and directives. A test in every library loads this pipeline with that DOM. The test compares the result with the bootstrap itself.

The input is the text of a grammar document's `jbogenbau` blocks, joined with a newline between blocks. Three steps of the reading of a grammar are not grammars, and each library writes them by hand:

- The search for the blocks in the Markdown
- The walk from the parse tree to the grammar objects
- The errors that the grammar of the notation does not find

`../../docs/engine.md` specifies these steps in §8 and §9.

## Stage 1: tokens

```jbogenbau
%stage lexical
```

- [The notation's tokens](../notation/lexical.md)
  ```jbogenbau
  %include "../notation/lexical.md"
  ```

The stage receives one token per character. A token is one unit that a stage reads or emits. The stage hands on the notation's tokens: names, strings, tag literals, phoneme tags, character tags, properties, captures, constants, guards, keywords and symbols. Each of these tokens is a run of the characters that the author wrote. The stage drops spaces and comments.

## Stage 2: the document

```jbogenbau
%stage syntax
```

- [The notation's syntax](../notation/syntax.md)
  ```jbogenbau
  %include "../notation/syntax.md"
  ```

The stage receives those tokens. It builds the tree of rules and directives from which a library reads the grammar.
