# Preparsed grammars

Each JSON file holds parsed grammar documents for one family under `grammars/`. These are document DOMs, not stitched or lowered grammars. The file name matches the family directory, such as `lojban.json` for `grammars/lojban/`.

`gencmu.json` is required. Its jbogenbau entries supply the notation reader that every grammar load needs. The other files only speed up loading. Without a usable optional file, the loader reads that family's source documents.

`node tools/sync.js` regenerates these files from the source grammars. Each file carries its own format and resource fingerprints. A document entry records its path, source text hash, and parsed DOM.
