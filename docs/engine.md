# The gencmu engine

This document is the specification that every gencmu library implements. It defines results and required storage, reuse, and work bounds. Optional implementation advice appears as notes. Where two implementations can differ, this document says which one is right.

The cases in `tests/engine/` and `tests/notation/` are part of the specification unless they load a bundled pipeline. A case that loads a bundled pipeline tests that pipeline's documents, not this specification. An implementation that disagrees with a case violates this specification or the pipeline's documents.

`docs/notation.md` explains the notation to grammar authors, and `grammars/gencmu/jbogenbau/` defines it. `docs/output.md` defines the result's JSON and the renderings.

Grammar identifiers and tags in examples illustrate generic rules. They impose no pipeline contract.

## 1. Tokens

A pipeline runs grammar stages in sequence (§13). A token is one unit of a stage's input or output. Each output token exposes its selected occurrence through a producer link. The next stage reads its public bag as one leaf. Only a result reader can follow the link into the earlier tree.

A token uses `props` for its public bag, with string fields `value` and `image`. It also records its span, source, text and any insertion provenance or carried diagnostics. [Output formats](output.md#a-parse-result) gives the record.

Spans are half-open ranges of stage-input indices. A nonempty span uses the least source start and greatest source end of its tokens. At an ordinary empty span, use the previous token's source end. At input start, use the first source start or zero on empty input. Source ranges count original Unicode scalars. Text is the source slice.

A diagnostic keeps its raising stage, rule, and preorder occurrence ordinal as its private identity (§12.1). Its charge also remains fixed across stages (§6). No terminal, test, pattern, or ordinary method reads diagnostics. The forest filter `.error-free` observes their measure, without exposing their objects (§4).

Caller tokens cannot supply nonempty diagnostic lists. This is a usage error (§13). When the engine copies the token, it accepts and drops empty lists.

The check of §7 adds synthetic tokens to a copy of a stage's input. They are not tokens of any stage, and no output shows them. A token that a stage reads is an original token for §7, whatever its span, source, text or `insertedBy` (§7.2).

The source of one token or more runs from the least source start among them to the greatest source end. An empty source counts as the point where it lies. Tokens usually lie in the order of their sources. Then this source runs from the source start of the first token to the source end of the last token.

Tokens need not follow the order of their sources. An emission lists its captures in the order in which they stand (§9, §11). But an inserted token can have its source before the token ahead of it, or after the token behind it. So can a token over a part that read nothing. An empty span of tokens has no such source: its source is given where it is used (§11, §12).

A tag is a capitalized key or supported engine membership. User tags start with an ASCII capital and continue with ASCII letters, digits, hyphens or underscores. An engine membership starts with `_`. The wildcard `_` matches without a membership test.

- A user class starts and ends with an uppercase ASCII letter and never starts with `_`, such as `KOhA`.
- A user mark is a tag such as `Stressed`, `Syllable-Break`, or `Word`.
- An engine tag is a stored property such as `_General_Category_Uppercase_Letter`, `_General_Category_Letter`, or `_White_Space`.

A string terminal's identity is its resolved string. A literal, escaped literal, and equal user constant therefore identify one terminal.

Canonical string diagnostics write one quoted string with `‹…›` escapes. Escapes represent quotes, controls, format scalars, nonspacing marks, private-use scalars, and the escape opener. They also represent Hangul syllables, scalars with a `decompose` record, and scalars of nonzero combining class. Every configured White_Space scalar except U+0020 also requires an escape. §9 specifies one diagnostic spelling. Tags retain their identifier spelling without string escaping.

A format scalar has general category Cf in the configured table.

A control scalar lies in two fixed ranges. These are U+0000 to U+001F and U+007F to U+009F.

A private-use scalar lies in three fixed ranges. These are U+E000 to U+F8FF, U+F0000 to U+FFFFD, and U+100000 to U+10FFFD. Neither predicate depends on the configured Unicode table.

A nonspacing mark has general category Mn in the configured Unicode table. Scalars with a `decompose` record, Hangul syllables and scalars of nonzero combining class also require escaping. Stage zero changes each of them in a grammar document. Other marks require escaping only if another predicate applies. An unlisted scalar has category Cn and is not a nonspacing mark.

U+0301 can appear as `"‹U+0301›"`, and U+ED80 as `"‹U+ED80›"`. A quotation mark uses `"‹U+0022›"`. Escapes contribute exact scalars after source decomposition.

Stage zero is named `input`. It first decomposes the text into its canonical decomposition, Unicode Normalization Form D, with the configured Unicode table. Each scalar c at position i becomes its decomposition. That is the table's `decompose` record for c, the jamo of a Hangul syllable, or c itself. Each resulting scalar has origin i. The engine then sorts each maximal run of scalars whose combining class is not 0 by combining class.

The sort is stable, and every scalar keeps its origin. Stage zero supplies one token for each scalar dₖ of the result, at index k. Its `span` is `[k,k+1)`. Its `source` is `[i,i+1)`, where i is the origin of dₖ. Its `text` is the original text over its source. Its `value` and `image` are dₖ.

Its stored tags are the complete scalar profile of dₖ, as defined below. This profile includes all available property memberships, without depending on grammar references. Stage zero is implicit and adds no executed grammar-stage result.

In the bundled Unicode table, ASCII digits, `#`, and `*` have Emoji_Component. Their stage-zero tokens therefore carry `_Emoji_Component`. U+200D, U+20E3, and U+FE0F also carry it. Ordinary inheritance can forward these stored tags.

Decomposition is canonical only. It applies no compatibility decomposition and no case mapping, and it never composes. Sources, texts, line and column numbers, `.source-text` and `.verbatim-text` read the original text. One precomposed scalar can give several tokens with one source. Canonical reordering can put sources out of order.

A text is a sequence of Unicode scalar values. A text that is not one is a usage error (§13), and the engine refuses it before it makes any character token. In JavaScript and Python, such a text is a string with a lone surrogate. In Go, it is a string that is not valid UTF-8. A Rust string is always valid. The same holds for every source-map string, including Unicode resources and cached JSON.

Source-map loaders inspect supplied strings in code point order of their keys before hashing or parsing any entry.

A library reads a grammar document from disk as strict UTF-8. Bytes that are not valid UTF-8 are a `grammar` error of loading, not a usage error, because the caller supplied no string. The error names the document and says that its bytes do not decode. It has no line and no column. The library finds this before it hashes the document or looks in `data/preparsed/FAMILY.json` (§8). A byte order mark stays in the text as the character U+FEFF.

The error description is `the document is not valid UTF-8: an invalid byte sequence at byte N`. Here `N` is the zero-based offset of the invalid sequence's first byte. This rule also covers Unicode resources, including extra names files.

`tools/unicode-table.py` generates `data/unicode/unicode.txt` from one version of the Unicode Character Database. Every library uses this file, not the Unicode data of its platform, so that the four libraries agree on every character. The file holds one entry on each line, with code points in hexadecimal:

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

Only runs of spaces (U+0020) or tabs (U+0009) separate fields. Leading and trailing spaces or tabs do not make fields. Every other character, including a byte order mark (U+FEFF), stays inside its field.

Blank lines are ignored. An unknown entry name or a malformed record is a grammar error. Each record requires the fields shown above, with one or more decomposition scalars for `decompose`.

Code point fields contain hexadecimal digits and range from U+0000 to U+10FFFF. A range must not be reversed. Decomposition records contain only scalar values. A combining class contains decimal digits and lies between 1 and 254.

Any number of leading zeros is allowed in a number field. After these zeros, a code point has at most six hexadecimal digits. A combining class has at most three decimal digits. The value bounds above still apply.

The records can stand in any order in a file. Each library indexes them while it reads the file, then writes sorted lookup ranges once. Inserting a record never shifts every earlier record. Record order never changes a valid table's answers.

Overlapping or touching category ranges with the same value merge. Combining ranges with the same class follow this rule. White-space ranges form their union.

An overlap between category ranges with different values is a grammar error. Combining ranges with different classes follow this rule. A second `decompose` record for one scalar is also a grammar error, even when its mapping matches.

These errors name `data/unicode/unicode.txt` and the line of the later record. A category record with the value `Cs` is a grammar error at that record.

Core errors keep the resource path and line separate from their reason. For each nonblank record, the loader inspects its shape first. It then parses code-point fields from left to right, checks range order, checks values, and checks conflicts. Parsing a code-point field includes its hexadecimal digits and numeric bound. Scalar-only restrictions belong to the later value checks. The first failed check gives the reason.

The core loader uses these eleven reasons:

- `the core record is invalid`: an unknown record name or wrong field count.
- `an invalid code point`: a malformed hexadecimal field or a value above U+10FFFF.
- `a reversed range`: the first endpoint exceeds the last endpoint.
- `an invalid scalar`: a decomposition field names a surrogate.
- `an invalid abbreviation`: an invalid abbreviation scalar, spelling, repetition, or pinned binding.
- `an unknown category`: the category name is outside the category inventory.
- `category Cs is not allowed`: a category record names Cs.
- `an invalid combining class`: the class is not a decimal integer from 1 through 254.
- `conflicting category ranges`: overlapping ranges have different category values.
- `conflicting combining ranges`: overlapping ranges have different combining classes.
- `a second decompose record`: the scalar already has a decomposition record.

An `abbreviation` record has one scalar and one alias matching `[A-Z][A-Z0-9]*`. A scalar can have several aliases. Repeated records or an alias assigned to different scalars are grammar loading errors. These records supply neither tags nor property memberships.

The core loader inspects every abbreviation against an embedded catalog of pinned one-word names and aliases. These spellings match `[A-Z][A-Z0-9]*`. A record cannot bind one of those spellings to another scalar. Correct same-scalar bindings remain valid. This restriction applies even when no grammar uses a name escape. The error names `data/unicode/unicode.txt`.

If the record's line is known, the error includes it. Core inspection always uses the embedded Unicode 15.1 catalog, regardless of the core's declared version.

The generator takes this catalog from pinned DerivedName.txt and NameAliases.txt. Libraries embed only the matching one-word spellings and their scalars. Core inspection reads neither `data/unicode/unicode-names.txt` nor an extra names file. A custom core cannot redefine those standard bindings.

The generator copies all 354 abbreviation aliases from pinned NameAliases.txt into the core table. Printing uses only this always-loaded map, with no names-file lookup. A custom core replaces this map without fallback. Without an abbreviation for a scalar, the printer uses its numeric escape.

Core abbreviation escapes also decode through this map, without names data. Other source name escapes use the separate names file. This priority keeps canonical spelling readable through the ordinary reader.

A caller can supply `data/unicode/unicode.txt` through the API. It replaces all bundled core data, including White_Space, Emoji_Presentation, Emoji_Component, and abbreviations, with no fallback. The table must list the whitespace that its grammar documents use. It must give `Emoji_Presentation` to every emoji name that those documents use. Those names must also lack `Emoji_Component`.

The table need not cover every scalar. An unlisted core scalar gets Cn and lacks White_Space, Emoji_Presentation, and Emoji_Component. For companion properties, explicit assignments and declared defaults still apply to that scalar. No table supplies comparison normalization.

A table without `decompose` records decomposes only Hangul syllables, and one without `combining` records reorders nothing. The bundled notation needs the `decompose` records of U+2260, U+2209, U+2288 and U+2247.

`Cs` belongs only to surrogates U+D800 to U+DFFF, which the table never lists. A surrogate is not a scalar and cannot become a stage-zero token. `_General_Category_Surrogate` is a valid stored-tag name but stage zero never assigns it.

A key set is a bag of bare keys. Union combines keys, intersection keeps common keys, and difference removes the right operand's keys.

A range, `"a".."z"`, reads an ordinary token with one scalar value inside its inclusive endpoints. Endpoints are string literals or constants that resolve to one scalar. Surrogates are excluded, so `"‹U+D7FF›".."‹U+E000›"` has two possible values. A reversed range is a document error. Ranges cannot be key sets or condition operands.

Engine property names correspond to the configured Unicode table. A general-category tag uses its qualified long form, such as `_General_Category_Uppercase_Letter`. A major category groups related atomic categories. These are the canonical atomic and major names:

- `_General_Category_Letter`: `_General_Category_Uppercase_Letter`, `_General_Category_Lowercase_Letter`, `_General_Category_Titlecase_Letter`, `_General_Category_Modifier_Letter` and `_General_Category_Other_Letter`
- `_General_Category_Mark`: `_General_Category_Nonspacing_Mark`, `_General_Category_Spacing_Mark` and `_General_Category_Enclosing_Mark`
- `_General_Category_Number`: `_General_Category_Decimal_Number`, `_General_Category_Letter_Number` and `_General_Category_Other_Number`
- `_General_Category_Punctuation`: `_General_Category_Connector_Punctuation`, `_General_Category_Dash_Punctuation`, `_General_Category_Open_Punctuation`, `_General_Category_Close_Punctuation`, `_General_Category_Initial_Punctuation`, `_General_Category_Final_Punctuation` and `_General_Category_Other_Punctuation`
- `_General_Category_Symbol`: `_General_Category_Math_Symbol`, `_General_Category_Currency_Symbol`, `_General_Category_Modifier_Symbol` and `_General_Category_Other_Symbol`
- `_General_Category_Separator`: `_General_Category_Space_Separator`, `_General_Category_Line_Separator` and `_General_Category_Paragraph_Separator`
- `_General_Category_Other`: `_General_Category_Control`, `_General_Category_Format`, `_General_Category_Surrogate`, `_General_Category_Private_Use` and `_General_Category_Unassigned`

The core binary names are `_White_Space`, `_Emoji_Presentation`, and `_Emoji_Component`. Their stored membership comes from the corresponding core property ranges. The property inventory below adds qualified value tags and further binary tags.

`_` matches any token at any stage, including every stage-zero character. It requires no stored universal tag. A missing category record assigns `_General_Category_Unassigned` and `_General_Category_Other`. Later stages never derive these tags from values or images.

Emoji properties use the same pinned Unicode version as categories and decomposition. A missing emoji record grants no membership. These properties add no case mapping.

The engine inventory is closed to the categories above and the properties below. `_lu` and `_Letter` are document errors. Engine tags are ordinary stored membership after stage zero. A grammar can read, inherit, forward, or filter them, but never introduce one. An empty value or a capitalized image does not imply an engine tag.

### Unicode property inventory

A binary property assigns Yes or No. An enumerated property gives each scalar one named value. A multi-valued property assigns a set of values. Catalog properties, such as Script, follow the enumerated rules.

The inventory uses Unicode 15.1.0. It includes 56 binary properties, 25 enumerated or catalog properties, and Script_Extensions. General_Category supplies the canonical tags above. Canonical_Combining_Class also supplies tags, through the same map that orders combining marks.

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

An alias is another spelling of one name.

A binary tag uses either the long property name or its short alias, such as `_Alphabetic` or `_Alpha`. Both identify the same stored tag. Only Yes supplies membership. There is no No tag. A test such as `_<¬_Alpha>` tests absence from stored tags.

Other properties use `_PROPERTY_VALUE`, with either both long names or both short aliases. `_Script_Latin` and `_sc_Latn` identify the same tag. `_Canonical_Combining_Class_Above` and `_ccc_A` identify the same tag. Mixed forms, such as `_Script_Latn`, `_sc_Latin`, and `_ccc_Above`, are errors. If a short and long name are identical, that name works in either complete form.

General categories accept compact, qualified short, and qualified long input forms. Every atomic and major category accepts all three forms. `_Lu`, `_gc_Lu`, and `_General_Category_Uppercase_Letter` identify the same tag. This rule also covers the seven major groups, such as `_L`, `_gc_L`, and `_General_Category_Letter`. `_Uppercase_Letter`, `_LC`, `_gc_LC`, and `_General_Category_Cased_Letter` remain invalid.

The reader immediately normalizes accepted property spellings to one canonical spelling. Every property uses its long form, including atomic and major general categories. DOMs, stored tags, terminal identities, instance keys, diagnostics, and output contain only canonical spellings. Aliases never add another tag or another parse.

The long names and short aliases come from pinned [PropertyAliases.txt](https://www.unicode.org/Public/15.1.0/ucd/PropertyAliases.txt) and [PropertyValueAliases.txt](https://www.unicode.org/Public/15.1.0/ucd/PropertyValueAliases.txt). Some long values contain short letters, such as `_Grapheme_Cluster_Break_L`. Age accepts `_Age_V15_1` and `_age_15.1`, or `_Age_Unassigned` and `_age_NA`. Block uses aliases such as `_Block_Latin_1_Supplement`, rather than the spaced spelling in Blocks.txt.

The combining-class catalog contains every integer from 0 through 254. A PropertyValueAliases.txt row for an integer supplies its long and short value aliases. If no row exists, both forms use the integer's decimal spelling without leading zeros. A row's existence decides this rule, even when its aliases contain digits.

Class 2 uses `_Canonical_Combining_Class_2` and `_ccc_2`. Class 10 uses `_Canonical_Combining_Class_CCC10` and `_ccc_CCC10`. Class 230 uses `_Canonical_Combining_Class_Above` and `_ccc_A`. `_Canonical_Combining_Class_10` and `_ccc_10` are invalid. A class without scalar assignments remains a valid terminal and can match a caller token carrying its tag.

Each accepted spelling maps to exactly one canonical tag. The generator uses the two designated alias columns and the combining-class decimal fallback defined above to construct the complete registry. It rejects collisions between different identities, including collisions after ASCII case folding. Matching remains case-sensitive. Additional compatibility aliases in later columns do not supply tag spellings.

Canonical_Combining_Class uses its short and long alias columns after the numeric column. Script_Extensions uses Script's value aliases.

A library resolves a complete token through that registry. It never guesses a property boundary from an underscore. If a Unicode update introduces a collision, generation fails. The specification must assign a distinct spelling before that update is supported.

Each library embeds the generated Unicode 15.1 property catalog, including property kinds, canonical value names, and accepted short spellings. The portable JavaScript library embeds this catalog too. Custom files use it for name and type inspection, without receiving bundled membership assignments. Runtime host data never supplies catalog entries.

Names compare exactly. Mixed aliases, different case, double separators, and punctuation substitutions are document errors at the tag. For example, `_Script_Latn`, `_sc_Latin`, `_Script__Latin`, `_Bidi_Class_L`, `_lu`, and `_Letter` are invalid. The compact input `_Sc` normalizes to `_General_Category_Currency_Symbol`, while `_sc_Latn` normalizes to `_Script_Latin`.

If the configured table lacks a known property or value, its tag is a document error at that reference. This rule covers negative tests, pattern constants, supplied DOMs, disabled alternatives, and replaced definitions. For a declared value without scalar assignments, no scalar receives its tag from that table. The terminal remains valid and can match a trusted caller token. It cannot become a constant-failure predicate.

The API normalizes accepted aliases in caller token tags before set construction. Duplicate spellings of one identity become one tag. An invalid spelling or unavailable support causes a usage error. Supplied DOMs require canonical spellings because DOMs store the reader's normalized result.

### Stored scalar profiles

A scalar profile stores one scalar's initial engine tags. A profile never changes. Stage zero assigns each decomposed scalar its complete profile from the configured tables. Membership never depends on which tags a grammar names, its feature gates, or the selected stages. This rule applies while reading grammar documents too.

Every included and available binary property contributes its Yes tag. Every included and available enumerated property contributes its value tag. Script_Extensions contributes every member tag. Long category tags and their major groups remain present.

Libraries can share profiles across repeated scalars and equal profiles. They must keep table identities separate. Each configured table keeps a bounded profile cache across parse calls. Concurrent calls share that cache safely. Profile construction can wait until first use, but every observation sees the complete logical set from token creation. Filtering or extending one token's tags never mutates another token's profile.

Later stages read stored sets, without deriving properties from value, image, text, or source. A changed value grants no new property tag. A filter can remove every tag of an enumerated property. A union can retain several values of that property. Neither operation reclassifies the resulting token.

If a filter removes `_General_Category_Letter` and keeps `_General_Category_Uppercase_Letter`, that removal does not restore `_General_Category_Letter`. If a filter removes an extension member, a retained Script tag does not restore that member. Even without explicit grammar references, serialization lists every retained property tag. Shared storage cannot hide tags from equality, intersections, forwarding, or output.

### Pinned properties file

`tools/unicode-table.py` generates `data/unicode/unicode-properties.txt` from the pinned UCD. The bundled version is 15.1.0. Libraries read that file rather than host Unicode data. Character names remain in their separate, lazily loaded file.

General_Category, Canonical_Combining_Class, White_Space, Emoji_Presentation, and Emoji_Component belong only to `data/unicode/unicode.txt`. The properties file cannot redeclare them. Their core records imply support, including the existing defaults in partial core tables. Combining-class tags use the same numeric map as canonical ordering, without a second assignment table.

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

Property resources use only long property and value names, independently of accepted tag aliases.

`value PROPERTY VALUE` declares an available long value name. Every default and range value requires that declaration. Binary properties accept no value declarations. Enumerated and multiple properties can declare values with no assigned scalars. Script_Extensions uses Script's value names but does not require Script itself to be available.

`range PROPERTY FIRST LAST` assigns Yes for a binary property. Other range records append one value for an enumerated property or a nonempty complete set for Script_Extensions. Endpoints are inclusive. An explicit range replaces the declared default at its scalars. Script_Extensions sets replace rather than extend the default set.

Outside ranges, each property uses its declared default. Duplicate members within a set are malformed. Set order has no meaning. Equal overlapping assignments can merge. Conflicting enumerated values or extension sets at one scalar are grammar errors. Repeated binary ranges denote their union.

The file is strict UTF-8. Line endings, blank lines, field separators, and number spellings follow `data/unicode/unicode.txt`. Every range contains only scalars and excludes surrogates. Records after the header can appear in any order. Unknown records, duplicate declarations, undeclared properties, invalid types, unavailable values, and malformed fields are grammar errors.

After record inspection, the loader inspects each property's defaults and ranges in declaration order. The first error ends that inspection.

Property and value names must belong to the pinned catalog. Custom files cannot invent properties or tag aliases. For a supported property, the bundled file declares every catalog value, including unused values. For core combining classes, an absent PropertyValueAliases.txt row requires the decimal spellings defined above. A row containing `CCC10` still supplies aliases and forbids decimal alternatives.

The generator reads the pinned UCD files, including PropertyAliases.txt and PropertyValueAliases.txt. Binary sources include PropList.txt, DerivedCoreProperties.txt, emoji/emoji-data.txt, CompositionExclusions.txt, and DerivedNormalizationProps.txt. That last file supplies the binary properties Full_Composition_Exclusion and Changes_When_NFKC_Casefolded. Bidi_Mirrored comes from extracted/DerivedBinaryProperties.txt.

Enumerated sources include Scripts.txt, Blocks.txt, DerivedAge.txt, BidiBrackets.txt, HangulSyllableType.txt, IndicPositionalCategory.txt, IndicSyllabicCategory.txt, and VerticalOrientation.txt. Break data comes from GraphemeBreakProperty.txt, WordBreakProperty.txt, and SentenceBreakProperty.txt under `auxiliary/`, plus LineBreak.txt under the UCD root.

The generator uses DerivedBidiClass.txt, DerivedEastAsianWidth.txt, DerivedJoiningType.txt, DerivedJoiningGroup.txt, DerivedDecompositionType.txt, DerivedNumericType.txt, DerivedGeneralCategory.txt, and DerivedCombiningClass.txt under `extracted/`. DerivedCoreProperties.txt supplies Indic_Conjunct_Break. DerivedNormalizationProps.txt supplies the four Quick_Check properties. UnicodeData.txt supplies the canonical decomposition mappings that the core table uses.

The generator resolves every applicable `@missing` default before it compresses ranges. It follows [UAX #44](https://www.unicode.org/reports/tr44/tr44-32.html#Missing_Values). Later, more specific UCD defaults override earlier general defaults. Explicit assignments override those defaults. This includes nondefault values in unassigned bidi and East_Asian_Width regions. Omitted scalar rows never imply a generic default without those rules.

ScriptExtensions.txt supplies explicit sets. For other scalars, the generator materializes the singleton Script value before range compression. Libraries never infer extension membership from stored Script tags. Thus custom tables can supply Script_Extensions independently. For each assignment that differs from its default, the file lists maximal disjoint ranges in order.

The generator and the shared data audit compare all 1,112,064 scalars with the pinned sources. They include range boundaries and neighboring scalars. Independent expected digests cover each property's complete assignments, including defaults and extension sets. Host Unicode APIs never provide expected memberships.

Each property digest uses 64-bit FNV-1a over ASCII records in increasing scalar order. A record has six uppercase hexadecimal digits, a colon, sorted canonical tag names separated by commas, and LF. Binary No contributes an empty tag list. General_Category includes its qualified long atomic and major tags. The digest uses 16 lowercase hexadecimal digits, like the file fingerprints of §8.

A supplied `data/unicode/unicode-properties.txt` replaces the bundled properties file entirely. Omitted properties and values receive no bundled fallback. A custom core table without a companion file supports only its five core properties. A properties file without an overridden core uses the bundled core and must match its version.

Without either override, a library loads the bundled properties file with the core table. A missing bundled file is a grammar loading error. Even without an additional property reference, the loader reads and inspects every present properties file. An invalid or mismatched file names `data/unicode/unicode-properties.txt`. If the line is known, the error includes it.

Custom subsets are valid. A declared binary property without ranges is supported and false everywhere. An omitted declaration makes the property unavailable, rather than false. Naming an unavailable property is a load error at the reference, including in otherwise unused source. A supplied DOM receives the same inspection.

The playground fetches the pinned properties file at startup, before it loads any pipeline. The browser grammar bundle excludes that file. A failed fetch prevents pipeline loading and reports the missing resource. The portable JavaScript API receives the file through its source map.

### Property conformance and performance

Shared cases in `tests/engine/` and `tests/notation/` cover the following observations. Listed tags are required memberships, rather than complete output arrays. Expected arrays include every retained tag exactly once in code-point order. The four libraries use identical data and expected values.

| Case | Required observation |
| --- | --- |
| Exact names | Long and short pairs normalize identically: `_Alphabetic` and `_Alpha`, `_Script_Latin` and `_sc_Latn`, `_Canonical_Combining_Class_Above` and `_ccc_A`. Mixed aliases, wrong case, unknown values, and excluded properties are errors. |
| General categories | All 37 categories accept their three input forms and normalize to long names. `_Lu`, `_gc_Lu`, and `_General_Category_Uppercase_Letter` normalize to `_General_Category_Uppercase_Letter`. `_L` and `_gc_L` normalize to `_General_Category_Letter`. Cased_Letter forms remain invalid. |
| Alias boundaries | `_age_15.1` normalizes to `_Age_V15_1`. `_scx_Grek` normalizes to `_Script_Extensions_Greek`. The input `_Sc` normalizes to `_General_Category_Currency_Symbol` and stays distinct from Script. Compatibility aliases outside the designated columns are errors. |
| Category output | Source `_Lu` produces `{"ref":"_General_Category_Uppercase_Letter"}` in a DOM. Source `_L` prints `_General_Category_Letter` in terminals, patterns, and call names. Token and node tag sets also use long names. |
| Category DOMs | Supplied DOMs accept long category names. Compact or qualified short category names are malformed in supplied DOMs, although source input accepts them. |
| Category names | An unnamed `keep(_Lu)` instance prints `keep(_General_Category_Uppercase_Letter)`. A pattern argument written `= #_Lu` prints `= #_General_Category_Uppercase_Letter`. Compact aliases do not survive in canonical names. |
| Canonical identity | Alias spellings give equal DOMs apart from positions. Pattern keys, call names, and terminal identities are equal. Short and compact source spellings produce long diagnostics for every property, including general categories. |
| Empty selectors | No bundled scalar receives Script Katakana_Or_Hiragana or Word_Break E_Base. Their terminals still match trusted caller tokens carrying those tags. |
| Accents and reordering | `é` and decomposed equivalents produce profiles for `e` and U+0301. Lowercase belongs to `e`, and Diacritic belongs to U+0301. Reordered marks retain their profiles and source origins. |
| Exact escaped scalars | An escaped precomposed grammar literal remains exact. Input decomposition still classifies its resulting scalars, independently of that literal. |
| Hangul | `한` produces leading, vowel, and trailing jamo profiles. U+1100 has `_General_Category_Other_Letter`, `_General_Category_Letter`, `_Hangul_Syllable_Type_Leading_Jamo`, and `_Grapheme_Cluster_Break_L`. |
| Emoji | ASCII digits, `#`, and `*` have Emoji and Emoji_Component. U+200D, U+20E3, and U+FE0F retain their Emoji_Component membership. |
| Defaults | U+0378 has Script Unknown, Line_Break Unknown, and Bidi_Class Left_To_Right. U+0590 has Bidi_Class Right_To_Left. Unassigned U+3FFFD has East_Asian_Width Wide. |
| Extension sets | U+30FC has Script Common and extensions Hiragana and Katakana, without extension Common. Latin letters use singleton Latin. U+0951 has Script Inherited and all 13 explicit extension members, including Latin. |
| Distinct classifications | U+00A0 has White_Space without Pattern_White_Space. U+200E reverses those memberships. U+00B4 has Diacritic and `_General_Category_Modifier_Symbol`, without `_General_Category_Nonspacing_Mark`. ASCII A has East_Asian_Width Narrow. |
| Combining-class catalog | All 255 integers have tags. A missing alias row gives decimal forms, such as `_ccc_2`. Class 10 accepts `CCC10` in both forms and rejects decimal alternatives. Classes without assignments remain valid for caller tokens. |
| Core and normalization | Combining-class tags agree with canonical ordering. Quick_Check defaults and Maybe values match pinned data. Hangul syllable classes do not reappear after decomposition. |
| Scalar limits | Supplementary scalars, private-use scalars, and noncharacters receive complete profiles. Surrogates remain rejected input. |
| Generic observations | A grammar naming no additional property still forwards and serializes complete profiles. Adding an unrelated later-stage property reference changes no initial tag set. Whole-set comparisons include unnamed properties. |
| Inheritance and mutation | Forwarding, filtering, unions, changed values, and shared repeated characters preserve stored membership. A removed tag never reappears. One token's filter cannot change another token. |
| Provenance | A stored engine membership needs input evidence. A mask can name memberships for selection, and a deletion can remove them. |
| Caller tokens | Empty caller tags stay empty. A supplied accepted property spelling matches despite a different token value. Aliases normalize and deduplicate. Invalid or unavailable tags cause usage errors. |
| Conditional features | `$.tokens.any('_Script_Cyrillic)` tests retained memberships. Feature gates do not change origin profiles. |
| Custom resources | Missing support differs from declared-empty support. Shuffled records, equal overlaps, conflicting assignments, invalid headers, unknown records, undeclared values, and version mismatches follow the file rules. |
| Independent tables | Alternating custom tables over one scalar, concurrent reads, cache hits, and profile eviction preserve each table's answers. |
| Diagnostics and caches | Expected-terminal lists and supplied DOMs use canonical names. A properties-file change invalidates dependent caches. Missing or malformed bundled data fails even without an explicit property reference. |

Shared cases also exercise property terminals, tag tests, patterns, conditions, filters, and canonical output for every declared value. A value without scalar assignments receives both a stage-zero rejection case and a positive caller-token case. Corpus comparisons record every changed outcome caused by complete initial tag sets.

Complete profiles must not make pipelines naming no additional property meaningfully slower. Shared storage must preserve every logical membership and every observation of the full set. The [performance gate](../tests/README.md#unicode-property-performance-gate) defines measurements, limits, and baseline comparisons. That gate cannot pass through omitted tags or different parse work.

### Unicode names for string escapes

`tools/unicode-table.py` also generates `data/unicode/unicode-names.txt` from the same pinned Unicode version. The bundled version is 15.1.0. This file supplies names and aliases for string escapes. It supplies no stage-zero property tags. Libraries never use host Unicode data for name lookup.

The generator uses pinned name rules and tables. It reads aliases from NameAliases.txt and algorithmic ranges from DerivedName.txt. The sources describe the formats. [Unicode name rules](https://www.unicode.org/reports/tr44/tr44-32.html), [NameAliases.txt](https://www.unicode.org/Public/15.1.0/ucd/NameAliases.txt), [DerivedName.txt](https://www.unicode.org/Public/15.1.0/ucd/extracted/DerivedName.txt). An algorithmic name follows a scalar-based naming rule. The file stores those rules and ranges rather than one name per scalar.

The names file is strict UTF-8. Its first nonblank line is `unicode-names VERSION`, with the version from `data/unicode/unicode.txt`. VERSION has three decimal components separated by dots. The version strings must match exactly. Remaining records have these forms:

```text
unicode-names 15.1.0
name 0301 COMBINING ACUTE ACCENT
alias abbreviation 200D ZWJ
alias control 000A LINE FEED
algorithm hex 3400 4DBF CJK UNIFIED IDEOGRAPH-
algorithm hangul AC00 D7A3
```

A `name` record contains a scalar and its formal Unicode name or a permitted added name. An `alias` record contains its kind, scalar, and alias. The kinds are `correction`, `control`, `alternate`, `figment`, and `abbreviation`. All five kinds are accepted in escapes. A scalar can have multiple aliases of each kind.

An `algorithm hex` record contains inclusive scalar endpoints and a name prefix. The name is that prefix followed by the scalar's canonical hexadecimal suffix. Below U+10000, that suffix has exactly four uppercase digits. Otherwise, it has five or six uppercase digits without leading zeros. Lookup compares the complete generated name and rejects lowercase or padded alternatives.

A lookup accepts only the scalars within that record's range. The generator emits every corresponding range from the pinned data, including the ideograph families.

An `algorithm hangul` record has exactly the endpoints AC00 and D7A3. Libraries compute syllable names with the Unicode 15.1 Hangul naming algorithm and its fixed jamo short names. They do not list syllable names in the file. Hexadecimal rules likewise compute names without expanding their ranges into records.

Algorithmic formal names use algorithm records rather than explicit `name` records. An explicit name within a declared algorithmic range is malformed. A custom subset can retain an algorithm record or omit that family's names.

LF ends each line, with an optional preceding CR. The final line can end at the file's end. Blank lines are ignored, and fields use ASCII spaces or tabs. After the fixed fields, the remaining words form the name or prefix, joined by single ASCII spaces. Names contain uppercase ASCII letters, digits, spaces, or hyphens. An empty name or prefix is malformed.

Code point fields follow the numeric and scalar bounds of `data/unicode/unicode.txt`. Algorithmic ranges contain only scalars and cannot be reversed. Unknown records, alias kinds, repeated headers, and malformed fields are grammar errors. A scalar has at most one explicit formal name. Duplicate name or alias records are errors. One spelling cannot resolve to different scalars, including through algorithmic rules.

Duplicate or overlapping algorithm ranges for the same naming rule are errors. Explicit and algorithmic names share one lookup namespace with aliases. The loader rejects any spelling that identifies different scalars. These requirements apply to custom names files too.

Record order does not affect name lookup. Exact spellings, including case and spaces, determine name lookup. The records contain individual scalar names and aliases. A sequence of several scalars cannot supply one escape. Numeric escapes do not consult this file.

If the core abbreviation map does not resolve a source name escape, the library loads the selected names files. A names-dependent cache entry can use bundled fingerprints without reading these files (§8). Printing never loads them because abbreviations belong to the core table. A pipeline can share immutable names data for equal resource sets. Without such a source escape or cache dependency, declared names data remains unread and cannot cause a file error. Cached strings and supplied DOM strings already contain decoded scalars, so they need no name lookup.

A caller can supply `data/unicode/unicode-names.txt` beside `data/unicode/unicode.txt` in the source map. That file replaces all bundled names data, with no fallback for missing entries. A custom file can omit standard names, aliases, and algorithms. The two files must declare the same version.

A name is unknown only when neither the core abbreviation map nor the combined selected names files resolves it. Omission from the base file alone therefore does not make a name unknown. If lookup reaches names files, only the selected base file and declared extras can resolve it. No bundled fallback supplies omitted entries.

An unnamed scalar has no pinned formal name, algorithmic name, or alias. A custom file can retain pinned formal names unchanged or add a `name` record for an unnamed scalar. Private-use scalars are one example. Controls have standard aliases, so `name 000A NEWLINE` is invalid.

A custom record cannot change a standard formal name, including an algorithmic name. Standard alias records must retain their pinned kind, spelling, and scalar. Custom algorithms can only retain or omit the pinned rules and ranges.

An added name starts with an uppercase ASCII letter. Its remaining characters are uppercase ASCII letters, digits, spaces, or hyphens. Single spaces separate words, without leading or trailing spaces. It cannot duplicate any pinned formal name or alias, even one omitted from the selected file. It cannot match an algorithmic name or the numeric escape form.

It cannot conflict with an active core abbreviation or another selected file's name. Exact duplicate additions across different files are harmless, but conflicting names or two formal names for one scalar are loading errors.

For names-file inspection, the reference is the complete bundled `data/unicode/unicode-names.txt`, including its algorithmic rules. A loader reads that reference whenever it reads a custom base file or an extra names file. The reference serves only inspection and never supplies omitted lookup entries. Libraries do not embed the complete catalog. Custom core tables do not change which names count as standard.

Disk and bundled loaders obtain the reference from the package's pinned `data/unicode/unicode-names.txt`, independently of any selected replacement. The portable source map supplies that same text under the reserved key `data/unicode/unicode-names-reference.txt`. Libraries embed its pinned FNV-1a fingerprint (§8) and reject different reference text. A selected base with that fingerprint can also serve as the reference, without a second read.

The reference declares Unicode 15.1.0. Names files require a reference with the same declared version. An unavailable reference, a different fingerprint, or a version mismatch is a grammar loading error naming `data/unicode/unicode-names-reference.txt`. No host database supplies the reference. The reference is not a selected lookup resource and adds no entry to a cache's `names` map.

If bundled resources exist and versions match, an omitted names file selects the bundled file. If those resources are unavailable and names data is needed, the caller must supply the names file. A version mismatch, missing required file, or malformed names data is a grammar loading error. The error names `data/unicode/unicode-names.txt`. If the line is known, the error includes it. These resource errors arise during source escape inspection or names-dependent cache loading, never from printing.

If names data is needed, the core table must declare exactly one Unicode version. A missing or repeated version prevents names-file selection and causes a grammar loading error. Numeric escape parsing does not add that version requirement by itself.

### Extra names files

An extra names file adds names to the base file.

A preamble is the initial run of resource declarations.

A grammar or pipeline document declares an extra names resource with `%names "PATH"`. These directives form a preamble before every other statement in that document. They can span several grammar blocks. Each directive takes exactly one quoted path. The path uses literal resource-path decoding and resolves against the declaring document's directory. Its escapes can use numeric values or active core abbreviations, but cannot require a names file.

The path follows the relative-path rule of §13. A target that starts with `/` is a grammar error at `%names`.

After lexing, the preamble pass collects the longest leading run of `%names` directives. An operand ends at the next statement-start token or the end of input. Rule, directive and constant keywords start statements. Comments and grammar block boundaries do not end the run.

The pass inspects leading directives in source order. For each directive, a wrong operand count or kind fails first at `%names`. It then inspects that path's escapes from left to right. A malformed or nonscalar escape fails at its opening `‹`. A name outside the core abbreviation map also fails at `‹`. Preamble errors precede every other escape-inspection error.

Ordinary escape inspection applies the same restricted decoder to every `%names` path, including a misplaced directive's path. It never loads names data for that path. A misplaced `%names` fails later during reader conversion at the directive. The syntax grammar still recognizes ordinary directive operands. The handwritten bootstrap reader follows the same preamble pass.

A document inherits the extra resources of its includers and adds its own declarations. The resulting set applies to all strings in that document and to its nested includes. Returning from an include restores the includer's set. A declaration in one sibling never affects another sibling. Resource selection is independent of stage selection, feature gates, and stage replacement.

Normalized resolved paths identify resources. Repeated declarations of one path select it once. Lookup combines the selected standard file with all selected extras, without priority between files. Every extra uses the `unicode-names VERSION` header and the record syntax above. Its version must match the active core.

Extras contain only `name` records for unnamed scalars, without aliases or algorithms. Duplicate equal records across files are harmless. All other duplicate and conflict rules still apply.

The first noncore name escape loads the base file, followed by extras in code-point order of resolved paths. The loader inspects the complete combined namespace before lookup. Each added record uses combined indexes for spellings and formal names. A conflict is a resource error naming the later file.

Core abbreviation lookup still comes first. A missing extra file names its resolved path. A declared file that remains unused is not loaded.

A required names file that is absent gives `PATH was not found`, where `PATH` is its resolved path. The grammar error names that path as its document and has no line or column.

The DOM retains each `%names` directive and its decoded path. Its declaration order follows source positions across the three declaration arrays. Distinct names declarations require distinct positions. Every statement of another kind must follow all names declarations.

Pipeline splicing consumes these directives before stage stitching. They never enter a stitched grammar or bootstrap stage. Supplied DOMs follow the same preamble placement and path rules. Canonical stitching omits these directives because it prints decoded strings with core abbreviations or numeric escapes.

The [zbalermorna grammar's encoding section](../grammars/lojban/common/zbalermorna.md#two-encodings) gives a bundled example of an extra names resource. The grammar document owns that resource's inventory, source pins, and pipeline behavior.

Shared string cases round-trip every bundled White_Space scalar through canonical printing and the ordinary reader. U+0020 stays literal, abbreviation aliases win when present, and every other whitespace scalar uses a numeric escape. Cases also use custom whitespace ranges and missing abbreviations.

Shared core cases reject `abbreviation 0041 LF` and `abbreviation 0041 SPACE` during core loading. Correct bindings `abbreviation 000A LF` and `abbreviation 0020 SPACE` remain valid. These cases do not require a grammar name escape or a names file.

A header-only custom names file does not prevent core lookup of `‹LF›`. A name omitted from both lookup routes remains unknown, without bundled fallback. These cases distinguish core priority from file replacement.

Shared names cases exercise allowed private-use additions, omitted standard names, forbidden renaming, control aliases, reserved algorithmic names, alias collisions, and conflicts between extras. They also cover inherited declarations, sibling isolation, duplicate paths, lazy missing files, source-map paths, and caches under different inherited sets. Separate cases require the pinned reference for custom and extra files. Core inspection uses its embedded 15.1 catalog even with a core declaring another version. A replacement file never restores omitted lookup entries through that reference.

An unknown name is a document error at the escape's opening `‹`. It never falls back to a host name database or an empty string. The same error applies inside a definition that a later statement replaces.

Escape inspection follows successful lexical recognition and precedes syntax recognition. It visits quoted tokens in text order and reports the first invalid escape at its opening `‹`.

Shared cases distinguish leading preamble errors from misplaced directives. A leading wrong operand count wins over an invalid escape in that directive. Malformed numeric path escapes and noncore path names fail at `‹`. A misplaced path receives the same restriction without loading names data. An earlier unclosed rule beats a misplaced `%names foo` during syntax recognition. A misplaced directive with a valid path fails later during reader conversion.

The lexical grammar performs no name lookup. Its string tokens retain their escape spellings. Shared cases combine invalid escapes with later lexical errors, earlier reader errors, and syntax errors. They also pin left-to-right selection between two invalid escapes.

### Engine-tag provenance

A stored engine membership needs evidence from an input token or a derived observation with that membership. The loader traces this evidence through aliases, constants, functions, copies, selection, splats and inheritance. An equal key set can carry different evidence.

A grammar can name a supported engine key in a mask and can delete it. These operations create no stored membership. For example, `$x.select({_Script_Latin})` retains the membership only if it exists on `$x`. A splat of `$INPUTS` into `$OUTPUTS` grants permissions without adding those memberships to a token.

`_Elided` is an origin test. It works only in body filters, tree patterns and elidable heads. The loader rejects it as a stored entry, mask member, deletion, named property or presence argument.

## 2. Grammars

A stage stitches rules, directives and constant definitions. Rules can give a statement bag term and an alternative bag term. A definition also owns its conditions, message, suppression, erasure or output selection. [The DOM](output.md#a-grammar-dom) records those written declarations.

Corresponding stitching errors use common wording across libraries. A located message begins with `document:line:column: `. The formatter adds the stage from its structured field. The description has no additional enclosing-rule prefix.

| Error | Description after location and stage prefixes |
| --- | --- |
| Undefined constant | `$NAME is not defined in stage STAGE` |
| Undefined rule | `NAME is not a rule of stage STAGE` |
| Empty stage | `has no rules` |
| Missing start rule | `has no rule text` |
| Missing resolution | `has no %ambiguity-resolution` |
| Duplicate resolution | `has a second %ambiguity-resolution` |
| Invalid range endpoint | `a range endpoint is one scalar` |
| Reversed range | `a range starts above its end` |
| Undefined capture | `$NAME is captured by no alternative of RULE` |

A duplicate rule names its earlier document as `%rule NAME is already defined, in DOCUMENT; %redefine-rule replaces a rule`. An invalid extension says `%extend-rule NAME extends a rule that is not defined before it`. An undefined constant dependency adds `; dependency $FROM → $MISSING` after its undefined-constant message.

An undefined capture diagnostic uses the first unknown name in written clause order. Inspect the statement term, alternatives with their terms, conditions, message and output items. Visit each item in expression order.

Stitch declarations in written order within each document run. Equal positions keep category order among rules, directives and constants. The loader rejects a duplicate resolution directive when it records that directive.

After recording declarations, bind constant versions. Inspect references in rule and feature expressions in the same declaration order. Check the resolution directive and start rule before final rule references.

An uncalled template retains its declaration position for immediate inspection. Only the explicitly deferred ranked-definition problems use the later template queue of §9.

Inspection positions identify document runs, not just paths and coordinates. An include's declarations precede the including document's later declarations.

Every inspection record retains its source run, owning declaration, and position within that declaration. This includes retained arguments of bindings, edits, ordinary rules, and templates. Argument fragments retain the argument's source position. They enter a generated phase only when substitution generates their owner.

Within each binding phase, constant, type, and bound-value inspection use those positions. Constant references from a rewritten declaration and its retained arguments form one ordered list. Types and values retain the same source ownership. A separate argument queue cannot place an earlier argument after a later clause or declaration.

A rule resolves every retained and rewritten constant reference before type inspection. Its type inspection precedes bound-value inspection.

Constant-reference inspection follows source clause order, including inside retained templates. Conditions precede the diagnostic message, suppression, and emission items. A test visits its symbol before its value operand or tag requirements, then continues to the next body symbol. Serialized DOM member order does not change this inspection order.

A pattern call visits its arguments before its attached children. Arguments include terms, requirements, body fragments, target lists, and nested patterns. Pattern context does not remove operands of union, intersection, or difference terms. Every term and condition container uses its semantic child order, regardless of JSON member order.

Feature-shape and bound-type inspection use the original condition list. Pattern evaluation and value substitution follow both inspections.

Boundary-target inspection precedes the final rule-reference traversal. Both follow the requirements for a resolution directive and the start rule `text`.

Boundary reachability classifies a reference as a rule or terminal by its spelling. An undefined rule remains a reached rule reference. Final reference inspection reports its missing definition.

A clause uses one written-order walk for rule names together. A method's receiver precedes its arguments. A loading error from stitching always carries the stage name. A missing resolution or start rule has no document, line, or column.

To stitch a stage's items, the loader reads them in order, whatever documents they come from. Each rule is stated one of three ways, and each is an error in the case given:

- `%rule` (`define`) defines a rule. It is an error if a rule of that name was defined before it in the stage.
- `%redefine-rule` (`redefine`) replaces the rule of that name defined before it in the stage. It is an error if none was. The earlier alternatives are then gone, those of any `%extend-rule` of the rule included.
- `%extend-rule` (`extend`) appends its alternatives to the rule of that name defined before it in the stage. It is an error if none was.

An extension owns its own terms, conditions, diagnostics, suppression, erasure and emission. Its clauses apply to only the new alternatives.

A key step of `%ambiguity-resolution` names the nodes that it counts in a node pattern (§6, §9.3). A rule name in that pattern must be defined in the stage, as a name in a body must. A step that names a rule counts the stitched rule, so it counts the alternatives of a redefinition and of every extension. A tag test on a rule atom reads the visible keys in the node's working bag (§3.7). An added alternative can get the tested key from a term, its primary, its sole symbol or stage defaults. A layer changes what a step counts by `%redefine-const` of a pattern constant that a step names, where the base chose to name one.

The loader collects directives from all the stage's items. `%stage`, `%extend-stage`, `%redefine-stage`, and `%include` shape the pipeline (§13). Global `%features` also shapes the pipeline. Local `%features` and `%ambiguity-resolution` belong to a stage.

A stage also has constants. A constant is a named value that terms and conditions use (§10). Its name is `$` and a name (§9) that begins with `A` to `Z`, such as `$SU-STOPS`. By convention, the whole name is in capitals.

An item states a constant in one of two ways. `%const $NAME t` (`define`) defines the constant. It is an error if a constant of that name was defined before it in the stage. `%redefine-const $NAME t` (`redefine`) redefines the constant value. It is an error if no constant of that name was defined before it in the stage.

`t` is a closed term (§10). Every user constant reference binds to its name's final definition in the stitched stage. Other names can refer forward. Inside `%redefine-const $X t`, `$X` binds to X's immediately preceding definition. This lexical exception applies inside nested patterns, but never through another referenced constant.

String escapes resolve during document reading. Their decoded scalars belong to string terms and never enter the constant version graph. This rule covers strings in every syntactic position.

A data constant is a closed expression. A function constant binds one explicit argument and can refer to constants. Infer its result for the actual argument's shape, including the rule, route and child shapes for defaults.

The loader builds a directed graph of dependencies between versions. It rejects unknown names and cycles across all versions, including replaced definitions. A cycle error gives source positions and its dependency path. Acyclic versions evaluate in dependency order. Every version of one name must have the same type.

The printed dependency path starts at the repeated version and ends by naming it again. It excludes any acyclic entry path. If any cycle name has multiple declarations, every path element includes its declaration location as `$NAME [DOCUMENT:LINE:COLUMN]`.

The loader rejects unknown names and dependency cycles across all constant versions. A cycle error gives source positions and its dependency path. The loader infers each version independently and checks each use against the version it reads.

After the loader stitches the stage, it makes sure that each rule definition that holds a constant meets the requirements of this section. An undefined user constant is an error there. The types of the terms, conditions and tests that hold constants must agree (§9, §10).

A predecessor remains an expression. Its other references use final definitions. For example, if the preceding `$A` refers to `$B`, `$B` still uses its final expression.

This inspection includes template arguments that no parameter uses. The loader retains their terms and expression fragments until constant inspection finishes. Value inspection also rejects direct empty delimiters and invalid range endpoints inside retained pattern arguments. It visits value operands in written order and reports the first fault.

Inspect delimiters, range endpoints and pattern values in written order. Include the statement term, each alternative with its body and term, the conditions, message, suppression and output items.

A constant in a value test must resolve to a string (§9). The requirements of §9 that depend on the value of a constant apply there too. The loader applies these requirements to every definition of the stage. That includes a definition that a later `%redefine-rule` replaces, although its alternatives are then gone.

Constant type propagation revisits dependent declarations in ascending declaration order. This order also decides which dependent type error the loader reports first.

A constant belongs to its stage, as a rule does. A document in several stages or pipelines takes the values of each. The DOM of a document holds its definitions and its references to constants, never their values (§8).

The loader reports duplicate definitions and missing predecessor versions at their declaration. A closed error belongs to loading. An error that depends on features or input types belongs to the affected stage.

### Classification

Check each closed receiver of `.classify` after resolving its version and gates. Check references against the possible names over versions of this table. Reject an unknown target. Mentioning a name only in a reference or deletion does not declare it. A known target removed by a gate or deletion contributes nothing.

Each effective class entry needs a string, list of strings or key set of references. An unconditional bare class entry fails loading. A gated bare entry fails only in a specialization that retains it. Only an explicit classification lookup follows class references. Giving a token `UI` outside the lexicon adds no `Indicator` key.

A caller or rule giving `UI` directly must also give `Indicator` wherever the later grammar requires it. An empty list defines a class without direct members. The empty string is a member in its own right.

Build an inverse index from each exact string to its directly matching keys. For a reference from class A to class B, add a reverse edge from B to A. Query the index once and follow reverse edges from all seeds. Deduplicate visited classes. A reference cycle without a seed yields nothing.

A seeded cycle yields each reachable key once. Return bare keys regardless of the case of their names. A class such as `BAI` can hold a list of spellings. Duplicate spellings or paths cannot produce duplicate result keys.

Build once per effective table, including gate outcomes. Index construction takes expected linear work in spelling bytes, membership entries, classes and reference edges with collision-safe hashing. For an uncached lookup, count hashing the string, visiting seeded classes and scanning their reachable edges. Charge ordering the result separately during serialization. Cache a result under the exact table and spelling.

Do not scan every lexicon row for every token. Materializing every transitive answer can require quadratic space. A memory bound can evict cached answers without changing them.

### Initial interface and callers

On text input, `$INPUTS` is the finite key set of canonical Unicode memberships the configured stage-zero producer can supply. Use the supported registry, even for empty text. Exclude aliases, `_Elided`, `value` and `image`. Unicode support can change this set. No grammar document controls it.

The caller-token entry point replaces the origin producer. It accepts the two string fields, canonical bare Unicode memberships and bare ordinary user keys. Additional payloads require a grammar producer. This rule gives first-stage reads a stable payload type without a caller schema. For caller input, augment the origin key set with the finite user keys present in the supplied table.

Scanning the accepted records establishes those names before feature decisions. With no records this adds nothing. Even an empty batch permits tests for bare user keys. Accumulate user names during input validation. Reuse lowered plans only across equivalent observable input interfaces and gate outcomes.

For example, a feature decision can read `$INPUTS'Extra` before lowering. Adding a bare Extra to one caller batch can enable another alternative despite the unchanged payload types. An empty output from a grammar producer never undergoes this reconstruction.

Normalize allowed engine aliases. Reject unsupported engine memberships, non-bare membership payloads, forged origin fields, nonempty diagnostic lists and malformed scalar strings as usage errors. Preserve explicit empty strings. An omitted caller string defaults independently to text. Retain each port’s documented source construction and range validation.

Caller source ranges can overlap. If the caller omits `props`, accept bare tag lists. Reject mixed input encodings. Copy mutable caller data or retain immutable snapshots. A caller can represent a digit with an empty value and a visible image.

No reader can infer its flags from those strings.

For every later stage, `$INPUTS` is the predecessor’s effective `$OUTPUTS`, excluding the two implicit string permissions. A grammar defines `$OUTPUTS` as an ordinary constant key set. Reject valued members. Explicit bare entries for `value` or `image` make no change. Absent `$OUTPUTS` means a tree-only last stage.

An empty set publishes tokens with the two strings alone. An empty published array still carries its invocation’s effective permissions internally. The next parser never obtains its interface by scanning that array.

A stage has exactly one `%ambiguity-resolution` directive, or it is an error naming the stage. The directive lists one or more steps (§6). A stage has at most one `%elision-only` directive, which turns on the check of §7 for the stage. A second one is an error naming the stage.

No form adds to either directive or replaces it. A document that holds one states that policy for every pipeline that includes it. Where pipelines differ in the policy, each pipeline document states its own directive.

No directive names elidable terminators. A rule marks each elidable optional in its body, as `[+T …]`. Whether an optional is elidable is a property of the optional itself. It is the same in every stage that includes its document.

A lowercase name is a rule reference and must be defined in the stage. `🆓` is an ordinary rule name. A capital name or engine tag is a tag terminal. A string literal or string constant is a value terminal. A range matches one scalar value, and `_` matches any ordinary token. Section 9 specifies lexical forms and terminal identity.

Binding retains each range endpoint as a scalar value. A wildcard has its own terminal form. Neither matcher derives character values from stored tag names. Unicode property terminals read stored membership directly.

A rule reference, call, splice, terminal or parameter accepts one tag test and one value test, in that order. A tested parameter must receive one symbol. A value test uses `=` or `≠` with a string literal or string constant. A tag test lists signed tags or key-set constants in `<…>`. All listed requirements hold together. An empty constant supplies no requirements.

A terminal test reads its leaf's bag and origin. A rule test reads the rule's bag. A value test on a rule requires the proof in §4. Tests do not alter terminal identity.

An inspection record owns one source declaration and a position within it. Its key contains the document run, declaration position, and semantic position of the inspected part. Generated owners use the discovery order after source owners. Deferred ordinary and template problems retain separate later phases.

The loader preserves these keys through argument retention, fragment conversion, substitution, and deferred error collection. Diagnostic locations remain distinct from ordering keys. A location can fall back to the declaration when a cached node lacks a written token position.

Pattern parts define one child schedule for reference, type, and range inspection. A source-call part exposes its arguments before attached children.

The loading paths use the following positions. The table names the entry points in each library, including the helpers that inspect nested parts.

| Path | JavaScript | Python | Go | Rust | Position source |
| --- | --- | --- | --- | --- | --- |
| Constant versions and dependencies | `bindConstants`, `constantsIn` | `_Constants.bind`, `constants_in` | `bindConstants`, `constRefs` | `Constants::bind`, `references_in_term` | Recorded declaration and dependency-reference positions, in version order. |
| Closed constant values | `evaluateClosed`, `checkValueUses` | `_closed`, `check_value_uses` | `evaluateClosed`, `checkValueUses` | `evaluate`, `check_value_uses` | The version's declaration, then the term, operand, or first implicated constant position. |
| Ordinary and retained template rules | `checkConstantRule` | `_Constants.check_rule` | `checkConstantRule` | `Constants::check_rule` | Original source run and declaration, then header, alternative, condition, and emission positions. |
| Retained term and requirement arguments | `inspectArgumentConstants` | `_Constants.check_arguments` | `checkArguments` | `Constants::check_arguments` | The call's owning declaration and the argument's source position. |
| Retained test and body fragments | `inspectArgument`, retained fragment records | `inspect_argument`, retained fragment records | `inspectArgument`, retained fragment records | `inspect_arguments`, `RetainedPart` | The same owner and argument position as the source fragment. |
| Feature conditions | `resolveFeature` | The feature branch of `_stitch` | `resolveFeature` | `resolve_feature` | The directive's source slot, then condition and operand positions within its complete-list phases. |
| Test and pattern parts | `constantsIn`, `checkPatternUses` | `constants_in`, `check_pattern_uses` | `constRefs`, `checkPatternUses` | `constants_in_rule`, `constants_in`, `check_pattern_uses` | The symbol precedes its test operand. A call's arguments precede attached pattern children. |
| Bound types | `ruleTypeFault`, `termType`, `conditionTypeFault` | `rule_type_fault`, `term_type_fault`, `condition_type_fault` | `ruleTypeFault`, `termTypeIn`, `condTypeFault` | `rule_type_fault`, `term_type_in`, `cond_type_fault` | The inspected source part and its implicated constant position. |
| Bound values | `checkValueUses`, `checkRangeUses`, `resolvePatterns` | `check_value_uses`, `check_range_uses`, `with_values` | `checkValueUses`, resolver walks | `check_value_uses`, `check_scalar_uses`, substitution | The declaration's ordered part records survive resolution and pattern evaluation. |
| Final substitution | `resolveConstants` | `_Constants.resolve`, `_resolve_tests` | Resolver walks after `resolveConstants` | Substitution helpers after `check_rule` | Existing source ownership survives replacement by a bound value. This path creates no later inspection slot. |
| Deferred ranked-definition problems | `emissionUsers`, pending templates | `deferred_emissions`, `template_deferred` | Deferred emission and template lists | Deferred ordinary and template lists | The original source key, within the separate ordinary or template phase. |

### 2.1 Ranked choice validation

Identify each ranked expression after final stitching and constant binding. Its identity is the final rule, zero-based alternative index, and expression path. Its options retain source order. Every group requires at least two expressions.

Visit rules in expanded order (§2.3), then groups in alternative and expression order. The first offending group determines the error. Its source position identifies the first `≻`. Use the written positions of term operands and boundary atoms. The enclosing definition does not replace those positions.

Within each group, inspect its written clauses with the structural information that boundary tests need.

If no written clause reads a name the group can bind, the loader can skip the route walk for private bindings. It still proves common early bag observations.

For each group, the loader projects routes onto names read by conditions that can bind to that group. Written export checks retain only names that the group can bind. A projected route retains capture presence, ownership, and relative order, plus active binding groups and their option and completion positions. Prefix summaries retain finite productivity and possible token consumption. Unread captures and intervening symbol counts create no distinct states.

The loader merges equivalent summaries at each expression join and keeps their first route in ordinary expansion order. Summaries of `some-of` retain nonempty operand selections and their original subset order. Each alternative caches projections by their retained names and shares matching projections across groups. These summaries preserve route-first clause diagnostics within each group.

A capture inside an option belongs to its innermost ranked group. Simplify each condition for capture presence in every virtual option expansion. A virtual expansion records written capture positions without copying the parent. Every remaining condition that reads a private capture must be ready when its binding group completes.

Each selected option binds captures declared within its group, whether present or absent. An active nested group binds its own captures. When a selection skips that group, the enclosing group binds its absent captures. Loading and runtime use the same bindings. Determine these bindings before capture-presence simplification.

`$` becomes ready only at completion of the enclosing named alternative. A final ranked group can reach completion. Any suffix element, even one that can read no tokens, delays it. An unready private condition reports `ranked-choice-continuation`.

After readiness validation, reject a private condition with `$.preceded-by(S)` if its option can start after the named rule starts. Both positive and negated atoms follow this rule. Report `ranked-choice-boundary` with the written condition as `expression` and the offending option as `option`. The message names the condition, the atom, and the option. It suggests two rewrites: move the condition into a rule that starts with the ranked group, or test the private capture itself.

Record each group's start in every virtual expansion. Its prefix can read tokens if every prefix step has a finite structural derivation and some step has a nonempty derivation. Compute these facts over the final stitched grammar, including disabled alternatives, without conditions or symbol tests. An empty-only prefix remains legal. A forward atom on `$`, a backward atom on a private capture, and a condition without private captures follow their rules.

An option qualification can inspect its ready captures. A private binding can serve a late expression where the option wins. A forbidden private binding read in a message or early expression reports `ranked-choice-export`.

An outside recognition reader needs a common expression from every active option. The engine must prove that the expression uses common input and bindings. Trace the dependency through defaults, copies, functions and structural tests. Apply this rule to every effective supplier in a layer. An outside early bag observation without a common supplier proof reports `ranked-choice-tags`. A late failure never admits another option.

A DOM record with only `ranked` reports `ranked-choice-syntax` if its value is not an array of at least two options. A mixed constructor or malformed option reports an ordinary malformed-DOM error. Thus `{"ranked":[]}` gets the ranked code, while `{"ranked":[],"empty":true}` gets the ordinary error.

A failure of the syntax stage carries that code when its failing token is `≻`, or the preceding token is `≻`. A failing `|` also carries it when its current grouping level already contains `≻`. Grouping levels start at `(`, `[`, or `{` and end at their matching closer. A keyword starts a new statement at its current level.

Thus `a | b ≻ c`, `a ≻ b | c`, `| a ≻ b` without a statement term, `a ≻`, and `≻ a` carry `ranked-choice-syntax`. Other unrelated reader errors retain their codes or uncoded form.

Loading errors carry the structured members defined in `docs/output.md`. For a `ranked-choice-tags` error with a supplier path, store the shortest path from the group to the diverging supplier in `inheritance`. Source traversal order breaks equal-length choices. Helper sites use written expression paths.

### 2.2 Close families

A close family is a set of rules. A `.without-elision-except` call names it through one rule of the stage, its family rule (§4, §10).

The members are the least set that holds the family rule and is closed under one step. Take any member. Each member edge of one of its alternatives makes the edge's target a member too. A member edge is one path from the alternative's `expr` to one `ref` to a rule. The path can pass through `capture` and `test` nodes and through the branches of a `choice`. It cannot pass through `seq`, `optional`, `repeat`, `and` or `ranked`.

So `{"choice":[{"ref":"a"},{"ref":"b"}]}` gives two edges, and `{"optional":{"ref":"m"}}` gives none.

The loader reads members from final expanded rules, never from lowered productions. Instance calls become ordinary rule edges after expansion. Every alternative counts, whatever its gates. Tests, bag terms and conditions do not gate membership either. So an `%extend-rule` can add a member, and a `%redefine-rule` can remove one. Members never depend on the enabled features.

The loader computes memberships only for family roots that written calls name. Lowered grammars share these immutable memberships across feature selections.

A rule owns the elidable optionals that its definition writes outside call arguments. Helpers never own an optional, whatever expression holds it. An `%extend-rule r` writes optionals that `r` owns outside call arguments. A family permits each elidable optional that one of its members owns. A family can permit none. Its queries then answer as `.without-elision` does.

After expansion, only an instance owns each elidable optional of its expanded definition, including one that an argument supplies. A template owns no optional.

A family argument is a rule reference, so the reference checks of this section cover it. A call can stand in a term, condition or output expression. The loader reports an undefined family rule at the definition that contains the call.

Visit references in expanded rule order (§2.3), in written operand order within each definition. Visit the statement term, then each alternative with its body and term. Then inspect conditions, messages and output items. The first undefined name determines the error. The site of an extension's error comes from that extension.

### 2.3 Templates and instances

A template is a rule with load-time parameters. An instance is one template with concrete arguments. Expansion replaces parameter nodes with argument nodes before ordinary rule validation and lowering.

```jbogenbau
%rule pair(@Left, @Right)
  @Left @Right

%rule named-pair = pair("a", "b")
%rule text
  named-pair | pair("a", "c")
```

Parameters belong to one definition, including its alternatives, clauses, conditions, and emission. They have no dynamic scope. Another template receives a parameter only through an explicit argument.

A parameter starts with `@` and an ASCII letter. Its remaining characters are ASCII letters, digits, hyphens, or underscores. Case counts. A declaration contains one or more distinct parameters, separated by commas. Default arguments, variable argument counts, and overloaded names do not exist.

A template and an ordinary rule never share a name in one stage. Redefinition cannot convert one kind into the other. Their names follow the same rules, including valid emoji names (§9.1). After substitution, bare template references are errors outside pattern rule atoms. An argument can carry such a name only to pattern uses. A call of an ordinary rule is an error.

A call has `(` immediately after its name, without whitespace or a comment. A line comment before `(` prevents a call. `r (x)` is a reference followed by a group. A template declaration uses the same adjacency rule.

A call is a rule symbol. Captures, tests, patterns, rule-valued method arguments, and close families can name it. A call in retained syntax creates one instance even when no body references that instance. Binding calls and exact-instance edit heads also create their instances when later statements replace them. Normal reachability requirements still apply to neighbor targets.

#### Arguments and substitution

An argument is one term, separated from other arguments by a comma at the call's outer level. Delimiters protect punctuation inside an argument. Parenthesized body expressions and `ε` pass sequences as one argument. No extra sequence sigil exists.

```jbogenbau
%rule link(@Prefix, @Body)
  @Prefix @Body

%rule linked = link((BIhE 🆓), mex-group)
%rule plain = link(ε, mex-1)
```

The argument reader takes a marked expression after `=`. For an unmarked argument, it takes the first complete match in this order.

1. A requirement list, `<…>`, with the ordinary signed requirement syntax.
2. An ungrouped target choice, with two or more targets separated by `|`.
3. A parenthesized body expression, optional, repetition, or `ε`.
4. A symbol, including a rule, call, parameter, tag, string terminal, range, wildcard, splice or tested symbol.

A parenthesized single symbol keeps its category. Other body arguments retain their structure. Parentheses alone add no DOM node. An unparenthesized run of body symbols cannot supply one argument.

An argument cannot declare or read a capture, including `$` and captured string methods. Capture reads nested inside patterns or calls also fail. Constants retain their separate closure rules. An argument inside a template can use only that definition's declared parameters.

Substitution copies one parsed node into each use. It never reparses text or changes the grouping around the use. A parameter can occupy a body operand, pattern operand, query body, filter requirement, or term position. Expression positions include conditions, rule terms, output terms and messages.

Node decorations are exact prefixes, tests, or child lists.

The use determines the conversion, before ordinary validation:

| Position | Accepted argument and conversion |
| --- | --- |
| Body operand | Body EXPR, one symbol atom, or a target choice converted to one choice |
| Captured or tested symbol | One symbol after argument conversion |
| Boundary target | Rule name, call, user tag, or spliced target choice |
| One rule argument | Ordinary rule name or exact instance |
| Signed requirement | Tag, key-set constant or unnegated spliced requirement list |
| Value test or range endpoint | String literal or string constant |
| Pattern operand | Name, call, tag, string, constant, terminal atom, or whole pattern predicate |
| Pattern node with `·`, tests, or children | One node test that accepts those decorations |
| Expression | A marked expression of the required type, or an applicable parameter after substitution |

A name becomes `ref` in a body, `name` in a pattern, or `rule` in a rule argument. A tag becomes a body `ref`, pattern `terminal`, or a requirement name. A string becomes a body or pattern `literal`, or retains its term form. A user constant becomes a pattern `constant` or the ordinary constructor for its other use. Other conversions keep their ordinary tests and type restrictions. No conversion changes runtime scope.

A pattern argument in a child item consumes one child. It never splices its children into the enclosing list. A node decoration requires a compatible node test after conversion. Each decoration conflicts only with the same decoration already on that argument. Written tests retain their ordinary target and order restrictions. A compound predicate cannot receive node decorations.

An exact prefix requires an argument without an exact prefix. An attached list requires an argument without an attached list. Thus `·@X` accepts `#a⁅ b ⁆`, and `@X⁅ b ⁆` accepts `#·a`. Both uses produce `#·a⁅ b ⁆`. Neither use discards an existing decoration.

An expanded use must satisfy the original position's syntax and type rules. For example, `$x:@P` requires one capturable symbol. A sequence or choice cannot acquire a hidden wrapper rule. A value-test operand still requires a string literal or string constant.

A parameter cannot construct a declaration name, gate, method, key or binder. An elidable head needs one untested user terminal. Grouping a single user terminal keeps its category.

Only two positions splice an argument's children into the surrounding list:

| Use | Argument | Substitution |
| --- | --- | --- |
| One complete boundary-target entry | A target choice | Targets enter in written order |
| One complete unnegated filter requirement | A requirement list | Requirements enter in written order |

```jbogenbau
%rule letter(@Char, @Forbidden)
  $c:@Char
%conditions
  ¬$c.followed-by(h | @Forbidden)

%rule filtered(@Char, @Excluded)
  @Char<¬Accent @Excluded>

%rule b = letter("b", b | unvoiced)
%rule a = filtered("a", <¬Ogonek ¬Caron>)
```

A requirement list is distinct from a key set. An empty `<>` splices no requirements. A list under `¬@X` is an error. A tag or key-set constant under `¬@X` retains ordinary requirement negation. A requirement list in any other position is an error.

A target choice can also supply one grouped body choice where a body operand accepts it. It cannot become a key set or a pattern. Parenthesized body choices never splice into boundary targets. A target list must remain nonempty after substitution.

Elsewhere, substitution keeps the argument as one node. Ranked groups keep their own seals and priority. Ordinary union flattening still applies after substitution.

Substitution also flattens pattern intersections before expanded-pattern validation, including in conditions and call arguments. Each resulting array retains operand order, duplicates, and source attribution. This normalization applies only to nesting that substitution creates. Initial shape inspection still rejects nested intersections in supplied or cached PATTERN constructors.

After type resolution, term-level intersections with pattern type also flatten nested intersections in their effective form. This normalization precedes evaluation, expanded type inspection, and instance keys. The cached term keeps its unresolved shape. Key-set intersections retain their nesting. Difference retains both operands for every type.

For example, a template condition can contain `#(@P ∩ A)`. With argument `= #(A ∩ B)`, substitution produces `#(A ∩ B ∩ A)`. The expanded pattern has one intersection array with three operands. Term-level intersections of pattern values also flatten, through groups and after substitution.

```jbogenbau
%rule t(@P) A
%conditions $ ≅ #(@P ∩ A)
%rule text = t(= #(A ∩ B))
```

Substitution also flattens concatenations before inspecting expressions. Their operands enter in order, including empty operands. Each operand retains its source attribution.

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

After stitching, the loader requires each error code to be a valid rule name (§9.1). Each warning code must be a valid feature name. These requirements hold for every diagnostic rule, with call heads and public-name edits included.

An instance with a diagnostic clause uses its final public name as its code. If rebinding leaves it unnamed, its canonical call spelling fails the code-name requirement.

An edit written with NAME applies to the key bound at that statement's source position. Earlier edits remain on the old key after rebinding. Later edits by NAME apply to the new key. Every reference to NAME, except the head of an edit, uses its final binding. Exact calls continue to name their own instance keys.

`%conditions` and `%emit` cannot follow a binding. Supplied binding DOMs enforce the same restriction.

An instance receives these from its effective definition. Instance-specific edits use a later ordinary body statement.

An unnamed instance uses its canonical call spelling. The printer preserves the normalized argument DOM, without expanding constants or named instances. It joins arguments with `, `, places `(` directly after the template name, and writes `)` after the last argument.

Names, calls, tags, constants, `_`, `ε`, and `∅` retain their lexical spellings. A range joins its endpoints with `..`, without spaces. Signed requirements use `<A ¬B>`, including `<>`. Target choices use `a | b`.

String arguments use ordinary notation quotes and the escapes of §9.1. Each required escape uses the selected abbreviation alias or numeric code point. Other scalars remain literal. This spelling distinguishes a literal argument from an explicit concatenation argument.

Body arguments retain outer parentheses, except bare `ε`, optionals, and repetitions. The printer separates sequence items with one space. It uses ` | `, ` ≻ `, and ` & ` between operands. An optional has no internal padding. Braces have no internal padding except the spaces around `/` and between a chain marker and its item.

Parentheses follow binding strength. In bodies, sequence binds tighter than `&`, and `&` binds tighter than either choice operator. A weaker child requires parentheses. A nested `seq`, `choice`, `and`, or `ranked` retains parentheses when omitting them changes its stored nesting. Other unnecessary grouping is absent. Thus a choice argument prints `(a b | c)`, while a nested sequence prints `(a (b c))`.

A marked argument prints `= ` and its canonical expression. Print the operators with spaces around them. Keep the order of bag entries and list items.

For other term operators, the printer follows §9.2 binding and associativity. It adds parentheses exactly where removing them changes the normalized DOM. It prints no leading no-op operator. Pattern operators follow the binding rules in `docs/notation.md`, with the same grouping rule.

Pattern literals print `#` directly before a node test, constant, parameter, or bare child list. Other whole patterns print inside `#(…)`. A node's exact prefix prints `·` without a following space. Tests follow their terminal without spaces. A child list attaches without a space and always retains its brackets, including with one child.

A nonempty list prints `⁅ `, its items, and ` ⁆`. An empty list prints `⁅⁆`. Child items have one separating space. Optional brackets and braces have no internal padding. A separator prints as ` / `, and a sibling gap prints `⋯`.

Pattern tag requirements use the ordinary term printer, including when their spelling supplies an instance name.

Paths print as `⋮ P`, `⋱ P`, and `P ⋰`. If the operand is a compound pattern, the printer adds parentheses around it. A node test, constant, parameter, or bare child list takes no parentheses. Thus nested paths retain parentheses. A path over children prints `⁅ A B ⁆ ⋰`, with the list boundary intact.

Pattern union, intersection, and difference use spaces around their operators. Intersection operands that are unions or differences take parentheses. Union and intersection flatten their own kind. A difference's left operand takes no parentheses. If its right operand is a union or difference, that operand takes parentheses. Other parentheses follow binding strength.

If a union operand is a difference after the first operand, the printer adds parentheses around it. The first operand takes no extra parentheses. Thus `a ∪ b ∖ c` is the canonical spelling of `(a ∪ b) ∖ c`.

A choice uses ` | ` between alternative arrays. If a choice or set item shares its array with other items, the printer adds parentheses around it. A sole choice or set item takes no extra parentheses. These arrays include child lists, optionals, repeats, separators, and choice alternatives. Plain child groups flatten their sequences. No printer substitutes parentheses for a child list.

Tests follow their symbol without spaces. Method selectors follow their receiver without spaces. Methods use ` | ` for target choices and `, ` for other argument lists. A zero-argument selector has no parentheses. Call parentheses follow the same no-space adjacency rule.

Every accepted argument has a canonical spelling. Complex arguments never require a public name merely to obtain a spelling. Canonical names identify argument trees injectively. The ordinary reader accepts those spellings under the same Unicode tables and bindings. Canonical spellings require no names resource.

For every valid pattern P, `key(read(print(P))) = key(P)`. The key removes source positions and retains constants by name, decorations, boundaries, operator order, and duplicates. It does not identify patterns merely because they match the same trees. The requirement also applies to a pattern inside another argument or call.

A pattern name that reads back as a terminal under the loaded Unicode table is invalid. This restriction covers ordinary rule names, template-family names, and call names. It also applies to supplied and cached DOMs. A pattern `literal` contains a decoded string. User constants use `constant`.

Read-back inspection also descends through every argument and target inside a pattern call, including nested calls and body arguments. Each nominal rule reference must read back as a rule in its actual syntactic position. For example, a Unicode table can make `A` both a valid emoji name and a tag spelling. If `f(A)` reads that argument as a tag, its supplied `rule:A` argument is invalid. Even if the template ignores that argument, its category remains distinct.

The effective name appears in trees, display JSON, canonical JSON, `insertedBy`, warnings, expected lists, witnesses, diagrams, and audit records. Such names are strings and can contain emoji, punctuation, spaces, and quotes. Runtime nodes need no extra template field.

#### Source order

Template declarations and edits use parameter heads. `%redefine-rule f(@X)` replaces the template body. `%extend-rule f(@X)` appends alternatives with that statement's own clauses. Both require an earlier template with the same arity. Parameter names can change because binding is positional.

A closed call contains no parameter references. An instance-specific edit names its public name or its exact closed call. An edit by public name requires an earlier binding in the stage. Before that binding, a defined ordinary name still addresses its ordinary rule. A future binding cannot make an undefined earlier edit valid.

`%redefine-rule f(a)` replaces that instance's body. `%extend-rule f(a)` appends alternatives to that instance alone. The earlier template declaration is sufficient to create the addressed instance. A prior body call is unnecessary.

The loader applies template-wide and instance-specific events in source order for every instance. It replays earlier events even for an instance first discovered later. A later template redefinition replaces earlier local bodies, extensions and clauses. A later template extension reaches every instance, including one with an earlier local redefinition. A later local edit changes only its addressed instance.

For example, the later template redefinition removes the earlier local extension:

```jbogenbau
%rule slot(@Unit)
  @Unit
%rule named-slot = slot("a")
%extend-rule named-slot
  "b"
%redefine-rule slot(@Unit)
  @Unit "c"
%extend-rule named-slot
  "d"
%extend-rule slot(@Unit)
  "e"
```

The final named instance reads `"a" "c"`, `"d"`, or `"e"`. Another instance `slot("x")` reads `"x" "c"` or `"e"`.

A ranking step's pattern can name a template family, which matches the constituents of every instance (§6). It can also name one exact instance, by its call or its public name. A binding adds no node and no occurrence.

#### Patterns and exact targets

A bare template atom in a pattern matches every instance originating from that template, including named and locally redefined instances. It tests family identity through the ordinary unary pattern walk. It creates no instance and matches nothing when the template has no instance.

An exact call in a pattern identifies one instance. An instance referenced only by patterns receives the ordinary unreachable-rule note. Its public name identifies that same instance. Template-family membership remains internal metadata.

Recognition and neighbor targets accept ordinary rules, exact calls, named instances, and permitted user tags. A bare template name is a load error, including in a `parse` body and `.without-elision-except(F)`. An exact instance used as a close family follows §2.2 after expansion.

#### Finite expansion and errors

The loader constructs a directed parameter-flow graph before expansion. A node identifies one parameter position of one template. For every call in a template definition, each argument creates edges from every parameter that it contains to the callee's corresponding position.

An edge is unchanged when that argument is exactly the source parameter. Otherwise the edge grows. Nested calls, expressions, and lists count as wrapping forms. A parenthesized single parameter stays unchanged and adds no growth. Arguments with no parameter references create no edge. The loader includes calls at every depth and every definition, including replaced definitions and uncalled templates.

The search visits templates in declaration order, then parameter positions from left to right. Edges retain references to their source definition, call, and argument. Cycle search retains predecessor links and constructs the diagnostic trail only for an error.

A directed cycle with a growing edge causes `unbounded-instantiation`. The error names the cycle, growing wrapping form, and source locations. Unchanged recursive calls, permutations, and passing a nominal rule name remain valid. An arbitrary expansion-depth limit cannot replace this analysis.

```jbogenbau
%rule stable(@X, @Y)
  @X | stable(@Y, @X)

%rule growing(@X)
  growing(stable(@X, "a"))
```

The second declaration fails even when nothing calls it. The first declaration has only unchanged edges.

The loader first records declaration order, bindings, template signatures, and edits. It then resolves names, constants, and parameter binders and performs the flow analysis. It records only closed calls during instance discovery.

Flow inspection and substitution report the first error in source order. They visit declarations by source position. Within a rule, visit the statement term, then each alternative with its body and term. Conditions follow the alternatives, then messages and output items. An exact-instance edit visits its head arguments before its clauses.

The retained argument inspection uses this same order, including within each argument. It reports a condition's argument fault before an emission argument fault.

The source pass visits declarations in source order. Every binding visits its instance call, including a binding that a later rebinding replaces. An exact-instance edit visits its head call before its body. A template head declares parameters and creates no instance.

Within each retained definition, the pass uses the reference traversal of §2.2. It visits a call's arguments from left to right and finishes each argument before recording the enclosing call. Inner closed calls therefore precede outer closed calls.

Calls that still contain parameters wait for substitution.

The source pass records retained event indexes once for each owning history. Its per-declaration work does not search those histories again.

The source pass finishes before the loader reads the discovery queue. Each new instance adds its effective expanded definitions to this first-in, first-out queue. Each definition includes its body, bag terms, conditions, diagnostics, suppression and emission. The loader uses the same reference traversal and inner-first argument walk there. A repeated key adds nothing, including a recursive reference.

Every output event stream starts with its existing defining event. Expansion does not promote an edit into a definition.

For each instance, the loader replays applicable events and substitutes arguments using each event's parameter names. Replaced bodies and clauses receive per-instance document validation, but their calls create no live instance. Validation-only expansion uses separate keys and contributes no entry to the discovery queue or audit. It follows closed calls from every replaced ordinary definition and every substituted instance definition.

It inspects every applicable template event and follows nested calls until its queue is empty. Repeated validation keys add nothing, including unchanged recursive calls. A key already expanded as a live instance needs no second expansion. A binding or exact-instance edit head still identifies its subject independently of its body's lifetime.

Ordinary document rules apply to every expanded definition. The loader inspects each substituted definition before discovering its nested calls or rewriting calls into names. This order also applies to validation-only expansion. These definition errors precede errors from nested calls or rewriting. Structural analysis, ranked safety, capture analysis, depth limits, and lowering then use ordinary rules. Unused parameters and uncalled templates are audit notes, not errors.

The loader rewrites expanded validation definitions before inspecting retained arguments. Argument definitions that require separate inspection join the validation list afterward. Each expanded definition receives one rewrite. Live output reuses that rewritten definition.

Expanded-definition diagnostics use the effective rule name, including its canonical instance spelling or public binding. Internal validation does not substitute placeholder names for rule definitions. Capture and test bases use the same effective-name predicate as other rule references.

An error at a parameter use names the template definition and the originating call and argument. An argument error names that argument. Source locations stay separate from the position-free key. A wrong arity, unknown template, duplicate parameter, or undeclared parameter is a load error. Binder and flow errors also apply to uncalled templates. Kind-dependent errors require an instance.

The audit determines each event's scope from the template's recorded event indexes. It indexes expanded rule positions before sorting instances.

The audit lists templates, instance keys, effective names, first calls, bindings, unused parameters, and uncalled templates. It records all applicable template and local events in source order, including events later replaced. Rule and instance lists use the expanded order defined below. Template order follows declaration order. The audit also notes argument-alias twins, as `docs/design.md` defines them.

#### Expanded rule order

An ordinary rule receives a declaration slot at its first definition. A binding receives a slot at its name's first declaration. Redefining an ordinary rule as a named instance retains that rule's slot. Rebinding a named instance retains its name's slot and puts the new key there.

The expanded grammar first lists ordinary rules and named instances in declaration-slot order. It then appends all unnamed instances in first-discovery order. An instance that loses its public name joins this unnamed tail at its original discovery position. If nothing else references that instance, it receives the ordinary unreachable-rule note. An already discovered instance that receives a public name uses the name's slot instead. No instance occupies two positions.

Production numbering, reference checks, rule traversal for diagnostics, and the audit use this expanded order. Expected entries still sort their `rules` by code point. Template declarations have no runtime rule slot. Within a rule, alternatives and applicable edits retain their existing order.

## 3. Lowering

This section writes productions as `lhs → symbols`. This is not jbogenbau, the notation of gencmu grammars (`docs/notation.md`), but the context-free grammar that a jbogenbau grammar is lowered to.

Lowering builds the productions that recognition runs. Specialize constants, suppliers, shapes, masks and proofs before recognition. Use enabled features, the input interface, Unicode resources and constant versions for cache identity. Cache failures under the same conditions as successes.

A lowering failure gives a `grammar` result with the affected stage. Its message gives the source document and position of the failed operation. An invalid early dependency reports the reader and the dependency path.

An item of braces that can match no tokens (§3.3) follows the chain errors and precedes the cycle error of a comparison. Lowering decides nullability after it lowers all rules. It examines the surviving rules and their alternatives in order, and reports the first alternative that holds an empty item. The error names only the definition, so which empty item of that alternative it meets first is not observable.

The cycle error of a comparison of two constituents (§9.3) comes last, after an empty brace item. So its walk can rely on the braces rule. Lowering visits the surviving comparisons in this order:

- It takes the rules in the order of §3.9.
- For each rule, it takes the definitions that remain after stitching, in stitching order.
- Inspect the entries that recognition demands in the statement term and each alternative term. Then inspect each condition in written order. Inspect expression operands from left to right.

The walk skips late bag entries, diagnostic messages and emission items because recognition does not demand their comparisons (§4.1). Lowering reports the first comparison whose demand graph holds a cycle of marked edges. From that comparison, the walk follows productions in number order and their symbols in written order, depth first. The reported cycle is the first one that this walk closes, listed from the first rule of the cycle that the walk reached.

This error stands at the comparison, not at a definition. Its message begins with the document, the line and the column of the first token of the comparison.

Lowering reports a chain beside another alternative before an empty brace item, whichever rules contain them. This order is the model of the diagnostic, not of the work. An implementation can meet the braces in another order internally, as long as it reports the same error.

### 3.1 Feature gates

Lowering drops an alternative whose gates do not all hold. With feature `f` on, `f?` holds. With it off, `¬f?` holds. Warning controls never drop alternatives (§12).

Lowered productions retain their message expressions and suppression lists (§3.6). Reporting selects enabled unsuppressed warnings from the chosen derivation. Changing warning controls alone reuses the same lowered grammar.

### 3.2 Expression expansion

The reader and DOM validation enforce expression shape, terminal types, range endpoints, and elidable heads before lowering. Lowering relies on these guarantees.

Lowering expands each remaining alternative into sequences of symbols. `(a | b)` expands to both, in written order. A plain optional `[x]` with a capture outside nested ranked groups expands in place as `(ε | x)` does (§3.5).

It expands first to the empty sequence, then to each expansion of `x`, in order. It has no helper.

A plain optional whose captures occur only inside ranked groups uses a separate helper for each route. The absent route has an empty helper. Each present route has a helper for its expansion of `x`. These helpers preserve the optional as one [logical symbol](notation.md#ambiguity). Any other `[x]`, plain or elidable (§3.8), is a helper `h → ε | x`.

The engine names the helpers, and it never shows their names. A helper is a production whose left side is a helper name.

An elidable optional `[+T x]` is always a helper `h → ε | T x`. The captured form `[$j:+T]` keeps `h → ε | $j:T`. Its enclosing expansions pair with the empty and written helper routes. Only the written route binds `$j`, including in reconstruction (§7.4).

Flat braces are a helper too. `{x}` is `h → x | h x`, and `{x / s}` is `h → x | h s x`. So `[{x}]` is a helper `o → ε | h` around the helper `h` of `{x}`. Lowering expands `x` and `s` in place in these productions, as anywhere in an alternative. So a sequence or a choice there needs no helper of its own.

A capture inside `x` or `s` supplies bindings from the corresponding helper advances. The helper can retain a frame of outer observations (§4).

`A₁ & … & Aₙ` has at most 16 items. More is an error of the document (§9), since the expansions number 2ⁿ−1. It expands to every non-empty subsequence that keeps their order. The subsequences come in the order of the binary numbers 1 to 2ⁿ−1, with `A₁` as the lowest bit. `ε` is the empty sequence. A sequence's expansions are the products of its items' expansions, the first item varying slowest.

So `A [$b:B] [$c:C]` expands to `A`, `A C`, `A B` and `A B C`, in that order. `A [B] [$c:C]` expands to `A h` and `A h C`, which share one helper `h → ε | B`. A plain optional that holds a capture, whose content has k expansions, contributes 1 + k expansions: the empty one, then those k. A sequence multiplies these counts, as for a choice. So `[$b:B]` doubles the expansions of its alternative, and `[($a:A | B | C)]` contributes four. The nested `[A [$b:B]]` contributes three: `ε`, `A` and `A B`.

Physical expansion binds captures to the enclosing production. Every plain optional keeps its logical helper for ranking transparency and query priority.

A rule whose whole body is optional receives no implicit bag from that optional.

Expansion preserves actual selected children and omission records. It creates no optional node in the accepted output tree. Named-rule cycle exclusion uses actual rule occurrences over spans. A logical helper never adds a named-rule cycle.

A tested symbol expands to that one symbol, which carries the test. It adds no helper. So the numbering, the transparent closes of §6 and the constituents of a production are those of the symbol without its test. Two productions that differ only in the test of a symbol are two productions.

### 3.3 Chains

A chain is an alternative whose whole expression is `{... x / s}`, a left chain, or `{x ... / s}`, a right chain. Either can leave out `/ s`. The reader makes sure that a chain is the whole expression of its alternative (§9). A chain must also be the only alternative of its rule left after §3.1. Another alternative beside it is an error of the grammar.

Lowering turns the chain into recursion on the rule itself, with no helper for the braces. Here `r →` introduces a lowered production. `{... x / s}` becomes `r → x | r s x`, and `{x ... / s}` becomes `r → x | x s r`. Without a separator, `s` is left out of these productions. Lowering expands `x` and `s` in place, as in §3.2.

Every level of a chain is then a constituent of `r`. The ranking sees its closes (§6), and the clauses of the alternative attach to its base productions and to its recursive productions alike (§3.6). Each level receives the rule term and stage defaults under §3.7. Lowering a chain does not turn a level into a sole-symbol copy.

An item of braces, flat or chain, that can derive the empty sequence is an error of the grammar. Lowering decides this over the structural grammar of the enabled features. That is every production that §3.1 to §3.5 make from the stitched stage, helpers included. Clause attachment (§3.6) does not yet remove any production whose condition simplifies to false. Tests are ignored. So a production that a false condition removes still counts, and so does a production that a test can never pass.

Logical optional markers consume no symbols and name no rules in this structural grammar.

When one sequence continues along one route, lowering extends its owned physical and logical prefixes in place. Branches receive independent prefixes before either branch extends them.

A rule that `text` cannot reach counts too, and lowering makes sure that all remaining braces meet these rules, reachable or not. An alternative that a gate drops, and a definition that a later `%redefine-rule` replaces, do not count. An alternative that an `%extend-rule` adds counts like any other. Every implementation decides nullability in this phase, whatever order it builds its productions in.

A separator can derive the empty sequence. So a list or a chain never has a derivation that repeats an empty item, and `[{x}]` derives the empty sequence in exactly one way.

For feature sets that cause either error of this subsection, lowering reports that error. It reports each one at the definition that wrote the alternative, as for any error of lowering. The order is the one that the start of this section gives. A gate or a `%extend-rule` can make either error depend on the features, and a warning control never removes an alternative. Lowering finds the cycle error of a comparison of two constituents in the same way (§9.3).

A flat list is one helper, so its closes are transparent (§6), and the clauses of its rule apply only to the rule's whole constituent. Some grammars need each prefix of a list as a constituent, which the ranking and the rule's conditions see. Such a grammar writes a chain or explicit recursion.

### 3.4 Ranked expressions

A ranked expression lowers to one transparent helper with ordered options. Every expansion retains its option index and written expression identity. An invocation is a recognition state of one named rule, as §6.1 defines it. Its entry retains the enclosing named invocation and complete prefix state.

Conditions keep the named scope for `$`, `.onward`, `.preceding-tokens`, and `.following-tokens`. Private bindings leave the continuation environment after ready gates. Proofs keep them for late expressions in scope. Diagnostic messages cannot read them.

Number ranked options in source order before later siblings. No ranked helper is a named rule, so no step counts its close (§6). Ordinary parentheses keep their expansion behavior.

### 3.5 Captures

A capture `$x:s` must wrap a single symbol `s`, which can be tested. It can stand anywhere in the expression of an alternative, at any depth. That includes a group, a choice, an item of `&` and a plain optional. It cannot stand directly in a chain's item or separator. Flat braces inside a chain can bind lists. Inside an elidable optional, only the capture of its sole terminator is legal (§3.8, §9).

Infer the type of a slot from the routes of its alternative. One binding on each route gives a node. A possibly absent slot gives a list of zero or one. A repetition gives a flat list in input order.

A name cannot bind twice on one route. Mutually exclusive branches can fill the same slot. For example, `A ($x:B | $x:C)` is valid. `[$x:A] $x:B` and `$x:A & $x:B` can bind it twice and fail.

Keep bindings across helper expansion on the corresponding proof edges. This keeps the original input order and the bindings that each proof can use. Bare `$` denotes the enclosing occurrence.

### 3.6 Clauses

A shared condition applies to alternatives that declare all captures left after simplifying known guards and presence tests. Test both bare capture truth and `.present` against the same scope. A name declared only on another alternative gives false in those presence tests. An unknown name is an error.

One guaranteed binding yields one node. Optional and repeated bindings yield ordered lists. A condition can reduce the list when its required observations are ready. A direct universal test can prune at the first failing item. A direct existential test can settle at the first successful item.

An existential failure can reject only after the list ends. Retain outer bindings and correlated frames.

A statement term evaluates its whole guard separately for each alternative. Any entry operand that reads a capture needs its binding on every route that reaches the operand. The term of one alternative cannot name a capture from another alternative.

### 3.7 Ordered bags and demand

Each key has three states: absent, present bare, or present with a payload. Case controls visibility. A capitalized key with a payload can satisfy a terminal without evaluating that payload. A lowercase key can be bare. A key set is a bag of bare entries.

The views `.keys`, `.flags` and `.classes` return key sets. Their membership queries demand no payload. Selection copies each matching entry with its payload state. A valued mask is a type error.

Build a nonerased rule’s working bag from these entries in order.

1. If the stage defines the unary defaults function, splat `$DEFAULTS($)`.
2. Splat the primary’s whole bag. In an eligible unmarked alternative, use the sole symbol’s bag.
3. Apply the statement term.
4. Apply the alternative term.

The constructor can evaluate a spread bag without a temporary copy. Every later writer replaces the previous writer of that key. A false guard skips the entry. A copy from an absent source writes nothing. A successful deletion removes any previous writer.

A later splat can restore the deleted key. A chain writes the same evaluated payload under each distinct key. Reject a repeated key in that chain. Reject duplicate direct unguarded writes within a written constructor. A deletion is an edit.

It is legal after a direct write. The separately written statement and alternative terms reject their own duplicate writes. Thus an alternative term can override its statement term.

Track presence, bare or valued state, and payload as separate demands. For one requested key, consider candidate writers from last to first. Gates and expression guards both condition a write for duplicate detection. Evaluate only gates, guards and presence information necessary to locate its effective writer. A taken deletion answers absent immediately.

Force the winning payload only for a reader that needs it. Propagate the same observation through splats, joins of shapes and calls, including a call of the preceding defaults function. Preserve left-to-right evaluation inside each reached expression. Visit demanded keys in Unicode scalar name order for whole-bag materialization. Memoize shared right-hand sides once per occurrence.

A hidden writer raises no error and makes no verbatim claim. An entry gate or evaluated guard can itself affect the result.

For example, an explicit quote image hides the default child-image join. Deleting that image in an alternative term must not force either earlier writer. Check all written forms for bad syntax, scope and types regardless of runtime demand. Within a rule, bare `$` denotes its occurrence. A constructor cannot read its own unfinished bag, directly or through a function.

Its children and input span remain available. Conditions and messages can read the completed working bag.

A primary must bind one mandatory child on every route with a primary. An alternative has either one primary on every route or none. Reject a primary inside a ranked option, optional, repetition or chain. Reject a primary before a splice. A plain mandatory symbol can supply the implicit bag even without a primary mark.

An unranked inline choice requires one such symbol on each route to qualify. Neither the statement nor the alternative can have a term. A mandatory spliced call qualifies for bag copying. Optional, repeated, chained and ranked bodies do not qualify merely because they occupy one logical slot. The implicit copy never adds a presentation edge.

A repetition's leaves keep their own bags.

An erased rule supplies empty strings for value and image. It runs no defaults function and selects no output. Its other effective entries remain observable. Apply the stage defaults to named rule occurrences, chain levels and query-built rules under that stage’s demand. Leaves, braced items and insertions never call it.

The bundled pass-through and tree-only stages omit the defaults function. The Lojban phoneme, forms and words bases define both child joins. So do the Eberban letters and forms bases and the notation lexical base.

A working node can omit `value` or `image`. Each effective entry under either name on a node must carry a string. This includes leaves, braced items and insertions. Published tokens require both.

In ordinary data, infer entries with these names like any other key. For example, `{value:["a","b"]}` is legal classifier data, and its result can contain bare `value`. Reject a splat that leaves that bare entry as a node’s effective string. Nested data bags and masks do not inherit node string requirements.

#### Key provenance

A public mask conveys names, never evidence for an engine membership. A stored reserved entry requires provenance from an actual input membership or a derived observation carrying that evidence. Check this through aliases, constant versions, functions, copies, selection, splats and primary or sole-symbol inheritance. A mask can name a supported engine key for selection. A deletion can remove that key.

Neither operation writes a stored membership. Reject a path that installs a reserved name from permission alone. Equal key sets can carry different source evidence. For example, a `$OUTPUTS` splat of `$INPUTS` can permit the Unicode inventory. It cannot tag an ordinary letter with every membership.

#### Neighbor guards

A neighbor guard in a rule term uses one boundary atom on `$`, with optional negation. It guards a visible bare entry or a splat of a closed visible key set. Combine statement and alternative terms in their normal order. Normalize atoms by target set and direction. Negation shares the same Boolean assignment.

Retain the link between each variant and its obligations. Prune covered contradictory assignments and merge equivalent bags with equal obligations. More than eight variants per effective production receive an audit note. More than sixteen cause a load error.

### 3.8 Elidable optionals

The forms `[+T x]` and `[$j:+T]` define elidable optionals. No other optional is elidable. After template substitution, T is one user tag and can carry the head's existing symbol tests. The head is that tag or a parameter, directly after `+`. In the captured form, the capture binder precedes `+` inside the brackets. No group can surround the head or the complete content.

Lowering unwraps every supported test to find the head terminal. It retains the complete combined predicate for written and omitted forms.

`x` is a sequence of any primaries, possibly empty, and holds no capture at any depth. The captured form has no rest and captures only its terminator. Its tests and default follow T, as in `[$j:+JI="jie"]`. The reader makes sure of this form (§9).

A plain optional `[x]` is never elidable, whatever its content, also where it begins with a terminal that another optional marks. So `[KU]`, `[KU | VAU]` and `[{KU}]` are ordinary optionals, and the `[+KU]` of `{[+KU] A}` is elidable.

The `elision-only` check (§7) reads this same lowered grammar in a mode of its own. In that mode, an elidable optional is restored or written, and never empty (§7.4). A tested elidable terminal keeps its test there.

Every well-typed test on the elidable terminal is legal. The omission predicate determines whether its empty production can succeed. The marker is part of the optional's text, so no later item of the stage can change whether an optional is elidable. A test on a later symbol of the optional is no error, since §7 restores only the terminal.

Lowering records whether each helper represents an elidable optional. For an elidable helper, it also records the terminal `T`, its test and the optional's owner (§2.2). The rest of this document says "elidable optional" of these helpers.

Resolve the default from the explicit `≝` operand, then from the equality operand, then the empty string. Both terminal value tests and omitted leaf property reads observe that default.

Before predicting an empty elidable production, the recognizer requires its omission predicate to hold. The predicate uses value d, terminal key T and omitted origin for the head tests. Without a test, it is true. A default whose predicate is false is a document error at its `≝` (§9.3). This condition applies in main recognition, nested queries and reconstruction.

A false predicate creates no omitted node, elision count or restoration record. Without `≝`, it causes no declaration error or warning. Written productions remain available.

### 3.9 Numbering

Lowering retains each surviving alternative's original index from the stitched rule. Helpers index their pending productions once. Later passes visit that index instead of searching every production again.

Lowering numbers the productions from 0. The canonical order *T* of §6 uses this numbering. *T* orders the ambiguity diagnostics. The canonical tie-break keys never turn a tie into an accepted reading.

A production that a condition false for it removes (§3.6) takes no number, though the helpers of its alternative still do. Only ranked helpers reachable through that production defer conditions on their private captures. Other private captures are absent.

Lowering takes the expanded rules in the order of §2.3. Ordinary rules and named instances retain declaration slots, followed by unnamed instances in discovery order. Alternatives added with `%extend-rule` follow the rule's own alternatives.

Within a rule, lowering takes its remaining alternatives in order. Each alternative contributes its own productions first, and then its helpers. Its own productions come in the order of its expansions (§3.2). For a chain, the base productions come first, one for each expansion of `x`. The recursive ones follow, one for each expansion of the sequence that the recursion adds, in the order of §3.2. That sequence is `s x` in a left chain and `x s` in a right chain.

Except for optional routes (§3.2), an alternative has one helper for each helper place. These places are written `[ ]`, ranked groups, or flat `{ }`. They come in the order in which those places are written, left to right. The engine expands a plain optional with a capture outside ranked groups in place (§3.2). That optional has no helper and no place of its own. The places written inside it keep their order among the others.

So the expansions of such an optional are productions of the rule itself, numbered in the order of §3.2. The canonical order *T* of §6 compares them by those numbers.

A helper's nested helpers follow its productions at once, depth first. They precede the alternative's next helper. Each optional route helper precedes its nested ranked helper. Shared nested helpers receive numbers once, at their first route. A helper of flat braces has its base productions first and then its recursive ones, as a chain does. The places inside `x` come before those inside `s`, since `x` is written first.

The braces of a chain (§3.3) have no helper: they are lowered into the rule's own productions. But the `[ ]` and flat `{ }` inside its item and its separator have helpers, as anywhere else.

Every expansion of the alternative that goes through a helper's place shares that helper. So an item of `&`, or a place inside the item or the separator of braces, has one helper however many expansions use it.

### 3.10 Query helpers

For each distinct user tag that a query names as a target, in any mode, stage lowering creates one query helper. Every occurrence of that terminal target shares the helper. Its single production reads one token through that terminal. The helper has no symbol tests, conditions, or written clauses. Its eligible roots expose the leaf's bag.

Query helpers follow every production from the written grammar, including its helpers, in tag-name order. Other anonymous query targets follow the terminal helpers in first written-use order. No body can name a query helper. Query helpers appear in no grammar DOM, written-grammar analysis, output tree, or audit.

`parse(C)` lowers its capture-free constituent to an anonymous query target. Its identity is structural, keyed by the lowered constituent after substitution and reference resolution. Grouping, source positions, and the remainder mark do not distinguish targets. The memo retains the query mode separately.

An undecorated rule call reuses that rule's query target. An undecorated user-tag terminal reuses its helper, including a tag that only `parse` names. Every other constituent uses a structurally keyed anonymous target that retains its tests and decorations. This includes literals, ranges, wildcards, engine tags, and tested symbols.

Thus `parse(x)` and `parse(x …)` share their target and their recursive-query test. Lowering fixes only identity and target. Recognition uses the same whole, prefix, suffix, or part machinery as the query of that mode. An anonymous target's diagnostic name is its canonical constituent spelling, without remainder. A single nominal target keeps its public name.

### 3.11 Spliced calls

`*r` lowers to one call of r with a transparent occurrence marker. It never copies r's expression into its caller. The call keeps every target clause, including emission, erasure, diagnostic, and suppression. Its logical slot exposes the call's working bag.

Recognition retains the target rule identity for cycle exclusion. A spliced and an ordinary call share the same rule-and-span cycle key. Structural display flattens the splice. Output tables keep its call record. Patterns and tree identities use its anonymous exported view (§4.1).

Action comparison ignores its close, regardless of its symbol count. Rejection expectations retain the called definition as their owner.

A splice capture keeps the called node, its bag, span and working children. It is present even over an empty span. Structural patterns see the anonymous sequence. A structural equality operand cannot be a splice capture, including through a list or function binding.

If a stage ranking pattern, other pattern, or neighbor target names its rule, the loader rejects that splice. It resolves pattern constants, choices, template families, and exact instance keys for this inspection. Query targets do not prohibit splicing. A splice cannot supply a stage root or occur in a pattern.

## 4. Recognition

The parser is an Earley recognizer, a parser for any context-free grammar, over the lowered grammar. The set of items that it produces specifies it, and any algorithm that produces that set is correct. The recognizer builds one set of items for each position in the input.

An item has a production, dot position and origin. It retains its structural state, restoration state and demanded observations. Each capture before the dot retains its place and the observations that its consumers can distinguish. Items can merge where those fields agree. Their proof edges stay distinct.

Every eligibility and witness reconstruction method must produce the same eligible derivations and the same witness. Recorded advances and rebuilt links must satisfy this requirement.

Duplicate detection uses an index after any fixed-size initial scan. Distinct recorded advances retain their first insertion order. Witness reconstruction indexes each needed chart set at most once for seed and restoration lookup. The index retains all observation and lexical states.

Fix the production, dot, origin, input position and structural state. A capture can still split items by its span and other demanded observations.

For example, in `%rule t $l:t $r:t | A`, the end of the first capture can vary. With N tokens, one unfixed endpoint can take up to N + 1 positions. Key demands, structural states and restoration observations can distinguish further items.

A known endpoint can fix a capture's span. It does not prove that the node has a unique bag. A live reader can distinguish ambiguous summaries or correlated bindings even at one fixed span. A resource limit stops with an exhaustion error and no partial publication.

A memo stores answers for reuse. Its key includes the query mode, resolved target, input span or content, demanded observations, and relevant outer bindings. Aligned queries also retain their restoration constraints. Capture names alone cannot identify answers.

A tag terminal `T` matches a token with that stored tag. A string terminal matches an ordinary token with exactly its value. A range matches an ordinary token whose value is one scalar within its resolved endpoints. `_` matches every ordinary token once.

Only a tag terminal can read a synthetic terminator, through that terminator's own tag. A value terminal, range, or wildcard never reads one. Empty-valued ordinary tokens remain consumable. Terminal identities and canonical diagnostic spellings follow §9.

Prediction lookahead and scanning apply the same restriction on synthetic tokens.

A tested symbol (§2) matches when its symbol and tests match. A terminal test reads the bound leaf's visible keys, origin and value. A reference filter reads the completed occurrence's visible keys. A reference value test reads its certified value.

`X="s"` compares the symbol's value exactly. `X≠"s"` negates that equality. `X<A ¬B>` requires A and forbids B on the symbol's own tags. Constant requirements expand with the same sign.

A value test on a terminal reads the bound leaf, even at an empty place. An omitted leaf uses its resolved default. A rule test requires the input-join proof for the active mode. An empty key mask always passes. Each stage-zero token has its decomposed scalar as both value and image.

When an item reads a tested symbol, the recognizer produces the advanced item only if every test holds. This holds over a token, for a terminal, and over a completed item, for a reference. It includes an advance over a constituent that completed empty at the item's position. Two completed items over one span can have different tag sets. So a tag test can let an item advance over one of them and not over the other.

The recognizer applies the test before any condition that the advance makes ready. The paragraphs below say when a condition is ready, and they give the order of one step in full. If the test fails, the recognizer evaluates none of the conditions that the advance makes ready. The order is observable, because a condition can end the parse with an error of the grammar.

The test does not stop the conditions that run earlier. These are the conditions inside the referenced rule, which run before that rule completes. They are also the conditions of the advancing item's own production that run when the recognizer predicts that item.

The test is not part of the terminal's identity. A tested terminal `T="s"` is the terminal `T` for the actions of §6. It is also `T` in the tree's token nodes (§12) and in the witness. The test only removes matches.

A partial or complete chart item carries the observations that reachable early readers can distinguish. Keep the route, correlated captures, frame, obligations and structural observations on their item or proof edge. Compute possible demands by rule, mode and dot position. A publication mask creates no recognition demand.

A possible reader does not force an observation. A port can retain a deferred value or failure with its location. Looking up a chart key never reports a dormant failure. Only the active reader that reaches it reports it. Cold and warm caches must agree.

Evaluate a condition at its first ready step. A bound node is true even at zero width. A shared term or condition sees false for a presence test of a capture declared only on another alternative. A span uses only its original input window for truth. A bag truth test demands presence alone. A forest truth test demands eligibility alone. [Expression truth rules](notation.md#expressions) list all conversions.

Keep bindings from the same proof together. Two advances with pairs (A,B) and (B,A) cannot supply a witness for (A,A). Assign public occurrence IDs during materialization of a selected or displayed reading.

An outer capture stays out of the helper frame unless a condition in the repetition needs its observation. Items of a contextual helper carry their frame, and two merge only when their frames agree. A completed item of a contextual helper advances only the enclosing items whose frame it carries. The recursive production of the helper, which reads the helper itself, keeps the frame of its entry.

A direct predicate on a repeated capture can run when its item and required outer bindings are ready. Until then, keep their observations on the same proof. A reached map still evaluates every demanded item before a later reduction.

The recognizer evaluates a condition that uses no capture when it predicts the item. It does the same with a condition that uses only `$` in a production with no symbols, over the empty span there. So a rule whose only production has no symbols and the condition `$.starts-input` completes only at the start of the input. Anywhere else, the recognizer never advances an alternative that begins with that rule, and that alternative predicts nothing after the rule.

A step of the recognizer is an advance of one item, or the prediction of one production at one position. Each step evaluates its parts in this order, and it stops at the first part that drops the item:

1. In the check of §7, the step drops an additional item that is strict and stands at the end of its production (§7.4).
2. The test of the symbol that the step advances over, where that symbol has one.
3. The conditions that the step makes ready, in their written order. A condition on captures and a condition on `$` that become ready at one advance keep that order. Each one stops early as §10 says. The first that fails drops the item.
4. Boundary obligations for the step (§4.2). Evaluate required trials in the established condition order.

Early property readers request only the needed bag observation. A completed item does not force other keys. Preserve distinct demanded answers, including dormant failures, across packed advances.

A live dependency cycle on one occurrence is an error. Analyze recursion through calls whose other symbols can consume no input. A cyclic component can use unchanged copies, selection, proven input functions and proven finite domains. Expanding strings, lists or nested bags need such a proof. A bound on list item size alone does not bound length. Exclude statically hidden suppliers before analyzing dependencies.

### Proof for a rule value

A rule value test, a rule-pattern value test and any recognition dependency on a rule's `'value` require the following conservative certificate. It proves equality to the ordered join of the values in the input window. A port cannot admit another grammar by guessing that its alternatives never overlap. Check the effective suppliers after gates, template substitution, function expansion and removal of hidden writers. The certificate covers only `value` because frequent value tests can use the input join without another chart dimension.

Each other key read during recognition remains an observation on the item, with its associated cost. A late-only read needs no certificate.

Start with every active rule in the candidate set. Treat each recursive rule call as certified while its target remains in the set. Remove any rule with an active alternative that fails the clauses below. Repeat until the set stops changing. This computes the greatest fixed point of a monotone test on a finite set.

A reverse dependency worklist can propagate removals. Unproductive cycles prove nothing about the existence of a parse. Soundness on every finite derivation follows by induction on its height.

- A written input leaf supplies its stored value. A direct terminal test reads that value. A direct omission test reads the resolved default. An omitted leaf contributes no original input token. Within a child join it qualifies only with a provably empty default.
- An explicit join of all token values in the input window passes. The expression is `$.span.tokens!'value.join()` or its expanded equivalent. An empty separator is required.
- A certified child join requires one complete ordered partition of the input window on every route. Each contributing child must pass the leaf or rule test. Include separators, optional routes, the working splice call and every chain level. Flattening a splice for pattern matching cannot bypass its value writer. A grouping helper contributes precisely its visible sequence.
- An unchanged primary, sole symbol or copy requires one certified child covering the whole input window. Other slots must contribute no original input tokens. A fixed empty contribution passes only with a provably empty input contribution. Use structural nullability for possible emptiness and absence of any consuming route for guaranteed emptiness.
- Normalize aliases, parameter names, inlined functions and constant empty concatenations. All possible winning writers must meet one of these forms. Missing strings, changed spelling, reordering, duplication, skipped consuming children and nonempty separators fail. An unresolved guard requires a certificate for every possible resulting writer. Skipping a guard must also preserve errors. For this proof, accept folded gates, literal truth values and Boolean combinations of total input-token membership tests. Reject other unresolved guards on the winning path. Hidden guards require no test.

A consuming erased child with value `""` fails. A primary between two consuming punctuation tokens fails even with an unchanged child value. A nonempty synthetic default also breaks a child-join proof. Analyze reconstruction modes separately. Do not allow a bare synthetic read with a nonempty default to masquerade as an original input leaf.

Use the admissible read routes for that mode and head predicate. An explicit input join works independently of synthetic defaults. Direct reads of a bound terminal still observe its actual leaf value.

At each early use, report a load or lowering error at the first failing test or read. Show the rule and the first uncertified supplier in stitched order. For a certified rule, compare the joined input directly at the endpoints of its input window. No string payload enters a chart key for that comparison. This is an implementation of the grammar’s property test.

It creates no second value. A digit rule mapping “0” to “ti” can publish that spelling. Its input join is “0”, so its rule expression fails this certificate. A terminal in the next stage can test its stored “ti”.

Other early properties require ready operands and a finite proof of termination. Track their actual demanded observations. A fixed-length slot identifies its span only with a known endpoint. It does not prove its computed bag unique. Ambiguity can still multiply bounded summaries and correlated captures.

Retain every distinction that a live reader can observe. A resource limit reports exhaustion without publishing a partial stream.

Each terminal target reads exactly one original token carrying its tag. Whole, prefix, suffix, and part terminal queries use a helper (§3.10). A rule target runs a nested parse of that rule.

Queries in every mode run nested recognition for a rule target. Suffix recognition follows §4.4. For an ordinary span, a nested parse recognizes only its tokens, with `rule` as the start rule, over the same lowered grammar. It applies tests and conditions as the main parse does. Whole, prefix, suffix, and part recognition of a terminal starts from its query helper (§3.10). For those queries, `rule` below names that helper.

`view.parse(C)` returns the forest of eligible witnesses of C over that view. C is any body constituent except a chain (§9). No part of its argument syntax can bind a capture. Called rules can retain their own captures.

The mark `…` denotes unread remainder at an outer edge of C. It can stand at one edge or at both edges. It cannot stand alone, inside a nested constituent, or between constituents. An explicit `ε` permits an empty target.

Without the mark, the query covers the whole view. A final mark selects prefix mode, and an initial mark selects suffix mode. Both marks select part mode, where some part of the view is a witness. So `parse(… x …)` holds where an `x` witness stands anywhere in the view. The remainder never becomes a witness part.

Alignment, tags, and error filtering observe only the witness. A `parse` with an initial mark on a restored view is a document error. A final mark alone raises no such error (§4.4).

A nonempty forest holds in a truth position. `.error-free` keeps proofs with measure (0,0,0), including counted carried reports. Repeated filtering has the same effect as one filter.

### Forests and deterministic errors

A parse query returns one forest of eligible finite proofs. It performs no emission or message evaluation. A forest always exposes recognition observations, even to a late caller. Its root predicate cannot read private winners, output fields requiring publication, or verbatim text on query occurrences. Each predicate invocation binds one root and keeps its outer values. Its ordinary Boolean operators short-circuit inside that root.

Order eligible roots by the start and end of their input windows, then by written target ordinal. Then compare complete physical action sequences lexicographically, including transparent closes. A read precedes a close. Compare reads by terminal name in scalar order, then by physical token index. Compare closes by expanded production number, physical start and physical end.

For equal prefixes, the shorter sequence comes first. This uses the canonical action keys of §6 without computing ranking profiles. This order chooses an error and never filters eligible proofs by rank. Proofs with identical keys and action sequences have the same bindings and predicate outcome in the same outer context.

Evaluate every eligible root of a predicate, even after a decisive truth value. If any predicate fails, return the first failing root’s first reached error in this order. Otherwise return the existential or universal result. Empty forests give false for `.any` and true for `.all`. Predicate-free `.any()` tests eligibility without demanding any payload.

A forest in a truth position requests the same existence observation. The error-free filter retains eligible roots of zero blame. A flags aggregate unions root presences, never payloads across distinct proofs.

Ports can group roots with identical demanded observations, errors and outer bindings. Preserve each group’s least canonical root for error selection. Do not rely on chart insertion or hash iteration order. Two roots can fail different computed delimiters while a third gives true. Include input observations, outer observations, gate outcomes, query kinds and alignment constraints in the applicable memo key.

A proof tree of an item shows how the rules of recognition justify the item from the chart. A predicted item, with its dot at the start, is a leaf. An advance of an item over a token or over a completed item is a node. Its children are a proof tree of the item before the advance and, for a completion, a proof tree of the completed item. Each advance follows the rules of this section, with its tests and conditions satisfied.

An eligible query proof tree has no unerased error production of its own and no forbidden omission (below). A carried error never bars an ordinary query witness. Queries ask whether a structure exists, and a faulty token retains its ordinary class and value. An erased subtree contributes no live errors, including the witness's own error occurrences there. Queries evaluate no diagnostic message. Main recognition applies no query filter, and reconstruction follows §7.4.

The `.error-free` filter additionally requires zero carried measure outside erased witness subtrees. Eligibility and this filter concern the same proof, rather than independent proofs that happen to share an item. Both use the erasure composition of §6. Raw chart items remain available regardless of either answer.

An ordinary query that the check of §7 starts reads the projected span in the stage's input. It uses this lowered grammar in its ordinary mode (§7.6). Its chart is every item, partial or completed, that this recognition holds after it ends. The query methods, including `parse` and aligned forms, read eligible proof trees before ranked admission (§6.1) or ranking. Their structural observations still use the sealed leaves of §4.1:

- Whole mode holds when a completed item of `rule` spans the tokens and has an eligible proof tree.
- Prefix mode holds when a completed item of `rule` has its origin at the span's start, in any set, and has an eligible proof tree. So it covers a prefix of the span, the empty prefix included.
- Suffix mode holds for an eligible completion ending at the window end from any start within it (§4.4).
- Part mode holds when a completed item of `rule` stands anywhere in the span and has an eligible proof tree.
- `.flags` unions the visible key presences of eligible roots.

A proof tree is finite, and it does not depend on the order in which the recognizer finds items. In an ordinary query without restoration constraints, a rule can occur again over the same span within its proof tree. This differs on purpose from the derivations that a stage counts and ranks (below, and §6), which exclude such a repetition. An item with no finite proof tree from predicted items has none, so a cycle alone gives none.

An implementation can rebuild the advances from completed spans, as it can for a stage's derivations (below). Such a rebuilding keeps the captures, and it applies the symbol tests again to the actual candidate. It never evaluates a condition again.

Several eligible proof trees are an ordinary success. A query never ranks its proof trees, and it never has a tie or an ambiguity error. The witness of a tie (§6) is a different thing, and a query has none.

A nested parse follows written-terminator priority. In plain words, a nested reading cannot leave out an elidable optional where the same construct can read that whole optional as written. An omission is an advance of an item over the empty helper of an elidable optional (§3.8), at its position `p`.

Whether an omission is forbidden depends on the production prefix that the proof tree holds fixed, as follows:

- Where the preceding logical symbol is a nonterminal `Y`, the fixed prefix is the preceding item in that proof tree. It retains its captures. The omission is forbidden when the chart advances that item over a completed `Y` that ends at some position `p′ ≥ p`. The resulting item then advances over a completed nonempty alternative of the optional, from `p′`. That completed `Y` passes `Y`'s test, if it has one.
- Where no preceding nonterminal applies, the fixed prefix is the item before the optional itself. The omission is forbidden when the chart advances that item over a completed nonempty alternative of the optional, from `p`.

The preceding symbol is read in logical helper structure (§3.2). The fixed prefix ends before that symbol, independent of capture expansion. A preceding plain optional supplies both absent and present blocker routes. Its nested helpers keep the same logical boundaries.

The fixed prefix retains its actual boundary record (§4.2). Different boundary records cannot share an omission blocker.

Three cases use the prefix immediately before the elidable optional: production start, a preceding terminal, and an initial recursive self-reference. The blocker search retains each proof's own prefix and eligible route. An omission does not record which constituent it closes.

For `%rule r B [c] [+T] D T`, capturing `c` changes no query answer. Both forms use the optional helper as the preceding logical symbol. Its absent and present routes take part in the same blocker search.

The blocking advances come from the unfiltered query chart. The query's chart ends with its span. A bounded whole query sees no written continuation past that span. A prefix query with `.onward` or `.following-tokens` sees the remaining input.

The nonempty alternative is the whole content of the optional, not only its terminator. So a written terminator forbids an omission only where the whole optional can complete after it. For example, take `%rule r c [+T A] D` and `%rule c B | B D`. On `B D T`, a prefix parse of `r` holds. The longer `c` reaches the `T`, but `[+T A]` cannot complete. On `B D T A`, that parse is false, because the whole written optional completes.

The advances of a blocking path come from the chart. So their tests and conditions passed. They need not belong to a proof tree of `rule`, and they need not be eligible themselves. An attempt that never completes `rule` can still forbid an omission.

So eligibility belongs to a whole proof tree, not to an advance alone. Two proof trees of one item can hold different items fixed before `Y`. An omission is permitted only through a proof tree whose own fixed prefix permits it, and that same tree must be eligible. An eligible prefix of one tree never combines with the permitted omission of another.

For example, take `r → [A] y [+T] C T U` and `y → A B | A B C | B z [+U]`. Also take `z → ε | C T`. On `A B C T U`, a prefix parse of `r` is false.

Two proof trees reach the omission of `[+T]` after `y`. In the first, `[A]` is empty and `y → A B`. That prefix is eligible, but the omission is forbidden, since the same prefix reads `A B C` as `y` and then the written `T`.

In the second tree, `[A]` reads `A` and `y → B z [+U]`, so the omission of `[+T]` is permitted. But that tree is not eligible. Its omission of `[+U]` is forbidden, because `z` can read `C T`, and then the written `U` follows. Without the `[+U]` of `y → B z [+U]`, the second tree is eligible, and the prefix parse holds.

An implementation computes E and P over the recorded advances. E says that one proof is eligible. P says that the same proof permits the next optional to be empty. A third flag F says that this proof has measure `(0,0,0)` for `.error-free`. The flags always describe the same proof, and distinct combinations remain separate.

The transitions are:

- A predicted item has E unless it is a completed unerased error occurrence. Its F flag holds for a zero measure.
- An advance that is not an omission gives E from an E predecessor. A completion also needs E in its completed child. An advance over a completed child needs F in both the predecessor and the child. If the token carries no error, an advance over it keeps the predecessor's F. Otherwise it clears F.
- An omission gives E only from a predecessor with P. It keeps that predecessor's F flag.
- Before an optional with preceding logical nonterminal Y, P follows an E advance over Y whose fixed prefix permits the omission. P retains that advance's F flag.
- Before an optional without such a nonterminal, P requires E and permission for that fixed prefix's omission. P retains the F flag of that proof.
- A completed unerased own error has no ordinary E, P, or F. An erased completion instead uses its interior's written-priority support and resets its measure, so it has E and F. This erased-completion rule replaces the general completion rule for that item. The ordinary fixed-prefix rules determine P.

The implementation also retains written-priority support through the same E and P transitions without the own-error filter. Erased completions use that support, so interior own errors do not destroy their witnesses. This support still requires a finite proof without forbidden omissions. These computations reach the least fixed point, so a cycle alone supplies no proof. They visit shared items and advances without constructing witness trees.

Eligibility filtering reads only the chart, and it evaluates no conditions. A query's answer determines which expressions the enclosing condition evaluates. The recursive-query error rule (below) applies to those evaluations.

`$x.without-elision` restores the terminators omitted inside `$x` for a query that preserves those closes.

A candidate is one constructed reading. A witness is a qualified reading that answers a query. A close record holds an omitted terminal and its original input boundary. In a witness of `.without-elision-except(F)`, it also holds a mark that says whether `F` permits its elidable optional (§2.2). Alignment compares the terminal and the boundary, never the mark. Ordered records at one boundary form a close group.

Aligned readings preserve these groups through their shared interval.

Let O be the current input with N tokens. Let `$x` cover `[a,b)` in O. Its restoration observation contains its own close records in leaf order, including records at both endpoints. An absent ordinary optional contributes no record. The caller's omissions contribute none. Ranked groups contribute opaque blocks as §4.1 specifies.

The logical view contains `O[a:b]` with those records restored, followed by the unchanged suffix `O[b:N]`. It uses the synthetic-token representation and original source mapping of §7.2 and §7.3. The captured endpoint follows every synthetic token at `b` and precedes original token `O[b]`. Morphology does not run again. Saved value and provenance remain available, but saved value is not an alignment field.

The match bound limits a completed witness. The context bound limits input visible to conditions and written-terminator priority. An ordinary query uses its span end for both bounds. A restored query keeps context `[a,N)` even when its match bound is `b`.

`$x.without-elision.parse(R)` and `$x.without-elision.parse(R).flags` require a witness of R from `a` to `b`. The latter unions those witnesses' own tags. `$x.without-elision.parse(R …)` permits any end `c` through `b`. `.onward` extends the match window through N without changing the restoration observation. Thus `$x.without-elision.onward.parse(R …)` permits any end `c` through N. A whole query on that extended window requires end N.

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

A synthetic token supplies evidence for an omission, rather than an additional mandatory word. It cannot satisfy a bare terminal in the witness. An omitted optional keeps its omission predicate and does not require its remaining content. Alignment compares terminal identity and boundary, without comparing the candidate's default value (§3.8). For candidate `X [+T="a"]` and rival `X [+T="b"]` on X, both omission predicates hold and alignment succeeds.

These four probes distinguish aligned queries from literal replay:

| Candidate on X | Rival | Query | Answer |
| --- | --- | --- | --- |
| `X [+T]` | `X [+U] [+T]` | Whole | False, because U adds a close |
| `X [+T]` | `X T` | Whole | False, because a bare T requires original input |
| `X [+T] [+U]` | `X [+T]` | Prefix | False, because the final group includes U |
| `X [+T Y]` | `X [+T Y]` | Whole | True, because the omitted optional requires no Y |

If `F` permits U, the first probe holds under `.without-elision-except(F)`. U then stands between the original X and the kept T, inside the shared stretch. Under a family that does not permit U, and under `.without-elision`, the first answer stays false. The other three answers stay as the table shows for every family, because their rivals add no close.

An aligned witness uses its own projected spans and structural observations. Input token methods read original tokens. An explicit nested restored span fixes its own captured closes, with its own family if supplied. An ordinary nested query inherits no alignment.

When `$y` extends into the suffix, its later omissions enter that additional constraint. No token is restored twice.

Queries retain the caller's lowered grammar, effective constants, features and Unicode data. They run recognition without emission, messages or ranking.

Aligned query answers need separate memo keys from ordinary queries. The keys include the original context and source observations, start, context end, match window, and whole or prefix mode. They include the ordered close groups, opaque blocks, common entry observations, lowered grammar, features, and family. They also include any cycle context on which a cached proof summary depends. A synthetic-token view keeps saved value where recognition values use it. Saved value never becomes part of close equality.

The active-query identity remains the requested rule and projected context interval in O. The family is not part of the active-query identity. For aligned whole and extended-prefix requests, that interval is `[a,N)`. The whole endpoint is a witness filter and does not change that identity. Ordinary and restored views share the same active stack for every query. Another script, synthetic position, or query kind cannot evade the recursive-query grammar error.

Answer keys distinguish constraints, while active keys detect self-definition.

Aligned requests share qualification by rule, start, context end, and active query context. Family requests also retain the family, candidate end, and candidate observation in that key. Each request filters the qualified witnesses for its endpoint and alignment constraints. Reusable qualification stores completed observations and tags, without retaining the recognition chart or its proof edges.

An ordinary query reads the tokens of its span alone. A whole query over a span does not look past the span's end, even where a written terminator stands after it. So the keys of the memo (below) fit its answer.

A prefix query is one recognition over the whole span, not a separate parse of each prefix. Conditions see the query's context end. For an ordinary span, that end equals the span end. A recognizer can stop at a set that holds no item, since no later set can then hold one. Otherwise it reads as far as it can. An error of the grammar that it meets is an error, even after `rule` completed once.

For ordinary spans, an implementation can remember answers for the whole parse of a stage in a memo. A memo stores answers from earlier nested parses. This general memo is optional. Section 4.4 defines separate suffix sharing and its cost.

If their nested parses observe the same things, two queries can share an answer. That is, the two queries are of the same kind and ask about the same rule. They also have the same span or the same content. The anonymous target of `parse` uses its structural identity (§3.10).

The same span is the same start and end in the stage's input. Within one parse, the span fixes the tokens and the lowered grammar. A query that the check of §7 starts has its projected span here, never its span in the reconstructed input. Its grammar is the main parse's.

A content memo includes original text, token bags, source bounds and all other observations it can expose. A position memo within one parse can identify that input by its windows.

Tags alone are not enough, since a condition can read `.source-text`, which includes what lies between the tokens. Also, the source of each token decides what `.source-text` of a part of the span is. A key of content must keep its fields apart, so that no two different contents give the same key, whatever characters the fields hold. A key of content lets equal spans at different positions share an answer, and repeated words make this worth having.

But such a key costs time in proportion to the span, and the span of `.onward` or `.following-tokens` runs to the end of the input. So a key of content suits short spans, and a key of position suits long ones. Both keys hold for the queries of §7, since those read the stage's own input. A position is a position of that input, never of the reconstructed input.

The recognition of §7 is not a query and has no entry.

Each mode needs its own entry, since its witnesses stand at other places. A `.flags` answer and a Boolean answer of one mode share that mode's entry. The key of a memo that outlives one stage parse must also include what differs between the parses that it serves. These are the tokens, the original text, and the inputs that select a shared memo. §4.3 specifies such a memo.

An ordinary nested parse uses its span as the context for all position and surrounding-token methods. An aligned parse uses its context bounds above. It restores both when it ends, also when it fails with an error of the grammar.

A nested parse's own conditions and bag terms can start further queries, so queries nest. They nest to any depth, and no bound applies to it. The depth follows the input, as in a chain of `$.following-tokens.parse(x …)` across a long text. So an implementation keeps the active queries on a stack of its own, not on the call stack of its language.

A query is active from the start of its nested parse to its end. Take a query about a span as a rule. It is an error of the grammar where an active query is about the same span and rule. Every `parse` of that rule, in any mode, is one kind here. The methods of the two queries do not matter, nor does `.error-free`.

Whether a query is negated does not matter either. The error names the rule, and the whole parse fails with it. Such a query makes the grammar define the rule in terms of itself over the same text.

The recursive-query reason uses this template, with the requested rule name in place of `R`:

```text
a condition asks whether its own span parses as R from inside the parse of that span as R: the grammar defines R in terms of itself over the same text
```

The reason omits source text, so arbitrary token contents do not require a second escaping convention. Libraries add no stage prefix or document suffix. The structured error retains its stage.

Only queries are active. The main parse of a stage is not a query, and neither is the recognition of the check of §7. In the main parse this changes no result. A query there about the whole input as `text` runs a nested parse of the same tokens with the same grammar. That nested parse reaches the same condition again, and then it is the active query. The check of §7 reads other tokens, so there the difference shows (§7.6).

A query names its span in positions of the stage's input. A query that the check of §7 starts names its projected span (§7.3). So two queries are about the same span exactly where they read the same tokens of the stage's input.

Derivations are finite trees. A derivation in which a constituent has, anywhere below it, a constituent of the same rule over the same span is cyclic. The engine does not count a cyclic derivation, since such a derivation can repeat without end. For example, with `%rule a b` and `%rule b a | A`, `A` has one derivation as `a`, not infinitely many. So does the empty text as `t`, with `t → u | ε` and `u → t`.

Derivations are made only of advances that the tests allowed. An implementation can build derivations again from completed spans, without the advances. Such an implementation applies the tests again, each to the candidate constituent itself, with its own span and its own tags.

For example, take `%rule text [X] body="y"`, `%rule body X Y | Y` and the input `X Y`. Let `body` use the default child join for its value. The token that `X` reads has value `x`, and the token that `Y` reads has value `y`. Only the `body` over `Y` matches, so `[X]` reads `X`. No derivation reads `[X]` as empty.

For a key test, consider `%rule text [X] body<B>` and `%rule body X Y | Y → {B}`. Only the alternative over `Y` supplies `B`.

In a derivation, an empty elidable helper supplies one omission at its input boundary. Its record holds the terminal, boundary, source, and default value. It does not record which constituent it closes. The step `late #·_<_Elided>` reads omission counts. Aligned queries read their owned ordered close records.

The query blocker relation uses the logical preceding symbol described above. Braces use their expanded logical productions. Production start, a preceding terminal, and an initial recursive self-reference retain their immediate-prefix treatment.

A counted derivation is a noncyclic derivation of a completed `text` item that spans the input. With a counted derivation, a stage accepts its input. Ranked admission preserves this recognition for the sealed grammar. Section 6.1 defines admission before ranking, with raw charts and query answers unchanged.

The stage rejects an input whose every completed text derivation is cyclic, as it rejects one with no such item. A stage that accepts its input can still end with a tie, which is an error (§6). A rejected input reports the furthest position that any item reached. It also reports the terminals that the items there can read next, together with the rules that those items belong to. The stage writes a tested terminal with its test, such as `LE="la"` (`docs/output.md`).

A rejection at the end of a stage's input has an empty source at the source end of its last input token. If the stage has no input tokens, that source is `[0,0]`. The original text's length does not determine this position. This follows the empty-node source rule of §12.

### 4.1 Shared candidate observations

A structural state is a finite summary of demanded tree predicates. Compile only patterns that conditions demand, and their dependencies. Reuse identical subpatterns. Intern states by equality of all their specified parts.

This rule uses no semantic minimization. Implementation bookkeeping does not distinguish structural states. A tree pointer in every item does not provide the required forest sharing.

Patterns observe the structural tree defined in `docs/notation.md`. Rule names, terminal identities and demanded test answers form a finite alphabet for a lowered stage. A leaf transition records terminal identity and demanded value-test and tag-test answers. A named completion records the answers of the tag tests and value tests that a demanded pattern asks of that node.

A rule pattern demands visible key presence or the certified rule value. An omitted leaf exposes its terminal key and resolved default, with empty image. The pattern atom `_` matches any written or omitted leaf.

A spliced occurrence uses an anonymous child-sequence observation instead of its named constructor. Recognition retains the transparent call mode wherever structural predicates or tree identities distinguish it. That mode never changes the rule-and-span cycle key. A caller captures the working call. Patterns on its parent see the flattened child sequence.

Its own `$` uses the anonymous working sequence. `#foo` cannot match the root of `*foo`.

Compile each child-sequence expression into a finite sequence machine. Prefix states advance as children complete. Ellipses permit arbitrary sibling gaps, and flat repetitions use sequence loops. Helpers concatenate their child sequences without a named constructor.

Ordinary named completion adds its own constructor transition, including named chain levels. An unerased spliced completion concatenates its children without that constructor. Structurally empty named children disappear from parent sequences, but their directly captured roots remain observable.

Each sibling gap has a private consuming loop. Its loop cannot consume children for another choice arm or an absent optional. Each repetition compiles its body once. Its separator returns to that body's entry after each completed occurrence. Nested repetitions add states in proportion to their written size.

Each structural machine reuses one seal state. Completing another ranked option or erased occurrence does not rebuild the seal's sequence relations.

A node test evaluates its atom and attached child list together at the current node. Unless `exact:true` is present, it propagates that complete local answer through a sole child. A bare child list follows the same rule without an atom. Each child pattern computes its own complete answer, with its own exact prefix.

A bare child list uses the ordinary node form with `any:true` and its `children` array. Internal empty patterns use this same form. A list with one sibling gap uses the same sequence form as every other child list.

Descendant paths combine local and child answers. First and last paths use only their respective child. Set operations combine complete predicate answers on one candidate. Difference complements the completed deterministic answer, never incomplete evidence or another unary layer.

The state retains more than final Boolean answers. It includes sequence prefixes, leaf tests and child observations that later transitions need. Intersections and differences use correlated product states. They never combine facts from different packed edges.

An advance keeps its structural prefix and each captured child's completed state. A condition on a capture reads that state when the constituent completes.

A condition on `$` reads its candidate completion. A structural pattern requests only the necessary key and value tests. Recognition reuses these observations without a new query or a ranking decision.

At a ranked group completion, the structural sequence machine receives one fixed sealed leaf. Every option and proof supplies the same leaf. It has no name, terminal identity, value, tags or children. Every node test fails on a seal, including bare lists and exact empty lists. Paths stop there, while sibling ellipses consume it as one child.

An empty completed option also contributes exactly one sealed leaf. Empty normalization never removes it or a named node that contains it. A seal is not an observable node as defined in [Tree patterns](notation.md#the-structural-tree).

Private option captures retain their real completed states for ready gates. The composed parent state propagates the seal through subsequent constructors and captures. Output trees, tags, elisions and ranking actions retain their actual derivations. No seal appears in serialized trees or grammar DOMs. Queries and reconstruction apply the same transition at ranked group boundaries.

An erased production keeps its working observations for its own clauses. After qualification it gives callers sealed structural observations. A named root keeps its own identity and effective keys.

A spliced erased occurrence supplies the single-seal sequence without the named constructor. Its captured root uses the ordinary anonymous constructor over that sequence. Empty spans still supply one seal. Empty normalization removes neither the seal nor a named root containing it.

Parent prefixes, captures, and contextual frames read the exported observations. Working prefixes and captures remain available for the erased production's own clauses. They do not enter its exported structural state. A chain level or recursive occurrence of an erased definition is an erased child, so its parent level sees it sealed.

These transitions apply in main recognition, queries, and reconstruction. Comparisons evaluated after selection use the same exported and working views. They do not rebuild an outside view from the unsealed output tree.

Structural sealing changes no action, proof edge, span, tag, boundary record, or diagnostic occurrence. Existing erasure rules still govern measures, selection, emission, and diagnostic removal. No seal appears in serialized trees or grammar DOMs.

Erasure adds no ranked-group block to a restoration observation. Demanded closes and existing opaque blocks remain separate from the sealed structural state. Every key that reads them retains them.

Every proof edge stays within its observation state. Equal states still permit distinct derivations and ordinary ties. A cycle alone supplies no finite proof of a structural answer. Cycle exclusion keeps its rule-and-span identity. A different structural state does not permit repetition of the same rule over the same span.

Restoration observations retain proof-sensitive close groups and opaque blocks beside the finite structural states. Only the captures that `.without-elision` or `.without-elision-except` demand, and their dependencies, need these observations. Only the witnesses of a family query carry permission marks, and each mark is relative to that query's family. Candidates, strict queries and ordinary recognition carry none.

The deletion test of §4 is the rule for a family witness. At each boundary through `min(b,c)`, the witness's group must reduce to the candidate's group by that test. A recognizer can compute the test as the witness grows. A family query fixes its candidate for the whole witness chart, so the candidate's group at each boundary is known.

A family-summary context depends on the candidate's normalized observations and interval. Witness records supply family-specific permission separately.

Let the candidate's group at a boundary `p` hold `n` records. The test at `p` is an automaton whose states are pairs `(i, t)`. `i` counts the candidate records matched, and `t` says whether a deletion follows the last match. A witness record that equals the next candidate record moves `(i, t)` to `(i+1, 0)`. A permitted close moves `(i, t)` to `(i, 1)`. At `i = 0`, that move needs `p > a`.

At a boundary `p < min(b,c)`, `(n, 0)` and `(n, 1)` accept. At `min(b,c)`, only `(m, 0)` accepts, where `m` leaves out a candidate block that starts there and ends after it. Beyond `b`, every group passes. A run can make several deletions in a row. So other extra closes can stand between a deleted close and the kept element on each side.

An item keeps an end set: the states that its own records at its end reach from `(0, 0)`. It keeps a start set: the states from which its own records at its start reach acceptance. An empty item keeps the relation between states instead. A boundary strictly inside an item holds a complete group. When the item grows past it, the group passes if the two parts' sets share a state. Otherwise the group fails, and the item's summary is dead.

Two items with equal raw observations and equal summaries share one state. A cyclic observation has the dead summary, as it has one invalid raw state.

A boundary that an item reads past lies before the witness's end `c`. So its accepting states are known while the witness grows. When an item reads the token at `p`, its end set must hold an accepting state of `p`. At the witness's end, its start set must hold `(0, 0)`. Its end set must hold `(m, 0)` at `c`, unless `c > b`. An empty witness has a relation instead, which must lead from `(0, 0)` to an accepting state of `a`.

A dead summary never removes an item, its advances or its conditions. The item still blocks omissions as §4 says. The summary only decides whether a completed item can be a witness.

The number of summaries of one raw item depends on the candidate's group sizes at the item's ends. It does not depend on the witness's own groups. The grammar alone does not bound it, because a larger candidate group can need more summaries. Different close observations never merge into one captured value. Equal observations can share proof states, while their derivation edges remain distinct.

A caller consumes a constituent in a rule occurrence. The recognizer separates ordinary and observed caller modes. An observed mode is a set of demanded observation kinds. One kind is the closes that either restoration method reads.

The other is the tree identity that a comparison of two constituents reads (below). A capture or an enclosing observed caller can demand either kind. So an occurrence can demand closes, tree identities, or both, and its prediction and completion keys hold that set. A close demand alone starts no identity, and an identity demand alone retains no closes.

An occurrence that demands both retains both. A demanded capture can observe a rule without splitting unrelated callers of that rule.

An implementation can test possible first terminals before it retains a capture's close sequences. If no witness can begin at that token, the capture's own query needs no close observation. An enclosing observed capture still needs every close inside that capture.

This shortcut requires a nonempty capture with no possible leading omission. An empty witness prevents the shortcut. Conditions can reduce the possible prefixes, so this test ignores them. The query still uses its original context and written-terminator priority.

A ranked group contributes one opaque block outside its options. The block identifies its written occurrence, original span, and common entry observations. It excludes the option index, private captures, private closes, and proof identity. Wrappers and outside captures retain the block. Empty completed options also supply a block.

An aligned witness must carry that same block through the same written group occurrence. It cannot replace the block with unrelated syntax or finish inside it. Compare original positions and common entry observations, rather than unrelated runtime parser identifiers. All proofs that one block represents supply the same outside answer. The query does not ask admission which option wins. Private captures inside an option retain their own real observations for ready conditions.

Candidates and aligned witnesses use finite noncyclic observation proofs. Named-rule cycle exclusion uses original positions, including during restoration. A repeated named rule over one original span supplies no additional aligned observation. Synthetic positions and different observations cannot excuse that cycle. Ordinary unmarked queries keep their proof policy.

If a reached restoration lacks a finite noncyclic observation proof, the current step drops immediately. No later operand or condition of that step runs. In a boundary condition, only the current Boolean assignment fails, and the other assignment still runs.

The engine shares candidate and witness proof states with their relevant cycle contexts. It cannot enumerate every complete tree before evaluating a captured condition. It cannot impose an arbitrary limit on restoration length. Nullable recursive omission lists, such as `%rule r r [+T] | X`, must reach a finite shared construction.

A comparison in a condition or early bag entry demands structural observations on the candidate. A comparison in a late entry uses the chosen derivation. A node comparison needs tree identities. A pattern comparison needs the finite structural state.

Demand is by occurrence, through the observed caller modes above. The occurrence of a compared capture demands the identity of the constituent that it reads. An item carries an identity only where a demanding occurrence predicted it, directly or through its descendants. So the demand follows the structural tree down from each compared occurrence.

It enters every rule that the body can build there, through helpers and chain levels, and it stops at a seal. The identity of a parent reads a seal as its sequence of token values, so it needs nothing inside the sealed interior. A private comparison inside an option of a ranked group starts its own demand there. A private comparison inside an erased definition starts its own working demand there.

A rule that no demanding occurrence reaches keeps no identity and costs nothing. So the four libraries compute one demand set.

A production's own comparisons apply under every caller mode, at their ordinary readiness points. A comparison that uses `$` needs the complete child sequence of the production and its root identity. So that production carries its partial sequence under every caller, and the comparison runs at completion. A comparison that uses only captures demands identities at those capture occurrences and below them.

It demands nothing for the other children and nothing for the root. It runs where the item reads the later capture, as §4 says for every condition. The item keeps the identity of the earlier capture in that child's completed state, beside the rest of that state. So two items with different identities for it do not merge.

The mode of a caller decides only whether the identity of a completed constituent stays in the item that advances over it.

For `r → $v:operand $e:operand tail`, a condition `$v ≅ $e` demands both operands' identities. It runs after `$e`, before `tail`. Demand reaches observable descendants of those operands, up to seals. It does not reach `tail`.

For each demanded occurrence, a completed item carries the identity of its tree. A partial item carries the ordered sequence of the identities of its children so far. Two equal trees share an identity, and two different trees do not. A library interns identities bottom-up from a tagged key, with one constructor for each kind of node:

```text
Rule(rule identity, child identity sequence)
Written(terminal identity, input value)
Omitted(terminal identity)
Seal(original token-value sequence)
Anonymous(child identity sequence)
```

The rule identity names the resolved rule or template instance, not a production and not a helper. The terminal identity is the one of §9. A spliced child contributes its ordered observed children to a parent identity. A direct splice capture cannot supply a node-to-node comparison operand.

An erased named occurrence exports `Rule(rule identity, [Seal(original token-value sequence)])`. An erased splice exports `Anonymous([Seal(original token-value sequence)])`. It contributes the single-seal sequence to its parent.

Outside identity demand stops at the erased occurrence's seal. The definition's own comparisons start their ordinary internal demands. A comparison using its own `$` reads its working identity before export.

Reconstruction uses the seal's projected original token-value sequence. Synthetic restoration tokens add no values to that sequence.

The child sequence comes after helper flattening and after the removal of structurally empty children. So two groupings of helpers give one identity.

A seal's key is built once per span in one recognition and shared. An exact comparison of keys resolves a hash collision. The interned parts are shared, because a copy of the tree in each item breaks forest sharing.

Two items with different identities, or with different partial sequences, do not merge. In the same way, two items with different structural states do not merge. An interner number is private to one recognition and is no persistent key. Spans, tags, restoration defaults and production numbers do not enter a key.

A predicate can compare a list item with an outer capture. Then the frame of §4 holds the identity of the outer capture, beside the other demanded observations of that capture. Items merge only where frames agree. So the helper repeats once for each distinct identity of the outer capture. Each distinct tree of the compared outer capture supplies one frame.

The demanded identities of one span need a finite domain, and recognition does not give one by itself. §4 excludes a cyclic derivation from the counted derivations. But the chart builds items before it counts any derivation, and a rule can wrap itself over one span without end. For `s → "a" | s`, the span of `a` has the trees `s(a)`, `s(s(a))` and so on. Each tree has its own identity and its own item, so the chart never closes. The lowering check of §9.3 excludes such a cycle under a comparison.

The engine does not take an identity from one noncyclic proof at the condition instead. Conditions run during recognition, before the ranking contexts of §6 exist. Such a rule needs cycle contexts, memo keys and a failure rule under negation, and the engine has none of them.

The same rules apply in the main recognition, in a nested query and in the reconstruction of §7. A nested query that reaches a comparison builds demanded identities under the same rules.

Under the check of §9.3, one rule has a finite number of distinct identities over one span. That number can grow exponentially with the span. `s → s s | "a"` has Catalan-many trees over a growing input. Exact identities tell them all apart, while structural states merge them.

The cost counts distinct completed identities, distinct partial sequences, distinct seal spans, packed edges and frame combinations. It falls only on the demanded occurrences and the trees below them. A grammar without a comparison of two constituents pays nothing.

An occurrence with demanded identity can require more chart items than an ordinary occurrence of the same rule. One ordinary item can represent many trees. The observed mode keeps one item for each distinct tree. The total cost includes both modes, with no constant ratio between their sizes.

### 4.2 Boundary obligations

`$x.followed-by(S)` and `$x.preceded-by(S)` are boundary atoms (§10). Their target `S` is one name or a choice of names, each a rule or a tag terminal. `🆓` is a rule name (§2), so it can be a target, and its node is its constituent. A forward target is a name in a recognition-time `followed-by` atom, including conditions appended by neighbor guard lowering (§3.7). A backward target is a name in such a `preceded-by` atom. An atom in a chosen output guard makes no target of either kind, because it reads the chosen derivation after the parse.

Only conditions in active lowered productions supply these targets. This includes the appended conditions of guarded bag variants. Feature selection, capture applicability and presence simplification determine which conditions remain (§3.6). A dropped condition supplies no target, including one that simplifies to true. Applicable conditions deferred to active ranked options also supply targets. Disabled alternatives supply none.

An active production supplies targets regardless of recognition reachability on the current input.

A counting node is a visible ordinary rule occurrence or terminal read (§12), other than an `elided` node. Spliced calls supply no named offer. Their children retain their own offers.

A rule node's name is its rule. A token node's name is the terminal that read it, without its test. For an atom, a counting node must have a nonempty span. Its first token and its last token are the first and last stage-input tokens of that span.

Let the receiver span `[a,b)` in derivation D. `$x.followed-by(S)` is true when `b < N` and D has a counting node of a name in `S` whose first token is `b`. `$x.preceded-by(S)` is true when `a > 0` and D has a counting node of a name in `S` whose last token is `a−1`. Otherwise each is false.

A condition item holds at most one atom (§9.3). The same rule applies to each condition appended by neighbor guard lowering. An `%error` rule can carry a boundary atom in its conditions.

A choice of names is one atom. Its value in D is its value under §10, with the atom's value in D. If any condition item fails, that derivation does not count. This filter applies before ranked admission and ranking (§6). It applies to the counted derivations of a stage, to query witnesses, and to the derivations of §7.

The recognizer cannot know the atom's value at the step that makes the item ready (§4). So the step evaluates the item twice under §10, once with the atom true and once with it false. Each evaluation stops where §10 stops. If either evaluation raises a grammar error, the step raises it, as any condition does. Otherwise the step reduces the item:

- If both evaluations give true, the item holds, and no literal remains.
- If both give false, the item fails.
- Otherwise a literal remains. A literal is the atom's direction, its target and a sign. It is positive if the item holds where the atom is true, and negative if the item holds where the atom is false. The literal becomes an obligation of the step's resulting item.

An evaluation that reaches an invalid restored observation is false for that assignment alone. It does not discard the other assignment.

A pending literal counts as holding for the rest of its step. So the step evaluates its later condition items and demanded observations in the order of §4. A failure there drops the resulting item with its obligations. A grammar error there is raised at the step. A later step over the resulting item runs as usual, and its grammar errors are raised too. Errors therefore follow the steps that run, not the order of D.

Two literals are equal when their directions, targets and signs are equal. Each literal also carries an annotation, the set of rule and condition index pairs whose items produced it. The annotation is not part of the record. When two items merge, or a literal joins an equal one, their annotations join. The annotation serves only the `boundary` member of a rejection. A target is equal to another when it holds the same names.

Guarded bag variants keep their effective entries and appended literals apart until those literals settle. Contradictory assignments pruned by §3.7 never enter this recognition. Surviving variants retain one source occurrence, so settlement creates no duplicate diagnostic or charge.

An item carries a boundary record, which is part of its identity. Two items merge only when their records are equal. Proof edges stay within one record. Records hold literals, and offers of targets only.

Boundary records store target offers and pending literals as bitsets. A bitset stores integer identifiers as bits in words. Names receive stable identifiers within one boundary machine. An advance constructs each result field from the fields that it uses.

The record of an item that has read no nonempty symbol is one set, its pending literals, which stand at its origin. The record of any other item has four parts:

- Its start literals stand at its origin.
- Its first offers are the forward targets among the names of its counting nodes whose first token is at its origin.
- Its end literals stand at its position.
- Its last offers are the backward targets among the names of its counting nodes whose last token is just before its position.

A forward literal is a literal of a `followed-by` atom, and a backward literal one of a `preceded-by` atom.

To meet a set of literals with a set of offers, take each literal that has a name of its target among the offers. A forward literal looks among the first offers, and a backward literal among the last offers. Such a literal leaves the record. A positive one is satisfied. A negative one fails, and the step drops its resulting item.

To settle a set of literals, decide each literal that remains. A positive one fails, and the step drops its resulting item. A negative one is satisfied.

Meeting and settlement inspect only the literals in the supplied set. An empty set needs no literal inspections.

Each step applies these rules after the order of §4, which they extend. A token read is an advance over a nonempty constituent whose record has no literals. Its first offers hold its terminal if the terminal is a forward target. Its last offers hold its terminal if the terminal is a backward target.

1. Before an advance over a receiver `$x`, a backward obligation on `$x` joins the item's literals at its position. The advancing item can be a named item or a helper item, such as the helper of a ranked option with a private receiver. These are its pending literals if it has read no nonempty symbol, and its end literals otherwise. After the advance, a forward obligation on `$x` joins the item's literals at its new position in the same way.
2. An item advances over an empty constituent E. If the item has read no nonempty symbol, E's pending literals join the item's pending literals. Otherwise they join the item's end literals, and the backward literals among them meet the item's last offers. In both cases the item's own literals stay as they are, so they reach the next nonempty constituent.
3. An item that has read no nonempty symbol advances over a nonempty constituent C. The forward literals among the item's pending literals and C's start literals meet C's first offers. All of these literals that remain become the item's start literals. C's first offers become the item's first offers. C's end literals and last offers become the item's own.
4. Any other item advances over a nonempty constituent C. Let P be the item's end literals with C's start literals. The forward literals of P meet C's first offers, and the backward literals of P meet the item's last offers. Then P is settled. C's end literals and last offers become the item's own.
5. A nonempty item of rule R completes. If R is a forward target, it joins the first offers. If R is a backward target, it joins the last offers. The forward start literals meet the first offers, and the backward end literals meet the last offers. Then the obligations on `$` join: backward ones the start literals, and forward ones the end literals.
6. An empty item completes. The obligations on `$` join its pending literals.

A ranked helper can evaluate a condition that an enclosing group owns. It keeps the ordinary evaluations and their error order. It introduces a whole-rule literal only when the written condition reads a private capture that its group binds, including an absent descendant capture. Determine that ownership before capture-presence simplification. A nested helper never moves an enclosing group's literal to its own start. A common whole-rule condition introduces its literal at the named completion.

A completed `text` item that spans the input settles all its literals: its pending literals, or its start and end literals. A nested query settles its witness root's remaining literals in the same way before it counts the witness. An inner completion can receive boundary offers from its ancestors. The witness's span stands in for the input. In an aligned query, the witness reads restored terminators as synthetic tokens (§7). Its atoms read projected spans, as §7.5 says for the check.

A synthetic read has an empty projected span, so it gives no offer and makes no node count.

The chart of §4 holds exactly the items that these rules keep. Written-terminator priority, query eligibility, the rejection position and ranked admission read that chart. So the meetings of rules 2, 3 and 5 are part of the result, not an optimization. An item that a meeting drops never blocks an omission, for example. An item whose obligations are still pending is in the chart, and it blocks as any item does.

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

One shared memo serves one stage of a loaded pipeline. Its identity includes the effective constants, Unicode table, input interface and relevant gate outcomes. Query entries identify the target, input and required outer observations. A feature with no reachable gate does not by itself change that identity.

The loaded pipeline owns its shared memos, and a memo lives no longer than its pipeline. Two loaded pipelines never share a memo, even where they read the same documents. A memo goes with its lowering, so an implementation keeps no more memos than lowerings. The reader of the notation (§8) has grammars of its own, and their memos follow the same rules.

A conditional `%features` declaration (§13) holds or fails before its stage parses. The features it turns on select that stage's lowering, and so its shared memo. So the key needs no part for them.

`until` and `elision-only` leave the answer of an ordinary query unchanged. A query keeps its caller's lowered grammar and reads only its own span. The check of §7 starts its ordinary queries over the stage's own input, with the main grammar (§7.6). So the key needs no part for these options either.

The shared memo holds only ordinary queries with a key of content. A key of position names a place in one input, so it stays in the memo of one parse. An aligned query also stays there, since its key holds observations of one parse.

A content key includes the query mode, resolved target, source text and relative source offsets. It retains the input observations the query can distinguish. These can include the text, bare or valued state of each key and its demanded payload. The key also retains the relevant outer bindings, gate outcomes and query constraints.

Keep observable root answers, errors and bindings together with canonical root order. An existence bit or a union of flags serves only a reader that asks for that summary. A root predicate can distinguish two tokens with the same key names and different payloads. It can also distinguish two roots that cause errors at different sites.

If a query or its dependency uses `.error-free`, retain the carried-error observations needed for that eligibility test. An implementation can instead apply the filter to each view. Carried identities, messages and warnings do not distinguish ordinary structural answers.

A query that ends with a grammar error leaves no reusable entry. A successful computation can retain a dormant error as an observation. Looking up the observation does not report it. An active reader that reaches it reports the error in canonical order.

A terminal target reuses its target helper. Keep separate answers for whole, prefix, suffix and part modes.

A shared memo must never change a result. A warm shared memo holds entries from earlier parses. A parse with a warm shared memo gives exactly the result of the same parse with an empty one. This holds for every order of parses, and for parses that run at the same time on other threads.

An answer stays out of the shared memo where its nested parse, at any depth, asks an aligned query. It also stays out where that parse reads an answer with this dependency. Retained suffix answers carry and propagate the same dependency.

Every query tests its active identity before any cached lookup. A cached answer must not hide a recursive-query error.

Whole and suffix recognitions can reach different roots over the same content. Content alone therefore cannot prove that a cached query chain avoids an active suffix query.

Nested requests made while a suffix query is active bypass all reusable answer and qualification caches. They insert no reusable entries. This includes retained suffix computations and shared answers. Each request receives its current computation's answer directly.

The shared memo also serves no answer while an aligned query is active. Outside suffix activity, it can keep ordinary answers computed during aligned activity when those answers have no aligned dependency.

A shared memo keeps its entries in two generations, a newer and an older set of entries. A lookup reads the newer generation, then the older one. An entry found in the older one moves to the newer one. Before an entry enters the newer generation, by an insertion or by that move, the memo makes room. Where the newer generation already holds the bound, the older one is dropped, and the newer one becomes the older one. This drop is eviction.

A key that the newer generation holds does not enter it again. Eviction can happen during a parse. It only decides whether a later query runs its nested parse again. This is the scheme of the libraries. Any other bounded scheme also keeps every result.

An entry never changes after it enters the shared memo. Parses on several threads can share one pipeline. Each lookup is then one atomic step, with its move and its eviction. So is each insertion, with its eviction.

### 4.4 Backward token queries

Let the current input context be `[c,d)` and the receiver's projected span be `[a,b)`. `s.preceding-tokens` returns the ordinary span `[c,a)`. It is empty when `a=c`, including for an empty receiver there. A restored receiver first projects to original tokens and loses its restoration constraints.

The context is the stage input or the input window of the current nested query. A backward query inside a forward query cannot see tokens before that forward query's start. `.last-token` retains its ordinary meaning. Thus `$x.preceding-tokens.last-token` is the token immediately before `$x`, within that context.

An ordinary suffix query `s.parse(… R)` recognizes the fixed window `[a,b)`. It permits a target root at every boundary `k` with `a≤k≤b` and requires its completion at `b`. Conditions of every candidate use the same context `[a,b)`. No candidate receives `[k,b)` as a new context.

A part query over `[a,b)` keeps that whole view as the context of every witness. So `.starts-input` inside a witness sees `a`, and `.ends-input` sees `b`. The same holds for `.onward` inside a witness.

The method holds when some permitted completion has an eligible proof tree. A nullable target can supply the empty suffix. A user-tag target tests the last original token and fails on an empty receiver. The user-tag test is its query helper's single production (§3.10). Suffix recognition retains that answer for the parse.

```jbogenbau
%rule start-a
  "a"
%conditions
  $.starts-input
```

On the two tokens with values `b` and `a`, `.parse(… start-a)` is false. The target starts after the fixed window's beginning. Parsing the final token alone with `.parse(start-a)` instead holds.

All target starts belong to one recognition computation. Written-terminator priority and finite eligible proofs follow §4. Ranked admission, ranking steps, and stage preferences do not rank query proofs.

The query selects no longest suffix. A grammar error that this computation reaches remains an error even when another suffix succeeds. Within one shared recognition, an error first raised at input boundary p fails its requests ending at p or later. It does not fail a request ending before p.

A grammar error ends the stage. The shared recognition therefore serves no later request after that error.

A suffix query requires a capture or ordinary span. A restored receiver causes a load error, including after `.onward`, which preserves restoration. This includes `.without-elision-except(F)` views.

A span method that drops restoration can supply an ordinary receiver. For example, `$x.without-elision.preceding-tokens.parse(… R)` queries the raw prefix. It applies no suffix alignment constraint.

Query answer keys distinguish suffix and part modes from whole and prefix modes. They include the target instance and fixed window. The active-query identity remains the target and projected context interval, across every `parse` of that target, in any mode. Changing direction cannot evade the recursive-query error.

Requests outside active suffix queries share recognition when they have one lowered target and window start, and that target reads no window end. The shared recognition starts the target at every position from that window start. It retains one answer for each requested end boundary. The total cost is that recognition, including its nested queries, plus constant work per request. Complex targets can cost more than linear time even with sharing.

A target reads the window end when its recognition evaluates `.onward`, `.following-tokens`, `.ends-input`, or `.followed-by`. This includes conditions and bag terms of rules reached through body references. A target also counts as reading the window end if its recognition contains a nested query with a restored receiver. This rule includes restored queries at any nesting depth. An ordinary nested query target uses its own window end. Its end-reading methods alone do not create this outer dependency.

Dependency analysis groups ranked plans by production before visiting reachable productions. Each production supplies only its own plans.

Written-terminator priority uses only blockers that complete within the requested window. Shared recognition therefore decides eligibility separately for each end boundary. A later blocker cannot change an earlier retained answer. Errors retain the boundary scope defined above.

A retained suffix computation records whether its reached work depends on an aligned query. Each retained-answer hit propagates that dependency to its caller.

A target that reads the window end requires separate recognition for each distinct end. Its errors retain the complete window identity and never propagate to a different window. Repeated requests for the same window can reuse its answer. Use suffix queries sparingly because complex targets can require more than linear work.

## 5. Values, images and text

The engine reads the strings in a node's bag. Stage zero gives both strings the decomposed scalar. A rule can set either string independently. A published token needs both.

Write `$.span.tokens!'value.join()` for the original input join. The same expression with `'image` joins the input images. A child join reads the derived strings of its children. It includes omitted defaults in values and empty strings from erased children. The grammar supplies any join it needs.

`.source-text` reads the slice over an input span. `.decomposed-source-text` decomposes that slice with the configured Unicode table. For a complete cluster, it matches the join of stage-zero values over that cluster. An empty span gives empty text.

Verbatim reads are late. They can extend the returned string without moving the source range. Section 11.2 defines the claim rules.

## 6. Choosing a parse

Section 6.1 admits derivations before this ranker when a ranked group can apply. This ranker is the same either way.

A stage first ranks admitted derivations by their blame measure, defined below. It then compares equal measures by the steps of its `%ambiguity-resolution` directive (§2). A step is `leftmost-longest P`, `fewest P`, `most P`, `late P`, `early P`, `greedy`, or `lazy`. Here P is a node pattern.

The last two are leans. A directive has one or more steps, and a lean can stand only last. The steps other than a lean are the key steps.

A grammar key step counts matching observable nodes of the actual derivation (§4.1). These are ordinary rule constituents, written leaves, and omitted terminators. Nodes inside ranked options remain visible to ranking, which walks actual derivations.

Helpers and spliced roots supply no node for grammar key steps. Empty ordinary rule constituents contribute no occurrence. The mandatory measure includes spliced error occurrences. Grammar key steps see an erased root but none of its proper descendants. The ordinary exclusions of empty nodes and spliced roots still apply to that root. A structural seal does not make a zero-span occurrence count in a grammar key step.

A constituent or written leaf uses its input span. An omitted terminator uses the empty span at its boundary. A node contributes once per step, regardless of how many operands match it. Matching nonempty chain levels and unary constituents each count. Equal spans count separately, including nested occurrences. Names, declaration order, and production numbers give no priority.

`P` is an exact local predicate (§9.3). Each node test carries `exact`. A node matches by its name or terminal, visible keys or origin, and value. A rule value test requires the certificate of §4. That certificate proves equality to the ordered input join. A written leaf uses its token's value. An omitted leaf uses its resolved default.

The answer depends only on the node's own observations. A rule's visible keys come from its working bag (§3.7). A written leaf matches by the terminal that read it.

That terminal can differ between two derivations of one token, as rule 1 of the lean says. Its tags and value are the same in every derivation, so a test on `_` never separates two derivations at a written leaf. The origin test `_Elided` matches omitted leaves. The step `late #·_<_Elided>` counts those leaves.

For N input tokens, the pairs of boundaries are `0 ≤ p ≤ q ≤ N`. `G_D(P,p,q)` counts D's occurrences of the step over `[p,q)`. Every occurrence contributes once, however many symbols its production has. The occurrences of constituents and written leaves have `p < q`, and the omitted terminators have `p = q`.

Each key step compares two derivations by its counts:

- `leftmost-longest P`: compare the components with `p < q` by increasing `p` and, within one `p`, decreasing `q`. At the first differing count, the greater count wins. An omitted terminator has `p = q`, so it never counts here, and the loader refuses a pattern that requires `_Elided` in this step (§9.3).
- `fewest P`: the smaller sum of all components wins. `most P`: the greater sum wins.
- `late P`: for each boundary `p` from 0 to N, take the sum of `G_D(P,p,q)` over every `q`. At the first boundary where the sums differ, the smaller sum wins. `early P`: the greater sum wins.

The blame measure is `(b,s,n)`. Its components are source blame b, sourceless error count s, and total error count n. Smaller b wins, then smaller s, then larger n. Thus `(0,0,0)` beats every faulty reading. Any number of sourceless errors costs less than one blamed source code point.

If every token that an error occurrence reads has an empty source, the occurrence adds `(0,1,1)`. Otherwise it adds `(L,0,1)`, where L is its source-envelope length under §1, gaps included. Empty sources at different points still receive the sourceless charge, despite their nonempty envelope.

A prefix count of tokens with nonempty sources supplies the all-empty test in O(1) after O(N) preprocessing. Preprocessed source bounds permit an O(1) envelope lookup for each span. Ranking never rescans a span's tokens to compute its charge.

A constituent adds its own charge, its children's measures, and the carried charges of directly read input tokens. A wrapper error therefore adds its own charge even around another error. Overlapping source intervals charge separately, rather than forming a union. A token's carried measure sums the fixed charges of the diagnostics that it carries. Warnings contribute nothing. Display faces add no charge beyond their carrier (§11.4).

An erased occurrence contributes `(0,0,0)` to its parent, whatever its interior measure. Pending diagnostics of earlier stages that emit no tokens add once at stage level (§12.1). That common contribution changes no comparison between the stage's derivations. It does affect whether any error counts for reporting and §7.

The profile starts with these three components, followed by the grammar key counts. A pending boundary obligation retains its proof and measure together. A failed obligation drops both. Every profile comparison uses smaller blame, fewer sourceless errors, and more total errors as the greater profile. Equal measures and equal grammar counts give equal profiles.

A short recovery beats a longer specific error before any grammar preference applies. At equal blame and sourceless count, finer division into more errors wins. Grammar conditions must partition recoveries where that policy otherwise selects an unwanted reading.

With no grammar key step, profiles contain only the measure. The lean ranks equal measures. A nonempty `leftmost-longest` occurrence beats its absence, and a nonempty `fewest` occurrence loses to its absence.

Of two derivations with different profiles, the one with the greater profile beats the other. Of two with equal profiles, the one that the lean prefers beats the other. Without a lean, neither beats the other. A derivation is best if no other derivation beats it.

The verdict counts only admitted derivations with the best measure. If a zero-measure derivation exists, derivations with a worse measure do not count toward the verdict. The verdict is one of these:

- `unique` for one admitted derivation with the best measure.
- `resolved` for several admitted derivations with that measure and exactly one best derivation.
- `tie` for several best admitted derivations with that measure.

Under `unique` and `resolved`, the chosen derivation is the one best derivation. Under `resolved`, it beats every other derivation (below). A tie is an error, and the stage then has no chosen derivation. The production numbers of §3 never decide which derivation a stage chooses.

Only an occurrence makes a component nonzero. A sparse map stores only nonzero components. A shared sorted list with one entry per occurrence is another representation, since equal spans count separately. With no grammar key step, a profile stores only its measure. Clean derivations can share the zero measure.

The stage retains every derivation with the greatest profile before applying its lean. The verdict total counts all admitted derivations with the best measure, before grammar key steps select profiles. That total determines `unique`. The remaining comparison of actions and elisions applies within the forest of greatest profiles.

A derivation is read as its sequence of actions in bottom-up order. An action is a read of a token as a terminal, or a close of a production over a span. Closes of helpers, spliced calls, and productions with exactly one logical symbol are transparent. They are part of the sequence, but two sequences never differ at one. The other actions are visible.

So the closes of flat braces are transparent. The close of a chain's level is visible where its production has more than one symbol (§3.3).

Two reads are the same action when they read the same token as the same terminal. Two closes are the same when they close the same production over the same span.

Transparency removes a close from the comparison, but it does not merge derivations. Two derivations that differ only at transparent closes are still two derivations. With equal profiles, a lean ties them. A step `late #·_<_Elided>` tells them apart where their elided terminators differ (below).

For example, `%rule text [[X]]` derives the empty input in two ways. The outer helper derives ε itself, or through the inner helper. `%rule text [A] & [B]` derives it in three ways, through the expansions of its `&` (§3.2). These use `[A]` alone, `[B]` alone, or both. All have the same empty tree, and every directive reports a tie. The error of such a tie can carry two equal trees, while its witness names two different productions.

`%rule text [[+KU]]` also derives the empty input in two ways. The outer helper is empty, which elides nothing, or the inner one is, which elides `KU`. Their elision counts at boundary 0 are 0 and 1. So the input ties under `greedy` or `lazy` alone, and it is `resolved` under `late #·_<_Elided>`.

The engine does not merge derivations whose trees are equal either. Such derivations can still differ in what the stage does with them. Two definitions of `text` that each read `A` give equal trees, but different output selections can publish different tokens. Their alternatives can also differ in their diagnostic or suppression clauses, or in their bag terms.

A lean compares two derivations with equal profiles at their first differing visible action:

1. If both read the same token as different terminals, they are tied.
2. If one reads and the other closes, `greedy` prefers the read, and `lazy` the close.
3. If both close, with different productions or different spans, they are tied.

If the visible sequences are equal, or one is a proper prefix of the other, the two are tied. For the witness below, their first difference is the first pair of differing actions of the whole sequences, transparent ones included. A derivation whose visible sequence is a proper prefix of the other's differs from it where the shorter ends.

Among equal profiles, a ranking with no lean compares two derivations in the same way, but rule 2 ties them too. Any two remaining derivations that differ are tied. A directive without a lean ranks so, and so does the check of §7 after profiles. In the check, a restoration is a read of its synthetic token and then the close of its empty production (§7.4, §7.7).

`late #·_<_Elided>` compares omitted leaves through their origin (§4.1). The heads in §3.8 define the omitted routes. They also decide which empty optionals become `elided` nodes (§12) and what §7 restores. The counts of this step at each boundary form the derivation's elision vector.

The vector counts each elided terminator once, whatever its terminal or depth. So two terminators elided at one position count two, also when they are of different terminals. An ordinary empty optional, such as an empty `[{x}]`, and a close of any other production count nothing.

An optional that is not elidable (§3.8), such as an optional separator, can still be empty. Its absence counts nothing and leaves no node. The ranking knows no particular terminal. A grammar that excludes a separator from the count writes it as a plain optional, `[CU 🆓]`.

The comparison of a `late` step whose pattern matches omitted leaves alone, such as `late #·_<_Elided>`, can be read as actions. Project a derivation's sequence of actions in this way:

- A close of the helper of an elidable optional that derives ε becomes `elide(p)`, where `p` is its position.
- A read of token `p` becomes `read(p)`, whatever the terminal that reads it.
- The projection drops every other close, and it ends with `end(N)`.

At the first differing pair of projected actions, `read(p)` and `end(N)` beat `elide(p)`. Two `elide(p)` actions at one boundary are equal, as are two reads of one token. Each elided terminator adds its own `elide(p)`, and the projection never merges equal actions. So two elisions at `p` lose to one, because the second `elide(p)` meets `read(p)` or `end(N)`. In plain words, at the first place where two readings differ in leaving out a terminator, such a step prefers the reading that reads on.

So under `late #·_<_Elided>`, a token read as two terminals does not stop the comparison, as rule 1 does. Two different closes do not stop it either, as rule 3 does. The preference does not depend on the age, the nesting or the name of a terminator.

The stage puts the derivations in a canonical order, *T*. *T* orders the ambiguity diagnostics. The canonical tie-break keys never turn a tie into an accepted reading. First, *T* puts greater profiles before lesser ones. Within an equal profile, a lean or no lean compares visible sequences:

- *T* compares them at their first differing visible pair, by rules 1 to 3 where those decide, and otherwise by the canonical keys. The canonical keys put a read before a close. They order two reads by terminal, in code point order. They order two closes by production number, then span start, then span end.
- If one visible sequence is a proper prefix of the other, the shorter comes first.
- If the visible sequences are equal, *T* compares them at the first differing pair of the whole sequences, by the canonical keys. If one whole sequence is a prefix of the other, the shorter comes first.

*T* compares profiles, then visible sequences and whole sequences. So it is a total order. The first reading, `m`, is its least element, whatever the verdict.

Every derivation that beats another precedes it in *T*. This holds for a greater profile and for the lean's preference within equal profiles. Nothing precedes `m`, so nothing beats it. So `m` is best.

A distinct derivation `d` is tied with `m` when `m` does not beat `d`. So `m` is never tied with itself. With a lean, a best derivation other than `m` is tied with `m`, since its first difference with `m` is a tie. The converse does not hold. Without a lean, the derivations tied with `m` are exactly the other best derivations.

For example, take `%rule text A C D | p D | B q`, `%rule p B C` and `%rule q C D`, over the tokens `A B`, `C` and `D`. Under `greedy`, the direct route reads the first token as `A`. The derivation through `p` is tied with it, but loses to the one through `q`, which reads `D` where it closes `p`.

Of the distinct derivations tied with `m`, the second reading is the one that diverges from `m` earliest. It has the fewest visible actions before its first visible difference with `m`. A derivation whose visible sequence is a proper prefix or an extension of `m`'s diverges where the shorter ends. One whose visible sequence equals `m`'s diverges last. *T* orders those that diverge at the same point. That derivation, `t`, is best.

Since `m` does not beat `t`, both have the same profile. A derivation with a greater profile than `t` also precedes `m` in *T*. Nothing precedes `m`, so no such derivation exists.

Without a lean, `t` is best because its profile equals that of `m`. With a lean, the proof is as follows. Suppose that another derivation beats `t`. It is not `m`, since `m` does not beat `t`.

If it beats `t` before `t` diverges from `m`, it beats `m`, which nothing does. If it beats `t` later, it shares `t`'s divergence from `m`. If it beats `t` exactly where `t` diverges, it beats `m` there too, or it is tied with `m` there. This is because an action that beats one tied with `m`'s cannot lose to `m`'s. Either way, it is a distinct derivation tied with `m`, diverges no later than `t`, and precedes `t` in *T*.

So the verdict is `tie` exactly when some distinct derivation is tied with `m`, and then `m` and `t` are two best derivations. Otherwise `m` beats every other derivation, and it is the chosen derivation. In the example, `t` is the derivation through `q`, and the verdict is `tie`. It shows the first point at which the text can be read another way. The witness is the pair of actions at the first difference between `m` and `t`, visible if there is one. It compares the actions themselves, under every rule, and not their projections.

Neither action of a witness is ever missing. Two distinct derivations of one span both end with the close of their root. So neither sequence of actions is a proper prefix of the other, unless a derivation is cyclic, and a cyclic derivation does not count. A library that finds a missing action has a defect, and it fails rather than report one.

A tie is not a success. The result is an error of kind `ambiguous`, with the reason `tie`, and `ok` is false. The error carries two readings, `m` and then `t`, each as a qualified reference (§12). The result's `tree` is null.

The stage keeps its verdict and its witness. It has no chosen root or output (§11), and no later stage runs (§13). Its two shown readings supply errors and warnings under §12.1.

A stage recognizes and ranks its input, then evaluates messages for its chosen derivation or its two tie readings (§12.1). Even with counted errors, a chosen derivation then publishes if it has an output mask. It assigns diagnostic owners under §11.4. A message or emission failure takes precedence over `reported`. If no error counts, including pending stage-level errors, the stage next runs §7.

A tie evaluates its two readings' messages but reaches neither emission nor §7. A grammar error during emission or the check ends the stage with the collection rules of §12.1.

Every ranking rule composes over the packed forest. The packed forest is the shared graph of all derivations of the input, and its nodes are the recognizer's items (§4). An implementation represents derivations through shared summaries and does not need to enumerate them.

An edge of an item is one step by which the recognizer makes it. A start edge predicts an item with its dot at the start, and it combines nothing. A read edge advances an item over a token that its next terminal reads. A completion edge advances an item over a completed item of its next symbol. A read or completion edge has two children: the item before the step, and the token or completed item that the step reads.

A cycle context records ancestor rules over the same span. The context of a child is its cycle context under every ranking rule.

A child cannot reuse an ancestor rule over its own span, or the derivation is cyclic (§4).

Only a rule that can complete again below the child over that span matters. Such a rule is reached from the child's rule through constituents over the same span, and it reaches that rule back in the same way. Such rules form the cyclic group of the child's rule. An implementation can leave every other rule out of the context. Two contexts that differ only in rules that it leaves out give the same summary.

A summary describes the derivations of one item in one context. So an implementation keeps one summary for each combination of item and cycle context that some edge needs. The cycle context is reduced as above. This reduction removes context differences caused by ancestors outside the child's cyclic group. Different ancestor sets within that group can still need different summaries. Two summaries of one item can differ, and a summary keyed by the item alone can lose a reading.

For example, take `%rule text b | a`, `%rule a b` and `%rule b a | A`, over the token `A`. The input has two derivations that are not cyclic, through the two alternatives of `text`. With equal profiles, they tie under every stage rule. Beneath `b` over the same span, `a` has no derivation that counts, since `%rule a b` repeats `b`. Directly under `text`, `a` has one, so a summary of `a` that ignores its context loses a reading of the root.

The derivations of the input are those of every completed item of `text` that spans it (§4). The implementation combines the summaries of all these items as the edges of one root.

Each ranking summary keeps its best measure and the number of admitted noncyclic derivations attaining it, capped at two. This number is its verdict total. A summary without a derivation has total zero and no best measure.

Within one edge, add the children's measures and the edge's own charge. Multiply their totals, capped at two. An edge with no derivation contributes no total. Across edges, keep the better measure in profile order and its total.

Add totals only for equal best measures, capped at two. Worse measures contribute nothing to this total. The root combines completed items by these same rules.

Compute the verdict total before grammar key steps or the lean discard their losers. A total of one gives `unique`. The total remains separate from the count of best derivations after grammar preferences. Boundary states, query eligibility, and cycle contexts remain separate.

A profile composes by addition in each component. Every completed error-bearing source occurrence adds its fixed charge, including a spliced occurrence. A chain adds one charge per error-bearing level. Internal tag variants never multiply the charge. An erased occurrence resets its interior measure and key contributions before supplying its parent.

A completion edge adds its children's profiles and, for each step whose pattern matches the completed nonempty constituent, one occurrence over its span. A read edge adds one occurrence for each step whose pattern matches the leaf. The helper of an elidable optional that derives ε at `p` adds one occurrence at `p` for each step whose pattern matches the omitted leaf.

Adding a common profile preserves comparison and equality, because every key step compares counts by component or by sum. Each summary retains its greatest profile and every edge that attains it, with the same cycle context. The verdict total counts all best-measure derivations, including losers under grammar key steps. It remains separate from the count of best derivations.

With a lean, the action summaries of this section run over the forest of greatest profiles. With or without a lean, both `m` and the earliest-diverging tied derivation compose over the retained forest. An implementation keeps, in each summary, its *T*-least derivation and the earliest-diverging derivations tied with it. It keeps several candidates side by side while their order is not yet settled, since what follows decides. Their order is not settled while one's visible sequence is a prefix of another's. It is also not settled while their visible sequences are equal and one whole sequence is a prefix of the other.

One candidate can beat another under `greedy` or `lazy`. Then the loser's tied derivation stays tied with the winner exactly when it diverged from the loser before the point where the winner beat it. One that diverged there is beaten there too. So the number of derivations, which can be exponential, never matters.

The best count counts best-measure derivations attaining the greatest profile, capped at two. A summary retains its best measure and verdict total beside its greatest profile and best count. Within one edge, the children's profiles add, and their best counts multiply. The edge adds its own completed occurrences. Over one summary's edges, keep the greater profile or add best counts where the profiles are equal.

The root compares its items by the same profile. Without a lean, a verdict total of two with a best count of one is `resolved`. A best count of two is a tie. When two items of `text` each have one derivation with the same greatest profile, this holds too.

The best derivations form a smaller forest. For each summary, the implementation keeps the edges that attain its greatest profile. Each kept edge leads to the summaries of its children, in their own contexts. The stage finds `m` and `t` by a ranking with no lean over that forest. That ranking keeps the same contexts, so it reaches a child only through the summary that its context allows.

Inside one recognition and cycle context, completed erased productions of one rule collapse on equal spans and observable states. Observable state is the completed item's identity (§4) without production, dot, interior prefix states, or captures bound by the erased production. This excludes ordinary captures and captures inside ranked options alike. Frame captures supplied by an enclosing item to a contextual helper remain in its state because its matching depends on them.

The state includes the presence of every capitalized root key, even with no written reader. Payloads matter only for independently demanded early observations. Keep the exported structural identity, restoration state, outer frame and boundary obligations. A restoration observation retains its close records and opaque blocks (§4.2), without named closes that only decide cycle validity. Different observable states remain separate. A capture bound by the erased production cannot distinguish interiors because no parent reads it and its conditions already ran.

The completed structural state and demanded tree identity are the exported observations of §4.1. Private working observations do not distinguish erased classes. Demanded close observations, boundary records, frames and caller modes retain their roles. Two erased roots with `A:"x"` and `A:"y"` agree for erasure alone.

The collapse crosses productions that carry `%erased`, but not productions without that clause. Extensions inherit no erasure. Each collapsed occurrence contributes one derivation to the verdict total. Internally, it chooses the best pre-erasure measure and then canonical action keys, without grammar key steps or a lean. Only its contribution to its parent resets to zero.

The action order is the order of T with grammar key steps and the lean removed. The output shows that kept derivation, never a collapsed alternative.

Each ranking summary also keeps an additional action summary independent of grammar preferences. Its profile contains only the measure. It retains prefix-related candidates until their common continuation settles their canonical action order, as the ordinary action summary does. A common suffix need not preserve the order of prefix-related sequences.

The additional summary composes bottom-up over shared edges, including edges that ordinary key selection discards. An erased parent reads this summary, while a live parent reads the ordinary one. This adds a constant factor through an additional summary channel over shared items and edges. It never enumerates complete derivations.

In reconstruction, two derivations belong to one class only through the erased collapses above. Every choice outside those collapsed interiors remains distinct. Raw witness membership tests concrete W(D) before admission or collapse (§7.10). After admission, membership follows the class containing admitted W(D). Class membership joins across admitted members before canonical interior selection. Keeping another canonical interior does not remove that membership.

For an erased occurrence, outer key steps see its root alone. Thus `late #·erased-sentence` can count the root, but no step counts its proper descendants. Differences within one collapsed class cannot make the text ambiguous. At equal measures, two distinct outer erasure routes still count separately. Their grammar preferences can yield `resolved`.

A step has up to N + 1 boundaries and N(N + 1)/2 spans. So a sparse vector, or a shared sequence of occurrences, keeps the cost of each addition and comparison small.

Pattern matching depends on the step, node kind, rule or terminal identity, and interned tag set. Where the step has a value test, the node's value joins these.

Implementation note: An implementation can memoize the answer by that key.

Implementation note: Before ranking, an implementation can decide for each step whether any node of the stage can match it. A rule atom can match only nodes of its rule. With a tag test, it can match where the test can hold for some tag set that the rule can carry.

A rule can receive visible keys from several possible suppliers. A tag test that holds on the empty set, such as the `<¬Link>` of `#·sumti<¬Link>`, holds wherever its rule can have empty tags. The complete atom still requires a `sumti` node. A value test on a rule atom can hold on some input, so the decision keeps such a step.

The same decision is made per terminal for reads and per elidable helper for omitted leaves. A stage without possible own or carried errors and without matching grammar key steps needs no stored profile components. A wrong "no" changes the chosen derivation. A library that makes this decision must err toward "yes".

Structural state forms part of each summary's item identity. Ranked admission keeps same-span cycle contexts separate (§6.1). A summary cannot substitute an edge from another structural state.

Within each full state and context, retain the best measure and its verdict total, capped at two. Compute that total before grammar key steps and the lean. Outside the erased collapse, equal observations do not merge distinct best-measure derivations. Profiles compose within each full state and context.

For k independent Boolean observations, a product can contain up to `2^k` states. Sequence prefixes and captures add further factors. Finite sharing does not imply constant memory use.

### 6.1 Ranked admission before ranking

Ranked admission filters derivations at each ranked group before the stage ranks complete parses.

Retain the raw chart. Admission removes forest choices without removing chart items or changing input queries. Query eligibility follows §4 before admission. A later completion can provide an earlier qualifying option. Nested availability requires admitted finite child proofs.

A prefix context records state before a ranked group. An admission instance is one written ranked group in one prefix context. Each physical span in that instance has a separate admission group. Its key contains these components:

| Component | Required equality |
| --- | --- |
| Recognition | Input recognition, selected features, and main or reconstruction mode. |
| Source | Final stitched rule, alternative, and expression path. |
| Entry | Enclosing named invocation origin and control route to the helper entry. |
| Prefix | Complete common prefix recognition state at entry. |
| Span | Actual group start and end positions. |
| Cycles | Enclosing named-rule context for relevant spans. |
| Reconstruction | Strictness, restoration, and projection state where recognition depends on them. |

The prefix includes bound common captures, their values, structural state, and its boundary record (§4.2). It also includes each common capture's close observations and the accumulated common prefix's close observations. It also includes each demanded tree identity of a common capture and the demanded partial sequence of the prefix (§4.1). A private identity inside an option stays out of the key.

So two prefixes with different trees never share an admission group, and the continuation after the group can compare the identity with `≅`. Control positions refer to the common group entry. Generated helpers retain their written paths. Option indexes and generated option-production identities do not distinguish entry contexts.

The key excludes private captures, private option bags, private pattern states, proof identities, and the option's open boundary facts. It excludes grammar key profiles, diagnostic ordering, and caller demand contexts. Admission summaries carry measures for their proofs. Measures do not replace boundary facts. Equal-state prefix proofs remain distinct derivations for ordinary ranking.

An invocation is a recognition state, rather than a call-stack identity. Different callers share admission when all key components agree. Different continuations remain separate. Equal spelling at another location does not establish equal spans. Empty spans participate.

Intern each lexical frame description within its recognition. A nested description refers to its canonical parent identifier. It does not quote the parent's complete description again. Admission uses the same identifier within that recognition.

Compute the options with a qualified finite proof in each admission group. Keep a qualified proof unless a higher qualified proof has dominating open facts and a measure no worse in profile order. With no qualifying option, the group supplies no completion.

A qualified proof also passes the step at its group: the advance of the enclosing item over the option's record by the rules of §4.2. Its open facts are what that advance leaves unsettled. For an option that reads no token, they are the option's pending literals that remain after that advance. For a nonempty option after a prefix that read a nonempty symbol, they are the option's end literals and last offers. For a nonempty option after an empty prefix, they are the option's whole record.

Within one admission group, a higher proof excludes a lower proof only with dominating open facts and a measure no worse in profile order. They dominate when, at each edge, the higher proof's literals are a subset of the lower proof's, and their offers are equal. A literal is its edge, direction, target set and sign. The error annotation is not part of it. Wherever the lower proof survives, the higher proof survives too. An excluded proof therefore always has a replacement with the same continuation.

A better measure alone never removes a proof with different undominated open facts. This exclusion applies wherever ranked admission runs, in main recognition and reconstruction. Inside a query, §4 defines eligibility and the optional `.error-free` filter. Equal measures permit the ordinary option-order preference.

The test compares literals by identity. It can miss a logical implication between different literals. Then both proofs stay, and ranking decides. It never excludes a proof that full ranking needs.

For `a ≻ b ≻ c`, qualified `a` can remove `c` without `b`. It needs dominating open facts and a measure no worse in profile order. Ordinary branches within one option share its index. A nested group finishes admission before its option supplies an outer witness.

A candidate must pass its tests and ready conditions in the requested recognition and cycle context. A disabled feature, failed gate, or unavailable cyclic proof supplies no witness.

After admission, ranking summaries retain the best measure and its verdict total, capped at two (§6). The total includes grammar-step losers with that measure. Rank by profile, then by the lean. With no grammar key step, the measure precedes the lean.

Each action summary visits edges retained by admission and its own profile selection. The ordinary summary selects the full profile, while the additional summary selects only the measure. If an error or grammar key step can count an occurrence, profile summaries run. Their internal names and failure messages identify profile summaries. Admission needs existence counts. The separate ranking pass supplies witness membership where reconstruction requires it.

Without a lean, a best count of two agrees exactly with a second tied derivation. A disagreement is a library defect. Admission records each group that retains a lower proof beside a qualified higher proof at most once per ranking. Recording that fact takes constant expected time per group.

Outside observations of either restoration method retain the same opaque group block for every option. A qualification inside an option can read its private closes. A late expression can read a winning private binding in its scope. The admission key includes demanded common restoration observations and excludes all private closes. Thus an aligned outside condition gives the same answer for each admitted proof of one block.

Every proof that admission excludes has a qualifying same-context replacement at the group. The seal and the common early observations preserve its continuation. Induction through finite admitted child proofs preserves recognition with sealing fixed. Adding a seal can change outside pattern answers.

[Ambiguity](notation.md#ambiguity) defines how filtering and seals affect results.

Let F count stored prefix facts, completion facts, proof edges, query eligibility contexts, and their values. Sorting admission groups costs `O(F log F)` key comparisons. A group with g qualified proofs needs at most g² dominance tests. Each test compares literal bit sets and offer sets. Records bound the number of distinct open facts per group by the grammar's K (§4.2).

Admission composes over packed facts without complete derivation enumeration.

The export proof follows every demanded early dependency through the active options and their effective suppliers.

## 7. Elision-only

### 7.1 When the check runs

The check is on where the stage declares `%elision-only` or the caller asks for it. When it is on, it runs for `resolved`. It also runs for `unique` when the chosen tree holds an elided node. A resolved stage runs the enabled check even when its chosen tree elides nothing. The check runs after the stage completes publication or finishes its tree (§6, §11).

Any counted error skips the check, including a carried error or an earlier stage-level error. A publishing stage still emits (§11). A tie never reaches the check, because a tie ends the stage first. The check does not run for a unique tree with no elided node. An error of the grammar found during emission ends the stage before the check. A caller can switch the check off for a stage that declares it.

Uniqueness counts the original input's admitted derivations with the best measure (§6). Readings with worse measures never change that verdict or start this check. Restoration can create another derivation. For `%rule text "a" [+T] | "a" T`, input `a` has one derivation, with `T` elided. After restoration, the optional and the bare `T` both read the synthetic token. Their profiles are equal, so the check fails.

The check follows the decision order of §7.10. It chooses no replacement derivation and examines no other restoration.

The check uses the main parse's lowered grammar, features, classifiers, constants and Unicode table. It does not lower the grammar again, and it does not run earlier stages again.

Aligned queries reuse this section's synthetic-token representation and projection. They do not use its complete recognition policy. They preserve original query eligibility, forbid bare synthetic reads, and permit ordinary omissions beyond their fixed capture. They select no replacement tree and perform no elision-only ranking.

### 7.2 The two inputs

Let O be the stage's input, N tokens long. Here the input is what this stage reads: the output of the stage before it, or, for the first stage, stage-zero or caller-supplied tokens. Let G be the grammar lowered for the main parse, and D the chosen derivation.

Take D's elided terminators (§4, §12) in leaf order, from left to right. Keep this order for terminators at one position. Each one gives a restoration record. The record holds the terminal, its position `p` in O and the empty source of its elided node (§12). For a terminator with a default value (§3.8), from `≝` or from an equality test, it also holds that value.

The reconstructed input R is O with one synthetic token for each record. The synthetic token stands before the input token at `p`, or at the end for `p` = N. Records at one position keep their order. Every token of O stands in R once, in its order, with all its fields unchanged.

A synthetic token has recognition tags and a recognition value. Its recognition tags are its terminal alone. Its recognition value is the default value of its record (§3.8). Without a default value, its recognition value is the empty string. Its synthetic image is empty.

Synthetic tokens carry no diagnostics or charge. They belong to reconstruction only.

Each token of R has a provenance, which the engine keeps to itself. It is an original token, with its index in O, or a synthetic token, with the index of its record. Nothing else tells them apart. An earlier stage can emit a token with an empty span, an empty source, empty text or `insertedBy` (§11). Such a token of O is still an original token.

### 7.3 Projection

For a position `k` of R, from 0 to the length of R, π(k) is the number of original tokens before `k`. So π(0) is 0 and π of the length of R is N. π stays the same across a synthetic token and goes up by one across an original one. A span [a, b) of R projects to the span [π(a), π(b)) of O.

The recognizer reads R, and its items, spans and cycles are in positions of R. Every observation (§7.5) reads the projected span, in positions of O. A span of R that holds only synthetic tokens projects to an empty span at its position.

A projected span is a span of O like any other. Its text and value come from its own tokens, as §5 says.

### 7.4 The reconstruction mode

The check recognizes R with G in the reconstruction mode. The mode adds no productions and removes none. Every production keeps its number, its rule and its clauses. Only these steps differ from §4.

An elidable optional (§3.8) has a helper `h`, including `[$j:+T]`. Its enclosing expansion retains the selected helper route. Its productions are the empty production `h → ε` and the productions of its content, each of which begins with the optional's terminal `T`. In the reconstruction mode, the helper reads in one of three ways, its routes:

1. The restoration. The empty production reads exactly one synthetic token, the one at its position. The token must be compatible with the optional.

   Its recognition tags hold `T`. The omission predicate must hold. Where T has a test, it must pass on the token's recognition value and recognition tags. The restoration is a read of that token as `T` followed by a close of the empty production over its one-token span.

The restored route gives an omitted leaf with the saved default. The written-only capture remains empty.

2. The written route from an original token. A production of the content reads its `T` from an original token, and then the rest of the production as §4 says. The rest can be empty.
3. The written route from a synthetic token. A production of the content reads its `T` from a synthetic token, which must pass `T`'s test as in the restoration. Then the rest of the production must read at least one token of R, original or synthetic. The item after `T` is strict (below). This holds whatever the strictness of the item that read `T`, and also where an ordinary prediction shares the item that read `T`.

Every production of the helper belongs to that elidable helper for the purpose of the routes, its content productions as well as its empty one. So a synthetic token followed by nothing else of the optional is always the restoration, and never a second derivation of the same omission. A synthetic token followed by more of the optional is the written route, which can read original tokens, later synthetic tokens, or both. An optional that is not elidable keeps its empty production as in §4. §3.8 alone decides which optionals are elidable, and this section does not change that.

For `[$j:+T]`, only route 2 binds `$j`. Route 1 retains the empty expansion without `$j`. Route 3 cannot apply because the optional has no rest. The same pairing controls capture presence in main recognition.

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

A strict prediction never predicts a production that can read nothing. A strict item never advances over an empty constituent unless a later symbol can read. So a strict item evaluates nothing past its production's last reading symbol. It evaluates no bag of its own production, and no condition that becomes ready at its end.

An earlier advance over an empty constituent can still make a condition or a test ready. The engine evaluates it where a later symbol can read by the grammar, whether or not that symbol reads this input. So such a condition can end the check with an error of the grammar. This holds also where the rest of the optional reads nothing in this text. Its conditions, tests and demanded properties are evaluated as in §4.

A terminal outside that head can read a synthetic token by its saved terminal. It binds one omitted leaf, with its resolved default, empty image and projected empty span.

In every derivation of the mode, each elidable optional is either restored or written. Leave the observations of §7.5 aside, and compare the mode with a reading of R in which every elidable optional is mandatory. They differ in two ways only:

- A restoration needs no rest of the optional. So the restoration exists also where the rest cannot be empty, by its symbols or by its conditions.
- A synthetic terminator with an empty rest is one derivation, the restoration. The number of empty derivations of the rest does not matter.

The mode removes no other derivation. Strict items remove only paths on which the rest reads no token. Every production that can read, a restoration included, stays open to a strict prediction.

### 7.5 Observations

Project each occurrence's span onto original tokens before reading input methods. A span's tokens, truth, flags and classes come from that projected window. A span with only synthetic tokens is empty. A node bound at that span is still present.

A written leaf retains its input bag. An omitted or restored leaf has its terminal key, resolved default and empty image. A bare synthetic read binds one omitted leaf. This binding participates in working children even though its span contributes no original input token.

A terminal value test reads the leaf's value. A rule value test uses the certificate for the reconstruction mode. An explicit input join ignores synthetic tokens. A child join can include their defaults, so a nonempty synthetic default can defeat the certificate.

Patterns compare omission origin and terminal identity independently of the default. A value pattern can inspect that default. Structural equality of two omitted leaves compares their terminals regardless of the defaults. Use `_Elided` only as an origin test.

Neighbor offers use projected boundaries. A node counts only if its projected span is nonempty and both ends of its physical span are original tokens. A synthetic terminal alone supplies no offer.

A candidate owns its projected closes and their order. Each synthetic terminal read supplies one close at its original boundary. A restored optional supplies one close in total, with no second close from its transparent helper. A ranked block hides the private closes within it. Nested aligned queries use this candidate's closes and original context.

### 7.6 Nested queries

An ordinary nested query that the check starts reads the tokens of `s′`, the projected span, in O. It runs with G in its ordinary mode, as in the main parse. In that mode every elidable optional is an optional. The query reads no synthetic token, and its own nested queries do the same. It follows the query policy of §4.

Written-terminator priority applies to the tokens that it reads. It does not rank its proof trees, and it emits nothing.

Inside the query, `.starts-input`, `.onward`, `.preceding-tokens`, and `.following-tokens` read the query's span of O. Its start and end are positions of O.

A query is about a rule and a span of O. For the recursive-query rule of §4, every `parse` of one rule and span, in any mode, is one query. The rule is unchanged. A query is an error of the grammar where a query about the same rule and span is active. Only queries are active.

The reconstruction's recognition of R is not a query. This holds also where the span of `$` projects to all of O and the query asks about `text`. So a condition of the reconstruction can ask whether the original input parses as `text`. That query runs with G over O, and it is active while it runs. It is an error only where a query inside it asks about `text` over all of O.

A whole, prefix, or tag query over an explicit restored span follows the aligned rules of §4. It fixes the current reconstruction candidate's projected closes, rather than inheriting the outer reconstruction script. Active-query errors still use the shared stack and projected original context. The mapped original witness preserves its candidate closes and query answers.

`$x.flags` reads the visible keys of the capture. A query's `.flags` uses the union over its eligible roots.

### 7.7 Recognition, cycles and ranking

The check recognizes all of R, from the start rule `text`, in the reconstruction mode, with the observations of §7.5. A reconstruction derivation is finite, satisfies every test and condition, and follows the restoration and strictness rules of §7.4 and §7.5.

Cycles are found over spans of R, as §4 says. Two constituents of one rule whose spans of R differ are no cycle, even where both project to one span of O.

If reconstruction has no root or no walk for W(D), the check reports witness loss without preparing admission or ranking.

Locate concrete raw W(D) before applying ranked admission or erased collapse. Admission groups options by their physical spans in R, including synthetic tokens. The reconstruction rules, including the omission ban and strictness test of §7.4, still apply. Equal projected O spans do not establish equal admission spans. Rank admitted derivations by profiles over projected spans `[π(a),π(b))` in O. Reconstruction summaries retain their best measure and its total, capped at two, under §6.

No lean applies, whatever the directive ends with. The measure remains the first profile component. An error occurrence uses its projected original token sources under §6. A synthetic token has an empty projected source and no carried charge. An error over synthetic tokens alone therefore adds `(0,1,1)` before erasure. Each grammar key step ignores occurrences whose projected spans are empty.

Reconstruction evaluates no diagnostic message. So a restoration and a bare synthetic read count nothing, whatever pattern matches them. A step that matches omitted leaves alone decides nothing in the check.

The check ranks a traversal of the actual admitted derivation over projected spans, without the seals of condition patterns. So every nonempty rule node and original read inside a ranked option keeps its contribution. Distinct occurrences with equal nonempty projected spans each contribute separately. Reconstruction admission has its own cache and preserves restoration, strictness and projection rules.

A restoration's read of its synthetic token is a read action, and its close is the close of a helper, which is transparent. Section 7.10 selects the error's readings. The canonical keys never turn a tie into a pass. Derivations whose trees are equal over O are still distinct derivations.

An error of the grammar met while the check recognizes R is the result's error, as one met while emitting is (§11). This includes an error in a competing derivation that only the check reaches. The stage keeps its verdict and warnings, but it has no output. The result's tree is null.

W(D), the restored witness (§7.8), keeps D's zero measure. Grammar key steps omit occurrences with empty projected spans in both profiles. Every other occurrence projects to its original span. Section 7.10 gives the decisions for witness loss and competing readings.

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
4. Each original leaf keeps its bag, and each restored omission exposes the same terminal key, default and empty image as in D.
5. Each condition and test of W(D) reads the same projected observations as in D. A nested query keeps its original input and alignment policy.

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
 "chosen":[0,0,0],"completion":[{"terminal":"KU","at":3,"source":[9,9]},{"terminal":"VAU","at":5,"source":[16,16],"value":"vau"}]}
```

The stage's name stands for `syntax` in `stage` and in `message`. `chosen` is a qualified reference to D's tree over O. This example uses stage index zero. `completion` lists the restoration records in the order of the tree's leaves (§7.2). Each record has these members, in this order:

- `terminal`, the terminal.
- `at`, its position in O.
- `source`, the empty source of its elided node.
- `value`, the default value, only where the terminator has one (§3.8), from `≝` or from an equality test.

The error has no `token`, `source`, `line`, `column`, `expected`, `reason` or `readings`.

`ok` is false and `tree` is null. The stage keeps its verdict, `unique` or `resolved`, and its warnings, but it has no output, and no later stage runs. An error of the grammar met during the check is never this error.

The message is the same in every library. Section 7.10 gives witness loss priority over every passing or ambiguity outcome.

### 7.10 Readings

This policy applies to every grammar, including grammars without ranked groups or key steps. Raw witness membership tests concrete W(D) before admission and erased collapse. After admission, membership follows its class under §6. A class represents W(D) only through an admitted reconstruction of W(D), independently of the class's kept interior.

Runtime witness tracking is mandatory. It records class membership separately from the kept interior's edges. An optional observer only inspects the result and never supplies the runtime witness marks.

If recognition ends without a grammar error, decide in this order.

1. Locate concrete W(D) in the raw reconstruction forest. If it is absent, report `elision-witness-lost` (§7.9).
2. Apply ranked admission without preserving W(D) artificially.
3. Collapse equivalent erased interiors and rank admitted classes by projected profiles without a lean.
4. If the class containing admitted W(D) is the sole best admitted class, preserve the main result.
5. Otherwise, report `ambiguous` with reason `elision-only`, with W(D) first and one competitor second.

The competitor comes from the T-first best admitted class that does not represent admitted W(D). If admission excludes W(D), the competitor comes from the T-first best admitted class. The kept representative supplies each admitted reading's tree and actions. An excluded W(D) remains the concrete raw restored reading. Transparent actions remain part of T (§6).

A smaller filtered best profile does not prove witness loss. Intentional exclusion gives an expected ambiguity.

A competing reading never replaces D. Both reported trees and their action witness map to O. Distinct reconstructed derivations can display equal trees.

In every ambiguity outcome, the result's `tree` is null. The stage keeps its verdict, warnings and any completed publication. A tree-only stage has no output. The error has no `token` or `source`. Section 7.9 gives the result fields for witness loss.

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
- A rule node stores the projection of its span and source. The ordinary empty source rule applies at a projected empty boundary.

Reconstruction evaluates no messages, output items or display faces. Written leaves display their existing input faces.

### 7.11 Switching the check off

A caller can switch the check off, or on, for every stage that runs (`docs/api.md`). That choice changes nothing in recognition, ranking or emission. It only decides whether §7.1 to §7.10 run.

## 8. Reading grammar documents

A grammar document is Markdown. Its grammar text is the content of every fenced code block whose info string is `jbogenbau`, in order. A fence is a line of three or more backticks or tildes, indented by up to three spaces, followed by the info string. An opening backtick fence whose info string holds a backtick is not a fence, as in CommonMark. The reader knows no other Markdown container. So a block can stand under a list item indented by two spaces, as a pipeline's `%include` blocks do, but not deeper.

The info string is `jbogenbau` after the reader removes leading and trailing White_Space from the configured Unicode table (§1). A block ends at a line that holds only a fence of the same character, at least as long. The fence is indented by up to three spaces, and only White_Space from that table follows it.

An unclosed `jbogenbau` block is a document error. The reader reports it at the column of its opening fence character. Any other unclosed block runs to the end of the document, as in CommonMark.

The reader joins each block's lines with `\n` and joins the blocks with one `\n` between them. Every line end inside a block reads as `\n`, whether the document uses LF, CRLF, or CR. Every character of the grammar text keeps its line and column in the document. An end-of-text error stands after its last character. An empty final block does not move that position. A line that adds no character to the grammar text does not move that position either.

The reader parses grammar text with the notation pipeline, `grammars/gencmu/jbogenbau/pipeline.md`. Its preparsed documents ship in `data/preparsed/gencmu.json`. The loader splices their DOMs under §13 to build the notation stages. Bootstrap entries need no source files or text hash comparison. Every required entry must exist and meet the DOM rules. An invalid format, malformed entry, missing include, or splice error is a bootstrap loading error.

The rules in §9 turn the notation tree into a document DOM. The bootstrap can therefore read every grammar, including its own documents. Reading those documents must reproduce their preparsed entries exactly, the bootstrap fixpoint. `tools/sync.js` regenerates the entries until this holds.

The grammar text is a text like any other, so stage zero decomposes it. Line and column numbers still count the code points of the document as written.

Calls, parameters, and patterns use the same reader constructors as ordinary declarations. Their presence never changes local checks or diagnostic precedence. Source positions stay on the nodes that produce them.

Cached and supplied DOMs use the same node decoder and validity checks for ordinary syntax, calls, parameters, and patterns. Each rewritten definition is decoded once. Later inspection and runtime output use that same decoded definition. The inspection before rewriting in §2.3 is a separate step.

Structural checks precede decoding. Later definition checks use the decoded nodes and their effective rule names.

Decoding retains every declaration and its children as typed nodes, including declarations that still need template expansion.

One validator handles ordinary nodes and source nodes. Calls and parameters retain their scopes, argument categories, and local shape restrictions before expansion.

The document retains one declaration representation. Cached diagnostic recovery reads the source once. It copies private positions between typed nodes and preserves every public cached member.

Each ranked-choice node retains the position of its first `≻`. Expansion carries that position with the node, including nodes inside call arguments.

A tie in either stage of the notation pipeline, `lexical` or `syntax`, is an error of kind `grammar` of loading (§6). The error names the document. It has no line and no column, since an ambiguity has no single position. Its message names the notation stage and says that the grammar text is ambiguous. A library never puts such an error at the start of the document in place of a position.

Every bootstrap failure names `data/preparsed/gencmu.json` in its structured document field and its message. Reading and schema errors have no stage, line, or column. Splicing errors have no stage field. For a stage without rules, the description is `stage NAME: has no rules`. Other splicing errors retain their descriptions without an added stage prefix.

The splicer marks empty-stage errors with a private problem kind. Bootstrap handlers select that kind without inspecting message text.

Stitching and lowering errors name the stage that failed.

If the failure has a definition location, its structured line and column retain that location. The message always appends the embedded document at that location. A failure without a definition location has no structured line or column.

The standard error formatter adds the document, position, and stage from structured fields. Bootstrap errors use this same formatter. Their underlying message appends the embedded document without duplicating the location prefix.

Bootstrap splicing follows the same include order and stage rules as any other pipeline. It consumes `stage`, `include`, `names`, and `features` directives before stitching.

Before the loader stitches any stage, it makes sure that every required bootstrap DOM meets the DOM rules. Each stage must contain at least one rule. The loader then stitches every stage in order with the normal stage validator.

Next, the pipeline validator makes sure that feature roles agree across all stitched stages. Finally, it lowers the stages in order. A later stitching error therefore precedes an earlier lowering error.

A feature-role conflict names the stage and definition that introduce the conflicting role.

These locations concern embedded definitions, not lines of the bootstrap JSON. The CLI reports the same bootstrap attribution.

A notation stage follows the same publication and elision rules as other stages.

Each stage of the notation runs as any stage does (§4 to §7, §11, §12). So each notation stage runs the check of §7 where it declares `%elision-only`. The bundled notation declares it in no stage, but a caller's own bootstrap can (`docs/api.md`). An ambiguity that the check finds is an error of the document in the same way as a tie. The error names the document and the notation stage, with no line or column. The caller's option for the check (`docs/api.md`) does not reach a notation stage, so it neither switches the check on there nor off.

Each family has one preparsed file, `data/preparsed/FAMILY.json`, for the documents below `grammars/FAMILY/`. The required `gencmu.json` supplies the bootstrap. A loader reads only the optional file that each document key selects, besides that required file. A missing, malformed or mismatched optional file gives cache misses. Once a current document meets the cache identity rules, decode it under the supplied-DOM rules. An illegal record reports its error without falling back to source.

A document key under `grammars/FAMILY/` selects `data/preparsed/FAMILY.json`. Other document keys select no optional file. A loader can still reuse DOMs that it reads through the notation, under the complete identity below.

The bootstrap fingerprint is the 64-bit FNV-1a hash of the complete UTF-8 text of `data/preparsed/gencmu.json`. Its own header omits `bootstrap` to avoid a circular fingerprint. Every other family's header records that fingerprint as `bootstrap`. The required entries load even when custom Unicode resources differ from its header. Ordinary entries still require the full cache identity.

Implementation note: An implementation can keep the DOMs that it built before.

A cached DOM's key includes document text hash, bootstrap fingerprint, core-table fingerprint, properties fingerprint, and DOM format version. Any mismatch gives a cache miss. Each table fingerprint is the 64-bit FNV-1a hash of its UTF-8 text, written as the document hash is.

Even without explicit property references, every document cache requires the properties fingerprint. With no companion for a custom core, it is `null`. An absent member or a different fingerprint gives a cache miss. Prepared stages and scalar-profile caches also distinguish the complete core and properties resources. A custom properties file therefore invalidates bundled cache entries with a different fingerprint, including entries for documents naming no additional property. This unavoidable cache cost preserves table-dependent notation semantics.

When source conversion loads names data, the cache writer records a `names` map for that document. It maps `data/unicode/unicode-names.txt` and every selected extra's normalized resolved path to that resource's text hash. Paths use the same namespace as cached documents. Map keys use code-point order. Hashes use the same algorithm as document hashes. Numeric escapes and core abbreviation escapes alone require no names map.

After ordinary identity inspection, the loader uses the entry's dependency metadata. A preliminary scan can inspect local names declarations. Once the loader selects the document, its complete shape and semantic errors stay visible. If `names` is present, it compares the selected paths and fingerprints before accepting the entry. Bundled resources can use the fingerprint registry below without file reads.

If `names` is absent, the loader skips names-path and names-hash comparisons and loads no names data for that entry. A cache hit needs no source token scan or escape inspection.

If `names` is present, the expected resource set contains `data/unicode/unicode-names.txt` plus the current inherited and local extras. Local declarations come from the shape-valid cached DOM. All paths use their normalized resolved form. This is the same set that the cache writer records. A path-set difference or required resource hash difference gives a cache miss. Invalid selected declaration records fail under the same rules as supplied DOMs.

If `names` is absent, the loader skips this comparison and keeps the otherwise valid entry. Local and inherited declarations still supply the resource scope for nested includes. If the map is present and comparison requires file loading, missing or malformed names data is a loading error. Printer abbreviations affect the core-table fingerprint, rather than the names dependency.

Shared cache cases require a hit when the complete base-and-extras set and all hashes match. If `names` is present, a changed extra path or hash gives a miss. An absent `names` member permits a hit despite changed or missing unused extras. These cases keep every other cache dependency equal.

`data/preparsed/FAMILY.json` records the fingerprint of the bundled table and a `bundledNames` registry of bundled names resources. The generator records `data/unicode/unicode-names.txt` and every bundled extra by normalized path, with keys in code-point order. It hashes their pinned text, never a caller's replacement. The hash is 64-bit FNV-1a over UTF-8 bytes, written as 16 lowercase hexadecimal digits. Each package ships the preparsed files beside its Unicode resources under `data/`.

The shortcut requires the active core to declare the bundled names version, 15.1.0. A different version is a grammar loading error. For an unoverridden bundled resource, the loader takes its current fingerprint from `bundledNames`. It compares that fingerprint with the document entry's `names` value. If every selected resource uses this route, a cache hit reads, parses, and fetches no names file. Supplied resources count as overrides, even if their bytes match the bundle.

A supplied file always takes priority over registry metadata. A disk file outside the package bundle counts as an override. An absent source-map key can select its registered bundled fingerprint for cache comparison. This also permits portable cache hits without bundled names text. A miss still requires the selected file text before source conversion can use names.

If any selected resource is overridden or lacks a registry entry, the loader reads and inspects the complete selected set. This includes the pinned reference for a custom base or extra. Path-set and fingerprint differences give cache misses. A malformed registry prevents this shortcut but does not invalidate an otherwise usable document entry. If `names` is absent, no registry comparison or names-file loading occurs.

Shared cases require bundled names-dependent hits with zero names-file reads, even for a zbalermorna pipeline. They also cover a missing registry, overridden resources, mismatched hashes, and lazy playground fetches after a miss.

A DOM stores written declarations and unresolved references. It holds no effective constants, types, classifier indexes, gate results or lowered productions.

## 9. From notation tree to DOM

### 9.1 Lexical forms

The lexer selects the longest punctuation token. `...`, `..`, `.` and `…` mark a chain, range, method and query remainder respectively. `→` introduces a bag term. `^` marks a primary. A colon binds a capture or separates a bag key from its value.

`++` concatenates strings. In an expression, `+` adds counts. At an elidable head, it marks the terminal. Spaces and comments cannot interrupt compound punctuation.

The lexer reads maximal names before the reader inspects them. A name stops before `--`, which starts a line comment outside strings. LF, CRLF, CR, or the file end terminates the comment.

Strings take priority, so quoted `--` stays literal. No block comment form exists. A lowercase name matches `[a-z][A-Za-z0-9_-]*`. An uppercase name matches `[A-Z][A-Za-z0-9_-]*`.

An underscore token starts with `_` and consumes the maximal run of ASCII letters, digits, and underscores. It also consumes a dot directly between two ASCII digits. Thus `_age_15.1` is one token, while `_Alpha.first-token` ends the tag before the method selector.

`_` alone is the wildcard and carries no `Engine-Tag` tag. An engine-tag token requires a nonempty name after `_`. A name in §1 is an engine tag. Any other underscore token is a document error at that token.

Thus `_lu`, `_Letter`, and `_Lux` are each one invalid token. None splits into a wildcard or engine tag followed by a name. An emoji rule name contains exactly one scalar with `Emoji_Presentation=Yes` and `Emoji_Component=No` in the configured Unicode table.

The bundled version is Unicode 15.1.0. Each scalar with those properties is its own token. Adjacent emoji names do not combine.

Variation selectors, modifiers, regional-indicator pairs, and ZWJ sequences cannot form names.

Emoji names work wherever rule names work, including template heads and calls. They cannot name tags, stages, constants, captures, features or parameters. `#` starts a pattern and never names a rule. `@` starts a parameter and never starts a pattern. `/` is the brace separator.

`^` marks the primary. `~` is unused.

A parameter token is `@` followed directly by `[A-Za-z][A-Za-z0-9_-]*`. A bare `@`, separated name, or `@(` is a lexical error. A call-name token is a rule name immediately followed by `(`. A splice uses `*` directly before that name or call-name token.

The call-name token contains the name only. It can name a call or a call-shaped rule head. Method and keyword constructors can consume it in their name positions.

It never reads directly as a reference, ordinary rule name, or bare pattern name. Whitespace or a comment before `(` prevents this token. Child-list attachment has its own adjacency rule below.

A capture token matches `$[a-z][A-Za-z0-9_-]*`, or `$` alone. Its name must match `[a-z][a-z0-9_-]*`. `$fooBar:A` therefore reports the capture-name error at `$fooBar`. A user constant reference is `$` followed by an uppercase name.

An Integer token is a nonempty run of ASCII decimal digits. Section 9.3 defines its validity as a method argument.

String delimiters are straight double quotes. Dollar signs and backslashes are ordinary characters. A string contains literal runs and `‹…›` escapes. Literal runs use stage-zero decomposition, while decoded escape scalars remain exact. The reader joins those parts without further normalization.

Lexical string tokens retain their quotes and escape spellings. The lexical grammar accepts their raw interiors without interpreting escapes. After lexing, inspect escapes before syntax recognition. This step loads names data only as needed. During DOM conversion, the reader removes the quotes and decodes the original escapes exactly once.

Resource-path tokens follow the same rule, with original literal runs. Token source positions and texts retain the written spelling.

An escape starts at `‹` and ends at the next `›`. It contains `U+` and four to six hexadecimal digits, a formal Unicode name, or a name alias. Non-numeric lookup first tries the core abbreviation map. Other names require the selected lazy names resources.

Names match exactly, including case and spaces. A numeric escape accepts either case for its hexadecimal digits, but requires uppercase `U+`. Every escape must resolve to one scalar. Escape errors arise during the separate inspection step, before syntax recognition or reader inspection.

A literal `‹` requires an escape. Without an open escape, `›` is literal. An escaped quote remains inside the string and cannot close it. Decoded delimiters never start another escape, comment, call, or pattern. An empty escape, unknown name, missing closer, quote, or line break within an escape is an escape-inspection document error at `‹`.

An include or names-resource path is the first and only operand of `%include` or `%names`, in straight double quotes. Its literal runs preserve the original text without decomposition. Its escapes use the ordinary string decoder. Path resolution uses the decoded result. Paths use separate tokens because loading selects resources before constant binding.

A feature name matches `[A-Za-z][A-Za-z0-9-]*` without `--`. All identifier tokens stop before `--`, including capture, constant, parameter, and keyword names. Supplied DOM names must meet that same exclusion. A gate is a feature name followed by `?`, with an optional initial `¬`. No space or comment stands inside a gate. A capital-initial feature such as `Cbm` is legal.

The lexer reads `¬` and `?` separately. At the start of an alternative or entry prefix, the reader recognizes an adjacent gate. A supplied gate uses kind `gate` and a valid feature name.

Whitespace and line comments separate tokens but add no grammar node. A comment and its newline supply whitespace for symbol tests and pattern attachment. Comments discard their contents, including backslashes, without escape processing.

Pattern child lists use `⁅` (U+2045) and `⁆` (U+2046). If no whitespace or comment separates a node test from its following list, that list must attach to the test. Otherwise, the list begins a separate bare-list pattern. The prefix `·` U+00B7 must directly precede its node atom or bare list. It never prefixes a grouped or compound pattern. Neither a second list nor a list after a group attaches to that group.

Between child items, `⁅` or `·` requires separation after a node test, `⁆`, `]`, `}`, or a group's closing `)`. Whitespace or a comment supplies that separation. A call's first adjacent child list belongs to that node test and remains attached. Thus `a⁅ b ⁆` is one node, while `a⁅ b ⁆⁅ c ⁆` and `(a)⁅ b ⁆` are errors. `a·⁅ b ⁆`, `#⁅ [a]⁅ b ⁆ ⁆`, and `#⁅ {a}·b ⁆` are also errors. `#⁅ [a] ⁅ b ⁆ ⁆` and `#⁅ {a} ·b ⁆` are valid.

Punctuation separates adjacent names. A tag test can precede one value test, as in `_<Stressed>≠"y"`. Thus `$x:A<B>` is a capture of a tested tag terminal. `$x : A < B >` has the same meaning.

Canonical string diagnostics expand user constants and concatenations, then write the result as one quoted string. An empty string uses `""`. The printer does not insert concatenation operators. Dollar signs and unmatched `›` have no escape role by themselves.

The printer escapes a quote, control, format scalar, nonspacing mark, private-use scalar, decomposable scalar, or scalar of nonzero combining class. It also escapes Hangul syllables, `‹`, and every configured White_Space scalar except U+0020. The exception removes only this whitespace predicate. Another predicate can still require an escape under a custom table. Section 1 defines the predicates and their data sources. All other scalar values appear literally, including backslashes.

If the core table supplies abbreviation aliases for a scalar, the printer chooses the shortest, then ASCII order on equal length. Other alias kinds remain valid input but never supply canonical output. Without a core abbreviation, the escape uses `U+` and uppercase hexadecimal digits. The number has at least four digits, without unnecessary leading zeros. For example, canonical newline is `"‹LF›"`, and canonical U+0301 is `"‹U+0301›"`.

With bundled data, a space remains literal, a tab uses `‹HT›`, and U+00A0 uses `‹NBSP›`. U+2003 uses `‹U+2003›`. A backslash prints as itself.

A range's identity is its resolved pair of scalar endpoints. Its diagnostic spelling joins the canonical spellings of its endpoints with `..`. A tag terminal's identity and spelling are its canonical name. Tests never alter terminal identity.

### 9.2 Syntax forms

The notation parser recognizes the complete document before DOM conversion. Syntax errors take precedence over conversion errors after lexing and escape inspection. The productions below define recognition. The [DOM tables](output.md#a-grammar-dom) define the portable records.

A body uses factors, sequences, ordered subsets and choices. A statement term requires a leading bar before the first alternative. A factor can be marked as the primary. Resolve the tested symbol after substitution. Put a captured terminator inside its optional.

A rule term starts with `→`. The primary mark `^` precedes its body symbol and any capture label. A statement term before the body requires the leading alternative bar. `%emit` introduces an output clause. `%const` and `%redefine-const` introduce constant definitions, including stage constants. `%conditions`, `%features`, `%error` and `%warning` keep their own expression contexts.

Read `'`, `.`, `!`, `↦` and `↓` as property access, method access, map, binding and flattening. Only double quotes delimit strings. Use the existing string escapes, name alphabets and Unicode operator aliases. Read the longest punctuation first, including `++`, `..` and the remainder spelling `...`.

A dot between digits in an engine name belongs to the name. A decimal integer uses ASCII digits. Only zero starts with zero.

A dollar sign introduces a rule occurrence, a capture, a bound argument or a constant. A named capture starts with a lowercase letter. A constant name starts with a capital. `$F(` opens a function call. A lowercase grammar name immediately before `(` opens a template call in a grammar context.

`@` introduces a template parameter. A feature name starts with a letter and continues with letters, digits or hyphens.

Tokenize `¬` and `?` separately. Assemble a gate only at the start of an alternative or an entry prefix. Require adjacency throughout the gate. Let `Cy` be a bare or absent key of `$x`. In `{$x'Cy? Onset}` the receiver and property already start a guard.

Its question mark ends the guard. A guard permits layout before its question mark. After a dot the reader accepts the name token for a method, including an adjacent call opener. The map takes the following selector or parenthesized predicate.

The enclosing production selects the reader. Braces and brackets in a body denote repetitions and optionals. The same delimiters in an expression denote bags and lists. Braced items in `%emit` contain constructor entries.

A bar in a body, pattern or neighbor choice stays inside that operand. A conditional owns the bar after its question mark at the same depth. Split commas only at the current delimiter depth.

A template argument that passes an expression starts with `=`. Thus `ordinary-word(= {Run-Initial}, split-first-y)` passes a key set. An unmarked braced argument passes a body repetition. The rule also distinguishes a list from an optional and a conditional from a grouped body. See [Parameterized rules](notation.md#parameterized-rules).

#### Document and body grammar

The following EBNF describes recognition. Quoted text denotes tokens. Brackets mark optional forms, and braces mark repetition. A production name identifies a tree part. `first(…)` selects the first matching route for one complete operand. Section 9.3 defines the checks that follow recognition and how these parts become records.

```ebnf
text               = { statement }
statement          = rule | ranking-directive | directive | constant-definition
rule               = rule-keyword (rule-name | call)
                     ( "=" call | (body | statement-term headed-body)
                       [conditions-clause] [diagnostic-clause]
                       [suppress-warnings-clause] [output-clause] )
rule-keyword       = "%rule" | "%extend-rule" | "%redefine-rule"
rule-name          = NAME | EMOJI
statement-term     = "→" bag
headed-body        = "|" (ordinary-body | ranked-body)
body               = ["|"] ordinary-body | ranked-body
ordinary-body      = alternative { "|" alternative }
ranked-body        = { feature-gate } ranked-choice [alternative-term]
ranked-choice      = some-of "≻" some-of { "≻" some-of }
alternative        = { feature-gate } some-of [alternative-term]
alternative-term   = "→" bag
choice             = ["|"] some-of { "|" some-of } | ranked-choice
some-of            = ["&"] sequence { "&" sequence }
sequence           = factor { factor }
factor             = marked-factor | capture | tested-factor | untested-factor
marked-factor      = "^" (capture | tested-factor | untested-factor)
capture            = BINDING-TOKEN ":" factor
tested-factor      = untested-factor symbol-test { symbol-test }
untested-factor    = rule-reference | call | splice | parameter | tag
                   | string-terminal | range | wildcard | group | optional
                   | repetition | empty
rule-reference     = LOWERCASE-NAME | EMOJI
tag                = UPPERCASE-NAME | ENGINE-KEY
string-terminal    = string | constant-reference
range              = string-operand ".." string-operand
string-operand     = string | constant-reference | parameter
wildcard           = "_"
group              = "(" choice ")"
optional           = "[" ["+"] choice "]" | "[" captured-terminator "]"
captured-terminator = BINDING-TOKEN ":" "+" factor
repetition         = "{" ["..."] choice ["/" choice] "}"
                   | "{" choice "..." ["/" choice] "}"
empty              = "ε"
splice             = "*" (rule-reference | call)
feature-gate       = gate
symbol-test        = tag-test | value-test | default-value
tag-test           = "<" { tag-requirement } ">"
tag-requirement    = ["¬"] test-operand
value-test         = value-comparator test-operand
value-comparator   = "=" | "≠"
default-value      = "≝" test-operand
test-operand       = range | rule-reference | call | tag | post
call               = CALL-NAME "(" call-argument { "," call-argument } ")"
call-argument      = "=" expr | requirement-argument | target-argument
                   | body-argument | symbol-argument
requirement-argument = "<" { tag-requirement } ">"
target-argument    = target-option "|" target-option { "|" target-option }
target-option      = rule-reference | tag | call | parameter
body-argument      = group | optional | repetition | empty
symbol-argument    = tested-factor | range | wildcard | splice | rule-reference
                   | call | parameter | tag | string-terminal
conditions-clause  = "%conditions" [","] expr { "," expr }
diagnostic-clause  = error-clause | warning-clause
error-clause       = "%error" expr
warning-clause     = "%warning" expr
suppress-warnings-clause = "%suppress-warnings"
                           ("_" | suppression-code { "," suppression-code })
suppression-code   = NAME
output-clause      = erased-clause | emit-clause
erased-clause      = "%erased"
emit-clause        = emit
directive          = directive-keyword { directive-argument } [conditions-clause]
directive-keyword  = "%stage" | "%extend-stage" | "%redefine-stage"
                   | "%include" | "%names" | "%features" | "%elision-only"
directive-argument = first(directive-identifier, directive-string,
                           directive-terminal, directive-expression)
directive-identifier = NAME
directive-string   = STRING | RESOURCE-PATH
directive-terminal = ENGINE-KEY | range
directive-expression = expr | EMOJI | "_"
ranking-directive  = "%ambiguity-resolution" ranking-step { "," ranking-step }
ranking-step       = NAME [pattern-literal | constant-reference]
constant-definition = constant-keyword constant-name expr
constant-keyword   = "%const" | "%redefine-const"
constant-name      = CONST
constant-reference = CONST
parameter          = PARAM
string             = STRING
```

A call opener touches its name. A splice mark touches its call or rule name. The binding token can be a capture or constant token. Recognition accepts an invalid binder or a label around a group so the converter can report the error at the label. Within a capture, source tests belong to the target.

Recognition consumes all tests on the factor in source order. It also recognizes a test on a group or optional, or an operand with the wrong type. The reader rejects the target, order or operand under [Body and directive validation](#body-and-directive-validation). A valid string test operand is one ungrouped string literal, string constant or parameter.

A header term requires an initial bar. A ranked body keeps its gates and term on the complete ranked group. One choice level uses only one kind of separator. An empty clause, a repeated clause or a misplaced clause fails recognition.

In a call argument, a leading `=` commits to an expression. For an unmarked argument, choose the first complete match in the order shown. An inner target bar or expression comma belongs to its own argument.

Only the first quoted operand of `%include` or `%names` uses path decoding. A resource path cannot receive a method. A complete string operand uses `directive-string` even if `expr` also accepts it. A selector or operator that continues an ordinary string expression stays in that operand. Recognition accepts unsupported directive operands. The reader rejects their count and form at the directive before converting their contents.

For example, `%stage "phonemes"` has one string operand and fails at `%stage`. In `%include "a.md" "b.md"`, the first operand is a path and the second is a string. The extra argument fails at `%include`.

#### Pattern grammar

```ebnf
pattern-literal      = "#" pattern-primary
pattern-union        = pattern-intersection { ("∪" | "∖") pattern-intersection }
pattern-intersection = pattern-path { "∩" pattern-path }
pattern-path         = ("⋮" | "⋱") pattern-primary | pattern-primary ["⋰"]
pattern-primary      = pattern-node | bare-child-list | "(" pattern-union ")"
pattern-node         = ["·"] pattern-atom [child-list]
bare-child-list      = ["·"] child-list
pattern-atom         = (pattern-rule | tag | string | range | wildcard
                       | constant-reference) { symbol-test }
pattern-rule         = rule-reference | call | parameter
child-list           = "⁅" [child-choice] "⁆"
child-choice         = child-alternative { "|" child-alternative }
child-alternative    = child-sequence | child-set-operation
child-sequence       = child-item { child-item }
child-set-operation  = child-intersection ("∪" | "∖") child-intersection
                       { ("∪" | "∖") child-intersection }
                     | child-path "∩" child-path { "∩" child-path }
child-intersection   = child-path { "∩" child-path }
child-item           = child-path | child-optional | child-repetition | "⋯"
child-path           = ("⋮" | "⋱") child-primary | child-primary ["⋰"]
child-primary        = pattern-node | bare-child-list | "(" child-choice ")"
child-optional       = "[" child-choice "]"
child-repetition     = "{" child-choice ["/" child-choice] "}"
```

An exact prefix touches its next token. A list attached to a node touches its completed atom. A separated list starts a child item or bare pattern. Section 9.1 defines the separator requirements between child items. A call's first adjacent list belongs to its atom.

In a child list, parentheses group child items. If a path or set operator takes the group, it must contain exactly one whole pattern as a child item. The reader rejects a sequence, gap, optional, repeat or choice as that operand. A set beside another child item needs parentheses. A set can fill an entire choice arm without them.

Balance child-list delimiters by token. A bracket inside a string or comment changes no depth. Inner bars, slashes and commas do not end the outer argument.

#### Expression grammar

Quoted symbols denote tokens. Brackets denote an optional part and braces denote repetition. `csv(X)` denotes one or more comma-separated instances of X. Lowercase grammar names below denote productions. Lexical classes and imported host productions appear in capitals.

```ebnf
expr       = function | disj [ "⟹" expr ]
function   = BINDER "↦" expr
disj       = [ "∨" ] conj { "∨" conj }
conj       = [ "∧" ] neg { "∧" neg }
neg        = "¬" neg | comparison
comparison = union [ COMP union ]
union      = inter { ("∪" | "∖") inter }
inter      = sum { "∩" sum }
sum        = post { ("++" | "+") post }
post       = atom { prop | method | map | "↓" }
prop       = "'" KEY
method     = "." selector
selector   = NAME [ "(" [ arguments ] ")" ]
arguments  = csv(expr) | predicate | KEY | WIDTH | query-body | neighbor-targets | family
query-body = [ "…" ] choice [ "…" ]
neighbor-targets = neighbor-target { "|" neighbor-target }
neighbor-target = target-option | "(" target-option ")"
family     = rule-reference | call | parameter
map        = "!" (prop | method | "(" predicate ")")
predicate  = function | CONST | BINDER | PARAM | implicit
implicit   = expr                         (* first tokens restricted below *)
atom       = CAPTURE | CONST [ "(" expr ")" ] | PARAM | STRING | NAT
           | PATTERN | "∅" | bag | list | "'" [ KEY ] | method
           | "(" expr [ "?" expr "|" expr ] ")"
bag        = "{" [ csv(entry) ] "}"
entry      = prefix (KEY | KEY ":" { KEY ":" } expr | copy | "*" expr | "¬" KEY)
copy       = post prop | "'" KEY
prefix     = { gate } [ expr "?" ]
gate       = [ "¬" ] FEATURE "?"
list       = "[" [ csv(item) ] "]"
item       = prefix [ "*" ] expr
emit       = "%emit" [ csv(output) ]
output     = prefix (BINDER [ bag ] | "$" bag | "ε" bag)
```

`COMP` is one of `= ≠ < ≤ > ≥ ∈ ∉ ⊆ ⊈ ≅ ≇`. `BINDER` is a named capture. `CAPTURE` includes bare `$`. `KEY` is a property name of either case or a permitted engine name. `PATTERN` starts with `#` and reads a structural pattern under [Pattern grammar](#pattern-grammar).

Its own parentheses and child brackets delimit any nested pattern operators. `∅` denotes an empty pattern. Use `{}` and `[]` for empty collections.

| Binding, strongest first | Extent |
|---|---|
| Atom, grouped expression, conditional | The closing delimiter ends the operand. Each conditional requires its own parentheses. |
| Property, method, map, flatten | Fold left. A short map takes exactly one complete selector. |
| `++ +`, then `∩`, then `∪ ∖` | Fold left at each level. |
| Comparison | One comparison at this level. |
| `¬`, then `∧`, then `∨` | Negation nests right. Conjunction and disjunction fold left. |
| `⟹` and function body | Implication nests right. The binder takes the entire following expression in its field. |
| Gate, guard, key chain, copy and splat | Each belongs to its delimited entry or item. |

Inside a bag, `¬key` before a comma or closing brace deletes the key. At the start of a prefix, `¬feature?` is a negative gate. In an expression, `¬` negates truth. A standalone key name cannot start a truth expression. Several gates precede at most one guard. If every gate and the guard hold, evaluate the entry.

A disabled gate prevents evaluation of the guard. Gates read the stage switches. No expression reads a switch directly. Classify this punctuation before interpreting ordinary negation.

A bare item apostrophe followed directly by a property selector is a syntax error, even with intervening layout. Write `'key` for the item property. This rule also applies to copies.

A copy ends in a property selector. Split off its final selector to obtain the source and destination key. In `$row'prefix'Word` the source is `$row'prefix` and the key is `Word`. The intermediate read must yield a bag.

Splitting the final selector preserves a bare payload or absence without converting either to truth. Inside a function over nodes or bags, a lone `'Word` in an entry copies from the item. A key chain such as `image: value: "x"` writes one computed value under each name.

The method name selects the argument production before its contents are read. See [Method signatures](#method-signatures) for each signature. Zero-argument methods omit parentheses unless their signature permits an argument. Then parentheses are required even for an empty argument list. A query body cannot bind a capture. A chain cannot be the entire query target. The remainder marker can occur once at each outer edge.

Nested choices and sequences belong to that body. A neighbor target can be a rule, exact instance or user tag terminal. A family argument resolves to one ordinary rule or exact instance. `WIDTH` is a positive decimal literal. Both `.has` and `.has-value` take one literal key name.

Only `.all(…)`, `.any(…)` and `!(…)` admit an implicit function. Read the entire argument. After at most one initial `¬`, its first token must be `'` or `.`. A whole reference to a unary function also fits a predicate slot. Resolve the reference in its existing scope without binding an implicit item.

Any other body needs an explicit binder. Parentheses inside the argument do not change this first-token test. The short forms `!'key` and `!.method` are selectors.

Each function binds one item. Inside it, `'` denotes the item, `'k` reads its key and bare `.m` calls its method. The innermost function supplies that item, including inside a function constant. An explicit binder preserves access to outer items by name.

Reject a binder that hides another live name. Outside such a binding the implicit receiver is an error. A bag value that uses `'` reads an existing item. It never introduces a function.

Read unmarked template actuals by the first complete match in the [document and body grammar](#document-and-body-grammar). See [Arguments and substitution](#arguments-and-substitution) for their conversions. A single parameter retains its category through substitution. The canonical spelling of an expression actual starts with an equals sign and one space. Print its normalized expression with the parentheses required to recover its tree. Preserve entry and list order.

Exact instance identity includes category and normalized syntax, excluding positions. For recursive parameter flow, discard redundant grouping and the marker. A constructor or operation around a parameter still grows it. See [Templates and instances](#23-templates-and-instances).

After `→` the host requires the `bag` production. To use a computed bag, splat it inside the braces, as in `→ {*$F($x)}`. A constant name takes one expression in its definition. `%conditions` takes comma-separated clauses in truth positions and permits a leading comma. `%error` and `%warning` each take one string expression. Only the prefixed directive spelling is a keyword.

An output list takes its commas directly from the directive. Bare `%emit` selects the occurrence. At a splice it creates an implicit braced item with the call's whole bag. Inside the list a named capture alone forwards its outputs.

A braced item requires one occurrence as its part. A braced item produces a `projection` node. The insertion `ε` requires a bag. See [Emission](notation.md#emission) for the strings and placement of selected items.

Recognition productions:

```text
text = [statement {statement}]
statement = rule | ranking-directive | directive | constant-definition
rule = rule-keyword rule-name "=" call | rule-keyword (rule-name | call) (body | (statement-term headed-body)) [conditions-clause] [diagnostic-clause] [suppress-warnings-clause] [output-clause]
rule-keyword = KW-RULE | KW-EXTEND-RULE | KW-REDEFINE-RULE
rule-name = Identifier | Emoji-Name
statement-term = "→" bag
body = ["|"] ordinary-body | ranked-body
headed-body = "|" (ordinary-body | ranked-body)
ordinary-body = alternative {"|" alternative}
ranked-body = [feature-gate {feature-gate}] ranked-choice [alternative-term]
ranked-choice = some-of "≻" some-of {"≻" some-of}
alternative = [feature-gate {feature-gate}] some-of [alternative-term]
alternative-term = "→" bag
choice = ["|"] some-of {"|" some-of} | ranked-choice
some-of = ["&"] sequence {"&" sequence}
sequence = factor {factor}
factor = marked-factor | capture | tested-factor | untested-factor
marked-factor = "^" (capture | tested-factor | untested-factor)
capture = binding-token ":" factor
binding-token = Capture | Constant
untested-factor = rule-reference | call | splice | parameter | tag | string-terminal | range | wildcard | group | optional | repetition | empty
rule-reference = Lowercase-Name | Emoji-Name
tag = Uppercase-Name | Engine-Tag
string-terminal = string | constant-reference
string-operand = string | constant-reference | parameter
range = string-operand ".." string-operand
wildcard = "_"
group = "(" choice ")"
optional = "[" ["+"] choice "]" | "[" captured-terminator "]"
captured-terminator = binding-token ":" "+" factor
repetition = "{" ["..."] choice ["/" choice] "}" | "{" choice "..." ["/" choice] "}"
empty = "ε"
splice = $mark:"*" $target:splice-target
  assert ($.source-text = ($mark.source-text ++ $target.source-text))
splice-target = rule-reference | call
feature-gate = ["¬"] Identifier "?"
  assert ($.decomposed-source-text = $.span.tokens!'value.join())
tested-factor = untested-factor symbol-test {symbol-test}
symbol-test = tag-test | value-test | default-value
tag-test = "<" [tag-requirement {tag-requirement}] ">"
tag-requirement = ["¬"] test-operand
value-test = ("=" | "≠") test-operand
default-value = "≝" test-operand
test-operand = range | rule-reference | call | tag | post
call = Call-Name "(" call-argument {"," call-argument} ")"
call-argument = "=" expr | requirement-argument | target-argument | body-argument | symbol-argument
requirement-argument = "<" [tag-requirement {tag-requirement}] ">"
target-argument = target-option "|" target-option {"|" target-option}
target-option = rule-reference | tag | call | parameter
body-argument = group | optional | repetition | empty
symbol-argument = tested-factor | range | wildcard | splice | rule-reference | call | parameter | tag | string-terminal
parameter = Parameter
constant-reference = Constant
string = String
conditions-clause = KW-CONDITIONS [","] expr {"," expr}
diagnostic-clause = error-clause | warning-clause
error-clause = KW-ERROR expr
warning-clause = KW-WARNING expr
suppress-warnings-clause = KW-SUPPRESS-WARNINGS ("_" | suppression-code {"," suppression-code})
suppression-code = Identifier
output-clause = erased-clause | emit-clause
erased-clause = KW-ERASED
emit-clause = KW-EMIT [output {"," output}]
output = prefix ((Capture [bag]) | ("ε" bag))
directive = directive-keyword [directive-argument {directive-argument}] [conditions-clause]
directive-keyword = KW-STAGE | KW-EXTEND-STAGE | KW-REDEFINE-STAGE | KW-INCLUDE | KW-NAMES | KW-FEATURES | KW-ELISION-ONLY
directive-argument = directive-identifier | directive-string | directive-terminal | directive-expression
directive-identifier = Identifier
directive-string = String | Resource-Path
directive-terminal = Engine-Tag | range
directive-expression = expr | Emoji-Name | "_"
  assert ¬(($.onward.parse(String …) ∧ ($.first-token.tokens!'value.join() = $.span.tokens!'value.join())))
ranking-directive = KW-AMBIGUITY-RESOLUTION ranking-step {"," ranking-step}
ranking-step = Identifier [pattern-literal | constant-reference]
constant-definition = constant-keyword constant-name expr
constant-keyword = KW-CONST | KW-REDEFINE-CONST
constant-name = Constant
expr = function | disj ["⟹" expr]
function = Capture "↦" expr
disj = ["∨"] conj {"∨" conj}
conj = ["∧"] neg {"∧" neg}
neg = "¬" neg | comparison
comparison = union [comparator union]
comparator = "=" | "≤" | "≥" | "<" | ">" | "∈" | "⊆" | "≅" | "≠" | "∉" | "⊈" | "≇"
union = inter {("∪" | "∖") inter}
inter = sum {"∩" sum}
sum = post {("++" | "+") post}
post = atom [(prop | method | map | flatten) {(prop | method | map | flatten)}]
prop = "'" key
method = "." selector
selector = named-selector | parse-selector | neighbor-selector | family-selector | key-selector | width-selector | predicate-selector
named-selector = method-name ["(" [expr {"," expr}] ")"]
  assert ($.first-token.tokens!'value.join() ∉ ["parse", "followed-by", "preceded-by", "without-elision-except", "has", "has-value", "ngrams", "at-most", "any", "all"])
method-name = Identifier | Call-Name
parse-selector = "parse" "(" query-body ")"
query-body = ["…"] choice ["…"]
neighbor-selector = ("followed-by" | "preceded-by") "(" neighbor-target {"|" neighbor-target} ")"
neighbor-target = target-option | "(" target-option ")"
family-selector = "without-elision-except" "(" (rule-reference | call | parameter) ")"
key-selector = ("has" | "has-value") "(" key ")"
width-selector = ("ngrams" | "at-most") "(" integer ")"
predicate-selector = ("all" | "any") "(" [predicate] ")"
predicate = expr
map = "!" (prop | method | ("(" predicate ")"))
flatten = "↓"
atom = Capture | constant-reference | application | parameter | string | integer | pattern-literal | "∅" | bag | list | item-reference | method | grouped-expr
grouped-expr = "(" expr ["?" expr "|" expr] ")"
application = Constant-Call "(" expr ")"
item-reference = "'" [$name:key]
  assert ($name ∨ ¬($.following-tokens.parse((key | "'") …)))
integer = Integer
key = Identifier | Engine-Tag
bag = "{" [entry {"," entry}] "}"
entry = prefix (write-entry | delete-entry | splat-entry | copy-entry | bare-entry)
bare-entry = key
write-entry = (key ":") {(key ":")} expr
delete-entry = "¬" key
splat-entry = "*" expr
copy-entry = post
  assert ($.last-token.tokens!'value.join() ≠ "'")
prefix = [feature-gate {feature-gate}] [guard]
guard = expr "?"
list = "[" [item {"," item}] "]"
item = prefix ["*"] expr
pattern-literal = "#" pattern-primary
pattern-union = pattern-intersection {("∪" | "∖") pattern-intersection}
pattern-intersection = pattern-path {"∩" pattern-path}
pattern-path = ("⋮" | "⋱") pattern-primary | pattern-primary ["⋰"]
pattern-primary = pattern-node | bare-child-list | "(" pattern-union ")"
pattern-node = [$exact:"·"] $atom:pattern-atom [$list:child-list]
  assert ($exact ⟹ $exact.onward.parse(pattern-exact-start …))
  assert ($list ⟹ $atom.onward.parse(pattern-attached-start …))
  assert (¬($list) ⟹ ¬($atom.onward.parse(pattern-attached-start …)))
bare-child-list = [$exact:"·"] child-list
  assert ($exact ⟹ $exact.onward.parse(pattern-exact-start …))
pattern-atom = (pattern-rule | tag | string | range | wildcard | constant-reference) [symbol-test {symbol-test}]
pattern-rule = Lowercase-Name | Emoji-Name | call | parameter
child-list = "⁅" [child-choice] "⁆"
child-choice = child-alternative {"|" child-alternative}
child-alternative = child-sequence | child-set-operation
child-sequence = child-item {child-item}
child-set-operation = child-intersection ("∪" | "∖") child-intersection {("∪" | "∖") child-intersection} | child-path "∩" child-path {"∩" child-path}
child-intersection = child-path {"∩" child-path}
child-item = child-path | child-optional | child-repetition | "⋯"
  assert ¬($.last-token.onward.parse(adjacent-item-opening …))
child-path = ("⋮" | "⋱") child-primary | child-primary ["⋰"]
child-primary = pattern-node | bare-child-list | "(" child-choice ")"
child-optional = "[" child-choice "]"
child-repetition = "{" child-choice ["/" child-choice] "}"
pattern-exact-start = $mark:"·" $next:ANY-TOKEN
  assert ($.source-text = ($mark.source-text ++ $next.source-text))
pattern-attached-start = $atom:pattern-atom $open:"⁅"
  assert ($.source-text = ($atom.source-text ++ $open.source-text))
pattern-item-opening = "⁅" | "·"
adjacent-item-opening = $left:ANY-TOKEN $right:pattern-item-opening
  assert ($left.value ≠ "⋯")
  assert ($left.value ≠ "⋰")
  assert ($.source-text = ($left.source-text ++ $right.source-text))
```

### 9.3 Conversion and validation

Inspect syntax, names, scope, arity and closed types before recognition. Inspect inactive conditional branches and disabled entries for invalid shapes. Specialization resolves types that depend on the stage's features or input. The same constructors and validation apply to text, cached documents and caller-supplied DOMs.

Each body or pattern test, property read and method call carries its written operator position. Error-owning operators do the same. A normalized operator array uses the first combining operator. Its operands retain their own positions. Template argument records carry the argument's written position. For a marked expression, use its first token after `=`.

Preserve both document and position during substitution. An error on a substituted operand uses its written site and names the requesting operation as context. Positions do not affect normalized instance identity.

Use the bag constructor after `→` and in braced emission items. An emission list cannot forward the whole occurrence. Inspect primary coverage on each route and reject duplicate direct writes, invalid scopes and forbidden origin fields. Reject invalid expression records before specializing them.

A terminal, filter and pattern use the canonical name of each Unicode membership. A rule-level filter requires visible keys. If both tests appear, the value test follows the key filter. Pattern tests carry their own locations and do not accept a target with children. An inline `++` in a body or pattern terminal, test operand or range endpoint fails recognition at that operator.

A rule or exact instance body requires one or more alternatives. A binding has no body or clauses. A chain occupies one whole alternative. Braced repetition items must consume on each route under §3.3. The reader preserves ordered subset pieces and their source order.

Resolve closed constant expressions and pattern shapes, including retained actuals and replaced definitions. Empty delimiters and invalid ranges fail in their written order. Defer a type that requires substitution or an effective stage interface until that information is available.

#### Reading a notation tree

A constructor is a recognized tree part that supplies a record or a field. The tables below name the constructors. Other nodes act as wrappers, whose children the reader visits recursively in source order. It skips elided nodes. At the root, a recognized nondeclaration part is an error. Every nonelided root part still counts as a statement for preamble placement.

Flatten wrappers before looking up parts. Take the first named match unless the row asks for an ordered list. Ignore unused parts. If a required lookup fails, report its constructor at that step. Before using a token span, reject an invalid span at its constructor.

A position uses the first token in the subtree. If the subtree has no token, use its start boundary or the input end. A declaration's `at` uses its first token. An operand with its own position follows the [position rules](output.md#source-positions-and-nesting). A public tree reader includes the document name on every error. Supplied-tree conversion errors have no `ranked-choice-syntax` code.

##### Declarations and bodies

| Constructor | Parts in lookup order | Record or field |
| --- | --- | --- |
| Root | Declaration parts in source order | Three ordered arrays for rules, directives and constants, including empty arrays. |
| `directive` | Keyword, then ordered arguments. Inspect their kinds and count before converting them. Read a following conditions clause for stage-local features. | Name, arguments, source position and supported feature conditions. A wrong operand fails at the directive. |
| `directive-identifier` | One name token | Name string. |
| `directive-string` | One quoted operand | The first path operand uses resource-path decoding. Other strings use regular decoding. |
| `directive-terminal`, `directive-expression` | Terminal or expression part | Inspect the directive's operand kind before converting the part. |
| `ranking-directive` | Keyword, then ordered `ranking-step` parts | Declaration with `steps`. An invalid step form fails at the directive. |
| `ranking-step` | Name, then the optional pattern or constant reference | Step with its optional `pattern` operand. |
| `constant-definition` | Keyword, capitalized constant name, then expression | Operation, name without `$`, expression `value`, and `at`. |
| `rule` | Keyword and head. Then binding call, or statement term, body and trailing clauses. | Definition, template, exact edit or binding. |
| `rule-keyword`, `rule-name` | One token of the named kind | Operation or the lowercase or emoji name. |
| `statement-term`, `alternative-term` | One `bag` | The owner's `term`. |
| `body`, `headed-body` | Alternatives in order, or one `ranked-body` | Nonempty alternatives array. |
| `alternative`, `ranked-body` | Gates, then `some-of` or `ranked-choice` respectively, then its optional term | `gates`, `expr` and optional `term`. |
| `ranked-choice` | At least two `some-of` parts | Ordered `ranked` array. A supplied tree without a separator token can retain the options without a separator position. |
| `choice` | One ranked group or one or more `some-of` parts | Ranked group, ordered `choice`, or sole child. |
| `some-of`, `sequence` | Ordered sequences or factors respectively | `and` or `seq`. Return a single operand directly. |
| `factor`, `untested-factor` | One body constructor from its production | The corresponding body expression. |
| `marked-factor` | Mark, then symbol or capture | `primary` around the complete symbol or capture record. |
| `rule-reference`, `tag` | A name token | Body `ref`, including an emoji reference. In a requirement, use the name atom with `tag`. |
| `splice` | One rule reference or call after its mark | `splice` around the target. Any symbol tests wrap the splice. |
| `string-terminal` | String or constant reference | Body `literal` with its unresolved operand. |
| `range` | Two ordered string operands | `range` with both operands. |
| `wildcard`, `empty` | Their written tokens | `wildcard:true` or `empty:true`. |
| `tested-factor` | Tests, then the base factor | Inspect the target and test order before decoding them. Wrap the base with its filter first and its value test second. |
| `tag-test` | Opening angle and ordered requirement parts | Filter record with its position and requirements, including an empty array. |
| `tag-requirement` | Optional negation and operand | `negated` and unresolved `value`. Require a tag, key-set constant or declared parameter. |
| `value-test` | Comparator before operand | Value test at the comparator. Read the operand as an unresolved string literal, constant or parameter. |
| `default-value` | Default mark before operand | The enclosing elidable optional's default. Read its operand by the value-operand rules. |
| `capture`, `captured-terminator` | Binder, marker on the captured route, then target factor | Name without `$`, then the expression. |
| `group` | One `choice` | The child expression. |
| `optional` | Select the captured or ordinary route first. Read the route's child, markers, form and contents. | `optional`, with `elidable:true` and an optional `default` on a marked route. |
| `repetition` | First two `choice` parts, then chain markers | Item as `repeat` and optional `separator`. A marker before the item gives left chaining. A marker after it gives right chaining. |
| `call` | Name token, then ordered argument parts | Name, argument records and source position. |
| `call-argument` | One marked expression, requirements, targets, body or symbol | Argument record and position. Normalize a sole symbol in a body argument. |
| `requirement-argument`, `target-argument` | Ordered requirements or at least two ordered targets | The array for its category. |
| `body-argument`, `symbol-argument` | Body part or one symbol part | The normalized body or symbol argument, with its tests and position. |
| `parameter`, `constant-reference` | One token and its position | `param` without `@` or `const` without `$`, with `at`. |
| `string` | String token | Decode to a `string` record. Keep decomposed literal runs and exact escaped scalars. |

Look up a rule's keyword before its head. Prefer the plain name part and then the head call. If neither exists, report the missing name at the rule. A head call needs its name before it needs its arguments. A head of all distinct parameters declares or edits a template. A closed head selects an exact instance for editing.

Report a repeated parameter at its second occurrence, even through grouping. Report a mixed head or a closed head on `%rule` at the call. If the rule has a binding equals sign, require a plain head and then the right-hand call. Return the binding before looking up any term or body. Otherwise read the statement term before the body. Look for `body` before requiring `headed-body`.

For a supplied tested factor, require tests before looking up the base. Read the target and the tests' arrangement before decoding test operands. Prefer a `factor` wrapper for the base. Otherwise take the first base constructor and ignore nested tested parts in that search. A test on a capture in a supplied tree is an invalid target.

For a capture, inspect placement first, then locate the binder and target. A target with tests needs a base before the reader descends into those tests. Inspect the binder and base kind before converting the target's children.

For an optional, a direct captured-terminator part selects the captured route. That route requires no `choice`. The ordinary route requires `choice` before inspecting the markers. After the required child lookup, check the marker count, the marked form and then the contents. A missing captured marker fails the optional's form. A second marker fails at that marker.

For a repetition, require its item choice before inspecting markers. Inspect markers and whole-alternative placement before converting the item and separator. For a group, require its choice before converting its contents.

##### Expressions and trailing clauses

Read an expression in its owning syntax context. The [expression tables](output.md#expression-records) give the canonical record and field order for each row. Grouping changes no record. Normalize operators only as those tables specify.

| Constructor or form | Parts in lookup order | Record or field |
| --- | --- | --- |
| Expression wrapper, grouped atom | One expression part | Its child. A conditional atom uses the test, then both branches, with `at` on `?`. |
| `function` | Binder, then body | `lambda` with its body and binder position. |
| `predicate` | Function, reference or implicit expression | A function record, an ordinary reference or a lambda with an empty binder name. Inspect the implicit body's first token before dropping grouping. |
| Implication, disjunction, conjunction and negation | Ordered operands and written operators | `if`, `any`, `all` or `not`. Preserve separate grouped Boolean runs. |
| Comparison | Left operand, comparator and right operand | `op`, both operands and the comparator position. Structural comparisons require the node forms in §10. |
| Union, intersection, difference and sums | Operands in source order, with operators | Preserve precedence and ordered operands. Fold binary forms from the left. Use `concat` for `++` and `op` for `+`. |
| Postfix expression | Receiver, then each selector, map or flatten operation | Fold from the left. A reached property uses its apostrophe position. A map uses its exclamation mark position. |
| Method selector | Receiver first, then name and its argument route | Method with `args`, including an empty array, and `at` on the dot. Convert each argument in its immediate context. |
| Short map selector | One property or method selector | Selector record without a receiver. Its own operator still supplies its position. |
| Query argument | Body, with optional outer remainder tokens | One `body` record. Retain each written remainder at its edge. Reject a written capture at its binder. |
| Neighbor argument | Target atoms in source order | Rule, terminal, call or parameter records. A choice contributes the atoms directly to `args`. |
| Close family or literal key argument | One complete family or key atom | Rule, call or parameter for a family. One `key` record for a presence method. |
| Decimal argument | Written digits | `integer` with canonical digits. Widths require positive digits. Count literals use the bounds in §10. |
| Capture and item | Capture token, or the argument apostrophe | Name without `$`, or `item:true`. Bare `$` has an empty capture name. |
| Function call | Constant name, then one argument | `apply` with the name, argument and dollar-sign position. |
| Pattern expression, empty pattern | Pattern part or empty pattern token | `pattern` with its pattern or `emptySet:true`. |
| Bag and list | Ordered entry or item parts | `bag` or `list`, with an empty array where written empty. |
| Entry or list item | Gates, optional guard, then entry form | The appropriate entry record. The position starts at its first gate, guard or entry token. |
| Bare, write and delete entries | Key or ordered key chain, then expression where required | Bare, write or delete record. A chain keeps each written key. |
| Copy entry | Source expression through the last property selector | Split off the final key. Retain positions on all intermediate reads. |
| Splat | One expression after `*` | Splat entry for the enclosing bag or list. |
| `conditions-clause` | One or more expressions | Ordered conditions. |
| `error-clause`, `warning-clause` | One expression | Owner's `error` or `warning`. Inspect its string type and allowed dependencies. |
| `suppress-warnings-clause` | Wildcard alone or one or more code parts | `suppressWarnings`, with `["_"]` for the wildcard. |
| `emit-clause` | Zero or more ordered output items | `emit.items`. Bare emission has an empty array. |
| Output item | Gates, optional guard, capture or insertion selector, then a constructor where required | Forwarding, braced or insertion record. Bare whole-occurrence forwarding is invalid. Only a braced item can have an empty capture name. |
| `erased-clause` | Its directive token | `erased:true`. |

In a supplied tree, read the immediate operands before reporting a missing combining operator. Check each operator's required arity and number of written operators. A failure inside an operand uses its own position. Convert an expression guard before its entry. A gate never excuses a malformed written part.

##### Patterns

| Constructor | Parts in lookup order | Record or field |
| --- | --- | --- |
| `pattern-literal`, `pattern-primary` | Whole pattern part from its production | A literal wraps the pattern. A primary returns its child without a group record. |
| `pattern-union`, `pattern-intersection` | Ordered operands and their operators | Flatten a nested union or intersection into its own kind. Preserve difference and operator positions. |
| `pattern-path` | One primary and its optional path operator | The primary alone or a descendant, first or last path. |
| `pattern-node` | Atom, optional exact mark and optional adjacent list | Atom with any exact flag and child array. Position comes last on a positioned atom or test. |
| `bare-child-list` | Optional exact mark and the list | `any:true` with optional exact flag and required children. |
| `pattern-atom` | Name, terminal, wildcard, call, parameter or constant, followed by its written tests | Atom or nested tests in source order. Inspect the test form before the operands. |
| `child-list` | Optional child choice | Ordered item array, including an empty one. |
| `child-choice` | One or more alternatives | One item array, or a choice item. Flatten an alternative consisting solely of another choice. |
| `child-alternative` | First sequence part, otherwise its required set operation | Items from a sequence or one `child` containing the set pattern. |
| `child-set-operation`, `child-intersection` | Their ordered paths or intersections and the operators | Require each operand to supply a whole pattern. A set operation needs at least one operator. |
| `child-sequence`, `child-primary` | Child items, or one node, bare list or grouped child choice | Concatenate groups in order. A node or bare list supplies one `child`. |
| `child-item`, `child-path` | Its path, optional, repetition or gap, or its primary and optional path mark | Items from the named part. A gap gives `siblings:true`. A path needs one whole pattern. |
| `child-optional`, `child-repetition` | Nonempty child choice and, on a repeat, optional nonempty separator | Item with the corresponding arrays. |

A constructor reads only the immediate operand kinds in its row. A part from a different layer cannot supply a missing operand. For example, a grouped item sequence cannot supply a whole-pattern operand of a path. A child set can read both child intersections and child paths. Its operator must follow the operand checks.

A wildcard needs its token. A tested pattern constant must resolve to a string terminal. An attached list needs a rule atom, call or compatible parameter. Report a forbidden list at its opening bracket unless substitution supplies the invalid operand.

The reader maps decomposed comparators to their canonical spellings. It preserves decoded string scalars. For resource paths, it decodes escapes within the original literal runs.

#### Error selection

A lexical failure reports the furthest character reached. After lexing, inspect the longest leading run of names directives. For each directive, reject an invalid operand count or kind before inspecting escapes. Inspect valid operands from left to right, and report a bad or forbidden escape at its opening guillemet.

After that preamble, inspect string and path escapes in source order. A misplaced names path uses the same restricted decoder. Report the first invalid escape at its opening guillemet. Then recognize the complete token sequence. A syntax failure reports the furthest token reached. It precedes all notation-tree conversion errors.

Read unknown directives as syntax errors. The bootstrap reader follows the same lexical, escape and syntax stages.

Read declarations in written order across categories. Within a definition, inspect its own form before children. For a tested factor, inspect the target and test order before its base or operands. For a capture, inspect placement, the binder and the target kind, in that order. A chain item or separator cannot bind a capture directly.

An elidable optional permits only its sole-terminator capture. Then reject bare `$`, a name that does not use lowercase syntax, or a target that is not one symbol. For an optional or chain, inspect the form and marker rules before converting the contents.

A repeated marker fails at the second marker. A chain marker in a separator fails at that marker. A chain inside a sequence fails at its opening brace before a bad capture in that chain. An ordered subset with more than sixteen items fails at its first item, before any operand faults.

After an alternative's body, inspect duplicate bindings before its term. Read the complete condition list, diagnostic, suppression and output items in written order. An emission item reports its own conversion or scope error before an overlap error. Evaluate no runtime guard during these checks. Whole-definition errors follow local part errors.

Within a declaration, inspect structural shape before closedness and types. A closed empty delimiter fault follows shape inspection of every declaration. A closed constant faults at its first erroneous operand in source order. A known non-string concatenation operand can fail before substitution. These faults use the operand or operation position under the expression position rules.

Ordinary reader errors in any declaration precede the document depth limit. Report the first offending declaration for that limit. Parentheses add no independent limit. Supplied-DOM decoding uses the same constructor order and error sites.

Read all stage documents in include order before stitching that stage. Ordinary reader errors precede stitching errors. Finish ordinary syntax, name, type, capture and clause checks before nullable error production analysis and static emission overlap. Specialization can report errors that require the invocation's features or input. The [failure order](#failure-order) governs evaluation after reading and stitching.

#### Body and directive validation

A rule name starts with an ASCII lowercase letter or uses a valid emoji scalar. Report invalid names at the name token. A capture binder uses lowercase syntax and names one symbol. A name that binds twice on one route fails at the first later binder that can repeat. Disabled gates cannot hide that conflict.

A test accepts one symbol. The filter, value test and elidable default appear in that order. Report repeated or reversed kinds at the first disallowed operator. A grouped value operand fails at its opening parenthesis. The origin mark `_Elided` takes either sign on a body terminal or elidable head.

Either sign on a rule reference, call or splice fails at the opening angle. If a parameter becomes an invalid target, report its written argument and name the filter as context. Inspect invalid filters even behind a gate.

A written elidable optional starts with its ungrouped user terminal or parameter after `+`. A capture can wrap its sole terminator inside the optional. The normalized DOM retains that terminal or capture, or a sequence that starts with the terminal. Substitute an untested user terminal for the parameter before applying the written tests.

A group, optional or repetition cannot take a capture label, even around one symbol. A capture inside a repetition binds a flat list of nodes in input order. Conditions, terms and emission items can use a list under their own rules. See §10 for recognition reductions and §11.1 for forwarding.

A chain occupies one whole alternative and cannot be the query target. A chain marker cannot label a separator. An ordered subset accepts at most sixteen operands. A default outside an elidable head or on a head whose omission predicate is false fails at its `≝`.

A stage selector takes one name. An include or names directive takes one path. A features directive takes at least one feature name. The elision directive takes no operand.

A resolution directive requires at least one step. A lean step takes no pattern and can occur only last. A key step needs an exact local pattern. That pattern cannot use paths, bare lists or child constraints. A `leftmost-longest` pattern cannot require `_Elided`, including through a constant or pattern operation. Report an invalid step operand at its written operand.

A call argument cannot read or declare captures. Report this fault as `an argument cannot read or declare captures`. Name a method by its source spelling in its diagnostic. A method with an invalid receiver or arguments reports `a method has the wrong receiver or arguments`. A fault in the receiver or argument retains that operand's own diagnostic and position.

#### Depth

A record at logical depth greater than 256 is an error. Start each body, pattern and expression root at zero. Include emission guards and terms. Count normalized written forms and substituted definitions.

| Form | Depth of its child operands |
| --- | --- |
| Body sequence, choice, ranked group, ordered subset, optional, repeat, capture, splice or test | Parent plus one. |
| Body string terminal or range | Parent depth for the string or endpoints. |
| Pattern union, intersection, difference, path or test | Parent plus one. |
| Pattern atom with a string or range | Parent depth for the string or endpoints. |
| Pattern node with children, pattern child, optional, repeat or choice | Parent plus one. |
| Call | Parent plus one before each argument. |
| Bag or list | Parent plus one for each guard, value or source expression. |
| Expression operator, property, method, function, application, map or flatten | Parent plus one for each expression operand. |
| Pattern or query operand of an expression | Parent plus one before the nested pattern or body. |

A primary, grouping parentheses, exact prefix, argument wrapper, entry wrapper, gate or source position adds no level. Siblings share a level. A short map selector adds no level before its arguments. A full lambda adds one before its body.

A constructor around a string can nest 256 levels at an expression root. A 257th level puts the string beyond the limit. A guard in the last list has the same depth as its item value. Its own comparison adds one before its operands.

Before measuring depth, flatten nested unions and concatenations. Preserve grouped conjunctions and disjunctions as the expression records require. Include guards, directive conditions and call arguments. Flatten nested pattern intersections too. Expression intersections keep their written nesting until type resolution.

For resolved depth, each pattern expression adds one level before its normalized pattern. Flatten adjacent pattern unions and intersections before counting. Bound constants contribute their pattern shape without another level. Normalize an empty pattern to the difference of two unrestricted child lists.

Inspect pattern references and types together in written order, then depth, then range values. At the first over-depth reference, report its document, position and stage before copying or compiling the substitution. If there is no offending reference, report the declaration. Report the first invalid range in written order.

#### Templates and feature conditions

Templates and their arguments follow §2.3. Retain each argument's parsed category. A symbol parameter is a plain symbol after substitution. Only a whole unnegated requirement can receive a requirement list. A marked expression must close after substitution. Arguments never read caller captures.

Feature expressions use the input span and the restricted observations in §13. Inspect the full expression for invalid forms. A disabled branch does not permit an invalid method, name or scope.

A rule bag that reads its own unfinished key is cyclic, including through a called function. Inside a message, reject dependencies on queries, publication, verbatim claims and private bindings. A message must supply a string.

A stage must define `text` and one resolution policy. Only the last stage can omit `$OUTPUTS`. In that case, the loader inspects the `%emit` clauses and the audit notes each rule that has one. The engine skips those clauses at runtime.

Erasure and emission cannot coexist on one definition. Each extension owns its clauses. The loader reports a condition that applies to no alternative.

Use [Bags](notation.md#bags) and [Stage interfaces](notation.md#stage-interfaces) for the constructor restrictions. A supplier must support every reached value read and every emitted string. An unsupported value read, late recognition dependency or unbounded recursive observation fails at its source.

#### Definition checks

Inspect every retained definition, actual and template for errors that do not depend on a binding value. Include unused templates and replaced definitions. Unresolved symbols introduce no caller-visible captures. Defer argument-dependent checks until substitution and keep the argument's location. Run semantic checks that need the effective stage on the surviving declarations.

Inspect all branches for references to a capture that the definition never binds, including presence tests. Inspect scope before pruning any absent output item. A condition must apply to at least one structural expansion under some feature assignment. A term or message that serves an expansion cannot read a missing capture after simplification. If several captures remain absent, name the first that the simplified clause reads in written order. Defer simplification that needs the value of a constant until that value is available.

Find a witness by walking the written capture structure in expansion order. A query can require or forbid captures or require one capture before another. Retain the first matching expansion for each query. Compare failures in expansion order. Within an expansion, visit its rule term, alternative term, message and output items in that order.

Use written item order. An error that needs a value can wait. An error that known operands already decide uses its own site.

Branch only on presence tests that the clause actually reaches during simplification. Reuse the first compatible witness and its capture names. If a new guard conflicts, query for a replacement. Discard an assignment with no structural witness. Do not enumerate combinations of unrelated optional captures.

Check each boundary atom in expanded rule order, then alternative order and written target order. Its target is a rule, exact instance, user tag terminal or a choice of these. A rule target must be reachable through body references from `text` or from a query body. A terminal target must occur in such a body. Include all structural alternatives regardless of gates or reachability on a particular input.

A condition item allows one boundary atom. If its receiver is a named capture, the item cannot also read another capture or `$`. Report the first violation at the atom, the invalid target or the second atom, as applicable. Rule terms and output guards follow their own restrictions in §3.7 and §11.1.

After stitching and expansion, inspect each production with `%error`. If it can derive the empty sequence, reject it. Inspect all surviving productions, including unreachable and gated ones. Treat every gate as present. Neither tests nor conditions can establish that a production reads a token.

Inspect expanded rules and then their written alternatives. Report a grammar error at the definition that supplies `%error`. A `%warning` production is exempt.

Compute this nullability from the structural grammar, including helpers and spliced calls, until no mark changes. An empty expression and an optional are nullable. A terminal is not nullable. A sequence or ordered subset needs all operands nullable. A choice needs one nullable option. A call or reference uses its target's nullability.

For a repetition, inspect the minimum count, item and required separator. A repeat that permits zero items is nullable. A repeat that requires an item needs a nullable item. The ordinary repetition checks still reject a nullable item where its progress rule requires consumption.

#### Emission overlap

Run the static overlap analysis last in each stitched stage. Include unreachable surviving rules. Include gated alternatives and reads inside erased rules. Ignore body tests and conditions for possible consumption.

Propagate possible consumption from terminals through their expressions and reachable rules until the marks stop changing. A route need not produce a finite successful derivation to count. A repeated or nested consuming cover and a reversed consuming pair fail within one production. Include forwarded selections that can consume under an unguarded writer. Compute their possible consumption by the same least fixed point. A selected ancestor suppresses descendant output, so the suppressed output creates no conflict.

Visit rules in expanded order, then alternatives and written item pairs. Report the first conflict. Recheck the actual output after selection, including guards.

#### Malformed DOMs

Reject unknown fields in structural DOM records and malformed record shapes. Directives can carry ignored extension fields. Inspect required arrays, field types, exclusive constructors and positions. Null never supplies an absent optional field.

All three declaration arrays must exist and retain written order. A declaration has one source position, distinct from those of other declarations in the document. Format 50 is required for a supplied DOM or the mandatory bootstrap. A missing, invalid or obsolete optional cache file can miss. Once the loader selects a current document for decoding, an invalid record fails at the same site as a supplied DOM.

Reject wrong forms at the same logical position for source, cache and supplied input. A syntactic origin test uses a requirement record. It is separate from engine class membership. Ordinary membership tests can inspect a rule’s visible keys. [Output formats](output.md#a-grammar-dom) defines each record.

#### Strings and ranges

The reader takes semantic names and syntax from token values, including rule names, tags, constants, features, keys and methods. Resource paths decode escapes within their original literal runs. Diagnostic positions count the original text.

String decoding preserves dollar signs literally. `++` joins strings in any expression context that permits it. Resource paths retain original spelling outside escapes. §9.1 defines string escapes and canonical diagnostic spelling.

A scalar range endpoint decodes as a string term and must resolve to exactly one scalar. The DOM retains the string term. An equal literal and constant resolve to one terminal identity. A reversed scalar range is a document error.

Reader errors retain their construct positions. After constant binding, a wide endpoint error uses that endpoint's first constant reference, otherwise the definition. A reversed range error uses the first constant reference in the left endpoint. Without one, it uses the first constant reference in the right endpoint, otherwise the definition.

Supplied-DOM inspection uses the same two reasons for invalid ranges. Errors from the bootstrap use those reasons too. The schema inspects literal endpoint values. Rule type inspection checks endpoint types, and binding inspects values that become known later.

#### Patterns

Pattern constructors use the atom, path and child sequence forms in [Pattern values](output.md#pattern-values). Check all written operands, including those in replaced definitions. Patterns cannot bind captures. A rule pattern value test requires the recognition certificate.

A pattern rule atom accepts only the negated origin requirement. Report a positive requirement at the mark. A wildcard tests leaf nodes for origin. A terminal pattern can test either sign. An exact prefix limits matching to the current node.

Neither a primary nor an output projection changes a structural pattern. Flatten splice children for matching. Keep the sealed structural view at ranked boundaries.

#### Comparison cycles

During recognition, a comparison of two constituents needs a finite domain of tree identities (§4.1). Lowering checks this for each feature set alongside the brace and chain checks in §3.3. So the gates apply, and only conditions and tests are not trusted. The nodes of the check are rules and template instances.

For each recognition-time comparison whose right operand has constituent type, lowering builds the dependency graph of its demanded identities. An edge goes from a rule to each named rule whose identity its children need, through helpers and chain levels. The walk stops at ranked seals and exported erasure seals. A definition's own comparison starts a separate walk through its working structure.

Unerased alternatives retain their ordinary identity dependencies.

Lowering marks an edge where the child can cover the complete span of the parent. Structural nullability decides that. It is a least fixed point over the lowered productions, as §3.3 defines it for the braces check:

- `ε` is nullable, and a terminal is not.
- If every symbol of a sequence is nullable, the sequence is nullable.
- If one production of a rule, a choice or a helper is nullable, that rule, choice or helper is nullable.
- Parentheses keep the nullability of their contents.
- An optional and an elidable optional are nullable.
- A repetition is not nullable, because the reader refuses braces whose item can match no tokens.

Each mark belongs to one production. Where every other symbol of the production is nullable, the edge to the child is marked. Helper productions are nodes of the computation. By the braces rule none of them is cyclic over one span, so the named rules on a cycle report it.

A cycle of marked edges is an error of the grammar at the comparison. Lowering finds it for the features that make it, as it finds the errors of §3.3. §3 gives its order and its location. The diagnostic names the comparison and the cycle.

It says that the cycle can repeat a demanded rule over one span.

There is no forwarding exception, because a named wrapper changes the tree. Recursion over a shorter span is legal. A cycle that no comparison demands keeps its behavior, and ordinary queries keep their proof policy. The check is conservative on purpose. An unerased `%rule s ε | s` under a comparison is an error, although its empty trees collapse.

For `%rule verb "v" | "(" verb ")"`, every recursive path reads a token first. Its inner span is smaller, so the rule passes the check. A nullable postfix adds no same-span cycle to this grammar.

## 10. Terms and conditions

The loader infers bag shapes from reachable writers, separately for each constant version, rule, alternative and emission item. A shape records all possible states and value types of each key. Join nested bags and lists recursively. A reader must accept each state and payload type that its path still permits.

Bind constant versions in stitched order. A self-reference inside a redefinition uses the preceding version. Other references use the final binding under the ordinary constant rules. A function constant has one parameter. A call in a redefinition can invoke the preceding function.

Reject dependency cycles between constant versions. The stage never lets a grammar define or redefine `$INPUTS`.

After substitution and binding, infer the possible shapes of individual constants, rule alternatives, rules and emitted items. Join reachable writer types recursively. Infer each version independently. Instantiate a function’s result shape for its actual argument shape. For defaults this includes the rule, route and reachable children.

A class table can give `UI` a list while a word gives `UI` bare presence. No stage-wide assignment of one type to that name exists. Infer numeric bounds from operations and effective suppliers.

Apply the output mask to each possible emitted bag. Combine the resulting shapes to find the next stage's input interface. Include absence on routes without the key. A key in that mask can lack any supplier. Such a declaration grants permission but supplies no value. A read that needs a payload must exclude both absence and bare presence.

On bags and nodes, `.has(k)` reports the presence of a key that can carry a value. Bare and valued entries both pass. Write a flag test as `$x'Flag`. The flag read yields truth on a receiver with no valued route. Use the type of the actual receiver.

A presence test of a key that no stage supplier can provide gives false and adds an audit note. A read that needs that key's payload fails when the loader knows the stage interface.

Truth conversion never changes a payload read into a presence test.

On a bag or node, `.has-value(k)` requests only the winning entry’s kind. Absence and bare presence give false. Any payload gives true, including zero, the empty string, an empty list and an empty bag. The test never forces that payload. On the true path, retain only valued states for that same receiver and literal key.

On the false path, retain only absence and bare presence. Mixed emission remains legal. In CLL, `$i'Indicator` and `$i'FUhE` read bare keys. A mixed bare and valued interface fails at the unrefined read. Never drop a token to repair that type error.

A payload operation must accept every remaining payload type on that path. A statement entry must bind its captures on every applicable route or guard their use under §3.6. The stitched listing prints the permitted names and these inferred alternatives, including the two required strings.

Process feature declarations in their written order before recognizing the stage. Here `$` denotes the input span. Reject a feature decision that depends transitively on a gate of this stage. This includes a function call into a gated table. A feature gate before an entry runs before its expression guard.

A failed gate skips the guard and entry. Structural document checks cover inactive branches of conditional expressions and entries with disabled gates. Specialize constants, suppliers, types, proofs and masks for the enabled alternatives before recognition. Reject an ill-typed reachable read at its source. Unconditional closed errors belong to loading.

Errors dependent on specialization belong to the affected stage. Preserve both the possible interface and the specialized interface. Neither depends on finding a particular output token.

For a layer that adds a class, see the [pipeline procedure](pipelines.md#procedure). A pass-through stage takes the upstream effective key set even for an invocation with empty output. A gated-off upstream permission cannot expose a downstream private field. Cache source DOMs independently of features. Cache specialized constants, lowering and memo answers only under equivalent version bindings, Unicode tables, input interfaces and relevant gate outcomes.

### Operators and truth

Here K denotes a key set, B a bag, N a number, P a pattern and T an element type. No operator implicitly maps a list or converts a node to a string. Reject an unknown method, a wrong receiver or a wrong argument count at load.

| Form | Signature and result |
|---|---|
| Property read, property copy | Node or B and key. See [Expressions](notation.md#expressions). |
| Bare key, key chain, deletion | Constructor entries. A chain accepts one stored value for every named key. |
| Bag splat, list splat | B or node supplies entries. A list supplies its elements in order. |
| Gate, guard, conditional | Gates read switches. Guards and conditional tests use truth conversion. A conditional requires compatible branch types. It joins their types and evaluates only the selected branch. |
| Function, application | One parameter and a body with a nonfunction result produce a unary function. Apply the named constant to one argument of its parameter type. |
| Method, map, flatten | Dispatch by receiver. Mapping a function from T to U over `[T]` gives `[U]`. Postfix `↓` maps `[[T]]` to `[T]` by concatenating one level. |
| `++`, `+` | Two strings give their concatenation. Two numbers give their exact sum. |
| `∪ ∩ ∖` | Two key sets give a key set. Two patterns give a pattern on the same candidate. List difference follows [Lists, functions and numbers](notation.md#lists-functions-and-numbers). |
| `= ≠` | Truth for like strings, numbers, truths or key sets. Compare key sets by their members. |
| `< ≤ > ≥` | Two numbers give truth. |
| `∈ ∉` | One comparable element and a list of such elements give truth. List element comparison follows [Lists, functions and numbers](notation.md#lists-functions-and-numbers). |
| `⊆ ⊈` | Two key sets give truth. Inclusion tests every key of the left operand. |
| `≅ ≇` | The left operand is a bare capture or the current function item, bound to one node. Compare it with a pattern or another bound node. Both operators return truth. |
| `¬ ∧ ∨ ⟹` | Convert each reached operand to truth. The result is truth. Evaluate left to right and short-circuit inside one predicate. |

A node's bag and span are separate observations. Truth conversion applies in a condition, guard, conditional test, Boolean operand or predicate result.

| Operand | Conversion |
| --- | --- |
| Truth | Keep the truth value. |
| Node | True for any bound node. |
| Span | True if its window contains an original token. |
| List | True if it contains an item. |
| Bag or key set | True if any key is present. Do not demand the payload. |
| Forest | True if it has an eligible root. |
| String, number, pattern or function | Type error. |

Every reachable operand type must support conversion. Apply refinement before the read. On the true path of `.has(k)`, exclude absence. On the true path of `.has-value(k)`, exclude absence and bare presence. On its false path, exclude every valued state. Apply these refinements only to the same receiver and key.

### Method signatures

A node forwards span methods through its span. Its own `.flags` and `.classes` methods take precedence. A span carries original input tokens and excludes synthetic ones. Let p be an empty window within the evaluating window [L,R).

| Receiver | Methods and results |
|---|---|
| Node | `.span` returns its span. `.children` returns immediate working occurrences in body order. `.present` is true even at zero width. The bag methods below use its working bag. |
| Node children | Expand ordinary groups, optionals and repetitions with their separators. Keep a spliced call as one working child with its own bag. Keep chain levels. An erased child's two strings are empty. |
| Bound node | `.without-elision` and `.without-elision-except(family)` return restored spans for this proof, even at zero width. `.followed-by(targets)` and `.preceded-by(targets)` return truth with boundary obligations (§4.2). |
| Leaf | Node methods. Its children form an empty list. A written leaf reads its input bag. An omitted leaf has its default value, empty image and empty place. |
| Span | A span has no `.present` method. `.tokens` returns the ordered original leaves, empty on an empty input window. |
| Span | `.flags` and `.classes` union the corresponding key sets of tokens in the input window. Both give `{}` on empty input. |
| Span | `.first-token` and `.last-token` return ordinary spans of zero or one token. `.tokens-after-first` drops at most one token. All three preserve p on an empty input window. |
| Span | `.onward` extends from the start to R. `.following-tokens` extends from the end to R. `.preceding-tokens` extends from L to the start. On empty these give [p,R), [p,R) and [L,p). Only `.onward` preserves restoration constraints. |
| Span | `.starts-input` and `.ends-input` compare its respective endpoints with L and R. Both hold on a whole empty input. |
| Span | `.source-text` and `.decomposed-source-text` return the original slice and its Unicode decomposition. `.verbatim-text` also claims eligible adjacent uncovered text in §11.2. Empty gives an empty string and makes no claim. |
| Span | `.parse(query)` returns a forest. An eligible empty target can succeed at p. See [Forests and deterministic errors](#forests-and-deterministic-errors). |
| Bag or node | `.has(k)` tests key presence. `.has-value(k)` tests for a payload without evaluating it. Both take a literal key. `.keys` gives all keys, `.flags` the capitalized keys, and `.classes` the class-shaped keys. Each result contains bare keys only. A class name starts and ends with an ASCII capital. Engine names are outside that class. |
| Bag or node | `.select(K)` returns the receiver entries present in the mask, with original payloads. A possible valued entry in the mask is a type error. `*$x.select($x.flags)` copies visible entries with their values. |
| Key set | `.overlaps(K)` tests whether the two sets have a common key. An empty set matches none. |
| Classifier bag | `.classify(string)` returns a key set by [Classification](#classification). A lookup with no match gives `{}`. |
| List | `.present` tests nonemptiness. `.all(predicate)` and `.any(predicate)` convert each reached result to truth and stop at the first deciding item. On an empty list the results are true and false respectively. |
| List | `.join()` and `.join(separator)` concatenate strings in order. The default separator is empty. `.union` unites a list of key sets. Empty input gives the empty string or key set respectively. |
| String | `.split(delimiter)` and `.ngrams(width)` give lists of strings. A width that exceeds the scalar length gives an empty list. Its decimal value has no machine-size limit. |
| Number | `.at-most(k)` caps the number at a decimal literal. |
| Forest | `.any()` tests existence. With a predicate, `.any(predicate)` or `.all(predicate)` visits each eligible root. `.flags` gives a key set. `.error-free` filters by blame. |

A span's data methods observe original tokens. A forest never supplies a scalar property read. `$` is the rule occurrence inside a rule and the input span inside a feature declaration.

During recognition a list of candidate bindings admits the following reductions. An ordered map includes a property selector, method selector, function literal or named function. Each step requires ready operands on the same proof.

| Source | Allowed consumer |
|---|---|
| Capture list | Truth conversion, `.present`, direct `.all` or direct `.any` |
| Capture list with ordered maps | Truth conversion, `.present`, `.all`, `.any`, string join or key-set union of the appropriate element type |
| Capture list of suitable values | String join or key-set union after an ordered map to those values |

Each reached map evaluates every item in order. A later reduction cannot hide a map error. A direct predicate can stop early. Keep correlated observations until required outer operands arrive. Reject other recognition uses that need a list of candidate occurrences. Concrete input-token lists and lists on a chosen reading support the ordinary list operations.

### Number bounds

Numbers are natural numbers. Each literal has the singleton range of its value. The largest count literal, stored number and cap is 255. The width of `.ngrams` uses its separate grammar. A range in this section is an inclusive inferred interval. A quoted scalar range in a body remains a terminal range.

Addition uses the mathematical sum and adds the endpoints of the operand ranges. A temporary sum can exceed 255. Comparisons use the full result. `.at-most(k)` maps each value and each interval endpoint to its minimum with k. For example, `(3 + 1).at-most(3)` gives 3. The uncapped sum is 4.

Infer bounds from the possible winning suppliers, including defaults, primary copies, alternatives and recursive steps. Join their intervals by taking the least enclosing interval. Iterate from no possible value. A store must prove a finite range within 0 through 255.

Reject unbounded growth and out-of-range literal counts. A public key set supplies no bound, and assignment never clamps. For a recursive scan, a cap on the recursive result can establish the bound.

## 11. Emission

### 11.1 Selecting nodes

A leaf selects no output. An ordinary rule without an output directive forwards child outputs in order. Bare `%emit` selects the rule itself. At a transparent splice, bare emission creates an implicit braced item over the call. A list replaces forwarding.

Evaluate gates, then guards. A skipped item supplies neither an anchor nor a token. Only reached expressions can claim verbatim text. A reached guard can claim text before it returns false.

| Item | Meaning |
|---|---|
| `$x` | Forward the part’s selected tokens. On a list, concatenate the selections in binding order. Reject bare `$` in a list. |
| `$x{…}` or `${…}` | Create an anonymous occurrence at one selected node. Use the part’s two strings as initial entries, then apply the braces in order. |
| `ε{…}` | Create a childless occurrence. The braces provide both strings and the engine records the inserting rule. |

Resolve braces in the emitting rule’s scope. No anonymous node invokes `$DEFAULTS` or executes another emission. A skip or absent copy preserves an inherited string. A deletion can remove it. The loader must prove that both strings exist after all writes on every active publication route.

A bare field, including bare `image`, fails this requirement. Changing a token’s image never changes its text or source.

For unguarded covers use the [structural consuming analysis](#emission-overlap). Examine surviving rules, including unreachable rules. Include gated alternatives and reads inside erased rules. Ignore body tests and conditions for possible consumption. Reject duplicate or nested consuming covers and reversed consuming slots in one production. Include forwarded selections that can consume under an unguarded writer.

Solve their possible consumption by least fixed point. Suppressed descendant emission alone creates no conflict. Order stitch errors by rule, alternative and written item pair. Recheck actual order and overlap on the selected output.

Anchor an insertion before the first following surviving cover in its list. An empty cover qualifies. Skip other insertions, even forwarded ones. A forwarded empty token list supplies no anchor. Use that cover’s span start and source start.

Without a following cover, use the emitting occurrence’s end and its ordinary empty source boundary. Preserve a previously computed forwarded anchor. For input sources [0,1) and [2,3), an insertion before the second token uses source point 2. An ordinary empty occurrence at the same input boundary uses point 1. Require nondecreasing stage-input placement and disjoint nonempty spans.

Never impose original source order.

Publish the selected bag through its effective output mask, with value and image always included. Copy each present entry as bare or valued. A permission without a supplier adds nothing. A classifier supplies classes at its lookup. Only successfully published tokens advance the pipeline.

Copying `$x.flags` forwards bare names. To preserve their payloads, copy `$x.select($x.flags)`.

### 11.2 Verbatim claims

Verbatim reads are late. Start with the base source envelope. Extend each side independently through adjacent uncovered original text, bounded by its stage-input neighbor. Empty spans claim nothing. Identical input spans share a claim.

Different input spans conflict only where their claimed extensions intersect. Base-source overlap alone is legal. Reordered sources can leave the same intervening comma available on two sides. Rendering never evaluates this operation.

### 11.3 Presentation

Keep provenance and display as separate relations. From a visible unit follow its primary. At an input leaf follow that token’s existing face. Stop at stage zero, caller input, an insertion or an ordinary lexical unit with no primary. A sole-symbol copy alone adds no display link.

An ordinary unit without a primary shows once through its image. In `ba'e zo broda ui`, display BAhE, one quote core and UI. The quote’s opener and content remain structural descendants, retrievable from a full producer tree. Compact producer records can omit those children.

For each sibling subtree beside the primary, skip erasure and take its selected units in order. Grouping rules without their own selection forward descendants. A subtree that selects nothing gives no satellite. Demand the visible units’ classes and images, including covered satellites. The visible parent’s effective image replaces the image along the primary path exactly once.

A braced item presents through its part, with its own replacement image. Do not expose nested lexical content underneath a closed quote.

Evaluating a visible satellite image can fail. A hidden inner image cannot claim a neighboring comma. Displaying the result never reevaluates a guard, image expression or query. The tree-only stage reads input faces without opening a new output walk. A leading `ui nai` is one attitudinal unit, as after a word.

The syntax rule for an indicator consumes the decorated token. The two words remain inspectable at their original places. Keep the indicator-stage primary on a word wrapper that must expose an incoming decorated word’s satellites. An implicit copy supplies the bag but stops that presentation path.

### 11.4 Diagnostic carriers

Diagnostic support comprises live stage-input leaf indices under an occurrence. Exclude erased subtrees and include live unlisted leaves. A braced item uses its part’s support. An insertion has none. Forwarding preserves support. Ranges or a traversal can represent support without storing a set at every node.

For an own report use the raising occurrence and its span start. For a carried report use the input leaf that reads its carrier. Apply these rules in order.

1. Drop every report under erasure. Otherwise use the first final token whose support intersects the report’s support.
2. Search the occurrence and its ancestors for the nearest executed emission yielding final tokens. Within it, choose the first token whose support ends at or after the report’s start. For empty support, use its span. Failing a qualifying token there, use the last token there.
3. Otherwise choose the first final token starting at or after the report’s start, else the last token.
4. With no final token, keep surviving reports on the stage. Tree-only completion uses this case.

Store each carrier’s records by raising stage and raising preorder, separately by severity. Final reporting visits pending stage records and then the reporting proof in source preorder. A later erasure removes the carrier’s reports. A diagnostic highlight can use a core. Its stored origin and ranking charge never move.

## 12. The tree

An occurrence is one rule or leaf visit in the chosen derivation. It has an identity, its ordered working children and a place. A working splice call keeps its own identity, bag and diagnostic ownership. Its children take the call's place in structural matching. Chains keep an occurrence for each closed level. Generated grouping and repetition helpers add none.

Structural output keeps the chosen occurrence records, including elided leaves. A braced item or insertion appends a new occurrence beside the original tree. A braced item records its part. A projection or insertion records its emitting rule or splice ID as the local integer `producer`. Forwarding preserves this ID. The new occurrence is not a structural child of its producer.

Number body occurrences in preorder before splice flattening. Append synthetic occurrences in producer preorder, item order and binding order. The implicit projection of a spliced emission uses item zero. Reuse each synthetic occurrence for publication and presentation. See [result records](output.md#a-parse-result) for compact retention and qualified references.

### 12.1 Deferred reports

A diagnostic belongs to a source occurrence, before tree construction omits spliced calls. Every `%error` occurrence contributes one error. Every enabled, unsuppressed `%warning` occurrence contributes one warning. Each chain level and source occurrence counts separately. A failed condition creates no occurrence.

The raising stage assigns each diagnostic a private identity: stage, effective rule, and preorder occurrence ordinal among that stage's diagnostic occurrences. Number the source occurrences before warning enablement, suppression, and erasure remove reports. Concrete neighbor variants share one occurrence and identity. Two occurrences of one rule at one boundary retain different identities.

Carried diagnostics keep their identities and fixed charges through later stages. A collection includes each carried identity once.

A diagnostic stores `stage`, `code`, `rule`, `span`, `source`, and `message`, followed by optional `rejection`. Its code is its rule's effective name. Its coordinates remain those of the raising stage. Neither identity nor charge appears in canonical JSON (`docs/output.md`).

After choice, evaluate live enabled diagnostic messages in preorder with each occurrence's finished bag. Skip erased subtrees and disabled or suppressed messages. For a tie, evaluate the first displayed reading and then the second, with distinct occurrence memos. A message failure gives `grammar` and keeps the eligible diagnostic prefix.

Suppression applies to the raising stage's own warning occurrences under its owning rule, including that rule and spliced calls. Nested suppression sets unite. `_` suppresses all warnings, and a disabled warning stays disabled. Suppression neither removes carried warnings from earlier stages nor affects errors, measures, recognition, ranking, or emission. Templates pass suppression to each instance.

After stitching, every explicit suppression code names a warning of that stage. The audit notes codes that the subtree cannot raise. Diagnostic and suppression clauses belong only to their written definition's productions. Extensions inherit neither clause.

The reporting stage is the stage named by `until`. Without `until`, it is the pipeline's last stage. Stage order means pipeline execution order, rather than name order. Earlier stages with chosen errors evaluate messages, emit, assign carriers, and continue. They retain their verdicts and outputs. A stage that emits an empty output retains its unowned diagnostics in its stage-level `errors` and `warnings` (§11.4).

For a chosen reporting derivation, the engine collects earlier stage-level diagnostics first, in stage order. It then walks the reporting derivation in preorder, skipping erased subtrees before spliced roots disappear. An own-stage occurrence supplies its diagnostic, and a token leaf supplies its carried lists. A parent precedes children, and siblings retain their written order. Errors and warnings preserve that order in separate lists. A token leaf supplies its carried lists in their stored order, in raising-stage and raising-occurrence order.

Every ending first includes the pending stage-level diagnostics of earlier stages, once by identity. Its remaining collection is as follows:

- `ok`: No error counts. Collect warnings from the chosen derivation as above.
- `reported`: At least one error counts. Keep the chosen tree and verdict. Keep any completed publication at the reporting stage. The envelope lists all counted errors, and the result lists all counted warnings.
- `rejected`: No complete derivation exists. Collect carried diagnostics in input-token order through the furthest token, including that token. At input end, include every token. These are input facts, independent of a chosen reading. The result has no failed-stage output.
- `ambiguous`, reason `tie`: Collect the two shown readings as below. Keep the tie verdict and stage witness, with a null result tree and no output. No later stage runs.
- `ambiguous`, reason `elision-only`: Use the `ok` warning collection over the chosen derivation. No error counts, including at stage level, so the envelope has no `errors` member. Keep any completed publication.
- `feature-conflict` or `grammar`: Collect carried diagnostics over the whole failed-stage input in token order. For a grammar failure after choice, insert evaluated own-stage diagnostics after pending stage-level diagnostics and before the carried list. Their order is the chosen preorder, or the two readings' evaluation order for a tie. The `grammar` ending omits evaluated own-stage diagnostics from erased subtrees. These failures have no failed-stage output and a null result tree.

A failure's `errors` and `warnings` members use the envelope rules of `docs/output.md`. The result's `warnings` also contains its complete warning collection. Warning controls change neither recognition nor the selected derivation.

A tie collection starts with pending stage-level diagnostics once, then the first reading's counted diagnostics, then new diagnostics from the second. A carried identity already included does not repeat. Own-stage identities are reading-local, so compare their complete output objects, including `rejection`, by multiplicity. A second-reading occurrence is new only beyond the multiplicity already collected for its complete object. Apply this rule separately to errors and warnings. Diagnostics from unshown readings contribute nothing.

#### Competitor rejection evidence

After message evaluation, an error whose occurrence is itself a ranked option can receive a `rejection` member. A descendant error inside an option, a plain alternative, or a spliced recovery receives none. The competitors are the other options and other alternatives of the enclosing written definition with entries at the error's start.

Starting at those entries, traverse the chart items and advances reachable through productions without `%error`. Include descendants at their own origins, rather than restricting every item to the group's origin. This is the competitor slice. Compute ordinary rejection evidence over that slice, with the furthest boundary capped at the error occurrence's end. Take expected terminals from slice items at that boundary. If the slice contains no item, omit the member.

The member holds `token`, `source`, `line`, `column`, and `expected`, in that order. Flow preserves its raising-stage coordinates. Computing it costs one reachability pass over the chart per qualifying reported error. A tie computes it separately for each shown reading after its messages. An all-error ranked group can obtain evidence from a non-error alternative of its enclosing definition. Only an empty competitor slice omits the member.

#### Failure order

| Point | Behavior |
|---|---|
| Document and stitch | Use written positions and template expansion order. Inspect syntax and types before specialization. Perform unconditional overlap analysis last in each stitched stage. |
| Lowering | Resolve gates, suppliers, shape refinements, span proofs and live cycles. Report an invalid early dependency at its reader with the dependency path. |
| Recognition | Run active conditions at their first ready step. Cache a dormant failure without reporting it. Preserve the established order of active condition and obligation trials. |
| Messages | An evaluated message error gives `grammar`, the completed verdict and eligible diagnostic prefix. No failed-stage output or reconstruction follows. |
| Tie | Evaluate messages and competitor evidence on the first and then second displayed reading. Use distinct occurrence memos. Run no current-stage emission, presentation expression or claim. |
| Chosen publishing stage | Select items and visible satellite subtrees. Evaluate operands in expression order, public fields in scalar name order, then visible presentation in display order. |
| Publication commit | Earlier expression failures win. Test dynamic placement, then recorded claim conflicts in evaluation order, then assign owners. Commit only the complete publication. |
| Chosen tree-only stage | Build its structural tree and surviving reports. Do not evaluate output lists, braced items, output guards or current-stage token faces. Display input leaves from their existing faces. |
| Finish | Report counted errors at the reporting cutoff. Otherwise run the enabled elision test. Preserve earlier stages, input tables and the appropriate failure collections. |

For a tie, collect pending identities once. Add reports from the first reading, then new multiplicities from the second. Deduplicate carried identities. Compare own diagnostic objects by multiplicity, separately by severity. A second-reading message failure takes precedence over ambiguity. Keep the tie verdict and action witness, without reading tables or output in that failure case.

See [Verbatim claims](#112-verbatim-claims) for claim evaluation and conflicts.

On publication failure, discard uncommitted anonymous nodes, tokens, faces and claims. Keep the chosen structural stage root and a null top-level tree. An elision ambiguity keeps both displayed readings over the original input. It also keeps any completed publication and its referenced records. Its top-level tree is null. A restoration grammar failure or lost witness suppresses that stage’s publication.

Keep earlier completed stages intact. A tree-only reported error retains the chosen root and has no output member.

## 13. The pipeline

Bundled pipeline names are directory paths below `grammars/`, with two or more `/`-separated segments. Each segment matches `[a-z0-9][a-z0-9-]*`. The loader checks this spelling before any document lookup and accepts no short aliases. It reads `grammars/NAME/pipeline.md` for a valid name. Invalid names and absent bundled pipelines cause a `usage` error.

`bundledPipelines()` takes each bundled key that starts with `grammars/` and ends with `/pipeline.md`. It removes that prefix and that suffix. Its result uses code-point order. The spelling for each language follows `docs/api.md`.

A directory without `pipeline.md` defines no pipeline. Enumeration includes only valid pipeline names. This discovery uses no separate catalog file.

A pipeline document (`docs/design.md`, "Pipelines") defines a pipeline. The loader reads it into stages as follows.

To splice a pipeline, the loader reads the pipeline document's items (§9) in order. It expands each `%include "PATH"` into the items of the document at `PATH`, read in the same way. It resolves the include path `PATH` against the directory of the document that holds the `%include`.

An include or names target is a relative path. A target that starts with `/` is a grammar error at the directive. The resolver joins the target to the declaring document's directory and cleans the result lexically, as POSIX paths do.

It collapses `.` and each `..` with a preceding parent segment. A preceding `..` cannot serve as that parent. It keeps any `..` that climbs above a relative base. Above an absolute root, `..` stays at the root.

Disk loaders open the resolved path. Source-map loaders look up that exact key, so an absent key gives the ordinary “was not found” error. The loader preserves caller-supplied source keys and the pipeline path exactly.

`%stage NAME` creates and selects a stage. `%extend-stage NAME` selects an earlier stage and appends subsequent stage items to it. `%redefine-stage NAME` selects an earlier stage and clears its accumulated stage items, including earlier extensions. Both selectors preserve the stage's execution position.

Stage selection continues across grammar blocks and include boundaries. The includer's next item goes into the stage selected at the end of the include.

Replacement clears rules, constants, local feature declarations, and the ambiguity policy. It does not clear global `%features` or other stages. Later extensions append to the replacement. Names preambles select document-scoped resources before include expansion (§1). Splicing consumes those declarations without changing the selected stage.

The loader reads every source document, including source whose stage items a later replacement discards. Only surviving stage definitions undergo grammar validation (§2). This includes every feature check in this section. Discarded feature declarations and replaced rule alternatives undergo none of these checks. Source syntax, DOM shape and depth, and include errors still fail the load.

A `%features` before the first stage selector declares global defaults. Every later `%features` belongs to the selected stage, including across include boundaries. The loader stitches each stage's other items in order (§2). Each of these is an error of the pipeline, and the loader reports it at the item named:

- An `%include` of a document that does not exist is an error at the `%include`. The error names the documents that included it.
- An `%include` of a document that is already being included, which is a cycle, is an error at the `%include`. The error names the documents that included it.
- A rule, resolution directive or constant definition before the first `%stage` is an error.

- A `%stage` with the name of an earlier one is an error.
- An `%extend-stage` or `%redefine-stage` that names no earlier stage is an error at that selector.
- A stage with no rules is an error at its `%stage`.
- A pipeline with no `%stage` is an error.

A document can be included more than once, in one stage or in several. The loader reads its items again each time.

The first stage reads stage-zero tokens, or caller tokens that bypass stage zero (§1). Each later stage reads the preceding stage's emitted tokens. The caller's `until` names the last stage to run, inclusive. If the caller omits `until`, every stage runs. This cutoff selects the reporting stage (§12.1), so carried errors appear there even during inspection.

The caller's enabled features and the global defaults are on from the first stage, less the caller's disabled features.

A caller who names one feature both to enable and disable makes a usage error. Unknown feature names are legal.

Before each stage parses, the engine evaluates its conditional feature declarations on that stage's input, in declaration order.

Each declaration's conditions form a conjunction with the usual short-circuit rules (§10). Each declaration evaluates once, even if its features are already enabled.

Here `$` is the whole input span. Its truth follows whether it contains an original token. A feature declaration can read input strings, source, token slices, key sets, token bags and pure functions of these and closed constants.

Reject context extension, queries, neighbors, restoration, verbatim claims, patterns and named captures, even in a branch that cannot run. Reject a dependency on any gate of the same stage, including a dependency through a constant, classifier or function call.

Resolve feature declarations in input order before specialization. Preserve the possible input interface and the invocation's specialized interface. Neither depends on the presence of a particular emitted token.

Feature conditions undergo every applicable loading check of rule conditions, including closed delimiter checks after constant binding.

A global declaration with conditions, or conditions on another directive, is a loading error at that directive. Reject forbidden conditions before converting them. A diagnostic contains the directive location once.

If all conditions hold, the declaration processes its operands in written order. It enables each operand until it reaches one that the caller disables. At that operand it stops with a `feature-conflict` result. The error names the stage and feature, without a position. Earlier operands stay enabled from this stage onward.

An unconditional declaration enables its features at the same point, but skips disabled operands without a conflict.

An enabled feature stays enabled.

The engine evaluates the declarations in order. It stops at the first declaration that holds and names a disabled feature, or whose condition raises a runtime error. That declaration decides the result. Within one declaration, the error names the first disabled feature in operand order.

The failed stage has a null verdict, no tree, and no output. Earlier stage outputs remain. Diagnostics follow the failure collection of §12.1.

A runtime grammar error in a feature condition ends the stage with the usual `grammar` result and a null verdict.

An `until` before a stage never evaluates that stage's declarations. Each stage parses at most once.

A stage-local feature is a loading error if a surviving earlier stage tests it, whether or not it also has a global declaration. The loader reports it at the local `%features` declaration, and the message names the earlier stage. The feature's own stage and later stages can test it. Caller configuration cannot bypass this loading rule.

The loader rejects a pipeline without stages or a stage without rules before it examines local feature ownership. Two different stages cannot declare the same feature locally. The loader reports the second surviving declaration in document order, after include expansion. Several declarations of one feature in the same stage are legal. The engine evaluates each declaration in order.

The loader examines gates within surviving rules and constant expressions before feature filtering.

A rejection, ambiguity, feature conflict, or grammar failure ends the run with the collection of §12.1. Chosen errors before the reporting stage do not stop it. At that stage, counted errors give `reported` with the chosen tree and verdict. A publishing stage reports after successful emission and keeps its output. A tree-only stage has no output.

The result's `tree` is null for every error except `reported`, including failures after choice. When no error counts at the reporting stage and no other failure occurs, `ok` is true. Warnings follow the collection and erasure rules of §12.1, rather than unconditional accumulation across stages.

A pipeline's features are its gate names, warning-rule names, and names declared by `%features`. Error codes are not selectable features. The counted gates and diagnostics come from each stage's surviving definitions after stitching (§2). Alternatives that `%redefine-rule` replaces and stage items that `%redefine-stage` discards no longer count. The gates of constant entries count too. The loader counts them before any gate drops an alternative (§3.1), whatever features are on.

Local declarations also contribute their names to this inventory. An unconditional local declaration sets `default:true`, as a global declaration does, even when the caller stops before that stage. A conditional declaration sets no default.

A gate uses `f?` or `¬f?`. A warning feature names a `%warning` rule and has kind `warning`. One name cannot serve as a gate, warning code, or error code in different roles anywhere in the pipeline. During pipeline loading, the loader rejects role conflicts. A `%features` declaration cannot name an error code.

A name that only `%features` declares is a gate. A pipeline lists its features, each with its kind and whether an unconditional `%features` declares it as a default. Conditional declarations contribute names, but no defaults.

An invalid cutoff, malformed scalar string or malformed caller token gives a `usage` error outside the result.

A grammar error found while parsing is a result. Examples are a nested parse asked about its own span as the same rule, and a `split` with an empty delimiter. Its error has kind `grammar`, the `stage` that it arose in and a message, and no position. The check of §7 can also end with an error of kind `grammar` and the code `elision-witness-lost` (§7.9). That error also has `chosen` and `completion`. It ends the run.
