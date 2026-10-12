# gencmu: design

## What gencmu is

gencmu is a Lojban parser whose grammar is data. A literate grammar combines grammar blocks with explanatory prose. Every language layer uses the same jbogenbau notation. A dialect is an ordered pipeline of grammar stages. A stage reads tokens and emits tokens. A token is one input or output unit.

The pipeline starts with character tokens and can end with a syntax tree. A phoneme is a unit of sound. The Lojban dialects interpret characters as phonemes, normalize their values, recognize words, process the word stream, attach indicators, and read syntax.

The repository supplies four independent libraries, in JavaScript, Python, Go, and Rust. They implement the same [engine specification](engine.md) with their standard libraries. Grammar documents, pipelines, and shared tests define one contract for all four.

Grammar authors need to read rules and understand their effect. The notation keeps recognition bodies separate from tags, conditions, and emission. Diagnostics expose conflicting readings instead of choosing an unstated interpretation.

## Repository layout

`grammars/` contains the source grammar documents. `docs/` contains the specification and author guidance. `tests/engine/` exercises engine behavior. `tests/notation/` exercises document reading and DOM conversion. `tests/corpus/` records Lojban expectations.

`lib/` contains the four libraries. `playground/` and `index.html` provide the browser interface.

Each package includes its own grammar copy. `node tools/sync.js` generates these copies, precompiled DOMs, browser bundles, and railroad diagrams. Generated artifacts remain in Git. A diagram is an SVG drawing of paths through a rule.

`dist/gencmu.js` is a classic browser script. `dist/grammars.js` supplies grammar sources without a network request. The playground can therefore work from a local file or a static host. Its worker parses in the background so that long input does not freeze the page.

## Standard library only

The libraries require no external runtime dependencies. Development tools can use dependencies for type analysis, packaging, Markdown analysis, and browser tests. Those tools do not become library requirements.

JavaScript uses JSDoc annotations and generated declarations. Python uses standard JSON support. Go uses embedded grammar files. Rust supplies its own reader and writer for the shipped JSON data. Each implementation remains independent of another library's code.

## Values and images

A value is the token string that comparisons read. An image is the token string that people see. Tags classify tokens independently of these strings. A constituent is one occurrence of a matched rule. It stores tags but neither string.

These separate channels let a grammar preserve spelling while comparing normalized values. For example, a stressed vowel can have value `a`, image `A`, and tag `Stressed`. A syllable comma can have an empty value, image `,`, and tag `Syllable-Break`.

The engine only concatenates strings. It assigns no meaning to pauses, stress, commas, phonemes, or quoted text. A grammar owns every mapping and spacing decision. This keeps a dialect's language policy visible in its documents.

Stage zero, named `input`, supplies one token per scalar value. A scalar value is a Unicode code point outside surrogates. Both token strings start as that character. The configured Unicode table supplies stored category and whitespace tags. Later stages only forward or filter those engine tags.

A class is a tag with capital letters at both ends. It never starts with `_`. This identifies `KOhA`, `BRIVLA`, and `FOREIGN` as classes while leaving `Word` and `Run-Final` as marks. Renderings use this same definition for attachments.

## Normalization is a stage

The Lojban normalization stage stands after phonemes and before forms. Each mapping tests both a value and its tag. It changes values and preserves images, tags, order, token count, and source metadata.

```jbogenbau
%stage normalize
%ambiguity-resolution lazy

%rule text
  [{unit}]

%rule unit :- $.image
  | "A"<Stressed> := "a"
  | "E"<Stressed> := "e"
  | "I"<Stressed> := "i"
  | "O"<Stressed> := "o"
  | "U"<Stressed> := "u"
  | "Y"<Stressed> := "y"
  | ","<Syllable-Break> := ""
  | _<¬Stressed ¬Syllable-Break>
%emits
```

The explicit image recipe beats the implied image of each alternative value recipe. Single-symbol inheritance forwards tags. The catch-all forwards tokens carrying neither mapped tag. A tagged value without its mapping fails instead of silently inventing a normalization.

The phoneme stage puts `Stressed` on the mapping that writes the stressed value. A split diphthong marks only its stressed first token. An extension that merely forwards another rule relies on inheritance. An explicit tag clause replaces that inheritance and can lose `Syllabic`.

All bundled Lojban dialects map syllable commas to empty values. The forms stage reads their surviving `Syllable-Break` tag. It expresses dialect-specific restrictions on vowel boundaries through that tag. Zoi delimiter comparisons therefore ignore syllable commas while images preserve them.

A foreign token retains its exact value unless the grammar explicitly maps it. Unicode lowercase mappings play no role in the engine. A value containing the Kelvin sign does not silently become its ASCII lowercase spelling.

## Two walks and recipe placement

A recipe supplies one string channel. `:=` supplies a value and an implied image. `:-` supplies an explicit image. Recipes can stand on an emission item, alternative, or definition. Their precedence belongs to [engine §11](engine.md#11-emission).

The emission walk determines which tokens reach the next stage. A constituent with `%emits` emits its items and stops that walk. `%erased` contributes nothing. Without either directive, the walk enters children.

The string walk determines a covering token's value and image. It enters child constituents but skips their emission lists. Their alternative and definition recipes still apply. Erased children contribute nothing. Attachment ownership counts surviving input parts independently of either string.

An item recipe serves its directly emitted token. The following grammar gives `x` for input `a`, but `ab` for input `ab`:

```jbogenbau
%rule text
  child | parent

%rule child
  "a"
%emits
  $ := "x"

%rule parent
  child "b"
%emits
```

The following grammar gives `x` for input `a`, and `xb` for input `ab`:

```jbogenbau
%rule text
  child | parent

%rule child := "x"
  | "a"
%emits

%rule parent
  child "b"
%emits
```

The child definition recipe serves both walks. A recipe that must apply inside a parent belongs on the child alternative or definition. The author guide uses this rule for quote bodies and gaps.

Recipes use a closed string language. They concatenate literals, string constants, and six captured string methods. They cannot branch, inspect tags, split strings, classify words, or start queries. This keeps emission independent of recognition and makes channel dependencies explicit.

Only requested selected recipes run. `.emitted` reads a constituent before the current item's override. Cross-channel reads can terminate through an explicit recipe. An effective constituent channel that depends on itself causes a document cycle error, even when an item overrides its runtime string. Engine §11 states occurrence identity and suppressed dependencies.

## Pauses and spacing

A Lojban phoneme grammar gives a pause value and image `" "` and tag `PAUSE`. The engine never trims edges or merges repeated spaces. Rules that form a covering token express each surviving gap's contribution.

A gap is a run between lexical parts. A quote gap excludes erasures because quoted `si`, `sa`, and `su` are words. A compound gap retains erasure-aware recognition. These two contexts share a spacing policy but require separate recognizers.

The gap-tag invariant states how recipes receive decisions. A fact that a recipe cannot branch on travels upward as a tag. Grammar prose names where that internal tag starts, which rules forward it, and where it ends.

`Gap-Pause` means that a constituent contains a surviving pause. `hesitations` and `spacing` introduce it. `erasures` and `skipped` forward only surviving occurrences. Gap rules and `su-survivor` read it. Erased children never supply it.

`Trailing-Pause` means that a survivor's compound contribution ends with one space. `su-survivor` introduces it and `unit` forwards it. `lerfu-word` and `zei-compound` consume the state without forwarding it. The following BU or final ZEI word ends the state.

This classification preserves recognition alternatives instead of replacing them with an any-of pair that can overlap. Each fixed skipped derivation enters one gap alternative. Internal erasure ambiguity remains available to the existing ranking.

## Verbatim text

Verbatim text is original spelling with adjacent uncovered punctuation. `.verbatim-text` supplies it only in recipes. `.source-text` reads the covered source interval without that extension.

```jbogenbau
%rule raw-tokens :- $.verbatim-text
  | any-token
  | raw-tokens any-token
```

The outer image recipe replaces recursive descendant image contributions. Value concatenation still reads normalized body parts. The recipe applies inside compounds because it belongs to the body constituent. Forwarding stores the result and never reconstructs it from later neighbors.

An empty quote body uses plain empty concatenation and takes no neighboring punctuation. A foreign character run in the phoneme stage concatenates stage-zero character images. Its image therefore preserves its original text without a verbatim recipe.

The image extension does not enlarge `source` or `text`. This lets quote punctuation appear without changing source provenance. Different evaluated spans cannot claim the same uncovered text. The conflict rule avoids any hidden priority between touching quoted parts.

## Repetition, lists and chains

A list is an ordered collection without its own tree node. `{x}` repeats one or more items. `[{x}]` permits none. `{x / s}` inserts separators between items. An item must consume input, which prevents empty repetition cycles.

A chain records grouping through named recursive levels. `{... x / s}` groups left. `{x ... / s}` groups right. Each level receives the rule's conditions, recipes, emission, and warnings. A chain is the whole alternative so that every level includes its first operand.

Flat helpers have transparent closes for action ranking. An author who needs each repetition boundary visible uses a chain or explicit recursion. A single chain item can inherit its tags. A body with that item and an optional suffix has two logical symbols and inherits none.

## Elidable optionals and captures

An elidable optional marks a closing word that can be omitted. `[+KU #]` marks KU with its free-modifier slot. `[KU #]` is a plain optional and records no omission. The local marker determines tree leaves, omission counts, and reconstruction.

A capture names one symbol without changing interpretation. Plain optionals keep their logical helpers whether they hold captures or not. Ranking, tag inheritance, ranked tag safety, and query priority use those helpers. Physical expansion remains available for capture binding and diagnostic numbering.

Missing captures require different rules for different clauses. Conditions can become inapplicable. Absent emission carriers drop. Tag terms require guarded reads. Active recipes require a bound capture and use separate alternatives for optional cases. Private ranked captures never escape through a recipe.

## Structural pattern implementation

A tree pattern tests one constructed candidate. It never parses its words again. Primitive predicates follow sole-child wrappers, while branching, omitted leaves, and seals preserve structural boundaries. Pattern sequences test complete ordered child lists.

The recognizer compiles demanded predicates into finite observation states. Captures retain completed states alongside spans and tags. Packed edges preserve correlated answers from one reading. A packed forest is a shared graph of candidate derivations.

Equal observations do not merge distinct derivations for ambiguity counting. Named-rule cycles still use rule and span identity. Independent Boolean observations can multiply states. Measurements therefore record items, edges, states, contexts, elapsed time, and peak memory.

## Ranked choice design

A ranked choice filters candidates at one actual grammar position. Only options with equal spans and equal common prefix state compete. A failed higher option leaves lower options available. A seal hides private structure from outside patterns and aligned queries.

The local tag-safety proof prevents option tags from changing a common continuation. Private captures can serve ready internal conditions but cannot escape. The proof uses the same logical helpers as inheritance and ranking.

Ordinary queries read eligible proofs before admission. They do not choose an option or run recipes. Reconstruction finds the restored selected reading before filtering. Its raw absence is witness loss. Admission can exclude that present reading and produce an ordinary elision-only ambiguity.

## Pipelines

A pipeline document lists stages and their included grammar documents. `%stage NAME` creates a stage. `%extend-stage NAME` appends items to an existing stage. `%redefine-stage NAME` clears its items. Both selectors preserve execution position.

`%include "PATH"` inserts a complete document relative to its containing file. Selection persists through include boundaries. `%features` supplies global default features. Replacement affects neither other stages nor global features.

The loader reads every source document before validating surviving stage definitions. Source syntax errors remain errors even when a stage replacement discards those declarations. Every stage starts at `text` and declares exactly one ambiguity policy.

The bundled Lojban pipelines include `normalize` between `phonemes` and `forms`. Callers find stages by name. Pipeline order, rather than a fixed stage index, defines each stage's input.

## Gates and warnings

A gate selects an alternative through a feature. `f?` requires the feature and `¬f?` forbids it. A warning guard `f!` always keeps its alternative but reports chosen occurrences when enabled. Warnings change no verdict or tree.

A feature cannot serve both roles in one dialect. The caller can enable or disable declared defaults. Classifier entries can use gates to change memberships. Expensive erasure constructs can remain behind the `sa-su` gate.

## Expensive constructs behind features

The erasers `sa` and `su` can reach across many words. Keeping every possible reach increases parsing work. The bundled pipelines guard these constructs with `sa-su`.

Auto features first run through `words` without that gate. A failed prefix run or a chosen `word` constituent tagged SA or SU triggers another run with it enabled. Explicit caller disablement prevents this retry. The successful retry replaces the preliminary stages and warnings.

## Ambiguity

Recognition constructs eligible complete readings. Ranked groups filter them into admitted readings. Rule flags compare span profiles first. The stage directive compares remaining readings. `greedy` and `lazy` compare visible actions. `late-elision` compares omission counts by input boundary.

A sole admitted reading gives `unique`. Several with one best give `resolved`. Several best give a tie. The canonical diagnostic order chooses which tied readings to report. It never converts a tie into acceptance.

A tie emits no tokens and runs no later stage. Equal images do not excuse different derivations. Grammar rules must settle a grammatical overlap. Diagnostics expose two readings and their first differing actions.

## Elision-only

Elision-only restores the selected reading's omissions and tests its remaining ambiguity. It runs only after emission for a resolved stage when enabled. It uses the same grammar, features, and input values without repeating normalization.

Synthetic terminators expose recognition values to terminal tests. Rule tests and conditions read projected original input. Omitted pattern leaves observe empty strings and singleton terminator tags. The restored selected reading must exist before filtering and remain the sole best admitted reconstruction.

The operation never chooses a replacement reading. A competing reconstruction produces an ambiguity with the restored selected reading first. A raw missing witness reports a library defect. Engine §7 defines strict reconstruction routes and diagnostic ordering.

## Queries with fixed closes

A close is one omitted terminator at an input boundary. `.without-elision` creates a query view that preserves the captured candidate's closes. The receiver must be a bare capture. `.onward` can extend its match window while preserving that constraint.

An aligned witness preserves ordered close groups through the shared interval. Its prefix endpoint includes every close at that boundary. Synthetic evidence cannot become a required written word. Following original input keeps ordinary omission rules beyond the fixed capture.

Ranked blocks hide private closes outside their group. Ordinary nested queries receive no inherited alignment. Explicit nested restoration uses the witness's own captured closes. Shared observations preserve these distinctions without enumerating every complete tree.

## Syntax conventions

The bundled syntax stages use `late-elision`. CLL, Kihei, and BPFK also enable `elision-only`. The grammar expresses overlaps through conditions, patterns, and ranked choices. The engine gives no special priority to Lojban classes.

Plain joik and gihek readings exclude competing dedicated KE groups where the bundled grammar states that condition. Experimental gives sumti connections priority over term connections. Zantufa expresses attachment and early-closure policy in its syntax document. Those policies belong to the dialect, not to string evaluation.

Numbers and letter strings use grammar conditions for indivisible runs. CU and Zantufa's IAU remain plain optional separators. Their absence records no elided node. A grammar seeking an official preparser policy requires its own stage and lexical grouping rules.

## The result and API

Runtime grammar loading permits arbitrary named tree shapes. The result therefore exposes generic rule, token, and elided nodes. Named wrappers remain in canonical trees. Renderings can collapse them for readers. Captures and generated helpers add no named output node.

The result retains stage names, verdicts, output tokens, diagnostic witnesses, and parse warnings. Source coordinates count code points. Spans count tokens of the relevant stage. Inserted tokens retain `insertedBy`. Attached tokens lose their stage span but preserve original source coordinates.

The [API](api.md) supports bundled dialects, disk pipelines, and in-memory sources. Both token strings are explicit result fields. Pre-built input strings default independently to text. The engine adds no caller-token tags or normalization.

Result format 12 and DOM format 26 identify these contracts. Cache identity also includes source and bootstrap hashes. An incompatible bootstrap is a loading error. An incompatible cache entry is a miss.

## Diagnostics and debugging

A rejection reports its stage, source position, and expected terminals. A tie reports two readings and a witness. Grammar errors identify source declarations where available. Stage inspection shows stored values, images, tags, attachments, and coordinates.

The audit records undefined or unreachable rules, extensions, replacements, flags, and classifier membership changes. A trace shows parser advances and failed conditions. Recipe diagnostics identify channel dependencies and source positions. Empty images remain distinct from erased parts.

## CLI and playground

The CLI exposes `parse`, `dialects`, `features`, `audit`, `stitch`, `test`, and `help`. It runs through `node lib/js/cli.js`. `--pipeline` loads local documents. `--dialect` loads bundled copies. `--until` identifies a stage by name.

The playground exposes text, dialect features, stage tokens, rendered output, diagnostics, and editable grammar documents. Its editor stores browser changes separately from disk files. Download preserves an edited document. Reload discards unsaved browser edits.

## Output formats

[Output formats](output.md) defines canonical JSON and reader renderings. Canonical JSON preserves specification data. Brackets collapse unary groups and cycle delimiters by depth. The tree listing shows rule and terminal names. Display JSON projects the tree for reading. Every rendering uses token images.

## Documents

Each paragraph, heading, and table row occupies one source line. Code spans close on their opening line. Fenced blocks retain their layout. Grammar documents pair each include with a Markdown link. Shared tools enforce these conventions.

## Railroad diagrams

A railroad diagram shows recognition paths before conditions. Captures, tags, recipes, and emission do not appear as tracks. Ranked options receive numbered frames. Chains label their grouping. Elidable bypasses reflect omission tests.

`tools/sync.js` generates one SVG per rule and inserts collapsed elements after grammar blocks. Diagrams derive from the document DOM and resolved omission tests. Generated artifacts must match their sources.

## Tests and CI

Shared tests cover engine behavior, notation DOMs, and corpus results. Cross-library equality compares parsed canonical JSON. Corpus cases also record expected word images, verdicts, and brackets. Source provenance explains each corpus expectation.

CI makes sure that generated files, package contents, declarations, and browser behavior agree. Corpus runs cover each library according to the shared test procedure. Passing corpus cases does not establish recipe cycles, ownership, query sharing, or source-gap behavior alone. Focused engine and notation cases cover those contracts.
