// Package gencmu is a Lojban parser whose grammars are data: literate
// Markdown documents, loaded at runtime, whose fenced jbogenbau blocks are
// read by the notation's own grammar. A dialect is a pipeline document
// naming the stages a text passes through, from characters to phonemes,
// words and a parse tree, and the grammar documents stitched into each.
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
// when the bundled compiled.json has no DOM for its text under the current
// bootstrap, so loading a bundled dialect reads no grammar at all.
//
// # Parsing
//
//	dialect, err := gencmu.LoadDialect("notation")
//	result, err := dialect.Parse("%rule text A [B] ...", gencmu.ParseOptions{})
//	if result.OK { fmt.Println(gencmu.Brackets(result, gencmu.BracketOptions{})) }
//	data, err := gencmu.MarshalResult(result) // the canonical JSON
//
// A text that does not parse is a result whose OK is false and whose Error
// says why: the input was rejected, was ambiguous under elision-only, or a
// grammar defect showed while parsing. Parse returns an error only for a
// caller's mistake, such as an unknown stage in ParseOptions.Until.
// ParseTokens feeds pre-built tokens to the first stage in place of the
// text's characters; it is for tests and tools.
//
// Every position in a result counts Unicode code points of the text, not
// bytes: Go's UTF-8 is converted at the edge. Tags are maps from tag to
// strength, true for strong.
//
// # Concurrency
//
// A *Dialect is safe for concurrent use by several goroutines. Each parse
// keeps its own state; the grammars a dialect lowers for each set of
// features are cached under a mutex and never change once built.
//
// # Ambiguity
//
// Where a text has several parses, the one chosen is the least in the
// order of engine §6, computed over the packed parse forest without
// enumerating parses; a tie is reported in the stage's Verdict, with the
// witness and the tied tree that diverges from the chosen one earliest.
package gencmu
