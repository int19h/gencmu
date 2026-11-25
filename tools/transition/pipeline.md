# Transition compiler pipeline

The lexical stage reads characters. The syntax stage reads the emitted tokens.

```jbogenbau
%stage lexical
%include "lexical.md"
%stage syntax
%include "syntax.md"
```
