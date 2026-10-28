# Preparsed grammars

A preparsed grammar stores the notation reader's document output. The loader then joins the stages from these documents. A family is a directory directly under `grammars/`. Each JSON file holds the preparsed grammars of one family. Its name matches that directory, such as `lojban.json` for `grammars/lojban/`.

`gencmu.json` is required. Its jbogenbau grammars supply the notation reader that every grammar load needs. The other files only speed up loading. Without a usable optional file, the loader reads that family's source documents.

From the repository root, `node tools/sync.js` regenerates these files from `grammars/` and resources in `data/`. It also copies both trees into each library.

A fingerprint is a short value computed from resource text. Each file records its format and resource fingerprints. Each document entry records its path, the fingerprint of its source text, and its preparsed grammar.
