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
// when the bundled compiled.json has no DOM for its text under the current
// bootstrap, so loading a bundled dialect reads no grammar at all.
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
//	result, err := dialect.Parse("%rule text A [B] ...", gencmu.ParseOptions{})
//	if result.OK { fmt.Println(gencmu.Brackets(result, gencmu.BracketOptions{})) }
//	data, err := gencmu.MarshalResult(result) // the canonical JSON
//
// A text that does not parse is a result whose OK is false and whose Error
// says why: the input was rejected, was ambiguous under elision-only, or a
// grammar defect showed while parsing. Parse returns an error only for a
// caller's mistake, such as an unknown stage in ParseOptions.Until.
// ParseTokens feeds pre-built tokens to the first stage in place of the
// text's characters; it is for tests and tools. Each of those tokens has
// its text as its label. A caller cannot supply attachments: a token with
// a non-empty Before or After is a usage error, and empty ones are dropped.
//
// A token has its phonemes, what it sounds like, and its label, what it
// shows to people (engine §5). A token over an opaque part, such as the
// body of a zoi quote, sounds ? and has the part's text as its label.
// A token can also carry attachments, Before and After: tokens that belong
// to it and that no later stage reads, such as the indicators after a word
// (engine §11). An attached token has no span; the canonical JSON leaves
// it out. Brackets shows each token by its label, and a token with
// attachments as a group of its before-attachments, its label and its
// after-attachments, so mi ui klama is ([mi ui] klama).
//
// Every position in a result counts Unicode code points of the text, not
// bytes: Go's UTF-8 is converted at the edge. The tags of a token or a
// node are a list in code point order, each tag once and in its canonical
// spelling (engine §1): a name such as KOhA, a phoneme tag such as /a/, or
// a character tag such as 'a' or '\u{301}'. A tag has no strength.
//
// # Features
//
// A feature is a name that is on or off for a parse, the same for every
// stage. The pipeline turns some on; ParseOptions.Features turns others on,
// and ParseOptions.WithoutFeatures turns any of them off. A guard on an
// alternative of a grammar is a gate, f? or ¬f?, which keeps the
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
// Where a text has several parses, the one chosen is the least in the
// order of engine §6, computed over the packed parse forest without
// enumerating parses; a tie is reported in the stage's Verdict, with the
// witness and the tied tree that diverges from the chosen one earliest.
package gencmu
