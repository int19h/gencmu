# Compile format 50 source

The transition compiler uses the format 49 JavaScript engine. Its lexical and syntax stages build a tree. The DOM builder turns the tree into written declarations.

Run a command from the repository root.

```sh
node tools/transition-compiler.js document PATH
node tools/transition-compiler.js pipeline PATH
node tools/write-bootstrap50.js
node tools/check-seed50.js
```

The document command prints one format 50 DOM. The pipeline command prints the documents that the pipeline includes, with their source fingerprints. If a document has different readings, the command prints each entry with its inherited names files.

The bootstrap command writes the required seed and prints its SHA-256 digest. The seed check compares the package copy and inspects the method calls and property selectors.

The JavaScript package ships two source roots. The bundle manifest names each root, its bootstrap and its cache directory.

A cache omits a document with different readings. Diagrams use the first reading in pipeline and include order. The layout check includes documents that have no cache entry.

Run `node tools/sync.js` to update generated resources. Use these commands to test the generated files and source checks in separate runs.

```sh
node tools/sync.js --check --part=generated
node tools/sync.js --check --part=sources
```

Run `node tools/sync.js --check --part=format50` to compare only the format 50 resources and their browser bundle.

Add `--family=lojban` to the generated check to select one format 49 family. Use `eberban`, `gencmu` and `lojban` for the three legacy checks.

## Translate shared cases

The translator reads format 49 DOMs. It writes format 50 source and preserves the format 49 assertions as reference data. The diagnostic map records the old position and its corresponding declaration or operand. A position with no unique match needs review.

```sh
node tools/translate-shared-cases.js engine 0 200
node tools/translate-shared-cases.js notation
```

The optional start and count select a slice of the sorted case filenames. Each output line describes one case and its migration status.

- `translated` includes the source and any changes that the printer made.
- `hand-migrated` uses the written translation in `tools/shared-case-migrations.json`.
- `retained-negative` or `portable-negative` gives a format 50 counterpart and preserves the old test.
- `retired` names the removed construct that the old test exercises.
- `deferred` names the bundled pipeline that still needs its format 50 migration.
- `needs-negative` records a format 49 error that still needs an assessed counterpart or retirement.
- `needs-hand` names a source decision that needs a written translation.

## Diagnostic parity

From `lib/js`, run `npm test -- test/transition-differential.test.js` to test diagnostic order. Use `--test-name-pattern` to select bounded batches, for example `^transition differential shared engine 0$`. The number at the end of the test name is the first case index. Each shared batch covers up to 120 fixtures.

The harness compares the first source diagnostic with two JSON readings. One reverses record members. One uses a fixed random seed. Both preserve all array order.

For a valid source, the harness also replaces operands in the converted records with invalid names. It tests each replacement alone and pairs it with a separate operand when possible. The source reader's declaration checks provide the diagnostic for these replacements because an invalid DOM name can have no legal source spelling. The harness counts source failures that produce no DOM by phase.
