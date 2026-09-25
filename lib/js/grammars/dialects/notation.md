# The notation dialect

The dialect in which gencmu reads its own grammar documents. It is an
ordinary dialect, run by the same engine as the Lojban ones, which is what
makes the notation's definition the same kind of thing as any grammar it
defines. The libraries do not read these documents to start: they read the
DOM of this dialect from `../notation/bootstrap.json`, and a check in every
library's tests reads these documents with it and compares the result with
the bootstrap itself.

The input is the text of a grammar document's `jbogenbau` blocks, joined with a
newline between blocks; finding the blocks in the Markdown is the one part
of reading a grammar that is not itself a grammar.

## Stage 1: tokens <?stage lexical?>

- [The notation's tokens](../notation/lexical.md) <?grammar?>

The stage receives one token per character and hands on the notation's
tokens: names, strings, phoneme tags, captures, guards, directives and
symbols, each a run of the characters the author wrote. Spaces and comments
are dropped.

## Stage 2: the document <?stage syntax?>

- [The notation's syntax](../notation/syntax.md) <?grammar?>

The stage receives those tokens and builds the tree of rules and directives
from which a library reads the grammar.
