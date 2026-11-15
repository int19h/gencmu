# The playground

The playground parses Lojban, Eberban and jbogenbau text in the browser and lets you edit the grammars live. Everything runs in a web worker inside your browser tab. Except for the `Report this bug` link on a parser crash, the page sends no text or grammar edits over the network.

## Top bar

The logo shows the parser state. When the parser is idle, its gears stay still. While the parser loads or runs, the gears turn. If the parser stops, the gears jam. Click the logo to open the help menu with links to the documentation and the repository.

The pipeline menu picks which pipeline runs. A pipeline runs its stages in order. Each stage reads tokens and hands new tokens to the next stage. The last stage builds the parse tree.

The Examples menu loads sample texts for the current pipeline. An example can set options, show a note, open an output view, or open a grammar document.

The Options menu controls features, the elision check, and the last stage to run.

- Features turn optional grammar rules and warnings on or off. Each feature starts at the pipeline default, and you can force it on or off.
- The elision-only check writes back every elided terminator and checks that the stage still gives one reading. When it holds, any ambiguity in the stage is only about where omitted terminators close.
- The run-until control stops the parse after an earlier stage so that you can inspect its emitted tokens or its parse tree.

## Text and verdict

Type or paste text in the box at the top left. When you pause after typing or change an option, a parse runs. While the worker is busy, a newer change replaces the pending run.

The verdict card below the text reports the outcome, the parse time, the stage chain, and the enabled features. Click a completed stage chip to open the Tokens view for that stage. A failed stage chip opens the Tokens view of the stage before it, which holds the tokens that it read. If the first stage fails, its chip opens its own empty Tokens view. A chip for a stage that did not run is not a button. The Share button copies a link with the text, pipeline, options, view, toggles, Tokens stage, and Trace stage and position.

When a stage rejects the text, the card shows the failure position and the terminals expected by each rule. Click a rule name to open that rule in the grammar editor. Click Trace here to inspect the Earley recognizer at that position.

When a stage ties between two readings, the card shows where the two readings first differ. The Brackets, Tree, and JSON views then show both readings under First reading and Second reading.

## Output views

- The Brackets view shows nested groups cycling `( )`, `[ ]`, and `{ }`, with single-child rules collapsed. Elided starts on and shows omitted terminators in angle brackets, such as `⟨ku⟩` and `⟨vau⟩`.
- The Tree view shows one node per line. Single-child rule chains join with `›`, and one-line leaves follow `·`.
- The JSON view shows the display JSON projection by default, with hollow rules left out. Turn on Canonical to see the canonical JSON from [`docs/output.md`](output.md).
- The Tokens view lists the tokens that a stage emitted. Its columns are `#`, `text`, `value`, `image`, `span`, `source`, `insertedBy`, `before`, and `after`. Error codes, warning codes, and tags show as chips on a line under each token.
- The Trace view shows what one stage's Earley recognizer did at one position between its input tokens. It lists the completed, advanced, predicted, and dropped items there, and what the stage could read next.
- The Audit view reports static checks on the pipeline's grammars for each stage. It lists unreachable rules, replaced or extended rules, stage changes, inert `%erased` clauses, and gated classifier entries. It also prints templates, instances, ranking steps, counted rules, boundary notes, diagnostic notes, elidable families, and erasures.

## Grammar pane

The grammar pane lists the Markdown documents of the current pipeline, grouped by stage. Pick a document to read or edit its rules. The playground re-parses the text as you edit. Edits stay in memory in your browser tab until you reset them or reload the page. You can download the open document or all edited documents.
