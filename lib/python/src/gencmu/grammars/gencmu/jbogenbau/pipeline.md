# The notation pipeline

The notation dialect lets gencmu read its own grammar documents. A dialect is a pipeline of stages, defined by one pipeline document. A stage is one step of a pipeline, with its own grammar. This dialect is an ordinary one, and the same engine runs it as runs the Lojban ones. So the notation's definition is the same kind of thing as any grammar it defines.

The libraries start by splicing this pipeline's document DOMs from `../../../data/preparsed/gencmu.json`. A DOM holds parsed rules and directives. Each library reads these documents through that reader. The result must reproduce the preparsed entries.

The input is the text of a grammar document's `jbogenbau` blocks, joined with a newline between blocks. Three steps of the reading of a grammar are not grammars, and each library writes them by hand:

- The search for the blocks in the Markdown
- The walk from the parse tree to the grammar objects
- The errors that the grammar of the notation does not find

`../../../docs/engine.md` specifies these steps in §8 and §9.

## Stage 1: lexical

```jbogenbau
%stage lexical
```

- [The notation's tokens](lexical.md)
  ```jbogenbau
  %include "lexical.md"
  ```

Stage zero applies Unicode Normalization Form D (NFD). The lexical stage receives one token per decomposed scalar, with that scalar as its value and image. A token is one unit that a stage reads or emits. The stage hands on the notation's tokens: names, strings, captures, constants, guards, keywords, and punctuation. Each of these tokens covers a run of decomposed scalars from the document. The stage drops spaces and comments.

## Stage 2: syntax

```jbogenbau
%stage syntax
```

- [The notation's syntax](syntax.md)
  ```jbogenbau
  %include "syntax.md"
  ```

The stage receives those tokens. It builds the tree of rules and directives from which a library reads the grammar. The stage recognizes methods, captures, and repeated tests before reader validation. The bootstrap and grammar DOMs use format 40.
