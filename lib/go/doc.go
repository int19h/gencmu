// Package gencmu is a Lojban parser whose grammars are data: literate
// Markdown documents, loaded at runtime, whose fenced jbogenbau blocks are
// read by the notation's own grammar. A dialect is a pipeline document
// whose %stage and %include directives name the stages a text passes
// through, from characters to phonemes, words and a parse tree, and the
// grammar documents stitched into each.
//
// This package is one of four clean-room implementations of one
// specification, docs/engine.md in the gencmu repository, with the results
// defined in docs/output.md and the API in docs/api.md. It uses only the
// Go standard library, and embeds the bundled grammars, so it works with no
// files beside it.
//
// # Loading a dialect
//
// LoadDialect loads a bundled dialect by name, LoadDialectFile a pipeline
// document on disk, and LoadDialectSources documents held in memory. A
// dialect that cannot be loaded is a *Error, carrying the document, line
// and column where known. A document is read through the notation only
// when the bundled grammars/compiled.json has no DOM for its text under the current
// bootstrap, Unicode table, and DOM format version. A bundled dialect
// normally loads from the compiled cache.
//
// A DOM holds a document's constants, classifiers and implications as the
// document writes them, never their values. The loader gives each constant
// its value when it stitches a stage, and a stage resolves each classifier
// for the features of a parse. So a document that several stages or
// dialects include takes the values of each.
//
// # Parsing
//
//	dialect, err := gencmu.LoadDialect("notation")
//	result, err := dialect.Parse("%rule text A [{B}]", gencmu.ParseOptions{})
//	if result.OK { fmt.Println(gencmu.Brackets(result, gencmu.BracketOptions{})) }
//	data, err := gencmu.MarshalResult(result) // the canonical JSON
//
// A text that does not parse is a result whose OK is false and whose Error
// says why: the input was rejected, was ambiguous under elision-only, or a
// grammar defect showed while parsing. A defect that lowering finds for the
// features of the parse, such as a chain beside another alternative of its
// rule or an item of braces that can match no tokens, is such an error of
// kind grammar: the dialect loads, and the message begins with the
// document, line and column of the definition at fault (engine §3).
// Parse returns an error only for a
// caller's mistake, such as an unknown stage in ParseOptions.Until.
// ParseTokens feeds []InputToken to the first stage instead of scalar text
// tokens. Its Value and Image pointers default independently to Text when
// nil. Pointers to empty strings preserve empty values. The API rejects
// nonempty Before or After attachments and drops empty attachment lists.
//
// A token stores Value for recognition and Image for brackets (engine §1).
// Grammar recipes compute each output channel independently. Concatenation
// adds no separator, and the engine applies no comparison normalization.
// A token can carry Before and After attachments that later stages do not
// read (engine §11). Canonical JSON omits an attached token's Span.
// Brackets shows the attachments around the carrier's Image.
//
// Stage zero decomposes text with the shared Unicode table for Parse.
// Original text and source positions stay unchanged. ParseTokens bypasses
// decomposition. The .decomposed-source-text method decomposes the original
// source text of a span with the same table.
//
// Result format 15 and grammar DOM format 40 follow docs/output.md.
// Source positions count Unicode code points, rather than UTF-8 bytes.
// Spans and token indices count tokens of the relevant stage. Tags occur
// once in code point order. User tags start with uppercase ASCII letters.
// Reserved Unicode tags include _L, _Ll, and _White_Space (engine §1).
//
// # Features
//
// A feature is a name that is on or off at each stage of a parse.
// The pipeline can enable a feature from a selected stage onward.
// ParseOptions.Features enables features in every stage.
// ParseOptions.WithoutFeatures disables features. If a conditional
// declaration holds for a disabled feature, the result is feature-conflict.
//
// A guard on an alternative of a grammar is a gate, f? or ¬f?, which keeps the
// alternative only while f is on, or off, or a warning, f!, which keeps it
// either way and, while f is on, adds a Warning to the result for each node
// of the chosen tree that the alternative built. A gate can also stand
// before an entry of a classifier, which then applies only while the gate
// holds. Dialect.Features lists a dialect's features, the gates of its
// classifiers' entries included, each with its kind and whether the
// pipeline turns it on.
//
// # Concurrency
//
// A *Dialect is safe for concurrent use by several goroutines. Each parse
// keeps its own state. A dialect caches the lowered grammars and resolved
// classifiers for each set of the features that its guards use. It keeps a
// bounded number of them, and builds each one once, outside its mutex.
// These values never change once built.
//
// # Ambiguity
//
// Where a text has several parses, the rule of the stage, greedy, lazy or
// late-elision, ranks them over the packed parse forest without enumerating
// them (engine §6). A stage takes the one best parse. Where two or more are
// best, they are tied, and the tie is an error: the result's Error has kind
// ErrorAmbiguous, the reason ReasonTie, and two readings. The stage's
// Verdict is VerdictTie, with the witness, and it has no output.
package gencmu
