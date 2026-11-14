# The playground

The playground parses Lojban, Eberban and jbogenbau text in the browser and lets you edit the grammars live. Everything runs in a web worker inside your browser tab. The page sends no text or grammar edits over the network.

## Top bar

The logo shows the parser state. Its gears stay still when idle, turn while a parse runs, and jam on a parser or grammar error. Click the logo to open the help menu with links to the documentation and the repository.

The pipeline menu picks which pipeline runs. A pipeline runs its stages in order. Each stage reads tokens and hands new tokens to the next stage. The last stage builds the parse tree.

The Examples menu loads sample texts for the current pipeline. An example can set options, open an output view, or point to the grammar rule that it illustrates.

The Options menu controls features, the elision check, and the last stage to run.

- **Features**: Features turn optional grammar rules and warnings on or off. Each feature starts at the pipeline default, and you can force it on or off.
- **Elision-only**: This check writes back every elided terminator and checks that the stage still gives one reading. When it holds, any ambiguity in the stage is only about where omitted terminators close.
- **Run until**: Stop after an earlier stage to inspect the tokens that it emits or its own parse tree.

## Text and verdict

Type or paste text in the box at the top left. A parse runs after a short pause or when an option changes. While the worker is busy, the latest change waits and runs next.

The verdict card below the text reports the outcome, the parse time, and the stage chain. Click a stage chip in the chain to inspect the tokens that the stage emitted. Click **Share** to copy a URL that holds the pipeline, the text, the options, and small grammar edits.

When a stage rejects the text, the card shows the failure position and the terminals expected by each rule. Click a rule name to open that rule in the grammar editor. Click **Trace here** to inspect the Earley recognizer at that position.

When a stage ties between two readings, the card shows where the two readings first differ. Each output view then shows both readings under **First reading** and **Second reading**.

## Output views

- **Brackets**: Shows nested groups cycling `( )`, `[ ]`, and `{ }`, with single-child rules collapsed. Turn on **Elided** to show omitted terminators in angle brackets, such as `⟨ku⟩` and `⟨vau⟩`.
- **Tree**: Shows one node per line. Single-child rule chains join with `›`, and one-line leaves follow `·`.
- **JSON**: Shows the display JSON projection by default. Each rule or terminal is a single-key object, and hollow rules are left out. Turn on **Canonical** to see the full `ResultJson` object from [`docs/output.md`](output.md).
- **Tokens**: Lists the tokens that a stage emitted, with their text, value, image, spans, tags, and attachments.
- **Trace**: Shows what one stage's Earley recognizer did at one position between its input tokens. It lists completed, advanced, predicted, and dropped items, the condition that refused each dropped item, and the expected terminals.
- **Audit**: Reports static checks on the pipeline's grammars for each stage. It lists unreachable rules, rules replaced or extended by a later document, inert `%erased` clauses, and gated classifier entries.

## Grammar pane

The grammar pane lists the Markdown documents of the current pipeline, grouped by stage. Pick a document to read or edit its rules. The playground re-parses the text as you edit. Edits stay in your browser tab until you reset them. You can download a single edited document or all edited documents.
