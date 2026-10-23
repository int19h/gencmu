# The gencmu engine

This document is the specification that every gencmu library implements. It says what a result is, not how to compute it. It says how only where the only reasonable way to compute a result is part of what the result is. Where two implementations can differ, this document says which one is right.

The cases in `tests/engine/` and `tests/notation/` are part of the specification unless they load a bundled pipeline. A case that loads a bundled pipeline tests that pipeline's documents, not this specification. An implementation that disagrees with a case violates this specification or the pipeline's documents.

`docs/notation.md` explains the notation to grammar authors, and `grammars/notation/` defines it. `docs/output.md` defines the result's JSON and the renderings.

Grammar identifiers and tags in examples illustrate generic rules. They impose no dialect contract.

## 1. Tokens

A pipeline runs grammar stages in sequence (§13). A stage is one step with its own grammar. A token is one unit of input or output. Everything a stage reads and writes is a sequence of tokens. A token has these fields:

- `tags` is a set of tags, each a string.
- `span` is the half-open range of the previous stage's tokens that the token covers. A half-open range includes its start and excludes its end.
- `source` is the half-open range of the original text that the token covers, in Unicode code points.
- `text` is the original text over `source`.
- `value` is the stored string that exact comparisons read (§5).
- `image` is what the token shows to people (§5).
- `insertedBy` names the rule that inserts an `ε` emission item (§11). Other tokens lack it, including covering items over empty constituents.
- `before` and `after` are the token's attachments (§11). These are two lists of tokens that belong to the token and that no later stage reads. Both are empty unless an emission gives the token attachments. An attached token has no `span`.

The check of §7 adds synthetic tokens to a copy of a stage's input. They are not tokens of any stage, and no output shows them. A token that a stage reads is an original token for §7, whatever its span, source, text or `insertedBy` (§7.2).

The source of one token or more runs from the least source start among them to the greatest source end. An empty source counts as the point where it lies. Tokens usually lie in the order of their sources. Then this source runs from the source start of the first token to the source end of the last token.

Tokens need not follow the order of their sources. An emission lists its captures in the order in which they stand (§9, §11). But an inserted token can have its source before the token ahead of it, or after the token behind it. So can a token over a part that read nothing. An empty span of tokens has no such source: its source is given where it is used (§11, §12).

A tag is a named identifier mark. User tags start with an uppercase ASCII letter, followed by ASCII letters, digits, hyphens, or underscores. A reserved engine tag starts with `_`. `_` alone is a wildcard terminal and not a tag. Every tag compares by its exact identifier spelling.

- A user class starts and ends with a capital and never starts with `_`, such as `KOhA`.
- A user mark is a tag such as `Stressed`, `Syllable-Break`, or `Word`.
- An engine tag is a stored property such as `_Lu`, `_L`, or `_White_Space`.

A string terminal's identity is its resolved string. A literal, escaped literal, and equal user constant therefore identify one terminal.

Canonical string diagnostics write one quoted string with `‹…›` escapes. Escapes represent quotes, controls, format scalars, nonspacing marks, private-use scalars, and the escape opener. They also represent Hangul syllables, scalars with a `decompose` record, and scalars of nonzero combining class. §9 specifies one diagnostic spelling. Tags retain their identifier spelling without string escaping.

A format scalar has general category Cf in the configured table.

A control scalar lies in two fixed ranges. These are U+0000 to U+001F and U+007F to U+009F.

A private-use scalar lies in three fixed ranges. These are U+E000 to U+F8FF, U+F0000 to U+FFFFD, and U+100000 to U+10FFFD. Neither predicate depends on the configured Unicode table.

A nonspacing mark has general category Mn in the configured Unicode table. Scalars with a `decompose` record, Hangul syllables and scalars of nonzero combining class also require escaping. Stage zero changes each of them in a grammar document. Other marks need no escaping. An unlisted scalar has category Cn and is not a nonspacing mark.

U+0301 can appear as `"‹U+0301›"`, and U+ED80 as `"‹U+ED80›"`. A quotation mark uses `"‹U+0022›"`. Escapes contribute exact scalars after source decomposition.

Stage zero is named `input`. It first decomposes the text into its canonical decomposition, Unicode Normalization Form D, with the configured Unicode table. Each scalar c at position i becomes its decomposition. That is the table's `decompose` record for c, the jamo of a Hangul syllable, or c itself. Each resulting scalar has origin i. Then each maximal run of scalars whose combining class is not 0 is sorted by combining class.

The sort is stable, and every scalar keeps its origin. Stage zero supplies one token for each scalar dₖ of the result, at index k. Its `span` is `[k,k+1)`. Its `source` is `[i,i+1)`, where i is the origin of dₖ. Its `text` is the original text over its source. Its `value` and `image` are dₖ.

Its stored tags are the complete scalar profile of dₖ, as defined below. This profile includes all available property memberships, without depending on grammar references. Stage zero is implicit and adds no executed grammar-stage result.

In the bundled Unicode table, ASCII digits, `#`, and `*` have Emoji_Component. Their stage-zero tokens therefore carry `_Emoji_Component`. U+200D, U+20E3, and U+FE0F also carry it. Ordinary inheritance can forward these stored tags.

Decomposition is canonical only. It applies no compatibility decomposition and no case mapping, and it never composes. Sources, texts, line and column numbers, `.source-text` and `.verbatim-text` read the original text. One precomposed scalar can give several tokens with one source. Canonical reordering can put sources out of order.

A text is a sequence of Unicode scalar values. A text that is not one is a usage error (§13), and the engine refuses it before it makes any character token. In JavaScript and Python, such a text is a string with a lone surrogate. In Go, it is a string that is not valid UTF-8. A Rust string is always valid. The same holds for a grammar document that the caller supplies as a string.

A library reads a grammar document from disk as strict UTF-8. Bytes that are not valid UTF-8 are a `grammar` error of loading, not a usage error, because the caller supplied no string. The error names the document and says that its bytes do not decode. It has no line and no column. The library finds this before it hashes the document or looks in `compiled.json` (§8). A byte order mark stays in the text as the character U+FEFF.

`tools/unicode-table.py` generates `grammars/unicode.txt` from one version of the Unicode Character Database. Every library uses this file, not the Unicode data of its platform, so that the four libraries agree on every character. The file holds one entry on each line, with code points in hexadecimal:

- `unicode 15.1.0` gives the version of the data.
- `category Lu 0041 005A` gives a range of code points whose General_Category is `Lu`. The category is in its short form.
- `white-space 0009 000D` gives a range of code points that have the White_Space property.
- `emoji-presentation 1F193 1F19A` gives a range with `Emoji_Presentation=Yes`.
- `emoji-component 1F1E6 1F1FF` gives a range with `Emoji_Component=Yes`.
- `decompose 00E1 0061 0301` gives the full canonical decomposition of one scalar, in canonical order. Every scalar whose decomposition differs from itself has one record, except the Hangul syllables.
- `abbreviation 000A LF` supplies one abbreviation alias for canonical string printing.
- `combining 230 0300 0314` gives a range of code points whose Canonical_Combining_Class is the number, from 1 to 254. A code point in no range has class 0.

The Hangul syllables U+AC00 to U+D7A3 decompose by the arithmetic of the Unicode Standard, section 3.12, and the table lists none of them. The table has no compatibility decompositions, no composition data and no case data.

In the bundled file, each `category` range is a longest run of one category. Together these ranges hold every Unicode scalar value once. `Cn`, the unassigned code points, has its ranges too.

LF (U+000A) ends a line. The final line can end at the end of the file. The reader removes one CR (U+000D) immediately before LF. A final CR without LF stays in its field.

Fields are separated only by runs of spaces (U+0020) or tabs (U+0009). Leading and trailing spaces or tabs do not make fields. Every other character, including a byte order mark (U+FEFF), stays inside its field.

Blank lines are ignored. An unknown entry name or a malformed record is a grammar error. Each record requires the fields shown above, with one or more decomposition scalars for `decompose`.

Code point fields contain hexadecimal digits and range from U+0000 to U+10FFFF. A range must not be reversed. Decomposition records contain only scalar values. A combining class contains decimal digits and lies between 1 and 254.

Any number of leading zeros is allowed in a number field. After these zeros, a code point has at most six hexadecimal digits. A combining class has at most three decimal digits. The value bounds above still apply.

The records can stand in any order in a file. Each library sorts them when it loads the file, so their order never changes an answer.

An `abbreviation` record has one scalar and one alias matching `[A-Z][A-Z0-9]*`. A scalar can have several aliases. Repeated records or an alias assigned to different scalars are grammar loading errors. These records supply neither tags nor property memberships.

The generator copies all 354 abbreviation aliases from pinned NameAliases.txt into the core table. Printing uses only this always-loaded map, with no names-file lookup. A custom core replaces this map without fallback. Without an abbreviation for a scalar, the printer uses its numeric escape.

Core abbreviation escapes also decode through this map, without names data. Other source name escapes use the separate names file. This priority keeps canonical spelling readable through the ordinary reader.

A caller can supply `unicode.txt` through the API. It replaces all bundled core data, including White_Space, Emoji_Presentation, Emoji_Component, and abbreviations, with no fallback. The table must list the whitespace used by its grammar documents. It must give `Emoji_Presentation` to every emoji name that those documents use. Those names must also lack `Emoji_Component`.

The table need not cover every scalar. An unlisted core scalar gets Cn and lacks White_Space, Emoji_Presentation, and Emoji_Component. For companion properties, explicit assignments and declared defaults still apply to that scalar. No table supplies comparison normalization.

A table without `decompose` records decomposes only Hangul syllables, and one without `combining` records reorders nothing. The bundled notation needs the `decompose` records of U+2260, U+2209, U+2288 and U+2247.

`Cs` belongs only to surrogates U+D800 to U+DFFF, which the table never lists. A surrogate is not a scalar and cannot become a stage-zero token. `_Cs` is a valid stored-tag name but stage zero never assigns it.

A tag set is a set of tags. A tag has no strength: a set holds it or not. The union holds every tag of either set. The intersection holds their shared tags. The difference holds the first set's tags that the second lacks.

A range, `"a".."z"`, reads an ordinary token with one scalar value inside its inclusive endpoints. Endpoints are string literals or constants that resolve to one scalar. Surrogates are excluded, so `"‹U+D7FF›".."‹U+E000›"` has two possible values. A reversed range is a document error. Ranges cannot be tag sets or condition operands.

Engine property names correspond to the configured Unicode table. A general category uses its short form with `_`, such as `_Lu`. A major category groups the general categories sharing its letter. These are the general and major names:

- `_L`: `_Lu`, `_Ll`, `_Lt`, `_Lm` and `_Lo`
- `_M`: `_Mn`, `_Mc` and `_Me`
- `_N`: `_Nd`, `_Nl` and `_No`
- `_P`: `_Pc`, `_Pd`, `_Ps`, `_Pe`, `_Pi`, `_Pf` and `_Po`
- `_S`: `_Sm`, `_Sc`, `_Sk` and `_So`
- `_Z`: `_Zs`, `_Zl` and `_Zp`
- `_C`: `_Cc`, `_Cf`, `_Cs`, `_Co` and `_Cn`

The core binary names are `_White_Space`, `_Emoji_Presentation`, and `_Emoji_Component`. Their stored membership comes from the corresponding core property ranges. The property inventory below adds qualified value tags and further binary tags.

`_` matches any token at any stage, including every stage-zero character. It requires no stored universal tag. A missing category record assigns `_Cn` and `_C`. Later stages never derive these tags from values or images.

Emoji properties use the same pinned Unicode version as categories and decomposition. A missing emoji record grants no membership. These properties add no case mapping.

The engine inventory is closed to the categories above and the properties below. `_lu` and `_Letter` are document errors. Engine tags are ordinary stored membership after stage zero. A grammar can read, inherit, forward, or filter them, but never introduce one. An empty value or a capitalized image does not imply an engine tag.

### Unicode property inventory

A binary property assigns Yes or No. An enumerated property gives each scalar one named value. A multi-valued property assigns a set of values. Catalog properties, such as Script, follow the enumerated rules.

The inventory uses Unicode 15.1.0. It includes 56 binary properties, 25 enumerated or catalog properties, and Script_Extensions. General_Category retains its compact tags above. Canonical_Combining_Class also supplies tags, through the same map that orders combining marks.

These are the included binary properties:

| Group | Long property names |
| --- | --- |
| Letters and case | Alphabetic, Cased, Case_Ignorable, Lowercase, Uppercase |
| Case changes | Changes_When_Casefolded, Changes_When_Casemapped, Changes_When_Lowercased, Changes_When_Titlecased, Changes_When_Uppercased, Changes_When_NFKC_Casefolded |
| Identifiers | ID_Start, ID_Continue, XID_Start, XID_Continue, ID_Compat_Math_Start, ID_Compat_Math_Continue |
| Ideographs | Ideographic, Unified_Ideograph, Radical, IDS_Binary_Operator, IDS_Trinary_Operator, IDS_Unary_Operator |
| Marks and graphemes | Diacritic, Extender, Grapheme_Base, Grapheme_Extend, Prepended_Concatenation_Mark, Variation_Selector |
| Punctuation and numbers | Dash, Quotation_Mark, Terminal_Punctuation, Sentence_Terminal, Hex_Digit, ASCII_Hex_Digit, Math |
| Layout and syntax | White_Space, Pattern_White_Space, Pattern_Syntax, Bidi_Control, Bidi_Mirrored, Join_Control, Logical_Order_Exception, Soft_Dotted |
| Status and normalization | Default_Ignorable_Code_Point, Noncharacter_Code_Point, Deprecated, Composition_Exclusion, Full_Composition_Exclusion |
| Emoji | Emoji, Emoji_Presentation, Emoji_Modifier, Emoji_Modifier_Base, Emoji_Component, Extended_Pictographic, Regional_Indicator |

These are the included enumerated and catalog properties:

| Group | Long property names |
| --- | --- |
| Core classifications | General_Category, Canonical_Combining_Class |
| Catalogs | Script, Block, Age |
| Layout | Bidi_Class, Bidi_Paired_Bracket_Type, East_Asian_Width, Vertical_Orientation |
| Breaking | Line_Break, Word_Break, Grapheme_Cluster_Break, Sentence_Break |
| Joining and syllables | Joining_Type, Joining_Group, Hangul_Syllable_Type, Indic_Conjunct_Break, Indic_Positional_Category, Indic_Syllabic_Category |
| Decomposition and numbers | Decomposition_Type, Numeric_Type |
| Normalization tests | NFC_Quick_Check, NFD_Quick_Check, NFKC_Quick_Check, NFKD_Quick_Check |

All four Quick_Check properties use value tags, including the two with only Yes and No. They describe individual scalars, not normalization of whole strings. Break classes likewise supply character classifications, not segmentation boundaries. The grammar supplies any segmentation algorithm.

Script_Extensions is the included multi-valued property. Each member supplies a separate tag. In the UCD, an explicit extension set replaces the default singleton Script value. U+30FC therefore has Script Common and extension members Hiragana and Katakana, without extension member Common. A Latin letter has extension member Latin through the UCD default.

The following groups supply no engine tags:

| Excluded group | Reason |
| --- | --- |
| Other_Alphabetic, Other_Default_Ignorable_Code_Point, Other_Grapheme_Extend, Other_ID_Continue, Other_ID_Start, Other_Lowercase, Other_Math, Other_Uppercase | These contributory properties contain derivation exceptions rather than complete classifications. |
| Grapheme_Link, Hyphen, Expands_On_NFC, Expands_On_NFD, Expands_On_NFKC, Expands_On_NFKD | Unicode deprecates these properties. The distinct Deprecated classification remains included. |
| String mappings and miscellaneous scalar mappings | Names, case mappings, paired characters, and decomposition mappings return data rather than classification memberships. |
| Numeric_Value and Unihan numeric properties | Rational values need numeric operations rather than named classes. Numeric_Type remains included. |
| Other Unihan data and source records | Readings, dictionary data, and source mappings fall outside scalar classifications. |
| Whole-string properties and named sequences | One scalar token cannot represent a sequence property, such as an RGI emoji sequence. |
| Security properties outside the UCD | UTS #39 requires a separate inventory and version decision. |

The names file supplies string escapes, without supplying tags. Core decomposition records still supply NFD. Even if stage-zero decomposition makes some values unreachable, their normalization property names remain valid.

### Property tag spelling

A binary tag is `_` followed by its long property name, such as `_Alphabetic`. Only Yes supplies membership. There is no No tag. A test such as `_<¬_Alphabetic>` tests absence from stored tags.

Other properties use `_PROPERTY_VALUE`, with the long property and value names. Examples are `_Script_Latin`, `_Bidi_Class_Right_To_Left`, `_East_Asian_Width_Wide`, and `_Script_Extensions_Hiragana`. The general-category tags above are the only compact exception. `_General_Category_Uppercase_Letter`, `_Uppercase_Letter`, and `_LC` are not additional spellings.

The long names come from pinned [PropertyAliases.txt](https://www.unicode.org/Public/15.1.0/ucd/PropertyAliases.txt) and [PropertyValueAliases.txt](https://www.unicode.org/Public/15.1.0/ucd/PropertyValueAliases.txt). Some long values contain short letters, such as `_Grapheme_Cluster_Break_L`. Age uses its long names, such as `_Age_V15_1` and `_Age_Unassigned`. Block uses aliases such as `_Block_Latin_1_Supplement`, rather than the spaced spelling in Blocks.txt.

If a class has a value alias, Canonical_Combining_Class uses its long value, such as `_Canonical_Combining_Class_Above` or `_Canonical_Combining_Class_Not_Reordered`. Other classes use their decimal number without leading zeros. Classes range from 0 through 254. Thus class 2 uses `_Canonical_Combining_Class_2`, class 10 uses `_Canonical_Combining_Class_CCC10`, and class 230 uses `_Canonical_Combining_Class_Above`. Decimal alternatives for aliased classes are invalid.

Each spelling identifies exactly one tag. The generator constructs the complete registry and rejects collisions between properties, values, and compact category tags. A library resolves a complete token through that registry. It never guesses a property boundary from an underscore. If a Unicode update introduces a collision, generation fails. The specification must assign a distinct spelling before that update is supported.

Each library embeds the generated Unicode 15.1 property catalog, including property kinds and long value names. The portable JavaScript library embeds this catalog too. Custom files use it for name and type inspection, without receiving bundled membership assignments. Runtime host data never supplies catalog entries.

Names compare exactly. Short aliases, different case, double separators, and punctuation substitutions are document errors at the tag. For example, `_Alpha`, `_Script_Latn`, `_sc_Latn`, `_Script__Latin`, `_Bidi_Class_L`, `_lu`, and `_Letter` are invalid. `_Sc` remains the currency-symbol category.

If the configured table lacks a known property or value, its tag is a document error at that reference. This rule covers negative tests, pattern constants, supplied DOMs, disabled alternatives, and replaced definitions. For a declared value without scalar assignments, no scalar receives its tag from that table. The terminal remains valid and can match a trusted caller token. It cannot become a constant-failure predicate. If a supplied token tag has invalid spelling or unavailable support, the API reports a usage error.

### Stored scalar profiles

A scalar profile stores one scalar's initial engine tags. A profile never changes. Stage zero assigns each decomposed scalar its complete profile from the configured tables. Membership never depends on which tags a grammar names, its feature gates, or the selected stages. This rule applies while reading grammar documents too.

Every included and available binary property contributes its Yes tag. Every included and available enumerated property contributes its value tag. Script_Extensions contributes every member tag. Compact category tags and their major groups remain present.

Libraries can share profiles across repeated scalars and equal profiles. They must keep table identities separate. Profile construction can wait until first use, but every observation sees the complete logical set from token creation. Filtering or extending one token's tags never mutates another token's profile.

Later stages read stored sets, without deriving properties from value, image, text, or source. A changed value grants no new property tag. A filter can remove every tag of an enumerated property. A union can retain several values of that property. Neither operation reclassifies the resulting token.

If a filter removes `_L` and keeps `_Lu`, that removal does not restore `_L`. If a filter removes an extension member, a retained Script tag does not restore that member. Even without explicit grammar references, serialization lists every retained property tag. Shared storage cannot hide tags from equality, intersections, forwarding, or output.

### Pinned properties file

`tools/unicode-table.py` generates `grammars/unicode-properties.txt` from the pinned UCD. The bundled version is 15.1.0. Libraries read that file rather than host Unicode data. Character names remain in their separate, lazily loaded file.

General_Category, Canonical_Combining_Class, White_Space, Emoji_Presentation, and Emoji_Component belong only to `unicode.txt`. The properties file cannot redeclare them. Their core records imply support, including the existing defaults in partial core tables. Combining-class tags use the same numeric map as canonical ordering, without a second assignment table.

The properties file declares the other supported properties and their value domains. Its first nonblank line is `unicode-properties VERSION`. VERSION has three decimal components and must exactly match the core table's declared version. A properties file requires exactly one version header in each file. The catalog of accepted names and types is the pinned inventory above.

```text
unicode-properties 15.1.0
binary Alphabetic
enumerated Script Unknown
value Script Unknown
value Script Latin
multiple Script_Extensions Unknown
value Script_Extensions Unknown
value Script_Extensions Hiragana
value Script_Extensions Katakana
range Alphabetic 0041 005A
range Script 0041 005A Latin
range Script_Extensions 30FC 30FC Hiragana Katakana
```

`binary PROPERTY` declares a binary property, with No outside its ranges. `enumerated PROPERTY DEFAULT` declares an enumerated property and its default value. `multiple PROPERTY DEFAULT...` declares Script_Extensions and its nonempty default set. Each property has exactly one declaration.

`value PROPERTY VALUE` declares an available long value name. Every default and range value requires that declaration. Binary properties accept no value declarations. Enumerated and multiple properties can declare values with no assigned scalars. Script_Extensions uses Script's value names but does not require Script itself to be available.

`range PROPERTY FIRST LAST` assigns Yes for a binary property. Other range records append one value for an enumerated property or a nonempty complete set for Script_Extensions. Endpoints are inclusive. An explicit range replaces the declared default at its scalars. Script_Extensions sets replace rather than extend the default set.

Outside ranges, each property uses its declared default. Duplicate members within a set are malformed. Set order has no meaning. Equal overlapping assignments can merge. Conflicting enumerated values or extension sets at one scalar are grammar errors. Repeated binary ranges denote their union.

The file is strict UTF-8. Line endings, blank lines, field separators, and number spellings follow `unicode.txt`. Every range contains only scalars and excludes surrogates. Records after the header can appear in any order. Unknown records, duplicate declarations, undeclared properties, invalid types, unavailable values, and malformed fields are grammar errors.

Property and value names must belong to the pinned catalog. Custom files cannot invent properties or tag aliases. For a supported property, the bundled file declares every catalog value, including unused values. Core combining classes without symbolic aliases use the decimal spellings defined above.

The generator reads the pinned UCD files, including PropertyAliases.txt and PropertyValueAliases.txt. Binary sources include PropList.txt, DerivedCoreProperties.txt, emoji/emoji-data.txt, CompositionExclusions.txt, and DerivedNormalizationProps.txt. That last file supplies the binary properties Full_Composition_Exclusion and Changes_When_NFKC_Casefolded. Bidi_Mirrored comes from extracted/DerivedBinaryProperties.txt.

Enumerated sources include Scripts.txt, Blocks.txt, DerivedAge.txt, BidiBrackets.txt, HangulSyllableType.txt, IndicPositionalCategory.txt, IndicSyllabicCategory.txt, and VerticalOrientation.txt. Break data comes from GraphemeBreakProperty.txt, WordBreakProperty.txt, and SentenceBreakProperty.txt under `auxiliary/`, plus LineBreak.txt under the UCD root.

The generator uses DerivedBidiClass.txt, DerivedEastAsianWidth.txt, DerivedJoiningType.txt, DerivedJoiningGroup.txt, DerivedDecompositionType.txt, DerivedNumericType.txt, DerivedGeneralCategory.txt, and DerivedCombiningClass.txt under `extracted/`. DerivedCoreProperties.txt supplies Indic_Conjunct_Break. DerivedNormalizationProps.txt supplies the four Quick_Check properties. UnicodeData.txt supplies the canonical decomposition mappings used by the core table.

The generator resolves every applicable `@missing` default before it compresses ranges. It follows [UAX #44](https://www.unicode.org/reports/tr44/tr44-32.html#Missing_Values). Later, more specific UCD defaults override earlier general defaults. Explicit assignments override those defaults. This includes nondefault values in unassigned bidi and East_Asian_Width regions. Omitted scalar rows never imply a generic default without those rules.

ScriptExtensions.txt supplies explicit sets. For other scalars, the generator materializes the singleton Script value before range compression. Libraries never infer extension membership from stored Script tags. Thus custom tables can supply Script_Extensions independently. The generated file has sorted, disjoint, maximal ranges for each effective assignment that differs from its declared default.

The generator and the shared data audit compare all 1,112,064 scalars with the pinned sources. They include range boundaries and neighboring scalars. Independent expected digests cover each property's complete assignments, including defaults and extension sets. Host Unicode APIs never provide expected memberships.

Each property digest uses 64-bit FNV-1a over ASCII records in increasing scalar order. A record has six uppercase hexadecimal digits, a colon, sorted canonical tag names separated by commas, and LF. Binary No contributes an empty tag list. General_Category includes its compact atomic and major tags. The digest uses 16 lowercase hexadecimal digits, like the file fingerprints of §8.

A supplied `unicode-properties.txt` replaces the bundled properties file entirely. Omitted properties and values receive no bundled fallback. A custom core table without a companion file supports only its five core properties. A properties file without an overridden core uses the bundled core and must match its version.

Without either override, a library loads the bundled properties file with the core table. A missing bundled file is a grammar loading error. Even without an additional property reference, the loader reads and inspects every present properties file. An invalid or mismatched file names `unicode-properties.txt`. If the line is known, the error includes it.

Custom subsets are valid. A declared binary property without ranges is supported and false everywhere. An omitted declaration makes the property unavailable, rather than false. Naming an unavailable property is a load error at the reference, including in otherwise unused source. A supplied DOM receives the same inspection.

The playground fetches the pinned properties file at startup, before it loads any dialect. The browser grammar bundle excludes that file. A failed fetch prevents dialect loading and reports the missing resource. The portable JavaScript API receives the file through its source map.

### Property conformance and performance

Shared cases in `tests/engine/` and `tests/notation/` cover the following observations. Listed tags are required memberships, rather than complete output arrays. Expected arrays include every retained tag exactly once in code-point order. The four libraries use identical data and expected values.

| Case | Required observation |
| --- | --- |
| Exact names | `_Alphabetic`, `_Script_Latin`, `_Script_Extensions_Greek`, `_Age_V15_1`, and `_Sc` are valid names. Short aliases, wrong case, unknown values, and excluded properties are errors. |
| Empty selectors | No bundled scalar receives Script Katakana_Or_Hiragana or Word_Break E_Base. Their terminals still match trusted caller tokens carrying those tags. |
| Accents and reordering | `é` and decomposed equivalents produce profiles for `e` and U+0301. Lowercase belongs to `e`, and Diacritic belongs to U+0301. Reordered marks retain their profiles and source origins. |
| Exact escaped scalars | An escaped precomposed grammar literal remains exact. Input decomposition still classifies its resulting scalars, independently of that literal. |
| Hangul | `한` produces leading, vowel, and trailing jamo profiles. U+1100 has `_Lo`, `_L`, `_Hangul_Syllable_Type_Leading_Jamo`, and `_Grapheme_Cluster_Break_L`. |
| Emoji | ASCII digits, `#`, and `*` have Emoji and Emoji_Component. U+200D, U+20E3, and U+FE0F retain their Emoji_Component membership. |
| Defaults | U+0378 has Script Unknown, Line_Break Unknown, and Bidi_Class Left_To_Right. U+0590 has Bidi_Class Right_To_Left. Unassigned U+3FFFD has East_Asian_Width Wide. |
| Extension sets | U+30FC has Script Common and extensions Hiragana and Katakana, without extension Common. Latin letters use singleton Latin. U+0951 has Script Inherited and all 13 explicit extension members, including Latin. |
| Distinct classifications | U+00A0 has White_Space without Pattern_White_Space. U+200E reverses those memberships. U+00B4 has Diacritic and `_Sk`, without `_Mn`. ASCII A has East_Asian_Width Narrow. |
| Core and normalization | Combining-class tags agree with canonical ordering. Quick_Check defaults and Maybe values match pinned data. Hangul syllable classes do not reappear after decomposition. |
| Scalar limits | Supplementary scalars, private-use scalars, and noncharacters receive complete profiles. Surrogates remain rejected input. |
| Generic observations | A grammar naming no additional property still forwards and serializes complete profiles. Adding an unrelated later-stage property reference changes no initial tag set. Whole-set comparisons include unnamed properties. |
| Inheritance and mutation | Forwarding, filtering, unions, changed values, and shared repeated characters preserve stored membership. A removed tag never reappears. One token's filter cannot change another token. |
| Provenance | Bare property introduction, tag-set constants, implications, classifier assignment, omission markers, and boundary targets remain forbidden. Filtering forwarded tags is valid. Pattern terminals and pattern tests can read properties. |
| Caller tokens | Empty caller tags stay empty. A supplied canonical property tag matches despite a different token value. Aliases and unavailable property tags cause usage errors. |
| Conditional features | A condition over `_Script_Cyrillic ⊆ $.tags` reads retained memberships. Feature gates and replaced definitions do not change initial profiles or excuse invalid references. |
| Custom resources | Missing support differs from declared-empty support. Shuffled records, equal overlaps, conflicting assignments, invalid headers, unknown records, undeclared values, and version mismatches follow the file rules. |
| Independent tables | Alternating custom tables over one scalar, concurrent reads, cache hits, and profile eviction preserve each table's answers. |
| Diagnostics and caches | Expected-terminal lists and supplied DOMs use canonical names. A properties-file change invalidates dependent caches. Missing or malformed bundled data fails even without an explicit property reference. |

Shared cases also exercise property terminals, tag tests, patterns, conditions, filters, and canonical output for every declared value. A value without scalar assignments receives both a stage-zero rejection case and a positive caller-token case. Corpus comparisons record every changed outcome caused by complete initial tag sets.

Complete profiles must not make dialects naming no additional property meaningfully slower. Shared storage must preserve every logical membership and every observation of the full set. The [performance gate](../tests/README.md#unicode-property-performance-gate) defines measurements, limits, and baseline comparisons. That gate cannot pass through omitted tags or different parse work.

### Unicode names for string escapes

`tools/unicode-table.py` also generates `grammars/unicode-names.txt` from the same pinned Unicode version. The bundled version is 15.1.0. This file supplies names and aliases for string escapes. It supplies no stage-zero property tags. Libraries never use host Unicode data for name lookup.

The generator uses the pinned [Unicode name rules](https://www.unicode.org/reports/tr44/tr44-32.html) and [NameAliases.txt](https://www.unicode.org/Public/15.1.0/ucd/NameAliases.txt). It takes algorithmic ranges from [DerivedName.txt](https://www.unicode.org/Public/15.1.0/ucd/extracted/DerivedName.txt). An algorithmic name follows a scalar-based naming rule. The file stores those rules and ranges rather than one name per scalar.

The names file is strict UTF-8. Its first nonblank line is `unicode-names VERSION`, with the version from `unicode.txt`. VERSION has three decimal components separated by dots. The version strings must match exactly. Remaining records have these forms:

```text
unicode-names 15.1.0
name 0301 COMBINING ACUTE ACCENT
alias abbreviation 200D ZWJ
alias control 000A LINE FEED
algorithm hex 3400 4DBF CJK UNIFIED IDEOGRAPH-
algorithm hangul AC00 D7A3
```

A `name` record contains a scalar and its formal Unicode name. An `alias` record contains its kind, scalar, and alias. The kinds are `correction`, `control`, `alternate`, `figment`, and `abbreviation`. All five kinds are accepted in escapes. A scalar can have multiple aliases of each kind.

An `algorithm hex` record contains inclusive scalar endpoints and a name prefix. The name is that prefix followed by the scalar's canonical hexadecimal suffix. Below U+10000, that suffix has exactly four uppercase digits. Otherwise, it has five or six uppercase digits without leading zeros. Lookup compares the complete generated name and rejects lowercase or padded alternatives.

A lookup accepts only the scalars within that record's range. The generator emits every corresponding range from the pinned data, including the ideograph families.

An `algorithm hangul` record has exactly the endpoints AC00 and D7A3. Libraries compute syllable names with the Unicode 15.1 Hangul naming algorithm and its fixed jamo short names. They do not list syllable names in the file. Hexadecimal rules likewise compute names without expanding their ranges into records.

Algorithmic formal names use algorithm records rather than explicit `name` records. An explicit name within a declared algorithmic range is malformed. A custom subset can retain an algorithm record or omit that family's names.

LF ends each line, with an optional preceding CR. The final line can end at the file's end. Blank lines are ignored, and fields use ASCII spaces or tabs. After the fixed fields, the remaining words form the name or prefix, joined by single ASCII spaces. Names contain uppercase ASCII letters, digits, spaces, or hyphens. An empty name or prefix is malformed.

Code point fields follow the numeric and scalar bounds of `unicode.txt`. Algorithmic ranges contain only scalars and cannot be reversed. Unknown records, alias kinds, repeated headers, and malformed fields are grammar errors. A scalar has at most one explicit formal name. Duplicate name or alias records are errors. One spelling cannot resolve to different scalars, including through algorithmic rules.

Duplicate or overlapping algorithm ranges for the same naming rule are errors. Explicit and algorithmic names share one lookup namespace with aliases. The loader rejects any spelling that identifies different scalars. These requirements apply to custom names files too.

Record order does not affect name lookup. Exact spellings, including case and spaces, determine name lookup. The records contain individual scalar names and aliases. A sequence of several scalars cannot supply one escape. Numeric escapes do not consult this file.

If the core abbreviation map does not resolve a source name escape, the library loads the names file. A matching names-dependent cache entry also requires that file. Printing never loads it because abbreviations belong to the core table. It can share the loaded data within one dialect. Without an unresolved source name escape or names-dependent cache entry, names data remains unread and cannot cause an error. Cached strings and supplied DOM strings already contain decoded scalars, so they need no name lookup.

A caller can supply `unicode-names.txt` beside `unicode.txt` in the source map. That file replaces all bundled names data, with no fallback for missing entries. A custom file can contain a subset of the names and algorithms. An omitted name is unknown. The two files must declare the same version.

If bundled resources exist and versions match, an omitted names file selects the bundled file. If those resources are unavailable and names data is needed, the caller must supply the names file. A version mismatch, missing required file, or malformed names data is a grammar loading error. The error names `unicode-names.txt`. If the line is known, the error includes it. These resource errors arise during source escape inspection or names-dependent cache loading, never from printing.

If names data is needed, the core table must declare exactly one Unicode version. A missing or repeated version prevents names-file selection and causes a grammar loading error. Numeric escape parsing does not add that version requirement by itself.

An unknown name is a document error at the escape's opening `‹`. It never falls back to a host name database or an empty string. The same error applies inside a definition that a later statement replaces.

Escape inspection follows successful lexical recognition and precedes syntax recognition. It visits quoted tokens in text order and reports the first invalid escape at its opening `‹`.

The lexical grammar performs no name lookup. Its string tokens retain their escape spellings. Shared cases combine invalid escapes with later lexical errors, earlier reader errors, and syntax errors. They also pin left-to-right selection between two invalid escapes.

### Engine-tag provenance

A grammar cannot introduce an engine tag. This restriction covers every binary, enumerated, and extension-member tag, including default values. The function `lit` finds engine tags supplied by literals rather than forwarded input. During reading, the reader applies `lit` to each complete `::` clause of a rule header, alternative, or emission item. It does not reject an intermediate term whose enclosing filter removes its literals.

Conditions, tag tests, and patterns only read tags, so `lit` does not apply to their tag-set terms. Constants and `%implies` follow their separate literal bans below. A constant reference gives `lit = ∅` regardless of its value, so binding cannot change this check.

| Term | `lit` result |
| --- | --- |
| Engine-tag literal `_X` | `{_X}` |
| Forwarded tag term, ordinary tag, empty set, or tag-set constant | `∅` |
| `.classes` or `.classify` result | `∅` |
| `a ∪ b` | `lit(a) ∪ lit(b)` |
| `a ∩ b` | `lit(a) ∩ lit(b)` |
| `a ∖ b` | `lit(a)` |
| `A ⟹ t` | `lit(t)` |

A forwarded term reads stored input or queried tags, such as `$c.tags` or `$.tags(r)`. Guards do not affect `lit`, and difference ignores its right operand. A tag clause with nonempty `lit` is a document error at the first engine-tag literal that `lit` keeps.

For error positions, each literal carries its source occurrence beside its tag name. Union keeps occurrences from both operands. Intersection keeps occurrences from both operands only for names present in both `lit` sets. Difference keeps only the left operand's occurrences, and a guard keeps only its result's occurrences. The first retained occurrence in written order determines the error.

Each expression below is legal with `lit = ∅`. Its result can retain an engine tag only when the forwarded input holds it.

| Tag clause | Result |
| --- | --- |
| `:: $c.tags ∩ (_Lu ∪ _Ll)` | The stored `_Lu` or `_Ll` tags of `$c` |
| `:: ($x ⟹ _Lu) ∩ $c.tags` | Stored `_Lu` when `$x` is present, otherwise empty |
| `:: ($c.tags ∪ _Lu) ∩ $d.tags` | The union filtered by the stored tags of `$d` |
| `:: (_Lu ∪ Word) ∩ $c.tags` | The stored `_Lu` and `Word` tags of `$c` |
| `:: (_Lu ∩ $c.tags) ∪ (Word ∩ $c.tags)` | The same stored tags as the preceding row |

In contrast, `:: _Lu` and `:: ($x ⟹ _Lu)` have `lit = {_Lu}`. Both are document errors at `_Lu`, even when the guard cannot hold.

A tag-set constant cannot hold an engine-tag literal, even inside a filter. Classifiers cannot assign them because engine tags are not classes. Neither side of `%implies` can name one. An engine tag cannot mark an omission. Disabled gates excuse none of these document errors. Pattern constants and tests can read engine tags.

Caller tokens bypass stage-zero character construction. Caller tokens also skip canonical decomposition, and the text beside them is not decomposed. Their values and images default independently to text, with explicit empty strings preserved. The engine adds no tags or normalization.

The caller can supply engine tags to represent earlier stages. Each supplied property tag requires its canonical spelling and support in the configured table. Its membership need not agree with the supplied value. Nonempty supplied attachments remain a usage error.

## 2. Grammars

A grammar is the stitching of the items of one stage of a pipeline (§13) into a set of rules, directives, constants, classifiers and implications. An item is a rule, a directive, a constant definition, a classifier or an implication, read from a document (§8, §9). A rule has a name and alternatives, and optionally rule-level tags, recipes, conditions, and an output directive. An alternative has guards, an expression, and optionally tags and recipes. The grammar DOM (document object model), in `docs/output.md`, is the exact data.

To stitch a stage's items, the loader reads them in order, whatever documents they come from. Each rule is stated one of three ways, and each is an error in the case given:

- `%rule` (`define`) defines a rule. It is an error if a rule of that name was defined before it in the stage.
- `%redefine-rule` (`redefine`) replaces the rule of that name defined before it in the stage. It is an error if none was. The earlier alternatives are then gone, those of any `%extend-rule` of the rule included.
- `%extend-rule` (`extend`) appends its alternatives to the rule of that name defined before it in the stage. It is an error if none was.

When `%extend-rule` extends a rule, each appended alternative carries the extension's own clauses: its rule-level tags, recipes, conditions, and output. These clauses apply to the appended alternatives alone, and the base rule's clauses do not apply to them. The earlier alternatives keep their own clauses. So a script document can add letters to a rule without restating its clauses, and its own clauses do not leak into the base rule. A definition is a `%rule`, `%redefine-rule` or `%extend-rule` statement: its alternatives and the clauses written with them. The loader records every replacement and extension.

A rule flag gives a rule a preference. Two flags exist, `leftmost-longest` and `fewest`, and a rule carries at most one. `%rule(F)` defines a flagged rule, and `%redefine-rule(F)` replaces its body and flag. A `%rule` or `%redefine-rule` without parentheses gives the rule no flags. `%extend-rule` accepts no flags and inherits the stitched rule's flag for all added alternatives. Flags belong to the rule, while clauses belong to each definition.

Parentheses follow the keyword and precede the name. Their only accepted content is one flag name, `leftmost-longest` or `fewest`, with optional surrounding spaces. Empty parentheses, duplicates, unknown flags, arguments and parentheses on `%extend-rule` are errors of the document. Section 9 gives their priority and positions.

The loader collects directives from all the stage's items. `%stage`, `%extend-stage`, `%redefine-stage`, and `%include` shape the pipeline (§13). Global `%features` also shapes the pipeline. Local `%features` and `%ambiguity-resolution` belong to a stage.

A stage also has constants. A constant is a named value that terms and conditions use (§10). Its name is `$` and a name (§9) that begins with `A` to `Z`, such as `$SU-STOPS`. By convention, the whole name is in capitals.

An item states a constant in one of two ways. `%const $NAME t` (`define`) defines the constant. It is an error if a constant of that name was defined before it in the stage. `%redefine-const $NAME t` (`redefine`) redefines the constant value. It is an error if no constant of that name was defined before it in the stage.

`t` is a closed term (§10). Every user constant reference binds to its name's final definition in the stitched stage. Other names can refer forward. Inside `%redefine-const $X t`, `$X` binds to X's immediately preceding definition. This lexical exception applies inside nested patterns, but never through another referenced constant.

String escapes resolve during document reading. Their decoded scalars belong to string terms and never enter the constant version graph. This rule covers strings in every syntactic position.

Each declaration creates an immutable version `(name, declaration-index)`. A redefinition records its predecessor. After stitching, the loader records each name's final version. It resolves self-references in a redefinition to its predecessor and all other references to final versions. These resolved edges never change during evaluation.

The loader builds a directed graph of dependencies between versions. It rejects unknown names and cycles across all versions, including replaced definitions. A cycle error gives source positions and its dependency path. Acyclic versions evaluate in dependency order. Every version of one name must have the same type.

A predecessor remains an expression, not a snapshot of earlier values. Its other references use final definitions. Thus after `%const $A A`, `%const $B $A` and `%redefine-const $A B`, both final values are `B`. Redefining A as `$B ∪ C` instead creates a cycle between final A and B.

After the loader stitches the stage, it makes sure that each rule definition that holds a constant meets the requirements of this section. An undefined user constant is an error there. The types of the terms, conditions and tests that hold constants must agree (§9, §10).

A constant in a value test must resolve to a string (§9). The requirements of §9 that depend on the value of a constant apply there too. The loader applies these requirements to every definition of the stage. That includes a definition that a later `%redefine-rule` replaces, although its alternatives are then gone.

A constant belongs to its stage, as a rule does. A document in several stages or dialects takes the values of each. The DOM of a document holds its definitions and its references to constants, never their values (§8).

Each error of a constant is an error of the document. Reader errors follow §9.3, including engine-tag literals outside patterns. The loader reports a second `%const`, a `%redefine-const` of nothing and a change of type at the constant's definition.

The loader reports an empty joined split delimiter in a constant value at the `%const` or `%redefine-const` definition. This document error has kind `grammar`. The loader reports errors from the two deferred capture checks of §9 at the rule's definition. It reports every other error that it finds at the reference to the constant.

A stage also has classifiers. A classifier maps a string to a tag set, the string's classes (§10). An item `%classifier NAME` (`classifier`) names a classifier of the stage and lists entries for it. `NAME` is a name (§9) that begins with `a` to `z`. Several items can name one classifier, and together they make it. So a second item of one name is no error, unlike a second `%rule`.

An entry has gates, one or more keys, an operator and one class. A gate is a guard `f?` or `¬f?`, as in an alternative (§3.1). A key is a string literal or string constant, with its exact value (§5, §9). The operator is `∈` or `∉`. The class begins and ends with an uppercase ASCII letter and never starts with `_`.

A constant key can contain a quotation mark or backslash. For example, `%const $QUOTE "‹U+0022›"` supplies the key in `$QUOTE ∈ K`. `%const $BACKSLASH "‹U+005C›"` likewise supplies a backslash key.

A classifier's value depends on the features, so the stage resolves it for one set of enabled features. It starts with no memberships, and takes the entries of every item of that name in the stitching order. It skips an entry whose gates do not all hold, as lowering drops an alternative (§3.1). For each key of any other entry, in order, `∈` adds the membership of the key in the class, and `∉` removes it. The value maps each key to the classes that it has after the last entry.

An `∈` whose membership already holds is an error of the grammar, and so is an `∉` whose membership does not hold. The stage resolves every classifier of its grammar when it lowers the grammar for the features of a parse (§3). It resolves them before it lowers the rules, and whether or not a term reads them. So such an error ends the stage as an error of lowering does (§3). Its message names the document, line and column of the entry. An entry that a gate skips has no such error.

A call `a.classify(classifier)` names that classifier (§10). A `classify` whose classifier no `%classifier` item of the stage declares is an error of the document. A classifier belongs to its stage, so the loader finds this error when it stitches the stage. It reports the error at the definition that holds the call.

A stage also has implications. An item `%implies A ⟹ B` (`implication`) adds one. `A` and `B` are closed terms (§10) whose type is a tag set. A constant in them has the value that the last definition of the stage gives it, as in a rule. After the loader stitches the stage, it makes sure that their types agree, as it does for a rule (§9). §11 says how the stage applies its implications.

A stage has exactly one `%ambiguity-resolution L [elision-only]`, or it is an error naming the stage. `L` is `greedy`, `lazy` or `late-elision` (§6).

No directive names elidable terminators. A rule marks each elidable optional in its body, as `[+T …]`. Whether an optional is elidable is a property of the optional itself. It is the same in every stage that includes its document.

A lowercase name is a rule reference and must be defined in the stage. `🆓` is an ordinary rule name. A capital name or engine tag is a tag terminal. A string literal or string constant is a value terminal. A range matches one scalar value, and `_` matches any ordinary token. Section 9 specifies lexical forms and terminal identity.

A rule reference, call, terminal, or parameter accepts one tag test and one value test, in that order. A tested parameter must receive one symbol. A value test uses `=` or `≠` with a string literal or string constant. A tag test lists signed tags or tag-set constants in `<…>`. All listed requirements hold together. An empty constant supplies no requirements.

Tests use a terminal token's own tags and value, or a reference's constituent tags and input value. Both test kinds can occur, with the tag test first. Both must hold. Tests do not alter terminal identity.

### 2.1 Ranked choice validation

Identify each ranked expression after final stitching and constant binding. Its identity is the final rule, zero-based alternative index, and expression path. Its options retain source order. Every group requires at least two expressions.

Visit rules in expanded order (§2.3), then groups in alternative and expression traversal order. The first offending group determines the error, across capture and tag checks. Source locations remain separate from the document DOM. The group location is its first `≻` token when source exists.

A capture inside an option belongs to its innermost ranked group. Simplify each condition for capture presence in every virtual option expansion. A virtual expansion records written capture positions without copying the parent. Every remaining condition that reads a private capture must be ready when its binding group completes.

Each selected option binds captures declared within its group, whether present or absent. An active nested group binds its own captures. When a selection skips that group, the enclosing group binds its absent captures. Loading and runtime use the same bindings. Determine these bindings before capture-presence simplification.

`$` becomes ready only at completion of the enclosing named alternative. A final ranked group can reach completion. Any suffix element, even one that can read no tokens, delays it. An unready private condition reports `ranked-choice-continuation`.

After readiness validation, reject a private condition with `$.preceded-by(S)` if its option can start after the named rule starts. Both positive and negated atoms follow this rule. Report `ranked-choice-boundary` with the written condition as `expression` and the offending option as `option`. The message names the condition, the atom, and the option. It suggests two rewrites: move the condition into a rule that starts with the ranked group, or test the private capture itself.

Record each group's start in every virtual expansion. Its prefix can read tokens if every prefix step has a finite structural derivation and some step has a nonempty derivation. Compute these facts over the final stitched grammar, including disabled alternatives, without conditions or symbol tests. An empty-only prefix remains legal. A forward atom on `$`, a backward atom on a private capture, and a condition without private captures follow their rules.

Private captures cannot feed tag terms, emission items, or recipes. Inspect carriers, attachments, guards, and every nested receiver before absent-carrier pruning. A forbidden export reports `ranked-choice-export`. Common prefix and suffix captures, and whole-parent `$` emission, remain legal.

A seal is an opaque leaf supplied by a ranked choice (§4.1). Private conditions keep their evaluation order and real captured states. A condition on `$` observes the composed parent with its seal. Feature guards and symbol tests remain ordinary gates. A failed gate provides no qualifying reading.

The ranked helper uses the logical tag constructors of §3.7. An untagged unary production inherits its child's tags. Untagged zero-symbol and multi-symbol productions return empty tags. Explicit tag terms replace inheritance.

Compute provable emptiness over all logical alternatives and helpers, including disabled features. Mark a rule or helper unsafe when an explicit tag term differs from literal `∅` after constant expansion. Without explicit terms, mark it unsafe when its only logical symbol is a terminal.

Add an inheritance edge from every other untagged unary production to its child rule or helper. Propagate unsafe marks backward until no mark changes. Every unmarked rule or helper is provably empty. Explicit `∅` blocks inheritance. Zero-symbol and multi-symbol productions introduce no unsafe mark or edge.

An unmarked unary cycle cannot invent tags in a finite proof. Written terminals can supply tags although restored terminals do not. Pattern leaf tags remain separate from constituent tags.

Follow local unary inheritance from the ranked helper toward its enclosing named parent. If unsafe tags reach that boundary, report `ranked-choice-tags`. A multi-symbol parent or common explicit tag term discards option tags locally. No caller analysis or runtime equality of rival tags excuses unsafe inheritance.

Malformed ranked DOM reports `ranked-choice-syntax`. A failure of the syntax stage carries that code when its failing token is `≻`, or the preceding token is `≻`. A failing `|` also carries it when its current grouping level already contains `≻`. Grouping levels start at `(`, `[`, or `{` and end at their matching closer. A keyword starts a new statement at its current level.

Thus `a | b ≻ c`, `a ≻ b | c`, `| a ≻ b`, `a ≻`, and `≻ a` carry `ranked-choice-syntax`. Other unrelated reader errors retain their codes or uncoded form.

Loading errors carry the structured members defined in `docs/output.md`. Tag errors use the shortest inheritance witness from the group to its tag source. Source traversal order breaks equal-length choices. Helper sites use written expression paths.

### 2.2 Close families

A close family is a set of rules. A `.without-elision-except` call names it through one rule of the stage, its family rule (§4, §10).

The members are the least set that holds the family rule and is closed under one step. Take any member. Each member edge of one of its alternatives makes the edge's target a member too. A member edge is one path from the alternative's `expr` to one `ref` to a rule. The path can pass through `capture` and `test` nodes and through the branches of a `choice`. It cannot pass through `seq`, `optional`, `repeat`, `and` or `ranked`.

So `{"choice":[{"ref":"a"},{"ref":"b"}]}` gives two edges, and `{"optional":{"ref":"m"}}` gives none.

The loader reads members from final expanded rules, never from lowered productions. Instance calls become ordinary rule edges after expansion. Every alternative counts, whatever its guards. Tests, tag clauses and conditions do not gate membership either. So an `%extend-rule` can add a member, and a `%redefine-rule` can remove one. Members never depend on the enabled features.

A rule owns the elidable optionals that its definition writes outside call arguments. Helpers never own an optional, whatever expression holds it. An `%extend-rule r` writes optionals that `r` owns outside call arguments. A family permits each elidable optional that one of its members owns. A family can permit none. Its queries then answer as `.without-elision` does.

After expansion, only an instance owns each elidable optional of its expanded definition, including one that an argument supplies. A template owns no optional.

A family argument is a rule reference, so the reference checks of this section cover it. A call can stand in a header or alternative tag clause, a condition, or the tag clause of an emission item. The loader reports an undefined family rule at the definition that contains the call.

The loader visits final expanded rules in the order of §2.3, and each rule's alternatives in their existing order. For each alternative, it reads body references and then the alternative's tag clause. With a definition's first alternative, it then reads header tags, conditions, and emission items' tag clauses, in that order. Within a clause, it follows receivers and arguments in written order. The first undefined name determines the error message. An extension's clauses belong to the extension, so their errors stand at its definition.

### 2.3 Templates and instances

A template is a rule with load-time parameters. An instance is one template with concrete arguments. Expansion replaces parameter nodes with argument nodes before ordinary rule validation and lowering.

```jbogenbau
%rule(fewest) pair(@Left, @Right)
  @Left @Right

%rule named-pair = pair("a", "b")
%rule text
  named-pair | pair("a", "c")
```

Parameters belong to one definition, including its alternatives, clauses, conditions, and emission. They have no dynamic scope. Another template receives a parameter only through an explicit argument.

A parameter starts with `@` and an ASCII letter. Its remaining characters are ASCII letters, digits, hyphens, or underscores. Case counts. A declaration contains one or more distinct parameters, separated by commas. Default arguments, variable argument counts, and overloaded names do not exist.

A template and an ordinary rule never share a name in one stage. Redefinition cannot convert one kind into the other. Their names follow the same rules, including eligible emoji names (§9.1). After substitution, bare template references are errors outside pattern rule atoms. An argument can carry such a name only to pattern uses. A call of an ordinary rule is an error.

A call has `(` immediately after its name, without whitespace or a comment. The comment opener `(*` takes priority, so `r(* note *)` remains a reference followed by a comment. `r (x)` is a reference followed by a group. A template declaration uses the same adjacency rule.

A call is a rule symbol. Captures, tests, patterns, rule-valued method arguments, and close families can name it. A call in retained syntax creates one instance even when no body references that instance. Binding calls and exact-instance edit heads also create their instances when later statements replace them. Normal reachability requirements still apply to neighbor targets.

#### Arguments and substitution

An argument is one term, separated from other arguments by a comma at the call's outer level. Delimiters protect punctuation inside an argument. Parenthesized body expressions and `ε` pass sequences as one argument. No extra sequence sigil exists.

```jbogenbau
%rule link(@Prefix, @Body)
  @Prefix @Body

%rule linked = link((BIhE 🆓), mex-group)
%rule plain = link(ε, mex-1)
```

The argument reader tries these forms in order:

1. A requirement list, `<…>`, with the ordinary signed requirement syntax.
2. An ungrouped target choice, with two or more targets separated by `|`.
3. A parenthesized body expression, optional, repetition, or `ε`.
4. An ordinary term or tested symbol, including names, calls, literals, constants, ranges, wildcard, tag sets, strings, and patterns.

A parenthesized expression that cannot parse as a body follows ordinary term syntax. A parenthesized argument with one symbol reads as that symbol. This includes a parameter, a tested symbol, and a literal.

Other bodies retain their argument category. Parentheses alone add no node. An unparenthesized run of body symbols is not one argument.

Bare tag runs retain their ordinary tag-set meaning.

Optionals and repetitions also remain single body arguments. A tested symbol retains its tests as one argument.

An argument cannot declare or read a capture, including `$` and captured string methods. Capture reads nested inside patterns or calls also fail. Constants retain their separate closure rules. An argument inside a template can use only that definition's declared parameters.

Substitution copies one parsed node into each use. It never reparses text or changes the grouping around the use. A parameter can occupy a body operand, pattern operand, query target, filter requirement, or term position. Term positions include conditions, tag clauses, tests, and value or image recipes.

Node decorations are exact prefixes, tests, or child lists.

The use determines the conversion, before ordinary validation:

| Position | Accepted argument and conversion |
| --- | --- |
| Body operand | Body EXPR, one symbol atom, or a target choice converted to one choice |
| Captured or tested symbol | One symbol after argument conversion |
| Query target | Rule name, call, user tag, or spliced target choice |
| One rule argument | Ordinary rule name or exact instance |
| Tag term | Tag, tag-set constant, or tag-set term |
| Signed requirement | Tag, tag-set constant, or unnegated spliced requirement list |
| Value test or range endpoint | String literal or string constant |
| Value or image recipe | String literal, string constant, or closed concatenation |
| Pattern operand | Name, call, tag, string, constant, terminal atom, or whole pattern predicate |
| Pattern node with `·`, tests, or children | One node test that accepts those decorations |
| General term | Term whose type after constant binding is the required string, string-set, tag-set, or pattern type |

A name becomes `ref` in a body, `name` in a pattern, or `rule` in a rule argument. A tag becomes a body `ref`, pattern `terminal`, or singleton tag term. A string becomes a body or pattern `literal`, or retains its term form. A user constant becomes a pattern `constant` or the ordinary constructor for its other use. Other conversions keep their ordinary tests and type restrictions. No conversion changes runtime scope.

A pattern argument in a child item consumes one child. It never splices its children into the enclosing list. A node decoration requires a compatible node test after conversion. Each decoration conflicts only with the same decoration already on that argument. Written tests retain their ordinary target and order restrictions. A compound predicate cannot receive node decorations.

An exact prefix requires an argument without an exact prefix. An attached list requires an argument without an attached list. Thus `·@X` accepts `#a« b »`, and `@X« b »` accepts `#·a`. Both uses produce `#·a« b »`. Neither use discards an existing decoration.

An expanded use must satisfy the original position's syntax and type rules. For example, `$x:@P` requires one capturable symbol. A sequence or choice cannot acquire a hidden wrapper rule. A value-test operand still requires a string literal or string constant.

A parameter cannot construct a name or occupy a declaration name, flag, guard, method name, capture binder, carrier, or attachment. It cannot replace a directive operand, classifier name, or integer argument. The head directly after `[+` can be a user tag or parameter. That parameter's argument must become exactly one bare user-tag atom after argument conversion. Rules, sequences, tested arguments, constants, and tag-set expressions are invalid there. A parenthesized single tag, such as `(KU)`, reads as that tag.

Only two positions splice an argument's children into the surrounding list:

| Use | Argument | Substitution |
| --- | --- | --- |
| One complete query-target entry | A target choice | Targets enter in written order |
| One complete unnegated filter requirement | A requirement list | Requirements enter in written order |

```jbogenbau
%rule letter(@Char, @Forbidden)
  $c:@Char
%conditions
  ¬$c.following-tokens.begins(h | @Forbidden)

%rule filtered(@Char, @Excluded)
  @Char<¬Accent @Excluded>

%rule b = letter("b", b | unvoiced)
%rule a = filtered("a", <¬Ogonek ¬Caron>)
```

A requirement list is distinct from a tag set. An empty `<>` splices no requirements. A list under `¬@X` is an error. A tag or tag-set constant under `¬@X` retains ordinary requirement negation. A requirement list in any other position is an error.

A target choice can also supply one grouped body choice where a body operand accepts it. It cannot become a tag set or a pattern. Parenthesized body choices never splice into query targets. A target list must remain nonempty after substitution.

Elsewhere, substitution keeps the argument as one node. Ranked groups keep their own seals and priority. Ordinary union flattening still applies after substitution.

Substitution also flattens pattern intersections before expanded-pattern validation, including in conditions and call arguments. Each resulting array retains operand order, duplicates, and source attribution. This normalization applies only to nesting that substitution creates. Initial shape inspection still rejects nested intersections in supplied or cached PATTERN constructors.

After type resolution, term-level intersections with pattern type also flatten nested intersections in their effective form. This normalization precedes evaluation, expanded type inspection, and instance keys. The cached term keeps its unresolved shape. Intersections with tag-set or string-set type retain their nesting. Difference retains both operands for every type.

For example, a template condition can contain `#(@P ∩ A)`. With argument `#(A ∩ B)`, substitution produces `#(A ∩ B ∩ A)`. The expanded pattern has one intersection array with three operands. Term-level intersections of pattern values also flatten, through groups and after substitution.

```jbogenbau
%rule t(@P) A
%conditions $ ≅ #(@P ∩ A)
%rule text = t(#(A ∩ B))
```

Substitution also flattens concatenations inside recipes before ordinary validation. Their operands enter in order, including empty operands. Each operand retains its source attribution.

Parameters carry no runtime state.

#### Identity and names

An instance key uniquely identifies an instance. It contains the stage, template identity, and ordered argument DOMs after parameter substitution and argument conversion. Keys remove source positions.

They flatten unions, concatenations, and runs as the reader does. Pattern intersections also flatten, including through grouping parentheses and in pattern-valued terms after type resolution. Pattern child arrays and choices follow the reader shapes in `docs/output.md`. Invalid supplied PATTERN nesting is an error, rather than another key. Nested body `seq`, `choice`, `and`, and `ranked` nodes remain distinct.

They retain argument categories, operator order, constants by name, and rule references by name. They never expand a referenced rule's body or compare evaluated argument values.

A nominal reference names a rule without expanding it. A nested call contributes its own template and argument key. Giving that nested instance a public name does not change the key of its enclosing call. A nominal reference to the public name remains a distinct argument. Thus `f(named-pair)` and `f(pair("a", "b"))` have different keys.

A binding assigns a public name to an instance. `%rule NAME = CALL` writes that assignment. It creates no alternative, wrapper constituent, or extra ranking occurrence.

Each key uses its final public name, or its canonical name when unnamed. Calls before a binding use that same final name. One key has at most one public name. One public name binds at most one key at a time.

A public name cannot equal a template name.

`%redefine-rule NAME = CALL` can replace an earlier ordinary rule or rebind a named instance to a different key. The old instance retains its identity and edits, and falls back to its canonical call name. The new instance takes NAME everywhere. A key that already has another public name cannot receive NAME. Repeating the current binding is an error. `%extend-rule NAME = CALL` is an error.

An edit written with NAME applies to the key bound at that statement's source position. Earlier edits remain on the old key after rebinding. Later edits by NAME apply to the new key. Every reference to NAME, except the head of an edit, uses its final binding. Exact calls continue to name their own instance keys.

A binding accepts no flags, clauses, conditions, or output directive. An instance receives these from its effective definition. Instance-specific edits use a later ordinary body statement.

An unnamed instance uses its canonical call spelling. The printer preserves the normalized argument DOM, without expanding constants or named instances. It joins arguments with `, `, places `(` directly after the template name, and writes `)` after the last argument.

Names, calls, tags, constants, `_`, `ε`, and `∅` retain their lexical spellings. A range joins its endpoints with `..`, without spaces. Signed requirements use `<A ¬B>`, including `<>`. Target choices use `a | b`.

String arguments use ordinary notation quotes and the escapes of §9.1. Each required escape uses the selected abbreviation alias or numeric code point. Other scalars remain literal. This spelling distinguishes a literal argument from an explicit concatenation argument.

Body arguments retain outer parentheses, except bare `ε`, optionals, and repetitions. The printer separates sequence items with one space. It uses ` | `, ` ≻ `, and ` & ` between operands. An optional has no internal padding. Braces have no internal padding except the spaces around `/` and between a chain marker and its item.

Parentheses follow binding strength. In bodies, sequence binds tighter than `&`, and `&` binds tighter than either choice operator. A weaker child requires parentheses. A nested `seq`, `choice`, `and`, or `ranked` retains parentheses when omitting them changes its stored nesting. Other unnecessary grouping is absent. Thus a choice argument prints `(a b | c)`, while a nested sequence prints `(a (b c))`.

A union containing only bare tags prints as a run with single spaces. A union containing only string literals also prints as a run with single spaces. Other unions use ` ∪ `. Intersections, differences, and concatenations use ` ∩ `, ` ∖ `, and ` ++ `. A run beside `∩` or `∖` retains parentheses as the source grammar requires.

For other term operators, the printer follows §9.2 binding and associativity. It adds parentheses exactly where removing them changes the normalized DOM. It prints no leading no-op operator. Pattern operators follow the binding rules in `docs/notation.md`, with the same grouping rule.

Pattern literals print `#` directly before a node test, constant, parameter, or bare child list. Other whole patterns print inside `#(…)`. A node's exact prefix prints `·` without a following space. Tests follow their terminal without spaces. A child list attaches without a space and always retains its guillemets, including with one child.

A nonempty list prints `« `, its items, and ` »`. An empty list prints `«»`. Child items have one separating space. Optional brackets and braces have no internal padding. A separator prints as ` / `, and a sibling gap prints `⋯`.

Paths print as `⋮ P`, `⋱ P`, and `P ⋰`. If the operand is a compound pattern, the printer adds parentheses around it. A node test, constant, parameter, or bare child list takes no parentheses. Thus nested paths retain parentheses. A path over children prints `« A B » ⋰`, with the list boundary intact.

Pattern union, intersection, and difference use spaces around their operators. Intersection operands that are unions or differences take parentheses. Union and intersection flatten their own kind. A difference's left operand takes no parentheses. If its right operand is a union or difference, that operand takes parentheses. Other parentheses follow binding strength.

If a union operand is a difference after the first operand, the printer adds parentheses around it. The first operand takes no extra parentheses. Thus `a ∪ b ∖ c` is the canonical spelling of `(a ∪ b) ∖ c`.

A choice uses ` | ` between alternative arrays. If a choice or set item shares its array with other items, the printer adds parentheses around it. A sole choice or set item takes no extra parentheses. These arrays include child lists, optionals, repeats, separators, and choice alternatives. Plain child groups flatten their sequences. No printer substitutes parentheses for a child list.

Tests follow their symbol without spaces. Method selectors follow their receiver without spaces. Methods use ` | ` for target choices and `, ` for other argument lists. A zero-argument selector has no parentheses. Call parentheses follow the same no-space adjacency rule.

Every accepted argument has a canonical spelling. Complex arguments never require a public name merely to obtain a spelling. Canonical names identify argument trees injectively. The ordinary reader accepts those spellings under the same Unicode table, names data, and bindings.

For every valid pattern P, `key(read(print(P))) = key(P)`. The key removes source positions and retains constants by name, decorations, boundaries, operator order, and duplicates. It does not identify patterns merely because they match the same trees. The requirement also applies to a pattern inside another argument or call.

A pattern name that reads back as a terminal under the loaded Unicode table is invalid. This restriction covers ordinary rule names, template-family names, and call names. It also applies to supplied and cached DOMs. A pattern `literal` contains a decoded string. User constants use `constant`.

Read-back inspection also descends through every argument and target inside a pattern call, including nested calls and body arguments. Each nominal rule reference must read back as a rule in its actual syntactic position. For example, a Unicode table can make `A` both an eligible emoji name and a tag spelling. If `f(A)` reads that argument as a tag, its supplied `rule:A` argument is invalid. Even if the template ignores that argument, its category remains distinct.

The effective name appears in trees, display JSON, canonical JSON, `insertedBy`, warnings, expected lists, witnesses, diagrams, and audit records. Such names are strings and can contain emoji, punctuation, spaces, and quotes. Runtime nodes need no extra template field.

#### Source order and flags

Template declarations and edits use parameter heads. `%redefine-rule f(@X)` replaces the template body and flag. `%extend-rule f(@X)` appends alternatives with that statement's own clauses. Both require an earlier template with the same arity. Parameter names can change because binding is positional.

A closed call contains no parameter references. An instance-specific edit names its public name or its exact closed call. An edit by public name requires an earlier binding in the stage. Before that binding, a defined ordinary name still addresses its ordinary rule. A future binding cannot make an undefined earlier edit valid.

`%redefine-rule f(a)` replaces that instance's body and flag. `%extend-rule f(a)` appends alternatives to that instance alone. The earlier template declaration is sufficient to create the addressed instance. A prior body call is unnecessary.

The loader applies template-wide and instance-specific events in source order for every instance. It replays earlier events even for an instance first discovered later. A later template redefinition replaces earlier local bodies, extensions, clauses, and flags. A later template extension reaches every instance, including one with an earlier local redefinition. A later local edit changes only its addressed instance.

For example, the later template redefinition removes the earlier local extension:

```jbogenbau
%rule slot(@Unit)
  @Unit
%rule named-slot = slot("a")
%extend-rule named-slot
  "b"
%redefine-rule(fewest) slot(@Unit)
  @Unit "c"
%extend-rule named-slot
  "d"
%extend-rule slot(@Unit)
  "e"
```

The final named instance reads `"a" "c"`, `"d"`, or `"e"`, with flag `fewest`. Another instance `slot("x")` reads `"x" "c"` or `"e"`, with the same flag.

A template flag becomes the ordinary flag of each instance. Extensions keep the instance's current flag. Redefinitions replace it, and a redefinition without a flag removes it. Bindings add no flag. Instances contribute actual nonempty constituents to the shared profiles of §6, with no new ranking tier.

#### Patterns and exact targets

A bare template atom in a pattern matches every instance originating from that template, including named and locally redefined instances. It tests family identity through the ordinary unary pattern walk. It creates no instance and matches nothing when the template has no instance.

An exact call in a pattern identifies one instance. An instance referenced only by patterns receives the ordinary unreachable-rule note. Its public name identifies that same instance. Template-family membership remains internal metadata.

Recognition and neighbor targets accept ordinary rules, exact calls, named instances, and permitted user tags. A bare template name is a load error, including in `.tags(R)` and `.without-elision-except(F)`. An exact instance used as a close family follows §2.2 after expansion.

#### Finite expansion and errors

The loader constructs a directed parameter-flow graph before expansion. A node identifies one parameter position of one template. For every call in a template definition, each argument creates edges from every parameter that it contains to the callee's corresponding position.

An edge is unchanged when that argument is exactly the source parameter. Otherwise the edge grows. Nested calls, expressions, and lists count as wrapping forms. A parenthesized single parameter stays unchanged and adds no growth. Arguments with no parameter references create no edge. The loader includes calls at every depth and every definition, including replaced definitions and uncalled templates.

A directed cycle with a growing edge causes `unbounded-instantiation`. The error names the cycle, growing wrapping form, and source locations. Unchanged recursive calls, permutations, and passing a nominal rule name remain valid. An arbitrary expansion-depth limit cannot replace this analysis.

```jbogenbau
%rule stable(@X, @Y)
  @X | stable(@Y, @X)

%rule growing(@X)
  growing(stable(@X, "a"))
```

The second declaration fails even when nothing calls it. The first declaration has only unchanged edges.

The loader first records declaration order, bindings, template signatures, and edits. It then resolves names, constants, and parameter binders and performs the flow analysis. It records only closed calls during instance discovery.

The source pass visits declarations in source order. Every binding visits its instance call, including a binding that a later rebinding replaces. An exact-instance edit visits its head call before its body. A template head declares parameters and creates no instance.

Within each retained definition, the pass uses the reference traversal of §2.2. It visits a call's arguments from left to right and finishes each argument before recording the enclosing call. Inner closed calls therefore precede outer closed calls.

Calls that still contain parameters wait for substitution.

The source pass finishes before the loader reads the discovery queue. Each new instance adds its effective expanded definitions to this first-in, first-out queue. Each definition includes its body, tag clauses, conditions, and emission clauses. The loader uses the same reference traversal and inner-first argument walk there. A repeated key adds nothing, including a recursive reference.

For each instance, the loader replays applicable events and substitutes arguments using each event's parameter names. Replaced bodies and clauses receive per-instance document validation, but their calls create no live instance. Validation-only expansion uses separate keys and contributes no entry to the discovery queue or audit. A binding or exact-instance edit head still identifies its subject independently of its body's lifetime.

Ordinary document rules apply to every expanded definition. Structural analysis, ranked safety, capture analysis, depth limits, and lowering then use ordinary rules. Unused parameters and uncalled templates are audit notes, not errors.

An error at a parameter use names the template definition and the originating call and argument. An argument error names that argument. Source locations stay separate from the position-free key. A wrong arity, unknown template, duplicate parameter, or undeclared parameter is a load error. Binder and flow errors also apply to uncalled templates. Kind-dependent errors require an instance.

The audit lists templates, instance keys, effective names, first calls, bindings, flags, unused parameters, and uncalled templates. It records all applicable template and local events in source order, including events later replaced. Rule and instance lists use the expanded order defined below. Template order follows declaration order. The audit also notes argument-alias twins, as `docs/design.md` defines them.

#### Expanded rule order

An ordinary rule receives a declaration slot at its first definition. A binding receives a slot at its name's first declaration. Redefining an ordinary rule as a named instance retains that rule's slot. Rebinding a named instance retains its name's slot and puts the new key there.

The expanded grammar first lists ordinary rules and named instances in declaration-slot order. It then appends all unnamed instances in first-discovery order. An instance that loses its public name joins this unnamed tail at its original discovery position. If nothing else references that instance, it receives the ordinary unreachable-rule note. An already discovered instance that receives a public name uses the name's slot instead. No instance occupies two positions.

Production numbering, reference checks, rule traversal for diagnostics, and the audit use this expanded order. Expected entries still sort their `rules` by code point. Template declarations have no runtime rule slot. Within a rule, alternatives and applicable edits retain their existing order.

## 3. Lowering

This section writes productions as `lhs → symbols`. This is not jbogenbau, the notation of gencmu grammars (`docs/notation.md`), but the context-free grammar that a jbogenbau grammar is lowered to.

Lowering turns a grammar, given the set of enabled features, into a context-free grammar of productions. The lowered grammar is what the parser runs. Lowering decides nothing that a user can observe, except through §4 to §6 and its errors. For the same features, the stage also resolves its classifiers (§2).

Every production of a named rule records the stitched rule's flags. Productions from extensions, expanded alternatives and recursive chain levels all carry them. Helpers carry no flags. Flags change no recognition, nullability, symbol test or default tag. A close of a flagged production with one logical symbol does not affect the action comparison. Its occurrence still contributes to the rule profile (§6), in the part of its flag.

A stage lowers its grammar when a parse gives it the enabled features. So a dialect whose documents read and stitch loads, whatever errors lowering finds for some features. An error that lowering finds is an error of the grammar for the features of that parse. It ends the stage as the stage's result, as other parsing errors do. The stage has no verdict, no tree and no output, and no later stage runs.

The error has the kind `grammar` and the stage's name, and no position member, since its position is not one of the stage's input (`docs/output.md`). Its message begins with the document, the line and the column of the definition that wrote the alternative at fault, as `case/a.md:3:1:`. That definition is the `%rule`, `%redefine-rule` or `%extend-rule` that holds the alternative. It is not the place of the braces in it, and not another definition that makes an item of the braces empty. The errors of a classifier (§2) are reported in the same way, at their entry.

Where a grammar has several errors of lowering, the parse reports one, in this order. Errors of classifiers come first. Then lowering takes the rules in order (§3.9). For each rule, it reports a chain beside another alternative (§3.3) before it lowers that rule's alternatives.

An item of braces that can match no tokens (§3.3) comes last. Lowering decides nullability after it lowers all rules. It examines the surviving rules and their alternatives in order, and reports the first alternative that holds an empty item. The error names only the definition, so which empty item of that alternative it meets first is not observable.

So a chain beside another alternative is reported before an empty item, whichever rules hold them. This order is the model of the diagnostic, not of the work. An implementation can meet the braces in another order internally, as long as it reports the same error.

### 3.1 Feature gates

Lowering drops an alternative whose gates do not all hold. A gate `f?` holds when the feature `f` is on, and `¬f?` when it is off. A warning `f!` is not a gate and never drops its alternative (§12).

### 3.2 Expression expansion

Lowering expands each remaining alternative into sequences of symbols. `(a | b)` expands to both, in written order. A plain optional `[x]` that holds a capture (§3.5), at any depth, expands in place as `(ε | x)` does.

It expands first to the empty sequence, then to each expansion of `x`, in order. It has no helper. Any other `[x]`, plain or elidable (§3.8), is a helper `h → ε | x`.

The engine names the helpers, and it never shows their names. A helper is a production whose left side is a helper name.

An elidable optional `[+T x]` is always a helper `h → ε | T x`, since it never holds a capture. Flat braces are a helper too. `{x}` is `h → x | h x`, and `{x / s}` is `h → x | h s x`. So `[{x}]` is a helper `o → ε | h` around the helper `h` of `{x}`. Lowering expands `x` and `s` in place in these productions, as anywhere in an alternative. So a sequence or a choice there needs no helper of its own.

`A₁ & … & Aₙ` has at most 16 items. More is an error of the document (§9), since the expansions number 2ⁿ−1. It expands to every non-empty subsequence that keeps their order. The subsequences come in the order of the binary numbers 1 to 2ⁿ−1, with `A₁` as the lowest bit. `ε` is the empty sequence. A sequence's expansions are the products of its items' expansions, the first item varying slowest.

So `A [$b:B] [$c:C]` expands to `A`, `A C`, `A B` and `A B C`, in that order. `A [B] [$c:C]` expands to `A h` and `A h C`, which share one helper `h → ε | B`. A plain optional that holds a capture, whose content has k expansions, contributes 1 + k expansions: the empty one, then those k. A sequence multiplies these counts, as for a choice. So `[$b:B]` doubles the expansions of its alternative, and `[($a:A | B | C)]` contributes four. The nested `[A [$b:B]]` contributes three: `ε`, `A` and `A B`.

Physical expansion binds captures to their enclosing named production. Logical structure still represents every plain optional as one helper symbol, present or absent. Ranking transparency, default tags, ranked tag safety, and query priority use that structure.

An absent optional supplies empty helper tags. A present optional computes its content's tags through the same recursive logical structure. `A [$b:B]` therefore has two logical symbols in both physical expansions. `[$a:A]` inherits A's tags when present. `[$a:A $b:B]` inherits none because its content has two logical symbols.

Expansion preserves actual selected children and omission records. It creates no optional node in the accepted output tree. Named-rule cycle exclusion uses actual rule occurrences over spans. A logical helper never adds a named-rule cycle.

A tested symbol expands to that one symbol, which carries the test. It adds no helper. So the numbering, the transparent closes of §6 and the constituents of a production are those of the symbol without its test. Two productions that differ only in the test of a symbol are two productions.

### 3.3 Chains

A chain is an alternative whose whole expression is `{... x / s}`, a left chain, or `{x ... / s}`, a right chain. Either can leave out `/ s`. The reader makes sure that a chain is the whole expression of its alternative (§9). A chain must also be the only alternative of its rule left after §3.1. Another alternative beside it is an error of the grammar.

Lowering turns the chain into recursion on the rule itself, with no helper for the braces. `{... x / s}` becomes `r → x | r s x`, and `{x ... / s}` becomes `r → x | x s r`. Without a separator, `s` is left out of these productions. Lowering expands `x` and `s` in place, as in §3.2.

Every level of a chain is then a constituent of `r`. The ranking sees its closes (§6), and the clauses of the alternative attach to its base productions and to its recursive productions alike (§3.6). The default tags of §3.7 come from each production as it stands. So without written tags, `r → x` has the tags of `x` where `x` expands to one symbol, and a recursive production has none.

An item of braces, flat or chain, that can derive the empty sequence is an error of the grammar. Lowering decides this over the structural grammar of the enabled features. That is every production that §3.1 to §3.5 make from the stitched stage, helpers included. Clause attachment (§3.6) does not yet remove any production whose condition simplifies to false. Tests are ignored. So a production that a false condition removes still counts, and so does a production that a test can never pass.

A rule that `text` cannot reach counts too, and lowering makes sure that all remaining braces meet these rules, reachable or not. An alternative that a gate drops, and a definition that a later `%redefine-rule` replaces, do not count. An alternative that an `%extend-rule` adds counts like any other. Every implementation decides nullability in this phase, whatever order it builds its productions in.

A separator can derive the empty sequence. So a list or a chain never has a derivation that repeats an empty item, and `[{x}]` derives the empty sequence in exactly one way.

Lowering finds both errors of this subsection when it lowers the grammar for features that make them. It reports each one at the definition that wrote the alternative, as for any error of lowering. The order is the one that the start of this section gives. A gate or a `%extend-rule` can make either error depend on the features, and a warning guard never removes an alternative.

A flat list is one helper, so its closes are transparent (§6), and the clauses of its rule apply only to the rule's whole constituent. Some grammars need each prefix of a list as a constituent, which the ranking and the rule's conditions see. Such a grammar writes a chain or explicit recursion.

### 3.4 Ranked expressions

A ranked expression lowers to one transparent helper with ordered options. Every expansion retains its option index and written expression identity. An invocation is a recognition state of one named rule, as §6.1 defines it. Its entry retains the enclosing named invocation and complete prefix state.

Conditions keep the named scope for `$`, `.onward`, `.preceding-tokens`, and `.following-tokens`. Private bindings leave the continuation environment after ready gates. Proofs retain them for output and diagnostics.

Number ranked options in source order before later siblings. No ranked helper gains a flag. Ordinary parentheses keep their expansion behavior.

### 3.5 Captures

A capture `$x:s` must wrap a single symbol `s`, which can be tested. It can stand anywhere in the expression of an alternative, at any depth. That includes a group, a choice, an item of `&` and a plain optional. It must not stand inside braces, flat or chain, or inside an elidable optional (§3.8), at any depth (§9).

A capture names the matched symbol in each production that reads it. A production has the capture `x` exactly when its expansion reads the symbol that `$x` wraps. The other productions of the alternative lack it, and the missing-capture rules of §3.6 apply to them.

A name stands at most once in each production, but it can stand in several productions of one alternative. So `A ($x:B | $x:C)` is valid: each of its two productions reads one `$x`. `[$x:A] $x:B` and `$x:A & $x:B` are errors, because the expansions `A B` hold `$x` twice (§9). Two alternatives of a rule can always capture one name, and two branches of a choice are two productions in the same way.

A production's captures stand in the order in which it reads them. That is the order of their positions in the text, since an expansion keeps the left-to-right order of what it reads. Different productions of one alternative can read the same names in different orders, as in `($a:A $b:B | $b:B $a:A)`. An alternative can have any number of captures. Each costs what §4 says.

`$`, the whole constituent, is a capture of every production that no alternative writes. Its span runs from the item's origin to its end, and its tags are the constituent's (§4).

### 3.6 Clauses

Conditions, tags, recipes, emission, and erasure attach to the production that an alternative lowers to, or to each production if it expands to several. They attach with the clauses of the alternative's definition (§2). A production has a capture where its expansion reads the captured symbol (§3.5), and every production has `$`.

Before lowering attaches a clause, it simplifies the clause for the production, by these rules:

- Each presence test `$x` (§10) becomes true or false as the production has `x` or not.
- `A ⟹ B` becomes `B` where `A` is then true. Where `A` is false, it becomes true, as a condition, or the empty set, as a term.
- A condition `A ⟹ B` whose `B` is then true becomes true, and one whose `B` is false becomes `¬A`.
- Lowering reduces `¬`, `∧` and `∨` over a true or false part as logic says.
- A constant is its value here. So a constant whose value is the empty set is an empty set.
- Lowering drops a term's empty set, written `∅` or left by a guard, from a union. A union of nothing but empty sets is the empty set, as is an intersection with one. A difference whose first part is empty is empty. If its second part is empty, the difference is its first part. A guarded term whose term is the empty set is the empty set.

Since the engine never evaluates a reduced part, the reduction is part of the order of evaluation (§10). A capture that is still mentioned after simplification is used by the clause. Then the simplified clauses attach as follows:

- A condition applies to a production if it did not simplify to true and the production has every capture that it uses. Otherwise lowering drops it for that production. A condition that simplifies to false applies, and removes the production. So `%conditions $x` keeps the alternatives that capture `x` and removes the others.
- Lowering drops an emission item whose carrier (§11) the production lacks from that production's emission. It also drops each attachment capture that the production lacks from its item.
- An alternative or definition tag term with a missing capture is a document error.

Recipe capture validation follows §11 after absent-item pruning. A rule-level recipe is checked only on channels where its production uses it. An alternative override can suppress one or both channels. An unknown or private capture remains an error before that pruning.

### 3.7 Tag inheritance

Explicit alternative and definition tag terms union. If neither exists, inheritance uses logical helper structure, not the physical expansion's symbol count.

A production with one logical symbol inherits that symbol's tags. A production with zero or several logical symbols has empty tags. Each optional remains one logical helper. Its absent route has empty tags. Its present content applies this same rule recursively.

Flat-repeat helpers and named chain levels retain their own logical production structure. Ranked tag safety uses these same inheritance edges (§2.1). Explicit `:: ∅` stops inheritance.

A restoration has the empty helper production's empty tags. A terminal that reads a synthetic token contributes no inherited constituent tags (§7.5). Pattern leaf tags remain separate.

### 3.8 Elidable optionals

An optional is elidable exactly when it is written `[+T x]`. After template substitution, T is one user tag and can carry the head's existing symbol tests. The written head is that tag or a parameter, directly after the marker. No group can surround the head or the complete content.

`x` is a sequence of any primaries, possibly empty, and holds no capture at any depth. The reader makes sure of this form (§9).

A plain optional `[x]` is never elidable, whatever its content, also where it begins with a terminal that another optional marks. So `[KU]`, `[KU | VAU]` and `[{KU}]` are ordinary optionals, and the `[+KU]` of `{[+KU] A}` is elidable.

The `elision-only` check (§7) reads this same lowered grammar in a mode of its own. In that mode, an elidable optional is restored or written, and never empty (§7.4). A tested elidable terminal keeps its test there.

Every well-typed test on the elidable terminal is legal. The omission predicate determines whether its empty production can succeed. The marker is part of the optional's text, so no later item of the stage can change whether an optional is elidable. A test on a later symbol of the optional is no error, since §7 restores only the terminal.

Lowering records whether each helper represents an elidable optional. For an elidable helper, it also records the terminal `T`, its test and the optional's owner (§2.2). The rest of this document says "elidable optional" of these helpers.

Before predicting an empty elidable production, the recognizer requires its omission predicate to hold. The predicate tests `(s,{T})` for equality `=s`, and `("",{T})` otherwise. Without a test, it is true. This condition applies in main recognition, nested queries and reconstruction.

A false predicate creates no omitted node, elision count or restoration record. It causes no declaration error or warning. Written productions remain available.

### 3.9 Numbering

Lowering numbers the productions from 0. The canonical order *T* of §6 uses this numbering. *T* orders the ambiguity diagnostics. The canonical tie-break keys never turn a tie into an accepted reading.

A production that a condition false for it removes (§3.6) takes no number, though the helpers of its alternative still do. Lowering takes the expanded rules in the order of §2.3. Ordinary rules and named instances retain declaration slots, followed by unnamed instances in discovery order. Alternatives added with `%extend-rule` follow the rule's own alternatives.

Within a rule, lowering takes its remaining alternatives in order. Each alternative contributes its own productions first, and then its helpers. Its own productions come in the order of its expansions (§3.2). For a chain, the base productions come first, one for each expansion of `x`. The recursive ones follow, one for each expansion of the sequence that the recursion adds, in the order of §3.2. That sequence is `s x` in a left chain and `x s` in a right chain.

An alternative's helpers come one for each place in the alternative where a helper's `[ ]` or flat `{ }` is written. They come in the order in which those places are written, left to right. A plain optional that holds a capture is expanded in place (§3.2) and has no helper and no place of its own. The places written inside it keep their order among the others. So the expansions of such an optional are productions of the rule itself, numbered in the order of §3.2. The canonical order *T* of §6 compares them by those numbers.

The helpers of the places written inside a helper follow that helper's productions at once, depth first, before the next helper of the alternative. A helper of flat braces has its base productions first and then its recursive ones, as a chain does. The places inside `x` come before those inside `s`, since `x` is written first.

The braces of a chain (§3.3) have no helper: they are lowered into the rule's own productions. But the `[ ]` and flat `{ }` inside its item and its separator have helpers, as anywhere else.

Every expansion of the alternative that goes through a helper's place shares that helper. So an item of `&`, or a place inside the item or the separator of braces, has one helper however many expansions use it.



## 4. Recognition

The parser is an Earley recognizer, a parser for any context-free grammar, over the lowered grammar. The set of items that it produces specifies it, and any algorithm that produces that set is correct. The recognizer builds one set of items for each position in the input.

An item has a production, dot position, origin, structural prefix state, and demanded restoration observations (§4.1). Each capture before the dot retains its span, tags, structural state, and demanded close observation. Completed items retain the corresponding observations of their constituent. Two items merge only when all these values agree. Their proof edges remain distinct.

Fix a production, dot position, origin, input position and structural prefix state. Fix every captured part's tag set and structural state. Fix every demanded restoration observation too.

Captures then add items only where their spans can vary. For example, with `t → $l:t $r:t | A`, a completed item over one span exists once for each position where `$l` can end. Without the captures, it exists once.

Captured spans increase the item count, and the notation sets no limit on the number of captures. A captured part's span before the dot is part of an item's identity. So items that differ only in where a captured part began or ended are not merged. Neither are the summaries of §6 and the states of eligibility above that are kept for each item.

Take one production, dot position, origin and input position. Each captured part before the dot can multiply the number of its items by the number of its possible spans. Let N be the length of the input. The factor is up to N + 1 for each end of the part that nothing else fixes. The origin, the input position or a neighboring captured part can fix an end. Its tag sets, structural states, and demanded restoration observations can multiply the items again.

A capture of a terminal, or of a part whose length is fixed, costs little, since its start fixes its end. A capture of a rule that can end in many places, such as a list, costs the most. The span of `$` needs no extra coordinates. Its demanded restoration observations can still distinguish items.

A memo stores answers for reuse. Ordinary query keys use the query kind, rule, and span or content. Aligned query keys also retain the restoration constraints specified below. Capture names alone do not distinguish answers.

A tag terminal `T` matches a token with that stored tag. A string terminal matches an ordinary token with exactly its value. A range matches an ordinary token whose value is one scalar within its resolved endpoints. `_` matches every ordinary token once.

Only a tag terminal can read a synthetic terminator, through that terminator's own tag. A value terminal, range, or wildcard never reads one. Empty-valued ordinary tokens remain consumable. Terminal identities and canonical diagnostic spellings follow §9.

A tested symbol (§2) matches what its symbol matches, where its test holds. The test reads the symbol's own span and its own tags. For a terminal, the span covers that one token in the current input, and the tags are the token's tags. For a reference, they are the span and the tag set of the completed item that the item advances over.

`X="s"` compares the symbol's value exactly. `X≠"s"` negates that equality. `X<A ¬B>` requires A and forbids B on the symbol's own tags. Constant requirements expand with the same sign.

A test is a predicate even over an empty span. `X=""` holds for an empty constituent. A tag test with an empty constant always holds. Each stage-zero token has its decomposed scalar as both value and image.

When an item reads a tested symbol, the recognizer produces the advanced item only if every test holds. This holds over a token, for a terminal, and over a completed item, for a reference. It includes an advance over a constituent that completed empty at the item's position. Two completed items over one span can have different tag sets. So a tag test can let an item advance over one of them and not over the other.

The recognizer applies the test before any condition that the advance makes ready. The paragraphs below say when a condition is ready, and they give the order of one step in full. If the test fails, the recognizer evaluates none of the conditions that the advance makes ready. The order is observable, because a condition can end the parse with an error of the grammar.

The test does not stop the conditions that run earlier. These are the conditions inside the referenced rule, which run before that rule completes. They are also the conditions of the advancing item's own production that run when the recognizer predicts that item.

The test is not part of the terminal's identity. A tested terminal `T="s"` is the terminal `T` for the actions of §6. It is also `T` in the tree's token nodes (§12) and in the witness. The test only removes matches.

When an item completes, its constituent's tags are its production's tag terms evaluated over its captured parts (§10) and joined as §3.7 says. A completed item has exactly one tag set. So two derivations of one production over one span that are one item have equal tag sets. Two such derivations with different tag sets differ in a captured part, so they are two items.

The recognizer evaluates a condition, as simplified for its production (§3.6), as soon as the item reads the last capture that it uses. It evaluates a condition that uses `$` as soon as the item is complete. At that point, `$` spans from the item's origin to the set that the item completes in. It has the tags that its production's tag term gives it. If the condition fails, the recognizer does not produce the advanced item.

The recognizer evaluates a condition that uses no capture when it predicts the item. It does the same with a condition that uses only `$` in a production with no symbols, over the empty span there. So a rule whose only production has no symbols and the condition `$.starts-input` completes only at the start of the input. Anywhere else, the recognizer never advances an alternative that begins with that rule, and that alternative predicts nothing after the rule.

A step of the recognizer is an advance of one item, or the prediction of one production at one position. Each step evaluates its parts in this order, and it stops at the first part that drops the item:

1. In the check of §7, a step whose additional item is strict and stands at the end of its production. §7.4 drops that item before the step evaluates any condition or tag term.
2. The test of the symbol that the step advances over, where that symbol has one.
3. The conditions that the step makes ready, in their written order. A condition on captures and a condition on `$` that become ready at one advance keep that order. Each one stops early as §10 says. The first that fails drops the item.
4. Where the step completes the item, its production's tag term. The recognizer evaluates it where a condition of step 3 first reads `$.tags` or `$.classes`. Otherwise it evaluates it once every ready condition holds.

   So a failing condition that does not read them stops the tag term. This holds also for a production with no symbols at its prediction. How many times the step evaluates the tag term is not observable.
5. The boundary rules of §4.2. They run last, so a test, condition or tag term that drops the item first leaves no obligation.

A condition or a tag term can end the parse with an error of the grammar. Where an earlier part drops the item, that error never happens. So the order of steps 3 and 4 after steps 1 and 2 is observable, and so is the written order within step 3.

Two orders are free:

- The drop of step 1 and the test of step 2. A test is an ordinary predicate and raises no error, and either one only removes the item. So both orders give the same items and the same errors.
- The parts of one tag term. The alternative's own tag term and its definition's rule-level `::` clause join as a union (§3.7). Where both fail, the two orders differ only in which error's message the result has, and the message is free.

The order between steps, between items and between sets is not observable either. Every step that the rules of this section reach runs in the end, so the same errors happen. §7.4 removes steps, and their errors with them. Two such errors differ only in their message.

A target choice is a nonempty ordered list of ordinary rules, exact instances, and user terminal tags. Written alternatives use `|`, and repeated targets change nothing. Each terminal target reads exactly one original token carrying its tag. A rule target runs a nested parse of that rule.

`span.matches(S)`, `span.begins(S)`, and `span.ends(S)` try the targets in written order until one succeeds or raises a grammar error. Every target must resolve, even where an earlier target always succeeds. `span.tags(rule)` accepts only one rule target.

Whole, prefix, suffix, and tag queries run nested recognition for a rule target. Suffix recognition follows §4.4. For an ordinary span, a nested parse recognizes only its tokens, with `rule` as the start rule, over the same lowered grammar. It applies tests and conditions as the main parse does.

A proof tree of an item shows how the rules of recognition justify the item from the chart. A predicted item, with its dot at the start, is a leaf. An advance of an item over a token or over a completed item is a node. Its children are a proof tree of the item before the advance and, for a completion, a proof tree of the completed item. Each advance follows the rules of this section, with its tests and conditions satisfied.

A proof tree is eligible when none of its omissions is forbidden (below).

An ordinary query that the check of §7 starts reads the projected span in the stage's input. It uses this lowered grammar in its ordinary mode (§7.6). Its chart is every item, partial or completed, that this recognition holds after it ends. The four query methods read these eligible proof trees before ranked admission (§6.1) or ranking. Their structural observations still use the sealed leaves of §4.1:

- `matches` holds when a completed item of `rule` spans the tokens and has an eligible proof tree.
- `begins` holds when a completed item of `rule` has its origin at the span's start, in any set, and has an eligible proof tree. So it covers a prefix of the span, the empty prefix included.
- `ends` holds for an eligible completion ending at the window end from any start within it (§4.4).
- `tags` is the union of the tag sets of the completed items of `rule` that span the tokens and have an eligible proof tree.

A proof tree is finite, and it does not depend on the order in which the recognizer finds items. In an ordinary query without restoration constraints, a rule can occur again over the same span within its proof tree. This differs on purpose from the derivations that a stage counts and ranks (below, and §6), which exclude such a repetition. An item with no finite proof tree from predicted items has none, so a cycle alone gives none.

An implementation can rebuild the advances from completed spans, as it can for a stage's derivations (below). Such a rebuilding keeps the captures, and it applies the symbol tests again to the actual candidate. It never evaluates a condition again.

Several eligible proof trees are an ordinary success. A query never ranks its proof trees, and it never has a tie or an ambiguity error. The witness of a tie (§6) is a different thing, and a query has none.

A nested parse follows written-terminator priority. In plain words, a nested reading cannot leave out an elidable optional where the same construct can read that whole optional as written. An omission is an advance of an item over the empty helper of an elidable optional (§3.8), at its position `p`.

Whether an omission is forbidden depends on the production prefix that the proof tree holds fixed, as follows:

- Where the preceding logical symbol is a nonterminal `Y`, the fixed prefix is the preceding item in that proof tree. It retains its captures. The omission is forbidden when the chart advances that item over a completed `Y` that ends at some position `p′ ≥ p`. The resulting item then advances over a completed nonempty alternative of the optional, from `p′`. That completed `Y` passes `Y`'s test, if it has one.
- Where no preceding nonterminal applies, the fixed prefix is the item before the optional itself. The omission is forbidden when the chart advances that item over a completed nonempty alternative of the optional, from `p`.

The preceding symbol is read in logical helper structure (§3.2). The fixed prefix ends before that symbol, independent of capture expansion. A preceding plain optional supplies both absent and present blocker routes. Its nested helpers keep the same logical boundaries.

Three cases use the prefix immediately before the elidable optional: production start, a preceding terminal, and an initial recursive self-reference. The blocker search retains each proof's own prefix and eligible route. An omission does not record which constituent it closes.

For `r → B [c] [+T] D T`, capturing `c` changes no query answer. Both forms use the optional helper as the preceding logical symbol. Its absent and present routes take part in the same blocker search.

The blocking advances come from the unfiltered query chart. The query's chart ends with its span. A bounded `matches` sees no written continuation past that span. A `begins` with `.onward` or `.following-tokens` sees the remaining input.

The nonempty alternative is the whole content of the optional, not only its terminator. So a written terminator forbids an omission only where the whole optional can complete after it. For example, take `r → c [+T A] D` and `c → B | B D`. On `B D T`, `begins` of `r` holds. The longer `c` reaches the `T`, but `[+T A]` cannot complete. On `B D T A`, `begins` is false, because the whole written optional completes.

The advances of a blocking path come from the chart. So their tests and conditions passed. They need not belong to a proof tree of `rule`, and they need not be eligible themselves. An attempt that never completes `rule` can still forbid an omission.

So eligibility belongs to a whole proof tree, not to an advance alone. Two proof trees of one item can hold different items fixed before `Y`. An omission is permitted only through a proof tree whose own fixed prefix permits it, and that same tree must be eligible. An eligible prefix of one tree never combines with the permitted omission of another.

For example, take `r → [A] y [+T] C T U` and `y → A B | A B C | B z [+U]`. Also take `z → ε | C T`. On `A B C T U`, `begins` of `r` is false.

Two proof trees reach the omission of `[+T]` after `y`. In the first, `[A]` is empty and `y → A B`. That prefix is eligible, but the omission is forbidden, since the same prefix reads `A B C` as `y` and then the written `T`.

In the second tree, `[A]` reads `A` and `y → B z [+U]`, so the omission of `[+T]` is permitted. But that tree is not eligible. Its omission of `[+U]` is forbidden, because `z` can read `C T`, and then the written `U` follows. Without the `[+U]` of `y → B z [+U]`, the second tree is eligible, and `begins` holds.

An implementation can keep two states for each item. The first, E, says that the item has an eligible proof tree. The second, P, says that it has an eligible proof tree whose fixed prefix permits the next optional to be empty. The two states follow these transitions:

- A predicted item has E.
- An advance that is not an omission gives the resulting item E when the item before it has E. For a completion, the completed item has E too.
- An omission gives the resulting item E only when the item before it has P.
- The item before an optional with a preceding logical nonterminal `Y` has P through one advance over `Y` that gives it E. The item before that advance is the fixed prefix, and that prefix must permit the omission.
- The item before an optional with no preceding logical nonterminal has P when it has E and it permits the omission itself.

The implementation computes E and P together, to the least answer that the advances give. So an item that only a cycle through itself makes eligible has neither state.

Eligibility filtering reads only the chart, and it evaluates no conditions. A query's answer determines which expressions the enclosing condition evaluates. The recursive-query error rule (below) applies to those evaluations.

`$x.without-elision` restores the terminators omitted inside `$x` for a query that preserves those closes.

A candidate is one constructed reading. A witness is a qualified reading that answers a query. A close record holds an omitted terminal and its original input boundary. In a witness of `.without-elision-except(F)`, it also holds a mark that says whether `F` permits its elidable optional (§2.2). Alignment compares the terminal and the boundary, never the mark. Ordered records at one boundary form a close group.

Aligned readings preserve these groups through their shared interval.

Let O be the current input with N tokens. Let `$x` cover `[a,b)` in O. Its restoration observation contains its own close records in leaf order, including records at both endpoints. An absent ordinary optional contributes no record. The caller's omissions contribute none. Ranked groups contribute opaque blocks as §4.1 specifies.

The logical view contains `O[a:b]` with those records restored, followed by the unchanged suffix `O[b:N]`. It uses the synthetic-token representation and original source mapping of §7.2 and §7.3. The captured endpoint follows every synthetic token at `b` and precedes original token `O[b]`. Morphology does not run again. Saved value and provenance remain available, but saved value is not an alignment field.

The match bound limits a completed witness. The context bound limits input visible to conditions and written-terminator priority. An ordinary query uses its span end for both bounds. A restored query keeps context `[a,N)` even when its match bound is `b`.

`$x.without-elision.matches(R)` and `$x.without-elision.tags(R)` require a witness of R from `a` to `b`. The latter unions those witnesses' own tags. `$x.without-elision.begins(R)` permits any end `c` through `b`. `.onward` extends the match window through N without changing the restoration observation. Thus `$x.without-elision.onward.begins(R)` permits any end `c` through N. A whole query on that extended window requires end N.

Compare candidate and witness close groups through `min(b,c)`, including both boundaries. Equal omission counts alone are insufficient. Under `.without-elision`, every group must have the same terminals in the same order. The witness cannot add, remove, move, or reorder a close in that interval. Under `.without-elision-except(F)`, the witness can also hold the extra closes that the paragraphs below permit. It still cannot remove, move or reorder a candidate close.

A prefix cannot end between records of one close group. An empty prefix compares the complete initial group. Under `.without-elision`, an extra omission at exactly `b` disagrees. The witness can consume suffix tokens later, and the omission still disagrees. Under `.without-elision-except(F)`, it disagrees unless the paragraphs below permit it.

`$x.without-elision-except(F)` relaxes the comparison in one way. The witness can hold extra closes that the candidate lacks. Each extra close must meet three conditions. `F` permits its elidable optional (§2.2). It is a close record, never a block. In the witness's tokens and records through `min(b,c)`, a kept element stands on each side of it.

A kept element is an original token, or a witness record that equals a candidate record in the comparison below. Other extra closes can stand between the extra close and those kept elements.

So an extra close at a boundary `p` with `a < p < min(b,c)` can qualify, because tokens stand on both sides. At `a`, an extra close must follow a kept candidate record at `a`. At `min(b,c)`, it must come before a kept candidate record there. When `a` equals `min(b,c)`, it must stand between two kept records.

The comparison is a deletion test. Delete some such closes from the witness's observation through `min(b,c)`. If the rest can equal the candidate's observation through the same point, the witness qualifies. No candidate close or block can disappear, move or change order. Equal closes can differ in their marks, and then a greedy match can fail. So the comparison considers every deletion within a group.

A group at a boundary holds the close records at that boundary and the blocks that start there, in leaf order. The deletion test never deletes a block. At `min(b,c)`, a block that starts there and ends after it lies beyond the comparison, in both readings. A witness block that starts before `b` and ends after `b` fails the witness, as under `.without-elision`.

The permission depends on ownership alone. A witness can close a member construct earlier than the candidate closes it, where written-terminator priority allows that omission.

After original position `b`, an extended witness follows ordinary omission rules. It can read real written terminators in the raw suffix. Those tokens retain written status. The candidate supplies no restoration records after `b`.

Qualification uses original eligible proofs before applying the alignment filter. The witness's tests and conditions must hold on O. Written-terminator priority retains the full context bound and cannot treat a restored token as a written blocker. A blocker with another internal division still belongs to original eligibility. Filtering alignment before computing eligibility changes this policy and is forbidden. Ranked admission and stage ranking do not run inside the query.

A terminal target has a witness with one original token and no close or block records. Restored queries apply the same alignment test to this witness. A retained candidate record in the comparison therefore prevents a terminal target from succeeding. With no such record, a matching original token supplies a positive terminal witness.

A synthetic token supplies evidence for an omission, rather than an additional mandatory word. It cannot satisfy a bare terminal in the witness. An omitted optional keeps its omission predicate and does not require its remaining content. Alignment compares terminal identity and boundary, without comparing the candidate's saved equality-test value. For candidate `X [+T="a"]` and rival `X [+T="b"]` on X, both omission predicates hold and alignment succeeds.

These four probes distinguish aligned queries from literal replay:

| Candidate on X | Rival | Query | Answer |
| --- | --- | --- | --- |
| `X [+T]` | `X [+U] [+T]` | Whole | False, because U adds a close |
| `X [+T]` | `X T` | Whole | False, because a bare T requires original input |
| `X [+T] [+U]` | `X [+T]` | Prefix | False, because the final group includes U |
| `X [+T Y]` | `X [+T Y]` | Whole | True, because the omitted optional requires no Y |

If `F` permits U, the first probe holds under `.without-elision-except(F)`. U then stands between the original X and the kept T, inside the shared stretch. Under a family that does not permit U, and under `.without-elision`, the first answer stays false. The other three answers hold for every family, because their rivals add no close.

All observations inside a witness use its own projected original spans and trees. `.source-text`, `.value`, `.image`, `.starts-input`, token tags, and patterns never observe inserted spelling as written input. Ordinary nested queries receive no inherited alignment constraint. An explicit nested `$y.without-elision` or `$y.without-elision-except(G)` uses the witness's captured observation of `$y`. The second form also permits the extra closes that `G` permits. It receives no family from the outer query, and an outer family never passes inward.

When `$y` extends into the suffix, its later omissions enter that additional constraint. No token is restored twice.

Every query retains its caller's lowered grammar, features, constants, classifiers, and Unicode data. No morphology, emission, implication, stage lean, or rule-profile ranking runs inside it. A rule flag cannot turn existence into a best-reading test.

Aligned query answers need separate memo keys from ordinary queries. The keys include the original context and source observations, start, context end, match window, and whole or prefix mode. They include the ordered close groups, opaque blocks, common entry observations, lowered grammar, features, and family. They also include any cycle context on which a cached proof summary depends. A synthetic-token view keeps saved value where recognition values use it. Saved value never becomes part of close equality.

The active-query identity remains the requested rule and projected context interval in O. The family is not part of the active-query identity. For aligned whole and extended-prefix requests, that interval is `[a,N)`. The whole endpoint is a witness filter and does not change that identity. Ordinary and restored views share the same active stack across `matches`, `begins`, `ends`, and `tags`. Another script, synthetic position, or query kind cannot evade the recursive-query grammar error.

Answer keys distinguish constraints, while active keys detect self-definition.

An ordinary query reads the tokens of its span alone. A `matches` over a span does not look past the span's end, even where a written terminator stands after it. So the keys of the memo (below) fit its answer.

`begins` is one recognition over the whole span, not a separate parse of each prefix. Conditions see the query's context end. For an ordinary span, that end equals the span end. A recognizer can stop at a set that holds no item, since no later set can then hold one. Otherwise it reads as far as it can. An error of the grammar that it meets is an error, even after `rule` completed once.

For ordinary spans, an implementation can remember answers for the whole parse of a stage in a memo. A memo stores answers from earlier nested parses. This general memo is optional. Section 4.4 defines separate suffix sharing and its cost.

Two queries can share an answer when the nested parse observes the same things in both. That is, the two queries are of the same kind and ask about the same rule. They also have the same span or the same content.

The same span is the same start and end in the stage's input. Within one parse, the span fixes the tokens and the lowered grammar. A query that the check of §7 starts has its projected span here, never its span in the reconstructed input. Its grammar is the main parse's.

So one memo can serve the main parse and the check, and a query of each over one span shares an entry. The content is the original text over the source of the span's tokens (§1). It also holds, for each of the span's tokens, its tags, text, value, and image. Last, it holds where each token's source begins and ends, counted from the start of the source of the span's tokens.

Tags alone are not enough, since a condition can read `.source-text`, which includes what lies between the tokens. Also, the source of each token decides what `.source-text` of a part of the span is. A key of content must keep its fields apart, so that no two different contents give the same key, whatever characters the fields hold. A key of content lets equal spans at different positions share an answer, and repeated words make this worth having.

But such a key costs time in proportion to the span, and the span of `.onward` or `.following-tokens` runs to the end of the input. So a key of content suits short spans, and a key of position suits long ones. Both keys hold for the queries of §7, since those read the stage's own input. A position is a position of that input, never of the reconstructed input.

The recognition of §7 is not a query and has no entry.

`matches` and `tags` of one span and rule can share an entry, since one recognition answers both. `begins` and `ends` need separate entries, since `begins` of a span can hold where `matches` of it does not. A memo that outlives the parse of one stage must also be keyed by what differs between the parses that it serves. These are the tokens, the original text, and the inputs that select a shared memo. §4.3 specifies such a memo.

An ordinary nested parse uses its span as the context for all position and surrounding-token methods. An aligned parse uses its context bounds above. It restores both when it ends, also when it fails with an error of the grammar.

A nested parse's own conditions and tag terms can start further queries, so queries nest. They nest to any depth, and no bound applies to it. The depth follows the input, as in a chain of `$.following-tokens.begins(x)` across a long text. So an implementation keeps the active queries on a stack of its own, not on the call stack of its language.

A query is active from the start of its nested parse to its end. Take a query about a span as a rule. It is an error of the grammar where an active query is about the same span and rule. `.matches`, `.begins`, `.ends`, and `.tags(rule)` are one kind here, so the methods of the two queries do not matter.

Whether a query is negated does not matter either. The error names the rule, and the whole parse fails with it. Such a query makes the grammar define the rule in terms of itself over the same text.

Only queries are active. The main parse of a stage is not a query, and neither is the recognition of the check of §7. In the main parse this changes no result. A query there about the whole input as `text` runs a nested parse of the same tokens with the same grammar. That nested parse reaches the same condition again, and then it is the active query. The check of §7 reads other tokens, so there the difference shows (§7.6).

A query names its span in positions of the stage's input. A query that the check of §7 starts names its projected span (§7.3). So two queries are about the same span exactly where they read the same tokens of the stage's input.

Derivations are finite trees. A derivation in which a constituent has, anywhere below it, a constituent of the same rule over the same span is cyclic. The engine does not count a cyclic derivation, since such a derivation can repeat without end. For example, with `a → b` and `b → a | A`, `A` has one derivation as `a`, not infinitely many. So does the empty text as `t`, with `t → u | ε` and `u → t`.

Derivations are made only of advances that the tests allowed. An implementation can build derivations again from completed spans, without the advances. Such an implementation applies the tests again, each to the candidate constituent itself, with its own span and its own tags.

For example, take `text → [X] body="y"`, `body → X Y | Y` and the input `X Y`. The token that `X` reads has value `x`, and the token that `Y` reads has value `y`. Only the `body` over `Y` matches, so `[X]` reads `X`. No derivation reads `[X]` as empty.

A tag test works in the same way. Take `text → [X] body<B>` and `body → X Y | Y`, where the second production of `body` has the tag term `B`. Only the `body` over `Y` carries `B`, so again `[X]` reads `X`.

In a derivation, an empty elidable helper supplies one omission at its input boundary. Its record holds the terminal, boundary, source, and saved equality value. It does not record which constituent it closes. Late-elision reads omission counts. Aligned queries read their owned ordered close records.

The query blocker relation uses the logical preceding symbol described above. Braces use their expanded logical productions. Production start, a preceding terminal, and an initial recursive self-reference retain their immediate-prefix treatment.

A counted derivation is an eligible noncyclic derivation of a completed `text` item that spans the input. With a counted derivation, a stage accepts its input. Ranked admission preserves this recognition for the sealed grammar. Section 6.1 defines admission before ranking, with raw charts and query answers unchanged.

The stage rejects an input whose every completed text derivation is cyclic, as it rejects one with no such item. A stage that accepts its input can still end with a tie, which is an error (§6). A rejected input reports the furthest position that any item reached. It also reports the terminals that the items there can read next, together with the rules that those items belong to. The stage writes a tested terminal with its test, such as `LE="la"` (`docs/output.md`).

A rejection at the end of a stage's input has an empty source at the source end of its last input token. If the stage has no input tokens, that source is `[0,0]`. The original text's length does not determine this position. This follows the empty-node source rule of §12.

### 4.1 Shared candidate observations

A structural state is a finite summary of demanded tree predicates. Compile only patterns that conditions demand, and their dependencies. Reuse identical subpatterns. Intern states so equivalent observations share one state. A tree pointer in every item does not provide the required forest sharing.

Patterns observe the structural tree defined in `docs/notation.md`. Rule names and terminal identities form a finite alphabet for a lowered stage. A leaf transition records terminal identity and demanded value-test and tag-test answers. An omitted T has empty observed value, empty image, and pattern tags `{T}`. These leaf observations never replace constituent tags.

Compile each child-sequence expression into a finite sequence machine. Prefix states advance as children complete. Ellipses permit arbitrary sibling gaps, and flat repetitions use sequence loops. Helpers concatenate their child sequences without a named constructor. Named completion adds its own constructor transition, including named chain levels. Empty named children disappear from parent sequences, but their directly captured roots remain observable.

A node test evaluates its atom and attached child list together at the current node. Unless `exact:true` is present, it propagates that complete local answer through a sole child. A bare child list follows the same rule without an atom. Each child pattern computes its own complete answer, with its own exact prefix.

Descendant paths combine local and child answers. First and last paths use only their respective child. Set operations combine complete predicate answers on one candidate. Difference complements the completed deterministic answer, never incomplete evidence or another unary layer.

The state retains more than final Boolean answers. It includes sequence prefixes, leaf tests and child observations that later transitions need. Intersections and differences use correlated product states. They never combine facts from different packed edges.

An advance keeps its structural prefix and each captured child's completed state. A condition on a capture reads that state when the constituent completes. A condition on `$` reads the candidate completion state before ordinary tag evaluation. These conditions never run an additional recognizer or inspect ranking.

At a ranked group completion, the structural sequence machine receives one fixed sealed leaf. Every option and proof supplies the same leaf. It has no name, terminal identity, value, tags or children. Every node test fails on a seal, including bare lists and exact empty lists. Paths stop there, while sibling ellipses consume it as one child.

An empty completed option also contributes exactly one sealed leaf. Empty normalization never removes it or a named node that contains it. A seal is not an observable node as defined in [Tree patterns](notation.md#the-structural-tree).

Private option captures retain their real completed states for ready gates. The composed parent state propagates the seal through subsequent constructors and captures. Output trees, tags, elisions and ranking actions retain their actual derivations. No seal appears in serialized trees or grammar DOMs. Queries and reconstruction apply the same transition at ranked group boundaries.

Every proof edge stays within its observation state. Equal states still permit distinct derivations and ordinary ties. A cycle alone supplies no finite proof of a structural answer. Cycle exclusion keeps its rule-and-span identity. A different structural state does not permit repetition of the same rule over the same span.

Restoration observations retain proof-sensitive close groups and opaque blocks beside the finite structural states. Only captures demanded by `.without-elision` or `.without-elision-except`, and their dependencies, need these observations. Only the witnesses of a family query carry permission marks, and each mark is relative to that query's family. Candidates, strict queries and ordinary recognition carry none.

The deletion test of §4 is the rule for a family witness. At each boundary through `min(b,c)`, the witness's group must reduce to the candidate's group by that test. A recognizer can compute the test as the witness grows. A family query fixes its candidate for the whole witness chart, so the candidate's group at each boundary is known.

Let the candidate's group at a boundary `p` hold `n` records. The test at `p` is an automaton whose states are pairs `(i, t)`. `i` counts the candidate records matched, and `t` says whether a deletion follows the last match. A witness record that equals the next candidate record moves `(i, t)` to `(i+1, 0)`. A permitted close moves `(i, t)` to `(i, 1)`. At `i = 0`, that move needs `p > a`.

At a boundary `p < min(b,c)`, `(n, 0)` and `(n, 1)` accept. At `min(b,c)`, only `(m, 0)` accepts, where `m` leaves out a candidate block that starts there and ends after it. Beyond `b`, every group passes. A run can make several deletions in a row. So other extra closes can stand between a deleted close and the kept element on each side.

An item keeps an end set: the states that its own records at its end reach from `(0, 0)`. It keeps a start set: the states from which its own records at its start reach acceptance. An empty item keeps the relation between states instead. A boundary strictly inside an item holds a complete group. When the item grows past it, the group passes if the two parts' sets share a state. Otherwise the group fails, and the item's summary is dead.

Two items with equal raw observations and equal summaries share one state. A cyclic observation has the dead summary, as it has one invalid raw state.

A boundary that an item reads past lies before the witness's end `c`. So its accepting states are known while the witness grows. When an item reads the token at `p`, its end set must hold an accepting state of `p`. At the witness's end, its start set must hold `(0, 0)`. Its end set must hold `(m, 0)` at `c`, unless `c > b`. An empty witness has a relation instead, which must lead from `(0, 0)` to an accepting state of `a`.

A dead summary never removes an item, its advances or its conditions. The item still blocks omissions as §4 says. The summary only decides whether a completed item can be a witness.

The number of summaries of one raw item depends on the candidate's group sizes at the item's ends. It does not depend on the witness's own groups. The grammar alone does not bound it, because a larger candidate group can need more summaries. Different close observations never merge into one captured value. Equal observations can share proof states, while their derivation edges remain distinct.

A caller consumes a constituent in a rule occurrence. An observed caller retains its item's closes for either restoration method. A capture or an enclosing observed caller can demand those closes. The recognizer separates ordinary and observed caller modes. Prediction and completion keys retain that mode. A demanded capture can observe a rule without splitting unrelated callers of that rule.

An implementation can test possible first terminals before it retains a capture's close sequences. If no witness can begin at that token, the capture's own query needs no close observation. An enclosing observed capture still needs every close inside that capture.

This shortcut requires a nonempty capture with no possible leading omission. An empty witness prevents the shortcut. Conditions can reduce the possible prefixes, so this test ignores them. The query still uses its original context and written-terminator priority.

A ranked group contributes one opaque block outside its options. The block identifies its written occurrence, original span, and common entry observations. It excludes the option index, private captures, private closes, and proof identity. Wrappers and outside captures retain the block. Empty completed options also supply a block.

An aligned witness must carry that same block through the same written group occurrence. It cannot replace the block with unrelated syntax or finish inside it. Compare original positions and common entry observations, rather than unrelated runtime parser identifiers. Every proof represented by one block supplies the same outside answer. The query does not ask admission which option wins. Private captures inside an option retain their own real observations for ready conditions.

Candidates and aligned witnesses use finite noncyclic observation proofs. Named-rule cycle exclusion uses original positions, including during restoration. A repeated named rule over one original span supplies no additional aligned observation. Synthetic positions and different observations cannot excuse that cycle. Ordinary unmarked queries keep their proof policy.

The engine shares candidate and witness proof states with their relevant cycle contexts. It cannot enumerate every complete tree before evaluating a captured condition. It cannot impose an arbitrary limit on restoration length. Nullable recursive omission lists, such as `r → r [+T] | X`, must reach a finite shared construction.

### 4.2 Boundary obligations

`$x.followed-by(S)` and `$x.preceded-by(S)` are boundary atoms (§10). Their target `S` is one name or a choice of names, each a rule or a tag terminal. `🆓` is a rule name (§2), so it can be a target, and its node is its constituent. A forward target is a name in the target of a `followed-by` atom in a `%conditions` list of the stage. A backward target is a name in the target of a `preceded-by` atom there. An atom in an emission item's tag clause makes no target of either kind, because it reads the chosen derivation after the parse.

Only conditions in active lowered productions supply these targets. Feature selection, capture applicability and presence simplification determine which conditions remain (§3.6). A dropped condition supplies no target, including one that simplifies to true. Applicable conditions deferred to active ranked options also supply targets. Disabled alternatives supply none. An active production supplies targets even when recognition never reaches it on the current input.

A node of a derivation is a node of its tree (§12), other than an `elided` node. A rule node's name is its rule. A token node's name is the terminal that read it, without its test. A node counts for an atom only when its span is nonempty. Its first token and its last token are the first and last stage-input tokens of that span.

Let the receiver span `[a,b)` in derivation D. `$x.followed-by(S)` is true when `b < N` and D has a counting node of a name in `S` whose first token is `b`. `$x.preceded-by(S)` is true when `a > 0` and D has a counting node of a name in `S` whose last token is `a−1`. Otherwise each is false.

A condition item holds at most one atom (§9.3). A choice of names is one atom. Its value in D is its value under §10, with the atom's value in D. A derivation counts only if every condition item in it holds. This filter applies before ranked admission and ranking (§6). It applies to the counted derivations of a stage, to query witnesses, and to the derivations of §7.

The recognizer cannot know the atom's value at the step that makes the item ready (§4). So the step evaluates the item twice under §10, once with the atom true and once with it false. Each evaluation stops where §10 stops. If either evaluation raises a grammar error, the step raises it, as any condition does. Otherwise the step reduces the item:

- If both evaluations give true, the item holds, and no literal remains.
- If both give false, the item fails.
- Otherwise a literal remains. A literal is the atom's direction, its target and a sign. It is positive if the item holds where the atom is true, and negative if the item holds where the atom is false. The literal becomes an obligation of the step's resulting item.

An evaluation that reaches an invalid restored observation is false for that assignment alone. It does not discard the other assignment.

A pending literal counts as holding for the rest of its step. So the step evaluates its later condition items and its tag term in the order of §4. A failure there drops the resulting item with its obligations. A grammar error there is raised at the step. A later step over the resulting item runs as usual, and its grammar errors are raised too. Errors therefore follow the steps that run, not the order of D.

Two literals are equal when their directions, targets and signs are equal. Each literal also carries an annotation, the set of rule and condition index pairs whose items produced it. The annotation is not part of the record. When two items merge, or a literal joins an equal one, their annotations join. The annotation serves only the `boundary` member of a rejection. A target is equal to another when it holds the same names.

An item carries a boundary record, which is part of its identity. Two items merge only when their records are equal. Proof edges stay within one record. Records hold literals, and offers of targets only.

The record of an item that has read no nonempty symbol is one set, its pending literals, which stand at its origin. The record of any other item has four parts:

- Its start literals stand at its origin.
- Its first offers are the forward targets among the names of its counting nodes whose first token is at its origin.
- Its end literals stand at its position.
- Its last offers are the backward targets among the names of its counting nodes whose last token is just before its position.

A forward literal is a literal of a `followed-by` atom, and a backward literal one of a `preceded-by` atom.

To meet a set of literals with a set of offers, take each literal that has a name of its target among the offers. A forward literal looks among the first offers, and a backward literal among the last offers. Such a literal leaves the record. A positive one is satisfied. A negative one fails, and the step drops its resulting item.

To settle a set of literals, decide each literal that remains. A positive one fails, and the step drops its resulting item. A negative one is satisfied.

Each step applies these rules after the order of §4, which they extend. A token read is an advance over a nonempty constituent whose record has no literals. Its first offers hold its terminal if the terminal is a forward target. Its last offers hold its terminal if the terminal is a backward target.

1. Before an advance over a receiver `$x`, a backward obligation on `$x` joins the item's literals at its position. The advancing item can be a named item or a helper item, such as the helper of a ranked option with a private receiver. These are its pending literals if it has read no nonempty symbol, and its end literals otherwise. After the advance, a forward obligation on `$x` joins the item's literals at its new position in the same way.
2. An item advances over an empty constituent E. If the item has read no nonempty symbol, E's pending literals join the item's pending literals. Otherwise they join the item's end literals, and the backward literals among them meet the item's last offers. In both cases the item's own literals stay as they are, so they reach the next nonempty constituent.
3. An item that has read no nonempty symbol advances over a nonempty constituent C. The forward literals among the item's pending literals and C's start literals meet C's first offers. All of these literals that remain become the item's start literals. C's first offers become the item's first offers. C's end literals and last offers become the item's own.
4. Any other item advances over a nonempty constituent C. Let P be the item's end literals with C's start literals. The forward literals of P meet C's first offers, and the backward literals of P meet the item's last offers. Then P is settled. C's end literals and last offers become the item's own.
5. A nonempty item of rule R completes. If R is a forward target, it joins the first offers. If R is a backward target, it joins the last offers. The forward start literals meet the first offers, and the backward end literals meet the last offers. Then the obligations on `$` join: backward ones the start literals, and forward ones the end literals.
6. An empty item completes. The obligations on `$` join its pending literals.

A ranked helper can evaluate a condition owned by an enclosing group. It keeps the ordinary evaluations and their error order. It introduces a whole-rule literal only when the written condition reads a private capture that its group binds, including an absent descendant capture. Determine that ownership before capture-presence simplification. A nested helper never moves an enclosing group's literal to its own start. A common whole-rule condition introduces its literal at the named completion.

A completed `text` item that spans the input settles all its literals: its pending literals, or its start and end literals. A nested query settles its witness root's remaining literals in the same way before it counts the witness. An inner completion can receive boundary offers from its ancestors. The witness's span stands in for the input. In an aligned query, the witness reads restored terminators as synthetic tokens (§7). Its atoms read projected spans, as §7.5 says for the check.

A synthetic read has an empty projected span, so it gives no offer and makes no node count.

The chart of §4 holds exactly the items that these rules keep. Written-terminator priority, eligibility, the rejection position and ranked admission read that chart. So the meetings of rules 2, 3 and 5 are part of the result, not an optimization. An item that a meeting drops never blocks an omission, for example. An item whose obligations are still pending is in the chart, and it blocks as any item does.

The rules are exact. Let `p` be a boundary inside the input, and L the lowest node that holds the tokens on both sides of `p`. Every node that starts or ends at `p`, and every receiver at `p`, lies under L. C's first offers in rule 4 at L are all the forward targets that start at `p`. The item's last offers there are all the backward targets that end just before `p`. So rule 4 at L settles `p` with all its facts.

The root plays the part of L at 0 and at N.

Rules 1 to 6 raise no grammar error. They only drop items.

The records are finite, because they hold sets of targets and literals. Let K be the number of records that the grammar allows. Records multiply the items of a recognition by at most K, and its proof edges by at most K². This bound covers only the work that records add.

The structural states and close observations of §4.1 keep their own growth, which can be exponential in the input.

An implementation must not limit the number of records.

Offers resemble the first-path and last-path observations of §4.1. They differ in two ways: they skip nodes that read no token, and they do not stop at seals.

An obligation that drops an item makes a dropped item. A rejected input reports the furthest position of a live item, as above. If a dropped item reached that position or a later one, the error also names its failed obligation in the member `boundary` (`docs/output.md`).

Among several, the first is the one with the least boundary. Then comes the earliest rule in expanded order (§2.3). Last comes the least condition index. That index counts the rule's condition items from 0, through its definitions (§2) in source order, so an extension's items follow the base rule's.

The audit (`docs/design.md`, "Diagnostics and debugging") adds one note kind for atoms. A query reaches a rule when its rule argument is that rule, or when a body reference of a reached rule names it. Each stage's audit lists every reached rule that holds a boundary atom in a `%conditions` list. Each entry names the rule and the definition that holds the query.

A second note names each target that no derivation of `text` can build, only a query witness, with the atom that names it. Neither note is an error. The loader and the parser never report them.

### 4.3 The shared memo

A shared memo keeps ordinary query answers across parses. This cache is optional. Section 4.4 describes suffix sharing within one parse.

One shared memo serves one stage of one loaded dialect, lowered for one set of features that are on. It also has that lowering's resolved classifiers (§2) and the dialect's Unicode table. Together these fix every input of a nested query except its content (§4). Two feature sets can share one memo where they turn on the same gates. These are the gates of alternatives (§3.1) and the gates of classifier entries. A feature that gates nothing changes neither.

The loaded dialect owns its shared memos, and a memo lives no longer than its dialect. Two loaded dialects never share a memo, even where they read the same documents. A memo goes with its lowering, so an implementation keeps no more memos than lowerings. The reader of the notation (§8) has grammars of its own, and their memos follow the same rules.

A conditional `%features` declaration (§13) holds or fails before its stage parses. The features it turns on select that stage's lowering, and so its shared memo. So the key needs no part for them.

`until` and `elision-only` leave the answer of an ordinary query unchanged. A query keeps its caller's lowered grammar and reads only its own span. The check of §7 starts its ordinary queries over the stage's own input, with the main grammar (§7.6). So the key needs no part for these options either.

The shared memo holds only ordinary queries with a key of content. A key of position names a place in one input, so it stays in the memo of one parse. An aligned query also stays there, since its key holds observations of one parse.

A shared key holds what the content key of one parse holds, with each token's tags by name. So it holds the query kind and the rule. It also holds the original text over the source of the span. For each token of the span, it holds the tags, text, value, image, and the source offsets, counted from the start of that text.

`matches` and `tags` share a kind. `begins` and `ends` have separate kinds.

Only a nested parse that completes leaves an entry. A parse that ends in an error of the grammar leaves none, so every parse that meets the error finds it again. An entry for `matches` and `tags` holds whether the span is accepted, and the names of its tags.

An entry for `begins` holds whether a prefix is accepted. An entry for `ends` holds whether a suffix is accepted. A choice of targets (§10) keeps one entry for each rule target. A terminal target reads its token directly and keeps none.

A shared memo must never change a result. A warm shared memo holds entries from earlier parses. A parse with a warm shared memo gives exactly the result of the same parse with an empty one. This holds for every order of parses, and for parses that run at the same time on other threads.

With the inputs of one memo, a nested parse of one content asks the same queries in every parse, and gives the same answer. Aligned queries are the exception, since they depend on the stack of active queries (above). So an answer stays out of the shared memo where its nested parse, at any depth, asks an aligned query. It also stays out where that nested parse reads such an answer from the memo of its parse. Every other answer depends on its content alone, so a shared answer is the answer that its nested parse computes. A query with a key of position inside it changes nothing here, since its answer also depends on its content alone.

A shared answer also never hides an error. The shared memo serves no answer while an aligned query is active. Then every active query is ordinary, and its context is its span. A nested parse asks only about parts of its context.

Take an active query, and a later query inside it with the same rule and span. Every query between them is over that span and reads its content. By the premise above, the later query then asks the same chain again, and so it asks about itself. No parse completes such a query, so the shared memo never holds one.

An aligned query has the context `[a,N)`, which can run past its span. The argument above does not cover a query asked while an aligned query is active. So the shared memo serves no answer then. It still keeps the ordinary answers computed in that time.

A shared memo keeps its entries in two generations, a newer and an older set of entries. A lookup reads the newer generation, then the older one. An entry found in the older one moves to the newer one. Before an entry enters the newer generation, by an insertion or by that move, the memo makes room. Where the newer generation already holds the bound, the older one is dropped, and the newer one becomes the older one. This drop is eviction.

A key that the newer generation holds does not enter it again. Eviction can happen during a parse. It only decides whether a later query runs its nested parse again. This is the scheme of the libraries. Any other bounded scheme also keeps every result.

The Go, JavaScript and Python libraries bound each generation at 8,192 entries. The recorded measurements parse single words to the forms stage of the bpfk dialect, once for each bound. In JavaScript, a bound of 8,192 entries saves about 90% of the time that 32,768 entries save. In Python, 8,192 entries save no more time than 4,096, and add about a third of the memory that 32,768 entries add. Go has no measurement of bounds. The Rust library keeps no shared memo.

An entry never changes after it enters the shared memo. Parses on several threads can share one dialect. Each lookup is then one atomic step, with its move and its eviction. So is each insertion, with its eviction.

### 4.4 Backward token queries

Let the current input context be `[c,d)` and the receiver's projected span be `[a,b)`. `s.preceding-tokens` returns the ordinary span `[c,a)`. It is empty when `a=c`, including for an empty receiver there. A restored receiver first projects to original tokens and loses its restoration constraints.

The context is the stage input or the input window of the current nested query. A backward query inside a forward query cannot see tokens before that forward query's start. `.last-token` retains its ordinary meaning. Thus `$x.preceding-tokens.last-token` is the token immediately before `$x`, within that context.

An ordinary `s.ends(R)` recognizes the fixed window `[a,b)`. It permits a target root at every boundary `k` with `a≤k≤b` and requires its completion at `b`. Conditions of every candidate use the same context `[a,b)`. No candidate receives `[k,b)` as a new context.

The method holds when some permitted completion has an eligible proof tree. A nullable target can supply the empty suffix. A user-tag target tests the last original token and fails on an empty receiver. Target choices retain written-order evaluation and error behavior.

```jbogenbau
%rule start-a
  "a"
%conditions
  $.starts-input
```

On the two tokens with values `b` and `a`, `.ends(start-a)` is false. The target starts after the fixed window's beginning. Parsing the final token alone with `.matches(start-a)` instead holds.

All target starts belong to one recognition computation. Written-terminator priority and finite eligible proofs follow §4. Ranked admission, rule flags, and stage preferences do not rank query proofs.

The query selects no longest suffix. A grammar error reached by that computation remains an error even when another suffix succeeds. Within one shared recognition, an error first raised at input boundary p fails its requests ending at p or later. It does not fail a request ending before p.

`.ends` requires a capture or ordinary span. A restored receiver causes a load error, including after `.onward`, which preserves restoration. This includes `.without-elision-except(F)` views. Restored suffix queries can be added when a grammar needs them.

A span method that drops restoration can supply an ordinary receiver. For example, `$x.without-elision.preceding-tokens.ends(R)` queries the raw prefix. It applies no suffix alignment constraint.

Query answer keys distinguish suffix mode from whole and prefix modes. They include the target instance and fixed window. The active-query identity remains the target and projected context interval, across `matches`, `begins`, `ends`, and `tags`. Changing direction cannot evade the recursive-query error.

Requests with one lowered target and window start share recognition when that target reads no window end. The shared recognition starts the target at every position from that window start. It retains one answer for each requested end boundary. The total cost is that recognition, including its nested queries, plus constant work per request. Complex targets can cost more than linear time even with sharing.

A target reads the window end when its recognition evaluates `.onward`, `.following-tokens`, `.ends-input`, or `.followed-by`. This includes conditions and tag terms of rules reached through body references. A target also counts as reading the window end if its recognition contains a nested query with a restored receiver. This rule includes restored queries at any nesting depth. An ordinary nested query target uses its own window end. Its end-reading methods alone do not create this outer dependency.

Written-terminator priority uses only blockers that complete within the requested window. Shared recognition therefore decides eligibility separately for each end boundary. A later blocker cannot change an earlier retained answer. Errors retain the boundary scope defined above.

A target that reads the window end requires separate recognition for each distinct end. Its errors retain the complete window identity and never propagate to a different window. Repeated requests for the same window can reuse its answer. Use `.ends` sparingly because complex targets can require more than linear work.

## 5. Values, images and text

A token's `value` is its comparison string and its `image` is its visible string. The stage fixes both when it emits that token. Recipes select the strings through §11, with plain concatenation as the default. Tags never supply strings.

- A selected value recipe supplies the token value and its implied image, unless a stronger explicit image recipe applies (§11).
- A channel without a selected recipe concatenates non-erased child contributions in order. The string walk enters child constituents but never executes their emission lists.
- A stage-zero token has its decomposed scalar as both strings (§1). A caller-supplied token defaults each omitted string independently to its text. It carries no supplied attachments.

Default images preserve decomposition, rather than original spelling. For example, `≇` has image `≅` followed by U+0338. Its `text` remains `≇`. An explicit image recipe can select `.source-text` or `.verbatim-text` to preserve original spelling.

The value and image joins concatenate each channel's parts in order, without trimming or merging. Empty strings contribute no characters but remain counted parts for ownership. A pause contributes the value and image that its grammar supplies. The engine knows no pause character or spacing rule.

A recipe can preserve every character inside its result. A verbatim image such as `a... b` remains that complete string. No join inspects its periods or spaces.

The channels are independent. An explicit image recipe can suppress descendant image recipes while value concatenation still enters those descendants. An empty body contributes empty strings by default. Neither an empty image nor an empty value erases counted input parts.

An inserted `ε` token has no input parts. Its default strings are empty, and its item recipes can supply either channel. `ε :: ∅ := "'"` inserts an apostrophe as value and image. The token retains empty source text and the inserting rule's name.

Every emitted token stores a value and image, including empty strings. Stage-zero tokens store both too. Empty tag sets are legal. Implications alter tags without changing strings. No tag-to-string mapping exists.

`span.value` in a condition concatenates original input values without normalization. `span.image` concatenates original images. Both include erased input and ignore the chosen current-stage derivation. The engine supplies no lowercase mapping or comma removal. The [dialect guide](dialects.md#phoneme-values-and-stress) describes the bundled comparison policy.

The input value keeps every character that its tokens store. A grammar can supply different value and image strings through recipes. Those mappings belong to the grammar, not comparison behavior.

Every comparison is exact.

`span.source-text` is the original text over the source of the span's tokens (§1), and the empty string for an empty span.

`span.decomposed-source-text` is the canonical decomposition of `span.source-text`, by the algorithm of §1 and the configured Unicode table. The source text is decomposed alone: each scalar becomes its decomposition, and each run of marks of nonzero combining class is sorted by class. It is the empty string for an empty span. Where the span covers whole clusters, it equals the concatenation of the stage-zero values over the span's source.

In §7, `.value`, `.image`, `.source-text`, and `.decomposed-source-text` read projected original tokens. Synthetic tokens add no input string or text. Terminal tests can read their saved recognition value, while omitted pattern leaves always observe empty strings.

## 6. Choosing a parse

Section 6.1 admits derivations before this ranker when a ranked group can apply. This ranker is the same either way.

A stage ranks its admitted derivations (§6.1). A flagged occurrence is a flagged rule's constituent. A rule profile has two parts. Its span vector counts `leftmost-longest` occurrences over nonempty spans. Its fewest count is the number of nonempty `fewest` occurrences.

`leftmost-longest` compares complete parses by span vectors, with earlier starts first, longer spans next, and larger counts preferred at the first difference. With equal span vectors, the smaller fewest count wins.

One rule profile is greater than another when it wins this comparison. Equal span vectors and equal counts make equal rule profiles. Every passage of this document that compares rule profiles, or calls one greater, uses this order.

All `leftmost-longest` rules contribute to the span vector together, and all `fewest` rules to the count. Neither part gives priority by name, declaration order, production number, tags or source. Equal spans count separately, including nested occurrences. Each nonempty occurrence of a flagged rule counts, including each named chain level and each constituent with one symbol. Empty occurrences contribute nothing, and helpers carry no flags. Both flags rank before the stage directive.

An empty `fewest` occurrence adds zero to the count. During reconstruction (§7), an occurrence that reads only synthetic tokens remains empty after projection and also adds zero.

Of two derivations with different rule profiles, the one with the greater rule profile beats the other. Of two with equal rule profiles, the one that the directive prefers beats the other. A derivation is best if no other derivation beats it.

The directive (§2) is `greedy`, `lazy` or `late-elision`. The verdict is one of these:

- `unique` if the input has one derivation
- `resolved` if it has several, and exactly one of them is best
- `tie` if two or more derivations are best

Under `unique` and `resolved`, the chosen derivation is the one best derivation. Under `resolved`, it beats every other derivation (below). A tie is an error, and the stage then has no chosen derivation. The production numbers of §3 never decide which derivation a stage chooses.

For N input tokens, the pairs of boundaries are `0 ≤ p < q ≤ N`. `G_D(p,q)` counts D's `leftmost-longest` occurrences over `[p,q)`. Every nonempty such occurrence contributes once, however many symbols its production has. `F_D` counts D's nonempty `fewest` occurrences.

Compare components by increasing p and, within one p, decreasing q. At the first differing count, the greater count wins. With equal vectors, the smaller `F_D` wins. Equal vectors and equal `F_D` give equal rule profiles. Every two rule profiles are equal or one of them wins. Distinct derivations can share one rule profile.

Only a `leftmost-longest` occurrence makes a component nonzero. A sparse map stores only nonzero components. A shared sorted list with one entry per occurrence is another representation, since equal spans count separately. With no flagged rule, one shared zero profile serves every derivation, with a zero count.

A `leftmost-longest` occurrence beats its absence, and equal spans count separately. A `fewest` occurrence loses to its absence, among equal span vectors. With no flagged rule, every rule profile is zero, so the directive alone ranks.

The stage retains every derivation with the greatest rule profile before applying its directive. The admitted total, before rule-profile selection, determines `unique`. The remaining comparison of actions and elisions applies within that retained forest.

A derivation is read as its sequence of actions in bottom-up order. An action is a read of a token as a terminal, or a close of a production over a span. Closes of helper productions and of productions with exactly one logical symbol are transparent. They are part of the sequence, but two sequences never differ at one. The other actions are visible.

So the closes of flat braces are transparent. The close of a chain's level is visible where its production has more than one symbol (§3.3).

Two reads are the same action when they read the same token as the same terminal. Two closes are the same when they close the same production over the same span.

Transparency removes a close from the comparison, but it does not merge derivations. Two derivations that differ only at transparent closes are still two derivations. With equal rule profiles, `greedy` and `lazy` tie them. Under `late-elision`, their counts of elided terminators still decide (below).

For example, `text → [[X]]` derives the empty input in two ways. The outer helper derives ε itself, or through the inner helper. `text → [A] & [B]` derives it in three ways, through the expansions of its `&` (§3.2). These use `[A]` alone, `[B]` alone, or both. All have the same empty tree, and all three ranking rules report a tie. The error of such a tie can carry two equal trees, while its witness names two different productions.

`text → [[+KU]]` also derives the empty input in two ways. The outer helper is empty, which elides nothing, or the inner one is, which elides `KU`. Their vectors are (0) and (1). So the input ties under `greedy` and `lazy`, and it is `resolved` under `late-elision`.

The engine does not merge derivations whose trees are equal either. Such derivations can still differ in what the stage does with them. Two definitions of `text → A` give equal trees, but their emission clauses can emit different tokens. Their alternatives can also differ in their warning guards, or in their recipes.

Under `greedy` and `lazy`, the stage compares two derivations of the same input at their first differing visible action:

1. If both read the same token as different terminals, they are tied.
2. If one reads and the other closes, `greedy` prefers the read, and `lazy` the close.
3. If both close, with different productions or different spans, they are tied.

If the visible sequences are equal, or one is a proper prefix of the other, the two are tied. For the witness below, their first difference is the first pair of differing actions of the whole sequences, transparent ones included. A derivation whose visible sequence is a proper prefix of the other's differs from it where the shorter ends.

Among equal rule profiles, a ranking with no lean compares two derivations in the same way, but rule 2 ties them too. Any two remaining derivations that differ are tied. The check of §7 uses no lean after rule profiles. So do the readings of a tie under `late-elision` (below). A directive cannot name it. In the check, a restoration is a read of its synthetic token and then the close of its empty production (§7.4, §7.7).

Among equal rule profiles, `late-elision` compares only the elided terminators (§4). Let the input have N tokens. A boundary is a position from 0 to N. The elision vector of a derivation has one component for each boundary. The component at boundary `p` is the number of the derivation's elided terminators at position `p`.

The vector counts each elided terminator once, whatever its terminal or depth. So two terminators elided at one position count two, also when they are of different terminals. An ordinary empty optional, such as an empty `[{x}]`, and a close of any other production count nothing.

The markers of §3.8 alone decide what counts. They also decide which empty optionals become `elided` nodes (§12) and what §7 restores.

An optional that is not elidable (§3.8), such as an optional separator, can still be empty. Its absence counts nothing and leaves no node. The ranking knows no particular terminal. A grammar that excludes a separator from the count writes it as a plain optional, `[CU 🆓]`.

Among equal rule profiles, `late-elision` prefers a derivation whose elision vector is less. The stage compares two vectors from boundary 0 to boundary N. At the first boundary where they differ, the vector with the smaller count is less. Derivations with equal rule profiles and equal elision vectors tie, even where their trees differ. Without flagged rules, several derivations that elide nothing always tie.

The same comparison can be read as actions. Project a derivation's sequence of actions in this way:

- A close of the helper of an elidable optional that derives ε becomes `elide(p)`, where `p` is its position.
- A read of token `p` becomes `read(p)`, whatever the terminal that reads it.
- The projection drops every other close, and it ends with `end(N)`.

At the first differing pair of projected actions, `read(p)` and `end(N)` beat `elide(p)`. Two `elide(p)` actions at one boundary are equal, as are two reads of one token. Each elided terminator adds its own `elide(p)`, and the projection never merges equal actions. So two elisions at `p` lose to one, because the second `elide(p)` meets `read(p)` or `end(N)`. In plain words, at the first place where two readings differ in leaving out a terminator, `late-elision` prefers the reading that reads on.

So under `late-elision`, a token read as two terminals does not stop the comparison, as rule 1 does. Two different closes do not stop it either, as rule 3 does. The preference does not depend on the age, the nesting or the name of a terminator.

The stage puts the derivations in a canonical order, *T*. *T* orders the ambiguity diagnostics. The canonical tie-break keys never turn a tie into an accepted reading. First, *T* puts greater rule profiles before lesser ones. Within an equal rule profile, `greedy`, `lazy` and no lean compare visible sequences:

- *T* compares them at their first differing visible pair, by rules 1 to 3 where those decide, and otherwise by the canonical keys. The canonical keys put a read before a close. They order two reads by terminal, in code point order. They order two closes by production number, then span start, then span end.
- If one visible sequence is a proper prefix of the other, the shorter comes first.
- If the visible sequences are equal, *T* compares them at the first differing pair of the whole sequences, by the canonical keys. If one whole sequence is a prefix of the other, the shorter comes first.

Within an equal rule profile, `late-elision` compares elision vectors in *T*, the lesser first. It orders two derivations with equal vectors as it does under no lean.

*T* compares rule profiles, then elision vectors under `late-elision`, then visible sequences and whole sequences. So it is a total order. The first reading, `m`, is its least element, whatever the verdict.

Every derivation that beats another precedes it in *T*. This holds for a greater rule profile and for the directive's preference within equal rule profiles. Nothing precedes `m`, so nothing beats it. So `m` is best.

A distinct derivation `d` is tied with `m` when `m` does not beat `d`. So `m` is never tied with itself. Under `greedy` and `lazy`, a best derivation other than `m` is tied with `m`, since its first difference with `m` is a tie. The converse does not hold. Under `late-elision`, the derivations tied with `m` are exactly the other best derivations.

For example, take `text → A C D | p D | B q`, `p → B C` and `q → C D`, over the tokens `A B`, `C` and `D`. Under `greedy`, `m` reads the first token as `A`. The derivation through `p` is tied with it, but loses to the one through `q`, which reads `D` where it closes `p`.

Of the distinct derivations tied with `m`, the second reading is the one that diverges from `m` earliest. It has the fewest visible actions before its first visible difference with `m`. A derivation whose visible sequence is a proper prefix or an extension of `m`'s diverges where the shorter ends. One whose visible sequence equals `m`'s diverges last. Several that diverge at the same point are ordered by *T*. That derivation, `t`, is best.

Since `m` does not beat `t`, both have the same rule profile. A derivation with a greater rule profile than `t` also precedes `m` in *T*. Nothing precedes `m`, so no such derivation exists.

Under `late-elision`, `t` is best because its rule profile and elision vector equal those of `m`. Under `greedy` and `lazy`, the proof is as follows. Suppose that another derivation beats `t`. It is not `m`, since `m` does not beat `t`.

If it beats `t` before `t` diverges from `m`, it beats `m`, which nothing does. If it beats `t` later, it shares `t`'s divergence from `m`. If it beats `t` exactly where `t` diverges, it beats `m` there too, or it is tied with `m` there. This is because an action that beats one tied with `m`'s cannot lose to `m`'s. Either way, it is a distinct derivation tied with `m`, diverges no later than `t`, and precedes `t` in *T*.

So the verdict is `tie` exactly when some distinct derivation is tied with `m`, and then `m` and `t` are two best derivations. Otherwise `m` beats every other derivation, and it is the chosen derivation. In the example, `t` is the derivation through `q`, and the verdict is `tie`. It shows the first point at which the text can be read another way. The witness is the pair of actions at the first difference between `m` and `t`, visible if there is one. It compares the actions themselves, under every rule, and not their projections.

Neither action of a witness is ever missing. Two distinct derivations of one span both end with the close of their root. So neither sequence of actions is a proper prefix of the other, unless a derivation is cyclic, and a cyclic derivation does not count. A library that finds a missing action has a defect, and it fails rather than report one.

A tie is not a success. The result is an error of kind `ambiguous`, with the reason `tie`, and `ok` is false. The error carries two readings, `m` and then `t`, each as a tree (§12). The result's `tree` is null. The stage keeps its verdict and its witness. It has no chosen tree, no output (§11) and no warnings (§12), and no later stage runs (§13).

A stage takes its steps in this order. It recognizes its input (§4), and it ranks the derivations. If the verdict is `unique` or `resolved`, it emits its tokens (§11), and then it runs the check of §7 if that applies. A tie ends the stage at the ranking, so neither emission nor that check runs. An error of the grammar found while emitting ends the stage before that check. The check can end the stage with an error of kind `ambiguous` (§7.10) or `grammar` (§7.7, §7.9).

Every ranking rule composes over the packed forest. The packed forest is the shared graph of all derivations of the input, and its nodes are the recognizer's items (§4). An implementation represents derivations through shared summaries and does not need to enumerate them.

An edge of an item is one step by which the recognizer makes it. A start edge predicts an item with its dot at the start, and it combines nothing. A read edge advances an item over a token that its next terminal reads. A completion edge advances an item over a completed item of its next symbol. A read or completion edge has two children: the item before the step, and the token or completed item that the step reads.

A cycle context records ancestor rules over the same span. The context of a child is its cycle context under every ranking rule.

A child cannot reuse an ancestor rule over its own span, or the derivation is cyclic (§4).

Only a rule that can complete again below the child over that span matters. Such a rule is reached from the child's rule through constituents over the same span, and it reaches that rule back in the same way. Such rules form the cyclic group of the child's rule. An implementation can leave every other rule out of the context. Two contexts that differ only in rules that it leaves out give the same summary.

A summary describes the derivations of one item in one context. So an implementation keeps one summary for each combination of item and cycle context that some edge needs. The cycle context is reduced as above. This reduction removes context differences caused by ancestors outside the child's cyclic group. Different ancestor sets within that group can still need different summaries. Two summaries of one item can differ, and a summary keyed by the item alone can lose a reading.

For example, take `text → b | a`, `a → b` and `b → a | A`, over the token `A`. The input has two derivations that are not cyclic, through `text → b` and through `text → a`. With equal rule profiles, they tie under every stage rule. Beneath `b` over the same span, `a` has no derivation that counts, since `a → b` repeats `b`. Directly under `text`, `a` has one, so a summary of `a` that ignores its context loses a reading of the root.

The derivations of the input are those of every completed item of `text` that spans it (§4). The implementation combines the summaries of all these items as the edges of one root.

Under every ranking rule, the verdict needs the total, the number of admitted eligible noncyclic derivations, capped at two. Within one edge, the totals of the children multiply. Over the edges of one summary, the totals add, for every edge that the context allows, losing ones included. The root combines its items in the same way. A total of one is `unique`.

The implementation can keep the total in each summary, or compute it apart with the same rules. Either way, it computes the total before it drops any losing edge. A ranking of the best derivations alone cannot give the total.

A rule profile composes by addition, in each of its parts. An edge adds its children's rule profiles and its own completed nonempty flagged occurrence, if any, to the part of its flag. Adding a common rule profile preserves comparison and equality. Each summary retains its greatest rule profile and every edge that attains it, with the same cycle context. The total remains separate from the count of best derivations.

For `greedy` and `lazy`, the action summaries of this section run over the forest of greatest rule profiles. For `late-elision`, each summary compares one key, the pair of its rule profile and elision vector. Compare the pair by its rule profile first, with the greater rule profile preferred. Within an equal rule profile, prefer the lesser elision vector. The count of preferred derivations and the retained edges follow this pair. Diagnostic selection uses no lean over the retained forest.

Under `greedy`, `lazy` and no lean, both `m` and the earliest-diverging tied derivation compose over the retained forest. An implementation keeps, in each summary, its *T*-least derivation and the earliest-diverging derivations tied with it. It keeps several candidates side by side while their order is not yet settled, since what follows decides. Their order is not settled while one's visible sequence is a prefix of another's. It is also not settled while their visible sequences are equal and one whole sequence is a prefix of the other.

One candidate can beat another under `greedy` or `lazy`. Then the loser's tied derivation stays tied with the winner exactly when it diverged from the loser before the point where the winner beat it. One that diverged there is beaten there too. So the number of derivations, which can be exponential, never matters.

Under `late-elision`, elision vectors compose by addition. The vector of a derivation through an edge is the sum, component by component, of the vectors of the derivations of its children. A completed helper of an elidable optional that derives ε at `p` has the vector that is one at `p` and zero elsewhere. Adding one vector to two others keeps their order. Adding a common rule profile also keeps rule profile order. So in a best derivation, each child has the best rule profile and elision pair that its context allows.

The best count counts derivations attaining this pair. The count stops at two. A `late-elision` summary holds its best rule profile and elision pair and its best count. Within one edge, the children's rule profiles and elision vectors add, and their best counts multiply. The edge adds its own completed occurrence and elision, if any. Over one summary's edges, keep the preferred pair or add best counts where the pairs are equal.

The root compares its items by the same rule profile and elision pair. A total of two with a best count of one is `resolved`. A best count of two is a tie. This holds also when two items of `text` each have one derivation with the same best pair.

The best derivations form a smaller forest. For each summary, the implementation keeps the edges that attain its best rule profile and elision pair. Each kept edge leads to the summaries of its children, in their own contexts. The stage finds `m` and `t` by a ranking with no lean over that forest. That ranking keeps the same contexts, so it reaches a child only through the summary that its context allows.

A vector has N + 1 components. So a sparse vector, or a shared sequence of elisions, keeps the cost of each addition and comparison small.

Structural state forms part of each summary's item identity. Ranked admission keeps eligibility and same-span cycle contexts separate (§6.1). A summary cannot substitute an edge from another structural state. Count admitted eligible noncyclic derivations before ranking, capped at two. Equal observations do not reduce that count. Rule profiles and elision vectors compose within each full state and context.

For k independent Boolean observations, a product can contain up to `2^k` states. Sequence prefixes and captures add further factors. Finite sharing does not imply constant memory use.

### 6.1 Ranked admission before ranking

Ranked admission filters derivations at each ranked group before the stage ranks complete parses.

Retain the raw chart and eligibility information. Admission removes forest choices without removing chart items or changing input queries. A later completion can provide an earlier qualifying option. Nested availability requires admitted finite child proofs.

A prefix context records state before a ranked group. An admission instance is one written ranked group in one prefix context. Each physical span in that instance has a separate admission group. Its key contains these components:

| Component | Required equality |
| --- | --- |
| Recognition | Input recognition, selected features, and main, query, or reconstruction mode. |
| Source | Final stitched rule, alternative, and expression path. |
| Entry | Enclosing named invocation origin and control route to the helper entry. |
| Prefix | Complete common prefix recognition state at entry. |
| Span | Actual group start and end positions. |
| Eligibility | Written-terminator priority. |
| Cycles | Enclosing named-rule context for relevant spans. |
| Reconstruction | Strictness, restoration, and projection state where recognition depends on them. |

The prefix includes bound common captures, their values, structural state, and its boundary record (§4.2). Control positions refer to the common group entry. Generated helpers retain their written paths. Option indexes and generated option-production identities do not distinguish entry contexts.

The key excludes private captures, returned option tags, private pattern states, proof identities, and the option's open boundary facts. It also excludes omission vectors, flagged profiles, diagnostic ordering, and caller demand contexts. Equal-state prefix proofs remain distinct derivations for ordinary ranking.

An invocation is a recognition state, rather than a call-stack identity. Different callers share admission when all key components agree. Different continuations remain separate. Equal spelling at another location does not establish equal spans. Empty spans participate.

Compute the options with a qualified finite proof in each admission group. Keep a qualified proof unless a qualified proof from a higher option has dominating open facts, as defined below. With no qualifying option, the group supplies no completion.

A qualified proof also passes the step at its group: the advance of the enclosing item over the option's record by the rules of §4.2. Its open facts are what that advance leaves unsettled. For an option that reads no token, they are the option's pending literals that remain after that advance. For a nonempty option after a prefix that read a nonempty symbol, they are the option's end literals and last offers. For a nonempty option after an empty prefix, they are the option's whole record.

A higher option's proof excludes a lower option's proof in the same admission group only when its open facts dominate. They dominate when, at each edge, the higher proof's literals are a subset of the lower proof's, and their offers are equal. A literal is its edge, direction, target set and sign. The error annotation is not part of it. Wherever the lower proof survives, the higher proof survives too. An excluded proof therefore always has a replacement with the same continuation.

The test compares literals by identity. It can miss a logical implication between different literals. Then both proofs stay, and ranking decides. It never excludes a proof that full ranking needs.

For `a ≻ b ≻ c`, qualified `a` removes `c` when its open facts dominate, even when `b` is absent. Ordinary branches within one option share its index. A nested group finishes admission before its option supplies an outer witness.

A candidate must pass its tests and ready conditions in the requested eligibility and cycle context. A disabled feature, failed gate, or unavailable cyclic proof supplies no witness.

The summaries compose over admitted edges. Their totals count admitted derivations, capped at two, before rule-profile selection. Rank by rule profile, its span vector first and its fewest count second, then by the stage directive. With no flagged rule, the stage directive alone ranks admitted derivations.

Outside observations of either restoration method retain the same opaque group block for every option. Private captures keep their real closes only for ready conditions within the option. The admission key includes demanded common restoration observations and excludes all private closes. Thus an aligned outside condition gives the same answer for each admitted proof of one block.

Every proof that admission excludes has an eligible same-context replacement at the group. The seal and local tag rule preserve its common continuation. Induction through finite admitted child proofs preserves eligible recognition with sealing fixed. Adding a seal can change outside pattern answers.

[Ambiguity](notation.md#ambiguity) defines how filtering and seals affect results.

Let F count stored prefix facts, completion facts, proof edges, eligibility contexts, and their values. Sorting admission groups costs `O(F log F)` key comparisons. A group with g qualified proofs needs at most g² dominance tests. Each test compares literal bit sets and offer sets. Records bound the number of distinct open facts per group by the grammar's K (§4.2).

Admission composes over packed facts without complete derivation enumeration.

The tag closure uses linear work in productions and inheritance edges.

## 7. Elision-only

### 7.1 When the check runs

The check runs where the stage's verdict is `resolved` and the check is on. It is on where the stage's directive has `elision-only` or the caller asks for it. It runs after the stage emits its tokens (§6, §11).

A tie never reaches it, because a tie ends the stage first. It does not run for `unique`. An error of the grammar found while emitting ends the stage before it. A caller can switch the check off for a stage that declares it.

The check follows the decision order of §7.10. It chooses no replacement derivation and examines no other restoration.

The check uses the main parse's lowered grammar, features, classifiers, constants and Unicode table. It does not lower the grammar again, and it does not run earlier stages again.

Aligned queries reuse this section's synthetic-token representation and projection. They do not use its complete recognition policy. They preserve original query eligibility, forbid bare synthetic reads, and permit ordinary omissions beyond their fixed capture. They select no replacement tree and perform no elision-only ranking.

### 7.2 The two inputs

Let O be the stage's input, N tokens long. Here the input is what this stage reads: the output of the stage before it, or, for the first stage, stage-zero or caller-supplied tokens. Let G be the grammar lowered for the main parse, and D the chosen derivation.

Take D's elided terminators (§4, §12) in leaf order, from left to right. Keep this order for terminators at one position. Each one gives a restoration record. The record holds the terminal, its position `p` in O and the empty source of its elided node (§12). For a terminator with an `=` test, it also holds that test's string, its saved value.

The reconstructed input R is O with one synthetic token for each record. The synthetic token stands before the input token at `p`, or at the end for `p` = N. Records at one position keep their order. Every token of O stands in R once, in its order, with all its fields unchanged.

A synthetic token has recognition tags and a recognition value. Its recognition tags are its terminal alone. Its recognition value is its saved value, an exact string. Without a saved value, its recognition value is the empty string. Its synthetic image is empty.

A synthetic token has no attachments. It is not emitted, so no implication applies to it (§11). An original token's recognition tags and value are its stored tags and value (§5).

Each token of R has a provenance, which the engine keeps to itself. It is an original token, with its index in O, or a synthetic token, with the index of its record. Nothing else tells them apart. An earlier stage can emit a token with an empty span, an empty source, empty text or `insertedBy` (§11). Such a token of O is still an original token.

### 7.3 Projection

For a position `k` of R, from 0 to the length of R, π(k) is the number of original tokens before `k`. So π(0) is 0 and π of the length of R is N. π stays the same across a synthetic token and goes up by one across an original one. A span [a, b) of R projects to the span [π(a), π(b)) of O.

The recognizer reads R, and its items, spans and cycles are in positions of R. Every observation (§7.5) reads the projected span, in positions of O. A span of R that holds only synthetic tokens projects to an empty span at its position.

A projected span is a span of O like any other. Its text and value come from its own tokens, as §5 says.

### 7.4 The reconstruction mode

The check recognizes R with G in the reconstruction mode. The mode adds no productions and removes none. Every production keeps its number, its rule and its clauses. Only these steps differ from §4.

An elidable optional (§3.8) has a helper `h`. Its productions are the empty production `h → ε` and the productions of its content, each of which begins with the optional's terminal `T`. In the reconstruction mode, the helper reads in one of three ways, its routes:

1. The restoration. The empty production reads exactly one synthetic token, the one at its position. The token must be compatible with the optional.

   Its recognition tags hold `T`. The omission predicate must hold. Where T has a test, it must pass on the token's recognition value and recognition tags. The restoration is a read of that token as `T` followed by a close of the empty production over its one-token span.

   It has the tags of the empty production, which are none (§3.7). It evaluates nothing of the optional's content. The empty production never derives the empty sequence in this mode.
2. The written route from an original token. A production of the content reads its `T` from an original token, and then the rest of the production as §4 says. The rest can be empty.
3. The written route from a synthetic token. A production of the content reads its `T` from a synthetic token, which must pass `T`'s test as in the restoration. Then the rest of the production must read at least one token of R, original or synthetic. The item after `T` is strict (below). This holds whatever the strictness of the item that read `T`, and also where an ordinary prediction shares the item that read `T`.

Every production of the helper belongs to that elidable helper for the purpose of the routes, its content productions as well as its empty one. So a synthetic token followed by nothing else of the optional is always the restoration, and never a second derivation of the same omission. A synthetic token followed by more of the optional is the written route, which can read original tokens, later synthetic tokens, or both. An optional that is not elidable keeps its empty production as in §4. §3.8 alone decides which optionals are elidable, and this section does not change that.

A strict item never completes. A step whose additional item is strict and stands at the end of its production drops that item (§4). So route 3 never applies where the rest is empty. The recognizer decides once per grammar which productions and which symbols can read, with the routes of this mode:

- A terminal can read.
- A production can read where it holds a symbol that can read.
- The empty production of an elidable helper can read too, because in this mode it is the restoration, which reads a synthetic token.
- A rule or helper can read where one of its productions can read.

The sets of productions and symbols that can read are the least sets that these rules give. An implementation starts with nothing that can read and adds until nothing changes. So a rule that can read only through itself, such as `z → z`, cannot read. This ignores tests, conditions and the input. Every rule below that asks whether something can read uses this one definition.

A production's last reading symbol is the last of its symbols that can read, where it has one. "A later symbol can read" means that the production's last reading symbol stands after the item's next symbol. It is enough that some symbol after the next one can read. It need not be the one right after it. A strict item follows these rules:

- The resulting item is not strict where it reads a token other than the `T` of route 3. It is not strict either where it advances over a completed item whose span is not empty.
- It can advance over a completed item with an empty span only where a later symbol can read. The resulting item is strict.
- Where a later symbol can read, the strict item predicts its next symbol in the ordinary way. Otherwise it predicts that symbol strictly. A strict prediction predicts only the productions that can read, restorations included. Its predicted items are strict, other than restorations, which are complete.

So a strict item never reaches the end of its production.

Strictness is not part of an item's identity. An item is strict where every step that makes it is strict. An item that an ordinary step reaches is ordinary from then on. The recognizer then applies every step that strictness holds back.

These steps predict its next symbol and advance over empty constituents. This holds also where the recognizer processed the item as strict before. So the order of the steps does not change the items.

The recognizer's items in this mode are the least set closed under these rules and those of §4. So a strict prediction and an ordinary prediction of one symbol at one position share their items. The derivations through a shared item count once each, however many predictions reach it.

A strict prediction never predicts a production that can read nothing. A strict item never advances over an empty constituent unless a later symbol can read. So a strict item evaluates nothing past its production's last reading symbol. It evaluates no tag term of its own production, and no condition that becomes ready at its end.

An earlier advance over an empty constituent can still make a condition or a test ready. The engine evaluates it where a later symbol can read by the grammar, whether or not that symbol reads this input. So such a condition can end the check with an error of the grammar. This holds also where the rest of the optional reads nothing in this text. Its conditions, tests and tags are evaluated as in §4.

Any terminal other than the `T` that begins an elidable optional's content reads a synthetic token whose recognition tags hold it. It reads that token as it reads any token. This includes a bare terminal `T` outside an elidable optional, and a terminal in the rest of an optional. Its test reads the recognition tags and the recognition value. This is how a competing alternative reads a written-back terminator.

In every derivation of the mode, each elidable optional is either restored or written. Leave the observations of §7.5 aside, and compare the mode with a reading of R in which every elidable optional is mandatory. They differ in two ways only:

- A restoration needs no rest of the optional. So the restoration exists also where the rest cannot be empty, by its symbols or by its conditions.
- A synthetic terminator with an empty rest is one derivation, the restoration. The number of empty derivations of the rest does not matter.

The mode removes no other derivation. Strict items remove only paths on which the rest reads no token. Every production that can read, a restoration included, stays open to a strict prediction.

### 7.5 Observations

Every condition, every tag term and every test of a reference reads the projected spans of its own derivation. So does every method argument in them. Bindings, conditions and tags belong to the candidate derivation. The engine never copies them from D.

During the check, the observers mean the following. Here `s` is a span of R, and `s′` its projection.

- `s.first-token` is the first token of `s′`. `s.tokens-after-first` is all of `s′` but its first token. `s.last-token` is the last token of `s′`. Each is empty where `s′` is.
- `s.onward` runs from the start of `s′` to the end of the input of the parse that evaluates it. `s.following-tokens` runs from the end of `s′` to that end. `s.preceding-tokens` runs from that input's start to the start of `s′`. That input is O for the reconstruction's own conditions, tag terms and tests of references. Inside a nested query, it is the query's span of O (§7.6).
- `s.starts-input` holds where `s′` starts at the start of that input. `s.ends-input` holds where `s′` ends at the end of that input.
- `s.source-text` is the original text over the source of the tokens of `s′`, as §5 says. `s.value` concatenates their values, and `s.image` concatenates their images (§5).
- For a whole capture or `$`, `s.tags` is the constituent's tags. For any other span, it is the union of the tags of the tokens of `s′`. `s.classes` keeps the tags of `s.tags` whose names begin and end with an uppercase ASCII letter and never start with `_`.
- `matches`, `begins`, `ends`, and `s.tags(R)` run a nested query over `s′` (§7.6).

`followed-by` and `preceded-by` read the reconstruction derivation's own nodes over projected spans. A node counts only when its projected span is nonempty, and its first and last tokens are original tokens. A read of a synthetic token makes no counting node.

The rules of §4.2 use projected spans too. A constituent is empty for rules 2 to 6 when its projected span is empty. So a restoration is an empty constituent there, and a synthetic read gives no offer. Boundaries are the boundaries of O. W(D) has the nodes of D with the same projected spans (§7.8), so its atoms answer as in D.

The projection comes first, then the method. So `s.first-token` is the first original token of `s`, not the first token of `s` with a synthetic one removed. A span method never carries a capture's constituent tags: `$x.first-token.tags` reads tokens even where `$x.first-token` is all of `$x`.

A capture whose span holds only synthetic tokens is present, and `$x` holds as a condition. Its text, value, and image are empty, and the union of its tokens' tags is empty. It still has its constituent's own tags. So `$x.tags` can hold `Mark` while `$x.first-token.tags` is empty.

A constituent's tags are its production's tag terms, evaluated over its own captures (§4). A synthetic token gives a constituent no tag. A capture of a terminal that read a synthetic token has no tags. A production that inherits from one logical symbol (§3.7) inherits none from such a terminal. A restoration has none, as its empty production has none. A tag term can still give a constituent tags of its own, such as `:: Mark`, also where its span projects to empty.

A test of a reference reads the reference's projected span and its constituent's tags. `t="s"` compares `s` with the value of the projected span, and the tag test reads the constituent's tags. A test of a terminal reads the token that the terminal reads, with its recognition values. This is the one observation that reads a synthetic token's values. Recognition reads them too, to match a terminal and to restore (§7.4). It lets `T="ta"` read a written-back `T="ta"`.

So a terminal and a rule with one symbol differ under a test in the check. `T="ta"` reads a synthetic `T` whose saved value is ta. `t="ta"`, with `t → T`, does not read it, because the projected value of `t` is empty. `T<T>` and `t<T>` differ in the same way.

The difference is deliberate. A test of a reference must read the original input. Otherwise the chosen derivation loses its witness where its span holds a written-back terminator (§7.8).

Presence tests `$x`, feature guards, closed terms and constants mean what they mean in the main parse. `.classify` and `.split` take arguments computed as above, and fail as §10 says.

`$x.without-elision` and `$x.without-elision-except(F)` observe the reconstruction candidate's own projected omission events and opaque ranked blocks. Each synthetic terminal read contributes one close event at its original boundary, including synthetic written routes and bare reads (§7.10). A restoration contributes exactly one event, without another event for its transparent helper. The captured derivation determines event order and ownership. Ranked blocks hide private events.

This close observation differs from pattern projection, which removes bare synthetic structural leaves. It never copies D's chosen close list. Nested aligned queries receive the candidate's close observation and original context. No restoration record is duplicated.

Patterns compute each reconstruction candidate's projected structure over O and never copy the chosen original tree's observations. A restoration helper contributes exactly one omitted-T marker. Its synthetic terminal read contributes no second child. A synthetic read in an ordinary production contributes no observable child. Named constructors remain, subject to empty-child removal. Original terminal reads remain written.

An omitted final terminator still stops the last-child path. Its pattern value and image remain empty even when its body equality saved nonempty restoration value. Its pattern tags remain `{T}`. Body tests read synthetic recognition values, while pattern tests read projected leaf observations. The reconstructed witness preserves these observations through helpers, named constructors, empty children and unary transitions.

### 7.6 Nested queries

An ordinary nested query that the check starts reads the tokens of `s′`, the projected span, in O. It runs with G in its ordinary mode, as in the main parse. In that mode every elidable optional is an optional. The query reads no synthetic token, and its own nested queries do the same. It follows the query policy of §4.

Written-terminator priority applies to the tokens that it reads. It does not rank its proof trees, and it emits nothing.

Inside the query, `.starts-input`, `.onward`, `.preceding-tokens`, and `.following-tokens` read the query's span of O. Its start and end are positions of O.

A query is about a rule and a span of O. For the recursive-query rule of §4, `matches`, `begins`, `ends`, and `s.tags(R)` of one rule and span are one query. The rule is unchanged. A query is an error of the grammar where a query about the same rule and span is active. Only queries are active.

The reconstruction's recognition of R is not a query. This holds also where the span of `$` projects to all of O and the query asks about `text`. So a condition of the reconstruction can ask whether the original input parses as `text`. That query runs with G over O, and it is active while it runs. It is an error only where a query inside it asks about `text` over all of O.

A whole, prefix, or tag query over an explicit restored span follows the aligned rules of §4. It fixes the current reconstruction candidate's projected closes, rather than inheriting the outer reconstruction script. Active-query errors still use the shared stack and projected original context. The mapped original witness preserves its candidate closes and query answers.

`s.tags(R)` is the union of the tags of the query's eligible readings (§4). `$x.tags`, with no rule, is the capture's own constituent tags. The two do not stand in for each other.

### 7.7 Recognition, cycles and ranking

The check recognizes all of R, from the start rule `text`, in the reconstruction mode, with the observations of §7.5. A derivation of R counts where it is finite and every test and condition in it holds.

Cycles are found over spans of R, as §4 says. Two constituents of one rule whose spans of R differ are no cycle, even where both project to one span of O.

Locate raw W(D) before applying ranked admission. Admission groups options by their physical spans in R, including synthetic tokens. Reconstruction eligibility still applies. Equal projected O spans do not establish equal admission spans. Rank admitted derivations by rule profiles over projected spans `[π(a),π(b))` in O.

No stage directive or diagnostic lean applies. Elision vectors are all zero. A flagged occurrence whose projected span is empty contributes nothing to either part of the rule profile. Distinct occurrences with equal nonempty projected spans each contribute separately. Reconstruction admission has its own cache and preserves restoration, strictness and projection rules.

A restoration's read of its synthetic token is a read action, and its close is the close of a helper, which is transparent. Section 7.10 selects the error's readings. The canonical keys never turn a tie into a pass. Derivations whose trees are equal over O are still distinct derivations.

An error of the grammar met while the check recognizes R is the result's error, as one met while emitting is (§11). This includes an error in a competing derivation that only the check reaches. The stage keeps its verdict and warnings, but it has no output.

W(D), the restored witness (§7.8), has the rule profile of D. That is both its span vector `G_D` and its fewest count `F_D`, because each occurrence projects to its original span. Section 7.10 gives the decisions for witness loss and competing readings.

### 7.8 The witness

The witness of D is the derivation W(D) of R that has D's productions in D's order and in which:

- Each read of an original token reads the same token in R.
- Each elided terminator of D is the restoration of its helper over its own synthetic token.
- Each written elidable optional of D takes the written route from an original token.
- Each occurrence spans positions in R for its original tokens. It also spans the synthetic tokens of the elided terminators below it. This holds even where the representation shares one object between occurrences.

W(D) is a derivation of R that counts in the raw reconstructed forest. In outline:

1. Every token read of W(D) is allowed. An original token reads as in D. A synthetic token is compatible with its own optional, because its tags and saved value come from that optional's terminal and test.
2. Every route of W(D) exists. A restoration needs no rest of its optional, so it exists even where the rest of the optional cannot be empty. A written optional of D starts with an original token, so it takes route 2 and reads what D read.
3. Every node of W(D) projects to the span of its node in D, because the synthetic tokens below it project to nothing. So every capture has the projected span that it has in D.
4. Every constituent of W(D) has the tags of its node in D. This holds by induction from the leaves. An original token has its own tags.

   A restoration has the tags of the empty production, which D's elided helper had. A production's tag terms then read captures with the same projected spans and the same tags. A nested query in a tag term gives the answer it gave in D (§7.6). So the tag terms give the same tags.
5. Every condition and test holds as in D. Each reads the same projected spans and the same tags (3, 4). A nested query reads the same tokens of O with the same grammar and policy (§7.6), so it gives the same answer.

   A test of a terminal reads an original token as in D, or a compatible synthetic token. No query of W(D) is recursive. The reconstruction's recognition is not a query, and each query of W(D) is a query of D.
6. W(D) is not cyclic. Suppose that two nested nodes of one rule have one span of R. Both project to one span of O. Then D has two nested nodes of that rule over one span. That is a cycle, but D is not cyclic.

So, unless an error of the grammar ends the check, the raw reconstructed forest contains W(D). The argument depends on no corpus, no terminal and no shape of the optional's content. It depends on every observer, every test and every tag rule following §7.5 and §7.6. The strict items of §7.4 do not touch W(D), whose written optionals all start with an original token.

Ranked admission can exclude W(D). Section 7.10 then reports W(D) first. Witness loss means only raw absence.

The theorem does not excuse errors. A competing derivation can meet an error of the grammar, such as a `split` with an empty delimiter, that D never met. That error is the result's (§7.7).

### 7.9 A lost witness

Raw absence of W(D) is witness loss (§7.10). A lost witness is a defect of the library, not a property of the text. The result is an error of kind `grammar` with the code `elision-witness-lost`:

```json
{"kind":"grammar","stage":"syntax","code":"elision-witness-lost",
 "message":"the syntax stage could not reconstruct its chosen derivation for elision-only",
 "chosen":NODE,"completion":[{"terminal":"KU","at":3,"source":[9,9]},{"terminal":"VAU","at":5,"source":[16,16],"value":"vau"}]}
```

The stage's name stands for `syntax` in `stage` and in `message`. `chosen` is D's tree (§12), over O. `completion` lists the restoration records in the order of the tree's leaves (§7.2). Each record has these members, in this order:

- `terminal`, the terminal.
- `at`, its position in O.
- `source`, the empty source of its elided node.
- `value`, the saved value, only where the terminator has an `=` test.

The error has no `token`, `source`, `line`, `column`, `expected`, `reason` or `readings`.

`ok` is false and `tree` is null. The stage keeps its verdict, `resolved`, and its warnings, but it has no output, and no later stage runs. An error of the grammar met during the check is never this error.

The message is the same in every library. Section 7.10 gives witness loss priority over every passing or ambiguity outcome.

### 7.10 Readings

This policy applies to every grammar, including grammars without ranked groups or flagged rules. Raw witness membership tests the concrete derivation. A competitor is a best admitted derivation other than W(D).

If recognition ends without a grammar error, decide in this order.

1. Locate W(D) in the raw eligible reconstructed forest. If it is absent, report `elision-witness-lost` (§7.9).
2. Apply ranked admission without preserving W(D) artificially.
3. Rank admitted readings by projected rule profiles with no stage lean.
4. If W(D) is admitted and is the sole best admitted derivation, preserve the main result.
5. Otherwise, report `ambiguous` with reason `elision-only`, with W(D) first and one competitor second.

The competitor is the T-first best admitted derivation distinct from W(D). This rule applies whether admission excludes W(D) or retains it. Transparent actions remain part of T (§6).

A smaller filtered best profile does not prove witness loss. Intentional exclusion gives an expected ambiguity.

A competing reading never replaces D. Both reported trees and their action witness map to O. Distinct reconstructed derivations can display equal trees.

In every ambiguity outcome, the result's `tree` is null. The stage keeps its verdict, output and warnings, since it accepted its input and chose its derivation. The error has no `token` or `source`. Section 7.9 gives the result fields for witness loss.

In an elision-only ambiguity, the two readings are two derivations of R, but they can be equal as trees over O. For example, one reading can restore an optional. The other reading can read the same synthetic token as a bare terminal, in a production with the same tree. So the error also has a witness, as a tie has (§6). It is the pair of actions at the first difference between the two derivations of R, visible if there is one, mapped to O:

- A read of an original token is a read of that token's index in O.
- A read of a synthetic token is an `elided` action of its record's terminal at the record's position in O.
- A close has the projection of its span.

Neither action is ever missing, as §6 says of a tie.

Mapped to O, the two actions can still be equal. Two reads at one index read the same token of R, and a synthetic token reads only as its terminal. So equal mapped actions are two closes of one production whose spans of R differ only in synthetic tokens.

The message of the error is free. Only the message of §7.9 is the same in every library.

A reading is the tree of its derivation (§12), mapped to O:

- A read of an original token is a token node with that token's index in O.
- A read of a synthetic token is an `elided` node of its record's terminal. It has an empty span at the record's position, and the record's source. This holds for a restoration, for the written route from a synthetic token and for a bare terminal.
- A restoration gives exactly that one `elided` node, and nothing of the optional's content.
- A rule node has the projection of its span. Its source is that of its original tokens, or, where its projected span is empty, the empty source of §12 at that position. It has the tags of its own derivation.

The check gives no warning (§12), emits nothing and attaches nothing (§11). Only D does these things, in the main parse. A token node of a reading still shows its original token's attachments (`docs/output.md`).

### 7.11 Switching the check off

A caller can switch the check off, or on, for every stage that runs (`docs/api.md`). That choice changes nothing in recognition, ranking or emission. It only decides whether §7.1 to §7.10 run.

## 8. Reading grammar documents

A grammar document is Markdown. Its grammar text is the content of every fenced code block whose info string is `jbogenbau`, in order. A fence is a line of three or more backticks or tildes, indented by up to three spaces, followed by the info string. A backtick fence whose info string holds a backtick is not a fence, as in CommonMark. The reader knows no other Markdown container. So a block can stand under a list item indented by two spaces, as a pipeline's `%include` blocks do, but not deeper.

The info string is `jbogenbau` when it is exactly that once leading and trailing whitespace is removed. A block ends at a line that holds only a fence of the same character, at least as long. The fence is indented by up to three spaces, and only whitespace follows it. A `jbogenbau` block that is never closed is an error of the document, and the reader reports it at its opening fence. Any other unclosed block runs to the end of the document, as in CommonMark. The reader joins the blocks with a newline between them, and every character of the grammar text keeps its line and column in the document.

The reader parses the grammar text with the notation dialect, `grammars/dialects/notation.md`, whose DOM ships as `grammars/notation/bootstrap.json`. The rules in §9 turn the tree that this parse produces into the document's DOM. An implementation reads the bootstrap DOM, not the notation documents, to parse any grammar, the notation documents included. Splicing the notation's pipeline (§13) with the bootstrap must reproduce the bootstrap exactly (the fixpoint). The bootstrap holds each stage as its name and its runs of items. A run is a path and a DOM that holds consecutive items of that one document.

The grammar text is a text like any other, so stage zero decomposes it. Line and column numbers still count the code points of the document as written.

A tie in either stage of the notation dialect, `lexical` or `syntax`, is an error of kind `grammar` of loading (§6). The error names the document. It has no line and no column, since an ambiguity has no single position. Its message names the notation stage and says that the grammar text is ambiguous. A library never puts such an error at the start of the document in place of a position.

Every bootstrap failure names `notation/bootstrap.json` in its structured document field and its message. Reading and schema errors have no stage, line, or column. Stitching and lowering errors name the stage that failed. If the failure has a definition location, its structured line and column retain that location. The message also names the embedded document at that location. A failure without a definition location has no structured line or column.

A bootstrap supplies already-spliced document runs, so its stages must have distinct valid names. Each stage requires at least one document run. Its runs cannot contain `stage`, `include`, or `features` directives because pipeline splicing consumes them.

Before the loader stitches any stage, it makes sure that every bootstrap DOM meets the DOM rules. Each stage must contain at least one rule. The loader then stitches every stage in order with the normal stage validator.

Next, the dialect validator makes sure that feature roles agree across all stitched stages. Finally, it lowers the stages in order. A later stitching error therefore precedes an earlier lowering error.

A feature-role conflict names the stage and definition that introduce the conflicting role.

These locations concern embedded definitions, not lines of the bootstrap JSON. The CLI reports the same bootstrap attribution.

Each stage of the notation runs as any stage does (§4 to §7, §11, §12). So each notation stage runs the check of §7 where its own directive declares `elision-only`. The bundled notation declares it in no stage, but a caller's own bootstrap can (`docs/api.md`). An ambiguity that the check finds is an error of the document in the same way as a tie. The error names the document and the notation stage, with no line or column. The caller's option for the check (`docs/api.md`) does not reach a notation stage, so it neither switches the check on there nor off.

An implementation can keep the DOMs that it built before. Its key includes document text hash, bootstrap hash, core-table fingerprint, properties fingerprint, and DOM format version. Any mismatch gives a cache miss. Each table fingerprint is the 64-bit FNV-1a hash of its UTF-8 text, written as the document hash is.

Even without explicit property references, every document cache requires the properties fingerprint. With no companion for a custom core, it is `null`. An absent member or a different fingerprint gives a cache miss. Prepared stages and scalar-profile caches also distinguish the complete core and properties resources. A custom properties file therefore invalidates bundled cache entries with a different fingerprint, including entries for documents naming no additional property. This unavoidable cache cost preserves table-dependent notation semantics.

When source conversion uses the names file for an escape, the cache writer records a `names` fingerprint for that document. This fingerprint hashes the full `unicode-names.txt` text by the same algorithm. Numeric escapes and core abbreviation escapes alone require no names fingerprint.

After ordinary hash and DOM-shape inspection, the loader trusts the cache entry's dependency metadata. If `names` is present, it loads that resource and compares its fingerprint before accepting the entry. If `names` is absent, the entry requires no names data. A cache hit needs no source token scan or escape inspection.

If the recorded names fingerprint differs, the entry gives a cache miss. Missing or malformed required names data remains a loading error despite an existing cache entry. Documents without name escapes omit that fingerprint and remain reusable across names-file changes. Printer abbreviations affect the core-table fingerprint, rather than the names dependency.

`compiled.json` records the fingerprint of the bundled table. The hash is 64-bit FNV-1a over UTF-8 bytes, written as 16 lowercase hexadecimal digits. Every package ships `compiled.json` beside its grammars.

A DOM holds the definitions of constants and the references to them as the document writes them. It never holds a value that the loader gives a constant when it stitches a stage (§2). In the same way, it holds a classifier's entries and an implication's terms as written, and never the value of a classifier. So one cached DOM serves every stage and every dialect that includes its document. The values of the constants exist only in a stitched stage, and neither `compiled.json` nor the bootstrap holds them.

## 9. From notation tree to DOM

### 9.1 Lexical forms

The reader selects the longest punctuation token. `...`, `..`, and `.` are distinct tokens. They denote a chain marker, a range separator, and a method selector. `:-`, `:=`, `::`, and `:` denote image, value, tags, and capture binding. A range cannot consume part of a chain marker.

`++` denotes string concatenation, and `+` marks an elidable optional. No whitespace or comment can stand inside a compound punctuation token. Thus `+++` starts with `++` followed by `+`.

The lexer reads maximal names before the reader checks them. A lowercase name matches `[a-z][A-Za-z0-9_-]*`. An uppercase name matches `[A-Z][A-Za-z0-9_-]*`. An underscore token matches `_[A-Za-z0-9_]*`. `_` alone is the wildcard, and a name in §1 is an engine tag. Any other underscore token is a document error at that token.

Thus `_lu`, `_Letter`, and `_Lux` are each one invalid token. None splits into a wildcard or engine tag followed by a name. An emoji rule name contains exactly one scalar with `Emoji_Presentation=Yes` and `Emoji_Component=No` in the configured Unicode table.

The bundled version is Unicode 15.1.0. Each eligible scalar is its own token. Adjacent emoji names do not combine.

Variation selectors, modifiers, regional-indicator pairs, and ZWJ sequences cannot form names.

Emoji names work wherever rule names work, including template heads and calls. They cannot name tags, classifiers, stages, constants, captures, features, or parameters. `#` starts a pattern and never names a rule. `@` starts a parameter and never starts a pattern. `/` remains the brace separator. `~` and `^` remain unused.

A parameter token is `@` followed directly by `[A-Za-z][A-Za-z0-9_-]*`. A bare `@`, separated name, or `@(` is a lexical error. A call-name token is a rule name immediately followed by `(`, except the comment opener `(*`.

It contains the name only. It can name a call or a call-shaped rule head. Method and keyword constructors can consume it in their name positions.

It never reads directly as a reference, ordinary rule name, or bare pattern name. Whitespace or a comment before `(` prevents this token. Child-list attachment has its own adjacency rule below.

A capture token matches `$[a-z][A-Za-z0-9_-]*`, or `$` alone. Its name must match `[a-z][a-z0-9_-]*`. `$fooBar:A` therefore reports the capture-name error at `$fooBar`. A user constant reference is `$` followed by an uppercase name.

An Integer token is a nonempty run of ASCII decimal digits. Section 9.3 defines its validity as a method argument.

String delimiters are straight double quotes. Dollar signs and backslashes are ordinary characters. A string contains literal runs and `‹…›` escapes. Literal runs use stage-zero decomposition, while decoded escape scalars remain exact. The reader joins those parts without further normalization.

Lexical string tokens retain their quotes and escape spellings. The lexical grammar accepts their raw interiors without interpreting escapes. A separate inspection step resolves escapes after successful lexical recognition, before syntax recognition. During DOM conversion, the reader removes the quotes and decodes the original escapes exactly once. Include-path tokens follow the same rule, with original literal runs. Token source positions and texts retain the written spelling.

An escape starts at `‹` and ends at the next `›`. It contains `U+` and four to six hexadecimal digits, a formal Unicode name, or a name alias. Non-numeric lookup first tries the core abbreviation map. Other names require the lazy names file.

Names match exactly, including case and spaces. A numeric escape accepts either case for its hexadecimal digits, but requires uppercase `U+`. Every escape must resolve to one scalar. Escape errors arise during the separate inspection step, before syntax recognition or reader inspection.

A literal `‹` requires an escape. Without an open escape, `›` is literal. An escaped quote remains inside the string and cannot close it. Decoded delimiters never start another escape, comment, call, or pattern. An empty escape, unknown name, missing closer, quote, or line break within an escape is an escape-inspection document error at `‹`.

An include path is the first and only operand that `%include` takes, in straight double quotes. Its literal runs preserve the original text without decomposition. Its escapes use the ordinary string decoder. Path resolution uses the decoded result. Paths use separate tokens because includes select documents before constant binding.

A feature name matches `[A-Za-z][A-Za-z0-9-]*`. A guard token is a feature name followed by `?` or `!`, or `¬` immediately followed by a feature name and `?`. No whitespace or comment stands inside a guard token. A capital-initial feature such as `Cbm` is legal.

The lexer reads `¬` separately only when no guard starts immediately after it. It has no negated-warning token. Thus `%rule r ¬cbm! A` fails lexically at `!`, column 13. `%rule r ¬ cbm? A` fails syntax recognition at `¬`, column 9. A supplied guard with an invalid feature or a negated warning fails at that guard.

Whitespace and comments separate tokens but add no grammar node. Call-name adjacency follows the exception above. Comments discard their contents, including backslashes, without escape processing.

Pattern child lists use `«` U+00AB and `»` U+00BB. If no whitespace or comment separates a node test from its following list, that list must attach to the test. Otherwise, the list begins a separate bare-list pattern. The prefix `·` U+00B7 must directly precede its node atom or bare list. It never prefixes a grouped or compound pattern. Neither a second list nor a list after a group attaches to that group.

Between child items, `«` or `·` requires separation after a node test, closing `»`, or a group's closing `)`. Whitespace or a comment supplies that separation. A call's first adjacent child list belongs to that node test and remains attached. Thus `a« b »` is one node, while `a« b »« c »` and `(a)« b »` are errors. `a·« b »` is also an error.

Punctuation separates adjacent names. A tag test can precede one value test, as in `_<Stressed>≠"y"`. Thus `$x:A<B>` is a capture of a tested tag terminal. `$x : A < B >` has the same meaning.

Canonical string diagnostics expand user constants and concatenations, then write the result as one quoted string. An empty string uses `""`. The printer does not insert concatenation operators. Dollar signs and unmatched `›` have no escape role by themselves.

The printer escapes a quote, control, format scalar, nonspacing mark, private-use scalar, decomposable scalar, or scalar of nonzero combining class. It also escapes Hangul syllables and `‹`. Section 1 defines the predicates and their data sources. All other scalar values appear literally, including backslashes.

If the core table supplies abbreviation aliases for a scalar, the printer chooses the shortest, then ASCII order on equal length. Other alias kinds remain valid input but never supply canonical output. Without a core abbreviation, the escape uses `U+` and uppercase hexadecimal digits. The number has at least four digits, without unnecessary leading zeros. For example, canonical newline is `"‹LF›"`, and canonical U+0301 is `"‹U+0301›"`.

A range's identity is its resolved pair of scalar endpoints. Its diagnostic spelling joins the canonical spellings of its endpoints with `..`. A tag terminal's identity and spelling are its name. Tests never alter terminal identity.

### 9.2 Syntax forms

The syntax stage recognizes forms that the reader rejects under §9.3. Recognition builds a notation tree for the whole document before reader validation starts. After lexical and escape inspection succeeds, a syntax error anywhere precedes every reader error. The productions below define recognition, not validity. They specify the syntax stage of `grammars/notation/syntax.md`.

This metalanguage is descriptive EBNF, not an executable jbogenbau document. Quoted operators denote punctuation. Brackets denote optional syntax and braces denote zero or more syntax items. Lexical tokens follow §9.1. Constructor names and wrapper conversion follow §9.3.

Body and pattern parentheses group expressions. Value tests accept no grouped operand.

Recognition productions:

```text
document = {statement}
statement = rule | directive | constant-definition | classifier | implication-declaration
rule = definer [flags] rule-head (body | clauses headed-body | "=" call)
       [conditions] [output]
definer = "%rule" | "%redefine-rule" | "%extend-rule"
flags = "(" name {"," name} ")"
rule-head = rule-name | call
rule-name = name | emoji-name
call = call-name "(" call-argument {"," call-argument} ")"
call-argument = requirement-list ≻ target-choice ≻ body-argument ≻ call-term
requirement-list = "<" {requirement} ">"
target-choice = call-target "|" call-target {"|" call-target}
call-target = reference | tag | call | parameter
body-argument = "(" choice ")" | optional | repetition | "ε"
call-term = tested | term | "_"
parameter = parameter-token
clauses = tags-clause [value-clause] [image-clause]
        | value-clause [image-clause] | image-clause
tags-clause = "::" term
value-clause = ":=" recipe
image-clause = ":-" recipe
headed-body = "|" ordinary-body
body = ["|"] ordinary-body | ranked-body
ordinary-body = alternative {"|" alternative}
ranked-body = {guard} ranked-choice [clauses]
ranked-choice = conjunction "≻" conjunction {"≻" conjunction}
alternative = {guard} conjunction [clauses]
choice = ["|"] conjunction {"|" conjunction} | ranked-choice
conjunction = ["&"] sequence {"&" sequence}
sequence = primary {primary}
primary = captured | tested | untested-primary
captured = capture-binder ":" primary
capture-binder = capture-reference | constant-reference
tested = untested-primary symbol-test {symbol-test}
untested-primary = reference | tag | string-terminal | range | "_"
                 | call | parameter | group | optional | repetition | "ε"
reference = lowercase-name | emoji-name
tag = uppercase-name | engine-tag-token
string-terminal = string-literal | constant-reference
group = "(" choice ")"
optional = "[" ["+"] choice "]"
repetition = "{" ["..."] choice ["/" choice] "}"
           | "{" choice "..." ["/" choice] "}"
symbol-test = tag-test | value-test
tag-test = "<" {requirement} ">"
requirement = ["¬"] test-operand
value-test = test test-operand
test = "=" | "≠"
test-operand = parameter | call | string-literal | constant-reference | reference | tag | range
             | capture-reference | method-chain | "∅" | pattern-literal | "(" term ")"
range = string-operand ".." string-operand
string-operand = string-literal | constant-reference | parameter
conditions = "%conditions" [","] implication {"," implication}
output = "%erased" | "%emits" [emission]
emission = [","] item {"," item} | clauses
item = {attachment} emit-target {attachment} [clauses]
emit-target = capture-reference | "ε" | lowercase-name | tag | range
attachment = "(" capture-reference ")"
recipe = recipe-atom {recipe-atom}
recipe-atom = term
term = union | guarded-term
guarded-term = any-of "⟹" {any-of "⟹"} union
union = ["∪"] intersection {("∪" | "∖") intersection}
intersection = ["∩"] concatenation {"∩" concatenation}
concatenation = term-atom {"++" term-atom}
tag-run = tag tag {tag}
string-run = string-literal string-literal {string-literal}
term-atom = plain-term-atom | method-chain
plain-term-atom = tag-run | string-run | tag | reference | call | parameter | string-literal | constant-reference | range
                | capture-reference | "∅" | pattern-literal | "(" term ")"
method-chain = method-receiver method-selector {method-selector}
method-receiver = term-atom
method-selector = "." method-name ["(" arguments ")"]
arguments = argument {("," | "|") argument}
argument = term | integer
integer = Integer
implication = any-of {"⟹" any-of}
any-of = ["∨"] all-of {"∨" all-of}
all-of = ["∧"] condition {"∧" condition}
condition = comparison | tree-comparison | method-chain | capture-reference
          | "¬" condition | "(" implication ")"
comparison = union comparator union
comparator = "=" | "≠" | "∈" | "∉" | "⊆" | "⊈"
tree-comparison = capture-reference ("≅" | "≇") union
pattern-literal = "#" pattern-primary
pattern-union = pattern-intersection {("∪" | "∖") pattern-intersection}
pattern-intersection = pattern-path {"∩" pattern-path}
pattern-path = ("⋮" | "⋱") pattern-primary | pattern-primary ["⋰"]
pattern-primary = pattern-node | pattern-bare | "(" pattern-union ")"
pattern-node = ["·" ADJACENT] pattern-atom
               (ADJACENT pattern-children | NO-ATTACHMENT)
pattern-bare = ["·" ADJACENT] pattern-children
pattern-atom = (pattern-name | terminal) {symbol-test}
pattern-name = reference | call | parameter
terminal = tag | string-terminal | range | "_"
pattern-children = "«" [child-choice] "»"
child-choice = child-alternative {"|" child-alternative}
child-alternative = child-sequence | child-set
child-sequence = child-item {ITEM-BOUNDARY child-item}
child-set = child-intersection ("∪" | "∖") child-intersection
            {("∪" | "∖") child-intersection}
          | child-path "∩" child-path {"∩" child-path}
child-intersection = child-path {"∩" child-path}
child-item = child-path | pattern-brackets | pattern-repeat | "⋯"
child-path = ("⋮" | "⋱") child-primary | child-primary ["⋰"]
child-primary = pattern-node | pattern-bare | "(" child-choice ")"
pattern-brackets = "[" child-choice "]"
pattern-repeat = "{" child-choice ["/" child-choice] "}"
directive = directive-name {directive-argument} [conditions]
directive-name = "%stage" | "%extend-stage" | "%redefine-stage"
               | "%include" | "%features" | "%ambiguity-resolution"
directive-argument = argument-word | argument-string | argument-tag | argument-term
argument-word = name
argument-string = string-literal | include-path
argument-tag = engine-tag-token | range
argument-term = directive-method | capture-reference | constant-reference | "∅"
              | pattern-literal | "(" term ")" | emoji-name | "_"
directive-method = directive-receiver method-selector {method-selector}
directive-receiver = tag | reference | string-literal | constant-reference | range
                   | capture-reference | "∅" | pattern-literal | "(" term ")"
constant-definition = ("%const" | "%redefine-const") constant-reference term
classifier = "%classifier" name {classifier-entry}
classifier-entry = {guard} classifier-key {classifier-key} ("∈" | "∉") (name | engine-tag-token)
classifier-key = string-literal | constant-reference
implication-declaration = "%implies" union "⟹" union
```

A call-shaped rule head with only distinct parameter arguments declares or edits a template. Mixed parameter and concrete heads are errors. A closed call head addresses one instance and requires `%redefine-rule` or `%extend-rule`. A binding requires a plain rule name on its left and exactly one call on its right.

The unquoted `≻` between argument forms denotes recognition priority. It does not denote a token inside the argument.

Call arguments follow the ordered alternatives of §2.3, independently of the template declaration. A target choice inside one call argument belongs to that argument. Parenthesized body arguments retain their argument boundary. Calls introduce no statement clauses inside their argument list.

The valid-form productions below also accept parameter placeholders in the positions listed in §2.3. The reader defers only restrictions that need their substituted argument. Ordinary expressions outside templates receive no such exemption.

An unresolved parameter never relaxes a node's category, field shape, method arity, or fixed argument form. These restrictions also apply to uncalled templates and definitions that later edits replace.

`matches`, `begins`, `ends`, `followed-by`, and `preceded-by` separate targets with `|`. Other methods separate arguments with commas. Recognition accepts either separator, and the reader rejects a separator that does not match the method.

Recognition names describe productions. The following mapping specifies the named constructors that the syntax stage builds. Other production names remain wrappers under §9.3. Lexical forms contribute tokens where a constructor requires tokens.

| Recognition part | Constructor parts |
| --- | --- |
| `document` | Root `text` |
| `flags` and its names | `rule-flags` with `rule-flag` parts |
| `captured` | `capture` with a binder token and `primary` |
| `capture-binder` | Direct prefixed-name token, checked as a capture name |
| `tested` | `tested` with an unwrapped base constructor and the written tests |
| `pattern-primary` | One node test, bare child list, or grouped whole pattern |
| `ranked-body` | `ranked-alternative` with guards, `ranked-choice`, and clauses |
| `conditions` | `conditions-clause` |
| `%emits` output | `emits-clause` with emission parts |
| `%erased` output | `erased-clause` |
| `item` | `emit-item` |
| Before and after `attachment` | `emit-before` and `emit-after`, each with `capture-reference` parts |
| `requirement` | `tag-requirement`, whose operand has a `test-operand` wrapper |
| `method-chain` | `method` with `method-receiver` and selector parts |
| `tags-clause` by owner | Header `tags-clause`, `alternative-tags`, or `emit-tags` |
| `directive-argument` | `argument-word`, `argument-string`, `argument-tag`, or `argument-term` by written form |
| Bare names in value positions | `name` or `tag` by initial case |
| Names or capture references in token positions | Direct lexical tokens |

A method receiver retains a `term-atom` constructor. Explicit grouping and selector folding keep the same DOM. The `headed-body` constructor supplies the header branch's ordered alternatives.

Tests can follow every primary, in any number and order. A capture target is any primary. Within a capture, following tests belong to its target. Thus `$x:A<B>="v"` captures the tested A, rather than testing the capture. One `tested` constructor holds the unwrapped base constructor and every following test in written order.

A supplied tree can retain a `primary` wrapper around that base. A source test never wraps another tested constructor or the capture binder. Tests after a binder belong to its target, including nested invalid captures. Supplied notation trees can still contain a test on a capture itself.

Names, capture references, method names, engine-tag tokens, strings, include paths, and guards are lexical forms. A capture reference includes `$`. Names include both initial cases. These recognition categories do not impose the reader's naming, type, or signature restrictions.

`%include` takes exactly one operand, its include path. Only its first operand receives literal include-path decoding, and that operand must be quoted. Any later quoted operand follows ordinary string lexical forms. Other directive strings follow those forms too. The reader rejects wrong operand types at the directive before term conversion.

Thus `%include "a.md" "b$c.md"` reports the wrong count at `%include`. With no operand or a wrong operand type, it also reports at `%include`.

Recognition accepts a constant token as a capture binder before `:`. The reader rejects its capitalized or engine name at that binder. This is a reader error, so an earlier reader error wins after syntax recognition succeeds.

Recognition admits captures of groups, optionals, repeats, empty expressions, and captures, including `$` as a binder. It admits captures inside braces and marked optionals. It admits invalid marked-optional contents and chains inside other expressions. Section 9.3 rejects these forms at the capture, optional, or repetition that it specifies.

Recognition admits arbitrary test operands, grouped terms included, so the reader can report an invalid operand at that operand. Pattern names can carry repeated or reversed tests too. Recognition also admits ranges in terms, nonclosed constant values and implications, and methods with invalid names, receivers, or arguments. Section 9.3 imposes their type and position rules.

Recipe recognition admits terms beyond the closed recipe language. Each recipe atom consumes a maximal term, including any adjacent tag or string run. Emission recognition admits names and ranges as targets, attachments on any target, and `$` inside an attachment.

Directive recognition reads each name as its own operand. It admits methods, references, grouped terms, patterns, ranges, include paths, emoji names, and `_`. It admits no bare tag run as one operand or method receiver. A grouped term can still be a receiver.

An include path is not a method receiver. Directive recognition does not constrain operand counts or types. The reader reports every wrong operand at the directive. Thus `%stage $X` fails at `%stage`, column 1.

Flags and classifier entries admit values that §9.3 rejects, including warning guards on entries.

Empty flags or method arguments, mixed choice operators, repeated clauses, and misplaced clauses fail syntax recognition. The syntax stage admits at most one optional marker and one chain marker, with neither marker in a separator. Section 9.3 also defines errors for additional markers in trees supplied by another bootstrap. Property terminals have no lexical form and do not enter this recognition grammar.

Valid-form productions:

```text
captured = named-capture ":" tested-symbol
tested-symbol = symbol [tag-test] [value-test]
symbol = reference | call | parameter | tag | string-terminal | range | "_"
tag-test = "<" {requirement} ">"
requirement = ["¬"] (tag | tag-set-constant | parameter)
value-test = ("=" | "≠") (string-literal | string-constant | parameter)
item = ("$" | named-capture | "ε") [clauses] | attached-item
attached-item = {attachment} named-capture {attachment} [clauses]
attachment = "(" named-capture ")"
recipe = recipe-atom
recipe-atom = recipe-string {"++" recipe-string}
recipe-string = string-literal | string-constant | parameter | capture-string-method
capture-string-method = capture-reference "." string-method
string-method = "value" | "image" | "source-text" | "decomposed-source-text" | "verbatim-text"
              | "emitted.value" | "emitted.image"
pattern-atom = rule-name | call | parameter [tag-test] [value-test]
             | terminal [tag-test] [value-test] | constant-reference [tag-test] [value-test]
```

These valid forms restrict the recognition forms without replacing their grammar. Recognition enforces the leading bar after header clauses and the count and order of clauses. It also enforces two or more ranked options, unmixed choice operators, and the number and placement of markers. Failures of those rules are syntax errors at the furthest position reached.

The remaining restrictions describe reader validity after recognition succeeds. Section 9.3 defines their rejection positions and priority.

Every rule reference, including an emoji reference, accepts tests and captures. A call has the same symbol behavior.

`item` also accepts `attached-item`. Attachments require a named carrier and precede its clauses. An empty tag test is legal and holds vacuously. An empty tag constant also supplies no requirements. A body with header clauses must use the leading `|` form. Each clause occurs at most once and follows the specified order.

A ranked body has at least two conjunction options joined by `≻`. Its guards and clauses apply to the complete ranked expression. A choice level cannot mix `|` and `≻`. Groups, plain optionals, and flat repeats accept a choice body. A marked optional requires a user tag or parameter directly after `+`, optionally carrying both tests. A parameter head must become exactly one bare user tag after argument conversion.

Its remainder is a sequence of primaries. It cannot contain captures.

Flat repetition is `{body}` or `{body / body}`. A chain places one `...` immediately after `{` or after the whole item. A chain is the whole alternative expression. Captures cannot occur inside either repetition form. Tests cannot follow a group, capture, optional, repeat, or `ε`.

The reader checks each recipe atom in its written form, before folding or removing operators. Any operator token except `++`, including a leading no-op `∪` or `∩`, is an error at the atom. Thus `%rule r A := ∪ "a"` fails at `∪`, column 14. Recipe atoms have no grouping or method-chain extension. The `++` operators join those atoms.

A recipe contains exactly one recipe term, which can be a `++` chain. A second term is an error at its first token. An unparenthesized `string-run` is an error at its first string. The message tells the author to use `++`. The reader does not convert the run into atoms or keep it as a string set.

Only the methods listed above are legal. A bare capture, guarded term, set operation, span method, query, `.split`, `.ngrams`, or `.classify` is a document error. A recipe cannot branch on a condition.

Pattern productions use the grouping and binding rules of `docs/notation.md`. `#A<B>` converts exactly as `#(A<B>)`. A pattern constant denotes a predicate. A string constant denotes a terminal. A tag-set or string-set constant cannot serve as a pattern atom. A tested user constant atom must resolve to a string, otherwise loading reports a document error at the constant reference.

Rule atoms and pattern-valued constant atoms accept no tests.

An attached list requires a rule-name test, template family, exact call, or parameter that becomes one of these. A terminal, `_`, tested atom, or string-valued constant in that position is a document error. If substitution reveals the error, the reader reports it at the parameter use. Otherwise, it reports the error at `«`. Bare lists remain valid without a name test. Their children retain their own searches and exact prefixes.

ADJACENT requires zero intervening whitespace or comments. In `pattern-node`, it connects the prefix to its atom and the completed atom to its list. NO-ATTACHMENT consumes no token. If no adjacent `«` follows the completed atom, NO-ATTACHMENT succeeds. Otherwise, it fails. The two attachment routes are disjoint during recognition, before DOM conversion.

ITEM-BOUNDARY also consumes no token. It enforces the separation rule of §9.1 between consecutive child items. It fails on an adjacent `«` or `·` after a node test, `»`, or group `)`. An attached list never crosses ITEM-BOUNDARY, including after a call's `)`. These assertions use original source positions, before the lexer discards whitespace and comments.

A child set requires a set operator outside its groups. A child sequence cannot consume that operator. These alternatives therefore cannot recognize the same complete text.

Inside a child list, every parenthesized group follows `child-primary`, never the whole-pattern `pattern-primary` route. A group without a path or set operator contributes its item array. If a path or set uses that group, it must contain exactly one `child` item holding a whole pattern. The reader rejects a sequence, optional, repeat, gap, or choice in that operand position. Grouping produces no DOM node.

A set beside other child items requires grouping parentheses. `« a (b ∪ c) »` is valid, while `« a b ∪ c »` fails syntax recognition. A set can occupy a complete choice arm without extra parentheses.

A pattern argument is one term that the pattern grammar consumes. The argument reader balances guillemet tokens, not characters in raw text. A guillemet inside a string or comment is not a delimiter. Inner `|`, `/`, and commas belong to that term and do not separate outer call arguments. Thus `f(#« "»" a »)` retains the complete child list as its argument.

### 9.3 Conversion and validation

The following table is the complete constructor contract, including the template forms of §2.3. A constructor is a recognized syntax-tree part. Its row specifies required parts, lookup order, and DOM conversion. Names outside this table are wrappers, never constructors. Each wrapper contributes its children recursively in written order.

The reader reads only a constructor's parts, after wrapper flattening. A missing required part causes a document error at that constructor when its lookup occurs. Unused parts are ignored. Repeated operand lists preserve written order. Unless a row says otherwise, a named lookup selects its first matching part.

Each declaration's `at` records its first token's line and column, counted from 1. A constant reference instead records its own token position. Token forms follow §9.1. Semantic types and arities follow §10 and `docs/output.md`.

| Constructor | Required parts and lookup order | DOM conversion |
| --- | --- | --- |
| The root | Declaration constructors in source order | Five ordered item arrays, including empty arrays. A known non-declaration part is an error. |
| `directive` | Keyword token, then argument parts in order | Validate written operand count and types before converting terms. Report every wrong operand at the directive. Produce `name` and valid argument values as `args`. A following `conditions-clause` gives optional `conditions` only for `%features`. |
| `argument-word` | One name token | Name string |
| `argument-string` | One quoted operand | Only the first `%include` operand uses literal path decoding. Other quoted operands follow ordinary lexical forms and fail operand validation at the directive. |
| `argument-tag` | One tag token or range | Tag identifier or range operand for validation at the directive |
| `argument-term` | One directive method, reference, empty set, pattern, grouped term, emoji name, or `_` | Invalid operand for validation at the directive |
| `classifier` | `classifier-name`, then `classifier-entry` parts | `name`, then ordered `entries` |
| `classifier-name`, `classifier-class` | One name token each | Name string |
| `classifier-key` | One `string` or `constant-reference` | Unresolved STRINGTERM |
| `classifier-operator` | One `∈` or `∉` token | Operator string |
| `classifier-entry` | Guards, keys, operator, class. At least one key. | `guards`, `keys`, `op`, `class` |
| `implication-declaration` | Two `union` parts | `if`, then `then` |
| `constant-definition` | `constant-definer`, `constant-reference`, `term` | Operation, user name, unresolved value |
| `constant-definer` | One `%const` or `%redefine-const` token | `define` or `redefine` |
| `constant-reference` | One user constant reference token | `const`, name without `$`, and reference `at` |
| `rule` | Definer, head, flags, then binding call or ordinary body and clauses | Ordinary definition, template with `params`, instance edit with `args`, or named `instance` binding. Header clauses precede body lookup. |
| `call` | Call-name token, then ordered `call-argument` parts | `call`, ordered `args`, and call `at` |
| `parameter` | One parameter token | `param` without `@`, and its `at` |
| `call-argument` | Requirement list, target choice, body argument, tested symbol, or term | ARG from `docs/output.md`, preserving its category |
| `requirement-list` | Ordered `tag-requirement` parts | `requirements`, including an empty array |
| `target-choice` | Two or more ordered call targets | `targets` array |
| `body-argument` | One choice, optional, repetition, or `ε` | Convert to EXPR. Return a sole symbol as its common ARG atom. Otherwise retain `body:EXPR`. |
| `definer` | One definition keyword token | `define`, `redefine`, or `extend` |
| `rule-name` | One rule-name token | Lowercase name or eligible emoji scalar |
| `rule-flags` | One or more `rule-flag` parts | Ordered flags. Reject extension flags before reading flag tokens. |
| `rule-flag` | One flag token | Flag string. Unknown precedes duplicate-value error. |
| `body` | One or more `alternative`, or one `ranked-alternative` | Ordered alternative list |
| `headed-body` | One or more `alternative` | Ordered alternative list, like an ordinary `body` |
| `alternative` | Guards, conjunction, then tag, value, image clauses | `guards`, `expr`, and optional channel or tag members |
| `ranked-alternative` | Guards, ranked choice, then tag, value, image clauses | One ALT. Guards and clauses apply to the entire ranked expression. |
| `guard` | One guard token from §9.1 | `feature`, `kind`, `negated`. Reject invalid feature names or negated warnings at the guard. |
| `ranked-choice` | At least two `conjunction` parts | Ordered `ranked` array |
| `choice` | One `ranked-choice`, or one or more `conjunction` parts | Ranked expression, ordinary `choice`, or sole child |
| `conjunction` | One or more `sequence` parts | `and`, or sole sequence |
| `sequence` | One or more `primary` parts | `seq`, or sole primary |
| `primary` | One symbol, call, parameter, capture, tested, group, optional, repetition, or empty constructor | That expression. A constant symbol becomes `literal` of its unresolved term. |
| `reference` | One rule or tag name token | `ref`, including `🆓` |
| `tag` | One user or engine tag token | Body: `ref`. Term: singleton `tag`. Pattern: `terminal` with source position. |
| `string-terminal` | One `string` or `constant-reference` | Body: `literal` of the unresolved string term. |
| `wildcard` | One `_` token | `wildcard:true` |
| `range` | Two string operands in order | `range` of unresolved STRINGTERMs |
| `tested` | Tag tests if present, value tests if present, then one base constructor or `primary` | Require at least one test. Check the target and written test order. Wrap the base with tags first, then value. |
| `tag-test` | Zero or more `tag-requirement` parts | Ordered requirements, including an empty array |
| `tag-requirement` | Optional `¬` token, then one operand | Require a tag, tag-set constant, or parameter. Produce `negated` and unresolved `value`. |
| `value-test` | `test`, then `test-operand` | Comparator and string operand |
| `test` | One `=` or `≠` token | Precomposed value comparator from the token value |
| `test-operand` | One recognized operand | Require a string literal, string constant, or declared parameter for a value test. Produce unresolved STRINGTERM. |
| `capture` | Capture token, then `primary` | `capture` name without `$`, then `expr`. The base accepts every rule reference or call, including emoji rules. |
| `group` | One `choice` | Child expression |
| `optional` | One `choice`, then `+` markers if present | `optional`, with `elidable:true` for one valid marker |
| `repetition` | Choices, then markers. Read the first two choices. | First is `repeat`, second is `separator`. Marker before the item means left chain, after it means right chain. |
| `empty` | One `ε` token | `empty:true` |
| `tags-clause`, `alternative-tags`, `emit-tags` | One `term` | Owner's `tags` |
| `value-clause` | One `recipe` | Owner's `value` |
| `image-clause` | One `recipe` | Owner's `image` |
| `conditions-clause` | One or more `implication` parts | Ordered conditions |
| `emits-clause` | Item parts, or tag, value, image clauses alone | Ordered `items`. No target means implicit `$`. No written item also means `$`. |
| `erased-clause` | One `%erased` token | Owner's `erased:true` |
| `emit-item` | Target, before attachments, after attachments, tags, value, image | Capture or inserted item, with ordered attachments and clauses |
| `emit-target` | One capture, `ε`, name, tag, or range | Require a capture or `ε`. Produce capture name, empty name, or `insert:true`. |
| `emit-before`, `emit-after` | One or more named `capture-reference` parts | Attachment names without `$`, in written order |
| `recipe` | Exactly one valid `recipe-atom` | Ordered `concat`. Reject a second term at its first token with an instruction to use `++`. |
| `recipe-atom` | One recognized term | Check its written form before conversion. Require string atoms joined by `++`, with methods restricted by §11. Reject juxtaposed strings with an instruction to use `++`. |
| `concatenation` | One or more `term-atom` parts separated by `++` | Sole child, or ordered `concat` of string operands. Require each known operand to be a string before reading the next. Defer unresolved constant types until binding. Flatten grouped concatenation operands into the outer array in written order. |
| `method` | `method-receiver`, then one or more `method-selector` parts | Fold selectors left into receiver-first method nodes |
| `method-receiver` | One `term-atom` | Initial receiver, retaining its actual type |
| `method-selector` | `method-name`, then optional `arguments` | Method name, prior receiver, ordered argument terms |
| `method-name` | One method-name token | Exact method identifier |
| `arguments` | One or more `argument` parts | Ordered argument array. Absent arguments gives `args:[]`. |
| `argument` | One `term` or `integer` | Term, integer argument, or rule/classifier name in the signature's name position |
| `integer` | One Integer token | `integer`, retaining its positive decimal digits without leading zeros |
| `string` | String token | Remove delimiters from its decomposed token value |
| `name` | One name token | Capitalized tag, or rule/classifier name in its method argument position |
| `term` | One `union` or `guarded-term` | Child term |
| `tag-run`, `string-run` | At least two `tag` or `string` parts respectively, in written order | One `union` of singleton operands. Flatten into an enclosing union, regardless of grouping. |
| `term-atom` | One call, parameter, string, tag, tag run, string run, name, constant, capture, method, range, empty set, pattern literal, or grouped `term`, `guarded-term`, or `union` | Delegate to that constructor. Preserve its term and type. Parentheses make no DOM node. |
| `guarded-term` | One or more `any-of`, then a `union` or `term` | Right-nested `if` terms around the final value |
| `union` | One or more `intersection` parts and their operators | Fold union and difference left. Flatten every union operand that is itself a union. A sole part stays unchanged. |
| `intersection` | One or more `concatenation` parts | `intersection`, or sole part |
| `empty-set` | One `∅` token | `emptySet:true` |
| `capture-reference` | One capture token | `capture`, name without `$`, with empty name for `$` |
| `implication` | One or more `any-of`, then optional nested implication | Right-nested condition `if`, or sole condition |
| `any-of` | One or more `all-of` | `any`, or sole condition. Flatten nested `any`. |
| `all-of` | One or more `condition` | `all`, or sole condition. Flatten nested `all`. |
| `condition` | One comparison, tree comparison, method, negation, presence, or grouped implication | Child condition |
| `comparison` | Comparator, then two `union` parts | `op`, `left`, `right` |
| `comparator` | One ordinary comparison token | Precomposed comparator from the token value |
| `negation` | One `condition` | `not` |
| `presence` | One capture token | `captured`, with empty name for `$` |
| `tree-comparison` | Capture reference, tree comparator, union | `op`, capture `left`, pattern `right` |
| `tree-comparator` | One `≅` or `≇` token | Precomposed comparator from the token value |
| `pattern-literal` | One `pattern-primary` | Pattern term containing that whole pattern |
| `pattern-union` | One or more `pattern-intersection`, with operators | Fold union and difference left. Flatten every union operand that is itself a union. |
| `pattern-intersection` | One or more `pattern-path` parts | Flatten intersection operands into one array, or retain the sole predicate |
| `pattern-primary` | Node, bare list, or grouped `pattern-union` | Delegate without a grouping wrapper |
| `pattern-node` | One atom, optional adjacent prefix, optional adjacent list | Atom with optional `exact:true` and `children` array |
| `pattern-bare` | One list and optional adjacent prefix | `any:true`, optional `exact:true`, and required `children` array |
| `pattern-atom` | Name, call, parameter, terminal, or constant, with written tests | Require a terminal, string constant, or unresolved parameter for tests. Preserve tag then value order. |
| `pattern-children` | Optional `child-choice` | Item array, including empty or singleton |
| `child-choice` | One or more alternative arrays | Sole array, or one choice item. Flatten singleton choice alternatives. |
| `child-alternative` | One sequence or whole-pattern set | Item array, with a set wrapped as one `child` |
| `child-set` | Whole patterns and at least one set operator | Ordinary pattern set inside one child item |
| `child-intersection` | One or more `child-path` parts | Require whole-pattern operands, then flatten intersection operands or retain the sole pattern |
| `child-sequence` | One or more child items | Concatenate plain groups into one item array |
| `child-item` | Child path, optional, repeat, or gap | Converted path items, corresponding wrapper, or `siblings:true` |
| `child-primary` | Node, bare list, or grouped child choice | Node or bare list becomes one `child`. A group contributes its item array. |
| `child-path` | One child primary and optional path token | Without a path, retain its item array. With a path, require one whole pattern and wrap that path in `child`. |
| `pattern-brackets` | One nonempty `child-choice` | `optional` item with an item array |
| `pattern-repeat` | One nonempty item choice and optional nonempty separator choice | `repeat` item with arrays and optional `separator` |
| `pattern-path` | One primary, optionally with one path token | Primary alone, or descendant, first, or last path |

The reader maps `=` U+0338 to `≠`, `∈` U+0338 to `∉`, `⊆` U+0338 to `⊈`, and `≅` U+0338 to `≇`. It does not normalize decoded strings. An include path decodes escapes within the token's original literal runs.

For a string token, the reader removes its quotes and decodes every escape. Literal runs retain their decomposed token values. Escape results remain exact, and the result is always `string`. Include paths use the original literal runs with the same escape decoding. Neither form receives further normalization.

Header, alternative, and item clauses use the same channel constructors. The reader looks up tags, value, then image. A value clause cannot supply an image clause's recipe. Attachment names come from their capture-reference parts, never from their emitted strings.

For example, `%rule r := "v" :- "i" | "a"` supplies distinct header recipes. Its `value-clause` gives `value:{"concat":[{"string":"v"}]}`. Its `image-clause` gives `image:{"concat":[{"string":"i"}]}`. `%emits` supplies one whole-constituent item, while `%erased` supplies `erased:true` without an emission.

A tag run or string run forms one union in written order. Any union operand that is itself a union flattens into its enclosing union. This applies to runs and explicit `∪`, including either form inside grouping parentheses. Parentheses make no DOM node. For example, `A ∪ (B ∪ C)` becomes one three-operand union.

Difference retains both operands. Term intersections retain their written nesting until type resolution. Pattern-valued intersections then flatten nested intersections. Thus `(A ∪ B) ∩ C` keeps the union as one intersection operand.

A run requires parentheses when the operator token immediately before or after it is `∩` or `∖`. A leading `∩` counts. Spaces and comments do not affect this adjacency. Without parentheses, the reader reports a document error at the run's first tag name or string token. It tests placement before reading the parts.

A tag run requires at least two `tag` parts, and a string run requires at least two `string` parts. Thus `:: ∩ Word BY` fails at `Word`, and `A ∪ B C ∖ D` fails at `B`.

A string atom in a pattern uses `literal` with its decoded `string` and the quote's source position. A user constant atom uses `constant` and its source position, whatever its eventual type. Binding interprets it as a string terminal or a pattern predicate without changing the cached DOM. Tag then value tests can wrap either form. Tested user atoms must resolve to strings.

The following compact examples show the additional conversions. Positions illustrate the corresponding written token's start.

| Source form | Converted form |
| --- | --- |
| `"‹U+0061›"` | `{"literal":{"string":"a"}}` |
| `#"‹U+0061›"` | `{"pattern":{"literal":{"string":"a"},"at":[1,2]}}` |
| `#$S` | `{"pattern":{"constant":"S","at":[1,2]}}` |
| `#$S="x"` | `{"pattern":{"test":"=","value":{"string":"x"},"expr":{"constant":"S","at":[1,2]}}}` |
| `:: $f.tags ∪ Run-Initial Run-Final` | `{"union":[{"method":"tags","receiver":{"capture":"f"},"args":[]},{"tag":"Run-Initial"},{"tag":"Run-Final"}]}` |
| `A ∪ (B ∪ C)` | `{"union":[{"tag":"A"},{"tag":"B"},{"tag":"C"}]}` |
| `(Word BY) ∩ $l.tags` | `{"intersection":[{"union":[{"tag":"Word"},{"tag":"BY"}]},{"method":"tags","receiver":{"capture":"l"},"args":[]}]}` |
| `"a" ++ "‹U+0301›"` | `{"concat":[{"string":"a"},{"string":"\u0301"}]}` |
| `$x.value` | `{"method":"value","receiver":{"capture":"x"},"args":[]}` |
| `Word ∪ ($c ⟹ $c.value.classify(lexicon))` | `{"union":[{"tag":"Word"},{"if":{"captured":"c"},"then":{"method":"classify","receiver":{"method":"value","receiver":{"capture":"c"},"args":[]},"args":[{"classifier":"lexicon"}]}}]}` |
| `%emits ($b) $w ($a) :- "i"` | `{"items":[{"capture":"w","image":{"concat":[{"string":"i"}]},"before":["b"],"after":["a"]}]}` |
| `%rule r f? A ≻ B :: ∅` | ALT has gate `f`, ranked refs `A`,`B`, and `tags:{"emptySet":true}`. |

The full ranked alternative is `{"guards":[{"feature":"f","kind":"gate","negated":false}],"expr":{"ranked":[{"ref":"A"},{"ref":"B"}]},"tags":{"emptySet":true}}`. Its common clause belongs to the whole alternative and never to an individual option.

An Integer token contains one or more ASCII decimal digits. It is legal only as a method argument whose signature accepts an integer. The reader requires positive digits without leading zeros. It reports zero or leading zeros at the Integer token. A negative argument fails lexical recognition at its minus sign.

Reader method signature errors stand at the method receiver, including wrong target kinds, receiver kinds, arities, and noninteger arguments. A wrong argument separator stands at the first argument. Empty arguments, grouped choices, grouped integers, and fractions follow the syntax-error rule below. That rule also locates mixed runs and adjacent constants without an operator.

Reader set type errors stand at the set expression or comparison that requires incompatible kinds. A guarded consequent error stands at its guard. Errors that binding reveals follow the stitching locations below. Unresolved query rule names are stitching errors at their definition. A recursive query gives a parse-time grammar error without a document location (§4).

The lexical stage reads the longest punctuation token. `...` is one chain marker, never `..` followed by `.`. A range joins two scalar string endpoints with `..`. `.` selects a method. Header clauses use `::`, `:=`, and `:-`, while `:` binds a capture. Both readers follow the lexical forms above.

`+` is the elision marker, and `++` is the string concatenation operator. Braces and `/` delimit repetition. Inside a string, braces and slash are literal characters. Strings accept single-guillemet escapes, and backslashes are ordinary string characters. Outside strings and comments, a bare backslash in grammar text is an error. Comments can contain `(* see C:\temp *)`.

A document can hold several errors. The reader reports one, and every reader chooses the same one, in this order:

1. Lexical recognition runs first. A lexical error stands at the furthest character that the lexical stage reaches. No escape or syntax inspection occurs after that failure.
2. After successful lexing, escape inspection visits string and include-path tokens in source order. It examines each token's original escapes from left to right. The first malformed, nonscalar, or unknown escape fails at its opening `‹`. The step precedes every syntax or reader error.
3. Syntax recognition runs next, over the complete token sequence. A syntax error stands at the furthest token reached and precedes every reader error. The hand-written bootstrap reader follows the same lexical, escape, and syntax steps.
4. Within a rule, the reader reads the definer, name, flags, and header tag, value, and image clauses before the body. At each construct in an alternative's expression, the reader makes sure that its form meets the rules. It examines constructs in text order, each form before its contents. So it reports the first error of the first construct in the text that has one, with these steps for each construct:
   - A tested primary: first the target and test order, at the first test that is not allowed there. A repeated kind or a tag test after a value test is an error at that later test. These checks precede the primary's contents and all test operands. So `{$c:B}="b"` and `[+KU $x:A]="a"` are errors at the test.
   - A capture: first a capture inside braces, then one inside an elidable optional, then `$` that wraps something. Then come a name that is not all lower case and a capture that wraps anything but one symbol. Each stands at the capture, before what it wraps.
   - An optional: first two markers, at the second. Then an elidable optional that is not of the form below, at its `[`. Last, what it holds through the ordinary symbol-test rules. So `[+KU | $x:A]` is an error at the `[`, and `[+KU≠"ku" $x:A]` at the `$x`.
   - An `&`: more than 16 items, at the `&` construct, that is, at its first item. This comes before any of its items, since the bound is its own form. So an `&` of 17 items is an error at its first item, whatever error a later item holds.
   - Braces: first two markers, at the second, or a marker after the separator, at that marker. Then a chain that is not the whole expression of its alternative, at its `{`. Last, the item and the separator. So `A {$c:B ... / S}` is an error at the `{`, although its marker follows the capture.
5. After the whole alternative expression, the reader detects repeated capture names before that alternative's clauses. The rule below defines this test.
6. Each alternative supplies guards, an expression, then tag, value, and image clauses. Header clauses already precede these under step 4. Conditions follow the complete body, then emission or erasure. Whole-definition errors follow all local construct errors.

   Each clause has its own errors. Examples are tags made of the constituent's own tags and a comparison whose sides do not fit. Such an error stands at the clause, or at the part of it that is wrong. These errors come in the order of the text. The checks of the whole definition below come last, and they stand at the definition.
7. The bound on nesting is 256 compound nodes. After the reader reads every item without an error, the loader makes sure that the whole DOM meets this bound. So every other error of reading comes before it, in any item. That includes an error inside the deep part, and one in a later item. Among the items too deep, the first decides, as the paragraph of that error says.

   A reader has no other bound on nesting. Parentheses can nest without limit, since they make no node. A reader reads a document of any depth to this check.
8. The reader examines a document's items in their written order. The first item with an error decides, whatever kind of item it is.
9. A stage's documents are read in the order in which its pipeline includes them (§13), and the first document with an error of reading decides. Every document is read before the loader stitches the stage. So an error of reading in any document comes before an error of stitching (§2). Errors of stitching come before the errors of lowering, which a parse finds (§3).

Within one constant definition or implication, the reader reports the error whose position comes first in the text, whichever check finds it.

These steps make every reader report the same token for every combination of errors.

The following complete document reports a capture error at line 2, column 9. The syntax stage recognizes the grouped target, and the reader rejects it at `$x`.

````markdown
```jbogenbau
%rule r $x:(A)
```
````

With an incomplete second rule, its syntax error precedes the first rule's capture error. The reader reports the furthest position reached by syntax recognition, rather than line 2, column 9.

````markdown
```jbogenbau
%rule r $x:(A)
%rule s (
```
````

The following complete document reports an invalid test target at line 2, column 12. The syntax stage recognizes the tested optional, and the reader rejects it at `=`.

````markdown
```jbogenbau
%rule r [A]="x"
```
````

For `%rule r A="x"<B>`, the reversed order is an error at `<`, column 14. For `%rule r A<B><C>`, the repeated kind is an error at the second `<`, column 13.

A tree from a bootstrap of another notation can also lack a part that a construct requires (the table of parts above). The reader then reports the missing part at the construct, as soon as it looks the part up. So the order of the lookups decides between a missing part and another error of the same construct. Each construct looks up its parts, and makes its checks, in this order:

- A `rule`: its `definer` and token, then its `rule-name` and token, then its optional `rule-flags`. If flags exist, first reject them on an extension. Then require one or more `rule-flag` parts. Read each flag's token in text order. Reject an unknown value before a repeated value.

  Next, the rule reads header tags, value, and image clauses, in that order. Only then does it look up `body` or `headed-body` and read alternatives. Trailing conditions and emission or erasure come last.
- A `tested`: require at least one test, then look up tag and value tests in that order. Retain all tests in written order, including repeated kinds. Next look up its `primary`. Check the target and test order before reading the symbol, then read requirements and operands. A missing required part is reported when its lookup occurs.
- A `capture`: the checks of its place (inside braces, inside an elidable optional), then its token and its `primary`. Then come the checks of `$` and of the name. Last come the one known part of the primary, the base-symbol check, and that symbol. For a tested target, inspect only its base primary. The `tested` constructor checks its tests.
- An `optional`: its `choice`, then its markers, then the form of an elidable optional, and then its content through the ordinary symbol-test rules. So an `optional` with two markers and no `choice` is an error at the `optional`.
- A `repetition`: its `choice`s, then its markers, then the placement of a chain, and then the item and the separator. So a `repetition` with two markers and no `choice` is an error at the `repetition`.
- A `group`: its `choice`, and then its content.

Inline `++` in body terminals, value tests, pattern terminals, range endpoints, or classifier keys fails syntax recognition at `++`. A grouped classifier key fails syntax recognition at its opening parenthesis. These syntax errors are document errors of kind `grammar`.

The grammar does not state the restrictions below. Each of these is an error of the document. The reader reports it at the first token of the offending construct, unless the item names another place.

- A rule flag other than `leftmost-longest` or `fewest` is an error at the flag. Two different flags on one rule are an error at the second flag. A repeated flag is an error at the repeated flag. Parentheses on `%extend-rule` are an error at their opening parenthesis. These examples start at column 1. So `%rule(lazy)`, `%rule(leftmost-longest,leftmost-longest)` and `%extend-rule(leftmost-longest)` report columns 7, 24 and 13, respectively.

  Empty parentheses and arguments fail before the reader reads a tree. Empty parentheses report the closing `)`, column 7 in `%rule()` and column 16 in `%redefine-rule()`. `%rule(leftmost-longest(1))` fails the syntax stage at `(`, column 23. A parenthesized argument made of valid tokens fails the syntax stage at its opening `(`. A supplied notation tree with no `rule-flag` reports its missing part at `rule-flags`, after the extension check.
- A rule name that is neither an eligible emoji scalar nor a name beginning with `a` to `z` is an error at the name. Thus `%rule Foo A` fails at `Foo`, column 7.
- A capture that wraps anything but one symbol is an error, `$x:(B)`, `$x:(A | B)` and `$x:[B]` included. A symbol is a rule reference, call, parameter, tag terminal, string terminal, range, wildcard, or a tested form of one. The capture check ignores the target's test count and order. The `tested` constructor reports any test-order error.

  Thus `%rule r $x:A<B><C>` fails at the second `<`, column 16. `%rule r $x:A="a"<B>` fails at `<`, column 17, because a tag test cannot follow a value test.
- A capture whose name has a capital is an error. Capture names are all lower case.
- A grouped value-test operand is a reader error at its opening parenthesis.
- A body constant must resolve to a string terminal or scalar range endpoint. A tag-set or pattern constant in that position is a document error.
- `$` cannot bind a symbol. A named lowercase capture uses `:` to bind one symbol, optionally tested.
- A capture name that one production of an alternative holds twice is an error. It is reported at the second capture in the text that such a production reads. Several productions can read a name twice, at different second captures. The error then stands at the one of those captures that comes first in the text. So `($x:A | $y:B) ($y:C | $x:D)` is an error at `$y:C`, the second capture of the production `B C`. `A D` reads `$x` twice too, but its second capture, `$x:D`, comes later.

  The productions are the expansions of §3.2, taken before any gate applies. So the error does not depend on the features: `f? [$x:A] $x:B` is an error with `f` off too. A name in two branches of a choice is no error, since no expansion reads both, as in `A ($x:B | $x:C)`. A name in two items of `&`, or in an optional and beside it, is an error, since some expansion reads both.
- A test requires a rule reference, call, terminal, or parameter whose argument is one symbol. Other targets cause an error at the test. So a test after a group, an optional, braces, a capture, or `ε` is an error. The syntax grammar permits tests after any primary, in any number and order. After a capture binder, source tests belong to its target. Only a supplied notation tree can test the capture itself.

  A symbol accepts one tag test followed by one value test, with either test absent. Every other sequence fails at its first disallowed test. A repeated kind or a tag test after a value test therefore fails at the second test.

  Pattern atoms use the same target and order checks as a tested primary. Both checks stand at the first test that is not allowed there. Thus `%rule r $c:A %conditions $c ≅ #(sumti="x")` fails at `=`, column 38. In `#(sumti<B><C>)`, the target check fails at the first `<`.
- A `repetition` with two or more markers is an error, reported at the second marker. A marker after its second `choice` is an error, reported at that marker, since the separator has no marker. The bundled syntax grammar never gives such a node, but a bootstrap of another notation can (`docs/api.md`). So every reader decides these cases the same way, and never by which marker it meets first.
- A capture inside braces is an error, reported at the capture. A capture that wraps braces is an error by the first item of this list.
- A capture inside an elidable optional, an `optional` with a marker, is an error at any depth, reported at the capture.
- An `optional` with two or more markers is an error, reported at the second marker. The bundled syntax grammar never gives such a node, but a bootstrap of another notation can.
- An elidable optional that is not of the form of §3.8 is an error, reported at its `[`. Before the reader drops groups, it makes sure that the notation tree meets this rule. The hand-written bootstrap reader builds the same tree, so it makes the same check. The `optional`'s `choice` must be one `conjunction` of one `sequence`, with no leading `|` before the conjunction and no leading `&` before the sequence. This is the one place where a leading separator is not allowed: `[+| KU]` and `[+& KU]` are errors. A choice in parentheses later in the optional can still begin with `|`, as in `[+KU (| A | B)]`.

  The first `primary` of that sequence must be the terminal itself or a declared parameter. A written terminal is a `reference` whose name begins with `A` to `Z`, or a `tag`. It can also be a `tested` whose primary is that tag or parameter with an existing symbol-test comparator. So a `group` there is an error, even of one terminal or around the whole content.

  `[+(KU) 🆓]`, `[+((KU)) 🆓]`, `[+(KU 🆓)]` and `[+(KU 🆓) A]` are errors. So are a choice, an `and`, a rule, `🆓`, a string terminal or wildcard in first place. The same holds for a range, an engine tag, `ε`, braces and an optional.

  A DOM cannot show a group, so its own requirement is on the normalized form. The `expr` of an elidable `optional` must be its terminal, or a `seq` whose first expression is its terminal. After expansion, the terminal is a `ref` with a capitalized non-engine tag name. Before expansion, it can instead be a declared `param` node. Tests can wrap that tag or parameter. Substitution must give the parameter exactly one bare user tag before applying the written head tests.

  Every DOM that a reader makes meets this requirement. A supplied DOM `{"optional":{"seq":[{"ref":"KU"},{"ref":"🆓"}]},"elidable":true}` is well formed, whatever text it came from. `[+(KU 🆓) A]`, whose first expression is a `seq`, has no well-formed DOM.
- A chain, a `repetition` with a marker, that is not the whole expression of its alternative is an error, reported at its `{`. The whole expression is the alternative's `conjunction` when that is one `sequence` of one `primary`, the `repetition` itself. So a chain inside a group, an optional, other braces, a capture or a test is an error. So is a chain in a sequence, a choice or `&`, although a group makes no node of the DOM. The lowering of §3.3 makes sure that the chain's alternative is the only one of its rule.
- A range whose start is above its end is an error, reported at the range.
- An engine tag name outside §1's inventory is a document error at its token. Long aliases and wrong-case names are invalid.
- The reader applies `lit` to rule-header, alternative, and emission-item tag clauses (§1). Nonempty `lit` is an error at the first retained engine-tag literal.
- A range in a term or condition is a document error. Property conditions instead read stored tag membership.
- A value-test operand must resolve to a string. Any scalar string is legal, including capitals and commas. No engine normalization or canonical-value restriction applies.
- Value tests require a string literal or string constant. Equality-tested omissions save that scalar for restoration (§7). A string set supplies no unique saved value, so value tests exclude string sets in bodies and patterns. Tag tests require signed tag names or tag-set constants. A capture, input method, or guarded term is invalid in either operand.
- A test with the wrong operand type is a document error at its operand. `LE=Word` and `LE<"la">` are invalid. A symbol can combine a tag test followed by a value test. Repeated kinds and reversed order are errors at the second test.
- An unknown method, wrong arity, or wrong receiver type is a document error at the method. Section 10 lists all signatures. `.without-elision` requires a bare capture. The error for `$x.onward.without-elision` directs the author to `$x.without-elision.onward`. Capture analysis follows every receiver and argument.

  `.without-elision` takes exactly one bare capture, including `$`. Reject `$x.onward.without-elision` and direct the author to `$x.without-elision.onward`. `.without-elision-except` takes the same receiver and exactly one argument, a rule name. Reject `$x.onward.without-elision-except(F)` and direct the author to `$x.without-elision-except(F).onward`. Neither restoration method can take the other's result as its receiver. Capture-use analysis and private readiness follow captures through nested span calls.

  A method's receiver and arguments must meet §10's signature after method selection. The reader reports a wrong receiver or arity at the method. A classifier or rule name is legal only in its corresponding argument position. A string constant can resolve a string argument after stitching.
- A `split` whose delimiter is the string literal `""` is an error, reported at the call.
- A `.verbatim-text` or `.emitted` read outside a recipe is a document error. A recipe accepts only the seven string methods and string atoms of §11.
- A constant declaration requires a capitalized constant name. A string in that position is a document error.
- A constant's value that is not a closed term (§10) is an error, reported at the first part that is not closed. Captures, `$`, guarded terms, and input methods such as `.value`, `.source-text`, `.tags`, `.classes`, or `.classify` are errors there.
- An engine-tag literal in a constant's value, outside a pattern literal, is an error at that literal.
- An engine tag on either side of `%implies` is an error at that tag.
- A side of an implication that is not a closed term is an error, reported in the same way. A side whose type is not a tag set is an error too, reported at the side.
- A classifier's name that does not begin with `a` to `z` is an error, reported at the name. `.classify` cannot name it, since a bare name with a capital is a tag.
- A warning on a classifier's entry is an error, reported at the warning. An entry takes gates only.
- A classifier key must resolve to a scalar string. Capitals and commas remain exact characters, with no canonical comparison requirement.
- A classifier class must start and end with uppercase ASCII letters and never start with `_`. A mark such as `Indicator` is invalid there.
- A term or condition with incompatible types is an error (§10). Examples include `"a" ∈ $x.tags`, `$x.value = A`, and the untyped `∅ = ∅`. The reader reports the smallest construct whose parts disagree. This construct is a union with differences, intersection, concatenation, guarded term, method, or comparison. A concatenation error stands at its first operand. Otherwise, the error stands at the whole tag term or constant value.

  The reader does not know the type of a constant, so it lets a constant stand for a value of any type but a span. After the loader stitches the stage, it makes sure again that the types agree (§2). It reports an error there at the first constant of the smallest construct whose parts disagree.
- After method selection, a capture or span converts to its input value when a string is required or in `=` or `≠` (§10). It cannot convert to tags, sets, or patterns.
- A bare name that does not begin with a capital is an error where a value is needed. Such a name is a rule or a classifier. A rule name is legal in `.tags`, `.matches`, `.begins`, `.ends`, `.without-elision-except`, `.followed-by`, and `.preceded-by` arguments. A classifier name is legal only in `.classify`.
- `.matches`, `.begins`, `.ends`, `.starts-input`, `.ends-input`, `.followed-by` or `.preceded-by` as a value term is an error.
- An `&` of more than 16 items is an error.
- A DOM node at depth greater than 256 is an error. Depth counts compound ancestors, from zero at each root. The following rules cover every form in `docs/output.md`.

  Each alternative expression, condition, tag term, recipe, constant value, classifier key, and implication side starts at depth zero. Feature conditions also start at depth zero. An emission item's tag term and recipes also start at zero. Declarations, alternatives, emission lists, emission items, arrays, positions, guards, and signed requirement records add no depth. A recipe root always uses `concat`, including for one atom. Other `concat` nodes require at least two string operands.

  | Form | Depth of its children |
  | --- | --- |
  | Expression `seq`, `choice`, `ranked`, `and`, `optional`, `repeat`, `capture`, or `test` | Parent depth plus one |
  | Expression `literal` or `range` | Parent depth for the string term or each endpoint |
  | Term `union`, `intersection`, `difference`, `if`, `concat`, `method`, or `pattern` | Parent depth plus one |
  | Condition `any`, `all`, `not`, `if`, `method`, or comparison | Parent depth plus one |
  | Pattern `union`, `intersection`, `difference`, path, or `test` | Parent depth plus one |
  | Pattern `literal` or `range` | Parent depth for the string term or each endpoint |
  | Node test or bare list with `children` | Each child item is at the node's depth plus one |
  | Pattern child `choice`, `optional`, `repeat`, or `child` | Parent depth plus one |

  A repeat's item and separator have the same depth. A test's target and operands count from the test's depth. A guarded term's condition and result count from the term's depth. A method's receiver and term arguments count from the method's depth. Rule, terminal, classifier, and integer arguments add no depth. A `pattern` term adds one before its pattern's root, and each subsequent pattern constructor continues that count.

  A call adds one depth level before each argument. Argument category wrappers add no depth. Parameters are leaves.

  Sibling items share their depth, regardless of array length. The `children` array adds no depth. A `child`, `choice`, `optional`, or `repeat` wrapper adds one level before its contained patterns or items. A repeat's item and separator arrays share that level. An exact prefix adds no depth.

  In the term `#« a b »`, the term wrapper starts at depth zero. The bare-list pattern is at depth one. Both `child` items are at depth two, and both names are at depth three. More siblings do not increase those depths.

  Expression `ref`, `wildcard`, and `empty` are leaves. Term `string`, `tag`, `const`, `capture`, and `emptySet` are leaves. An integer argument is a leaf. Condition `captured` is a leaf.

  Pattern names, terminals, constants, wildcards, and parameters without children are leaves. Child `siblings` is a leaf. A `concat` term adds depth under the term rule.

  Parentheses make no DOM node and add no depth. Thus 256 optional wrappers around a reference or a plain string literal are allowed, and 257 are not. The reader reports the first offending declaration in document order. That declaration is a rule, constant, classifier, implication, or `%features` directive.
- A whole `$` carrier conflicts with a captured carrier or attachment capture that can consume input. Multiple `$` items require a structurally always-empty constituent under the overlap analysis below. Inserted items do not overlap carrier input. The loader reports an overlap error at the emitting definition after stitching, as the analysis below specifies.
- An inserted `ε` item can carry tags, value, and image clauses. Its defaults are empty, and empty output tag sets are legal.
- A bare name is not an inserted item. Use `ε` with explicit tag and string clauses.
- A bare range or property is not an emission item. Capture its matched symbol or insert with `ε` and explicit clauses.
- `:: ∅` is a legal item tag clause. Strings and `_` can read the resulting ordinary token.
- An attachment (§11) that holds `$` is an error, reported at the attachment. An attachment holds a named capture.
- An attachment on a `$` item or on an inserted item is an error, reported at the item. Only a named capture carries attachments. So a constituent never attaches to itself.
- A capture other than `$` named twice in one emission, as an item or as an attachment, is an error. So an attachment capture is never an item of its own.
- A rule's or an alternative's tag term cannot read the tags that it defines. A read of `$.tags` or `$.classes` in that term is an error. `$.first-token.tags` and the like read the tokens' tags, not the constituent's, and are allowed, as is `$.tags(R)`.
- An unknown directive or keyword is an error. The syntax grammar already refuses it.
- A directive with the wrong operands is an error, reported at the directive. `%stage`, `%extend-stage`, and `%redefine-stage` take one name. `%include` takes one include path, and `%features` takes one or more feature names as §9.1 defines them. `%ambiguity-resolution` takes a ranking name and optionally `elision-only`.

A template first undergoes binder and syntax analysis (§2.3). Argument-dependent requirements apply after substitution to every expanded definition.

Once the reader reads an ordinary definition (§2), it makes sure that the whole definition meets its requirements. These checks are about the productions of the definition's alternatives, the expansions of §3.2 with the captures of §3.5. Gates do not matter here, so every alternative counts. Two expansions of one alternative that read the same captures in the same order are one case for these checks. So the reader can decide them over the distinct sequences of captures that the expansions read, without listing the expansions.

Each of the following is an error of the document too, and the reader reports it at the definition:

- A capture that no alternative of the definition captures is an error, in any clause, `$x` presence tests included.
- A condition that applies (§3.6) to no production of the definition, whatever features are enabled, is an error.

A condition item holds at most one boundary atom. If the receiver of its atom is a capture, the item reads no other capture and no `$`. A boundary atom stands only in `%conditions` and in an emission item's tag clause.

Its target is one ordinary rule, exact instance, user tag, or a choice of these. `🆓` counts as a rule name. Each target must be one that some recognition can build. It is a rule reachable through body references from `text` or from the rule argument of a nested query. Or it is a tag that such a rule reads as a terminal.

A terminal argument of `.matches`, `.begins`, or `.ends` also makes that tag buildable. Every alternative counts, even when evaluation never reaches it. Gates do not count.

A receiver cannot be a list capture or a method of one. Each violation is a document error at the atom, at the name, or at the second atom. The limit of one atom per item and the receiver limit bind `%conditions` only. An emission tag clause can hold several atoms, because it reads the chosen derivation.

- A tag term that uses (§3.6) a capture that a production it serves lacks is an error. An alternative's own tags serve the productions of that alternative, and the rule-level `::` clause serves every production of the definition. An emission item's tags serve every production in which the item is not dropped.
- A selected recipe that uses a capture that a production it serves lacks is an error. An alternative recipe serves that alternative's productions. A rule-level recipe serves each production where no alternative recipe overrides it on that channel. An item recipe serves each production where its item remains.
- A recipe beside `%erased` is a document error. A retained parent item over an erased capture can supply strings while its counted parts remain empty.
- In an emission, captures written in an order other than the one in which some production reads them are an error. The written order runs item after item. Within an item, it runs through the before-attachments, the carrier and the after-attachments. For each production, the reader makes sure that the captures that the production has stand in the written order of the emission. So `%emits ($a) $c, $b` is an error when a production reads `$a`, `$b` and `$c` in that order.

  The check is well defined per production, because a production holds each name at most once (§3.5). So each name of the emission stands for at most one part of the production. Those parts have one order, the order in which the production reads them. A name that stands in several branches is the part of whichever branch the production took. So `($a:A $b:B | $b:B $a:A)` with `%emits $a, $b` is an error, because the second production reads `$b` first.

  The same holds for attachments. An attachment capture names at most one part of each production. So the item's before-attachments, carrier and after-attachments have one order in each production. An inserted token anchors at a part of its next covering item, at the whole constituent, or at the constituent's end (§11).
- In an emission, an attachment capture in a production that lacks the carrier of its item is an error.
- An inserted item whose next covering item has an absent named carrier is a document error. The next covering item is the first following `$` or named capture item, skipping inserted items.
- A production for which every item of the emission is dropped is an error. It emits nothing although the rule lists what to emit. A rule that erases its constituent says so with `%erased`. So `A [$b:B]` with `%emits $b` is an error, because the production `A` emits nothing.

An undefined family rule is an error at the definition that contains the call. The call can stand in a header or alternative tag clause, a condition, or an emission item's tag clause. The loader checks names in the order of its reference check. It reads each alternative's body and tag clause, and with a definition's first alternative, the header tags, the conditions and the emission items.

An active constituent recipe cycle is a document error (§11.3). The loader visits rules in expanded order (§2.3), then alternatives and their expansions in ordinary order (§3.2). Within each production, it examines value before image. It follows effective recipe dependencies depth first in the atoms' written order.

The error stands at the first atom of the recipe whose dependency reaches a channel still active on the current path. The dependency path runs from the first active channel to that recipe. An implied image counts as the value recipe that it reuses.

Two of these checks depend on simplification (§3.6). They are the check that a condition applies to a production, and the check of the captures that a tag term uses. In simplification, a constant is its value, and the reader does not know that value. So the reader leaves these two checks to the loader for each clause that holds a constant. The loader makes them after it gives the constants their values (§2), and it reports an error at the definition. The check that some alternative captures each mentioned capture does not depend on a value, so the reader makes it for every clause.

Emission overlap uses a conservative structural analysis of the final stitched stage. The loader runs it after all other stitching checks, including ranked-choice validation, and before lowering. All remaining rules participate, including unreachable rules. Replaced rule definitions do not participate.

The analysis ignores feature gates, conditions, and symbol tests. It therefore covers every feature configuration without proving that a consuming route can succeed. Erasure changes output ownership but never removes a possible input read. Recipes and emissions do not change the analysis.

Initially, every string, range, wildcard, or tag terminal is consuming. `ε` is not consuming. A composite expression is consuming when any operand is consuming, including an optional body, repeat item, or repeat separator. Captures and groups use their contents. A rule reference is consuming when any alternative of that rule is consuming.

Propagate consuming marks until none changes, starting with terminals alone. Recursive references without a reachable terminal remain unmarked. Recursion with a reachable terminal becomes consuming. This does not require a finite successful derivation. Thus `z → z` is unmarked, but `"a" z` is consuming even though its branch is unproductive.

Each expanded production is analyzed separately. Its whole `$` carrier uses that production's expression. A named carrier uses its captured symbol, with references using the complete target rule's alternatives. Structurally always-empty means unmarked by this analysis. An absent carrier drops before overlap comparison, while an inserted item has no input span.

For each production, two whole carriers conflict if its expression is consuming. A whole carrier conflicts with every consuming named carrier or attachment capture in that production. Distinct named carriers and attachment captures remain disjoint under the capture rules. These tests concern input positions, even when every successful recipe yields an empty string.

The loader reports a document error at the definition that supplies the emission. It visits final rules in expanded order (§2.3), then alternatives and expanded productions in their established order. Within a production, it compares surviving item pairs in written order. Each pair compares its carriers and attachment captures in before, carrier, after order. The first conflict determines the error. All preceding document and stitching errors retain their priority.

For example, a carrier referencing `e → ε | "a"="b"` remains consuming. The failed test does not legalize `%emits $, $x` over `$x:e`. A gated consuming branch has the same effect. An erased consuming child also remains consuming for this overlap test.

For `r → $e:empty $a:word`, with `empty → ε`, `%emits $, $e ($a)` is a document error. The whole carrier conflicts with the consuming attachment `$a`, although `$e` itself is always empty. The error stands at the emitting definition.

A document's items are its rules, its directives, its constant definitions, its classifiers and its implications. The DOM keeps them in five lists, each in the order written. All five lists are present, including when empty. Every item has the position of its first token, so the order of all of a document's items is the order of their positions.

A DOM is malformed in each of these cases, whether it is read, cached or in the bootstrap. Template-dependent types defer until expansion (§2.3).

- It lacks any of the five declaration arrays, or one is not an array.
- Two of its items share a position.
- A template, binding, call, parameter, or argument violates the forms of §2.3 or `docs/output.md`.
- A rule's name is neither an eligible emoji scalar nor a name beginning with `a` to `z`.
- A rule lacks `flags`, or its value is none of `[]`, `["leftmost-longest"]` and `["fewest"]`. An `extend` rule must have `[]`.
- It has an expression, a term or a condition with members of two forms, or with a member that its form lacks (`docs/output.md`).
- It has a `ref` that is neither a valid name nor an eligible emoji scalar.
- It has a `ranked` value that is not an array of at least two expressions. Report `ranked-choice-syntax`.
- Its `chain` is neither `left` nor `right`, or its chain repeat does not occupy the complete alternative expression.
- It has an `optional` with an `elidable` member whose value is not `true`. It has an elidable `optional` whose expression the reader refuses (above).
- It has a capture that the reader refuses. That is one that wraps anything but a symbol, or one inside a `repeat` or inside an elidable `optional`. It is also a name that some expansion of an alternative holds twice (above), or a name that is not all lower case.
- It has an emission with a member other than `items`, or an erased definition with a recipe or emission.
- It has an alternative guard whose feature is not a feature name as §9.1 defines it. Or the guard has members beyond its feature, kind, and negation state.
- It has a directive whose name is not `ambiguity-resolution`, `stage`, `extend-stage`, `redefine-stage`, `include` or `features`.
- It has an `ambiguity-resolution`, `stage`, `extend-stage`, `redefine-stage`, `include` or `features` directive whose operands the reader refuses.
- It has an unsupported test position or comparator, an ill-typed string operand, or an invalid signed requirement. A value test can wrap a tag test. Repeated test kinds and reversed nesting are malformed. All scalar string values remain legal.
- It has a tag or tag-terminal `ref` outside the identifier rules of §1, or a tag clause with nonempty `lit` (§1).
- Its range does not contain two string terms resolving to ordered single-scalar endpoints.
- Its wildcard is not `wildcard:true`.
- It has a constant declaration whose name does not begin with `A` to `Z`. A `const` reference instead accepts either a user name or a valid scalar name from §9.1. Invalid underscore names and surrogate scalar names are errors at the reference.
- Its constant value is not closed, or it holds an engine-tag literal outside a pattern literal.
- Its method name, receiver, or arguments violate the method signature.
- It has a term or a condition whose types do not agree (§10).
- It has a classifier whose name does not begin with `a` to `z`. It has an entry with a warning, or with a gate whose feature is not a feature name as §9.1 defines it. It has an entry with no key, or with a key that the reader refuses. It has an entry whose operator is not `∈` or `∉`. Its class must start and end with uppercase ASCII letters and never start with `_`.
- It has an implication whose sides are not closed tag-set terms, or either side names an engine tag.
- Its `.classify` argument is not a classifier name, or a classifier name appears in another argument position.

The reader takes semantic names and syntax from token values, including rule names, tags, constants, features, classes, classifier keys, and methods. Include paths decode escapes within their original literal runs. Diagnostic positions count the original text.

String decoding preserves dollar signs literally. `++` joins string operands in conditions, constants, closed terms, and recipes. Include paths retain original spelling outside escapes. §9.1 defines string escapes and canonical diagnostic spelling.

A scalar range endpoint decodes as a string term and must resolve to exactly one scalar. The DOM retains the string term. An equal literal and constant resolve to one terminal identity. A reversed scalar range is a document error.

Pattern constructors use the authoritative table above. Readers retain every child-list boundary specified in `docs/output.md`, including empty and singleton lists. Parentheses add no boundary.

For `$x ≅ NAME`, report at NAME: `tree comparison requires a pattern; write #NAME, not NAME`. Substitute the actual name, including capital-initial terminals. The same diagnostic applies to `≇`, before a generic parse or type error.

Source captures, guards, elision markers, and chain repetitions inside patterns fail syntax recognition. A tree comparison with a non-capture left operand also fails syntax recognition. Supplied trees and DOMs still undergo the stated reader restrictions.

Readers reject missing parts, unknown members and invalid arities. Tests require terminal atoms and ordinary closed operands. Captures, guards, emissions, alternative tags, elision markers and chain repetitions cannot occur in patterns. Repeat bodies cannot match only empty sequences.

Child arrays retain their context throughout unresolved inspection. An optional accepts no `separator`, and only a repeat accepts that member. A sibling ellipsis cannot occur at a repeat's sibling level, including through optional, choice, or repeat wrappers. A `child` pattern starts another node and therefore another sibling level for its own child list. Supplied DOMs obey the same restrictions. Stage resolution includes every pattern in replaced definitions and uncalled templates.

If X is declared, `#« A @X »` and `#« ⋯ @X »` remain valid. Their closed items remain child items beside the parameter. A parameter postpones only the type or binding that its value determines. It never postpones the surrounding field, arity, context, or forbidden-gap rules. Source, supplied, and cached patterns all obey the exact schema in `docs/output.md`.

## 10. Terms and conditions

A capture `$x` is the span of the captured part, and `$` the span of the whole constituent (§3.5). `s.first-token` is the first token of `s`, `s.tokens-after-first` all but the first, and `s.last-token` its last token, each empty if the span is. `s.onward` is the span from the start of `s` to the end of the input of the parse that evaluates the condition. `s.following-tokens` runs from its end to the context end. `s.preceding-tokens` runs from the context start to its start. Both return ordinary spans, including empty spans at their respective context boundaries.

That input is the stage's input or, in a nested parse (§4), the span that the nested parse reads. The same holds in a tag term. The recognizer computes a constituent's tags while its parse runs. The stage computes an emission's tags after its parse, over its input.

`$x.without-elision` requires one bare capture and creates the restored query view of §4. `$` names the completed enclosing candidate. An arbitrary span has no constructed derivation from which to restore closes. Missing captures keep the condition simplification of §3.6.

`$x.without-elision-except(F)` creates the same restored view with the close family `F` (§2.2). Its queries use the relaxed comparison of §4. `.onward` keeps both the view and the family. Every other span method drops both.

`.onward` preserves a restored view and extends its match window to the context end. Repeated `.onward` retains the same fixed capture. `.first-token`, `.tokens-after-first`, `.last-token`, `.following-tokens`, and `.preceding-tokens` first project to original tokens, then return ordinary spans. They remove the alignment constraint. `$x.without-elision.following-tokens` therefore starts at the original capture end and reads the raw suffix.

`.source-text`, `.decomposed-source-text`, `.value`, `.image`, `.starts-input`, and `.tags` observe the original projection. A restored span carries no constituent tags, so `$x.without-elision.tags` unions original token tags. `.tags(R)` runs the aligned whole query and unions its witnesses' own tags. Patterns inside a witness observe its own projected structure.

During §7 reconstruction, `.without-elision` and `.without-elision-except(F)` take their closes from the current candidate's projected omission events. Neither borrows the selected main derivation's list. Neither introduces an additional synthetic token where that event already has one.

Terms include strings, string sets, tag sets, patterns, captures, and ordinary or restored spans. Method selection uses the actual receiver before implicit conversion to a value string. Captures never convert to tags or patterns. A bare capture used as a condition tests presence. Ill-typed combinations remain document errors.

| term | type | value |
| --- | --- | --- |
| `"s"` | string | the string |
| `Word`, `KOhA` | tag set | The singleton tag set |
| `s.image` | string | The input images concatenated in order (§5) |
| `∅` | a set or pattern of the kind its context gives | the empty set or always-false pattern |
| `#PATTERN` | pattern | the structural predicate in [Tree patterns](notation.md#tree-patterns) |
| `a ∪ b`, `a ∩ b`, `a ∖ b` | the type of `a` and `b`, two sets of one kind or two patterns | union, intersection, difference |
| `A ⟹ t` | the set type of `t` | `t` where the condition `A` holds, else `∅` |
| `s.value`, `s.source-text`, `s.decomposed-source-text` | string | §5 |
| `a.split(d)` | set of strings | the pieces of the string `a` between the occurrences of the string `d` (below) |
| `$x.emitted.value`, `$x.emitted.image` | string, recipes only | The selected string walk before the current item override (§11) |
| `s.ngrams(n)` | set of strings | runs of `n` adjacent code points in string `s`, including overlapping runs |
| `$NAME` | the type of its value | the value of the constant (§2) |
| `s.tags` | tag set | the captured part's constituent tags if `s` is a whole capture, else the union of the span's tokens' tags |
| `s.tags(R)` | tag set | the union of the tag sets of the completed items of `R` over `s` with an eligible proof tree (§4), or empty |
| `s.classes` | tag set | the tags of `s.tags` whose names start and end with a capital and never start with `_` |
| `a.classify(classifier)` | tag set | the classes that `classifier` gives the string `a`, for the features of the parse (§2), empty if no entry names `a` |
| `$x`, `$`, `s.first-token`, and the other span methods | capture or span | A method receiver or argument, converted to input value when a string is required |

In the check of §7, ordinary span methods read their receivers' projected spans. `.without-elision` and `.without-elision-except(F)` also retain the candidate's projected omission events. The input of `.starts-input`, `.onward`, `.preceding-tokens`, and `.following-tokens` is the stage's input, or the query's span of it (§7.5).

`a.split(d)` finds the occurrences of `d` in `a` from the left. Each search starts where the last occurrence ends, so two occurrences never overlap. The pieces are the strings before the first occurrence, between two occurrences and after the last one. The value is the set of the pieces that are not empty. So `"a..b.".split(".")` is the set of `"a"` and `"b"`, and `"aaa".split("aa")` is the set of `"a"`.

An empty delimiter is an error. A literal `""` or an empty string constant as the delimiter causes a document error (§2, §9). A computed delimiter in a rule condition causes a grammar error when a parse evaluates the split (§13). The whole parse fails with it. So `$x.value.split($y.source-text)` is such an error where `$y` is empty.

During loading, a joined delimiter in a rule condition can be empty. A parse that evaluates its `.split` rejects an empty delimiter. Closed operands do not change this. Feature conditions reject every closed empty delimiter during loading (§2). Constant evaluation also rejects joined empty delimiters during loading, at the `%const` or `%redefine-const` definition (§2).

Every tag name is written in the grammar. No method constructs a tag from a string. Values remain available for input-dependent comparisons.

`s.ngrams(n)` takes one positive decimal integer literal without leading zeros. An n-gram is a run of adjacent code points. Its value is the set of all length-`n` substrings, with duplicates removed. A string shorter than `n` gives `∅`, including when `n` exceeds any machine integer. Constants cannot supply `n` because the term language has no integer type. Noninteger, zero, negative, missing, and extra arguments are document errors.

A closed term reads no capture, span, query, classifier, or guarded term. It can contain strings, tags, constants, patterns, contextual `∅`, set operators, concatenations, and `.split` or `.ngrams` on closed strings. Ranges are terminals only. `.classify` is not closed because its classifier depends on features.

A constant value is a closed term with string, string-set, tag-set or pattern type. So is the value of a test (§2), whose type is a string or a tag set. So is each side of an implication, whose type is a tag set. The loader evaluates constants after resolving the stage's version graph (§2).

`..` joins range endpoints only in terminal syntax. It cannot construct a set in a condition. Stored property tests use tags, as in `_L ⊆ $c.tags`. Recipes use only the closed string language of §11.

`++` requires scalar strings on both sides. It performs no capture, span, tag, pattern, or set conversion. Use an explicit string method for captures and spans.

In a term or constant, adjacent string literals form a string set before `++` applies. Thus `"a" "b" ++ "c"` means `("a" "b") ++ "c"`. Its set operand makes the join a type error.

A guarded term binds less tightly than comparisons. Method selection binds tighter than `++`. Concatenation binds tighter than intersection, union or difference, and comparisons, in that order. It associates left. Parentheses group terms outside recipes.

The reader flattens nested concatenations in written order without folding their strings or resolving constants.

A concatenation is closed exactly when every operand is closed. Constant binding resolves each operand before joining its exact string. Written literal text already follows stage-zero decomposition. Concatenation performs no further normalization.

Body terminals, value tests, pattern terminals, range endpoints, and classifier keys accept string literals or string constants. Inline concatenation is invalid in these positions. A constant can hold a joined string.

String and string-set terms share forms where their required types permit them. These string positions occur in bodies, patterns, or classifier entries, where adjacent strings describe sequences or separate keys. One rule for all their string positions keeps the reading predictable. A constant can always hold a join.

Side-by-side strings in a body or pattern child list describe a sequence of tokens. `"e" "‹U+0301›"` reads two tokens. In a classifier entry, `"e" "‹U+0301›" ∈ K` gives two keys.

`"e" ++ "‹U+0301›"` produces one string: `e` followed by U+0301. A terminal with that value reads one token. A constant holding that value supplies one classifier key. The constant makes this change explicit.

In a set operation, a scalar string converts to its singleton string set. This includes empty strings, concatenated strings, string constants, and string method results. A capture or span never converts directly to a set. A lone string remains scalar.

`∪`, `∩`, and `∖` combine tag sets, string sets, or patterns of one type. Plain parentheses preserve type. `∩` binds tighter than `∪` and `∖`. Those two bind equally and group from the left, so `a ∖ b ∪ c` is `(a ∖ b) ∪ c`.

`∅` takes its kind from the other side of its operator or comparison. A tag term, emission item or tag test also gives it the required tag-set type. A guarded term supplies the set kind of its consequent.

In a `%redefine-const`, the type that the constant keeps (§2) gives the value its kind in the same way. So after `%const $A A`, `%redefine-const $A ∅` makes `$A` the empty tag set. An expression whose kind nothing gives is an error of the document. So `%const $E ∅` is an error.

`a = b` and `a ≠ b` compare two strings, two sets of strings or two tag sets. In these comparisons, a capture or span converts to its input value after method selection, on either or both sides. Thus `$open = $close` compares their values, as does `$open.value = $close.value`. When one side is a string set or contextual empty set, a scalar string on the other side converts to a singleton. Captures and spans compared with any set remain errors. Any other pair is an error of the document.

`a ∈ b` and `a ∉ b` test a string in a set of strings. `a ⊆ b` tests that every member of `a` is in `b`, and `a ⊈ b` that one is not. Both sides are sets of one kind, with scalar strings converted to singletons. Membership also accepts a scalar string as the singleton right operand.

`.matches(S)`, `.begins(S)`, `.ends(S)`, `.followed-by(S)`, and `.preceded-by(S)` share a nonempty target choice. Each target is an ordinary rule name, an exact instance, or a user terminal tag. Bare template targets are load errors.

Repeated targets are accepted and change nothing. Engine tags cannot be targets. Boundary targets identify grammar-built token classes, while engine tags describe stored character properties. All five methods share this restriction.

Targets use `|` separators, without constants or strings. Commas inside an exact instance call separate its arguments only. Parentheses around one target preserve that target. A grouped choice is invalid.

`s.matches(S)` holds when the span parses as any target, and `s.begins(S)` when a prefix does, and `s.ends(S)` when a suffix does (§4.4). Nullable rule targets include the empty prefix or suffix for the corresponding method. A terminal target reads exactly one token carrying its tag. Query alternatives evaluate left to right and stop at the first success or grammar error. Every target must resolve, including alternatives that evaluation never reaches.

Each alternative keeps the ordinary query bounds, recursion checks, and cache identity of a single-target query. All three read only eligible proof trees (§4). For `matches` and `begins`, a restored span adds alignment and preserves its separate context bound. A restored `.ends` receiver is a load error.

`s.starts-input` holds when the span begins where the input of the parse that evaluates the condition begins. That is the start of the stage's input, or, in a nested parse (§4), the start of the span that the parse reads. `$x`, as a condition, holds when the production has the capture `x` (§3.6), and `$` always holds. `¬c` negates. Conditions joined by `∨` hold when any does, and those joined by `∧` when all do.

`s.ends-input` holds when the span ends where the input of the parse that evaluates the condition ends. That is the end of the stage's input, or, in a nested parse (§4), the end of the span that the parse reads. In the check of §7, it compares the projected end with that input's end (§7.5).

`$x.followed-by(S)` and `$x.preceded-by(S)` are boundary atoms. §4.2 defines them and their evaluation. In an emission item's tag clause, they read the chosen derivation directly. An atom never raises a grammar error.

`A ⟹ B`, a condition, holds when `A` does not or `B` does. `⟹` binds looser than `∨`, which binds looser than `∧`. `⟹` groups to the right, and parentheses group.

Evaluating a condition can start a nested query and meet a grammar error. `.split` can fail with an empty delimiter. This section therefore fixes expression evaluation order. Section 4 fixes the order of ready conditions, symbol tests, and tag terms at one recognizer advance.

The engine evaluates conditions joined by `∧` or `∨` from left to right. Evaluation stops at the first that decides the whole: a false one for `∧`, a true one for `∨`. `A ⟹ B` evaluates `A` first, and `B` only if `A` holds. A guarded term `A ⟹ t` likewise evaluates `t` only if `A` holds.

Within a term, the engine evaluates operands, method receivers, and arguments from left to right. Comparison operands use that order too. If both operands fail, the left error wins. Constant evaluation follows the same order. For two failing `.split` calls in a set difference, the left call's error wins.

`A ⟹ t`, where `A` is a condition and `t` a tag set or string set, is `t` where `A` holds. Where `A` does not hold, it is the empty set of the same kind. A guarded term binds looser than `∪`, `∩` and `∖`, so it stands in parentheses inside any of them. Its condition must be well typed even when presence simplification removes it. A scalar string consequent converts to a singleton. An untyped `∅` consequent retains its context's set kind.

A tree comparison has operator `≅` or `≇`, a bare capture on the left and a pattern term on the right. Missing-capture simplification follows §3.6. After simplification, `≇` negates the same candidate's `≅` answer. A pattern literal is closed, and its value tests use string literals or constants, and its tag tests use tag sets.

Pattern union, intersection and difference combine predicates. Contextual `∅` supplies the always-false predicate. Pattern values do not support ordinary equality or implicit string conversion.

For a bare name after either tree comparator, report at that name. Use `tree comparison requires a pattern; write #NAME, not NAME`. Substitute the actual name, including KEhE, before generic parse or type errors. Other wrong operand types receive the ordinary expected-pattern error.

### Method signatures

| Method | Accepted receiver | Result |
| --- | --- | --- |
| `.value`, `.image`, `.source-text`, `.decomposed-source-text` | Capture or span | String from projected original input (§5) |
| `.onward` | Capture or span | Span from original start to context end |
| `.preceding-tokens` | Capture or span | Ordinary span from context start to original start |
| `.following-tokens` | Capture or span | Ordinary span from original end to context end |
| `.first-token`, `.last-token`, `.tokens-after-first` | Capture or span | Ordinary projected token span |
| `.starts-input` | Capture or span | Predicate on original start |
| `.ends-input` | Capture or span | Predicate on original end |
| `.followed-by(S)`, `.preceded-by(S)` | `$` or a bare capture | Boundary atom on the parse itself (§4.2) |
| `.matches(S)`, `.begins(S)` | Capture or span | Query predicate over a target choice (§4) |
| `.ends(S)` | Capture or ordinary span | Suffix query predicate, with restored receivers rejected during loading (§4.4) |
| `.tags`, `.classes` | Capture or span | Tag set |
| `.tags(R)` | Capture or span | Union over eligible whole-query readings |
| `.classify(classifier)` | String, or converted capture or span | Tag set from `classifier` |
| `.split(d)` | String, or converted capture or span | String set |
| `.ngrams(n)` | String, or converted capture or span | String set, with a positive integer literal argument |
| `.without-elision` | Bare capture only | Restored span |
| `.without-elision-except(F)` | Bare capture only, with one rule name | Restored span with a close family |
| `.verbatim-text` | Bare capture only, in a recipe | String (§11) |
| `.emitted.value`, `.emitted.image` | Bare capture only, in a recipe | Reconstructed string (§11) |

### Method selection and juxtaposition

Token selectors return an empty span if the original projection is empty. `.tokens-after-first` then returns that same empty span. Context methods can extend an empty receiver toward their context boundary.

`.onward` preserves restoration constraints, including through repeated calls. Other span methods discard them after projection. Neither restoration method can follow another span method. The error directs the author to `$x.without-elision.onward`.

A whole capture's `.tags` reads constituent tags. Other spans union their original tokens' tags. Span methods never retain constituent tags. A restored span's `.tags` reads only original token tags. `.classes` filters the same set for names beginning and ending with uppercase ASCII letters and not beginning with `_`.

The context is the stage's input or the nested query's bounds (§4). `.onward` and `.following-tokens` end at that context boundary. `.preceding-tokens` starts at the context start. `.starts-input` compares the projected start with that context's start. Recipe methods never start queries or use restored spans.

A tag literal denotes a singleton tag set. Juxtaposed bare tag names or string literals form one union atom. Both runs share grouping, flattening, and adjacency restrictions. Constant references and method calls require explicit operators.

Other tag atoms need operators. Adjacent multi-name atoms beside `∩` or `∖` require parentheses. Inside pattern guillemets, juxtaposition instead constructs child sequences. A pattern constant supplies no implicit surrounding pattern literal.

## 11. Emission

### 11.1 Emission walk and source spans

Every stage whose verdict is `unique` or `resolved` emits tokens by walking its chosen tree from the left. This includes the last stage, whose tokens are its output (`docs/output.md`), though no stage reads them.

- The stage walks the children of a constituent whose production has no emission, in order. A token that the constituent reads directly emits nothing.
- A constituent whose production has an emission emits exactly the items of the emission, as dropped for its production (§3.6). It emits them in the order in which the emission lists them. The stage walks nothing inside it but the attachment captures of its items (below):
  - A `$` item emits one token over its constituent, with inherited tags or its item tag clause. Two covering items cannot overlap input positions. Extra tokens use inserted `ε` items, with empty spans.
  - A capture item emits one token covering the captured part, with the part's own tags, or with the tags of the item's term. The token takes the attachments that its item names (below).
  - An inserted `ε` item emits an ordinary empty-span token. Its default tags and strings are empty. Clauses can supply both strings and tags.
- A constituent marked `%erased` emits nothing and supplies no counted parts. A merely unlisted part emits nothing but still contributes to a covering token. Erased source text remains inside the surrounding source envelope.

The tags that an item gives its token are the token's explicit tags. For each implication `A ⟹ B` whose `A` shares a tag with the token's tags, the stage adds the tags of `B`. It repeats this until no implication adds a tag, so the order of the implications does not matter. An implication only adds tags, so the repetition ends, also where implications form a cycle. Recipes and concatenation supply strings independently.

Implications apply to every token that the stage emits, an inserted one included, and to nothing else. They do not change a constituent's tags, the value of a term or classifier, or a token of the stage's input. A later stage applies only its own implications. The synthetic tokens of §7 are not emitted, so no implication applies to them. No derivation of the check of §7 emits or attaches anything.

An item can emit an empty tag set. A string terminal or `_` can read such a token. Recipe or ownership errors during emission end the stage with its verdict and warnings but no output. The elision-only check does not then run.

A token's constituent is its whole `$` carrier or captured carrier. Its span covers that part's stage-input tokens. Its source is their envelope, or the empty-node source of §12. Its text is the original source interval. A recipe changes neither source nor text, even when its image includes neighboring punctuation.

An inserted token's span is empty at the start of its anchor. The anchor is the first present part of the next covering item, skipping inserted items. For a named item, that part is its first present before-attachment or its carrier. For `$`, it is the whole constituent. Thus `%emits ε, $` anchors the insertion at the constituent's start.

In `%emits ε, ($b) $w`, the insertion stands before `$b` where the production has `$b`, and before `$w` otherwise. An inserted item whose next covering item has an absent named carrier is a document error. An inserted token anchored before a part has empty source at that part's source start. Where the part is empty, it uses the empty-node source of §12.

If no covering item follows an inserted token, the span is empty at the end of the constituent. Its source is empty at the source end of the input token before that position. If the position is the constituent's start, its source is empty at the start of the constituent's source.

Verbatim spelling comes from `.verbatim-text` in a constituent recipe. A body's rule-level image recipe applies both directly and inside a covering parent. Recognition and conditions still read original input values. The recipe does not imply any foreign placeholder or change the value channel.

The stage selects channel recipes on each chosen occurrence. An erased occurrence stops the string walk. An explicit outer image recipe can suppress recursive descendant image recipes, while value concatenation still enters those children. The stage evaluates only selected dependencies.

Recipe evaluation identifies the constituent occurrence, channel, and item override context. Equal productions or spans in separate occurrences do not merge those identities. Dependency selection affects strings only and does not change which items the emission walk emits.

A constituent without a selected channel recipe concatenates its children on that channel. It can have `%emits`, because the string walk ignores its emission list. A captured carrier uses the captured part's constituent recipes. Attachment captures run their own emission walks. Nothing below an erased occurrence emits or counts.

An empty span gives empty verbatim text and claims no uncovered gap. It retains the empty-node source rule of §12. A nonempty image recipe over an empty carrier can still emit strings without enlarging its source.

A nonempty verbatim span begins with its source envelope `[l,r)`. Its image can include adjacent uncovered original text. The following bounds use the stage-input neighbors, independent of emitted token order.

At a later stage, erased or attached text can lack coverage by ordinary stage-input tokens. A verbatim extension can then include that text.

Let the span be `[a,b)`. Its left bound P is the preceding token's source end, or 0 at input start. Its right bound Q is the following token's source start, or original text length at input end. Each bound limits only its own side.

If `P < l`, the left extension is the maximal uncovered interval inside `[P,l)` that touches `l`. Otherwise, there is no left extension.

If `r < Q`, the right extension is the maximal uncovered interval inside `[r,Q)` that touches `r`. Otherwise, there is no right extension.

Both searches exclude every code point covered by any stage-input token's source. The searches run independently. Q never limits the left search, and P never limits the right search. Overlapping or out-of-order sources never shrink or reverse the base envelope. The returned string is original text over the extended interval. Token source and text remain unchanged.

Record the original span and nonempty uncovered extension intervals of each evaluated call. Calls on an identical span share a claim. Different spans conflict only when their extensions overlap by at least one code point. Base-source overlap alone is legal. A conflict ends emission with a grammar error.

For example, the original text is `a,b`. Token 0 has source `[2,3)` and value `b`. Token 1 has source `[0,1)` and value `a`. Their source intervals leave the comma at `[1,2)` uncovered. The following grammar evaluates one verbatim call per token:

```jbogenbau
%ambiguity-resolution greedy

%rule text
  | unit
  | text unit

%rule unit :- $.verbatim-text
  | _
%emits
```

| Token | P | Q | Left extension | Right extension | Verbatim result |
| --- | ---: | ---: | --- | --- | --- |
| 0 | 0 | 0 | `[1,2)` | None | `,b` |
| 1 | 3 | 3 | None | `[1,2)` | `a,` |

Both calls claim `[1,2)`. Their input spans differ, so emission ends with a grammar error and produces no stage output. Neither token's source nor text changes. A bound on the wrong side blocks only that side's search.

The claim set contains only evaluated selected dependencies, including attachment walks. Overridden recipes, erased parts, losing options, and unevaluated descendant channels contribute no call. Memoization changes neither that set nor the shared-gap verdict. This keeps each verbatim result independent of call order.

A later stage that forwards a token keeps its source, because a token over one input token has that token's source (§1). So the text of a quote body stays the same to the end of the pipeline, although the tokens next to it can disappear.

[The string walk](#112-the-string-walk) builds each covering token's value and image independently.

### 11.2 The string walk

The string walk builds a value or image from the selected occurrence. A directly read input token supplies its stored channel. An erased constituent supplies the empty string and stops descent. Another constituent uses its selected recipe, or concatenates its children's contributions in order.

The walk enters constituents with `%emits`, but never executes their emission items. A child item recipe therefore affects only a token that that item directly emits. A child constituent recipe also applies inside a parent's covering token. Unlisted input symbols still count unless an erased constituent excludes them.

For one emitted token, select the first existing entry in each column:

| Rank | Value | Image |
| --- | --- | --- |
| 1 | Item `:=` | Item `:-` |
| 2 | Alternative `:=` | Image implied by item `:=` |
| 3 | Definition `:=` | Alternative `:-` |
| 4 | Concatenation of children | Definition `:-` |
| 5 | | Image implied by alternative `:=` |
| 6 | | Image implied by definition `:=` |
| 7 | | Concatenation of children |

Definition clauses belong to the statement that wrote the alternative. Extension clauses reach only appended alternatives. At an inner occurrence, omit all item rows. A constituent's explicit image recipe beats either implied constituent image. An item's implied image yields only to its own explicit image.

An implied image evaluates the selected value recipe as a string for image use. It does not reevaluate children in the image channel. If both channels select that same recipe, they share its result. Memoization cannot change which recipe calls participate.

### 11.3 Recipe evaluation and cycles

A recipe contains only string literals, string constants, and seven captured string methods. They are `.value`, `.image`, `.source-text`, `.decomposed-source-text`, `.verbatim-text`, `.emitted.value`, and `.emitted.image`. Its atoms join with `++` from left to right without a separator. Every other atom is a document error.

Juxtaposed literals form a string set everywhere terms permit them. A recipe requires a string. The reader rejects a string set at its first literal and tells the author to use `++`. It rejects a second recipe term at its first token with the same instruction. Recipe atoms cannot use grouping parentheses or method arguments.

Input methods read the original projected span. `.emitted` reads the string walk with constituent recipes, before any override on the current item. It can read a captured constituent that has no `%emits`. An erased part's `.emitted` gives empty strings on both channels.

Evaluation identity includes the selected constituent occurrence and requested channel. Item evaluation also identifies its item position and override context. Equal productions or equal spans in different tree occurrences do not merge these identities. A value dependency and an image dependency remain separate unless they select the same recipe expression.

A selected recipe runs only when an emitted string or another evaluated recipe needs it. An unused weaker recipe runs neither its methods nor its descendant walks. An explicit image recipe can therefore suppress all recursive descendant image recipes while value concatenation still enters those children.

```jbogenbau
%rule r := $.emitted.image :- "x"
  | "a"
%emits

%rule s := "x" :- $.emitted.value
  | "a"
%emits

%rule t := "a"
  | "a"
%emits
  $ := $.emitted.value ++ "b"
```

`r` and `s` give `x` on both channels. `t` gives `ab` on both channels. Its item reads the constituent value `a` before its override.

A cycle exists when a requested constituent channel depends on that same occurrence's active channel before returning. `:= $.emitted.value ++ "x"` cycles directly. `:= $.emitted.image` without an explicit image recipe cycles through the implied image. Cross-channel references alone do not establish a cycle, as `r` and `s` show.

The loader analyzes each production's effective constituent recipes after alternative and definition channel selection. It validates these two channels before considering item overrides. Overridden definition recipes remain inactive on the channels replaced by alternative recipes. Tests and feature gates excuse no active document cycle.

Only alternative or definition recipes can cycle. A captured child's dependencies cannot reach its parent. Item dependencies read before their own override and cannot reach that override. The loader reports a cycle as a document error.

The loader visits rules in expanded order (§2.3), then alternatives and their expansions in ordinary order (§3.2). Within each production, it examines the value channel before the image channel. From each channel, it follows effective recipe dependencies depth first, in the written order of the recipe's atoms.

A cycle closes when a recipe reads a channel still active on the current path. The error stands at the first atom of that recipe. Its dependency reaches the active channel. The dependency path runs from the first active channel to the recipe that closes the cycle. An implied image counts as the value recipe that it reuses.

The following definition is a document error, despite its item override:

```jbogenbau
%rule masked := $.emitted.value
  | "a"
%emits
  $ := "x"
```

Its constituent value still defines a cyclic result for `.emitted` or a covering parent. Item selection suppresses runtime evaluation but does not legalize that constituent definition. An alternative override of that cyclic definition recipe can remove the dependency on its replaced channel.

A losing runtime option runs no recipes, although its syntax and effective constituent dependencies still undergo document validation. A winning reading's runtime recipe error remains a grammar error. Ranking never falls back because emission failed.

### 11.4 Capture scope and erasure

Recipe name analysis includes every receiver. `$` in an item recipe names the enclosing rule occurrence, even when its carrier is a captured child. Unknown names and private ranked captures fail before absent-carrier pruning. After pruning, validate effective constituent recipes on their selected channels and item recipes on retained items. An alternative's explicit recipes can suppress definition recipes separately per channel.

A selected recipe that reads a capture absent from its production is a document error, reported at the definition (§9.3). An alternative recipe serves that alternative's productions. A rule-level recipe serves each production where no alternative recipe overrides it on that channel. Optional recipe cases need separate alternatives.

Item recipes on an absent carrier drop with the item. An absent attachment drops alone. Tag terms retain §3.6's guarded missing-capture rule.

A recipe beside `%erased` is a document error, on the erased alternative or its definition. An erased descendant's own recipe is not evaluated. A parent item over an erased captured part still emits its listed token. Its strings default to empty, but item recipes can replace them. Its counted parts remain empty.

An empty string is never erasure. A non-erased input token still counts for ownership even if both strings are empty. Input `.value`, `.image`, and `.source-text` still observe erased tokens. Only the string and ownership walks exclude them.

A token can carry attachments. These are other tokens that belong to it, and no later stage reads them. A token has two lists of attachments, `before` and `after`. No grammar operation sees a token's attachments: not a terminal, a test, a condition, or a method.

A capture item can name attachment captures in parentheses, any number before it and any number after it. An example is `($b) $w ($a) :: $w.tags`. The item's own capture, `$w` here, is its carrier. The carrier is always a named capture (§9). Each attachment capture is a capture of the rule, and it stands in no other item.

The carrier emits its token over its captured part, as any capture item does. It does not run the emission of that part. So the item keeps a structure inside the carrier's part only if it captures that structure separately. The captures of one production are disjoint. So the carrier's value, image, text and source are its own, as for any capture item.

An attachment capture emits the tokens of its matched constituent through its own emission walk. Empty sources, recipes, and erasure rules apply there too. A captured part that emits nothing supplies no attachment. A bare terminal without an emitting ancestor is one example.

Attached tokens are outside the stage's ordinary output sequence. Implications apply to their tags just as to other emitted tokens. Their strings follow the same recipe rules. A covering ancestor can include attachment-capture input parts as ordinary counted parts when ownership permits it.

Within one item, the stage first produces the before-attachments in written order. Then it produces the carrier's token with its tag term, and then the after-attachments in written order. The carrier's token takes the tokens of its before-attachment captures, in order, as its `before`. It takes those of its after-attachment captures as its `after`. The first grammar error ends emission. An empty tag set is legal.

An attached token has no span, since its span counts the input of the stage that attached it. Its `source` stays in the coordinates of the original text.

Attachment ownership counts non-erased input tokens independently of all recipes and strings. An erased input token and its attachments contribute nothing. Empty images or values still count input tokens. Descendant emission items add no ownership part to a parent string walk.

If a token has exactly one part, and that part is an input token with attachments, the token inherits those attachments. This holds whatever tags its item gives the token. The token's own attachments from its item are outer. So its outer before-attachments come before the inherited ones, and its outer after-attachments come after them.

A token combining an attached input token with any other counted input token causes a grammar error. Recipes cannot hide or merge their ownership. Exactly one counted input token can forward its attachments. The token's strings can still come from explicit recipes.

Two emitted covering items cannot claim the same nonempty input span. A whole carrier also cannot overlap a consuming attachment capture of another item (§9.3). Together, these restrictions prevent duplicate attachment ownership. Multiple whole items require a structurally always-empty production under §9.3's conservative overlap analysis. Such items cover no counted input token or inherited attachments.

A covering token cannot identify attachment ownership across several counted input tokens. The stage tests this independently of tag and string overrides. Source overlap alone does not establish shared input ownership.

The attachment lists follow the order of the derivation and of the emission. That is the order of the text when the sources lie in order. The engine does not promise that order for sources out of order.

A stage whose verdict is `tie` emits nothing (§6), at whichever stage it is. This holds even where the tied derivations emit the same tokens. A tie is a property of the grammar, and the grammar is the place to settle it. The engine never emits one tied derivation in place of the others.

## 12. The tree

Warnings in this section are parse warnings. Loading diagnostics belong to §13 and the loaded dialect API.

The result's tree comes from the chosen derivation, and each reading of an `ambiguous` error comes from its own derivation (§6, §7). The engine builds a tree from a derivation as follows:

- A closed production of a rule that the author wrote is a `rule` node, its children in order.
- A read token is a `token` node holding the index of the input token and the terminal that the recognizer read it as.
- The engine splices out helper productions, those of `[ ]` and of flat `{ }`: their children take their place. So a list is never a node. Its items and separators are children of the node of the rule that writes it, in order. A plain optional that holds a capture has no helper (§3.2), so what it reads is already a child of the rule's node. So an optional is never a node, whether it is a helper or expanded in place.
- A level of a chain is a closed production of its rule (§3.3), so each level is a `rule` node, and the levels nest.
- An elidable optional (§3.8) that is absent becomes an `elided` node for its terminal `T`. In a reading of the check of §7, a read of a synthetic token also becomes an `elided` node, as §7.10 says. This holds also on route 3 and for a bare terminal. The node has an empty span at the position where the optional is empty.

  The node of a terminator with an `=` test records the test's string, for the synthetic token of §7. Canonical output records it as `value` (`docs/output.md`). The readings of the check of §7 map the reconstructed input back to the stage's input, as §7.10 says.

The input token of a token node can carry attachments (§11). The node does not hold them, and the renderings take them from the token (`docs/output.md`). The two readings of an `ambiguous` error read the same input tokens, so they show the same attachments.

A node with a nonempty span has the source of its tokens (§1). A node with an empty span is an `elided` node or a rule that read no token of the stage's input. Such a node has an empty source at the source end of the input token before its position. At position 0, its empty source is at the source start of the first input token, or at 0 if there is no input token.

A `rule` node of a stage's chosen tree gives warnings from the alternative that its production came from. It gives one warning for each warning `f!` of that alternative where the feature `f` is on. The warning holds the stage's name, the feature, the rule, and the node's span and source. So a warning on a chain's alternative gives one warning for each level of the chain, each with its level's span.

A stage's warnings are those of its chosen tree. They are in the order in which a walk of the tree meets their nodes, parent before children and children left to right. The warnings of one node are in the order in which its guards are written. A stage whose verdict is `tie` has no chosen tree, so it gives no warnings. The engine never takes warnings from one tied derivation in place of the others.

Nothing else gives warnings. No warnings come from a reading of an `ambiguous` error or a losing derivation. None come from the check of `elision-only` (§7), a nested parse (§4), or a stage that rejected its input. A warning changes nothing that the stage accepts, chooses or emits.

## 13. The pipeline

A pipeline document (`docs/design.md`, "Pipelines") defines a dialect. The loader reads it into stages as follows.

To splice a pipeline, the loader reads the pipeline document's items (§9) in order. It replaces each `%include "PATH"` with the items of the document at `PATH`, read in the same way. It resolves the include path `PATH` against the directory of the document that holds the `%include`.

`%stage NAME` creates and selects a stage. `%extend-stage NAME` selects an earlier stage and appends subsequent stage items to it. `%redefine-stage NAME` selects an earlier stage and clears its accumulated stage items, including earlier extensions. Both selectors preserve the stage's execution position.

Stage selection continues across grammar blocks and include boundaries. The includer's next item goes into the stage selected at the end of the include.

Replacement clears rules, constants, classifiers, implications, local feature declarations, and the ambiguity policy. It does not clear global `%features` or other stages. Later extensions append to the replacement. The loader reads every source document, including source whose stage items a later replacement discards. Source syntax errors and include errors still fail the load. Only surviving stage definitions undergo grammar validation (§2). This includes every feature check in this section. Discarded feature declarations and replaced rule alternatives undergo none of these checks. Source syntax, DOM shape and depth, and include errors still fail the load.

A `%features` before the first stage selector declares global defaults. Every later `%features` belongs to the selected stage, including across include boundaries. The loader stitches each stage's other items in order (§2). Each of these is an error of the dialect, and the loader reports it at the item named:

- An `%include` of a document that does not exist is an error at the `%include`. The error names the documents that included it.
- An `%include` of a document that is already being included, which is a cycle, is an error at the `%include`. The error names the documents that included it.
- A rule, an `%ambiguity-resolution`, a constant definition, a classifier or an implication before the first `%stage` is an error.
- A `%stage` with the name of an earlier one is an error.
- An `%extend-stage` or `%redefine-stage` that names no earlier stage is an error at that selector.
- A stage with no rules is an error at its `%stage`.
- A pipeline with no `%stage` is an error.

A document can be included more than once, in one stage or in several. The loader reads its items again each time.

The first stage reads stage-zero tokens, or caller tokens that bypass stage zero (§1). Each later stage reads the preceding stage's emitted tokens. The caller's `until` names the last stage to run, inclusive. If the caller omits `until`, every stage runs.

The caller's enabled features and the global defaults are on from the first stage, less the caller's disabled features.

A caller who names one feature both to enable and disable makes a usage error. Unknown feature names are legal.

Before each stage parses, the engine evaluates its conditional feature declarations on that stage's input, in declaration order.

Each declaration's conditions form a conjunction with the usual short-circuit rules (§10). Each declaration evaluates once, even if its features are already enabled.

Here `$` is the whole input span, with token tags unioned and no constituent tags. The presence predicate `$` is always true.

Bare `$` reads token values. Legal methods are `tags` without arguments, `classes`, `value`, `image`, `source-text`, and `decomposed-source-text`.

The methods `first-token`, `tokens-after-first`, `last-token`, `split`, and `ngrams` are also legal. Apart from the ban on a rule argument to `tags`, each method keeps its usual types and arities.

All other methods, named captures, and tree comparisons are loading errors there, even in unreachable branches. The loader reports every feature-condition error at its `%features` directive. This includes type errors, unknown constants, and closed delimiter errors.

Constants bind in the selected stage (§2). Conditions use the usual Boolean type rules (§10).

Feature conditions undergo every applicable loading check of rule conditions, including closed delimiter checks after constant binding.

A global declaration with conditions, or conditions on another directive, is a loading error at that directive.

If all conditions hold, the declaration enables its features from this stage onward. An unconditional declaration enables its features at the same point.

Unconditional declarations respect the caller's disabled features. An enabled feature stays enabled.

If a conditional declaration holds and names a caller-disabled feature, the parse ends with a `feature-conflict` result.

The error names the stage and feature, without a position.

The engine evaluates the declarations in order. It stops at the first declaration that holds and names a disabled feature, or whose condition raises a runtime error. That declaration decides the result. Within one declaration, the error names the first disabled feature in operand order.

The failed stage has a null verdict, no tree, and no output. Earlier stages retain their outputs and warnings.

A runtime grammar error in a feature condition ends the stage with the usual `grammar` result and a null verdict.

An `until` before a stage never evaluates that stage's declarations. Each stage parses at most once.

A stage-local feature is a loading error if a surviving earlier stage tests it, whether or not it also has a global declaration. The loader reports it at the local `%features` declaration, and the message names the earlier stage.

Two different stages cannot declare the same feature locally. The loader reports the second surviving declaration in document order, after include expansion. Several declarations of one feature in the same stage are legal. The engine evaluates each declaration in order.

The loader examines rule guards and classifier guards before feature filtering. This includes classifiers used by conditions.

Its own stage and later stages can test the feature. Caller configuration cannot bypass this loading rule.

A rejection or an `ambiguous` error ends the run as usual.

The result's `ok` is true when every stage run accepted without an error. The result's warnings are those of every stage that ran (§12), in stage order, and they are kept whether or not the result is `ok`.

A dialect's features are the names its guards use in any stage and the names its `%features` declare. The guards counted are those of each stage's rules after stitching (§2). Alternatives that `%redefine-rule` replaces and stage items that `%redefine-stage` discards no longer count. The gates of every classifier's entries count too. The loader counts them before any gate drops an alternative (§3.1), whatever features are on.

Local declarations also contribute their names to this inventory. An unconditional local declaration sets `default:true`, as a global declaration does, even when the caller stops before that stage. A conditional declaration sets no default.

Each name is a gate, if a guard uses it as `f?` or `¬f?`, or a warning, if a guard uses it as `f!`. A name that one guard uses as a gate and another as a warning is an error of the dialect. The loader finds this error when it loads the dialect. A name that only `%features` declares is a gate. A dialect lists its features, each with its kind and whether an unconditional `%features` declares it as a default. Conditional declarations contribute names, but no defaults.

Mistakes of the caller are errors of kind `usage`. Two examples are an `until` that names no stage and a text that is not a sequence of scalar values (§1). A token that the caller supplies with attachments is a third (`docs/api.md`). They are raised or returned as a load error is, and they are not results.

A grammar error found while parsing is a result. Examples are a nested parse asked about its own span as the same rule, and a `split` with an empty delimiter. Its error has kind `grammar`, the `stage` that it arose in and a message, and no position. The check of §7 can also end with an error of kind `grammar` and the code `elision-witness-lost` (§7.9). That error also has `chosen` and `completion`. It ends the run.
