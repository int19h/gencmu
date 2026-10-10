# The kihei word layer

This layer adds one word to the CLL lexicon. A lexicon gives words their classes. A classifier maps a spelling to those classes.

The [kihei dialect](../dialects/kihei.md) includes this document after the CLL lexicon in the forms stage. Each declaration of `lexicon` adds entries to the same classifier. The new entry gives `ki'ei` the class `KIhEI` without changing any CLL entry.

```jbogenbau
%classifier lexicon
  "ki'ei" ∈ KIhEI
```
