# Literary text sources

The cases in `../corpus/literary.jsonl` cover texts from lojban.pw and suzypavlis.neocities.org. The collection includes eight short works, eleven song bodies, one journal entry, one story chapter, and one repaired sentence. The longest accepted body is Jordan DeLong's translation of The Book, at 6,022 characters. The cases run with the default automatic features of cll-ebnf and bpfk. The core sample includes 22 of these cases.

`manifest.json` records each source URL, download date, HTML snapshot, extracted text, and transformation. SHA-256 hashes identify the exact downloaded bytes and text inputs. Each variant lists its corpus case identifiers. The grammar commit records the version that produced the current expectations. The audit grammar commit records the parser version from the original survey.

The HTML files preserve the fetched pages without edits. The text files preserve the extracted source before typography cleanup or repairs.

## Extraction and boundaries

For lojban.pw, extraction selects one Lojban column and omits heading and metadata rows from short bodies. The Book uses the Jordan DeLong column. The Tlön sentence uses row 18 of the Lojban column. The manifest records the source rows for each extraction.

For suzypavlis, extraction selects the song body, the Lojban journal column, or one chapter of a story. It omits English translations, hover glosses, introductions, navigation, and footers. It retains small-font paragraph markers because the page displays them as text. The manifest records paragraph indices and the chapter heading where present.

The Great Winged Snake case covers chapter one only. Whole books are not inputs in this collection. The earlier audit tested Alice by chapter and Tlön by section, with smaller topic divisions within its longest section. No complete narrative chunk from those works passed cll-ebnf or bpfk. This collection includes the Tlön quotation repair as a sentence with an original rejection twin.

## Typography and repairs

Original variants preserve the extracted body exactly. Typography variants replace decorative punctuation with spaces and preserve periods, commas, and phonemic apostrophes. They preserve Lojban quotation particles. They preserve foreign quotation bodies. Marked acute vowels become uppercase stress, grave vowels lose their accent, and digits become Lojban number words.

For suzypavlis, smart apostrophes between letters become straight apostrophes. Other smart single quotation marks become spaces.

Three changes beyond typography have separate variants and original rejection twins:

- Thlunrana replaces `bianfu` with `bi'anfu` for BPFK. This is a grammar adaptation, not a proven typo.
- Chapter one of The Great Winged Snake removes `.i` after `ni'o` at ten paragraph boundaries.
- The Tlön sentence restores three missing opening foreign quotation delimiters.

The corpus also records both outcomes for songs that pass BPFK and fail cll-ebnf. A rejection records the first failure position, not a judgment about the author's dialect. The fixtures preserve the source wording apart from the listed transformations. No fixture silently replaces a dialect feature or a deliberate lyrical spelling.

## Maintenance

If a source changes, retain these snapshots until the replacement receives a separate review. If a grammar change alters an expectation, update the case with that grammar change. Keep the words, brackets, rejection stage, and failure position consistent with the corpus format in `../README.md`. The source manifest stores provenance outside the corpus schema. The cases do not use `seeded` or `reason`, because no other parser supplied their initial verdicts.
