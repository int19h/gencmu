# Compile format 50 source

The transition compiler uses the format 49 JavaScript engine. Its lexical and syntax stages build a tree. The DOM builder turns the tree into written declarations.

Run a command from the repository root.

```sh
node tools/transition-compiler.js document PATH
node tools/transition-compiler.js pipeline PATH
node tools/write-bootstrap50.js
```

The document command prints one format 50 DOM. The pipeline command prints the documents that the pipeline includes, with their source fingerprints. The bootstrap command writes the required seed and prints its SHA-256 digest.

The JavaScript package ships two source roots. The bundle manifest names each root, its bootstrap and its cache directory.

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
- `old` keeps the existing case in its format 49 runner.
- `needs-hand` names a source decision that needs a written translation.
